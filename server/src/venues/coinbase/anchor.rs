use super::Coinbase;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::time::Duration;

// The public instruments list of Coinbase International Exchange carries the index, the mark and the predicted funding rate of every perpetual in one call.
// Its mark is the median of best bid, best ask and last trade clamped into a band of the index, so a coinbase leg is judged on a mark that carries no averaging.
const INSTRUMENTS_PATH: &str = "/api/v1/instruments";

const NS_PER_MS: f64 = 1_000_000.0;
const HOUR_MS: f64 = 60.0 * 60.0 * 1000.0;

impl AnchorVenue for Coinbase {
    // A round is 0.5 to 0.7 s and the first after a reconnect up to 5 s, so one hertz would skip ticks.
    fn poll_every(&self) -> Duration {
        Duration::from_secs(2)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let instruments: Vec<Instrument> = get_json(http, &format!("{}{INSTRUMENTS_PATH}", self.rest)).await?;
        let mut rows = AnchorMap::with_capacity(instruments.len());

        for instrument in instruments {
            // A delisted entry keeps a frozen quote from its delisting day, and the poller stamps it at arrival, so it would read as fresh.
            let Some(quote) = instrument.quote else {
                continue;
            };
            if instrument.kind != "PERP" || instrument.trading_state == "DELISTED" {
                continue;
            }

            let interval_ms = instrument.funding_interval / NS_PER_MS;
            if !(interval_ms > 0.0) {
                continue;
            }

            // The engine's raw market id is the Advanced product id, which is the INTX symbol plus -INTX.
            rows.insert(
                format!("{}-INTX", instrument.symbol),
                AnchorRow {
                    index: quote.index_price,
                    mark: if quote.mark_price > 0.0 { quote.mark_price } else { 0.0 }, // 0 is the engine's "no mark", and NaN would be refused
                    funding_rate: quote.predicted_funding,
                    funding_interval_hours: interval_ms / HOUR_MS,
                    // INTX publishes no next funding time, and settlements land on the interval's boundary.
                    next_funding_at: ((ts as f64 / interval_ms).ceil() * interval_ms) as i64,
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

#[derive(Deserialize)]
struct Instrument {
    #[serde(default)]
    symbol: String, // "TOWNS-PERP", the Advanced product id without -INTX
    #[serde(rename = "type", default)]
    kind: String, // "PERP" or "SPOT"
    #[serde(default)]
    trading_state: String, // "TRADING", "PAUSED", "DELISTED" and a dozen halt and auction states
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_interval: f64, // nanoseconds, 3600000000000 on every perpetual and 0 on spot
    quote: Option<Quote>,
}

#[derive(Deserialize)]
struct Quote {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    predicted_funding: f64, // the upcoming rate as a fraction per interval, positive means longs pay
}

#[cfg(test)]
mod tests {
    // Ported case for case from old_ts_server/src/venues/coinbase/anchor.spec.ts.

    use super::*;
    use crate::venues::testing::{MockRest, http};
    use chrono::DateTime;
    use serde_json::{Value, json};

    fn ms(rfc3339: &str) -> i64 {
        DateTime::parse_from_rfc3339(rfc3339).unwrap().timestamp_millis()
    }

    // One entry of the INTX instruments list captured live on 2026-09-14, cut down to the fields the poller reads plus a few it ignores.
    fn towns_perp() -> Value {
        json!({
            "instrument_id": "475671915168530442", "symbol": "TOWNS-PERP", "type": "PERP", "mode": "STANDARD",
            "quote_asset_name": "USDC", "quote_increment": "0.000001", "open_interest": "40891892",
            "funding_interval": "3600000000000", "trading_state": "TRADING",
            "quote": {
                "best_bid_price": "0.0016", "best_bid_size": "125000", "best_ask_price": "0.00184", "best_ask_size": "750455",
                "trade_price": "0.001873", "trade_qty": "5535", "index_price": "0.001836", "mark_price": "0.00184",
                "settlement_price": "0.00184", "limit_up": "0.001964", "limit_down": "0.001708",
                "predicted_funding": "-0.000348", "timestamp": "2026-09-14T21:23:11.825Z",
            },
            "underlying_type": "SPOT", "execution_exchange": "COINBASE_INTERNATIONAL_EXCHANGE",
        })
    }

    fn eth_spot() -> Value {
        json!({
            "symbol": "ETH-USDC", "type": "SPOT", "funding_interval": "0", "trading_state": "TRADING",
            "quote": { "index_price": "2558.28", "mark_price": "2558.28", "predicted_funding": "0", "timestamp": "2026-09-14T21:23:11.855Z" },
        })
    }

    // A delisted perpetual keeps a frozen quote from the delisting day, with sizes of 0 and no bid or ask price.
    fn matic_delisted() -> Value {
        json!({
            "symbol": "MATIC-PERP", "type": "PERP", "funding_interval": "3600000000000", "trading_state": "DELISTED",
            "quote": {
                "best_bid_size": "0", "best_ask_size": "0", "trade_price": "0.3973", "index_price": "0.4032",
                "mark_price": "0.3973", "predicted_funding": "-0.000014", "timestamp": "2026-09-03T19:45:52.533Z",
            },
        })
    }

    fn zero_interval_perp() -> Value {
        let mut row = towns_perp();
        row["symbol"] = json!("ZERO-PERP");
        row["funding_interval"] = json!("0");
        row
    }

    fn quoteless_perp() -> Value {
        let mut row = towns_perp();
        row["symbol"] = json!("BARE-PERP");
        row.as_object_mut().unwrap().remove("quote");
        row
    }

    async fn poll(instruments: Value) -> AnchorMap {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, instruments);
        Coinbase::with_rest(&rest.url)
            .fetch_round(&http(), ms("2026-09-14T21:23:12.000Z"))
            .await
            .unwrap()
    }

    #[tokio::test]
    async fn maps_a_trading_perpetual_to_its_index_mark_predicted_rate_and_the_next_hour_boundary_after_ts() {
        let rows = poll(json!([towns_perp()])).await;

        assert_eq!(
            rows["TOWNS-PERP-INTX"],
            AnchorRow {
                index: 0.001836,
                mark: 0.00184,
                funding_rate: -0.000348,
                funding_interval_hours: 1.0,
                next_funding_at: ms("2026-09-14T22:00:00.000Z"),
                ts: None,
            }
        );
    }

    #[tokio::test]
    async fn writes_mark_0_when_mark_price_is_not_positive() {
        let mut instrument = towns_perp();
        instrument["quote"]["mark_price"] = json!("0");

        let rows = poll(json!([instrument])).await;

        assert_eq!(rows["TOWNS-PERP-INTX"].mark, 0.0);
    }

    #[tokio::test]
    async fn leaves_out_spot_delisted_zero_interval_and_quoteless_entries() {
        let rows = poll(json!([eth_spot(), matic_delisted(), zero_interval_perp(), quoteless_perp(), towns_perp()])).await;

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["TOWNS-PERP-INTX"]);
    }

    #[tokio::test]
    async fn polls_every_two_seconds() {
        assert_eq!(Coinbase::new().poll_every(), Duration::from_secs(2));
    }
}
