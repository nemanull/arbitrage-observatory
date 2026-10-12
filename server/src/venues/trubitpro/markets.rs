use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;

// Every contract with its symbol, tick, lot and type, documented at one call a second per IP.
pub const REF_DATA_PATH: &str = "/market/api/v1/basic/refData";

const NAME: &str = "TruBit Pro Exchange";

// The VIP 0 taker of the fee chart's worked example, 0.06 %, while the perpetual overview says 0.04 %.
const TAKER_PPM: u32 = 600;

// CCXT 4.5.68 has no TruBit class, so only the base table applies.
const CODES: &[(&str, &str)] = &[];

// Each entry names the token the ticker collides with.
const DENIED: &[(&str, &str)] = &[(
    "TBTCTUSDT",
    "a second bitcoin contract, quoted in whole dollars on BTCUSDT's index, and not Threshold's tBTC",
)];

const QUOTES: [&str; 3] = ["USDT", "USDC", "USD"]; // USDT before USD, so the longer suffix wins

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let rows = ref_data(http, rest).await?;
    let markets = parse(&rows);
    catalog::finish(ID, NAME, rows.len(), markets, DENIED)
}

// Errors arrive as HTTP 200 with a code other than 0, so the anchor's pruning of a delisted symbol reads the catalog through here too.
pub async fn ref_data(http: &reqwest::Client, rest: &str) -> anyhow::Result<Vec<Contract>> {
    let reply: Reply = get_json(http, &format!("{rest}{REF_DATA_PATH}")).await?;
    if reply.code != 0 {
        anyhow::bail!("{ID} refData answered code {}: {}", reply.code, reply.message);
    }
    Ok(reply.result.unwrap_or_default())
}

// A row has no status, no base, no quote and no contract size, so a listed PERP row is trading, and base and quote come from the symbol.
// Book sizes are USDT notional, which the feed divides by each level's price, so a market's size unit is one coin.
fn parse(rows: &[Contract]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        if row.kind != "PERP" {
            continue;
        }
        let Some((base, quote)) = split(&row.symbol) else {
            continue;
        };

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base: currency_code(base, CODES),
            quote: quote.to_string(),
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0,
            price_scale: 1.0, // 1000PEPEUSDT keeps base 1000PEPE, as binance, bybit and bitunix name it
        });
    }

    markets
}

// "BTCUSDT" splits into "BTC" and "USDT".
fn split(symbol: &str) -> Option<(&str, &str)> {
    for quote in QUOTES {
        if let Some(base) = symbol.strip_suffix(quote)
            && !base.is_empty()
        {
            return Some((base, quote));
        }
    }
    None
}

#[derive(Deserialize)]
struct Reply {
    #[serde(default = "super::no_code")]
    code: i64, // 0 on success
    #[serde(default, alias = "msg")]
    message: String,
    result: Option<Vec<Contract>>,
}

#[derive(Deserialize)]
pub struct Contract {
    #[serde(default)]
    pub symbol: String, // "BTCUSDT", the socket's key and the anchor replies' symbol
    #[serde(rename = "type", default)]
    kind: String, // "PERP" on every row
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows of the live reply of 2026-10-09, which listed 40 rows, all PERP and all ending in USDT.
    fn row(symbol: &str, tick: f64) -> Value {
        json!({ "symbol": symbol, "tick": tick, "lotSize": 1.0, "type": "PERP" })
    }

    fn live_rows() -> Value {
        json!([
            row("MASKUSDT", 1.0E-4),
            row("TSLAUSDT", 0.01),
            row("BTCUSDT", 0.1),
            row("1000PEPEUSDT", 1.0E-6),
            row("TBTCTUSDT", 1.0),
            row("XAGUSDT", 0.01),
        ])
    }

    fn parsed(rows: Value) -> Vec<Market> {
        let rows: Vec<Contract> = serde_json::from_value(rows).unwrap();
        parse(&rows)
    }

    #[test]
    fn keeps_every_perp_row_as_a_linear_contract_of_one_coin_at_the_vip0_taker() {
        let markets = parsed(json!([row("BTCUSDT", 0.1), row("ETHUSDT", 0.05)]));

        assert_eq!(raw_ids(&markets), ["BTCUSDT", "ETHUSDT"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert!(markets.iter().all(|m| m.linear && m.contract_size == 1.0 && m.price_scale == 1.0 && m.taker_ppm == 600));
    }

    // The venue lists no other type today, so this is the BTC row with the type of a dated contract.
    #[test]
    fn drops_a_row_of_another_type() {
        let mut dated = row("BTCUSDT", 0.1);
        dated["type"] = json!("FUTURE");

        assert!(parsed(json!([dated])).is_empty());
    }

    // The venue lists no coin quoted contract today, so these are the BTC row renamed.
    #[test]
    fn drops_a_coin_quoted_symbol_and_a_bare_quote() {
        assert!(parsed(json!([row("ETHBTC", 0.0001), row("USDT", 1.0)])).is_empty());
    }

    #[test]
    fn reads_usdc_and_usd_quotes_and_the_base_code_table() {
        let markets = parsed(json!([row("ETHUSDC", 0.05), row("XBTUSD", 0.1)]));

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("ETH", "USDC"));
        assert_eq!((markets[1].base.as_str(), markets[1].quote.as_str()), ("BTC", "USD"));
    }

    #[test]
    fn keeps_the_thousands_prefix_in_the_base_without_a_price_scale() {
        let markets = parsed(json!([row("1000PEPEUSDT", 1.0E-6)]));

        assert_eq!(markets[0].base, "1000PEPE");
        assert_eq!(markets[0].price_scale, 1.0);
    }

    #[tokio::test]
    async fn loads_the_catalog_and_denies_the_second_bitcoin_contract() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(REF_DATA_PATH, json!({ "code": 0, "message": "OK", "result": live_rows() }));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "trubitpro");
        assert_eq!(venue.name, "TruBit Pro Exchange");
        assert_eq!(raw_ids(&venue.markets), ["MASKUSDT", "TSLAUSDT", "BTCUSDT", "1000PEPEUSDT", "XAGUSDT"]);
        assert_eq!(logs.events("market_denied")[0].text("market"), "TBTCTUSDT");
    }

    #[tokio::test]
    async fn fails_a_reply_with_a_nonzero_code_in_a_200() {
        let rest = MockRest::start().await;
        rest.reply(REF_DATA_PATH, json!({ "code": 1, "msg": "FAILED", "data": null }));

        let error = load_from(&http(), &rest.url).await.unwrap_err();

        assert!(format!("{error:#}").contains("FAILED"), "{error:#}");
    }
}
