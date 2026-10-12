// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;
type State = HashMap<usize, i64>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.strip_suffix("USDTPERP").unwrap_or(raw_market_id);
    testing::market(ID, raw_market_id, base, "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}USDTPERP")));
    }
    markets
}

fn connection(raw_market_ids: &[&str]) -> Connection<State> {
    Connection::for_test("valr#trade#0", raw_market_ids.iter().map(|id| market(id)).collect())
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// Frames captured live on 2026-10-09, with each snapshot cut to three levels a side.
fn btc_snapshot() -> Value {
    json!({
        "type": "OB_L1_SNAPSHOT", "ps": "BTCUSDTPERP",
        "d": {
            "a": [["82385", "0.1188"], ["82397", "0.1031"], ["82402", "0.0606"]],
            "b": [["82349", "0.0501"], ["82348", "0.065"], ["82343", "0.0606"]],
            "cs": 3993664319_u64, "lc": 1791575206514_i64, "sq": 203206,
        },
    })
}

fn sol_snapshot() -> Value {
    json!({
        "type": "OB_L1_SNAPSHOT", "ps": "SOLUSDTPERP",
        "d": {
            "a": [["108.73", "3.67"], ["108.74", "47.36"], ["108.76", "40.19"]],
            "b": [["108.66", "49.66"], ["108.65", "47.51"], ["108.64", "79.11"]],
            "cs": 212481050, "lc": 1791575205610_i64, "sq": 233655,
        },
    })
}

// The first two SOL deltas after its snapshot, as they came.
fn sol_delta() -> Value {
    json!({
        "type": "OB_L1_DIFF", "ps": "SOLUSDTPERP",
        "d": { "a": [], "b": [["108.67", "3.67"], ["108.66", "45.99"]], "cs": 2104923422_u64, "lc": 1791575208168_i64, "sq": 233656 },
    })
}

fn sol_second_delta() -> Value {
    json!({
        "type": "OB_L1_DIFF", "ps": "SOLUSDTPERP",
        "d": { "a": [["108.73", "0"], ["108.74", "0"], ["108.75", "3.67"]], "b": [["108.67", "51.18"], ["108.65", "0"]], "cs": 1553624292_u64, "lc": 1791575208799_i64, "sq": 233657 },
    })
}

fn with_sq(mut frame: Value, sq: i64) -> Value {
    frame["d"]["sq"] = json!(sq);
    frame
}

fn send(conn: &mut Connection<State>, frame: Value) -> Published {
    Valr::new().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

#[test]
fn plans_one_trade_socket_for_up_to_fifty_markets() {
    let plans = Valr::new().plan(&markets(51));

    assert_eq!(plans.len(), 2);
    assert_eq!(plans[0].id, "valr#trade#0");
    assert_eq!(plans[0].url, "wss://api.valr.com/ws/trade");
    assert_eq!(plans[0].markets.len(), 50);
    assert_eq!(plans[1].id, "valr#trade#1");
    assert_eq!(plans[1].markets.len(), 1);
}

#[test]
fn subscribes_every_pair_of_a_socket_in_one_frame() {
    let markets = vec![market("BTCUSDTPERP"), market("ETHUSDTPERP")];

    let frames = Valr::new().subscribe_frames(&markets, &mut State::default());

    assert_eq!(frames.len(), 1);
    assert_eq!(
        parsed(&frames[0]),
        json!({ "type": "SUBSCRIBE", "subscriptions": [{ "event": "OB_L1_DIFF", "pairs": ["BTCUSDTPERP", "ETHUSDTPERP"] }] })
    );
}

#[test]
fn pings_every_twenty_seconds_and_retires_the_socket_before_fifteen_minutes() {
    let venue = Valr::new();
    let settings = venue.settings();

    assert_eq!(parsed(&venue.ping(&mut State::default())), json!({ "type": "PING" }));
    assert_eq!(settings.ping_every, Some(Duration::from_secs(20)));
    assert_eq!(settings.max_silence, Duration::from_secs(45));
    assert!(settings.retire_after.unwrap() + settings.retire_jitter < Duration::from_secs(15 * 60));
}

#[test]
fn a_snapshot_seeds_the_book_best_first() {
    let mut conn = connection(&["BTCUSDTPERP"]);

    let published = send(&mut conn, btc_snapshot());

    assert_eq!(published.len(), 1);
    let (id, bids, asks) = &published[0];
    assert_eq!(id, "BTCUSDTPERP");
    assert_eq!(bids, &levels(&[(82349.0, 0.0501), (82348.0, 0.065), (82343.0, 0.0606)]));
    assert_eq!(asks, &levels(&[(82385.0, 0.1188), (82397.0, 0.1031), (82402.0, 0.0606)]));
    assert!(!conn.resync_requested());
}

#[test]
fn deltas_one_above_the_last_sq_set_and_remove_levels() {
    let mut conn = connection(&["SOLUSDTPERP"]);
    send(&mut conn, sol_snapshot());

    let first = send(&mut conn, sol_delta());
    let second = send(&mut conn, sol_second_delta());

    assert_eq!(first[0].1, levels(&[(108.67, 3.67), (108.66, 45.99), (108.65, 47.51), (108.64, 79.11)]));
    assert_eq!(second.len(), 1);
    let (_, bids, asks) = &second[0];
    assert_eq!(bids, &levels(&[(108.67, 51.18), (108.66, 45.99), (108.64, 79.11)]));
    assert_eq!(asks, &levels(&[(108.75, 3.67), (108.76, 40.19)]));
    assert!(!conn.resync_requested());
}

#[test]
fn a_skipped_sq_resyncs_and_leaves_the_book_as_it_was() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["SOLUSDTPERP"]);
    send(&mut conn, sol_snapshot());

    let published = send(&mut conn, with_sq(sol_delta(), 233657));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync[0].text("market"), "SOLUSDTPERP");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn a_repeated_sq_resyncs() {
    let mut conn = connection(&["SOLUSDTPERP"]);
    send(&mut conn, sol_snapshot());
    send(&mut conn, sol_delta());

    send(&mut conn, sol_delta());

    assert!(conn.resync_requested());
}

#[test]
fn a_delta_before_its_snapshot_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["SOLUSDTPERP"]);

    let published = send(&mut conn, sol_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn each_pair_keeps_its_own_sq_chain() {
    let mut conn = connection(&["BTCUSDTPERP", "SOLUSDTPERP"]);
    send(&mut conn, btc_snapshot());
    send(&mut conn, sol_snapshot());

    let published = send(&mut conn, sol_delta());

    assert_eq!(published.len(), 1);
    assert_eq!(published[0].0, "SOLUSDTPERP");
    assert!(!conn.resync_requested());
}

#[test]
fn a_new_snapshot_replaces_the_book_and_restarts_the_chain() {
    let mut conn = connection(&["SOLUSDTPERP"]);
    send(&mut conn, sol_snapshot());
    send(&mut conn, sol_delta());

    let mut snapshot = with_sq(sol_snapshot(), 500);
    snapshot["d"]["b"] = json!([["100", "1"]]);
    snapshot["d"]["a"] = json!([["101", "2"]]);
    let replaced = send(&mut conn, snapshot);
    let next = send(&mut conn, with_sq(sol_second_delta(), 501));

    assert_eq!(replaced[0].1, levels(&[(100.0, 1.0)]));
    assert_eq!(replaced[0].2, levels(&[(101.0, 2.0)]));
    assert_eq!(next.len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn an_empty_delta_moves_the_sq_without_publishing() {
    let mut conn = connection(&["SOLUSDTPERP"]);
    send(&mut conn, sol_snapshot());

    let mut empty = sol_delta();
    empty["d"]["b"] = json!([]);
    let published = send(&mut conn, empty);
    let next = send(&mut conn, sol_second_delta());

    assert!(published.is_empty());
    assert_eq!(next.len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn a_pair_nobody_subscribed_is_dropped_and_logged_once() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDTPERP"]);

    assert!(send(&mut conn, sol_snapshot()).is_empty());
    assert!(send(&mut conn, sol_delta()).is_empty());

    assert!(!conn.resync_requested());
    let unknown = logs.events("unsubscribed_symbol");
    assert_eq!(unknown.len(), 1);
    assert_eq!(unknown[0].text("market"), "SOLUSDTPERP");
}

// The acknowledgements, pongs and errors captured live on 2026-10-09.
#[test]
fn acknowledgements_and_pongs_change_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDTPERP"]);

    for frame in [
        json!({ "message": "OB_L1_DIFF:BTCUSDTPERP", "type": "SUBSCRIBED" }),
        json!({ "type": "PONG" }),
        json!({ "message": "NO_SUBSCRIPTIONS", "type": "PONG" }),
    ] {
        assert!(send(&mut conn, frame).is_empty());
    }

    assert!(!conn.resync_requested());
    assert!(logs.lines().is_empty());
}

#[test]
fn an_error_frame_is_logged_at_error_and_the_connection_carries_on() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDTPERP"]);

    send(&mut conn, json!({ "message": "Channel OB_L1_DIFF, pair NOPEUSDTPERP combination invalid", "type": "ERROR" }));
    send(&mut conn, json!({ "type": "RATE_LIMIT_EXCEEDED" }));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "valr#trade#0");
    assert_eq!(errors[0].text("message"), "Channel OB_L1_DIFF, pair NOPEUSDTPERP combination invalid");
    assert_eq!(errors[1].text("kind"), "RATE_LIMIT_EXCEEDED");
    assert!(!conn.resync_requested());
}

#[test]
fn an_unsubscribe_or_another_frame_is_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDTPERP"]);

    send(&mut conn, json!({ "message": "OB_L1_DIFF:BTCUSDTPERP", "type": "UNSUBSCRIBED" }));
    send(&mut conn, json!({ "message": "maintenance", "type": "SOMETHING_NEW" }));

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 2);
    assert_eq!(notices[0].level, Level::WARN);
    assert_eq!(notices[0].text("kind"), "UNSUBSCRIBED");
    assert_eq!(notices[0].text("message"), "OB_L1_DIFF:BTCUSDTPERP");
    assert_eq!(notices[1].text("kind"), "SOMETHING_NEW");
    assert!(!conn.resync_requested());
}

// Its deltas stop, so a book left in place would go stale while it looked current.
#[test]
fn an_unsubscribe_of_a_booked_pair_empties_that_book_only() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTCUSDTPERP", "SOLUSDTPERP"]);
    send(&mut conn, btc_snapshot());
    send(&mut conn, sol_snapshot());

    let emptied = send(&mut conn, json!({ "message": "OB_L1_DIFF:SOLUSDTPERP", "type": "UNSUBSCRIBED" }));
    let other_event = send(&mut conn, json!({ "message": "MARK_PRICE_UPDATE:BTCUSDTPERP", "type": "UNSUBSCRIBED" }));
    let unknown = send(&mut conn, json!({ "message": "OB_L1_DIFF:ETHUSDTPERP", "type": "UNSUBSCRIBED" }));

    assert_eq!(emptied, vec![("SOLUSDTPERP".to_string(), vec![], vec![])]);
    assert!(other_event.is_empty());
    assert!(unknown.is_empty());
    assert!(!conn.resync_requested());
    assert!(logs.events("unsubscribed_symbol").is_empty());
    assert!(!send(&mut conn, json!({ "type": "OB_L1_DIFF", "ps": "BTCUSDTPERP", "d": { "a": [["82390", "1"]], "b": [], "sq": 203207 } })).is_empty());

    send(&mut conn, sol_delta());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn an_unsubscribe_before_any_snapshot_publishes_nothing() {
    let mut conn = connection(&["SOLUSDTPERP"]);

    let published = send(&mut conn, json!({ "message": "OB_L1_DIFF:SOLUSDTPERP", "type": "UNSUBSCRIBED" }));

    assert!(published.is_empty());
    assert!(!conn.resync_requested());
}

// OrderBook would skip the level, and the book would keep the old size at that price.
#[test]
fn a_level_it_cannot_read_resyncs_before_touching_the_book() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["SOLUSDTPERP"]);
    send(&mut conn, sol_snapshot());

    let mut delta = sol_delta();
    delta["d"]["b"] = json!([["108.67", "3.67"], ["108.66", "n/a"]]);
    let published = send(&mut conn, delta);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn a_snapshot_with_a_level_it_cannot_read_resyncs_without_publishing() {
    let mut conn = connection(&["SOLUSDTPERP"]);

    let mut snapshot = sol_snapshot();
    snapshot["d"]["a"] = json!([["108.73", "3.67"], ["", "1"]]);
    let published = send(&mut conn, snapshot);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn a_frame_that_is_not_json_is_an_error_and_keeps_the_books() {
    let mut conn = connection(&["BTCUSDTPERP"]);

    assert!(Valr::new().handle(b"not json", &mut conn).is_err());
    assert!(Valr::new().handle(br#"{"type":"PONG","message":7}"#, &mut conn).is_err());

    assert!(!conn.resync_requested());
}

// A lost delta on a quiet book would show only at the next delta, which can be 20 s away.
#[test]
fn a_book_frame_it_cannot_parse_or_route_resyncs_the_socket() {
    let venue = Valr::new();

    for frame in [
        &br#"{"type":"OB_L1_DIFF","ps":"BTCUSDTPERP","d":{"a":[]}}"#[..],
        br#"{"type":"OB_L1_DIFF","ps":"BTCUSDTPERP","d":{"a":[["1","2"]],"b":[],"sq":"x"}}"#,
        br#"{"type":"OB_L1_DIFF","ps":"BTCUSDTPERP"}"#,
        br#"{"type":"OB_L1_SNAPSHOT","d":{"a":[],"b":[],"sq":1}}"#,
    ] {
        let (logs, _capture) = capture();
        let mut conn = connection(&["BTCUSDTPERP"]);
        send(&mut conn, btc_snapshot());

        assert!(venue.handle(frame, &mut conn).is_err());

        assert!(conn.take_published().is_empty());
        assert!(conn.resync_requested(), "{}", String::from_utf8_lossy(frame));
        assert_eq!(logs.events("book_resync")[0].text("market"), "BTCUSDTPERP");
    }
}

// Prints what the socket sends: an acknowledgement, a pong, two errors, snapshots and deltas, and any sq gap.
// cargo test venues::valr::tests::capture_live_frames -- --exact --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(TRADE_URL).await.unwrap();
    ws.send(Message::text(r#"{"type":"PING"}"#)).await.unwrap();
    let pairs = ["BTCUSDTPERP", "ETHUSDTPERP", "XRPUSDTPERP", "SOLUSDTPERP", "NOPEUSDTPERP"];
    let frame = json!({ "type": "SUBSCRIBE", "subscriptions": [{ "event": EVENT, "pairs": pairs }] });
    ws.send(Message::text(frame.to_string())).await.unwrap();
    ws.send(Message::text("not json")).await.unwrap();
    ws.send(Message::text(r#"{"type":"PING"}"#)).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(25);
    let mut last: HashMap<String, i64> = HashMap::new();
    let mut deltas = 0;
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let mut value: Value = serde_json::from_str(text.as_str()).unwrap();
        let kind = value["type"].as_str().unwrap_or("").to_string();
        if kind.starts_with("OB_L1") {
            let pair = value["ps"].as_str().unwrap().to_string();
            let sq = value["d"]["sq"].as_i64().unwrap();
            if let Some(previous) = last.insert(pair.clone(), sq)
                && sq != previous + 1
            {
                println!("GAP {pair} {previous} {sq}");
            }
            if kind == "OB_L1_DIFF" {
                deltas += 1;
                if deltas > 8 {
                    continue;
                }
            }
            for side in ["b", "a"] {
                if let Some(levels) = value["d"][side].as_array_mut() {
                    print!("{side} {} ", levels.len());
                    levels.truncate(3);
                }
            }
        }
        println!("{value}");
    }
    println!("deltas {deltas}");
}
