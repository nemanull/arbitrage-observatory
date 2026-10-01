use super::Bitget;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::HashMap;

// Two classic v2 calls per product type answer for every contract at once.
// The tickers carry index and mark, and the funding call carries rate, interval and next settlement.
const TICKERS_PATH: &str = "/api/v2/mix/market/tickers?productType=";
const FUNDING_PATH: &str = "/api/v2/mix/market/current-fund-rate?productType=";

const SUCCESS_CODE: &str = "00000";

impl AnchorVenue for Bitget {
    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let (usdt, usdc) = tokio::try_join!(
            self.product_type(http, self.has_usdt, "USDT-FUTURES"),
            self.product_type(http, self.has_usdc, "USDC-FUTURES"),
        )?;

        let mut rows = AnchorMap::with_capacity(usdt.len() + usdc.len());
        rows.extend(usdt);
        rows.extend(usdc);
        Ok(rows)
    }
}

impl Bitget {
    async fn product_type(&self, http: &reqwest::Client, tracked: bool, product_type: &str) -> anyhow::Result<AnchorMap> {
        if !tracked {
            return Ok(AnchorMap::new());
        }

        let tickers_url = format!("{}{TICKERS_PATH}{product_type}", self.rest);
        let funding_url = format!("{}{FUNDING_PATH}{product_type}", self.rest);
        let (tickers, funding) = tokio::try_join!(
            get_json::<Reply<Ticker>>(http, &tickers_url),
            get_json::<Reply<FundingRate>>(http, &funding_url),
        )?;
        check(&tickers, "tickers")?;
        check(&funding, "current-fund-rate")?;

        let mut ticker_of = HashMap::with_capacity(tickers.data.len());
        for ticker in tickers.data {
            ticker_of.insert(ticker.symbol.clone(), ticker);
        }

        // The funding call also lists pre-listing and test symbols with no ticker row, and those fall out on the join.
        // Rate and next settlement come from the same reply, because at a settlement the tickers rate trailed the funding call by a poll.
        let mut rows = AnchorMap::with_capacity(funding.data.len());
        for f in funding.data {
            let Some(ticker) = ticker_of.get(&f.symbol) else {
                continue;
            };
            rows.insert(
                f.symbol,
                AnchorRow {
                    index: ticker.index_price,
                    mark: ticker.mark_price,
                    funding_rate: f.funding_rate,
                    funding_interval_hours: f.funding_rate_interval,
                    next_funding_at: f.next_update as i64,
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

fn check<T>(reply: &Reply<T>, call: &str) -> anyhow::Result<()> {
    if reply.code != SUCCESS_CODE {
        anyhow::bail!("{call} code {}: {}", reply.code, reply.msg);
    }
    Ok(())
}

#[derive(Deserialize)]
pub struct Reply<T> {
    pub code: String, // "00000" on success
    #[serde(default)]
    pub msg: String,
    #[serde(default = "Vec::new")]
    pub data: Vec<T>,
}

// Every number is a decimal string.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Ticker {
    #[serde(default)]
    symbol: String, // "BTCUSDT", or "BTCPERP" on USDC-M
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64, // equal to the last trade on a third to a half of the contracts
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct FundingRate {
    #[serde(default)]
    symbol: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // the running rate for the upcoming settlement, as a fraction
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate_interval: f64, // hours: 1, 4 or 8
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_update: f64, // Unix ms
}

#[cfg(test)]
mod tests {
    // Ported case for case from old_ts_server/src/venues/bitget/anchor.spec.ts.

    use super::*;
    use crate::venues::bitget::ID;
    use crate::venues::testing::{MockRest, http, market, tracked};
    use serde_json::{Value, json};
    use std::time::Duration;

    const T0: i64 = 1_789_456_276_980;
    const USDT_TICKERS: &str = "/api/v2/mix/market/tickers?productType=USDT-FUTURES";
    const USDT_FUNDING: &str = "/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES";
    const USDC_TICKERS: &str = "/api/v2/mix/market/tickers?productType=USDC-FUTURES";
    const USDC_FUNDING: &str = "/api/v2/mix/market/current-fund-rate?productType=USDC-FUTURES";

    // Shapes captured live on 2026-09-15, cut down to the fields the poller reads plus a few it ignores.
    fn btc_ticker() -> Value {
        json!({
            "symbol": "BTCUSDT", "lastPr": "77202.1", "askPr": "77202.1", "bidPr": "77202", "ts": "1789456276886",
            "indexPrice": "77237.976", "fundingRate": "0.0001", "markPrice": "77202.1",
        })
    }

    fn btc_funding() -> Value {
        json!({
            "symbol": "BTCUSDT", "fundingRate": "0.0001", "fundingRateInterval": "8", "nextUpdate": "1789459200000",
            "minFundingRate": "-0.003", "maxFundingRate": "0.003",
        })
    }

    // MTLUSDT, a 1 hour contract, one second after its 19:00 UTC settlement, where the tickers call still carried the settled rate.
    fn mtl_ticker() -> Value {
        let mut row = btc_ticker();
        row["symbol"] = json!("MTLUSDT");
        row["indexPrice"] = json!("0.2704133333333333");
        row["markPrice"] = json!("0.2689");
        row["fundingRate"] = json!("-0.000457");
        row
    }

    fn mtl_funding() -> Value {
        json!({
            "symbol": "MTLUSDT", "fundingRate": "-0.000449", "fundingRateInterval": "1", "nextUpdate": "1789502400000",
            "minFundingRate": "-0.02", "maxFundingRate": "0.02",
        })
    }

    // A pre-listing symbol the funding call lists and the tickers call does not.
    fn play_funding() -> Value {
        json!({
            "symbol": "PLAYUSDT", "fundingRate": "0.00005", "fundingRateInterval": "4", "nextUpdate": "1789516800000",
            "minFundingRate": null, "maxFundingRate": null,
        })
    }

    fn btc_perp_ticker() -> Value {
        let mut row = btc_ticker();
        row["symbol"] = json!("BTCPERP");
        row["indexPrice"] = json!("75897.218");
        row["markPrice"] = json!("75862.3");
        row["fundingRate"] = json!("0.00004");
        row
    }

    fn btc_perp_funding() -> Value {
        let mut row = btc_funding();
        row["symbol"] = json!("BTCPERP");
        row["fundingRate"] = json!("0.00004");
        row
    }

    fn reply(data: Value, code: &str) -> Value {
        let msg = if code == SUCCESS_CODE { "success" } else { "Parameter NOPE-FUTURES cannot be empty" };
        json!({ "code": code, "msg": msg, "requestTime": T0, "data": data })
    }

    fn poller(rest: &MockRest, markets: &[(&str, &str)]) -> Bitget {
        let mut listed = Vec::new();
        for &(id, quote) in markets {
            listed.push(market(ID, id, &id[..3], quote, true));
        }
        Bitget::with_rest(&tracked(&listed), &rest.url)
    }

    #[tokio::test]
    async fn polls_every_second() {
        let rest = MockRest::start().await;

        assert_eq!(poller(&rest, &[("BTCUSDT", "USDT")]).poll_every(), Duration::from_secs(1));
    }

    #[tokio::test]
    async fn joins_index_and_mark_from_the_tickers_with_rate_interval_and_next_settlement_from_the_funding_call() {
        let rest = MockRest::start().await;
        rest.reply(USDT_TICKERS, reply(json!([btc_ticker(), mtl_ticker()]), SUCCESS_CODE));
        rest.reply(USDT_FUNDING, reply(json!([btc_funding(), mtl_funding()]), SUCCESS_CODE));

        let rows = poller(&rest, &[("BTCUSDT", "USDT"), ("MTLUSDT", "USDT")]).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(
            rows["BTCUSDT"],
            AnchorRow {
                index: 77237.976,
                mark: 77202.1,
                funding_rate: 0.0001,
                funding_interval_hours: 8.0,
                next_funding_at: 1789459200000,
                ts: None,
            }
        );
        assert_eq!(
            rows["MTLUSDT"],
            AnchorRow {
                index: 0.2704133333333333,
                mark: 0.2689,
                funding_rate: -0.000449,
                funding_interval_hours: 1.0,
                next_funding_at: 1789502400000,
                ts: None,
            }
        );
    }

    #[tokio::test]
    async fn leaves_out_a_symbol_that_only_one_of_the_two_replies_carries() {
        let rest = MockRest::start().await;
        rest.reply(USDT_TICKERS, reply(json!([btc_ticker(), mtl_ticker()]), SUCCESS_CODE));
        rest.reply(USDT_FUNDING, reply(json!([play_funding(), btc_funding()]), SUCCESS_CODE));

        let rows = poller(&rest, &[("BTCUSDT", "USDT")]).fetch_round(&http(), T0).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTCUSDT"]);
    }

    #[tokio::test]
    async fn calls_the_usdc_m_pair_only_while_a_usdc_market_is_tracked() {
        let usdt_only = MockRest::start().await;
        usdt_only.reply(USDT_TICKERS, reply(json!([btc_ticker()]), SUCCESS_CODE));
        usdt_only.reply(USDT_FUNDING, reply(json!([btc_funding()]), SUCCESS_CODE));
        poller(&usdt_only, &[("BTCUSDT", "USDT")]).fetch_round(&http(), T0).await.unwrap();
        let mut calls = usdt_only.calls();
        calls.sort();
        assert_eq!(calls, [USDT_FUNDING, USDT_TICKERS]);

        let both = MockRest::start().await;
        both.reply(USDT_TICKERS, reply(json!([btc_ticker()]), SUCCESS_CODE));
        both.reply(USDT_FUNDING, reply(json!([btc_funding()]), SUCCESS_CODE));
        both.reply(USDC_TICKERS, reply(json!([btc_perp_ticker()]), SUCCESS_CODE));
        both.reply(USDC_FUNDING, reply(json!([btc_perp_funding()]), SUCCESS_CODE));
        let rows = poller(&both, &[("BTCUSDT", "USDT"), ("BTCPERP", "USDC")]).fetch_round(&http(), T0).await.unwrap();
        // The calls run at once, so their order at the host is not fixed.
        let mut calls = both.calls();
        calls.sort();
        assert_eq!(calls, [USDC_FUNDING, USDT_FUNDING, USDC_TICKERS, USDT_TICKERS]);
        assert_eq!(rows["BTCPERP"].mark, 75862.3);
    }

    #[tokio::test]
    async fn fails_the_round_on_a_code_other_than_00000() {
        let rest = MockRest::start().await;
        rest.reply(USDT_TICKERS, reply(json!([btc_ticker()]), SUCCESS_CODE));
        rest.reply(USDT_FUNDING, reply(json!([]), "40019"));

        let error = poller(&rest, &[("BTCUSDT", "USDT")]).fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.to_string().contains("current-fund-rate code 40019"), "{error:#}");
    }
}
