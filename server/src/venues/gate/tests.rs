// Ported case for case from old_ts_server/src/venues/gate/gate.spec.ts.
// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

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

fn venue() -> Gate {
    Gate::new()
}

fn connection(raw_market_id: &str) -> Connection<HashMap<usize, i64>> {
    Connection::for_test("gate#usdt#0", vec![market(raw_market_id)])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// The envelope and result of futures.obu frames captured live on 2026-09-15, with the level count cut down.
fn obu(result: Value) -> Value {
    json!({ "time": 1789455580, "time_ms": 1789455580280_i64, "channel": "futures.obu", "event": "update", "result": result })
}

fn btc_snapshot() -> Value {
    obu(json!({
        "t": 1789455580261_i64, "full": true, "s": "ob.BTC_USDT.50", "u": 125033675974_i64,
        "b": [["77222.9", "600"], ["77222.5", "10"]],
        "a": [["77235", "40"], ["77235.2", "7"]],
    }))
}

// Captured as it came, one delta and then the id only delta that followed it.
fn btc_delta() -> Value {
    obu(json!({
        "t": 1789455580280_i64, "s": "ob.BTC_USDT.50", "U": 125033675975_i64, "u": 125033676003_i64,
        "b": [["77222.9", "648"]],
        "a": [["77235", "50"], ["77235.2", "0"]],
    }))
}

fn btc_id_only_delta() -> Value {
    obu(json!({ "t": 1789455580300_i64, "s": "ob.BTC_USDT.50", "U": 125033676004_i64, "u": 125033676011_i64 }))
}

fn send(conn: &mut Connection<HashMap<usize, i64>>, frame: Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// plan

#[test]
fn puts_150_markets_on_each_usdt_socket() {
    let plans = venue().plan(&markets(983));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [150, 150, 150, 150, 150, 150, 83]);
    assert_eq!(plans[0].id, "gate#usdt#0");
    assert_eq!(plans[0].url, "wss://fx-ws.gateio.ws/v4/ws/usdt");
    assert_eq!(venue().settings().max_silence, Duration::from_secs(45));
}

// subscribe_frames

#[test]
fn names_every_stream_of_the_slice_in_one_frame_stamped_in_seconds() {
    let slice = markets(150);
    let before = now_seconds();

    let frames = venue().subscribe_frames(&slice, &mut HashMap::new());

    assert_eq!(frames.len(), 1);
    let frame = parsed(&frames[0]);
    let time = frame["time"].as_i64().unwrap();
    assert!(before <= time && time <= now_seconds());
    assert_eq!(frame["channel"], "futures.obu");
    assert_eq!(frame["event"], "subscribe");
    assert_eq!(frame["payload"].as_array().unwrap().len(), 150);
    assert_eq!(frame["payload"][0], "ob.SYM0_USDT.50");
}

// ping, which replaced startKeepalive

#[test]
fn sends_futures_ping_every_15_seconds_with_the_time_in_seconds() {
    let before = now_seconds();

    let ping = parsed(&venue().ping(&mut HashMap::new()));

    assert_eq!(ping["channel"], "futures.ping");
    let time = ping["time"].as_i64().unwrap();
    assert!(before <= time && time <= now_seconds());
    assert_eq!(venue().settings().ping_every, Some(Duration::from_secs(15)));
}

// handle

#[test]
fn hands_the_engine_a_snapshot_as_the_whole_book() {
    let mut conn = connection("BTC_USDT");

    let published = send(&mut conn, btc_snapshot());

    assert_eq!(
        published,
        [(
            "BTC_USDT".to_string(),
            levels(&[(77222.9, 600.0), (77222.5, 10.0)]),
            levels(&[(77235.0, 40.0), (77235.2, 7.0)]),
        )]
    );
}

#[test]
fn applies_a_delta_whose_u_is_the_last_u_plus_one() {
    let mut conn = connection("BTC_USDT");
    send(&mut conn, btc_snapshot());

    let published = send(&mut conn, btc_delta());

    assert_eq!(published[0].1, levels(&[(77222.9, 648.0), (77222.5, 10.0)]));
    assert_eq!(published[0].2, levels(&[(77235.0, 50.0)]));
}

#[test]
fn advances_the_id_on_a_delta_with_no_levels_and_publishes_nothing_for_it() {
    let (logs, _capture) = capture();
    let mut conn = connection("BTC_USDT");
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_delta());

    let id_only = send(&mut conn, btc_id_only_delta());
    let next = send(
        &mut conn,
        obu(json!({ "t": 1789455580320_i64, "s": "ob.BTC_USDT.50", "U": 125033676012_i64, "u": 125033676015_i64, "a": [["77234.9", "3"]] })),
    );

    assert!(id_only.is_empty());
    assert_eq!(next[0].2, levels(&[(77234.9, 3.0), (77235.0, 50.0)]));
    assert!(!conn.resync_requested());
    assert!(logs.events("book_resync").is_empty());
}

#[test]
fn restarts_the_connection_on_a_gap_in_the_update_id_and_applies_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection("BTC_USDT");
    send(&mut conn, btc_snapshot());

    let published = send(&mut conn, btc_id_only_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync.len(), 1);
    assert_eq!(resync[0].text("market"), "BTC_USDT");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn restarts_the_connection_on_a_delta_with_no_snapshot_behind_it() {
    let (logs, _capture) = capture();
    let mut conn = connection("BTC_USDT");

    let published = send(&mut conn, btc_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn takes_a_later_full_push_as_a_replacement_of_the_book() {
    let mut conn = connection("BTC_USDT");
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_delta());

    let published = send(
        &mut conn,
        obu(json!({ "t": 1789455590000_i64, "full": true, "s": "ob.BTC_USDT.50", "u": 125033680000_i64, "b": [["77100", "1"]], "a": [["77101", "2"]] })),
    );

    assert_eq!(published[0].1, levels(&[(77100.0, 1.0)]));
    assert_eq!(published[0].2, levels(&[(77101.0, 2.0)]));
}

#[test]
fn routes_a_stream_back_to_a_contract_id_spelled_outside_ascii() {
    let mut conn = connection("币安人生_USDT");

    let published = send(
        &mut conn,
        obu(json!({ "t": 1789456261122_i64, "full": true, "s": "ob.币安人生_USDT.50", "u": 3258990980_i64, "b": [["0.01603", "777"]], "a": [["0.01609", "115"]] })),
    );

    assert_eq!(
        published,
        [("币安人生_USDT".to_string(), levels(&[(0.01603, 777.0)]), levels(&[(0.01609, 115.0)]))]
    );
}

#[test]
fn reads_a_stream_name_sent_with_escaped_characters() {
    let mut conn = connection("币安人生_USDT");
    let escaped = r#"{"channel":"futures.obu","event":"update","result":{"full":true,"s":"ob.币安人生_USDT.50","u":1,"b":[["1","1"]],"a":[["2","1"]]}}"#;

    venue().handle(escaped.as_bytes(), &mut conn).unwrap();

    assert_eq!(conn.take_published()[0].0, "币安人生_USDT");
}

#[test]
fn drops_a_stream_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = connection("ETH_USDT");

    let snapshot = send(&mut conn, btc_snapshot());
    let delta = send(&mut conn, btc_delta());

    assert!(snapshot.is_empty() && delta.is_empty());
    assert!(!conn.resync_requested());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

#[test]
fn logs_an_error_frame_and_stays_silent_on_the_acknowledgement_and_the_pong() {
    let (logs, _capture) = capture();
    let mut conn = connection("BTC_USDT");

    send(
        &mut conn,
        json!({
            "time": 1789456334, "time_ms": 1789456334999_i64, "conn_id": "c59a69fd3702aa1d",
            "trace_id": "5597c780565cf57ad16784743225b18b", "channel": "futures.obu", "event": "subscribe",
            "payload": ["ob.BTC_USDT.50", "ob.ETH_USDT.50"], "result": { "status": "success" },
        }),
    );
    send(
        &mut conn,
        json!({ "time": 1789456354, "time_ms": 1789456354999_i64, "conn_id": "c59a69fd3702aa1d", "channel": "futures.pong", "event": "", "result": null }),
    );
    let published = send(
        &mut conn,
        json!({
            "time": 1789456896, "time_ms": 1789456896882_i64, "conn_id": "bf37dda1698c8b1e", "channel": "futures.obu",
            "event": "subscribe", "payload": ["ob.BTC_USDT.50"], "error": { "code": 2, "message": "Alert sub ob.BTC_USDT.50" },
            "result": { "status": "fail" },
        }),
    );

    assert!(published.is_empty());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("channel"), "futures.obu");
    assert_eq!(errors[0].text("request"), "subscribe");
    assert_eq!(errors[0].number("code"), 2.0);
    assert_eq!(errors[0].text("message"), "Alert sub ob.BTC_USDT.50");
}
