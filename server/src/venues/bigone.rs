mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::de::{Deserializer, IgnoredAny, MapAccess, Visitor};
use serde::Deserialize;
use std::borrow::Cow;
use std::fmt;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "bigone";

const REST: &str = "https://big.one";

// The URL is the subscription, one channel and one contract per socket, so no subscribe frame exists.
// An unknown, lowercase or disabled contract is refused at the handshake with HTTP 400.
const DEPTH_URL: &str = "wss://api.big.one/ws/contract/v2/depth@";

// Every book frame carries it, and a pong never does.
const BOOK_KEY: &[u8] = b"\"from\"";

pub struct BigOne {
    rest: String,
}

impl BigOne {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self { rest: rest.to_string() }
    }
}

impl BookVenue for BigOne {
    type State = Option<u64>; // `to` of the last frame applied on the connection's one contract

    // The server sends no ping and answers a protocol ping, and a quiet book went 28 s without a frame.
    // So the pong is the traffic the silence check relies on, and three missed pongs is a dead socket.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(15)),
            // About a hundred handshakes to one edge, spread over ten seconds rather than sent at once.
            connect_stagger: Duration::from_millis(100),
            ..FeedSettings::new(Duration::from_secs(45))
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::with_capacity(markets.len());
        for market in markets {
            plans.push(EndpointPlan {
                id: format!("{ID}#depth#{}", market.raw_market_id),
                url: format!("{DEPTH_URL}{}", market.raw_market_id),
                markets: vec![market.clone()],
            });
        }
        plans
    }

    fn subscribe_frames(&self, _markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        Vec::new()
    }

    fn handle(&self, bytes: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = match serde_json::from_slice(bytes) {
            Ok(frame) => frame,
            Err(error) => {
                // The next delta's `from` would show the loss, but a quiet book can take half a minute to send one.
                if bytes.windows(BOOK_KEY.len()).any(|window| window == BOOK_KEY) {
                    resync(conn, 0, "book_frame_unreadable");
                }
                return Err(error.into());
            }
        };

        let Some(from) = frame.from else {
            // The answer to a JSON object sent on the socket, which only counts as traffic.
            if !frame.pong {
                tracing::warn!(event = "venue_notice", connection = conn.id(), reason = "frame_without_sequence");
            }
            return Ok(());
        };

        // The snapshot carries no symbol, so a frame without one belongs to the connection's one contract.
        let position = match frame.symbol.as_deref() {
            Some(symbol) => match conn.position(symbol) {
                Some(position) => position,
                None => return Ok(()),
            },
            None => 0,
        };

        apply_book(position, from, &frame, conn);
        Ok(())
    }
}

// `from` 0 is the whole book, and a delta follows only the frame whose `to` equals its `from`.
// The ids count events across every contract, so a step is larger than one.
fn apply_book(position: usize, from: u64, frame: &Frame, conn: &mut Connection<Option<u64>>) {
    let Some(to) = frame.to else {
        resync(conn, position, "frame_without_to");
        return;
    };

    // OrderBook skips a level it cannot read, which would leave a stale level in the published book.
    if !readable(&frame.bids) || !readable(&frame.asks) {
        resync(conn, position, "level_unreadable");
        return;
    }

    if from == 0 {
        conn.state = Some(to);
        conn.reset_book(position, &frame.bids, &frame.asks);
        return;
    }

    let Some(last) = conn.state else {
        resync(conn, position, "delta_before_snapshot");
        return;
    };
    if from != last {
        resync(conn, position, "sequence_gap");
        return;
    }
    conn.state = Some(to);

    let Some(book) = conn.book(position) else {
        resync(conn, position, "delta_before_snapshot");
        return;
    };
    for level in &frame.bids {
        book.set_bid(level.price, level.size);
    }
    for level in &frame.asks {
        book.set_ask(level.price, level.size);
    }
    conn.publish(position);
}

fn readable(levels: &[BookLevel]) -> bool {
    levels
        .iter()
        .all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

fn resync(conn: &mut Connection<Option<u64>>, position: usize, reason: &str) {
    let market = conn.markets()[position].raw_market_id.clone();
    conn.resync(&market, reason);
}

// A snapshot, a delta, or the pong to a JSON object, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    symbol: Option<Cow<'a, str>>, // on a delta, absent on the snapshot
    from: Option<u64>,            // 0 on the snapshot, the previous frame's `to` on a delta
    to: Option<u64>,
    #[serde(default, deserialize_with = "price_map")]
    bids: Vec<BookLevel>, // contracts by price, unordered, and size 0 deletes
    #[serde(default, deserialize_with = "price_map")]
    asks: Vec<BookLevel>,
    #[serde(default, deserialize_with = "present")]
    pong: bool, // {"pong": 1} or {"pong": null}
}

fn present<'de, D: Deserializer<'de>>(deserializer: D) -> Result<bool, D::Error> {
    IgnoredAny::deserialize(deserializer)?;
    Ok(true)
}

// A side is a JSON object of price to size, {"2483.01": 411}, whose keys arrive in no order.
fn price_map<'de, D: Deserializer<'de>>(deserializer: D) -> Result<Vec<BookLevel>, D::Error> {
    deserializer.deserialize_any(PriceMapVisitor)
}

#[derive(Deserialize)]
struct Price<'a>(#[serde(borrow)] Cow<'a, str>); // "2483.01"

#[derive(Deserialize)]
struct Size(#[serde(deserialize_with = "wire::num")] f64); // a JSON number on the wire

struct PriceMapVisitor;

impl<'de> Visitor<'de> for PriceMapVisitor {
    type Value = Vec<BookLevel>;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("an object of price to size, or null")
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(Vec::new())
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        let mut levels = Vec::with_capacity(map.size_hint().unwrap_or(0));
        while let Some((Price(price), Size(size))) = map.next_entry::<Price<'de>, Size>()? {
            levels.push(BookLevel { price: wire::number(&price), size });
        }
        Ok(levels)
    }
}
