use super::anchor::{CONTRACTS_PATH, get_data};
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;
use std::collections::HashSet;

const NAME: &str = "Hibt";

// The one perpetual taker of 0.05 % since 2025-08-15, with no tiers, see docs/profiles/hibt/fees.md section 2.
const TAKER_PPM: u32 = 500;

// Every listed contract with its supportTrade flag, while the contracts call holds only the tradable ones.
const SYMBOLS_PATH: &str = "/v2/market/symbols";

// The six commodity ids with no underscore hold a one level book with zero volume and zero open interest, and four have a last price of 0.
// crude's index read 7,584.4 on 2026-10-09 against a book of 7,583.6 and 7,585.2 on 2026-09-23, and silver's 6,625.6 against 6,624.9 and 6,626.3.
// So these are quotes nobody trades, as docs/profiles/hibt/rest.md section 8 recommends skipping.
const UNTRADED: &[&str] = &["gold", "crude", "silver", "lco", "platinumu", "chiwheat"];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let contracts: Vec<Contract> = get_data(http, &format!("{rest}{CONTRACTS_PATH}")).await?;
    let symbols: Vec<Symbol> = get_data(http, &format!("{rest}{SYMBOLS_PATH}")).await?;
    let markets = parse(&contracts, &symbols);
    catalog::finish(ID, NAME, symbols.len(), markets, &[])
}

// No CCXT class exists, so the rules are those of docs/profiles/hibt/rest.md section 2.
// A contract trades when the contracts call lists it and the symbols call marks it supportTrade.
fn parse(contracts: &[Contract], symbols: &[Symbol]) -> Vec<Market> {
    let mut trading = HashSet::with_capacity(symbols.len());
    for symbol in symbols {
        if symbol.support_trade {
            trading.insert(symbol.symbol.as_str());
        }
    }

    let mut markets = Vec::new();
    for row in contracts {
        let id = row.ticker_id.as_str();
        if !trading.contains(id) || UNTRADED.contains(&id) {
            continue;
        }
        // CoinGecko's derivative row shape, where an inverse contract would read "Inverse".
        if row.product_type != "Perpetual" || row.contract_type != "Vanilla" {
            continue;
        }
        let quote = currency_code(&row.quote_currency, &[]);
        if !matches!(quote.as_str(), "USDT" | "USDC" | "USD") {
            continue;
        }
        let base = currency_code(&row.base_currency, &[]);
        if base.is_empty() {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.ticker_id.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0, // book sizes are base coins, and contract_price is the last price rather than a face value
            price_scale: 1.0,   // small coins are quoted per coin, shib_usdt at 5.4e-06
        });
    }

    markets
}

#[derive(Deserialize)]
struct Contract {
    #[serde(default)]
    ticker_id: String, // "btc_usdt", lowercase, the socket's id
    #[serde(default)]
    base_currency: String, // "BTC"
    #[serde(default)]
    quote_currency: String, // "USDT" on every row
    #[serde(default)]
    product_type: String, // "Perpetual"
    #[serde(default)]
    contract_type: String, // "Vanilla"
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Symbol {
    #[serde(default)]
    symbol: String, // "btc_usdt"
    #[serde(default)]
    support_trade: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the contracts reply captured live on 2026-10-09, with a few of the fields the loader ignores.
    fn contract(id: &str, base: &str, quote: &str, kind: &str) -> Value {
        json!({
            "ticker_id": id, "base_currency": base, "quote_currency": quote, "last_price": "82544.4",
            "product_type": "Perpetual", "index_price": "82544.332", "funding_rate": "-0.0000129",
            "next_funding_rate_timestamp": 1791590400000_i64, "maker_fee": "0.0003", "taker_fee": "0.0005",
            "contract_type": kind, "contract_price": "82544.4", "contract_price_currency": "USDT",
        })
    }

    fn contracts() -> Value {
        json!({ "code": 0, "msg": "success", "data": [
            contract("btc_usdt", "BTC", "USDT", "Vanilla"),
            contract("shib_usdt", "SHIB", "USDT", "Vanilla"),
            contract("xau_usdt", "XAU", "USDT", "Vanilla"),
            contract("unitree_usdt", "UNITREE", "USDT", "Vanilla"),
            contract("gold", "GOLD", "USDT", "Vanilla"),
            contract("crude", "CRUDE", "USDT", "Vanilla"),
            contract("btc_usd", "BTC", "USD", "Inverse"), // no row carried another type on 2026-10-09
            contract("btc_btc", "BTC", "BTC", "Vanilla"),
            contract("xbt_usdc", "XBT", "USDC", "Vanilla"),
            contract("eth_usdt", "ETH", "USDT", "Vanilla"),
        ]})
    }

    // Rows trimmed from the symbols reply captured live on 2026-10-09.
    fn symbol(id: &str, trade: bool) -> Value {
        json!({ "symbol": id, "supportTrade": trade, "volumePrecision": 3, "pricePrecision": 1, "marketMiniAmount": "0.008", "limitMiniAmount": "0.008" })
    }

    fn symbols() -> Value {
        json!({ "code": 0, "msg": "success", "data": [
            symbol("btc_usdt", true),
            symbol("shib_usdt", true),
            symbol("xau_usdt", true),
            symbol("unitree_usdt", true),
            symbol("gold", true),
            symbol("crude", true),
            symbol("btc_usd", true),
            symbol("btc_btc", true),
            symbol("xbt_usdc", true),
            symbol("eth_usdt", false), // as sse_usdt, gcei_usdt and jets_usdt read
            symbol("sse_usdt", false),
        ]})
    }

    fn parsed() -> Vec<Market> {
        let contracts: Vec<Contract> = serde_json::from_value(contracts()["data"].clone()).unwrap();
        let symbols: Vec<Symbol> = serde_json::from_value(symbols()["data"].clone()).unwrap();
        parse(&contracts, &symbols)
    }

    #[test]
    fn keeps_tradable_linear_contracts_quoted_in_usdt_or_usdc() {
        assert_eq!(raw_ids(&parsed()), ["btc_usdt", "shib_usdt", "xau_usdt", "unitree_usdt", "xbt_usdc"]);
    }

    #[test]
    fn drops_a_contract_without_support_trade_or_absent_from_the_symbols_call() {
        let symbols: Vec<Symbol> = serde_json::from_value(json!([symbol("eth_usdt", true)])).unwrap();
        let contracts: Vec<Contract> = serde_json::from_value(contracts()["data"].clone()).unwrap();

        assert_eq!(raw_ids(&parse(&contracts, &symbols)), ["eth_usdt"]);
        assert!(!raw_ids(&parsed()).contains(&"eth_usdt"));
    }

    #[test]
    fn drops_the_untraded_commodity_ids_an_inverse_contract_and_a_coin_quoted_contract() {
        let markets = parsed();
        let ids = raw_ids(&markets);

        for id in ["gold", "crude", "btc_usd", "btc_btc"] {
            assert!(!ids.contains(&id), "{id}");
        }
    }

    #[test]
    fn takes_base_and_quote_from_the_row_through_the_currency_table() {
        let markets = parsed();

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!(markets[2].base, "XAU");
        assert_eq!(markets[3].base, "UNITREE");
        assert_eq!((markets[4].base.as_str(), markets[4].quote.as_str()), ("BTC", "USDC"));
    }

    #[test]
    fn counts_one_coin_per_contract_at_the_vip_0_taker() {
        assert!(parsed().iter().all(|m| m.linear && m.contract_size == 1.0 && m.price_scale == 1.0 && m.taker_ppm == 500));
    }

    #[tokio::test]
    async fn loads_the_catalog_from_both_calls_and_fails_on_a_venue_error() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, contracts());
        rest.reply(SYMBOLS_PATH, symbols());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "hibt");
        assert_eq!(venue.name, "Hibt");
        assert_eq!(raw_ids(&venue.markets), ["btc_usdt", "shib_usdt", "xau_usdt", "unitree_usdt", "xbt_usdc"]);
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 11.0);

        // The answer to an uppercase symbol, captured live on 2026-10-09 with HTTP 400, here with HTTP 200 as 220017 comes.
        let failing = MockRest::start().await;
        failing.reply(CONTRACTS_PATH, json!({ "code": 210001, "msg": "param error" }));
        let error = load_from(&http(), &failing.url).await.unwrap_err();
        assert!(error.to_string().contains("code 210001"), "{error:#}");
    }
}
