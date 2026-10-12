mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use anchor::AnchorState;
use serde::de::{self, Deserializer, IgnoredAny, MapAccess, SeqAccess, Visitor};
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::fmt;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "whitebit";

const REST: &str = "https://whitebit.com";

// Never api.whitebit.com, which CCXT Pro 4.5.68 still uses and which rejects connections from 2027-03-01.
const PUBLIC_URL: &str = "wss://wss.whitebit.com/ws";

// The allowed limits are 1, 5, 10, 20, 30, 50 and 100, and the server keeps the window exact by sending a 0 for a level that leaves it.
const DEPTH: u32 = 20;

// The docs call 200 comfortable, and 397 perpetuals ran on one socket with no gap on 2026-09-22.
const MARKETS_PER_CONNECTION: usize = 200;

const PING_ID: i64 = 0; // a subscribe request carries its market's position plus one, so an error names the market

pub struct Whitebit {
    rest: String,
    anchors: Mutex<AnchorState>,
}

impl Whitebit {
    pub fn new() -> Self {
        Self::with_rest(REST)
    }

    fn with_rest(rest: &str) -> Self {
        Self {
            rest: rest.to_string(),
            anchors: Mutex::new(AnchorState::default()),
        }
    }
}

impl BookVenue for Whitebit {
    type State = HashMap<usize, i64>; // `update_id` of the last frame applied, by position

    // The server never pings and closes a socket whose client sent nothing for 60 s.
    // Every subscribed market sends at least a keepalive snapshot every 10.3 s, and the pong adds traffic every 20 s.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(20)),
            ..FeedSettings::new(Duration::from_secs(30))
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

    // One market per request, and multi_depth must be true, because false drops every other depth subscription on the socket.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len());
        for (position, market) in markets.iter().enumerate() {
            let frame = serde_json::json!({
                "id": position + 1,
                "method": "depth_subscribe",
                "params": [market.raw_market_id, DEPTH, "0", true],
            });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::text(format!(r#"{{"id":{PING_ID},"method":"ping","params":[]}}"#))
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = serde_json::from_slice(frame)?;

        if frame.method.as_deref() == Some("depth_update")
            && let Some(Params::Depth(is_snapshot, depth, raw_market_id)) = &frame.params
        {
            apply_book(raw_market_id, *is_snapshot, depth, conn);
            return Ok(());
        }

        // Acknowledgements and pongs carry a null error.
        if let Some(error) = &frame.error {
            let id = frame.id.unwrap_or(PING_ID);
            let market = usize::try_from(id)
                .ok()
                .and_then(|id| id.checked_sub(1))
                .and_then(|position| conn.markets().get(position))
                .map_or("", |market| market.raw_market_id.as_str());
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                request = id,
                market,
                code = error.code,
                message = error.message.as_deref().unwrap_or(""),
            );
        }

        Ok(())
    }
}

fn apply_book(raw_market_id: &str, is_snapshot: bool, depth: &Depth, conn: &mut Connection<HashMap<usize, i64>>) {
    let Some(position) = conn.position(raw_market_id) else {
        return;
    };

    // The subscribe answer and the keepalive after 10 s of quiet both replace the book.
    if is_snapshot {
        conn.state.insert(position, depth.update_id.unwrap_or(0));
        conn.reset_book(position, &depth.bids, &depth.asks);
        return;
    }

    let Some(&last) = conn.state.get(&position) else {
        conn.resync(raw_market_id, "delta_before_snapshot");
        return;
    };
    if conn.book(position).is_none() {
        conn.resync(raw_market_id, "delta_before_snapshot");
        return;
    }

    // update_id counts every change to the full book and jumps, so only past_update_id chains a delta.
    if depth.past_update_id != Some(last) {
        conn.resync(raw_market_id, "sequence_gap");
        return;
    }
    conn.state.insert(position, depth.update_id.unwrap_or(0));

    if depth.bids.is_empty() && depth.asks.is_empty() {
        return;
    }

    let Some(book) = conn.book(position) else {
        return;
    };
    for level in &depth.bids {
        book.set_bid(level.price, level.size);
    }
    for level in &depth.asks {
        book.set_ask(level.price, level.size);
    }
    conn.publish(position);
}

// Book pushes, acknowledgements, pongs and errors share the JSON-RPC envelope.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    method: Option<Cow<'a, str>>, // "depth_update" on a book push, absent on a reply
    #[serde(default, borrow)]
    params: Option<Params<'a>>,
    id: Option<i64>, // the request's id on a reply, null on a push
    error: Option<RpcError>,
}

// A depth push is [is_snapshot, book, market], and any other push is skipped.
enum Params<'a> {
    Depth(bool, Depth, Cow<'a, str>),
    Other,
}

impl<'de: 'a, 'a> Deserialize<'de> for Params<'a> {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(ParamsVisitor(std::marker::PhantomData))
    }
}

struct ParamsVisitor<'a>(std::marker::PhantomData<&'a ()>);

impl<'de: 'a, 'a> Visitor<'de> for ParamsVisitor<'a> {
    type Value = Params<'a>;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a params array")
    }

    fn visit_unit<E>(self) -> Result<Self::Value, E> {
        Ok(Params::Other)
    }

    fn visit_map<A: MapAccess<'de>>(self, mut map: A) -> Result<Self::Value, A::Error> {
        while map.next_entry::<IgnoredAny, IgnoredAny>()?.is_some() {}
        Ok(Params::Other)
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Self::Value, A::Error> {
        let first: Option<serde_json::Value> = seq.next_element()?;
        let Some(serde_json::Value::Bool(is_snapshot)) = first else {
            while seq.next_element::<IgnoredAny>()?.is_some() {}
            return Ok(Params::Other);
        };

        let Some(depth) = seq.next_element::<Depth>()? else {
            return Err(de::Error::invalid_length(1, &self));
        };
        let Some(RawId(raw_market_id)) = seq.next_element::<RawId<'a>>()? else {
            return Err(de::Error::invalid_length(2, &self));
        };
        while seq.next_element::<IgnoredAny>()?.is_some() {}

        Ok(Params::Depth(is_snapshot, depth, raw_market_id))
    }
}

#[derive(Deserialize)]
struct RawId<'a>(#[serde(borrow)] Cow<'a, str>); // "BTC_PERP"

#[derive(Deserialize)]
struct Depth {
    update_id: Option<i64>,
    past_update_id: Option<i64>, // absent on a snapshot
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // base coins, best first, absent on a delta that left the side alone
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
}

#[derive(Deserialize)]
struct RpcError {
    #[serde(default)]
    code: i64, // 9 for an unknown market, 1 for an invalid argument
    message: Option<String>,
}
