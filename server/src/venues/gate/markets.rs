use super::anchor::CONTRACTS_PATH;
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, contract_size, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "Gate";
const TAKER_PPM: u32 = 500; // CCXT hardcoded 0.0005 on every contract, which is the published VIP 0 USDT-M taker

// CCXT's gate commonCurrencies, which keep a ticker shared by two tokens apart.
const CODES: &[(&str, &str)] = &[
    ("ORT", "XREATORS"),
    ("ASS", "ASSF"),
    ("88MPH", "MPH"),
    ("AXIS", "AXISDEFI"),
    ("BIFI", "BITCOINFILE"),
    ("BOX", "DEFIBOX"),
    ("BYN", "BEYONDFI"),
    ("EGG", "GOOSEFINANCE"),
    ("GTC", "GAMECOM"),
    ("GTC_HT", "GAMECOM_HT"),
    ("GTC_BSC", "GAMECOM_BSC"),
    ("HIT", "HITCHAIN"),
    ("MM", "MILLION"),
    ("MPH", "MORPHER"),
    ("POINT", "GATEPOINT"),
    ("RAI", "RAIREFLEXINDEX"),
    ("SBTC", "SUPERBITCOIN"),
    ("TNC", "TRINITYNETWORKCREDIT"),
    ("VAI", "VAIOT"),
    ("TRAC", "TRACO"),
];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

// Only the USDT family is read, because the registry kept linear USDT contracts and the one socket carries only that family.
async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let contracts: Vec<Contract> = get_json(http, &format!("{rest}{CONTRACTS_PATH}")).await?;
    let markets = parse(&contracts);
    catalog::finish(ID, NAME, contracts.len(), markets, &[])
}

// CCXT's gate parseContractMarket for an active USDT swap, whose name is base and quote and has no date part.
fn parse(contracts: &[Contract]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in contracts {
        let parts: Vec<&str> = row.name.split('_').collect();
        let status = row.status.as_deref().unwrap_or("trading");
        if parts.len() != 2 || status != "trading" {
            continue;
        }

        let base = currency_code(parts[0], CODES);
        let quote = currency_code(parts[1], CODES);
        let settle = currency_code("usdt", CODES);
        if base.is_empty() || quote.is_empty() || quote != settle {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.name.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: contract_size(row.quanto_multiplier), // CCXT reads a multiplier of 0 as one
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct Contract {
    #[serde(default)]
    name: String,
    status: Option<String>, // CCXT reads an absent status as trading
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    quanto_multiplier: f64, // coins per contract
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::json;

    fn parsed(contracts: serde_json::Value) -> Vec<Market> {
        let contracts: Vec<Contract> = serde_json::from_value(contracts).unwrap();
        parse(&contracts)
    }

    #[test]
    fn keeps_trading_usdt_swaps_with_their_quanto_multiplier_as_contract_size() {
        let markets = parsed(json!([
            { "name": "BTC_USDT", "status": "trading", "quanto_multiplier": "0.0001" },
            { "name": "1000PEPE_USDT", "quanto_multiplier": "10" },
            { "name": "OLD_USDT", "status": "delisting", "quanto_multiplier": "1" },
            { "name": "BTC_USDT_20261225", "status": "trading", "quanto_multiplier": "0.0001" },
        ]));

        assert_eq!(raw_ids(&markets), ["BTC_USDT", "1000PEPE_USDT"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!(markets[0].contract_size, 0.0001);
        assert_eq!(markets[1].contract_size, 10.0);
        assert!(markets[0].linear);
        assert_eq!(markets[0].taker_ppm, 500);
    }

    #[test]
    fn maps_codes_through_the_gate_table() {
        let markets = parsed(json!([{ "name": "GTC_USDT", "status": "trading", "quanto_multiplier": "1" }]));

        assert_eq!(markets[0].base, "GAMECOM");
    }

    #[tokio::test]
    async fn loads_the_usdt_contracts() {
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, json!([{ "name": "BTC_USDT", "status": "trading", "quanto_multiplier": "0.0001" }]));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "gate");
        assert_eq!(raw_ids(&venue.markets), ["BTC_USDT"]);
    }
}
