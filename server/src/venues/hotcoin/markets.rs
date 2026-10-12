use super::anchor::get_data;
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::venues::catalog::{self, contract_size, currency_code};
use serde::Deserialize;

const NAME: &str = "Hotcoin";

// The VIP 0 futures taker of 0.06 %, one table for every family, see docs/profiles/hotcoin/fees.md section 2.
const TAKER_PPM: u32 = 600;

// Every family in one reply of about 575 KB, USDT-M, USDC-M and coin-M.
pub const CONTRACTS_PATH: &str = "/api/v1/perpetual/public";

const DENIED: &[(&str, &str)] = &[];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let contracts: Vec<Contract> = get_data(http, &format!("{rest}{CONTRACTS_PATH}")).await?;
    let markets = parse(&contracts);
    catalog::finish(ID, NAME, contracts.len(), markets, DENIED)
}

// No CCXT class exists, so the rules are those of docs/profiles/hotcoin/rest.md section 2.
// The reply has no status field, and a delisted contract leaves it, so a row in it with env 0 is listed.
// The coin-M rows are inverse contracts sized in USD, which decision 3 drops, and a coin quoted row would be dropped the same way.
fn parse(contracts: &[Contract]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in contracts {
        let quote = row.quote.to_uppercase();
        if row.env != 0 || row.direction != 0 || !matches!(quote.as_str(), "USDT" | "USDC" | "USD") {
            continue;
        }

        // The base field is the margin asset, and the underlying keeps a multiplier such as 1000pepe, whose price is per 1,000 PEPE.
        let base = currency_code(&row.underlying, &[]);
        if base.is_empty() || row.code.is_empty() {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.code.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: contract_size(row.unit_amount), // book sizes are contracts of unitAmount coins, 0.001 BTC on btcusdt
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Contract {
    #[serde(default)]
    code: String, // "btcusdt", lowercase, the socket's contractCode
    #[serde(default)]
    underlying: String, // "btc", "1000pepe" or "qcom"
    #[serde(default)]
    quote: String, // "usdt", "usdc", or "usd" on coin-M
    #[serde(default = "inverse")]
    direction: i64, // 0 linear, 1 inverse
    #[serde(default)]
    env: i64, // 0 listing, 1 testing
    #[serde(default)]
    unit_amount: f64, // coins per contract on linear rows, USD on inverse rows
}

fn inverse() -> i64 {
    1
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the catalog reply captured live on 2026-10-09, with a few of the fields the loader ignores.
    fn row(code: &str, underlying: &str, base: &str, quote: &str, direction: i64, category: &str, unit: f64) -> Value {
        json!({
            "amount24": "161628", "assetCategory": category, "base": base, "code": code,
            "codeDisplayName": code.to_uppercase(), "direction": direction, "env": 0, "fund": "0.00005",
            "indexBase": underlying, "indexPrice": "0.003655", "liquidationTime": 1791576000000_i64,
            "markPrice": "0.003655", "maxLever": 25, "price": "0.003656", "quote": quote,
            "underlying": underlying, "unitAmount": unit,
        })
    }

    fn reply() -> Value {
        // No row carried env 1 on 2026-10-09, and the documentation names it testing.
        let mut testing = row("nopeusdt", "nope", "usdt", "usdt", 0, "crypto", 1.0);
        testing["env"] = json!(1);
        json!({ "code": 200, "msg": "success", "data": [
            row("btcusdt", "btc", "usdt", "usdt", 0, "crypto", 0.001),
            row("btcusdc", "btc", "usdc", "usdc", 0, "crypto", 0.001),
            row("1000pepeusdt", "1000pepe", "usdt", "usdt", 0, "crypto", 1000.0),
            row("sophusdt", "soph", "usdt", "usdt", 0, "crypto", 1000.0),
            row("qcomusdt", "qcom", "usdt", "usdt", 0, "us_stock", 0.01),
            row("jpn225usdt", "jpn225", "usdt", "usdt", 0, "crypto", 0.01),
            row("btcusd", "btc", "btc", "usd", 1, "crypto", 100.0),
            row("ethbtc", "eth", "btc", "btc", 0, "crypto", 0.01), // no coin quoted row was listed on 2026-10-09
            testing,
        ]})
    }

    fn parsed() -> Vec<Market> {
        let contracts: Vec<Contract> = serde_json::from_value(reply()["data"].clone()).unwrap();
        parse(&contracts)
    }

    #[test]
    fn keeps_the_listed_usdt_and_usdc_contracts_tradfi_included() {
        assert_eq!(
            raw_ids(&parsed()),
            ["btcusdt", "btcusdc", "1000pepeusdt", "sophusdt", "qcomusdt", "jpn225usdt"]
        );
    }

    #[test]
    fn drops_the_coin_margined_family_a_coin_quoted_row_and_a_testing_contract() {
        let markets = parsed();
        let ids = raw_ids(&markets);

        assert!(!ids.contains(&"btcusd"));
        assert!(!ids.contains(&"ethbtc"));
        assert!(!ids.contains(&"nopeusdt"));
    }

    #[test]
    fn takes_the_base_from_the_underlying_so_a_scaled_contract_keeps_its_multiplier() {
        let markets = parsed();

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!((markets[1].base.as_str(), markets[1].quote.as_str()), ("BTC", "USDC"));
        assert_eq!(markets[2].base, "1000PEPE");
        assert_eq!(markets[4].base, "QCOM");
    }

    #[test]
    fn sizes_a_contract_by_its_unit_amount_at_the_vip_0_taker() {
        let markets = parsed();

        let sizes: Vec<f64> = markets.iter().map(|m| m.contract_size).collect();
        assert_eq!(sizes, [0.001, 0.001, 1000.0, 1000.0, 0.01, 0.01]);
        assert!(markets.iter().all(|m| m.linear && m.price_scale == 1.0 && m.taker_ppm == 600));
    }

    #[tokio::test]
    async fn loads_the_catalog_and_fails_on_a_venue_error() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, reply());
        let venue = load_from(&http(), &rest.url).await.unwrap();
        assert_eq!(venue.id, "hotcoin");
        assert_eq!(venue.markets.len(), 6);
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 9.0);

        // The internal error answer captured live on 2026-09-23, which a 200 status could also carry.
        let failing = MockRest::start().await;
        failing.reply(CONTRACTS_PATH, json!({ "code": 500, "data": null, "msg": "服务器内部错误" }));
        let error = load_from(&http(), &failing.url).await.unwrap_err();
        assert!(error.to_string().contains("code 500"), "{error:#}");
    }
}
