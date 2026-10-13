use super::{Grvt, connections, subscribe_gap};
use crate::feeds::anchor_poller::{AnchorMap, AnchorVenue};
use std::time::{Duration, Instant};

// A ticker's first push follows its acknowledgement at once, so a market has its row this long after its subscribe.
const FIRST_TICKER_WAIT: Duration = Duration::from_secs(5);

// No REST call carries the index, the mark or the funding of every market, and a sweep of the per market ticker took 23 s.
// So the book sockets subscribe the ticker beside each book, handle fills the map, and a round makes no request.
impl AnchorVenue for Grvt {
    async fn fetch_round(&self, _http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let rows = self.anchors.rows();

        // The ticker frames go out after every book frame, and a round that fails whole logs one line where each missing row would log one.
        let first_round = *self.first_round.get_or_init(Instant::now);
        if rows.len() < self.tracked && first_round.elapsed() < warmup(self.tracked) {
            anyhow::bail!("warming up, {} of {} markets have their index, mark and funding", rows.len(), self.tracked);
        }

        // Each push names the coming settlement, and a dead socket ages its rows past the engine's limit, so nothing moves it on here.
        Ok(rows)
    }
}

// Every connection opens at once and sends its book frames, then its ticker frames, one gap apart.
fn warmup(tracked: usize) -> Duration {
    let per_connection = tracked.div_ceil(connections(tracked)).max(1);
    subscribe_gap(tracked) * (2 * per_connection) as u32 + FIRST_TICKER_WAIT
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::cluster::Market;
    use crate::feeds::anchor_poller::AnchorRow;
    use crate::feeds::venue_feed::{BookVenue, Connection};
    use crate::venues::grvt::State;
    use crate::venues::testing::{self, http};
    use serde_json::{Value, json};
    use std::sync::OnceLock;

    const T0: i64 = 1_791_845_888_680; // 2026-10-12 22:58:08.680 UTC
    const NEXT: i64 = 1_791_849_600_000; // 2026-10-13 00:00 UTC

    fn market(raw_market_id: &str) -> Market {
        testing::market(super::super::ID, raw_market_id, "BTC", "USDT", true)
    }

    fn connection() -> Connection<State> {
        Connection::for_test("grvt#perp#0", vec![market("BTC_USDT_Perp"), market("AAPL_USDT_Perp")])
    }

    // v1.ticker.s pushes of BTC_USDT_Perp@500 captured live on 2026-10-12, cut to the fields the adapter reads and a few beside them.
    // Only the first push of a subscription, sequence 0, names the interval.
    fn first_push() -> Value {
        json!({"stream":"v1.ticker.s","selector":"BTC_USDT_Perp@500","sequence_number":"0","feed":{"event_time":"1791845887204002220","instrument":"BTC_USDT_Perp","mark_price":"82334.744140715","index_price":"82371.149208782","last_price":"82345.0","mid_price":"82343.35","best_bid_price":"82343.3","best_ask_price":"82343.4","funding_rate_8h_curr":"0.01","funding_rate_8h_avg":"0.01","open_interest":"2502.650333859","funding_rate":"0.01","funding_interval_hours":8,"next_funding_time":"1791849600000000000","status":"ACTIVE","session":"REGULAR"},"prev_sequence_number":"0"})
    }

    fn later_push(sequence: u64, mark: &str, index: &str) -> Value {
        json!({"stream":"v1.ticker.s","selector":"BTC_USDT_Perp@500","sequence_number":sequence.to_string(),"feed":{"event_time":"1791845887500028588","instrument":"BTC_USDT_Perp","mark_price":mark,"index_price":index,"last_price":"82345.0","mid_price":"82343.35","funding_rate_8h_curr":"0.01","funding_rate_8h_avg":"0.01","funding_rate":"0.01","next_funding_time":"1791849600000000000","status":"ACTIVE","session":"REGULAR"},"prev_sequence_number":(sequence - 1).to_string()})
    }

    fn feed(venue: &Grvt, conn: &mut Connection<State>, frame: Value, at: i64) {
        venue.handle_at(frame.to_string().as_bytes(), conn, at).unwrap();
    }

    async fn round(venue: &Grvt, ts: i64) -> AnchorMap {
        venue.fetch_round(&http(), ts).await.unwrap()
    }

    #[test]
    fn polls_every_second() {
        assert_eq!(Grvt::new(&[]).poll_every(), Duration::from_secs(1));
    }

    #[test]
    fn the_warmup_covers_every_frame_of_a_connection_and_the_first_push() {
        assert_eq!(warmup(0), Duration::from_millis(225 * 2 + 5_000));
        assert_eq!(warmup(60), Duration::from_millis(225 * 120 + 5_000));
        // Four connections of 46 at a 900 ms gap.
        assert_eq!(warmup(184), Duration::from_millis(900 * 92 + 5_000));
    }

    #[tokio::test]
    async fn the_first_push_anchors_a_market_with_the_rate_as_a_fraction_and_the_settlement_in_ms() {
        let venue = Grvt::new(&[]);
        let mut conn = connection();

        feed(&venue, &mut conn, first_push(), T0);

        assert_eq!(
            round(&venue, T0).await["BTC_USDT_Perp"],
            AnchorRow {
                index: 82371.149208782,
                mark: 82334.744140715,
                funding_rate: 0.0001,
                funding_interval_hours: 8.0,
                next_funding_at: NEXT,
                ts: Some(T0),
            }
        );
    }

    #[tokio::test]
    async fn a_later_push_keeps_the_interval_of_the_first_and_moves_the_prices_and_the_stamp() {
        let venue = Grvt::new(&[]);
        let mut conn = connection();
        feed(&venue, &mut conn, first_push(), T0);

        feed(&venue, &mut conn, later_push(50985, "82330.1", "82370.5"), T0 + 500);

        let row = round(&venue, T0 + 500).await["BTC_USDT_Perp"];
        assert_eq!((row.mark, row.index, row.funding_interval_hours), (82330.1, 82370.5, 8.0));
        assert_eq!(row.ts, Some(T0 + 500));
    }

    #[tokio::test]
    async fn a_push_before_any_interval_leaves_the_market_out() {
        let venue = Grvt::new(&[]);
        let mut conn = connection();

        feed(&venue, &mut conn, later_push(50985, "82330.1", "82370.5"), T0);

        assert!(round(&venue, T0).await.is_empty());
    }

    #[tokio::test]
    async fn a_repeated_push_does_not_restamp_the_row() {
        let venue = Grvt::new(&[]);
        let mut conn = connection();
        feed(&venue, &mut conn, first_push(), T0);
        feed(&venue, &mut conn, later_push(50986, "82330.1", "82370.5"), T0 + 500);

        feed(&venue, &mut conn, later_push(50986, "82330.1", "82370.5"), T0 + 900);
        feed(&venue, &mut conn, later_push(50985, "82000.0", "82000.0"), T0 + 950);

        let row = round(&venue, T0 + 1_000).await["BTC_USDT_Perp"];
        assert_eq!((row.mark, row.ts), (82330.1, Some(T0 + 500)));
    }

    #[tokio::test]
    async fn a_status_other_than_active_takes_the_row_out_until_the_market_trades_again() {
        let venue = Grvt::new(&[]);
        let mut conn = connection();
        feed(&venue, &mut conn, first_push(), T0);

        let mut delisted = later_push(50985, "82330.1", "82370.5");
        delisted["feed"]["status"] = json!("DELISTED");
        feed(&venue, &mut conn, delisted, T0 + 500);
        assert!(round(&venue, T0 + 500).await.is_empty());

        feed(&venue, &mut conn, later_push(50986, "82330.1", "82370.5"), T0 + 1_000);
        assert_eq!(round(&venue, T0 + 1_000).await["BTC_USDT_Perp"].ts, Some(T0 + 1_000));
    }

    #[tokio::test]
    async fn a_zero_or_missing_mark_keeps_the_row_out() {
        let venue = Grvt::new(&[]);
        let mut conn = connection();
        let mut zero = first_push();
        zero["feed"]["mark_price"] = json!("0.0");

        feed(&venue, &mut conn, zero, T0);
        assert!(round(&venue, T0).await.is_empty());

        let mut missing = first_push();
        missing["feed"].as_object_mut().unwrap().remove("mark_price");
        feed(&venue, &mut conn, missing, T0);
        assert!(round(&venue, T0).await.is_empty());
    }

    #[tokio::test]
    async fn a_zero_rate_is_a_rate_and_an_absent_settlement_is_unknown() {
        // AAPL_USDT_Perp read funding_rate "0.0" on 2026-10-12, as many equities did.
        let venue = Grvt::new(&[]);
        let mut conn = connection();
        let mut aapl = first_push();
        aapl["selector"] = json!("AAPL_USDT_Perp@500");
        aapl["feed"]["funding_rate"] = json!("0.0");
        aapl["feed"].as_object_mut().unwrap().remove("next_funding_time");

        feed(&venue, &mut conn, aapl, T0);

        let row = round(&venue, T0).await["AAPL_USDT_Perp"];
        assert_eq!((row.funding_rate, row.next_funding_at), (0.0, 0));
    }

    #[tokio::test]
    async fn a_round_fails_whole_until_every_market_is_anchored_or_the_warmup_ends() {
        let mut venue = Grvt::new(&testing::tracked(&[market("BTC_USDT_Perp"), market("AAPL_USDT_Perp")]));
        let mut conn = connection();
        feed(&venue, &mut conn, first_push(), T0);

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();
        assert_eq!(format!("{error}"), "warming up, 1 of 2 markets have their index, mark and funding");

        venue.first_round = OnceLock::from(Instant::now() - warmup(2));
        assert_eq!(round(&venue, T0).await.keys().collect::<Vec<_>>(), ["BTC_USDT_Perp"]);
    }

    #[tokio::test]
    async fn handle_stamps_the_prices_with_the_frame_arrival() {
        let venue = Grvt::new(&[]);
        let mut conn = connection();

        venue.handle(first_push().to_string().as_bytes(), &mut conn).unwrap();

        assert_eq!(round(&venue, T0).await["BTC_USDT_Perp"].ts, Some(conn.frame_recv_ts()));
    }
}
