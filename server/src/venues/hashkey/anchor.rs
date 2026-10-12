use super::{Hashkey, ID};
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_bytes, get_json};
use crate::venues::wire;
use futures_util::future::try_join_all;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::Duration;

pub const EXCHANGE_INFO_PATH: &str = "/api/v1/exchangeInfo";

// Bulk, keyed by the index name, such as BTCUSDT for BTCUSDT-PERPETUAL, which is the contract's underlying plus its index field.
const INDEX_PATH: &str = "/quote/v1/index";

// One contract per call, since no bulk mark exists.
const MARK_PATH: &str = "/quote/v1/markPrice?symbol=";

// Bulk, and the call refuses a request with no timestamp.
// It is documented with an API key header, yet answered with no key on 2026-10-09.
const FUNDING_PATH: &str = "/api/v1/futures/fundingRate?timestamp=";

// The rate moves about once a minute and the settlement time once in 8 h, so a read every 10 s keeps a round at three calls.
const FUNDING_REFRESH_MS: i64 = 10_000;

// Listings change, so the index names are reread every hour.
const TABLE_REFRESH_MS: i64 = 60 * 60 * 1000;

// No interval is on the wire, and the docs and every settled row of the history call say 8 h at 00, 08 and 16 UTC.
const FUNDING_INTERVAL_HOURS: f64 = 8.0;

#[derive(Default)]
pub struct Anchors {
    index_name_of: HashMap<String, String>, // contract id to its index name
    table_read_at: i64,                     // Unix ms, 0 = never, so the first round reads the table
    funding: HashMap<String, Funding>,      // contract id to its upcoming funding
    funding_read_at: i64,
}

#[derive(Clone, Copy)]
struct Funding {
    rate: f64,
    next_at: i64,
}

impl AnchorVenue for Hashkey {
    // No per IP limit is published, a 429 comes before a 418 ban, and the docs' only stated wait is one minute.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(60)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        // A failure here fails the round and leaves the read time alone, so the next round tries again.
        let table_due = ts - self.anchors.lock().unwrap().table_read_at >= TABLE_REFRESH_MS;
        if table_due {
            let info: ExchangeInfo = get_json(http, &format!("{}{EXCHANGE_INFO_PATH}", self.rest)).await?;
            let mut index_name_of = HashMap::with_capacity(info.contracts.len());
            for contract in info.contracts {
                index_name_of.insert(contract.symbol, format!("{}{}", contract.underlying, contract.index));
            }
            tracing::info!(event = "instruments_read", venue = ID, contracts = index_name_of.len());
            let mut anchors = self.anchors.lock().unwrap();
            anchors.index_name_of = index_name_of;
            anchors.table_read_at = ts;
        }

        let funding_due = ts - self.anchors.lock().unwrap().funding_read_at >= FUNDING_REFRESH_MS;
        if funding_due {
            let rows: Vec<FundingRow> = get_json(http, &format!("{}{FUNDING_PATH}{ts}", self.rest)).await?;
            let mut funding = HashMap::with_capacity(rows.len());
            for row in rows {
                let next_at = if row.next_settle_time.is_finite() { row.next_settle_time as i64 } else { 0 };
                funding.insert(row.symbol, Funding { rate: row.rate, next_at });
            }
            let mut anchors = self.anchors.lock().unwrap();
            anchors.funding = funding;
            anchors.funding_read_at = ts;
        }

        let index_url = format!("{}{INDEX_PATH}", self.rest);
        let (index, marks) = tokio::try_join!(
            get_json::<IndexReply>(http, &index_url),
            try_join_all(self.tracked.iter().map(|id| self.mark(http, id))),
        )?;

        let anchors = self.anchors.lock().unwrap();
        let mut rows = AnchorMap::with_capacity(marks.len());
        for (id, mark) in self.tracked.iter().zip(marks) {
            // An unknown or delisted id answers 200 with an empty body, and a contract with no index name has no index row.
            let Some(mark) = mark else {
                continue;
            };
            let Some(&index) = anchors.index_name_of.get(id).and_then(|name| index.index.get(name)) else {
                continue;
            };
            let Some(funding) = anchors.funding.get(id) else {
                continue;
            };

            rows.insert(
                id.clone(),
                AnchorRow {
                    index,
                    mark,
                    funding_rate: funding.rate,
                    funding_interval_hours: FUNDING_INTERVAL_HOURS,
                    next_funding_at: funding.next_at,
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

impl Hashkey {
    async fn mark(&self, http: &reqwest::Client, id: &str) -> anyhow::Result<Option<f64>> {
        let url = format!("{}{MARK_PATH}{id}", self.rest);
        let body = get_bytes(http, &url).await?;
        if body.iter().all(|byte| byte.is_ascii_whitespace()) {
            return Ok(None);
        }

        let reply: MarkReply = serde_json::from_slice(&body)?;
        Ok(Some(reply.price))
    }
}

#[derive(Deserialize)]
struct ExchangeInfo {
    #[serde(default)]
    contracts: Vec<Contract>,
}

#[derive(Deserialize)]
struct Contract {
    #[serde(default)]
    symbol: String, // "BTCUSDT-PERPETUAL"
    #[serde(default)]
    underlying: String, // "BTC"
    #[serde(default)]
    index: String, // "USDT"
}

#[derive(Deserialize)]
struct IndexReply {
    #[serde(default, deserialize_with = "index_table")]
    index: HashMap<String, f64>, // "BTCUSDT" to the price, and `edp`, the 10 minute average, is not read
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct MarkReply {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    price: f64,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FundingRow {
    #[serde(default)]
    symbol: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    rate: f64, // the fraction for the upcoming settlement at nextSettleTime
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_settle_time: f64, // Unix ms as a string
}

// Each index price is a decimal string, and one that is not a number reads as NaN, which the poller rejects.
fn index_table<'de, D: serde::Deserializer<'de>>(deserializer: D) -> Result<HashMap<String, f64>, D::Error> {
    let raw: HashMap<String, String> = Deserialize::deserialize(deserializer)?;
    let mut table = HashMap::with_capacity(raw.len());
    for (name, price) in raw {
        table.insert(name, wire::number(&price));
    }
    Ok(table)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, market, tracked};
    use serde_json::{Value, json};

    const T0: i64 = 1_791_570_630_000;

    // Replies captured live on 2026-10-09 at 18:30 UTC.
    fn exchange_info() -> Value {
        json!({ "timezone": "UTC", "site": "BMU", "symbols": [], "contracts": [
            { "symbol": "BTCUSDT-PERPETUAL", "status": "TRADING", "quoteAsset": "USDT", "inverse": false, "index": "USDT",
              "marginToken": "USDT", "contractMultiplier": "0.001", "underlying": "BTC" },
            { "symbol": "ETHUSDT-PERPETUAL", "status": "TRADING", "quoteAsset": "USDT", "inverse": false, "index": "USDT",
              "marginToken": "USDT", "contractMultiplier": "0.001", "underlying": "ETH" },
        ]})
    }

    fn index() -> Value {
        json!({
            "index": { "ETHUSDT": "2484.0975", "BTCUSDT": "82507.4975", "BTCUSD": "82436.753693054069725443" },
            "edp": { "ETHUSDT": "2485.5336614", "BTCUSDT": "82551.03414809", "BTCUSD": "82477.10060439" },
        })
    }

    fn btc_mark() -> Value {
        json!({ "exchangeId": 301, "symbolId": "BTCUSDT-PERPETUAL", "price": "82488.4", "time": 1791570627000_i64 })
    }

    fn eth_mark() -> Value {
        json!({ "exchangeId": 301, "symbolId": "ETHUSDT-PERPETUAL", "price": "2481.92", "time": 1791570628000_i64 })
    }

    fn funding() -> Value {
        json!([
            { "symbol": "BTCUSDT-PERPETUAL", "rate": "0.0001", "nextSettleTime": "1791590400000" },
            { "symbol": "ETHUSDT-PERPETUAL", "rate": "-0.000321174414339164", "nextSettleTime": "1791590400000" },
        ])
    }

    fn mark_path(id: &str) -> String {
        format!("{MARK_PATH}{id}")
    }

    fn funding_path(ts: i64) -> String {
        format!("{FUNDING_PATH}{ts}")
    }

    fn venue(rest: &MockRest, ids: &[&str]) -> Hashkey {
        let mut markets = Vec::new();
        for id in ids {
            markets.push(market(ID, id, &id[..3], "USDT", true));
        }
        Hashkey::with_rest(&tracked(&markets), &rest.url)
    }

    async fn rest_with_every_reply() -> MockRest {
        let rest = MockRest::start().await;
        rest.reply(EXCHANGE_INFO_PATH, exchange_info());
        rest.reply(INDEX_PATH, index());
        rest.reply(&mark_path("BTCUSDT-PERPETUAL"), btc_mark());
        rest.reply(&mark_path("ETHUSDT-PERPETUAL"), eth_mark());
        rest.reply(&funding_path(T0), funding());
        rest
    }

    #[test]
    fn polls_every_second_and_pauses_a_minute_on_a_rate_limit() {
        let venue = Hashkey::new(&[]);

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(60));
    }

    #[tokio::test]
    async fn joins_the_index_by_its_name_the_mark_per_contract_and_the_funding_with_an_eight_hour_interval() {
        let rest = rest_with_every_reply().await;
        let venue = venue(&rest, &["BTCUSDT-PERPETUAL", "ETHUSDT-PERPETUAL"]);

        let rows = venue.fetch_round(&http(), T0).await.unwrap();

        assert_eq!(
            rows["BTCUSDT-PERPETUAL"],
            AnchorRow {
                index: 82507.4975,
                mark: 82488.4,
                funding_rate: 0.0001,
                funding_interval_hours: 8.0,
                next_funding_at: 1_791_590_400_000,
                ts: None,
            }
        );
        assert_eq!(rows["ETHUSDT-PERPETUAL"].index, 2484.0975);
        assert_eq!(rows["ETHUSDT-PERPETUAL"].mark, 2481.92);
        assert_eq!(rows["ETHUSDT-PERPETUAL"].funding_rate, -0.000321174414339164);
        assert_eq!(rows.len(), 2);
    }

    #[tokio::test]
    async fn reads_the_table_hourly_and_the_funding_every_ten_seconds_while_index_and_mark_go_every_round() {
        let rest = rest_with_every_reply().await;
        let venue = venue(&rest, &["BTCUSDT-PERPETUAL"]);
        let later = T0 + 9_999;
        let funding_again = T0 + 10_000;
        rest.reply(&funding_path(funding_again), json!([{ "symbol": "BTCUSDT-PERPETUAL", "rate": "0.00005", "nextSettleTime": "1791590400000" }]));

        venue.fetch_round(&http(), T0).await.unwrap();
        venue.fetch_round(&http(), later).await.unwrap();
        let rows = venue.fetch_round(&http(), funding_again).await.unwrap();

        let calls = rest.calls();
        let count = |path: &str| calls.iter().filter(|call| call.as_str() == path).count();
        assert_eq!(count(EXCHANGE_INFO_PATH), 1);
        assert_eq!(count(INDEX_PATH), 3);
        assert_eq!(count(&mark_path("BTCUSDT-PERPETUAL")), 3);
        assert_eq!(count(&funding_path(T0)), 1);
        assert_eq!(count(&funding_path(funding_again)), 1);
        assert_eq!(calls.len(), 9);
        assert_eq!(rows["BTCUSDT-PERPETUAL"].funding_rate, 0.00005);
    }

    // The delisted BTCUSD-PERPETUAL still answered a mark on 2026-09-23, while an unknown id answers 200 with an empty body.
    #[tokio::test]
    async fn leaves_out_a_contract_whose_mark_is_empty_or_whose_index_name_is_unknown() {
        let rest = rest_with_every_reply().await;
        rest.fail(&mark_path("NOPEUSDT-PERPETUAL"), 200); // status 200 with an empty body
        rest.reply(&mark_path("SOLUSDT-PERPETUAL"), json!({ "exchangeId": 301, "symbolId": "SOLUSDT-PERPETUAL", "price": "150.1", "time": 1791570627000_i64 }));
        let venue = venue(&rest, &["NOPEUSDT-PERPETUAL", "SOLUSDT-PERPETUAL", "BTCUSDT-PERPETUAL"]);

        let rows = venue.fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTCUSDT-PERPETUAL"]);
    }

    #[tokio::test]
    async fn rereads_the_index_names_after_an_hour() {
        let rest = rest_with_every_reply().await;
        let venue = venue(&rest, &["BTCUSDT-PERPETUAL"]);
        let hour_later = T0 + 60 * 60 * 1000;
        rest.reply(&funding_path(hour_later - 1), funding());
        rest.reply(&funding_path(hour_later), funding());

        venue.fetch_round(&http(), T0).await.unwrap();
        venue.fetch_round(&http(), hour_later - 1).await.unwrap();
        venue.fetch_round(&http(), hour_later).await.unwrap();

        let calls = rest.calls();
        assert_eq!(calls.iter().filter(|call| call.as_str() == EXCHANGE_INFO_PATH).count(), 2);
    }

    #[tokio::test]
    async fn fails_the_round_and_reads_the_table_again_when_the_table_call_fails() {
        let rest = rest_with_every_reply().await;
        rest.fail(EXCHANGE_INFO_PATH, 500);
        let venue = venue(&rest, &["BTCUSDT-PERPETUAL"]);

        assert!(venue.fetch_round(&http(), T0).await.is_err());
        rest.reply(EXCHANGE_INFO_PATH, exchange_info());
        let rows = venue.fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows["BTCUSDT-PERPETUAL"].index, 82507.4975);
    }

    #[tokio::test]
    async fn leaves_out_a_contract_with_no_funding_row() {
        let rest = rest_with_every_reply().await;
        rest.reply(&funding_path(T0), json!([{ "symbol": "ETHUSDT-PERPETUAL", "rate": "0.0001", "nextSettleTime": "1791590400000" }]));
        let venue = venue(&rest, &["BTCUSDT-PERPETUAL", "ETHUSDT-PERPETUAL"]);

        let rows = venue.fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["ETHUSDT-PERPETUAL"]);
    }

    // Decision 20 sends 0 for an unknown next funding.
    #[tokio::test]
    async fn sends_zero_for_a_missing_next_settlement() {
        let rest = rest_with_every_reply().await;
        rest.reply(&funding_path(T0), json!([{ "symbol": "BTCUSDT-PERPETUAL", "rate": "0.0001" }]));
        let venue = venue(&rest, &["BTCUSDT-PERPETUAL"]);

        let rows = venue.fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows["BTCUSDT-PERPETUAL"].next_funding_at, 0);
        assert_eq!(rows["BTCUSDT-PERPETUAL"].funding_interval_hours, 8.0);
    }

    #[tokio::test]
    async fn leaves_out_a_contract_whose_index_name_is_missing_from_the_index_reply() {
        let rest = rest_with_every_reply().await;
        rest.reply(INDEX_PATH, json!({ "index": { "ETHUSDT": "2484.0975" }, "edp": { "ETHUSDT": "2485.5336614" } }));
        let venue = venue(&rest, &["BTCUSDT-PERPETUAL", "ETHUSDT-PERPETUAL"]);

        let rows = venue.fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["ETHUSDT-PERPETUAL"]);
    }

    #[tokio::test]
    async fn fails_the_round_and_reads_the_funding_again_when_the_funding_call_fails() {
        let rest = rest_with_every_reply().await;
        rest.fail(&funding_path(T0), 400);
        let venue = venue(&rest, &["BTCUSDT-PERPETUAL"]);

        assert!(venue.fetch_round(&http(), T0).await.is_err());
        rest.reply(&funding_path(T0 + 1_000), funding());
        let rows = venue.fetch_round(&http(), T0 + 1_000).await.unwrap();

        assert_eq!(rows["BTCUSDT-PERPETUAL"].funding_rate, 0.0001);
    }

    #[tokio::test]
    async fn fails_the_round_on_a_rate_limit_answer() {
        let rest = rest_with_every_reply().await;
        rest.fail(&mark_path("BTCUSDT-PERPETUAL"), 429);
        let venue = venue(&rest, &["BTCUSDT-PERPETUAL"]);

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.downcast_ref::<crate::feeds::anchor_poller::RateLimited>().is_some());
    }
}
