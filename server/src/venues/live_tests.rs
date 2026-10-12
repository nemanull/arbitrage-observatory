// Checks against the real venues, which run only on request:
// LIVE_VENUES=binance,okx cargo test live_catalog -- --ignored --nocapture
// LIVE_VENUES=binance LIVE_SECONDS=120 cargo test --release live_smoke -- --ignored --nocapture
// LIVE_VENUES=gemini,bitstamp LIVE_SECONDS=30 cargo test live_identity -- --ignored --nocapture

use super::testing::tracked;
use super::{Binance, Bybit, Gate, Mexc, Okx, VenueRun, load_venue, start_venue};
use crate::clock::now_ms;
use crate::engine::cluster::{ClusterIndex, Venue};
use crate::engine::engine::{ENGINE_QUEUE_CAPACITY, EngineEvent, Slot};
use crate::feeds::TrackedMarket;
use crate::feeds::anchor_poller::{AnchorMap, AnchorVenue};
use crate::orchestrator::{TrackedVenue, tracked_venues};
use crate::test_log::capture;
use futures_util::future::join_all;
use std::collections::{BTreeMap, HashMap, HashSet};
use std::time::Duration;
use tokio::sync::mpsc;
use tokio::time::{Instant, timeout};
use tokio_util::sync::CancellationToken;
use tracing::Level;

const ALL_VENUES: &[&str] = &[
    "binance",
    "bybit",
    "okx",
    "krakenfutures",
    "coinbase",
    "gate",
    "bitget",
    "mexc",
    "bitstamp",
    "gemini",
    "kucoinfutures",
    "bingx",
    "cryptocom",
    "woo",
    "whitebit",
    "phemex",
    "deribit",
    "hyperliquid",
    "bitunix",
    "htx",
    "toobit",
    "bitfinex",
    "btse",
    "digifinex",
    "delta",
    "backpack",
    "deepcoin",
    "bigone",
    "globe",
    "uzx",
    "xt",
    "weex",
    "coinw",
    "hashkey",
    "hibt",
    "zoomex",
    "poloniex",
    "orangex",
    "hotcoin",
    "hitbtc",
    "fmfwio",
    "changellypro",
    "mandala",
    "gleecbtc",
    "bitradex",
    "pionex",
    "echobit",
    "valr",
    "ourbit",
    "bydfi",
    "biconomy",
    "niza",
    "nonkyc",
    "tothemoon",
    "trubitpro",
    "aivora",
    "fameex",
    "xme",
    "koinbay",
];

const SAMPLE: usize = 5;

fn live_venues() -> Vec<String> {
    match std::env::var("LIVE_VENUES") {
        Ok(list) if !list.trim().is_empty() => list.split(',').map(|id| id.trim().to_string()).collect(),
        _ => ALL_VENUES.iter().map(|id| id.to_string()).collect(),
    }
}

// The client main builds, so a live check sees what a run sees.
fn client() -> reqwest::Client {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    reqwest::Client::builder()
        .user_agent("arbitrage-observatory")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap()
}

async fn load(id: &str, http: &reqwest::Client) -> Venue {
    match load_venue(id, http).await {
        Ok(venue) => venue,
        Err(error) => panic!("{id} failed to load: {error:#}"),
    }
}

// One tab separated line per market, which the plan's parity check diffs against a CCXT dump.
#[tokio::test]
#[ignore]
async fn live_catalog() {
    let http = client();

    for id in live_venues() {
        let venue = load(&id, &http).await;
        for m in &venue.markets {
            println!(
                "{}\t{}\t{}\t{}\t{}\t{}\t{}\t{}",
                venue.id, m.raw_market_id, m.base, m.quote, m.linear, m.contract_size, m.taker_ppm, m.price_scale
            );
        }
    }
}

#[derive(Default)]
struct Seen {
    updates: u64,
    booked: HashSet<usize>,    // clusters, which are positions in the venue's market list
    two_sided: HashSet<usize>, // a book with both sides at least once
    crossed: u64,
    crossed_sample: Vec<String>,
    stale: u64,
    anchor_rounds: u64,
    anchored: HashSet<usize>,
}

// Every market the venue lists, on one venue at a time, through the same start_venue a run uses.
// It fails when a market never gets a book, when a top is crossed, when a socket closes, or when a frame fails to parse.
// A book that never shows both sides is reported and does not fail, since a venue can hold a one sided or empty book.
#[tokio::test]
#[ignore]
async fn live_smoke() {
    let (logs, _capture) = capture();
    let http = client();
    let seconds: u64 = std::env::var("LIVE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(90);
    let mut failures = Vec::new();

    for id in live_venues() {
        let venue = load(&id, &http).await;
        let markets = tracked(&venue.markets);
        let (tx, mut rx) = mpsc::channel(ENGINE_QUEUE_CAPACITY);
        let cancel = CancellationToken::new();
        let started = Instant::now();
        let tasks = start_venue(VenueRun {
            venue_id: id.clone(),
            venue_index: 0,
            markets: markets.clone(),
            http: http.clone(),
            tx,
            cancel: cancel.clone(),
        })
        .unwrap();

        let mut seen = Seen::default();
        let deadline = started + Duration::from_secs(seconds);
        while let Ok(Some(event)) = timeout(deadline.saturating_duration_since(Instant::now()), rx.recv()).await {
            record(&mut seen, event, &venue);
        }

        cancel.cancel();
        for task in tasks {
            let _ = timeout(Duration::from_secs(5), task).await;
        }

        let mut unbooked = Vec::new();
        let mut one_sided = Vec::new();
        let mut unanchored = Vec::new();
        for (cluster, tracked) in markets.iter().enumerate() {
            if !seen.booked.contains(&cluster) {
                unbooked.push(tracked.market.raw_market_id.as_str());
            } else if !seen.two_sided.contains(&cluster) {
                one_sided.push(tracked.market.raw_market_id.as_str());
            }
            if !seen.anchored.contains(&cluster) {
                unanchored.push(tracked.market.raw_market_id.as_str());
            }
        }

        println!(
            "{id}: {} markets for {seconds} s, {} updates, {} without a book {:?}, {} never two sided {:?}, {} crossed tops {:?}, {} stale, {} anchor rounds, {} never anchored {:?}",
            markets.len(),
            seen.updates,
            unbooked.len(),
            &unbooked[..unbooked.len().min(SAMPLE)],
            one_sided.len(),
            &one_sided[..one_sided.len().min(SAMPLE)],
            seen.crossed,
            seen.crossed_sample,
            seen.stale,
            seen.anchor_rounds,
            unanchored.len(),
            &unanchored[..unanchored.len().min(SAMPLE)],
        );

        if !unbooked.is_empty() {
            failures.push(format!("{id}: {} markets never got a book", unbooked.len()));
        }
        if seen.crossed > 0 {
            failures.push(format!("{id}: {} crossed tops", seen.crossed));
        }
        if seen.stale > 0 {
            failures.push(format!("{id}: {} sockets closed", seen.stale));
        }
    }

    // Warnings and errors by event, so a resync or a refused subscribe shows even when the counts above pass.
    let mut counts: BTreeMap<String, u64> = BTreeMap::new();
    for line in logs.lines() {
        if line.level <= Level::WARN {
            let event = line.texts.get("event").cloned().unwrap_or_else(|| format!("{:?}", line.texts));
            let count = counts.entry(event.clone()).or_default();
            if *count == 0 {
                println!("first {event}: {:?} {:?}", line.texts, line.numbers);
            }
            *count += 1;
        }
    }
    println!("warnings and errors by event: {counts:?}");
    for event in ["frame_handle_failed", "venue_panicked", "venue_error", "book_resync", "markets_unplanned", "plan_market_refused"] {
        if let Some(count) = counts.get(event) {
            failures.push(format!("{count} {event}"));
        }
    }

    assert!(failures.is_empty(), "{failures:#?}");
}

fn record(seen: &mut Seen, event: EngineEvent, venue: &Venue) {
    match event {
        EngineEvent::Book(update) => {
            seen.updates += 1;
            seen.booked.insert(update.slot.cluster);

            let bids = update.bids.as_slice();
            let asks = update.asks.as_slice();
            if !bids.is_empty() && !asks.is_empty() {
                seen.two_sided.insert(update.slot.cluster);
            }
            if let (Some(bid), Some(ask)) = (bids.first(), asks.first())
                && bid.price >= ask.price
            {
                seen.crossed += 1;
                if seen.crossed_sample.len() < SAMPLE {
                    let market = &venue.markets[update.slot.cluster].raw_market_id;
                    seen.crossed_sample.push(format!("{market} {} >= {}", bid.price, ask.price));
                }
            }
        }
        EngineEvent::Stale { .. } => seen.stale += 1,
        EngineEvent::Anchors(readings) => {
            seen.anchor_rounds += 1;
            for (slot, _) in readings {
                seen.anchored.insert(slot.cluster);
            }
        }
        EngineEvent::Sweep | EngineEvent::Shutdown => {}
    }
}

// The venues every other venue's prices are checked against.
const REFERENCE_VENUES: &[&str] = &["binance", "bybit", "okx", "gate", "mexc"];

const IDENTITY_WARN: f64 = 0.02;
const IDENTITY_FAIL: f64 = 0.10;
const IDENTITY_MAX_SPREAD: f64 = 0.10; // a wider book is dead, and its mid says nothing about the token

#[derive(Clone, Copy)]
struct Top {
    bid: f64, // the market's last two sided top, times its price_scale
    ask: f64,
}

impl Top {
    fn mid(self) -> f64 {
        (self.bid + self.ask) / 2.0
    }

    fn usable_mid(self) -> Option<f64> {
        let mid = self.mid();
        ((self.ask - self.bid) / mid < IDENTITY_MAX_SPREAD).then_some(mid)
    }
}

#[derive(Clone, Copy)]
struct Anchor {
    index: f64, // the market's last anchor reading, times its price_scale
    mark: f64,  // 0 = the venue publishes none
}

impl Anchor {
    fn price(self) -> f64 {
        if self.mark > 0.0 { self.mark } else { self.index }
    }
}

#[derive(Default)]
struct Prices {
    tops: HashMap<Slot, Top>,
    anchors: HashMap<Slot, Anchor>,
}

#[derive(Clone, Copy, PartialEq)]
enum By {
    Mids,    // the market's own mid against the references' anchors
    Anchors, // the market's own anchor, for a book over the spread limit or never two sided
}

#[derive(Default)]
struct Identity<'a> {
    compared: usize,
    within: usize,
    warned: usize,       // 2 to 10 percent away
    failed: Vec<String>, // above 10 percent
    no_reference: usize,
    by_anchors: Vec<&'a str>,
    no_price: Vec<&'a str>, // neither a usable mid nor an anchor
}

// Every market of the venues under test against the median anchor price of the reference venues in its cluster.
// A market far from that median is another token under the same ticker, or a price in another unit.
// The market's own mid is compared while its book is under the spread limit, and its own anchor otherwise, because a dead book's mid says nothing.
// The references are read with one REST anchor round each, since streaming five venues per run saturated the CPU when several runs overlapped.
#[tokio::test]
#[ignore]
async fn live_identity() {
    let under_test = identity_venues();
    let http = client();
    let seconds: u64 = std::env::var("LIVE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(30);

    let mut ids = under_test.clone();
    for &reference in REFERENCE_VENUES {
        if !ids.iter().any(|id| id == reference) {
            ids.push(reference.to_string());
        }
    }
    let venues = join_all(ids.iter().map(|id| load(id, &http))).await;
    let index = ClusterIndex::build_index(&venues).unwrap();
    let tracked = identity_tracked(&index, &venues, &under_test);
    let mut prices = watch_prices(&index, &tracked, &under_test, &http, seconds).await;
    read_reference_anchors(&tracked, &under_test, &http, &mut prices).await;

    let mut failures = Vec::new();
    for id in &under_test {
        failures.extend(compare_venue(id, &index, &tracked, &prices));
    }
    assert!(failures.is_empty(), "markets more than 10 percent from the reference median: {failures:#?}");
}

fn identity_venues() -> Vec<String> {
    let list = std::env::var("LIVE_VENUES").unwrap_or_default();
    if list.trim().is_empty() {
        panic!("usage: LIVE_VENUES=gemini,bitstamp LIVE_SECONDS=30 cargo test live_identity -- --ignored --nocapture");
    }
    let mut ids: Vec<String> = Vec::new();
    for id in list.split(',').map(str::trim) {
        if !id.is_empty() && !ids.iter().any(|known| known == id) {
            ids.push(id.to_string());
        }
    }
    ids
}

// Each venue's markets in the clusters that hold a venue under test, since no other cluster is compared.
fn identity_tracked(index: &ClusterIndex, venues: &[Venue], under_test: &[String]) -> Vec<TrackedVenue> {
    let mut columns = Vec::with_capacity(under_test.len());
    for id in under_test {
        columns.push(index.venue_index_map.get(id).unwrap());
    }

    let mut tracked = tracked_venues(index, venues);
    for venue in &mut tracked {
        venue.markets.retain(|market| {
            let held = &index.clusters[market.slot.cluster].markets;
            columns.iter().any(|&column| held[column].is_some())
        });
    }
    tracked.retain(|venue| !venue.markets.is_empty());
    tracked
}

// The venues under test stream into one channel, as in a run, and each market keeps its last two sided top and its last anchor reading.
async fn watch_prices(
    index: &ClusterIndex,
    tracked: &[TrackedVenue],
    under_test: &[String],
    http: &reqwest::Client,
    seconds: u64,
) -> Prices {
    let (tx, mut rx) = mpsc::channel(ENGINE_QUEUE_CAPACITY);
    let cancel = CancellationToken::new();
    let started = Instant::now();
    let mut tasks = Vec::new();
    for venue in tracked.iter().filter(|venue| under_test.contains(&venue.id)) {
        println!("{}: streaming {} markets", venue.id, venue.markets.len());
        tasks.extend(
            start_venue(VenueRun {
                venue_id: venue.id.clone(),
                venue_index: venue.venue_index,
                markets: venue.markets.clone(),
                http: http.clone(),
                tx: tx.clone(),
                cancel: cancel.clone(),
            })
            .unwrap(),
        );
    }
    drop(tx);

    let mut prices = Prices::default();
    let deadline = started + Duration::from_secs(seconds);
    while let Ok(Some(event)) = timeout(deadline.saturating_duration_since(Instant::now()), rx.recv()).await {
        record_price(&mut prices, index, event);
    }

    cancel.cancel();
    for task in tasks {
        let _ = timeout(Duration::from_secs(5), task).await;
    }
    prices
}

// One anchor round of each reference venue that is not under test, read concurrently.
async fn read_reference_anchors(tracked: &[TrackedVenue], under_test: &[String], http: &reqwest::Client, prices: &mut Prices) {
    let references: Vec<&TrackedVenue> = tracked
        .iter()
        .filter(|venue| REFERENCE_VENUES.contains(&venue.id.as_str()) && !under_test.contains(&venue.id))
        .collect();
    let rounds = join_all(references.iter().map(|venue| reference_round(&venue.id, &venue.markets, http))).await;

    for (venue, round) in references.into_iter().zip(rounds) {
        let rows = match round {
            Ok(rows) => rows,
            Err(error) => {
                println!("{}: reference anchor round failed: {error:#}", venue.id);
                continue;
            }
        };
        let mut read = 0;
        for market in &venue.markets {
            let Some(row) = rows.get(&market.market.raw_market_id) else {
                continue;
            };
            let scale = market.market.price_scale;
            let anchor = Anchor { index: row.index * scale, mark: row.mark * scale };
            if anchor.price().is_finite() && anchor.price() > 0.0 {
                prices.anchors.insert(market.slot, anchor);
                read += 1;
            }
        }
        println!("{}: {read} reference anchors for {} markets", venue.id, venue.markets.len());
    }
}

async fn reference_round(id: &str, markets: &[TrackedMarket], http: &reqwest::Client) -> anyhow::Result<AnchorMap> {
    let ts = now_ms();
    match id {
        "binance" => Binance::new(markets).fetch_round(http, ts).await,
        "bybit" => Bybit::new(markets).fetch_round(http, ts).await,
        "okx" => Okx::new(markets).fetch_round(http, ts).await,
        "gate" => Gate::new().fetch_round(http, ts).await,
        "mexc" => Mexc::new().fetch_round(http, ts).await,
        _ => anyhow::bail!("{id} is not a reference venue"),
    }
}

fn record_price(prices: &mut Prices, index: &ClusterIndex, event: EngineEvent) {
    match event {
        EngineEvent::Book(update) => {
            if let (Some(bid), Some(ask)) = (update.bids.as_slice().first(), update.asks.as_slice().first())
                && let Some(market) = &index.clusters[update.slot.cluster].markets[update.slot.venue]
            {
                let top = Top { bid: bid.price * market.price_scale, ask: ask.price * market.price_scale };
                prices.tops.insert(update.slot, top);
            }
        }
        EngineEvent::Anchors(readings) => {
            for (slot, reading) in readings {
                if let Some(market) = &index.clusters[slot.cluster].markets[slot.venue] {
                    let anchor = Anchor { index: reading.index * market.price_scale, mark: reading.mark * market.price_scale };
                    prices.anchors.insert(slot, anchor);
                }
            }
        }
        EngineEvent::Stale { .. } | EngineEvent::Sweep | EngineEvent::Shutdown => {}
    }
}

// Prints each market of one venue under test that sits more than 2 percent from the reference median, then the venue's summary.
// Returns the markets more than 10 percent away.
fn compare_venue(id: &str, index: &ClusterIndex, tracked: &[TrackedVenue], prices: &Prices) -> Vec<String> {
    let Some(venue) = tracked.iter().find(|venue| venue.id == id) else {
        println!("{id}: shares no cluster with another venue, nothing compared");
        return Vec::new();
    };

    let references = reference_columns(id, index);
    let mut identity = Identity::default();
    for market in &venue.markets {
        let raw = market.market.raw_market_id.as_str();
        let slot = market.slot;
        let own_mid = prices.tops.get(&slot).and_then(|top| top.usable_mid());
        let own_anchor = prices.anchors.get(&slot).map(|anchor| anchor.price());
        if own_mid.is_none() && own_anchor.is_none() {
            identity.no_price.push(raw);
            continue;
        }

        let used = reference_prices(slot.cluster, &references, prices);
        if used.is_empty() {
            identity.no_reference += 1;
            continue;
        }
        let (by, own) = match (own_mid, own_anchor) {
            (Some(mid), _) => (By::Mids, mid),
            (None, Some(anchor)) => (By::Anchors, anchor),
            (None, None) => continue,
        };
        if by == By::Anchors {
            identity.by_anchors.push(raw);
        }

        let mut values: Vec<f64> = used.iter().map(|&(_, price)| price).collect();
        let median = median(&mut values);
        let ratio = own / median;
        let away = (ratio - 1.0).abs();
        identity.compared += 1;
        if away <= IDENTITY_WARN {
            identity.within += 1;
            continue;
        }

        let pair = &index.clusters[slot.cluster].pair;
        let line = format!(
            "{id} {raw} {pair}: {}, against the reference anchor median {median}, ratio {ratio:.4}, references {}",
            describe_own(by, slot, prices),
            describe(&used)
        );
        println!("{line}");
        if away > IDENTITY_FAIL {
            identity.failed.push(line);
        } else {
            identity.warned += 1;
        }
    }

    println!(
        "{id}: {} compared, {} by own anchor, {} within 2 percent, {} 2 to 10 percent, {} above 10 percent, {} no reference price",
        identity.compared,
        identity.by_anchors.len(),
        identity.within,
        identity.warned,
        identity.failed.len(),
        identity.no_reference,
    );
    if !identity.by_anchors.is_empty() {
        println!("{id}: compared by own anchor, for a book over the spread limit or never two sided: {:?}", identity.by_anchors);
    }
    if !identity.no_price.is_empty() {
        println!("{id}: neither a usable mid nor an anchor, not compared: {:?}", identity.no_price);
    }
    identity.failed
}

// The reference venues other than the venue itself, each with its column in the index.
fn reference_columns(id: &str, index: &ClusterIndex) -> Vec<(&'static str, usize)> {
    let mut columns = Vec::new();
    for &reference in REFERENCE_VENUES {
        if reference != id
            && let Some(column) = index.venue_index_map.get(reference)
        {
            columns.push((reference, column));
        }
    }
    columns
}

// Each reference's mark in one cluster, or its index where it has no mark.
fn reference_prices(cluster: usize, references: &[(&'static str, usize)], prices: &Prices) -> Vec<(&'static str, f64)> {
    let mut used = Vec::new();
    for &(reference, column) in references {
        if let Some(anchor) = prices.anchors.get(&Slot { cluster, venue: column }) {
            used.push((reference, anchor.price()));
        }
    }
    used
}

fn median(values: &mut [f64]) -> f64 {
    values.sort_by(f64::total_cmp);
    let middle = values.len() / 2;
    if values.len() % 2 == 0 {
        (values[middle - 1] + values[middle]) / 2.0
    } else {
        values[middle]
    }
}

// The own side of an outlier line, with the top or the anchor reading behind the compared price.
fn describe_own(by: By, slot: Slot, prices: &Prices) -> String {
    match by {
        By::Mids => {
            let top = prices.tops[&slot];
            format!("own mid {} from bid {} ask {}", top.mid(), top.bid, top.ask)
        }
        By::Anchors => {
            let anchor = prices.anchors[&slot];
            format!("own anchor {} from mark {} index {}", anchor.price(), anchor.mark, anchor.index)
        }
    }
}

fn describe(used: &[(&str, f64)]) -> String {
    let mut parts = Vec::with_capacity(used.len());
    for (reference, price) in used {
        parts.push(format!("{reference} {price}"));
    }
    parts.join(", ")
}
