// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use flate2::Compression;
use flate2::write::GzEncoder;
use serde_json::{Value, json};
use std::io::Write;
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;
type State = HashMap<usize, i64>;

fn market(raw_market_id: &str) -> Market {
    let (base, quote) = raw_market_id.split_once('-').unwrap();
    testing::market(ID, raw_market_id, base, quote, true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}-USDT")));
    }
    markets
}

fn venue() -> Htx {
    Htx::new(&[])
}

fn connection(raw_ids: &[&str]) -> Connection<State> {
    let mut list = Vec::with_capacity(raw_ids.len());
    for id in raw_ids {
        list.push(market(id));
    }
    Connection::for_test("htx#swap#0", list)
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

fn gzip(text: &[u8]) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(text).unwrap();
    encoder.finish().unwrap()
}

// Every frame arrives as binary gzip, so each case sends what the socket sends.
fn send(conn: &mut Connection<State>, frame: Value) -> Published {
    venue().handle(&gzip(frame.to_string().as_bytes()), conn).unwrap();
    conn.take_published()
}

fn depth(code: &str, event: &str, version: i64, bids: Value, asks: Value) -> Value {
    let ch = format!("market.{code}.depth.size_20.high_freq");
    json!({
        "ch": ch, "ts": 1791524010706_i64,
        "tick": { "asks": asks, "bids": bids, "ch": ch, "event": event, "id": 100130469049362_i64, "mrid": 100130469049362_i64, "ts": 1791524010701_i64, "version": version },
    })
}

// The acknowledgement, snapshot and first updates of BTC-USDT captured live on 2026-10-08, cut to three levels a side.
fn ack(code: &str) -> Value {
    json!({
        "id": code, "status": "ok", "subbed": format!("market.{code}.depth.size_20.high_freq"),
        "tick": { "asks": null, "bids": null }, "ts": 1791524010749_i64,
    })
}

fn btc_snapshot() -> Value {
    depth(
        "BTC-USDT",
        "snapshot",
        1789911177396,
        json!([[82472.1, 1436], [82471, 78], [82469.5, 64]]),
        json!([[82472.2, 5212], [82475.4, 92], [82475.5, 308]]),
    )
}

// It adds an ask and deletes one that was never in the cut book.
fn btc_update() -> Value {
    depth("BTC-USDT", "update", 1789911177397, json!([]), json!([[82476.2, 777], [82484.7, 0]]))
}

fn btc_update_at(version: i64, bids: Value, asks: Value) -> Value {
    depth("BTC-USDT", "update", version, bids, asks)
}

fn snapshotted_btc() -> Connection<State> {
    let mut conn = connection(&["BTC-USDT"]);
    send(&mut conn, ack("BTC-USDT"));
    send(&mut conn, btc_snapshot());
    conn
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// plan

#[test]
fn puts_150_contracts_on_each_connection_to_the_usdt_margined_endpoint() {
    let plans = venue().plan(&markets(377));

    assert_eq!(plans.len(), 3);
    assert_eq!(plans[0].id, "htx#swap#0");
    assert_eq!(plans[2].id, "htx#swap#2");
    assert!(plans.iter().all(|plan| plan.url == "wss://api.hbdm.vn/linear-swap-ws"));
    assert_eq!(plans[0].markets.len(), 150);
    assert_eq!(plans[2].markets.len(), 77);
}

#[test]
fn answers_server_pings_with_no_client_ping_and_paces_subscriptions_at_40_a_second() {
    let settings = venue().settings();

    assert_eq!(settings.max_silence, Duration::from_secs(15));
    assert_eq!(settings.ping_every, None);
    assert_eq!(settings.subscribe_gap, Duration::from_millis(25));
    assert_eq!(settings.connect_stagger, Duration::from_secs(4));
}

#[test]
fn subscribes_one_incremental_20_level_topic_per_frame_with_the_code_as_id() {
    let frames = venue().subscribe_frames(&[market("BTC-USDT"), market("ETH-USDT")], &mut State::default());

    assert_eq!(frames.len(), 2);
    assert_eq!(
        parsed(&frames[0]),
        json!({ "sub": "market.BTC-USDT.depth.size_20.high_freq", "data_type": "incremental", "id": "BTC-USDT" })
    );
    assert_eq!(parsed(&frames[1])["sub"], "market.ETH-USDT.depth.size_20.high_freq");
}

// keepalive

#[test]
fn answers_the_server_ping_with_a_pong_of_the_same_number_and_publishes_nothing() {
    let mut conn = connection(&["BTC-USDT"]);

    let published = send(&mut conn, json!({ "ping": 1791524027880_i64 }));

    assert!(published.is_empty());
    let sent = conn.take_sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(parsed(&sent[0]), json!({ "pong": 1791524027880_i64 }));
}

// book

#[test]
fn stays_silent_on_the_acknowledgement_and_publishes_the_snapshot_as_sent() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-USDT"]);

    assert!(send(&mut conn, ack("BTC-USDT")).is_empty());
    let published = send(&mut conn, btc_snapshot());

    assert_eq!(
        published,
        [(
            "BTC-USDT".to_string(),
            levels(&[(82472.1, 1436.0), (82471.0, 78.0), (82469.5, 64.0)]),
            levels(&[(82472.2, 5212.0), (82475.4, 92.0), (82475.5, 308.0)]),
        )]
    );
    assert!(logs.events("venue_error").is_empty());
}

#[test]
fn applies_the_next_version_with_a_zero_size_deleting_its_level() {
    let mut conn = snapshotted_btc();

    let published = send(&mut conn, btc_update());
    assert_eq!(published[0].2, levels(&[(82472.2, 5212.0), (82475.4, 92.0), (82475.5, 308.0), (82476.2, 777.0)]));

    let published = send(&mut conn, btc_update_at(1789911177398, json!([[82471, 0], [82470, 5]]), json!([])));
    assert_eq!(published[0].1, levels(&[(82472.1, 1436.0), (82470.0, 5.0), (82469.5, 64.0)]));
    assert!(!conn.resync_requested());
}

#[test]
fn an_empty_update_advances_the_version_so_the_one_after_it_applies() {
    let mut conn = snapshotted_btc();

    send(&mut conn, btc_update_at(1789911177397, json!([]), json!([])));
    let published = send(&mut conn, btc_update_at(1789911177398, json!([[82472.0, 9]]), json!([])));

    assert_eq!(published[0].1[1], BookLevel { price: 82472.0, size: 9.0 });
    assert!(!conn.resync_requested());
}

#[test]
fn resyncs_on_a_skipped_version() {
    let (logs, _capture) = capture();
    let mut conn = snapshotted_btc();

    let published = send(&mut conn, btc_update_at(1789911177398, json!([[82472.0, 9]]), json!([])));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_gap");
}

#[test]
fn resyncs_on_a_repeated_version() {
    let mut conn = snapshotted_btc();
    send(&mut conn, btc_update());

    send(&mut conn, btc_update());

    assert!(conn.resync_requested());
}

#[test]
fn resyncs_on_an_update_before_any_snapshot() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-USDT"]);
    send(&mut conn, ack("BTC-USDT"));

    let published = send(&mut conn, btc_update());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "update_before_snapshot");
}

#[test]
fn a_second_snapshot_replaces_the_book_and_restarts_the_chain() {
    let mut conn = snapshotted_btc();
    send(&mut conn, btc_update());

    let published = send(
        &mut conn,
        depth("BTC-USDT", "snapshot", 1789911177500, json!([[82480.0, 1]]), json!([[82481.0, 2]])),
    );
    assert_eq!(published[0].1, levels(&[(82480.0, 1.0)]));
    assert_eq!(published[0].2, levels(&[(82481.0, 2.0)]));

    send(&mut conn, btc_update_at(1789911177501, json!([[82479.0, 3]]), json!([])));
    assert!(!conn.resync_requested());
}

#[test]
fn chains_each_market_by_its_own_version() {
    let mut conn = connection(&["BTC-USDT", "STEEM-USDT"]);
    send(&mut conn, btc_snapshot());
    // STEEM-USDT's snapshot and first update captured live on 2026-10-08, cut to three levels a side.
    send(
        &mut conn,
        depth("STEEM-USDT", "snapshot", 1789896349976, json!([[0.06063, 1439], [0.06058, 2109], [0.06049, 3955]]), json!([[0.06073, 1895], [0.06075, 100174], [0.06076, 2680]])),
    );

    let published = send(
        &mut conn,
        depth("STEEM-USDT", "update", 1789896349977, json!([[0.06054, 11276], [0.05793, 0]]), json!([[0.06375, 1171], [0.0641, 0]])),
    );
    send(&mut conn, btc_update());

    assert_eq!(published[0].0, "STEEM-USDT");
    assert_eq!(published[0].1.len(), 4);
    assert!(!conn.resync_requested());
}

#[test]
fn drops_a_book_frame_for_an_unknown_code_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-USDT"]);

    let mut stray = btc_snapshot();
    stray["ch"] = json!("market.ETH-USDT.depth.size_20.high_freq");
    assert!(send(&mut conn, stray.clone()).is_empty());
    assert!(send(&mut conn, stray).is_empty());

    let warnings = logs.events("unsubscribed_symbol");
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].text("market"), "ETH-USDT");
}

#[test]
fn ignores_a_channel_it_did_not_subscribe() {
    let mut conn = connection(&["BTC-USDT"]);

    let mut bbo = btc_snapshot();
    bbo["ch"] = json!("market.BTC-USDT.bbo");

    assert!(send(&mut conn, bbo).is_empty());
    assert!(!conn.resync_requested());
}

// errors

#[test]
fn logs_a_refused_topic_and_a_refused_frame_as_venue_errors() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-USDT"]);

    // Both captured live on 2026-10-08.
    send(
        &mut conn,
        json!({
            "err-code": "bad-request", "err-msg": "invalid topic market.NOPE-USDT.depth.size_20.high_freq", "id": "NOPE-USDT",
            "status": "error", "tick": { "asks": null, "bids": null }, "ts": 1791524010791_i64,
        }),
    );
    send(
        &mut conn,
        json!({
            "err-code": "bad-request", "err-msg": "not json, is not json string", "id": "", "status": "error",
            "tick": { "asks": null, "bids": null }, "ts": 1791524010791_i64,
        }),
    );

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "htx#swap#0");
    assert_eq!(errors[0].text("market"), "NOPE-USDT");
    assert_eq!(errors[0].text("code"), "bad-request");
    assert_eq!(errors[0].text("message"), "invalid topic market.NOPE-USDT.depth.size_20.high_freq");
    assert_eq!(errors[1].text("market"), "");
}

#[test]
fn reads_a_frame_that_arrives_as_plain_text() {
    let mut conn = connection(&["BTC-USDT"]);

    venue().handle(btc_snapshot().to_string().as_bytes(), &mut conn).unwrap();

    assert_eq!(conn.take_published().len(), 1);
}

#[test]
fn reports_a_frame_that_is_neither_gzip_nor_json() {
    let mut conn = connection(&["BTC-USDT"]);

    assert!(venue().handle(b"not json", &mut conn).is_err());
    assert!(venue().handle(&[0x1f, 0x8b, 0x00], &mut conn).is_err());
}

// A probe of the live socket, which prints each frame decompressed with its levels cut to three a side:
// cargo test htx::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let (mut ws, _) = tokio_tungstenite::connect_async(PUBLIC_URL).await.unwrap();
    for code in ["BTC-USDT", "STEEM-USDT", "NOPE-USDT", "CYBER-USDT"] {
        let frame = json!({ "sub": format!("market.{code}.{CHANNEL_SUFFIX}"), "data_type": "incremental", "id": code });
        ws.send(Message::text(frame.to_string())).await.unwrap();
    }
    ws.send(Message::text("not json")).await.unwrap();
    let wrong = json!({ "sub": "market.BTC-USDT.depth.size_30.high_freq", "data_type": "incremental", "id": "size30" });
    ws.send(Message::text(wrong.to_string())).await.unwrap();

    let seconds: u64 = std::env::var("PROBE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(12);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Binary(bytes) = message else {
            println!("non binary {message:?}");
            continue;
        };
        let text = wire::gunzip(&bytes).unwrap();
        let mut value: Value = serde_json::from_slice(&text).unwrap();
        if let Some(ping) = value["ping"].as_i64() {
            println!("{value}");
            ws.send(Message::text(json!({ "pong": ping }).to_string())).await.unwrap();
            continue;
        }
        for side in ["bids", "asks"] {
            if let Some(levels) = value["tick"][side].as_array_mut() {
                print!("{side} {} ", levels.len());
                levels.truncate(3);
            }
        }
        println!("{value}");
    }
}
