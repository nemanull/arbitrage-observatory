use super::Extended;
use super::markets::{MARKETS_PATH, RWA, Reply, order_book_perpetual};
use crate::feeds::TrackedMarket;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::time::Duration;

// Funding settles every hour, and no field names the interval.
const FUNDING_INTERVAL_HOURS: f64 = 1.0;

// The documentation shows the next settlement in seconds, while the wire sends ms, and a value in seconds would read as 1970.
const MIN_UNIX_MS: f64 = 1e12;

// One call carries index, mark, the running rate and the next settlement, for the markets the query names.
// An unknown name fails the whole call with 400, while a delisted market stays in the catalog and still answers.
pub fn query(markets: &[TrackedMarket]) -> String {
    let mut names = Vec::with_capacity(markets.len());
    for tracked in markets {
        names.push(format!("market={}", tracked.market.raw_market_id));
    }
    if names.is_empty() {
        return String::new();
    }
    format!("?{}", names.join("&"))
}

impl AnchorVenue for Extended {
    // The budget is 1,000 requests a minute per IP, and the reply for 47 markets took 141 ms at the median.
    // Mark and index changed on about a third of 1 s polls, and the price sockets push every 1.5 s, so a faster poll reads repeats.
    fn poll_every(&self) -> Duration {
        Duration::from_secs(1)
    }

    // The budget is per minute, and no Retry-After is documented.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(60)
    }

    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let reply: Reply = get_json(http, &format!("{}{MARKETS_PATH}{}", self.rest, self.query)).await?;
        if reply.status != "OK" {
            anyhow::bail!("{MARKETS_PATH} answered status {:?}", reply.status);
        }

        let mut rows = AnchorMap::with_capacity(reply.data.len());
        for row in reply.data {
            // An RWA mark is the index most of the time, and while its oracle is closed the index comes from Extended's own book.
            // A premium that reads 0 whatever the book does would make a standing basis read as fresh, so these rows stay out.
            if !order_book_perpetual(&row) || row.category == RWA {
                continue;
            }
            let Some(stats) = row.market_stats else {
                continue;
            };

            let next_funding_at = if stats.next_funding_rate >= MIN_UNIX_MS { stats.next_funding_rate as i64 } else { 0 };
            rows.insert(
                row.name,
                AnchorRow {
                    index: stats.index_price,
                    mark: stats.mark_price,
                    funding_rate: stats.funding_rate,
                    funding_interval_hours: FUNDING_INTERVAL_HOURS,
                    next_funding_at,
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

// Crypto order book markets read index and mark from Stork's nodes.
#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct Stats {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // the running rate for the coming settlement, a fraction per hour
    #[serde(default, deserialize_with = "wire::num")]
    next_funding_rate: f64, // Unix ms of the next whole hour, despite its name
}

#[cfg(test)]
mod tests {
    use super::super::markets::tests::{aia, btc, mkr, spx};
    use super::*;
    use crate::feeds::anchor_poller::RateLimited;
    use crate::venues::testing::{MockRest, http, market, tracked};
    use serde_json::{Value, json};

    const NEXT_HOUR: i64 = 1_791_846_000_000; // 2026-10-12 23:00 UTC

    fn markets() -> Vec<TrackedMarket> {
        tracked(&[market("extended", "BTC-USD", "BTC", "USDC", true), market("extended", "SPX500m-USD", "SPX500M", "USDC", true)])
    }

    const PATH: &str = "/api/v1/info/markets?market=BTC-USD&market=SPX500m-USD";

    fn reply(rows: Value) -> Value {
        json!({ "status": "OK", "data": rows })
    }

    async fn poll(rest: &MockRest) -> anyhow::Result<AnchorMap> {
        Extended::with_rest(&markets(), &rest.url).fetch_round(&http(), NEXT_HOUR - 1_800_000).await
    }

    #[test]
    fn names_each_tracked_market_in_the_query() {
        assert_eq!(query(&markets()), "?market=BTC-USD&market=SPX500m-USD");
        assert_eq!(query(&[]), "");
    }

    #[test]
    fn polls_every_second_and_pauses_a_minute_on_a_rate_limit() {
        let venue = Extended::new(&markets());

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(60));
    }

    #[tokio::test]
    async fn reads_index_mark_and_the_running_rate_with_an_hourly_interval_and_the_next_hour() {
        let rest = MockRest::start().await;
        rest.reply(PATH, reply(json!([btc()])));

        let rows = poll(&rest).await.unwrap();

        assert_eq!(rest.calls(), [PATH]);
        assert_eq!(
            rows["BTC-USD"],
            AnchorRow {
                index: 82506.324605325004,
                mark: 82468.428314499993,
                funding_rate: 0.000013,
                funding_interval_hours: 1.0,
                next_funding_at: NEXT_HOUR,
                ts: None,
            }
        );
    }

    #[tokio::test]
    async fn leaves_out_an_rwa_market_an_rfq_market_and_a_market_not_active() {
        let rest = MockRest::start().await;
        rest.reply(PATH, reply(json!([spx(), aia(), mkr(), btc()])));

        let rows = poll(&rest).await.unwrap();

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTC-USD"]);
    }

    #[tokio::test]
    async fn leaves_out_a_row_with_no_stats() {
        let rest = MockRest::start().await;
        let mut row = btc();
        row.as_object_mut().unwrap().remove("marketStats");
        rest.reply(PATH, reply(json!([row])));

        assert!(poll(&rest).await.unwrap().is_empty());
    }

    // An unknown next settlement is 0 under decision 20, and a row with no index is sent as NaN for the poller to count as missing.
    #[tokio::test]
    async fn sends_0_for_a_next_settlement_in_seconds_or_missing_and_nan_for_a_missing_index() {
        let rest = MockRest::start().await;
        let mut seconds = btc();
        seconds["marketStats"]["nextFundingRate"] = json!(1791846000);
        seconds["marketStats"].as_object_mut().unwrap().remove("indexPrice");
        rest.reply(PATH, reply(json!([seconds])));

        let rows = poll(&rest).await.unwrap();

        assert_eq!(rows["BTC-USD"].next_funding_at, 0);
        assert!(rows["BTC-USD"].index.is_nan());

        let mut missing = btc();
        missing["marketStats"].as_object_mut().unwrap().remove("nextFundingRate");
        rest.reply(PATH, reply(json!([missing])));
        assert_eq!(poll(&rest).await.unwrap()["BTC-USD"].next_funding_at, 0);
    }

    // The live answer to a query naming a market the venue does not list, on 2026-10-12.
    #[tokio::test]
    async fn fails_the_round_on_an_error_status_and_on_a_reply_that_is_not_ok() {
        let rest = MockRest::start().await;
        rest.fail(PATH, 400);

        assert!(poll(&rest).await.is_err());

        rest.reply(PATH, json!({ "status": "ERROR", "error": { "code": 1001, "message": "Market not found" } }));
        assert!(poll(&rest).await.is_err());
    }

    #[tokio::test]
    async fn a_rate_limit_status_reaches_the_poller_as_rate_limited() {
        let rest = MockRest::start().await;
        rest.fail(PATH, 429);

        let error = poll(&rest).await.unwrap_err();

        assert!(error.downcast_ref::<RateLimited>().is_some(), "{error:#}");
    }
}
