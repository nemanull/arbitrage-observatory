use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, contract_size, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "Biconomy.com";

// The standard taker of docs/profiles/biconomy/fees.md section 2, equal to tfr on all 316 active contracts on 2026-10-09.
const TAKER_PPM: u32 = 600;

// The futures web app's catalog, with short field names and every contract ever listed, delisted ones as state 3.
// CCXT has no class, and MEXC's detail path answers 404 here.
const DETAIL_PATH: &str = "/future/api/v1/detailV2?client=web";

const LINEAR_QUOTES: &[&str] = &["USDT", "USDC", "USD"];

const DENIED: &[(&str, &str)] = &[];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: DetailReply = get_json(http, &format!("{rest}{DETAIL_PATH}")).await?;
    if !reply.success || reply.code != 0 {
        anyhow::bail!("detailV2 code {}: {}", reply.code, reply.message);
    }

    let markets = parse(&reply.data);
    catalog::finish(ID, NAME, reply.data.len(), markets, DENIED)
}

// Trading perpetuals settled in their quote, which on 2026-10-09 was every row, all USDT.
fn parse(contracts: &[Contract]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in contracts {
        if row.state != 0.0 || row.ft != 1.0 || row.symbol.is_empty() {
            continue;
        }

        let base = currency_code(&row.bc, &[]);
        let quote = currency_code(&row.qc, &[]);
        let settle = currency_code(&row.sc, &[]);
        if base.is_empty() || !LINEAR_QUOTES.contains(&quote.as_str()) || settle != quote {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: contract_size(row.cs),
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct DetailReply {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    code: i64,
    #[serde(default)]
    message: String,
    #[serde(default)]
    data: Vec<Contract>,
}

#[derive(Deserialize)]
struct Contract {
    #[serde(default)]
    symbol: String, // "BTC_USDT", spelled the same as the socket's s
    #[serde(default)]
    bc: String, // base
    #[serde(default)]
    qc: String, // quote
    #[serde(default)]
    sc: String, // settle
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    cs: f64, // coins per contract, the unit of the book's sizes
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    ft: f64, // 1 is a perpetual, the only type listed
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    state: f64, // 0 trading, 3 delisted
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the live detailV2 reply of 2026-10-09 19:36 UTC, plus two made up rows for the families the venue does not list.
    fn contract(symbol: &str, bc: &str, qc: &str, sc: &str, cs: f64, state: i64) -> Value {
        json!({
            "symbol": symbol, "dn": symbol, "bc": bc, "qc": qc, "sc": sc, "ft": 1, "cs": cs, "pu": 0.1, "vu": 1,
            "minV": 1, "maxV": 12091000, "tfr": 0.0006, "mfr": 0.0002, "io": ["OKEX_FUTURE", "BINANCE"],
            "state": state, "in": false, "ih": false, "ihd": false,
        })
    }

    fn detail() -> Value {
        json!({ "success": true, "code": 0, "data": [
            contract("BTC_USDT", "BTC", "USDT", "USDT", 0.0001, 0),
            contract("PEPE_USDT", "PEPE", "USDT", "USDT", 10000000.0, 0),
            contract("NVDA_USDT", "NVDA", "USDT", "USDT", 0.01, 0),
            contract("LRC_USDT", "LRC", "USDT", "USDT", 1.0, 3),
            contract("BTC_USD", "BTC", "USD", "BTC", 100.0, 0),
            contract("ETH_BTC", "ETH", "BTC", "BTC", 1.0, 0),
        ]})
    }

    fn parsed() -> Vec<Market> {
        let reply: DetailReply = serde_json::from_value(detail()).unwrap();
        parse(&reply.data)
    }

    #[test]
    fn keeps_trading_linear_contracts_and_drops_delisted_inverse_and_coin_quoted_rows() {
        assert_eq!(raw_ids(&parsed()), ["BTC_USDT", "PEPE_USDT", "NVDA_USDT"]);
    }

    #[test]
    fn reads_the_contract_size_from_cs_and_sets_the_standard_taker() {
        let markets = parsed();

        assert_eq!(markets[0].base, "BTC");
        assert_eq!(markets[0].quote, "USDT");
        assert!(markets[0].linear);
        assert_eq!(markets[0].contract_size, 0.0001);
        assert_eq!(markets[1].contract_size, 10_000_000.0);
        assert_eq!(markets[0].taker_ppm, 600);
        assert_eq!(markets[0].price_scale, 1.0);
    }

    #[test]
    fn drops_a_row_that_is_not_a_perpetual() {
        let mut dated = contract("BTC_USDT_250926", "BTC", "USDT", "USDT", 0.0001, 0);
        dated["ft"] = json!(2);
        let reply: DetailReply = serde_json::from_value(json!({ "success": true, "code": 0, "data": [dated] })).unwrap();

        assert!(parse(&reply.data).is_empty());
    }

    #[tokio::test]
    async fn loads_the_catalog_and_fails_on_a_venue_error() {
        let rest = MockRest::start().await;
        rest.reply(DETAIL_PATH, detail());
        let venue = load_from(&http(), &rest.url).await.unwrap();
        assert_eq!(venue.markets.len(), 3);
        assert_eq!(venue.name, "Biconomy.com");

        let failing = MockRest::start().await;
        failing.reply(DETAIL_PATH, json!({ "success": false, "code": 1001, "message": "Contract does not exist!" }));
        let error = load_from(&http(), &failing.url).await.unwrap_err();
        assert!(error.to_string().contains("code 1001: Contract does not exist!"), "{error:#}");
    }
}
