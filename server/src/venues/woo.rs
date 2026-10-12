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
use std::collections::{HashMap, VecDeque};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "woo";

const REST: &str = "https://api.woox.io";

// One public socket carries every perpetual.
const URL: &str = "wss://wss.woox.io/v3/public";

// Deltas of the book without RPI orders, which are the only orders an API taker can fill.
// The socket never sends a snapshot, so every book is seeded from the REST book.
const TOPIC_PREFIX: &str = "orderbookupdate@";
const TOPIC_SUFFIX: &str = "@50";

// The REST book's maxLevel, and no perpetual held more than 64 levels a side on 2026-10-08, so the reply is the whole side.
const SNAPSHOT_LEVELS: usize = 1000;
const ORDERBOOK_PATH: &str = "/v3/public/orderbook";

// The venue caps 100 topics a connection, but a gap reseeds every market on its connection, so connections stay small.
const MARKETS_PER_CONNECTION: usize = 50;

// Eleven or more topics in one frame are refused whole, although the docs say 20.
const TOPICS_PER_FRAME: usize = 10;

// A market waiting for its snapshot keeps at most this many deltas, and a seed older than the oldest kept one is fetched again.
const MAX_HELD_DELTAS: usize = 500;

// A snapshot behind the socket is fetched again, and logged on the first miss and every tenth.
const SNAPSHOT_BEHIND_LOG_EVERY: u32 = 10;

// A reply that carried no book is logged on the first failure and every 30th, as the runtime logs a failed fetch.
const SNAPSHOT_FAILURE_LOG_EVERY: u32 = 30;

pub struct Woo {
    rest: String,
}

impl Woo {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self { rest: rest.to_string() }
    }
}

#[derive(Default)]
pub struct State {
    books: HashMap<usize, Seed>, // by position, from the subscribe acknowledgement on
    requested: HashMap<String, Vec<String>>, // subscribe id to the topics it asked for
    behind: HashMap<usize, u32>, // snapshots that were behind the socket, by position
    snapshot_failures: u32, // consecutive orderbook replies that carried no book, on this connection
}

enum Seed {
    // The snapshot is requested, and the deltas that arrive meanwhile are kept to replay on top of it.
    Waiting(VecDeque<Delta>),
    Live(Chain),
}

#[derive(Clone, Copy)]
struct Chain {
    last_ts: i64,     // data.ts of the last update applied, or the snapshot's timestamp
    seeded_only: bool, // no delta applied since the snapshot
    lowest_bid: f64,  // the window the snapshot covered, 0 and infinity for a whole side
    highest_ask: f64,
}

impl Chain {
    // A delta names the update before it, and the first one after a snapshot may start before the snapshot's timestamp.
    // The socket pushes every 50 ms while the REST timestamp is the change itself, so a push can straddle it, and its absolute sizes still hold.
    fn takes(&self, delta: &Delta) -> bool {
        delta.prev_ts == self.last_ts || (self.seeded_only && delta.prev_ts < self.last_ts)
    }
}

#[derive(Debug, Clone)]
struct Delta {
    prev_ts: i64,
    ts: i64,
    bids: Vec<BookLevel>,
    asks: Vec<BookLevel>,
}

impl BookVenue for Woo {
    type State = State;

    // The server sends no ping and closes a socket that sent nothing for 60 s, and most books send nothing for minutes.
    // So the pong is the traffic the silence check relies on, and three missed pongs is a dead socket.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(15)),
            // The orderbook call allows 10 requests a second per IP, and five connections at this gap make 8.3.
            snapshot_gap: Duration::from_millis(600),
            // Seeding 50 markets one gap apart takes 30 s, so the unserved check waits past that.
            first_book_wait: Duration::from_secs(40),
            ..FeedSettings::new(Duration::from_secs(45))
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

    fn subscribe_frames(&self, markets: &[Market], state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::new();
        for (i, chunk) in markets.chunks(TOPICS_PER_FRAME).enumerate() {
            let id = (i + 1).to_string();
            let topics: Vec<String> = chunk.iter().map(|market| topic(&market.raw_market_id)).collect();
            let frame = serde_json::json!({ "id": id, "cmd": "SUBSCRIBE", "params": topics });
            frames.push(Message::text(frame.to_string()));
            state.requested.insert(id, topics);
        }
        frames
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text(serde_json::json!({ "cmd": "PING", "ts": now_ms() }).to_string())
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let envelope: Envelope = serde_json::from_slice(frame)?;

        if let Some(topic) = envelope.topic {
            if topic.starts_with(TOPIC_PREFIX) {
                let book: BookFrame = serde_json::from_slice(frame)?;
                apply_delta(book.data, conn);
            }
            return Ok(());
        }

        let reply: Reply = serde_json::from_slice(frame)?;
        match (reply.cmd.as_deref(), reply.success) {
            (Some("PONG"), _) => {}
            (Some("SUBSCRIBE"), Some(true)) => acknowledge(&reply, conn),
            (_, Some(false)) => {
                tracing::error!(
                    event = "venue_error",
                    connection = conn.id(),
                    cmd = reply.cmd.as_deref().unwrap_or(""),
                    id = %reply.id,
                    message = %reply.data,
                );
            }
            _ => tracing::warn!(event = "venue_notice", connection = conn.id(), frame = %String::from_utf8_lossy(frame)),
        }

        Ok(())
    }

    fn snapshot_url(&self, market: &Market) -> Option<String> {
        Some(format!(
            "{}{ORDERBOOK_PATH}?symbol={}&maxLevel={SNAPSHOT_LEVELS}",
            self.rest, market.raw_market_id
        ))
    }

    // A gateway failure arrives as HTTP 200 with success false, so such a reply is fetched again like a failed fetch.
    fn handle_snapshot(&self, position: usize, body: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let (timestamp, data) = match serde_json::from_slice::<Snapshot>(body) {
            Ok(Snapshot { success: true, timestamp, data: Some(data), .. }) if timestamp > 0 => (timestamp, data),
            Ok(snapshot) => {
                let message = snapshot.message.unwrap_or_default();
                failed_reply(position, &format!("the orderbook reply carried no book: {message}"), conn);
                return Ok(());
            }
            Err(error) => {
                failed_reply(position, &format!("the orderbook reply is not JSON: {error}"), conn);
                return Ok(());
            }
        };
        conn.state.snapshot_failures = 0;

        // Only a waiting market has a request out, so any other state is left as it is.
        let held = match conn.state.books.get_mut(&position) {
            Some(Seed::Waiting(held)) => std::mem::take(held),
            _ => return Ok(()),
        };
        seed(position, timestamp, data, held, conn);
        Ok(())
    }
}

fn topic(raw_market_id: &str) -> String {
    format!("{TOPIC_PREFIX}{raw_market_id}{TOPIC_SUFFIX}")
}

// "orderbookupdate@PERP_BTC_USDT@50" names "PERP_BTC_USDT".
fn market_of(topic: &str) -> Option<&str> {
    topic.strip_prefix(TOPIC_PREFIX)?.strip_suffix(TOPIC_SUFFIX)
}

// An unknown or duplicate topic is acknowledged with success true and left out of data, so each requested topic is checked.
// Each acknowledged market asks for its snapshot here, because most books send no delta for minutes.
fn acknowledge(reply: &Reply, conn: &mut Connection<State>) {
    let id = reply.id.as_str().unwrap_or("").to_string();
    let accepted: Vec<&str> = match &reply.data {
        serde_json::Value::Array(topics) => topics.iter().filter_map(|topic| topic.as_str()).collect(),
        _ => Vec::new(),
    };

    for topic in &accepted {
        let Some(position) = market_of(topic).and_then(|market| conn.position(market)) else {
            continue;
        };
        if !conn.state.books.contains_key(&position) {
            conn.state.books.insert(position, Seed::Waiting(VecDeque::new()));
            conn.request_snapshot(position);
        }
    }

    let requested = conn.state.requested.remove(&id).unwrap_or_default();
    let refused: Vec<&String> = requested.iter().filter(|topic| !accepted.contains(&topic.as_str())).collect();
    if !refused.is_empty() {
        tracing::error!(event = "subscribe_refused", connection = conn.id(), id, refused = refused.len(), topics = ?refused);
    }
}

fn apply_delta(data: BookData, conn: &mut Connection<State>) {
    let Some(position) = conn.position(&data.s) else {
        return;
    };
    let delta = Delta {
        prev_ts: data.prev_ts,
        ts: data.ts,
        bids: data.bids,
        asks: data.asks,
    };

    let chain = match conn.state.books.get_mut(&position) {
        Some(Seed::Live(chain)) => *chain,
        Some(Seed::Waiting(held)) => {
            hold(held, delta);
            return;
        }
        // A delta ahead of the acknowledgement, which the venue was not seen to send.
        None => {
            conn.state.books.insert(position, Seed::Waiting(VecDeque::from([delta])));
            conn.request_snapshot(position);
            return;
        }
    };

    // Already in the book, as a delta the snapshot covered.
    if delta.ts <= chain.last_ts {
        return;
    }

    if !chain.takes(&delta) {
        if chain.seeded_only {
            // The snapshot was behind the socket, so this market alone is seeded again, and its book reads empty until then rather than stale.
            reseed(position, delta, chain.last_ts, conn);
        } else {
            conn.resync(&data.s, "sequence_gap");
        }
        return;
    }

    let applied = apply(position, &delta, chain, conn);
    conn.state.books.insert(position, Seed::Live(applied));
    conn.publish(position);
}

fn hold(held: &mut VecDeque<Delta>, delta: Delta) {
    if held.len() == MAX_HELD_DELTAS {
        held.pop_front();
    }
    held.push_back(delta);
}

// Levels outside the snapshot's window are left out, since the book holds nothing there to update.
fn apply(position: usize, delta: &Delta, chain: Chain, conn: &mut Connection<State>) -> Chain {
    if let Some(book) = conn.book(position) {
        for level in &delta.bids {
            if level.price >= chain.lowest_bid {
                book.set_bid(level.price, level.size);
            }
        }
        for level in &delta.asks {
            if level.price <= chain.highest_ask {
                book.set_ask(level.price, level.size);
            }
        }
    }

    Chain {
        last_ts: delta.ts,
        seeded_only: false,
        ..chain
    }
}

// The snapshot's timestamp is the book's last change, and the first held delta newer than it must start at or before it.
// One that starts after it shows the snapshot is behind the socket, so the market is fetched again.
fn seed(position: usize, timestamp: i64, data: SnapshotData, held: VecDeque<Delta>, conn: &mut Connection<State>) {
    let newer: VecDeque<Delta> = held.into_iter().filter(|delta| delta.ts > timestamp).collect();

    if let Some(first) = newer.front()
        && first.prev_ts > timestamp
    {
        note_behind(position, timestamp, first.prev_ts, conn);
        conn.state.books.insert(position, Seed::Waiting(newer));
        conn.request_snapshot(position);
        return;
    }

    let bids = levels(&data.bids);
    let asks = levels(&data.asks);
    let mut chain = Chain {
        last_ts: timestamp,
        seeded_only: true,
        lowest_bid: if bids.len() >= SNAPSHOT_LEVELS { bids.last().map_or(0.0, |level| level.price) } else { 0.0 },
        highest_ask: if asks.len() >= SNAPSHOT_LEVELS { asks.last().map_or(f64::INFINITY, |level| level.price) } else { f64::INFINITY },
    };

    // Held deltas chain on the wire, so a break means the venue skipped one, and the book is not published half replayed.
    let mut check = chain;
    for delta in &newer {
        if !check.takes(delta) {
            let market = conn.markets()[position].raw_market_id.clone();
            conn.resync(&market, "sequence_gap");
            return;
        }
        check = Chain { last_ts: delta.ts, seeded_only: false, ..check };
    }

    conn.reset_book(position, &bids, &asks);
    for delta in &newer {
        chain = apply(position, delta, chain, conn);
    }

    conn.state.behind.remove(&position);
    conn.state.books.insert(position, Seed::Live(chain));
}

fn reseed(position: usize, delta: Delta, last_ts: i64, conn: &mut Connection<State>) {
    note_behind(position, last_ts, delta.prev_ts, conn);
    conn.reset_book(position, &[], &[]);
    conn.state.books.insert(position, Seed::Waiting(VecDeque::from([delta])));
    conn.request_snapshot(position);
}

fn failed_reply(position: usize, error: &str, conn: &mut Connection<State>) {
    conn.request_snapshot(position);
    conn.state.snapshot_failures += 1;
    let failures = conn.state.snapshot_failures;
    if failures == 1 || failures % SNAPSHOT_FAILURE_LOG_EVERY == 0 {
        let market = conn.markets()[position].raw_market_id.as_str();
        tracing::warn!(event = "snapshot_failed", connection = conn.id(), market, failures, error);
    }
}

fn note_behind(position: usize, snapshot_ts: i64, prev_ts: i64, conn: &mut Connection<State>) {
    let misses = conn.state.behind.entry(position).or_default();
    *misses += 1;
    let misses = *misses;
    if misses == 1 || misses % SNAPSHOT_BEHIND_LOG_EVERY == 0 {
        let market = conn.markets()[position].raw_market_id.as_str();
        tracing::warn!(event = "snapshot_behind", connection = conn.id(), market, misses, snapshot_ts, prev_ts);
    }
}

fn levels(rows: &[RestLevel]) -> Vec<BookLevel> {
    rows.iter().map(|row| BookLevel { price: row.price, size: row.quantity }).collect()
}

// Book frames carry topic, and replies carry cmd and no topic.
#[derive(Deserialize)]
struct Envelope<'a> {
    #[serde(borrow)]
    topic: Option<&'a str>,
}

#[derive(Deserialize)]
struct BookFrame {
    data: BookData,
}

#[derive(Deserialize)]
struct BookData {
    s: String, // "PERP_BTC_USDT"
    ts: i64,   // the update's own time in ms, which the next update names as prevTs
    #[serde(rename = "prevTs")]
    prev_ts: i64,
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // absolute sizes in base coin, "0" deletes
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
}

// An acknowledgement lists the accepted topics in data, and a refusal carries a message there.
#[derive(Deserialize)]
struct Reply {
    cmd: Option<String>, // "SUBSCRIBE", "PONG" or "ERROR"
    success: Option<bool>,
    #[serde(default)]
    id: serde_json::Value,
    #[serde(default)]
    data: serde_json::Value,
}

#[derive(Deserialize)]
struct Snapshot {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    timestamp: i64, // the book's last change, which a later delta names as prevTs
    data: Option<SnapshotData>,
    message: Option<String>,
}

#[derive(Deserialize)]
struct SnapshotData {
    #[serde(default)]
    bids: Vec<RestLevel>, // best first
    #[serde(default)]
    asks: Vec<RestLevel>,
}

#[derive(Deserialize)]
struct RestLevel {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    quantity: f64,
}
