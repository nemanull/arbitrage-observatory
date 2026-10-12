use super::anchor::get_result;
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "XT.COM";

// The VIP 0 futures taker of 0.0600 %, see docs/profiles/xt/fees.md section 2.
// The symbol list's takerFee, which CCXT reads, is 0 on skr_usdt alone.
const TAKER_PPM: u32 = 600;

// CCXT's USDT-M list, 100 KB gzipped, where the v3 path is a trimmed copy CCXT does not read.
// The coin-M list on dapi.xt.com is left unread, since decision 3 drops every inverse contract.
pub const SYMBOLS_PATH: &str = "/future/market/v1/public/symbol/list";

// Bybit and okx list ON as the ON Semiconductor stock near 80 USDT, while XT's on_usdt read 0.11 on 2026-10-09.
// NFLX split ten for one in 2025, and XT's index for nflx_usdt still reads ten times the price its book trades at.
const DENIED: &[(&str, &str)] = &[
    ("on_usdt", "a different token from the ON that okx and bybit list"),
    ("nflx_usdt", "its index is on the pre-split scale, ten times the price its book trades at"),
];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let symbols: Vec<Symbol> = get_result(http, &format!("{rest}{SYMBOLS_PATH}")).await?;
    let markets = parse(&symbols);
    catalog::finish(ID, NAME, symbols.len(), markets, DENIED)
}

// CCXT's xt parseMarket for an active linear swap, with an empty commonCurrencies table.
// CCXT reads active from isOpenApi alone, which keeps 66 delisted contracts that no longer trade, so tradeSwitch must be true as well.
// A pre-market contract trades and stays in, as decision 4 says, and the index call carries no row for it.
fn parse(symbols: &[Symbol]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in symbols {
        if row.product_type != "perpetual" || row.underlying_type != "U_BASED" || !row.trade_switch || !row.is_open_api {
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

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: catalog::contract_size(row.contract_size), // coins per contract, and book sizes are contracts
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Symbol {
    #[serde(default)]
    symbol: String, // "btc_usdt", the socket's id and the anchor calls' s
    #[serde(default)]
    product_type: String, // "perpetual" or "futures"
    #[serde(default)]
    underlying_type: String, // "U_BASED", while the coin-M host answers "COIN_BASED"
    #[serde(default)]
    base_coin: String, // "btc", "1000pepe" or "龙虾"
    #[serde(default)]
    quote_coin: String, // "usdt" on every row
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    contract_size: f64, // "0.0001" on btc_usdt
    #[serde(default)]
    trade_switch: bool, // false on a delisted contract
    #[serde(default)]
    is_open_api: bool, // false on a contract the API cannot trade
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the symbol list captured live on 2026-10-09, with a few of the fields the loader ignores.
    #[allow(clippy::too_many_arguments)]
    fn symbol(symbol: &str, product: &str, underlying: &str, base: &str, quote: &str, size: &str, trade: bool, api: bool, pre: bool) -> Value {
        json!({
            "symbol": symbol, "pair": symbol, "contractType": if product == "perpetual" { "PERPETUAL" } else { "CURRENT_QUARTER" },
            "productType": product, "underlyingType": underlying, "contractSize": size, "tradeSwitch": trade, "openSwitch": trade,
            "isOpenApi": api, "state": 0, "baseCoin": base, "quoteCoin": quote, "makerFee": "0.0004", "takerFee": "0.0006",
            "inPreMarket": pre, "deliveryDate": null,
        })
    }

    fn reply() -> Value {
        json!({ "returnCode": 0, "msgInfo": "success", "error": null, "result": [
            symbol("btc_usdt", "perpetual", "U_BASED", "btc", "usdt", "0.0001", true, true, false),
            symbol("1000pepe_usdt", "perpetual", "U_BASED", "1000pepe", "usdt", "100", true, true, false),
            symbol("龙虾_usdt", "perpetual", "U_BASED", "龙虾", "usdt", "100", true, true, false),
            symbol("anthropic_usdt", "perpetual", "U_BASED", "anthropic", "usdt", "0.001", true, true, true),
            symbol("on_usdt", "perpetual", "U_BASED", "on", "usdt", "10", true, true, false),
            symbol("nflx_usdt", "perpetual", "U_BASED", "nflx", "usdt", "0.001", true, true, false),
            symbol("ftt_usdt", "perpetual", "U_BASED", "ftt", "usdt", "0.01", false, true, false),
            symbol("openai_usdt", "perpetual", "U_BASED", "openai", "usdt", "0.001", true, false, true),
            symbol("btc_usdt_261225", "futures", "U_BASED", "btc", "usdt", "0.001", true, true, false),
            symbol("btc_usd", "perpetual", "COIN_BASED", "btc", "usd", "100", true, true, false),
        ]})
    }

    fn parsed() -> Vec<Market> {
        let symbols: Vec<Symbol> = serde_json::from_value(reply()["result"].clone()).unwrap();
        parse(&symbols)
    }

    #[test]
    fn keeps_linear_perpetuals_that_trade_and_are_open_to_the_api() {
        assert_eq!(
            raw_ids(&parsed()),
            ["btc_usdt", "1000pepe_usdt", "龙虾_usdt", "anthropic_usdt", "on_usdt", "nflx_usdt"]
        );
    }

    #[test]
    fn drops_a_delisted_contract_that_ccxt_reads_as_active() {
        assert!(!raw_ids(&parsed()).contains(&"ftt_usdt"));
    }

    #[test]
    fn drops_a_contract_closed_to_the_api_a_dated_future_and_the_coin_margined_family() {
        let markets = parsed();
        let ids = raw_ids(&markets);

        assert!(!ids.contains(&"openai_usdt"));
        assert!(!ids.contains(&"btc_usdt_261225"));
        assert!(!ids.contains(&"btc_usd"));
    }

    #[test]
    fn uppercases_the_coins_and_keeps_a_multiplier_prefix_in_the_base() {
        let markets = parsed();

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!(markets[1].base, "1000PEPE");
        assert_eq!(markets[2].base, "龙虾");
    }

    #[test]
    fn reads_the_contract_size_as_coins_per_contract_at_the_vip_0_taker() {
        let markets = parsed();

        assert_eq!(markets[0].contract_size, 0.0001);
        assert_eq!(markets[1].contract_size, 100.0);
        assert!(markets.iter().all(|m| m.linear && m.taker_ppm == 600 && m.price_scale == 1.0));
    }

    #[tokio::test]
    async fn loads_the_catalog_without_the_denied_markets_and_fails_on_a_venue_error() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(SYMBOLS_PATH, reply());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "xt");
        assert_eq!(venue.name, "XT.COM");
        assert_eq!(raw_ids(&venue.markets), ["btc_usdt", "1000pepe_usdt", "龙虾_usdt", "anthropic_usdt"]);
        let denied = logs.events("market_denied");
        let denied: Vec<&str> = denied.iter().map(|line| line.text("market")).collect();
        assert_eq!(denied, ["on_usdt", "nflx_usdt"]);
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 10.0);

        // The error shape captured live on 2026-10-09, which comes with HTTP 200.
        let failing = MockRest::start().await;
        failing.reply(
            SYMBOLS_PATH,
            json!({ "returnCode": 1, "msgInfo": "failure", "error": { "code": "invalid_symbol", "msg": "invalid symbol", "args": [] }, "result": null }),
        );
        let error = load_from(&http(), &failing.url).await.unwrap_err();
        assert!(error.to_string().contains("invalid_symbol"), "{error:#}");
    }
}
