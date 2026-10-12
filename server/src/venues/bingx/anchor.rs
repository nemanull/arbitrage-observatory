use super::BingX;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, RateLimited, get_bytes};
use crate::venues::wire;
use anyhow::Context;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::time::Duration;

// One call returns index, mark, rate, interval and next settlement for every status 1 contract of USDT-M and USDC-M.
// It is limited to 500 calls per 10 s per IP, so the default one second cadence uses a fiftieth of it.
pub const PREMIUM_INDEX_PATH: &str = "/openApi/swap/v2/quote/premiumIndex";

// The business code of a banned IP, which comes with the 418 that follows a 429.
const BANNED_CODE: i64 = 100410;

impl AnchorVenue for BingX {
    // A call after a 429 earns a 418 ban that lifts after 5 minutes, and no Retry-After is sent.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(300)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let rows: Vec<PremiumIndex> = get_data(http, &format!("{}{PREMIUM_INDEX_PATH}", self.rest)).await?;

        // The basket behind each index is not published, so no row can be told apart as a self index.
        let mut anchors = AnchorMap::with_capacity(rows.len());
        for row in rows {
            anchors.insert(
                row.symbol,
                AnchorRow {
                    index: row.index_price,
                    mark: row.mark_price,
                    funding_rate: row.last_funding_rate,
                    funding_interval_hours: row.funding_interval_hours,
                    next_funding_at: row.next_funding_time as i64,
                    ts: None,
                },
            );
        }

        Ok(anchors)
    }
}

// Every public call answers HTTP 200 with a nonzero code on an error, and its data is then an object rather than the rows.
pub async fn get_data<T: DeserializeOwned>(http: &reqwest::Client, url: &str) -> anyhow::Result<T> {
    let body = get_bytes(http, url).await?;
    let status: Status = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;

    if status.code == BANNED_CODE {
        return Err(RateLimited {
            url: url.to_string(),
            reason: format!("code {BANNED_CODE}"),
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
struct PremiumIndex {
    #[serde(default)]
    symbol: String, // "BTC-USDT"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    last_funding_rate: f64, // a fraction per interval, the running rate for the upcoming settlement
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_interval_hours: f64, // 1, 4 or 8
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_funding_time: f64, // Unix ms, although the docs call it the remaining time
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    const T0: i64 = 1_791_512_000_000;

    // Rows captured live on 2026-10-08 at 19:46 UTC, one per funding interval, with the cap and settlement fields the poller ignores.
    fn btc_row() -> Value {
        json!({
            "symbol": "BTC-USDT", "markPrice": "81975.2", "indexPrice": "82009.1", "lastFundingRate": "0.00010000",
            "nextFundingTime": 1791532800000_i64, "fundingIntervalHours": 8, "minFundingRate": "-0.003000",
            "maxFundingRate": "0.003000", "updateTime": 1791504000000_i64,
        })
    }

    fn xtz_row() -> Value {
        json!({
            "symbol": "XTZ-USDT", "markPrice": "0.2898", "indexPrice": "0.2899", "lastFundingRate": "0.00001700",
            "nextFundingTime": 1791518400000_i64, "fundingIntervalHours": 4, "minFundingRate": "-0.02",
            "maxFundingRate": "0.02", "updateTime": 1791504000000_i64,
        })
    }

    fn cyberleek_row() -> Value {
        json!({
            "symbol": "CYBERLEEK-USDT", "markPrice": "0.002183", "indexPrice": "0.002184", "lastFundingRate": "0.00010000",
            "nextFundingTime": 1791514800000_i64, "fundingIntervalHours": 1, "minFundingRate": "-0.02",
            "maxFundingRate": "0.02", "updateTime": 1791511200000_i64,
        })
    }

    async fn poll(body: Value) -> (MockRest, anyhow::Result<AnchorMap>) {
        let rest = MockRest::start().await;
        rest.reply(PREMIUM_INDEX_PATH, body);
        let rows = BingX::with_rest(&rest.url).fetch_round(&http(), T0).await;
        (rest, rows)
    }

    #[test]
    fn polls_every_second_and_pauses_five_minutes_on_a_rate_limit() {
        let venue = BingX::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(300));
    }

    #[tokio::test]
    async fn maps_every_row_of_the_one_premium_index_call_by_its_symbol() {
        let (rest, rows) = poll(json!({ "code": 0, "msg": "", "data": [btc_row(), xtz_row(), cyberleek_row()] })).await;
        let rows = rows.unwrap();

        assert_eq!(rest.calls(), [PREMIUM_INDEX_PATH]);
        assert_eq!(
            rows["BTC-USDT"],
            AnchorRow {
                index: 82009.1,
                mark: 81975.2,
                funding_rate: 0.0001,
                funding_interval_hours: 8.0,
                next_funding_at: 1791532800000,
                ts: None,
            }
        );
        assert_eq!(rows["XTZ-USDT"].funding_interval_hours, 4.0);
        assert_eq!(rows["CYBERLEEK-USDT"].funding_interval_hours, 1.0);
        assert_eq!(rows["CYBERLEEK-USDT"].next_funding_at, 1791514800000);
    }

    #[tokio::test]
    async fn fails_the_round_on_a_nonzero_code_whose_data_is_an_object() {
        let (_rest, rows) = poll(json!({
            "code": 109425, "msg": "NOPE-USDT not exist, please verify it in api: /openApi/swap/v2/quote/contracts", "data": {},
        }))
        .await;

        let error = rows.unwrap_err();
        assert!(error.to_string().starts_with("code 109425: NOPE-USDT not exist"), "{error:#}");
    }

    #[tokio::test]
    async fn reads_the_ban_code_as_a_rate_limit_so_the_poller_pauses() {
        let (rest, rows) = poll(json!({ "code": 100410, "msg": "IP has been banned", "data": {} })).await;

        let error = rows.unwrap_err();
        let limited = error.downcast_ref::<RateLimited>().expect("a RateLimited error");
        assert_eq!(limited.reason, "code 100410");
        assert_eq!(limited.url, format!("{}{PREMIUM_INDEX_PATH}", rest.url));
        assert_eq!(limited.retry_after, None);
    }

    #[tokio::test]
    async fn reads_a_429_as_a_rate_limit() {
        let rest = MockRest::start().await;
        rest.fail(PREMIUM_INDEX_PATH, 429);

        let error = BingX::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");
    }
}
