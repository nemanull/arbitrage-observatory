use super::Apex;
use crate::feeds::anchor_poller::{AnchorMap, AnchorVenue};
use std::time::{Duration, Instant};

const HOUR_MS: i64 = 3_600_000;

// The anchor push comes on subscribe and then every 2 s, so every row fills well inside this.
const WARMUP: Duration = Duration::from_secs(10);

// No REST call serves the anchor fresh: all-ticker-info came from a CDN cache on 25 to 27 of 30 polls and took 8.5 s at the origin.
// So the book socket subscribes instrumentInfo.all, handle fills the map, and a round makes no request.
impl AnchorVenue for Apex {
    async fn fetch_round(&self, _http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        let mut rows = self.anchors.rows();

        // The first rounds run before the socket opens, and a round that fails whole logs one line where a missing row logs one each.
        let first_round = *self.first_round.get_or_init(Instant::now);
        if rows.len() < self.tracked.len() && first_round.elapsed() < WARMUP {
            anyhow::bail!("warming up, {} of {} markets have their index, mark and funding", rows.len(), self.tracked.len());
        }

        // Settlements landed exactly on the hour, and the push names neither the interval nor the next settlement.
        let next_funding_at = next_hour(ts);
        for row in rows.values_mut() {
            row.next_funding_at = next_funding_at;
        }

        Ok(rows)
    }
}

// The floor plus one keeps a round on the hour pointing at the next settlement.
fn next_hour(ts: i64) -> i64 {
    (ts.div_euclid(HOUR_MS) + 1) * HOUR_MS
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::cluster::Market;
    use crate::feeds::anchor_poller::AnchorRow;
    use crate::feeds::venue_feed::Connection;
    use crate::venues::testing::{self, http};
    use serde_json::{Value, json};
    use std::collections::HashMap;
    use std::sync::OnceLock;

    const T0: i64 = 1_791_844_337_893; // 2026-10-12 22:32:17.893 UTC, the push's ts in ms
    const NEXT_HOUR: i64 = 1_791_846_000_000; // 23:00 UTC

    fn market(raw_market_id: &str) -> Market {
        testing::market(super::super::ID, raw_market_id, &raw_market_id.replace("USDT", ""), "USDT", true)
    }

    fn venue(raw_ids: &[&str]) -> Apex {
        let markets: Vec<Market> = raw_ids.iter().map(|raw| market(raw)).collect();
        Apex::new(&testing::tracked(&markets))
    }

    fn connection() -> Connection<HashMap<usize, i64>> {
        Connection::for_test("apex#perp#0", vec![market("BTCUSDT"), market("AAPLUSDT")])
    }

    // Rows of one instrumentInfo.all push captured live on 2026-10-12, cut to three of 369, with a prediction contract among them.
    fn push(btc_index: &str, btc_mark: &str) -> Value {
        json!({"topic":"instrumentInfo.all","type":"snapshot","ts":1791844337893771_i64,"data":[
            {"s":"BTCUSDT","p":"82610.5","pr":"-0.0115440806075479","h":"84303.9","l":"82266.6","xp":btc_index,"to":"278292165.2159","v":"3342.116","fr":"0.0000125","o":"1640.9339999999998","tc":"22647","ss":"0","mp":btc_mark},
            {"s":"AAPLUSDT","p":"341.13","pr":"0.0129766005463832","h":"342.98","l":"336.62","xp":"341.27","to":"11078010.4597","v":"32716.32","fr":"0.0000125","o":"3830.7","tc":"25625","ss":"0","mp":"341.21"},
            {"s":"Grizzlies_Win_Against_Kings_Nov30USDT","p":"0.478","pr":"0","h":"0.478","l":"0.478","xp":"0.999","to":"1.81","v":"4","fr":"0.0000125","o":"2","tc":"0","ss":"1","mp":"0.999"},
        ]})
    }

    fn feed(venue: &Apex, conn: &mut Connection<HashMap<usize, i64>>, frame: Value, at: i64) {
        venue.handle_at(frame.to_string().as_bytes(), conn, at).unwrap();
    }

    async fn round(venue: &Apex, ts: i64) -> AnchorMap {
        venue.fetch_round(&http(), ts).await.unwrap()
    }

    #[test]
    fn polls_every_second() {
        assert_eq!(venue(&[]).poll_every(), Duration::from_secs(1));
    }

    #[test]
    fn the_next_settlement_is_the_next_whole_utc_hour() {
        assert_eq!(next_hour(T0), NEXT_HOUR);
        assert_eq!(next_hour(NEXT_HOUR - 1), NEXT_HOUR);
        assert_eq!(next_hour(NEXT_HOUR), NEXT_HOUR + HOUR_MS);
    }

    #[tokio::test]
    async fn one_push_anchors_each_tracked_market_with_index_mark_and_an_hourly_funding_rate() {
        let venue = venue(&["BTCUSDT", "AAPLUSDT"]);
        let mut conn = connection();

        feed(&venue, &mut conn, push("82650.16", "82619.71"), T0);
        let rows = round(&venue, T0).await;

        assert_eq!(
            rows["BTCUSDT"],
            AnchorRow {
                index: 82650.16,
                mark: 82619.71,
                funding_rate: 0.0000125,
                funding_interval_hours: 1.0,
                next_funding_at: NEXT_HOUR,
                ts: Some(T0),
            }
        );
        assert_eq!((rows["AAPLUSDT"].index, rows["AAPLUSDT"].mark), (341.27, 341.21));
    }

    #[tokio::test]
    async fn a_symbol_off_the_book_socket_is_not_kept() {
        let venue = venue(&["BTCUSDT"]);
        let mut conn = connection();

        feed(&venue, &mut conn, push("82650.16", "82619.71"), T0);

        let rows = round(&venue, T0).await;
        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTCUSDT"]);
    }

    #[tokio::test]
    async fn each_push_moves_the_stamp_so_a_dead_socket_ages_its_rows() {
        let venue = venue(&["BTCUSDT"]);
        let mut conn = connection();
        feed(&venue, &mut conn, push("82650.16", "82619.71"), T0);

        feed(&venue, &mut conn, push("82651.02", "82620.40"), T0 + 2_000);
        let fresh = round(&venue, T0 + 2_100).await;
        let later = round(&venue, T0 + 60_000).await;

        assert_eq!(fresh["BTCUSDT"].ts, Some(T0 + 2_000));
        assert_eq!(fresh["BTCUSDT"].index, 82651.02);
        assert_eq!(later["BTCUSDT"].ts, Some(T0 + 2_000));
    }

    #[tokio::test]
    async fn a_field_that_does_not_read_keeps_its_old_stamp() {
        let venue = venue(&["BTCUSDT"]);
        let mut conn = connection();
        feed(&venue, &mut conn, push("82650.16", "82619.71"), T0);

        feed(&venue, &mut conn, push("", "82620.40"), T0 + 2_000);

        let row = round(&venue, T0 + 2_000).await["BTCUSDT"];
        assert_eq!((row.index, row.mark), (82650.16, 82620.40));
        assert_eq!(row.ts, Some(T0));
    }

    #[tokio::test]
    async fn a_row_without_an_index_is_never_anchored() {
        let venue = venue(&["BTCUSDT"]);
        let mut conn = connection();
        let mut frame = push("82650.16", "82619.71");
        frame["data"][0].as_object_mut().unwrap().remove("xp");

        feed(&venue, &mut conn, frame, T0);

        assert!(venue.anchors.rows().is_empty());
    }

    #[tokio::test]
    async fn the_next_settlement_moves_with_the_round_clock() {
        let venue = venue(&["BTCUSDT"]);
        let mut conn = connection();
        feed(&venue, &mut conn, push("82650.16", "82619.71"), T0);

        let after_the_hour = round(&venue, NEXT_HOUR + 500).await;

        assert_eq!(after_the_hour["BTCUSDT"].next_funding_at, NEXT_HOUR + HOUR_MS);
    }

    #[tokio::test]
    async fn a_round_fails_whole_until_every_market_is_anchored_or_the_warmup_ends() {
        let mut venue = venue(&["BTCUSDT", "ETHUSDT"]);
        let mut conn = connection();
        feed(&venue, &mut conn, push("82650.16", "82619.71"), T0);

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();
        assert_eq!(format!("{error}"), "warming up, 1 of 2 markets have their index, mark and funding");

        venue.first_round = OnceLock::from(Instant::now() - WARMUP);
        let rows = round(&venue, T0).await;
        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTCUSDT"]);
    }

    #[tokio::test]
    async fn handle_stamps_the_anchor_fields_with_the_frame_arrival() {
        let venue = venue(&["BTCUSDT"]);
        let mut conn = connection();

        crate::feeds::venue_feed::BookVenue::handle(&venue, push("82650.16", "82619.71").to_string().as_bytes(), &mut conn).unwrap();

        assert_eq!(round(&venue, T0).await["BTCUSDT"].ts, Some(conn.frame_recv_ts()));
    }
}
