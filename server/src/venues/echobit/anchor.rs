use super::{Echobit, ID};
use crate::feeds::anchor_poller::{AnchorMap, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::time::{Duration, Instant};

// The website's own call, undocumented, with the funding of all 200 rows in about 33 KB.
// The documented bulk source is the fund_rates channel on another socket, which the feed's one plan per market cannot hold.
pub const FUNDING_PATH: &str = "/mainapi/contract/fund/rates";

// The predicted rate moves over minutes, so the table is reread every 10 s, 6 of the documented 1,200 GET a minute.
const FUNDING_REFRESH_MS: i64 = 10_000;

// The call took 135 to 850 ms, and a slow read must not hold back the socket rows of the round.
const FUNDING_TIMEOUT: Duration = Duration::from_secs(3);

const HOUR_MS: f64 = 3_600_000.0;

// The documented intervals are 1, 2, 4 and 8 h, and AAPL ran on 12 h in September 2026.
const MAX_INTERVAL_HOURS: f64 = 24.0;
const FAILURE_LOG_EVERY: u64 = 30;

// Every mark and index arrived within a few seconds of the subscribes, since the index kline pushes about once a second and the mark about every 2 s.
const WARMUP: Duration = Duration::from_secs(15);

#[derive(Default)]
pub struct Funding {
    read_at: i64, // Unix ms of the last attempt, 0 = never
    has_read: bool,
    failures: u64, // consecutive failed reads
}

// No call carries mark or index in bulk, so the book sockets subscribe each market's mark and index klines and handle fills the rows.
// A round makes a request only when the funding table is due.
// The 60 s rate limit pause stays, since the documented window is 60 s and no Retry-After was seen.
impl AnchorVenue for Echobit {
    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let (due, has_read) = {
            let mut funding = self.funding.lock().unwrap();
            let due = ts - funding.read_at >= FUNDING_REFRESH_MS;
            if due {
                funding.read_at = ts;
            }
            (due, funding.has_read)
        };

        if due {
            let read = match tokio::time::timeout(FUNDING_TIMEOUT, self.read_funding(http)).await {
                Ok(read) => read,
                Err(_) => Err(anyhow::anyhow!("funding read timed out after {FUNDING_TIMEOUT:?}")),
            };
            let mut funding = self.funding.lock().unwrap();
            match read {
                Ok((kept, missing)) => {
                    if !funding.has_read || funding.failures > 0 {
                        tracing::info!(event = "funding_read", venue = ID, markets = kept, missing, after_failures = funding.failures);
                    }
                    funding.has_read = true;
                    funding.failures = 0;
                }
                // With no table yet no row can be complete, so the round fails and the next round tries again.
                Err(error) if !has_read => return Err(error),
                // The rows keep the last funding, which moves over minutes.
                Err(error) => {
                    funding.failures += 1;
                    if funding.failures == 1 || funding.failures % FAILURE_LOG_EVERY == 0 {
                        tracing::warn!(event = "funding_read_failed", venue = ID, failures = funding.failures, error = format!("{error:#}"));
                    }
                }
            }
        }

        let rows = self.anchors.rows();

        // The first rounds run before the sockets open, and a round that fails whole logs one line where 126 missing rows would log one each.
        let first_round = *self.first_round.get_or_init(Instant::now);
        if rows.len() < self.markets.len() && first_round.elapsed() < WARMUP {
            anyhow::bail!("warming up, {} of {} markets have their mark, index and funding", rows.len(), self.markets.len());
        }

        Ok(rows)
    }
}

impl Echobit {
    // Writes the funding of every tracked market the reply names, and returns how many it wrote and how many it lacked.
    async fn read_funding(&self, http: &reqwest::Client) -> anyhow::Result<(usize, usize)> {
        let url = format!("{}{FUNDING_PATH}", self.web);
        let reply: Reply = get_json(http, &url).await?;
        if reply.code != "0" {
            anyhow::bail!("{ID} funding call answered code {}: {}", reply.code, reply.msg);
        }

        let mut kept = 0;
        for row in &reply.data {
            if !self.markets.contains(&row.symbol_id) {
                continue;
            }

            // No interval field exists, and the gap between the last and the next settlement read 4 h or 8 h.
            // A row without both times, or whose gap is no plausible interval, as a settleTime of 0 would give, is kept out.
            let mut interval_hours = (row.next_settle_time - row.settle_time) / HOUR_MS;
            if !(interval_hours > 0.0 && interval_hours <= MAX_INTERVAL_HOURS) {
                interval_hours = f64::NAN;
            }
            let next_funding_at = if row.next_settle_time.is_finite() { row.next_settle_time as i64 } else { 0 };
            self.anchors.set_funding(&row.symbol_id, row.fund_rate, interval_hours, next_funding_at);
            kept += 1;
        }

        Ok((kept, self.markets.len().saturating_sub(kept)))
    }
}

#[derive(Deserialize)]
struct Reply {
    #[serde(default)]
    code: String, // "0"
    #[serde(default)]
    msg: String,
    #[serde(default)]
    data: Vec<Rate>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
struct Rate {
    #[serde(default)]
    symbol_id: String, // "BTC-SWAP-USDT"
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    fund_rate: f64, // the predicted rate for nextSettleTime, a fraction per interval
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    settle_time: f64, // Unix ms of the last settlement
    #[serde(default = "wire::nan", deserialize_with = "wire::num")]
    next_settle_time: f64, // Unix ms
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::cluster::Market;
    use crate::feeds::anchor_poller::AnchorRow;
    use crate::feeds::venue_feed::{BookVenue, Connection};
    use crate::test_log::capture;
    use crate::venues::echobit::State;
    use crate::venues::testing::{self, MockRest, http};
    use serde_json::{Value, json};
    use std::sync::OnceLock;

    const T0: i64 = 1_791_573_948_202; // 2026-10-09 19:25:48.202 UTC

    fn market(raw_market_id: &str) -> Market {
        let base = raw_market_id.split('-').next().unwrap();
        testing::market(ID, raw_market_id, base, "USDT", true)
    }

    fn venue(rest: &MockRest, raw_market_ids: &[&str]) -> Echobit {
        let markets: Vec<Market> = raw_market_ids.iter().map(|id| market(id)).collect();
        Echobit::with_web(&testing::tracked(&markets), &rest.url)
    }

    fn connection() -> Connection<State> {
        Connection::for_test("echobit#swap#0", vec![market("BTC-SWAP-USDT"), market("XAU-SWAP-USDT")])
    }

    // Pushes captured live on 2026-10-09.
    fn mark(symbol: &str, close: &str) -> Value {
        json!({"data":[{"c":close,"h":"82467.5","l":"82439.6","o":"82472.5","s":symbol,"sn":symbol,"t":1791573900000_i64,"v":"0"}],"id":format!("markKline_1m.{symbol}"),"params":{"klineType":"1m","realtimeInterval":"24h"},"sendTime":1791573948202_i64,"symbol":symbol,"topic":"markKline"})
    }

    fn index(symbol: &str, close: &str) -> Value {
        json!({"data":[{"c":close,"h":"82506","l":"82472.5","o":"82506","s":symbol,"sn":symbol,"t":1791573900000_i64,"v":"0"}],"id":format!("indexKline_1m.{symbol}"),"params":{"klineType":"1m","realtimeInterval":"24h"},"sendTime":1791573948202_i64,"symbol":symbol,"symbolName":symbol,"topic":"indexKline"})
    }

    // Rows captured live on 2026-10-09, BTC on 8 h, XAU on 4 h, and a hidden row.
    fn rates() -> Value {
        json!({"msg":"success","code":"0","data":[
            {"symbolId":"BTC-SWAP-USDT","currentTime":"1791573687021","settleTime":1791547200000_i64,"settleRate":"-0.00000015042895552","nextSettleTime":1791576000000_i64,"fundRate":"-0.000003239193129293"},
            {"symbolId":"XAU-SWAP-USDT","currentTime":"1791573687021","settleTime":1791561600000_i64,"settleRate":"0.00000637","nextSettleTime":1791576000000_i64,"fundRate":"0.0"},
            {"symbolId":"SHIB-SWAP-USDT","currentTime":"1791573687021","settleTime":1791561600000_i64,"settleRate":"-0.02","nextSettleTime":1791576000000_i64,"fundRate":"-0.02"},
        ]})
    }

    fn feed(venue: &Echobit, conn: &mut Connection<State>, frame: Value, at: i64) {
        venue.handle_at(frame.to_string().as_bytes(), conn, at).unwrap();
    }

    fn fill(venue: &Echobit, conn: &mut Connection<State>) {
        feed(venue, conn, mark("BTCUSDT", "82439.6"), T0 - 900);
        feed(venue, conn, index("BTCUSDT", "82474.8"), T0 - 400);
        feed(venue, conn, mark("XAUUSDT", "4012.5"), T0 - 300);
        feed(venue, conn, index("XAUUSDT", "4013.1"), T0 - 200);
    }

    fn keys(rows: &AnchorMap) -> Vec<&str> {
        let mut keys: Vec<&str> = rows.keys().map(String::as_str).collect();
        keys.sort();
        keys
    }

    #[test]
    fn polls_every_second_and_pauses_a_minute_on_a_rate_limit() {
        let venue = Echobit::new(&[]);
        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(60));
    }

    #[tokio::test]
    async fn a_market_is_anchored_from_its_klines_and_the_funding_table() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_PATH, rates());
        let venue = venue(&rest, &["BTC-SWAP-USDT", "XAU-SWAP-USDT"]);
        let mut conn = connection();
        fill(&venue, &mut conn);

        let rows = venue.fetch_round(&http(), T0).await.unwrap();

        assert_eq!(keys(&rows), ["BTC-SWAP-USDT", "XAU-SWAP-USDT"]);
        assert_eq!(
            rows["BTC-SWAP-USDT"],
            AnchorRow {
                index: 82474.8,
                mark: 82439.6,
                funding_rate: -0.000003239193129293,
                funding_interval_hours: 8.0,
                next_funding_at: 1_791_576_000_000,
                ts: Some(T0 - 900),
            }
        );
        assert_eq!(rows["XAU-SWAP-USDT"].funding_interval_hours, 4.0);
        assert_eq!(rows["XAU-SWAP-USDT"].funding_rate, 0.0);
    }

    #[tokio::test]
    async fn the_funding_table_is_read_at_most_every_10_seconds() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_PATH, rates());
        let venue = venue(&rest, &["BTC-SWAP-USDT"]);

        for offset in [0, 1_000, 9_999, 10_000, 15_000, 20_000] {
            let _ = venue.fetch_round(&http(), T0 + offset).await;
        }

        assert_eq!(rest.calls().len(), 3);
    }

    #[tokio::test]
    async fn a_round_fails_while_the_funding_table_was_never_read() {
        let rest = MockRest::start().await;
        rest.fail(FUNDING_PATH, 500);
        let venue = venue(&rest, &["BTC-SWAP-USDT"]);
        let mut conn = connection();
        fill(&venue, &mut conn);

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();

        assert!(error.to_string().contains("500"), "{error:#}");
    }

    #[tokio::test]
    async fn a_failed_reread_keeps_the_last_funding_and_logs_once() {
        let (logs, _capture) = capture();
        let rest = MockRest::start().await;
        rest.reply(FUNDING_PATH, rates());
        let venue = venue(&rest, &["BTC-SWAP-USDT"]);
        let mut conn = connection();
        fill(&venue, &mut conn);
        venue.fetch_round(&http(), T0).await.unwrap();

        rest.fail(FUNDING_PATH, 500);
        for round in 1..=3 {
            let rows = venue.fetch_round(&http(), T0 + round * FUNDING_REFRESH_MS).await.unwrap();
            assert_eq!(rows["BTC-SWAP-USDT"].funding_rate, -0.000003239193129293);
        }

        assert_eq!(logs.events("funding_read_failed").len(), 1);
        assert_eq!(logs.events("funding_read").len(), 1);
    }

    #[tokio::test]
    async fn a_funding_call_answering_an_error_code_fails_the_first_round() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_PATH, json!({"msg":"system error","code":"-1","data":[]}));
        let venue = venue(&rest, &["BTC-SWAP-USDT"]);

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();

        assert_eq!(error.to_string(), "echobit funding call answered code -1: system error");
    }

    #[tokio::test]
    async fn only_tracked_markets_get_funding_so_a_hidden_row_never_shows() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_PATH, rates());
        let venue = venue(&rest, &["BTC-SWAP-USDT"]);
        let mut conn = connection();
        fill(&venue, &mut conn);

        let rows = venue.fetch_round(&http(), T0).await.unwrap();

        assert_eq!(keys(&rows), ["BTC-SWAP-USDT"]);
    }

    #[tokio::test]
    async fn a_funding_row_without_its_settlement_times_keeps_the_market_out() {
        let rest = MockRest::start().await;
        let mut reply = rates();
        reply["data"][0].as_object_mut().unwrap().remove("settleTime");
        rest.reply(FUNDING_PATH, reply);
        let mut venue = venue(&rest, &["BTC-SWAP-USDT", "XAU-SWAP-USDT"]);
        venue.first_round = OnceLock::from(Instant::now() - WARMUP);
        let mut conn = connection();
        fill(&venue, &mut conn);

        let rows = venue.fetch_round(&http(), T0).await.unwrap();

        assert_eq!(keys(&rows), ["XAU-SWAP-USDT"]);
    }

    #[tokio::test]
    async fn a_funding_row_whose_settlement_gap_is_no_interval_keeps_the_market_out() {
        let rest = MockRest::start().await;
        let mut reply = rates();
        reply["data"][0]["settleTime"] = json!(0);
        reply["data"][1]["settleTime"] = reply["data"][1]["nextSettleTime"].clone();
        rest.reply(FUNDING_PATH, reply);
        let mut venue = venue(&rest, &["BTC-SWAP-USDT", "XAU-SWAP-USDT"]);
        venue.first_round = OnceLock::from(Instant::now() - WARMUP);
        let mut conn = connection();
        fill(&venue, &mut conn);

        assert!(venue.fetch_round(&http(), T0).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_round_fails_whole_until_every_market_is_anchored_or_the_warmup_ends() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_PATH, rates());
        let mut venue = venue(&rest, &["BTC-SWAP-USDT", "XAU-SWAP-USDT"]);
        let mut conn = connection();
        feed(&venue, &mut conn, mark("BTCUSDT", "82439.6"), T0);
        feed(&venue, &mut conn, index("BTCUSDT", "82474.8"), T0);

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();
        assert_eq!(error.to_string(), "warming up, 1 of 2 markets have their mark, index and funding");

        venue.first_round = OnceLock::from(Instant::now() - WARMUP);
        let rows = venue.fetch_round(&http(), T0).await.unwrap();
        assert_eq!(keys(&rows), ["BTC-SWAP-USDT"]);
    }

    #[tokio::test]
    async fn ts_is_the_older_arrival_of_the_mark_and_the_index_so_a_dead_socket_ages_its_rows() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_PATH, rates());
        let venue = venue(&rest, &["BTC-SWAP-USDT"]);
        let mut conn = connection();
        feed(&venue, &mut conn, mark("BTCUSDT", "82439.6"), T0);
        feed(&venue, &mut conn, index("BTCUSDT", "82474.8"), T0 + 1_000);
        feed(&venue, &mut conn, index("BTCUSDT", "82475.3"), T0 + 2_000);

        let rows = venue.fetch_round(&http(), T0 + 60_000).await.unwrap();

        assert_eq!(rows["BTC-SWAP-USDT"].ts, Some(T0));
        assert_eq!(rows["BTC-SWAP-USDT"].index, 82475.3);
    }

    #[tokio::test]
    async fn handle_stamps_the_mark_and_the_index_with_the_frame_arrival_not_the_candle_open() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_PATH, rates());
        let venue = venue(&rest, &["BTC-SWAP-USDT"]);
        let mut conn = connection();

        for frame in [mark("BTCUSDT", "82439.6"), index("BTCUSDT", "82474.8")] {
            venue.handle(frame.to_string().as_bytes(), &mut conn).unwrap();
        }

        let rows = venue.fetch_round(&http(), T0).await.unwrap();
        assert_eq!(rows["BTC-SWAP-USDT"].ts, Some(conn.frame_recv_ts()));
    }

    #[tokio::test]
    async fn the_first_mark_push_with_empty_data_and_a_kline_of_an_untracked_index_change_nothing() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_PATH, rates());
        let mut venue = venue(&rest, &["BTC-SWAP-USDT"]);
        venue.first_round = OnceLock::from(Instant::now() - WARMUP);
        let mut conn = connection();
        let mut empty = mark("BTCUSDT", "82439.6");
        empty["data"] = json!([]);

        feed(&venue, &mut conn, empty, T0);
        feed(&venue, &mut conn, index("BTCUSDT", "82474.8"), T0);
        feed(&venue, &mut conn, mark("ETHUSDT", "2400.1"), T0);

        assert!(venue.fetch_round(&http(), T0).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn an_unparsable_close_keeps_the_market_out() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_PATH, rates());
        let mut venue = venue(&rest, &["BTC-SWAP-USDT"]);
        venue.first_round = OnceLock::from(Instant::now() - WARMUP);
        let mut conn = connection();
        feed(&venue, &mut conn, mark("BTCUSDT", "82439.6"), T0);

        feed(&venue, &mut conn, index("BTCUSDT", ""), T0);

        assert!(venue.fetch_round(&http(), T0).await.unwrap().is_empty());
    }
}
