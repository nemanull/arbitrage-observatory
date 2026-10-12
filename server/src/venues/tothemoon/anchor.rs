use super::Tothemoon;
use crate::feeds::anchor_poller::{AnchorMap, AnchorVenue};
use std::time::{Duration, Instant};

// Every ticker arrived within 1.2 s of its subscribe on 2026-10-09, so the rows fill well inside this.
const WARMUP: Duration = Duration::from_secs(10);

// Markets whose index is not the market price of their coin, so their rows are left out under decision 19.
// On 2026-10-09 ATOM's index read 2.254 against its own book at 2.033 and gate's index at 2.037, about 11 percent high.
// ETC's read 8.921 against its own book at 8.277 and gate's index at 8.286, about 8 percent high.
// On 2026-09-23 they sat about 14 and 4 percent high, and the index basket is not published.
const SKEWED_INDEX: &[&str] = &["ATOM_USDT_PERPETUAL", "ETC_USDT_PERPETUAL"];

pub(super) fn skewed_index(raw_market_id: &str) -> bool {
    SKEWED_INDEX.contains(&raw_market_id)
}

// No REST call carries an index, a mark or a funding rate, so the book sockets subscribe the tickers and handle fills the rows.
// A round makes no request, so the poller's rate limit pause never applies.
impl AnchorVenue for Tothemoon {
    async fn fetch_round(&self, _http: &reqwest::Client, _ts: i64) -> anyhow::Result<AnchorMap> {
        let mut rows = self.anchors.rows();
        rows.retain(|raw_market_id, _| !skewed_index(raw_market_id));

        // The first rounds run before the socket opens, and a round that fails whole logs one line where 13 missing rows would log one each.
        let first_round = *self.first_round.get_or_init(Instant::now);
        if rows.len() < self.expected && first_round.elapsed() < WARMUP {
            anyhow::bail!("warming up, {} of {} markets have their index, mark and funding", rows.len(), self.expected);
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
    use std::collections::HashMap;
    use std::sync::OnceLock;

    const T0: i64 = 1_791_576_080_036; // 2026-10-09 20:01:20.036 UTC, the arrival of the captured tickers

    fn market(raw_market_id: &str) -> Market {
        let base = raw_market_id.split('_').next().unwrap();
        testing::market(super::super::ID, raw_market_id, base, "USDT", true)
    }

    fn connection() -> Connection<HashMap<usize, u64>> {
        Connection::for_test("tothemoon#perp#0", vec![market("BTC_USDT_PERPETUAL"), market("AVAX_USDT_PERPETUAL")])
    }

    // Tickers captured live on 2026-10-09.
    fn btc_ticker() -> Value {
        json!({"type":"subscriptionData","server_timestamp":1791576079945_i64,"request_id":"turboTickers.*","payload":{"channel":"turboTickers.*","data":{
            "instrument_id":"BTC_USDT_PERPETUAL","mark_price":"82359.3","fair_price":"82359.3","last_trade_price":"82327.3","last_trade_type":"SELL",
            "index_price":"82359.3","last_funding_time":1790776800000_i64,"funding_rate":"0.000000000000000000","funding_interval":28800000,
            "premium_index":"0.000000000000000000","interest_rate":"0.000000000000000000","1d_high":"83465.3","1d_low":"81581.9","1d_volume":"11449405",
            "best_bid":"82326.6","best_ask":"82327.8","mid_price":"82327.2","price_change":"609.3","price_change_percent":"0.75",
            "contract_size":"0.000001","offset":630700925825_i64,"provider_offset":127602807948_i64},"nonce":11}})
    }

    fn avax_ticker() -> Value {
        json!({"type":"subscriptionData","server_timestamp":1791576079945_i64,"request_id":"turboTickers.*","payload":{"channel":"turboTickers.*","data":{
            "instrument_id":"AVAX_USDT_PERPETUAL","mark_price":"10.145","fair_price":"10.145","last_trade_price":"10.149","last_trade_type":"BUY",
            "index_price":"10.145","last_funding_time":1790780400000_i64,"funding_rate":"0.000000000000000000","funding_interval":3600000,
            "premium_index":"0.000000000000000000","interest_rate":"0.000000000000000000","best_bid":"10.137","best_ask":"10.141","mid_price":"10.139",
            "contract_size":"0.0001","offset":630700928791_i64,"provider_offset":127602808098_i64},"nonce":9}})
    }

    fn atom_ticker() -> Value {
        json!({"type":"subscriptionData","server_timestamp":1791576079945_i64,"request_id":"turboTickers.*","payload":{"channel":"turboTickers.*","data":{
            "instrument_id":"ATOM_USDT_PERPETUAL","mark_price":"2.237","fair_price":"2.237","last_trade_price":"2.018","last_trade_type":"BUY",
            "index_price":"2.237","last_funding_time":1790755200000_i64,"funding_rate":"0.000000000000000000","funding_interval":28800000,
            "premium_index":"0.000000000000000000","interest_rate":"0.000000000000000000","best_bid":"2.016","best_ask":"2.020","mid_price":"2.018",
            "contract_size":"0.001","offset":630700929002_i64,"provider_offset":127602808186_i64},"nonce":7}})
    }

    fn feed(venue: &Tothemoon, conn: &mut Connection<HashMap<usize, u64>>, frame: Value) {
        venue.handle(frame.to_string().as_bytes(), conn).unwrap();
    }

    async fn round(venue: &Tothemoon) -> AnchorMap {
        venue.fetch_round(&http(), T0).await.unwrap()
    }

    #[test]
    fn polls_every_second() {
        assert_eq!(Tothemoon::new(&[]).poll_every(), Duration::from_secs(1));
    }

    #[tokio::test]
    async fn a_ticker_fills_the_index_the_mark_a_zero_rate_and_its_interval_with_no_next_settlement() {
        let venue = Tothemoon::new(&[]);
        let mut conn = connection();

        feed(&venue, &mut conn, btc_ticker());

        assert_eq!(
            round(&venue).await["BTC_USDT_PERPETUAL"],
            AnchorRow {
                index: 82359.3,
                mark: 82359.3,
                funding_rate: 0.0,
                funding_interval_hours: 8.0,
                next_funding_at: 0,
                ts: Some(conn.frame_recv_ts()),
            }
        );
    }

    #[tokio::test]
    async fn reads_the_interval_of_each_market_from_its_own_ticker() {
        let venue = Tothemoon::new(&[]);
        let mut conn = connection();

        feed(&venue, &mut conn, avax_ticker());

        assert_eq!(round(&venue).await["AVAX_USDT_PERPETUAL"].funding_interval_hours, 1.0);
    }

    #[tokio::test]
    async fn leaves_out_the_markets_whose_index_is_not_the_coin_price() {
        let venue = Tothemoon::new(&[]);
        let mut conn = Connection::for_test("tothemoon#perp#0", vec![market("ATOM_USDT_PERPETUAL"), market("BTC_USDT_PERPETUAL")]);

        feed(&venue, &mut conn, atom_ticker());
        feed(&venue, &mut conn, btc_ticker());

        assert_eq!(round(&venue).await.keys().collect::<Vec<_>>(), ["BTC_USDT_PERPETUAL"]);
        assert!(skewed_index("ETC_USDT_PERPETUAL"));
    }

    #[tokio::test]
    async fn a_ticker_for_a_market_on_no_book_socket_is_kept_without_a_warning() {
        let (logs, _capture) = crate::test_log::capture();
        let venue = Tothemoon::new(&[]);
        let mut conn = Connection::for_test("tothemoon#perp#0", vec![market("BTC_USDT_PERPETUAL")]);

        feed(&venue, &mut conn, avax_ticker());

        assert!(round(&venue).await.contains_key("AVAX_USDT_PERPETUAL"));
        assert!(logs.events("unsubscribed_symbol").is_empty());
    }

    #[tokio::test]
    async fn ts_is_the_ticker_arrival_and_not_the_round_clock_so_a_dead_socket_ages_its_rows() {
        let venue = Tothemoon::new(&[]);
        let mut conn = connection();
        feed(&venue, &mut conn, btc_ticker());

        let rows = venue.fetch_round(&http(), T0 + 60_000).await.unwrap();

        assert_eq!(rows["BTC_USDT_PERPETUAL"].ts, Some(conn.frame_recv_ts()));
        assert!(conn.frame_recv_ts() < T0);
    }

    #[tokio::test]
    async fn an_unparsable_index_keeps_the_market_out() {
        let venue = Tothemoon::new(&[]);
        let mut conn = connection();
        let mut ticker = btc_ticker();
        ticker["payload"]["data"]["index_price"] = json!("");

        feed(&venue, &mut conn, ticker);

        assert!(round(&venue).await.is_empty());
    }

    #[tokio::test]
    async fn a_ticker_without_its_interval_keeps_the_market_out() {
        let venue = Tothemoon::new(&[]);
        let mut conn = connection();
        let mut ticker = btc_ticker();
        ticker["payload"]["data"].as_object_mut().unwrap().remove("funding_interval");

        feed(&venue, &mut conn, ticker);

        assert!(round(&venue).await.is_empty());
    }

    #[tokio::test]
    async fn a_later_ticker_replaces_the_index_and_the_mark() {
        let venue = Tothemoon::new(&[]);
        let mut conn = connection();
        feed(&venue, &mut conn, btc_ticker());

        let mut ticker = btc_ticker();
        ticker["payload"]["data"]["index_price"] = json!("82400.1");
        ticker["payload"]["data"]["mark_price"] = json!("82400.1");
        feed(&venue, &mut conn, ticker);

        let row = &round(&venue).await["BTC_USDT_PERPETUAL"];
        assert_eq!((row.index, row.mark), (82400.1, 82400.1));
    }

    #[tokio::test]
    async fn a_round_fails_whole_until_every_market_with_a_true_index_is_anchored_or_the_warmup_ends() {
        let tracked = testing::tracked(&[
            market("BTC_USDT_PERPETUAL"),
            market("AVAX_USDT_PERPETUAL"),
            market("ATOM_USDT_PERPETUAL"),
        ]);
        let mut venue = Tothemoon::new(&tracked);
        let mut conn = connection();
        feed(&venue, &mut conn, btc_ticker());

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();
        assert_eq!(format!("{error}"), "warming up, 1 of 2 markets have their index, mark and funding");

        feed(&venue, &mut conn, avax_ticker());
        assert_eq!(round(&venue).await.len(), 2);

        venue = Tothemoon::new(&tracked);
        venue.first_round = OnceLock::from(Instant::now() - WARMUP);
        assert!(round(&venue).await.is_empty());
    }
}
