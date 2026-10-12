mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::socket_anchors::SocketAnchors;
use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::order_book::OrderBook;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use anchor::FundingCycles;
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "deepcoin";

const REST: &str = "https://api.deepcoin.com";

// One address carries the USDT and the inverse perpetuals alike.
const SWAP_URL: &str = "wss://stream.deepcoin.com/streamlet/trade/public/swap?platform=api";

// The book of up to 60 levels, a snapshot then deltas every 200 ms, with no sequence and no checksum.
const BOOK_TOPIC: &str = "25";
// The ticker, the only source of the index, which also carries the mark, the upcoming rate and the next settlement.
const TICKER_TOPIC: &str = "7";

// No depth parameter exists, and a book kept from the deltas grew to 72 levels because a level leaving the window is not always deleted.
const DEPTH: usize = 60;

// 35 books on one socket ran clean, while 348 crossed 8 to 26 books per 45 s.
// The venue allows 10 sockets per IP, so a larger catalog spreads over the 10 rather than opening an 11th.
const MARKETS_PER_CONNECTION: usize = 35;
const MAX_CONNECTIONS: usize = 10;

// A snapshot can be lost like any push, so a stream still without one this long after its subscribe is subscribed again.
// A repeated subscribe is answered with a snapshot in about 170 ms.
const SNAPSHOT_WAIT_MS: i64 = 5_000;
// A lost push can leave a level that never crosses, so every book is resubscribed this often, which bounds how long such a level stands.
// On 2026-10-09 two rounds of resubscribes on 35 live streams each brought one snapshot per stream and left the delta rate unchanged.
const REFRESH_MS: i64 = 30_000;

pub struct Deepcoin {
    rest: String,
    anchors: SocketAnchors,               // filled by handle, read by fetch_round
    funding_cycles: Mutex<FundingCycles>, // the interval of each market, read from REST by fetch_round
    tracked: usize,                       // markets on the book sockets, which fetch_round waits for at boot
    first_round: OnceLock<Instant>,
}

impl Deepcoin {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(REST, markets.len())
    }

    fn with_rest(rest: &str, tracked: usize) -> Self {
        Self {
            rest: rest.to_string(),
            anchors: SocketAnchors::new(true),
            funding_cycles: Mutex::new(FundingCycles::default()),
            tracked,
            first_round: OnceLock::new(),
        }
    }
}

#[derive(Default)]
pub struct State {
    positions: HashMap<String, usize>,  // the wire id the frames carry, "BTCUSDT", to its position
    resubscribed: HashSet<usize>,       // crossed books whose deltas are dropped until their next snapshot
    subscribed_at: HashMap<usize, i64>, // arrival of each book's last snapshot or resubscribe, or of its first delta before any snapshot
}

impl BookVenue for Deepcoin {
    type State = State;

    // The server closes a socket 20 s after the last ping whatever data flows, and answers each ping with a pong.
    // A quiet book went 39 s without a frame, so the pongs are what keep the silence under 25 s.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(10)),
            // A burst of 348 subscribes lost the socket, and 20 per 100 ms were all served.
            subscribe_gap: Duration::from_millis(5),
            connect_stagger: Duration::from_millis(500),
            ..FeedSettings::new(Duration::from_secs(25))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let connections = markets.len().div_ceil(MARKETS_PER_CONNECTION).clamp(1, MAX_CONNECTIONS);
        let per_connection = markets.len().div_ceil(connections).max(1);

        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(per_connection).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#swap#{i}"),
                url: SWAP_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // One stream per frame, the book then the ticker of each market.
    fn subscribe_frames(&self, markets: &[Market], state: &mut State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len() * 2);
        for (position, market) in markets.iter().enumerate() {
            let wire_id = wire_id(&market.raw_market_id);
            state.positions.insert(wire_id.to_string(), position);
            frames.push(book_subscribe(market, position));
            frames.push(subscribe(TICKER_TOPIC, wire_id, markets.len() + position + 1));
        }
        frames
    }

    fn ping(&self, _state: &mut State) -> Message {
        Message::text("ping")
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
        let at = conn.frame_recv_ts();
        self.handle_at(frame, conn, at)
    }
}

impl Deepcoin {
    // `at` is the frame's arrival, which stamps the anchor fields it carries unless the push's own time is older.
    fn handle_at(&self, frame: &[u8], conn: &mut Connection<State>, at: i64) -> anyhow::Result<()> {
        // The answer to the text ping, which only counts as traffic.
        if frame == b"pong" {
            return Ok(());
        }

        let frame: Frame = serde_json::from_slice(frame)?;
        match frame.a.as_ref() {
            "PMO" => apply_book(&frame, conn, at),
            "PO" => self.apply_ticker(frame.r.as_deref().unwrap_or_default(), conn, ticker_ts(at, frame.mt)),
            // A refused stream is acknowledged with the reason in m, such as "orderbook does not exist: NOPEUSDT_0.1, no available orderbook data".
            "RecvTopicAction" if frame.m == "Success" => {}
            _ => tracing::error!(event = "venue_error", connection = conn.id(), action = %frame.a, message = %frame.m),
        }
        Ok(())
    }

    fn apply_ticker(&self, entries: &[Entry], conn: &mut Connection<State>, at: i64) {
        for entry in entries {
            let data = &entry.d;
            let Some(position) = position_of(&data.instrument, conn) else {
                continue;
            };
            let raw_market_id = conn.markets()[position].raw_market_id.as_str();

            if data.side_or_index.is_finite() {
                self.anchors.set_index(raw_market_id, data.side_or_index, at);
            }
            if data.mark.is_finite() {
                self.anchors.set_mark(raw_market_id, data.mark, at);
            }
            // A market missing from the funding cycle table gets no interval, which keeps its row out until the table names it.
            if data.funding_rate.is_finite() {
                let interval_hours = self.funding_cycles.lock().unwrap().interval_hours(&data.instrument);
                let next_funding_at = if data.next_funding.is_finite() && data.next_funding > 0.0 {
                    (data.next_funding * 1_000.0) as i64
                } else {
                    0
                };
                self.anchors.set_funding(raw_market_id, data.funding_rate, interval_hours, next_funding_at);
            }
        }
    }
}

// The first push after a subscribe is the venue's cached last ticker, whose mt was up to 5.3 s before its arrival on 2026-10-09.
// A later push arrives about 100 ms after its mt, so the older of the two keeps a row from reading fresher than its prices.
fn ticker_ts(arrival: i64, mt: f64) -> i64 {
    if mt.is_finite() && mt > 0.0 { arrival.min(mt as i64) } else { arrival }
}

// "BTCUSDT_0.1" is the venue's name for the book, the wire id then the tick size the stream must name.
fn wire_id(raw_market_id: &str) -> &str {
    raw_market_id.rsplit_once('_').map_or(raw_market_id, |(wire_id, _tick)| wire_id)
}

fn subscribe(topic: &str, filter: &str, local_no: usize) -> Message {
    let frame = serde_json::json!({
        "SendTopicAction": {
            "Action": "1",
            "FilterValue": format!("DeepCoin_{filter}"),
            "LocalNo": local_no,
            "ResumeNo": -1,
            "TopicID": topic,
        }
    });
    Message::text(frame.to_string())
}

// A repeated subscribe on the same socket is answered with a fresh snapshot, and the stream is not doubled.
fn book_subscribe(market: &Market, position: usize) -> Message {
    subscribe(BOOK_TOPIC, &market.raw_market_id, position + 1)
}

// An unknown wire id falls through to the connection's lookup, which logs the first drop of each.
fn position_of(wire_id: &str, conn: &mut Connection<State>) -> Option<usize> {
    match conn.state.positions.get(wire_id) {
        Some(&position) => Some(position),
        None => conn.position(wire_id),
    }
}

// Every capture held one market per frame, and each run of one market's levels is applied on its own in case a frame holds several.
fn apply_book(frame: &Frame, conn: &mut Connection<State>, at: i64) {
    let snapshot = match frame.t.as_ref() {
        "f" => true,
        "i" => false,
        _ => {
            tracing::warn!(event = "venue_notice", connection = conn.id(), reason = "unknown_book_type", kind = %frame.t);
            return;
        }
    };

    let entries = frame.r.as_deref().unwrap_or_default();
    let mut start = 0;
    while start < entries.len() {
        let instrument = &entries[start].d.instrument;
        let run = entries[start..].iter().take_while(|entry| entry.d.instrument == *instrument).count();
        let levels = &entries[start..start + run];
        start += run;

        let Some(position) = position_of(instrument, conn) else {
            continue;
        };
        if snapshot {
            apply_snapshot(position, levels, conn, at);
        } else {
            apply_delta(position, levels, conn, at);
        }
    }
}

// The first frame of a stream, and also a mid-stream frame nobody asked for, so every one replaces the book.
fn apply_snapshot(position: usize, levels: &[Entry], conn: &mut Connection<State>, at: i64) {
    let mut bids = Vec::with_capacity(levels.len());
    let mut asks = Vec::with_capacity(levels.len());
    for entry in levels {
        let level = BookLevel {
            price: entry.d.price,
            size: entry.d.size,
        };
        match side(&entry.d) {
            Some(Side::Bid) => bids.push(level),
            Some(Side::Ask) => asks.push(level),
            None => {}
        }
    }

    conn.state.resubscribed.remove(&position);
    conn.state.subscribed_at.insert(position, at);
    conn.reset_book(position, &bids, &asks);
    let Some(book) = conn.book(position) else {
        return;
    };
    trim(book);

    // No crossed snapshot was seen live.
    // One waits SNAPSHOT_WAIT_MS for its next subscribe, so a venue that keeps sending crossed snapshots is not asked every 200 ms.
    if is_crossed(book) {
        empty_until_snapshot(position, conn, "crossed_snapshot");
    }
}

// No sequence exists, so a lost push shows only when it leaves the book crossed, and REFRESH_MS bounds the levels that never cross.
// A crossed stream is resubscribed on the same socket, which answers with a fresh snapshot in about 170 ms, and its deltas are dropped until that arrives.
fn apply_delta(position: usize, levels: &[Entry], conn: &mut Connection<State>, at: i64) {
    let since = at - *conn.state.subscribed_at.entry(position).or_insert(at);

    // Every stream starts with its snapshot, so a delta before one has nothing to apply to.
    if conn.state.resubscribed.contains(&position) || conn.book(position).is_none() {
        if since >= SNAPSHOT_WAIT_MS {
            log_resync(position, conn, "snapshot_missing");
            resubscribe(position, conn, at);
        }
        return;
    }
    let Some(book) = conn.book(position) else {
        return;
    };

    // Levels arrive unordered, so each is applied by price, and a size of 0 deletes it.
    for entry in levels {
        match side(&entry.d) {
            Some(Side::Bid) => book.set_bid(entry.d.price, entry.d.size),
            Some(Side::Ask) => book.set_ask(entry.d.price, entry.d.size),
            None => false,
        };
    }
    trim(book);

    if is_crossed(book) {
        empty_until_snapshot(position, conn, "crossed_book");
        resubscribe(position, conn, at);
        return;
    }
    conn.publish(position);

    // The book stays published until the fresh snapshot replaces it.
    if since >= REFRESH_MS {
        tracing::debug!(event = "book_refresh", connection = conn.id(), market = %conn.markets()[position].raw_market_id);
        resubscribe(position, conn, at);
    }
}

// The book goes out empty while the new snapshot is on its way, so the engine never holds the levels that crossed.
fn empty_until_snapshot(position: usize, conn: &mut Connection<State>, reason: &str) {
    log_resync(position, conn, reason);
    conn.state.resubscribed.insert(position);
    conn.reset_book(position, &[], &[]);
}

// Named book_resync like the runtime's own resync, so live_smoke fails on it, although the connection stays open.
fn log_resync(position: usize, conn: &Connection<State>, reason: &str) {
    tracing::warn!(
        event = "book_resync",
        connection = conn.id(),
        market = %conn.markets()[position].raw_market_id,
        reason,
        action = "resubscribe",
    );
}

fn resubscribe(position: usize, conn: &mut Connection<State>, at: i64) {
    let frame = book_subscribe(&conn.markets()[position], position);
    conn.state.subscribed_at.insert(position, at);
    conn.send(frame);
}

fn trim(book: &mut OrderBook) {
    while book.bids().len() > DEPTH {
        let price = book.bids()[DEPTH].price;
        book.set_bid(price, 0.0);
    }
    while book.asks().len() > DEPTH {
        let price = book.asks()[DEPTH].price;
        book.set_ask(price, 0.0);
    }
}

fn is_crossed(book: &OrderBook) -> bool {
    matches!((book.bids().first(), book.asks().first()), (Some(bid), Some(ask)) if bid.price >= ask.price)
}

enum Side {
    Bid,
    Ask,
}

fn side(data: &Data) -> Option<Side> {
    if data.side_or_index == 0.0 {
        Some(Side::Bid)
    } else if data.side_or_index == 1.0 {
        Some(Side::Ask)
    } else {
        None
    }
}

// Books, tickers, acknowledgements and errors share the envelope.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(default, borrow)]
    a: Cow<'a, str>, // "PMO" a book, "PO" a ticker, "RecvTopicAction" an acknowledgement, "" an unreadable request
    #[serde(default, borrow)]
    m: Cow<'a, str>, // "Success", or the reason a request failed
    #[serde(default, borrow)]
    t: Cow<'a, str>, // "f" a snapshot, "i" a delta, on a book
    #[serde(borrow)]
    r: Option<Vec<Entry<'a>>>, // null on an unreadable request
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mt: f64, // the push's server time in Unix ms
}

#[derive(Deserialize)]
struct Entry<'a> {
    #[serde(borrow)]
    d: Data<'a>,
}

// A book level and a ticker share the entry, and their D means different things.
#[derive(Deserialize)]
struct Data<'a> {
    #[serde(rename = "I", default, borrow)]
    instrument: Cow<'a, str>, // the wire id, "BTCUSDT", absent on an acknowledgement
    #[serde(rename = "D", default = "wire::nan", deserialize_with = "wire::num")]
    side_or_index: f64, // "0" a bid or "1" an ask on a book level, the index on a ticker
    #[serde(rename = "P", default = "wire::nan", deserialize_with = "wire::num")]
    price: f64,
    #[serde(rename = "V", default = "wire::nan", deserialize_with = "wire::num")]
    size: f64, // contracts of ctVal coins on a book level, 444.0
    #[serde(rename = "M", default = "wire::nan", deserialize_with = "wire::num")]
    mark: f64,
    #[serde(rename = "E", default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // the upcoming rate per interval, though documented as the previous one
    #[serde(rename = "PF", default = "wire::nan", deserialize_with = "wire::num")]
    next_funding: f64, // Unix seconds
}
