use super::{ID, REST};
use crate::clock::now_ms;
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;

pub const MARKETS_PATH: &str = "/v1/markets";

const NAME: &str = "Paradex";

// The Pro 0 taker of the fee page and of GET /v1/system/volume-tiers, which every API order pays unless it carries an interactive token.
// The per market fee_config reads 200 ppm and CCXT hard codes 300 ppm, and the profile's fees.md weighs the three.
const TAKER_PPM: u32 = 450;

// kPEPE and kSHIB are priced and sized per 1,000 tokens: kPEPE marked 0.00399674 while binance marked 1000PEPEUSDT at 0.9993 of that.
// So the base is the token, and its prices scale down to one token, as the hyperliquid loader does.
const THOUSANDS_SCALE: f64 = 0.001;

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

// One reply holds every market, about 9,500 rows of which 66 are perpetuals, 14 MB or 0.37 MB with gzip.
async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Reply = get_json(http, &format!("{rest}{MARKETS_PATH}")).await?;
    let markets = parse(&reply.results, now_ms());
    catalog::finish(ID, NAME, reply.results.len(), markets, &[])
}

// CCXT's paradex parseMarket for a perpetual, which types every kind but the two option kinds as a swap.
// So only asset_kind PERP is kept, since CCXT's rule also turns the spot market DIME-USD into a swap.
// No row has an active field, so a market trades when it has opened and takes on-book orders, where RFQ_ONLY takes only block trade legs.
fn parse(rows: &[Row], now: i64) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        let opened = !(row.open_at.is_finite() && row.open_at > now as f64);
        let on_book = row.trading_mode.as_deref().is_none_or(|mode| mode == "STANDARD");
        if row.asset_kind != "PERP" || row.symbol.is_empty() || !opened || !on_book {
            continue;
        }

        let quote = currency_code(&row.quote_currency, &[]);
        if !matches!(quote.as_str(), "USD" | "USDC" | "USDT") {
            continue;
        }

        let (base, price_scale) = match thousands_token(&row.base_currency) {
            Some(token) => (currency_code(token, &[]), THOUSANDS_SCALE),
            None => (currency_code(&row.base_currency, &[]), 1.0),
        };
        if base.is_empty() {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0, // book sizes are coins of the base, and thousands of tokens on a k market, which price_scale carries
            price_scale,
        });
    }

    markets
}

// "kPEPE" names PEPE, while every other base is uppercase, as KAITO is.
fn thousands_token(base: &str) -> Option<&str> {
    let token = base.strip_prefix('k')?;
    let uppercase = !token.is_empty() && token.bytes().all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit());
    uppercase.then_some(token)
}

#[derive(Deserialize)]
struct Reply {
    #[serde(default)]
    results: Vec<Row>,
}

#[derive(Deserialize)]
struct Row {
    #[serde(default)]
    symbol: String, // "BTC-USD-PERP", which the socket channels and frames spell the same way
    #[serde(default)]
    base_currency: String, // "BTC", "kPEPE"
    #[serde(default)]
    quote_currency: String, // "USD", settled in USDC
    #[serde(default)]
    asset_kind: String, // "PERP", "OPTION" or "SPOT"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    open_at: f64, // Unix ms, a number on every row of 2026-10-12, while CCXT's comments show a string on options
    trading_mode: Option<String>, // "STANDARD" or "RFQ_ONLY"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    const NOW: i64 = 1_791_846_655_000; // 2026-10-12 22:50:55 UTC, when the rows below were read

    // Rows of GET /v1/markets captured live on 2026-10-12, cut to the fields the loader reads and a few beside them.
    fn btc() -> Value {
        json!({
            "symbol": "BTC-USD-PERP", "base_currency": "BTC", "quote_currency": "USD", "settlement_currency": "USDC",
            "order_size_increment": "0.00001", "price_tick_size": "0.1", "open_at": 1696431006398_i64, "expiry_at": 0,
            "asset_kind": "PERP", "market_kind": "cross", "funding_period_hours": 8, "tags": ["LAYER-1"], "trading_mode": "STANDARD",
        })
    }

    fn rows() -> Value {
        json!([
            btc(),
            {
                "symbol": "kPEPE-USD-PERP", "base_currency": "kPEPE", "quote_currency": "USD", "settlement_currency": "USDC",
                "open_at": 1714716000000_i64, "expiry_at": 0, "asset_kind": "PERP", "market_kind": "cross", "funding_period_hours": 8,
                "tags": ["MEME"], "trading_mode": "STANDARD",
            },
            {
                "symbol": "XAU-USD-PERP", "base_currency": "XAU", "quote_currency": "USD", "settlement_currency": "USDC",
                "open_at": 1788763500000_i64, "expiry_at": 0, "asset_kind": "PERP", "market_kind": "cross", "funding_period_hours": 8,
                "tags": ["RWA"], "trading_mode": "STANDARD",
            },
            {
                "symbol": "DIME-USD", "base_currency": "DIME", "quote_currency": "USD", "settlement_currency": "USDC",
                "open_at": 1772715600000_i64, "expiry_at": 0, "asset_kind": "SPOT", "market_kind": "cross", "funding_period_hours": 0,
                "tags": [], "trading_mode": "STANDARD",
            },
            {
                "symbol": "BTC-USD-13OCT26-73000-C", "base_currency": "BTC", "quote_currency": "USD", "settlement_currency": "USDC",
                "open_at": 1791548102699_i64, "expiry_at": 1791878400000_i64, "asset_kind": "OPTION", "market_kind": "cross",
                "funding_period_hours": 0, "tags": [], "trading_mode": "STANDARD", "option_type": "CALL", "strike_price": "73000",
            },
        ])
    }

    fn parsed(rows: Value) -> Vec<Market> {
        let rows: Vec<Row> = serde_json::from_value(rows).unwrap();
        parse(&rows, NOW)
    }

    #[test]
    fn keeps_each_perpetual_by_its_symbol_as_a_linear_usd_market_and_drops_options_and_spot() {
        let markets = parsed(rows());

        assert_eq!(raw_ids(&markets), ["BTC-USD-PERP", "kPEPE-USD-PERP", "XAU-USD-PERP"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USD"));
        assert_eq!(markets[2].base, "XAU");
        assert!(markets.iter().all(|m| m.linear && m.taker_ppm == 450 && m.contract_size == 1.0));
        assert_eq!(markets[0].price_scale, 1.0);
    }

    #[test]
    fn a_k_market_is_the_token_priced_per_thousand() {
        let markets = parsed(rows());

        assert_eq!(markets[1].raw_market_id, "kPEPE-USD-PERP");
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

    // Every perpetual read STANDARD and had opened on 2026-10-12, so these rows are the BTC capture with the field changed by hand.
    #[test]
    fn drops_a_perpetual_that_takes_no_book_orders_or_has_not_opened() {
        let mut rfq = btc();
        rfq["trading_mode"] = json!("RFQ_ONLY");
        let mut later = btc();
        later["open_at"] = json!(NOW + 60_000);
        let mut unstated = btc();
        unstated.as_object_mut().unwrap().remove("trading_mode");
        unstated.as_object_mut().unwrap().remove("open_at");

        assert!(parsed(json!([rfq, later])).is_empty());
        assert_eq!(raw_ids(&parsed(json!([unstated]))), ["BTC-USD-PERP"]);
    }

    #[tokio::test]
    async fn loads_the_markets_call_and_logs_the_rows_it_read() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, json!({ "results": rows() }));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(rest.calls(), [MARKETS_PATH]);
        assert_eq!((venue.id.as_str(), venue.name.as_str()), ("paradex", "Paradex"));
        assert_eq!(raw_ids(&venue.markets), ["BTC-USD-PERP", "kPEPE-USD-PERP", "XAU-USD-PERP"]);
        let read = logs.events("catalog_read");
        assert_eq!(read[0].number("rows"), 5.0);
        assert_eq!(read[0].number("kept"), 3.0);
        assert_eq!(logs.events("market_price_scaled")[0].text("market"), "kPEPE-USD-PERP");
    }

    #[tokio::test]
    async fn a_failed_markets_call_fails_the_load() {
        let rest = MockRest::start().await;
        rest.fail(MARKETS_PATH, 500);

        assert!(load_from(&http(), &rest.url).await.is_err());
    }
}
