// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use flate2::Compression;
use flate2::write::ZlibEncoder;
use serde_json::{Value, json};
use std::io::Write;
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    testing::market(ID, raw_market_id, raw_market_id.trim_end_matches("USDTPERP"), "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}USDTPERP")));
    }
    markets
}

fn venue() -> Digifinex {
    Digifinex::new(&[])
}

fn connection(raw_ids: &[&str]) -> Connection<()> {
    let mut list = Vec::with_capacity(raw_ids.len());
    for id in raw_ids {
        list.push(market(id));
    }
    Connection::for_test("digifinex#perp#0", list)
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

fn zlib(text: &[u8]) -> Vec<u8> {
    let mut encoder = ZlibEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(text).unwrap();
    encoder.finish().unwrap()
}

// Every frame arrives as binary zlib, so each case sends what the socket sends.
fn send(conn: &mut Connection<()>, frame: Value) -> Published {
    venue().handle(&zlib(frame.to_string().as_bytes()), conn).unwrap();
    conn.take_published()
}

// The snapshot and the next two deltas of BTCUSDTPERP captured live on 2026-10-09, cut to three levels a side.
fn btc_snapshot() -> Value {
    json!({
        "data": {
            "asks": [["82604.1", 301], ["82604.2", 11789], ["82604.5", 15552]],
            "bids": [["82604.0", 2039], ["82603.9", 722], ["82603.8", 10382]],
            "instrument_id": "BTCUSDTPERP", "level": 20, "timestamp": 1791567968806_i64,
        },
        "event": "depth.update", "full_data": true,
    })
}

fn delta(symbol: &str, bids: Value, asks: Value) -> Value {
    json!({
        "data": { "asks": asks, "bids": bids, "instrument_id": symbol, "level": 20, "timestamp": 1791567969264_i64 },
        "event": "depth.update",
    })
}

fn snapshot_of(symbol: &str, bids: Value, asks: Value) -> Value {
    let mut frame = delta(symbol, bids, asks);
    frame["full_data"] = json!(true);
    frame
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// plan, subscribe frames, ping and settings

#[test]
fn puts_25_contracts_on_each_connection_to_the_one_swap_endpoint() {
    let plans = venue().plan(&markets(103));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["digifinex#perp#0", "digifinex#perp#1", "digifinex#perp#2", "digifinex#perp#3", "digifinex#perp#4"]);
    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [25, 25, 25, 25, 3]);
    assert!(plans.iter().all(|plan| plan.url == "wss://openapi.digifinex.com/swap_ws/v2/"));
    assert!(venue().plan(&[]).is_empty());
}

#[test]
fn subscribes_each_contract_in_its_own_frame_at_20_levels_with_its_position_as_the_id() {
    let frames = venue().subscribe_frames(&markets(2), &mut ());

    assert_eq!(
        frames.iter().map(parsed).collect::<Vec<_>>(),
        [
            json!({ "id": 1, "event": "depth.subscribe", "instrument_ids": ["SYM0USDTPERP"], "level": 20 }),
            json!({ "id": 2, "event": "depth.subscribe", "instrument_ids": ["SYM1USDTPERP"], "level": 20 }),
        ]
    );
}

#[test]
fn pings_every_20_seconds_with_an_id_the_server_accepts_and_retires_the_socket_before_a_day() {
    let settings = venue().settings();

    assert_eq!(parsed(&venue().ping(&mut ())), json!({ "id": 1_000_000, "event": "server.ping" }));
    assert_eq!(settings.ping_every, Some(Duration::from_secs(20)));
    assert_eq!(settings.max_silence, Duration::from_secs(60));
    assert_eq!(settings.retire_after, Some(Duration::from_secs(23 * 60 * 60)));
}

// snapshot and delta

#[test]
fn replaces_the_book_on_a_full_data_frame() {
    let mut conn = connection(&["BTCUSDTPERP"]);

    let published = send(&mut conn, btc_snapshot());

    assert_eq!(
        published,
        [(
            "BTCUSDTPERP".to_string(),
            levels(&[(82604.0, 2039.0), (82603.9, 722.0), (82603.8, 10382.0)]),
            levels(&[(82604.1, 301.0), (82604.2, 11789.0), (82604.5, 15552.0)]),
        )]
    );
}

#[test]
fn applies_a_delta_by_price_where_bids_arrive_worst_first_and_zero_deletes() {
    let mut conn = connection(&["BTCUSDTPERP"]);
    send(&mut conn, btc_snapshot());

    let published = send(
        &mut conn,
        delta("BTCUSDTPERP", json!([["82603.8", 0], ["82603.9", 900], ["82604.0", 0]]), json!([["82604.2", 0], ["82676.3", 4968]])),
    );

    assert_eq!(
        published,
        [(
            "BTCUSDTPERP".to_string(),
            levels(&[(82603.9, 900.0)]),
            levels(&[(82604.1, 301.0), (82604.5, 15552.0), (82676.3, 4968.0)]),
        )]
    );
}

#[test]
fn applies_a_delta_with_one_empty_side() {
    let mut conn = connection(&["BTCUSDTPERP"]);
    send(&mut conn, btc_snapshot());

    let published = send(&mut conn, delta("BTCUSDTPERP", json!([]), json!([["82604.1", 108]])));

    assert_eq!(published[0].2[0], BookLevel { price: 82604.1, size: 108.0 });
    assert_eq!(published[0].1.len(), 3);
}

#[test]
fn a_second_snapshot_replaces_the_book_rather_than_merging() {
    let mut conn = connection(&["BTCUSDTPERP"]);
    send(&mut conn, btc_snapshot());

    let published = send(&mut conn, snapshot_of("BTCUSDTPERP", json!([["82500.0", 1]]), json!([["82501.0", 2]])));

    assert_eq!(published, [("BTCUSDTPERP".to_string(), levels(&[(82500.0, 1.0)]), levels(&[(82501.0, 2.0)]))]);
}

#[test]
fn keeps_the_20_best_levels_of_a_side() {
    let mut conn = connection(&["BTCUSDTPERP"]);
    let mut bids = Vec::new();
    let mut asks = Vec::new();
    for i in 0..22 {
        bids.push(json!([format!("{}", 100 - i), 1]));
        asks.push(json!([format!("{}", 101 + i), 1]));
    }
    send(&mut conn, snapshot_of("BTCUSDTPERP", json!(bids), json!(asks)));

    let published = send(&mut conn, delta("BTCUSDTPERP", json!([["99.5", 3]]), json!([])));

    assert_eq!(published[0].1.len(), 20);
    assert_eq!(published[0].1[19].price, 82.0);
    assert_eq!(published[0].2.len(), 20);
    assert_eq!(published[0].2[19].price, 120.0);
}

// faults that the stream can show

#[test]
fn resyncs_on_a_delta_before_any_snapshot() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDTPERP"]);

    let published = send(&mut conn, delta("BTCUSDTPERP", json!([["82604.0", 1]]), json!([])));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn resyncs_without_publishing_when_a_delta_crosses_the_top() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDTPERP"]);
    send(&mut conn, btc_snapshot());

    let published = send(&mut conn, delta("BTCUSDTPERP", json!([["82604.3", 5]]), json!([])));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "crossed_book");
}

#[test]
fn resyncs_without_publishing_on_a_crossed_snapshot() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDTPERP"]);

    let published = send(&mut conn, snapshot_of("BTCUSDTPERP", json!([["82605", 1]]), json!([["82604", 1]])));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "crossed_book");
}

#[test]
fn resyncs_on_a_level_it_cannot_read() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDTPERP"]);
    send(&mut conn, btc_snapshot());

    let published = send(&mut conn, delta("BTCUSDTPERP", json!([["-", 5]]), json!([])));

    assert!(published.is_empty());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn resyncs_without_publishing_on_a_snapshot_with_a_level_it_cannot_read() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDTPERP"]);

    let published = send(&mut conn, snapshot_of("BTCUSDTPERP", json!([["82604.0", 1], ["", 2]]), json!([["82604.1", 1]])));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn reads_a_frame_that_arrives_without_zlib() {
    let mut conn = connection(&["BTCUSDTPERP"]);

    venue().handle(btc_snapshot().to_string().as_bytes(), &mut conn).unwrap();

    assert_eq!(conn.take_published().len(), 1);
}

#[test]
fn resyncs_the_connection_on_a_frame_that_does_not_inflate_or_a_book_frame_that_does_not_parse() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDTPERP"]);
    assert!(venue().handle(&[0x78, 0xda, 0xff, 0xff, 0xff, 0xff], &mut conn).is_err());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "frame_unreadable");

    let mut conn = connection(&["BTCUSDTPERP"]);
    let cut = &br#"{"event":"depth.update","data":{"instrument_id":"BTCUSDTPERP","bids":[["1""#[..];
    assert!(venue().handle(&zlib(cut), &mut conn).is_err());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[1].text("reason"), "book_frame_unreadable");

    let mut conn = connection(&["BTCUSDTPERP"]);
    assert!(venue().handle(&zlib(b"not json"), &mut conn).is_err());
    assert!(!conn.resync_requested());
}

#[test]
fn ignores_a_contract_the_connection_did_not_subscribe() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDTPERP"]);

    let published = send(&mut conn, snapshot_of("NOPEUSDTPERP", json!([["1", 1]]), json!([["2", 1]])));

    assert!(published.is_empty());
    assert!(!conn.resync_requested());
    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "NOPEUSDTPERP");
}

// replies

#[test]
fn takes_an_acknowledgement_and_a_pong_quietly() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDTPERP"]);

    // Both captured live on 2026-10-09.
    send(&mut conn, json!({ "code": 1, "event": "depth.subscribe", "id": 1, "msg": "success" }));
    send(&mut conn, json!({ "code": 1, "data": "pong", "event": "server.ping", "id": 1_000_000, "msg": "success" }));

    assert!(logs.lines().iter().all(|line| line.level > Level::WARN), "{:?}", logs.lines());
    assert!(conn.take_sent().is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn logs_a_refused_subscribe_with_the_market_its_id_names() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDTPERP", "XAUTUSDTPERP"]);

    // Captured live on 2026-10-09, an unknown contract and a repeated subscribe.
    send(&mut conn, json!({ "code": 2, "event": "depth.subscribe", "id": 2, "msg": "invalid param" }));
    send(&mut conn, json!({ "code": 5, "event": "depth.subscribe", "id": 1, "msg": "repeat subscribe" }));
    send(&mut conn, json!({ "code": 2, "event": "", "msg": "invalid param" }));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 3);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!((errors[0].text("market"), errors[0].number("code")), ("XAUTUSDTPERP", 2.0));
    assert_eq!(errors[0].text("message"), "invalid param");
    assert_eq!(errors[0].text("connection"), "digifinex#perp#0");
    assert_eq!((errors[1].text("market"), errors[1].number("code")), ("BTCUSDTPERP", 5.0));
    assert_eq!(errors[2].text("market"), "");
    assert!(!conn.resync_requested());
}

// A probe of the live socket, which sends each frame of CAPTURE_FRAMES split on | and prints what comes back, levels cut to three a side:
// CAPTURE_FRAMES='{"id":1,"event":"depth.subscribe","instrument_ids":["BTCUSDTPERP"],"level":20}' cargo test digifinex::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(PUBLIC_URL).await.unwrap();
    let frames = std::env::var("CAPTURE_FRAMES").unwrap();
    for frame in frames.split('|') {
        ws.send(Message::text(frame.to_string())).await.unwrap();
    }

    let seconds: u64 = std::env::var("CAPTURE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(4);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    let mut seen: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    while let Ok(Some(message)) = tokio::time::timeout_at(deadline, ws.next()).await {
        let message = match message {
            Ok(message) => message,
            Err(error) => {
                println!("error {error}");
                break;
            }
        };
        let Message::Binary(bytes) = message else {
            println!("other {message:?}");
            continue;
        };
        let text = wire::inflate(&bytes).unwrap();
        let mut value: Value = serde_json::from_slice(&text).unwrap();
        let key = format!("{}{}", value["event"], value.pointer("/data/instrument_id").unwrap_or(&Value::Null));
        let count = seen.entry(key).or_default();
        *count += 1;
        if value["data"].is_object() && *count > 3 {
            continue;
        }
        for side in ["bids", "asks"] {
            if let Some(levels) = value.pointer_mut(&format!("/data/{side}")).and_then(Value::as_array_mut) {
                print!("{side} {} ", levels.len());
                levels.truncate(3);
            }
        }
        println!("{value}");
    }
    println!("counts {seen:?}");
}
