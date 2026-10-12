mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use anchor::Intervals;
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "pionex";

const REST: &str = "https://api.pionex.com";

// One address carries every perpetual family and spot.
const PUBLIC_URL: &str = "wss://ws.pionex.com/wsPub";

// A snapshot of 100 levels a side on subscribe, then the changed levels about every 200 ms, chained by prevNumber.
const TOPIC: &str = "ORDERBOOK";
const BOOK_KEY: &[u8] = br#""ORDERBOOK""#;

// 100 streams ran on one socket with no gap, and the venue allows 10 sockets per IP, so 552 markets take 6.
const MARKETS_PER_CONNECTION: usize = 100;

pub struct Pionex {
    rest: String,
    markets: Vec<String>, // tracked raw ids, whose funding histories the anchor reads in turn
    intervals: Mutex<Intervals>,
}

impl Pionex {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(markets, REST)
    }

    fn with_rest(markets: &[TrackedMarket], rest: &str) -> Self {
        Self {
            rest: rest.to_string(),
            markets: markets.iter().map(|tracked| tracked.market.raw_market_id.clone()).collect(),
            intervals: Mutex::new(Intervals::default()),
        }
    }
}

impl BookVenue for Pionex {
    type State = HashMap<usize, i64>; // `number` of the last frame applied, by position

    // The server pings every 15 s and closes after three unanswered pings, and a client ping gets no answer.
    // So the pongs never need a timer, and two missed server pings is a dead socket.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            // One symbol per frame and 5 client messages a second per socket, so 100 markets take 25 s.
            subscribe_gap: Duration::from_millis(250),
            // Handshakes draw on a bucket of 5 that refilled at about 2 a second on 2026-10-09, and the sixth of six opened at once got HTTP 429.
            // A 429 then refused every handshake for about a minute, so first opens go one a second and reconnects spread over 3 s.
            connect_stagger: Duration::from_secs(1),
            reconnect_jitter: Duration::from_secs(3),
            ..FeedSettings::new(Duration::from_secs(35))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#public#{i}"),
                url: PUBLIC_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // A comma list or an array of symbols is refused, so each market takes its own frame.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for market in markets {
            let frame = serde_json::json!({ "op": "SUBSCRIBE", "topic": TOPIC, "symbol": market.raw_market_id });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn handle(&self, bytes: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = match serde_json::from_slice(bytes) {
            Ok(frame) => frame,
            Err(error) => {
                // The next update's prevNumber would show the loss, but a quiet book sends one only every 10 s.
                if bytes.windows(BOOK_KEY.len()).any(|window| window == BOOK_KEY) {
                    conn.resync("connection", "book_frame_unreadable");
                }
                return Err(error.into());
            }
        };

        if frame.topic.as_deref() == Some(TOPIC)
            && let Some(symbol) = frame.symbol.as_deref()
            && let Some(book) = &frame.data
        {
            apply_book(symbol, book, conn);
            return Ok(());
        }

        if frame.op.as_deref() == Some("PING") {
            let timestamp = frame.timestamp.unwrap_or(0);
            conn.send(Message::text(format!(r#"{{"op":"PONG","timestamp":{timestamp}}}"#)));
            return Ok(());
        }

        match frame.kind.as_deref() {
            Some("SUBSCRIBED" | "UNSUBSCRIBED") => {}
            Some("ERROR") => tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                code = frame.code.as_deref().unwrap_or(""),
                message = frame.message.as_deref().unwrap_or(""),
            ),
            kind => tracing::warn!(
                event = "venue_notice",
                connection = conn.id(),
                kind = kind.unwrap_or(""),
                op = frame.op.as_deref().unwrap_or(""),
                topic = frame.topic.as_deref().unwrap_or(""),
            ),
        }

        Ok(())
    }
}

// `number` comes from a counter shared across symbols, so only prevNumber chains one symbol, and a quiet book's empty update still moves it.
fn apply_book(symbol: &str, book: &BookData, conn: &mut Connection<HashMap<usize, i64>>) {
    let Some(position) = conn.position(symbol) else {
        return;
    };

    match book.action.as_deref() {
        Some("SNAPSHOT") => {
            // reset_book publishes at once and skips a level it cannot read, so the snapshot is checked first.
            if book.number <= 0 {
                conn.resync(symbol, "snapshot_without_number");
                return;
            }
            if !book.bids.iter().chain(&book.asks).all(readable) {
                conn.resync(symbol, "level_unreadable");
                return;
            }
            conn.state.insert(position, book.number);
            conn.reset_book(position, &book.bids, &book.asks);
            return;
        }
        Some("UPDATE") => {}
        _ => {
            conn.resync(symbol, "unknown_book_action");
            return;
        }
    }

    let Some(&last) = conn.state.get(&position) else {
        conn.resync(symbol, "delta_before_snapshot");
        return;
    };
    if book.prev_number != last || book.number <= 0 {
        conn.resync(symbol, "sequence_gap");
        return;
    }
    conn.state.insert(position, book.number);

    if book.bids.is_empty() && book.asks.is_empty() {
        return;
    }

    let Some(levels) = conn.book(position) else {
        conn.resync(symbol, "delta_before_snapshot");
        return;
    };
    let mut applied = true;
    for level in &book.bids {
        applied &= levels.set_bid(level.price, level.size);
    }
    for level in &book.asks {
        applied &= levels.set_ask(level.price, level.size);
    }
    if !applied {
        conn.resync(symbol, "level_unreadable");
        return;
    }
    conn.publish(position);
}

// The check OrderBook::set_bid makes, so a snapshot level it would skip is caught before the book is replaced.
fn readable(level: &BookLevel) -> bool {
    level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0
}

// Books, acknowledgements, pings and errors share the envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    topic: Option<Cow<'a, str>>, // "ORDERBOOK" on a book and on an acknowledgement
    #[serde(borrow)]
    symbol: Option<Cow<'a, str>>, // "BTC_USDT_PERP", and five symbols are Chinese names
    data: Option<BookData>,
    #[serde(borrow)]
    op: Option<Cow<'a, str>>, // "PING", every 15 s
    timestamp: Option<i64>, // Unix ms on a ping, echoed back in the pong
    #[serde(borrow, rename = "type")]
    kind: Option<Cow<'a, str>>, // "SUBSCRIBED", "UNSUBSCRIBED" or "ERROR"
    #[serde(borrow)]
    code: Option<Cow<'a, str>>, // "INVALID_SYMBOL" on an error
    #[serde(borrow)]
    message: Option<Cow<'a, str>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BookData {
    action: Option<String>, // "SNAPSHOT" or "UPDATE"
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // [price, coins] strings, best first, and a size of "0" deletes the level
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
    #[serde(default)]
    number: i64, // 0 when missing, which can chain nothing
    #[serde(default)]
    prev_number: i64, // 0 on a snapshot
}
