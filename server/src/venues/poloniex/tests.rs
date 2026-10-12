// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    testing::market(ID, raw_market_id, raw_market_id.split('_').next().unwrap(), "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}_USDT_PERP")));
    }
    markets
}

fn venue() -> Poloniex {
    Poloniex::new(&[])
}

fn connection(raw_ids: &[&str]) -> Connection<State> {
    let mut list = Vec::with_capacity(raw_ids.len());
    for id in raw_ids {
        list.push(market(id));
    }
    Connection::for_test("poloniex#swap#0", list)
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

fn book(action: &str, symbol: &str, lid: u64, id: u64, bids: Value, asks: Value) -> Value {
    json!({ "action": action, "channel": "book_lv2", "data": [{
        "asks": asks, "bids": bids, "cT": 1791573431222u64, "id": id, "lid": lid, "s": symbol, "ts": 1791573431236u64,
    }]})
}

// Frames captured live on 2026-10-09 at 19:17 UTC, with the snapshots cut to three of their 20 levels a side.
fn btc_snapshot() -> Value {
    book(
        "snapshot",
        "BTC_USDT_PERP",
        6449656855,
        6449656857,
        json!([["82440.17", "1"], ["82437.74", "3"], ["82437.68", "2"]]),
        json!([["82446.67", "3"], ["82446.74", "5"], ["82453.48", "1"]]),
    )
}

fn btc_update(lid: u64, id: u64, bids: Value, asks: Value) -> Value {
    book("update", "BTC_USDT_PERP", lid, id, bids, asks)
}

fn fil_snapshot() -> Value {
    book(
        "snapshot",
        "FIL_USDT_PERP",
        219556622,
        219556623,
        json!([["1.0724", "42"], ["1.0723", "41"], ["1.0718", "8625"]]),
        json!([["1.0744", "889"], ["1.0745", "4988"], ["1.0746", "22126"]]),
    )
}

fn btc_book() -> (Vec<BookLevel>, Vec<BookLevel>) {
    (
        levels(&[(82440.17, 1.0), (82437.74, 3.0), (82437.68, 2.0)]),
        levels(&[(82446.67, 3.0), (82446.74, 5.0), (82453.48, 1.0)]),
    )
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// plan, subscribe and settings

#[test]
fn puts_30_contracts_on_each_connection_to_the_one_public_endpoint() {
    let plans = venue().plan(&markets(70));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["poloniex#swap#0", "poloniex#swap#1", "poloniex#swap#2"]);
    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [30, 30, 10]);
    assert!(plans.iter().all(|plan| plan.url == "wss://ws.poloniex.com/ws/v3/public"));
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

#[test]
fn subscribes_every_contract_of_the_connection_in_one_frame() {
    let frames = venue().subscribe_frames(&[market("BTC_USDT_PERP"), market("FIL_USDT_PERP")], &mut State::default());

    assert_eq!(frames.len(), 1);
    assert_eq!(
        parsed(&frames[0]),
        json!({ "event": "subscribe", "channel": ["book_lv2"], "symbols": ["BTC_USDT_PERP", "FIL_USDT_PERP"] })
    );
}

#[test]
fn pings_with_a_json_event_every_15_seconds_and_ends_a_socket_silent_for_30() {
    let settings = venue().settings();

    assert_eq!(parsed(&venue().ping(&mut State::default())), json!({ "event": "ping" }));
    assert_eq!(settings.ping_every, Some(Duration::from_secs(15)));
    assert_eq!(settings.max_silence, Duration::from_secs(30));
}

// book

#[test]
fn publishes_the_snapshot_as_the_book() {
    let mut conn = connection(&["BTC_USDT_PERP"]);

    let published = send(&mut conn, btc_snapshot());

    let (bids, asks) = btc_book();
    assert_eq!(published, [("BTC_USDT_PERP".to_string(), bids, asks)]);
}

#[test]
fn applies_an_update_whose_lid_is_the_last_id_and_deletes_a_level_of_size_zero() {
    let mut conn = connection(&["BTC_USDT_PERP"]);
    send(&mut conn, btc_snapshot());

    send(&mut conn, btc_update(6449656857, 6449656858, json!([["82440.17", "0"], ["82438.00", "7"]]), json!([])));
    let published = send(&mut conn, btc_update(6449656858, 6449656861, json!([]), json!([["82446.67", "1723"]])));

    assert_eq!(
        published,
        [(
            "BTC_USDT_PERP".to_string(),
            levels(&[(82438.0, 7.0), (82437.74, 3.0), (82437.68, 2.0)]),
            levels(&[(82446.67, 1723.0), (82446.74, 5.0), (82453.48, 1.0)]),
        )]
    );
    assert!(!conn.resync_requested());
}

#[test]
fn resyncs_on_an_update_whose_lid_is_not_the_last_id() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC_USDT_PERP"]);
    send(&mut conn, btc_snapshot());

    let published = send(&mut conn, btc_update(6449656858, 6449656859, json!([["82374.82", "3452"]]), json!([])));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resyncs = logs.events("book_resync");
    assert_eq!(resyncs[0].text("reason"), "sequence_gap");
    assert_eq!(resyncs[0].text("market"), "BTC_USDT_PERP");
}

#[test]
fn drops_an_update_that_comes_before_its_snapshot_without_a_resync() {
    let mut conn = connection(&["BTC_USDT_PERP"]);

    let early = send(&mut conn, btc_update(6449656855, 6449656856, json!([["82374.82", "3452"]]), json!([])));
    let published = send(&mut conn, btc_snapshot());
    let next = send(&mut conn, btc_update(6449656857, 6449656858, json!([]), json!([["82446.74", "0"]])));

    assert!(early.is_empty());
    assert!(!conn.resync_requested());
    assert_eq!(published.len(), 1);
    assert_eq!(next[0].2, levels(&[(82446.67, 3.0), (82453.48, 1.0)]));
}

#[test]
fn replaces_the_book_with_a_later_snapshot_and_chains_from_its_id() {
    let mut conn = connection(&["BTC_USDT_PERP"]);
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_update(6449656857, 6449656858, json!([["82441.00", "4"]]), json!([])));

    let later = book("snapshot", "BTC_USDT_PERP", 6449657000, 6449657001, json!([["82400.00", "9"]]), json!([["82500.00", "8"]]));
    send(&mut conn, later);
    let published = send(&mut conn, btc_update(6449657001, 6449657002, json!([["82401.00", "1"]]), json!([])));

    assert_eq!(
        published,
        [("BTC_USDT_PERP".to_string(), levels(&[(82401.0, 1.0), (82400.0, 9.0)]), levels(&[(82500.0, 8.0)]))]
    );
    assert!(!conn.resync_requested());
}

#[test]
fn keeps_one_chain_per_contract() {
    let mut conn = connection(&["BTC_USDT_PERP", "FIL_USDT_PERP"]);
    send(&mut conn, btc_snapshot());
    send(&mut conn, fil_snapshot());

    let published = send(&mut conn, book("update", "FIL_USDT_PERP", 219556623, 219556630, json!([["1.0724", "0"]]), json!([])));
    send(&mut conn, btc_update(6449656857, 6449656858, json!([]), json!([["82446.67", "0"]])));

    assert_eq!(published[0].0, "FIL_USDT_PERP");
    assert_eq!(published[0].1, levels(&[(1.0723, 41.0), (1.0718, 8625.0)]));
    assert!(!conn.resync_requested());
}

#[test]
fn applies_every_contract_of_a_frame_that_carries_several() {
    let mut conn = connection(&["BTC_USDT_PERP", "FIL_USDT_PERP"]);
    let mut frame = btc_snapshot();
    frame["data"].as_array_mut().unwrap().push(fil_snapshot()["data"][0].clone());

    let published = send(&mut conn, frame);

    let ids: Vec<&str> = published.iter().map(|(id, _, _)| id.as_str()).collect();
    assert_eq!(ids, ["BTC_USDT_PERP", "FIL_USDT_PERP"]);
}

#[test]
fn ignores_a_contract_the_connection_did_not_subscribe() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["FIL_USDT_PERP"]);

    let published = send(&mut conn, btc_snapshot());

    assert!(published.is_empty());
    assert!(!conn.resync_requested());
    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "BTC_USDT_PERP");
}

#[test]
fn resyncs_on_a_level_it_cannot_read() {
    let mut conn = connection(&["BTC_USDT_PERP"]);
    send(&mut conn, btc_snapshot());

    let published = send(&mut conn, btc_update(6449656857, 6449656858, json!([["nope", "3"]]), json!([])));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn resyncs_on_a_snapshot_level_it_cannot_read_without_publishing_it() {
    let mut conn = connection(&["BTC_USDT_PERP"]);

    let snapshot = book("snapshot", "BTC_USDT_PERP", 1, 2, json!([["82440.17", "1"]]), json!([["82446.67", ""]]));
    let published = send(&mut conn, snapshot);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn resyncs_on_a_book_frame_that_does_not_parse_but_not_on_other_bad_frames() {
    let mut conn = connection(&["BTC_USDT_PERP"]);
    assert!(venue().handle(b"not json", &mut conn).is_err());
    assert!(!conn.resync_requested());

    let broken = br#"{"action":"update","channel":"book_lv2","data":[{"s":"BTC_USDT_PERP","bids":[["1"]]}]}"#;
    assert!(venue().handle(broken, &mut conn).is_err());

    assert!(conn.resync_requested());
}

// control frames

#[test]
fn passes_over_the_acknowledgement_and_the_pong_in_silence() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC_USDT_PERP"]);

    send(&mut conn, json!({ "channel": "book_lv2", "event": "subscribe", "symbols": ["BTC_USDT_PERP", "FIL_USDT_PERP"] }));
    send(&mut conn, json!({ "event": "pong" }));

    assert!(logs.events("venue_notice").is_empty());
    assert!(logs.events("venue_error").is_empty());
}

#[test]
fn logs_an_error_frame_with_its_message() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC_USDT_PERP"]);

    send(&mut conn, json!({ "event": "error", "message": "no valid symbols" }));
    send(&mut conn, json!({ "event": "error", "message": "All symbols subscription is not allowed" }));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].text("message"), "no valid symbols");
    assert_eq!(errors[0].text("connection"), "poloniex#swap#0");
    assert!(!conn.resync_requested());
}

#[test]
fn logs_any_other_frame_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC_USDT_PERP"]);

    send(&mut conn, json!({ "event": "unsubscribe", "channel": "book_lv2", "symbols": ["FIL_USDT_PERP"] }));
    send(&mut conn, json!({ "action": "delta", "channel": "book_lv2", "data": [] }));

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 2);
    assert_eq!(notices[0].text("op"), "unsubscribe");
    assert_eq!(notices[1].text("action"), "delta");
}

// A probe of the live socket, which prints each frame with its levels cut to three a side:
// cargo test poloniex::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(PUBLIC_URL).await.unwrap();
    let subscribe = |symbols: &[&str]| {
        Message::text(json!({ "event": "subscribe", "channel": [CHANNEL], "symbols": symbols }).to_string())
    };
    ws.send(subscribe(&["BTC_USDT_PERP", "FIL_USDT_PERP", "1000PEPE_USDT_PERP"])).await.unwrap();
    ws.send(subscribe(&["NOPE_USDT_PERP"])).await.unwrap();
    ws.send(subscribe(&["all"])).await.unwrap();
    ws.send(Message::text("hello")).await.unwrap();
    ws.send(Message::text(r#"{"event":"ping"}"#)).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(8);
    let mut books = 0;
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let mut value: Value = serde_json::from_str(text.as_str()).unwrap();
        if value["channel"] == CHANNEL && value.get("data").is_some() {
            books += 1;
            if books > 12 {
                continue;
            }
            for entry in value["data"].as_array_mut().unwrap() {
                for side in ["bids", "asks"] {
                    if let Some(levels) = entry[side].as_array_mut() {
                        print!("{side} {} ", levels.len());
                        levels.truncate(3);
                    }
                }
            }
        }
        println!("{value}");
    }
    println!("{books} book frames");
}
