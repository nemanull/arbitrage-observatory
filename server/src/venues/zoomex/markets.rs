use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog;
use serde::Deserialize;

const NAME: &str = "Zoomex";
const TAKER_PPM: u32 = 600; // VIP 0 standard taker
const INNOVATION_TAKER_PPM: u32 = 1_100; // the contracts tagged "Innovation Zone", 73 on 2026-10-09
const INNOVATION_TAG: &str = "Innovation Zone";

// Bybit's v5 instruments call under Zoomex's own prefix.
// The inverse category is left out, because its four contracts are coin settled and sized in USD.
const INSTRUMENTS_PATH: &str = "/cloud/trade/v3/market/instruments-info";
const PAGE_LIMIT: &str = "1000";
const MAX_PAGES: usize = 20; // the linear family filled one page of 711 on 2026-10-09

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let rows = linear(http, rest).await?;
    let markets = parse(&rows);

    catalog::finish(ID, NAME, rows.len(), markets, &[])
}

// Every page of the linear category, following nextPageCursor as CCXT's bybit class does.
async fn linear(http: &reqwest::Client, rest: &str) -> anyhow::Result<Vec<Instrument>> {
    let base = format!("{rest}{INSTRUMENTS_PATH}");
    let mut instruments = Vec::new();
    let mut cursor = String::new();

    for _ in 0..MAX_PAGES {
        let mut query = vec![("category", "linear"), ("limit", PAGE_LIMIT)];
        if !cursor.is_empty() {
            query.push(("cursor", cursor.as_str()));
        }
        let url = reqwest::Url::parse_with_params(&base, &query)?;

        let reply: InstrumentsReply = get_json(http, url.as_str()).await?;
        if reply.ret_code != 0 {
            anyhow::bail!("instruments-info retCode {}: {}", reply.ret_code, reply.ret_msg);
        }

        let page = reply.result.list.len();
        instruments.extend(reply.result.list);
        let next = reply.result.next_page_cursor;
        if page == 0 || next.is_empty() || next == cursor {
            return Ok(instruments);
        }
        cursor = next;
    }

    anyhow::bail!("instruments-info still had a next page after {MAX_PAGES} pages")
}

// The rules CCXT's bybit class applies to an active linear perpetual, since Zoomex serves Bybit's catalog shape.
fn parse(instruments: &[Instrument]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in instruments {
        if row.contract_type != "LinearPerpetual" || row.status != "Trading" || row.symbol.is_empty() {
            continue;
        }

        let base = catalog::currency_code(&row.base_coin, &[]);
        let quote = catalog::currency_code(&row.quote_coin, &[]);
        if base.is_empty() || !matches!(quote.as_str(), "USDT" | "USDC" | "USD") {
            continue;
        }

        let innovation = row.tags.iter().any(|tag| tag == INNOVATION_TAG);

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: if innovation { INNOVATION_TAKER_PPM } else { TAKER_PPM },
            linear: true,
            contract_size: 1.0, // linear book sizes are base coins
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct InstrumentsReply {
    ret_code: i64,
    #[serde(default)]
    ret_msg: String,
    #[serde(default)]
    result: InstrumentsResult,
}

#[derive(Deserialize, Default)]
#[serde(rename_all = "camelCase")]
struct InstrumentsResult {
    #[serde(default)]
    list: Vec<Instrument>,
    #[serde(default)]
    next_page_cursor: String,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Instrument {
    #[serde(default)]
    symbol: String,
    #[serde(default)]
    contract_type: String, // "LinearPerpetual", "InversePerpetual"
    #[serde(default)]
    status: String, // "Trading", "PreLaunch", "Settling", "Closed"
    #[serde(default)]
    base_coin: String,
    #[serde(default)]
    quote_coin: String,
    #[serde(default)]
    tags: Vec<String>, // ["new", "Innovation Zone"], ["Stock"]
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    const FIRST_PAGE: &str = "/cloud/trade/v3/market/instruments-info?category=linear&limit=1000";

    // Rows captured live on 2026-10-09, cut to the fields the loader reads plus a few it ignores.
    fn instrument(symbol: &str, contract_type: &str, status: &str, base: &str, quote: &str, tags: &[&str]) -> Value {
        json!({
            "symbol": symbol, "contractType": contract_type, "status": status,
            "baseCoin": base, "quoteCoin": quote, "tags": tags, "fundingInterval": 480,
            "settleCoin": quote, "offlineTime": "",
            "lotSizeFilter": { "maxOrderQty": "1500.000", "minOrderQty": "0.001", "qtyStep": "0.001" },
        })
    }

    fn page(list: Value, cursor: &str) -> Value {
        json!({ "retCode": 0, "retMsg": "OK", "result": { "category": "linear", "list": list, "nextPageCursor": cursor }, "time": 1 })
    }

    fn rows() -> Value {
        json!([
            instrument("BTCUSDT", "LinearPerpetual", "Trading", "BTC", "USDT", &["TOP", "BRC-20"]),
            instrument("4USDT", "LinearPerpetual", "Trading", "4", "USDT", &["new", "Innovation Zone"]),
            instrument("AAPLUSDT", "LinearPerpetual", "Trading", "AAPL", "USDT", &["Stock"]),
            instrument("1000PEPEUSDT", "LinearPerpetual", "Trading", "1000PEPE", "USDT", &["Meme"]),
            // Every live row was Trading, so this one stands in for a contract being settled.
            instrument("OLDUSDT", "LinearPerpetual", "Settling", "OLD", "USDT", &[]),
            // The inverse category's row, coin settled and sized in USD.
            instrument("BTCUSD", "InversePerpetual", "Trading", "BTC", "USD", &[]),
        ])
    }

    fn parsed(list: Value) -> Vec<Market> {
        let instruments: Vec<Instrument> = serde_json::from_value(list).unwrap();
        parse(&instruments)
    }

    #[test]
    fn keeps_trading_linear_perpetuals_and_drops_inverse_and_inactive_contracts() {
        let markets = parsed(rows());

        assert_eq!(raw_ids(&markets), ["BTCUSDT", "4USDT", "AAPLUSDT", "1000PEPEUSDT"]);
        assert_eq!(markets[0].base, "BTC");
        assert_eq!(markets[0].quote, "USDT");
        assert!(markets[0].linear);
        assert_eq!(markets[0].contract_size, 1.0);
        assert_eq!(markets[3].base, "1000PEPE");
    }

    // No live row was quoted in a coin on 2026-10-09, so this one stands in for a coin quoted perpetual.
    #[test]
    fn drops_a_linear_perpetual_quoted_in_a_coin() {
        let markets = parsed(json!([
            instrument("ETHBTC", "LinearPerpetual", "Trading", "ETH", "BTC", &[]),
            instrument("ETHUSDC", "LinearPerpetual", "Trading", "ETH", "USDC", &[]),
        ]));

        assert_eq!(raw_ids(&markets), ["ETHUSDC"]);
        assert_eq!(markets[0].quote, "USDC");
    }

    #[test]
    fn charges_the_innovation_zone_taker_on_tagged_contracts_and_the_standard_taker_elsewhere() {
        let markets = parsed(rows());

        assert_eq!(markets[0].taker_ppm, 600);
        assert_eq!(markets[1].taker_ppm, 1_100);
        assert_eq!(markets[2].taker_ppm, 600);
    }

    #[tokio::test]
    async fn follows_the_cursor_until_a_page_names_none() {
        let rest = MockRest::start().await;
        let second = "/cloud/trade/v3/market/instruments-info?category=linear&limit=1000&cursor=first%3D0GUSDT%26last%3D10000SATSUSDT";
        rest.reply(FIRST_PAGE, page(json!([instrument("BTCUSDT", "LinearPerpetual", "Trading", "BTC", "USDT", &[])]), "first=0GUSDT&last=10000SATSUSDT"));
        rest.reply(second, page(json!([instrument("ETHUSDT", "LinearPerpetual", "Trading", "ETH", "USDT", &[])]), ""));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(venue.id, "zoomex");
        assert_eq!(raw_ids(&venue.markets), ["BTCUSDT", "ETHUSDT"]);
        assert_eq!(rest.calls(), [FIRST_PAGE, second]);
    }

    #[tokio::test]
    async fn fails_on_a_venue_error_code() {
        let rest = MockRest::start().await;
        rest.reply(FIRST_PAGE, json!({ "retCode": 10001, "retMsg": "params error", "result": {} }));

        let error = load_from(&http(), &rest.url).await.unwrap_err();

        assert!(error.to_string().contains("retCode 10001"), "{error:#}");
    }

    #[tokio::test]
    async fn fails_on_the_plain_text_refusal_the_venue_sends_under_http_400() {
        let rest = MockRest::start().await;
        rest.fail(FIRST_PAGE, 400);

        let error = load_from(&http(), &rest.url).await.unwrap_err();

        assert!(error.to_string().contains("400"), "{error:#}");
    }
}
