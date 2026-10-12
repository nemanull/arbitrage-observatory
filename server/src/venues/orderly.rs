// The Orderly family: Niza and NonKYC are Orderly builders with no market of their own, and each is a profile of id, name and taker.
// Both front ends read Orderly's one shared book, catalog and anchors, so a cross between them, or with any other builder, compares a book with itself.

mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::clock::now_ms;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use anchor::Periods;
use serde::Deserialize;
use std::collections::{HashMap, VecDeque};
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const NIZA_ID: &str = "niza";
pub const NONKYC_ID: &str = "nonkyc";

pub struct Profile {
    pub id: &'static str,
    name: &'static str,
    taker_ppm: u32, // the builder's taker of the profile's fees.md, since no builder publishes a schedule
}

// The fee the niza.fun order form shows, 0.05 %, above Orderly's 300 ppm floor for a builder's users.
pub const NIZA: Profile = Profile {
    id: NIZA_ID,
    name: "Niza.io",
    taker_ppm: 500,
};

// The rate Orderly's public feeRate query returned for NonKYC's own builder account, 0.15 %.
pub const NONKYC: Profile = Profile {
    id: NONKYC_ID,
    name: "Nonkyc.io",
    taker_ppm: 1_500,
};

const REST: &str = "https://api.orderly.org";

// The path segment is the Orderly SDK's constant for the public socket, and any other segment is closed within milliseconds.
const URL: &str = "wss://ws-evm.orderly.org/ws/stream/OqdphuyCtYWxwzhxyLLjOWNdFP7sQt8RPWzmb5xY";

// Full depth deltas chained by prevTs, and the whole book on subscribe and then at most once a second on change.
// Neither topic takes a depth, so the book holds every level.
const DELTA_TOPIC: &str = "orderbookupdate";
const SNAPSHOT_TOPIC: &str = "orderbook";

// The server refuses the 101st topic on a socket, and each market takes two.
const MARKETS_PER_CONNECTION: usize = 50;

// Deltas come on a 200 ms grid and the snapshot within about 170 ms of the subscribe, so a market waiting for it holds a few at most.
const MAX_HELD_DELTAS: usize = 100;

pub struct Orderly {
    profile: &'static Profile,
    rest: String,
    periods: Mutex<Periods>,
}

impl Orderly {
    pub fn new(profile: &'static Profile) -> Self {
        Self::with_rest(profile, REST)
    }

    fn with_rest(profile: &'static Profile, rest: &str) -> Self {
        Self {
            profile,
            rest: rest.to_string(),
            periods: Mutex::new(Periods::default()),
        }
    }
}

#[derive(Default)]
pub struct State {
    books: HashMap<usize, Seed>, // by position, from the first book frame on
}

enum Seed {
    // No snapshot yet, and the deltas that arrive meanwhile are kept to replay on top of it.
    Waiting(VecDeque<Delta>),
    Live(i64), // ts of the last snapshot or delta applied
}

struct Delta {
    prev_ts: i64,
    ts: i64,
    bids: Vec<BookLevel>,
    asks: Vec<BookLevel>,
}

impl BookVenue for Orderly {
    type State = State;

    // The server pings every 10 s and closes a socket 110 s after a ping it never got an answer to.
    // Every ping is answered and the client pings too, and a quiet book went 31.8 s without a delta, so silence alone says nothing before 30 s.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(10)),
            ..FeedSettings::new(Duration::from_secs(30))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{}#perp#{i}", self.profile.id),
                url: URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // One topic per frame, the delta topic first so no change falls between the snapshot and the first delta.
    // The topic is the frame's id, which an error reply echoes.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len() * 2);
        for market in markets {
            for kind in [DELTA_TOPIC, SNAPSHOT_TOPIC] {
                let topic = format!("{}@{kind}", market.raw_market_id);
                let frame = serde_json::json!({ "id": topic, "event": "subscribe", "topic": topic });
                frames.push(Message::text(frame.to_string()));
            }
        }
        frames
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text(serde_json::json!({ "event": "ping" }).to_string())
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let envelope: Envelope = serde_json::from_slice(frame)?;

        if let Some(topic) = envelope.topic {
            let (symbol, kind) = topic.split_once('@').unwrap_or((topic, ""));
            if kind == DELTA_TOPIC || kind == SNAPSHOT_TOPIC {
                let book: BookFrame = serde_json::from_slice(frame)?;
                let Some(position) = conn.position(symbol) else {
                    return Ok(());
                };
                // The book would skip such a level and carry on, so a missed deletion would stay in a book that looks live.
                if !readable(&book.data.bids) || !readable(&book.data.asks) {
                    conn.resync(symbol, "level_unreadable");
                    return Ok(());
                }
                if kind == SNAPSHOT_TOPIC {
                    apply_snapshot(position, book, conn);
                } else {
                    apply_delta(position, book, conn);
                }
            }
            return Ok(());
        }

        match (envelope.event, envelope.success) {
            (Some("ping"), _) => conn.send(Message::text(serde_json::json!({ "event": "pong", "ts": now_ms() }).to_string())),
            (Some("pong"), _) | (Some("subscribe"), Some(true)) => {}
            // An unknown symbol and the 101st topic are refused this way, with no event key.
            (_, Some(false)) => {
                tracing::error!(
                    event = "venue_error",
                    connection = conn.id(),
                    id = envelope.id.as_deref().unwrap_or(""),
                    message = envelope.error_msg.as_deref().unwrap_or(""),
                );
            }
            _ => tracing::warn!(event = "venue_notice", connection = conn.id(), frame = %String::from_utf8_lossy(frame)),
        }

        Ok(())
    }
}

// The rule OrderBook applies to each level, where a size of 0 deletes.
fn readable(levels: &[BookLevel]) -> bool {
    levels.iter().all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

// The push is the whole book stamped with the change it reflects, which sits on the delta chain.
// One no newer than the book is skipped, and a newer one replaces it, so the deltas it covers are skipped as they come.
fn apply_snapshot(position: usize, book: BookFrame, conn: &mut Connection<State>) {
    let held = match conn.state.books.remove(&position) {
        Some(Seed::Live(last)) if book.ts <= last => {
            conn.state.books.insert(position, Seed::Live(last));
            return;
        }
        Some(Seed::Waiting(held)) => held,
        _ => VecDeque::new(),
    };

    // A held delta newer than the snapshot that does not chain from it shows the push was behind the deltas, and the next push seeds the book.
    let newer: VecDeque<Delta> = held.into_iter().filter(|delta| delta.ts > book.ts).collect();
    let mut last = book.ts;
    for delta in &newer {
        if delta.prev_ts != last {
            let market = conn.markets()[position].raw_market_id.as_str();
            tracing::warn!(event = "snapshot_behind", connection = conn.id(), market, snapshot_ts = book.ts, prev_ts = delta.prev_ts);
            conn.state.books.insert(position, Seed::Waiting(newer));
            return;
        }
        last = delta.ts;
    }

    conn.reset_book(position, &book.data.bids, &book.data.asks);
    if let Some(levels) = conn.book(position) {
        for delta in &newer {
            for level in &delta.bids {
                levels.set_bid(level.price, level.size);
            }
            for level in &delta.asks {
                levels.set_ask(level.price, level.size);
            }
        }
    }
    conn.state.books.insert(position, Seed::Live(last));
}

fn apply_delta(position: usize, book: BookFrame, conn: &mut Connection<State>) {
    let delta = Delta {
        prev_ts: book.data.prev_ts.unwrap_or(0),
        ts: book.ts,
        bids: book.data.bids,
        asks: book.data.asks,
    };

    let last = match conn.state.books.get_mut(&position) {
        Some(Seed::Live(last)) => *last,
        Some(Seed::Waiting(held)) => {
            if held.len() == MAX_HELD_DELTAS {
                held.pop_front();
            }
            held.push_back(delta);
            return;
        }
        None => {
            conn.state.books.insert(position, Seed::Waiting(VecDeque::from([delta])));
            return;
        }
    };

    // Already in the book, through a snapshot newer than the delta.
    if delta.ts <= last {
        return;
    }
    if delta.prev_ts != last {
        let market = conn.markets()[position].raw_market_id.clone();
        conn.resync(&market, "sequence_gap");
        return;
    }

    conn.state.books.insert(position, Seed::Live(delta.ts));
    if delta.bids.is_empty() && delta.asks.is_empty() {
        return;
    }
    if let Some(levels) = conn.book(position) {
        for level in &delta.bids {
            levels.set_bid(level.price, level.size);
        }
        for level in &delta.asks {
            levels.set_ask(level.price, level.size);
        }
    }
    conn.publish(position);
}

// Book pushes carry topic, and pings, pongs, acknowledgements and errors carry none.
#[derive(Deserialize)]
struct Envelope<'a> {
    #[serde(borrow)]
    topic: Option<&'a str>, // "PERP_BTC_USDC@orderbookupdate"
    #[serde(borrow)]
    event: Option<&'a str>, // "ping", "pong" or "subscribe", absent on an error
    success: Option<bool>,
    id: Option<String>,
    #[serde(rename = "errorMsg")]
    error_msg: Option<String>, // "invalid symbol PERP_NOPE_USDC"
}

#[derive(Deserialize)]
struct BookFrame {
    ts: i64, // the time of the book change, which the next delta names as prevTs, not the time of the push
    data: BookData,
}

#[derive(Deserialize)]
struct BookData {
    #[serde(rename = "prevTs")]
    prev_ts: Option<i64>, // on a delta only
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // absolute sizes in base coin, 0 deletes, best first
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
}
