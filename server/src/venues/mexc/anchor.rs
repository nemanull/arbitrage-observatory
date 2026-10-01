use super::Mexc;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, RateLimited, get_json};
use crate::venues::wire;
use serde::Deserialize;

// One call returns index, mark, rate, interval and next settlement for every contract of every family.
// It is documented at 20 calls per 2 s, so the default one second cadence uses a tenth of it.
const FUNDING_PATH: &str = "/api/v1/contract/funding_rate";

// MEXC reports its rate limit inside an HTTP 200 body and sends no Retry-After, so the pause is the poller's default.
const RATE_LIMIT_CODE: i64 = 510;

impl AnchorVenue for Mexc {
    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let url = format!("{}{FUNDING_PATH}", self.rest);
        let reply: Reply = get_json(http, &url).await?;

        if reply.code == RATE_LIMIT_CODE {
            return Err(RateLimited {
                url,
                reason: format!("code {RATE_LIMIT_CODE}"),
                retry_after: None,
            }
            .into());
        }
        if !reply.success || reply.code != 0 {
            anyhow::bail!("code {}: {}", reply.code, reply.message);
        }

        // The reply also carries a few rows with no catalog entry, and the poller reads only tracked ids.
        let mut rows = AnchorMap::with_capacity(reply.data.len());
        for row in reply.data {
            rows.insert(
                row.symbol,
                AnchorRow {
                    index: row.idx_price,
                    mark: row.fair_price,
                    funding_rate: row.funding_rate,
                    funding_interval_hours: row.collect_cycle,
                    next_funding_at: row.next_settle_time as i64,
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
    code: i64, // 0 on success, 510 when rate limited, 1001 for an unknown contract
    #[serde(default)]
    message: String, // present on an error only
    #[serde(default)]
    data: Vec<FundingRate>,
}

// Every number is a JSON number.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FundingRate {
    #[serde(default)]
    symbol: String, // "BTC_USDT"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    idx_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    fair_price: f64, // MEXC's mark
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // a fraction per interval, for the upcoming settlement
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    collect_cycle: f64, // hours: 1, 4, 8 or 24
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_settle_time: f64, // Unix ms
}

#[cfg(test)]
mod tests {
    // Ported case for case from old_ts_server/src/venues/mexc/anchor.spec.ts.

    use super::*;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};
    use std::time::Duration;

    const T0: i64 = 1_789_455_551_670;

    // Rows captured live on 2026-09-15, BTC_USDT at 06:59 and RIF_USDT at 20:50 UTC, with the cap and timestamp fields the poller ignores.
    fn btc_row() -> Value {
        json!({
            "symbol": "BTC_USDT", "fundingRate": 0.000067, "maxFundingRate": 0.0018, "minFundingRate": -0.0018,
            "collectCycle": 8, "nextSettleTime": 1789459200000_i64, "timestamp": 1789455551670_i64,
            "idxPrice": 77271.6, "fairPrice": 77240.4,
        })
    }

    fn rif_row() -> Value {
        json!({
            "symbol": "RIF_USDT", "fundingRate": 0.00005, "maxFundingRate": 0.03, "minFundingRate": -0.03,
            "collectCycle": 4, "nextSettleTime": 1789516800000_i64, "timestamp": 1789505423033_i64,
            "idxPrice": 0.08181, "fairPrice": 0.08218,
        })
    }

    async fn poll(body: Value) -> (MockRest, anyhow::Result<AnchorMap>) {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_PATH, body);
        let rows = Mexc::with_rest(&rest.url).fetch_round(&http(), T0).await;
        (rest, rows)
    }

    #[test]
    fn polls_every_second_and_pauses_a_minute_on_a_rate_limit() {
        let venue = Mexc::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(60));
    }

    #[tokio::test]
    async fn maps_every_row_of_the_one_funding_call_by_its_symbol() {
        let (rest, rows) = poll(json!({ "success": true, "code": 0, "data": [btc_row(), rif_row()] })).await;
        let rows = rows.unwrap();

        assert_eq!(rest.calls(), [FUNDING_PATH]);
        assert_eq!(
            rows["BTC_USDT"],
            AnchorRow {
                index: 77271.6,
                mark: 77240.4,
                funding_rate: 0.000067,
                funding_interval_hours: 8.0,
                next_funding_at: 1789459200000,
                ts: None,
            }
        );
        assert_eq!(rows["RIF_USDT"].funding_interval_hours, 4.0);
    }

    #[tokio::test]
    async fn fails_the_round_on_a_reply_whose_success_is_false() {
        let (_rest, rows) = poll(json!({ "success": false, "code": 1001, "message": "Contract does not exist" })).await;

        let error = rows.unwrap_err();
        assert!(error.to_string().contains("code 1001: Contract does not exist"), "{error:#}");
    }

    #[tokio::test]
    async fn fails_the_round_on_a_nonzero_code_even_when_success_is_true() {
        let (_rest, rows) = poll(json!({ "success": true, "code": 2, "data": [btc_row()] })).await;

        assert!(rows.unwrap_err().to_string().contains("code 2"));
    }

    #[tokio::test]
    async fn reads_code_510_as_a_rate_limit_so_the_poller_pauses() {
        let (rest, rows) = poll(json!({
            "success": false, "code": 510, "message": "Requests are too frequent, please try again later",
        }))
        .await;

        let error = rows.unwrap_err();
        let limited = error.downcast_ref::<RateLimited>().expect("a RateLimited error");
        assert_eq!(limited.reason, "code 510");
        assert_eq!(limited.url, format!("{}{FUNDING_PATH}", rest.url));
        assert_eq!(limited.retry_after, None);
    }
}
