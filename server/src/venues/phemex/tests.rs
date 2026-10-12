// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    testing::market(ID, raw_market_id, raw_market_id.trim_end_matches("USDT"), "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}USDT")));
    }
    markets
}

fn venue() -> Phemex {
    Phemex::new()
}

// The order of the capture's subscribe requests, so request 3 is NOPEUSDT.
fn connection() -> Connection<HashMap<usize, i64>> {
    let markets = vec![market("BTCUSDT"), market("BTCUSDC"), market("NOPEUSDT"), market("PATHUSDT")];
    Connection::for_test("phemex#perp#0", markets)
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// Frames captured live on 2026-10-08, with the levels cut down unless a case needs all 30.
// The BTCUSDT deltas follow the BTCUSDT snapshot in the order they came.
fn btc_snapshot() -> Value {
    json!({"depth":30,"dts":1791523850546070121_u64,"mts":1791523850493512197_u64,"orderbook_p":{"asks":[["82470.2","1.424"],["82470.4","0.17"],["82470.9","0.055"]],"bids":[["82470.1","0.292"],["82468.1","0.193"],["82467.2","0.185"]]},"sequence":69540007298_i64,"symbol":"BTCUSDT","timestamp":1791523850480044853_u64,"type":"snapshot"})
}

fn btc_full_snapshot() -> Value {
    let mut frame = btc_snapshot();
    frame["orderbook_p"]["bids"] = json!([["82470.1","0.292"],["82468.1","0.193"],["82467.2","0.185"],["82467","0.487"],["82463.1","0.291"],["82460.6","0.771"],["82454.6","0.145"],["82454.5","0.045"],["82452.4","0.724"],["82451.7","2.284"],["82451.6","0.577"],["82451.4","0.072"],["82450.7","0.169"],["82450.6","2.284"],["82450.2","0.002"],["82449.7","2.284"],["82449.5","0.009"],["82448.8","0.811"],["82448.7","0.885"],["82447.6","0.006"],["82447.3","0.916"],["82435.5","0.002"],["82428.9","0.001"],["82427.8","0.002"],["82417.9","6.112"],["82417.6","5.489"],["82417.3","0.002"],["82413.8","0.009"],["82406.4","0.071"],["82402.8","0.002"]]);
    frame["orderbook_p"]["asks"] = json!([["82470.2","1.424"],["82470.4","0.17"],["82470.9","0.055"],["82474.5","2.236"],["82475","0.077"],["82476.2","2.236"],["82477.9","2.958"],["82485.1","0.045"],["82488.5","0.004"],["82490.1","0.554"],["82490.9","0.291"],["82498.4","0.006"],["82498.5","0.004"],["82500","0.349"],["82501.7","0.004"],["82502.7","0.145"],["82506.2","0.169"],["82506.3","0.611"],["82507.1","0.006"],["82510.2","0.837"],["82517.9","0.944"],["82521.7","0.004"],["82521.8","0.925"],["82526.5","0.001"],["82526.6","0.111"],["82528","5.468"],["82532.1","6.48"],["82538.1","0.007"],["82540.5","0.002"],["82540.6","0.001"]]);
    frame
}

fn btc_delta() -> Value {
    json!({"depth":30,"dts":1791523851205847844_u64,"mts":1791523851204841613_u64,"orderbook_p":{"asks":[["82477.9","0.505"]],"bids":[["82470.1","0.666"],["82467.2","0"],["82453.5","2.284"]]},"sequence":69540007560_i64,"symbol":"BTCUSDT","timestamp":1791523851201740024_u64,"type":"incremental"})
}

fn btc_asks_only_delta() -> Value {
    json!({"depth":30,"dts":1791523851143050387_u64,"mts":1791523851142322927_u64,"orderbook_p":{"asks":[["82470.2","0.931"],["82479.6","2.236"],["82542.8","0"]],"bids":[]},"sequence":69540007524_i64,"symbol":"BTCUSDT","timestamp":1791523851129706620_u64,"type":"incremental"})
}

// The periodic snapshot of the same stream 6 s later.
fn btc_periodic_snapshot() -> Value {
    json!({"depth":30,"dts":1791523856366134766_u64,"mts":1791523856287171464_u64,"orderbook_p":{"asks":[["82470.2","0.93"],["82474.7","0.179"],["82475","0.077"]],"bids":[["82470.1","0.695"],["82468.1","0.193"],["82467","0.487"]]},"sequence":69540009607_i64,"symbol":"BTCUSDT","timestamp":1791523856262353169_u64,"type":"snapshot"})
}

// The USDC-M contract on the same channel and socket, on its own sequence counter.
fn btc_usdc_snapshot() -> Value {
    json!({"depth":30,"dts":1791523850548048868_u64,"mts":1791523849029446040_u64,"orderbook_p":{"asks":[["82405","0.036"],["82417.2","0.077"]],"bids":[["82404.9","0.01"],["82404.2","0.061"]]},"sequence":13258739150_i64,"symbol":"BTCUSDC","timestamp":1791523849013298619_u64,"type":"snapshot"})
}

fn btc_usdc_delta() -> Value {
    json!({"depth":30,"dts":1791523851222269549_u64,"mts":1791523851221696149_u64,"orderbook_p":{"asks":[],"bids":[["82404.7","0.036"],["82404.2","0"]]},"sequence":13258739159_i64,"symbol":"BTCUSDC","timestamp":1791523851211148159_u64,"type":"incremental"})
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

// plan

#[test]
fn puts_50_markets_on_each_socket() {
    let plans = venue().plan(&markets(135));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [50, 50, 35]);
    assert_eq!(plans[0].id, "phemex#perp#0");
    assert_eq!(plans[2].id, "phemex#perp#2");
    assert_eq!(plans[0].url, "wss://ws.phemex.com");
}

#[test]
fn pings_every_5_seconds_paces_subscribes_and_ends_a_socket_silent_for_15() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(5)));
    assert_eq!(settings.max_silence, Duration::from_secs(15));
    assert_eq!(settings.subscribe_gap, Duration::from_millis(100));
    assert_eq!(parsed(&venue().ping(&mut HashMap::new())), json!({ "id": 0, "method": "server.ping", "params": [] }));
}

// subscribe_frames

#[test]
fn subscribes_each_market_in_its_own_frame_with_its_position_as_the_request_id() {
    let frames = venue().subscribe_frames(&markets(3), &mut HashMap::new());

    assert_eq!(frames.len(), 3);
    assert_eq!(parsed(&frames[0]), json!({ "id": 1, "method": "orderbook_p.subscribe", "params": ["SYM0USDT"] }));
    assert_eq!(parsed(&frames[2]), json!({ "id": 3, "method": "orderbook_p.subscribe", "params": ["SYM2USDT"] }));
}

// handle

#[test]
fn hands_the_engine_a_snapshot_as_the_whole_book() {
    let mut conn = connection();

    let published = send(&mut conn, btc_snapshot());

    assert_eq!(
        published,
        [(
            "BTCUSDT".to_string(),
            levels(&[(82470.1, 0.292), (82468.1, 0.193), (82467.2, 0.185)]),
            levels(&[(82470.2, 1.424), (82470.4, 0.17), (82470.9, 0.055)]),
        )]
    );
    assert_eq!(conn.state[&0], 69540007298);
}

#[test]
fn applies_deltas_by_price_and_removes_zero_levels() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());

    let first = send(&mut conn, btc_asks_only_delta());
    let second = send(&mut conn, btc_delta());

    assert_eq!(first[0].1, levels(&[(82470.1, 0.292), (82468.1, 0.193), (82467.2, 0.185)]));
    assert_eq!(first[0].2, levels(&[(82470.2, 0.931), (82470.4, 0.17), (82470.9, 0.055), (82479.6, 2.236)]));
    assert_eq!(second[0].1, levels(&[(82470.1, 0.666), (82468.1, 0.193), (82453.5, 2.284)]));
    assert_eq!(second[0].2, levels(&[(82470.2, 0.931), (82470.4, 0.17), (82470.9, 0.055), (82477.9, 0.505), (82479.6, 2.236)]));
    assert_eq!(conn.state[&0], 69540007560);
    assert!(!conn.resync_requested());
}

#[test]
fn applies_a_delta_whose_levels_come_out_of_order() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut frame = btc_delta();
    frame["orderbook_p"]["bids"] = json!([["82453.5","2.284"],["82467.2","0"],["82470.1","0.666"]]);

    let published = send(&mut conn, frame);

    assert_eq!(published[0].1, levels(&[(82470.1, 0.666), (82468.1, 0.193), (82453.5, 2.284)]));
}

#[test]
fn a_sequence_that_jumps_is_not_a_gap() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());

    // 262 numbers past the snapshot, as the shared counter moves for other symbols.
    send(&mut conn, btc_delta());

    assert!(!conn.resync_requested());
}

#[test]
fn a_delta_with_a_lower_sequence_than_the_last_applied_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_delta());

    let published = send(&mut conn, btc_asks_only_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync[0].text("market"), "BTCUSDT");
    assert_eq!(resync[0].text("reason"), "sequence_out_of_order");
}

#[test]
fn a_delta_before_any_snapshot_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(&mut conn, btc_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn a_delta_after_a_snapshot_of_another_market_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_usdc_snapshot());

    send(&mut conn, btc_delta());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("market"), "BTCUSDT");
}

#[test]
fn the_periodic_snapshot_replaces_the_book_and_moves_the_sequence() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_delta());

    let published = send(&mut conn, btc_periodic_snapshot());

    assert_eq!(published[0].1, levels(&[(82470.1, 0.695), (82468.1, 0.193), (82467.0, 0.487)]));
    assert_eq!(published[0].2, levels(&[(82470.2, 0.93), (82474.7, 0.179), (82475.0, 0.077)]));
    assert_eq!(conn.state[&0], 69540009607);
}

#[test]
fn keeps_each_usdc_book_on_its_own_sequence() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_usdc_snapshot());

    let published = send(&mut conn, btc_usdc_delta());

    assert_eq!(published[0].0, "BTCUSDC");
    assert_eq!(published[0].1, levels(&[(82404.9, 0.01), (82404.7, 0.036)]));
    assert_eq!(conn.state[&0], 69540007298);
    assert_eq!(conn.state[&1], 13258739159);
    assert!(!conn.resync_requested());
}

#[test]
fn trims_each_side_to_30_levels_after_a_delta() {
    let mut conn = connection();
    send(&mut conn, btc_full_snapshot());

    // A level inside the window with no deletion beside it, which the docs say leaves the old 30th level unmaintained.
    let mut frame = btc_asks_only_delta();
    frame["orderbook_p"] = json!({ "asks": [["82470.3","0.5"]], "bids": [["82469","0.5"]] });
    send(&mut conn, frame);

    // The engine takes the top 20, so the trim shows on the connection's own book.
    let book = conn.book(0).unwrap();
    let (bids, asks) = (book.bids(), book.asks());
    assert_eq!(bids.len(), 30);
    assert_eq!(asks.len(), 30);
    assert_eq!(bids[1], BookLevel { price: 82469.0, size: 0.5 });
    assert_eq!(bids[29].price, 82406.4);
    assert_eq!(asks[1], BookLevel { price: 82470.3, size: 0.5 });
    assert_eq!(asks[29].price, 82540.5);
}

#[test]
fn a_delta_that_crosses_the_top_resyncs_and_publishes_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());

    // A bid at the best ask, as a lost delta that removed that ask would leave it.
    let mut frame = btc_delta();
    frame["orderbook_p"] = json!({ "asks": [], "bids": [["82470.2","0.5"]] });
    let published = send(&mut conn, frame);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync[0].text("market"), "BTCUSDT");
    assert_eq!(resync[0].text("reason"), "crossed_book");
}

#[test]
fn a_delta_with_a_level_that_is_not_a_number_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut frame = btc_delta();
    frame["orderbook_p"]["bids"] = json!([["82467.2","-"]]);

    let published = send(&mut conn, frame);

    assert!(published.is_empty());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn a_book_frame_of_an_unknown_type_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut frame = btc_delta();
    frame.as_object_mut().unwrap().remove("type");

    let published = send(&mut conn, frame);

    assert!(published.is_empty());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "unknown_book_type");
}

#[test]
fn a_book_frame_that_does_not_parse_resyncs_the_connection() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut frame = btc_delta();
    frame["orderbook_p"]["bids"] = json!("82470.1");

    assert!(venue().handle(frame.to_string().as_bytes(), &mut conn).is_err());

    assert!(conn.take_published().is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "book_frame_unreadable");
}

#[test]
fn a_delta_with_neither_side_moves_the_sequence_and_publishes_nothing() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut frame = btc_delta();
    frame["orderbook_p"] = json!({ "asks": [], "bids": [] });

    let published = send(&mut conn, frame);

    assert!(published.is_empty());
    assert_eq!(conn.state[&0], 69540007560);
    assert!(!conn.resync_requested());
}

#[test]
fn drops_a_book_for_a_market_the_connection_does_not_hold() {
    let (logs, _capture) = capture();
    let mut conn = Connection::for_test("phemex#perp#0", vec![market("BTCUSDC")]);

    let published = send(&mut conn, btc_snapshot());

    assert!(published.is_empty());
    assert!(!conn.resync_requested());
    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "BTCUSDT");
}

#[test]
fn logs_an_error_reply_with_the_market_its_request_id_names() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(&mut conn, json!({"error":{"code":6001,"message":"invalid argument"},"id":3,"result":null}));

    assert!(published.is_empty());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "phemex#perp#0");
    assert_eq!(errors[0].text("market"), "NOPEUSDT");
    assert_eq!(errors[0].number("code"), 6001.0);
    assert_eq!(errors[0].number("request"), 3.0);
    assert_eq!(errors[0].text("message"), "invalid argument");
}

#[test]
fn an_error_reply_with_no_request_id_names_no_market() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    // The answer to a frame that is not JSON.
    send(&mut conn, json!({"error":{"code":6001,"message":"invalid argument"},"id":null,"result":null}));
    send(&mut conn, json!({"error":{"code":6015,"message":"subscription limit exceeded"},"id":99,"result":null}));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert!(errors.iter().all(|error| error.text("market").is_empty()));
}

#[test]
fn ignores_the_subscribe_acknowledgement_and_the_pong() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    assert!(send(&mut conn, json!({"error":null,"id":1,"result":{"status":"success"}})).is_empty());
    assert!(send(&mut conn, json!({"error":null,"id":0,"result":"pong"})).is_empty());
    assert!(logs.lines().iter().all(|line| line.level > Level::WARN));
}

#[test]
fn a_frame_that_is_not_json_is_an_error_and_keeps_the_books() {
    let mut conn = connection();

    assert!(venue().handle(b"pong", &mut conn).is_err());
    assert!(!conn.resync_requested());
}

// Prints the frames the feed tests are built from:
// cargo test phemex::tests::capture_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_frames() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut socket, _) = tokio_tungstenite::connect_async(PUBLIC_URL).await.unwrap();
    let list = std::env::var("CAPTURE_MARKETS").unwrap_or_else(|_| "BTCUSDT,BTCUSDC,NOPEUSDT,PATHUSDT".to_string());
    let markets: Vec<&str> = list.split(',').collect();
    for (i, market) in markets.iter().enumerate() {
        let frame = serde_json::json!({ "id": i + 1, "method": "orderbook_p.subscribe", "params": [market] });
        socket.send(Message::text(frame.to_string())).await.unwrap();
    }
    socket.send(Message::text(r#"{"id":0,"method":"server.ping","params":[]}"#)).await.unwrap();
    socket.send(Message::text("not json")).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(20);
    let mut deltas = 0;
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, socket.next()).await {
        let Message::Text(text) = message else {
            continue;
        };
        let delta = text.contains(r#""type":"incremental""#);
        if !delta || deltas < 12 {
            println!("{text}");
        }
        deltas += usize::from(delta);
    }
}
