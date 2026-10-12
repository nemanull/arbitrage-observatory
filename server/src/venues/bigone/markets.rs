use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, contract_size, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "BigONE";

// The futures taker of 0.06 % at VIP 1, BigONE's lowest level, flat across every level, see docs/profiles/bigone/fees.md section 2.
const TAKER_PPM: u32 = 600;

// Every contract of both families, disabled ones included, as a bare array.
const SYMBOLS_PATH: &str = "/api/contract/v2/symbols";

// CCXT's bigone commonCurrencies.
const CODES: &[(&str, &str)] = &[
    ("CRE", "Cybereits"),
    ("FXT", "FXTTOKEN"),
    ("FREE", "FreeRossDAO"),
    ("MBN", "Mobilian Coin"),
    ("ONE", "BigONE Token"),
];

const DENIED: &[(&str, &str)] = &[];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let symbols: Vec<Symbol> = get_json(http, &format!("{rest}{SYMBOLS_PATH}")).await?;
    let markets = parse(&symbols);
    catalog::finish(ID, NAME, symbols.len(), markets, DENIED)
}

// CCXT's bigone fetchMarkets for a contract: active is enable and linear is not isInverse.
// The inverse BTCUSD and ETHUSD count their book in contracts of 1 USD, so they stay out.
fn parse(symbols: &[Symbol]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in symbols {
        if !row.enable || row.is_inverse || !matches!(row.quote_currency.as_str(), "USDT" | "USDC" | "USD") {
            continue;
        }

        let base = currency_code(&row.base_currency, CODES);
        let quote = currency_code(&row.quote_currency, CODES);
        if base.is_empty() || row.symbol.is_empty() {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: contract_size(row.multiplier), // book sizes are contracts of `multiplier` coins
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Symbol {
    #[serde(default)]
    symbol: String, // "BTCUSDT", the socket's and the anchor's id, case sensitive
    #[serde(default)]
    base_currency: String,
    #[serde(default)]
    quote_currency: String, // "USDT", or "USD" on the inverse rows
    #[serde(default)]
    is_inverse: bool,
    #[serde(default)]
    enable: bool,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    multiplier: f64, // coins per contract, 0.001 on BTCUSDT and 1,000,000 on PEPEUSDT
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the symbols reply captured live on 2026-10-09, with a few of the fields the loader ignores.
    fn row(symbol: &str, base: &str, quote: &str, settle: &str, kind: &str, multiplier: f64, enable: bool, inverse: bool) -> Value {
        json!({
            "baseCurrency": base, "multiplier": multiplier, "enable": enable, "priceStep": 0.1, "pricePrecision": 1,
            "symbol": symbol, "type": kind, "isInverse": inverse, "settleCurrency": settle, "displayName": symbol,
            "initialMargin": 0.01, "quoteCurrency": quote,
        })
    }

    fn reply() -> Value {
        json!([
            row("BTCUSD", "BTC", "USD", "BTC", "CRYPTO", 1.0, true, true),
            row("BTCUSDT", "BTC", "USDT", "USDT", "CRYPTO", 0.001, true, false),
            row("EOSUSDT", "EOS", "USDT", "USDT", "CRYPTO", 10.0, false, false),
            row("PEPEUSDT", "PEPE", "USDT", "USDT", "CRYPTO", 1_000_000.0, true, false),
            row("TSLAUSDT", "TSLA", "USDT", "USDT", "STOCK", 0.1, true, false),
            row("XAUUSDT", "XAU", "USDT", "USDT", "METAL", 0.01, true, false),
            row("NATGASUSDT", "NATGAS", "USDT", "USDT", "COMMODITY", 1.0, true, false),
            // No ONE contract was listed on 2026-10-09, so this row is BTCUSDT renamed to show the CCXT table.
            row("ONEUSDT", "ONE", "USDT", "USDT", "CRYPTO", 1.0, true, false),
        ])
    }

    fn parsed() -> Vec<Market> {
        let symbols: Vec<Symbol> = serde_json::from_value(reply()).unwrap();
        parse(&symbols)
    }

    #[test]
    fn keeps_enabled_linear_contracts_of_every_type() {
        assert_eq!(raw_ids(&parsed()), ["BTCUSDT", "PEPEUSDT", "TSLAUSDT", "XAUUSDT", "NATGASUSDT", "ONEUSDT"]);
    }

    #[test]
    fn drops_a_disabled_contract_and_the_inverse_family() {
        let ids = raw_ids(&parsed()).join(",");

        assert!(!ids.contains("EOSUSDT"));
        assert!(!ids.split(',').any(|id| id == "BTCUSD"));
    }

    #[test]
    fn drops_a_linear_contract_quoted_in_a_coin() {
        // No such row was listed on 2026-10-09, so this row is made up in the shape of the others.
        let symbols: Vec<Symbol> = serde_json::from_value(json!([row("ETHBTC", "ETH", "BTC", "BTC", "CRYPTO", 0.1, true, false)])).unwrap();

        assert!(parse(&symbols).is_empty());
    }

    #[test]
    fn takes_the_multiplier_as_contract_size_at_the_vip_1_taker() {
        let markets = parsed();

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!(markets[0].contract_size, 0.001);
        assert_eq!(markets[1].contract_size, 1_000_000.0);
        assert_eq!(markets[2].contract_size, 0.1);
        assert!(markets.iter().all(|m| m.linear && m.taker_ppm == 600 && m.price_scale == 1.0));
    }

    #[test]
    fn maps_codes_through_the_bigone_table() {
        assert_eq!(parsed()[5].base, "BigONE Token");
    }

    #[tokio::test]
    async fn loads_the_catalog_and_fails_on_an_error_status() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(SYMBOLS_PATH, reply());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "bigone");
        assert_eq!(venue.markets.len(), 6);
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 8.0);

        // The contract API answers an error with a bare status and an empty body.
        let failing = MockRest::start().await;
        failing.fail(SYMBOLS_PATH, 404);
        assert!(load_from(&http(), &failing.url).await.is_err());
    }
}
