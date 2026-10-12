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
use std::collections::HashSet;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "bitunix";

const REST: &str = "https://fapi.bitunix.com";

// One socket carries the USDT-M, USDC-M and coin-M contracts alike.
const PUBLIC_URL: &str = "wss://fapi.bitunix.com/public/";

// A whole 15 level window on every push, about every 310 ms, quiet or busy.
// No 20 level channel exists, and depth_books pushes the whole book at about 460 KB a frame on BTCUSDT.
const CHANNEL: &str = "depth_book15";

// The cap is 300 streams a socket, and the 301st is refused, so a slice leaves room.
const MARKETS_PER_CONNECTION: usize = 250;

pub struct Bitunix {
    rest: String,
}

impl Bitunix {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self { rest: rest.to_string() }
    }
}

#[derive(Default)]
pub struct State {
    unserved: HashSet<usize>, // positions already logged for a frame of empty levels
}

impl BookVenue for Bitunix {
    type State = State;

    // A socket that sends nothing closes at about 60 s and a subscribed one at 65 to 81 s, so the JSON ping goes every 20 s.
    // Every stream pushes about every 310 ms with gaps up to 591 ms, so 5 s of silence is a dead socket.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(20)),
            // The venue allows 5 client messages a second, and a staggered open also staggers each socket's pings.
            connect_stagger: Duration::from_secs(1),
            ..FeedSettings::new(Duration::from_secs(5))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#public#{i}"),
                url: PUBLIC_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // A breach of the message rate disconnects and repeated breaches can block the IP, so a whole slice goes in one frame.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut State) -> Vec<Message> {
        let mut args = Vec::with_capacity(markets.len());
        for market in markets {
            args.push(serde_json::json!({ "symbol": market.raw_market_id, "ch": CHANNEL }));
        }
        let frame = serde_json::json!({ "op": "subscribe", "args": args });
        vec![Message::text(frame.to_string())]
    }

    // A protocol ping as the first client frame kills the socket, and the server answers only this JSON ping.
    fn ping(&self, _state: &mut State) -> Message {
        Message::text(serde_json::json!({ "op": "ping", "ping": now_ms() / 1000 }).to_string())
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
        // Only a control frame can fail here, since an unsubscribe answer carries a string where a book carries levels.
        let frame: Frame = match serde_json::from_slice(frame) {
            Ok(frame) => frame,
            Err(_) => {
                let other: Other = serde_json::from_slice(frame)?;
                tracing::warn!(event = "venue_notice", connection = conn.id(), op = other.op.as_deref().unwrap_or(""), data = %other.data);
                return Ok(());
            }
        };

        if let Some(channel) = frame.ch.as_deref() {
            if channel == CHANNEL
                && let Some(symbol) = frame.symbol.as_deref()
                && let Some(depth) = &frame.data
            {
                apply_book(symbol, depth, conn);
            }
            return Ok(());
        }

        let op = frame.op.as_deref().unwrap_or("");
        let data = frame.data.as_ref();
        match op {
            // The answer to the ping, which only counts as traffic.
            "ping" => {}
            "connect" if data.and_then(|data| data.result) == Some(true) => {}
            _ if data.and_then(|data| data.result) == Some(false) => {
                let message = data.and_then(|data| data.msg.as_deref()).unwrap_or("");
                tracing::error!(event = "venue_error", connection = conn.id(), op, message);
            }
            _ => tracing::warn!(event = "venue_notice", connection = conn.id(), op),
        }

        Ok(())
    }
}

// Every frame is the whole window, with no sequence to chain, so a lost frame heals on the next one.
fn apply_book(symbol: &str, depth: &Depth, conn: &mut Connection<State>) {
    let Some(position) = conn.position(symbol) else {
        return;
    };

    // An unknown, delisted or preview symbol gets one frame of empty string levels and nothing after it.
    // An empty string price reads as NaN.
    if !depth.b.iter().chain(&depth.a).any(|level| level.price.is_finite()) {
        if conn.state.unserved.insert(position) {
            tracing::warn!(event = "venue_notice", connection = conn.id(), market = symbol, reason = "empty_levels");
        }
        // No frame follows, so a book this market already had would otherwise stand as current.
        if conn.book(position).is_some() {
            conn.reset_book(position, &[], &[]);
        }
        return;
    }

    conn.reset_book(position, &depth.b, &depth.a);
}

// Books and control frames share the envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    op: Option<Cow<'a, str>>, // "connect", "ping" or "subscribe" on a control frame, absent on a push
    #[serde(borrow)]
    ch: Option<Cow<'a, str>>, // "depth_book15" on a push
    #[serde(borrow)]
    symbol: Option<Cow<'a, str>>, // "BTCUSDT", absent on a subscribe that named no symbol
    data: Option<Depth>,
}

#[derive(Deserialize)]
struct Depth {
    #[serde(default, deserialize_with = "wire::levels")]
    b: Vec<BookLevel>, // [price, coins] strings, best first, and ["", ""] on an unknown symbol
    #[serde(default, deserialize_with = "wire::levels")]
    a: Vec<BookLevel>,
    result: Option<bool>, // on connect, and false on a refused subscribe
    msg: Option<String>,  // "subscribe channel > 300" on a refused subscribe
}

// Any other frame, read only to be logged.
#[derive(Deserialize)]
struct Other {
    op: Option<String>,
    #[serde(default)]
    data: serde_json::Value,
}
