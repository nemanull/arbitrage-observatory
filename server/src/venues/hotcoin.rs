mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::socket_anchors::SocketAnchors;
use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::de::value::{MapAccessDeserializer, SeqAccessDeserializer};
use serde::de::{self, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashSet;
use std::fmt;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "hotcoin";

const REST: &str = "https://api-ct.hotcoin.fit";

// One socket carries the USDT-M, USDC-M and coin-M contracts alike.
const PUBLIC_URL: &str = "wss://wss-ct.hotcoin.fit";

// 150 depth streams in one burst and then 150 more ran on one socket with no refusal, and no cap is published.
const MARKETS_PER_CONNECTION: usize = 150;

const DEPTH: &str = "depth"; // a whole 50 level window on every push, the only book channel

// Mark, index, settled and upcoming rate and the countdown to settlement of every contract, one frame of about 131 KB every 3 s.
// The per contract fund_rate stream pushes only on a change, so a quiet contract's anchor would age while its numbers still stood.
const FUND_RATES: &str = "fund_rates";

pub struct Hotcoin {
    rest: String,
    anchors: SocketAnchors,              // filled by handle, read by fetch_round
    intervals: Mutex<anchor::Intervals>, // read from the funding history by fetch_round, used by handle
}

impl Hotcoin {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(markets, REST)
    }

    fn with_rest(markets: &[TrackedMarket], rest: &str) -> Self {
        let mut raw_ids = Vec::with_capacity(markets.len());
        for tracked in markets {
            raw_ids.push(tracked.market.raw_market_id.clone());
        }

        Self {
            rest: rest.to_string(),
            anchors: SocketAnchors::new(true),
            intervals: Mutex::new(anchor::Intervals::new(raw_ids)),
        }
    }
}

// The contracts of one connection, which take their anchors from its fund_rates frames, so a dropped socket ages both its books and its anchors.
#[derive(Default)]
pub struct State {
    codes: HashSet<String>,
}

impl BookVenue for Hotcoin {
    type State = State;

    // The server sends no ping, and an idle socket closes at 60 s, so the JSON ping goes every 20 s.
    // A quiet book went 4.6 s without a frame and fund_rates pushes every 3 s, so 45 s of silence is two missed pongs.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(20)),
            ..FeedSettings::new(Duration::from_secs(45))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#perpetual#{i}"),
                url: PUBLIC_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // The protocol takes one topic per frame, and 150 in one burst were all acknowledged.
    // serialize true would switch the pushes to gzip protobuf, so both flags stay false.
    fn subscribe_frames(&self, markets: &[Market], state: &mut State) -> Vec<Message> {
        state.codes = markets.iter().map(|market| market.raw_market_id.clone()).collect();

        let mut frames = Vec::with_capacity(markets.len() + 1);
        for market in markets {
            frames.push(subscribe(DEPTH, Some(&market.raw_market_id)));
        }
        frames.push(subscribe(FUND_RATES, None));
        frames
    }

    fn ping(&self, _state: &mut State) -> Message {
        Message::text(r#"{"event":"ping"}"#)
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
        let at = conn.frame_recv_ts();
        self.handle_at(frame, conn, at)
    }
}

impl Hotcoin {
    // `at` is the frame's arrival, which stamps the index and the mark it carries.
    fn handle_at(&self, frame: &[u8], conn: &mut Connection<State>, at: i64) -> anyhow::Result<()> {
        let frame: Frame = match serde_json::from_slice(frame) {
            Ok(parsed) => parsed,
            Err(error) => {
                clear_unreadable_book(frame, conn);
                return Err(error.into());
            }
        };

        if let Some(code) = frame.error_code {
            tracing::error!(event = "venue_error", connection = conn.id(), code, message = frame.error_msg.as_deref().unwrap_or(""));
            return Ok(());
        }

        // An acknowledgement carries a channel and a push never does.
        // An unknown contract is acknowledged as a success and then stays silent, which book_unserved reports.
        if let Some(channel) = frame.channel.as_deref() {
            let accepted = matches!(&frame.data, Some(Payload::Depth(depth)) if depth.result == Some(true));
            if channel != "subscribe" || !accepted {
                tracing::warn!(
                    event = "venue_notice",
                    connection = conn.id(),
                    channel,
                    kind = frame.kind.as_deref().unwrap_or(""),
                    market = frame.contract_code.as_deref().unwrap_or(""),
                );
            }
            return Ok(());
        }

        // The answer to the ping, which only counts as traffic.
        if frame.event.as_deref() == Some("pong") {
            return Ok(());
        }

        match (frame.kind.as_deref(), frame.data, frame.contract_code.as_deref()) {
            (Some(DEPTH), Some(Payload::Depth(depth)), Some(code)) => {
                // A contract subscribed in capitals is echoed in capitals once, so the code is lowered before routing.
                // Every push is the whole window, with no sequence to chain, so a lost frame heals on the next one.
                if let Some(position) = conn.position(&lowercase(code)) {
                    // OrderBook skips a level it cannot read, which would publish the window without that level.
                    if !readable(&depth.bids) || !readable(&depth.asks) {
                        clear_book(conn, position);
                        anyhow::bail!("a depth level of {code} has no positive price or no size");
                    }
                    conn.reset_book(position, &depth.bids, &depth.asks);
                }
            }
            // The rows hold about 400 delisted contracts beside the listed ones, and the ones of other connections.
            (Some(FUND_RATES), Some(Payload::Funding(rows)), _) => {
                for row in &rows {
                    if conn.state.codes.contains(&row.code) {
                        self.write_anchor(row, frame.timestamp, at);
                    }
                }
            }
            (kind, _, code) => {
                tracing::warn!(event = "venue_notice", connection = conn.id(), kind = kind.unwrap_or(""), market = code.unwrap_or(""));
            }
        }

        Ok(())
    }

    fn write_anchor(&self, row: &FundRow, pushed_at: Option<i64>, at: i64) {
        self.anchors.set_index(&row.code, row.index, at);
        self.anchors.set_mark(&row.code, row.mark, at);

        let interval = self.intervals.lock().unwrap().hours(&row.code);
        let next_funding_at = anchor::next_settlement(pushed_at, row.countdown);
        // The settled rate sits beside it, and the engine wants the one for the upcoming settlement.
        self.anchors.set_funding(&row.code, row.estimated_rate, interval, next_funding_at);
    }
}

fn subscribe(kind: &str, code: Option<&str>) -> Message {
    let mut params = serde_json::json!({ "biz": "perpetual", "type": kind, "zip": false, "serialize": false });
    if let Some(code) = code {
        params["contractCode"] = serde_json::json!(code);
    }
    Message::text(serde_json::json!({ "event": "subscribe", "params": params }).to_string())
}

fn readable(levels: &[BookLevel]) -> bool {
    levels
        .iter()
        .all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

// The last book of a market whose depth frame does not read would otherwise stand as current until its next push, up to 4.6 s later on a quiet contract.
fn clear_unreadable_book(frame: &[u8], conn: &mut Connection<State>) {
    let Ok(Envelope { kind: Some(kind), contract_code: Some(code) }) = serde_json::from_slice(frame) else {
        return;
    };
    if kind != DEPTH {
        return;
    }
    if let Some(position) = conn.position(&lowercase(&code)) {
        clear_book(conn, position);
    }
}

fn clear_book(conn: &mut Connection<State>, position: usize) {
    if conn.book(position).is_some() {
        conn.reset_book(position, &[], &[]);
    }
}

fn lowercase(code: &str) -> Cow<'_, str> {
    if code.bytes().any(|byte| byte.is_ascii_uppercase()) {
        Cow::Owned(code.to_ascii_lowercase())
    } else {
        Cow::Borrowed(code)
    }
}

// Pushes, acknowledgements, the pong and the error frame share no shape, so nothing here is sure to be present.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Frame<'a> {
    #[serde(borrow)]
    event: Option<Cow<'a, str>>, // "pong"
    #[serde(borrow)]
    channel: Option<Cow<'a, str>>, // "subscribe" or "unsubscribe" on an acknowledgement, absent on a push
    #[serde(borrow, rename = "type")]
    kind: Option<Cow<'a, str>>, // "depth" or "fund_rates"
    #[serde(borrow)]
    contract_code: Option<Cow<'a, str>>, // "btcusdt", absent on fund_rates
    timestamp: Option<i64>, // the push time in Unix ms, about 85 ms behind arrival
    data: Option<Payload>,
    #[serde(rename = "error_code")]
    error_code: Option<i64>, // 500 on a frame the server cannot read
    #[serde(rename = "error_msg")]
    error_msg: Option<String>, // "exception"
}

// What a frame that fails to parse still names, so its book can be cleared.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope<'a> {
    #[serde(borrow, rename = "type")]
    kind: Option<Cow<'a, str>>,
    #[serde(borrow)]
    contract_code: Option<Cow<'a, str>>,
}

// A depth push and an acknowledgement carry an object, and a fund_rates push an array of rows.
enum Payload {
    Depth(Depth),
    Funding(Vec<FundRow>),
}

impl<'de> Deserialize<'de> for Payload {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(PayloadVisitor)
    }
}

struct PayloadVisitor;

impl<'de> Visitor<'de> for PayloadVisitor {
    type Value = Payload;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a depth object or an array of fund_rates rows")
    }

    fn visit_map<A: MapAccess<'de>>(self, map: A) -> Result<Payload, A::Error> {
        Depth::deserialize(MapAccessDeserializer::new(map)).map(Payload::Depth)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, seq: A) -> Result<Payload, A::Error> {
        Vec::<FundRow>::deserialize(SeqAccessDeserializer::new(seq)).map(Payload::Funding)
    }
}

#[derive(Deserialize)]
struct Depth {
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // [price, contracts, running total] strings, best first
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
    result: Option<bool>, // true on an acknowledgement
}

// [code, mark, index, settled rate, upcoming rate, ms to the next settlement from the frame's timestamp, open interest, and twelve more].
struct FundRow {
    code: String, // "btcusdt"
    mark: f64,
    index: f64,
    estimated_rate: f64, // a fraction per interval
    countdown: f64,      // ms, negative on a delisted contract
}

impl<'de> Deserialize<'de> for FundRow {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_seq(FundRowVisitor)
    }
}

struct FundRowVisitor;

impl<'de> Visitor<'de> for FundRowVisitor {
    type Value = FundRow;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a fund_rates row of at least six fields")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<FundRow, A::Error> {
        let Some(code) = seq.next_element::<String>()? else {
            return Err(de::Error::invalid_length(0, &self));
        };
        let mut fields = [f64::NAN; 6];
        for (i, field) in fields.iter_mut().enumerate().skip(1) {
            let Some(Field(value)) = seq.next_element()? else {
                return Err(de::Error::invalid_length(i, &self));
            };
            *field = value;
        }
        while seq.next_element::<IgnoredAny>()?.is_some() {}

        Ok(FundRow {
            code,
            mark: fields[1],
            index: fields[2],
            estimated_rate: fields[4],
            countdown: fields[5],
        })
    }
}

// One number of a fund_rates row, a decimal string or a number.
struct Field(f64);

impl<'de> Deserialize<'de> for Field {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        wire::num(deserializer).map(Field)
    }
}
