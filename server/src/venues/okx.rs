mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use anchor::Instruments;
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "okx";

const REST: &str = "https://www.okx.com";

const PUBLIC_URL: &str = "wss://ws.okx.com:8443/ws/v5/public";

// 400 levels at a 100 ms push, snapshot then updates.
// The tick by tick book channels need a VIP login.
const CHANNEL: &str = "books";

const MARKETS_PER_CONNECTION: usize = 250; // two connections carried 473 instruments with full coverage on 2026-09-07
const ARGS_PER_FRAME: usize = 200; // about 10 KB against a 64 KB cap

pub struct Okx {
    rest: String,
    tracked: Vec<(String, String)>, // (raw id, quote) per tracked market, which picks the index quotes worth asking for
    instruments: Mutex<Instruments>,
}

impl Okx {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(markets, REST)
    }

    fn with_rest(markets: &[TrackedMarket], rest: &str) -> Self {
        let mut tracked = Vec::with_capacity(markets.len());
        for market in markets {
            tracked.push((market.market.raw_market_id.clone(), market.market.quote.clone()));
        }

        Self {
            rest: rest.to_string(),
            tracked,
            instruments: Mutex::new(Instruments::default()),
        }
    }
}

impl BookVenue for Okx {
    type State = HashMap<usize, i64>; // `seqId` of the last frame applied, by position

    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(20)),
            connect_stagger: Duration::from_millis(400), // okx allows three handshakes a second per IP
            ..FeedSettings::new(Duration::from_secs(60))
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

    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::new();
        for (i, slice) in markets.chunks(ARGS_PER_FRAME).enumerate() {
            let mut args = Vec::with_capacity(slice.len());
            for market in slice {
                args.push(serde_json::json!({ "channel": CHANNEL, "instId": market.raw_market_id }));
            }
            let frame = serde_json::json!({ "id": format!("sub{i}"), "op": "subscribe", "args": args });
            frames.push(Message::text(frame.to_string()));
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
            && arg.channel == Some(CHANNEL)
            && let Some(inst_id) = arg.inst_id
            && let Some(data) = &frame.data
        {
            apply_books(inst_id, frame.action, data, conn);
            return Ok(());
        }

        let code = frame.code.as_deref().unwrap_or("");
        let message = frame.msg.as_deref().unwrap_or("");
        match frame.event.as_deref() {
            Some("error") => tracing::error!(event = "venue_error", connection = conn.id(), code, message),
            // Code 64008 announces a service upgrade about 60 s ahead, and the ordinary close path still does the reconnect.
            Some("notice") => tracing::warn!(event = "venue_notice", connection = conn.id(), code, message),
            _ => {}
        }

        Ok(())
    }
}

fn apply_books(inst_id: &str, action: Option<&str>, data: &[BooksData], conn: &mut Connection<HashMap<usize, i64>>) {
    let Some(position) = conn.position(inst_id) else {
        return;
    };

    for entry in data {
        if action == Some("snapshot") {
            conn.state.insert(position, entry.seq_id.unwrap_or(0));
            conn.reset_book(position, &entry.bids, &entry.asks);
            continue;
        }

        let Some(&last) = conn.state.get(&position) else {
            conn.resync(inst_id, "update_before_snapshot");
            return;
        };
        if conn.book(position).is_none() {
            conn.resync(inst_id, "update_before_snapshot");
            return;
        }

        if entry.prev_seq_id != Some(last) {
            conn.resync(inst_id, "sequence_gap");
            return;
        }

        // An update whose seqId repeats prevSeqId carries no change and only proves the channel alive.
        let Some(seq_id) = entry.seq_id else {
            conn.resync(inst_id, "sequence_gap");
            return;
        };
        if seq_id == last {
            continue;
        }
        conn.state.insert(position, seq_id);

        let Some(book) = conn.book(position) else {
            return;
        };
        for level in &entry.bids {
            book.set_bid(level.price, level.size);
        }
        for level in &entry.asks {
            book.set_ask(level.price, level.size);
        }
        conn.publish(position);
    }
}

// Data, acknowledgements, errors and notices share the socket, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    arg: Option<Arg<'a>>,
    #[serde(borrow)]
    action: Option<&'a str>, // "snapshot" or "update" on a books frame
    data: Option<Vec<BooksData>>,
    event: Option<String>, // "subscribe", "error" or "notice"
    code: Option<String>,
    msg: Option<String>,
}

#[derive(Deserialize)]
struct Arg<'a> {
    #[serde(borrow)]
    channel: Option<&'a str>,
    #[serde(rename = "instId", borrow)]
    inst_id: Option<&'a str>,
}

// A level is [price, size, a deprecated field, order count], and wire::levels reads the first two.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct BooksData {
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>,
    prev_seq_id: Option<i64>, // -1 on a snapshot, otherwise the seqId this one follows
    seq_id: Option<i64>,
}
