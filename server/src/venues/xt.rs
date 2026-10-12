mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use anchor::FundingCache;
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "xt";

const REST: &str = "https://fapi.xt.com";

// One socket carries both families, and the bare /ws path that CCXT Pro names answers HTTP 404.
const BOOK_URL: &str = "wss://fstream.xt.com/ws/market";

// Deltas of absolute sizes at any depth, chained by fu and u, with no snapshot on subscribe.
const DELTA_TOPIC: &str = "depth_update";

// A whole 50 level book about once a second, whose id sits in the deltas' sequence, so it seeds the book in place of a REST read.
// It is not always an exact image on a busy book, so once a delta chains onto it the market unsubscribes it.
// A market whose chain breaks subscribes it again and is seeded afresh, as binance's diff channel reseeds from its snapshots.
const SEED_TOPIC: &str = "depth";

// About one session in ten serves only the first 256 streams of its opening burst and acknowledges the rest without serving them.
// On 2026-10-09 that cut 11 of 102 sockets of 150 or 200 markets at exactly 128 markets, and none of 84 sockets of 100 or 128.
// So each socket carries 100 markets, two streams each, in one subscribe frame.
// The venue also drops a burst of deltas on one socket now and then, which breaks the chain of a few to 27 markets at once.
// That came about 18 times in 90 s over all 691 contracts, with 50 or 200 markets a socket alike, so a break reseeds only its market.
const MARKETS_PER_CONNECTION: usize = 100;
const MARKETS_PER_FRAME: usize = 100; // 200 streams in one frame were acknowledged once

// A seed frame can trail the deltas past its id by a few hundred ms, so the deltas wait for it.
const MAX_BUFFERED: usize = 64;

// Markets go live in a burst after a connection opens, and break in a burst when the venue drops frames.
// So their seed streams leave in a few frames rather than one each, and a reseed waits less than an unsubscribe.
const STREAMS_PER_BATCH: usize = 50;
const RESEED_WAIT_MS: i64 = 100;
const UNSUBSCRIBE_WAIT_MS: i64 = 1_000;

pub struct Xt {
    rest: String,
    funding: Mutex<FundingCache>,
}

impl Xt {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self {
            rest: rest.to_string(),
            funding: Mutex::new(FundingCache::default()),
        }
    }
}

#[derive(Default)]
pub struct State {
    books: HashMap<usize, Stage>, // by position, absent until the market's first frame
    reseed: Batch,               // seed streams of markets whose chain broke
    unsubscribe: Batch,          // seed streams of markets now chained by their deltas
}

#[derive(Default)]
struct Batch {
    streams: Vec<String>,
    since: i64, // arrival of the frame that queued the oldest stream
}

impl Batch {
    fn push(&mut self, stream: String, now: i64) {
        if self.streams.is_empty() {
            self.since = now;
        }
        self.streams.push(stream);
    }

    fn remove(&mut self, stream: &str) {
        self.streams.retain(|queued| queued != stream);
    }

    fn take_due(&mut self, now: i64, wait_ms: i64) -> Option<Vec<String>> {
        if self.streams.is_empty() || (self.streams.len() < STREAMS_PER_BATCH && now - self.since < wait_ms) {
            return None;
        }
        Some(std::mem::take(&mut self.streams))
    }
}

#[derive(Debug)]
enum Stage {
    Waiting(Vec<Delta>), // deltas kept until a seed, oldest first
    Seeded(i64),         // the seed's id, until a delta bridges it
    Live(i64),           // u of the last delta applied
}

#[derive(Debug)]
struct Delta {
    fu: i64,
    u: i64,
    bids: Vec<BookLevel>,
    asks: Vec<BookLevel>,
}

impl BookVenue for Xt {
    type State = State;

    // The server closes a socket at 30 s without a text ping, even one that is receiving data, and answers each with a text pong.
    // So a ping goes every 15 s, and three missed pongs end the connection.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(15)),
            ..FeedSettings::new(Duration::from_secs(45))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#linear#{i}"),
                url: BOOK_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    fn subscribe_frames(&self, markets: &[Market], _state: &mut State) -> Vec<Message> {
        let mut frames = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_FRAME).enumerate() {
            let mut params = Vec::with_capacity(slice.len() * 2);
            for market in slice {
                params.push(format!("{DELTA_TOPIC}@{},100ms", market.raw_market_id));
                params.push(seed_stream(&market.raw_market_id));
            }
            let frame = serde_json::json!({ "method": "SUBSCRIBE", "params": params, "id": format!("subscribe#{i}") });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn ping(&self, _state: &mut State) -> Message {
        Message::text("ping")
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
        // The answer to the ping, and the one frame that is not JSON.
        if frame == b"pong" {
            return Ok(());
        }

        let frame: Frame = serde_json::from_slice(frame)?;
        match (frame.topic.as_deref(), frame.data) {
            (Some(DELTA_TOPIC), Some(data)) => on_delta(data, conn)?,
            (Some(SEED_TOPIC), Some(data)) => on_seed(data, conn)?,
            (Some(topic), _) => tracing::warn!(event = "venue_notice", connection = conn.id(), topic),
            // An acknowledgement or a refusal, which names the frame's id and carries empty levels as data.
            (None, _) => {
                let id = frame.id.as_deref().unwrap_or("");
                let message = frame.msg.as_deref().unwrap_or("");
                match frame.code {
                    Some(0) => tracing::debug!(event = "subscribe_acknowledged", connection = conn.id(), id),
                    Some(code) => tracing::error!(event = "venue_error", connection = conn.id(), code, id, message),
                    None => tracing::warn!(event = "venue_notice", connection = conn.id(), id, message),
                }
            }
        }

        flush(conn);
        Ok(())
    }
}

fn seed_stream(raw_market_id: &str) -> String {
    format!("{SEED_TOPIC}@{raw_market_id},50")
}

fn on_delta(data: Data, conn: &mut Connection<State>) -> anyhow::Result<()> {
    let Some(symbol) = data.s.as_deref() else {
        anyhow::bail!("a delta without s");
    };
    let Some(position) = conn.position(symbol) else {
        return Ok(());
    };
    if !(data.fu.is_finite() && data.u.is_finite()) {
        anyhow::bail!("a delta on {symbol} without fu or u");
    }

    let delta = Delta {
        fu: data.fu as i64,
        u: data.u as i64,
        bids: data.b,
        asks: data.a,
    };
    let stage = conn.state.books.remove(&position).unwrap_or(Stage::Waiting(Vec::new()));
    let stage = chain(stage, delta, position, symbol, conn);
    conn.state.books.insert(position, stage);
    Ok(())
}

// The seed replaces the book and the kept deltas past its id replay onto it, as the venue's order book guide does with a REST read.
fn on_seed(data: Data, conn: &mut Connection<State>) -> anyhow::Result<()> {
    let Some(symbol) = data.s.as_deref() else {
        anyhow::bail!("a seed without s");
    };
    let Some(position) = conn.position(symbol) else {
        return Ok(());
    };
    if !data.id.is_finite() {
        anyhow::bail!("a seed on {symbol} without id");
    }
    let id = data.id as i64;

    let mut kept = match conn.state.books.remove(&position) {
        // Its unsubscribe is on the way, and the deltas already carry the book further.
        Some(Stage::Live(last)) => {
            conn.state.books.insert(position, Stage::Live(last));
            return Ok(());
        }
        Some(Stage::Seeded(seed)) if seed >= id => {
            conn.state.books.insert(position, Stage::Seeded(seed));
            return Ok(());
        }
        Some(Stage::Waiting(kept)) => kept,
        Some(Stage::Seeded(_)) | None => Vec::new(),
    };
    kept.retain(|delta| delta.u > id);

    // The ids between this seed and the oldest kept delta never reached this connection, so the next seed is awaited.
    if kept.first().is_some_and(|delta| delta.fu > id + 1) {
        conn.state.books.insert(position, Stage::Waiting(kept));
        return Ok(());
    }

    conn.reset_book(position, &data.b, &data.a);
    let mut stage = Stage::Seeded(id);
    for delta in kept {
        stage = chain(stage, delta, position, symbol, conn);
    }
    conn.state.books.insert(position, stage);
    Ok(())
}

// The first delta after a seed must straddle it, with fu <= id + 1 <= u, and every later one must start at the last u plus one.
fn chain(stage: Stage, delta: Delta, position: usize, symbol: &str, conn: &mut Connection<State>) -> Stage {
    match stage {
        Stage::Waiting(mut kept) => {
            if kept.len() == MAX_BUFFERED {
                kept.remove(0);
            }
            kept.push(delta);
            Stage::Waiting(kept)
        }
        Stage::Seeded(id) if delta.u <= id => Stage::Seeded(id),
        // The ids after the seed never reached this connection, so the published seed is missing changes until the next one.
        Stage::Seeded(id) if delta.fu > id + 1 => {
            conn.reset_book(position, &[], &[]);
            Stage::Waiting(vec![delta])
        }
        Stage::Seeded(_) => {
            let stream = seed_stream(symbol);
            let now = conn.frame_recv_ts();
            conn.state.reseed.remove(&stream);
            conn.state.unsubscribe.push(stream, now);
            apply(delta, position, symbol, conn)
        }
        Stage::Live(last) if delta.u <= last => Stage::Live(last),
        Stage::Live(last) if delta.fu != last + 1 => {
            tracing::warn!(
                event = "book_desync",
                connection = conn.id(),
                market = symbol,
                reason = "sequence_gap",
                expected = last + 1,
                fu = delta.fu,
                u = delta.u,
            );
            reseed(position, symbol, conn);
            Stage::Waiting(vec![delta])
        }
        Stage::Live(_) => apply(delta, position, symbol, conn),
    }
}

// Until the fresh seed the engine holds an empty book, since the last one it got is missing changes or may already be wrong.
fn reseed(position: usize, symbol: &str, conn: &mut Connection<State>) {
    conn.reset_book(position, &[], &[]);
    let stream = seed_stream(symbol);
    let now = conn.frame_recv_ts();
    conn.state.unsubscribe.remove(&stream);
    conn.state.reseed.push(stream, now);
}

fn apply(delta: Delta, position: usize, symbol: &str, conn: &mut Connection<State>) -> Stage {
    let Some(book) = conn.book(position) else {
        return Stage::Waiting(vec![delta]);
    };
    for level in &delta.bids {
        book.set_bid(level.price, level.size);
    }
    for level in &delta.asks {
        book.set_ask(level.price, level.size);
    }

    // A seed that was not an exact image can hold a level the venue had already removed, which no delta will ever delete.
    // Once the touch moves through it the book crosses, so the market is seeded afresh.
    // The delta itself is sound, and a seed that trails it still bridges through it.
    let crossed = match (book.bids().first(), book.asks().first()) {
        (Some(bid), Some(ask)) => bid.price >= ask.price,
        _ => false,
    };
    if crossed {
        tracing::warn!(event = "book_desync", connection = conn.id(), market = symbol, reason = "crossed", u = delta.u);
        reseed(position, symbol, conn);
        return Stage::Waiting(vec![delta]);
    }

    conn.publish(position);
    Stage::Live(delta.u)
}

// Both batches wait for a later frame, which on a socket of 200 markets is never far off.
fn flush(conn: &mut Connection<State>) {
    let now = conn.frame_recv_ts();
    if let Some(params) = conn.state.reseed.take_due(now, RESEED_WAIT_MS) {
        let frame = serde_json::json!({ "method": "SUBSCRIBE", "params": params, "id": "reseed" });
        conn.send(Message::text(frame.to_string()));
    }
    if let Some(params) = conn.state.unsubscribe.take_due(now, UNSUBSCRIBE_WAIT_MS) {
        let frame = serde_json::json!({ "method": "UNSUBSCRIBE", "params": params, "id": "seeded" });
        conn.send(Message::text(frame.to_string()));
    }
}

// Book frames and control frames share the envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    topic: Option<Cow<'a, str>>, // "depth_update" or "depth", absent on a control frame
    #[serde(borrow)]
    data: Option<Data<'a>>,
    code: Option<i64>, // 0 on an acknowledgement, 1 on a refusal
    #[serde(borrow)]
    id: Option<Cow<'a, str>>,
    #[serde(borrow)]
    msg: Option<Cow<'a, str>>, // "checkSymbol error, symbol:nope_usdt"
}

#[derive(Deserialize)]
struct Data<'a> {
    #[serde(borrow)]
    s: Option<Cow<'a, str>>, // "btc_usdt"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    id: f64, // the seed's place in the sequence, a decimal string
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    fu: f64, // a delta's first and last ids, decimal strings
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    u: f64,
    #[serde(default, deserialize_with = "wire::levels")]
    b: Vec<BookLevel>, // [price, contracts] strings, best first, and null on a control frame
    #[serde(default, deserialize_with = "wire::levels")]
    a: Vec<BookLevel>,
}
