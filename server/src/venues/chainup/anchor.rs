use super::markets::{ScheduleRow, read_schedule};
use super::{AnchorSource, Chainup, FundingField};
use crate::clock::now_ms;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, RateLimited, get_json};
use crate::venues::wire;
use futures_util::StreamExt;
use futures_util::stream;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::{Duration, Instant};

const HOUR_MS: i64 = 3_600_000;

// The interval and the next settlement change at most once per settlement, and each schedule call is a reply of 60 to 270 KB.
const SCHEDULE_EVERY: Duration = Duration::from_secs(60);
const SCHEDULE_RETRY: Duration = Duration::from_secs(10);
const FAILURE_LOG_EVERY: u32 = 30;

// Every socket anchored market had its first anchor frame within 2 s of the subscribe, and the schedule call took up to 2.4 s.
const WARMUP: Duration = Duration::from_secs(15);

// FameEX's /index answered in about 300 ms, and 24 calls in flight swept its 209 contracts in 2.4 to 3.5 s on 2026-10-09.
// That is the sweep of about 3 s that the anchor reader's skew allows, and no rate limit is published.
const SWEEP_IN_FLIGHT: usize = 24;

// The docs answer a burst with 429, then 418 if it goes on, and publish no window.
const RATE_LIMIT_PAUSE: Duration = Duration::from_secs(10);

const INDEX_PATH: &str = "/index?contractName=";

// FameEX's edge serves the HTTP/2 streams of one connection one after another.
// On 2026-10-09 the run's client, which speaks HTTP/2, swept 209 contracts in 10 to 13 s, and 120 calls took 6.6 s on HTTP/2 against 1.9 s on HTTP/1.1.
// So the sweep holds its own client of HTTP/1.1 connections, one per call in flight.
pub fn sweep_client(venue_id: &str) -> Option<reqwest::Client> {
    let built = reqwest::Client::builder()
        .http1_only()
        .user_agent("arbitrage-observatory")
        .connect_timeout(Duration::from_secs(10))
        .pool_max_idle_per_host(SWEEP_IN_FLIGHT)
        .build();
    match built {
        Ok(client) => Some(client),
        Err(error) => {
            tracing::error!(event = "sweep_client_failed", venue = venue_id, %error, fallback = "the run's client");
            None
        }
    }
}

// Each tracked contract's interval and next settlement, refreshed about once a minute.
#[derive(Default)]
pub struct FundingSchedule {
    by_raw: HashMap<String, Funding>,
    read_at: Option<Instant>,
    failures: u32,
}

#[derive(Debug, Clone, PartialEq)]
pub struct Funding {
    pub interval_hours: f64,
    pub next_at: i64, // Unix ms, 0 = unknown
    pub contract: String,
}

impl FundingSchedule {
    pub fn get(&self, raw_market_id: &str) -> Option<Funding> {
        self.by_raw.get(raw_market_id).cloned()
    }

    // The interval in hours and the next settlement, without the contract name a ticker frame does not need.
    pub fn timing(&self, raw_market_id: &str) -> Option<(f64, i64)> {
        let funding = self.by_raw.get(raw_market_id)?;
        Some((funding.interval_hours, funding.next_at))
    }

    fn due(&self) -> bool {
        let every = if self.failures > 0 { SCHEDULE_RETRY } else { SCHEDULE_EVERY };
        self.read_at.is_none_or(|read_at| read_at.elapsed() >= every)
    }

    pub(super) fn replace(&mut self, rows: Vec<ScheduleRow>) {
        self.by_raw.clear();
        for row in rows {
            let funding = Funding {
                interval_hours: row.interval_hours,
                next_at: row.next_at,
                contract: row.contract,
            };
            self.by_raw.insert(row.raw, funding);
        }
        self.read_at = Some(Instant::now());
        self.failures = 0;
    }
}

impl AnchorVenue for Chainup {
    // A sweep runs again on the next tick after it ends, since a round that overruns a longer period waits for the tick after.
    // A 3 s period met by a 3.2 s sweep would leave each row 6 s between reads.
    fn poll_every(&self) -> Duration {
        Duration::from_secs(1)
    }

    fn rate_limit_pause(&self) -> Duration {
        RATE_LIMIT_PAUSE
    }

    // The socket anchored members make no request but the schedule's, since handle fills SocketAnchors.
    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        self.refresh_schedule(http).await?;

        let mut rows = match self.profile.anchor {
            AnchorSource::Rest => self.sweep(http).await?,
            _ => self.socket_rows()?,
        };

        // A schedule read just before a settlement still names it, so a passed one moves on by whole intervals.
        for row in rows.values_mut() {
            row.next_funding_at = next_settlement(row.next_funding_at, row.funding_interval_hours, ts);
        }
        Ok(rows)
    }
}

impl Chainup {
    // A failed read keeps the last schedule, and fails the round only while there is none.
    async fn refresh_schedule(&self, http: &reqwest::Client) -> anyhow::Result<()> {
        if !self.schedule.lock().unwrap().due() {
            return Ok(());
        }

        let read = read_schedule(http, self.profile.schedule, &self.schedule_url).await;
        let mut schedule = self.schedule.lock().unwrap();
        match read {
            Ok(rows) if !rows.is_empty() => {
                if schedule.failures > 0 {
                    tracing::info!(event = "funding_schedule_recovered", venue = self.profile.id, failures = schedule.failures);
                }
                schedule.replace(rows);
                Ok(())
            }
            Ok(_) => self.schedule_failed(&mut schedule, anyhow::anyhow!("the schedule call listed no contract")),
            Err(error) => self.schedule_failed(&mut schedule, error),
        }
    }

    fn schedule_failed(&self, schedule: &mut FundingSchedule, error: anyhow::Error) -> anyhow::Result<()> {
        schedule.failures += 1;
        schedule.read_at = Some(Instant::now());
        if schedule.failures == 1 || schedule.failures % FAILURE_LOG_EVERY == 0 {
            tracing::warn!(
                event = "funding_schedule_failed",
                venue = self.profile.id,
                failures = schedule.failures,
                kept = schedule.by_raw.len(),
                error = format!("{error:#}"),
            );
        }
        if schedule.by_raw.is_empty() { Err(error.context("no funding schedule yet")) } else { Ok(()) }
    }

    fn socket_rows(&self) -> anyhow::Result<AnchorMap> {
        let rows = self.anchors.rows();

        // The first rounds run before the sockets open, and a round that fails whole logs one line where every missing row would log one each.
        let first_round = *self.first_round.get_or_init(Instant::now);
        if rows.len() < self.tracked.len() && first_round.elapsed() < WARMUP {
            anyhow::bail!(
                "warming up, {} of {} markets have their index, mark and funding",
                rows.len(),
                self.tracked.len()
            );
        }
        Ok(rows)
    }

    // One /index call per tracked contract, a few dozen in flight, each row stamped with its own reply's arrival.
    // A contract the schedule does not hold has no interval, so it is not read.
    async fn sweep(&self, http: &reqwest::Client) -> anyhow::Result<AnchorMap> {
        let http = self.sweep_http.as_ref().unwrap_or(http);
        let targets: Vec<(String, Funding)> = {
            let schedule = self.schedule.lock().unwrap();
            self.tracked.iter().filter_map(|raw| Some((raw.clone(), schedule.get(raw)?))).collect()
        };
        if targets.is_empty() {
            anyhow::bail!("the schedule holds none of the {} tracked contracts", self.tracked.len());
        }

        let reads: Vec<(String, Funding, anyhow::Result<IndexReply>, i64)> = stream::iter(targets)
            .map(|(raw, funding)| async move {
                let url = format!("{}{INDEX_PATH}{}", self.rest, funding.contract);
                let read = read_index(http, &url).await;
                (raw, funding, read, now_ms())
            })
            .buffer_unordered(SWEEP_IN_FLIGHT)
            .collect()
            .await;

        let mut rows = AnchorMap::with_capacity(reads.len());
        let mut first_error = None;
        for (raw, funding, read, arrived_at) in reads {
            let reply = match read {
                Ok(reply) => reply,
                // A rate limit answer fails the whole round, so the poller pauses every call.
                Err(error) if error.downcast_ref::<RateLimited>().is_some() => return Err(error),
                Err(error) => {
                    first_error.get_or_insert(error);
                    continue;
                }
            };
            let funding_rate = match self.profile.funding {
                FundingField::Current => reply.current_fund_rate,
                FundingField::Next => reply.next_fund_rate,
            };
            rows.insert(
                raw,
                AnchorRow {
                    index: reply.index_price,
                    mark: reply.tag_price,
                    funding_rate,
                    funding_interval_hours: funding.interval_hours,
                    next_funding_at: funding.next_at,
                    ts: Some(arrived_at),
                },
            );
        }

        if rows.is_empty()
            && let Some(error) = first_error
        {
            return Err(error.context("every /index call failed"));
        }
        Ok(rows)
    }
}

// An error arrives under HTTP 200 with a code, such as -1121 for a contract the venue does not know.
async fn read_index(http: &reqwest::Client, url: &str) -> anyhow::Result<IndexReply> {
    let reply: IndexReply = get_json(http, url).await?;
    if let Some(code) = &reply.code {
        anyhow::bail!("{url} answered code {code}: {}", reply.msg.as_deref().unwrap_or(""));
    }
    Ok(reply)
}

fn next_settlement(next_funding_at: i64, interval_hours: f64, ts: i64) -> i64 {
    let interval_ms = (interval_hours * HOUR_MS as f64) as i64;
    if next_funding_at <= 0 || interval_ms <= 0 || next_funding_at > ts {
        return next_funding_at;
    }
    let behind = (ts - next_funding_at).div_euclid(interval_ms) + 1;
    next_funding_at + behind * interval_ms
}

#[derive(Deserialize)]
struct IndexReply {
    #[serde(default = "wire::nan", rename = "indexPrice", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", rename = "tagPrice", deserialize_with = "wire::num")]
    tag_price: f64, // the mark
    #[serde(default = "wire::nan", rename = "currentFundRate", deserialize_with = "wire::num")]
    current_fund_rate: f64,
    #[serde(default = "wire::nan", rename = "nextFundRate", deserialize_with = "wire::num")]
    next_fund_rate: f64,
    code: Option<serde_json::Value>, // "-1121", only on an error
    msg: Option<String>,
}

#[cfg(test)]
mod tests {
    use super::super::{AIVORA, FAMEEX, KOINBAY, XME};
    use super::*;
    use crate::engine::cluster::Market;
    use crate::feeds::venue_feed::Connection;
    use crate::test_log::capture;
    use crate::venues::testing::{self, MockRest, http};
    use serde_json::{Value, json};
    use std::sync::OnceLock;

    const T0: i64 = 1_791_576_300_000; // 2026-10-09 20:05 UTC
    const MIDNIGHT: i64 = 1_791_590_400_000; // 2026-10-10 00:00 UTC
    const EIGHT_PM: i64 = 1_791_576_000_000; // 2026-10-09 20:00 UTC, a settlement that had passed when the web list still named it

    fn market(raw_market_id: &str) -> Market {
        testing::market("x", raw_market_id, "BTC", "USDT", true)
    }

    fn tracked(raws: &[&str]) -> Vec<crate::feeds::TrackedMarket> {
        let markets: Vec<Market> = raws.iter().map(|raw| market(raw)).collect();
        testing::tracked(&markets)
    }

    // The web list's rows captured on 2026-10-09, cut to the fields the schedule reads.
    fn public_info(rows: &[(&str, &str, i64, i64)]) -> Value {
        let rows: Vec<Value> = rows
            .iter()
            .map(|&(contract, sub, hours, next)| {
                json!({"contractName":contract,"subSymbol":sub,"capitalFrequency":hours,"capitalFrequencyUnit":"h","capitalStartTime":0,"nextCapitalSettTime":next})
            })
            .collect();
        json!({"code":"0","msg":"Success","data":{"marginCoinList":["USDT"],"contractList":rows}})
    }

    // FameEX's /index for E-BTC-USDT on 2026-10-09, and its answer for a contract it does not know.
    fn index_reply() -> Value {
        json!({"currentFundRate":0.0000123800000000_f64,"indexPrice":82325.91500000000000000_f64,"before24LowPrice":81570.4,"before24HighPrice":83483.6,"tagPrice":82299.4,"newPrice":82299.4,"nextFundRate":0.00004682})
    }

    fn unknown_contract() -> Value {
        json!({"code":"-1121","msg":"无效的合约","data":null})
    }

    async fn socket_venue(profile: &'static super::super::Profile, raws: &[&str], rest: &MockRest) -> Chainup {
        rest.reply("/public_info", public_info(&[("E-BTC-USDT", "e_btcusdt", 8, MIDNIGHT), ("E-XAG-USDT", "e_xagusdt", 8, EIGHT_PM)]));
        Chainup::with_hosts(profile, &tracked(raws), &rest.url, &format!("{}/public_info", rest.url))
    }

    // x.me's ticker, captured on 2026-10-09.
    fn feed_ticker(venue: &Chainup, raw: &str, at: i64) {
        let mut conn: Connection<()> = Connection::for_test("xme#perp#0", vec![market(raw)]);
        let frame = json!({"event_rep":"","channel":format!("market_{raw}_ticker"),"data":null,"tick":{"mark":"82313.3","index":"82305.4","close":"82299.2","funds_rate":"0.00018579"},"ts":1791576314252_i64,"status":"ok"});
        venue.handle_at(frame.to_string().as_bytes(), &mut conn, at).unwrap();
    }

    fn calls_to(rest: &MockRest, path: &str) -> usize {
        rest.calls().iter().filter(|call| call.as_str() == path).count()
    }

    #[test]
    fn polls_every_second_so_a_sweep_starts_again_within_a_second_of_its_end() {
        for profile in [&AIVORA, &FAMEEX, &XME, &KOINBAY] {
            assert_eq!(Chainup::new(profile, &[]).poll_every(), Duration::from_secs(1));
        }
        assert_eq!(Chainup::new(&FAMEEX, &[]).rate_limit_pause(), Duration::from_secs(10));
    }

    #[test]
    fn a_passed_settlement_moves_on_by_whole_intervals() {
        assert_eq!(next_settlement(MIDNIGHT, 8.0, T0), MIDNIGHT);
        assert_eq!(next_settlement(EIGHT_PM, 8.0, T0), EIGHT_PM + 8 * HOUR_MS);
        assert_eq!(next_settlement(EIGHT_PM, 4.0, EIGHT_PM + 5 * HOUR_MS), EIGHT_PM + 8 * HOUR_MS);
        assert_eq!(next_settlement(EIGHT_PM, 8.0, EIGHT_PM), EIGHT_PM + 8 * HOUR_MS);
        assert_eq!(next_settlement(0, 8.0, T0), 0);
    }

    #[tokio::test]
    async fn a_socket_round_fails_whole_while_warming_up_then_sends_the_rows_it_has() {
        let rest = MockRest::start().await;
        let mut venue = socket_venue(&XME, &["e_btcusdt", "e_ethusdt"], &rest).await;
        venue.fetch_round(&http(), T0).await.unwrap_err();
        feed_ticker(&venue, "e_btcusdt", T0 - 300);

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();
        assert_eq!(format!("{error}"), "warming up, 1 of 2 markets have their index, mark and funding");

        venue.first_round = OnceLock::from(Instant::now() - WARMUP);
        let rows = venue.fetch_round(&http(), T0).await.unwrap();
        assert_eq!(
            rows["e_btcusdt"],
            AnchorRow {
                index: 82305.4,
                mark: 82313.3,
                funding_rate: 0.00018579,
                funding_interval_hours: 8.0,
                next_funding_at: MIDNIGHT,
                ts: Some(T0 - 300),
            }
        );
    }

    #[tokio::test]
    async fn a_settlement_the_schedule_still_names_after_it_passed_moves_on() {
        let rest = MockRest::start().await;
        let venue = socket_venue(&XME, &["e_xagusdt"], &rest).await;
        venue.fetch_round(&http(), T0).await.unwrap_err();
        feed_ticker(&venue, "e_xagusdt", T0);

        let rows = venue.fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows["e_xagusdt"].next_funding_at, EIGHT_PM + 8 * HOUR_MS);
    }

    #[tokio::test]
    async fn the_schedule_is_read_once_a_minute() {
        let rest = MockRest::start().await;
        let venue = socket_venue(&XME, &["e_btcusdt"], &rest).await;
        venue.fetch_round(&http(), T0).await.unwrap_err();
        feed_ticker(&venue, "e_btcusdt", T0);

        venue.fetch_round(&http(), T0).await.unwrap();
        venue.fetch_round(&http(), T0).await.unwrap();
        assert_eq!(calls_to(&rest, "/public_info"), 1);

        venue.schedule.lock().unwrap().read_at = Some(Instant::now() - SCHEDULE_EVERY);
        venue.fetch_round(&http(), T0).await.unwrap();
        assert_eq!(calls_to(&rest, "/public_info"), 2);
    }

    #[tokio::test]
    async fn a_failed_schedule_read_fails_the_round_only_while_there_is_no_schedule() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        let venue = Chainup::with_hosts(&XME, &tracked(&["e_btcusdt"]), &rest.url, &format!("{}/public_info", rest.url));
        rest.fail("/public_info", 502);

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();
        assert!(format!("{error:#}").starts_with("no funding schedule yet"));

        rest.reply("/public_info", public_info(&[("E-BTC-USDT", "e_btcusdt", 8, MIDNIGHT)]));
        venue.schedule.lock().unwrap().read_at = Some(Instant::now() - SCHEDULE_RETRY);
        venue.fetch_round(&http(), T0).await.unwrap_err(); // warming up, with the schedule now read
        feed_ticker(&venue, "e_btcusdt", T0);
        rest.fail("/public_info", 502);
        venue.schedule.lock().unwrap().read_at = Some(Instant::now() - SCHEDULE_EVERY);

        let rows = venue.fetch_round(&http(), T0).await.unwrap();
        assert_eq!(rows["e_btcusdt"].funding_interval_hours, 8.0);
        let failed = logs.events("funding_schedule_failed");
        assert_eq!(failed.len(), 2);
        assert_eq!(failed[1].number("kept"), 1.0);
        assert_eq!(logs.events("funding_schedule_recovered").len(), 1);
    }

    #[tokio::test]
    async fn a_schedule_that_lists_no_contract_counts_as_a_failed_read() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply("/public_info", public_info(&[]));
        let venue = Chainup::with_hosts(&XME, &tracked(&["e_btcusdt"]), &rest.url, &format!("{}/public_info", rest.url));

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();

        assert!(format!("{error:#}").contains("listed no contract"));
        assert_eq!(logs.events("funding_schedule_failed").len(), 1);
    }

    #[tokio::test]
    async fn a_failed_schedule_read_is_retried_after_ten_seconds_rather_than_a_minute() {
        let rest = MockRest::start().await;
        let venue = Chainup::with_hosts(&XME, &tracked(&["e_btcusdt"]), &rest.url, &format!("{}/public_info", rest.url));
        rest.fail("/public_info", 502);
        venue.fetch_round(&http(), T0).await.unwrap_err();
        venue.fetch_round(&http(), T0).await.unwrap_err();
        assert_eq!(calls_to(&rest, "/public_info"), 1);

        venue.schedule.lock().unwrap().read_at = Some(Instant::now() - SCHEDULE_RETRY);
        venue.fetch_round(&http(), T0).await.unwrap_err();
        assert_eq!(calls_to(&rest, "/public_info"), 2);
    }

    async fn fameex(raws: &[&str], schedule: &[(&str, &str, i64, i64)]) -> (MockRest, Chainup) {
        let rest = MockRest::start().await;
        rest.reply("/public_info", public_info(schedule));
        let venue = Chainup::with_hosts(&FAMEEX, &tracked(raws), &rest.url, &format!("{}/public_info", rest.url));
        (rest, venue)
    }

    #[tokio::test]
    async fn the_sweep_reads_each_contract_by_its_open_api_name_and_stamps_each_row_on_its_arrival() {
        let (rest, venue) = fameex(&["e_btcusdt"], &[("E-BTC-USDT", "e_btcusdt", 8, MIDNIGHT)]).await;
        rest.reply("/index?contractName=E-BTC-USDT", index_reply());
        let before = crate::clock::now_ms();

        let rows = venue.fetch_round(&http(), T0).await.unwrap();

        let row = rows["e_btcusdt"];
        assert_eq!((row.index, row.mark), (82325.915, 82299.4));
        assert_eq!(row.funding_rate, 0.00004682); // nextFundRate, the upcoming rate on FameEX
        assert_eq!((row.funding_interval_hours, row.next_funding_at), (8.0, MIDNIGHT));
        assert!(row.ts.unwrap() >= before && row.ts.unwrap() <= crate::clock::now_ms());
    }

    #[tokio::test]
    async fn the_sweep_leaves_out_a_contract_that_answers_an_error_code() {
        let (rest, venue) = fameex(
            &["e_btcusdt", "e_hifiusdt"],
            &[("E-BTC-USDT", "e_btcusdt", 8, MIDNIGHT), ("E-HIFI-USDT", "e_hifiusdt", 4, MIDNIGHT)],
        )
        .await;
        rest.reply("/index?contractName=E-BTC-USDT", index_reply());
        rest.reply("/index?contractName=E-HIFI-USDT", unknown_contract());

        let rows = venue.fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["e_btcusdt"]);
    }

    #[tokio::test]
    async fn the_sweep_fails_when_every_call_fails() {
        let (rest, venue) = fameex(&["e_btcusdt"], &[("E-BTC-USDT", "e_btcusdt", 8, MIDNIGHT)]).await;
        rest.reply("/index?contractName=E-BTC-USDT", unknown_contract());

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();

        assert!(format!("{error:#}").contains("-1121"));
    }

    #[tokio::test]
    async fn a_rate_limit_answer_on_any_call_fails_the_round_so_the_poller_pauses() {
        let (rest, venue) = fameex(
            &["e_btcusdt", "e_ethusdt"],
            &[("E-BTC-USDT", "e_btcusdt", 8, MIDNIGHT), ("E-ETH-USDT", "e_ethusdt", 8, MIDNIGHT)],
        )
        .await;
        rest.reply("/index?contractName=E-BTC-USDT", index_reply());
        rest.fail("/index?contractName=E-ETH-USDT", 429);

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.downcast_ref::<RateLimited>().is_some());
    }

    #[tokio::test]
    async fn the_sweep_does_not_read_a_contract_the_schedule_lacks() {
        let (rest, venue) = fameex(&["e_btcusdt", "e_newusdt"], &[("E-BTC-USDT", "e_btcusdt", 8, MIDNIGHT)]).await;
        rest.reply("/index?contractName=E-BTC-USDT", index_reply());

        let rows = venue.fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.len(), 1);
        assert!(!rest.calls().iter().any(|call| call.contains("E-NEW-USDT")));
    }

    #[tokio::test]
    async fn the_sweep_fails_when_the_schedule_holds_no_tracked_contract() {
        let (_rest, venue) = fameex(&["e_newusdt"], &[("E-BTC-USDT", "e_btcusdt", 8, MIDNIGHT)]).await;

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();

        assert_eq!(format!("{error}"), "the schedule holds none of the 1 tracked contracts");
    }
}
