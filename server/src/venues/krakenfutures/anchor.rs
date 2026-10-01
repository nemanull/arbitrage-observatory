use super::KrakenFutures;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;

// One public call returns every contract, and public endpoints on this host have no rate limit cost.
const TICKERS_PATH: &str = "/derivatives/api/v3/tickers";

// Kraken accrues funding through the hour at the period's rate, realises it on the hour, and publishes no next funding time, so both are derived here.
const INTERVAL_HOURS: f64 = 1.0;
const HOUR_MS: i64 = 60 * 60 * 1000;

impl AnchorVenue for KrakenFutures {
    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let reply: TickersReply = get_json(http, &format!("{}{TICKERS_PATH}", self.rest)).await?;
        if reply.result != "success" {
            anyhow::bail!("result {}: {}", reply.result, reply.error);
        }

        let next_funding_at = (ts + HOUR_MS - 1).div_euclid(HOUR_MS) * HOUR_MS;
        let mut rows = AnchorMap::with_capacity(reply.tickers.len());

        for ticker in reply.tickers {
            // Dated contracts share the reply without funding fields, and a perpetual can lack them in the seconds after listing.
            let priced = !ticker.mark_price.is_nan() && !ticker.index_price.is_nan() && !ticker.funding_rate.is_nan();
            if ticker.tag != "perpetual" || !priced {
                continue;
            }

            rows.insert(
                ticker.symbol,
                AnchorRow {
                    index: ticker.index_price,
                    mark: ticker.mark_price,
                    // The running hour's rate in quote currency per contract, and dividing by the mark gives the fraction every other venue publishes.
                    funding_rate: ticker.funding_rate / ticker.mark_price,
                    funding_interval_hours: INTERVAL_HOURS,
                    next_funding_at,
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

#[derive(Deserialize)]
struct TickersReply {
    #[serde(default)]
    result: String, // "success" or "error"
    #[serde(default)]
    error: String,
    #[serde(default)]
    tickers: Vec<Ticker>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ticker {
    #[serde(default)]
    symbol: String,
    #[serde(default)]
    tag: String, // "perpetual", "month", "quarter" or "week"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // absolute, in quote currency per contract, for the running hour
}

#[cfg(test)]
mod tests {
    // Ported case for case from old_ts_server/src/venues/krakenfutures/anchor.spec.ts.

    use super::*;
    use crate::venues::testing::{MockRest, http};
    use chrono::DateTime;
    use serde_json::{Value, json};

    fn ms(rfc3339: &str) -> i64 {
        DateTime::parse_from_rfc3339(rfc3339).unwrap().timestamp_millis()
    }

    // Shape captured live on 2026-09-10 at 04:52 UTC.
    fn xbt_ticker() -> Value {
        json!({
            "symbol": "PF_XBTUSD", "last": 78285, "lastTime": "2026-09-10T04:52:29.08081Z", "tag": "perpetual",
            "pair": "XBT:USD", "markPrice": 78288.74778169378, "bid": 78291, "bidSize": 0.0003, "ask": 78292,
            "askSize": 0.2219, "vol24h": 6338.5123, "openInterest": 2105.9165, "fundingRate": 1.444418177964,
            "fundingRatePrediction": 1.37670583456525, "suspended": false, "indexPrice": 78279.34,
            "postOnly": false, "change24h": -1.1,
        })
    }

    fn dated_ticker() -> Value {
        json!({ "symbol": "FF_XBTUSD_260925", "tag": "quarter", "markPrice": 78500.1, "indexPrice": 78279.34, "suspended": false })
    }

    fn unpriced_ticker() -> Value {
        json!({ "symbol": "PF_NEWUSD", "tag": "perpetual", "suspended": false, "postOnly": true })
    }

    fn reply(tickers: Value, result: &str) -> Value {
        let mut body = json!({ "result": result, "serverTime": "2026-09-10T04:52:40.047Z", "tickers": tickers });
        if result != "success" {
            body["error"] = json!("apiLimitExceeded");
        }
        body
    }

    async fn poll(body: Value) -> anyhow::Result<AnchorMap> {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, body);
        KrakenFutures::with_rest(&rest.url).fetch_round(&http(), ms("2026-09-10T04:52:40.047Z")).await
    }

    #[tokio::test]
    async fn turns_the_absolute_rate_into_a_fraction_of_the_mark_and_settles_on_the_next_whole_hour() {
        let rows = poll(reply(json!([xbt_ticker()]), "success")).await.unwrap();

        assert_eq!(
            rows["PF_XBTUSD"],
            AnchorRow {
                index: 78279.34,
                mark: 78288.74778169378,
                funding_rate: 1.444418177964 / 78288.74778169378,
                funding_interval_hours: 1.0,
                next_funding_at: ms("2026-09-10T05:00:00.000Z"),
                ts: None,
            }
        );
        assert!((rows["PF_XBTUSD"].funding_rate - 0.0000184499).abs() < 1e-10);
    }

    #[tokio::test]
    async fn leaves_out_dated_contracts_and_perpetuals_the_venue_has_not_priced() {
        let rows = poll(reply(json!([dated_ticker(), unpriced_ticker(), xbt_ticker()]), "success")).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["PF_XBTUSD"]);
    }

    #[tokio::test]
    async fn fails_the_round_on_a_venue_error() {
        let error = poll(reply(json!([]), "error")).await.unwrap_err();

        assert!(error.to_string().contains("apiLimitExceeded"), "{error:#}");
    }

    #[tokio::test]
    async fn settles_a_round_on_the_hour_at_that_hour() {
        let rest = MockRest::start().await;
        rest.reply(TICKERS_PATH, reply(json!([xbt_ticker()]), "success"));
        let on_the_hour = ms("2026-09-10T05:00:00.000Z");

        let rows = KrakenFutures::with_rest(&rest.url).fetch_round(&http(), on_the_hour).await.unwrap();

        assert_eq!(rows["PF_XBTUSD"].next_funding_at, on_the_hour);
    }
}
