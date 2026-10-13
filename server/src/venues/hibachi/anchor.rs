use super::Hibachi;
use super::markets::Contract;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::time::Duration;

// One call carries index, mark and the running funding estimate of every contract ever listed, the closed ones with null prices.
pub const INVENTORY_PATH: &str = "/market/inventory";

// Funding settles every hour on the whole UTC hour, and the reply names neither the interval nor the next settlement.
const FUNDING_INTERVAL_HOURS: f64 = 1.0;
const HOUR_MS: i64 = 3_600_000;

impl AnchorVenue for Hibachi {
    // The published limit is 350 requests per 10 s per IP, and no refusal or Retry-After was ever seen, so a pause of one window is enough.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let reply: Inventory = get_json(http, &format!("{}{INVENTORY_PATH}", self.rest)).await?;

        // The floor plus one keeps a poll that lands on the hour pointing at the next settlement.
        let next_funding_at = (ts.div_euclid(HOUR_MS) + 1) * HOUR_MS;
        let mut rows = AnchorMap::with_capacity(reply.markets.len());

        for entry in reply.markets {
            let Some(info) = entry.info else {
                continue;
            };
            if !trading(&entry.contract) {
                continue;
            }

            rows.insert(
                entry.contract.symbol,
                AnchorRow {
                    index: info.spot_price,
                    mark: info.mark_price,
                    funding_rate: info.estimated_funding_rate,
                    funding_interval_hours: FUNDING_INTERVAL_HOURS,
                    next_funding_at,
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

// A paused market keeps a frozen index, as the FX markets do over the weekend, which the engine would read as current.
// So a row goes out only while the same reply shows the market LIVE, and symbolStatus, undocumented and OPEN everywhere on 2026-10-12, is read as a pause when it says anything else.
fn trading(contract: &Contract) -> bool {
    contract.status == "LIVE" && contract.symbol_status.as_deref().is_none_or(|status| status == "OPEN")
}

#[derive(Deserialize)]
struct Inventory {
    #[serde(default)]
    markets: Vec<Entry>,
}

#[derive(Deserialize)]
struct Entry {
    contract: Contract,
    info: Option<Info>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Info {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    spot_price: f64, // the index, the average of the Pyth and Stork prices
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64, // the median of two index based prices and the last trade
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    estimated_funding_rate: f64, // the running estimate for the coming hour, as a fraction per hour
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::feeds::anchor_poller::RateLimited;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    // 22:48:20 UTC on 2026-10-12, so the next settlement is 23:00.
    const T0: i64 = 1_791_845_300_000;
    const NEXT_HOUR: i64 = 1_791_846_000_000;

    // Entries of /market/inventory captured live at 22:48 UTC on 2026-10-12, cut to three of 67 and to a few contract fields.
    fn btc() -> Value {
        json!({
            "contract": { "category": "CRYPTO", "id": 2, "settlementSymbol": "USDT", "status": "LIVE", "symbol": "BTC/USDT-P",
                          "symbolStatus": "OPEN", "tickSize": "0.1", "underlyingSymbol": "BTC" },
            "info": { "bestAskPrice": "82537.00000", "bestBidPrice": "82536.90000", "category": null, "estimatedFundingRate": "0.000054",
                      "markPrice": "82537.10000", "openInterestQuantity": "41.6913617521", "price24hAgo": "84120.10000",
                      "priceLatest": "82537.00000", "spotPrice": "82502.45202", "tags": [], "volume24h": "11328811.457633" },
        })
    }

    fn xag() -> Value {
        json!({
            "contract": { "category": "FX", "id": 65, "nextCloseTimestamp": "1791925200", "settlementSymbol": "USDT", "status": "LIVE",
                          "symbol": "XAG/USDT-P", "symbolStatus": "OPEN", "tickSize": "0.01", "underlyingSymbol": "XAG" },
            "info": { "bestAskPrice": "60.390000", "bestBidPrice": "60.370000", "category": null, "estimatedFundingRate": "0.000104",
                      "markPrice": "60.382089", "spotPrice": "60.293285", "tags": [] },
        })
    }

    fn fartcoin_closed() -> Value {
        json!({
            "contract": { "category": "CRYPTO", "id": 4, "marketCloseTimestamp": "1763391600", "settlementSymbol": "USDT",
                          "status": "CLOSED", "symbol": "FARTCOIN/USDT-P", "symbolStatus": "OPEN", "underlyingSymbol": "FARTCOIN" },
            "info": { "bestAskPrice": null, "bestBidPrice": null, "category": null, "estimatedFundingRate": null, "markPrice": null,
                      "openInterestQuantity": null, "price24hAgo": null, "priceLatest": null, "spotPrice": null, "tags": [], "volume24h": null },
        })
    }

    fn inventory(markets: Value) -> Value {
        json!({ "assets": [], "chains": [], "feeConfig": {}, "markets": markets, "tradingTiers": [] })
    }

    async fn poll(rest: &MockRest, ts: i64) -> anyhow::Result<AnchorMap> {
        Hibachi::with_rest(&rest.url).fetch_round(&http(), ts).await
    }

    #[test]
    fn polls_every_second_and_pauses_one_ten_second_window_on_a_rate_limit() {
        let venue = Hibachi::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(10));
    }

    #[tokio::test]
    async fn maps_the_index_mark_and_hourly_estimate_of_each_live_contract_with_the_next_whole_hour() {
        let rest = MockRest::start().await;
        rest.reply(INVENTORY_PATH, inventory(json!([btc(), xag()])));

        let rows = poll(&rest, T0).await.unwrap();

        assert_eq!(rest.calls(), [INVENTORY_PATH]);
        assert_eq!(
            rows["BTC/USDT-P"],
            AnchorRow {
                index: 82502.45202,
                mark: 82537.1,
                funding_rate: 0.000054,
                funding_interval_hours: 1.0,
                next_funding_at: NEXT_HOUR,
                ts: None,
            }
        );
        assert_eq!((rows["XAG/USDT-P"].index, rows["XAG/USDT-P"].mark), (60.293285, 60.382089));
        assert_eq!(rows["XAG/USDT-P"].funding_rate, 0.000104);
    }

    #[tokio::test]
    async fn a_poll_on_the_hour_points_at_the_next_hour() {
        let rest = MockRest::start().await;
        rest.reply(INVENTORY_PATH, inventory(json!([btc()])));

        let on_the_hour = poll(&rest, NEXT_HOUR).await.unwrap();
        let just_before = poll(&rest, NEXT_HOUR - 1).await.unwrap();

        assert_eq!(on_the_hour["BTC/USDT-P"].next_funding_at, NEXT_HOUR + HOUR_MS);
        assert_eq!(just_before["BTC/USDT-P"].next_funding_at, NEXT_HOUR);
    }

    #[tokio::test]
    async fn leaves_out_a_closed_contract_with_its_null_prices() {
        let rest = MockRest::start().await;
        rest.reply(INVENTORY_PATH, inventory(json!([fartcoin_closed(), btc()])));

        let rows = poll(&rest, T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTC/USDT-P"]);
    }

    // Every contract read LIVE and OPEN on 2026-10-12, so these rows are the XAG capture with the documented PAUSED status and another symbolStatus.
    #[tokio::test]
    async fn leaves_out_a_paused_contract_and_one_whose_symbol_status_is_not_open() {
        let rest = MockRest::start().await;
        let mut paused = xag();
        paused["contract"]["status"] = json!("PAUSED");
        let mut halted = btc();
        halted["contract"]["symbolStatus"] = json!("CLOSED");
        rest.reply(INVENTORY_PATH, inventory(json!([paused, halted])));

        let rows = poll(&rest, T0).await.unwrap();

        assert!(rows.is_empty());
    }

    #[tokio::test]
    async fn keeps_a_live_contract_that_carries_no_symbol_status() {
        let rest = MockRest::start().await;
        let mut row = btc();
        row["contract"].as_object_mut().unwrap().remove("symbolStatus");
        rest.reply(INVENTORY_PATH, inventory(json!([row])));

        let rows = poll(&rest, T0).await.unwrap();

        assert_eq!(rows.len(), 1);
    }

    #[tokio::test]
    async fn a_null_price_on_a_live_contract_reads_as_nan_so_the_poller_refuses_the_row() {
        let rest = MockRest::start().await;
        let mut row = btc();
        row["info"]["spotPrice"] = Value::Null;
        row["info"]["markPrice"] = Value::Null;
        rest.reply(INVENTORY_PATH, inventory(json!([row])));

        let rows = poll(&rest, T0).await.unwrap();

        assert!(rows["BTC/USDT-P"].index.is_nan());
        assert!(rows["BTC/USDT-P"].mark.is_nan());
    }

    // An unknown path answered 200 with an empty body of application/grpc on 2026-10-12.
    #[tokio::test]
    async fn an_empty_body_or_a_failed_call_fails_the_round_and_a_rate_limit_is_rate_limited() {
        let rest = MockRest::start().await;
        rest.fail(INVENTORY_PATH, 200);
        assert!(poll(&rest, T0).await.is_err());

        rest.fail(INVENTORY_PATH, 500);
        assert!(poll(&rest, T0).await.is_err());

        rest.fail(INVENTORY_PATH, 429);
        let error = poll(&rest, T0).await.unwrap_err();
        assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");
    }
}
