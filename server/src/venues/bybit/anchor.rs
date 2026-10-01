use super::Bybit;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::time::Duration;

// One call per market family returns every contract with index, mark, rate, next settlement, interval and cap.
const LINEAR_PATH: &str = "/v5/market/tickers?category=linear";
const INVERSE_PATH: &str = "/v5/market/tickers?category=inverse";

impl AnchorVenue for Bybit {
    // The linear reply was 630 KB and its download alone reached 850 ms at one hertz on 2026-09-10.
    fn poll_every(&self) -> Duration {
        Duration::from_secs(2)
    }

    // A 403 means too many requests, and the venue asks for a ten minute silence before the next one.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(10 * 60)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let linear_url = format!("{}{LINEAR_PATH}", self.rest);
        let inverse_url = format!("{}{INVERSE_PATH}", self.rest);
        let (linear, inverse) = tokio::try_join!(
            tickers(http, self.has_linear, &linear_url),
            tickers(http, self.has_inverse, &inverse_url),
        )?;

        let mut rows = AnchorMap::with_capacity(linear.len() + inverse.len());
        for ticker in linear.into_iter().chain(inverse) {
            // A dated future shares the reply with empty funding fields, and it is never a tracked market.
            if ticker.funding_rate.is_empty() || ticker.funding_interval_hour.is_empty() {
                continue;
            }

            rows.insert(
                ticker.symbol,
                AnchorRow {
                    index: ticker.index_price,
                    mark: ticker.mark_price,
                    funding_rate: wire::number(&ticker.funding_rate),
                    funding_interval_hours: wire::number(&ticker.funding_interval_hour),
                    next_funding_at: wire::number(&ticker.next_funding_time) as i64,
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

async fn tickers(http: &reqwest::Client, tracked: bool, url: &str) -> anyhow::Result<Vec<Ticker>> {
    if !tracked {
        return Ok(Vec::new());
    }

    let reply: TickersReply = get_json(http, url).await?;
    if reply.ret_code != 0 {
        anyhow::bail!("retCode {}: {}", reply.ret_code, reply.ret_msg);
    }
    Ok(reply.result.list)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct TickersReply {
    ret_code: i64, // 0 on success
    #[serde(default)]
    ret_msg: String,
    #[serde(default)]
    result: TickersResult,
}

#[derive(Deserialize, Default)]
struct TickersResult {
    #[serde(default)]
    list: Vec<Ticker>,
}

// Every number is a decimal string.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ticker {
    #[serde(default)]
    symbol: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
    #[serde(default)]
    funding_rate: String, // "" on a dated future
    #[serde(default)]
    next_funding_time: String, // Unix ms, "0" on a dated future
    #[serde(default)]
    funding_interval_hour: String, // "1", "4" or "8", "" on a dated future
}

#[cfg(test)]
mod tests {
    // Ported case for case from old_ts_server/src/venues/bybit/anchor.spec.ts.

    use super::*;
    use crate::venues::bybit::ID;
    use crate::venues::testing::{MockRest, http, market, tracked};
    use serde_json::{Value, json};

    const T0: i64 = 1_789_015_942_967;

    // Shapes captured live on 2026-09-10, cut down to the fields the poller reads plus a few it ignores.
    fn soph_ticker() -> Value {
        json!({
            "symbol": "SOPHUSDT",
            "lastPrice": "0.004129",
            "indexPrice": "0.004148",
            "markPrice": "0.004136",
            "fundingRate": "-0.00102581",
            "nextFundingTime": "1789027200000",
            "bid1Price": "0.004128",
            "ask1Price": "0.004131",
            "fundingIntervalHour": "4",
            "fundingCap": "0.02",
        })
    }

    fn dated_ticker() -> Value {
        json!({
            "symbol": "BTCUSDT-11SEP26",
            "indexPrice": "78320.7",
            "markPrice": "78302.8",
            "fundingRate": "",
            "nextFundingTime": "0",
            "fundingIntervalHour": "",
            "fundingCap": "",
        })
    }

    fn btc_inverse_ticker() -> Value {
        json!({
            "symbol": "BTCUSD",
            "indexPrice": "78151.67",
            "markPrice": "78110.19",
            "fundingRate": "0.00005986",
            "nextFundingTime": "1789027200000",
            "fundingIntervalHour": "8",
            "fundingCap": "0.005",
        })
    }

    fn reply(category: &str, list: Value, ret_code: i64) -> Value {
        json!({
            "retCode": ret_code,
            "retMsg": if ret_code == 0 { "OK" } else { "params error" },
            "result": { "category": category, "list": list },
            "time": T0,
        })
    }

    fn poller(rest: &MockRest, linear: &[&str], inverse: &[&str]) -> Bybit {
        let mut markets = Vec::new();
        for id in linear {
            markets.push(market(ID, id, &id[..3], "USDT", true));
        }
        for id in inverse {
            markets.push(market(ID, id, &id[..3], "USD", false));
        }
        Bybit::with_rest(&tracked(&markets), &rest.url)
    }

    #[tokio::test]
    async fn polls_every_two_seconds_and_pauses_ten_minutes_on_a_rate_limit() {
        let rest = MockRest::start().await;
        let venue = poller(&rest, &["SOPHUSDT"], &[]);

        assert_eq!(venue.poll_every(), Duration::from_secs(2));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(600));
    }

    #[tokio::test]
    async fn maps_a_linear_ticker_with_the_interval_and_next_settlement_it_carries() {
        let rest = MockRest::start().await;
        rest.reply(LINEAR_PATH, reply("linear", json!([soph_ticker()]), 0));

        let rows = poller(&rest, &["SOPHUSDT"], &[]).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(
            rows["SOPHUSDT"],
            AnchorRow {
                index: 0.004148,
                mark: 0.004136,
                funding_rate: -0.00102581,
                funding_interval_hours: 4.0,
                next_funding_at: 1789027200000,
                ts: None,
            }
        );
    }

    #[tokio::test]
    async fn leaves_out_the_dated_futures_that_share_the_reply() {
        let rest = MockRest::start().await;
        rest.reply(LINEAR_PATH, reply("linear", json!([dated_ticker(), soph_ticker()]), 0));

        let rows = poller(&rest, &["SOPHUSDT"], &[]).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["SOPHUSDT"]);
    }

    #[tokio::test]
    async fn calls_the_inverse_family_only_when_an_inverse_market_is_tracked() {
        let linear_only = MockRest::start().await;
        linear_only.reply(LINEAR_PATH, reply("linear", json!([soph_ticker()]), 0));
        poller(&linear_only, &["SOPHUSDT"], &[]).fetch_round(&http(), T0).await.unwrap();
        assert_eq!(linear_only.calls(), [LINEAR_PATH]);

        let both = MockRest::start().await;
        both.reply(LINEAR_PATH, reply("linear", json!([soph_ticker()]), 0));
        both.reply(INVERSE_PATH, reply("inverse", json!([btc_inverse_ticker()]), 0));
        let rows = poller(&both, &["SOPHUSDT"], &["BTCUSD"]).fetch_round(&http(), T0).await.unwrap();
        // The two calls run at once, so their order at the host is not fixed.
        let mut calls = both.calls();
        calls.sort();
        assert_eq!(calls, [INVERSE_PATH, LINEAR_PATH]);
        assert_eq!(rows["BTCUSD"].funding_interval_hours, 8.0);
    }

    #[tokio::test]
    async fn fails_the_round_on_a_venue_error_code() {
        let rest = MockRest::start().await;
        rest.reply(LINEAR_PATH, reply("linear", json!([]), 10001));

        let error = poller(&rest, &["SOPHUSDT"], &[]).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.to_string().contains("retCode 10001"), "{error:#}");
    }
}
