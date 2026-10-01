mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use std::collections::{HashMap, HashSet};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "coinbase";

// The anchor reads the International Exchange list, where the -INTX perpetuals trade.
const INTX_REST: &str = "https://api.international.coinbase.com";
const ADVANCED_REST: &str = "https://api.coinbase.com";

// Coinbase Advanced serves the perpetual books without credentials.
// The International Exchange socket closes every connection from this host with code 3003 before it reads a subscribe frame.
const PUBLIC_URL: &str = "wss://advanced-trade-ws.coinbase.com";

const LEVEL2_CHANNEL: &str = "level2"; // what we subscribe
const L2_DATA_CHANNEL: &str = "l2_data"; // what the data frames say
const HEARTBEATS_CHANNEL: &str = "heartbeats";
const SUBSCRIPTIONS_CHANNEL: &str = "subscriptions";

// level2 refuses more than about 30 products per connection with "too many L2 streams requested in a single session".
const MARKETS_PER_CONNECTION: usize = 30;
const PRODUCTS_PER_FRAME: usize = 30;

const MISSING_SAMPLE: usize = 3;

pub struct Coinbase {
    rest: String,
}

impl Coinbase {
    pub fn new() -> Self {
        Self::with_rest(INTX_REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self { rest: rest.to_string() }
    }
}

impl BookVenue for Coinbase {
    // The last sequence_num, one counter per connection across every channel.
    // The documentation scopes it by product and the wire does not, so a gap is the whole connection's problem.
    type State = Option<i64>;

    // The heartbeats subscription is the keepalive, and it also stops a quiet product's subscription from being closed.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            connect_stagger: Duration::from_millis(300), // 8 client messages a second per IP, and every connection sends two
            reconnect_jitter: Duration::from_millis(1_500),
            ..FeedSettings::new(Duration::from_secs(15))
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

    // level2 goes first on purpose, because every acknowledgement lists the whole subscription set and the check reads its level2 list.
    // Subscribing heartbeats first would produce one acknowledgement with no level2 key, which reads as every product refused.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::new();
        for slice in markets.chunks(PRODUCTS_PER_FRAME) {
            let mut product_ids = Vec::with_capacity(slice.len());
            for market in slice {
                product_ids.push(market.raw_market_id.as_str());
            }
            let frame = serde_json::json!({ "type": "subscribe", "channel": LEVEL2_CHANNEL, "product_ids": product_ids });
            frames.push(Message::text(frame.to_string()));
        }

        let heartbeats = serde_json::json!({ "type": "subscribe", "channel": HEARTBEATS_CHANNEL });
        frames.push(Message::text(heartbeats.to_string()));
        frames
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(frame)?;

        if let Some(sequence) = frame.sequence_num {
            let last = conn.state.replace(sequence);
            if last.is_some_and(|last| sequence != last + 1) {
                conn.resync("connection", "sequence_gap");
                return Ok(());
            }
        }

        match frame.channel {
            Some(L2_DATA_CHANNEL) => apply_events(&frame.events, conn),
            Some(HEARTBEATS_CHANNEL) => {}
            Some(SUBSCRIPTIONS_CHANNEL) => check_subscriptions(&frame.events, conn),
            _ => {
                if frame.kind.as_deref() == Some("error") {
                    tracing::error!(
                        event = "venue_error",
                        connection = conn.id(),
                        message = frame.message.as_deref().unwrap_or("error"),
                    );
                }
            }
        }

        Ok(())
    }
}

fn apply_events(events: &[Event], conn: &mut Connection<Option<i64>>) {
    for event in events {
        let Some(product_id) = event.product_id else {
            continue;
        };
        let Some(position) = conn.position(product_id) else {
            continue;
        };

        // The snapshot is the whole book as updates, in no promised order.
        if event.kind == Some("snapshot") {
            let mut bids = Vec::new();
            let mut asks = Vec::new();
            for update in &event.updates {
                let level = BookLevel {
                    price: update.price_level,
                    size: update.new_quantity,
                };
                if update.side == Some("bid") {
                    bids.push(level);
                } else {
                    asks.push(level);
                }
            }
            conn.reset_book(position, &bids, &asks);
            continue;
        }

        let Some(book) = conn.book(position) else {
            conn.resync(product_id, "update_before_snapshot");
            return;
        };

        // A new_quantity of 0 removes the level, and the ask side is spelled offer.
        for update in &event.updates {
            if update.side == Some("bid") {
                book.set_bid(update.price_level, update.new_quantity);
            } else {
                book.set_ask(update.price_level, update.new_quantity);
            }
        }
        conn.publish(position);
    }
}

fn check_subscriptions(events: &[Event], conn: &mut Connection<Option<i64>>) {
    let mut acknowledged = HashSet::new();
    if let Some(level2) = events.first().and_then(|event| event.subscriptions.as_ref()).and_then(|s| s.get(LEVEL2_CHANNEL)) {
        for product_id in level2 {
            acknowledged.insert(product_id.as_str());
        }
    }

    let mut missing = Vec::new();
    for market in conn.markets() {
        if !acknowledged.contains(market.raw_market_id.as_str()) {
            missing.push(market.raw_market_id.as_str());
        }
    }

    if missing.is_empty() {
        return;
    }

    tracing::warn!(
        event = "subscription_missing",
        connection = conn.id(),
        missing = missing.len(),
        markets = conn.markets().len(),
        sample = ?&missing[..missing.len().min(MISSING_SAMPLE)],
    );
}

#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    channel: Option<&'a str>, // "l2_data", "heartbeats" or "subscriptions"
    sequence_num: Option<i64>,
    #[serde(default, borrow)]
    events: Vec<Event<'a>>,
    #[serde(rename = "type")]
    kind: Option<String>, // "error", the only frame shape that carries no channel
    message: Option<String>,
}

#[derive(Deserialize)]
struct Event<'a> {
    #[serde(rename = "type", borrow)]
    kind: Option<&'a str>, // "snapshot" or "update"
    #[serde(borrow)]
    product_id: Option<&'a str>, // "BTC-PERP-INTX"
    #[serde(default, borrow)]
    updates: Vec<Update<'a>>,
    subscriptions: Option<HashMap<String, Vec<String>>>, // the connection's whole set per channel
}

#[derive(Deserialize)]
struct Update<'a> {
    #[serde(borrow)]
    side: Option<&'a str>, // "bid" or "offer"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    price_level: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    new_quantity: f64,
}
