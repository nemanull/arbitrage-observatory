mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::order_book::OrderBook;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "bingx";

const REST: &str = "https://open-api.bingx.com";

// One socket carries the USDT-M and USDC-M contracts alike, and every frame it sends, the Ping included, is binary gzip.
const PUBLIC_URL: &str = "wss://open-api-swap.bingx.com/swap-market";

// A snapshot of up to 1,024 levels a side on subscribe, then updates every 200 ms on BTC and ETH and every 400 to 800 ms on the rest.
// It is the only incremental book, and the partial depth channels carry no update id.
const CHANNEL: &str = "incrDepth";

// The cap is 200 topics a socket, and the 201st is refused with 80403.
const MARKETS_PER_CONNECTION: usize = 180;

const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];

// Frames held for one market before its acknowledgement or its snapshot, which came within about 200 ms of the first update on 2026-10-08.
const MAX_EARLY_FRAMES: usize = 64;

pub struct BingX {
    rest: String,
}

impl BingX {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self { rest: rest.to_string() }
    }
}

#[derive(Default)]
pub struct State {
    acked: HashSet<usize>,              // positions whose subscribe was answered with code 0
    sequences: HashMap<usize, Sequence>, // by position, from its snapshot on
    early: HashMap<usize, Vec<Depth>>,   // frames that came before the market's acknowledgement or snapshot, in arrival order
    dropped: HashMap<usize, i64>,        // the highest id of a frame dropped from a full hold
}

#[derive(Clone, Copy)]
struct Sequence {
    snapshot_id: i64, // `lastUpdateId` of the snapshot, which already holds every update up to it
    last_id: i64,     // `lastUpdateId` of the last frame applied
}

impl BookVenue for BingX {
    type State = State;

    // The server pings every 5 s and closes a socket that sends no Pong at 30.5 s, so no client ping is needed.
    // The Ping is traffic, so three missed pings is a dead socket, while a quiet book went 21.6 s without a frame.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            // The API FAQ asks for fewer than 10 subscriptions a second, one topic per frame.
            subscribe_gap: Duration::from_millis(111),
            connect_stagger: Duration::from_secs(1),
            ..FeedSettings::new(Duration::from_secs(15))
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

    // The request id is the raw market id, so an acknowledgement, which names no topic, still names its market.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for market in markets {
            let topic = format!("{}@{CHANNEL}", market.raw_market_id);
            let frame = serde_json::json!({ "id": market.raw_market_id, "reqType": "sub", "dataType": topic });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
        let inflated;
        let frame = if frame.starts_with(&GZIP_MAGIC) {
            inflated = wire::gunzip(frame)?;
            inflated.as_slice()
        } else {
            frame
        };

        if frame == b"Ping" {
            conn.send(Message::text("Pong"));
            return Ok(());
        }

        let frame: Frame = serde_json::from_slice(frame)?;

        if let Some(stream) = frame.data_type.as_deref()
            && !stream.is_empty()
        {
            if let Some(depth) = frame.data
                && let Some((symbol, channel)) = stream.split_once('@')
                && channel == CHANNEL
            {
                apply_book(symbol, depth, conn);
            }
            return Ok(());
        }

        let message = frame.msg.as_deref().unwrap_or("");
        match frame.id.as_deref() {
            Some(id) => acknowledge(id, frame.code, message, conn),
            None if frame.code != 0 => {
                tracing::error!(event = "venue_error", connection = conn.id(), code = frame.code, message);
            }
            None => {}
        }

        Ok(())
    }
}

// A refused topic can still deliver one data frame, so a market's frames wait until its acknowledgement.
fn acknowledge(id: &str, code: i64, message: &str, conn: &mut Connection<State>) {
    if code != 0 {
        tracing::error!(event = "venue_error", connection = conn.id(), market = id, code, message);
        if let Some(position) = conn.position(id) {
            conn.state.early.remove(&position);
            conn.state.dropped.remove(&position);
        }
        return;
    }

    let Some(position) = conn.position(id) else {
        return;
    };
    conn.state.acked.insert(position);

    // The newest held snapshot seeds the book, and the updates held around it replay as if it had come after the acknowledgement.
    let mut held = conn.state.early.remove(&position).unwrap_or_default();
    let Some(i) = held.iter().rposition(|depth| depth.action == "all") else {
        if !held.is_empty() {
            conn.state.early.insert(position, held);
        }
        return;
    };
    let snapshot = held.remove(i);
    conn.state.early.insert(position, held);
    apply_snapshot(position, id, snapshot, conn);
}

fn apply_book(symbol: &str, depth: Depth, conn: &mut Connection<State>) {
    let Some(position) = conn.position(symbol) else {
        return;
    };

    let is_snapshot = depth.action == "all";
    if !conn.state.acked.contains(&position) || (!is_snapshot && !conn.state.sequences.contains_key(&position)) {
        hold(position, depth, &mut conn.state);
        return;
    }

    if is_snapshot {
        apply_snapshot(position, symbol, depth, conn);
    } else {
        apply_update(position, symbol, &depth, conn);
    }
}

// The oldest held frame makes room for the newest, and the highest id dropped this way is kept for the snapshot to check.
fn hold(position: usize, depth: Depth, state: &mut State) {
    let early = state.early.entry(position).or_default();
    if early.len() == MAX_EARLY_FRAMES {
        let oldest = early.remove(0);
        let dropped = state.dropped.entry(position).or_insert(oldest.last_update_id);
        *dropped = (*dropped).max(oldest.last_update_id);
    }
    early.push(depth);
}

// Updates start before the snapshot is sent, so one can arrive just before it or just after it with an older id.
// Held updates newer than the snapshot are replayed onto a copy of it, so a gap or a cross among them publishes nothing.
fn apply_snapshot(position: usize, symbol: &str, snapshot: Depth, conn: &mut Connection<State>) {
    let snapshot_id = snapshot.last_update_id;
    let mut held = conn.state.early.remove(&position).unwrap_or_default();
    if conn.state.dropped.remove(&position).is_some_and(|id| id > snapshot_id) {
        conn.resync(symbol, "held_update_dropped");
        return;
    }
    held.retain(|depth| depth.action != "all" && depth.last_update_id > snapshot_id);
    held.sort_by_key(|depth| depth.last_update_id);

    let mut book = OrderBook::default();
    book.reset(&snapshot.bids, &snapshot.asks);
    let mut last_id = snapshot_id;
    for depth in &held {
        if depth.last_update_id == last_id {
            conn.resync(symbol, "sequence_gap");
            return;
        }
        last_id = depth.last_update_id;
        set_levels(&mut book, depth);
    }
    if is_crossed(&book) {
        conn.resync(symbol, "crossed_book");
        return;
    }

    conn.state.sequences.insert(position, Sequence { snapshot_id, last_id });
    conn.reset_book(position, book.bids(), book.asks());
}

fn apply_update(position: usize, symbol: &str, depth: &Depth, conn: &mut Connection<State>) {
    let Some(sequence) = conn.state.sequences.get_mut(&position) else {
        return;
    };
    if depth.last_update_id <= sequence.snapshot_id {
        return;
    }

    // The docs promise one more than the last id, but ids skip forward by 2 to 9 with no change lost, so only a step back is a gap.
    if depth.last_update_id <= sequence.last_id {
        conn.resync(symbol, "sequence_gap");
        return;
    }
    sequence.last_id = depth.last_update_id;

    let Some(book) = conn.book(position) else {
        return;
    };
    set_levels(book, depth);

    // A skipped id cannot reveal a lost update, and a crossed top can, since none crossed in normal running.
    if is_crossed(book) {
        conn.resync(symbol, "crossed_book");
        return;
    }
    conn.publish(position);
}

// An ask array often runs worst first, so levels go in by price.
fn set_levels(book: &mut OrderBook, depth: &Depth) {
    for level in &depth.bids {
        book.set_bid(level.price, level.size);
    }
    for level in &depth.asks {
        book.set_ask(level.price, level.size);
    }
}

fn is_crossed(book: &OrderBook) -> bool {
    matches!((book.bids().first(), book.asks().first()), (Some(bid), Some(ask)) if bid.price >= ask.price)
}

// Books, acknowledgements and errors share the envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    id: Option<Cow<'a, str>>, // the subscribe's id, on an acknowledgement only
    #[serde(default)]
    code: i64, // 0, or 80015 for a refused topic, 80403 over the topic cap, 100400 for an unknown request
    #[serde(borrow)]
    msg: Option<Cow<'a, str>>,
    #[serde(borrow, rename = "dataType")]
    data_type: Option<Cow<'a, str>>, // "BTC-USDT@incrDepth" on a book, "" on an acknowledgement
    data: Option<Depth>, // null on an acknowledgement
}

#[derive(Deserialize)]
struct Depth {
    #[serde(default)]
    action: String, // "all" on the snapshot, "update" after it
    #[serde(default, rename = "lastUpdateId")]
    last_update_id: i64,
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // [price, coins] strings, where a size of zero deletes the level
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
}
