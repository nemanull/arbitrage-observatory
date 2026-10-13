use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::post_json;
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;

pub const INSTRUMENTS_PATH: &str = "/full/v1/all_instruments";

const NAME: &str = "GRVT";
const TAKER_PPM: u32 = 450; // Level 1 perpetual taker, 0.0450 %, while CCXT sets no taker at all

// CCXT's grvt sets no commonCurrencies, so only the base table applies.
const CODES: &[(&str, &str)] = &[];

// KBONK, KPEPE and KSHIB quote 1,000 coins: KPEPE's mark read 0.003978 on 2026-10-12 while Binance's 1000PEPEUSDT read 0.003986.
// So each base is the token and its prices scale down to one token, as the hyperliquid and backpack loaders do for their k coins.
// The prefix is no rule here, since KAIA is a token and KORU, KSTR and KODEX200 are equities.
const THOUSANDS: &[(&str, &str)] = &[("KBONK", "BONK"), ("KPEPE", "PEPE"), ("KSHIB", "SHIB")];
const THOUSANDS_SCALE: f64 = 0.001;

// Each entry names the token the ticker collides with.
const DENIED: &[(&str, &str)] = &[];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

// is_active defaults to false, which also returns the delisted rows that CCXT keeps with active unset.
async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let body = serde_json::json!({ "is_active": true });
    let reply: Reply = post_json(http, &format!("{rest}{INSTRUMENTS_PATH}"), &body).await?;
    let markets = parse(&reply.result);
    catalog::finish(ID, NAME, reply.result.len(), markets, DENIED)
}

// CCXT's grvt parseMarket for a PERPETUAL row, kept only while its status is ACTIVE, with a thousand-coin base moved to its token.
fn parse(rows: &[Instrument]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        let active = row.status.as_deref().is_none_or(|status| status == "ACTIVE");
        if row.kind != "PERPETUAL" || !active || row.instrument.is_empty() || row.base.is_empty() {
            continue;
        }

        // CCXT settles a contract in its quote.
        let quote = currency_code(&row.quote, CODES);
        if !matches!(quote.as_str(), "USDT" | "USDC" | "USD") {
            continue;
        }

        let (base, price_scale) = match THOUSANDS.iter().find(|(name, _)| *name == row.base) {
            Some(&(_, token)) => (token.to_string(), THOUSANDS_SCALE),
            None => (currency_code(&row.base, CODES), 1.0),
        };

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.instrument.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0, // CCXT's literal, and book sizes are coins of the named base, 4.02 at BTC's best bid
            price_scale,
        });
    }

    markets
}

#[derive(Deserialize)]
struct Reply {
    #[serde(default)]
    result: Vec<Instrument>,
}

#[derive(Deserialize)]
struct Instrument {
    #[serde(default)]
    instrument: String, // "BTC_USDT_Perp", which the socket's selectors spell the same
    #[serde(default)]
    base: String,
    #[serde(default)]
    quote: String,
    #[serde(default)]
    kind: String, // "PERPETUAL", "FUTURE", "CALL" or "PUT"
    status: Option<String>, // "ACTIVE" or "DELISTED", undocumented
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows of POST /full/v1/all_instruments captured live on 2026-10-12 with the body {}, cut to six of 194.
    // The FUTURE row is BTC's with its kind changed, since the documented kinds other than PERPETUAL listed nothing that day.
    fn rows() -> Value {
        json!([
            { "instrument": "BTC_USDT_Perp", "instrument_hash": "0x030501", "base": "BTC", "quote": "USDT", "kind": "PERPETUAL", "venues": ["ORDERBOOK", "RFQ"], "settlement_period": "PERPETUAL", "base_decimals": 9, "quote_decimals": 6, "tick_size": "0.1", "min_size": "0.001", "create_time": "1790754389133825661", "max_position_size": "1000.0", "funding_interval_hours": 8, "adjusted_funding_rate_cap": "0.3", "adjusted_funding_rate_floor": "-0.3", "min_notional": "100.0", "asset_class": "CRYPTO", "status": "ACTIVE" },
            { "instrument": "KPEPE_USDT_Perp", "instrument_hash": "0x030d01", "base": "KPEPE", "quote": "USDT", "kind": "PERPETUAL", "venues": ["ORDERBOOK", "RFQ"], "settlement_period": "PERPETUAL", "base_decimals": 3, "quote_decimals": 6, "tick_size": "0.0000001", "min_size": "1.0", "create_time": "1790754389133853782", "max_position_size": "310366296.0", "funding_interval_hours": 8, "adjusted_funding_rate_cap": "2.0", "adjusted_funding_rate_floor": "-2.0", "min_notional": "5.0", "asset_class": "CRYPTO", "status": "ACTIVE" },
            { "instrument": "KAIA_USDT_Perp", "instrument_hash": "0x035a01", "base": "KAIA", "quote": "USDT", "kind": "PERPETUAL", "venues": ["ORDERBOOK", "RFQ"], "settlement_period": "PERPETUAL", "base_decimals": 6, "quote_decimals": 6, "tick_size": "0.00001", "min_size": "1.0", "create_time": "1790754389133851981", "max_position_size": "21000000.0", "funding_interval_hours": 1, "adjusted_funding_rate_cap": "2.0", "adjusted_funding_rate_floor": "-2.0", "min_notional": "5.0", "asset_class": "CRYPTO", "status": "ACTIVE" },
            { "instrument": "AAPL_USDT_Perp", "instrument_hash": "0x037701", "base": "AAPL", "quote": "USDT", "kind": "PERPETUAL", "venues": ["ORDERBOOK", "RFQ"], "settlement_period": "PERPETUAL", "base_decimals": 9, "quote_decimals": 6, "tick_size": "0.01", "min_size": "0.01", "create_time": "1790754389133799570", "max_position_size": "15375.0", "funding_interval_hours": 8, "adjusted_funding_rate_cap": "2.0", "adjusted_funding_rate_floor": "-2.0", "min_notional": "5.0", "asset_class": "EQUITY", "status": "ACTIVE" },
            { "instrument": "XAU_USDT_Perp", "instrument_hash": "0x035e01", "base": "XAU", "quote": "USDT", "kind": "PERPETUAL", "venues": ["ORDERBOOK", "RFQ"], "settlement_period": "PERPETUAL", "base_decimals": 9, "quote_decimals": 6, "tick_size": "0.01", "min_size": "0.001", "create_time": "1790754389133906253", "max_position_size": "18500.0", "funding_interval_hours": 4, "adjusted_funding_rate_cap": "0.5", "adjusted_funding_rate_floor": "-0.5", "min_notional": "5.0", "asset_class": "COMMODITY", "status": "ACTIVE" },
            { "instrument": "TON_USDT_Perp", "instrument_hash": "0x030e01", "base": "TON", "quote": "USDT", "kind": "PERPETUAL", "venues": ["ORDERBOOK", "RFQ"], "settlement_period": "PERPETUAL", "base_decimals": 6, "quote_decimals": 6, "tick_size": "0.0001", "min_size": "0.1", "create_time": "1790754389133896153", "max_position_size": "921889.0", "funding_interval_hours": 4, "adjusted_funding_rate_cap": "0.0", "adjusted_funding_rate_floor": "0.0", "min_notional": "5.0", "asset_class": "CRYPTO", "status": "DELISTED" },
            { "instrument": "BTC_USDT_Fut_20261225", "base": "BTC", "quote": "USDT", "kind": "FUTURE", "status": "ACTIVE" },
        ])
    }

    fn parsed(rows: Value) -> Vec<Market> {
        let rows: Vec<Instrument> = serde_json::from_value(rows).unwrap();
        parse(&rows)
    }

    #[test]
    fn keeps_every_active_perpetual_of_each_asset_class_as_a_linear_usdt_market() {
        let markets = parsed(rows());

        assert_eq!(raw_ids(&markets), ["BTC_USDT_Perp", "KPEPE_USDT_Perp", "KAIA_USDT_Perp", "AAPL_USDT_Perp", "XAU_USDT_Perp"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert!(markets.iter().all(|m| m.linear && m.taker_ppm == 450 && m.contract_size == 1.0 && m.venue_id == "grvt"));
        assert_eq!((markets[3].base.as_str(), markets[4].base.as_str()), ("AAPL", "XAU"));
    }

    #[test]
    fn a_thousand_coin_name_is_its_token_priced_per_thousand() {
        let markets = parsed(rows());

        assert_eq!(markets[1].raw_market_id, "KPEPE_USDT_Perp");
        assert_eq!(markets[1].base, "PEPE");
        assert_eq!(markets[1].price_scale, 0.001);
        assert_eq!(markets[1].contract_size, 1.0);
    }

    #[test]
    fn a_k_prefix_alone_is_no_thousand_coin() {
        let markets = parsed(json!([
            { "instrument": "KAIA_USDT_Perp", "base": "KAIA", "quote": "USDT", "kind": "PERPETUAL", "status": "ACTIVE" },
            { "instrument": "KORU_USDT_Perp", "base": "KORU", "quote": "USDT", "kind": "PERPETUAL", "status": "ACTIVE" },
            { "instrument": "KBONK_USDT_Perp", "base": "KBONK", "quote": "USDT", "kind": "PERPETUAL", "status": "ACTIVE" },
            { "instrument": "KSHIB_USDT_Perp", "base": "KSHIB", "quote": "USDT", "kind": "PERPETUAL", "status": "ACTIVE" },
        ]));

        let bases: Vec<(&str, f64)> = markets.iter().map(|m| (m.base.as_str(), m.price_scale)).collect();
        assert_eq!(bases, [("KAIA", 1.0), ("KORU", 1.0), ("BONK", 0.001), ("SHIB", 0.001)]);
    }

    #[test]
    fn leaves_out_a_delisted_row_and_another_kind() {
        let markets = parsed(rows());

        assert!(!raw_ids(&markets).contains(&"TON_USDT_Perp"));
        assert!(!raw_ids(&markets).contains(&"BTC_USDT_Fut_20261225"));
    }

    #[test]
    fn a_row_without_a_status_counts_as_active_and_a_coin_quote_is_dropped() {
        let markets = parsed(json!([
            { "instrument": "ETH_USDT_Perp", "base": "ETH", "quote": "USDT", "kind": "PERPETUAL" },
            { "instrument": "ETH_BTC_Perp", "base": "ETH", "quote": "BTC", "kind": "PERPETUAL", "status": "ACTIVE" },
        ]));

        assert_eq!(raw_ids(&markets), ["ETH_USDT_Perp"]);
    }

    #[tokio::test]
    async fn loads_the_instruments_through_a_post_and_logs_the_scaled_market() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, json!({ "result": rows() }));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(rest.calls(), [INSTRUMENTS_PATH]);
        assert_eq!(venue.id, "grvt");
        assert_eq!(venue.name, "GRVT");
        assert_eq!(venue.markets.len(), 5);
        let read = logs.events("catalog_read");
        assert_eq!(read[0].number("rows"), 7.0);
        assert_eq!(read[0].number("kept"), 5.0);
        assert_eq!(logs.events("market_price_scaled")[0].text("market"), "KPEPE_USDT_Perp");
    }

    #[tokio::test]
    async fn a_failed_or_empty_instruments_call_fails_the_load() {
        let rest = MockRest::start().await;
        rest.fail(INSTRUMENTS_PATH, 500);
        assert!(load_from(&http(), &rest.url).await.is_err());

        rest.reply(INSTRUMENTS_PATH, json!({ "result": [] }));
        assert!(load_from(&http(), &rest.url).await.is_err());
    }
}
