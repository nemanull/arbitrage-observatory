use super::anchor::EXCHANGE_INFO_PATH;
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, contract_size, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "HashKey Global";

// The VIP 0 futures taker of 0.060 %, which is also CCXT's swap constant, see docs/profiles/hashkey/fees.md section 2.
const TAKER_PPM: u32 = 600;

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let info: ExchangeInfo = get_json(http, &format!("{rest}{EXCHANGE_INFO_PATH}")).await?;
    let markets = parse(&info.contracts);
    catalog::finish(ID, NAME, info.contracts.len(), markets, &[])
}

// CCXT 4.5.68's hashkey parseMarket for a swap, with commonCurrencies empty.
// A swap is a symbol whose part after the dash is PERPETUAL, its base is `underlying`, and it is active when its status is TRADING.
// `symbols` holds the spot pairs, so only `contracts` is read.
fn parse(contracts: &[Contract]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in contracts {
        if row.symbol.split('-').nth(1) != Some("PERPETUAL") || row.status != "TRADING" || row.inverse != Some(false) {
            continue;
        }

        let base = currency_code(&row.underlying, &[]);
        let quote = currency_code(&row.quote_asset, &[]);
        let settle = currency_code(&row.margin_token, &[]);
        if base.is_empty() || !matches!(quote.as_str(), "USDT" | "USDC" | "USD") || settle != quote {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: contract_size(row.contract_multiplier), // book sizes are whole contracts, 0.001 BTC or 0.001 ETH
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct ExchangeInfo {
    #[serde(default)]
    contracts: Vec<Contract>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Contract {
    #[serde(default)]
    symbol: String, // "BTCUSDT-PERPETUAL", the socket's, the mark's and the funding's id
    #[serde(default)]
    status: String, // "TRADING"
    #[serde(default)]
    underlying: String, // "BTC"
    #[serde(default)]
    quote_asset: String,
    #[serde(default)]
    margin_token: String,
    inverse: Option<bool>, // CCXT reads an absent flag as neither linear nor inverse
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    contract_multiplier: f64, // base coins per contract
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // The two contracts of the exchangeInfo reply captured live on 2026-10-09, cut to the fields the loader reads and a few it ignores.
    // Every other row is the BTC row with one field changed, since the live reply held nothing else.
    fn btc() -> Value {
        json!({
            "exchangeId": "301", "symbol": "BTCUSDT-PERPETUAL", "symbolName": "BTCUSDT-PERPETUAL", "status": "TRADING",
            "baseAsset": "BTCUSDT-PERPETUAL", "baseAssetPrecision": "0.001", "quoteAsset": "USDT", "quoteAssetPrecision": "0.1",
            "inverse": false, "index": "USDT", "marginToken": "USDT", "marginPrecision": "0.0001", "contractMultiplier": "0.001",
            "underlying": "BTC", "tradeStatus": "TRADABLE",
        })
    }

    fn eth() -> Value {
        json!({
            "exchangeId": "301", "symbol": "ETHUSDT-PERPETUAL", "symbolName": "ETHUSDT-PERPETUAL", "status": "TRADING",
            "baseAsset": "ETHUSDT-PERPETUAL", "quoteAsset": "USDT", "inverse": false, "index": "USDT", "marginToken": "USDT",
            "contractMultiplier": "0.001", "underlying": "ETH", "tradeStatus": "TRADABLE",
        })
    }

    fn with(row: Value, changes: Value) -> Value {
        let mut row = row;
        for (key, value) in changes.as_object().unwrap() {
            row[key] = value.clone();
        }
        row
    }

    fn reply() -> Value {
        json!({
            "timezone": "UTC", "site": "BMU",
            "symbols": [{ "symbol": "BTCUSDT", "status": "TRADING", "baseAsset": "BTC", "quoteAsset": "USDT" }],
            "contracts": [
                btc(),
                eth(),
                // The USD margined contract delisted on 2026-09-04 was inverse.
                with(btc(), json!({ "symbol": "BTCUSD-PERPETUAL", "quoteAsset": "USD", "marginToken": "BTC", "inverse": true })),
                with(btc(), json!({ "symbol": "SOLUSDT-PERPETUAL", "underlying": "SOL", "status": "HALT" })),
                with(btc(), json!({ "symbol": "SOLBTC-PERPETUAL", "underlying": "SOL", "quoteAsset": "BTC", "marginToken": "BTC" })),
                with(btc(), json!({ "symbol": "XRPUSDC-PERPETUAL", "underlying": "XRP", "quoteAsset": "USDC", "marginToken": "USDC" })),
            ],
        })
    }

    fn parsed() -> Vec<Market> {
        let info: ExchangeInfo = serde_json::from_value(reply()).unwrap();
        parse(&info.contracts)
    }

    #[test]
    fn keeps_trading_linear_perpetuals_quoted_in_usdt_usdc_or_usd() {
        assert_eq!(raw_ids(&parsed()), ["BTCUSDT-PERPETUAL", "ETHUSDT-PERPETUAL", "XRPUSDC-PERPETUAL"]);
    }

    #[test]
    fn reads_the_base_from_the_underlying_and_the_contract_size_from_the_multiplier() {
        let markets = parsed();

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!((markets[2].base.as_str(), markets[2].quote.as_str()), ("XRP", "USDC"));
        assert_eq!(markets[0].contract_size, 0.001);
        assert_eq!(markets[0].taker_ppm, 600);
        assert_eq!(markets[0].price_scale, 1.0);
        assert!(markets[0].linear);
    }

    #[test]
    fn drops_a_contract_with_no_inverse_flag_and_a_symbol_that_is_not_perpetual() {
        let mut flagless = btc();
        flagless.as_object_mut().unwrap().remove("inverse");
        let contracts: Vec<Contract> = serde_json::from_value(json!([
            flagless,
            with(eth(), json!({ "symbol": "ETHUSDT-20261225" })),
        ]))
        .unwrap();

        assert!(parse(&contracts).is_empty());
    }

    #[tokio::test]
    async fn loads_the_contracts_and_counts_every_contract_row() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(EXCHANGE_INFO_PATH, reply());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "hashkey");
        assert_eq!(venue.name, "HashKey Global");
        assert_eq!(raw_ids(&venue.markets), ["BTCUSDT-PERPETUAL", "ETHUSDT-PERPETUAL", "XRPUSDC-PERPETUAL"]);
        let read = logs.events("catalog_read");
        assert_eq!(read[0].number("rows"), 6.0);
        assert_eq!(read[0].number("kept"), 3.0);
    }
}
