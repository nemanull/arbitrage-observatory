use super::{Deepcoin, ID};
use crate::feeds::anchor_poller::{AnchorMap, AnchorVenue, get_json};
use crate::venues::wire;
use serde::Deserialize;
use std::collections::HashMap;
use std::time::{Duration, Instant};

// The interval of every USDT perpetual in one reply, keyed by the wire id.
pub const FUNDING_CYCLES_PATH: &str = "/deepcoin/trade/funding-rate?instType=SwapU";

// An interval changes only when the venue moves a market between 8 h and 4 h, so the table is reread every 10 minutes.
const FUNDING_CYCLES_REFRESH_MS: i64 = 10 * 60 * 1000;
// A failed reread keeps the table it has and tries again after this, so the rows the sockets fill keep flowing.
const FUNDING_CYCLES_RETRY_MS: i64 = 60 * 1000;

// Every socket had its snapshots and tickers within a few seconds of its subscribes, and a quiet ticker repeats at least every 5 s.
// The tenth socket opens 4.5 s after the first, so the rows fill well inside this.
const WARMUP: Duration = Duration::from_secs(15);

#[derive(Default)]
pub struct FundingCycles {
    hours_of: HashMap<String, f64>, // wire id to its interval in hours
    read_at: i64,                   // Unix ms, 0 = never, so the first round reads the table
}

impl FundingCycles {
    // NaN for a market the table does not name, which keeps its row out.
    pub fn interval_hours(&self, wire_id: &str) -> f64 {
        self.hours_of.get(wire_id).copied().unwrap_or(f64::NAN)
    }
}

// No REST call returns a live index, so the book sockets subscribe each market's ticker and handle fills the rows.
// A round makes a request only to reread the funding cycle table.
impl AnchorVenue for Deepcoin {
    // The window is 1 s, and no Retry-After was observed.
    fn rate_limit_pause(&self) -> Duration {
        Duration::from_secs(1)
    }

    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let (due, has_table) = {
            let cycles = self.funding_cycles.lock().unwrap();
            (ts - cycles.read_at >= FUNDING_CYCLES_REFRESH_MS, !cycles.hours_of.is_empty())
        };

        if due {
            match self.read_funding_cycles(http, ts).await {
                Ok(cycles) => {
                    tracing::info!(event = "funding_cycles_read", venue = ID, markets = cycles.hours_of.len());
                    *self.funding_cycles.lock().unwrap() = cycles;
                }
                Err(error) if has_table => {
                    tracing::warn!(event = "funding_cycles_failed", venue = ID, error = format!("{error:#}"));
                    self.funding_cycles.lock().unwrap().read_at = ts - FUNDING_CYCLES_REFRESH_MS + FUNDING_CYCLES_RETRY_MS;
                }
                // With no table yet no row can be complete, so the round fails and the next round tries again.
                Err(error) => return Err(error),
            }
        }

        let rows = self.anchors.rows();

        // The first rounds run before the sockets open, and a round that fails whole logs one line where 300 missing rows would log one each.
        let first_round = *self.first_round.get_or_init(Instant::now);
        if rows.len() < self.tracked && first_round.elapsed() < WARMUP {
            anyhow::bail!("warming up, {} of {} markets have their index, mark and funding", rows.len(), self.tracked);
        }

        Ok(rows)
    }
}

impl Deepcoin {
    async fn read_funding_cycles(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<FundingCycles> {
        let url = format!("{}{FUNDING_CYCLES_PATH}", self.rest);
        let reply: Reply = get_json(http, &url).await?;
        if reply.code != "0" {
            anyhow::bail!("{ID} funding cycle call answered code {}: {}", reply.code, reply.msg);
        }
        Ok(read_cycles(reply.data.unwrap_or_default(), ts))
    }
}

fn read_cycles(rows: Vec<Cycle>, ts: i64) -> FundingCycles {
    let mut hours_of = HashMap::with_capacity(rows.len());
    for row in rows {
        if row.settle_interval.is_finite() && row.settle_interval > 0.0 {
            hours_of.insert(row.instrument_id, row.settle_interval / 3_600.0);
        }
    }
    FundingCycles { hours_of, read_at: ts }
}

#[derive(Deserialize)]
struct Reply {
    #[serde(default)]
    code: String, // "0"
    #[serde(default)]
    msg: String,
    data: Option<Vec<Cycle>>, // null on an error
}

#[derive(Deserialize)]
struct Cycle {
    #[serde(rename = "instrumentID", default)]
    instrument_id: String, // "BTCUSDT"
    #[serde(rename = "settleInterval", default = "wire::nan", deserialize_with = "wire::num")]
    settle_interval: f64, // seconds, 28800 or 14400
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::cluster::Market;
    use crate::feeds::anchor_poller::AnchorRow;
    use crate::feeds::venue_feed::{BookVenue, Connection};
    use crate::venues::deepcoin::State;
    use crate::venues::testing::{self, MockRest, http};
    use serde_json::{Value, json};
    use std::sync::OnceLock;

    const T0: i64 = 1_791_567_930_710; // 2026-10-09 15:05:30.710 UTC
    const MT: i64 = 1_791_567_930_534; // the captured push's mt, 176 ms before T0

    fn market(raw_market_id: &str) -> Market {
        testing::market(super::super::ID, raw_market_id, "BTC", "USDT", true)
    }

    fn connection() -> Connection<State> {
        let mut conn = Connection::for_test("deepcoin#swap#0", vec![market("BTCUSDT_0.1"), market("TMFUSDT_0.01")]);
        Deepcoin::with_rest("http://unused", 0).subscribe_frames(&conn.markets().to_vec(), &mut conn.state);
        conn
    }

    // The reply captured live on 2026-10-09, cut to three rows.
    fn cycles() -> Value {
        json!({"code":"0","msg":"","data":[
            {"settleInterval":28800,"instrumentID":"BTCUSDT","nextSettleTime":1791590400},
            {"settleInterval":14400,"instrumentID":"BZUSDT","nextSettleTime":1791576000},
            {"settleInterval":28800,"instrumentID":"TMFUSDT","nextSettleTime":1791590400},
        ]})
    }

    // A TopicID 7 push captured live on 2026-10-09.
    fn ticker(index: f64, mark: f64) -> Value {
        json!({"a":"PO","m":"Success","mt":MT,"r":[{"d":{"AP1":82636.9,"BP1":82636.8,"C":124012.6,"D":index,"E":0.00016122,"F":41337.6,"H":82980.9,"I":"BTCUSDT","L":82477.0,"M":mark,"N":82636.8,"O":82839.2,"PF":1791590400,"T":111570290.0113002,"T2":1824992994.534282,"U":1791567930521_i64,"V":1349111.0,"V2":22161183.0}}],"tt":1791567930534_i64})
    }

    fn feed(venue: &Deepcoin, conn: &mut Connection<State>, frame: Value, at: i64) {
        venue.handle_at(frame.to_string().as_bytes(), conn, at).unwrap();
    }

    async fn venue_with_cycles(rest: &MockRest, tracked: usize) -> Deepcoin {
        rest.reply(FUNDING_CYCLES_PATH, cycles());
        let venue = Deepcoin::with_rest(&rest.url, tracked);
        venue.fetch_round(&http(), T0).await.unwrap();
        venue
    }

    #[test]
    fn polls_every_second_and_pauses_one_second_on_a_rate_limit() {
        let venue = Deepcoin::with_rest("http://unused", 0);
        assert_eq!(venue.poll_every(), Duration::from_secs(1));
        assert_eq!(venue.rate_limit_pause(), Duration::from_secs(1));
    }

    #[tokio::test]
    async fn a_market_is_anchored_from_its_ticker_with_the_interval_of_the_funding_cycle_table() {
        let rest = MockRest::start().await;
        let venue = venue_with_cycles(&rest, 0).await;
        let mut conn = connection();

        feed(&venue, &mut conn, ticker(82675.12, 82636.4), T0);

        assert_eq!(
            venue.fetch_round(&http(), T0 + 500).await.unwrap()["BTCUSDT_0.1"],
            AnchorRow {
                index: 82675.12,
                mark: 82636.4,
                funding_rate: 0.00016122,
                funding_interval_hours: 8.0,
                next_funding_at: 1_791_590_400_000,
                ts: Some(MT),
            }
        );
    }

    #[tokio::test]
    async fn a_ticker_before_the_table_is_read_waits_for_the_next_ticker() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_CYCLES_PATH, cycles());
        let venue = Deepcoin::with_rest(&rest.url, 0);
        let mut conn = connection();

        feed(&venue, &mut conn, ticker(82675.12, 82636.4), T0);
        assert!(venue.fetch_round(&http(), T0).await.unwrap().is_empty());

        feed(&venue, &mut conn, ticker(82674.56, 82635.8), T0 + 450);
        let rows = venue.fetch_round(&http(), T0 + 500).await.unwrap();
        assert_eq!(rows["BTCUSDT_0.1"].funding_interval_hours, 8.0);
        assert_eq!(rows["BTCUSDT_0.1"].index, 82674.56);
    }

    #[tokio::test]
    async fn a_market_the_table_does_not_name_is_left_out() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_CYCLES_PATH, json!({"code":"0","msg":"","data":[{"settleInterval":14400,"instrumentID":"BZUSDT","nextSettleTime":1791576000}]}));
        let venue = Deepcoin::with_rest(&rest.url, 0);
        venue.fetch_round(&http(), T0).await.unwrap();
        let mut conn = connection();

        feed(&venue, &mut conn, ticker(82675.12, 82636.4), T0);

        assert!(venue.fetch_round(&http(), T0).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn the_table_is_read_once_then_again_after_ten_minutes() {
        let rest = MockRest::start().await;
        let venue = venue_with_cycles(&rest, 0).await;

        venue.fetch_round(&http(), T0 + 1_000).await.unwrap();
        venue.fetch_round(&http(), T0 + FUNDING_CYCLES_REFRESH_MS - 1).await.unwrap();
        assert_eq!(rest.calls().len(), 1);

        venue.fetch_round(&http(), T0 + FUNDING_CYCLES_REFRESH_MS).await.unwrap();
        assert_eq!(rest.calls(), [FUNDING_CYCLES_PATH, FUNDING_CYCLES_PATH]);
    }

    #[tokio::test]
    async fn an_error_code_fails_the_round_and_the_next_round_reads_again() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_CYCLES_PATH, json!({"code":"51","msg":"The instType value `NOPE` is not in acceptable range: SwapU,Swap","data":null}));
        let venue = Deepcoin::with_rest(&rest.url, 0);

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();
        assert!(format!("{error}").contains("code 51"));

        rest.reply(FUNDING_CYCLES_PATH, cycles());
        venue.fetch_round(&http(), T0 + 1_000).await.unwrap();
        assert_eq!(venue.funding_cycles.lock().unwrap().interval_hours("BZUSDT"), 4.0);
    }

    #[tokio::test]
    async fn a_failed_reread_keeps_the_table_and_tries_again_a_minute_later() {
        let (logs, _capture) = crate::test_log::capture();
        let rest = MockRest::start().await;
        let venue = venue_with_cycles(&rest, 0).await;
        let mut conn = connection();
        feed(&venue, &mut conn, ticker(82675.12, 82636.4), T0);

        rest.reply(FUNDING_CYCLES_PATH, json!({"code":"50","msg":"busy","data":null}));
        let rows = venue.fetch_round(&http(), T0 + FUNDING_CYCLES_REFRESH_MS).await.unwrap();
        assert_eq!(rows["BTCUSDT_0.1"].funding_interval_hours, 8.0);
        assert_eq!(logs.events("funding_cycles_failed").len(), 1);

        venue.fetch_round(&http(), T0 + FUNDING_CYCLES_REFRESH_MS + FUNDING_CYCLES_RETRY_MS - 1).await.unwrap();
        assert_eq!(rest.calls().len(), 2);
        venue.fetch_round(&http(), T0 + FUNDING_CYCLES_REFRESH_MS + FUNDING_CYCLES_RETRY_MS).await.unwrap();
        assert_eq!(rest.calls().len(), 3);
    }

    #[tokio::test]
    async fn ts_is_the_older_arrival_of_the_mark_and_the_index_so_a_dead_socket_ages_its_rows() {
        let rest = MockRest::start().await;
        let venue = venue_with_cycles(&rest, 0).await;
        let mut conn = connection();

        feed(&venue, &mut conn, ticker(82675.12, 82636.4), T0);

        let rows = venue.fetch_round(&http(), T0 + 60_000).await.unwrap();
        assert_eq!(rows["BTCUSDT_0.1"].ts, Some(MT));
    }

    #[tokio::test]
    async fn a_ticker_missing_a_field_keeps_the_last_value_of_that_field() {
        let rest = MockRest::start().await;
        let venue = venue_with_cycles(&rest, 0).await;
        let mut conn = connection();
        feed(&venue, &mut conn, ticker(82675.12, 82636.4), T0);

        let mut partial = ticker(82674.56, 82635.8);
        partial["r"][0]["d"].as_object_mut().unwrap().remove("M");
        partial["mt"] = json!(MT + 1_000);
        feed(&venue, &mut conn, partial, T0 + 1_000);

        let row = venue.fetch_round(&http(), T0 + 1_000).await.unwrap()["BTCUSDT_0.1"];
        assert_eq!((row.index, row.mark, row.ts), (82674.56, 82636.4, Some(MT)));
    }

    #[tokio::test]
    async fn the_cached_push_after_a_subscribe_is_stamped_with_its_own_older_time() {
        let rest = MockRest::start().await;
        let venue = venue_with_cycles(&rest, 0).await;
        let mut conn = connection();

        feed(&venue, &mut conn, ticker(82675.12, 82636.4), MT + 5_268);

        assert_eq!(venue.fetch_round(&http(), T0).await.unwrap()["BTCUSDT_0.1"].ts, Some(MT));
    }

    #[tokio::test]
    async fn a_push_whose_time_runs_ahead_of_this_clock_is_stamped_with_its_arrival() {
        let rest = MockRest::start().await;
        let venue = venue_with_cycles(&rest, 0).await;
        let mut conn = connection();

        feed(&venue, &mut conn, ticker(82675.12, 82636.4), MT - 20);

        assert_eq!(venue.fetch_round(&http(), T0).await.unwrap()["BTCUSDT_0.1"].ts, Some(MT - 20));
    }

    #[tokio::test]
    async fn an_unknown_next_settlement_is_zero() {
        let rest = MockRest::start().await;
        let venue = venue_with_cycles(&rest, 0).await;
        let mut conn = connection();
        let mut push = ticker(82675.12, 82636.4);
        push["r"][0]["d"]["PF"] = json!(0);

        feed(&venue, &mut conn, push, T0);

        assert_eq!(venue.fetch_round(&http(), T0).await.unwrap()["BTCUSDT_0.1"].next_funding_at, 0);
    }

    #[tokio::test]
    async fn a_ticker_for_a_market_not_on_the_connection_is_ignored() {
        let rest = MockRest::start().await;
        let venue = venue_with_cycles(&rest, 0).await;
        let mut conn = connection();
        let mut push = ticker(82675.12, 82636.4);
        push["r"][0]["d"]["I"] = json!("ETHUSDT");

        feed(&venue, &mut conn, push, T0);

        assert!(venue.fetch_round(&http(), T0).await.unwrap().is_empty());
    }

    #[tokio::test]
    async fn a_round_fails_whole_until_every_market_is_anchored_or_the_warmup_ends() {
        let rest = MockRest::start().await;
        rest.reply(FUNDING_CYCLES_PATH, cycles());
        let mut venue = Deepcoin::with_rest(&rest.url, 2);
        let mut conn = connection();
        assert!(venue.fetch_round(&http(), T0).await.is_err());
        feed(&venue, &mut conn, ticker(82675.12, 82636.4), T0);

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();
        assert_eq!(format!("{error}"), "warming up, 1 of 2 markets have their index, mark and funding");

        venue.first_round = OnceLock::from(Instant::now() - WARMUP);
        let rows = venue.fetch_round(&http(), T0).await.unwrap();
        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTCUSDT_0.1"]);
    }

    #[tokio::test]
    async fn handle_stamps_the_mark_and_the_index_with_the_frame_arrival() {
        let rest = MockRest::start().await;
        let venue = venue_with_cycles(&rest, 0).await;
        let mut conn = connection();

        venue.handle(ticker(82675.12, 82636.4).to_string().as_bytes(), &mut conn).unwrap();

        assert_eq!(venue.fetch_round(&http(), T0).await.unwrap()["BTCUSDT_0.1"].ts, Some(conn.frame_recv_ts()));
    }
}
