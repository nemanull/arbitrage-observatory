// Checks against the real venues, which run only on request:
// LIVE_VENUES=binance,okx cargo test live_catalog -- --ignored --nocapture
// LIVE_VENUES=binance LIVE_SECONDS=120 cargo test --release live_smoke -- --ignored --nocapture

use super::testing::tracked;
use super::{VenueRun, load_venue, start_venue};
use crate::engine::cluster::Venue;
use crate::engine::engine::{ENGINE_QUEUE_CAPACITY, EngineEvent};
use crate::test_log::capture;
use std::collections::{BTreeMap, HashSet};
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
