mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use crate::clock::now_ms;
use crate::engine::cluster::index_builder::DEPTH_LEVEL;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use crate::venues::wire;
use anchor::Intervals;
use serde::de::{Deserializer, IgnoredAny, SeqAccess, Visitor};
use serde::Deserialize;
use std::borrow::Cow;
use std::fmt;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "uzx";

// The documented host of the product list, the tickers and the books.
const REST: &str = "https://api-v2.uzx.com";

// The web client's host, the only one with the status list and the funding history.
const WEB: &str = "https://api.uzx.com";

// One URL serves every family, and every public channel shares it.
const PUBLIC_URL: &str = "wss://stream.uzx.com/notification/ws";

const BOOK_CHANNEL: &str = "swap.orderbook";

// Step 0 is the only exact book, since steps 1 to 3 group prices into coarser buckets.
const BOOK_STEP: &str = "0";

// 60 contracts on one socket were all served at about 415 frames a second, and the venue allows 240 subscriptions an hour.
// Each socket costs one subscription per market on every open, so fewer sockets spend the hourly budget no faster.
const MARKETS_PER_CONNECTION: usize = 60;

// An unknown frame is logged up to this many bytes, since a stray book or ticker frame runs to kilobytes.
const NOTICE_BYTES: usize = 300;

pub struct Uzx {
    rest: String,
    web: String,
    markets: Vec<String>, // tracked raw ids, whose funding intervals are read in turn
    intervals: Mutex<Intervals>,
    clock: fn() -> i64,
}

impl Uzx {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_hosts(markets, REST, WEB, now_ms)
    }

    fn with_hosts(markets: &[TrackedMarket], rest: &str, web: &str, clock: fn() -> i64) -> Self {
        let mut ids = Vec::with_capacity(markets.len());
        for tracked in markets {
            ids.push(tracked.market.raw_market_id.clone());
        }

        Self {
            rest: rest.to_string(),
            web: web.to_string(),
            markets: ids,
            intervals: Mutex::new(Intervals::default()),
            clock,
        }
    }
}

#[derive(Default)]
pub struct State {
    seq: Vec<u64>, // by position, the seqId of the last book applied, 0 before the first
}

impl BookVenue for Uzx {
    type State = State;

    // The server pings every 5 s and closes at 20 s without a pong, and every book stream pushed at least once per 918 ms.
    // The venue allows one connection a second.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            connect_stagger: Duration::from_secs(1),
            ..FeedSettings::new(Duration::from_secs(10))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#swap#{i}"),
                url: PUBLIC_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // One symbol per frame is the only form the venue accepts, and 60 in a burst were all acknowledged.
    // zip true would switch the whole socket to Zstandard frames.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for market in markets {
            let frame = serde_json::json!({
                "event": "sub",
                "params": { "biz": "market", "type": BOOK_CHANNEL, "symbol": market.raw_market_id, "interval": BOOK_STEP },
                "zip": false,
            });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn handle(&self, bytes: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(bytes)?;

        // The server drives the keepalive and wants its number echoed.
        if let Some(ping) = frame.ping {
            conn.send(Message::text(format!("{{\"pong\":{ping}}}")));
            return Ok(());
        }

        if let Some(event) = frame.event.as_deref() {
            let status = frame.status.as_deref().unwrap_or("");
            let topic = frame.topic.as_deref().unwrap_or("");
            match (event, status) {
                ("subscribe", "ok") => {}
                // The refusal of an unknown symbol, a bad channel or a bad step carries no code and no message.
                (_, "error") => tracing::error!(event = "venue_error", connection = conn.id(), op = event, topic),
                _ => tracing::warn!(event = "venue_notice", connection = conn.id(), op = event, status, topic),
            }
            return Ok(());
        }

        // A book frame has no event key, so it is told by its levels.
        if let Some(symbol) = frame.product_name.as_deref()
            && (frame.bids.is_some() || frame.asks.is_some())
        {
            apply_book(symbol, frame.seq_id, frame.bids, frame.asks, conn);
            return Ok(());
        }

        match frame.kind.as_deref() {
            // Every new socket gets one, such as change.swap.config naming a contract or change.app-config.config naming none, and its meaning is not published.
            Some(kind) if kind.starts_with("change.") => {
                tracing::info!(event = "venue_notice", connection = conn.id(), kind, market = frame.symbol.as_deref().unwrap_or(""));
            }
            // The first frame on every socket is a pong nobody asked for.
            _ if frame.pong.is_some() => {}
            // The answer to a spent subscription budget has never been seen, so the frame itself is kept.
            kind => {
                let text = String::from_utf8_lossy(&bytes[..bytes.len().min(NOTICE_BYTES)]);
                tracing::warn!(event = "venue_notice", connection = conn.id(), kind = kind.unwrap_or(""), frame = %text);
            }
        }

        Ok(())
    }
}

// Every push is the whole book, sorted, so it replaces the book and no sequence needs chaining.
// The seqId per contract never went back and repeated only on an identical book, which is still published as a sign of life.
// One socket delivers in order, so a lower seqId means the venue restarted its stream, and dropping every frame after it would freeze the book.
fn apply_book(symbol: &str, seq_id: Option<u64>, bids: Option<Side>, asks: Option<Side>, conn: &mut Connection<State>) {
    let Some(position) = conn.position(symbol) else {
        return;
    };

    let seq = &mut conn.state.seq;
    if seq.len() <= position {
        seq.resize(position + 1, 0);
    }
    if let Some(seq_id) = seq_id {
        let last = seq[position];
        if seq_id < last {
            tracing::warn!(event = "book_frame_older", connection = conn.id(), market = symbol, seq_id, last);
            conn.resync(symbol, "sequence_went_back");
            return;
        }
        seq[position] = seq_id;
    }

    let bids = bids.map_or_else(Vec::new, |side| side.0);
    let asks = asks.map_or_else(Vec::new, |side| side.0);
    conn.reset_book(position, &bids, &asks);
}

// Books, acks, pings and notices share the envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    ping: Option<i64>, // Unix ms, the server's keepalive
    pong: Option<IgnoredAny>,
    #[serde(borrow)]
    event: Option<Cow<'a, str>>, // "subscribe" or "unsubbed" on an ack
    #[serde(borrow)]
    status: Option<Cow<'a, str>>, // "ok" or "error" on an ack
    #[serde(borrow)]
    topic: Option<Cow<'a, str>>, // "swap.BTCUSDT.depth.step0" on an ack
    #[serde(rename = "type", borrow)]
    kind: Option<Cow<'a, str>>, // "swap.BTCUSDT.orderBook" or "change.swap.config"
    #[serde(borrow)]
    product_name: Option<Cow<'a, str>>, // "BTCUSDT" on a book
    #[serde(borrow)]
    symbol: Option<Cow<'a, str>>, // on a change notice, "ICPUSDT" or empty
    #[serde(rename = "seqId")]
    seq_id: Option<u64>,
    bids: Option<Side>,
    asks: Option<Side>,
}

// The first DEPTH_LEVEL levels of a side, best first, as [price, contracts] strings.
// A side holds up to 500 levels, so the rest are skipped unparsed.
struct Side(Vec<BookLevel>);

impl<'de> Deserialize<'de> for Side {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_seq(SideVisitor)
    }
}

struct SideVisitor;

impl<'de> Visitor<'de> for SideVisitor {
    type Value = Side;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("an array of [price, size] levels")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Side, A::Error> {
        let mut levels = Vec::with_capacity(DEPTH_LEVEL);
        while levels.len() < DEPTH_LEVEL {
            let Some(Level(price, size)) = seq.next_element()? else {
                return Ok(Side(levels));
            };
            levels.push(BookLevel { price, size });
        }
        while seq.next_element::<IgnoredAny>()?.is_some() {}
        Ok(Side(levels))
    }
}

#[derive(Deserialize)]
struct Level(#[serde(deserialize_with = "wire::num")] f64, #[serde(deserialize_with = "wire::num")] f64);
