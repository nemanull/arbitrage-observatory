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
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::OnceLock;
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "cryptocom";

const REST: &str = "https://api.crypto.com/exchange/v1";

// One address carries every product, books and the anchor channels alike.
const MARKET_URL: &str = "wss://stream.crypto.com/exchange/v1/market";

// Fifty levels, a snapshot on subscribe, then deltas every 10 ms chained by `pu`.
// Depth 20 is refused, so 50 is the smallest depth of at least 20.
const DEPTH: u32 = 50;
const BOOK_UPDATE_FREQUENCY_MS: u32 = 10;

// The 401st channel on a socket is refused with 40107, and each market takes its book, mark, index and funding channels.
const CHANNELS_PER_CONNECTION: usize = 400;
const CHANNELS_PER_MARKET: usize = 4;
const MARKETS_PER_CONNECTION: usize = CHANNELS_PER_CONNECTION / CHANNELS_PER_MARKET;

// A frame of 100 channels was accepted, and the documented limit is 100 requests a second per connection.
const CHANNELS_PER_FRAME: usize = 100;

// The index channel names the market's underlying_symbol, which is the raw id with this suffix in place of -PERP.
const PERP_SUFFIX: &str = "-PERP";
const INDEX_SUFFIX: &str = "-INDEX";

pub struct Cryptocom {
    anchors: SocketAnchors, // filled by handle, read by fetch_round
    tracked: usize,         // markets on the book sockets, which fetch_round waits for at boot
    first_round: OnceLock<Instant>,
}

impl Cryptocom {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self {
            anchors: SocketAnchors::new(true),
            tracked: markets.len(),
            first_round: OnceLock::new(),
        }
    }
}

impl BookVenue for Cryptocom {
    type State = HashMap<usize, u64>; // `u` of the last book frame applied, by position

    // The server pings every 5 s and a quiet book sends an empty delta every 5 s, so 15 s of silence is a dead socket.
    // The venue answers its own public/heartbeat, so no client ping is needed.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            subscribe_gap: Duration::from_millis(250),
            ..FeedSettings::new(Duration::from_secs(15))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#perp#{i}"),
                url: MARKET_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // The book frames carry the book parameters, and the anchor frames go after them, one kind per frame.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::new();
        let mut id: u64 = 1;

        for slice in markets.chunks(CHANNELS_PER_FRAME) {
            let channels: Vec<String> = slice.iter().map(|m| format!("book.{}.{DEPTH}", m.raw_market_id)).collect();
            let params = serde_json::json!({
                "channels": channels,
                "book_subscription_type": "SNAPSHOT_AND_UPDATE",
                "book_update_frequency": BOOK_UPDATE_FREQUENCY_MS,
            });
            frames.push(subscribe(id, params));
            id += 1;
        }

        let kinds: [fn(&str) -> String; 3] = [
            |raw| format!("mark.{raw}"),
            |raw| format!("index.{}", index_name(raw)),
            |raw| format!("funding.{raw}"),
        ];
        for channel in kinds {
            for slice in markets.chunks(CHANNELS_PER_FRAME) {
                let channels: Vec<String> = slice.iter().map(|m| channel(&m.raw_market_id)).collect();
                frames.push(subscribe(id, serde_json::json!({ "channels": channels })));
                id += 1;
            }
        }

        frames
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let at = conn.frame_recv_ts();
        self.handle_at(frame, conn, at)
    }
}

impl Cryptocom {
    // `at` is the frame's arrival, which stamps the anchor fields it carries.
    fn handle_at(&self, frame: &[u8], conn: &mut Connection<HashMap<usize, u64>>, at: i64) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(frame)?;

        // The venue closes a socket at the third heartbeat left unanswered.
        if frame.method.as_deref() == Some("public/heartbeat") {
            let answer = serde_json::json!({ "id": frame.id, "method": "public/respond-heartbeat" });
            conn.send(Message::text(answer.to_string()));
            return Ok(());
        }

        if frame.code != 0 {
            // The profile saw each error reply eight times on 2026-09-22, and the capture of 2026-10-08 saw each once.
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                id = frame.id,
                code = frame.code,
                channel = frame.channel.as_deref().unwrap_or(""),
                message = frame.message.as_deref().unwrap_or(""),
            );
            return Ok(());
        }

        // A bare acknowledgement of a book channel carries no result.
        let Some(result) = frame.result else {
            return Ok(());
        };

        // Every capture held one entry in data, and a frame that held several is read in order up to the first break in the chain.
        for data in &result.data {
            match result.channel.as_ref() {
                "book" => apply_snapshot(&result.instrument_name, data, conn),
                "book.update" => {
                    if !apply_delta(&result.instrument_name, data, conn) {
                        break;
                    }
                }
                "mark" => self.anchors.set_mark(&result.instrument_name, data.v, at),
                "index" => {
                    if let Some(raw) = raw_of_index(&result.instrument_name) {
                        self.anchors.set_index(&raw, data.v, at);
                    }
                }
                // The interval is always one hour, and fetch_round sets the next settlement from the clock.
                "funding" => self.anchors.set_funding(&result.instrument_name, data.v, 1.0, 0),
                _ => {}
            }
        }

        Ok(())
    }
}

fn subscribe(id: u64, params: serde_json::Value) -> Message {
    let frame = serde_json::json!({ "id": id, "method": "subscribe", "params": params, "nonce": now_ms() });
    Message::text(frame.to_string())
}

fn apply_snapshot(instrument: &str, data: &Data, conn: &mut Connection<HashMap<usize, u64>>) {
    let Some(position) = conn.position(instrument) else {
        return;
    };

    conn.state.insert(position, data.u);
    conn.reset_book(position, &data.bids, &data.asks);
}

// Returns false when the delta broke the chain, so nothing after it in the frame is applied.
fn apply_delta(instrument: &str, data: &Data, conn: &mut Connection<HashMap<usize, u64>>) -> bool {
    let Some(position) = conn.position(instrument) else {
        return true;
    };

    let Some(&last) = conn.state.get(&position) else {
        conn.resync(instrument, "delta_before_snapshot");
        return false;
    };
    if conn.book(position).is_none() {
        conn.resync(instrument, "delta_before_snapshot");
        return false;
    }

    // `u` jumps by 10^4 to 10^6, so only `pu` links a delta to the frame before it.
    if data.pu != Some(last) {
        conn.resync(instrument, "sequence_gap");
        return false;
    }
    conn.state.insert(position, data.u);

    // The idle delta every 5 s on a quiet book has no levels and only moves the chain.
    let Some(update) = &data.update else {
        return true;
    };
    if update.bids.is_empty() && update.asks.is_empty() {
        return true;
    }

    let Some(book) = conn.book(position) else {
        return true;
    };
    for level in &update.bids {
        book.set_bid(level.price, level.size);
    }
    for level in &update.asks {
        book.set_ask(level.price, level.size);
    }
    conn.publish(position);
    true
}

// "BTCUSD-PERP" becomes "BTCUSD-INDEX".
// The loader keeps only markets whose underlying_symbol follows this rule.
fn index_name(raw_market_id: &str) -> String {
    let stem = raw_market_id.strip_suffix(PERP_SUFFIX).unwrap_or(raw_market_id);
    format!("{stem}{INDEX_SUFFIX}")
}

fn raw_of_index(index: &str) -> Option<String> {
    let stem = index.strip_suffix(INDEX_SUFFIX)?;
    Some(format!("{stem}{PERP_SUFFIX}"))
}

// Data, acknowledgements, heartbeats and errors share the envelope, so little here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(default)]
    id: i64, // -1 on a data push, the request id on an ack, the server clock in ms on a heartbeat
    #[serde(borrow)]
    method: Option<Cow<'a, str>>, // "subscribe" or "public/heartbeat"
    #[serde(default)]
    code: i64,
    message: Option<String>,
    channel: Option<String>, // on a book ack and on an error
    #[serde(borrow)]
    result: Option<Push<'a>>,
}

#[derive(Deserialize)]
struct Push<'a> {
    #[serde(borrow)]
    instrument_name: Cow<'a, str>, // "BTCUSD-PERP", or "BTCUSD-INDEX" on the index channel
    #[serde(borrow)]
    channel: Cow<'a, str>, // "book", "book.update", "mark", "index" or "funding"
    #[serde(default)]
    data: Vec<Data>,
}

#[derive(Deserialize)]
struct Data {
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // [price, size, count] strings in base coins, on a snapshot
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
    update: Option<Update>, // on a delta
    #[serde(default)]
    u: u64,
    pu: Option<u64>, // on a delta
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    v: f64, // the value on mark, index and funding, a decimal string
}

#[derive(Deserialize)]
struct Update {
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // a size of "0" deletes the level
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
}
