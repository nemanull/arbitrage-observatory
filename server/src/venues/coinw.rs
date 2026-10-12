mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::socket_anchors::SocketAnchors;
use super::wire;
use crate::engine::cluster::index_builder::DEPTH_LEVEL;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::de::{Deserializer, IgnoredAny, SeqAccess, Visitor};
use serde::Deserialize;
use std::borrow::Cow;
use std::fmt;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "coinw";

const REST: &str = "https://api.coinw.com";

// One address serves USDT-M and USDC-M, books and the anchor channels alike.
const SOCKET_URL: &str = "wss://ws.futurescw.com/perpum";

// Each market takes its depth, index_price, mark_price and funding_rate channels.
// A connection serves only its first 513 subscriptions and acknowledges the rest in silence, so 100 markets leave room.
const CHANNELS: [&str; 4] = ["depth", "index_price", "mark_price", "funding_rate"];
const MARKETS_PER_CONNECTION: usize = 100;

// Depth subscriptions are documented at 10 per 2 s per IP, and a market's four frames go out together.
// So one connection subscribes at 5 depth channels a second, and the next opens only once it is done.
const SUBSCRIBE_GAP: Duration = Duration::from_millis(50);
const CONNECT_STAGGER: Duration = Duration::from_secs(20);
const _: () = assert!(
    SUBSCRIBE_GAP.as_millis() * (CHANNELS.len() * MARKETS_PER_CONNECTION) as u128 <= CONNECT_STAGGER.as_millis()
);

pub struct Coinw {
    anchors: SocketAnchors, // filled by handle, read by fetch_round
    tracked: usize,         // markets on the book sockets, which fetch_round waits for at boot
    first_round: OnceLock<Instant>,
}

impl Coinw {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self {
            anchors: SocketAnchors::new(true),
            tracked: markets.len(),
            first_round: OnceLock::new(),
        }
    }
}

impl BookVenue for Coinw {
    type State = ();

    // The server never pings, and a socket that sends nothing dies at 60 s.
    // A quiet book went 6 s without a frame, while funding_rate pushes every 5 s, so 30 s of silence is a dead socket.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(20)),
            subscribe_gap: SUBSCRIBE_GAP,
            connect_stagger: CONNECT_STAGGER,
            ..FeedSettings::new(Duration::from_secs(30))
        }
    }

    // Even slices, so 376 markets make four connections of 94 rather than three of 100 and one of 76.
    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let connections = markets.len().div_ceil(MARKETS_PER_CONNECTION).max(1);
        let per_connection = markets.len().div_ceil(connections).max(1);

        let mut plans = Vec::with_capacity(connections);
        for (i, slice) in markets.chunks(per_connection).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#perp#{i}"),
                url: SOCKET_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // One channel per frame, since a joined pairCode is acknowledged and never served.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut ()) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len() * CHANNELS.len());
        for market in markets {
            for channel in CHANNELS {
                let frame = serde_json::json!({
                    "event": "sub",
                    "params": { "biz": "futures", "type": channel, "pairCode": market.raw_market_id },
                });
                frames.push(Message::text(frame.to_string()));
            }
        }
        frames
    }

    // The text "ping" is refused with 1001, while this event gets {"event":"pong"}.
    fn ping(&self, _state: &mut ()) -> Message {
        Message::text(r#"{"event":"ping"}"#)
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<()>) -> anyhow::Result<()> {
        let at = conn.frame_recv_ts();
        self.handle_at(frame, conn, at)
    }
}

impl Coinw {
    // `at` is the frame's arrival, which stamps the anchor fields it carries.
    fn handle_at(&self, frame: &[u8], conn: &mut Connection<()>, at: i64) -> anyhow::Result<()> {
        let trimmed = top_of_book(frame);
        let frame: Frame = serde_json::from_slice(&trimmed)?;

        // A refused subscribe carries its error inside data, and a refused request of no channel carries it at the top.
        let (result, code, message) = if frame.channel.is_some() {
            (frame.data.result, frame.data.error_code, frame.data.error_msg.as_deref())
        } else {
            (frame.result, frame.error_code, frame.error_msg.as_deref())
        };
        if result == Some(false) {
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                code = code.unwrap_or(0),
                message = message.unwrap_or(""),
                channel = frame.kind.as_deref().unwrap_or(""),
                market = frame.pair_code.as_deref().unwrap_or(""),
            );
            return Ok(());
        }

        // An acknowledgement or a pong.
        if frame.channel.is_some() || frame.event.is_some() {
            return Ok(());
        }

        let (Some(kind), Some(pair_code)) = (frame.kind.as_deref(), frame.pair_code.as_deref()) else {
            return Ok(());
        };
        let data = frame.data;

        // Depth frames echo pairCode in upper case, which is the raw id.
        // Every frame is the whole book, with no sequence to chain.
        if kind == "depth" {
            let Some(position) = conn.position(pair_code) else {
                return Ok(());
            };
            // The trim keeps the first levels as they arrive, so a side out of order or with a level it cannot read would hide the real top.
            // BOT repeated one price on two adjacent bids on 2026-10-09, which hides nothing, so a tie passes and the book keeps its last size.
            if !is_best_first(&data.bids, |a, b| a >= b) || !is_best_first(&data.asks, |a, b| a <= b) {
                conn.resync(pair_code, "unordered_book");
                return Ok(());
            }
            conn.reset_book(position, &data.bids, &data.asks);
            return Ok(());
        }

        if !matches!(kind, "index_price" | "mark_price" | "funding_rate") {
            return Ok(());
        }

        // The anchor channels send pairCode in lower case, "btc" and "btc_usdc".
        let raw_market_id = pair_code.to_ascii_uppercase();
        if conn.position(&raw_market_id).is_none() {
            return Ok(());
        }
        match kind {
            "index_price" => self.anchors.set_index(&raw_market_id, data.p, at),
            // A mark of 0 would read as a venue with no mark, so it keeps the row out instead.
            "mark_price" => self.anchors.set_mark(&raw_market_id, if data.p > 0.0 { data.p } else { f64::NAN }, at),
            _ => self.anchors.set_funding(&raw_market_id, data.r, data.h, data.nt.unwrap_or(0)),
        }

        Ok(())
    }
}

fn is_best_first(levels: &[BookLevel], in_order: fn(f64, f64) -> bool) -> bool {
    let readable = |level: &BookLevel| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0;
    levels.iter().all(readable) && levels.windows(2).all(|pair| in_order(pair[0].price, pair[1].price))
}

// The frame with each side cut to its first DEPTH_LEVEL levels, so the parser skips the other 180 a side unread.
// A connection whose reader falls behind has its later subscribes ignored, and a debug build fell behind on whole frames on 2026-10-09.
// A level is a flat {"p":"..","m":".."} object, so the DEPTH_LEVEL-th closing brace ends the kept part and the first ] ends the side.
// Any other shape is left whole for the parser.
fn top_of_book(frame: &[u8]) -> Cow<'_, [u8]> {
    let Ok(text) = std::str::from_utf8(frame) else {
        return Cow::Borrowed(frame);
    };

    let mut cuts = Vec::with_capacity(2); // (start, end) byte ranges to drop
    for key in [r#""asks":["#, r#""bids":["#] {
        let Some(found) = text.find(key) else {
            continue;
        };
        let start = found + key.len();
        let Some(length) = text[start..].find(']') else {
            continue;
        };
        let side = &text[start..start + length];
        if let Some((last, _)) = side.match_indices('}').nth(DEPTH_LEVEL - 1)
            && last + 1 < length
        {
            cuts.push((start + last + 1, start + length));
        }
    }
    if cuts.is_empty() {
        return Cow::Borrowed(frame);
    }
    cuts.sort_unstable();

    let mut out = Vec::with_capacity(frame.len());
    let mut from = 0;
    for (start, end) in cuts {
        out.extend_from_slice(&frame[from..start]);
        from = end;
    }
    out.extend_from_slice(&frame[from..]);
    Cow::Owned(out)
}

// Pushes, acknowledgements, pongs and errors share the envelope, so little here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(rename = "type", borrow)]
    kind: Option<Cow<'a, str>>, // "depth", "index_price", "mark_price" or "funding_rate"
    #[serde(rename = "pairCode", borrow)]
    pair_code: Option<Cow<'a, str>>,
    #[serde(borrow)]
    channel: Option<Cow<'a, str>>, // "subscribe" on an acknowledgement
    #[serde(borrow)]
    event: Option<Cow<'a, str>>, // "pong"
    result: Option<bool>, // false on a refused request of no channel
    #[serde(rename = "errorCode")]
    error_code: Option<i64>,
    #[serde(rename = "errorMsg")]
    error_msg: Option<String>,
    #[serde(default)]
    data: Data,
}

#[derive(Deserialize)]
struct Data {
    #[serde(default, deserialize_with = "top_levels")]
    bids: Vec<BookLevel>, // up to 200 levels of {"p","m"} strings in base coins, best first, null on other channels
    #[serde(default, deserialize_with = "top_levels")]
    asks: Vec<BookLevel>,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    p: f64, // the index or the mark, a JSON number
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    r: f64, // the upcoming funding rate as a fraction per interval
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    h: f64, // the funding interval in hours
    nt: Option<i64>, // the next settlement in Unix ms
    result: Option<bool>, // on an acknowledgement
    #[serde(rename = "errorCode")]
    error_code: Option<i64>,
    #[serde(rename = "errorMsg")]
    error_msg: Option<String>,
}

impl Default for Data {
    fn default() -> Self {
        Self {
            bids: Vec::new(),
            asks: Vec::new(),
            p: f64::NAN,
            r: f64::NAN,
            h: f64::NAN,
            nt: None,
            result: None,
            error_code: None,
            error_msg: None,
        }
    }
}

#[derive(Deserialize)]
struct Level {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    p: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    m: f64,
}

// The first DEPTH_LEVEL levels of a side, with the rest skipped unparsed, since each push resends up to 200.
// That relies on the wire's order, best first, which held on every captured frame and which handle checks on the kept levels.
// A null reads as no levels.
fn top_levels<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<BookLevel>, D::Error> {
    deserializer.deserialize_any(TopLevels)
}

struct TopLevels;

impl<'de> Visitor<'de> for TopLevels {
    type Value = Vec<BookLevel>;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("an array of {p, m} levels or null")
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(Vec::new())
    }

    fn visit_none<E>(self) -> Result<Self::Value, E> {
        Ok(Vec::new())
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        let mut levels = Vec::with_capacity(DEPTH_LEVEL);
        while levels.len() < DEPTH_LEVEL {
            let Some(Level { p, m }) = seq.next_element()? else {
                return Ok(levels);
            };
            levels.push(BookLevel { price: p, size: m });
        }
        while seq.next_element::<IgnoredAny>()?.is_some() {}
        Ok(levels)
    }
}
