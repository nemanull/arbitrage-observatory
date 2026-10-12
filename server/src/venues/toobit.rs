mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::clock::now_ms;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "toobit";

const REST: &str = "https://api.toobit.com";

// One socket carries USDT-M, USDC-M and spot alike, keyed by the symbol alone.
const PUBLIC_URL: &str = "wss://stream.toobit.com/quote/ws/v1";

// The whole book of about 240 levels as a snapshot on subscribe, then deltas of absolute sizes about 3 times a second.
// No smaller depth exists, since the limit parameter is ignored.
const TOPIC: &str = "diffDepth";

// 300 streams ran on one socket with no gap at about 330 frames a second on 2026-09-22, and no cap is published.
const MARKETS_PER_CONNECTION: usize = 300;

pub struct Toobit {
    rest: String,
    index_tokens: Mutex<anchor::IndexTokens>,
}

impl Toobit {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self {
            rest: rest.to_string(),
            index_tokens: Mutex::new(anchor::IndexTokens::default()),
        }
    }
}

impl BookVenue for Toobit {
    type State = HashMap<usize, i64>; // `o` of the last delta applied since the market's snapshot, by position

    // The server sends no ping and closes a socket 60 s after its last frame, and a quiet book went 60 s without one.
    // So the pong is the traffic the silence check relies on, and two missed pongs is a dead socket.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(20)),
            ..FeedSettings::new(Duration::from_secs(45))
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

    // A space after a comma invalidates the next id, so the ids are joined bare.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut ids = Vec::with_capacity(markets.len());
        for market in markets {
            ids.push(market.raw_market_id.as_str());
        }
        let frame = serde_json::json!({ "symbol": ids.join(","), "topic": TOPIC, "event": "sub", "params": { "binary": false } });
        vec![Message::text(frame.to_string())]
    }

    // The documented keepalive, which the server answers with {"pong": <its own clock>}.
    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text(serde_json::json!({ "ping": now_ms() }).to_string())
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(frame)?;

        if frame.topic.as_deref() == Some(TOPIC)
            && let Some(symbol) = frame.symbol.as_deref()
        {
            for depth in frame.data.iter().flatten() {
                apply_book(symbol, frame.f == Some(true), depth, conn);
            }
            return Ok(());
        }

        if frame.pong.is_some() {
            return Ok(());
        }

        // An error names neither the symbol nor the topic, so a market it refused shows up as book_unserved.
        if let Some(code) = &frame.code {
            // A string on every error seen, and a number is printed as it came.
            let code = code.as_str().map_or_else(|| code.to_string(), str::to_string);
            tracing::error!(event = "venue_error", connection = conn.id(), code, message = frame.desc.as_deref().unwrap_or(""));
        } else {
            tracing::warn!(event = "venue_notice", connection = conn.id(), topic = frame.topic.as_deref().unwrap_or(""));
        }

        Ok(())
    }
}

// The undocumented `o` counts deltas per symbol, and the snapshot's `o` of 0 is a marker, not a base.
// So the first delta after a snapshot sets the base, and each later one must be the next count.
fn apply_book(symbol: &str, snapshot: bool, depth: &Depth, conn: &mut Connection<HashMap<usize, i64>>) {
    let Some(position) = conn.position(symbol) else {
        return;
    };

    if snapshot {
        conn.state.remove(&position);
        conn.reset_book(position, &depth.b, &depth.a);
        return;
    }

    if conn.book(position).is_none() {
        conn.resync(symbol, "delta_before_snapshot");
        return;
    }
    let Some(o) = depth.o else {
        conn.resync(symbol, "delta_without_sequence");
        return;
    };
    if let Some(&last) = conn.state.get(&position)
        && o != last + 1
    {
        conn.resync(symbol, "sequence_gap");
        return;
    }
    conn.state.insert(position, o);

    if depth.b.is_empty() && depth.a.is_empty() {
        return;
    }

    let Some(book) = conn.book(position) else {
        return;
    };
    for level in &depth.b {
        book.set_bid(level.price, level.size);
    }
    for level in &depth.a {
        book.set_ask(level.price, level.size);
    }
    conn.publish(position);
}

// Books, pongs and errors share no envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    topic: Option<Cow<'a, str>>, // "diffDepth" on a book
    #[serde(borrow)]
    symbol: Option<Cow<'a, str>>, // "BTC-SWAP-USDT", one per book frame
    data: Option<Vec<Depth>>, // one entry per book frame, null on a pong or an error
    f: Option<bool>, // true on the snapshot, false on a delta
    pong: Option<serde_json::Value>,
    code: Option<serde_json::Value>, // "-100010" on an error
    desc: Option<String>, // "Invalid Symbols!"
}

#[derive(Deserialize)]
struct Depth {
    #[serde(default, deserialize_with = "wire::levels")]
    b: Vec<BookLevel>, // [price, contracts] strings, best first, and "0" deletes the level
    #[serde(default, deserialize_with = "wire::levels")]
    a: Vec<BookLevel>,
    o: Option<i64>, // 0 on the snapshot, the per symbol delta count on a delta
}
