use super::Globe;
use super::markets::{Contract, is_trading};
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use std::time::Duration;

// One call returns index, mark, rate and next settlement for every perpetual, and the loader reads it too.
pub const CONTRACTS_PATH: &str = "/api/v1/ticker/contracts";

// The REST reply has no interval, and the socket's product-detail read funding_period 28800 s on every contract, see docs/profiles/globe/rest.md section 3.
const FUNDING_INTERVAL_HOURS: f64 = 8.0;

impl AnchorVenue for Globe {
    // The published limit is 1 request per second, and Globe republishes mark and index about once a second.
    fn poll_every(&self) -> Duration {
        Duration::from_secs(2)
    }

    // No refusal status and no Retry-After are documented, and persistent excess can block the IP, so the pause is a whole minute.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(60)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let contracts: Vec<Contract> = get_json(http, &format!("{}{CONTRACTS_PATH}", self.rest)).await?;

        // The index basket is not published, and the help article names only outside spot venues, so no row is told apart as a self index.
        let mut rows = AnchorMap::with_capacity(contracts.len());
        for contract in contracts {
            if !is_trading(&contract) {
                continue;
            }

            rows.insert(
                contract.instrument,
                AnchorRow {
                    index: contract.index_price,
                    mark: contract.mark_price,
                    funding_rate: contract.funding_rate / 100.0,
                    funding_interval_hours: FUNDING_INTERVAL_HOURS,
                    next_funding_at: next_settlement(contract.next_funding_time),
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

// A time that is missing or not positive is no settlement.
fn next_settlement(ms: f64) -> i64 {
    if ms.is_finite() && ms > 0.0 { ms as i64 } else { 0 }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::feeds::anchor_poller::RateLimited;
    use crate::venues::testing::{MockRest, http};
    use serde_json::{Value, json};

    const T0: i64 = 1_791_569_818_000;

    // Rows captured live on 2026-10-09 at 18:16 UTC, without ohlc, tags and most of the volume fields.
    fn btc_row() -> Value {
        json!({
            "product_type": "perpetual", "product_status": "Active", "name": "Bitcoin", "instrument": "BTC-PERP",
            "best_bid": { "price": 82550.0, "volume": 0.0003 }, "best_ask": { "price": 82567.0, "volume": 0.0001 },
            "base_symbol": "BTC", "quote_symbol": "USD", "contract_price": 0.0001, "contract_type": "Vanilla",
            "funding_rate": 0.0, "mark_price": 82554.018, "index_price": 82570.003, "open_interest": 4271466,
            "next_funding_time": 1791576000000_i64, "max_leverage": 100, "early_access": false,
        })
    }

    fn trb_row() -> Value {
        json!({
            "product_type": "perpetual", "product_status": "Active", "name": "Tellor", "instrument": "TRB-PERP",
            "base_symbol": "TRB", "quote_symbol": "USD", "contract_price": 0.1, "contract_type": "Vanilla",
            "funding_rate": -0.05333333333333334, "mark_price": 19.01059, "index_price": 19.05961,
            "next_funding_time": 1791576000000_i64, "max_leverage": 20, "early_access": false,
        })
    }

    fn pepe_row() -> Value {
        json!({
            "product_type": "perpetual", "product_status": "Active", "name": "Pepe", "instrument": "PEPE-PERP",
            "base_symbol": "PEPE", "quote_symbol": "USD", "contract_price": 1000000.0, "contract_type": "Vanilla",
            "funding_rate": 0.0, "mark_price": 3.91302e-06, "index_price": 3.91508e-06,
            "next_funding_time": 1791576000000_i64, "max_leverage": 20, "early_access": false,
        })
    }

    fn iota_suspended() -> Value {
        json!({
            "product_type": "perpetual", "product_status": "Suspended", "name": "IOTA", "instrument": "IOTA-PERP",
            "base_symbol": "IOTA", "quote_symbol": "USD", "contract_price": 10.0, "contract_type": "Vanilla",
            "funding_rate": 0.0, "mark_price": 0.050604, "index_price": 0.050604,
            "next_funding_time": 1791576000000_i64, "max_leverage": 20, "early_access": false,
        })
    }

    async fn poll(body: Value) -> (MockRest, anyhow::Result<AnchorMap>) {
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, body);
        let rows = Globe::with_rest(&rest.url).fetch_round(&http(), T0).await;
        (rest, rows)
    }

    #[test]
    fn polls_every_two_seconds_and_pauses_a_minute_on_a_rate_limit() {
        let venue = Globe::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(2));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(60));
    }

    #[tokio::test]
    async fn maps_every_active_row_of_the_one_call_with_its_rate_read_from_percent_and_an_eight_hour_interval() {
        let (rest, rows) = poll(json!([btc_row(), trb_row(), pepe_row()])).await;
        let rows = rows.unwrap();

        assert_eq!(rest.calls(), [CONTRACTS_PATH]);
        assert_eq!(
            rows["BTC-PERP"],
            AnchorRow {
                index: 82570.003,
                mark: 82554.018,
                funding_rate: 0.0,
                funding_interval_hours: 8.0,
                next_funding_at: 1791576000000,
                ts: None,
            }
        );
        assert!((rows["TRB-PERP"].funding_rate - -0.0005333333333333334).abs() < 1e-15);
        assert_eq!(rows["TRB-PERP"].funding_interval_hours, 8.0);
        assert_eq!(rows["PEPE-PERP"].mark, 3.91302e-06);
        assert_eq!(rows["PEPE-PERP"].index, 3.91508e-06);
    }

    #[tokio::test]
    async fn leaves_out_a_suspended_contract() {
        let (_rest, rows) = poll(json!([iota_suspended(), btc_row()])).await;

        assert_eq!(rows.unwrap().keys().collect::<Vec<_>>(), ["BTC-PERP"]);
    }

    #[tokio::test]
    async fn reads_a_missing_next_funding_time_as_unknown() {
        let mut row = btc_row();
        row.as_object_mut().unwrap().remove("next_funding_time");

        let (_rest, rows) = poll(json!([row])).await;

        assert_eq!(rows.unwrap()["BTC-PERP"].next_funding_at, 0);
    }

    #[tokio::test]
    async fn never_fills_a_missing_index_with_the_mark() {
        let mut row = btc_row();
        row.as_object_mut().unwrap().remove("index_price");

        let (_rest, rows) = poll(json!([row])).await;
        let row = &rows.unwrap()["BTC-PERP"];

        // The poller counts a NaN index as a missing row.
        assert!(row.index.is_nan());
        assert_eq!(row.mark, 82554.018);
    }

    #[tokio::test]
    async fn fails_the_round_on_an_error_body_and_reads_a_429_as_a_rate_limit() {
        // The answer to an unknown instrument, as the profile captured it on 2026-09-23, stands in for any error object.
        let (_rest, rows) = poll(json!({ "error": "invalid-instrument", "details": "NOPE-PERP" })).await;
        assert!(format!("{:#}", rows.unwrap_err()).contains("error decoding response body"));

        let rest = MockRest::start().await;
        rest.fail(CONTRACTS_PATH, 429);
        let error = Globe::with_rest(&rest.url).fetch_round(&http(), T0).await.unwrap_err();
        assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");
    }
}
