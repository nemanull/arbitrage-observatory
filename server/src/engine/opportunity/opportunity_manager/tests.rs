// Ported case for case from old_ts_server/src/engine/opportunity/OpportunityManager.spec.ts.
// The mapping and the cases that changed shape are in docs/plans/2026-09-30-rust-opportunity-manager-plan.md.

use super::*;
use crate::engine::cluster::{ClusterAnchor, ClusterDepth, Market};
use crate::engine::opportunity::anchor_reading::MAX_ANCHOR_MOVE_PPM;
use crate::engine::opportunity::opportunity_lifecycle::{
    CLOSURE_NET_PPM, MAX_OPPORTUNITY_AGE_MS, MAX_SERIES_LENGTH,
};
use crate::engine::opportunity::{AnchorLeg, CloseReason, NO_ANCHOR, NO_EDGE};
use std::fmt;
use std::sync::{Arc, Mutex};
use tokio::sync::mpsc::error::TryRecvError;
use tokio::sync::mpsc::{self, Receiver};
use tracing::Level;
use tracing::field::{Field, Visit};
use tracing::subscriber::DefaultGuard;
use tracing_subscriber::Layer;
use tracing_subscriber::layer::{Context, SubscriberExt};

const PAIR: &str = "BTC|USDT";
const TAKER_PPM: u32 = 550;
const BID_MUL: f64 = 1.0 - TAKER_PPM as f64 / 1e6;
const ASK_MUL: f64 = 1.0 + TAKER_PPM as f64 / 1e6;

const BINANCE: usize = 0;
const BYBIT: usize = 1;
const OKX: usize = 2;

// Every venue's index and mark in a polled cluster, so the anchors explain nothing and the fresh edge equals the raw edge.
const AGREED_INDEX: f64 = 100.0;

// Enough coins on one level that the region behind any cross near 100 clears MIN_EDGE_NOTIONAL.
const SEEDED_SIZE: f64 = 100.0;

// The clock of the anchor cases.
const NOW: i64 = 10_000;

fn market(venue_id: &str) -> Market {
    Market {
        venue_id: venue_id.to_string(),
        raw_market_id: "BTCUSDT".to_string(),
        base: "BTC".to_string(),
        quote: "USDT".to_string(),
        taker_ppm: TAKER_PPM,
        linear: true,
        contract_size: 1.0,
        price_scale: 1.0,
    }
}

// Four depth levels a slot, one seeded by each tick and the rest filled by the ladder walk cases.
// A polled cluster has every anchor agreeing at AGREED_INDEX. The anchor cases build theirs unpolled and write each reading by hand.
fn make_cluster(polled: bool) -> Cluster {
    let markets = [market("binance"), market("bybit"), market("okx")];
    let width = markets.len();
    let mut cluster = Cluster {
        pair: PAIR.to_string(),
        bid_mul: markets
            .iter()
            .map(|m| 1.0 - f64::from(m.taker_ppm) / 1_000_000.0)
            .collect(),
        ask_mul: markets
            .iter()
            .map(|m| 1.0 + f64::from(m.taker_ppm) / 1_000_000.0)
            .collect(),
        size_mul: markets.iter().map(|m| m.contract_size).collect(),
        bid: vec![0.0; width].into_boxed_slice(),
        ask: vec![0.0; width].into_boxed_slice(),
        bid_size: vec![0.0; width].into_boxed_slice(),
        ask_size: vec![0.0; width].into_boxed_slice(),
        recv_ts: vec![0; width].into_boxed_slice(),
        depth: ClusterDepth::new(width, 4).unwrap(),
        anchor: ClusterAnchor::new(width),
        markets: markets.into_iter().map(Some).collect(),
    };

    if polled {
        cluster.anchor.index.fill(AGREED_INDEX);
        cluster.anchor.mark.fill(AGREED_INDEX);
        cluster.anchor.funding_interval_hours.fill(8.0);
        cluster.anchor.move_ppm.fill(0.0); // ClusterAnchor::new starts at infinity, which reads as a first poll
    }

    cluster
}

fn set_asks(cluster: &mut Cluster, slot: usize, levels: &[(f64, f64)]) {
    let base = slot * cluster.depth.max_levels;
    for (l, &(price, size)) in levels.iter().enumerate() {
        cluster.depth.ask_price[base + l] = price;
        cluster.depth.ask_size[base + l] = size;
    }
    cluster.depth.ask_level_count[slot] = levels.len() as u8;
}

fn set_bids(cluster: &mut Cluster, slot: usize, levels: &[(f64, f64)]) {
    let base = slot * cluster.depth.max_levels;
    for (l, &(price, size)) in levels.iter().enumerate() {
        cluster.depth.bid_price[base + l] = price;
        cluster.depth.bid_size[base + l] = size;
    }
    cluster.depth.bid_level_count[slot] = levels.len() as u8;
}

// A quote arrives on a book message, so a tick rests one level at each touch.
// Only a side that holds nothing yet is seeded, so a case that fills the block itself keeps its own levels.
fn seed_depth(cluster: &mut Cluster, slot: usize, bid: f64, ask: f64) {
    if cluster.depth.bid_level_count[slot] == 0 {
        set_bids(cluster, slot, &[(bid, SEEDED_SIZE)]);
    }

    if cluster.depth.ask_level_count[slot] == 0 {
        set_asks(cluster, slot, &[(ask, SEEDED_SIZE)]);
    }
}

// One poll as the engine writes it, on a cluster built unpolled.
// bybit charges -0.38% every four hours, the others 0.01% every eight.
fn anchor_leg(cluster: &mut Cluster, slot: usize, index: f64, mark: f64, written_at: i64) {
    let anchor = &mut cluster.anchor;
    anchor.index[slot] = index;
    anchor.mark[slot] = mark;
    anchor.move_ppm[slot] = 0.0; // a slot past its second poll
    anchor.funding_rate[slot] = if slot == BYBIT { -0.0038 } else { 0.0001 };
    anchor.funding_interval_hours[slot] = if slot == BYBIT { 4.0 } else { 8.0 };
    anchor.next_funding_at[slot] = NOW + 3_600_000;
    anchor.written_at[slot] = written_at;
}

// What track_opportunity is handed for a route whose anchors agree.
// It records whatever it is given.
fn agreed_anchor() -> AnchorPair {
    let leg = AnchorLeg {
        index: AGREED_INDEX,
        mark: AGREED_INDEX,
        touch: AGREED_INDEX,
        touch_premium: 0.0,
        mark_premium: 0.0,
        fresh_premium: 0.0,
        funding_rate: 0.0,
        funding_interval_hours: 8.0,
        next_funding_at: 0,
        written_at: 1_000,
    };

    AnchorPair {
        sell: leg,
        buy: leg,
        index_gap_ppm: 0.0,
        carried_ppm: 0.0,
        fresh_net_ppm: 8_000.0,
        standing_ppm: 0.0,
    }
}

// What the lifecycle cases hand track_opportunity directly, without a tick.
fn bybit_binance_observation(cluster: &Cluster) -> Observation<'_> {
    Observation {
        cluster,
        highest_bid_market: cluster.markets[BYBIT].as_ref().unwrap(),
        lowest_ask_market: cluster.markets[BINANCE].as_ref().unwrap(),
        highest_bid_venue_index: BYBIT,
        lowest_ask_venue_index: BINANCE,
        highest_bid: 101.0,
        lowest_ask: 100.0,
        highest_bid_size: 2.0,
        lowest_ask_size: 5.0,
        highest_bid_leg_ask: 101.5,
        lowest_ask_leg_bid: 99.9,
        net_ppm: 8_000.0,
        anchor: agreed_anchor(),
        now: 1_000,
    }
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

// One log line, its numbers kept apart from its text so a case can compare either.
#[derive(Clone, Debug)]
struct Logged {
    level: Level,
    numbers: HashMap<&'static str, f64>,
    texts: HashMap<&'static str, String>,
}

impl Logged {
    #[track_caller]
    fn number(&self, field: &str) -> f64 {
        match self.numbers.get(field) {
            Some(value) => *value,
            None => panic!("{field} is not a number on {self:?}"),
        }
    }

    #[track_caller]
    fn text(&self, field: &str) -> &str {
        match self.texts.get(field) {
            Some(value) => value,
            None => panic!("{field} is not a text on {self:?}"),
        }
    }

    fn has(&self, field: &str) -> bool {
        self.numbers.contains_key(field) || self.texts.contains_key(field)
    }
}

// tracing hands each field of an event to the method for its type.
impl Visit for Logged {
    fn record_f64(&mut self, field: &Field, value: f64) {
        self.numbers.insert(field.name(), value);
    }

    fn record_i64(&mut self, field: &Field, value: i64) {
        self.numbers.insert(field.name(), value as f64);
    }

    fn record_u64(&mut self, field: &Field, value: u64) {
        self.numbers.insert(field.name(), value as f64);
    }

    fn record_bool(&mut self, field: &Field, value: bool) {
        self.texts.insert(field.name(), value.to_string());
    }

    fn record_str(&mut self, field: &Field, value: &str) {
        self.texts.insert(field.name(), value.to_string());
    }

    fn record_debug(&mut self, field: &Field, value: &dyn fmt::Debug) {
        self.texts.insert(field.name(), format!("{value:?}"));
    }
}

// Every log line of the test's own thread, in order.
#[derive(Clone, Default)]
struct Logs(Arc<Mutex<Vec<Logged>>>);

impl Logs {
    fn lines(&self) -> Vec<Logged> {
        self.0.lock().unwrap().clone()
    }

    fn events(&self, event: &str) -> Vec<Logged> {
        let mut found = Vec::new();
        for line in self.lines() {
            if line.texts.get("event").is_some_and(|value| value == event) {
                found.push(line);
            }
        }
        found
    }
}

impl<S: tracing::Subscriber> Layer<S> for Logs {
    fn on_event(&self, event: &tracing::Event<'_>, _context: Context<'_, S>) {
        let mut line = Logged {
            level: *event.metadata().level(),
            numbers: HashMap::new(),
            texts: HashMap::new(),
        };
        event.record(&mut line);
        self.0.lock().unwrap().push(line);
    }
}

// One manager over one three venue BTC|USDT cluster: binance in slot 0, bybit in 1, okx in 2.
struct Harness {
    manager: OpportunityManager,
    cluster: Cluster,
    polled: bool, // the pollers keep writing, so every tick finds both anchors fresh
    closed: Receiver<Opportunity>, // the writer's end of the channel
    logs: Logs,
    _capture: DefaultGuard, // sends this thread's log lines to logs until the case ends
}

impl Harness {
    fn new() -> Self {
        Self::with_cluster(make_cluster(true), true)
    }

    fn unpolled() -> Self {
        Self::with_cluster(make_cluster(false), false)
    }

    fn with_cluster(cluster: Cluster, polled: bool) -> Self {
        // First, so no call site of the manager is reached before this thread has a subscriber.
        let logs = Logs::default();
        let capture =
            tracing::subscriber::set_default(tracing_subscriber::registry().with(logs.clone()));
        let (tx, closed) = mpsc::channel(64);

        Self {
            manager: OpportunityManager::new(OpportunityLifecycle::new(tx)),
            cluster,
            polled,
            closed,
            logs,
            _capture: capture,
        }
    }

    fn tick(&mut self, slot: usize, bid: f64, ask: f64, now: i64) -> Option<&Opportunity> {
        self.tick_sized(slot, bid, ask, now, 0.0, 0.0)
    }

    // One tick, exactly as the engine delivers it: one venue's quote lands in its slot with a level behind it,
    // then validate runs for that venue.
    fn tick_sized(
        &mut self,
        slot: usize,
        bid: f64,
        ask: f64,
        now: i64,
        bid_size: f64,
        ask_size: f64,
    ) -> Option<&Opportunity> {
        let cluster = &mut self.cluster;
        cluster.bid[slot] = bid;
        cluster.ask[slot] = ask;
        cluster.bid_size[slot] = bid_size;
        cluster.ask_size[slot] = ask_size;
        cluster.recv_ts[slot] = now;
        seed_depth(cluster, slot, bid, ask);

        if self.polled {
            cluster.anchor.written_at.fill(now);
        }

        self.manager.validate(&self.cluster, slot, now)
    }

    // bybit bids 101 against a binance ask of 100: ~8890 ppm after 55 bp taker each side.
    // A cross opens only on a tick MIN_CROSS_AGE_MS after the one that first showed it, so the three ticks below plant it and the fourth opens it.
    fn open_on(&mut self, now: i64) -> Option<&Opportunity> {
        let seen_at = now - MIN_CROSS_AGE_MS;
        self.tick(BINANCE, 99.9, 100.0, seen_at);
        self.tick(BYBIT, 101.0, 101.5, seen_at);
        self.tick(OKX, 99.4, 100.5, seen_at);

        self.tick(BYBIT, 101.0, 101.5, now)
    }

    // bybit-binance opens on the bybit tick at 1_000.
    // binance rests 4 at its bid and 5 at its ask, bybit 2 and 3.
    fn open_with_sizes(&mut self) -> &Opportunity {
        let seen_at = 1_000 - MIN_CROSS_AGE_MS;
        self.tick_sized(BINANCE, 99.9, 100.0, seen_at, 4.0, 5.0);
        self.tick_sized(BYBIT, 101.0, 101.5, seen_at, 2.0, 3.0);

        self.tick_sized(BYBIT, 101.0, 101.5, 1_000, 2.0, 3.0)
            .expect("bybit-binance opens")
    }

    // The open routes of the pair, sorted, since a HashMap has no order.
    fn routes(&self) -> Vec<&str> {
        let mut routes = Vec::new();
        if let Some(open) = self.manager.lifecycle.routes(PAIR) {
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
            .manager
            .lifecycle
            .routes(PAIR)
            .and_then(|open| open.get(route))
        {
            Some(opportunity) => opportunity,
            None => panic!("{route} is not open"),
        }
    }

    // Every closed opportunity the lifecycle has handed to the writer since the last call, in order.
    fn closed(&mut self) -> Vec<Opportunity> {
        let mut closed = Vec::new();
        while let Ok(opportunity) = self.closed.try_recv() {
            closed.push(opportunity);
        }
        closed
    }

    #[track_caller]
    fn only_closed(&mut self) -> Opportunity {
        let mut closed = self.closed();
        assert_eq!(closed.len(), 1, "expected exactly one closed opportunity");
        closed.remove(0)
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

    // The first warning that refused a cross for `reason`.
    #[track_caller]
    fn rejection(&self, reason: &str) -> Logged {
        for line in self.warnings() {
            if line.text("event") == "opportunity_rejected" && line.text("reason") == reason {
                return line;
            }
        }
        panic!("no opportunity_rejected line with reason {reason}");
    }
}

// OpportunityManager.validate

#[test]
fn opens_the_best_route_once_it_clears_min_net_ppm() {
    let mut h = Harness::new();

    let opened = h.open_on(1_000).expect("the cross opens");

    assert_eq!(opened.highest_bid_market.venue_id, "bybit");
    assert_eq!(opened.lowest_ask_market.venue_id, "binance");
    assert_eq!(opened.net_ppm_at_open.round(), 8_890.0);
    assert_eq!(opened.opened_at, 1_000);
    assert_eq!(opened.closed_at, None);
    assert_eq!(opened.close_reason, None);
    assert_eq!(h.routes(), ["bybit-binance"]);

    let opens = h.logs.events("opportunity_opened");
    assert_eq!(opens.len(), 1);
    assert_eq!(opens[0].level, Level::INFO); // the default filter, so a run's logs always carry the open
    assert_eq!(opens[0].text("pair"), PAIR);
    assert_eq!(opens[0].text("route"), "bybit-binance");
    assert_eq!(opens[0].number("net_ppm").round(), 8_890.0);
    assert_eq!(opens[0].number("opened_at"), 1_000.0);
    assert_close(opens[0].number("edge_notional"), 100.0 * 100.0 * ASK_MUL, 9); // the seeded hundred coins at binance's ask
}

#[test]
fn does_not_open_a_route_below_min_net_ppm() {
    let mut h = Harness::new();

    h.tick(BINANCE, 99.9, 100.0, 1_000);
    assert!(h.tick(BYBIT, 100.41, 101.5, 1_000).is_none()); // ~2996 ppm
    assert!(h.tick(OKX, 99.4, 100.5, 1_000).is_none());

    assert!(h.manager.lifecycle.routes(PAIR).is_none());
}

// The open threshold gates opening only.
// An episode that dips below it is still the same episode and has to keep receiving data, or the 5000/1000 band cannot work.
#[test]
fn keeps_feeding_an_open_route_that_has_fallen_below_min_net_ppm() {
    let mut h = Harness::new();

    h.open_on(1_000).expect("the cross opens");

    // ~2996 ppm: under open, over close
    assert!(h.tick(BYBIT, 100.41, 101.5, 2_000).is_none()); // nothing new opened

    let still_open = h.route("bybit-binance");
    assert_eq!(still_open.opened_at, 1_000); // the same episode
    assert_eq!(still_open.closed_at, None);
    assert_eq!(still_open.last_seen_at, 2_000);
    assert_eq!(still_open.net_ppm_series.len(), 2);
    assert_eq!(still_open.net_ppm_series[1].round(), 2_996.0);
    assert_eq!(still_open.min_net_ppm.round(), 2_996.0);
    assert_eq!(still_open.sample_ts, [0, 1_000]);
}

#[test]
fn closes_an_open_route_once_it_falls_below_closure_net_ppm() {
    let mut h = Harness::new();

    h.open_on(1_000).expect("the cross opens");

    h.tick(BYBIT, 100.1, 101.5, 2_000); // ~-100 ppm

    assert!(h.routes().is_empty());
    let closed = h.only_closed();
    assert_eq!(closed.closed_at, Some(2_000));
    assert_eq!(closed.close_reason, Some(CloseReason::SpreadCollapsed));
    // the collapsing tick is recorded before the close, so the series ends on it
    assert_eq!(closed.net_ppm_series.len(), 2);
    assert_eq!(closed.min_net_ppm, closed.net_ppm_series[1]);
}

#[test]
fn tracks_the_peak_instant_including_the_two_prices_behind_it() {
    let mut h = Harness::new();

    h.open_on(1_000).expect("the cross opens");

    h.tick(BYBIT, 101.0, 101.5, 2_000 - MIN_CROSS_AGE_MS);
    h.tick(OKX, 99.4, 99.5, 2_000 - MIN_CROSS_AGE_MS); // best ask moves to okx, the cross is seen
    h.tick(OKX, 99.4, 99.5, 2_000); // and it opens once it has held, ~13959 ppm

    h.tick(BYBIT, 100.41, 101.5, 3_000); // back down

    let okx_route = h.route("bybit-okx");
    assert_eq!(okx_route.peak_net_ppm.round(), 13_959.0);
    assert_eq!(okx_route.peak_at, 2_000);
    assert_close(okx_route.peak_highest_bid, 101.0 * BID_MUL, 9);
    assert_close(okx_route.peak_lowest_ask, 99.5 * ASK_MUL, 9);
    // the earlier binance route peaked on its own, separate reading
    assert_eq!(h.route("bybit-binance").peak_net_ppm.round(), 8_890.0);
}

// OpportunityManager minimum cross age

#[test]
fn does_not_open_a_cross_the_first_time_it_sees_it() {
    let mut h = Harness::new();

    h.tick(BINANCE, 99.9, 100.0, 1_000);

    assert!(h.tick(BYBIT, 101.0, 101.5, 1_000).is_none());
    assert!(h.manager.lifecycle.routes(PAIR).is_none());
}

#[test]
fn refuses_the_cross_until_it_reaches_min_cross_age_ms_then_opens_it() {
    let mut h = Harness::new();

    h.tick(BINANCE, 99.9, 100.0, 1_000);
    h.tick(BYBIT, 101.0, 101.5, 1_000);

    assert!(
        h.tick(BYBIT, 101.0, 101.5, 1_000 + MIN_CROSS_AGE_MS - 1)
            .is_none()
    );

    let opened = h
        .tick(BYBIT, 101.0, 101.5, 1_000 + MIN_CROSS_AGE_MS)
        .expect("the cross has held");

    assert_eq!(opened.opened_at, 1_000 + MIN_CROSS_AGE_MS);
    assert_eq!(opened.net_ppm_at_open.round(), 8_890.0);
}

#[test]
fn reports_a_cross_that_dies_before_it_confirms_and_opens_nothing() {
    let mut h = Harness::new();

    h.tick(BINANCE, 99.9, 100.0, 1_000);
    h.tick(BYBIT, 101.0, 101.5, 1_000);
    h.tick(BYBIT, 100.1, 101.5, 1_050); // the bid falls back under MIN_NET_PPM

    assert!(h.manager.lifecycle.routes(PAIR).is_none());
    let unconfirmed = h.rejection("unconfirmed_cross");
    assert_eq!(unconfirmed.text("route"), "bybit-binance");
    assert_eq!(unconfirmed.number("age_ms"), 50.0);
}

#[test]
fn restarts_the_clock_when_a_better_route_replaces_the_pending_one() {
    let mut h = Harness::new();

    h.tick(BINANCE, 99.9, 100.0, 1_000);
    h.tick(BYBIT, 101.0, 101.5, 1_000); // bybit-binance is the pending cross
    h.tick(OKX, 99.4, 99.5, 1_080); // okx undercuts, so bybit-okx starts its own clock

    assert!(h.tick(OKX, 99.4, 99.5, 1_000 + MIN_CROSS_AGE_MS).is_none());

    let opened = h
        .tick(OKX, 99.4, 99.5, 1_080 + MIN_CROSS_AGE_MS)
        .expect("bybit-okx has held");

    assert_eq!(opened.lowest_ask_market.venue_id, "okx");
    assert_eq!(h.routes(), ["bybit-okx"]);

    let replaced = h.rejection("unconfirmed_cross");
    assert_eq!(replaced.text("route"), "bybit-binance");
    assert_eq!(replaced.number("age_ms"), 80.0);
}

#[test]
fn refuses_a_thin_region_on_the_first_sight_of_the_cross_before_the_age_gate() {
    let mut h = Harness::new();
    set_asks(&mut h.cluster, BINANCE, &[(100.0, 0.1)]);
    set_bids(&mut h.cluster, BYBIT, &[(101.0, 0.1)]);

    h.tick(BINANCE, 99.9, 100.0, 1_000);
    h.tick(BYBIT, 101.0, 101.5, 1_000);

    assert_eq!(h.rejection("thin_book").text("route"), "bybit-binance");
}

// OpportunityManager concurrent routes on one pair

#[test]
fn holds_a_second_route_open_alongside_the_first() {
    let mut h = Harness::new();

    h.open_on(1_000).expect("bybit-binance opens"); // best ask is binance

    h.tick(OKX, 99.4, 99.5, 2_000); // okx undercuts, so the bybit-okx cross is seen
    let second = h
        .tick(OKX, 99.4, 99.5, 2_100)
        .expect("bybit-okx opens once it has held");
    assert_eq!(second.lowest_ask_market.venue_id, "okx");

    h.tick(BYBIT, 101.0, 101.5, 2_100);
    h.tick(BINANCE, 99.9, 100.0, 2_100);

    assert_eq!(h.routes(), ["bybit-binance", "bybit-okx"]);
}

// Once okx undercuts it, bybit-binance is never the cluster's best route again, so only the per-route update path can still see it.
#[test]
fn keeps_updating_a_route_the_cluster_scan_no_longer_reports() {
    let mut h = Harness::new();

    h.open_on(1_000).expect("bybit-binance opens");

    h.tick(OKX, 99.4, 99.5, 2_000); // bybit-okx is the best route from here on
    h.tick(BINANCE, 99.9, 100.0, 2_000); // a leg of the overtaken route ticks

    let overtaken = h.route("bybit-binance");
    assert_eq!(overtaken.last_seen_at, 2_000);
    assert_eq!(overtaken.net_ppm_series.len(), 2);

    // and it still closes on its own terms rather than lingering as a zombie
    h.tick(BINANCE, 99.9, 101.2, 3_000); // binance ask rises, that route collapses
    h.tick(BYBIT, 101.0, 101.5, 3_000);
    h.tick(OKX, 99.4, 99.5, 3_000);

    let closed = h.only_closed();
    assert_eq!(closed.lowest_ask_market.venue_id, "binance");
    assert_eq!(closed.closed_at, Some(3_000));
    assert_eq!(closed.close_reason, Some(CloseReason::SpreadCollapsed));
    assert_eq!(h.routes(), ["bybit-okx"]);
}

// OpportunityManager silence and the age cap
// Silence is not a close reason.
// Every feed is change-driven, so a leg that has not printed is a leg that has not changed, and only the age cap, a collapse, a dead socket or a shutdown ends an episode.

#[test]
fn keeps_a_route_open_while_one_leg_stays_quiet_for_minutes() {
    let mut h = Harness::new();

    h.open_on(1_000).expect("bybit-binance opens");

    // binance keeps printing, bybit does not
    h.tick(BINANCE, 99.9, 100.0, 120_000);

    let open = h.route("bybit-binance");
    assert_eq!(open.closed_at, None);
    assert_eq!(open.last_seen_at, 120_000);

    assert_eq!(h.manager.lifecycle.sweep(120_000), 0);
    assert_eq!(h.route("bybit-binance").opened_at, 1_000);
    assert!(h.closed().is_empty());
}

#[test]
fn sweeps_a_route_that_reached_max_opportunity_age_ms() {
    let mut h = Harness::new();

    h.open_on(1_000).expect("bybit-binance opens");

    assert_eq!(
        h.manager
            .lifecycle
            .sweep(1_000 + MAX_OPPORTUNITY_AGE_MS - 1),
        0
    );
    assert!(h.closed().is_empty());

    assert_eq!(h.manager.lifecycle.sweep(1_000 + MAX_OPPORTUNITY_AGE_MS), 1);

    let closed = h.only_closed();
    assert_eq!(closed.opened_at, 1_000);
    assert_eq!(closed.closed_at, Some(1_000 + MAX_OPPORTUNITY_AGE_MS));
    assert_eq!(closed.close_reason, Some(CloseReason::AgeCap));
    assert!(h.manager.lifecycle.routes(PAIR).is_none());
}

// The cap is a chunk boundary, not the end of the basis: the tick that closes the old episode starts the next cross.
#[test]
fn closes_at_the_cap_on_the_tick_path_and_reopens_the_route_one_cross_later() {
    let mut h = Harness::new();

    h.open_on(1_000).expect("bybit-binance opens");
    let capped_at = 1_000 + MAX_OPPORTUNITY_AGE_MS;

    // The route has no open opportunity behind it now, so its cross starts a new life and has to hold again.
    assert!(h.tick(BYBIT, 101.0, 101.5, capped_at).is_none());

    let first = h.only_closed();
    assert_eq!(first.closed_at, Some(capped_at));
    assert_eq!(first.close_reason, Some(CloseReason::AgeCap));
    assert_eq!(first.net_ppm_series.len(), 2);

    let second = h
        .tick(BYBIT, 101.0, 101.5, capped_at + MIN_CROSS_AGE_MS)
        .expect("the cross reopens the route once it has held");
    assert_eq!(second.opened_at, capped_at + MIN_CROSS_AGE_MS);

    assert_eq!(
        h.route("bybit-binance").opened_at,
        capped_at + MIN_CROSS_AGE_MS
    );
}

// OpportunityLifecycle feed down

#[test]
fn closes_every_route_with_a_leg_in_the_dead_slot_and_only_those() {
    let mut h = Harness::new();

    h.open_on(1_000).expect("bybit-binance opens");
    h.tick(OKX, 99.4, 99.5, 2_000); // the bybit-okx cross is seen
    h.tick(OKX, 99.4, 99.5, 2_100); // bybit-okx opens alongside bybit-binance
    h.tick(BYBIT, 101.0, 101.5, 2_100);
    h.tick(BINANCE, 99.9, 100.0, 2_100);

    assert_eq!(h.routes().len(), 2);

    assert_eq!(
        h.manager
            .lifecycle
            .close_opportunities_on_venue(PAIR, OKX, 3_000),
        1
    );
    assert_eq!(h.routes(), ["bybit-binance"]);
    assert_eq!(h.only_closed().lowest_ask_market.venue_id, "okx");

    assert_eq!(
        h.manager
            .lifecycle
            .close_opportunities_on_venue(PAIR, BYBIT, 4_000),
        1
    );

    let closed = h.only_closed();
    assert_eq!(closed.closed_at, Some(4_000));
    assert_eq!(closed.close_reason, Some(CloseReason::FeedDown));
    assert!(h.manager.lifecycle.routes(PAIR).is_none());
}

// Stronger than the TypeScript case, whose dead leg held no book, so the region floor refused it before the scan mattered.
// Both dead legs here hold a book and two ticks run a cross age apart, so only the scan can keep them shut.
#[test]
fn ignores_a_leg_whose_socket_is_down_when_discovering() {
    let mut h = Harness::new();

    h.tick(BINANCE, 99.9, 100.0, 1_000);
    // bybit's high bid and okx's low ask are still there, and neither socket is up
    h.cluster.bid[BYBIT] = 101.0;
    h.cluster.ask[BYBIT] = 101.5;
    seed_depth(&mut h.cluster, BYBIT, 101.0, 101.5);
    h.cluster.bid[OKX] = 98.5;
    h.cluster.ask[OKX] = 99.0;
    seed_depth(&mut h.cluster, OKX, 98.5, 99.0);

    h.tick(BINANCE, 99.9, 100.01, 2_000);
    assert!(
        h.tick(BINANCE, 99.9, 100.01, 2_000 + MIN_CROSS_AGE_MS)
            .is_none()
    );

    assert!(h.manager.lifecycle.routes(PAIR).is_none());
    assert!(h.warnings().is_empty()); // not even refused, the scans never saw a cross
}

#[test]
fn returns_nothing_for_a_pair_with_no_open_routes() {
    let mut h = Harness::new();

    assert_eq!(
        h.manager
            .lifecycle
            .close_opportunities_on_venue(PAIR, BYBIT, 1_000),
        0
    );
    assert!(h.closed().is_empty());
}

// OpportunityLifecycle.shutdown
// The TypeScript lifecycle awaited its queue writes.
// The Rust one drops the sender, and main awaits the writer task instead.

#[test]
fn closes_every_open_route_with_shutdown_and_drops_the_sender() {
    let mut h = Harness::new();

    h.open_on(1_000).expect("bybit-binance opens");
    h.tick(OKX, 99.4, 99.5, 2_000); // the bybit-okx cross is seen
    h.tick(OKX, 99.4, 99.5, 2_100); // and opens
    h.tick(BYBIT, 100.1, 101.5, 3_000); // bybit-binance collapses, its row already on the way to the writer

    assert_eq!(h.manager.lifecycle.shutdown(5_000), 1);

    let collapsed = h
        .closed
        .try_recv()
        .expect("the row that closed before the stop");
    let stopped = h.closed.try_recv().expect("the row the stop closed");
    assert_eq!(collapsed.close_reason, Some(CloseReason::SpreadCollapsed));
    assert_eq!(stopped.lowest_ask_market.venue_id, "okx");
    assert_eq!(stopped.closed_at, Some(5_000));
    assert_eq!(stopped.close_reason, Some(CloseReason::Shutdown));
    // The sender went with the lifecycle, so the writer drains what is left and then sees the end.
    assert_eq!(h.closed.try_recv().unwrap_err(), TryRecvError::Disconnected);
}

// OpportunityLifecycle series cap

#[test]
fn stops_the_series_at_max_series_length_while_the_counters_keep_going() {
    let mut h = Harness::new();
    let observation = bybit_binance_observation(&h.cluster);
    let lifecycle = &mut h.manager.lifecycle;

    lifecycle.track_opportunity(observation);

    for i in 1..MAX_SERIES_LENGTH + 5 {
        lifecycle.track_opportunity(Observation {
            net_ppm: 8_000.0 + i as f64,
            now: 1_000 + i as i64,
            ..observation
        });
    }

    // past the cap: a new peak and a new minimum, neither of which the series can hold
    lifecycle.track_opportunity(Observation {
        net_ppm: 20_000.0,
        now: 20_000,
        ..observation
    });
    lifecycle.track_opportunity(Observation {
        net_ppm: 500.0,
        now: 20_001,
        ..observation
    });

    let opportunity = h.route("bybit-binance");
    assert_eq!(opportunity.net_ppm_series.len(), MAX_SERIES_LENGTH);
    assert_eq!(opportunity.highest_bid_series.len(), MAX_SERIES_LENGTH);
    assert_eq!(opportunity.lowest_ask_series.len(), MAX_SERIES_LENGTH);
    assert_eq!(opportunity.sample_ts.len(), MAX_SERIES_LENGTH);
    assert_eq!(
        opportunity.ticks_since_start,
        (1 + MAX_SERIES_LENGTH + 4 + 2) as u64
    ); // the open, the loop, the two past the cap
    assert_eq!(opportunity.peak_net_ppm, 20_000.0);
    assert_eq!(opportunity.peak_at, 20_000);
    assert_eq!(opportunity.min_net_ppm, 500.0);
    assert_eq!(opportunity.last_seen_at, 20_001);
}

// OpportunityLifecycle.track_opportunity
// It is the caller that owns MIN_NET_PPM and CLOSURE_NET_PPM, and this records whatever it is given.

#[test]
fn records_a_reading_regardless_of_how_small_the_edge_is() {
    let mut h = Harness::new();
    let observation = Observation {
        highest_bid: 100.01,
        highest_bid_leg_ask: 100.02,
        lowest_ask_leg_bid: 99.99,
        net_ppm: 100.0,
        ..bybit_binance_observation(&h.cluster)
    };

    let opportunity = h.manager.lifecycle.track_opportunity(observation);
    assert_eq!(opportunity.net_ppm_at_open, 100.0);

    assert_eq!(h.routes(), ["bybit-binance"]);
}

#[test]
fn updates_the_existing_route_instead_of_replacing_it() {
    let mut h = Harness::new();
    let observation = bybit_binance_observation(&h.cluster);

    h.manager.lifecycle.track_opportunity(observation);
    let second = h.manager.lifecycle.track_opportunity(Observation {
        net_ppm: 9_000.0,
        now: 1_500,
        ..observation
    });

    assert_eq!(second.opened_at, 1_000); // the first route, fed a second sample
    assert_eq!(second.net_ppm_at_open, 8_000.0);
    assert_eq!(second.peak_net_ppm, 9_000.0);
    assert_eq!(second.peak_at, 1_500);
    assert_eq!(second.min_net_ppm, 8_000.0);
    assert_eq!(second.net_ppm_series, [8_000.0, 9_000.0]);
    assert_eq!(second.sample_ts, [0, 500]);
    assert_eq!(h.routes().len(), 1);
}

// OpportunityManager persistence

#[test]
fn hands_the_closed_opportunity_to_the_writer_with_its_reason() {
    let mut h = Harness::new();

    h.open_on(1_000).expect("bybit-binance opens");
    h.tick(BYBIT, 100.1, 101.5, 2_000);

    let closed = h.only_closed();
    assert_eq!(
        get_route_key(&closed.highest_bid_market, &closed.lowest_ask_market),
        "bybit-binance"
    );
    assert_eq!(closed.highest_bid_market.base, "BTC");
    assert_eq!(closed.opened_at, 1_000);
    assert_eq!(closed.closed_at, Some(2_000));
    assert_eq!(closed.close_reason, Some(CloseReason::SpreadCollapsed));
    assert_eq!(closed.ticks_since_start, 2);
    // the collapsing sample is the minimum, and it is what closed the route
    assert!(closed.min_net_ppm < CLOSURE_NET_PPM);
    assert_eq!(closed.last_net_ppm, closed.min_net_ppm);
}

// OpportunityManager plausibility ceiling
// The general net for a collision the venue loader does not know about.
// okx bidding 1000 against a binance ask of 100 is ~8.99M ppm: the two legs are not the same asset, whatever the ticker says.

#[test]
fn rejects_a_reading_above_max_plausible_net_ppm_and_says_so() {
    let mut h = Harness::new();

    h.tick(BINANCE, 99.9, 100.0, 1_000);
    assert!(h.tick(OKX, 1_000.0, 1_001.0, 1_000).is_none());

    assert!(h.manager.lifecycle.routes(PAIR).is_none());
    let warnings = h.warnings();
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].text("event"), "opportunity_rejected");
    assert_eq!(warnings[0].text("reason"), "implausible_net_ppm");
    assert_eq!(warnings[0].text("pair"), PAIR);
    assert_eq!(warnings[0].text("route"), "okx-binance");
    assert_eq!(warnings[0].number("max_plausible_net_ppm"), 100_000.0);
}

#[test]
fn still_opens_a_large_but_plausible_edge() {
    let mut h = Harness::new();

    h.tick(BINANCE, 99.9, 100.0, 1_000);
    h.tick(OKX, 109.0, 110.0, 1_000); // ~88802 ppm, under the ceiling
    let opened = h
        .tick(OKX, 109.0, 110.0, 1_000 + MIN_CROSS_AGE_MS)
        .expect("a plausible edge opens");
    assert_eq!(opened.net_ppm_at_open.round(), 88_802.0);

    assert!(h.warnings().is_empty());
}

// A cluster like this is broken on every tick for the life of the process.
// The bursts are 4 s apart while the warning window is 10 s.
#[test]
fn warns_once_per_window_and_carries_the_suppressed_count() {
    let mut h = Harness::new();

    for now in [1_000, 4_000, 8_000] {
        h.tick(BINANCE, 99.9, 100.0, now);
        h.tick(OKX, 1_000.0, 1_001.0, now);
    }

    assert_eq!(h.warnings().len(), 1);

    h.tick(BINANCE, 99.9, 100.0, 12_000);

    let warnings = h.warnings();
    assert_eq!(warnings.len(), 2);
    assert_eq!(warnings[1].number("occurrence_count"), 6.0);
    assert_eq!(warnings[1].number("suppressed_count"), 4.0);

    // The suppressed count starts again after each warning, while the occurrence count keeps going.
    h.tick(OKX, 1_000.0, 1_001.0, 13_000);
    h.tick(BINANCE, 99.9, 100.0, 23_000);

    let warnings = h.warnings();
    assert_eq!(warnings.len(), 3);
    assert_eq!(warnings[2].number("occurrence_count"), 8.0);
    assert_eq!(warnings[2].number("suppressed_count"), 1.0);
}

// OpportunityManager book sizes and far sides
// The cluster holds raw sizes, so a reading applies size_mul.
// The far sides go through the same multipliers as the touch.

#[test]
fn snapshots_the_sizes_and_far_sides_of_the_tick_that_opened_the_route() {
    let mut h = Harness::new();

    let opened = h.open_with_sizes();

    assert_eq!(opened.highest_bid_size_at_open, 2.0);
    assert_eq!(opened.lowest_ask_size_at_open, 5.0);
    assert_close(opened.highest_bid_leg_ask_at_open, 101.5 * ASK_MUL, 9);
    assert_close(opened.lowest_ask_leg_bid_at_open, 99.9 * BID_MUL, 9);
    assert_eq!(opened.peak_highest_bid_size, 2.0);
    assert_eq!(opened.peak_lowest_ask_size, 5.0);
    assert_close(opened.peak_highest_bid_leg_ask, 101.5 * ASK_MUL, 9);
    assert_close(opened.peak_lowest_ask_leg_bid, 99.9 * BID_MUL, 9);
    assert_eq!(opened.last_highest_bid_size, 2.0);
    assert_eq!(opened.last_lowest_ask_size, 5.0);
    assert_close(opened.last_highest_bid_leg_ask, 101.5 * ASK_MUL, 9);
    assert_close(opened.last_lowest_ask_leg_bid, 99.9 * BID_MUL, 9);
}

#[test]
fn moves_the_peak_reading_with_a_new_peak_and_keeps_the_open_one() {
    let mut h = Harness::new();

    h.open_with_sizes();

    h.tick_sized(BYBIT, 101.2, 101.7, 2_000, 6.0, 7.0); // ~10887 ppm, a new peak
    h.tick_sized(BYBIT, 100.8, 101.3, 3_000, 8.0, 9.0); // ~6892 ppm, under it

    let route = h.route("bybit-binance");
    assert_eq!(route.peak_at, 2_000);
    assert_eq!(route.highest_bid_size_at_open, 2.0);
    assert_eq!(route.lowest_ask_size_at_open, 5.0);
    assert_close(route.highest_bid_leg_ask_at_open, 101.5 * ASK_MUL, 9);
    assert_close(route.lowest_ask_leg_bid_at_open, 99.9 * BID_MUL, 9);
    assert_eq!(route.peak_highest_bid_size, 6.0);
    assert_eq!(route.peak_lowest_ask_size, 5.0);
    assert_close(route.peak_highest_bid_leg_ask, 101.7 * ASK_MUL, 9);
    assert_close(route.peak_lowest_ask_leg_bid, 99.9 * BID_MUL, 9);
    assert_eq!(route.last_highest_bid_size, 8.0);
    assert_eq!(route.last_lowest_ask_size, 5.0);
    assert_close(route.last_highest_bid_leg_ask, 101.3 * ASK_MUL, 9);
    assert_close(route.last_lowest_ask_leg_bid, 99.9 * BID_MUL, 9);
}

#[test]
fn carries_the_last_reading_of_either_leg_through_to_the_close() {
    let mut h = Harness::new();

    h.open_with_sizes();

    h.tick_sized(BINANCE, 99.8, 100.05, 2_000, 12.0, 13.0); // the buy leg moves, ~8386 ppm

    let route = h.route("bybit-binance");
    assert_eq!(route.last_highest_bid_size, 2.0);
    assert_eq!(route.last_lowest_ask_size, 13.0);
    assert_close(route.last_highest_bid_leg_ask, 101.5 * ASK_MUL, 9);
    assert_close(route.last_lowest_ask_leg_bid, 99.8 * BID_MUL, 9);

    h.tick_sized(BYBIT, 100.1, 101.4, 3_000, 10.0, 11.0); // ~-600 ppm, collapses

    let closed = h.only_closed();
    assert_eq!(closed.close_reason, Some(CloseReason::SpreadCollapsed));
    assert_eq!(closed.highest_bid_size_at_open, 2.0);
    assert_eq!(closed.lowest_ask_size_at_open, 5.0);
    assert_eq!(closed.peak_highest_bid_size, 2.0);
    assert_eq!(closed.peak_lowest_ask_size, 5.0);
    assert_close(closed.peak_highest_bid_leg_ask, 101.5 * ASK_MUL, 9);
    assert_close(closed.peak_lowest_ask_leg_bid, 99.9 * BID_MUL, 9);
    assert_eq!(closed.last_highest_bid_size, 10.0);
    assert_eq!(closed.last_lowest_ask_size, 13.0);
    assert_close(closed.last_highest_bid_leg_ask, 101.4 * ASK_MUL, 9);
    assert_close(closed.last_lowest_ask_leg_bid, 99.8 * BID_MUL, 9);
}

#[test]
fn reads_a_raw_size_through_the_slot_multiplier() {
    let mut h = Harness::new();
    h.cluster.size_mul[BYBIT] = 10.0; // ten coins per contract

    let opened = h.open_with_sizes();

    assert_eq!(opened.highest_bid_size_at_open, 20.0);
    assert_eq!(opened.lowest_ask_size_at_open, 5.0); // binance stays at one coin per contract
}

// OpportunityManager ladder walk
// The walk reads the depth block on every sample.
// The regions here hold twenty coins or more, so they clear the floor at open.

#[test]
fn records_the_region_behind_the_opening_cross_from_the_buy_asks_and_the_sell_bids() {
    let mut h = Harness::new();
    // We buy binance asks and sell into bybit bids.
    // Twenty coins cross at 100 against 101, then ten at 100.2 against 100.9, then 100.9 against 100.9 does not once both fees are on.
    set_asks(
        &mut h.cluster,
        BINANCE,
        &[(100.0, 20.0), (100.2, 10.0), (100.9, 30.0)],
    );
    set_bids(&mut h.cluster, BYBIT, &[(101.0, 20.0), (100.9, 40.0)]);

    let opened = h.open_on(1_000).expect("bybit-binance opens");

    let edge = opened.edge_at_open.expect("both legs hold depth");
    assert_close(edge.size, 30.0, 9);
    assert_close(edge.notional, (100.0 * 20.0 + 100.2 * 10.0) * ASK_MUL, 6);
    assert!(!edge.exhausted);
    assert_eq!(edge.buy_levels, 2);
    assert_eq!(edge.sell_levels, 2);
    assert_eq!(opened.peak_edge, opened.edge_at_open);
    assert_eq!(opened.peak_edge_at, 1_000);
    assert_eq!(opened.last_edge, opened.edge_at_open);
    assert_close(opened.max_edge_notional, edge.notional, 9);
    assert_eq!(opened.edge_samples, 1);
}

#[test]
fn moves_the_peak_with_a_better_average_edge_and_keeps_the_largest_region_on_its_own() {
    let mut h = Harness::new();
    set_asks(&mut h.cluster, BINANCE, &[(100.0, 20.0)]);
    set_bids(&mut h.cluster, BYBIT, &[(101.0, 20.0)]);
    let open_edge = h
        .open_on(1_000)
        .expect("bybit-binance opens")
        .edge_at_open
        .expect("both legs hold depth");

    // A deeper but thinner edge on the next bybit tick: more notional, a lower average.
    set_asks(&mut h.cluster, BINANCE, &[(100.0, 20.0), (100.4, 100.0)]);
    set_bids(&mut h.cluster, BYBIT, &[(101.0, 20.0), (100.9, 100.0)]);
    h.tick(BYBIT, 101.0, 101.5, 2_000);

    let route = h.route("bybit-binance");
    let last_edge = route.last_edge.expect("both legs hold depth");
    assert_eq!(route.peak_edge, Some(open_edge));
    assert_eq!(route.peak_edge_at, 1_000);
    assert_close(last_edge.size, 120.0, 9);
    assert_close(route.max_edge_notional, last_edge.notional, 9);
    assert_eq!(route.edge_samples, 2);

    // A better average on the tick after, with the same top of book.
    set_bids(&mut h.cluster, BYBIT, &[(101.4, 1.0)]);
    h.tick(BYBIT, 101.4, 101.5, 3_000);

    let route = h.route("bybit-binance");
    assert_eq!(route.peak_edge_at, 3_000);
    assert!(route.peak_edge.expect("a peak region").avg_ppm > open_edge.avg_ppm);
    assert_eq!(route.edge_samples, 3);
}

#[test]
fn records_no_edge_on_a_sample_where_a_leg_holds_no_depth_and_counts_only_the_samples_that_had_one()
{
    let mut h = Harness::new();
    set_asks(&mut h.cluster, BINANCE, &[(100.0, 20.0)]);
    set_bids(&mut h.cluster, BYBIT, &[(101.0, 20.0)]);
    h.open_on(1_000).expect("bybit-binance opens");

    set_asks(&mut h.cluster, BINANCE, &[]); // binance's asks leave the block, and a bybit tick does not refill them
    h.tick(BYBIT, 101.0, 101.5, 2_000);

    let route = h.route("bybit-binance");
    let open_edge = route.edge_at_open.expect("both legs held depth at open");
    assert_eq!(route.last_edge, None);
    assert_eq!(route.peak_edge, Some(open_edge));
    assert_close(route.max_edge_notional, open_edge.notional, 9);
    assert_eq!(route.edge_samples, 1);
    assert_eq!(route.edge_avg_ppm_series.len(), 2);
    assert_eq!(route.edge_avg_ppm_series[1], NO_EDGE);
}

// OpportunityManager region floor
// The floor reads the walk at open, docs/bestiary/thin-book.md.
// A refused route is tried again on every tick.

#[test]
fn refuses_a_route_whose_region_is_under_min_edge_notional_and_says_so() {
    let mut h = Harness::new();
    set_asks(&mut h.cluster, BINANCE, &[(100.0, 2.0)]); // two coins behind the cross, about 200 quote units
    set_bids(&mut h.cluster, BYBIT, &[(101.0, 2.0)]);

    assert!(h.open_on(1_000).is_none());

    assert!(h.manager.lifecycle.routes(PAIR).is_none());
    let warnings = h.warnings();
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].text("event"), "opportunity_rejected");
    assert_eq!(warnings[0].text("reason"), "thin_book");
    assert_eq!(warnings[0].text("route"), "bybit-binance");
    assert_close(warnings[0].number("edge_notional"), 200.0 * ASK_MUL, 9);
    assert_eq!(warnings[0].number("edge_size"), 2.0);
    assert_eq!(warnings[0].number("edge_avg_ppm").round(), 8_890.0);
}

#[test]
fn refuses_a_route_while_a_leg_holds_no_depth() {
    let mut h = Harness::new();

    h.tick(BINANCE, 99.9, 100.0, 1_000);
    set_asks(&mut h.cluster, BINANCE, &[]); // the asks behind binance's quote are gone from the block

    assert!(h.tick(BYBIT, 101.0, 101.5, 1_000).is_none());

    assert!(h.manager.lifecycle.routes(PAIR).is_none());
    let thin = h.rejection("thin_book");
    assert_eq!(thin.text("route"), "bybit-binance");
    // TypeScript wrote the missing region as null, and tracing leaves a None field out of the line.
    assert!(!thin.has("edge_notional"));
    assert!(!thin.has("edge_avg_ppm"));
    assert!(!thin.has("edge_size"));
}

// OpportunityManager edge on the row
// The row is bound inside insert_batch, so these cases check the fields of the closed opportunity that it binds.

#[test]
fn carries_the_walk_at_open_peak_and_close_and_the_two_series_to_the_writer() {
    let mut h = Harness::new();

    // Twenty coins behind the opening cross, a better average on one coin on the second tick, and a collapse on the third.
    set_asks(&mut h.cluster, BINANCE, &[(100.0, 20.0)]);
    set_bids(&mut h.cluster, BYBIT, &[(101.0, 20.0)]);
    h.open_on(1_000).expect("bybit-binance opens");
    set_bids(&mut h.cluster, BYBIT, &[(101.4, 1.0)]);
    h.tick(BYBIT, 101.4, 101.5, 2_000);
    // The walk reads the block, so the collapse has to land there too, as the engine would write it.
    set_bids(&mut h.cluster, BYBIT, &[(100.05, 1.0)]);
    h.tick(BYBIT, 100.05, 100.1, 3_000);

    let closed = h.only_closed();
    assert_eq!(closed.close_reason, Some(CloseReason::SpreadCollapsed));
    assert_eq!(closed.edge_at_open.expect("depth at open").size, 20.0);
    assert_eq!(closed.edge_samples, 3);
    assert_eq!(closed.peak_edge_at, 2_000);
    let peak_edge = closed.peak_edge.expect("a peak region");
    assert_eq!(peak_edge.size, 1.0);
    assert!(peak_edge.exhausted);
    assert_close(closed.max_edge_notional, 2_000.0 * ASK_MUL, 9);
    assert_eq!(closed.last_edge.expect("depth at close").size, 0.0); // the tops no longer cross, so the region is empty
    assert_eq!(closed.edge_avg_ppm_series.len(), 3);
    assert_eq!(closed.edge_avg_ppm_series[2], 0.0);
    assert_eq!(closed.edge_notional_series.len(), 3);
    assert_eq!(closed.edge_notional_series[2], 0.0);
}

// OpportunityManager anchor filter

#[test]
fn refuses_a_cross_whose_anchors_were_never_written() {
    let mut h = Harness::unpolled();

    assert!(h.open_on(NOW).is_none());

    assert!(h.manager.lifecycle.routes(PAIR).is_none());
    let warnings = h.warnings();
    assert_eq!(warnings.len(), 1); // the okx tick behind it is the same route inside the window
    assert_eq!(warnings[0].text("event"), "opportunity_rejected");
    assert_eq!(warnings[0].text("reason"), "anchor_missing");
    assert_eq!(warnings[0].text("route"), "bybit-binance");
    assert!(warnings[0].number("net_ppm") > 5_000.0);
}

// bybit's anchor sits one percent over binance's, which is the whole cross: the market already holds these two perps apart.
#[test]
fn rejects_a_cross_the_two_anchors_already_explain() {
    let mut h = Harness::unpolled();
    anchor_leg(&mut h.cluster, BINANCE, 100.2, 100.2, NOW - 100);
    anchor_leg(&mut h.cluster, BYBIT, 101.2, 101.2, NOW - 100);

    assert!(h.open_on(NOW).is_none());

    assert!(h.manager.lifecycle.routes(PAIR).is_none());
    let warnings = h.warnings();
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].text("event"), "opportunity_rejected");
    assert_eq!(warnings[0].text("reason"), "standing_basis");
    assert_eq!(warnings[0].text("route"), "bybit-binance");
    assert!(warnings[0].number("fresh_net_ppm") < 0.0);
    assert!(warnings[0].number("standing_ppm") > 9_000.0);
    assert_eq!(warnings[0].number("index_gap_ppm").round(), 9_980.0); // all of it is the index gap, the marks sit on their indices
    assert_close(warnings[0].number("carried_ppm"), 0.0, 6);
    assert_eq!(warnings[0].number("occurrence_count"), 1.0);
}

#[test]
fn opens_when_the_anchors_agree_and_records_both_legs_on_the_route() {
    let mut h = Harness::unpolled();
    anchor_leg(&mut h.cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchor_leg(&mut h.cluster, BYBIT, 100.5, 100.6, NOW - 300);

    let opened = h.open_on(NOW).expect("the fresh edge clears");

    let anchor = opened.anchor_at_open;
    assert_eq!(anchor.sell.index, 100.5);
    assert_eq!(anchor.sell.mark, 100.6);
    assert_eq!(anchor.sell.funding_rate, -0.0038);
    assert_eq!(anchor.sell.written_at, NOW - 300);
    assert_eq!(anchor.buy.mark_premium, 0.0);
    // bybit's mark sits ten basis points over its index, so that much of the cross is standing and the rest is fresh.
    let net = opened.net_ppm_at_open;
    let fresh = ((1.0 + net / 1_000_000.0) / (100.6 / 100.5) - 1.0) * 1_000_000.0;
    assert_close(anchor.fresh_net_ppm, fresh, 6);
    assert_close(anchor.standing_ppm, net - fresh, 6);
    assert_eq!(anchor.standing_ppm.round(), 1_003.0);
}

#[test]
fn refuses_a_venue_without_a_mark() {
    let mut h = Harness::unpolled();
    anchor_leg(&mut h.cluster, BINANCE, 100.5, 0.0, NOW - 100);
    anchor_leg(&mut h.cluster, BYBIT, 100.5, 100.5, NOW - 100);

    assert!(h.open_on(NOW).is_none());

    assert!(h.manager.lifecycle.routes(PAIR).is_none());
    assert_eq!(h.rejection("anchor_no_mark").text("route"), "bybit-binance");
}

#[test]
fn refuses_a_cross_while_an_anchor_is_moving() {
    let mut h = Harness::unpolled();
    anchor_leg(&mut h.cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchor_leg(&mut h.cluster, BYBIT, 100.5, 100.5, NOW - 100);
    h.cluster.anchor.move_ppm[BYBIT] = MAX_ANCHOR_MOVE_PPM + 1.0; // bybit's last poll moved more than the reader allows

    assert!(h.open_on(NOW).is_none());

    assert!(h.manager.lifecycle.routes(PAIR).is_none());
    let moving = h.rejection("anchor_moving");
    assert_eq!(moving.text("route"), "bybit-binance");
    assert_eq!(moving.number("sell_move_ppm"), MAX_ANCHOR_MOVE_PPM + 1.0);
    assert_eq!(moving.number("buy_move_ppm"), 0.0);
}

// The TypeScript case ran both managers side by side.
// A thread holds one log capture at a time, so it is two cases here.
#[test]
fn refuses_a_cross_whose_two_anchors_are_too_far_apart_in_time() {
    let mut h = Harness::unpolled();
    anchor_leg(&mut h.cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchor_leg(&mut h.cluster, BYBIT, 100.5, 100.5, NOW - 6_000);

    assert!(h.open_on(NOW).is_none());

    assert_eq!(h.warnings()[0].text("reason"), "anchor_skewed");
}

#[test]
fn refuses_a_cross_whose_anchors_are_too_old() {
    let mut h = Harness::unpolled();
    anchor_leg(&mut h.cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchor_leg(&mut h.cluster, BYBIT, 100.5, 100.5, NOW - 100);

    assert!(h.open_on(NOW + 20_000).is_none()); // both read twenty seconds before the cross

    assert_eq!(h.warnings()[0].text("reason"), "anchor_stale");
}

#[test]
fn opens_on_two_anchors_read_within_the_skew() {
    let mut h = Harness::unpolled();
    anchor_leg(&mut h.cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchor_leg(&mut h.cluster, BYBIT, 100.5, 100.5, NOW - 4_000); // a slow bybit round, stamped when its reply arrived

    let opened = h.open_on(NOW).expect("a skew inside ANCHOR_SKEW_MS opens");

    assert_eq!(opened.anchor_at_open.buy.written_at, NOW - 100);
}

#[test]
fn warns_once_per_window_while_a_standing_basis_keeps_coming_back() {
    let mut h = Harness::unpolled();
    anchor_leg(&mut h.cluster, BINANCE, 100.2, 100.2, NOW - 100);
    anchor_leg(&mut h.cluster, BYBIT, 101.2, 101.2, NOW - 100);

    h.open_on(NOW);
    h.tick(BYBIT, 101.01, 101.5, NOW + 1_000);
    // The pollers keep writing while the basis stands, so the anchors are fresh again for the tick past the window.
    anchor_leg(&mut h.cluster, BINANCE, 100.2, 100.2, NOW + 10_900);
    anchor_leg(&mut h.cluster, BYBIT, 101.2, 101.2, NOW + 10_900);
    h.tick(BYBIT, 101.02, 101.5, NOW + 11_000);

    let warnings = h.warnings();
    assert_eq!(warnings.len(), 2);
    assert_eq!(warnings[1].number("occurrence_count"), 5.0); // the two ticks that plant the cross, the okx tick behind them, and two bybit ticks
    assert_eq!(warnings[1].number("suppressed_count"), 3.0);
}

#[test]
fn carries_the_anchor_into_the_close_log() {
    let mut h = Harness::unpolled();
    anchor_leg(&mut h.cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchor_leg(&mut h.cluster, BYBIT, 100.5, 100.5, NOW - 100);

    h.open_on(NOW).expect("the anchors agree");
    h.tick(BYBIT, 100.0, 100.5, NOW + 50); // collapses

    let closes = h.logs.events("opportunity_closed");
    assert_eq!(closes.len(), 1);
    assert_close(
        closes[0].number("fresh_net_ppm_at_open"),
        closes[0].number("net_ppm_at_open"),
        6,
    );
    assert_close(closes[0].number("standing_ppm_at_open"), 0.0, 6);
}

// OpportunityManager anchor on the row

#[test]
fn records_the_anchor_series_only_when_a_leg_moved_and_the_fresh_series_on_every_sample() {
    let mut h = Harness::unpolled();
    anchor_leg(&mut h.cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchor_leg(&mut h.cluster, BYBIT, 100.5, 100.5, NOW - 100);

    h.open_on(NOW).expect("the anchors agree");
    h.tick(BYBIT, 101.1, 101.5, NOW + 100); // same anchors
    anchor_leg(&mut h.cluster, BYBIT, 100.5, 100.7, NOW + 900); // the poller moved bybit's mark
    h.tick(BYBIT, 101.2, 101.5, NOW + 1_000);
    h.tick(BINANCE, 99.9, 100.1, NOW + 1_100); // same anchors again

    let route = h.route("bybit-binance");
    assert_eq!(route.anchor_ts_ms, [0, 1_000]);
    assert_eq!(route.highest_bid_mark_series, [100.5, 100.7]);
    assert_eq!(route.highest_bid_index_series, [100.5, 100.5]);
    assert_eq!(route.lowest_ask_index_series, [100.5, 100.5]);
    assert_eq!(route.lowest_ask_mark_series, [100.5, 100.5]);
    assert_eq!(route.fresh_net_ppm_series.len(), route.sample_ts.len());
    assert_close(route.fresh_net_ppm_series[0], route.net_ppm_at_open, 6);
    // From the third sample on, ten basis points of bybit's premium are standing and the fresh series sits under the net series.
    assert!(route.fresh_net_ppm_series[2] < route.net_ppm_series[2] - 900.0);
    assert_eq!(
        route.last_anchor.expect("readable anchors").sell.mark,
        100.7
    );
}

#[test]
fn marks_the_samples_where_the_anchor_could_not_be_read_and_leaves_the_anchor_series_alone() {
    let mut h = Harness::unpolled();
    anchor_leg(&mut h.cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchor_leg(&mut h.cluster, BYBIT, 100.5, 100.5, NOW - 100);

    h.open_on(NOW).expect("the anchors agree");
    h.tick(BYBIT, 101.1, 101.5, NOW + 20_000); // both anchors are now stale

    let route = h.route("bybit-binance");
    assert_eq!(route.fresh_net_ppm_series.len(), 2);
    assert_eq!(route.fresh_net_ppm_series[1], NO_ANCHOR);
    assert_eq!(route.anchor_ts_ms, [0]);
    assert!(route.last_anchor.is_none());
    assert_eq!(route.closed_at, None); // a sample with no verdict closes nothing
}

#[test]
fn closes_as_fresh_edge_collapsed_once_the_anchors_explain_a_cross_that_still_clears() {
    let mut h = Harness::unpolled();
    anchor_leg(&mut h.cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchor_leg(&mut h.cluster, BYBIT, 100.5, 100.5, NOW - 100);

    h.open_on(NOW).expect("the anchors agree");
    // bybit's index and mark climb to its book, so the same raw cross is now almost all standing.
    anchor_leg(&mut h.cluster, BYBIT, 101.4, 101.4, NOW + 900);
    h.tick(BYBIT, 101.0, 101.5, NOW + 1_000);

    let closed = h.only_closed();
    assert_eq!(closed.close_reason, Some(CloseReason::FreshEdgeCollapsed));
    assert!(closed.last_net_ppm > 5_000.0);
    assert!(closed.last_anchor.expect("readable anchors").fresh_net_ppm < 1_000.0);
    // and discovery refuses it as a standing basis on the same tick
    assert!(h.routes().is_empty());
    assert_eq!(h.rejection("standing_basis").text("route"), "bybit-binance");
}

#[test]
fn keeps_the_anchors_at_the_peak_sample() {
    let mut h = Harness::unpolled();
    anchor_leg(&mut h.cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchor_leg(&mut h.cluster, BYBIT, 100.5, 100.5, NOW - 100);

    h.open_on(NOW).expect("the anchors agree");
    anchor_leg(&mut h.cluster, BYBIT, 100.5, 100.6, NOW + 400);
    h.tick(BYBIT, 102.0, 102.5, NOW + 500); // the peak, with bybit's mark moved

    let route = h.route("bybit-binance");
    assert_eq!(route.peak_at, NOW + 500);
    assert_eq!(
        route.peak_anchor.expect("readable at the peak").sell.mark,
        100.6
    );
    assert_eq!(route.anchor_at_open.sell.mark, 100.5);
}

#[test]
fn carries_the_anchors_the_derived_edges_and_the_series_to_the_writer() {
    let mut h = Harness::unpolled();
    anchor_leg(&mut h.cluster, BINANCE, 100.5, 100.5, NOW - 300); // binance's mark sits on its index
    anchor_leg(&mut h.cluster, BYBIT, 100.5, 100.6, NOW - 100);

    h.open_on(NOW).expect("the fresh edge clears");
    h.tick(BYBIT, 100.1, 101.5, NOW + 50); // collapses

    let closed = h.only_closed();
    let open = closed.anchor_at_open;
    assert_eq!(open.sell.index, 100.5);
    assert_eq!(open.sell.mark, 100.6);
    assert_eq!(open.sell.funding_rate, -0.0038);
    assert_eq!(open.sell.funding_interval_hours, 4.0);
    assert_eq!(open.sell.next_funding_at, NOW + 3_600_000);
    assert_eq!(open.sell.written_at, NOW - 100);
    assert_close(open.sell.fresh_premium, 101.0 / 100.6 - 1.0, 12);
    assert_eq!(open.buy.mark, 100.5);
    assert_eq!(open.buy.funding_interval_hours, 8.0);
    assert_eq!(open.buy.written_at, NOW - 300);
    assert_close(open.buy.fresh_premium, 100.0 / 100.5 - 1.0, 12);
    assert_close(open.index_gap_ppm, 0.0, 6);
    assert_eq!(open.carried_ppm.round(), 995.0); // bybit's ten basis points over its index, binance carries nothing
    // The open was the peak, and the collapsing sample still read both anchors.
    assert_eq!(
        closed
            .peak_anchor
            .expect("readable at the peak")
            .carried_ppm,
        open.carried_ppm
    );
    assert!(closed.last_anchor.is_some());
    assert_eq!(closed.fresh_net_ppm_series.len(), closed.sample_ts.len());
    assert_eq!(closed.anchor_ts_ms, [0]);
    assert_eq!(closed.highest_bid_mark_series, [100.6]);
    assert_eq!(closed.lowest_ask_mark_series, [100.5]);
}

// Rust-only cases, for rules the TypeScript spec left unpinned.

// An open route that is the best cross drops the pending one, so an interrupted cross starts its age again.
#[test]
fn drops_the_pending_cross_while_an_open_route_is_the_best_one() {
    let mut h = Harness::new();

    h.open_on(1_000).expect("bybit-binance opens");
    h.tick(OKX, 99.4, 99.5, 2_000); // okx undercuts, so the bybit-okx cross is seen
    h.tick(OKX, 99.4, 100.5, 2_050); // okx backs off, and the open bybit-binance is the best cross again

    assert!(h.tick(OKX, 99.4, 99.5, 2_120).is_none()); // 120 ms after the first sight, but seen again only now
    let opened = h
        .tick(OKX, 99.4, 99.5, 2_220)
        .expect("bybit-okx has held since 2_120");
    assert_eq!(opened.opened_at, 2_220);
}

// The engine refuses a quote without a positive ask before it reaches the cluster, so this guard is the second line.
#[test]
fn skips_a_live_slot_that_quotes_no_ask() {
    let mut h = Harness::new();

    h.tick(BINANCE, 99.9, 100.0, 1_000);
    h.tick(OKX, 99.4, 0.0, 1_000);

    assert!(h.manager.lifecycle.routes(PAIR).is_none());
    assert!(h.warnings().is_empty()); // a zero ask read as the lowest would refuse as implausible
}
