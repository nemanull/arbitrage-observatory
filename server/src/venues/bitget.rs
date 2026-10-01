mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "bitget";

const REST: &str = "https://api.bitget.com";

// The unified account socket pushes books every 50 to 65 ms, where the classic v2 socket pushes every 100 ms.
const PUBLIC_URL: &str = "wss://ws.bitget.com/v3/ws/public";

// A snapshot of up to 1,000 levels a side, then updates chained by pseq.
const TOPIC: &str = "books";

// A real symbol under the wrong instType is acknowledged and then silent, so the family comes from the market's quote and is never guessed.
const INST_TYPES: &[(&str, &str)] = &[("USDT", "usdt-futures"), ("USDC", "usdc-futures")];

const MARKETS_PER_CONNECTION: usize = 50; // bitget recommends under 50 channels a connection and documents a cap of 1,000

// A v3 frame of 25 or more arguments closed the socket with no error on 2026-09-15, and frames of 10 a second apart carried 150 channels with no gap.
const ARGS_PER_FRAME: usize = 10;

pub struct Bitget {
    rest: String,
    has_usdt: bool, // the poller asks a product type only while one of its markets is tracked
    has_usdc: bool,
}

impl Bitget {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(markets, REST)
    }

    fn with_rest(markets: &[TrackedMarket], rest: &str) -> Self {
        Self {
            rest: rest.to_string(),
            has_usdt: markets.iter().any(|tracked| tracked.market.quote == "USDT"),
            has_usdc: markets.iter().any(|tracked| tracked.market.quote == "USDC"),
        }
    }
}

impl BookVenue for Bitget {
    type State = HashMap<usize, i64>; // `seq` of the last frame applied, by position

    // A quiet book can be silent for seconds, so the pong is what proves the socket alive.
    // The server closes a socket that sends no ping for 2 minutes, even while it streams data to it.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(25)),
            connect_stagger: Duration::from_secs(1), // 300 connection attempts per IP per 5 minutes
            subscribe_gap: Duration::from_secs(1),
            ..FeedSettings::new(Duration::from_secs(60))
        }
    }

    // A market whose quote names no instType sits in no plan, and spawn_feed logs it as unplanned.
    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for &(quote, inst_type) in INST_TYPES {
            let family: Vec<Market> = markets.iter().filter(|market| market.quote == quote).cloned().collect();
            for (i, slice) in family.chunks(MARKETS_PER_CONNECTION).enumerate() {
                plans.push(EndpointPlan {
                    id: format!("{ID}#{inst_type}#{i}"),
                    url: PUBLIC_URL.to_string(),
                    markets: slice.to_vec(),
                });
            }
        }
        plans
    }

    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::new();
        for slice in markets.chunks(ARGS_PER_FRAME) {
            let mut args = Vec::with_capacity(slice.len());
            for market in slice {
                let inst_type = inst_type_of(&market.quote).unwrap_or_default();
                args.push(serde_json::json!({ "instType": inst_type, "topic": TOPIC, "symbol": market.raw_market_id }));
            }
            frames.push(Message::text(serde_json::json!({ "op": "subscribe", "args": args }).to_string()));
        }
        frames
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text("ping")
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        if frame == b"pong" {
            return Ok(());
        }

        let frame: Frame = serde_json::from_slice(frame)?;

        if let Some(arg) = &frame.arg
            && arg.topic == Some(TOPIC)
            && let Some(symbol) = arg.symbol
            && let Some(data) = frame.data.first()
        {
            apply_book(symbol, frame.action, data, conn);
            return Ok(());
        }

        if frame.event.as_deref() == Some("error") {
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                code = frame.code.unwrap_or(0),
                message = frame.msg.as_deref().unwrap_or(""),
            );
        }

        Ok(())
    }
}

fn inst_type_of(quote: &str) -> Option<&'static str> {
    INST_TYPES.iter().find(|(q, _)| *q == quote).map(|&(_, inst_type)| inst_type)
}

fn apply_book(symbol: &str, action: Option<&str>, data: &BooksData, conn: &mut Connection<HashMap<usize, i64>>) {
    let Some(position) = conn.position(symbol) else {
        return;
    };

    if action == Some("snapshot") {
        conn.state.insert(position, data.seq.unwrap_or(0));
        conn.reset_book(position, &data.b, &data.a);
        return;
    }

    let Some(&last) = conn.state.get(&position) else {
        conn.resync(symbol, "update_before_snapshot");
        return;
    };
    if conn.book(position).is_none() {
        conn.resync(symbol, "update_before_snapshot");
        return;
    }

    // A restart on the venue side may begin a new chain at pseq 0, and only a fresh snapshot rebuilds the book.
    if data.pseq == Some(0) {
        conn.resync(symbol, "sequence_reset");
        return;
    }
    if data.pseq != Some(last) {
        conn.resync(symbol, "sequence_gap");
        return;
    }
    conn.state.insert(position, data.seq.unwrap_or(0));

    let Some(book) = conn.book(position) else {
        return;
    };
    for level in &data.b {
        book.set_bid(level.price, level.size);
    }
    for level in &data.a {
        book.set_ask(level.price, level.size);
    }
    conn.publish(position);
}

// Data, acknowledgements and errors share the socket, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    action: Option<&'a str>, // "snapshot" or "update" on a books frame
    #[serde(borrow)]
    arg: Option<Arg<'a>>, // absent on a v3 error
    #[serde(default)]
    data: Vec<BooksData>, // exactly one entry on a books frame
    event: Option<String>, // "subscribe" or "error"
    code: Option<i64>,     // 30001 for a symbol the instType does not list
    msg: Option<String>,   // names the refused argument on an error
}

#[derive(Deserialize)]
struct Arg<'a> {
    #[serde(borrow)]
    topic: Option<&'a str>,
    #[serde(borrow)]
    symbol: Option<&'a str>,
}

#[derive(Deserialize)]
struct BooksData {
    #[serde(default, deserialize_with = "wire::levels")]
    a: Vec<BookLevel>, // the whole side on a snapshot, changed levels on an update, size "0" removes
    #[serde(default, deserialize_with = "wire::levels")]
    b: Vec<BookLevel>,
    seq: Option<i64>,  // near 10^12 on USDT-M and USDC-M
    pseq: Option<i64>, // the previous frame's seq, 0 on a snapshot
}
