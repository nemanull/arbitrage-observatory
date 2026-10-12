use super::{Bitradex, ID};
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_bytes};
use crate::venues::wire;
use anyhow::Context;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::collections::{HashMap, HashSet};

// Index and mark for every contract, about 3.4 KB each, every row stamped with the second it was republished.
// The agg-tickers call carries both in one reply, but its t is the last trade's, up to 40 s old on 2026-10-09.
pub const INDEX_PATH: &str = "/v1/future-u/market/public/q/index-price";
pub const MARK_PATH: &str = "/v1/future-u/market/public/q/mark-price";

// Funding has no bulk call with the interval, since the CoinGecko feed at cg/contracts carries rate and next settlement only.
// One market per round keeps the poller at three requests a second, so each of 56 rates is read about once a minute.
// The rate moved by about 0.7 % of itself in 3 minutes on cookie_usdt, against a settlement every 4 or 8 h.
pub const FUNDING_PATH: &str = "/v1/future-u/market/public/q/funding-rate?symbol=";

#[derive(Default)]
pub struct Funding {
    readings: HashMap<String, Reading>, // raw id to its last reading
    warned: HashSet<String>,
    next: usize, // position in the tracked list of the next funding read
}

#[derive(Debug, Clone, Copy)]
struct Reading {
    rate: f64,
    interval_hours: f64,
    next_at: i64,
}

impl AnchorVenue for Bitradex {
    // Every age here is read against ts, the round's start, so a price republished while the calls ran is stamped no later than that start.
    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let index_url = format!("{}{INDEX_PATH}", self.rest);
        let mark_url = format!("{}{MARK_PATH}", self.rest);
        let (index, mark, ()) = tokio::join!(
            get_data::<Vec<Price>>(http, &index_url),
            get_data::<Vec<Price>>(http, &mark_url),
            self.read_funding(http)
        );
        let (index, mark) = (index?, mark?);

        let mut marks = HashMap::with_capacity(mark.len());
        for row in &mark {
            marks.insert(row.s.as_str(), row);
        }

        // The basket behind the index is not published, so no row can be told apart as a self index.
        let funding = self.funding.lock().unwrap();
        let mut rows = AnchorMap::with_capacity(index.len());
        for row in &index {
            let (Some(mark), Some(reading)) = (marks.get(row.s.as_str()), funding.readings.get(&row.s)) else {
                continue;
            };
            if !(row.p.is_finite() && row.p > 0.0 && mark.p.is_finite() && mark.p > 0.0 && row.t > 0.0 && mark.t > 0.0) {
                continue;
            }

            // A switched off contract keeps a row stamped months back, and the engine refuses any row past its age limit.
            let priced_at = (row.t.min(mark.t) as i64).min(ts);
            rows.insert(
                row.s.clone(),
                AnchorRow {
                    index: row.p,
                    mark: mark.p,
                    funding_rate: reading.rate,
                    funding_interval_hours: reading.interval_hours,
                    next_funding_at: reading.next_at,
                    ts: Some(priced_at),
                },
            );
        }

        Ok(rows)
    }
}

impl Bitradex {
    // A market keeps its last reading until its turn comes again, and one that never answers stays out of the rows.
    async fn read_funding(&self, http: &reqwest::Client) {
        if self.markets.is_empty() {
            return;
        }

        let raw_market_id = {
            let mut funding = self.funding.lock().unwrap();
            let raw_market_id = self.markets[funding.next % self.markets.len()].clone();
            funding.next = (funding.next + 1) % self.markets.len();
            raw_market_id
        };

        let url = format!("{}{FUNDING_PATH}{raw_market_id}", self.rest);
        let reading = get_data::<FundingRate>(http, &url).await.and_then(|reply| reply.reading());
        match reading {
            Ok(reading) => {
                let mut funding = self.funding.lock().unwrap();
                funding.warned.remove(&raw_market_id);
                funding.readings.insert(raw_market_id, reading);
            }
            Err(error) => {
                let mut funding = self.funding.lock().unwrap();
                if funding.warned.insert(raw_market_id.clone()) {
                    tracing::warn!(event = "funding_read_failed", venue = ID, market = %raw_market_id, error = format!("{error:#}"));
                }
            }
        }
    }
}

// Every call wraps its answer in this envelope, and an error comes with HTTP 200 and a code of 1.
pub async fn get_data<T: DeserializeOwned>(http: &reqwest::Client, url: &str) -> anyhow::Result<T> {
    let body = get_bytes(http, url).await?;
    let reply: Envelope<T> = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;

    match (reply.code, reply.data) {
        (0, Some(data)) => Ok(data),
        (code, _) => {
            let error = reply.msg_info.unwrap_or_default();
            anyhow::bail!("code {code} from {url}: {} {}", error.code, error.template)
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope<T> {
    #[serde(default = "unknown_code")]
    code: i64,
    msg_info: Option<MsgInfo>,
    data: Option<T>,
}

fn unknown_code() -> i64 {
    -1
}

#[derive(Deserialize, Default)]
struct MsgInfo {
    #[serde(default)]
    code: String, // "invalid_symbol" or "E000"
    #[serde(default)]
    template: String, // "invalid symbol"
}

#[derive(Deserialize)]
struct Price {
    #[serde(default)]
    s: String, // "btc_usdt"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    p: f64, // a decimal string
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    t: f64, // Unix ms of the republish, about a second before arrival
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FundingRate {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // the running estimate for the next settlement, a fraction per interval, as a JSON number
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_collection_time: f64, // Unix ms
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    collection_internal: f64, // hours, 8, or 4 on trump_usdt
}

impl FundingRate {
    fn reading(&self) -> anyhow::Result<Reading> {
        if !(self.funding_rate.is_finite() && self.collection_internal > 0.0) {
            anyhow::bail!("no funding rate or interval");
        }
        let next_at = if self.next_collection_time > 0.0 { self.next_collection_time as i64 } else { 0 };
        Ok(Reading { rate: self.funding_rate, interval_hours: self.collection_internal, next_at })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::feeds::anchor_poller::RateLimited;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, market, tracked};
    use serde_json::{Value, json};
    use std::time::Duration;

    // The round's start, a second after the rows below were captured live on 2026-10-09 at 19:04 UTC.
    const T0: i64 = 1_791_572_685_924;

    fn price(s: &str, p: &str, t: i64) -> Value {
        json!({ "s": s, "p": p, "t": t })
    }

    fn envelope(data: Value) -> Value {
        json!({ "code": 0, "msg": "success", "msgInfo": null, "data": data, "ts": T0 })
    }

    // arc_usdt is switched off and still listed, with its last republish months back.
    // Index and mark shared a stamp on every row of the capture, so btc_usdt's mark stamp is moved 1 ms later to pin the older one.
    fn index_reply() -> Value {
        envelope(json!([
            price("arc_usdt", "0.06399", 1778704067252),
            price("btc_usdt", "82498", 1791572684920),
            price("trump_usdt", "1.849", 1791572684923),
            price("eth_usdt", "2485.48", 1791572684920),
        ]))
    }

    fn mark_reply() -> Value {
        envelope(json!([
            price("arc_usdt", "0.063957", 1778704067252),
            price("btc_usdt", "82476.3", 1791572684921),
            price("trump_usdt", "1.848", 1791572684923),
            price("eth_usdt", "2484.78", 1791572684920),
        ]))
    }

    fn funding_reply(symbol: &str, rate: f64, next: i64, hours: i64) -> Value {
        json!({ "code": 0, "msg": "success", "msgInfo": null, "ts": T0,
            "data": { "symbol": symbol, "fundingRate": rate, "nextCollectionTime": next, "collectionInternal": hours } })
    }

    fn funding_path(symbol: &str) -> String {
        format!("{FUNDING_PATH}{symbol}")
    }

    // The invalid_symbol answer captured live on 2026-10-09, which comes with HTTP 200.
    fn invalid_symbol() -> Value {
        json!({ "code": 1, "msg": "failure", "msgInfo": { "code": "invalid_symbol", "template": "invalid symbol", "args": [] }, "data": null, "ts": T0 })
    }

    async fn rest() -> MockRest {
        let rest = MockRest::start().await;
        rest.reply(INDEX_PATH, index_reply());
        rest.reply(MARK_PATH, mark_reply());
        rest.reply(&funding_path("btc_usdt"), funding_reply("btc_usdt", 0.0001, 1791590400000, 8));
        rest.reply(&funding_path("trump_usdt"), funding_reply("trump_usdt", 0.00005, 1791576000000, 4));
        rest.reply(&funding_path("arc_usdt"), funding_reply("arc_usdt", 0.0001, 1791590400000, 8));
        rest
    }

    fn venue(rest: &MockRest, raw_ids: &[&str]) -> Bitradex {
        let mut markets = Vec::new();
        for id in raw_ids {
            markets.push(market(ID, id, id, "USDT", true));
        }
        Bitradex::with_rest(&tracked(&markets), &rest.url)
    }

    #[test]
    fn polls_every_second() {
        assert_eq!(Bitradex::new(&[]).poll_every(), Duration::from_secs(1));
    }

    #[tokio::test]
    async fn merges_index_mark_and_funding_stamped_with_the_older_price() {
        let rest = rest().await;
        let venue = venue(&rest, &["btc_usdt", "trump_usdt"]);

        venue.fetch_round(&http(), T0).await.unwrap();
        let rows = venue.fetch_round(&http(), T0 + 1_000).await.unwrap();

        assert_eq!(
            rows["btc_usdt"],
            AnchorRow {
                index: 82498.0,
                mark: 82476.3,
                funding_rate: 0.0001,
                funding_interval_hours: 8.0,
                next_funding_at: 1791590400000,
                ts: Some(1791572684920),
            }
        );
        assert_eq!(rows["trump_usdt"].funding_interval_hours, 4.0);
        assert_eq!(rows["trump_usdt"].funding_rate, 0.00005);
        assert_eq!(rows["trump_usdt"].next_funding_at, 1791576000000);
        assert_eq!(rows.len(), 2);
    }

    #[tokio::test]
    async fn reads_one_funding_rate_a_round_in_turn_and_leaves_out_a_market_before_its_turn() {
        let rest = rest().await;
        let venue = venue(&rest, &["btc_usdt", "trump_usdt"]);

        let rows = venue.fetch_round(&http(), T0).await.unwrap();
        assert_eq!(rows.keys().collect::<Vec<_>>(), ["btc_usdt"]);

        venue.fetch_round(&http(), T0 + 1_000).await.unwrap();
        venue.fetch_round(&http(), T0 + 2_000).await.unwrap();
        let funding_reads: Vec<String> = rest.calls().into_iter().filter(|path| path.starts_with(FUNDING_PATH)).collect();
        assert_eq!(funding_reads, [funding_path("btc_usdt"), funding_path("trump_usdt"), funding_path("btc_usdt")]);
    }

    #[tokio::test]
    async fn keeps_a_reading_through_a_failed_turn_and_warns_once_per_market() {
        let (logs, _capture) = capture();
        let rest = rest().await;
        let venue = venue(&rest, &["btc_usdt"]);
        venue.fetch_round(&http(), T0).await.unwrap();
        rest.fail(&funding_path("btc_usdt"), 502);

        venue.fetch_round(&http(), T0 + 1_000).await.unwrap();
        let rows = venue.fetch_round(&http(), T0 + 2_000).await.unwrap();

        assert_eq!(rows["btc_usdt"].funding_rate, 0.0001);
        assert_eq!(logs.events("funding_read_failed").len(), 1);
    }

    #[tokio::test]
    async fn leaves_out_a_market_whose_funding_call_answers_a_venue_error() {
        let (logs, _capture) = capture();
        let rest = rest().await;
        rest.reply(&funding_path("btc_usdt"), invalid_symbol());
        let venue = venue(&rest, &["btc_usdt"]);

        let rows = venue.fetch_round(&http(), T0).await.unwrap();

        assert!(rows.is_empty());
        let failed = logs.events("funding_read_failed");
        assert!(failed[0].text("error").contains("invalid_symbol"), "{:?}", failed[0].text("error"));
    }

    #[test]
    fn refuses_a_funding_reply_with_no_rate_or_no_interval_and_reads_a_missing_next_settlement_as_unknown() {
        let read = |data: Value| serde_json::from_value::<FundingRate>(data).unwrap().reading();

        assert!(read(json!({ "symbol": "a_usdt", "fundingRate": null, "nextCollectionTime": 1791590400000_i64, "collectionInternal": 8 })).is_err());
        assert!(read(json!({ "symbol": "a_usdt", "fundingRate": 0.0001, "nextCollectionTime": 1791590400000_i64, "collectionInternal": null })).is_err());
        let reading = read(json!({ "symbol": "a_usdt", "fundingRate": "-0.002711", "nextCollectionTime": null, "collectionInternal": 8 })).unwrap();
        assert_eq!((reading.rate, reading.interval_hours, reading.next_at), (-0.002711, 8.0, 0));
    }

    #[tokio::test]
    async fn keeps_the_old_stamp_of_a_switched_off_contract_so_the_engine_ages_it_out() {
        let rest = rest().await;
        let venue = venue(&rest, &["arc_usdt"]);

        let rows = venue.fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows["arc_usdt"].ts, Some(1778704067252));
    }

    #[tokio::test]
    async fn caps_a_price_stamped_after_the_round_started_at_that_start() {
        let rest = rest().await;
        rest.reply(INDEX_PATH, envelope(json!([price("btc_usdt", "82503.4", T0 + 80)])));
        rest.reply(MARK_PATH, envelope(json!([price("btc_usdt", "82492.1", T0 + 80)])));
        let venue = venue(&rest, &["btc_usdt"]);

        let rows = venue.fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows["btc_usdt"].ts, Some(T0));
    }

    #[tokio::test]
    async fn leaves_out_a_row_whose_index_or_mark_is_missing_or_not_a_positive_number() {
        let rest = rest().await;
        rest.reply(INDEX_PATH, envelope(json!([price("btc_usdt", "0", T0 - 1_000), price("trump_usdt", "2.885", T0 - 1_000)])));
        rest.reply(MARK_PATH, envelope(json!([price("btc_usdt", "82492.1", T0 - 1_000)])));
        let venue = venue(&rest, &["btc_usdt", "trump_usdt"]);

        venue.fetch_round(&http(), T0).await.unwrap();
        let rows = venue.fetch_round(&http(), T0 + 1_000).await.unwrap();

        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn leaves_out_a_row_whose_index_or_mark_has_no_stamp() {
        let rest = rest().await;
        rest.reply(INDEX_PATH, envelope(json!([{ "s": "btc_usdt", "p": "82503.4" }, price("trump_usdt", "2.885", T0 - 1_000)])));
        rest.reply(MARK_PATH, envelope(json!([price("btc_usdt", "82492.1", T0 - 1_000), { "s": "trump_usdt", "p": "2.884", "t": null }])));
        let venue = venue(&rest, &["btc_usdt", "trump_usdt"]);

        venue.fetch_round(&http(), T0).await.unwrap();
        let rows = venue.fetch_round(&http(), T0 + 1_000).await.unwrap();

        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn fails_the_round_on_a_code_of_one() {
        let rest = rest().await;
        rest.reply(INDEX_PATH, json!({ "code": 1, "msg": "failure", "msgInfo": { "code": "E000", "template": "Internal Service Error", "args": null }, "data": null, "ts": T0 }));

        let error = venue(&rest, &["btc_usdt"]).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.to_string().starts_with("code 1 from"), "{error:#}");
        assert!(error.to_string().ends_with("E000 Internal Service Error"), "{error:#}");
    }

    #[tokio::test]
    async fn reads_a_429_as_a_rate_limit() {
        let rest = rest().await;
        rest.fail(MARK_PATH, 429);

        let error = venue(&rest, &["btc_usdt"]).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");
    }

    #[tokio::test]
    async fn fails_the_round_on_a_body_that_is_no_envelope() {
        // Any body without the envelope, such as an edge page served with HTTP 200.
        let rest = rest().await;
        rest.reply(INDEX_PATH, json!("xxx"));

        let error = venue(&rest, &["btc_usdt"]).fetch_round(&http(), T0).await.unwrap_err();

        assert!(format!("{error:#}").contains("error decoding response body"), "{error:#}");
    }
}
