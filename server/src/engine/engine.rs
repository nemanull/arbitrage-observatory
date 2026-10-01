use super::cluster::index_builder::DEPTH_LEVEL;
use super::cluster::{AnchorReading, BookLevel, Cluster, ClusterId};
use super::opportunity::opportunity_manager::OpportunityManager;
use crate::clock::now_ms;
use std::collections::HashMap;
use tokio::sync::mpsc::Receiver;

// The one queue between every feed and the engine, and the feeds coalesce when it is full.
pub const ENGINE_QUEUE_CAPACITY: usize = 4_096;

const ENGINE_BATCH: usize = 256;
const SUMMARY_EVERY_MS: i64 = 60_000;

// A venue that keeps sending the same broken quote would otherwise log once per tick.
// One warning per slot and issue set per window, and the next warning carries the counts.
const INVALID_QUOTE_WARN_WINDOW_MS: i64 = 10_000;

const _: () = assert!(DEPTH_LEVEL <= u8::MAX as usize); // Levels counts in a u8

// One market's column in one cluster, resolved once at boot so no message carries a string key.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Hash)]
pub struct Slot {
    pub cluster: ClusterId,
    pub venue: usize, // the venue's index, its column in every cluster
}

// Up to DEPTH_LEVEL levels of one side, best first, in a fixed array so a book update never allocates.
#[derive(Debug, Clone, Copy)]
pub struct Levels {
    len: u8,
    items: [BookLevel; DEPTH_LEVEL],
}

impl Levels {
    pub fn from_slice(levels: &[BookLevel]) -> Self {
        let len = levels.len().min(DEPTH_LEVEL);
        let mut items = [BookLevel { price: 0.0, size: 0.0 }; DEPTH_LEVEL];
        items[..len].copy_from_slice(&levels[..len]);
        Self {
            len: len as u8,
            items,
        }
    }

    pub fn as_slice(&self) -> &[BookLevel] {
        &self.items[..usize::from(self.len)]
    }
}

#[derive(Debug, Clone)]
pub struct BookUpdate {
    pub slot: Slot,
    pub bids: Levels,
    pub asks: Levels,
    pub recv_ts: i64, // Unix ms when the frame behind this state came off the socket, not when it was sent here
}

#[derive(Debug)]
pub enum EngineEvent {
    Book(BookUpdate), // one market's newest book, from the socket that owns it
    Stale {
        venue: usize,
        clusters: Vec<ClusterId>, // every market the closed socket carried
        connection: String,       // "bybit#linear#0"
    },
    Anchors(Vec<(Slot, AnchorReading)>), // one poll round of one venue, validated by the poller
    Sweep,
    Shutdown,
}

#[derive(Debug, Clone, Copy)]
struct Quote {
    bid: f64,
    ask: f64,
    bid_size: f64, // raw contracts, as the venue counts them
    ask_size: f64,
    recv_ts: i64,
}

#[derive(Default)]
struct WarnState {
    occurrence_count: u64, // rejections seen for this key since the engine started
    suppressed_count: u64, // rejections swallowed since the last warning
    last_warned_at: Option<i64>,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Side {
    Bid,
    Ask,
}

pub struct Engine {
    clusters: Vec<Cluster>,
    manager: OpportunityManager,
    invalid_quote_warn_states: HashMap<(Slot, Vec<&'static str>), WarnState>,
}

impl Engine {
    pub fn new(clusters: Vec<Cluster>, manager: OpportunityManager) -> Self {
        Self {
            clusters,
            manager,
            invalid_quote_warn_states: HashMap::new(),
        }
    }

    // Depth first, then the top of each side is the quote, and a side with no level drops the quote.
    pub fn update_book(&mut self, update: &BookUpdate, now: i64) -> bool {
        let slot = update.slot;

        if !self.has_market(slot) {
            tracing::warn!(
                event = "book_update_rejected",
                cluster = slot.cluster,
                venue_index = slot.venue,
                issue = "unknown_market",
            );
            return false;
        }

        let bids = update.bids.as_slice();
        let asks = update.asks.as_slice();

        if !self.write_depth(slot, bids, asks, update.recv_ts) {
            return false;
        }

        if bids.is_empty() || asks.is_empty() {
            let empty_side = if bids.is_empty() { "bids" } else { "asks" };
            self.drop_quote(slot, update.recv_ts, empty_side);
            return true;
        }

        let quote = Quote {
            bid: bids[0].price,
            ask: asks[0].price,
            bid_size: bids[0].size,
            ask_size: asks[0].size,
            recv_ts: update.recv_ts,
        };
        self.apply_quote(slot, quote, now);

        true
    }

    fn apply_quote(&mut self, slot: Slot, quote: Quote, now: i64) {
        let issues = quote_issues(&quote);

        if !issues.is_empty() {
            let cluster = &self.clusters[slot.cluster];
            report_invalid_quote(&mut self.invalid_quote_warn_states, cluster, slot, &quote, issues, now);
            return;
        }

        let cluster = &mut self.clusters[slot.cluster];
        let v = slot.venue;

        // Sizes land before the repeat check, so a size-only change is stored but never runs discovery.
        cluster.bid_size[v] = quote.bid_size;
        cluster.ask_size[v] = quote.ask_size;

        // A repeat of the same prices carries nothing new for a live slot, whatever the sizes did.
        // After mark_stale the slot is not live, so the same numbers are a fresh quote and run discovery.
        if cluster.recv_ts[v] > 0 && cluster.bid[v] == quote.bid && cluster.ask[v] == quote.ask {
            cluster.recv_ts[v] = quote.recv_ts;
            return;
        }

        cluster.bid[v] = quote.bid;
        cluster.ask[v] = quote.ask;
        cluster.recv_ts[v] = quote.recv_ts;

        self.manager.validate(cluster, v, quote.recv_ts);
    }

    fn drop_quote(&mut self, slot: Slot, now: i64, empty_side: &'static str) {
        let cluster = &mut self.clusters[slot.cluster];
        let was_live = cluster.recv_ts[slot.venue] > 0;

        cluster.recv_ts[slot.venue] = 0;
        let closed = self
            .manager
            .lifecycle
            .close_opportunities_on_venue(&cluster.pair, slot.venue, now);

        if was_live {
            let market = cluster.markets[slot.venue].as_ref();
            tracing::warn!(
                event = "book_one_sided",
                venue = market.map(|m| m.venue_id.as_str()),
                market = market.map(|m| m.raw_market_id.as_str()),
                pair = %cluster.pair,
                empty_side,
                closed,
            );
        }
    }

    fn write_depth(&mut self, slot: Slot, bids: &[BookLevel], asks: &[BookLevel], ts: i64) -> bool {
        let cluster = &mut self.clusters[slot.cluster];

        let mut issue = depth_issue(bids, Side::Bid).or_else(|| depth_issue(asks, Side::Ask));
        if issue.is_none() && ts <= 0 {
            issue = Some("ts_not_positive");
        }

        if let Some(issue) = issue {
            let market = cluster.markets[slot.venue].as_ref();
            tracing::warn!(
                event = "depth_update_rejected",
                venue = market.map(|m| m.venue_id.as_str()),
                market = market.map(|m| m.raw_market_id.as_str()),
                pair = %cluster.pair,
                issue,
                bids = bids.len(),
                asks = asks.len(),
            );
            return false;
        }

        let depth = &mut cluster.depth;
        let v = slot.venue;
        let base = v * depth.max_levels;
        let bid_count = bids.len().min(depth.max_levels);
        let ask_count = asks.len().min(depth.max_levels);

        for l in 0..bid_count {
            depth.bid_price[base + l] = bids[l].price;
            depth.bid_size[base + l] = bids[l].size;
        }

        for l in 0..ask_count {
            depth.ask_price[base + l] = asks[l].price;
            depth.ask_size[base + l] = asks[l].size;
        }

        depth.bid_level_count[v] = bid_count as u8;
        depth.ask_level_count[v] = ask_count as u8;
        depth.written_at[v] = ts;

        true
    }

    // An anchor write is not a tick, so it opens nothing itself.
    pub fn update_anchor(&mut self, slot: Slot, reading: &AnchorReading) -> bool {
        if !self.has_market(slot) {
            tracing::warn!(
                event = "anchor_update_rejected",
                cluster = slot.cluster,
                venue_index = slot.venue,
                issue = "unknown_market",
            );
            return false;
        }

        let cluster = &mut self.clusters[slot.cluster];

        if let Some(issue) = anchor_issue(reading) {
            let market = cluster.markets[slot.venue].as_ref();
            tracing::warn!(
                event = "anchor_update_rejected",
                venue = market.map(|m| m.venue_id.as_str()),
                market = market.map(|m| m.raw_market_id.as_str()),
                pair = %cluster.pair,
                issue,
                index = reading.index,
                mark = reading.mark,
                funding_rate = reading.funding_rate,
                funding_interval_hours = reading.funding_interval_hours,
                next_funding_at = reading.next_funding_at,
                ts = reading.ts,
            );
            return false;
        }

        let anchor = &mut cluster.anchor;
        let i = slot.venue;

        anchor.move_ppm[i] = anchor_move_ppm(anchor.index[i], anchor.mark[i], reading);
        anchor.index[i] = reading.index;
        anchor.mark[i] = reading.mark;
        anchor.funding_rate[i] = reading.funding_rate;
        anchor.funding_interval_hours[i] = reading.funding_interval_hours;
        anchor.next_funding_at[i] = reading.next_funding_at;
        anchor.written_at[i] = reading.ts;

        true
    }

    // Called when a socket dies, so its markets stop counting as live until their next frame.
    // Every open route on them closes here, because no later tick can be trusted to do it.
    // The depth goes with the quote, and the anchors stay, since a poller writes them.
    pub fn mark_stale(&mut self, venue: usize, clusters: &[ClusterId], connection: &str, now: i64) -> usize {
        let mut closed = 0;

        for &id in clusters {
            let Some(cluster) = self.clusters.get_mut(id) else {
                continue;
            };
            if venue >= cluster.recv_ts.len() {
                continue;
            }

            cluster.recv_ts[venue] = 0;
            cluster.depth.bid_level_count[venue] = 0;
            cluster.depth.ask_level_count[venue] = 0;
            cluster.depth.written_at[venue] = 0;
            closed += self
                .manager
                .lifecycle
                .close_opportunities_on_venue(&cluster.pair, venue, now);
        }

        if closed > 0 {
            tracing::info!(
                event = "feed_down_closed_opportunities",
                connection,
                markets = clusters.len(),
                closed,
            );
        }

        closed
    }

    // The age cap needs a timer, since a route whose legs stop changing has no tick left to reach it.
    pub fn sweep(&mut self, now: i64) -> usize {
        self.manager.lifecycle.sweep(now)
    }

    // Closes every open route and drops the writer's sender with the lifecycle, so the writer drains and returns.
    pub fn shutdown(self, now: i64) -> usize {
        self.manager.lifecycle.shutdown(now)
    }

    fn has_market(&self, slot: Slot) -> bool {
        self.clusters
            .get(slot.cluster)
            .and_then(|cluster| cluster.markets.get(slot.venue))
            .is_some_and(|market| market.is_some())
    }
}

pub fn run_engine(mut engine: Engine, mut rx: Receiver<EngineEvent>) -> usize {
    let mut batch = Vec::with_capacity(ENGINE_BATCH);
    let mut summary = Summary::new(now_ms());

    while rx.blocking_recv_many(&mut batch, ENGINE_BATCH) > 0 {
        for event in batch.drain(..) {
            let now = now_ms();

            match event {
                EngineEvent::Book(update) => {
                    summary.books += 1;
                    summary.max_queue_lag_ms = summary.max_queue_lag_ms.max(now - update.recv_ts);
                    engine.update_book(&update, now);
                }
                EngineEvent::Stale {
                    venue,
                    clusters,
                    connection,
                } => {
                    summary.stale += 1;
                    engine.mark_stale(venue, &clusters, &connection, now);
                }
                EngineEvent::Anchors(readings) => {
                    summary.anchor_rounds += 1;
                    for (slot, reading) in &readings {
                        engine.update_anchor(*slot, reading);
                    }
                }
                EngineEvent::Sweep => {
                    let closed = engine.sweep(now);
                    if closed > 0 {
                        tracing::info!(event = "sweep_closed_opportunities", closed);
                    }
                    if now - summary.since >= SUMMARY_EVERY_MS {
                        summary.log(rx.len(), now);
                    }
                }
                EngineEvent::Shutdown => return engine.shutdown(now),
            }
        }
    }

    // Every sender is gone, so nothing else can arrive.
    engine.shutdown(now_ms())
}

struct Summary {
    since: i64,
    books: u64,
    anchor_rounds: u64,
    stale: u64,
    max_queue_lag_ms: i64, // the oldest book applied, measured from the arrival of its newest frame
}

impl Summary {
    fn new(now: i64) -> Self {
        Self {
            since: now,
            books: 0,
            anchor_rounds: 0,
            stale: 0,
            max_queue_lag_ms: 0,
        }
    }

    fn log(&mut self, queued: usize, now: i64) {
        tracing::info!(
            event = "engine_summary",
            window_ms = now - self.since,
            books = self.books,
            anchor_rounds = self.anchor_rounds,
            stale = self.stale,
            max_queue_lag_ms = self.max_queue_lag_ms,
            queued,
        );
        *self = Self::new(now);
    }
}

// Empty when the quote is valid, which allocates nothing.
fn quote_issues(q: &Quote) -> Vec<&'static str> {
    let mut issues = Vec::new();
    let bid_ok = q.bid.is_finite() && q.bid > 0.0;
    let ask_ok = q.ask.is_finite() && q.ask > 0.0;

    if !q.bid.is_finite() {
        issues.push("bid_not_finite");
    } else if q.bid <= 0.0 {
        issues.push("bid_not_positive");
    }

    if !q.ask.is_finite() {
        issues.push("ask_not_finite");
    } else if q.ask <= 0.0 {
        issues.push("ask_not_positive");
    }

    if bid_ok && ask_ok && q.bid > q.ask {
        issues.push("crossed_quote");
    }

    if !q.bid_size.is_finite() {
        issues.push("bid_size_not_finite");
    } else if q.bid_size < 0.0 {
        issues.push("bid_size_negative"); // zero is valid: an empty level is a fact about the book
    }

    if !q.ask_size.is_finite() {
        issues.push("ask_size_not_finite");
    } else if q.ask_size < 0.0 {
        issues.push("ask_size_negative");
    }

    if q.recv_ts <= 0 {
        issues.push("recv_ts_not_positive");
    }

    issues
}

fn report_invalid_quote(
    states: &mut HashMap<(Slot, Vec<&'static str>), WarnState>,
    cluster: &Cluster,
    slot: Slot,
    quote: &Quote,
    issues: Vec<&'static str>,
    now: i64,
) {
    let state = states.entry((slot, issues.clone())).or_default();
    state.occurrence_count += 1;

    if state
        .last_warned_at
        .is_some_and(|at| now - at < INVALID_QUOTE_WARN_WINDOW_MS)
    {
        state.suppressed_count += 1;
        return;
    }

    let market = cluster.markets[slot.venue].as_ref();
    tracing::warn!(
        event = "quote_update_rejected",
        reason = "invalid_quote",
        issues = ?issues,
        venue = market.map(|m| m.venue_id.as_str()),
        market = market.map(|m| m.raw_market_id.as_str()),
        pair = %cluster.pair,
        venue_index = slot.venue,
        bid = quote.bid,
        ask = quote.ask,
        bid_size = quote.bid_size,
        ask_size = quote.ask_size,
        recv_ts = quote.recv_ts,
        occurrence_count = state.occurrence_count,
        suppressed_count = state.suppressed_count,
    );

    state.last_warned_at = Some(now);
    state.suppressed_count = 0;
}

fn depth_issue(levels: &[BookLevel], side: Side) -> Option<&'static str> {
    let bid = side == Side::Bid;

    for l in 0..levels.len() {
        let BookLevel { price, size } = levels[l];

        if !price.is_finite() || price <= 0.0 {
            return Some(if bid { "bid_price_invalid" } else { "ask_price_invalid" });
        }

        if !size.is_finite() || size < 0.0 {
            return Some(if bid { "bid_size_invalid" } else { "ask_size_invalid" });
        }

        if l > 0 {
            let previous = levels[l - 1].price;
            let ordered = if bid { price <= previous } else { price >= previous };

            if !ordered {
                return Some(if bid { "bids_out_of_order" } else { "asks_out_of_order" });
            }
        }
    }

    None
}

// The anchor poller runs this before it sends, and the engine runs it again on arrival.
pub fn anchor_issue(r: &AnchorReading) -> Option<&'static str> {
    if !r.index.is_finite() || r.index <= 0.0 {
        return Some("index_invalid");
    }
    if !r.mark.is_finite() || r.mark < 0.0 {
        return Some("mark_invalid"); // zero is valid: the venue publishes no mark
    }
    if !r.funding_rate.is_finite() {
        return Some("funding_rate_invalid"); // either sign, and zero is a real rate
    }
    if !r.funding_interval_hours.is_finite() || r.funding_interval_hours <= 0.0 {
        return Some("funding_interval_invalid");
    }
    if r.next_funding_at < 0 {
        return Some("next_funding_at_invalid"); // zero is valid: unknown
    }
    if r.ts <= 0 {
        return Some("ts_not_positive");
    }
    None
}

fn anchor_move_ppm(previous_index: f64, previous_mark: f64, reading: &AnchorReading) -> f64 {
    if previous_index <= 0.0 {
        return f64::INFINITY;
    }

    let index_move = relative_move_ppm(previous_index, reading.index);
    let mark_move = if previous_mark > 0.0 && reading.mark > 0.0 {
        relative_move_ppm(previous_mark, reading.mark)
    } else {
        0.0
    };

    index_move.max(mark_move)
}

fn relative_move_ppm(previous: f64, next: f64) -> f64 {
    (next - previous).abs() / previous * 1_000_000.0
}

#[cfg(test)]
mod tests;
