mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::de::{self, Deserialize, Deserializer, SeqAccess, Visitor};
use std::borrow::Cow;
use std::fmt;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "hibt";

const REST: &str = "https://fapi.hibt0.com/open-api";

// One URL carries every contract, crypto, commodity and equity alike.
const PUBLIC_URL: &str = "wss://fapi.hibt0.com/v2/ws";

// A whole book of 20 levels a side on every push, every 200 ms on BTC and ETH and up to about 800 ms on the others.
// The topic is "<raw id>.20deep", and the push carries that topic as its type.
const DEPTH_SUFFIX: &str = ".20deep";

// All 82 contracts ran on one socket at about 200 frames a second, and no cap is published.
const MARKETS_PER_CONNECTION: usize = 100;

pub struct Hibt {
    rest: String,
}

impl Hibt {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self { rest: rest.to_string() }
    }
}

impl BookVenue for Hibt {
    type State = ();

    // The server pings every 54 s and answers a protocol ping with a pong, so a ping every 15 s adds traffic the silence check can count.
    // The slowest contract still sends a whole book about every 800 ms, so 10 s of silence is a dead socket.
    // A JSON frame without an "event" key drops the socket, so the ping stays a protocol ping.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(15)),
            ..FeedSettings::new(Duration::from_secs(10))
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

    // Topics joined by commas in one frame are acknowledged as one and each delivers.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut ()) -> Vec<Message> {
        let mut topics = Vec::with_capacity(markets.len());
        for market in markets {
            topics.push(format!("{}{DEPTH_SUFFIX}", market.raw_market_id));
        }
        let frame = serde_json::json!({ "event": "sub", "topic": topics.join(",") });
        vec![Message::text(frame.to_string())]
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<()>) -> anyhow::Result<()> {
        let envelope: Envelope = serde_json::from_slice(frame)?;

        if let Some(raw_id) = envelope.kind.strip_suffix(DEPTH_SUFFIX) {
            let push: Push = serde_json::from_slice(frame)?;
            if let Some(depth) = &push.data {
                apply_book(raw_id, depth, conn);
            }
            return Ok(());
        }

        match envelope.kind.as_ref() {
            // The greeting on open.
            "hello" => {}
            "sub" => {
                let ack: Ack = serde_json::from_slice(frame)?;
                // An unknown or closed topic is acknowledged ok too, so only a malformed request reads as an error.
                match ack.data {
                    AckData::Topic { status, .. } if status == "ok" => {}
                    AckData::Topic { topic, status } => {
                        tracing::error!(event = "venue_error", connection = conn.id(), kind = "sub", topic, status);
                    }
                    AckData::Message(message) => {
                        tracing::error!(event = "venue_error", connection = conn.id(), kind = "sub", message);
                    }
                }
            }
            kind => tracing::warn!(event = "venue_notice", connection = conn.id(), kind),
        }

        Ok(())
    }
}

// Every push is the whole book, with no sequence or checksum, so a lost frame heals on the next one.
// About a third of busy pushes repeat the last one exactly, and each still confirms the book is current.
fn apply_book(raw_id: &str, depth: &Depth, conn: &mut Connection<()>) {
    let Some(position) = conn.position(raw_id) else {
        return;
    };

    conn.reset_book(position, &depth.bids, &depth.asks);
}

#[derive(serde::Deserialize)]
struct Envelope<'a> {
    #[serde(borrow, rename = "type")]
    kind: Cow<'a, str>, // "btc_usdt.20deep" on a push, "hello", "sub" or "unsub" otherwise
}

#[derive(serde::Deserialize)]
struct Push {
    data: Option<Depth>,
}

#[derive(serde::Deserialize)]
struct Depth {
    #[serde(default, deserialize_with = "flat_levels")]
    bids: Vec<BookLevel>, // best first
    #[serde(default, deserialize_with = "flat_levels")]
    asks: Vec<BookLevel>,
}

#[derive(serde::Deserialize)]
struct Ack {
    data: AckData,
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum AckData {
    Topic { topic: String, status: String }, // {"topic":"btc_usdt.20deep","status":"ok"}
    Message(String),                         // "error topic"
}

// A flat array of price then size, ["86711","0.722","86711.2","0.406"], with small numbers in exponent form such as "6.178e-06".
fn flat_levels<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<BookLevel>, D::Error> {
    deserializer.deserialize_any(FlatLevels)
}

struct FlatLevels;

impl<'de> Visitor<'de> for FlatLevels {
    type Value = Vec<BookLevel>;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a flat array of price then size, or null")
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(Vec::new())
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        let mut levels = Vec::with_capacity(seq.size_hint().unwrap_or(0) / 2);
        while let Some(Num(price)) = seq.next_element()? {
            let Some(Num(size)) = seq.next_element()? else {
                return Err(de::Error::custom("a price with no size"));
            };
            levels.push(BookLevel { price, size });
        }
        Ok(levels)
    }
}

struct Num(f64);

impl<'de> Deserialize<'de> for Num {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        wire::num(deserializer).map(Num)
    }
}
