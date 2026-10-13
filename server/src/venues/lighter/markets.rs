use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, contract_size, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "Lighter";

// The perpetual rows only, since the spot array then comes back empty.
pub(super) const DETAILS_PATH: &str = "/api/v1/orderBookDetails?filter=perp";

// The default Standard account trades at 0 % maker and taker behind a 300 ms taker delay, and Premium at 0 staked LIT would be 280.
const TAKER_PPM: u32 = 0;

// Every perpetual settles in USDC, asset 0, and CCXT quotes each one in USDC.
const QUOTE: &str = "USDC";

// Each names another asset than the reference venues list under its ticker, by live_identity on 2026-10-12.
// WEN is kept, since binance, okx and gate list it as the same stock within 2 percent.
const DENIED: &[(&str, &str)] = &[
    ("211", "BB, an RWA at 8.41 that fits the BlackBerry stock, while binance, bybit, gate and mexc list the BounceBit token as BB at 0.0091"),
    ("232", "AI, priced from a Uniswap pool at 0.088, while okx lists another AI token at 0.0196"),
    ("4097", "PRL, priced from a Uniswap pool at 1.65, while binance, bybit, gate and mexc list another PRL token at 0.11"),
];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

pub(super) async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Reply = get_json(http, &format!("{rest}{DETAILS_PATH}")).await?;
    let markets = parse(&reply.order_book_details);
    catalog::finish(ID, NAME, reply.order_book_details.len(), markets, DENIED)
}

// CCXT's lighter parseMarket for an active perpetual, keyed by market_id as CCXT's id is, which the socket subscribes and keys its stats by.
// A reduce only market is left out, a rule CCXT does not have, since no route can open a position there and 14 of the 16 held an empty or one sided book.
fn parse(rows: &[Row]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        if row.market_type != "perp" || row.status != "active" || row.market_config.force_reduce_only || row.symbol.is_empty() {
            continue;
        }
        let Some(market_id) = row.market_id else {
            continue;
        };

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: market_id.to_string(),
            base: currency_code(&row.symbol, &[]), // the class has no commonCurrencies, and 1000PEPE stays 1000PEPE as bybit lists it
            quote: QUOTE.to_string(),
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: contract_size(row.quote_multiplier), // 1 on every row, and book sizes are coins of the base
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct Reply {
    #[serde(default)]
    order_book_details: Vec<Row>,
}

#[derive(Deserialize)]
struct Row {
    #[serde(default)]
    symbol: String, // "BTC", "1000PEPE", or a stock ticker such as "NVDA"
    market_id: Option<u64>, // 0 to 233, then 4095 to 4099, so not dense
    #[serde(default)]
    market_type: String, // "perp" or "spot"
    #[serde(default)]
    status: String, // "active" or "inactive"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    quote_multiplier: f64,
    #[serde(default)]
    market_config: Config,
}

#[derive(Deserialize, Default)]
struct Config {
    #[serde(default)]
    force_reduce_only: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows of GET /api/v1/orderBookDetails?filter=perp captured live on 2026-10-12, cut to nine of 239 and to the fields around the rules.
    fn eth() -> Value {
        json!({"symbol":"ETH","market_id":0,"market_type":"perp","base_asset_id":0,"quote_asset_id":0,"status":"active","taker_fee":"0.0000",
            "maker_fee":"0.0000","size_decimals":4,"price_decimals":2,"multiplier":"1.000000000000000000","quote_multiplier":1,
            "index_price":"2479.83","mark_price":"2478.57","funding_premium_multiplier":100,"operator_account_index":1,
            "market_config":{"force_reduce_only":false,"hidden":false,"trading_hours":""}})
    }

    fn row(symbol: &str, market_id: u64, status: &str, force_reduce_only: bool) -> Value {
        let mut row = eth();
        row["symbol"] = json!(symbol);
        row["market_id"] = json!(market_id);
        row["status"] = json!(status);
        row["market_config"]["force_reduce_only"] = json!(force_reduce_only);
        row
    }

    fn reply() -> Value {
        json!({
            "code": 200,
            "order_book_details": [
                eth(),
                row("BTC", 1, "active", false),
                row("1000PEPE", 4, "active", false),
                row("MAGS", 155, "inactive", true), // inactive, and an inactive subscribe answers 30005
                row("GME", 176, "active", true),     // reduce only, with an empty book
                row("BB", 211, "active", false),
                row("WEN", 214, "active", false),    // the stock, as binance, okx and gate list it
                row("OURA", 4096, "active", false),  // Pre-IPO, kept here and left out of the anchors
                row("PRL", 4097, "active", false),
            ],
            "spot_order_book_details": [],
        })
    }

    fn parsed(reply: Value) -> Vec<Market> {
        let reply: Reply = serde_json::from_value(reply).unwrap();
        parse(&reply.order_book_details)
    }

    #[test]
    fn keeps_every_active_perpetual_that_is_not_reduce_only_by_its_market_id_as_a_linear_usdc_market() {
        let markets = parsed(reply());

        assert_eq!(raw_ids(&markets), ["0", "1", "4", "211", "214", "4096", "4097"]);
        assert_eq!((markets[1].base.as_str(), markets[1].quote.as_str()), ("BTC", "USDC"));
        assert!(markets.iter().all(|m| m.linear && m.taker_ppm == 0 && m.contract_size == 1.0 && m.price_scale == 1.0));
        assert!(markets.iter().all(|m| m.venue_id == "lighter"));
    }

    #[test]
    fn a_thousands_name_keeps_its_prefix_as_ccxt_and_bybit_spell_it() {
        let markets = parsed(reply());

        assert_eq!(markets[2].base, "1000PEPE");
        assert_eq!(markets[2].price_scale, 1.0);
    }

    #[test]
    fn leaves_out_a_spot_row_and_a_row_without_an_id() {
        let mut spot = row("ETH/USDC", 2048, "active", false);
        spot["market_type"] = json!("spot");
        let mut no_id = row("XYZ", 9, "active", false);
        no_id.as_object_mut().unwrap().remove("market_id");

        let markets = parsed(json!({ "order_book_details": [spot, no_id, eth()] }));

        assert_eq!(raw_ids(&markets), ["0"]);
    }

    #[test]
    fn a_contract_size_the_row_does_not_state_counts_one_coin() {
        let mut row = eth();
        row.as_object_mut().unwrap().remove("quote_multiplier");

        assert_eq!(parsed(json!({ "order_book_details": [row] }))[0].contract_size, 1.0);
    }

    #[tokio::test]
    async fn loads_the_perpetual_details_and_denies_bb_and_prl() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(DETAILS_PATH, reply());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(rest.calls(), [DETAILS_PATH]);
        assert_eq!(venue.id, "lighter");
        assert_eq!(venue.name, "Lighter");
        assert_eq!(raw_ids(&venue.markets), ["0", "1", "4", "214", "4096"]);
        let read = logs.events("catalog_read");
        assert_eq!(read[0].number("rows"), 9.0);
        assert_eq!(read[0].number("perpetuals"), 7.0);
        assert_eq!(read[0].number("kept"), 5.0);
        let denied = logs.events("market_denied");
        assert_eq!(denied.len(), 2);
        assert_eq!(denied[0].text("market"), "211");
        assert_eq!(denied[1].text("market"), "4097");
    }

    #[tokio::test]
    async fn a_failed_details_call_fails_the_load() {
        let rest = MockRest::start().await;
        rest.fail(DETAILS_PATH, 400);

        assert!(load_from(&http(), &rest.url).await.is_err());
    }

    #[tokio::test]
    async fn a_reply_with_no_perpetual_fails_the_load() {
        let (_logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(DETAILS_PATH, json!({ "code": 200, "order_book_details": [], "spot_order_book_details": [] }));

        assert!(load_from(&http(), &rest.url).await.is_err());
    }
}
