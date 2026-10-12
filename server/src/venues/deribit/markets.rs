use super::{ID, REST, Reply};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;
use std::collections::HashSet;

// Every future of every currency, perpetuals and dated alike, in one 12 KB reply rather than the 5 MB of the bare call.
pub const INSTRUMENTS_PATH: &str = "/public/get_instruments?currency=any&kind=future";

const NAME: &str = "Deribit";
const TAKER_PPM: u32 = 350; // the Standard 3.5 bps taker, and every perpetual's taker_commission read 0.00035 on 2026-10-08

const QUOTES: &[&str] = &["USDT", "USDC", "USD"];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Reply<Vec<Instrument>> = get_json(http, &format!("{rest}{INSTRUMENTS_PATH}")).await?;
    let instruments = reply.into_result("get_instruments")?;
    let markets = parse(&instruments);
    catalog::finish(ID, NAME, instruments.len(), markets, &[])
}

// CCXT's deribit fetchMarkets for an active linear swap, whose quote is counter_currency and which is linear when it settles in its quote.
// CCXT has no deribit commonCurrencies table, so only the base table applies.
fn parse(instruments: &[Instrument]) -> Vec<Market> {
    let mut markets = Vec::new();
    let mut symbols = HashSet::new();

    for row in instruments {
        // CCXT reads only is_active, and the venue also names a locked, halted or settling book in state.
        if row.settlement_period != "perpetual" || !row.is_active || row.state != "open" {
            continue;
        }

        let base = currency_code(&row.base_currency, &[]);
        let quote = currency_code(&row.counter_currency, &[]);
        let settle = currency_code(&row.settlement_currency, &[]);
        if base.is_empty() || quote != settle || !QUOTES.contains(&quote.as_str()) {
            continue;
        }

        // CCXT keeps the first market of each symbol.
        if !symbols.insert((base.clone(), quote.clone())) {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.instrument_name.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            // A linear book counts base coins, and contract_size is only the order step, 0.0001 on BTC_USDC-PERPETUAL.
            contract_size: 1.0,
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
pub struct Instrument {
    #[serde(default)]
    pub instrument_name: String, // "BTC_USDC-PERPETUAL", the socket's and the summary's id
    #[serde(default)]
    base_currency: String,
    #[serde(default)]
    counter_currency: String, // "USDC", or "USD" on an inverse perpetual whose quote_currency is also USD
    #[serde(default)]
    settlement_currency: String, // "USDC", or the coin on an inverse perpetual
    #[serde(default)]
    settlement_period: String, // "perpetual", "day", "week" or "month"
    #[serde(default)]
    is_active: bool,
    #[serde(default)]
    state: String, // "open", "settlement", "delivered", "inactive", "locked", "halted" or "archivized"
    #[serde(default)]
    pub underlying_type: String, // "crypto", "crypto_index", "equity", "equity_etf", "commodity" or "preipo"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows of get_instruments?currency=any&kind=future captured live on 2026-10-08, cut down to the fields the loader reads plus a few it ignores.
    fn btc_usdc() -> Value {
        json!({
            "instrument_name": "BTC_USDC-PERPETUAL", "kind": "future", "settlement_period": "perpetual",
            "instrument_type": "linear", "future_type": "linear", "base_currency": "BTC", "counter_currency": "USDC",
            "quote_currency": "USDC", "settlement_currency": "USDC", "contract_size": 0.0001, "min_trade_amount": 0.0001,
            "tick_size": 0.1, "taker_commission": 0.00035, "maker_commission": 0.00015, "price_index": "btc_usdc",
            "underlying_type": "crypto", "state": "open", "is_active": true, "expiration_timestamp": 32503708800000_i64,
        })
    }

    fn pepe_usdc() -> Value {
        json!({
            "instrument_name": "1000PEPE_USDC-PERPETUAL", "kind": "future", "settlement_period": "perpetual",
            "instrument_type": "linear", "base_currency": "1000PEPE", "counter_currency": "USDC", "quote_currency": "USDC",
            "settlement_currency": "USDC", "contract_size": 1.0, "taker_commission": 0.00035, "underlying_type": "crypto",
            "state": "open", "is_active": true,
        })
    }

    fn nvda_usdc() -> Value {
        json!({
            "instrument_name": "NVDA_USDC-PERPETUAL", "kind": "future", "settlement_period": "perpetual",
            "instrument_type": "linear", "base_currency": "NVDA", "counter_currency": "USDC", "quote_currency": "USDC",
            "settlement_currency": "USDC", "contract_size": 0.01, "taker_commission": 0.00035, "underlying_type": "equity",
            "state": "open", "is_active": true,
        })
    }

    fn btc_inverse() -> Value {
        json!({
            "instrument_name": "BTC-PERPETUAL", "kind": "future", "settlement_period": "perpetual",
            "instrument_type": "reversed", "future_type": "reversed", "base_currency": "BTC", "counter_currency": "USD",
            "quote_currency": "USD", "settlement_currency": "BTC", "contract_size": 10.0, "taker_commission": 0.00035,
            "price_index": "btc_usd", "underlying_type": "crypto", "state": "open", "is_active": true,
        })
    }

    fn btc_usdc_dated() -> Value {
        json!({
            "instrument_name": "BTC_USDC-16OCT26", "kind": "future", "settlement_period": "week",
            "instrument_type": "linear", "base_currency": "BTC", "counter_currency": "USDC", "quote_currency": "USDC",
            "settlement_currency": "USDC", "contract_size": 0.0001, "underlying_type": "crypto", "state": "open",
            "is_active": true, "expiration_timestamp": 1791878400000_i64,
        })
    }

    // Every perpetual read open and active on 2026-10-08, so these rows are the BTC capture with a documented state and an inactive flag.
    fn locked() -> Value {
        let mut row = btc_usdc();
        row["instrument_name"] = json!("OLD_USDC-PERPETUAL");
        row["base_currency"] = json!("OLD");
        row["state"] = json!("locked");
        row
    }

    fn inactive() -> Value {
        let mut row = btc_usdc();
        row["instrument_name"] = json!("GONE_USDC-PERPETUAL");
        row["base_currency"] = json!("GONE");
        row["is_active"] = json!(false);
        row
    }

    fn reply(rows: Vec<Value>) -> Value {
        json!({ "jsonrpc": "2.0", "result": rows, "usIn": 1791523611006833_i64, "usOut": 1791523611006942_i64, "usDiff": 109, "testnet": false })
    }

    fn parsed(rows: Vec<Value>) -> Vec<Market> {
        let instruments: Vec<Instrument> = serde_json::from_value(json!(rows)).unwrap();
        parse(&instruments)
    }

    #[test]
    fn keeps_open_active_linear_perpetuals_with_one_coin_as_the_contract_size() {
        let markets = parsed(vec![btc_usdc(), pepe_usdc(), nvda_usdc()]);

        assert_eq!(raw_ids(&markets), ["BTC_USDC-PERPETUAL", "1000PEPE_USDC-PERPETUAL", "NVDA_USDC-PERPETUAL"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDC"));
        assert_eq!(markets[1].base, "1000PEPE");
        assert!(markets.iter().all(|m| m.contract_size == 1.0 && m.linear && m.price_scale == 1.0));
        assert_eq!(markets[0].taker_ppm, 350);
    }

    #[test]
    fn drops_inverse_perpetuals_dated_futures_and_books_that_are_not_open_or_not_active() {
        let markets = parsed(vec![btc_inverse(), btc_usdc_dated(), locked(), inactive(), btc_usdc()]);

        assert_eq!(raw_ids(&markets), ["BTC_USDC-PERPETUAL"]);
    }

    // No linear perpetual was quoted in a coin on 2026-10-08, so this row is the BTC capture quoted and settled in ETH.
    #[test]
    fn drops_a_linear_perpetual_quoted_in_a_coin() {
        let mut coin_quoted = btc_usdc();
        coin_quoted["instrument_name"] = json!("BTC_ETH-PERPETUAL");
        coin_quoted["counter_currency"] = json!("ETH");
        coin_quoted["settlement_currency"] = json!("ETH");

        let markets = parsed(vec![coin_quoted, btc_usdc()]);

        assert_eq!(raw_ids(&markets), ["BTC_USDC-PERPETUAL"]);
    }

    #[test]
    fn keeps_the_first_of_two_perpetuals_with_one_symbol_and_maps_xbt_through_the_base_table() {
        let mut xbt = btc_usdc();
        xbt["instrument_name"] = json!("XBT_USDC-PERPETUAL");
        xbt["base_currency"] = json!("XBT");

        let markets = parsed(vec![btc_usdc(), xbt]);

        assert_eq!(raw_ids(&markets), ["BTC_USDC-PERPETUAL"]);
    }

    #[tokio::test]
    async fn loads_the_perpetuals_of_the_one_catalog_call() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, reply(vec![btc_usdc(), btc_inverse(), btc_usdc_dated()]));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(rest.calls(), ["/public/get_instruments?currency=any&kind=future"]);
        assert_eq!(venue.id, "deribit");
        assert_eq!(venue.name, "Deribit");
        assert_eq!(raw_ids(&venue.markets), ["BTC_USDC-PERPETUAL"]);
    }

    #[tokio::test]
    async fn fails_the_load_on_an_error_reply() {
        let rest = MockRest::start().await;
        rest.reply(
            INSTRUMENTS_PATH,
            json!({"jsonrpc":"2.0","error":{"code":-32602,"data":{"reason":"invalid currency","param":"currency"},"message":"Invalid params"},"testnet":false}),
        );

        let error = load_from(&http(), &rest.url).await.unwrap_err();

        assert!(error.to_string().contains("get_instruments: code -32602: Invalid params"), "{error:#}");
    }
}
