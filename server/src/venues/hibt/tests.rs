// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use std::collections::HashMap;
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let (base, quote) = raw_market_id.split_once('_').unwrap();
    testing::market(ID, raw_market_id, &base.to_uppercase(), &quote.to_uppercase(), true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("sym{i}_usdt")));
    }
    markets
}

fn venue() -> Hibt {
    Hibt::new()
}

fn connection(raw_ids: &[&str]) -> Connection<()> {
    let mut list = Vec::with_capacity(raw_ids.len());
    for id in raw_ids {
        list.push(market(id));
    }
    Connection::for_test("hibt#public#0", list)
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

fn send(conn: &mut Connection<()>, frame: Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn depth(symbol: &str, ts: i64, bids: Value, asks: Value) -> Value {
    json!({ "data": { "asks": asks, "bids": bids, "symbol": symbol }, "ts": ts, "type": format!("{symbol}.20deep") })
}

// Frames captured live on 2026-10-09, cut to three of the twenty levels a side.
fn btc_frame() -> Value {
    depth(
        "btc_usdt",
        1791571048316,
        json!(["82370.9", "0.045", "82370.6", "0.283", "82370.4", "0.227"]),
        json!(["82371.1", "0.207", "82371.3", "0.066", "82371.6", "0.116"]),
    )
}

fn xau_frame() -> Value {
    depth(
        "xau_usdt",
        1791571048212,
        json!(["4199.44", "5.198", "4199.41", "2.885", "4199.38", "3.909"]),
        json!(["4199.54", "4.221", "4199.57", "1.65", "4199.59", "1.802"]),
    )
}

fn xau_later_frame() -> Value {
    depth(
        "xau_usdt",
        1791571048712,
        json!(["4199.43", "5.684", "4199.4", "3.281", "4199.37", "1.228"]),
        json!(["4199.53", "6.6", "4199.54", "2.898", "4199.57", "1.798"]),
    )
}

fn shib_frame() -> Value {
    depth(
        "shib_usdt",
        1791571048456,
        json!(["5.389e-06", "2.3942156798e+10", "5.387e-06", "4.079605837e+09", "5.386e-06", "1.0740546235e+10"]),
        json!(["5.391e-06", "1.5948053992e+10", "5.393e-06", "6.533714301e+09", "5.394e-06", "7.396078015e+09"]),
    )
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// plan

#[test]
fn puts_up_to_100_contracts_on_each_connection_to_the_one_public_endpoint() {
    let plans = venue().plan(&markets(176));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["hibt#public#0", "hibt#public#1"]);
    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [100, 76]);
    assert!(plans.iter().all(|plan| plan.url == "wss://fapi.hibt0.com/v2/ws"));
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames, ping and settings

#[test]
fn subscribes_a_whole_slice_in_one_frame_of_comma_joined_twenty_level_topics() {
    let frames = venue().subscribe_frames(&markets(3), &mut ());

    assert_eq!(frames.len(), 1);
    assert_eq!(
        parsed(&frames[0]),
        json!({ "event": "sub", "topic": "sym0_usdt.20deep,sym1_usdt.20deep,sym2_usdt.20deep" })
    );
}

// A JSON frame without an "event" key drops the socket, so the ping must stay a protocol ping.
#[test]
fn pings_with_a_protocol_ping_every_fifteen_seconds() {
    assert!(matches!(venue().ping(&mut ()), Message::Ping(_)));
    assert_eq!(venue().settings().ping_every, Some(Duration::from_secs(15)));
}

#[test]
fn ends_a_socket_silent_for_ten_seconds() {
    let settings = venue().settings();

    assert_eq!(settings.max_silence, Duration::from_secs(10));
    assert_eq!(settings.subscribe_gap, Duration::ZERO);
    assert!(settings.headers.is_empty());
}

// handle: books

#[test]
fn hands_the_engine_the_whole_book_of_a_subscribed_contract() {
    let mut conn = connection(&["btc_usdt"]);

    let published = send(&mut conn, btc_frame());

    assert_eq!(
        published,
        [(
            "btc_usdt".to_string(),
            levels(&[(82370.9, 0.045), (82370.6, 0.283), (82370.4, 0.227)]),
            levels(&[(82371.1, 0.207), (82371.3, 0.066), (82371.6, 0.116)]),
        )]
    );
}

#[test]
fn replaces_the_whole_book_on_every_push_and_never_resyncs() {
    let mut conn = connection(&["xau_usdt"]);
    send(&mut conn, xau_frame());

    let published = send(&mut conn, xau_later_frame());

    assert_eq!(
        published,
        [(
            "xau_usdt".to_string(),
            levels(&[(4199.43, 5.684), (4199.4, 3.281), (4199.37, 1.228)]),
            levels(&[(4199.53, 6.6), (4199.54, 2.898), (4199.57, 1.798)]),
        )]
    );
    assert!(!conn.resync_requested());
}

#[test]
fn publishes_a_push_that_repeats_the_last_one_since_it_confirms_the_book() {
    let mut conn = connection(&["btc_usdt"]);
    let first = send(&mut conn, btc_frame());

    let repeat = send(&mut conn, btc_frame());

    assert_eq!(repeat, first);
}

#[test]
fn reads_prices_and_sizes_in_exponent_form() {
    let mut conn = connection(&["shib_usdt"]);

    let published = send(&mut conn, shib_frame());

    assert_eq!(published[0].1[0], BookLevel { price: 0.000005389, size: 23942156798.0 });
    assert_eq!(published[0].2[2], BookLevel { price: 0.000005394, size: 7396078015.0 });
}

// The one level commodity frame the profile captured on 2026-09-23 adds two totals the book ignores.
// The loader leaves crude out, and the frame stands for any push that carries them.
#[test]
fn ignores_the_extra_totals_of_a_commodity_frame() {
    let mut conn = Connection::for_test("hibt#public#0", vec![testing::market(ID, "crude", "CRUDE", "USDT", true)]);
    let frame = json!({
        "type": "crude.20deep", "ts": 1790133935963_i64,
        "data": { "symbol": "crude", "asks": ["7585.2", "4.765"], "bids": ["7583.6", "3.512"], "allAskAmount": "3208.541", "allBidAmount": "8020.744" },
    });

    let published = send(&mut conn, frame);

    assert_eq!(
        published,
        [("crude".to_string(), levels(&[(7583.6, 3.512)]), levels(&[(7585.2, 4.765)]))]
    );
}

#[test]
fn clears_the_book_on_a_push_with_no_levels() {
    let mut conn = connection(&["btc_usdt"]);
    send(&mut conn, btc_frame());

    let published = send(&mut conn, depth("btc_usdt", 1791571048517, json!([]), json!(null)));

    assert_eq!(published, [("btc_usdt".to_string(), Vec::new(), Vec::new())]);
}

#[test]
fn ignores_a_contract_this_connection_did_not_subscribe() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["btc_usdt"]);

    assert!(send(&mut conn, shib_frame()).is_empty());
    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "shib_usdt");
}

#[test]
fn ignores_a_push_with_no_data() {
    let mut conn = connection(&["btc_usdt"]);

    assert!(send(&mut conn, json!({ "ts": 1791571048316_i64, "type": "btc_usdt.20deep" })).is_empty());
    assert!(conn.book(0).is_none());
}

#[test]
fn reports_a_book_push_whose_data_is_no_book_and_keeps_the_last_book() {
    let mut conn = connection(&["btc_usdt"]);
    send(&mut conn, btc_frame());
    let frame = json!({ "data": "error", "ts": 1791571048517_i64, "type": "btc_usdt.20deep" });

    assert!(venue().handle(frame.to_string().as_bytes(), &mut conn).is_err());
    assert!(conn.take_published().is_empty());
    assert_eq!(conn.book(0).unwrap().bids()[0], BookLevel { price: 82370.9, size: 0.045 });
}

#[test]
fn reports_a_price_with_no_size() {
    let mut conn = connection(&["btc_usdt"]);
    let frame = depth("btc_usdt", 1791571048316, json!(["82370.9", "0.045", "82370.6"]), json!([]));

    assert!(venue().handle(frame.to_string().as_bytes(), &mut conn).is_err());
    assert!(conn.take_published().is_empty());
}

// handle: control frames

#[test]
fn takes_the_greeting_and_an_ok_subscribe_answer_quietly() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["btc_usdt"]);

    // Both as captured live on 2026-10-09.
    let hello = json!({ "data": "success", "ts": 1791571047934_i64, "type": "hello" });
    let ack = json!({
        "data": { "asks": null, "bids": null, "status": "ok", "topic": "btc_usdt.20deep,shib_usdt.20deep,nope_usdt.20deep" },
        "ts": 1791571048126_i64, "type": "sub",
    });

    assert!(send(&mut conn, hello).is_empty());
    assert!(send(&mut conn, ack).is_empty());
    assert!(conn.take_sent().is_empty());
    assert!(logs.lines().is_empty());
}

#[test]
fn logs_a_refused_subscribe_as_a_venue_error() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["btc_usdt"]);

    // The answer to a topic sent as an array, captured live on 2026-10-09.
    let refused = json!({ "data": "error topic", "ts": 1791571048128_i64, "type": "sub" });
    assert!(send(&mut conn, refused).is_empty());

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "hibt#public#0");
    assert_eq!(errors[0].text("message"), "error topic");
}

#[test]
fn logs_a_subscribe_answer_that_is_not_ok_as_a_venue_error() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["btc_usdt"]);

    let refused = json!({ "data": { "status": "fail", "topic": "btc_usdt.20deep" }, "ts": 1791571048128_i64, "type": "sub" });
    assert!(send(&mut conn, refused).is_empty());

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].text("topic"), "btc_usdt.20deep");
    assert_eq!(errors[0].text("status"), "fail");
}

#[test]
fn logs_an_unsubscribe_answer_or_another_topic_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["btc_usdt"]);

    // The unsubscribe answer and the index push, as the profile captured them on 2026-09-23.
    let unsub = json!({ "type": "unsub", "ts": 1790134113549_i64, "data": { "topic": "btc_usdt.20deep", "status": "ok" } });
    let index = json!({ "type": "btc_usdt.index", "ts": 1790133936005_i64, "data": { "symbol": "btc_usdt", "price": "86708.979", "time": 1790133936001_i64 } });
    assert!(send(&mut conn, unsub).is_empty());
    assert!(send(&mut conn, index).is_empty());

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 2);
    assert_eq!(notices[0].text("kind"), "unsub");
    assert_eq!(notices[1].text("kind"), "btc_usdt.index");
    assert!(logs.events("venue_error").is_empty());
}

#[test]
fn reports_a_frame_that_is_not_json_or_has_no_type() {
    let mut conn = connection(&["btc_usdt"]);

    assert!(venue().handle(b"not json", &mut conn).is_err());
    assert!(venue().handle(br#"{"data":"success"}"#, &mut conn).is_err());
}

// A probe of the live socket, which prints the first two frames of each type with their levels cut to three a side:
// cargo test hibt::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(PUBLIC_URL).await.unwrap();
    let topics = std::env::var("CAPTURE_TOPICS")
        .unwrap_or_else(|_| "btc_usdt.20deep,shib_usdt.20deep,xau_usdt.20deep,nope_usdt.20deep,sse_usdt.20deep".to_string());
    ws.send(Message::text(json!({ "event": "sub", "topic": topics }).to_string())).await.unwrap();
    ws.send(Message::text(json!({ "event": "sub", "topic": ["btc_usdt.20deep"] }).to_string())).await.unwrap();
    ws.send(Message::Ping(Default::default())).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(4);
    let mut seen: HashMap<String, usize> = HashMap::new();
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let mut value: Value = serde_json::from_str(text.as_str()).unwrap();
        let kind = value["type"].as_str().unwrap_or("").to_string();
        let count = seen.entry(kind.clone()).or_default();
        *count += 1;
        if kind.ends_with(DEPTH_SUFFIX) && *count > 2 {
            continue;
        }
        for side in ["bids", "asks"] {
            if !value["data"].is_object() {
                break;
            }
            if let Some(levels) = value["data"][side].as_array_mut() {
                println!("{kind} {side} {}", levels.len() / 2);
                levels.truncate(6);
            }
        }
        println!("{value}");
    }
    println!("{seen:?}");
}
