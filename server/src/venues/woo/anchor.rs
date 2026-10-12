use super::Woo;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::time::Duration;

// Index, mark, the upcoming rate and the next settlement for every perpetual.
pub const FUTURES_PATH: &str = "/v3/public/futures";

// The interval of the upcoming settlement, 4 or 8 hours, which the futures call lacks.
pub const FUNDING_PATH: &str = "/v3/public/fundingRate";

// A next settlement this far in the past is a frozen estimator, as BNB's was 42 h behind on 2026-10-08, so the row is left out.
// A younger one is the settlement that just passed, which the venue has not rolled yet, so it reads as unknown.
const FROZEN_FUNDING_AFTER_MS: i64 = 10 * 60 * 1000;

impl AnchorVenue for Woo {
    // Each call allows 10 requests a second per IP and documents no Retry-After, so a pause of one window is enough.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(1)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let futures_url = format!("{}{FUTURES_PATH}", self.rest);
        let funding_url = format!("{}{FUNDING_PATH}", self.rest);
        let (futures, funding) = tokio::try_join!(
            rows::<Future>(http, &futures_url),
            rows::<Funding>(http, &funding_url),
        )?;

        let mut intervals = HashMap::with_capacity(funding.len());
        for row in funding {
            intervals.insert(row.symbol, row.est_funding_interval_hours);
        }

        let mut anchors = AnchorMap::with_capacity(futures.len());
        for row in futures {
            // SOLV had a null index on 2026-09-23 and again on 2026-10-08.
            if !row.index_price.is_finite() {
                continue;
            }
            let Some(&interval) = intervals.get(&row.symbol) else {
                continue;
            };
            // A missing next settlement casts to 0, which the engine accepts as unknown.
            let next_funding_at = row.next_funding_time as i64;
            if row.next_funding_time.is_finite() && next_funding_at < ts - FROZEN_FUNDING_AFTER_MS {
                continue;
            }

            anchors.insert(
                row.symbol,
                AnchorRow {
                    index: row.index_price,
                    mark: row.mark_price,
                    funding_rate: row.est_funding_rate,
                    funding_interval_hours: interval,
                    next_funding_at: if next_funding_at < ts { 0 } else { next_funding_at },
                    ts: None,
                },
            );
        }

        Ok(anchors)
    }
}

// A gateway failure can arrive as HTTP 200 with success false or a bare code, so success is checked.
async fn rows<T: DeserializeOwned>(http: &reqwest::Client, url: &str) -> anyhow::Result<Vec<T>> {
    let reply: Reply<T> = get_json(http, url).await?;
    if !reply.success {
        anyhow::bail!("success false from {url}: {}", reply.message.unwrap_or_default());
    }
    Ok(reply.data.map(|data| data.rows).unwrap_or_default())
}

#[derive(Deserialize)]
struct Reply<T> {
    #[serde(default)]
    success: bool,
    message: Option<String>,
    data: Option<Rows<T>>,
}

#[derive(Deserialize)]
struct Rows<T> {
    rows: Vec<T>,
}

#[derive(Deserialize)]
struct Future {
    #[serde(default)]
    symbol: String, // "PERP_BTC_USDT", the socket's id
    #[serde(rename = "indexPrice", default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64, // null on SOLV
    #[serde(rename = "markPrice", default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
    // the upcoming rate, a fraction per interval re-estimated each minute
    #[serde(rename = "estFundingRate", default = "wire::nan", deserialize_with = "wire::num")]
    est_funding_rate: f64,
    #[serde(rename = "nextFundingTime", default = "wire::nan", deserialize_with = "wire::num")]
    next_funding_time: f64, // Unix ms
}

#[derive(Deserialize)]
struct Funding {
    #[serde(default)]
    symbol: String,
    #[serde(rename = "estFundingIntervalHours", default = "wire::nan", deserialize_with = "wire::num")]
    est_funding_interval_hours: f64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    const T0: i64 = 1_791_514_003_215; // 2026-10-08 19:46 UTC, when the rows below were read

    // Rows captured live on 2026-10-08.
    fn btc_future() -> Value {
        json!({
            "symbol": "PERP_BTC_USDT", "indexPrice": "82033", "markPrice": "82005", "estFundingRate": "0.00004845",
            "lastFundingRate": "0.00001792", "openInterest": "217.27864", "24hOpen": "83239", "24hClose": "82005",
            "24hHigh": "83289", "24hLow": "80358", "24hVolume": "156.02023", "24hAmount": "12768881", "nextFundingTime": 1791532800000_i64,
        })
    }

    fn pixel_future() -> Value {
        json!({
            "symbol": "PERP_PIXEL_USDT", "indexPrice": "0.00576", "markPrice": "0.00576", "estFundingRate": "0.00005",
            "lastFundingRate": "0.00005", "openInterest": "702632", "24hOpen": "0.00581", "24hClose": "0.00578",
            "24hHigh": "0.00599", "24hLow": "0.00525", "24hVolume": "0", "24hAmount": "0", "nextFundingTime": 1791518400000_i64,
        })
    }

    fn solv_future() -> Value {
        json!({
            "symbol": "PERP_SOLV_USDT", "indexPrice": null, "markPrice": "0.00385", "estFundingRate": "0.00005",
            "lastFundingRate": "0.00005", "openInterest": "0", "24hVolume": "0", "nextFundingTime": 1791518400000_i64,
        })
    }

    fn bnb_future() -> Value {
        json!({
            "symbol": "PERP_BNB_USDT", "indexPrice": "738.3", "markPrice": "738.2", "estFundingRate": "0.00000043",
            "lastFundingRate": "0.00000561", "nextFundingTime": 1791360000000_i64,
        })
    }

    fn funding(symbol: &str, hours: u32, next: i64) -> Value {
        json!({
            "symbol": symbol, "estFundingRate": "0.00005", "estFundingRateTimestamp": 1791513959001_i64, "lastFundingRate": "0.00005",
            "lastFundingRateTimestamp": 1791504000000_i64, "nextFundingTime": next, "lastFundingIntervalHours": hours,
            "estFundingIntervalHours": hours,
        })
    }

    fn reply(rows: Value) -> Value {
        json!({ "success": true, "data": { "rows": rows }, "timestamp": T0 })
    }

    async fn poll(rest: &MockRest, ts: i64) -> anyhow::Result<AnchorMap> {
        Woo::with_rest(&rest.url).fetch_round(&http(), ts).await
    }

    fn all_funding() -> Value {
        reply(json!([
            funding("PERP_BTC_USDT", 8, 1791532800000),
            funding("PERP_PIXEL_USDT", 4, 1791518400000),
            funding("PERP_SOLV_USDT", 4, 1791518400000),
            funding("PERP_BNB_USDT", 8, 1791360000000),
        ]))
    }

    #[test]
    fn polls_every_second_and_pauses_one_second_on_a_rate_limit() {
        let venue = Woo::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(1));
    }

    #[tokio::test]
    async fn joins_the_futures_row_with_the_interval_of_the_funding_call() {
        let rest = MockRest::start().await;
        rest.reply(FUTURES_PATH, reply(json!([btc_future(), pixel_future()])));
        rest.reply(FUNDING_PATH, all_funding());

        let rows = poll(&rest, T0).await.unwrap();

        let mut calls = rest.calls();
        calls.sort();
        assert_eq!(calls, [FUNDING_PATH, FUTURES_PATH]);
        assert_eq!(
            rows["PERP_BTC_USDT"],
            AnchorRow {
                index: 82033.0,
                mark: 82005.0,
                funding_rate: 0.00004845,
                funding_interval_hours: 8.0,
                next_funding_at: 1791532800000,
                ts: None,
            }
        );
        assert_eq!(rows["PERP_PIXEL_USDT"].funding_interval_hours, 4.0);
    }

    #[tokio::test]
    async fn leaves_out_a_null_index_and_a_symbol_the_funding_call_lacks() {
        let rest = MockRest::start().await;
        let mut lone = btc_future();
        lone["symbol"] = json!("PERP_LONE_USDT");
        rest.reply(FUTURES_PATH, reply(json!([solv_future(), lone, btc_future()])));
        rest.reply(FUNDING_PATH, all_funding());

        let rows = poll(&rest, T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["PERP_BTC_USDT"]);
    }

    #[tokio::test]
    async fn leaves_out_a_frozen_estimator_and_reads_a_settlement_just_passed_as_unknown() {
        let rest = MockRest::start().await;
        rest.reply(FUTURES_PATH, reply(json!([bnb_future(), pixel_future()])));
        rest.reply(FUNDING_PATH, all_funding());

        // PIXEL's 1791518400000 settlement, five minutes after it passed.
        let rows = poll(&rest, 1791518400000 + 5 * 60 * 1000).await.unwrap();

        assert!(!rows.contains_key("PERP_BNB_USDT"));
        assert_eq!(rows["PERP_PIXEL_USDT"].next_funding_at, 0);
        assert_eq!(rows["PERP_PIXEL_USDT"].funding_rate, 0.00005);
    }

    #[tokio::test]
    async fn sends_a_missing_next_settlement_as_unknown() {
        let rest = MockRest::start().await;
        let mut btc = btc_future();
        btc["nextFundingTime"] = Value::Null;
        rest.reply(FUTURES_PATH, reply(json!([btc])));
        rest.reply(FUNDING_PATH, all_funding());

        let rows = poll(&rest, T0).await.unwrap();

        assert_eq!(rows["PERP_BTC_USDT"].next_funding_at, 0);
    }

    #[tokio::test]
    async fn fails_a_round_whose_reply_answers_success_false() {
        let rest = MockRest::start().await;
        rest.reply(FUTURES_PATH, reply(json!([btc_future()])));
        rest.reply(FUNDING_PATH, json!({ "success": false, "message": "busy" }));

        let error = poll(&rest, T0).await.unwrap_err();

        assert!(format!("{error:#}").contains("busy"));
    }

    #[tokio::test]
    async fn fails_a_round_whose_reply_is_a_gateway_error_in_a_200() {
        let rest = MockRest::start().await;
        rest.reply(FUTURES_PATH, json!({ "code": 503, "message": "[GW] no upstream server" }));
        rest.reply(FUNDING_PATH, all_funding());

        let error = poll(&rest, T0).await.unwrap_err();

        assert!(format!("{error:#}").contains("no upstream server"));
    }

    #[tokio::test]
    async fn fails_a_round_when_either_call_fails() {
        let rest = MockRest::start().await;
        rest.reply(FUTURES_PATH, reply(json!([btc_future()])));
        rest.fail(FUNDING_PATH, 500);

        assert!(poll(&rest, T0).await.is_err());
    }
}
