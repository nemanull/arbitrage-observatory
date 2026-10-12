// Frames captured live on 2026-10-09 with capture_live_frames below, with the level arrays cut down.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.split('_').nth(1).unwrap();
    testing::market(NIZA_ID, raw_market_id, base, "USDC", true)
}

fn markets(count: usize) -> Vec<Market> {
    (0..count).map(|i| market(&format!("PERP_SYM{i}_USDC"))).collect()
}

fn venue() -> Orderly {
    Orderly::new(&NIZA)
}

fn connection() -> Connection<State> {
    Connection::for_test("niza#perp#0", vec![market("PERP_ETH_USDC"), market("PERP_MERL_USDC")])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    pairs.iter().map(|&(price, size)| BookLevel { price, size }).collect()
}

fn send(conn: &mut Connection<State>, frame: Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

fn eth_snapshot(ts: i64) -> Value {
    json!({
        "topic": "PERP_ETH_USDC@orderbook", "ts": ts,
        "data": { "symbol": "PERP_ETH_USDC", "asks": [[2483.49, 1.4930], [2483.55, 12.3171]], "bids": [[2483.48, 0.9423], [2482.85, 20.1]] },
    })
}

const ETH_SNAPSHOT_TS: i64 = 1791573805786;

// The first delta after the snapshot above, as it came.
fn eth_delta() -> Value {
    json!({
        "topic": "PERP_ETH_USDC@orderbookupdate", "ts": 1791573806187_i64,
        "data": { "symbol": "PERP_ETH_USDC", "prevTs": ETH_SNAPSHOT_TS, "asks": [], "bids": [[2482.85, 23.6137], [2481.52, 0.6131]] },
    })
}

fn eth_next_delta() -> Value {
    json!({
        "topic": "PERP_ETH_USDC@orderbookupdate", "ts": 1791573806986_i64,
        "data": { "symbol": "PERP_ETH_USDC", "prevTs": 1791573806187_i64, "asks": [[2483.49, 0.0000], [2483.69, 7.4651]], "bids": [] },
    })
}

// plan

#[test]
fn puts_50_markets_on_each_socket_for_the_100_topic_cap() {
    let plans = venue().plan(&markets(73));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [50, 23]);
    assert_eq!(plans[1].id, "niza#perp#1");
    assert_eq!(plans[0].url, "wss://ws-evm.orderly.org/ws/stream/OqdphuyCtYWxwzhxyLLjOWNdFP7sQt8RPWzmb5xY");
    assert_eq!(Orderly::new(&NONKYC).plan(&markets(1))[0].id, "nonkyc#perp#0");
}

#[test]
fn answers_the_ten_second_server_ping_and_pings_every_ten_seconds_inside_a_30_second_silence() {
    let mut conn = connection();

    send(&mut conn, json!({ "event": "ping", "ts": 1791573810000_i64 }));

    let sent = conn.take_sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(parsed(&sent[0])["event"], "pong");
    assert!(parsed(&sent[0])["ts"].as_i64().unwrap() > 1791573810000);
    assert_eq!(parsed(&venue().ping(&mut State::default())), json!({ "event": "ping" }));
    let settings = venue().settings();
    assert_eq!(settings.ping_every, Some(Duration::from_secs(10)));
    assert_eq!(settings.max_silence, Duration::from_secs(30));
}

// subscribe_frames

#[test]
fn subscribes_the_delta_topic_then_the_snapshot_topic_one_frame_each_with_the_topic_as_id() {
    let frames = venue().subscribe_frames(&[market("PERP_ETH_USDC"), market("PERP_MERL_USDC")], &mut State::default());

    let frames: Vec<Value> = frames.iter().map(parsed).collect();
    assert_eq!(
        frames,
        [
            json!({ "id": "PERP_ETH_USDC@orderbookupdate", "event": "subscribe", "topic": "PERP_ETH_USDC@orderbookupdate" }),
            json!({ "id": "PERP_ETH_USDC@orderbook", "event": "subscribe", "topic": "PERP_ETH_USDC@orderbook" }),
            json!({ "id": "PERP_MERL_USDC@orderbookupdate", "event": "subscribe", "topic": "PERP_MERL_USDC@orderbookupdate" }),
            json!({ "id": "PERP_MERL_USDC@orderbook", "event": "subscribe", "topic": "PERP_MERL_USDC@orderbook" }),
        ]
    );
}

// handle

#[test]
fn hands_the_engine_a_snapshot_as_the_whole_book() {
    let mut conn = connection();

    let published = send(&mut conn, eth_snapshot(ETH_SNAPSHOT_TS));

    assert_eq!(
        published,
        [(
            "PERP_ETH_USDC".to_string(),
            levels(&[(2483.48, 0.9423), (2482.85, 20.1)]),
            levels(&[(2483.49, 1.4930), (2483.55, 12.3171)]),
        )]
    );
}

#[test]
fn applies_deltas_chained_by_prev_ts_and_deletes_a_level_of_size_zero() {
    let mut conn = connection();
    send(&mut conn, eth_snapshot(ETH_SNAPSHOT_TS));

    let first = send(&mut conn, eth_delta());
    let second = send(&mut conn, eth_next_delta());

    assert_eq!(first[0].1, levels(&[(2483.48, 0.9423), (2482.85, 23.6137), (2481.52, 0.6131)]));
    assert_eq!(second[0].2, levels(&[(2483.55, 12.3171), (2483.69, 7.4651)]));
    assert!(!conn.resync_requested());
}

#[test]
fn restarts_the_connection_on_a_delta_whose_prev_ts_is_not_the_last_ts() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, eth_snapshot(ETH_SNAPSHOT_TS));

    let published = send(&mut conn, eth_next_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync[0].text("market"), "PERP_ETH_USDC");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

// The snapshot of a change came 10 ms after the delta of that change on 2026-10-09, with the same ts.
#[test]
fn skips_a_snapshot_no_newer_than_the_book() {
    let mut conn = connection();
    send(&mut conn, eth_snapshot(ETH_SNAPSHOT_TS));
    send(&mut conn, eth_delta());

    let same = send(&mut conn, eth_snapshot(1791573806187));
    let older = send(&mut conn, eth_snapshot(ETH_SNAPSHOT_TS));
    let next = send(&mut conn, eth_next_delta());

    assert!(same.is_empty() && older.is_empty());
    assert_eq!(next[0].1, levels(&[(2483.48, 0.9423), (2482.85, 23.6137), (2481.52, 0.6131)]));
    assert!(!conn.resync_requested());
}

#[test]
fn replaces_the_book_with_a_newer_snapshot_and_skips_the_deltas_it_covers() {
    let mut conn = connection();
    send(&mut conn, eth_snapshot(ETH_SNAPSHOT_TS));

    let replaced = send(&mut conn, eth_snapshot(1791573806187));
    let covered = send(&mut conn, eth_delta());
    let next = send(&mut conn, eth_next_delta());

    assert_eq!(replaced[0].1, levels(&[(2483.48, 0.9423), (2482.85, 20.1)]));
    assert!(covered.is_empty());
    assert_eq!(next[0].2, levels(&[(2483.55, 12.3171), (2483.69, 7.4651)]));
    assert!(!conn.resync_requested());
}

#[test]
fn holds_the_deltas_that_come_before_the_first_snapshot_and_replays_the_newer_ones_on_it() {
    let mut conn = connection();

    let held = send(&mut conn, eth_delta());
    let older = send(&mut conn, eth_next_delta());
    let seeded = send(&mut conn, eth_snapshot(ETH_SNAPSHOT_TS));

    assert!(held.is_empty() && older.is_empty());
    assert_eq!(seeded[0].1, levels(&[(2483.48, 0.9423), (2482.85, 23.6137), (2481.52, 0.6131)]));
    assert_eq!(seeded[0].2, levels(&[(2483.55, 12.3171), (2483.69, 7.4651)]));
    assert!(!conn.resync_requested());
}

#[test]
fn drops_a_held_delta_the_first_snapshot_already_covers() {
    let mut conn = connection();
    send(&mut conn, eth_delta());

    let seeded = send(&mut conn, eth_snapshot(1791573806187));
    let next = send(&mut conn, eth_next_delta());

    assert_eq!(seeded[0].1, levels(&[(2483.48, 0.9423), (2482.85, 20.1)]));
    assert_eq!(next[0].2, levels(&[(2483.55, 12.3171), (2483.69, 7.4651)]));
}

#[test]
fn waits_for_the_next_snapshot_when_the_held_deltas_do_not_chain_from_the_first() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, eth_next_delta());

    let behind = send(&mut conn, eth_snapshot(ETH_SNAPSHOT_TS));
    let seeded = send(&mut conn, eth_snapshot(1791573806187));

    assert!(behind.is_empty());
    assert!(!conn.resync_requested());
    assert_eq!(logs.events("snapshot_behind")[0].text("market"), "PERP_ETH_USDC");
    assert_eq!(seeded[0].2, levels(&[(2483.55, 12.3171), (2483.69, 7.4651)]));
}

#[test]
fn holds_at_most_100_deltas_and_drops_the_oldest() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    for ts in 1..=101_i64 {
        send(&mut conn, json!({ "topic": "PERP_ETH_USDC@orderbookupdate", "ts": ts, "data": { "prevTs": ts - 1, "asks": [], "bids": [[2480.0, ts]] } }));
    }

    let behind = send(&mut conn, eth_snapshot(0));
    let seeded = send(&mut conn, eth_snapshot(1));

    assert!(behind.is_empty());
    assert_eq!(logs.events("snapshot_behind").len(), 1);
    assert_eq!(seeded[0].1[2], BookLevel { price: 2480.0, size: 101.0 });
}

#[test]
fn restarts_the_connection_on_a_delta_that_names_no_prev_ts() {
    let mut conn = connection();
    send(&mut conn, eth_snapshot(ETH_SNAPSHOT_TS));
    let mut delta = eth_delta();
    delta["data"].as_object_mut().unwrap().remove("prevTs");

    let published = send(&mut conn, delta);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn moves_the_chain_on_an_empty_delta_without_publishing() {
    let mut conn = connection();
    send(&mut conn, eth_snapshot(ETH_SNAPSHOT_TS));
    let mut empty = eth_delta();
    empty["data"]["bids"] = json!([]);

    let quiet = send(&mut conn, empty);
    let next = send(&mut conn, eth_next_delta());

    assert!(quiet.is_empty());
    assert_eq!(next[0].2, levels(&[(2483.55, 12.3171), (2483.69, 7.4651)]));
    assert!(!conn.resync_requested());
}

#[test]
fn restarts_the_connection_on_a_delta_with_a_level_it_cannot_read() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, eth_snapshot(ETH_SNAPSHOT_TS));
    let mut broken = eth_delta();
    broken["data"]["bids"] = json!([[2482.85, null], [2481.52, 0.6131]]);

    let published = send(&mut conn, broken);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn restarts_the_connection_on_a_snapshot_with_a_level_it_cannot_read() {
    let mut conn = connection();
    let mut broken = eth_snapshot(ETH_SNAPSHOT_TS);
    broken["data"]["asks"] = json!([["x", 1.4930], [2483.55, 12.3171]]);

    let published = send(&mut conn, broken);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
}

// A delta that fails to parse is lost, so the one after it no longer chains and the connection restarts.
#[test]
fn restarts_the_connection_after_a_delta_that_does_not_parse() {
    let mut conn = connection();
    send(&mut conn, eth_snapshot(ETH_SNAPSHOT_TS));
    let mut broken = eth_delta();
    broken["data"]["bids"] = json!({ "2482.85": 23.6137 });

    assert!(venue().handle(broken.to_string().as_bytes(), &mut conn).is_err());
    let published = send(&mut conn, eth_next_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn keeps_each_market_on_its_own_chain() {
    let mut conn = connection();
    send(&mut conn, eth_snapshot(ETH_SNAPSHOT_TS));
    send(
        &mut conn,
        json!({
            "topic": "PERP_MERL_USDC@orderbook", "ts": 1791573805460_i64,
            "data": { "symbol": "PERP_MERL_USDC", "asks": [[0.03135, 20017], [0.03136, 15979]], "bids": [[0.03129, 18000], [0.03124, 500]] },
        }),
    );

    let merl = send(
        &mut conn,
        json!({
            "topic": "PERP_MERL_USDC@orderbookupdate", "ts": 1791573806061_i64,
            "data": { "symbol": "PERP_MERL_USDC", "prevTs": 1791573805460_i64, "asks": [[0.03157, 23281]], "bids": [[0.03129, 19611], [0.03124, 0]] },
        }),
    );
    let eth = send(&mut conn, eth_delta());

    assert_eq!(merl[0].0, "PERP_MERL_USDC");
    assert_eq!(merl[0].1, levels(&[(0.03129, 19611.0)]));
    assert_eq!(eth[0].0, "PERP_ETH_USDC");
    assert!(!conn.resync_requested());
}

#[test]
fn drops_a_symbol_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = Connection::for_test("niza#perp#0", vec![market("PERP_BTC_USDC")]);

    let snapshot = send(&mut conn, eth_snapshot(ETH_SNAPSHOT_TS));
    let delta = send(&mut conn, eth_delta());

    assert!(snapshot.is_empty() && delta.is_empty());
    assert!(!conn.resync_requested());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

#[test]
fn logs_a_refused_subscribe_and_stays_silent_on_the_acknowledgement_and_the_pong() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, json!({ "id": "PERP_ETH_USDC@orderbookupdate", "event": "subscribe", "success": true, "ts": 1791573805791_i64 }));
    send(&mut conn, json!({ "event": "pong", "ts": 1791573805796_i64 }));
    send(
        &mut conn,
        json!({ "id": "PERP_NOPE_USDC@orderbookupdate", "success": false, "ts": 1791573805795_i64, "errorMsg": "invalid symbol PERP_NOPE_USDC" }),
    );
    send(&mut conn, json!({ "success": false, "ts": 1791573805796_i64, "errorMsg": "invalid message" }));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("id"), "PERP_NOPE_USDC@orderbookupdate");
    assert_eq!(errors[0].text("message"), "invalid symbol PERP_NOPE_USDC");
    assert_eq!(errors[1].text("message"), "invalid message");
    assert!(logs.events("venue_notice").is_empty());
    assert!(conn.take_sent().is_empty());
}

#[test]
fn logs_a_frame_it_does_not_know_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, json!({ "event": "maintenance", "ts": 1791573805796_i64 }));

    assert_eq!(logs.events("venue_notice").len(), 1);
}

#[test]
fn ignores_a_topic_that_is_not_a_book() {
    let mut conn = connection();

    let published = send(
        &mut conn,
        json!({ "topic": "PERP_ETH_USDC@estfundingrate", "ts": 1791573810000_i64, "data": { "symbol": "PERP_ETH_USDC", "fundingRate": 0.0001 } }),
    );

    assert!(published.is_empty());
}

// Prints the frames of a short live session, the source of the captures below:
// cargo test orderly::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut socket, _) = tokio_tungstenite::connect_async(URL).await.unwrap();
    let markets = [
        crate::venues::testing::market(NIZA_ID, "PERP_ETH_USDC", "ETH", "USDC", true),
        crate::venues::testing::market(NIZA_ID, "PERP_MERL_USDC", "MERL", "USDC", true),
        crate::venues::testing::market(NIZA_ID, "PERP_NOPE_USDC", "NOPE", "USDC", true),
    ];
    for frame in Orderly::new(&NIZA).subscribe_frames(&markets, &mut State::default()) {
        socket.send(frame).await.unwrap();
    }
    socket.send(Message::text("hello")).await.unwrap();
    socket.send(Orderly::new(&NIZA).ping(&mut State::default())).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(25);
    while let Ok(Some(Ok(frame))) = tokio::time::timeout_at(deadline, socket.next()).await {
        println!("{} {}", now_ms(), frame.into_text().unwrap());
    }
}
