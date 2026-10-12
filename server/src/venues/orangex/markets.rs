use super::anchor::TICKERS_PATH;
use super::{CONNECTIONS, ID, MARKETS_PER_CONNECTION, REST, Reply};
use crate::clock::now_ms;
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

// Only the perpetuals, where the bare call also returns spot and the demo SANDBOX contracts.
pub const INSTRUMENTS_PATH: &str = "/get_instruments?currency=PERPETUAL";

const NAME: &str = "OrangeX";

// The one published perpetual taker, 0.06 %, which taker_commission repeated on all 579 contracts on 2026-10-09.
const TAKER_PPM: u32 = 600;

const QUOTES: &[&str] = &["USDT", "USDC", "USD"];

// Each entry names the token the ticker collides with.
const DENIED: &[(&str, &str)] = &[
    // The ON token at 0.116, while bybit and okx list the ON Semiconductor stock as ON.
    ("ON-USDT-PERPETUAL", "the ON token, while bybit and okx list ON Semiconductor as ON"),
    // Simon's Cat at 0.000002 on 2026-10-09, while binance and gate list the Caterpillar stock at about 804 as CAT.
    ("CAT-USDT-PERPETUAL", "Simon's Cat, while binance and gate list the Caterpillar stock as CAT"),
];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let instruments_url = format!("{rest}{INSTRUMENTS_PATH}");
    let tickers_url = format!("{rest}{TICKERS_PATH}");
    let (instruments, tickers) = tokio::try_join!(
        get_json::<Reply<Vec<Instrument>>>(http, &instruments_url),
        get_json::<Reply<Vec<Ticker>>>(http, &tickers_url),
    )?;
    let instruments = instruments.into_result("get_instruments")?;
    let tickers = tickers.into_result("tickers")?;

    let mut turnover = HashMap::with_capacity(tickers.len());
    for ticker in tickers {
        turnover.insert(ticker.instrument_name, ticker.stats.turnover);
    }

    let markets = most_traded(parse(&instruments, now_ms()), &turnover, CONNECTIONS * MARKETS_PER_CONNECTION);
    catalog::finish(ID, NAME, instruments.len(), markets, DENIED)
}

// OrangeX has no CCXT class, so these are the rules of the profile's rest.md section 2.
// base_currency and quote_currency are swapped on the wire, so the coin is quote_currency and the settlement asset base_currency.
fn parse(instruments: &[Instrument], now: i64) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in instruments {
        // is_active is true before the listing time too, as OURA's was on 2026-09-23.
        if row.kind != "perpetual" || !row.is_active || !(row.creation_timestamp < now as f64) {
            continue;
        }

        let base = currency_code(&row.quote_currency, &[]);
        let quote = currency_code(&row.base_currency, &[]);
        if base.is_empty() || !QUOTES.contains(&quote.as_str()) {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.instrument_name.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            // The catalog has no contract size, and book sizes are coins of the base, 1000SHIB's being thousands of SHIB as binance's base says too.
            contract_size: 1.0,
            price_scale: 1.0,
        });
    }

    markets
}

// The sockets carry fewer books than the venue lists, so the markets with the most 24 h turnover are kept, in catalog order.
// A denied market does not take a place, and catalog::finish drops and logs it after.
fn most_traded(markets: Vec<Market>, turnover: &HashMap<String, f64>, limit: usize) -> Vec<Market> {
    let traded = |market: &Market| turnover.get(&market.raw_market_id).copied().filter(|value| value.is_finite()).unwrap_or(0.0);
    let denied = |market: &Market| DENIED.iter().any(|(id, _)| *id == market.raw_market_id);

    let mut ranked: Vec<&Market> = markets.iter().filter(|market| !denied(market)).collect();
    if ranked.len() <= limit {
        return markets;
    }
    ranked.sort_by(|a, b| traded(b).total_cmp(&traded(a)));
    let cutoff = traded(ranked[limit - 1]);
    let kept: HashSet<String> = ranked[..limit].iter().map(|market| market.raw_market_id.clone()).collect();

    tracing::info!(
        event = "markets_capped",
        venue = ID,
        listed = ranked.len(),
        kept = limit,
        cutoff_turnover = cutoff,
        reason = "30 channels a socket and fewer than 10 sockets",
    );
    markets.into_iter().filter(|market| denied(market) || kept.contains(&market.raw_market_id)).collect()
}

#[derive(Deserialize)]
pub struct Instrument {
    #[serde(default)]
    instrument_name: String, // "BTC-USDT-PERPETUAL", the socket's and every anchor call's id
    #[serde(default)]
    kind: String, // "perpetual", "spot" or "sandbox"
    #[serde(default)]
    is_active: bool,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    creation_timestamp: f64, // ms as a string, in the future on a contract not yet listed
    #[serde(default)]
    base_currency: String, // the settlement asset, "USDT"
    #[serde(default)]
    quote_currency: String, // the coin, "BTC"
}

#[derive(Deserialize)]
struct Ticker {
    #[serde(default)]
    instrument_name: String,
    #[serde(default)]
    stats: Stats,
}

#[derive(Deserialize, Default)]
struct Stats {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    turnover: f64, // the last 24 h in USDT
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    const NOW: i64 = 1_791_571_655_000; // 2026-10-09 18:47 UTC, when the rows below were read

    // Rows trimmed from the live reply of 2026-10-09, which listed 579 perpetuals, all is_active and all already listed.
    fn btc() -> Value {
        json!({
            "instrId": 28, "currency": "PERPETUAL", "newListing": false, "obDepth": 100, "base_currency": "USDT",
            "creation_timestamp": "1623168000000", "expiration_timestamp": "2114380800000", "instrument_name": "BTC-USDT-PERPETUAL",
            "show_name": "BTCUSDT", "is_active": true, "kind": "perpetual", "leverage": 200, "maker_commission": "0.0002",
            "taker_commission": "0.0006", "min_trade_amount": "0.001", "quote_currency": "BTC", "tick_size": "0.1",
            "close_only_limit_value": "0",
        })
    }

    fn shib() -> Value {
        json!({
            "instrId": 2, "currency": "PERPETUAL", "newListing": false, "obDepth": 100, "base_currency": "USDT",
            "creation_timestamp": "1629820800000", "expiration_timestamp": "2114352000000", "instrument_name": "1000SHIB-USDT-PERPETUAL",
            "show_name": "1000SHIBUSDT", "is_active": true, "kind": "perpetual", "leverage": 75, "maker_commission": "0.0002",
            "taker_commission": "0.0006", "min_trade_amount": "1", "quote_currency": "1000SHIB", "tick_size": "0.000001",
            "close_only_limit_value": "0",
        })
    }

    fn chinese() -> Value {
        json!({
            "instrId": 1110, "currency": "PERPETUAL", "newListing": false, "obDepth": 100, "base_currency": "USDT",
            "creation_timestamp": "1759982400000", "expiration_timestamp": "2114409600000", "instrument_name": "币安人生-USDT-PERPETUAL",
            "show_name": "币安人生USDT", "is_active": true, "kind": "perpetual", "leverage": 25, "maker_commission": "0.0002",
            "taker_commission": "0.0006", "min_trade_amount": "1", "quote_currency": "币安人生", "tick_size": "0.00001",
            "close_only_limit_value": "3000000",
        })
    }

    // From the bare call, which lists spot beside the perpetuals.
    fn spot() -> Value {
        json!({
            "instrId": 139, "currency": "SPOT", "newListing": false, "obDepth": 1000, "base_currency": "USDT",
            "creation_timestamp": "1619539200000", "instrument_name": "BTC-USDT-SPOT", "show_name": "BTC/USDT",
            "is_active": true, "kind": "spot", "taker_commission": "0.001", "quote_currency": "BTC",
        })
    }

    fn sandbox() -> Value {
        json!({
            "instrId": 1171, "currency": "SANDBOX", "newListing": false, "obDepth": 100, "base_currency": "USDT",
            "creation_timestamp": "1735660800000", "instrument_name": "BTC-USDT-SANDBOX", "show_name": "BTCUSDT",
            "is_active": true, "kind": "sandbox", "taker_commission": "0.0006", "quote_currency": "BTC",
        })
    }

    // No perpetual was inactive that day, so this is the BTC row with is_active false.
    fn inactive() -> Value {
        let mut row = btc();
        row["instrument_name"] = json!("OLD-USDT-PERPETUAL");
        row["quote_currency"] = json!("OLD");
        row["is_active"] = json!(false);
        row
    }

    // OURA had this shape on 2026-09-23, is_active five minutes before its listing time.
    fn unlisted() -> Value {
        let mut row = btc();
        row["instrument_name"] = json!("OURA-USDT-PERPETUAL");
        row["quote_currency"] = json!("OURA");
        row["creation_timestamp"] = json!((NOW + 300_000).to_string());
        row
    }

    fn parsed(rows: Value) -> Vec<Market> {
        let rows: Vec<Instrument> = serde_json::from_value(rows).unwrap();
        parse(&rows, NOW)
    }

    #[test]
    fn keeps_listed_perpetuals_as_linear_contracts_of_one_coin_at_the_published_taker() {
        let markets = parsed(json!([btc(), spot(), inactive(), shib(), sandbox(), unlisted(), chinese()]));

        assert_eq!(raw_ids(&markets), ["BTC-USDT-PERPETUAL", "1000SHIB-USDT-PERPETUAL", "币安人生-USDT-PERPETUAL"]);
        assert!(markets[0].linear);
        assert_eq!(markets[0].contract_size, 1.0);
        assert_eq!(markets[0].taker_ppm, 600);
        assert_eq!(markets[0].price_scale, 1.0);
    }

    #[test]
    fn reads_the_coin_from_quote_currency_and_the_quote_from_base_currency_because_the_venue_swaps_them() {
        let markets = parsed(json!([btc(), shib(), chinese()]));

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!(markets[1].base, "1000SHIB");
        assert_eq!(markets[2].base, "币安人生");
    }

    #[test]
    fn drops_a_perpetual_settled_in_a_coin_and_one_with_no_listing_time() {
        let mut coin = btc();
        coin["base_currency"] = json!("BTC");
        coin["quote_currency"] = json!("ETH");
        let mut no_time = btc();
        no_time.as_object_mut().unwrap().remove("creation_timestamp");

        assert!(parsed(json!([coin, no_time])).is_empty());
    }

    #[test]
    fn reads_the_base_code_table() {
        let mut row = btc();
        row["quote_currency"] = json!("XBT");

        assert_eq!(parsed(json!([row]))[0].base, "BTC");
    }

    fn envelope(result: Value) -> Value {
        json!({ "jsonrpc": "2.0", "usIn": 1791571655665_i64, "usOut": 1791571655671_i64, "usDiff": 6, "result": result })
    }

    // A ticker row of 2026-10-09, cut to its name and 24 h turnover.
    fn ticker(raw_market_id: &str, turnover: &str) -> Value {
        json!({ "instrument_name": raw_market_id, "mark_price": "82504.9", "stats": { "volume": "32492.485", "turnover": turnover } })
    }

    fn named(raw_market_id: &str) -> Market {
        let rows: Vec<Instrument> = serde_json::from_value(json!([btc()])).unwrap();
        let mut market = parse(&rows, NOW).remove(0);
        market.raw_market_id = raw_market_id.to_string();
        market
    }

    fn turnover(rows: &[(&str, f64)]) -> HashMap<String, f64> {
        rows.iter().map(|&(id, value)| (id.to_string(), value)).collect()
    }

    #[test]
    fn keeps_the_most_traded_markets_in_catalog_order_when_the_sockets_cannot_carry_them_all() {
        let (logs, _capture) = capture();
        let markets = vec![named("A-USDT-PERPETUAL"), named("B-USDT-PERPETUAL"), named("C-USDT-PERPETUAL"), named("D-USDT-PERPETUAL")];
        let traded = turnover(&[("A-USDT-PERPETUAL", 5.0), ("B-USDT-PERPETUAL", 90.0), ("D-USDT-PERPETUAL", 40.0)]);

        let kept = most_traded(markets, &traded, 2);

        assert_eq!(raw_ids(&kept), ["B-USDT-PERPETUAL", "D-USDT-PERPETUAL"]);
        let capped = logs.events("markets_capped");
        assert_eq!(capped[0].number("listed"), 4.0);
        assert_eq!(capped[0].number("kept"), 2.0);
        assert_eq!(capped[0].number("cutoff_turnover"), 40.0);
    }

    #[test]
    fn lets_a_denied_market_through_without_taking_a_place() {
        let markets = vec![named("ON-USDT-PERPETUAL"), named("A-USDT-PERPETUAL"), named("B-USDT-PERPETUAL")];
        let traded = turnover(&[("ON-USDT-PERPETUAL", 100.0), ("A-USDT-PERPETUAL", 5.0), ("B-USDT-PERPETUAL", 90.0)]);

        let kept = most_traded(markets, &traded, 1);

        assert_eq!(raw_ids(&kept), ["ON-USDT-PERPETUAL", "B-USDT-PERPETUAL"]);
    }

    #[test]
    fn keeps_every_market_when_the_sockets_can_carry_them() {
        let (logs, _capture) = capture();
        let markets = vec![named("A-USDT-PERPETUAL"), named("B-USDT-PERPETUAL")];

        let kept = most_traded(markets, &HashMap::new(), 2);

        assert_eq!(kept.len(), 2);
        assert!(logs.events("markets_capped").is_empty());
    }

    #[tokio::test]
    async fn loads_the_perpetuals_and_denies_the_on_token_and_simons_cat() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        let mut on = btc();
        on["instrument_name"] = json!("ON-USDT-PERPETUAL");
        on["quote_currency"] = json!("ON");
        let mut cat = btc();
        cat["instrument_name"] = json!("CAT-USDT-PERPETUAL");
        cat["quote_currency"] = json!("CAT");
        rest.reply(INSTRUMENTS_PATH, envelope(json!([btc(), on, cat])));
        rest.reply(
            TICKERS_PATH,
            envelope(json!([ticker("BTC-USDT-PERPETUAL", "2678765766.7"), ticker("ON-USDT-PERPETUAL", "51000"), ticker("CAT-USDT-PERPETUAL", "9000")])),
        );

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "orangex");
        assert_eq!(venue.name, "OrangeX");
        assert_eq!(raw_ids(&venue.markets), ["BTC-USDT-PERPETUAL"]);
        let denied: Vec<String> = logs.events("market_denied").iter().map(|event| event.text("market").to_string()).collect();
        assert_eq!(denied, ["ON-USDT-PERPETUAL", "CAT-USDT-PERPETUAL"]);
    }

    #[tokio::test]
    async fn fails_a_reply_that_carries_a_json_rpc_error() {
        let rest = MockRest::start().await;
        rest.reply(
            INSTRUMENTS_PATH,
            json!({ "jsonrpc": "2.0", "usIn": 1791571667265_i64, "usOut": 1791571667275_i64, "error": { "code": 9999, "message": "System error, please try again later", "data": {} } }),
        );
        rest.reply(TICKERS_PATH, envelope(json!([ticker("BTC-USDT-PERPETUAL", "2678765766.7")])));

        let error = load_from(&http(), &rest.url).await.unwrap_err();

        assert!(format!("{error:#}").contains("9999"));
    }
}
