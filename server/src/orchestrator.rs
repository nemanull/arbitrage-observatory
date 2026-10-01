use crate::engine::cluster::{ClusterIndex, Venue};
use crate::engine::engine::{ENGINE_QUEUE_CAPACITY, Engine, EngineEvent, Slot, run_engine};
use crate::engine::opportunity::Opportunity;
use crate::engine::opportunity::opportunity_lifecycle::OpportunityLifecycle;
use crate::engine::opportunity::opportunity_manager::OpportunityManager;
use crate::feeds::TrackedMarket;
use crate::venues::{VenueRun, load_venue, start_venue};
use futures_util::future::join_all;
use std::time::Duration;
use tokio::signal::unix::{SignalKind, signal};
use tokio::sync::mpsc::{self, Sender};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio::time::{Instant, MissedTickBehavior, interval};
use tokio_util::sync::CancellationToken;

// Later this will be a db query.
const ACTIVE_VENUES: &[&str] = &["binance", "bybit", "okx", "krakenfutures", "coinbase"];

const SWEEP_EVERY: Duration = Duration::from_secs(1);

// A started run: the engine thread and every task that feeds it.
pub struct Run {
    venues: Vec<String>,
    started_at: Instant,
    cancel: CancellationToken, // stops every socket task, poll task and the sweep task
    tasks: Vec<JoinHandle<()>>,
    engine_tx: Sender<EngineEvent>,
    engine_done: oneshot::Receiver<usize>, // the routes the engine's shutdown closed, or an error if the thread died
}

struct TrackedVenue {
    id: String,
    venue_index: usize,
    markets: Vec<TrackedMarket>,
}

pub async fn start(closed_tx: Sender<Opportunity>, http: reqwest::Client) -> anyhow::Result<Run> {
    let venues = load_venues(&http).await;
    if venues.len() < 2 {
        anyhow::bail!("{} venue(s) loaded, arbitrage needs at least 2", venues.len());
    }

    let index = ClusterIndex::build_index(&venues)?;
    let tracked = tracked_venues(&index, &venues);
    if tracked.len() < 2 {
        anyhow::bail!("{} venue(s) share a cluster, arbitrage needs at least 2", tracked.len());
    }

    let clusters = index.clusters.len();
    let manager = OpportunityManager::new(OpportunityLifecycle::new(closed_tx));
    let engine = Engine::new(index.clusters, manager);
    let (engine_tx, engine_rx) = mpsc::channel(ENGINE_QUEUE_CAPACITY);
    let (done_tx, engine_done) = oneshot::channel();

    std::thread::Builder::new()
        .name("engine".to_string())
        .spawn(move || {
            let closed = run_engine(engine, engine_rx);
            let _ = done_tx.send(closed);
        })?;

    let mut run = Run {
        venues: Vec::with_capacity(tracked.len()),
        started_at: Instant::now(),
        cancel: CancellationToken::new(),
        tasks: Vec::new(),
        engine_tx,
        engine_done,
    };
    let mut markets = 0;

    for venue in tracked {
        let venue_id = venue.id.clone();
        let count = venue.markets.len();
        let started = start_venue(VenueRun {
            venue_id: venue.id,
            venue_index: venue.venue_index,
            markets: venue.markets,
            http: http.clone(),
            tx: run.engine_tx.clone(),
            cancel: run.cancel.clone(),
        });

        // Only a registry whose two match statements disagree gets here, so the run stops rather than limp.
        let handles = match started {
            Ok(handles) => handles,
            Err(error) => {
                run.stop().await;
                return Err(error);
            }
        };

        run.tasks.extend(handles);
        run.venues.push(venue_id);
        markets += count;
    }

    run.tasks.push(tokio::spawn(run_sweeper(run.engine_tx.clone(), run.cancel.clone())));

    tracing::info!(event = "orchestrator_started", venues = ?run.venues, markets, clusters);
    Ok(run)
}

impl Run {
    // Runs until SIGINT or SIGTERM, and an engine thread that ends on its own fails the run.
    pub async fn run_until_stopped(mut self) -> anyhow::Result<()> {
        tokio::select! {
            _ = shutdown_signal() => {
                // A second signal ends a stop that hangs, for example on a writer retrying against a dead database.
                tokio::spawn(async {
                    shutdown_signal().await;
                    std::process::exit(130);
                });
                self.stop().await;
                Ok(())
            }
            closed = &mut self.engine_done => {
                // Nothing has asked the engine to stop, so it panicked, and its open routes went with it.
                tracing::error!(event = "engine_stopped_unexpectedly", closed = closed.ok());
                self.stop_tasks().await;
                anyhow::bail!("the engine thread stopped on its own")
            }
        }
    }

    async fn stop_tasks(&mut self) {
        self.cancel.cancel();
        for task in self.tasks.drain(..) {
            let _ = task.await;
        }
    }

    // Feeds first, so nothing opens behind the flush, and a cancelled feed sends no Stale, so every open route closes as shutdown.
    async fn stop(mut self) -> usize {
        self.stop_tasks().await;

        let _ = self.engine_tx.send(EngineEvent::Shutdown).await;
        let closed = self.engine_done.await.unwrap_or(0);

        tracing::info!(
            event = "orchestrator_stopped",
            venues = ?self.venues,
            up_ms = self.started_at.elapsed().as_millis() as u64,
            closed,
        );

        closed
    }
}

async fn load_venues(http: &reqwest::Client) -> Vec<Venue> {
    let loads = ACTIVE_VENUES.iter().map(|id| load_venue(id, http));
    let results = join_all(loads).await;
    let mut venues = Vec::with_capacity(results.len());

    for (id, result) in ACTIVE_VENUES.iter().zip(results) {
        match result {
            Ok(venue) => {
                tracing::info!(event = "venue_loaded", venue = %venue.id, markets = venue.markets.len());
                venues.push(venue);
            }
            Err(error) => tracing::error!(event = "venue_load_failed", venue = id, error = format!("{error:#}")),
        }
    }

    venues
}

// A venue streams only the markets that sit in a cluster, since no route can use the others.
fn tracked_venues(index: &ClusterIndex, venues: &[Venue]) -> Vec<TrackedVenue> {
    let mut tracked = Vec::with_capacity(venues.len());

    for venue in venues {
        let Some(venue_index) = index.venue_index_map.get(&venue.id) else {
            continue;
        };

        let mut markets = Vec::new();
        for market in &venue.markets {
            if let Some(cluster) = index.cluster_by_raw_market_id.get(&venue.id, &market.raw_market_id) {
                markets.push(TrackedMarket {
                    market: market.clone(),
                    slot: Slot {
                        cluster,
                        venue: venue_index,
                    },
                });
            }
        }

        if markets.is_empty() {
            tracing::error!(event = "venue_untracked", venue = %venue.id, reason = "shares no cluster with another venue");
            continue;
        }

        tracing::info!(
            event = "venue_tracked",
            venue = %venue.id,
            streaming = markets.len(),
            listed = venue.markets.len(),
        );

        tracked.push(TrackedVenue {
            id: venue.id.clone(),
            venue_index,
            markets,
        });
    }

    tracked
}

// The age cap needs a timer, and the engine thread has none, so this task asks it once a second.
async fn run_sweeper(tx: Sender<EngineEvent>, cancel: CancellationToken) {
    let mut timer = interval(SWEEP_EVERY);
    timer.set_missed_tick_behavior(MissedTickBehavior::Skip);
    timer.tick().await; // the first tick is immediate, and nothing is open yet

    loop {
        tokio::select! {
            _ = cancel.cancelled() => return,
            _ = timer.tick() => {}
        }

        tokio::select! {
            _ = cancel.cancelled() => return,
            sent = tx.send(EngineEvent::Sweep) => if sent.is_err() { return },
        }
    }
}

async fn shutdown_signal() {
    let terminate = async {
        match signal(SignalKind::terminate()) {
            Ok(mut stream) => {
                stream.recv().await;
            }
            Err(error) => {
                tracing::error!(event = "signal_handler_failed", signal = "SIGTERM", %error);
                std::future::pending::<()>().await;
            }
        }
    };

    tokio::select! {
        _ = tokio::signal::ctrl_c() => tracing::info!(event = "stop_requested", signal = "SIGINT"),
        _ = terminate => tracing::info!(event = "stop_requested", signal = "SIGTERM"),
    }
}

#[cfg(test)]
mod tests {
    // Ports no TS spec, since orchestrator.ts had none.
    // The tracked market resolution of plan task 10.

    use super::*;
    use crate::engine::cluster::{ClusterId, Market};
    use crate::test_log::capture;
    use tracing::Level;

    // Every case captures its log lines, even one that reads none.
    // A thread with no subscriber that reaches a callsite first can leave it disabled for every thread.

    // A venue of linear perps, each listed as (raw id, base, quote).
    fn venue(id: &str, listings: &[(&str, &str, &str)]) -> Venue {
        let mut markets = Vec::new();
        for &(raw_market_id, base, quote) in listings {
            markets.push(Market {
                venue_id: id.to_string(),
                raw_market_id: raw_market_id.to_string(),
                base: base.to_string(),
                quote: quote.to_string(),
                taker_ppm: 500,
                linear: true,
                contract_size: 1.0,
            });
        }

        Venue {
            id: id.to_string(),
            name: id.to_string(),
            markets,
        }
    }

    fn slot(cluster: ClusterId, venue: usize) -> Slot {
        Slot { cluster, venue }
    }

    fn ids(tracked: &[TrackedVenue]) -> Vec<&str> {
        let mut ids = Vec::new();
        for venue in tracked {
            ids.push(venue.id.as_str());
        }
        ids
    }

    // Each streamed market as (raw id, slot), in listing order.
    fn slots(venue: &TrackedVenue) -> Vec<(&str, Slot)> {
        let mut slots = Vec::new();
        for tracked in &venue.markets {
            slots.push((tracked.market.raw_market_id.as_str(), tracked.slot));
        }
        slots
    }

    #[test]
    fn drops_a_market_that_sits_in_no_cluster() {
        let (logs, _capture) = capture();
        let venues = [
            venue(
                "alpha",
                &[("BTCUSDT", "BTC", "USDT"), ("DOGEUSDT", "DOGE", "USDT")],
            ),
            venue("beta", &[("BTC-USDT", "BTC", "USDT")]),
        ];
        let index = ClusterIndex::build_index(&venues).unwrap();

        let tracked = tracked_venues(&index, &venues);

        assert_eq!(ids(&tracked), ["alpha", "beta"]);
        assert_eq!(slots(&tracked[0]), [("BTCUSDT", slot(0, 0))]);
        let lines = logs.events("venue_tracked");
        assert_eq!(lines.len(), 2);
        assert_eq!(lines[0].text("venue"), "alpha");
        assert_eq!(lines[0].number("streaming"), 1.0);
        assert_eq!(lines[0].number("listed"), 2.0);
    }

    #[test]
    fn drops_a_market_that_lost_to_its_twin() {
        let (_logs, _capture) = capture();
        // alpha lists the USDC contract first, and the USDT one still wins the pair.
        let venues = [
            venue(
                "alpha",
                &[("BTCUSDC", "BTC", "USDC"), ("BTCUSDT", "BTC", "USDT")],
            ),
            venue("beta", &[("BTC-USDT", "BTC", "USDT")]),
        ];
        let index = ClusterIndex::build_index(&venues).unwrap();

        let tracked = tracked_venues(&index, &venues);

        assert_eq!(slots(&tracked[0]), [("BTCUSDT", slot(0, 0))]);
    }

    #[test]
    fn skips_a_venue_that_shares_no_cluster() {
        let (logs, _capture) = capture();
        let venues = [
            venue("alpha", &[("BTCUSDT", "BTC", "USDT")]),
            venue("gamma", &[("SOL-PERP", "SOL", "USD")]),
            venue("beta", &[("BTC-USDT", "BTC", "USDT")]),
        ];
        let index = ClusterIndex::build_index(&venues).unwrap();

        let tracked = tracked_venues(&index, &venues);

        assert_eq!(ids(&tracked), ["alpha", "beta"]);
        assert_eq!(tracked[1].venue_index, 2); // gamma keeps its column in every cluster, so beta stays third
        let untracked = logs.events("venue_untracked");
        assert_eq!(untracked.len(), 1);
        assert_eq!(untracked[0].level, Level::ERROR);
        assert_eq!(untracked[0].text("venue"), "gamma");
    }

    #[test]
    fn resolves_each_kept_market_to_its_slot() {
        let (_logs, _capture) = capture();
        let venues = [
            venue(
                "alpha",
                &[("BTCUSDT", "BTC", "USDT"), ("ETHUSDT", "ETH", "USDT")],
            ),
            venue(
                "beta",
                &[("ETH-USDT", "ETH", "USDT"), ("BTC-USDT", "BTC", "USDT")],
            ),
        ];
        let index = ClusterIndex::build_index(&venues).unwrap();

        let tracked = tracked_venues(&index, &venues);

        // Clusters take pair order, so BTC|USDT is 0 and ETH|USDT is 1, and a slot's venue is the venue's column.
        assert_eq!(tracked[0].venue_index, 0);
        assert_eq!(
            slots(&tracked[0]),
            [("BTCUSDT", slot(0, 0)), ("ETHUSDT", slot(1, 0))]
        );
        assert_eq!(tracked[1].venue_index, 1);
        assert_eq!(
            slots(&tracked[1]),
            [("ETH-USDT", slot(1, 1)), ("BTC-USDT", slot(0, 1))]
        );

        // The invariant the engine relies on: each slot is the very column that holds the market.
        for venue in &tracked {
            for tracked_market in &venue.markets {
                let slot = tracked_market.slot;
                let held = index.clusters[slot.cluster].markets[slot.venue]
                    .as_ref()
                    .unwrap();
                assert_eq!(held.raw_market_id, tracked_market.market.raw_market_id);
            }
        }
    }
}
