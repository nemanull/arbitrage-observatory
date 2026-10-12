// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.strip_suffix("USDT_PERP").unwrap();
    testing::market(HITBTC_ID, raw_market_id, base, "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}USDT_PERP")));
    }
    markets
}

fn venue() -> HitBtc {
    HitBtc::new(&HITBTC)
}

fn connection(raw_market_ids: &[&str]) -> Connection<HashMap<usize, i64>> {
    let mut markets = Vec::with_capacity(raw_market_ids.len());
    for id in raw_market_ids {
        markets.push(market(id));
    }
    Connection::for_test("hitbtc#perp#0", markets)
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// Frames captured live from api.hitbtc.com on 2026-10-09, with the snapshot cut to three levels a side.
fn btc_snapshot() -> Value {
    json!({ "ch": "orderbook/full", "snapshot": { "BTCUSDT_PERP": {
        "t": 1791572216612_i64, "s": 1385773,
        "a": [["82523.89", "0.0927"], ["82536.21", "0.0866"], ["82536.26", "0.9452"]],
        "b": [["82515.62", "2.4182"], ["82515.50", "0.4186"], ["82514.00", "0.2207"]],
    } } })
}

// The two updates that followed it, with their bid sides cut to the first three of eight.
fn btc_update() -> Value {
    json!({ "ch": "orderbook/full", "update": { "BTCUSDT_PERP": {
        "t": 1791572216902_i64, "s": 1385774, "a": [],
        "b": [["82515.62", "2.8945"], ["82515.50", "1.3590"], ["82512.55", "0.4247"]],
    } } })
}

fn btc_next_update() -> Value {
    json!({ "ch": "orderbook/full", "update": { "BTCUSDT_PERP": {
        "t": 1791572217002_i64, "s": 1385775, "a": [["83527.08", "0.1629"]],
        "b": [["82515.62", "3.4892"], ["82508.51", "0.6650"], ["82475.88", "0.7147"]],
    } } })
}

fn update(s: i64) -> Value {
    json!({ "ch": "orderbook/full", "update": { "BTCUSDT_PERP": { "t": 1791572217133_i64, "s": s, "a": [], "b": [["82515.00", "1"]] } } })
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

// plan and settings

#[test]
fn puts_50_markets_on_each_socket_of_the_profile_host() {
    let plans = HitBtc::new(&GLEECBTC).plan(&markets(120));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [50, 50, 20]);
    assert_eq!(plans[2].id, "gleecbtc#perp#2");
    assert_eq!(plans[0].url, "wss://api.exchange.gleec.com/api/3/ws/public");
}

#[test]
fn sends_no_ping_of_its_own_and_waits_75_seconds_of_silence() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, None);
    assert_eq!(settings.max_silence, Duration::from_secs(75));
}

#[test]
fn every_profile_names_its_own_hosts() {
    for profile in [&HITBTC, &FMFWIO, &CHANGELLYPRO, &MANDALA, &GLEECBTC] {
        let host = profile.rest.strip_prefix("https://").unwrap().strip_suffix("/api/3").unwrap();
        assert_eq!(profile.socket, format!("wss://{host}/api/3/ws/public"));
    }
}

// subscribe_frames

#[test]
fn names_every_symbol_of_the_slice_in_one_subscribe_frame() {
    let frames = venue().subscribe_frames(&markets(50), &mut HashMap::new());

    assert_eq!(frames.len(), 1);
    let frame = parsed(&frames[0]);
    assert_eq!(frame["method"], "subscribe");
    assert_eq!(frame["ch"], "orderbook/full");
    assert_eq!(frame["id"], 1);
    let symbols = frame["params"]["symbols"].as_array().unwrap();
    assert_eq!(symbols.len(), 50);
    assert_eq!(symbols[0], "SYM0USDT_PERP");
}

// books

#[test]
fn a_snapshot_replaces_the_book_and_publishes_it() {
    let mut conn = connection(&["BTCUSDT_PERP"]);

    let published = send(&mut conn, btc_snapshot());

    assert_eq!(published.len(), 1);
    let (id, bids, asks) = &published[0];
    assert_eq!(id, "BTCUSDT_PERP");
    assert_eq!(bids, &levels(&[(82515.62, 2.4182), (82515.5, 0.4186), (82514.0, 0.2207)]));
    assert_eq!(asks, &levels(&[(82523.89, 0.0927), (82536.21, 0.0866), (82536.26, 0.9452)]));
}

#[test]
fn applies_updates_chained_by_s() {
    let mut conn = connection(&["BTCUSDT_PERP"]);
    send(&mut conn, btc_snapshot());

    let first = send(&mut conn, btc_update());
    let second = send(&mut conn, btc_next_update());

    let after_first = levels(&[(82515.62, 2.8945), (82515.5, 1.359), (82514.0, 0.2207), (82512.55, 0.4247)]);
    assert_eq!(first[0].1, after_first);
    assert_eq!(second[0].1[..2], levels(&[(82515.62, 3.4892), (82515.5, 1.359)]));
    assert_eq!(second[0].1.len(), 6);
    assert_eq!(second[0].2.last(), Some(&BookLevel { price: 83527.08, size: 0.1629 }));
    assert!(!conn.resync_requested());
}

// Captured updates carried "0" sizes on levels outside the cut snapshot, so this one names the snapshot's own levels.
#[test]
fn a_size_of_zero_deletes_the_level() {
    let mut conn = connection(&["BTCUSDT_PERP"]);
    send(&mut conn, btc_snapshot());

    let delete = json!({ "ch": "orderbook/full", "update": { "BTCUSDT_PERP": {
        "t": 1791572216902_i64, "s": 1385774, "a": [["82523.89", "0"]], "b": [["82515.62", "0"]],
    } } });
    let published = send(&mut conn, delete);

    assert_eq!(published[0].1, levels(&[(82515.5, 0.4186), (82514.0, 0.2207)]));
    assert_eq!(published[0].2, levels(&[(82536.21, 0.0866), (82536.26, 0.9452)]));
}

#[test]
fn an_update_with_both_sides_empty_moves_s_and_publishes_nothing() {
    let mut conn = connection(&["BTCUSDT_PERP"]);
    send(&mut conn, btc_snapshot());

    let empty = json!({ "ch": "orderbook/full", "update": { "BTCUSDT_PERP": { "t": 1791572216902_i64, "s": 1385774, "a": [], "b": [] } } });
    assert!(send(&mut conn, empty).is_empty());
    assert_eq!(send(&mut conn, update(1385775)).len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn a_gap_in_s_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDT_PERP"]);
    send(&mut conn, btc_snapshot());

    let published = send(&mut conn, update(1385775));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_gap");
}

#[test]
fn a_repeated_s_resyncs() {
    let mut conn = connection(&["BTCUSDT_PERP"]);
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_update());

    send(&mut conn, btc_update());

    assert!(conn.resync_requested());
}

#[test]
fn an_update_before_the_snapshot_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDT_PERP"]);

    assert!(send(&mut conn, btc_update()).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn a_new_snapshot_restarts_the_chain() {
    let mut conn = connection(&["BTCUSDT_PERP"]);
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_update());

    let mut again = btc_snapshot();
    again["snapshot"]["BTCUSDT_PERP"]["s"] = json!(1385900);
    send(&mut conn, again);

    assert_eq!(send(&mut conn, update(1385901)).len(), 1);
    assert!(!conn.resync_requested());
}

// CELUSDT_PERP's snapshot as captured: a working contract with an empty book.
#[test]
fn an_empty_snapshot_publishes_an_empty_book() {
    let mut conn = connection(&["CELUSDT_PERP"]);

    let snapshot = json!({ "ch": "orderbook/full", "snapshot": { "CELUSDT_PERP": { "t": 1791572205997_i64, "s": 1, "a": [], "b": [] } } });
    let published = send(&mut conn, snapshot);

    assert_eq!(published, vec![("CELUSDT_PERP".to_string(), Vec::new(), Vec::new())]);
}

#[test]
fn a_symbol_that_was_not_subscribed_is_dropped_with_one_warning() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["ETHUSDT_PERP"]);

    assert!(send(&mut conn, btc_snapshot()).is_empty());
    assert!(send(&mut conn, btc_update()).is_empty());

    assert!(!conn.resync_requested());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

// acknowledgements, errors and other frames

#[test]
fn an_acknowledgement_that_leaves_out_a_symbol_is_logged_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDT_PERP", "NOPEUSDT_PERP"]);

    // NOPEUSDT_PERP was requested beside BTCUSDT_PERP and silently left out, as captured.
    send(&mut conn, json!({ "result": { "ch": "orderbook/full", "subscriptions": ["BTCUSDT_PERP"] }, "id": 1 }));

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].level, Level::WARN);
    assert_eq!(notices[0].text("kind"), "subscription_refused");
    assert_eq!(notices[0].number("missing"), 1.0);
    assert_eq!(notices[0].text("sample"), r#"["NOPEUSDT_PERP"]"#);
}

#[test]
fn a_full_acknowledgement_logs_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDT_PERP", "CELUSDT_PERP"]);

    send(&mut conn, json!({ "result": { "ch": "orderbook/full", "subscriptions": ["CELUSDT_PERP", "BTCUSDT_PERP"] }, "id": 1 }));

    assert!(logs.lines().is_empty());
}

#[test]
fn an_error_frame_is_logged_with_its_code_and_request() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDT_PERP"]);

    let error = json!({ "error": { "code": 2003, "message": "Unknown channel", "description": "Channel is not supported: orderbook/D30/100ms" }, "id": 2 });
    send(&mut conn, error);
    send(&mut conn, json!({ "error": { "code": 1, "message": "Invalid json", "description": "JSON request is corrupted." } }));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "hitbtc#perp#0");
    assert_eq!(errors[0].number("code"), 2003.0);
    assert_eq!(errors[0].number("request"), 2.0);
    assert_eq!(errors[0].text("message"), "Unknown channel");
    assert_eq!(errors[1].number("request"), 0.0);
    assert!(!conn.resync_requested());
}

#[test]
fn a_frame_that_is_not_json_is_an_error_and_leaves_the_books_alone() {
    let mut conn = connection(&["BTCUSDT_PERP"]);
    send(&mut conn, btc_snapshot());

    assert!(venue().handle(b"hello", &mut conn).is_err());
    assert!(!conn.resync_requested());
    assert_eq!(send(&mut conn, btc_update()).len(), 1);
}

#[test]
fn a_book_frame_that_cannot_be_read_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDT_PERP"]);
    send(&mut conn, btc_snapshot());

    let broken = br#"{"ch":"orderbook/full","update":{"BTCUSDT_PERP":{"t":1791572216902,"s":"#;
    assert!(venue().handle(broken, &mut conn).is_err());

    assert!(conn.take_published().is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "book_frame_unreadable");
}

#[test]
fn an_update_with_a_level_it_cannot_read_resyncs_and_publishes_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDT_PERP"]);
    send(&mut conn, btc_snapshot());

    let mut bad = btc_update();
    bad["update"]["BTCUSDT_PERP"]["b"][1] = json!(["82515.50", "n/a"]);
    let published = send(&mut conn, bad);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn a_snapshot_with_a_level_it_cannot_read_resyncs_and_publishes_nothing() {
    let mut conn = connection(&["BTCUSDT_PERP"]);

    let mut bad = btc_snapshot();
    bad["snapshot"]["BTCUSDT_PERP"]["a"][0] = json!(["-1", "0.0927"]);
    let published = send(&mut conn, bad);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn another_channel_or_an_unknown_frame_is_logged_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDT_PERP"]);

    send(&mut conn, json!({ "ch": "futures/info", "data": { "BTCUSDT_PERP": { "m": "82558.09" } } }));
    send(&mut conn, json!({ "jsonrpc": "2.0" }));

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 2);
    assert_eq!(notices[0].text("ch"), "futures/info");
    assert!(!conn.resync_requested());
}

// A probe of the live socket, which prints the first frames with their levels cut to three a side:
// CAPTURE_VENUE=hitbtc cargo test hitbtc::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let profile = match std::env::var("CAPTURE_VENUE").as_deref() {
        Ok("fmfwio") => &FMFWIO,
        Ok("changellypro") => &CHANGELLYPRO,
        Ok("mandala") => &MANDALA,
        Ok("gleecbtc") => &GLEECBTC,
        _ => &HITBTC,
    };
    let (mut ws, _) = tokio_tungstenite::connect_async(profile.socket).await.unwrap();
    let list = std::env::var("CAPTURE_SYMBOLS").unwrap_or_else(|_| "BTCUSDT_PERP,NOPEUSDT_PERP".to_string());
    let symbols: Vec<&str> = list.split(',').collect();
    ws.send(Message::text(json!({ "method": "subscribe", "ch": CHANNEL, "params": { "symbols": symbols }, "id": 1 }).to_string()))
        .await
        .unwrap();
    ws.send(Message::text(json!({ "method": "subscribe", "ch": "orderbook/D30/100ms", "params": { "symbols": symbols }, "id": 2 }).to_string()))
        .await
        .unwrap();
    ws.send(Message::text("hello")).await.unwrap();

    let seconds = std::env::var("CAPTURE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(4);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    let mut printed = 0;
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let Ok(mut value) = serde_json::from_str::<Value>(text.as_str()) else {
            println!("text {}", text.as_str());
            continue;
        };
        printed += 1;
        if printed > 12 {
            continue;
        }
        for kind in ["snapshot", "update"] {
            if let Some(books) = value.get_mut(kind).and_then(Value::as_object_mut) {
                for book in books.values_mut() {
                    for side in ["a", "b"] {
                        if let Some(levels) = book.get_mut(side).and_then(Value::as_array_mut) {
                            print!("{kind} {side} {} ", levels.len());
                            levels.truncate(3);
                        }
                    }
                }
            }
        }
        println!("{value}");
    }
    println!("frames {printed}");
}
