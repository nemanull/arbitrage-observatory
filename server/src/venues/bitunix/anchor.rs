use super::Bitunix;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, RateLimited, get_bytes};
use crate::venues::wire;
use anyhow::Context;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::time::Duration;

// One call returns index, mark, rate, interval and next settlement for every contract of every family, delisted ones included.
// It is documented at 10 calls a second per IP, so the default one second cadence uses a tenth of it.
pub const FUNDING_PATH: &str = "/api/v1/futures/market/funding_rate/batch";

// Both come with HTTP 200 and no Retry-After, as "Too many requests" and "Request too frequently".
const RATE_LIMIT_CODES: [i64; 2] = [10005, 10006];

const HOUR_MS: i64 = 3_600_000;

impl AnchorVenue for Bitunix {
    // The documented window is one second, and a few quiet windows keep a repeated breach from drawing an IP block.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(5)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let rows: Vec<FundingRate> = get_data(http, &format!("{}{FUNDING_PATH}", self.rest)).await?;

        // The index basket is not published, so no row can be told apart as a self index.
        let mut anchors = AnchorMap::with_capacity(rows.len());
        for row in rows {
            // A delisted contract can carry a null index, and the poller reads only tracked ids anyway.
            if !row.index_price.is_finite() {
                continue;
            }

            anchors.insert(
                row.symbol,
                AnchorRow {
                    index: row.index_price,
                    mark: row.mark_price,
                    funding_rate: row.funding_rate / 100.0,
                    funding_interval_hours: row.funding_interval,
                    next_funding_at: next_settlement(row.next_funding_time),
                    ts: None,
                },
            );
        }

        Ok(anchors)
    }
}

// Every settlement falls on the hour, and the delisted and preview rows hold a time a few seconds old instead, which is no settlement.
fn next_settlement(ms: f64) -> i64 {
    let ms = ms as i64;
    if ms > 0 && ms % HOUR_MS == 0 { ms } else { 0 }
}

// Every public call answers HTTP 200 with a nonzero code and a null data on an error.
pub async fn get_data<T: DeserializeOwned>(http: &reqwest::Client, url: &str) -> anyhow::Result<T> {
    let body = get_bytes(http, url).await?;
    let status: Status = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;

    if RATE_LIMIT_CODES.contains(&status.code) {
        return Err(RateLimited {
            url: url.to_string(),
            reason: format!("code {}", status.code),
            retry_after: None,
        }
        .into());
    }
    if status.code != 0 {
        anyhow::bail!("code {}: {}", status.code, status.msg);
    }

    let reply: Data<T> = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;
    Ok(reply.data)
}

#[derive(Deserialize)]
struct Status {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    msg: String,
}

#[derive(Deserialize)]
struct Data<T> {
    data: T,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FundingRate {
    #[serde(default)]
    symbol: String, // "BTCUSDT", the socket's id
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64, // null on a few delisted rows
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // percent per interval, so "0.01" is 0.0001
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_interval: f64, // hours: 1, 2, 4 or 8
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_funding_time: f64, // Unix ms as a string
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    const T0: i64 = 1_791_523_559_000;

    // Rows captured live on 2026-10-09 at 05:26 UTC, which was 2026-10-08 on this host, one per funding interval, with the cap and last price fields the poller ignores.
    fn btc_row() -> Value {
        json!({
            "symbol": "BTCUSDT", "markPrice": "82444.9", "lastPrice": "82444.9", "indexPrice": "82471.9",
            "fundingRate": "0.006279", "fundingInterval": 8, "nextFundingTime": "1791532800000",
            "maxFundingRate": "0.3", "minFundingRate": "-0.3",
        })
    }

    fn alab_row() -> Value {
        json!({
            "symbol": "ALABUSDT", "markPrice": "355.22", "lastPrice": "355.22", "indexPrice": "355.23",
            "fundingRate": "-0.005554", "fundingInterval": 4, "nextFundingTime": "1791532800000",
            "maxFundingRate": "2", "minFundingRate": "-2",
        })
    }

    // Delisted rows, one with a null index and a zero mark, and both with a time a few seconds old that is no settlement.
    fn ton_row() -> Value {
        json!({
            "symbol": "TONUSD", "markPrice": "0", "lastPrice": "0", "indexPrice": null, "fundingRate": "0",
            "fundingInterval": 8, "nextFundingTime": "1791523530024", "maxFundingRate": "1.875", "minFundingRate": "-1.875",
        })
    }

    fn milk_row() -> Value {
        json!({
            "symbol": "MILKUSDT", "markPrice": "0.01181", "lastPrice": "0.01186", "indexPrice": "0.01178", "fundingRate": "0",
            "fundingInterval": 4, "nextFundingTime": "1791523530016", "maxFundingRate": "1.125", "minFundingRate": "-1.125",
        })
    }

    async fn poll(body: Value) -> (MockRest, anyhow::Result<AnchorMap>) {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_PATH, body);
        let rows = Bitunix::with_rest(&rest.url).fetch_round(&http(), T0).await;
        (rest, rows)
    }

    #[test]
    fn polls_every_second_and_pauses_five_seconds_on_a_rate_limit() {
        let venue = Bitunix::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(5));
    }

    #[tokio::test]
    async fn maps_every_row_of_the_one_batch_call_with_its_rate_read_from_percent() {
        let (rest, rows) = poll(json!({ "code": 0, "msg": "Success", "data": [btc_row(), alab_row()] })).await;
        let rows = rows.unwrap();

        assert_eq!(rest.calls(), [FUNDING_PATH]);
        assert_eq!(
            rows["BTCUSDT"],
            AnchorRow {
                index: 82471.9,
                mark: 82444.9,
                funding_rate: 0.00006279,
                funding_interval_hours: 8.0,
                next_funding_at: 1791532800000,
                ts: None,
            }
        );
        assert!((rows["ALABUSDT"].funding_rate - -0.00005554).abs() < 1e-15);
        assert_eq!(rows["ALABUSDT"].funding_interval_hours, 4.0);
    }

    #[tokio::test]
    async fn leaves_out_a_row_with_a_null_index() {
        let (_rest, rows) = poll(json!({ "code": 0, "msg": "Success", "data": [ton_row(), btc_row()] })).await;

        assert_eq!(rows.unwrap().keys().collect::<Vec<_>>(), ["BTCUSDT"]);
    }

    #[tokio::test]
    async fn reads_a_next_funding_time_off_the_hour_as_unknown() {
        let (_rest, rows) = poll(json!({ "code": 0, "msg": "Success", "data": [milk_row()] })).await;

        assert_eq!(rows.unwrap()["MILKUSDT"].next_funding_at, 0);
    }

    #[tokio::test]
    async fn fails_the_round_on_a_nonzero_code_with_null_data() {
        let (_rest, rows) = poll(json!({ "code": 20015, "data": null, "msg": "this Futures is not allowed to trade." })).await;

        let error = rows.unwrap_err();
        assert!(error.to_string().starts_with("code 20015: this Futures"), "{error:#}");
    }

    #[tokio::test]
    async fn reads_both_rate_limit_codes_as_a_rate_limit_so_the_poller_pauses() {
        for code in [10005, 10006] {
            let (rest, rows) = poll(json!({ "code": code, "data": null, "msg": "Too many requests, please try again later" })).await;

            let error = rows.unwrap_err();
            let limited = error.downcast_ref::<RateLimited>().expect("a RateLimited error");
            assert_eq!(limited.reason, format!("code {code}"));
            assert_eq!(limited.url, format!("{}{FUNDING_PATH}", rest.url));
            assert_eq!(limited.retry_after, None);
        }
    }

    #[tokio::test]
    async fn fails_the_round_on_a_body_that_is_no_envelope() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_PATH, json!("Just a moment..."));

        let error = Bitunix::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();

        assert!(format!("{error:#}").contains("error decoding response body"), "{error:#}");
    }

    #[tokio::test]
    async fn reads_a_429_as_a_rate_limit() {
        let rest = MockRest::start().await;
        rest.fail(FUNDING_PATH, 429);

        let error = Bitunix::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");
    }
}
