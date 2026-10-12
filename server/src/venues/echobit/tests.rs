// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use std::time::Duration;
use tokio_tungstenite::tungstenite::Message;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.split('-').next().unwrap();
    testing::market(ID, raw_market_id, base, "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    (0..count).map(|i| market(&format!("SYM{i}-SWAP-USDT"))).collect()
}

fn venue() -> Echobit {
    Echobit::new(&[])
}

fn connection() -> Connection<State> {
    Connection::for_test("echobit#swap#0", vec![market("BTC-SWAP-USDT"), market("IRYS-SWAP-USDT")])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    pairs.iter().map(|&(price, size)| BookLevel { price, size }).collect()
}

// Book frames captured live on 2026-10-09, with each side cut to three levels.
fn btc_book(v: &str) -> Value {
    json!({"data":[{"a":[["82438","265576"],["82438.1","27857"],["82438.2","28899"]],"b":[["82437.7","152358"],["82437.6","28703"],["82437.5","27846"]],"o":0,"s":"BTC-SWAP-USDT","t":1791573947730_i64,"v":v}],"id":"depth.BTC-SWAP-USDT","params":{"realtimeInterval":"24h"},"sendTime":1791573948200_i64,"symbol":"BTC-SWAP-USDT","symbolName":"BTC-SWAP-USDT","topic":"depth"})
}

// The push 0.5 s later, whose best bid level is gone.
fn btc_next_book() -> Value {
    json!({"data":[{"a":[["82438","120567"],["82438.1","27857"],["82438.2","28899"]],"b":[["82437.6","28703"],["82435.1","151912"],["82433.9","143773"]],"o":0,"s":"BTC-SWAP-USDT","t":1791573948704_i64,"v":"127297530_18"}],"id":"depth.BTC-SWAP-USDT","params":{"realtimeInterval":"24h"},"sendTime":1791573948830_i64,"symbol":"BTC-SWAP-USDT","symbolName":"BTC-SWAP-USDT","topic":"depth"})
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
fn puts_64_markets_on_each_socket() {
    let plans = venue().plan(&markets(126));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [64, 62]);
    assert_eq!(plans[0].id, "echobit#swap#0");
    assert_eq!(plans[1].id, "echobit#swap#1");
    assert_eq!(plans[0].url, "wss://uapi.echobit.com/uapi/exchange/ws");
}

#[test]
fn pings_every_20_seconds_and_ends_a_socket_silent_for_45() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(20)));
    assert_eq!(settings.max_silence, Duration::from_secs(45));
}

#[test]
fn the_ping_is_a_json_frame_with_the_clock() {
    let ping = parsed(&venue().ping(&mut State::default()));

    assert!(ping["ping"].as_i64().unwrap() > 1_791_000_000_000);
}

// subscribe_frames

#[test]
fn subscribes_each_book_then_the_mark_and_index_klines_of_each_index_id_one_symbol_per_frame() {
    let frames: Vec<Value> = venue()
        .subscribe_frames(&[market("BTC-SWAP-USDT"), market("1000PEPE-SWAP-USDT")], &mut State::default())
        .iter()
        .map(parsed)
        .collect();

    assert_eq!(
        frames,
        [
            json!({"id":"depth.BTC-SWAP-USDT","topic":"depth","event":"sub","symbol":"BTC-SWAP-USDT","params":{}}),
            json!({"id":"depth.1000PEPE-SWAP-USDT","topic":"depth","event":"sub","symbol":"1000PEPE-SWAP-USDT","params":{}}),
            json!({"id":"markKline_1m.BTCUSDT","topic":"markKline_1m","event":"sub","symbol":"BTCUSDT","params":{}}),
            json!({"id":"markKline_1m.1000PEPEUSDT","topic":"markKline_1m","event":"sub","symbol":"1000PEPEUSDT","params":{}}),
            json!({"id":"indexKline_1m.BTCUSDT","topic":"indexKline_1m","event":"sub","symbol":"BTCUSDT","params":{}}),
            json!({"id":"indexKline_1m.1000PEPEUSDT","topic":"indexKline_1m","event":"sub","symbol":"1000PEPEUSDT","params":{}}),
        ]
    );
}

#[test]
fn the_index_id_is_the_raw_id_without_its_swap_infix() {
    assert_eq!(index_id("BTC-SWAP-USDT"), "BTCUSDT");
    assert_eq!(index_id("1000PEPE-SWAP-USDT"), "1000PEPEUSDT");
}

// handle: books

#[test]
fn hands_the_engine_each_push_as_the_whole_book() {
    let mut conn = connection();

    let published = send(&mut conn, btc_book("127297517_18"));

    assert_eq!(
        published,
        [(
            "BTC-SWAP-USDT".to_string(),
            levels(&[(82437.7, 152358.0), (82437.6, 28703.0), (82437.5, 27846.0)]),
            levels(&[(82438.0, 265576.0), (82438.1, 27857.0), (82438.2, 28899.0)]),
        )]
    );
}

#[test]
fn a_later_push_replaces_the_book_so_a_level_it_lacks_is_gone() {
    let mut conn = connection();
    send(&mut conn, btc_book("127297517_18"));

    let published = send(&mut conn, btc_next_book());

    assert_eq!(published[0].1, levels(&[(82437.6, 28703.0), (82435.1, 151912.0), (82433.9, 143773.0)]));
    assert_eq!(published[0].2[0], BookLevel { price: 82438.0, size: 120567.0 });
}

#[test]
fn keeps_the_first_20_levels_of_a_side_of_200() {
    let mut conn = connection();
    let mut frame = btc_book("127297517_18");
    let bids: Vec<Value> = (0..200).map(|i| json!([format!("{}", 82437.7 - i as f64 * 0.1), "1000"])).collect();
    frame["data"][0]["b"] = json!(bids);

    let published = send(&mut conn, frame);

    assert_eq!(published[0].1.len(), 20);
    assert_eq!(published[0].2.len(), 3);
}

#[test]
fn a_push_with_the_same_version_still_replaces_the_book_as_after_a_cut_first_push() {
    let mut conn = connection();
    let mut cut = btc_book("127297517_18");
    cut["data"][0]["b"] = json!([["82437.7","152358"]]);
    cut["data"][0]["a"] = json!([["82438","265576"]]);
    send(&mut conn, cut);

    let published = send(&mut conn, btc_book("127297517_18"));

    assert_eq!(published[0].1.len(), 3);
}

#[test]
fn a_version_that_goes_back_resyncs_without_publishing() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_next_book());

    let published = send(&mut conn, btc_book("127297517_18"));

    assert!(published.is_empty());
    let resyncs = logs.events("book_resync");
    assert_eq!(resyncs.len(), 1);
    assert_eq!(resyncs[0].text("reason"), "version_went_back");
}

#[test]
fn the_books_of_two_markets_keep_their_own_versions() {
    let mut conn = connection();
    send(&mut conn, btc_next_book());
    let mut irys = btc_book("1431305_18");
    irys["symbol"] = json!("IRYS-SWAP-USDT");
    irys["data"][0]["s"] = json!("IRYS-SWAP-USDT");

    let published = send(&mut conn, irys);

    assert_eq!(published[0].0, "IRYS-SWAP-USDT");
}

#[test]
fn ignores_a_book_of_a_market_not_on_this_connection() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let mut eth = btc_book("1_18");
    eth["symbol"] = json!("ETH-SWAP-USDT");

    assert!(send(&mut conn, eth).is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

#[test]
fn a_kline_publishes_no_book() {
    let mut conn = connection();
    let kline = json!({"data":[{"c":"82474.8","h":"82506","l":"82472.5","o":"82506","s":"BTCUSDT","sn":"BTCUSDT","t":1791573900000_i64,"v":"0"}],"id":"indexKline_1m.BTCUSDT","params":{"klineType":"1m","realtimeInterval":"24h"},"sendTime":1791573948202_i64,"symbol":"BTCUSDT","symbolName":"BTCUSDT","topic":"indexKline"});

    assert!(send(&mut conn, kline).is_empty());
}

// handle: errors and keepalive

#[test]
fn logs_an_error_frame_as_a_venue_error_and_carries_on() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, json!({"code":"-100010","desc":"Invalid Symbols!"}));
    let published = send(&mut conn, btc_book("127297517_18"));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].text("code"), "-100010");
    assert_eq!(errors[0].text("desc"), "Invalid Symbols!");
    assert_eq!(published.len(), 1);
}

#[test]
fn takes_the_pong_silently_and_logs_any_other_frame_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, json!({"pong":1791573948203_i64}));
    assert!(logs.events("venue_notice").is_empty());

    send(&mut conn, json!({"event":"maintenance"}));
    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 1);
    assert!(notices[0].text("frame").contains("maintenance"), "{:?}", notices[0]);
}

#[test]
fn reports_a_frame_that_is_not_json_without_resyncing() {
    let mut conn = connection();

    assert!(venue().handle(b"not json", &mut conn).is_err());

    assert!(!conn.resync_requested());
}

#[test]
fn a_book_push_that_cannot_be_parsed_resyncs_since_the_last_book_would_stay_published() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_book("127297517_18"));
    let mut bad = btc_next_book();
    bad["data"][0]["b"] = json!([["82437.6"]]);

    assert!(venue().handle(bad.to_string().as_bytes(), &mut conn).is_err());

    assert!(conn.take_published().is_empty());
    let resyncs = logs.events("book_resync");
    assert_eq!(resyncs.len(), 1);
    assert_eq!(resyncs[0].text("reason"), "book_frame_unreadable");
    assert_eq!(resyncs[0].text("market"), "BTC-SWAP-USDT");
}

#[test]
fn a_book_push_with_a_level_the_book_would_skip_resyncs() {
    for level in [json!(["", "28703"]), json!([null, "28703"]), json!(["82437.6", "-1"])] {
        let (logs, _capture) = capture();
        let mut conn = connection();
        let mut bad = btc_next_book();
        bad["data"][0]["b"][0] = level.clone();

        let published = send(&mut conn, bad);

        assert!(published.is_empty(), "{level}");
        assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable", "{level}");
    }
}

#[test]
fn a_book_push_without_a_side_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let mut bad = btc_next_book();
    bad["data"][0].as_object_mut().unwrap().remove("a");

    let published = send(&mut conn, bad);

    assert!(published.is_empty());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "book_side_missing");
}

#[test]
fn a_book_push_with_an_empty_side_is_published_as_the_whole_book() {
    let mut conn = connection();
    let mut frame = btc_next_book();
    frame["data"][0]["a"] = json!([]);

    let published = send(&mut conn, frame);

    assert_eq!(published[0].1.len(), 3);
    assert!(published[0].2.is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn logs_an_error_frame_with_a_numeric_code_as_a_venue_error() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, json!({"code":-10001,"desc":"Invalid JSON!"}));

    assert_eq!(logs.events("venue_error")[0].text("code"), "-10001");
}

// A probe of the live socket, which prints each frame with its levels cut to three a side:
// cargo test echobit::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(MARKET_URL).await.unwrap();
    let sub = |topic: &str, symbol: &str| {
        let frame = json!({ "id": format!("{topic}.{symbol}"), "topic": topic, "event": "sub", "symbol": symbol, "params": {} });
        Message::text(frame.to_string())
    };
    let frames = [
        sub("depth", "BTC-SWAP-USDT"),
        sub("depth", "IRYS-SWAP-USDT"),
        sub("depth", "NOPE-SWAP-USDT"),
        sub("markKline_1m", "BTCUSDT"),
        sub("indexKline_1m", "BTCUSDT"),
        sub("markKline_1m", "XAUUSDT,ETHUSDT"),
        sub("indexKline_1m", "XAUUSDT,ETHUSDT"),
        Message::text(json!({ "ping": 1791573687021_i64 }).to_string()),
        Message::text("nope"),
    ];
    for frame in frames {
        ws.send(frame).await.unwrap();
    }

    let deadline = tokio::time::Instant::now() + Duration::from_secs(15);
    let mut books = 0;
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let mut value: Value = serde_json::from_str(text.as_str()).unwrap();
        if value["topic"] == "depth" {
            books += 1;
            if books > 8 {
                continue;
            }
            if let Some(data) = value["data"].as_array_mut() {
                for row in data {
                    for side in ["b", "a"] {
                        if let Some(levels) = row[side].as_array_mut() {
                            println!("{side} {}", levels.len());
                            levels.truncate(3);
                        }
                    }
                }
            }
        }
        println!("{value}");
    }
    println!("{books} book frames");
}
