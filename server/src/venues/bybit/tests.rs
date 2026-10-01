// Ported case for case from old_ts_server/src/venues/bybit/bybit.spec.ts.
// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

const SNAPSHOT_BIDS: &[(&str, &str)] = &[("79909.40", "2.189"), ("79909.30", "1.000")];
const SNAPSHOT_ASKS: &[(&str, &str)] = &[("79909.50", "0.652"), ("79909.60", "3.000")];

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str, linear: bool) -> Market {
    testing::market(ID, raw_market_id, &raw_market_id[..3], "USDT", linear)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}USDT"), true));
    }
    markets
}

fn venue() -> Bybit {
    Bybit::new(&[])
}

fn connection() -> Connection<HashMap<usize, i64>> {
    Connection::for_test("bybit#linear#0", vec![market("BTCUSDT", true)])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// The shape captured live on 2026-09-07, with the level count cut down.
fn book_frame(symbol: &str, kind: &str, u: i64, bids: &[(&str, &str)], asks: &[(&str, &str)]) -> Value {
    json!({
        "topic": format!("orderbook.50.{symbol}"),
        "type": kind,
        "ts": 1788746279128_i64,
        "cts": 1788746279122_i64,
        "data": { "s": symbol, "b": bids, "a": asks, "u": u, "seq": 806353894408_i64 },
    })
}

fn control(success: bool, ret_msg: &str, op: &str) -> Value {
    json!({
        "success": success,
        "ret_msg": ret_msg,
        "conn_id": "da7toku0nfamcecd8s50-3meem",
        "req_id": "sub-1",
        "op": op,
    })
}

fn send(conn: &mut Connection<HashMap<usize, i64>>, frame: Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn text(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// plan

#[test]
fn chunks_linear_markets_onto_the_linear_endpoint() {
    let plans = venue().plan(&markets(250));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["bybit#linear#0", "bybit#linear#1"]);
    assert_eq!(plans[0].markets.len(), 200);
    assert_eq!(plans[1].markets.len(), 50);
    assert_eq!(plans[0].url, "wss://stream.bybit.com/v5/public/linear");
}

#[test]
fn sends_inverse_markets_to_the_inverse_endpoint_on_their_own_plans() {
    let plans = venue().plan(&[market("BTCUSDT", true), market("BTCUSD", false)]);

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["bybit#linear#0", "bybit#inverse#0"]);
    assert_eq!(plans[1].url, "wss://stream.bybit.com/v5/public/inverse");
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames

#[test]
fn builds_depth_fifty_topics_and_splits_them_across_frames() {
    let frames = venue().subscribe_frames(&markets(250), &mut HashMap::new());

    assert_eq!(frames.len(), 2);
    let first = text(&frames[0]);
    let second = text(&frames[1]);
    assert_eq!(first["op"], "subscribe");
    assert_eq!(first["args"].as_array().unwrap().len(), 200);
    assert_eq!(first["args"][0], "orderbook.50.SYM0USDT");
    assert_eq!(second["args"].as_array().unwrap().len(), 50);
    assert_eq!(first["req_id"], "sub-1");
    assert_eq!(second["req_id"], "sub-2");
}

// ping, which replaced startKeepalive

#[test]
fn sends_the_application_ping_every_20_s() {
    let venue = venue();

    assert_eq!(text(&venue.ping(&mut HashMap::new())), json!({ "op": "ping" }));
    assert_eq!(venue.settings().ping_every, Some(Duration::from_secs(20)));
    assert_eq!(venue.settings().max_silence, Duration::from_secs(60));
}

// handle

#[test]
fn hands_the_engine_a_subscribed_snapshot_as_the_whole_book() {
    let mut conn = connection();

    let published = send(&mut conn, book_frame("BTCUSDT", "snapshot", 100, SNAPSHOT_BIDS, SNAPSHOT_ASKS));

    assert_eq!(
        published,
        [(
            "BTCUSDT".to_string(),
            levels(&[(79909.4, 2.189), (79909.3, 1.0)]),
            levels(&[(79909.5, 0.652), (79909.6, 3.0)]),
        )]
    );
}

#[test]
fn applies_a_delta_with_the_next_update_id_and_hands_over_the_new_top() {
    let mut conn = connection();
    send(&mut conn, book_frame("BTCUSDT", "snapshot", 100, SNAPSHOT_BIDS, SNAPSHOT_ASKS));

    // The best bid is pulled and a new best ask arrives.
    let published = send(
        &mut conn,
        book_frame("BTCUSDT", "delta", 101, &[("79909.40", "0")], &[("79909.45", "1.5")]),
    );

    assert_eq!(published.len(), 1);
    assert_eq!(published[0].1, levels(&[(79909.3, 1.0)]));
    assert_eq!(published[0].2, levels(&[(79909.45, 1.5), (79909.5, 0.652), (79909.6, 3.0)]));
}

#[test]
fn restarts_the_connection_on_a_gap_in_the_update_id_and_applies_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, book_frame("BTCUSDT", "snapshot", 100, SNAPSHOT_BIDS, SNAPSHOT_ASKS));

    let published = send(&mut conn, book_frame("BTCUSDT", "delta", 102, &[("79909.40", "0")], &[]));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(conn.book(0).unwrap().bids(), levels(&[(79909.4, 2.189), (79909.3, 1.0)]));
    let resync = logs.events("book_resync");
    assert_eq!(resync.len(), 1);
    assert_eq!(resync[0].level, Level::WARN);
    assert_eq!(resync[0].text("market"), "BTCUSDT");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn restarts_the_connection_on_a_delta_with_no_snapshot_behind_it() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(&mut conn, book_frame("BTCUSDT", "delta", 5, &[("79909.40", "1")], &[]));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn takes_a_restart_snapshot_with_u_of_1_as_a_replacement_of_the_book() {
    let mut conn = connection();
    send(&mut conn, book_frame("BTCUSDT", "snapshot", 100, SNAPSHOT_BIDS, SNAPSHOT_ASKS));

    let replaced = send(&mut conn, book_frame("BTCUSDT", "snapshot", 1, &[("79000.00", "1")], &[("79001.00", "1")]));
    let published = send(&mut conn, book_frame("BTCUSDT", "delta", 2, &[("78999.00", "1")], &[]));

    assert_eq!(replaced.len(), 1);
    assert_eq!(published[0].1, levels(&[(79000.0, 1.0), (78999.0, 1.0)]));
    assert_eq!(published[0].2, levels(&[(79001.0, 1.0)]));
}

#[test]
fn passes_a_one_sided_book_through_with_the_empty_side_empty() {
    let mut conn = connection();

    let published = send(&mut conn, book_frame("BTCUSDT", "snapshot", 100, SNAPSHOT_BIDS, &[]));

    assert_eq!(published[0].1.len(), 2);
    assert!(published[0].2.is_empty());
}

#[test]
fn drops_a_symbol_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let first = send(&mut conn, book_frame("ETHUSDT", "snapshot", 1, SNAPSHOT_BIDS, SNAPSHOT_ASKS));
    let second = send(&mut conn, book_frame("ETHUSDT", "snapshot", 1, SNAPSHOT_BIDS, SNAPSHOT_ASKS));

    assert!(first.is_empty() && second.is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

#[test]
fn logs_a_rejected_control_frame_and_stays_silent_on_the_acknowledgement_and_the_pong() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, control(true, "", "subscribe"));
    send(&mut conn, control(true, "pong", "ping"));
    let published = send(&mut conn, control(false, "Invalid symbol", "subscribe"));

    assert!(published.is_empty());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("op"), "subscribe");
    assert_eq!(errors[0].text("message"), "Invalid symbol");
}
