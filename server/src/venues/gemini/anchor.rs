use super::{Gemini, ID};
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use futures_util::future::join_all;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;

// No bulk call exists, so index and mark take one request per symbol.
const RISKSTATS_PATH: &str = "/v1/riskstats/";
const FUNDING_PATH: &str = "/v1/fundingamount/";

// The public limit is 120 requests a minute, and 90 leaves the rest to the funding call.
const RISKSTATS_PER_MINUTE: u64 = 90;
const MIN_POLL_MS: u64 = 3_000;

// The estimate changes once a minute and REST shows it about 20 s after the socket does.
const FUNDING_MAX_AGE_MS: i64 = 60_000;

const HOUR_MS: f64 = 60.0 * 60.0 * 1000.0;

#[derive(Default)]
pub struct FundingState {
    readings: HashMap<String, Reading>, // by raw id
    tried_at: HashMap<String, i64>,     // Unix ms of each market's last request, so one that keeps failing cannot starve the rest
    in_flight: bool,
}

#[derive(Debug, Clone, Copy)]
struct Reading {
    amount: f64, // estimatedFundingAmount, quote currency per long base unit at the next settlement
    interval_hours: f64,
    next_funding_at: i64, // Unix ms
    read_at: i64,         // Unix ms of the reply
}

impl AnchorVenue for Gemini {
    fn poll_every(&self) -> Duration {
        let spread_ms = (self.markets.len() as u64 * 60_000).div_ceil(RISKSTATS_PER_MINUTE);
        Duration::from_millis(spread_ms.max(MIN_POLL_MS))
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let reads = self.markets.iter().map(|raw_market_id| async move {
            let url = format!("{}{RISKSTATS_PATH}{raw_market_id}", self.rest);
            let stats = get_json::<RiskStats>(http, &url).await?;
            anyhow::Ok((stats, (self.clock)()))
        });
        let results = join_all(reads).await;

        let mut rows = AnchorMap::with_capacity(results.len());
        let mut first_error = None;
        let mut fulfilled = 0;
        {
            let funding = self.funding.lock().unwrap();
            for (raw_market_id, result) in self.markets.iter().zip(results) {
                let (stats, arrived_at) = match result {
                    Ok(read) => read,
                    Err(error) => {
                        first_error.get_or_insert(error);
                        continue;
                    }
                };
                fulfilled += 1;

                // For 10 to 20 s after each hour the reply still names the settlement that just passed.
                let Some(reading) = funding.readings.get(raw_market_id).filter(|r| r.next_funding_at > arrived_at) else {
                    continue;
                };

                rows.insert(
                    raw_market_id.clone(),
                    AnchorRow {
                        index: stats.index_price,
                        mark: stats.mark_price,
                        funding_rate: reading.amount / stats.mark_price,
                        funding_interval_hours: reading.interval_hours,
                        next_funding_at: reading.next_funding_at,
                        ts: Some(arrived_at),
                    },
                );
            }
        }

        // Rethrown so a 429 on every request still pauses the poller.
        if fulfilled == 0
            && let Some(error) = first_error
        {
            return Err(error);
        }

        self.refresh_funding(http);
        Ok(rows)
    }
}

impl Gemini {
    // A funding reply took 1.2 to 3.8 s, so it runs beside the rounds and is never awaited, one request at a time.
    fn refresh_funding(&self, http: &reqwest::Client) {
        let now = (self.clock)();
        let chosen = {
            let mut funding = self.funding.lock().unwrap();
            if funding.in_flight {
                return;
            }

            let mut chosen: Option<&String> = None;
            let mut chosen_tried_at = i64::MAX;
            for raw_market_id in &self.markets {
                let fresh = funding
                    .readings
                    .get(raw_market_id)
                    .is_some_and(|r| now - r.read_at <= FUNDING_MAX_AGE_MS && r.next_funding_at > now);
                if fresh {
                    continue;
                }

                let tried_at = funding.tried_at.get(raw_market_id).copied().unwrap_or(0);
                if tried_at < chosen_tried_at {
                    chosen = Some(raw_market_id);
                    chosen_tried_at = tried_at;
                }
            }

            let Some(chosen) = chosen.cloned() else {
                return;
            };
            funding.tried_at.insert(chosen.clone(), now);
            funding.in_flight = true;
            chosen
        };

        let url = format!("{}{FUNDING_PATH}{chosen}", self.rest);
        let http = http.clone();
        let funding = self.funding.clone();
        let clock = self.clock;
        tokio::spawn(async move {
            let reply = get_json::<FundingAmount>(&http, &url).await;
            let mut funding = funding.lock().unwrap();
            match reply {
                Ok(reply) => {
                    let reading = Reading {
                        amount: reply.estimated_funding_amount,
                        // No interval field exists, and the gap between the two settlement times is the interval.
                        interval_hours: (reply.next_funding_timestamp - reply.funding_timestamp_milli_secs) / HOUR_MS,
                        next_funding_at: reply.next_funding_timestamp as i64,
                        read_at: clock(),
                    };
                    funding.readings.insert(chosen, reading);
                }
                Err(error) => {
                    tracing::warn!(event = "funding_read_failed", venue = ID, market = %chosen, error = format!("{error:#}"));
                }
            }
            funding.in_flight = false;
        });
    }
}

// Names no symbol, so the row is keyed by the request.
// Every number is a decimal string.
#[derive(Deserialize)]
struct RiskStats {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
}

// Every number is a JSON number.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FundingAmount {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_timestamp_milli_secs: f64, // the last settlement
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_funding_timestamp: f64, // in the past for 10 to 20 s after each hour
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    estimated_funding_amount: f64, // quote currency per long base unit at the next settlement, not a rate
}

#[cfg(test)]
impl Gemini {
    fn funding_in_flight(&self) -> bool {
        self.funding.lock().unwrap().in_flight
    }
}

#[cfg(test)]
mod tests {
    // Ported case for case from old_ts_server/src/venues/gemini/anchor.spec.ts.
    // The Nest spec froze Date.now, and these cases give the poller a clock on this thread, which the refresh task shares on a current thread runtime.

    use super::*;
    use crate::feeds::anchor_poller::RateLimited;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, market, tracked};
    use serde_json::{Value, json};
    use std::cell::Cell;

    // 20:49 UTC on 2026-09-15, between the 20:00 and 21:00 settlements of the replies below.
    const T0: i64 = 1_789_505_369_257;
    const LAST_SETTLEMENT: i64 = 1_789_502_400_000;
    const NEXT_SETTLEMENT: i64 = 1_789_506_000_000;
    const BTC_RISK: &str = "/v1/riskstats/btcusdcperp";
    const ETH_RISK: &str = "/v1/riskstats/ethusdcperp";
    const BTC_FUNDING: &str = "/v1/fundingamount/btcusdcperp";
    const ETH_FUNDING: &str = "/v1/fundingamount/ethusdcperp";

    thread_local! {
        static NOW: Cell<i64> = const { Cell::new(T0) };
    }

    fn clock() -> i64 {
        NOW.with(Cell::get)
    }

    fn set_now(ms: i64) {
        NOW.with(|now| now.set(ms));
    }

    fn advance(ms: i64) {
        NOW.with(|now| now.set(now.get() + ms));
    }

    // Replies captured live on 2026-09-15.
    fn btc_risk() -> Value {
        json!({
            "product_type": "PerpetualSwapContract", "mark_price": "75923.455", "index_price": "75881.41733",
            "open_interest": "18.5719", "open_interest_notional": "1410042.8138",
        })
    }

    fn eth_risk() -> Value {
        json!({
            "product_type": "PerpetualSwapContract", "mark_price": "2407.3303", "index_price": "2406.124",
            "open_interest": "117.044", "open_interest_notional": "281763.5675",
        })
    }

    fn funding_reply(symbol: &str, estimate: f64, next: i64) -> Value {
        json!({
            "symbol": symbol, "fundingDateTime": "2026-09-15T20:00:00.000Z", "fundingTimestampMilliSecs": LAST_SETTLEMENT,
            "nextFundingTimestamp": next, "fundingAmount": 4.09585, "estimatedFundingAmount": estimate,
        })
    }

    fn both(rest: &MockRest) {
        rest.reply(BTC_RISK, btc_risk());
        rest.reply(ETH_RISK, eth_risk());
        rest.reply(BTC_FUNDING, funding_reply("btcusdcperp", 4.47479, NEXT_SETTLEMENT));
        rest.reply(ETH_FUNDING, funding_reply("ethusdcperp", 0.06128, NEXT_SETTLEMENT));
    }

    fn poller(rest: &MockRest, raw_market_ids: &[&str], clock: fn() -> i64) -> Gemini {
        let mut markets = Vec::new();
        for id in raw_market_ids {
            markets.push(market(ID, id, &id[..id.find("usdc").unwrap()].to_uppercase(), "USDC", true));
        }
        Gemini::with_rest(&tracked(&markets), &rest.url, clock)
    }

    fn funding_calls(rest: &MockRest) -> Vec<String> {
        let mut calls = Vec::new();
        for call in rest.calls() {
            if let Some(market) = call.strip_prefix(FUNDING_PATH) {
                calls.push(market.to_string());
            }
        }
        calls
    }

    // Lets a refresh against the local host land, as the Nest spec's setImmediate did.
    async fn settle() {
        tokio::time::sleep(Duration::from_millis(50)).await;
    }

    // Rounds 4 s apart, each followed by its refresh.
    async fn warm_up(venue: &Gemini, rounds: usize) {
        for _ in 0..rounds {
            venue.fetch_round(&http(), clock()).await.unwrap();
            settle().await;
            advance(4_000);
        }
    }

    fn keys(rows: &AnchorMap) -> Vec<&str> {
        let mut keys: Vec<&str> = rows.keys().map(String::as_str).collect();
        keys.sort();
        keys
    }

    #[tokio::test]
    async fn keeps_riskstats_under_90_requests_a_minute_with_a_floor_of_three_seconds() {
        let rest = MockRest::start().await;
        let six = poller(&rest, &["c0usdcperp", "c1usdcperp", "c2usdcperp", "c3usdcperp", "c4usdcperp", "c5usdcperp"], clock);
        let two = poller(&rest, &["btcusdcperp", "ethusdcperp"], clock);

        assert_eq!(six.poll_every(), Duration::from_millis(4_000));
        assert_eq!(two.poll_every(), Duration::from_millis(3_000));
    }

    #[tokio::test]
    async fn leaves_a_market_out_until_its_funding_lands_then_maps_the_amount_over_the_mark() {
        set_now(T0);
        let rest = MockRest::start().await;
        both(&rest);
        let venue = poller(&rest, &["btcusdcperp", "ethusdcperp"], clock);

        let first = venue.fetch_round(&http(), clock()).await.unwrap();
        settle().await;
        assert!(first.is_empty());
        assert_eq!(funding_calls(&rest), ["btcusdcperp"]);

        advance(4_000);
        let second = venue.fetch_round(&http(), clock()).await.unwrap();
        settle().await;

        assert_eq!(keys(&second), ["btcusdcperp"]);
        assert_eq!(
            second["btcusdcperp"],
            AnchorRow {
                index: 75881.41733,
                mark: 75923.455,
                funding_rate: 4.47479 / 75923.455,
                funding_interval_hours: 1.0,
                next_funding_at: NEXT_SETTLEMENT,
                ts: Some(clock()),
            }
        );
        assert_eq!(funding_calls(&rest), ["btcusdcperp", "ethusdcperp"]);
    }

    // On the real clock, since what is checked is that each row takes the arrival of its own reply.
    #[tokio::test]
    async fn stamps_each_row_with_its_own_reply_arrival() {
        let rest = MockRest::start().await;
        both(&rest);
        let next = crate::clock::now_ms() + 3_600_000;
        rest.reply(BTC_FUNDING, funding_reply("btcusdcperp", 4.47479, next));
        rest.reply(ETH_FUNDING, funding_reply("ethusdcperp", 0.06128, next));
        let venue = poller(&rest, &["btcusdcperp", "ethusdcperp"], crate::clock::now_ms);
        for _ in 0..2 {
            venue.fetch_round(&http(), 0).await.unwrap();
            settle().await;
        }

        rest.reply_after(ETH_RISK, eth_risk(), Duration::from_millis(300));
        let rows = venue.fetch_round(&http(), 0).await.unwrap();

        let gap = rows["ethusdcperp"].ts.unwrap() - rows["btcusdcperp"].ts.unwrap();
        assert!((250..1_000).contains(&gap), "eth arrived {gap} ms after btc");
    }

    #[tokio::test]
    async fn leaves_out_a_market_whose_riskstats_failed_and_writes_the_rest() {
        set_now(T0);
        let rest = MockRest::start().await;
        both(&rest);
        let venue = poller(&rest, &["btcusdcperp", "ethusdcperp"], clock);
        warm_up(&venue, 2).await;

        rest.fail(BTC_RISK, 500);
        let rows = venue.fetch_round(&http(), clock()).await.unwrap();

        assert_eq!(keys(&rows), ["ethusdcperp"]);
    }

    #[tokio::test]
    async fn rethrows_the_first_error_when_every_riskstats_request_failed() {
        set_now(T0);
        let rest = MockRest::start().await;
        rest.fail(BTC_RISK, 429);
        rest.fail(ETH_RISK, 429);
        let venue = poller(&rest, &["btcusdcperp", "ethusdcperp"], clock);

        let error = venue.fetch_round(&http(), clock()).await.unwrap_err();
        settle().await;

        let limited = error.downcast_ref::<RateLimited>().expect("a RateLimited error");
        assert_eq!(limited.url, format!("{}{BTC_RISK}", rest.url));
        assert!(funding_calls(&rest).is_empty());
    }

    #[tokio::test]
    async fn keeps_one_funding_request_in_flight_at_most() {
        set_now(T0);
        let rest = MockRest::start().await;
        both(&rest);
        rest.hang(BTC_FUNDING);
        let venue = poller(&rest, &["btcusdcperp", "ethusdcperp"], clock);

        warm_up(&venue, 3).await;

        assert_eq!(funding_calls(&rest), ["btcusdcperp"]);
        assert!(venue.funding_in_flight());
    }

    #[tokio::test]
    async fn refreshes_the_oldest_reading_once_it_is_older_than_a_minute() {
        set_now(T0);
        let rest = MockRest::start().await;
        both(&rest);
        let venue = poller(&rest, &["btcusdcperp", "ethusdcperp"], clock);
        warm_up(&venue, 2).await;

        // Both readings are fresh, so the next rounds read no funding.
        warm_up(&venue, 10).await;
        assert_eq!(funding_calls(&rest), ["btcusdcperp", "ethusdcperp"]);

        set_now(T0 + 61_000);
        venue.fetch_round(&http(), clock()).await.unwrap();
        settle().await;

        assert_eq!(funding_calls(&rest), ["btcusdcperp", "ethusdcperp", "btcusdcperp"]);
    }

    #[tokio::test]
    async fn leaves_out_and_refreshes_a_reading_whose_next_settlement_has_passed() {
        set_now(T0);
        let rest = MockRest::start().await;
        both(&rest);
        rest.reply(ETH_FUNDING, funding_reply("ethusdcperp", 0.06128, T0 + 10_000));
        let venue = poller(&rest, &["btcusdcperp", "ethusdcperp"], clock);
        warm_up(&venue, 2).await;

        set_now(T0 + 12_000);
        let rows = venue.fetch_round(&http(), clock()).await.unwrap();
        settle().await;

        assert_eq!(keys(&rows), ["btcusdcperp"]);
        assert_eq!(funding_calls(&rest), ["btcusdcperp", "ethusdcperp", "ethusdcperp"]);
    }

    #[tokio::test]
    async fn logs_a_failed_funding_request_and_moves_on_to_the_next_market() {
        let (logs, _capture) = capture();
        set_now(T0);
        let rest = MockRest::start().await;
        rest.reply(BTC_RISK, btc_risk());
        rest.reply(ETH_RISK, eth_risk());
        rest.reply(ETH_FUNDING, funding_reply("ethusdcperp", 0.06128, NEXT_SETTLEMENT));
        let venue = poller(&rest, &["btcusdcperp", "ethusdcperp"], clock);

        warm_up(&venue, 3).await;

        assert_eq!(funding_calls(&rest), ["btcusdcperp", "ethusdcperp", "btcusdcperp"]);
        let warnings = logs.events("funding_read_failed");
        assert_eq!(warnings[0].text("market"), "btcusdcperp");
        assert!(warnings[0].text("error").contains("404"), "{:?}", warnings[0]);
    }
}
