// Ported case for case from old_ts_server/src/venues/okx/okx.spec.ts.
// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

const SNAPSHOT_BIDS: &[[&str; 4]] = &[["79904.6", "362.46", "0", "52"], ["79904.5", "10", "0", "2"]];
const SNAPSHOT_ASKS: &[[&str; 4]] = &[["79904.7", "42.95", "0", "16"], ["79904.8", "5", "0", "1"]];
const NO_LEVELS: &[[&str; 4]] = &[];

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    testing::market(ID, raw_market_id, &raw_market_id[..3], "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}-USDT-SWAP")));
    }
    markets
}

fn venue() -> Okx {
    Okx::new(&[])
}

fn connection() -> Connection<HashMap<usize, i64>> {
    Connection::for_test("okx#swap#0", vec![market("BTC-USDT-SWAP")])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// The shape captured live on 2026-09-07, with the level count cut down.
// The checksum is retired and always 0.
fn books_frame(
    inst_id: &str,
    action: &str,
    prev_seq_id: i64,
    seq_id: i64,
    bids: &[[&str; 4]],
    asks: &[[&str; 4]],
) -> Value {
    json!({
        "arg": { "channel": "books", "instId": inst_id },
        "action": action,
        "data": [{ "asks": asks, "bids": bids, "ts": "1788746279107", "checksum": 0, "prevSeqId": prev_seq_id, "seqId": seq_id }],
    })
}

fn snapshot(seq_id: i64) -> Value {
    books_frame("BTC-USDT-SWAP", "snapshot", -1, seq_id, SNAPSHOT_BIDS, SNAPSHOT_ASKS)
}

fn send_bytes(conn: &mut Connection<HashMap<usize, i64>>, frame: &[u8]) -> Published {
    venue().handle(frame, conn).unwrap();
    conn.take_published()
}

fn send(conn: &mut Connection<HashMap<usize, i64>>, frame: Value) -> Published {
    send_bytes(conn, frame.to_string().as_bytes())
}

fn text(frame: &Message) -> String {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    text.as_str().to_string()
}

// plan

#[test]
fn chunks_every_market_onto_the_one_public_endpoint() {
    let plans = venue().plan(&markets(300));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["okx#swap#0", "okx#swap#1"]);
    assert_eq!(plans[0].markets.len(), 250);
    assert_eq!(plans[1].markets.len(), 50);
    assert_eq!(plans[0].url, "wss://ws.okx.com:8443/ws/v5/public");
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames

#[test]
fn builds_one_books_argument_per_market_and_splits_them_across_frames() {
    let frames = venue().subscribe_frames(&markets(250), &mut HashMap::new());

    assert_eq!(frames.len(), 2);
    let first: Value = serde_json::from_str(&text(&frames[0])).unwrap();
    let second: Value = serde_json::from_str(&text(&frames[1])).unwrap();
    assert_eq!(first["op"], "subscribe");
    assert_eq!(first["args"].as_array().unwrap().len(), 200);
    assert_eq!(first["args"][0], json!({ "channel": "books", "instId": "SYM0-USDT-SWAP" }));
    assert_eq!(second["args"].as_array().unwrap().len(), 50);
    assert_eq!(first["id"], "sub0");
    assert_eq!(second["id"], "sub1");
}

// settings and ping

#[test]
fn pings_with_text_every_20_s_and_staggers_its_handshakes() {
    let venue = venue();
    let settings = venue.settings();

    assert_eq!(text(&venue.ping(&mut HashMap::new())), "ping");
    assert_eq!(settings.ping_every, Some(Duration::from_secs(20)));
    assert_eq!(settings.max_silence, Duration::from_secs(60));
    assert_eq!(settings.connect_stagger, Duration::from_millis(400));
}

// handle

#[test]
fn hands_the_engine_a_subscribed_snapshot_as_the_whole_book_reading_the_first_two_of_each_tuple() {
    let mut conn = connection();

    let published = send(&mut conn, snapshot(100));

    assert_eq!(
        published,
        [(
            "BTC-USDT-SWAP".to_string(),
            levels(&[(79904.6, 362.46), (79904.5, 10.0)]),
            levels(&[(79904.7, 42.95), (79904.8, 5.0)]),
        )]
    );
}

#[test]
fn applies_an_update_whose_prev_seq_id_is_the_last_seq_id() {
    let mut conn = connection();
    send(&mut conn, snapshot(100));

    let published = send(
        &mut conn,
        books_frame("BTC-USDT-SWAP", "update", 100, 101, &[["79904.6", "0", "0", "0"]], &[["79904.7", "1", "0", "1"]]),
    );

    assert_eq!(published[0].1, levels(&[(79904.5, 10.0)]));
    assert_eq!(published[0].2, levels(&[(79904.7, 1.0), (79904.8, 5.0)]));
}

#[test]
fn skips_a_liveness_update_and_keeps_the_chain_where_it_was() {
    let mut conn = connection();
    send(&mut conn, snapshot(100));

    let liveness = send(&mut conn, books_frame("BTC-USDT-SWAP", "update", 100, 100, NO_LEVELS, NO_LEVELS));
    let next = send(
        &mut conn,
        books_frame("BTC-USDT-SWAP", "update", 100, 101, &[["79904.4", "1", "0", "1"]], NO_LEVELS),
    );

    assert!(liveness.is_empty());
    assert_eq!(next.len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn restarts_the_connection_when_prev_seq_id_does_not_chain() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, snapshot(100));

    let published = send(
        &mut conn,
        books_frame("BTC-USDT-SWAP", "update", 101, 102, &[["79904.4", "1", "0", "1"]], NO_LEVELS),
    );

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync.len(), 1);
    assert_eq!(resync[0].text("market"), "BTC-USDT-SWAP");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn restarts_the_connection_on_an_update_with_no_snapshot_behind_it() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(
        &mut conn,
        books_frame("BTC-USDT-SWAP", "update", 99, 100, &[["79904.4", "1", "0", "1"]], NO_LEVELS),
    );

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "update_before_snapshot");
}

#[test]
fn returns_on_the_literal_pong_keepalive_answer_without_parsing_it() {
    let mut conn = connection();

    let published = send_bytes(&mut conn, b"pong");

    assert!(published.is_empty());
}

#[test]
fn drops_an_inst_id_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let first = send(&mut conn, books_frame("ETH-USDT-SWAP", "snapshot", -1, 1, SNAPSHOT_BIDS, SNAPSHOT_ASKS));
    let second = send(&mut conn, books_frame("ETH-USDT-SWAP", "snapshot", -1, 1, SNAPSHOT_BIDS, SNAPSHOT_ASKS));

    assert!(first.is_empty() && second.is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

#[test]
fn logs_an_error_event_and_a_notice_event_and_stays_silent_on_an_acknowledgement() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(
        &mut conn,
        json!({ "id": "sub0", "event": "subscribe", "arg": { "channel": "books", "instId": "BTC-USDT-SWAP" }, "connId": "f280d68a" }),
    );
    send(&mut conn, json!({ "event": "error", "code": "60018", "msg": "Wrong URL" }));
    send(
        &mut conn,
        json!({ "event": "notice", "code": "64008", "msg": "The connection will soon be closed for a service upgrade." }),
    );

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("code"), "60018");
    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].level, Level::WARN);
    assert_eq!(notices[0].text("code"), "64008");
}
