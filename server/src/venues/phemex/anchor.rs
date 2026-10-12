use super::Phemex;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;

// No call carries all five columns, so each round reads both and merges them by symbol.
// The ticker holds index and mark as real prices (the Rp fields), and CloudFront serves it from cache on some polls.
pub const TICKER_PATH: &str = "/md/v3/ticker/24hr/all";
// The funding call returns 20 rows without pageSize, and its rate moved more often than the ticker's fundingRateRr.
pub const FUNDING_PATH: &str = "/contract-biz/public/real-funding-rates?pageSize=200";

const SECONDS_PER_HOUR: f64 = 3_600.0;

impl AnchorVenue for Phemex {
    // The limits count per minute and per 5 min, and the over limit header is x-ratelimit-retry-after-<group>, which the poller does not read.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(60)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let ticker_url = format!("{}{TICKER_PATH}", self.rest);
        let funding_url = format!("{}{FUNDING_PATH}", self.rest);
        let (ticker, funding) = tokio::try_join!(
            get_json::<TickerReply>(http, &ticker_url),
            get_json::<FundingReply>(http, &funding_url),
        )?;

        if let Some(error) = ticker.error {
            anyhow::bail!("ticker answered error {error}");
        }
        if funding.code != 0 {
            anyhow::bail!("funding answered code {}: {}", funding.code, funding.msg);
        }

        let mut rates = HashMap::with_capacity(funding.data.rows.len());
        for row in funding.data.rows {
            rates.insert(row.symbol.clone(), row);
        }

        let ticks = ticker.result.unwrap_or_default();
        let mut rows = AnchorMap::with_capacity(ticks.len());
        for tick in ticks {
            // A row the funding call lacks is LSKUSDT, which left the catalog and stays on the ticker.
            let Some(rate) = rates.get(&tick.symbol) else {
                continue;
            };
            if !(tick.index > 0.0) || !(tick.mark > 0.0) {
                continue;
            }

            rows.insert(
                tick.symbol,
                AnchorRow {
                    index: tick.index,
                    mark: tick.mark,
                    funding_rate: rate.funding_rate,
                    funding_interval_hours: rate.funding_interval / SECONDS_PER_HOUR,
                    next_funding_at: rate.next_funding_time as i64,
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

#[derive(Deserialize)]
struct TickerReply {
    error: Option<serde_json::Value>,
    result: Option<Vec<Tick>>, // null beside an error
}

#[derive(Deserialize)]
struct Tick {
    #[serde(default)]
    symbol: String, // "BTCUSDT"
    #[serde(rename = "indexRp", default = "wire::nan", deserialize_with = "wire::num")]
    index: f64,
    #[serde(rename = "markRp", default = "wire::nan", deserialize_with = "wire::num")]
    mark: f64, // the median of two index based prices and the contract's own last trade
}

#[derive(Deserialize)]
struct FundingReply {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    msg: String,
    data: FundingData,
}

#[derive(Deserialize)]
struct FundingData {
    #[serde(default)]
    rows: Vec<Funding>,
}

#[derive(Deserialize)]
struct Funding {
    #[serde(default)]
    symbol: String,
    #[serde(rename = "fundingRate", default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // a fraction per interval, the running estimate for the next settlement
    #[serde(rename = "fundingInterval", default = "wire::nan", deserialize_with = "wire::num")]
    funding_interval: f64, // seconds, 28800 or 14400
    #[serde(rename = "nextfundingTime", default, deserialize_with = "wire::num")]
    next_funding_time: f64, // Unix ms
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    const T0: i64 = 1_791_523_576_000;

    // Rows of both calls captured live on 2026-10-08, cut down to the fields the poller reads plus a few it ignores.
    fn btc_tick() -> Value {
        json!({
            "askRp": "82459.2", "bidRp": "82459.1", "fundingRateRr": "0.0000649", "indexRp": "82492.27980135",
            "lastRp": "82459.2", "markRp": "82459.2", "predFundingRateRr": "0.0000649", "symbol": "BTCUSDT",
            "timestamp": 1791523574334588058_u64,
        })
    }

    fn xau_tick() -> Value {
        json!({
            "askRp": "4195", "bidRp": "4193.88", "fundingRateRr": "0", "indexRp": "4194.141", "lastRp": "4193.89",
            "markRp": "4194.12", "symbol": "XAUUSDT", "timestamp": 1791523576342226127_u64,
        })
    }

    // The catalog no longer lists it, and the funding call does not carry it.
    fn lsk_tick() -> Value {
        json!({
            "askRp": "0.23869", "bidRp": "0.23842", "fundingRateRr": "0.00005", "indexRp": "0.2387136", "lastRp": "0.23869",
            "markRp": "0.23869", "symbol": "LSKUSDT", "timestamp": 1791523576342999221_u64,
        })
    }

    fn btc_funding() -> Value {
        json!({
            "symbol": "BTCUSDT", "fundingInterval": 28800, "toNextfundingInterval": 9223, "nextfundingTime": 1791532800000_i64,
            "fundingRate": "0.0000649", "interestRate": "0.0001", "fundingRateCap": "0.02", "fundingRateFloor": "-0.02",
        })
    }

    fn xau_funding() -> Value {
        json!({
            "symbol": "XAUUSDT", "fundingInterval": 14400, "toNextfundingInterval": 9223, "nextfundingTime": 1791532800000_i64,
            "fundingRate": "0", "interestRate": "0", "fundingRateCap": "0.00375", "fundingRateFloor": "-0.00375",
        })
    }

    fn eth_inverse_funding() -> Value {
        json!({
            "symbol": "cETHUSD", "fundingInterval": 28800, "toNextfundingInterval": 9223, "nextfundingTime": 1791532800000_i64,
            "fundingRate": "-0.00015024", "interestRate": "0.0001", "fundingRateCap": "0.03", "fundingRateFloor": "-0.03",
        })
    }

    fn ticker(rows: Vec<Value>) -> Value {
        json!({ "error": null, "id": 0, "result": rows })
    }

    fn funding(rows: Vec<Value>) -> Value {
        json!({ "code": 0, "msg": "OK", "data": { "total": rows.len(), "rows": rows } })
    }

    async fn poll(rest: &MockRest) -> anyhow::Result<AnchorMap> {
        Phemex::with_rest(&rest.url).fetch_round(&http(), T0).await
    }

    #[test]
    fn polls_every_second_and_pauses_a_minute_on_a_rate_limit() {
        let venue = Phemex::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(60));
    }

    #[tokio::test]
    async fn merges_index_and_mark_from_the_ticker_with_funding_by_symbol() {
        let rest = MockRest::start().await;
        rest.reply(TICKER_PATH, ticker(vec![btc_tick(), xau_tick()]));
        rest.reply(FUNDING_PATH, funding(vec![xau_funding(), btc_funding(), eth_inverse_funding()]));

        let rows = poll(&rest).await.unwrap();

        let mut calls = rest.calls();
        calls.sort();
        assert_eq!(calls, [FUNDING_PATH, TICKER_PATH]);
        assert_eq!(rows.len(), 2);
        assert_eq!(
            rows["BTCUSDT"],
            AnchorRow {
                index: 82492.27980135,
                mark: 82459.2,
                funding_rate: 0.0000649,
                funding_interval_hours: 8.0,
                next_funding_at: 1791532800000,
                ts: None,
            }
        );
        assert_eq!(rows["XAUUSDT"].funding_interval_hours, 4.0);
        assert_eq!(rows["XAUUSDT"].funding_rate, 0.0);
    }

    #[tokio::test]
    async fn leaves_out_a_ticker_row_the_funding_call_lacks() {
        let rest = MockRest::start().await;
        rest.reply(TICKER_PATH, ticker(vec![btc_tick(), lsk_tick()]));
        rest.reply(FUNDING_PATH, funding(vec![btc_funding()]));

        let rows = poll(&rest).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTCUSDT"]);
    }

    #[tokio::test]
    async fn leaves_out_a_row_with_an_empty_index_or_mark() {
        let mut no_mark = btc_tick();
        no_mark["markRp"] = json!("");
        let mut no_index = xau_tick();
        no_index["indexRp"] = json!("0");
        let rest = MockRest::start().await;
        rest.reply(TICKER_PATH, ticker(vec![no_mark, no_index]));
        rest.reply(FUNDING_PATH, funding(vec![btc_funding(), xau_funding()]));

        assert!(poll(&rest).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn sends_an_unknown_next_funding_as_zero() {
        let mut row = btc_funding();
        row.as_object_mut().unwrap().remove("nextfundingTime");
        let rest = MockRest::start().await;
        rest.reply(TICKER_PATH, ticker(vec![btc_tick()]));
        rest.reply(FUNDING_PATH, funding(vec![row]));

        let rows = poll(&rest).await.unwrap();

        assert_eq!(rows["BTCUSDT"].next_funding_at, 0);
        assert_eq!(rows["BTCUSDT"].funding_interval_hours, 8.0);
    }

    #[tokio::test]
    async fn fails_the_round_when_either_call_fails() {
        let rest = MockRest::start().await;
        rest.reply(TICKER_PATH, ticker(vec![btc_tick()]));
        rest.fail(FUNDING_PATH, 500);

        assert!(poll(&rest).await.is_err());

        rest.reply(FUNDING_PATH, funding(vec![btc_funding()]));
        rest.fail(TICKER_PATH, 500);

        assert!(poll(&rest).await.is_err());
    }

    #[tokio::test]
    async fn fails_the_round_on_an_error_in_either_body() {
        let rest = MockRest::start().await;
        rest.reply(TICKER_PATH, json!({ "error": { "code": 6001, "message": "invalid argument" }, "id": null, "result": null }));
        rest.reply(FUNDING_PATH, funding(vec![btc_funding()]));

        assert!(poll(&rest).await.is_err());

        rest.reply(TICKER_PATH, ticker(vec![btc_tick()]));
        rest.reply(FUNDING_PATH, json!({ "code": 30000, "msg": "error", "data": {} }));

        assert!(poll(&rest).await.is_err());
    }
}
