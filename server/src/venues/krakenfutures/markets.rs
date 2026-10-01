use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, contract_size, currency_code};
use crate::venues::wire;
use serde::Deserialize;

const NAME: &str = "Kraken Futures";
const TAKER_PPM: u32 = 500;

const INSTRUMENTS_PATH: &str = "/derivatives/api/v3/instruments";

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: InstrumentsReply = get_json(http, &format!("{rest}{INSTRUMENTS_PATH}")).await?;
    if reply.result != "success" {
        anyhow::bail!("instruments result {}: {}", reply.result, reply.error);
    }

    let markets = parse(&reply.instruments);
    catalog::finish(ID, NAME, reply.instruments.len(), markets, &[])
}

// CCXT's krakenfutures fetchMarkets for a tradeable perpetual, and the registry's filter, which keeps linear contracts only.
// The four PI_ inverse perpetuals collide with a PF_ linear one on the same pair, and their books were frozen in September 2026.
fn parse(instruments: &[Instrument]) -> Vec<Market> {
    let mut markets = Vec::new();

    for row in instruments {
        let perpetual = !row.kind.contains(" index") && row.last_trading_time.is_none();
        let linear = row.kind != "futures_inverse";
        if !perpetual || !row.tradeable || !linear {
            continue;
        }

        // "PF_XBTUSD" is XBT against USD, and CCXT spells XBT as BTC.
        let Some((_, pair)) = row.symbol.split_once('_') else {
            continue;
        };
        let Some(base_id) = pair.get(..pair.len().saturating_sub(3)) else {
            continue;
        };
        let base = currency_code(base_id, &[]);
        if base.is_empty() {
            continue;
        }

        markets.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.symbol.clone(),
            base,
            quote: currency_code("usd", &[]),
            taker_ppm: TAKER_PPM,
            linear,
            contract_size: contract_size(row.contract_size),
            price_scale: 1.0,
        });
    }

    markets
}

#[derive(Deserialize)]
struct InstrumentsReply {
    #[serde(default)]
    result: String,
    #[serde(default)]
    error: String,
    #[serde(default)]
    instruments: Vec<Instrument>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Instrument {
    #[serde(default)]
    symbol: String,
    #[serde(rename = "type", default)]
    kind: String, // "flexible_futures", "futures_inverse", "futures_vanilla", or an index type
    #[serde(default)]
    tradeable: bool,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    contract_size: f64,
    last_trading_time: Option<String>, // dated contracts only
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Trimmed from the reply of 2026-10-01.
    fn instruments() -> Value {
        json!({ "result": "success", "instruments": [
            { "symbol": "PI_XBTUSD", "type": "futures_inverse", "tradeable": true, "contractSize": 1 },
            { "symbol": "PF_XBTUSD", "type": "flexible_futures", "tradeable": true, "contractSize": 1 },
            { "symbol": "PF_1INCHUSD", "type": "flexible_futures", "tradeable": true, "contractSize": 1 },
            { "symbol": "FF_XBTUSD_261225", "type": "flexible_futures", "tradeable": true, "contractSize": 1,
              "lastTradingTime": "2026-12-25T16:00:00.000Z" },
            { "symbol": "PF_OLDUSD", "type": "flexible_futures", "tradeable": false, "contractSize": 1 },
        ]})
    }

    fn parsed() -> Vec<Market> {
        let reply: InstrumentsReply = serde_json::from_value(instruments()).unwrap();
        parse(&reply.instruments)
    }

    #[test]
    fn keeps_tradeable_linear_perpetuals_only() {
        assert_eq!(raw_ids(&parsed()), ["PF_XBTUSD", "PF_1INCHUSD"]);
    }

    #[test]
    fn spells_xbt_as_btc_against_usd() {
        let markets = parsed();

        assert_eq!((markets[0].base.as_str(), markets[0].quote.as_str()), ("BTC", "USD"));
        assert_eq!(markets[1].base, "1INCH");
        assert!(markets[0].linear);
        assert_eq!(markets[0].contract_size, 1.0);
        assert_eq!(markets[0].taker_ppm, 500);
    }

    #[tokio::test]
    async fn loads_the_catalog_and_fails_on_a_venue_error() {
        let rest = MockRest::start().await;
        rest.reply(INSTRUMENTS_PATH, instruments());
        let venue = load_from(&http(), &rest.url).await.unwrap();
        assert_eq!(venue.id, "krakenfutures");

        let failing = MockRest::start().await;
        failing.reply(INSTRUMENTS_PATH, json!({ "result": "error", "error": "apiLimitExceeded" }));
        let error = load_from(&http(), &failing.url).await.unwrap_err();
        assert!(error.to_string().contains("apiLimitExceeded"), "{error:#}");
    }
}
