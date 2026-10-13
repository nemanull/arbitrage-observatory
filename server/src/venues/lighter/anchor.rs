use super::{ID, Lighter};
use crate::feeds::anchor_poller::{AnchorMap, AnchorVenue, get_json};
use crate::venues::catalog::currency_code;
use serde::Deserialize;
use std::collections::HashSet;
use std::time::{Duration, Instant};

// Every deployed market settles hourly, while the docs call the period a setting of each market.
pub const FUNDING_INTERVAL_HOURS: f64 = 1.0;
const HOUR_MS: i64 = 3_600_000;

// Pre-IPO markets are priced only by Lighter's own book, so their index basket is the venue's own perpetual.
// They are the four rows whose funding_premium_multiplier was 1 on 2026-10-12.
const PRE_IPO: [&str; 4] = ["ANTHROPIC", "OPENAI", "OURA", "VARIATIONAL"];

// Names the sources of every market's index, among them Lighter's internal price, an EMA of its own book.
// An RWA market falls back to it while its oracle is stale, as 12 did at 23:20 UTC on 2026-10-12.
pub(super) const ORACLES_PATH: &str = "/api/v1/priceOracleInfo";

// A market moves to or from its internal price when its oracle stops or resumes, and a read a minute spends 1 of the 60 requests a Standard IP may make.
const ORACLES_EVERY: Duration = Duration::from_secs(60);
// A failed read is tried again no sooner than this, since the socket shares the REST budget.
const ORACLES_RETRY: Duration = Duration::from_secs(10);
const FAILURE_LOG_EVERY: u64 = 30;

// The first market_stats frame holds every market and came about 100 ms after its subscribe, so the rows fill well inside this.
const WARMUP: Duration = Duration::from_secs(10);

#[derive(Default)]
pub struct Oracles {
    internal: Option<HashSet<String>>, // bases whose index ran on Lighter's own price at the last read, None before the first
    tried_at: Option<Instant>,
    failures: u64, // consecutive failed reads
}

pub fn is_self_indexed(base: &str) -> bool {
    PRE_IPO.contains(&base)
}

// funding_timestamp is the last settlement, 0 or absent is unknown.
pub fn next_after_settlement(funding_timestamp: f64) -> i64 {
    if funding_timestamp.is_finite() && funding_timestamp > 0.0 {
        funding_timestamp as i64 + HOUR_MS
    } else {
        0
    }
}

// The REST bulk call is cached at the edge for 4 to 6 s and a Standard IP may make 60 requests a minute.
// So the book sockets subscribe market_stats/all, handle fills the map, and a round reads only the index sources, once a minute.
impl AnchorVenue for Lighter {
    async fn fetch_round(&self, http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        self.refresh_oracles(http).await;
        let mut rows = self.anchors.rows();

        // The first rounds run before the socket opens, and a round that fails whole logs one line where 200 missing rows would log one each.
        let first_round = *self.first_round.get_or_init(Instant::now);
        if rows.len() < self.anchored.len() && first_round.elapsed() < WARMUP {
            anyhow::bail!("warming up, {} of {} markets have their index, mark and funding", rows.len(), self.anchored.len());
        }

        // Until the sources are read, no index can be told apart from the venue's own price.
        {
            let oracles = self.oracles.lock().unwrap();
            let Some(internal) = &oracles.internal else {
                anyhow::bail!("the index sources are not read yet, {} failed reads", oracles.failures);
            };
            rows.retain(|raw_market_id, _| self.anchored.get(raw_market_id).is_some_and(|base| !internal.contains(base)));
        }

        for row in rows.values_mut() {
            row.next_funding_at = roll_forward(row.next_funding_at, ts);
        }
        Ok(rows)
    }
}

impl Lighter {
    // A failed read keeps the last list, so one refused request does not drop every anchor.
    async fn refresh_oracles(&self, http: &reqwest::Client) {
        {
            let mut oracles = self.oracles.lock().unwrap();
            let wait = if oracles.failures == 0 && oracles.internal.is_some() { ORACLES_EVERY } else { ORACLES_RETRY };
            if oracles.tried_at.is_some_and(|at| at.elapsed() < wait) {
                return;
            }
            oracles.tried_at = Some(Instant::now());
        }

        let fetched: anyhow::Result<OracleReply> = get_json(http, &format!("{}{ORACLES_PATH}", self.rest)).await;
        let mut oracles = self.oracles.lock().unwrap();
        match fetched {
            Ok(reply) => {
                let mut internal = HashSet::new();
                for market in &reply.markets {
                    if market.index.using_internal_price {
                        internal.insert(currency_code(&market.symbol, &[]));
                    }
                }
                if oracles.internal.as_ref() != Some(&internal) {
                    let mut bases: Vec<&String> = internal.iter().collect();
                    bases.sort();
                    tracing::info!(event = "anchor_sources_read", venue = ID, internal = internal.len(), markets = reply.markets.len(), bases = ?bases);
                }
                oracles.internal = Some(internal);
                oracles.failures = 0;
            }
            Err(error) => {
                oracles.failures += 1;
                if oracles.failures == 1 || oracles.failures % FAILURE_LOG_EVERY == 0 {
                    tracing::warn!(event = "anchor_sources_failed", venue = ID, failures = oracles.failures, error = format!("{error:#}"));
                }
            }
        }
    }
}

// A quiet market's last row can still name the settlement just past, so its next one is the first whole hour after the round.
fn roll_forward(next_funding_at: i64, ts: i64) -> i64 {
    if next_funding_at <= 0 || next_funding_at > ts {
        return next_funding_at;
    }
    next_funding_at + ((ts - next_funding_at) / HOUR_MS + 1) * HOUR_MS
}

#[derive(Deserialize)]
struct OracleReply {
    #[serde(default)]
    markets: Vec<OracleRow>,
}

#[derive(Deserialize)]
struct OracleRow {
    #[serde(default)]
    symbol: String,
    #[serde(default)]
    index: OracleSource,
}

#[derive(Deserialize, Default)]
struct OracleSource {
    #[serde(default)]
    using_internal_price: bool, // true where source is "internal_price"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::engine::cluster::Market;
    use crate::feeds::anchor_poller::AnchorRow;
    use crate::feeds::venue_feed::{BookVenue, Connection};
    use crate::test_log::capture;
    use crate::venues::lighter::State;
    use crate::venues::testing::{self, MockRest, http};
    use serde_json::{Value, json};
    use std::sync::OnceLock;

    const T0: i64 = 1_791_844_929_453; // 2026-10-12 22:42:09.453 UTC, the envelope time of the row below
    const LAST_SETTLEMENT: i64 = 1_791_842_400_000; // 22:00 UTC
    const NEXT_SETTLEMENT: i64 = 1_791_846_000_000; // 23:00 UTC

    fn market(raw_market_id: &str, base: &str) -> Market {
        testing::market(super::super::ID, raw_market_id, base, "USDC", true)
    }

    // A local host that names the index sources, with every index on its oracles unless a case says otherwise.
    async fn venue(markets: &[Market]) -> (Lighter, MockRest) {
        let rest = MockRest::start().await;
        rest.reply(ORACLES_PATH, oracles(&[]));
        (Lighter::with_rest(&rest.url, &testing::tracked(markets)), rest)
    }

    fn connection(markets: Vec<Market>) -> Connection<State> {
        Connection::for_test("lighter#perp#0", markets)
    }

    // GET /api/v1/priceOracleInfo captured live on 2026-10-12 at 23:20 UTC, cut to an oracle median and an internal price.
    fn oracle_row(symbol: &str, internal: bool) -> Value {
        if internal {
            return json!({"symbol":symbol,"index":{"source":"internal_price","using_median":false,"using_internal_price":true,"median_sources":[],
                "price_cap_bps":1000,"price_cap_reference_price":6.31035},"mark":{"source":"internal_price","using_median":false,
                "using_internal_price":true,"median_sources":[],"price_cap_bps":1000,"price_cap_reference_price":6.31035}});
        }
        json!({"symbol":symbol,"index":{"source":"median","using_median":true,"using_internal_price":false,
            "median_sources":["pythlazer / usdt","stork / usdt","chainlink / usdt","binance","mexc"],"price_cap_bps":0,"price_cap_reference_price":0},
            "mark":{"source":"median","using_median":true,"using_internal_price":false,"median_sources":["chainlink / usdt","binance","mexc"],
            "price_cap_bps":0,"price_cap_reference_price":0}})
    }

    fn oracles(internal: &[&str]) -> Value {
        let mut markets = vec![oracle_row("ETH", false), oracle_row("BTC", false)];
        for symbol in internal {
            markets.push(oracle_row(symbol, true));
        }
        json!({"code":200,"computed_at_ms":1791847222015_i64,"markets":markets})
    }

    // One row of market_stats/all captured live on 2026-10-12, as the profile's websocket.md section 6 quotes it.
    fn eth_row() -> Value {
        json!({"symbol":"ETH","market_id":0,"index_price":"2486.17","mark_price":"2485.07","mid_price":"2484.62","best_ask_price":"2484.69",
            "best_bid_price":"2484.54","open_interest":"80697722.841260","open_interest_limit":"72057594037927936.000000",
            "funding_clamp_small":"0.0500","funding_clamp_big":"4.0000","last_trade_price":"2484.54","current_funding_rate":"0.0012",
            "funding_rate":"0.0001","funding_timestamp":1791842400000_i64,"daily_base_token_volume":146602.894,
            "daily_quote_token_volume":372045636.931112,"daily_price_low":2479.37,"daily_price_high":2578.09,
            "daily_price_change":-1.9987616196752604,"base_interest_rate":"0.0100","premium":"-0.0384"})
    }

    fn stats(kind: &str, rows: &[(&str, Value)]) -> Value {
        let mut keyed = serde_json::Map::new();
        for (key, row) in rows {
            keyed.insert(key.to_string(), row.clone());
        }
        json!({"channel":"market_stats:all","market_stats":keyed,"timestamp":T0,"type":kind})
    }

    fn feed(venue: &Lighter, conn: &mut Connection<State>, frame: Value, at: i64) {
        venue.handle_at(frame.to_string().as_bytes(), conn, at).unwrap();
    }

    async fn round(venue: &Lighter, ts: i64) -> AnchorMap {
        venue.fetch_round(&http(), ts).await.unwrap()
    }

    fn warm(venue: &mut Lighter) {
        venue.first_round = OnceLock::from(Instant::now() - WARMUP);
    }

    // As if the last read was this long ago.
    fn read_ago(venue: &Lighter, ago: Duration) {
        venue.oracles.lock().unwrap().tried_at = Some(Instant::now() - ago);
    }

    #[tokio::test]
    async fn polls_every_second() {
        assert_eq!(venue(&[]).await.0.poll_every(), Duration::from_secs(1));
    }

    #[test]
    fn the_next_settlement_rolls_to_the_first_whole_hour_after_the_round() {
        assert_eq!(roll_forward(NEXT_SETTLEMENT, T0), NEXT_SETTLEMENT);
        assert_eq!(roll_forward(NEXT_SETTLEMENT, NEXT_SETTLEMENT), NEXT_SETTLEMENT + HOUR_MS);
        assert_eq!(roll_forward(NEXT_SETTLEMENT, NEXT_SETTLEMENT + 90_000), NEXT_SETTLEMENT + HOUR_MS);
        assert_eq!(roll_forward(NEXT_SETTLEMENT, NEXT_SETTLEMENT + HOUR_MS), NEXT_SETTLEMENT + 2 * HOUR_MS);
        assert_eq!(roll_forward(0, T0), 0);
    }

    #[test]
    fn the_next_settlement_is_an_hour_after_the_last_and_unknown_without_one() {
        assert_eq!(next_after_settlement(LAST_SETTLEMENT as f64), NEXT_SETTLEMENT);
        assert_eq!(next_after_settlement(0.0), 0);
        assert_eq!(next_after_settlement(f64::NAN), 0);
    }

    #[tokio::test]
    async fn a_row_maps_index_mark_and_the_hourly_percent_estimate_stamped_with_its_arrival() {
        let markets = [market("0", "ETH")];
        let (venue, _rest) = venue(&markets).await;
        let mut conn = connection(markets.to_vec());

        feed(&venue, &mut conn, stats("update/market_stats", &[("0", eth_row())]), T0 + 52);

        assert_eq!(
            round(&venue, T0 + 500).await["0"],
            AnchorRow {
                index: 2486.17,
                mark: 2485.07,
                funding_rate: 0.0012 / 100.0, // 0.0012 % an hour
                funding_interval_hours: 1.0,
                next_funding_at: NEXT_SETTLEMENT,
                ts: Some(T0 + 52),
            }
        );
    }

    #[tokio::test]
    async fn a_negative_rate_keeps_its_sign() {
        let markets = [market("0", "ETH")];
        let (venue, _rest) = venue(&markets).await;
        let mut conn = connection(markets.to_vec());
        let mut row = eth_row();
        row["current_funding_rate"] = json!("-0.2073");

        feed(&venue, &mut conn, stats("subscribed/market_stats", &[("0", row)]), T0);

        assert_eq!(round(&venue, T0).await["0"].funding_rate, -0.2073 / 100.0);
    }

    #[tokio::test]
    async fn rows_of_markets_outside_the_catalog_and_of_pre_ipo_markets_are_left_out() {
        let markets = [market("0", "ETH"), market("192", "OPENAI")];
        let (venue, _rest) = venue(&markets).await;
        let mut conn = connection(markets.to_vec());
        let mut openai = eth_row();
        openai["symbol"] = json!("OPENAI");

        // 28 is the inactive MKR, which the first frame still carries.
        feed(&venue, &mut conn, stats("subscribed/market_stats", &[("0", eth_row()), ("192", openai), ("28", eth_row())]), T0);

        let rows = round(&venue, T0).await;
        assert_eq!(rows.keys().collect::<Vec<_>>(), ["0"]);
    }

    #[tokio::test]
    async fn a_market_whose_index_runs_on_the_internal_price_is_left_out_until_its_oracle_returns() {
        let (logs, _capture) = capture();
        let markets = [market("0", "ETH"), market("201", "TENCENT")];
        let (venue, rest) = venue(&markets).await;
        rest.reply(ORACLES_PATH, oracles(&["TENCENT", "WEN"]));
        let mut conn = connection(markets.to_vec());
        feed(&venue, &mut conn, stats("subscribed/market_stats", &[("0", eth_row()), ("201", eth_row())]), T0);

        let closed = round(&venue, T0).await;
        rest.reply(ORACLES_PATH, oracles(&[]));
        let unchanged = round(&venue, T0).await;
        read_ago(&venue, ORACLES_EVERY);
        let open = round(&venue, T0).await;

        assert_eq!(closed.keys().collect::<Vec<_>>(), ["0"]);
        assert_eq!(unchanged.len(), 1);
        assert_eq!(open.len(), 2);
        assert_eq!(rest.calls(), [ORACLES_PATH, ORACLES_PATH]);
        let read = logs.events("anchor_sources_read");
        assert_eq!(read.len(), 2);
        assert_eq!(read[0].number("internal"), 2.0);
        assert_eq!(read[1].number("internal"), 0.0);
    }

    #[tokio::test]
    async fn every_round_fails_until_the_sources_are_read_and_a_failed_read_is_retried_after_10_s() {
        let (logs, _capture) = capture();
        let markets = [market("0", "ETH")];
        let (mut venue, rest) = venue(&markets).await;
        warm(&mut venue);
        rest.fail(ORACLES_PATH, 403);
        let mut conn = connection(markets.to_vec());
        feed(&venue, &mut conn, stats("subscribed/market_stats", &[("0", eth_row())]), T0);

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();
        assert_eq!(format!("{error}"), "the index sources are not read yet, 1 failed reads");
        assert!(venue.fetch_round(&http(), T0).await.is_err());
        assert_eq!(rest.calls().len(), 1);

        rest.reply(ORACLES_PATH, oracles(&[]));
        read_ago(&venue, ORACLES_RETRY);
        assert_eq!(round(&venue, T0).await.len(), 1);
        assert_eq!(rest.calls().len(), 2);
        assert_eq!(logs.events("anchor_sources_failed").len(), 1);
    }

    #[tokio::test]
    async fn a_failed_read_keeps_the_last_sources() {
        let markets = [market("0", "ETH"), market("201", "TENCENT")];
        let (venue, rest) = venue(&markets).await;
        rest.reply(ORACLES_PATH, oracles(&["TENCENT"]));
        let mut conn = connection(markets.to_vec());
        feed(&venue, &mut conn, stats("subscribed/market_stats", &[("0", eth_row()), ("201", eth_row())]), T0);
        round(&venue, T0).await;

        rest.fail(ORACLES_PATH, 500);
        read_ago(&venue, ORACLES_EVERY);
        let rows = round(&venue, T0).await;

        assert_eq!(rows.keys().collect::<Vec<_>>(), ["0"]);
        assert_eq!(rest.calls().len(), 2);
    }

    #[tokio::test]
    async fn a_quiet_market_keeps_the_arrival_of_its_last_row_so_its_reading_ages() {
        let markets = [market("0", "ETH"), market("1", "BTC")];
        let (venue, _rest) = venue(&markets).await;
        let mut conn = connection(markets.to_vec());
        feed(&venue, &mut conn, stats("subscribed/market_stats", &[("0", eth_row()), ("1", eth_row())]), T0);

        let mut moved = eth_row();
        moved["index_price"] = json!("2487.00");
        feed(&venue, &mut conn, stats("update/market_stats", &[("1", moved)]), T0 + 13_000);

        let rows = round(&venue, T0 + 13_500).await;
        assert_eq!(rows["0"].ts, Some(T0));
        assert_eq!(rows["0"].index, 2486.17);
        assert_eq!(rows["1"].ts, Some(T0 + 13_000));
        assert_eq!(rows["1"].index, 2487.0);
    }

    #[tokio::test]
    async fn an_unparsable_price_keeps_the_last_reading_and_its_stamp() {
        let markets = [market("0", "ETH")];
        let (venue, _rest) = venue(&markets).await;
        let mut conn = connection(markets.to_vec());
        feed(&venue, &mut conn, stats("subscribed/market_stats", &[("0", eth_row())]), T0);

        let mut broken = eth_row();
        broken["index_price"] = json!("");
        broken["mark_price"] = Value::Null;
        feed(&venue, &mut conn, stats("update/market_stats", &[("0", broken)]), T0 + 1_000);

        let row = round(&venue, T0 + 1_000).await["0"];
        assert_eq!((row.index, row.mark, row.ts), (2486.17, 2485.07, Some(T0)));
    }

    #[tokio::test]
    async fn a_zero_index_keeps_the_market_out() {
        let markets = [market("0", "ETH")];
        let (mut venue, _rest) = venue(&markets).await;
        warm(&mut venue);
        let mut conn = connection(markets.to_vec());
        let mut row = eth_row();
        row["index_price"] = json!("0.0000");

        feed(&venue, &mut conn, stats("subscribed/market_stats", &[("0", row)]), T0);

        assert!(round(&venue, T0).await.is_empty());
    }

    #[tokio::test]
    async fn a_round_fails_whole_until_every_anchored_market_has_a_row_or_the_warmup_ends() {
        let markets = [market("0", "ETH"), market("1", "BTC"), market("193", "ANTHROPIC")];
        let (mut venue, _rest) = venue(&markets).await;
        let mut conn = connection(markets.to_vec());
        feed(&venue, &mut conn, stats("subscribed/market_stats", &[("0", eth_row())]), T0);

        let error = venue.fetch_round(&http(), T0).await.unwrap_err();
        assert_eq!(format!("{error}"), "warming up, 1 of 2 markets have their index, mark and funding");

        warm(&mut venue);
        assert_eq!(round(&venue, T0).await.keys().collect::<Vec<_>>(), ["0"]);
    }

    #[tokio::test]
    async fn the_pre_ipo_markets_do_not_hold_up_the_warmup() {
        let markets = [market("0", "ETH"), market("193", "ANTHROPIC")];
        let (venue, _rest) = venue(&markets).await;
        let mut conn = connection(markets.to_vec());

        feed(&venue, &mut conn, stats("subscribed/market_stats", &[("0", eth_row())]), T0);

        assert_eq!(round(&venue, T0).await.len(), 1);
    }

    #[tokio::test]
    async fn a_round_after_the_settlement_points_at_the_next_one_until_the_row_moves() {
        let markets = [market("0", "ETH")];
        let (venue, _rest) = venue(&markets).await;
        let mut conn = connection(markets.to_vec());
        feed(&venue, &mut conn, stats("subscribed/market_stats", &[("0", eth_row())]), T0);

        let row = round(&venue, NEXT_SETTLEMENT + 2_000).await["0"];

        assert_eq!(row.next_funding_at, NEXT_SETTLEMENT + HOUR_MS);
    }

    #[tokio::test]
    async fn handle_stamps_the_row_with_the_frame_arrival() {
        let markets = [market("0", "ETH")];
        let (venue, _rest) = venue(&markets).await;
        let mut conn = connection(markets.to_vec());

        venue.handle(stats("subscribed/market_stats", &[("0", eth_row())]).to_string().as_bytes(), &mut conn).unwrap();

        assert_eq!(round(&venue, T0).await["0"].ts, Some(conn.frame_recv_ts()));
    }

    #[tokio::test]
    async fn a_stats_frame_touches_no_book() {
        let markets = [market("0", "ETH")];
        let (venue, _rest) = venue(&markets).await;
        let mut conn = connection(markets.to_vec());

        feed(&venue, &mut conn, stats("update/market_stats", &[("0", eth_row())]), T0);

        assert!(conn.take_published().is_empty());
    }
}
