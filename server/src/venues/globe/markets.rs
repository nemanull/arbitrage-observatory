use super::anchor::CONTRACTS_PATH;
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "Globe";

// The VIP 0 perpetual taker of 0.05 %, which product-detail's taker_fee 0.0005 confirms, see docs/profiles/globe/fees.md section 2.
const TAKER_PPM: u32 = 500;

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let contracts: Vec<Contract> = get_json(http, &format!("{rest}{CONTRACTS_PATH}")).await?;
    let markets = parse(&contracts);
    catalog::finish(ID, NAME, contracts.len(), markets, &[])
}

// No CCXT class exists, so the rules are those of docs/profiles/globe/rest.md section 2.
// A suspended contract streams empty books and publishes its mark equal to its index.
pub(super) fn is_trading(contract: &Contract) -> bool {
    contract.product_type.eq_ignore_ascii_case("perpetual") && contract.product_status == "Active"
}

fn parse(contracts: &[Contract]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in contracts {
        // Every row was Vanilla on 2026-10-09, which the socket's product-detail calls Linear.
        let linear = matches!(row.contract_type.as_str(), "Vanilla" | "Linear");
        if !is_trading(row) || !linear || !matches!(row.quote_symbol.as_str(), "USD" | "USDT" | "USDC") {
            continue;
        }

        let base = currency_code(&row.base_symbol, &[]);
        if base.is_empty() {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.instrument.clone(),
            base,
            quote: row.quote_symbol.clone(),
            taker_ppm: TAKER_PPM,
            linear: true,
            // contract_price is the order step, 0.0001 on BTC-PERP, while the book's volume is already in coins.
            contract_size: 1.0,
            price_scale: 1.0,
        });
    }

    markets
}

// One row of the contracts call, which the loader and the anchor poll both read.
#[derive(Deserialize)]
pub(super) struct Contract {
    #[serde(default)]
    pub instrument: String, // "BTC-PERP", the socket's id
    #[serde(default)]
    product_type: String, // "perpetual", which the documentation spells "Perpetual"
    #[serde(default)]
    product_status: String, // "Active" or "Suspended", and documented also "Configuring", "NoMatching" and "Closed"
    #[serde(default)]
    base_symbol: String,
    #[serde(default)]
    quote_symbol: String, // "USD" on every row
    #[serde(default)]
    contract_type: String, // "Vanilla"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    pub index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    pub mark_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    pub funding_rate: f64, // percent per 8 h, so -0.0033333333333333335 is -0.0000333
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    pub next_funding_time: f64, // Unix ms
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the contracts reply captured live on 2026-10-09 at 18:16 UTC, without ohlc, tags and the volume fields.
    fn contract(instrument: &str, base: &str, status: &str, contract_price: f64) -> Value {
        json!({
            "product_type": "perpetual", "product_status": status, "instrument": instrument,
            "base_symbol": base, "quote_symbol": "USD", "contract_price": contract_price, "contract_type": "Vanilla",
            "contract_price_currency": "USD", "max_leverage": 20, "early_access": false,
        })
    }

    // Globe lists neither an inverse nor a quanto contract today, so this row is the BTC capture with a documented other type.
    fn quanto() -> Value {
        let mut row = contract("BTC-QPERP", "BTC", "Active", 0.0001);
        row["contract_type"] = json!("Quanto");
        row
    }

    fn reply() -> Value {
        json!([
            contract("BTC-PERP", "BTC", "Active", 0.0001),
            contract("PEPE-PERP", "PEPE", "Active", 1000000.0),
            contract("XLM-PERP", "XLM", "Active", 10.0),
            contract("IOTA-PERP", "IOTA", "Suspended", 10.0),
            quanto(),
        ])
    }

    fn parsed() -> Vec<Market> {
        let contracts: Vec<Contract> = serde_json::from_value(reply()).unwrap();
        parse(&contracts)
    }

    #[test]
    fn keeps_the_active_linear_usd_perpetuals() {
        assert_eq!(raw_ids(&parsed()), ["BTC-PERP", "PEPE-PERP", "XLM-PERP"]);
    }

    #[test]
    fn drops_a_suspended_contract_and_a_contract_that_is_not_linear() {
        let ids = raw_ids(&parsed()).join(",");

        assert!(!ids.contains("IOTA-PERP"));
        assert!(!ids.contains("BTC-QPERP"));
    }

    #[test]
    fn drops_a_spot_row_and_reads_the_documented_spelling_of_the_type() {
        let mut spot = contract("BTC/USDT", "BTC", "Active", 0.0001);
        spot["product_type"] = json!("spot");
        let mut documented = contract("ETH-PERP", "ETH", "Active", 0.001);
        documented["product_type"] = json!("Perpetual");
        let contracts: Vec<Contract> = serde_json::from_value(json!([spot, documented])).unwrap();

        assert_eq!(raw_ids(&parse(&contracts)), ["ETH-PERP"]);
    }

    #[test]
    fn keeps_usdt_and_usdc_quotes_with_either_linear_spelling_and_drops_a_coin_quoted_contract() {
        let mut usdt = contract("SOL-PERP", "SOL", "Active", 0.1);
        usdt["quote_symbol"] = json!("USDT");
        usdt["contract_type"] = json!("Linear");
        let mut usdc = contract("ETH-PERP", "ETH", "Active", 0.001);
        usdc["quote_symbol"] = json!("USDC");
        let mut coin = contract("ETH-BTC-PERP", "ETH", "Active", 0.001);
        coin["quote_symbol"] = json!("BTC");
        let contracts: Vec<Contract> = serde_json::from_value(json!([usdt, usdc, coin])).unwrap();

        let markets = parse(&contracts);

        assert_eq!(raw_ids(&markets), ["SOL-PERP", "ETH-PERP"]);
        assert_eq!((markets[0].quote.as_str(), markets[1].quote.as_str()), ("USDT", "USDC"));
    }

    #[test]
    fn counts_one_coin_per_contract_whatever_the_contract_price_at_the_vip_0_taker() {
        let markets = parsed();

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USD"));
        assert_eq!(markets[1].base, "PEPE");
        assert!(markets.iter().all(|m| m.linear && m.contract_size == 1.0 && m.price_scale == 1.0 && m.taker_ppm == 500));
    }

    #[tokio::test]
    async fn loads_the_catalog_and_fails_on_a_refused_call() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, reply());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "globe");
        assert_eq!(venue.name, "Globe");
        assert_eq!(raw_ids(&venue.markets), ["BTC-PERP", "PEPE-PERP", "XLM-PERP"]);
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 5.0);

        let failing = MockRest::start().await;
        failing.fail(CONTRACTS_PATH, 500);
        assert!(load_from(&http(), &failing.url).await.is_err());
    }
}
