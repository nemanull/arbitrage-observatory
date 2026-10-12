use super::markets::{PRODUCTS_PATH, Reply};
use super::{Delta, ID};
use crate::clock::now_ms;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;

// One call carries index, mark and rate for every perpetual.
// CloudFront serves it from a 2 s cache unless the query is new, so each round adds its own nonce.
pub const TICKERS_PATH: &str = "/v2/tickers?contract_types=perpetual_futures&nonce=";

// Only the catalog carries the funding interval, so it is read at the first round and then every 10 min.
const INTERVALS_REFRESH_MS: i64 = 10 * 60 * 1000;
const INTERVALS_RETRY_MS: i64 = 60 * 1000;

const OPERATIONAL: &str = "operational";
const MS_PER_SECOND: f64 = 1_000.0;
const SECONDS_PER_HOUR: f64 = 3_600.0;
const US_PER_MS: f64 = 1_000.0;
const PERCENT: f64 = 100.0;

#[derive(Default)]
pub struct Intervals {
    seconds: HashMap<String, f64>, // rate_exchange_interval by raw id
    read_at: i64,                  // Unix ms, 0 = never, so the first round reads the catalog
}

impl AnchorVenue for Delta {
    // Tickers weigh 3 of the 10,000 an IP may spend in a fixed 5 min window, so a poll a second spends 900.
    // A breach answers 429 with X-RATE-LIMIT-RESET rather than Retry-After, so the pause is the whole window.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(300)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        self.refresh_intervals(http, ts).await?;

        let url = format!("{}{TICKERS_PATH}{ts}", self.rest);
        let reply: TickersReply = get_json(http, &url).await?;
        if !reply.success {
            anyhow::bail!("tickers answered success false");
        }
        let arrived_at = now_ms();

        let intervals = self.intervals.lock().unwrap();
        let tickers = reply.result.unwrap_or_default();
        let mut rows = AnchorMap::with_capacity(tickers.len());
        for ticker in tickers {
            // A disrupted market is cancel only or post only, so its book cannot be crossed against.
            if ticker.product_trading_status != OPERATIONAL {
                continue;
            }
            let Some(&interval) = intervals.seconds.get(&ticker.symbol) else {
                continue;
            };

            rows.insert(
                ticker.symbol,
                AnchorRow {
                    index: ticker.spot_price,
                    mark: ticker.mark_price,
                    funding_rate: ticker.funding_rate / PERCENT, // the running estimate for the interval in progress
                    funding_interval_hours: interval / SECONDS_PER_HOUR,
                    next_funding_at: next_funding_at(ts, interval),
                    // The origin rebuilds the reply every 2.5 to 3.2 s, so it was up to 5.5 s old on arrival.
                    ts: Some(stamp(ticker.timestamp, arrived_at)),
                },
            );
        }

        Ok(rows)
    }
}

impl Delta {
    async fn refresh_intervals(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<()> {
        let read_at = self.intervals.lock().unwrap().read_at;
        if ts - read_at < INTERVALS_REFRESH_MS {
            return Ok(());
        }

        let read = async {
            let reply: Reply = get_json(http, &format!("{}{PRODUCTS_PATH}", self.rest)).await?;
            if !reply.success {
                anyhow::bail!("products answered success false");
            }
            anyhow::Ok(reply.result.unwrap_or_default())
        };

        match read.await {
            Ok(products) => {
                let mut seconds = HashMap::with_capacity(products.len());
                for product in products {
                    let interval = product.product_specs.rate_exchange_interval;
                    if interval.is_finite() && interval > 0.0 {
                        seconds.insert(product.symbol, interval);
                    }
                }
                tracing::info!(event = "funding_intervals_read", venue = ID, markets = seconds.len());
                let mut intervals = self.intervals.lock().unwrap();
                intervals.seconds = seconds;
                intervals.read_at = ts;
                Ok(())
            }
            // No row can be sent without its interval, so the round fails and the next one tries again.
            Err(error) if read_at == 0 => Err(error),
            // A failed refresh keeps the intervals it has and tries again a minute later.
            Err(error) => {
                tracing::warn!(event = "funding_intervals_failed", venue = ID, error = format!("{error:#}"));
                self.intervals.lock().unwrap().read_at = ts - INTERVALS_REFRESH_MS + INTERVALS_RETRY_MS;
                Ok(())
            }
        }
    }
}

// No REST call names the next settlement, which falls on the interval's grid from the epoch, 00, 08 and 16 UTC for 8 h.
// The socket's funding_rate channel read 08:00 UTC at 04:18 UTC on PAXGUSDT's 4 h interval too.
fn next_funding_at(now: i64, interval_seconds: f64) -> i64 {
    let interval_ms = (interval_seconds * MS_PER_SECOND) as i64;
    if interval_ms <= 0 {
        return 0;
    }
    (now.div_euclid(interval_ms) + 1) * interval_ms
}

// The timestamp is in µs, and arrival caps a clock that runs ahead.
fn stamp(timestamp_us: f64, arrived_at: i64) -> i64 {
    if timestamp_us.is_finite() && timestamp_us > 0.0 {
        ((timestamp_us / US_PER_MS) as i64).min(arrived_at)
    } else {
        arrived_at
    }
}

#[derive(Deserialize)]
struct TickersReply {
    #[serde(default)]
    success: bool,
    result: Option<Vec<Ticker>>,
}

#[derive(Deserialize)]
struct Ticker {
    #[serde(default)]
    symbol: String, // "BTCUSDT"
    #[serde(default)]
    product_trading_status: String, // "operational", "disrupted_cancel_only" or "disrupted_post_only"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    spot_price: f64, // the index, an equal weight basket of outside spot books
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64, // the index plus a 60 s average of the impact mid's basis
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // percent per interval
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    timestamp: f64, // Unix µs of the snapshot
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    const T0: i64 = 1_791_567_639_000; // 2026-10-09 17:40:39 UTC
    const TICKERS_AT_T0: &str = "/v2/tickers?contract_types=perpetual_futures&nonce=1791567639000";

    // Rows of both calls captured live on 2026-10-09, cut down to the fields the poller reads plus a few it ignores.
    fn btc_ticker() -> Value {
        json!({
            "symbol": "BTCUSDT", "product_id": 139, "contract_type": "perpetual_futures", "product_trading_status": "operational",
            "spot_price": "82676.3", "mark_price": "82639.31186238", "funding_rate": "0.0026912765800438873",
            "mark_basis": "-0.00044728", "timestamp": 1791567638798334_i64, "time": "2026-10-08T17:34:54.647631117Z",
            "quotes": { "best_ask": "82639.5", "best_bid": "82639", "impact_mid_price": null },
        })
    }

    fn paxg_ticker() -> Value {
        json!({
            "symbol": "PAXGUSDT", "product_id": 277715, "contract_type": "perpetual_futures", "product_trading_status": "operational",
            "spot_price": "4191.965", "mark_price": "4189.02600647", "funding_rate": "-0.004096826092964377",
            "timestamp": 1791567638800675_i64,
        })
    }

    fn doge_ticker() -> Value {
        json!({
            "symbol": "DOGEUSDT", "product_id": 3316, "contract_type": "perpetual_futures", "product_trading_status": "operational",
            "spot_price": "0.08477", "mark_price": "0.08469839", "funding_rate": "-0.0335430993088809",
            "timestamp": 1791567638798334_i64,
        })
    }

    fn product(symbol: &str, interval: i64) -> Value {
        json!({
            "symbol": symbol, "contract_type": "perpetual_futures", "state": "live", "trading_status": "operational",
            "contract_value": "0.001", "product_specs": { "rate_exchange_interval": interval, "funding_clamp_value": 0.05 },
        })
    }

    fn tickers(rows: Vec<Value>) -> Value {
        json!({ "success": true, "result": rows })
    }

    fn products(rows: Vec<Value>) -> Value {
        json!({ "meta": { "limit": 3000, "total_count": rows.len() }, "success": true, "result": rows })
    }

    fn all_products() -> Value {
        products(vec![product("BTCUSDT", 28800), product("PAXGUSDT", 14400), product("DOGEUSDT", 28800)])
    }

    fn tickers_at(ts: i64) -> String {
        format!("{TICKERS_PATH}{ts}")
    }

    #[test]
    fn polls_every_second_and_pauses_a_whole_window_on_a_rate_limit() {
        let venue = Delta::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(300));
    }

    #[test]
    fn the_next_funding_is_the_next_point_of_the_interval_grid() {
        // 17:40:39 UTC on the 8 h grid is 00:00 UTC, and on the 4 h grid 20:00 UTC.
        assert_eq!(next_funding_at(T0, 28800.0), 1_791_590_400_000);
        assert_eq!(next_funding_at(T0, 14400.0), 1_791_576_000_000);
        // At a settlement the next one is a whole interval away.
        assert_eq!(next_funding_at(1_791_590_400_000, 28800.0), 1_791_619_200_000);
        assert_eq!(next_funding_at(T0, 0.0), 0);
    }

    #[tokio::test]
    async fn reads_index_mark_and_the_percent_rate_with_the_interval_of_the_catalog() {
        let rest = MockRest::start().await;
        rest.reply(PRODUCTS_PATH, all_products());
        rest.reply(TICKERS_AT_T0, tickers(vec![btc_ticker(), paxg_ticker(), doge_ticker()]));

        let rows = Delta::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rest.calls(), [PRODUCTS_PATH, TICKERS_AT_T0]);
        assert_eq!(rows.len(), 3);
        assert_eq!(
            rows["BTCUSDT"],
            AnchorRow {
                index: 82676.3,
                mark: 82639.31186238,
                funding_rate: 0.0026912765800438873 / 100.0,
                funding_interval_hours: 8.0,
                next_funding_at: 1_791_590_400_000,
                ts: Some(1_791_567_638_798),
            }
        );
        assert_eq!(rows["PAXGUSDT"].funding_interval_hours, 4.0);
        assert_eq!(rows["PAXGUSDT"].next_funding_at, 1_791_576_000_000);
        assert_eq!(rows["DOGEUSDT"].funding_rate, -0.0335430993088809 / 100.0);
    }

    #[tokio::test]
    async fn rereads_the_intervals_only_after_10_minutes() {
        let rest = MockRest::start().await;
        rest.reply(PRODUCTS_PATH, all_products());
        let venue = Delta::with_rest(&rest.url);
        let later = T0 + INTERVALS_REFRESH_MS - 1;
        let next = T0 + INTERVALS_REFRESH_MS;
        for ts in [T0, later, next] {
            rest.reply(&tickers_at(ts), tickers(vec![btc_ticker()]));
        }

        venue.fetch_round(&http(), T0).await.unwrap();
        venue.fetch_round(&http(), later).await.unwrap();
        venue.fetch_round(&http(), next).await.unwrap();

        let products_read = rest.calls().iter().filter(|call| *call == PRODUCTS_PATH).count();
        assert_eq!(products_read, 2);
    }

    #[tokio::test]
    async fn fails_the_round_until_the_intervals_are_first_read() {
        let rest = MockRest::start().await;
        rest.fail(PRODUCTS_PATH, 500);
        rest.reply(TICKERS_AT_T0, tickers(vec![btc_ticker()]));
        let venue = Delta::with_rest(&rest.url);

        assert!(venue.fetch_round(&http(), T0).await.is_err());

        rest.reply(PRODUCTS_PATH, all_products());

        assert_eq!(venue.fetch_round(&http(), T0).await.unwrap().len(), 1);
    }

    #[tokio::test]
    async fn keeps_the_intervals_it_has_when_a_refresh_fails_and_retries_a_minute_later() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(PRODUCTS_PATH, all_products());
        let venue = Delta::with_rest(&rest.url);
        let stale = T0 + INTERVALS_REFRESH_MS;
        let too_soon = stale + INTERVALS_RETRY_MS - 1;
        let retry = stale + INTERVALS_RETRY_MS;
        for ts in [T0, stale, too_soon, retry] {
            rest.reply(&tickers_at(ts), tickers(vec![btc_ticker()]));
        }
        venue.fetch_round(&http(), T0).await.unwrap();
        rest.fail(PRODUCTS_PATH, 500);

        let rows = venue.fetch_round(&http(), stale).await.unwrap();
        venue.fetch_round(&http(), too_soon).await.unwrap();
        venue.fetch_round(&http(), retry).await.unwrap();

        assert_eq!(rows["BTCUSDT"].funding_interval_hours, 8.0);
        assert_eq!(logs.events("funding_intervals_failed").len(), 2);
    }

    #[tokio::test]
    async fn leaves_out_a_disrupted_market_and_one_the_catalog_lacks() {
        let mut disrupted = paxg_ticker();
        disrupted["product_trading_status"] = json!("disrupted_post_only");
        let mut unlisted = btc_ticker();
        unlisted["symbol"] = json!("ADAUSDT");
        let rest = MockRest::start().await;
        rest.reply(PRODUCTS_PATH, all_products());
        rest.reply(TICKERS_AT_T0, tickers(vec![btc_ticker(), disrupted, unlisted]));

        let rows = Delta::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTCUSDT"]);
    }

    #[tokio::test]
    async fn leaves_out_a_market_whose_catalog_row_has_no_interval() {
        let mut no_interval = product("DOGEUSDT", 0);
        no_interval["product_specs"]["rate_exchange_interval"] = Value::Null;
        let rest = MockRest::start().await;
        rest.reply(PRODUCTS_PATH, products(vec![product("BTCUSDT", 28800), no_interval]));
        rest.reply(TICKERS_AT_T0, tickers(vec![btc_ticker(), doge_ticker()]));

        let rows = Delta::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTCUSDT"]);
    }

    #[tokio::test]
    async fn stamps_a_row_without_a_timestamp_and_one_from_the_future_with_its_arrival() {
        let mut no_timestamp = btc_ticker();
        no_timestamp.as_object_mut().unwrap().remove("timestamp");
        let mut ahead = paxg_ticker();
        ahead["timestamp"] = json!(9_000_000_000_000_000_i64);
        let rest = MockRest::start().await;
        rest.reply(PRODUCTS_PATH, all_products());
        rest.reply(TICKERS_AT_T0, tickers(vec![no_timestamp, ahead]));
        let before = now_ms();

        let rows = Delta::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        let after = now_ms();
        for row in rows.values() {
            let ts = row.ts.unwrap();
            assert!(ts >= before && ts <= after);
        }
    }

    #[tokio::test]
    async fn fails_the_round_when_the_tickers_fail() {
        let rest = MockRest::start().await;
        rest.reply(PRODUCTS_PATH, all_products());
        rest.fail(TICKERS_AT_T0, 500);

        assert!(Delta::with_rest(&rest.url).fetch_round(&http(), T0).await.is_err());

        rest.reply(TICKERS_AT_T0, json!({ "success": false, "error": { "code": "bad_schema" } }));

        assert!(Delta::with_rest(&rest.url).fetch_round(&http(), T0).await.is_err());
    }
}
