mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::order_book::OrderBook;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::{Deserialize, Deserializer};
use std::borrow::Cow;
use std::collections::HashMap;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "hibachi";

// Every public call is a GET on the data host, which also serves the market socket.
const REST: &str = "https://data-api.hibachi.xyz";

const URL: &str = "wss://data-api.hibachi.xyz/ws/market";

// A snapshot on subscribe, then one frame per market every 302 ms of absolute sizes by price, changed or not.
// No frame carries a sequence or a checksum.
const TOPIC: &str = "orderbook";
const DEPTH: usize = 20;

// 60 subscriptions on one socket were all served on 2026-10-12, and no cap is published.
const MARKETS_PER_CONNECTION: usize = 60;

// A fresh snapshot came 104 to 198 ms after a subscribe, so a market still without a good one this long after its request asks again.
// A market asks at most once per wait, so a snapshot that keeps failing the window check cannot ask every 110 ms.
const RESEED_WAIT_MS: i64 = 5_000;

pub struct Hibachi {
    rest: String,
}

impl Hibachi {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self { rest: rest.to_string() }
    }
}

#[derive(Default)]
pub struct State {
    tracks: HashMap<usize, Track>, // by position, from the market's first book frame on this connection
}

// The book lives here and the engine gets a copy, so a crossed book is held back while its frames still apply.
#[derive(Default)]
struct Track {
    book: OrderBook,
    awaiting_snapshot: bool,      // after a reseed, the updates are dropped until the fresh snapshot
    resubscribed_at: Option<i64>, // arrival of the frame that last sent the market's unsubscribe and subscribe
    crossed_at: Option<i64>,      // arrival of the frame that crossed the top, while the engine holds an empty book
}

impl BookVenue for Hibachi {
    type State = State;

    // Every market sends a frame every 302 ms, so 10 s of silence is a dead socket.
    // The server sends no ping and closes a socket silent for 60 s with no stream on it, and it answers a protocol ping in about 110 ms.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(20)),
            ..FeedSettings::new(Duration::from_secs(10))
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

    // One frame per market, since an unknown symbol voids every subscription in its frame.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for market in markets {
            frames.push(book_frame("subscribe", &market.raw_market_id));
        }
        frames
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
        let at = conn.frame_recv_ts();
        handle_at(frame, conn, at)
    }
}

// `at` is the frame's arrival, which times a reseed and a crossing.
fn handle_at(frame: &[u8], conn: &mut Connection<State>, at: i64) -> anyhow::Result<()> {
    let frame: Frame = serde_json::from_slice(frame)?;

    if frame.topic.as_deref() == Some(TOPIC)
        && let Some(symbol) = frame.symbol.as_deref()
        && let Some(data) = &frame.data
    {
        let depth = frame.depth.unwrap_or(DEPTH);
        match frame.message_type.as_deref() {
            Some("Snapshot") => apply_book(symbol, true, data, depth, conn, at),
            Some("Update") => apply_book(symbol, false, data, depth, conn, at),
            kind => tracing::warn!(event = "venue_notice", connection = conn.id(), market = symbol, kind = kind.unwrap_or("")),
        }
    } else if let Some(error) = &frame.error {
        // An unknown symbol or a refused parameter, and the socket stays open.
        tracing::error!(
            event = "venue_error",
            connection = conn.id(),
            message = %error,
            request = frame.original_request.as_deref().unwrap_or(""),
        );
    } else {
        tracing::warn!(event = "venue_notice", connection = conn.id(), topic = frame.topic.as_deref().unwrap_or(""));
    }

    reseed_overdue(conn, at);
    Ok(())
}

fn book_frame(method: &str, symbol: &str) -> Message {
    let subscription = serde_json::json!({ "symbol": symbol, "topic": TOPIC, "depth": DEPTH });
    let frame = serde_json::json!({ "method": method, "parameters": { "subscriptions": [subscription] } });
    Message::text(frame.to_string())
}

fn apply_book(symbol: &str, snapshot: bool, data: &BookData, depth: usize, conn: &mut Connection<State>, at: i64) {
    let Some(position) = conn.position(symbol) else {
        return;
    };

    let mut track = match conn.state.tracks.remove(&position) {
        Some(track) => track,
        None if snapshot => Track::default(),
        None => {
            reseed(position, Track::default(), "update_before_snapshot", conn, at);
            return;
        }
    };

    // A frame of the old stream, already on its way when the unsubscribe went out.
    if !snapshot && track.awaiting_snapshot {
        conn.state.tracks.insert(position, track);
        return;
    }

    // The book would skip such a level, so a deletion it carried would stay in a book that looks live.
    if !readable(&data.bid.levels) || !readable(&data.ask.levels) {
        reseed(position, track, "level_unreadable", conn, at);
        return;
    }

    if snapshot {
        track.awaiting_snapshot = false;
        track.book.reset(&data.bid.levels, &data.ask.levels);
    } else {
        for level in &data.bid.levels {
            track.book.set_bid(level.price, level.size);
        }
        for level in &data.ask.levels {
            track.book.set_ask(level.price, level.size);
        }
    }

    if let Some(reason) = window_issue(&track.book, data, depth) {
        reseed(position, track, reason, conn, at);
        return;
    }

    let changed = snapshot || !data.bid.levels.is_empty() || !data.ask.levels.is_empty();

    // A reopening call auction lets the book cross while nothing trades, so the engine holds an empty book until a frame uncrosses it.
    // A reseed would only fetch the same crossed book.
    if is_crossed(&track.book) {
        if track.crossed_at.is_none() {
            track.crossed_at = Some(at);
            let (bid, ask) = (track.book.bids()[0].price, track.book.asks()[0].price);
            tracing::warn!(event = "book_crossed", connection = conn.id(), market = symbol, bid, ask);
            hold_empty(position, conn);
        }
    } else if let Some(crossed_at) = track.crossed_at.take() {
        tracing::info!(event = "book_uncrossed", connection = conn.id(), market = symbol, crossed_ms = at - crossed_at);
        conn.reset_book(position, track.book.bids(), track.book.asks());
    } else if changed {
        conn.reset_book(position, track.book.bids(), track.book.asks());
    }

    conn.state.tracks.insert(position, track);
}

// After each frame the venue names every side's best and worst price, and a side holds at most the depth.
// With no sequence, this is what shows a frame the book never got.
fn window_issue(book: &OrderBook, data: &BookData, depth: usize) -> Option<&'static str> {
    for (levels, side) in [(book.bids(), &data.bid), (book.asks(), &data.ask)] {
        if levels.len() > depth {
            return Some("window_overfull");
        }
        let matches = match (levels.first(), levels.last()) {
            (Some(best), Some(worst)) => best.price == side.start_price && worst.price == side.end_price,
            // No side was ever empty on 2026-10-12, so an empty side is taken as right while the window names no price.
            _ => !(side.start_price > 0.0 || side.end_price > 0.0),
        };
        if !matches {
            return Some("window_mismatch");
        }
    }
    None
}

// The engine holds an empty book until the fresh snapshot, since the one it has may already be wrong.
// Its unsubscribe and subscribe go out in that order, because a second subscribe to a live stream brings no snapshot.
// Named book_resync like the runtime's own resync, so live_smoke fails on it, although the connection stays open.
fn reseed(position: usize, mut track: Track, reason: &str, conn: &mut Connection<State>, at: i64) {
    let market = conn.markets()[position].raw_market_id.as_str();
    tracing::warn!(event = "book_resync", connection = conn.id(), market, reason, action = "resubscribe");

    track.book = OrderBook::default();
    track.crossed_at = None;
    track.awaiting_snapshot = true;
    hold_empty(position, conn);
    // Asked within the wait already, so reseed_overdue asks again once it has passed.
    if track.resubscribed_at.is_none_or(|sent_at| at - sent_at >= RESEED_WAIT_MS) {
        resubscribe(position, &mut track, conn, at);
    }
    conn.state.tracks.insert(position, track);
}

fn resubscribe(position: usize, track: &mut Track, conn: &mut Connection<State>, at: i64) {
    let market = conn.markets()[position].raw_market_id.as_str();
    let unsubscribe = book_frame("unsubscribe", market);
    let subscribe = book_frame("subscribe", market);
    conn.send(unsubscribe);
    conn.send(subscribe);
    track.resubscribed_at = Some(at);
}

// A market still without a good snapshot a wait after its last request asks again, as when its subscribe was lost.
// Its own frames may have stopped, so every frame of the connection checks the whole table.
fn reseed_overdue(conn: &mut Connection<State>, at: i64) {
    let mut overdue = Vec::new();
    for (&position, track) in &conn.state.tracks {
        if track.awaiting_snapshot && track.resubscribed_at.is_some_and(|sent_at| at - sent_at >= RESEED_WAIT_MS) {
            overdue.push(position);
        }
    }

    for position in overdue {
        let market = conn.markets()[position].raw_market_id.as_str();
        tracing::warn!(event = "book_resync", connection = conn.id(), market, reason = "snapshot_missing", action = "resubscribe");
        if let Some(mut track) = conn.state.tracks.remove(&position) {
            resubscribe(position, &mut track, conn, at);
            conn.state.tracks.insert(position, track);
        }
    }
}

// Sends an empty book only when the engine holds levels, so it never gets the same empty book twice.
fn hold_empty(position: usize, conn: &mut Connection<State>) {
    if conn.book(position).is_some_and(|book| !book.bids().is_empty() || !book.asks().is_empty()) {
        conn.reset_book(position, &[], &[]);
    }
}

fn is_crossed(book: &OrderBook) -> bool {
    matches!((book.bids().first(), book.asks().first()), (Some(bid), Some(ask)) if bid.price >= ask.price)
}

// The rule OrderBook applies to each level, where a size of 0 deletes.
fn readable(levels: &[BookLevel]) -> bool {
    levels.iter().all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

// Books and errors share the envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    topic: Option<Cow<'a, str>>, // "orderbook", absent on an error
    #[serde(borrow)]
    symbol: Option<Cow<'a, str>>, // "BTC/USDT-P", the raw market id
    #[serde(rename = "messageType", borrow)]
    message_type: Option<Cow<'a, str>>, // "Snapshot" or "Update"
    data: Option<BookData>,
    depth: Option<usize>, // the most levels a side holds, as subscribed
    error: Option<String>, // "Could not find symbol \"FOO/USDT-P\"."
    original_request: Option<String>, // the refused frame as text
}

#[derive(Deserialize, Default)]
struct BookData {
    #[serde(default)]
    bid: Side,
    #[serde(default)]
    ask: Side,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct Side {
    #[serde(default, deserialize_with = "levels")]
    levels: Vec<BookLevel>, // the levels that changed, or the whole window on a snapshot, best first
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    start_price: f64, // the best price of the window after the frame
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    end_price: f64, // the worst
}

// {"price":"82570.7","quantity":"0.0605577541"}, where 0 deletes the level.
#[derive(Deserialize)]
struct Level {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    quantity: f64, // coins of the underlying, which is CCXT's contract size of 1
}

// A null reads as no levels, and a number that is not one reads as NaN for readable to catch.
fn levels<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<BookLevel>, D::Error> {
    let levels = Option::<Vec<Level>>::deserialize(deserializer)?.unwrap_or_default();
    Ok(levels.iter().map(|level| BookLevel { price: level.price, size: level.quantity }).collect())
}
