use super::anchor::Stats;
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;

// Every market, perpetual and spot, in one reply, which takes `market` repeated to name only some.
pub const MARKETS_PATH: &str = "/api/v1/info/markets";

pub const RWA: &str = "RWA"; // the category of equities, indices, FX and commodities, as opposed to "Crypto"

const NAME: &str = "Extended";

// The published takers, flat with no volume tiers: 0.025 % on crypto perpetuals and 0.010 % on RWA ones.
// CCXT sets 0.002 on every market, which is no published rate.
const CRYPTO_TAKER_PPM: u32 = 250;
const RWA_TAKER_PPM: u32 = 100;

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Reply = get_json(http, &format!("{rest}{MARKETS_PATH}")).await?;
    if reply.status != "OK" {
        anyhow::bail!("{MARKETS_PATH} answered status {:?}", reply.status);
    }
    let markets = parse(&reply.data);
    catalog::finish(ID, NAME, reply.data.len(), markets, &[])
}

// The rule the loader and the anchor share: a perpetual that trades now on Extended's own order book.
// The `active` flag is true on delisted and prelisted rows too, so status is the trading flag, as CCXT reads it.
// An RFQ market's book is an indicative quote of market makers, and its index and mark are Binance's or Hyperliquid's.
pub fn order_book_perpetual(row: &Row) -> bool {
    !row.kind.eq_ignore_ascii_case("spot") && row.status == "ACTIVE" && row.is_rfq == Some(false)
}

// CCXT's extended parseMarket for an active swap, which quotes USD collateral as USDC, kept to the markets that are not RFQ.
// CCXT never reads isRfq, so it also lists the RFQ markets.
fn parse(rows: &[Row]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        if !order_book_perpetual(row) || row.name.is_empty() {
            continue;
        }

        let base = currency_code(&row.asset_name, &[]);
        let quote = match row.collateral_asset_name.as_str() {
            "USD" => "USDC".to_string(),
            other => currency_code(other, &[]),
        };
        if base.is_empty() || !matches!(quote.as_str(), "USDT" | "USDC" | "USD") {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.name.clone(),
            base,
            quote,
            taker_ppm: if row.category == RWA { RWA_TAKER_PPM } else { CRYPTO_TAKER_PPM },
            linear: true,
            contract_size: 1.0, // sizes count units of the asset, and the k and 1000 markets, the only ones in thousands, are all RFQ
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
pub struct Reply {
    #[serde(default)]
    pub status: String, // "OK", or "ERROR" with an error object
    #[serde(default)]
    pub data: Vec<Row>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    #[serde(default)]
    pub name: String, // "BTC-USD", "NVDA_24_5-USD", spelled as the socket's data.m
    #[serde(default)]
    pub asset_name: String, // "BTC", "SPX500m"
    #[serde(default)]
    pub collateral_asset_name: String, // "USD" on every row, which is USDC
    #[serde(default)]
    pub category: String, // "Crypto" or "RWA"
    #[serde(rename = "type", default)]
    pub kind: String, // "PERPETUAL" or "SPOT"
    #[serde(default)]
    pub status: String, // "ACTIVE", "REDUCE_ONLY", "DELISTED", "PRELISTED" or "DISABLED"
    pub is_rfq: Option<bool>,
    pub market_stats: Option<Stats>,
}

#[cfg(test)]
pub mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows of GET /api/v1/info/markets captured live on 2026-10-12, cut to the fields read here and a few others.
    pub fn row(name: &str, category: &str, asset: &str, kind: &str, status: &str, rfq: bool, stats: Value) -> Value {
        json!({
            "name": name, "uiName": name, "category": category, "assetName": asset, "collateralAssetName": "USD",
            "active": true, "status": status, "type": kind, "isRfq": rfq, "tradingHours": "CONTINUOUS", "isOffHours": false,
            "marketStats": stats,
        })
    }

    pub fn btc() -> Value {
        let stats = json!({
            "lastPrice": "82472", "askPrice": "82473", "bidPrice": "82472", "markPrice": "82468.428314499993",
            "indexPrice": "82506.324605325004", "fundingRate": "0.000013", "nextFundingRate": 1791846000000_i64,
        });
        row("BTC-USD", "Crypto", "BTC", "PERPETUAL", "ACTIVE", false, stats)
    }

    pub fn spx() -> Value {
        let stats = json!({
            "lastPrice": "7815.8", "askPrice": "7815.9", "bidPrice": "7815.7", "markPrice": "7812.13886948",
            "indexPrice": "7812.08652023", "fundingRate": "0.000004", "nextFundingRate": 1791846000000_i64,
        });
        row("SPX500m-USD", "RWA", "SPX500m", "PERPETUAL", "ACTIVE", false, stats)
    }

    pub fn aia() -> Value {
        let stats = json!({
            "lastPrice": "0.081699", "askPrice": "0.080722", "bidPrice": "0.080543", "markPrice": "0.08056755",
            "indexPrice": "0.08065617", "fundingRate": "0.000000", "nextFundingRate": 1791846000000_i64,
        });
        row("AIA-USD", "Crypto", "AIA", "PERPETUAL", "ACTIVE", true, stats)
    }

    pub fn mkr() -> Value {
        let stats = json!({
            "lastPrice": "1580.186", "askPrice": "0", "bidPrice": "0", "markPrice": "1663.9", "indexPrice": "1663.4002805",
            "fundingRate": "0.000013", "nextFundingRate": 1791846000000_i64,
        });
        row("MKR-USD", "Crypto", "MKR", "PERPETUAL", "REDUCE_ONLY", false, stats)
    }

    fn rows() -> Value {
        let qnt = json!({ "markPrice": "39.705507855585", "indexPrice": "39.836384376799", "fundingRate": "-0.000306", "nextFundingRate": 1791846000000_i64 });
        let spot = json!({ "markPrice": "0", "indexPrice": "82369.333811524993", "fundingRate": "0", "nextFundingRate": 0 });
        let delisted = json!({ "markPrice": "111.686999999999", "indexPrice": "111.686999999999", "fundingRate": "0.000005", "nextFundingRate": 1791846000000_i64 });
        let prelisted = json!({ "markPrice": "140.268689507906", "indexPrice": "140.195866490939", "fundingRate": "0.000000", "nextFundingRate": 1791846000000_i64 });
        json!([
            btc(),
            spx(),
            aia(),
            row("QNT-USD", "RWA", "QNT", "PERPETUAL", "ACTIVE", true, qnt),
            row("BTCSPOT-USD", "Crypto", "BTCSPOT", "SPOT", "ACTIVE", false, spot),
            mkr(),
            row("NOW_24_5-USD", "RWA", "NOW_24_5", "PERPETUAL", "DELISTED", true, delisted),
            row("NOW-USD", "RWA", "NOW", "PERPETUAL", "PRELISTED", true, prelisted),
        ])
    }

    fn parsed(rows: Value) -> Vec<Market> {
        let rows: Vec<Row> = serde_json::from_value(rows).unwrap();
        parse(&rows)
    }

    #[test]
    fn keeps_the_active_order_book_perpetuals_as_linear_usdc_markets_of_one_unit() {
        let markets = parsed(rows());

        assert_eq!(raw_ids(&markets), ["BTC-USD", "SPX500m-USD"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDC"));
        assert!(markets.iter().all(|m| m.linear && m.contract_size == 1.0 && m.price_scale == 1.0));
    }

    #[test]
    fn uppercases_the_asset_name_as_ccxt_does() {
        let markets = parsed(rows());

        assert_eq!(markets[1].base, "SPX500M");
    }

    #[test]
    fn charges_the_crypto_taker_on_crypto_and_the_rwa_taker_on_rwa() {
        let markets = parsed(rows());

        assert_eq!(markets[0].taker_ppm, 250);
        assert_eq!(markets[1].taker_ppm, 100);
    }

    #[test]
    fn drops_an_rfq_market_a_spot_market_and_every_status_but_active() {
        let mut spot = btc();
        spot["type"] = json!("SPOT");
        let mut delisted = btc();
        delisted["status"] = json!("DELISTED");
        let mut prelisted = btc();
        prelisted["status"] = json!("PRELISTED");

        assert!(parsed(json!([aia(), mkr(), spot, delisted, prelisted])).is_empty());
    }

    #[test]
    fn drops_a_row_that_does_not_say_whether_it_is_rfq() {
        let mut row = btc();
        row.as_object_mut().unwrap().remove("isRfq");

        assert!(parsed(json!([row])).is_empty());
    }

    #[test]
    fn drops_a_row_whose_collateral_is_no_dollar() {
        let mut row = btc();
        row["collateralAssetName"] = json!("ETH");

        assert!(parsed(json!([row])).is_empty());
    }

    #[tokio::test]
    async fn loads_every_market_in_one_call_and_counts_the_rows() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, json!({ "status": "OK", "data": rows() }));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(rest.calls(), [MARKETS_PATH]);
        assert_eq!((venue.id.as_str(), venue.name.as_str()), ("extended", "Extended"));
        assert_eq!(raw_ids(&venue.markets), ["BTC-USD", "SPX500m-USD"]);
        let read = logs.events("catalog_read");
        assert_eq!(read[0].number("rows"), 8.0);
        assert_eq!(read[0].number("kept"), 2.0);
    }

    #[tokio::test]
    async fn fails_a_reply_whose_status_is_not_ok_and_a_failed_call() {
        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, json!({ "status": "ERROR", "error": { "code": 1001, "message": "Market not found" } }));

        assert!(load_from(&http(), &rest.url).await.is_err());

        rest.fail(MARKETS_PATH, 500);
        assert!(load_from(&http(), &rest.url).await.is_err());
    }
}
