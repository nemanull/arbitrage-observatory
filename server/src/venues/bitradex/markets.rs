use super::anchor::get_data;
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "BitradeX";

// The VIP 0 taker of the step table, 0.06 %, see docs/profiles/bitradex/fees.md section 2.
// The symbol list's takerFee is 650 ppm on btc_usdt and 6,500 ppm on eth_usdt, and which of the two a fill pays needs an account.
const TAKER_PPM: u32 = 600;

// The web app's list of every USDT-M contract, about 94 KB, which no documentation describes.
pub const SYMBOLS_PATH: &str = "/v1/future-u/market/public/symbol/list";

const DENIED: &[(&str, &str)] = &[];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let symbols: Vec<Symbol> = get_data(http, &format!("{rest}{SYMBOLS_PATH}")).await?;
    let markets = parse(&symbols);
    catalog::finish(ID, NAME, symbols.len(), markets, DENIED)
}

// No CCXT class exists, so these are the rules of docs/profiles/bitradex/rest.md section 2.
// tradeSwitch separates the 56 live contracts, while isOpenApi is true on only 4 of them and says nothing about public data.
fn parse(symbols: &[Symbol]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in symbols {
        if row.contract_type != "PERPETUAL" || row.underlying_type != "U_BASED" || !row.trade_switch {
            continue;
        }

        let quote = currency_code(&row.quote_coin, &[]);
        if !matches!(quote.as_str(), "USDT" | "USDC" | "USD") {
            continue;
        }
        let base = currency_code(&row.base_coin, &[]);
        if base.is_empty() {
            continue;
        }

        // Sizes run from 0.0001 to 10000 coins a contract, so a missing one has no safe default.
        if !(row.contract_size.is_finite() && row.contract_size > 0.0) {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: row.contract_size, // coins per contract, and book sizes are whole contracts
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Symbol {
    #[serde(default)]
    symbol: String, // "btc_usdt", the socket's s and the anchor calls' s
    #[serde(default)]
    contract_type: String, // "PERPETUAL" on every row
    #[serde(default)]
    underlying_type: String, // "U_BASED" on every row of this host
    #[serde(default)]
    base_coin: String, // "btc" or "1000shib"
    #[serde(default)]
    quote_coin: String, // "usdt", or "sol" on xaut_sol
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    contract_size: f64, // "0.0001" on btc_usdt
    #[serde(default)]
    trade_switch: bool, // false on a contract switched off
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the symbol list captured live on 2026-10-09, with a few of the fields the loader ignores.
    #[allow(clippy::too_many_arguments)]
    fn symbol(symbol: &str, contract: &str, underlying: &str, base: &str, quote: &str, size: &str, trade: bool, api: bool) -> Value {
        json!({
            "id": 1, "symbol": symbol, "pair": symbol, "contractType": contract, "productType": "perpetual", "underlyingType": underlying,
            "contractSize": size, "tradeSwitch": trade, "openSwitch": trade, "isDisplay": trade, "isOpenApi": api, "state": 0,
            "baseCoin": base, "quoteCoin": quote, "makerFee": "0.0004", "takerFee": "0.0006", "quantityPrecision": 0,
        })
    }

    fn reply() -> Value {
        json!({ "code": 0, "msg": "success", "msgInfo": null, "ts": 1791572686659_i64, "data": [
            symbol("btc_usdt", "PERPETUAL", "U_BASED", "btc", "usdt", "0.0001", true, true),
            symbol("1000shib_usdt", "PERPETUAL", "U_BASED", "1000shib", "usdt", "100", true, false),
            symbol("nvda_usdt", "PERPETUAL", "U_BASED", "nvda", "usdt", "0.01", true, false),
            symbol("ton_usdt", "PERPETUAL", "U_BASED", "ton", "usdt", "1", false, false),
            symbol("xaut_sol", "PERPETUAL", "U_BASED", "xaut", "sol", "0.001", false, false),
            // Shapes this host has not listed, kept to pin the rules.
            symbol("xaut_sol2", "PERPETUAL", "U_BASED", "xaut", "sol", "0.001", true, false),
            symbol("btc_usd", "PERPETUAL", "COIN_BASED", "btc", "usd", "100", true, false),
            symbol("btc_usdt_261225", "CURRENT_QUARTER", "U_BASED", "btc", "usdt", "0.0001", true, false),
        ]})
    }

    fn parsed() -> Vec<Market> {
        let symbols: Vec<Symbol> = serde_json::from_value(reply()["data"].clone()).unwrap();
        parse(&symbols)
    }

    #[test]
    fn keeps_linear_usdt_perpetuals_that_trade_whether_or_not_open_to_the_api() {
        assert_eq!(raw_ids(&parsed()), ["btc_usdt", "1000shib_usdt", "nvda_usdt"]);
    }

    #[test]
    fn drops_a_switched_off_contract_and_a_sol_quoted_one() {
        let markets = parsed();
        let ids = raw_ids(&markets);

        assert!(!ids.contains(&"ton_usdt"));
        assert!(!ids.contains(&"xaut_sol"));
        assert!(!ids.contains(&"xaut_sol2"));
    }

    #[test]
    fn drops_a_coin_margined_contract_and_a_dated_future() {
        let markets = parsed();
        let ids = raw_ids(&markets);

        assert!(!ids.contains(&"btc_usd"));
        assert!(!ids.contains(&"btc_usdt_261225"));
    }

    #[test]
    fn uppercases_the_coins_and_keeps_a_multiplier_prefix_in_the_base() {
        let markets = parsed();

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!(markets[1].base, "1000SHIB");
        assert_eq!(markets[2].base, "NVDA");
    }

    #[test]
    fn reads_the_contract_size_as_coins_per_contract_at_the_vip_0_taker() {
        let markets = parsed();

        assert_eq!(markets[0].contract_size, 0.0001);
        assert_eq!(markets[1].contract_size, 100.0);
        assert!(markets.iter().all(|m| m.linear && m.taker_ppm == 600 && m.price_scale == 1.0));
    }

    #[test]
    fn drops_a_contract_without_a_positive_contract_size() {
        let rows = json!([
            symbol("btc_usdt", "PERPETUAL", "U_BASED", "btc", "usdt", "", true, true),
            symbol("eth_usdt", "PERPETUAL", "U_BASED", "eth", "usdt", "0", true, false),
            symbol("sol_usdt", "PERPETUAL", "U_BASED", "sol", "usdt", "0.1", true, false),
        ]);
        let symbols: Vec<Symbol> = serde_json::from_value(rows).unwrap();

        assert_eq!(raw_ids(&parse(&symbols)), ["sol_usdt"]);
    }

    #[tokio::test]
    async fn loads_the_catalog_and_fails_on_a_venue_error() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(SYMBOLS_PATH, reply());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "bitradex");
        assert_eq!(venue.name, "BitradeX");
        assert_eq!(raw_ids(&venue.markets), ["btc_usdt", "1000shib_usdt", "nvda_usdt"]);
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 8.0);

        // The error shape captured live on 2026-10-09, which comes with HTTP 200.
        let failing = MockRest::start().await;
        failing.reply(
            SYMBOLS_PATH,
            json!({ "code": 1, "msg": "failure", "msgInfo": { "code": "E000", "template": "Internal Service Error", "args": null }, "data": null, "ts": 1791573137190_i64 }),
        );
        let error = load_from(&http(), &failing.url).await.unwrap_err();
        assert!(error.to_string().contains("E000"), "{error:#}");
    }
}
