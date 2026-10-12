mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "weex";

const REST: &str = "https://api-contract.weex.com";

// One socket carries every perpetual, crypto and TradFi alike.
const PUBLIC_URL: &str = "wss://ws-contract.weex.com/v3/ws/public";

// Only 15 and 200 levels exist, so 200 is the smallest depth of at least 20.
// A snapshot comes on subscribe, then deltas conflated to one frame per 500 ms.
const CHANNEL: &str = "depth200";

// The documented cap is 100 streams a connection, and 20 connections an IP, which 1,036 contracts fit in 11.
const MARKETS_PER_CONNECTION: usize = 100;

// The documentation says the firewall blocks a socket without a User-Agent, although the wire accepted none.
const HEADERS: &[(&str, &str)] = &[("User-Agent", "arbitrage-observatory")];

pub struct Weex {
    rest: String,
    indexes: Mutex<HashMap<String, anchor::IndexWatch>>, // by raw id, to hold out an index that stopped moving
}

impl Weex {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self {
            rest: rest.to_string(),
            indexes: Mutex::new(HashMap::new()),
        }
    }
}

#[derive(Default)]
pub struct State {
    last: HashMap<usize, u64>,          // `u` of the last frame applied, by position
    dead: HashSet<usize>,               // positions already logged for an empty snapshot with `u` 0
    next_id: u64,                       // the id of the next client frame
    pending: HashMap<u64, Vec<String>>, // the raw ids of each subscribe frame not yet acknowledged, by its id
}

impl State {
    fn take_id(&mut self) -> u64 {
        self.next_id += 1;
        self.next_id
    }

    fn subscribe(&mut self, raw_ids: Vec<String>) -> Message {
        let id = self.take_id();
        let mut params = Vec::with_capacity(raw_ids.len());
        for raw_id in &raw_ids {
            params.push(format!("{raw_id}@{CHANNEL}"));
        }
        self.pending.insert(id, raw_ids);
        Message::text(serde_json::json!({ "method": "SUBSCRIBE", "params": params, "id": id }).to_string())
    }
}

impl BookVenue for Weex {
    type State = State;

    // The server pings once a minute and closed no socket that left it unanswered, so the client ping's ack is the traffic a quiet slice relies on.
    // On 2026-10-09 a socket took 254 client frames in two minutes without a close, so pings do not spend the 240 operations an hour.
    // About 100 frames inside 5 s did close one, so nothing here bursts.
    // A slice of closed stock books can go quiet for minutes, so three missed acks are a dead socket.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(15)),
            // 300 handshakes an IP in 5 minutes, so a staggered open keeps a reconnect storm far below it.
            connect_stagger: Duration::from_millis(500),
            headers: HEADERS,
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

    // A frame of 100 streams is acknowledged as one, and it spends one operation of the hourly budget.
    fn subscribe_frames(&self, markets: &[Market], state: &mut State) -> Vec<Message> {
        let mut raw_ids = Vec::with_capacity(markets.len());
        for market in markets {
            raw_ids.push(market.raw_market_id.clone());
        }
        vec![state.subscribe(raw_ids)]
    }

    // Acknowledged as {"result":true,"id":n}.
    fn ping(&self, state: &mut State) -> Message {
        Message::text(serde_json::json!({ "method": "PING", "id": state.take_id() }).to_string())
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(frame)?;

        if let Some(kind) = frame.e.as_deref() {
            match kind {
                "depthSnapshot" => apply_snapshot(&frame, conn),
                "depth" => apply_delta(&frame, conn),
                _ => tracing::warn!(event = "venue_notice", connection = conn.id(), kind),
            }
            return Ok(());
        }

        match (frame.event.as_deref(), frame.result) {
            // The server ping, which the documentation says must be answered.
            (Some("ping"), _) => {
                let id = conn.state.take_id();
                conn.send(Message::text(serde_json::json!({ "method": "PONG", "id": id }).to_string()));
            }
            (Some("connected"), _) => {}
            (None, Some(true)) => {
                if let Some(id) = frame.id {
                    conn.state.pending.remove(&id);
                }
            }
            (None, Some(false)) => {
                let message = frame.msg.as_deref().unwrap_or("");
                tracing::error!(event = "venue_error", connection = conn.id(), id = frame.id.unwrap_or(0), message);
                if let Some(id) = frame.id {
                    subscribe_after_refusal(id, message, conn);
                }
            }
            (event, _) => tracing::warn!(event = "venue_notice", connection = conn.id(), kind = event.unwrap_or("")),
        }

        Ok(())
    }
}

// The server stops reading a subscribe frame at its first unknown symbol, so the streams named after it are sent again.
// A symbol is unknown once it leaves the catalog, which can happen while a run holds the catalog it read at boot.
fn subscribe_after_refusal(id: u64, message: &str, conn: &mut Connection<State>) {
    let Some(raw_ids) = conn.state.pending.remove(&id) else {
        return;
    };
    let Some((_, symbol)) = message.split_once("invalid symbol : cmt_") else {
        return;
    };
    let Some(refused) = raw_ids.iter().position(|raw_id| raw_id.to_lowercase() == symbol.trim()) else {
        return;
    };

    let rest = raw_ids[refused + 1..].to_vec();
    if rest.is_empty() {
        return;
    }
    tracing::warn!(event = "venue_notice", connection = conn.id(), market = %raw_ids[refused], reason = "unknown_symbol", resent = rest.len());
    let frame = conn.state.subscribe(rest);
    conn.send(frame);
}

// A snapshot replaces the book whenever it comes, and is the start of the id chain.
fn apply_snapshot(frame: &Frame, conn: &mut Connection<State>) {
    let Some(symbol) = frame.s.as_deref() else {
        return;
    };
    let Some(position) = conn.position(symbol) else {
        return;
    };
    let u = frame.u.unwrap_or(0);

    // A contract with no order at all, delisted or never opened, is served one empty snapshot with `u` 0 and nothing after it.
    // Its book is empty, which the engine reads as no price, and a delta that follows starts the chain over.
    if u == 0 && frame.b.is_empty() && frame.a.is_empty() {
        if conn.state.dead.insert(position) {
            tracing::warn!(event = "venue_notice", connection = conn.id(), market = symbol, reason = "empty_snapshot");
        }
        conn.state.last.remove(&position);
        conn.reset_book(position, &[], &[]);
        return;
    }

    conn.state.last.insert(position, u);
    conn.reset_book(position, &frame.b, &frame.a);
}

// A delta's `U` equals the `u` of the frame before it, not that `u` plus one.
fn apply_delta(frame: &Frame, conn: &mut Connection<State>) {
    let Some(symbol) = frame.s.as_deref() else {
        return;
    };
    let Some(position) = conn.position(symbol) else {
        return;
    };

    let Some(&last) = conn.state.last.get(&position) else {
        conn.resync(symbol, "delta_before_snapshot");
        return;
    };
    if frame.first_update_id != Some(last) {
        conn.resync(symbol, "sequence_gap");
        return;
    }
    conn.state.last.insert(position, frame.u.unwrap_or(0));

    let Some(book) = conn.book(position) else {
        return;
    };
    // One delta can delete a bid and add an ask at one price, so the whole frame is applied before the book goes out.
    for level in &frame.b {
        book.set_bid(level.price, level.size);
    }
    for level in &frame.a {
        book.set_ask(level.price, level.size);
    }
    conn.publish(position);
}

// Books, the greeting, pings, acknowledgements and errors share no envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    e: Option<Cow<'a, str>>, // "depthSnapshot" or "depth" on a book
    #[serde(borrow)]
    s: Option<Cow<'a, str>>, // "BTCUSDT", the raw id, and a contract id can be spelled outside ASCII
    #[serde(rename = "U")]
    first_update_id: Option<u64>,
    u: Option<u64>,
    #[serde(default, deserialize_with = "wire::levels")]
    b: Vec<BookLevel>, // [price, coins] strings, best first
    #[serde(default, deserialize_with = "wire::levels")]
    a: Vec<BookLevel>,
    #[serde(borrow)]
    event: Option<Cow<'a, str>>, // "connected" on open, "ping" from the server
    result: Option<bool>, // on an acknowledgement, false on a refusal
    id: Option<u64>,
    msg: Option<String>, // "INVALID_ARGUMENT: invalid symbol : cmt_nopeusdt" on a refusal
}
