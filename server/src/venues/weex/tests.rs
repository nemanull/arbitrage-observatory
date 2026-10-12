// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.strip_suffix("USDT").unwrap();
    testing::market(ID, raw_market_id, base, "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}USDT")));
    }
    markets
}

fn venue() -> Weex {
    Weex::new()
}

fn connection(raw_ids: &[&str]) -> Connection<State> {
    let mut list = Vec::with_capacity(raw_ids.len());
    for id in raw_ids {
        list.push(market(id));
    }
    Connection::for_test("weex#public#0", list)
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
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

fn depth(kind: &str, symbol: &str, first: u64, last: u64, bids: Value, asks: Value) -> Value {
    let d = if kind == "depthSnapshot" { "SNAPSHOT" } else { "CHANGED" };
    json!({ "E": 1791568012917_i64, "U": first, "a": asks, "b": bids, "d": d, "e": kind, "l": 200, "s": symbol, "u": last })
}

// Frames captured live on 2026-10-09 at 17:46 UTC, with each side cut to its first three levels.
fn aapl_snapshot() -> Value {
    depth(
        "depthSnapshot",
        "AAPLUSDT",
        573130582,
        573130594,
        json!([["335.42", "87.08"], ["335.41", "57.98"], ["335.39", "69.54"]]),
        json!([["335.44", "69.57"], ["335.46", "93.01"], ["335.47", "77.07"]]),
    )
}

// The two deltas that followed it, each starting at the `u` before it.
fn aapl_delta() -> Value {
    depth(
        "depth",
        "AAPLUSDT",
        573130594,
        573130602,
        json!([["335.42", "91.20"], ["335.17", "24033.05"]]),
        json!([["335.44", "50.50"], ["335.69", "24042.87"]]),
    )
}

fn aapl_next_delta() -> Value {
    depth(
        "depth",
        "AAPLUSDT",
        573130602,
        573130612,
        json!([["335.42", "90.91"], ["335.17", "24054.72"], ["335.15", "3650.11"]]),
        json!([["335.44", "74.30"], ["335.69", "24056.87"]]),
    )
}

fn pepe_snapshot() -> Value {
    depth(
        "depthSnapshot",
        "1000PEPEUSDT",
        4736645277,
        4736645289,
        json!([["0.0039031", "890000"], ["0.0039030", "1690000"], ["0.0039028", "900000"]]),
        json!([["0.0039032", "950000"], ["0.0039033", "580000"], ["0.0039034", "340000"]]),
    )
}

// What a contract with no order at all is served, as JP225USDT, GASTOWNUSDT and 牛来USDT were.
fn empty_snapshot(symbol: &str) -> Value {
    json!({ "E": 1791568027118_i64, "U": 0, "a": [], "b": [], "d": "SNAPSHOT", "e": "depthSnapshot", "l": 200, "s": symbol, "u": 0 })
}

// plan

#[test]
fn puts_100_markets_on_each_public_socket() {
    let plans = venue().plan(&markets(1036));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [100, 100, 100, 100, 100, 100, 100, 100, 100, 100, 36]);
    assert_eq!(plans[0].id, "weex#public#0");
    assert_eq!(plans[10].id, "weex#public#10");
    assert_eq!(plans[0].url, "wss://ws-contract.weex.com/v3/ws/public");
}

#[test]
fn sends_a_user_agent_on_every_handshake() {
    let settings = venue().settings();

    assert_eq!(settings.headers, [("User-Agent", "arbitrage-observatory")]);
}

#[test]
fn pings_every_15_seconds_and_ends_a_socket_silent_for_45() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(15)));
    assert_eq!(settings.max_silence, Duration::from_secs(45));
    assert_eq!(settings.connect_stagger, Duration::from_millis(500));
}

// subscribe_frames and ping

#[test]
fn names_every_stream_of_the_slice_in_one_frame_at_200_levels() {
    let slice = markets(100);

    let frames = venue().subscribe_frames(&slice, &mut State::default());

    assert_eq!(frames.len(), 1);
    let frame = parsed(&frames[0]);
    assert_eq!(frame["method"], "SUBSCRIBE");
    assert_eq!(frame["id"], 1);
    assert_eq!(frame["params"].as_array().unwrap().len(), 100);
    assert_eq!(frame["params"][0], "SYM0USDT@depth200");
}

#[test]
fn numbers_each_client_frame_in_turn() {
    let mut state = State::default();

    venue().subscribe_frames(&markets(2), &mut state);
    let first = parsed(&venue().ping(&mut state));
    let second = parsed(&venue().ping(&mut state));

    assert_eq!(first, json!({ "method": "PING", "id": 2 }));
    assert_eq!(second["id"], 3);
}

// handle: books

#[test]
fn hands_the_engine_a_snapshot_as_the_whole_book() {
    let mut conn = connection(&["AAPLUSDT"]);

    let published = send(&mut conn, aapl_snapshot());

    assert_eq!(
        published,
        [(
            "AAPLUSDT".to_string(),
            levels(&[(335.42, 87.08), (335.41, 57.98), (335.39, 69.54)]),
            levels(&[(335.44, 69.57), (335.46, 93.01), (335.47, 77.07)]),
        )]
    );
}

#[test]
fn applies_a_delta_whose_first_id_equals_the_last_id_applied() {
    let mut conn = connection(&["AAPLUSDT"]);
    send(&mut conn, aapl_snapshot());

    send(&mut conn, aapl_delta());
    let published = send(&mut conn, aapl_next_delta());

    assert_eq!(
        published,
        [(
            "AAPLUSDT".to_string(),
            levels(&[(335.42, 90.91), (335.41, 57.98), (335.39, 69.54), (335.17, 24054.72), (335.15, 3650.11)]),
            levels(&[(335.44, 74.30), (335.46, 93.01), (335.47, 77.07), (335.69, 24056.87)]),
        )]
    );
    assert!(!conn.resync_requested());
}

#[test]
fn deletes_a_level_on_a_zero_size() {
    let mut conn = connection(&["AAPLUSDT"]);
    send(&mut conn, aapl_snapshot());

    let delta = depth("depth", "AAPLUSDT", 573130594, 573130602, json!([["335.42", "0"]]), json!([]));
    let published = send(&mut conn, delta);

    assert_eq!(published[0].1, levels(&[(335.41, 57.98), (335.39, 69.54)]));
}

#[test]
fn resyncs_on_a_delta_that_starts_one_past_the_last_id() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["AAPLUSDT"]);
    send(&mut conn, aapl_snapshot());

    let mut delta = aapl_delta();
    delta["U"] = json!(573130595);
    let published = send(&mut conn, delta);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync[0].text("market"), "AAPLUSDT");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn resyncs_on_a_delta_after_a_lost_one() {
    let mut conn = connection(&["AAPLUSDT"]);
    send(&mut conn, aapl_snapshot());

    assert!(send(&mut conn, aapl_next_delta()).is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn resyncs_on_a_delta_that_carries_no_first_id() {
    let mut conn = connection(&["AAPLUSDT"]);
    send(&mut conn, aapl_snapshot());

    let mut delta = aapl_delta();
    delta.as_object_mut().unwrap().remove("U");

    assert!(send(&mut conn, delta).is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn resyncs_on_a_delta_before_any_snapshot() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["AAPLUSDT"]);

    assert!(send(&mut conn, aapl_delta()).is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn replaces_the_book_and_restarts_the_chain_on_a_later_snapshot() {
    let mut conn = connection(&["AAPLUSDT"]);
    send(&mut conn, aapl_snapshot());
    send(&mut conn, aapl_delta());

    let mut later = aapl_snapshot();
    later["U"] = json!(573130700);
    later["u"] = json!(573130710);
    let published = send(&mut conn, later);
    let mut delta = aapl_delta();
    delta["U"] = json!(573130710);
    send(&mut conn, delta);

    assert_eq!(published[0].1, levels(&[(335.42, 87.08), (335.41, 57.98), (335.39, 69.54)]));
    assert!(!conn.resync_requested());
}

#[test]
fn keeps_each_contract_on_its_own_chain() {
    let mut conn = connection(&["AAPLUSDT", "1000PEPEUSDT"]);

    let mut published = send(&mut conn, aapl_snapshot());
    published.extend(send(&mut conn, pepe_snapshot()));
    published.extend(send(&mut conn, aapl_delta()));

    let ids: Vec<&str> = published.iter().map(|(id, _, _)| id.as_str()).collect();
    assert_eq!(ids, ["AAPLUSDT", "1000PEPEUSDT", "AAPLUSDT"]);
    assert_eq!(published[1].1[0], BookLevel { price: 0.0039031, size: 890000.0 });
    assert!(!conn.resync_requested());
}

#[test]
fn routes_a_contract_spelled_outside_ascii() {
    let mut conn = connection(&["牛来USDT"]);
    let mut snapshot = pepe_snapshot();
    snapshot["s"] = json!("牛来USDT");

    let published = send(&mut conn, snapshot);

    assert_eq!(published[0].0, "牛来USDT");
}

#[test]
fn hands_the_engine_an_empty_book_for_an_empty_snapshot_and_logs_it_once() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["JP225USDT"]);

    let published = send(&mut conn, empty_snapshot("JP225USDT"));
    send(&mut conn, empty_snapshot("JP225USDT"));

    assert_eq!(published, [("JP225USDT".to_string(), Vec::new(), Vec::new())]);
    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].text("market"), "JP225USDT");
    assert_eq!(notices[0].text("reason"), "empty_snapshot");
    assert!(!conn.resync_requested());
}

#[test]
fn clears_a_book_whose_stream_turns_to_an_empty_snapshot_and_resyncs_on_a_delta_after_it() {
    let mut conn = connection(&["AAPLUSDT"]);
    send(&mut conn, aapl_snapshot());

    let published = send(&mut conn, empty_snapshot("AAPLUSDT"));
    send(&mut conn, aapl_delta());

    assert_eq!(published, [("AAPLUSDT".to_string(), Vec::new(), Vec::new())]);
    assert!(conn.resync_requested());
}

#[test]
fn ignores_a_contract_this_connection_did_not_subscribe() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["AAPLUSDT"]);

    assert!(send(&mut conn, pepe_snapshot()).is_empty());
    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "1000PEPEUSDT");
    assert!(!conn.resync_requested());
}

// handle: control frames

#[test]
fn takes_the_greeting_and_the_acknowledgements_quietly() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["AAPLUSDT"]);
    venue().subscribe_frames(conn.markets().to_vec().as_slice(), &mut conn.state);

    // Both as captured live on 2026-10-09.
    let greeting = json!({ "a": null, "b": null, "cid": "07d45244-3b58-9a12-f311-4966e4f01eaa", "event": "connected", "time": "1791568012798" });
    let ack = json!({ "a": null, "b": null, "id": 1, "result": true });

    assert!(send(&mut conn, greeting).is_empty());
    assert!(send(&mut conn, ack).is_empty());
    assert!(conn.take_sent().is_empty());
    assert!(conn.state.pending.is_empty());
    assert!(logs.lines().is_empty());
}

#[test]
fn answers_the_server_ping_with_a_numbered_pong() {
    let mut conn = connection(&["AAPLUSDT"]);
    conn.state.next_id = 7;

    // Captured live on 2026-10-09, once a minute on the half minute.
    send(&mut conn, json!({ "event": "ping", "time": "1791568650000" }));

    let sent = conn.take_sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(parsed(&sent[0]), json!({ "method": "PONG", "id": 8 }));
}

#[test]
fn logs_a_refused_frame_as_a_venue_error() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["AAPLUSDT"]);

    // Captured live on 2026-10-09, for a depth of 50 and for a text that is not JSON.
    send(&mut conn, json!({ "a": null, "b": null, "id": 3, "msg": "INVALID_ARGUMENT: invalid depth level : 50", "result": false }));
    send(&mut conn, json!({ "a": null, "b": null, "msg": "INVALID_ARGUMENT: unrecognized message : hello", "result": false }));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "weex#public#0");
    assert_eq!(errors[0].number("id"), 3.0);
    assert_eq!(errors[0].text("message"), "INVALID_ARGUMENT: invalid depth level : 50");
    assert!(conn.take_sent().is_empty());
}

#[test]
fn subscribes_again_the_streams_named_after_an_unknown_symbol() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["ETHUSDT", "NOPEUSDT", "BTCUSDT", "牛来USDT"]);
    venue().subscribe_frames(conn.markets().to_vec().as_slice(), &mut conn.state);

    // Captured live on 2026-10-09, after which BTCUSDT, named after NOPEUSDT in the same frame, got nothing.
    send(&mut conn, json!({ "a": null, "b": null, "id": 1, "msg": "INVALID_ARGUMENT: invalid symbol : cmt_nopeusdt", "result": false }));

    let sent = conn.take_sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(parsed(&sent[0]), json!({ "method": "SUBSCRIBE", "params": ["BTCUSDT@depth200", "牛来USDT@depth200"], "id": 2 }));
    assert_eq!(logs.events("venue_error").len(), 1);
    let notice = &logs.events("venue_notice")[0];
    assert_eq!(notice.text("market"), "NOPEUSDT");
    assert_eq!(notice.number("resent"), 2.0);
}

#[test]
fn subscribes_again_past_a_second_unknown_symbol_in_the_frame_sent_again() {
    let mut conn = connection(&["NOPEUSDT", "ETHUSDT", "GONEUSDT", "BTCUSDT"]);
    venue().subscribe_frames(conn.markets().to_vec().as_slice(), &mut conn.state);

    send(&mut conn, json!({ "id": 1, "msg": "INVALID_ARGUMENT: invalid symbol : cmt_nopeusdt", "result": false }));
    let first = parsed(&conn.take_sent()[0]);
    send(&mut conn, json!({ "id": 2, "msg": "INVALID_ARGUMENT: invalid symbol : cmt_goneusdt", "result": false }));
    let second = parsed(&conn.take_sent()[0]);

    assert_eq!(first["params"], json!(["ETHUSDT@depth200", "GONEUSDT@depth200", "BTCUSDT@depth200"]));
    assert_eq!(second, json!({ "method": "SUBSCRIBE", "params": ["BTCUSDT@depth200"], "id": 3 }));
    assert!(conn.state.pending.contains_key(&3));
}

#[test]
fn sends_nothing_again_when_a_refusal_names_no_symbol_of_its_frame() {
    let mut conn = connection(&["ETHUSDT", "BTCUSDT"]);
    venue().subscribe_frames(conn.markets().to_vec().as_slice(), &mut conn.state);

    send(&mut conn, json!({ "id": 1, "msg": "INVALID_ARGUMENT: invalid symbol : cmt_nopeusdt", "result": false }));

    assert!(conn.take_sent().is_empty());
    assert!(conn.state.pending.is_empty());
}

#[test]
fn sends_nothing_again_when_the_unknown_symbol_was_the_last_of_its_frame() {
    let mut conn = connection(&["ETHUSDT", "NOPEUSDT"]);
    venue().subscribe_frames(conn.markets().to_vec().as_slice(), &mut conn.state);

    send(&mut conn, json!({ "a": null, "b": null, "id": 1, "msg": "INVALID_ARGUMENT: invalid symbol : cmt_nopeusdt", "result": false }));

    assert!(conn.take_sent().is_empty());
}

#[test]
fn logs_an_unknown_event_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["AAPLUSDT"]);

    send(&mut conn, json!({ "e": "ticker", "s": "AAPLUSDT", "d": [] }));
    send(&mut conn, json!({ "event": "maintenance" }));

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 2);
    assert_eq!(notices[0].text("kind"), "ticker");
    assert_eq!(notices[1].text("kind"), "maintenance");
}

#[test]
fn reports_a_frame_that_is_not_json() {
    let mut conn = connection(&["AAPLUSDT"]);

    assert!(venue().handle(b"not json", &mut conn).is_err());
}

// A probe of the live socket, which prints every frame with its levels cut to three a side:
// CAPTURE_MARKETS=BTCUSDT,NOPEUSDT PROBE_SECONDS=8 cargo test weex::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let mut request = PUBLIC_URL.into_client_request().unwrap();
    for &(name, value) in HEADERS {
        request.headers_mut().insert(name, value.parse().unwrap());
    }
    let (mut ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
    let list = std::env::var("CAPTURE_MARKETS").unwrap_or_else(|_| "BTCUSDT,1000PEPEUSDT,AAPLUSDT,NOPEUSDT".to_string());
    let mut params = Vec::new();
    for symbol in list.split(',') {
        params.push(format!("{symbol}@{CHANNEL}"));
    }
    ws.send(Message::text(json!({ "method": "SUBSCRIBE", "params": params, "id": 1 }).to_string())).await.unwrap();
    ws.send(Message::text(json!({ "method": "PING", "id": 2 }).to_string())).await.unwrap();
    ws.send(Message::text(json!({ "method": "SUBSCRIBE", "params": ["BTCUSDT@depth50"], "id": 3 }).to_string())).await.unwrap();
    ws.send(Message::text("hello")).await.unwrap();

    // PROBE_PINGS sends that many client pings PROBE_PING_MS apart, to see whether they count against the hourly operations cap.
    let pings: u64 = std::env::var("PROBE_PINGS").ok().and_then(|s| s.parse().ok()).unwrap_or(0);
    let gap: u64 = std::env::var("PROBE_PING_MS").ok().and_then(|s| s.parse().ok()).unwrap_or(250);
    for id in 0..pings {
        ws.send(Message::text(json!({ "method": "PING", "id": 1000 + id }).to_string())).await.unwrap();
        tokio::time::sleep(Duration::from_millis(gap)).await;
    }

    let seconds: u64 = std::env::var("PROBE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(8);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut acks = 0;
    loop {
        let message = match tokio::time::timeout_at(deadline, ws.next()).await {
            Ok(Some(Ok(message))) => message,
            Ok(other) => {
                println!("ended {other:?}");
                break;
            }
            Err(_) => break,
        };
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let mut value: Value = serde_json::from_str(text.as_str()).unwrap();
        if value["id"].as_u64().is_some_and(|id| id >= 1000) && value["result"] == json!(true) {
            acks += 1;
            continue;
        }
        if value["event"] == "ping" {
            println!("{value}");
            ws.send(Message::text(json!({ "method": "PONG", "id": 9 }).to_string())).await.unwrap();
            continue;
        }
        let key = format!("{}{}", value["e"], value["s"]);
        let count = seen.entry(key).or_default();
        *count += 1;
        if value["e"].is_string() && *count > 3 {
            continue;
        }
        for side in ["b", "a"] {
            if let Some(levels) = value[side].as_array_mut() {
                print!("{side} {} ", levels.len());
                levels.truncate(3);
            }
        }
        println!("{value}");
    }
    println!("ping acks {acks}");
    for (key, count) in seen {
        println!("{key} {count}");
    }
}
