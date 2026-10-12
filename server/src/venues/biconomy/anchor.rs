use super::Biconomy;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;

// Index and mark for every contract, from a snapshot the venue retakes about once a second.
const TICKER_PATH: &str = "/future/api/v1/ticker/list?timezone=24H";

// Rate, interval in hours and next settlement for every contract.
// The ticker carries a rate too, but the two calls are separate snapshots that disagreed on about 18 contracts, so the rate comes from here only.
const FUNDING_PATH: &str = "/future/api/v1/allFundingRate";

// Rows left out of the anchors, each with the reason its index cannot be trusted.
// ICP_USDT's single source basket on BITGET_FUTURE has read 2.944 on every hourly index candle since 2026-09-21, still so on 2026-10-09, while Bybit's ICP index moved.
const FROZEN_INDEX: &[&str] = &["ICP_USDT"];

impl AnchorVenue for Biconomy {
    // The index moves about every 5 s and the ticker every second, and the two replies are about 120 KB a round.
    fn poll_every(&self) -> Duration {
        Duration::from_secs(2)
    }

    // No futures limit or Retry-After is published, and 3 calls a second never met one.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let ticker_url = format!("{}{TICKER_PATH}", self.rest);
        let funding_url = format!("{}{FUNDING_PATH}", self.rest);
        let (tickers, funding) = tokio::join!(
            get_json::<Reply<Ticker>>(http, &ticker_url),
            get_json::<Reply<Funding>>(http, &funding_url),
        );
        let tickers = tickers?.rows("ticker/list")?;
        let funding = funding?.rows("allFundingRate")?;

        let mut rates: HashMap<String, Funding> = HashMap::with_capacity(funding.len());
        for row in funding {
            rates.insert(row.symbol.clone(), row);
        }

        // A contract missing from either reply has no complete row, and the poller logs it as missing.
        let mut rows = AnchorMap::with_capacity(tickers.len());
        for ticker in tickers {
            if FROZEN_INDEX.contains(&ticker.symbol.as_str()) {
                continue;
            }
            let Some(rate) = rates.get(&ticker.symbol) else {
                continue;
            };
            rows.insert(
                ticker.symbol,
                AnchorRow {
                    index: ticker.index_price,
                    mark: ticker.fair_price,
                    funding_rate: rate.funding_rate,
                    funding_interval_hours: rate.cycle,
                    next_funding_at: rate.next_settle_ts as i64,
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

// An error arrives inside an HTTP 200 with success false.
#[derive(Deserialize)]
struct Reply<T> {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    code: i64,
    #[serde(default)]
    message: String,
    #[serde(default = "Vec::new")] // a plain default would ask T for Default
    data: Vec<T>,
}

impl<T> Reply<T> {
    fn rows(self, call: &str) -> anyhow::Result<Vec<T>> {
        if !self.success || self.code != 0 {
            anyhow::bail!("{call} code {}: {}", self.code, self.message);
        }
        Ok(self.data)
    }
}

// Every number is a JSON number.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ticker {
    #[serde(default)]
    symbol: String, // "BTC_USDT"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    fair_price: f64, // the mark
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Funding {
    #[serde(default)]
    symbol: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // a fraction per interval, for the upcoming settlement
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    cycle: f64, // hours: 8, and 4 or 1 on a few contracts
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_settle_ts: f64, // Unix ms
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::feeds::anchor_poller::RateLimited;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    const T0: i64 = 1_791_574_615_110;

    // Rows captured live on 2026-10-09 at 19:36 UTC, with the ticker fields the poller ignores trimmed.
    // NEW_USDT is made up, a contract the ticker lists and the funding call does not.
    fn ticker(symbol: &str, index: f64, fair: f64, rate: f64, ts: i64) -> Value {
        json!({
            "contractId": 10, "symbol": symbol, "bid1": fair, "ask1": fair, "volume24": 449696349, "holdVol": 23477283,
            "indexPrice": index, "fairPrice": fair, "fundingRate": rate, "curPrice": fair, "ts": ts,
        })
    }

    fn funding(symbol: &str, rate: f64, cycle: i64, next: i64) -> Value {
        json!({ "symbol": symbol, "fundingRate": rate, "timestamp": 1791574615110_i64, "cycle": cycle, "nextSettleTs": next })
    }

    // The BTC ticker's rate is changed from the captured 0.00000735, so a case can tell which call the rate came from.
    fn tickers() -> Value {
        json!({ "success": true, "code": 0, "data": [
            ticker("BTC_USDT", 82414.8, 82372.0, 0.00009, 1791574613075),
            ticker("ONG_USDT", 0.08728, 0.08735, 0.00005521, 1791574613340),
            ticker("ICP_USDT", 2.944, 2.993, 0.00010593, 1791574613140),
            ticker("NEW_USDT", 1.0, 1.0, 0.0, 1791574613340),
        ]})
    }

    fn rates() -> Value {
        json!({ "success": true, "code": 0, "data": [
            funding("BTC_USDT", 0.00000735, 8, 1791590400000),
            funding("ONG_USDT", 0.00005521, 1, 1791576000000),
            funding("ICP_USDT", 0.00010593, 8, 1791590400000),
        ]})
    }

    async fn poll(tickers: Value, rates: Value) -> (MockRest, anyhow::Result<AnchorMap>) {
        let rest = MockRest::start().await;
        rest.reply(TICKER_PATH, tickers);
        rest.reply(FUNDING_PATH, rates);
        let rows = Biconomy::with_rest(&rest.url).fetch_round(&http(), T0).await;
        (rest, rows)
    }

    #[test]
    fn polls_every_two_seconds_and_pauses_ten_seconds_on_a_rate_limit() {
        let venue = Biconomy::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(2));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(10));
    }

    #[tokio::test]
    async fn takes_index_and_mark_from_the_ticker_and_the_rate_interval_and_settlement_from_the_funding_call() {
        let (rest, rows) = poll(tickers(), rates()).await;
        let rows = rows.unwrap();

        let mut calls = rest.calls();
        calls.sort();
        assert_eq!(calls, [FUNDING_PATH, TICKER_PATH]);
        assert_eq!(
            rows["BTC_USDT"],
            AnchorRow {
                index: 82414.8,
                mark: 82372.0,
                funding_rate: 0.00000735,
                funding_interval_hours: 8.0,
                next_funding_at: 1791590400000,
                ts: None,
            }
        );
        assert_eq!(rows["ONG_USDT"].funding_interval_hours, 1.0);
        assert_eq!(rows["ONG_USDT"].next_funding_at, 1791576000000);
    }

    #[tokio::test]
    async fn leaves_out_the_frozen_icp_index_and_a_contract_without_a_funding_row() {
        let (_rest, rows) = poll(tickers(), rates()).await;
        let rows = rows.unwrap();

        assert!(!rows.contains_key("ICP_USDT"));
        assert!(!rows.contains_key("NEW_USDT"));
        assert_eq!(rows.len(), 2);
    }

    #[tokio::test]
    async fn fails_the_round_on_a_reply_whose_success_is_false() {
        let failing = json!({ "success": false, "code": 1001, "message": "Contract does not exist!" });

        let (_rest, rows) = poll(tickers(), failing.clone()).await;
        let error = rows.unwrap_err();
        assert!(error.to_string().contains("allFundingRate code 1001: Contract does not exist!"), "{error:#}");

        let (_rest, rows) = poll(failing, rates()).await;
        assert!(rows.unwrap_err().to_string().contains("ticker/list code 1001"));
    }

    #[tokio::test]
    async fn reads_a_429_on_either_call_as_a_rate_limit() {
        let rest = MockRest::start().await;
        rest.reply(TICKER_PATH, tickers());
        rest.fail(FUNDING_PATH, 429);

        let error = Biconomy::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");
    }
}
