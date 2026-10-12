use super::{Digifinex, ID};
use crate::clock::now_ms;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, RateLimited, get_bytes};
use crate::venues::wire;
use anyhow::Context;
use futures_util::future::join_all;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::collections::{HashMap, HashSet};
use std::time::Duration;

// Index and mark of every contract in one reply, weight 1.
// Its timestamp ran up to 60 s behind and stepped backwards while the prices moved, so the row takes the reply's arrival.
pub const TICKERS_PATH: &str = "/swap/v2/public/tickers";

// The only REST source of the upcoming rate, weight 10 and one contract per call.
// Its one entry after now is the live estimate and its time the next settlement, and the entry before it gives the interval.
// The funding_rate call is not used, because it returns the last settled rate and labels every contract 8 h.
pub const HISTORY_PATH: &str = "/swap/v2/public/funding_rate_history";

// Reaches the settlement before the upcoming one on any interval up to a day, while 8 h and 4 h are all the venue lists.
const HISTORY_WINDOW_MS: i64 = 25 * 3_600_000;

// The budget is 6,000 weight a minute per IP, and a ban of 2 minutes to a day follows repeated 429s.
// Two reads a round is 1,200 a minute and refreshes each of about 100 contracts every 50 s.
const ROTATION_PER_ROUND: usize = 2;

// A contract with no reading yet, or whose settlement has passed, is read ahead of its turn.
// So the first round and the round after a settlement read every contract, and 103 reads at once all answered 200 on 2026-10-09.
// A contract whose read failed waits a minute before it jumps the queue again, so a venue that fails every read costs about 1,000 weight a minute.
const EAGER_PER_ROUND: usize = 100;
const EAGER_RETRY_MS: i64 = 60_000;

// The constant of docs/profiles/digifinex/rest.md for a contract whose history has no entry before the upcoming one.
const DEFAULT_INTERVAL_HOURS: f64 = 8.0;

// FrequencyLimit in the documented error codes, should the venue send it inside a reply.
const RATE_LIMIT_CODE: i64 = 403001;

#[derive(Debug, Clone, Copy, PartialEq)]
struct Reading {
    rate: f64,
    interval_hours: f64,
    next_at: i64, // Unix ms of the settlement the rate applies to
}

#[derive(Default)]
pub struct FundingState {
    readings: HashMap<String, Reading>,
    failed_at: HashMap<String, i64>, // round time of each contract's last failed read
    warned: HashSet<String>,        // contracts whose failed read was logged since their last good one
    next: usize,                    // position in the tracked list of the next read in turn
}

impl AnchorVenue for Digifinex {
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(60)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let ids = self.plan_reads(ts);

        let tickers_url = format!("{}{TICKERS_PATH}", self.rest);
        let tickers = async {
            let rows: Vec<Ticker> = get_data(http, &tickers_url).await?;
            anyhow::Ok((rows, now_ms()))
        };
        let reads = join_all(ids.into_iter().map(|raw_market_id| async move {
            let read = self.read_funding(http, &raw_market_id, ts).await;
            (raw_market_id, read)
        }));
        let (tickers, reads) = tokio::join!(tickers, reads);

        // The readings are kept even when the tickers fail the round, since the rotation has already moved past them.
        let mut funding = self.funding.lock().unwrap();
        let mut limited = None;
        for (raw_market_id, read) in reads {
            match read {
                Ok(reading) => {
                    funding.warned.remove(&raw_market_id);
                    funding.failed_at.remove(&raw_market_id);
                    funding.readings.insert(raw_market_id, reading);
                }
                Err(error) => {
                    funding.failed_at.insert(raw_market_id.clone(), ts);
                    if funding.warned.insert(raw_market_id.clone()) {
                        tracing::warn!(event = "funding_read_failed", venue = ID, market = %raw_market_id, error = format!("{error:#}"));
                    }
                    if error.is::<RateLimited>() {
                        limited.get_or_insert(error);
                    }
                }
            }
        }

        // Weight counts per IP, so a refused funding read pauses the poller before the venue escalates to a ban.
        if let Some(error) = limited {
            return Err(error);
        }
        let (tickers, arrived_at) = tickers?;

        // The basket behind each index is not published, so no row can be told apart as a self index.
        let mut rows = AnchorMap::with_capacity(self.markets.len());
        for ticker in tickers {
            let Some(reading) = funding.readings.get(&ticker.instrument_id) else {
                continue;
            };
            rows.insert(
                ticker.instrument_id,
                AnchorRow {
                    index: ticker.index_price,
                    mark: ticker.mark_price,
                    funding_rate: reading.rate,
                    funding_interval_hours: reading.interval_hours,
                    next_funding_at: reading.next_at,
                    ts: Some(arrived_at),
                },
            );
        }

        Ok(rows)
    }
}

impl Digifinex {
    // The next contracts in turn, then the ones that have no current reading and did not fail in the last minute.
    fn plan_reads(&self, ts: i64) -> Vec<String> {
        let mut funding = self.funding.lock().unwrap();
        let count = self.markets.len();
        if count == 0 {
            return Vec::new();
        }

        let mut ids: Vec<String> = Vec::new();
        for _ in 0..ROTATION_PER_ROUND.min(count) {
            let position = funding.next % count;
            funding.next = (position + 1) % count;
            ids.push(self.markets[position].clone());
        }

        let mut eager = 0;
        for raw_market_id in &self.markets {
            if eager == EAGER_PER_ROUND {
                break;
            }
            let current = funding.readings.get(raw_market_id).is_some_and(|reading| reading.next_at > ts);
            let failed_recently = funding.failed_at.get(raw_market_id).is_some_and(|&at| ts - at < EAGER_RETRY_MS);
            if current || failed_recently || ids.contains(raw_market_id) {
                continue;
            }
            ids.push(raw_market_id.clone());
            eager += 1;
        }

        ids
    }

    async fn read_funding(&self, http: &reqwest::Client, raw_market_id: &str, ts: i64) -> anyhow::Result<Reading> {
        let start = ts - HISTORY_WINDOW_MS;
        let url = format!("{}{HISTORY_PATH}?instrument_id={raw_market_id}&start_timestamp={start}&limit=100", self.rest);
        let history: History = get_data(http, &url).await?;
        upcoming(&history.funding_rates, ts).with_context(|| format!("from {url}"))
    }
}

// The entries run oldest first, and exactly one lay after now on each of 103 contracts on 2026-10-09.
fn upcoming(entries: &[Entry], now: i64) -> anyhow::Result<Reading> {
    let Some(i) = entries.iter().position(|entry| entry.time > now) else {
        anyhow::bail!("no upcoming funding entry");
    };

    let entry = &entries[i];
    // An unreadable rate fails the read, so the market keeps its last reading rather than losing its row.
    if !entry.rate.is_finite() {
        anyhow::bail!("unreadable upcoming funding rate");
    }
    let interval_hours = match i.checked_sub(1).map(|previous| entry.time - entries[previous].time) {
        Some(step) if step > 0 => step as f64 / 3_600_000.0,
        _ => DEFAULT_INTERVAL_HOURS,
    };

    Ok(Reading {
        rate: entry.rate,
        interval_hours,
        next_at: entry.time,
    })
}

// Every call answers {"code":0,"data":...}, and a failure carries another code with a msg, under HTTP 400 for a bad parameter.
pub async fn get_data<T: DeserializeOwned>(http: &reqwest::Client, url: &str) -> anyhow::Result<T> {
    let body = get_bytes(http, url).await?;
    let status: Status = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;

    if status.code != 0 {
        let message = status.msg.unwrap_or_default();
        if status.code == RATE_LIMIT_CODE {
            return Err(RateLimited {
                url: url.to_string(),
                reason: format!("code {}: {message}", status.code),
                retry_after: None,
            }
            .into());
        }
        anyhow::bail!("code {}: {message} from {url}", status.code);
    }

    let reply: Data<T> = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;
    Ok(reply.data)
}

#[derive(Deserialize)]
struct Status {
    #[serde(default = "no_code")]
    code: i64,
    msg: Option<String>,
}

fn no_code() -> i64 {
    -1
}

#[derive(Deserialize)]
struct Data<T> {
    data: T,
}

// Every price is a decimal string.
#[derive(Deserialize)]
struct Ticker {
    #[serde(default)]
    instrument_id: String, // "BTCUSDTPERP", inverse rows included
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
}

#[derive(Deserialize)]
struct History {
    #[serde(default)]
    funding_rates: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    rate: f64, // a fraction per interval, "0.00014"
    #[serde(default)]
    time: i64, // Unix ms of the settlement
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, market, tracked};
    use serde_json::{Value, json};

    // 2026-10-09 17:46:40 UTC, between the 16:00 settlement and the 20:00 one of a 4 h contract.
    const NOW: i64 = 1_791_568_000_000;
    const START: i64 = NOW - 25 * 3_600_000;

    fn history_path(raw_market_id: &str, now: i64) -> String {
        let start = now - 25 * 3_600_000;
        format!("{HISTORY_PATH}?instrument_id={raw_market_id}&start_timestamp={start}&limit=100")
    }

    // Rows of the tickers reply captured live on 2026-10-09, cut to three rows and a few of the fields the poller ignores.
    fn tickers() -> Value {
        json!({ "code": 0, "data": [
            {
                "instrument_id": "BTCUSDTPERP", "index_price": "82618.2", "mark_price": "82604.6", "max_buy_price": "86749.1",
                "min_sell_price": "78487.3", "best_bid": "82604.0", "best_ask": "82604.1", "last": "82604.1", "timestamp": 1791567647300_i64,
            },
            {
                "instrument_id": "XAUTUSDTPERP", "index_price": "4199.5", "mark_price": "4199.6", "max_buy_price": "4409.4",
                "min_sell_price": "3989.5", "best_bid": "4198.8", "best_ask": "4200.3", "last": "4200.3", "timestamp": 1791567647300_i64,
            },
            {
                "instrument_id": "BTCPERP", "index_price": "82618.2", "mark_price": "82621.5", "max_buy_price": "86749.1",
                "min_sell_price": "78487.3", "best_bid": "82610.1", "best_ask": "82625.3", "last": "82620", "timestamp": 1791567647300_i64,
            },
        ]})
    }

    // Histories captured live on 2026-10-09 from the window start, the last entry being the upcoming settlement.
    fn btc_history() -> Value {
        json!({ "code": 0, "data": { "instrument_id": "BTCUSDTPERP", "funding_rates": [
            { "rate": "0", "time": 1791504000000_i64 },
            { "rate": "0", "time": 1791532800000_i64 },
            { "rate": "0.00013", "time": 1791561600000_i64 },
            { "rate": "0.00014", "time": 1791590400000_i64 },
        ]}})
    }

    fn xaut_history() -> Value {
        json!({ "code": 0, "data": { "instrument_id": "XAUTUSDTPERP", "funding_rates": [
            { "rate": "0.0003", "time": 1791489600000_i64 },
            { "rate": "0.0005", "time": 1791504000000_i64 },
            { "rate": "-0.00058", "time": 1791518400000_i64 },
            { "rate": "-0.00056", "time": 1791532800000_i64 },
            { "rate": "-0.00009", "time": 1791547200000_i64 },
            { "rate": "0.00016", "time": 1791561600000_i64 },
            { "rate": "0.00011", "time": 1791576000000_i64 },
        ]}})
    }

    fn poller(rest: &MockRest, raw_market_ids: &[&str]) -> Digifinex {
        let mut markets = Vec::new();
        for id in raw_market_ids {
            markets.push(market(ID, id, id.trim_end_matches("USDTPERP"), "USDT", true));
        }
        Digifinex::with_rest(&tracked(&markets), &rest.url)
    }

    fn keys(rows: &AnchorMap) -> Vec<&str> {
        let mut keys: Vec<&str> = rows.keys().map(String::as_str).collect();
        keys.sort();
        keys
    }

    fn history_calls(rest: &MockRest) -> Vec<String> {
        rest.calls().into_iter().filter(|call| call.starts_with(HISTORY_PATH)).collect()
    }

    #[test]
    fn polls_every_second_and_pauses_a_minute_on_a_rate_limit() {
        let venue = Digifinex::new(&[]);

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(60));
    }

    #[tokio::test]
    async fn maps_index_and_mark_from_the_tickers_and_funding_from_the_upcoming_history_entry() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, tickers());
        rest.reply(&history_path("BTCUSDTPERP", NOW), btc_history());
        rest.reply(&history_path("XAUTUSDTPERP", NOW), xaut_history());

        let before = now_ms();
        let rows = poller(&rest, &["BTCUSDTPERP", "XAUTUSDTPERP"]).fetch_round(&http(), NOW).await.unwrap();
        let after = now_ms();

        let btc = rows["BTCUSDTPERP"];
        assert_eq!(
            (btc.index, btc.mark, btc.funding_rate, btc.funding_interval_hours, btc.next_funding_at),
            (82618.2, 82604.6, 0.00014, 8.0, 1_791_590_400_000)
        );
        let xaut = rows["XAUTUSDTPERP"];
        assert_eq!(
            (xaut.funding_rate, xaut.funding_interval_hours, xaut.next_funding_at),
            (0.00011, 4.0, 1_791_576_000_000)
        );
        // The tickers' own timestamp is a minute old, so the row takes the reply's arrival.
        let ts = btc.ts.unwrap();
        assert!(before <= ts && ts <= after, "{before} <= {ts} <= {after}");
        assert!(rest.calls().contains(&format!("{HISTORY_PATH}?instrument_id=BTCUSDTPERP&start_timestamp={START}&limit=100")));
    }

    #[tokio::test]
    async fn leaves_out_untracked_inverse_rows_and_markets_with_no_funding_yet() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, tickers());
        rest.reply(&history_path("XAUTUSDTPERP", NOW), xaut_history());

        let rows = poller(&rest, &["BTCUSDTPERP", "XAUTUSDTPERP"]).fetch_round(&http(), NOW).await.unwrap();

        assert_eq!(keys(&rows), ["XAUTUSDTPERP"]);
    }

    fn ids_read(rest: &MockRest, from: usize) -> Vec<String> {
        let mut ids: Vec<String> = Vec::new();
        for call in &history_calls(rest)[from..] {
            ids.push(call.split(['=', '&']).nth(1).unwrap().to_string());
        }
        ids.sort();
        ids
    }

    #[tokio::test]
    async fn reads_every_market_without_a_reading_at_once_and_then_two_a_round_in_turn() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, tickers());
        let ids = ["M0", "M1", "M2", "M3", "M4", "M5", "M6", "M7", "M8", "M9"];
        for id in ids {
            rest.reply(&history_path(id, NOW), btc_history());
            rest.reply(&history_path(id, NOW + 1_000), btc_history());
        }
        let venue = poller(&rest, &ids);

        venue.fetch_round(&http(), NOW).await.unwrap();
        assert_eq!(ids_read(&rest, 0), ids);
        venue.fetch_round(&http(), NOW + 1_000).await.unwrap();
        assert_eq!(ids_read(&rest, 10), ["M2", "M3"]);
        venue.fetch_round(&http(), NOW + 2_000).await.unwrap();
        assert_eq!(ids_read(&rest, 12), ["M4", "M5"]);
    }

    #[tokio::test]
    async fn a_market_whose_read_failed_waits_a_minute_before_it_is_read_ahead_of_its_turn() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, tickers());
        let ids = ["A", "B", "C", "D", "E", "F"];
        for id in &ids[1..] {
            rest.reply(&history_path(id, NOW), btc_history());
        }
        let venue = poller(&rest, &ids);
        venue.fetch_round(&http(), NOW).await.unwrap();

        venue.fetch_round(&http(), NOW + 1_000).await.unwrap();
        assert_eq!(ids_read(&rest, 6), ["C", "D"]);
        venue.fetch_round(&http(), NOW + 61_000).await.unwrap();
        assert_eq!(ids_read(&rest, 8), ["A", "E", "F"]);
    }

    #[tokio::test]
    async fn rereads_a_market_ahead_of_its_turn_once_its_settlement_has_passed() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, tickers());
        let ids = ["XAUTUSDTPERP", "M0", "M1", "M2", "M3"];
        for id in ids {
            rest.reply(&history_path(id, NOW), btc_history());
        }
        rest.reply(&history_path("XAUTUSDTPERP", NOW), xaut_history());
        let venue = poller(&rest, &ids);
        venue.fetch_round(&http(), NOW).await.unwrap();

        // A minute past XAUT's 20:00 settlement, and before BTC's 00:00.
        let later = 1_791_576_000_000 + 60_000;
        let calls = history_calls(&rest).len();
        venue.fetch_round(&http(), later).await.unwrap();

        assert_eq!(ids_read(&rest, calls), ["M1", "M2", "XAUTUSDTPERP"]);
    }

    #[test]
    fn takes_the_first_entry_after_now_with_the_step_from_the_entry_before_as_the_interval() {
        let entries = |times: &[i64]| -> Vec<Entry> { times.iter().map(|&time| Entry { rate: 0.0001, time }).collect() };

        let reading = upcoming(&entries(&[NOW - 7_200_000, NOW + 7_200_000]), NOW).unwrap();
        assert_eq!((reading.interval_hours, reading.next_at), (4.0, NOW + 7_200_000));
        // A new contract with no settlement behind it takes the profile's 8 h.
        assert_eq!(upcoming(&entries(&[NOW + 1_000]), NOW).unwrap().interval_hours, 8.0);
        assert!(upcoming(&entries(&[NOW - 1_000, NOW]), NOW).is_err());
        assert!(upcoming(&[], NOW).is_err());
        let unreadable = [Entry { rate: f64::NAN, time: NOW + 1_000 }];
        assert!(upcoming(&unreadable, NOW).is_err());
    }

    #[tokio::test]
    async fn keeps_the_last_reading_of_a_market_whose_read_fails_and_logs_it_once() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, tickers());
        rest.reply(&history_path("BTCUSDTPERP", NOW), btc_history());
        let venue = poller(&rest, &["BTCUSDTPERP", "XAUTUSDTPERP"]);
        venue.fetch_round(&http(), NOW).await.unwrap();

        // The next round's window starts later, and that path answers 404 for both.
        for round in 1..4 {
            let rows = venue.fetch_round(&http(), NOW + round * 20_000).await.unwrap();
            assert_eq!(keys(&rows), ["BTCUSDTPERP"]);
            assert_eq!(rows["BTCUSDTPERP"].funding_rate, 0.00014);
        }

        let warnings = logs.events("funding_read_failed");
        let markets: HashSet<String> = warnings.iter().map(|warning| warning.text("market").to_string()).collect();
        assert_eq!(markets.len(), warnings.len(), "one warning per market");
        assert!(warnings[0].text("error").contains("404"), "{:?}", warnings[0]);
    }

    #[tokio::test]
    async fn fails_the_round_on_a_failed_tickers_call_or_a_venue_error_code() {
        let rest = MockRest::start().await;
        rest.reply(&history_path("BTCUSDTPERP", NOW), btc_history());
        let venue = poller(&rest, &["BTCUSDTPERP"]);

        let error = venue.fetch_round(&http(), NOW).await.unwrap_err();
        assert!(error.to_string().contains(&format!("404 Not Found from {}{TICKERS_PATH}", rest.url)), "{error:#}");

        rest.reply(TICKERS_PATH, json!({ "code": 400002, "msg": "invalid InstrumentId" }));
        let error = venue.fetch_round(&http(), NOW).await.unwrap_err();
        assert!(error.to_string().starts_with("code 400002: invalid InstrumentId"), "{error:#}");
    }

    #[tokio::test]
    async fn keeps_the_readings_of_a_round_whose_tickers_call_failed() {
        let rest = MockRest::start().await;
        let ids = ["BTCUSDTPERP", "XAUTUSDTPERP", "M0"];
        for id in ids {
            rest.reply(&history_path(id, NOW), btc_history());
        }
        let venue = poller(&rest, &ids);
        assert!(venue.fetch_round(&http(), NOW).await.is_err());

        rest.reply(TICKERS_PATH, tickers());
        let rows = venue.fetch_round(&http(), NOW + 1_000).await.unwrap();

        assert_eq!(keys(&rows), ["BTCUSDTPERP", "XAUTUSDTPERP"]);
        assert_eq!(history_calls(&rest).len(), 3 + 2);
    }

    #[tokio::test]
    async fn pauses_the_poller_when_a_funding_read_is_rate_limited() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, tickers());
        rest.fail(&history_path("BTCUSDTPERP", NOW), 429);
        let venue = poller(&rest, &["BTCUSDTPERP"]);

        let error = venue.fetch_round(&http(), NOW).await.unwrap_err();
        assert!(error.is::<RateLimited>(), "{error:#}");

        rest.reply(&history_path("BTCUSDTPERP", NOW + 20_000), json!({ "code": 403001, "msg": "FrequencyLimit" }));
        let error = venue.fetch_round(&http(), NOW + 20_000).await.unwrap_err();
        assert!(error.is::<RateLimited>(), "{error:#}");
    }
}
