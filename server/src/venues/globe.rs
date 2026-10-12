mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::de::{self, Deserializer, SeqAccess, Visitor};
use serde::Deserialize;
use std::borrow::Cow;
use std::fmt;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "globe";

const REST: &str = "https://globe.exchange";

// One socket carries every product.
const PUBLIC_URL: &str = "wss://globe.exchange/api/v1/ws";

// The whole book of up to 25 levels a side every 100 ms, with no sequence, where the documentation says twice a second.
const CHANNEL: &str = "depth";

// 28 streams on one socket ran at 280 frames and about 808 KB a second on 2026-09-23, and 42 streams of six channels all delivered.
// No cap is published, so a slice keeps a socket near that load if the catalog grows.
const MARKETS_PER_CONNECTION: usize = 40;

pub struct Globe {
    rest: String,
}

impl Globe {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self { rest: rest.to_string() }
    }
}

impl BookVenue for Globe {
    type State = ();

    // The server sends a protocol ping every 4 s, which the socket answers, and closes a peer that misses one with 1008.
    // No application ping exists, and every stream pushes every 100 ms with gaps up to 192 ms, so 5 s of silence is a dead socket.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            // The limit is 50 client messages a second, and every subscribe frame names one instrument.
            subscribe_gap: Duration::from_millis(50),
            ..FeedSettings::new(Duration::from_secs(5))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{ID}#public#{i}"),
                url: PUBLIC_URL.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // No list form is documented, and no acknowledgement comes back, so the first book is the confirmation.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut ()) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for market in markets {
            let frame = serde_json::json!({ "command": "subscribe", "channel": CHANNEL, "instrument": market.raw_market_id });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<()>) -> anyhow::Result<()> {
        let parsed: Frame = match serde_json::from_slice(frame) {
            Ok(parsed) => parsed,
            Err(error) => {
                clear_unreadable_book(frame, conn);
                return Err(error.into());
            }
        };

        if let Some(subscription) = &parsed.subscription {
            if subscription.channel == CHANNEL
                && let Some(depth) = &parsed.data
                && let Some(position) = conn.position(&subscription.instrument)
            {
                // Every frame is the whole book, so a lost frame heals on the next one, and a repeat still says the book was current at that tick.
                conn.reset_book(position, &depth.bids, &depth.asks);
            }
            return Ok(());
        }

        // An error carries no subscription echo, and "invalid-instrument" names the instrument in details.
        if let Some(error) = parsed.error.as_deref() {
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                error,
                details = parsed.details.as_deref().unwrap_or(""),
            );
            return Ok(());
        }

        tracing::warn!(event = "venue_notice", connection = conn.id(), frame = %String::from_utf8_lossy(frame));
        Ok(())
    }
}

// The last book of a market whose depth frame does not read would otherwise stand as current, since no gap ends the connection.
// The next frame that reads restores the book 100 ms later.
fn clear_unreadable_book(frame: &[u8], conn: &mut Connection<()>) {
    let Ok(Envelope { subscription: Some(subscription) }) = serde_json::from_slice(frame) else {
        return;
    };
    if subscription.channel != CHANNEL {
        return;
    }
    if let Some(position) = conn.position(&subscription.instrument)
        && conn.book(position).is_some()
    {
        conn.reset_book(position, &[], &[]);
    }
}

#[derive(Deserialize)]
struct Envelope<'a> {
    #[serde(borrow)]
    subscription: Option<Subscription<'a>>,
}

// Books and errors share no envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    subscription: Option<Subscription<'a>>,
    data: Option<Depth>,
    #[serde(borrow)]
    error: Option<Cow<'a, str>>, // "invalid-instrument", "invalid-request", "invalid-syntax" or "exchange-busy"
    #[serde(borrow)]
    details: Option<Cow<'a, str>>, // the instrument on "invalid-instrument", which the documentation spells "detail"
}

#[derive(Deserialize)]
struct Subscription<'a> {
    #[serde(borrow)]
    channel: Cow<'a, str>, // "depth"
    #[serde(borrow, default)]
    instrument: Cow<'a, str>, // "BTC-PERP"
}

#[derive(Deserialize)]
struct Depth {
    #[serde(default, deserialize_with = "levels")]
    bids: Vec<BookLevel>, // best first, coins of the base, and [] on a suspended contract
    #[serde(default, deserialize_with = "levels")]
    asks: Vec<BookLevel>,
}

// {"price":86825.0,"volume":0.0004,"volume_quote":34.73}, where volume_quote is price times volume.
#[derive(Deserialize)]
struct Level {
    #[serde(deserialize_with = "wire::num")]
    price: f64,
    #[serde(deserialize_with = "wire::num")]
    volume: f64, // coins of the base, a whole multiple of the contract size
}

// The levels are objects, which wire::levels does not read, and a null reads as no levels.
// A level whose price or volume is not a number fails the frame, since dropping it would publish a book without that level.
fn levels<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<BookLevel>, D::Error> {
    deserializer.deserialize_any(LevelsVisitor)
}

struct LevelsVisitor;

impl<'de> Visitor<'de> for LevelsVisitor {
    type Value = Vec<BookLevel>;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("an array of level objects or null")
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(Vec::new())
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        let mut levels = Vec::with_capacity(seq.size_hint().unwrap_or(25));
        while let Some(level) = seq.next_element::<Level>()? {
            if !level.price.is_finite() || !level.volume.is_finite() {
                return Err(de::Error::custom("a level without a numeric price or volume"));
            }
            levels.push(BookLevel { price: level.price, size: level.volume });
        }
        Ok(levels)
    }
}
