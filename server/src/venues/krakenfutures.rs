mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "krakenfutures";

const REST: &str = "https://futures.kraken.com";

const PUBLIC_URL: &str = "wss://futures.kraken.com/ws/v1";

// The whole book on subscribe, then one level per delta.
// Kraken has no depth parameter and does not compress.
const FEED: &str = "book";
const SNAPSHOT_FEED: &str = "book_snapshot";

const MARKETS_PER_CONNECTION: usize = 100; // kraken allows 200 symbols a connection
const PRODUCTS_PER_FRAME: usize = 100;

pub struct KrakenFutures {
    rest: String,
}

impl KrakenFutures {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self { rest: rest.to_string() }
    }
}

impl BookVenue for KrakenFutures {
    type State = HashMap<usize, i64>; // `seq` of the last frame applied, by position, since kraken counts per product

    fn settings(&self) -> FeedSettings {
        // Kraken documents a 60 s ping requirement and does not enforce it, so a protocol ping every 20 s keeps a threefold margin.
        FeedSettings {
            ping_every: Some(Duration::from_secs(20)),
            ..FeedSettings::new(Duration::from_secs(30))
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

    // Kraken names the feed once and passes the symbols as an array, where every other venue repeats the channel per symbol.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::new();
        for slice in markets.chunks(PRODUCTS_PER_FRAME) {
            let mut product_ids = Vec::with_capacity(slice.len());
            for market in slice {
                product_ids.push(market.raw_market_id.as_str());
            }
            let frame = serde_json::json!({ "event": "subscribe", "feed": FEED, "product_ids": product_ids });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(frame)?;

        if let Some(product_id) = frame.product_id {
            match frame.feed {
                Some(SNAPSHOT_FEED) => {
                    apply_snapshot(product_id, &frame, conn);
                    return Ok(());
                }
                Some(FEED) => {
                    apply_delta(product_id, &frame, conn);
                    return Ok(());
                }
                _ => {}
            }
        }

        // An alert is every error kraken sends, and it names the offending product in its text.
        if frame.event.as_deref() == Some("alert") {
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                message = frame.message.as_deref().unwrap_or("alert"),
            );
        }

        Ok(())
    }
}

fn apply_snapshot(product_id: &str, frame: &Frame, conn: &mut Connection<HashMap<usize, i64>>) {
    let Some(position) = conn.position(product_id) else {
        return;
    };

    conn.state.insert(position, frame.seq.unwrap_or(0));
    conn.reset_book(position, &book_levels(&frame.bids), &book_levels(&frame.asks));
}

fn apply_delta(product_id: &str, frame: &Frame, conn: &mut Connection<HashMap<usize, i64>>) {
    let Some(position) = conn.position(product_id) else {
        return;
    };

    let Some(&last) = conn.state.get(&position) else {
        conn.resync(product_id, "delta_before_snapshot");
        return;
    };
    if conn.book(position).is_none() {
        conn.resync(product_id, "delta_before_snapshot");
        return;
    }

    if frame.seq != Some(last + 1) {
        conn.resync(product_id, "sequence_gap");
        return;
    }
    conn.state.insert(position, last + 1);

    let Some(book) = conn.book(position) else {
        return;
    };
    if frame.side == Some("buy") {
        book.set_bid(frame.price, frame.qty);
    } else {
        book.set_ask(frame.price, frame.qty);
    }
    conn.publish(position);
}

fn book_levels(levels: &[Level]) -> Vec<BookLevel> {
    let mut book = Vec::with_capacity(levels.len());
    for level in levels {
        book.push(BookLevel {
            price: level.price,
            size: level.qty,
        });
    }
    book
}

// A snapshot, a delta, the banner, an acknowledgement or an alert.
// Prices and quantities are JSON numbers.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    feed: Option<&'a str>, // "book_snapshot", "book", or absent on a control frame
    #[serde(borrow)]
    product_id: Option<&'a str>, // "PF_XBTUSD", where the base is spelled XBT
    seq: Option<i64>, // per product, and the next delta carries seq plus one
    #[serde(default)]
    bids: Vec<Level>,
    #[serde(default)]
    asks: Vec<Level>,
    #[serde(borrow)]
    side: Option<&'a str>, // "buy" is the bid side
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    qty: f64,
    event: Option<String>, // "info" on connect, "subscribed" per frame, "alert" for every error
    message: Option<String>,
}

#[derive(Deserialize)]
struct Level {
    #[serde(deserialize_with = "wire::num")]
    price: f64,
    #[serde(deserialize_with = "wire::num")]
    qty: f64,
}
