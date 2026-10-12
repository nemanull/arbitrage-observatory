use super::Zoomex;
use crate::clock::now_ms;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use futures_util::future::try_join_all;
use serde::Deserialize;
use std::time::Duration;

// One linear call returns every contract with index, mark, rate, next settlement, interval and cap.
// For the four own markets that reply holds Bybit's numbers, so each of those reads its own row with `&symbol=`.
const TICKERS_PATH: &str = "/cloud/trade/v3/market/tickers?category=linear";

impl AnchorVenue for Zoomex {
    // The bulk reply is about 360 KB with a median of 299 ms, and a round of five calls every 2 s is 2.5 a second against 120 allowed.
    fn poll_every(&self) -> Duration {
        Duration::from_secs(2)
    }

    // A 403 means more than 600 requests in 5 s, and the venue asks for a ten minute silence before the next one.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(10 * 60)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let bulk_url = format!("{}{TICKERS_PATH}", self.rest);
        let own = self.own.iter().map(|symbol| own_ticker(http, &self.rest, symbol));
        let (bulk, own) = tokio::try_join!(tickers(http, &bulk_url), try_join_all(own))?;

        let mut rows = AnchorMap::with_capacity(bulk.len());
        for ticker in bulk {
            if self.own.contains(&ticker.symbol) {
                continue;
            }
            if let Some(row) = row(&ticker, None) {
                rows.insert(ticker.symbol, row);
            }
        }
        for (ticker, arrived_at) in own.into_iter().flatten() {
            if let Some(row) = row(&ticker, Some(arrived_at)) {
                rows.insert(ticker.symbol, row);
            }
        }

        Ok(rows)
    }
}

// A row with empty funding fields is no perpetual, and the linear family listed none on 2026-10-09.
fn row(ticker: &Ticker, ts: Option<i64>) -> Option<AnchorRow> {
    if ticker.funding_rate.is_empty() || ticker.funding_interval_hour.is_empty() {
        return None;
    }

    Some(AnchorRow {
        index: ticker.index_price,
        mark: ticker.mark_price,
        funding_rate: wire::number(&ticker.funding_rate),
        funding_interval_hours: wire::number(&ticker.funding_interval_hour),
        next_funding_at: wire::number(&ticker.next_funding_time) as i64,
        ts,
    })
}

// The one row of an own market, stamped with its own arrival.
async fn own_ticker(http: &reqwest::Client, rest: &str, symbol: &str) -> anyhow::Result<Option<(Ticker, i64)>> {
    let url = format!("{rest}{TICKERS_PATH}&symbol={symbol}");
    let list = tickers(http, &url).await?;
    let arrived_at = now_ms();
    Ok(list.into_iter().find(|ticker| ticker.symbol == symbol).map(|ticker| (ticker, arrived_at)))
}

// A refusal often comes as HTTP 400 with a plain text body, which get_json fails on its status before it parses anything.
async fn tickers(http: &reqwest::Client, url: &str) -> anyhow::Result<Vec<Ticker>> {
    let reply: TickersReply = get_json(http, url).await?;
    if reply.ret_code != 0 {
        anyhow::bail!("retCode {}: {}", reply.ret_code, reply.ret_msg);
    }
    Ok(reply.result.list)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TickersReply {
    ret_code: i64, // 0 on success
    #[serde(default)]
    ret_msg: String,
    #[serde(default)]
    result: TickersResult,
}

#[derive(Deserialize, Default)]
struct TickersResult {
    #[serde(default)]
    list: Vec<Ticker>,
}

// Every number is a decimal string.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ticker {
    #[serde(default)]
    symbol: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
    #[serde(default)]
    funding_rate: String, // a fraction per interval, the upcoming rate
    #[serde(default)]
    next_funding_time: String, // Unix ms
    #[serde(default)]
    funding_interval_hour: String, // "1", "4" or "8"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, market, tracked};
    use crate::venues::zoomex::ID;
    use serde_json::{Value, json};

    const T0: i64 = 1_791_571_652_038;
    const BTC_PATH: &str = "/cloud/trade/v3/market/tickers?category=linear&symbol=BTCUSDT";

    // Rows captured live on 2026-10-09, cut to the fields the poller reads plus a few it ignores.
    // The bulk BTCUSDT row is Bybit's: open interest 55,943 BTC and cap 0.00333.
    fn bulk_btc() -> Value {
        json!({
            "symbol": "BTCUSDT", "lastPrice": "82493.10", "indexPrice": "82530.04", "markPrice": "82499.60",
            "openInterest": "55943.935", "fundingRate": "0.00002714", "nextFundingTime": "1791590400000",
            "fundingIntervalHour": "8", "fundingCap": "0.00333",
        })
    }

    // The single symbol BTCUSDT row is Zoomex's own: open interest 149 BTC and cap 0.0027.
    fn own_btc() -> Value {
        json!({
            "symbol": "BTCUSDT", "lastPrice": "82510.00", "indexPrice": "82550.39", "markPrice": "82514.81",
            "openInterest": "149.132", "fundingRate": "0.00004224", "nextFundingTime": "1791590400000",
            "fundingIntervalHour": "8", "fundingCap": "0.0027",
        })
    }

    fn chr() -> Value {
        json!({
            "symbol": "CHRUSDT", "lastPrice": "0.022968", "indexPrice": "0.022998", "markPrice": "0.022968",
            "openInterest": "31116650.2", "fundingRate": "-0.00047635", "nextFundingTime": "1791590400000",
            "fundingIntervalHour": "8", "fundingCap": "0.02",
        })
    }

    fn reply(list: Value, ret_code: i64) -> Value {
        json!({
            "result": { "category": "linear", "list": list },
            "retCode": ret_code,
            "retExtInfo": {},
            "retMsg": if ret_code == 0 { "OK" } else { "params error" },
            "time": T0,
        })
    }

    fn poller(rest: &MockRest, ids: &[&str]) -> Zoomex {
        let mut markets = Vec::new();
        for id in ids {
            markets.push(market(ID, id, &id[..3], "USDT", true));
        }
        Zoomex::with_rest(&tracked(&markets), &rest.url)
    }

    #[tokio::test]
    async fn polls_every_two_seconds_and_pauses_ten_minutes_on_a_rate_limit() {
        let rest = MockRest::start().await;
        let venue = poller(&rest, &["CHRUSDT"]);

        assert_eq!(venue.poll_every(), Duration::from_secs(2));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(600));
    }

    #[tokio::test]
    async fn maps_a_relayed_market_from_the_bulk_reply_with_the_round_stamp() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, reply(json!([chr()]), 0));

        let rows = poller(&rest, &["CHRUSDT"]).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(
            rows["CHRUSDT"],
            AnchorRow {
                index: 0.022998,
                mark: 0.022968,
                funding_rate: -0.00047635,
                funding_interval_hours: 8.0,
                next_funding_at: 1791590400000,
                ts: None,
            }
        );
        assert_eq!(rest.calls(), [TICKERS_PATH]);
    }

    #[tokio::test]
    async fn reads_an_own_market_from_its_own_ticker_and_never_from_the_bulk_row() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, reply(json!([bulk_btc(), chr()]), 0));
        rest.reply(BTC_PATH, reply(json!([own_btc()]), 0));

        let before = now_ms();
        let rows = poller(&rest, &["BTCUSDT", "CHRUSDT"]).fetch_round(&http(), T0).await.unwrap();
        let after = now_ms();

        let btc = rows["BTCUSDT"];
        assert_eq!(btc.mark, 82514.81);
        assert_eq!(btc.index, 82550.39);
        assert_eq!(btc.funding_rate, 0.00004224);
        let ts = btc.ts.unwrap();
        assert!(before <= ts && ts <= after, "{ts} outside {before}..{after}");
        assert_eq!(rows["CHRUSDT"].ts, None);
        let mut calls = rest.calls();
        calls.sort();
        assert_eq!(calls, [TICKERS_PATH, BTC_PATH]);
    }

    #[tokio::test]
    async fn leaves_an_own_market_out_when_its_own_reply_does_not_carry_it() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, reply(json!([bulk_btc(), chr()]), 0));
        rest.reply(BTC_PATH, reply(json!([]), 0));

        let rows = poller(&rest, &["BTCUSDT", "CHRUSDT"]).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["CHRUSDT"]);
    }

    #[tokio::test]
    async fn asks_no_single_ticker_for_an_own_market_that_is_not_tracked() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, reply(json!([bulk_btc(), chr()]), 0));

        let rows = poller(&rest, &["CHRUSDT"]).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rest.calls(), [TICKERS_PATH]);
        // The untracked row is passed through, and the poller reads only tracked ids.
        assert_eq!(rows["BTCUSDT"].mark, 82499.60);
    }

    #[tokio::test]
    async fn leaves_out_a_row_with_empty_funding_fields() {
        let rest = MockRest::start().await;
        let mut empty = chr();
        empty["symbol"] = json!("CHR2USDT");
        empty["fundingRate"] = json!("");
        empty["fundingIntervalHour"] = json!("");
        rest.reply(TICKERS_PATH, reply(json!([empty, chr()]), 0));

        let rows = poller(&rest, &["CHRUSDT"]).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["CHRUSDT"]);
    }

    #[tokio::test]
    async fn fails_the_round_on_a_venue_error_code() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, reply(json!([]), 10001));

        let error = poller(&rest, &["CHRUSDT"]).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.to_string().contains("retCode 10001"), "{error:#}");
    }

    #[tokio::test]
    async fn fails_the_round_when_an_own_ticker_is_refused_with_a_plain_text_400() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, reply(json!([bulk_btc(), chr()]), 0));
        rest.fail(BTC_PATH, 400);

        let error = poller(&rest, &["BTCUSDT", "CHRUSDT"]).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.to_string().contains("400"), "{error:#}");
    }

    #[tokio::test]
    async fn reports_a_403_on_an_own_ticker_as_a_rate_limit_of_the_whole_round() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, reply(json!([bulk_btc(), chr()]), 0));
        rest.fail(BTC_PATH, 403);

        let error = poller(&rest, &["BTCUSDT", "CHRUSDT"]).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.downcast_ref::<crate::feeds::anchor_poller::RateLimited>().is_some(), "{error:#}");
    }

    #[tokio::test]
    async fn reports_a_403_as_a_rate_limit() {
        let rest = MockRest::start().await;
        rest.fail(TICKERS_PATH, 403);

        let error = poller(&rest, &["CHRUSDT"]).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.downcast_ref::<crate::feeds::anchor_poller::RateLimited>().is_some(), "{error:#}");
    }
}
