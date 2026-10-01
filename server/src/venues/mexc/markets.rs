use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, contract_size, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "MEXC Global";

// API orders pay 0.08 percent since 2026-06-01, which overrides every per contract rate, see docs/profiles/mexc/fees.md section 9.
// The API rate changed twice in two months, so re-read https://www.mexc.com/announcements/api-updates before starting this venue.
// Each contract's takerFeeRate is the web and app rate, which no API order pays, so it is not compared.
const TAKER_PPM: u32 = 800;

const DETAIL_PATH: &str = "/api/v1/contract/detail";

// CCXT's mexc commonCurrencies, which keep a ticker shared by two tokens apart.
const CODES: &[(&str, &str)] = &[
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

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: DetailReply = get_json(http, &format!("{rest}{DETAIL_PATH}")).await?;
    if !reply.success || reply.code != 0 {
        anyhow::bail!("contract detail code {}: {}", reply.code, reply.message);
    }

    let markets = parse(&reply.data);
    catalog::finish(ID, NAME, reply.data.len(), markets, &[])
}

// CCXT's mexc fetchSwapMarkets for an active contract, and the registry's filter, which keeps contracts the API may trade.
// 41 of 1,184 active swaps carried apiAllowed false on 2026-09-15, mostly Innovation Zone pairs.
fn parse(contracts: &[Contract]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in contracts {
        if row.state != 0.0 || !row.api_allowed || row.symbol.is_empty() {
            continue;
        }

        let base = currency_code(&row.base_coin, CODES);
        let quote = currency_code(&row.quote_coin, CODES);
        let settle = currency_code(&row.settle_coin, CODES);
        if base.is_empty() || quote.is_empty() {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            linear: quote == settle,
            base,
            quote,
            taker_ppm: TAKER_PPM,
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
