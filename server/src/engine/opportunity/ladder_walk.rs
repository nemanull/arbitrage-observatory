use super::EdgeSample;
use crate::engine::cluster::Cluster;

pub fn walk_ladders(cluster: &Cluster, buy_index: usize, sell_index: usize) -> Option<EdgeSample> {
    let d = &cluster.depth;
    let ask_count = usize::from(d.ask_level_count[buy_index]);
    let bid_count = usize::from(d.bid_level_count[sell_index]);

    if ask_count == 0 || bid_count == 0 {
        return None;
    }

    let ask_base = buy_index * d.max_levels;
    let bid_base = sell_index * d.max_levels;
    let ask_mul = cluster.ask_mul[buy_index];
    let bid_mul = cluster.bid_mul[sell_index];
    let ask_size_mul = cluster.size_mul[buy_index];
    let bid_size_mul = cluster.size_mul[sell_index];

    let mut i = 0;
    let mut j = 0;
    let mut ask_left = d.ask_size[ask_base] * ask_size_mul;
    let mut bid_left = d.bid_size[bid_base] * bid_size_mul;
    let mut ask_taken = false;
    let mut bid_taken = false;
    let mut cost = 0.0;
    let mut proceeds = 0.0;
    let mut size = 0.0;
    let mut buy_levels = 0;
    let mut sell_levels = 0;
    let mut stopped_by_price = false;

    while i < ask_count && j < bid_count {
        let ask_px = d.ask_price[ask_base + i] * ask_mul;
        let bid_px = d.bid_price[bid_base + j] * bid_mul;

        if ask_px >= bid_px {
            stopped_by_price = true;
            break;
        }

        let q = ask_left.min(bid_left);

        if q > 0.0 {
            cost += q * ask_px;
            proceeds += q * bid_px;
            size += q;
            ask_left -= q;
            bid_left -= q;

            if !ask_taken {
                ask_taken = true;
                buy_levels += 1;
            }

            if !bid_taken {
                bid_taken = true;
                sell_levels += 1;
            }
        }

        if ask_left <= 0.0 {
            i += 1;
            ask_taken = false;
            if i < ask_count {
                ask_left = d.ask_size[ask_base + i] * ask_size_mul;
            }
        }

        if bid_left <= 0.0 {
            j += 1;
            bid_taken = false;
            if j < bid_count {
                bid_left = d.bid_size[bid_base + j] * bid_size_mul;
            }
        }
    }

    Some(EdgeSample {
        avg_ppm: if size > 0.0 {
            (proceeds / cost - 1.0) * 1_000_000.0
        } else {
            0.0
        },
        size,
        notional: cost,
        exhausted: !stopped_by_price && size > 0.0,
        buy_levels,
        sell_levels,
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::cluster::{ClusterAnchor, ClusterDepth, Market};

    const LEVELS: usize = 5;
    const BUY: usize = 0; // binance, we buy its asks
    const SELL: usize = 1; // bybit, we sell into its bids

    fn market(venue_id: &str, taker_ppm: u32, contract_size: f64) -> Market {
        Market {
            venue_id: venue_id.to_string(),
            raw_market_id: "BTCUSDT".to_string(),
            base: "BTC".to_string(),
            quote: "USDT".to_string(),
            taker_ppm,
            linear: true,
            contract_size,
        }
    }

    // Most examples pass a zero fee so the arithmetic can be checked by hand.
    fn make_cluster(taker_ppm: u32, contract_sizes: [f64; 2]) -> Cluster {
        let markets = [
            market("binance", taker_ppm, contract_sizes[0]),
            market("bybit", taker_ppm, contract_sizes[1]),
        ];
        let width = markets.len();

        Cluster {
            pair: "BTC|USDT".to_string(),
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
            depth: ClusterDepth::new(width, LEVELS).unwrap(),
            anchor: ClusterAnchor::new(width),
            markets: markets.into_iter().map(Some).collect(),
        }
    }

    fn set_asks(cluster: &mut Cluster, slot: usize, levels: &[(f64, f64)]) {
        let base = slot * LEVELS;
        for (l, &(price, size)) in levels.iter().enumerate() {
            cluster.depth.ask_price[base + l] = price;
            cluster.depth.ask_size[base + l] = size;
        }
        cluster.depth.ask_level_count[slot] = levels.len() as u8;
    }

    fn set_bids(cluster: &mut Cluster, slot: usize, levels: &[(f64, f64)]) {
        let base = slot * LEVELS;
        for (l, &(price, size)) in levels.iter().enumerate() {
            cluster.depth.bid_price[base + l] = price;
            cluster.depth.bid_size[base + l] = size;
        }
        cluster.depth.bid_level_count[slot] = levels.len() as u8;
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

    #[test]
    fn walks_both_ladders_from_the_touch_and_stops_where_the_marginal_edge_turns_negative() {
        let mut cluster = make_cluster(0, [1.0, 1.0]);
        set_asks(
            &mut cluster,
            BUY,
            &[(100.05, 2.0), (100.1, 4.0), (100.2, 5.0), (100.35, 3.0)],
        );
        set_bids(
            &mut cluster,
            SELL,
            &[(100.6, 1.0), (100.55, 3.0), (100.3, 6.0), (100.1, 2.0)],
        );

        let edge = walk_ladders(&cluster, BUY, SELL).unwrap();

        // Ten coins cross: 2 at 100.05, 4 at 100.10 and 4 of the 5 at 100.20 against 1 at 100.60, 3 at 100.55 and 6 at 100.30.
        // The fifth coin at 100.20 would sell at 100.10, so the walk stops there with a level left on each side.
        assert_close(edge.size, 10.0, 9);
        assert_close(edge.notional, 1_001.3, 6);
        assert_close(edge.avg_ppm, (1_004.05 / 1_001.3 - 1.0) * 1_000_000.0, 3);
        assert!(!edge.exhausted);
        assert_eq!(edge.buy_levels, 3);
        assert_eq!(edge.sell_levels, 3);
    }

    #[test]
    fn reports_a_region_bounded_by_the_held_depth_as_exhausted() {
        let mut cluster = make_cluster(0, [1.0, 1.0]);
        set_asks(&mut cluster, BUY, &[(100.0, 1.0)]);
        set_bids(&mut cluster, SELL, &[(101.0, 5.0), (100.9, 5.0)]);

        let edge = walk_ladders(&cluster, BUY, SELL).unwrap();

        assert_eq!(edge.size, 1.0);
        assert!(edge.exhausted);
        assert_eq!(edge.buy_levels, 1);
        assert_eq!(edge.sell_levels, 1);
    }

    #[test]
    fn returns_none_when_a_leg_holds_no_depth_at_all() {
        let mut cluster = make_cluster(0, [1.0, 1.0]);
        set_asks(&mut cluster, BUY, &[(100.0, 1.0)]);

        assert!(walk_ladders(&cluster, BUY, SELL).is_none());

        set_bids(&mut cluster, SELL, &[(101.0, 1.0)]);
        cluster.depth.ask_level_count[BUY] = 0;

        assert!(walk_ladders(&cluster, BUY, SELL).is_none());
    }

    #[test]
    fn returns_an_empty_region_when_the_tops_do_not_cross() {
        let mut cluster = make_cluster(0, [1.0, 1.0]);
        set_asks(&mut cluster, BUY, &[(100.0, 1.0)]);
        set_bids(&mut cluster, SELL, &[(99.9, 1.0)]);

        let edge = walk_ladders(&cluster, BUY, SELL).unwrap();

        assert_eq!(edge.size, 0.0);
        assert_eq!(edge.avg_ppm, 0.0);
        assert_eq!(edge.notional, 0.0);
        assert!(!edge.exhausted);
    }

    #[test]
    fn applies_the_taker_fee_to_both_legs_which_can_end_the_region_early() {
        // Without fees the whole ladder crosses. With 55 bp each side the second level pair no longer does.
        let mut cluster = make_cluster(5_500, [1.0, 1.0]);
        set_asks(&mut cluster, BUY, &[(100.0, 1.0), (100.5, 1.0)]);
        set_bids(&mut cluster, SELL, &[(102.0, 1.0), (101.5, 1.0)]);

        let edge = walk_ladders(&cluster, BUY, SELL).unwrap();

        assert_eq!(edge.size, 1.0);
        assert_close(edge.notional, 100.55, 9);
        assert_close(
            edge.avg_ppm,
            (102.0 * 0.9945 / (100.0 * 1.0055) - 1.0) * 1_000_000.0,
            6,
        );
        assert!(!edge.exhausted);
    }

    #[test]
    fn brings_contract_sizes_to_coins_through_size_mul_before_matching_quantities() {
        // The buy venue counts contracts of a hundredth of a coin, so 300 contracts is 3 coins.
        let mut cluster = make_cluster(0, [0.01, 1.0]);
        set_asks(&mut cluster, BUY, &[(100.0, 300.0)]);
        set_bids(&mut cluster, SELL, &[(101.0, 5.0)]);

        let edge = walk_ladders(&cluster, BUY, SELL).unwrap();

        assert_close(edge.size, 3.0, 9);
        assert_close(edge.notional, 300.0, 9);
        assert!(edge.exhausted);
    }

    #[test]
    fn passes_over_a_zero_size_level_without_counting_it() {
        let mut cluster = make_cluster(0, [1.0, 1.0]);
        set_asks(&mut cluster, BUY, &[(100.0, 0.0), (100.1, 2.0)]);
        set_bids(&mut cluster, SELL, &[(101.0, 2.0)]);

        let edge = walk_ladders(&cluster, BUY, SELL).unwrap();

        assert_eq!(edge.size, 2.0);
        assert_close(edge.notional, 200.2, 9);
        assert_eq!(edge.buy_levels, 1);
    }
}
