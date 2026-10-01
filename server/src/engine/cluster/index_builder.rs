use super::quote_family::{cluster_quote, market_rank};
use super::{
    Cluster, ClusterAnchor, ClusterByRawMarketId, ClusterDepth, ClusterIndex, Market, PairKey,
    Venue, VenueIndexMap,
};
use ::std::collections::BTreeMap;

pub const DEPTH_LEVEL: usize = 20;

impl ClusterIndex {
    pub fn build_index(venues: &[Venue]) -> anyhow::Result<ClusterIndex> {
        if venues.len() < 2 {
            anyhow::bail!("at least 2 venues are required, got {}", venues.len());
        }

        let venue_index_map = VenueIndexMap::new(venues);
        let pair_markets = Self::get_pair_markets(venues)?;
        let clusters = Self::create_clusters(&pair_markets, &venue_index_map, venues.len());

        if clusters.is_empty() {
            anyhow::bail!("no clusters could be built, check venue market ingestion");
        }

        let cluster_by_raw_market_id = ClusterByRawMarketId::new(&clusters);

        tracing::info!(
            clusters = clusters.len(),
            venues = venues.len(),
            "built cluster index"
        );
        Ok(ClusterIndex {
            clusters,
            cluster_by_raw_market_id,
            venue_index_map,
        })
    }

    pub fn create_cluster(
        pair: &PairKey,
        markets: &Vec<Market>,
        venue_index_map: &VenueIndexMap,
        width: usize,
    ) -> Option<Cluster> {
        if markets.is_empty() {
            tracing::error!(%pair, "an empty array of markets was provided to create a cluster");
            return None;
        }

        let mut market_count: usize = 0;

        let mut slots: Vec<Option<Market>> = vec![None; width];
        let mut bid_mul: Vec<f64> = vec![0.0; width];
        let mut ask_mul: Vec<f64> = vec![0.0; width];
        let mut size_mul: Vec<f64> = vec![0.0; width];
        let bid: Vec<f64> = vec![0.0; width];
        let ask: Vec<f64> = vec![0.0; width];
        let bid_size: Vec<f64> = vec![0.0; width];
        let ask_size: Vec<f64> = vec![0.0; width];
        let recv_ts: Vec<i64> = vec![0; width];

        for market in markets {
            let Some(market_index) = venue_index_map.get(&market.venue_id) else {
                tracing::error!(%pair, venue = %market.venue_id, "venue not found in venue_index_map, cluster creation failed");
                return None;
            };

            if slots[market_index].is_some() {
                tracing::warn!(%pair, venue = %market.venue_id, "market already exists at index {market_index}, skipping");
                continue;
            }

            slots[market_index] = Some(market.clone());

            // The scale turns the venue's price into everyone else's, so a contract counts for that many fewer of their units.
            bid_mul[market_index] = (1.0 - f64::from(market.taker_ppm) / 1_000_000.0) * market.price_scale;
            ask_mul[market_index] = (1.0 + f64::from(market.taker_ppm) / 1_000_000.0) * market.price_scale;
            size_mul[market_index] = market.contract_size / market.price_scale;

            market_count += 1;
        }

        // Counted after the loop, because a skipped duplicate does not fill a slot
        if market_count < 2 {
            tracing::info!(%pair, market_count, "a pair must have at least 2 markets for a cluster to be created");
            return None;
        }

        let depth = match ClusterDepth::new(width, DEPTH_LEVEL) {
            Ok(depth) => depth,
            Err(e) => {
                tracing::error!(%pair, "{e:#}");
                return None;
            }
        };

        let c: Cluster = {
            Cluster {
                pair: pair.clone(),
                markets: slots.into_boxed_slice(),
                bid_mul: bid_mul.into_boxed_slice(),
                ask_mul: ask_mul.into_boxed_slice(),
                size_mul: size_mul.into_boxed_slice(),
                bid: bid.into_boxed_slice(),
                ask: ask.into_boxed_slice(),
                bid_size: bid_size.into_boxed_slice(),
                ask_size: ask_size.into_boxed_slice(),
                recv_ts: recv_ts.into_boxed_slice(),
                depth,
                anchor: ClusterAnchor::new(width),
            }
        };
        Some(c)
    }

    // A BTreeMap iterates in key order, so a pair gets the same ClusterId on every boot.
    // A HashMap's order is random per process.
    pub fn get_pair_markets(venues: &[Venue]) -> anyhow::Result<BTreeMap<PairKey, Vec<Market>>> {
        let mut pairs: BTreeMap<PairKey, Vec<Market>> = BTreeMap::new();

        for venue in venues {
            for market in &venue.markets {
                if market.venue_id != venue.id {
                    tracing::error!(venue = %venue.id, market = %market.raw_market_id, claimed = %market.venue_id, "market claims another venue, skipping");
                    continue;
                }
                if market.base.is_empty()
                    || market.quote.is_empty()
                    || market.base.contains('|')
                    || market.quote.contains('|')
                {
                    tracing::error!(venue = %venue.id, market = %market.raw_market_id, base = %market.base, quote = %market.quote, "market has an invalid symbol, skipping");
                    continue;
                }

                let pair = format!("{}|{}", market.base, cluster_quote(&market.quote));

                let Some(markets) = pairs.get_mut(&pair) else {
                    pairs.insert(pair, vec![market.clone()]);
                    continue;
                };

                let Some(twin) = markets.iter_mut().find(|m| m.venue_id == market.venue_id) else {
                    markets.push(market.clone());
                    continue;
                };

                let replace = market_rank(market) < market_rank(twin);
                let (kept, dropped) = if replace {
                    (market, &*twin)
                } else {
                    (&*twin, market)
                };
                tracing::debug!(%pair, venue = %venue.id, kept = %kept.raw_market_id, dropped = %dropped.raw_market_id, "venue lists twin markets for one pair");

                if replace {
                    *twin = market.clone();
                }
            }
        }

        if pairs.is_empty() {
            anyhow::bail!("no valid pairs across any venue, check venue market ingestion");
        }

        tracing::info!(
            pairs = pairs.len(),
            venues = venues.len(),
            "grouped markets into pairs"
        );
        Ok(pairs)
    }

    pub fn create_clusters(
        pair_markets: &BTreeMap<PairKey, Vec<Market>>,
        venue_index_map: &VenueIndexMap,
        width: usize,
    ) -> Vec<Cluster> {
        let mut clusters: Vec<Cluster> = Vec::with_capacity(pair_markets.len());

        for (pair, markets) in pair_markets {
            if let Some(cluster) = Self::create_cluster(pair, markets, venue_index_map, width) {
                clusters.push(cluster);
            }
        }

        tracing::info!(
            clusters = clusters.len(),
            pairs = pair_markets.len(),
            "built clusters"
        );

        clusters
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn market(
        venue_id: &str,
        raw_market_id: &str,
        base: &str,
        quote: &str,
        linear: bool,
    ) -> Market {
        Market {
            venue_id: venue_id.to_string(),
            raw_market_id: raw_market_id.to_string(),
            base: base.to_string(),
            quote: quote.to_string(),
            taker_ppm: 500,
            linear,
            contract_size: 1.0,
            price_scale: 1.0,
        }
    }

    fn venue(id: &str, markets: Vec<Market>) -> Venue {
        Venue {
            id: id.to_string(),
            name: id.to_string(),
            markets,
        }
    }

    fn raw_ids(pairs: &BTreeMap<PairKey, Vec<Market>>, pair: &str) -> Vec<String> {
        pairs[pair]
            .iter()
            .map(|m| m.raw_market_id.clone())
            .collect()
    }

    #[test]
    fn groups_usd_usdc_and_usdt_markets_of_one_coin_under_the_usdt_key() {
        let pairs = ClusterIndex::get_pair_markets(&[
            venue(
                "binance",
                vec![market("binance", "BTCUSDT", "BTC", "USDT", true)],
            ),
            venue(
                "krakenfutures",
                vec![market("krakenfutures", "PF_XBTUSD", "BTC", "USD", true)],
            ),
            venue(
                "coinbase",
                vec![market("coinbase", "BTC-PERP-INTX", "BTC", "USDC", true)],
            ),
        ])
        .unwrap();

        assert_eq!(pairs.keys().collect::<Vec<_>>(), ["BTC|USDT"]);
        assert_eq!(
            raw_ids(&pairs, "BTC|USDT"),
            ["BTCUSDT", "PF_XBTUSD", "BTC-PERP-INTX"]
        );
    }

    #[test]
    fn keeps_the_usdt_linear_contract_when_a_venue_lists_twins_whatever_the_listing_order() {
        let pairs = ClusterIndex::get_pair_markets(&[
            venue(
                "binance",
                vec![
                    market("binance", "BTCUSD_PERP", "BTC", "USD", false),
                    market("binance", "BTCUSDC", "BTC", "USDC", true),
                    market("binance", "BTCUSDT", "BTC", "USDT", true),
                ],
            ),
            venue(
                "bybit",
                vec![
                    market("bybit", "BTCUSDT", "BTC", "USDT", true),
                    market("bybit", "BTCPERP", "BTC", "USDC", true),
                    market("bybit", "BTCUSD", "BTC", "USD", false),
                ],
            ),
        ])
        .unwrap();

        assert_eq!(raw_ids(&pairs, "BTC|USDT"), ["BTCUSDT", "BTCUSDT"]);
    }

    #[test]
    fn keeps_a_usdc_or_inverse_contract_where_a_venue_has_nothing_better() {
        let pairs = ClusterIndex::get_pair_markets(&[
            venue(
                "binance",
                vec![market("binance", "ETHUSDC", "ETH", "USDC", true)],
            ),
            venue(
                "bybit",
                vec![market("bybit", "ETHUSD", "ETH", "USD", false)],
            ),
        ])
        .unwrap();

        assert_eq!(raw_ids(&pairs, "ETH|USDT"), ["ETHUSDC", "ETHUSD"]);
    }

    #[test]
    fn leaves_a_non_dollar_quote_under_its_own_key() {
        let pairs = ClusterIndex::get_pair_markets(&[
            venue(
                "binance",
                vec![
                    market("binance", "ETHBTC", "ETH", "BTC", true),
                    market("binance", "ETHUSDT", "ETH", "USDT", true),
                ],
            ),
            venue(
                "bybit",
                vec![market("bybit", "ETHUSDT", "ETH", "USDT", true)],
            ),
        ])
        .unwrap();

        assert_eq!(pairs.keys().collect::<Vec<_>>(), ["ETH|BTC", "ETH|USDT"]);
        assert_eq!(raw_ids(&pairs, "ETH|USDT"), ["ETHUSDT", "ETHUSDT"]);
    }

    #[test]
    fn maps_each_clustered_market_to_a_cluster_id_in_pair_order() {
        let index = ClusterIndex::build_index(&[
            venue(
                "binance",
                vec![
                    market("binance", "ETHUSDT", "ETH", "USDT", true),
                    market("binance", "BTCUSDC", "BTC", "USDC", true),
                    market("binance", "BTCUSDT", "BTC", "USDT", true),
                    market("binance", "SOLUSDT", "SOL", "USDT", true),
                ],
            ),
            venue(
                "bybit",
                vec![
                    market("bybit", "ETHUSDT", "ETH", "USDT", true),
                    market("bybit", "BTCUSDT", "BTC", "USDT", true),
                ],
            ),
        ])
        .unwrap();

        let pairs: Vec<&str> = index.clusters.iter().map(|c| c.pair.as_str()).collect();
        assert_eq!(pairs, ["BTC|USDT", "ETH|USDT"]);

        let ids = &index.cluster_by_raw_market_id;
        assert_eq!(ids.get("binance", "BTCUSDT"), Some(0));
        assert_eq!(ids.get("bybit", "BTCUSDT"), Some(0));
        assert_eq!(ids.get("binance", "ETHUSDT"), Some(1));
        assert_eq!(ids.get("bybit", "ETHUSDT"), Some(1));
        assert_eq!(ids.get("binance", "SOLUSDT"), None); // one venue, no cluster
        assert_eq!(ids.get("binance", "BTCUSDC"), None); // lost to the USDT twin
        assert_eq!(ids.get("okx", "BTCUSDT"), None);
    }

    #[test]
    fn a_price_scale_multiplies_both_price_multipliers_and_divides_the_size_multiplier() {
        let scaled = Market {
            contract_size: 2.0,
            price_scale: 10.0,
            ..market("okx", "ANTHROPIC-USDT-SWAP", "ANTHROPIC", "USDT", true)
        };
        let index = ClusterIndex::build_index(&[
            venue("binance", vec![market("binance", "ANTHROPICUSDT", "ANTHROPIC", "USDT", true)]),
            venue("okx", vec![scaled]),
        ])
        .unwrap();

        let keeps = 1.0 - 500.0 / 1_000_000.0;
        let pays = 1.0 + 500.0 / 1_000_000.0;
        let cluster = &index.clusters[0];
        assert_eq!(cluster.bid_mul[0], keeps);
        assert_eq!(cluster.ask_mul[0], pays);
        assert_eq!(cluster.size_mul[0], 1.0);
        assert_eq!(cluster.bid_mul[1], keeps * 10.0);
        assert_eq!(cluster.ask_mul[1], pays * 10.0);
        assert_eq!(cluster.size_mul[1], 0.2);
    }
}
