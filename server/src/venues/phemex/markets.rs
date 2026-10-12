use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;

pub const PRODUCTS_PATH: &str = "/public/products";

const NAME: &str = "Phemex";
const TAKER_PPM: u32 = 600; // the published VIP 0 futures taker, since CCXT reports none on any USDT-M or USDC-M row

const QUOTES: &[&str] = &["USDT", "USDC", "USD"];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Reply = get_json(http, &format!("{rest}{PRODUCTS_PATH}")).await?;
    if reply.code != 0 {
        anyhow::bail!("products answered code {}: {}", reply.code, reply.msg);
    }

    let rows = &reply.data.perp_products_v2;
    catalog::finish(ID, NAME, rows.len(), parse(rows), &[])
}

// CCXT's phemex parseSwapMarket for an active linear swap, read from perpProductsV2 only.
// The legacy `products` list holds the COIN-M contracts and the old USD settled model, whose prices are scaled integers on another channel, and none of its linear rows is listed.
// TradFi and pre market contracts are kept, as decision 4 of the waves design says.
fn parse(rows: &[Product]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        let kind = row.kind.to_lowercase();
        let is_swap = kind == "perpetualv2" || kind == "perpetual" || kind == "perpetualpilot";
        if !is_swap || row.status != "Listed" || row.settle_currency != row.quote_currency {
            continue;
        }

        // CCXT removes the first space of a junction code, so "1000 PEPE" is 1000PEPE, priced per 1000 coins like other venues' 1000PEPE.
        let base_id = row.base_currency.as_deref().unwrap_or(&row.contract_underlying_assets);
        let base = currency_code(base_id, &[]).replacen(' ', "", 1);
        let quote = currency_code(&row.quote_currency, &[]);
        if base.is_empty() || !QUOTES.contains(&quote.as_str()) {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            // The row has no size field, and the book and the order quantity count base coins on USDT-M and USDC-M alike.
            // CCXT reads 1 on USDT-M and 0 on USDC-M, where its contractSize parse fails.
            contract_size: 1.0,
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct Reply {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    msg: String,
    data: Data,
}

#[derive(Deserialize)]
struct Data {
    #[serde(rename = "perpProductsV2", default)]
    perp_products_v2: Vec<Product>,
}

#[derive(Deserialize)]
struct Product {
    #[serde(default)]
    symbol: String, // "BTCUSDT", "u1000PEPEUSDT", the socket's and the ticker's id
    #[serde(rename = "type", default)]
    kind: String, // "PerpetualV2"
    #[serde(default)]
    status: String, // "Listed" or "Delisted"
    #[serde(rename = "baseCurrency")]
    base_currency: Option<String>, // "BTC", "1000 PEPE"
    #[serde(rename = "contractUnderlyingAssets", default)]
    contract_underlying_assets: String,
    #[serde(rename = "quoteCurrency", default)]
    quote_currency: String,
    #[serde(rename = "settleCurrency", default)]
    settle_currency: String,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows of GET /public/products captured live on 2026-10-08, cut down to the fields the loader reads plus a few it ignores.
    fn btc_usdt() -> Value {
        json!({
            "perpProductSubType": "Normal", "symbol": "BTCUSDT", "code": 41541, "type": "PerpetualV2",
            "displaySymbol": "BTC / USDT", "indexSymbol": ".BTCUSDT", "contractUnderlyingAssets": "BTC",
            "settleCurrency": "USDT", "quoteCurrency": "USDT", "tickSize": "0.1", "baseCurrency": "BTC",
            "status": "Listed", "fundingInterval": 28800, "qtyStepSize": "0.001",
        })
    }

    fn btc_usdc() -> Value {
        json!({
            "perpProductSubType": "Normal", "symbol": "BTCUSDC", "code": 40041, "type": "PerpetualV2",
            "displaySymbol": "BTC / USDC", "indexSymbol": ".BTCUSDC", "contractUnderlyingAssets": "BTC",
            "settleCurrency": "USDC", "quoteCurrency": "USDC", "tickSize": "0.1", "baseCurrency": "BTC",
            "description": "BTC/USDC perpetual contracts are priced on the .BTCUSDC Index. Each contract is worth 1 BTC.",
            "status": "Listed", "fundingInterval": 28800, "qtyStepSize": "0.001",
        })
    }

    fn pepe_usdt() -> Value {
        json!({
            "perpProductSubType": "Normal", "symbol": "u1000PEPEUSDT", "type": "PerpetualV2",
            "contractUnderlyingAssets": "1000 PEPE", "settleCurrency": "USDT", "quoteCurrency": "USDT",
            "baseCurrency": "1000 PEPE", "status": "Listed", "fundingInterval": 28800,
        })
    }

    fn tsla_tradfi() -> Value {
        json!({
            "perpProductSubType": "TradFi", "perpProductSubGroup": "Stocks", "symbol": "TSLAUSDT", "type": "PerpetualV2",
            "contractUnderlyingAssets": "TSLA", "settleCurrency": "USDT", "quoteCurrency": "USDT", "baseCurrency": "TSLA",
            "status": "Listed", "fundingInterval": 14400, "feeRateDiscountRate": 0.0,
        })
    }

    fn anthropic_pre_market() -> Value {
        json!({
            "perpProductSubType": "PreMarket", "symbol": "ANTHROPICUSDT", "type": "PerpetualV2",
            "contractUnderlyingAssets": "ANTHROPIC", "settleCurrency": "USDT", "quoteCurrency": "USDT",
            "baseCurrency": "ANTHROPIC", "status": "Listed", "fundingInterval": 28800,
        })
    }

    fn hook_delisted() -> Value {
        json!({
            "perpProductSubType": "Normal", "symbol": "HOOKUSDT", "type": "PerpetualV2", "contractUnderlyingAssets": "HOOK",
            "settleCurrency": "USDT", "quoteCurrency": "USDT", "baseCurrency": "HOOK", "status": "Delisted",
        })
    }

    // No inverse row sits in perpProductsV2 today, so this is the COIN-M ETH contract of the legacy list moved into it.
    fn eth_inverse() -> Value {
        json!({
            "symbol": "cETHUSD", "type": "Perpetual", "contractUnderlyingAssets": "USD", "settleCurrency": "ETH",
            "quoteCurrency": "USD", "contractSize": 1.0, "status": "Listed",
        })
    }

    fn products(rows: Vec<Value>) -> Value {
        json!({ "code": 0, "msg": "", "data": { "ratioScale": 8, "perpProductsV2": rows, "perpProductsPilot": null } })
    }

    fn parsed(rows: Vec<Value>) -> Vec<Market> {
        let reply: Reply = serde_json::from_value(products(rows)).unwrap();
        parse(&reply.data.perp_products_v2)
    }

    #[test]
    fn keeps_listed_linear_usdt_and_usdc_contracts_with_one_coin_per_contract() {
        let markets = parsed(vec![btc_usdt(), btc_usdc(), hook_delisted(), eth_inverse()]);

        assert_eq!(raw_ids(&markets), ["BTCUSDT", "BTCUSDC"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!((markets[1].base.as_str(), markets[1].quote.as_str()), ("BTC", "USDC"));
        for market in &markets {
            assert!(market.linear);
            assert_eq!(market.contract_size, 1.0);
            assert_eq!(market.taker_ppm, 600);
            assert_eq!(market.price_scale, 1.0);
        }
    }

    #[test]
    fn drops_a_coin_quoted_contract() {
        let mut row = btc_usdt();
        row["symbol"] = json!("ETHBTC");
        row["baseCurrency"] = json!("ETH");
        row["quoteCurrency"] = json!("BTC");
        row["settleCurrency"] = json!("BTC");

        assert!(parsed(vec![row]).is_empty());
    }

    #[test]
    fn keeps_tradfi_and_pre_market_contracts() {
        let markets = parsed(vec![tsla_tradfi(), anthropic_pre_market()]);

        assert_eq!(raw_ids(&markets), ["TSLAUSDT", "ANTHROPICUSDT"]);
        assert_eq!(markets[0].base, "TSLA");
    }

    #[test]
    fn removes_the_space_of_a_junction_code() {
        let markets = parsed(vec![pepe_usdt()]);

        assert_eq!(markets[0].raw_market_id, "u1000PEPEUSDT");
        assert_eq!(markets[0].base, "1000PEPE");
    }

    #[test]
    fn reads_the_underlying_asset_as_base_when_the_row_has_no_base_currency() {
        let mut row = btc_usdt();
        row.as_object_mut().unwrap().remove("baseCurrency");

        let markets = parsed(vec![row]);

        assert_eq!(markets[0].base, "BTC");
    }

    #[tokio::test]
    async fn loads_the_listed_perpetuals() {
        let rest = MockRest::start().await;
        rest.reply(PRODUCTS_PATH, products(vec![btc_usdt(), hook_delisted(), pepe_usdt()]));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "phemex");
        assert_eq!(venue.name, "Phemex");
        assert_eq!(raw_ids(&venue.markets), ["BTCUSDT", "u1000PEPEUSDT"]);
    }

    #[tokio::test]
    async fn fails_on_an_error_code() {
        let rest = MockRest::start().await;
        rest.reply(PRODUCTS_PATH, json!({ "code": 6001, "msg": "invalid argument", "data": {} }));

        assert!(load_from(&http(), &rest.url).await.is_err());
    }
}
