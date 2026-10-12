mod anchor;
mod markets;
#[cfg(test)]
mod tests;

pub use markets::load;

use crate::clock::now_ms;
use crate::engine::cluster::{BookLevel, Market};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings};
use crate::venues::wire;
use anchor::Funding;
use serde::Deserialize;
use std::borrow::Cow;
use std::sync::Mutex;
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

pub const ID: &str = "poloniex";

const REST: &str = "https://api.poloniex.com";

// One public URL serves the one perpetual family.
const PUBLIC_URL: &str = "wss://ws.poloniex.com/ws/v3/public";

// 20 levels, a snapshot on subscribe, then updates chained by lid and id.
const CHANNEL: &str = "book_lv2";

// All 18 contracts ran on one socket with no gap at up to 2,004 frames a second on 2026-09-23.
// The documented caps are 500 requests a second per connection and 2,000 connections per IP, and none counts symbols.
const MARKETS_PER_CONNECTION: usize = 30;

pub struct Poloniex {
    rest: String,
    markets: Vec<String>, // tracked raw ids, whose funding is read in turn
    funding: Mutex<Funding>,
    clock: fn() -> i64,
}

impl Poloniex {
    pub fn new(markets: &[TrackedMarket]) -> Self {
        Self::with_rest(markets, REST, now_ms)
    }

    fn with_rest(markets: &[TrackedMarket], rest: &str, clock: fn() -> i64) -> Self {
        let mut ids = Vec::with_capacity(markets.len());
        for tracked in markets {
            ids.push(tracked.market.raw_market_id.clone());
        }

        Self {
            rest: rest.to_string(),
            markets: ids,
            funding: Mutex::new(Funding::default()),
            clock,
        }
    }
}

#[derive(Default)]
pub struct State {
    last: Vec<Option<u64>>, // by position, the id of the last frame applied, None before the snapshot
}

impl BookVenue for Poloniex {
    type State = State;

    // The server closes a socket that sent nothing for 30 s, however busy its stream, and never pings.
    // The quietest contract went 2.1 s without a frame, and the pong to the 15 s ping keeps a quiet socket fed.
    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_secs(15)),
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

    // A frame naming every contract gets one acknowledgement and one snapshot per contract, and "all" is refused.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut State) -> Vec<Message> {
        let mut symbols = Vec::with_capacity(markets.len());
        for market in markets {
            symbols.push(market.raw_market_id.as_str());
        }
        let frame = serde_json::json!({ "event": "subscribe", "channel": [CHANNEL], "symbols": symbols });
        vec![Message::text(frame.to_string())]
    }

    fn ping(&self, _state: &mut State) -> Message {
        Message::text(r#"{"event":"ping"}"#)
    }

    fn handle(&self, bytes: &[u8], conn: &mut Connection<State>) -> anyhow::Result<()> {
        let frame: Frame = match serde_json::from_slice(bytes) {
            Ok(frame) => frame,
            Err(error) => {
                // The next update's lid would show the loss, but only once that contract changes again.
                if bytes.windows(CHANNEL.len()).any(|window| window == CHANNEL.as_bytes()) {
                    conn.resync("", "book_frame_unreadable");
                }
                return Err(error.into());
            }
        };

        // The acknowledgement names the channel too, so a book is told by its action.
        if frame.channel.as_deref() == Some(CHANNEL)
            && let Some(action) = frame.action.as_deref()
        {
            let snapshot = match action {
                "snapshot" => true,
                "update" => false,
                _ => {
                    tracing::warn!(event = "venue_notice", connection = conn.id(), channel = CHANNEL, action);
                    return Ok(());
                }
            };
            for book in &frame.data {
                apply_book(snapshot, book, conn);
            }
            return Ok(());
        }

        match frame.event.as_deref() {
            Some("pong" | "subscribe") => {}
            // The refusal of an unknown symbol, a bad channel or a frame that is not JSON names no contract.
            Some("error") => {
                tracing::error!(event = "venue_error", connection = conn.id(), message = frame.message.as_deref().unwrap_or(""));
            }
            event => {
                tracing::warn!(
                    event = "venue_notice",
                    connection = conn.id(),
                    op = event.unwrap_or(""),
                    channel = frame.channel.as_deref().unwrap_or(""),
                    message = frame.message.as_deref().unwrap_or(""),
                );
            }
        }

        Ok(())
    }
}

// A snapshot replaces the book whenever it comes, and an update follows only the frame whose id equals its lid.
// The ids skip, so the chain is a pointer to the previous frame and not a step of one.
fn apply_book(snapshot: bool, book: &Book, conn: &mut Connection<State>) {
    let Some(position) = conn.position(&book.s) else {
        return;
    };

    // OrderBook skips a level it cannot read, which would leave a stale level in the published book.
    if !readable(&book.bids) || !readable(&book.asks) {
        conn.resync(&book.s, "level_unreadable");
        return;
    }

    let last = &mut conn.state.last;
    if last.len() <= position {
        last.resize(position + 1, None);
    }

    if snapshot {
        last[position] = Some(book.id);
        conn.reset_book(position, &book.bids, &book.asks);
        return;
    }

    // One update came before its contract's snapshot in 36 subscriptions, and the snapshot that followed chained cleanly.
    // A resync would resubscribe every contract for a state the snapshot repairs.
    let Some(previous) = last[position] else {
        tracing::debug!(event = "update_before_snapshot", connection = conn.id(), market = %book.s, id = book.id);
        return;
    };
    if book.lid != Some(previous) {
        conn.resync(&book.s, "sequence_gap");
        return;
    }
    last[position] = Some(book.id);

    let Some(levels) = conn.book(position) else {
        return;
    };
    for level in &book.bids {
        levels.set_bid(level.price, level.size);
    }
    for level in &book.asks {
        levels.set_ask(level.price, level.size);
    }
    conn.publish(position);
}

fn readable(levels: &[BookLevel]) -> bool {
    levels
        .iter()
        .all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

// Books, acknowledgements, pongs and errors share the envelope, so nothing here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    channel: Option<Cow<'a, str>>, // "book_lv2" on a book and on its acknowledgement
    #[serde(borrow)]
    action: Option<Cow<'a, str>>, // "snapshot" or "update" on a book
    #[serde(borrow)]
    event: Option<Cow<'a, str>>, // "subscribe", "pong" or "error"
    message: Option<String>, // on an error, "no valid symbols"
    #[serde(default, borrow)]
    data: Vec<Book<'a>>,
}

#[derive(Deserialize)]
struct Book<'a> {
    #[serde(borrow)]
    s: Cow<'a, str>, // "BTC_USDT_PERP"
    id: u64,
    lid: Option<u64>, // the previous frame's id
    #[serde(default, deserialize_with = "wire::levels")]
    bids: Vec<BookLevel>, // [price, contracts] strings, best first, and size "0" deletes
    #[serde(default, deserialize_with = "wire::levels")]
    asks: Vec<BookLevel>,
}
