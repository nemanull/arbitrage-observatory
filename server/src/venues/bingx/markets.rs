use super::anchor::get_data;
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;

const NAME: &str = "BingX";

// The published VIP 0 perpetual taker, which every contract row also carries as takerFeeRate 0.0005, see docs/profiles/bingx/fees.md section 2.
// The NC TradFi contracts may pay a regional rate that no unauthenticated call shows.
const TAKER_PPM: u32 = 500;

// USDT-M and USDC-M together, while the coin-M contracts sit on another call and another socket.
const CONTRACTS_PATH: &str = "/openApi/swap/v2/quote/contracts";

// CCXT's bingx commonCurrencies, which keep a ticker shared by two tokens apart.
const CODES: &[(&str, &str)] = &[
    ("SNOW", "Snowman"),
    ("OMNI", "OmniCat"),
    ("NAP", "$NAP"),
    ("TRUMP", "TRUMPMAGA"),
    ("TRUMPSOL", "TRUMP"),
];

// bybit lists ONUSDT as a stock and okx's ON-USDT-SWAP is a stock contract, both near 80 USDT, while BingX's ON-USDT read 0.1107 on 2026-10-08.
const DENIED: &[(&str, &str)] = &[("ON-USDT", "a different token from the ON that okx and bybit list")];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let contracts: Vec<Contract> = get_data(http, &format!("{rest}{CONTRACTS_PATH}")).await?;
    let markets = parse(&contracts);
    catalog::finish(ID, NAME, contracts.len(), markets, DENIED)
}

// CCXT's bingx parseMarket for a swap, keeping only status 1 where CCXT also keeps status 25.
// A status 25 contract takes no new positions, has no premium index row, and its topic is refused with 80015, so it can never book.
fn parse(contracts: &[Contract]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in contracts {
        let tradable = row.status == 1 && row.api_state_open == "true" && row.api_state_close == "true";
        let Some((base_id, quote_id)) = row.symbol.split_once('-') else {
            continue;
        };
        if !tradable || quote_id.contains('-') {
            continue;
        }

        let base = currency_code(base_id, CODES);
        let quote = currency_code(quote_id, CODES);
        let settle = currency_code(&row.currency, CODES);
        if base.is_empty() || settle != quote || !matches!(quote.as_str(), "USDT" | "USDC" | "USD") {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0, // book sizes are coins, and the row's size field is an order step
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Contract {
    #[serde(default)]
    symbol: String, // "BTC-USDT", the socket's and the premium index's id
    #[serde(default)]
    currency: String, // the settlement currency, "USDT" or "USDC"
    #[serde(default)]
    status: i64, // 1 online, 25 no new positions, 5 pre online, 0 offline
    #[serde(default)]
    api_state_open: String, // "true" or "false"
    #[serde(default)]
    api_state_close: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the contracts reply captured live on 2026-10-08, cut to the fields the loader reads and a few it ignores.
    fn contract(symbol: &str, currency: &str, status: i64, api: &str) -> Value {
        let asset = symbol.split('-').next().unwrap();
        json!({
            "contractId": "100", "symbol": symbol, "size": "0.0001", "quantityPrecision": 4, "pricePrecision": 1,
            "takerFeeRate": 0.0005, "currency": currency, "asset": asset, "status": status,
            "apiStateOpen": api, "apiStateClose": api, "offTime": 0, "displayName": symbol,
        })
    }

    fn reply() -> Value {
        json!({ "code": 0, "msg": "", "data": [
            contract("BTC-USDT", "USDT", 1, "true"),
            contract("BTC-USDC", "USDC", 1, "true"),
            contract("NCSKAAPL2USD-USDT", "USDT", 1, "true"),
            contract("1000PEPE-USDT", "USDT", 1, "true"),
            contract("TRUMPSOL-USDT", "USDT", 1, "true"),
            contract("ON-USDT", "USDT", 1, "true"),
            contract("NCCOCOFFEE2USD-USDT", "USDT", 25, "true"),
            contract("POWER-USDT", "USDT", 1, "false"),
            contract("NCSKOLD2USD-USDT", "USDT", 25, "false"),
            contract("BTC-USD", "BTC", 1, "true"),
        ]})
    }

    fn parsed() -> Vec<Market> {
        let contracts: Vec<Contract> = serde_json::from_value(reply()["data"].clone()).unwrap();
        parse(&contracts)
    }

    #[test]
    fn keeps_online_contracts_open_to_the_api_in_both_directions() {
        let markets = parsed();

        assert_eq!(raw_ids(&markets), ["BTC-USDT", "BTC-USDC", "NCSKAAPL2USD-USDT", "1000PEPE-USDT", "TRUMPSOL-USDT", "ON-USDT"]);
    }

    #[test]
    fn reads_base_and_quote_from_the_symbol_with_one_coin_per_contract() {
        let markets = parsed();

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!((markets[1].base.as_str(), markets[1].quote.as_str()), ("BTC", "USDC"));
        assert_eq!(markets[3].base, "1000PEPE");
        assert!(markets.iter().all(|m| m.linear && m.contract_size == 1.0 && m.taker_ppm == 500));
    }

    #[test]
    fn maps_codes_through_the_bingx_table() {
        assert_eq!(parsed()[4].base, "TRUMP");
    }

    #[test]
    fn drops_a_contract_settled_in_its_base() {
        assert!(!raw_ids(&parsed()).contains(&"BTC-USD"));
    }

    #[tokio::test]
    async fn loads_the_catalog_without_the_denied_on_and_fails_on_a_venue_error() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, reply());
        let venue = load_from(&http(), &rest.url).await.unwrap();
        assert_eq!(venue.id, "bingx");
        assert_eq!(raw_ids(&venue.markets), ["BTC-USDT", "BTC-USDC", "NCSKAAPL2USD-USDT", "1000PEPE-USDT", "TRUMPSOL-USDT"]);
        assert_eq!(logs.events("market_denied")[0].text("market"), "ON-USDT");

        let failing = MockRest::start().await;
        failing.reply(CONTRACTS_PATH, json!({ "code": 100400, "msg": "this api is not exist", "data": {} }));
        let error = load_from(&http(), &failing.url).await.unwrap_err();
        assert!(error.to_string().contains("code 100400"), "{error:#}");
    }
}
