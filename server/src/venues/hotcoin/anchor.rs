use super::{Hotcoin, ID};
use crate::feeds::anchor_poller::{AnchorMap, AnchorVenue, RateLimited, get_bytes};
use anyhow::Context;
use futures_util::future::join_all;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::collections::{HashMap, HashSet, VecDeque};
use std::time::Duration;

// The newest settlements of one contract, whose spacing is its funding interval, since no call or channel names the interval.
// Two contracts can share a next settlement under different intervals, so the settlement hour alone cannot tell it.
const HISTORY_PATH: &str = "/api/v1/perpetual/public/{code}/fee-rate?page=1&pageSize=3";
const HISTORY_ROWS: usize = 3;

// Every contract read on 2026-10-09 settled every 8, 4 or 1 hours, and 2 is the one step between them.
const INTERVAL_HOURS: [i64; 4] = [8, 4, 2, 1];

const HOUR_MS: i64 = 3_600_000;
const MINUTE_MS: i64 = 60_000;

// No limit is published, the venue answers 429 and then bans the IP, and the probes ran at 2 requests a second without a refusal.
// So the boot sweep reads two contracts a round, and a known interval is read again every fifth round, about once an hour per contract.
const BOOT_READS_PER_ROUND: usize = 2;
const REFRESH_EVERY_ROUNDS: u64 = 5;
const MAX_BOOT_ATTEMPTS: u32 = 3;

// The sockets carry index, mark, the upcoming rate and the next settlement, which handle writes into SocketAnchors.
// A round reads funding history only, and a market's row stays out until its interval is known.
impl AnchorVenue for Hotcoin {
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(30)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let mut rows = self.anchors.rows();

        let codes = self.intervals.lock().unwrap().due(ts);
        let reads = join_all(codes.iter().map(|code| self.read_interval(http, code))).await;

        {
            let mut intervals = self.intervals.lock().unwrap();
            for (code, read) in codes.into_iter().zip(reads) {
                match read {
                    Ok(hours) => intervals.set(&code, hours),
                    // Only the history reads pause, so the rows the sockets fill keep flowing.
                    Err(error) => match error.downcast_ref::<RateLimited>() {
                        Some(limited) => {
                            let pause = limited.retry_after.unwrap_or(self.rate_limit_pause());
                            tracing::warn!(event = "funding_interval_rate_limited", venue = ID, market = code, error = %limited, pause_ms = pause.as_millis() as u64);
                            intervals.pause(ts + pause.as_millis() as i64);
                            intervals.retry(&code);
                        }
                        None => intervals.failed(&code, &error),
                    },
                }
            }
        }

        // A row written before its interval was known, or under an interval read again since, carries the current one.
        let mut intervals = self.intervals.lock().unwrap();
        rows.retain(|code, row| match intervals.usable(code, row.next_funding_at) {
            Some(hours) => {
                row.funding_interval_hours = hours;
                true
            }
            None => false,
        });

        if rows.is_empty() {
            anyhow::bail!("no market has its mark, index and funding interval yet, {} intervals known", intervals.count());
        }

        Ok(rows)
    }
}

impl Hotcoin {
    async fn read_interval(&self, http: &reqwest::Client, code: &str) -> anyhow::Result<Option<f64>> {
        let url = format!("{}{}", self.rest, HISTORY_PATH.replace("{code}", code));
        let history: History = get_data(http, &url).await?;
        Ok(interval(&history.rows))
    }
}

// The venue books a settlement up to 77 minutes after its hour, as the 08:00 one at 09:17 on 2026-10-09, so the raw spacing of two stamps can read 7 or 9 hours.
// Each candidate interval floors the stamps to its own grid of UTC hours, and the interval is the one whose floored stamps step by exactly itself.
// A new contract's first row is its listing, off any grid, so a contract with fewer than three settlements has none yet.
fn interval(rows: &[Settlement]) -> Option<f64> {
    if rows.len() < HISTORY_ROWS {
        return None;
    }

    INTERVAL_HOURS.into_iter().find_map(|hours| {
        let step = hours * HOUR_MS;
        let fits = rows.windows(2).all(|pair| {
            pair[0].time_index.div_euclid(step) - pair[1].time_index.div_euclid(step) == 1
        });
        fits.then_some(hours as f64)
    })
}

// The push time plus the countdown landed 1.2 s past the hour on 2026-10-09, where the catalog's liquidationTime sat on it, so the sum is rounded to the minute.
// A settled contract's countdown runs below zero until the venue books the settlement, and a delisted one's stays below zero, so neither has a next settlement.
pub fn next_settlement(pushed_at: Option<i64>, countdown: f64) -> i64 {
    match pushed_at {
        Some(pushed_at) if countdown.is_finite() && countdown > 0.0 => {
            (pushed_at + countdown as i64 + MINUTE_MS / 2).div_euclid(MINUTE_MS) * MINUTE_MS
        }
        _ => 0,
    }
}

// The funding interval of each tracked contract, read from its history in turn.
pub struct Intervals {
    markets: Vec<String>,            // tracked raw ids, the order of the refresh
    hours: HashMap<String, f64>,     // raw id to its interval
    unknown: VecDeque<String>,       // read before any refresh, oldest first
    attempts: HashMap<String, u32>,  // failed reads of a contract still unknown
    off_grid: HashMap<String, i64>,  // raw id to the next settlement that put it off its grid, so one settlement queues one read
    next: usize,                     // position in markets of the next refresh
    rounds: u64,
    paused_until: i64, // Unix ms, after a rate limit answer
    warned: HashSet<String>,
}

impl Intervals {
    pub fn new(markets: Vec<String>) -> Self {
        Self {
            unknown: markets.iter().cloned().collect(),
            markets,
            hours: HashMap::new(),
            attempts: HashMap::new(),
            off_grid: HashMap::new(),
            next: 0,
            rounds: 0,
            paused_until: 0,
            warned: HashSet::new(),
        }
    }

    // NaN until the interval is read, which keeps the row out of SocketAnchors.
    pub fn hours(&self, code: &str) -> f64 {
        self.hours.get(code).copied().unwrap_or(f64::NAN)
    }

    fn count(&self) -> usize {
        self.hours.len()
    }

    // The contracts to read this round, the ones with no interval first, and none while a rate limit answer holds the reads.
    fn due(&mut self, now: i64) -> Vec<String> {
        if now < self.paused_until {
            return Vec::new();
        }
        self.rounds += 1;

        if !self.unknown.is_empty() {
            let take = self.unknown.len().min(BOOT_READS_PER_ROUND);
            return self.unknown.drain(..take).collect();
        }
        if self.markets.is_empty() || self.rounds % REFRESH_EVERY_ROUNDS != 0 {
            return Vec::new();
        }

        let code = self.markets[self.next % self.markets.len()].clone();
        self.next = (self.next + 1) % self.markets.len();
        vec![code]
    }

    pub fn set(&mut self, code: &str, hours: Option<f64>) {
        self.attempts.remove(code);
        match hours {
            Some(hours) => {
                if let Some(old) = self.hours.insert(code.to_string(), hours)
                    && old != hours
                {
                    tracing::info!(event = "funding_interval_changed", venue = ID, market = code, from = old, to = hours);
                }
            }
            // A contract listed since its last settlement but one, or one whose history mixes an old and a new interval, which the refresh reads again.
            None => {
                self.hours.remove(code);
                if self.warned.insert(code.to_string()) {
                    tracing::warn!(event = "funding_interval_unknown", venue = ID, market = code);
                }
            }
        }
    }

    // A contract with no interval is queued again a few times, and after that the refresh reads it.
    // Only the first failure of each contract is logged.
    fn failed(&mut self, code: &str, error: &anyhow::Error) {
        if self.warned.insert(code.to_string()) {
            tracing::warn!(event = "funding_interval_read_failed", venue = ID, market = code, error = format!("{error:#}"));
        }
        self.retry(code);
    }

    fn pause(&mut self, until: i64) {
        self.paused_until = self.paused_until.max(until);
    }

    // Queued behind the others, as a rate limit answer leaves it unread.
    fn retry(&mut self, code: &str) {
        if self.hours.contains_key(code) {
            return;
        }
        let attempts = self.attempts.entry(code.to_string()).or_default();
        *attempts += 1;
        if *attempts <= MAX_BOOT_ATTEMPTS {
            self.unknown.push_back(code.to_string());
        }
    }

    // An interval whose grid of UTC hours misses the next settlement is out of date, since 8 h contracts settle at 00, 08 and 16 UTC and 4 h ones every fourth hour.
    // Such a row stays out, and the contract is read again once for that settlement.
    fn usable(&mut self, code: &str, next_funding_at: i64) -> Option<f64> {
        let hours = *self.hours.get(code)?;
        if next_funding_at <= 0 || (next_funding_at + HOUR_MS / 2).div_euclid(HOUR_MS) % hours as i64 == 0 {
            return Some(hours);
        }

        if self.off_grid.get(code) != Some(&next_funding_at) {
            self.off_grid.insert(code.to_string(), next_funding_at);
            tracing::info!(event = "funding_interval_off_grid", venue = ID, market = code, hours, next_funding_at);
            self.unknown.push_front(code.to_string());
        }
        None
    }
}

// Every public call wraps its data as {code, msg, data}, with code 200 on success.
pub async fn get_data<T: DeserializeOwned>(http: &reqwest::Client, url: &str) -> anyhow::Result<T> {
    let body = get_bytes(http, url).await?;
    let status: Status = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;
    if status.code != 200 {
        anyhow::bail!("code {}: {}", status.code, status.msg);
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

#[derive(Deserialize)]
struct History {
    #[serde(default)]
    rows: Vec<Settlement>, // newest first
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Settlement {
    #[serde(default)]
    time_index: i64, // Unix ms when the settlement was booked
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::cluster::Market;
    use crate::feeds::anchor_poller::AnchorRow;
    use crate::feeds::venue_feed::{BookVenue, Connection};
    use crate::test_log::capture;
    use crate::venues::testing::{self, MockRest, http, tracked};
    use serde_json::{Value, json};

    const AT: i64 = 1_791_570_388_469; // 2026-10-09 18:26:28.469 UTC, the arrival of the pushes below
    const NEXT: i64 = 1_791_590_400_000; // 2026-10-10 00:00 UTC, on every grid
    const COUNTDOWN: i64 = 20_012_997; // from the push time to NEXT, 1.188 s long

    fn market(code: &str) -> Market {
        testing::market(ID, code, "BTC", "USDT", true)
    }

    fn venue(rest: &MockRest, codes: &[&str]) -> Hotcoin {
        let markets: Vec<Market> = codes.iter().map(|code| market(code)).collect();
        Hotcoin::with_rest(&tracked(&markets), &rest.url)
    }

    fn history_path(code: &str) -> String {
        HISTORY_PATH.replace("{code}", code)
    }

    // Funding history rows captured live on 2026-10-09, cut to the fields around the stamp.
    fn history(code: &str, stamps: &[i64]) -> Value {
        let rows: Vec<Value> = stamps
            .iter()
            .map(|stamp| json!({ "contractCode": code, "env": 0, "feeRate": 0.00005, "createdDate": stamp, "timeIndex": stamp }))
            .collect();
        json!({ "code": 200, "msg": "success", "data": { "rows": rows, "total": 330 } })
    }

    // terusdt on 8 hours, whose 08:00 settlement was booked at 09:17:43.
    fn eight_hours() -> Vec<i64> {
        vec![1791561629000, 1791537463000, 1791504073000]
    }

    // sophusdt on 4 hours, 16:00:55, 12:00:18 and 08:01:06.
    fn four_hours() -> Vec<i64> {
        vec![1791561655000, 1791547218000, 1791532866000]
    }

    // kaiausdt on 1 hour, 18:01:13, 17:00:52 and 16:01:57.
    fn one_hour() -> Vec<i64> {
        vec![1791568873000, 1791565252000, 1791561717000]
    }

    fn settlements(stamps: &[i64]) -> Vec<Settlement> {
        stamps.iter().map(|&time_index| Settlement { time_index }).collect()
    }

    // A fund_rates push of one row, from the btcusdt row captured live on 2026-10-09, whose push time plus COUNTDOWN is 00:00:01.188 UTC.
    fn fund_rates(code: &str, countdown: i64) -> Value {
        json!({
            "biz": "perpetual", "env": 0, "timestamp": 1791570388191_i64, "type": "fund_rates",
            "data": [[code, "82503.3", "82504.1", "-0.00001238", "-0.00003754", countdown, "5357", "552966.73", "552961.97",
                "0", "", "", "", "USDT", "BTC", "USDT", "0", 2, "82499.6"]],
        })
    }

    // What the book socket of these contracts does with a fund_rates push, arriving at `at`.
    fn push(venue: &Hotcoin, codes: &[&str], frame: Value, at: i64) {
        let markets: Vec<Market> = codes.iter().map(|code| market(code)).collect();
        let mut conn = Connection::for_test("hotcoin#perpetual#0", markets.clone());
        venue.subscribe_frames(&markets, &mut conn.state);
        venue.handle_at(frame.to_string().as_bytes(), &mut conn, at).unwrap();
    }

    #[test]
    fn polls_every_second_and_pauses_thirty_seconds_on_a_rate_limit() {
        let venue = Hotcoin::new(&[]);

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(30));
    }

    #[test]
    fn reads_the_interval_from_the_grid_its_settlements_fit_even_when_one_was_booked_an_hour_late() {
        assert_eq!(interval(&settlements(&eight_hours())), Some(8.0));
        assert_eq!(interval(&settlements(&four_hours())), Some(4.0));
        assert_eq!(interval(&settlements(&one_hour())), Some(1.0));
    }

    #[test]
    fn reads_no_interval_from_a_new_contract_or_a_history_that_fits_no_grid() {
        // pcvxusdt, listed at 07:00:55 and settled once at 16:00:26.
        assert_eq!(interval(&settlements(&[1791561626000, 1791529255000])), None);
        assert_eq!(interval(&settlements(&[])), None);
        // A move from 8 hours to 1 hour, 18:00, 16:00 and 08:00.
        assert_eq!(interval(&settlements(&[1791568800000, 1791561600000, 1791532800000])), None);
    }

    #[test]
    fn rounds_the_next_settlement_to_the_minute_and_reads_a_spent_countdown_as_unknown() {
        assert_eq!(next_settlement(Some(1791570388191), COUNTDOWN as f64), NEXT);
        assert_eq!(next_settlement(Some(1791570388191), -5000.0), 0);
        assert_eq!(next_settlement(Some(1791570388191), f64::NAN), 0);
        assert_eq!(next_settlement(None, COUNTDOWN as f64), 0);
    }

    #[tokio::test]
    async fn sends_the_socket_index_mark_and_upcoming_rate_with_the_interval_from_the_history() {
        let rest = MockRest::start().await;
        rest.reply(&history_path("btcusdt"), history("btcusdt", &four_hours()));
        let venue = venue(&rest, &["btcusdt"]);

        // The first round reads the history, and the next push completes the row.
        assert!(venue.fetch_round(&http(), AT).await.is_err());
        push(&venue, &["btcusdt"], fund_rates("btcusdt", COUNTDOWN), AT);
        let rows = venue.fetch_round(&http(), AT).await.unwrap();

        assert_eq!(
            rows["btcusdt"],
            AnchorRow {
                index: 82504.1,
                mark: 82503.3,
                funding_rate: -0.00003754,
                funding_interval_hours: 4.0,
                next_funding_at: NEXT,
                ts: Some(AT),
            }
        );
    }

    #[tokio::test]
    async fn leaves_a_market_out_until_its_interval_is_read() {
        let (_logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(&history_path("btcusdt"), history("btcusdt", &four_hours()));
        rest.reply(&history_path("ethusdt"), history("ethusdt", &[1791561626000, 1791529255000]));
        let venue = venue(&rest, &["btcusdt", "ethusdt"]);
        venue.fetch_round(&http(), AT).await.unwrap_err();

        push(&venue, &["btcusdt", "ethusdt"], fund_rates("btcusdt", COUNTDOWN), AT);
        push(&venue, &["btcusdt", "ethusdt"], fund_rates("ethusdt", COUNTDOWN), AT);
        let rows = venue.fetch_round(&http(), AT).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["btcusdt"]);
    }

    #[tokio::test]
    async fn fails_a_round_with_no_complete_row_as_one_line() {
        let rest = MockRest::start().await;
        rest.reply(&history_path("btcusdt"), history("btcusdt", &four_hours()));
        let venue = venue(&rest, &["btcusdt"]);

        let error = venue.fetch_round(&http(), AT).await.unwrap_err();

        assert!(error.to_string().starts_with("no market has its mark, index and funding interval yet, 1 intervals known"), "{error:#}");
    }

    #[tokio::test]
    async fn reads_two_histories_a_round_at_boot_and_then_one_every_fifth_round() {
        let rest = MockRest::start().await;
        for code in ["aaausdt", "bbbusdt", "cccusdt"] {
            rest.reply(&history_path(code), history(code, &eight_hours()));
        }
        let venue = venue(&rest, &["aaausdt", "bbbusdt", "cccusdt"]);

        let _ = venue.fetch_round(&http(), AT).await;
        assert_eq!(rest.calls().len(), 2);
        let _ = venue.fetch_round(&http(), AT).await;
        assert_eq!(rest.calls().len(), 3);
        for _ in 0..7 {
            let _ = venue.fetch_round(&http(), AT).await;
        }

        // Rounds 3 to 9 hold the refreshes of rounds 5 and 10, of which round 5 has come.
        let calls = rest.calls();
        assert_eq!(calls.len(), 4);
        assert_eq!(calls[3], history_path("aaausdt"));
    }

    #[tokio::test]
    async fn leaves_out_a_row_whose_next_settlement_is_off_its_grid_and_reads_its_history_again_once() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(&history_path("btcusdt"), history("btcusdt", &eight_hours()));
        rest.reply(&history_path("ethusdt"), history("ethusdt", &eight_hours()));
        let venue = venue(&rest, &["btcusdt", "ethusdt"]);
        venue.fetch_round(&http(), AT).await.unwrap_err();

        // 20:00 is off the 8 hour grid, and midnight is on it.
        push(&venue, &["btcusdt", "ethusdt"], fund_rates("btcusdt", COUNTDOWN - 4 * HOUR_MS), AT);
        push(&venue, &["btcusdt", "ethusdt"], fund_rates("ethusdt", COUNTDOWN), AT);
        let rows = venue.fetch_round(&http(), AT).await.unwrap();
        assert_eq!(rows.keys().collect::<Vec<_>>(), ["ethusdt"]);
        assert_eq!(rows["ethusdt"].next_funding_at, NEXT);

        let rows = venue.fetch_round(&http(), AT).await.unwrap();
        assert_eq!(rows.keys().collect::<Vec<_>>(), ["ethusdt"]);
        let _ = venue.fetch_round(&http(), AT).await;

        let calls = rest.calls();
        assert_eq!(calls.iter().filter(|call| **call == history_path("btcusdt")).count(), 2);
        assert_eq!(logs.events("funding_interval_off_grid").len(), 1);
    }

    #[tokio::test]
    async fn logs_a_changed_interval_and_forgets_one_that_no_longer_reads() {
        let (logs, _capture) = capture();
        let mut intervals = Intervals::new(vec!["btcusdt".to_string()]);

        intervals.set("btcusdt", Some(8.0));
        intervals.set("btcusdt", Some(1.0));
        assert_eq!(intervals.hours("btcusdt"), 1.0);
        assert_eq!(logs.events("funding_interval_changed")[0].number("from"), 8.0);

        intervals.set("btcusdt", None);
        assert!(intervals.hours("btcusdt").is_nan());
        assert_eq!(logs.events("funding_interval_unknown").len(), 1);
    }

    #[tokio::test]
    async fn holds_the_history_reads_on_a_429_and_keeps_sending_the_socket_rows() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(&history_path("ethusdt"), history("ethusdt", &four_hours()));
        rest.fail(&history_path("btcusdt"), 429);
        let venue = venue(&rest, &["ethusdt", "btcusdt", "solusdt"]);

        assert!(venue.fetch_round(&http(), AT).await.is_err());
        assert_eq!(logs.events("funding_interval_rate_limited").len(), 1);
        push(&venue, &["ethusdt", "btcusdt", "solusdt"], fund_rates("ethusdt", COUNTDOWN), AT);

        // Inside the 30 s pause the round reads no history and still sends the row the socket filled.
        let rows = venue.fetch_round(&http(), AT + 29_000).await.unwrap();
        assert_eq!(rows.keys().collect::<Vec<_>>(), ["ethusdt"]);
        assert_eq!(rest.calls().len(), 2);

        rest.reply(&history_path("btcusdt"), history("btcusdt", &one_hour()));
        venue.fetch_round(&http(), AT + 30_000).await.unwrap();
        let mut calls = rest.calls().split_off(2);
        calls.sort();
        assert_eq!(calls, [history_path("btcusdt"), history_path("solusdt")]);
        assert_eq!(venue.intervals.lock().unwrap().hours("btcusdt"), 1.0);
    }

    #[tokio::test]
    async fn retries_a_failed_read_three_times_and_logs_it_once() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        // The unknown contract answer, HTTP 400 with {"message":"合约不存在"}.
        rest.fail(&history_path("nopeusdt"), 400);
        let venue = venue(&rest, &["nopeusdt"]);

        for _ in 0..6 {
            let _ = venue.fetch_round(&http(), AT).await;
        }

        // Four reads in the first four rounds, then the refresh of round 5.
        assert_eq!(rest.calls().len(), 5);
        assert_eq!(logs.events("funding_interval_read_failed").len(), 1);
    }

    #[tokio::test]
    async fn fails_a_reply_whose_code_is_not_200() {
        let rest = MockRest::start().await;
        rest.reply("/x", json!({ "code": 404, "data": null, "msg": "请求地址不存在" }));

        let error = get_data::<Value>(&http(), &format!("{}/x", rest.url)).await.unwrap_err();

        assert!(error.to_string().starts_with("code 404"), "{error:#}");
    }

    #[tokio::test]
    async fn encodes_a_contract_code_in_chinese_into_the_history_path() {
        let rest = MockRest::start().await;
        let code = "龙虾usdt";
        rest.reply("/api/v1/perpetual/public/%E9%BE%99%E8%99%BEusdt/fee-rate?page=1&pageSize=3", history(code, &four_hours()));
        let venue = venue(&rest, &[code]);

        let _ = venue.fetch_round(&http(), AT).await;

        assert_eq!(venue.intervals.lock().unwrap().hours(code), 4.0);
    }
}
