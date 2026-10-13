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
use anyhow::Context;
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "derive";

// The v3 API, live since about 18:00 UTC on 2026-10-06.
// CCXT 4.5.68 still reads the v2 host api.lyra.finance, which serves frozen prices under current timestamps.
const REST: &str = "https://api.derive.xyz/v3";

// One address carries every instrument, books and tickers alike.
const URL: &str = "wss://api.derive.xyz/v3/ws";

// The whole book to 20 levels, pushed every 100 ms while it changes and about once a second while it does not.
// Group 1 is unaggregated, while group 10, which CCXT Pro subscribes, rounds bids down and asks up to ten ticks.
const BOOK_PREFIX: &str = "orderbook.";
const BOOK_SUFFIX: &str = ".1.20";

// The slim ticker carries the index, the mark and the hourly funding rate, once a second.
const TICKER_PREFIX: &str = "ticker_slim.";
const TICKER_SUFFIX: &str = ".1000";

// A socket and a request may each hold 10,000 channels, and a market takes its book and its ticker.
const CHANNELS_PER_CONNECTION: usize = 10_000;
const MARKETS_PER_CONNECTION: usize = CHANNELS_PER_CONNECTION / 2;

// Funding accrues continuously at a rate per hour and settles whenever a position changes, so no settlement instant exists.
const FUNDING_INTERVAL_HOURS: f64 = 1.0;
const NEXT_FUNDING_UNKNOWN: i64 = 0;

const PREVIEW_BYTES: usize = 200;

pub struct Derive {
    anchors: SocketAnchors, // filled by handle, read by fetch_round
    tracked: usize,         // markets on the book sockets, which fetch_round waits for at boot
    first_round: OnceLock<Instant>,
}

impl Derive {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self {
            anchors: SocketAnchors::new(true),
            tracked: markets.len(),
            first_round: OnceLock::new(),
        }
    }
}

impl BookVenue for Derive {
    type State = (); // every book frame is whole, so no frame depends on the ones before it

    // Every book and every ticker sends at least once a second, so 10 s of silence is a dead socket.
    // The server sends a protocol ping every 30 s and the automatic pong counts as activity, so no client ping is sent.
    fn settings(&self) -> FeedSettings {
        FeedSettings::new(Duration::from_secs(10))
    }

    // Four sockets are allowed per IP, and one holds 5,000 markets, so the 15 perpetuals share one.
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

    // One JSON-RPC request names every channel, and its reply carries a status per channel.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut channels = Vec::with_capacity(markets.len() * 2);
        for market in markets {
            channels.push(format!("{BOOK_PREFIX}{}{BOOK_SUFFIX}", market.raw_market_id));
        }
        for market in markets {
            channels.push(format!("{TICKER_PREFIX}{}{TICKER_SUFFIX}", market.raw_market_id));
        }
        let frame = serde_json::json!({ "id": 1, "method": "subscribe", "params": { "channels": channels } });
        vec![Message::text(frame.to_string())]
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let at = conn.frame_recv_ts();
        self.handle_at(frame, conn, at)
    }
}

impl Derive {
    // `at` is the frame's arrival, which stamps the anchor fields it carries.
    fn handle_at(&self, frame: &[u8], conn: &mut Connection<()>, at: i64) -> anyhow::Result<()> {
        // The answer to a text ping is the bare word, which is not JSON.
        if frame == b"pong" {
            return Ok(());
        }

        // The documented refusal past four sockets per IP may come as plain text, so an unreadable frame is quoted in the error.
        let envelope: Envelope =
            serde_json::from_slice(frame).with_context(|| format!("unreadable frame {}", preview(frame)))?;

        if let Some(channel) = envelope.params.as_ref().and_then(|params| params.channel.as_deref()) {
            if channel.starts_with(BOOK_PREFIX) {
                let push: Push<BookData> = serde_json::from_slice(frame)?;
                apply_book(&push.params.data, conn);
            } else if let Some(name) = ticker_market(channel)
                && conn.position(name).is_some()
            {
                let push: Push<TickerData> = serde_json::from_slice(frame)?;
                self.read_ticker(name, &push.params.data.instrument_ticker, at);
            }
            return Ok(());
        }

        if let Some(result) = &envelope.result {
            // An unknown name is acknowledged "ok" and then sends nothing, which the runtime's first book watch reports.
            for (channel, status) in &result.status {
                if status != "ok" && status != "already subscribed" {
                    tracing::error!(event = "venue_error", connection = conn.id(), channel = channel.as_str(), status = status.as_str());
                }
            }
            return Ok(());
        }

        if let Some(error) = &envelope.error {
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                code = error.code,
                message = error.message.as_deref().unwrap_or(""),
                data = error.data.as_deref().unwrap_or(""),
            );
            return Ok(());
        }

        tracing::warn!(event = "venue_notice", connection = conn.id(), frame = %preview(frame));
        Ok(())
    }

    fn read_ticker(&self, name: &str, ticker: &Ticker, at: i64) {
        self.anchors.set_index(name, ticker.index, at);
        self.anchors.set_mark(name, ticker.mark, at);
        self.anchors.set_funding(name, ticker.funding_rate, FUNDING_INTERVAL_HOURS, NEXT_FUNDING_UNKNOWN);
    }
}

// Every frame is the whole book, so it replaces the book and a lost frame heals on the next one.
// An unchanged book is sent again about once a second, which says the book was still current at that tick.
// publish_id rises by one per frame of a book, and no rule here needs it.
fn apply_book(data: &BookData, conn: &mut Connection<()>) {
    let Some(position) = conn.position(&data.instrument_name) else {
        return;
    };
    conn.reset_book(position, &data.bids, &data.asks);
}

// "ticker_slim.BTC-PERP.1000" names "BTC-PERP", since the ticker's data carries no name.
fn ticker_market(channel: &str) -> Option<&str> {
    channel.strip_prefix(TICKER_PREFIX)?.strip_suffix(TICKER_SUFFIX)
}

fn preview(frame: &[u8]) -> Cow<'_, str> {
    String::from_utf8_lossy(&frame[..frame.len().min(PREVIEW_BYTES)])
}

// Pushes carry params, a subscribe reply carries result, and an error carries error.
#[derive(Deserialize)]
struct Envelope<'a> {
    #[serde(borrow)]
    params: Option<Channel<'a>>,
    result: Option<Subscribed>,
    error: Option<RpcError>,
}

#[derive(Deserialize)]
struct Channel<'a> {
    #[serde(borrow)]
    channel: Option<Cow<'a, str>>, // "orderbook.BTC-PERP.1.20" or "ticker_slim.BTC-PERP.1000"
}

#[derive(Deserialize)]
struct Subscribed {
    #[serde(default)]
    status: HashMap<String, String>, // channel to "ok", "already subscribed" or the reason it was refused
}

// {"code":-32602,"message":"Invalid params","data":"`ticker` channel has been deprecated. ..."}
#[derive(Deserialize)]
struct RpcError {
    #[serde(default)]
    code: i64,
    message: Option<String>,
    data: Option<String>,
}

#[derive(Deserialize)]
struct Push<T> {
    params: Params<T>,
}

#[derive(Deserialize)]
struct Params<T> {
    data: T,
}

#[derive(Deserialize)]
struct BookData<'a> {
    #[serde(borrow)]
    instrument_name: Cow<'a, str>, // "BTC-PERP", spelled as subscribed
    #[serde(deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // [price, amount] strings, amounts in base coins, best first
    #[serde(deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
}

#[derive(Deserialize)]
struct TickerData {
    instrument_ticker: Ticker,
}

#[derive(Deserialize)]
struct Ticker {
    #[serde(rename = "I", default = "wire::nan", deserialize_with = "wire::num")]
    index: f64, // Block Scholes' signed spot price of the base in USD
    #[serde(rename = "M", default = "wire::nan", deserialize_with = "wire::num")]
    mark: f64, // spot plus a 30-minute TWAP of the perpetual's basis, clamped to 6 % of spot
    #[serde(rename = "f", default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // the rate accruing now, per hour
}
