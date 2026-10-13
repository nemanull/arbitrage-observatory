use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;

pub const INFO_PATH: &str = "/api/v1/info";

const NAME: &str = "Pacifica";
const TAKER_PPM: u32 = 400; // the published tier 1 taker, fee level 0 on the wire, and CCXT's 0.0004

// Every perpetual is linear and settles in USDC, and CCXT quotes each in USDC.
const QUOTE: &str = "USDC";
const PERPETUAL: &str = "perpetual"; // the other type is "spot", the one market SOL-USDC

// A k market is priced and sized per 1,000 tokens, so its base is the token and its prices scale down to one token.
// On 2026-10-12 kPEPE, kBONK and kSHIB times 0.001 sat within 2 percent of the per-token markets of okx, gate and MEXC.
// The bare token is also the base hyperliquid gives its k coins.
const THOUSANDS_SCALE: f64 = 0.001;

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

pub(super) async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Reply<Vec<Instrument>> = get_json(http, &format!("{rest}{INFO_PATH}")).await?;
    let rows = reply.into_data(INFO_PATH)?;
    let markets = parse(&rows);
    catalog::finish(ID, NAME, rows.len(), markets, &[])
}

// CCXT's pacifica parseMarket for a perpetual, with the base of a k market moved to the token.
// CCXT reads every row that is not spot as a swap and sets active to true, since the catalog has no status, and every row it lists trades.
// The raw id is the symbol, which the socket and the prices call key by, spelled with its case.
fn parse(rows: &[Instrument]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        if row.instrument_type != PERPETUAL || row.symbol.is_empty() {
            continue;
        }

        let base_id = row.base_asset.as_deref().filter(|base| !base.is_empty()).unwrap_or(&row.symbol);
        let (base, price_scale) = match thousands_token(base_id) {
            Some(token) => (currency_code(token, &[]), THOUSANDS_SCALE),
            None => (currency_code(base_id, &[]), 1.0),
        };

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote: QUOTE.to_string(),
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0, // book sizes are tokens of the named asset, and a k market's are thousands, which price_scale carries
            price_scale,
        });
    }

    markets
}

// "kPEPE" names PEPE, while every other name is uppercase, as KAITO is.
fn thousands_token(name: &str) -> Option<&str> {
    let token = name.strip_prefix('k')?;
    let uppercase = !token.is_empty() && token.bytes().all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit());
    uppercase.then_some(token)
}

// Every reply is {success, data, error, code}, and a refusal comes with data null.
#[derive(Deserialize)]
pub(super) struct Reply<T> {
    #[serde(default)]
    success: bool,
    data: Option<T>,
    error: Option<String>, // "Book not found: NOPE"
}

impl<T> Reply<T> {
    pub(super) fn into_data(self, path: &str) -> anyhow::Result<T> {
        match (self.success, self.data) {
            (true, Some(data)) => Ok(data),
            _ => anyhow::bail!("{path} answered success false: {}", self.error.unwrap_or_default()),
        }
    }
}

#[derive(Deserialize)]
struct Instrument {
    #[serde(default)]
    symbol: String, // "BTC", "kPEPE", "SOL-USDC"
    base_asset: Option<String>, // equal to the symbol on every perpetual, and "SOL" on the spot market
    #[serde(default)]
    instrument_type: String, // "perpetual" or "spot"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows of GET /api/v1/info captured live on 2026-10-12 at 22:45 UTC, cut to seven of 78.
    fn rows() -> Value {
        json!([
            { "symbol": "BTC", "tick_size": "1", "min_tick": "0", "max_tick": "1000000", "lot_size": "0.00001", "max_leverage": 50, "isolated_only": false,
              "min_order_size": "10", "max_order_size": "5000000", "funding_rate": "0.0000125", "next_funding_rate": "0.0000125", "created_at": 1748881333944_i64,
              "instrument_type": "perpetual", "base_asset": "BTC", "execution_modes": ["orderbook"] },
            { "symbol": "kPEPE", "tick_size": "0.000001", "min_tick": "0", "max_tick": "10000000", "lot_size": "1", "max_leverage": 10, "isolated_only": false,
              "min_order_size": "10", "max_order_size": "1000000", "funding_rate": "0.0000125", "next_funding_rate": "0.0000125", "created_at": 1754872885745_i64,
              "instrument_type": "perpetual", "base_asset": "kPEPE", "execution_modes": ["orderbook"] },
            { "symbol": "2Z", "tick_size": "0.0001", "lot_size": "1", "max_leverage": 3, "instrument_type": "perpetual", "base_asset": "2Z",
              "execution_modes": ["orderbook"] },
            { "symbol": "XAU", "tick_size": "0.1", "lot_size": "0.0001", "max_leverage": 10, "funding_rate": "-0.00004446", "next_funding_rate": "0.00000591",
              "instrument_type": "perpetual", "base_asset": "XAU", "execution_modes": ["orderbook", "rfq"] },
            { "symbol": "SOL-USDC", "tick_size": "0.01", "min_tick": "0", "max_tick": "1000000", "lot_size": "0.001", "max_leverage": 1, "isolated_only": false,
              "min_order_size": "10", "max_order_size": "1000000", "funding_rate": "0", "next_funding_rate": "0", "created_at": 1776615970246_i64,
              "instrument_type": "spot", "base_asset": "SOL", "execution_modes": ["orderbook"] },
            { "symbol": "META", "tick_size": "0.01", "lot_size": "0.001", "max_leverage": 10, "instrument_type": "perpetual", "base_asset": "META",
              "execution_modes": ["orderbook"] },
            { "symbol": "KAITO", "tick_size": "0.0001", "lot_size": "0.1", "max_leverage": 5, "instrument_type": "perpetual", "base_asset": "KAITO",
              "execution_modes": ["orderbook"] },
        ])
    }

    fn info(rows: Value) -> Value {
        json!({ "success": true, "data": rows, "error": null, "code": null })
    }

    fn parsed(rows: Value) -> Vec<Market> {
        let rows: Vec<Instrument> = serde_json::from_value(rows).unwrap();
        parse(&rows)
    }

    #[test]
    fn keeps_every_perpetual_by_its_symbol_as_a_linear_usdc_market_and_drops_the_spot_pair() {
        let markets = parsed(rows());

        assert_eq!(raw_ids(&markets), ["BTC", "kPEPE", "2Z", "XAU", "META", "KAITO"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDC"));
        assert!(markets.iter().all(|m| m.linear && m.taker_ppm == 400 && m.contract_size == 1.0));
        assert_eq!((markets[2].base.as_str(), markets[2].price_scale), ("2Z", 1.0));
        assert_eq!(markets[3].base, "XAU");
        assert_eq!((markets[5].base.as_str(), markets[5].price_scale), ("KAITO", 1.0));
    }

    #[test]
    fn a_k_market_is_the_token_priced_per_thousand() {
        let markets = parsed(rows());

        assert_eq!(markets[1].raw_market_id, "kPEPE");
        assert_eq!(markets[1].base, "PEPE");
        assert_eq!(markets[1].price_scale, 0.001);
        assert_eq!(markets[1].contract_size, 1.0);
    }

    #[test]
    fn only_a_lowercase_k_before_an_uppercase_token_means_thousands() {
        assert_eq!(thousands_token("kPEPE"), Some("PEPE"));
        assert_eq!(thousands_token("kSHIB"), Some("SHIB"));
        assert_eq!(thousands_token("KAITO"), None);
        assert_eq!(thousands_token("k"), None);
        assert_eq!(thousands_token("kitty"), None);
        assert_eq!(thousands_token("BTC"), None);
    }

    // The catalog has no status, so no row is inactive, and a type beside perpetual and spot has never been seen.
    // This row is the BTC capture with another type, which is left out where CCXT would read it as a swap.
    #[test]
    fn leaves_out_a_row_of_any_other_type() {
        let mut row = rows()[0].clone();
        row["instrument_type"] = json!("prediction");

        assert!(parsed(json!([row])).is_empty());
    }

    #[test]
    fn reads_the_base_from_the_symbol_when_the_base_asset_is_missing() {
        let markets = parsed(json!([{ "symbol": "kBONK", "instrument_type": "perpetual" }, { "symbol": "ETH", "instrument_type": "perpetual", "base_asset": "" }]));

        assert_eq!((markets[0].base.as_str(), markets[0].price_scale), ("BONK", 0.001));
        assert_eq!(markets[1].base, "ETH");
    }

    #[tokio::test]
    async fn loads_the_perpetuals_of_the_info_call() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(INFO_PATH, info(rows()));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(rest.calls(), [INFO_PATH]);
        assert_eq!((venue.id.as_str(), venue.name.as_str()), ("pacifica", "Pacifica"));
        assert_eq!(venue.markets.len(), 6);
        let read = logs.events("catalog_read");
        assert_eq!(read[0].number("rows"), 7.0);
        assert_eq!(read[0].number("perpetuals"), 6.0);
        assert_eq!(read[0].number("kept"), 6.0);
        assert_eq!(logs.events("market_price_scaled")[0].text("market"), "kPEPE");
    }

    #[tokio::test]
    async fn a_failed_or_refused_info_call_fails_the_load() {
        let rest = MockRest::start().await;
        rest.fail(INFO_PATH, 500);
        assert!(load_from(&http(), &rest.url).await.is_err());

        rest.reply(INFO_PATH, json!({ "success": false, "data": null, "error": "Not found", "code": 404 }));
        let error = load_from(&http(), &rest.url).await.unwrap_err();
        assert!(error.to_string().contains("Not found"), "{error:#}");
    }
}
