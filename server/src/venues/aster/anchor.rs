use super::{Aster, ID};
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::HashMap;

// One call without a symbol returns index, mark, rate and next settlement for every market, at weight 10 a call.
pub const PREMIUM_PATH: &str = "/fapi/v3/premiumIndex";

// The interval per market lives in a separate call, which listed every catalog row on 2026-10-12.
pub const FUNDING_INFO_PATH: &str = "/fapi/v3/fundingInfo";

// The venue changes an interval without notice when a rate hits its cap, so the table is reread every hour.
const FUNDING_INFO_REFRESH_MS: i64 = 60 * 60 * 1000;

// Each index is Binance's market of the same name at weight 1.0 on 2026-10-12, so a route against Binance would judge the leg by Binance's own price.
const SINGLE_SOURCE_INDEX: &[&str] = &["OPENAIUSDT", "ANTHROPICUSDT"];

#[derive(Default)]
pub struct Intervals {
    hours: HashMap<String, f64>, // by symbol
    read_at: i64,                // Unix ms, 0 = never, so the first round reads the table
}

impl AnchorVenue for Aster {
    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let due = ts - self.intervals.lock().unwrap().read_at >= FUNDING_INFO_REFRESH_MS;

        // A failure here fails the round and leaves read_at alone, so the next round tries again.
        if due {
            let info: Vec<FundingInfo> = get_json(http, &format!("{}{FUNDING_INFO_PATH}", self.rest)).await?;
            let mut intervals = self.intervals.lock().unwrap();
            intervals.hours.clear();
            for row in info {
                intervals.hours.insert(row.symbol, row.funding_interval_hours);
            }
            intervals.read_at = ts;
            tracing::info!(event = "funding_intervals_read", venue = ID, symbols = intervals.hours.len());
        }

        let premium: Vec<PremiumIndex> = get_json(http, &format!("{}{PREMIUM_PATH}", self.rest)).await?;

        // The venue documents no default interval, so a market the table does not list has no row until the next read.
        let intervals = self.intervals.lock().unwrap();
        let mut rows = AnchorMap::with_capacity(premium.len());
        for row in premium {
            if SINGLE_SOURCE_INDEX.contains(&row.symbol.as_str()) {
                continue;
            }
            let Some(&interval) = intervals.hours.get(&row.symbol) else {
                continue;
            };
            rows.insert(
                row.symbol,
                AnchorRow {
                    index: row.index_price,
                    mark: row.mark_price,
                    funding_rate: row.last_funding_rate,
                    funding_interval_hours: interval,
                    next_funding_at: row.next_funding_time as i64,
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

// One row of premiumIndex without a symbol, which also lists 153 symbols of products outside the order book catalog.
#[derive(Deserialize)]
struct PremiumIndex {
    #[serde(default)]
    symbol: String,
    #[serde(rename = "markPrice", default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64, // the median of the funding basis, the 5 minute basis and the last price
    #[serde(rename = "indexPrice", default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    // the running estimate for the coming settlement despite the name, as a fraction
    #[serde(rename = "lastFundingRate", default = "wire::nan", deserialize_with = "wire::num")]
    last_funding_rate: f64,
    #[serde(rename = "nextFundingTime", default = "wire::nan", deserialize_with = "wire::num")]
    next_funding_time: f64, // Unix ms, on the market's interval grid in UTC
}

#[derive(Deserialize)]
struct FundingInfo {
    symbol: String,
    #[serde(rename = "fundingIntervalHours", deserialize_with = "wire::num")]
    funding_interval_hours: f64, // 8, 4 or 1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};
    use std::time::Duration;

    const T0: i64 = 1_791_845_298_000;

    // Rows captured live on 2026-10-12, with every field the venue sends.
    fn btc_premium() -> Value {
        json!({
            "symbol": "BTCUSDT", "markPrice": "82508.74328986", "indexPrice": "82553.52000000",
            "estimatedSettlePrice": "82631.81881135", "lastFundingRate": "0.00007309", "interestRate": "0.00010000",
            "nextFundingTime": 1791849600000_i64, "time": 1791845298000_i64,
        })
    }

    fn argus_premium() -> Value {
        json!({
            "symbol": "ARGUSUSDT", "markPrice": "0.00852772", "indexPrice": "0.00852806",
            "estimatedSettlePrice": "0.00847574", "lastFundingRate": "0.00001250", "interestRate": "0.00010000",
            "nextFundingTime": 1791846000000_i64, "time": 1791845298000_i64,
        })
    }

    fn openai_premium() -> Value {
        json!({
            "symbol": "OPENAIUSDT", "markPrice": "1680.58357623", "indexPrice": "1675.93000000",
            "estimatedSettlePrice": "1676.39554770", "lastFundingRate": "0.00005000", "interestRate": "0.00005000",
            "nextFundingTime": 1791849600000_i64, "time": 1791845298000_i64,
        })
    }

    fn anthropic_premium() -> Value {
        json!({
            "symbol": "ANTHROPICUSDT", "markPrice": "2016.40445973", "indexPrice": "2015.21470588",
            "estimatedSettlePrice": "2016.33972691", "lastFundingRate": "0.00005000", "interestRate": "0.00005000",
            "nextFundingTime": 1791849600000_i64, "time": 1791845298000_i64,
        })
    }

    fn funding_info(symbol: &str, hours: i64) -> Value {
        json!({
            "symbol": symbol, "interestRate": "0.00010000", "time": 1791845219000_i64,
            "fundingIntervalHours": hours, "fundingFeeCap": 0.02, "fundingFeeFloor": -0.02,
        })
    }

    fn all_funding_info() -> Value {
        json!([
            funding_info("BTCUSDT", 8),
            funding_info("ARGUSUSDT", 1),
            funding_info("OPENAIUSDT", 8),
            funding_info("ANTHROPICUSDT", 8),
        ])
    }

    fn poller(rest: &MockRest) -> Aster {
        Aster::with_rest(&rest.url)
    }

    #[test]
    fn polls_every_second_and_pauses_a_minute_on_a_rate_limit() {
        let venue = Aster::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(60));
    }

    #[tokio::test]
    async fn maps_a_premium_index_row_and_takes_the_interval_from_funding_info() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_INFO_PATH, all_funding_info());
        rest.reply(PREMIUM_PATH, json!([btc_premium(), argus_premium()]));

        let rows = poller(&rest).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(
            rows["BTCUSDT"],
            AnchorRow {
                index: 82553.52,
                mark: 82508.74328986,
                funding_rate: 0.00007309,
                funding_interval_hours: 8.0,
                next_funding_at: 1791849600000,
                ts: None,
            }
        );
        assert_eq!(rows["ARGUSUSDT"].funding_interval_hours, 1.0);
        assert_eq!(rows["ARGUSUSDT"].next_funding_at, 1791846000000);
    }

    #[tokio::test]
    async fn leaves_out_the_two_markets_whose_index_is_one_binance_market() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_INFO_PATH, all_funding_info());
        rest.reply(PREMIUM_PATH, json!([openai_premium(), btc_premium(), anthropic_premium()]));

        let rows = poller(&rest).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTCUSDT"]);
    }

    #[tokio::test]
    async fn leaves_out_a_market_the_interval_table_does_not_list() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_INFO_PATH, json!([funding_info("BTCUSDT", 8)]));
        rest.reply(PREMIUM_PATH, json!([btc_premium(), argus_premium()]));

        let rows = poller(&rest).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTCUSDT"]);
    }

    #[tokio::test]
    async fn reads_the_interval_table_on_the_first_round_and_then_once_an_hour() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_INFO_PATH, all_funding_info());
        rest.reply(PREMIUM_PATH, json!([btc_premium()]));
        let venue = poller(&rest);

        venue.fetch_round(&http(), T0).await.unwrap();
        venue.fetch_round(&http(), T0 + 1_000).await.unwrap();
        venue.fetch_round(&http(), T0 + 60 * 60 * 1000).await.unwrap();

        assert_eq!(
            rest.calls(),
            [FUNDING_INFO_PATH, PREMIUM_PATH, PREMIUM_PATH, FUNDING_INFO_PATH, PREMIUM_PATH]
        );
    }

    #[tokio::test]
    async fn retries_the_interval_table_on_the_next_round_after_it_fails() {
        let rest = MockRest::start().await;
        rest.reply(PREMIUM_PATH, json!([btc_premium()]));
        let venue = poller(&rest);

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();
        assert!(error.to_string().contains("404"), "{error:#}");

        rest.reply(FUNDING_INFO_PATH, all_funding_info());
        let rows = venue.fetch_round(&http(), T0 + 1_000).await.unwrap();

        assert_eq!(rows["BTCUSDT"].funding_interval_hours, 8.0);
    }

    #[tokio::test]
    async fn fails_the_round_when_the_host_fails() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_INFO_PATH, all_funding_info());
        rest.fail(PREMIUM_PATH, 500);

        assert!(poller(&rest).fetch_round(&http(), T0).await.is_err());
    }
}
