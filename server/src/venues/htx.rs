mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use anchor::AnchorState;
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "htx";

// The host the API reference recommends for servers in AWS, and the one CCXT uses, at the same address as api.hbdm.com.
const REST: &str = "https://api.hbdm.vn";

// USDT-M only, since a socket carries one family and a coin-M code is refused with "invalid topic".
const PUBLIC_URL: &str = "wss://api.hbdm.vn/linear-swap-ws";

// A snapshot on subscribe, then deltas checked every 30 ms and chained by a per stream version.
// 20 is the smallest size the server accepts at or above the engine's 20 levels, and 5 or 30 answer "invalid topic".
const CHANNEL_SUFFIX: &str = "depth.size_20.high_freq";

// 150 streams ran on one socket with no gap at up to 977 frames a second, and no cap is published.
const MARKETS_PER_CONNECTION: usize = 150;

const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];

pub struct Htx {
    rest: String,
    markets: Vec<String>, // tracked raw ids, whose marks the anchor reads a slice per round
    anchor: Mutex<AnchorState>,
}

impl Htx {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(markets, REST)
    }

    fn with_rest(markets: &[TrackedMarket], rest: &str) -> Self {
        Self {
            rest: rest.to_string(),
            markets: markets.iter().map(|tracked| tracked.market.raw_market_id.clone()).collect(),
            anchor: Mutex::new(AnchorState::default()),
        }
    }
}

impl BookVenue for Htx {
    type State = HashMap<usize, i64>; // version of the last frame applied, by position

    // The server pings every 5 s and closes a socket that leaves 4 pings unanswered, at about 20 s, and never answers a client ping.
    // The ping is traffic, so three missed pings is a dead socket, while a quiet book went 28.6 s without a frame.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            // At most 40 subscriptions a second, one topic per frame, and the sockets open apart so their bursts do not add up.
            subscribe_gap: Duration::from_millis(25),
            connect_stagger: Duration::from_secs(4),
            ..FeedSettings::new(Duration::from_secs(15))
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

    // The request id is the raw market id, so an error, which may name no topic, still names its market.
    // Without data_type the server sends a whole book on every change instead of deltas.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for market in markets {
            let topic = format!("market.{}.{CHANNEL_SUFFIX}", market.raw_market_id);
            let frame = serde_json::json!({ "sub": topic, "data_type": "incremental", "id": market.raw_market_id });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let inflated;
        let frame = if frame.starts_with(&GZIP_MAGIC) {
            inflated = wire::gunzip(frame)?;
            inflated.as_slice()
        } else {
            frame
        };

        let frame: Frame = serde_json::from_slice(frame)?;

        if let Some(ping) = frame.ping {
            conn.send(Message::text(format!(r#"{{"pong":{ping}}}"#)));
            return Ok(());
        }

        if let (Some(ch), Some(tick)) = (frame.ch.as_deref(), frame.tick) {
            if let Some(symbol) = ch.strip_prefix("market.").and_then(|rest| rest.strip_suffix(CHANNEL_SUFFIX)?.strip_suffix('.')) {
                apply_book(symbol, tick, conn);
            }
            return Ok(());
        }

        // An acknowledgement is status ok with subbed, and a suspended contract is acknowledged and then stays silent.
        if frame.status.as_deref() == Some("error") {
            let code = match frame.err_code {
                Some(serde_json::Value::String(code)) => code,
                Some(code) => code.to_string(),
                None => String::new(),
            };
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                market = frame.id.as_deref().unwrap_or(""),
                code,
                message = frame.err_msg.as_deref().unwrap_or(""),
            );
        }

        Ok(())
    }
}

fn apply_book(symbol: &str, tick: Tick<'_>, conn: &mut Connection<HashMap<usize, i64>>) {
    let Some(position) = conn.position(symbol) else {
        return;
    };

    // A resubscribe sends a fresh snapshot whose version continues the chain, and it replaces the book either way.
    if tick.event == "snapshot" {
        conn.state.insert(position, tick.version);
        conn.reset_book(position, &tick.bids, &tick.asks);
        return;
    }

    // An empty delta still advances the version, and versions are never compared across sockets.
    match conn.state.get_mut(&position) {
        Some(last) if tick.version == *last + 1 => *last = tick.version,
        Some(_) => {
            conn.resync(symbol, "sequence_gap");
            return;
        }
        None => {
            conn.resync(symbol, "update_before_snapshot");
            return;
        }
    }

    let Some(book) = conn.book(position) else {
        return;
    };
    for level in &tick.bids {
        book.set_bid(level.price, level.size);
    }
    for level in &tick.asks {
        book.set_ask(level.price, level.size);
    }
    conn.publish(position);
}

// Pings, acknowledgements, errors and books share no envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    ping: Option<i64>, // the server's heartbeat, echoed back as pong
    #[serde(borrow)]
    ch: Option<Cow<'a, str>>, // "market.BTC-USDT.depth.size_20.high_freq"
    #[serde(borrow)]
    tick: Option<Tick<'a>>,
    #[serde(borrow)]
    status: Option<Cow<'a, str>>, // "ok" on an acknowledgement, "error" on a refusal
    #[serde(borrow)]
    id: Option<Cow<'a, str>>, // the subscribe's id, "" on a frame that was not JSON
    #[serde(rename = "err-code")]
    err_code: Option<serde_json::Value>, // "bad-request"
    #[serde(borrow, rename = "err-msg")]
    err_msg: Option<Cow<'a, str>>, // "invalid topic market.NOPE-USDT.depth.size_20.high_freq"
}

#[derive(Deserialize)]
struct Tick<'a> {
    #[serde(borrow, default)]
    event: Cow<'a, str>, // "snapshot" or "update"
    #[serde(default)]
    version: i64, // the previous frame's plus one on every stream
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // [price, contracts] numbers, where a size of zero deletes the level
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
}
