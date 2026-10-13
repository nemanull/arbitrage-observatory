// Pacifica matches off chain and settles on Solana, and its engine stamps every book and price itself, so no chain is read.

mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::{Deserialize, Deserializer};
use std::borrow::Cow;
use std::collections::HashMap;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "pacifica";

// CloudFront refuses a GET that carries a body with a 403 page, so every call is a plain GET.
const REST: &str = "https://api.pacifica.fi";

const URL: &str = "wss://ws.pacifica.fi/ws";

// The whole book of 10 levels a side, the deepest Pacifica offers, every 250 ms whether it changed or not.
// agg_level is required, and 1 is the unaggregated tick.
const BOOK_CHANNEL: &str = "book";
const AGG_LEVEL: u32 = 1;

// The published cap is 20 subscriptions per channel per connection, and 100 connections per IP.
const MARKETS_PER_CONNECTION: usize = 20;

// A frame the feed does not know is logged with this much of its text.
const NOTICE_BYTES: usize = 300;

pub struct Pacifica {
    rest: String,
}

impl Pacifica {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self { rest: rest.to_string() }
    }
}

impl BookVenue for Pacifica {
    type State = HashMap<usize, i64>; // `li` of the last book applied, by position

    // Every market pushes its book every 250 ms, so 5 s of silence is a dead socket.
    // The server closes a socket 60 s after the client's last message, however much it is sending, so the ping is the client's message.
    // It also closes every socket at 24 h.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(30)),
            retire_after: Some(Duration::from_secs(23 * 60 * 60)),
            retire_jitter: Duration::from_secs(30 * 60),
            ..FeedSettings::new(Duration::from_secs(5))
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

    // One stream per frame, which is the only documented form.
    // Symbols are case sensitive, and a refused one is answered by an error that names no symbol, so only names from the live catalog reach here.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for market in markets {
            let params = serde_json::json!({ "source": BOOK_CHANNEL, "symbol": market.raw_market_id, "agg_level": AGG_LEVEL });
            frames.push(Message::text(serde_json::json!({ "method": "subscribe", "params": params }).to_string()));
        }
        frames
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text(r#"{"method":"ping"}"#)
    }

    // The channel is read first, because an acknowledgement's data is the subscription and an error frame has no channel.
    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let envelope: Envelope = serde_json::from_slice(frame)?;

        match envelope.channel.as_deref() {
            Some(BOOK_CHANNEL) => {
                let book: Frame<BookData> = match serde_json::from_slice(frame) {
                    Ok(book) => book,
                    Err(error) => {
                        // The next push would replace the book, but a shape the feed cannot read would leave it frozen and live.
                        conn.resync("connection", "book_frame_unreadable");
                        return Err(error.into());
                    }
                };
                apply_book(&book.data, conn);
            }
            Some("subscribe" | "unsubscribe" | "pong") => {}
            Some(channel) => {
                tracing::warn!(event = "venue_notice", connection = conn.id(), channel, frame = %notice_text(frame));
            }
            // An unknown or lowercase symbol answers {"error":"Symbol not found"}, and a malformed request {"code":400,"err":...}.
            // Neither names the stream, and the socket keeps the others.
            None => match envelope.error.or(envelope.err) {
                Some(message) => {
                    tracing::error!(event = "venue_error", connection = conn.id(), code = envelope.code.unwrap_or(0), message = %message);
                }
                None => tracing::warn!(event = "venue_notice", connection = conn.id(), frame = %notice_text(frame)),
            },
        }

        Ok(())
    }
}

// Every book frame is the whole book with no delta and no checksum, so it replaces the book, and an unchanged repeat is published as a sign of life.
// `li` is the exchange-wide id of the book's last event, which never went back on a socket.
// A lower one means the venue restarted its stream, and dropping every frame after it would freeze the book, so the connection starts again.
fn apply_book(data: &BookData, conn: &mut Connection<HashMap<usize, i64>>) {
    let Some(position) = conn.position(&data.symbol) else {
        return;
    };

    if let Some(last_id) = data.last_id {
        if let Some(&last) = conn.state.get(&position)
            && last_id < last
        {
            tracing::warn!(event = "book_frame_older", connection = conn.id(), market = %data.symbol, li = last_id, last);
            conn.resync(&data.symbol, "sequence_went_back");
            return;
        }
        conn.state.insert(position, last_id);
    }

    // The book would skip such a level and publish the rest as the whole book.
    let (bids, asks) = (&data.levels.0.0, &data.levels.1.0);
    if !readable(bids) || !readable(asks) {
        conn.resync(&data.symbol, "level_unreadable");
        return;
    }

    conn.reset_book(position, bids, asks);
}

// The rule OrderBook applies to each level, where a size of 0 deletes.
fn readable(levels: &[BookLevel]) -> bool {
    levels.iter().all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

fn notice_text(frame: &[u8]) -> Cow<'_, str> {
    String::from_utf8_lossy(&frame[..frame.len().min(NOTICE_BYTES)])
}

// Books, acknowledgements, pongs and errors share this shape, and only an error has no channel.
#[derive(Deserialize)]
struct Envelope<'a> {
    #[serde(borrow)]
    channel: Option<Cow<'a, str>>, // "book", "subscribe", "unsubscribe" or "pong"
    #[serde(borrow)]
    error: Option<Cow<'a, str>>, // "Symbol not found" or "Invalid aggregation level"
    #[serde(borrow)]
    err: Option<Cow<'a, str>>, // "Invalid subscription parameters.", beside code 400
    code: Option<i64>,
}

#[derive(Deserialize)]
struct Frame<T> {
    data: T,
}

#[derive(Deserialize)]
struct BookData<'a> {
    #[serde(rename = "s", borrow)]
    symbol: Cow<'a, str>, // "BTC" or "kPEPE", spelled as subscribed
    #[serde(rename = "l")]
    levels: (Side, Side), // bids best first, then asks best first
    #[serde(rename = "li")]
    last_id: Option<i64>, // t beside it is the time of the book's last change, not of the push, so it is not read
}

#[derive(Deserialize)]
struct Side(#[serde(deserialize_with = "levels")] Vec<BookLevel>);

// {"p":"82669","a":"0.0012","n":1}, where n is the order count.
#[derive(Deserialize)]
struct Level {
    #[serde(deserialize_with = "wire::num")]
    p: f64,
    #[serde(deserialize_with = "wire::num")]
    a: f64, // tokens of the named asset, so thousands of tokens on a k market
}

fn levels<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<BookLevel>, D::Error> {
    let levels = Vec::<Level>::deserialize(deserializer)?;
    Ok(levels.iter().map(|level| BookLevel { price: level.p, size: level.a }).collect())
}
