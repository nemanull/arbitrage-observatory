mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use anchor::Funding;
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "bitradex";

const REST: &str = "https://www.bitradex.ai";

// The web app's futures socket, which carries every USDT-M contract.
const BOOK_URL: &str = "wss://fws.bitradex.ai/public";

// A whole book of 20 levels about once a second, whose id is the u of the last change it holds.
// It repeats with the same id while the book is still, and it can arrive before the delta that carries its id.
const SNAPSHOT_TOPIC: &str = "depth";
const SNAPSHOT_LEVELS: usize = 20;

// Changes at any depth as absolute sizes, chained by pu, with no snapshot of their own.
const DELTA_TOPIC: &str = "depth_update";

// All 56 contracts ran on one socket at 94 frames a second with no gap, and the cap only splits a catalog that grows.
const MARKETS_PER_CONNECTION: usize = 60;
const MARKETS_PER_FRAME: usize = 10; // 20 topics, the frame size the profile's batch run used

pub struct Bitradex {
    rest: String,
    markets: Vec<String>, // raw ids whose funding the poller reads in turn
    funding: Mutex<Funding>,
}

impl Bitradex {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(markets, REST)
    }

    fn with_rest(markets: &[TrackedMarket], rest: &str) -> Self {
        Self {
            rest: rest.to_string(),
            markets: markets.iter().map(|tracked| tracked.market.raw_market_id.clone()).collect(),
            funding: Mutex::new(Funding::default()),
        }
    }
}

#[derive(Debug, Clone, Copy)]
pub struct SymbolState {
    last: i64,        // the snapshot's id or the u of the last delta applied
    lowest_bid: f64,  // the deepest bid the last snapshot covered, 0 when it held the whole side
    highest_ask: f64, // the deepest ask the last snapshot covered, infinite when it held the whole side
}

impl BookVenue for Bitradex {
    type State = HashMap<usize, SymbolState>; // by position, absent until a snapshot seeds the market

    // The web app sends a text ping every 15 s, and a socket that sent nothing closed at 60 s.
    // Snapshots arrive about once a second per market, so 20 s of silence is a dead socket.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(15)),
            ..FeedSettings::new(Duration::from_secs(20))
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

    // An unknown topic gets no answer at all, so a misspelled one shows only as book_unserved.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_FRAME).enumerate() {
            let mut params = Vec::with_capacity(slice.len() * 2);
            for market in slice {
                params.push(format!("{SNAPSHOT_TOPIC}@{},{SNAPSHOT_LEVELS}", market.raw_market_id));
                params.push(format!("{DELTA_TOPIC}@{},100ms", market.raw_market_id));
            }
            let frame = serde_json::json!({ "method": "subscribe", "params": params, "id": format!("{}", i + 1) });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text("ping")
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        // The answer to the ping, and the answer to a frame the venue could not read, are the only frames that are not JSON.
        match frame {
            b"pong" => return Ok(()),
            b"Invalid parameter" => {
                tracing::error!(event = "venue_error", connection = conn.id(), message = "Invalid parameter");
                return Ok(());
            }
            _ => {}
        }

        let frame: Frame = serde_json::from_slice(frame)?;
        match (frame.topic.as_deref(), frame.data) {
            (Some(SNAPSHOT_TOPIC), Some(data)) => on_snapshot(data, conn),
            (Some(DELTA_TOPIC), Some(data)) => on_delta(data, conn),
            (Some(topic), _) => {
                tracing::warn!(event = "venue_notice", connection = conn.id(), topic);
                Ok(())
            }
            // An acknowledgement, which names the frame's id and carries empty levels as data.
            (None, _) => {
                let id = frame.id.as_deref().unwrap_or("");
                let message = frame.msg.as_deref().unwrap_or("");
                match frame.code {
                    Some(0) => tracing::debug!(event = "subscribe_acknowledged", connection = conn.id(), id),
                    Some(code) => tracing::error!(event = "venue_error", connection = conn.id(), code, id, message),
                    None => tracing::warn!(event = "venue_notice", connection = conn.id(), id, message),
                }
                Ok(())
            }
        }
    }
}

// The snapshot is the only frame that may widen the window, so it sets both bounds from its own deepest level.
fn on_snapshot(data: Data, conn: &mut Connection<HashMap<usize, SymbolState>>) -> anyhow::Result<()> {
    let Some(symbol) = data.s.as_deref() else {
        anyhow::bail!("a snapshot without s");
    };
    let Some(position) = conn.position(symbol) else {
        return Ok(());
    };
    if !data.id.is_finite() {
        anyhow::bail!("a snapshot on {symbol} without id");
    }
    let id = data.id as i64;

    // A repeat of the book the market already holds, or an older one that would drop the changes the deltas made since.
    if conn.state.get(&position).is_some_and(|state| id <= state.last) {
        return Ok(());
    }

    if !readable(&data.b) || !readable(&data.a) {
        desync(conn, position, symbol, "unreadable_level");
        return Ok(());
    }
    if crossed(&data.b, &data.a) {
        desync(conn, position, symbol, "crossed_book");
        return Ok(());
    }

    // A side shorter than the channel's depth is the whole side, so the deltas may write anywhere on it.
    let lowest_bid = if data.b.len() < SNAPSHOT_LEVELS { 0.0 } else { data.b.last().map_or(0.0, |level| level.price) };
    let highest_ask = if data.a.len() < SNAPSHOT_LEVELS { f64::INFINITY } else { data.a.last().map_or(f64::INFINITY, |level| level.price) };
    conn.state.insert(position, SymbolState { last: id, lowest_bid, highest_ask });
    conn.reset_book(position, &data.b, &data.a);
    Ok(())
}

fn on_delta(data: Data, conn: &mut Connection<HashMap<usize, SymbolState>>) -> anyhow::Result<()> {
    let Some(symbol) = data.s.as_deref() else {
        anyhow::bail!("a delta without s");
    };
    let Some(position) = conn.position(symbol) else {
        return Ok(());
    };
    if !(data.pu.is_finite() && data.fu.is_finite() && data.u.is_finite()) {
        anyhow::bail!("a delta on {symbol} without pu, fu or u");
    }
    let (pu, fu, u) = (data.pu as i64, data.fu as i64, data.u as i64);

    // Unseeded, and the next snapshot is about a second away.
    let Some(&state) = conn.state.get(&position) else {
        return Ok(());
    };

    // Already in the snapshot, which can arrive first.
    if u <= state.last {
        return Ok(());
    }

    // A delta chains onto the last id, or straddles a snapshot's id, which sits anywhere inside a delta's range.
    if pu != state.last && fu > state.last + 1 {
        conn.state.remove(&position);
        tracing::warn!(
            event = "book_desync",
            connection = conn.id(),
            market = symbol,
            reason = "sequence_gap",
            expected = state.last,
            pu,
            fu,
            u,
        );
        conn.resync(symbol, "sequence_gap");
        return Ok(());
    }

    // The order book skips a level it cannot read, which would leave that change out while the chain moves on.
    if !readable(&data.b) || !readable(&data.a) {
        desync(conn, position, symbol, "unreadable_level");
        return Ok(());
    }

    let Some(book) = conn.book(position) else {
        return Ok(());
    };

    // Outside the window the book holds no levels, so writing there would put a level of rank 21 or worse inside a top 20 reading.
    for level in &data.b {
        if level.price >= state.lowest_bid {
            book.set_bid(level.price, level.size);
        }
    }
    for level in &data.a {
        if level.price <= state.highest_ask {
            book.set_ask(level.price, level.size);
        }
    }

    // Emptying a side a full snapshot only began says the window ran out, not that the venue withdrew the side.
    // The truth is a snapshot away, and a side the snapshot held whole may really empty.
    if (book.bids().is_empty() && state.lowest_bid > 0.0) || (book.asks().is_empty() && state.highest_ask.is_finite()) {
        conn.state.remove(&position);
        return Ok(());
    }
    if crossed(book.bids(), book.asks()) {
        desync(conn, position, symbol, "crossed_book");
        return Ok(());
    }

    conn.state.insert(position, SymbolState { last: u, ..state });
    conn.publish(position);
    Ok(())
}

fn readable(levels: &[BookLevel]) -> bool {
    levels.iter().all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

// Both the snapshot's sides and the book's are best first.
fn crossed(bids: &[BookLevel], asks: &[BookLevel]) -> bool {
    matches!((bids.first(), asks.first()), (Some(bid), Some(ask)) if bid.price >= ask.price)
}

// The market stays unpublished until the reconnect's snapshots rebuild every book on the socket.
fn desync(conn: &mut Connection<HashMap<usize, SymbolState>>, position: usize, symbol: &str, reason: &str) {
    conn.state.remove(&position);
    tracing::warn!(event = "book_desync", connection = conn.id(), market = symbol, reason);
    conn.resync(symbol, reason);
}

// Book frames and acknowledgements share the envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    topic: Option<Cow<'a, str>>, // "depth" or "depth_update", absent on an acknowledgement
    #[serde(borrow)]
    data: Option<Data<'a>>,
    code: Option<i64>, // 0 on an acknowledgement
    #[serde(borrow)]
    id: Option<Cow<'a, str>>,
    #[serde(borrow)]
    msg: Option<Cow<'a, str>>, // "success"
}

// Ids are decimal strings near 1.45e12, which an f64 holds exactly.
#[derive(Deserialize)]
struct Data<'a> {
    #[serde(borrow)]
    s: Option<Cow<'a, str>>, // "btc_usdt"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    id: f64, // the snapshot's place in the sequence
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    pu: f64, // the u of the delta before
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    fu: f64, // a delta's first id, pu plus one
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    u: f64,
    #[serde(default, deserialize_with = "wire::levels")]
    b: Vec<BookLevel>, // [price, contracts] strings, best first, and null on an acknowledgement
    #[serde(default, deserialize_with = "wire::levels")]
    a: Vec<BookLevel>,
}
