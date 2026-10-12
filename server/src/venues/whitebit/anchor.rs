use super::markets::{MARKETS_PATH, Row};
use super::{ID, Whitebit};
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::{HashSet, VecDeque};
use std::hash::{DefaultHasher, Hash, Hasher};
use std::time::Duration;

// One call returns index, mark, rate, interval and next settlement for every perpetual, keyed by the socket's id.
pub const FUTURES_PATH: &str = "/api/v4/public/futures";

// A TradFi perpetual's index is mostly its own last trade and its mark is that index, so its rows are left out.
// /futures does not say which contracts are TradFi, and listings change, so the catalog is reread every hour.
const TRADFI_TYPE: &str = "tradfiFutures";
const CATALOG_REFRESH_MS: i64 = 60 * 60 * 1000;
const CATALOG_RETRY_MS: i64 = 60 * 1000;

// The reply is cached for 1 s, and its index and mark columns change together in generations about 5 s apart.
// A reply can carry the generation before the latest one, as 1 of 60 polls did on 2026-10-08, which reads as a move and its reversal.
// So a reply whose generation was superseded gives way to the latest generation, stamped with the last round that saw it.
// A contract can return to its earlier prices inside a new generation, and that is taken as it comes.
const OLDER_GENERATIONS: usize = 3;
const STALE_GENERATION_MS: i64 = 10_000; // a superseded generation that comes back later than this is taken as new

const MINUTES_PER_HOUR: f64 = 60.0;

#[derive(Default)]
pub struct AnchorState {
    tradfi: HashSet<String>,
    catalog_read_at: i64, // Unix ms, 0 = never, so the first round reads the catalog
    latest: Option<Generation>,
    older: VecDeque<(u64, i64)>, // (signature, superseded at), newest first
}

struct Generation {
    signature: u64, // a hash of every contract's index and mark in the reply
    rows: AnchorMap,
    seen: i64, // the last round that saw it
}

impl AnchorVenue for Whitebit {
    // The windows are 10 s and no Retry-After is documented.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let read_at = self.anchors.lock().unwrap().catalog_read_at;

        if ts - read_at >= CATALOG_REFRESH_MS {
            match get_json::<Vec<Row>>(http, &format!("{}{MARKETS_PATH}", self.rest)).await {
                Ok(rows) => {
                    let mut tradfi = HashSet::new();
                    for row in rows {
                        if row.kind == TRADFI_TYPE {
                            tradfi.insert(row.name);
                        }
                    }
                    tracing::info!(event = "tradfi_catalog_read", venue = ID, tradfi = tradfi.len());
                    let mut state = self.anchors.lock().unwrap();
                    state.tradfi = tradfi;
                    state.catalog_read_at = ts;
                }
                // Without a first read the TradFi rows cannot be told apart, so the round fails and the next one tries again.
                Err(error) if read_at == 0 => return Err(error),
                // A failed refresh keeps the set it has and tries again a minute later.
                Err(error) => {
                    tracing::warn!(event = "tradfi_catalog_failed", venue = ID, error = format!("{error:#}"));
                    self.anchors.lock().unwrap().catalog_read_at = ts - CATALOG_REFRESH_MS + CATALOG_RETRY_MS;
                }
            }
        }

        let reply: Reply = get_json(http, &format!("{}{FUTURES_PATH}", self.rest)).await?;
        if !reply.success {
            anyhow::bail!("futures answered success false: {}", reply.message.unwrap_or_default());
        }

        let mut state = self.anchors.lock().unwrap();
        let mut hasher = DefaultHasher::new();
        let mut rows = AnchorMap::with_capacity(reply.result.len());

        for contract in reply.result {
            contract.ticker_id.hash(&mut hasher);
            contract.index_price.to_bits().hash(&mut hasher);
            contract.mark_price.to_bits().hash(&mut hasher);

            if state.tradfi.contains(&contract.ticker_id) {
                continue;
            }

            // The documented placeholders: an index of "0" when no index or trade exists, and an empty mark while no fresh snapshot exists.
            if !(contract.index_price > 0.0) || !(contract.mark_price > 0.0) {
                continue;
            }

            rows.insert(
                contract.ticker_id,
                AnchorRow {
                    index: contract.index_price,
                    mark: contract.mark_price,
                    funding_rate: contract.funding_rate,
                    funding_interval_hours: contract.funding_interval_minutes / MINUTES_PER_HOUR,
                    next_funding_at: contract.next_funding_rate_timestamp as i64,
                    ts: None,
                },
            );
        }

        Ok(state.settle(hasher.finish(), rows, ts))
    }
}

impl AnchorState {
    // The reply's rows, or the latest generation's rows when the reply carries a superseded generation.
    fn settle(&mut self, signature: u64, rows: AnchorMap, ts: i64) -> AnchorMap {
        if let Some(latest) = &mut self.latest {
            if latest.signature == signature {
                latest.seen = ts;
                return rows;
            }

            let superseded = self.older.iter().find(|&&(older, at)| older == signature && ts - at < STALE_GENERATION_MS);
            if let Some(&(_, superseded_at)) = superseded {
                tracing::info!(
                    event = "anchor_stale_reply",
                    venue = ID,
                    superseded_ms = ts - superseded_at,
                    latest_seen_ms = ts - latest.seen,
                );
                let mut held = latest.rows.clone();
                for row in held.values_mut() {
                    row.ts = Some(latest.seen);
                }
                return held;
            }
        }

        if let Some(previous) = self.latest.take() {
            self.older.push_front((previous.signature, ts));
            self.older.truncate(OLDER_GENERATIONS);
        }
        self.latest = Some(Generation { signature, rows: rows.clone(), seen: ts });
        rows
    }
}

#[derive(Deserialize)]
struct Reply {
    #[serde(default)]
    success: bool,
    message: Option<String>,
    #[serde(default)]
    result: Vec<Contract>,
}

#[derive(Deserialize)]
struct Contract {
    #[serde(default)]
    ticker_id: String, // "BTC_PERP"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // a fraction per interval, predicted for the next settlement
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_interval_minutes: f64, // 60, 240 or 480
    #[serde(default, deserialize_with = "wire::num")]
    next_funding_rate_timestamp: f64, // Unix ms as a string
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    const T0: i64 = 1_791_475_200_000;

    // Rows captured live on 2026-10-08, cut down to the fields the poller reads plus a few it ignores.
    fn btc_contract() -> Value {
        json!({
            "ticker_id": "BTC_PERP", "stock_currency": "BTC", "money_currency": "USDT", "last_price": "81966.8",
            "product_type": "Perpetual", "mark_price": "81966.8", "index_price": "82012", "index_name": "Bitcoin",
            "funding_rate": "0.00002328", "funding_cap": "0.00375", "funding_floor": "-0.00375",
            "next_funding_rate_timestamp": "1791532800000", "max_leverage": 100, "funding_interval_minutes": 480,
        })
    }

    fn og_contract() -> Value {
        json!({
            "ticker_id": "0G_PERP", "last_price": "0.2797", "mark_price": "0.28", "index_price": "0.2805",
            "index_name": "0G future contract", "funding_rate": "0.00005", "next_funding_rate_timestamp": "1791518400000",
            "funding_interval_minutes": 240,
        })
    }

    fn aapl_contract() -> Value {
        json!({
            "ticker_id": "AAPL_PERP", "last_price": "340.65", "mark_price": "340.65", "index_price": "340.65",
            "index_name": "Apple Inc. stock price future contract", "funding_rate": "-0.0001",
            "next_funding_rate_timestamp": "1791532800000", "funding_interval_minutes": 480,
        })
    }

    fn markets() -> Value {
        json!([
            { "name": "BTC_PERP", "stock": "BTC", "money": "USDT", "type": "futures", "tradesEnabled": true },
            { "name": "AAPL_PERP", "stock": "AAPL", "money": "USDT", "type": "tradfiFutures", "tradesEnabled": true },
            { "name": "BTC_USDT", "stock": "BTC", "money": "USDT", "type": "spot", "tradesEnabled": true },
        ])
    }

    fn futures(contracts: Vec<Value>) -> Value {
        json!({ "success": true, "message": null, "result": contracts })
    }

    fn with_prices(mut contract: Value, index: &str, mark: &str) -> Value {
        contract["index_price"] = json!(index);
        contract["mark_price"] = json!(mark);
        contract
    }

    async fn host(contracts: Vec<Value>) -> MockRest {
        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, markets());
        rest.reply(FUTURES_PATH, futures(contracts));
        rest
    }

    #[test]
    fn polls_every_second_and_pauses_for_one_ten_second_window_on_a_rate_limit() {
        let venue = Whitebit::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(10));
    }

    #[tokio::test]
    async fn maps_a_contract_with_its_interval_in_hours_and_next_settlement_in_ms() {
        let rest = host(vec![btc_contract(), og_contract()]).await;

        let rows = Whitebit::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(
            rows["BTC_PERP"],
            AnchorRow {
                index: 82012.0,
                mark: 81966.8,
                funding_rate: 0.00002328,
                funding_interval_hours: 8.0,
                next_funding_at: 1791532800000,
                ts: None,
            }
        );
        assert_eq!(rows["0G_PERP"].funding_interval_hours, 4.0);
        assert_eq!(rows["0G_PERP"].next_funding_at, 1791518400000);
    }

    // ARK_PERP settled hourly on 2026-10-08.
    #[tokio::test]
    async fn reads_an_hourly_interval_and_an_unknown_next_settlement_as_0() {
        let mut ark = og_contract();
        ark["ticker_id"] = json!("ARK_PERP");
        ark["funding_interval_minutes"] = json!(60);
        let mut btc = btc_contract();
        btc.as_object_mut().unwrap().remove("next_funding_rate_timestamp");
        let rest = host(vec![ark, btc]).await;

        let rows = Whitebit::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows["ARK_PERP"].funding_interval_hours, 1.0);
        assert_eq!(rows["BTC_PERP"].next_funding_at, 0);
    }

    #[tokio::test]
    async fn a_rate_limited_reply_surfaces_as_rate_limited() {
        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, markets());
        rest.fail(FUTURES_PATH, 429);

        let error = Whitebit::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.downcast_ref::<crate::feeds::anchor_poller::RateLimited>().is_some());
    }

    #[tokio::test]
    async fn leaves_out_a_tradfi_contract_whose_index_is_its_own_last_trade() {
        let rest = host(vec![aapl_contract(), btc_contract()]).await;

        let rows = Whitebit::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTC_PERP"]);
    }

    #[tokio::test]
    async fn leaves_out_a_zero_index_and_an_empty_mark() {
        let rest = host(vec![with_prices(btc_contract(), "0", "81966.8"), with_prices(og_contract(), "0.2805", "")]).await;

        let rows = Whitebit::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn reads_the_catalog_on_the_first_round_and_again_after_an_hour() {
        let rest = host(vec![btc_contract()]).await;
        let venue = Whitebit::with_rest(&rest.url);

        venue.fetch_round(&http(), T0).await.unwrap();
        venue.fetch_round(&http(), T0 + 1_000).await.unwrap();
        venue.fetch_round(&http(), T0 + CATALOG_REFRESH_MS).await.unwrap();

        assert_eq!(
            rest.calls(),
            [MARKETS_PATH, FUTURES_PATH, FUTURES_PATH, MARKETS_PATH, FUTURES_PATH]
        );
    }

    #[tokio::test]
    async fn a_failed_catalog_read_fails_the_round_and_is_tried_again() {
        let rest = MockRest::start().await;
        rest.fail(MARKETS_PATH, 503);
        rest.reply(FUTURES_PATH, futures(vec![btc_contract()]));
        let venue = Whitebit::with_rest(&rest.url);

        assert!(venue.fetch_round(&http(), T0).await.is_err());
        rest.reply(MARKETS_PATH, markets());
        assert!(venue.fetch_round(&http(), T0 + 1_000).await.is_ok());
        assert_eq!(rest.calls(), [MARKETS_PATH, MARKETS_PATH, FUTURES_PATH]);
    }

    #[tokio::test]
    async fn a_failed_refresh_keeps_the_tradfi_set_and_tries_again_a_minute_later() {
        let rest = host(vec![aapl_contract(), btc_contract()]).await;
        let venue = Whitebit::with_rest(&rest.url);
        venue.fetch_round(&http(), T0).await.unwrap();
        rest.fail(MARKETS_PATH, 503);

        let rows = venue.fetch_round(&http(), T0 + CATALOG_REFRESH_MS).await.unwrap();
        venue.fetch_round(&http(), T0 + CATALOG_REFRESH_MS + 1_000).await.unwrap();
        venue.fetch_round(&http(), T0 + CATALOG_REFRESH_MS + CATALOG_RETRY_MS).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTC_PERP"]);
        assert_eq!(
            rest.calls(),
            [MARKETS_PATH, FUTURES_PATH, MARKETS_PATH, FUTURES_PATH, FUTURES_PATH, MARKETS_PATH, FUTURES_PATH]
        );
    }

    #[tokio::test]
    async fn a_reply_with_success_false_fails_the_round() {
        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, markets());
        rest.reply(FUTURES_PATH, json!({ "success": false, "message": "Margin trading is not available in your country.", "result": [] }));

        let error = Whitebit::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.to_string().contains("not available in your country"));
    }

    fn eth_contract() -> Value {
        json!({
            "ticker_id": "ETH_PERP", "last_price": "2487.21", "mark_price": "2487.13", "index_price": "2485.41",
            "index_name": "Ethereum", "funding_rate": "0.0001", "next_funding_rate_timestamp": "1791532800000",
            "funding_interval_minutes": 480,
        })
    }

    fn generation(btc: (&str, &str), eth: (&str, &str)) -> Value {
        futures(vec![with_prices(btc_contract(), btc.0, btc.1), with_prices(eth_contract(), eth.0, eth.1)])
    }

    fn prices(rows: &AnchorMap, ticker_id: &str) -> (f64, f64, Option<i64>) {
        let row = rows[ticker_id];
        (row.index, row.mark, row.ts)
    }

    // The 60 polls of 2026-10-08 saw generation 32 again at poll 34, after generation 33.
    #[tokio::test]
    async fn answers_a_superseded_generation_with_the_latest_one_stamped_with_its_last_sighting() {
        let rest = host(vec![]).await;
        let venue = Whitebit::with_rest(&rest.url);
        let first = generation(("82012", "81966.8"), ("2485.41", "2487.13"));
        let second = generation(("82015.5", "81970.2"), ("2485.6", "2487.2"));

        rest.reply(FUTURES_PATH, first.clone());
        venue.fetch_round(&http(), T0).await.unwrap();
        rest.reply(FUTURES_PATH, second);
        venue.fetch_round(&http(), T0 + 2_000).await.unwrap();
        venue.fetch_round(&http(), T0 + 3_000).await.unwrap();
        rest.reply(FUTURES_PATH, first);
        let stale = venue.fetch_round(&http(), T0 + 4_000).await.unwrap();
        rest.reply(FUTURES_PATH, generation(("82020", "81975"), ("2486", "2487.5")));
        let third = venue.fetch_round(&http(), T0 + 5_000).await.unwrap();

        assert_eq!(prices(&stale, "BTC_PERP"), (82015.5, 81970.2, Some(T0 + 3_000)));
        assert_eq!(prices(&stale, "ETH_PERP"), (2485.6, 2487.2, Some(T0 + 3_000)));
        assert_eq!(prices(&third, "BTC_PERP"), (82020.0, 81975.0, None));
    }

    #[tokio::test]
    async fn passes_the_latest_generation_again_with_the_round_stamp() {
        let rest = host(vec![]).await;
        let venue = Whitebit::with_rest(&rest.url);

        rest.reply(FUTURES_PATH, generation(("82012", "81966.8"), ("2485.41", "2487.13")));
        venue.fetch_round(&http(), T0).await.unwrap();
        let again = venue.fetch_round(&http(), T0 + 1_000).await.unwrap();

        assert_eq!(prices(&again, "BTC_PERP"), (82012.0, 81966.8, None));
    }

    #[tokio::test]
    async fn takes_a_generation_older_than_the_ones_it_remembers_as_new() {
        let rest = host(vec![]).await;
        let venue = Whitebit::with_rest(&rest.url);
        let first = generation(("82000", "81950"), ("2485", "2487"));

        rest.reply(FUTURES_PATH, first.clone());
        venue.fetch_round(&http(), T0).await.unwrap();
        for step in 1..=OLDER_GENERATIONS as i64 + 1 {
            let btc = (82000 + step).to_string();
            rest.reply(FUTURES_PATH, generation((&btc, "81950"), ("2485", "2487")));
            venue.fetch_round(&http(), T0 + step * 1_000).await.unwrap();
        }
        rest.reply(FUTURES_PATH, first);
        let back = venue.fetch_round(&http(), T0 + 6_000).await.unwrap();

        assert_eq!(prices(&back, "BTC_PERP"), (82000.0, 81950.0, None));
    }

    #[tokio::test]
    async fn takes_a_superseded_generation_that_comes_back_after_the_window_as_new() {
        let rest = host(vec![]).await;
        let venue = Whitebit::with_rest(&rest.url);
        let first = generation(("82012", "81966.8"), ("2485.41", "2487.13"));

        rest.reply(FUTURES_PATH, first.clone());
        venue.fetch_round(&http(), T0).await.unwrap();
        rest.reply(FUTURES_PATH, generation(("82015.5", "81970.2"), ("2485.6", "2487.2")));
        venue.fetch_round(&http(), T0 + 1_000).await.unwrap();
        rest.reply(FUTURES_PATH, first);
        let back = venue.fetch_round(&http(), T0 + 1_000 + STALE_GENERATION_MS).await.unwrap();

        assert_eq!(prices(&back, "BTC_PERP"), (82012.0, 81966.8, None));
    }

    #[tokio::test]
    async fn takes_a_contract_that_returns_to_its_earlier_prices_in_a_new_generation_as_it_comes() {
        let rest = host(vec![]).await;
        let venue = Whitebit::with_rest(&rest.url);

        rest.reply(FUTURES_PATH, generation(("82012", "81966.8"), ("2485.41", "2487.13")));
        venue.fetch_round(&http(), T0).await.unwrap();
        rest.reply(FUTURES_PATH, generation(("82015.5", "81970.2"), ("2485.6", "2487.2")));
        venue.fetch_round(&http(), T0 + 1_000).await.unwrap();
        rest.reply(FUTURES_PATH, generation(("82012", "81966.8"), ("2486", "2487.5")));
        let rows = venue.fetch_round(&http(), T0 + 2_000).await.unwrap();

        assert_eq!(prices(&rows, "BTC_PERP"), (82012.0, 81966.8, None));
        assert_eq!(prices(&rows, "ETH_PERP"), (2486.0, 2487.5, None));
    }
}
