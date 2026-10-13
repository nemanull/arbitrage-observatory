mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::socket_anchors::SocketAnchors;
use super::wire;
use crate::clock::now_ms;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use serde_json::Value;
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "apex";

const REST: &str = "https://omni.apex.exchange/api";

// One public socket carries the crypto and TradFi perpetuals and the anchor channel.
// The connect time in ms follows, as CCXT Pro appends it, and a pinging socket whose stamp was an hour old stayed open 210 s on 2026-10-12.
const SOCKET_URL: &str = "wss://quote.omni.apex.exchange/realtime_public?v=2";

// 25 levels, a snapshot on subscribe, then deltas whose u steps by one, about every 51 ms on BTC.
// The other depth is 200, so 25 is the smallest of at least 20.
const BOOK_PREFIX: &str = "orderBook25.H.";

// Every symbol's index, mark and running funding rate, as a whole snapshot every 2 s.
const ANCHOR_TOPIC: &str = "instrumentInfo.all";

// Funding settles every hour on the hour, crypto and TradFi alike.
const FUNDING_INTERVAL_HOURS: f64 = 1.0;

pub struct Apex {
    anchors: SocketAnchors,   // filled by handle, read by fetch_round
    tracked: HashSet<String>, // the markets on the book socket, the only rows of the anchor push that are kept
    first_round: OnceLock<Instant>,
}

impl Apex {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self {
            anchors: SocketAnchors::new(true),
            tracked: markets.iter().map(|tracked| tracked.market.raw_market_id.clone()).collect(),
            first_round: OnceLock::new(),
        }
    }
}

impl BookVenue for Apex {
    type State = HashMap<usize, i64>; // `u` of the last book frame applied, by position

    // The anchor push comes every 2 s and the server pings every 15 s, so 20 s of silence is a dead socket.
    // The server closes a socket whose client sent nothing for 150 s, even while books flow, so the client pings every 15 s as documented.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(15)),
            subscribe_gap: Duration::from_millis(5),
            ..FeedSettings::new(Duration::from_secs(20))
        }
    }

    // All 126 books and the anchor push ran on one socket on 2026-10-12, at about 150 book updates a second.
    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        if markets.is_empty() {
            return Vec::new();
        }

        vec![EndpointPlan {
            id: format!("{ID}#perp#0"),
            url: format!("{SOCKET_URL}&timestamp={}", now_ms()),
            markets: markets.to_vec(),
        }]
    }

    // The anchor channel first, then one topic per frame, because a frame with one unknown topic is refused whole.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len() + 1);
        frames.push(subscribe(ANCHOR_TOPIC));
        for market in markets {
            frames.push(subscribe(&format!("{BOOK_PREFIX}{}", market.raw_market_id)));
        }
        frames
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text(serde_json::json!({ "op": "ping", "args": [now_ms().to_string()] }).to_string())
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let at = conn.frame_recv_ts();
        self.handle_at(frame, conn, at)
    }
}

impl Apex {
    // `at` is the frame's arrival, which stamps the anchor fields it carries.
    fn handle_at(&self, frame: &[u8], conn: &mut Connection<HashMap<usize, i64>>, at: i64) -> anyhow::Result<()> {
        let envelope: Envelope = serde_json::from_slice(frame)?;

        if let Some(topic) = envelope.topic.as_deref() {
            if let Some(symbol) = topic.strip_prefix(BOOK_PREFIX) {
                return apply_book(symbol, envelope.kind.as_deref(), frame, conn);
            }
            if topic == ANCHOR_TOPIC {
                let push: AnchorPush = serde_json::from_slice(frame)?;
                self.read_anchors(&push.data.unwrap_or_default(), at);
            }
            return Ok(());
        }

        // The server pings every 15 s and takes its own args back.
        if envelope.op.as_deref() == Some("ping") {
            let args = envelope.args.unwrap_or_else(|| serde_json::json!([now_ms().to_string()]));
            conn.send(Message::text(serde_json::json!({ "op": "pong", "args": args }).to_string()));
            return Ok(());
        }

        // An unknown topic, a second subscribe of one topic and an unknown op are refused this way, and the socket stays open.
        // A subscribe acknowledgement and the answer to the client's ping carry success true.
        if envelope.success == Some(false) {
            let request = envelope.request.unwrap_or_default();
            let args = request.args.unwrap_or(Value::Null);
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                op = request.op.as_deref().unwrap_or(""),
                args = %args,
                message = envelope.ret_msg.as_deref().unwrap_or(""),
            );
        }

        Ok(())
    }

    // A field that is absent or does not read leaves its stamp alone, so a row the venue stops filling ages out of the engine.
    // The push carries every symbol, the prediction contracts among them, and only the tracked markets are kept.
    fn read_anchors(&self, rows: &[InstrumentRow], at: i64) {
        for row in rows {
            if !self.tracked.contains(row.s.as_ref()) {
                continue;
            }
            if row.xp.is_finite() {
                self.anchors.set_index(&row.s, row.xp, at);
            }
            if row.mp.is_finite() {
                self.anchors.set_mark(&row.s, row.mp, at);
            }
            // The next settlement is set by fetch_round from the round's clock.
            if row.fr.is_finite() {
                self.anchors.set_funding(&row.s, row.fr, FUNDING_INTERVAL_HOURS, 0);
            }
        }
    }
}

fn subscribe(topic: &str) -> Message {
    Message::text(serde_json::json!({ "op": "subscribe", "args": [topic] }).to_string())
}

// A frame that does not parse or a level that does not read would leave its change out of a book that looks live, so either resyncs.
fn apply_book(symbol: &str, kind: Option<&str>, frame: &[u8], conn: &mut Connection<HashMap<usize, i64>>) -> anyhow::Result<()> {
    let Some(position) = conn.position(symbol) else {
        return Ok(());
    };

    let data = match serde_json::from_slice::<BookFrame>(frame) {
        Ok(book) => book.data,
        Err(error) => {
            conn.resync(symbol, "book_frame_unreadable");
            return Err(error.into());
        }
    };
    if !readable(&data.b) || !readable(&data.a) {
        conn.resync(symbol, "level_unreadable");
        return Ok(());
    }

    match kind {
        // The bids arrive worst first and the asks best first, and the book sorts both sides.
        Some("snapshot") => {
            conn.state.insert(position, data.u);
            conn.reset_book(position, &data.b, &data.a);
        }
        Some("delta") => apply_delta(symbol, position, &data, conn),
        _ => conn.resync(symbol, "unknown_type"),
    }

    Ok(())
}

// The docs say a snapshot restarts u at 1, while the wire carries the running value, and either way the snapshot sets the base.
fn apply_delta(symbol: &str, position: usize, data: &BookData, conn: &mut Connection<HashMap<usize, i64>>) {
    let Some(&last) = conn.state.get(&position) else {
        conn.resync(symbol, "delta_before_snapshot");
        return;
    };
    if data.u != last + 1 {
        conn.resync(symbol, "sequence_gap");
        return;
    }
    conn.state.insert(position, data.u);

    if data.b.is_empty() && data.a.is_empty() {
        return;
    }
    let Some(book) = conn.book(position) else {
        conn.resync(symbol, "delta_before_snapshot");
        return;
    };

    // Deletes and inserts come mixed in no fixed order, so each level is applied by its price.
    for level in &data.b {
        book.set_bid(level.price, level.size);
    }
    for level in &data.a {
        book.set_ask(level.price, level.size);
    }
    conn.publish(position);
}

// The rule OrderBook applies to each level, where a size of 0 deletes.
fn readable(levels: &[BookLevel]) -> bool {
    levels.iter().all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

// Books, the anchor push, the server's ping, acknowledgements and errors share the envelope.
#[derive(Deserialize)]
struct Envelope<'a> {
    #[serde(borrow)]
    topic: Option<Cow<'a, str>>, // "orderBook25.H.BTCUSDT" or "instrumentInfo.all"
    #[serde(rename = "type", borrow)]
    kind: Option<Cow<'a, str>>, // "snapshot" or "delta"
    #[serde(borrow)]
    op: Option<Cow<'a, str>>, // "ping" on the server's ping
    args: Option<Value>, // the server ping's ["1791843653937"], its clock in ms
    success: Option<bool>, // on an acknowledgement or an error
    ret_msg: Option<String>, // "error:handler not found"
    request: Option<Request>,
}

#[derive(Default, Deserialize)]
struct Request {
    op: Option<String>,
    args: Option<Value>,
}

#[derive(Deserialize)]
struct BookFrame {
    data: BookData,
}

#[derive(Deserialize)]
struct BookData {
    #[serde(default, deserialize_with = "wire::levels")]
    b: Vec<BookLevel>, // [price, size] strings, sizes in base coins and absolute, "0" deletes
    #[serde(default, deserialize_with = "wire::levels")]
    a: Vec<BookLevel>,
    #[serde(default)]
    u: i64,
}

#[derive(Deserialize)]
struct AnchorPush<'a> {
    #[serde(borrow)]
    data: Option<Vec<InstrumentRow<'a>>>,
}

// One symbol of instrumentInfo.all, where p is the last trade and the other short keys are 24 h figures.
#[derive(Deserialize)]
struct InstrumentRow<'a> {
    #[serde(borrow)]
    s: Cow<'a, str>, // "BTCUSDT"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    xp: f64, // the index, a weighted spot basket for crypto and a Chainlink price for TradFi
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mp: f64, // the mark
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    fr: f64, // the running funding estimate for the coming hour, a fraction per hour
}
