mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::order_book::OrderBook;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use anchor::FundingState;
use serde::de::value::MapAccessDeserializer;
use serde::de::{self, Deserializer, MapAccess, Visitor};
use serde::Deserialize;
use std::borrow::Cow;
use std::fmt;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "digifinex";

const REST: &str = "https://openapi.digifinex.com";

// One URL serves both perpetual families, and the inverse ones never reach the plan.
const PUBLIC_URL: &str = "wss://openapi.digifinex.com/swap_ws/v2/";

// The channel offers 10, 20 or 100 levels, and answers code 2 to any other.
const LEVEL: usize = 20;

// One instrument is one channel, and a 31st channel closes the socket with every book on it and no reply.
// 25 leaves room under the cap.
const MARKETS_PER_CONNECTION: usize = 25;

// A subscribe request carries its market's position plus one, so a refusal names the market.
// The server refuses a request whose id is 0 as if it had none, so the ping takes an id no position reaches.
const PING_ID: i64 = 1_000_000;

const BOOK_EVENT: &str = "depth.update";
const ZLIB_HEADER: u8 = 0x78;

pub struct Digifinex {
    rest: String,
    markets: Vec<String>, // tracked raw ids, whose funding the anchor reads in turn
    funding: Mutex<FundingState>,
}

impl Digifinex {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(markets, REST)
    }

    fn with_rest(markets: &[TrackedMarket], rest: &str) -> Self {
        Self {
            rest: rest.to_string(),
            markets: markets.iter().map(|tracked| tracked.market.raw_market_id.clone()).collect(),
            funding: Mutex::new(FundingState::default()),
        }
    }
}

impl BookVenue for Digifinex {
    type State = (); // no sequence exists, so a book on the connection is all a frame needs

    // The server closes a socket whose client sent nothing for 60 s, even while it pushes, so the ping is required.
    // A quiet book went 32 s without a frame, and the pong every 20 s is the traffic the silence check relies on.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(20)),
            // The docs limit a connection to 24 hours.
            retire_after: Some(Duration::from_secs(23 * 60 * 60)),
            retire_jitter: Duration::from_secs(30 * 60),
            ..FeedSettings::new(Duration::from_secs(60))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#perp#{i}"),
                url: PUBLIC_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // One instrument per frame, because a frame naming one unknown instrument is refused whole with code 2.
    // 25 frames sent at once were all acknowledged on 2026-10-09.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for (position, market) in markets.iter().enumerate() {
            let frame = serde_json::json!({
                "id": position + 1,
                "event": "depth.subscribe",
                "instrument_ids": [market.raw_market_id],
                "level": LEVEL,
            });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text(format!(r#"{{"id":{PING_ID},"event":"server.ping"}}"#))
    }

    // Every frame is a binary message of zlib deflated JSON.
    fn handle(&self, bytes: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let inflated;
        let text = if bytes.first() == Some(&ZLIB_HEADER) {
            match wire::inflate(bytes) {
                Ok(text) => {
                    inflated = text;
                    inflated.as_slice()
                }
                Err(error) => {
                    // Nearly every frame is a book frame, and no sequence can show one lost here.
                    conn.resync("connection", "frame_unreadable");
                    return Err(error);
                }
            }
        } else {
            bytes
        };

        let frame: Frame = match serde_json::from_slice(text) {
            Ok(frame) => frame,
            Err(error) => {
                if text.windows(BOOK_EVENT.len()).any(|window| window == BOOK_EVENT.as_bytes()) {
                    conn.resync("connection", "book_frame_unreadable");
                }
                return Err(error.into());
            }
        };

        if frame.event == BOOK_EVENT {
            if let Some(book) = &frame.data {
                apply_book(book, frame.full_data, conn);
            }
            return Ok(());
        }

        // Acknowledgements and pongs carry code 1.
        // Code 2 refuses an unknown instrument or a malformed request, and code 5 a repeated subscribe.
        if let Some(code) = frame.code
            && code != 1
        {
            let id = frame.id.unwrap_or(0);
            let market = usize::try_from(id)
                .ok()
                .and_then(|id| id.checked_sub(1))
                .and_then(|position| conn.markets().get(position))
                .map_or("", |market| market.raw_market_id.as_str());
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                request = %frame.event,
                id,
                market,
                code,
                message = frame.msg.as_deref().unwrap_or(""),
            );
        }

        Ok(())
    }
}

// The first frame of a stream carries full_data and replaces the book, and every later frame carries only the changed levels.
// No sequence or checksum exists, so a lost delta can show only as a crossed top.
fn apply_book(book: &Depth, full_data: bool, conn: &mut Connection<()>) {
    let raw_market_id = book.instrument_id.as_ref();
    let Some(position) = conn.position(raw_market_id) else {
        return;
    };

    if full_data {
        // Built aside, so a snapshot with a level it cannot read or a crossed top never reaches the engine.
        let mut snapshot = OrderBook::default();
        let mut readable = true;
        for level in &book.bids {
            readable &= snapshot.set_bid(level.price, level.size);
        }
        for level in &book.asks {
            readable &= snapshot.set_ask(level.price, level.size);
        }
        if !readable {
            conn.resync(raw_market_id, "level_unreadable");
            return;
        }
        trim(&mut snapshot);
        if is_crossed(&snapshot) {
            conn.resync(raw_market_id, "crossed_book");
            return;
        }
        conn.reset_book(position, snapshot.bids(), snapshot.asks());
        return;
    }

    let Some(order_book) = conn.book(position) else {
        conn.resync(raw_market_id, "delta_before_snapshot");
        return;
    };

    // A delta's bids arrive worst first, so each level is applied by price and never by position.
    let mut readable = true;
    for level in &book.bids {
        readable &= order_book.set_bid(level.price, level.size);
    }
    for level in &book.asks {
        readable &= order_book.set_ask(level.price, level.size);
    }
    trim(order_book);
    let crossed = is_crossed(order_book);

    if !readable {
        conn.resync(raw_market_id, "level_unreadable");
        return;
    }
    if crossed {
        conn.resync(raw_market_id, "crossed_book");
        return;
    }
    conn.publish(position);
}

// The venue deletes a level leaving its window, and the trim only guards the engine's depth.
fn trim(book: &mut OrderBook) {
    while book.bids().len() > LEVEL {
        let price = book.bids()[LEVEL].price;
        book.set_bid(price, 0.0);
    }
    while book.asks().len() > LEVEL {
        let price = book.asks()[LEVEL].price;
        book.set_ask(price, 0.0);
    }
}

fn is_crossed(book: &OrderBook) -> bool {
    matches!((book.bids().first(), book.asks().first()), (Some(bid), Some(ask)) if bid.price >= ask.price)
}

// Books, acknowledgements, pongs and refusals share the envelope, so only event is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow, default)]
    event: Cow<'a, str>, // "depth.update", "depth.subscribe", "server.ping", or "" for a frame that was not JSON
    #[serde(borrow, default, deserialize_with = "book_or_none")]
    data: Option<Depth<'a>>, // the book on a push, the string "pong" on a pong
    #[serde(default)]
    full_data: bool, // true on the first frame of a stream only, and undocumented
    id: Option<i64>,
    code: Option<i64>,
    msg: Option<Cow<'a, str>>, // "invalid param", "repeat subscribe"
}

#[derive(Deserialize)]
struct Depth<'a> {
    #[serde(borrow, default)]
    instrument_id: Cow<'a, str>, // "BTCUSDTPERP", the catalog's id
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // [string price, number contracts], where 0 deletes the level
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
}

// A book is an object, and anything else in data reads as no book.
fn book_or_none<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Option<Depth<'de>>, D::Error> {
    deserializer.deserialize_any(BookOrNone)
}

struct BookOrNone;

impl<'de> Visitor<'de> for BookOrNone {
    type Value = Option<Depth<'de>>;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a book object or any other value")
    }

    fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<Self::Value, A::Error> {
        Depth::deserialize(MapAccessDeserializer::new(map)).map(Some)
    }

    fn visit_str<E: de::Error>(self, _value: &str) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_unit<E: de::Error>(self) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_bool<E: de::Error>(self, _value: bool) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_i64<E: de::Error>(self, _value: i64) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_u64<E: de::Error>(self, _value: u64) -> Result<Self::Value, E> {
        Ok(None)
    }

    fn visit_f64<E: de::Error>(self, _value: f64) -> Result<Self::Value, E> {
        Ok(None)
    }
}
