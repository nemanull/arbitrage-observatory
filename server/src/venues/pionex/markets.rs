use super::anchor::get_data;
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;

const NAME: &str = "Pionex";

// The Regular futures taker of 0.05 %, one column for every family, see docs/profiles/pionex/fees.md section 4.
const TAKER_PPM: u32 = 500;

// The type defaults to SPOT, and every perpetual family comes in one reply.
const SYMBOLS_PATH: &str = "/api/v1/common/symbols?type=PERP";

const USDT_SUFFIX: &str = "_USDT_PERP";

// Prefixes that binance, bybit, gate and okx all list under another ticker at the same price on 2026-10-09.
// WTI crude is CL, which is also the venue's baseCurrency, Brent crude is BZ, the Samsung stock is SAMSUNG, and the ZKsync token is ZK.
// Every other baseCurrency that differs, such as INCH on 1INCH_USDT_PERP, matched the references under the symbol's own prefix instead.
const CODES: &[(&str, &str)] = &[("BRENTOIL", "BZ"), ("SMSN", "SAMSUNG"), ("WTI", "CL"), ("ZKSYNC", "ZK")];

// Listed as trading, but its book was empty and it has no row in the indexes reply on 2026-10-09, so it could never book or anchor.
const SKIPPED: &[&str] = &["USD_USDT_PERP"];

// bybit and okx list ON as the ON Semiconductor stock near 78, while Pionex's ON_USDT_PERP read 0.116 on 2026-10-09, the ON token gate and MEXC list.
const DENIED: &[(&str, &str)] = &[("ON_USDT_PERP", "a different token from the ON that okx and bybit list")];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let symbols: Symbols = get_data(http, &format!("{rest}{SYMBOLS_PATH}")).await?;
    let rows = symbols.symbols.unwrap_or_default();
    let markets = parse(&rows);
    catalog::finish(ID, NAME, rows.len(), markets, DENIED)
}

// No CCXT class exists, so the rules are those of docs/profiles/pionex/rest.md section 2.
// Only the USDT-M family is kept, since the coin quoted rows and the USDT_<COIN> rows quote BTC, ETH, SOL or a stock token.
fn parse(rows: &[Symbol]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        if row.status != "TRADING" || row.quote_currency != "USDT" || SKIPPED.contains(&row.symbol.as_str()) {
            continue;
        }

        // The symbol's prefix is the ticker other venues list, while baseCurrency spells 17 of them its own way, such as NEIROCTO.
        let Some(prefix) = row.symbol.strip_suffix(USDT_SUFFIX) else {
            continue;
        };
        let base = currency_code(prefix, CODES);
        if base.is_empty() {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote: "USDT".to_string(),
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0, // book sizes are base coins, the unit of baseStep and of the REST depth
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct Symbols {
    symbols: Option<Vec<Symbol>>, // null when a status filter matches nothing
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Symbol {
    #[serde(default)]
    symbol: String, // "BTC_USDT_PERP", the socket's and the indexes reply's id
    #[serde(default)]
    quote_currency: String, // "USDT", or "BTC" on BTC_ETH_PERP's siblings and USDT_BTC_PERP
    #[serde(default)]
    status: String, // "TRADING" or "OFFLINE"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the catalog reply captured live on 2026-10-09, with a few of the fields the loader ignores.
    fn row(symbol: &str, base: &str, quote: &str, status: &str) -> Value {
        json!({
            "symbol": symbol, "name": symbol.replace('_', " "), "type": "PERP", "baseCurrency": base, "quoteCurrency": quote,
            "basePrecision": 4, "quotePrecision": 1, "minNotional": "1", "baseStep": "0.0001", "quoteStep": "0.1",
            "status": status, "liquidationFeeRate": "0.0115",
        })
    }

    fn reply() -> Value {
        json!({ "result": true, "data": { "symbols": [
            row("BTC_USDT_PERP", "BTC", "USDT", "TRADING"),
            row("1INCH_USDT_PERP", "INCH", "USDT", "TRADING"),
            row("WTI_USDT_PERP", "CL", "USDT", "TRADING"),
            row("ZKSYNC_USDT_PERP", "ZKSYNC", "USDT", "TRADING"),
            row("币安人生_USDT_PERP", "CNBARS", "USDT", "TRADING"),
            row("AAPLX_USDT_PERP", "AAPLX", "USDT", "TRADING"),
            row("ON_USDT_PERP", "ON", "USDT", "TRADING"),
            row("USD_USDT_PERP", "USD", "USDT", "TRADING"),
            row("DOGE_USDT_PERP", "DOGE", "USDT", "OFFLINE"), // a documented status that no row carried on 2026-10-09
            row("BTC_ETH_PERP", "BTC", "ETH", "TRADING"),
            row("USDT_BTC_PERP", "USDT", "BTC", "TRADING"),
            row("SPCX_TSLAX_PERP", "SPCX", "TSLAX", "TRADING"),
        ]}, "timestamp": 1791572627423u64 })
    }

    fn parsed() -> Vec<Market> {
        let symbols: Symbols = serde_json::from_value(reply()["data"].clone()).unwrap();
        parse(&symbols.symbols.unwrap())
    }

    #[test]
    fn keeps_trading_usdt_contracts_only() {
        assert_eq!(
            raw_ids(&parsed()),
            ["BTC_USDT_PERP", "1INCH_USDT_PERP", "WTI_USDT_PERP", "ZKSYNC_USDT_PERP", "币安人生_USDT_PERP", "AAPLX_USDT_PERP", "ON_USDT_PERP"]
        );
    }

    #[test]
    fn drops_an_offline_contract_the_coin_quoted_families_and_the_bookless_usd_contract() {
        let ids = raw_ids(&parsed()).join(",");

        assert!(!ids.contains("DOGE_USDT_PERP"));
        assert!(!ids.contains("BTC_ETH_PERP"));
        assert!(!ids.contains("USDT_BTC_PERP"));
        assert!(!ids.contains("SPCX_TSLAX_PERP"));
        assert!(!ids.contains("USD_USDT_PERP"));
    }

    #[test]
    fn takes_the_base_from_the_symbol_prefix_except_for_the_renamed_tickers() {
        let markets = parsed();
        let bases: Vec<&str> = markets.iter().map(|m| m.base.as_str()).collect();

        assert_eq!(bases, ["BTC", "1INCH", "CL", "ZK", "币安人生", "AAPLX", "ON"]);
    }

    #[test]
    fn counts_one_coin_per_contract_at_the_vip_0_taker() {
        assert!(parsed().iter().all(|m| m.linear
            && m.quote == "USDT"
            && m.contract_size == 1.0
            && m.price_scale == 1.0
            && m.taker_ppm == 500));
    }

    #[tokio::test]
    async fn loads_the_catalog_without_the_denied_on_and_fails_on_a_venue_error_sent_with_http_200() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(SYMBOLS_PATH, reply());
        let venue = load_from(&http(), &rest.url).await.unwrap();
        assert_eq!((venue.id.as_str(), venue.name.as_str()), ("pionex", "Pionex"));
        assert_eq!(venue.markets.len(), 6);
        assert!(!raw_ids(&venue.markets).contains(&"ON_USDT_PERP"));
        assert_eq!(logs.events("market_denied")[0].text("market"), "ON_USDT_PERP");
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 12.0);

        // The answer to an unknown type, captured live on 2026-09-23, which comes with HTTP 200.
        let failing = MockRest::start().await;
        failing.reply(
            SYMBOLS_PATH,
            json!({ "result": false, "code": "MARKET_PARAMETER_ERROR", "message": "type error", "timestamp": 1790133551 }),
        );
        let error = load_from(&http(), &failing.url).await.unwrap_err();
        assert!(error.to_string().contains("MARKET_PARAMETER_ERROR: type error"), "{error:#}");
    }
}
