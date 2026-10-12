use super::Cryptocom;
use crate::feeds::anchor_poller::{AnchorMap, AnchorVenue};
use std::time::{Duration, Instant};

const HOUR_MS: i64 = 3_600_000;

// Every market had its snapshot within 3 s of the subscribe and funding comes on subscribe, so the rows fill well inside this.
const WARMUP: Duration = Duration::from_secs(10);

// No REST call carries the anchor in bulk, so the book sockets subscribe mark, index and funding and handle fills the map.
// A round makes no request, so the poller's rate limit pause never applies.
impl AnchorVenue for Cryptocom {
    async fn fetch_round(&self, _http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let mut rows = self.anchors.rows();

        // The first rounds run before the sockets open, and a round that fails whole logs one line where 400 missing rows would log one each.
        let first_round = *self.first_round.get_or_init(Instant::now);
        if rows.len() < self.tracked && first_round.elapsed() < WARMUP {
            anyhow::bail!("warming up, {} of {} markets have their mark, index and funding", rows.len(), self.tracked);
        }

        // Every perpetual settles at each whole UTC hour, and neither the interval nor the next settlement is a field.
        let next_funding_at = next_hour(ts);
        for row in rows.values_mut() {
            row.next_funding_at = next_funding_at;
        }

        Ok(rows)
    }
}

fn next_hour(ts: i64) -> i64 {
    (ts.div_euclid(HOUR_MS) + 1) * HOUR_MS
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::cluster::Market;
    use crate::feeds::anchor_poller::AnchorRow;
    use crate::feeds::venue_feed::{BookVenue, Connection};
    use crate::venues::testing::{self, http};
    use serde_json::{Value, json};
    use std::collections::HashMap;
    use std::sync::OnceLock;

    const T0: i64 = 1_791_456_123_456; // 2026-10-08 10:42:03.456 UTC

    fn market(raw_market_id: &str) -> Market {
        testing::market(super::super::ID, raw_market_id, "BTC", "USD", true)
    }

    // Pushes captured live on 2026-10-08.
    // The funding push is the reply to its subscribe, so it carries the request id where a later push carries -1.
    fn mark(value: &str) -> Value {
        json!({"id":-1,"method":"subscribe","code":0,"result":{"instrument_name":"BTCUSD-PERP","subscription":"mark.BTCUSD-PERP","channel":"mark","data":[{"v":value,"t":1791456123000_i64}]}})
    }

    fn index(value: &str) -> Value {
        json!({"id":-1,"method":"subscribe","code":0,"result":{"instrument_name":"BTCUSD-INDEX","subscription":"index.BTCUSD-INDEX","channel":"index","data":[{"v":value,"t":1791456123000_i64}]}})
    }

    fn funding(value: &str) -> Value {
        json!({"id":3,"method":"subscribe","code":0,"result":{"instrument_name":"BTCUSD-PERP","subscription":"funding.BTCUSD-PERP","channel":"funding","data":[{"v":value,"t":1791456005000_i64}]}})
    }

    fn feed(venue: &Cryptocom, conn: &mut Connection<HashMap<usize, u64>>, frame: Value, at: i64) {
        venue.handle_at(frame.to_string().as_bytes(), conn, at).unwrap();
    }

    async fn round(venue: &Cryptocom, ts: i64) -> AnchorMap {
        venue.fetch_round(&http(), ts).await.unwrap()
    }

    #[test]
    fn polls_every_second() {
        assert_eq!(Cryptocom::new(&[]).poll_every(), Duration::from_secs(1));
    }

    #[test]
    fn the_next_settlement_is_the_next_whole_utc_hour() {
        assert_eq!(next_hour(T0), 1_791_457_200_000);
        assert_eq!(next_hour(1_791_453_600_000), 1_791_457_200_000);
        assert_eq!(next_hour(1_791_457_199_999), 1_791_457_200_000);
    }

    #[tokio::test]
    async fn a_market_is_anchored_once_its_mark_index_and_funding_have_arrived() {
        let venue = Cryptocom::new(&[]);
        let mut conn = Connection::for_test("cryptocom#perp#0", vec![market("BTCUSD-PERP")]);

        feed(&venue, &mut conn, funding("-0.000004992"), T0 - 2_000);
        assert!(round(&venue, T0).await.is_empty());
        feed(&venue, &mut conn, mark("121876.3"), T0 - 900);
        assert!(round(&venue, T0).await.is_empty());
        feed(&venue, &mut conn, index("121880.17"), T0 - 400);

        assert_eq!(
            round(&venue, T0).await["BTCUSD-PERP"],
            AnchorRow {
                index: 121880.17,
                mark: 121876.3,
                funding_rate: -0.000004992,
                funding_interval_hours: 1.0,
                next_funding_at: 1_791_457_200_000,
                ts: Some(T0 - 900),
            }
        );
    }

    #[tokio::test]
    async fn the_index_push_is_filed_under_the_perpetual_it_belongs_to() {
        let venue = Cryptocom::new(&[]);
        let mut conn = Connection::for_test("cryptocom#perp#0", vec![market("BTCUSD-PERP")]);
        feed(&venue, &mut conn, funding("0.00001"), T0);
        feed(&venue, &mut conn, mark("121876.3"), T0);

        feed(&venue, &mut conn, index("121880.17"), T0);

        let rows = round(&venue, T0).await;
        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTCUSD-PERP"]);
        assert_eq!(rows["BTCUSD-PERP"].index, 121880.17);
    }

    #[tokio::test]
    async fn ts_is_the_older_arrival_of_the_mark_and_the_index_so_a_dead_socket_ages_its_rows() {
        let venue = Cryptocom::new(&[]);
        let mut conn = Connection::for_test("cryptocom#perp#0", vec![market("BTCUSD-PERP")]);
        feed(&venue, &mut conn, funding("0.00001"), T0);
        feed(&venue, &mut conn, mark("121876.3"), T0);
        feed(&venue, &mut conn, index("121880.17"), T0 + 1_000);

        feed(&venue, &mut conn, index("121881.00"), T0 + 2_000);

        let rows = round(&venue, T0 + 60_000).await;
        assert_eq!(rows["BTCUSD-PERP"].ts, Some(T0));
        assert_eq!(rows["BTCUSD-PERP"].index, 121881.0);
    }

    #[tokio::test]
    async fn the_next_settlement_moves_with_the_round_clock_not_with_the_funding_push() {
        let venue = Cryptocom::new(&[]);
        let mut conn = Connection::for_test("cryptocom#perp#0", vec![market("BTCUSD-PERP")]);
        feed(&venue, &mut conn, funding("0.00001"), T0);
        feed(&venue, &mut conn, mark("121876.3"), T0);
        feed(&venue, &mut conn, index("121880.17"), T0);

        let later = round(&venue, 1_791_457_200_500).await;

        assert_eq!(later["BTCUSD-PERP"].next_funding_at, 1_791_460_800_000);
    }

    #[tokio::test]
    async fn a_round_fails_whole_until_every_market_is_anchored_or_the_warmup_ends() {
        let mut venue = Cryptocom::new(&testing::tracked(&[market("BTCUSD-PERP"), market("ETHUSD-PERP")]));
        let mut conn = Connection::for_test("cryptocom#perp#0", vec![market("BTCUSD-PERP")]);
        feed(&venue, &mut conn, funding("0.00001"), T0);
        feed(&venue, &mut conn, mark("121876.3"), T0);
        feed(&venue, &mut conn, index("121880.17"), T0);

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();
        assert_eq!(format!("{error}"), "warming up, 1 of 2 markets have their mark, index and funding");

        venue.first_round = OnceLock::from(Instant::now() - WARMUP);
        let rows = round(&venue, T0).await;
        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTCUSD-PERP"]);
    }

    #[tokio::test]
    async fn handle_stamps_the_mark_and_the_index_with_the_frame_arrival() {
        let venue = Cryptocom::new(&[]);
        let mut conn = Connection::for_test("cryptocom#perp#0", vec![market("BTCUSD-PERP")]);

        for frame in [funding("0.00001"), mark("121876.3"), index("121880.17")] {
            venue.handle(frame.to_string().as_bytes(), &mut conn).unwrap();
        }

        assert_eq!(round(&venue, T0).await["BTCUSD-PERP"].ts, Some(conn.frame_recv_ts()));
    }

    #[tokio::test]
    async fn an_index_push_not_named_as_an_index_is_ignored() {
        let venue = Cryptocom::new(&[]);
        let mut conn = Connection::for_test("cryptocom#perp#0", vec![market("BTCUSD-PERP")]);
        feed(&venue, &mut conn, funding("0.00001"), T0);
        feed(&venue, &mut conn, mark("121876.3"), T0);
        let mut push = index("121880.17");
        push["result"]["instrument_name"] = json!("BTCUSD-PERP");

        feed(&venue, &mut conn, push, T0);

        assert!(round(&venue, T0).await.is_empty());
    }

    #[tokio::test]
    async fn an_unparsable_value_keeps_the_market_out() {
        let venue = Cryptocom::new(&[]);
        let mut conn = Connection::for_test("cryptocom#perp#0", vec![market("BTCUSD-PERP")]);
        feed(&venue, &mut conn, funding("0.00001"), T0);
        feed(&venue, &mut conn, mark("121876.3"), T0);

        feed(&venue, &mut conn, index(""), T0);

        assert!(round(&venue, T0).await.is_empty());
    }
}
