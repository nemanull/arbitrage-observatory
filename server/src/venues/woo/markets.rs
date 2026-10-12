use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;

// Spot and perpetual rows in one reply, under data.rows.
pub const INSTRUMENTS_PATH: &str = "/v3/public/instruments";

const NAME: &str = "WOO X";

// The VIP 0 futures taker of the public tier table, futuresTakerTradingFee 0.03 read as a percent, while CCXT's constant is 0.0005.
const TAKER_PPM: u32 = 300;

// CCXT's woo sets an empty commonCurrencies, so only the base table applies.
const CODES: &[(&str, &str)] = &[];

// Each entry names the token the ticker collides with.
const DENIED: &[(&str, &str)] = &[];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Reply = get_json(http, &format!("{rest}{INSTRUMENTS_PATH}")).await?;
    if !reply.success {
        anyhow::bail!("{ID} instruments answered success false: {}", reply.message.unwrap_or_default());
    }
    let markets = parse(&reply.data.rows);
    catalog::finish(ID, NAME, reply.data.rows.len(), markets, DENIED)
}

// CCXT's woo parseMarket for an active swap: the id is PERP_<base>_<quote>, and base and quote come from the id, not from baseAsset.
fn parse(rows: &[Instrument]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        let parts: Vec<&str> = row.symbol.split('_').collect();
        if parts.len() != 3 || parts[0] != "PERP" || row.status != "TRADING" {
            continue;
        }

        let base = currency_code(parts[1], CODES);
        let quote = currency_code(parts[2], CODES);
        if base.is_empty() || !matches!(quote.as_str(), "USDT" | "USDC" | "USD") {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0, // CCXT's constant, and book sizes are base coins, as baseAssetMultiplier 1 on every perpetual says
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct Reply {
    #[serde(default)]
    success: bool,
    message: Option<String>,
    #[serde(default)]
    data: Rows,
}

#[derive(Deserialize, Default)]
struct Rows {
    rows: Vec<Instrument>,
}

#[derive(Deserialize)]
struct Instrument {
    #[serde(default)]
    symbol: String, // "PERP_BTC_USDT" or "SPOT_BTC_USDT"
    #[serde(default)]
    status: String, // "TRADING", "SUSPENDED" or "TESTING"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the live reply of 2026-10-08, which listed 309 rows, 222 of them PERP_*_USDT and all TRADING.
    fn btc() -> Value {
        json!({
            "symbol": "PERP_BTC_USDT", "status": "TRADING", "baseAsset": "BTC", "baseAssetMultiplier": 1, "quoteAsset": "USDT",
            "quoteTick": "1", "baseTick": "0.00001", "fundingIntervalHours": 8, "fundingCap": "0.003", "orderMode": "NORMAL",
            "impactNotional": "10000", "isAllowedRpi": true,
        })
    }

    fn pendle() -> Value {
        json!({
            "symbol": "PERP_PENDLE_USDT", "status": "TRADING", "baseAsset": "PENDLE", "baseAssetMultiplier": 1, "quoteAsset": "USDT",
            "quoteTick": "0.0001", "baseTick": "0.1", "fundingIntervalHours": 8, "impactNotional": "2000", "isAllowedRpi": true,
        })
    }

    fn spot() -> Value {
        json!({
            "symbol": "SPOT_DYDX_USDT", "status": "TRADING", "baseAsset": "DYDX", "baseAssetMultiplier": 1, "quoteAsset": "USDT",
            "quoteTick": "0.0001", "impactNotional": null, "isAllowedRpi": true,
        })
    }

    // Every perpetual was TRADING that day, so this is the PENDLE row with the documented SUSPENDED status.
    fn suspended() -> Value {
        let mut row = pendle();
        row["symbol"] = json!("PERP_OLD_USDT");
        row["status"] = json!("SUSPENDED");
        row
    }

    fn parsed(rows: Value) -> Vec<Market> {
        let rows: Vec<Instrument> = serde_json::from_value(rows).unwrap();
        parse(&rows)
    }

    #[test]
    fn keeps_trading_perpetuals_as_linear_contracts_of_one_coin_at_the_vip0_taker() {
        let markets = parsed(json!([btc(), spot(), suspended(), pendle()]));

        assert_eq!(raw_ids(&markets), ["PERP_BTC_USDT", "PERP_PENDLE_USDT"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert!(markets[0].linear);
        assert_eq!(markets[0].contract_size, 1.0);
        assert_eq!(markets[0].taker_ppm, 300);
        assert_eq!(markets[0].price_scale, 1.0);
    }

    #[test]
    fn reads_base_and_quote_from_the_id_through_the_base_code_table() {
        let mut row = btc();
        row["symbol"] = json!("PERP_XBT_USDC");
        row["baseAsset"] = json!("SOMETHING");

        let markets = parsed(json!([row]));

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDC"));
    }

    #[test]
    fn drops_a_coin_quoted_perpetual_and_an_id_of_another_shape() {
        let mut coin = btc();
        coin["symbol"] = json!("PERP_ETH_BTC");
        let mut dated = btc();
        dated["symbol"] = json!("PERP_BTC_USDT_20261225");

        assert!(parsed(json!([coin, dated])).is_empty());
    }

    #[tokio::test]
    async fn loads_the_perpetuals_from_the_instruments_call() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, json!({ "success": true, "data": { "rows": [spot(), btc()] }, "timestamp": 1791513994000_i64 }));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "woo");
        assert_eq!(venue.name, "WOO X");
        assert_eq!(raw_ids(&venue.markets), ["PERP_BTC_USDT"]);
    }

    #[tokio::test]
    async fn fails_a_reply_that_answers_success_false() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, json!({ "success": false, "message": "busy", "data": { "rows": [btc()] } }));

        assert!(load_from(&http(), &rest.url).await.is_err());
    }
}
