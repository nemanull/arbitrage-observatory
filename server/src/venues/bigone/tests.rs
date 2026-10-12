// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.strip_suffix("USDT").unwrap();
    testing::market(ID, raw_market_id, base, "USDT", true)
}

fn venue() -> BigOne {
    BigOne::new()
}

fn connection(raw_market_id: &str) -> Connection<Option<u64>> {
    Connection::for_test(&format!("bigone#depth#{raw_market_id}"), vec![market(raw_market_id)])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

fn send(conn: &mut Connection<Option<u64>>, frame: &Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

// Frames captured live on 2026-10-09 at 18:26 UTC on depth@ETHUSDT, the snapshot cut to a few of its levels.
// The snapshot carries no symbol, and its keys arrive in no order.
fn eth_snapshot() -> Value {
    json!({
        "bids": { "2400": 2, "2464.86": 196, "2482.88": 389, "2483": 293, "2482.86": 248 },
        "asks": { "2483.25": 426, "2483.03": 191, "2483.01": 414, "2644": 5, "2483.02": 259, "2483.16": 390 },
        "to": 4368409216_u64, "lastPrice": 2483.01, "bestPrices": { "ask": 2483.01, "bid": 2483 }, "from": 0,
    })
}

fn eth_first_delta() -> Value {
    json!({
        "symbol": "ETHUSDT", "from": 4368409216_u64, "to": 4368409395_u64, "lastPrice": 2483.01,
        "bestPrices": { "ask": 2483.01, "bid": 2483 },
        "asks": { "2483.01": 411, "2483.16": 392 }, "bids": { "2483": 295, "2482.86": 247 },
    })
}

fn eth_second_delta() -> Value {
    json!({
        "symbol": "ETHUSDT", "from": 4368409395_u64, "to": 4368409556_u64, "lastPrice": 2483.01,
        "bestPrices": { "ask": 2483.01, "bid": 2483 }, "asks": { "2483.01": 415, "2483.02": 258 }, "bids": { "2482.88": 389 },
    })
}

// A side with no change is an empty object.
fn eth_third_delta() -> Value {
    json!({
        "symbol": "ETHUSDT", "from": 4368409556_u64, "to": 4368409573_u64, "lastPrice": 2483.01,
        "bestPrices": { "ask": 2483.01, "bid": 2483 }, "asks": {}, "bids": { "2482.99": 424 },
    })
}

// Size 0 deletes in the shape of a delta captured later in the same run, at prices of this trimmed book and chained onto the third delta.
fn eth_delete_delta() -> Value {
    json!({
        "symbol": "ETHUSDT", "from": 4368409573_u64, "to": 4368419434_u64, "lastPrice": 2482.99,
        "bestPrices": { "ask": 2483.02, "bid": 2482.99 },
        "asks": { "2483.01": 0, "2483.03": 0 }, "bids": { "2483": 0, "2482.86": 0 },
    })
}

// plan, subscribe_frames, ping and settings

#[test]
fn opens_one_socket_per_contract_whose_url_is_the_subscription() {
    let plans = venue().plan(&[market("BTCUSDT"), market("TSLAUSDT")]);

    assert_eq!(plans.len(), 2);
    assert_eq!(plans[0].id, "bigone#depth#BTCUSDT");
    assert_eq!(plans[0].url, "wss://api.big.one/ws/contract/v2/depth@BTCUSDT");
    assert_eq!(testing::raw_ids(&plans[0].markets), ["BTCUSDT"]);
    assert_eq!(plans[1].url, "wss://api.big.one/ws/contract/v2/depth@TSLAUSDT");
    assert!(venue().plan(&[]).is_empty());
}

#[test]
fn sends_no_subscribe_frame() {
    assert!(venue().subscribe_frames(&[market("BTCUSDT")], &mut None).is_empty());
}

#[test]
fn pings_with_a_protocol_ping_every_fifteen_seconds_and_drops_a_socket_silent_for_forty_five() {
    let settings = venue().settings();

    assert!(matches!(venue().ping(&mut None), Message::Ping(_)));
    assert_eq!(settings.ping_every, Some(Duration::from_secs(15)));
    assert_eq!(settings.max_silence, Duration::from_secs(45));
    assert_eq!(settings.connect_stagger, Duration::from_millis(100));
}

// snapshot and deltas

#[test]
fn routes_the_snapshot_without_a_symbol_to_the_connections_contract_and_sorts_its_levels() {
    let mut conn = connection("ETHUSDT");

    let published = send(&mut conn, &eth_snapshot());

    assert_eq!(published.len(), 1);
    assert_eq!(published[0].0, "ETHUSDT");
    assert_eq!(
        published[0].1,
        levels(&[(2483.0, 293.0), (2482.88, 389.0), (2482.86, 248.0), (2464.86, 196.0), (2400.0, 2.0)])
    );
    assert_eq!(
        published[0].2,
        levels(&[(2483.01, 414.0), (2483.02, 259.0), (2483.03, 191.0), (2483.16, 390.0), (2483.25, 426.0), (2644.0, 5.0)])
    );
    assert_eq!(conn.state, Some(4368409216));
}

#[test]
fn applies_deltas_whose_from_is_the_previous_to() {
    let mut conn = connection("ETHUSDT");
    send(&mut conn, &eth_snapshot());

    let first = send(&mut conn, &eth_first_delta());
    let second = send(&mut conn, &eth_second_delta());
    let third = send(&mut conn, &eth_third_delta());

    assert_eq!(first[0].1[..3], levels(&[(2483.0, 295.0), (2482.88, 389.0), (2482.86, 247.0)]));
    assert_eq!(first[0].2[0], BookLevel { price: 2483.01, size: 411.0 });
    assert_eq!(second[0].2[..2], levels(&[(2483.01, 415.0), (2483.02, 258.0)]));
    assert_eq!(third[0].1[..2], levels(&[(2483.0, 295.0), (2482.99, 424.0)]));
    assert_eq!(third[0].2, second[0].2); // the empty ask side changed nothing
    assert_eq!(conn.state, Some(4368409573));
    assert!(!conn.resync_requested());
}

#[test]
fn deletes_a_level_whose_size_is_zero() {
    let mut conn = connection("ETHUSDT");
    for frame in [eth_snapshot(), eth_first_delta(), eth_second_delta(), eth_third_delta()] {
        send(&mut conn, &frame);
    }

    let published = send(&mut conn, &eth_delete_delta());

    assert_eq!(published[0].1, levels(&[(2482.99, 424.0), (2482.88, 389.0), (2464.86, 196.0), (2400.0, 2.0)]));
    assert_eq!(published[0].2, levels(&[(2483.02, 258.0), (2483.16, 392.0), (2483.25, 426.0), (2644.0, 5.0)]));
}

#[test]
fn routes_a_delta_without_a_symbol_to_the_connections_contract() {
    let mut conn = connection("ETHUSDT");
    send(&mut conn, &eth_snapshot());

    let mut delta = eth_first_delta();
    delta.as_object_mut().unwrap().remove("symbol");
    let published = send(&mut conn, &delta);

    assert_eq!(published[0].0, "ETHUSDT");
    assert_eq!(conn.state, Some(4368409395));
}

#[test]
fn a_later_snapshot_replaces_the_book_and_restarts_the_chain() {
    let mut conn = connection("ETHUSDT");
    send(&mut conn, &eth_snapshot());
    send(&mut conn, &eth_first_delta());

    let published = send(&mut conn, &eth_snapshot());

    assert_eq!(published[0].1[0], BookLevel { price: 2483.0, size: 293.0 });
    assert_eq!(conn.state, Some(4368409216));
}

// gaps

#[test]
fn resyncs_on_a_delta_whose_from_is_not_the_previous_to() {
    let (logs, _capture) = capture();
    let mut conn = connection("ETHUSDT");
    send(&mut conn, &eth_snapshot());

    // The documented rule of to plus one, which the wire never follows.
    let mut delta = eth_first_delta();
    delta["from"] = json!(4368409217_u64);
    let published = send(&mut conn, &delta);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
    assert_eq!(resync[0].text("market"), "ETHUSDT");
}

#[test]
fn resyncs_on_a_delta_before_any_snapshot() {
    let (logs, _capture) = capture();
    let mut conn = connection("ETHUSDT");

    let published = send(&mut conn, &eth_first_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn resyncs_on_a_book_frame_without_a_to() {
    let mut conn = connection("ETHUSDT");
    let mut snapshot = eth_snapshot();
    snapshot.as_object_mut().unwrap().remove("to");

    assert!(send(&mut conn, &snapshot).is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn resyncs_on_a_delta_with_a_level_it_cannot_read_and_publishes_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection("ETHUSDT");
    send(&mut conn, &eth_snapshot());

    let mut delta = eth_first_delta();
    delta["bids"] = json!({ "2483": 295, "nope": 1 });
    let published = send(&mut conn, &delta);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn resyncs_on_a_snapshot_with_a_size_it_cannot_read() {
    let mut conn = connection("ETHUSDT");
    let mut snapshot = eth_snapshot();
    snapshot["asks"]["2483.01"] = Value::Null;

    assert!(send(&mut conn, &snapshot).is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn resyncs_on_a_book_frame_that_does_not_parse() {
    let (logs, _capture) = capture();
    let mut conn = connection("ETHUSDT");
    send(&mut conn, &eth_snapshot());

    // A side sent as an array instead of an object of price to size.
    let frame = r#"{"symbol":"ETHUSDT","from":4368409216,"to":4368409395,"asks":[["2483.01",411]],"bids":{}}"#;
    assert!(venue().handle(frame.as_bytes(), &mut conn).is_err());

    assert!(conn.take_published().is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "book_frame_unreadable");
}

// other frames

#[test]
fn drops_a_delta_for_another_symbol_and_logs_it_once() {
    let (logs, _capture) = capture();
    let mut conn = connection("ETHUSDT");
    send(&mut conn, &eth_snapshot());

    let mut delta = eth_first_delta();
    delta["symbol"] = json!("BTCUSDT");
    assert!(send(&mut conn, &delta).is_empty());
    assert!(send(&mut conn, &delta).is_empty());

    assert!(!conn.resync_requested());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
    assert_eq!(conn.state, Some(4368409216));
}

#[test]
fn takes_the_pong_to_a_json_object_as_traffic_only() {
    let (logs, _capture) = capture();
    let mut conn = connection("ETHUSDT");

    // The answers captured live on 2026-09-23 to {"ping":1} and to a JSON object with no ping key.
    assert!(send(&mut conn, &json!({ "pong": 1 })).is_empty());
    assert!(send(&mut conn, &json!({ "pong": null })).is_empty());

    assert!(logs.events("venue_notice").is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn logs_a_frame_with_no_sequence_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection("ETHUSDT");

    assert!(send(&mut conn, &json!({ "message": "maintenance" })).is_empty());

    assert_eq!(logs.events("venue_notice").len(), 1);
}

#[test]
fn fails_on_a_frame_that_is_not_json() {
    let mut conn = connection("ETHUSDT");

    assert!(venue().handle(b"hello", &mut conn).is_err());
    assert!(conn.take_published().is_empty());
    assert!(!conn.resync_requested());
}
