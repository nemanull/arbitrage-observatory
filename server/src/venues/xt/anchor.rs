use super::{ID, Xt};
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_bytes, get_json};
use crate::venues::wire;
use anyhow::Context;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::time::Duration;

// Index and mark for every contract, about 11 KB and 8 KB gzipped, each row stamped with its own t.
pub const INDEX_PATH: &str = "/future/market/v1/public/q/index-price";
pub const MARK_PATH: &str = "/future/market/v1/public/q/mark-price";

// The CoinGecko feed, the only bulk source of rate, interval and next settlement, 88 KB gzipped and up to about 1.1 s to answer.
// Its own index copy refreshes only about every 2 s, so it is not read.
pub const FUNDING_PATH: &str = "/future/market/v1/public/cg/contracts";

// babaon_usdt once sat 352 s old on both price calls, and the engine would take it as current.
const MAX_PRICE_AGE_MS: i64 = 5_000;

// The rate moves one to two times a minute, so the large call is read every 10 s and kept between reads.
const FUNDING_EVERY_MS: i64 = 10_000;

// A failed read keeps the last rates until they are this old, and the round fails after that.
const FUNDING_MAX_AGE_MS: i64 = 120_000;

// The help center's settlement every 8 h, for a row whose interval is null.
const DOCUMENTED_INTERVAL_HOURS: f64 = 8.0;

#[derive(Default)]
pub struct FundingCache {
    rows: HashMap<String, Funding>, // raw id to its funding
    read_at: i64,                   // Unix ms of the last read, 0 before the first
}

#[derive(Debug, Clone, Copy)]
struct Funding {
    rate: f64,
    interval_hours: f64,
    next_at: i64,
}

impl AnchorVenue for Xt {
    // The documented penalty for passing 1,000 calls a minute per IP is a ten minute account lock, and no Retry-After is sent.
    // A round is two calls, plus the funding call every tenth round, so about 126 a minute.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(60)
    }

    // Every age here is read against ts, the round's start, so a price published while the calls ran is stamped no later than that start.
    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let read_funding = ts - self.funding.lock().unwrap().read_at >= FUNDING_EVERY_MS;

        let index_url = format!("{}{INDEX_PATH}", self.rest);
        let mark_url = format!("{}{MARK_PATH}", self.rest);
        let funding_url = format!("{}{FUNDING_PATH}", self.rest);
        let funding = async {
            if !read_funding {
                return None;
            }
            Some(get_json::<Vec<Contract>>(http, &funding_url).await)
        };
        let (index, mark, funding) = tokio::join!(
            get_result::<Vec<Price>>(http, &index_url),
            get_result::<Vec<Price>>(http, &mark_url),
            funding
        );
        let (index, mark) = (index?, mark?);

        let mut cache = self.funding.lock().unwrap();
        match funding {
            Some(Ok(contracts)) => {
                cache.rows = read_funding_rows(contracts);
                cache.read_at = ts;
            }
            Some(Err(error)) if ts - cache.read_at > FUNDING_MAX_AGE_MS => return Err(error),
            Some(Err(error)) => {
                tracing::warn!(event = "funding_read_failed", venue = ID, error = format!("{error:#}"));
            }
            None => {}
        }

        let mut marks = HashMap::with_capacity(mark.len());
        for row in &mark {
            marks.insert(row.s.as_str(), row);
        }

        // A pre-market contract has no index row, since its mark is its own fills, so it is left out with no rule of its own.
        // The basket behind every other index is not published, so no row can be told apart as a self index.
        let mut rows = AnchorMap::with_capacity(index.len());
        for row in &index {
            let (Some(mark), Some(funding)) = (marks.get(row.s.as_str()), cache.rows.get(&row.s)) else {
                continue;
            };
            if !(row.p.is_finite() && row.p > 0.0 && mark.p.is_finite() && mark.p > 0.0) {
                continue;
            }

            // Both prices carry the time they were published, about a second before arrival, and the venue's clock runs about 80 ms ahead.
            let priced_at = (row.t.min(mark.t) as i64).min(ts);
            if ts - priced_at > MAX_PRICE_AGE_MS {
                continue;
            }

            rows.insert(
                row.s.clone(),
                AnchorRow {
                    index: row.p,
                    mark: mark.p,
                    funding_rate: funding.rate,
                    funding_interval_hours: funding.interval_hours,
                    next_funding_at: funding.next_at,
                    ts: Some(priced_at),
                },
            );
        }

        Ok(rows)
    }
}

fn read_funding_rows(contracts: Vec<Contract>) -> HashMap<String, Funding> {
    let mut rows = HashMap::with_capacity(contracts.len());

    for row in contracts {
        if !row.funding_rate.is_finite() {
            continue;
        }

        // The minutes field is the finer of the two, and both were present on every perpetual on 2026-10-09.
        let interval_hours = if row.funding_interval_minutes > 0.0 {
            row.funding_interval_minutes / 60.0
        } else if row.collection_internal > 0.0 {
            row.collection_internal
        } else {
            DOCUMENTED_INTERVAL_HOURS
        };
        let next_at = if row.next_funding_rate_timestamp > 0.0 { row.next_funding_rate_timestamp as i64 } else { 0 };

        rows.insert(row.symbol, Funding { rate: row.funding_rate, interval_hours, next_at });
    }

    rows
}

// Every call but the CoinGecko feed wraps its answer in this envelope, and an error comes with HTTP 200 and a returnCode of 1.
pub async fn get_result<T: DeserializeOwned>(http: &reqwest::Client, url: &str) -> anyhow::Result<T> {
    let body = get_bytes(http, url).await?;
    let reply: Envelope<T> = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;

    match (reply.return_code, reply.result) {
        (0, Some(result)) => Ok(result),
        (code, _) => {
            let error = reply.error.unwrap_or_default();
            anyhow::bail!("returnCode {code} from {url}: {} {}", error.code, error.msg)
        }
    }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Envelope<T> {
    #[serde(default = "unknown_code")]
    return_code: i64,
    error: Option<ApiError>,
    result: Option<T>,
}

fn unknown_code() -> i64 {
    -1
}

#[derive(Deserialize, Default)]
struct ApiError {
    #[serde(default)]
    code: String, // "invalid_symbol"
    #[serde(default)]
    msg: String,
}

#[derive(Deserialize)]
struct Price {
    #[serde(default)]
    s: String, // "btc_usdt"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    p: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    t: f64, // Unix ms of publication
}

#[derive(Deserialize)]
struct Contract {
    #[serde(default)]
    symbol: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // the estimate for the next settlement, a fraction per interval
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_interval_minutes: f64, // 60, 240 or 480
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    collection_internal: f64, // hours, null on dated futures
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_funding_rate_timestamp: f64, // Unix ms
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::feeds::anchor_poller::RateLimited;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    // The round's start, a second after the rows below were captured live on 2026-10-09 at 17:41 UTC.
    const T0: i64 = 1_791_567_683_000;

    fn price(s: &str, p: &str, t: i64) -> Value {
        json!({ "s": s, "p": p, "t": t })
    }

    fn envelope(result: Value) -> Value {
        json!({ "returnCode": 0, "msgInfo": "success", "error": null, "result": result })
    }

    // The index call stamps its rows a second before the mark call's on the same contract.
    fn index_reply() -> Value {
        envelope(json!([
            price("btc_usdt", "82708.3364297", 1791567681859),
            price("lsk_usdt", "0.23821970264", 1791567682481),
            price("1000pepe_usdt", "0.00390928115", 1791567681731),
        ]))
    }

    // anthropic_usdt is pre-market, so it has a mark and no index row.
    fn mark_reply() -> Value {
        envelope(json!([
            price("btc_usdt", "82685", 1791567682859),
            price("lsk_usdt", "0.2381", 1791567682481),
            price("1000pepe_usdt", "0.0039066", 1791567682731),
            price("anthropic_usdt", "2028.71", 1791567682570),
        ]))
    }

    fn contract(symbol: &str, rate: Value, next: Value, hours: Value, minutes: Value) -> Value {
        json!({
            "id": 1, "symbol": symbol, "ticker_id": symbol.to_uppercase().replace('_', "-"), "product_type": "PERPETUAL",
            "index_price": "82708.336429700000", "funding_rate": rate, "next_funding_rate": rate,
            "next_funding_rate_timestamp": next, "collection_internal": hours, "funding_interval_minutes": minutes,
        })
    }

    fn funding_reply() -> Value {
        json!([
            contract("btc_usdt", json!("0.00003402"), json!(1791590400000_i64), json!(8), json!(480)),
            contract("lsk_usdt", json!("-0.00017954"), json!(1791576000000_i64), json!(4), json!(240)),
            contract("1000pepe_usdt", json!("0.000528"), json!(1791590400000_i64), json!(8), json!(480)),
            contract("anthropic_usdt", json!("0.0001"), json!(1791590400000_i64), json!(8), json!(480)),
        ])
    }

    // The btc_usdt prices again, published a second before a later round starts.
    fn republish(rest: &MockRest, at: i64) {
        rest.reply(INDEX_PATH, envelope(json!([price("btc_usdt", "82708.3364297", at - 1_000)])));
        rest.reply(MARK_PATH, envelope(json!([price("btc_usdt", "82685", at - 1_000)])));
    }

    async fn rest(index: Value, mark: Value, funding: Value) -> MockRest {
        let rest = MockRest::start().await;
        rest.reply(INDEX_PATH, index);
        rest.reply(MARK_PATH, mark);
        rest.reply(FUNDING_PATH, funding);
        rest
    }

    #[test]
    fn polls_every_second_and_pauses_a_minute_on_a_rate_limit() {
        let venue = Xt::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(60));
    }

    #[tokio::test]
    async fn merges_index_mark_and_funding_stamped_with_the_older_price() {
        let rest = rest(index_reply(), mark_reply(), funding_reply()).await;

        let rows = Xt::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(
            rows["btc_usdt"],
            AnchorRow {
                index: 82708.3364297,
                mark: 82685.0,
                funding_rate: 0.00003402,
                funding_interval_hours: 8.0,
                next_funding_at: 1791590400000,
                ts: Some(1791567681859),
            }
        );
        assert_eq!(rows["lsk_usdt"].funding_interval_hours, 4.0);
        assert_eq!(rows["lsk_usdt"].funding_rate, -0.00017954);
        assert_eq!(rows["1000pepe_usdt"].mark, 0.0039066);
        assert_eq!(rows.len(), 3);
    }

    #[tokio::test]
    async fn leaves_out_a_contract_with_no_index_row() {
        let rest = rest(index_reply(), mark_reply(), funding_reply()).await;

        let rows = Xt::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert!(!rows.contains_key("anthropic_usdt"));
    }

    #[tokio::test]
    async fn leaves_out_a_row_whose_index_or_mark_is_more_than_five_seconds_old() {
        // babaon_usdt read 352 s old on both calls on 2026-09-23, and these rows are set back the same way.
        let index = envelope(json!([price("btc_usdt", "82708.3364297", T0 - 352_000), price("lsk_usdt", "0.23821970264", T0 - 5_000)]));
        let mark = envelope(json!([price("btc_usdt", "82685", 1791567682859), price("lsk_usdt", "0.2381", T0 - 4_000)]));
        let rest = rest(index, mark, funding_reply()).await;

        let rows = Xt::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["lsk_usdt"]);
        assert_eq!(rows["lsk_usdt"].ts, Some(T0 - 5_000));
    }

    #[tokio::test]
    async fn leaves_out_a_row_whose_index_or_mark_is_not_a_positive_number() {
        let index = envelope(json!([price("btc_usdt", "0", T0 - 1_000), price("lsk_usdt", "0.23821970264", T0 - 1_000)]));
        let mark = envelope(json!([price("btc_usdt", "82685", T0 - 1_000), price("lsk_usdt", "", T0 - 1_000)]));
        let rest = rest(index, mark, funding_reply()).await;

        let rows = Xt::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn caps_a_price_stamped_after_the_round_started_at_that_start() {
        let index = envelope(json!([price("btc_usdt", "82708.3364297", T0 + 80)]));
        let mark = envelope(json!([price("btc_usdt", "82685", T0 + 80)]));
        let rest = rest(index, mark, funding_reply()).await;

        let rows = Xt::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows["btc_usdt"].ts, Some(T0));
    }

    #[tokio::test]
    async fn reads_the_funding_call_every_ten_seconds_and_keeps_its_rates_between() {
        let rest = rest(index_reply(), mark_reply(), funding_reply()).await;
        let venue = Xt::with_rest(&rest.url);

        venue.fetch_round(&http(), T0).await.unwrap();
        republish(&rest, T0 + 9_999);
        let rows = venue.fetch_round(&http(), T0 + 9_999).await.unwrap();
        assert_eq!(rows["btc_usdt"].funding_rate, 0.00003402);
        let funding_reads = |calls: Vec<String>| calls.iter().filter(|path| *path == FUNDING_PATH).count();
        assert_eq!(funding_reads(rest.calls()), 1);

        venue.fetch_round(&http(), T0 + 10_000).await.unwrap();
        assert_eq!(funding_reads(rest.calls()), 2);
        assert_eq!(rest.calls().len(), 8);
    }

    #[tokio::test]
    async fn keeps_the_last_rates_through_a_failed_funding_read_for_two_minutes() {
        let (logs, _capture) = capture();
        let rest = rest(index_reply(), mark_reply(), funding_reply()).await;
        let venue = Xt::with_rest(&rest.url);
        venue.fetch_round(&http(), T0).await.unwrap();
        rest.fail(FUNDING_PATH, 502);
        republish(&rest, T0 + 120_000);

        let rows = venue.fetch_round(&http(), T0 + 120_000).await.unwrap();
        assert_eq!(rows["btc_usdt"].funding_rate, 0.00003402);
        assert_eq!(logs.events("funding_read_failed").len(), 1);

        let error = venue.fetch_round(&http(), T0 + 120_001).await.unwrap_err();
        assert!(error.to_string().contains("502"), "{error:#}");
    }

    #[tokio::test]
    async fn fails_the_first_round_when_the_funding_call_fails() {
        let rest = rest(index_reply(), mark_reply(), funding_reply()).await;
        rest.fail(FUNDING_PATH, 502);

        assert!(Xt::with_rest(&rest.url).fetch_round(&http(), T0).await.is_err());
    }

    #[test]
    fn takes_the_interval_in_minutes_then_hours_then_the_documented_eight_hours() {
        let contracts: Vec<Contract> = serde_json::from_value(json!([
            contract("lsk_usdt", json!("-0.00017954"), json!(1791576000000_i64), json!(4), json!(240)),
            contract("a_usdt", json!("0.0001"), json!(1791576000000_i64), json!(1), Value::Null),
            contract("b_usdt", json!("0.0001"), Value::Null, Value::Null, Value::Null),
            // A dated future, whose funding fields are all null.
            contract("btc_usdt_261225", Value::Null, Value::Null, Value::Null, Value::Null),
        ]))
        .unwrap();

        let rows = read_funding_rows(contracts);

        assert_eq!(rows["lsk_usdt"].interval_hours, 4.0);
        assert_eq!(rows["a_usdt"].interval_hours, 1.0);
        assert_eq!(rows["b_usdt"].interval_hours, 8.0);
        assert_eq!(rows["b_usdt"].next_at, 0);
        assert!(!rows.contains_key("btc_usdt_261225"));
    }

    #[tokio::test]
    async fn fails_the_round_on_a_return_code_of_one() {
        // The error shape captured live on 2026-10-09, which comes with HTTP 200.
        let error = json!({ "returnCode": 1, "msgInfo": "failure", "error": { "code": "invalid_symbol", "msg": "invalid symbol", "args": [] }, "result": null });
        let rest = rest(error, mark_reply(), funding_reply()).await;

        let error = Xt::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.to_string().starts_with("returnCode 1 from"), "{error:#}");
        assert!(error.to_string().ends_with("invalid_symbol invalid symbol"), "{error:#}");
    }

    #[tokio::test]
    async fn reads_a_429_as_a_rate_limit() {
        let rest = rest(index_reply(), mark_reply(), funding_reply()).await;
        rest.fail(MARK_PATH, 429);

        let error = Xt::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");
    }

    #[tokio::test]
    async fn fails_the_round_on_a_body_that_is_no_envelope() {
        // The unknown path answer captured live on 2026-10-09.
        let rest = rest(json!({ "timestamp": "2026-10-09T17:50:10.851+00:00", "status": 404, "error": "Not Found", "path": "/v1/public/q/nope" }), mark_reply(), funding_reply()).await;

        let error = Xt::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();

        assert!(format!("{error:#}").contains("error decoding response body"), "{error:#}");
    }
}
