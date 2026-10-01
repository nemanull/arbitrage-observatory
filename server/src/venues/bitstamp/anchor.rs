use super::{Bitstamp, ID};
use crate::clock::now_ms;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::{HashMap, HashSet};

// One call carries index and mark for every market, spot rows included.
const TICKER_PATH: &str = "/api/v2/ticker/";

// Funding has no bulk call, and every market each second would be 12,000 requests per 10 minutes against a limit of 10,000.
// One market per round keeps the poller at two requests a second, while a rate changed at most 11 times in 201 s.
const FUNDING_PATH: &str = "/api/v2/funding_rate/";

// No interval field exists, and every perpetual settles every 8 hours.
const FUNDING_INTERVAL_HOURS: f64 = 8.0;

#[derive(Default)]
pub struct Funding {
    readings: HashMap<String, (f64, i64)>, // raw id to (rate, next settlement in Unix ms)
    warned: HashSet<String>,
    next: usize, // position in the tracked list of the next funding read
}

impl AnchorVenue for Bitstamp {
    async fn fetch_round(&self, http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let ticker_url = format!("{}{TICKER_PATH}", self.rest);
        let tickers = async {
            let tickers: Vec<Ticker> = get_json(http, &ticker_url).await?;
            anyhow::Ok((tickers, now_ms()))
        };
        let (tickers, ()) = tokio::join!(tickers, self.read_funding(http));
        let (tickers, arrived_at) = tickers?;

        let funding = self.funding.lock().unwrap();
        let mut rows = AnchorMap::new();
        for ticker in tickers {
            if ticker.market_type != "PERPETUAL" {
                continue;
            }

            // The ticker spells the market "BTC/USD-PERP", and the socket's id is "btcusd-perp".
            let raw_market_id = ticker.market.replace('/', "").to_lowercase();
            let Some(&(rate, next_funding_at)) = funding.readings.get(&raw_market_id) else {
                continue;
            };

            rows.insert(
                raw_market_id,
                AnchorRow {
                    index: ticker.index_price,
                    mark: ticker.mark_price,
                    funding_rate: rate,
                    funding_interval_hours: FUNDING_INTERVAL_HOURS,
                    next_funding_at,
                    // The edge served cached replies in under 20 ms, so arrival says nothing about the numbers' age and only caps the ticker's own second.
                    ts: Some(((ticker.timestamp * 1_000.0) as i64).min(arrived_at)),
                },
            );
        }

        Ok(rows)
    }
}

impl Bitstamp {
    // A market keeps its last reading until its turn comes again, and one that never answers stays out of the rows.
    async fn read_funding(&self, http: &reqwest::Client) {
        if self.markets.is_empty() {
            return;
        }

        let raw_market_id = {
            let mut funding = self.funding.lock().unwrap();
            let raw_market_id = self.markets[funding.next % self.markets.len()].clone();
            funding.next = (funding.next + 1) % self.markets.len();
            raw_market_id
        };

        let url = format!("{}{FUNDING_PATH}{raw_market_id}/", self.rest);
        match get_json::<FundingRate>(http, &url).await {
            Ok(reply) => {
                let reading = (reply.funding_rate, (reply.next_funding_time * 1_000.0) as i64);
                self.funding.lock().unwrap().readings.insert(raw_market_id, reading);
            }
            Err(error) => {
                let mut funding = self.funding.lock().unwrap();
                if funding.warned.insert(raw_market_id.clone()) {
                    tracing::warn!(event = "funding_read_failed", venue = ID, market = %raw_market_id, error = format!("{error:#}"));
                }
            }
        }
    }
}

// Every number is a decimal string.
#[derive(Deserialize)]
struct Ticker {
    #[serde(default)]
    market: String, // "BTC/USD-PERP", which is not the socket's id
    #[serde(default)]
    market_type: String, // "PERPETUAL" or "SPOT"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    timestamp: f64, // Unix seconds of the venue's last republish, about every 2 s
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    index_price: f64, // absent on spot rows
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    mark_price: f64,
}

#[derive(Deserialize)]
struct FundingRate {
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    funding_rate: f64, // a fraction per 8 hour interval, the running rate for the upcoming settlement
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_funding_time: f64, // Unix seconds
}

#[cfg(test)]
mod tests {
    // Ported case for case from old_ts_server/src/venues/bitstamp/anchor.spec.ts.
    // The Nest spec froze the clock, and these cases read it instead, stamping each ticker relative to now.

    use super::*;
    use crate::test_log::capture;
    use crate::venues::testing::{MockRest, http, market, tracked};
    use serde_json::{Value, json};
    use std::time::Duration;

    const TICKER: &str = "/api/v2/ticker/";

    fn funding_path(raw_market_id: &str) -> String {
        format!("/api/v2/funding_rate/{raw_market_id}/")
    }

    // Rows captured live on 2026-09-15, cut down to the fields the poller reads plus a few it ignores, restamped at `second`.
    fn tickers(second: i64) -> Value {
        let second = second.to_string();
        json!([
            { "timestamp": second, "last": "75906.23", "bid": "75906.22", "ask": "75906.23", "market_type": "SPOT", "pair": "BTC/USD", "market": "BTC/USD" },
            {
                "timestamp": second, "last": "2407.6", "market_type": "PERPETUAL", "pair": "ETH/USD-PERP", "market": "ETH/USD-PERP",
                "index_price": "2407.3460000000005", "mark_price": "2408.04888561", "open_interest": "1786.142",
            },
            {
                "timestamp": second, "last": "0.67510", "market_type": "PERPETUAL", "pair": "ASTER/USD-PERP", "market": "ASTER/USD-PERP",
                "index_price": "0.6763", "mark_price": "0.67689281", "open_interest": "712841",
            },
            {
                "timestamp": "1789505352", "market_type": "PERPETUAL", "pair": "BTC/USD-PERP", "market": "BTC/USD-PERP",
                "index_price": "75871.12066666665", "mark_price": "75895.30133771",
            },
        ])
    }

    fn funding(market: &str, rate: &str) -> Value {
        json!({ "funding_rate": rate, "timestamp": "1789505678", "market": market, "next_funding_time": "1789516800" })
    }

    fn reply_funding(rest: &MockRest) {
        rest.reply(&funding_path("ethusd-perp"), funding("ETH/USD-PERP", "0.000026"));
        rest.reply(&funding_path("asterusd-perp"), funding("ASTER/USD-PERP", "0.00001"));
        rest.reply(&funding_path("btcusd-perp"), funding("BTC/USD-PERP", "0.000253"));
    }

    fn poller(rest: &MockRest, raw_market_ids: &[&str]) -> Bitstamp {
        let mut markets = Vec::new();
        for id in raw_market_ids {
            markets.push(market(ID, id, &id[..id.find("usd").unwrap()].to_uppercase(), "USD", true));
        }
        Bitstamp::with_rest(&tracked(&markets), &rest.url)
    }

    // A second just behind our clock, as the venue republishes about every 2 s.
    fn recent() -> i64 {
        now_ms() / 1_000 - 1
    }

    fn keys(rows: &AnchorMap) -> Vec<&str> {
        let mut keys: Vec<&str> = rows.keys().map(String::as_str).collect();
        keys.sort();
        keys
    }

    #[test]
    fn polls_every_second() {
        assert_eq!(Bitstamp::new(&[]).poll_every(), Duration::from_secs(1));
    }

    #[tokio::test]
    async fn maps_a_perpetual_ticker_onto_the_id_the_socket_uses_with_funding_from_its_own_call() {
        let rest = MockRest::start().await;
        let second = recent();
        rest.reply(TICKER, tickers(second));
        reply_funding(&rest);

        let rows = poller(&rest, &["ethusd-perp"]).fetch_round(&http(), 0).await.unwrap();

        assert_eq!(
            rows["ethusd-perp"],
            AnchorRow {
                index: 2407.3460000000005,
                mark: 2408.04888561,
                funding_rate: 0.000026,
                funding_interval_hours: 8.0,
                next_funding_at: 1_789_516_800_000,
                ts: Some(second * 1_000),
            }
        );
    }

    #[tokio::test]
    async fn ignores_spot_rows_that_share_the_ticker_reply() {
        let rest = MockRest::start().await;
        rest.reply(TICKER, tickers(recent()));
        reply_funding(&rest);

        let rows = poller(&rest, &["ethusd-perp"]).fetch_round(&http(), 0).await.unwrap();

        assert_eq!(keys(&rows), ["ethusd-perp"]);
    }

    #[tokio::test]
    async fn reads_one_funding_market_per_round_in_rotation_and_writes_a_market_only_once_its_funding_landed() {
        let rest = MockRest::start().await;
        rest.reply(TICKER, tickers(recent()));
        reply_funding(&rest);
        let venue = poller(&rest, &["ethusd-perp", "asterusd-perp", "btcusd-perp"]);

        let first = venue.fetch_round(&http(), 0).await.unwrap();
        let second = venue.fetch_round(&http(), 0).await.unwrap();
        let third = venue.fetch_round(&http(), 0).await.unwrap();
        venue.fetch_round(&http(), 0).await.unwrap();

        assert_eq!(keys(&first), ["ethusd-perp"]);
        assert_eq!(keys(&second), ["asterusd-perp", "ethusd-perp"]);
        assert_eq!(keys(&third), ["asterusd-perp", "btcusd-perp", "ethusd-perp"]);
        let reads: Vec<String> = rest.calls().into_iter().filter(|call| call != TICKER).collect();
        assert_eq!(
            reads,
            [funding_path("ethusd-perp"), funding_path("asterusd-perp"), funding_path("btcusd-perp"), funding_path("ethusd-perp")]
        );
    }

    #[tokio::test]
    async fn stamps_a_row_with_the_ticker_second_capped_at_the_reply_arrival() {
        let rest = MockRest::start().await;
        // The venue's clock runs 100 s ahead of ours here, so the ticker second lies after arrival.
        rest.reply(TICKER, tickers(now_ms() / 1_000 + 100));
        reply_funding(&rest);
        let venue = poller(&rest, &["ethusd-perp", "btcusd-perp"]);
        venue.fetch_round(&http(), 0).await.unwrap();

        let before = now_ms();
        let rows = venue.fetch_round(&http(), 0).await.unwrap();
        let after = now_ms();

        let capped = rows["ethusd-perp"].ts.unwrap();
        assert!(before <= capped && capped <= after, "{before} <= {capped} <= {after}");
        assert_eq!(rows["btcusd-perp"].ts, Some(1_789_505_352_000));
    }

    #[tokio::test]
    async fn leaves_out_a_market_whose_funding_call_fails_logs_it_once_and_keeps_the_round() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(TICKER, tickers(recent()));
        rest.reply(&funding_path("ethusd-perp"), funding("ETH/USD-PERP", "0.000026"));
        let venue = poller(&rest, &["ethusd-perp", "asterusd-perp"]);

        for _ in 0..4 {
            let rows = venue.fetch_round(&http(), 0).await.unwrap();
            assert_eq!(keys(&rows), ["ethusd-perp"]);
        }

        let warnings = logs.events("funding_read_failed");
        assert_eq!(warnings.len(), 1);
        assert_eq!(warnings[0].text("market"), "asterusd-perp");
        assert!(warnings[0].text("error").contains("404"), "{:?}", warnings[0]);
    }

    #[tokio::test]
    async fn fails_the_round_when_the_ticker_call_fails() {
        let rest = MockRest::start().await;
        reply_funding(&rest);

        let error = poller(&rest, &["ethusd-perp"]).fetch_round(&http(), 0).await.unwrap_err();

        assert!(error.to_string().contains(&format!("404 Not Found from {}{TICKER}", rest.url)), "{error:#}");
    }
}
