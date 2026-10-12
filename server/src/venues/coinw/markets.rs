use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use serde::Deserialize;

const NAME: &str = "CoinW";

// The 0.06 % taker that every row's takerFee and every published source give.
const TAKER_PPM: u32 = 600;

// Every perpetual in one reply, about 520 KB, documented at 5 a second.
pub const INSTRUMENTS_PATH: &str = "/v1/perpum/instruments";

const QUOTES: &[&str] = &["USDT", "USDC", "USD"];

// Each market whose ticker names another token than the reference venues list under it.
const DENIED: &[(&str, &str)] = &[];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Reply = get_json(http, &format!("{rest}{INSTRUMENTS_PATH}")).await?;
    if reply.code != 0 {
        anyhow::bail!("{ID} instruments call answered code {}: {}", reply.code, reply.msg);
    }
    let markets = parse(&reply.data);
    catalog::finish(ID, NAME, reply.data.len(), markets, DENIED)
}

// No CCXT class exists, so the rules are the profile's.
// Every row is a linear perpetual margined in its quote.
// preOffline rows are left out, since they are announced for delisting and the card keeps only online ones.
fn parse(rows: &[Instrument]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        if row.status != "online" || row.name.is_empty() {
            continue;
        }

        let base = currency_code(&row.base, &[]);
        let quote = currency_code(&row.quote, &[]);
        if base.is_empty() || !QUOTES.contains(&quote.as_str()) {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.name.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0, // the book sizes are base coins, while oneLotSize is the order lot
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
    msg: String,
    #[serde(default)]
    data: Vec<Instrument>,
}

#[derive(Deserialize)]
struct Instrument {
    #[serde(default)]
    name: String, // "BTC" on USDT-M, "BTC_USDC" on USDC-M, the socket's pairCode
    #[serde(default)]
    base: String, // lower case, "btc" and "1000pepe"
    #[serde(default)]
    quote: String, // "usdt" or "usdc"
    #[serde(default)]
    status: String, // "online", "preOffline", "offline", "pretest" or "settlement"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows captured live from the instruments call on 2026-10-09, cut to a few fields beside the ones the loader reads.
    fn btc() -> Value {
        json!({
            "base": "btc", "quote": "usdt", "name": "BTC", "id": 1, "indexId": 1, "status": "online", "oneLotSize": 0.001,
            "minSize": 1, "takerFee": "0.0006", "makerFee": "0.0002", "settledAt": 1791590400000_i64, "settledPeriod": 8,
            "tradfiTag": "",
        })
    }

    fn btc_usdc() -> Value {
        json!({
            "base": "btc", "quote": "usdc", "name": "BTC_USDC", "id": 148, "status": "online", "oneLotSize": 0.001,
            "takerFee": "0.0006", "settledAt": 1791590400000_i64, "settledPeriod": 8, "tradfiTag": "",
        })
    }

    fn pepe() -> Value {
        json!({
            "base": "1000pepe", "quote": "usdt", "name": "1000PEPE", "status": "online", "oneLotSize": 1000,
            "takerFee": "0.0006", "settledAt": 1791576000000_i64, "settledPeriod": 4, "tradfiTag": "",
        })
    }

    fn samsung() -> Value {
        json!({
            "base": "samsung", "quote": "usdt", "name": "SAMSUNG", "status": "online", "oneLotSize": 0.01,
            "takerFee": "0.0006", "settledPeriod": 4, "tradfiTag": "",
        })
    }

    // Thirteen rows, mostly equities, read preOffline on 2026-10-09.
    fn qnt_pre_offline() -> Value {
        json!({
            "base": "qnt", "quote": "usdt", "name": "QNT", "status": "preOffline", "oneLotSize": 0.01,
            "takerFee": "0.0006", "settledAt": 1791590400000_i64, "settledPeriod": 8, "tradfiTag": "",
        })
    }

    // No row is quoted in a coin today, so this is the BTC row with its quote changed.
    fn coin_quoted() -> Value {
        let mut row = btc();
        row["name"] = json!("ETH_BTC");
        row["base"] = json!("eth");
        row["quote"] = json!("btc");
        row
    }

    fn parsed(rows: Value) -> Vec<Market> {
        let rows: Vec<Instrument> = serde_json::from_value(rows).unwrap();
        parse(&rows)
    }

    #[test]
    fn keeps_online_usdt_and_usdc_rows_as_linear_contracts_of_one_base_coin() {
        let markets = parsed(json!([btc(), btc_usdc(), pepe(), samsung(), qnt_pre_offline(), coin_quoted()]));

        assert_eq!(raw_ids(&markets), ["BTC", "BTC_USDC", "1000PEPE", "SAMSUNG"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!((markets[1].base.as_str(), markets[1].quote.as_str()), ("BTC", "USDC"));
        assert_eq!(markets[2].base, "1000PEPE");
        assert!(markets.iter().all(|m| m.linear && m.contract_size == 1.0 && m.price_scale == 1.0));
        assert!(markets.iter().all(|m| m.taker_ppm == 600));
    }

    #[test]
    fn the_order_lot_never_becomes_the_contract_size() {
        let markets = parsed(json!([pepe()]));

        assert_eq!(markets[0].contract_size, 1.0);
    }

    #[test]
    fn drops_a_row_with_no_name() {
        let mut row = btc();
        row["name"] = json!("");

        assert!(parsed(json!([row])).is_empty());
    }

    #[tokio::test]
    async fn loads_the_online_perpetuals_and_counts_every_row() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, json!({ "code": 0, "data": [btc(), qnt_pre_offline(), btc_usdc()], "msg": "" }));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "coinw");
        assert_eq!(venue.name, "CoinW");
        assert_eq!(raw_ids(&venue.markets), ["BTC", "BTC_USDC"]);
        let read = logs.events("catalog_read");
        assert_eq!(read[0].number("rows"), 3.0);
        assert_eq!(read[0].number("kept"), 2.0);
    }

    #[tokio::test]
    async fn fails_on_an_error_code() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, json!({ "code": 29001, "msg": "API access frequently" }));

        let error = load_from(&http(), &rest.url).await.unwrap_err();

        assert!(format!("{error}").contains("29001"));
    }
}
