use super::Orderly;
use super::markets::{INFO_PATH, Reply as InfoReply, shared_and_active};
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;

// One call carries index, mark, the predicted rate and the next settlement for every market, and no interval.
pub const FUTURES_PATH: &str = "/v1/public/futures";

// The interval lives only in the catalog, and Orderly changes it only in extreme volatility or for a new listing.
const PERIODS_REFRESH_MS: i64 = 60 * 1000;

#[derive(Default)]
pub struct Periods {
    hours: HashMap<String, f64>, // symbol to funding_period
    read_at: i64,                // Unix ms, 0 = never, so the first round reads the table
}

impl AnchorVenue for Orderly {
    // Each public call allows 10 requests a second per IP, and a 429 carries code -1003 with no Retry-After seen.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(1)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let due = ts - self.periods.lock().unwrap().read_at >= PERIODS_REFRESH_MS;

        // A failure here fails the round and leaves read_at alone, so the next round tries again.
        if due {
            let reply: InfoReply = get_json(http, &format!("{}{INFO_PATH}", self.rest)).await?;
            if !reply.success {
                anyhow::bail!("{INFO_PATH} answered success false");
            }
            let mut hours = HashMap::with_capacity(reply.data.rows.len());
            for row in reply.data.rows {
                if let Some(period) = row.funding_period {
                    hours.insert(row.symbol, period);
                }
            }
            tracing::info!(event = "funding_periods_read", venue = self.profile.id, markets = hours.len());
            *self.periods.lock().unwrap() = Periods { hours, read_at: ts };
        }

        let reply: Reply = get_json(http, &format!("{}{FUTURES_PATH}", self.rest)).await?;
        if !reply.success {
            anyhow::bail!("{FUTURES_PATH} answered success false");
        }

        let periods = self.periods.lock().unwrap();
        let mut rows = AnchorMap::with_capacity(reply.data.rows.len());
        for row in reply.data.rows {
            if shared_and_active(&row.symbol, row.broker_id.as_deref(), &row.status).is_none() {
                continue;
            }
            // A market listed since the last catalog read has no interval yet, and its row waits for the next read.
            let Some(&funding_interval_hours) = periods.hours.get(&row.symbol) else {
                continue;
            };

            rows.insert(
                row.symbol,
                AnchorRow {
                    index: row.index_price,
                    mark: row.mark_price,
                    funding_rate: row.est_funding_rate,
                    funding_interval_hours,
                    next_funding_at: row.next_funding_time as i64,
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

#[derive(Deserialize)]
struct Reply {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    data: Rows,
}

#[derive(Deserialize, Default)]
struct Rows {
    #[serde(default)]
    rows: Vec<Row>,
}

#[derive(Deserialize)]
struct Row {
    #[serde(default)]
    symbol: String,
    broker_id: Option<String>,
    #[serde(default)]
    status: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64, // held inside a band around the index, mark_index_price_deviation_floor and _cap of the catalog
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    est_funding_rate: f64, // the predicted rate of the next settlement, a fraction per period
    #[serde(default, deserialize_with = "wire::num")]
    next_funding_time: f64, // Unix ms
}

#[cfg(test)]
mod tests {
    use super::super::{NIZA, Orderly};
    use super::*;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    const T0: i64 = 1_791_573_507_000;

    // Rows captured live on 2026-10-09, cut down to the fields the poller reads plus a few it ignores.
    fn btc_future() -> Value {
        json!({
            "symbol": "PERP_BTC_USDC", "display_symbol_name": "BTC", "broker_id": null, "status": "ACTIVE",
            "index_price": 82432.1, "mark_price": 82392.0, "sum_unitary_funding": 1234.5, "est_funding_rate": -6.518e-05,
            "last_funding_rate": 2.1e-05, "next_funding_time": 1791590400000_i64, "open_interest": 210.5, "is_pretge": false,
        })
    }

    fn bonk_future() -> Value {
        json!({
            "symbol": "PERP_1000BONK_USDC", "broker_id": null, "status": "ACTIVE", "index_price": 0.003333, "mark_price": 0.00333,
            "est_funding_rate": -0.00014385, "next_funding_time": 1791576000000_i64,
        })
    }

    fn builder_future() -> Value {
        json!({
            "symbol": "PERP_AAPL_USDC_mythos", "broker_id": "mythos", "status": "ACTIVE", "index_price": 255.1, "mark_price": 255.2,
            "est_funding_rate": 0.0001, "next_funding_time": 1791590400000_i64,
        })
    }

    fn info(rows: Value) -> Value {
        json!({ "success": true, "data": { "rows": rows }, "timestamp": T0 })
    }

    fn periods() -> Value {
        info(json!([
            { "symbol": "PERP_BTC_USDC", "broker_id": null, "funding_period": 8, "status": "ACTIVE" },
            { "symbol": "PERP_1000BONK_USDC", "broker_id": null, "funding_period": 4, "status": "ACTIVE" },
            { "symbol": "PERP_AAPL_USDC_mythos", "broker_id": "mythos", "funding_period": 8, "status": "ACTIVE" },
        ]))
    }

    fn futures(rows: Value) -> Value {
        json!({ "success": true, "data": { "rows": rows }, "timestamp": T0 })
    }

    fn venue(rest: &MockRest) -> Orderly {
        Orderly::with_rest(&NIZA, &rest.url)
    }

    #[test]
    fn polls_every_second_and_pauses_one_second_on_a_rate_limit() {
        let venue = Orderly::new(&NIZA);

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(1));
    }

    #[tokio::test]
    async fn joins_the_interval_of_the_catalog_to_each_row_of_the_futures_call() {
        let rest = MockRest::start().await;
        rest.reply(INFO_PATH, periods());
        rest.reply(FUTURES_PATH, futures(json!([btc_future(), bonk_future()])));

        let rows = venue(&rest).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rest.calls(), [INFO_PATH, FUTURES_PATH]);
        assert_eq!(
            rows["PERP_BTC_USDC"],
            AnchorRow {
                index: 82432.1,
                mark: 82392.0,
                funding_rate: -6.518e-05,
                funding_interval_hours: 8.0,
                next_funding_at: 1791590400000,
                ts: None,
            }
        );
        assert_eq!(rows["PERP_1000BONK_USDC"].funding_interval_hours, 4.0);
        assert_eq!(rows["PERP_1000BONK_USDC"].next_funding_at, 1791576000000);
    }

    #[tokio::test]
    async fn rereads_the_catalog_only_once_a_minute() {
        let rest = MockRest::start().await;
        rest.reply(INFO_PATH, periods());
        rest.reply(FUTURES_PATH, futures(json!([btc_future()])));
        let venue = venue(&rest);

        venue.fetch_round(&http(), T0).await.unwrap();
        venue.fetch_round(&http(), T0 + 59_999).await.unwrap();
        venue.fetch_round(&http(), T0 + 60_000).await.unwrap();

        assert_eq!(rest.calls(), [INFO_PATH, FUTURES_PATH, FUTURES_PATH, INFO_PATH, FUTURES_PATH]);
    }

    #[tokio::test]
    async fn leaves_out_a_builder_market_a_market_not_active_and_a_market_with_no_interval_yet() {
        let rest = MockRest::start().await;
        rest.reply(INFO_PATH, periods());
        let mut not_active = bonk_future();
        not_active["status"] = json!("REDUCE_ONLY");
        let mut no_interval = btc_future();
        no_interval["symbol"] = json!("PERP_ETH_USDC");
        rest.reply(FUTURES_PATH, futures(json!([builder_future(), not_active, no_interval, btc_future()])));

        let rows = venue(&rest).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["PERP_BTC_USDC"]);
    }

    #[tokio::test]
    async fn fails_the_round_when_the_catalog_read_fails_and_tries_it_again_next_round() {
        let rest = MockRest::start().await;
        rest.fail(INFO_PATH, 502);
        rest.reply(FUTURES_PATH, futures(json!([btc_future()])));
        let venue = venue(&rest);

        assert!(venue.fetch_round(&http(), T0).await.is_err());
        rest.reply(INFO_PATH, periods());
        let rows = venue.fetch_round(&http(), T0 + 1_000).await.unwrap();

        assert_eq!(rows.len(), 1);
        assert_eq!(rest.calls(), [INFO_PATH, INFO_PATH, FUTURES_PATH]);
    }

    // An unknown next settlement is 0 under decision 20, and a row with no index is sent as NaN for the poller to count as missing.
    #[tokio::test]
    async fn sends_0_for_a_missing_next_funding_and_nan_for_a_missing_index() {
        let rest = MockRest::start().await;
        rest.reply(INFO_PATH, periods());
        let mut row = btc_future();
        row.as_object_mut().unwrap().remove("next_funding_time");
        row.as_object_mut().unwrap().remove("index_price");
        rest.reply(FUTURES_PATH, futures(json!([row])));

        let rows = venue(&rest).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows["PERP_BTC_USDC"].next_funding_at, 0);
        assert!(rows["PERP_BTC_USDC"].index.is_nan());
    }

    #[tokio::test]
    async fn fails_a_futures_reply_that_says_it_did_not_succeed() {
        let rest = MockRest::start().await;
        rest.reply(INFO_PATH, periods());
        rest.reply(FUTURES_PATH, json!({ "success": false, "code": -1000, "message": "path not found" }));

        assert!(venue(&rest).fetch_round(&http(), T0).await.is_err());
    }
}
