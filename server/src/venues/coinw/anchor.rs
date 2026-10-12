use super::{CONNECT_STAGGER, Coinw, MARKETS_PER_CONNECTION};
use crate::feeds::anchor_poller::{AnchorMap, AnchorVenue};
use std::time::{Duration, Instant};

const HOUR_MS: i64 = 3_600_000;

// funding_rate pushes every 5 s, so a market has all three fields this long after its subscribe.
const FIRST_FUNDING_WAIT: Duration = Duration::from_secs(10);

// No REST call carries the index, the mark or the upcoming rate, so the book sockets subscribe them and handle fills the map.
// A round makes no request, so the poller's rate limit pause never applies.
impl AnchorVenue for Coinw {
    async fn fetch_round(&self, _http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let mut rows = self.anchors.rows();

        // The connections open one stagger apart, and a round that fails whole logs one line where hundreds of missing rows would log one each.
        let first_round = *self.first_round.get_or_init(Instant::now);
        if rows.len() < self.tracked && first_round.elapsed() < warmup(self.tracked) {
            anyhow::bail!("warming up, {} of {} markets have their index, mark and funding", rows.len(), self.tracked);
        }

        // The push names the coming settlement and repeats every 5 s, so one that has passed is moved on by whole intervals.
        for row in rows.values_mut() {
            row.next_funding_at = next_settlement(row.next_funding_at, row.funding_interval_hours, ts);
        }

        Ok(rows)
    }
}

// The last connection opens (connections - 1) staggers in and needs at most one stagger to subscribe.
fn warmup(tracked: usize) -> Duration {
    let connections = tracked.div_ceil(MARKETS_PER_CONNECTION).max(1) as u32;
    CONNECT_STAGGER * connections + FIRST_FUNDING_WAIT
}

fn next_settlement(next_funding_at: i64, interval_hours: f64, ts: i64) -> i64 {
    let interval_ms = (interval_hours * HOUR_MS as f64) as i64;
    if next_funding_at <= 0 || interval_ms <= 0 || next_funding_at > ts {
        return next_funding_at;
    }
    let behind = (ts - next_funding_at).div_euclid(interval_ms) + 1;
    next_funding_at + behind * interval_ms
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::cluster::Market;
    use crate::feeds::anchor_poller::AnchorRow;
    use crate::feeds::venue_feed::{BookVenue, Connection};
    use crate::venues::testing::{self, http};
    use serde_json::{Value, json};
    use std::sync::OnceLock;

    const T0: i64 = 1_791_568_300_000; // 2026-10-09 17:51:40 UTC
    const NEXT: i64 = 1_791_590_400_000; // 2026-10-10 00:00 UTC

    fn market(raw_market_id: &str) -> Market {
        testing::market(super::super::ID, raw_market_id, "BTC", "USDT", true)
    }

    fn connection() -> Connection<()> {
        Connection::for_test("coinw#perp#0", vec![market("BTC"), market("BTC_USDC")])
    }

    // Pushes captured live on 2026-10-09.
    fn index(pair: &str, price: f64) -> Value {
        json!({"biz":"futures","data":{"n":pair,"p":price,"t":1791568299170_i64},"pairCode":pair,"time":49821452981823345_i64,"type":"index_price"})
    }

    fn mark(pair: &str, price: f64) -> Value {
        json!({"biz":"futures","data":{"n":pair,"p":price,"t":1791568299170_i64},"pairCode":pair,"time":49821452989551793_i64,"type":"mark_price"})
    }

    fn funding(pair: &str, rate: f64) -> Value {
        json!({"biz":"futures","data":{"h":8,"n":pair,"nt":NEXT,"r":rate,"t":1791568300000_i64},"pairCode":pair,"time":49821454129374258_i64,"type":"funding_rate"})
    }

    fn feed(venue: &Coinw, conn: &mut Connection<()>, frame: Value, at: i64) {
        venue.handle_at(frame.to_string().as_bytes(), conn, at).unwrap();
    }

    fn complete(venue: &Coinw, conn: &mut Connection<()>, pair: &str) {
        feed(venue, conn, funding(pair, 0.00003416), T0);
        feed(venue, conn, mark(pair, 82696.8), T0);
        feed(venue, conn, index(pair, 82728.9), T0);
    }

    async fn round(venue: &Coinw, ts: i64) -> AnchorMap {
        venue.fetch_round(&http(), ts).await.unwrap()
    }

    #[test]
    fn polls_every_second() {
        assert_eq!(Coinw::new(&[]).poll_every(), Duration::from_secs(1));
    }

    #[test]
    fn the_warmup_covers_the_last_connection_of_the_stagger() {
        assert_eq!(warmup(0), Duration::from_secs(30));
        assert_eq!(warmup(100), Duration::from_secs(30));
        assert_eq!(warmup(376), Duration::from_secs(90));
    }

    #[test]
    fn a_passed_settlement_moves_on_by_whole_intervals() {
        assert_eq!(next_settlement(NEXT, 8.0, T0), NEXT);
        assert_eq!(next_settlement(NEXT, 8.0, NEXT), NEXT + 8 * HOUR_MS);
        assert_eq!(next_settlement(NEXT, 4.0, NEXT + 5 * HOUR_MS), NEXT + 8 * HOUR_MS);
        assert_eq!(next_settlement(0, 8.0, T0), 0);
    }

    #[tokio::test]
    async fn a_market_is_anchored_once_its_index_mark_and_funding_have_arrived() {
        let venue = Coinw::new(&[]);
        let mut conn = connection();

        feed(&venue, &mut conn, funding("btc", 0.00003416), T0 - 2_000);
        assert!(round(&venue, T0).await.is_empty());
        feed(&venue, &mut conn, mark("btc", 82696.8), T0 - 900);
        assert!(round(&venue, T0).await.is_empty());
        feed(&venue, &mut conn, index("btc", 82728.9), T0 - 400);

        assert_eq!(
            round(&venue, T0).await["BTC"],
            AnchorRow {
                index: 82728.9,
                mark: 82696.8,
                funding_rate: 0.00003416,
                funding_interval_hours: 8.0,
                next_funding_at: NEXT,
                ts: Some(T0 - 900),
            }
        );
    }

    #[tokio::test]
    async fn the_lower_case_pair_code_is_filed_under_the_upper_case_raw_id() {
        let venue = Coinw::new(&[]);
        let mut conn = connection();

        complete(&venue, &mut conn, "btc_usdc");

        let rows = round(&venue, T0).await;
        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTC_USDC"]);
    }

    #[tokio::test]
    async fn a_pair_code_not_on_the_connection_is_ignored() {
        let (logs, _capture) = crate::test_log::capture();
        let venue = Coinw::new(&[]);
        let mut conn = connection();

        complete(&venue, &mut conn, "eth");

        assert!(round(&venue, T0).await.is_empty());
        assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "ETH");
    }

    #[tokio::test]
    async fn ts_is_the_older_arrival_of_the_index_and_the_mark_so_a_dead_socket_ages_its_rows() {
        let venue = Coinw::new(&[]);
        let mut conn = connection();
        feed(&venue, &mut conn, funding("btc", 0.00003416), T0);
        feed(&venue, &mut conn, mark("btc", 82696.8), T0);
        feed(&venue, &mut conn, index("btc", 82728.9), T0 + 1_000);

        feed(&venue, &mut conn, index("btc", 82730.0), T0 + 2_000);

        let rows = round(&venue, T0 + 60_000).await;
        assert_eq!(rows["BTC"].ts, Some(T0));
        assert_eq!(rows["BTC"].index, 82730.0);
    }

    #[tokio::test]
    async fn a_round_after_the_settlement_reports_the_next_one() {
        let venue = Coinw::new(&[]);
        let mut conn = connection();
        complete(&venue, &mut conn, "btc");

        let later = round(&venue, NEXT + 1_000).await;

        assert_eq!(later["BTC"].next_funding_at, NEXT + 8 * HOUR_MS);
    }

    #[tokio::test]
    async fn a_mark_of_zero_keeps_the_market_out_rather_than_reading_as_no_mark() {
        let venue = Coinw::new(&[]);
        let mut conn = connection();
        complete(&venue, &mut conn, "btc");

        feed(&venue, &mut conn, mark("btc", 0.0), T0);

        assert!(round(&venue, T0).await.is_empty());
    }

    #[tokio::test]
    async fn a_funding_push_without_an_interval_keeps_the_market_out() {
        let venue = Coinw::new(&[]);
        let mut conn = connection();
        complete(&venue, &mut conn, "btc");
        let mut push = funding("btc", 0.0001);
        push["data"].as_object_mut().unwrap().remove("h");

        feed(&venue, &mut conn, push, T0);

        assert!(round(&venue, T0).await.is_empty());
    }

    #[tokio::test]
    async fn a_funding_push_without_a_next_settlement_reports_it_unknown() {
        let venue = Coinw::new(&[]);
        let mut conn = connection();
        complete(&venue, &mut conn, "btc");
        let mut push = funding("btc", 0.0001);
        push["data"].as_object_mut().unwrap().remove("nt");

        feed(&venue, &mut conn, push, T0);

        assert_eq!(round(&venue, T0).await["BTC"].next_funding_at, 0);
    }

    #[tokio::test]
    async fn a_round_fails_whole_until_every_market_is_anchored_or_the_warmup_ends() {
        let mut venue = Coinw::new(&testing::tracked(&[market("BTC"), market("BTC_USDC")]));
        let mut conn = connection();
        complete(&venue, &mut conn, "btc");

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();
        assert_eq!(format!("{error}"), "warming up, 1 of 2 markets have their index, mark and funding");

        venue.first_round = OnceLock::from(Instant::now() - warmup(2));
        let rows = round(&venue, T0).await;
        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTC"]);
    }

    #[tokio::test]
    async fn handle_stamps_the_index_and_the_mark_with_the_frame_arrival() {
        let venue = Coinw::new(&[]);
        let mut conn = connection();

        for frame in [funding("btc", 0.0001), mark("btc", 82696.8), index("btc", 82728.9)] {
            venue.handle(frame.to_string().as_bytes(), &mut conn).unwrap();
        }

        assert_eq!(round(&venue, T0).await["BTC"].ts, Some(conn.frame_recv_ts()));
    }
}
