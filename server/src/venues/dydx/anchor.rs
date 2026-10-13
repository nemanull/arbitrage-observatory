use super::Dydx;
use super::markets::{ACTIVE, MARKETS_PATH, Reply};
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, RateLimited, get_json};
use std::time::Duration;

// dYdX marks every position at its oracle price, which is the index, so the venue has no mark of its own.
// A mark copied from the index would read every premium as fresh, so the rows send 0 and the engine refuses dYdX legs at open (decision 19).
const NO_MARK: f64 = 0.0;

// Funding settles at each whole UTC hour, the funding-tick epoch, and the reply names neither the interval nor the next settlement.
const FUNDING_INTERVAL_HOURS: f64 = 1.0;
const HOUR_MS: i64 = 3_600_000;

impl AnchorVenue for Dydx {
    // The Indexer allows 100 requests per 10 s, and Cloudflare serves about half the polls from its 1 s cache without counting them.
    // So a 1 s poll spends at most 10, and a rate limit answer with no Retry-After waits out one window.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(10)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let reply: Reply = get_json(http, &format!("{}{MARKETS_PATH}", self.rest)).await.map_err(retry_after_in_ms)?;

        // The floor plus one keeps a poll that lands on the hour pointing at the next settlement, which lands 27 to 812 ms after it.
        let next_funding_at = (ts.div_euclid(HOUR_MS) + 1) * HOUR_MS;
        let mut rows = AnchorMap::with_capacity(reply.markets.len());

        for row in reply.markets.into_values() {
            // A settled market keeps its last oracle price, which the poller would stamp as fresh.
            if row.status != ACTIVE {
                continue;
            }

            rows.insert(
                row.ticker,
                AnchorRow {
                    index: row.oracle_price,
                    mark: NO_MARK,
                    funding_rate: row.next_funding_rate,
                    funding_interval_hours: FUNDING_INTERVAL_HOURS,
                    next_funding_at,
                    ts: None,
                },
            );
        }

        Ok(rows)
    }
}

// The Indexer's 429 carries Retry-After in milliseconds, and the shared reader takes a number that small as seconds.
// So 9500, meant as 9.5 s, would pause the poller for 9,500 s, and the seconds it read are turned back into milliseconds.
fn retry_after_in_ms(error: anyhow::Error) -> anyhow::Error {
    match error.downcast::<RateLimited>() {
        Ok(limited) => RateLimited {
            retry_after: limited.retry_after.map(|read_as_seconds| Duration::from_millis(read_as_seconds.as_secs())),
            ..limited
        }
        .into(),
        Err(error) => error,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::venues::testing::{MockRest, http};
    use axum::Router;
    use axum::http::StatusCode;
    use axum::http::header::RETRY_AFTER;
    use axum::response::IntoResponse;
    use axum::routing::get;
    use serde_json::{Value, json};
    use tokio::net::TcpListener;

    // 22:53:55 UTC on 2026-10-12, so the next settlement is 23:00.
    const T0: i64 = 1_791_845_635_000;
    const NEXT_HOUR: i64 = 1_791_846_000_000;

    // Rows of GET /v4/perpetualMarkets captured live on 2026-10-12 at 22:53 UTC, cut to four of 296 and to a few of their fields.
    fn reply() -> Value {
        json!({ "markets": {
            "BTC-USD": {
                "clobPairId": "0", "ticker": "BTC-USD", "status": "ACTIVE", "oraclePrice": "82371.7996", "priceChange24H": "-1185.6004",
                "nextFundingRate": "0", "marketType": "CROSS", "defaultFundingRate1H": "0",
            },
            "BLUR-USD": {
                "clobPairId": "25", "ticker": "BLUR-USD", "status": "ACTIVE", "oraclePrice": "0.01453",
                "nextFundingRate": "-0.00128785416666666667", "marketType": "CROSS", "defaultFundingRate1H": "0",
            },
            "PEPE-USD": {
                "clobPairId": "28", "ticker": "PEPE-USD", "status": "ACTIVE", "oraclePrice": "0.0000039766738366",
                "nextFundingRate": "0", "marketType": "CROSS",
            },
            "MATIC-USD": {
                "clobPairId": "3", "ticker": "MATIC-USD", "status": "FINAL_SETTLEMENT", "oraclePrice": "0.3932407381",
                "nextFundingRate": "0", "marketType": "CROSS",
            },
        } })
    }

    async fn poll(rest: &MockRest, ts: i64) -> anyhow::Result<AnchorMap> {
        Dydx::with_rest(&rest.url).fetch_round(&http(), ts).await
    }

    #[test]
    fn polls_every_second_and_pauses_one_ten_second_window_on_a_rate_limit() {
        let venue = Dydx::new();

        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(10));
    }

    #[tokio::test]
    async fn maps_the_oracle_as_index_with_no_mark_and_the_hourly_estimate_due_at_the_next_whole_hour() {
        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, reply());

        let rows = poll(&rest, T0).await.unwrap();

        assert_eq!(rest.calls(), [MARKETS_PATH]);
        assert_eq!(
            rows["BTC-USD"],
            AnchorRow {
                index: 82371.7996,
                mark: 0.0,
                funding_rate: 0.0,
                funding_interval_hours: 1.0,
                next_funding_at: NEXT_HOUR,
                ts: None,
            }
        );
        assert_eq!(rows["BLUR-USD"].funding_rate, -0.00128785416666666667);
        assert_eq!(rows["PEPE-USD"].index, 0.0000039766738366);
        assert!(rows.values().all(|row| row.mark == 0.0));
    }

    #[tokio::test]
    async fn leaves_out_a_market_in_final_settlement() {
        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, reply());

        let rows = poll(&rest, T0).await.unwrap();

        let mut tickers: Vec<&String> = rows.keys().collect();
        tickers.sort();
        assert_eq!(tickers, ["BLUR-USD", "BTC-USD", "PEPE-USD"]);
    }

    #[tokio::test]
    async fn a_poll_on_the_hour_points_at_the_next_hour() {
        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, reply());

        let on_the_hour = poll(&rest, NEXT_HOUR).await.unwrap();
        let just_before = poll(&rest, NEXT_HOUR - 1).await.unwrap();

        assert_eq!(on_the_hour["BTC-USD"].next_funding_at, NEXT_HOUR + HOUR_MS);
        assert_eq!(just_before["BTC-USD"].next_funding_at, NEXT_HOUR);
    }

    // The poller counts a NaN index as a missing row and refuses a NaN rate, so one odd row cannot fail the round.
    #[tokio::test]
    async fn sends_an_empty_or_missing_oracle_and_rate_as_nan() {
        let rest = MockRest::start().await;
        let mut odd = reply();
        odd["markets"]["BTC-USD"]["oraclePrice"] = json!("");
        odd["markets"]["BLUR-USD"].as_object_mut().unwrap().remove("nextFundingRate");
        rest.reply(MARKETS_PATH, odd);

        let rows = poll(&rest, T0).await.unwrap();

        assert!(rows["BTC-USD"].index.is_nan());
        assert!(rows["BLUR-USD"].funding_rate.is_nan());
        assert_eq!(rows["PEPE-USD"].index, 0.0000039766738366);
    }

    #[tokio::test]
    async fn fails_the_round_on_an_error_status_or_a_body_that_is_no_reply() {
        let rest = MockRest::start().await;
        rest.fail(MARKETS_PATH, 500);
        assert!(poll(&rest, T0).await.is_err());

        let rest = MockRest::start().await;
        rest.reply(MARKETS_PATH, json!("Just a moment..."));
        let error = poll(&rest, T0).await.unwrap_err();
        assert!(format!("{error:#}").contains("error decoding response body"), "{error:#}");
    }

    // Answers like the Indexer's rate limiter, a 429 whose Retry-After is msBeforeNext.
    async fn limited_host(retry_after: Option<&'static str>) -> String {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("http://{}", listener.local_addr().unwrap());
        let answer = move || async move {
            let body = r#"{"errors":[{"msg":"Too many requests"}]}"#;
            match retry_after {
                Some(value) => (StatusCode::TOO_MANY_REQUESTS, [(RETRY_AFTER, value)], body).into_response(),
                None => (StatusCode::TOO_MANY_REQUESTS, body).into_response(),
            }
        };
        let app = Router::new().route(MARKETS_PATH, get(answer));
        tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
        url
    }

    #[tokio::test]
    async fn reads_the_retry_after_of_a_429_as_milliseconds() {
        let url = limited_host(Some("9500")).await;

        let error = Dydx::with_rest(&url).fetch_round(&http(), T0).await.unwrap_err();

        let limited = error.downcast_ref::<RateLimited>().expect("a RateLimited error");
        assert_eq!(limited.retry_after, Some(Duration::from_millis(9_500)));
        assert_eq!(limited.url, format!("{url}{MARKETS_PATH}"));
    }

    #[tokio::test]
    async fn a_429_without_retry_after_leaves_the_pause_to_the_poller() {
        let url = limited_host(None).await;

        let error = Dydx::with_rest(&url).fetch_round(&http(), T0).await.unwrap_err();

        assert_eq!(error.downcast_ref::<RateLimited>().expect("a RateLimited error").retry_after, None);
    }
}
