mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::clock::now_ms;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use anchor::FundingState;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "gemini";

const REST: &str = "https://api.gemini.com";

// One address carries every product, and snapshot=-1 makes the first depthUpdate per symbol the whole book.
// The slash matters, because without it tungstenite sends an empty request path and gemini answers 400.
const PUBLIC_URL: &str = "wss://ws.gemini.com/?snapshot=-1";

// Changed levels every 100 ms, chained by U and u.
const STREAM_SUFFIX: &str = "@depth@100ms";

const DEPTH_EVENT: &str = "depthUpdate";
const STATUS_OK: i64 = 200;

pub struct Gemini {
    rest: String,
    markets: Vec<String>, // tracked raw ids, one riskstats request each per round
    clock: fn() -> i64,   // Unix ms, replaced in tests
    funding: Arc<Mutex<FundingState>>, // shared with the refresh task that runs beside the rounds
}

impl Gemini {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(markets, REST, now_ms)
    }

    fn with_rest(markets: &[TrackedMarket], rest: &str, clock: fn() -> i64) -> Self {
        Self {
            rest: rest.to_string(),
            markets: markets.iter().map(|tracked| tracked.market.raw_market_id.clone()).collect(),
            clock,
            funding: Arc::new(Mutex::new(FundingState::default())),
        }
    }
}

#[derive(Default)]
pub struct State {
    last_update_ids: HashMap<usize, i64>, // `u` of the last frame applied, by position
    request_id: u64,                      // the id of the last request this connection sent
}

impl State {
    fn next_request_id(&mut self) -> u64 {
        self.request_id += 1;
        self.request_id
    }
}

impl BookVenue for Gemini {
    type State = State;

    // The server pings every 20 s, and a quiet book stayed silent for 28 s.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(20)),
            ..FeedSettings::new(Duration::from_secs(60))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        if markets.is_empty() {
            return Vec::new();
        }

        vec![EndpointPlan {
            id: format!("{ID}#swap#0"),
            url: PUBLIC_URL.to_string(),
            markets: markets.to_vec(),
        }]
    }

    // One unknown stream name rejects the whole frame, so every name comes from the catalog.
    fn subscribe_frames(&self, markets: &[Market], state: &mut State) -> Vec<Message> {
        let mut params = Vec::with_capacity(markets.len());
        for market in markets {
            params.push(format!("{}{STREAM_SUFFIX}", market.raw_market_id));
        }
        let frame = serde_json::json!({ "id": state.next_request_id(), "method": "subscribe", "params": params });
        vec![Message::text(frame.to_string())]
    }

    fn ping(&self, state: &mut State) -> Message {
        Message::text(serde_json::json!({ "id": state.next_request_id(), "method": "ping" }).to_string())
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(frame)?;

        if frame.e == Some(DEPTH_EVENT)
            && let (Some(symbol), Some(first), Some(last)) = (frame.s, frame.first_update_id, frame.u)
        {
            apply_depth(symbol, first, last, &frame.b, &frame.a, conn);
            return Ok(());
        }

        if let Some(id) = &frame.id
            && frame.status != Some(STATUS_OK)
        {
            let error = frame.error.as_ref();
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                request = %id,
                status = frame.status.unwrap_or(0),
                code = error.map_or(0, |error| error.code),
                message = error.map_or("", |error| error.msg.as_str()),
            );
        }

        Ok(())
    }
}

fn apply_depth(symbol: &str, first: i64, last: i64, bids: &[BookLevel], asks: &[BookLevel], conn: &mut Connection<State>) {
    let Some(position) = conn.position(symbol) else {
        return;
    };

    // The snapshot carries no marker, and the subscribe acknowledgement can arrive before or after it.
    let applied = conn.state.last_update_ids.get(&position).copied();
    let Some(applied) = applied.filter(|_| conn.book(position).is_some()) else {
        conn.state.last_update_ids.insert(position, last);
        conn.reset_book(position, bids, asks);
        return;
    };

    if last <= applied {
        return;
    }

    // Ids come from one range across symbols, so only U against this symbol's own last u reveals a gap.
    if first > applied {
        conn.resync(symbol, "sequence_gap");
        return;
    }
    conn.state.last_update_ids.insert(position, last);

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

// Depth frames carry e, and control replies carry id and status instead.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    e: Option<&'a str>, // "depthUpdate"
    #[serde(borrow)]
    s: Option<&'a str>, // lowercase symbol, "btcusdcperp"
    #[serde(rename = "U")]
    first_update_id: Option<i64>, // equal to u on the snapshot
    u: Option<i64>,               // from one range every symbol shares
    #[serde(default, deserialize_with = "wire::levels")]
    b: Vec<BookLevel>, // absolute levels on the snapshot, changed levels after it, unsorted inside a frame
    #[serde(default, deserialize_with = "wire::levels")]
    a: Vec<BookLevel>,
    id: Option<serde_json::Value>, // echoed from the request, a number or a string
    status: Option<i64>,           // 200 on success
    error: Option<GeminiError>,
}

#[derive(Deserialize)]
struct GeminiError {
    #[serde(default)]
    code: i64, // -1013 for an unknown stream name
    #[serde(default)]
    msg: String,
}
