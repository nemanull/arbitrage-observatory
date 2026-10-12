mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use anchor::AnchorState;
use serde::Deserialize;
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "backpack";

const REST: &str = "https://api.backpack.exchange";

// One public socket carries every market.
const URL: &str = "wss://ws.backpack.exchange";

// Every book change as absolute sizes anywhere in the book, chained by U and u per market.
// The socket never sends a snapshot, so every book is seeded from the REST book.
const STREAM_PREFIX: &str = "depth.";

// The REST book's limit, and the stream carries changes anywhere in the book, so the seed is deep.
const SNAPSHOT_LEVELS: usize = 1000;
const DEPTH_PATH: &str = "/api/v1/depth";

// The venue caps no stream count, but a gap reseeds every market on its connection, so connections stay small.
const MAX_MARKETS_PER_CONNECTION: usize = 30;

// A market waiting for its snapshot keeps at most this many deltas, about 11 s of BTC at its busiest.
// A seed older than the oldest kept one is fetched again.
const MAX_HELD_DELTAS: usize = 2000;

// A snapshot behind the socket is fetched again, and logged on the first miss and every tenth.
const SNAPSHOT_BEHIND_LOG_EVERY: u32 = 10;

// A reply that carried no book is logged on the first failure and every 30th, as the runtime logs a failed fetch.
const SNAPSHOT_FAILURE_LOG_EVERY: u32 = 30;

pub struct Backpack {
    rest: String,
    anchors: Mutex<AnchorState>,
}

impl Backpack {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self {
            rest: rest.to_string(),
            anchors: Mutex::new(AnchorState::default()),
        }
    }
}

#[derive(Default)]
pub struct State {
    seeding: bool, // every market's snapshot is requested, which the first frame on the connection does
    books: HashMap<usize, Seed>, // by position
    behind: HashMap<usize, u32>, // snapshots that were behind the socket, by position
    snapshot_failures: u32, // consecutive depth replies that carried no book, on this connection
}

enum Seed {
    // The snapshot is requested, and the deltas that arrive meanwhile are kept to replay on top of it.
    Waiting(VecDeque<Delta>),
    Live(Chain),
}

#[derive(Clone, Copy)]
struct Chain {
    last_u: i64,       // u of the last delta applied, or the snapshot's lastUpdateId
    seeded_only: bool, // no delta applied since the snapshot
    lowest_bid: f64,   // the window the snapshot covered, 0 and infinity for a whole side
    highest_ask: f64,
}

impl Chain {
    // A delta must start right after the last one, and the first one after a snapshot may start at or before it.
    // The REST book ran one update ahead of the socket on 2026-09-23, so the first delta can straddle it.
    fn takes(&self, delta: &Delta) -> bool {
        delta.first == self.last_u + 1 || (self.seeded_only && delta.first <= self.last_u + 1)
    }
}

#[derive(Debug, Clone)]
struct Delta {
    first: i64, // U
    last: i64,  // u
    bids: Vec<BookLevel>,
    asks: Vec<BookLevel>,
}

impl BookVenue for Backpack {
    type State = State;

    // The server pings every 60 s and a quiet book sent nothing for 30 s, so the client pings every 15 s.
    // The protocol pong is the traffic the silence check relies on, and three missed pongs is a dead socket.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(15)),
            // No REST limit is published, and four connections at this gap make the 5 a second the profile seeded at.
            snapshot_gap: Duration::from_millis(800),
            // Seeding 30 markets one gap apart takes 24 s, so the unserved check waits past that.
            first_book_wait: Duration::from_secs(35),
            ..FeedSettings::new(Duration::from_secs(45))
        }
    }

    // As few connections as the cap allows, with the markets spread evenly, so 91 markets make four of 23.
    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let connections = markets.len().div_ceil(MAX_MARKETS_PER_CONNECTION).max(1);
        let per_connection = markets.len().div_ceil(connections).max(1);

        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(per_connection).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#perp#{i}"),
                url: URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // One frame per market, because a frame that names one unknown symbol is refused whole with error 4014.
    // The venue sends no acknowledgement, and a closed market's stream is accepted and silent.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for market in markets {
            let frame = serde_json::json!({ "method": "SUBSCRIBE", "params": [format!("{STREAM_PREFIX}{}", market.raw_market_id)] });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        // No acknowledgement comes, so the first frame shows the subscription is live, and every market asks for its snapshot then.
        // A quiet equity book can send nothing for 30 s, so waiting for each market's own first delta would leave it unbooked.
        if !conn.state.seeding {
            conn.state.seeding = true;
            for position in 0..conn.markets().len() {
                if !conn.state.books.contains_key(&position) {
                    conn.state.books.insert(position, Seed::Waiting(VecDeque::new()));
                    conn.request_snapshot(position);
                }
            }
        }

        let envelope: Envelope = serde_json::from_slice(frame)?;

        if let Some(error) = envelope.error {
            tracing::error!(event = "venue_error", connection = conn.id(), code = %error.code, message = %error.message);
            return Ok(());
        }

        match (envelope.stream, envelope.data) {
            (Some(stream), Some(data)) if stream.starts_with(STREAM_PREFIX) => apply_delta(data, conn),
            _ => tracing::warn!(event = "venue_notice", connection = conn.id(), frame = %String::from_utf8_lossy(frame)),
        }

        Ok(())
    }

    fn snapshot_url(&self, market: &Market) -> Option<String> {
        Some(format!(
            "{}{DEPTH_PATH}?symbol={}&limit={SNAPSHOT_LEVELS}",
            self.rest, market.raw_market_id
        ))
    }

    // An error arrives with a status the runtime retries, so a 200 that is not a book is fetched again the same way.
    fn handle_snapshot(&self, position: usize, body: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let snapshot = match serde_json::from_slice::<Snapshot>(body) {
            Ok(snapshot) if snapshot.last_update_id > 0 => snapshot,
            Ok(_) => {
                failed_reply(position, "the depth reply carried no lastUpdateId", conn);
                return Ok(());
            }
            Err(error) => {
                failed_reply(position, &format!("the depth reply is not a book: {error}"), conn);
                return Ok(());
            }
        };
        conn.state.snapshot_failures = 0;

        // Only a waiting market has a request out, so any other state is left as it is.
        let held = match conn.state.books.get_mut(&position) {
            Some(Seed::Waiting(held)) => std::mem::take(held),
            _ => return Ok(()),
        };
        seed(position, snapshot, held, conn);
        Ok(())
    }
}

fn apply_delta(data: DepthData, conn: &mut Connection<State>) {
    let Some(position) = conn.position(data.s) else {
        return;
    };
    let delta = Delta {
        first: data.first,
        last: data.last,
        bids: data.bids,
        asks: data.asks,
    };

    let chain = match conn.state.books.get_mut(&position) {
        Some(Seed::Live(chain)) => *chain,
        Some(Seed::Waiting(held)) => {
            hold(held, delta);
            return;
        }
        // Every market is requested at the first frame, so this is a market whose book was dropped.
        None => {
            conn.state.books.insert(position, Seed::Waiting(VecDeque::from([delta])));
            conn.request_snapshot(position);
            return;
        }
    };

    // Already in the book, as a delta the snapshot covered.
    if delta.last <= chain.last_u {
        return;
    }

    if !chain.takes(&delta) {
        if chain.seeded_only {
            // The snapshot and the socket do not meet, so this market alone is seeded again, and its book reads empty until then rather than stale.
            reseed(position, delta, chain.last_u, conn);
        } else {
            let market = conn.markets()[position].raw_market_id.clone();
            conn.resync(&market, "sequence_gap");
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
        last_u: delta.last,
        seeded_only: false,
        ..chain
    }
}

// The held deltas the snapshot covers are dropped, and the first newer one must start at or before lastUpdateId + 1.
// One that starts after it shows the snapshot is behind the socket, so the market is fetched again.
fn seed(position: usize, snapshot: Snapshot, held: VecDeque<Delta>, conn: &mut Connection<State>) {
    let last_update_id = snapshot.last_update_id;
    let newer: VecDeque<Delta> = held.into_iter().filter(|delta| delta.last > last_update_id).collect();

    if let Some(first) = newer.front()
        && first.first > last_update_id + 1
    {
        note_behind(position, last_update_id, first.first, conn);
        conn.state.books.insert(position, Seed::Waiting(newer));
        conn.request_snapshot(position);
        return;
    }

    // Bids arrive ascending, so the deepest is the first and the window's edge on a full side.
    let bids = snapshot.bids;
    let asks = snapshot.asks;
    let mut chain = Chain {
        last_u: last_update_id,
        seeded_only: true,
        lowest_bid: if bids.len() >= SNAPSHOT_LEVELS { bids.iter().map(|level| level.price).fold(f64::INFINITY, f64::min) } else { 0.0 },
        highest_ask: if asks.len() >= SNAPSHOT_LEVELS { asks.iter().map(|level| level.price).fold(0.0, f64::max) } else { f64::INFINITY },
    };

    // Held deltas chain on the wire, so a break means the venue skipped one, and the book is not published half replayed.
    let mut check = chain;
    for delta in &newer {
        if !check.takes(delta) {
            let market = conn.markets()[position].raw_market_id.clone();
            conn.resync(&market, "sequence_gap");
            return;
        }
        check = Chain { last_u: delta.last, seeded_only: false, ..check };
    }

    conn.reset_book(position, &bids, &asks);
    for delta in &newer {
        chain = apply(position, delta, chain, conn);
    }

    conn.state.behind.remove(&position);
    conn.state.books.insert(position, Seed::Live(chain));
}

fn reseed(position: usize, delta: Delta, last_u: i64, conn: &mut Connection<State>) {
    note_behind(position, last_u, delta.first, conn);
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

fn note_behind(position: usize, last_update_id: i64, first: i64, conn: &mut Connection<State>) {
    let misses = conn.state.behind.entry(position).or_default();
    *misses += 1;
    let misses = *misses;
    if misses == 1 || misses % SNAPSHOT_BEHIND_LOG_EVERY == 0 {
        let market = conn.markets()[position].raw_market_id.as_str();
        tracing::warn!(event = "snapshot_behind", connection = conn.id(), market, misses, last_update_id, first);
    }
}

// Book frames carry stream and data, and an error carries error with a null id.
#[derive(Deserialize)]
struct Envelope<'a> {
    #[serde(borrow)]
    stream: Option<&'a str>, // "depth.BTC_USDC_PERP"
    #[serde(borrow)]
    data: Option<DepthData<'a>>,
    error: Option<VenueError>,
}

#[derive(Deserialize)]
struct DepthData<'a> {
    #[serde(borrow)]
    s: &'a str, // "BTC_USDC_PERP"
    #[serde(rename = "U")]
    first: i64, // the first update id in the frame, which is u on every realtime frame seen
    #[serde(rename = "u")]
    last: i64,
    #[serde(default, rename = "b", deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // absolute sizes in base coin, "0.00000" deletes, in no promised order
    #[serde(default, rename = "a", deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
}

#[derive(Deserialize)]
struct VenueError {
    #[serde(default)]
    code: serde_json::Value, // 4014 "Invalid symbol", 4006 "Invalid stream", 4008 "Invalid depth window"
    #[serde(default)]
    message: String,
}

#[derive(Deserialize)]
struct Snapshot {
    #[serde(default, rename = "lastUpdateId", deserialize_with = "update_id")]
    last_update_id: i64, // a decimal string, "6729962806"
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // ascending, so the best bid is the last
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
}

// The REST book writes lastUpdateId as a string, and a number or anything unreadable is taken as it comes or as 0.
fn update_id<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<i64, D::Error> {
    let value = serde_json::Value::deserialize(deserializer)?;
    Ok(match value {
        serde_json::Value::String(text) => text.parse().unwrap_or(0),
        serde_json::Value::Number(number) => number.as_i64().unwrap_or(0),
        _ => 0,
    })
}
