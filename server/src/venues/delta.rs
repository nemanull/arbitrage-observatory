mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use anchor::Intervals;
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "delta";

const REST: &str = "https://api.delta.exchange";

// The compact channel names, the format the India twin of this URL documents.
// The legacy l2_updates on wss://socket.delta.exchange is the same feed with longer keys.
const PUBLIC_URL: &str = "wss://public-socket.delta.exchange";

// The whole book on subscribe, at 20 to 51 levels, then changed levels chained by seq.
// No channel takes a depth, so the book is as deep as the venue sends it.
const CHANNEL: &str = "ob_updates";
const BOOK_KEY: &[u8] = b"\"ob_updates\"";

// The channel refuses a socket's 102nd symbol.
const MARKETS_PER_CONNECTION: usize = 100;

pub struct Delta {
    rest: String,
    intervals: Mutex<Intervals>,
}

impl Delta {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self {
            rest: rest.to_string(),
            intervals: Mutex::new(Intervals::default()),
        }
    }
}

impl BookVenue for Delta {
    type State = HashMap<usize, i64>; // `seq` of the last frame applied, by position

    // The server closes a socket after 60 s with no client activity, and a quiet PAXGUSDT book went 15 s without an update.
    // The pong answers a ping in about 100 ms, so three missed pongs end the socket before the server does.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(15)),
            ..FeedSettings::new(Duration::from_secs(45))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#perp#{i}"),
                url: PUBLIC_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // One frame carries every symbol, and one acknowledgement answers it.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut symbols = Vec::with_capacity(markets.len());
        for market in markets {
            symbols.push(market.raw_market_id.as_str());
        }
        let frame = serde_json::json!({
            "type": "subscribe",
            "payload": { "channels": [{ "name": CHANNEL, "symbols": symbols }] },
        });
        vec![Message::text(frame.to_string())]
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text(r#"{"type":"ping"}"#)
    }

    fn handle(&self, bytes: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = match serde_json::from_slice(bytes) {
            Ok(frame) => frame,
            Err(error) => {
                // The sequence of the next frame would show the loss, and resyncing now saves the wait.
                if bytes.windows(BOOK_KEY.len()).any(|window| window == BOOK_KEY) {
                    conn.resync("connection", "book_frame_unreadable");
                }
                return Err(error.into());
            }
        };

        match frame.kind.as_ref() {
            CHANNEL => apply_book(&frame, conn),
            // A refused channel sits beside the accepted ones in the acknowledgement.
            "subscriptions" => {
                for channel in &frame.channels {
                    if let Some(error) = &channel.error {
                        tracing::error!(
                            event = "venue_error",
                            connection = conn.id(),
                            channel = channel.name.as_str(),
                            message = error.as_str(),
                        );
                    }
                }
            }
            // A subscribe frame whose channel list is not an array is refused as a whole.
            "error" => {
                tracing::error!(
                    event = "venue_error",
                    connection = conn.id(),
                    channel = CHANNEL,
                    message = frame.message.as_deref().unwrap_or(""),
                );
            }
            _ => {} // "pong", and "heartbeat" if a heartbeat is ever enabled
        }

        Ok(())
    }
}

// The docs ask for a resubscribe on a gap, which the runtime's reconnect does for every book on the socket.
fn apply_book(frame: &Frame, conn: &mut Connection<HashMap<usize, i64>>) {
    let raw_market_id = frame.symbol.as_deref().unwrap_or("");

    // The docs name an error action sent in place of a snapshot that failed, and ask for a resubscribe a few seconds later.
    // It is handled before the symbol lookup, so a frame that names no known symbol still resyncs.
    if frame.action.as_deref() == Some("error") {
        tracing::error!(
            event = "venue_error",
            connection = conn.id(),
            channel = CHANNEL,
            market = raw_market_id,
            message = frame.message.as_deref().unwrap_or(""),
        );
        conn.resync(raw_market_id, "venue_book_error");
        return;
    }

    let Some(position) = conn.position(raw_market_id) else {
        return;
    };
    let seq = frame.seq.unwrap_or(0);

    match frame.action.as_deref() {
        Some("snapshot") => {
            conn.state.insert(position, seq);
            conn.reset_book(position, &frame.bids, &frame.asks);
            return;
        }
        Some("update") => {}
        _ => {
            conn.resync(raw_market_id, "unknown_book_action");
            return;
        }
    }

    let Some(&last) = conn.state.get(&position) else {
        conn.resync(raw_market_id, "delta_before_snapshot");
        return;
    };
    if seq != last + 1 {
        conn.resync(raw_market_id, "sequence_gap");
        return;
    }
    conn.state.insert(position, seq);

    let Some(book) = conn.book(position) else {
        conn.resync(raw_market_id, "delta_before_snapshot");
        return;
    };
    let mut readable = true;
    for level in &frame.bids {
        readable &= book.set_bid(level.price, level.size);
    }
    for level in &frame.asks {
        readable &= book.set_ask(level.price, level.size);
    }
    if !readable {
        conn.resync(raw_market_id, "level_unreadable");
        return;
    }
    conn.publish(position);
}

// Books, acknowledgements, pongs and errors share the envelope, so only the type is sure to be present.
// The cs checksum is not read, since decision 21 verifies a checksum only on a channel with no sequence.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(rename = "type", borrow)]
    kind: Cow<'a, str>, // "ob_updates", "subscriptions", "error", "pong"
    #[serde(borrow)]
    action: Option<Cow<'a, str>>, // "snapshot", "update" or "error"
    #[serde(rename = "sy", alias = "symbol", borrow)]
    symbol: Option<Cow<'a, str>>, // "BTCUSDT", the catalog's id, and the docs spell it symbol on the error action
    seq: Option<i64>,
    #[serde(rename = "b", default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // contracts, a size of "0" deletes the level
    #[serde(rename = "a", default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
    #[serde(default)]
    channels: Vec<Channel>,
    #[serde(alias = "msg")]
    message: Option<String>,
}

#[derive(Deserialize)]
struct Channel {
    #[serde(default)]
    name: String,
    error: Option<String>, // "subscription forbidden on this invalid channel"
}
