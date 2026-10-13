use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;

const NAME: &str = "ApeX";
const TAKER_PPM: u32 = 500; // the level 1 taker of crypto and TradFi perpetuals alike, where CCXT swaps it with the maker's 200

// GET All Config Data, whose contractConfig holds one list per contract family.
pub(super) const SYMBOLS_PATH: &str = "/v3/symbols";

// Settlement assets a perpetual may carry, which decision 3 of the waves design keeps.
const QUOTES: &[&str] = &["USDT", "USDC", "USD"];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

// The crypto perpetuals CCXT reads and the TradFi perpetuals it does not, which decision 4 of the waves design keeps.
// The prediction contracts are another product, and the pre-launch list was empty on 2026-10-12.
pub(super) async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Reply = get_json(http, &format!("{rest}{SYMBOLS_PATH}")).await?;

    // An error comes back as HTTP 200 with a code and no data.
    let Some(data) = reply.data else {
        anyhow::bail!("{ID} symbols reply carries no data: code {}, {}", reply.code.unwrap_or(0), reply.msg.unwrap_or_default());
    };
    let config = data.contract_config;
    let rows = config.perpetual_contract.len() + config.stock_contract.len();

    let mut markets = parse(&config.perpetual_contract);
    markets.extend(parse(&config.stock_contract));
    catalog::finish(ID, NAME, rows, markets, &[])
}

// CCXT's apex parseMarket for an active swap, with two departures.
// The raw id is crossSymbolName, CCXT's id2, because the socket and every market data call key by BTCUSDT and refuse BTC-USDT.
// A row the venue hides is left out: IO-USDT and STBL-USDT trade in the catalog but sent no book and had empty REST books on 2026-10-12.
fn parse(rows: &[Row]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        if row.enable_trade != Some(true) || row.enable_display != Some(true) {
            continue;
        }
        if row.cross_symbol_name.is_empty() || row.base_token_id.is_empty() {
            continue;
        }

        let quote = currency_code(&row.settle_asset_id, &[]);
        if !QUOTES.contains(&quote.as_str()) {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.cross_symbol_name.clone(),
            base: currency_code(&row.base_token_id, &[]), // CCXT's apex commonCurrencies is empty
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0, // book sizes are base coins, where CCXT copies minOrderSize, 0.001 on BTC and 100 on 1000PEPE
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct Reply {
    data: Option<Data>,
    code: Option<i64>,
    msg: Option<String>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Data {
    contract_config: ContractConfig,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ContractConfig {
    #[serde(default)]
    perpetual_contract: Vec<Row>, // crypto perpetuals, the list CCXT reads
    #[serde(default)]
    stock_contract: Vec<Row>, // stocks, ETFs, indexes and commodities, priced by Chainlink
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Row {
    #[serde(default)]
    cross_symbol_name: String, // "BTCUSDT", where symbol is "BTC-USDT"
    #[serde(default)]
    base_token_id: String,
    #[serde(default)]
    settle_asset_id: String, // CCXT's quote and settle alike
    enable_trade: Option<bool>, // CCXT's active
    enable_display: Option<bool>, // false on a row the venue's own front end hides
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // A row of GET /api/v3/symbols captured live on 2026-10-12, cut to the fields the loader reads and a few beside them.
    fn row(symbol: &str, base: &str, trade: bool, display: bool, min_order_size: &str) -> Value {
        json!({
            "crossSymbolName": format!("{base}USDT"), "symbol": symbol, "symbolDisplayName": format!("{base}USDT"),
            "baseTokenId": base, "settleAssetId": "USDT", "l2PairId": "50001",
            "enableTrade": trade, "enableDisplay": display, "enableOpenPosition": trade && display,
            "minOrderSize": min_order_size, "stepSize": min_order_size, "tickSize": "0.1",
            "contractType": "UNKNOWN_CONTRACT_TYPE",
        })
    }

    // Two trading crypto perpetuals, one delisted, IO-USDT as the catalog showed it, two TradFi rows, and a prediction contract.
    fn reply() -> Value {
        json!({
            "data": {
                "spotConfig": {},
                "contractConfig": {
                    "perpetualContract": [
                        row("BTC-USDT", "BTC", true, true, "0.0010"),
                        row("1000PEPE-USDT", "1000PEPE", true, true, "100"),
                        row("MATIC-USDT", "MATIC", false, false, "1"),
                        row("IO-USDT", "IO", true, false, "0.1"),
                    ],
                    "stockContract": [
                        { "crossSymbolName": "AAPLUSDT", "symbol": "AAPL-USDT", "baseTokenId": "AAPL", "settleAssetId": "USDT",
                          "enableTrade": true, "enableDisplay": true, "minOrderSize": "0.01", "contractType": "STOCK_CONTRACT", "category": "STOCK" },
                        { "crossSymbolName": "GMEUSDT", "symbol": "GME-USDT", "baseTokenId": "GME", "settleAssetId": "USDT",
                          "enableTrade": false, "enableDisplay": false, "minOrderSize": "0.01", "contractType": "STOCK_CONTRACT" },
                    ],
                    "predictionContract": [
                        { "crossSymbolName": "BTC100KUSDT", "symbol": "BTC100K-USDT", "baseTokenId": "BTC100K", "settleAssetId": "USDT",
                          "enableTrade": true, "enableDisplay": true, "contractType": "PREDICTION_CONTRACT" },
                    ],
                    "prelaunchContract": [],
                },
            },
            "timeCost": 812_345,
        })
    }

    fn parsed(rows: Value) -> Vec<Market> {
        let rows: Vec<Row> = serde_json::from_value(rows).unwrap();
        parse(&rows)
    }

    #[test]
    fn keeps_trading_perpetuals_by_cross_symbol_name_as_linear_usdt_markets_of_one_coin() {
        let markets = parsed(reply()["data"]["contractConfig"]["perpetualContract"].clone());

        assert_eq!(raw_ids(&markets), ["BTCUSDT", "1000PEPEUSDT"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!(markets[1].base, "1000PEPE");
        assert!(markets.iter().all(|m| m.linear && m.taker_ppm == 500 && m.contract_size == 1.0 && m.price_scale == 1.0));
    }

    #[test]
    fn leaves_out_a_row_the_venue_hides_although_it_trades() {
        let markets = parsed(json!([row("IO-USDT", "IO", true, false, "0.1"), row("STBL-USDT", "STBL", true, false, "1")]));

        assert!(markets.is_empty());
    }

    #[test]
    fn leaves_out_a_settlement_outside_usdt_usdc_and_usd_and_a_row_without_a_socket_name() {
        let mut eur = row("ETH-EUR", "ETH", true, true, "0.01");
        eur["settleAssetId"] = json!("EUR");
        let mut unnamed = row("SOL-USDT", "SOL", true, true, "0.1");
        unnamed["crossSymbolName"] = json!("");

        assert!(parsed(json!([eur, unnamed])).is_empty());
    }

    #[tokio::test]
    async fn loads_the_crypto_and_tradfi_perpetuals_and_not_the_prediction_contracts() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(SYMBOLS_PATH, reply());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(rest.calls(), [SYMBOLS_PATH]);
        assert_eq!(venue.id, "apex");
        assert_eq!(venue.name, "ApeX");
        assert_eq!(raw_ids(&venue.markets), ["BTCUSDT", "1000PEPEUSDT", "AAPLUSDT"]);
        assert_eq!(venue.markets[2].base, "AAPL");
        let read = logs.events("catalog_read");
        assert_eq!(read[0].number("rows"), 6.0);
        assert_eq!(read[0].number("perpetuals"), 3.0);
        assert_eq!(read[0].number("kept"), 3.0);
    }

    // The error shape /v3/history-funding answered for an unknown symbol on 2026-10-12, since every error comes back as HTTP 200.
    #[tokio::test]
    async fn a_reply_with_a_code_and_no_data_fails_the_load() {
        let rest = MockRest::start().await;
        rest.reply(SYMBOLS_PATH, json!({ "code": 3, "msg": "invalid symbol: NOPE-USDT", "timeCost": 1_085 }));

        let error = load_from(&http(), &rest.url).await.unwrap_err();

        assert!(error.to_string().contains("code 3, invalid symbol"), "{error:#}");
    }

    #[tokio::test]
    async fn a_failed_symbols_call_fails_the_load() {
        let rest = MockRest::start().await;
        rest.fail(SYMBOLS_PATH, 500);

        assert!(load_from(&http(), &rest.url).await.is_err());
    }
}
