use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "Toobit";

// The VIP 0 futures taker of 0.0600 %, one rate for every futures market, see docs/profiles/toobit/fees.md section 2.
// CCXT sets no taker on any Toobit market.
const TAKER_PPM: u32 = 600;

// Spot under symbols and perpetuals under contracts, 2.6 MB decoded, which the edge caches for 10 s.
pub const EXCHANGE_INFO_PATH: &str = "/api/v1/exchangeInfo";

// bybit lists ONUSDT as a stock and okx's ON-USDT-SWAP is a stock contract, both near 80 USDT, while Toobit's ON-SWAP-USDT read 0.1154 on 2026-10-09.
const DENIED: &[(&str, &str)] = &[("ON-SWAP-USDT", "a different token from the ON that okx and bybit list")];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let info: ExchangeInfo = get_json(http, &format!("{rest}{EXCHANGE_INFO_PATH}")).await?;
    let markets = parse(&info.contracts);
    catalog::finish(ID, NAME, info.contracts.len(), markets, DENIED)
}

// CCXT 4.5.68's toobit parseMarket: a row with contractMultiplier is a swap, active when TRADING, linear when not inverse.
// The base is baseAsset cut at the first dash, and the class's commonCurrencies table is empty.
fn parse(contracts: &[Contract]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in contracts {
        if row.status != "TRADING" || row.inverse || !row.contract_multiplier.is_finite() {
            continue;
        }
        if !matches!(row.quote_asset.as_str(), "USDT" | "USDC" | "USD") || row.margin_token != row.quote_asset {
            continue;
        }

        let base_id = row.base_asset.split('-').next().unwrap_or("");
        let base = currency_code(base_id, &[]);
        if base.is_empty() || row.symbol.is_empty() {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote: row.quote_asset.clone(),
            taker_ppm: TAKER_PPM,
            linear: true,
            // Book sizes are contracts of contractMultiplier coins, 0.001 BTC on BTC-SWAP-USDT, see docs/profiles/toobit/websocket.md section 4.
            contract_size: catalog::contract_size(row.contract_multiplier),
            // The 1000 and 1000000 prefixed contracts are priced per that many coins, and so is the base the other venues name them by.
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
pub struct ExchangeInfo {
    #[serde(default)]
    pub contracts: Vec<Contract>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Contract {
    #[serde(default)]
    pub symbol: String, // "BTC-SWAP-USDT", the socket's and every anchor call's id
    #[serde(default)]
    status: String, // "TRADING" on every row on 2026-10-09
    #[serde(default)]
    base_asset: String, // "BTC-SWAP-USDT", whose part before the first dash is the base
    #[serde(default)]
    quote_asset: String,
    #[serde(default)]
    margin_token: String, // the settle currency
    #[serde(default)]
    inverse: bool,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    contract_multiplier: f64, // absent on a spot row
    #[serde(default)]
    pub index_token: String, // "PEPEUSDT" on 1000PEPE-SWAP-USDT, the key of the index reply
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the exchangeInfo reply captured live on 2026-10-09, with a few of the fields the loader ignores.
    fn contract(symbol: &str, quote: &str, multiplier: &str, index_token: &str) -> Value {
        json!({
            "filters": [], "exchangeId": "301", "symbol": symbol, "symbolName": symbol, "status": "TRADING",
            "baseAsset": symbol, "baseAssetPrecision": "0.0001", "quoteAsset": quote, "quoteAssetPrecision": "0.1",
            "icebergAllowed": false, "inverse": false, "index": symbol.split('-').next().unwrap(), "indexToken": index_token,
            "marginToken": quote, "marginPrecision": "0.0001", "contractMultiplier": multiplier,
            "underlying": symbol.split('-').next().unwrap(), "riskLimits": [], "closingStartTime": "0", "closingEndTime": "0",
            "isRwa": false, "categories": [], "minTradePrecision": "0.1",
        })
    }

    fn reply() -> Value {
        let mut aapl = contract("AAPL-SWAP-USDT", "USDT", "0.01", "AAPLUSDT");
        aapl["isRwa"] = json!(true);
        aapl["rwaType"] = json!("STOCK");
        // No row was anything but TRADING and linear on 2026-10-09, so these two are built from the documented values.
        let mut offline = contract("MILK-SWAP-USDT", "USDT", "1", "MILKUSDT");
        offline["status"] = json!("ONLINE");
        let mut inverse = contract("BTC-SWAP-USD", "USD", "1", "BTCUSD");
        inverse["inverse"] = json!(true);
        json!({
            "timezone": "UTC", "serverTime": "1791567617000", "brokerFilters": [],
            "symbols": [{ "symbol": "BTCUSDT", "status": "TRADING", "baseAsset": "BTC", "quoteAsset": "USDT", "filters": [] }],
            "options": [],
            "contracts": [
                contract("BTC-SWAP-USDT", "USDT", "0.001", "BTCUSDT"),
                contract("BTC-SWAP-USDC", "USDC", "0.001", "BTCUSDC"),
                contract("1000PEPE-SWAP-USDT", "USDT", "1", "PEPEUSDT"),
                contract("TON-SWAP-USDT", "USDT", "0.1", "GRAMUSDT"),
                aapl,
                contract("ON-SWAP-USDT", "USDT", "1", "ONUSDT"),
                offline,
                inverse,
            ],
        })
    }

    fn parsed() -> Vec<Market> {
        let info: ExchangeInfo = serde_json::from_value(reply()).unwrap();
        parse(&info.contracts)
    }

    #[test]
    fn keeps_trading_linear_contracts_quoted_in_usdt_or_usdc() {
        assert_eq!(
            raw_ids(&parsed()),
            ["BTC-SWAP-USDT", "BTC-SWAP-USDC", "1000PEPE-SWAP-USDT", "TON-SWAP-USDT", "AAPL-SWAP-USDT", "ON-SWAP-USDT"]
        );
    }

    #[test]
    fn drops_a_contract_that_is_not_trading_an_inverse_contract_and_every_spot_pair() {
        let markets = parsed();
        let ids = raw_ids(&markets);

        for dropped in ["MILK-SWAP-USDT", "BTC-SWAP-USD", "BTCUSDT"] {
            assert!(!ids.contains(&dropped), "{dropped}");
        }
    }

    // CCXT reads a row as a swap only when it carries contractMultiplier, and a coin settled row is not a USD quoted perpetual.
    #[test]
    fn drops_a_row_without_a_contract_multiplier_and_a_row_settled_in_another_coin() {
        let mut no_multiplier = contract("ETH-SWAP-USDT", "USDT", "0.01", "ETHUSDT");
        no_multiplier.as_object_mut().unwrap().remove("contractMultiplier");
        let mut coin_settled = contract("SOL-SWAP-USDT", "USDT", "1", "SOLUSDT");
        coin_settled["marginToken"] = json!("SOL");
        let info: ExchangeInfo = serde_json::from_value(json!({ "contracts": [no_multiplier, coin_settled] })).unwrap();

        assert!(parse(&info.contracts).is_empty());
    }

    #[test]
    fn takes_the_base_before_the_first_dash_so_a_scaled_contract_keeps_its_prefix() {
        let markets = parsed();

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!((markets[1].base.as_str(), markets[1].quote.as_str()), ("BTC", "USDC"));
        assert_eq!(markets[2].base, "1000PEPE");
        assert_eq!(markets[3].base, "TON");
        assert_eq!(markets[4].base, "AAPL");
    }

    #[test]
    fn counts_contract_multiplier_coins_per_contract_at_the_vip_0_taker() {
        let markets = parsed();
        let sizes: Vec<f64> = markets.iter().map(|m| m.contract_size).collect();

        assert_eq!(sizes, [0.001, 0.001, 1.0, 0.1, 0.01, 1.0]);
        assert!(markets.iter().all(|m| m.linear && m.price_scale == 1.0 && m.taker_ppm == 600));
    }

    #[tokio::test]
    async fn loads_the_catalog_without_the_denied_on_and_fails_on_a_venue_error() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(EXCHANGE_INFO_PATH, reply());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "toobit");
        assert_eq!(venue.name, "Toobit");
        assert_eq!(
            raw_ids(&venue.markets),
            ["BTC-SWAP-USDT", "BTC-SWAP-USDC", "1000PEPE-SWAP-USDT", "TON-SWAP-USDT", "AAPL-SWAP-USDT"]
        );
        assert_eq!(logs.events("market_denied")[0].text("market"), "ON-SWAP-USDT");
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 8.0);

        let failing = MockRest::start().await;
        failing.fail(EXCHANGE_INFO_PATH, 403);
        assert!(load_from(&http(), &failing.url).await.is_err());
    }
}
