use super::Pacifica;
use super::markets::Reply;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::time::Duration;

// One uncached call carries the oracle, the mark and the funding of every market, republished every 3 s.
pub const PRICES_PATH: &str = "/api/v1/info/prices";

// Funding settles every hour on the hour on every market, and no field names the interval or the next settlement.
const FUNDING_INTERVAL_HOURS: f64 = 1.0;
const HOUR_MS: i64 = 3_600_000;

impl AnchorVenue for Pacifica {
    // The default 1 s poll reads each 3 s republish within about a second, and spends 60 of the 100 credits an IP gets a minute.
    // A 429 is documented without a Retry-After, and the window is a rolling minute.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(60)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let reply: Reply<Vec<Price>> = get_json(http, &format!("{}{PRICES_PATH}", self.rest)).await?;
        let prices = reply.into_data(PRICES_PATH)?;

        // The floor plus one keeps a poll that lands on the hour pointing at the next settlement, which lands about 2 s after it.
        let next_funding_at = (ts.div_euclid(HOUR_MS) + 1) * HOUR_MS;
        let mut rows = AnchorMap::with_capacity(prices.len());

        // The spot pair SOL-USDC has a row too, with its own price as oracle and mark, and the poller never reads it, since the loader keeps no spot market.
        for price in prices {
            rows.insert(
                price.symbol,
                AnchorRow {
                    index: price.oracle,
                    mark: price.mark,
                    funding_rate: price.funding,
                    funding_interval_hours: FUNDING_INTERVAL_HOURS,
                    next_funding_at,
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

#[derive(Deserialize)]
struct Price {
    #[serde(default)]
    symbol: String, // "BTC" or "kPEPE", the catalog's spelling
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    oracle: f64, // Pacifica's own weighted average of other venues' prices, recomputed every 3 s
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark: f64, // the median of the oracle, Pacifica's own touch and last trade, and other venues' perpetual marks
    // The rate fixed an hour ahead and settled at the next whole hour, as the history chain and CCXT read it, a fraction per hour.
    // The prices docs call it the rate of the hour just paid, and next_funding is the running estimate for the settlement after.
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding: f64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    // 22:45:10 UTC on 2026-10-12, so the next settlement is 23:00.
    const T0: i64 = 1_791_845_110_000;
    const NEXT_HOUR: i64 = 1_791_846_000_000;

    // Rows of GET /api/v1/info/prices captured live on 2026-10-12 at 22:45 UTC, cut to four of 78.
    fn prices() -> Value {
        json!([
            { "funding": "0.0000125", "mark": "82579", "mid": "82579.5", "next_funding": "0.0000125", "open_interest": "600.51613", "oracle": "82583.7426",
              "symbol": "BTC", "timestamp": 1791845109317_i64, "volume_24h": "349344713.44084", "yesterday_price": "83664" },
            { "funding": "0.0000125", "mark": "0.003991", "mid": "0.00399", "next_funding": "0.0000125", "open_interest": "7244390", "oracle": "0.003993",
              "symbol": "kPEPE", "timestamp": 1791845109317_i64, "volume_24h": "25094.357524", "yesterday_price": "0.004203" },
            { "funding": "-0.00004446", "mark": "4172.543793", "mid": "4171.45", "next_funding": "0.00000591", "open_interest": "349.823", "oracle": "4172.543793",
              "symbol": "XAU", "timestamp": 1791845109317_i64, "volume_24h": "524731.28476", "yesterday_price": "4185.1" },
            { "funding": "0", "mark": "106.8524", "mid": "106.85", "next_funding": "0", "open_interest": "0", "oracle": "106.8524",
              "symbol": "SOL-USDC", "timestamp": 1791845109317_i64, "volume_24h": "119721.36554", "yesterday_price": "110.89" },
        ])
    }

    fn reply(rows: Value) -> Value {
        json!({ "success": true, "data": rows, "error": null, "code": null })
    }

    async fn poll(rest: &MockRest, ts: i64) -> anyhow::Result<AnchorMap> {
        Pacifica::with_rest(&rest.url).fetch_round(&http(), ts).await
    }

    #[test]
    fn polls_every_second_and_pauses_a_minute_on_a_rate_limit() {
        let venue = Pacifica::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(60));
    }

    #[tokio::test]
    async fn maps_the_oracle_to_the_index_with_an_hourly_interval_and_the_next_whole_hour() {
        let rest = MockRest::start().await;
        rest.reply(PRICES_PATH, reply(prices()));

        let rows = poll(&rest, T0).await.unwrap();

        assert_eq!(rest.calls(), [PRICES_PATH]);
        assert_eq!(
            rows["BTC"],
            AnchorRow {
                index: 82583.7426,
                mark: 82579.0,
                funding_rate: 0.0000125,
                funding_interval_hours: 1.0,
                next_funding_at: NEXT_HOUR,
                ts: None,
            }
        );
        assert_eq!((rows["kPEPE"].index, rows["kPEPE"].mark), (0.003993, 0.003991));
        assert_eq!(rows["XAU"].funding_rate, -0.00004446);
    }

    #[tokio::test]
    async fn a_poll_on_the_hour_points_at_the_next_hour() {
        let rest = MockRest::start().await;
        rest.reply(PRICES_PATH, reply(prices()));

        let on_the_hour = poll(&rest, NEXT_HOUR).await.unwrap();
        let just_before = poll(&rest, NEXT_HOUR - 1).await.unwrap();

        assert_eq!(on_the_hour["BTC"].next_funding_at, NEXT_HOUR + HOUR_MS);
        assert_eq!(just_before["BTC"].next_funding_at, NEXT_HOUR);
    }

    #[tokio::test]
    async fn a_null_oracle_reads_as_nan_so_the_poller_counts_the_row_missing() {
        let rest = MockRest::start().await;
        let mut rows = prices();
        rows[0]["oracle"] = Value::Null;
        rows[0].as_object_mut().unwrap().remove("mark");
        rest.reply(PRICES_PATH, reply(rows));

        let rows = poll(&rest, T0).await.unwrap();

        assert!(rows["BTC"].index.is_nan());
        assert!(rows["BTC"].mark.is_nan());
    }

    #[tokio::test]
    async fn a_refused_or_failed_call_fails_the_round() {
        let rest = MockRest::start().await;
        rest.reply(PRICES_PATH, json!({ "success": false, "data": null, "error": "Not found", "code": 404 }));
        assert!(poll(&rest, T0).await.is_err());

        rest.fail(PRICES_PATH, 500);
        assert!(poll(&rest, T0).await.is_err());
    }

    #[tokio::test]
    async fn a_rate_limit_status_reaches_the_poller_as_rate_limited() {
        let rest = MockRest::start().await;
        rest.fail(PRICES_PATH, 429);

        let error = poll(&rest, T0).await.unwrap_err();

        assert!(error.downcast_ref::<crate::feeds::anchor_poller::RateLimited>().is_some(), "{error:#}");
    }
}
