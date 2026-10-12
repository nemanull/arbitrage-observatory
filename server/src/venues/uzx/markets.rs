use super::anchor::get_data;
use super::{ID, REST, WEB};
use crate::engine::cluster::{Market, Venue};
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::HashMap;

const NAME: &str = "UZX";

// The level 1 USDT-M taker of 0.05 %, the tier a new account starts on, see docs/profiles/uzx/fees.md section 2.
const TAKER_PPM: u32 = 500;

// The documented product list, which carries no status.
const PRODUCTS_PATH: &str = "/v2/products?ins_type=SWAP";

// The web client's USDT-M list on the web host, the only call that carries the documented status of 1 active and 2 suspended.
const SYMBOLS_PATH: &str = "/v2/info/swap-usdt/symbols";

const ACTIVE: i64 = 1;

// No reference venue lists a UZX token, and its index basket is unpublished, so the venue's own book is its likeliest source.
const DENIED: &[(&str, &str)] = &[("UZXUSDT", "the venue's own token, whose unpublished index basket is likely its own market")];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST, WEB).await
}

async fn load_from(http: &reqwest::Client, rest: &str, web: &str) -> anyhow::Result<Venue> {
    let (products_url, symbols_url) = (format!("{rest}{PRODUCTS_PATH}"), format!("{web}{SYMBOLS_PATH}"));
    let (products, symbols) = tokio::join!(
        get_data::<Vec<Product>>(http, &products_url),
        get_data::<Vec<Symbol>>(http, &symbols_url),
    );
    let (products, symbols) = (products?, symbols?);
    let markets = parse(&products, &symbols);
    catalog::finish(ID, NAME, products.len(), markets, DENIED)
}

// No CCXT class exists, so the rules are those of docs/profiles/uzx/rest.md section 2.
// The coin-M family is ins_type BASE with an empty base, and a product the status list does not name counts as not trading.
fn parse(products: &[Product], symbols: &[Symbol]) -> Vec<Market> {
    let mut status = HashMap::with_capacity(symbols.len());
    for symbol in symbols {
        status.insert(symbol.product_name.as_str(), symbol.status);
    }

    let mut markets = Vec::new();
    for row in products {
        if row.ins_type != "SWAP" || status.get(row.product_name.as_str()) != Some(&ACTIVE) {
            continue;
        }
        if !matches!(row.quote_coin_name.as_str(), "USDT" | "USDC" | "USD") || row.base_coin_name.is_empty() {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.product_name.clone(),
            base: currency_code(&row.base_coin_name, &[]),
            quote: row.quote_coin_name.clone(),
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: catalog::contract_size(row.swap_value), // book sizes are whole contracts of swap_value coins
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct Product {
    #[serde(default)]
    ins_type: String, // "SWAP", "BASE" for coin-M, or "SPOT"
    #[serde(default)]
    product_name: String, // "BTCUSDT", the socket's and the ticker's id
    #[serde(default)]
    base_coin_name: String, // "BTC", and empty on coin-M
    #[serde(default)]
    quote_coin_name: String, // "USDT", and the coin on coin-M
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    swap_value: f64, // coins per contract, "0.001" on BTCUSDT
}

#[derive(Deserialize)]
struct Symbol {
    #[serde(default)]
    product_name: String,
    #[serde(default)]
    status: i64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the replies captured live on 2026-10-09, with a few of the fields the loader ignores.
    fn product(ins_type: &str, name: &str, base: &str, quote: &str, swap_value: &str) -> Value {
        json!({
            "ins_type": ins_type, "product_name": name, "base_coin_name": base, "quote_coin_name": quote,
            "price_precision": 1, "num_precision": 0, "swap_value": swap_value, "price_unit": "0.1",
            "max_leverage": 100, "market_max_deeps": 10, "max_book_num": 200,
        })
    }

    fn products() -> Value {
        json!({ "code": 200, "msg": "success", "data": [
            product("SWAP", "BTCUSDT", "BTC", "USDT", "0.001"),
            product("SWAP", "1000SATSUSDT", "1000SATS", "USDT", "1"),
            product("SWAP", "PENGUUSDT", "PENGU", "USDT", "100"),
            product("SWAP", "XAUUSDT", "XAU", "USDT", "0.001"),
            product("SWAP", "UZXUSDT", "UZX", "USDT", "1"),
            product("SWAP", "ACEUSDT", "ACE", "USDT", "1"),
            product("SWAP", "NEWUSDT", "NEW", "USDT", "1"),
            product("BASE", "BTCUSD", "", "BTC", "100"),
            product("SPOT", "BTC-USDT", "BTC", "USDT", "0"),
        ]})
    }

    fn symbol(name: &str, status: i64) -> Value {
        json!({
            "base_coin_id": 0, "circuit_rate": "0.002", "front_hidden": false, "maker_fee": "", "taker_fee": "",
            "product_name": name, "quote_coin_name": "USDT", "status": status, "swap_value": "1",
        })
    }

    // No row read status 2 on 2026-10-09, so ACEUSDT's is the documented suspended value, and NEWUSDT stands for a product the list leaves out.
    fn symbols() -> Value {
        json!({ "code": 200, "msg": "success", "data": [
            symbol("BTCUSDT", 1), symbol("1000SATSUSDT", 1), symbol("PENGUUSDT", 1), symbol("XAUUSDT", 1),
            symbol("UZXUSDT", 1), symbol("ACEUSDT", 2),
        ]})
    }

    fn parsed() -> Vec<Market> {
        let products: Vec<Product> = serde_json::from_value(products()["data"].clone()).unwrap();
        let symbols: Vec<Symbol> = serde_json::from_value(symbols()["data"].clone()).unwrap();
        parse(&products, &symbols)
    }

    #[test]
    fn keeps_the_active_usdt_margined_swaps() {
        assert_eq!(raw_ids(&parsed()), ["BTCUSDT", "1000SATSUSDT", "PENGUUSDT", "XAUUSDT", "UZXUSDT"]);
    }

    #[test]
    fn drops_a_suspended_swap_a_swap_without_a_status_the_coin_margined_family_and_spot() {
        let ids = raw_ids(&parsed()).join(",");

        assert!(!ids.contains("ACEUSDT"));
        assert!(!ids.contains("NEWUSDT"));
        assert!(!ids.split(',').any(|id| id == "BTCUSD"));
        assert!(!ids.contains("BTC-USDT"));
    }

    #[test]
    fn reads_the_contract_size_from_swap_value_at_the_level_1_taker() {
        let markets = parsed();

        let sizes: Vec<f64> = markets.iter().map(|m| m.contract_size).collect();
        assert_eq!(sizes, [0.001, 1.0, 100.0, 0.001, 1.0]);
        assert!(markets.iter().all(|m| m.linear && m.price_scale == 1.0 && m.taker_ppm == 500));
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!(markets[1].base, "1000SATS");
    }

    #[tokio::test]
    async fn loads_the_catalog_without_the_denied_own_token() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(PRODUCTS_PATH, products());
        rest.reply(SYMBOLS_PATH, symbols());

        let venue = load_from(&http(), &rest.url, &rest.url).await.unwrap();

        assert_eq!(venue.id, "uzx");
        assert_eq!(raw_ids(&venue.markets), ["BTCUSDT", "1000SATSUSDT", "PENGUUSDT", "XAUUSDT"]);
        assert_eq!(logs.events("market_denied")[0].text("market"), "UZXUSDT");
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 9.0);
    }

    #[tokio::test]
    async fn fails_when_the_status_list_fails() {
        let (_logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(PRODUCTS_PATH, products());
        // An unknown path on the web host answered HTTP 401 "missing token" on 2026-10-09.
        rest.fail(SYMBOLS_PATH, 401);

        let error = load_from(&http(), &rest.url, &rest.url).await.unwrap_err();

        assert!(error.to_string().contains("401"), "{error:#}");
    }
}
