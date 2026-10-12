mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "kucoinfutures";

const REST: &str = "https://api-futures.kucoin.com";

// The tokenless UTA socket carries every futures family, and sends every frame as a binary frame of plain JSON.
const URL: &str = "wss://x-push-futures.kucoin.com";

// A snapshot of up to 500 levels on subscribe, then deltas aggregated per 10 ms and chained by sequence.
const TOPIC: &str = "obu.FUTURES";
const CHANNEL: &str = "obu";
const DEPTH: &str = "increment@10ms";

// 100 streams ran on one socket with no gap on 2026-09-22, and the documented cap is 600 topics.
const MARKETS_PER_CONNECTION: usize = 100;

pub struct KucoinFutures {
    rest: String,
}

impl KucoinFutures {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self { rest: rest.to_string() }
    }
}

#[derive(Default)]
pub struct Streams {
    last: HashMap<usize, i64>, // `C` of the last frame applied, by position
    request_id: u64,           // the last id sent on a subscribe or a ping
}

impl Streams {
    fn next_id(&mut self) -> String {
        self.request_id += 1;
        self.request_id.to_string()
    }
}

impl BookVenue for KucoinFutures {
    type State = Streams;

    // The server sends no ping, and a quiet contract went 10 s with no book frame, so the pong is the traffic the silence check relies on.
    // The topic takes one symbol per frame, a connection may send 300 frames per 10 s, and an IP may open 250 connections per 5 minutes.
    // An unknown symbol is acknowledged and then stays silent.
    // A snapshot comes with the first change after the subscribe, so a quiet contract can still be logged as unserved after 15 s.
    // ESIMUSDTM sent nothing for 60 s on 2026-10-08, while BANANAUSDTM and CLANKERUSDTM took 5.8 s and 8.3 s.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(15)),
            connect_stagger: Duration::from_secs(1),
            subscribe_gap: Duration::from_millis(50),
            first_book_wait: Duration::from_secs(15),
            ..FeedSettings::new(Duration::from_secs(45))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#{i}"),
                url: URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // A `symbols` array is refused on this topic, so each market takes its own frame.
    fn subscribe_frames(&self, markets: &[Market], state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for market in markets {
            let frame = serde_json::json!({
                "id": state.next_id(),
                "action": "SUBSCRIBE",
                "channel": CHANNEL,
                "tradeType": "FUTURES",
                "symbol": market.raw_market_id,
                "depth": DEPTH,
            });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn ping(&self, state: &mut Self::State) -> Message {
        Message::text(serde_json::json!({ "id": state.next_id(), "type": "ping" }).to_string())
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(frame)?;

        if frame.topic == Some(TOPIC)
            && let Some(book) = &frame.d
        {
            match frame.kind {
                Some("snapshot") => apply_snapshot(book, conn),
                Some("delta") => apply_delta(book, conn),
                kind => tracing::warn!(event = "venue_notice", connection = conn.id(), topic = TOPIC, kind = kind.unwrap_or("")),
            }
            return Ok(());
        }

        // A refusal answers `result: false` with a `message` or a `reason`, and the welcome, the acks and the pongs need nothing.
        if frame.result.as_ref().is_some_and(is_false) {
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                request = frame.id.as_deref().unwrap_or(""),
                message = frame.message.as_deref().or(frame.reason.as_deref()).unwrap_or(""),
            );
        }

        Ok(())
    }
}

fn apply_snapshot(book: &Book, conn: &mut Connection<Streams>) {
    let Some(position) = conn.position(&book.s) else {
        return;
    };

    conn.state.last.insert(position, book.last);
    conn.reset_book(position, &book.b, &book.a);
}

// The documented rule applies a delta when `O <= last + 1` and `C > last`, and every delta seen had `O == last + 1`.
fn apply_delta(book: &Book, conn: &mut Connection<Streams>) {
    let Some(position) = conn.position(&book.s) else {
        return;
    };

    let Some(&last) = conn.state.last.get(&position) else {
        conn.resync(&book.s, "delta_before_snapshot");
        return;
    };
    if conn.book(position).is_none() {
        conn.resync(&book.s, "delta_before_snapshot");
        return;
    }

    // Everything it carries is already applied.
    if book.last <= last {
        return;
    }
    if book.first > last + 1 {
        conn.resync(&book.s, "sequence_gap");
        return;
    }
    conn.state.last.insert(position, book.last);

    if book.b.is_empty() && book.a.is_empty() {
        return;
    }

    let Some(order_book) = conn.book(position) else {
        return;
    };
    for level in &book.b {
        order_book.set_bid(level.price, level.size);
    }
    for level in &book.a {
        order_book.set_ask(level.price, level.size);
    }
    conn.publish(position);
}

// The ack carries a boolean, while the documentation shows the string "true".
fn is_false(result: &serde_json::Value) -> bool {
    result == &serde_json::Value::Bool(false) || result.as_str() == Some("false")
}

// Books, the welcome, acks and pongs share no envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(rename = "T", borrow)]
    topic: Option<&'a str>, // "obu.FUTURES" on a book
    #[serde(rename = "t", borrow)]
    kind: Option<&'a str>, // "snapshot" or "delta"
    #[serde(borrow)]
    d: Option<Book<'a>>,
    #[serde(borrow)]
    id: Option<Cow<'a, str>>, // the request id on an ack or a pong
    result: Option<serde_json::Value>, // true on an ack, false on a refusal
    message: Option<String>, // "welcome", or why a request was refused
    reason: Option<String>,  // why a request was refused, on some refusals
}

#[derive(Deserialize)]
struct Book<'a> {
    #[serde(borrow)]
    s: Cow<'a, str>, // "XBTUSDTM", the REST symbol
    #[serde(rename = "O")]
    first: i64, // the first sequence the frame covers, equal to C on a snapshot
    #[serde(rename = "C")]
    last: i64,
    #[serde(default, deserialize_with = "wire::levels")]
    b: Vec<BookLevel>, // string pairs in lots, a size of "0" deletes the level
    #[serde(default, deserialize_with = "wire::levels")]
    a: Vec<BookLevel>,
}
