mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use anchor::Funding;
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "bitstamp";

const REST: &str = "https://www.bitstamp.net";

// One address carries every spot and perpetual market.
const PUBLIC_URL: &str = "wss://ws.bitstamp.net";

// A whole book of up to 100 levels a side on every change, with no sequence and no snapshot on subscribe.
const CHANNEL_PREFIX: &str = "order_book_";

const MARKETS_PER_CONNECTION: usize = 1_000; // a 1,025th subscription closes the connection with no error

pub struct Bitstamp {
    rest: String,
    markets: Vec<String>, // tracked raw ids, which the funding reads walk one per round
    funding: Mutex<Funding>,
}

impl Bitstamp {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(markets, REST)
    }

    fn with_rest(markets: &[TrackedMarket], rest: &str) -> Self {
        Self {
            rest: rest.to_string(),
            markets: markets.iter().map(|tracked| tracked.market.raw_market_id.clone()).collect(),
            funding: Mutex::new(Funding::default()),
        }
    }
}

impl BookVenue for Bitstamp {
    type State = HashMap<usize, i64>; // microtimestamp of the last frame applied, by position

    // A quiet book stayed silent for 49 s, so the heartbeat answer is what keeps the silence check fed.
    // The first book is the next change, which took up to 49 s on a quiet market.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(20)),
            first_book_wait: Duration::from_secs(60),
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

    // One channel per frame, and a client frame over 512 bytes closes the socket with code 1009.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for market in markets {
            let channel = format!("{CHANNEL_PREFIX}{}", market.raw_market_id);
            let frame = serde_json::json!({ "event": "bts:subscribe", "data": { "channel": channel } });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text(r#"{"event":"bts:heartbeat"}"#)
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(frame)?;
        let event = frame.event.as_deref();

        if event == Some("data")
            && let Some(raw_market_id) = frame.channel.as_deref().and_then(|channel| channel.strip_prefix(CHANNEL_PREFIX))
            && let Some(data) = &frame.data
            && let Some(microtimestamp) = &data.microtimestamp
        {
            apply_book(raw_market_id, microtimestamp, &data.bids, &data.asks, conn);
            return Ok(());
        }

        match event {
            // The venue gives a few seconds before it drops the connection, and the next one starts from fresh books.
            Some("bts:request_reconnect") => conn.resync("connection", "reconnect_requested"),
            Some("bts:error") => {
                let data = frame.data.as_ref();
                let code = data.and_then(|data| data.code).map_or("none".to_string(), |code| code.to_string());
                tracing::error!(
                    event = "venue_error",
                    connection = conn.id(),
                    code,
                    message = data.and_then(|data| data.message.as_deref()).unwrap_or(""),
                );
            }
            _ => {}
        }

        Ok(())
    }
}

fn apply_book(raw_market_id: &str, microtimestamp: &str, bids: &[BookLevel], asks: &[BookLevel], conn: &mut Connection<HashMap<usize, i64>>) {
    let Some(position) = conn.position(raw_market_id) else {
        return;
    };

    // Never seen on the wire, and an older whole book would rewind the one applied.
    let Ok(microtimestamp) = microtimestamp.parse::<i64>() else {
        return;
    };
    if microtimestamp <= conn.state.get(&position).copied().unwrap_or(0) {
        return;
    }

    conn.state.insert(position, microtimestamp);
    conn.reset_book(position, bids, asks);
}

// Book data, acknowledgements, heartbeat answers, errors and the reconnect request all share the socket.
#[derive(Deserialize)]
struct Frame<'a> {
    event: Option<String>, // "data", "bts:subscription_succeeded", "bts:heartbeat", "bts:error" or "bts:request_reconnect"
    #[serde(borrow)]
    channel: Option<Cow<'a, str>>, // "order_book_btcusd-perp", "" on session frames
    #[serde(borrow)]
    data: Option<BookData<'a>>, // null on the reconnect request
}

#[derive(Deserialize)]
struct BookData<'a> {
    #[serde(borrow)]
    microtimestamp: Option<Cow<'a, str>>, // Unix microseconds as a 16 digit string
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // the whole side up to 100 levels, best first
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
    code: Option<i64>, // on bts:error, null or 4009
    message: Option<String>,
}
