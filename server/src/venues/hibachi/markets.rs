use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;

pub const EXCHANGE_INFO_PATH: &str = "/market/exchange-info";

const NAME: &str = "Hibachi";
const TAKER_PPM: u32 = 450; // tier 1 of the published schedule, and tradeTakerFeeRate "0.00045000" in the live feeConfig

// Decision 3 of the waves design keeps these quotes, and every contract settled in USDT on 2026-10-12.
const QUOTES: [&str; 3] = ["USDT", "USDC", "USD"];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let info: ExchangeInfo = get_json(http, &format!("{rest}{EXCHANGE_INFO_PATH}")).await?;
    let markets = parse(&info.future_contracts);
    catalog::finish(ID, NAME, info.future_contracts.len(), markets, &[])
}

// CCXT's hibachi parseMarket for a contract whose status is LIVE, with the id from symbol, the base from the underlying and the quote from the settlement coin.
// Only Hibachi lists markets, so every row is the venue's own.
fn parse(contracts: &[Contract]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in contracts {
        if row.status != "LIVE" || row.symbol.is_empty() || row.underlying_symbol.is_empty() {
            continue;
        }
        let quote = currency_code(&row.settlement_symbol, &[]);
        if !QUOTES.contains(&quote.as_str()) {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base: currency_code(&row.underlying_symbol, &[]),
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0, // book sizes are coins of the underlying, as CCXT's contractSize of 1 says
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct ExchangeInfo {
    #[serde(default)]
    future_contracts: Vec<Contract>, // the tradable contracts, where the inventory call also keeps the closed ones
}

// The same row in /market/exchange-info and in each entry of /market/inventory.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub(super) struct Contract {
    #[serde(default)]
    pub symbol: String, // "BTC/USDT-P", the socket's symbol
    #[serde(default)]
    underlying_symbol: String, // "BTC"
    #[serde(default)]
    settlement_symbol: String, // "USDT"
    #[serde(default)]
    pub status: String, // "LIVE", "PAUSED" or "CLOSED"
    pub symbol_status: Option<String>, // undocumented, and "OPEN" on all 67 contracts on 2026-10-12, the closed ones included
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // futureContracts rows of /market/exchange-info captured live on 2026-10-12, cut to the fields the call returns for three of 15 contracts.
    fn btc() -> Value {
        json!({
            "category": "CRYPTO", "displayName": "BTC/USDT Perps", "id": 2, "initialMarginRate": "0.050000",
            "maintenanceMarginRate": "0.030000", "marketCloseTimestamp": null, "marketCreationTimestamp": "1727701319.73488",
            "marketOpenTimestamp": null, "minNotional": "1", "minOrderSize": "0.0000000001", "nextCloseTimestamp": null,
            "nextOpenTimestamp": null, "orderbookGranularities": ["0.1", "1", "10", "100"], "settlementDecimals": 6,
            "settlementSymbol": "USDT", "status": "LIVE", "stepSize": "0.0000000001", "symbol": "BTC/USDT-P",
            "symbolStatus": "OPEN", "tickSize": "0.1", "underlyingDecimals": 10, "underlyingSymbol": "BTC",
        })
    }

    fn xag() -> Value {
        json!({
            "category": "FX", "displayName": "XAG/USDT Perps", "id": 65, "marketCloseTimestamp": null,
            "marketOpenTimestamp": "1783609200", "nextCloseTimestamp": "1791925200", "nextOpenTimestamp": null,
            "orderbookGranularities": ["0.01", "0.1", "1", "10"], "settlementSymbol": "USDT", "status": "LIVE",
            "symbol": "XAG/USDT-P", "symbolStatus": "OPEN", "tickSize": "0.01", "underlyingSymbol": "XAG",
        })
    }

    fn jpy() -> Value {
        json!({
            "category": "FX", "displayName": "JPY/USDT Perps", "id": 66, "settlementSymbol": "USDT", "status": "LIVE",
            "symbol": "JPY/USDT-P", "symbolStatus": "OPEN", "tickSize": "0.000001", "underlyingSymbol": "JPY",
        })
    }

    // A closed contract of /market/inventory, the same row shape, which exchange-info no longer lists.
    fn fartcoin_closed() -> Value {
        json!({
            "category": "CRYPTO", "displayName": "FARTCOIN/USDT Flash", "id": 4, "marketCloseTimestamp": "1763391600",
            "settlementSymbol": "USDT", "status": "CLOSED", "symbol": "FARTCOIN/USDT-P", "symbolStatus": "OPEN",
            "tickSize": "0.000001", "underlyingSymbol": "FARTCOIN",
        })
    }

    // Every contract settled in USDT on 2026-10-12, so this row is the BTC capture settled in a coin, a family the venue does not list.
    fn btc_coin_settled() -> Value {
        let mut row = btc();
        row["symbol"] = json!("BTC/BTC-P");
        row["settlementSymbol"] = json!("BTC");
        row
    }

    fn parsed(rows: Value) -> Vec<Market> {
        let rows: Vec<Contract> = serde_json::from_value(rows).unwrap();
        parse(&rows)
    }

    #[test]
    fn keeps_each_live_usdt_contract_by_its_symbol_as_a_linear_market_of_one_coin() {
        let markets = parsed(json!([btc(), fartcoin_closed(), btc_coin_settled(), xag(), jpy()]));

        assert_eq!(raw_ids(&markets), ["BTC/USDT-P", "XAG/USDT-P", "JPY/USDT-P"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!((markets[1].base.as_str(), markets[2].base.as_str()), ("XAG", "JPY"));
        assert!(markets.iter().all(|m| m.linear && m.taker_ppm == 450 && m.contract_size == 1.0 && m.price_scale == 1.0));
        assert!(markets.iter().all(|m| m.venue_id == "hibachi"));
    }

    // Every contract read LIVE or CLOSED on 2026-10-12, so this row is the XAG capture with the documented PAUSED status.
    #[test]
    fn drops_a_paused_contract_as_ccxt_reads_it_inactive() {
        let mut row = xag();
        row["status"] = json!("PAUSED");

        assert!(parsed(json!([row])).is_empty());
    }

    #[test]
    fn maps_the_underlying_through_the_base_table() {
        let mut row = btc();
        row["underlyingSymbol"] = json!("xbt");

        assert_eq!(parsed(json!([row]))[0].base, "BTC");
    }

    #[tokio::test]
    async fn loads_the_future_contracts_of_exchange_info() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(
            EXCHANGE_INFO_PATH,
            json!({ "feeConfig": {}, "futureContracts": [btc(), xag()], "maintenanceWindow": [], "status": "NORMAL" }),
        );

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(rest.calls(), [EXCHANGE_INFO_PATH]);
        assert_eq!((venue.id.as_str(), venue.name.as_str()), ("hibachi", "Hibachi"));
        assert_eq!(raw_ids(&venue.markets), ["BTC/USDT-P", "XAG/USDT-P"]);
        assert_eq!(logs.events("catalog_read")[0].number("kept"), 2.0);
    }

    #[tokio::test]
    async fn fails_a_load_with_no_live_contract_or_a_failed_call() {
        let (_logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(EXCHANGE_INFO_PATH, json!({ "futureContracts": [fartcoin_closed()] }));

        assert!(load_from(&http(), &rest.url).await.is_err());

        rest.fail(EXCHANGE_INFO_PATH, 500);
        assert!(load_from(&http(), &rest.url).await.is_err());
    }
}
