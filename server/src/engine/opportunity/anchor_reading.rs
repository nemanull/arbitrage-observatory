use super::{AnchorIssue, AnchorLeg, AnchorPair};
use crate::engine::cluster::{Cluster, Market};

pub const ANCHOR_SKEW_MS: i64 = 5_000;
pub const ANCHOR_MAX_AGE_MS: i64 = 10_000;
pub const MAX_ANCHOR_MOVE_PPM: f64 = 1_000.0; // per poll, on the index or the mark, whichever moved more, see docs/research/2026-09-14-open-guard-sizing.md

pub fn premium(price: f64, reference: f64) -> f64 {
    price / reference - 1.0
}

pub fn read_anchor_pair(
    cluster: &Cluster,
    sell_index: usize,
    buy_index: usize,
    sell_market: &Market,
    buy_market: &Market,
    net_ppm: f64,
    now: i64,
) -> Result<AnchorPair, AnchorIssue> {
    let anchor = &cluster.anchor;
    let sell_written_at = anchor.written_at[sell_index];
    let buy_written_at = anchor.written_at[buy_index];

    if sell_written_at <= 0 || buy_written_at <= 0 {
        return Err(AnchorIssue::Missing);
    }

    if (sell_written_at - buy_written_at).abs() > ANCHOR_SKEW_MS {
        return Err(AnchorIssue::Skewed);
    }

    if now - sell_written_at.min(buy_written_at) > ANCHOR_MAX_AGE_MS {
        return Err(AnchorIssue::Stale);
    }

    if anchor.mark[sell_index] <= 0.0 || anchor.mark[buy_index] <= 0.0 {
        return Err(AnchorIssue::NoMark);
    }

    // On a fast tape the fresh edge measures one anchor's lag behind the other rather than the book.
    if anchor.move_ppm[sell_index] > MAX_ANCHOR_MOVE_PPM
        || anchor.move_ppm[buy_index] > MAX_ANCHOR_MOVE_PPM
    {
        return Err(AnchorIssue::Moving);
    }

    let sell = read_leg(cluster, sell_index, cluster.bid[sell_index]);
    let buy = read_leg(cluster, buy_index, cluster.ask[buy_index]);

    let sell_keeps = 1.0 - f64::from(sell_market.taker_ppm) / 1_000_000.0;
    let buy_pays = 1.0 + f64::from(buy_market.taker_ppm) / 1_000_000.0;

    // Whatever the multipliers carry besides the fee, so the three factors multiply back to net_ppm.
    let sell_scale = cluster.bid_mul[sell_index] / sell_keeps;
    let buy_scale = cluster.ask_mul[buy_index] / buy_pays;

    let index_gap = (sell.index * sell_scale) / (buy.index * buy_scale);
    let carried = (1.0 + sell.mark_premium) / (1.0 + buy.mark_premium);
    let fresh = (1.0 + sell.fresh_premium) / (1.0 + buy.fresh_premium);
    let fresh_net_ppm = (fresh * sell_keeps / buy_pays - 1.0) * 1_000_000.0;

    Ok(AnchorPair {
        sell,
        buy,
        index_gap_ppm: (index_gap - 1.0) * 1_000_000.0,
        carried_ppm: (carried - 1.0) * 1_000_000.0,
        fresh_net_ppm,
        standing_ppm: net_ppm - fresh_net_ppm,
    })
}

fn read_leg(cluster: &Cluster, i: usize, touch: f64) -> AnchorLeg {
    let anchor = &cluster.anchor;
    let index = anchor.index[i];
    let mark = anchor.mark[i];

    AnchorLeg {
        index,
        mark,
        touch,
        touch_premium: premium(touch, index),
        mark_premium: premium(mark, index),
        fresh_premium: premium(touch, mark),
        funding_rate: anchor.funding_rate[i],
        funding_interval_hours: anchor.funding_interval_hours[i],
        next_funding_at: anchor.next_funding_at[i],
        written_at: anchor.written_at[i],
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::cluster::{ClusterAnchor, ClusterDepth};

    const SELL: usize = 0;
    const BUY: usize = 1;
    const NOW: i64 = 100_000;

    fn market(venue_id: &str, taker_ppm: u32) -> Market {
        Market {
            venue_id: venue_id.to_string(),
            raw_market_id: "BTCUSDT".to_string(),
            base: "BTC".to_string(),
            quote: "USDT".to_string(),
            taker_ppm,
            linear: true,
            contract_size: 1.0,
        }
    }

    // Two slots, the sell venue first. The multipliers carry the fees the way the cluster builder sets them.
    fn make_cluster(sell_bid: f64, buy_ask: f64) -> Cluster {
        let markets = [market("bybit", 550), market("binance", 500)];
        let width = markets.len();
        let mut cluster = Cluster {
            pair: "BTC|USDT".to_string(),
            bid_mul: markets
                .iter()
                .map(|m| 1.0 - f64::from(m.taker_ppm) / 1_000_000.0)
                .collect(),
            ask_mul: markets
                .iter()
                .map(|m| 1.0 + f64::from(m.taker_ppm) / 1_000_000.0)
                .collect(),
            size_mul: vec![1.0; width].into_boxed_slice(),
            bid: vec![0.0; width].into_boxed_slice(),
            ask: vec![0.0; width].into_boxed_slice(),
            bid_size: vec![0.0; width].into_boxed_slice(),
            ask_size: vec![0.0; width].into_boxed_slice(),
            recv_ts: vec![NOW; width].into_boxed_slice(),
            depth: ClusterDepth::new(width, 2).unwrap(),
            anchor: ClusterAnchor::new(width),
            markets: markets.into_iter().map(Some).collect(),
        };
        cluster.bid[SELL] = sell_bid;
        cluster.ask[BUY] = buy_ask;
        cluster
    }

    fn write_anchor(cluster: &mut Cluster, i: usize, index: f64, mark: f64) {
        write_anchor_at(cluster, i, index, mark, NOW - 200);
    }

    fn write_anchor_at(cluster: &mut Cluster, i: usize, index: f64, mark: f64, written_at: i64) {
        let anchor = &mut cluster.anchor;
        anchor.index[i] = index;
        anchor.mark[i] = mark;
        anchor.move_ppm[i] = 0.0; // a slot past its second poll, before which it holds f64::INFINITY
        anchor.funding_rate[i] = 0.0001;
        anchor.funding_interval_hours[i] = 8.0;
        anchor.next_funding_at[i] = NOW + 3_600_000;
        anchor.written_at[i] = written_at;
    }

    // The engine's own reading of the same two touches after fees.
    fn net_ppm(sell_bid: f64, buy_ask: f64) -> f64 {
        (sell_bid * 0.99945 / (buy_ask * 1.0005) - 1.0) * 1_000_000.0
    }

    fn read(cluster: &Cluster, net: f64) -> Result<AnchorPair, AnchorIssue> {
        let sell_market = cluster.markets[SELL].as_ref().unwrap();
        let buy_market = cluster.markets[BUY].as_ref().unwrap();
        read_anchor_pair(cluster, SELL, BUY, sell_market, buy_market, net, NOW)
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

    // In fractions the three factors multiply back to the raw edge.
    fn factors_product(pair: &AnchorPair) -> f64 {
        (1.0 + pair.index_gap_ppm / 1_000_000.0)
            * (1.0 + pair.carried_ppm / 1_000_000.0)
            * (1.0 + pair.fresh_net_ppm / 1_000_000.0)
    }

    #[test]
    fn reports_a_leg_that_was_never_written() {
        let mut cluster = make_cluster(101.0, 100.0);
        write_anchor(&mut cluster, SELL, 100.5, 100.5);

        assert_eq!(
            read(&cluster, net_ppm(101.0, 100.0)).unwrap_err(),
            AnchorIssue::Missing
        );
    }

    #[test]
    fn reports_two_legs_further_apart_than_the_skew_allows() {
        let mut cluster = make_cluster(101.0, 100.0);
        write_anchor_at(&mut cluster, SELL, 100.5, 100.5, NOW - 100);
        write_anchor_at(
            &mut cluster,
            BUY,
            100.5,
            100.5,
            NOW - 100 - ANCHOR_SKEW_MS - 1,
        );

        assert_eq!(
            read(&cluster, net_ppm(101.0, 100.0)).unwrap_err(),
            AnchorIssue::Skewed
        );
    }

    #[test]
    fn accepts_two_legs_exactly_at_the_skew() {
        let mut cluster = make_cluster(101.0, 100.0);
        write_anchor_at(&mut cluster, SELL, 100.5, 100.5, NOW - 100);
        write_anchor_at(&mut cluster, BUY, 100.5, 100.5, NOW - 100 - ANCHOR_SKEW_MS);

        assert!(read(&cluster, net_ppm(101.0, 100.0)).is_ok());
    }

    #[test]
    fn reports_a_pair_older_than_the_age_limit() {
        let mut cluster = make_cluster(101.0, 100.0);
        let written_at = NOW - ANCHOR_MAX_AGE_MS - 1;
        write_anchor_at(&mut cluster, SELL, 100.5, 100.5, written_at);
        write_anchor_at(&mut cluster, BUY, 100.5, 100.5, written_at);

        assert_eq!(
            read(&cluster, net_ppm(101.0, 100.0)).unwrap_err(),
            AnchorIssue::Stale
        );
    }

    #[test]
    fn refuses_a_leg_without_a_mark() {
        let mut cluster = make_cluster(101.0, 100.0);
        write_anchor(&mut cluster, SELL, 100.5, 100.5);
        write_anchor(&mut cluster, BUY, 100.5, 0.0);

        assert_eq!(
            read(&cluster, net_ppm(101.0, 100.0)).unwrap_err(),
            AnchorIssue::NoMark
        );
    }

    #[test]
    fn refuses_a_leg_that_moved_more_than_max_anchor_move_ppm_since_its_previous_poll() {
        let mut cluster = make_cluster(101.0, 100.0);
        write_anchor(&mut cluster, SELL, 100.5, 100.5);
        write_anchor(&mut cluster, BUY, 100.5, 100.5);
        cluster.anchor.move_ppm[BUY] = MAX_ANCHOR_MOVE_PPM + 1.0;

        assert_eq!(
            read(&cluster, net_ppm(101.0, 100.0)).unwrap_err(),
            AnchorIssue::Moving
        );
    }

    #[test]
    fn refuses_a_leg_on_its_first_poll_whose_move_is_unknown() {
        let mut cluster = make_cluster(101.0, 100.0);
        write_anchor(&mut cluster, SELL, 100.5, 100.5);
        write_anchor(&mut cluster, BUY, 100.5, 100.5);
        cluster.anchor.move_ppm[BUY] = f64::INFINITY;

        assert_eq!(
            read(&cluster, net_ppm(101.0, 100.0)).unwrap_err(),
            AnchorIssue::Moving
        );
    }

    #[test]
    fn accepts_a_leg_that_moved_exactly_the_threshold() {
        let mut cluster = make_cluster(101.0, 100.0);
        write_anchor(&mut cluster, SELL, 100.5, 100.5);
        write_anchor(&mut cluster, BUY, 100.5, 100.5);
        cluster.anchor.move_ppm[BUY] = MAX_ANCHOR_MOVE_PPM;

        assert!(read(&cluster, net_ppm(101.0, 100.0)).is_ok());
    }

    #[test]
    fn equals_the_net_edge_when_the_two_anchors_agree() {
        let mut cluster = make_cluster(101.0, 100.0);
        write_anchor(&mut cluster, SELL, 100.5, 100.5);
        write_anchor(&mut cluster, BUY, 100.5, 100.5);
        let net = net_ppm(101.0, 100.0);

        let pair = read(&cluster, net).unwrap();

        assert_close(pair.fresh_net_ppm, net, 6);
        assert_close(pair.standing_ppm, 0.0, 6);
        assert_eq!(pair.sell.mark_premium, 0.0);
        assert_eq!(pair.buy.mark_premium, 0.0);
    }

    #[test]
    fn removes_the_part_of_the_cross_the_anchors_explain() {
        let mut cluster = make_cluster(101.0, 100.0);
        write_anchor(&mut cluster, SELL, 101.0, 101.0); // the sell venue holds its perp one percent over the buy venue's
        write_anchor(&mut cluster, BUY, 100.0, 100.0);
        let net = net_ppm(101.0, 100.0);

        let pair = read(&cluster, net).unwrap();

        // Both books sit exactly on their anchors, so nothing is fresh and the fees are all that is left.
        assert_close(pair.fresh_net_ppm, net_ppm(1.0, 1.0), 6);
        assert_close(pair.standing_ppm, net - net_ppm(1.0, 1.0), 6);
    }

    #[test]
    fn reads_the_standing_part_from_the_mark_and_not_the_index() {
        let mut cluster = make_cluster(101.0, 100.0);
        write_anchor(&mut cluster, SELL, 100.0, 101.0); // index agrees with the buy venue, the mark carries a one percent premium
        write_anchor(&mut cluster, BUY, 100.0, 100.0);

        let pair = read(&cluster, net_ppm(101.0, 100.0)).unwrap();

        assert_close(pair.sell.mark_premium, 0.01, 12);
        assert_close(pair.fresh_net_ppm, net_ppm(1.0, 1.0), 6);
    }

    #[test]
    fn cancels_a_venue_quoting_in_another_unit_by_dividing_each_book_by_its_own_anchor() {
        let mut cluster = make_cluster(1010.0, 100.0); // the sell venue quotes ten times the buy venue's unit
        write_anchor(&mut cluster, SELL, 1005.0, 1005.0);
        write_anchor(&mut cluster, BUY, 100.5, 100.5);

        let pair = read(&cluster, net_ppm(101.0, 100.0)).unwrap();

        assert_close(pair.fresh_net_ppm, net_ppm(101.0, 100.0), 6);
    }

    #[test]
    fn copies_funding_onto_both_legs() {
        let mut cluster = make_cluster(101.0, 100.0);
        write_anchor_at(&mut cluster, SELL, 100.5, 100.5, NOW - 50);
        write_anchor_at(&mut cluster, BUY, 100.5, 100.5, NOW - 150);
        cluster.anchor.funding_rate[SELL] = -0.0038;
        cluster.anchor.funding_interval_hours[SELL] = 4.0;

        let pair = read(&cluster, net_ppm(101.0, 100.0)).unwrap();

        assert_eq!(pair.sell.funding_rate, -0.0038);
        assert_eq!(pair.sell.funding_interval_hours, 4.0);
        assert_eq!(pair.sell.written_at, NOW - 50);
        assert_eq!(pair.buy.funding_rate, 0.0001);
        assert_eq!(pair.buy.written_at, NOW - 150);
    }

    #[test]
    fn premium_is_the_price_over_the_reference_minus_one() {
        assert_close(premium(101.0, 100.0), 0.01, 12);
        assert_close(premium(99.0, 100.0), -0.01, 12);
        assert_eq!(premium(100.0, 100.0), 0.0);
    }

    #[test]
    fn reads_the_touch_mark_and_fresh_premium_on_each_leg() {
        let mut cluster = make_cluster(102.0, 100.5);
        write_anchor(&mut cluster, SELL, 100.0, 101.0); // the venue has accepted one percent, and the bid sits another percent over that
        write_anchor(&mut cluster, BUY, 100.0, 100.5); // the venue has accepted the half percent its ask sits at, so nothing there is fresh

        let pair = read(&cluster, net_ppm(102.0, 100.5)).unwrap();

        assert_eq!(pair.sell.touch, 102.0);
        assert_close(pair.sell.touch_premium, 0.02, 12);
        assert_close(pair.sell.mark_premium, 0.01, 12);
        assert_close(pair.sell.fresh_premium, 102.0 / 101.0 - 1.0, 12);
        assert_eq!(pair.buy.touch, 100.5);
        assert_close(pair.buy.touch_premium, 0.005, 12);
        assert_close(pair.buy.mark_premium, 0.005, 12);
        assert_eq!(pair.buy.fresh_premium, 0.0);
    }

    // The sell venue quotes ten times the buy venue's unit, its mark sits one percent over its index and its bid 0.9 percent over the mark.
    // The buy venue's mark sits one percent under its index and its ask one percent over the mark.
    #[test]
    fn factors_the_cross_into_the_index_gap_the_carried_premium_and_the_fresh_edge() {
        let mut cluster = make_cluster(1070.0, 100.0);
        cluster.bid_mul[SELL] = 0.1 * 0.99945; // a multiplier that carries a tenth besides the fee
        cluster.ask_mul[BUY] = 1.0005;
        write_anchor(&mut cluster, SELL, 1050.0, 1060.5);
        write_anchor(&mut cluster, BUY, 100.0, 99.0);
        let net =
            (1070.0 * cluster.bid_mul[SELL] / (100.0 * cluster.ask_mul[BUY]) - 1.0) * 1_000_000.0;

        let pair = read(&cluster, net).unwrap();

        assert_close(pair.index_gap_ppm, 50_000.0, 6);
        assert_close(pair.carried_ppm, (1.01 / 0.99 - 1.0) * 1_000_000.0, 6);
        let fresh = ((1070.0 / 1060.5) * 0.99945 / ((100.0 / 99.0) * 1.0005) - 1.0) * 1_000_000.0;
        assert_close(pair.fresh_net_ppm, fresh, 6);
        assert_close(pair.standing_ppm, net - fresh, 6);
        assert_close(factors_product(&pair), 1.0 + net / 1_000_000.0, 9);
    }
}
