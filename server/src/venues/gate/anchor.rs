use super::Gate;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::time::Duration;

// One call returns index, mark, rate, interval and next settlement for every USDT contract.
// The reply holds every contract only while the URL carries no limit, since limit=100 returns 100 rows.
pub const CONTRACTS_PATH: &str = "/api/v4/futures/usdt/contracts";

const SECONDS_PER_HOUR: f64 = 3_600.0;

impl AnchorVenue for Gate {
    // Gate counts 200 requests per endpoint per 10 s and sends no Retry-After, so a pause of one window is enough.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let contracts: Vec<Contract> = get_json(http, &format!("{}{CONTRACTS_PATH}", self.rest)).await?;
        let mut rows = AnchorMap::with_capacity(contracts.len());

        for contract in contracts {
            // A pre market contract has no index basket to anchor it.
            if contract.is_pre_market || contract.status != "trading" {
                continue;
            }

            rows.insert(
                contract.name,
                AnchorRow {
                    index: contract.index_price,
                    mark: contract.mark_price,
                    funding_rate: contract.funding_rate,
                    funding_interval_hours: contract.funding_interval / SECONDS_PER_HOUR,
                    next_funding_at: (contract.funding_next_apply * 1_000.0) as i64,
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

#[derive(Deserialize)]
struct Contract {
    #[serde(default)]
    name: String, // "BTC_USDT", the socket's id
    #[serde(default)]
    status: String, // "trading", "prelaunch", "delisting", "delisted" or "circuit_breaker"
    #[serde(default)]
    is_pre_market: bool, // true on a contract with no index basket, such as OPENAI_USDT
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // a fraction per interval, not per 8 h
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_interval: f64, // seconds: 28800, 14400 or 3600
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_next_apply: f64, // Unix seconds
}

#[cfg(test)]
mod tests {
    // Ported case for case from old_ts_server/src/venues/gate/anchor.spec.ts.

    use super::*;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    const T0: i64 = 1_789_505_584_421;

    // Rows captured live on 2026-09-15, cut down to the fields the poller reads plus a few it ignores.
    fn btc_contract() -> Value {
        json!({
            "name": "BTC_USDT", "type": "direct", "quanto_multiplier": "0.0001", "status": "trading",
            "is_pre_market": false, "in_delisting": false, "index_price": "75937.25", "mark_price": "75913.6",
            "last_price": "75913.5", "funding_rate": "0.000014", "funding_interval": 28800,
            "funding_next_apply": 1789516800, "maker_fee_rate": "-0.0001", "taker_fee_rate": "0.00075",
        })
    }

    fn iost_contract() -> Value {
        json!({
            "name": "IOST_USDT", "status": "trading", "is_pre_market": false, "index_price": "0.000741",
            "mark_price": "0.000738", "funding_rate": "-0.000161", "funding_interval": 3600, "funding_next_apply": 1789506000,
        })
    }

    fn anduril_pre_market() -> Value {
        json!({
            "name": "ANDURIL_USDT", "status": "trading", "is_pre_market": true, "index_price": "125.49",
            "mark_price": "125.49", "funding_rate": "0", "funding_interval": 28800, "funding_next_apply": 1789516800,
        })
    }

    // Every contract read trading on 2026-09-15, so this row is the BTC capture with a documented non trading status.
    fn delisting_contract() -> Value {
        let mut row = btc_contract();
        row["name"] = json!("OLD_USDT");
        row["status"] = json!("delisting");
        row
    }

    async fn poll(rest: &MockRest) -> AnchorMap {
        Gate::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap()
    }

    #[test]
    fn polls_every_second_and_pauses_for_one_ten_second_window_on_a_rate_limit() {
        let venue = Gate::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(10));
    }

    #[tokio::test]
    async fn maps_a_trading_contract_with_its_interval_in_hours_and_next_settlement_in_ms() {
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, json!([btc_contract(), iost_contract()]));

        let rows = poll(&rest).await;

        assert_eq!(rest.calls(), [CONTRACTS_PATH]);
        assert_eq!(
            rows["BTC_USDT"],
            AnchorRow {
                index: 75937.25,
                mark: 75913.6,
                funding_rate: 0.000014,
                funding_interval_hours: 8.0,
                next_funding_at: 1789516800000,
                ts: None,
            }
        );
        assert_eq!(rows["IOST_USDT"].funding_interval_hours, 1.0);
        assert_eq!(rows["IOST_USDT"].next_funding_at, 1789506000000);
    }

    #[tokio::test]
    async fn leaves_out_a_pre_market_contract_and_a_contract_that_is_not_trading() {
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, json!([anduril_pre_market(), delisting_contract(), btc_contract()]));

        let rows = poll(&rest).await;

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTC_USDT"]);
    }
}
