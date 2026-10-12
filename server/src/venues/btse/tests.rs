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
        contract_size: 0.00001,
        ..testing::market(ID, raw_market_id, base, "USDT", true)
    }
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}-PERP")));
    }
    markets
}

fn venue() -> Btse {
    Btse::new()
}

fn connection(ids: &[&str]) -> Connection<State> {
    let mut list = Vec::with_capacity(ids.len());
    for id in ids {
        list.push(market(id));
    }
    Connection::for_test("btse#futures#0", list)
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// Book frames captured live on 2026-10-09 on update:BTC-PERP_0, with the 50 levels a side of the snapshot cut to three.
// The snapshot lists asks worst first, and a delta lists both sides in no order.
fn book(kind: &str, seq: i64, bids: Value, asks: Value) -> Value {
    json!({
        "data": { "asks": asks, "bids": bids, "prevSeqNum": seq - 1, "seqNum": seq, "symbol": "BTC-PERP", "timestamp": 1791568157822_i64, "type": kind },
        "topic": "update:BTC-PERP_0",
    })
}

fn snapshot() -> Value {
    book(
        "snapshot",
        26900573,
        json!([["82657.9", "81450"], ["82654.9", "433400"], ["82653.3", "351000"]]),
        json!([["82685.9", "261450"], ["82685.5", "186600"], ["82658.3", "120650"]]),
    )
}

// As captured, a new best ask, a level of the window removed by "0", and no bid.
fn delta() -> Value {
    book("delta", 26900574, json!([]), json!([["82658.2", "23650"], ["82658.3", "79915"], ["82685.9", "0"]]))
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

// plan and settings

#[test]
fn puts_100_markets_on_each_oss_socket() {
    let plans = venue().plan(&markets(219));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [100, 100, 19]);
    assert_eq!(plans[2].id, "btse#futures#2");
    assert!(plans.iter().all(|plan| plan.url == "wss://ws.btse.com/ws/oss/futures"));
}

#[test]
fn pings_every_15_seconds_and_reads_45_seconds_of_silence_as_dead() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(15)));
    assert_eq!(settings.max_silence, Duration::from_secs(45));
}

// subscribe_frames and ping

#[test]
fn names_every_topic_of_the_slice_in_one_frame_under_the_socket_spelling() {
    let frames = venue().subscribe_frames(&markets(100), &mut State::new());

    assert_eq!(frames.len(), 1);
    let frame = parsed(&frames[0]);
    assert_eq!(frame["op"], "subscribe");
    assert_eq!(frame["args"].as_array().unwrap().len(), 100);
    assert_eq!(frame["args"][0], "update:SYM0-PERP_0");
}

#[test]
fn pings_with_plain_text_and_takes_the_plain_text_pong_as_traffic() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP"]);

    assert_eq!(venue().ping(&mut State::new()), Message::text("ping"));
    venue().handle(b"pong", &mut conn).unwrap();

    assert!(conn.take_published().is_empty());
    assert!(logs.lines().iter().all(|line| line.level > Level::WARN));
}

// handle: snapshot, delta and gap

#[test]
fn a_snapshot_replaces_the_book_and_orders_the_asks_from_the_best() {
    let mut conn = connection(&["BTC-PERP"]);

    let published = send(&mut conn, snapshot());

    assert_eq!(published.len(), 1);
    let (id, bids, asks) = &published[0];
    assert_eq!(id, "BTC-PERP");
    assert_eq!(bids, &levels(&[(82657.9, 81450.0), (82654.9, 433400.0), (82653.3, 351000.0)]));
    assert_eq!(asks, &levels(&[(82658.3, 120650.0), (82685.5, 186600.0), (82685.9, 261450.0)]));
}

#[test]
fn a_chained_delta_lands_each_level_by_price_and_removes_a_zero_size() {
    let mut conn = connection(&["BTC-PERP"]);
    send(&mut conn, snapshot());

    let published = send(&mut conn, delta());

    let (_, bids, asks) = &published[0];
    assert_eq!(bids.len(), 3);
    assert_eq!(asks, &levels(&[(82658.2, 23650.0), (82658.3, 79915.0), (82685.5, 186600.0)]));
    assert!(!conn.resync_requested());
}

#[test]
fn a_later_snapshot_replaces_the_book_and_restarts_the_chain() {
    let mut conn = connection(&["BTC-PERP"]);
    send(&mut conn, snapshot());

    let published = send(&mut conn, book("snapshot", 26900600, json!([["82600", "5"]]), json!([["82700", "6"]])));
    assert_eq!(published[0].1, levels(&[(82600.0, 5.0)]));

    send(&mut conn, book("delta", 26900601, json!([["82601", "1"]]), json!([])));
    assert!(!conn.resync_requested());
}

#[test]
fn a_delta_whose_prev_seq_num_is_not_the_last_seq_num_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP"]);
    send(&mut conn, snapshot());

    let published = send(&mut conn, book("delta", 26900576, json!([["82657", "1"]]), json!([])));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_gap");
}

#[test]
fn a_delta_before_any_snapshot_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP"]);

    send(&mut conn, delta());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn a_delta_that_leaves_the_top_crossed_resyncs_without_publishing() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP"]);
    send(&mut conn, snapshot());

    let published = send(&mut conn, book("delta", 26900574, json!([["82660", "10"]]), json!([])));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "crossed_book");
}

#[test]
fn a_crossed_snapshot_resyncs_without_publishing() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP"]);
    // The best ask is the last element, as the snapshot lists asks worst first.
    let frame = book("snapshot", 26900573, json!([["82660", "5"], ["82650", "5"]]), json!([["82700", "6"], ["82655", "6"]]));

    let published = send(&mut conn, frame);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "crossed_book");
}

#[test]
fn a_snapshot_whose_crossing_level_is_removed_by_a_zero_size_is_not_crossed() {
    let mut conn = connection(&["BTC-PERP"]);
    let frame = book("snapshot", 26900573, json!([["82660", "0"], ["82650", "5"]]), json!([["82700", "6"], ["82655", "6"]]));

    let published = send(&mut conn, frame);

    assert_eq!(published[0].1, levels(&[(82650.0, 5.0)]));
    assert!(!conn.resync_requested());
}

#[test]
fn a_frame_without_seq_num_resyncs() {
    let (logs, _capture) = capture();
    let mut snapshot_conn = connection(&["BTC-PERP"]);
    let mut frame = snapshot();
    frame["data"].as_object_mut().unwrap().remove("seqNum");

    assert!(send(&mut snapshot_conn, frame).is_empty());
    assert!(snapshot_conn.resync_requested());

    let mut delta_conn = connection(&["BTC-PERP"]);
    send(&mut delta_conn, snapshot());
    let mut frame = delta();
    frame["data"].as_object_mut().unwrap().remove("seqNum");

    assert!(send(&mut delta_conn, frame).is_empty());
    assert!(delta_conn.resync_requested());
    let reasons: Vec<String> = logs.events("book_resync").iter().map(|line| line.text("reason").to_string()).collect();
    assert_eq!(reasons, ["snapshot_without_seq_num", "sequence_gap"]);
}

#[test]
fn routes_by_the_frames_symbol_whatever_its_topic() {
    let mut conn = connection(&["SOL-PERP"]);
    let mut frame = snapshot();
    frame["topic"] = json!("update:SOL-PERP-USDT_0");
    frame["data"]["symbol"] = json!("SOL-PERP");

    let published = send(&mut conn, frame);

    assert_eq!(published[0].0, "SOL-PERP");
}

#[test]
fn ignores_a_symbol_the_connection_does_not_hold() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["ETH-PERP"]);

    let published = send(&mut conn, snapshot());

    assert!(published.is_empty());
    assert!(!conn.resync_requested());
    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "BTC-PERP");
}

// handle: control frames, captured live on 2026-10-09

#[test]
fn an_acknowledgement_with_null_levels_is_quiet() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP"]);
    let ack = json!({ "channel": ["update:1KPEPE-PERP_0", "update:BTC-PERP_0"], "data": { "asks": null, "bids": null }, "event": "subscribe" });

    assert!(send(&mut conn, ack).is_empty());
    assert!(logs.lines().iter().all(|line| line.level > Level::WARN));
}

#[test]
fn logs_each_entry_of_an_error_frame_as_a_venue_error() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP"]);
    let error = json!({
        "data": { "asks": null, "bids": null },
        "errors": [
            { "arg": "foo:BTC-PERP", "error": { "code": 1005, "message": "Topic provided does not exist." } },
            { "arg": "update:NOPE-PERP_0", "error": { "code": 1000, "message": "Market pair provided is currently not supported." } },
        ],
        "severity": "ERROR",
    });

    send(&mut conn, error);

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[1].text("arg"), "update:NOPE-PERP_0");
    assert_eq!(errors[1].number("code"), 1000.0);
    assert_eq!(errors[1].text("connection"), "btse#futures#0");
    assert!(!conn.resync_requested());
}

#[test]
fn logs_an_error_with_no_arg_such_as_the_answer_to_a_frame_that_is_no_json() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP"]);
    let error = json!({
        "data": { "asks": null, "bids": null },
        "errors": [{ "error": { "code": 1002, "message": "Invalid request. Please check again your request and provide all information required." } }],
        "severity": "ERROR",
    });

    send(&mut conn, error);

    assert_eq!(logs.events("venue_error")[0].number("code"), 1002.0);
}

#[test]
fn logs_an_unknown_event_as_a_venue_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP"]);

    send(&mut conn, json!({ "event": "maintenance", "data": { "asks": null, "bids": null } }));

    assert_eq!(logs.events("venue_notice")[0].text("venue_event"), "maintenance");
}

#[test]
fn fails_on_a_frame_that_is_no_json() {
    let mut conn = connection(&["BTC-PERP"]);

    assert!(venue().handle(b"not json", &mut conn).is_err());
}

// A probe of the live socket, which prints the first frames of each topic with their levels cut to three a side:
// cargo test btse::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(URL).await.unwrap();
    let list = std::env::var("CAPTURE_TOPICS").unwrap_or_else(|_| "update:BTC-PERP_0,update:1KPEPE-PERP_0,update:NOPE-PERP_0,foo:BTC-PERP".to_string());
    let args: Vec<&str> = list.split(',').collect();
    ws.send(Message::text(json!({ "op": "subscribe", "args": args }).to_string())).await.unwrap();
    ws.send(Message::text("ping")).await.unwrap();
    ws.send(Message::text("hello")).await.unwrap();

    let seconds = std::env::var("CAPTURE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(4);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    let mut seen: HashMap<String, usize> = HashMap::new();
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let Ok(mut value) = serde_json::from_str::<Value>(text.as_str()) else {
            println!("text {}", text.as_str());
            continue;
        };
        let key = format!("{}{}", value["topic"], value["data"]["type"]);
        let count = seen.entry(key).or_default();
        *count += 1;
        if value["topic"].is_string() && *count > 3 {
            continue;
        }
        for side in ["bids", "asks"] {
            if let Some(levels) = value["data"][side].as_array_mut() {
                println!("{side} {}", levels.len());
                levels.truncate(3);
            }
        }
        println!("{value}");
    }
    println!("{seen:?}");
}
