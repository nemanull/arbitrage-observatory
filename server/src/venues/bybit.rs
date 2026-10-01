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

pub const ID: &str = "bybit";

const REST: &str = "https://api.bybit.com";

// Bybit splits its public endpoints by market family, and one connection cannot carry topics from two families.
const LINEAR_URL: &str = "wss://stream.bybit.com/v5/public/linear";
const INVERSE_URL: &str = "wss://stream.bybit.com/v5/public/inverse";

// Fifty levels at a 20 ms push, snapshot then deltas.
// The next depth up is 200 levels at 100 ms.
const DEPTH: u32 = 50;

// Bybit caps the public argument string at 21,000 characters per connection, and 200 `orderbook.50.` topics measure about 4,900.
// It allows 1,000 connections per family, so more and smaller sockets cost nothing.
const MARKETS_PER_CONNECTION: usize = 200;
const TOPICS_PER_FRAME: usize = 200; // a full slice fits in one frame, and the chunk keeps it under the cap if the slice grows

pub struct Bybit {
    rest: String,
    has_linear: bool, // the poller asks a category only when a market of it is tracked
    has_inverse: bool,
}

impl Bybit {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(markets, REST)
    }

    fn with_rest(markets: &[TrackedMarket], rest: &str) -> Self {
        Self {
            rest: rest.to_string(),
            has_linear: markets.iter().any(|tracked| tracked.market.linear),
            has_inverse: markets.iter().any(|tracked| !tracked.market.linear),
        }
    }
}

impl BookVenue for Bybit {
    type State = HashMap<usize, i64>; // `u` of the last frame applied, by position

    fn settings(&self) -> FeedSettings {
        // The application ping is answered, so three missed answers is a dead socket.
        FeedSettings {
            ping_every: Some(Duration::from_secs(20)),
            ..FeedSettings::new(Duration::from_secs(60))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut linear = Vec::new();
        let mut inverse = Vec::new();
        for market in markets {
            if market.linear {
                linear.push(market.clone());
            } else {
                inverse.push(market.clone());
            }
        }

        let mut plans = plan_family(&linear, "linear", LINEAR_URL);
        plans.extend(plan_family(&inverse, "inverse", INVERSE_URL));
        plans
    }

    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::new();
        for (i, slice) in markets.chunks(TOPICS_PER_FRAME).enumerate() {
            let mut topics = Vec::with_capacity(slice.len());
            for market in slice {
                topics.push(format!("orderbook.{DEPTH}.{}", market.raw_market_id));
            }
            let frame = serde_json::json!({ "req_id": format!("sub-{}", i + 1), "op": "subscribe", "args": topics });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text(r#"{"op":"ping"}"#)
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(frame)?;

        if let Some(data) = frame.data
            && let Some(symbol) = data.s
            && frame.topic.is_some_and(|topic| topic.starts_with("orderbook."))
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

fn plan_family(markets: &[Market], family: &str, url: &str) -> Vec<EndpointPlan> {
    let mut plans = Vec::new();
    for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
        plans.push(EndpointPlan {
            id: format!("{ID}#{family}#{i}"),
            url: url.to_string(),
            markets: slice.to_vec(),
        });
    }
    plans
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
    #[serde(borrow)]
    data: Option<BookData<'a>>,
    success: Option<bool>, // false is the only error signal a control frame gives
    ret_msg: Option<String>,
    op: Option<String>, // what the control frame answers: "subscribe" or "ping"
}

#[derive(Deserialize)]
struct BookData<'a> {
    #[serde(borrow)]
    s: Option<&'a str>,
    #[serde(default, deserialize_with = "wire::levels")]
    b: Vec<BookLevel>, // best first on a snapshot, changed levels only on a delta
    #[serde(default, deserialize_with = "wire::levels")]
    a: Vec<BookLevel>,
    u: Option<i64>, // plus one per delta
}
