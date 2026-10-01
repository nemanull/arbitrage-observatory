use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;

const NAME: &str = "Bitstamp";

// The perpetual taker under both Early Bird programmes, which last until Bitstamp introduces volume tiers, see docs/profiles/bitstamp/fees.md section 9.
// The day the tiers land, every Bitstamp leg is mispriced until this changes.
const TAKER_PPM: u32 = 150;

const MARKETS_PATH: &str = "/api/v2/markets/";

const CODES: &[(&str, &str)] = &[("UST", "USTC")];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let rows: Vec<MarketRow> = get_json(http, &format!("{rest}{MARKETS_PATH}")).await?;
    let markets = parse(&rows);
    catalog::finish(ID, NAME, rows.len(), markets, &[])
}

// CCXT's bitstamp fetchMarkets for an enabled perpetual, which is linear, settles in its quote, and counts one coin per contract.
fn parse(rows: &[MarketRow]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        if row.market_type != "PERPETUAL" || row.trading != "Enabled" || row.market_symbol.is_empty() {
            continue;
        }

        let base = currency_code(&row.base_currency, CODES);
        let quote = currency_code(&row.counter_currency, CODES);
        if base.is_empty() || quote.is_empty() {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.market_symbol.clone(),
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
struct MarketRow {
    #[serde(default)]
    market_symbol: String, // "btcusd-perp", the socket's id
    #[serde(default)]
    base_currency: String,
    #[serde(default)]
    counter_currency: String,
    #[serde(default)]
    market_type: String, // "PERPETUAL" or "SPOT"
    #[serde(default)]
    trading: String, // "Enabled" or "Disabled"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    fn row(symbol: &str, base: &str, kind: &str, trading: &str) -> Value {
        json!({
            "name": format!("{base}/USD"), "market_symbol": symbol, "base_currency": base, "base_decimals": 5,
            "counter_currency": "USD", "counter_decimals": 2, "trading": trading, "market_type": kind,
        })
    }

    // Trimmed from the reply of 2026-10-01.
    fn rows() -> Value {
        json!([
            row("btcusd", "BTC", "SPOT", "Enabled"),
            row("btcusd-perp", "BTC", "PERPETUAL", "Enabled"),
            row("ustusd-perp", "UST", "PERPETUAL", "Enabled"),
            row("oldusd-perp", "OLD", "PERPETUAL", "Disabled"),
        ])
    }

    #[test]
    fn keeps_enabled_perpetuals_by_their_socket_id() {
        let rows: Vec<MarketRow> = serde_json::from_value(rows()).unwrap();
        let markets = parse(&rows);

        assert_eq!(raw_ids(&markets), ["btcusd-perp", "ustusd-perp"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USD"));
        assert_eq!(markets[1].base, "USTC");
        assert!(markets[0].linear);
        assert_eq!(markets[0].contract_size, 1.0);
        assert_eq!(markets[0].taker_ppm, 150);
    }

    #[tokio::test]
    async fn loads_the_catalog() {
        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, rows());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "bitstamp");
        assert_eq!(venue.markets.len(), 2);
    }
}
