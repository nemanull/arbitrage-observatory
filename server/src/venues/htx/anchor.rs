use super::markets::{CONTRACTS_PATH, Contract};
use super::{Htx, ID};
use crate::clock::now_ms;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, RateLimited, get_bytes};
use crate::venues::wire;
use anyhow::Context;
use futures_util::{StreamExt, stream};
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::collections::{HashMap, HashSet};
use std::time::Duration;

// Index for every contract, republished about once a second, plus 16 delisted rows with frozen values.
pub const INDEX_PATH: &str = "/linear-swap-api/v1/swap_index";

// The live rate of the current period and the settlement it applies to, for every contract.
pub const FUNDING_PATH: &str = "/linear-swap-api/v1/swap_batch_funding_rate";

// No call returns many marks, so each one is the close of the market's one minute mark price kline.
// These count against the 800 per second market data budget, while the three calls above share 240 per 3 s.
pub const MARK_PATH: &str = "/index/market/history/linear_swap_mark_price_kline";

// HTTP 200 with this err_code in the body is the rate limit answer, and its window is 3 s.
const RATE_LIMIT_CODE: &str = "1032";

// The mark kline answers err-code "bad-request" with this message to about one read in a few hundred, even at its usual pace.
const RATE_LIMIT_MESSAGE: &str = "request limit";

// Tencent EdgeOne fronts the REST and socket host, and answers HTTP 567 "Restricted Access" to every call and handshake from an IP that sent too much.
// The shared request path names an unknown status first in its error, and the block outlasts the 3 s window of code 1032.
const EDGE_BLOCK_STATUS: &str = "567 ";
const EDGE_BLOCK_PAUSE: Duration = Duration::from_secs(60);

// Each round reads a third of the marks, so a mark is at most about 3 s old, the sweep of decision 18.
// The host speaks HTTP/2 and a read took about 300 ms here, so a third of 377 markets goes out at once and lands within the second.
const MARK_SWEEP_ROUNDS: usize = 3;
const MARKS_IN_FLIGHT: usize = 128;

// A mark that failed to refresh for this long would only reach the engine as stale, so its row is left out instead.
const MARK_MAX_AGE_MS: i64 = 10_000;

// settlement_period changes rarely, and the call costs one of the 240 per 3 s.
const INTERVALS_EVERY_MS: i64 = 60_000;

#[derive(Default)]
pub struct AnchorState {
    marks: HashMap<String, (f64, i64)>, // raw id to (mark, arrival in Unix ms)
    next: usize,                       // position in the tracked list where the next slice of mark reads starts
    intervals: HashMap<String, f64>,   // raw id to funding interval in hours
    intervals_read_at: i64,            // Unix ms of the last contract info read, 0 before the first
    warned: HashSet<String>,           // markets whose failed mark read was logged
}

impl AnchorVenue for Htx {
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(3)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let (mark_ids, read_intervals) = self.plan_round(now_ms());

        let index_url = format!("{}{INDEX_PATH}", self.rest);
        let index = async {
            let rows: Vec<Index> = get_data(http, &index_url).await?;
            anyhow::Ok((rows, now_ms()))
        };
        let funding_url = format!("{}{FUNDING_PATH}", self.rest);
        let funding = get_data::<Vec<Funding>>(http, &funding_url);
        let contracts_url = format!("{}{CONTRACTS_PATH}", self.rest);
        let intervals = async {
            if !read_intervals {
                return None;
            }
            Some(get_data::<Vec<Contract>>(http, &contracts_url).await)
        };
        let (index, funding, intervals, marks) = tokio::join!(index, funding, intervals, self.read_marks(http, mark_ids));

        // The marks are kept even when a bulk call fails the round, since the rotation has already moved past them.
        // A refused read keeps the market's last mark, and only a round whose every read was refused pauses the poller.
        let mut state = self.anchor.lock().unwrap();
        let mut limited = None;
        let mut read = 0;
        for (raw_market_id, result) in marks {
            match result {
                Ok(reading) => {
                    read += 1;
                    state.marks.insert(raw_market_id, reading);
                }
                Err(error) => {
                    if state.warned.insert(raw_market_id.clone()) {
                        tracing::warn!(event = "mark_read_failed", venue = ID, market = %raw_market_id, error = format!("{error:#}"));
                    }
                    if error.is::<RateLimited>() {
                        limited.get_or_insert(error);
                    }
                }
            }
        }

        let (index, arrived_at) = index?;
        let funding = funding?;
        if read == 0
            && let Some(error) = limited
        {
            return Err(error);
        }

        match intervals {
            Some(Ok(contracts)) => {
                state.intervals.clear();
                for row in contracts {
                    state.intervals.insert(row.contract_code, row.settlement_period);
                }
                state.intervals_read_at = arrived_at;
            }
            Some(Err(error)) if state.intervals.is_empty() => return Err(error),
            Some(Err(error)) => {
                tracing::warn!(event = "intervals_read_failed", venue = ID, error = format!("{error:#}"));
            }
            None => {}
        }

        let mut rates = HashMap::with_capacity(funding.len());
        for row in funding {
            rates.insert(row.contract_code, (row.funding_rate, row.funding_time));
        }

        // The basket behind each index is not published, so no row can be told apart as a self index.
        let mut rows = AnchorMap::with_capacity(self.markets.len());
        for row in index {
            let Some(&(mark, mark_at)) = state.marks.get(&row.contract_code) else {
                continue;
            };
            let (Some(&(funding_rate, funding_time)), Some(&interval)) =
                (rates.get(&row.contract_code), state.intervals.get(&row.contract_code))
            else {
                continue;
            };
            if arrived_at - mark_at > MARK_MAX_AGE_MS {
                continue;
            }

            // The index's own time caps its arrival, so a frozen index ages out, and a row is never fresher than its older price.
            let index_at = if row.index_ts > 0 { row.index_ts.min(arrived_at) } else { arrived_at };
            rows.insert(
                row.contract_code,
                AnchorRow {
                    index: row.index_price,
                    mark,
                    funding_rate,
                    funding_interval_hours: interval,
                    next_funding_at: if funding_time.is_finite() { funding_time as i64 } else { 0 },
                    ts: Some(index_at.min(mark_at)),
                },
            );
        }

        Ok(rows)
    }
}

impl Htx {
    // The next slice of the rotation, plus every market that has no mark yet, so the first round reads them all.
    fn plan_round(&self, now: i64) -> (Vec<String>, bool) {
        let mut state = self.anchor.lock().unwrap();
        let count = self.markets.len();
        let mut chosen = vec![false; count];
        let mut ids = Vec::new();

        for _ in 0..count.div_ceil(MARK_SWEEP_ROUNDS) {
            let position = state.next % count;
            state.next = (position + 1) % count;
            chosen[position] = true;
            ids.push(self.markets[position].clone());
        }
        for (position, raw_market_id) in self.markets.iter().enumerate() {
            if !chosen[position] && !state.marks.contains_key(raw_market_id) {
                ids.push(raw_market_id.clone());
            }
        }

        let read_intervals = now - state.intervals_read_at >= INTERVALS_EVERY_MS;
        (ids, read_intervals)
    }

    async fn read_marks(&self, http: &reqwest::Client, ids: Vec<String>) -> Vec<(String, anyhow::Result<(f64, i64)>)> {
        let reads = ids.into_iter().map(|raw_market_id| async move {
            let url = format!("{}{MARK_PATH}?contract_code={raw_market_id}&period=1min&size=1", self.rest);
            let read = read_mark(http, &url).await.map(|mark| (mark, now_ms()));
            (raw_market_id, read)
        });
        stream::iter(reads).buffer_unordered(MARKS_IN_FLIGHT).collect().await
    }
}

async fn read_mark(http: &reqwest::Client, url: &str) -> anyhow::Result<f64> {
    let klines: Vec<Kline> = get_data(http, url).await?;
    match klines.first() {
        Some(kline) if kline.close.is_finite() && kline.close > 0.0 => Ok(kline.close),
        _ => anyhow::bail!("no mark kline from {url}"),
    }
}

// Every call answers HTTP 200 with status "error" on a failure, spelled err_code with a number on the API calls and err-code with a word on market calls.
pub async fn get_data<T: DeserializeOwned>(http: &reqwest::Client, url: &str) -> anyhow::Result<T> {
    let body = match get_bytes(http, url).await {
        Ok(body) => body,
        Err(error) if error.to_string().starts_with(EDGE_BLOCK_STATUS) => {
            return Err(RateLimited {
                url: url.to_string(),
                reason: "567 Restricted Access".to_string(),
                retry_after: Some(EDGE_BLOCK_PAUSE),
            }
            .into());
        }
        Err(error) => return Err(error),
    };
    reject_challenge(&body, url)?;
    let status: Status = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;

    if status.status != "ok" {
        let code = match status.err_code.or(status.err_code_dashed) {
            Some(serde_json::Value::String(code)) => code,
            Some(code) => code.to_string(),
            None => String::new(),
        };
        let message = status.err_msg.or(status.err_msg_dashed).unwrap_or_default();
        if code == RATE_LIMIT_CODE || message == RATE_LIMIT_MESSAGE {
            return Err(RateLimited {
                url: url.to_string(),
                reason: format!("code {code}: {message}"),
                retry_after: None,
            }
            .into());
        }
        anyhow::bail!("code {code}: {message} from {url}");
    }

    let reply: Data<T> = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;
    Ok(reply.data)
}

// Under a steady load EdgeOne sometimes answers HTTP 200 with an HTML bot challenge for a few seconds, which the next rounds outlast.
fn reject_challenge(body: &[u8], url: &str) -> anyhow::Result<()> {
    if body.starts_with(b"<") {
        anyhow::bail!("EdgeOne challenge page instead of JSON from {url}");
    }
    Ok(())
}

#[derive(Deserialize)]
struct Status {
    #[serde(default)]
    status: String, // "ok" or "error"
    err_code: Option<serde_json::Value>, // 1032 on a rate limit, 1014 for an unknown contract
    #[serde(rename = "err-code")]
    err_code_dashed: Option<serde_json::Value>, // "invalid-parameter"
    err_msg: Option<String>,
    #[serde(rename = "err-msg")]
    err_msg_dashed: Option<String>,
}

#[derive(Deserialize)]
struct Data<T> {
    data: T,
}

#[derive(Deserialize)]
struct Index {
    #[serde(default)]
    contract_code: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64, // a JSON number
    #[serde(default)]
    index_ts: i64, // Unix ms of the venue's computation, shared by nearly every row
}

#[derive(Deserialize)]
struct Funding {
    #[serde(default)]
    contract_code: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // a decimal string per interval, "0E-18" for zero, and the live rate until settlement
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_time: f64, // Unix ms string of the settlement the rate applies to, while next_funding_time is null
}

#[derive(Deserialize)]
struct Kline {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    close: f64, // a decimal string, the latest mark
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, market, tracked};
    use serde_json::{Value, json};

    // Replies captured live on 2026-10-08 at 05:26 UTC on 2026-10-09, cut to two or three rows.
    fn index_reply(index_ts: i64) -> Value {
        json!({ "status": "ok", "ts": 1791523588684_i64, "data": [
            { "index_price": 82446.23157142857, "index_ts": index_ts, "contract_code": "BTC-USDT", "trade_partition": "USDT" },
            { "index_price": 233.07558009, "index_ts": index_ts, "contract_code": "NVDA-USDT", "trade_partition": "USDT" },
            { "index_price": 2.1, "index_ts": 1747706678010_i64, "contract_code": "CVX-USDT", "trade_partition": "USDT" },
        ]})
    }

    fn funding_reply() -> Value {
        json!({ "status": "ok", "ts": 1791523588684_i64, "data": [
            {
                "estimated_rate": null, "funding_rate": "0.000050000000000000", "contract_code": "BTC-USDT", "symbol": "BTC",
                "fee_asset": "USDT", "funding_time": "1791532800000", "next_funding_time": null, "trade_partition": "USDT",
            },
            {
                "estimated_rate": null, "funding_rate": "0E-18", "contract_code": "NVDA-USDT", "symbol": "NVDA",
                "fee_asset": "USDT", "funding_time": "1791532800000", "next_funding_time": null, "trade_partition": "USDT",
            },
        ]})
    }

    fn contracts_reply() -> Value {
        json!({ "status": "ok", "ts": 1791523588684_i64, "data": [
            { "symbol": "BTC", "contract_code": "BTC-USDT", "contract_size": 0.001, "contract_status": 1, "settlement_period": "8", "business_type": "swap", "delivery_date": "" },
            { "symbol": "NVDA", "contract_code": "NVDA-USDT", "contract_size": 0.01, "contract_status": 1, "settlement_period": "4", "business_type": "swap", "delivery_date": "" },
        ]})
    }

    fn mark_path(raw_market_id: &str) -> String {
        format!("{MARK_PATH}?contract_code={raw_market_id}&period=1min&size=1")
    }

    fn mark_reply(raw_market_id: &str, close: &str) -> Value {
        json!({ "ch": format!("market.{raw_market_id}.mark_price.1min"), "status": "ok", "ts": 1791523588684_i64, "data": [
            { "id": 1791523560, "open": close, "close": close, "high": close, "low": close, "amount": "0", "vol": "0", "trade_turnover": "0", "count": "0" },
        ]})
    }

    fn rest_with_bulk(rest: &MockRest, index_ts: i64) {
        rest.reply(INDEX_PATH, index_reply(index_ts));
        rest.reply(FUNDING_PATH, funding_reply());
        rest.reply(CONTRACTS_PATH, contracts_reply());
    }

    fn venue(rest: &MockRest, raw_market_ids: &[&str]) -> Htx {
        let mut markets = Vec::new();
        for id in raw_market_ids {
            markets.push(market(ID, id, id.split('-').next().unwrap(), "USDT", true));
        }
        Htx::with_rest(&tracked(&markets), &rest.url)
    }

    fn mark_calls(rest: &MockRest) -> Vec<String> {
        rest.calls().into_iter().filter(|call| call.starts_with(MARK_PATH)).collect()
    }

    fn keys(rows: &AnchorMap) -> Vec<&str> {
        let mut keys: Vec<&str> = rows.keys().map(String::as_str).collect();
        keys.sort();
        keys
    }

    #[test]
    fn polls_every_second_and_pauses_three_seconds_on_a_rate_limit() {
        let venue = Htx::new(&[]);

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(3));
    }

    #[tokio::test]
    async fn merges_index_funding_interval_and_the_mark_kline_into_one_row() {
        let rest = MockRest::start().await;
        let index_ts = now_ms() - 800;
        rest_with_bulk(&rest, index_ts);
        rest.reply(&mark_path("BTC-USDT"), mark_reply("BTC-USDT", "82430.5"));

        let rows = venue(&rest, &["BTC-USDT"]).fetch_round(&http(), 0).await.unwrap();

        assert_eq!(keys(&rows), ["BTC-USDT"]);
        assert_eq!(
            rows["BTC-USDT"],
            AnchorRow {
                index: 82446.23157142857,
                mark: 82430.5,
                funding_rate: 0.00005,
                funding_interval_hours: 8.0,
                next_funding_at: 1_791_532_800_000,
                ts: Some(index_ts),
            }
        );
    }

    #[tokio::test]
    async fn reads_a_zero_rate_and_the_interval_of_each_contract() {
        let rest = MockRest::start().await;
        rest_with_bulk(&rest, now_ms());
        rest.reply(&mark_path("BTC-USDT"), mark_reply("BTC-USDT", "82430.5"));
        rest.reply(&mark_path("NVDA-USDT"), mark_reply("NVDA-USDT", "233.1"));

        let rows = venue(&rest, &["BTC-USDT", "NVDA-USDT"]).fetch_round(&http(), 0).await.unwrap();

        assert_eq!(rows["NVDA-USDT"].funding_rate, 0.0);
        assert_eq!(rows["NVDA-USDT"].funding_interval_hours, 4.0);
        assert_eq!(rows["NVDA-USDT"].mark, 233.1);
    }

    #[tokio::test]
    async fn stamps_a_row_with_the_older_of_its_index_time_and_its_mark_arrival() {
        let rest = MockRest::start().await;
        rest_with_bulk(&rest, now_ms() + 100_000);
        rest.reply(&mark_path("BTC-USDT"), mark_reply("BTC-USDT", "82430.5"));
        rest.reply(&mark_path("NVDA-USDT"), mark_reply("NVDA-USDT", "233.1"));
        rest.reply(&mark_path("CVX-USDT"), mark_reply("CVX-USDT", "2.1"));
        let venue = venue(&rest, &["BTC-USDT", "NVDA-USDT", "CVX-USDT"]);

        // An index stamped ahead of our clock is capped at arrival.
        let before = now_ms();
        let rows = venue.fetch_round(&http(), 0).await.unwrap();
        let after = now_ms();
        let ts = rows["BTC-USDT"].ts.unwrap();
        assert!(before <= ts && ts <= after, "{before} <= {ts} <= {after}");

        // A mark read 4 s ago, and not reread this round since the next slice is NVDA-USDT, makes the row 4 s old.
        venue.anchor.lock().unwrap().marks.insert("BTC-USDT".to_string(), (82_000.0, before - 4_000));
        let rows = venue.fetch_round(&http(), 0).await.unwrap();
        assert_eq!(rows["BTC-USDT"].ts, Some(before - 4_000));
        assert_eq!(rows["BTC-USDT"].mark, 82_000.0);
    }

    #[tokio::test]
    async fn stamps_a_frozen_index_with_its_own_time_and_an_index_with_no_time_on_arrival() {
        let rest = MockRest::start().await;
        rest_with_bulk(&rest, now_ms() - 20_000);
        let mut index = index_reply(now_ms() - 20_000);
        index["data"][1].as_object_mut().unwrap().remove("index_ts");
        rest.reply(INDEX_PATH, index);
        rest.reply(&mark_path("BTC-USDT"), mark_reply("BTC-USDT", "82430.5"));
        rest.reply(&mark_path("NVDA-USDT"), mark_reply("NVDA-USDT", "233.1"));

        let before = now_ms();
        let rows = venue(&rest, &["BTC-USDT", "NVDA-USDT"]).fetch_round(&http(), 0).await.unwrap();

        assert!(rows["BTC-USDT"].ts.unwrap() < before - 19_000, "{:?}", rows["BTC-USDT"]);
        assert!(rows["NVDA-USDT"].ts.unwrap() >= before, "{:?}", rows["NVDA-USDT"]);
    }

    #[tokio::test]
    async fn sends_zero_for_a_next_funding_that_is_not_a_number() {
        let rest = MockRest::start().await;
        rest_with_bulk(&rest, now_ms());
        let mut funding = funding_reply();
        funding["data"][0]["funding_time"] = Value::Null;
        rest.reply(FUNDING_PATH, funding);
        rest.reply(&mark_path("BTC-USDT"), mark_reply("BTC-USDT", "82430.5"));

        let rows = venue(&rest, &["BTC-USDT"]).fetch_round(&http(), 0).await.unwrap();

        assert_eq!(rows["BTC-USDT"].next_funding_at, 0);
        assert_eq!(rows["BTC-USDT"].funding_rate, 0.00005);
    }

    #[tokio::test]
    async fn keeps_the_marks_read_in_a_round_that_a_bulk_call_fails() {
        let rest = MockRest::start().await;
        rest_with_bulk(&rest, now_ms());
        rest.fail(INDEX_PATH, 500);
        rest.reply(&mark_path("BTC-USDT"), mark_reply("BTC-USDT", "82430.5"));
        let venue = venue(&rest, &["BTC-USDT", "NVDA-USDT", "C-USDT"]);

        assert!(venue.fetch_round(&http(), 0).await.is_err());

        assert_eq!(venue.anchor.lock().unwrap().marks["BTC-USDT"].0, 82430.5);
    }

    #[tokio::test]
    async fn leaves_out_a_market_whose_mark_kline_is_empty() {
        let rest = MockRest::start().await;
        rest_with_bulk(&rest, now_ms());
        rest.reply(&mark_path("BTC-USDT"), mark_reply("BTC-USDT", "82430.5"));
        rest.reply(&mark_path("NVDA-USDT"), json!({ "ch": "market.NVDA-USDT.mark_price.1min", "status": "ok", "ts": 1791523588684_i64, "data": [] }));

        let rows = venue(&rest, &["BTC-USDT", "NVDA-USDT"]).fetch_round(&http(), 0).await.unwrap();

        assert_eq!(keys(&rows), ["BTC-USDT"]);
    }

    #[tokio::test]
    async fn reads_every_mark_in_the_first_round_and_then_a_third_per_round_in_rotation() {
        let rest = MockRest::start().await;
        rest_with_bulk(&rest, now_ms());
        let ids = ["A-USDT", "B-USDT", "C-USDT", "D-USDT", "E-USDT", "F-USDT"];
        for id in ids {
            rest.reply(&mark_path(id), mark_reply(id, "1.5"));
        }
        let venue = venue(&rest, &ids);

        venue.fetch_round(&http(), 0).await.unwrap();
        let mut first = mark_calls(&rest);
        first.sort();
        assert_eq!(first.len(), 6);

        venue.fetch_round(&http(), 0).await.unwrap();
        venue.fetch_round(&http(), 0).await.unwrap();
        venue.fetch_round(&http(), 0).await.unwrap();
        let mut later: Vec<String> = mark_calls(&rest).split_off(6);
        later[..2].sort();
        later[2..4].sort();
        later[4..].sort();
        let expected: Vec<String> = ["C-USDT", "D-USDT", "E-USDT", "F-USDT", "A-USDT", "B-USDT"].iter().map(|id| mark_path(id)).collect();
        assert_eq!(later, expected);
    }

    #[tokio::test]
    async fn reads_the_intervals_once_a_minute_and_keeps_them_when_a_later_read_fails() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest_with_bulk(&rest, now_ms());
        rest.reply(&mark_path("BTC-USDT"), mark_reply("BTC-USDT", "82430.5"));
        let venue = venue(&rest, &["BTC-USDT"]);

        venue.fetch_round(&http(), 0).await.unwrap();
        venue.fetch_round(&http(), 0).await.unwrap();
        let reads = rest.calls().into_iter().filter(|call| call == CONTRACTS_PATH).count();
        assert_eq!(reads, 1);

        rest.fail(CONTRACTS_PATH, 500);
        venue.anchor.lock().unwrap().intervals_read_at -= INTERVALS_EVERY_MS;
        let rows = venue.fetch_round(&http(), 0).await.unwrap();
        assert_eq!(rows["BTC-USDT"].funding_interval_hours, 8.0);
        assert_eq!(logs.events("intervals_read_failed").len(), 1);
    }

    #[tokio::test]
    async fn fails_the_round_when_the_first_interval_read_fails() {
        let rest = MockRest::start().await;
        rest.reply(INDEX_PATH, index_reply(now_ms()));
        rest.reply(FUNDING_PATH, funding_reply());
        rest.reply(&mark_path("BTC-USDT"), mark_reply("BTC-USDT", "82430.5"));

        let error = venue(&rest, &["BTC-USDT"]).fetch_round(&http(), 0).await.unwrap_err();

        assert!(error.to_string().contains("404 Not Found"), "{error:#}");
    }

    #[tokio::test]
    async fn leaves_out_a_market_whose_mark_read_fails_and_logs_it_once() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest_with_bulk(&rest, now_ms());
        rest.reply(&mark_path("BTC-USDT"), mark_reply("BTC-USDT", "82430.5"));
        rest.reply(&mark_path("NVDA-USDT"), json!({ "ts": 1791523737534_i64, "status": "error", "err-code": "invalid-parameter", "err-msg": "invalid  symbol" }));
        let venue = venue(&rest, &["BTC-USDT", "NVDA-USDT"]);

        for _ in 0..3 {
            let rows = venue.fetch_round(&http(), 0).await.unwrap();
            assert_eq!(keys(&rows), ["BTC-USDT"]);
        }

        let warnings = logs.events("mark_read_failed");
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].text("market"), "NVDA-USDT");
        assert!(warnings[0].text("error").contains("code invalid-parameter: invalid  symbol"), "{:?}", warnings[0]);
    }

    #[tokio::test]
    async fn leaves_out_a_row_whose_mark_is_older_than_ten_seconds() {
        let rest = MockRest::start().await;
        rest_with_bulk(&rest, now_ms());
        rest.reply(&mark_path("BTC-USDT"), mark_reply("BTC-USDT", "82430.5"));
        rest.reply(&mark_path("NVDA-USDT"), mark_reply("NVDA-USDT", "233.1"));
        rest.reply(&mark_path("C-USDT"), mark_reply("C-USDT", "1.5"));
        let venue = venue(&rest, &["BTC-USDT", "NVDA-USDT", "C-USDT"]);
        venue.fetch_round(&http(), 0).await.unwrap();

        // The next slice is NVDA-USDT, so BTC-USDT keeps its old reading.
        venue.anchor.lock().unwrap().marks.insert("BTC-USDT".to_string(), (82_000.0, now_ms() - 11_000));
        let rows = venue.fetch_round(&http(), 0).await.unwrap();

        assert_eq!(keys(&rows), ["NVDA-USDT"]);
    }

    #[tokio::test]
    async fn leaves_out_a_tracked_market_missing_from_the_index_or_funding_reply() {
        let rest = MockRest::start().await;
        rest_with_bulk(&rest, now_ms());
        rest.reply(&mark_path("BTC-USDT"), mark_reply("BTC-USDT", "82430.5"));
        rest.reply(&mark_path("CVX-USDT"), mark_reply("CVX-USDT", "2.1"));
        rest.reply(&mark_path("ETH-USDT"), mark_reply("ETH-USDT", "4100.2"));

        let rows = venue(&rest, &["BTC-USDT", "CVX-USDT", "ETH-USDT"]).fetch_round(&http(), 0).await.unwrap();

        assert_eq!(keys(&rows), ["BTC-USDT"]);
    }

    #[tokio::test]
    async fn reads_code_1032_in_a_200_body_of_a_bulk_call_as_a_rate_limit() {
        let rest = MockRest::start().await;
        rest_with_bulk(&rest, now_ms());
        rest.reply(INDEX_PATH, json!({ "status": "error", "err_code": 1032, "err_msg": "The number of access exceeded the limit.", "ts": 1 }));
        rest.reply(&mark_path("BTC-USDT"), mark_reply("BTC-USDT", "82430.5"));

        let error = venue(&rest, &["BTC-USDT"]).fetch_round(&http(), 0).await.unwrap_err();

        let reason = &error.downcast_ref::<RateLimited>().expect("a RateLimited error").reason;
        assert_eq!(reason, "code 1032: The number of access exceeded the limit.");
    }

    // Captured live on 2026-10-08, while 377 marks were read at once.
    fn request_limit() -> Value {
        json!({ "ts": 1791524537534_i64, "status": "error", "err-code": "bad-request", "err-msg": "request limit" })
    }

    #[tokio::test]
    async fn keeps_the_last_mark_of_a_refused_read_while_other_reads_land() {
        let rest = MockRest::start().await;
        rest_with_bulk(&rest, now_ms());
        rest.reply(&mark_path("BTC-USDT"), mark_reply("BTC-USDT", "82430.5"));
        rest.reply(&mark_path("NVDA-USDT"), mark_reply("NVDA-USDT", "233.1"));
        rest.reply(&mark_path("C-USDT"), mark_reply("C-USDT", "1.5"));
        rest.reply(&mark_path("D-USDT"), mark_reply("D-USDT", "2.5"));
        let venue = venue(&rest, &["BTC-USDT", "NVDA-USDT", "C-USDT", "D-USDT"]);
        venue.fetch_round(&http(), 0).await.unwrap();

        // The rotation comes back to BTC-USDT and NVDA-USDT, and only the second read lands.
        venue.anchor.lock().unwrap().next = 0;
        rest.reply(&mark_path("BTC-USDT"), request_limit());
        rest.reply(&mark_path("NVDA-USDT"), mark_reply("NVDA-USDT", "233.2"));
        let rows = venue.fetch_round(&http(), 0).await.unwrap();

        assert_eq!(rows["BTC-USDT"].mark, 82430.5);
        assert_eq!(rows["NVDA-USDT"].mark, 233.2);
        let reads: Vec<String> = mark_calls(&rest).split_off(4);
        assert_eq!(reads.len(), 2);
    }

    #[tokio::test]
    async fn fails_the_round_as_rate_limited_when_every_mark_read_is_refused() {
        let rest = MockRest::start().await;
        rest_with_bulk(&rest, now_ms());
        rest.reply(&mark_path("BTC-USDT"), request_limit());

        let error = venue(&rest, &["BTC-USDT"]).fetch_round(&http(), 0).await.unwrap_err();

        let reason = &error.downcast_ref::<RateLimited>().expect("a RateLimited error").reason;
        assert_eq!(reason, "code bad-request: request limit");
    }

    #[tokio::test]
    async fn fails_the_round_on_an_error_body_or_a_429_from_a_bulk_call() {
        let rest = MockRest::start().await;
        rest_with_bulk(&rest, now_ms());
        rest.reply(FUNDING_PATH, json!({ "status": "error", "err_code": 1014, "err_msg": "This contract doesnt exist.", "ts": 1 }));
        rest.reply(&mark_path("BTC-USDT"), mark_reply("BTC-USDT", "82430.5"));
        let error = venue(&rest, &["BTC-USDT"]).fetch_round(&http(), 0).await.unwrap_err();
        assert!(error.to_string().starts_with("code 1014: This contract doesnt exist."), "{error:#}");

        let rest = MockRest::start().await;
        rest_with_bulk(&rest, now_ms());
        rest.fail(INDEX_PATH, 429);
        rest.reply(&mark_path("BTC-USDT"), mark_reply("BTC-USDT", "82430.5"));
        let error = venue(&rest, &["BTC-USDT"]).fetch_round(&http(), 0).await.unwrap_err();
        assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");
    }

    // The start of the page captured live on 2026-10-08, which came as HTTP 200 with content-type text/html.
    #[test]
    fn names_the_edge_challenge_page_that_replaces_a_reply() {
        let page = br#"<script>function a(a){function n(){for(var a={wQzOV:_0x649a("0x4")};;){switch(n[e++]){case"0":t+="EO_Bot_Ssid=";continue;}}}}</script>"#;

        let error = reject_challenge(page, "https://api.hbdm.vn/linear-swap-api/v1/swap_index").unwrap_err();

        assert_eq!(error.to_string(), "EdgeOne challenge page instead of JSON from https://api.hbdm.vn/linear-swap-api/v1/swap_index");
        assert!(reject_challenge(br#"{"status":"ok"}"#, "u").is_ok());
    }

    // EdgeOne answered every call with this status for minutes after a probe read 377 marks a second on 2026-10-08.
    #[tokio::test]
    async fn stands_back_a_minute_when_the_edge_answers_567() {
        let rest = MockRest::start().await;
        rest_with_bulk(&rest, now_ms());
        rest.fail(INDEX_PATH, 567);
        rest.fail(&mark_path("BTC-USDT"), 567);

        let error = venue(&rest, &["BTC-USDT"]).fetch_round(&http(), 0).await.unwrap_err();

        let limited = error.downcast_ref::<RateLimited>().expect("a RateLimited error");
        assert_eq!(limited.reason, "567 Restricted Access");
        assert_eq!(limited.retry_after, Some(Duration::from_secs(60)));
    }
}

// A probe of the mark kline's limit, which reads every listed mark PROBE_ROUNDS times at PROBE_IN_FLIGHT and prints each refusal:
// cargo test htx::anchor::probe::probe_live_mark_limit -- --ignored --nocapture
#[cfg(test)]
mod probe {
    use super::*;
    use crate::venues::testing::http;

    #[tokio::test]
    #[ignore]
    async fn probe_live_mark_limit() {
        let env = |name: &str, default: usize| std::env::var(name).ok().and_then(|s| s.parse().ok()).unwrap_or(default);
        let (rounds, in_flight, per_round) = (env("PROBE_ROUNDS", 3), env("PROBE_IN_FLIGHT", 128), env("PROBE_PER_ROUND", 377));
        let client = http();
        let venue = crate::venues::htx::load(&client).await.unwrap();
        let ids: Vec<String> = venue.markets.iter().map(|m| m.raw_market_id.clone()).collect();
        for round in 0..rounds {
            let started = std::time::Instant::now();
            let slice: Vec<String> = ids.iter().cycle().skip(round * per_round).take(per_round).cloned().collect();
            let reads = slice.into_iter().map(|id| {
                let client = client.clone();
                async move {
                    let url = format!("{}{MARK_PATH}?contract_code={id}&period=1min&size=1", super::super::REST);
                    (id, read_mark(&client, &url).await)
                }
            });
            let results: Vec<_> = stream::iter(reads).buffer_unordered(in_flight).collect().await;
            let failed: Vec<String> = results.iter().filter_map(|(id, r)| r.as_ref().err().map(|e| format!("{id} {e:#}"))).collect();
            println!("round {round}: {} reads in {} ms, {} failed {:?}", results.len(), started.elapsed().as_millis(), failed.len(), &failed[..failed.len().min(3)]);
            tokio::time::sleep(Duration::from_millis(1_000u64.saturating_sub(started.elapsed().as_millis() as u64))).await;
        }
    }

    // How old each row is when its round returns, over PROBE_SECONDS of rounds on every listed market:
    // cargo test htx::anchor::probe::probe_live_row_age -- --ignored --nocapture
    #[tokio::test]
    #[ignore]
    async fn probe_live_row_age() {
        use crate::venues::testing::tracked;
        let seconds: u64 = std::env::var("PROBE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(30);
        let client = http();
        let catalog = crate::venues::htx::load(&client).await.unwrap();
        let venue = Htx::new(&tracked(&catalog.markets));
        let deadline = std::time::Instant::now() + Duration::from_secs(seconds);
        let mut ages = Vec::new();
        let mut round_ms = Vec::new();
        let mut timer = tokio::time::interval(venue.poll_every());
        timer.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Skip);
        while std::time::Instant::now() < deadline {
            timer.tick().await;
            let started = std::time::Instant::now();
            let rows = match venue.fetch_round(&client, 0).await {
                Ok(rows) => rows,
                Err(error) => {
                    println!("round failed at {}: {error:#}", now_ms());
                    continue;
                }
            };
            let arrived = now_ms();
            round_ms.push(started.elapsed().as_millis() as i64);
            if round_ms.len() > 3 {
                ages.extend(rows.values().map(|row| arrived - row.ts.unwrap()));
            }
        }
        ages.sort();
        round_ms.sort();
        let at = |v: &Vec<i64>, q: f64| v[((v.len() - 1) as f64 * q) as usize];
        println!("{} rounds, round ms median {} p90 {} max {}", round_ms.len(), at(&round_ms, 0.5), at(&round_ms, 0.9), at(&round_ms, 1.0));
        println!("row age ms median {} p90 {} p99 {} max {}", at(&ages, 0.5), at(&ages, 0.9), at(&ages, 0.99), at(&ages, 1.0));
    }
}
