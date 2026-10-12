// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use std::collections::HashMap;
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.strip_suffix("-PERP").unwrap();
    testing::market(ID, raw_market_id, base, "USD", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}-PERP")));
    }
    markets
}

fn venue() -> Globe {
    Globe::new()
}

fn connection(raw_ids: &[&str]) -> Connection<()> {
    let mut list = Vec::with_capacity(raw_ids.len());
    for id in raw_ids {
        list.push(market(id));
    }
    Connection::for_test("globe#public#0", list)
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

fn depth(instrument: &str, timestamp: i64, bids: Value, asks: Value) -> Value {
    json!({
        "data": { "asks": asks, "bids": bids, "timestamp": timestamp },
        "subscription": { "channel": "depth", "instrument": instrument },
    })
}

// Frames captured live on 2026-10-09 at 18:21 UTC, cut to three of the up to 25 levels a side.
fn btc_frame() -> Value {
    depth(
        "BTC-PERP",
        1791570103488,
        json!([
            { "price": 82484.0, "volume": 0.0006, "volume_quote": 49.49 },
            { "price": 82332.0, "volume": 0.1056, "volume_quote": 8694.259 },
            { "price": 82225.0, "volume": 0.0971, "volume_quote": 7984.047 },
        ]),
        json!([
            { "price": 82518.0, "volume": 0.1411, "volume_quote": 11643.289 },
            { "price": 82580.0, "volume": 0.0002, "volume_quote": 16.516 },
            { "price": 82663.0, "volume": 0.1174, "volume_quote": 9704.636 },
        ]),
    )
}

// The next tick, with one ask level changed.
fn btc_later_frame() -> Value {
    depth(
        "BTC-PERP",
        1791570103588,
        json!([
            { "price": 82484.0, "volume": 0.0006, "volume_quote": 49.49 },
            { "price": 82332.0, "volume": 0.1056, "volume_quote": 8694.259 },
            { "price": 82225.0, "volume": 0.0971, "volume_quote": 7984.047 },
        ]),
        json!([
            { "price": 82518.0, "volume": 0.141, "volume_quote": 11635.038 },
            { "price": 82552.0, "volume": 0.0001, "volume_quote": 8.255 },
            { "price": 82663.0, "volume": 0.1174, "volume_quote": 9704.636 },
        ]),
    )
}

// Prices in exponent form, and sizes in PEPE rather than in contracts of 1,000,000.
fn pepe_frame() -> Value {
    let text = r#"{"data":{"asks":[{"price":3.9143e-6,"volume":1000000.0,"volume_quote":3.9143},{"price":3.91584e-6,"volume":1000000.0,"volume_quote":3.91584},{"price":3.93149e-6,"volume":58000000.0,"volume_quote":228.02642}],"bids":[{"price":3.90801e-6,"volume":1000000.0,"volume_quote":3.90801},{"price":3.90646e-6,"volume":3000000.0,"volume_quote":11.71938},{"price":3.89236e-6,"volume":54000000.0,"volume_quote":210.18744}],"timestamp":1791570103488},"subscription":{"channel":"depth","instrument":"PEPE-PERP"}}"#;
    serde_json::from_str(text).unwrap()
}

// What the suspended IOTA-PERP streams every 100 ms.
fn empty_frame(instrument: &str) -> Value {
    depth(instrument, 1791570103588, json!([]), json!([]))
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// plan

#[test]
fn puts_forty_contracts_on_each_connection_to_the_one_public_endpoint() {
    let plans = venue().plan(&markets(90));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["globe#public#0", "globe#public#1", "globe#public#2"]);
    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [40, 40, 10]);
    assert!(plans.iter().all(|plan| plan.url == "wss://globe.exchange/api/v1/ws"));
}

#[test]
fn puts_the_whole_catalog_of_today_on_one_connection() {
    assert_eq!(venue().plan(&markets(28)).len(), 1);
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames and settings

#[test]
fn subscribes_each_contract_to_the_depth_channel_in_a_frame_of_its_own() {
    let frames = venue().subscribe_frames(&[market("BTC-PERP"), market("PEPE-PERP")], &mut ());

    assert_eq!(frames.len(), 2);
    assert_eq!(parsed(&frames[0]), json!({ "command": "subscribe", "channel": "depth", "instrument": "BTC-PERP" }));
    assert_eq!(parsed(&frames[1]), json!({ "command": "subscribe", "channel": "depth", "instrument": "PEPE-PERP" }));
}

#[test]
fn spaces_the_subscribe_frames_sends_no_ping_and_ends_a_socket_silent_for_five_seconds() {
    let settings = venue().settings();

    assert_eq!(settings.subscribe_gap, Duration::from_millis(50));
    assert_eq!(settings.ping_every, None);
    assert_eq!(settings.max_silence, Duration::from_secs(5));
}

// handle: books

#[test]
fn hands_the_engine_the_whole_book_of_a_subscribed_contract() {
    let mut conn = connection(&["BTC-PERP"]);

    let published = send(&mut conn, btc_frame());

    assert_eq!(
        published,
        [(
            "BTC-PERP".to_string(),
            levels(&[(82484.0, 0.0006), (82332.0, 0.1056), (82225.0, 0.0971)]),
            levels(&[(82518.0, 0.1411), (82580.0, 0.0002), (82663.0, 0.1174)]),
        )]
    );
}

#[test]
fn replaces_the_whole_book_on_every_push_and_never_resyncs() {
    let mut conn = connection(&["BTC-PERP"]);
    send(&mut conn, btc_frame());

    let published = send(&mut conn, btc_later_frame());

    assert_eq!(published[0].2, levels(&[(82518.0, 0.141), (82552.0, 0.0001), (82663.0, 0.1174)]));
    assert!(!conn.resync_requested());
}

#[test]
fn publishes_a_repeated_book_again_since_it_says_the_book_was_current_at_that_tick() {
    let mut conn = connection(&["BTC-PERP"]);
    send(&mut conn, btc_frame());

    let published = send(&mut conn, btc_frame());

    assert_eq!(published.len(), 1);
    assert_eq!(published[0].1[0], BookLevel { price: 82484.0, size: 0.0006 });
}

#[test]
fn reads_exponent_prices_and_keeps_sizes_in_coins_of_the_base() {
    let mut conn = connection(&["PEPE-PERP"]);

    let published = send(&mut conn, pepe_frame());

    assert_eq!(published[0].1[0], BookLevel { price: 3.90801e-6, size: 1000000.0 });
    assert_eq!(published[0].2[2], BookLevel { price: 3.93149e-6, size: 58000000.0 });
}

#[test]
fn clears_the_book_of_a_contract_that_turns_to_empty_books() {
    let mut conn = connection(&["BTC-PERP"]);
    send(&mut conn, btc_frame());

    let published = send(&mut conn, empty_frame("BTC-PERP"));

    assert_eq!(published, [("BTC-PERP".to_string(), Vec::new(), Vec::new())]);
    assert!(!conn.resync_requested());
}

#[test]
fn ignores_a_contract_this_connection_did_not_subscribe() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP"]);

    assert!(send(&mut conn, pepe_frame()).is_empty());
    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "PEPE-PERP");
}

#[test]
fn ignores_another_channel_of_a_subscribed_contract() {
    let mut conn = connection(&["BTC-PERP"]);

    // The index-price push, as the profile captured it on 2026-09-23.
    let index = json!({ "subscription": { "channel": "index-price", "instrument": "BTC-PERP" }, "data": { "price": 86844.975 } });

    assert!(send(&mut conn, index).is_empty());
    assert!(conn.book(0).is_none());
}

// handle: errors and other frames

#[test]
fn logs_an_unknown_instrument_as_a_venue_error_naming_it() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP"]);

    // As captured live on 2026-10-09, now with a data object of null sides.
    let error = json!({ "data": { "asks": null, "bids": null }, "details": "NOPE-PERP", "error": "invalid-instrument" });
    assert!(send(&mut conn, error).is_empty());

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "globe#public#0");
    assert_eq!(errors[0].text("error"), "invalid-instrument");
    assert_eq!(errors[0].text("details"), "NOPE-PERP");
    assert!(conn.book(0).is_none());
}

#[test]
fn logs_a_refused_request_and_a_syntax_error_as_venue_errors() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP"]);

    // Both as captured live on 2026-10-09, for an unknown channel and for text that is not JSON.
    send(&mut conn, json!({ "data": { "asks": null, "bids": null }, "error": "invalid-request" }));
    send(&mut conn, json!({ "data": { "asks": null, "bids": null }, "error": "invalid-syntax" }));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].text("error"), "invalid-request");
    assert_eq!(errors[0].text("details"), "");
    assert_eq!(errors[1].text("error"), "invalid-syntax");
}

#[test]
fn logs_a_frame_with_neither_a_subscription_nor_an_error_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP"]);

    assert!(send(&mut conn, json!({ "notice": "maintenance" })).is_empty());

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 1);
    assert!(notices[0].text("frame").contains("maintenance"));
    assert!(logs.events("venue_error").is_empty());
}

#[test]
fn clears_the_book_of_a_contract_whose_depth_frame_does_not_read_until_one_reads_again() {
    let mut conn = connection(&["BTC-PERP"]);
    send(&mut conn, btc_frame());

    // The BTC capture with its best bid's price nulled, which would otherwise drop that level and publish the rest.
    let mut broken = btc_frame();
    broken["data"]["bids"][0]["price"] = Value::Null;
    assert!(venue().handle(broken.to_string().as_bytes(), &mut conn).is_err());

    assert_eq!(conn.take_published(), [("BTC-PERP".to_string(), Vec::new(), Vec::new())]);
    assert!(!conn.resync_requested());
    assert_eq!(send(&mut conn, btc_later_frame())[0].1.len(), 3);
}

#[test]
fn publishes_nothing_for_an_unreadable_frame_of_a_contract_that_has_no_book_yet() {
    let mut conn = connection(&["BTC-PERP"]);

    let mut broken = btc_frame();
    broken["data"]["asks"][1].as_object_mut().unwrap().remove("volume");
    assert!(venue().handle(broken.to_string().as_bytes(), &mut conn).is_err());

    assert!(conn.take_published().is_empty());
    assert!(conn.book(0).is_none());
}

#[test]
fn reports_a_frame_that_is_not_json() {
    let mut conn = connection(&["BTC-PERP"]);

    assert!(venue().handle(b"not json", &mut conn).is_err());
}

// A probe of the live socket, which prints the first two frames of each stream with their levels cut to three a side:
// cargo test globe::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(PUBLIC_URL).await.unwrap();
    let list = std::env::var("CAPTURE_MARKETS").unwrap_or_else(|_| "BTC-PERP,PEPE-PERP,XLM-PERP,IOTA-PERP,NOPE-PERP".to_string());
    for instrument in list.split(',') {
        let frame = json!({ "command": "subscribe", "channel": CHANNEL, "instrument": instrument });
        ws.send(Message::text(frame.to_string())).await.unwrap();
        tokio::time::sleep(Duration::from_millis(50)).await;
    }
    ws.send(Message::text(json!({ "command": "subscribe", "channel": "nope", "instrument": "BTC-PERP" }).to_string())).await.unwrap();
    ws.send(Message::text("not json")).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(5);
    let mut seen: HashMap<String, usize> = HashMap::new();
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let mut value: Value = serde_json::from_str(text.as_str()).unwrap();
        let key = value["subscription"].to_string();
        let count = seen.entry(key).or_default();
        *count += 1;
        if value["subscription"].is_object() && *count > 2 {
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
