use super::anchor::get_data;
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "Poloniex";

// The published VIP 0 futures taker of 0.06 %, see docs/profiles/poloniex/fees.md section 2.
// The unrendered rank table says 0.05 %, and CCXT reads no taker for a swap.
const TAKER_PPM: u32 = 600;

pub const INSTRUMENTS_PATH: &str = "/v3/market/allInstruments";

// CCXT 4.5.68's poloniex commonCurrencies.
const CODES: &[(&str, &str)] = &[
    ("AIR", "AirCoin"),
    ("APH", "AphroditeCoin"),
    ("BCC", "BTCtalkcoin"),
    ("BCHABC", "BCHABC"),
    ("BDG", "Badgercoin"),
    ("BTM", "Bitmark"),
    ("CON", "Coino"),
    ("ETHTRON", "ETH"),
    ("GOLD", "GoldEagles"),
    ("GPUC", "GPU"),
    ("HOT", "Hotcoin"),
    ("ITC", "Information Coin"),
    ("KEY", "KEYCoin"),
    ("MASK", "NFTX Hashmasks Index"),
    ("MEME", "Degenerator Meme"),
    ("PLX", "ParallaxCoin"),
    ("REPV2", "REP"),
    ("STR", "XLM"),
    ("SOC", "SOCC"),
    ("TRADE", "Unitrade"),
    ("TRXETH", "TRX"),
    ("XAP", "API Coin"),
    ("USDTBSC", "USDT"),
    ("USDTTRON", "USDT"),
    ("USDTETH", "USDT"),
    ("UST", "USTC"),
];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let instruments: Vec<Instrument> = get_data(http, &format!("{rest}{INSTRUMENTS_PATH}")).await?;
    let markets = parse(&instruments);
    catalog::finish(ID, NAME, instruments.len(), markets, &[])
}

// CCXT's parseSwapMarket: active is status OPEN, linear is ctType LINEAR, and a row with an alias is a dated future.
fn parse(instruments: &[Instrument]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in instruments {
        if row.status != "OPEN" || row.ct_type != "LINEAR" || !row.alias.is_empty() {
            continue;
        }

        let base = currency_code(&row.base, CODES);
        let quote = currency_code(&row.quote, CODES);
        let settle = currency_code(&row.settle, CODES);
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
            contract_size: catalog::contract_size(row.ct_val), // book sizes are contracts of ctVal coins
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct Instrument {
    #[serde(default)]
    symbol: String, // "BTC_USDT_PERP", the socket's and every anchor call's id
    #[serde(default, rename = "bCcy")]
    base: String, // "1000PEPE" keeps its 1000
    #[serde(default, rename = "qCcy")]
    quote: String,
    #[serde(default, rename = "sCcy")]
    settle: String,
    #[serde(default)]
    status: String, // "OPEN", "PAUSED", "CLOSED", "CANCEL_ONLY" or "CANCEL_CLOSE_ONLY"
    #[serde(default, rename = "ctType")]
    ct_type: String, // "LINEAR" or "INVERSE"
    #[serde(default)]
    alias: String, // "" on a perpetual, "this_week" or "quarter" on a dated future
    #[serde(default = "wire::nan", deserialize_with = "wire::num", rename = "ctVal")]
    ct_val: f64, // coins per contract, "0.001" on BTC
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the reply captured live on 2026-10-09 at 19:11 UTC, which held 18 rows, all OPEN, LINEAR and USDT.
    // The closed, inverse, dated and USDC rows reuse a captured row with the documented values, since none was listed.
    fn instrument(symbol: &str, base: &str, settle: &str, status: &str, ct_type: &str, alias: &str, ct_val: &str) -> Value {
        json!({
            "symbol": symbol, "bAsset": format!(".P{base}{settle}"), "bCcy": base, "qCcy": settle,
            "visibleStartTime": "1620390600000", "tradableStartTime": "1620390600000", "sCcy": settle, "tSz": "0.001",
            "pxScale": "0.001,0.01,0.1,1,10", "lotSz": 1, "minSz": 1, "ctVal": ct_val, "status": status,
            "oDate": "1620287590000", "maxLever": "50", "lever": "10", "ctType": ct_type, "alias": alias,
        })
    }

    fn instruments() -> Value {
        json!({ "code": 200, "msg": "Success", "data": [
            instrument("BTC_USDT_PERP", "BTC", "USDT", "OPEN", "LINEAR", "", "0.001"),
            instrument("1000PEPE_USDT_PERP", "1000PEPE", "USDT", "OPEN", "LINEAR", "", "1000"),
            instrument("HOT_USDT_PERP", "HOT", "USDT", "OPEN", "LINEAR", "", "1000"),
            instrument("ETH_USDC_PERP", "ETH", "USDC", "OPEN", "LINEAR", "", "0.01"),
            instrument("FIL_USDT_PERP", "FIL", "USDT", "PAUSED", "LINEAR", "", "1"),
            instrument("BTC_USD_PERP", "BTC", "BTC", "OPEN", "INVERSE", "", "100"),
            instrument("BTC_USDT_QUARTER", "BTC", "USDT", "OPEN", "LINEAR", "quarter", "0.001"),
        ]})
    }

    fn parsed(reply: Value) -> Vec<Market> {
        let instruments: Vec<Instrument> = serde_json::from_value(reply["data"].clone()).unwrap();
        parse(&instruments)
    }

    #[test]
    fn keeps_open_linear_perpetuals_with_ctval_as_the_contract_size() {
        let markets = parsed(instruments());

        assert_eq!(raw_ids(&markets), ["BTC_USDT_PERP", "1000PEPE_USDT_PERP", "HOT_USDT_PERP", "ETH_USDC_PERP"]);
        let btc = &markets[0];
        assert_eq!((btc.base.as_str(), btc.quote.as_str()), ("BTC", "USDT"));
        assert_eq!(btc.contract_size, 0.001);
        assert_eq!(btc.taker_ppm, 600);
        assert!(btc.linear);
        assert_eq!(btc.price_scale, 1.0);
        assert_eq!(markets[1].base, "1000PEPE");
        assert_eq!(markets[1].contract_size, 1000.0);
        assert_eq!(markets[3].quote, "USDC");
    }

    #[test]
    fn maps_codes_through_the_poloniex_table() {
        let markets = parsed(instruments());

        assert_eq!(markets[2].base, "Hotcoin");
    }

    #[test]
    fn drops_a_paused_row_an_inverse_row_and_a_dated_future() {
        let ids = raw_ids(&parsed(instruments())).join(",");

        assert!(!ids.contains("FIL_USDT_PERP"));
        assert!(!ids.contains("BTC_USD_PERP"));
        assert!(!ids.contains("BTC_USDT_QUARTER"));
    }

    #[tokio::test]
    async fn loads_the_perpetuals() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, instruments());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "poloniex");
        assert_eq!(venue.name, "Poloniex");
        assert_eq!(venue.markets.len(), 4);
    }

    #[tokio::test]
    async fn fails_on_a_reply_with_an_error_code() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, json!({ "code": 24101, "msg": "Invalid symbol!", "data": "" }));

        let error = load_from(&http(), &rest.url).await.unwrap_err();

        assert!(error.to_string().contains("code 24101: Invalid symbol!"), "{error:#}");
    }
}
