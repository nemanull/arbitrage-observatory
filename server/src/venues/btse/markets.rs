use super::anchor::get_data;
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "BTSE";

// The "General User" futures taker of 0.0550 %, one rate for every category, see docs/profiles/btse/fees.md section 2.
const TAKER_PPM: u32 = 550;

// types=["FuturesPerpetual"], which leaves out the spot rows and the dated futures.
pub const MARKETS_PATH: &str = "/public-api/market/v1/markets?types=%5B%22FuturesPerpetual%22%5D";

// TRUMP-PERP's base is spelled TRUMPSOL, and its display name is Official Trump, the token every other venue lists as TRUMP.
const CODES: &[(&str, &str)] = &[("TRUMPSOL", "TRUMP")];

// A 1K base is priced and sized per 1,000 tokens: 1KPEPE's index read 0.00493 when PEPE was 0.00000493.
const THOUSANDS_SCALE: f64 = 0.001;

// Each entry names the other token it collides with, from the identity check of 2026-10-09.
const DENIED: &[(&str, &str)] = &[
    // Simon's Cat at 0.000002 a token, while binance and gate list the Caterpillar stock as CAT at about 805.
    ("1KCAT-PERP", "a different token from the CAT that binance and gate list"),
    // Natural Gas at about 3.43, while binance, bybit and okx list NEO's GAS token at about 1.33.
    ("GAS-PERP", "a different token from the GAS that binance, bybit and okx list"),
    // The Quantinuum stock at about 41, while binance and bybit list the Quant token at about 244.
    ("QNT-PERP", "a different token from the QNT that binance and bybit list"),
];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Symbols = get_data(http, &format!("{rest}{MARKETS_PATH}")).await?;
    let markets = parse(&reply.symbols);
    catalog::finish(ID, NAME, reply.symbols.len(), markets, DENIED)
}

// CCXT 4.5.68 has no btse class, so the rules are those of docs/profiles/btse/rest.md section 2.
// Every perpetual quotes USDT and settles in any of its listed currencies, so the venue has one linear family.
// The stock and commodity perpetuals stay, as decision 4 of the venue adapter waves design keeps TradFi, and the identity check vets each ticker.
fn parse(rows: &[Row]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        if row.kind != "FuturesPerpetual" || !row.active || !matches!(row.quote_currency.as_str(), "USDT" | "USDC" | "USD") {
            continue;
        }
        if row.trade_currency.is_empty() || row.base_currency.is_empty() {
            continue;
        }

        let (base, price_scale) = match thousands_token(&row.base_currency) {
            Some(token) => (currency_code(token, CODES), THOUSANDS_SCALE),
            None => (currency_code(&row.base_currency, CODES), 1.0),
        };

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.trade_currency.clone(),
            base,
            quote: row.quote_currency.clone(),
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: catalog::contract_size(row.contract_size), // book sizes are contracts, and a 1K base's contract counts thousands, which price_scale carries
            price_scale,
        });
    }

    markets
}

// "1KPEPE" names PEPE, and "1INCH" is a token of its own.
fn thousands_token(base: &str) -> Option<&str> {
    let token = base.strip_prefix("1K")?;
    let named = !token.is_empty() && token.bytes().all(|byte| byte.is_ascii_uppercase());
    named.then_some(token)
}

#[derive(Deserialize)]
struct Symbols {
    #[serde(default)]
    symbols: Vec<Row>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Row {
    #[serde(default, rename = "type")]
    kind: String, // "FuturesPerpetual"
    #[serde(default)]
    trade_currency: String, // "BTC-PERP", the socket's and the legacy price call's spelling, where symbol is "BTC-PERP-USDT"
    #[serde(default)]
    base_currency: String, // "BTC", "1KPEPE", "TRUMPSOL"
    #[serde(default)]
    quote_currency: String, // "USDT" on every perpetual
    #[serde(default)]
    active: bool,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    contract_size: f64, // base coins per contract as a string, "0.00001" on BTC
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the markets reply captured live on 2026-10-09, with a few of the fields the loader ignores.
    fn row(symbol: &str, category: &str, base: &str, quote: &str, active: bool, contract_size: &str) -> Value {
        let trade_currency = symbol.strip_suffix(&format!("-{quote}")).unwrap_or(symbol);
        let kind = if trade_currency.ends_with("-PERP") { "FuturesPerpetual" } else { "FuturesTimeBased" };
        json!({
            "symbol": symbol, "type": kind, "category": category, "tradeCurrency": trade_currency,
            "baseCurrency": base, "quoteCurrency": quote, "displayName": base, "active": active,
            "minPriceIncrement": "0.1", "minOrderSize": "1", "minSizeIncrement": "1", "contractSize": contract_size,
            "availableSettlement": ["USD", "USDT", "USDC", "BTC"],
        })
    }

    fn reply() -> Value {
        json!({ "code": 1, "msg": "Success", "success": true, "time": 1791567640746_i64, "data": { "symbols": [
            row("BTC-PERP-USDT", "CRYPTO", "BTC", "USDT", true, "0.00001"),
            row("1KPEPE-PERP-USDT", "CRYPTO", "1KPEPE", "USDT", true, "1"),
            row("1INCH-PERP-USDT", "CRYPTO", "1INCH", "USDT", true, "1"),
            row("TRUMP-PERP-USDT", "CRYPTO", "TRUMPSOL", "USDT", true, "0.1"),
            row("NVDA-PERP-USDT", "STOCK", "NVDA", "USDT", true, "0.01"),
            row("GOLD-PERP-USDT", "COMMODITIES", "GOLD", "USDT", true, "0.001"),
            row("GAS-PERP-USDT", "COMMODITIES", "GAS", "USDT", true, "0.1"),
            row("BTC-261225", "CRYPTO", "BTC", "USDT", true, "0.00001"), // a dated future, which a reply without the type filter carries
            row("ETH-PERP-BTC", "CRYPTO", "ETH", "BTC", true, "0.0001"), // a coin quoted family, which no row carried on 2026-10-09
            row("SOL-PERP-USDT", "CRYPTO", "SOL", "USDT", false, "0.01"), // every row was active on 2026-10-09
        ]}})
    }

    fn parsed() -> Vec<Market> {
        let symbols: Symbols = serde_json::from_value(reply()["data"].clone()).unwrap();
        parse(&symbols.symbols)
    }

    #[test]
    fn keeps_active_usdt_perpetuals_of_every_category_under_the_socket_spelling() {
        assert_eq!(
            raw_ids(&parsed()),
            ["BTC-PERP", "1KPEPE-PERP", "1INCH-PERP", "TRUMP-PERP", "NVDA-PERP", "GOLD-PERP", "GAS-PERP"]
        );
    }

    #[test]
    fn drops_a_dated_future_a_coin_quoted_contract_and_an_inactive_one() {
        let ids = raw_ids(&parsed()).join(",");

        assert!(!ids.contains("BTC-261225"));
        assert!(!ids.contains("ETH-PERP"));
        assert!(!ids.contains("SOL-PERP"));
    }

    #[test]
    fn reads_the_contract_size_from_the_reply_at_the_vip_0_taker() {
        let markets = parsed();

        assert_eq!(markets[0].contract_size, 0.00001);
        assert_eq!(markets[4].contract_size, 0.01);
        assert_eq!(markets[5].contract_size, 0.001);
        assert!(markets.iter().all(|m| m.linear && m.taker_ppm == 550 && m.quote == "USDT"));
    }

    #[test]
    fn names_a_1k_base_by_its_token_with_a_thousandth_price_scale_and_keeps_1inch() {
        let markets = parsed();

        assert_eq!((markets[1].base.as_str(), markets[1].price_scale, markets[1].contract_size), ("PEPE", 0.001, 1.0));
        assert_eq!((markets[2].base.as_str(), markets[2].price_scale), ("1INCH", 1.0));
        assert_eq!(thousands_token("1KBONK"), Some("BONK"));
        assert_eq!(thousands_token("1K"), None);
    }

    #[test]
    fn renames_trumpsol_to_trump() {
        assert_eq!(parsed()[3].base, "TRUMP");
        assert_eq!(parsed()[0].base, "BTC");
    }

    #[tokio::test]
    async fn loads_the_catalog_without_the_denied_gas_and_fails_on_a_reply_that_is_no_success() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, reply());
        let venue = load_from(&http(), &rest.url).await.unwrap();
        assert_eq!(venue.id, "btse");
        assert_eq!(venue.name, "BTSE");
        assert_eq!(venue.markets.len(), 6);
        assert!(!raw_ids(&venue.markets).contains(&"GAS-PERP"));
        assert_eq!(logs.events("market_denied")[0].text("market"), "GAS-PERP");
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 10.0);
        assert_eq!(logs.events("market_price_scaled")[0].text("market"), "1KPEPE-PERP");

        // The shape of the markets API's error envelope captured on 2026-10-09, here under HTTP 200.
        let failing = MockRest::start().await;
        failing.reply(
            MARKETS_PATH,
            json!({ "code": 10010004, "msg": "Invalid json format", "success": false, "time": 1791567640746_i64, "data": [] }),
        );
        let error = load_from(&http(), &failing.url).await.unwrap_err();
        assert!(error.to_string().contains("code 10010004"), "{error:#}");
    }
}
