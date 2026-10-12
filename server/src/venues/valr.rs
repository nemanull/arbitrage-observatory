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

pub const ID: &str = "valr";

const REST: &str = "https://api.valr.com";

// One socket carries every pair of the exchange, and public events need no key.
const TRADE_URL: &str = "wss://api.valr.com/ws/trade";

// The whole aggregated book, a snapshot on subscribe and then deltas chained by a per pair sq.
// OB_L1_D20_SNAPSHOT is the 20 level view of decision 22, but it carries no sq and VALR names this channel its fastest book.
// The whole book held at most 52 levels a side on 2026-09-23, so it costs little more than 20.
const EVENT: &str = "OB_L1_DIFF";

// The start of the type of a book frame, "OB_L1_SNAPSHOT" or "OB_L1_DIFF".
const BOOK_KIND: &[u8] = b"\"OB_L1_";

// A second subscribe of one event replaces its pair list, so a socket sends all its pairs in one frame.
// No cap is published, and 14 event and pair combinations in one frame were all acknowledged on 2026-09-23.
const MARKETS_PER_CONNECTION: usize = 50;

pub struct Valr;

impl Valr {
    pub fn new() -> Self {
        Self
    }
}

impl BookVenue for Valr {
    type State = HashMap<usize, i64>; // sq of the last frame applied, by position

    // A silent socket closed at 60 s and a quiet book went 20.5 s with no frame, so the pong is the traffic the silence check relies on.
    // An unauthenticated socket is documented to close after 15 minutes, so it is reopened before that.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(20)),
            // 60 new clients a minute per IP.
            connect_stagger: Duration::from_secs(1),
            retire_after: Some(Duration::from_secs(14 * 60)),
            retire_jitter: Duration::from_secs(20),
            ..FeedSettings::new(Duration::from_secs(45))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#trade#{i}"),
                url: TRADE_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut pairs = Vec::with_capacity(markets.len());
        for market in markets {
            pairs.push(market.raw_market_id.as_str());
        }
        let frame = serde_json::json!({ "type": "SUBSCRIBE", "subscriptions": [{ "event": EVENT, "pairs": pairs }] });
        vec![Message::text(frame.to_string())]
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text(r#"{"type":"PING"}"#)
    }

    fn handle(&self, bytes: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = match serde_json::from_slice(bytes) {
            Ok(frame) => frame,
            Err(error) => {
                // The next delta's sq would show the loss, but a quiet book can go 20 s without one.
                if bytes.windows(BOOK_KIND.len()).any(|window| window == BOOK_KIND) {
                    resync_connection(conn, "book_frame_unreadable");
                }
                return Err(error.into());
            }
        };

        match frame.kind.as_ref() {
            "OB_L1_SNAPSHOT" | "OB_L1_DIFF" => {
                let (Some(pair), Some(book)) = (frame.ps.as_deref(), frame.d.as_ref()) else {
                    resync_connection(conn, "book_frame_without_ps_or_d");
                    anyhow::bail!("{} frame without ps or d", frame.kind);
                };
                apply_book(pair, frame.kind == "OB_L1_SNAPSHOT", book, conn);
            }
            "PONG" | "SUBSCRIBED" => {}
            "UNSUBSCRIBED" => unsubscribed(frame.message.as_deref().unwrap_or(""), conn),
            // An error names the refused pair, and the other pairs of the frame still subscribe.
            "ERROR" | "RATE_LIMIT_EXCEEDED" => tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                kind = frame.kind.as_ref(),
                message = frame.message.as_deref().unwrap_or(""),
            ),
            other => tracing::warn!(
                event = "venue_notice",
                connection = conn.id(),
                kind = other,
                message = frame.message.as_deref().unwrap_or(""),
            ),
        }

        Ok(())
    }
}

// The sq counts per pair and must be exactly one above the last, and a snapshot only comes on subscribe.
fn apply_book(pair: &str, snapshot: bool, book: &BookData, conn: &mut Connection<HashMap<usize, i64>>) {
    let Some(position) = conn.position(pair) else {
        return;
    };

    // OrderBook skips a level it cannot read, which would leave a stale level in the published book.
    if !readable(&book.b) || !readable(&book.a) {
        conn.resync(pair, "level_unreadable");
        return;
    }

    if snapshot {
        conn.state.insert(position, book.sq);
        conn.reset_book(position, &book.b, &book.a);
        return;
    }

    let Some(&last) = conn.state.get(&position) else {
        conn.resync(pair, "delta_before_snapshot");
        return;
    };
    if book.sq != last + 1 {
        conn.resync(pair, "sequence_gap");
        return;
    }
    conn.state.insert(position, book.sq);

    if book.b.is_empty() && book.a.is_empty() {
        return;
    }

    let Some(levels) = conn.book(position) else {
        conn.resync(pair, "delta_before_snapshot");
        return;
    };
    // A quantity is the new total at its price, and "0" removes the level.
    for level in &book.b {
        levels.set_bid(level.price, level.size);
    }
    for level in &book.a {
        levels.set_ask(level.price, level.size);
    }
    conn.publish(position);
}

fn readable(levels: &[BookLevel]) -> bool {
    levels
        .iter()
        .all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

// Every market shares the one socket, so an unreadable book frame reseeds them all.
fn resync_connection(conn: &mut Connection<HashMap<usize, i64>>, reason: &str) {
    let market = conn.markets()[0].raw_market_id.clone();
    conn.resync(&market, reason);
}

// The feed never replaces a pair list, so an UNSUBSCRIBED of its own pair comes from the venue and its deltas stop.
// The book is emptied rather than resubscribed, since an empty book is never a live leg and a resubscribe the venue refuses again would loop.
// The socket's next retirement subscribes the pair again.
fn unsubscribed(message: &str, conn: &mut Connection<HashMap<usize, i64>>) {
    tracing::warn!(event = "venue_notice", connection = conn.id(), kind = "UNSUBSCRIBED", message);

    let Some((EVENT, pair)) = message.split_once(':') else {
        return;
    };
    let Some(position) = conn.markets().iter().position(|market| market.raw_market_id == pair) else {
        return;
    };
    conn.state.remove(&position);
    if conn.book(position).is_some() {
        conn.reset_book(position, &[], &[]);
    }
}

// Books, acknowledgements, pongs and errors share the type field, and the rest depends on it.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(rename = "type", borrow)]
    kind: Cow<'a, str>, // "OB_L1_SNAPSHOT", "OB_L1_DIFF", "SUBSCRIBED", "UNSUBSCRIBED", "PONG" or "ERROR"
    #[serde(borrow)]
    ps: Option<Cow<'a, str>>, // "BTCUSDTPERP" on a book frame
    d: Option<BookData>,
    message: Option<String>, // "OB_L1_DIFF:BTCUSDTPERP" on an acknowledgement, the reason on an error
}

#[derive(Deserialize)]
struct BookData {
    sq: i64,
    #[serde(default, deserialize_with = "wire::levels")]
    b: Vec<BookLevel>, // [price, quantity] strings in base coins, best first
    #[serde(default, deserialize_with = "wire::levels")]
    a: Vec<BookLevel>,
}
