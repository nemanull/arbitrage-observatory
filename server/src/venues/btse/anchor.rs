use super::{Btse, ID};
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_bytes, get_json};
use crate::venues::wire;
use anyhow::Context;
use serde::Deserialize;
use serde::de::DeserializeOwned;
use std::collections::HashMap;
use std::time::Duration;

// Index and mark for every contract in one 19 KB reply, republished about once a second, keyed by the socket's spelling.
// The markets API's ticker/indices carries the same two numbers but republishes only every 30 s, so it is never read.
pub const PRICE_PATH: &str = "/futures/api/v2.3/price";

// types=["FuturesPerpetual"], the only call that carries the rate, the interval and the next settlement, keyed BTC-PERP-USDT.
pub const TICKER_PATH: &str = "/public-api/market/v1/ticker/24hr?types=%5B%22FuturesPerpetual%22%5D";

// The ticker is documented to refresh once a minute, and its rate held still through every 60 s run of 2026-09-23.
const FUNDING_REFRESH_MS: i64 = 30_000;

#[derive(Default)]
pub struct Funding {
    rows: HashMap<String, FundingRow>, // by raw id, "BTC-PERP"
    read_at: i64,                      // Unix ms of the round that read the ticker, 0 = never
}

#[derive(Debug, Clone, Copy)]
struct FundingRow {
    rate: f64, // a fraction per interval, the running estimate for the next settlement
    interval_hours: f64,
    next_funding_at: i64, // Unix ms
}

impl AnchorVenue for Btse {
    // The legacy API allows 15 calls a second and the markets API 50 every 2 s, and a round makes one or two.
    // A breach blocks for 1 s, then 5 minutes, then 15 minutes, so a pause well past the first block keeps the next tier away.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let due = ts - self.funding.lock().unwrap().read_at >= FUNDING_REFRESH_MS;
        let price_url = format!("{}{PRICE_PATH}", self.rest);

        // A failed ticker read fails the round and leaves read_at alone, so the next round reads it again.
        let prices: Vec<Price> = if due {
            let ticker_url = format!("{}{TICKER_PATH}", self.rest);
            let (prices, tickers) = tokio::try_join!(
                get_json::<Vec<Price>>(http, &price_url),
                get_data::<Vec<Ticker>>(http, &ticker_url),
            )?;
            let funding = read_funding(tickers, ts);
            tracing::debug!(event = "funding_read", venue = ID, rows = funding.rows.len());
            *self.funding.lock().unwrap() = funding;
            prices
        } else {
            get_json(http, &price_url).await?
        };

        let funding = self.funding.lock().unwrap();
        let mut anchors = AnchorMap::with_capacity(prices.len());
        for price in prices {
            // The dated futures share the reply under ids such as BTC-261225, and they have no funding row anyway.
            let Some(row) = funding.rows.get(&price.symbol) else {
                continue;
            };

            anchors.insert(
                price.symbol,
                AnchorRow {
                    index: price.index_price,
                    mark: price.mark_price,
                    funding_rate: row.rate,
                    funding_interval_hours: row.interval_hours,
                    // A settlement that passed since the ticker was read is no next settlement.
                    next_funding_at: if row.next_funding_at > ts { row.next_funding_at } else { 0 },
                    ts: None,
                },
            );
        }

        Ok(anchors)
    }
}

// The ticker names a perpetual BTC-PERP-USDT, and the raw id drops the quote.
fn read_funding(tickers: Vec<Ticker>, ts: i64) -> Funding {
    let mut rows = HashMap::with_capacity(tickers.len());
    for ticker in tickers {
        let Some(raw_market_id) = ticker.symbol.strip_suffix("-USDT") else {
            continue;
        };
        rows.insert(
            raw_market_id.to_string(),
            FundingRow {
                rate: ticker.funding_rate,
                interval_hours: ticker.funding_interval_minutes / 60.0,
                next_funding_at: if ticker.next_funding_time.is_finite() { ticker.next_funding_time as i64 } else { 0 },
            },
        );
    }

    Funding { rows, read_at: ts }
}

// The markets API wraps every reply in { code, msg, success, time, data }, with success false and code 10010004 on a bad request.
pub async fn get_data<T: DeserializeOwned>(http: &reqwest::Client, url: &str) -> anyhow::Result<T> {
    let body = get_bytes(http, url).await?;
    let envelope: Envelope = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;
    if !envelope.success {
        anyhow::bail!("code {}: {}", envelope.code, envelope.msg);
    }

    let reply: Data<T> = serde_json::from_slice(&body).with_context(|| format!("error decoding response body from {url}"))?;
    Ok(reply.data)
}

#[derive(Deserialize)]
struct Envelope {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    code: i64, // 1 on success
    #[serde(default)]
    msg: String,
}

#[derive(Deserialize)]
struct Data<T> {
    data: T,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Price {
    #[serde(default)]
    symbol: String, // "BTC-PERP", or "BTC-261225" on a dated future
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64, // a JSON number
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ticker {
    #[serde(default)]
    symbol: String, // "BTC-PERP-USDT"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // a fraction per interval as a string, "0.0001" is 0.01 %
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_interval_minutes: f64, // 480 or 240
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_funding_time: f64, // Unix ms
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::feeds::anchor_poller::RateLimited;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    // The ticker's closeTime when the replies below were captured live on 2026-10-09.
    const T0: i64 = 1_791_567_641_000;

    // Rows of the legacy price reply: an 8 h perpetual, a 4 h one, a stock, and a dated future that shares the reply.
    fn prices() -> Value {
        json!([
            { "symbol": "BTC-PERP", "indexPrice": 82674.56375, "lastPrice": 82630.5, "markPrice": 82635.55117083 },
            { "symbol": "ENA-PERP", "indexPrice": 0.21334866, "lastPrice": 0.213, "markPrice": 0.21322462 },
            { "symbol": "NVDA-PERP", "indexPrice": 229.87280563, "lastPrice": 229.87, "markPrice": 229.87 },
            { "symbol": "BTC-261225", "indexPrice": 82674.56375, "lastPrice": 83570.6, "markPrice": 83543.36117083 },
        ])
    }

    fn ticker(symbol: &str, rate: &str, next: i64, minutes: i64) -> Value {
        json!({
            "symbol": symbol, "lastPrice": "82630.5", "highPrice": "83499.1", "lowPrice": "80363.5", "amount": "345624851",
            "volume": "284505220.486995", "openTime": 1791478800, "closeTime": 1791567641, "openInterest": "27925629",
            "fundingRate": rate, "nextFundingTime": next, "fundingIntervalMinutes": minutes,
        })
    }

    fn tickers() -> Value {
        json!({ "code": 1, "msg": "Success", "success": true, "time": 1791567641000_i64, "data": [
            ticker("BTC-PERP-USDT", "0.00009784", 1791590400000, 480),
            ticker("ENA-PERP-USDT", "0.00005", 1791576000000, 240),
            ticker("NVDA-PERP-USDT", "0", 1791590400000, 480),
        ]})
    }

    async fn rest() -> MockRest {
        let rest = MockRest::start().await;
        rest.reply(PRICE_PATH, prices());
        rest.reply(TICKER_PATH, tickers());
        rest
    }

    #[test]
    fn polls_every_second_and_pauses_ten_seconds_on_a_rate_limit() {
        let venue = Btse::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(10));
    }

    #[tokio::test]
    async fn joins_index_and_mark_with_the_tickers_funding_under_the_socket_spelling() {
        let rest = rest().await;

        let rows = Btse::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(
            rows["BTC-PERP"],
            AnchorRow {
                index: 82674.56375,
                mark: 82635.55117083,
                funding_rate: 0.00009784,
                funding_interval_hours: 8.0,
                next_funding_at: 1791590400000,
                ts: None,
            }
        );
        assert_eq!(rows["ENA-PERP"].funding_interval_hours, 4.0);
        assert_eq!(rows["ENA-PERP"].next_funding_at, 1791576000000);
        assert_eq!(rows["NVDA-PERP"].funding_rate, 0.0);
    }

    #[tokio::test]
    async fn leaves_out_the_dated_future_and_a_contract_the_ticker_does_not_carry() {
        let rest = rest().await;
        rest.reply(TICKER_PATH, json!({ "code": 1, "msg": "Success", "success": true, "data": [ticker("BTC-PERP-USDT", "0.0001", 1791590400000, 480)] }));

        let rows = Btse::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTC-PERP"]);
    }

    #[tokio::test]
    async fn rereads_the_ticker_only_every_30_seconds() {
        let rest = rest().await;
        let venue = Btse::with_rest(&rest.url);

        venue.fetch_round(&http(), T0).await.unwrap();
        venue.fetch_round(&http(), T0 + 1_000).await.unwrap();
        venue.fetch_round(&http(), T0 + 29_999).await.unwrap();
        let tickers_read = rest.calls().iter().filter(|call| call.as_str() == TICKER_PATH).count();
        assert_eq!(tickers_read, 1);

        venue.fetch_round(&http(), T0 + 30_000).await.unwrap();
        let tickers_read = rest.calls().iter().filter(|call| call.as_str() == TICKER_PATH).count();
        assert_eq!(tickers_read, 2);
        assert_eq!(rest.calls().iter().filter(|call| call.as_str() == PRICE_PATH).count(), 4);
    }

    #[tokio::test]
    async fn sends_an_unknown_next_funding_once_the_cached_settlement_has_passed() {
        let rest = rest().await;
        let venue = Btse::with_rest(&rest.url);
        venue.fetch_round(&http(), 1_791_575_990_000).await.unwrap();

        let rows = venue.fetch_round(&http(), 1_791_576_000_000).await.unwrap();

        assert_eq!(rows["ENA-PERP"].next_funding_at, 0);
        assert_eq!(rows["BTC-PERP"].next_funding_at, 1791590400000);
    }

    #[tokio::test]
    async fn fails_the_round_on_a_failed_ticker_and_reads_it_again_on_the_next() {
        let rest = rest().await;
        rest.fail(TICKER_PATH, 500);
        let venue = Btse::with_rest(&rest.url);

        assert!(venue.fetch_round(&http(), T0).await.is_err());

        rest.reply(TICKER_PATH, tickers());
        let rows = venue.fetch_round(&http(), T0 + 1_000).await.unwrap();
        assert_eq!(rows.len(), 3);
    }

    #[tokio::test]
    async fn fails_the_round_on_a_ticker_reply_that_is_no_success() {
        let rest = rest().await;
        // The body of the 400 that an unknown type draws, captured live on 2026-10-09, here under HTTP 200.
        rest.reply(TICKER_PATH, json!({ "success": false, "code": 10010004, "msg": "Invalid json format", "time": 1791568527136_i64, "data": [] }));

        let error = Btse::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();

        assert_eq!(error.to_string(), "code 10010004: Invalid json format");
    }

    #[tokio::test]
    async fn reads_a_429_on_either_call_as_a_rate_limit() {
        for path in [PRICE_PATH, TICKER_PATH] {
            let rest = rest().await;
            rest.fail(path, 429);

            let error = Btse::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();

            assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");
        }
    }

    #[tokio::test]
    async fn fails_the_round_on_a_price_reply_that_is_no_list() {
        let rest = rest().await;
        rest.reply(PRICE_PATH, json!({ "status": 400, "errorCode": -2, "message": "Unsupported symbol: NOPEPFC", "extraData": null }));

        let error = Btse::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();

        assert!(format!("{error:#}").contains("error decoding response body"), "{error:#}");
    }
}
