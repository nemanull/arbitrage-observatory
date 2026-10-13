// Paradex, a perpetual DEX whose order book runs in the operator's cloud in Tokyo and whose trades settle on its own Starknet appchain.
// Since 2026-09-21 every public channel payload is a binary SBE frame, decoded in sbe.rs, while requests, acknowledgements and errors stay JSON-RPC text.

mod anchor;
mod markets;
mod sbe;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::socket_anchors::SocketAnchors;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "paradex";

const REST: &str = "https://api.prod.paradex.trade";

// The plain URL is refused at the handshake with HTTP 400, and version 1 is the documented choice.
const URL: &str = "wss://ws.api.prod.paradex.trade/v1?sbeSchemaId=1&sbeSchemaVersion=1";

// The whole API book once, then deltas whose seq steps by exactly 1, at full depth.
// The book leaves out RPI orders, which only Retail orders can take, and it is the book an API order fills against.
fn book_channel(raw_market_id: &str) -> String {
    format!("order_book.{raw_market_id}.deltas")
}

// Mark, index and the precise funding rate, one frame a second per market.
fn summary_channel(raw_market_id: &str) -> String {
    format!("markets_summary.{raw_market_id}")
}

// The funding period in hours, which no summary carries, one frame every 5 s for each perpetual and for no other kind.
const FUNDING_CHANNEL: &str = "funding_data.ALL";

// The server takes a burst of 20 subscribe requests on a socket and then one every 100 ms, acknowledging each in turn.
// So 198 requests on one socket took 17.9 s to serve on 2026-10-12, while 30 markets take 61 requests and 4.1 s.
const MARKETS_PER_CONNECTION: usize = 30;

pub struct Paradex {
    anchors: SocketAnchors, // filled by handle, read by fetch_round
    tracked: usize,         // markets on the book sockets, which fetch_round waits for at boot
    first_round: OnceLock<Instant>,
}

impl Paradex {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self {
            anchors: SocketAnchors::new(true),
            tracked: markets.len(),
            first_round: OnceLock::new(),
        }
    }
}

#[derive(Default)]
pub struct State {
    channels: Vec<String>,              // the channel of each subscribe request at its id minus one, since an error reply names only the id
    seq: HashMap<usize, i64>,           // seq of the last book frame applied, by position
    period_hours: HashMap<String, f64>, // the funding period of every perpetual by market, this socket's and the others' alike
}

impl BookVenue for Paradex {
    type State = State;

    // Every market sends a summary a second, while a quiet book sends nothing for minutes, so 10 s of silence is a dead socket.
    // The server pings every 30.1 s and closes a socket 45 s after a ping it never got an answer to, and tungstenite answers each ping.
    fn settings(&self) -> FeedSettings {
        FeedSettings::new(Duration::from_secs(10))
    }

    // The pace of the subscribe requests is per socket, so smaller sockets fill sooner after a start or a resync.
    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#perp#{i}"),
                url: URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // One channel per frame in one burst, which the server serves in order, so the funding periods and the books come first.
    // An unknown market errors only its own request.
    fn subscribe_frames(&self, markets: &[Market], state: &mut Self::State) -> Vec<Message> {
        let mut channels = Vec::with_capacity(1 + markets.len() * 2);
        channels.push(FUNDING_CHANNEL.to_string());
        channels.extend(markets.iter().map(|market| book_channel(&market.raw_market_id)));
        channels.extend(markets.iter().map(|market| summary_channel(&market.raw_market_id)));

        let mut frames = Vec::with_capacity(channels.len());
        for channel in channels {
            let frame = serde_json::json!({
                "jsonrpc": "2.0",
                "method": "subscribe",
                "params": { "channel": channel },
                "id": state.channels.len() + 1,
            });
            frames.push(Message::text(frame.to_string()));
            state.channels.push(channel);
        }
        frames
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let at = conn.frame_recv_ts();
        self.handle_at(frame, conn, at)
    }
}

impl Paradex {
    // `at` is the frame's arrival, which stamps the anchor fields it carries.
    // A binary frame names neither its channel nor a text marker, so the schema id at offset 4 tells it from a JSON text frame.
    fn handle_at(&self, frame: &[u8], conn: &mut Connection<State>, at: i64) -> anyhow::Result<()> {
        let Some(header) = sbe::header(frame).filter(|header| header.schema_id == sbe::SCHEMA_ID) else {
            return handle_text(frame, conn);
        };

        match header.template_id {
            sbe::BOOK => apply_book(sbe::book(frame, &header)?, conn),
            sbe::SUMMARY => self.apply_summary(&sbe::summary(frame, &header)?, conn, at),
            sbe::FUNDING => apply_funding(&sbe::funding(frame, &header)?, conn),
            _ => {} // the heartbeat, 40, and any template this feed never subscribed, which the schema says to skip
        }

        Ok(())
    }

    // Index and mark come with every summary, and the funding rate waits for the market's period from its funding frame.
    fn apply_summary(&self, summary: &sbe::Summary, conn: &mut Connection<State>, at: i64) {
        if conn.position(summary.market).is_none() {
            return;
        }

        self.anchors.set_index(summary.market, summary.index, at);
        self.anchors.set_mark(summary.market, summary.mark, at);
        // Funding accrues every second with no settlement instant, so the next funding is unknown.
        if let Some(&hours) = conn.state.period_hours.get(summary.market) {
            self.anchors.set_funding(summary.market, summary.funding_rate, hours, 0);
        }
    }
}

// funding_data.ALL names every perpetual, the other sockets' markets too, so a market is kept by name without a position lookup.
fn apply_funding(funding: &sbe::Funding, conn: &mut Connection<State>) {
    match conn.state.period_hours.get_mut(funding.market) {
        Some(hours) => *hours = funding.period_hours,
        None => {
            conn.state.period_hours.insert(funding.market.to_string(), funding.period_hours);
        }
    }
}

// The rule OrderBook applies to each level, where a size of 0 deletes, and a null mantissa reads as NaN.
fn readable(levels: &[BookLevel]) -> bool {
    levels.iter().all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

// A snapshot replaces the book and sets the sequence, and each delta must carry the next seq, even one that names no level.
fn apply_book(book: sbe::Book, conn: &mut Connection<State>) {
    let Some(position) = conn.position(book.market) else {
        return;
    };

    // The book would skip such a level and carry on, so a missed deletion would stay in a book that looks live.
    if !readable(&book.bids) || !readable(&book.asks) {
        conn.resync(book.market, "level_unreadable");
        return;
    }

    match book.pkg_type {
        sbe::SNAPSHOT => {
            conn.state.seq.insert(position, book.seq);
            conn.reset_book(position, &book.bids, &book.asks);
        }
        sbe::DELTA => {
            let Some(&last) = conn.state.seq.get(&position) else {
                conn.resync(book.market, "delta_before_snapshot");
                return;
            };
            if book.seq != last + 1 {
                conn.resync(book.market, "sequence_gap");
                return;
            }
            conn.state.seq.insert(position, book.seq);

            // A change to an RPI order moves the shared sequence and names no level of the API book.
            if book.bids.is_empty() && book.asks.is_empty() {
                return;
            }
            let Some(levels) = conn.book(position) else {
                return;
            };
            for level in &book.bids {
                levels.set_bid(level.price, level.size);
            }
            for level in &book.asks {
                levels.set_ask(level.price, level.size);
            }
            conn.publish(position);
        }
        _ => conn.resync(book.market, "package_type_unknown"),
    }
}

// Acknowledgements and errors are JSON-RPC replies that carry the request's id.
fn handle_text(frame: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
    let reply: Reply = serde_json::from_slice(frame)?;

    if let Some(error) = reply.error {
        let channel = reply
            .id
            .and_then(|id| conn.state.channels.get((id as usize).wrapping_sub(1)))
            .map_or("", String::as_str);
        let data = match &error.data {
            Some(serde_json::Value::String(text)) => text.clone(),
            Some(other) => other.to_string(),
            None => String::new(),
        };
        tracing::error!(
            event = "venue_error",
            connection = conn.id(),
            id = reply.id.unwrap_or(0),
            channel,
            code = error.code,
            message = %error.message,
            data = %data,
        );
    } else if reply.result.is_none() {
        tracing::warn!(event = "venue_notice", connection = conn.id(), frame = %String::from_utf8_lossy(frame));
    }

    Ok(())
}

// {"jsonrpc":"2.0","id":1,"result":{"channel":"order_book.BTC-USD-PERP.deltas"},"usIn":…,"usDiff":…,"usOut":…}
#[derive(Deserialize)]
struct Reply {
    id: Option<u64>, // 0 when the request did not parse
    result: Option<serde::de::IgnoredAny>,
    error: Option<RpcError>,
}

// {"code":-32600,"message":"invalid subscribe request","data":"market does not exist"}
#[derive(Deserialize)]
struct RpcError {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    message: String,
    data: Option<serde_json::Value>, // a string on every error seen
}
