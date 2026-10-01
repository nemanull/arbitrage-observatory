use super::{Binance, ID};
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::HashMap;

// USD-M and COIN-M publish the same shape on two hosts, and one call without a symbol returns every contract.
const PREMIUM_PATH_USD_M: &str = "/fapi/v1/premiumIndex";
const PREMIUM_PATH_COIN_M: &str = "/dapi/v1/premiumIndex";

// The interval per symbol lives in a separate call, and COIN-M answers it with an empty array, so COIN-M keeps the documented default.
const FUNDING_INFO_PATH: &str = "/fapi/v1/fundingInfo";
const DEFAULT_INTERVAL_HOURS: f64 = 8.0;

// Intervals change on a schedule the venue announces, which SOPH did on 2026-09-08, so the table is reread every hour.
const FUNDING_INFO_REFRESH_MS: i64 = 60 * 60 * 1000;

#[derive(Default)]
pub struct Intervals {
    hours: HashMap<String, f64>, // by symbol
    read_at: i64,                // Unix ms, 0 = never, so the first round reads the table
}

impl AnchorVenue for Binance {
    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let due = ts - self.intervals.lock().unwrap().read_at >= FUNDING_INFO_REFRESH_MS;

        // A failure here fails the round and leaves read_at alone, so the next round tries again.
        if due {
            let url = format!("{}{FUNDING_INFO_PATH}", self.usd_m_rest);
            let info: Vec<FundingInfo> = get_json(http, &url).await?;
            let mut intervals = self.intervals.lock().unwrap();
            intervals.hours.clear();
            for row in info {
                intervals.hours.insert(row.symbol, row.funding_interval_hours);
            }
            intervals.read_at = ts;
            tracing::info!(event = "funding_intervals_read", venue = ID, symbols = intervals.hours.len());
        }

        let usd_m_url = format!("{}{PREMIUM_PATH_USD_M}", self.usd_m_rest);
        let coin_m_url = format!("{}{PREMIUM_PATH_COIN_M}", self.coin_m_rest);
        let (usd_m, coin_m) = tokio::try_join!(
            premium(http, self.has_linear, &usd_m_url),
            premium(http, self.has_inverse, &coin_m_url),
        )?;

        let intervals = self.intervals.lock().unwrap();
        let mut rows = AnchorMap::with_capacity(usd_m.len() + coin_m.len());
        for row in usd_m.into_iter().chain(coin_m) {
            let interval = intervals.hours.get(&row.symbol).copied().unwrap_or(DEFAULT_INTERVAL_HOURS);
            rows.insert(
                row.symbol,
                AnchorRow {
                    index: row.index_price,
                    mark: row.mark_price,
                    funding_rate: row.last_funding_rate,
                    funding_interval_hours: interval,
                    next_funding_at: row.next_funding_time as i64,
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

async fn premium(http: &reqwest::Client, tracked: bool, url: &str) -> anyhow::Result<Vec<PremiumIndex>> {
    if !tracked {
        return Ok(Vec::new());
    }
    get_json(http, url).await
}

// One row of premiumIndex without a symbol, which lists every contract on the host including the dated ones.
#[derive(Deserialize)]
struct PremiumIndex {
    #[serde(default)]
    symbol: String,
    #[serde(rename = "markPrice", default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
    #[serde(rename = "indexPrice", default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    // the rate for the upcoming settlement despite the name, as a fraction
    #[serde(rename = "lastFundingRate", default = "wire::nan", deserialize_with = "wire::num")]
    last_funding_rate: f64,
    #[serde(rename = "nextFundingTime", default = "wire::nan", deserialize_with = "wire::num")]
    next_funding_time: f64, // Unix ms
}

// One row of fundingInfo, which listed every trading perpetual on 2026-09-10 and none of the settling ones.
#[derive(Deserialize)]
struct FundingInfo {
    symbol: String,
    #[serde(rename = "fundingIntervalHours", deserialize_with = "wire::num")]
    funding_interval_hours: f64,
}

#[cfg(test)]
mod tests {
    // Ported case for case from old_ts_server/src/venues/binance/anchor.spec.ts.

    use super::*;
    use crate::venues::testing::{MockRest, http, market, tracked};
    use serde_json::{Value, json};

    const T0: i64 = 1_789_015_935_000;

    // Shapes captured live on 2026-09-10.
    fn soph_premium() -> Value {
        json!({
            "symbol": "SOPHUSDT",
            "markPrice": "0.00412731",
            "indexPrice": "0.00414811",
            "estimatedSettlePrice": "0.00424294",
            "lastFundingRate": "-0.00030909",
            "interestRate": "0.00010000",
            "nextFundingTime": 1789016400000_i64,
            "time": 1789015935000_i64,
        })
    }

    fn btc_premium() -> Value {
        let mut row = soph_premium();
        row["symbol"] = json!("BTCUSDT");
        row["markPrice"] = json!("79150.26");
        row["indexPrice"] = json!("79182.32");
        row["lastFundingRate"] = json!("0.00010000");
        row["nextFundingTime"] = json!(1789027200000_i64);
        row
    }

    fn aave_coin_m() -> Value {
        json!({
            "symbol": "AAVEUSD_PERP",
            "pair": "AAVEUSD",
            "markPrice": "124.26148470",
            "indexPrice": "124.37839774",
            "estimatedSettlePrice": "124.62477498",
            "lastFundingRate": "0.00001125",
            "interestRate": "0.00010000",
            "nextFundingTime": 1789027200000_i64,
            "time": 1789022136000_i64,
        })
    }

    fn soph_funding_info() -> Value {
        json!({
            "symbol": "SOPHUSDT",
            "adjustedFundingRateCap": "0.02000000",
            "adjustedFundingRateFloor": "-0.02000000",
            "fundingIntervalHours": 1,
            "disclaimer": false,
            "updateTime": 1788868860638_i64,
        })
    }

    fn poller(rest: &MockRest, linear: &[&str], inverse: &[&str]) -> Binance {
        let mut markets = Vec::new();
        for id in linear {
            markets.push(market(ID, id, &id[..3], "USDT", true));
        }
        for id in inverse {
            markets.push(market(ID, id, &id[..3], "USD", false));
        }
        Binance::with_rest(&tracked(&markets), &rest.url, &rest.url)
    }

    fn row(index: f64, mark: f64, funding_rate: f64, funding_interval_hours: f64, next_funding_at: i64) -> AnchorRow {
        AnchorRow {
            index,
            mark,
            funding_rate,
            funding_interval_hours,
            next_funding_at,
            ts: None,
        }
    }

    #[tokio::test]
    async fn maps_a_premium_index_row_and_takes_the_interval_from_funding_info() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_INFO_PATH, json!([soph_funding_info()]));
        rest.reply(PREMIUM_PATH_USD_M, json!([soph_premium(), btc_premium()]));

        let rows = poller(&rest, &["SOPHUSDT", "BTCUSDT"], &[]).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows["SOPHUSDT"], row(0.00414811, 0.00412731, -0.00030909, 1.0, 1789016400000));
    }

    #[tokio::test]
    async fn gives_a_symbol_absent_from_funding_info_the_eight_hour_default() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_INFO_PATH, json!([soph_funding_info()]));
        rest.reply(PREMIUM_PATH_USD_M, json!([soph_premium(), btc_premium()]));

        let rows = poller(&rest, &["SOPHUSDT", "BTCUSDT"], &[]).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows["BTCUSDT"].funding_interval_hours, 8.0);
    }

    #[tokio::test]
    async fn reads_the_interval_table_on_the_first_round_and_then_once_an_hour() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_INFO_PATH, json!([]));
        rest.reply(PREMIUM_PATH_USD_M, json!([soph_premium()]));
        let venue = poller(&rest, &["SOPHUSDT"], &[]);

        venue.fetch_round(&http(), T0).await.unwrap();
        venue.fetch_round(&http(), T0 + 1_000).await.unwrap();
        venue.fetch_round(&http(), T0 + 60 * 60 * 1000).await.unwrap();

        assert_eq!(
            rest.calls(),
            [FUNDING_INFO_PATH, PREMIUM_PATH_USD_M, PREMIUM_PATH_USD_M, FUNDING_INFO_PATH, PREMIUM_PATH_USD_M]
        );
    }

    #[tokio::test]
    async fn retries_the_interval_table_on_the_next_round_after_it_fails() {
        let rest = MockRest::start().await;
        rest.reply(PREMIUM_PATH_USD_M, json!([soph_premium()]));
        let venue = poller(&rest, &["SOPHUSDT"], &[]);

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();
        assert!(error.to_string().contains("404"), "{error:#}");

        rest.reply(FUNDING_INFO_PATH, json!([]));
        let rows = venue.fetch_round(&http(), T0 + 1_000).await.unwrap();

        assert_eq!(rows["SOPHUSDT"].funding_interval_hours, 8.0);
    }

    #[tokio::test]
    async fn adds_the_coin_m_host_when_an_inverse_market_is_tracked_at_the_default_interval() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_INFO_PATH, json!([soph_funding_info()]));
        rest.reply(PREMIUM_PATH_USD_M, json!([soph_premium()]));
        rest.reply(PREMIUM_PATH_COIN_M, json!([aave_coin_m()]));

        let rows = poller(&rest, &["SOPHUSDT"], &["AAVEUSD_PERP"]).fetch_round(&http(), T0).await.unwrap();

        assert!(rest.calls().contains(&PREMIUM_PATH_COIN_M.to_string()));
        assert_eq!(rows["AAVEUSD_PERP"], row(124.37839774, 124.2614847, 0.00001125, 8.0, 1789027200000));
    }

    #[tokio::test]
    async fn asks_no_coin_m_host_when_no_inverse_market_is_tracked() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_INFO_PATH, json!([]));
        rest.reply(PREMIUM_PATH_USD_M, json!([soph_premium()]));

        poller(&rest, &["SOPHUSDT"], &[]).fetch_round(&http(), T0).await.unwrap();

        assert!(!rest.calls().contains(&PREMIUM_PATH_COIN_M.to_string()));
    }

    #[tokio::test]
    async fn carries_every_row_the_host_returns_tracked_or_not() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_INFO_PATH, json!([]));
        rest.reply(PREMIUM_PATH_USD_M, json!([soph_premium(), btc_premium()]));

        let rows = poller(&rest, &["SOPHUSDT"], &[]).fetch_round(&http(), T0).await.unwrap();

        let mut symbols: Vec<&String> = rows.keys().collect();
        symbols.sort();
        assert_eq!(symbols, ["BTCUSDT", "SOPHUSDT"]);
    }

    #[tokio::test]
    async fn fails_the_round_when_the_host_fails() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_INFO_PATH, json!([]));

        assert!(poller(&rest, &["SOPHUSDT"], &[]).fetch_round(&http(), T0).await.is_err());
    }
}
