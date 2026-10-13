// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::clock::now_ms;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str, base: &str) -> Market {
    testing::market(ID, raw_market_id, base, "USDC", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&i.to_string(), &format!("SYM{i}")));
    }
    markets
}

fn venue() -> Lighter {
    Lighter::new(&[])
}

fn connection() -> Connection<State> {
    Connection::for_test("lighter#perp#0", vec![market("185", "BOT"), market("1", "BTC")])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// Book frames of BOT, the stock, captured live on 2026-10-12 at 23:06 UTC, with the snapshot cut to three bids and four asks of 19 and 32.
fn bot_snapshot() -> Value {
    json!({"channel":"order_book:185","last_updated_at":1791846371251693_i64,"offset":58317,"order_book":{"code":0,
        "asks":[{"price":"26.238","size":"7.000"},{"price":"26.247","size":"32.580"},{"price":"26.255","size":"64.819"},{"price":"26.263","size":"2.414"}],
        "bids":[{"price":"26.000","size":"122.548"},{"price":"25.948","size":"154.155"},{"price":"25.896","size":"154.465"}],
        "offset":58317,"nonce":24487601008_i64,"last_updated_at":1791846371251693_i64,"begin_nonce":0},"timestamp":1791846371779_i64,"type":"subscribed/order_book"})
}

// The two deltas that followed, each moving three asks by removing them at size "0.000" and adding them a tick away.
fn bot_delta() -> Value {
    json!({"channel":"order_book:185","last_updated_at":1791846371912725_i64,"offset":58319,"order_book":{"code":0,
        "asks":[{"price":"26.247","size":"0.000"},{"price":"26.248","size":"32.896"},{"price":"26.255","size":"0.000"},{"price":"26.256","size":"64.495"},{"price":"26.263","size":"0.000"},{"price":"26.264","size":"2.437"}],
        "bids":[],"offset":58319,"nonce":24487601586_i64,"last_updated_at":1791846371912725_i64,"begin_nonce":24487601008_i64},"timestamp":1791846371967_i64,"type":"update/order_book"})
}

fn bot_second_delta() -> Value {
    json!({"channel":"order_book:185","last_updated_at":1791846374084215_i64,"offset":58321,"order_book":{"code":0,
        "asks":[{"price":"26.248","size":"0.000"},{"price":"26.254","size":"32.889"},{"price":"26.256","size":"0.000"},{"price":"26.262","size":"64.480"},{"price":"26.264","size":"0.000"},{"price":"26.270","size":"2.437"}],
        "bids":[],"offset":58321,"nonce":24487604095_i64,"last_updated_at":1791846374084215_i64,"begin_nonce":24487601586_i64},"timestamp":1791846374114_i64,"type":"update/order_book"})
}

// The acknowledgement of an unsubscribe, spaced as the venue sends it.
fn bot_unsubscribed() -> &'static str {
    r#"{"type": "unsubscribed", "channel": "order_book:185"}"#
}

fn send(conn: &mut Connection<State>, frame: Value) -> Published {
    send_text(conn, &frame.to_string())
}

fn send_text(conn: &mut Connection<State>, frame: &str) -> Published {
    venue().handle(frame.as_bytes(), conn).unwrap();
    conn.take_published()
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

fn sent(conn: &mut Connection<State>) -> Vec<Value> {
    conn.take_sent().iter().map(parsed).collect()
}

const BOT_SNAPSHOT_BIDS: [(f64, f64); 3] = [(26.0, 122.548), (25.948, 154.155), (25.896, 154.465)];

// plan and settings

#[test]
fn puts_every_market_on_one_read_only_socket_up_to_450() {
    let one = venue().plan(&markets(197));
    let two = venue().plan(&markets(451));

    assert_eq!(one.len(), 1);
    assert_eq!(one[0].id, "lighter#perp#0");
    assert_eq!(one[0].url, "wss://mainnet.zklighter.elliot.ai/stream?readonly=true");
    assert_eq!(one[0].markets.len(), 197);
    let sizes: Vec<usize> = two.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [450, 1]);
    assert_eq!(two[1].id, "lighter#perp#1");
}

#[test]
fn pings_every_30_s_paces_its_subscribes_under_the_ip_cap_and_ends_a_socket_silent_for_10_s() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(30)));
    assert_eq!(settings.subscribe_gap, Duration::from_millis(400));
    assert_eq!(settings.max_silence, Duration::from_secs(10));
    assert_eq!(settings.connect_stagger, Duration::from_millis(400 * 451));
}

#[test]
fn the_ping_is_the_venue_text_ping() {
    assert_eq!(parsed(&venue().ping(&mut State::default())), json!({ "type": "ping" }));
}

// subscribe_frames

#[test]
fn subscribes_the_stats_of_every_market_first_then_one_book_per_frame() {
    let frames: Vec<Value> = venue()
        .subscribe_frames(&[market("0", "ETH"), market("1", "BTC"), market("4096", "OURA")], &mut State::default())
        .iter()
        .map(parsed)
        .collect();

    assert_eq!(
        frames,
        [
            json!({ "type": "subscribe", "channel": "market_stats/all" }),
            json!({ "type": "subscribe", "channel": "order_book/0" }),
            json!({ "type": "subscribe", "channel": "order_book/1" }),
            json!({ "type": "subscribe", "channel": "order_book/4096" }),
        ]
    );
}

// handle: books

#[test]
fn hands_the_engine_a_snapshot_as_the_whole_book() {
    let mut conn = connection();

    let published = send(&mut conn, bot_snapshot());

    assert_eq!(
        published,
        [(
            "185".to_string(),
            levels(&BOT_SNAPSHOT_BIDS),
            levels(&[(26.238, 7.0), (26.247, 32.58), (26.255, 64.819), (26.263, 2.414)]),
        )]
    );
}

#[test]
fn applies_deltas_whose_begin_nonce_is_the_last_nonce_and_removes_a_level_sent_with_size_zero() {
    let mut conn = connection();
    send(&mut conn, bot_snapshot());

    let first = send(&mut conn, bot_delta());
    let second = send(&mut conn, bot_second_delta());

    assert_eq!(first[0].2, levels(&[(26.238, 7.0), (26.248, 32.896), (26.256, 64.495), (26.264, 2.437)]));
    assert_eq!(second[0].1, levels(&BOT_SNAPSHOT_BIDS));
    assert_eq!(second[0].2, levels(&[(26.238, 7.0), (26.254, 32.889), (26.262, 64.48), (26.27, 2.437)]));
    assert!(conn.take_sent().is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn a_delta_that_does_not_continue_the_last_nonce_empties_the_book_and_unsubscribes_that_market_only() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, bot_snapshot());

    let published = send(&mut conn, bot_second_delta());

    assert_eq!(published, [("185".to_string(), Vec::new(), Vec::new())]);
    assert_eq!(sent(&mut conn), [json!({ "type": "unsubscribe", "channel": "order_book/185" })]);
    assert!(!conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync.len(), 1);
    assert_eq!(resync[0].text("market"), "185");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
    assert_eq!(resync[0].text("action"), "resubscribe");
}

#[test]
fn subscribes_again_once_the_unsubscribe_is_acknowledged_and_takes_the_fresh_snapshot() {
    let mut conn = connection();
    send(&mut conn, bot_snapshot());
    send(&mut conn, bot_second_delta());
    conn.take_sent();

    let in_flight = send(&mut conn, bot_delta());
    let before_ack = sent(&mut conn);
    send_text(&mut conn, bot_unsubscribed());
    let after_ack = sent(&mut conn);

    // A fresh snapshot carries the venue's current nonce, here the one the next captured delta continues.
    let mut fresh = bot_snapshot();
    fresh["order_book"]["nonce"] = json!(24487601586_i64);
    let snapshot = send(&mut conn, fresh);
    let next = send(&mut conn, bot_second_delta());

    assert!(in_flight.is_empty());
    assert!(before_ack.is_empty());
    assert_eq!(after_ack, [json!({ "type": "subscribe", "channel": "order_book/185" })]);
    assert_eq!(snapshot[0].1, levels(&BOT_SNAPSHOT_BIDS));
    assert_eq!(next[0].2, levels(&[(26.238, 7.0), (26.247, 32.58), (26.254, 32.889), (26.255, 64.819), (26.262, 64.48), (26.263, 2.414), (26.27, 2.437)]));
    assert!(!conn.resync_requested());
}

#[test]
fn an_acknowledgement_of_a_market_under_no_repair_sends_nothing() {
    let mut conn = connection();
    send(&mut conn, bot_snapshot());

    send_text(&mut conn, bot_unsubscribed());

    assert!(conn.take_sent().is_empty());
}

#[test]
fn a_delta_before_any_snapshot_repairs_the_market() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(&mut conn, bot_delta());

    assert_eq!(published, [("185".to_string(), Vec::new(), Vec::new())]);
    assert_eq!(sent(&mut conn), [json!({ "type": "unsubscribe", "channel": "order_book/185" })]);
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn a_level_that_does_not_parse_repairs_the_market_rather_than_skipping_it() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, bot_snapshot());
    let mut delta = bot_delta();
    delta["order_book"]["asks"][0]["size"] = json!("");

    let published = send(&mut conn, delta);

    assert_eq!(published, [("185".to_string(), Vec::new(), Vec::new())]);
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn keeps_the_books_of_two_markets_apart() {
    let mut conn = connection();
    send(&mut conn, bot_snapshot());

    // BTC's snapshot from the same capture, cut to one level a side.
    let published = send(
        &mut conn,
        json!({"channel":"order_book:1","last_updated_at":1791846371743485_i64,"offset":6729814,"order_book":{"code":0,
            "asks":[{"price":"81864.4","size":"2.89562"}],"bids":[{"price":"81864.3","size":"0.00020"}],
            "offset":6729814,"nonce":24487601400_i64,"last_updated_at":1791846371743485_i64,"begin_nonce":0},"timestamp":1791846371800_i64,"type":"subscribed/order_book"}),
    );
    let bot = send(&mut conn, bot_delta());

    assert_eq!(published, [("1".to_string(), levels(&[(81864.3, 0.0002)]), levels(&[(81864.4, 2.89562)]))]);
    assert_eq!(bot.len(), 1);
    assert_eq!(bot[0].0, "185");
}

#[test]
fn drops_a_book_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = Connection::for_test("lighter#perp#0", vec![market("1", "BTC")]);

    let snapshot = send(&mut conn, bot_snapshot());
    let delta = send(&mut conn, bot_delta());

    assert!(snapshot.is_empty() && delta.is_empty());
    assert!(conn.take_sent().is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

// handle: session and errors

#[test]
fn logs_an_error_frame_and_keeps_the_socket() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send_text(&mut conn, r#"{"error":{"code":30005,"message":"Invalid Channel:  (marketId)"}}"#);

    assert!(published.is_empty());
    assert!(conn.take_sent().is_empty());
    assert!(!conn.resync_requested());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "lighter#perp#0");
    assert_eq!(errors[0].number("code"), 30005.0);
    assert_eq!(errors[0].text("message"), "Invalid Channel:  (marketId)");
}

#[test]
fn answers_a_server_ping_and_stays_silent_on_a_pong_and_the_greeting() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send_text(&mut conn, r#"{"session_id":"ca3cbdcf-9ccf-4348-ae0e-f0c65b517757","type":"connected"}"#);
    send_text(&mut conn, r#"{"type":"pong"}"#);
    assert!(conn.take_sent().is_empty());
    send_text(&mut conn, r#"{"type":"ping"}"#);

    assert_eq!(sent(&mut conn), [json!({ "type": "pong" })]);
    assert!(logs.events("venue_notice").is_empty());
}

#[test]
fn logs_a_frame_of_an_unknown_type_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send_text(&mut conn, r#"{"type":"shutdown","close_in_ms":5000}"#);

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].text("kind"), "shutdown");
}

#[test]
fn fails_a_frame_that_is_not_json_or_a_book_frame_without_its_book() {
    let mut conn = connection();

    assert!(venue().handle(b"not json", &mut conn).is_err());
    assert!(venue().handle(br#"{"channel":"order_book:185","type":"update/order_book"}"#, &mut conn).is_err());
}

// probe

// Prints every frame of the channels named, then repairs the first one as the feed does, which is how the frames above were captured:
// CAPTURE_CHANNELS=order_book/185,order_book/1 CAPTURE_SECONDS=14 cargo test lighter::tests::capture_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let channels: Vec<String> = std::env::var("CAPTURE_CHANNELS")
        .unwrap_or_else(|_| "order_book/1".to_string())
        .split(',')
        .map(str::to_string)
        .collect();
    let seconds: u64 = std::env::var("CAPTURE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(10);

    let (mut ws, _) = tokio_tungstenite::connect_async(URL).await.unwrap();
    for channel in &channels {
        ws.send(command("subscribe", channel)).await.unwrap();
    }
    ws.send(command("subscribe", "order_book/9999")).await.unwrap();

    let started = tokio::time::Instant::now();
    let deadline = started + Duration::from_secs(seconds);
    let mut repaired = false;
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            continue;
        };
        println!("{} {}", now_ms(), text.as_str());

        if !repaired && started.elapsed() > Duration::from_secs(seconds / 2) {
            repaired = true;
            ws.send(command("unsubscribe", &channels[0])).await.unwrap();
            ws.send(Message::text(r#"{"type":"ping"}"#)).await.unwrap();
        }
        if text.as_str().contains("unsubscribed") {
            ws.send(command("subscribe", &channels[0])).await.unwrap();
        }
    }
}
