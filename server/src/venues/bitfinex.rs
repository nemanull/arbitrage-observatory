mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use crate::clock::now_ms;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::de::{self, Deserializer, IgnoredAny, SeqAccess, Visitor};
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::fmt;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "bitfinex";

const REST: &str = "https://api-pub.bitfinex.com";

// One socket serves every perpetual family.
const PUBLIC_URL: &str = "wss://api-pub.bitfinex.com/ws/2";

// SEQ_ALL numbers every array frame of a socket from 1, across channels and heartbeats, so a lost frame shows on the next one.
// The checksum flag is left off, because decision 21 checks a checksum only on a channel with no sequence.
const SEQ_ALL: u32 = 65_536;

// P0 keeps full price precision, F0 is realtime, and 25 is the smallest length of at least 20 levels.
const PRECISION: &str = "P0";
const FREQUENCY: &str = "F0";
const LENGTH: &str = "25";

// The documents say 25 and 30 channels a connection and the wire refused the 37th, so the lower document holds.
const MARKETS_PER_CONNECTION: usize = 25;

// info codes, S1 of docs/profiles/bitfinex/websocket.md.
const RECONNECT_REQUESTED: i64 = 20051;
const MAINTENANCE_STARTED: i64 = 20060;
const MAINTENANCE_ENDED: i64 = 20061;

pub struct Bitfinex;

impl Bitfinex {
    pub fn new() -> Self {
        Self
    }
}

#[derive(Default)]
pub struct State {
    channels: HashMap<i64, usize>, // chanId of each acknowledged book to its position, since a data frame names only the chanId
    last_seq: i64,                 // SEQ_ALL number of the last array frame, 0 before the first
}

impl BookVenue for Bitfinex {
    type State = State;

    // Every subscribed channel sends a heartbeat every 15 s, so 35 s of silence is two missed heartbeats and margin.
    // The ping is optional on a subscribed socket and answered by a pong.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(20)),
            // 20 handshakes a minute per IP, and a breach blocks the host for 60 s.
            connect_stagger: Duration::from_secs(3),
            ..FeedSettings::new(Duration::from_secs(35))
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

    // The conf frame goes before any subscribe, since the flags apply to the channels opened after it.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut State) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len() + 1);
        frames.push(Message::text(serde_json::json!({ "event": "conf", "flags": SEQ_ALL }).to_string()));
        for market in markets {
            let frame = serde_json::json!({
                "event": "subscribe",
                "channel": "book",
                "symbol": market.raw_market_id,
                "prec": PRECISION,
                "freq": FREQUENCY,
                "len": LENGTH,
            });
            frames.push(Message::text(frame.to_string()));
        }
        frames
    }

    fn ping(&self, _state: &mut State) -> Message {
        Message::text(serde_json::json!({ "event": "ping", "cid": now_ms() }).to_string())
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
        if frame.trim_ascii_start().first() == Some(&b'{') {
            let event: Event = serde_json::from_slice(frame)?;
            handle_event(&event, conn);
            return Ok(());
        }

        let data: Data = serde_json::from_slice(frame)?;

        // The counter spans the socket, so a gap cannot be pinned to one market and the whole connection resyncs.
        let Some(seq) = data.seq else {
            conn.resync("connection", "sequence_missing");
            return Ok(());
        };
        if seq != conn.state.last_seq + 1 {
            conn.resync("connection", "sequence_gap");
            return Ok(());
        }
        conn.state.last_seq = seq;

        let Some(&position) = conn.state.channels.get(&data.chan_id) else {
            if matches!(data.payload, Payload::Tag) {
                return Ok(());
            }
            anyhow::bail!("book frame on channel {} that no subscribe acknowledged", data.chan_id);
        };

        match data.payload {
            Payload::Tag => {} // "hb", every 15 s per channel
            Payload::Snapshot(entries) => apply_snapshot(position, &entries, conn),
            Payload::Update(entry) => apply_update(position, entry, conn),
        }

        Ok(())
    }
}

fn handle_event(event: &Event, conn: &mut Connection<State>) {
    let symbol = event.symbol.as_deref().unwrap_or("");

    match event.event.as_ref() {
        "subscribed" if event.channel.as_deref() == Some("book") => {
            if let Some(chan_id) = event.chan_id
                && let Some(position) = conn.position(symbol)
            {
                conn.state.channels.insert(chan_id, position);
            }
        }
        "pong" => {}
        "conf" if event.status.as_deref() == Some("OK") => {}
        "error" | "conf" => tracing::error!(
            event = "venue_error",
            connection = conn.id(),
            request = event.event.as_ref(),
            market = symbol,
            code = event.code.unwrap_or(0),
            message = event.msg.as_deref().unwrap_or(""),
        ),
        "info" => handle_info(event, conn),
        other => tracing::warn!(event = "venue_notice", connection = conn.id(), kind = other),
    }
}

// The first frame of every socket is an info frame with the platform status, 1 when operative and 0 under maintenance.
fn handle_info(event: &Event, conn: &mut Connection<State>) {
    let message = event.msg.as_deref().unwrap_or("");

    match event.code {
        None if event.platform.as_ref().is_none_or(|platform| platform.status == 1) => {}
        // The venue asks for a new socket, and after maintenance every channel must be subscribed again, which a new socket does.
        Some(code @ (RECONNECT_REQUESTED | MAINTENANCE_ENDED)) => {
            tracing::warn!(event = "venue_notice", connection = conn.id(), kind = "info", code, message);
            conn.resync("connection", "reconnect_requested");
        }
        Some(MAINTENANCE_STARTED) | None => {
            tracing::warn!(event = "venue_notice", connection = conn.id(), kind = "maintenance", message);
        }
        Some(code) => tracing::warn!(event = "venue_notice", connection = conn.id(), kind = "info", code, message),
    }
}

fn apply_snapshot(position: usize, entries: &[Entry], conn: &mut Connection<State>) {
    let mut bids = Vec::with_capacity(entries.len());
    let mut asks = Vec::with_capacity(entries.len());

    // A positive amount is a bid and a negative one an ask, in coins.
    for entry in entries {
        if entry.amount > 0.0 {
            bids.push(BookLevel { price: entry.price, size: entry.amount });
        } else if entry.amount < 0.0 {
            asks.push(BookLevel { price: entry.price, size: -entry.amount });
        }
    }

    conn.reset_book(position, &bids, &asks);
}

// A count above 0 sets the level, and a count of 0 deletes the bid on amount 1 or the ask on amount -1.
fn apply_update(position: usize, entry: Entry, conn: &mut Connection<State>) {
    let Some(book) = conn.book(position) else {
        let market = conn.markets()[position].raw_market_id.clone();
        conn.resync(&market, "delta_before_snapshot");
        return;
    };

    let size = if entry.count > 0.0 { entry.amount.abs() } else { 0.0 };
    if entry.amount > 0.0 {
        book.set_bid(entry.price, size);
    } else if entry.amount < 0.0 {
        book.set_ask(entry.price, size);
    }
    conn.publish(position);
}

// Events are objects, and the fields present depend on the event.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Event<'a> {
    #[serde(borrow)]
    event: Cow<'a, str>, // "info", "conf", "subscribed", "pong" or "error"
    #[serde(borrow)]
    channel: Option<Cow<'a, str>>,
    chan_id: Option<i64>,
    #[serde(borrow)]
    symbol: Option<Cow<'a, str>>, // "tBTCF0:USTF0"
    #[serde(borrow)]
    status: Option<Cow<'a, str>>, // "OK" on an accepted conf
    code: Option<i64>,
    #[serde(borrow)]
    msg: Option<Cow<'a, str>>,
    platform: Option<Platform>,
}

#[derive(Deserialize)]
struct Platform {
    status: i64,
}

// [chanId, payload, seq] with SEQ_ALL, where the payload is a snapshot, one level, or a tag such as "hb".
struct Data {
    chan_id: i64,
    payload: Payload,
    seq: Option<i64>, // the last element, absent when the conf flags were not applied
}

enum Payload {
    Snapshot(Vec<Entry>), // every level, bids first, possibly empty
    Update(Entry),
    Tag, // "hb", or "cs" if a checksum were asked for
}

#[derive(Clone, Copy)]
struct Entry {
    price: f64,
    count: f64,
    amount: f64, // positive on a bid and negative on an ask
}

impl<'de> Deserialize<'de> for Data {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_seq(DataVisitor)
    }
}

struct DataVisitor;

impl<'de> Visitor<'de> for DataVisitor {
    type Value = Data;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a data frame [chanId, payload, seq]")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Data, A::Error> {
        let chan_id: i64 = seq.next_element()?.ok_or_else(|| de::Error::invalid_length(0, &self))?;
        let payload: Payload = seq.next_element()?.ok_or_else(|| de::Error::invalid_length(1, &self))?;

        // A checksum frame carries its number before the sequence, so the sequence is the last element.
        let mut last = None;
        while let Some(value) = seq.next_element::<i64>()? {
            last = Some(value);
        }

        Ok(Data { chan_id, payload, seq: last })
    }
}

impl<'de> Deserialize<'de> for Payload {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(PayloadVisitor)
    }
}

struct PayloadVisitor;

impl<'de> Visitor<'de> for PayloadVisitor {
    type Value = Payload;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a list of levels, one level, or a tag")
    }

    fn visit_str<E>(self, _tag: &str) -> Result<Payload, E> {
        Ok(Payload::Tag)
    }

    // The first element tells one level, which starts with its price, from a snapshot, which starts with a level.
    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Payload, A::Error> {
        let Some(first) = seq.next_element::<Item>()? else {
            return Ok(Payload::Snapshot(Vec::new()));
        };

        match first {
            Item::Number(price) => {
                let count: f64 = seq.next_element()?.ok_or_else(|| de::Error::invalid_length(1, &self))?;
                let amount: f64 = seq.next_element()?.ok_or_else(|| de::Error::invalid_length(2, &self))?;
                while seq.next_element::<IgnoredAny>()?.is_some() {}
                Ok(Payload::Update(Entry { price, count, amount }))
            }
            Item::Level(entry) => {
                let mut entries = Vec::with_capacity(seq.size_hint().unwrap_or(0) + 1);
                entries.push(entry);
                while let Some(entry) = seq.next_element::<EntryArray>()? {
                    entries.push(entry.0);
                }
                Ok(Payload::Snapshot(entries))
            }
        }
    }
}

enum Item {
    Number(f64),
    Level(Entry),
}

impl<'de> Deserialize<'de> for Item {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_any(ItemVisitor)
    }
}

struct ItemVisitor;

impl<'de> Visitor<'de> for ItemVisitor {
    type Value = Item;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a price or a level [PRICE, COUNT, AMOUNT]")
    }

    fn visit_f64<E>(self, value: f64) -> Result<Item, E> {
        Ok(Item::Number(value))
    }

    fn visit_u64<E>(self, value: u64) -> Result<Item, E> {
        Ok(Item::Number(value as f64))
    }

    fn visit_i64<E>(self, value: i64) -> Result<Item, E> {
        Ok(Item::Number(value as f64))
    }

    fn visit_seq<A: SeqAccess<'de>>(self, seq: A) -> Result<Item, A::Error> {
        EntryVisitor.visit_seq(seq).map(Item::Level)
    }
}

struct EntryArray(Entry);

impl<'de> Deserialize<'de> for EntryArray {
    fn deserialize<D: Deserializer<'de>>(deserializer: D) -> Result<Self, D::Error> {
        deserializer.deserialize_seq(EntryVisitor).map(EntryArray)
    }
}

struct EntryVisitor;

impl<'de> Visitor<'de> for EntryVisitor {
    type Value = Entry;

    fn expecting(&self, f: &mut fmt::Formatter) -> fmt::Result {
        f.write_str("a level [PRICE, COUNT, AMOUNT]")
    }

    fn visit_seq<A: SeqAccess<'de>>(self, mut seq: A) -> Result<Entry, A::Error> {
        let price: f64 = seq.next_element()?.ok_or_else(|| de::Error::invalid_length(0, &self))?;
        let count: f64 = seq.next_element()?.ok_or_else(|| de::Error::invalid_length(1, &self))?;
        let amount: f64 = seq.next_element()?.ok_or_else(|| de::Error::invalid_length(2, &self))?;
        while seq.next_element::<IgnoredAny>()?.is_some() {}
        Ok(Entry { price, count, amount })
    }
}
