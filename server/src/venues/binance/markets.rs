use super::{COIN_M_REST, ID, USD_M_REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, contract_size, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "Binance";
const TAKER_PPM: u32 = 500; // VIP 0 on USD-M and COIN-M, the constant CCXT carried for both

const USD_M_PATH: &str = "/fapi/v1/exchangeInfo";
const COIN_M_PATH: &str = "/dapi/v1/exchangeInfo";

// CCXT reads a swap that names no contract type by this delivery date, which every TRADIFI_PERPETUAL carries.
const PERPETUAL_DELIVERY: i64 = 4_133_404_800_000;

const CODES: &[(&str, &str)] = &[("BCC", "BCC"), ("YOYO", "YOYOW")];

const DENIED: &[(&str, &str)] = &[
    ("ONUSDT", "a different token from the ON that okx and bybit list"),
    (
        "ONEUSDT",
        "its index basket is this perp itself, see docs/research/2026-09-15-one-self-index-fresh-gate.md",
    ),
];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, USD_M_REST, COIN_M_REST).await
}

async fn load_from(http: &reqwest::Client, usd_m_rest: &str, coin_m_rest: &str) -> anyhow::Result<Venue> {
    let usd_m_url = format!("{usd_m_rest}{USD_M_PATH}");
    let coin_m_url = format!("{coin_m_rest}{COIN_M_PATH}");
    let (usd_m, coin_m) = tokio::try_join!(
        get_json::<ExchangeInfo>(http, &usd_m_url),
        get_json::<ExchangeInfo>(http, &coin_m_url),
    )?;

    let rows = usd_m.symbols.len() + coin_m.symbols.len();
    let mut markets = parse(&usd_m);
    markets.extend(parse(&coin_m));

    catalog::finish(ID, NAME, rows, markets, DENIED)
}

// CCXT's binance parseMarket for an active swap, which a USD-M and a COIN-M reply share.
fn parse(info: &ExchangeInfo) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in &info.symbols {
        let swap = row.contract_type == "PERPETUAL" || row.delivery_date == Some(PERPETUAL_DELIVERY);
        let status = row.status.as_deref().or(row.contract_status.as_deref());
        if !swap || status != Some("TRADING") || row.symbol.is_empty() {
            continue;
        }

        let base = currency_code(&row.base_asset, CODES);
        let quote = currency_code(&row.quote_asset, CODES);
        let settle = currency_code(&row.margin_asset, CODES);
        if base.is_empty() || quote.is_empty() {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            linear: settle == quote,
            base,
            quote,
            taker_ppm: TAKER_PPM,
            contract_size: contract_size(row.contract_size),
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct ExchangeInfo {
    symbols: Vec<Symbol>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Symbol {
    #[serde(default)]
    symbol: String,
    #[serde(default)]
    contract_type: String, // "PERPETUAL", "TRADIFI_PERPETUAL", "CURRENT_QUARTER"
    delivery_date: Option<i64>,
    status: Option<String>,          // USD-M
    contract_status: Option<String>, // COIN-M
    #[serde(default)]
    base_asset: String,
    #[serde(default)]
    quote_asset: String,
    #[serde(default)]
    margin_asset: String,
    #[serde(default = "one", deserialize_with = "wire::num")]
    contract_size: f64, // COIN-M only, in USD
}

fn one() -> f64 {
    1.0
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Trimmed from the replies of 2026-10-01.
    fn usd_m() -> Value {
        json!({ "symbols": [
            { "symbol": "BTCUSDT", "contractType": "PERPETUAL", "deliveryDate": PERPETUAL_DELIVERY, "status": "TRADING",
              "baseAsset": "BTC", "quoteAsset": "USDT", "marginAsset": "USDT" },
            { "symbol": "XAUUSDT", "contractType": "TRADIFI_PERPETUAL", "deliveryDate": PERPETUAL_DELIVERY, "status": "TRADING",
              "baseAsset": "XAU", "quoteAsset": "USDT", "marginAsset": "USDT" },
            { "symbol": "ETHUSDC", "contractType": "PERPETUAL", "deliveryDate": PERPETUAL_DELIVERY, "status": "TRADING",
              "baseAsset": "ETH", "quoteAsset": "USDC", "marginAsset": "USDC" },
            { "symbol": "BTCUSDT_261225", "contractType": "CURRENT_QUARTER", "deliveryDate": 1798185600000_i64, "status": "TRADING",
              "baseAsset": "BTC", "quoteAsset": "USDT", "marginAsset": "USDT" },
            { "symbol": "ALPACAUSDT", "contractType": "PERPETUAL", "deliveryDate": 1744621200000_i64, "status": "SETTLING",
              "baseAsset": "ALPACA", "quoteAsset": "USDT", "marginAsset": "USDT" },
            { "symbol": "YOYOUSDT", "contractType": "PERPETUAL", "deliveryDate": PERPETUAL_DELIVERY, "status": "TRADING",
              "baseAsset": "YOYO", "quoteAsset": "USDT", "marginAsset": "USDT" },
            { "symbol": "ONUSDT", "contractType": "PERPETUAL", "deliveryDate": PERPETUAL_DELIVERY, "status": "TRADING",
              "baseAsset": "ON", "quoteAsset": "USDT", "marginAsset": "USDT" },
        ]})
    }

    fn coin_m() -> Value {
        json!({ "symbols": [
            { "symbol": "BTCUSD_PERP", "contractType": "PERPETUAL", "deliveryDate": PERPETUAL_DELIVERY, "contractStatus": "TRADING",
              "baseAsset": "BTC", "quoteAsset": "USD", "marginAsset": "BTC", "contractSize": 100 },
            { "symbol": "ETHUSD_PERP", "contractType": "PERPETUAL", "deliveryDate": PERPETUAL_DELIVERY, "contractStatus": "TRADING",
              "baseAsset": "ETH", "quoteAsset": "USD", "marginAsset": "ETH", "contractSize": 10 },
            { "symbol": "BTCUSD_261225", "contractType": "CURRENT_QUARTER", "deliveryDate": 1798185600000_i64, "contractStatus": "TRADING",
              "baseAsset": "BTC", "quoteAsset": "USD", "marginAsset": "BTC", "contractSize": 100 },
        ]})
    }

    fn parsed(reply: Value) -> Vec<Market> {
        parse(&serde_json::from_value(reply).unwrap())
    }

    #[test]
    fn keeps_trading_perpetuals_including_tradfi_and_drops_dated_and_settling_contracts() {
        let markets = parsed(usd_m());

        assert_eq!(raw_ids(&markets), ["BTCUSDT", "XAUUSDT", "ETHUSDC", "YOYOUSDT", "ONUSDT"]);
        assert_eq!(markets[0].base, "BTC");
        assert_eq!(markets[0].quote, "USDT");
        assert!(markets[0].linear);
        assert_eq!(markets[0].contract_size, 1.0);
        assert_eq!(markets[0].taker_ppm, 500);
        assert_eq!(markets[2].quote, "USDC");
    }

    #[test]
    fn maps_codes_through_the_binance_table() {
        let markets = parsed(usd_m());

        assert_eq!(markets[3].base, "YOYOW");
    }

    #[test]
    fn reads_coin_m_contracts_as_inverse_with_their_usd_contract_size() {
        let markets = parsed(coin_m());

        assert_eq!(raw_ids(&markets), ["BTCUSD_PERP", "ETHUSD_PERP"]);
        assert!(!markets[0].linear);
        assert_eq!(markets[0].quote, "USD");
        assert_eq!(markets[0].contract_size, 100.0);
        assert_eq!(markets[1].contract_size, 10.0);
    }

    #[tokio::test]
    async fn loads_both_hosts_and_drops_the_denied_markets() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(USD_M_PATH, usd_m());
        rest.reply(COIN_M_PATH, coin_m());

        let venue = load_from(&http(), &rest.url, &rest.url).await.unwrap();

        assert_eq!(venue.id, "binance");
        assert_eq!(
            raw_ids(&venue.markets),
            ["BTCUSDT", "XAUUSDT", "ETHUSDC", "YOYOUSDT", "BTCUSD_PERP", "ETHUSD_PERP"]
        );
        assert_eq!(logs.events("market_denied")[0].text("market"), "ONUSDT");
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 10.0);
    }

    #[tokio::test]
    async fn fails_when_a_host_fails() {
        let rest = MockRest::start().await;
        rest.reply(USD_M_PATH, usd_m());
        rest.fail(COIN_M_PATH, 500);

        assert!(load_from(&http(), &rest.url, &rest.url).await.is_err());
    }
}
