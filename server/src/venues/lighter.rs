// Lighter, a decentralised perpetual exchange on its own zero knowledge rollup over Ethereum, run by Elliot Technologies.
// Its API servers behind CloudFront are the only live source of the book, since no public node streams it.

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
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "lighter";

const REST: &str = "https://mainnet.zklighter.elliot.ai";

// The plain /stream refuses this host's Canadian exit with HTTP 400 and code 20558, "restricted jurisdiction".
// The venue documents this read-only URL for reading market data from restricted regions, and it serves every market channel.
const URL: &str = "wss://mainnet.zklighter.elliot.ai/stream?readonly=true";

// The whole book on subscribe, then the changed levels of each 50 ms batch, chained by begin_nonce.
const BOOK_PREFIX: &str = "order_book";
// Index, mark and the hourly funding estimate of every market, in one frame about a second that holds the markets whose stats changed.
const STATS_CHANNEL: &str = "market_stats/all";

// A connection may hold 500 subscriptions, and market_stats/all takes one of them.
const MARKETS_PER_CONNECTION: usize = 450;

// An IP may send 200 client messages a minute, so one subscribe per 400 ms holds a connection to 150 with room for pings and repairs.
const SUBSCRIBE_GAP: Duration = Duration::from_millis(400);

pub struct Lighter {
    rest: String,
    anchors: SocketAnchors,            // filled by handle from market_stats, read by fetch_round
    anchored: HashMap<String, String>, // <raw id, base> of the markets whose rows are kept, which leaves out the Pre-IPO markets
    oracles: Mutex<anchor::Oracles>,   // which indexes run on Lighter's own price, read by fetch_round
    first_round: OnceLock<Instant>,
}

impl Lighter {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(REST, markets)
    }

    fn with_rest(rest: &str, markets: &[TrackedMarket]) -> Self {
        let mut anchored = HashMap::with_capacity(markets.len());
        for tracked in markets {
            if !anchor::is_self_indexed(&tracked.market.base) {
                anchored.insert(tracked.market.raw_market_id.clone(), tracked.market.base.clone());
            }
        }

        Self {
            rest: rest.to_string(),
            anchors: SocketAnchors::new(true),
            anchored,
            oracles: Mutex::new(anchor::Oracles::default()),
            first_round: OnceLock::new(),
        }
    }
}

#[derive(Default)]
pub struct State {
    books: HashMap<usize, Chain>, // by position, from the market's first book frame
}

#[derive(Debug, PartialEq)]
enum Chain {
    Live(i64),      // nonce of the last frame applied, which the next delta names as begin_nonce
    Unsubscribing,  // emptied after a break, so the deltas still in flight are dropped until the venue acknowledges the unsubscribe
    Resubscribing,  // subscribed again, until the fresh snapshot
}

impl BookVenue for Lighter {
    type State = State;

    // The server never pings and closes a socket that sent nothing for 2 minutes, so the client pings.
    // market_stats/all arrives about every second, so 10 s of silence is a dead socket.
    // A second connection waits until the first has subscribed, since the message cap is per IP.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(30)),
            subscribe_gap: SUBSCRIBE_GAP,
            connect_stagger: SUBSCRIBE_GAP * (MARKETS_PER_CONNECTION as u32 + 1),
            ..FeedSettings::new(Duration::from_secs(10))
        }
    }

    // One socket carried 213 books and market_stats/all at 410 to 457 frames a second, so every market fits on one.
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

    // A frame takes one channel, since an array or a comma list is refused.
    // market_stats/all goes first, so the anchors fill while the books subscribe.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len() + 1);
        frames.push(command("subscribe", STATS_CHANNEL));
        for market in markets {
            frames.push(command("subscribe", &book_channel(&market.raw_market_id)));
        }
        frames
    }

    fn ping(&self, _state: &mut State) -> Message {
        Message::text(r#"{"type":"ping"}"#)
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
        let at = conn.frame_recv_ts();
        self.handle_at(frame, conn, at)
    }
}

impl Lighter {
    // `at` is the frame's arrival, which stamps the anchor fields it carries.
    fn handle_at(&self, frame: &[u8], conn: &mut Connection<State>, at: i64) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(frame)?;

        match frame.kind.as_ref() {
            "update/order_book" => on_delta(&frame, conn)?,
            "subscribed/order_book" => on_snapshot(&frame, conn)?,
            "update/market_stats" | "subscribed/market_stats" => {
                if let Some(stats) = &frame.market_stats {
                    self.write_anchors(stats, at);
                }
            }
            "unsubscribed" => on_unsubscribed(&frame.channel, conn),
            // The official SDK answers a server ping, although the server sent none on 2026-10-12.
            "ping" => conn.send(Message::text(r#"{"type":"pong"}"#)),
            "pong" | "connected" => {}
            // An error names no market and leaves the socket open, such as 30005 for an unknown or inactive market.
            _ => match &frame.error {
                Some(error) => tracing::error!(event = "venue_error", connection = conn.id(), code = error.code, message = %error.message),
                None => tracing::warn!(event = "venue_notice", connection = conn.id(), kind = %frame.kind, channel = %frame.channel),
            },
        }

        Ok(())
    }

    // A market's row comes only when its stats change, so a quiet market keeps the arrival of its last row and ages honestly.
    fn write_anchors(&self, stats: &HashMap<String, Stats>, at: i64) {
        for (raw_market_id, row) in stats {
            // The first frame also holds inactive, reduce only and denied markets.
            if !self.anchored.contains_key(raw_market_id) {
                continue;
            }

            if row.index_price.is_finite() {
                self.anchors.set_index(raw_market_id, row.index_price, at);
            }
            if row.mark_price.is_finite() {
                self.anchors.set_mark(raw_market_id, row.mark_price, at);
            }
            if row.current_funding_rate.is_finite() {
                let next_funding_at = anchor::next_after_settlement(row.funding_timestamp);
                self.anchors
                    .set_funding(raw_market_id, row.current_funding_rate / 100.0, anchor::FUNDING_INTERVAL_HOURS, next_funding_at);
            }
        }
    }
}

fn command(kind: &str, channel: &str) -> Message {
    Message::text(serde_json::json!({ "type": kind, "channel": channel }).to_string())
}

// The subscribe names "order_book/1" and the frames name "order_book:1".
fn book_channel(raw_market_id: &str) -> String {
    format!("{BOOK_PREFIX}/{raw_market_id}")
}

fn book_position(channel: &str, conn: &mut Connection<State>) -> Option<usize> {
    let raw_market_id = channel.strip_prefix(BOOK_PREFIX)?.strip_prefix(':')?;
    conn.position(raw_market_id)
}

// The snapshot is the whole book, and its nonce is what the first delta names as begin_nonce.
fn on_snapshot(frame: &Frame, conn: &mut Connection<State>) -> anyhow::Result<()> {
    let Some(book) = &frame.order_book else {
        anyhow::bail!("a snapshot on {} without order_book", frame.channel);
    };
    let Some(position) = book_position(&frame.channel, conn) else {
        return Ok(());
    };
    if !readable(&book.bids) || !readable(&book.asks) {
        repair(position, conn, "level_unreadable");
        return Ok(());
    }

    conn.state.books.insert(position, Chain::Live(book.nonce));
    conn.reset_book(position, &book.bids, &book.asks);
    Ok(())
}

// Sizes are absolute, and a size of zero written with the market's decimals, "0.00000", removes the level.
fn on_delta(frame: &Frame, conn: &mut Connection<State>) -> anyhow::Result<()> {
    let Some(book) = &frame.order_book else {
        anyhow::bail!("a delta on {} without order_book", frame.channel);
    };
    let Some(position) = book_position(&frame.channel, conn) else {
        return Ok(());
    };

    match conn.state.books.get(&position) {
        Some(Chain::Live(last)) if book.begin_nonce == *last => {}
        Some(Chain::Live(_)) => {
            repair(position, conn, "sequence_gap");
            return Ok(());
        }
        Some(Chain::Unsubscribing | Chain::Resubscribing) => return Ok(()),
        None => {
            repair(position, conn, "delta_before_snapshot");
            return Ok(());
        }
    }
    // The book would skip such a level and carry on, so a missed removal would stay in a book that looks live.
    if !readable(&book.bids) || !readable(&book.asks) {
        repair(position, conn, "level_unreadable");
        return Ok(());
    }

    conn.state.books.insert(position, Chain::Live(book.nonce));
    if book.bids.is_empty() && book.asks.is_empty() {
        return Ok(());
    }
    let Some(levels) = conn.book(position) else {
        return Ok(());
    };
    for level in &book.bids {
        levels.set_bid(level.price, level.size);
    }
    for level in &book.asks {
        levels.set_ask(level.price, level.size);
    }
    conn.publish(position);
    Ok(())
}

// The venue gives one market's unsubscribe and subscribe as the repair of a break.
// Ending the connection instead would resubscribe every market under the per IP message cap, which takes over a minute.
// So the market goes out empty, never a live leg, until its fresh snapshot, as xt and deepcoin repair one market.
fn repair(position: usize, conn: &mut Connection<State>, reason: &str) {
    let raw_market_id = conn.markets()[position].raw_market_id.clone();
    // Named book_resync like the runtime's own resync, so live_smoke fails on it, although the connection stays open.
    tracing::warn!(event = "book_resync", connection = conn.id(), market = %raw_market_id, reason, action = "resubscribe");

    conn.state.books.insert(position, Chain::Unsubscribing);
    conn.reset_book(position, &[], &[]);
    conn.send(command("unsubscribe", &book_channel(&raw_market_id)));
}

// The subscribe waits for this acknowledgement, since a subscribe the venue reads before the unsubscribe is refused with 30003.
fn on_unsubscribed(channel: &str, conn: &mut Connection<State>) {
    let Some(position) = book_position(channel, conn) else {
        return;
    };
    if conn.state.books.get(&position) != Some(&Chain::Unsubscribing) {
        return;
    }

    conn.state.books.insert(position, Chain::Resubscribing);
    let raw_market_id = conn.markets()[position].raw_market_id.clone();
    conn.send(command("subscribe", &book_channel(&raw_market_id)));
}

// The rule OrderBook applies to each level, where a size of 0 removes it.
fn readable(levels: &[BookLevel]) -> bool {
    levels.iter().all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

// Books, stats, acknowledgements, pongs and errors share the envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(rename = "type", default, borrow)]
    kind: Cow<'a, str>, // "update/order_book", "subscribed/order_book", "update/market_stats", "unsubscribed", "pong", "connected", absent on an error
    #[serde(default, borrow)]
    channel: Cow<'a, str>, // "order_book:1", "market_stats:all"
    order_book: Option<Book>,
    market_stats: Option<HashMap<String, Stats>>, // <market_id as a string, row>
    error: Option<VenueError>,
}

#[derive(Deserialize)]
struct Book {
    #[serde(default)]
    nonce: i64, // the matching engine's position, which does not step by one
    #[serde(default)]
    begin_nonce: i64, // the nonce of the frame this one continues, 0 on a snapshot
    #[serde(default, deserialize_with = "levels")]
    bids: Vec<BookLevel>, // best first, sizes in coins of the base
    #[serde(default, deserialize_with = "levels")]
    asks: Vec<BookLevel>,
}

#[derive(Deserialize)]
struct Stats {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    current_funding_rate: f64, // signed percent per hour, the estimate for the coming payment, where funding_rate is the last one
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_timestamp: f64, // Unix ms of the last settlement
}

#[derive(Deserialize)]
struct VenueError {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    message: String,
}

// {"price":"82532.0","size":"0.11754"}
#[derive(Deserialize)]
struct Level {
    #[serde(deserialize_with = "wire::num")]
    price: f64,
    #[serde(deserialize_with = "wire::num")]
    size: f64,
}

// A null reads as no levels, as wire::levels reads one.
fn levels<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<BookLevel>, D::Error> {
    let levels = Option::<Vec<Level>>::deserialize(deserializer)?.unwrap_or_default();
    Ok(levels.iter().map(|level| BookLevel { price: level.price, size: level.size }).collect())
}
