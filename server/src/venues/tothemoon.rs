mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::socket_anchors::SocketAnchors;
use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::de::{Deserializer, MapAccess, Visitor};
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::fmt;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "tothemoon";

// The tothemoon.com web app's Octopus host, since the documented octopus.tothemoon.com does not resolve.
// One socket carries the catalog, the books and the tickers.
const SOCKET_URL: &str = "wss://octopus-prod-ws.cryptology.com/v1/connect";

const BOOK_CHANNEL: &str = "contractsOrderbookVolumes.";

// One subscription streams a ticker for every perpetual, each about once a second, and only the ticker carries the anchor.
const TICKERS_CHANNEL: &str = "turboTickers.*";
const TICKERS_REQUEST: &str = "tickers";

// The venue listed 13 perpetuals on 2026-10-09, and 29 subscriptions on one socket ran cleanly on 2026-09-23.
const MARKETS_PER_CONNECTION: usize = 25;

// The second whole window arrives at nonce 2 or 3, holds about 15 levels a side and deletes nothing.
// No delta seen on 2026-09-23 or 2026-10-09 came near 10 levels a side.
const LAST_WINDOW_NONCE: u64 = 3;
const WINDOW_MIN_LEVELS: usize = 10;

pub struct Tothemoon {
    anchors: SocketAnchors, // filled by handle, read by fetch_round
    expected: usize,        // tracked markets with an anchor row, which fetch_round waits for at boot
    first_round: OnceLock<Instant>,
}

impl Tothemoon {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        let expected = markets.iter().filter(|m| !anchor::skewed_index(&m.market.raw_market_id)).count();
        Self {
            anchors: SocketAnchors::new(true),
            expected,
            first_round: OnceLock::new(),
        }
    }
}

impl BookVenue for Tothemoon {
    type State = HashMap<usize, u64>; // the nonce of the last book frame applied, by position

    // Every book sends 4 to 6 frames a second and the tickers one per market a second, so 5 s of silence is a dead socket.
    // The server pings about every 15 s and the automatic pong is enough, so no client ping is sent.
    // The documented cap is 10 requests a second.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            subscribe_gap: Duration::from_millis(250),
            ..FeedSettings::new(Duration::from_secs(5))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#perp#{i}"),
                url: SOCKET_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // The tickers go first, so the anchors fill while the books subscribe one channel per frame.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len() + 1);
        frames.push(subscribe(TICKERS_CHANNEL, TICKERS_REQUEST));
        for market in markets {
            frames.push(subscribe(&format!("{BOOK_CHANNEL}{}", market.raw_market_id), &market.raw_market_id));
        }
        frames
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = match serde_json::from_slice(frame) {
            Ok(frame) => frame,
            Err(error) => {
                // The next nonce would show the loss, but until then the book would stand as current without this frame.
                if frame.windows(BOOK_CHANNEL.len()).any(|window| window == BOOK_CHANNEL.as_bytes()) {
                    conn.resync("connection", "book_frame_unreadable");
                }
                return Err(error.into());
            }
        };

        match frame.kind.as_ref() {
            "subscriptionData" => {}
            "welcomeMessage" | "subscribedSuccessful" => return Ok(()),
            "errorMessage" => {
                let payload = frame.payload.unwrap_or_default();
                tracing::error!(
                    event = "venue_error",
                    connection = conn.id(),
                    request_id = frame.request_id.as_deref().unwrap_or(""),
                    code = payload.code.as_deref().unwrap_or(""),
                    message = payload.message.as_deref().unwrap_or(""),
                );
                return Ok(());
            }
            // THROTTLING is documented and was never seen, and anything else is new.
            kind => {
                tracing::warn!(event = "venue_notice", connection = conn.id(), kind, request_id = frame.request_id.as_deref().unwrap_or(""));
                return Ok(());
            }
        }

        let Some(payload) = frame.payload else {
            return Ok(());
        };
        let channel = payload.channel.as_deref().unwrap_or("");

        // An id the venue does not list is acknowledged, then answered once with a null and then nothing.
        let Some(data) = payload.data else {
            tracing::error!(event = "venue_error", connection = conn.id(), channel, message = "subscription answered with null data");
            return Ok(());
        };

        if channel == TICKERS_CHANNEL {
            self.read_ticker(&data, conn.frame_recv_ts());
        } else if channel.starts_with(BOOK_CHANNEL) {
            apply_book(&data, payload.nonce, conn);
        }
        Ok(())
    }
}

impl Tothemoon {
    // Funding is disabled on every perpetual, so the rate reads 0, and no field names the next settlement.
    fn read_ticker(&self, data: &Data, at: i64) {
        let raw = data.instrument_id.as_ref();
        self.anchors.set_index(raw, data.index_price, at);
        self.anchors.set_mark(raw, data.mark_price, at);
        self.anchors.set_funding(raw, data.funding_rate, data.funding_interval / 3_600_000.0, 0);
    }
}

fn subscribe(channel: &str, request_id: &str) -> Message {
    let frame = serde_json::json!({ "type": "subscribe", "channel": channel, "request_id": request_id });
    Message::text(frame.to_string())
}

// Nonce 1 is the whole window, up to 1.2 s stale, and nonce 2 or 3 is usually a fresher whole window.
// Merging that second window, as the web app does, left stale levels that crossed 7 of 19 books on 2026-09-23, so it replaces the book.
// After it every frame is a price map applied in arrival order, since one frame at nonce 2 or 3 carries an older offset and must still apply.
fn apply_book(data: &Data, nonce: u64, conn: &mut Connection<HashMap<usize, u64>>) {
    let raw = data.instrument_id.as_ref();
    let Some(position) = conn.position(raw) else {
        return;
    };
    let Some(volumes) = &data.volumes else {
        conn.resync(raw, "book_frame_without_volumes");
        return;
    };
    // The book skips a level it cannot read, which would leave a deleted level standing.
    if !readable(&volumes.bids) || !readable(&volumes.asks) {
        conn.resync(raw, "level_unreadable");
        return;
    }

    if nonce == 1 {
        conn.state.insert(position, nonce);
        replace(position, raw, volumes, conn);
        return;
    }

    // The nonce counts this subscription's frames from 1 with no gap, and is the only sequence the book has.
    let Some(&last) = conn.state.get(&position) else {
        conn.resync(raw, "delta_before_snapshot");
        return;
    };
    if nonce != last + 1 {
        conn.resync(raw, "nonce_gap");
        return;
    }
    conn.state.insert(position, nonce);

    if nonce <= LAST_WINDOW_NONCE && is_whole_window(volumes) {
        replace(position, raw, volumes, conn);
        return;
    }

    let Some(book) = conn.book(position) else {
        conn.resync(raw, "delta_before_snapshot");
        return;
    };
    for level in &volumes.bids {
        book.set_bid(level.price, level.size);
    }
    for level in &volumes.asks {
        book.set_ask(level.price, level.size);
    }

    // No checksum exists, so a crossed top is the one sign of a lost or misread frame, and it is never published.
    if let (Some(bid), Some(ask)) = (book.bids().first(), book.asks().first())
        && bid.price >= ask.price
    {
        conn.resync(raw, "crossed_book");
        return;
    }
    conn.publish(position);
}

fn replace(position: usize, raw: &str, volumes: &Volumes, conn: &mut Connection<HashMap<usize, u64>>) {
    if crosses(&volumes.bids, &volumes.asks) {
        conn.resync(raw, "crossed_snapshot");
        return;
    }
    conn.reset_book(position, &volumes.bids, &volumes.asks);
}

fn readable(levels: &[BookLevel]) -> bool {
    levels.iter().all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

fn is_whole_window(volumes: &Volumes) -> bool {
    let deletes = volumes.bids.iter().chain(&volumes.asks).any(|level| level.size == 0.0);
    !deletes && volumes.bids.len() >= WINDOW_MIN_LEVELS && volumes.asks.len() >= WINDOW_MIN_LEVELS
}

fn crosses(bids: &[BookLevel], asks: &[BookLevel]) -> bool {
    let best_bid = bids.iter().filter(|l| l.size > 0.0).map(|l| l.price).fold(f64::NEG_INFINITY, f64::max);
    let best_ask = asks.iter().filter(|l| l.size > 0.0).map(|l| l.price).fold(f64::INFINITY, f64::min);
    best_bid >= best_ask
}

// Data, acknowledgements, errors and the welcome share the envelope.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(rename = "type", borrow)]
    kind: Cow<'a, str>, // "subscriptionData", "subscribedSuccessful", "errorMessage" or "welcomeMessage"
    #[serde(borrow)]
    request_id: Option<Cow<'a, str>>,
    #[serde(borrow)]
    payload: Option<Payload<'a>>,
}

#[derive(Deserialize, Default)]
struct Payload<'a> {
    #[serde(borrow)]
    channel: Option<Cow<'a, str>>,
    #[serde(borrow)]
    data: Option<Data<'a>>, // null for an id the venue does not list
    #[serde(default)]
    nonce: u64, // this subscription's frame count from 1
    code: Option<String>, // on an error, "COMMON_ERROR"
    message: Option<String>,
}

// A book frame and a ticker frame, which share instrument_id.
#[derive(Deserialize)]
struct Data<'a> {
    #[serde(default, borrow)]
    instrument_id: Cow<'a, str>, // "BTC_USDT_PERPETUAL"
    volumes: Option<Volumes>, // sizes in contracts, while extended_volumes repeats them in coins and is not read
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64, // equal to the index while funding is disabled
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_interval: f64, // ms, 28800000 on most, 3600000 on AVAX and 21600000 on LTC
}

#[derive(Deserialize)]
struct Volumes {
    #[serde(default, deserialize_with = "price_map")]
    bids: Vec<BookLevel>, // {"82283.8": "327018"}, a size of "0" deletes the level
    #[serde(default, deserialize_with = "price_map")]
    asks: Vec<BookLevel>,
}

// An object of price strings to size strings in no stable order, or a null.
fn price_map<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<BookLevel>, D::Error> {
    deserializer.deserialize_any(PriceMapVisitor)
}

#[derive(Deserialize)]
struct Price<'a>(#[serde(borrow)] Cow<'a, str>); // "82283.8"

#[derive(Deserialize)]
struct Size(#[serde(deserialize_with = "wire::num")] f64); // "327018"

struct PriceMapVisitor;

impl<'de> Visitor<'de> for PriceMapVisitor {
    type Value = Vec<BookLevel>;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("an object of price to size strings, or null")
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(Vec::new())
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut levels = Vec::with_capacity(map.size_hint().unwrap_or(16));
        while let Some((Price(price), Size(size))) = map.next_entry::<Price<'de>, Size>()? {
            levels.push(BookLevel { price: wire::number(&price), size });
        }
        Ok(levels)
    }
}
