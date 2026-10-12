mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "trubitpro";

const REST: &str = "https://api-futures.trubit.com";

// One socket carries every perpetual, and all 40 delivered on one socket at about 38 KB/s on 2026-09-24.
const URL: &str = "wss://api-futures.trubit.com/ws/market";
const MARKETS_PER_CONNECTION: usize = 50;

const CHANNEL: &str = "depthUpdate";
const BOOK_FIELD: &[u8] = b"Depth\":"; // the end of "buyDepth": and "sellDepth":, which only book frames carry

// The top 20 levels a side, the most the call returns and the window the socket keeps, documented at 10 calls a second per IP.
const DEPTH_PATH: &str = "/market/api/v1/depth/list";
const SNAPSHOT_LEVELS: u32 = 20;

// No frame carries a sequence, so a lost frame is invisible, and each book is seeded again from REST on this period.
const RESEED_EVERY_MS: i64 = 60_000;

// A reply that carried no book is logged on the first failure and every 30th, as the runtime logs a failed fetch.
const SNAPSHOT_FAILURE_LOG_EVERY: u32 = 30;

pub struct TrubitPro {
    rest: String,
    symbols: Mutex<Vec<String>>, // the funding call's symbols, since one unknown symbol fails the whole call
}

impl TrubitPro {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(REST, markets)
    }

    fn with_rest(rest: &str, markets: &[TrackedMarket]) -> Self {
        let symbols = markets.iter().map(|tracked| tracked.market.raw_market_id.clone()).collect();
        Self {
            rest: rest.to_string(),
            symbols: Mutex::new(symbols),
        }
    }
}

#[derive(Default)]
pub struct State {
    seeds: HashMap<usize, Seed>, // by position, from the subscribe acknowledgement on
    snapshot_failures: u32, // consecutive depth replies that carried no book, on this connection
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Seed {
    // The snapshot is requested, and frames are dropped until it arrives, since the book they change is not known yet.
    Waiting,
    // Frames apply by price, and the next frame after seeded_at plus RESEED_EVERY_MS requests a fresh snapshot.
    Live { seeded_at: i64 },
}

impl BookVenue for TrubitPro {
    type State = State;

    // The server sends no ping, so the pong of a text ping every 5 s is the traffic a quiet socket relies on.
    // The quietest contract went 2.8 s without a frame on 2026-09-24, so 15 s of silence is three missed pongs.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(5)),
            // Five depth calls a second against the documented 10, and 40 markets seed in about 8 s.
            snapshot_gap: Duration::from_millis(200),
            first_book_wait: Duration::from_secs(20),
            ..FeedSettings::new(Duration::from_secs(15))
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

    // One symbol per frame is the only documented form, and a burst of 40 was acknowledged whole.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for market in markets {
            let frame = serde_json::json!({ "op": "subscribe", "key": market.raw_market_id, "channel": CHANNEL });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    // {"op":"ping"} is refused as "failed to deSerialize", and the bare text is answered with the bare text pong.
    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text("ping")
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        if frame == b"pong" {
            return Ok(());
        }

        let parsed: Frame = match serde_json::from_slice(frame) {
            Ok(parsed) => parsed,
            Err(error) => {
                unreadable_book_frame(frame, conn);
                return Err(error.into());
            }
        };

        if let Some(key) = parsed.key.as_deref()
            && (parsed.buy_depth.is_some() || parsed.sell_depth.is_some())
        {
            apply_frame(key, &parsed, conn);
            return Ok(());
        }

        if let Some(message) = &parsed.err_msg {
            tracing::error!(event = "venue_error", connection = conn.id(), message = %message);
            return Ok(());
        }

        match (parsed.success, parsed.sub_key.as_deref()) {
            (Some(true), Some(sub_key)) => acknowledge(sub_key, conn),
            (Some(false), _) => {
                tracing::error!(event = "venue_error", connection = conn.id(), frame = %String::from_utf8_lossy(frame));
            }
            // {"state":true,"message":"On connect","tag":0,"key":null} opens every socket.
            _ if parsed.state == Some(true) => {
                tracing::debug!(event = "venue_connected", connection = conn.id());
            }
            _ => tracing::warn!(event = "venue_notice", connection = conn.id(), frame = %String::from_utf8_lossy(frame)),
        }

        Ok(())
    }

    fn snapshot_url(&self, market: &Market) -> Option<String> {
        Some(format!(
            "{}{DEPTH_PATH}?symbol={}&level={SNAPSHOT_LEVELS}",
            self.rest, market.raw_market_id
        ))
    }

    // The depth reply replaces the book, and the frames that arrive after it apply on top, as the profile's rebuild matched REST on 60 of 60 checks.
    // An error arrives as HTTP 200 with a code other than 0, so such a reply is fetched again like a failed fetch.
    fn handle_snapshot(&self, position: usize, body: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let depth = match serde_json::from_slice::<Snapshot>(body) {
            Ok(Snapshot { code: 0, result: Some(depth), .. }) => depth,
            Ok(snapshot) => {
                failed_reply(position, &format!("code {}: {}", snapshot.code, snapshot.message), conn);
                return Ok(());
            }
            Err(error) => {
                failed_reply(position, &format!("the depth reply is not JSON: {error}"), conn);
                return Ok(());
            }
        };

        let (Some(bids), Some(asks)) = (levels(&depth.buy_depth), levels(&depth.sell_depth)) else {
            failed_reply(position, "the depth reply holds a level it cannot read", conn);
            return Ok(());
        };
        if let (Some(bid), Some(ask)) = (bids.first(), asks.first())
            && bid.price >= ask.price
        {
            failed_reply(position, &format!("the depth reply is crossed, bid {} ask {}", bid.price, ask.price), conn);
            return Ok(());
        }
        conn.state.snapshot_failures = 0;

        conn.reset_book(position, &bids, &asks);
        let seeded_at = conn.frame_recv_ts();
        conn.state.seeds.insert(position, Seed::Live { seeded_at });
        Ok(())
    }
}

// An unknown symbol is acknowledged with success true and then stays silent, which the runtime's unserved check reports.
// Each acknowledged market asks for its snapshot here, so a quiet book seeds without waiting for a frame.
fn acknowledge(sub_key: &str, conn: &mut Connection<State>) {
    let Some(position) = conn.position(sub_key) else {
        return;
    };
    if !conn.state.seeds.contains_key(&position) {
        conn.state.seeds.insert(position, Seed::Waiting);
        conn.request_snapshot(position);
    }
}

fn apply_frame(key: &str, frame: &Frame, conn: &mut Connection<State>) {
    let Some(position) = conn.position(key) else {
        return;
    };

    let seeded_at = match conn.state.seeds.get(&position) {
        Some(Seed::Live { seeded_at }) => *seeded_at,
        Some(Seed::Waiting) => return,
        // A frame ahead of the acknowledgement, which the venue was not seen to send.
        None => {
            conn.state.seeds.insert(position, Seed::Waiting);
            conn.request_snapshot(position);
            return;
        }
    };

    let Some(book) = conn.book(position) else {
        return;
    };
    let mut readable = true;
    for level in frame.buy_depth.iter().flatten() {
        readable &= book.set_bid(level.price, base_size(level));
    }
    for level in frame.sell_depth.iter().flatten() {
        readable &= book.set_ask(level.price, base_size(level));
    }
    let crossed = match (book.bids().first(), book.asks().first()) {
        (Some(bid), Some(ask)) => bid.price >= ask.price,
        _ => false,
    };
    let window = SNAPSHOT_LEVELS as usize;
    let deeper = book.bids().len() > window || book.asks().len() > window;

    // Without a sequence, a level that cannot be read, a crossed top or a side past the window are the only signs of a lost frame.
    // The venue deletes each level that leaves its 20 level window, so a 21st level is one whose delete was lost.
    if !readable {
        reseed(position, "unreadable_level", conn);
        return;
    }
    if crossed {
        reseed(position, "crossed_book", conn);
        return;
    }
    if deeper {
        reseed(position, "deeper_than_window", conn);
        return;
    }

    conn.publish(position);
    if conn.frame_recv_ts() - seeded_at >= RESEED_EVERY_MS {
        conn.request_snapshot(position);
    }
}

// A book frame that does not parse leaves its changes out until the next reseed, so the live market it names reseeds now.
// A frame whose key does not read could be any market, so the whole connection resyncs.
fn unreadable_book_frame(frame: &[u8], conn: &mut Connection<State>) {
    if !frame.windows(BOOK_FIELD.len()).any(|window| window == BOOK_FIELD) {
        return;
    }
    let Some(key) = serde_json::from_slice::<Envelope>(frame).ok().and_then(|envelope| envelope.key) else {
        conn.resync("", "book_frame_unreadable");
        return;
    };
    if let Some(position) = conn.position(&key)
        && matches!(conn.state.seeds.get(&position), Some(Seed::Live { .. }))
    {
        reseed(position, "book_frame_unreadable", conn);
    }
}

// Empties this market's book, so the engine never holds a book known to be wrong, and seeds it again while the other markets carry on.
fn reseed(position: usize, reason: &str, conn: &mut Connection<State>) {
    let market = conn.markets()[position].raw_market_id.as_str();
    tracing::warn!(event = "book_reseed", connection = conn.id(), market, reason);
    conn.reset_book(position, &[], &[]);
    conn.state.seeds.insert(position, Seed::Waiting);
    conn.request_snapshot(position);
}

// A bad reply leaves a live book in place, and a waiting one waits for the next fetch.
fn failed_reply(position: usize, error: &str, conn: &mut Connection<State>) {
    conn.request_snapshot(position);
    conn.state.snapshot_failures += 1;
    let failures = conn.state.snapshot_failures;
    if failures == 1 || failures % SNAPSHOT_FAILURE_LOG_EVERY == 0 {
        let market = conn.markets()[position].raw_market_id.as_str();
        tracing::warn!(event = "snapshot_failed", connection = conn.id(), market, failures, error);
    }
}

// qty is USDT notional, "1Qty=1USDT", so a level holds qty / price coins, and a qty of 0 deletes it.
fn base_size(level: &Level) -> f64 {
    if level.qty == 0.0 { 0.0 } else { level.qty / level.price }
}

// None when a level does not read, since OrderBook::reset would skip it without a word.
fn levels(rows: &[Level]) -> Option<Vec<BookLevel>> {
    let mut levels = Vec::with_capacity(rows.len());
    for row in rows {
        let size = base_size(row);
        if !row.price.is_finite() || row.price <= 0.0 || !size.is_finite() || size < 0.0 {
            return None;
        }
        levels.push(BookLevel { price: row.price, size });
    }
    Some(levels)
}

// Book frames carry key and the two depth arrays, acknowledgements success and subKey, errors errMsg, and the open notice state.
// The trades array beside the depth is skipped.
#[derive(Deserialize)]
struct Frame {
    key: Option<String>, // "BTCUSDT" on a book frame, null on the others
    #[serde(rename = "buyDepth")]
    buy_depth: Option<Vec<Level>>, // changed levels by price, in no reliable order
    #[serde(rename = "sellDepth")]
    sell_depth: Option<Vec<Level>>,
    success: Option<bool>,
    #[serde(rename = "subKey")]
    sub_key: Option<String>,
    #[serde(rename = "errMsg")]
    err_msg: Option<String>, // "failed to deSerialize"
    state: Option<bool>,
}

// The market an unreadable book frame names, when that much of it reads.
#[derive(Deserialize)]
struct Envelope {
    key: Option<String>,
}

#[derive(Deserialize)]
struct Level {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    qty: f64, // USDT notional, a whole number
}

#[derive(Deserialize)]
struct Snapshot {
    #[serde(default = "no_code")]
    code: i64, // 0 on success, 24001 for an unknown symbol
    #[serde(default, alias = "msg")]
    message: String,
    result: Option<Depth>,
}

// A reply without a code is an error, not a success.
fn no_code() -> i64 {
    -1
}

#[derive(Deserialize)]
struct Depth {
    #[serde(rename = "buyDepth", default)]
    buy_depth: Vec<Level>, // best first
    #[serde(rename = "sellDepth", default)]
    sell_depth: Vec<Level>,
}
