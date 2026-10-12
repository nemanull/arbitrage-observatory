use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;

// The filter cuts the 1.4 MB of every option and spot pair down to the perpetual rows.
pub const PRODUCTS_PATH: &str = "/v2/products?contract_types=perpetual_futures";

const NAME: &str = "Delta Exchange";

// The API taker of the fee page, 0.03 % on every perpetual row.
// CCXT reads taker_commission_rate, the rate of orders placed outside the API, 0.01 % on BTC and ETH.
// PAXGUSDT's catalog reads 0.02 % in both fields, so 300 overstates it by 100 ppm.
const TAKER_PPM: u32 = 300;

const PERPETUAL: &str = "perpetual_futures";
const LIVE: &str = "live";
const QUOTES: &[&str] = &["USDT", "USDC", "USD"];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Reply = get_json(http, &format!("{rest}{PRODUCTS_PATH}")).await?;
    if !reply.success {
        anyhow::bail!("products answered success false");
    }

    let rows = reply.result.unwrap_or_default();
    catalog::finish(ID, NAME, rows.len(), parse(&rows), &[])
}

// CCXT's delta fetchMarkets for an active linear swap, which reads active from state alone.
// A trading_status of disrupted_cancel_only or disrupted_post_only passes, as in CCXT, because a disruption or an auction ends while the run goes on.
// The anchor leaves such a market's rows out while it lasts.
// CCXT has no delta commonCurrencies table, so only the base table applies.
fn parse(rows: &[Product]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        if row.contract_type != PERPETUAL || row.state != LIVE {
            continue;
        }

        let base = currency_code(&row.underlying_asset.symbol, &[]);
        let quote = currency_code(&row.quoting_asset.symbol, &[]);
        let settle = currency_code(&row.settling_asset.symbol, &[]);
        if base.is_empty() || quote != settle || !QUOTES.contains(&quote.as_str()) {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            // The book counts contracts of contract_value coins, 0.001 BTC on BTCUSDT and 100 DOGE on DOGEUSDT.
            contract_size: catalog::contract_size(row.contract_value),
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
pub struct Reply {
    #[serde(default)]
    pub success: bool,
    pub result: Option<Vec<Product>>,
}

#[derive(Deserialize)]
pub struct Product {
    #[serde(default)]
    pub symbol: String, // "BTCUSDT", the socket's sy and the ticker's symbol
    #[serde(default)]
    contract_type: String, // "perpetual_futures"
    #[serde(default)]
    state: String, // "upcoming", "live", "expired" or "settled"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    contract_value: f64, // coins per contract, "0.001"
    #[serde(default)]
    underlying_asset: Asset,
    #[serde(default)]
    quoting_asset: Asset,
    #[serde(default)]
    settling_asset: Asset,
    #[serde(default)]
    pub product_specs: ProductSpecs,
}

#[derive(Deserialize, Default)]
struct Asset {
    #[serde(default)]
    symbol: String,
}

#[derive(Deserialize, Default)]
pub struct ProductSpecs {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    pub rate_exchange_interval: f64, // the funding interval in seconds, 28800 or 14400
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows of GET /v2/products?contract_types=perpetual_futures captured live on 2026-10-09, cut down to the fields the loader reads plus a few it ignores.
    fn product(symbol: &str, base: &str, contract_value: &str, interval: i64) -> Value {
        json!({
            "id": 139, "symbol": symbol, "contract_type": "perpetual_futures", "state": "live", "trading_status": "operational",
            "notional_type": "vanilla", "contract_value": contract_value, "contract_unit_currency": base, "tick_size": "0.5",
            "taker_commission_rate": "0.0001", "maker_commission_rate": "0.0001",
            "product_specs": { "api_taker_commission_rate": "0.0003", "funding_clamp_value": 0.05, "rate_exchange_interval": interval },
            "underlying_asset": { "id": 2, "symbol": base, "precision": 8 },
            "quoting_asset": { "id": 5, "symbol": "USDT", "precision": 8 },
            "settling_asset": { "id": 5, "symbol": "USDT", "precision": 8 },
            "spot_index": { "symbol": format!(".DE{base}USDT"), "index_type": "spot_pair" },
        })
    }

    fn btc() -> Value {
        product("BTCUSDT", "BTC", "0.001", 28800)
    }

    fn doge() -> Value {
        product("DOGEUSDT", "DOGE", "100", 28800)
    }

    fn paxg() -> Value {
        product("PAXGUSDT", "PAXG", "0.001", 14400)
    }

    // The catalog lists no inverse perpetual today, so this is BTCUSDT settled in BTC, as the venue's older BTCUSD contract was.
    fn btc_inverse() -> Value {
        let mut row = product("BTCUSD", "BTC", "1", 28800);
        row["notional_type"] = json!("inverse");
        row["quoting_asset"]["symbol"] = json!("USD");
        row["settling_asset"]["symbol"] = json!("BTC");
        row
    }

    fn sol_upcoming() -> Value {
        let mut row = product("SOLUSDT", "SOL", "1", 28800);
        row["state"] = json!("upcoming");
        row
    }

    fn products(rows: Vec<Value>) -> Value {
        json!({ "meta": { "after": null, "before": null, "limit": 3000, "total_count": rows.len() }, "success": true, "result": rows })
    }

    fn parsed(rows: Vec<Value>) -> Vec<Market> {
        let reply: Reply = serde_json::from_value(products(rows)).unwrap();
        parse(&reply.result.unwrap())
    }

    #[test]
    fn keeps_live_linear_perpetuals_with_contract_value_coins_per_contract() {
        let markets = parsed(vec![btc(), doge(), paxg(), btc_inverse(), sol_upcoming()]);

        assert_eq!(raw_ids(&markets), ["BTCUSDT", "DOGEUSDT", "PAXGUSDT"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!(markets[0].contract_size, 0.001);
        assert_eq!(markets[1].contract_size, 100.0);
        assert_eq!(markets[2].base, "PAXG");
        for market in &markets {
            assert!(market.linear);
            assert_eq!(market.taker_ppm, 300);
            assert_eq!(market.price_scale, 1.0);
        }
    }

    #[test]
    fn keeps_a_market_whose_trading_is_disrupted() {
        let mut row = btc();
        row["trading_status"] = json!("disrupted_cancel_only");

        assert_eq!(raw_ids(&parsed(vec![row])), ["BTCUSDT"]);
    }

    #[test]
    fn drops_options_spot_and_dated_futures() {
        let mut call = btc();
        call["symbol"] = json!("C-BTC-90000-101026");
        call["contract_type"] = json!("call_options");
        let mut spot = btc();
        spot["symbol"] = json!("BTC_USDT");
        spot["contract_type"] = json!("spot");
        let mut future = btc();
        future["symbol"] = json!("BTCUSDT_101026");
        future["contract_type"] = json!("futures");

        assert!(parsed(vec![call, spot, future]).is_empty());
    }

    #[test]
    fn keeps_linear_perpetuals_quoted_in_usdc_or_usd() {
        let mut usdc = product("BTCUSDC", "BTC", "0.001", 28800);
        usdc["quoting_asset"]["symbol"] = json!("USDC");
        usdc["settling_asset"]["symbol"] = json!("USDC");
        let mut usd = product("ETHUSD", "ETH", "0.01", 28800);
        usd["quoting_asset"]["symbol"] = json!("USD");
        usd["settling_asset"]["symbol"] = json!("USD");

        let markets = parsed(vec![usdc, usd]);

        assert_eq!(raw_ids(&markets), ["BTCUSDC", "ETHUSD"]);
        assert_eq!(markets[0].quote, "USDC");
        assert_eq!(markets[1].quote, "USD");
    }

    #[test]
    fn drops_a_coin_quoted_perpetual() {
        let mut row = product("ETHBTC", "ETH", "0.01", 28800);
        row["quoting_asset"]["symbol"] = json!("BTC");
        row["settling_asset"]["symbol"] = json!("BTC");

        assert!(parsed(vec![row]).is_empty());
    }

    #[test]
    fn reads_a_missing_contract_value_as_one_coin() {
        let mut row = btc();
        row.as_object_mut().unwrap().remove("contract_value");

        assert_eq!(parsed(vec![row])[0].contract_size, 1.0);
    }

    #[tokio::test]
    async fn loads_the_live_perpetuals() {
        let rest = MockRest::start().await;
        rest.reply(PRODUCTS_PATH, products(vec![btc(), sol_upcoming(), paxg()]));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "delta");
        assert_eq!(venue.name, "Delta Exchange");
        assert_eq!(raw_ids(&venue.markets), ["BTCUSDT", "PAXGUSDT"]);
    }

    #[tokio::test]
    async fn fails_on_an_error_reply() {
        let rest = MockRest::start().await;
        rest.reply(PRODUCTS_PATH, json!({ "error": { "code": "bad_schema" }, "success": false }));

        assert!(load_from(&http(), &rest.url).await.is_err());

        rest.fail(PRODUCTS_PATH, 400);

        assert!(load_from(&http(), &rest.url).await.is_err());
    }
}
