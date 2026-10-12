use super::{ID, REST};
use crate::clock::now_ms;
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "WhiteBIT";
const TAKER_PPM: u32 = 550; // the VIP 0 perpetual taker, which every perpetual row of /markets also publishes as takerFee "0.055"

// Spot and perpetuals share the call, and the reply holds only the markets enabled for trading.
pub const MARKETS_PATH: &str = "/api/v4/public/markets";

// CCXT 4.5.68 reads only "futures" as a swap and loads the TradFi perpetuals as spot, and decision 4 keeps them.
const PERPETUAL_TYPES: &[&str] = &["futures", "tradfiFutures"];

const QUOTES: &[&str] = &["USDT", "USDC", "USD"];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let rows: Vec<Row> = get_json(http, &format!("{rest}{MARKETS_PATH}")).await?;
    let markets = parse(&rows, now_ms());
    catalog::finish(ID, NAME, rows.len(), markets, &[])
}

// CCXT's whitebit parseMarket for an active linear swap, which has no commonCurrencies table of its own.
// The contract size is 1, because book sizes are base coins and CCXT's contractSize is the amount step 10^-stockPrec.
fn parse(rows: &[Row], now: i64) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        if !PERPETUAL_TYPES.contains(&row.kind.as_str()) || row.trades_enabled == Some(false) {
            continue;
        }

        // An announced delisting trades until it runs, and then the market leaves the reply.
        if row.delisted_at.is_finite() && row.delisted_at * 1_000.0 <= now as f64 {
            continue;
        }

        let quote_id = if row.money == "PERP" { "USDT" } else { row.money.as_str() };
        let base = currency_code(&row.stock, &[]);
        let quote = currency_code(quote_id, &[]);
        if base.is_empty() || !QUOTES.contains(&quote.as_str()) {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.name.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0,
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    #[serde(default)]
    pub name: String, // "BTC_PERP", the socket's and /futures' id
    #[serde(default)]
    stock: String,
    #[serde(default)]
    money: String,
    #[serde(rename = "type", default)]
    pub kind: String, // "spot", "futures" or "tradfiFutures"
    trades_enabled: Option<bool>,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    delisted_at: f64, // Unix seconds, null while no delisting is announced
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    const NOW: i64 = 1_791_475_200_000; // 2026-10-08 16:00 UTC

    // Rows captured live on 2026-10-08, cut down to the fields the loader reads plus a few it ignores.
    fn btc_perp() -> Value {
        json!({
            "name": "BTC_PERP", "stock": "BTC", "money": "USDT", "stockPrec": "3", "moneyPrec": "1", "makerFee": "0.01",
            "takerFee": "0.055", "minAmount": "0.001", "tradesEnabled": true, "type": "futures", "isCollateral": true,
            "isTradFiFutures": false, "delistedAt": null, "tickSize": "0.1", "stepSize": "0.001",
        })
    }

    fn ada_perp() -> Value {
        json!({
            "name": "ADA_PERP", "stock": "ADA", "money": "USDT", "stockPrec": "-1", "takerFee": "0.055",
            "tradesEnabled": true, "type": "futures", "isTradFiFutures": false, "delistedAt": null, "stepSize": "10",
        })
    }

    fn xau_perp() -> Value {
        json!({
            "name": "XAU_PERP", "stock": "XAU", "money": "USDT", "stockPrec": "3", "takerFee": "0.055",
            "tradesEnabled": true, "type": "tradfiFutures", "isTradFiFutures": true, "delistedAt": null, "stepSize": "0.001",
        })
    }

    fn btc_usdt_spot() -> Value {
        json!({
            "name": "BTC_USDT", "stock": "BTC", "money": "USDT", "stockPrec": "6", "takerFee": "0.1",
            "tradesEnabled": true, "type": "spot", "isCollateral": true, "delistedAt": null,
        })
    }

    // Every perpetual traded on 2026-10-08, so these rows are the BTC capture with a disabled flag and a past delisting.
    fn disabled_perp() -> Value {
        let mut row = btc_perp();
        row["name"] = json!("OFF_PERP");
        row["stock"] = json!("OFF");
        row["tradesEnabled"] = json!(false);
        row
    }

    fn delisted_perp(delisted_at: i64) -> Value {
        let mut row = btc_perp();
        row["name"] = json!("STG_PERP");
        row["stock"] = json!("STG");
        row["delistedAt"] = json!(delisted_at);
        row
    }

    fn parsed(rows: Value) -> Vec<Market> {
        let rows: Vec<Row> = serde_json::from_value(rows).unwrap();
        parse(&rows, NOW)
    }

    #[test]
    fn keeps_crypto_and_tradfi_perpetuals_and_drops_spot() {
        let markets = parsed(json!([btc_perp(), btc_usdt_spot(), xau_perp(), ada_perp()]));

        assert_eq!(raw_ids(&markets), ["BTC_PERP", "XAU_PERP", "ADA_PERP"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!((markets[1].base.as_str(), markets[1].quote.as_str()), ("XAU", "USDT"));
        assert!(markets.iter().all(|market| market.linear && market.taker_ppm == 550 && market.price_scale == 1.0));
    }

    #[test]
    fn counts_one_base_coin_per_contract_whatever_the_amount_step() {
        let markets = parsed(json!([btc_perp(), ada_perp()]));

        // CCXT reads 0.001 and 10 here, the order steps.
        assert_eq!(markets[0].contract_size, 1.0);
        assert_eq!(markets[1].contract_size, 1.0);
    }

    #[test]
    fn drops_a_disabled_perpetual_and_one_whose_delisting_has_run() {
        let markets = parsed(json!([disabled_perp(), delisted_perp(NOW / 1_000 - 60), btc_perp()]));

        assert_eq!(raw_ids(&markets), ["BTC_PERP"]);
    }

    #[test]
    fn keeps_a_perpetual_whose_delisting_is_still_ahead() {
        let markets = parsed(json!([delisted_perp(NOW / 1_000 + 3_600)]));

        assert_eq!(raw_ids(&markets), ["STG_PERP"]);
    }

    #[test]
    fn reads_a_perp_quote_as_usdt_and_drops_a_quote_outside_the_usd_family() {
        let mut perp_quoted = btc_perp();
        perp_quoted["money"] = json!("PERP");
        let mut coin_quoted = btc_perp();
        coin_quoted["name"] = json!("ETH_BTC_PERP");
        coin_quoted["money"] = json!("BTC");

        let markets = parsed(json!([perp_quoted, coin_quoted]));

        assert_eq!(raw_ids(&markets), ["BTC_PERP"]);
        assert_eq!(markets[0].quote, "USDT");
    }

    #[test]
    fn maps_codes_through_the_base_table() {
        let mut row = btc_perp();
        row["stock"] = json!("XBT");

        assert_eq!(parsed(json!([row]))[0].base, "BTC");
    }

    #[tokio::test]
    async fn loads_the_perpetuals() {
        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, json!([btc_perp(), btc_usdt_spot()]));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "whitebit");
        assert_eq!(venue.name, "WhiteBIT");
        assert_eq!(raw_ids(&venue.markets), ["BTC_PERP"]);
    }
}
