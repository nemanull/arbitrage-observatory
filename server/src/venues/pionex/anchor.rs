use super::{ID, Pionex};
use crate::clock::now_ms;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, RateLimited, get_bytes};
use crate::venues::wire;
use anyhow::Context;
use futures_util::future::join_all;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::collections::{HashMap, HashSet};
use std::time::Duration;

// One call returns index, mark, the estimated next rate and the next settlement for every perpetual, keyed by the socket's symbol.
const INDEXES_PATH: &str = "/api/v1/market/indexes";

// No bulk call carries the funding interval, which is 1, 2, 4 or 8 h per contract, so it is the gap between the last two settlements.
const FUNDING_PATH: &str = "/api/v1/market/fundingRates";

// Every market call took 1 token of a bucket of 30 on 2026-10-09, and 20 calls a second for 2 s left it at 28.5 or more.
// The docs allow 10 a second per IP, so the indexes call and eight histories make 9, and 552 markets each get an interval within about 70 s.
const HISTORIES_PER_ROUND: usize = 8;

const HOUR_MS: i64 = 3_600_000;

// The settlement time "may have a deviation of 1 minute", although every fundingTime seen sat on the hour.
const SETTLEMENT_JITTER_MS: i64 = 120_000;

#[derive(Default)]
pub struct Intervals {
    hours: HashMap<String, f64>, // raw id to its funding interval
    warned: HashSet<String>,
    next: usize, // position in the tracked list of the next history read
}

impl AnchorVenue for Pionex {
    // A breach answers HTTP 429 and bans the IP for 60 s, extended by 10 s for each request during the ban.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(60)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let url = format!("{}{INDEXES_PATH}", self.rest);
        let (indexes, histories) = tokio::join!(get_data::<Indexes>(http, &url), self.read_intervals(http));
        let arrived_at = now_ms();
        histories?;
        let indexes = indexes?;

        let intervals = self.intervals.lock().unwrap();
        let mut rows = AnchorMap::with_capacity(indexes.indexes.len());
        for row in indexes.indexes {
            // A market waits for its history read, since an unknown interval would be rejected on every round.
            let Some(&hours) = intervals.hours.get(&row.symbol) else {
                continue;
            };

            rows.insert(
                row.symbol,
                AnchorRow {
                    index: row.index_price,
                    mark: row.mark_price,
                    funding_rate: row.next_funding_rate,
                    funding_interval_hours: hours,
                    next_funding_at: if row.next_funding_time > 0 { row.next_funding_time } else { 0 },
                    // The venue republishes about once a second, so its own stamp is the age, and arrival caps a clock running ahead.
                    ts: Some(if row.update_time > 0 { row.update_time.min(arrived_at) } else { arrived_at }),
                },
            );
        }

        Ok(rows)
    }
}

impl Pionex {
    // A market keeps its interval until its turn comes again, so an interval the venue changes is read on the next pass.
    // A rate limit fails the round so the poller pauses, and any other failure leaves that market out until a later pass.
    async fn read_intervals(&self, http: &reqwest::Client) -> anyhow::Result<()> {
        if self.markets.is_empty() {
            return Ok(());
        }

        let turn: Vec<String> = {
            let mut intervals = self.intervals.lock().unwrap();
            let count = HISTORIES_PER_ROUND.min(self.markets.len());
            let mut turn = Vec::with_capacity(count);
            for _ in 0..count {
                turn.push(self.markets[intervals.next % self.markets.len()].clone());
                intervals.next = (intervals.next + 1) % self.markets.len();
            }
            turn
        };

        let reads = turn.iter().map(|raw_market_id| {
            let url = format!("{}{FUNDING_PATH}?symbol={raw_market_id}&limit=2", self.rest);
            async move { get_data::<History>(http, &url).await }
        });
        let replies = join_all(reads).await;

        let mut intervals = self.intervals.lock().unwrap();
        let mut limited = None;
        for (raw_market_id, reply) in turn.into_iter().zip(replies) {
            let error = match reply.map(|history| interval_hours(&history.rates)) {
                Ok(Some(hours)) => {
                    intervals.hours.insert(raw_market_id, hours);
                    continue;
                }
                Ok(None) => anyhow::anyhow!("fewer than two settlements an hour apart"),
                Err(error) if error.is::<RateLimited>() => {
                    limited = Some(error);
                    continue;
                }
                Err(error) => error,
            };
            if intervals.warned.insert(raw_market_id.clone()) {
                tracing::warn!(event = "funding_interval_unknown", venue = ID, market = %raw_market_id, error = format!("{error:#}"));
            }
        }

        match limited {
            Some(error) => Err(error),
            None => Ok(()),
        }
    }
}

// The gap between the two newest settlements in whole hours, or none for a new contract or an off grid gap.
fn interval_hours(rates: &[Rate]) -> Option<f64> {
    let [newer, older, ..] = rates else {
        return None;
    };
    let gap = (newer.funding_time - older.funding_time).abs();
    let hours = (gap + HOUR_MS / 2) / HOUR_MS;
    if hours >= 1 && (gap - hours * HOUR_MS).abs() <= SETTLEMENT_JITTER_MS {
        Some(hours as f64)
    } else {
        None
    }
}

// Every public call answers HTTP 200 with result false and a code on an error, and a breach answers HTTP 429.
pub async fn get_data<T: DeserializeOwned>(http: &reqwest::Client, url: &str) -> anyhow::Result<T> {
    let body = get_bytes(http, url).await?;
    let status: Status = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;
    if !status.result {
        anyhow::bail!("{}: {}", status.code, status.message);
    }

    let reply: Data<T> = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;
    Ok(reply.data)
}

#[derive(Deserialize)]
struct Status {
    #[serde(default)]
    result: bool,
    #[serde(default)]
    code: String, // "MARKET_INVALID_SYMBOL"
    #[serde(default)]
    message: String,
}

#[derive(Deserialize)]
struct Data<T> {
    data: T,
}

#[derive(Deserialize)]
struct Indexes {
    #[serde(default)]
    indexes: Vec<IndexRow>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct IndexRow {
    #[serde(default)]
    symbol: String, // "BTC_USDT_PERP"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64, // the index plus a 5 minute average of the venue's own basis
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_funding_rate: f64, // a fraction per interval, the estimate for the upcoming settlement
    #[serde(default)]
    next_funding_time: i64, // Unix ms
    #[serde(default)]
    update_time: i64, // Unix ms on a 100 ms grid, about a second behind arrival
}

#[derive(Deserialize)]
struct History {
    #[serde(default)]
    rates: Vec<Rate>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Rate {
    #[serde(default)]
    funding_time: i64, // Unix ms of a past settlement, newest first
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, market, tracked};
    use serde_json::{Value, json};

    fn history_path(raw_market_id: &str) -> String {
        format!("{FUNDING_PATH}?symbol={raw_market_id}&limit=2")
    }

    // Rows captured live on 2026-10-09 at 19:05 UTC, one per funding interval.
    fn btc_row() -> Value {
        json!({
            "symbol": "BTC_USDT_PERP", "indexPrice": "82473.73616", "markPrice": "82426.29281",
            "nextFundingRate": "0.0000460584", "nextFundingTime": 1791590400000u64, "updateTime": 1791572626700u64,
        })
    }

    fn futux_row() -> Value {
        json!({
            "symbol": "FUTUX_USDT_PERP", "indexPrice": "113.4465", "markPrice": "113.44803",
            "nextFundingRate": "0.00003", "nextFundingTime": 1791576000000u64, "updateTime": 1791572753600u64,
        })
    }

    fn indexes(rows: Vec<Value>) -> Value {
        json!({ "result": true, "data": { "indexes": rows }, "timestamp": 1791572627554u64 })
    }

    // Histories captured live on 2026-10-09: BTC settles every 8 h and FUTUX every 2 h.
    fn btc_history() -> Value {
        json!({ "result": true, "data": { "symbol": "BTC_USDT_PERP", "rates": [
            { "fundingRate": "0.0000127273", "fundingTime": 1791561600000u64 },
            { "fundingRate": "0.0000540482", "fundingTime": 1791532800000u64 },
        ]}, "timestamp": 1791572627667u64 })
    }

    fn futux_history() -> Value {
        json!({ "result": true, "data": { "symbol": "FUTUX_USDT_PERP", "rates": [
            { "fundingRate": "0.00003", "fundingTime": 1791568800000u64 },
            { "fundingRate": "0.00003", "fundingTime": 1791561600000u64 },
        ]}, "timestamp": 1791572853577u64 })
    }

    fn poller(rest: &MockRest, raw_market_ids: &[&str]) -> Pionex {
        let mut markets = Vec::new();
        for id in raw_market_ids {
            markets.push(market(ID, id, id.split('_').next().unwrap(), "USDT", true));
        }
        Pionex::with_rest(&tracked(&markets), &rest.url)
    }

    fn keys(rows: &AnchorMap) -> Vec<&str> {
        let mut keys: Vec<&str> = rows.keys().map(String::as_str).collect();
        keys.sort();
        keys
    }

    #[test]
    fn polls_every_second_and_pauses_a_minute_on_a_rate_limit() {
        let venue = Pionex::new(&[]);

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(60));
    }

    #[tokio::test]
    async fn maps_an_index_row_with_the_interval_from_its_funding_history() {
        let rest = MockRest::start().await;
        rest.reply(INDEXES_PATH, indexes(vec![btc_row(), futux_row()]));
        rest.reply(&history_path("BTC_USDT_PERP"), btc_history());
        rest.reply(&history_path("FUTUX_USDT_PERP"), futux_history());

        let rows = poller(&rest, &["BTC_USDT_PERP", "FUTUX_USDT_PERP"]).fetch_round(&http(), 0).await.unwrap();

        assert_eq!(
            rows["BTC_USDT_PERP"],
            AnchorRow {
                index: 82473.73616,
                mark: 82426.29281,
                funding_rate: 0.0000460584,
                funding_interval_hours: 8.0,
                next_funding_at: 1791590400000,
                ts: Some(1791572626700),
            }
        );
        assert_eq!(rows["FUTUX_USDT_PERP"].funding_interval_hours, 2.0);
    }

    #[tokio::test]
    async fn reads_eight_histories_per_round_in_rotation_and_writes_a_market_once_its_interval_is_known() {
        let ids = ["A", "B", "C", "D", "E", "F", "G", "H", "I", "J"].map(|base| format!("{base}_USDT_PERP"));
        let ids: Vec<&str> = ids.iter().map(String::as_str).collect();
        let rest = MockRest::start().await;
        let mut rows = Vec::new();
        for id in &ids {
            let mut row = btc_row();
            row["symbol"] = json!(id);
            rows.push(row);
            rest.reply(&history_path(id), btc_history());
        }
        rest.reply(INDEXES_PATH, indexes(rows));
        let venue = poller(&rest, &ids);

        let first = venue.fetch_round(&http(), 0).await.unwrap();
        let second = venue.fetch_round(&http(), 0).await.unwrap();

        assert_eq!(keys(&first), ids[..8]);
        assert_eq!(keys(&second), ids);
        let mut reads: Vec<String> = rest.calls().into_iter().filter(|call| call != INDEXES_PATH).collect();
        reads[..8].sort();
        reads[8..].sort();
        // The reads of one round run at once, so only their split between rounds is fixed.
        let second_turn = ["A_USDT_PERP", "B_USDT_PERP", "C_USDT_PERP", "D_USDT_PERP", "E_USDT_PERP", "F_USDT_PERP", "I_USDT_PERP", "J_USDT_PERP"];
        let expected: Vec<String> = ids[..8].iter().chain(&second_turn).map(|id| history_path(id)).collect();
        assert_eq!(reads, expected);
    }

    #[tokio::test]
    async fn leaves_out_a_market_with_one_settlement_or_a_failed_history_and_warns_once_each() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        let mut new = futux_row();
        new["symbol"] = json!("NEW_USDT_PERP");
        rest.reply(INDEXES_PATH, indexes(vec![btc_row(), futux_row(), new]));
        rest.reply(&history_path("BTC_USDT_PERP"), btc_history());
        rest.reply(
            &history_path("NEW_USDT_PERP"),
            json!({ "result": true, "data": { "symbol": "NEW_USDT_PERP", "rates": [{ "fundingRate": "0.0001", "fundingTime": 1791568800000u64 }] }}),
        );
        rest.reply(
            &history_path("FUTUX_USDT_PERP"),
            json!({ "result": false, "code": "MARKET_INVALID_SYMBOL", "message": "symbol error", "timestamp": 1790133551 }),
        );
        let venue = poller(&rest, &["BTC_USDT_PERP", "FUTUX_USDT_PERP", "NEW_USDT_PERP"]);

        for _ in 0..3 {
            let rows = venue.fetch_round(&http(), 0).await.unwrap();
            assert_eq!(keys(&rows), ["BTC_USDT_PERP"]);
        }

        let warnings = logs.events("funding_interval_unknown");
        assert_eq!(warnings.len(), 2);
        let mut markets: Vec<&str> = warnings.iter().map(|line| line.text("market")).collect();
        markets.sort();
        assert_eq!(markets, ["FUTUX_USDT_PERP", "NEW_USDT_PERP"]);
    }

    #[test]
    fn reads_the_interval_as_the_whole_hours_between_the_two_newest_settlements() {
        let rates = |times: &[i64]| -> Vec<Rate> { times.iter().map(|&funding_time| Rate { funding_time }).collect() };
        let t = 1_791_561_600_000;

        assert_eq!(interval_hours(&rates(&[t, t - 8 * HOUR_MS])), Some(8.0));
        assert_eq!(interval_hours(&rates(&[t, t - HOUR_MS + 60_000])), Some(1.0));
        assert_eq!(interval_hours(&rates(&[t - 4 * HOUR_MS, t])), Some(4.0));
        assert_eq!(interval_hours(&rates(&[t, t - 90 * 60_000])), None);
        assert_eq!(interval_hours(&rates(&[t, t])), None);
        assert_eq!(interval_hours(&rates(&[t])), None);
    }

    #[tokio::test]
    async fn stamps_a_row_no_later_than_its_arrival_and_leaves_out_untracked_symbols() {
        let rest = MockRest::start().await;
        let mut ahead = btc_row();
        ahead["updateTime"] = json!(4_102_444_800_000u64); // 2100-01-01, a clock far ahead
        let mut unstamped = futux_row();
        unstamped.as_object_mut().unwrap().remove("updateTime");
        let mut coin_quoted = btc_row();
        coin_quoted["symbol"] = json!("BTC_ETH_PERP");
        rest.reply(INDEXES_PATH, indexes(vec![ahead, unstamped, coin_quoted]));
        rest.reply(&history_path("BTC_USDT_PERP"), btc_history());
        rest.reply(&history_path("FUTUX_USDT_PERP"), futux_history());

        let before = crate::clock::now_ms();
        let rows = poller(&rest, &["BTC_USDT_PERP", "FUTUX_USDT_PERP"]).fetch_round(&http(), 0).await.unwrap();
        let after = crate::clock::now_ms();

        assert_eq!(keys(&rows), ["BTC_USDT_PERP", "FUTUX_USDT_PERP"]);
        for row in rows.values() {
            let ts = row.ts.unwrap();
            assert!(before <= ts && ts <= after, "{ts}");
        }
    }

    #[tokio::test]
    async fn keeps_a_known_interval_when_a_later_history_read_fails() {
        let rest = MockRest::start().await;
        rest.reply(INDEXES_PATH, indexes(vec![btc_row()]));
        rest.reply(&history_path("BTC_USDT_PERP"), btc_history());
        let venue = poller(&rest, &["BTC_USDT_PERP"]);
        venue.fetch_round(&http(), 0).await.unwrap();

        rest.fail(&history_path("BTC_USDT_PERP"), 500);
        let rows = venue.fetch_round(&http(), 0).await.unwrap();

        assert_eq!(rows["BTC_USDT_PERP"].funding_interval_hours, 8.0);
    }

    #[tokio::test]
    async fn reads_an_unknown_next_settlement_as_zero() {
        let rest = MockRest::start().await;
        let mut row = btc_row();
        row["nextFundingTime"] = json!(0);
        rest.reply(INDEXES_PATH, indexes(vec![row]));
        rest.reply(&history_path("BTC_USDT_PERP"), btc_history());

        let rows = poller(&rest, &["BTC_USDT_PERP"]).fetch_round(&http(), 0).await.unwrap();

        assert_eq!(rows["BTC_USDT_PERP"].next_funding_at, 0);
    }

    #[tokio::test]
    async fn fails_the_round_on_result_false_sent_with_http_200() {
        let rest = MockRest::start().await;
        rest.reply(
            INDEXES_PATH,
            json!({ "result": false, "code": "MARKET_PARAMETER_ERROR", "message": "symbol error", "timestamp": 1790133551 }),
        );
        rest.reply(&history_path("BTC_USDT_PERP"), btc_history());

        let error = poller(&rest, &["BTC_USDT_PERP"]).fetch_round(&http(), 0).await.unwrap_err();

        assert_eq!(error.to_string(), "MARKET_PARAMETER_ERROR: symbol error");
    }

    #[tokio::test]
    async fn reads_a_429_on_either_call_as_a_rate_limit() {
        let rest = MockRest::start().await;
        rest.fail(INDEXES_PATH, 429);
        rest.reply(&history_path("BTC_USDT_PERP"), btc_history());
        let error = poller(&rest, &["BTC_USDT_PERP"]).fetch_round(&http(), 0).await.unwrap_err();
        assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");

        let rest = MockRest::start().await;
        rest.reply(INDEXES_PATH, indexes(vec![btc_row()]));
        rest.fail(&history_path("BTC_USDT_PERP"), 429);
        let error = poller(&rest, &["BTC_USDT_PERP"]).fetch_round(&http(), 0).await.unwrap_err();
        assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");
    }

    #[tokio::test]
    async fn fails_the_round_on_a_body_that_is_no_envelope() {
        let rest = MockRest::start().await;
        rest.reply(INDEXES_PATH, json!("Just a moment..."));
        rest.reply(&history_path("BTC_USDT_PERP"), btc_history());

        let error = poller(&rest, &["BTC_USDT_PERP"]).fetch_round(&http(), 0).await.unwrap_err();

        assert!(format!("{error:#}").contains("error decoding response body"), "{error:#}");
    }
}
