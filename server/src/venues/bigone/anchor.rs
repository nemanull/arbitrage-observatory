use super::BigOne;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::time::Duration;

// One call returns index, mark, rate, interval and next settlement for every enabled contract of both families.
// The limit is 500 requests per 10 s per IP, so the default one second cadence uses a fiftieth of it.
pub const INSTRUMENTS_PATH: &str = "/api/contract/v2/instruments";

const MINUTES_PER_HOUR: f64 = 60.0;

// The settlement frequency of docs/profiles/bigone/rest.md section 3, for a row that ever comes without fundingIntervalMinutes.
// The table is the venue's own field as it read on 2026-10-09, which the 2026-09-02 announcement left incomplete.
const DEFAULT_INTERVAL_HOURS: f64 = 8.0;
const ONE_HOUR: &[&str] = &["SKRUSDT"];
const FOUR_HOURS: &[&str] = &[
    "ORDIUSDT", "TRUMPUSDT", "AUSDT", "WLFIUSDT", "ENAUSDT", "AVNTUSDT", "PUMPUSDT", "ASTERUSDT", "HYPEUSDT", "GIGGLEUSDT",
    "PAXGUSDT", "MERLUSDT", "MONUSDT", "BREVUSDT", "ELSAUSDT", "XAUUSDT", "XAGUSDT", "CLUSDT", "ARXUSDT", "REUSDT",
    "SAMSUNGUSDT", "ZHIPUUSDT", "BZUSDT", "NATGASUSDT", "CXMTUSDT", "UNITREEUSDT", "PONSUSDT", "HAJIMIUSDT", "NIULAIUSDT",
];

impl AnchorVenue for BigOne {
    // Errors are bare statuses with no Retry-After, so a pause of one window is enough.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let instruments: Vec<Instrument> = get_json(http, &format!("{}{INSTRUMENTS_PATH}", self.rest)).await?;

        // No index basket is published, so no row can be told apart as a self index.
        let mut rows = AnchorMap::with_capacity(instruments.len());
        for row in instruments {
            let interval = if row.funding_interval_minutes > 0.0 {
                row.funding_interval_minutes / MINUTES_PER_HOUR
            } else {
                interval_hours(&row.symbol)
            };

            rows.insert(
                row.symbol,
                AnchorRow {
                    index: row.index_price,
                    mark: row.mark_price,
                    funding_rate: row.funding_rate,
                    funding_interval_hours: interval,
                    next_funding_at: next_settlement(row.next_funding_time),
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

fn interval_hours(symbol: &str) -> f64 {
    if ONE_HOUR.contains(&symbol) {
        1.0
    } else if FOUR_HOURS.contains(&symbol) {
        4.0
    } else {
        DEFAULT_INTERVAL_HOURS
    }
}

fn next_settlement(ms: f64) -> i64 {
    if ms.is_finite() && ms > 0.0 { ms as i64 } else { 0 }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Instrument {
    #[serde(default)]
    symbol: String, // "BTCUSDT", the socket's id
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64, // the index plus the funding basis, rounded to the contract's price precision
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // a fraction per interval, fixed for the interval and charged at nextFundingTime, not nextFundingRate
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_interval_minutes: f64, // 480, 240 or 60, a field no profile listed before 2026-10-09
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_funding_time: f64, // Unix ms
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::feeds::anchor_poller::RateLimited;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    const T0: i64 = 1_791_570_363_000;

    // Rows captured live on 2026-10-09 at 18:26 UTC, one per funding interval and one inverse, with a few of the fields the poller ignores.
    fn btc_row() -> Value {
        json!({
            "openInterestLong": 8389.0, "usdtPrice": 0.99915332, "symbol": "BTCUSDT", "nextFundingRate": 0.0001,
            "fundingRate": 0.0001, "latestPrice": 82500.1, "indexPrice": 82557.98, "nextFundingTime": 1791590400000_i64,
            "markPrice": 82563.72, "fundingIntervalMinutes": 480, "openInterest": 16778.0,
        })
    }

    fn hype_row() -> Value {
        json!({
            "symbol": "HYPEUSDT", "nextFundingRate": 0.0002317, "fundingRate": 0.0002359, "latestPrice": 84.47,
            "indexPrice": 84.49, "nextFundingTime": 1791576000000_i64, "markPrice": 84.4978, "fundingIntervalMinutes": 240,
        })
    }

    fn skr_row() -> Value {
        json!({
            "symbol": "SKRUSDT", "nextFundingRate": 1.25e-05, "fundingRate": 5e-05, "latestPrice": 0.01666,
            "indexPrice": 0.01662, "nextFundingTime": 1791572400000_i64, "markPrice": 0.01662, "fundingIntervalMinutes": 60,
        })
    }

    fn btc_usd_row() -> Value {
        json!({
            "symbol": "BTCUSD", "nextFundingRate": 0.0002353, "fundingRate": 0.0002746, "latestPrice": 82460.3,
            "indexPrice": 82488.08, "nextFundingTime": 1791590400000_i64, "markPrice": 82503.84, "fundingIntervalMinutes": 480,
        })
    }

    // The rows of the 2026-09-23 survey, which carried no fundingIntervalMinutes.
    fn without_interval(mut row: Value) -> Value {
        row.as_object_mut().unwrap().remove("fundingIntervalMinutes");
        row
    }

    async fn poll(body: Value) -> (MockRest, AnchorMap) {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, body);
        let rows = BigOne::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();
        (rest, rows)
    }

    #[test]
    fn polls_every_second_and_pauses_for_one_ten_second_window_on_a_rate_limit() {
        let venue = BigOne::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(10));
    }

    #[tokio::test]
    async fn maps_every_row_of_the_one_call_with_the_fixed_rate_and_the_interval_in_hours() {
        let (rest, rows) = poll(json!([btc_row(), hype_row(), skr_row(), btc_usd_row()])).await;

        assert_eq!(rest.calls(), [INSTRUMENTS_PATH]);
        assert_eq!(
            rows["BTCUSDT"],
            AnchorRow {
                index: 82557.98,
                mark: 82563.72,
                funding_rate: 0.0001,
                funding_interval_hours: 8.0,
                next_funding_at: 1791590400000,
                ts: None,
            }
        );
        assert_eq!(rows["HYPEUSDT"].funding_rate, 0.0002359);
        assert_eq!(rows["HYPEUSDT"].funding_interval_hours, 4.0);
        assert_eq!(rows["SKRUSDT"].funding_interval_hours, 1.0);
        assert_eq!(rows["SKRUSDT"].next_funding_at, 1791572400000);
        assert_eq!(rows.len(), 4); // the inverse row is read too, and the poller skips it as untracked
    }

    #[tokio::test]
    async fn falls_back_to_the_profile_table_when_a_row_has_no_interval() {
        let (_rest, rows) = poll(json!([
            without_interval(btc_row()),
            without_interval(hype_row()),
            without_interval(skr_row()),
        ]))
        .await;

        assert_eq!(rows["BTCUSDT"].funding_interval_hours, 8.0);
        assert_eq!(rows["HYPEUSDT"].funding_interval_hours, 4.0);
        assert_eq!(rows["SKRUSDT"].funding_interval_hours, 1.0);
    }

    #[tokio::test]
    async fn reads_a_missing_next_funding_time_as_unknown() {
        let mut row = btc_row();
        row["nextFundingTime"] = Value::Null;

        let (_rest, rows) = poll(json!([row])).await;

        assert_eq!(rows["BTCUSDT"].next_funding_at, 0);
    }

    #[tokio::test]
    async fn reads_a_429_as_a_rate_limit_and_fails_on_any_other_status() {
        let rest = MockRest::start().await;
        rest.fail(INSTRUMENTS_PATH, 429);
        let error = BigOne::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();
        assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");

        let failing = MockRest::start().await;
        failing.fail(INSTRUMENTS_PATH, 404);
        let error = BigOne::with_rest(&failing.url).fetch_round(&http(), T0).await.unwrap_err();
        assert!(error.downcast_ref::<RateLimited>().is_none(), "{error:#}");
    }
}
