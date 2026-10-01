use super::anchor_reading::read_anchor_pair;
use super::ladder_walk::walk_ladders;
use super::opportunity_lifecycle::{OpportunityLifecycle, get_route_key};
use super::{AnchorIssue, AnchorPair, EdgeSample, Observation, Opportunity, RouteKey};
use crate::engine::cluster::{Cluster, PairKey};
use std::collections::HashMap;

const MIN_NET_PPM: f64 = 5_000.0; // after fees
const MIN_EDGE_NOTIONAL: f64 = 1_000.0; // quote units the profitable region must hold at open, the first checkpoint of docs/bestiary/thin-book.md
const MAX_PLAUSIBLE_NET_PPM: f64 = 100_000.0;

pub const MIN_CROSS_AGE_MS: i64 = 100;

const REJECTION_WARN_WINDOW_MS: i64 = 10_000;

struct PendingCross {
    route: RouteKey,
    first_seen_at: i64, // Unix ms
    net_ppm: f64,       // the reading at first sight, for the rejection line when it never confirms
}

#[derive(Default)]
struct RejectionWarnState {
    occurrence_count: u64, // rejections seen for this route and reason since the engine started
    suppressed_count: u64, // rejections swallowed since the last warning
    last_warned_at: Option<i64>, // Unix ms, None until the first warning
}

// Why a cross did not open, with the numbers its warning carries.
enum Rejection {
    ImplausibleNetPpm {
        net_ppm: f64,
        highest_bid: f64,
        lowest_ask: f64,
    },
    Anchor {
        issue: AnchorIssue,
        net_ppm: f64,
        sell_move_ppm: f64,
        buy_move_ppm: f64,
    },
    StandingBasis {
        net_ppm: f64,
        anchor: AnchorPair,
    },
    ThinBook {
        net_ppm: f64,
        fresh_net_ppm: f64,
        edge: Option<EdgeSample>,
    },
    UnconfirmedCross {
        net_ppm: f64,
        age_ms: i64,
    },
}

pub struct OpportunityManager {
    pub lifecycle: OpportunityLifecycle, // the engine calls sweep, close_opportunities_on_venue and shutdown on it directly
    pending_crosses: HashMap<PairKey, PendingCross>,
    rejection_warn_states: HashMap<String, RejectionWarnState>, // <"BTC|USDT|bybit-binance|thin_book", state>
}

impl OpportunityManager {
    pub fn new(lifecycle: OpportunityLifecycle) -> Self {
        Self {
            lifecycle,
            pending_crosses: HashMap::new(),
            rejection_warn_states: HashMap::new(),
        }
    }

    /// Runs once per tick that changed `venue_index`'s prices, with that tick's `recv_ts` as `now`, so a replay opens the same routes.
    /// Re-reads the open routes with a leg on that venue, then opens the cluster's best route when every gate passes.
    pub fn validate(
        &mut self,
        cluster: &Cluster,
        venue_index: usize,
        now: i64,
    ) -> Option<&Opportunity> {
        self.lifecycle
            .update_opportunities_on_venue(cluster, venue_index, now);

        let pair = cluster.pair.as_str();

        let (Some(b), Some(a)) = (highest_bid_slot(cluster), lowest_ask_slot(cluster)) else {
            self.forget_cross(pair, now);
            return None;
        };

        if b == a {
            self.forget_cross(pair, now);
            return None;
        }

        let (Some(highest_bid_market), Some(lowest_ask_market)) =
            (cluster.markets[b].as_ref(), cluster.markets[a].as_ref())
        else {
            self.forget_cross(pair, now);
            return None;
        };

        if self.lifecycle.does_opportunity_already_exist(
            pair,
            highest_bid_market,
            lowest_ask_market,
        ) {
            // Already tracked.
            // The maintain step above fed it on this tick if one of its legs moved.
            self.pending_crosses.remove(pair);
            return None;
        }

        let highest_bid = cluster.bid[b] * cluster.bid_mul[b];
        let lowest_ask = cluster.ask[a] * cluster.ask_mul[a];
        let net_ppm = (highest_bid / lowest_ask - 1.0) * 1_000_000.0;

        if net_ppm < MIN_NET_PPM {
            self.forget_cross(pair, now);
            return None;
        }

        let route = get_route_key(highest_bid_market, lowest_ask_market);

        if net_ppm > MAX_PLAUSIBLE_NET_PPM {
            let rejection = Rejection::ImplausibleNetPpm {
                net_ppm,
                highest_bid,
                lowest_ask,
            };
            self.report_rejection(rejection, pair, &route, now);
            return None;
        }

        let anchor = match read_anchor_pair(
            cluster,
            b,
            a,
            highest_bid_market,
            lowest_ask_market,
            net_ppm,
            now,
        ) {
            Ok(anchor) => anchor,
            // No verdict, no row.
            // A route whose anchors cannot be read is refused rather than opened unjudged.
            Err(issue) => {
                let rejection = Rejection::Anchor {
                    issue,
                    net_ppm,
                    sell_move_ppm: cluster.anchor.move_ppm[b],
                    buy_move_ppm: cluster.anchor.move_ppm[a],
                };
                self.report_rejection(rejection, pair, &route, now);
                return None;
            }
        };

        if anchor.fresh_net_ppm < MIN_NET_PPM {
            let rejection = Rejection::StandingBasis { net_ppm, anchor };
            self.report_rejection(rejection, pair, &route, now);
            return None;
        }

        let edge = walk_ladders(cluster, a, b);

        // A region this small is dust or a resting order nobody takes, and the anchors cannot see either.
        if edge.is_none_or(|edge| edge.notional < MIN_EDGE_NOTIONAL) {
            let rejection = Rejection::ThinBook {
                net_ppm,
                fresh_net_ppm: anchor.fresh_net_ppm,
                edge,
            };
            self.report_rejection(rejection, pair, &route, now);
            return None;
        }

        // Last, because a cross that the guards refuse is still a cross, and its age keeps running while they do.
        if !self.is_cross_old_enough(pair, &route, net_ppm, now) {
            return None;
        }

        let highest_bid_size = cluster.bid_size[b] * cluster.size_mul[b];
        let lowest_ask_size = cluster.ask_size[a] * cluster.size_mul[a];

        tracing::info!(
            event = "opportunity_opened",
            pair,
            route,
            net_ppm,
            fresh_net_ppm = anchor.fresh_net_ppm,
            highest_bid_size,
            lowest_ask_size,
            edge_avg_ppm = edge.map(|edge| edge.avg_ppm),
            edge_notional = edge.map(|edge| edge.notional),
            edge_exhausted = edge.map(|edge| edge.exhausted),
            opened_at = now,
        );

        Some(self.lifecycle.track_opportunity(Observation {
            cluster,
            highest_bid_market,
            lowest_ask_market,
            highest_bid_venue_index: b,
            lowest_ask_venue_index: a,
            highest_bid,
            lowest_ask,
            highest_bid_size,
            lowest_ask_size,
            highest_bid_leg_ask: cluster.ask[b] * cluster.ask_mul[b],
            lowest_ask_leg_bid: cluster.bid[a] * cluster.bid_mul[a],
            net_ppm,
            anchor,
            now,
        }))
    }

    // A cross opens a route only on a tick at least MIN_CROSS_AGE_MS after the tick that first showed it.
    // The clock belongs to the cross, so a different best route restarts it.
    fn is_cross_old_enough(&mut self, pair: &str, route: &str, net_ppm: f64, now: i64) -> bool {
        if let Some(pending) = self.pending_crosses.get(pair)
            && pending.route == route
        {
            if now - pending.first_seen_at < MIN_CROSS_AGE_MS {
                return false;
            }

            self.pending_crosses.remove(pair);
            return true;
        }

        let cross = PendingCross {
            route: route.to_string(),
            first_seen_at: now,
            net_ppm,
        };

        if let Some(replaced) = self.pending_crosses.insert(pair.to_string(), cross) {
            self.report_unconfirmed(pair, replaced, now);
        }

        false
    }

    fn forget_cross(&mut self, pair: &str, now: i64) {
        if let Some(pending) = self.pending_crosses.remove(pair) {
            self.report_unconfirmed(pair, pending, now);
        }
    }

    fn report_unconfirmed(&mut self, pair: &str, pending: PendingCross, now: i64) {
        let rejection = Rejection::UnconfirmedCross {
            net_ppm: pending.net_ppm,
            age_ms: now - pending.first_seen_at,
        };
        self.report_rejection(rejection, pair, &pending.route, now);
    }

    // A broken cluster refuses on every tick, so one warning per pair, route and reason per window, and the next one carries the counts.
    fn report_rejection(&mut self, rejection: Rejection, pair: &str, route: &str, now: i64) {
        let reason = rejection.reason();
        let state = self
            .rejection_warn_states
            .entry(format!("{pair}|{route}|{reason}"))
            .or_default();

        state.occurrence_count += 1;

        if state
            .last_warned_at
            .is_some_and(|at| now - at < REJECTION_WARN_WINDOW_MS)
        {
            state.suppressed_count += 1;
            return;
        }

        rejection.warn(pair, route, state.occurrence_count, state.suppressed_count);

        state.last_warned_at = Some(now);
        state.suppressed_count = 0;
    }
}

impl Rejection {
    fn reason(&self) -> &'static str {
        match self {
            Rejection::ImplausibleNetPpm { .. } => "implausible_net_ppm",
            Rejection::Anchor { issue, .. } => match issue {
                AnchorIssue::Missing => "anchor_missing",
                AnchorIssue::Stale => "anchor_stale",
                AnchorIssue::Skewed => "anchor_skewed",
                AnchorIssue::NoMark => "anchor_no_mark",
                AnchorIssue::Moving => "anchor_moving",
            },
            Rejection::StandingBasis { .. } => "standing_basis",
            Rejection::ThinBook { .. } => "thin_book",
            Rejection::UnconfirmedCross { .. } => "unconfirmed_cross",
        }
    }

    fn warn(&self, pair: &str, route: &str, occurrence_count: u64, suppressed_count: u64) {
        let reason = self.reason();

        match self {
            Rejection::ImplausibleNetPpm {
                net_ppm,
                highest_bid,
                lowest_ask,
            } => tracing::warn!(
                event = "opportunity_rejected",
                reason,
                pair,
                route,
                net_ppm,
                max_plausible_net_ppm = MAX_PLAUSIBLE_NET_PPM,
                highest_bid,
                lowest_ask,
                occurrence_count,
                suppressed_count,
            ),
            Rejection::Anchor {
                net_ppm,
                sell_move_ppm,
                buy_move_ppm,
                ..
            } => tracing::warn!(
                event = "opportunity_rejected",
                reason,
                pair,
                route,
                net_ppm,
                sell_move_ppm,
                buy_move_ppm,
                occurrence_count,
                suppressed_count,
            ),
            Rejection::StandingBasis { net_ppm, anchor } => tracing::warn!(
                event = "opportunity_rejected",
                reason,
                pair,
                route,
                net_ppm,
                fresh_net_ppm = anchor.fresh_net_ppm,
                standing_ppm = anchor.standing_ppm,
                index_gap_ppm = anchor.index_gap_ppm,
                carried_ppm = anchor.carried_ppm,
                sell_mark_premium = anchor.sell.mark_premium,
                buy_mark_premium = anchor.buy.mark_premium,
                sell_fresh_premium = anchor.sell.fresh_premium,
                buy_fresh_premium = anchor.buy.fresh_premium,
                sell_index = anchor.sell.index,
                buy_index = anchor.buy.index,
                occurrence_count,
                suppressed_count,
            ),
            Rejection::ThinBook {
                net_ppm,
                fresh_net_ppm,
                edge,
            } => tracing::warn!(
                event = "opportunity_rejected",
                reason,
                pair,
                route,
                net_ppm,
                fresh_net_ppm,
                edge_notional = edge.map(|edge| edge.notional),
                edge_avg_ppm = edge.map(|edge| edge.avg_ppm),
                edge_size = edge.map(|edge| edge.size),
                occurrence_count,
                suppressed_count,
            ),
            Rejection::UnconfirmedCross { net_ppm, age_ms } => tracing::warn!(
                event = "opportunity_rejected",
                reason,
                pair,
                route,
                net_ppm,
                age_ms,
                min_cross_age_ms = MIN_CROSS_AGE_MS,
                occurrence_count,
                suppressed_count,
            ),
        }
    }
}

// The live slot with the highest bid after fees.
// The first slot wins a tie.
fn highest_bid_slot(cluster: &Cluster) -> Option<usize> {
    let mut highest = 0.0;
    let mut slot = None;

    for i in 0..cluster.bid.len() {
        if cluster.recv_ts[i] <= 0 {
            continue;
        }

        let bid_after_fees = cluster.bid[i] * cluster.bid_mul[i];

        if bid_after_fees > highest {
            highest = bid_after_fees;
            slot = Some(i);
        }
    }

    slot
}

// The live slot with the lowest ask after fees.
// The first slot wins a tie.
fn lowest_ask_slot(cluster: &Cluster) -> Option<usize> {
    let mut lowest = f64::INFINITY;
    let mut slot = None;

    for i in 0..cluster.ask.len() {
        if cluster.recv_ts[i] <= 0 {
            continue;
        }

        let ask = cluster.ask[i];
        let ask_after_fees = ask * cluster.ask_mul[i];

        if ask > 0.0 && ask_after_fees < lowest {
            lowest = ask_after_fees;
            slot = Some(i);
        }
    }

    slot
}

#[cfg(test)]
mod tests;
