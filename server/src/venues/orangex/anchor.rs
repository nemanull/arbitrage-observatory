use super::{Orangex, Reply};
use crate::clock::now_ms;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;

// Index and mark of every live perpetual, a bulk form the docs do not list, refreshed about once a second.
pub const TICKERS_PATH: &str = "/tickers?currency=PERPETUAL";

// The upcoming rate and its period for every perpetual, plus about 190 delisted ones, which the website reads and the docs do not list.
pub const FUNDING_PATH: &str = "/get_all_capital_rate";

const HOUR_MS: f64 = 3_600_000.0;

impl AnchorVenue for Orangex {
    // No REST limit is published and no refusal was seen, so a pause of a few rounds is enough.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let tickers_url = format!("{}{TICKERS_PATH}", self.rest);
        let funding_url = format!("{}{FUNDING_PATH}", self.rest);
        let (tickers, funding) = tokio::try_join!(
            get_json::<Reply<Vec<Ticker>>>(http, &tickers_url),
            get_json::<Reply<Vec<Funding>>>(http, &funding_url),
        )?;
        let arrived_at = now_ms();
        let tickers = tickers.into_result("tickers")?;
        let funding = funding.into_result("get_all_capital_rate")?;

        let mut periods = HashMap::with_capacity(funding.len());
        for mut row in funding {
            periods.insert(std::mem::take(&mut row.instrument_name), row);
        }

        let mut anchors = AnchorMap::with_capacity(tickers.len());
        for ticker in tickers {
            let Some(funding) = periods.get(&ticker.instrument_name) else {
                continue;
            };
            let next_funding_at = funding.end_time as i64;

            anchors.insert(
                ticker.instrument_name,
                AnchorRow {
                    index: ticker.underlying_price,
                    mark: ticker.mark_price,
                    funding_rate: funding.capital_rate,
                    funding_interval_hours: (funding.end_time - funding.start_time) / HOUR_MS,
                    // A settlement that passed is one the venue has not rolled yet, so it reads as unknown.
                    next_funding_at: if funding.end_time.is_finite() && next_funding_at > ts { next_funding_at } else { 0 },
                    // The reply is a cache 0.6 to 3.2 s old on arrival, and arrival only caps a clock that runs ahead.
                    ts: Some(stamp(ticker.timestamp, arrived_at)),
                },
            );
        }

        Ok(anchors)
    }
}

fn stamp(timestamp: f64, arrived_at: i64) -> i64 {
    if timestamp.is_finite() && timestamp > 0.0 {
        (timestamp as i64).min(arrived_at)
    } else {
        arrived_at
    }
}

#[derive(Deserialize)]
struct Ticker {
    #[serde(default)]
    instrument_name: String, // "BTC-USDT-PERPETUAL"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    underlying_price: f64, // the index, an average over major venues whose basket is unpublished
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64, // the last trade on most rows, with no clamp seen
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    timestamp: f64, // ms, when the venue's cache read the row
}

#[derive(Deserialize)]
struct Funding {
    #[serde(rename = "instrumentName", default)]
    instrument_name: String,
    #[serde(rename = "capitalRate", default = "wire::nan", deserialize_with = "wire::num")]
    capital_rate: f64, // the upcoming rate, a fraction per period, recomputed within it
    #[serde(rename = "startTime", default = "wire::nan", deserialize_with = "wire::num")]
    start_time: f64, // ms, the last settlement
    #[serde(rename = "endTime", default = "wire::nan", deserialize_with = "wire::num")]
    end_time: f64, // ms, the next settlement, 1, 4 or 8 h after start
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    const T0: i64 = 1_791_571_655_665; // 2026-10-09 18:47 UTC, when the rows below were read

    // Rows captured live on 2026-10-09, stats cut.
    fn btc_ticker() -> Value {
        json!({
            "best_ask_amount": "2.437", "best_ask_price": "82505", "best_bid_amount": "4.702", "best_bid_price": "82504.9",
            "instrument_name": "BTC-USDT-PERPETUAL", "last_price": "82501.4", "mark_price": "82504.9", "open_interest": "12542.007",
            "state": "open", "timestamp": "1791571654929", "underlying_price": "82525.5",
        })
    }

    fn lunc_ticker() -> Value {
        json!({
            "best_ask_amount": "59367", "best_ask_price": "0.05111", "best_bid_amount": "102591", "best_bid_price": "0.0511",
            "instrument_name": "1000LUNC-USDT-PERPETUAL", "last_price": "0.05109", "mark_price": "0.05109", "open_interest": "24466464",
            "state": "open", "timestamp": "1791571654738", "underlying_price": "0.05114",
        })
    }

    fn btc_funding() -> Value {
        json!({
            "currentTime": "1791571620000", "startTime": "1791561600000", "endTime": "1791590400000", "isPush": false,
            "capitalRate": "0.000113", "instrumentName": "BTC-USDT-PERPETUAL", "showName": "BTCUSDT",
        })
    }

    fn lunc_funding() -> Value {
        json!({
            "currentTime": "1791571620000", "startTime": "1791561600000", "endTime": "1791576000000", "isPush": false,
            "capitalRate": "0.0001", "instrumentName": "1000LUNC-USDT-PERPETUAL", "showName": "1000LUNCUSDT",
        })
    }

    // A delisted contract the funding call still lists, whose period ended in April.
    fn dead_funding() -> Value {
        json!({
            "currentTime": "1777388280000", "startTime": "1777377600000", "endTime": "1777392000000", "isPush": false,
            "capitalRate": "0.0001", "instrumentName": "1000000BOB-USDT-PERPETUAL", "showName": "1000000BOBUSDT",
        })
    }

    fn envelope(result: Value) -> Value {
        json!({ "jsonrpc": "2.0", "usIn": 1791571655665_i64, "usOut": 1791571655671_i64, "usDiff": 6, "result": result })
    }

    async fn round(tickers: Value, funding: Value) -> anyhow::Result<AnchorMap> {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, tickers);
        rest.reply(FUNDING_PATH, funding);
        Orangex::with_rest(&rest.url).fetch_round(&http(), T0).await
    }

    #[tokio::test]
    async fn joins_index_and_mark_with_the_upcoming_rate_its_period_and_its_settlement() {
        let rows = round(
            envelope(json!([btc_ticker(), lunc_ticker()])),
            envelope(json!([lunc_funding(), dead_funding(), btc_funding()])),
        )
        .await
        .unwrap();

        assert_eq!(rows.len(), 2);
        let btc = rows["BTC-USDT-PERPETUAL"];
        assert_eq!(btc.index, 82525.5);
        assert_eq!(btc.mark, 82504.9);
        assert_eq!(btc.funding_rate, 0.000113);
        assert_eq!(btc.funding_interval_hours, 8.0);
        assert_eq!(btc.next_funding_at, 1791590400000);
        assert_eq!(btc.ts, Some(1791571654929));
        let lunc = rows["1000LUNC-USDT-PERPETUAL"];
        assert_eq!(lunc.funding_interval_hours, 4.0);
        assert_eq!(lunc.next_funding_at, 1791576000000);
    }

    #[tokio::test]
    async fn leaves_out_a_ticker_with_no_funding_row() {
        let rows = round(envelope(json!([btc_ticker(), lunc_ticker()])), envelope(json!([btc_funding()]))).await.unwrap();

        assert_eq!(rows.len(), 1);
        assert!(rows.contains_key("BTC-USDT-PERPETUAL"));
    }

    #[tokio::test]
    async fn reads_a_settlement_that_already_passed_as_unknown() {
        let mut funding = btc_funding();
        funding["endTime"] = json!((T0 - 1).to_string());

        let rows = round(envelope(json!([btc_ticker()])), envelope(json!([funding]))).await.unwrap();

        assert_eq!(rows["BTC-USDT-PERPETUAL"].next_funding_at, 0);
    }

    #[tokio::test]
    async fn stamps_a_row_with_arrival_when_its_timestamp_is_missing_or_ahead() {
        let mut ahead = btc_ticker();
        ahead["timestamp"] = json!("9999999999999");
        let mut missing = lunc_ticker();
        missing.as_object_mut().unwrap().remove("timestamp");

        let before = now_ms();
        let rows = round(envelope(json!([ahead, missing])), envelope(json!([btc_funding(), lunc_funding()]))).await.unwrap();

        for row in rows.values() {
            let ts = row.ts.unwrap();
            assert!(before <= ts && ts <= now_ms());
        }
    }

    #[tokio::test]
    async fn fails_a_round_whose_reply_carries_a_json_rpc_error() {
        let error = json!({ "jsonrpc": "2.0", "error": { "code": 9999, "message": "System error, please try again later", "data": {} } });

        let failed = round(envelope(json!([btc_ticker()])), error).await.unwrap_err();

        assert!(format!("{failed:#}").contains("9999"));
    }

    #[tokio::test]
    async fn fails_a_round_when_either_call_fails() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, envelope(json!([btc_ticker()])));
        rest.fail(FUNDING_PATH, 502);

        assert!(Orangex::with_rest(&rest.url).fetch_round(&http(), T0).await.is_err());
    }
}
