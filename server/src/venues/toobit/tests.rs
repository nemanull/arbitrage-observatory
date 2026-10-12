// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;
type State = HashMap<usize, i64>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.split('-').next().unwrap();
    Market {
        contract_size: 0.001,
        ..testing::market(ID, raw_market_id, base, "USDT", true)
    }
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}-SWAP-USDT")));
    }
    markets
}

fn venue() -> Toobit {
    Toobit::new()
}

fn connection() -> Connection<State> {
    Connection::for_test("toobit#public#0", vec![market("BTC-SWAP-USDT"), market("XPB2-SWAP-USDT")])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// The envelope of the diffDepth frames captured live on 2026-10-09 at 17:48 UTC, with the level arrays cut to three entries.
fn depth(symbol: &str, snapshot: bool, data: Value) -> Value {
    json!({
        "data": [data], "f": snapshot, "params": { "binary": "false", "realtimeInterval": "24h" },
        "sendTime": 1791568115378_i64, "symbol": symbol, "symbolName": symbol, "topic": "diffDepth",
    })
}

// The snapshot held 239 bids and 238 asks.
fn btc_snapshot() -> Value {
    depth("BTC-SWAP-USDT", true, json!({
        "a": [["82635.3", "39601.1"], ["82635.4", "63"], ["82635.5", "50"]],
        "b": [["82635.2", "25332"], ["82635.1", "487"], ["82635", "155"]],
        "e": 301, "o": 0, "s": "BTC-SWAP-USDT", "t": 1791568115124_i64, "v": "1791568115203_0.000000000000000001",
    }))
}

// The first two deltas after it, each of 27 to 30 levels a side, with the level at 82635.5 cleared by hand in the second.
fn btc_delta(o: i64) -> Value {
    depth("BTC-SWAP-USDT", false, json!({
        "a": [["82635.3", "40185.7"], ["82635.4", "63.9"], ["82635.5", "50.7"]],
        "b": [["82635.2", "25705.9"], ["82635.1", "494.2"], ["82635", "157.3"]],
        "e": 0, "o": o, "t": 1791568115425_i64, "v": "1791568115203_0.000000000000000001_4989277",
    }))
}

fn btc_next_delta(o: i64) -> Value {
    depth("BTC-SWAP-USDT", false, json!({
        "a": [["82635.3", "38581.2"], ["82635.4", "61.4"], ["82635.5", "0"]],
        "b": [["82635.2", "24679.6"], ["82635.1", "474.5"]],
        "e": 0, "o": o, "t": 1791568115725_i64, "v": "1791568115203_0.000000000000000001_4989278",
    }))
}

// A quiet book whose first delta came with no levels.
fn xpb2_snapshot() -> Value {
    depth("XPB2-SWAP-USDT", true, json!({
        "a": [["1889", "7"], ["1890.89", "1"], ["1892.78", "1"]],
        "b": [["1881.91", "2044"], ["1881.86", "1228"], ["1881.85", "2384"]],
        "e": 301, "o": 0, "s": "XPB2-SWAP-USDT", "t": 1791568115348_i64, "v": "1791568115421_0.000000000000000001",
    }))
}

fn xpb2_empty_delta(o: i64) -> Value {
    depth("XPB2-SWAP-USDT", false, json!({
        "a": [], "b": [], "e": 0, "o": o, "t": 1791568115348_i64, "v": "1791568115421_0.000000000000000001",
    }))
}

fn handle(conn: &mut Connection<State>, frame: &Value) -> anyhow::Result<()> {
    venue().handle(frame.to_string().as_bytes(), conn)
}

fn send(conn: &mut Connection<State>, frame: Value) -> Published {
    handle(conn, &frame).unwrap();
    conn.take_published()
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// plan and settings

#[test]
fn puts_300_markets_on_each_socket_of_the_one_url() {
    let plans = venue().plan(&markets(775));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [300, 300, 175]);
    assert_eq!(plans[2].id, "toobit#public#2");
    assert!(plans.iter().all(|plan| plan.url == "wss://stream.toobit.com/quote/ws/v1"));
}

#[test]
fn pings_every_20_seconds_and_calls_45_seconds_of_silence_a_dead_socket() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(20)));
    assert_eq!(settings.max_silence, Duration::from_secs(45));
}

// subscribe_frames

#[test]
fn names_every_market_of_the_slice_in_one_frame_joined_without_spaces() {
    let frames = venue().subscribe_frames(&markets(3), &mut State::new());

    assert_eq!(frames.len(), 1);
    assert_eq!(
        parsed(&frames[0]),
        json!({
            "symbol": "SYM0-SWAP-USDT,SYM1-SWAP-USDT,SYM2-SWAP-USDT", "topic": "diffDepth", "event": "sub",
            "params": { "binary": false },
        })
    );
}

// ping

#[test]
fn pings_with_the_time_in_ms() {
    let before = crate::clock::now_ms();

    let ping = parsed(&venue().ping(&mut State::new()));

    let time = ping["ping"].as_i64().unwrap();
    assert!(before <= time && time <= crate::clock::now_ms());
}

// handle

#[test]
fn hands_the_engine_a_snapshot_as_the_whole_book() {
    let mut conn = connection();

    let published = send(&mut conn, btc_snapshot());

    assert_eq!(
        published,
        [(
            "BTC-SWAP-USDT".to_string(),
            levels(&[(82635.2, 25332.0), (82635.1, 487.0), (82635.0, 155.0)]),
            levels(&[(82635.3, 39601.1), (82635.4, 63.0), (82635.5, 50.0)]),
        )]
    );
}

#[test]
fn applies_deltas_as_absolute_sizes_and_a_zero_size_removes_the_level() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());

    send(&mut conn, btc_delta(3364482));
    let published = send(&mut conn, btc_next_delta(3364483));

    assert_eq!(
        published,
        [(
            "BTC-SWAP-USDT".to_string(),
            levels(&[(82635.2, 24679.6), (82635.1, 474.5), (82635.0, 157.3)]),
            levels(&[(82635.3, 38581.2), (82635.4, 61.4)]),
        )]
    );
    assert!(!conn.resync_requested());
}

#[test]
fn takes_the_first_delta_after_a_snapshot_as_the_base_whatever_its_count() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());

    let published = send(&mut conn, btc_delta(3364482));

    assert_eq!(published.len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn resyncs_on_a_skipped_count() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_delta(3364482));

    let published = send(&mut conn, btc_next_delta(3364484));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_gap");
}

#[test]
fn resyncs_on_a_repeated_count() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_delta(3364482));

    send(&mut conn, btc_next_delta(3364482));

    assert!(conn.resync_requested());
}

#[test]
fn resyncs_on_a_delta_before_any_snapshot() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(&mut conn, btc_delta(3364482));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn resyncs_on_a_delta_without_a_count() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut delta = btc_delta(0);
    delta["data"][0].as_object_mut().unwrap().remove("o");

    send(&mut conn, delta);

    assert!(conn.resync_requested());
}

#[test]
fn moves_the_count_on_a_delta_with_no_levels_without_publishing() {
    let mut conn = connection();
    send(&mut conn, xpb2_snapshot());

    assert!(send(&mut conn, xpb2_empty_delta(9907)).is_empty());
    send(&mut conn, xpb2_empty_delta(9908));

    assert!(!conn.resync_requested());
    send(&mut conn, xpb2_empty_delta(9910));
    assert!(conn.resync_requested());
}

// A resubscribe sends a fresh snapshot and the count carries on from the old one, so the snapshot forgets the base.
#[test]
fn a_second_snapshot_replaces_the_book_and_forgets_the_base() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_delta(3364482));

    let published = send(&mut conn, btc_snapshot());
    send(&mut conn, btc_next_delta(3364490));

    assert_eq!(published[0].2, levels(&[(82635.3, 39601.1), (82635.4, 63.0), (82635.5, 50.0)]));
    assert!(!conn.resync_requested());
}

// The delisted REN-SWAP-USDT answered a snapshot with both sides empty on 2026-09-22.
#[test]
fn an_empty_snapshot_clears_a_book_that_had_levels() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut empty = btc_snapshot();
    empty["data"][0]["b"] = json!([]);
    empty["data"][0]["a"] = json!([]);

    let published = send(&mut conn, empty);

    assert_eq!(published, [("BTC-SWAP-USDT".to_string(), vec![], vec![])]);
    assert!(!conn.resync_requested());
}

#[test]
fn resyncs_on_a_delta_without_a_count_after_the_base_is_set() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_delta(3364482));
    let mut delta = btc_next_delta(3364483);
    delta["data"][0].as_object_mut().unwrap().remove("o");

    assert!(send(&mut conn, delta).is_empty());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_without_sequence");
}

#[test]
fn keeps_each_market_on_its_own_count() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, xpb2_snapshot());

    send(&mut conn, btc_delta(3364482));
    send(&mut conn, xpb2_empty_delta(9907));
    send(&mut conn, btc_next_delta(3364483));
    send(&mut conn, xpb2_empty_delta(9908));

    assert!(!conn.resync_requested());
}

#[test]
fn drops_a_symbol_it_did_not_subscribe() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let mut frame = btc_snapshot();
    frame["symbol"] = json!("ETH-SWAP-USDT");

    assert!(send(&mut conn, frame).is_empty());
    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "ETH-SWAP-USDT");
}

// Both captured live on 2026-10-09, the first for NOPE-SWAP-USDT and the second for a frame that was not JSON.
#[test]
fn logs_an_error_frame_at_error_with_its_code() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, json!({ "code": "-100010", "data": null, "desc": "Invalid Symbols!" }));
    send(&mut conn, json!({ "code": "-10001", "data": null, "desc": "Invalid JSON!" }));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "toobit#public#0");
    assert_eq!(errors[0].text("code"), "-100010");
    assert_eq!(errors[0].text("message"), "Invalid Symbols!");
}

// Captured live on 2026-10-09, carrying the server's own clock.
#[test]
fn takes_a_pong_as_traffic_only() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    assert!(send(&mut conn, json!({ "data": null, "pong": 1791568115379_i64 })).is_empty());
    assert!(logs.events("venue_error").is_empty());
    assert!(logs.events("venue_notice").is_empty());
}

#[test]
fn logs_any_other_frame_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, json!({ "topic": "markPrice", "data": null }));

    assert_eq!(logs.events("venue_notice")[0].text("topic"), "markPrice");
}

#[test]
fn fails_on_a_frame_that_is_not_json() {
    let mut conn = connection();

    assert!(venue().handle(b"not json", &mut conn).is_err());
}

// A probe of the live socket, which prints each frame with its level arrays cut to three entries:
// CAPTURE_MARKETS=BTC-SWAP-USDT,XPB2-SWAP-USDT cargo test toobit::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(PUBLIC_URL).await.unwrap();
    let list = std::env::var("CAPTURE_MARKETS").unwrap_or_else(|_| "BTC-SWAP-USDT,XPB2-SWAP-USDT".to_string());
    let markets: Vec<Market> = list.split(',').map(market).collect();
    for frame in venue().subscribe_frames(&markets, &mut State::new()) {
        ws.send(frame).await.unwrap();
    }
    ws.send(Message::text(r#"{"symbol":"NOPE-SWAP-USDT","topic":"diffDepth","event":"sub","params":{"binary":false}}"#)).await.unwrap();
    ws.send(Message::text("not json")).await.unwrap();
    ws.send(venue().ping(&mut State::new())).await.unwrap();

    let seconds: u64 = std::env::var("CAPTURE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(4);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let mut value: Value = serde_json::from_str(text.as_str()).unwrap();
        if let Some(data) = value["data"].as_array_mut() {
            for entry in data {
                for side in ["b", "a"] {
                    if let Some(levels) = entry[side].as_array_mut() {
                        println!("{side} {}", levels.len());
                        levels.truncate(3);
                    }
                }
            }
        }
        println!("{value}");
    }
}
