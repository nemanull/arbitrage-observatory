mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "zoomex";

const REST: &str = "https://openapi.zoomex.com";

// Bybit's v5 public protocol, one family per URL, and only the linear family is loaded.
const LINEAR_URL: &str = "wss://stream.zoomex.com/v5/public/linear";

// Fifty levels at a 20 ms push, snapshot then deltas, as on Bybit.
const DEPTH: u32 = 50;

// The args cap is 21,000 characters per connection, and 200 `orderbook.50.` topics measure about 4,900.
const MARKETS_PER_CONNECTION: usize = 200;

// The books Zoomex runs itself, while every other linear book is Bybit's, relayed.
// Their own mark, funding and cap are only on the per symbol ticker, since the bulk ticker carries Bybit's numbers for them too.
// A compare of all 711 single symbol tickers against the bulk reply on 2026-10-09 found exactly these four.
const OWN_MARKETS: &[&str] = &["BTCUSDT", "ETHUSDT", "SOLUSDT", "GMTUSDT"];

pub struct Zoomex {
    rest: String,
    own: Vec<String>, // the tracked markets of OWN_MARKETS, each read by its own ticker call
}

impl Zoomex {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(markets, REST)
    }

    fn with_rest(markets: &[TrackedMarket], rest: &str) -> Self {
        let mut own = Vec::new();
        for tracked in markets {
            if OWN_MARKETS.contains(&tracked.market.raw_market_id.as_str()) {
                own.push(tracked.market.raw_market_id.clone());
            }
        }
        Self { rest: rest.to_string(), own }
    }
}

impl BookVenue for Zoomex {
    type State = HashMap<usize, i64>; // `u` of the last frame applied, by position

    fn settings(&self) -> FeedSettings {
        // The server closes a socket it has sent nothing on for about 10 s, and a pong counts, so the ping keeps a quiet socket open.
        FeedSettings {
            ping_every: Some(Duration::from_secs(5)),
            ..FeedSettings::new(Duration::from_secs(15))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#linear#{i}"),
                url: LINEAR_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // One topic per frame, because one refused topic fails its whole frame.
    // A frame of 200 with one unknown symbol delivered no book at all on 2026-10-09, while 200 frames of one lost only that symbol.
    // So a market delisted during a run costs only its own book at the next reconnect, as STGUSDT's offlineTime of 2026-10-10 suggests it soon will.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for (i, market) in markets.iter().enumerate() {
            let topic = format!("orderbook.{DEPTH}.{}", market.raw_market_id);
            let frame = serde_json::json!({ "req_id": format!("sub-{}", i + 1), "op": "subscribe", "args": [topic] });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text(r#"{"op":"ping"}"#)
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(frame)?;

        // The topic names the market, because an own book's `data.s` can carry an internal name such as BTC2USDT.
        if let Some(data) = frame.data
            && let Some(symbol) = frame.topic.and_then(book_symbol)
        {
            apply_book(symbol, frame.kind, data.u, &data.b, &data.a, conn);
            return Ok(());
        }

        if frame.success == Some(false) {
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                op = frame.op.as_deref().unwrap_or("request"),
                message = frame.ret_msg.as_deref().unwrap_or(""),
            );
        }

        Ok(())
    }
}

// "orderbook.50.BTCUSDT" to "BTCUSDT".
fn book_symbol(topic: &str) -> Option<&str> {
    let (_, symbol) = topic.strip_prefix("orderbook.")?.split_once('.')?;
    Some(symbol)
}

fn apply_book(
    symbol: &str,
    kind: Option<&str>,
    u: Option<i64>,
    bids: &[BookLevel],
    asks: &[BookLevel],
    conn: &mut Connection<HashMap<usize, i64>>,
) {
    let Some(position) = conn.position(symbol) else {
        return;
    };

    // A snapshot after a venue restart carries u of 1, and it replaces the book like any other.
    if kind == Some("snapshot") {
        conn.state.insert(position, u.unwrap_or(0));
        conn.reset_book(position, bids, asks);
        return;
    }

    let Some(&last) = conn.state.get(&position) else {
        conn.resync(symbol, "delta_before_snapshot");
        return;
    };
    if conn.book(position).is_none() {
        conn.resync(symbol, "delta_before_snapshot");
        return;
    }

    if u != Some(last + 1) {
        conn.resync(symbol, "sequence_gap");
        return;
    }
    conn.state.insert(position, last + 1);

    let Some(book) = conn.book(position) else {
        return;
    };
    for level in bids {
        book.set_bid(level.price, level.size);
    }
    for level in asks {
        book.set_ask(level.price, level.size);
    }
    conn.publish(position);
}

#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    topic: Option<&'a str>, // "orderbook.50.BTCUSDT"
    #[serde(rename = "type", borrow)]
    kind: Option<&'a str>, // "snapshot" or "delta"
    data: Option<BookData>,
    success: Option<bool>, // false is the only error signal a control frame gives
    ret_msg: Option<String>,
    op: Option<String>, // what the control frame answers: "subscribe" or "ping"
}

#[derive(Deserialize)]
struct BookData {
    #[serde(default, deserialize_with = "wire::levels")]
    b: Vec<BookLevel>, // best first on a snapshot, changed levels only on a delta
    #[serde(default, deserialize_with = "wire::levels")]
    a: Vec<BookLevel>,
    u: Option<i64>, // plus one per delta
}
