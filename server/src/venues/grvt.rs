// GRVT matches its book off chain and settles on its own Layer 2, so its market data API is the only source of the book.

mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::socket_anchors::SocketAnchors;
use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::{Deserialize, Deserializer};
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "grvt";

// Every market data call is a POST of a JSON body, and a GET answers 405.
const REST: &str = "https://market-data.grvt.io";

// One socket carries crypto, equity and commodity perpetuals alike, with full field names.
const URL: &str = "wss://market-data.grvt.io/ws/full";

// The whole book on subscribe as sequence 0, then the changed levels with absolute sizes, each selector numbered on its own.
const BOOK_STREAM: &str = "v1.book.d";
const BOOK_RATE_MS: u32 = 100;

// The whole ticker on its clock, while v1.ticker.d leaves out a price that did not move and its row would age by the older price.
const TICKER_STREAM: &str = "v1.ticker.s";
const TICKER_RATE_MS: u32 = 500;

// Market data allows 150 concurrent streams and 300 subscriptions a minute, and the help center does not say per socket or per address.
// A market takes a book and a ticker stream, so 60 markets keep a socket at 120 streams.
const MARKETS_PER_CONNECTION: usize = 60;

// One subscribe across all connections every 225 ms is 267 a minute, under the 300 even if the budget is per address.
const SUBSCRIBE_EVERY: Duration = Duration::from_millis(225);

// funding_rate is in percent per interval, since BTC's funding cap reads 0.3 where Binance's own reads 0.003.
const PERCENT: f64 = 100.0;

pub struct Grvt {
    anchors: SocketAnchors, // filled by handle, read by fetch_round
    tracked: usize,         // markets on the book sockets, which sets the pacing and the warmup
    first_round: OnceLock<Instant>,
}

impl Grvt {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self {
            anchors: SocketAnchors::new(true),
            tracked: markets.len(),
            first_round: OnceLock::new(),
        }
    }
}

#[derive(Default)]
pub struct State {
    tracks: HashMap<usize, Track>, // by position
}

#[derive(Default)]
struct Track {
    expected: Option<u64>,       // the number of the book's next delta, from the acknowledgement and then each delta applied
    ticker_sequence: u64,        // of the last ticker push applied, 0 before the first after the snapshot
    interval_hours: Option<f64>, // from the ticker's first push, the only one that carries it
}

fn connections(markets: usize) -> usize {
    markets.div_ceil(MARKETS_PER_CONNECTION).max(1)
}

// Every connection subscribes at once, so each spaces its own frames by the venue's pace times the connection count.
fn subscribe_gap(markets: usize) -> Duration {
    SUBSCRIBE_EVERY * connections(markets) as u32
}

impl BookVenue for Grvt {
    type State = State;

    // The server pings every 5 s and drops a client after five pings go unanswered, and the runtime's pong answers them.
    // Those pings count as traffic while a quiet book sends no delta for minutes, so 15 s of silence is a dead socket.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            subscribe_gap: subscribe_gap(self.tracked),
            ..FeedSettings::new(Duration::from_secs(15))
        }
    }

    // Even slices, so 184 markets make four connections of 46.
    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let per_connection = markets.len().div_ceil(connections(markets.len())).max(1);

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

    // One selector per frame, since an unknown name refuses its whole frame, and every book before any ticker, so the books come first.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len() * 2);
        for (stream, rate, ticker) in [(BOOK_STREAM, BOOK_RATE_MS, false), (TICKER_STREAM, TICKER_RATE_MS, true)] {
            for (position, market) in markets.iter().enumerate() {
                let frame = serde_json::json!({
                    "jsonrpc": "2.0",
                    "method": "subscribe",
                    "params": { "stream": stream, "selectors": [format!("{}@{rate}", market.raw_market_id)] },
                    "id": frame_id(position, ticker),
                });
                frames.push(Message::text(frame.to_string()));
            }
        }
        frames
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
        let at = conn.frame_recv_ts();
        self.handle_at(frame, conn, at)
    }
}

impl Grvt {
    // `at` is the frame's arrival, which stamps the anchor fields it carries.
    fn handle_at(&self, raw: &[u8], conn: &mut Connection<State>, at: i64) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(raw)?;

        // A refused frame sends no data and closes nothing.
        if let Some(error) = &frame.error {
            log_error(frame.id, error, conn);
            return Ok(());
        }
        if let Some(ack) = &frame.result {
            note_acknowledgement(ack, conn);
            return Ok(());
        }

        let (Some(stream), Some(selector), Some(feed)) = (frame.stream.as_deref(), frame.selector.as_deref(), &frame.feed) else {
            tracing::warn!(event = "venue_notice", connection = conn.id(), frame = %String::from_utf8_lossy(raw));
            return Ok(());
        };
        let instrument = instrument_of(selector);
        let Some(position) = conn.position(instrument) else {
            return Ok(());
        };
        let sequence = frame.sequence_number.as_deref().and_then(|number| number.parse::<u64>().ok());

        match stream {
            BOOK_STREAM => apply_book(instrument, position, sequence, feed, conn),
            TICKER_STREAM => self.apply_ticker(instrument, position, sequence, feed, conn, at),
            _ => {}
        }
        Ok(())
    }

    fn apply_ticker(&self, instrument: &str, position: usize, sequence: Option<u64>, feed: &Feed, conn: &mut Connection<State>, at: i64) {
        let track = conn.state.tracks.entry(position).or_default();

        // Each push is the whole ticker, so only a repeat of an older push is dropped.
        if let Some(sequence) = sequence.filter(|&sequence| sequence > 0) {
            if sequence <= track.ticker_sequence {
                return;
            }
            track.ticker_sequence = sequence;
        }
        if feed.funding_interval_hours.is_finite() && feed.funding_interval_hours > 0.0 {
            track.interval_hours = Some(feed.funding_interval_hours);
        }
        let interval_hours = track.interval_hours;

        // A delisted market's ticker keeps its last mark and index, which would read as fresh, so its row stays out.
        if feed.status.as_deref().is_some_and(|status| status != "ACTIVE") {
            self.anchors.set_index(instrument, f64::NAN, at);
            return;
        }

        self.anchors.set_index(instrument, feed.index_price, at);
        // A mark of 0 would read as a venue with no mark, so it keeps the row out instead.
        self.anchors.set_mark(instrument, if feed.mark_price > 0.0 { feed.mark_price } else { f64::NAN }, at);
        // funding_rate is the coming settlement's, which next_funding_time names.
        if let Some(hours) = interval_hours {
            self.anchors.set_funding(instrument, feed.funding_rate / PERCENT, hours, ns_to_ms(feed.next_funding_time));
        }
    }
}

// Each selector's first delta carries the number its acknowledgement names, one entry per selector in subs order.
fn note_acknowledgement(ack: &Ack, conn: &mut Connection<State>) {
    if ack.stream != BOOK_STREAM {
        return;
    }

    for (selector, first) in ack.subs.iter().zip(&ack.first_sequence_number) {
        let Some(position) = conn.position(instrument_of(selector)) else {
            continue;
        };
        conn.state.tracks.entry(position).or_default().expected = first.parse::<u64>().ok();
    }
}

// The rule GRVT documents: a number that skips ahead means a lost delta, and one already passed is a repeat from a network retry.
fn apply_book(instrument: &str, position: usize, sequence: Option<u64>, feed: &Feed, conn: &mut Connection<State>) {
    // The book would skip such a level and carry on, so a missed removal would stay in a book that looks live.
    if !readable(&feed.bids) || !readable(&feed.asks) {
        conn.resync(instrument, "level_unreadable");
        return;
    }
    let Some(sequence) = sequence else {
        conn.resync(instrument, "sequence_unreadable");
        return;
    };

    // The snapshot is the whole book, and the acknowledgement before it named its first delta.
    if sequence == 0 {
        conn.reset_book(position, &feed.bids, &feed.asks);
        return;
    }

    if conn.book(position).is_none() {
        conn.resync(instrument, "delta_before_snapshot");
        return;
    }
    let Some(expected) = conn.state.tracks.get(&position).and_then(|track| track.expected) else {
        conn.resync(instrument, "delta_before_acknowledgement");
        return;
    };
    if sequence < expected {
        return;
    }
    if sequence > expected {
        conn.resync(instrument, "sequence_gap");
        return;
    }
    conn.state.tracks.entry(position).or_default().expected = Some(sequence + 1);

    // A delta can carry an empty side, and one with no level at all changes nothing.
    if feed.bids.is_empty() && feed.asks.is_empty() {
        return;
    }
    let Some(book) = conn.book(position) else {
        return;
    };
    for level in &feed.bids {
        book.set_bid(level.price, level.size);
    }
    for level in &feed.asks {
        book.set_ask(level.price, level.size);
    }
    conn.publish(position);
}

// The rule OrderBook applies to each level, where a size of 0 removes it.
fn readable(levels: &[BookLevel]) -> bool {
    levels.iter().all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

// "BTC_USDT_Perp@100" names the instrument "BTC_USDT_Perp".
fn instrument_of(selector: &str) -> &str {
    selector.split_once('@').map_or(selector, |(instrument, _)| instrument)
}

// Book frames take odd ids and ticker frames even ones, so an error reply names its market and stream.
fn frame_id(position: usize, ticker: bool) -> usize {
    2 * position + 1 + usize::from(ticker)
}

fn subscription_of(id: i64, markets: &[Market]) -> Option<(&'static str, &str)> {
    let index = usize::try_from(id).ok()?.checked_sub(1)?;
    let stream = if index % 2 == 0 { BOOK_STREAM } else { TICKER_STREAM };
    Some((stream, markets.get(index / 2)?.raw_market_id.as_str()))
}

fn log_error(id: Option<i64>, error: &RpcError, conn: &Connection<State>) {
    let (stream, market) = id.and_then(|id| subscription_of(id, conn.markets())).unwrap_or(("", ""));
    tracing::error!(
        event = "venue_error",
        connection = conn.id(),
        id = id.unwrap_or(0),
        code = error.code,
        message = error.message.as_deref().unwrap_or(""),
        stream,
        market,
    );
}

// Unix ns to Unix ms, and 0 for unknown.
fn ns_to_ms(ns: f64) -> i64 {
    if ns.is_finite() && ns > 0.0 { (ns / 1_000_000.0).round() as i64 } else { 0 }
}

// Data frames, acknowledgements and errors share no key, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    stream: Option<Cow<'a, str>>, // "v1.book.d" or "v1.ticker.s" on data
    #[serde(borrow)]
    selector: Option<Cow<'a, str>>, // "BTC_USDT_Perp@100"
    #[serde(borrow)]
    sequence_number: Option<Cow<'a, str>>, // "0" on a snapshot, then counting up by 1 per selector
    #[serde(borrow)]
    feed: Option<Feed<'a>>,
    result: Option<Ack>,
    error: Option<RpcError>,
    id: Option<i64>, // the request's id on a reply
}

// A book frame carries the levels, and a ticker push carries the prices and the funding.
#[derive(Deserialize)]
struct Feed<'a> {
    #[serde(default, deserialize_with = "levels")]
    bids: Vec<BookLevel>, // absolute sizes in coins of the base, "0.0" removes, best first on a snapshot
    #[serde(default, deserialize_with = "levels")]
    asks: Vec<BookLevel>,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // percent per interval for the coming settlement, "0.01"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_interval_hours: f64, // a JSON integer on a subscription's first push only
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_funding_time: f64, // Unix ns as a string
    #[serde(borrow)]
    status: Option<Cow<'a, str>>, // "ACTIVE"
}

#[derive(Deserialize)]
struct Ack {
    #[serde(default)]
    stream: String,
    #[serde(default)]
    subs: Vec<String>, // "BTC_USDT_Perp@100"
    #[serde(default)]
    first_sequence_number: Vec<String>, // one per entry of subs
}

#[derive(Deserialize)]
struct RpcError {
    #[serde(default)]
    code: i64, // 3000 an unknown instrument, 3030 a bad rate, 3031 a bad depth, 1100 an unknown stream
    message: Option<String>,
}

// {"price":"82343.3","size":"4.02","num_orders":10}.
#[derive(Deserialize)]
struct Level {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    size: f64, // coins of the named base, so thousands of coins on KBONK, KPEPE and KSHIB
}

// A null reads as no levels.
fn levels<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<BookLevel>, D::Error> {
    let levels = Option::<Vec<Level>>::deserialize(deserializer)?.unwrap_or_default();
    Ok(levels.iter().map(|level| BookLevel { price: level.price, size: level.size }).collect())
}
