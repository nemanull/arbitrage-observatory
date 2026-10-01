mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use anchor::Intervals;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "binance";

const USD_M_REST: &str = "https://fapi.binance.com";
const COIN_M_REST: &str = "https://dapi.binance.com";

// Book data has its own host and path, and only the combined stream names the channel on every frame, which is all that tells a diff from a snapshot.
const USD_M_BOOK_URL: &str = "wss://fstream.binance.com/public/stream";
const COIN_M_BOOK_URL: &str = "wss://dstream.binance.com/stream";

// Changes as they happen, about one frame per 30 ms on a busy market.
const DIFF_SUFFIX: &str = "@depth@0ms";

// The periodic truth the diffs are reseeded from, and the only source of the window the diffs may write inside.
// Its 20 levels must stay at or above DEPTH_LEVEL.
const SNAPSHOT_SUFFIX: &str = "@depth20@100ms";

const MARKETS_PER_CONNECTION: usize = 200; // two streams each, and USD-M allows 1,024 a connection
const STREAMS_PER_FRAME: usize = 100;

pub struct Binance {
    usd_m_rest: String,
    coin_m_rest: String,
    has_linear: bool, // the poller asks a host only when a market of its family is tracked
    has_inverse: bool,
    intervals: Mutex<Intervals>,
}

impl Binance {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(markets, USD_M_REST, COIN_M_REST)
    }

    fn with_rest(markets: &[TrackedMarket], usd_m_rest: &str, coin_m_rest: &str) -> Self {
        Self {
            usd_m_rest: usd_m_rest.to_string(),
            coin_m_rest: coin_m_rest.to_string(),
            has_linear: markets.iter().any(|tracked| tracked.market.linear),
            has_inverse: markets.iter().any(|tracked| !tracked.market.linear),
            intervals: Mutex::new(Intervals::default()),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct SymbolState {
    last_update_id: i64, // `u` of the last frame applied
    lowest_bid: f64,     // the deepest bid price the last snapshot covered
    highest_ask: f64,    // the deepest ask price the last snapshot covered
}

impl BookVenue for Binance {
    type State = HashMap<usize, SymbolState>; // by position

    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(30)), // binance answers, but the point is the write itself
            // binance closes every socket at the 24 hour mark with no warning in band
            retire_after: Some(Duration::from_secs(23 * 60 * 60)),
            retire_jitter: Duration::from_secs(30 * 60),
            ..FeedSettings::new(Duration::from_secs(240))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut linear = Vec::new();
        let mut inverse = Vec::new();
        for market in markets {
            if market.linear {
                linear.push(market.clone());
            } else {
                inverse.push(market.clone());
            }
        }

        let mut plans = plan_family(&linear, "linear", USD_M_BOOK_URL);
        plans.extend(plan_family(&inverse, "inverse", COIN_M_BOOK_URL));
        plans
    }

    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut streams = Vec::with_capacity(markets.len() * 2);
        for market in markets {
            streams.extend(stream_names(market));
        }

        let mut frames = Vec::new();
        for (i, params) in streams.chunks(STREAMS_PER_FRAME).enumerate() {
            let frame = serde_json::json!({ "method": "SUBSCRIBE", "params": params, "id": i + 1 });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let wrapper: StreamFrame = serde_json::from_slice(frame)?;

        // The combined stream wraps every event in data, and a bare event reads as a snapshot, as the Nest feed read it.
        let event = match wrapper.data {
            Some(event) => event,
            None => serde_json::from_slice(frame)?,
        };

        if let Some(depth) = Depth::read(event) {
            if wrapper.stream.is_some_and(|stream| stream.ends_with(DIFF_SUFFIX)) {
                apply_diff(depth, conn);
            } else {
                apply_snapshot(depth, conn);
            }
            return Ok(());
        }

        if let Some(error) = wrapper.error {
            tracing::error!(event = "venue_error", connection = conn.id(), code = error.code, message = %error.msg);
        } else if let Some(id) = wrapper.id {
            tracing::debug!(event = "subscribe_acknowledged", connection = conn.id(), id);
        }

        Ok(())
    }
}

fn plan_family(markets: &[Market], family: &str, base_url: &str) -> Vec<EndpointPlan> {
    let mut plans = Vec::new();
    for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
        plans.push(EndpointPlan {
            id: format!("{ID}#{family}#{i}"),
            url: format!("{base_url}?streams={}", stream_names(&slice[0]).join("/")),
            markets: slice.to_vec(),
        });
    }
    plans
}

fn stream_names(market: &Market) -> [String; 2] {
    let symbol = market.raw_market_id.to_lowercase();
    [format!("{symbol}{DIFF_SUFFIX}"), format!("{symbol}{SNAPSHOT_SUFFIX}")]
}

// The snapshot is the only frame that may widen the window, so it sets both bounds from its own deepest level.
fn apply_snapshot(depth: Depth, conn: &mut Connection<HashMap<usize, SymbolState>>) {
    let Some(position) = conn.position(depth.symbol) else {
        return;
    };

    // The diffs already carry this state, and rewinding to it would drop every level they added since.
    if conn.state.get(&position).is_some_and(|state| depth.last_update_id <= state.last_update_id) {
        return;
    }

    conn.state.insert(
        position,
        SymbolState {
            last_update_id: depth.last_update_id,
            lowest_bid: depth.bids.last().map_or(0.0, |level| level.price),
            highest_ask: depth.asks.last().map_or(f64::INFINITY, |level| level.price),
        },
    );
    conn.reset_book(position, &depth.bids, &depth.asks);
}

fn apply_diff(depth: Depth, conn: &mut Connection<HashMap<usize, SymbolState>>) {
    let Some(position) = conn.position(depth.symbol) else {
        return;
    };

    // Unsynced.
    // The next snapshot is at most one snapshot interval away and reseeds the symbol on its own.
    let Some(&state) = conn.state.get(&position) else {
        return;
    };
    if conn.book(position).is_none() {
        return;
    }

    if depth.last_update_id <= state.last_update_id {
        return;
    }

    // A diff either chains onto the last id or straddles it, which is how the first diff after a snapshot arrives.
    if depth.previous_update_id != state.last_update_id && depth.first_update_id > state.last_update_id + 1 {
        conn.state.remove(&position);
        tracing::warn!(
            event = "book_desync",
            connection = conn.id(),
            market = depth.symbol,
            reason = "sequence_gap",
            expected = state.last_update_id,
            first_update_id = depth.first_update_id,
            previous_update_id = depth.previous_update_id,
        );
        return;
    }

    let Some(book) = conn.book(position) else {
        return;
    };

    // Outside the window the book holds no levels, so writing there would put a level of rank 21 or worse inside a top 20 reading.
    for level in &depth.bids {
        if level.price >= state.lowest_bid {
            book.set_bid(level.price, level.size);
        }
    }
    for level in &depth.asks {
        if level.price <= state.highest_ask {
            book.set_ask(level.price, level.size);
        }
    }

    // Emptying a side inside the window says the window ran out, not that the venue withdrew the side.
    // The truth is one snapshot away, and a real one sided book still reaches the engine through apply_snapshot.
    if book.bids().is_empty() || book.asks().is_empty() {
        conn.state.remove(&position);
        return;
    }

    conn.state.insert(
        position,
        SymbolState {
            last_update_id: depth.last_update_id,
            ..state
        },
    );
    conn.publish(position);
}

#[derive(Deserialize)]
struct StreamFrame<'a> {
    #[serde(borrow)]
    stream: Option<&'a str>,
    #[serde(borrow)]
    data: Option<DepthEvent<'a>>,
    id: Option<u64>,
    error: Option<StreamError>,
}

#[derive(Deserialize)]
struct StreamError {
    code: i64,
    msg: String,
}

// Both channels send this shape, and a frame missing any of it is not a book frame.
#[derive(Deserialize)]
struct DepthEvent<'a> {
    #[serde(borrow)]
    e: Option<&'a str>,
    #[serde(borrow)]
    s: Option<&'a str>, // "BTCUSDT" or "BTCUSD_PERP"
    #[serde(rename = "U")]
    first_update_id: Option<i64>,
    u: Option<i64>,
    pu: Option<i64>, // the previous event's u, which only the diff stream needs to chain
    #[serde(default, deserialize_with = "wire::levels")]
    b: Vec<BookLevel>, // best first
    #[serde(default, deserialize_with = "wire::levels")]
    a: Vec<BookLevel>,
}

struct Depth<'a> {
    symbol: &'a str,
    first_update_id: i64,
    last_update_id: i64,
    previous_update_id: i64,
    bids: Vec<BookLevel>,
    asks: Vec<BookLevel>,
}

impl<'a> Depth<'a> {
    fn read(event: DepthEvent<'a>) -> Option<Self> {
        if event.e != Some("depthUpdate") {
            return None;
        }

        Some(Self {
            symbol: event.s?,
            first_update_id: event.first_update_id?,
            last_update_id: event.u?,
            previous_update_id: event.pu?,
            bids: event.b,
            asks: event.a,
        })
    }
}
