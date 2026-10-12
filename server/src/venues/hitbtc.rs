// The HitBTC API v3 family: five venues run one platform, and each is a profile of hosts, taker and lists.
// All five show HitBTC's one book: on 2026-10-09 every host served the same trade ids, the same levels and one shared s chain.
// So a cross between any two of them compares a book with itself.

mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use super::wire;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use serde::Deserialize;
use std::borrow::Cow;
use std::collections::HashMap;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const HITBTC_ID: &str = "hitbtc";
pub const FMFWIO_ID: &str = "fmfwio";
pub const CHANGELLYPRO_ID: &str = "changellypro";
pub const MANDALA_ID: &str = "mandala";
pub const GLEECBTC_ID: &str = "gleecbtc";

pub struct Profile {
    pub id: &'static str,
    name: &'static str,
    rest: &'static str, // the API base, without a trailing slash
    socket: &'static str,
    taker_ppm: u32, // the VIP 0 futures taker of the profile's fees.md, which equals take_rate on every perpetual row
    denied: &'static [(&'static str, &'static str)], // (raw market id, reason)
    unanchored: &'static [&'static str], // markets whose index is the venue's own spot last, which get books and no anchor rows
}

// CELUSDT_PERP reads working on HitBTC and FMFW.io, with an empty book on REST and on the socket and an index frozen near 0.0059.
const CEL_DEAD: (&str, &str) = ("CELUSDT_PERP", "listed as working with an empty book and an index frozen since Celsius stopped trading");

pub const HITBTC: Profile = Profile {
    id: HITBTC_ID,
    name: "HitBTC",
    rest: "https://api.hitbtc.com/api/3",
    socket: "wss://api.hitbtc.com/api/3/ws/public",
    taker_ppm: 700,
    denied: &[CEL_DEAD],
    // The index equalled HitBTC's spot HITUSDT last trade on 2026-09-23 and again on 2026-10-09, at 0.2306 with no spot volume.
    unanchored: &["HITUSDT_PERP"],
};

pub const FMFWIO: Profile = Profile {
    id: FMFWIO_ID,
    name: "FMFW.io",
    rest: "https://api.fmfw.io/api/3",
    socket: "wss://api.fmfw.io/api/3/ws/public",
    taker_ppm: 800,
    denied: &[CEL_DEAD],
    unanchored: &[],
};

pub const CHANGELLYPRO: Profile = Profile {
    id: CHANGELLYPRO_ID,
    name: "Changelly PRO",
    rest: "https://api.pro.changelly.com/api/3",
    socket: "wss://api.pro.changelly.com/api/3/ws/public",
    taker_ppm: 500,
    denied: &[],
    unanchored: &[],
};

pub const MANDALA: Profile = Profile {
    id: MANDALA_ID,
    name: "Mandala Exchange",
    rest: "https://api.trade.mandala.exchange/api/3",
    socket: "wss://api.trade.mandala.exchange/api/3/ws/public",
    taker_ppm: 600,
    denied: &[],
    unanchored: &[],
};

pub const GLEECBTC: Profile = Profile {
    id: GLEECBTC_ID,
    name: "Gleec BTC",
    rest: "https://api.exchange.gleec.com/api/3",
    socket: "wss://api.exchange.gleec.com/api/3/ws/public",
    taker_ppm: 2_000,
    denied: &[],
    unanchored: &[],
};

// The whole book on subscribe, then changed levels chained by s per symbol.
// The D20 channels push a whole top 20 batched over at least 100 ms, so the full channel is the only one in real time.
const CHANNEL: &str = "orderbook/full";

// HitBTC lists 50 perpetuals, and all 50 ran on one socket with no gap at about 190 frames a second.
const MARKETS_PER_CONNECTION: usize = 50;

pub struct HitBtc {
    profile: &'static Profile,
    rest: String,
}

impl HitBtc {
    pub fn new(profile: &'static Profile) -> Self {
        Self::with_rest(profile, profile.rest)
    }

    fn with_rest(profile: &'static Profile, rest: &str) -> Self {
        Self {
            profile,
            rest: rest.to_string(),
        }
    }
}

impl BookVenue for HitBtc {
    type State = HashMap<usize, i64>; // `s` of the last frame applied, by position

    // The server pings every 30 s and closes a socket whose pong is missing, and the runtime counts its pings as traffic.
    // A quiet book went 12.4 s without a frame, so 75 s is two missed pings and a margin.
    fn settings(&self) -> FeedSettings {
        FeedSettings::new(Duration::from_secs(75))
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let mut plans = Vec::new();
        for (i, slice) in markets.chunks(MARKETS_PER_CONNECTION).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{}#perp#{i}", self.profile.id),
                url: self.profile.socket.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // A list of 50 symbols in one frame is acknowledged as one.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut Self::State) -> Vec<Message> {
        let mut symbols = Vec::with_capacity(markets.len());
        for market in markets {
            symbols.push(market.raw_market_id.as_str());
        }
        let frame = serde_json::json!({ "method": "subscribe", "ch": CHANNEL, "params": { "symbols": symbols }, "id": 1 });
        vec![Message::text(frame.to_string())]
    }

    // The client sends no ping, because the server pings and the socket library answers.
    fn handle(&self, bytes: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        let frame: Frame = match serde_json::from_slice(bytes) {
            Ok(frame) => frame,
            Err(error) => {
                // The next update's s would show the loss, but a quiet book can go 12 s without one.
                if bytes.windows(BOOK_KEY.len()).any(|window| window == BOOK_KEY) {
                    resync_first(conn, "book_frame_unreadable");
                }
                return Err(error.into());
            }
        };

        if frame.ch.as_deref() == Some(CHANNEL) {
            for (symbol, book) in &frame.snapshot {
                apply_snapshot(symbol, book, conn);
            }
            for (symbol, book) in &frame.update {
                apply_update(symbol, book, conn);
            }
            return Ok(());
        }

        if let Some(ch) = &frame.ch {
            tracing::warn!(event = "venue_notice", connection = conn.id(), ch = ch.as_ref());
        } else if let Some(error) = &frame.error {
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                request = frame.id.unwrap_or(0),
                code = error.code,
                message = error.message.as_str(),
                description = error.description.as_str(),
            );
        } else if let Some(ack) = &frame.result {
            check_ack(ack, conn);
        } else {
            tracing::warn!(event = "venue_notice", connection = conn.id(), frame = %String::from_utf8_lossy(bytes));
        }

        Ok(())
    }
}

const BOOK_KEY: &[u8] = b"\"orderbook/full\"";

// A frame that cannot be read names its symbol nowhere the runtime can see, so the log names the socket's first market.
fn resync_first(conn: &mut Connection<HashMap<usize, i64>>, reason: &str) {
    let market = conn.markets().first().map(|market| market.raw_market_id.clone()).unwrap_or_default();
    conn.resync(&market, reason);
}

// OrderBook skips a level it cannot read, which would leave a stale level in the published book.
fn readable(levels: &[BookLevel]) -> bool {
    levels
        .iter()
        .all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

// An unknown symbol is acknowledged without an error and left out of the list, which names every symbol the socket holds.
fn check_ack(ack: &Ack, conn: &Connection<HashMap<usize, i64>>) {
    let mut missing = Vec::new();
    for market in conn.markets() {
        if !ack.subscriptions.iter().any(|symbol| *symbol == market.raw_market_id) {
            missing.push(market.raw_market_id.as_str());
        }
    }

    if !missing.is_empty() {
        tracing::warn!(
            event = "venue_notice",
            connection = conn.id(),
            kind = "subscription_refused",
            missing = missing.len(),
            sample = ?&missing[..missing.len().min(3)],
        );
    }
}

fn apply_snapshot(symbol: &str, book: &Book, conn: &mut Connection<HashMap<usize, i64>>) {
    let Some(position) = conn.position(symbol) else {
        return;
    };
    if !readable(&book.b) || !readable(&book.a) {
        conn.resync(symbol, "level_unreadable");
        return;
    }

    conn.state.insert(position, book.s);
    conn.reset_book(position, &book.b, &book.a);
}

// Each update's s is the previous one plus 1, the first after the snapshot included.
fn apply_update(symbol: &str, update: &Book, conn: &mut Connection<HashMap<usize, i64>>) {
    let Some(position) = conn.position(symbol) else {
        return;
    };

    let Some(&last) = conn.state.get(&position) else {
        conn.resync(symbol, "delta_before_snapshot");
        return;
    };
    if update.s != last + 1 {
        conn.resync(symbol, "sequence_gap");
        return;
    }
    if !readable(&update.b) || !readable(&update.a) {
        conn.resync(symbol, "level_unreadable");
        return;
    }
    conn.state.insert(position, update.s);

    // An update with both sides empty only moves s.
    if update.b.is_empty() && update.a.is_empty() {
        return;
    }

    let Some(book) = conn.book(position) else {
        return;
    };
    for level in &update.b {
        book.set_bid(level.price, level.size);
    }
    for level in &update.a {
        book.set_ask(level.price, level.size);
    }
    conn.publish(position);
}

// Books, acknowledgements and errors share the envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    ch: Option<Cow<'a, str>>, // "orderbook/full" on a book
    #[serde(default, borrow)]
    snapshot: HashMap<Cow<'a, str>, Book>, // one symbol per frame on the wire
    #[serde(default, borrow)]
    update: HashMap<Cow<'a, str>, Book>,
    result: Option<Ack>,
    error: Option<VenueError>,
    id: Option<i64>,
}

#[derive(Deserialize)]
struct Book {
    #[serde(default)]
    s: i64,
    #[serde(default, deserialize_with = "wire::levels")]
    b: Vec<BookLevel>, // sizes in base coins, and a size of 0 deletes the level
    #[serde(default, deserialize_with = "wire::levels")]
    a: Vec<BookLevel>,
}

#[derive(Deserialize)]
struct Ack {
    #[serde(default)]
    subscriptions: Vec<String>,
}

#[derive(Deserialize)]
struct VenueError {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    message: String,
    #[serde(default)]
    description: String,
}
