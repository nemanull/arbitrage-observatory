use std::collections::HashMap;
use super::cluster::{Cluster, Market, PairKey};

pub type RouteKey = String; // "bybit-binance": the venue we sell on, then the venue we buy on

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CloseReason {
    SpreadCollapsed,    // fell below CLOSURE_NET_PPM
    FreshEdgeCollapsed, // the fresh edge fell below CLOSURE_NET_PPM while the raw cross still cleared it
    FeedDown,           // the socket carrying one leg closed
    AgeCap,             // MAX_OPPORTUNITY_AGE_MS
    Shutdown,
}

// One leg's anchor as read at open, see anchor_reading.rs.
// Prices are raw venue prices, premiums are fractions: 0.01 = one percent above.
#[derive(Debug, Clone, Copy)]
pub struct AnchorLeg {
    pub index: f64,
    pub mark: f64,           // a route opens only on a positive mark
    pub touch: f64,          // the top-of-book price your trade would actually hit on that leg
    pub touch_premium: f64,  // touch over index minus one, what the book says
    pub mark_premium: f64,   // mark over index minus one, what the venue has accepted
    pub fresh_premium: f64,  // touch over mark minus one, what the book says that the venue has not absorbed
    pub funding_rate: f64,
    pub funding_interval_hours: f64,
    pub next_funding_at: i64, // Unix ms
    pub written_at: i64,      // Unix ms
}

// The cross factors into three parts, docs/bestiary/index-mark-and-premium.md.
// In fractions, 1 + net_ppm = (1 + index_gap_ppm) × (1 + carried_ppm) × (1 + fresh_net_ppm).
#[derive(Debug, Clone, Copy)]
pub struct AnchorPair {
    pub sell: AnchorLeg,     // the venue of the highest bid
    pub buy: AnchorLeg,      // the venue of the lowest ask
    pub index_gap_ppm: f64,  // sell index over buy index minus one: the structural part, which funding never closes
    pub carried_ppm: f64,    // the accepted premiums' gap, the part funding is pricing and closes over hours
    pub fresh_net_ppm: f64,  // the net edge after fees once each book is divided by its own anchor, the part a taker cross can capture
    pub standing_ppm: f64,   // net_ppm minus fresh_net_ppm, the part the two anchors already explain
}

// Why read_anchor_pair could not judge a route, which refuses it, see anchor_reading.rs.
// A refused route writes no row, so the AnchorIssue enum in schema.prisma keeps only the three that could open a route unjudged before 2026-09-14.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum AnchorIssue {
    Missing,
    Stale,
    Skewed,
    NoMark,
    Moving,
}

#[derive(Debug, Clone, Copy)]
pub struct EdgeSample {
    pub avg_ppm: f64,       // average edge over the whole region after fees. 0 when the region is empty
    pub size: f64,          // coins in the region, the same quantity bought and sold
    pub notional: f64,      // what buying the region costs after fees, in the quote asset
    pub exhausted: bool,    // the region ended because a book ran out of held levels, so size and notional are lower bounds
    pub buy_levels: usize,  // ask levels the region reaches into on the buy venue
    pub sell_levels: usize, // bid levels on the sell venue
}

pub const NO_ANCHOR: f64 = -2_000_000.0;

// net_ppm, highest_bid and lowest_ask are all after fee adjustments.
// An output of a runtime validation.
#[derive(Debug)]
pub struct Opportunity {
    pub highest_bid_market: Market,
    pub lowest_ask_market: Market,

    pub highest_bid_venue_index: usize,
    pub lowest_ask_venue_index: usize,

    // open snapshot
    pub opened_at: i64, // Unix ms
    pub net_ppm_at_open: f64,
    pub highest_bid_at_open: f64,
    pub lowest_ask_at_open: f64,

    pub highest_bid_size_at_open: f64,
    pub lowest_ask_size_at_open: f64,
    pub highest_bid_leg_ask_at_open: f64,
    pub lowest_ask_leg_bid_at_open: f64,

    // O(1), every tick, never sampled away
    pub ticks_since_start: u64,
    pub net_ppm_sum: f64,
    pub peak_net_ppm: f64,
    pub peak_at: i64,
    pub peak_highest_bid: f64,
    pub peak_lowest_ask: f64,
    pub peak_highest_bid_size: f64,
    pub peak_lowest_ask_size: f64,
    pub peak_highest_bid_leg_ask: f64,
    pub peak_lowest_ask_leg_bid: f64,
    pub min_net_ppm: f64,
    pub last_seen_at: i64,
    pub last_net_ppm: f64,
    pub last_highest_bid_size: f64,
    pub last_lowest_ask_size: f64,
    pub last_highest_bid_leg_ask: f64,
    pub last_lowest_ask_leg_bid: f64,

    pub net_ppm_series: Vec<f64>,
    pub highest_bid_series: Vec<f64>,
    pub lowest_ask_series: Vec<f64>,
    pub sample_ts: Vec<i32>, // ms since opened_at, one per sample
    pub edge_avg_ppm_series: Vec<f64>, // the walk per sample, aligned with sample_ts, -1 where a leg held no depth
    pub edge_notional_series: Vec<f64>,

    pub anchor_at_open: AnchorPair, // a route opens only on readable anchors
    pub peak_anchor: Option<AnchorPair>, // the anchors at the sample where net_ppm peaked
    pub last_anchor: Option<AnchorPair>,
    pub fresh_net_ppm_series: Vec<f64>, // aligned with sample_ts, NO_ANCHOR where no anchor could be read at that sample
    pub anchor_ts_ms: Vec<i32>, // ms since opened_at, one entry whenever either leg's index or mark changed, not capped since anchors change at most once a second
    pub highest_bid_index_series: Vec<f64>, // aligned with anchor_ts_ms, raw venue prices
    pub highest_bid_mark_series: Vec<f64>,
    pub lowest_ask_index_series: Vec<f64>,
    pub lowest_ask_mark_series: Vec<f64>,

    pub edge_at_open: Option<EdgeSample>,
    pub peak_edge: Option<EdgeSample>,
    pub peak_edge_at: i64,
    pub max_edge_notional: f64, // the largest region seen on any sample, in the quote asset
    pub last_edge: Option<EdgeSample>,
    pub edge_samples: u64, // samples where both legs held depth

    pub closed_at: Option<i64>,
    pub close_reason: Option<CloseReason>,
}

#[derive(Debug, Clone, Copy)]
pub struct Observation<'a> {
    pub cluster: &'a Cluster,
    pub highest_bid_market: &'a Market,
    pub lowest_ask_market: &'a Market,
    pub highest_bid_venue_index: usize,
    pub lowest_ask_venue_index: usize,
    pub highest_bid: f64,
    pub lowest_ask: f64,
    pub highest_bid_size: f64, // coins we could sell at highest_bid, already × size_mul
    pub lowest_ask_size: f64, // coins we could buy at lowest_ask
    pub highest_bid_leg_ask: f64, // the other side of the venue we sell on, fee adjusted like highest_bid. Its distance to highest_bid is that book's width
    pub lowest_ask_leg_bid: f64, // the other side of the venue we buy on
    pub net_ppm: f64,
    pub anchor: AnchorPair,
    pub now: i64, // Unix ms
}


pub type ActiveOpportunityMap = HashMap<PairKey, HashMap<RouteKey, Opportunity>>; // <"BTC|USDT", <"bybit-binance", Opportunity>>








