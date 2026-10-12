mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::socket_anchors::SocketAnchors;
use crate::clock::now_ms;
use crate::engine::cluster::index_builder::DEPTH_LEVEL;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use crate::venues::wire;
use anchor::Funding;
use serde::Deserialize;
use serde::de::{Deserializer, IgnoredAny, SeqAccess, Visitor};
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "echobit";

const REST: &str = "https://uapi.echobit.com";

// The website's host, the only one with a bulk funding call.
const WEB: &str = "https://www.echobit.com";

// How a book push names its topic, so an unreadable push can still be told from a kline.
const BOOK_TOPIC: &[u8] = br#""topic":"depth""#;

// One socket carries every perpetual's book and its mark and index klines.
const MARKET_URL: &str = "wss://uapi.echobit.com/uapi/exchange/ws";

// Each market takes three subscriptions, its book and the mark and index klines of its indexId.
// 126 books ran on one socket, and two sockets of about 190 subscriptions each stay under the documented cap of 5 connections.
const MARKETS_PER_CONNECTION: usize = 64;

pub struct Echobit {
    web: String,
    anchors: SocketAnchors, // mark and index filled by handle, funding by fetch_round, read by fetch_round
    raw_of_index: HashMap<String, String>, // indexId to raw id, "BTCUSDT" to "BTC-SWAP-USDT"
    markets: HashSet<String>, // tracked raw ids, whose funding fetch_round writes
    funding: Mutex<Funding>,
    first_round: OnceLock<Instant>,
}

impl Echobit {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_web(markets, WEB)
    }

    fn with_web(markets: &[TrackedMarket], web: &str) -> Self {
        let mut raw_of_index = HashMap::with_capacity(markets.len());
        let mut ids = HashSet::with_capacity(markets.len());
        for tracked in markets {
            let raw = &tracked.market.raw_market_id;
            raw_of_index.insert(index_id(raw), raw.clone());
            ids.insert(raw.clone());
        }

        Self {
            web: web.to_string(),
            anchors: SocketAnchors::new(true),
            raw_of_index,
            markets: ids,
            funding: Mutex::new(Funding::default()),
            first_round: OnceLock::new(),
        }
    }
}

#[derive(Default)]
pub struct State {
    versions: Vec<u64>, // by position, n of the last book's v "<n>_18", 0 before the first
}

impl BookVenue for Echobit {
    type State = State;

    // The server closes a socket after 60 s without a client frame, and answers {"ping"} with {"pong"}.
    // A quiet book went 15 to 24 s without a push, but the index kline of every market pushes about once a second.
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
                id: format!("{ID}#swap#{i}"),
                url: MARKET_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // One symbol per frame, since a comma list is refused on the kline topics, and the books go first.
    // No limit is honoured, so every push holds the whole book of up to 200 levels a side.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len() * 3);
        for market in markets {
            frames.push(subscribe("depth", &market.raw_market_id));
        }
        for topic in ["markKline_1m", "indexKline_1m"] {
            for market in markets {
                frames.push(subscribe(topic, &index_id(&market.raw_market_id)));
            }
        }
        frames
    }

    fn ping(&self, _state: &mut State) -> Message {
        Message::text(format!("{{\"ping\":{}}}", now_ms()))
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
        let at = conn.frame_recv_ts();
        self.handle_at(frame, conn, at)
    }
}

impl Echobit {
    // `at` is the frame's arrival, which stamps the mark or index it carries, since a kline's t is its candle's open.
    fn handle_at(&self, bytes: &[u8], conn: &mut Connection<State>, at: i64) -> anyhow::Result<()> {
        let frame: Frame = match serde_json::from_slice(bytes) {
            Ok(frame) => frame,
            Err(error) => {
                // A lost push leaves the last book published until the next change, and a quiet book can go 24 s without one.
                if bytes.windows(BOOK_TOPIC.len()).any(|window| window == BOOK_TOPIC) {
                    let symbol = serde_json::from_slice::<Envelope>(bytes).ok().and_then(|envelope| envelope.symbol);
                    conn.resync(symbol.as_deref().unwrap_or(""), "book_frame_unreadable");
                }
                return Err(error.into());
            }
        };

        // Error frames carry no id, so the subscription they answer is unknown.
        if let Some(code) = &frame.code {
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                code = %code.as_str().map_or_else(|| code.to_string(), str::to_string),
                desc = frame.desc.as_deref().unwrap_or(""),
            );
            return Ok(());
        }

        let (Some(topic), Some(symbol)) = (frame.topic.as_deref(), frame.symbol.as_deref()) else {
            // The answer to the client ping, carrying the server's clock.
            if frame.pong.is_none() {
                let text = String::from_utf8_lossy(&bytes[..bytes.len().min(300)]);
                tracing::warn!(event = "venue_notice", connection = conn.id(), frame = %text);
            }
            return Ok(());
        };

        // The first kline push after a subscribe has an empty data.
        let Some(data) = frame.data.into_iter().next() else {
            return Ok(());
        };

        match topic {
            "depth" => apply_book(symbol, data, conn),
            "markKline" | "indexKline" => {
                let Some(raw) = self.raw_of_index.get(symbol) else {
                    return Ok(());
                };
                if topic == "markKline" {
                    self.anchors.set_mark(raw, data.c, at);
                } else {
                    self.anchors.set_index(raw, data.c, at);
                }
            }
            _ => tracing::warn!(event = "venue_notice", connection = conn.id(), topic, market = symbol),
        }

        Ok(())
    }
}

fn subscribe(topic: &str, symbol: &str) -> Message {
    let frame = serde_json::json!({ "id": format!("{topic}.{symbol}"), "topic": topic, "event": "sub", "symbol": symbol, "params": {} });
    Message::text(frame.to_string())
}

// "BTC-SWAP-USDT" becomes "BTCUSDT", the symbol of its mark and index klines.
// The loader keeps only markets whose indexId follows this rule.
fn index_id(raw_market_id: &str) -> String {
    raw_market_id.replacen("-SWAP-", "", 1)
}

// Every push is the whole book and replaces it, so no gap can exist.
// n of v rose strictly in every capture, and a repeat of the same n is still the book as the server holds it, as after a cut first push.
// One socket delivers in order, so a lower n means the venue restarted its counter, and dropping every frame after it would freeze the book.
fn apply_book(symbol: &str, data: Data, conn: &mut Connection<State>) {
    let Some(position) = conn.position(symbol) else {
        return;
    };

    // A push without a side, or with a level OrderBook would skip, would publish a book that lacks those levels until the next change.
    let (Some(Side(bids)), Some(Side(asks))) = (&data.b, &data.a) else {
        conn.resync(symbol, "book_side_missing");
        return;
    };
    if !readable(bids) || !readable(asks) {
        conn.resync(symbol, "level_unreadable");
        return;
    }

    let versions = &mut conn.state.versions;
    if versions.len() <= position {
        versions.resize(position + 1, 0);
    }
    if let Some(version) = version_number(data.v.as_deref()) {
        let last = versions[position];
        if version < last {
            tracing::warn!(event = "book_frame_older", connection = conn.id(), market = symbol, version, last);
            conn.resync(symbol, "version_went_back");
            return;
        }
        versions[position] = version;
    }

    conn.reset_book(position, bids, asks);
}

fn readable(levels: &[BookLevel]) -> bool {
    levels
        .iter()
        .all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

// "127297517_18" reads 127297517.
fn version_number(v: Option<&str>) -> Option<u64> {
    v?.split('_').next()?.parse().ok()
}

// Books, klines, pongs and errors share the envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    topic: Option<Cow<'a, str>>, // "depth", "markKline" or "indexKline"
    #[serde(borrow)]
    symbol: Option<Cow<'a, str>>, // the raw id on a book, the indexId on a kline
    #[serde(default)]
    data: Vec<Data>, // one row
    code: Option<serde_json::Value>, // "-100010" on an error, a string on every capture
    #[serde(borrow)]
    desc: Option<Cow<'a, str>>, // "Invalid Symbols!"
    pong: Option<IgnoredAny>,
}

#[derive(Deserialize, Default)]
struct Data {
    v: Option<String>, // the book version, "127297517_18"
    b: Option<Side>, // bids, best first, as [price, contracts] strings, absent on a kline
    a: Option<Side>,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    c: f64, // a kline's close, the latest mark or index
}

// The symbol of a book push whose levels cannot be read.
#[derive(Deserialize)]
struct Envelope {
    symbol: Option<String>,
}

// The first DEPTH_LEVEL levels of a side, since a side holds up to 200 and the rest are skipped unparsed.
struct Side(Vec<BookLevel>);

impl<'de> Deserialize<'de> for Side {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_seq(SideVisitor)
    }
}

struct SideVisitor;

impl<'de> Visitor<'de> for SideVisitor {
    type Value = Side;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("an array of [price, size] levels")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Side, A::Error> {
        let mut levels = Vec::with_capacity(DEPTH_LEVEL);
        while levels.len() < DEPTH_LEVEL {
            let Some(Level(price, size)) = seq.next_element()? else {
                return Ok(Side(levels));
            };
            levels.push(BookLevel { price, size });
        }
        while seq.next_element::<IgnoredAny>()?.is_some() {}
        Ok(Side(levels))
    }
}

#[derive(Deserialize)]
struct Level(#[serde(deserialize_with = "wire::num")] f64, #[serde(deserialize_with = "wire::num")] f64);
