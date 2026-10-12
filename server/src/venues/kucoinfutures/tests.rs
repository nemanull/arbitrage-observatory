// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    Market {
        contract_size: 0.001,
        ..testing::market(ID, raw_market_id, "BTC", "USDT", true)
    }
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}USDTM")));
    }
    markets
}

fn venue() -> KucoinFutures {
    KucoinFutures::new()
}

fn connection(raw_market_id: &str) -> Connection<Streams> {
    Connection::for_test("kucoinfutures#0", vec![market(raw_market_id)])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// The envelope of obu frames captured live on 2026-10-08, each sent as a binary frame, with the level count cut to two per side.
fn obu(kind: &str, d: Value) -> Value {
    json!({ "T": "obu.FUTURES", "dp": "increment@10ms", "t": kind, "P": 1791514359931317786_u64, "d": d })
}

fn xbt_snapshot() -> Value {
    obu(
        "snapshot",
        json!({
            "C": 1748280641165_i64, "M": 1791514359929000000_u64, "O": 1748280641165_i64, "s": "XBTUSDTM",
            "a": [["82120.8", "36"], ["82121.9", "3"]],
            "b": [["82120.7", "813"], ["82120.6", "80"]],
        }),
    )
}

// The two deltas that followed the snapshot, as they came.
fn xbt_delta() -> Value {
    obu(
        "delta",
        json!({
            "C": 1748280641199_i64, "M": 1791514359939000000_u64, "O": 1748280641166_i64, "s": "XBTUSDTM",
            "a": [["82122", "6"], ["82129.1", "15"]],
            "b": [["82120.3", "0"], ["82110.8", "0"]],
        }),
    )
}

fn xbt_next_delta() -> Value {
    obu(
        "delta",
        json!({
            "C": 1748280641208_i64, "M": 1791514359949000000_u64, "O": 1748280641200_i64, "s": "XBTUSDTM",
            "a": [["82121.9", "0"], ["82140", "358"]],
            "b": [],
        }),
    )
}

fn send(conn: &mut Connection<Streams>, frame: Value) -> Published {
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
fn puts_100_markets_on_each_uta_socket() {
    let plans = venue().plan(&markets(687));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [100, 100, 100, 100, 100, 100, 87]);
    assert_eq!(plans[0].id, "kucoinfutures#0");
    assert_eq!(plans[6].id, "kucoinfutures#6");
    assert_eq!(plans[0].url, "wss://x-push-futures.kucoin.com");
}

#[test]
fn paces_subscribes_and_handshakes_and_waits_15_seconds_for_a_first_book() {
    let settings = venue().settings();

    assert_eq!(settings.max_silence, Duration::from_secs(45));
    assert_eq!(settings.ping_every, Some(Duration::from_secs(15)));
    assert_eq!(settings.subscribe_gap, Duration::from_millis(50));
    assert_eq!(settings.connect_stagger, Duration::from_secs(1));
    assert_eq!(settings.first_book_wait, Duration::from_secs(15));
}

// subscribe_frames and ping

#[test]
fn subscribes_each_market_in_its_own_frame_with_a_fresh_id() {
    let mut state = Streams::default();

    let frames = venue().subscribe_frames(&markets(3), &mut state);

    assert_eq!(frames.len(), 3);
    assert_eq!(
        parsed(&frames[0]),
        json!({ "id": "1", "action": "SUBSCRIBE", "channel": "obu", "tradeType": "FUTURES", "symbol": "SYM0USDTM", "depth": "increment@10ms" })
    );
    assert_eq!(parsed(&frames[2])["id"], "3");
    assert_eq!(parsed(&frames[2])["symbol"], "SYM2USDTM");
}

#[test]
fn pings_with_the_next_request_id() {
    let mut state = Streams::default();
    venue().subscribe_frames(&markets(2), &mut state);

    let ping = parsed(&venue().ping(&mut state));

    assert_eq!(ping, json!({ "id": "3", "type": "ping" }));
}

// handle

#[test]
fn hands_the_engine_a_snapshot_as_the_whole_book() {
    let mut conn = connection("XBTUSDTM");

    let published = send(&mut conn, xbt_snapshot());

    assert_eq!(
        published,
        [(
            "XBTUSDTM".to_string(),
            levels(&[(82120.7, 813.0), (82120.6, 80.0)]),
            levels(&[(82120.8, 36.0), (82121.9, 3.0)]),
        )]
    );
}

#[test]
fn applies_deltas_whose_o_is_the_last_c_plus_one_and_deletes_a_level_sent_as_zero() {
    let mut conn = connection("XBTUSDTM");
    send(&mut conn, xbt_snapshot());

    let first = send(&mut conn, xbt_delta());
    let second = send(&mut conn, xbt_next_delta());

    assert_eq!(first[0].2, levels(&[(82120.8, 36.0), (82121.9, 3.0), (82122.0, 6.0), (82129.1, 15.0)]));
    assert_eq!(first[0].1, levels(&[(82120.7, 813.0), (82120.6, 80.0)]));
    assert_eq!(second[0].2, levels(&[(82120.8, 36.0), (82122.0, 6.0), (82129.1, 15.0), (82140.0, 358.0)]));
    assert!(!conn.resync_requested());
}

#[test]
fn applies_a_delta_that_overlaps_the_last_c_as_the_documented_rule_allows() {
    let mut conn = connection("XBTUSDTM");
    send(&mut conn, xbt_snapshot());
    send(&mut conn, xbt_delta());

    let mut overlap = xbt_next_delta();
    overlap["d"]["O"] = json!(1748280641190_i64);
    let published = send(&mut conn, overlap);

    assert_eq!(published[0].2.last(), Some(&BookLevel { price: 82140.0, size: 358.0 }));
    assert!(!conn.resync_requested());
}

#[test]
fn skips_a_delta_whose_c_is_already_applied() {
    let (logs, _capture) = capture();
    let mut conn = connection("XBTUSDTM");
    send(&mut conn, xbt_snapshot());
    send(&mut conn, xbt_delta());

    let repeated = send(&mut conn, xbt_delta());
    let next = send(&mut conn, xbt_next_delta());

    assert!(repeated.is_empty());
    assert_eq!(next.len(), 1);
    assert!(!conn.resync_requested());
    assert!(logs.events("book_resync").is_empty());
}

#[test]
fn advances_the_sequence_on_a_delta_with_no_levels_and_publishes_nothing_for_it() {
    let mut conn = connection("XBTUSDTM");
    send(&mut conn, xbt_snapshot());

    let mut empty = xbt_delta();
    empty["d"]["a"] = json!([]);
    empty["d"]["b"] = json!([]);
    let published = send(&mut conn, empty);
    let next = send(&mut conn, xbt_next_delta());

    assert!(published.is_empty());
    assert_eq!(next.len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn restarts_the_connection_on_a_gap_in_the_sequence_and_applies_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection("XBTUSDTM");
    send(&mut conn, xbt_snapshot());

    let published = send(&mut conn, xbt_next_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync.len(), 1);
    assert_eq!(resync[0].text("market"), "XBTUSDTM");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn restarts_the_connection_on_a_delta_with_no_snapshot_behind_it() {
    let (logs, _capture) = capture();
    let mut conn = connection("XBTUSDTM");

    let published = send(&mut conn, xbt_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn takes_a_later_snapshot_as_a_replacement_of_the_book_and_its_sequence() {
    let mut conn = connection("XBTUSDTM");
    send(&mut conn, xbt_snapshot());
    send(&mut conn, xbt_delta());

    let replaced = send(
        &mut conn,
        obu("snapshot", json!({ "C": 1748280700000_i64, "O": 1748280700000_i64, "s": "XBTUSDTM", "a": [["82200", "1"]], "b": [["82199", "2"]] })),
    );
    let mut next = xbt_next_delta();
    next["d"]["O"] = json!(1748280700001_i64);
    next["d"]["C"] = json!(1748280700004_i64);
    let after = send(&mut conn, next);

    assert_eq!(replaced[0].1, levels(&[(82199.0, 2.0)]));
    assert_eq!(replaced[0].2, levels(&[(82200.0, 1.0)]));
    assert_eq!(after[0].2, levels(&[(82140.0, 358.0), (82200.0, 1.0)]));
    assert!(!conn.resync_requested());
}

#[test]
fn drops_a_symbol_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = connection("ETHUSDTM");

    let snapshot = send(&mut conn, xbt_snapshot());
    let delta = send(&mut conn, xbt_delta());

    assert!(snapshot.is_empty() && delta.is_empty());
    assert!(!conn.resync_requested());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

#[test]
fn logs_a_refused_request_and_stays_silent_on_the_welcome_the_ack_and_the_pong() {
    let (logs, _capture) = capture();
    let mut conn = connection("XBTUSDTM");

    // Captured on 2026-10-08 as they came, the pong with its spaces.
    let quiet = [
        r#"{"sessionId":"adffb2ab-bc70-4e30-817d-1d975f2e6f6a","message":"welcome","pingInterval":18000}"#,
        r#"{"id":"1","result":true}"#,
        r#"{"type":"pong","id": "4", "ts": 1791514355524850427}"#,
    ];
    for frame in quiet {
        venue().handle(frame.as_bytes(), &mut conn).unwrap();
    }
    venue()
        .handle(br#"{"id":"depth20","result":false,"message":"invalid request data"}"#, &mut conn)
        .unwrap();
    // Recorded on 2026-09-22 for a symbols array, a refusal that names a reason instead of a message.
    venue()
        .handle(br#"{"id":"p22","result":false,"reason":"symbols are not supported for topic obu"}"#, &mut conn)
        .unwrap();

    assert!(conn.take_published().is_empty());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "kucoinfutures#0");
    assert_eq!(errors[0].text("request"), "depth20");
    assert_eq!(errors[0].text("message"), "invalid request data");
    assert_eq!(errors[1].text("message"), "symbols are not supported for topic obu");
}

#[test]
fn reads_a_refusal_whose_result_is_the_documented_string_false() {
    let (logs, _capture) = capture();
    let mut conn = connection("XBTUSDTM");

    venue()
        .handle(br#"{"id":"7","result":"false","message":"invalid request data"}"#, &mut conn)
        .unwrap();
    venue().handle(br#"{"id":"8","result":"true"}"#, &mut conn).unwrap();

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].text("request"), "7");
}

#[test]
fn logs_a_book_frame_of_an_unknown_kind_as_a_notice_and_leaves_the_book_alone() {
    let (logs, _capture) = capture();
    let mut conn = connection("XBTUSDTM");
    send(&mut conn, xbt_snapshot());

    let mut odd = xbt_delta();
    odd["t"] = json!("checksum");
    let published = send(&mut conn, odd);
    let next = send(&mut conn, xbt_delta());

    assert!(published.is_empty());
    assert_eq!(next.len(), 1);
    assert!(!conn.resync_requested());
    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].level, Level::WARN);
    assert_eq!(notices[0].text("kind"), "checksum");
}

#[test]
fn fails_a_frame_that_is_not_json() {
    let mut conn = connection("XBTUSDTM");

    assert!(venue().handle(b"not json", &mut conn).is_err());
}

// probe

// Prints the live frames the cases above were cut from:
// cargo test kucoinfutures::tests::probe_prints_live_frames -- --ignored --nocapture
// It subscribes before the welcome arrives, as the feed runtime does, then asks for an unknown symbol and a refused depth.
#[tokio::test]
#[ignore]
async fn probe_prints_live_frames() {
    use futures_util::{SinkExt, StreamExt};
    use tokio::time::{Instant, timeout};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(URL).await.unwrap();
    let mut state = Streams::default();
    let markets = [
        testing::market(ID, "XBTUSDTM", "BTC", "USDT", true),
        testing::market(ID, "INITUSDTM", "INIT", "USDT", true),
        testing::market(ID, "NOPEUSDTM", "NOPE", "USDT", true),
    ];
    for frame in KucoinFutures::new().subscribe_frames(&markets, &mut state) {
        ws.send(frame).await.unwrap();
    }
    let refused = r#"{"id":"depth20","action":"SUBSCRIBE","channel":"obu","tradeType":"FUTURES","symbol":"XBTUSDTM","depth":"20"}"#;
    ws.send(Message::text(refused)).await.unwrap();
    ws.send(KucoinFutures::new().ping(&mut state)).await.unwrap();

    let deadline = Instant::now() + Duration::from_secs(20);
    let mut printed = 0;
    while let Ok(Some(Ok(message))) = timeout(deadline.saturating_duration_since(Instant::now()), ws.next()).await {
        let (kind, text) = match &message {
            Message::Text(text) => ("text", text.as_str().to_string()),
            Message::Binary(bytes) => ("binary", String::from_utf8_lossy(bytes).to_string()),
            other => ("other", format!("{other:?}")),
        };
        // Book frames are cut to their first two levels per side.
        let mut shown = text.clone();
        if let Ok(mut value) = serde_json::from_str::<serde_json::Value>(&text)
            && let Some(book) = value.get_mut("d").and_then(|d| d.as_object_mut())
        {
            for side in ["a", "b"] {
                if let Some(levels) = book.get_mut(side).and_then(|l| l.as_array_mut()) {
                    levels.truncate(2);
                }
            }
            shown = value.to_string();
        }
        if printed < 12 || !text.contains("\"delta\"") {
            println!("{kind} {shown}");
            printed += 1;
        }
    }
}
