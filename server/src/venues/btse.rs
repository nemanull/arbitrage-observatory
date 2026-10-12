mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use anchor::Funding;
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "btse";

// The markets API and the legacy futures API share the host.
const REST: &str = "https://api.btse.com";

// Book topics exist only on the OSS URL, and the main URL acknowledges them and then sends nothing.
const URL: &str = "wss://ws.btse.com/ws/oss/futures";

// A snapshot of up to 50 levels on subscribe, then deltas chained by seqNum, at grouping 0, the unrounded book.
const TOPIC: &str = "update";
const GROUPING: &str = "0";

// The documented cap is 100 topics a socket, and 111 were served on 2026-09-23, so the cap is kept.
const MARKETS_PER_CONNECTION: usize = 100;

pub struct Btse {
    rest: String,
    funding: Mutex<Funding>, // the ticker's funding fields, reread every 30 s
}

impl Btse {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self {
            rest: rest.to_string(),
            funding: Mutex::new(Funding::default()),
        }
    }
}

impl BookVenue for Btse {
    type State = HashMap<usize, i64>; // seqNum of the last frame applied, by position

    // A socket that sends no ping closes at 60 s, and the plain text ping is documented every 15 s.
    // A quiet book went 11.6 s without a frame, so the pong is the traffic the silence check relies on, and three missed pongs is a dead socket.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(15)),
            ..FeedSettings::new(Duration::from_secs(45))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#futures#{i}"),
                url: URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // One frame of 111 topics was acknowledged as one, so a whole slice goes in one frame.
    // The raw id is the socket's own spelling, BTC-PERP, because the BTC-PERP-USDT spelling shares its subscription and delivers under the other topic.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut args = Vec::with_capacity(markets.len());
        for market in markets {
            args.push(format!("{TOPIC}:{}_{GROUPING}", market.raw_market_id));
        }
        let frame = serde_json::json!({ "op": "subscribe", "args": args });
        vec![Message::text(frame.to_string())]
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text("ping")
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        // The answer to the ping is plain text, which only counts as traffic.
        if frame == b"pong" {
            return Ok(());
        }

        let frame: Frame = serde_json::from_slice(frame)?;

        // Every frame carries data, and an acknowledgement or an error carries it with null levels and no symbol.
        if let Some(book) = &frame.data
            && let Some(symbol) = book.symbol.as_deref()
        {
            apply_book(symbol, book, conn);
            return Ok(());
        }

        if !frame.errors.is_empty() {
            for entry in &frame.errors {
                tracing::error!(
                    event = "venue_error",
                    connection = conn.id(),
                    severity = frame.severity.as_deref().unwrap_or(""),
                    arg = entry.arg.as_deref().unwrap_or(""),
                    code = entry.error.code,
                    message = entry.error.message.as_deref().unwrap_or(""),
                );
            }
            return Ok(());
        }

        match frame.event.as_deref() {
            Some("subscribe" | "unsubscribe") => {}
            other => tracing::warn!(event = "venue_notice", connection = conn.id(), venue_event = other.unwrap_or("")),
        }

        Ok(())
    }
}

// A delta's topic can be the other spelling of the one subscribed, so a frame is routed by its symbol.
fn apply_book(symbol: &str, book: &Book, conn: &mut Connection<HashMap<usize, i64>>) {
    let Some(position) = conn.position(symbol) else {
        return;
    };

    // A snapshot replaces the book, and a second subscribe to a held topic sends one with the chain carried on.
    // reset_book publishes at once, so a crossed snapshot is caught before it lands.
    if book.kind.as_deref() == Some("snapshot") {
        let Some(seq_num) = book.seq_num else {
            conn.resync(symbol, "snapshot_without_seq_num");
            return;
        };
        if crossed(best(&book.bids, f64::max), best(&book.asks, f64::min)) {
            conn.resync(symbol, "crossed_book");
            return;
        }
        conn.state.insert(position, seq_num);
        conn.reset_book(position, &book.bids, &book.asks);
        return;
    }

    let Some(&last) = conn.state.get(&position) else {
        conn.resync(symbol, "delta_before_snapshot");
        return;
    };
    let Some(seq_num) = book.seq_num.filter(|_| book.prev_seq_num == Some(last)) else {
        conn.resync(symbol, "sequence_gap");
        return;
    };
    conn.state.insert(position, seq_num);

    let Some(levels) = conn.book(position) else {
        return;
    };
    // Levels come unordered in a delta, so each lands by its price, and a size of "0" removes it.
    for level in &book.bids {
        levels.set_bid(level.price, level.size);
    }
    for level in &book.asks {
        levels.set_ask(level.price, level.size);
    }

    // The documentation asks for a fresh book when a delta leaves the top crossed.
    if crossed(levels.bids().first().map(|bid| bid.price), levels.asks().first().map(|ask| ask.price)) {
        conn.resync(symbol, "crossed_book");
        return;
    }
    conn.publish(position);
}

fn crossed(best_bid: Option<f64>, best_ask: Option<f64>) -> bool {
    matches!((best_bid, best_ask), (Some(bid), Some(ask)) if bid >= ask)
}

// The best price of a snapshot side, whose asks come worst first, over the levels the book would keep.
fn best(levels: &[BookLevel], better: fn(f64, f64) -> f64) -> Option<f64> {
    let mut prices = levels.iter().filter(|level| level.price > 0.0 && level.size > 0.0).map(|level| level.price);
    let first = prices.next()?;
    Some(prices.fold(first, better))
}

// Books, acknowledgements and errors share the envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    data: Option<Book<'a>>,
    #[serde(borrow)]
    event: Option<Cow<'a, str>>, // "subscribe" or "unsubscribe" on an acknowledgement
    severity: Option<String>, // "ERROR" on an error frame
    #[serde(default)]
    errors: Vec<ErrorEntry>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Book<'a> {
    #[serde(borrow)]
    symbol: Option<Cow<'a, str>>, // "BTC-PERP" whichever spelling was subscribed
    #[serde(rename = "type", borrow)]
    kind: Option<Cow<'a, str>>, // "snapshot" or "delta"
    seq_num: Option<i64>,
    prev_seq_num: Option<i64>,
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // [price, contracts] strings, best first on a snapshot and unordered on a delta
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>, // worst first on a snapshot and unordered on a delta
}

#[derive(Deserialize)]
struct ErrorEntry {
    arg: Option<String>, // "update:NOPE-PERP_0", absent on an unknown operation
    error: ErrorBody,
}

#[derive(Deserialize)]
struct ErrorBody {
    #[serde(default)]
    code: i64, // 1000 for an unknown market, 1005 for an unknown topic
    message: Option<String>,
}
