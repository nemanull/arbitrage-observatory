use super::markets::{INSTRUMENTS_PATH, Instrument};
use super::{Deribit, ID, Reply};
use crate::clock::now_ms;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use futures_util::future::try_join_all;
use serde::Deserialize;
use std::collections::HashSet;
use std::time::Duration;

// One call per settlement currency carries index, mark and rate for every perpetual and dated future settled in it.
pub const SUMMARY_PATH: &str = "/public/get_book_summary_by_currency?kind=future&currency=";
const PERPETUAL_SUFFIX: &str = "-PERPETUAL";

// A pre IPO perpetual's index is the median of an hour's EMA of its own mark and an outside price, and falls back to the EMA alone.
// An equity, ETF or commodity perpetual's index turns into an EMA of its own mark while its market is closed, and no field says when.
// So only the crypto types are anchored, as decision 4 leaves out a contract whose index is the venue's own perpetual.
// The summary does not say which type a contract is, and listings change, so the catalog is reread every hour.
const ANCHORED_TYPES: &[&str] = &["crypto", "crypto_index"];
const CATALOG_REFRESH_MS: i64 = 60 * 60 * 1000;
const CATALOG_RETRY_MS: i64 = 60 * 1000;

// Funding accrues every millisecond and settles daily at 08:00 UTC, so no funding instant exists.
// current_funding is expressed per 8 h, so that is its interval, and the next settlement is unknown.
const FUNDING_INTERVAL_HOURS: f64 = 8.0;

#[derive(Default)]
pub struct AnchorState {
    anchored: HashSet<String>,
    catalog_read_at: i64, // Unix ms, 0 = never, so the first round reads the catalog
}

impl AnchorVenue for Deribit {
    // The summary is republished about every 2 s, so a faster poll reads each snapshot twice.
    fn poll_every(&self) -> Duration {
        Duration::from_secs(2)
    }

    // The public per IP limit is unpublished and a breach may end the session, so the pause is generous.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        self.refresh_catalog(http, ts).await?;

        let mut urls = Vec::with_capacity(self.currencies.len());
        for currency in &self.currencies {
            urls.push(format!("{}{SUMMARY_PATH}{currency}", self.rest));
        }
        let replies = try_join_all(urls.iter().map(|url| get_json::<Reply<Vec<Summary>>>(http, url))).await?;
        let arrived_at = now_ms();

        let state = self.anchors.lock().unwrap();
        let mut rows = AnchorMap::new();
        for reply in replies {
            for summary in reply.into_result("get_book_summary_by_currency")? {
                if !summary.instrument_name.ends_with(PERPETUAL_SUFFIX) || !state.anchored.contains(&summary.instrument_name) {
                    continue;
                }

                rows.insert(
                    summary.instrument_name,
                    AnchorRow {
                        index: summary.estimated_delivery_price,
                        mark: summary.mark_price,
                        funding_rate: summary.current_funding, // the rate now, while funding_8h is the trailing realised rate
                        funding_interval_hours: FUNDING_INTERVAL_HOURS,
                        next_funding_at: 0,
                        // The reply is a snapshot a median 1.4 s old on arrival, and arrival only caps a clock that runs ahead.
                        ts: Some(stamp(summary.creation_timestamp, arrived_at)),
                    },
                );
            }
        }

        Ok(rows)
    }
}

impl Deribit {
    async fn refresh_catalog(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<()> {
        let read_at = self.anchors.lock().unwrap().catalog_read_at;
        if ts - read_at < CATALOG_REFRESH_MS {
            return Ok(());
        }

        let read = async {
            let reply: Reply<Vec<Instrument>> = get_json(http, &format!("{}{INSTRUMENTS_PATH}", self.rest)).await?;
            reply.into_result("get_instruments")
        };

        match read.await {
            Ok(instruments) => {
                let mut anchored = HashSet::new();
                for instrument in instruments {
                    if ANCHORED_TYPES.contains(&instrument.underlying_type.as_str()) {
                        anchored.insert(instrument.instrument_name);
                    }
                }
                tracing::info!(event = "anchored_catalog_read", venue = ID, anchored = anchored.len());
                let mut state = self.anchors.lock().unwrap();
                state.anchored = anchored;
                state.catalog_read_at = ts;
                Ok(())
            }
            // Without a first read the anchored rows cannot be told apart, so the round fails and the next one tries again.
            Err(error) if read_at == 0 => Err(error),
            // A failed refresh keeps the set it has and tries again a minute later.
            Err(error) => {
                tracing::warn!(event = "anchored_catalog_failed", venue = ID, error = format!("{error:#}"));
                self.anchors.lock().unwrap().catalog_read_at = ts - CATALOG_REFRESH_MS + CATALOG_RETRY_MS;
                Ok(())
            }
        }
    }
}

fn stamp(creation_timestamp: f64, arrived_at: i64) -> i64 {
    if creation_timestamp.is_finite() && creation_timestamp > 0.0 {
        (creation_timestamp as i64).min(arrived_at)
    } else {
        arrived_at
    }
}

#[derive(Deserialize)]
struct Summary {
    #[serde(default)]
    instrument_name: String, // "BTC_USDC-PERPETUAL", or "BTC_USDC-16OCT26" on a dated future
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    estimated_delivery_price: f64, // the index, equal to the ticker's index_price
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    current_funding: f64, // a fraction per 8 h, absent on a dated future
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    creation_timestamp: f64, // Unix ms of the snapshot
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{self, MockRest, http};
    use serde_json::{Value, json};

    const T0: i64 = 1_791_523_611_100;
    const USDC_SUMMARY: &str = "/public/get_book_summary_by_currency?kind=future&currency=USDC";

    // Rows of get_book_summary_by_currency?currency=USDC&kind=future captured live on 2026-10-08, cut down to the fields the poller reads plus a few it ignores.
    fn btc_perpetual() -> Value {
        json!({
            "instrument_name": "BTC_USDC-PERPETUAL", "base_currency": "BTC", "quote_currency": "USDC", "mark_price": 82445.73,
            "estimated_delivery_price": 82419.95, "current_funding": 6.279e-05, "funding_8h": 7.644e-05,
            "creation_timestamp": 1791523610012_i64, "bid_price": 82443.1, "ask_price": 82443.2, "open_interest": 1494.4815,
        })
    }

    fn pepe_perpetual() -> Value {
        json!({
            "instrument_name": "1000PEPE_USDC-PERPETUAL", "mark_price": 0.003938, "estimated_delivery_price": 0.003939,
            "current_funding": -3.87e-06, "funding_8h": -0.00013875, "creation_timestamp": 1791523610013_i64,
        })
    }

    fn nvda_perpetual() -> Value {
        json!({
            "instrument_name": "NVDA_USDC-PERPETUAL", "mark_price": 232.95, "estimated_delivery_price": 232.92,
            "current_funding": 0.0, "funding_8h": 0.00015569, "creation_timestamp": 1791523610012_i64,
        })
    }

    fn openai_perpetual() -> Value {
        json!({
            "instrument_name": "OPENAI_USDC-PERPETUAL", "mark_price": 1668.3, "estimated_delivery_price": 1664.35,
            "current_funding": 9e-05, "funding_8h": 1.628e-05, "creation_timestamp": 1791523610011_i64,
        })
    }

    // Read on 2026-10-08 beside the rows above, a few seconds later.
    fn coin50_perpetual() -> Value {
        json!({
            "instrument_name": "COIN50_USDC-PERPETUAL", "mark_price": 322.44, "estimated_delivery_price": 322.49,
            "current_funding": 0.0, "funding_8h": 2.129e-05, "creation_timestamp": 1791525077107_i64,
        })
    }

    fn btc_dated() -> Value {
        json!({
            "instrument_name": "BTC_USDC-16OCT26", "mark_price": 82548.54, "estimated_delivery_price": 82419.95,
            "creation_timestamp": 1791523610011_i64,
        })
    }

    fn summary(rows: Vec<Value>) -> Value {
        json!({ "jsonrpc": "2.0", "result": rows, "usIn": 1791523611006833_i64, "usOut": 1791523611006942_i64, "usDiff": 109, "testnet": false })
    }

    // The catalog's types for the rows above, as get_instruments read them on 2026-10-08.
    fn catalog() -> Value {
        let mut rows = Vec::new();
        for (name, kind) in [
            ("BTC_USDC-PERPETUAL", "crypto"),
            ("1000PEPE_USDC-PERPETUAL", "crypto"),
            ("COIN50_USDC-PERPETUAL", "crypto_index"),
            ("NVDA_USDC-PERPETUAL", "equity"),
            ("SPY_USDC-PERPETUAL", "equity_etf"),
            ("GOLD_USDC-PERPETUAL", "commodity"),
            ("OPENAI_USDC-PERPETUAL", "preipo"),
            ("BTC_USDC-16OCT26", "crypto"),
        ] {
            rows.push(json!({ "instrument_name": name, "underlying_type": kind, "settlement_period": "perpetual", "is_active": true, "state": "open" }));
        }
        json!({ "jsonrpc": "2.0", "result": rows })
    }

    fn venue(rest: &MockRest) -> Deribit {
        let markets = [testing::market(ID, "BTC_USDC-PERPETUAL", "BTC", "USDC", true)];
        Deribit::with_rest(&testing::tracked(&markets), &rest.url)
    }

    async fn poll(venue: &Deribit, ts: i64) -> AnchorMap {
        venue.fetch_round(&http(), ts).await.unwrap()
    }

    #[test]
    fn polls_every_two_seconds_and_pauses_ten_seconds_on_a_rate_limit() {
        let venue = Deribit::new(&[]);

        assert_eq!(venue.poll_every(), Duration::from_secs(2));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(10));
    }

    #[test]
    fn asks_for_one_summary_per_settlement_currency_of_the_tracked_markets() {
        let markets = [
            testing::market(ID, "BTC_USDC-PERPETUAL", "BTC", "USDC", true),
            testing::market(ID, "ETH_USDC-PERPETUAL", "ETH", "USDC", true),
            testing::market(ID, "SOL_USDT-PERPETUAL", "SOL", "USDT", true),
        ];

        let venue = Deribit::new(&testing::tracked(&markets));

        assert_eq!(venue.currencies, ["USDC", "USDT"]);
    }

    #[tokio::test]
    async fn maps_a_perpetual_with_current_funding_per_8_hours_no_next_settlement_and_the_snapshot_time() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, catalog());
        rest.reply(USDC_SUMMARY, summary(vec![btc_perpetual(), pepe_perpetual()]));

        let rows = poll(&venue(&rest), T0).await;

        assert_eq!(rest.calls(), [INSTRUMENTS_PATH, USDC_SUMMARY]);
        assert_eq!(
            rows["BTC_USDC-PERPETUAL"],
            AnchorRow {
                index: 82419.95,
                mark: 82445.73,
                funding_rate: 6.279e-05,
                funding_interval_hours: 8.0,
                next_funding_at: 0,
                ts: Some(1791523610012),
            }
        );
        assert_eq!(rows["1000PEPE_USDC-PERPETUAL"].funding_rate, -3.87e-06);
    }

    #[tokio::test]
    async fn leaves_out_dated_futures_and_every_perpetual_whose_index_can_follow_its_own_mark() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, catalog());
        rest.reply(USDC_SUMMARY, summary(vec![btc_dated(), nvda_perpetual(), openai_perpetual(), btc_perpetual()]));

        let rows = poll(&venue(&rest), T0).await;

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTC_USDC-PERPETUAL"]);
    }

    #[tokio::test]
    async fn anchors_the_crypto_index_perpetual_like_a_crypto_one() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, catalog());
        rest.reply(USDC_SUMMARY, summary(vec![coin50_perpetual()]));

        let rows = poll(&venue(&rest), T0).await;

        assert_eq!(rows["COIN50_USDC-PERPETUAL"].index, 322.49);
        assert_eq!(rows["COIN50_USDC-PERPETUAL"].mark, 322.44);
    }

    // No perpetual settled in USDT on 2026-10-08, so the PEPE row stands in for one in the second reply.
    #[tokio::test]
    async fn merges_the_summaries_of_every_settlement_currency_into_one_round() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, catalog());
        rest.reply(USDC_SUMMARY, summary(vec![btc_perpetual()]));
        let usdt_summary = "/public/get_book_summary_by_currency?kind=future&currency=USDT";
        rest.reply(usdt_summary, summary(vec![pepe_perpetual()]));
        let markets = [
            testing::market(ID, "BTC_USDC-PERPETUAL", "BTC", "USDC", true),
            testing::market(ID, "1000PEPE_USDC-PERPETUAL", "1000PEPE", "USDT", true),
        ];
        let venue = Deribit::with_rest(&testing::tracked(&markets), &rest.url);

        let rows = poll(&venue, T0).await;

        let mut calls = rest.calls();
        calls.sort();
        assert_eq!(calls, [USDC_SUMMARY, usdt_summary, INSTRUMENTS_PATH]);
        let mut keys: Vec<&str> = rows.keys().map(String::as_str).collect();
        keys.sort();
        assert_eq!(keys, ["1000PEPE_USDC-PERPETUAL", "BTC_USDC-PERPETUAL"]);
    }

    #[tokio::test]
    async fn leaves_out_a_perpetual_listed_after_the_last_catalog_read() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, catalog());
        let mut new = btc_perpetual();
        new["instrument_name"] = json!("NEW_USDC-PERPETUAL");
        rest.reply(USDC_SUMMARY, summary(vec![new, btc_perpetual()]));

        let rows = poll(&venue(&rest), T0).await;

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTC_USDC-PERPETUAL"]);
    }

    #[tokio::test]
    async fn caps_a_snapshot_time_ahead_of_arrival_and_takes_arrival_when_none_is_sent() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, catalog());
        let mut ahead = btc_perpetual();
        ahead["creation_timestamp"] = json!(now_ms() + 60_000);
        let mut unstamped = pepe_perpetual();
        unstamped.as_object_mut().unwrap().remove("creation_timestamp");
        rest.reply(USDC_SUMMARY, summary(vec![ahead, unstamped]));

        let before = now_ms();
        let rows = poll(&venue(&rest), T0).await;
        let after = now_ms();

        for row in rows.values() {
            let ts = row.ts.unwrap();
            assert!(before <= ts && ts <= after, "{ts} outside {before}..{after}");
        }
    }

    #[tokio::test]
    async fn rereads_the_catalog_only_after_an_hour() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, catalog());
        rest.reply(USDC_SUMMARY, summary(vec![btc_perpetual()]));
        let venue = venue(&rest);

        poll(&venue, T0).await;
        poll(&venue, T0 + CATALOG_REFRESH_MS - 1).await;
        poll(&venue, T0 + CATALOG_REFRESH_MS).await;

        assert_eq!(rest.calls(), [INSTRUMENTS_PATH, USDC_SUMMARY, USDC_SUMMARY, INSTRUMENTS_PATH, USDC_SUMMARY]);
    }

    #[tokio::test]
    async fn fails_the_round_while_the_first_catalog_read_fails() {
        let rest = MockRest::start().await;
        rest.fail(INSTRUMENTS_PATH, 502);
        rest.reply(USDC_SUMMARY, summary(vec![btc_perpetual()]));

        let result = venue(&rest).fetch_round(&http(), T0).await;

        assert!(result.is_err());
        assert_eq!(rest.calls(), [INSTRUMENTS_PATH]);
    }

    #[tokio::test]
    async fn keeps_the_last_catalog_when_a_refresh_fails_and_retries_a_minute_later() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, catalog());
        rest.reply(USDC_SUMMARY, summary(vec![btc_perpetual(), nvda_perpetual()]));
        let venue = venue(&rest);
        poll(&venue, T0).await;

        rest.fail(INSTRUMENTS_PATH, 502);
        let rows = poll(&venue, T0 + CATALOG_REFRESH_MS).await;
        poll(&venue, T0 + CATALOG_REFRESH_MS + CATALOG_RETRY_MS - 1).await;
        poll(&venue, T0 + CATALOG_REFRESH_MS + CATALOG_RETRY_MS).await;

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTC_USDC-PERPETUAL"]);
        assert_eq!(logs.events("anchored_catalog_failed").len(), 2);
        let catalog_reads = rest.calls().iter().filter(|call| *call == INSTRUMENTS_PATH).count();
        assert_eq!(catalog_reads, 3);
    }

    #[tokio::test]
    async fn fails_the_round_on_an_error_reply_and_pauses_on_the_rate_limit_code() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, catalog());
        rest.reply(USDC_SUMMARY, json!({"jsonrpc":"2.0","error":{"code":10028,"message":"too_many_requests"}}));

        let error = venue(&rest).fetch_round(&http(), T0).await.unwrap_err();

        let limited = error.downcast_ref::<crate::feeds::anchor_poller::RateLimited>().unwrap();
        assert_eq!(limited.reason, "code 10028");
        assert_eq!(limited.retry_after, None);
    }

    // The venue answers a bad call with HTTP 400, which get_json already fails, so this is the same body under a 200.
    #[tokio::test]
    async fn fails_the_round_on_any_other_error_reply() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, catalog());
        rest.reply(
            USDC_SUMMARY,
            json!({"jsonrpc":"2.0","error":{"code":-32602,"data":{"reason":"invalid currency","param":"currency"},"message":"Invalid params"}}),
        );

        let error = venue(&rest).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.to_string().contains("code -32602: Invalid params"), "{error:#}");
        assert!(error.downcast_ref::<crate::feeds::anchor_poller::RateLimited>().is_none());
    }
}
