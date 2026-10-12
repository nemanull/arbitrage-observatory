// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    testing::market(ID, raw_market_id, raw_market_id.strip_suffix("USDT").unwrap(), "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}USDT")));
    }
    markets
}

fn venue() -> Uzx {
    Uzx::new(&[])
}

fn connection(raw_ids: &[&str]) -> Connection<State> {
    let mut list = Vec::with_capacity(raw_ids.len());
    for id in raw_ids {
        list.push(market(id));
    }
    Connection::for_test("uzx#swap#0", list)
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

fn book(symbol: &str, seq_id: u64, id: u64, ts: u64, bids: Value, asks: Value) -> Value {
    json!({
        "asks": asks, "bids": bids, "id": id, "interval": "0", "product_name": symbol, "seqId": seq_id, "ts": ts,
        "type": format!("swap.{symbol}.orderBook"), "version": id,
    })
}

// Frames captured live on 2026-10-09, cut to three of their 28 to 85 levels a side.
fn xau_frame() -> Value {
    book(
        "XAUUSDT",
        144720880,
        5971902106,
        1791570631815,
        json!([["4201.91", "11310"], ["4201.9", "2139"], ["4201.89", "2215"]]),
        json!([["4201.99", "13547"], ["4202", "2188"], ["4202.01", "2774"]]),
    )
}

fn xau_later_frame() -> Value {
    book(
        "XAUUSDT",
        144720890,
        5971902106,
        1791570631916,
        json!([["4201.91", "11310"], ["4201.9", "2139"], ["4201.89", "2215"]]),
        json!([["4201.99", "9078"], ["4202", "416"], ["4202.01", "1506"]]),
    )
}

fn sats_frame(seq_id: u64) -> Value {
    book(
        "1000SATSUSDT",
        seq_id,
        5971902105,
        1791570631635,
        json!([["0.00001148", "3624564459"], ["0.00001147", "1322580644"], ["0.00001146", "184991273"]]),
        json!([["0.00001155", "937445887"], ["0.00001156", "278546712"], ["0.00001158", "947576424"]]),
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
fn puts_60_contracts_on_each_connection_to_the_one_public_endpoint() {
    let plans = venue().plan(&markets(130));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["uzx#swap#0", "uzx#swap#1", "uzx#swap#2"]);
    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [60, 60, 10]);
    assert!(plans.iter().all(|plan| plan.url == "wss://stream.uzx.com/notification/ws"));
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe and settings

#[test]
fn subscribes_each_contract_to_the_exact_book_in_its_own_plain_json_frame() {
    let frames = venue().subscribe_frames(&[market("BTCUSDT"), market("XAUUSDT")], &mut State::default());

    let parsed: Vec<Value> = frames.iter().map(parsed).collect();
    assert_eq!(
        parsed,
        [
            json!({ "event": "sub", "params": { "biz": "market", "type": "swap.orderbook", "symbol": "BTCUSDT", "interval": "0" }, "zip": false }),
            json!({ "event": "sub", "params": { "biz": "market", "type": "swap.orderbook", "symbol": "XAUUSDT", "interval": "0" }, "zip": false }),
        ]
    );
}

#[test]
fn leaves_the_keepalive_to_the_server_ends_a_socket_silent_for_ten_seconds_and_staggers_the_opens() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, None);
    assert_eq!(settings.max_silence, Duration::from_secs(10));
    assert_eq!(settings.connect_stagger, Duration::from_secs(1));
    assert!(settings.headers.is_empty());
}

// keepalive

#[test]
fn answers_the_server_ping_with_a_pong_of_the_same_number() {
    let mut conn = connection(&["XAUUSDT"]);

    let published = send(&mut conn, json!({ "ping": 1791570636575u64 }));

    assert!(published.is_empty());
    let sent = conn.take_sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(parsed(&sent[0]), json!({ "pong": 1791570636575u64 }));
}

#[test]
fn takes_the_opening_pong_the_change_notice_and_an_accepted_subscribe_quietly() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["XAUUSDT"]);

    // The first three frames of a socket opened on 2026-10-09, and the contract notice of 2026-09-23.
    send(&mut conn, json!({ "pong": "1791570631589" }));
    send(&mut conn, json!({ "data": null, "id": "change", "interval": "", "status": "ok", "symbol": "", "ts": 1791521978837u64, "type": "change.app-config.config" }));
    send(&mut conn, json!({ "event": "subscribe", "id": "", "status": "ok", "topic": "swap.XAUUSDT.depth.step0" }));
    send(&mut conn, json!({ "data": null, "id": "change", "interval": "", "status": "ok", "symbol": "ICPUSDT", "ts": 1790145085846u64, "type": "change.swap.config" }));

    assert!(conn.take_sent().is_empty());
    assert!(logs.lines().iter().all(|line| line.level > Level::WARN), "{:?}", logs.lines());
    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 2);
    assert_eq!(notices[1].text("kind"), "change.swap.config");
    assert_eq!(notices[1].text("market"), "ICPUSDT");
}

// books

#[test]
fn hands_the_engine_the_book_of_a_subscribed_contract_in_contracts() {
    let mut conn = connection(&["XAUUSDT", "1000SATSUSDT"]);

    let published = send(&mut conn, xau_frame());

    assert_eq!(
        published,
        [(
            "XAUUSDT".to_string(),
            levels(&[(4201.91, 11310.0), (4201.9, 2139.0), (4201.89, 2215.0)]),
            levels(&[(4201.99, 13547.0), (4202.0, 2188.0), (4202.01, 2774.0)]),
        )]
    );
    assert!(!conn.resync_requested());
}

#[test]
fn replaces_the_whole_book_on_every_push() {
    let mut conn = connection(&["XAUUSDT"]);
    send(&mut conn, xau_frame());

    let fewer = book("XAUUSDT", 144720891, 5971902107, 1791570632016, json!([["4201.9", "1"]]), xau_later_frame()["asks"].clone());
    send(&mut conn, xau_later_frame());
    let published = send(&mut conn, fewer);

    assert_eq!(published[0].1, levels(&[(4201.9, 1.0)]));
    assert_eq!(published[0].2, levels(&[(4201.99, 9078.0), (4202.0, 416.0), (4202.01, 1506.0)]));
    assert!(!conn.resync_requested());
}

#[test]
fn keeps_only_the_first_levels_the_engine_holds_of_a_deep_side() {
    let mut conn = connection(&["XAUUSDT"]);
    let mut bids = Vec::new();
    let mut asks = Vec::new();
    for i in 0..DEPTH_LEVEL + 30 {
        bids.push(json!([format!("{}", 4200 - i), "1"]));
        asks.push(json!([format!("{}", 4201 + i), "2"]));
    }

    let published = send(&mut conn, book("XAUUSDT", 1, 1, 1, json!(bids), json!(asks)));

    assert_eq!(published[0].1.len(), DEPTH_LEVEL);
    assert_eq!(published[0].1[0], BookLevel { price: 4200.0, size: 1.0 });
    assert_eq!(published[0].2.len(), DEPTH_LEVEL);
    assert_eq!(published[0].2[DEPTH_LEVEL - 1], BookLevel { price: (4200 + DEPTH_LEVEL) as f64, size: 2.0 });
}

#[test]
fn publishes_a_repeated_book_as_a_sign_of_life() {
    let mut conn = connection(&["1000SATSUSDT"]);
    send(&mut conn, sats_frame(306968707));

    assert_eq!(send(&mut conn, sats_frame(306968707)).len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn drops_a_book_older_than_the_last_and_resubscribes() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["1000SATSUSDT"]);
    send(&mut conn, sats_frame(306968707));

    assert!(send(&mut conn, sats_frame(306968692)).is_empty());

    let older = logs.events("book_frame_older");
    assert_eq!(older.len(), 1);
    assert_eq!(older[0].number("seq_id"), 306968692.0);
    assert_eq!(older[0].number("last"), 306968707.0);
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_went_back");
}

#[test]
fn applies_a_book_with_no_seq_id_and_keeps_the_last_one_for_the_next() {
    let mut conn = connection(&["XAUUSDT"]);
    send(&mut conn, xau_later_frame());

    let mut bare = xau_frame();
    bare.as_object_mut().unwrap().remove("seqId");
    assert_eq!(send(&mut conn, bare).len(), 1);

    assert!(send(&mut conn, xau_frame()).is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn reads_a_null_or_missing_side_as_empty() {
    let mut conn = connection(&["XAUUSDT"]);

    let published = send(&mut conn, json!({ "bids": null, "asks": [["4201.99", "9078"]], "product_name": "XAUUSDT", "seqId": 1 }));
    assert_eq!(published[0].1, []);
    assert_eq!(published[0].2, levels(&[(4201.99, 9078.0)]));

    let published = send(&mut conn, json!({ "bids": [["4201.91", "11310"]], "product_name": "XAUUSDT", "seqId": 2 }));
    assert_eq!(published[0].1, levels(&[(4201.91, 11310.0)]));
    assert_eq!(published[0].2, []);
}

#[test]
fn ignores_a_contract_this_connection_did_not_subscribe() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["XAUUSDT"]);

    assert!(send(&mut conn, sats_frame(1)).is_empty());

    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "1000SATSUSDT");
}

// errors

#[test]
fn logs_a_refused_subscribe_as_a_venue_error() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["XAUUSDT"]);

    // The refusals of an unknown symbol, an unknown channel and step 4, captured live on 2026-10-09.
    send(&mut conn, json!({ "event": "subscribe", "id": "", "status": "error", "topic": "swap.NOPEUSDT.depth.step0" }));
    send(&mut conn, json!({ "event": "subscribe", "id": "", "status": "error", "topic": "" }));
    send(&mut conn, json!({ "event": "subscribe", "id": "", "status": "error", "topic": "swap.ETHUSDT.depth.step4" }));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 3);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "uzx#swap#0");
    assert_eq!(errors[0].text("topic"), "swap.NOPEUSDT.depth.step0");
    assert_eq!(errors[2].text("topic"), "swap.ETHUSDT.depth.step4");
}

#[test]
fn logs_an_unsubscribe_answer_and_an_unknown_frame_as_notices() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["XAUUSDT"]);

    send(&mut conn, json!({ "id": "", "event": "unsubbed", "topic": "swap.BTCUSDT.depth.step0", "status": "ok" }));
    send(&mut conn, json!({ "type": "swap.BTCUSDT.ticker", "product_name": "BTCUSDT", "data": {} }));
    send(&mut conn, json!({ "code": 100429, "msg": "Too many requests" }));

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 3);
    assert_eq!(notices[0].text("op"), "unsubbed");
    assert_eq!(notices[1].text("kind"), "swap.BTCUSDT.ticker");
    assert_eq!(notices[2].text("kind"), "");
    assert!(notices[2].text("frame").contains("100429"), "{:?}", notices[2]);
    assert!(logs.events("venue_error").is_empty());
}

#[test]
fn reports_a_frame_that_is_not_json_or_holds_a_bad_level() {
    let mut conn = connection(&["XAUUSDT"]);

    assert!(venue().handle(b"not json", &mut conn).is_err());
    assert!(venue().handle(br#"{"product_name":"XAUUSDT","bids":[["1"]],"asks":[]}"#, &mut conn).is_err());
    assert!(conn.take_published().is_empty());
}

// A probe of the live socket, which prints each frame with its levels cut to three a side:
// cargo test uzx::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(PUBLIC_URL).await.unwrap();
    let subscribe = |symbol: &str, channel: &str, interval: &str| {
        let frame = json!({ "event": "sub", "params": { "biz": "market", "type": channel, "symbol": symbol, "interval": interval }, "zip": false });
        Message::text(frame.to_string())
    };
    for symbol in ["XAUUSDT", "1000SATSUSDT", "NOPEUSDT", "LISTAUSDT"] {
        ws.send(subscribe(symbol, BOOK_CHANNEL, BOOK_STEP)).await.unwrap();
    }
    ws.send(subscribe("BTCUSDT", "swap.nope", "0")).await.unwrap();
    ws.send(subscribe("ETHUSDT", BOOK_CHANNEL, "4")).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(12);
    let mut books = 0;
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let mut value: Value = serde_json::from_str(text.as_str()).unwrap();
        if let Some(ping) = value.get("ping") {
            println!("{value}");
            ws.send(Message::text(json!({ "pong": ping }).to_string())).await.unwrap();
            continue;
        }
        if value.get("bids").is_some() {
            books += 1;
            if books > 6 {
                continue;
            }
            for side in ["bids", "asks"] {
                if let Some(levels) = value[side].as_array_mut() {
                    println!("{side} {}", levels.len());
                    levels.truncate(3);
                }
            }
        }
        println!("{value}");
    }
    println!("{books} book frames");
}
