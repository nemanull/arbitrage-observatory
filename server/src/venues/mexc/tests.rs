// Ported case for case from old_ts_server/src/venues/mexc/mexc.spec.ts.
// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

const RIF_BIDS: &[[f64; 3]] = &[[0.08049, 46.0, 1.0], [0.08048, 489.0, 1.0], [0.08047, 420.0, 1.0]];
const RIF_ASKS: &[[f64; 3]] = &[[0.08055, 48.0, 1.0], [0.08056, 347.0, 1.0], [0.08057, 149.0, 1.0]];

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.split('_').next().unwrap();
    Market {
        contract_size: 0.0001,
        ..testing::market(ID, raw_market_id, base, "USDT", true)
    }
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}_USDT")));
    }
    markets
}

fn venue() -> Mexc {
    Mexc::new()
}

fn connection(raw_market_id: &str) -> Connection<State> {
    Connection::for_test("mexc#swap#0", vec![market(raw_market_id)])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// The shape captured live on 2026-09-15, with the level count cut down.
fn full_frame(symbol: &str, version: i64, bids: &[[f64; 3]], asks: &[[f64; 3]]) -> Value {
    json!({
        "symbol": symbol,
        "data": { "cts": 1789498322165_i64, "asks": asks, "bids": bids, "version": version },
        "channel": "push.depth.full",
        "ts": 1789498322169_i64,
    })
}

fn send_bytes(conn: &mut Connection<State>, frame: &[u8]) -> Published {
    venue().handle(frame, conn).unwrap();
    conn.take_published()
}

fn send(conn: &mut Connection<State>, frame: Value) -> Published {
    send_bytes(conn, frame.to_string().as_bytes())
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// plan

#[test]
fn puts_150_contracts_on_each_connection_to_the_one_public_endpoint() {
    let plans = venue().plan(&markets(320));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["mexc#swap#0", "mexc#swap#1", "mexc#swap#2"]);
    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [150, 150, 20]);
    assert!(plans.iter().all(|plan| plan.url == "wss://contract.mexc.com/edge"));
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames

#[test]
fn sends_one_full_depth_frame_of_20_levels_per_contract_paced_50_ms_apart() {
    let frames = venue().subscribe_frames(&markets(150), &mut State::default());

    assert_eq!(frames.len(), 150);
    assert_eq!(parsed(&frames[0]), json!({ "method": "sub.depth.full", "param": { "symbol": "SYM0_USDT", "limit": 20 } }));
    assert_eq!(venue().settings().subscribe_gap, Duration::from_millis(50));
    assert_eq!(venue().settings().max_silence, Duration::from_secs(45));
}

// ping, which replaced startKeepalive

#[test]
fn sends_the_application_ping_every_15_seconds() {
    assert_eq!(parsed(&venue().ping(&mut State::default())), json!({ "method": "ping" }));
    assert_eq!(venue().settings().ping_every, Some(Duration::from_secs(15)));
}

// handle

#[test]
fn hands_the_engine_a_full_depth_frame_as_the_whole_book() {
    let mut conn = connection("RIF_USDT");

    let published = send(&mut conn, full_frame("RIF_USDT", 5220571685, RIF_BIDS, RIF_ASKS));

    assert_eq!(
        published,
        [(
            "RIF_USDT".to_string(),
            levels(&[(0.08049, 46.0), (0.08048, 489.0), (0.08047, 420.0)]),
            levels(&[(0.08055, 48.0), (0.08056, 347.0), (0.08057, 149.0)]),
        )]
    );
}

#[test]
fn replaces_the_book_on_every_frame_so_a_level_missing_from_the_next_frame_is_gone() {
    let mut conn = connection("RIF_USDT");
    send(&mut conn, full_frame("RIF_USDT", 5220571685, RIF_BIDS, RIF_ASKS));

    let published = send(&mut conn, full_frame("RIF_USDT", 5220571690, &[[0.0805, 12.0, 1.0]], &[[0.08056, 300.0, 1.0]]));

    assert_eq!(published, [("RIF_USDT".to_string(), levels(&[(0.0805, 12.0)]), levels(&[(0.08056, 300.0)]))]);
}

#[test]
fn drops_a_frame_whose_version_is_below_the_last_one_applied() {
    let mut conn = connection("RIF_USDT");
    send(&mut conn, full_frame("RIF_USDT", 5220571685, RIF_BIDS, RIF_ASKS));

    let published = send(&mut conn, full_frame("RIF_USDT", 5220571684, &[[0.08, 1.0, 1.0]], &[[0.09, 1.0, 1.0]]));

    assert!(published.is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn applies_an_unchanged_top_that_arrives_with_a_higher_version() {
    let mut conn = connection("RIF_USDT");
    send(&mut conn, full_frame("RIF_USDT", 5220571685, RIF_BIDS, RIF_ASKS));

    let published = send(&mut conn, full_frame("RIF_USDT", 5220571686, RIF_BIDS, RIF_ASKS));

    assert_eq!(published.len(), 1);
}

// A fresh connection holds fresh state, which is how the runtime opens every reconnect.
#[test]
fn takes_any_version_for_the_first_frame_after_the_connection_closed() {
    let mut first = connection("RIF_USDT");
    send(&mut first, full_frame("RIF_USDT", 5220571685, RIF_BIDS, RIF_ASKS));

    let mut reopened = connection("RIF_USDT");
    let lower = send(&mut reopened, full_frame("RIF_USDT", 7, RIF_BIDS, RIF_ASKS));
    let older = send(&mut reopened, full_frame("RIF_USDT", 6, RIF_BIDS, RIF_ASKS));

    assert_eq!(lower.len(), 1);
    assert!(older.is_empty());
}

#[test]
fn reads_a_price_sent_in_exponent_form() {
    let mut conn = connection("BTC_USDT");

    let published = send_bytes(
        &mut conn,
        br#"{"symbol":"BTC_USDT","data":{"cts":1789498322165,"asks":[[75481.2,10,1]],"bids":[[7.548E+4,4959,3]],"version":41770922520},"channel":"push.depth.full","ts":1789498322169}"#,
    );

    assert_eq!(published, [("BTC_USDT".to_string(), levels(&[(75480.0, 4959.0)]), levels(&[(75481.2, 10.0)]))]);
}

#[test]
fn drops_a_contract_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = connection("RIF_USDT");

    let first = send(&mut conn, full_frame("ETH_USDT", 1, RIF_BIDS, RIF_ASKS));
    let second = send(&mut conn, full_frame("ETH_USDT", 2, RIF_BIDS, RIF_ASKS));

    assert!(first.is_empty() && second.is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

#[test]
fn logs_an_rs_error_frame_and_stays_silent_on_the_acknowledgement_and_the_pong() {
    let (logs, _capture) = capture();
    let mut conn = connection("RIF_USDT");

    send_bytes(&mut conn, br#"{"channel":"rs.sub.depth.full","data":"success","ts":1789498321789}"#);
    send_bytes(&mut conn, br#"{"channel":"pong","data":1789498336785,"ts":1789498336785}"#);
    let published = send_bytes(&mut conn, br#"{"channel":"rs.error","data":"Contract [NOPE_USDT] not exists","ts":1789498321790}"#);

    assert!(published.is_empty());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("message"), "Contract [NOPE_USDT] not exists");
}

#[test]
fn logs_the_first_binary_frame_drops_every_one_and_keeps_reading_text_frames() {
    let (logs, _capture) = capture();
    let mut conn = connection("RIF_USDT");
    let gzip = [0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00];

    send_bytes(&mut conn, &gzip);
    send_bytes(&mut conn, &gzip);
    let published = send(&mut conn, full_frame("RIF_USDT", 1, RIF_BIDS, RIF_ASKS));

    let warnings = logs.events("binary_frame_dropped");
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].number("bytes"), 6.0);
    assert_eq!(published.len(), 1);
}
