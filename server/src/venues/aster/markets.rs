use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "Aster";

pub const EXCHANGE_INFO_PATH: &str = "/fapi/v3/exchangeInfo";

// The VIP 1 takers of 2026-10-12, the base tier, since the venue has no VIP 0.
const GENERAL_TAKER_PPM: u32 = 400;
const GROUP_B_TAKER_PPM: u32 = 1_000;
const RWA_TAKER_PPM: u32 = 125;

// The fees page's Group B list, read on 2026-10-12, which no API carries.
// The VIP page leaves out PENGUINUSDT and SKHYNIXUSDT, and the higher taker is kept so a cross is never overstated.
const GROUP_B: &[&str] = &[
    "1000NEXUSDT",
    "AEONUSDT",
    "ASTEROIDUSDT",
    "AVLUSDT",
    "BAYUSDT",
    "BASECATUSDT",
    "BLENDUSDT",
    "B3USDT",
    "CARDSUSDT",
    "CATEUSDT",
    "DELTAUSDT",
    "FONEUSDT",
    "MEMEUSDT",
    "MARSCOINUSDT",
    "NESUSDT",
    "OUSDT",
    "OKBUSDT",
    "PENGUINUSDT",
    "PUNDIAIUSDT",
    "RTXUSDT",
    "SKHYNIXUSDT",
];

// No field names the fee class, and symbolType 1 marks exactly the stock, ETF and commodity rows.
const RWA_SYMBOL_TYPE: f64 = 1.0;

// A project lists an AOS-2 market by stake and validator vote under a plain symbol, so its ticker can name another token.
const THIRD_PARTY_TAG: &str = "AOS2";

const QUOTES: [&str; 3] = ["USDT", "USDC", "USD"];

// Each checked against the reference venues on 2026-10-12, with the venue's basket read from GET /fapi/v3/indexreferences.
const DENIED: &[(&str, &str)] = &[
    (
        "AIUSDT",
        "an AI token indexed on Binance Alpha and MEXC's AIINUUSDT at 0.088, while okx lists another AI at 0.0196",
    ),
    (
        "MEMEUSDT",
        "a MEME token indexed on Binance Alpha and MEXC's MEMEROBINHOODUSDT at 0.0124, while binance, bybit, okx, gate and mexc list Memecoin at 0.00054",
    ),
    ("ONUSDT", "the ON token, while bybit and okx list the ON Semiconductor stock as ON"),
    (
        "RTXUSDT",
        "the RTX token of Bitget and Binance Alpha at 0.67, while gate lists the RTX Corporation stock at 188.63",
    ),
];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let info: ExchangeInfo = get_json(http, &format!("{rest}{EXCHANGE_INFO_PATH}")).await?;
    let markets = parse(&info);
    catalog::finish(ID, NAME, info.symbols.len(), markets, DENIED)
}

// CCXT's aster parseMarket for an active linear swap, with the markets a third party listed left out.
// The class has no commonCurrencies of its own, so only the base table applies.
fn parse(info: &ExchangeInfo) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in &info.symbols {
        // A pending row has an empty contract type, which CCXT reads as spot.
        if row.contract_type != "PERPETUAL" || row.status != "TRADING" || row.symbol.is_empty() || row.base_asset.is_empty() {
            continue;
        }

        let base = currency_code(&row.base_asset, &[]);
        let quote = currency_code(&row.quote_asset, &[]);
        let settle = currency_code(&row.margin_asset, &[]);
        if !QUOTES.contains(&quote.as_str()) || settle != quote {
            continue;
        }

        if row.underlying_sub_type.iter().flatten().any(|tag| tag == THIRD_PARTY_TAG) {
            tracing::info!(event = "market_third_party", venue = ID, market = %row.symbol, tag = THIRD_PARTY_TAG);
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: taker_ppm(row),
            linear: true,
            contract_size: 1.0, // no row carries contractSize or unit, and book sizes are base coins
            price_scale: 1.0,
        });
    }

    markets
}

fn taker_ppm(row: &Symbol) -> u32 {
    if GROUP_B.contains(&row.symbol.as_str()) {
        GROUP_B_TAKER_PPM
    } else if row.symbol_type == RWA_SYMBOL_TYPE {
        RWA_TAKER_PPM
    } else {
        GENERAL_TAKER_PPM
    }
}

#[derive(Deserialize)]
struct ExchangeInfo {
    symbols: Vec<Symbol>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Symbol {
    #[serde(default)]
    symbol: String, // "BTCUSDT", "B-MONEYUSDT" or "币安人生USDT"
    #[serde(default)]
    status: String, // "TRADING", "SETTLING" or "PENDING_TRADING"
    #[serde(default)]
    contract_type: String, // "PERPETUAL", or empty on a pending row
    #[serde(default)]
    base_asset: String,
    #[serde(default)]
    quote_asset: String, // "USDT", "USD1" or "U"
    #[serde(default)]
    margin_asset: String,
    #[serde(default)]
    underlying_sub_type: Option<Vec<String>>, // ["STOCK"], ["Meme"], ["Commodities", "AOS2", "USD1-RWA"]
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    symbol_type: f64, // 0, or 1 on stocks, ETFs and commodities
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    fn row(symbol: &str, status: &str, contract_type: &str, base: &str, quote: &str, tags: &[&str], symbol_type: i64) -> Value {
        json!({
            "symbol": symbol, "status": status, "contractType": contract_type, "baseAsset": base, "quoteAsset": quote,
            "marginAsset": quote, "underlyingSubType": tags, "symbolType": symbol_type, "deliveryDate": 4133404800000_i64,
        })
    }

    // Rows of GET /fapi/v3/exchangeInfo captured live on 2026-10-12, cut to the fields the loader reads.
    fn exchange_info() -> Value {
        json!({ "symbols": [
            row("BTCUSDT", "TRADING", "PERPETUAL", "BTC", "USDT", &["Top"], 0),
            row("AAPLUSDT", "TRADING", "PERPETUAL", "AAPL", "USDT", &["STOCK"], 1),
            row("SKHYNIXUSDT", "TRADING", "PERPETUAL", "SKHYNIX", "USDT", &["STOCK", "Semiconductor"], 1),
            row("OKBUSDT", "TRADING", "PERPETUAL", "OKB", "USDT", &[], 0),
            row("币安人生USDT", "TRADING", "PERPETUAL", "币安人生", "USDT", &["Meme"], 0),
            row("B-MONEYUSDT", "TRADING", "PERPETUAL", "B-MONEY", "USDT", &["Meme"], 0),
            row("TONUSDT", "SETTLING", "PERPETUAL", "TON", "USDT", &["Top"], 0),
            row("MBLUSDT", "PENDING_TRADING", "", "MBL", "USDT", &[], 0),
            row("BTCUSD1", "TRADING", "PERPETUAL", "BTC", "USD1", &[], 0),
            row("BTCU", "TRADING", "PERPETUAL", "BTC", "U", &["AOS2"], 0),
            row("XAUUSD1", "TRADING", "PERPETUAL", "XAU", "USD1", &["Commodities", "AOS2", "USD1-RWA"], 1),
            row("ONUSDT", "TRADING", "PERPETUAL", "ON", "USDT", &[], 0),
        ]})
    }

    fn parsed(reply: Value) -> Vec<Market> {
        parse(&serde_json::from_value(reply).unwrap())
    }

    #[test]
    fn keeps_trading_usdt_perpetuals_and_drops_settling_pending_and_other_quotes() {
        let markets = parsed(exchange_info());

        assert_eq!(
            raw_ids(&markets),
            ["BTCUSDT", "AAPLUSDT", "SKHYNIXUSDT", "OKBUSDT", "币安人生USDT", "B-MONEYUSDT", "ONUSDT"]
        );
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert!(markets.iter().all(|m| m.linear && m.contract_size == 1.0 && m.price_scale == 1.0));
    }

    #[test]
    fn sets_the_taker_of_each_fee_class_with_group_b_over_rwa() {
        let markets = parsed(exchange_info());

        let takers: Vec<(&str, u32)> = markets.iter().map(|m| (m.raw_market_id.as_str(), m.taker_ppm)).collect();
        assert_eq!(
            takers,
            [
                ("BTCUSDT", 400),
                ("AAPLUSDT", 125),
                ("SKHYNIXUSDT", 1_000),
                ("OKBUSDT", 1_000),
                ("币安人生USDT", 400),
                ("B-MONEYUSDT", 400),
                ("ONUSDT", 400),
            ]
        );
    }

    #[test]
    fn keeps_an_id_in_chinese_characters_and_a_hyphenated_base_as_written() {
        let markets = parsed(exchange_info());

        assert_eq!(markets[4].base, "币安人生");
        assert_eq!(markets[5].base, "B-MONEY");
    }

    #[test]
    fn leaves_out_a_third_party_listing_even_when_quoted_in_usdt() {
        let (logs, _capture) = capture();
        let reply = json!({ "symbols": [
            row("BTCUSDT", "TRADING", "PERPETUAL", "BTC", "USDT", &["Top"], 0),
            row("NEWUSDT", "TRADING", "PERPETUAL", "NEW", "USDT", &["Meme", "AOS2"], 0),
        ]});

        let markets = parsed(reply);

        assert_eq!(raw_ids(&markets), ["BTCUSDT"]);
        assert_eq!(logs.events("market_third_party")[0].text("market"), "NEWUSDT");
    }

    #[tokio::test]
    async fn loads_the_catalog_and_drops_the_denied_markets() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(EXCHANGE_INFO_PATH, exchange_info());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "aster");
        assert_eq!(venue.name, "Aster");
        assert_eq!(venue.markets.len(), 6);
        assert!(!venue.markets.iter().any(|m| m.raw_market_id == "ONUSDT"));
        assert_eq!(logs.events("market_denied")[0].text("market"), "ONUSDT");
        let read = logs.events("catalog_read");
        assert_eq!(read[0].number("rows"), 12.0);
        assert_eq!(read[0].number("perpetuals"), 7.0);
        assert_eq!(read[0].number("kept"), 6.0);
    }

    #[tokio::test]
    async fn fails_when_the_host_fails() {
        let rest = MockRest::start().await;
        rest.fail(EXCHANGE_INFO_PATH, 500);

        assert!(load_from(&http(), &rest.url).await.is_err());
    }
}
