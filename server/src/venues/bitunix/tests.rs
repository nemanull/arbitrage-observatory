// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use std::collections::HashMap;
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let quote = if raw_market_id.ends_with("USDC") { "USDC" } else { "USDT" };
    let base = raw_market_id.strip_suffix(quote).unwrap();
    testing::market(ID, raw_market_id, base, quote, true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}USDT")));
    }
    markets
}

fn venue() -> Bitunix {
    Bitunix::new()
}

fn connection(raw_ids: &[&str]) -> Connection<State> {
    let mut list = Vec::with_capacity(raw_ids.len());
    for id in raw_ids {
        list.push(market(id));
    }
    Connection::for_test("bitunix#public#0", list)
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

fn depth(symbol: &str, ts: i64, b: Value, a: Value) -> Value {
    json!({ "ch": "depth_book15", "data": { "a": a, "b": b }, "symbol": symbol, "ts": ts })
}

// Frames captured live on 2026-10-08, cut to three of the fifteen levels a side.
fn btc_frame() -> Value {
    depth(
        "BTCUSDT",
        1791523932219,
        json!([["82484.6", "2.0702"], ["82484.5", "0.8908"], ["82484.4", "0.9881"]]),
        json!([["82484.7", "2.4121"], ["82484.8", "2.4112"], ["82484.9", "2.9237"]]),
    )
}

fn btc_later_frame() -> Value {
    depth(
        "BTCUSDT",
        1791524075182,
        json!([["82519.9", "2.4509"], ["82519.8", "1.8906"], ["82519.7", "2.8622"]]),
        json!([["82520", "2.2821"], ["82520.1", "1.9552"], ["82520.2", "1.2143"]]),
    )
}

fn pepe_frame() -> Value {
    depth(
        "1000PEPEUSDT",
        1791523932220,
        json!([["0.003942", "304245"], ["0.0039419", "820464"], ["0.0039418", "658800"]]),
        json!([["0.0039421", "647909"], ["0.0039422", "292113"], ["0.0039423", "787212"]]),
    )
}

fn btc_usdc_frame() -> Value {
    depth(
        "BTCUSDC",
        1791523932221,
        json!([["82428.2", "0.229"], ["82427.2", "0.863"], ["82426.7", "0.501"]]),
        json!([["82428.3", "0.418"], ["82428.6", "0.788"], ["82428.8", "0.802"]]),
    )
}

// The one frame an unknown, delisted or preview symbol gets.
fn empty_frame(symbol: &str) -> Value {
    depth(symbol, 1791523932221, json!([["", ""], ["", ""], ["", ""]]), json!([["", ""], ["", ""], ["", ""]]))
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// plan

#[test]
fn puts_250_contracts_on_each_connection_to_the_one_public_endpoint() {
    let plans = venue().plan(&markets(718));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["bitunix#public#0", "bitunix#public#1", "bitunix#public#2"]);
    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [250, 250, 218]);
    assert!(plans.iter().all(|plan| plan.url == "wss://fapi.bitunix.com/public/"));
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames, ping and settings

#[test]
fn subscribes_a_whole_slice_in_one_frame_of_fifteen_level_windows() {
    let frames = venue().subscribe_frames(&markets(250), &mut State::default());

    assert_eq!(frames.len(), 1);
    let frame = parsed(&frames[0]);
    assert_eq!(frame["op"], "subscribe");
    let args = frame["args"].as_array().unwrap();
    assert_eq!(args.len(), 250);
    assert_eq!(args[0], json!({ "symbol": "SYM0USDT", "ch": "depth_book15" }));
    assert_eq!(args[249], json!({ "symbol": "SYM249USDT", "ch": "depth_book15" }));
}

#[test]
fn pings_with_the_json_ping_in_unix_seconds_every_twenty_seconds() {
    let before = now_ms() / 1000;
    let frame = parsed(&venue().ping(&mut State::default()));
    let after = now_ms() / 1000;

    assert_eq!(frame["op"], "ping");
    let seconds = frame["ping"].as_i64().unwrap();
    assert!((before..=after).contains(&seconds), "{seconds}");
    assert_eq!(venue().settings().ping_every, Some(Duration::from_secs(20)));
}

#[test]
fn ends_a_socket_silent_for_five_seconds_and_staggers_the_opens() {
    let settings = venue().settings();

    assert_eq!(settings.max_silence, Duration::from_secs(5));
    assert_eq!(settings.connect_stagger, Duration::from_secs(1));
    assert_eq!(settings.subscribe_gap, Duration::ZERO);
}

// handle: books

#[test]
fn hands_the_engine_the_window_of_a_subscribed_contract() {
    let mut conn = connection(&["BTCUSDT"]);

    let published = send(&mut conn, btc_frame());

    assert_eq!(
        published,
        [(
            "BTCUSDT".to_string(),
            levels(&[(82484.6, 2.0702), (82484.5, 0.8908), (82484.4, 0.9881)]),
            levels(&[(82484.7, 2.4121), (82484.8, 2.4112), (82484.9, 2.9237)]),
        )]
    );
}

#[test]
fn replaces_the_whole_book_on_every_push_and_never_resyncs() {
    let mut conn = connection(&["BTCUSDT"]);
    send(&mut conn, btc_frame());

    let published = send(&mut conn, btc_later_frame());

    assert_eq!(
        published,
        [(
            "BTCUSDT".to_string(),
            levels(&[(82519.9, 2.4509), (82519.8, 1.8906), (82519.7, 2.8622)]),
            levels(&[(82520.0, 2.2821), (82520.1, 1.9552), (82520.2, 1.2143)]),
        )]
    );
    assert!(!conn.resync_requested());
}

#[test]
fn passes_a_scaled_contract_and_a_usdc_contract_through_unchanged() {
    let mut conn = connection(&["1000PEPEUSDT", "BTCUSDC"]);

    let mut published = send(&mut conn, pepe_frame());
    published.extend(send(&mut conn, btc_usdc_frame()));

    assert_eq!(published.len(), 2);
    assert_eq!(published[0].0, "1000PEPEUSDT");
    assert_eq!(published[0].1[0], BookLevel { price: 0.003942, size: 304245.0 });
    assert_eq!(published[1].0, "BTCUSDC");
    assert_eq!(published[1].2[0], BookLevel { price: 82428.3, size: 0.418 });
}

#[test]
fn publishes_nothing_for_a_frame_of_empty_levels_and_logs_it_once() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["FDUSDUSDT", "BTCUSDT"]);

    assert!(send(&mut conn, empty_frame("FDUSDUSDT")).is_empty());
    assert!(send(&mut conn, empty_frame("FDUSDUSDT")).is_empty());

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].text("market"), "FDUSDUSDT");
    assert_eq!(notices[0].text("reason"), "empty_levels");
    assert!(!conn.resync_requested());
}

#[test]
fn clears_the_book_of_a_contract_whose_stream_turns_to_empty_levels() {
    let mut conn = connection(&["BTCUSDT"]);
    send(&mut conn, btc_frame());

    let published = send(&mut conn, empty_frame("BTCUSDT"));

    assert_eq!(published, [("BTCUSDT".to_string(), Vec::new(), Vec::new())]);
}

#[test]
fn publishes_nothing_for_a_frame_with_no_levels_at_all() {
    let mut conn = connection(&["BTCUSDT"]);

    assert!(send(&mut conn, depth("BTCUSDT", 1791523932221, json!([]), json!([]))).is_empty());
    assert!(conn.book(0).is_none());
}

#[test]
fn keeps_the_real_levels_of_a_window_padded_with_empty_ones() {
    let mut conn = connection(&["BTCUSDT"]);
    let frame = depth(
        "BTCUSDT",
        1791523932221,
        json!([["82484.6", "2.0702"], ["", ""]]),
        json!([["82484.7", "2.4121"], ["", ""]]),
    );

    let published = send(&mut conn, frame);

    assert_eq!(
        published,
        [("BTCUSDT".to_string(), levels(&[(82484.6, 2.0702)]), levels(&[(82484.7, 2.4121)]))]
    );
}

#[test]
fn ignores_a_contract_this_connection_did_not_subscribe() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDT"]);

    assert!(send(&mut conn, pepe_frame()).is_empty());
    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "1000PEPEUSDT");
}

#[test]
fn ignores_an_empty_frame_with_no_symbol() {
    let mut conn = connection(&["BTCUSDT"]);
    let mut frame = empty_frame("BTCUSDT");
    frame.as_object_mut().unwrap().remove("symbol");

    assert!(send(&mut conn, frame).is_empty());
}

// handle: control frames

#[test]
fn takes_the_connect_frame_and_the_ping_answer_quietly() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDT"]);

    // Both as captured live on 2026-10-08.
    let connect = json!({ "data": { "a": null, "b": null, "result": true }, "op": "connect", "ts": 1791523932104_i64 });
    let pong = json!({ "data": { "a": null, "b": null }, "op": "ping", "ping": 1791523932, "pong": 1791523932, "ts": 1791523932221_i64 });

    assert!(send(&mut conn, connect).is_empty());
    assert!(send(&mut conn, pong).is_empty());
    assert!(conn.take_sent().is_empty());
    assert!(logs.lines().is_empty());
}

#[test]
fn logs_a_refused_subscribe_as_a_venue_error() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDT"]);

    // The refusal past 300 streams, as the profile captured it on 2026-09-23.
    let refused = json!({ "op": "subscribe", "data": { "msg": "subscribe channel > 300", "nonce": "", "result": false } });
    assert!(send(&mut conn, refused).is_empty());

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "bitunix#public#0");
    assert_eq!(errors[0].text("op"), "subscribe");
    assert_eq!(errors[0].text("message"), "subscribe channel > 300");
}

#[test]
fn logs_a_control_frame_whose_data_is_a_string_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDT"]);

    // The unsubscribe answer, as the profile captured it on 2026-09-23.
    let answer = json!({ "op": "unsubscribe", "ts": 1790126500916_i64, "data": "success" });
    assert!(send(&mut conn, answer).is_empty());

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].text("op"), "unsubscribe");
}

#[test]
fn logs_an_unknown_control_frame_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDT"]);

    assert!(send(&mut conn, json!({ "op": "maintenance", "ts": 1791523932221_i64 })).is_empty());

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].text("op"), "maintenance");
    assert!(logs.events("venue_error").is_empty());
}

#[test]
fn reports_a_frame_that_is_not_json() {
    let mut conn = connection(&["BTCUSDT"]);

    assert!(venue().handle(b"not json", &mut conn).is_err());
}

// A probe of the live socket, which prints the first two frames of each stream with their levels cut to three a side:
// cargo test bitunix::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(PUBLIC_URL).await.unwrap();
    let list = std::env::var("CAPTURE_MARKETS").unwrap_or_else(|_| "BTCUSDT,1000PEPEUSDT,BTCUSDC,NOPEUSDT,QQQUSDT".to_string());
    let mut args = Vec::new();
    for symbol in list.split(',') {
        args.push(json!({ "symbol": symbol, "ch": CHANNEL }));
    }
    ws.send(Message::text(json!({ "op": "subscribe", "args": args }).to_string())).await.unwrap();
    ws.send(Message::text(json!({ "op": "ping", "ping": now_ms() / 1000 }).to_string())).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(4);
    let mut seen: HashMap<String, usize> = HashMap::new();
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let mut value: Value = serde_json::from_str(text.as_str()).unwrap();
        let key = format!("{}{}", value["ch"], value["symbol"]);
        let count = seen.entry(key).or_default();
        *count += 1;
        if value["ch"].is_string() && *count > 2 {
            continue;
        }
        for side in ["b", "a"] {
            if let Some(levels) = value["data"][side].as_array_mut() {
                println!("{side} {}", levels.len());
                levels.truncate(3);
            }
        }
        println!("{value}");
    }
}
