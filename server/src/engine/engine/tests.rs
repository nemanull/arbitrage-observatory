// Ported case for case from old_ts_server/src/engine/Engine.spec.ts, one module per describe block.
// mod rust_only adds the cases the TypeScript could not have: the engine loop, Levels and a column with no market.

use super::*;
use crate::engine::cluster::{ClusterAnchor, ClusterDepth, Market};
use crate::engine::opportunity::opportunity_lifecycle::OpportunityLifecycle;
use crate::engine::opportunity::opportunity_manager::MIN_CROSS_AGE_MS;
use crate::engine::opportunity::{CloseReason, Opportunity};
use crate::test_log::{Logged, Logs, capture};
use std::time::Duration;
use tokio::sync::mpsc;
use tracing::Level;
use tracing::subscriber::DefaultGuard;

const PAIR: &str = "BTC|USDT";
const RAW_MARKET_ID: &str = "BTCUSDT";
const CLUSTER: ClusterId = 0;
const BINANCE: usize = 0;
const BYBIT: usize = 1;
const LEVELS: usize = 4; // depth entries per slot, four keeps the index tables short
const TAKER_PPM: u32 = 550;
const BID_MUL: f64 = 1.0 - TAKER_PPM as f64 / 1e6;
const ASK_MUL: f64 = 1.0 + TAKER_PPM as f64 / 1e6;

// The loop's wall clock, apart from every recv_ts, so a case fails if discovery or a one-sided close reads it.
const WALL_CLOCK: i64 = 5_000;

const VALID_QUOTE: Quote = Quote {
    bid: 100.0,
    ask: 101.0,
    bid_size: 2.0,
    ask_size: 3.0,
    recv_ts: 1_000,
};

// bybit's book as the venue sends it, bids falling away from the touch and asks rising.
const BIDS: [(f64, f64); 4] = [(101.0, 2.0), (100.9, 4.0), (100.8, 1.0), (100.7, 8.0)];
const ASKS: [(f64, f64); 4] = [(101.5, 3.0), (101.6, 5.0), (101.7, 2.0), (101.8, 6.0)];

// Both venues publish the same index and mark, so the anchors explain nothing and a route opens on its raw edge.
const AGREED: AnchorReading = AnchorReading {
    index: 100.0,
    mark: 100.0,
    funding_rate: 0.0001,
    funding_interval_hours: 8.0,
    next_funding_at: 0,
    ts: 1_000,
};

fn market(venue_id: &str) -> Market {
    Market {
        venue_id: venue_id.to_string(),
        raw_market_id: RAW_MARKET_ID.to_string(),
        base: "BTC".to_string(),
        quote: "USDT".to_string(),
        taker_ppm: TAKER_PPM,
        linear: true,
        contract_size: 1.0,
        price_scale: 1.0,
    }
}

// binance in slot 0 and bybit in slot 1, with the fee multipliers filled so a cross that clears the fees can open a route.
fn make_cluster() -> Cluster {
    let width = 2;

    Cluster {
        pair: PAIR.to_string(),
        markets: vec![Some(market("binance")), Some(market("bybit"))].into_boxed_slice(),
        bid_mul: vec![BID_MUL; width].into_boxed_slice(),
        ask_mul: vec![ASK_MUL; width].into_boxed_slice(),
        size_mul: vec![1.0; width].into_boxed_slice(),
        bid: vec![0.0; width].into_boxed_slice(),
        ask: vec![0.0; width].into_boxed_slice(),
        bid_size: vec![0.0; width].into_boxed_slice(),
        ask_size: vec![0.0; width].into_boxed_slice(),
        recv_ts: vec![0; width].into_boxed_slice(),
        depth: ClusterDepth::new(width, LEVELS).unwrap(),
        anchor: ClusterAnchor::new(width),
    }
}

fn slot(venue: usize) -> Slot {
    Slot {
        cluster: CLUSTER,
        venue,
    }
}

fn levels(side: &[(f64, f64)]) -> Levels {
    let mut book_levels = Vec::new();
    for &(price, size) in side {
        book_levels.push(BookLevel { price, size });
    }
    Levels::from_slice(&book_levels)
}

fn book_update(slot: Slot, bids: &[(f64, f64)], asks: &[(f64, f64)], recv_ts: i64) -> BookUpdate {
    BookUpdate {
        slot,
        bids: levels(bids),
        asks: levels(asks),
        recv_ts,
    }
}

// The first sight of the cross only plants it, since a route opens on a tick at least MIN_CROSS_AGE_MS after the one that first showed it.
fn plant_cross_books() -> [BookUpdate; 2] {
    let seen_at = 1_000 - MIN_CROSS_AGE_MS;

    [
        book_update(slot(BINANCE), &[(99.9, 40.0)], &[(100.0, 50.0)], seen_at),
        book_update(slot(BYBIT), &[(100.95, 20.0)], &[(101.5, 30.0)], seen_at),
    ]
}

// bybit bids 101 against a binance ask of 100, about 8890 ppm after 55 bp taker each side.
fn opening_book() -> BookUpdate {
    book_update(slot(BYBIT), &[(101.0, 20.0)], &[(101.5, 30.0)], 1_000)
}

// Harness::open_route as the loop receives it.
fn open_route_events() -> Vec<EngineEvent> {
    let mut events = Vec::new();

    for venue in [BINANCE, BYBIT] {
        for _poll in 0..2 {
            events.push(EngineEvent::Anchors(vec![(slot(venue), AGREED)]));
        }
    }

    for update in plant_cross_books() {
        events.push(EngineEvent::Book(update));
    }

    events.push(EngineEvent::Book(opening_book()));
    events
}

// Equal, or both NaN, the way jest's toEqual compares numbers.
#[track_caller]
fn assert_same(actual: f64, expected: f64) {
    assert!(
        actual == expected || (actual.is_nan() && expected.is_nan()),
        "{actual} is not {expected}"
    );
}

// Passes when the two agree to `digits` decimal places, like jest's toBeCloseTo.
#[track_caller]
fn assert_close(actual: f64, expected: f64, digits: i32) {
    let tolerance = 10f64.powi(-digits) / 2.0;
    assert!(
        (actual - expected).abs() < tolerance,
        "{actual} is not within {tolerance} of {expected}"
    );
}

fn slot_range(column: &[f64], slot: usize) -> Vec<f64> {
    column[slot * LEVELS..(slot + 1) * LEVELS].to_vec()
}

// Debug prints every column, so two equal snapshots are two equal blocks.
fn snapshot(block: &impl std::fmt::Debug) -> String {
    format!("{block:?}")
}

// One engine over the BTC|USDT cluster, called the way the loop calls it.
struct Harness {
    engine: Engine,
    closed: mpsc::Receiver<Opportunity>, // the writer's end of the channel
    logs: Logs,
    _capture: DefaultGuard, // sends this thread's log lines to logs until the case ends
}

impl Harness {
    fn new() -> Self {
        Self::with_cluster(make_cluster())
    }

    fn with_cluster(cluster: Cluster) -> Self {
        let (logs, guard) = capture();
        let (tx, closed) = mpsc::channel(64);
        let manager = OpportunityManager::new(OpportunityLifecycle::new(tx));

        Self {
            engine: Engine::new(vec![cluster], manager),
            closed,
            logs,
            _capture: guard,
        }
    }

    fn cluster(&self) -> &Cluster {
        &self.engine.clusters[CLUSTER]
    }

    fn book(
        &mut self,
        venue: usize,
        bids: &[(f64, f64)],
        asks: &[(f64, f64)],
        recv_ts: i64,
    ) -> bool {
        let update = book_update(slot(venue), bids, asks, recv_ts);
        self.engine.update_book(&update, WALL_CLOCK)
    }

    // A slot's first poll reads as an unbounded move and refuses the route, so each slot is polled twice.
    fn write_agreed_anchors(&mut self) {
        for venue in [BINANCE, BYBIT] {
            for _poll in 0..2 {
                self.engine.update_anchor(slot(venue), &AGREED);
            }
        }
    }

    fn plant_cross(&mut self) {
        self.write_agreed_anchors();
        for update in plant_cross_books() {
            self.engine.update_book(&update, WALL_CLOCK);
        }
    }

    fn open_route(&mut self) {
        self.plant_cross();
        self.engine.update_book(&opening_book(), WALL_CLOCK);
    }

    // The open routes of the pair, sorted, since a HashMap has no order.
    fn routes(&self) -> Vec<&str> {
        let mut routes = Vec::new();
        if let Some(open) = self.engine.manager.lifecycle.routes(PAIR) {
            for route in open.keys() {
                routes.push(route.as_str());
            }
        }
        routes.sort();
        routes
    }

    #[track_caller]
    fn route(&self, route: &str) -> &Opportunity {
        match self
            .engine
            .manager
            .lifecycle
            .routes(PAIR)
            .and_then(|open| open.get(route))
        {
            Some(opportunity) => opportunity,
            None => panic!("{route} is not open"),
        }
    }

    // Every row the lifecycle has handed to the writer since the last call, in order.
    fn closed(&mut self) -> Vec<Opportunity> {
        let mut closed = Vec::new();
        while let Ok(opportunity) = self.closed.try_recv() {
            closed.push(opportunity);
        }
        closed
    }

    fn warnings(&self) -> Vec<Logged> {
        let mut warnings = Vec::new();
        for line in self.logs.lines() {
            if line.level == Level::WARN {
                warnings.push(line);
            }
        }
        warnings
    }

    fn rejections(&self, reason: &str) -> Vec<Logged> {
        let mut rejections = Vec::new();
        for line in self.logs.events("opportunity_rejected") {
            if line.text("reason") == reason {
                rejections.push(line);
            }
        }
        rejections
    }
}

// What one run of the engine loop left: the count its shutdown returned, the rows it closed and its log lines.
struct LoopRun {
    shutdown_closed: usize,
    rows: Vec<Opportunity>,
    logs: Logs,
}

// Runs the engine loop on its own thread, as the orchestrator does, over events queued before it starts.
fn run_loop(events: Vec<EngineEvent>) -> LoopRun {
    let (engine_tx, engine_rx) = mpsc::channel(ENGINE_QUEUE_CAPACITY);
    for event in events {
        engine_tx.try_send(event).unwrap();
    }
    drop(engine_tx); // a loop that wrongly reads past Shutdown still ends, at the closed channel

    let (closed_tx, mut closed_rx) = mpsc::channel(64);
    let manager = OpportunityManager::new(OpportunityLifecycle::new(closed_tx));
    let engine = Engine::new(vec![make_cluster()], manager);
    let (done_tx, done_rx) = std::sync::mpsc::channel();

    std::thread::spawn(move || {
        let (logs, _guard) = capture(); // the loop logs on its own thread, which a capture on the test thread misses
        let shutdown_closed = run_engine(engine, engine_rx);
        let _ = done_tx.send((shutdown_closed, logs));
    });

    // A loop that never returns fails the case instead of hanging it.
    let (shutdown_closed, logs) = done_rx
        .recv_timeout(Duration::from_secs(5))
        .expect("the engine loop returned");

    let mut rows = Vec::new();
    while let Ok(row) = closed_rx.try_recv() {
        rows.push(row);
    }

    LoopRun {
        shutdown_closed,
        rows,
        logs,
    }
}

// Engine.updateQuote was not ported, so these cases call apply_quote directly.
mod update_quote {
    use super::*;

    #[track_caller]
    fn assert_quote_columns_empty(cluster: &Cluster) {
        assert_eq!(cluster.bid.to_vec(), [0.0, 0.0]);
        assert_eq!(cluster.ask.to_vec(), [0.0, 0.0]);
        assert_eq!(cluster.bid_size.to_vec(), [0.0, 0.0]);
        assert_eq!(cluster.ask_size.to_vec(), [0.0, 0.0]);
        assert_eq!(cluster.recv_ts.to_vec(), [0, 0]);
    }

    // The quote is refused whole, and the warning carries the update it refused.
    #[track_caller]
    fn assert_reports(quote: Quote, issue: &str) {
        let mut h = Harness::new();

        h.engine.apply_quote(slot(BINANCE), quote, WALL_CLOCK);

        assert_quote_columns_empty(h.cluster());
        let rejected = h.logs.events("quote_update_rejected");
        assert_eq!(rejected.len(), 1);
        let line = &rejected[0];
        assert_eq!(line.level, Level::WARN);
        assert_eq!(line.text("reason"), "invalid_quote");
        assert_eq!(line.text("issues"), format!("{:?}", [issue]));
        assert_eq!(line.text("venue"), "binance");
        assert_eq!(line.text("market"), RAW_MARKET_ID);
        assert_eq!(line.text("pair"), PAIR);
        assert_eq!(line.number("venue_index"), BINANCE as f64);
        assert_same(line.number("bid"), quote.bid);
        assert_same(line.number("ask"), quote.ask);
        assert_same(line.number("bid_size"), quote.bid_size);
        assert_same(line.number("ask_size"), quote.ask_size);
        assert_eq!(line.number("recv_ts"), quote.recv_ts as f64);
    }

    #[test]
    fn updates_the_quote_at_venue_index_zero() {
        let mut h = Harness::new();

        h.engine.apply_quote(slot(BINANCE), VALID_QUOTE, WALL_CLOCK);

        let cluster = h.cluster();
        assert_eq!(cluster.bid[0], 100.0);
        assert_eq!(cluster.ask[0], 101.0);
        assert_eq!(cluster.bid_size[0], 2.0);
        assert_eq!(cluster.ask_size[0], 3.0);
        assert_eq!(cluster.recv_ts[0], 1_000);
    }

    #[test]
    fn reports_a_non_finite_bid_with_update_context() {
        assert_reports(
            Quote {
                bid: f64::NAN,
                ..VALID_QUOTE
            },
            "bid_not_finite",
        );
    }

    #[test]
    fn reports_a_non_positive_bid_with_update_context() {
        assert_reports(
            Quote {
                bid: 0.0,
                ..VALID_QUOTE
            },
            "bid_not_positive",
        );
    }

    #[test]
    fn reports_a_non_finite_ask_with_update_context() {
        assert_reports(
            Quote {
                ask: f64::INFINITY,
                ..VALID_QUOTE
            },
            "ask_not_finite",
        );
    }

    #[test]
    fn reports_a_non_positive_ask_with_update_context() {
        assert_reports(
            Quote {
                ask: -1.0,
                ..VALID_QUOTE
            },
            "ask_not_positive",
        );
    }

    #[test]
    fn reports_a_crossed_quote_with_update_context() {
        assert_reports(
            Quote {
                bid: 102.0,
                ask: 101.0,
                ..VALID_QUOTE
            },
            "crossed_quote",
        );
    }

    #[test]
    fn reports_a_non_finite_bid_size_with_update_context() {
        assert_reports(
            Quote {
                bid_size: f64::NAN,
                ..VALID_QUOTE
            },
            "bid_size_not_finite",
        );
    }

    #[test]
    fn reports_a_negative_bid_size_with_update_context() {
        assert_reports(
            Quote {
                bid_size: -1.0,
                ..VALID_QUOTE
            },
            "bid_size_negative",
        );
    }

    #[test]
    fn reports_a_non_finite_ask_size_with_update_context() {
        assert_reports(
            Quote {
                ask_size: f64::INFINITY,
                ..VALID_QUOTE
            },
            "ask_size_not_finite",
        );
    }

    #[test]
    fn reports_a_negative_ask_size_with_update_context() {
        assert_reports(
            Quote {
                ask_size: -0.5,
                ..VALID_QUOTE
            },
            "ask_size_negative",
        );
    }

    #[test]
    fn reports_a_non_positive_receive_timestamp_with_update_context() {
        assert_reports(
            Quote {
                recv_ts: 0,
                ..VALID_QUOTE
            },
            "recv_ts_not_positive",
        );
    }

    #[test]
    fn reports_every_applicable_issue_for_one_rejected_quote() {
        let mut h = Harness::new();
        let quote = Quote {
            bid: f64::NAN,
            ask: -1.0,
            bid_size: -1.0,
            recv_ts: 0,
            ..VALID_QUOTE
        };

        h.engine.apply_quote(slot(BINANCE), quote, WALL_CLOCK);

        assert_quote_columns_empty(h.cluster());
        let rejected = h.logs.events("quote_update_rejected");
        assert_eq!(rejected.len(), 1);
        assert_eq!(
            rejected[0].text("issues"),
            r#"["bid_not_finite", "ask_not_positive", "bid_size_negative", "recv_ts_not_positive"]"#
        );
    }

    #[test]
    fn rate_limits_repeated_validation_warnings_and_reports_suppressed_counts() {
        let mut h = Harness::new();
        let quote = Quote {
            bid: 0.0,
            ..VALID_QUOTE
        };

        h.engine.apply_quote(slot(BINANCE), quote, 1_000);
        h.engine.apply_quote(slot(BINANCE), quote, 2_000);
        h.engine.apply_quote(slot(BINANCE), quote, 3_000);

        let warnings = h.warnings();
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].number("occurrence_count"), 1.0);
        assert_eq!(warnings[0].number("suppressed_count"), 0.0);

        h.engine.apply_quote(slot(BINANCE), quote, 11_000);

        let warnings = h.warnings();
        assert_eq!(warnings.len(), 2);
        assert_eq!(warnings[1].number("occurrence_count"), 4.0);
        assert_eq!(warnings[1].number("suppressed_count"), 2.0);
    }

    #[test]
    fn reports_a_different_validation_issue_during_the_suppression_window() {
        let mut h = Harness::new();

        let zero_bid = Quote {
            bid: 0.0,
            ..VALID_QUOTE
        };
        h.engine.apply_quote(slot(BINANCE), zero_bid, 1_000);
        let broken_ask = Quote {
            ask: f64::NAN,
            ..VALID_QUOTE
        };
        h.engine.apply_quote(slot(BINANCE), broken_ask, 1_000);

        assert_eq!(h.warnings().len(), 2);
    }
}

mod repeats_and_dead_sockets {
    use super::*;

    #[test]
    fn drops_an_identical_repeat_at_any_age_and_only_refreshes_recv_ts() {
        let mut h = Harness::new();
        h.open_route();
        // A new binance bid is a tick, so discovery samples the open route on it.
        let quote = Quote {
            bid: 99.8,
            ask: 100.0,
            bid_size: 40.0,
            ask_size: 50.0,
            recv_ts: 1_000,
        };
        h.engine.apply_quote(slot(BINANCE), quote, WALL_CLOCK);
        assert_eq!(h.route("bybit-binance").ticks_since_start, 2);

        let repeat = Quote {
            recv_ts: 120_000,
            ..quote
        };
        h.engine.apply_quote(slot(BINANCE), repeat, WALL_CLOCK);

        assert_eq!(h.route("bybit-binance").ticks_since_start, 2); // no discovery, so no sample
        assert_eq!(h.cluster().recv_ts[BINANCE], 120_000);
    }

    #[test]
    fn takes_the_same_numbers_as_a_fresh_quote_after_mark_stale() {
        let mut h = Harness::new();
        h.open_route();
        h.engine
            .mark_stale(BINANCE, &[CLUSTER], "binance#0", WALL_CLOCK);
        assert_eq!(h.cluster().recv_ts[BINANCE], 0);

        // binance's quote from before the stale
        let quote = Quote {
            bid: 99.9,
            ask: 100.0,
            bid_size: 40.0,
            ask_size: 50.0,
            recv_ts: 2_000,
        };
        h.engine.apply_quote(slot(BINANCE), quote, WALL_CLOCK);

        assert_eq!(h.cluster().recv_ts[BINANCE], 2_000);
        // Discovery saw the cross again and refused it, since mark_stale took binance's depth with its quote.
        assert_eq!(h.rejections("thin_book").len(), 1);
    }

    #[test]
    fn closes_the_open_routes_on_the_dead_markets_with_feed_down() {
        let mut h = Harness::new();
        h.open_route();
        assert_eq!(h.routes(), ["bybit-binance"]);

        let closed = h
            .engine
            .mark_stale(BYBIT, &[CLUSTER], "bybit#linear#0", WALL_CLOCK);

        assert_eq!(closed, 1);
        assert!(h.routes().is_empty());
        let rows = h.closed();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].close_reason, Some(CloseReason::FeedDown));
        assert_eq!(rows[0].closed_at, Some(WALL_CLOCK));
        let lines = h.logs.events("feed_down_closed_opportunities");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text("connection"), "bybit#linear#0");
        assert_eq!(lines[0].number("markets"), 1.0);
        assert_eq!(lines[0].number("closed"), 1.0);
    }

    #[test]
    fn flushes_on_shutdown_and_ignores_quotes_from_then_on() {
        let mut events = open_route_events();
        events.push(EngineEvent::Shutdown);
        events.extend(open_route_events());

        let run = run_loop(events);

        assert_eq!(run.shutdown_closed, 1);
        assert_eq!(run.rows.len(), 1);
        assert_eq!(run.rows[0].close_reason, Some(CloseReason::Shutdown));
        assert_eq!(run.rows[0].ticks_since_start, 1); // the books behind Shutdown would have sampled it twice more
    }
}

// Sizes land in the cluster on every message, but only a price change is a tick.
mod book_sizes {
    use super::*;

    #[test]
    fn stores_a_size_only_change_without_running_discovery() {
        let mut h = Harness::new();
        h.open_route();
        let size_only = Quote {
            bid: 101.0,
            ask: 101.5,
            bid_size: 6.0,
            ask_size: 7.0,
            recv_ts: 2_000,
        };

        h.engine.apply_quote(slot(BYBIT), size_only, WALL_CLOCK);

        let cluster = h.cluster();
        assert_eq!(cluster.bid_size[BYBIT], 6.0);
        assert_eq!(cluster.ask_size[BYBIT], 7.0);
        assert_eq!(cluster.recv_ts[BYBIT], 2_000);
        let opened = h.route("bybit-binance");
        assert_eq!(opened.ticks_since_start, 1); // a discovery run would have sampled it
        assert_eq!(opened.last_highest_bid_size, 20.0);

        // the next price tick reads the stored size
        let price_tick = Quote {
            bid: 101.1,
            recv_ts: 3_000,
            ..size_only
        };
        h.engine.apply_quote(slot(BYBIT), price_tick, WALL_CLOCK);

        let opened = h.route("bybit-binance");
        assert_eq!(opened.ticks_since_start, 2);
        assert_eq!(opened.last_highest_bid_size, 6.0);
    }

    #[test]
    fn rejects_a_negative_size_and_leaves_the_slot_as_it_was() {
        let mut h = Harness::new();
        h.engine.apply_quote(slot(BINANCE), VALID_QUOTE, WALL_CLOCK);
        let negative = Quote {
            bid: 100.5,
            ask: 101.5,
            bid_size: -1.0,
            ask_size: 4.0,
            recv_ts: 2_000,
        };

        h.engine.apply_quote(slot(BINANCE), negative, WALL_CLOCK);

        let rejected = h.logs.events("quote_update_rejected");
        assert_eq!(rejected.len(), 1);
        assert_eq!(rejected[0].text("issues"), r#"["bid_size_negative"]"#);
        assert_eq!(rejected[0].number("bid_size"), -1.0);
        assert_eq!(rejected[0].number("ask_size"), 4.0);
        let cluster = h.cluster();
        assert_eq!(cluster.bid[BINANCE], 100.0);
        assert_eq!(cluster.ask[BINANCE], 101.0);
        assert_eq!(cluster.bid_size[BINANCE], 2.0);
        assert_eq!(cluster.ask_size[BINANCE], 3.0);
        assert_eq!(cluster.recv_ts[BINANCE], 1_000);
    }

    #[test]
    fn takes_a_zero_size_as_an_empty_level_not_a_broken_message() {
        let mut h = Harness::new();
        let empty_levels = Quote {
            bid_size: 0.0,
            ask_size: 0.0,
            ..VALID_QUOTE
        };

        h.engine
            .apply_quote(slot(BINANCE), empty_levels, WALL_CLOCK);

        assert!(h.warnings().is_empty());
        assert_eq!(h.cluster().bid[BINANCE], 100.0);
        assert_eq!(h.cluster().recv_ts[BINANCE], 1_000);
    }
}

// updateDepth was not ported, so these cases write the block through update_book.
mod depth_block {
    use super::*;

    const WRITTEN_AT: i64 = 1_000;

    #[track_caller]
    fn assert_slot_untouched(depth: &ClusterDepth, slot: usize) {
        let empty = vec![0.0; LEVELS];
        assert_eq!(slot_range(&depth.bid_price, slot), empty);
        assert_eq!(slot_range(&depth.bid_size, slot), empty);
        assert_eq!(slot_range(&depth.ask_price, slot), empty);
        assert_eq!(slot_range(&depth.ask_size, slot), empty);
        assert_eq!(depth.bid_level_count[slot], 0);
        assert_eq!(depth.ask_level_count[slot], 0);
        assert_eq!(depth.written_at[slot], 0);
    }

    #[track_caller]
    fn assert_rejects(bids: &[(f64, f64)], asks: &[(f64, f64)], ts: i64, issue: &str) {
        let mut h = Harness::new();
        h.book(BYBIT, &BIDS, &ASKS, WRITTEN_AT);
        let before = snapshot(&h.cluster().depth);

        assert!(!h.book(BYBIT, bids, asks, ts));

        assert_eq!(snapshot(&h.cluster().depth), before);
        let warnings = h.warnings();
        assert_eq!(warnings.len(), 1);
        let line = &warnings[0];
        assert_eq!(line.text("event"), "depth_update_rejected");
        assert_eq!(line.text("venue"), "bybit");
        assert_eq!(line.text("market"), RAW_MARKET_ID);
        assert_eq!(line.text("pair"), PAIR);
        assert_eq!(line.text("issue"), issue);
        assert_eq!(line.number("bids"), bids.len() as f64);
        assert_eq!(line.number("asks"), asks.len() as f64);
    }

    // A slot is resolved at boot, so an unknown market or venue is a slot past the end of the index.
    #[track_caller]
    fn assert_rejects_unknown(unknown: Slot) {
        let mut h = Harness::new();
        let update = book_update(unknown, &BIDS, &ASKS, WRITTEN_AT);

        assert!(!h.engine.update_book(&update, WALL_CLOCK));

        assert_slot_untouched(&h.cluster().depth, BINANCE);
        assert_slot_untouched(&h.cluster().depth, BYBIT);
        let warnings = h.warnings();
        assert_eq!(warnings.len(), 1);
        let line = &warnings[0];
        assert_eq!(line.text("event"), "book_update_rejected");
        assert_eq!(line.number("cluster"), unknown.cluster as f64);
        assert_eq!(line.number("venue_index"), unknown.venue as f64);
        assert_eq!(line.text("issue"), "unknown_market");
    }

    #[test]
    fn writes_both_sides_into_the_slot_range_and_stamps_the_slot() {
        let mut h = Harness::new();

        assert!(h.book(BYBIT, &BIDS, &ASKS, WRITTEN_AT));

        let depth = &h.cluster().depth;
        assert_eq!(
            slot_range(&depth.bid_price, BYBIT),
            [101.0, 100.9, 100.8, 100.7]
        );
        assert_eq!(slot_range(&depth.bid_size, BYBIT), [2.0, 4.0, 1.0, 8.0]);
        assert_eq!(
            slot_range(&depth.ask_price, BYBIT),
            [101.5, 101.6, 101.7, 101.8]
        );
        assert_eq!(slot_range(&depth.ask_size, BYBIT), [3.0, 5.0, 2.0, 6.0]);
        assert_eq!(depth.bid_level_count.to_vec(), [0, 4]);
        assert_eq!(depth.ask_level_count.to_vec(), [0, 4]);
        assert_eq!(depth.written_at.to_vec(), [0, WRITTEN_AT]);
        assert_slot_untouched(depth, BINANCE);
    }

    #[test]
    fn keeps_the_first_four_levels_of_a_deeper_side() {
        let mut h = Harness::new();
        let mut bids = BIDS.to_vec();
        bids.push((100.6, 1.0));
        bids.push((100.5, 1.0));
        let mut asks = ASKS.to_vec();
        asks.push((101.9, 1.0));
        asks.push((102.0, 1.0));

        // slot 0 is written so a missed truncation would spill into slot 1's range
        assert!(h.book(BINANCE, &bids, &asks, WRITTEN_AT));

        let depth = &h.cluster().depth;
        assert_eq!(
            slot_range(&depth.bid_price, BINANCE),
            [101.0, 100.9, 100.8, 100.7]
        );
        assert_eq!(
            slot_range(&depth.ask_price, BINANCE),
            [101.5, 101.6, 101.7, 101.8]
        );
        assert_eq!(depth.bid_level_count[BINANCE], 4);
        assert_eq!(depth.ask_level_count[BINANCE], 4);
        assert_slot_untouched(depth, BYBIT);
    }

    #[test]
    fn records_the_count_of_a_short_side() {
        let mut h = Harness::new();

        assert!(h.book(BYBIT, &BIDS[..2], &ASKS[..2], WRITTEN_AT));

        // entries past the count are unreachable, so the tail is not asserted
        let depth = &h.cluster().depth;
        assert_eq!(slot_range(&depth.bid_price, BYBIT)[..2], [101.0, 100.9]);
        assert_eq!(slot_range(&depth.ask_price, BYBIT)[..2], [101.5, 101.6]);
        assert_eq!(depth.bid_level_count[BYBIT], 2);
        assert_eq!(depth.ask_level_count[BYBIT], 2);
        assert_eq!(depth.written_at[BYBIT], WRITTEN_AT);
    }

    #[test]
    fn accepts_a_one_sided_book() {
        let mut h = Harness::new();

        assert!(h.book(BYBIT, &BIDS[..3], &[], WRITTEN_AT));

        assert!(h.warnings().is_empty());
        let depth = &h.cluster().depth;
        assert_eq!(depth.bid_level_count[BYBIT], 3);
        assert_eq!(depth.ask_level_count[BYBIT], 0);
        assert_eq!(depth.written_at[BYBIT], WRITTEN_AT);
    }

    #[test]
    fn rejects_a_depth_update_with_non_positive_bid_price_whole_and_leaves_the_slot_as_it_was() {
        assert_rejects(&[(0.0, 1.0)], &ASKS, 2_000, "bid_price_invalid");
    }

    #[test]
    fn rejects_a_depth_update_with_negative_ask_size_whole_and_leaves_the_slot_as_it_was() {
        assert_rejects(&BIDS, &[(101.5, -1.0)], 2_000, "ask_size_invalid");
    }

    #[test]
    fn rejects_a_depth_update_with_ascending_bids_whole_and_leaves_the_slot_as_it_was() {
        assert_rejects(
            &[(100.9, 1.0), (101.0, 1.0)],
            &ASKS,
            2_000,
            "bids_out_of_order",
        );
    }

    #[test]
    fn rejects_a_depth_update_with_descending_asks_whole_and_leaves_the_slot_as_it_was() {
        assert_rejects(
            &BIDS,
            &[(101.6, 1.0), (101.5, 1.0)],
            2_000,
            "asks_out_of_order",
        );
    }

    #[test]
    fn rejects_a_depth_update_with_timestamp_of_zero_whole_and_leaves_the_slot_as_it_was() {
        assert_rejects(&BIDS[1..], &ASKS[1..], 0, "ts_not_positive");
    }

    #[test]
    fn rejects_a_write_for_an_unknown_market() {
        assert_rejects_unknown(Slot {
            cluster: 1,
            venue: BINANCE,
        });
    }

    #[test]
    fn rejects_a_write_for_an_unknown_venue() {
        assert_rejects_unknown(Slot {
            cluster: CLUSTER,
            venue: 2,
        });
    }

    #[test]
    fn drops_a_write_after_shutdown_and_changes_nothing() {
        let mut events = open_route_events();
        events.push(EngineEvent::Shutdown);
        // The shallower book moves bybit's top, so reading it would sample the open route.
        let shallower = book_update(slot(BYBIT), &BIDS[1..], &ASKS[1..], 10_000);
        events.push(EngineEvent::Book(shallower));

        let run = run_loop(events);

        assert_eq!(run.rows.len(), 1);
        let row = &run.rows[0];
        assert_eq!(row.close_reason, Some(CloseReason::Shutdown));
        assert_eq!(row.ticks_since_start, 1);
        assert_eq!(row.last_seen_at, 1_000);
    }
}

mod anchor_block {
    use super::*;

    // bybit's SOPH anchor on 2026-09-08 at 06:36 UTC: the perp half a percent under its index, shorts paying longs every four hours.
    const READING: AnchorReading = AnchorReading {
        index: 0.01,
        mark: 0.00995,
        funding_rate: -0.00156,
        funding_interval_hours: 4.0,
        next_funding_at: 1_757_318_400_000,
        ts: 1_000,
    };

    // ClusterAnchor::new starts move_ppm at infinity, the reading of a slot never polled.
    #[track_caller]
    fn assert_slot_untouched(anchor: &ClusterAnchor, slot: usize) {
        assert_eq!(anchor.index[slot], 0.0);
        assert_eq!(anchor.mark[slot], 0.0);
        assert_eq!(anchor.move_ppm[slot], f64::INFINITY);
        assert_eq!(anchor.funding_rate[slot], 0.0);
        assert_eq!(anchor.funding_interval_hours[slot], 0.0);
        assert_eq!(anchor.next_funding_at[slot], 0);
        assert_eq!(anchor.written_at[slot], 0);
    }

    #[track_caller]
    fn assert_larger_move(index: f64, mark: f64) {
        let mut h = Harness::new();
        let first = AnchorReading {
            index: 100.0,
            mark: 100.0,
            ..READING
        };
        h.engine.update_anchor(slot(BYBIT), &first);

        let second = AnchorReading {
            index,
            mark,
            ts: 2_000,
            ..READING
        };
        h.engine.update_anchor(slot(BYBIT), &second);

        let anchor = &h.cluster().anchor;
        assert_eq!(anchor.move_ppm[BYBIT], 10_000.0); // one percent on one, half a percent on the other
        assert_slot_untouched(anchor, BINANCE);
    }

    #[track_caller]
    fn assert_takes_funding_rate(funding_rate: f64) {
        let mut h = Harness::new();
        let reading = AnchorReading {
            funding_rate,
            ..READING
        };

        assert!(h.engine.update_anchor(slot(BYBIT), &reading));

        assert_eq!(h.cluster().anchor.funding_rate[BYBIT], funding_rate);
    }

    #[track_caller]
    fn assert_rejects(reading: AnchorReading, issue: &str) {
        let mut h = Harness::new();
        h.engine.update_anchor(slot(BYBIT), &READING);
        let before = snapshot(&h.cluster().anchor);

        assert!(!h.engine.update_anchor(slot(BYBIT), &reading));

        assert_eq!(snapshot(&h.cluster().anchor), before);
        let warnings = h.warnings();
        assert_eq!(warnings.len(), 1);
        let line = &warnings[0];
        assert_eq!(line.text("event"), "anchor_update_rejected");
        assert_eq!(line.text("venue"), "bybit");
        assert_eq!(line.text("market"), RAW_MARKET_ID);
        assert_eq!(line.text("pair"), PAIR);
        assert_eq!(line.text("issue"), issue);
    }

    #[track_caller]
    fn assert_rejects_unknown(unknown: Slot) {
        let mut h = Harness::new();

        assert!(!h.engine.update_anchor(unknown, &READING));

        assert_slot_untouched(&h.cluster().anchor, BINANCE);
        assert_slot_untouched(&h.cluster().anchor, BYBIT);
        let warnings = h.warnings();
        assert_eq!(warnings.len(), 1);
        let line = &warnings[0];
        assert_eq!(line.text("event"), "anchor_update_rejected");
        assert_eq!(line.number("cluster"), unknown.cluster as f64);
        assert_eq!(line.number("venue_index"), unknown.venue as f64);
        assert_eq!(line.text("issue"), "unknown_market");
    }

    #[test]
    fn writes_the_reading_into_the_slot_and_stamps_it() {
        let mut h = Harness::new();

        assert!(h.engine.update_anchor(slot(BYBIT), &READING));

        let anchor = &h.cluster().anchor;
        assert_eq!(anchor.index[BYBIT], 0.01);
        assert_eq!(anchor.mark[BYBIT], 0.00995);
        assert_eq!(anchor.funding_rate[BYBIT], -0.00156);
        assert_eq!(anchor.funding_interval_hours[BYBIT], 4.0);
        assert_eq!(anchor.next_funding_at[BYBIT], 1_757_318_400_000);
        assert_eq!(anchor.written_at[BYBIT], 1_000);
        assert_slot_untouched(anchor, BINANCE);
    }

    #[test]
    fn overwrites_the_slot_on_the_next_poll() {
        let mut h = Harness::new();
        h.engine.update_anchor(slot(BYBIT), &READING);
        let next_poll = AnchorReading {
            mark: 0.0099,
            funding_rate: -0.02,
            funding_interval_hours: 1.0,
            ts: 2_000,
            ..READING
        };

        h.engine.update_anchor(slot(BYBIT), &next_poll);

        let anchor = &h.cluster().anchor;
        assert_eq!(anchor.mark[BYBIT], 0.0099);
        assert_eq!(anchor.funding_rate[BYBIT], -0.02);
        assert_eq!(anchor.funding_interval_hours[BYBIT], 1.0);
        assert_eq!(anchor.written_at[BYBIT], 2_000);
    }

    // coinbase publishes an index and a rate but no mark, and a venue can leave the next settlement unknown
    #[test]
    fn takes_a_zero_mark_and_a_zero_next_funding_time_as_not_published() {
        let mut h = Harness::new();
        let unpublished = AnchorReading {
            mark: 0.0,
            next_funding_at: 0,
            ..READING
        };

        assert!(h.engine.update_anchor(slot(BYBIT), &unpublished));

        let anchor = &h.cluster().anchor;
        assert_eq!(anchor.index[BYBIT], 0.01);
        assert_eq!(anchor.mark[BYBIT], 0.0);
        assert_eq!(anchor.next_funding_at[BYBIT], 0);
        assert_eq!(anchor.written_at[BYBIT], 1_000);
    }

    // The move is what the reader refuses on a fast tape, see MAX_ANCHOR_MOVE_PPM in anchor_reading.rs.
    #[test]
    fn reads_the_first_poll_as_an_unbounded_move() {
        let mut h = Harness::new();

        h.engine.update_anchor(slot(BYBIT), &READING);

        let anchor = &h.cluster().anchor;
        assert_eq!(anchor.move_ppm[BYBIT], f64::INFINITY);
        assert_slot_untouched(anchor, BINANCE);
    }

    #[test]
    fn records_the_larger_of_the_two_moves_when_the_index_moved_more() {
        assert_larger_move(101.0, 100.5);
    }

    #[test]
    fn records_the_larger_of_the_two_moves_when_the_mark_moved_more() {
        assert_larger_move(100.5, 101.0);
    }

    #[test]
    fn records_no_move_when_a_poll_repeats_the_numbers() {
        let mut h = Harness::new();
        h.engine.update_anchor(slot(BYBIT), &READING);
        let repeat = AnchorReading {
            ts: 2_000,
            ..READING
        };

        h.engine.update_anchor(slot(BYBIT), &repeat);

        assert_eq!(h.cluster().anchor.move_ppm[BYBIT], 0.0);
    }

    #[test]
    fn takes_a_funding_rate_of_0_0001() {
        assert_takes_funding_rate(0.0001);
    }

    #[test]
    fn takes_a_funding_rate_of_0() {
        assert_takes_funding_rate(0.0);
    }

    #[test]
    fn takes_a_funding_rate_of_minus_0_02() {
        assert_takes_funding_rate(-0.02);
    }

    #[test]
    fn rejects_a_non_finite_index_and_leaves_the_slot_as_it_was() {
        let reading = AnchorReading {
            index: f64::NAN,
            ..READING
        };
        assert_rejects(reading, "index_invalid");
    }

    #[test]
    fn rejects_a_zero_index_and_leaves_the_slot_as_it_was() {
        let reading = AnchorReading {
            index: 0.0,
            ..READING
        };
        assert_rejects(reading, "index_invalid");
    }

    #[test]
    fn rejects_a_negative_mark_and_leaves_the_slot_as_it_was() {
        let reading = AnchorReading {
            mark: -0.01,
            ..READING
        };
        assert_rejects(reading, "mark_invalid");
    }

    #[test]
    fn rejects_a_non_finite_funding_rate_and_leaves_the_slot_as_it_was() {
        let reading = AnchorReading {
            funding_rate: f64::INFINITY,
            ..READING
        };
        assert_rejects(reading, "funding_rate_invalid");
    }

    #[test]
    fn rejects_a_zero_funding_interval_and_leaves_the_slot_as_it_was() {
        let reading = AnchorReading {
            funding_interval_hours: 0.0,
            ..READING
        };
        assert_rejects(reading, "funding_interval_invalid");
    }

    #[test]
    fn rejects_a_negative_next_funding_time_and_leaves_the_slot_as_it_was() {
        let reading = AnchorReading {
            next_funding_at: -1,
            ..READING
        };
        assert_rejects(reading, "next_funding_at_invalid");
    }

    #[test]
    fn rejects_a_timestamp_of_zero_and_leaves_the_slot_as_it_was() {
        let reading = AnchorReading { ts: 0, ..READING };
        assert_rejects(reading, "ts_not_positive");
    }

    #[test]
    fn rejects_a_write_for_an_unknown_market() {
        assert_rejects_unknown(Slot {
            cluster: 1,
            venue: BINANCE,
        });
    }

    #[test]
    fn rejects_a_write_for_an_unknown_venue() {
        assert_rejects_unknown(Slot {
            cluster: CLUSTER,
            venue: 2,
        });
    }

    // An anchor write is not a tick.
    #[test]
    fn runs_no_discovery_and_leaves_layer_1_alone() {
        let mut h = Harness::new();
        h.open_route(); // a discovery run on either leg would sample the open route

        let next_poll = AnchorReading {
            ts: 2_000,
            ..READING
        };
        assert!(h.engine.update_anchor(slot(BYBIT), &next_poll));

        assert_eq!(h.route("bybit-binance").ticks_since_start, 1);
        let cluster = h.cluster();
        assert_eq!(cluster.bid[BYBIT], 101.0);
        assert_eq!(cluster.ask[BYBIT], 101.5);
        assert_eq!(cluster.recv_ts[BYBIT], 1_000);
    }

    #[test]
    fn drops_a_write_after_shutdown_and_changes_nothing() {
        // A reading the engine refuses, so reading it would leave a warning.
        let refused = AnchorReading { ts: 0, ..READING };
        let events = vec![
            EngineEvent::Anchors(vec![(slot(BYBIT), READING)]),
            EngineEvent::Shutdown,
            EngineEvent::Anchors(vec![(slot(BYBIT), refused)]),
        ];

        let run = run_loop(events);

        assert_eq!(run.shutdown_closed, 0);
        assert!(run.logs.events("anchor_update_rejected").is_empty());
    }

    // The socket that died never wrote the anchor, so a dead socket says nothing about it.
    #[test]
    fn survives_mark_stale_which_clears_the_quote_and_the_depth() {
        let mut h = Harness::new();
        h.book(BYBIT, &[(101.0, 2.0)], &[(101.5, 3.0)], 1_000);
        h.engine.update_anchor(slot(BYBIT), &READING);

        h.engine
            .mark_stale(BYBIT, &[CLUSTER], "bybit#0", WALL_CLOCK);

        let cluster = h.cluster();
        assert_eq!(cluster.recv_ts[BYBIT], 0);
        assert_eq!(cluster.depth.written_at[BYBIT], 0);
        assert_eq!(cluster.anchor.index[BYBIT], 0.01);
        assert_eq!(cluster.anchor.written_at[BYBIT], 1_000);
    }
}

// One book message writes the block and the level zero quote together.
mod update_book {
    use super::*;

    #[test]
    fn writes_the_block_and_level_zero_and_runs_discovery_once() {
        let mut h = Harness::new();
        h.plant_cross(); // so the discovery this book runs opens bybit-binance

        assert!(h.book(BYBIT, &BIDS, &ASKS, 1_000));

        let cluster = h.cluster();
        let depth = &cluster.depth;
        assert_eq!(
            slot_range(&depth.bid_price, BYBIT),
            [101.0, 100.9, 100.8, 100.7]
        );
        assert_eq!(slot_range(&depth.ask_size, BYBIT), [3.0, 5.0, 2.0, 6.0]);
        assert_eq!(depth.bid_level_count[BYBIT], 4);
        assert_eq!(depth.ask_level_count[BYBIT], 4);
        assert_eq!(depth.written_at[BYBIT], 1_000);
        assert_eq!(cluster.bid[BYBIT], 101.0);
        assert_eq!(cluster.ask[BYBIT], 101.5);
        assert_eq!(cluster.bid_size[BYBIT], 2.0);
        assert_eq!(cluster.ask_size[BYBIT], 3.0);
        assert_eq!(cluster.recv_ts[BYBIT], 1_000);
        assert_eq!(h.route("bybit-binance").ticks_since_start, 1); // a second run would have sampled it
    }

    #[test]
    fn rewrites_the_block_on_an_unchanged_top_without_running_discovery() {
        let mut h = Harness::new();
        h.plant_cross();
        h.book(BYBIT, &BIDS, &ASKS, 1_000); // opens bybit-binance

        let deeper = [BIDS[0], (100.95, 9.0), BIDS[1], BIDS[2]];
        h.book(BYBIT, &deeper, &ASKS, 2_000);

        assert_eq!(h.route("bybit-binance").ticks_since_start, 1); // a discovery run would have sampled it
        let cluster = h.cluster();
        assert_eq!(
            slot_range(&cluster.depth.bid_price, BYBIT),
            [101.0, 100.95, 100.9, 100.8]
        );
        assert_eq!(cluster.depth.written_at[BYBIT], 2_000);
        assert_eq!(cluster.recv_ts[BYBIT], 2_000);
    }

    #[test]
    fn opens_a_route_from_the_tops_of_two_books_and_walks_their_ladders_at_the_open() {
        let mut h = Harness::new();
        h.write_agreed_anchors();
        let mut first_sight = BIDS;
        first_sight[0] = (100.95, 2.0);

        h.book(
            BINANCE,
            &[(99.9, 4.0)],
            &[(100.0, 10.0), (100.1, 2.0)],
            1_000,
        );
        h.book(BYBIT, &first_sight, &ASKS, 1_000 - MIN_CROSS_AGE_MS);
        h.book(BYBIT, &BIDS, &ASKS, 1_000);

        assert_eq!(h.routes(), ["bybit-binance"]);
        // Buying binance's twelve asks against bybit's fifteen bids never stops crossing, so the region is the whole held ask side.
        let opportunity = h.route("bybit-binance");
        let edge = opportunity.edge_at_open.expect("both legs hold depth");
        assert_close(edge.size, 12.0, 9);
        assert!(edge.exhausted);
        assert_eq!(edge.buy_levels, 2);
        assert!(edge.avg_ppm > 5_000.0);
        assert_eq!(opportunity.edge_samples, 1);
    }

    #[test]
    fn keeps_the_one_side_of_a_one_sided_book_and_drops_the_quote_closing_its_routes() {
        let mut h = Harness::new();
        h.open_route();
        assert_eq!(h.routes().len(), 1);

        assert!(h.book(BYBIT, &BIDS, &[], 3_000));

        let cluster = h.cluster();
        assert_eq!(cluster.depth.bid_level_count[BYBIT], 4);
        assert_eq!(cluster.depth.ask_level_count[BYBIT], 0);
        assert_eq!(cluster.depth.written_at[BYBIT], 3_000);
        assert_eq!(cluster.recv_ts[BYBIT], 0);
        assert_eq!(cluster.bid[BYBIT], 101.0); // the last quote stays readable, the zero recv_ts is what says it is not live
        assert!(h.routes().is_empty());
        let rows = h.closed();
        assert_eq!(rows.len(), 1);
        assert_eq!(rows[0].close_reason, Some(CloseReason::FeedDown));
        assert_eq!(rows[0].closed_at, Some(3_000)); // the book's own recv_ts, not the loop's wall clock
        let warnings = h.warnings();
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].text("event"), "book_one_sided");
        assert_eq!(warnings[0].text("venue"), "bybit");
        assert_eq!(warnings[0].text("market"), RAW_MARKET_ID);
        assert_eq!(warnings[0].text("empty_side"), "asks");
        assert_eq!(warnings[0].number("closed"), 1.0);

        // The side stays empty on the next message, and nothing is logged again.
        h.book(BYBIT, &BIDS, &[], 4_000);
        assert_eq!(h.warnings().len(), 1);
    }

    #[test]
    fn takes_a_book_with_both_sides_back_as_a_fresh_quote_after_a_one_sided_one() {
        let mut h = Harness::new();
        h.plant_cross();
        h.book(BYBIT, &BIDS, &ASKS, 1_000); // opens bybit-binance
        h.book(BYBIT, &BIDS, &[], 2_000); // and closes it

        h.book(BYBIT, &BIDS, &ASKS, 3_000);

        assert_eq!(h.cluster().recv_ts[BYBIT], 3_000);
        // The returning book's discovery planted the cross, so a binance tick MIN_CROSS_AGE_MS later opens it.
        let confirmed_at = 3_000 + MIN_CROSS_AGE_MS;
        h.book(BINANCE, &[(99.9, 40.0)], &[(99.95, 50.0)], confirmed_at);
        assert_eq!(h.routes(), ["bybit-binance"]);
        assert_eq!(h.route("bybit-binance").opened_at, confirmed_at);
    }

    #[test]
    fn rejects_an_out_of_order_side_whole_and_leaves_both_the_block_and_the_quote_as_they_were() {
        let mut h = Harness::new();
        h.book(BYBIT, &BIDS, &ASKS, 1_000);
        let mut reversed = BIDS;
        reversed.reverse();

        assert!(!h.book(BYBIT, &reversed, &ASKS, 2_000));

        let cluster = h.cluster();
        assert_eq!(
            slot_range(&cluster.depth.bid_price, BYBIT),
            [101.0, 100.9, 100.8, 100.7]
        );
        assert_eq!(cluster.depth.written_at[BYBIT], 1_000);
        assert_eq!(cluster.recv_ts[BYBIT], 1_000);
        let rejected = h.logs.events("depth_update_rejected");
        assert_eq!(rejected.len(), 1);
        assert_eq!(rejected[0].level, Level::WARN);
        assert_eq!(rejected[0].text("issue"), "bids_out_of_order");
    }

    #[test]
    fn warns_and_writes_nothing_for_an_unknown_market() {
        let mut h = Harness::new();
        let no_such_cluster = Slot {
            cluster: 1,
            venue: BYBIT,
        };

        let update = book_update(no_such_cluster, &BIDS, &ASKS, 1_000);
        assert!(!h.engine.update_book(&update, WALL_CLOCK));

        let rejected = h.logs.events("book_update_rejected");
        assert_eq!(rejected.len(), 1);
        assert_eq!(rejected[0].level, Level::WARN);
        assert_eq!(rejected[0].text("issue"), "unknown_market");
    }

    #[test]
    fn drops_a_book_after_shutdown() {
        let mut events = open_route_events();
        events.push(EngineEvent::Shutdown);
        // A book that collapses the cross, so reading it would close the route before the flush.
        let collapsing = book_update(slot(BYBIT), &[(100.0, 2.0)], &ASKS, 10_000);
        events.push(EngineEvent::Book(collapsing));

        let run = run_loop(events);

        assert_eq!(run.shutdown_closed, 1);
        assert_eq!(run.rows.len(), 1);
        assert_eq!(run.rows[0].close_reason, Some(CloseReason::Shutdown));
    }

    #[test]
    fn clears_the_depth_slot_with_the_quote_on_mark_stale() {
        let mut h = Harness::new();
        h.book(BYBIT, &BIDS, &ASKS, 1_000);

        h.engine
            .mark_stale(BYBIT, &[CLUSTER], "bybit#0", WALL_CLOCK);

        let cluster = h.cluster();
        assert_eq!(cluster.recv_ts[BYBIT], 0);
        assert_eq!(cluster.depth.bid_level_count[BYBIT], 0);
        assert_eq!(cluster.depth.ask_level_count[BYBIT], 0);
        assert_eq!(cluster.depth.written_at[BYBIT], 0);
    }
}

mod rust_only {
    use super::*;

    #[test]
    fn dispatches_anchors_and_books_to_their_methods() {
        let mut events = open_route_events();
        events.push(EngineEvent::Shutdown);

        let run = run_loop(events);

        assert_eq!(run.shutdown_closed, 1);
        assert_eq!(run.rows.len(), 1);
        assert_eq!(run.rows[0].opened_at, 1_000); // the book's recv_ts, though the loop passed the wall clock
    }

    #[test]
    fn dispatches_stale_to_mark_stale_at_the_wall_clock() {
        let mut events = open_route_events();
        events.push(EngineEvent::Stale {
            venue: BYBIT,
            clusters: vec![CLUSTER],
            connection: "bybit#linear#0".to_string(),
        });
        events.push(EngineEvent::Shutdown);
        let started = now_ms();

        let run = run_loop(events);

        let finished = now_ms();
        assert_eq!(run.shutdown_closed, 0);
        assert_eq!(run.rows.len(), 1);
        assert_eq!(run.rows[0].close_reason, Some(CloseReason::FeedDown));
        let closed_at = run.rows[0].closed_at.expect("a closed row");
        assert!(started <= closed_at && closed_at <= finished);
        let lines = run.logs.events("feed_down_closed_opportunities");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].text("connection"), "bybit#linear#0");
        assert_eq!(lines[0].number("closed"), 1.0);
    }

    #[test]
    fn dispatches_sweep_and_logs_only_a_sweep_that_closed_something() {
        let mut events = vec![EngineEvent::Sweep]; // nothing is open yet
        events.extend(open_route_events());
        events.push(EngineEvent::Sweep);
        events.push(EngineEvent::Shutdown);

        let run = run_loop(events);

        // The route opened at a recv_ts of 1_000, so the wall clock finds it far past the age cap.
        assert_eq!(run.shutdown_closed, 0);
        assert_eq!(run.rows.len(), 1);
        assert_eq!(run.rows[0].close_reason, Some(CloseReason::AgeCap));
        let lines = run.logs.events("sweep_closed_opportunities");
        assert_eq!(lines.len(), 1);
        assert_eq!(lines[0].number("closed"), 1.0);
    }

    #[test]
    fn shuts_down_when_every_sender_is_dropped() {
        let run = run_loop(open_route_events()); // no Shutdown, and run_loop drops the only sender

        assert_eq!(run.shutdown_closed, 1);
        assert_eq!(run.rows.len(), 1);
        assert_eq!(run.rows[0].close_reason, Some(CloseReason::Shutdown));
    }

    #[test]
    fn levels_keep_only_the_first_depth_level_levels_of_a_longer_side() {
        let mut side = Vec::new();
        for l in 0..DEPTH_LEVEL + 5 {
            side.push(BookLevel {
                price: 100.0 - l as f64,
                size: 1.0,
            });
        }

        let kept = Levels::from_slice(&side);

        assert_eq!(kept.as_slice(), &side[..DEPTH_LEVEL]);
    }

    // A cluster spans every venue, so a venue that does not list the pair leaves its column without a market.
    #[test]
    fn refuses_a_slot_whose_venue_lists_no_market_in_the_cluster() {
        let mut cluster = make_cluster();
        cluster.markets[BYBIT] = None;
        let mut h = Harness::with_cluster(cluster);

        assert!(!h.book(BYBIT, &BIDS, &ASKS, 1_000));
        assert!(!h.engine.update_anchor(slot(BYBIT), &AGREED));

        assert_eq!(h.cluster().depth.written_at[BYBIT], 0);
        assert_eq!(h.cluster().anchor.written_at[BYBIT], 0);
        let book = h.logs.events("book_update_rejected");
        assert_eq!(book.len(), 1);
        assert_eq!(book[0].text("issue"), "unknown_market");
        let anchor = h.logs.events("anchor_update_rejected");
        assert_eq!(anchor.len(), 1);
        assert_eq!(anchor[0].text("issue"), "unknown_market");
    }
}
