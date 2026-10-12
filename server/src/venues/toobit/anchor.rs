use super::markets::{EXCHANGE_INFO_PATH, ExchangeInfo};
use super::{ID, Toobit};
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::HashMap;

// Three bulk calls carry every column for every contract, and none took over 1 s from this host.
// The weights are 1, 10 by CCXT's count, and 1, so a round a second spends 720 of the 3,000 a minute.
pub const INDEX_PATH: &str = "/quote/v1/index";
pub const MARK_PATH: &str = "/quote/v1/markPrice";
pub const FUNDING_PATH: &str = "/api/v1/futures/fundingRate";

// The index reply is keyed by index token, which 31 contracts spell differently from their own id, so the catalog's table joins it.
// The tracked markets never change during a run, so an hourly reread only follows a basket that moves to another token.
const INDEX_TOKENS_REFRESH_MS: i64 = 60 * 60 * 1000;

#[derive(Default)]
pub struct IndexTokens {
    of: HashMap<String, String>, // contract id to index token, "1000PEPE-SWAP-USDT" to "PEPEUSDT"
    read_at: i64,                // Unix ms, 0 = never, so the first round reads the table
}

impl AnchorVenue for Toobit {
    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let due = ts - self.index_tokens.lock().unwrap().read_at >= INDEX_TOKENS_REFRESH_MS;

        // A failure here fails the round and leaves read_at alone, so the next round tries again.
        if due {
            let info: ExchangeInfo = get_json(http, &format!("{}{EXCHANGE_INFO_PATH}", self.rest)).await?;
            let mut of = HashMap::with_capacity(info.contracts.len());
            for contract in info.contracts {
                if !contract.index_token.is_empty() {
                    of.insert(contract.symbol, contract.index_token);
                }
            }
            tracing::info!(event = "index_tokens_read", venue = ID, contracts = of.len());
            *self.index_tokens.lock().unwrap() = IndexTokens { of, read_at: ts };
        }

        let index_url = format!("{}{INDEX_PATH}", self.rest);
        let mark_url = format!("{}{MARK_PATH}", self.rest);
        let funding_url = format!("{}{FUNDING_PATH}", self.rest);
        let (index, marks, funding) = tokio::try_join!(
            get_json::<IndexReply>(http, &index_url),
            get_json::<Vec<MarkPrice>>(http, &mark_url),
            get_json::<Vec<FundingRate>>(http, &funding_url),
        )?;

        let mut mark_of = HashMap::with_capacity(marks.len());
        for row in marks {
            mark_of.insert(row.symbol_id, row.price);
        }

        // The demo TBV_ rows and the delisted ones have no index token in the catalog, so they fall out on the join.
        // No basket names Toobit itself, so no contract is left out as a self index.
        let tokens = self.index_tokens.lock().unwrap();
        let mut rows = AnchorMap::with_capacity(funding.len());
        let mut settling = 0;
        for f in funding {
            let Some(index) = tokens.of.get(&f.symbol).and_then(|token| index.index.get(token)) else {
                continue;
            };
            let Some(&mark) = mark_of.get(&f.symbol) else {
                continue;
            };

            // For about 75 s after a settlement the row still names the instant just past and the rate just charged.
            // That rate is not the next one, so the row waits for the reply to roll over.
            // A time that is missing or not positive is unknown, sent as 0.
            let next_funding_at = if f.next_funding_time > 0.0 { f.next_funding_time as i64 } else { 0 };
            if next_funding_at > 0 && next_funding_at <= ts {
                settling += 1;
                continue;
            }

            rows.insert(
                f.symbol,
                AnchorRow {
                    index: wire::number(index),
                    mark,
                    funding_rate: f.rate,
                    funding_interval_hours: hours(&f.period),
                    next_funding_at,
                    ts: None,
                },
            );
        }

        if settling > 0 {
            tracing::debug!(event = "funding_settling", venue = ID, rows = settling);
        }

        Ok(rows)
    }
}

// "8H", "4H" or "1H", and anything else is NaN, which the poller rejects.
fn hours(period: &str) -> f64 {
    period.strip_suffix('H').map_or(f64::NAN, wire::number)
}

#[derive(Deserialize)]
struct IndexReply {
    #[serde(default)]
    index: HashMap<String, String>, // index token to a decimal string, "PEPEUSDT" to "0.00000712"
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkPrice {
    #[serde(default)]
    symbol_id: String, // "BTC-SWAP-USDT"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    price: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FundingRate {
    #[serde(default)]
    symbol: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    rate: f64, // a fraction per period, for the next settlement
    #[serde(default)]
    period: String, // "8H"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_funding_time: f64, // Unix ms as a string
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::feeds::anchor_poller::RateLimited;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};
    use std::time::Duration;

    const T0: i64 = 1_791_567_617_000; // 2026-10-09 17:40:17 UTC, when the rows below were captured
    const HOUR_MS: i64 = 3_600_000;

    // Trimmed from the exchangeInfo reply of 2026-10-09: only the fields the table reads, and a spot pair.
    fn exchange_info() -> Value {
        json!({
            "symbols": [{ "symbol": "BTCUSDT", "baseAsset": "BTC", "quoteAsset": "USDT" }],
            "contracts": [
                { "symbol": "BTC-SWAP-USDT", "status": "TRADING", "contractMultiplier": "0.001", "indexToken": "BTCUSDT" },
                { "symbol": "1000PEPE-SWAP-USDT", "status": "TRADING", "contractMultiplier": "1", "indexToken": "PEPEUSDT" },
                { "symbol": "KAIA-SWAP-USDT", "status": "TRADING", "contractMultiplier": "1", "indexToken": "KAIAUSDT" },
            ],
        })
    }

    // The three bulk replies captured live on 2026-10-09 at 17:40 UTC, cut to a few rows.
    // The demo TBV_ row and the delisted REN-SWAP-USDT are in the mark and funding replies and not in the catalog.
    fn index() -> Value {
        json!({
            "index": { "BTCUSDT": "82688.35717391", "PEPEUSDT": "0.003907", "KAIAUSDT": "0.05325568", "AAPLUSDT": "335.46331583" },
            "edp": { "BTCUSDT": "82683.05311232", "PEPEUSDT": "0.00390298", "KAIAUSDT": "0.05326497", "AAPLUSDT": "335.42078798" },
        })
    }

    fn marks() -> Value {
        json!([
            { "exchangeId": 301, "symbolId": "BTC-SWAP-USDT", "price": "82650.9", "time": 1791567616000_i64 },
            { "exchangeId": 301, "symbolId": "1000PEPE-SWAP-USDT", "price": "0.0039043", "time": 1791567616000_i64 },
            { "exchangeId": 301, "symbolId": "KAIA-SWAP-USDT", "price": "0.05235", "time": 1791567616000_i64 },
            { "exchangeId": 301, "symbolId": "TBV_BTC-SWAP-TBV_USDT", "price": "82650.7", "time": 1791567616000_i64 },
            { "exchangeId": 301, "symbolId": "REN-SWAP-USDT", "price": "0.05197", "time": 1791567616000_i64 },
        ])
    }

    fn funding() -> Value {
        json!([
            { "symbol": "BTC-SWAP-USDT", "rate": "0.00003336", "period": "8H", "nextFundingTime": "1791590400000",
              "interest": "0.0001", "fundingRateCap": "0.0024", "fundingRateFloor": "-0.0024" },
            { "symbol": "1000PEPE-SWAP-USDT", "rate": "0.000035176772357559", "period": "8H", "nextFundingTime": "1791590400000",
              "interest": "0.0001", "fundingRateCap": "0.02", "fundingRateFloor": "-0.02" },
            { "symbol": "KAIA-SWAP-USDT", "rate": "-0.00240562", "period": "1H", "nextFundingTime": "1791568800000",
              "interest": "0.0001", "fundingRateCap": "0.0199996666", "fundingRateFloor": "-0.0199996666" },
            { "symbol": "TBV_BTC-SWAP-TBV_USDT", "rate": "0.000031210247292046", "period": "8H", "nextFundingTime": "1791590400000",
              "interest": "0.0001", "fundingRateCap": "0.02", "fundingRateFloor": "-0.02" },
        ])
    }

    async fn rest() -> MockRest {
        let rest = MockRest::start().await;
        rest.reply(EXCHANGE_INFO_PATH, exchange_info());
        rest.reply(INDEX_PATH, index());
        rest.reply(MARK_PATH, marks());
        rest.reply(FUNDING_PATH, funding());
        rest
    }

    fn sorted(mut calls: Vec<String>) -> Vec<String> {
        calls.sort();
        calls
    }

    #[test]
    fn polls_every_second_and_pauses_a_minute_on_a_rate_limit() {
        let venue = Toobit::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(60));
    }

    #[tokio::test]
    async fn joins_the_index_through_the_catalog_index_token_and_the_rest_by_contract() {
        let (logs, _capture) = capture();
        let rest = rest().await;

        let rows = Toobit::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(
            rows["BTC-SWAP-USDT"],
            AnchorRow {
                index: 82688.35717391,
                mark: 82650.9,
                funding_rate: 0.00003336,
                funding_interval_hours: 8.0,
                next_funding_at: 1791590400000,
                ts: None,
            }
        );
        assert_eq!(rows["1000PEPE-SWAP-USDT"].index, 0.003907);
        assert_eq!(rows["1000PEPE-SWAP-USDT"].mark, 0.0039043);
        assert_eq!(rows["KAIA-SWAP-USDT"].funding_interval_hours, 1.0);
        assert_eq!(rows["KAIA-SWAP-USDT"].funding_rate, -0.00240562);
        assert_eq!(logs.events("index_tokens_read")[0].number("contracts"), 3.0);
    }

    #[tokio::test]
    async fn leaves_out_the_demo_and_delisted_rows_that_the_catalog_does_not_list() {
        let rest = rest().await;

        let rows = Toobit::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        let mut ids: Vec<&String> = rows.keys().collect();
        ids.sort();
        assert_eq!(ids, ["1000PEPE-SWAP-USDT", "BTC-SWAP-USDT", "KAIA-SWAP-USDT"]);
    }

    #[tokio::test]
    async fn leaves_out_a_row_that_still_names_the_settlement_just_past() {
        let rest = rest().await;

        // 30 s after the 18:00 settlement of the hourly KAIA, whose row still names 18:00 for about 75 s.
        let rows = Toobit::with_rest(&rest.url).fetch_round(&http(), 1_791_568_830_000).await.unwrap();

        assert!(!rows.contains_key("KAIA-SWAP-USDT"));
        assert!(rows.contains_key("BTC-SWAP-USDT"));
    }

    #[tokio::test]
    async fn reads_the_index_token_table_once_an_hour() {
        let rest = rest().await;
        let venue = Toobit::with_rest(&rest.url);

        venue.fetch_round(&http(), T0).await.unwrap();
        venue.fetch_round(&http(), T0 + 1_000).await.unwrap();
        venue.fetch_round(&http(), T0 + HOUR_MS).await.unwrap();

        let calls = rest.calls();
        assert_eq!(calls.iter().filter(|path| path.as_str() == EXCHANGE_INFO_PATH).count(), 2);
        assert_eq!(sorted(calls[..4].to_vec()), sorted(vec![
            EXCHANGE_INFO_PATH.to_string(), INDEX_PATH.to_string(), MARK_PATH.to_string(), FUNDING_PATH.to_string(),
        ]));
        assert_eq!(sorted(calls[4..7].to_vec()), sorted(vec![INDEX_PATH.to_string(), MARK_PATH.to_string(), FUNDING_PATH.to_string()]));
    }

    #[tokio::test]
    async fn fails_the_round_while_the_index_token_table_cannot_be_read_and_reads_it_on_the_next() {
        let rest = rest().await;
        rest.fail(EXCHANGE_INFO_PATH, 500);
        let venue = Toobit::with_rest(&rest.url);

        assert!(venue.fetch_round(&http(), T0).await.is_err());

        rest.reply(EXCHANGE_INFO_PATH, exchange_info());
        assert_eq!(venue.fetch_round(&http(), T0 + 1_000).await.unwrap().len(), 3);
    }

    #[tokio::test]
    async fn leaves_out_a_contract_that_the_mark_or_the_index_reply_does_not_carry() {
        let rest = rest().await;
        let mut marks = marks();
        marks.as_array_mut().unwrap().remove(0);
        rest.reply(MARK_PATH, marks);
        let mut index = index();
        index["index"].as_object_mut().unwrap().remove("PEPEUSDT");
        rest.reply(INDEX_PATH, index);

        let rows = Toobit::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["KAIA-SWAP-USDT"]);
    }

    #[tokio::test]
    async fn sends_a_missing_next_funding_time_as_unknown() {
        let rest = rest().await;
        let mut funding = funding();
        funding[0].as_object_mut().unwrap().remove("nextFundingTime");
        rest.reply(FUNDING_PATH, funding);

        let rows = Toobit::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows["BTC-SWAP-USDT"].next_funding_at, 0);
        assert_eq!(rows["BTC-SWAP-USDT"].funding_rate, 0.00003336);
    }

    #[test]
    fn reads_the_period_in_hours_and_anything_else_as_nan() {
        assert_eq!(hours("8H"), 8.0);
        assert_eq!(hours("4H"), 4.0);
        assert!(hours("8h").is_nan());
        assert!(hours("").is_nan());
    }

    // A mark call for an unknown symbol answered HTTP 200 with an empty body on 2026-09-22.
    #[tokio::test]
    async fn fails_the_round_on_an_empty_mark_body() {
        let rest = rest().await;
        rest.reply(MARK_PATH, json!(""));

        let error = Toobit::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();

        assert!(format!("{error:#}").contains("error decoding response body"), "{error:#}");
    }

    // Toobit documents 429 with code -1003 for its weight limit and 403 for its firewall.
    #[tokio::test]
    async fn reads_a_429_or_a_403_as_a_rate_limit() {
        for status in [429, 403] {
            let rest = rest().await;
            rest.fail(FUNDING_PATH, status);

            let error = Toobit::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();

            assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");
        }
    }
}
