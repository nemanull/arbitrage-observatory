use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;

const NAME: &str = "VALR";

// The tier 1 perpetual taker of 0.070 %, see docs/profiles/valr/fees.md section 4.
const TAKER_PPM: u32 = 700;

// Every FUTURE pair, active or not, which is one call of the 30 a minute that /v1/public/* allows.
pub const PAIRS_PATH: &str = "/v1/public/pairs/FUTURE";

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let pairs: Vec<Pair> = get_json(http, &format!("{rest}{PAIRS_PATH}")).await?;
    let markets = parse(&pairs);
    catalog::finish(ID, NAME, pairs.len(), markets, &[])
}

// No CCXT class exists, so the rules are those of docs/profiles/valr/rest.md section 2.
// Every VALR future is a linear perpetual that settles in its quote, and the ZAR quoted ones fall outside decision 3.
fn parse(pairs: &[Pair]) -> Vec<Market> {
    let mut markets = Vec::new();

    for pair in pairs {
        if pair.currency_pair_type != "FUTURE" || !pair.active {
            continue;
        }

        let base = currency_code(&pair.base_currency, &[]);
        let quote = currency_code(&pair.quote_currency, &[]);
        if base.is_empty() || !matches!(quote.as_str(), "USDT" | "USDC" | "USD") {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: pair.symbol.clone(), // "BTCUSDTPERP", the socket's ps
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0, // book quantities are base coins, and no catalog field says otherwise
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Pair {
    symbol: String,
    #[serde(default)]
    base_currency: String,
    #[serde(default)]
    quote_currency: String, // "USDT", "USDC" or "ZAR"
    #[serde(default)]
    active: bool,
    #[serde(default)]
    currency_pair_type: String, // "FUTURE" or "SPOT"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the reply captured live on 2026-10-09, which held 25 FUTURE rows, 4 of them active.
    // ETHZARPERP is flipped to active and a SPOT row is added, so the quote rule and the type rule each have a case.
    fn reply() -> Value {
        json!([
            { "symbol": "BTCUSDCPERP", "baseCurrency": "BTC", "quoteCurrency": "USDC", "shortName": "BTC/USDCPERP", "active": false, "minBaseAmount": "0.0001", "maxBaseAmount": "35", "tickSize": "1", "currencyPairType": "FUTURE" },
            { "symbol": "BTCUSDTPERP", "baseCurrency": "BTC", "quoteCurrency": "USDT", "shortName": "BTC/USDTPERP", "active": true, "minBaseAmount": "0.0001", "maxBaseAmount": "7", "tickSize": "1", "baseDecimalPlaces": "4", "marginTradingAllowed": false, "currencyPairType": "FUTURE", "initialMarginFraction": "0.0166", "maintenanceMarginFraction": "0.0083", "autoCloseMarginFraction": "0.0083" },
            { "symbol": "ETHUSDTPERP", "baseCurrency": "ETH", "quoteCurrency": "USDT", "shortName": "ETH/USDTPERP", "active": true, "tickSize": "0.1", "currencyPairType": "FUTURE" },
            { "symbol": "USDTZARPERP", "baseCurrency": "USDT", "quoteCurrency": "ZAR", "shortName": "USDT/ZARPERP", "active": false, "tickSize": "0.0001", "currencyPairType": "FUTURE" },
            { "symbol": "XRPUSDTPERP", "baseCurrency": "XRP", "quoteCurrency": "USDT", "shortName": "XRP/USDTPERP", "active": true, "tickSize": "0.0001", "currencyPairType": "FUTURE" },
            { "symbol": "DOGEUSDTPERP", "baseCurrency": "DOGE", "quoteCurrency": "USDT", "shortName": "DOGE/USDTPERP", "active": false, "tickSize": "0.00001", "currencyPairType": "FUTURE" },
            { "symbol": "SOLUSDTPERP", "baseCurrency": "SOL", "quoteCurrency": "USDT", "shortName": "SOL/USDTPERP", "active": true, "tickSize": "0.01", "currencyPairType": "FUTURE" },
            { "symbol": "ETHZARPERP", "baseCurrency": "ETH", "quoteCurrency": "ZAR", "shortName": "ETH/ZARPERP", "active": true, "tickSize": "1", "currencyPairType": "FUTURE" },
            { "symbol": "BTCUSDT", "baseCurrency": "BTC", "quoteCurrency": "USDT", "shortName": "BTC/USDT", "active": true, "tickSize": "1", "currencyPairType": "SPOT" },
        ])
    }

    fn parsed() -> Vec<Market> {
        let pairs: Vec<Pair> = serde_json::from_value(reply()).unwrap();
        parse(&pairs)
    }

    #[test]
    fn keeps_the_active_usdt_perpetuals_under_their_socket_symbol() {
        assert_eq!(raw_ids(&parsed()), ["BTCUSDTPERP", "ETHUSDTPERP", "XRPUSDTPERP", "SOLUSDTPERP"]);
    }

    #[test]
    fn drops_inactive_rows_zar_quoted_perpetuals_and_spot_pairs() {
        let ids = raw_ids(&parsed()).join(",");

        assert!(!ids.contains("USDCPERP"));
        assert!(!ids.contains("DOGE"));
        assert!(!ids.contains("ZAR"));
        assert!(!ids.split(',').any(|id| id == "BTCUSDT"));
    }

    #[test]
    fn names_base_and_quote_from_the_currency_fields() {
        let markets = parsed();
        let pairs: Vec<(&str, &str)> = markets.iter().map(|m| (m.base.as_str(), m.quote.as_str())).collect();

        assert_eq!(pairs, [("BTC", "USDT"), ("ETH", "USDT"), ("XRP", "USDT"), ("SOL", "USDT")]);
    }

    #[test]
    fn counts_one_base_coin_per_contract_at_the_tier_one_taker() {
        assert!(parsed().iter().all(|m| m.linear && m.contract_size == 1.0 && m.price_scale == 1.0 && m.taker_ppm == 700));
    }

    #[tokio::test]
    async fn loads_the_catalog_and_fails_on_an_empty_reply() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(PAIRS_PATH, reply());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "valr");
        assert_eq!(venue.name, "VALR");
        assert_eq!(venue.markets.len(), 4);
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 9.0);

        let empty = MockRest::start().await;
        empty.reply(PAIRS_PATH, json!([]));
        assert!(load_from(&http(), &empty.url).await.is_err());
    }
}
