use super::anchor::Reply;
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "Bitget";
const TAKER_PPM: u32 = 600;

const CONTRACTS_PATH: &str = "/api/v2/mix/market/contracts?productType=";

// CCXT loaded six product types, and the registry kept linear contracts that settle in USDT or USDC, which are these two.
const PRODUCT_TYPES: &[&str] = &["USDT-FUTURES", "USDC-FUTURES"];

const CODES: &[(&str, &str)] = &[
    ("APX", "AstroPepeX"),
    ("DEGEN", "DegenReborn"),
    ("EVA", "Evadore"),
    ("JADE", "Jade Protocol"),
    ("OMNI", "omni"),
    ("TONCOIN", "TON"),
];

const FEE_SAMPLE: usize = 3;

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let usdt_url = format!("{rest}{CONTRACTS_PATH}{}", PRODUCT_TYPES[0]);
    let usdc_url = format!("{rest}{CONTRACTS_PATH}{}", PRODUCT_TYPES[1]);
    let (usdt, usdc) = tokio::try_join!(
        get_json::<Reply<Contract>>(http, &usdt_url),
        get_json::<Reply<Contract>>(http, &usdc_url),
    )?;

    let mut contracts = Vec::with_capacity(usdt.data.len() + usdc.data.len());
    for reply in [usdt, usdc] {
        if reply.code != "00000" {
            anyhow::bail!("contracts code {}: {}", reply.code, reply.msg);
        }
        contracts.extend(reply.data);
    }

    let markets = parse(&contracts);
    warn_fee_mismatch(&contracts, &markets);
    catalog::finish(ID, NAME, contracts.len(), markets, &[])
}

// CCXT's bitget market parse for an active perpetual, kept when it is linear and settles in USDT or USDC.
fn parse(contracts: &[Contract]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in contracts {
        let status = row.status.as_deref().or(row.symbol_status.as_deref());
        let active = matches!(status, Some("online" | "normal"));
        if row.symbol_type != "perpetual" || !active || row.symbol.is_empty() {
            continue;
        }

        // The settle coin is the base when the contract margins in it, else the quote, else the first coin listed.
        let settle_id = if row.support_margin_coins.contains(&row.base_coin) {
            row.base_coin.as_str()
        } else if row.support_margin_coins.contains(&row.quote_coin) {
            row.quote_coin.as_str()
        } else {
            row.support_margin_coins.first().map_or("", String::as_str)
        };

        let base = currency_code(&row.base_coin, CODES);
        let quote = currency_code(&row.quote_coin, CODES);
        let settle = currency_code(settle_id, CODES);
        let linear = base != settle;
        if base.is_empty() || quote.is_empty() || !linear || !(settle == "USDT" || settle == "USDC") {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear,
            contract_size: 1.0,
            price_scale: 1.0,
        });
    }

    markets
}

// The reply carries each contract's taker rate, so the day bitget changes one the boot log says so.
fn warn_fee_mismatch(contracts: &[Contract], markets: &[Market]) {
    let mut reported = Vec::new();
    let mut mismatched = Vec::new();
    for market in markets {
        let Some(row) = contracts.iter().find(|row| row.symbol == market.raw_market_id) else {
            continue;
        };
        let ppm = (row.taker_fee_rate * 1_000_000.0).round();
        if ppm.is_finite() && ppm != f64::from(TAKER_PPM) {
            mismatched.push(market.raw_market_id.as_str());
            if !reported.contains(&ppm) {
                reported.push(ppm);
            }
        }
    }

    if mismatched.is_empty() {
        return;
    }

    tracing::warn!(
        event = "taker_fee_mismatch",
        venue = ID,
        expected_ppm = TAKER_PPM,
        reported_ppm = ?reported,
        markets = mismatched.len(),
        sample = ?&mismatched[..mismatched.len().min(FEE_SAMPLE)],
    );
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Contract {
    #[serde(default)]
    symbol: String, // "BTCUSDT", or "BTCPERP" on USDC-M
    #[serde(default)]
    base_coin: String,
    #[serde(default)]
    quote_coin: String,
    #[serde(default)]
    support_margin_coins: Vec<String>,
    #[serde(default)]
    symbol_type: String, // "perpetual" or "delivery"
    status: Option<String>,
    symbol_status: Option<String>, // "normal", "listed", "maintain", "limit_open", "restrictedAPI", "off"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    taker_fee_rate: f64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    fn contract(symbol: &str, base: &str, quote: &str, margin: &str, kind: &str, status: &str, taker: &str) -> Value {
        json!({
            "symbol": symbol, "baseCoin": base, "quoteCoin": quote, "supportMarginCoins": [margin],
            "symbolType": kind, "symbolStatus": status, "takerFeeRate": taker, "makerFeeRate": "0.0002",
        })
    }

    fn usdt() -> Value {
        json!({ "code": "00000", "msg": "success", "requestTime": 1, "data": [
            contract("BTCUSDT", "BTC", "USDT", "USDT", "perpetual", "normal", "0.0006"),
            contract("TONCOINUSDT", "TONCOIN", "USDT", "USDT", "perpetual", "normal", "0.0006"),
            contract("OLDUSDT", "OLD", "USDT", "USDT", "perpetual", "off", "0.0006"),
            contract("BTCUSDT_261225", "BTC", "USDT", "USDT", "delivery", "normal", "0.0006"),
        ]})
    }

    fn usdc() -> Value {
        json!({ "code": "00000", "msg": "success", "requestTime": 1, "data": [
            contract("BTCPERP", "BTC", "USDC", "USDC", "perpetual", "normal", "0.0006"),
            contract("ETHPERP", "ETH", "USDC", "USDC", "perpetual", "normal", "0.0004"),
        ]})
    }

    fn parsed(reply: Value) -> Vec<Market> {
        let reply: Reply<Contract> = serde_json::from_value(reply).unwrap();
        parse(&reply.data)
    }

    #[test]
    fn keeps_active_linear_perpetuals_settled_in_their_quote() {
        let markets = parsed(usdt());

        assert_eq!(raw_ids(&markets), ["BTCUSDT", "TONCOINUSDT"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert!(markets[0].linear);
        assert_eq!(markets[0].contract_size, 1.0);
        assert_eq!(markets[0].taker_ppm, 600);
        assert_eq!(markets[1].base, "TON");
    }

    #[test]
    fn leaves_out_a_coin_margined_contract() {
        let markets = parsed(json!({ "code": "00000", "msg": "", "data": [
            contract("BTCUSD", "BTC", "USD", "BTC", "perpetual", "normal", "0.0006"),
        ]}));

        assert!(markets.is_empty());
    }

    #[tokio::test]
    async fn loads_both_product_types_and_warns_on_a_contract_whose_taker_rate_differs() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply("/api/v2/mix/market/contracts?productType=USDT-FUTURES", usdt());
        rest.reply("/api/v2/mix/market/contracts?productType=USDC-FUTURES", usdc());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(raw_ids(&venue.markets), ["BTCUSDT", "TONCOINUSDT", "BTCPERP", "ETHPERP"]);
        let warnings = logs.events("taker_fee_mismatch");
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].number("markets"), 1.0);
        assert_eq!(warnings[0].text("reported_ppm"), "[400.0]");
    }

    #[tokio::test]
    async fn fails_on_a_venue_error_code() {
        let rest = MockRest::start().await;
        rest.reply("/api/v2/mix/market/contracts?productType=USDT-FUTURES", usdt());
        rest.reply(
            "/api/v2/mix/market/contracts?productType=USDC-FUTURES",
            json!({ "code": "40019", "msg": "Parameter productType cannot be empty", "data": [] }),
        );

        let error = load_from(&http(), &rest.url).await.unwrap_err();

        assert!(error.to_string().contains("contracts code 40019"), "{error:#}");
    }
}
