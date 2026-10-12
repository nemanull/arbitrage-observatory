use super::{MEXC, Profile};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, contract_size, currency_code};
use crate::venues::wire;
use serde::Deserialize;

pub(super) const DETAIL_PATH: &str = "/api/v1/contract/detail";

const STABLE_QUOTES: &[&str] = &["USDT", "USDC", "USD"];

// CCXT's mexc commonCurrencies, which keep a ticker shared by two tokens apart.
pub(super) const MEXC_CODES: &[(&str, &str)] = &[
    ("BEYONDPROTOCOL", "BEYOND"),
    ("BIFI", "BIFIF"),
    ("BYN", "BEYONDFI"),
    ("COFI", "COFIX"),
    ("DFI", "DFISTARTER"),
    ("DFT", "DFUTURE"),
    ("DRK", "DRK"),
    ("EGC", "EGORASCREDIT"),
    ("FLUX1", "FLUX"),
    ("FLUX", "FLUX1"),
    ("FREE", "FREEROSSDAO"),
    ("GAS", "GASDAO"),
    ("GASNEO", "GAS"),
    ("GMT", "GMTTOKEN"),
    ("STEPN", "GMT"),
    ("HERO", "STEPHERO"),
    ("MIMO", "MIMOSA"),
    ("PROS", "PROSFINANCE"),
    ("SIN", "SINCITYTOKEN"),
    ("SOUL", "SOULSWAP"),
    ("XBT", "XBT"),
];

// From live_identity on 2026-10-09.
// Bybit and okx list ON as the ON Semiconductor stock near 80 USDT, while Ourbit's ON_USDT is the ON token at 0.116, as binance denies its ONUSDT.
// Ourbit's CAT_USDT is the Simon's Cat token at 0.000002, while binance and gate list the Caterpillar stock as CAT near 803.
// Ourbit's USO_USDT is WTI crude oil at 91, named "WTI(USOIL)" in its catalog, while okx and mexc list the United States Oil Fund ETF as USO near 146.6.
pub(super) const OURBIT_DENIED: &[(&str, &str)] = &[
    ("ON_USDT", "a different token from the ON that okx and bybit list"),
    ("CAT_USDT", "the Simon's Cat token, while binance and gate list the Caterpillar stock as CAT"),
    ("USO_USDT", "WTI crude oil, while okx and mexc list the United States Oil Fund ETF as USO"),
];

pub(super) const BYDFI_DENIED: &[(&str, &str)] = &[];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_profile(&MEXC, http).await
}

pub async fn load_profile(profile: &'static Profile, http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_profile_from(profile, http, profile.rest).await
}

#[cfg(test)]
async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    load_profile_from(&MEXC, http, rest).await
}

async fn load_profile_from(profile: &Profile, http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: DetailReply = get_json(http, &format!("{rest}{DETAIL_PATH}")).await?;
    if !reply.success || reply.code != 0 {
        anyhow::bail!("contract detail code {}: {}", reply.code, reply.message);
    }

    let markets = parse_profile(profile, &reply.data);
    catalog::finish(profile.id, profile.name, reply.data.len(), markets, profile.denied)
}

#[cfg(test)]
fn parse(contracts: &[Contract]) -> Vec<Market> {
    parse_profile(&MEXC, contracts)
}

// CCXT's mexc fetchSwapMarkets for an active contract, and the registry's filter, which keeps contracts the API may trade.
// 41 of 1,184 active MEXC swaps carried apiAllowed false on 2026-09-15, mostly Innovation Zone pairs.
// Ourbit and BYDFi run the same catalog, and on 2026-10-09 every one of their contracts was in state 0 with apiAllowed true.
fn parse_profile(profile: &Profile, contracts: &[Contract]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in contracts {
        if row.state != 0.0 || !row.api_allowed || row.symbol.is_empty() {
            continue;
        }

        let base = currency_code(&row.base_coin, profile.codes);
        let quote = currency_code(&row.quote_coin, profile.codes);
        let settle = currency_code(&row.settle_coin, profile.codes);
        if base.is_empty() || quote.is_empty() {
            continue;
        }
        let linear = quote == settle;
        // BYDFi's coin margined contracts quote USD and settle in the coin.
        if profile.stable_linear_only && !(linear && STABLE_QUOTES.contains(&quote.as_str())) {
            continue;
        }

        markets.push(Market {
            venue_id: profile.id.to_string(),
            raw_market_id: row.symbol.clone(),
            linear,
            base,
            quote,
            taker_ppm: profile.taker_ppm,
            contract_size: contract_size(row.contract_size),
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct DetailReply {
    #[serde(default)]
    success: bool,
    #[serde(default)]
    code: i64,
    #[serde(default)]
    message: String,
    #[serde(default)]
    data: Vec<Contract>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Contract {
    #[serde(default)]
    symbol: String, // "BTC_USDT"
    #[serde(default)]
    base_coin: String,
    #[serde(default)]
    quote_coin: String,
    #[serde(default)]
    settle_coin: String,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    contract_size: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    state: f64, // 0 is enabled
    #[serde(default)]
    api_allowed: bool,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    fn contract(symbol: &str, base: &str, quote: &str, settle: &str, size: f64, state: i64, api: bool) -> Value {
        json!({
            "symbol": symbol, "baseCoin": base, "quoteCoin": quote, "settleCoin": settle, "contractSize": size,
            "state": state, "apiAllowed": api, "takerFeeRate": 0.0002, "futureType": 1,
        })
    }

    fn detail() -> Value {
        json!({ "success": true, "code": 0, "data": [
            contract("BTC_USDT", "BTC", "USDT", "USDT", 0.0001, 0, true),
            contract("BTC_USD", "BTC", "USD", "BTC", 100.0, 0, true),
            contract("GMT_USDT", "GMT", "USDT", "USDT", 1.0, 0, true),
            contract("ZONE_USDT", "ZONE", "USDT", "USDT", 1.0, 0, false),
            contract("PAUSED_USDT", "PAUSED", "USDT", "USDT", 1.0, 1, true),
        ]})
    }

    fn parsed() -> Vec<Market> {
        let reply: DetailReply = serde_json::from_value(detail()).unwrap();
        parse(&reply.data)
    }

    #[test]
    fn keeps_enabled_contracts_the_api_may_trade() {
        let markets = parsed();

        assert_eq!(raw_ids(&markets), ["BTC_USDT", "BTC_USD", "GMT_USDT"]);
        assert_eq!(markets[0].contract_size, 0.0001);
        assert_eq!(markets[0].taker_ppm, 800);
        assert!(markets[0].linear);
    }

    #[test]
    fn reads_a_coin_settled_contract_as_inverse() {
        let markets = parsed();

        assert!(!markets[1].linear);
        assert_eq!(markets[1].quote, "USD");
        assert_eq!(markets[1].contract_size, 100.0);
    }

    #[test]
    fn maps_codes_through_the_mexc_table() {
        assert_eq!(parsed()[2].base, "GMTTOKEN");
    }

    #[tokio::test]
    async fn loads_the_catalog_and_fails_on_a_venue_error() {
        let rest = MockRest::start().await;
        rest.reply(DETAIL_PATH, detail());
        assert_eq!(load_from(&http(), &rest.url).await.unwrap().markets.len(), 3);

        let failing = MockRest::start().await;
        failing.reply(DETAIL_PATH, json!({ "success": false, "code": 510, "message": "Requests are too frequent" }));
        let error = load_from(&http(), &failing.url).await.unwrap_err();
        assert!(error.to_string().contains("code 510"), "{error:#}");
    }
}

#[cfg(test)]
mod clone_tests {
    use super::super::{BYDFI, OURBIT};
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from each clone's /api/v1/contract/detail of 2026-10-09, where every contract was in state 0 with apiAllowed true.
    // PAUSED_USDT and BYDFi's ETH_USDT are captured rows with their state set to 1, the documented code for a delivering contract.
    // ZONE_USDT is one with apiAllowed set to false.
    fn row(symbol: &str, base: &str, quote: &str, settle: &str, size: f64, state: i64, taker: f64) -> Value {
        json!({
            "symbol": symbol, "baseCoin": base, "quoteCoin": quote, "settleCoin": settle, "contractSize": size,
            "state": state, "apiAllowed": true, "futureType": 1, "takerFeeRate": taker,
        })
    }

    fn api_closed(mut row: Value) -> Value {
        row["apiAllowed"] = json!(false);
        row
    }

    fn ourbit_detail() -> Value {
        json!({ "success": true, "code": 0, "data": [
            row("BTC_USDT", "BTC", "USDT", "USDT", 0.0001, 0, 0.0004),
            row("GMT_USDT", "GMT", "USDT", "USDT", 1.0, 0, 0.0004),
            row("ON_USDT", "ON", "USDT", "USDT", 10.0, 0, 0.0004),
            row("AMD_USDT", "AMD", "USDT", "USDT", 0.01, 0, 0.0004),
            row("CAT_USDT", "CAT", "USDT", "USDT", 10000.0, 0, 0.0004),
            row("USO_USDT", "USO", "USDT", "USDT", 1.0, 0, 0.0004),
            row("PAUSED_USDT", "PAUSED", "USDT", "USDT", 1.0, 1, 0.0004),
            api_closed(row("ZONE_USDT", "ZONE", "USDT", "USDT", 1.0, 0, 0.0004)),
        ]})
    }

    fn bydfi_detail() -> Value {
        json!({ "success": true, "code": 0, "data": [
            row("BTC_USDT", "BTC", "USDT", "USDT", 0.0001, 0, 0.0006),
            row("BTC_USDC", "BTC", "USDC", "USDC", 0.0001, 0, 0.0006),
            row("BTC_USD", "BTC", "USD", "BTC", 1.0, 0, 0.0006),
            row("1000PEPE_USDT", "1000PEPE", "USDT", "USDT", 1.0, 0, 0.0006),
            row("ETH_USDT", "ETH", "USDT", "USDT", 0.01, 1, 0.0006),
        ]})
    }

    async fn load(profile: &'static Profile, detail: Value) -> Venue {
        let rest = MockRest::start().await;
        rest.reply(DETAIL_PATH, detail);
        load_profile_from(profile, &http(), &rest.url).await.unwrap()
    }

    #[tokio::test]
    async fn keeps_ourbits_enabled_contracts_at_its_own_taker_and_contract_size() {
        let venue = load(&OURBIT, ourbit_detail()).await;

        assert_eq!((venue.id.as_str(), venue.name.as_str()), ("ourbit", "Ourbit"));
        assert_eq!(raw_ids(&venue.markets), ["BTC_USDT", "GMT_USDT", "AMD_USDT"]);
        assert!(venue.markets.iter().all(|m| m.venue_id == "ourbit" && m.taker_ppm == 400 && m.linear));
        assert_eq!(venue.markets[0].contract_size, 0.0001);
        assert_eq!(venue.markets[2].contract_size, 0.01);
    }

    // CCXT's mexc table renames GMT to GMTTOKEN, while Ourbit's GMT_USDT is indexed on binance's, bybit's and okx's GMT.
    #[tokio::test]
    async fn keeps_ourbits_codes_out_of_the_mexc_table() {
        let venue = load(&OURBIT, ourbit_detail()).await;

        assert_eq!(venue.markets[1].base, "GMT");
    }

    #[tokio::test]
    async fn denies_ourbits_markets_that_name_another_instrument_than_the_references() {
        let (logs, _capture) = capture();

        load(&OURBIT, ourbit_detail()).await;

        let denied = logs.events("market_denied");
        let markets: Vec<&str> = denied.iter().map(|event| event.text("market")).collect();
        assert_eq!(markets, ["ON_USDT", "CAT_USDT", "USO_USDT"]);
    }

    #[tokio::test]
    async fn drops_bydfis_coin_margined_contracts_and_keeps_usdt_and_usdc() {
        let venue = load(&BYDFI, bydfi_detail()).await;

        assert_eq!((venue.id.as_str(), venue.name.as_str()), ("bydfi", "BYDFi"));
        assert_eq!(raw_ids(&venue.markets), ["BTC_USDT", "BTC_USDC", "1000PEPE_USDT"]);
        assert_eq!(venue.markets[1].quote, "USDC");
        assert!(venue.markets.iter().all(|m| m.taker_ppm == 600 && m.linear));
        assert_eq!(venue.markets[2].base, "1000PEPE");
        assert_eq!(venue.markets[2].contract_size, 1.0);
    }

    #[test]
    fn drops_a_linear_contract_quoted_in_a_coin() {
        let contracts: Vec<Contract> = serde_json::from_value(json!([row("ETH_BTC", "ETH", "BTC", "BTC", 0.01, 0, 0.0006)])).unwrap();

        assert!(parse_profile(&BYDFI, &contracts).is_empty());
        assert_eq!(parse_profile(&MEXC, &contracts).len(), 1);
    }

    #[tokio::test]
    async fn fails_a_clone_load_on_a_venue_error() {
        let rest = MockRest::start().await;
        rest.reply(DETAIL_PATH, json!({ "success": false, "code": 600, "message": "Param error!" }));

        let error = load_profile_from(&BYDFI, &http(), &rest.url).await.unwrap_err();

        assert!(error.to_string().contains("code 600: Param error!"), "{error:#}");
    }
}
