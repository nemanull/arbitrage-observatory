use super::anchor::get_data;
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;

const NAME: &str = "Bitunix";

// The VIP 0 futures taker of 0.0600 %, one column for every family, see docs/profiles/bitunix/fees.md section 2.
const TAKER_PPM: u32 = 600;

// Every family in one reply, USDT-M, USDC-M and coin-M.
const PAIRS_PATH: &str = "/api/v1/futures/market/trading_pairs";

// bybit lists ONUSDT as a stock and okx's ON-USDT-SWAP is a stock contract, both near 80 USDT, while Bitunix's ONUSDT read 0.1128 on 2026-10-08.
const DENIED: &[(&str, &str)] = &[("ONUSDT", "a different token from the ON that okx and bybit list")];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let pairs: Vec<Pair> = get_data(http, &format!("{rest}{PAIRS_PATH}")).await?;
    let markets = parse(&pairs);
    catalog::finish(ID, NAME, pairs.len(), markets, DENIED)
}

// No CCXT class exists, so the rules are those of docs/profiles/bitunix/rest.md section 2.
// A contract trades when it is OPEN with the API enabled, and the API disabled rows are equities and ETFs no API order can reach.
// The coin-M rows quote USD and their book sizes look like dollars with no document to say so, so they stay out.
fn parse(pairs: &[Pair]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in pairs {
        if row.symbol_status != "OPEN" || !row.is_api_supported || !matches!(row.quote.as_str(), "USDT" | "USDC") {
            continue;
        }

        // On the 13 scaled contracts the base field names the unscaled token, such as PEPE on 1000PEPEUSDT, while prices and sizes are per 1,000 of it.
        let Some(base_id) = row.symbol.strip_suffix(row.quote.as_str()) else {
            continue;
        };
        let base = currency_code(base_id, &[]);
        if base.is_empty() {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote: row.quote.clone(),
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0, // book sizes are coins of the symbol's base, 1,000 PEPE on 1000PEPEUSDT
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pair {
    #[serde(default)]
    symbol: String, // "BTCUSDT", the socket's and the funding batch's id
    #[serde(default)]
    quote: String, // "USDT", "USDC" or "USD" on coin-M
    #[serde(default)]
    symbol_status: String, // "OPEN", "CANCEL_ONLY", "STOP", or the undocumented "PREVIEW"
    #[serde(default)]
    is_api_supported: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the trading pairs reply captured live on 2026-10-08, with a few of the fields the loader ignores.
    fn pair(symbol: &str, base: &str, quote: &str, status: &str, api: bool) -> Value {
        json!({
            "symbol": symbol, "base": base, "quote": quote, "minTradeVolume": "0.0001", "basePrecision": 4,
            "quotePrecision": 1, "maxLeverage": 200, "symbolStatus": status, "isApiSupported": api,
            "maxFundingRate": "0.3", "minFundingRate": "-0.3", "launchTime": "1719403200000",
        })
    }

    fn reply() -> Value {
        json!({ "code": 0, "msg": "Success", "data": [
            pair("BTCUSDT", "BTC", "USDT", "OPEN", true),
            pair("BTCUSDC", "BTC", "USDC", "OPEN", true),
            pair("1000PEPEUSDT", "PEPE", "USDT", "OPEN", true),
            pair("1MBABYDOGEUSDT", "BABYDOGE", "USDT", "OPEN", true),
            pair("TSLAUSDT", "TSLA", "USDT", "OPEN", true),
            pair("ONUSDT", "ON", "USDT", "OPEN", true),
            pair("QQQUSDT", "QQQ", "USDT", "OPEN", false),
            pair("FDUSDUSDT", "FDUSD", "USDT", "PREVIEW", true),
            pair("MILKUSDT", "MILK", "USDT", "CANCEL_ONLY", true), // a documented status that no row carried on 2026-10-08
            pair("BTCUSD", "BTC", "USD", "OPEN", true),
        ]})
    }

    fn parsed() -> Vec<Market> {
        let pairs: Vec<Pair> = serde_json::from_value(reply()["data"].clone()).unwrap();
        parse(&pairs)
    }

    #[test]
    fn keeps_open_usdt_and_usdc_contracts_with_the_api_enabled() {
        assert_eq!(
            raw_ids(&parsed()),
            ["BTCUSDT", "BTCUSDC", "1000PEPEUSDT", "1MBABYDOGEUSDT", "TSLAUSDT", "ONUSDT"]
        );
    }

    #[test]
    fn drops_an_api_disabled_contract_a_preview_or_closing_contract_and_the_coin_margined_family() {
        let ids = raw_ids(&parsed()).join(",");

        assert!(!ids.contains("QQQUSDT"));
        assert!(!ids.contains("FDUSDUSDT"));
        assert!(!ids.contains("MILKUSDT"));
        assert!(!ids.split(',').any(|id| id == "BTCUSD"));
    }

    #[test]
    fn takes_the_base_from_the_symbol_so_a_scaled_contract_keeps_its_multiplier() {
        let markets = parsed();

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!((markets[1].base.as_str(), markets[1].quote.as_str()), ("BTC", "USDC"));
        assert_eq!(markets[2].base, "1000PEPE");
        assert_eq!(markets[3].base, "1MBABYDOGE");
    }

    #[test]
    fn counts_one_coin_per_contract_at_the_vip_0_taker() {
        assert!(parsed().iter().all(|m| m.linear && m.contract_size == 1.0 && m.price_scale == 1.0 && m.taker_ppm == 600));
    }

    #[tokio::test]
    async fn loads_the_catalog_without_the_denied_on_and_fails_on_a_venue_error() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(PAIRS_PATH, reply());
        let venue = load_from(&http(), &rest.url).await.unwrap();
        assert_eq!(venue.id, "bitunix");
        assert_eq!(raw_ids(&venue.markets), ["BTCUSDT", "BTCUSDC", "1000PEPEUSDT", "1MBABYDOGEUSDT", "TSLAUSDT"]);
        assert_eq!(logs.events("market_denied")[0].text("market"), "ONUSDT");
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 10.0);

        // The unknown path answer captured live on 2026-10-08, which comes with HTTP 200.
        let failing = MockRest::start().await;
        failing.reply(PAIRS_PATH, json!({ "code": 404, "data": null, "msg": "Not Found" }));
        let error = load_from(&http(), &failing.url).await.unwrap_err();
        assert!(error.to_string().contains("code 404"), "{error:#}");
    }
}
