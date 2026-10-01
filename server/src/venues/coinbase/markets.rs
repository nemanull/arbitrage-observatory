use super::{ADVANCED_REST, ID};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, contract_size, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "Coinbase Advanced";
const TAKER_PPM: u32 = 400;

// Coinbase Advanced, whose ids carry the -INTX suffix, is the only Coinbase platform serving perpetuals publicly.
const PRODUCTS_PATH: &str = "/api/v3/brokerage/market/products?product_type=FUTURE&contract_expiry_type=PERPETUAL";

const CODES: &[(&str, &str)] = &[("CGLD", "CELO")];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, ADVANCED_REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: ProductsReply = get_json(http, &format!("{rest}{PRODUCTS_PATH}")).await?;
    let markets = parse(&reply.products);
    catalog::finish(ID, NAME, reply.products.len(), markets, &[])
}

// CCXT's coinbase parseContractMarket for an enabled perpetual, which is always linear and settles in its quote.
fn parse(products: &[Product]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in products {
        let details = &row.future_product_details;
        if details.contract_expiry_type != "PERPETUAL" || row.is_disabled || row.product_id.is_empty() {
            continue;
        }

        let base = currency_code(&details.contract_root_unit, CODES);
        let quote = currency_code(&row.quote_currency_id, CODES);
        if base.is_empty() || quote.is_empty() {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.product_id.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: contract_size(details.contract_size),
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct ProductsReply {
    #[serde(default)]
    products: Vec<Product>,
}

#[derive(Deserialize)]
struct Product {
    #[serde(default)]
    product_id: String, // "BTC-PERP-INTX"
    #[serde(default)]
    quote_currency_id: String,
    #[serde(default)]
    is_disabled: bool,
    #[serde(default)]
    future_product_details: FutureDetails,
}

#[derive(Deserialize)]
struct FutureDetails {
    #[serde(default)]
    contract_expiry_type: String, // "PERPETUAL" or "EXPIRING"
    #[serde(default)]
    contract_root_unit: String, // "BTC"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    contract_size: f64,
}

impl Default for FutureDetails {
    fn default() -> Self {
        Self {
            contract_expiry_type: String::new(),
            contract_root_unit: String::new(),
            contract_size: f64::NAN,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    fn product(product_id: &str, root: &str, expiry: &str, is_disabled: bool) -> Value {
        json!({
            "product_id": product_id, "base_currency_id": "", "quote_currency_id": "USDC", "is_disabled": is_disabled,
            "trading_disabled": true, "product_type": "FUTURE",
            "future_product_details": {
                "contract_code": root, "contract_size": "1", "contract_root_unit": root, "contract_expiry_type": expiry,
            },
        })
    }

    // Trimmed from the reply of 2026-10-01, when every product also carried trading_disabled, which CCXT did not read.
    fn products() -> Value {
        json!({ "products": [
            product("BTC-PERP-INTX", "BTC", "PERPETUAL", false),
            product("1000PEPE-PERP-INTX", "1000PEPE", "PERPETUAL", false),
            product("CGLD-PERP-INTX", "CGLD", "PERPETUAL", false),
            product("BIT-31OCT26-CDE", "BTC", "EXPIRING", false),
            product("OLD-PERP-INTX", "OLD", "PERPETUAL", true),
        ], "num_products": 5 })
    }

    #[test]
    fn keeps_enabled_perpetuals_with_the_root_unit_as_base() {
        let reply: ProductsReply = serde_json::from_value(products()).unwrap();
        let markets = parse(&reply.products);

        assert_eq!(raw_ids(&markets), ["BTC-PERP-INTX", "1000PEPE-PERP-INTX", "CGLD-PERP-INTX"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDC"));
        assert_eq!(markets[2].base, "CELO");
        assert!(markets[0].linear);
        assert_eq!(markets[0].contract_size, 1.0);
        assert_eq!(markets[0].taker_ppm, 400);
    }

    #[tokio::test]
    async fn loads_the_catalog() {
        let rest = MockRest::start().await;
        rest.reply(PRODUCTS_PATH, products());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "coinbase");
        assert_eq!(venue.markets.len(), 3);
    }
}
