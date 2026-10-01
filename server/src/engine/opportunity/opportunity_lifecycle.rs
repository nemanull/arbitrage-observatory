use super::anchor_reading::read_anchor_pair;
use super::ladder_walk::walk_ladders;
use super::opportunity_writer::close_reason_label;
use super::{
    ActiveOpportunityMap, AnchorPair, CloseReason, EdgeSample, NO_ANCHOR, NO_EDGE, Observation,
    Opportunity, RouteKey,
};
use crate::engine::cluster::{Cluster, Market, PairKey};
use std::collections::hash_map::Entry;
use tokio::sync::mpsc::Sender;

pub const CLOSURE_NET_PPM: f64 = 1_000.0; // after fees
pub const MAX_OPPORTUNITY_AGE_MS: i64 = 5 * 60_000; // i64 like opened_at, so the age check needs no cast

// A route that never collapses runs to MAX_OPPORTUNITY_AGE_MS, which at the 436 samples/s seen on OPENAI is 130k samples. The counters keep going past this, only the series stop.
pub const MAX_SERIES_LENGTH: usize = 10_000;

pub struct OpportunityLifecycle {
    active: ActiveOpportunityMap,
    closed_tx: Sender<Opportunity>,
}

impl OpportunityLifecycle {
    pub fn new(closed_tx: Sender<Opportunity>) -> Self {
        Self {
            active: ActiveOpportunityMap::new(),
            closed_tx,
        }
    }

    pub fn update_opportunities_on_venue(&mut self, cluster: &Cluster, venue_index: usize, now: i64) {
        let Some(routes) = self.active.get_mut(&cluster.pair) else {
            return;
        };

        let mut closing: Vec<(RouteKey, CloseReason)> = Vec::new();

        for (route, opportunity) in routes.iter_mut() {
            if !opportunity.has_leg_on(venue_index) {
                continue;
            }

            if let Some(reason) = update_opportunity(opportunity, cluster, now) {
                closing.push((route.clone(), reason));
            }
        }

        // Closed after the walk, since a map cannot lose a route while it is being walked.
        for (route, reason) in closing {
            self.close_opportunity(&cluster.pair, &route, now, reason);
        }
    }

    pub fn track_opportunity(&mut self, o: Observation) -> &Opportunity {
        let route = get_route_key(o.highest_bid_market, o.lowest_ask_market);
        let routes = self.active.entry(o.cluster.pair.clone()).or_default();

        match routes.entry(route) {
            Entry::Occupied(entry) => {
                let opportunity = entry.into_mut();
                let sample = Sample {
                    highest_bid: o.highest_bid,
                    lowest_ask: o.lowest_ask,
                    highest_bid_size: o.highest_bid_size,
                    lowest_ask_size: o.lowest_ask_size,
                    highest_bid_leg_ask: o.highest_bid_leg_ask,
                    lowest_ask_leg_bid: o.lowest_ask_leg_bid,
                    net_ppm: o.net_ppm,
                    edge: walk_ladders(o.cluster, o.lowest_ask_venue_index, o.highest_bid_venue_index),
                    anchor: Some(o.anchor),
                    now: o.now,
                };

                record_sample(opportunity, &sample);
                opportunity
            }
            Entry::Vacant(entry) => entry.insert(Opportunity::createNew(o)),
        }
    }

    pub fn does_opportunity_already_exist(
        &self,
        pair: &str,
        highest_bid_market: &Market,
        lowest_ask_market: &Market,
    ) -> bool {
        self.active.get(pair).is_some_and(|routes| {
            routes.contains_key(&get_route_key(highest_bid_market, lowest_ask_market))
        })
    }

    // The age cap needs a timer. A route whose legs stop changing has no tick left to reach it.
    pub fn sweep(&mut self, now: i64) -> usize {
        self.close_opportunities_where(now, CloseReason::AgeCap, |opportunity| {
            opportunity.is_past_age_cap(now)
        })
    }

    // Closes every open opportunity on the pair with a leg on this venue, which is what a dying socket needs.
    pub fn close_opportunities_on_venue(&mut self, pair: &str, venue_index: usize, now: i64) -> usize {
        let Some(routes) = self.active.get(pair) else {
            return 0;
        };

        let mut closing: Vec<RouteKey> = Vec::new();

        for (route, opportunity) in routes {
            if opportunity.has_leg_on(venue_index) {
                closing.push(route.clone());
            }
        }

        for route in &closing {
            self.close_opportunity(pair, route, now, CloseReason::FeedDown);
        }

        closing.len()
    }

    // Closes everything and drops the sender, which lets run_writer drain the queue and return.
    // Await the writer's handle after this, and a stop loses no episode.
    pub fn shutdown(mut self, now: i64) -> usize {
        self.close_opportunities_where(now, CloseReason::Shutdown, |_| true)
    }

    fn close_opportunities_where(
        &mut self,
        now: i64,
        reason: CloseReason,
        should_close: impl Fn(&Opportunity) -> bool,
    ) -> usize {
        let mut closing: Vec<(PairKey, RouteKey)> = Vec::new();

        for (pair, routes) in &self.active {
            for (route, opportunity) in routes {
                if should_close(opportunity) {
                    closing.push((pair.clone(), route.clone()));
                }
            }
        }

        for (pair, route) in &closing {
            self.close_opportunity(pair, route, now, reason);
        }

        closing.len()
    }

    fn close_opportunity(&mut self, pair: &str, route: &str, now: i64, reason: CloseReason) {
        let Some(routes) = self.active.get_mut(pair) else {
            return;
        };
        let Some(mut opportunity) = routes.remove(route) else {
            return;
        };

        if routes.is_empty() {
            self.active.remove(pair);
        }

        opportunity.closed_at = Some(now);
        opportunity.close_reason = Some(reason);

        tracing::info!(
            event = "opportunity_closed",
            pair,
            route,
            reason = close_reason_label(reason),
            duration_ms = now - opportunity.opened_at,
            ticks = opportunity.ticks_since_start,
            net_ppm_at_open = opportunity.net_ppm_at_open,
            mean_net_ppm = opportunity.net_ppm_sum / opportunity.ticks_since_start as f64,
            peak_net_ppm = opportunity.peak_net_ppm,
            peak_at = opportunity.peak_at,
            min_net_ppm = opportunity.min_net_ppm,
            edge_avg_ppm_at_open = opportunity.edge_at_open.map(|edge| edge.avg_ppm),
            edge_notional_at_open = opportunity.edge_at_open.map(|edge| edge.notional),
            peak_edge_avg_ppm = opportunity.peak_edge.map(|edge| edge.avg_ppm),
            peak_edge_notional = opportunity.peak_edge.map(|edge| edge.notional),
            max_edge_notional = opportunity.max_edge_notional,
            edge_samples = opportunity.edge_samples,
            fresh_net_ppm_at_open = opportunity.anchor_at_open.fresh_net_ppm,
            standing_ppm_at_open = opportunity.anchor_at_open.standing_ppm,
            index_gap_ppm_at_open = opportunity.anchor_at_open.index_gap_ppm,
            carried_ppm_at_open = opportunity.anchor_at_open.carried_ppm,
            fresh_net_ppm_at_close = opportunity.last_anchor.map(|anchor| anchor.fresh_net_ppm),
        );

        // try_send never waits, so a slow database cannot stall the tick.
        // A full or closed queue loses the row, and this line is all that is left of it.
        if let Err(error) = self.closed_tx.try_send(opportunity) {
            tracing::error!(event = "opportunity_enqueue_failed", pair, route, %error);
        }
    }
}

pub fn get_route_key(highest_bid_market: &Market, lowest_ask_market: &Market) -> RouteKey {
    format!("{}-{}", highest_bid_market.venue_id, lowest_ask_market.venue_id)
}

// One reading of an open route, fee adjusted like Observation.
struct Sample {
    highest_bid: f64,
    lowest_ask: f64,
    highest_bid_size: f64,
    lowest_ask_size: f64,
    highest_bid_leg_ask: f64,
    lowest_ask_leg_bid: f64,
    net_ppm: f64,
    edge: Option<EdgeSample>,
    anchor: Option<AnchorPair>, // None when this sample's anchors could not be read, which closes nothing
    now: i64,                   // Unix ms
}

// Re-reads an open route from its own two legs, records the sample, then decides whether it closes.
fn update_opportunity(opportunity: &mut Opportunity, cluster: &Cluster, now: i64) -> Option<CloseReason> {
    let b = opportunity.highest_bid_venue_index;
    let a = opportunity.lowest_ask_venue_index;
    let highest_bid = cluster.bid[b] * cluster.bid_mul[b];
    let lowest_ask = cluster.ask[a] * cluster.ask_mul[a];
    let net_ppm = (highest_bid / lowest_ask - 1.0) * 1_000_000.0;

    let sample = Sample {
        highest_bid,
        lowest_ask,
        highest_bid_size: cluster.bid_size[b] * cluster.size_mul[b],
        lowest_ask_size: cluster.ask_size[a] * cluster.size_mul[a],
        highest_bid_leg_ask: cluster.ask[b] * cluster.ask_mul[b],
        lowest_ask_leg_bid: cluster.bid[a] * cluster.bid_mul[a],
        net_ppm,
        edge: walk_ladders(cluster, a, b),
        anchor: read_anchor_pair(
            cluster,
            b,
            a,
            &opportunity.highest_bid_market,
            &opportunity.lowest_ask_market,
            net_ppm,
            now,
        )
        .ok(),
        now,
    };

    record_sample(opportunity, &sample);

    // Recorded first, so a collapsing tick ends the series and the close log sees it.
    close_reason_for(opportunity, cluster, &sample)
}

fn record_sample(opportunity: &mut Opportunity, s: &Sample) {
    opportunity.ticks_since_start += 1;
    opportunity.net_ppm_sum += s.net_ppm;
    opportunity.last_seen_at = s.now;
    opportunity.last_net_ppm = s.net_ppm;
    opportunity.last_highest_bid_size = s.highest_bid_size;
    opportunity.last_lowest_ask_size = s.lowest_ask_size;
    opportunity.last_highest_bid_leg_ask = s.highest_bid_leg_ask;
    opportunity.last_lowest_ask_leg_bid = s.lowest_ask_leg_bid;
    opportunity.last_edge = s.edge;
    opportunity.last_anchor = s.anchor;

    if let Some(anchor) = &s.anchor {
        record_anchor_change(opportunity, anchor, s.now);
    }

    if let Some(edge) = s.edge {
        opportunity.edge_samples += 1;

        if edge.notional > opportunity.max_edge_notional {
            opportunity.max_edge_notional = edge.notional;
        }

        if opportunity.peak_edge.is_none_or(|peak| edge.avg_ppm > peak.avg_ppm) {
            opportunity.peak_edge = Some(edge);
            opportunity.peak_edge_at = s.now;
        }
    }

    if s.net_ppm > opportunity.peak_net_ppm {
        opportunity.peak_net_ppm = s.net_ppm;
        opportunity.peak_at = s.now;
        opportunity.peak_highest_bid = s.highest_bid;
        opportunity.peak_lowest_ask = s.lowest_ask;
        opportunity.peak_highest_bid_size = s.highest_bid_size;
        opportunity.peak_lowest_ask_size = s.lowest_ask_size;
        opportunity.peak_highest_bid_leg_ask = s.highest_bid_leg_ask;
        opportunity.peak_lowest_ask_leg_bid = s.lowest_ask_leg_bid;
        opportunity.peak_anchor = s.anchor;
    }

    if s.net_ppm < opportunity.min_net_ppm {
        opportunity.min_net_ppm = s.net_ppm;
    }

    if opportunity.net_ppm_series.len() >= MAX_SERIES_LENGTH {
        return;
    }

    opportunity.net_ppm_series.push(s.net_ppm);
    opportunity.highest_bid_series.push(s.highest_bid);
    opportunity.lowest_ask_series.push(s.lowest_ask);
    opportunity.sample_ts.push((s.now - opportunity.opened_at) as i32);
    opportunity.edge_avg_ppm_series.push(s.edge.map_or(NO_EDGE, |edge| edge.avg_ppm));
    opportunity.edge_notional_series.push(s.edge.map_or(NO_EDGE, |edge| edge.notional));
    opportunity.fresh_net_ppm_series.push(s.anchor.map_or(NO_ANCHOR, |anchor| anchor.fresh_net_ppm));
}

// Silence is not on this list. Every feed is change-driven, so a quiet leg is an unchanged leg, and a dead one is reported by mark_stale.
fn close_reason_for(opportunity: &Opportunity, cluster: &Cluster, s: &Sample) -> Option<CloseReason> {
    let bid_index = opportunity.highest_bid_venue_index;
    let ask_index = opportunity.lowest_ask_venue_index;

    // close_opportunities_on_venue closes these itself. This only guards the invariant that an open route has two live legs.
    if cluster.recv_ts[bid_index] <= 0 || cluster.recv_ts[ask_index] <= 0 {
        return Some(CloseReason::FeedDown);
    }

    if s.net_ppm < CLOSURE_NET_PPM {
        return Some(CloseReason::SpreadCollapsed);
    }

    // A basis keeps the raw cross open for as long as it stands, so the raw rule alone runs it to the age cap.
    if s.anchor.is_some_and(|anchor| anchor.fresh_net_ppm < CLOSURE_NET_PPM) {
        return Some(CloseReason::FreshEdgeCollapsed);
    }

    if opportunity.is_past_age_cap(s.now) {
        return Some(CloseReason::AgeCap);
    }

    None
}

// The anchors change at most once a second, so the series takes an entry only when a value moved, and a poll that rewrote the same numbers adds nothing.
fn record_anchor_change(opportunity: &mut Opportunity, anchor: &AnchorPair, now: i64) {
    let unchanged = opportunity.highest_bid_index_series.last() == Some(&anchor.sell.index)
        && opportunity.highest_bid_mark_series.last() == Some(&anchor.sell.mark)
        && opportunity.lowest_ask_index_series.last() == Some(&anchor.buy.index)
        && opportunity.lowest_ask_mark_series.last() == Some(&anchor.buy.mark);

    if unchanged {
        return;
    }

    opportunity.anchor_ts_ms.push((now - opportunity.opened_at) as i32);
    opportunity.highest_bid_index_series.push(anchor.sell.index);
    opportunity.highest_bid_mark_series.push(anchor.sell.mark);
    opportunity.lowest_ask_index_series.push(anchor.buy.index);
    opportunity.lowest_ask_mark_series.push(anchor.buy.mark);
}
