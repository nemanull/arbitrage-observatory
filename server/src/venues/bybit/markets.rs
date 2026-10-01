use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, contract_size, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "Bybit";
const TAKER_PPM: u32 = 550; // non-VIP derivatives, where CCXT still carried the old 0.06 percent

const INSTRUMENTS_PATH: &str = "/v5/market/instruments-info";
const PAGE_LIMIT: &str = "1000";
const MAX_PAGES: usize = 20; // the linear family filled one page of 891 on 2026-10-01

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let (linear, inverse) = tokio::try_join!(category(http, rest, "linear"), category(http, rest, "inverse"))?;

    let rows = linear.len() + inverse.len();
    let mut markets = parse(&linear, true);
    markets.extend(parse(&inverse, false));

    catalog::finish(ID, NAME, rows, markets, &[])
}

// Every page of one category, following nextPageCursor as CCXT does.
async fn category(http: &reqwest::Client, rest: &str, category: &str) -> anyhow::Result<Vec<Instrument>> {
    let base = format!("{rest}{INSTRUMENTS_PATH}");
    let mut instruments = Vec::new();
    let mut cursor = String::new();

    for _ in 0..MAX_PAGES {
        let mut query = vec![("category", category), ("limit", PAGE_LIMIT)];
        if !cursor.is_empty() {
            query.push(("cursor", cursor.as_str()));
        }
        let url = reqwest::Url::parse_with_params(&base, &query)?;

        let reply: InstrumentsReply = get_json(http, url.as_str()).await?;
        if reply.ret_code != 0 {
            anyhow::bail!("instruments-info {category} retCode {}: {}", reply.ret_code, reply.ret_msg);
        }

        let page = reply.result.list.len();
        instruments.extend(reply.result.list);
        let next = reply.result.next_page_cursor;
        if page == 0 || next.is_empty() || next == cursor {
            return Ok(instruments);
        }
        cursor = next;
    }

    anyhow::bail!("instruments-info {category} still had a next page after {MAX_PAGES} pages")
}

// CCXT's bybit fetchFutureMarkets for an active perpetual of one category.
fn parse(instruments: &[Instrument], linear: bool) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in instruments {
        let perpetual = row.contract_type == "LinearPerpetual" || row.contract_type == "InversePerpetual";
        if !perpetual || row.status != "Trading" || row.symbol.is_empty() {
            continue;
        }

        let base = currency_code(&row.base_coin, &[]);
        let quote = currency_code(&row.quote_coin, &[]);
        if base.is_empty() || quote.is_empty() {
            continue;
        }

        // CCXT counts an inverse contract as its minimum order, and a linear one as one coin.
        let size = if linear {
            1.0
        } else if row.lot_size_filter.min_trading_qty.is_nan() {
            row.lot_size_filter.min_order_qty
        } else {
            row.lot_size_filter.min_trading_qty
        };

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote,
            taker_ppm: TAKER_PPM,
            linear,
            contract_size: contract_size(size),
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
    contract_type: String, // "LinearPerpetual", "InversePerpetual", "LinearFutures", "InverseFutures"
    #[serde(default)]
    status: String, // "Trading", "PreLaunch", "Settling", "Closed"
    #[serde(default)]
    base_coin: String,
    #[serde(default)]
    quote_coin: String,
    #[serde(default)]
    lot_size_filter: LotSizeFilter,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct LotSizeFilter {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    min_trading_qty: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    min_order_qty: f64,
}

impl Default for LotSizeFilter {
    fn default() -> Self {
        Self {
            min_trading_qty: f64::NAN,
            min_order_qty: f64::NAN,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    fn instrument(symbol: &str, contract_type: &str, status: &str, base: &str, quote: &str) -> Value {
        json!({
            "symbol": symbol, "contractType": contract_type, "status": status,
            "baseCoin": base, "quoteCoin": quote, "settleCoin": quote,
            "lotSizeFilter": { "maxOrderQty": "1190", "minOrderQty": "0.001", "qtyStep": "0.001" },
        })
    }

    fn page(list: Value, cursor: &str) -> Value {
        json!({ "retCode": 0, "retMsg": "OK", "result": { "category": "linear", "list": list, "nextPageCursor": cursor }, "time": 1 })
    }

    fn linear() -> Value {
        json!([
            instrument("BTCUSDT", "LinearPerpetual", "Trading", "BTC", "USDT"),
            instrument("BTCPERP", "LinearPerpetual", "Trading", "BTC", "USDC"),
            instrument("BTCUSDT-26DEC26", "LinearFutures", "Trading", "BTC", "USDT"),
            instrument("ANTHROPICUSDT", "LinearPerpetual", "PreLaunch", "ANTHROPIC", "USDT"),
            instrument("1000PEPEUSDT", "LinearPerpetual", "Trading", "1000PEPE", "USDT"),
        ])
    }

    fn inverse() -> Value {
        json!([
            {
                "symbol": "BTCUSD", "contractType": "InversePerpetual", "status": "Trading",
                "baseCoin": "BTC", "quoteCoin": "USD", "settleCoin": "BTC",
                "lotSizeFilter": { "maxOrderQty": "6000000", "minOrderQty": "1", "qtyStep": "1" },
            },
            instrument("BTCUSDZ26", "InverseFutures", "Trading", "BTC", "USD"),
        ])
    }

    fn parsed(list: Value, linear: bool) -> Vec<Market> {
        let instruments: Vec<Instrument> = serde_json::from_value(list).unwrap();
        parse(&instruments, linear)
    }

    #[test]
    fn keeps_trading_perpetuals_and_drops_dated_and_prelaunch_contracts() {
        let markets = parsed(linear(), true);

        assert_eq!(raw_ids(&markets), ["BTCUSDT", "BTCPERP", "1000PEPEUSDT"]);
        assert_eq!(markets[1].quote, "USDC");
        assert_eq!(markets[2].base, "1000PEPE");
        assert!(markets[0].linear);
        assert_eq!(markets[0].contract_size, 1.0);
        assert_eq!(markets[0].taker_ppm, 550);
    }

    #[test]
    fn reads_an_inverse_contract_as_its_minimum_order() {
        let markets = parsed(inverse(), false);

        assert_eq!(raw_ids(&markets), ["BTCUSD"]);
        assert!(!markets[0].linear);
        assert_eq!(markets[0].quote, "USD");
        assert_eq!(markets[0].contract_size, 1.0);
    }

    #[tokio::test]
    async fn follows_the_cursor_until_a_page_names_none() {
        let rest = MockRest::start().await;
        let first = "/v5/market/instruments-info?category=linear&limit=1000";
        let second = "/v5/market/instruments-info?category=linear&limit=1000&cursor=next%3D1%2C2";
        rest.reply(first, page(json!([instrument("BTCUSDT", "LinearPerpetual", "Trading", "BTC", "USDT")]), "next=1,2"));
        rest.reply(second, page(json!([instrument("ETHUSDT", "LinearPerpetual", "Trading", "ETH", "USDT")]), ""));
        rest.reply("/v5/market/instruments-info?category=inverse&limit=1000", page(inverse(), ""));

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(raw_ids(&venue.markets), ["BTCUSDT", "ETHUSDT", "BTCUSD"]);
        assert!(rest.calls().contains(&second.to_string()));
    }

    #[tokio::test]
    async fn fails_on_a_venue_error_code() {
        let rest = MockRest::start().await;
        rest.reply(
            "/v5/market/instruments-info?category=linear&limit=1000",
            json!({ "retCode": 10001, "retMsg": "params error", "result": {} }),
        );
        rest.reply("/v5/market/instruments-info?category=inverse&limit=1000", page(inverse(), ""));

        let error = load_from(&http(), &rest.url).await.unwrap_err();

        assert!(error.to_string().contains("retCode 10001"), "{error:#}");
    }
}
