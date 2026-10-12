// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

const CONNECTION: &str = "pionex#public#0";

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.strip_suffix("_USDT_PERP").unwrap();
    testing::market(ID, raw_market_id, base, "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}_USDT_PERP")));
    }
    markets
}

fn venue() -> Pionex {
    Pionex::new(&[])
}

fn connection(raw_ids: &[&str]) -> Connection<HashMap<usize, i64>> {
    Connection::for_test(CONNECTION, raw_ids.iter().map(|id| market(id)).collect())
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    pairs.iter().map(|&(price, size)| BookLevel { price, size }).collect()
}

fn send(conn: &mut Connection<HashMap<usize, i64>>, frame: &Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn book(symbol: &str, action: &str, number: i64, prev_number: i64, bids: Value, asks: Value) -> Value {
    json!({
        "topic": "ORDERBOOK", "symbol": symbol, "n": "100000315996470", "timestamp": 1791573389456u64,
        "data": { "action": action, "bids": bids, "asks": asks, "number": number, "prevNumber": prev_number, "timestamp": 1791573389456u64 },
    })
}

// Frames captured live on 2026-10-09 at 19:16 UTC, cut to three of the hundred levels a side.
fn aax_snapshot() -> Value {
    book(
        "AAX_USDT_PERP",
        "SNAPSHOT",
        11386370828,
        0,
        json!([["42.13", "661.46"], ["42.12", "172.97"], ["42.11", "142.73"]]),
        json!([["42.16", "782.64"], ["42.17", "222.43"], ["42.18", "132.05"]]),
    )
}

// The update that followed, with a deleted bid and a new ask such as later updates carried.
fn aax_update() -> Value {
    book(
        "AAX_USDT_PERP",
        "UPDATE",
        11386370961,
        11386370828,
        json!([["42.13", "0"], ["42.12", "186.19"]]),
        json!([["42.16", "849.47"], ["42.15", "12.5"]]),
    )
}

// A quiet book sends this about every 10 s, which only moves the number.
fn aax_empty_update() -> Value {
    book("AAX_USDT_PERP", "UPDATE", 11386371189, 11386370961, json!([]), json!([]))
}

fn chinese_snapshot() -> Value {
    book(
        "币安人生_USDT_PERP",
        "SNAPSHOT",
        10384525956,
        0,
        json!([["0.56330", "563"], ["0.56329", "1463"]]),
        json!([["0.56350", "1040"], ["0.56351", "980"]]),
    )
}

#[test]
fn plans_one_public_socket_per_hundred_markets() {
    let plans = venue().plan(&markets(554));

    assert_eq!(plans.len(), 6);
    assert_eq!(plans[0].id, "pionex#public#0");
    assert_eq!(plans[0].url, "wss://ws.pionex.com/wsPub");
    assert_eq!(plans[0].markets.len(), 100);
    assert_eq!(plans[5].markets.len(), 54);
}

#[test]
fn subscribes_one_market_per_frame_paced_under_five_messages_a_second_and_staggers_handshakes() {
    let frames = venue().subscribe_frames(&[market("BTC_USDT_PERP"), market("币安人生_USDT_PERP")], &mut HashMap::new());

    let frames: Vec<Value> = frames.iter().map(|frame| serde_json::from_str(frame.to_text().unwrap()).unwrap()).collect();
    assert_eq!(
        frames,
        [
            json!({ "op": "SUBSCRIBE", "topic": "ORDERBOOK", "symbol": "BTC_USDT_PERP" }),
            json!({ "op": "SUBSCRIBE", "topic": "ORDERBOOK", "symbol": "币安人生_USDT_PERP" }),
        ]
    );
    let settings = venue().settings();
    assert_eq!(settings.subscribe_gap, Duration::from_millis(250));
    assert_eq!(settings.max_silence, Duration::from_secs(35));
    assert_eq!(settings.ping_every, None);
    assert_eq!(settings.connect_stagger, Duration::from_secs(1));
    assert_eq!(settings.reconnect_jitter, Duration::from_secs(3));
}

#[test]
fn a_snapshot_replaces_the_book() {
    let mut conn = connection(&["AAX_USDT_PERP"]);

    let published = send(&mut conn, &aax_snapshot());

    assert_eq!(
        published,
        [(
            "AAX_USDT_PERP".to_string(),
            levels(&[(42.13, 661.46), (42.12, 172.97), (42.11, 142.73)]),
            levels(&[(42.16, 782.64), (42.17, 222.43), (42.18, 132.05)]),
        )]
    );
}

#[test]
fn an_update_chained_by_prev_number_sets_and_deletes_levels() {
    let mut conn = connection(&["AAX_USDT_PERP"]);
    send(&mut conn, &aax_snapshot());

    let published = send(&mut conn, &aax_update());

    assert_eq!(
        published,
        [(
            "AAX_USDT_PERP".to_string(),
            levels(&[(42.12, 186.19), (42.11, 142.73)]),
            levels(&[(42.15, 12.5), (42.16, 849.47), (42.17, 222.43), (42.18, 132.05)]),
        )]
    );
    assert!(!conn.resync_requested());
}

#[test]
fn an_empty_update_moves_the_chain_without_publishing() {
    let mut conn = connection(&["AAX_USDT_PERP"]);
    send(&mut conn, &aax_snapshot());
    send(&mut conn, &aax_update());

    assert!(send(&mut conn, &aax_empty_update()).is_empty());

    let next = book("AAX_USDT_PERP", "UPDATE", 11386371250, 11386371189, json!([["42.12", "200"]]), json!([]));
    assert_eq!(send(&mut conn, &next).len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn a_gap_in_the_chain_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["AAX_USDT_PERP"]);
    send(&mut conn, &aax_snapshot());

    let published = send(&mut conn, &aax_empty_update());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_gap");
}

#[test]
fn an_update_before_any_snapshot_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["AAX_USDT_PERP"]);

    assert!(send(&mut conn, &aax_update()).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn an_update_without_a_number_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["AAX_USDT_PERP"]);
    send(&mut conn, &aax_snapshot());
    let mut update = aax_update();
    update["data"].as_object_mut().unwrap().remove("number");

    assert!(send(&mut conn, &update).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_gap");
}

#[test]
fn a_snapshot_without_a_number_resyncs_before_publishing() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["AAX_USDT_PERP"]);
    let mut snapshot = aax_snapshot();
    snapshot["data"].as_object_mut().unwrap().remove("number");

    assert!(send(&mut conn, &snapshot).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "snapshot_without_number");
}

#[test]
fn a_snapshot_with_a_level_it_cannot_read_resyncs_before_publishing() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["AAX_USDT_PERP"]);
    let snapshot = book("AAX_USDT_PERP", "SNAPSHOT", 11386370828, 0, json!([["42.13", "661.46"], ["42.12", ""]]), json!([["42.16", "782.64"]]));

    assert!(send(&mut conn, &snapshot).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn an_update_with_a_level_it_cannot_read_resyncs_without_publishing() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["AAX_USDT_PERP"]);
    send(&mut conn, &aax_snapshot());
    let update = book("AAX_USDT_PERP", "UPDATE", 11386370961, 11386370828, json!([["42.12", "186.19"]]), json!([["x", "1"]]));

    assert!(send(&mut conn, &update).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn a_book_frame_with_an_unknown_action_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["AAX_USDT_PERP"]);
    send(&mut conn, &aax_snapshot());
    let mut update = aax_update();
    update["data"]["action"] = json!("REPLACE");

    assert!(send(&mut conn, &update).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "unknown_book_action");
}

#[test]
fn a_book_frame_that_fails_to_parse_resyncs_and_another_frame_does_not() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["AAX_USDT_PERP"]);
    send(&mut conn, &aax_snapshot());
    let mut update = aax_update();
    update["data"]["number"] = json!("11386370961");

    assert!(venue().handle(update.to_string().as_bytes(), &mut conn).is_err());
    assert!(conn.take_published().is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "book_frame_unreadable");

    let mut other = connection(&["AAX_USDT_PERP"]);
    assert!(venue().handle(br#"{"op": "PING", "timestamp": "soon"}"#, &mut other).is_err());
    assert!(!other.resync_requested());
}

#[test]
fn a_second_snapshot_starts_a_new_chain() {
    let mut conn = connection(&["AAX_USDT_PERP"]);
    send(&mut conn, &aax_snapshot());
    let fresh = book("AAX_USDT_PERP", "SNAPSHOT", 11386371189, 0, json!([["42.10", "1"]]), json!([["42.20", "2"]]));

    let published = send(&mut conn, &fresh);
    let next = book("AAX_USDT_PERP", "UPDATE", 11386371250, 11386371189, json!([]), json!([]));
    send(&mut conn, &next);

    assert_eq!(published, [("AAX_USDT_PERP".to_string(), levels(&[(42.10, 1.0)]), levels(&[(42.20, 2.0)]))]);
    assert!(!conn.resync_requested());
}

#[test]
fn chains_each_symbol_on_its_own_and_routes_a_chinese_symbol() {
    let mut conn = connection(&["AAX_USDT_PERP", "币安人生_USDT_PERP"]);
    send(&mut conn, &aax_snapshot());

    let published = send(&mut conn, &chinese_snapshot());
    send(&mut conn, &aax_update());

    assert_eq!(published[0].0, "币安人生_USDT_PERP");
    assert_eq!(published[0].1[0], BookLevel { price: 0.5633, size: 563.0 });
    assert!(!conn.resync_requested());
}

#[test]
fn a_one_sided_snapshot_publishes_its_empty_side() {
    let mut conn = connection(&["AAX_USDT_PERP"]);
    let one_sided = book("AAX_USDT_PERP", "SNAPSHOT", 11386370828, 0, json!([]), json!([["42.16", "782.64"]]));

    let published = send(&mut conn, &one_sided);

    assert_eq!(published, [("AAX_USDT_PERP".to_string(), Vec::new(), levels(&[(42.16, 782.64)]))]);
}

#[test]
fn ignores_a_book_of_an_unknown_symbol() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC_USDT_PERP"]);

    assert!(send(&mut conn, &aax_snapshot()).is_empty());

    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "AAX_USDT_PERP");
    assert!(!conn.resync_requested());
}

#[test]
fn answers_the_server_ping_with_a_pong_of_its_timestamp() {
    let mut conn = connection(&["AAX_USDT_PERP"]);

    // The server's spacing, captured live on 2026-10-09.
    venue().handle(br#"{"op": "PING", "timestamp": 1791573404432}"#, &mut conn).unwrap();

    let sent = conn.take_sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0].to_text().unwrap(), r#"{"op":"PONG","timestamp":1791573404432}"#);
}

#[test]
fn logs_an_error_frame_at_error_and_an_acknowledgement_not_at_all() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["AAX_USDT_PERP"]);

    // Captured live on 2026-10-09, an acknowledgement and the answer to an unknown symbol.
    venue().handle(br#"{"type":"SUBSCRIBED","topic":"ORDERBOOK","symbol":"AAX_USDT_PERP"}"#, &mut conn).unwrap();
    venue()
        .handle(br#"{"type":"ERROR","code":"INVALID_SYMBOL","message":"invalid `symbol`","timestamp":1791573390713}"#, &mut conn)
        .unwrap();

    let lines = logs.lines();
    let errors: Vec<_> = lines.iter().filter(|line| line.level <= Level::WARN).collect();
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].texts["event"], "venue_error");
    assert_eq!(errors[0].texts["code"], "INVALID_SYMBOL");
    assert_eq!(errors[0].texts["connection"], CONNECTION);
    assert!(conn.take_published().is_empty());
}

#[test]
fn logs_an_unknown_control_frame_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["AAX_USDT_PERP"]);

    venue().handle(br#"{"type":"MAINTENANCE","timestamp":1791573390713}"#, &mut conn).unwrap();

    let notices = logs.events("venue_notice");
    assert_eq!(notices[0].text("kind"), "MAINTENANCE");
}

#[test]
fn fails_a_frame_that_is_not_json() {
    let mut conn = connection(&["AAX_USDT_PERP"]);

    assert!(venue().handle(b"not json", &mut conn).is_err());
    assert!(!conn.resync_requested());
}

// Prints the frames of a few streams and the control answers, the capture behind the cases above.
// PIONEX_SYMBOLS=BTC_USDT_PERP,AAX_USDT_PERP PIONEX_SECONDS=40 cargo test pionex_capture -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn pionex_capture() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let symbols = std::env::var("PIONEX_SYMBOLS").unwrap_or_else(|_| "BTC_USDT_PERP,AAX_USDT_PERP".to_string());
    let seconds: u64 = std::env::var("PIONEX_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(40);
    let (mut ws, _) = tokio_tungstenite::connect_async(PUBLIC_URL).await.unwrap();
    for symbol in symbols.split(',') {
        ws.send(Message::text(serde_json::json!({ "op": "SUBSCRIBE", "topic": TOPIC, "symbol": symbol }).to_string())).await.unwrap();
        tokio::time::sleep(Duration::from_millis(250)).await;
    }
    for probe in [r#"{"op":"SUBSCRIBE","topic":"ORDERBOOK","symbol":"NOPE_USDT_PERP"}"#, r#"{"op":"SUBSCRIBE","topic":"NOPE","symbol":"BTC_USDT_PERP"}"#, "not json"] {
        ws.send(Message::text(probe)).await.unwrap();
        tokio::time::sleep(Duration::from_millis(250)).await;
    }

    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let text = match &message {
            Message::Text(text) => text.to_string(),
            Message::Binary(bytes) => format!("binary {}", String::from_utf8_lossy(bytes)),
            other => format!("{other:?}"),
        };
        let at = crate::clock::now_ms();
        println!("{at} {}", text);
        if text.contains(r#""op": "PING""#) || text.contains(r#""op":"PING""#) {
            let ping: serde_json::Value = serde_json::from_str(text.trim_start_matches("binary ")).unwrap();
            let pong = format!(r#"{{"op":"PONG","timestamp":{}}}"#, ping["timestamp"]);
            ws.send(Message::text(pong)).await.unwrap();
        }
    }
}
