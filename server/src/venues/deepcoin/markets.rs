use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, contract_size, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "Deepcoin";

// The VIP 0 taker of the USDT perpetuals, 0.06 %.
// CCXT's 0.0015 is one constant for every market and is not used.
const TAKER_PPM: u32 = 600;

// Every perpetual in one reply, about 140 KB.
pub const INSTRUMENTS_PATH: &str = "/deepcoin/market/instruments?instType=SWAP";

// CCXT reads a swap quoted in USD as inverse, and the five such contracts are settled in their base coin.
const QUOTES: &[&str] = &["USDT", "USDC"];

// The venue cuts baseCcy at 8 characters, as 1000CHEE for 1000CHEEMS-USDT-SWAP, and names 1000SHIB-USDT-SWAP's base SHIB although its price is per 1,000 SHIB.
// The underlying id keeps the whole name, so its base is taken in those two cases.
const BASE_CCY_MAX: usize = 8;

// Each market whose ticker names another token than the reference venues list under it, from live_identity.
const DENIED: &[(&str, &str)] = &[];

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Reply = get_json(http, &format!("{rest}{INSTRUMENTS_PATH}")).await?;
    // An error is a 200 with a non-zero code.
    if reply.code != "0" {
        anyhow::bail!("{ID} instruments call answered code {}: {}", reply.code, reply.msg);
    }
    let rows = reply.data.unwrap_or_default();
    let markets = parse(&rows);
    catalog::finish(ID, NAME, rows.len(), markets, DENIED)
}

// CCXT's deepcoin parseMarket for an active linear swap, with the base read whole where baseCcy is cut.
fn parse(rows: &[Instrument]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in rows {
        if row.inst_type != "SWAP" || row.state != "live" {
            continue;
        }

        let quote = currency_code(&row.quote_ccy, &[]);
        if !QUOTES.contains(&quote.as_str()) || row.base_ccy.is_empty() || row.tick_sz.is_empty() {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: format!("{}_{}", wire_id(row), row.tick_sz),
            base: currency_code(base_id(row), &[]),
            quote,
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: contract_size(row.ct_val), // the socket's sizes are contracts of ctVal coins
            price_scale: 1.0,
        });
    }

    markets
}

// The socket's id, "BTCUSDT", which is the instrument id without -SWAP and without its first dash.
fn wire_id(row: &Instrument) -> String {
    if !row.symbol.is_empty() {
        return row.symbol.clone();
    }
    row.inst_id.strip_suffix("-SWAP").unwrap_or(&row.inst_id).replacen('-', "", 1)
}

fn base_id(row: &Instrument) -> &str {
    let underlying = row.uly.split('-').next().unwrap_or("");
    let cut = row.base_ccy.len() == BASE_CCY_MAX && underlying.len() > BASE_CCY_MAX && underlying.starts_with(&row.base_ccy);
    let per_thousand = underlying.strip_prefix("1000") == Some(row.base_ccy.as_str());
    if cut || per_thousand { underlying } else { &row.base_ccy }
}

#[derive(Deserialize)]
struct Reply {
    #[serde(default)]
    code: String, // "0"
    #[serde(default)]
    msg: String,
    data: Option<Vec<Instrument>>, // null on an error
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Instrument {
    #[serde(default)]
    inst_type: String, // "SWAP"
    #[serde(default)]
    inst_id: String, // "BTC-USDT-SWAP", the id of CCXT and of the REST calls
    #[serde(default)]
    uly: String, // "BTC-USDT", whole where baseCcy is cut
    #[serde(default)]
    base_ccy: String,
    #[serde(default)]
    quote_ccy: String, // "USDT", or "USD" on an inverse contract
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    ct_val: f64, // coins per contract, a decimal string
    #[serde(default)]
    tick_sz: String, // "0.1", which the book stream must name exactly as sent
    #[serde(default)]
    state: String, // "live"
    #[serde(default)]
    symbol: String, // "BTCUSDT", the socket's id
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows captured live from the instruments call on 2026-10-09, cut to the fields the loader reads plus a few it ignores.
    fn btc() -> Value {
        json!({
            "instType": "SWAP", "instId": "BTC-USDT-SWAP", "uly": "BTC-USDT", "baseCcy": "BTC", "quoteCcy": "USDT", "ctVal": "0.001",
            "ctValCcy": "BTC", "listTime": "0", "lever": "125", "tickSz": "0.1", "lotSz": "1", "minSz": "1", "ctType": "linear",
            "alias": "", "state": "live", "settleCcy": "USDT", "productGroup": "SwapU", "symbol": "BTCUSDT", "assetType": "crypto",
        })
    }

    fn nvda_stock() -> Value {
        json!({
            "instType": "SWAP", "instId": "NVDA-USDT-SWAP", "uly": "NVDA-USDT", "baseCcy": "NVDA", "quoteCcy": "USDT", "ctVal": "1",
            "tickSz": "0.01", "lotSz": "0.1", "ctType": "linear", "state": "live", "settleCcy": "USDT", "productGroup": "SwapU",
            "symbol": "NVDAUSDT", "assetType": "stock",
        })
    }

    fn xau_metal() -> Value {
        json!({
            "instType": "SWAP", "instId": "XAU-USDT-SWAP", "uly": "XAU-USDT", "baseCcy": "XAU", "quoteCcy": "USDT", "ctVal": "0.1",
            "tickSz": "0.01", "ctType": "linear", "state": "live", "settleCcy": "USDT", "productGroup": "SwapU", "symbol": "XAUUSDT",
            "assetType": "metal",
        })
    }

    fn brent_commodity() -> Value {
        json!({
            "instType": "SWAP", "instId": "BZ-USDT-SWAP", "uly": "BZ-USDT", "baseCcy": "BZ", "quoteCcy": "USDT", "ctVal": "0.1",
            "tickSz": "0.01", "ctType": "linear", "state": "live", "settleCcy": "USDT", "productGroup": "SwapU", "symbol": "BZUSDT",
            "assetType": "commodity",
        })
    }

    fn eth_inverse() -> Value {
        json!({
            "instType": "SWAP", "instId": "ETH-USD-SWAP", "uly": "ETH-USD", "baseCcy": "ETH", "quoteCcy": "USD", "ctVal": "10",
            "ctValCcy": "USD", "tickSz": "0.05", "ctType": "inverse", "state": "live", "settleCcy": "ETH", "productGroup": "Swap",
            "symbol": "ETHUSD", "assetType": "crypto",
        })
    }

    fn cheems() -> Value {
        json!({
            "instType": "SWAP", "instId": "1000CHEEMS-USDT-SWAP", "uly": "1000CHEEMS-USDT", "baseCcy": "1000CHEE", "quoteCcy": "USDT",
            "ctVal": "1", "ctValCcy": "1000CHEE", "tickSz": "0.0000001", "ctType": "linear", "state": "live", "settleCcy": "USDT",
            "productGroup": "SwapU", "symbol": "1000CHEEMSUSDT", "assetType": "crypto",
        })
    }

    fn shib() -> Value {
        json!({
            "instType": "SWAP", "instId": "1000SHIB-USDT-SWAP", "uly": "1000SHIB-USDT", "baseCcy": "SHIB", "quoteCcy": "USDT",
            "ctVal": "1", "ctValCcy": "SHIB", "tickSz": "0.000001", "ctType": "linear", "state": "live", "settleCcy": "USDT",
            "productGroup": "SwapU", "symbol": "1000SHIBUSDT", "assetType": "crypto",
        })
    }

    // Its price matched binance's NEIROUSDT at 0.0000822, so its base stays NEIRO.
    fn neiro() -> Value {
        json!({
            "instType": "SWAP", "instId": "2NEIRO-USDT-SWAP", "uly": "2NEIRO-USDT", "baseCcy": "NEIRO", "quoteCcy": "USDT",
            "ctVal": "1", "tickSz": "0.00000001", "ctType": "linear", "state": "live", "settleCcy": "USDT", "productGroup": "SwapU",
            "symbol": "2NEIROUSDT", "assetType": "crypto",
        })
    }

    fn pepe() -> Value {
        json!({
            "instType": "SWAP", "instId": "1000PEPE-USDT-SWAP", "uly": "1000PEPE-USDT", "baseCcy": "1000PEPE", "quoteCcy": "USDT",
            "ctVal": "1000", "tickSz": "0.0000001", "ctType": "linear", "state": "live", "settleCcy": "USDT", "productGroup": "SwapU",
            "symbol": "1000PEPEUSDT", "assetType": "crypto",
        })
    }

    // Every swap read live on 2026-10-09, so this row is the ETH capture with another state.
    fn suspended() -> Value {
        let mut row = btc();
        row["instId"] = json!("ETH-USDT-SWAP");
        row["uly"] = json!("ETH-USDT");
        row["baseCcy"] = json!("ETH");
        row["symbol"] = json!("ETHUSDT");
        row["state"] = json!("suspend");
        row
    }

    fn parsed(rows: Value) -> Vec<Market> {
        let rows: Vec<Instrument> = serde_json::from_value(rows).unwrap();
        parse(&rows)
    }

    fn reply(rows: Value) -> Value {
        json!({ "code": "0", "msg": "", "data": rows })
    }

    #[test]
    fn keeps_live_linear_usdt_swaps_of_every_asset_type_named_by_wire_id_and_tick_size() {
        let markets = parsed(json!([btc(), nvda_stock(), xau_metal(), brent_commodity(), eth_inverse(), suspended()]));

        assert_eq!(raw_ids(&markets), ["BTCUSDT_0.1", "NVDAUSDT_0.01", "XAUUSDT_0.01", "BZUSDT_0.01"]);
        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USDT"));
        assert_eq!(markets[1].base, "NVDA");
        assert!(markets.iter().all(|m| m.linear && m.price_scale == 1.0 && m.taker_ppm == 600));
    }

    #[test]
    fn the_contract_size_is_ct_val() {
        let markets = parsed(json!([btc(), nvda_stock(), xau_metal(), pepe()]));

        let sizes: Vec<f64> = markets.iter().map(|m| m.contract_size).collect();
        assert_eq!(sizes, [0.001, 1.0, 0.1, 1000.0]);
    }

    #[test]
    fn reads_the_whole_base_where_base_ccy_is_cut_or_leaves_out_the_1000() {
        let markets = parsed(json!([cheems(), shib(), neiro(), pepe()]));

        assert_eq!(raw_ids(&markets), ["1000CHEEMSUSDT_0.0000001", "1000SHIBUSDT_0.000001", "2NEIROUSDT_0.00000001", "1000PEPEUSDT_0.0000001"]);
        let bases: Vec<&str> = markets.iter().map(|m| m.base.as_str()).collect();
        assert_eq!(bases, ["1000CHEEMS", "1000SHIB", "NEIRO", "1000PEPE"]);
    }

    #[test]
    fn drops_a_swap_quoted_in_a_coin() {
        let mut row = btc();
        row["instId"] = json!("ETH-BTC-SWAP");
        row["baseCcy"] = json!("ETH");
        row["quoteCcy"] = json!("BTC");

        assert!(parsed(json!([row])).is_empty());
    }

    #[test]
    fn derives_the_wire_id_from_the_instrument_id_when_the_symbol_is_missing() {
        let mut row = btc();
        row.as_object_mut().unwrap().remove("symbol");

        assert_eq!(raw_ids(&parsed(json!([row]))), ["BTCUSDT_0.1"]);
    }

    #[test]
    fn drops_a_row_without_a_tick_size_since_its_book_cannot_be_named() {
        let mut row = btc();
        row["tickSz"] = json!("");

        assert!(parsed(json!([row])).is_empty());
    }

    #[tokio::test]
    async fn loads_the_perpetuals_and_counts_every_row() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, reply(json!([btc(), eth_inverse(), suspended()])));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "deepcoin");
        assert_eq!(venue.name, "Deepcoin");
        assert_eq!(raw_ids(&venue.markets), ["BTCUSDT_0.1"]);
        assert_eq!(logs.events("catalog_read")[0].number("rows"), 3.0);
    }

    #[tokio::test]
    async fn fails_on_an_error_code_inside_a_200() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, json!({ "code": "51", "msg": "The instType field is required", "data": null }));

        let error = load_from(&http(), &rest.url).await.unwrap_err();
        assert!(format!("{error}").contains("code 51"));
    }
}
