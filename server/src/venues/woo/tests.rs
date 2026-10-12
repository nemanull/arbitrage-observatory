// The engine's received levels are read through Connection::take_published after each frame or snapshot.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

const SOL: &str = "PERP_SOL_USDT";

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.split('_').nth(1).unwrap();
    Market {
        taker_ppm: 300,
        ..testing::market(ID, raw_market_id, base, "USDT", true)
    }
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("PERP_SYM{i}_USDT")));
    }
    markets
}

fn venue() -> Woo {
    Woo::new()
}

fn connection(ids: &[&str]) -> Connection<State> {
    Connection::for_test("woo#perp#0", ids.iter().map(|id| market(id)).collect())
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

fn send(conn: &mut Connection<State>, frame: Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn snapshot(conn: &mut Connection<State>, position: usize, body: Value) -> Published {
    venue().handle_snapshot(position, body.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

// The acknowledgement of one market's topic, as the venue answered a subscribe on 2026-10-08.
fn ack(id: &str, markets: &[&str]) -> Value {
    let topics: Vec<String> = markets.iter().map(|market| topic(market)).collect();
    json!({ "id": id, "cmd": "SUBSCRIBE", "success": true, "time": 1791514188807_i64, "data": topics })
}

// The PERP_SOL_USDT REST book of 2026-10-08 at timestamp 1791514421113, cut to four levels a side.
const SOL_SNAPSHOT_TS: i64 = 1791514421113;

fn sol_snapshot() -> Value {
    json!({
        "success": true,
        "timestamp": SOL_SNAPSHOT_TS,
        "data": {
            "asks": [
                { "price": "111.08", "quantity": "1.864" }, { "price": "111.09", "quantity": "13.021" },
                { "price": "111.1", "quantity": "57.917" }, { "price": "111.31", "quantity": "28.484" },
            ],
            "bids": [
                { "price": "109.89", "quantity": "28.442" }, { "price": "109.88", "quantity": "14.872" },
                { "price": "109.87", "quantity": "28.484" }, { "price": "109.69", "quantity": "29.325" },
            ],
        },
    })
}

fn sol_book() -> (Vec<BookLevel>, Vec<BookLevel>) {
    (
        levels(&[(109.89, 28.442), (109.88, 14.872), (109.87, 28.484), (109.69, 29.325)]),
        levels(&[(111.08, 1.864), (111.09, 13.021), (111.1, 57.917), (111.31, 28.484)]),
    )
}

// Consecutive SOL deltas captured on the same day: the one the snapshot covers, then the three after it.
fn delta(prev_ts: i64, ts: i64, bids: Value, asks: Value) -> Value {
    json!({
        "topic": "orderbookupdate@PERP_SOL_USDT@50",
        "ts": ts,
        "data": { "ts": ts, "bids": bids, "asks": asks, "prevTs": prev_ts, "s": SOL },
    })
}

fn sol_covered() -> Value {
    delta(1791514414513, SOL_SNAPSHOT_TS, json!([["109.67", "30.870"], ["109.41", "0"]]), json!([]))
}

fn sol_first() -> Value {
    delta(SOL_SNAPSHOT_TS, 1791514427913, json!([["109.90", "29.244"], ["109.69", "0"]]), json!([]))
}

fn sol_second() -> Value {
    delta(1791514427913, 1791514432713, json!([]), json!([["111.46", "0"], ["111.67", "30.872"]]))
}

fn sol_third() -> Value {
    delta(1791514432713, 1791514438563, json!([["110.02", "1.863"], ["109.88", "13.008"]]), json!([]))
}

// A SOL connection whose snapshot fetch has started, so the runtime has taken it off the queue, as a request made now shows.
fn waiting() -> Connection<State> {
    let mut conn = connection(&[SOL]);
    conn.state.books.insert(0, Seed::Waiting(VecDeque::new()));
    conn
}

// A SOL connection seeded from the snapshot, with nothing published or queued.
fn seeded() -> Connection<State> {
    let mut conn = waiting();
    snapshot(&mut conn, 0, sol_snapshot());
    conn
}

// settings and plan

#[test]
fn puts_50_markets_on_each_connection_to_the_v3_public_socket() {
    let plans = venue().plan(&markets(222));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [50, 50, 50, 50, 22]);
    assert_eq!(plans[0].id, "woo#perp#0");
    assert_eq!(plans[4].id, "woo#perp#4");
    assert_eq!(plans[0].url, "wss://wss.woox.io/v3/public");
}

#[test]
fn pings_every_15_seconds_reads_45_seconds_of_silence_as_dead_and_paces_snapshots_600_ms_apart_within_the_first_book_wait() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(15)));
    assert_eq!(settings.max_silence, Duration::from_secs(45));
    assert_eq!(settings.snapshot_gap, Duration::from_millis(600));
    assert!(settings.first_book_wait > settings.snapshot_gap * MARKETS_PER_CONNECTION as u32);
}

// subscribe_frames and ping

#[test]
fn subscribes_ten_topics_a_frame_and_remembers_what_each_id_asked_for() {
    let mut state = State::default();
    let slice = markets(23);

    let frames = venue().subscribe_frames(&slice, &mut state);

    assert_eq!(frames.len(), 3);
    let first = parsed(&frames[0]);
    assert_eq!(first["id"], "1");
    assert_eq!(first["cmd"], "SUBSCRIBE");
    assert_eq!(first["params"].as_array().unwrap().len(), 10);
    assert_eq!(first["params"][0], "orderbookupdate@PERP_SYM0_USDT@50");
    assert_eq!(parsed(&frames[2])["params"].as_array().unwrap().len(), 3);
    assert_eq!(state.requested["3"], ["orderbookupdate@PERP_SYM20_USDT@50", "orderbookupdate@PERP_SYM21_USDT@50", "orderbookupdate@PERP_SYM22_USDT@50"]);
}

#[test]
fn pings_with_the_application_ping_stamped_in_ms() {
    let before = now_ms();

    let ping = parsed(&venue().ping(&mut State::default()));

    assert_eq!(ping["cmd"], "PING");
    let ts = ping["ts"].as_i64().unwrap();
    assert!(before <= ts && ts <= now_ms());
}

// acknowledgement and snapshot requests

#[test]
fn asks_for_the_snapshot_of_every_acknowledged_market_in_order() {
    let (logs, _capture) = capture();
    let ids = ["PERP_BTC_USDT", "PERP_ETH_USDT", SOL];
    let mut conn = connection(&ids);
    let slice = conn.markets().to_vec();
    venue().subscribe_frames(&slice, &mut conn.state);

    let published = send(&mut conn, ack("1", &[SOL, "PERP_BTC_USDT", "PERP_ETH_USDT"]));

    assert!(published.is_empty());
    assert_eq!(conn.queued_snapshots(), [2, 0, 1]);
    assert!(logs.events("subscribe_refused").is_empty());
}

#[test]
fn logs_each_requested_topic_the_acknowledgement_left_out() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["PERP_BTC_USDT", "PERP_NOPE_USDT"]);
    let slice = conn.markets().to_vec();
    venue().subscribe_frames(&slice, &mut conn.state);

    send(&mut conn, ack("1", &["PERP_BTC_USDT"]));

    assert_eq!(conn.queued_snapshots(), [0]);
    let refused = logs.events("subscribe_refused");
    assert_eq!(refused.len(), 1);
    assert_eq!(refused[0].level, Level::ERROR);
    assert_eq!(refused[0].number("refused"), 1.0);
    assert!(refused[0].text("topics").contains("orderbookupdate@PERP_NOPE_USDT@50"));
}

#[test]
fn builds_the_snapshot_url_for_the_whole_rest_book() {
    let url = venue().snapshot_url(&market(SOL)).unwrap();

    assert_eq!(url, "https://api.woox.io/v3/public/orderbook?symbol=PERP_SOL_USDT&maxLevel=1000");
}

// seeding

#[test]
fn seeds_the_book_from_the_rest_snapshot() {
    let mut conn = connection(&[SOL]);
    send(&mut conn, ack("1", &[SOL]));

    let published = snapshot(&mut conn, 0, sol_snapshot());

    let (bids, asks) = sol_book();
    assert_eq!(published, [(SOL.to_string(), bids, asks)]);
}

#[test]
fn seeds_an_empty_rest_book_as_an_empty_book() {
    let mut conn = connection(&["PERP_ZK_USDT"]);
    send(&mut conn, ack("1", &["PERP_ZK_USDT"]));

    let published = snapshot(&mut conn, 0, json!({ "success": true, "timestamp": 1791514233000_i64, "data": { "asks": [], "bids": [] } }));

    assert_eq!(published, [("PERP_ZK_USDT".to_string(), Vec::new(), Vec::new())]);
}

#[test]
fn replays_the_held_deltas_newer_than_the_snapshot_and_drops_the_ones_it_covers() {
    let mut conn = connection(&[SOL]);
    send(&mut conn, ack("1", &[SOL]));
    assert!(send(&mut conn, sol_covered()).is_empty());
    assert!(send(&mut conn, sol_first()).is_empty());
    assert!(send(&mut conn, sol_second()).is_empty());

    let published = snapshot(&mut conn, 0, sol_snapshot());

    assert_eq!(published[0].1, levels(&[(109.9, 29.244), (109.89, 28.442), (109.88, 14.872), (109.87, 28.484)]));
    assert_eq!(published[0].2, levels(&[(111.08, 1.864), (111.09, 13.021), (111.1, 57.917), (111.31, 28.484), (111.67, 30.872)]));
    assert!(!conn.resync_requested());

    let next = send(&mut conn, sol_third());
    assert_eq!(next[0].1[0], BookLevel { price: 110.02, size: 1.863 });
}

#[test]
fn fetches_again_a_snapshot_behind_the_held_deltas_and_publishes_nothing() {
    let (logs, _capture) = capture();
    let mut conn = waiting();
    send(&mut conn, sol_second());
    send(&mut conn, sol_third());

    let published = snapshot(&mut conn, 0, sol_snapshot());

    assert!(published.is_empty());
    assert_eq!(conn.queued_snapshots(), [0]);
    assert!(!conn.resync_requested());
    let behind = logs.events("snapshot_behind");
    assert_eq!(behind.len(), 1);
    assert_eq!(behind[0].level, Level::WARN);
    assert_eq!(behind[0].number("snapshot_ts"), SOL_SNAPSHOT_TS as f64);
    assert_eq!(behind[0].number("prev_ts"), 1791514427913.0);

    // A later snapshot, at the second delta, seeds the book and replays the third.
    let later = json!({ "success": true, "timestamp": 1791514432713_i64, "data": sol_snapshot()["data"] });
    let published = snapshot(&mut conn, 0, later);
    assert_eq!(published[0].1[0], BookLevel { price: 110.02, size: 1.863 });
}

// The gateway's answer to a path it cannot route, which the profile captured with HTTP 200.
const GATEWAY_ERROR: &[u8] = br#"{"code":503,"message":"[GW] no upstream server"}"#;

#[test]
fn fetches_again_a_reply_that_answers_success_false() {
    let (logs, _capture) = capture();
    let mut conn = waiting();

    venue().handle_snapshot(0, GATEWAY_ERROR, &mut conn).unwrap();

    assert!(conn.take_published().is_empty());
    assert_eq!(conn.queued_snapshots(), [0]);
    let failed = logs.events("snapshot_failed");
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].level, Level::WARN);
    assert_eq!(failed[0].text("market"), SOL);
    assert!(failed[0].text("error").contains("no upstream server"));
}

#[test]
fn fetches_again_a_reply_that_is_not_json() {
    let (logs, _capture) = capture();
    let mut conn = waiting();

    venue().handle_snapshot(0, b"<html>", &mut conn).unwrap();

    assert_eq!(conn.queued_snapshots(), [0]);
    assert!(logs.events("snapshot_failed")[0].text("error").contains("not JSON"));
}

#[test]
fn logs_a_run_of_failed_replies_on_the_first_and_every_30th_and_a_good_snapshot_ends_the_run() {
    let (logs, _capture) = capture();
    let mut conn = waiting();

    for _ in 0..31 {
        venue().handle_snapshot(0, GATEWAY_ERROR, &mut conn).unwrap();
    }
    assert_eq!(logs.events("snapshot_failed").len(), 2);

    snapshot(&mut conn, 0, sol_snapshot());
    venue().handle_snapshot(0, GATEWAY_ERROR, &mut conn).unwrap();
    let failed = logs.events("snapshot_failed");
    assert_eq!(failed.len(), 3);
    assert_eq!(failed[2].number("failures"), 1.0);
}

#[test]
fn restarts_the_connection_and_publishes_nothing_when_the_held_deltas_break() {
    let (logs, _capture) = capture();
    let mut conn = waiting();
    send(&mut conn, sol_first());
    send(&mut conn, sol_third());

    let published = snapshot(&mut conn, 0, sol_snapshot());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_gap");
}

#[test]
fn logs_a_snapshot_behind_the_socket_on_the_first_miss_and_every_tenth() {
    let (logs, _capture) = capture();
    let mut conn = waiting();
    send(&mut conn, sol_second());

    for _ in 0..20 {
        snapshot(&mut conn, 0, sol_snapshot());
    }

    let behind = logs.events("snapshot_behind");
    assert_eq!(behind.len(), 3);
    assert_eq!(behind[2].number("misses"), 20.0);
    assert_eq!(conn.queued_snapshots(), [0]);
}

#[test]
fn ignores_a_snapshot_for_a_market_already_seeded() {
    let mut conn = seeded();
    conn.take_published();
    send(&mut conn, sol_first());

    let published = snapshot(&mut conn, 0, sol_snapshot());

    assert!(published.is_empty());
    let next = send(&mut conn, sol_second());
    assert_eq!(next.len(), 1);
}

#[test]
fn leaves_out_delta_levels_beyond_a_snapshot_side_that_filled_the_whole_request() {
    let mut conn = connection(&[SOL]);
    send(&mut conn, ack("1", &[SOL]));
    let mut bids = Vec::new();
    for i in 0..SNAPSHOT_LEVELS {
        bids.push(json!({ "price": format!("{}", 1000 - i), "quantity": "1" }));
    }
    let body = json!({ "success": true, "timestamp": SOL_SNAPSHOT_TS, "data": { "bids": bids, "asks": [{ "price": "1001", "quantity": "1" }] } });
    snapshot(&mut conn, 0, body);

    send(&mut conn, delta(SOL_SNAPSHOT_TS, 1791514427913, json!([["0.5", "3"], ["999", "2"]]), json!([["2000", "4"]])));

    // The engine gets 20 levels, so the whole book is read from the connection.
    let book = conn.book(0).unwrap();
    assert_eq!(book.bids().len(), SNAPSHOT_LEVELS);
    assert_eq!(book.bids()[1], BookLevel { price: 999.0, size: 2.0 });
    assert_eq!(book.bids().last().unwrap().price, 1.0);
    assert_eq!(book.asks(), levels(&[(1001.0, 1.0), (2000.0, 4.0)]));
}

// deltas

#[test]
fn applies_a_delta_whose_prev_ts_is_the_snapshot_timestamp_then_one_whose_prev_ts_is_the_last_ts() {
    let mut conn = seeded();

    let first = send(&mut conn, sol_first());
    let second = send(&mut conn, sol_second());

    assert_eq!(first[0].1, levels(&[(109.9, 29.244), (109.89, 28.442), (109.88, 14.872), (109.87, 28.484)]));
    assert_eq!(second[0].2.last().unwrap(), &BookLevel { price: 111.67, size: 30.872 });
    assert!(!conn.resync_requested());
}

// On 2026-10-08 PERP_XMR_USDT's snapshot at 1791514980761 fell between a push's prevTs 1791514980611 and its ts.
// The SOL snapshot here is moved the same way, between the first delta's prevTs and ts.
fn sol_snapshot_inside_first() -> Value {
    json!({ "success": true, "timestamp": 1791514425000_i64, "data": sol_snapshot()["data"] })
}

#[test]
fn applies_a_first_delta_that_straddles_the_snapshot_timestamp() {
    let (logs, _capture) = capture();
    let mut conn = waiting();
    snapshot(&mut conn, 0, sol_snapshot_inside_first());

    let first = send(&mut conn, sol_first());
    let second = send(&mut conn, sol_second());

    assert_eq!(first[0].1[0], BookLevel { price: 109.9, size: 29.244 });
    assert_eq!(second.len(), 1);
    assert!(!conn.resync_requested());
    assert!(logs.events("snapshot_behind").is_empty());
}

#[test]
fn replays_a_held_delta_that_straddles_the_snapshot_timestamp() {
    let mut conn = waiting();
    send(&mut conn, sol_first());

    let published = snapshot(&mut conn, 0, sol_snapshot_inside_first());

    assert_eq!(published[0].1[0], BookLevel { price: 109.9, size: 29.244 });
}

#[test]
fn restarts_the_connection_when_a_later_delta_starts_before_the_last_ts() {
    let mut conn = seeded();
    send(&mut conn, sol_first());

    send(&mut conn, delta(1791514427000, 1791514432713, json!([]), json!([["111.67", "30.872"]])));

    assert!(conn.resync_requested());
}

#[test]
fn ignores_a_delta_the_snapshot_already_covers() {
    let mut conn = seeded();

    let published = send(&mut conn, sol_covered());

    assert!(published.is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn restarts_the_connection_on_a_gap_after_the_chain_held() {
    let (logs, _capture) = capture();
    let mut conn = seeded();
    send(&mut conn, sol_first());

    let published = send(&mut conn, sol_third());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync[0].text("market"), SOL);
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn seeds_one_market_again_and_empties_its_book_when_the_first_delta_misses_the_snapshot() {
    let (logs, _capture) = capture();
    let mut conn = seeded();

    let published = send(&mut conn, sol_second());

    assert_eq!(published, [(SOL.to_string(), Vec::new(), Vec::new())]);
    assert!(!conn.resync_requested());
    assert_eq!(conn.queued_snapshots(), [0]);
    assert_eq!(logs.events("snapshot_behind").len(), 1);

    // The new snapshot replays the held delta on top.
    let later = json!({ "success": true, "timestamp": 1791514427913_i64, "data": sol_snapshot()["data"] });
    let published = snapshot(&mut conn, 0, later);
    assert_eq!(published[0].2.last().unwrap(), &BookLevel { price: 111.67, size: 30.872 });
}

#[test]
fn holds_a_delta_that_arrives_before_the_acknowledgement_and_asks_for_its_snapshot() {
    let mut conn = connection(&[SOL]);

    assert!(send(&mut conn, sol_first()).is_empty());
    assert_eq!(conn.queued_snapshots(), [0]);

    let published = snapshot(&mut conn, 0, sol_snapshot());
    assert_eq!(published[0].1[0], BookLevel { price: 109.9, size: 29.244 });
}

#[test]
fn keeps_only_the_newest_deltas_while_a_snapshot_is_out() {
    let mut held = VecDeque::new();
    for i in 0..MAX_HELD_DELTAS as i64 + 3 {
        hold(&mut held, Delta { prev_ts: i, ts: i + 1, bids: Vec::new(), asks: Vec::new() });
    }

    assert_eq!(held.len(), MAX_HELD_DELTAS);
    assert_eq!(held.front().unwrap().prev_ts, 3);
}

#[test]
fn drops_a_delta_for_a_market_the_connection_did_not_subscribe_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["PERP_BTC_USDT"]);

    assert!(send(&mut conn, sol_first()).is_empty());
    assert!(send(&mut conn, sol_second()).is_empty());

    assert!(conn.queued_snapshots().is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

// control replies, captured on 2026-10-08

#[test]
fn logs_a_refused_subscribe_and_an_invalid_request_as_venue_errors() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[SOL]);

    send(&mut conn, json!({ "id": "91", "cmd": "SUBSCRIBE", "success": false, "time": 1791514188812_i64, "data": "Command type invalid!" }));
    send(&mut conn, json!({ "id": "", "cmd": "ERROR", "success": false, "time": 1791514188900_i64, "data": "Invalid request." }));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("cmd"), "SUBSCRIBE");
    assert!(errors[0].text("message").contains("Command type invalid!"));
    assert_eq!(errors[1].text("cmd"), "ERROR");
}

#[test]
fn asks_nothing_more_for_a_market_acknowledged_twice() {
    let mut conn = seeded();
    conn.take_published();

    send(&mut conn, ack("7", &[SOL]));

    assert!(conn.queued_snapshots().is_empty());
    assert_eq!(send(&mut conn, sol_first()).len(), 1);
}

#[test]
fn logs_a_control_frame_it_does_not_know_as_a_venue_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[SOL]);

    send(&mut conn, json!({ "cmd": "MAINTENANCE", "time": 1791514188900_i64, "data": "soon" }));

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].level, Level::WARN);
    assert!(notices[0].text("frame").contains("MAINTENANCE"));
}

#[test]
fn stays_silent_on_the_pong_and_on_an_empty_acknowledgement() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[SOL]);

    let pong = send(&mut conn, json!({ "cmd": "PONG", "success": true, "time": 1791514194925_i64 }));
    let empty = send(&mut conn, json!({ "id": "90", "cmd": "SUBSCRIBE", "success": true, "time": 1791514188812_i64, "data": [] }));

    assert!(pong.is_empty() && empty.is_empty());
    assert!(conn.queued_snapshots().is_empty());
    assert!(logs.lines().iter().all(|line| line.level > Level::WARN));
}

// A live probe of the book socket against the REST snapshot, run only on request:
// WOO_PROBE_SECONDS=60 WOO_CAPTURE=/tmp/woo.txt cargo test woo_probe -- --ignored --nocapture
// It printed the frames and books the cases above were cut from.
mod probe {
    use crate::clock::now_ms;
    use futures_util::{SinkExt, StreamExt};
    use serde_json::{Value, json};
    use std::collections::HashMap;
    use std::io::Write;
    use std::time::Duration;
    use tokio::time::{Instant, interval, sleep};
    use tokio_tungstenite::connect_async;
    use tokio_tungstenite::tungstenite::Message;

    const SYMBOLS: &[&str] = &[
        "PERP_BTC_USDT", "PERP_ETH_USDT", "PERP_TAO_USDT", "PERP_XRP_USDT", "PERP_SOL_USDT", "PERP_CRV_USDT",
        "PERP_INJ_USDT", "PERP_FET_USDT", "PERP_NEAR_USDT", "PERP_ZEC_USDT", "PERP_MET_USDT", "PERP_SUI_USDT",
        "PERP_ALGO_USDT", "PERP_HYPE_USDT", "PERP_AVAX_USDT", "PERP_CHZ_USDT", "PERP_DOGE_USDT", "PERP_DOT_USDT",
        "PERP_LINK_USDT", "PERP_BNB_USDT",
    ];

    // Every ten seconds it reads each REST book and reports whether a delta chains from its timestamp.
    #[tokio::test]
    #[ignore]
    async fn woo_probe() {
        let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
        let seconds: u64 = std::env::var("WOO_PROBE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(60);
        let mut log = std::env::var("WOO_CAPTURE").ok().map(|path| std::fs::File::create(path).unwrap());
        let http = reqwest::Client::builder().user_agent("arbitrage-observatory").build().unwrap();
        let (mut ws, _) = connect_async("wss://wss.woox.io/v3/public").await.unwrap();

        for (i, chunk) in SYMBOLS.chunks(10).enumerate() {
            let params: Vec<String> = chunk.iter().map(|s| format!("orderbookupdate@{s}@50")).collect();
            ws.send(Message::text(json!({ "id": (i + 1).to_string(), "cmd": "SUBSCRIBE", "params": params }).to_string()))
                .await
                .unwrap();
        }
        // An unknown topic and an eleven topic frame, for the refused shapes.
        ws.send(Message::text(json!({ "id": "90", "cmd": "SUBSCRIBE", "params": ["orderbookupdate@PERP_NOPE_USDT@50"] }).to_string()))
            .await
            .unwrap();
        let eleven: Vec<String> = (0..11).map(|i| format!("orderbookupdate@PERP_X{i}_USDT@50")).collect();
        ws.send(Message::text(json!({ "id": "91", "cmd": "SUBSCRIBE", "params": eleven }).to_string())).await.unwrap();

        let mut chains: HashMap<String, Vec<(i64, i64)>> = HashMap::new(); // (prevTs, ts) by symbol
        let mut snapshots: Vec<(String, i64)> = Vec::new();
        let mut ping = interval(Duration::from_secs(15));
        let mut snap = interval(Duration::from_secs(10));
        let deadline = Instant::now() + Duration::from_secs(seconds);

        loop {
            tokio::select! {
                _ = sleep(deadline.saturating_duration_since(Instant::now())) => break,
                _ = ping.tick() => {
                    ws.send(Message::text(json!({ "cmd": "PING", "ts": now_ms() }).to_string())).await.unwrap();
                }
                _ = snap.tick() => {
                    for symbol in SYMBOLS {
                        let url = format!("https://api.woox.io/v3/public/orderbook?symbol={symbol}&maxLevel=1000");
                        let body: Value = http.get(&url).send().await.unwrap().json().await.unwrap();
                        if let Some(file) = log.as_mut() {
                            writeln!(file, "rest {symbol} {body}").unwrap();
                        }
                        snapshots.push((symbol.to_string(), body["timestamp"].as_i64().unwrap_or(0)));
                        sleep(Duration::from_millis(150)).await;
                    }
                }
                message = ws.next() => {
                    let Some(Ok(Message::Text(text))) = message else { println!("socket: {message:?}"); continue };
                    if let Some(file) = log.as_mut() {
                        writeln!(file, "ws {} {}", now_ms(), text.as_str()).unwrap();
                    }
                    let frame: Value = serde_json::from_str(text.as_str()).unwrap();
                    if frame.get("topic").is_none() {
                        println!("reply {}", text.as_str());
                    } else if let Some(data) = frame.get("data") {
                        let symbol = data["s"].as_str().unwrap().to_string();
                        chains.entry(symbol).or_default().push((data["prevTs"].as_i64().unwrap(), data["ts"].as_i64().unwrap()));
                    }
                }
            }
        }

        for (symbol, deltas) in &chains {
            let breaks = deltas.windows(2).filter(|pair| pair[1].0 != pair[0].1).count();
            println!("{symbol}: {} deltas, {breaks} chain breaks", deltas.len());
        }
        for (symbol, ts) in &snapshots {
            let deltas = chains.get(symbol).map(Vec::as_slice).unwrap_or(&[]);
            if let Some(first) = deltas.iter().find(|delta| delta.1 > *ts) {
                println!("snapshot {symbol} at {ts}: the first newer delta chains from it {}", first.0 == *ts);
            }
        }
    }
}
