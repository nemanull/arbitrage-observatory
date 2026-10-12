use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;

// Every perpetual, open or not, from the CDN, which caches it for 300 s.
pub const MARKETS_PATH: &str = "/api/v1/markets?marketType=PERP";

const NAME: &str = "Backpack Exchange";

// Tier 1 of the public futures tiers, 0.05 %, while CCXT sets no taker at all.
const TAKER_PPM: u32 = 500;

// CCXT's backpack sets an empty commonCurrencies, so only the base table applies.
const CODES: &[(&str, &str)] = &[];

// A k coin is priced and sized per 1,000 tokens: kPEPE read 0.0039 on 2026-10-09 while PEPE was 0.0000039.
// So its base is the token, and its prices scale down to one token, as hyperliquid's loader does.
const THOUSANDS_SCALE: f64 = 0.001;

// Each entry names the token the ticker collides with.
const DENIED: &[(&str, &str)] = &[];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let rows: Vec<Instrument> = get_json(http, &format!("{rest}{MARKETS_PATH}")).await?;
    let markets = parse(&rows);
    catalog::finish(ID, NAME, rows.len(), markets, DENIED)
}

// CCXT's backpack parseMarket for an active swap: a PERP row whose book is Open, based on baseSymbol, with a k coin's base moved to the token.
fn parse(rows: &[Instrument]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        if !row.is_open_perpetual() {
            continue;
        }

        let quote = currency_code(&row.quote_symbol, CODES);
        if row.base_symbol.is_empty() || !matches!(quote.as_str(), "USDT" | "USDC" | "USD") {
            continue;
        }

        let (base, price_scale) = match thousands_token(&row.base_symbol) {
            Some(token) => (currency_code(token, CODES), THOUSANDS_SCALE),
            None => (currency_code(&row.base_symbol, CODES), 1.0),
        };

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0, // CCXT's literal, and book sizes are coins of the base, as BTC's 1.84699 at the best bid is
            price_scale,
        });
    }

    markets
}

// "kPEPE" names PEPE, while every other base is uppercase, as KAITO and KMNO are.
fn thousands_token(base: &str) -> Option<&str> {
    let token = base.strip_prefix('k')?;
    let uppercase = !token.is_empty() && token.bytes().all(|byte| byte.is_ascii_uppercase() || byte.is_ascii_digit());
    uppercase.then_some(token)
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Instrument {
    #[serde(default)]
    pub symbol: String, // "BTC_USDC_PERP", the depth stream's and markPrices' id
    #[serde(default)]
    base_symbol: String, // "BTC", "kPEPE", "AAPL.US"
    #[serde(default)]
    quote_symbol: String,
    #[serde(default)]
    market_type: String, // "PERP" or "SPOT"
    #[serde(default)]
    order_book_state: String, // "Open", "Closed", "PostOnly", "CancelOnly" or "LimitOnly"
    pub rwa_market_type: Option<String>, // "STOCK" or "INDEX" on an equity perpetual, null on crypto
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    pub funding_interval: f64, // ms, 3600000 on every perpetual on 2026-10-09
}

impl Instrument {
    pub fn is_open_perpetual(&self) -> bool {
        self.market_type == "PERP" && self.order_book_state == "Open"
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the live reply of 2026-10-09, which listed 103 PERP rows: 91 Open, 11 Closed and 1 PostOnly.
    fn row(symbol: &str, base: &str, state: &str, rwa: Value) -> Value {
        json!({
            "baseSymbol": base, "createdAt": "2025-01-21T06:34:54.691858",
            "filters": {
                "price": { "maxPriceUpdateMultiplier": "1.0025", "minPriceUpdateMultiplier": "0.9975", "tickSize": "0.1" },
                "quantity": { "maxQuantity": null, "minQuantity": "0.00001", "stepSize": "0.00001" },
            },
            "fundingInterval": 3600000, "fundingRateLowerBound": "-150", "fundingRateUpperBound": "150",
            "marketType": "PERP", "orderBookState": state, "quoteSymbol": "USDC", "rwaMarketType": rwa,
            "symbol": symbol, "visible": true,
        })
    }

    fn btc() -> Value {
        row("BTC_USDC_PERP", "BTC", "Open", Value::Null)
    }

    fn kpepe() -> Value {
        row("kPEPE_USDC_PERP", "kPEPE", "Open", Value::Null)
    }

    fn kaito() -> Value {
        row("KAITO_USDC_PERP", "KAITO", "Open", Value::Null)
    }

    fn aapl() -> Value {
        row("AAPL.US_USDC_PERP", "AAPL.US", "Open", json!("STOCK"))
    }

    fn ton_closed() -> Value {
        row("TON_USDC_PERP", "TON", "Closed", Value::Null)
    }

    fn msft_post_only() -> Value {
        row("MSFT.US_USDC_PERP", "MSFT.US", "PostOnly", json!("STOCK"))
    }

    // The markets call without marketType lists spot too, which CCXT reads from the same call.
    fn spot() -> Value {
        let mut spot = row("SOL_USDC", "SOL", "Open", Value::Null);
        spot["marketType"] = json!("SPOT");
        spot
    }

    fn parsed(rows: Value) -> Vec<Market> {
        let rows: Vec<Instrument> = serde_json::from_value(rows).unwrap();
        parse(&rows)
    }

    #[test]
    fn keeps_open_perpetuals_as_linear_contracts_of_one_coin_at_the_tier_1_taker() {
        let markets = parsed(json!([btc(), spot(), ton_closed(), msft_post_only(), aapl()]));

        assert_eq!(raw_ids(&markets), ["BTC_USDC_PERP", "AAPL.US_USDC_PERP"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDC"));
        assert!(markets[0].linear);
        assert_eq!(markets[0].contract_size, 1.0);
        assert_eq!(markets[0].taker_ppm, 500);
        assert_eq!(markets[0].price_scale, 1.0);
    }

    #[test]
    fn keeps_a_stock_and_an_index_perpetual_under_their_ccxt_bases() {
        let qqq = row("QQQ.US_USDC_PERP", "QQQ.US", "Open", json!("INDEX"));

        let markets = parsed(json!([aapl(), qqq]));

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("AAPL.US", "USDC"));
        assert_eq!(markets[1].base, "QQQ.US");
        assert_eq!(markets[1].price_scale, 1.0);
    }

    #[test]
    fn moves_a_k_coin_to_its_token_at_a_thousandth_of_the_price() {
        let markets = parsed(json!([kpepe(), kaito()]));

        assert_eq!(markets[0].base, "PEPE");
        assert_eq!(markets[0].price_scale, 0.001);
        assert_eq!(markets[0].contract_size, 1.0);
        assert_eq!(markets[1].base, "KAITO");
        assert_eq!(markets[1].price_scale, 1.0);
    }

    #[test]
    fn drops_a_perpetual_quoted_in_a_coin() {
        let mut coin = btc();
        coin["symbol"] = json!("ETH_BTC_PERP");
        coin["quoteSymbol"] = json!("BTC");

        assert!(parsed(json!([coin])).is_empty());
    }

    #[test]
    fn reads_the_funding_interval_and_the_equity_tag() {
        let rows: Vec<Instrument> = serde_json::from_value(json!([btc(), aapl()])).unwrap();

        assert_eq!(rows[0].funding_interval, 3_600_000.0);
        assert_eq!(rows[0].rwa_market_type, None);
        assert_eq!(rows[1].rwa_market_type.as_deref(), Some("STOCK"));
    }

    #[tokio::test]
    async fn loads_the_perpetuals_from_the_markets_call() {
        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, json!([ton_closed(), btc()]));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "backpack");
        assert_eq!(venue.name, "Backpack Exchange");
        assert_eq!(raw_ids(&venue.markets), ["BTC_USDC_PERP"]);
    }

    #[tokio::test]
    async fn fails_an_error_reply() {
        let rest = MockRest::start().await;
        rest.fail(MARKETS_PATH, 500);

        assert!(load_from(&http(), &rest.url).await.is_err());
    }
}
