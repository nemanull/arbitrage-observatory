mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use serde::de::{Deserializer, SeqAccess, Visitor};
use std::borrow::Cow;
use std::collections::{HashMap, VecDeque};
use std::fmt;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "orangex";

const REST: &str = "https://api.orangex.com/api/v1/public";

// One address serves every perpetual.
const URL: &str = "wss://api.orangex.com/ws/api/v1";

// The only book channel, full depth deltas with no snapshot, chained by change_id.
const CHANNEL_PREFIX: &str = "book.";
const CHANNEL_SUFFIX: &str = ".raw";
const BOOK_KEY: &[u8] = b"\"book.";

// 100 levels is the smallest seed of at least 20, and its version is the socket's change_id.
// The whole book of depth 0 or 500 is a cache that lagged up to 22 versions on 2026-09-23.
const SNAPSHOT_DEPTH: u32 = 100;
const ORDER_BOOK_PATH: &str = "/get_order_book";

// Each socket takes at most 30 channels since at least 2026-10-09, when a 31st drew code 1005 with "limit":"30", although 578 ran on one socket on 2026-09-23.
// The docs ask for fewer than 10 sockets at once and at most 5 new ones a minute, with an IP ban as the penalty.
// Seven sockets opened 12 s apart all stream within 80 s, so the loader keeps the 210 most traded perpetuals.
const MARKETS_PER_CONNECTION: usize = 30;
const CONNECTIONS: usize = 7;

const PING_ID: u64 = 1;
const FIRST_SUBSCRIBE_ID: u64 = 2;

// The venue's code for a channel it does not serve, which names that channel in data.
const CHANNEL_REFUSED: i64 = 3401;

// A market waiting for its snapshot keeps at most this many deltas, and a seed older than the oldest kept one is fetched again.
const MAX_HELD_DELTAS: usize = 500;

// A snapshot behind the socket is fetched again, and logged on the first miss and every tenth.
const SNAPSHOT_BEHIND_LOG_EVERY: u32 = 10;

// A reply that carried no book is logged on the first failure and every 30th, as the runtime logs a failed fetch.
const SNAPSHOT_FAILURE_LOG_EVERY: u32 = 30;

pub struct Orangex {
    rest: String,
}

impl Orangex {
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
    requested: HashMap<u64, Vec<String>>, // subscribe id to the channels it asked for
    next_id: u64,
    behind: HashMap<usize, u32>, // snapshots that were behind the socket, by position
    snapshot_failures: u32, // consecutive order book replies that carried no book, on this connection
}

enum Seed {
    // The snapshot is requested, and the deltas that arrive meanwhile are kept to replay on top of it.
    Waiting(VecDeque<Delta>),
    Live(Chain),
}

#[derive(Clone, Copy)]
struct Chain {
    last: i64,          // change_id of the last delta applied, or the snapshot's version
    seeded_only: bool,  // no delta applied since the snapshot
}

#[derive(Debug, Clone)]
struct Delta {
    change_id: i64,
    bids: Vec<BookLevel>,
    asks: Vec<BookLevel>,
}

impl BookVenue for Orangex {
    type State = State;

    // The server closes a socket 30 s after the client's last frame, whatever it sends, and the docs ask for a ping every 5 s.
    // The pong is traffic, so three missed pongs is a dead socket, while a quiet book went 2.6 s without a frame.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(5)),
            // At most 5 new sockets a minute, with an IP ban as the documented penalty.
            connect_stagger: Duration::from_secs(12),
            // No REST limit is published, and 28 order book reads a second drew no refusal on 2026-10-09.
            // A connection seeds its 30 books in 6 s at this gap.
            snapshot_gap: Duration::from_millis(200),
            first_book_wait: Duration::from_secs(15),
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

    fn subscribe_frames(&self, markets: &[Market], state: &mut Self::State) -> Vec<Message> {
        state.next_id = FIRST_SUBSCRIBE_ID;
        let mut frames = Vec::new();
        // One refused channel fails its whole frame, and the refusal is resent without it.
        for chunk in markets.chunks(MARKETS_PER_CONNECTION) {
            let channels: Vec<String> = chunk.iter().map(|market| channel(&market.raw_market_id)).collect();
            frames.push(subscribe(channels, state));
        }
        frames
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text(serde_json::json!({ "jsonrpc": "2.0", "id": PING_ID, "method": "/public/ping" }).to_string())
    }

    fn handle(&self, bytes: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = match serde_json::from_slice(bytes) {
            Ok(frame) => frame,
            Err(error) => {
                // The next delta's change_id would show the loss, but a quiet book can take 2.6 s to send one.
                if bytes.windows(BOOK_KEY.len()).any(|window| window == BOOK_KEY) {
                    conn.resync("connection", "book_frame_unreadable");
                }
                return Err(error.into());
            }
        };

        if let Some(params) = frame.params {
            if params.channel.starts_with(CHANNEL_PREFIX) {
                apply_delta(params.data, conn);
            }
            return Ok(());
        }

        let id = frame.id.as_ref().and_then(reply_id);
        if let Some(error) = frame.error {
            refused(id, error, conn);
            return Ok(());
        }

        match (id, frame.result) {
            (Some(PING_ID), _) => {}
            (Some(id), Some(serde_json::Value::Array(channels))) => acknowledge(id, &channels, conn),
            _ => tracing::warn!(event = "venue_notice", connection = conn.id(), id = ?frame.id),
        }

        Ok(())
    }

    fn snapshot_url(&self, market: &Market) -> Option<String> {
        Some(format!(
            "{}{ORDER_BOOK_PATH}?instrument_name={}&depth={SNAPSHOT_DEPTH}",
            self.rest,
            urlencoding(&market.raw_market_id),
        ))
    }

    // Every refusal arrives as HTTP 200 with a JSON-RPC error, so such a reply is fetched again like a failed fetch.
    fn handle_snapshot(&self, position: usize, body: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let book = match serde_json::from_slice::<Reply<Snapshot>>(body) {
            Ok(reply) => match reply.into_result("get_order_book") {
                Ok(book) if book.version > 0 => book,
                Ok(_) => {
                    failed_reply(position, "the order book reply carried no version", conn);
                    return Ok(());
                }
                Err(error) => {
                    failed_reply(position, &format!("{error:#}"), conn);
                    return Ok(());
                }
            },
            Err(error) => {
                failed_reply(position, &format!("the order book reply is not JSON: {error}"), conn);
                return Ok(());
            }
        };
        if !readable(&book.bids) || !readable(&book.asks) {
            failed_reply(position, "the order book reply has a level it cannot read", conn);
            return Ok(());
        }
        conn.state.snapshot_failures = 0;

        // Only a waiting market has a request out, so any other state is left as it is.
        let held = match conn.state.books.get_mut(&position) {
            Some(Seed::Waiting(held)) => std::mem::take(held),
            _ => return Ok(()),
        };
        seed(position, book, held, conn);
        Ok(())
    }
}

fn channel(raw_market_id: &str) -> String {
    format!("{CHANNEL_PREFIX}{raw_market_id}{CHANNEL_SUFFIX}")
}

// "book.BTC-USDT-PERPETUAL.raw" names "BTC-USDT-PERPETUAL".
fn market_of(channel: &str) -> Option<&str> {
    channel.strip_prefix(CHANNEL_PREFIX)?.strip_suffix(CHANNEL_SUFFIX)
}

fn subscribe(channels: Vec<String>, state: &mut State) -> Message {
    let id = state.next_id;
    state.next_id += 1;
    let frame = serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": "/public/subscribe", "params": { "channels": channels } });
    state.requested.insert(id, channels);
    Message::text(frame.to_string())
}

// The id comes back as a string, "1", although it was sent as a number.
fn reply_id(id: &serde_json::Value) -> Option<u64> {
    match id {
        serde_json::Value::String(text) => text.parse().ok(),
        other => other.as_u64(),
    }
}

// The 4 ids in Chinese characters go out percent encoded, as a browser sends them.
fn urlencoding(raw_market_id: &str) -> Cow<'_, str> {
    if raw_market_id.bytes().all(|byte| byte.is_ascii_alphanumeric() || byte == b'-') {
        return Cow::Borrowed(raw_market_id);
    }
    let mut encoded = String::with_capacity(raw_market_id.len() * 3);
    for byte in raw_market_id.bytes() {
        if byte.is_ascii_alphanumeric() || byte == b'-' {
            encoded.push(byte as char);
        } else {
            encoded.push_str(&format!("%{byte:02X}"));
        }
    }
    Cow::Owned(encoded)
}

// Each acknowledged market asks for its snapshot here, because no delta carries a book.
fn acknowledge(id: u64, accepted: &[serde_json::Value], conn: &mut Connection<State>) {
    let accepted: Vec<&str> = accepted.iter().filter_map(|channel| channel.as_str()).collect();
    for channel in &accepted {
        let Some(position) = market_of(channel).and_then(|market| conn.position(market)) else {
            continue;
        };
        if !conn.state.books.contains_key(&position) {
            conn.state.books.insert(position, Seed::Waiting(VecDeque::new()));
            conn.request_snapshot(position);
        }
    }

    let requested = conn.state.requested.remove(&id).unwrap_or_default();
    let missing: Vec<&String> = requested.iter().filter(|channel| !accepted.contains(&channel.as_str())).collect();
    if !missing.is_empty() {
        tracing::error!(event = "subscribe_refused", connection = conn.id(), id, refused = missing.len(), channels = ?missing);
    }
}

// A refused channel fails its whole subscribe frame, so the frame's other channels are sent again without it.
fn refused(id: Option<u64>, error: RpcError, conn: &mut Connection<State>) {
    let channel = error.data.as_ref().and_then(|data| data.get("channel")).and_then(|channel| channel.as_str()).map(str::to_string);
    tracing::error!(
        event = "venue_error",
        connection = conn.id(),
        id = ?id,
        code = error.code,
        message = %error.message,
        channel = channel.as_deref().unwrap_or(""),
    );

    let Some(id) = id else {
        return;
    };
    let Some(requested) = conn.state.requested.remove(&id) else {
        return;
    };
    let Some(bad) = channel.filter(|_| error.code == CHANNEL_REFUSED) else {
        return;
    };
    let rest: Vec<String> = requested.into_iter().filter(|channel| *channel != bad).collect();
    if !rest.is_empty() {
        let frame = subscribe(rest, &mut conn.state);
        conn.send(frame);
    }
}

fn apply_delta(data: BookData<'_>, conn: &mut Connection<State>) {
    let Some(position) = conn.position(&data.instrument_name) else {
        return;
    };
    let delta = Delta {
        change_id: data.change_id,
        bids: data.bids,
        asks: data.asks,
    };

    // OrderBook skips a level it cannot read, which would leave a stale level in the published book.
    if !readable(&delta.bids) || !readable(&delta.asks) {
        let market = conn.markets()[position].raw_market_id.clone();
        conn.resync(&market, "level_unreadable");
        return;
    }

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
    if delta.change_id <= chain.last {
        return;
    }

    if delta.change_id != chain.last + 1 {
        if chain.seeded_only {
            // The snapshot was behind the socket, so this market alone is seeded again, and its book reads empty until then rather than stale.
            reseed(position, delta, chain.last, conn);
        } else {
            let market = conn.markets()[position].raw_market_id.clone();
            conn.resync(&market, "sequence_gap");
        }
        return;
    }

    apply(position, &delta, conn);
    conn.state.books.insert(position, Seed::Live(Chain { last: delta.change_id, seeded_only: false }));
    conn.publish(position);
}

fn readable(levels: &[BookLevel]) -> bool {
    levels
        .iter()
        .all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

fn hold(held: &mut VecDeque<Delta>, delta: Delta) {
    if held.len() == MAX_HELD_DELTAS {
        held.pop_front();
    }
    held.push_back(delta);
}

// Every level applies, also those below the 100 of the seed, which the stream sends too.
// A level below the seed that never changed stays missing, which only ever hides depth and never shows a price that is not there.
fn apply(position: usize, delta: &Delta, conn: &mut Connection<State>) {
    if let Some(book) = conn.book(position) {
        for level in &delta.bids {
            book.set_bid(level.price, level.size);
        }
        for level in &delta.asks {
            book.set_ask(level.price, level.size);
        }
    }
}

// The documented recipe: drop the held deltas the version covers, and the first one left must be the version plus one.
// One past that shows the snapshot is behind the socket, so the market is fetched again.
fn seed(position: usize, book: Snapshot, held: VecDeque<Delta>, conn: &mut Connection<State>) {
    let newer: VecDeque<Delta> = held.into_iter().filter(|delta| delta.change_id > book.version).collect();

    if let Some(first) = newer.front()
        && first.change_id > book.version + 1
    {
        note_behind(position, book.version, first.change_id, conn);
        conn.state.books.insert(position, Seed::Waiting(newer));
        conn.request_snapshot(position);
        return;
    }

    // Held deltas chain on the wire, so a break means the venue skipped one, and the book is not published half replayed.
    let mut last = book.version;
    for delta in &newer {
        if delta.change_id != last + 1 {
            let market = conn.markets()[position].raw_market_id.clone();
            conn.resync(&market, "sequence_gap");
            return;
        }
        last = delta.change_id;
    }

    conn.reset_book(position, &book.bids, &book.asks);
    for delta in &newer {
        apply(position, delta, conn);
    }

    conn.state.behind.remove(&position);
    conn.state.books.insert(position, Seed::Live(Chain { last, seeded_only: newer.is_empty() }));
}

fn reseed(position: usize, delta: Delta, last: i64, conn: &mut Connection<State>) {
    note_behind(position, last, delta.change_id, conn);
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

fn note_behind(position: usize, version: i64, change_id: i64, conn: &mut Connection<State>) {
    let misses = conn.state.behind.entry(position).or_default();
    *misses += 1;
    let misses = *misses;
    if misses == 1 || misses % SNAPSHOT_BEHIND_LOG_EVERY == 0 {
        let market = conn.markets()[position].raw_market_id.as_str();
        tracing::warn!(event = "snapshot_behind", connection = conn.id(), market, misses, version, change_id);
    }
}

// The REST envelope: every refusal comes as HTTP 200 with error in place of result.
#[derive(Deserialize)]
struct Reply<T> {
    result: Option<T>,
    error: Option<RpcError>,
}

impl<T> Reply<T> {
    fn into_result(self, call: &str) -> anyhow::Result<T> {
        if let Some(error) = self.error {
            anyhow::bail!("{call}: code {}: {}", error.code, error.message);
        }
        self.result.ok_or_else(|| anyhow::anyhow!("{call}: reply has no result"))
    }
}

#[derive(Deserialize)]
struct RpcError {
    #[serde(default)]
    code: i64, // 3401 for a refused channel, 5001 for an unknown instrument, 9902 for text that is not JSON
    #[serde(default)]
    message: String,
    data: Option<serde_json::Value>, // {"channel":"book.NOPE-USDT-PERPETUAL.raw"} on 3401
}

// Notifications carry method and params, and replies carry id with result or error.
#[derive(Deserialize)]
struct Frame<'a> {
    id: Option<serde_json::Value>, // a string on the wire, and absent on the reply to text that is not JSON
    #[serde(borrow)]
    params: Option<Params<'a>>,
    result: Option<serde_json::Value>, // the accepted channels, or {} for a pong
    error: Option<RpcError>,
}

#[derive(Deserialize)]
struct Params<'a> {
    #[serde(borrow)]
    channel: Cow<'a, str>,
    #[serde(borrow)]
    data: BookData<'a>,
}

#[derive(Deserialize)]
struct BookData<'a> {
    #[serde(borrow)]
    instrument_name: Cow<'a, str>,
    change_id: i64, // rises by exactly one per frame of the instrument, and continues the REST version
    #[serde(default, deserialize_with = "actions")]
    bids: Vec<BookLevel>, // best first
    #[serde(default, deserialize_with = "actions")]
    asks: Vec<BookLevel>,
}

#[derive(Deserialize)]
struct Snapshot {
    version: i64, // the change_id this book stands at
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // best first, prices trimmed where the socket pads them
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
}

// Book levels as ["new", "86666.5", "4.629"] or ["delete", "86666.3", "0"], where new also overwrites a level.
// The socket pads prices, "86644.0" for REST's "86644", so each is keyed by its number.
fn actions<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<BookLevel>, D::Error> {
    deserializer.deserialize_seq(ActionsVisitor)
}

struct ActionsVisitor;

impl<'de> Visitor<'de> for ActionsVisitor {
    type Value = Vec<BookLevel>;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("an array of [action, price, amount] levels")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        let mut levels = Vec::with_capacity(seq.size_hint().unwrap_or(8));
        while let Some(Action(action, price, amount)) = seq.next_element()? {
            let size = if action.0 == "delete" { 0.0 } else { wire::number(&amount.0) };
            levels.push(BookLevel { price: wire::number(&price.0), size });
        }
        Ok(levels)
    }
}

#[derive(Deserialize)]
struct Action<'a>(#[serde(borrow)] Text<'a>, #[serde(borrow)] Text<'a>, #[serde(borrow)] Text<'a>);

// A string borrowed from the frame where it has no escapes.
#[derive(Deserialize)]
struct Text<'a>(#[serde(borrow)] Cow<'a, str>);
