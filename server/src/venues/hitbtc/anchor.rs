use super::HitBtc;
use crate::clock::now_ms;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use chrono::DateTime;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;

// One call carries index, mark, rate and next settlement for every contract, regenerated on a 3 s grid.
pub const INFO_PATH: &str = "/public/futures/info";

// No reply carries the interval, and every contract of every family venue settles at 00, 08 and 16 UTC.
const FUNDING_INTERVAL_HOURS: f64 = 8.0;

impl AnchorVenue for HitBtc {
    // The public limit is 30 a second plus a burst of 50 in a sliding window of 1 s, and no Retry-After is documented.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(1)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let infos: HashMap<String, Info> = get_json(http, &format!("{}{INFO_PATH}", self.rest)).await?;
        let arrived_at = now_ms();
        let mut rows = AnchorMap::with_capacity(infos.len());

        for (raw_market_id, info) in infos {
            if self.profile.unanchored.contains(&raw_market_id.as_str()) {
                continue;
            }

            // A row's timestamp is when the venue last computed it, up to 3 s before the reply, and about a minute on a dead contract.
            let written_at = rfc3339_ms(&info.timestamp);
            let next_funding_at = rfc3339_ms(&info.next_funding_time);

            // A suspended or expired contract keeps a frozen row with mark 0 or a settlement at or before its own timestamp.
            let settled = matches!((next_funding_at, written_at), (Some(next), Some(at)) if next <= at);
            if !(info.mark_price > 0.0) || settled {
                continue;
            }

            rows.insert(
                raw_market_id,
                AnchorRow {
                    index: info.index_price,
                    mark: info.mark_price,
                    funding_rate: info.funding_rate,
                    funding_interval_hours: FUNDING_INTERVAL_HOURS,
                    next_funding_at: next_funding_at.unwrap_or(0),
                    ts: Some(written_at.map_or(arrived_at, |at| at.min(arrived_at))),
                },
            );
        }

        Ok(rows)
    }
}

fn rfc3339_ms(text: &str) -> Option<i64> {
    DateTime::parse_from_rfc3339(text).ok().map(|at| at.timestamp_millis())
}

#[derive(Deserialize)]
struct Info {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64, // the index carried by funding_rate over the time left to the settlement, so it holds none of the book's premium
    // Fixed for the whole interval and charged at next_funding_time, since the mark prorates it over the time left to that settlement.
    // indicative_funding_rate is the running estimate for the settlement after it.
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64,
    #[serde(default)]
    next_funding_time: String, // "2026-10-10T00:00:00.000Z"
    #[serde(default)]
    timestamp: String,
}

#[cfg(test)]
mod tests {
    use super::super::{CHANGELLYPRO, HITBTC, Profile};
    use super::*;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    // Rows of GET /api/3/public/futures/info on api.hitbtc.com, captured live on 2026-10-09.
    fn btc() -> Value {
        json!({
            "contract_type": "perpetual", "mark_price": "82558.09", "index_price": "82552.77", "funding_rate": "0.0001",
            "open_interest": "5.3266", "next_funding_time": "2026-10-10T00:00:00.000Z", "indicative_funding_rate": "0.0001",
            "premium_index": "0", "avg_premium_index": "0.000029478716243969", "interest_rate": "0.0001",
            "timestamp": "2026-10-09T18:50:40.632Z",
        })
    }

    fn hit() -> Value {
        json!({
            "contract_type": "perpetual", "mark_price": "0.2313", "index_price": "0.2306", "funding_rate": "0.003",
            "open_interest": "8985", "next_funding_time": "2026-10-10T00:00:00.000Z", "indicative_funding_rate": "0.003",
            "premium_index": "0.024718126626192541", "avg_premium_index": "0.026395933594545910", "interest_rate": "0.0001",
            "timestamp": "2026-10-09T18:51:01.423Z",
        })
    }

    fn suspended_pepe() -> Value {
        json!({
            "contract_type": "perpetual", "mark_price": "0", "index_price": "0", "funding_rate": "0", "open_interest": "0",
            "next_funding_time": "1970-01-01T00:00:00.000Z", "indicative_funding_rate": "0", "premium_index": "0",
            "avg_premium_index": "0", "interest_rate": "0", "timestamp": "2026-10-05T16:02:04.644Z",
        })
    }

    fn expired_ton() -> Value {
        json!({
            "contract_type": "perpetual", "mark_price": "1.8035", "index_price": "1.8035", "funding_rate": "0",
            "open_interest": "0.0", "next_funding_time": "2026-06-15T16:00:00.000Z", "indicative_funding_rate": "0.0001",
            "premium_index": "0", "avg_premium_index": "0", "interest_rate": "0.0001", "timestamp": "2026-06-15T16:00:00.046Z",
        })
    }

    async fn poll(profile: &'static Profile, rest: &MockRest) -> AnchorMap {
        HitBtc::with_rest(profile, &rest.url).fetch_round(&http(), 0).await.unwrap()
    }

    #[test]
    fn polls_every_second_and_pauses_one_window_on_a_rate_limit() {
        let venue = HitBtc::new(&HITBTC);

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(1));
    }

    #[tokio::test]
    async fn maps_a_row_with_the_eight_hour_constant_and_the_row_timestamp() {
        let rest = MockRest::start().await;
        rest.reply(INFO_PATH, json!({ "BTCUSDT_PERP": btc() }));

        let rows = poll(&HITBTC, &rest).await;

        assert_eq!(rest.calls(), [INFO_PATH]);
        assert_eq!(
            rows["BTCUSDT_PERP"],
            AnchorRow {
                index: 82552.77,
                mark: 82558.09,
                funding_rate: 0.0001,
                funding_interval_hours: 8.0,
                next_funding_at: 1_791_590_400_000,
                ts: Some(1_791_571_840_632),
            }
        );
    }

    #[tokio::test]
    async fn reads_funding_rate_and_not_the_indicative_rate() {
        let rest = MockRest::start().await;
        let mut row = btc();
        row["indicative_funding_rate"] = json!("-0.000264");
        rest.reply(INFO_PATH, json!({ "BTCUSDT_PERP": row }));

        let rows = poll(&CHANGELLYPRO, &rest).await;

        assert_eq!(rows["BTCUSDT_PERP"].funding_rate, 0.0001);
    }

    #[tokio::test]
    async fn leaves_out_suspended_and_expired_rows_and_the_self_indexed_market() {
        let rest = MockRest::start().await;
        rest.reply(
            INFO_PATH,
            json!({ "BTCUSDT_PERP": btc(), "HITUSDT_PERP": hit(), "PEPEUSDT_PERP": suspended_pepe(), "TONUSDT_PERP": expired_ton() }),
        );

        let rows = poll(&HITBTC, &rest).await;

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTCUSDT_PERP"]);
    }

    #[tokio::test]
    async fn leaves_out_a_row_with_mark_zero_even_before_its_settlement() {
        let rest = MockRest::start().await;
        let mut row = btc();
        row["mark_price"] = json!("0");
        rest.reply(INFO_PATH, json!({ "BTCUSDT_PERP": row }));

        assert!(poll(&HITBTC, &rest).await.is_empty());
    }

    #[tokio::test]
    async fn sends_zero_for_a_next_funding_time_it_cannot_read() {
        let rest = MockRest::start().await;
        let mut missing = btc();
        missing.as_object_mut().unwrap().remove("next_funding_time");
        let mut garbled = btc();
        garbled["next_funding_time"] = json!("soon");
        rest.reply(INFO_PATH, json!({ "BTCUSDT_PERP": missing, "ETHUSDT_PERP": garbled }));

        let rows = poll(&HITBTC, &rest).await;

        assert_eq!(rows["BTCUSDT_PERP"].next_funding_at, 0);
        assert_eq!(rows["ETHUSDT_PERP"].next_funding_at, 0);
        assert_eq!(rows["BTCUSDT_PERP"].ts, Some(1_791_571_840_632));
    }

    #[tokio::test]
    async fn keeps_the_self_indexed_market_on_a_venue_that_does_not_list_it_as_such() {
        let rest = MockRest::start().await;
        rest.reply(INFO_PATH, json!({ "HITUSDT_PERP": hit() }));

        let rows = poll(&CHANGELLYPRO, &rest).await;

        assert_eq!(rows["HITUSDT_PERP"].funding_rate, 0.003);
    }

    #[tokio::test]
    async fn stamps_a_row_with_no_timestamp_or_a_future_one_with_its_arrival() {
        let rest = MockRest::start().await;
        let mut undated = btc();
        undated["timestamp"] = json!("");
        let mut ahead = btc();
        ahead["timestamp"] = json!("2099-01-01T00:00:00.000Z");
        ahead["next_funding_time"] = json!("2099-01-01T08:00:00.000Z");
        rest.reply(INFO_PATH, json!({ "BTCUSDT_PERP": undated, "ETHUSDT_PERP": ahead }));
        let before = now_ms();

        let rows = poll(&HITBTC, &rest).await;

        for id in ["BTCUSDT_PERP", "ETHUSDT_PERP"] {
            let ts = rows[id].ts.unwrap();
            assert!(before <= ts && ts <= now_ms(), "{id} stamped {ts}");
        }
    }

    #[tokio::test]
    async fn fails_the_round_on_an_error_status() {
        let rest = MockRest::start().await;
        rest.fail(INFO_PATH, 503);

        assert!(HitBtc::with_rest(&HITBTC, &rest.url).fetch_round(&http(), 0).await.is_err());
    }
}
