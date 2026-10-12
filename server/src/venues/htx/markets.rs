use super::anchor::get_data;
use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "HTX";

// The USDT-M Prime 0 taker of docs/profiles/htx/fees.md section 2, where CCXT's constant 0.0005 is the coin-M rate.
const TAKER_PPM: u32 = 600;

// Only USDT-M perpetuals, since the coin-M ones sit on another call and another socket, and business_type=swap leaves out the dated futures.
// It counts against the 240 per 3 s budget of the index and funding calls, as its rate limit headers show.
pub const CONTRACTS_PATH: &str = "/linear-swap-api/v1/swap_contract_info?business_type=swap";

// CCXT 4.5.68's htx commonCurrencies, which keep a ticker shared by two tokens apart.
const CODES: &[(&str, &str)] = &[
    ("NGL", "GFNGL"),
    ("GET", "THEMIS"),
    ("GTC", "GAMECOM"),
    ("HIT", "HITCHAIN"),
    ("PNT", "PENTA"),
    ("SBTC", "SUPERBITCOIN"),
    ("SOUL", "SOULSAVER"),
    ("BIFI", "BITCOINFILE"),
    ("FUD", "FTX Users Debt"),
];

const QUOTES: &[&str] = &["USDT", "USDC", "USD"];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let contracts: Vec<Contract> = get_data(http, &format!("{rest}{CONTRACTS_PATH}")).await?;
    let markets = parse(&contracts);
    catalog::finish(ID, NAME, contracts.len(), markets, &[])
}

// CCXT's htx fetchMarketsByTypeAndSubType for an active linear swap, TradFi contracts included as decision 4 keeps them.
// Base is the row's symbol and quote the second part of the code, and book sizes count contracts of contract_size coins.
fn parse(contracts: &[Contract]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in contracts {
        let swap = row.delivery_date.is_empty();
        let linear = !row.business_type.is_empty();
        if row.contract_status != 1 || !swap || !linear {
            continue;
        }

        let Some(quote_id) = row.contract_code.split('-').nth(1) else {
            continue;
        };
        let base = currency_code(&row.symbol, CODES);
        let quote = currency_code(quote_id, CODES);
        if base.is_empty() || !QUOTES.contains(&quote.as_str()) {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.contract_code.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: catalog::contract_size(row.contract_size),
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
pub struct Contract {
    #[serde(default)]
    pub contract_code: String, // "BTC-USDT", the socket's and the anchor calls' id
    #[serde(default)]
    symbol: String, // "BTC"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    contract_size: f64, // coins per contract, 0.001 on BTC
    #[serde(default)]
    contract_status: i64, // 1 listing, 3 suspended, and 0 to 9 in all
    #[serde(default)]
    delivery_date: String, // "" on a perpetual
    #[serde(default)]
    business_type: String, // "swap" on USDT-M, absent on the coin-M call
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    pub settlement_period: f64, // the funding interval in hours, "8", "4" or "1"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows trimmed from the swap_contract_info reply captured live on 2026-10-08, cut to the fields the loader reads and a few it ignores.
    fn contract(code: &str, size: f64, status: i64, tradfi: &[&str]) -> Value {
        let symbol = code.split('-').next().unwrap();
        json!({
            "symbol": symbol, "contract_code": code, "contract_size": size, "price_tick": 0.1, "delivery_date": "",
            "delivery_time": "", "create_date": "20201021", "contract_status": status, "settlement_date": "1791532800000",
            "support_margin_mode": "all", "settlement_period": "8", "tradfi_labels": tradfi, "business_type": "swap",
            "pair": code, "contract_type": "swap", "trade_partition": "USDT",
        })
    }

    fn reply() -> Value {
        json!({ "status": "ok", "ts": 1791523588684_i64, "data": [
            contract("BTC-USDT", 0.001, 1, &[]),
            contract("DOGE-USDT", 100.0, 1, &[]),
            contract("NVDA-USDT", 0.01, 1, &["Stocks"]),
            contract("XAU-USDT", 0.001, 1, &["Metals"]),
            contract("龙虾-USDT", 100.0, 1, &[]),
            contract("GTC-USDT", 1.0, 1, &[]),
            contract("CYBER-USDT", 0.1, 3, &[]),
            // A dated future, which the business_type=all reply holds, and a coin-M row, which has no business_type.
            {
                "symbol": "BTC", "contract_code": "BTC-USDT-261009", "contract_size": 0.001, "delivery_date": "20261009",
                "contract_status": 1, "business_type": "futures", "pair": "BTC-USDT", "contract_type": "this_week",
            },
            { "symbol": "BTC", "contract_code": "BTC-USD", "contract_size": 100, "delivery_date": "", "contract_status": 1 },
        ]})
    }

    fn parsed() -> Vec<Market> {
        let contracts: Vec<Contract> = serde_json::from_value(reply()["data"].clone()).unwrap();
        parse(&contracts)
    }

    #[test]
    fn keeps_listed_linear_perpetuals_with_tradfi_and_drops_suspended_dated_and_coin_margined_rows() {
        assert_eq!(
            raw_ids(&parsed()),
            ["BTC-USDT", "DOGE-USDT", "NVDA-USDT", "XAU-USDT", "龙虾-USDT", "GTC-USDT"]
        );
    }

    #[test]
    fn reads_base_from_the_symbol_and_quote_from_the_code_with_the_contract_size_in_coins() {
        let markets = parsed();

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!(markets[0].contract_size, 0.001);
        assert_eq!(markets[1].contract_size, 100.0);
        assert_eq!(markets[2].base, "NVDA");
        assert_eq!(markets[4].base, "龙虾");
        assert!(markets.iter().all(|m| m.linear && m.taker_ppm == 600 && m.price_scale == 1.0));
    }

    #[test]
    fn maps_codes_through_the_htx_table() {
        assert_eq!(parsed()[5].base, "GAMECOM");
    }

    // HTX lists only USDT today, so these two rows are made up to pin decision 3's quotes.
    #[test]
    fn drops_a_contract_quoted_in_another_currency_or_with_no_quote_in_its_code() {
        let rows = json!([contract("BTC-EUR", 0.001, 1, &[]), contract("BTC", 0.001, 1, &[]), contract("BTC-USDC", 0.001, 1, &[])]);
        let contracts: Vec<Contract> = serde_json::from_value(rows).unwrap();

        assert_eq!(raw_ids(&parse(&contracts)), ["BTC-USDC"]);
    }

    #[tokio::test]
    async fn loads_the_catalog_and_fails_on_a_venue_error() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, reply());
        let venue = load_from(&http(), &rest.url).await.unwrap();
        assert_eq!((venue.id.as_str(), venue.name.as_str()), ("htx", "HTX"));
        assert_eq!(venue.markets.len(), 6);
        let read = logs.events("catalog_read");
        assert_eq!(read[0].number("rows"), 9.0);
        assert_eq!(read[0].number("kept"), 6.0);

        let failing = MockRest::start().await;
        failing.reply(CONTRACTS_PATH, json!({ "status": "error", "err_code": 1014, "err_msg": "This contract doesnt exist.", "ts": 1 }));
        let error = load_from(&http(), &failing.url).await.unwrap_err();
        assert!(error.to_string().contains("1014: This contract doesnt exist."), "{error:#}");
    }
}
