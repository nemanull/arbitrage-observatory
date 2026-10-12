use super::markets::{Instrument, MARKETS_PATH};
use super::{Backpack, ID};
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;

// Index, mark, the running rate and the next settlement of every perpetual in one call.
// The CDN serves it up to an hour old while the origin fails, and its rows carry no time, so the round's ts in the query reaches the origin.
pub const MARK_PRICES_PATH: &str = "/api/v1/markPrices?t=";

// An equity perpetual's index turns into an EWMA of its own book's mid outside the US session, and no field says when.
// So only crypto perpetuals are anchored, as decision 4 leaves out a contract whose index is the venue's own perpetual.
// The mark call does not say which kind a market is, and listings change, so the catalog is reread every hour.
const CATALOG_REFRESH_MS: i64 = 60 * 60 * 1000;
const CATALOG_RETRY_MS: i64 = 60 * 1000;

// Every perpetual has settled hourly since 2025-08-20, so a row without an interval reads as 1 h.
const DEFAULT_INTERVAL_HOURS: f64 = 1.0;
const HOUR_MS: f64 = 60.0 * 60.0 * 1000.0;

#[derive(Default)]
pub struct AnchorState {
    anchored: HashMap<String, f64>, // open crypto perpetuals to their funding interval in hours
    catalog_read_at: i64, // Unix ms, 0 = never, so the first round reads the catalog
}

impl AnchorVenue for Backpack {
    // No public limit is published and no 429 was seen, so one conservative window.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        self.refresh_catalog(http, ts).await?;

        let rows: Vec<MarkPrice> = get_json(http, &format!("{}{MARK_PRICES_PATH}{ts}", self.rest)).await?;

        let state = self.anchors.lock().unwrap();
        let mut anchors = AnchorMap::with_capacity(rows.len());
        for row in rows {
            let Some(&interval_hours) = state.anchored.get(&row.symbol) else {
                continue;
            };
            // A missing next settlement casts to 0, and one already passed has not rolled yet, so both read as unknown.
            let next_funding_at = row.next_funding_timestamp as i64;

            anchors.insert(
                row.symbol,
                AnchorRow {
                    index: row.index_price,
                    mark: row.mark_price,
                    funding_rate: row.funding_rate, // the running estimate for the hour in progress
                    funding_interval_hours: interval_hours,
                    next_funding_at: if next_funding_at > ts { next_funding_at } else { 0 },
                    ts: None,
                },
            );
        }

        Ok(anchors)
    }
}

impl Backpack {
    async fn refresh_catalog(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<()> {
        let read_at = self.anchors.lock().unwrap().catalog_read_at;
        if ts - read_at < CATALOG_REFRESH_MS {
            return Ok(());
        }

        match get_json::<Vec<Instrument>>(http, &format!("{}{MARKETS_PATH}", self.rest)).await {
            Ok(rows) => {
                let anchored = anchored(rows);
                tracing::info!(event = "anchored_catalog_read", venue = ID, anchored = anchored.len());
                let mut state = self.anchors.lock().unwrap();
                state.anchored = anchored;
                state.catalog_read_at = ts;
                Ok(())
            }
            // Without a first read the equity rows cannot be told apart, so the round fails and the next one tries again.
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

// The open perpetuals with no rwaMarketType, which is how the catalog marks a crypto one.
fn anchored(rows: Vec<Instrument>) -> HashMap<String, f64> {
    let mut anchored = HashMap::new();
    for row in rows {
        if !row.is_open_perpetual() || row.rwa_market_type.is_some() {
            continue;
        }
        let interval_hours = if row.funding_interval > 0.0 { row.funding_interval / HOUR_MS } else { DEFAULT_INTERVAL_HOURS };
        anchored.insert(row.symbol, interval_hours);
    }
    anchored
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkPrice {
    #[serde(default)]
    symbol: String, // "BTC_USDC_PERP"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // a fraction per interval, up to 28 significant digits
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_funding_timestamp: f64, // Unix ms
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    const T0: i64 = 1_791_567_640_000; // 2026-10-09 17:40:40 UTC, when the rows below were read
    const NEXT_HOUR: i64 = 1_791_568_800_000; // 18:00 UTC

    fn catalog_row(symbol: &str, state: &str, rwa: Value, interval: Value) -> Value {
        json!({
            "baseSymbol": symbol.split('_').next().unwrap(), "marketType": "PERP", "orderBookState": state,
            "quoteSymbol": "USDC", "rwaMarketType": rwa, "symbol": symbol, "fundingInterval": interval, "visible": true,
        })
    }

    fn catalog() -> Value {
        json!([
            catalog_row("BTC_USDC_PERP", "Open", Value::Null, json!(3600000)),
            catalog_row("kPEPE_USDC_PERP", "Open", Value::Null, json!(28800000)),
            catalog_row("AAPL.US_USDC_PERP", "Open", json!("STOCK"), json!(3600000)),
            catalog_row("QQQ.US_USDC_PERP", "Open", json!("INDEX"), json!(3600000)),
            catalog_row("MSFT.US_USDC_PERP", "PostOnly", json!("STOCK"), json!(3600000)),
            catalog_row("TON_USDC_PERP", "Closed", Value::Null, json!(3600000)),
            catalog_row("SOL_USDC_PERP", "Open", Value::Null, Value::Null),
        ])
    }

    // Rows of GET /api/v1/markPrices captured live on 2026-10-09, where kPEPE's interval above is made 8 h for the case.
    fn mark_prices() -> Value {
        json!([
            { "fundingRate": "0.0000125", "indexPrice": "82611.02683525", "markPrice": "82609", "nextFundingTimestamp": NEXT_HOUR, "symbol": "BTC_USDC_PERP" },
            { "fundingRate": "0.0001080011", "indexPrice": "0.0038998", "markPrice": "0.0039023", "nextFundingTimestamp": NEXT_HOUR, "symbol": "kPEPE_USDC_PERP" },
            { "fundingRate": "0.00000625", "indexPrice": "335.11509", "markPrice": "335.25", "nextFundingTimestamp": NEXT_HOUR, "symbol": "AAPL.US_USDC_PERP" },
            { "fundingRate": "0.00000625", "indexPrice": "750.61825", "markPrice": "750.7", "nextFundingTimestamp": NEXT_HOUR, "symbol": "QQQ.US_USDC_PERP" },
            { "fundingRate": "0.00000625", "indexPrice": "533.99006", "markPrice": "533.99", "nextFundingTimestamp": NEXT_HOUR, "symbol": "MSFT.US_USDC_PERP" },
            { "fundingRate": "0.0000125", "indexPrice": "109.52994751", "markPrice": "109.49", "nextFundingTimestamp": NEXT_HOUR, "symbol": "SOL_USDC_PERP" },
        ])
    }

    fn mark_path(ts: i64) -> String {
        format!("{MARK_PRICES_PATH}{ts}")
    }

    async fn served(ts: i64) -> MockRest {
        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, catalog());
        rest.reply(&mark_path(ts), mark_prices());
        rest
    }

    #[test]
    fn polls_every_second_and_pauses_ten_seconds_on_a_rate_limit() {
        let venue = Backpack::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(10));
    }

    #[tokio::test]
    async fn maps_a_mark_price_row_with_the_catalog_interval_and_asks_the_origin_with_the_round_ts() {
        let rest = served(T0).await;
        let venue = Backpack::with_rest(&rest.url);

        let rows = venue.fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rest.calls(), [MARKETS_PATH.to_string(), mark_path(T0)]);
        assert_eq!(
            rows["BTC_USDC_PERP"],
            AnchorRow {
                index: 82611.02683525,
                mark: 82609.0,
                funding_rate: 0.0000125,
                funding_interval_hours: 1.0,
                next_funding_at: NEXT_HOUR,
                ts: None,
            }
        );
        assert_eq!(rows["kPEPE_USDC_PERP"].funding_interval_hours, 8.0);
        assert_eq!(rows["SOL_USDC_PERP"].funding_interval_hours, 1.0);
    }

    // CCXT's sample reply writes fundingInterval as "28800000", so a string reads like a number.
    #[tokio::test]
    async fn reads_a_funding_interval_written_as_a_string() {
        let rest = served(T0).await;
        let mut rows = catalog();
        rows[0]["fundingInterval"] = json!("28800000");
        rest.reply(MARKETS_PATH, rows);

        let rows = Backpack::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows["BTC_USDC_PERP"].funding_interval_hours, 8.0);
    }

    #[tokio::test]
    async fn leaves_out_equity_perpetuals_and_markets_that_are_not_open() {
        let rest = served(T0).await;

        let rows = Backpack::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        let mut keys: Vec<&String> = rows.keys().collect();
        keys.sort();
        assert_eq!(keys, ["BTC_USDC_PERP", "SOL_USDC_PERP", "kPEPE_USDC_PERP"]);
    }

    #[tokio::test]
    async fn reads_a_settlement_already_passed_or_missing_as_unknown() {
        let after = NEXT_HOUR + 2_000;
        let rest = served(after).await;
        let mut rows = mark_prices();
        rows[5]["nextFundingTimestamp"] = Value::Null;
        rest.reply(&mark_path(after), rows);

        let rows = Backpack::with_rest(&rest.url).fetch_round(&http(), after).await.unwrap();

        assert_eq!(rows["BTC_USDC_PERP"].next_funding_at, 0);
        assert_eq!(rows["SOL_USDC_PERP"].next_funding_at, 0);
    }

    #[tokio::test]
    async fn rereads_the_catalog_only_after_an_hour() {
        let rest = served(T0).await;
        let later = T0 + CATALOG_REFRESH_MS;
        rest.reply(&mark_path(T0 + 1_000), mark_prices());
        rest.reply(&mark_path(later), mark_prices());
        let venue = Backpack::with_rest(&rest.url);

        venue.fetch_round(&http(), T0).await.unwrap();
        venue.fetch_round(&http(), T0 + 1_000).await.unwrap();
        venue.fetch_round(&http(), later).await.unwrap();

        let catalog_reads = rest.calls().iter().filter(|call| call.as_str() == MARKETS_PATH).count();
        assert_eq!(catalog_reads, 2);
    }

    #[tokio::test]
    async fn fails_the_round_when_the_first_catalog_read_fails() {
        let rest = MockRest::start().await;
        rest.fail(MARKETS_PATH, 500);
        rest.reply(&mark_path(T0), mark_prices());

        assert!(Backpack::with_rest(&rest.url).fetch_round(&http(), T0).await.is_err());
        assert_eq!(rest.calls(), [MARKETS_PATH]);
    }

    #[tokio::test]
    async fn keeps_the_anchored_set_when_a_later_catalog_read_fails_and_retries_a_minute_on() {
        let (logs, _capture) = capture();
        let rest = served(T0).await;
        let venue = Backpack::with_rest(&rest.url);
        venue.fetch_round(&http(), T0).await.unwrap();

        let later = T0 + CATALOG_REFRESH_MS;
        rest.fail(MARKETS_PATH, 503);
        rest.reply(&mark_path(later), mark_prices());
        let rows = venue.fetch_round(&http(), later).await.unwrap();

        assert_eq!(rows.len(), 3);
        assert_eq!(logs.events("anchored_catalog_failed").len(), 1);
        assert_eq!(venue.anchors.lock().unwrap().catalog_read_at, later - CATALOG_REFRESH_MS + CATALOG_RETRY_MS);
    }

    #[tokio::test]
    async fn fails_the_round_when_the_mark_call_fails() {
        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, catalog());
        rest.fail(&mark_path(T0), 502);

        assert!(Backpack::with_rest(&rest.url).fetch_round(&http(), T0).await.is_err());
    }
}
