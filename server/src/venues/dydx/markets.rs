use super::{ID, REST};
use crate::engine::cluster::{Market, Venue};
use crate::feeds::anchor_poller::get_json;
use crate::venues::catalog::{self, currency_code};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::BTreeMap;

// One call lists every market with its status, its oracle price and its funding estimate.
pub const MARKETS_PATH: &str = "/perpetualMarkets";

// FINAL_SETTLEMENT is a delisted market, which keeps its last oracle price and trades no more.
pub const ACTIVE: &str = "ACTIVE";

const NAME: &str = "dYdX";
const TAKER_PPM: u32 = 500; // tier 1 of perpetual_fee_params in chain state, while CCXT's market.taker is undefined

// Every ticker ends in -USD while collateral and settlement are USDC, and CCXT hard codes the quote as USDC.
const QUOTE: &str = "USDC";

pub async fn load(http: &reqwest::Client) -> anyhow::Result<Venue> {
    load_from(http, REST).await
}

async fn load_from(http: &reqwest::Client, rest: &str) -> anyhow::Result<Venue> {
    let reply: Reply = get_json(http, &format!("{rest}{MARKETS_PATH}")).await?;
    let markets = parse(&reply.markets);
    catalog::finish(ID, NAME, reply.markets.len(), markets, &[])
}

// CCXT's dydx parseMarket for an active market: the ticker is the id, the part before its first hyphen the base, and a contract one coin.
// Every market trades on the chain's one book at the chain's one oracle, so no family here is a third party's deployment.
fn parse(markets: &BTreeMap<String, Row>) -> Vec<Market> {
    let mut kept = Vec::new();

    for row in markets.values() {
        if row.status != ACTIVE || row.ticker.is_empty() {
            continue;
        }
        let base = row.ticker.split('-').next().unwrap_or("");

        kept.push(Market {
            venue_id: ID.to_string(),
            raw_market_id: row.ticker.clone(),
            base: currency_code(base, &[]),
            quote: QUOTE.to_string(),
            taker_ppm: TAKER_PPM,
            linear: true,
            contract_size: 1.0, // book sizes are base coins, as stepSize is
            price_scale: 1.0,   // every market is priced per coin, PEPE-USD at about 0.000004
        });
    }

    kept
}

#[derive(Deserialize)]
pub struct Reply {
    #[serde(default)]
    pub markets: BTreeMap<String, Row>, // by ticker
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Row {
    #[serde(default)]
    pub ticker: String, // "BTC-USD", the socket's id
    #[serde(default)]
    pub status: String, // "ACTIVE" or "FINAL_SETTLEMENT" on 2026-10-12, and the documentation lists four more
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    pub oracle_price: f64, // the chain's oracle, which is the index and the price positions are marked at
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    pub next_funding_rate: f64, // the running estimate of the coming hourly settlement, a fraction per hour
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, raw_ids};
    use serde_json::{Value, json};

    // Rows of GET /v4/perpetualMarkets captured live on 2026-10-12 at 22:53 UTC, cut to eight of 296 and to a few of their fields.
    fn reply() -> Value {
        json!({ "markets": {
            "BTC-USD": {
                "clobPairId": "0", "ticker": "BTC-USD", "status": "ACTIVE", "oraclePrice": "82371.7996", "nextFundingRate": "0",
                "atomicResolution": -10, "tickSize": "1", "stepSize": "0.0001", "marketType": "CROSS", "defaultFundingRate1H": "0",
            },
            "1INCH-USD": {
                "clobPairId": "97", "ticker": "1INCH-USD", "status": "ACTIVE", "oraclePrice": "0.0964774736",
                "nextFundingRate": "0.00000147453703703704", "tickSize": "0.00001", "stepSize": "10", "marketType": "CROSS",
            },
            "PEPE-USD": {
                "clobPairId": "28", "ticker": "PEPE-USD", "status": "ACTIVE", "oraclePrice": "0.0000039766738366", "nextFundingRate": "0",
                "atomicResolution": 1, "tickSize": "0.0000000001", "stepSize": "10000000", "marketType": "CROSS",
            },
            "MON-USD": {
                "clobPairId": "383", "ticker": "MON-USD", "status": "ACTIVE", "oraclePrice": "0.02473803162", "nextFundingRate": "0.0000125",
                "marketType": "CROSS", "defaultFundingRate1H": "0.0000125",
            },
            "MATIC-USD": {
                "clobPairId": "3", "ticker": "MATIC-USD", "status": "FINAL_SETTLEMENT", "oraclePrice": "0.3932407381", "nextFundingRate": "0",
                "marketType": "CROSS",
            },
            "MOTHER-USD": {
                "clobPairId": "69", "ticker": "MOTHER-USD", "status": "FINAL_SETTLEMENT", "oraclePrice": "0.0115072852",
                "nextFundingRate": "0.0000125", "marketType": "ISOLATED",
            },
            "FARTCOIN,RAYDIUM,9BB6NFECJBCTNNLFKO2FQVQBQ8HHM13KCYYCDQBGPUMP-USD": {
                "clobPairId": "181", "ticker": "FARTCOIN,RAYDIUM,9BB6NFECJBCTNNLFKO2FQVQBQ8HHM13KCYYCDQBGPUMP-USD",
                "status": "FINAL_SETTLEMENT", "oraclePrice": "0.1282085815", "nextFundingRate": "0", "marketType": "CROSS",
            },
            "BLUR-USD": {
                "clobPairId": "25", "ticker": "BLUR-USD", "status": "ACTIVE", "oraclePrice": "0.01453",
                "nextFundingRate": "-0.00128785416666666667", "marketType": "CROSS",
            },
        } })
    }

    fn parsed(reply: Value) -> Vec<Market> {
        let reply: Reply = serde_json::from_value(reply).unwrap();
        parse(&reply.markets)
    }

    #[test]
    fn keeps_every_active_market_by_its_ticker_as_a_linear_usdc_market_of_one_coin() {
        let markets = parsed(reply());

        assert_eq!(raw_ids(&markets), ["1INCH-USD", "BLUR-USD", "BTC-USD", "MON-USD", "PEPE-USD"]);
        assert_eq!((markets[2].base.as_str(), markets[2].quote.as_str()), ("BTC", "USDC"));
        assert_eq!(markets[0].base, "1INCH");
        assert_eq!(markets[4].base, "PEPE");
        assert!(markets.iter().all(|m| m.linear && m.taker_ppm == 500 && m.contract_size == 1.0 && m.price_scale == 1.0));
        assert!(markets.iter().all(|m| m.venue_id == "dydx"));
    }

    #[test]
    fn drops_a_market_in_final_settlement_whatever_its_margin_type_or_ticker() {
        let markets = parsed(reply());

        for settled in ["MATIC-USD", "MOTHER-USD", "FARTCOIN,RAYDIUM,9BB6NFECJBCTNNLFKO2FQVQBQ8HHM13KCYYCDQBGPUMP-USD"] {
            assert!(!raw_ids(&markets).contains(&settled), "{settled}");
        }
    }

    // Every market read ACTIVE or FINAL_SETTLEMENT on 2026-10-12, so this row is BTC's with a status the documentation lists.
    #[test]
    fn drops_a_market_in_any_status_other_than_active() {
        let mut paused = reply();
        paused["markets"]["BTC-USD"]["status"] = json!("PAUSED");

        assert!(!raw_ids(&parsed(paused)).contains(&"BTC-USD"));
    }

    #[test]
    fn drops_a_row_with_no_ticker() {
        let markets = parsed(json!({ "markets": { "X": { "status": "ACTIVE" } } }));

        assert!(markets.is_empty());
    }

    #[tokio::test]
    async fn loads_the_active_markets_and_logs_the_rows_read() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, reply());

        let venue = load_from(&http(), &rest.url).await.unwrap();

        assert_eq!(rest.calls(), [MARKETS_PATH]);
        assert_eq!((venue.id.as_str(), venue.name.as_str()), ("dydx", "dYdX"));
        assert_eq!(venue.markets.len(), 5);
        let read = logs.events("catalog_read");
        assert_eq!(read[0].number("rows"), 8.0);
        assert_eq!(read[0].number("kept"), 5.0);
    }

    #[tokio::test]
    async fn a_failed_call_or_a_catalog_with_no_active_market_fails_the_load() {
        let rest = MockRest::start().await;
        rest.fail(MARKETS_PATH, 500);
        assert!(load_from(&http(), &rest.url).await.is_err());

        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, json!({ "markets": {} }));
        assert!(load_from(&http(), &rest.url).await.is_err());
    }
}
