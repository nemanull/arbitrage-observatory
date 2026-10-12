// The ChainUp white label futures family: four venues run one platform, and each is a profile of hosts, taker and anchor source.
// Each serves the same fapi/v1 open API and the kline-api socket, whose every depth frame is a whole book with no sequence.
// The raw market id is the socket's spelling, e_btcusdt, which the open API spells E-BTC-USDT.

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
use anchor::FundingSchedule;
use serde::Deserialize;
use std::borrow::Cow;
use std::sync::{Mutex, OnceLock};
use std::time::{Duration, Instant};
use tokio_tungstenite::tungstenite::Message;

pub const AIVORA_ID: &str = "aivora";
pub const FAMEEX_ID: &str = "fameex";
pub const XME_ID: &str = "xme";
pub const KOINBAY_ID: &str = "koinbay";

pub struct Profile {
    pub id: &'static str,
    name: &'static str,
    rest: &'static str, // the open API, without a trailing slash
    socket: &'static str,
    taker_ppm: u32, // the VIP 0 futures taker of the profile's fees.md
    quotes: &'static [&'static str],
    depth: Depth,
    anchor: AnchorSource,
    schedule: Schedule,
    funding: FundingField, // which of the two rates is the upcoming one, where a reply carries both
    keepalive: Keepalive,
    max_silence: Duration,
    markets_per_connection: usize,
    denied: &'static [(&'static str, &'static str)], // (raw market id, reason)
    price_scales: &'static [(&'static str, f64)], // (raw market id, price_scale) for a contract priced per bundle of tokens
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Depth {
    Step0, // market_<sub>_depth_step0, the unaggregated book
    Tick,  // market_<sub>_depth_<price tick>, where a step the contract does not offer is silent
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum AnchorSource {
    AivoraTicker, // market_<sub>: sign_price, index_price and last_fund_rate_third
    XmeTicker,    // market_<sub>_ticker: mark, index and funds_rate
    MarkPrice,    // mark_price_<sub>: tagPrice, indexPrice, both rates and nextSettlementTime
    Rest,         // GET /index?contractName= per contract, since no channel on the book socket carries the anchor
}

// Where the funding interval and the next settlement come from, read about once a minute.
#[derive(Clone, Copy, PartialEq, Debug)]
enum Schedule {
    PublicInfo(&'static str), // the website's POST with an empty body, every trading contract with subSymbol, interval and next settlement
    ContractConfig(&'static str), // GET, every configured contract with its interval and no next settlement
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum FundingField {
    Current, // currentFundRate
    Next,    // nextFundRate
}

#[derive(Clone, Copy, PartialEq, Debug)]
enum Keepalive {
    AnswerPing, // the server sends {"ping":n} every 10 s and the client answers {"pong":n}
    SendPong,   // the client sends {"pong":ms} and the server answers {"ping":s}, so answering that would loop
}

pub const AIVORA: Profile = Profile {
    id: AIVORA_ID,
    name: "Aivora Exchange",
    rest: "https://openapi.aivora.com/futures/open/fapi/v1",
    socket: "wss://openapi.aivora.com/futures/ws",
    taker_ppm: 500,
    quotes: &["USDT", "USDC"],
    depth: Depth::Tick,
    anchor: AnchorSource::AivoraTicker,
    schedule: Schedule::PublicInfo("https://api.aivora.com/futures/api/common/public_info_v2"),
    funding: FundingField::Current,
    keepalive: Keepalive::AnswerPing,
    // The 10 s server ping is traffic, so 25 s is two missed pings.
    max_silence: Duration::from_secs(25),
    // 87 contracts, each with its book and its ticker, ran on one socket on 2026-10-09.
    markets_per_connection: 100,
    denied: &[],
    price_scales: &[],
};

pub const FAMEEX: Profile = Profile {
    id: FAMEEX_ID,
    name: "FameEX",
    rest: "https://futuresopenapi.fameex.com/fapi/v1",
    socket: "wss://futuresws.fameex.com/kline-api/ws",
    taker_ppm: 600,
    quotes: &["USDT"],
    depth: Depth::Step0,
    anchor: AnchorSource::Rest,
    schedule: Schedule::PublicInfo("https://www.fameex.com/fe-co-api/common/futures/public_info"),
    funding: FundingField::Next,
    keepalive: Keepalive::SendPong,
    // Every contract pushes its book every 500 ms, so 10 s is twenty missed pushes.
    max_silence: Duration::from_secs(10),
    // 213 contracts ran on one socket on 2026-09-23.
    markets_per_connection: 220,
    // Found on 2026-10-09 by live_identity against binance, bybit, okx and gate.
    // Its 24 h high, low and last were all 187.74 while every other stock contract traded, and its funding rows read 0 as for a shut market.
    denied: &[("e_qcomusdt", "not trading, its book sits at 187.75 against an index of 175.98")],
    price_scales: &[],
};

pub const XME: Profile = Profile {
    id: XME_ID,
    name: "x.me Exchange",
    rest: "https://futuresopenapi.x.me/fapi/v1",
    socket: "wss://futuresws.x.me/kline-api/ws",
    taker_ppm: 600,
    quotes: &["USDT"],
    depth: Depth::Step0,
    anchor: AnchorSource::XmeTicker,
    schedule: Schedule::PublicInfo("https://www.x.me/fe-co-api/common/public_info"),
    funding: FundingField::Current,
    keepalive: Keepalive::AnswerPing,
    max_silence: Duration::from_secs(10),
    // 266 books ran on one socket, and each market here adds its ticker, so the profile's two sockets of 133 hold both.
    markets_per_connection: 133,
    denied: &[],
    price_scales: &[],
};

pub const KOINBAY: Profile = Profile {
    id: KOINBAY_ID,
    name: "Koinbay",
    rest: "https://futuresopenapi.koinbay.com/fapi/v1",
    socket: "wss://futuresws.koinbay.com/kline-api/ws",
    taker_ppm: 750, // the higher of the two per contract rates, for a row that lacks openTakerFee
    quotes: &["USDT"],
    depth: Depth::Step0,
    anchor: AnchorSource::MarkPrice,
    schedule: Schedule::ContractConfig("https://futuresopenapi.koinbay.com/v1/inner/contract_config"),
    funding: FundingField::Current,
    keepalive: Keepalive::AnswerPing,
    // A static book sends nothing, but the 10 s ping and the mark frame of about 1 Hz keep a socket busy.
    max_silence: Duration::from_secs(30),
    // 127 books ran on one socket on 2026-09-22.
    markets_per_connection: 100,
    denied: &[],
    // Both name the plain coin and quote 1,000 of it, at 0.0054 and 0.0039 when okx, gate and mexc quoted 0.0000054 and 0.0000039 on 2026-10-09.
    // The multiplier counts those bundles, since a level then holds 3,000 to 5,000 USDT as DOGE's and TRX's do, where single tokens would make it 5 USDT.
    price_scales: &[("e_shibusdt", 0.001), ("e_pepeusdt", 0.001)],
};

// The web app pings every 10 s, and a subscribed socket that sent nothing stayed open for 75 s.
const PONG_EVERY: Duration = Duration::from_secs(15);

pub struct Chainup {
    profile: &'static Profile,
    rest: String,
    schedule_url: String,
    anchors: SocketAnchors, // filled by handle on the socket anchored venues
    schedule: Mutex<FundingSchedule>,
    tracked: Vec<String>, // raw ids of the markets on the book sockets
    first_round: OnceLock<Instant>,
    sweep_http: Option<reqwest::Client>, // the REST swept member's own client, else the run's
}

impl Chainup {
    pub fn new(profile: &'static Profile, markets: &[TrackedMarket]) -> Self {
        let schedule_url = match profile.schedule {
            Schedule::PublicInfo(url) | Schedule::ContractConfig(url) => url,
        };
        let mut venue = Self::with_hosts(profile, markets, profile.rest, schedule_url);
        if profile.anchor == AnchorSource::Rest {
            venue.sweep_http = anchor::sweep_client(profile.id);
        }
        venue
    }

    fn with_hosts(profile: &'static Profile, markets: &[TrackedMarket], rest: &str, schedule_url: &str) -> Self {
        Self {
            profile,
            rest: rest.to_string(),
            schedule_url: schedule_url.to_string(),
            anchors: SocketAnchors::new(true),
            schedule: Mutex::new(FundingSchedule::default()),
            tracked: markets.iter().map(|tracked| tracked.market.raw_market_id.clone()).collect(),
            first_round: OnceLock::new(),
            sweep_http: None,
        }
    }

    fn depth_channel(&self, raw_market_id: &str) -> Option<String> {
        match self.profile.depth {
            Depth::Step0 => Some(format!("market_{raw_market_id}_depth_step0")),
            Depth::Tick => {
                let step = markets::depth_step_of(self.profile.id, raw_market_id)?;
                Some(format!("market_{raw_market_id}_depth_{step}"))
            }
        }
    }
}

impl AnchorSource {
    fn channel(self, raw_market_id: &str) -> Option<String> {
        match self {
            AnchorSource::AivoraTicker => Some(format!("market_{raw_market_id}")),
            AnchorSource::XmeTicker => Some(format!("market_{raw_market_id}_ticker")),
            AnchorSource::MarkPrice => Some(format!("mark_price_{raw_market_id}")),
            AnchorSource::Rest => None,
        }
    }

    fn raw_of(self, channel: &str) -> Option<&str> {
        match self {
            AnchorSource::AivoraTicker => channel.strip_prefix("market_"),
            AnchorSource::XmeTicker => channel.strip_prefix("market_")?.strip_suffix("_ticker"),
            AnchorSource::MarkPrice => channel.strip_prefix("mark_price_"),
            AnchorSource::Rest => None,
        }
    }
}

impl BookVenue for Chainup {
    type State = ();

    fn settings(&self) -> FeedSettings {
        let ping_every = (self.profile.keepalive == Keepalive::SendPong).then_some(PONG_EVERY);
        FeedSettings {
            ping_every,
            ..FeedSettings::new(self.profile.max_silence)
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        // A contract with no known depth step would subscribe a silent channel, so it is left out and logged as unplanned.
        let mut planned = Vec::with_capacity(markets.len());
        for market in markets {
            if self.depth_channel(&market.raw_market_id).is_some() {
                planned.push(market.clone());
            }
        }

        let mut plans = Vec::new();
        for (i, slice) in planned.chunks(self.profile.markets_per_connection).enumerate() {
            plans.push(EndpointPlan {
                id: format!("{}#perp#{i}", self.profile.id),
                url: self.profile.socket.to_string(),
                markets: slice.to_vec(),
            });
        }
        plans
    }

    // One channel per frame is the only shape the platform takes, and a burst of 266 was served.
    fn subscribe_frames(&self, markets: &[Market], _state: &mut ()) -> Vec<Message> {
        let mut frames = Vec::with_capacity(markets.len() * 2);
        for market in markets {
            let raw = market.raw_market_id.as_str();
            let channels = [self.depth_channel(raw), self.profile.anchor.channel(raw)];
            for channel in channels.into_iter().flatten() {
                let frame = serde_json::json!({ "event": "sub", "params": { "channel": channel, "cb_id": raw } });
                frames.push(Message::text(frame.to_string()));
            }
        }
        frames
    }

    fn ping(&self, _state: &mut ()) -> Message {
        Message::text(format!("{{\"pong\":{}}}", now_ms()))
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<()>) -> anyhow::Result<()> {
        let at = conn.frame_recv_ts();
        self.handle_at(frame, conn, at)
    }
}

impl Chainup {
    // `at` is the frame's arrival, which stamps the anchor fields it carries.
    fn handle_at(&self, frame: &[u8], conn: &mut Connection<()>, at: i64) -> anyhow::Result<()> {
        // Every frame is gzip inside a binary frame on three members, and Aivora sends text although its docs promise gzip.
        // A Koinbay book that stops moving sends nothing, so a lost book frame would leave the last book published, and only a reconnect reseeds it.
        let inflated;
        let bytes = if frame.starts_with(&GZIP_MAGIC) {
            inflated = match wire::gunzip(frame) {
                Ok(inflated) => inflated,
                Err(error) => {
                    conn.resync("connection", "frame_unreadable");
                    return Err(error);
                }
            };
            inflated.as_slice()
        } else {
            frame
        };
        let frame: Frame = match serde_json::from_slice(bytes) {
            Ok(frame) => frame,
            Err(error) => {
                if bytes.windows(DEPTH_MARK.len()).any(|window| window == DEPTH_MARK) {
                    conn.resync("connection", "book_frame_unreadable");
                }
                return Err(error.into());
            }
        };

        if let Some(ping) = frame.ping {
            if self.profile.keepalive == Keepalive::AnswerPing {
                conn.send(Message::text(format!("{{\"pong\":{ping}}}")));
            }
            return Ok(());
        }

        if frame.status.as_deref().is_some_and(|status| status != "ok") {
            tracing::error!(
                event = "venue_error",
                connection = conn.id(),
                status = frame.status.as_deref().unwrap_or(""),
                channel = frame.channel.as_deref().unwrap_or(""),
                message = frame.msg.as_deref().unwrap_or(""),
            );
            return Ok(());
        }

        // x.me echoes a frame whose event it does not know, and no frame here asks for one.
        let Some(channel) = frame.channel.as_deref() else {
            if let Some(event) = frame.event.as_deref() {
                tracing::info!(event = "venue_notice", connection = conn.id(), venue_event = event);
            }
            return Ok(());
        };
        let Some(tick) = frame.tick else {
            return Ok(());
        };

        if let Some(raw) = depth_raw(channel) {
            apply_book(raw, &tick, conn);
            return Ok(());
        }

        if let Some(raw) = self.profile.anchor.raw_of(channel)
            && conn.position(raw).is_some()
        {
            self.write_anchor(raw, &tick, at);
        }
        Ok(())
    }

    fn write_anchor(&self, raw: &str, tick: &Tick, at: i64) {
        let (index, mark, rate, next_at) = match self.profile.anchor {
            AnchorSource::AivoraTicker => (tick.index_price, tick.sign_price, tick.last_fund_rate_third, 0),
            AnchorSource::XmeTicker => (tick.index, tick.mark, tick.funds_rate, 0),
            AnchorSource::MarkPrice => {
                let rate = match self.profile.funding {
                    FundingField::Current => tick.current_fund_rate,
                    FundingField::Next => tick.next_fund_rate,
                };
                (tick.index_price_camel, tick.tag_price, rate, next_settlement_ms(tick.next_settlement_time))
            }
            AnchorSource::Rest => return,
        };

        self.anchors.set_index(raw, index, at);
        self.anchors.set_mark(raw, mark, at);

        // A contract the schedule does not hold yet gets no interval, so its row stays out until it does.
        let timing = self.schedule.lock().unwrap().timing(raw);
        let (interval_hours, scheduled_next) = timing.unwrap_or((f64::NAN, 0));
        let next_at = if next_at > 0 { next_at } else { scheduled_next };
        self.anchors.set_funding(raw, rate, interval_hours, next_at);
    }
}

const GZIP_MAGIC: [u8; 2] = [0x1f, 0x8b];
const DEPTH_MARK: &[u8] = b"_depth_";

// Every depth frame is the whole book, so it replaces the book, and an empty side is an empty side.
// A missing side, or a level OrderBook would skip, would publish a book that lacks those levels until the next push.
fn apply_book(raw: &str, tick: &Tick, conn: &mut Connection<()>) {
    let Some(position) = conn.position(raw) else {
        return;
    };
    let (Some(bids), Some(asks)) = (&tick.bids, &tick.asks) else {
        conn.resync(raw, "book_side_missing");
        return;
    };
    if !readable(bids) || !readable(asks) {
        conn.resync(raw, "level_unreadable");
        return;
    }

    // The venue's own push can come crossed, as FameEX's e_galausdt did once in 90 s on 2026-10-09.
    // The engine would keep the last quote beside the crossed depth, so the book is emptied until a push that is not crossed.
    // A resync would reopen every market of the socket, and the next push would be no better.
    let best_bid = bids.iter().filter(|level| level.size > 0.0).map(|level| level.price).reduce(f64::max);
    let best_ask = asks.iter().filter(|level| level.size > 0.0).map(|level| level.price).reduce(f64::min);
    if let (Some(bid), Some(ask)) = (best_bid, best_ask)
        && bid >= ask
    {
        let had_levels = conn.book(position).is_some_and(|book| !book.bids().is_empty() || !book.asks().is_empty());
        if had_levels {
            tracing::warn!(event = "book_crossed", connection = conn.id(), market = raw, bid, ask);
        }
        conn.reset_book(position, &[], &[]);
        return;
    }
    conn.reset_book(position, bids, asks);
}

fn readable(levels: &[BookLevel]) -> bool {
    levels
        .iter()
        .all(|level| level.price.is_finite() && level.price > 0.0 && level.size.is_finite() && level.size >= 0.0)
}

// A side that is present, where an absent one stays None, since wire::levels reads absence as no levels.
fn side<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<Option<Vec<BookLevel>>, D::Error> {
    wire::levels(deserializer).map(Some)
}

// "market_e_btcusdt_depth_step0" and "market_e_btcusdt_depth_0.1" both name e_btcusdt.
fn depth_raw(channel: &str) -> Option<&str> {
    let rest = channel.strip_prefix("market_")?;
    let end = rest.rfind("_depth_")?;
    Some(&rest[..end])
}

// The ms string of Koinbay's mark frame, 0 when it is missing.
fn next_settlement_ms(value: f64) -> i64 {
    if value.is_finite() && value > 0.0 { value as i64 } else { 0 }
}

// Book, anchor, ping and error frames share the envelope, so little here is sure to be present.
#[derive(Deserialize)]
struct Frame<'a> {
    #[serde(borrow)]
    channel: Option<Cow<'a, str>>,
    tick: Option<Tick>,
    ping: Option<serde_json::Number>, // Unix seconds on the server ping, ms on FameEX's answer to a pong
    #[serde(borrow)]
    status: Option<Cow<'a, str>>, // "ok" on every data frame
    #[serde(borrow)]
    event: Option<Cow<'a, str>>,
    #[serde(borrow)]
    msg: Option<Cow<'a, str>>,
}

#[derive(Deserialize)]
struct Tick {
    #[serde(default, deserialize_with = "side")]
    asks: Option<Vec<BookLevel>>, // [price, size, ...] in contracts, best first
    #[serde(default, alias = "buys", deserialize_with = "side")]
    bids: Option<Vec<BookLevel>>, // "buys" on three members
    // Aivora's ticker
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    sign_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    last_fund_rate_third: f64, // the rate the open API's /index calls currentFundRate
    // x.me's ticker
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funds_rate: f64,
    // Koinbay's mark frame
    #[serde(default = "wire::nan", rename = "tagPrice", deserialize_with = "wire::num")]
    tag_price: f64,
    #[serde(default = "wire::nan", rename = "indexPrice", deserialize_with = "wire::num")]
    index_price_camel: f64,
    #[serde(default = "wire::nan", rename = "currentFundRate", deserialize_with = "wire::num")]
    current_fund_rate: f64,
    #[serde(default = "wire::nan", rename = "nextFundRate", deserialize_with = "wire::num")]
    next_fund_rate: f64,
    #[serde(default = "wire::nan", rename = "nextSettlementTime", deserialize_with = "wire::num")]
    next_settlement_time: f64, // Unix ms as a string
}
