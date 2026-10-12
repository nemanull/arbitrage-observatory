use super::{ID, Weex};
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;

// Two bulk calls a round, joined by symbol.
// The ticker carries a live index and mark at weight 40, and premiumIndex carries the funding columns at weight 1.
// premiumIndex also carries an index and a mark, but it refreshes them once a minute while its time field ticks every second, so they are never read.
pub const TICKER_PATH: &str = "/capi/v3/market/ticker/24hr";
pub const PREMIUM_PATH: &str = "/capi/v3/market/premiumIndex";

const MINUTES_PER_HOUR: f64 = 60.0;

// Some indexes stop for good while the mark trades on, such as AAPLUSDT's 294.645, which read the same on 2026-09-23 and 2026-10-09 while the mark was 335.6.
// A stock index also stands still while its market is closed and the mark follows the last trade.
// So a row whose index has not moved for this long while its mark has is no index, and it stays out until the index moves.
// Over 12 minutes on 2026-10-09 this held 25 contracts, 6 of them crypto, and among them every index more than 1 percent from bybit's or binance's.
// A limit of one minute held 98, most of them within 0.1 percent of the references.
// The clock starts when the poller first sees a contract, so a restart sends a stopped index for up to this long.
const FROZEN_INDEX_MS: i64 = 600_000;

// What the poller last saw of one contract's index and mark.
pub struct IndexWatch {
    index: f64,
    mark: f64,
    index_since: i64, // the round that brought the current index, or the first round that saw the contract
    mark_moved: bool, // the mark changed after the current index arrived
    held: bool,
}

impl IndexWatch {
    fn new(index: f64, mark: f64, ts: i64) -> Self {
        Self {
            index,
            mark,
            index_since: ts,
            mark_moved: false,
            held: false,
        }
    }

    fn see(&mut self, index: f64, mark: f64, ts: i64) -> bool {
        if index != self.index {
            self.index = index;
            self.index_since = ts;
            self.mark_moved = false;
        } else if mark != self.mark {
            self.mark_moved = true;
        }
        self.mark = mark;

        self.mark_moved && ts - self.index_since >= FROZEN_INDEX_MS
    }
}

impl AnchorVenue for Weex {
    // 41 weight a round every 2 s is 205 of the 500 an IP may spend in 10 s.
    fn poll_every(&self) -> Duration {
        Duration::from_secs(2)
    }

    // A breach bans the IP for 10 s and the 429 carries no Retry-After.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let ticker_url = format!("{}{TICKER_PATH}", self.rest);
        let premium_url = format!("{}{PREMIUM_PATH}", self.rest);
        let (tickers, premiums) = tokio::try_join!(
            get_json::<Vec<Ticker>>(http, &ticker_url),
            get_json::<Vec<Premium>>(http, &premium_url),
        )?;

        let mut premium_of = HashMap::with_capacity(premiums.len());
        for premium in premiums {
            premium_of.insert(premium.symbol.clone(), premium);
        }

        // The index basket is not published, so no row can be told apart as a self index.
        let mut indexes = self.indexes.lock().unwrap();
        let mut rows = AnchorMap::with_capacity(tickers.len());
        for ticker in tickers {
            let Some(premium) = premium_of.get(&ticker.symbol) else {
                continue;
            };
            if !(ticker.index_price.is_finite() && ticker.index_price > 0.0) {
                continue;
            }
            if frozen(&mut indexes, &ticker, ts) {
                continue;
            }

            rows.insert(
                ticker.symbol,
                AnchorRow {
                    index: ticker.index_price,
                    mark: ticker.mark_price,
                    funding_rate: premium.forecast_funding_rate,
                    funding_interval_hours: premium.collect_cycle / MINUTES_PER_HOUR,
                    next_funding_at: next_settlement(premium.next_funding_time, ts),
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

// Logs each contract as its index is held out and as it is let back in.
fn frozen(indexes: &mut HashMap<String, IndexWatch>, ticker: &Ticker, ts: i64) -> bool {
    let watch = indexes
        .entry(ticker.symbol.clone())
        .or_insert_with(|| IndexWatch::new(ticker.index_price, ticker.mark_price, ts));
    let frozen = watch.see(ticker.index_price, ticker.mark_price, ts);

    if frozen != watch.held {
        watch.held = frozen;
        if frozen {
            tracing::info!(event = "index_frozen", venue = ID, market = %ticker.symbol, index = ticker.index_price, mark = ticker.mark_price);
        } else {
            tracing::info!(event = "index_resumed", venue = ID, market = %ticker.symbol, index = ticker.index_price);
        }
    }
    frozen
}

// A contract with no settlement yet reads a time in the past, such as DALUSDT's 28800000 on 2026-09-23.
fn next_settlement(ms: f64, now: i64) -> i64 {
    let ms = ms as i64;
    if ms > now { ms } else { 0 }
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ticker {
    #[serde(default)]
    symbol: String, // "BTCUSDT", the socket's id
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64, // frozen on a stock contract while its market is closed
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64, // the last trade on about 45 % of the contracts, with no clamp to the index
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Premium {
    #[serde(default)]
    symbol: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    forecast_funding_rate: f64, // the upcoming settlement's rate as a fraction, where lastFundingRate is the settled one
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    collect_cycle: f64, // minutes: 60, 240 or 480
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_funding_time: f64, // Unix ms
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::feeds::anchor_poller::RateLimited;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    const T0: i64 = 1_791_567_629_623;

    // Rows captured live on 2026-10-09 at 17:40 UTC, with fields the poller ignores.
    // Each premiumIndex price differs from the ticker's, since it is up to a minute old.
    fn btc_ticker() -> Value {
        json!({
            "symbol": "BTCUSDT", "priceChange": "1941.4", "priceChangePercent": "0.024057", "lastPrice": "82641.2",
            "openPrice": "80699.8", "highPrice": "83488.4", "lowPrice": "80504.9", "volume": "32576.4113",
            "quoteVolume": "2680852052.05678", "openTime": 1791480600000_i64, "closeTime": 1791567000000_i64,
            "markPrice": "82641.2", "indexPrice": "82675.76325",
        })
    }

    fn btc_premium() -> Value {
        json!({
            "symbol": "BTCUSDT", "markPrice": "82657.5", "indexPrice": "82694.20325", "forecastFundingRate": "0.00003328",
            "lastFundingRate": "0.00001238", "interestRate": "0.0003", "nextFundingTime": 1791590400000_i64,
            "time": 1791567629623_i64, "collectCycle": 480,
        })
    }

    fn scr_ticker() -> Value {
        json!({
            "symbol": "SCRUSDT", "priceChange": "0.00102", "priceChangePercent": "0.040460", "lastPrice": "0.02623",
            "openPrice": "0.02521", "highPrice": "0.02800", "lowPrice": "0.02497", "volume": "11281910",
            "quoteVolume": "295443.73070", "openTime": 1791480600000_i64, "closeTime": 1791567000000_i64,
            "markPrice": "0.02623", "indexPrice": "0.02625425",
        })
    }

    fn scr_premium() -> Value {
        json!({
            "symbol": "SCRUSDT", "markPrice": "0.02627", "indexPrice": "0.02628925", "forecastFundingRate": "0.00000741",
            "lastFundingRate": "-0.00000734", "interestRate": "0.0003", "nextFundingTime": 1791576000000_i64,
            "time": 1791567629623_i64, "collectCycle": 240,
        })
    }

    // An hourly contract with no trade in the last day, whose ticker still carries an index and a mark.
    fn gastown_ticker() -> Value {
        json!({
            "symbol": "GASTOWNUSDT", "priceChange": "0", "priceChangePercent": "0", "lastPrice": "0", "openPrice": "0",
            "highPrice": "0", "lowPrice": "0", "volume": "0.0", "quoteVolume": "0.0", "openTime": 1791480600000_i64,
            "closeTime": 1791567000000_i64, "markPrice": "0.08472", "indexPrice": "0.08473",
        })
    }

    fn gastown_premium() -> Value {
        json!({
            "symbol": "GASTOWNUSDT", "markPrice": "0.08476", "indexPrice": "0.08477", "forecastFundingRate": "-0.0001050",
            "lastFundingRate": "-0.0000903", "interestRate": "0.0003", "nextFundingTime": 1791568800000_i64,
            "time": 1791567629623_i64, "collectCycle": 60,
        })
    }

    async fn poll(tickers: Value, premiums: Value) -> (MockRest, anyhow::Result<AnchorMap>) {
        let rest = MockRest::start().await;
        rest.reply(TICKER_PATH, tickers);
        rest.reply(PREMIUM_PATH, premiums);
        let rows = Weex::with_rest(&rest.url).fetch_round(&http(), T0).await;
        (rest, rows)
    }

    #[test]
    fn polls_every_two_seconds_and_pauses_ten_seconds_on_a_rate_limit() {
        let venue = Weex::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(2));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(10));
    }

    #[tokio::test]
    async fn takes_index_and_mark_from_the_ticker_and_funding_from_premium_index() {
        let (rest, rows) = poll(json!([btc_ticker(), scr_ticker()]), json!([scr_premium(), btc_premium()])).await;
        let rows = rows.unwrap();

        let mut calls = rest.calls();
        calls.sort();
        assert_eq!(calls, [PREMIUM_PATH, TICKER_PATH]);
        assert_eq!(
            rows["BTCUSDT"],
            AnchorRow {
                index: 82675.76325,
                mark: 82641.2,
                funding_rate: 0.00003328,
                funding_interval_hours: 8.0,
                next_funding_at: 1791590400000,
                ts: None,
            }
        );
        assert_eq!(rows["SCRUSDT"].funding_interval_hours, 4.0);
        assert_eq!(rows["SCRUSDT"].funding_rate, 0.00000741);
    }

    #[tokio::test]
    async fn reads_an_hourly_cycle_as_one_hour_on_a_contract_with_no_trade() {
        let (_rest, rows) = poll(json!([gastown_ticker()]), json!([gastown_premium()])).await;
        let row = rows.unwrap()["GASTOWNUSDT"];

        assert_eq!(row.funding_interval_hours, 1.0);
        assert_eq!((row.index, row.mark, row.funding_rate), (0.08473, 0.08472, -0.000105));
        assert_eq!(row.next_funding_at, 1791568800000);
    }

    #[tokio::test]
    async fn reads_a_next_funding_time_in_the_past_as_unknown() {
        let mut premium = btc_premium();
        premium["nextFundingTime"] = json!(28800000);

        let (_rest, rows) = poll(json!([btc_ticker()]), json!([premium])).await;

        assert_eq!(rows.unwrap()["BTCUSDT"].next_funding_at, 0);
    }

    #[tokio::test]
    async fn leaves_out_a_contract_missing_from_either_reply_or_with_no_index() {
        let mut no_index = scr_ticker();
        no_index["indexPrice"] = json!("0");
        let mut eth = btc_ticker();
        eth["symbol"] = json!("ETHUSDT");

        let (_rest, rows) = poll(json!([btc_ticker(), no_index, eth]), json!([btc_premium(), scr_premium()])).await;

        assert_eq!(rows.unwrap().keys().collect::<Vec<_>>(), ["BTCUSDT"]);
    }

    // Captured live on 2026-10-09 at 17:50 UTC, with the index and mark set by each case.
    fn aapl_ticker(index: &str, mark: &str) -> Value {
        json!({
            "symbol": "AAPLUSDT", "priceChange": "-3.32", "priceChangePercent": "-0.009795", "lastPrice": "335.61",
            "openPrice": "338.93", "highPrice": "341.70", "lowPrice": "331.31", "volume": "4163.31",
            "quoteVolume": "1386449.3403000001", "openTime": 1791482400000_i64, "closeTime": 1791568800000_i64,
            "markPrice": mark, "indexPrice": index,
        })
    }

    fn aapl_premium() -> Value {
        json!({
            "symbol": "AAPLUSDT", "markPrice": "335.45", "indexPrice": "294.645", "forecastFundingRate": "0.0001007",
            "lastFundingRate": "0.0000995", "interestRate": "0.0003", "nextFundingTime": 1791590400000_i64,
            "time": 1791567629623_i64, "collectCycle": 480,
        })
    }

    // Each round sets the ticker reply first, as one poller's rounds would read it.
    async fn rounds(prices: &[(&str, &str, i64)]) -> Vec<bool> {
        let rest = MockRest::start().await;
        rest.reply(PREMIUM_PATH, json!([aapl_premium()]));
        let venue = Weex::with_rest(&rest.url);
        let mut sent = Vec::new();
        for &(index, mark, ts) in prices {
            rest.reply(TICKER_PATH, json!([aapl_ticker(index, mark)]));
            sent.push(venue.fetch_round(&http(), ts).await.unwrap().contains_key("AAPLUSDT"));
        }
        sent
    }

    // AAPLUSDT's index read 294.645 on 2026-09-23 and again on 2026-10-09, while its mark traded near 335.6.
    #[tokio::test]
    async fn holds_out_an_index_still_ten_minutes_after_the_poller_first_saw_it_while_the_mark_moved() {
        let (logs, _capture) = capture();

        let sent = rounds(&[
            ("294.645", "335.62", T0),
            ("294.645", "335.68", T0 + 2_000),
            ("294.645", "335.68", T0 + 599_999),
            ("294.645", "335.61", T0 + 600_000),
        ])
        .await;

        assert_eq!(sent, [true, true, true, false]);
        let frozen = logs.events("index_frozen");
        assert_eq!(frozen.len(), 1);
        assert_eq!(frozen[0].text("market"), "AAPLUSDT");
        assert_eq!(frozen[0].number("index"), 294.645);
    }

    #[tokio::test]
    async fn holds_out_an_index_that_stopped_ten_minutes_ago_while_the_mark_moved() {
        let sent = rounds(&[
            ("335.50", "335.62", T0),
            ("335.55", "335.62", T0 + 2_000),
            ("335.55", "335.70", T0 + 30_000),
            ("335.55", "335.75", T0 + 601_999),
            ("335.55", "335.80", T0 + 602_000),
        ])
        .await;

        assert_eq!(sent, [true, true, true, true, false]);
    }

    #[tokio::test]
    async fn lets_a_held_index_back_in_as_soon_as_it_moves() {
        let (logs, _capture) = capture();

        let sent = rounds(&[("294.645", "335.62", T0), ("294.645", "335.68", T0 + 600_000), ("335.66", "335.68", T0 + 602_000)]).await;

        assert_eq!(sent, [true, false, true]);
        assert_eq!(logs.events("index_resumed")[0].text("market"), "AAPLUSDT");
    }

    #[tokio::test]
    async fn keeps_a_row_whose_index_and_mark_both_stand_still() {
        let sent = rounds(&[("335.50", "335.62", T0), ("335.50", "335.62", T0 + 1_200_000)]).await;

        assert_eq!(sent, [true, true]);
    }

    #[tokio::test]
    async fn starts_the_clock_over_when_the_index_moves() {
        let sent = rounds(&[
            ("335.50", "335.62", T0),
            ("335.50", "335.70", T0 + 500_000),
            ("335.55", "335.70", T0 + 550_000),
            ("335.55", "335.75", T0 + 1_000_000),
        ])
        .await;

        assert_eq!(sent, [true, true, true, true]);
    }

    #[tokio::test]
    async fn reads_a_429_on_either_call_as_a_rate_limit() {
        let rest = MockRest::start().await;
        rest.reply(TICKER_PATH, json!([btc_ticker()]));
        rest.fail(PREMIUM_PATH, 429);

        let error = Weex::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");
    }

    #[tokio::test]
    async fn fails_the_round_on_a_failed_call_or_a_body_that_is_no_list() {
        let rest = MockRest::start().await;
        rest.fail(TICKER_PATH, 400);
        rest.reply(PREMIUM_PATH, json!([btc_premium()]));
        assert!(Weex::with_rest(&rest.url).fetch_round(&http(), T0).await.is_err());

        // The unknown path answer captured live on 2026-10-09.
        let (_rest, rows) = poll(
            json!({ "timestamp": 1791567758624_i64, "status": 404, "error": "Not Found", "path": "/capi/v3/market/nope" }),
            json!([btc_premium()]),
        )
        .await;
        let error = rows.unwrap_err();
        assert!(format!("{error:#}").contains("error decoding response body"), "{error:#}");
    }
}
