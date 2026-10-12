// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use std::collections::HashMap;
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(code: &str) -> Market {
    testing::market(ID, code, "BTC", "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    (0..count).map(|i| market(&format!("sym{i}usdt"))).collect()
}

fn venue() -> Hotcoin {
    Hotcoin::new(&[])
}

// A connection after its subscribe, which records its contracts.
fn connection(codes: &[&str]) -> Connection<State> {
    let markets: Vec<Market> = codes.iter().map(|code| market(code)).collect();
    let mut conn = Connection::for_test("hotcoin#perpetual#0", markets.clone());
    venue().subscribe_frames(&markets, &mut conn.state);
    conn
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    pairs.iter().map(|&(price, size)| BookLevel { price, size }).collect()
}

fn send(venue: &Hotcoin, conn: &mut Connection<State>, frame: Value) -> Published {
    venue.handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn depth(code: &str, timestamp: i64, bids: Value, asks: Value) -> Value {
    json!({ "biz": "perpetual", "contractCode": code, "data": { "asks": asks, "bids": bids }, "env": 0, "timestamp": timestamp, "type": "depth" })
}

// Frames captured live on 2026-10-09, cut to three of the fifty levels a side.
fn btc_frame() -> Value {
    depth(
        "btcusdt",
        1791570178859,
        json!([["82546.5", "3968", "3968"], ["82546.2", "929", "4897"], ["82545.8", "1296", "6193"]]),
        json!([["82546.6", "6310", "6310"], ["82546.9", "908", "7218"], ["82547.3", "1614", "8832"]]),
    )
}

fn btc_later_frame() -> Value {
    depth(
        "btcusdt",
        1791570179111,
        json!([["82546.4", "4100", "4100"], ["82546.2", "929", "5029"], ["82545.8", "1296", "6325"]]),
        json!([["82546.6", "5880", "5880"], ["82546.9", "908", "6788"], ["82547.3", "1614", "8402"]]),
    )
}

fn pepe_frame() -> Value {
    depth(
        "1000pepeusdt",
        1791570178860,
        json!([["0.0039107", "1535", "1535"], ["0.0039105", "1684", "3219"], ["0.0039104", "20302", "23521"]]),
        json!([["0.0039115", "1576", "1576"], ["0.0039117", "1737", "3313"], ["0.0039119", "3785", "7098"]]),
    )
}

// The acknowledgement of a depth subscribe, which carries null levels.
fn depth_ack(code: &str) -> Value {
    json!({ "biz": "perpetual", "channel": "subscribe", "contractCode": code, "data": { "asks": null, "bids": null, "result": true }, "env": 0, "type": "depth" })
}

// A fund_rates push cut to three of its 991 rows, captured live on 2026-10-09, with a delisted contract's negative countdown first.
fn fund_rates() -> Value {
    json!({
        "biz": "perpetual", "env": 0, "timestamp": 1791572349001_i64, "type": "fund_rates",
        "data": [
            ["funusdt", "0.000514", "0.000514", "0.00047576", "0", -15317948846_i64, "0", "0.00", "0.00", "0", "", "", "", "USDT", "FUN", "USDT", "0", 0, "0.000513"],
            ["qcomusdt", "174.25", "174.25", "0.00058231", "0.00026139", 18051154, "0", "1167.87", "1167.90", "0", "", "", "", "USDT", "QCOM", "USDT", "0", 2, "174.25"],
            ["swarmsusdt", "0.007994", "0.008001", "0.00008367", "0.00005", 3651154, "0", "0.05", "0.05", "0", "", "", "", "USDT", "SWARMS", "USDT", "0", 2, "0.007992"],
        ],
    })
}

// The acknowledgement of the fund_rates subscribe, which names no contract.
fn fund_rates_ack() -> Value {
    json!({ "biz": "perpetual", "channel": "subscribe", "data": { "result": true }, "env": 0, "type": "fund_rates" })
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// plan

#[test]
fn puts_150_contracts_on_each_connection_to_the_one_endpoint() {
    let plans = venue().plan(&markets(594));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["hotcoin#perpetual#0", "hotcoin#perpetual#1", "hotcoin#perpetual#2", "hotcoin#perpetual#3"]);
    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [150, 150, 150, 144]);
    assert!(plans.iter().all(|plan| plan.url == "wss://wss-ct.hotcoin.fit"));
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames, ping and settings

#[test]
fn subscribes_each_contract_to_depth_one_topic_a_frame_and_then_fund_rates_in_plain_json() {
    let mut state = State::default();
    let frames = venue().subscribe_frames(&markets(150), &mut state);

    assert_eq!(frames.len(), 151);
    assert_eq!(
        parsed(&frames[0]),
        json!({ "event": "subscribe", "params": { "biz": "perpetual", "type": "depth", "contractCode": "sym0usdt", "zip": false, "serialize": false } })
    );
    assert_eq!(parsed(&frames[149])["params"]["contractCode"], "sym149usdt");
    assert_eq!(
        parsed(&frames[150]),
        json!({ "event": "subscribe", "params": { "biz": "perpetual", "type": "fund_rates", "zip": false, "serialize": false } })
    );
    assert_eq!(state.codes.len(), 150);
}

#[test]
fn pings_with_the_json_ping_every_twenty_seconds_and_ends_a_socket_silent_for_45_seconds() {
    assert_eq!(parsed(&venue().ping(&mut State::default())), json!({ "event": "ping" }));

    let settings = venue().settings();
    assert_eq!(settings.ping_every, Some(Duration::from_secs(20)));
    assert_eq!(settings.max_silence, Duration::from_secs(45));
    assert_eq!(settings.subscribe_gap, Duration::ZERO);
}

// handle: books

#[test]
fn hands_the_engine_the_window_in_contracts_without_the_running_total() {
    let mut conn = connection(&["btcusdt"]);

    let published = send(&venue(), &mut conn, btc_frame());

    assert_eq!(
        published,
        [(
            "btcusdt".to_string(),
            levels(&[(82546.5, 3968.0), (82546.2, 929.0), (82545.8, 1296.0)]),
            levels(&[(82546.6, 6310.0), (82546.9, 908.0), (82547.3, 1614.0)]),
        )]
    );
}

#[test]
fn replaces_the_whole_book_on_every_push_and_never_resyncs() {
    let venue = venue();
    let mut conn = connection(&["btcusdt", "1000pepeusdt"]);
    send(&venue, &mut conn, btc_frame());
    send(&venue, &mut conn, pepe_frame());

    let published = send(&venue, &mut conn, btc_later_frame());

    assert_eq!(published.len(), 1);
    assert_eq!(published[0].1[0], BookLevel { price: 82546.4, size: 4100.0 });
    assert_eq!(published[0].2[0], BookLevel { price: 82546.6, size: 5880.0 });
    assert!(!conn.resync_requested());
}

#[test]
fn routes_a_code_echoed_in_capitals_to_its_lowercase_market() {
    let mut conn = connection(&["btcusdt"]);
    let mut frame = btc_frame();
    frame["contractCode"] = json!("BTCUSDT");

    let published = send(&venue(), &mut conn, frame);

    assert_eq!(published[0].0, "btcusdt");
}

#[test]
fn drops_a_push_for_a_contract_this_connection_did_not_subscribe() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["btcusdt"]);

    let published = send(&venue(), &mut conn, pepe_frame());

    assert!(published.is_empty());
    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "1000pepeusdt");
}

#[test]
fn clears_the_book_and_fails_the_frame_when_a_level_has_no_number() {
    let venue = venue();
    let mut conn = connection(&["btcusdt"]);
    send(&venue, &mut conn, btc_frame());
    let frame = depth("btcusdt", 1791570179111, json!([["82546.4", "", "0"]]), json!([["82546.6", "5880", "5880"]]));

    assert!(venue.handle(frame.to_string().as_bytes(), &mut conn).is_err());

    assert_eq!(conn.take_published(), [("btcusdt".to_string(), Vec::new(), Vec::new())]);
}

#[test]
fn clears_the_book_of_a_depth_frame_that_does_not_parse() {
    let venue = venue();
    let mut conn = connection(&["btcusdt"]);
    send(&venue, &mut conn, btc_frame());
    let frame = depth("btcusdt", 1791570179111, json!([{ "price": "82546.4" }]), json!([]));

    assert!(venue.handle(frame.to_string().as_bytes(), &mut conn).is_err());

    assert_eq!(conn.take_published(), [("btcusdt".to_string(), Vec::new(), Vec::new())]);
}

#[test]
fn publishes_nothing_for_an_unreadable_depth_frame_of_a_market_with_no_book_yet() {
    let venue = venue();
    let mut conn = connection(&["btcusdt"]);
    let frame = depth("btcusdt", 1791570179111, json!([["0", "5", "5"]]), json!([]));

    assert!(venue.handle(frame.to_string().as_bytes(), &mut conn).is_err());

    assert!(conn.take_published().is_empty());
}

// handle: control frames

#[test]
fn takes_an_acknowledgement_and_the_pong_silently() {
    let (logs, _capture) = capture();
    let venue = venue();
    let mut conn = connection(&["btcusdt"]);

    assert!(send(&venue, &mut conn, depth_ack("btcusdt")).is_empty());
    assert!(send(&venue, &mut conn, fund_rates_ack()).is_empty());
    assert!(send(&venue, &mut conn, json!({ "data": null, "event": "pong" })).is_empty());

    assert!(conn.take_sent().is_empty());
    assert!(logs.lines().iter().all(|line| line.level > Level::WARN));
}

#[test]
fn logs_an_unsubscribe_answer_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["btcusdt"]);
    let frame = json!({ "channel": "unsubscribe", "biz": "perpetual", "type": "depth", "env": 0, "subType": "depth", "subResult": true, "data": { "result": true } });

    send(&venue(), &mut conn, frame);

    assert_eq!(logs.events("venue_notice")[0].text("channel"), "unsubscribe");
}

#[test]
fn logs_the_error_frame_at_error_with_the_connection() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["btcusdt"]);

    // The answer to a frame the server cannot read, captured live on 2026-10-09.
    send(&venue(), &mut conn, json!({ "data": null, "error_code": 500, "error_msg": "exception", "result": false }));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].text("connection"), "hotcoin#perpetual#0");
    assert_eq!(errors[0].text("message"), "exception");
    assert_eq!(errors[0].number("code"), 500.0);
}

#[test]
fn fails_a_frame_that_is_not_json() {
    let mut conn = connection(&["btcusdt"]);

    assert!(venue().handle(b"not json", &mut conn).is_err());
}

// handle: anchors

#[test]
fn writes_the_fund_rates_rows_of_its_own_contracts_into_the_socket_anchors() {
    let venue = venue();
    let mut conn = connection(&["qcomusdt", "btcusdt"]);
    venue.intervals.lock().unwrap().set("qcomusdt", Some(8.0));

    let published = send(&venue, &mut conn, fund_rates());

    assert!(published.is_empty());
    let rows = venue.anchors.rows();
    assert_eq!(rows.keys().collect::<Vec<_>>(), ["qcomusdt"]);
    let row = rows["qcomusdt"];
    assert_eq!((row.index, row.mark), (174.25, 174.25));
    assert_eq!(row.funding_rate, 0.00026139);
    assert_eq!(row.funding_interval_hours, 8.0);
    assert_eq!(row.next_funding_at, 1791590400000);
    assert_eq!(row.ts, Some(1));
}

#[test]
fn keeps_a_row_out_until_the_interval_is_known() {
    let venue = venue();
    let mut conn = connection(&["qcomusdt"]);

    send(&venue, &mut conn, fund_rates());

    assert!(venue.anchors.rows().is_empty());
}

#[test]
fn leaves_the_rows_of_other_connections_and_of_delisted_contracts_alone_without_a_warning() {
    let (logs, _capture) = capture();
    let venue = venue();
    let mut conn = connection(&["btcusdt"]);
    for code in ["funusdt", "qcomusdt", "swarmsusdt"] {
        venue.intervals.lock().unwrap().set(code, Some(4.0));
    }

    send(&venue, &mut conn, fund_rates());

    assert!(venue.anchors.rows().is_empty());
    assert!(logs.lines().iter().all(|line| line.level > Level::WARN));
}

#[test]
fn fails_a_fund_rates_row_too_short_to_hold_the_countdown() {
    let mut conn = connection(&["btcusdt"]);
    let frame = json!({ "type": "fund_rates", "timestamp": 1791572349001_i64, "data": [["btcusdt", "1", "1", "0", "0"]] });

    assert!(venue().handle(frame.to_string().as_bytes(), &mut conn).is_err());
}

// Prints every frame of a few streams, cut to three levels a side, and the field counts of each fund_rate row.
// cargo test hotcoin::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(PUBLIC_URL).await.unwrap();
    let list = std::env::var("CAPTURE_MARKETS").unwrap_or_else(|_| "btcusdt,1000pepeusdt,btcusdc,qcomusdt,nopeusdt,BTCUSDT".to_string());
    let kinds = std::env::var("CAPTURE_KINDS").unwrap_or_else(|_| "depth,fund_rate".to_string());
    for kind in kinds.split(',') {
        for code in list.split(',') {
            let mut params = json!({ "biz": "perpetual", "type": kind, "contractCode": code, "zip": false, "serialize": false });
            if code == "-" {
                params.as_object_mut().unwrap().remove("contractCode");
            }
            ws.send(Message::text(json!({ "event": "subscribe", "params": params }).to_string())).await.unwrap();
        }
    }
    ws.send(Message::text(r#"{"event":"ping"}"#)).await.unwrap();
    ws.send(Message::text(r#"{"event":"nope"}"#)).await.unwrap();

    let seconds: u64 = std::env::var("CAPTURE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(8);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    let mut seen: HashMap<String, usize> = HashMap::new();
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let mut value: Value = serde_json::from_str(text.as_str()).unwrap();
        let key = format!("{}/{}", value["type"].as_str().unwrap_or(""), value["contractCode"].as_str().unwrap_or(""));
        let count = seen.entry(key).or_default();
        *count += 1;
        if *count > 2 {
            continue;
        }
        for side in ["bids", "asks"] {
            if let Some(levels) = value["data"].get_mut(side).and_then(Value::as_array_mut) {
                print!("{side} {} ", levels.len());
                levels.truncate(3);
            }
        }
        if value["type"] == "fund_rates" {
            if let Some(rows) = value["data"].as_array_mut() {
                print!("rows {} ", rows.len());
                rows.truncate(3);
            }
        }
        println!("{} {value}", crate::clock::now_ms());
    }
    println!("{seen:?}");
}
