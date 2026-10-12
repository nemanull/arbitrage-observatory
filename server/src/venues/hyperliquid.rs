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
use std::collections::HashMap;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "hyperliquid";

// Every info call is a POST of a JSON body naming a type, and a GET answers 405.
const REST: &str = "https://api.hyperliquid.xyz";
const INFO_PATH: &str = "/info";

const URL: &str = "wss://api.hyperliquid.xyz/ws";

// The default l2Book is 20 levels about every 5.4 s, so its touch is up to 6.5 s old.
// The fast book is 5 levels about every 0.54 s, and bbo moves the touch on every block that changes it.
// So the feed holds 5 fresh levels rather than 20 stale ones.
const BOOK_CHANNEL: &str = "l2Book";
const BBO_CHANNEL: &str = "bbo";

pub struct Hyperliquid {
    rest: String,
}

impl Hyperliquid {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self { rest: rest.to_string() }
    }
}

// What one market's book was built from, so a snapshot older than the newest touch does not move the touch back.
#[derive(Default)]
pub struct Track {
    snapshot_time: i64, // `time` of the last l2Book applied, 0 before the first
    bbo: Option<Bbo>,   // the newest touch received
}

#[derive(Clone, Copy)]
struct Bbo {
    time: i64,
    bid: Option<BookLevel>, // None is an empty side
    ask: Option<BookLevel>,
}

impl BookVenue for Hyperliquid {
    type State = HashMap<usize, Track>; // by position

    // A fast book arrives for every coin about every 0.54 s, unchanged or not, so 10 s of silence is a dead socket.
    // The server closes a socket it has sent nothing to for 60 s, and the ping keeps an idle socket open.
    // 20 subscribe frames per 100 ms were all acknowledged, and an IP may send 2,000 frames a minute.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(30)),
            subscribe_gap: Duration::from_millis(5),
            ..FeedSettings::new(Duration::from_secs(10))
        }
    }

    // One socket carries every coin, and the caps are per IP: 1,000 subscriptions and 10 sockets.
    // Two streams per market put the 178 main dex perpetuals at 356 subscriptions.
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

    // One subscription per frame, since a coin array is refused.
    // An unknown coin closes the socket with every stream on it, so only names from the live meta reach here.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len() * 2);
        for market in markets {
            let coin = market.raw_market_id.as_str();
            let book = serde_json::json!({ "type": BOOK_CHANNEL, "coin": coin, "fast": true });
            let bbo = serde_json::json!({ "type": BBO_CHANNEL, "coin": coin });
            frames.push(Message::text(serde_json::json!({ "method": "subscribe", "subscription": book }).to_string()));
            frames.push(Message::text(serde_json::json!({ "method": "subscribe", "subscription": bbo }).to_string()));
        }
        frames
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text(r#"{"method":"ping"}"#)
    }

    // The channel is read first, because an error frame's data is a string and a book's is an object.
    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let envelope: Envelope = serde_json::from_slice(frame)?;

        match envelope.channel.as_ref() {
            BOOK_CHANNEL => {
                let frame: Frame<BookData> = serde_json::from_slice(frame)?;
                apply_book(&frame.data, conn);
            }
            BBO_CHANNEL => {
                let frame: Frame<BboData> = serde_json::from_slice(frame)?;
                apply_bbo(&frame.data, conn);
            }
            "error" => {
                let frame: Frame<Cow<str>> = serde_json::from_slice(frame)?;
                tracing::error!(event = "venue_error", connection = conn.id(), message = %frame.data);
            }
            _ => {} // subscriptionResponse and pong
        }

        Ok(())
    }
}

// Every l2Book frame is the whole book, with no sequence and no checksum, so it replaces the book.
// A book older than the one applied would move the book back, so it is dropped, while an equal time is a repeat.
fn apply_book(data: &BookData, conn: &mut Connection<HashMap<usize, Track>>) {
    let Some(position) = conn.position(&data.coin) else {
        return;
    };

    let track = conn.state.entry(position).or_default();
    if data.time < track.snapshot_time {
        return;
    }
    track.snapshot_time = data.time;
    let newer_touch = track.bbo.filter(|bbo| bbo.time > data.time);

    conn.reset_book(position, &data.levels.0.0, &data.levels.1.0);
    if let Some(bbo) = newer_touch
        && let Some(book) = conn.book(position)
    {
        merge_touch(book, &bbo);
    }
}

// A touch newer than the snapshot replaces the levels better than it, and the deeper levels stay at most one fast push old.
// A touch that arrives before the first snapshot waits for it.
fn apply_bbo(data: &BboData, conn: &mut Connection<HashMap<usize, Track>>) {
    let Some(position) = conn.position(&data.coin) else {
        return;
    };

    let bbo = Bbo {
        time: data.time,
        bid: data.bbo.0.as_ref().map(Level::book_level),
        ask: data.bbo.1.as_ref().map(Level::book_level),
    };

    let track = conn.state.entry(position).or_default();
    if track.bbo.is_some_and(|newest| newest.time >= bbo.time) {
        return;
    }
    track.bbo = Some(bbo);
    if bbo.time <= track.snapshot_time {
        return;
    }

    let Some(book) = conn.book(position) else {
        return;
    };
    merge_touch(book, &bbo);
    conn.publish(position);
}

// The touch is the best level, so every level better than it is gone, and the book cannot cross since bid < ask on the touch.
fn merge_touch(book: &mut OrderBook, bbo: &Bbo) {
    while let Some(best) = book.bids().first().copied()
        && bbo.bid.is_none_or(|bid| best.price > bid.price)
    {
        book.set_bid(best.price, 0.0);
    }
    while let Some(best) = book.asks().first().copied()
        && bbo.ask.is_none_or(|ask| best.price < ask.price)
    {
        book.set_ask(best.price, 0.0);
    }

    if let Some(bid) = bbo.bid {
        book.set_bid(bid.price, bid.size);
    }
    if let Some(ask) = bbo.ask {
        book.set_ask(ask.price, ask.size);
    }
}

// Books, touches, acknowledgements, pongs and errors share the envelope.
#[derive(Deserialize)]
struct Envelope<'a> {
    #[serde(borrow)]
    channel: Cow<'a, str>, // "l2Book", "bbo", "subscriptionResponse", "pong" or "error"
}

#[derive(Deserialize)]
struct Frame<T> {
    data: T,
}

#[derive(Deserialize)]
struct BookData<'a> {
    #[serde(borrow)]
    coin: Cow<'a, str>, // "BTC" or "kPEPE", spelled as subscribed
    time: i64, // Unix ms of the block the book was taken at
    levels: (Side, Side), // bids best first, then asks best first
}

#[derive(Deserialize)]
struct Side(#[serde(deserialize_with = "levels")] Vec<BookLevel>);

#[derive(Deserialize)]
struct BboData<'a> {
    #[serde(borrow)]
    coin: Cow<'a, str>,
    time: i64,
    bbo: (Option<Level>, Option<Level>), // best bid then best ask, null for an empty side
}

// {"px":"84143.0","sz":"10.25923","n":36}, where n is the order count.
#[derive(Deserialize)]
struct Level {
    #[serde(deserialize_with = "wire::num")]
    px: f64,
    #[serde(deserialize_with = "wire::num")]
    sz: f64, // coins of the named asset, so thousands of tokens on a k coin
}

impl Level {
    fn book_level(&self) -> BookLevel {
        BookLevel { price: self.px, size: self.sz }
    }
}

fn levels<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<BookLevel>, D::Error> {
    let levels = Vec::<Level>::deserialize(deserializer)?;
    Ok(levels.iter().map(Level::book_level).collect())
}
