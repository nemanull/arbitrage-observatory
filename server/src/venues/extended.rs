mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::order_book::OrderBook;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "extended";

// The host names Starknet, which settles until the move to Circle's Arc from 2026-10-22, and no host after the move is published.
const REST: &str = "https://api.starknet.extended.exchange";

// The path is the subscription, so nothing is sent after the handshake.
// Without a market it carries the full depth book of every market the venue lists, delisted and spot ones included.
const URL: &str = "wss://api.starknet.extended.exchange/stream.extended.exchange/v1/orderbooks";

// The load balancer answers 403 to a handshake that carries no User-Agent, as it does to a REST call.
const HEADERS: &[(&str, &str)] = &[("User-Agent", "arbitrage-observatory")];

pub struct Extended {
    rest: String,
    query: String, // "?market=BTC-USD&market=ETH-USD", the tracked markets the anchor call names
}

impl Extended {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(markets, REST)
    }

    fn with_rest(markets: &[TrackedMarket], rest: &str) -> Self {
        Self {
            rest: rest.to_string(),
            query: anchor::query(markets),
        }
    }
}

#[derive(Default)]
pub struct State {
    positions: Option<HashMap<String, usize>>, // the plan's raw ids, read from the connection at its first frame
    last_seq: i64,                             // 0 before the first frame
    held: Option<Held>,
}

// A market's book while its opening replay is applied, which the engine must not see.
struct Held {
    position: usize,
    book: OrderBook,
}

impl BookVenue for Extended {
    type State = State;

    // The server pings about every 1.13 s and closes a socket with 1011 15 s after a ping it got no pong to, and tungstenite answers every ping.
    // Frames arrive many times a second, so 10 s of silence is a dead socket.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            headers: HEADERS,
            ..FeedSettings::new(Duration::from_secs(10))
        }
    }

    // One socket carries every market, so one plan holds them all.
    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        if markets.is_empty() {
            return Vec::new();
        }

        vec![EndpointPlan {
            id: format!("{ID}#perp#0"),
            url: URL.to_string(),
            markets: markets.to_vec(),
        }]
    }

    // A client frame is ignored, and an unknown market in the path is silent rather than refused.
    fn subscribe_frames(&self, _markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        Vec::new()
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(frame)?;
        let market = frame.data.m.as_ref();

        // One count runs across every market on the connection, so a frame lost on an untracked market is a gap too.
        if frame.seq != conn.state.last_seq + 1 {
            conn.resync(market, "sequence_gap");
            return Ok(());
        }
        conn.state.last_seq = frame.seq;

        let position = planned(conn, market);

        // After an open the server sends each market's last periodic snapshot, up to 60 s old, then replays every delta since it.
        // It replays one market after another, so a frame of any other market means the held market has caught up.
        if conn.state.held.as_ref().is_some_and(|held| Some(held.position) != position) {
            release(conn);
        }

        let Some(position) = position else {
            return Ok(());
        };

        match frame.kind.as_ref() {
            "SNAPSHOT" => apply_snapshot(position, &frame, conn),
            "DELTA" => apply_delta(position, &frame, conn),
            kind => tracing::warn!(event = "venue_notice", connection = conn.id(), market, kind),
        }

        Ok(())
    }
}

// The position of a market the plan holds, or None without the warning that position logs once per unknown symbol.
// The socket carries about 390 markets, most of them never tracked, so that warning would fire for each.
fn planned(conn: &mut Connection<State>, market: &str) -> Option<usize> {
    if conn.state.positions.is_none() {
        let mut positions = HashMap::with_capacity(conn.markets().len());
        for (position, tracked) in conn.markets().iter().enumerate() {
            positions.insert(tracked.raw_market_id.clone(), position);
        }
        conn.state.positions = Some(positions);
    }

    conn.state.positions.as_ref()?.get(market).copied()
}

// The held book is the market's book now, so the engine gets it whole.
fn release(conn: &mut Connection<State>) {
    if let Some(held) = conn.state.held.take() {
        conn.reset_book(held.position, held.book.bids(), held.book.asks());
    }
}

// A snapshot is the whole book with absolute sizes in q.
// The periodic one, every 60 s on the venue's clock, replaces a live book at once.
// The first one on a connection starts the market's replay, which is held.
fn apply_snapshot(position: usize, frame: &Frame, conn: &mut Connection<State>) {
    let (Some(bids), Some(asks)) = (book_levels(&frame.data.b, |level| level.q), book_levels(&frame.data.a, |level| level.q)) else {
        conn.resync(&frame.data.m, "level_unreadable");
        return;
    };

    if conn.book(position).is_some() {
        conn.reset_book(position, &bids, &asks);
        return;
    }

    let mut book = OrderBook::default();
    book.reset(&bids, &asks);
    conn.state.held = Some(Held { position, book });
}

// A delta sets each level to its absolute size c, where 0 removes the level, and q is only the change.
// An empty delta, which comes before each periodic snapshot, changes nothing.
fn apply_delta(position: usize, frame: &Frame, conn: &mut Connection<State>) {
    let (Some(bids), Some(asks)) = (book_levels(&frame.data.b, |level| level.c), book_levels(&frame.data.a, |level| level.c)) else {
        conn.resync(&frame.data.m, "level_unreadable");
        return;
    };

    if let Some(book) = conn.book(position) {
        if bids.is_empty() && asks.is_empty() {
            return;
        }
        set_levels(book, &bids, &asks);
        conn.publish(position);
        return;
    }

    if let Some(held) = conn.state.held.as_mut()
        && held.position == position
    {
        set_levels(&mut held.book, &bids, &asks);
        return;
    }

    // Every market's first frame on a connection is its snapshot, so a delta with no book means a frame was lost.
    conn.resync(&frame.data.m, "delta_before_snapshot");
}

fn set_levels(book: &mut OrderBook, bids: &[BookLevel], asks: &[BookLevel]) {
    for level in bids {
        book.set_bid(level.price, level.size);
    }
    for level in asks {
        book.set_ask(level.price, level.size);
    }
}

// None when a level cannot be read, because the book would skip it and a missed removal would stay in a book that looks live.
fn book_levels(levels: &[Level], size: fn(&Level) -> f64) -> Option<Vec<BookLevel>> {
    let mut out = Vec::with_capacity(levels.len());
    for level in levels {
        let level = BookLevel { price: level.p, size: size(level) };
        if !level.price.is_finite() || level.price <= 0.0 || !level.size.is_finite() || level.size < 0.0 {
            return None;
        }
        out.push(level);
    }
    Some(out)
}

#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(rename = "type", borrow)]
    kind: Cow<'a, str>, // "SNAPSHOT" or "DELTA"
    #[serde(borrow)]
    data: Data<'a>,
    seq: i64, // one count per connection across every market, from 1
}

#[derive(Deserialize)]
struct Data<'a> {
    #[serde(borrow)]
    m: Cow<'a, str>, // "BTC-USD", the catalog's name
    #[serde(default)]
    b: Vec<Level>, // best first
    #[serde(default)]
    a: Vec<Level>,
}

// {"q":"0.00028","p":"82502","c":"0.00046"} on a delta, and no c on a snapshot.
#[derive(Deserialize)]
struct Level {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    p: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    q: f64, // the absolute size on a snapshot, and only the change on a delta
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    c: f64, // the absolute size on a delta, in units of the asset
}
