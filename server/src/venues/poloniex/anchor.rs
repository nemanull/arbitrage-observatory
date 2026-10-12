use super::{ID, Poloniex};
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

// Two documented bulk calls carry the index and the mark of every contract, 18 rows of about 730 bytes each.
pub const INDEX_PATH: &str = "/v3/market/indexPrice";
pub const MARK_PATH: &str = "/v3/market/markPrice";

// Funding has no bulk call, since the call without a symbol answers code 24101, so it is read per contract in turn.
pub const FUNDING_PATH: &str = "/v3/market/fundingRate";

// No call publishes the interval, and every contract settled at 00, 08 and 16 UTC on 2026-09-23 and 2026-10-09.
// It stands in only when nFT minus fT is not a positive number.
const FUNDING_INTERVAL_HOURS: f64 = 8.0;

const MS_PER_HOUR: f64 = 3_600_000.0;

// The documented limit answer, which the venue may also send inside an HTTP 200 body as every other error.
const RATE_LIMIT_CODE: i64 = 429;

// A first round reads every contract's funding, at most this many requests at a time, against 300 requests a second per IP.
const FUNDING_READS_AT_ONCE: usize = 6;

#[derive(Clone, Copy)]
struct Reading {
    rate: f64,
    interval_hours: f64,
    next_at: i64, // Unix ms
}

#[derive(Default)]
pub struct Funding {
    readings: HashMap<String, Reading>, // raw id to its last funding reading
    warned: HashSet<String>,
    next: usize, // position in the tracked list of the next read in turn
}

impl AnchorVenue for Poloniex {
    // The limit is counted per second and no Retry-After was seen, so five windows is a margin, not a measurement.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(5)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let due = self.due_funding((self.clock)());
        let (index_url, mark_url) = (format!("{}{INDEX_PATH}", self.rest), format!("{}{MARK_PATH}", self.rest));
        let index = async {
            let rows: Vec<IndexRow> = get_data(http, &index_url).await?;
            anyhow::Ok((rows, now_ms()))
        };
        let mark = async {
            let rows: Vec<MarkRow> = get_data(http, &mark_url).await?;
            anyhow::Ok((rows, now_ms()))
        };
        let (index, mark, ()) = tokio::join!(index, mark, self.read_funding(http, due));
        let ((index, index_at), (mark, mark_at)) = (index?, mark?);
        // Funding reads can hold the round past both replies, and a row is no fresher than the older of its two prices.
        let ts = index_at.min(mark_at);

        // An unreadable mark leaves its row out, which the poller warns about once, where a NaN would be refused and warned about every round.
        let mut marks = HashMap::with_capacity(mark.len());
        for row in mark {
            if row.mark.is_finite() && row.mark > 0.0 {
                marks.insert(row.s, row.mark);
            }
        }

        // Every basket is a spot basket, with Poloniex's own spot book at weights up to 0.292 and never its perpetual.
        let funding = self.funding.lock().unwrap();
        let mut rows = AnchorMap::with_capacity(index.len());
        for row in index {
            // A contract with no mark or no funding yet stays out, rather than send a number that means something else.
            let (Some(&mark), Some(reading)) = (marks.get(&row.s), funding.readings.get(&row.s)) else {
                continue;
            };

            rows.insert(
                row.s,
                AnchorRow {
                    index: row.index,
                    mark,
                    funding_rate: reading.rate,
                    funding_interval_hours: reading.interval_hours,
                    next_funding_at: reading.next_at,
                    ts: Some(ts),
                },
            );
        }

        Ok(rows)
    }
}

impl Poloniex {
    // Every contract with no reading or whose next settlement has passed, plus the next one in turn.
    // A rate that changed once in 177 s needs no faster turn than one contract a round.
    fn due_funding(&self, now: i64) -> Vec<String> {
        if self.markets.is_empty() {
            return Vec::new();
        }

        let mut funding = self.funding.lock().unwrap();
        let mut due = Vec::new();
        for raw_market_id in &self.markets {
            if funding.readings.get(raw_market_id).is_none_or(|reading| reading.next_at <= now) {
                due.push(raw_market_id.clone());
            }
        }

        let turn = &self.markets[funding.next % self.markets.len()];
        funding.next = (funding.next + 1) % self.markets.len();
        if !due.contains(turn) {
            due.push(turn.clone());
        }
        due
    }

    // A contract keeps its last reading when a read fails, and one never read stays out of the rows.
    async fn read_funding(&self, http: &reqwest::Client, due: Vec<String>) {
        let replies: Vec<(String, anyhow::Result<Reading>)> = stream::iter(due)
            .map(|raw_market_id| async move {
                let url = format!("{}{FUNDING_PATH}?symbol={raw_market_id}", self.rest);
                let reply = get_data::<FundingRate>(http, &url).await.and_then(|rate| rate.reading());
                (raw_market_id, reply)
            })
            .buffer_unordered(FUNDING_READS_AT_ONCE)
            .collect()
            .await;

        let mut funding = self.funding.lock().unwrap();
        for (raw_market_id, reply) in replies {
            match reply {
                Ok(reading) => {
                    funding.readings.insert(raw_market_id, reading);
                }
                Err(error) => {
                    if funding.warned.insert(raw_market_id.clone()) {
                        tracing::warn!(event = "funding_read_failed", venue = ID, market = %raw_market_id, error = format!("{error:#}"));
                    }
                }
            }
        }
    }
}

// Every call answers HTTP 200 with {"code": 200, "msg": "Success", "data": ...}, and an error such as an unknown symbol sets another code.
pub async fn get_data<T: DeserializeOwned>(http: &reqwest::Client, url: &str) -> anyhow::Result<T> {
    let body = get_bytes(http, url).await?;
    let status: Status = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;
    let code = status.code as i64;

    if code == RATE_LIMIT_CODE {
        return Err(RateLimited {
            url: url.to_string(),
            reason: format!("code {code}"),
            retry_after: None,
        }
        .into());
    }
    if code != 200 {
        anyhow::bail!("code {code}: {} from {url}", status.msg);
    }

    let reply: Data<T> = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;
    Ok(reply.data)
}

#[derive(Deserialize)]
struct Status {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    code: f64, // a JSON number on the wire, and a string in CCXT's comments
    #[serde(default)]
    msg: String,
}

#[derive(Deserialize)]
struct Data<T> {
    data: T,
}

#[derive(Deserialize)]
struct IndexRow {
    #[serde(default)]
    s: String, // "BTC_USDT_PERP"
    #[serde(rename = "iPx", default = "wire::nan", deserialize_with = "wire::num")]
    index: f64,
}

#[derive(Deserialize)]
struct MarkRow {
    #[serde(default)]
    s: String,
    #[serde(rename = "mPx", default = "wire::nan", deserialize_with = "wire::num")]
    mark: f64,
}

// Times are Unix ms as strings over REST and as numbers on the socket.
#[derive(Deserialize)]
struct FundingRate {
    #[serde(rename = "nFR", default = "wire::nan", deserialize_with = "wire::num")]
    next_rate: f64, // the running estimate for the settlement at nFT, a fraction per interval
    #[serde(rename = "fT", default = "wire::nan", deserialize_with = "wire::num")]
    last_at: f64, // the settlement whose rate is fR
    #[serde(rename = "nFT", default = "wire::nan", deserialize_with = "wire::num")]
    next_at: f64,
}

impl FundingRate {
    // The interval right after the venue changes it is not verified, since no change was seen.
    // A reply with no readable rate fails like a refused call, so the last reading stays rather than a row the engine refuses every round.
    fn reading(&self) -> anyhow::Result<Reading> {
        if !self.next_rate.is_finite() {
            anyhow::bail!("no readable nFR");
        }

        let derived = (self.next_at - self.last_at) / MS_PER_HOUR;
        let interval_hours = if derived.is_finite() && derived > 0.0 { derived } else { FUNDING_INTERVAL_HOURS };
        let next_at = if self.next_at.is_finite() && self.next_at > 0.0 { self.next_at as i64 } else { 0 };

        Ok(Reading {
            rate: self.next_rate,
            interval_hours,
            next_at,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, market, tracked};
    use serde_json::{Value, json};
    use std::cell::Cell;

    // 2026-10-09 19:11:56 UTC, when the replies below were captured.
    const NOW: i64 = 1_791_573_116_000;
    const NEXT_SETTLEMENT: i64 = 1_791_590_400_000;

    thread_local! {
        static CLOCK: Cell<i64> = const { Cell::new(NOW) };
    }

    fn clock() -> i64 {
        CLOCK.with(Cell::get)
    }

    fn set_clock(ms: i64) {
        CLOCK.with(|now| now.set(ms));
    }

    fn funding_path(raw_market_id: &str) -> String {
        format!("{FUNDING_PATH}?symbol={raw_market_id}")
    }

    // Rows trimmed from the replies captured live on 2026-10-09 at 19:11 UTC.
    fn index() -> Value {
        json!({ "code": 200, "msg": "Success", "data": [
            { "s": "XRP_USDT_PERP", "iPx": "1.3878" },
            { "s": "BTC_USDT_PERP", "iPx": "82495.1" },
            { "s": "1000PEPE_USDT_PERP", "iPx": "0.0039274" },
            { "s": "ETH_USDT_PERP", "iPx": "2484.83" },
        ]})
    }

    fn mark() -> Value {
        json!({ "code": 200, "msg": "Success", "data": [
            { "s": "XRP_USDT_PERP", "mPx": "1.3871" },
            { "s": "BTC_USDT_PERP", "mPx": "82477.78" },
            { "s": "1000PEPE_USDT_PERP", "mPx": "0.0039276" },
        ]})
    }

    fn funding(raw_market_id: &str, next_rate: &str) -> Value {
        json!({ "code": 200, "msg": "Success", "data": {
            "s": raw_market_id, "fR": "0.0001", "fT": "1791561600000", "nFR": next_rate, "nFT": "1791590400000",
        }})
    }

    fn invalid_symbol() -> Value {
        json!({ "code": 24101, "msg": "Invalid symbol!", "data": "" })
    }

    fn reply_all(rest: &MockRest) {
        rest.reply(INDEX_PATH, index());
        rest.reply(MARK_PATH, mark());
        rest.reply(&funding_path("BTC_USDT_PERP"), funding("BTC_USDT_PERP", "0.000037"));
        rest.reply(&funding_path("XRP_USDT_PERP"), funding("XRP_USDT_PERP", "0.0001"));
        rest.reply(&funding_path("1000PEPE_USDT_PERP"), funding("1000PEPE_USDT_PERP", "-0.00002"));
        rest.reply(&funding_path("ETH_USDT_PERP"), funding("ETH_USDT_PERP", "0.0001"));
    }

    fn poller(rest: &MockRest, raw_market_ids: &[&str]) -> Poloniex {
        let mut markets = Vec::new();
        for id in raw_market_ids {
            markets.push(market(ID, id, id.split('_').next().unwrap(), "USDT", true));
        }
        Poloniex::with_rest(&tracked(&markets), &rest.url, clock)
    }

    fn keys(rows: &AnchorMap) -> Vec<&str> {
        let mut keys: Vec<&str> = rows.keys().map(String::as_str).collect();
        keys.sort();
        keys
    }

    fn funding_calls(rest: &MockRest) -> Vec<String> {
        rest.calls().into_iter().filter(|call| call.starts_with(FUNDING_PATH)).collect()
    }

    #[test]
    fn polls_every_second_and_pauses_five_seconds_on_a_rate_limit() {
        let venue = Poloniex::new(&[]);

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(5));
    }

    #[tokio::test]
    async fn maps_index_mark_and_the_upcoming_rate_with_the_interval_between_two_settlements() {
        set_clock(NOW);
        let rest = MockRest::start().await;
        reply_all(&rest);

        let before = now_ms();
        let rows = poller(&rest, &["BTC_USDT_PERP", "1000PEPE_USDT_PERP"]).fetch_round(&http(), 0).await.unwrap();
        let after = now_ms();

        let btc = rows["BTC_USDT_PERP"];
        assert_eq!(
            (btc.index, btc.mark, btc.funding_rate, btc.funding_interval_hours, btc.next_funding_at),
            (82495.1, 82477.78, 0.000037, 8.0, NEXT_SETTLEMENT)
        );
        let ts = btc.ts.unwrap();
        assert!(before <= ts && ts <= after, "{before} <= {ts} <= {after}");
        assert_eq!(rows["1000PEPE_USDT_PERP"].funding_rate, -0.00002);
    }

    #[tokio::test]
    async fn leaves_out_a_contract_with_no_mark_or_no_funding_yet() {
        set_clock(NOW);
        let rest = MockRest::start().await;
        reply_all(&rest);
        rest.reply(&funding_path("XRP_USDT_PERP"), invalid_symbol());

        let rows = poller(&rest, &["BTC_USDT_PERP", "XRP_USDT_PERP", "ETH_USDT_PERP"]).fetch_round(&http(), 0).await.unwrap();

        // ETH has no mark row, and XRP's funding call failed.
        assert_eq!(keys(&rows), ["BTC_USDT_PERP"]);
    }

    #[tokio::test]
    async fn reads_every_contract_in_the_first_round_and_then_one_a_round_in_turn() {
        set_clock(NOW);
        let rest = MockRest::start().await;
        reply_all(&rest);
        let venue = poller(&rest, &["BTC_USDT_PERP", "XRP_USDT_PERP", "1000PEPE_USDT_PERP"]);

        venue.fetch_round(&http(), 0).await.unwrap();
        let mut first = funding_calls(&rest);
        first.sort();
        assert_eq!(first, [funding_path("1000PEPE_USDT_PERP"), funding_path("BTC_USDT_PERP"), funding_path("XRP_USDT_PERP")]);

        for _ in 0..3 {
            venue.fetch_round(&http(), 0).await.unwrap();
        }

        assert_eq!(
            funding_calls(&rest)[3..],
            [funding_path("XRP_USDT_PERP"), funding_path("1000PEPE_USDT_PERP"), funding_path("BTC_USDT_PERP")]
        );
    }

    #[tokio::test]
    async fn rereads_every_contract_once_its_next_settlement_has_passed() {
        set_clock(NOW);
        let rest = MockRest::start().await;
        reply_all(&rest);
        let venue = poller(&rest, &["BTC_USDT_PERP", "XRP_USDT_PERP", "1000PEPE_USDT_PERP"]);
        venue.fetch_round(&http(), 0).await.unwrap();
        venue.fetch_round(&http(), 0).await.unwrap();
        assert_eq!(funding_calls(&rest).len(), 4);

        set_clock(NEXT_SETTLEMENT);
        venue.fetch_round(&http(), 0).await.unwrap();

        assert_eq!(funding_calls(&rest).len(), 7);
    }

    #[tokio::test]
    async fn keeps_the_last_reading_when_a_read_fails_and_warns_once_per_contract() {
        set_clock(NOW);
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        reply_all(&rest);
        let venue = poller(&rest, &["BTC_USDT_PERP"]);
        venue.fetch_round(&http(), 0).await.unwrap();

        rest.fail(&funding_path("BTC_USDT_PERP"), 500);
        venue.fetch_round(&http(), 0).await.unwrap();
        let rows = venue.fetch_round(&http(), 0).await.unwrap();

        assert_eq!(rows["BTC_USDT_PERP"].funding_rate, 0.000037);
        let warnings = logs.events("funding_read_failed");
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].text("market"), "BTC_USDT_PERP");
        assert!(warnings[0].text("error").contains("500"), "{:?}", warnings[0]);
    }

    #[tokio::test]
    async fn stamps_a_row_with_the_older_of_the_index_and_mark_arrivals() {
        set_clock(NOW);
        let rest = MockRest::start().await;
        reply_all(&rest);
        rest.reply_after(MARK_PATH, mark(), Duration::from_millis(1_000));
        rest.reply_after(&funding_path("BTC_USDT_PERP"), funding("BTC_USDT_PERP", "0.000037"), Duration::from_millis(2_000));

        let before = now_ms();
        let rows = poller(&rest, &["BTC_USDT_PERP"]).fetch_round(&http(), 0).await.unwrap();
        let after = now_ms();

        // The index came at once, the mark 1 s later and the funding 2 s later, with room for a loaded host.
        let ts = rows["BTC_USDT_PERP"].ts.unwrap();
        assert!(ts - before < 900, "index arrival {ts} should be near {before}");
        assert!(after - ts >= 1_500, "{ts} should not take the funding arrival {after}");
    }

    #[tokio::test]
    async fn keeps_the_last_reading_when_a_reply_carries_no_rate() {
        set_clock(NOW);
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        reply_all(&rest);
        let venue = poller(&rest, &["BTC_USDT_PERP"]);
        venue.fetch_round(&http(), 0).await.unwrap();

        rest.reply(
            &funding_path("BTC_USDT_PERP"),
            json!({ "code": 200, "msg": "Success", "data": { "s": "BTC_USDT_PERP", "fT": "1791561600000", "nFT": "1791590400000" } }),
        );
        let rows = venue.fetch_round(&http(), 0).await.unwrap();

        assert_eq!(rows["BTC_USDT_PERP"].funding_rate, 0.000037);
        assert!(logs.events("funding_read_failed")[0].text("error").contains("nFR"));
    }

    #[tokio::test]
    async fn leaves_out_a_contract_whose_mark_does_not_read() {
        set_clock(NOW);
        let rest = MockRest::start().await;
        reply_all(&rest);
        rest.reply(
            MARK_PATH,
            json!({ "code": 200, "msg": "Success", "data": [{ "s": "BTC_USDT_PERP", "mPx": "" }, { "s": "XRP_USDT_PERP", "mPx": "1.3871" }] }),
        );

        let rows = poller(&rest, &["BTC_USDT_PERP", "XRP_USDT_PERP"]).fetch_round(&http(), 0).await.unwrap();

        assert_eq!(keys(&rows), ["XRP_USDT_PERP"]);
    }

    #[tokio::test]
    async fn falls_back_to_eight_hours_when_the_settlements_give_no_interval() {
        set_clock(NOW);
        let rest = MockRest::start().await;
        reply_all(&rest);
        rest.reply(
            &funding_path("BTC_USDT_PERP"),
            json!({ "code": 200, "msg": "Success", "data": { "s": "BTC_USDT_PERP", "nFR": "0.0001", "nFT": "1791590400000" } }),
        );

        let rows = poller(&rest, &["BTC_USDT_PERP"]).fetch_round(&http(), 0).await.unwrap();

        assert_eq!(rows["BTC_USDT_PERP"].funding_interval_hours, 8.0);
        assert_eq!(rows["BTC_USDT_PERP"].next_funding_at, NEXT_SETTLEMENT);
    }

    #[tokio::test]
    async fn sends_an_unknown_next_funding_as_zero_with_the_eight_hour_interval() {
        set_clock(NOW);
        let rest = MockRest::start().await;
        reply_all(&rest);
        rest.reply(
            &funding_path("BTC_USDT_PERP"),
            json!({ "code": 200, "msg": "Success", "data": { "s": "BTC_USDT_PERP", "nFR": "0.0001", "fT": "1791561600000" } }),
        );

        let rows = poller(&rest, &["BTC_USDT_PERP"]).fetch_round(&http(), 0).await.unwrap();

        assert_eq!(rows["BTC_USDT_PERP"].next_funding_at, 0);
        assert_eq!(rows["BTC_USDT_PERP"].funding_interval_hours, 8.0);
    }

    #[tokio::test]
    async fn fails_the_round_when_a_bulk_call_fails_or_answers_an_error_code() {
        set_clock(NOW);
        let rest = MockRest::start().await;
        reply_all(&rest);
        rest.fail(MARK_PATH, 502);
        let error = poller(&rest, &["BTC_USDT_PERP"]).fetch_round(&http(), 0).await.unwrap_err();
        assert!(error.to_string().contains(&format!("502 Bad Gateway from {}{MARK_PATH}", rest.url)), "{error:#}");

        rest.reply(MARK_PATH, mark());
        rest.reply(INDEX_PATH, invalid_symbol());
        let error = poller(&rest, &["BTC_USDT_PERP"]).fetch_round(&http(), 0).await.unwrap_err();
        assert!(error.to_string().contains("code 24101: Invalid symbol!"), "{error:#}");
    }

    #[tokio::test]
    async fn reads_a_limit_status_or_code_429_as_a_rate_limit() {
        set_clock(NOW);
        let rest = MockRest::start().await;
        reply_all(&rest);
        rest.fail(INDEX_PATH, 429);
        let error = poller(&rest, &["BTC_USDT_PERP"]).fetch_round(&http(), 0).await.unwrap_err();
        assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");

        rest.reply(INDEX_PATH, json!({ "code": 429, "msg": "TOO_MANY_REQUEST", "data": "" }));
        let error = poller(&rest, &["BTC_USDT_PERP"]).fetch_round(&http(), 0).await.unwrap_err();
        assert_eq!(error.downcast_ref::<RateLimited>().unwrap().reason, "code 429");
    }
}
