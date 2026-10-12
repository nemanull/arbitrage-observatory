use super::{ID, REST, index_name};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, contract_size, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "Crypto.com Exchange";

// The published Level 1 derivatives taker, 0.040 %.
// CCXT's 0.005 is the spot Level 1 rate and is not used.
const TAKER_PPM: u32 = 400;

// Every instrument type in one reply, about 550 KB.
pub const INSTRUMENTS_PATH: &str = "/public/get-instruments";

// CCXT's cryptocom commonCurrencies.
const CODES: &[(&str, &str)] = &[("USD_STABLE_COIN", "USDC")];

const QUOTES: &[&str] = &["USDT", "USDC", "USD"];

// Each market whose ticker names another token than the reference venues list under it, from live_identity on 2026-10-08.
const DENIED: &[(&str, &str)] = &[(
    "EDGEUSD-PERP",
    "Definitive's EDGE, indexed to Coinbase, Kraken, Crypto.com and Gate spot at 0.117, while binance, bybit, okx and mexc list edgeX's EDGE at 0.365",
)];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Reply = get_json(http, &format!("{rest}{INSTRUMENTS_PATH}")).await?;
    if reply.code != 0 {
        anyhow::bail!("{ID} instruments call answered code {}", reply.code);
    }
    let markets = parse(&reply.result.data);
    catalog::finish(ID, NAME, reply.result.data.len(), markets, DENIED)
}

// CCXT's cryptocom fetchMarkets for an active swap, which it reads as linear and settled in its quote.
fn parse(rows: &[Instrument]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        if row.inst_type != "PERPETUAL_SWAP" || !row.tradable {
            continue;
        }

        let base = currency_code(&row.base_ccy, CODES);
        let quote = currency_code(&row.quote_ccy, CODES);
        if base.is_empty() || !QUOTES.contains(&quote.as_str()) {
            continue;
        }

        // The index channel is named from the raw id, so a market whose index lives elsewhere would never anchor.
        if row.underlying_symbol != index_name(&row.symbol) {
            tracing::warn!(
                event = "market_skipped",
                venue = ID,
                market = %row.symbol,
                underlying_symbol = %row.underlying_symbol,
                reason = "underlying_symbol is not the raw id with -INDEX for -PERP",
            );
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: contract_size(row.contract_size), // "1" on every perpetual, and the book sizes are base coins
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct Reply {
    #[serde(default)]
    code: i64,
    #[serde(default)]
    result: ReplyResult,
}

#[derive(Deserialize, Default)]
struct ReplyResult {
    #[serde(default)]
    data: Vec<Instrument>,
}

#[derive(Deserialize)]
struct Instrument {
    #[serde(default)]
    symbol: String, // "BTCUSD-PERP", the socket's id
    #[serde(default)]
    inst_type: String, // "PERPETUAL_SWAP", "CCY_PAIR" or "FUTURE"
    #[serde(default)]
    base_ccy: String,
    #[serde(default)]
    quote_ccy: String, // "USD" on every perpetual
    #[serde(default)]
    tradable: bool, // the only status field
    #[serde(default)]
    underlying_symbol: String, // "BTCUSD-INDEX", absent on spot
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    contract_size: f64,
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows captured live from get-instruments on 2026-10-08, cut to the fields the loader reads plus a few it ignores.
    fn btc_perp() -> Value {
        json!({
            "symbol": "BTCUSD-PERP", "inst_type": "PERPETUAL_SWAP", "display_name": "BTCUSD Perpetual", "base_ccy": "BTC",
            "quote_ccy": "USD", "price_tick_size": "0.1", "qty_tick_size": "0.0001", "max_leverage": "100", "tradable": true,
            "expiry_timestamp_ms": 0, "underlying_symbol": "BTCUSD-INDEX", "contract_size": "1", "product_type": "DIGITAL_CURRENCIES",
        })
    }

    fn nvda_perp() -> Value {
        json!({
            "symbol": "NVDAUSD-PERP", "inst_type": "PERPETUAL_SWAP", "base_ccy": "NVDA", "quote_ccy": "USD", "tradable": true,
            "underlying_symbol": "NVDAUSD-INDEX", "contract_size": "1", "product_type": "EQUITY",
        })
    }

    fn anthropic_pre_ipo() -> Value {
        json!({
            "symbol": "ANTHROPICIPOUSD-PERP", "inst_type": "PERPETUAL_SWAP", "base_ccy": "ANTHROPICIPO", "quote_ccy": "USD",
            "tradable": true, "underlying_symbol": "ANTHROPICIPOUSD-INDEX", "contract_size": "1", "product_type": "PRE_IPO",
        })
    }

    fn iwm_equity_index() -> Value {
        json!({
            "symbol": "IWMUSD-PERP", "inst_type": "PERPETUAL_SWAP", "base_ccy": "IWM", "quote_ccy": "USD", "tradable": true,
            "underlying_symbol": "IWMUSD-INDEX", "contract_size": "1", "product_type": "EQUITY_IND",
        })
    }

    fn xau_commodity() -> Value {
        json!({
            "symbol": "XAUUSD-PERP", "inst_type": "PERPETUAL_SWAP", "base_ccy": "XAU", "quote_ccy": "USD", "tradable": true,
            "underlying_symbol": "XAUUSD-INDEX", "contract_size": "1", "product_type": "COMMODITIES",
        })
    }

    fn btc_spot() -> Value {
        json!({
            "symbol": "BTC_USD", "inst_type": "CCY_PAIR", "base_ccy": "BTC", "quote_ccy": "USD", "tradable": true,
            "product_type": "DIGITAL_CURRENCIES",
        })
    }

    fn btc_dated_future() -> Value {
        json!({
            "symbol": "BTCUSD-261030", "inst_type": "FUTURE", "base_ccy": "BTC", "quote_ccy": "USD", "tradable": true,
            "expiry_timestamp_ms": 1793347200000_i64, "underlying_symbol": "BTCUSD-INDEX", "contract_size": "1",
        })
    }

    // Every perpetual read tradable on 2026-10-08, so this row is the ETH capture with tradable false.
    fn halted_perp() -> Value {
        json!({
            "symbol": "ETHUSD-PERP", "inst_type": "PERPETUAL_SWAP", "base_ccy": "ETH", "quote_ccy": "USD", "tradable": false,
            "underlying_symbol": "ETHUSD-INDEX", "contract_size": "1",
        })
    }

    fn parsed(rows: Value) -> Vec<Market> {
        let rows: Vec<Instrument> = serde_json::from_value(rows).unwrap();
        parse(&rows)
    }

    fn reply(rows: Value) -> Value {
        json!({ "id": 1, "method": "public/get-instruments", "code": 0, "result": { "data": rows } })
    }

    #[test]
    fn keeps_tradable_perpetuals_of_every_product_type_as_linear_usd_contracts_of_one_coin() {
        let markets = parsed(json!([
            btc_perp(),
            nvda_perp(),
            iwm_equity_index(),
            xau_commodity(),
            anthropic_pre_ipo(),
            btc_spot(),
            btc_dated_future(),
            halted_perp(),
        ]));

        assert_eq!(raw_ids(&markets), ["BTCUSD-PERP", "NVDAUSD-PERP", "IWMUSD-PERP", "XAUUSD-PERP", "ANTHROPICIPOUSD-PERP"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USD"));
        assert_eq!(markets[1].base, "NVDA");
        assert_eq!(markets[4].base, "ANTHROPICIPO");
        assert!(markets.iter().all(|m| m.linear && m.contract_size == 1.0 && m.price_scale == 1.0));
        assert!(markets.iter().all(|m| m.taker_ppm == 400));
    }

    #[test]
    fn drops_a_perpetual_quoted_in_a_coin() {
        let mut row = btc_perp();
        row["symbol"] = json!("ETHBTC-PERP");
        row["base_ccy"] = json!("ETH");
        row["quote_ccy"] = json!("BTC");
        row["underlying_symbol"] = json!("ETHBTC-INDEX");

        assert!(parsed(json!([row])).is_empty());
    }

    #[test]
    fn maps_the_stable_coin_code_through_the_cryptocom_table() {
        let mut row = btc_perp();
        row["symbol"] = json!("BTCUSD_STABLE_COIN-PERP");
        row["quote_ccy"] = json!("USD_STABLE_COIN");
        row["underlying_symbol"] = json!("BTCUSD_STABLE_COIN-INDEX");

        assert_eq!(parsed(json!([row]))[0].quote, "USDC");
    }

    #[test]
    fn skips_with_a_warning_a_perpetual_whose_index_is_not_named_after_it() {
        let (logs, _capture) = capture();
        let mut row = btc_perp();
        row["underlying_symbol"] = json!("XBTUSD-INDEX");

        assert!(parsed(json!([row, nvda_perp()])).len() == 1);
        let skipped = logs.events("market_skipped");
        assert_eq!(skipped.len(), 1);
        assert_eq!(skipped[0].text("market"), "BTCUSD-PERP");
    }

    #[tokio::test]
    async fn loads_the_perpetuals_and_counts_every_row() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, reply(json!([btc_perp(), btc_spot(), btc_dated_future()])));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "cryptocom");
        assert_eq!(venue.name, "Crypto.com Exchange");
        assert_eq!(raw_ids(&venue.markets), ["BTCUSD-PERP"]);
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 3.0);
    }

    #[tokio::test]
    async fn denies_definitive_edge_which_the_reference_venues_list_as_edgex() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        let mut edge = btc_perp();
        edge["symbol"] = json!("EDGEUSD-PERP");
        edge["base_ccy"] = json!("EDGE");
        edge["underlying_symbol"] = json!("EDGEUSD-INDEX");
        rest.reply(INSTRUMENTS_PATH, reply(json!([btc_perp(), edge])));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(raw_ids(&venue.markets), ["BTCUSD-PERP"]);
        assert_eq!(logs.events("market_denied")[0].text("market"), "EDGEUSD-PERP");
    }

    #[tokio::test]
    async fn fails_on_an_error_code() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, json!({ "id": 1, "method": "public/get-instruments", "code": 10001, "result": {} }));

        assert!(load_from(&http(), &rest.url).await.is_err());
    }
}
