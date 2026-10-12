use super::Hyperliquid;
use super::markets::{Meta, info};
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue};
use crate::venues::wire;
use serde::Deserialize;
use std::time::Duration;

// One call carries the oracle, the mark and the running funding estimate of every first dex asset.
// The contexts carry no name, so context i belongs to universe entry i of the meta in the same reply.
const CONTEXTS: &str = "metaAndAssetCtxs";

// Funding settles every hour on the hour, and neither the context nor any call names the next settlement.
// predictedFundings' nextFundingTime names the hour just settled, so it is not read.
const FUNDING_INTERVAL_HOURS: f64 = 1.0;
const HOUR_MS: i64 = 3_600_000;

impl AnchorVenue for Hyperliquid {
    // Validators republish the oracle and the mark about every 3 s, and a call weighs 20 of the 1,200 an IP may spend a minute.
    // So a 3 s poll spends 400 a minute and reads each republish once.
    fn poll_every(&self) -> Duration {
        Duration::from_secs(3)
    }

    // The budget is per minute, and no Retry-After or limit status is documented.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(60)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let (meta, contexts): (Meta, Vec<Context>) = info(http, &self.rest, CONTEXTS).await?;
        if contexts.len() != meta.universe.len() {
            anyhow::bail!("{} contexts for {} assets, so no context can be joined to its name", contexts.len(), meta.universe.len());
        }

        // The floor plus one keeps a poll that lands on the hour pointing at the next settlement, which lands 1 to 118 ms after it.
        let next_funding_at = (ts.div_euclid(HOUR_MS) + 1) * HOUR_MS;
        let mut rows = AnchorMap::with_capacity(contexts.len());

        for (asset, context) in meta.universe.into_iter().zip(contexts) {
            // A delisted asset keeps a frozen oracle and mark, which the poller would stamp as fresh.
            if asset.is_delisted {
                continue;
            }

            rows.insert(
                asset.name,
                AnchorRow {
                    index: context.oracle_px,
                    mark: context.mark_px,
                    funding_rate: context.funding,
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
#[serde(rename_all = "camelCase")]
struct Context {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    oracle_px: f64, // the validators' stake weighted median of spot mids on eight venues, published about every 3 s
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_px: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding: f64, // the running estimate for the coming hour, as a fraction per hour
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    const INFO_PATH: &str = "/info";

    // 05:31:54 UTC on 2026-10-09, which was 2026-10-08 on this host, so the next settlement is 06:00.
    const T0: i64 = 1_791_523_914_000;
    const NEXT_HOUR: i64 = 1_791_525_600_000;

    // POST /info {"type":"metaAndAssetCtxs"} captured live on 2026-10-08, cut to four of 234 assets with their contexts in the same order.
    fn reply() -> Value {
        json!([
            {
                "universe": [
                    { "szDecimals": 5, "name": "BTC", "maxLeverage": 40, "marginTableId": 56 },
                    { "szDecimals": 1, "name": "MATIC", "maxLeverage": 20, "marginTableId": 20, "isDelisted": true },
                    { "szDecimals": 0, "name": "kPEPE", "maxLeverage": 10, "marginTableId": 52 },
                    { "szDecimals": 0, "name": "HMSTR", "maxLeverage": 3, "marginTableId": 3 },
                ],
                "marginTables": [],
                "collateralToken": 0,
            },
            [
                {
                    "funding": "0.0000125", "openInterest": "38900.62256", "prevDayPx": "82892.0", "dayNtlVlm": "3555226369.6255393028",
                    "premium": "-0.0001575128", "oraclePx": "82533.0", "markPx": "82512.0", "midPx": "82519.5",
                    "impactPxs": ["82519.0", "82520.0"], "dayBaseVlm": "43448.74178",
                },
                {
                    "funding": "0.0", "openInterest": "0.0", "prevDayPx": "0.37621", "dayNtlVlm": "0.0", "premium": null,
                    "oraclePx": "0.3754", "markPx": "0.37621", "midPx": null, "impactPxs": null, "dayBaseVlm": "0.0",
                },
                {
                    "funding": "0.0000125", "openInterest": "6867410138.0", "prevDayPx": "0.004052", "dayNtlVlm": "18414316.5830070078",
                    "premium": "-0.000253357", "oraclePx": "0.003947", "markPx": "0.003945", "midPx": "0.003945",
                    "impactPxs": ["0.003944", "0.003946"], "dayBaseVlm": "4770073014.0",
                },
                {
                    "funding": "0.0000125", "openInterest": "8899627160.0", "prevDayPx": "0.000164", "dayNtlVlm": "32702.864048",
                    "premium": "0.0", "oraclePx": "0.00016", "markPx": "0.000161", "midPx": "0.000161",
                    "impactPxs": ["0.00016", "0.000162"], "dayBaseVlm": "203816326.0",
                },
            ],
        ])
    }

    async fn poll(rest: &MockRest, ts: i64) -> anyhow::Result<AnchorMap> {
        Hyperliquid::with_rest(&rest.url).fetch_round(&http(), ts).await
    }

    #[test]
    fn polls_every_three_seconds_and_pauses_a_minute_on_a_rate_limit() {
        let venue = Hyperliquid::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(3));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(60));
    }

    #[tokio::test]
    async fn joins_each_context_to_its_name_by_position_with_an_hourly_interval_and_the_next_whole_hour() {
        let rest = MockRest::start().await;
        rest.reply(INFO_PATH, reply());

        let rows = poll(&rest, T0).await.unwrap();

        assert_eq!(rest.calls(), [INFO_PATH]);
        assert_eq!(
            rows["BTC"],
            AnchorRow {
                index: 82533.0,
                mark: 82512.0,
                funding_rate: 0.0000125,
                funding_interval_hours: 1.0,
                next_funding_at: NEXT_HOUR,
                ts: None,
            }
        );
        assert_eq!((rows["kPEPE"].index, rows["kPEPE"].mark), (0.003947, 0.003945));
        assert_eq!((rows["HMSTR"].index, rows["HMSTR"].mark), (0.00016, 0.000161));
    }

    #[tokio::test]
    async fn leaves_out_a_delisted_asset() {
        let rest = MockRest::start().await;
        rest.reply(INFO_PATH, reply());

        let rows = poll(&rest, T0).await.unwrap();

        let mut names: Vec<&String> = rows.keys().collect();
        names.sort();
        assert_eq!(names, ["BTC", "HMSTR", "kPEPE"]);
    }

    #[tokio::test]
    async fn a_poll_on_the_hour_points_at_the_next_hour() {
        let rest = MockRest::start().await;
        rest.reply(INFO_PATH, reply());

        let on_the_hour = poll(&rest, NEXT_HOUR).await.unwrap();
        let just_before = poll(&rest, NEXT_HOUR - 1).await.unwrap();

        assert_eq!(on_the_hour["BTC"].next_funding_at, NEXT_HOUR + HOUR_MS);
        assert_eq!(just_before["BTC"].next_funding_at, NEXT_HOUR);
    }

    #[tokio::test]
    async fn a_reply_whose_contexts_do_not_match_the_universe_fails_the_round() {
        let rest = MockRest::start().await;
        let mut short = reply();
        short[1].as_array_mut().unwrap().pop();
        rest.reply(INFO_PATH, short);

        let error = poll(&rest, T0).await.unwrap_err();

        assert!(error.to_string().contains("3 contexts for 4 assets"), "{error:#}");
    }

    #[tokio::test]
    async fn a_null_oracle_reads_as_nan_so_the_poller_counts_the_row_missing() {
        let rest = MockRest::start().await;
        let mut nulled = reply();
        nulled[1][0]["oraclePx"] = Value::Null;
        nulled[1][0]["markPx"] = Value::Null;
        rest.reply(INFO_PATH, nulled);

        let rows = poll(&rest, T0).await.unwrap();

        assert!(rows["BTC"].index.is_nan());
        assert!(rows["BTC"].mark.is_nan());
    }

    #[tokio::test]
    async fn an_unknown_dex_answer_fails_the_round() {
        // An unknown dex answered 500 with a JSON null, and a 200 null would not decode either.
        let rest = MockRest::start().await;
        rest.reply(INFO_PATH, Value::Null);

        assert!(poll(&rest, T0).await.is_err());

        rest.fail(INFO_PATH, 500);
        assert!(poll(&rest, T0).await.is_err());
    }

    #[tokio::test]
    async fn a_rate_limit_status_reaches_the_poller_as_rate_limited() {
        let rest = MockRest::start().await;
        rest.fail(INFO_PATH, 429);

        let error = poll(&rest, T0).await.unwrap_err();

        assert!(error.downcast_ref::<crate::feeds::anchor_poller::RateLimited>().is_some(), "{error:#}");
    }
}
