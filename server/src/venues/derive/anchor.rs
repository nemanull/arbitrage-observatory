use super::Derive;
use crate::feeds::anchor_poller::{AnchorMap, AnchorVenue};
use std::time::{Duration, Instant};

// Every ticker arrived within about 1 s of the subscribe on 2026-10-12, so the rows fill well inside this.
const WARMUP: Duration = Duration::from_secs(10);

// get_tickers carries index, mark and funding in bulk, but it serves cached snapshots up to 15 s old, 20.9 % of them over 10 s.
// So the book socket subscribes the slim tickers and handle fills the rows, each stamped with its frame's arrival.
// A round makes no request, so the poller's rate limit pause never applies.
impl AnchorVenue for Derive {
    async fn fetch_round(&self, _http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let rows = self.anchors.rows();

        // The first rounds run before the socket opens, and a round that fails whole logs one line where 15 missing rows would log one each.
        let first_round = *self.first_round.get_or_init(Instant::now);
        if rows.len() < self.tracked && first_round.elapsed() < WARMUP {
            anyhow::bail!("warming up, {} of {} markets have their index, mark and funding", rows.len(), self.tracked);
        }

        Ok(rows)
    }
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

    const T0: i64 = 1_791_845_513_340; // 2026-10-12 22:51:53.340 UTC, 63 ms after the captured BTC-PERP ticker's own t, a typical age on arrival

    fn market(raw_market_id: &str) -> Market {
        let base = raw_market_id.strip_suffix("-PERP").unwrap();
        testing::market(super::super::ID, raw_market_id, base, "USDC", true)
    }

    fn connection() -> Connection<()> {
        Connection::for_test("derive#perp#0", vec![market("BTC-PERP"), market("CC-PERP")])
    }

    // Slim tickers captured live on 2026-10-12.
    fn btc_ticker() -> Value {
        json!({"method":"subscription","params":{"channel":"ticker_slim.BTC-PERP.1000","data":{"timestamp":1791845513277_i64,"instrument_ticker":{
            "t":1791845513277_i64,"A":"0.02","a":"82534.2","B":"0.0968","b":"82534.1","f":"0.000012500","option_pricing":null,"I":"82500.3","M":"82531.8",
            "stats":{"c":"90.324","v":"7470353.093","pr":"7474109.415","n":948,"oi":"363.102","h":"84279.9","l":"82282.5","p":"-0.014"},
            "minp":"80913.6","maxp":"84182.5"}}}})
    }

    fn cc_ticker() -> Value {
        json!({"method":"subscription","params":{"channel":"ticker_slim.CC-PERP.1000","data":{"timestamp":1791845513382_i64,"instrument_ticker":{
            "t":1791845513382_i64,"A":"135869.3","a":"0.1211","B":"29381.7","b":"0.1208","f":"0.000012500","option_pricing":null,"I":"0.1207","M":"0.1209",
            "stats":{"c":"184678","v":"23038.878","pr":"23049.921","n":36,"oi":"241258.1","h":"0.126","l":"0.121","p":"-0.03"},
            "minp":"0.1152","maxp":"0.1269"}}}})
    }

    fn feed(venue: &Derive, conn: &mut Connection<()>, frame: Value, at: i64) {
        venue.handle_at(frame.to_string().as_bytes(), conn, at).unwrap();
    }

    async fn round(venue: &Derive) -> AnchorMap {
        venue.fetch_round(&http(), T0).await.unwrap()
    }

    #[test]
    fn polls_every_second() {
        assert_eq!(Derive::new(&[]).poll_every(), Duration::from_secs(1));
    }

    #[tokio::test]
    async fn a_ticker_gives_the_index_the_mark_and_the_hourly_rate_with_no_settlement_instant() {
        let venue = Derive::new(&[]);
        let mut conn = connection();

        feed(&venue, &mut conn, btc_ticker(), T0);

        assert_eq!(
            round(&venue).await["BTC-PERP"],
            AnchorRow {
                index: 82500.3,
                mark: 82531.8,
                funding_rate: 0.0000125,
                funding_interval_hours: 1.0,
                next_funding_at: 0,
                ts: Some(T0),
            }
        );
    }

    #[tokio::test]
    async fn the_market_is_read_from_the_channel_name() {
        let venue = Derive::new(&[]);
        let mut conn = connection();

        feed(&venue, &mut conn, btc_ticker(), T0);
        feed(&venue, &mut conn, cc_ticker(), T0 + 105);

        let rows = round(&venue).await;
        assert_eq!((rows["BTC-PERP"].index, rows["CC-PERP"].index), (82500.3, 0.1207));
        assert_eq!((rows["BTC-PERP"].mark, rows["CC-PERP"].mark), (82531.8, 0.1209));
        assert_eq!(rows["CC-PERP"].ts, Some(T0 + 105));
    }

    #[tokio::test]
    async fn a_later_ticker_moves_the_row_and_its_stamp_and_a_dead_socket_leaves_the_last_stamp_to_age() {
        let venue = Derive::new(&[]);
        let mut conn = connection();
        feed(&venue, &mut conn, btc_ticker(), T0);

        let mut next = btc_ticker();
        next["params"]["data"]["instrument_ticker"]["I"] = json!("82510.0");
        next["params"]["data"]["instrument_ticker"]["M"] = json!("82540.0");
        feed(&venue, &mut conn, next, T0 + 1_011);

        let row = round(&venue).await["BTC-PERP"];
        assert_eq!((row.index, row.mark, row.ts), (82510.0, 82540.0, Some(T0 + 1_011)));
        let later = venue.fetch_round(&http(), T0 + 60_000).await.unwrap();
        assert_eq!(later["BTC-PERP"].ts, Some(T0 + 1_011));
    }

    #[tokio::test]
    async fn a_ticker_without_a_readable_mark_or_index_keeps_the_market_out() {
        let venue = Derive::new(&[]);
        let mut conn = connection();
        let mut no_mark = btc_ticker();
        no_mark["params"]["data"]["instrument_ticker"].as_object_mut().unwrap().remove("M");
        let mut bad_index = cc_ticker();
        bad_index["params"]["data"]["instrument_ticker"]["I"] = json!("");

        feed(&venue, &mut conn, no_mark, T0);
        feed(&venue, &mut conn, bad_index, T0);

        assert!(round(&venue).await.is_empty());
    }

    #[tokio::test]
    async fn a_ticker_of_a_market_off_this_connection_is_not_kept() {
        let venue = Derive::new(&[]);
        let mut conn = Connection::for_test("derive#perp#0", vec![market("ETH-PERP")]);

        feed(&venue, &mut conn, btc_ticker(), T0);

        assert!(round(&venue).await.is_empty());
    }

    #[tokio::test]
    async fn a_round_fails_whole_until_every_market_is_anchored_or_the_warmup_ends() {
        let mut venue = Derive::new(&testing::tracked(&[market("BTC-PERP"), market("CC-PERP")]));
        let mut conn = connection();
        feed(&venue, &mut conn, btc_ticker(), T0);

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();
        assert_eq!(format!("{error}"), "warming up, 1 of 2 markets have their index, mark and funding");

        venue.first_round = OnceLock::from(Instant::now() - WARMUP);
        let rows = round(&venue).await;
        assert_eq!(rows.keys().collect::<Vec<_>>(), ["BTC-PERP"]);

        feed(&venue, &mut conn, cc_ticker(), T0);
        assert_eq!(round(&venue).await.len(), 2);
    }

    #[tokio::test]
    async fn handle_stamps_the_ticker_with_the_frame_arrival() {
        let venue = Derive::new(&[]);
        let mut conn = connection();

        venue.handle(btc_ticker().to_string().as_bytes(), &mut conn).unwrap();

        assert_eq!(round(&venue).await["BTC-PERP"].ts, Some(conn.frame_recv_ts()));
    }
}
