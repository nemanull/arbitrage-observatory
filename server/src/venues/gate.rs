mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::clock::now_ms;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "gate";

const REST: &str = "https://api.gateio.ws";

// One socket carries one settlement family, and a contract of another family is acknowledged and then never delivers.
const USDT_URL: &str = "wss://fx-ws.gateio.ws/v4/ws/usdt";

// Fifty levels at a 20 ms push, snapshot then deltas chained by update id.
const CHANNEL: &str = "futures.obu";
const DEPTH: u32 = 50;

// 150 streams ran on one socket with no gap at 443 frames a second on 2026-09-15, and no cap is published.
const MARKETS_PER_CONNECTION: usize = 150;

pub struct Gate {
    rest: String,
}

impl Gate {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self { rest: rest.to_string() }
    }
}

impl BookVenue for Gate {
    type State = HashMap<usize, i64>; // `u` of the last frame applied, by position

    // The server sends no ping and closes a socket silent for 30 s, and a quiet contract went 36 s without a book frame.
    // So the pong is the traffic the silence check relies on, and three missed pongs is a dead socket.
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
                id: format!("{ID}#usdt#{i}"),
                url: USDT_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // A multi stream payload is acknowledged as one, so a whole slice goes in one frame.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut payload = Vec::with_capacity(markets.len());
        for market in markets {
            payload.push(format!("ob.{}.{DEPTH}", market.raw_market_id));
        }
        let frame = serde_json::json!({ "time": now_seconds(), "channel": CHANNEL, "event": "subscribe", "payload": payload });
        vec![Message::text(frame.to_string())]
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text(serde_json::json!({ "time": now_seconds(), "channel": "futures.ping" }).to_string())
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(frame)?;

        if frame.channel == Some(CHANNEL)
            && frame.event.as_deref() == Some("update")
            && let Some(result) = &frame.result
            && let Some(stream) = &result.s
        {
            apply_book(contract_of(stream), result, conn);
            return Ok(());
        }

        if let Some(error) = &frame.error {
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                channel = frame.channel.unwrap_or("request"),
                request = frame.event.as_deref().unwrap_or(""),
                code = error.code,
                message = error.message.as_deref().unwrap_or(""),
            );
        } else if frame.channel == Some("futures.system") {
            // An upgrade notice comes before a shutdown, and the close path still does the reconnect.
            let kind = frame.result.as_ref().and_then(|result| result.kind.as_deref()).unwrap_or("");
            tracing::warn!(event = "venue_notice", connection = conn.id(), kind);
        }

        Ok(())
    }
}

fn apply_book(contract: &str, result: &BookResult, conn: &mut Connection<HashMap<usize, i64>>) {
    let Some(position) = conn.position(contract) else {
        return;
    };

    // A full push replaces the book whenever it comes, not only after the subscribe.
    if result.full == Some(true) {
        conn.state.insert(position, result.u.unwrap_or(0));
        conn.reset_book(position, &result.b, &result.a);
        return;
    }

    let Some(&last) = conn.state.get(&position) else {
        conn.resync(contract, "delta_before_snapshot");
        return;
    };
    if conn.book(position).is_none() {
        conn.resync(contract, "delta_before_snapshot");
        return;
    }

    if result.first_update_id != Some(last + 1) {
        conn.resync(contract, "sequence_gap");
        return;
    }
    conn.state.insert(position, result.u.unwrap_or(0));

    // A delta with no levels changed a level outside the fifty, so it only moves the id.
    if result.b.is_empty() && result.a.is_empty() {
        return;
    }

    let Some(book) = conn.book(position) else {
        return;
    };
    for level in &result.b {
        book.set_bid(level.price, level.size);
    }
    for level in &result.a {
        book.set_ask(level.price, level.size);
    }
    conn.publish(position);
}

// "ob.BTC_USDT.50" names the contract "BTC_USDT", and a contract id can be spelled outside ASCII.
fn contract_of(stream: &str) -> &str {
    let name = stream.strip_prefix("ob.").unwrap_or(stream);
    name.rsplit_once('.').map_or(name, |(contract, _)| contract)
}

fn now_seconds() -> i64 {
    now_ms() / 1000
}

// Books, acknowledgements, pongs and errors share the envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    channel: Option<&'a str>, // "futures.obu", "futures.pong" or "futures.system"
    event: Option<String>, // "update" on a book, "subscribe" on an acknowledgement, "" on a pong
    #[serde(borrow)]
    result: Option<BookResult<'a>>, // a book on update, { status } on an acknowledgement, null on a pong
    error: Option<GateError>,
}

#[derive(Deserialize)]
struct BookResult<'a> {
    #[serde(borrow)]
    s: Option<Cow<'a, str>>, // "ob.BTC_USDT.50"
    full: Option<bool>,      // true on a snapshot, absent on a delta
    #[serde(rename = "U")]
    first_update_id: Option<i64>,
    u: Option<i64>,
    #[serde(default, deserialize_with = "wire::levels")]
    b: Vec<BookLevel>, // sizes in contracts, best first on a snapshot, absent on an id only delta
    #[serde(default, deserialize_with = "wire::levels")]
    a: Vec<BookLevel>,
    #[serde(rename = "type")]
    kind: Option<String>, // on futures.system
}

#[derive(Deserialize)]
struct GateError {
    #[serde(default)]
    code: i64,
    message: Option<String>,
}
