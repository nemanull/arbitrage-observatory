use super::Hibt;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, RateLimited, get_bytes};
use crate::venues::wire;
use anyhow::Context;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::time::Duration;

// One call carries index, funding rate and next settlement for every tradable contract, at about 47 KB and 200 ms.
// The mark lives only on a per contract call, and it equals this index, see docs/profiles/hibt/rest.md section 3.
pub const CONTRACTS_PATH: &str = "/v2/market/contracts";

// Documented as "Too many requests", and it also answers a bad parameter with HTTP 200, which this call has none of.
const RATE_LIMIT_CODE: i64 = 220017;

// No field carries the interval, and the help center documents 8 h at 00, 08 and 16 UTC.
const FUNDING_INTERVAL_HOURS: f64 = 8.0;

impl AnchorVenue for Hibt {
    // No perpetual rate limit is published or was reached, so the pause is a guess.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let rows: Vec<Contract> = get_data(http, &format!("{}{CONTRACTS_PATH}", self.rest)).await?;

        // The index basket is not published, so no row can be told apart as a self index.
        let mut anchors = AnchorMap::with_capacity(rows.len());
        for row in rows {
            if !(row.index_price > 0.0) {
                continue;
            }

            anchors.insert(
                row.ticker_id,
                AnchorRow {
                    index: row.index_price,
                    // HIBT's only mark is its index, so a mark copied from it would read every premium as fresh (decision 19).
                    mark: 0.0,
                    funding_rate: row.funding_rate,
                    funding_interval_hours: FUNDING_INTERVAL_HOURS,
                    next_funding_at: next_settlement(row.next_funding_rate_timestamp),
                    ts: None,
                },
            );
        }

        Ok(anchors)
    }
}

// A null, an empty string or a value that is no positive time reads as unknown, so one odd row cannot fail the round.
fn next_settlement(ms: f64) -> i64 {
    if ms.is_finite() && ms > 0.0 { ms as i64 } else { 0 }
}

// Every public call wraps its reply as {code, msg, data}, and an error can come with HTTP 200.
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
    if status.code != 0 {
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
struct Contract {
    #[serde(default)]
    ticker_id: String, // "btc_usdt", the socket's id
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64, // a decimal string, in exponent form on small coins
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // a fraction per 8 h, "-0.0000129"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_funding_rate_timestamp: f64, // Unix ms as a JSON integer, 1791590400000
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    const T0: i64 = 1_791_570_000_000;

    // Rows trimmed from the contracts reply captured live on 2026-10-09 at 18:24 UTC.
    fn btc_row() -> Value {
        json!({
            "ticker_id": "btc_usdt", "base_currency": "BTC", "quote_currency": "USDT", "last_price": "82544.4",
            "bid": "82544.2", "ask": "82544.4", "product_type": "Perpetual", "open_interest": "56.095",
            "index_price": "82544.332", "funding_rate": "-0.0000129", "next_funding_rate": "-0.0000129",
            "next_funding_rate_timestamp": 1791590400000_i64, "maker_fee": "0.0003", "taker_fee": "0.0005",
            "contract_type": "Vanilla", "contract_price": "82544.4", "contract_price_currency": "USDT",
        })
    }

    // Its bid and ask came in exponent form, "5.405e-06", in the same reply.
    fn shib_row() -> Value {
        json!({
            "ticker_id": "shib_usdt", "base_currency": "SHIB", "quote_currency": "USDT", "last_price": "0.000005406",
            "bid": "5.405e-06", "ask": "5.407e-06", "product_type": "Perpetual", "open_interest": "0",
            "index_price": "0.0000054065", "funding_rate": "0.0000129", "next_funding_rate": "0.0000129",
            "next_funding_rate_timestamp": 1791590400000_i64, "maker_fee": "0.0003", "taker_fee": "0.0005",
            "contract_type": "Vanilla", "contract_price": "0.000005406", "contract_price_currency": "USDT",
        })
    }

    async fn poll(body: Value) -> (MockRest, anyhow::Result<AnchorMap>) {
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, body);
        let rows = Hibt::with_rest(&rest.url).fetch_round(&http(), T0).await;
        (rest, rows)
    }

    #[test]
    fn polls_every_second_and_pauses_ten_seconds_on_a_rate_limit() {
        let venue = Hibt::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(10));
    }

    #[tokio::test]
    async fn maps_every_row_of_the_one_bulk_call_with_no_mark_and_the_documented_interval() {
        let (rest, rows) = poll(json!({ "code": 0, "msg": "success", "data": [btc_row(), shib_row()] })).await;
        let rows = rows.unwrap();

        assert_eq!(rest.calls(), [CONTRACTS_PATH]);
        assert_eq!(
            rows["btc_usdt"],
            AnchorRow {
                index: 82544.332,
                mark: 0.0,
                funding_rate: -0.0000129,
                funding_interval_hours: 8.0,
                next_funding_at: 1791590400000,
                ts: None,
            }
        );
        assert_eq!(rows["shib_usdt"].index, 0.0000054065);
        assert_eq!(rows["shib_usdt"].funding_rate, 0.0000129);
        assert_eq!(rows["shib_usdt"].mark, 0.0);
    }

    #[tokio::test]
    async fn leaves_out_a_row_whose_index_is_empty_or_zero() {
        let mut empty = btc_row();
        empty["ticker_id"] = json!("eth_usdt");
        empty["index_price"] = json!("");
        let mut zero = btc_row();
        zero["ticker_id"] = json!("sol_usdt");
        zero["index_price"] = json!("0");

        let (_rest, rows) = poll(json!({ "code": 0, "msg": "success", "data": [empty, zero, shib_row()] })).await;

        assert_eq!(rows.unwrap().keys().collect::<Vec<_>>(), ["shib_usdt"]);
    }

    #[tokio::test]
    async fn reads_a_missing_null_or_empty_next_funding_as_unknown() {
        let mut missing = btc_row();
        missing.as_object_mut().unwrap().remove("next_funding_rate_timestamp");
        let mut nulled = shib_row();
        nulled["next_funding_rate_timestamp"] = Value::Null;
        let mut empty = btc_row();
        empty["ticker_id"] = json!("eth_usdt");
        empty["next_funding_rate_timestamp"] = json!("");

        let (_rest, rows) = poll(json!({ "code": 0, "msg": "success", "data": [missing, nulled, empty] })).await;
        let rows = rows.unwrap();

        assert_eq!(rows.len(), 3);
        assert!(rows.values().all(|row| row.next_funding_at == 0));
    }

    #[tokio::test]
    async fn sends_a_row_whose_funding_rate_is_missing_as_not_finite_so_the_poller_refuses_it() {
        let mut row = btc_row();
        row.as_object_mut().unwrap().remove("funding_rate");

        let (_rest, rows) = poll(json!({ "code": 0, "msg": "success", "data": [row] })).await;

        assert!(rows.unwrap()["btc_usdt"].funding_rate.is_nan());
    }

    #[tokio::test]
    async fn reads_code_220017_as_a_rate_limit_so_the_poller_pauses() {
        // The body a bad depth limit drew live on 2026-10-09, which comes with HTTP 200.
        let (rest, rows) = poll(json!({ "code": 220017, "msg": "limit error" })).await;

        let error = rows.unwrap_err();
        let limited = error.downcast_ref::<RateLimited>().expect("a RateLimited error");
        assert_eq!(limited.reason, "code 220017");
        assert_eq!(limited.url, format!("{}{CONTRACTS_PATH}", rest.url));
        assert_eq!(limited.retry_after, None);
    }

    #[tokio::test]
    async fn fails_the_round_on_any_other_nonzero_code() {
        // The body an uppercase symbol drew live on 2026-10-09, there with HTTP 400.
        let (_rest, rows) = poll(json!({ "code": 210001, "msg": "param error" })).await;

        let error = rows.unwrap_err();
        assert!(error.downcast_ref::<RateLimited>().is_none());
        assert_eq!(error.to_string(), "code 210001: param error");
    }

    #[tokio::test]
    async fn fails_the_round_on_a_body_that_is_no_envelope() {
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, json!("Just a moment..."));

        let error = Hibt::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();

        assert!(format!("{error:#}").contains("error decoding response body"), "{error:#}");
    }

    #[tokio::test]
    async fn reads_a_429_as_a_rate_limit_and_a_400_as_a_failed_round() {
        let rest = MockRest::start().await;
        rest.fail(CONTRACTS_PATH, 429);
        let error = Hibt::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();
        assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");

        let rest = MockRest::start().await;
        rest.fail(CONTRACTS_PATH, 400);
        let error = Hibt::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();
        assert!(error.downcast_ref::<RateLimited>().is_none(), "{error:#}");
    }
}
