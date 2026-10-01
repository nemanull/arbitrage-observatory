mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "mexc";

const REST: &str = "https://api.mexc.com";

// One socket carries the USDT, USDC and coin margined contracts alike.
const PUBLIC_URL: &str = "wss://contract.mexc.com/edge";

// A whole top of book on every push, about every 300 ms, so a frame needs no seed and no gap rule.
// The merged incremental channel is about 100 ms sooner and needs a REST seed per contract.
const SUBSCRIBE_METHOD: &str = "sub.depth.full";
const PUSH_CHANNEL: &str = "push.depth.full";
const ERROR_CHANNEL: &str = "rs.error";

const DEPTH: usize = 20; // must stay at or above DEPTH_LEVEL

const MARKETS_PER_CONNECTION: usize = 150; // 150 contracts ran on one socket with no refusal on 2026-09-15, and MEXC publishes no cap

pub struct Mexc {
    rest: String,
}

impl Mexc {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self { rest: rest.to_string() }
    }
}

#[derive(Default)]
pub struct State {
    versions: HashMap<usize, i64>, // `version` of the last frame applied, by position
    warned_binary: bool,
}

impl BookVenue for Mexc {
    type State = State;

    // The server closed a socket that sent no ping after about 60 s even while depth flowed, so traffic does not replace the ping.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(15)),
            // One contract per frame and no published message rate, so frames go out at the 20 a second the probe sent.
            subscribe_gap: Duration::from_millis(50),
            ..FeedSettings::new(Duration::from_secs(45))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#swap#{i}"),
                url: PUBLIC_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // No gzip key is sent, and every frame arrived as text without one.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for market in markets {
            let frame = serde_json::json!({ "method": SUBSCRIBE_METHOD, "param": { "symbol": market.raw_market_id, "limit": DEPTH } });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn ping(&self, _state: &mut State) -> Message {
        Message::text(r#"{"method":"ping"}"#)
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
        // The docs imply a gzip frame is possible, which would fail to parse on every push, so anything that does not open as a JSON object is dropped.
        if frame.first() != Some(&b'{') {
            if !conn.state.warned_binary {
                conn.state.warned_binary = true;
                tracing::warn!(event = "binary_frame_dropped", connection = conn.id(), bytes = frame.len());
            }
            return Ok(());
        }

        // The envelope first, because data is a book on a push, text on an acknowledgement or an error, and a number on a pong.
        let envelope: Envelope = serde_json::from_slice(frame)?;

        match envelope.channel {
            Some(PUSH_CHANNEL) => {
                let Some(symbol) = envelope.symbol else {
                    return Ok(());
                };
                let push: Push = serde_json::from_slice(frame)?;
                apply_book(symbol, push.data, conn);
            }
            // The error names the contract only in its text, and the success acknowledgement names nothing.
            Some(ERROR_CHANNEL) => {
                let error: ErrorFrame = serde_json::from_slice(frame)?;
                let message = match &error.data {
                    serde_json::Value::String(text) => text.clone(),
                    other => other.to_string(),
                };
                tracing::error!(event = "venue_error", connection = conn.id(), message);
            }
            _ => {}
        }

        Ok(())
    }
}

fn apply_book(symbol: &str, data: DepthData, conn: &mut Connection<State>) {
    let Some(position) = conn.position(symbol) else {
        return;
    };

    // The connection's first frame for a contract takes any version, so a venue counter reset heals on reconnect.
    if let Some(&last) = conn.state.versions.get(&position)
        && conn.book(position).is_some()
        && data.version < last
    {
        return;
    }

    conn.state.versions.insert(position, data.version);
    conn.reset_book(position, &data.bids, &data.asks);
}

#[derive(Deserialize)]
struct Envelope<'a> {
    #[serde(borrow)]
    channel: Option<&'a str>, // "push.depth.full", "rs.sub.depth.full", "rs.error" or "pong"
    #[serde(borrow)]
    symbol: Option<&'a str>, // "BTC_USDT", on push frames only
}

#[derive(Deserialize)]
struct Push {
    data: DepthData,
}

#[derive(Deserialize)]
struct DepthData {
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // [price, contracts, order count], descending
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
    #[serde(default)]
    version: i64, // the venue's book counter, which never went backwards on this channel
}

#[derive(Deserialize)]
struct ErrorFrame {
    #[serde(default)]
    data: serde_json::Value,
}
