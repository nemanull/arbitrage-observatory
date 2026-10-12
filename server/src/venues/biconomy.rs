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

pub const ID: &str = "biconomy";

const REST: &str = "https://openapi.biconomy.com";

// The futures web app's socket, MEXC's contract protocol with renamed methods, one URL for every contract.
const PUBLIC_URL: &str = "wss://openapi.biconomy.com/future/websocket";

// A whole top 20 on a tick of about 365 ms, sent only when the book changed, so a frame needs no gap rule.
// Nothing comes on subscribe, so a quiet book stays empty until it changes, which can take over 30 s.
const SUBSCRIBE_METHOD: &str = "subscribe.depth.full";
const PUSH_CHANNEL: &str = "push.depth.full";
const ERROR_CHANNEL: &str = "response.error";
const ACK_PREFIX: &str = "response.subscribe";
const PONG_CHANNEL: &str = "pong";
const CLIENT_ID_CHANNEL: &str = "clientId"; // sent once after the first pong on a socket

const DEPTH: usize = 20; // limits 5, 10, 20, 50 and 100 are served, and 30 is refused

const DEPTH_PATH: &str = "/future/api/v1/depth";

// 295 contracts ran on one socket at 377 frames a second on 2026-09-23, and no cap is published, so half that leaves room.
const MARKETS_PER_CONNECTION: usize = 150;

// Most books push within a second of the subscribe and 281 of 295 within 5 s, so only a book still empty this long after the first frame is read from REST.
const SEED_AFTER_MS: i64 = 3_000;

pub struct Biconomy {
    rest: String,
}

impl Biconomy {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self { rest: rest.to_string() }
    }
}

#[derive(Default)]
pub struct State {
    versions: HashMap<usize, i64>, // `version` of the push or snapshot last applied, by position
    pushed: HashMap<usize, i64>, // `version` of the last push, by position
    first_frame_at: Option<i64>, // arrival of the connection's first frame, in Unix ms
    seeded: bool, // the quiet books' snapshots were requested
}

impl BookVenue for Biconomy {
    type State = State;

    // A socket with no client frame closed at 60 s, and a quiet book sent nothing for 30.5 s, so the pong is the traffic the silence check counts.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(15)),
            // The spot docs publish 20 market calls a second per IP and the futures host none, so three connections stay near 12 a second.
            snapshot_gap: Duration::from_millis(250),
            // The quiet books are requested 3 s after the first frame and fetched a gap apart, so the unserved check waits past that.
            first_book_wait: Duration::from_secs(20),
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

    // One contract per frame, which the protocol requires, and 295 frames sent in one burst were all acknowledged.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for market in markets {
            let frame = serde_json::json!({ "method": SUBSCRIBE_METHOD, "params": { "symbol": market.raw_market_id, "limit": DEPTH } });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn ping(&self, _state: &mut State) -> Message {
        Message::text(r#"{"method":"ping"}"#)
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
        // The envelope first, because data is a book on a push, text on an acknowledgement or an error, and a number on a pong.
        let envelope: Envelope = serde_json::from_slice(frame)?;

        match envelope.channel {
            Some(PUSH_CHANNEL) => handle_push(frame, envelope.symbol, conn)?,
            // The error names the contract only in its text, and the acknowledgement names nothing.
            Some(ERROR_CHANNEL) => {
                let error: TextFrame = serde_json::from_slice(frame)?;
                tracing::error!(event = "venue_error", connection = conn.id(), message = %error.text());
            }
            Some(PONG_CHANNEL | CLIENT_ID_CHANNEL) => {}
            Some(channel) if channel.starts_with(ACK_PREFIX) => {}
            _ => tracing::warn!(event = "venue_notice", connection = conn.id(), frame = %String::from_utf8_lossy(frame)),
        }

        seed_quiet_books(conn);
        Ok(())
    }

    fn snapshot_url(&self, market: &Market) -> Option<String> {
        Some(format!("{}{DEPTH_PATH}/{}?limit={DEPTH}", self.rest, market.raw_market_id))
    }

    // An error arrives inside an HTTP 200 with success false, as an unknown contract's code 1001 does.
    fn handle_snapshot(&self, position: usize, body: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
        let reply: SnapshotReply = serde_json::from_slice(body)?;
        let data = match reply.data {
            Some(data) if reply.success && reply.code == 0 => data,
            _ => anyhow::bail!("depth code {}: {}", reply.code, reply.message),
        };

        apply(position, data, conn);
        Ok(())
    }
}

// Requests the REST book of every market still without one, once per connection, after the books that move have pushed.
fn seed_quiet_books(conn: &mut Connection<State>) {
    let now = conn.frame_recv_ts();
    let first = *conn.state.first_frame_at.get_or_insert(now);
    if conn.state.seeded || now - first < SEED_AFTER_MS {
        return;
    }
    conn.state.seeded = true;

    let mut requested = 0;
    for position in 0..conn.markets().len() {
        if conn.book(position).is_none() {
            conn.request_snapshot(position);
            requested += 1;
        }
    }
    tracing::info!(event = "book_seeding", connection = conn.id(), requested, markets = conn.markets().len());
}

fn handle_push(frame: &[u8], symbol: Option<&str>, conn: &mut Connection<State>) -> anyhow::Result<()> {
    let Some(symbol) = symbol else {
        anyhow::bail!("push without a symbol");
    };
    let Some(position) = conn.position(symbol) else {
        return Ok(());
    };

    // A lost push leaves the book wrong until its next change, which can be 30 s away on a quiet book.
    let push: Push = match serde_json::from_slice(frame) {
        Ok(push) => push,
        Err(error) => {
            conn.resync(symbol, "unreadable_push");
            return Err(error.into());
        }
    };

    apply_push(position, symbol, push.data, conn);
    Ok(())
}

// Pushes rose on every frame of every probe, so a push below the last one means the venue's counter restarted.
// Dropping every later push would then freeze the book, so the connection is reseeded instead.
// A push below a REST book but above the last push left the venue before that read, and apply drops it.
fn apply_push(position: usize, symbol: &str, data: DepthData, conn: &mut Connection<State>) {
    if conn.state.pushed.get(&position).is_some_and(|&last| data.version < last) {
        conn.resync(symbol, "version_went_back");
        return;
    }

    conn.state.pushed.insert(position, data.version);
    apply(position, data, conn);
}

// A push and a REST book share one version counter, so whichever is newer wins and an older one is dropped.
// The connection's first book for a contract takes any version, so a venue counter reset heals on reconnect.
fn apply(position: usize, data: DepthData, conn: &mut Connection<State>) {
    if let Some(&last) = conn.state.versions.get(&position)
        && conn.book(position).is_some()
        && data.version <= last
    {
        return;
    }

    conn.state.versions.insert(position, data.version);
    conn.reset_book(position, &data.bids, &data.asks);
}

#[derive(Deserialize)]
struct Envelope<'a> {
    #[serde(borrow)]
    channel: Option<&'a str>, // "push.depth.full", "response.subscribe.depth.full", "response.error", "pong" or "clientId"
    #[serde(borrow, rename = "s")]
    symbol: Option<&'a str>, // "BTC_USDT", on push frames only
}

#[derive(Deserialize)]
struct Push {
    data: DepthData,
}

#[derive(Deserialize)]
struct SnapshotReply {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    code: i64,
    #[serde(default)]
    message: String,
    data: Option<DepthData>,
}

// Every field is required, because a book missing a side would publish as one sided.
#[derive(Deserialize)]
struct DepthData {
    #[serde(deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // [price, contracts, orders], descending
    #[serde(deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
    version: i64, // the book counter, 0 on a delisted contract's REST book
}

#[derive(Deserialize)]
struct TextFrame {
    #[serde(default)]
    data: serde_json::Value,
}

impl TextFrame {
    fn text(&self) -> String {
        match &self.data {
            serde_json::Value::String(text) => text.clone(),
            other => other.to_string(),
        }
    }
}
