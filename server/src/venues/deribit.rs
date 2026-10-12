mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::anchor_poller::RateLimited;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use serde::de::IgnoredAny;
use std::borrow::Cow;
use std::collections::{HashMap, HashSet};
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "deribit";

const REST: &str = "https://www.deribit.com/api/v2";

// One address carries every family, and the venue allows 32 sockets per IP.
const WS_URL: &str = "wss://www.deribit.com/ws/api/v2";

// Every level, a snapshot on subscribe, then deltas chained by prev_change_id, and no authorisation needed at 100 ms.
// The grouped 20 level channel resends its window with no chain, so a frame the server drops would go unseen.
const BOOK_INTERVAL: &str = "100ms";

// 131 books ran on one socket with no gap on 2026-09-22, but a gap reopens the socket and resnapshots every book on it.
// So the books are spread over a few sockets, each well under the 500 channels of one subscribe call.
const MARKETS_PER_CONNECTION: usize = 50;

// The server sends a test_request every 10 s and closes the socket 10 s after one goes unanswered.
const HEARTBEAT_SECONDS: u32 = 10;
const HEARTBEAT_ID: u64 = 1;
const SUBSCRIBE_ID: u64 = 2;

const ACK_SAMPLE: usize = 3;

pub struct Deribit {
    rest: String,
    currencies: Vec<String>, // the settlement currencies of the tracked markets, one summary call each
    anchors: Mutex<anchor::AnchorState>,
}

impl Deribit {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(markets, REST)
    }

    fn with_rest(markets: &[TrackedMarket], rest: &str) -> Self {
        // A linear perpetual settles in its quote.
        let mut currencies: Vec<String> = Vec::new();
        for tracked in markets {
            if !currencies.contains(&tracked.market.quote) {
                currencies.push(tracked.market.quote.clone());
            }
        }

        Self {
            rest: rest.to_string(),
            currencies,
            anchors: Mutex::new(anchor::AnchorState::default()),
        }
    }
}

#[derive(Default)]
pub struct State {
    last: HashMap<usize, i64>, // change_id of the last frame applied, by position
    requested: Vec<String>,    // the channels of the subscribe call, checked against its acknowledgement
    next_id: u64,
}

impl BookVenue for Deribit {
    type State = State;

    // A test_request arrives every 10.6 s, so three missed is a dead socket, while a still book went 53.6 s without a frame.
    // The server's own test_request is the traffic the silence check relies on, so no client ping is sent.
    fn settings(&self) -> FeedSettings {
        FeedSettings::new(Duration::from_secs(35))
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#perp#{i}"),
                url: WS_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // The heartbeat goes first, then one call with every book of the slice, since subscribe calls are limited to about 3 a second.
    fn subscribe_frames(&self, markets: &[Market], state: &mut Self::State) -> Vec<Message> {
        state.requested.clear();
        for market in markets {
            state.requested.push(format!("book.{}.{BOOK_INTERVAL}", market.raw_market_id));
        }
        state.next_id = SUBSCRIBE_ID + 1;

        let heartbeat = serde_json::json!({
            "jsonrpc": "2.0", "id": HEARTBEAT_ID, "method": "public/set_heartbeat", "params": { "interval": HEARTBEAT_SECONDS },
        });
        let subscribe = serde_json::json!({
            "jsonrpc": "2.0", "id": SUBSCRIBE_ID, "method": "public/subscribe", "params": { "channels": state.requested },
        });
        vec![Message::text(heartbeat.to_string()), Message::text(subscribe.to_string())]
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(frame)?;

        if let Some(params) = &frame.params {
            match frame.method.as_deref() {
                Some("subscription") => {
                    if let Some(book) = &params.data
                        && params.channel.as_deref().is_some_and(|channel| channel.starts_with("book."))
                    {
                        apply_book(book, conn);
                    }
                }
                // The server closes the socket 10 s after a test_request that gets no public/test.
                Some("heartbeat") if params.kind.as_deref() == Some("test_request") => {
                    let id = conn.state.next_id;
                    conn.state.next_id += 1;
                    let answer = serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": "public/test", "params": {} });
                    conn.send(Message::text(answer.to_string()));
                }
                _ => {}
            }
            return Ok(());
        }

        if let Some(error) = &frame.error {
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                id = frame.id.unwrap_or(0),
                code = error.code,
                message = error.message.as_str(),
                data = error.data.as_ref().map(|data| data.to_string()).unwrap_or_default(),
            );
            return Ok(());
        }

        // An unknown or malformed channel is left out of the acknowledgement with no error, so it is checked here.
        if frame.id == Some(SUBSCRIBE_ID)
            && let Some(serde_json::Value::Array(acknowledged)) = &frame.result
        {
            check_acknowledgement(acknowledged, conn);
        }

        Ok(())
    }
}

fn apply_book(data: &BookData, conn: &mut Connection<State>) {
    let Some(position) = conn.position(&data.instrument_name) else {
        return;
    };

    // A snapshot replaces the book whenever it comes.
    if data.kind == "snapshot" {
        conn.state.last.insert(position, data.change_id);
        let bids: Vec<BookLevel> = data.bids.iter().map(Entry::level).collect();
        let asks: Vec<BookLevel> = data.asks.iter().map(Entry::level).collect();
        conn.reset_book(position, &bids, &asks);
        return;
    }

    // The chain and the book are set together by a snapshot and cleared together by a reconnect.
    let Some(&last) = conn.state.last.get(&position) else {
        conn.resync(&data.instrument_name, "delta_before_snapshot");
        return;
    };

    // change_id is one counter shared by many instruments, so only prev_change_id links a delta to the frame before it.
    if data.prev_change_id != Some(last) {
        conn.resync(&data.instrument_name, "sequence_gap");
        return;
    }
    conn.state.last.insert(position, data.change_id);

    if data.bids.is_empty() && data.asks.is_empty() {
        return;
    }

    let Some(book) = conn.book(position) else {
        return;
    };
    // The action word is redundant, since a delete carries an amount of 0.
    for entry in &data.bids {
        book.set_bid(entry.1, entry.2);
    }
    for entry in &data.asks {
        book.set_ask(entry.1, entry.2);
    }
    conn.publish(position);
}

fn check_acknowledgement(acknowledged: &[serde_json::Value], conn: &mut Connection<State>) {
    let mut granted = HashSet::with_capacity(acknowledged.len());
    for channel in acknowledged {
        if let Some(channel) = channel.as_str() {
            granted.insert(channel);
        }
    }

    let mut missing = Vec::new();
    for channel in &conn.state.requested {
        if !granted.contains(channel.as_str()) {
            missing.push(channel.as_str());
        }
    }

    if !missing.is_empty() {
        tracing::warn!(
            event = "channels_unacknowledged",
            connection = conn.id(),
            missing = missing.len(),
            requested = conn.state.requested.len(),
            sample = ?&missing[..missing.len().min(ACK_SAMPLE)],
        );
    }
}

// The JSON-RPC envelope of every REST reply, which carries either a result or an error.
#[derive(Deserialize)]
struct Reply<T> {
    result: Option<T>,
    error: Option<RpcError>,
}

impl<T> Reply<T> {
    // Code 10028 is the venue's rate limit answer, after which it may end the session.
    fn into_result(self, call: &str) -> anyhow::Result<T> {
        if let Some(error) = self.error {
            if error.code == 10028 {
                return Err(RateLimited {
                    url: call.to_string(),
                    reason: format!("code {}", error.code),
                    retry_after: None,
                }
                .into());
            }
            anyhow::bail!("{call}: code {}: {}", error.code, error.message);
        }
        self.result.ok_or_else(|| anyhow::anyhow!("{call}: reply has no result"))
    }
}

#[derive(Deserialize)]
struct RpcError {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    message: String,
    data: Option<serde_json::Value>, // {"reason":"instrument not found","param":"instrument_name"}
}

// Notifications, replies and errors share the envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    id: Option<u64>, // absent on a notification and on the reply to text that is not JSON
    #[serde(borrow)]
    method: Option<Cow<'a, str>>, // "subscription" or "heartbeat" on a notification
    #[serde(borrow)]
    params: Option<Params<'a>>,
    result: Option<serde_json::Value>, // the acknowledged channels, "ok" or {"version"}
    error: Option<RpcError>,
}

#[derive(Deserialize)]
struct Params<'a> {
    #[serde(borrow)]
    channel: Option<Cow<'a, str>>, // "book.BTC_USDC-PERPETUAL.100ms"
    #[serde(borrow)]
    data: Option<BookData<'a>>,
    #[serde(borrow, rename = "type")]
    kind: Option<Cow<'a, str>>, // "test_request" or "heartbeat" on a heartbeat
}

#[derive(Deserialize)]
struct BookData<'a> {
    #[serde(borrow, rename = "type")]
    kind: Cow<'a, str>, // "snapshot" or "change"
    #[serde(borrow)]
    instrument_name: Cow<'a, str>,
    change_id: i64,
    prev_change_id: Option<i64>, // on a change
    #[serde(default)]
    bids: Vec<Entry>, // base coins on a linear perpetual, best first
    #[serde(default)]
    asks: Vec<Entry>,
}

// ["new", 228.51, 0.22], where the action is "new", "change" or "delete" and a delete carries 0.
#[derive(Deserialize)]
struct Entry(IgnoredAny, f64, f64);

impl Entry {
    fn level(&self) -> BookLevel {
        BookLevel { price: self.1, size: self.2 }
    }
}
