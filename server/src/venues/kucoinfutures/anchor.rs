use super::KucoinFutures;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, RateLimited, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::time::Duration;

// One call lists every contract with its index, mark, rate, interval and next settlement, so the loader reads it too.
// It weighs 3 of the 2,000 per 30 s each IP may spend, so the default one second cadence spends 90.
pub const CONTRACTS_PATH: &str = "/api/v1/contracts/active";

const SUCCESS_CODE: &str = "200000";
const RATE_LIMIT_CODE: &str = "429000"; // documented with HTTP 429, and checked in a 200 body too
const MS_PER_HOUR: f64 = 3_600_000.0;
const NORMAL_STAGE: &str = "NORMAL";

impl AnchorVenue for KucoinFutures {
    // The public pool refills per 30 s window, and the limit answer carries no Retry-After.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(30)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let reply = contracts(http, &self.rest).await?;
        let mut rows = AnchorMap::with_capacity(reply.data.len());

        for contract in reply.data {
            // A pre market contract's index basket was KuCoin's own perpetual at weight 1 on all five on 2026-10-08.
            // A dated future carries no funding fields.
            if contract.market_stage != NORMAL_STAGE || contract.status != "Open" || contract.next_funding_rate_date_time.is_none() {
                continue;
            }

            rows.insert(
                contract.symbol,
                AnchorRow {
                    index: contract.index_price,
                    mark: contract.mark_price,
                    funding_rate: contract.funding_fee_rate,
                    funding_interval_hours: contract.funding_rate_granularity / MS_PER_HOUR,
                    next_funding_at: contract.next_funding_rate_date_time.unwrap_or(0.0) as i64,
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

// KuCoin answers a bad request with HTTP 200 and a code other than 200000.
pub async fn contracts(http: &reqwest::Client, rest: &str) -> anyhow::Result<Reply> {
    let url = format!("{rest}{CONTRACTS_PATH}");
    let reply: Reply = get_json(http, &url).await?;

    if reply.code == RATE_LIMIT_CODE {
        return Err(RateLimited {
            url,
            reason: format!("code {RATE_LIMIT_CODE}"),
            retry_after: None,
        }
        .into());
    }
    if reply.code != SUCCESS_CODE {
        anyhow::bail!("code {}: {}", reply.code, reply.msg);
    }

    Ok(reply)
}

#[derive(Deserialize)]
pub struct Reply {
    #[serde(default)]
    pub code: String, // "200000" on success
    #[serde(default)]
    pub msg: String, // present on an error only
    #[serde(default)]
    pub data: Vec<Contract>,
}

// Every number is a JSON number, and a dated future sends null for each funding field.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contract {
    #[serde(default)]
    pub symbol: String, // "XBTUSDTM", the socket's id
    #[serde(default)]
    pub base_currency: String, // "XBT"
    #[serde(default)]
    pub quote_currency: String,
    #[serde(default)]
    pub status: String, // "Open", "Init", "BeingSettled", "Settled", "Paused", "Closed" or "CancelOnly"
    #[serde(default)]
    pub is_inverse: bool,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    pub multiplier: f64, // coins per lot, and -1 on an inverse contract, which counts one USD per lot
    #[serde(default)]
    pub market_stage: String, // "NORMAL" or "PRE_MARKET"
    pub next_funding_rate_time: Option<f64>, // a countdown in ms, and null on a dated future
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_fee_rate: f64, // a fraction per interval, the running estimate for the upcoming settlement
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate_granularity: f64, // ms: 28800000, 14400000 or 3600000
    next_funding_rate_date_time: Option<f64>, // Unix ms
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    const T0: i64 = 1_791_514_046_000;

    // Rows captured live on 2026-10-08, cut down to the fields the poller reads plus a few it ignores.
    fn xbt_usdt() -> Value {
        json!({
            "symbol": "XBTUSDTM", "type": "FFWCSX", "baseCurrency": "XBT", "quoteCurrency": "USDT", "multiplier": 0.001,
            "isInverse": false, "status": "Open", "fundingFeeRate": 0.0001, "fundingRateGranularity": 28800000,
            "markPrice": 81995.28, "indexPrice": 82023.09, "lastTradePrice": 81989.8, "nextFundingRateTime": 18815784,
            "nextFundingRateDateTime": 1791532800000_i64, "marketStage": "NORMAL", "lastTimeFundingRate": 9.4e-05,
        })
    }

    fn alt_usdt() -> Value {
        json!({
            "symbol": "ALTUSDTM", "type": "FFWCSX", "baseCurrency": "ALT", "quoteCurrency": "USDT", "multiplier": 10.0,
            "isInverse": false, "status": "Open", "fundingFeeRate": 5e-05, "fundingRateGranularity": 14400000,
            "markPrice": 0.007284, "indexPrice": 0.007283, "nextFundingRateTime": 4415784,
            "nextFundingRateDateTime": 1791518400000_i64, "marketStage": "NORMAL",
        })
    }

    fn openai_pre_market() -> Value {
        json!({
            "symbol": "OPENAIUSDTM", "type": "FFWCSX", "baseCurrency": "OPENAI", "quoteCurrency": "USDT", "multiplier": 0.001,
            "isInverse": false, "status": "Open", "fundingFeeRate": 5e-05, "fundingRateGranularity": 28800000,
            "markPrice": 1657.7, "indexPrice": 1657.48, "nextFundingRateTime": 18815784,
            "nextFundingRateDateTime": 1791532800000_i64, "marketStage": "PRE_MARKET",
        })
    }

    fn xbt_dated() -> Value {
        json!({
            "symbol": "XBTMZ26", "type": "FFICSX", "baseCurrency": "XBT", "quoteCurrency": "USD", "multiplier": -1.0,
            "isInverse": true, "status": "Open", "fundingFeeRate": null, "fundingRateGranularity": null,
            "markPrice": 82799.3, "indexPrice": 81961.6, "nextFundingRateTime": null, "nextFundingRateDateTime": null,
            "marketStage": "NORMAL",
        })
    }

    // Every row read Open on 2026-10-08, so this row is the XBTUSDTM capture with a documented closing status.
    fn paused() -> Value {
        let mut row = xbt_usdt();
        row["symbol"] = json!("OLDUSDTM");
        row["status"] = json!("Paused");
        row
    }

    async fn poll(body: Value) -> (MockRest, anyhow::Result<AnchorMap>) {
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, body);
        let rows = KucoinFutures::with_rest(&rest.url).fetch_round(&http(), T0).await;
        (rest, rows)
    }

    #[test]
    fn polls_every_second_and_pauses_for_one_thirty_second_window_on_a_rate_limit() {
        let venue = KucoinFutures::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(30));
    }

    #[tokio::test]
    async fn maps_a_normal_swap_with_its_interval_in_hours_and_next_settlement_in_ms() {
        let (rest, rows) = poll(json!({ "code": "200000", "data": [xbt_usdt(), alt_usdt()] })).await;
        let rows = rows.unwrap();

        assert_eq!(rest.calls(), [CONTRACTS_PATH]);
        assert_eq!(
            rows["XBTUSDTM"],
            AnchorRow {
                index: 82023.09,
                mark: 81995.28,
                funding_rate: 0.0001,
                funding_interval_hours: 8.0,
                next_funding_at: 1791532800000,
                ts: None,
            }
        );
        assert_eq!(rows["ALTUSDTM"].funding_interval_hours, 4.0);
        assert_eq!(rows["ALTUSDTM"].next_funding_at, 1791518400000);
    }

    #[tokio::test]
    async fn leaves_out_a_pre_market_contract_a_dated_future_and_a_contract_that_is_not_open() {
        let (_rest, rows) = poll(json!({ "code": "200000", "data": [openai_pre_market(), xbt_dated(), paused(), xbt_usdt()] })).await;

        assert_eq!(rows.unwrap().keys().collect::<Vec<_>>(), ["XBTUSDTM"]);
    }

    #[tokio::test]
    async fn fails_the_round_on_a_reply_whose_code_is_not_success() {
        let (_rest, rows) = poll(json!({ "code": "500000", "msg": "Internal error" })).await;

        let error = rows.unwrap_err();
        assert!(error.to_string().contains("code 500000: Internal error"), "{error:#}");
    }

    #[tokio::test]
    async fn reads_the_rate_limit_code_inside_a_200_body_as_a_rate_limit() {
        let (_rest, rows) = poll(json!({ "code": "429000", "msg": "Too many requests" })).await;

        let error = rows.unwrap_err();
        let limited = error.downcast_ref::<RateLimited>().expect("a rate limit");
        assert_eq!(limited.reason, "code 429000");
        assert_eq!(limited.retry_after, None);
    }

    #[tokio::test]
    async fn reads_an_http_429_as_a_rate_limit() {
        let rest = MockRest::start().await;
        rest.fail(CONTRACTS_PATH, 429);

        let error = KucoinFutures::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");
    }
}
