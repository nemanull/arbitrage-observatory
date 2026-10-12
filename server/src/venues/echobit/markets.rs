use super::{ID, REST, index_id};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, contract_size, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "Echobit";

// The published USDT-M taker, 0.06 %, with no VIP table.
const TAKER_PPM: u32 = 600;

// Every USDT-M contract, visible, hidden or simulated, in one reply of about 250 KB with no paging.
pub const CONTRACTS_PATH: &str = "/uapi/contract/list";

const FUTURES_TYPE: i64 = 4; // "1-spot, 4-futures"
const LIVE_USDT: i64 = 1; // baseId, where 2 is CONTRACT_SIMULATION on TUSDT

const QUOTES: &[&str] = &["USDT", "USDC", "USD"];

// Each market whose ticker names another token than the reference venues list under it.
const DENIED: &[(&str, &str)] = &[];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Reply = get_json(http, &format!("{rest}{CONTRACTS_PATH}")).await?;
    if reply.code != "0" {
        anyhow::bail!("{ID} contract list answered code {}: {}", reply.code, reply.msg);
    }
    let markets = parse(&reply.data);
    catalog::finish(ID, NAME, reply.data.len(), markets, DENIED)
}

// No status field exists, so a contract trades when the site shows it, and a hidden row is delisted or not yet listed.
// No CCXT class exists, so these are the rules of the profile's rest.md.
fn parse(rows: &[Contract]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        if row.kind != FUTURES_TYPE || row.base_id != LIVE_USDT || !row.show_state {
            continue;
        }

        let base = currency_code(&row.base_token_id, &[]);
        let quote = currency_code(&row.quote_token_id, &[]);
        if base.is_empty() || !QUOTES.contains(&quote.as_str()) {
            continue;
        }

        // The mark and index channels are named from the raw id, so a market whose indexId follows another rule would never anchor.
        if row.index_id != index_id(&row.symbol_id) {
            tracing::warn!(
                event = "market_skipped",
                venue = ID,
                market = %row.symbol_id,
                index_id = %row.index_id,
                reason = "indexId is not the raw id without -SWAP-",
            );
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol_id.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: contract_size(row.multiplier), // book sizes are contracts of multiplier coins, 0.0001 BTC on BTC-SWAP-USDT
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct Reply {
    #[serde(default)]
    code: String, // "0"
    #[serde(default)]
    msg: String,
    #[serde(default)]
    data: Vec<Contract>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Contract {
    #[serde(default)]
    symbol_id: String, // "BTC-SWAP-USDT", the socket's id
    #[serde(default)]
    base_token_id: String,
    #[serde(default)]
    quote_token_id: String, // "USDT", or "TUSDT" on a simulation row
    #[serde(default)]
    base_id: i64,
    #[serde(default)]
    show_state: bool,
    #[serde(rename = "type", default)]
    kind: i64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    multiplier: f64, // "0.0001" to "10000.0"
    #[serde(default)]
    index_id: String, // "BTCUSDT", the symbol of the mark and index channels
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows captured live from the contract list on 2026-10-09, cut to the fields the loader reads plus a few it ignores.
    fn row(symbol_id: &str, base: &str, quote: &str, base_id: i64, show_state: bool, multiplier: &str) -> Value {
        json!({
            "symbolId": symbol_id, "baseTokenId": base, "quoteTokenId": quote, "baseTokenPrecision": "1",
            "minPricePrecision": "0.1", "baseId": base_id, "showState": show_state, "showDate": 1604742313403_i64, "type": 4,
            "tokenId": symbol_id, "multiplier": multiplier, "indexId": format!("{base}{quote}"),
            "marketPriceScope": ["-0.001", "0.001"],
        })
    }

    fn btc() -> Value {
        row("BTC-SWAP-USDT", "BTC", "USDT", 1, true, "0.0001")
    }

    fn xau_tradfi() -> Value {
        row("XAU-SWAP-USDT", "XAU", "USDT", 1, true, "0.01")
    }

    fn pepe_per_thousand() -> Value {
        row("1000PEPE-SWAP-USDT", "1000PEPE", "USDT", 1, true, "1.0")
    }

    fn ada() -> Value {
        row("ADA-SWAP-USDT", "ADA", "USDT", 1, true, "10.0")
    }

    // Delisted, with showDate 0.
    fn shib_hidden() -> Value {
        let mut row = row("SHIB-SWAP-USDT", "SHIB", "USDT", 1, false, "1000.0");
        row["showDate"] = json!(0);
        row
    }

    fn simulation() -> Value {
        row("TBTC-SWAP-TUSDT", "TBTC", "TUSDT", 2, true, "0.0001")
    }

    fn parsed(rows: Value) -> Vec<Market> {
        let rows: Vec<Contract> = serde_json::from_value(rows).unwrap();
        parse(&rows)
    }

    fn reply(rows: Value) -> Value {
        json!({ "msg": "success", "code": "0", "data": rows })
    }

    #[test]
    fn keeps_visible_live_contracts_of_crypto_and_tradfi_as_linear_usdt_contracts_of_their_multiplier() {
        let markets = parsed(json!([btc(), xau_tradfi(), pepe_per_thousand(), ada(), shib_hidden(), simulation()]));

        assert_eq!(raw_ids(&markets), ["BTC-SWAP-USDT", "XAU-SWAP-USDT", "1000PEPE-SWAP-USDT", "ADA-SWAP-USDT"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!(markets[2].base, "1000PEPE");
        let sizes: Vec<f64> = markets.iter().map(|m| m.contract_size).collect();
        assert_eq!(sizes, [0.0001, 0.01, 1.0, 10.0]);
        assert!(markets.iter().all(|m| m.linear && m.price_scale == 1.0 && m.taker_ppm == 600));
    }

    #[test]
    fn drops_a_hidden_row_a_simulation_row_and_a_spot_row() {
        let mut spot = btc();
        spot["type"] = json!(1);

        assert!(parsed(json!([shib_hidden(), simulation(), spot])).is_empty());
    }

    #[test]
    fn drops_a_contract_quoted_in_a_coin() {
        assert!(parsed(json!([row("ETH-SWAP-BTC", "ETH", "BTC", 1, true, "1.0")])).is_empty());
    }

    #[test]
    fn skips_with_a_warning_a_contract_whose_index_is_not_named_after_it() {
        let (logs, _capture) = capture();
        let mut row = btc();
        row["indexId"] = json!("XBTUSDT");

        assert_eq!(raw_ids(&parsed(json!([row, ada()]))), ["ADA-SWAP-USDT"]);
        let skipped = logs.events("market_skipped");
        assert_eq!(skipped.len(), 1);
        assert_eq!(skipped[0].text("market"), "BTC-SWAP-USDT");
    }

    #[tokio::test]
    async fn loads_the_contracts_and_counts_every_row() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, reply(json!([btc(), shib_hidden(), simulation()])));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "echobit");
        assert_eq!(venue.name, "Echobit");
        assert_eq!(raw_ids(&venue.markets), ["BTC-SWAP-USDT"]);
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 3.0);
    }

    #[tokio::test]
    async fn fails_on_an_error_code() {
        let rest = MockRest::start().await;
        rest.reply(CONTRACTS_PATH, json!({ "msg": "fail", "code": "-1", "data": [] }));

        assert!(load_from(&http(), &rest.url).await.is_err());
    }
}
