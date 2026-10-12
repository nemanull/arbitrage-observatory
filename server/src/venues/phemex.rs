mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::order_book::OrderBook;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "phemex";

const REST: &str = "https://api.phemex.com";

// One URL serves every family, and orderbook_p is the channel of the USDT-M and USDC-M contracts, with prices as decimal strings.
const PUBLIC_URL: &str = "wss://ws.phemex.com";
const CHANNEL: &str = "orderbook_p";
const BOOK_KEY: &[u8] = b"\"orderbook_p\"";

// The default book is 30 levels at about 20 ms, and the docs tell the client to keep only the top 30.
const DEPTH: usize = 30;

// The docs cap a socket at 20 subscriptions and a client at 5 sockets, while the wire took 101 and 6 on 2026-09-23.
// 50 per socket keeps three sockets for today's catalog, under the documented socket cap.
const MARKETS_PER_CONNECTION: usize = 50;

const PING_ID: i64 = 0; // a subscribe request carries its market's position plus one, so an error names the market

pub struct Phemex {
    rest: String,
}

impl Phemex {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self { rest: rest.to_string() }
    }
}

impl BookVenue for Phemex {
    type State = HashMap<usize, i64>; // `sequence` of the last frame applied, by position

    // The server closes a socket at about 31 s without a client ping even while books flow, and the docs ask for one every 5 s.
    // A quiet book sends nothing between its 60 s snapshots, so the pong is the traffic the silence check relies on.
    // The docs reconnect after three missed heartbeats, and the throttle is 20 requests a second per connection.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(5)),
            subscribe_gap: Duration::from_millis(100),
            ..FeedSettings::new(Duration::from_secs(15))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#perp#{i}"),
                url: PUBLIC_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // A frame takes one symbol, and a second symbol in params is acknowledged and ignored.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for (position, market) in markets.iter().enumerate() {
            let frame = serde_json::json!({
                "id": position + 1,
                "method": "orderbook_p.subscribe",
                "params": [market.raw_market_id],
            });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text(format!(r#"{{"id":{PING_ID},"method":"server.ping","params":[]}}"#))
    }

    fn handle(&self, bytes: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = match serde_json::from_slice(bytes) {
            Ok(frame) => frame,
            Err(error) => {
                // The sequence cannot show a book frame lost here, so every book on the connection is rebuilt.
                if bytes.windows(BOOK_KEY.len()).any(|window| window == BOOK_KEY) {
                    conn.resync("connection", "book_frame_unreadable");
                }
                return Err(error.into());
            }
        };

        if let Some(book) = &frame.orderbook_p {
            apply_book(&frame, book, conn);
            return Ok(());
        }

        // Acknowledgements and pongs carry a null error.
        if let Some(error) = &frame.error {
            let id = frame.id.unwrap_or(PING_ID);
            let market = usize::try_from(id)
                .ok()
                .and_then(|id| id.checked_sub(1))
                .and_then(|position| conn.markets().get(position))
                .map_or("", |market| market.raw_market_id.as_str());
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                channel = CHANNEL,
                request = id,
                market,
                code = error.code,
                message = error.message.as_deref().unwrap_or(""),
            );
        }

        Ok(())
    }
}

// The sequence is a counter shared by groups of symbols that jumps on most deltas, so no gap can be seen.
// Only a lower sequence than the last applied is out of order.
// A lost delta stays until the server's snapshot every 60 s, unless it crosses the top first.
fn apply_book(frame: &Frame, book: &BookSides, conn: &mut Connection<HashMap<usize, i64>>) {
    let raw_market_id = frame.symbol.as_deref().unwrap_or("");
    let Some(position) = conn.position(raw_market_id) else {
        return;
    };
    let sequence = frame.sequence.unwrap_or(0);

    match frame.kind.as_deref() {
        // The subscribe answer and the periodic snapshot both replace the book.
        Some("snapshot") => {
            conn.state.insert(position, sequence);
            conn.reset_book(position, &book.bids, &book.asks);
            if let Some(book) = conn.book(position) {
                trim(book);
            }
            return;
        }
        Some("incremental") => {}
        _ => {
            conn.resync(raw_market_id, "unknown_book_type");
            return;
        }
    }

    let Some(&last) = conn.state.get(&position) else {
        conn.resync(raw_market_id, "delta_before_snapshot");
        return;
    };
    if conn.book(position).is_none() {
        conn.resync(raw_market_id, "delta_before_snapshot");
        return;
    }
    if sequence < last {
        conn.resync(raw_market_id, "sequence_out_of_order");
        return;
    }
    conn.state.insert(position, sequence);

    if book.bids.is_empty() && book.asks.is_empty() {
        return;
    }

    let Some(order_book) = conn.book(position) else {
        return;
    };
    // Deltas are not always sorted, so each level is applied by price.
    let mut readable = true;
    for level in &book.bids {
        readable &= order_book.set_bid(level.price, level.size);
    }
    for level in &book.asks {
        readable &= order_book.set_ask(level.price, level.size);
    }
    trim(order_book);

    // A lost delta cannot show in the sequence, and a crossed top can, since none crossed in normal running.
    let crossed = is_crossed(order_book);
    if !readable {
        conn.resync(raw_market_id, "level_unreadable");
        return;
    }
    if crossed {
        conn.resync(raw_market_id, "crossed_book");
        return;
    }
    conn.publish(position);
}

// The docs say a level that falls out of the 30 is never updated again, so it is dropped here rather than left to go stale.
// The wire deleted such levels itself on 2026-09-23, which makes this a guard.
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

// Books, acknowledgements, pongs and errors share the envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    orderbook_p: Option<BookSides>,
    #[serde(borrow)]
    symbol: Option<Cow<'a, str>>, // "BTCUSDT", the catalog's id
    #[serde(rename = "type", borrow)]
    kind: Option<Cow<'a, str>>, // "snapshot" or "incremental"
    sequence: Option<i64>,
    id: Option<i64>, // the request's id on a reply, absent on a push
    error: Option<PhemexError>,
}

#[derive(Deserialize)]
struct BookSides {
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // base coins, a size of "0" deletes the level
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
}

#[derive(Deserialize)]
struct PhemexError {
    #[serde(default)]
    code: i64, // 6001 for an invalid argument or unknown symbol, 6015 past the subscription limit
    message: Option<String>,
}
