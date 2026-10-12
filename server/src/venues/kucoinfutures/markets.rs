use super::anchor::{Contract, Reply, contracts};
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::venues::catalog::{self, contract_size, currency_code};

const NAME: &str = "KuCoin Futures";
const TAKER_PPM: u32 = 600; // the published VIP 0 futures taker, and every row's takerFeeRate read 0.0006 on 2026-10-08

// CCXT's kucoin commonCurrencies, which kucoinfutures inherits, less ALT to APTOSLAUNCHTOKEN.
// That entry names the spot token KuCoin listed as ALT, while ALTUSDTM is AltLayer.
// Its index .KALTUSDT averages ALT spot on Binance, Gate, KuCoin, MEXC and Bybit, and its mark matched Binance's ALTUSDT at 0.00728 on 2026-10-08.
const CODES: &[(&str, &str)] = &[
    ("BIFI", "BIFIF"),
    ("VAI", "VAIOT"),
    ("WAX", "WAXP"),
    ("KALT", "ALT"),
    ("FUD", "FTX Users' Debt"),
];

const QUOTES: &[&str] = &["USDT", "USDC", "USD"];

// ONUSDTM traded at 0.109 on 2026-10-08, with gate and mexc, against 79.8 for the stock that okx and bybit list as ON, as binance denies its ONUSDT.
const DENIED: &[(&str, &str)] = &[("ONUSDTM", "a different token from the ON that okx and bybit list")];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Reply = contracts(http, rest).await?;
    let markets = parse(&reply.data);
    catalog::finish(ID, NAME, reply.data.len(), markets, DENIED)
}

// CCXT's kucoin fetchContractMarkets for an active linear swap.
// A row with no nextFundingRateTime is a dated future, and an inverse row counts one USD per contract.
fn parse(rows: &[Contract]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        if row.next_funding_rate_time.is_none() || row.status != "Open" || row.is_inverse {
            continue;
        }

        let base = currency_code(&row.base_currency, CODES);
        let quote = currency_code(&row.quote_currency, CODES);
        if base.is_empty() || !QUOTES.contains(&quote.as_str()) {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: contract_size(row.multiplier.abs()), // lots of multiplier coins, as the REST book and the socket count sizes
            price_scale: 1.0,
        });
    }

    markets
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::kucoinfutures::anchor::CONTRACTS_PATH;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows of GET /api/v1/contracts/active captured live on 2026-10-08, cut down to the fields the loader and the poller read plus a few they ignore.
    fn xbt_usdt() -> Value {
        json!({
            "symbol": "XBTUSDTM", "rootSymbol": "USDT", "type": "FFWCSX", "expireDate": null, "baseCurrency": "XBT",
            "quoteCurrency": "USDT", "settleCurrency": "USDT", "multiplier": 0.001, "isInverse": false, "status": "Open",
            "indexSymbol": ".KXBTUSDT", "fundingFeeRate": 0.0001, "fundingRateGranularity": 28800000,
            "markPrice": 81995.28, "indexPrice": 82023.09, "lastTradePrice": 81989.8, "nextFundingRateTime": 18815784,
            "nextFundingRateDateTime": 1791532800000_i64, "marketStage": "NORMAL", "takerFeeRate": 0.0006,
        })
    }

    fn xbt_usdc() -> Value {
        json!({
            "symbol": "XBTUSDCM", "type": "FFWCSX", "baseCurrency": "XBT", "quoteCurrency": "USDC", "settleCurrency": "USDC",
            "multiplier": 0.0001, "isInverse": false, "status": "Open", "fundingFeeRate": 0.000517,
            "fundingRateGranularity": 28800000, "markPrice": 82012.1, "indexPrice": 81979.36, "nextFundingRateTime": 18815779,
            "nextFundingRateDateTime": 1791532800000_i64, "marketStage": "NORMAL",
        })
    }

    fn alt_usdt() -> Value {
        json!({
            "symbol": "ALTUSDTM", "type": "FFWCSX", "baseCurrency": "ALT", "quoteCurrency": "USDT", "settleCurrency": "USDT",
            "multiplier": 10.0, "isInverse": false, "status": "Open", "fundingFeeRate": 5e-05, "fundingRateGranularity": 14400000,
            "markPrice": 0.007284, "indexPrice": 0.007283, "nextFundingRateTime": 4415784,
            "nextFundingRateDateTime": 1791518400000_i64, "marketStage": "NORMAL",
        })
    }

    fn openai_pre_market() -> Value {
        json!({
            "symbol": "OPENAIUSDTM", "type": "FFWCSX", "baseCurrency": "OPENAI", "quoteCurrency": "USDT", "settleCurrency": "USDT",
            "multiplier": 0.001, "isInverse": false, "status": "Open", "indexSymbol": ".KOPENAIUSDT", "fundingFeeRate": 5e-05,
            "fundingRateGranularity": 28800000, "markPrice": 1657.7, "indexPrice": 1657.48, "nextFundingRateTime": 18815784,
            "nextFundingRateDateTime": 1791532800000_i64, "marketStage": "PRE_MARKET", "assetClass": "STOCK",
        })
    }

    fn xbt_inverse() -> Value {
        json!({
            "symbol": "XBTUSDM", "type": "FFWCSX", "baseCurrency": "XBT", "quoteCurrency": "USD", "settleCurrency": "XBT",
            "multiplier": -1.0, "isInverse": true, "status": "Open", "fundingFeeRate": 0.0001, "fundingRateGranularity": 28800000,
            "markPrice": 81947.7, "indexPrice": 81961.6, "nextFundingRateTime": 18815779,
            "nextFundingRateDateTime": 1791532800000_i64, "marketStage": "NORMAL",
        })
    }

    fn xbt_dated() -> Value {
        json!({
            "symbol": "XBTMZ26", "type": "FFICSX", "expireDate": 1798185600000_i64, "baseCurrency": "XBT", "quoteCurrency": "USD",
            "settleCurrency": "XBT", "multiplier": -1.0, "isInverse": true, "status": "Open", "fundingFeeRate": null,
            "fundingRateGranularity": null, "markPrice": 82799.3, "indexPrice": 81961.6, "nextFundingRateTime": null,
            "nextFundingRateDateTime": null, "marketStage": "NORMAL",
        })
    }

    // Every row read Open on 2026-10-08, so this row is the XBTUSDTM capture with a documented closing status.
    fn paused() -> Value {
        let mut row = xbt_usdt();
        row["symbol"] = json!("OLDUSDTM");
        row["baseCurrency"] = json!("OLD");
        row["status"] = json!("Paused");
        row
    }

    fn reply(rows: Vec<Value>) -> Value {
        json!({ "code": "200000", "data": rows })
    }

    fn parsed(rows: Vec<Value>) -> Vec<Market> {
        let reply: Reply = serde_json::from_value(reply(rows)).unwrap();
        parse(&reply.data)
    }

    #[test]
    fn keeps_open_linear_swaps_in_usdt_and_usdc_with_the_multiplier_as_contract_size() {
        let markets = parsed(vec![xbt_usdt(), xbt_usdc(), openai_pre_market()]);

        assert_eq!(raw_ids(&markets), ["XBTUSDTM", "XBTUSDCM", "OPENAIUSDTM"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!((markets[1].base.as_str(), markets[1].quote.as_str()), ("BTC", "USDC"));
        assert_eq!(markets[0].contract_size, 0.001);
        assert_eq!(markets[1].contract_size, 0.0001);
        assert!(markets[0].linear);
        assert_eq!(markets[0].taker_ppm, 600);
        assert_eq!(markets[0].price_scale, 1.0);
    }

    #[test]
    fn drops_inverse_swaps_dated_futures_and_contracts_that_are_not_open() {
        let markets = parsed(vec![xbt_inverse(), xbt_dated(), paused(), xbt_usdt()]);

        assert_eq!(raw_ids(&markets), ["XBTUSDTM"]);
    }

    // No linear row was quoted in a coin on 2026-10-08, so this row is the XBTUSDTM capture quoted in ETH.
    #[test]
    fn drops_a_linear_swap_quoted_in_a_coin() {
        let mut coin_quoted = xbt_usdt();
        coin_quoted["symbol"] = json!("XBTETHM");
        coin_quoted["quoteCurrency"] = json!("ETH");

        let markets = parsed(vec![coin_quoted, xbt_usdt()]);

        assert_eq!(raw_ids(&markets), ["XBTUSDTM"]);
    }

    #[test]
    fn keeps_alt_as_altlayer_and_maps_other_codes_through_the_kucoin_table() {
        let mut wax = alt_usdt();
        wax["symbol"] = json!("WAXUSDTM");
        wax["baseCurrency"] = json!("WAX");

        let markets = parsed(vec![alt_usdt(), wax]);

        assert_eq!(markets[0].base, "ALT");
        assert_eq!(markets[0].contract_size, 10.0);
        assert_eq!(markets[1].base, "WAXP");
    }

    #[tokio::test]
    async fn loads_the_contracts_of_the_one_catalog_call() {
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, reply(vec![xbt_usdt(), xbt_inverse()]));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "kucoinfutures");
        assert_eq!(venue.name, "KuCoin Futures");
        assert_eq!(raw_ids(&venue.markets), ["XBTUSDTM"]);
    }

    #[tokio::test]
    async fn denies_the_on_contract_that_names_another_token() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        let mut on = alt_usdt();
        on["symbol"] = json!("ONUSDTM");
        on["baseCurrency"] = json!("ON");
        rest.reply(CONTRACTS_PATH, reply(vec![on, xbt_usdt()]));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(raw_ids(&venue.markets), ["XBTUSDTM"]);
        assert_eq!(logs.events("market_denied")[0].text("market"), "ONUSDTM");
    }

    #[tokio::test]
    async fn fails_the_load_on_a_reply_whose_code_is_not_success() {
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, json!({ "code": "400100", "msg": "Parameter error" }));

        let error = load_from(&http(), &rest.url).await.unwrap_err();

        assert!(error.to_string().contains("code 400100: Parameter error"), "{error:#}");
    }
}
