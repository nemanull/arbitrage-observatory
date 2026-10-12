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

fn venue() -> Delta {
    Delta::new()
}

// The markets of the capture's subscribe frame, so NOPEUSDT is acknowledged and never served.
fn connection() -> Connection<HashMap<usize, i64>> {
    let markets = vec![market("BTCUSDT"), market("PAXGUSDT"), market("NOPEUSDT")];
    Connection::for_test("delta#perp#0", markets)
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// Frames captured live on 2026-10-09, with the levels cut down, so cs no longer matches them.
// The BTCUSDT updates follow the BTCUSDT snapshot in the order they came.
fn btc_snapshot() -> Value {
    json!({"a":[["82645.5","401"],["82646.0","513"],["82646.5","656"]],"action":"snapshot","b":[["82645.0","216"],["82644.5","277"],["82644.0","354"]],"cs":2528713961_u32,"seq":12313468,"sy":"BTCUSDT","ts":1791567920979156_i64,"type":"ob_updates"})
}

fn btc_update() -> Value {
    json!({"a":[["82645.5","390"],["82646.0","499"],["82646.5","638"],["82663.5","0"],["82664.0","9380"]],"action":"update","b":[],"cs":1069586958_u32,"seq":12313469,"sy":"BTCUSDT","ts":1791567921484003_i64,"type":"ob_updates"})
}

fn btc_next_update() -> Value {
    json!({"a":[["82645.5","391"],["82646.0","501"],["82646.5","641"],["82647.0","821"],["82647.5","1051"]],"action":"update","b":[],"cs":1174931010_u32,"seq":12313470,"sy":"BTCUSDT","ts":1791567921786790_i64,"type":"ob_updates"})
}

fn paxg_snapshot() -> Value {
    json!({"a":[["4189.10","560"],["4189.30","666"],["4189.50","821"]],"action":"snapshot","b":[["4188.80","152"],["4188.50","258"],["4188.20","474"]],"cs":1388805182_u32,"seq":550816,"sy":"PAXGUSDT","ts":1791567916406067_i64,"type":"ob_updates"})
}

fn paxg_update() -> Value {
    json!({"a":[["4191.60","2719"]],"action":"update","b":[["4184.90","2740"],["4184.30","4605"]],"cs":1388805182_u32,"seq":550817,"sy":"PAXGUSDT","ts":1791567921407366_i64,"type":"ob_updates"})
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
fn puts_100_markets_on_each_socket() {
    let plans = venue().plan(&markets(205));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [100, 100, 5]);
    assert_eq!(plans[0].id, "delta#perp#0");
    assert_eq!(plans[2].id, "delta#perp#2");
    assert_eq!(plans[0].url, "wss://public-socket.delta.exchange");
}

#[test]
fn pings_every_15_seconds_and_ends_a_socket_silent_for_45() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(15)));
    assert_eq!(settings.max_silence, Duration::from_secs(45));
    assert_eq!(parsed(&venue().ping(&mut HashMap::new())), json!({ "type": "ping" }));
}

// subscribe_frames

#[test]
fn subscribes_every_market_of_the_socket_in_one_frame() {
    let frames = venue().subscribe_frames(&markets(3), &mut HashMap::new());

    assert_eq!(frames.len(), 1);
    assert_eq!(
        parsed(&frames[0]),
        json!({ "type": "subscribe", "payload": { "channels": [{ "name": "ob_updates", "symbols": ["SYM0USDT", "SYM1USDT", "SYM2USDT"] }] } })
    );
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
            levels(&[(82645.0, 216.0), (82644.5, 277.0), (82644.0, 354.0)]),
            levels(&[(82645.5, 401.0), (82646.0, 513.0), (82646.5, 656.0)]),
        )]
    );
    assert_eq!(conn.state[&0], 12313468);
}

#[test]
fn applies_updates_in_sequence_by_price_and_removes_zero_levels() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());

    let first = send(&mut conn, btc_update());
    let second = send(&mut conn, btc_next_update());

    assert_eq!(first[0].1, levels(&[(82645.0, 216.0), (82644.5, 277.0), (82644.0, 354.0)]));
    assert_eq!(first[0].2, levels(&[(82645.5, 390.0), (82646.0, 499.0), (82646.5, 638.0), (82664.0, 9380.0)]));
    assert_eq!(
        second[0].2,
        levels(&[(82645.5, 391.0), (82646.0, 501.0), (82646.5, 641.0), (82647.0, 821.0), (82647.5, 1051.0), (82664.0, 9380.0)])
    );
    assert_eq!(conn.state[&0], 12313470);
    assert!(!conn.resync_requested());

    let mut delete = btc_next_update();
    delete["seq"] = json!(12313471);
    delete["a"] = json!([["82664.0", "0"]]);
    delete["b"] = json!([["82644.5", "0"]]);
    let third = send(&mut conn, delete);

    assert_eq!(third[0].1, levels(&[(82645.0, 216.0), (82644.0, 354.0)]));
    assert_eq!(third[0].2.last(), Some(&BookLevel { price: 82647.5, size: 1051.0 }));
}

#[test]
fn keeps_each_book_on_its_own_sequence() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, paxg_snapshot());

    let published = send(&mut conn, paxg_update());

    assert_eq!(published[0].0, "PAXGUSDT");
    assert_eq!(published[0].1, levels(&[(4188.8, 152.0), (4188.5, 258.0), (4188.2, 474.0), (4184.9, 2740.0), (4184.3, 4605.0)]));
    assert_eq!(published[0].2, levels(&[(4189.1, 560.0), (4189.3, 666.0), (4189.5, 821.0), (4191.6, 2719.0)]));
    assert_eq!(conn.state[&0], 12313468);
    assert_eq!(conn.state[&1], 550817);
    assert!(!conn.resync_requested());
}

#[test]
fn an_update_that_skips_a_sequence_number_resyncs_and_publishes_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());

    let published = send(&mut conn, btc_next_update());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync[0].text("market"), "BTCUSDT");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn a_repeated_update_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_update());

    send(&mut conn, btc_update());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_gap");
}

#[test]
fn an_update_before_any_snapshot_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(&mut conn, btc_update());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn an_update_after_a_snapshot_of_another_market_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, paxg_snapshot());

    send(&mut conn, btc_update());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("market"), "BTCUSDT");
}

#[test]
fn a_second_snapshot_replaces_the_book_and_moves_the_sequence() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_update());
    let mut snapshot = btc_snapshot();
    snapshot["seq"] = json!(12313500);
    snapshot["b"] = json!([["82640.0", "10"]]);
    snapshot["a"] = json!([["82641.0", "20"]]);

    let published = send(&mut conn, snapshot);

    assert_eq!(published[0].1, levels(&[(82640.0, 10.0)]));
    assert_eq!(published[0].2, levels(&[(82641.0, 20.0)]));
    assert_eq!(conn.state[&0], 12313500);
}

#[test]
fn an_update_with_a_level_that_is_not_a_number_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut frame = btc_update();
    frame["a"] = json!([["82645.5", "-"]]);

    let published = send(&mut conn, frame);

    assert!(published.is_empty());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn a_book_frame_of_an_unknown_action_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut frame = btc_update();
    frame.as_object_mut().unwrap().remove("action");

    let published = send(&mut conn, frame);

    assert!(published.is_empty());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "unknown_book_action");
}

// Not seen on the wire, so the frame is the Error response of the ob_updates docs at docs.delta.exchange, read on 2026-10-09, with this venue's symbol.
// It names the market as symbol rather than sy, and it comes in place of the snapshot.
#[test]
fn an_error_action_logs_the_venue_error_and_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let message = "Snapshot load failed. Verify if product is live and resubscribe after a few secs.";

    let published = send(&mut conn, json!({"action":"error","symbol":"BTCUSDT","type":"ob_updates","msg":message}));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let errors = logs.events("venue_error");
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "delta#perp#0");
    assert_eq!(errors[0].text("market"), "BTCUSDT");
    assert_eq!(errors[0].text("message"), message);
    assert_eq!(logs.events("book_resync")[0].text("reason"), "venue_book_error");
}

#[test]
fn an_error_action_that_names_no_known_market_still_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());

    send(&mut conn, json!({"action":"error","type":"ob_updates","msg":"Snapshot load failed."}));

    assert!(conn.resync_requested());
    assert_eq!(logs.events("venue_error").len(), 1);
    assert!(logs.events("unsubscribed_symbol").is_empty());
}

#[test]
fn a_book_frame_that_does_not_parse_resyncs_the_connection() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut frame = btc_update();
    frame["a"] = json!("82645.5");

    assert!(venue().handle(frame.to_string().as_bytes(), &mut conn).is_err());

    assert!(conn.take_published().is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "book_frame_unreadable");
}

#[test]
fn drops_a_book_for_a_market_the_connection_does_not_hold() {
    let (logs, _capture) = capture();
    let mut conn = Connection::for_test("delta#perp#0", vec![market("PAXGUSDT")]);

    let published = send(&mut conn, btc_snapshot());

    assert!(published.is_empty());
    assert!(!conn.resync_requested());
    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "BTCUSDT");
}

#[test]
fn logs_each_channel_the_acknowledgement_refuses() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let ack = json!({"channels":[{"name":"ob_updates","symbols":["BTCUSDT","PAXGUSDT","NOPEUSDT"]},{"error":"subscription forbidden on this invalid channel","name":"nope_channel"}],"type":"subscriptions"});
    assert!(send(&mut conn, ack).is_empty());

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "delta#perp#0");
    assert_eq!(errors[0].text("channel"), "nope_channel");
    assert_eq!(errors[0].text("message"), "subscription forbidden on this invalid channel");
}

// Captured live on 2026-10-09, sent for a subscribe frame whose channels field is not an array.
#[test]
fn logs_an_error_frame() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, json!({"message":"Subscription forbidden: Invalid channel array","type":"error"}));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].text("message"), "Subscription forbidden: Invalid channel array");
    assert!(!conn.resync_requested());
}

#[test]
fn ignores_a_clean_acknowledgement_the_pong_and_a_heartbeat() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let ack = json!({"channels":[{"name":"ob_updates","symbols":["BTCUSDT","PAXGUSDT","NOPEUSDT"]}],"type":"subscriptions"});
    assert!(send(&mut conn, ack).is_empty());
    assert!(send(&mut conn, json!({"type":"pong"})).is_empty());
    assert!(send(&mut conn, json!({"ts_origin":1790137294966147_i64,"ts_publish":1790137294966147_i64,"type":"heartbeat"})).is_empty());
    assert!(logs.lines().iter().all(|line| line.level > Level::WARN));
}

#[test]
fn a_frame_that_is_not_json_is_an_error_and_keeps_the_books() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());

    assert!(venue().handle(b"pong", &mut conn).is_err());
    assert!(!conn.resync_requested());
}

// Prints the frames the feed tests are built from:
// cargo test delta::tests::capture_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_frames() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut socket, _) = tokio_tungstenite::connect_async(PUBLIC_URL).await.unwrap();
    let list = std::env::var("CAPTURE_MARKETS").unwrap_or_else(|_| "BTCUSDT,PAXGUSDT,NOPEUSDT".to_string());
    let markets: Vec<&str> = list.split(',').collect();
    let frame = json!({ "type": "subscribe", "payload": { "channels": [
        { "name": CHANNEL, "symbols": markets },
        { "name": "funding_rate", "symbols": markets },
        { "name": "nope_channel", "symbols": ["BTCUSDT"] },
    ] } });
    socket.send(Message::text(frame.to_string())).await.unwrap();
    socket.send(Message::text(r#"{"type":"subscribe","payload":{"channels":[{"name":"l2_updates","symbols":["BTCUSDT"]}]}}"#)).await.unwrap();
    socket.send(Message::text(r#"{"type":"ping"}"#)).await.unwrap();
    socket.send(Message::text("not json")).await.unwrap();

    let seconds = std::env::var("CAPTURE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(20);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    let mut updates = 0;
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, socket.next()).await {
        let Message::Text(text) = message else {
            continue;
        };
        let update = text.contains(r#""action":"update""#);
        if !update || updates < 12 {
            println!("{text}");
        }
        updates += usize::from(update);
    }
}
