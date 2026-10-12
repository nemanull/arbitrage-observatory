use super::{AnchorSource, Mexc};
use crate::clock::now_ms;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, RateLimited, get_json};
use crate::venues::wire;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::collections::HashMap;

// One call returns index, mark, rate, interval and next settlement for every contract of every family.
// It is documented at 20 calls per 2 s, so the default one second cadence uses a tenth of it.
const FUNDING_PATH: &str = "/api/v1/contract/funding_rate";

// Ourbit's and BYDFi's funding call carries no index and no mark, so the bulk ticker, at the same limit, adds them.
const TICKER_PATH: &str = "/api/v1/contract/ticker";

// MEXC reports its rate limit inside an HTTP 200 body and sends no Retry-After, so the pause is the poller's default.
// Ourbit documents the same code, and BYDFi publishes no limit, so both keep that pause too.
const RATE_LIMIT_CODE: i64 = 510;

impl AnchorVenue for Mexc {
    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        match self.profile.anchor {
            AnchorSource::Funding => self.funding_round(http).await,
            AnchorSource::TickerAndFunding => self.ticker_round(http).await,
        }
    }
}

impl Mexc {
    async fn funding_round(&self, http: &reqwest::Client) -> anyhow::Result<AnchorMap> {
        let funding: Vec<FundingRate> = data(http, &format!("{}{FUNDING_PATH}", self.rest)).await?;

        // The reply also carries a few rows with no catalog entry, and the poller reads only tracked ids.
        let mut rows = AnchorMap::with_capacity(funding.len());
        for row in funding {
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

    // Both calls go out together, and a row needs both, since only the funding call carries the interval and the next settlement.
    async fn ticker_round(&self, http: &reqwest::Client) -> anyhow::Result<AnchorMap> {
        let (ticker_url, funding_url) = (format!("{}{TICKER_PATH}", self.rest), format!("{}{FUNDING_PATH}", self.rest));
        let (tickers, funding) = tokio::join!(
            data::<Vec<Ticker>>(http, &ticker_url),
            data::<Vec<FundingRate>>(http, &funding_url),
        );
        let (tickers, funding) = (tickers?, funding?);
        let arrived_at = now_ms();

        let mut funding_by_symbol = HashMap::with_capacity(funding.len());
        for row in funding {
            funding_by_symbol.insert(row.symbol.clone(), row);
        }

        let mut rows = AnchorMap::with_capacity(tickers.len());
        for ticker in tickers {
            let Some(funding) = funding_by_symbol.get(&ticker.symbol) else {
                continue;
            };
            rows.insert(
                ticker.symbol,
                AnchorRow {
                    index: ticker.index_price,
                    mark: ticker.fair_price,
                    funding_rate: funding.funding_rate,
                    funding_interval_hours: funding.collect_cycle,
                    next_funding_at: funding.next_settle_time as i64,
                    // The ticker is a snapshot rebuilt about every 2 s, and Ourbit's rows were 0.5 to 4.7 s old on arrival on 2026-10-09.
                    ts: Some(stamp(ticker.timestamp, arrived_at)),
                },
            );
        }

        Ok(rows)
    }
}

// Every call answers HTTP 200 and says in its body whether it succeeded.
async fn data<T: DeserializeOwned + Default>(http: &reqwest::Client, url: &str) -> anyhow::Result<T> {
    let reply: Reply<T> = get_json(http, url).await?;

    if reply.code == RATE_LIMIT_CODE {
        return Err(RateLimited {
            url: url.to_string(),
            reason: format!("code {RATE_LIMIT_CODE}"),
            retry_after: None,
        }
        .into());
    }
    if !reply.success || reply.code != 0 {
        anyhow::bail!("code {}: {}", reply.code, reply.message);
    }

    Ok(reply.data)
}

// The row's own time, capped by arrival so a clock that runs ahead never makes a row look fresher than it is.
fn stamp(timestamp: f64, arrived_at: i64) -> i64 {
    if timestamp.is_finite() && timestamp > 0.0 {
        (timestamp as i64).min(arrived_at)
    } else {
        arrived_at
    }
}

#[derive(Deserialize)]
struct Reply<T> {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    code: i64, // 0 on success, 510 when rate limited, 1001 for an unknown contract
    #[serde(default)]
    message: String, // present on an error only
    #[serde(default)]
    data: T,
}

// Every number is a JSON number.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FundingRate {
    #[serde(default)]
    symbol: String, // "BTC_USDT"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    idx_price: f64, // MEXC only
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    fair_price: f64, // MEXC's mark, MEXC only
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // a fraction per interval, for the upcoming settlement
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    collect_cycle: f64, // hours: 1, 4, 8 or 24
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_settle_time: f64, // Unix ms
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ticker {
    #[serde(default)]
    symbol: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    fair_price: f64, // the mark
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    timestamp: f64, // Unix ms of the snapshot the row belongs to
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

#[cfg(test)]
mod clone_tests {
    use super::super::{BYDFI, OURBIT, Profile};
    use super::*;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};
    use std::time::Duration;

    const T0: i64 = 1_791_573_366_000;

    // Rows captured live on 2026-10-09 at 19:16 UTC, cut to the fields the poller reads and a few it ignores.
    fn ourbit_ticker() -> Value {
        json!({ "success": true, "code": 0, "data": [
            { "symbol": "BTC_USDT", "lastPrice": 82479.5, "bid1": 82479.4, "ask1": 82479.5, "indexPrice": 82517.8, "fairPrice": 82481.3, "fundingRate": 0.000042, "timestamp": 1791573362482_i64 },
            { "symbol": "GMT_USDT", "lastPrice": 0.009108, "indexPrice": 0.009136, "fairPrice": 0.009123, "fundingRate": 0.00005, "timestamp": 1791573362738_i64 },
            { "symbol": "NEW_USDT", "indexPrice": 1.5, "fairPrice": 1.5, "fundingRate": 0.0, "timestamp": 1791573362738_i64 },
        ]})
    }

    fn ourbit_funding() -> Value {
        json!({ "success": true, "code": 0, "data": [
            { "symbol": "BTC_USDT", "fundingRate": 0.000042, "maxFundingRate": 0.002, "minFundingRate": -0.002, "collectCycle": 8, "nextSettleTime": 1791590400000_i64, "timestamp": 1791573365112_i64 },
            { "symbol": "GMT_USDT", "fundingRate": 0.00005, "maxFundingRate": 0.02, "minFundingRate": -0.02, "collectCycle": 4, "nextSettleTime": 1791576000000_i64, "timestamp": 1791573365112_i64 },
            { "symbol": "OLD_USDT", "fundingRate": 0.0001, "maxFundingRate": 0.02, "minFundingRate": -0.02, "collectCycle": 8, "nextSettleTime": 1791590400000_i64, "timestamp": 1791573365112_i64 },
        ]})
    }

    async fn poll(profile: &'static Profile, ticker: Value, funding: Value) -> (MockRest, anyhow::Result<AnchorMap>) {
        let rest = MockRest::start().await;
        rest.reply(TICKER_PATH, ticker);
        rest.reply(FUNDING_PATH, funding);
        let rows = Mexc::at(profile, &rest.url).fetch_round(&http(), T0).await;
        (rest, rows)
    }

    #[test]
    fn polls_each_clone_every_second_and_pauses_a_minute_on_a_rate_limit() {
        for profile in [&OURBIT, &BYDFI] {
            let venue = Mexc::for_venue(profile);
            assert_eq!(venue.poll_every(), Duration::from_secs(1));
            assert_eq!(venue.rate_limit_pause(), Duration::from_secs(60));
        }
    }

    #[tokio::test]
    async fn merges_the_tickers_index_and_mark_with_the_funding_calls_interval_and_settlement() {
        let (rest, rows) = poll(&OURBIT, ourbit_ticker(), ourbit_funding()).await;
        let rows = rows.unwrap();

        let mut calls = rest.calls();
        calls.sort();
        assert_eq!(calls, [FUNDING_PATH, TICKER_PATH]);
        assert_eq!(
            rows["BTC_USDT"],
            AnchorRow {
                index: 82517.8,
                mark: 82481.3,
                funding_rate: 0.000042,
                funding_interval_hours: 8.0,
                next_funding_at: 1791590400000,
                ts: Some(1791573362482),
            }
        );
        assert_eq!(rows["GMT_USDT"].funding_interval_hours, 4.0);
    }

    // NEW_USDT is only in the ticker and OLD_USDT only in the funding call, so neither has all five columns.
    #[tokio::test]
    async fn leaves_out_a_contract_that_only_one_of_the_two_calls_carries() {
        let (_rest, rows) = poll(&OURBIT, ourbit_ticker(), ourbit_funding()).await;
        let rows = rows.unwrap();

        assert!(!rows.contains_key("NEW_USDT"));
        assert!(!rows.contains_key("OLD_USDT"));
        assert_eq!(rows.len(), 2);
    }

    // The stamp never runs ahead of arrival, and a row with no timestamp takes the arrival.
    #[test]
    fn stamps_a_row_with_its_own_time_capped_by_arrival() {
        assert_eq!(stamp(1791573362482.0, T0), 1791573362482);
        assert_eq!(stamp((T0 + 900) as f64, T0), T0);
        assert_eq!(stamp(f64::NAN, T0), T0);
    }

    #[tokio::test]
    async fn fails_the_round_when_either_call_answers_success_false() {
        let unknown = json!({ "success": false, "code": 1001, "message": "Contract does not exist" });

        let (_rest, rows) = poll(&BYDFI, unknown.clone(), ourbit_funding()).await;
        assert!(rows.unwrap_err().to_string().contains("code 1001"));

        let (_rest, rows) = poll(&BYDFI, ourbit_ticker(), unknown).await;
        assert!(rows.unwrap_err().to_string().contains("code 1001"));
    }

    #[tokio::test]
    async fn reads_code_510_on_the_ticker_as_a_rate_limit() {
        let limited = json!({ "success": false, "code": 510, "message": "Requests are too frequent" });

        let (rest, rows) = poll(&BYDFI, limited, ourbit_funding()).await;

        let error = rows.unwrap_err();
        let limited = error.downcast_ref::<RateLimited>().expect("a RateLimited error");
        assert_eq!(limited.url, format!("{}{TICKER_PATH}", rest.url));
    }

    #[tokio::test]
    async fn fails_the_round_when_a_call_answers_an_http_error() {
        let rest = MockRest::start().await;
        rest.reply(TICKER_PATH, ourbit_ticker());
        rest.fail(FUNDING_PATH, 502);

        assert!(Mexc::at(&OURBIT, &rest.url).fetch_round(&http(), T0).await.is_err());
    }
}
