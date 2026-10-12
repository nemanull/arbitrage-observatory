use super::{ID, Uzx};
use crate::clock::now_ms;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, RateLimited, get_bytes};
use crate::venues::wire;
use anyhow::Context;
use futures_util::StreamExt;
use futures_util::stream;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::collections::{HashMap, HashSet};
use std::time::Duration;

// One documented call carries index, mark, rate and next settlement for every perpetual, at 20 calls per 2 s per IP.
pub const TICKERS_PATH: &str = "/notification/swap/tickers";

// The interval is on no bulk call, and the web host's funding history names it as the cycle of each settlement.
pub const HISTORY_PATH: &str = "/v2/info/swap/history/funding";

// The web client maps this code to "Too many requests", and no limit was reached to show its HTTP status.
const RATE_LIMIT_CODE: i64 = 100429;

// Every unknown interval is read at once, a few requests at a time, so the first round can already carry every market.
const INTERVAL_READS_AT_ONCE: usize = 4;
const INTERVAL_RETRY_MS: i64 = 60_000;
// A known interval is read again after an hour, at most one market a round, since 8 h and 4 h contracts change it rarely.
const INTERVAL_REFRESH_MS: i64 = 3_600_000;

#[derive(Default)]
pub struct Intervals {
    hours: HashMap<String, f64>,    // raw id to the cycle of its newest settlement
    tried_at: HashMap<String, i64>, // Unix ms of each market's last request, success or not
    warned: HashSet<String>,
}

impl AnchorVenue for Uzx {
    // The window is 2 s and no Retry-After was seen.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(2)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let due = self.due_intervals((self.clock)());
        let tickers_url = format!("{}{TICKERS_PATH}", self.rest);
        let tickers = async {
            let tickers: Vec<Ticker> = get_data(http, &tickers_url).await?;
            anyhow::Ok((tickers, now_ms()))
        };
        let (tickers, ()) = tokio::join!(tickers, self.read_intervals(http, due));
        let (tickers, arrived_at) = tickers?;

        let intervals = self.intervals.lock().unwrap();
        let mut rows = AnchorMap::with_capacity(intervals.hours.len());
        for ticker in tickers {
            // A delisted contract stays in the reply with zero prices and no next settlement, and an untracked one has no interval.
            let Some(&hours) = intervals.hours.get(&ticker.symbol) else {
                continue;
            };
            if !(ticker.funding_next_time > 0.0) {
                continue;
            }

            // The index basket is not published, and the one contract likely to index itself, UZXUSDT, is denied by the loader.
            rows.insert(
                ticker.symbol,
                AnchorRow {
                    index: ticker.index.close,
                    mark: ticker.tag.close,
                    funding_rate: ticker.funding_rate, // a copy of Binance's running estimate, see docs/profiles/uzx/rest.md section 4
                    funding_interval_hours: hours,
                    next_funding_at: (ticker.funding_next_time * 1_000.0) as i64,
                    // Interval reads can hold the round past the ticker's arrival.
                    ts: Some(arrived_at),
                },
            );
        }

        Ok(rows)
    }
}

impl Uzx {
    // Every market with no interval that was not tried in the last minute, or else the one known interval read longest ago, once it is an hour old.
    fn due_intervals(&self, now: i64) -> Vec<String> {
        let mut intervals = self.intervals.lock().unwrap();
        let mut due = Vec::new();
        let mut oldest: Option<(&String, i64)> = None;

        for raw_market_id in &self.markets {
            let tried_at = intervals.tried_at.get(raw_market_id).copied();
            if !intervals.hours.contains_key(raw_market_id) {
                if tried_at.is_none_or(|at| now - at >= INTERVAL_RETRY_MS) {
                    due.push(raw_market_id.clone());
                }
                continue;
            }

            let at = tried_at.unwrap_or(0);
            if now - at >= INTERVAL_REFRESH_MS && oldest.is_none_or(|(_, oldest_at)| at < oldest_at) {
                oldest = Some((raw_market_id, at));
            }
        }

        if due.is_empty()
            && let Some((raw_market_id, _)) = oldest
        {
            due.push(raw_market_id.clone());
        }

        for raw_market_id in &due {
            intervals.tried_at.insert(raw_market_id.clone(), now);
        }
        due
    }

    // A market keeps its last interval when a read fails, and one never read stays out of the rows.
    async fn read_intervals(&self, http: &reqwest::Client, due: Vec<String>) {
        if due.is_empty() {
            return;
        }

        let replies: Vec<(String, anyhow::Result<History>)> = stream::iter(due)
            .map(|raw_market_id| async move {
                let url = format!("{}{HISTORY_PATH}?symbol={raw_market_id}&page=1&size=1", self.web);
                let reply = get_data::<History>(http, &url).await;
                (raw_market_id, reply)
            })
            .buffer_unordered(INTERVAL_READS_AT_ONCE)
            .collect()
            .await;

        let mut intervals = self.intervals.lock().unwrap();
        for (raw_market_id, reply) in replies {
            let hours = reply.and_then(|history| {
                let cycle = history.list.first().map_or(f64::NAN, |settlement| settlement.cycle);
                // A contract that never settled has no cycle yet.
                anyhow::ensure!(cycle > 0.0, "no settlement with a cycle");
                Ok(cycle)
            });

            match hours {
                Ok(hours) => {
                    intervals.hours.insert(raw_market_id, hours);
                }
                Err(error) => {
                    if intervals.warned.insert(raw_market_id.clone()) {
                        tracing::warn!(event = "funding_interval_read_failed", venue = ID, market = %raw_market_id, error = format!("{error:#}"));
                    }
                }
            }
        }
    }
}

// Every call answers {"code": 200, "msg": "success", "data": ...} on success.
pub async fn get_data<T: DeserializeOwned>(http: &reqwest::Client, url: &str) -> anyhow::Result<T> {
    let body = get_bytes(http, url).await?;
    let status: Status = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;

    if status.code == RATE_LIMIT_CODE {
        return Err(RateLimited {
            url: url.to_string(),
            reason: format!("code {}", status.code),
            retry_after: None,
        }
        .into());
    }
    if status.code != 200 {
        anyhow::bail!("code {}: {} from {url}", status.code, status.msg);
    }

    let reply: Data<T> = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;
    Ok(reply.data)
}

#[derive(Deserialize)]
struct Status {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    msg: String,
}

#[derive(Deserialize)]
struct Data<T> {
    data: T,
}

// Every price is a decimal string.
#[derive(Deserialize)]
struct Ticker {
    #[serde(default)]
    symbol: String, // "BTCUSDT"
    #[serde(default)]
    index: Candle,
    #[serde(default)]
    tag: Candle, // the mark
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // a fraction per interval, equal to pre_funding_rate
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_next_time: f64, // Unix seconds, absent on a delisted contract
}

#[derive(Deserialize)]
struct Candle {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    close: f64,
}

impl Default for Candle {
    fn default() -> Self {
        Self { close: f64::NAN }
    }
}

#[derive(Deserialize)]
struct History {
    #[serde(default)]
    list: Vec<Settlement>, // newest first
}

#[derive(Deserialize)]
struct Settlement {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    cycle: f64, // hours, 8 or 4
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, market, tracked};
    use serde_json::{Value, json};
    use std::cell::Cell;

    thread_local! {
        static NOW: Cell<i64> = const { Cell::new(1_791_570_000_000) };
    }

    fn clock() -> i64 {
        NOW.with(Cell::get)
    }

    fn advance(ms: i64) {
        NOW.with(|now| now.set(now.get() + ms));
    }

    fn history_path(raw_market_id: &str) -> String {
        format!("{HISTORY_PATH}?symbol={raw_market_id}&page=1&size=1")
    }

    fn candle(open: &str, close: &str) -> Value {
        json!({ "open": open, "close": close, "low": open, "high": close })
    }

    // Rows trimmed from the ticker reply captured live on 2026-10-09 at 18:18 UTC, with their 24 h market block cut.
    fn tickers() -> Value {
        json!({ "ch": "swap.tickers", "code": 200, "msg": "success", "ts": 1791569883476u64, "data": [
            {
                "market": { "open": "80908.2", "close": "82585", "count": 0, "vol": "26524.253" },
                "index": candle("81757.1", "82623.9"), "tag": candle("81714.9", "82588"),
                "funding_rate": "0.00003716", "funding_next_time": 1791590400, "pre_funding_rate": "0.00003716",
                "symbol": "BTCUSDT", "risk_fund": "0",
            },
            {
                "market": { "open": "83.501", "close": "84.837", "count": 0, "vol": "555883.8" },
                "index": candle("84.23", "84.89"), "tag": candle("84.197", "84.846"),
                "funding_rate": "0.00002225", "funding_next_time": 1791576000, "pre_funding_rate": "0.00002225",
                "symbol": "HYPEUSDT", "risk_fund": "0",
            },
            {
                "market": { "open": "0", "close": "0", "count": 0, "vol": "0" },
                "index": candle("0.0762", "0.0814"), "tag": candle("0.0762", "0.0814"),
                "funding_rate": "0", "pre_funding_rate": "0", "symbol": "LISTAUSDT", "risk_fund": "0",
            },
            {
                "market": { "open": "80851.7", "close": "82520", "count": 0, "vol": "695.4987858309008549197539310449561744119" },
                "index": candle("81756.5", "82625.6"), "tag": candle("81657.4", "82520"),
                "funding_rate": "0.00002492", "funding_next_time": 1791590400, "pre_funding_rate": "0.00002492",
                "symbol": "BTCUSD", "risk_fund": "0",
            },
        ]})
    }

    // The newest settlement, as captured live for BTCUSDT on 2026-10-09, with the cycle of each contract.
    fn history(raw_market_id: &str, cycle: u64) -> Value {
        json!({ "code": 200, "msg": "success", "data": { "current": 1, "total": 1420, "list": [
            { "cycle": cycle, "rate": "0.00001238", "symbol": raw_market_id, "time": 1791561600000u64 },
        ]}})
    }

    fn reply_histories(rest: &MockRest) {
        rest.reply(&history_path("BTCUSDT"), history("BTCUSDT", 8));
        rest.reply(&history_path("HYPEUSDT"), history("HYPEUSDT", 4));
        rest.reply(&history_path("LISTAUSDT"), history("LISTAUSDT", 8));
    }

    fn poller(rest: &MockRest, raw_market_ids: &[&str]) -> Uzx {
        let mut markets = Vec::new();
        for id in raw_market_ids {
            markets.push(market(ID, id, id.strip_suffix("USDT").unwrap(), "USDT", true));
        }
        Uzx::with_hosts(&tracked(&markets), &rest.url, &rest.url, clock)
    }

    fn keys(rows: &AnchorMap) -> Vec<&str> {
        let mut keys: Vec<&str> = rows.keys().map(String::as_str).collect();
        keys.sort();
        keys
    }

    fn history_calls(rest: &MockRest) -> Vec<String> {
        rest.calls().into_iter().filter(|call| call.starts_with(HISTORY_PATH)).collect()
    }

    #[tokio::test]
    async fn maps_a_ticker_row_with_the_interval_of_its_newest_settlement() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, tickers());
        reply_histories(&rest);

        let before = now_ms();
        let rows = poller(&rest, &["BTCUSDT", "HYPEUSDT"]).fetch_round(&http(), 0).await.unwrap();
        let after = now_ms();

        let btc = rows["BTCUSDT"];
        assert_eq!(
            (btc.index, btc.mark, btc.funding_rate, btc.funding_interval_hours, btc.next_funding_at),
            (82623.9, 82588.0, 0.00003716, 8.0, 1_791_590_400_000)
        );
        let ts = btc.ts.unwrap();
        assert!(before <= ts && ts <= after, "{before} <= {ts} <= {after}");
        assert_eq!(rows["HYPEUSDT"].funding_interval_hours, 4.0);
        assert_eq!(rows["HYPEUSDT"].next_funding_at, 1_791_576_000_000);
    }

    #[tokio::test]
    async fn leaves_out_a_delisted_row_with_no_next_settlement_and_every_untracked_row() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, tickers());
        reply_histories(&rest);

        let rows = poller(&rest, &["BTCUSDT", "LISTAUSDT"]).fetch_round(&http(), 0).await.unwrap();

        assert_eq!(keys(&rows), ["BTCUSDT"]);
    }

    #[tokio::test]
    async fn reads_every_unknown_interval_in_the_first_round_and_then_one_an_hour_in_turn() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, tickers());
        reply_histories(&rest);
        let venue = poller(&rest, &["BTCUSDT", "HYPEUSDT", "LISTAUSDT"]);

        venue.fetch_round(&http(), 0).await.unwrap();
        let mut first = history_calls(&rest);
        first.sort();
        assert_eq!(first, [history_path("BTCUSDT"), history_path("HYPEUSDT"), history_path("LISTAUSDT")]);

        advance(INTERVAL_REFRESH_MS - 1);
        venue.fetch_round(&http(), 0).await.unwrap();
        assert_eq!(history_calls(&rest).len(), 3);

        advance(1);
        venue.fetch_round(&http(), 0).await.unwrap();
        venue.fetch_round(&http(), 0).await.unwrap();
        advance(1);
        venue.fetch_round(&http(), 0).await.unwrap();
        assert_eq!(history_calls(&rest).len(), 6);
        venue.fetch_round(&http(), 0).await.unwrap();
        assert_eq!(history_calls(&rest).len(), 6);
    }

    #[tokio::test]
    async fn keeps_a_market_out_until_its_interval_lands_and_retries_it_after_a_minute() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, tickers());
        rest.reply(&history_path("BTCUSDT"), history("BTCUSDT", 8));
        // A symbol the web host does not know answers HTTP 422 code 100400 "Invalid parameters".
        rest.fail(&history_path("HYPEUSDT"), 422);
        let venue = poller(&rest, &["BTCUSDT", "HYPEUSDT"]);

        assert_eq!(keys(&venue.fetch_round(&http(), 0).await.unwrap()), ["BTCUSDT"]);
        advance(INTERVAL_RETRY_MS - 1);
        venue.fetch_round(&http(), 0).await.unwrap();
        assert_eq!(history_calls(&rest).len(), 2);

        rest.reply(&history_path("HYPEUSDT"), history("HYPEUSDT", 4));
        advance(1);
        let rows = venue.fetch_round(&http(), 0).await.unwrap();

        assert_eq!(keys(&rows), ["BTCUSDT", "HYPEUSDT"]);
        let warnings = logs.events("funding_interval_read_failed");
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].text("market"), "HYPEUSDT");
        assert!(warnings[0].text("error").contains("422"), "{:?}", warnings[0]);
    }

    #[tokio::test]
    async fn keeps_the_last_interval_when_a_refresh_fails() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, tickers());
        reply_histories(&rest);
        let venue = poller(&rest, &["BTCUSDT"]);
        venue.fetch_round(&http(), 0).await.unwrap();

        rest.fail(&history_path("BTCUSDT"), 500);
        advance(INTERVAL_REFRESH_MS);
        let rows = venue.fetch_round(&http(), 0).await.unwrap();

        assert_eq!(history_calls(&rest).len(), 2);
        assert_eq!(rows["BTCUSDT"].funding_interval_hours, 8.0);
    }

    #[tokio::test]
    async fn keeps_the_round_when_an_interval_read_is_rate_limited() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, tickers());
        rest.reply(&history_path("BTCUSDT"), history("BTCUSDT", 8));
        rest.reply(&history_path("HYPEUSDT"), json!({ "code": 100429, "msg": "Too many requests", "data": null }));

        let rows = poller(&rest, &["BTCUSDT", "HYPEUSDT"]).fetch_round(&http(), 0).await.unwrap();

        assert_eq!(keys(&rows), ["BTCUSDT"]);
        assert!(logs.events("funding_interval_read_failed")[0].text("error").contains("code 100429"));
    }

    #[tokio::test]
    async fn leaves_out_a_market_that_never_settled() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, tickers());
        rest.reply(&history_path("BTCUSDT"), json!({ "code": 200, "msg": "success", "data": { "current": 1, "total": 0, "list": [] } }));

        let rows = poller(&rest, &["BTCUSDT"]).fetch_round(&http(), 0).await.unwrap();

        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn fails_the_round_when_the_ticker_call_fails_or_answers_an_error_code() {
        let rest = MockRest::start().await;
        reply_histories(&rest);
        let error = poller(&rest, &["BTCUSDT"]).fetch_round(&http(), 0).await.unwrap_err();
        assert!(error.to_string().contains(&format!("404 Not Found from {}{TICKERS_PATH}", rest.url)), "{error:#}");

        rest.reply(TICKERS_PATH, json!({ "code": 100400, "msg": "Invalid parameters", "data": null }));
        let error = poller(&rest, &["BTCUSDT"]).fetch_round(&http(), 0).await.unwrap_err();
        assert!(error.to_string().contains("code 100400: Invalid parameters"), "{error:#}");
    }

    #[tokio::test]
    async fn reads_code_100429_as_a_rate_limit() {
        let rest = MockRest::start().await;
        reply_histories(&rest);
        rest.reply(TICKERS_PATH, json!({ "code": 100429, "msg": "Too many requests", "data": null }));

        let error = poller(&rest, &["BTCUSDT"]).fetch_round(&http(), 0).await.unwrap_err();

        let limited = error.downcast_ref::<RateLimited>().unwrap();
        assert_eq!(limited.reason, "code 100429");
        assert_eq!(poller(&rest, &[]).rate_limit_pause(), Duration::from_secs(2));
    }
}
