// Aster runs Binance's USD-M futures API frame for frame on its own hosts.

mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use anchor::Intervals;
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "aster";

const REST: &str = "https://fapi.asterdex.com";

// Only the combined stream names the stream on each frame.
const URL: &str = "wss://fstream.asterdex.com/stream";

// The whole top 20 a side about every 100 ms, sent only when the book changed, so every frame replaces the book.
const BOOK_SUFFIX: &str = "@depth20@100ms";

// The venue caps a connection at 200 streams, and each market takes one.
const MAX_MARKETS_PER_CONNECTION: usize = 200;

// One subscribe frame of 199 streams closed the socket with 3001 "illegal request" on 2026-10-12, while 150 passed.
const STREAMS_PER_FRAME: usize = 50;

// The REST book shares the socket's update counter, and 20 levels is the stream's depth at weight 2.
const DEPTH_PATH: &str = "/fapi/v3/depth";
const SNAPSHOT_LEVELS: usize = 20;

// An unchanged book sends nothing, and 7 of the 100 quietest markets sent no frame in 30 s on 2026-10-12.
// A book still empty this long after the connection's first frame is read once from REST, which was 23 of 573 at 23:04 UTC that day.
const SEED_AFTER_MS: i64 = 5_000;

// A missed push costs only freshness, since the next frame is whole, so a break in pu is logged sparsely and never resyncs.
const GAP_LOG_EVERY: u32 = 100;

pub struct Aster {
    rest: String,
    intervals: Mutex<Intervals>,
}

impl Aster {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self {
            rest: rest.to_string(),
            intervals: Mutex::new(Intervals::default()),
        }
    }
}

#[derive(Default)]
pub struct State {
    first_frame_at: i64, // Unix ms of the connection's first frame, 0 before it
    seeded: bool,        // the books still empty at SEED_AFTER_MS were queued for a REST read
    tracks: HashMap<usize, Track>, // by position
    gaps: u32,           // breaks in pu on this connection
}

#[derive(Clone, Copy, Default)]
struct Track {
    applied: i64,  // u of the frame or lastUpdateId of the REST book the book holds, 0 before either
    streamed: i64, // u of the last socket frame, which the next frame's pu names, 0 before the first
}

impl BookVenue for Aster {
    type State = State;

    // A quiet book sends nothing for up to 28 s, so the 30 s ping keeps a live socket talking.
    // The venue closes every socket at 24 h, and a single subscribe frame per 250 ms stays under its 10 messages a second.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(30)),
            subscribe_gap: Duration::from_millis(250),
            // Each read weighs 2, so three connections spend at most 900 of the 2,400 a minute beside the anchor's 600.
            snapshot_gap: Duration::from_millis(400),
            first_book_wait: Duration::from_secs(30),
            retire_after: Some(Duration::from_secs(23 * 60 * 60)),
            retire_jitter: Duration::from_secs(30 * 60),
            ..FeedSettings::new(Duration::from_secs(60))
        }
    }

    // As few connections as the cap allows, with the markets spread evenly, so 577 markets make 193, 193 and 191.
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

    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut streams = Vec::with_capacity(markets.len());
        for market in markets {
            streams.push(stream_name(market));
        }

        let mut frames = Vec::new();
        for (i, params) in streams.chunks(STREAMS_PER_FRAME).enumerate() {
            let frame = serde_json::json!({ "method": "SUBSCRIBE", "params": params, "id": i + 1 });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        seed_quiet_books(conn);

        let frame: StreamFrame = serde_json::from_slice(frame)?;

        if let Some(data) = frame.data
            && frame.stream.as_deref().is_some_and(|stream| stream.ends_with(BOOK_SUFFIX))
        {
            apply_frame(data, conn);
            return Ok(());
        }

        // An unknown, uppercase or settling stream is acknowledged like any other and then stays silent.
        if let Some(error) = frame.error {
            tracing::error!(event = "venue_error", connection = conn.id(), id = ?frame.id, code = error.code, message = %error.msg);
        } else if let Some(id) = frame.id {
            tracing::debug!(event = "subscribe_acknowledged", connection = conn.id(), id);
        } else {
            tracing::warn!(event = "venue_notice", connection = conn.id(), stream = frame.stream.as_deref().unwrap_or(""));
        }

        Ok(())
    }

    fn snapshot_url(&self, market: &Market) -> Option<String> {
        Some(format!(
            "{}{DEPTH_PATH}?symbol={}&limit={SNAPSHOT_LEVELS}",
            self.rest,
            query_value(&market.raw_market_id),
        ))
    }

    // The venue answers a closed or unknown market with a 400, which the runtime fetches again, so a 200 is always a book.
    fn handle_snapshot(&self, position: usize, body: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let book: Snapshot = serde_json::from_slice(body)?;
        if book.last_update_id <= 0 {
            anyhow::bail!("the depth reply carried no lastUpdateId");
        }

        // A socket frame applied since the read already holds this book or a newer one.
        let mut track = conn.state.tracks.get(&position).copied().unwrap_or_default();
        if book.last_update_id <= track.applied {
            return Ok(());
        }
        track.applied = book.last_update_id;
        conn.state.tracks.insert(position, track);
        conn.reset_book(position, &book.bids, &book.asks);
        Ok(())
    }
}

// Every book still empty SEED_AFTER_MS after the connection's first frame is queued once for a REST read.
// A busy socket carries hundreds of frames a second, so the first frame past the wait arrives right after it.
fn seed_quiet_books(conn: &mut Connection<State>) {
    if conn.state.seeded {
        return;
    }

    let now = conn.frame_recv_ts();
    if conn.state.first_frame_at == 0 {
        conn.state.first_frame_at = now;
    }
    if now - conn.state.first_frame_at < SEED_AFTER_MS {
        return;
    }

    conn.state.seeded = true;
    let mut queued = 0;
    for position in 0..conn.markets().len() {
        if conn.book(position).is_none() {
            conn.request_snapshot(position);
            queued += 1;
        }
    }
    tracing::info!(event = "book_seed_queued", connection = conn.id(), markets = queued, of = conn.markets().len());
}

fn apply_frame(data: DepthData, conn: &mut Connection<State>) {
    let Some(position) = conn.position(&data.symbol) else {
        return;
    };

    let mut track = conn.state.tracks.get(&position).copied().unwrap_or_default();
    let expected = track.streamed;
    track.streamed = data.last_update_id;
    let newer = data.last_update_id > track.applied;
    if newer {
        track.applied = data.last_update_id;
    }
    conn.state.tracks.insert(position, track);

    if expected != 0 && data.previous_update_id != expected {
        note_gap(&data, expected, conn);
    }

    // A REST book read after this frame was taken holds it already.
    if newer {
        conn.reset_book(position, &data.bids, &data.asks);
    }
}

fn note_gap(data: &DepthData, expected: i64, conn: &mut Connection<State>) {
    conn.state.gaps += 1;
    let gaps = conn.state.gaps;
    if gaps == 1 || gaps % GAP_LOG_EVERY == 0 {
        tracing::warn!(
            event = "book_sequence_gap",
            connection = conn.id(),
            market = %data.symbol,
            gaps,
            expected,
            previous_update_id = data.previous_update_id,
        );
    }
}

// A Unicode lowercase, since five ids are written in Chinese characters and stream under their own characters.
fn stream_name(market: &Market) -> String {
    format!("{}{BOOK_SUFFIX}", market.raw_market_id.to_lowercase())
}

// Ids in Chinese characters go out percent encoded, and every other id is letters, digits and one hyphen.
fn query_value(raw_market_id: &str) -> Cow<'_, str> {
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

// Book frames carry stream and data, an acknowledgement carries id and result, and an error carries error with the id or null.
#[derive(Deserialize)]
struct StreamFrame<'a> {
    #[serde(borrow)]
    stream: Option<Cow<'a, str>>, // "btcusdt@depth20@100ms"
    #[serde(borrow)]
    data: Option<DepthData<'a>>,
    id: Option<u64>,
    error: Option<StreamError>,
}

#[derive(Deserialize)]
struct StreamError {
    code: i64, // 3 "Invalid json", 2 "Invalid request: unknown method"
    msg: String,
}

#[derive(Deserialize)]
struct DepthData<'a> {
    #[serde(borrow, rename = "s")]
    symbol: Cow<'a, str>, // "BTCUSDT" or "币安人生USDT", as the catalog spells it
    #[serde(rename = "u")]
    last_update_id: i64, // one counter for the whole venue, not per market
    #[serde(rename = "pu")]
    previous_update_id: i64, // u of this stream's previous frame
    #[serde(default, rename = "b", deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // best first, in base coins
    #[serde(default, rename = "a", deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
}

#[derive(Deserialize)]
struct Snapshot {
    #[serde(default, rename = "lastUpdateId")]
    last_update_id: i64,
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // best first, as the stream sends them
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
}
