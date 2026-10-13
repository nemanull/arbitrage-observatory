// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use futures_util::{SinkExt, StreamExt};
use serde_json::json;
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;
type State = HashMap<usize, i64>;

fn market(raw_market_id: &str) -> Market {
    testing::market(ID, raw_market_id, &raw_market_id.replace("USDT", ""), "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}USDT")));
    }
    markets
}

fn venue() -> Apex {
    Apex::new(&[])
}

fn connection() -> Connection<State> {
    Connection::for_test("apex#perp#0", vec![market("BTCUSDT"), market("1000PEPEUSDT")])
}

fn level(price: f64, size: f64) -> BookLevel {
    BookLevel { price, size }
}

fn send(conn: &mut Connection<State>, frame: &Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// orderBook25.H.BTCUSDT captured live on 2026-10-12 at 22:33 UTC: the snapshot cut to 5 bids and 7 asks of 25, then the two deltas that followed it.
// The snapshot's bids are worst first, as the wire sends them, and the delta levels are in the wire's own order.
fn btc_snapshot() -> Value {
    json!({"topic":"orderBook25.H.BTCUSDT","type":"snapshot","data":{"s":"BTCUSDT",
        "b":[["82492.6","0.153"],["82492.7","0.345"],["82534.8","0.220"],["82574.1","0.495"],["82576.9","4.432"]],
        "a":[["82580.5","4.216"],["82586.0","0.396"],["82622.3","0.145"],["82623.3","0.001"],["82665.0","0.227"],["82665.3","0.143"],["82665.5","0.148"]],
        "u":13872538},"cs":66884108737_i64,"ts":1791844381376435_i64})
}

fn btc_delta_539() -> Value {
    json!({"topic":"orderBook25.H.BTCUSDT","type":"delta","data":{"s":"BTCUSDT",
        "b":[["82492.7","0.202"],["82534.8","0"],["82492.6","0"],["82535.7","0.180"],["82493.6","0.251"]],
        "a":[["82580.5","0"],["82622.3","0"],["82623.3","0.136"],["82679.0","0.001"],["82685.1","0.435"]],
        "u":13872539},"cs":66884108815_i64,"ts":1791844381421600_i64})
}

fn btc_delta_540() -> Value {
    json!({"topic":"orderBook25.H.BTCUSDT","type":"delta","data":{"s":"BTCUSDT","b":[],
        "a":[["82665.0","0"],["82665.3","0"],["82665.5","0"],["82623.3","0.001"],["82679.0","0"],["82685.1","0"],["82666.8","0.046"],["82667.3","0.042"],["82667.1","0.058"],["82624.8","0.051"],["82667.0","0.044"]],
        "u":13872540},"cs":66884108867_i64,"ts":1791844381473212_i64})
}

// plan and settings

#[test]
fn puts_every_market_on_one_socket_with_the_connect_time_in_the_url() {
    let before = now_ms();
    let plans = venue().plan(&markets(128));

    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0].id, "apex#perp#0");
    assert_eq!(plans[0].markets.len(), 128);
    let stamp = plans[0].url.strip_prefix("wss://quote.omni.apex.exchange/realtime_public?v=2&timestamp=").unwrap();
    let stamp: i64 = stamp.parse().unwrap();
    assert!(stamp >= before && stamp <= now_ms());
    assert!(venue().plan(&[]).is_empty());
}

#[test]
fn watches_twenty_seconds_of_silence_pings_every_15_seconds_and_paces_subscribes_at_5_ms() {
    let settings = venue().settings();

    assert_eq!(settings.max_silence, Duration::from_secs(20));
    assert_eq!(settings.ping_every, Some(Duration::from_secs(15)));
    assert_eq!(settings.subscribe_gap, Duration::from_millis(5));
}

// subscribe_frames and ping

#[test]
fn subscribes_the_anchor_channel_first_and_then_one_book_topic_per_frame() {
    let frames = venue().subscribe_frames(&[market("BTCUSDT"), market("1000PEPEUSDT")], &mut State::new());

    let frames: Vec<Value> = frames.iter().map(parsed).collect();
    assert_eq!(
        frames,
        [
            json!({ "op": "subscribe", "args": ["instrumentInfo.all"] }),
            json!({ "op": "subscribe", "args": ["orderBook25.H.BTCUSDT"] }),
            json!({ "op": "subscribe", "args": ["orderBook25.H.1000PEPEUSDT"] }),
        ]
    );
}

#[test]
fn pings_with_the_op_ping_and_the_time_in_ms() {
    let before = now_ms();
    let ping = parsed(&venue().ping(&mut State::new()));

    assert_eq!(ping["op"], "ping");
    let sent: i64 = ping["args"][0].as_str().unwrap().parse().unwrap();
    assert!(sent >= before && sent <= now_ms());
}

// books

#[test]
fn a_snapshot_with_its_bids_worst_first_becomes_a_book_best_first() {
    let mut conn = connection();

    let published = send(&mut conn, &btc_snapshot());

    assert_eq!(published.len(), 1);
    let (symbol, bids, asks) = &published[0];
    assert_eq!(symbol, "BTCUSDT");
    assert_eq!(bids[..2], [level(82576.9, 4.432), level(82574.1, 0.495)]);
    assert_eq!(bids[4], level(82492.6, 0.153));
    assert_eq!(asks[..2], [level(82580.5, 4.216), level(82586.0, 0.396)]);
    assert_eq!((bids.len(), asks.len()), (5, 7));
}

#[test]
fn a_delta_applies_each_level_by_its_price_whatever_its_order() {
    let mut conn = connection();
    send(&mut conn, &btc_snapshot());

    let published = send(&mut conn, &btc_delta_539());

    let (_, bids, asks) = &published[0];
    assert_eq!(
        *bids,
        [level(82576.9, 4.432), level(82574.1, 0.495), level(82535.7, 0.18), level(82493.6, 0.251), level(82492.7, 0.202)]
    );
    assert_eq!(asks[..3], [level(82586.0, 0.396), level(82623.3, 0.136), level(82665.0, 0.227)]);
    assert_eq!(asks.last(), Some(&level(82685.1, 0.435)));
}

#[test]
fn a_delta_with_one_side_leaves_the_other_side_alone() {
    let mut conn = connection();
    send(&mut conn, &btc_snapshot());
    send(&mut conn, &btc_delta_539());

    let published = send(&mut conn, &btc_delta_540());

    let (_, bids, asks) = &published[0];
    assert_eq!(bids[0], level(82576.9, 4.432));
    assert_eq!(bids.len(), 5);
    assert_eq!(
        *asks,
        [
            level(82586.0, 0.396),
            level(82623.3, 0.001),
            level(82624.8, 0.051),
            level(82666.8, 0.046),
            level(82667.0, 0.044),
            level(82667.1, 0.058),
            level(82667.3, 0.042),
        ]
    );
    assert!(!conn.resync_requested());
}

#[test]
fn a_delta_whose_u_is_not_the_last_plus_one_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, &btc_snapshot());

    assert!(send(&mut conn, &btc_delta_540()).is_empty());

    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync[0].text("market"), "BTCUSDT");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn a_repeated_delta_resyncs() {
    let mut conn = connection();
    send(&mut conn, &btc_snapshot());
    send(&mut conn, &btc_delta_539());

    assert!(send(&mut conn, &btc_delta_539()).is_empty());

    assert!(conn.resync_requested());
}

#[test]
fn a_delta_before_any_snapshot_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    assert!(send(&mut conn, &btc_delta_539()).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

// The docs say a snapshot restarts u at 1, which the wire never did, and either way it sets the base.
#[test]
fn a_later_snapshot_replaces_the_book_and_sets_the_base_of_the_chain() {
    let mut conn = connection();
    send(&mut conn, &btc_snapshot());
    send(&mut conn, &btc_delta_539());
    let mut restart = btc_snapshot();
    restart["data"]["u"] = json!(1);
    restart["data"]["b"] = json!([["82500.0", "1.0"]]);
    restart["data"]["a"] = json!([["82501.0", "2.0"]]);
    let mut next = btc_delta_539();
    next["data"]["u"] = json!(2);
    next["data"]["b"] = json!([["82499.0", "3.0"]]);
    next["data"]["a"] = json!([]);

    let replaced = send(&mut conn, &restart);
    let published = send(&mut conn, &next);

    assert_eq!(replaced[0].1, [level(82500.0, 1.0)]);
    assert_eq!(replaced[0].2, [level(82501.0, 2.0)]);
    assert_eq!(published[0].1, [level(82500.0, 1.0), level(82499.0, 3.0)]);
    assert!(!conn.resync_requested());
}

#[test]
fn a_delta_without_levels_moves_the_chain_and_publishes_nothing() {
    let mut conn = connection();
    send(&mut conn, &btc_snapshot());
    let mut empty = btc_delta_539();
    empty["data"]["b"] = json!([]);
    empty["data"]["a"] = json!([]);

    assert!(send(&mut conn, &empty).is_empty());
    assert_eq!(send(&mut conn, &btc_delta_540()).len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn a_level_that_does_not_read_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, &btc_snapshot());
    let mut broken = btc_delta_539();
    broken["data"]["b"][0] = json!(["", "0.202"]);

    assert!(send(&mut conn, &broken).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn a_book_frame_that_does_not_parse_resyncs_and_fails() {
    let mut conn = connection();
    send(&mut conn, &btc_snapshot());
    let mut broken = btc_delta_539();
    broken["data"]["a"] = json!([["82580.5"]]);

    assert!(venue().handle(broken.to_string().as_bytes(), &mut conn).is_err());

    assert!(conn.resync_requested());
    assert!(conn.take_published().is_empty());
}

#[test]
fn a_book_frame_neither_snapshot_nor_delta_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, &btc_snapshot());
    let mut odd = btc_delta_539();
    odd["type"] = json!("update");

    assert!(send(&mut conn, &odd).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "unknown_type");
}

#[test]
fn the_symbol_comes_from_the_topic_and_one_nobody_subscribed_is_dropped_and_logged_once() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let mut other = btc_snapshot();
    other["topic"] = json!("orderBook25.H.ETHUSDT");

    assert!(send(&mut conn, &other).is_empty());
    assert!(send(&mut conn, &other).is_empty());

    let warned = logs.events("unsubscribed_symbol");
    assert_eq!(warned.len(), 1);
    assert_eq!(warned[0].text("market"), "ETHUSDT");
    assert!(!conn.resync_requested());
}

#[test]
fn a_book_of_another_depth_is_not_read() {
    let mut conn = connection();
    let mut deeper = btc_snapshot();
    deeper["topic"] = json!("orderBook200.H.BTCUSDT");

    assert!(send(&mut conn, &deeper).is_empty());
}

// the session

// Captured live on 2026-10-12.
#[test]
fn a_server_ping_is_answered_with_a_pong_that_carries_its_args() {
    let mut conn = connection();

    assert!(send(&mut conn, &json!({"op":"ping","args":["1791843653937"]})).is_empty());

    let sent: Vec<Value> = conn.take_sent().iter().map(parsed).collect();
    assert_eq!(sent, [json!({ "op": "pong", "args": ["1791843653937"] })]);
}

#[test]
fn a_server_ping_without_args_is_answered_with_the_time() {
    let mut conn = connection();

    send(&mut conn, &json!({ "op": "ping" }));

    let sent = parsed(&conn.take_sent()[0]);
    assert_eq!(sent["op"], "pong");
    assert!(sent["args"][0].as_str().unwrap().parse::<i64>().is_ok());
}

// Captured live on 2026-10-12: a subscribe acknowledgement and the answer to the client's ping.
#[test]
fn acknowledgements_and_the_answer_to_a_ping_change_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let ack = json!({"success":true,"ret_msg":"","conn_id":"88acfa4e-d562-49e7-a8f3-d70b7900119c","request":{"op":"subscribe","args":["orderBook25.H.BTCUSDT"]}});
    let pong = json!({"success":true,"ret_msg":"pong","conn_id":"f53ced3a-4c5c-4bb8-b18d-29bb04188e91","request":{"op":"ping","args":["1791843546130"]}});

    assert!(send(&mut conn, &ack).is_empty());
    assert!(send(&mut conn, &pong).is_empty());

    assert!(logs.lines().is_empty());
    assert!(conn.take_sent().is_empty());
    assert!(!conn.resync_requested());
}

// Captured live on 2026-10-12: an unknown symbol, a second subscribe of one topic, and an unknown op.
#[test]
fn an_error_frame_is_logged_as_a_venue_error_and_the_connection_carries_on() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let unknown = json!({"success":false,"ret_msg":"error:handler not found","conn_id":"f53ced3a-4c5c-4bb8-b18d-29bb04188e91","request":{"op":"subscribe","args":["orderBook25.H.NOPEUSDT"]}});
    let again = json!({"success":false,"ret_msg":"error:topic:already subscribed orderBook25.H.BTCUSDT","conn_id":"f53ced3a-4c5c-4bb8-b18d-29bb04188e91","request":{"op":"subscribe","args":["orderBook25.H.BTCUSDT"]}});
    let bad_op = json!({"success":false,"ret_msg":"error:invalid op","conn_id":"f53ced3a-4c5c-4bb8-b18d-29bb04188e91","request":{"op":"nope","args":[]}});

    for frame in [&unknown, &again, &bad_op] {
        assert!(send(&mut conn, frame).is_empty());
    }

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 3);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "apex#perp#0");
    assert_eq!(errors[0].text("op"), "subscribe");
    assert_eq!(errors[0].text("args"), r#"["orderBook25.H.NOPEUSDT"]"#);
    assert_eq!(errors[0].text("message"), "error:handler not found");
    assert!(errors[1].text("message").starts_with("error:topic:already subscribed"));
    assert_eq!(errors[2].text("op"), "nope");
    assert!(!conn.resync_requested());
}

#[test]
fn a_frame_that_is_not_json_is_an_error() {
    let mut conn = connection();

    assert!(venue().handle(b"Failed to decode", &mut conn).is_err());
    assert!(conn.take_published().is_empty());
}

// Prints the first frames of the live socket, which the cases above are built from:
// cargo test apex::tests::capture_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_frames() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let markets: Vec<Market> = std::env::var("CAPTURE_MARKETS")
        .unwrap_or_else(|_| "BTCUSDT,1000PEPEUSDT".to_string())
        .split(',')
        .map(market)
        .collect();
    let plan = venue().plan(&markets).remove(0);
    let (mut socket, _) = tokio_tungstenite::connect_async(plan.url.as_str()).await.unwrap();
    for frame in venue().subscribe_frames(&markets, &mut State::new()) {
        socket.send(frame).await.unwrap();
    }
    socket.send(subscribe("orderBook25.H.NOPEUSDT")).await.unwrap();
    socket.send(venue().ping(&mut State::new())).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    let mut printed = 0;
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, socket.next()).await {
        let Message::Text(text) = message else {
            continue;
        };
        if printed < 30 {
            println!("{}", &text[..text.len().min(600)]);
        }
        printed += 1;
    }
}
