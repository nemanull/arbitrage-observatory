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
use anchor::Anchors;
use serde::Deserialize;
use serde_json::Value;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "hashkey";

const REST: &str = "https://api-glb.hashkey.com";

// v2 pushes the whole book about every 100 ms, while v1 conflates to 300 ms and arrives 130 to 160 ms later.
const URL: &str = "wss://stream-glb.hashkey.com/quote/ws/v2";
const TOPIC: &str = "depth";

// v2 sends no book on subscribe, so each acknowledged market is seeded from the REST book until the socket's first push.
// The call returns the whole book up to 200 levels, and these books held under 100 a side.
const DEPTH_PATH: &str = "/quote/v1/depth";
const SNAPSHOT_LEVELS: u32 = 200;

// Two markets are listed and no cap is published, and nine topics ran on one socket on 2026-09-23.
const MARKETS_PER_CONNECTION: usize = 50;

pub struct Hashkey {
    rest: String,
    tracked: Vec<String>, // raw ids, since the mark is read one market per call
    anchors: Mutex<Anchors>,
}

impl Hashkey {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(markets, REST)
    }

    fn with_rest(markets: &[TrackedMarket], rest: &str) -> Self {
        let mut tracked = Vec::with_capacity(markets.len());
        for market in markets {
            tracked.push(market.market.raw_market_id.clone());
        }

        Self {
            rest: rest.to_string(),
            tracked,
            anchors: Mutex::new(Anchors::default()),
        }
    }
}

impl BookVenue for Hashkey {
    type State = HashMap<usize, u64>; // the part of `v` before '_' of the last push applied, by position

    // v2 closes a socket after about 31 s without a client frame, even while it streams, and the docs ask for a ping every 10 s.
    // A quiet book sent nothing for up to 8.5 s on 2026-10-09, so the pong is the traffic the silence check relies on, and 25 s is two missed pongs.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(10)),
            ..FeedSettings::new(Duration::from_secs(25))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#perp#{i}"),
                url: URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // v2 refuses a comma list of symbols with "Parameter error!", so each market takes its own frame.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for market in markets {
            let frame = serde_json::json!({ "topic": TOPIC, "event": "sub", "params": { "symbol": market.raw_market_id } });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    // The pong carries the server's clock whatever the ping carries.
    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text(serde_json::json!({ "ping": now_ms() }).to_string())
    }

    // The envelope is read first, because an unsubscribed topic such as bbo spells its levels another way.
    fn handle(&self, bytes: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(bytes)?;

        if frame.topic.as_deref() == Some(TOPIC) && frame.code.is_none() {
            let push: Push = serde_json::from_slice(bytes)?;
            apply_book(&push.data, conn);
            return Ok(());
        }

        if frame.pong.is_some() {
            return Ok(());
        }

        if let Some(code) = frame.code.as_ref().map(code_text) {
            let symbol = frame.params.as_ref().and_then(|params| params.symbol.as_deref()).unwrap_or("");
            if code == "0" {
                acknowledge(&frame, symbol, conn);
            } else {
                // A v2 error names its request, while an error on a frame that was not JSON carries only a code.
                tracing::error!(
                    event = "venue_error",
                    connection = conn.id(),
                    topic = frame.topic.as_deref().unwrap_or(""),
                    request = frame.event.as_deref().unwrap_or(""),
                    market = symbol,
                    code = %code,
                    message = frame.msg.as_deref().or(frame.desc.as_deref()).unwrap_or(""),
                );
            }
            return Ok(());
        }

        tracing::warn!(event = "venue_notice", connection = conn.id(), frame = %summary(&frame));
        Ok(())
    }

    fn snapshot_url(&self, market: &Market) -> Option<String> {
        Some(format!(
            "{}{DEPTH_PATH}?symbol={}&limit={SNAPSHOT_LEVELS}",
            self.rest, market.raw_market_id
        ))
    }

    // A push that came first is newer than any REST book, so the seed fills only a market the socket has not served yet.
    fn handle_snapshot(&self, position: usize, body: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let snapshot: Snapshot = serde_json::from_slice(body)?;
        if conn.book(position).is_some() {
            return Ok(());
        }

        conn.reset_book(position, &snapshot.b, &snapshot.a);
        Ok(())
    }
}

// The acknowledgement of a book subscribe asks for the market's seed, and the venue acknowledges a duplicate too.
fn acknowledge(frame: &Frame, symbol: &str, conn: &mut Connection<HashMap<usize, u64>>) {
    if frame.topic.as_deref() != Some(TOPIC) || frame.event.as_deref() != Some("sub") {
        tracing::debug!(event = "venue_ack", connection = conn.id(), topic = frame.topic.as_deref().unwrap_or(""), market = symbol);
        return;
    }

    let Some(position) = conn.position(symbol) else {
        return;
    };
    if conn.book(position).is_none() {
        conn.request_snapshot(position);
    }
}

// Every push is the whole book, so no push depends on the one before it.
// A repeat of the last version is the same book, and the probes saw the version rise on every other push.
// A version that goes back means the venue's counter restarted or a push came out of order, and dropping every later push would freeze the book, so the connection is reseeded.
fn apply_book(book: &Book, conn: &mut Connection<HashMap<usize, u64>>) {
    let Some(position) = conn.position(&book.s) else {
        return;
    };

    let version = version_of(&book.v);
    if let (Some(version), Some(&last)) = (version, conn.state.get(&position)) {
        if version == last {
            tracing::debug!(event = "repeated_push_dropped", connection = conn.id(), market = %book.s, version);
            return;
        }
        if version < last {
            conn.resync(&book.s, "version went back");
            return;
        }
    }
    if let Some(version) = version {
        conn.state.insert(position, version);
    }

    conn.reset_book(position, &book.b, &book.a);
}

// "14088520_1" is version 14088520, and the part after '_' changes between v1 and v2 and means nothing here.
fn version_of(v: &str) -> Option<u64> {
    v.split('_').next()?.parse().ok()
}

// Every code seen on the socket was a string, while the REST quote calls send numbers, so either is read.
fn code_text(code: &Value) -> String {
    match code {
        Value::String(text) => text.clone(),
        other => other.to_string(),
    }
}

fn summary(frame: &Frame) -> String {
    format!("topic {:?} event {:?}", frame.topic, frame.event)
}

// Books, acknowledgements, errors and pongs share the envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame {
    topic: Option<String>, // "depth"
    event: Option<String>, // "sub" or "cancel" on an acknowledgement or a request error
    params: Option<Params>,
    code: Option<Value>, // "0" on an acknowledgement, "-100011" on a v2 request error, "-10001" on text that is not JSON
    msg: Option<String>,  // "Success" or "Parameter error!"
    desc: Option<String>, // "Invalid topic!", where a v1 style error puts its message
    pong: Option<i64>,    // the server's clock in ms
}

#[derive(Deserialize)]
struct Push {
    data: Book,
}

#[derive(Deserialize)]
struct Params {
    symbol: Option<String>,
}

#[derive(Deserialize)]
struct Book {
    #[serde(default)]
    s: String, // "BTCUSDT-PERPETUAL"
    #[serde(default)]
    v: String, // "14088520_1"
    // Required, since a push names every level and a missing side would publish a one sided book.
    #[serde(deserialize_with = "wire::levels")]
    b: Vec<BookLevel>, // whole contracts, best first
    #[serde(deserialize_with = "wire::levels")]
    a: Vec<BookLevel>,
}

#[derive(Deserialize)]
struct Snapshot {
    #[serde(deserialize_with = "wire::levels")]
    b: Vec<BookLevel>,
    #[serde(deserialize_with = "wire::levels")]
    a: Vec<BookLevel>,
}
