use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "WEEX";

// The VIP 0 futures taker of 0.080 %, see docs/profiles/weex/fees.md section 2.
// The catalog's own takerFeeRate agrees on every row but USDCUSDT, which charges 0.0016, so a higher row rate wins.
const TAKER_PPM: u32 = 800;

// Every perpetual, crypto and TradFi, in one reply with no status field.
// On 2026-10-09 the trades call refused 17 of its 1,036 rows as unknown symbols, 11 of them with an empty book, and nothing in the row tells them apart.
pub const EXCHANGE_INFO_PATH: &str = "/capi/v3/market/exchangeInfo";

// CCXT's weex commonCurrencies, which restore XBT over the base table.
const CODES: &[(&str, &str)] = &[("XBT", "XBT")];

// Each was found on 2026-10-09 by live_identity against binance, bybit, okx, gate and mexc.
// PIUSDT, FOXAUSDT and OUSTUSDT keep a quoted book far from their index with no trade in 24 h, and the trades call refuses them as unknown symbols.
const DENIED: &[(&str, &str)] = &[
    ("ONUSDT", "a different token from the ON that okx and bybit list, 0.115 against the ON Semiconductor stock near 77"),
    ("CATUSDT", "Simon's Cat at 0.000002, where binance and gate list the Caterpillar stock near 805"),
    ("UMCUSDT", "4.47, about a fifth of bybit's UMCUSDT at 23.0, which is the five share ADR, so another listing and unit"),
    ("PIUSDT", "not trading, its book sits at 0.1286 against an index of 0.0814"),
    ("FOXAUSDT", "not trading, its book sits at 49.21 against an index of 62.14"),
    ("OUSTUSDT", "not trading, its book sits at 36.66 against an index of 40.12"),
];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let info: ExchangeInfo = get_json(http, &format!("{rest}{EXCHANGE_INFO_PATH}")).await?;
    let markets = parse(&info.symbols);
    catalog::finish(ID, NAME, info.symbols.len(), markets, DENIED)
}

// CCXT's weex parseMarket for a contract row, which reads every row with a margin asset as an active swap.
// A row is linear when its margin asset is its quote, and every row was USDT margined on 2026-10-09.
// TradFi rows are kept, as decision 4 of the waves design keeps them.
fn parse(symbols: &[Symbol]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in symbols {
        let base = currency_code(&row.base_asset, CODES);
        let quote = currency_code(&row.quote_asset, CODES);
        let settle = currency_code(&row.margin_asset, CODES);
        if row.symbol.is_empty() || base.is_empty() || settle != quote || !matches!(quote.as_str(), "USDT" | "USDC" | "USD") {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM.max(ppm(row.taker_fee_rate)),
            linear: true,
            // Book and order sizes are base coins, and CCXT's contractVal is only the quantity step, 0.0001 on BTCUSDT.
            contract_size: 1.0,
            price_scale: 1.0,
        });
    }

    markets
}

// A missing or unreadable rate reads as 0, so the schedule's taker stands.
fn ppm(rate: f64) -> u32 {
    if rate.is_finite() && rate > 0.0 { (rate * 1_000_000.0).round() as u32 } else { 0 }
}

#[derive(Deserialize)]
struct ExchangeInfo {
    #[serde(default)]
    symbols: Vec<Symbol>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Symbol {
    #[serde(default)]
    symbol: String, // "BTCUSDT", the socket's and the anchor calls' id
    #[serde(default)]
    base_asset: String, // "BTC", "1000PEPE", or "牛来"
    #[serde(default)]
    quote_asset: String,
    #[serde(default)]
    margin_asset: String, // absent on a spot row
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    taker_fee_rate: f64, // 0.0008, or 0.0016 on USDCUSDT
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the exchangeInfo reply captured live on 2026-10-09, with a few of the fields the loader ignores.
    fn row(symbol: &str, base: &str, kind: &str, underlying: &str, contract_val: f64) -> Value {
        json!({
            "symbol": symbol, "displaySymbol": symbol, "baseAsset": base, "quoteAsset": "USDT", "marginAsset": "USDT",
            "contractType": kind, "underlyingType": underlying, "contractVal": contract_val,
            "delivery": ["00:00:00", "08:00:00", "16:00:00"], "forwardContractFlag": true,
            "makerFeeRate": 0.0002, "takerFeeRate": 0.0008, "minOrderSize": contract_val,
        })
    }

    fn reply() -> Value {
        json!({ "timezone": "UTC", "serverTime": 1791567629623_i64, "symbols": [
            row("BTCUSDT", "BTC", "PERPETUAL", "COIN", 0.0001),
            row("1000PEPEUSDT", "1000PEPE", "PERPETUAL", "COIN", 100.0),
            row("牛来USDT", "牛来", "PERPETUAL", "COIN", 0.01),
            row("AAPLUSDT", "AAPL", "TRADIFI_PERPETUAL", "Stocks", 0.01),
            row("JP225USDT", "JP225", "PERPETUAL", "COIN", 0.01),
            row("ONUSDT", "ON", "PERPETUAL", "COIN", 10.0),
            json!({
                "symbol": "USDCUSDT", "baseAsset": "USDC", "quoteAsset": "USDT", "marginAsset": "USDT", "contractType": "PERPETUAL",
                "underlyingType": "COIN", "contractVal": 1, "makerFeeRate": 0.0004, "takerFeeRate": 0.0016,
            }),
            // A row with no fee field, which no live row was on 2026-10-09.
            json!({ "symbol": "DOGEUSDT", "baseAsset": "DOGE", "quoteAsset": "USDT", "marginAsset": "USDT", "contractVal": 100 }),
            // An inverse row, which CCXT's class models and WEEX did not list on 2026-10-09.
            json!({ "symbol": "BTCUSD", "baseAsset": "BTC", "quoteAsset": "USD", "marginAsset": "BTC" }),
        ]})
    }

    fn parsed() -> Vec<Market> {
        let info: ExchangeInfo = serde_json::from_value(reply()).unwrap();
        parse(&info.symbols)
    }

    #[test]
    fn keeps_every_linear_contract_crypto_and_tradfi_alike() {
        assert_eq!(
            raw_ids(&parsed()),
            ["BTCUSDT", "1000PEPEUSDT", "牛来USDT", "AAPLUSDT", "JP225USDT", "ONUSDT", "USDCUSDT", "DOGEUSDT"]
        );
    }

    #[test]
    fn drops_an_inverse_row() {
        assert!(!raw_ids(&parsed()).contains(&"BTCUSD"));
    }

    #[test]
    fn takes_the_base_from_the_base_asset_as_ccxt_does() {
        let markets = parsed();

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!(markets[1].base, "1000PEPE");
        assert_eq!(markets[2].base, "牛来");
        assert_eq!(markets[3].base, "AAPL");
    }

    #[test]
    fn counts_one_coin_per_contract_whatever_the_contract_value() {
        assert!(parsed().iter().all(|m| m.linear && m.contract_size == 1.0 && m.price_scale == 1.0));
    }

    #[test]
    fn charges_the_vip_0_taker_or_a_higher_rate_the_row_carries() {
        let markets = parsed();
        let taker = |id: &str| markets.iter().find(|m| m.raw_market_id == id).unwrap().taker_ppm;

        assert_eq!(taker("BTCUSDT"), 800);
        assert_eq!(taker("USDCUSDT"), 1600);
        assert_eq!(taker("DOGEUSDT"), 800);
    }

    #[tokio::test]
    async fn loads_the_catalog_without_the_denied_on_and_fails_on_a_venue_error() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(EXCHANGE_INFO_PATH, reply());
        let venue = load_from(&http(), &rest.url).await.unwrap();
        assert_eq!(venue.id, "weex");
        assert_eq!(
            raw_ids(&venue.markets),
            ["BTCUSDT", "1000PEPEUSDT", "牛来USDT", "AAPLUSDT", "JP225USDT", "USDCUSDT", "DOGEUSDT"]
        );
        assert_eq!(logs.events("market_denied")[0].text("market"), "ONUSDT");
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 9.0);

        // A bad parameter answers HTTP 400 with a code in the body, as captured live on 2026-10-09.
        let failing = MockRest::start().await;
        failing.fail(EXCHANGE_INFO_PATH, 400);
        let error = load_from(&http(), &failing.url).await.unwrap_err();
        assert!(error.to_string().contains("400"), "{error:#}");
    }
}
