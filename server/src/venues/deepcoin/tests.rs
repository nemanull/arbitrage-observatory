use super::*;
use crate::engine::cluster::BookLevel;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

fn market(raw_market_id: &str) -> Market {
    testing::market(ID, raw_market_id, "TMF", "USDT", true)
}

fn venue() -> Deepcoin {
    Deepcoin::with_rest("http://unused", 0)
}

// A connection whose subscribe frames have gone out, so the wire ids route.
fn connection(raw_ids: &[&str]) -> Connection<State> {
    let markets: Vec<Market> = raw_ids.iter().map(|id| market(id)).collect();
    let mut conn = Connection::for_test("deepcoin#swap#0", markets.clone());
    venue().subscribe_frames(&markets, &mut conn.state);
    conn
}

fn handle(conn: &mut Connection<State>, frame: Value) {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
}

fn handle_at(conn: &mut Connection<State>, frame: Value, at: i64) {
    venue().handle_at(frame.to_string().as_bytes(), conn, at).unwrap();
}

fn level(price: f64, size: f64) -> BookLevel {
    BookLevel { price, size }
}

fn entry(instrument: &str, side: &str, price: f64, size: f64) -> Value {
    json!({"d": {"D": side, "I": instrument, "P": price, "V": size}})
}

// TopicID 25 frames on TMFUSDT captured live on 2026-10-09, cut to three levels a side of 63.
fn snapshot() -> Value {
    json!({"a":"PMO","mt":1791568219033_i64,"pt":1791568219033_i64,"r":[
        {"d":{"D":"0","I":"TMFUSDT","P":25.93,"V":258.0}},{"d":{"D":"0","I":"TMFUSDT","P":25.92,"V":3562.0}},{"d":{"D":"0","I":"TMFUSDT","P":25.91,"V":5732.0}},
        {"d":{"D":"1","I":"TMFUSDT","P":25.94,"V":6636.0}},{"d":{"D":"1","I":"TMFUSDT","P":25.95,"V":24070.0}},{"d":{"D":"1","I":"TMFUSDT","P":25.96,"V":5754.0}}
    ],"t":"f","tt":1791568219033_i64})
}

fn delta(levels: Vec<Value>) -> Value {
    json!({"a":"PMO","mt":1791568219409_i64,"pt":1791568219416_i64,"r":levels,"t":"i","tt":1791568219407_i64})
}

fn snapshotted() -> Connection<State> {
    let mut conn = connection(&["TMFUSDT_0.01", "BTCUSDT_0.1"]);
    handle(&mut conn, snapshot());
    conn.take_published();
    conn
}

fn text(message: &Message) -> String {
    message.to_text().unwrap().to_string()
}

#[test]
fn keeps_the_socket_alive_with_a_text_ping_every_ten_seconds_and_paces_the_subscribes() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(10)));
    assert_eq!(settings.max_silence, Duration::from_secs(25));
    assert_eq!(settings.subscribe_gap, Duration::from_millis(5));
    assert_eq!(text(&venue().ping(&mut State::default())), "ping");
}

#[test]
fn plans_35_markets_a_socket_and_never_more_than_ten_sockets() {
    let markets = |n: usize| -> Vec<Market> { (0..n).map(|i| market(&format!("M{i}USDT_0.1"))).collect() };
    let sizes = |n: usize| -> Vec<usize> { venue().plan(&markets(n)).iter().map(|p| p.markets.len()).collect() };

    assert_eq!(sizes(35), [35]);
    assert_eq!(sizes(70), [35, 35]);
    assert_eq!(sizes(71), [24, 24, 23]);
    let full = sizes(359);
    assert_eq!(full.len(), 10);
    assert_eq!(full.iter().sum::<usize>(), 359);
    assert!(full.iter().all(|&n| n <= 36));
    assert!(venue().plan(&[]).is_empty());

    let plans = venue().plan(&markets(36));
    assert_eq!(plans[1].id, "deepcoin#swap#1");
    assert_eq!(plans[0].url, SWAP_URL);
}

#[test]
fn subscribes_each_book_by_its_tick_size_and_each_ticker_by_its_wire_id_one_frame_each() {
    let markets = vec![market("BTCUSDT_0.1"), market("1000PEPEUSDT_0.0000001")];
    let mut state = State::default();

    let frames: Vec<Value> = venue()
        .subscribe_frames(&markets, &mut state)
        .iter()
        .map(|frame| serde_json::from_str(&text(frame)).unwrap())
        .collect();

    assert_eq!(
        frames,
        [
            json!({"SendTopicAction": {"Action": "1", "FilterValue": "DeepCoin_BTCUSDT_0.1", "LocalNo": 1, "ResumeNo": -1, "TopicID": "25"}}),
            json!({"SendTopicAction": {"Action": "1", "FilterValue": "DeepCoin_BTCUSDT", "LocalNo": 3, "ResumeNo": -1, "TopicID": "7"}}),
            json!({"SendTopicAction": {"Action": "1", "FilterValue": "DeepCoin_1000PEPEUSDT_0.0000001", "LocalNo": 2, "ResumeNo": -1, "TopicID": "25"}}),
            json!({"SendTopicAction": {"Action": "1", "FilterValue": "DeepCoin_1000PEPEUSDT", "LocalNo": 4, "ResumeNo": -1, "TopicID": "7"}}),
        ]
    );
    assert_eq!(state.positions["BTCUSDT"], 0);
    assert_eq!(state.positions["1000PEPEUSDT"], 1);
}

#[test]
fn a_snapshot_replaces_the_book_in_contracts() {
    let mut conn = connection(&["TMFUSDT_0.01"]);

    handle(&mut conn, snapshot());

    assert_eq!(
        conn.take_published(),
        [(
            "TMFUSDT_0.01".to_string(),
            vec![level(25.93, 258.0), level(25.92, 3562.0), level(25.91, 5732.0)],
            vec![level(25.94, 6636.0), level(25.95, 24070.0), level(25.96, 5754.0)],
        )]
    );
}

#[test]
fn a_delta_applies_each_level_by_price_in_any_order_and_a_zero_size_deletes() {
    let mut conn = snapshotted();

    handle(
        &mut conn,
        delta(vec![
            entry("TMFUSDT", "1", 25.96, 0.0),
            entry("TMFUSDT", "0", 25.91, 8120.0),
            entry("TMFUSDT", "0", 25.93, 340.0),
            entry("TMFUSDT", "1", 25.97, 12.0),
            entry("TMFUSDT", "0", 25.92, 0.0),
        ]),
    );

    let published = conn.take_published();
    assert_eq!(published.len(), 1);
    assert_eq!(published[0].1, [level(25.93, 340.0), level(25.91, 8120.0)]);
    assert_eq!(published[0].2, [level(25.94, 6636.0), level(25.95, 24070.0), level(25.97, 12.0)]);
}

#[test]
fn an_idle_delta_that_repeats_the_touch_still_publishes() {
    let mut conn = snapshotted();

    handle(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 258.0), entry("TMFUSDT", "1", 25.94, 6636.0)]));

    assert_eq!(conn.take_published().len(), 1);
}

#[test]
fn a_mid_stream_snapshot_replaces_the_book_again() {
    let mut conn = snapshotted();
    handle(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.80, 1.0)]));
    conn.take_published();

    let mut again = snapshot();
    again["r"] = json!([entry("TMFUSDT", "0", 25.90, 5.0), entry("TMFUSDT", "1", 25.95, 6.0)]);
    handle(&mut conn, again);

    assert_eq!(conn.take_published(), [("TMFUSDT_0.01".to_string(), vec![level(25.90, 5.0)], vec![level(25.95, 6.0)])]);
}

#[test]
fn a_delta_before_the_snapshot_is_dropped() {
    let mut conn = connection(&["TMFUSDT_0.01"]);

    handle(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 340.0)]));

    assert!(conn.take_published().is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn a_crossed_book_is_emptied_and_its_stream_resubscribed_on_the_same_socket() {
    let (logs, _capture) = capture();
    let mut conn = snapshotted();

    // A lost delta left the 25.94 ask standing after the bid moved through it.
    handle(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.95, 100.0)]));

    assert_eq!(conn.take_published(), [("TMFUSDT_0.01".to_string(), vec![], vec![])]);
    let sent: Vec<Value> = conn.take_sent().iter().map(|frame| serde_json::from_str(&text(frame)).unwrap()).collect();
    assert_eq!(
        sent,
        [json!({"SendTopicAction": {"Action": "1", "FilterValue": "DeepCoin_TMFUSDT_0.01", "LocalNo": 1, "ResumeNo": -1, "TopicID": "25"}})]
    );
    assert!(!conn.resync_requested());
    let resyncs = logs.events("book_resync");
    assert_eq!(resyncs.len(), 1);
    assert_eq!(resyncs[0].text("market"), "TMFUSDT_0.01");
    assert_eq!(resyncs[0].text("reason"), "crossed_book");
}

#[test]
fn deltas_after_a_resubscribe_wait_for_the_fresh_snapshot() {
    let (_logs, _capture) = capture();
    let mut conn = snapshotted();
    handle(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.95, 100.0)]));
    conn.take_published();
    conn.take_sent();

    handle(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 340.0)]));
    assert!(conn.take_published().is_empty());
    assert!(conn.take_sent().is_empty());

    handle(&mut conn, snapshot());
    handle(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 340.0)]));
    let published = conn.take_published();
    assert_eq!(published.len(), 1);
    assert_eq!(published[0].1[0], level(25.93, 340.0));
}

fn book_subscribe_frame(filter: &str, local_no: usize) -> Value {
    json!({"SendTopicAction": {"Action": "1", "FilterValue": filter, "LocalNo": local_no, "ResumeNo": -1, "TopicID": "25"}})
}

fn sent(conn: &mut Connection<State>) -> Vec<Value> {
    conn.take_sent().iter().map(|frame| serde_json::from_str(&text(frame)).unwrap()).collect()
}

#[test]
fn a_crossed_snapshot_is_never_published_and_its_stream_is_asked_again_after_five_seconds() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["TMFUSDT_0.01"]);
    let mut crossed = snapshot();
    crossed["r"] = json!([entry("TMFUSDT", "0", 25.95, 5.0), entry("TMFUSDT", "1", 25.94, 6.0)]);

    handle_at(&mut conn, crossed, 1_000);

    assert_eq!(conn.take_published(), [("TMFUSDT_0.01".to_string(), vec![], vec![])]);
    assert!(sent(&mut conn).is_empty());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "crossed_snapshot");

    handle_at(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 1.0)]), 1_000 + SNAPSHOT_WAIT_MS - 1);
    assert!(sent(&mut conn).is_empty());
    handle_at(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 1.0)]), 1_000 + SNAPSHOT_WAIT_MS);
    assert_eq!(sent(&mut conn), [book_subscribe_frame("DeepCoin_TMFUSDT_0.01", 1)]);
    assert!(conn.take_published().is_empty());
}

#[test]
fn a_stream_whose_first_snapshot_was_lost_is_subscribed_again_after_five_seconds() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["TMFUSDT_0.01"]);

    handle_at(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 1.0)]), 1_000);
    handle_at(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 2.0)]), 1_000 + SNAPSHOT_WAIT_MS - 1);
    assert!(sent(&mut conn).is_empty());

    handle_at(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 3.0)]), 1_000 + SNAPSHOT_WAIT_MS);
    assert_eq!(sent(&mut conn), [book_subscribe_frame("DeepCoin_TMFUSDT_0.01", 1)]);
    assert_eq!(logs.events("book_resync")[0].text("reason"), "snapshot_missing");

    // The wait starts again from the resubscribe.
    handle_at(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 4.0)]), 1_000 + SNAPSHOT_WAIT_MS + 1);
    assert!(sent(&mut conn).is_empty());
    assert!(conn.take_published().is_empty());
}

#[test]
fn a_resubscribe_whose_snapshot_was_lost_is_sent_again_after_five_seconds() {
    let (_logs, _capture) = capture();
    let mut conn = connection(&["TMFUSDT_0.01"]);
    handle_at(&mut conn, snapshot(), 1_000);
    handle_at(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.95, 100.0)]), 2_000);
    assert_eq!(sent(&mut conn).len(), 1);

    handle_at(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 1.0)]), 2_000 + SNAPSHOT_WAIT_MS - 1);
    assert!(sent(&mut conn).is_empty());
    handle_at(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 1.0)]), 2_000 + SNAPSHOT_WAIT_MS);
    assert_eq!(sent(&mut conn), [book_subscribe_frame("DeepCoin_TMFUSDT_0.01", 1)]);
}

#[test]
fn every_book_is_resubscribed_every_30_seconds_and_stays_published_meanwhile() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["TMFUSDT_0.01", "BTCUSDT_0.1"]);
    handle_at(&mut conn, snapshot(), 1_000);
    conn.take_published();

    handle_at(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 1.0)]), 1_000 + REFRESH_MS - 1);
    assert!(sent(&mut conn).is_empty());

    handle_at(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 2.0)]), 1_000 + REFRESH_MS);
    assert_eq!(sent(&mut conn), [book_subscribe_frame("DeepCoin_TMFUSDT_0.01", 1)]);
    let published = conn.take_published();
    assert_eq!(published[0].1[0], level(25.93, 2.0));

    // Deltas keep publishing until the snapshot arrives, and a refresh is not a resync.
    handle_at(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 3.0)]), 1_000 + REFRESH_MS + 100);
    assert!(sent(&mut conn).is_empty());
    assert_eq!(conn.take_published().len(), 1);
    assert!(logs.events("book_resync").is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn a_mid_stream_snapshot_restarts_the_refresh_clock() {
    let mut conn = connection(&["TMFUSDT_0.01"]);
    handle_at(&mut conn, snapshot(), 1_000);
    handle_at(&mut conn, snapshot(), 21_000);

    handle_at(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 1.0)]), 1_000 + REFRESH_MS);
    assert!(sent(&mut conn).is_empty());

    handle_at(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 1.0)]), 21_000 + REFRESH_MS);
    assert_eq!(sent(&mut conn).len(), 1);
}

#[test]
fn a_book_is_trimmed_to_the_60_levels_the_venue_keeps() {
    let mut conn = snapshotted();
    let mut levels = Vec::new();
    for i in 0..70 {
        levels.push(entry("TMFUSDT", "0", 25.0 - i as f64 * 0.01, 1.0));
        levels.push(entry("TMFUSDT", "1", 26.0 + i as f64 * 0.01, 1.0));
    }

    handle(&mut conn, delta(levels));

    let book = conn.book(0).unwrap();
    assert_eq!((book.bids().len(), book.asks().len()), (60, 60));
    assert_eq!(book.bids()[0], level(25.93, 258.0));
    assert_eq!(book.asks()[0], level(25.94, 6636.0));
}

#[test]
fn routes_each_run_of_levels_to_its_own_market() {
    let mut conn = snapshotted();
    let mut btc = snapshot();
    btc["r"] = json!([entry("BTCUSDT", "0", 82636.8, 566.0), entry("BTCUSDT", "1", 82636.9, 7357.0)]);
    handle(&mut conn, btc);
    conn.take_published();

    handle(&mut conn, delta(vec![entry("TMFUSDT", "0", 25.93, 1.0), entry("BTCUSDT", "0", 82636.8, 2.0)]));

    let published = conn.take_published();
    assert_eq!(published.len(), 2);
    assert_eq!((published[0].0.as_str(), published[0].1[0]), ("TMFUSDT_0.01", level(25.93, 1.0)));
    assert_eq!((published[1].0.as_str(), published[1].1[0]), ("BTCUSDT_0.1", level(82636.8, 2.0)));
}

#[test]
fn a_market_not_on_the_connection_is_dropped_and_logged_once() {
    let (logs, _capture) = capture();
    let mut conn = snapshotted();
    let mut eth = snapshot();
    eth["r"] = json!([entry("ETHUSDT", "0", 2484.4, 1.0)]);

    handle(&mut conn, eth.clone());
    handle(&mut conn, eth);

    assert!(conn.take_published().is_empty());
    let unknown = logs.events("unsubscribed_symbol");
    assert_eq!(unknown.len(), 1);
    assert_eq!(unknown[0].text("market"), "ETHUSDT");
}

#[test]
fn a_successful_acknowledgement_changes_nothing() {
    let (logs, _capture) = capture();
    let mut conn = snapshotted();

    handle(&mut conn, json!({"a":"RecvTopicAction","m":"Success","r":[{"d":{"A":"1","F":"DeepCoin_TMFUSDT_0.01","L":1,"R":-1,"T":"25"}}]}));

    assert!(conn.take_published().is_empty());
    assert!(logs.events("venue_error").is_empty());
}

// Both refusals captured live on 2026-10-09.
#[test]
fn a_refused_subscribe_is_logged_as_a_venue_error_with_its_reason() {
    let (logs, _capture) = capture();
    let mut conn = snapshotted();

    handle(&mut conn, json!({"a":"RecvTopicAction","m":"orderbook does not exist: BTCUSDT_1, no available orderbook data","r":[{"d":{"A":"1","F":"DeepCoin_BTCUSDT_1","L":2,"R":-1,"T":"25"}}]}));
    handle(&mut conn, json!({"a":"RecvTopicAction","m":"subscription cluster does not exist: NOPEUSDT","r":[{"d":{"A":"1","F":"DeepCoin_NOPEUSDT","L":3,"R":-1,"T":"7"}}]}));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].text("connection"), "deepcoin#swap#0");
    assert_eq!(errors[0].text("message"), "orderbook does not exist: BTCUSDT_1, no available orderbook data");
    assert!(conn.take_published().is_empty());
}

#[test]
fn an_unreadable_request_answer_is_a_venue_error() {
    let (logs, _capture) = capture();
    let mut conn = snapshotted();

    handle(&mut conn, json!({"a":"","m":"readObjectStart: expect { or n, but found h, error found in #1 byte of ...|hello|...","r":null}));

    assert_eq!(logs.events("venue_error").len(), 1);
}

#[test]
fn an_unknown_book_type_is_a_notice_and_changes_nothing() {
    let (logs, _capture) = capture();
    let mut conn = snapshotted();
    let mut frame = delta(vec![entry("TMFUSDT", "0", 25.93, 1.0)]);
    frame["t"] = json!("x");

    handle(&mut conn, frame);

    assert!(conn.take_published().is_empty());
    assert_eq!(logs.events("venue_notice")[0].text("kind"), "x");
}

#[test]
fn the_text_pong_is_only_traffic() {
    let mut conn = snapshotted();

    venue().handle(b"pong", &mut conn).unwrap();

    assert!(conn.take_published().is_empty());
    assert!(conn.take_sent().is_empty());
}

#[test]
fn reports_a_frame_that_is_not_json() {
    let mut conn = snapshotted();

    assert!(venue().handle(b"not json", &mut conn).is_err());
}

// A probe of the live socket, which prints each frame with its levels cut to three:
// PROBE_STREAMS=25:BTCUSDT_0.1,7:BTCUSDT cargo test deepcoin::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let streams = std::env::var("PROBE_STREAMS").unwrap_or_else(|_| "25:BTCUSDT_0.1,7:BTCUSDT".to_string());
    let seconds: u64 = std::env::var("PROBE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(12);
    let (mut ws, _) = tokio_tungstenite::connect_async(SWAP_URL).await.unwrap();
    for (n, stream) in streams.split(',').enumerate() {
        let (topic, filter) = stream.split_once(':').unwrap();
        let frame = json!({"SendTopicAction": {"Action": "1", "FilterValue": format!("DeepCoin_{filter}"), "LocalNo": n + 1, "ResumeNo": -1, "TopicID": topic}});
        ws.send(Message::text(frame.to_string())).await.unwrap();
    }

    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    let mut ping = tokio::time::interval(Duration::from_secs(10));
    loop {
        let message = tokio::select! {
            _ = tokio::time::sleep_until(deadline) => break,
            _ = ping.tick() => {
                ws.send(Message::text("ping")).await.unwrap();
                continue;
            }
            message = ws.next() => message,
        };
        let Some(Ok(Message::Text(text))) = message else {
            println!("other {message:?}");
            continue;
        };
        let Ok(mut value) = serde_json::from_str::<serde_json::Value>(text.as_str()) else {
            println!("text {text}");
            continue;
        };
        if value["a"] == "PMO"
            && let Some(levels) = value["r"].as_array_mut()
        {
            let n = levels.len();
            let mut kept = Vec::new();
            for side in ["0", "1"] {
                kept.extend(levels.iter().filter(|l| l["d"]["D"] == side).take(3).cloned());
            }
            *levels = kept;
            println!("levels {n}");
        }
        println!("{} {value}", crate::clock::now_ms());
    }
}
