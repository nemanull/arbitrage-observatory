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
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "dydx";

// The Indexer is a read service fed by one full node of the dYdX Chain, and it serves the catalog, the anchor and the books.
const REST: &str = "https://indexer.dydx.trade/v4";
const URL: &str = "wss://indexer.dydx.trade/v4/ws";

// The whole book of up to 100 levels a side on subscribe, then one frame per change.
// Unbatched, since a batch holds a change for up to 250 ms.
const CHANNEL: &str = "v4_orderbook";

// The server refuses the 33rd book on a connection, so 73 markets take three sockets of at most 25.
const MARKETS_PER_CONNECTION: usize = 25;

pub struct Dydx {
    rest: String,
}

impl Dydx {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self { rest: rest.to_string() }
    }
}

// The message_id chain of one connection.
#[derive(Default)]
pub struct State {
    answered: usize,       // subscribe frames the server has answered, each with a snapshot or an error
    expected: Option<i64>, // message_id of the next data frame, None until the chain is anchored
}

impl BookVenue for Dydx {
    type State = State;

    // The books of one connection change hundreds of times a second, and the server's ws library answers every protocol ping.
    // So a socket silent for 20 s is dead, while the server's own ping every 30 s, which tungstenite answers, keeps it open.
    // Subscribe frames went 30 ms apart in every probe without a refusal.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(10)),
            subscribe_gap: Duration::from_millis(30),
            ..FeedSettings::new(Duration::from_secs(20))
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

    // A frame names one channel and one id, so each market takes its own frame.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for market in markets {
            let frame = serde_json::json!({ "type": "subscribe", "channel": CHANNEL, "id": market.raw_market_id });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let envelope: Envelope = serde_json::from_slice(frame)?;
        let channel = envelope.channel.as_deref().unwrap_or("");
        let market = envelope.id.as_deref().unwrap_or("");

        match envelope.kind.as_ref() {
            "channel_data" if channel == CHANNEL => {
                let subscribed = conn.markets().len();
                if let Err(expected) = check_sequence(&mut conn.state, envelope.message_id, subscribed) {
                    tracing::warn!(event = "message_id_gap", connection = conn.id(), market, expected, got = envelope.message_id);
                    conn.resync(market, "sequence_gap");
                    return Ok(());
                }
                let delta: Frame<Delta> = match serde_json::from_slice(frame) {
                    Ok(delta) => delta,
                    Err(error) => {
                        conn.resync(market, "frame_unreadable");
                        return Err(error.into());
                    }
                };
                apply_delta(market, &delta.contents, conn);
            }
            "subscribed" => {
                conn.state.answered += 1;
                if channel != CHANNEL {
                    return Ok(());
                }
                let snapshot: Frame<Snapshot> = match serde_json::from_slice(frame) {
                    Ok(snapshot) => snapshot,
                    Err(error) => {
                        conn.resync(market, "frame_unreadable");
                        return Err(error.into());
                    }
                };
                apply_snapshot(market, &snapshot.contents, conn);
            }
            // A refused subscribe's error carries the number that subscribe took, and an unreadable frame's repeats the number before it.
            // So the chain anchors again on the next data frame.
            "error" => {
                conn.state.answered += 1;
                conn.state.expected = None;
                tracing::error!(
                    event = "venue_error",
                    connection = conn.id(),
                    message = envelope.message.as_deref().unwrap_or(""),
                    channel,
                    market,
                    message_id = envelope.message_id,
                );
            }
            "connected" => {}
            _ => tracing::warn!(event = "venue_notice", connection = conn.id(), frame = %String::from_utf8_lossy(frame)),
        }

        Ok(())
    }
}

// message_id is one counter per connection, and a subscribe takes its number when the server reads it.
// The snapshot or error that answers it carries that number whenever it comes, so data frames step over the numbers still owed.
// Once every subscribe is answered, each data frame is the last plus one, and a break returns the number the chain expected.
fn check_sequence(state: &mut State, message_id: i64, subscribed: usize) -> Result<(), i64> {
    if state.answered < subscribed {
        return Ok(());
    }

    match state.expected.replace(message_id + 1) {
        Some(expected) if expected != message_id => Err(expected),
        _ => Ok(()),
    }
}

// The snapshot is the book the Indexer's REST call returns, and the server registers the subscription only once it is sent, so no delta comes before it.
fn apply_snapshot(market: &str, snapshot: &Snapshot, conn: &mut Connection<State>) {
    let Some(position) = conn.position(market) else {
        return;
    };
    if !readable(&snapshot.bids) || !readable(&snapshot.asks) {
        conn.resync(market, "level_unreadable");
        return;
    }

    conn.reset_book(position, &snapshot.bids, &snapshot.asks);
    let Some(book) = conn.book(position) else {
        return;
    };
    let cross = uncross(book, |_| true, |_| true);
    log_uncrossed(market, cross, conn);
}

// Each level is the new total size at its price, and a size of 0 removes it.
fn apply_delta(market: &str, delta: &Delta, conn: &mut Connection<State>) {
    let Some(position) = conn.position(market) else {
        return;
    };
    if !readable(&delta.bids) || !readable(&delta.asks) {
        conn.resync(market, "level_unreadable");
        return;
    }
    let Some(book) = conn.book(position) else {
        conn.resync(market, "delta_before_snapshot");
        return;
    };
    if delta.bids.is_empty() && delta.asks.is_empty() {
        return;
    }

    for level in &delta.bids {
        book.set_bid(level.price, level.size);
    }
    for level in &delta.asks {
        book.set_ask(level.price, level.size);
    }
    let cross = uncross(book, |price| sets(&delta.bids, price), |price| sets(&delta.asks, price));
    log_uncrossed(market, cross, conn);
    conn.publish(position);
}

fn sets(levels: &[BookLevel], price: f64) -> bool {
    levels.iter().any(|level| level.price == price)
}

// What one uncross removed, and the best bid and ask that crossed first.
struct Cross {
    bid: f64,
    ask: f64,
    dropped_bids: u32,
    dropped_asks: u32,
}

// The Indexer's book is the view of the node it listens to, so a new order can cross a level that node has not yet seen leave.
// A level the snapshot holds can also be gone already, since a change between the server's fetch and its registration of the subscription never comes.
// The documentation asks to drop the older of two crossing levels.
// Every frame leaves the book uncrossed, so a cross is made by the current frame, and the older level is the one this frame did not set.
// Two levels of one age both go, as the touching levels of a crossed snapshot do.
fn uncross(book: &mut OrderBook, new_bid: impl Fn(f64) -> bool, new_ask: impl Fn(f64) -> bool) -> Option<Cross> {
    let mut cross: Option<Cross> = None;

    while let (Some(bid), Some(ask)) = (book.bids().first().copied(), book.asks().first().copied())
        && bid.price >= ask.price
    {
        let (drop_bid, drop_ask) = match (new_bid(bid.price), new_ask(ask.price)) {
            (true, false) => (false, true),
            (false, true) => (true, false),
            _ => (true, true),
        };
        let cross = cross.get_or_insert(Cross { bid: bid.price, ask: ask.price, dropped_bids: 0, dropped_asks: 0 });
        if drop_bid {
            book.set_bid(bid.price, 0.0);
            cross.dropped_bids += 1;
        }
        if drop_ask {
            book.set_ask(ask.price, 0.0);
            cross.dropped_asks += 1;
        }
    }

    cross
}

fn log_uncrossed(market: &str, cross: Option<Cross>, conn: &Connection<State>) {
    if let Some(cross) = cross {
        tracing::warn!(
            event = "book_uncrossed",
            connection = conn.id(),
            market,
            bid = cross.bid,
            ask = cross.ask,
            dropped_bids = cross.dropped_bids,
            dropped_asks = cross.dropped_asks,
        );
    }
}

// The rule OrderBook applies to each level, where a size of 0 deletes.
// OrderBook skips any other level without a word, so a removal it could not read would stay in a book that looks live.
fn readable(levels: &[BookLevel]) -> bool {
    levels.iter().all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

// Every frame the server sends shares the envelope.
#[derive(Deserialize)]
struct Envelope<'a> {
    #[serde(rename = "type", borrow)]
    kind: Cow<'a, str>, // "connected", "subscribed", "channel_data" or "error"
    #[serde(default)]
    message_id: i64,
    #[serde(borrow)]
    channel: Option<Cow<'a, str>>,
    #[serde(borrow)]
    id: Option<Cow<'a, str>>, // the ticker as subscribed, "BTC-USD", absent on most errors
    #[serde(borrow)]
    message: Option<Cow<'a, str>>, // an error's text
}

#[derive(Deserialize)]
struct Frame<T> {
    contents: T,
}

// Prices and sizes in USD and base coins, best first.
#[derive(Deserialize)]
struct Snapshot {
    #[serde(default, deserialize_with = "price_levels")]
    bids: Vec<BookLevel>,
    #[serde(default, deserialize_with = "price_levels")]
    asks: Vec<BookLevel>,
}

// Either side may be absent, and the pairs come in no order.
#[derive(Deserialize)]
struct Delta {
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // [["82552","0.0605"]], the new total size, "0" removes
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
}

// {"price":"82483","size":"0.0606"}
#[derive(Deserialize)]
struct PriceLevel {
    #[serde(deserialize_with = "wire::num")]
    price: f64,
    #[serde(deserialize_with = "wire::num")]
    size: f64,
}

fn price_levels<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<BookLevel>, D::Error> {
    let levels = Vec::<PriceLevel>::deserialize(deserializer)?;
    Ok(levels.iter().map(|level| BookLevel { price: level.price, size: level.size }).collect())
}
