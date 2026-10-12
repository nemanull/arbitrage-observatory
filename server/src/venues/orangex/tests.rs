// The engine's received levels are read through Connection::take_published after each frame or snapshot.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

const BTC: &str = "BTC-USDT-PERPETUAL";
const CHINESE: &str = "币安人生-USDT-PERPETUAL";

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.split('-').next().unwrap();
    Market {
        taker_ppm: 600,
        ..testing::market(ID, raw_market_id, base, "USDT", true)
    }
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}-USDT-PERPETUAL")));
    }
    markets
}

fn venue() -> Orangex {
    Orangex::new()
}

fn connection(ids: &[&str]) -> Connection<State> {
    Connection::for_test("orangex#perp#0", ids.iter().map(|id| market(id)).collect())
}

fn subscribed(ids: &[&str]) -> Connection<State> {
    let mut conn = connection(ids);
    let slice = conn.markets().to_vec();
    venue().subscribe_frames(&slice, &mut conn.state);
    conn
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

fn send(conn: &mut Connection<State>, frame: Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn snapshot(conn: &mut Connection<State>, position: usize, body: Value) -> Published {
    venue().handle_snapshot(position, body.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

// The acknowledgement of a subscribe, as the venue answered on 2026-10-09 with the id as a string.
fn ack(id: u64, ids: &[&str]) -> Value {
    let channels: Vec<String> = ids.iter().map(|id| channel(id)).collect();
    json!({ "id": id.to_string(), "jsonrpc": "2.0", "usIn": 1791572059760_i64, "usOut": 1791572059761_i64, "usDiff": 1, "result": channels })
}

// The BTC-USDT-PERPETUAL REST book of 2026-10-09 at version 271807808, read while the socket was at 271807811, cut to three levels a side.
const BTC_VERSION: i64 = 271807808;

fn btc_snapshot(version: i64) -> Value {
    json!({
        "jsonrpc": "2.0", "usIn": 1791572258589_i64, "usOut": 1791572258595_i64, "usDiff": 6,
        "result": {
            "asks": [["82407.3", "5.651"], ["82407.4", "0.832"], ["82407.5", "0.89"]],
            "bids": [["82407.2", "4.361"], ["82407.1", "0.21"], ["82407", "0.737"]],
            "timestamp": "1791572258595", "instrument_name": BTC, "version": version,
        },
    })
}

// Consecutive BTC deltas captured on the same day, each cut to its first levels, with the socket's padded prices.
fn delta(change_id: i64, bids: Value, asks: Value) -> Value {
    json!({
        "params": {
            "data": { "timestamp": 1791572257276_i64, "change_id": change_id, "bids": bids, "asks": asks, "instrument_name": BTC },
            "channel": "book.BTC-USDT-PERPETUAL.raw",
        },
        "method": "subscription", "jsonrpc": "2.0",
    })
}

fn btc_covered() -> Value {
    delta(BTC_VERSION, json!([["new", "82407.2", "4.361"]]), json!([["new", "82407.3", "5.651"]]))
}

fn btc_first() -> Value {
    delta(
        BTC_VERSION + 1,
        json!([["new", "82407.2", "5.284"], ["new", "82407.0", "0.851"]]),
        json!([["new", "82407.3", "3.448"], ["new", "82407.4", "0.269"]]),
    )
}

fn btc_second() -> Value {
    delta(BTC_VERSION + 2, json!([["new", "82407.2", "3.167"], ["new", "82407.1", "0.244"]]), json!([["new", "82407.3", "5.448"]]))
}

fn btc_third() -> Value {
    delta(BTC_VERSION + 3, json!([["new", "82407.2", "5.063"]]), json!([["new", "82407.3", "4.988"]]))
}

// A BTC connection whose snapshot fetch has started, so the runtime has taken it off the queue, as a request made now shows.
fn waiting() -> Connection<State> {
    let mut conn = connection(&[BTC]);
    conn.state.books.insert(0, Seed::Waiting(VecDeque::new()));
    conn
}

// A BTC connection seeded from the snapshot, with nothing published or queued.
fn seeded() -> Connection<State> {
    let mut conn = waiting();
    snapshot(&mut conn, 0, btc_snapshot(BTC_VERSION));
    conn
}

// settings and plan

#[test]
fn puts_30_markets_on_each_connection_to_the_v1_socket() {
    let plans = venue().plan(&markets(205));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [30, 30, 30, 30, 30, 30, 25]);
    assert_eq!(plans[0].id, "orangex#perp#0");
    assert_eq!(plans[6].id, "orangex#perp#6");
    assert_eq!(plans[0].url, "wss://api.orangex.com/ws/api/v1");
}

#[test]
fn pings_every_5_seconds_opens_seven_sockets_within_the_five_a_minute_and_seeds_a_connection_within_the_first_book_wait() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(5)));
    assert_eq!(settings.max_silence, Duration::from_secs(15));
    assert_eq!(settings.connect_stagger, Duration::from_secs(12));
    assert_eq!(settings.snapshot_gap, Duration::from_millis(200));
    assert!(settings.first_book_wait > settings.snapshot_gap * MARKETS_PER_CONNECTION as u32);
    assert!(settings.connect_stagger * 5 >= Duration::from_secs(60));
    assert!(CONNECTIONS < 10);
}

// subscribe_frames and ping

#[test]
fn subscribes_a_connection_in_one_frame_and_remembers_what_its_id_asked_for() {
    let mut state = State::default();

    let frames = venue().subscribe_frames(&markets(30), &mut state);

    assert_eq!(frames.len(), 1);
    let first = parsed(&frames[0]);
    assert_eq!(first["jsonrpc"], "2.0");
    assert_eq!(first["id"], 2);
    assert_eq!(first["method"], "/public/subscribe");
    assert_eq!(first["params"]["channels"].as_array().unwrap().len(), 30);
    assert_eq!(first["params"]["channels"][0], "book.SYM0-USDT-PERPETUAL.raw");
    assert_eq!(state.requested[&2].len(), 30);
    assert_eq!(state.requested[&2][29], "book.SYM29-USDT-PERPETUAL.raw");
}

// The answer of 2026-10-09 to a 31st channel on one socket.
#[test]
fn logs_the_channel_limit_answer_as_a_venue_error_and_resends_nothing() {
    let (logs, _capture) = capture();
    let mut conn = subscribed(&[BTC]);

    let frame = json!({
        "id": "2", "jsonrpc": "2.0", "usIn": 1791573484840_i64, "usOut": 1791573484841_i64, "usDiff": 1,
        "error": { "code": 1005, "message": "Subscription channel limit exceeded", "data": { "limit": "30", "requestedNew": "1", "projected": "31", "current": "30" } },
    });
    send(&mut conn, frame);

    assert!(conn.take_sent().is_empty());
    let error = logs.events("venue_error");
    assert_eq!(error[0].number("code"), 1005.0);
    assert_eq!(error[0].text("message"), "Subscription channel limit exceeded");
}

#[test]
fn pings_with_the_json_rpc_ping() {
    let ping = parsed(&venue().ping(&mut State::default()));

    assert_eq!(ping, json!({ "jsonrpc": "2.0", "id": 1, "method": "/public/ping" }));
}

#[test]
fn takes_the_pong_quietly() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[BTC]);

    let published = send(&mut conn, json!({ "id": "1", "jsonrpc": "2.0", "usIn": 1791572063987_i64, "usOut": 1791572063987_i64, "result": {} }));

    assert!(published.is_empty());
    assert!(logs.lines().iter().all(|line| line.level > Level::INFO));
}

// acknowledgement, refusals and snapshot requests

#[test]
fn asks_for_the_snapshot_of_every_acknowledged_market_in_order() {
    let (logs, _capture) = capture();
    let mut conn = subscribed(&[BTC, "ETH-USDT-PERPETUAL", CHINESE]);

    let published = send(&mut conn, ack(2, &[CHINESE, BTC, "ETH-USDT-PERPETUAL"]));

    assert!(published.is_empty());
    assert_eq!(conn.queued_snapshots(), [2, 0, 1]);
    assert!(logs.events("subscribe_refused").is_empty());
}

#[test]
fn logs_each_requested_channel_the_acknowledgement_left_out() {
    let (logs, _capture) = capture();
    let mut conn = subscribed(&[BTC, "NOPE-USDT-PERPETUAL"]);

    send(&mut conn, ack(2, &[BTC]));

    assert_eq!(conn.queued_snapshots(), [0]);
    let refused = logs.events("subscribe_refused");
    assert_eq!(refused.len(), 1);
    assert_eq!(refused[0].level, Level::ERROR);
    assert!(refused[0].text("channels").contains("book.NOPE-USDT-PERPETUAL.raw"));
}

// The refusal the venue sent on 2026-10-09 for a frame that held one unknown channel.
fn refusal(id: &str, channel: &str) -> Value {
    json!({
        "id": id, "jsonrpc": "2.0", "usIn": 1791572059757_i64, "usOut": 1791572059758_i64, "usDiff": 1,
        "error": { "code": 3401, "message": "channel regex not match", "data": { "channel": channel } },
    })
}

#[test]
fn sends_a_refused_frame_again_without_the_channel_the_venue_named() {
    let (logs, _capture) = capture();
    let mut conn = subscribed(&[BTC, "NOPE-USDT-PERPETUAL", CHINESE]);

    send(&mut conn, refusal("2", "book.NOPE-USDT-PERPETUAL.raw"));

    let sent = conn.take_sent();
    assert_eq!(sent.len(), 1);
    let again = parsed(&sent[0]);
    assert_eq!(again["id"], 3);
    assert_eq!(again["params"]["channels"], json!(["book.BTC-USDT-PERPETUAL.raw", "book.币安人生-USDT-PERPETUAL.raw"]));
    let error = logs.events("venue_error");
    assert_eq!(error.len(), 1);
    assert_eq!(error[0].level, Level::ERROR);
    assert_eq!(error[0].number("code"), 3401.0);
    assert_eq!(error[0].text("channel"), "book.NOPE-USDT-PERPETUAL.raw");
    assert_eq!(error[0].text("connection"), "orangex#perp#0");

    // The second frame's acknowledgement seeds the rest without a refusal logged.
    send(&mut conn, ack(3, &[BTC, CHINESE]));
    assert_eq!(conn.queued_snapshots(), [0, 2]);
    assert!(logs.events("subscribe_refused").is_empty());
}

#[test]
fn logs_an_error_frame_with_no_id_and_sends_nothing() {
    let (logs, _capture) = capture();
    let mut conn = subscribed(&[BTC]);

    let frame = json!({ "jsonrpc": "2.0", "usIn": 1791572059761_i64, "usOut": 1791572059761_i64, "usDiff": 0, "error": { "code": 9902, "message": "json parse error" } });
    send(&mut conn, frame);

    assert!(conn.take_sent().is_empty());
    let error = logs.events("venue_error");
    assert_eq!(error.len(), 1);
    assert_eq!(error[0].number("code"), 9902.0);
    assert_eq!(error[0].text("message"), "json parse error");
}

#[test]
fn builds_the_snapshot_url_for_the_top_100_levels_and_percent_encodes_a_chinese_id() {
    assert_eq!(
        venue().snapshot_url(&market(BTC)).unwrap(),
        "https://api.orangex.com/api/v1/public/get_order_book?instrument_name=BTC-USDT-PERPETUAL&depth=100",
    );
    assert_eq!(
        venue().snapshot_url(&market(CHINESE)).unwrap(),
        "https://api.orangex.com/api/v1/public/get_order_book?instrument_name=%E5%B8%81%E5%AE%89%E4%BA%BA%E7%94%9F-USDT-PERPETUAL&depth=100",
    );
}

// seeding

#[test]
fn seeds_the_book_from_the_rest_snapshot() {
    let mut conn = subscribed(&[BTC]);
    send(&mut conn, ack(2, &[BTC]));

    let published = snapshot(&mut conn, 0, btc_snapshot(BTC_VERSION));

    assert_eq!(
        published,
        [(
            BTC.to_string(),
            levels(&[(82407.2, 4.361), (82407.1, 0.21), (82407.0, 0.737)]),
            levels(&[(82407.3, 5.651), (82407.4, 0.832), (82407.5, 0.89)]),
        )]
    );
}

#[test]
fn seeds_an_empty_rest_book_as_an_empty_book() {
    let mut conn = waiting();

    let body = json!({ "jsonrpc": "2.0", "result": { "asks": [], "bids": [], "timestamp": "1791572258595", "instrument_name": BTC, "version": 5 } });
    let published = snapshot(&mut conn, 0, body);

    assert_eq!(published, [(BTC.to_string(), Vec::new(), Vec::new())]);
}

#[test]
fn replays_the_held_deltas_newer_than_the_version_and_drops_the_ones_it_covers() {
    let mut conn = subscribed(&[BTC]);
    send(&mut conn, ack(2, &[BTC]));
    assert!(send(&mut conn, btc_covered()).is_empty());
    assert!(send(&mut conn, btc_first()).is_empty());
    assert!(send(&mut conn, btc_second()).is_empty());

    let published = snapshot(&mut conn, 0, btc_snapshot(BTC_VERSION));

    // "82407.0" on the socket is REST's "82407", so the level is overwritten rather than doubled.
    assert_eq!(published[0].1, levels(&[(82407.2, 3.167), (82407.1, 0.244), (82407.0, 0.851)]));
    assert_eq!(published[0].2, levels(&[(82407.3, 5.448), (82407.4, 0.269), (82407.5, 0.89)]));
    assert!(!conn.resync_requested());

    let next = send(&mut conn, btc_third());
    assert_eq!(next[0].1[0], BookLevel { price: 82407.2, size: 5.063 });
}

#[test]
fn ignores_a_delta_the_snapshot_covers_and_applies_the_next_one() {
    let mut conn = seeded();

    assert!(send(&mut conn, btc_covered()).is_empty());
    let published = send(&mut conn, btc_first());

    assert_eq!(published[0].1[0], BookLevel { price: 82407.2, size: 5.284 });
    assert_eq!(published[0].2[0], BookLevel { price: 82407.3, size: 3.448 });
}

#[test]
fn fetches_again_a_snapshot_behind_the_held_deltas_and_publishes_nothing() {
    let (logs, _capture) = capture();
    let mut conn = waiting();
    send(&mut conn, btc_second());
    send(&mut conn, btc_third());

    let published = snapshot(&mut conn, 0, btc_snapshot(BTC_VERSION));

    assert!(published.is_empty());
    assert_eq!(conn.queued_snapshots(), [0]);
    assert!(!conn.resync_requested());
    let behind = logs.events("snapshot_behind");
    assert_eq!(behind.len(), 1);
    assert_eq!(behind[0].level, Level::WARN);
    assert_eq!(behind[0].number("version"), BTC_VERSION as f64);
    assert_eq!(behind[0].number("change_id"), (BTC_VERSION + 2) as f64);

    // A later snapshot, at the first delta, seeds the book and replays the two held ones.
    let published = snapshot(&mut conn, 0, btc_snapshot(BTC_VERSION + 1));
    assert_eq!(published[0].1[0], BookLevel { price: 82407.2, size: 5.063 });
}

#[test]
fn seeds_again_a_snapshot_the_first_live_delta_shows_was_behind() {
    let (logs, _capture) = capture();
    let mut conn = seeded();

    let published = send(&mut conn, btc_second());

    assert_eq!(published, [(BTC.to_string(), Vec::new(), Vec::new())]);
    assert_eq!(conn.queued_snapshots(), [0]);
    assert!(!conn.resync_requested());
    assert_eq!(logs.events("snapshot_behind").len(), 1);

    let published = snapshot(&mut conn, 0, btc_snapshot(BTC_VERSION + 1));
    assert_eq!(published[0].1[0], BookLevel { price: 82407.2, size: 3.167 });
}

#[test]
fn resyncs_on_a_gap_in_the_live_chain() {
    let mut conn = seeded();
    send(&mut conn, btc_first());

    let published = send(&mut conn, btc_third());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn resyncs_on_a_break_inside_the_held_deltas() {
    let mut conn = waiting();
    send(&mut conn, btc_first());
    send(&mut conn, btc_third());

    let published = snapshot(&mut conn, 0, btc_snapshot(BTC_VERSION));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn removes_the_levels_a_delete_names() {
    let mut conn = seeded();
    send(&mut conn, btc_first());

    // Frame 271807815 of the same capture removed the whole top of the ask side, cut to the levels this book holds.
    let wipe = delta(
        BTC_VERSION + 2,
        json!([["new", "82409.7", "5.650"]]),
        json!([["delete", "82407.3", "0"], ["delete", "82407.4", "0"], ["delete", "82407.5", "0"]]),
    );
    let published = send(&mut conn, wipe);

    assert_eq!(published[0].1[0], BookLevel { price: 82409.7, size: 5.65 });
    assert!(published[0].2.is_empty());
}

#[test]
fn routes_a_chinese_id_like_any_other() {
    let mut conn = connection(&[CHINESE]);
    conn.state.books.insert(0, Seed::Waiting(VecDeque::new()));
    let body = json!({ "jsonrpc": "2.0", "result": { "asks": [["0.5625", "833"]], "bids": [["0.5624", "552"]], "version": 62494148, "instrument_name": CHINESE } });
    snapshot(&mut conn, 0, body);

    // The first frame of this book on 2026-10-09, cut to one level a side.
    let frame = json!({
        "params": {
            "data": { "timestamp": 1791572061638_i64, "change_id": 62494149, "bids": [["new", "0.56240", "553"]], "asks": [["new", "0.56250", "834"]], "instrument_name": CHINESE },
            "channel": "book.币安人生-USDT-PERPETUAL.raw",
        },
        "method": "subscription", "jsonrpc": "2.0",
    });
    let published = send(&mut conn, frame);

    assert_eq!(published, [(CHINESE.to_string(), levels(&[(0.5624, 553.0)]), levels(&[(0.5625, 834.0)]))]);
}

// failed snapshots

// The venue's answer for an id it does not list, which arrives with HTTP 200.
const UNKNOWN_INSTRUMENT: &[u8] = br#"{"jsonrpc":"2.0","usIn":1791571667265,"usOut":1791571667275,"usDiff":10,"error":{"code":5001,"message":"Instrument does not exist.","data":{}}}"#;

#[test]
fn fetches_again_a_reply_that_carries_a_json_rpc_error() {
    let (logs, _capture) = capture();
    let mut conn = waiting();

    venue().handle_snapshot(0, UNKNOWN_INSTRUMENT, &mut conn).unwrap();

    assert!(conn.take_published().is_empty());
    assert_eq!(conn.queued_snapshots(), [0]);
    let failed = logs.events("snapshot_failed");
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].level, Level::WARN);
    assert_eq!(failed[0].text("market"), BTC);
    assert!(failed[0].text("error").contains("5001"));
}

#[test]
fn fetches_again_a_reply_that_is_not_json() {
    let (logs, _capture) = capture();
    let mut conn = waiting();

    venue().handle_snapshot(0, b"<html>", &mut conn).unwrap();

    assert_eq!(conn.queued_snapshots(), [0]);
    assert!(logs.events("snapshot_failed")[0].text("error").contains("not JSON"));
}

#[test]
fn logs_a_run_of_failed_replies_on_the_first_and_every_30th_and_a_good_snapshot_ends_the_run() {
    let (logs, _capture) = capture();
    let mut conn = waiting();

    for _ in 0..31 {
        venue().handle_snapshot(0, UNKNOWN_INSTRUMENT, &mut conn).unwrap();
    }
    assert_eq!(logs.events("snapshot_failed").len(), 2);

    snapshot(&mut conn, 0, btc_snapshot(BTC_VERSION));
    assert_eq!(conn.state.snapshot_failures, 0);
}

#[test]
fn ignores_a_snapshot_for_a_market_that_is_not_waiting() {
    let mut conn = seeded();
    send(&mut conn, btc_first());

    let published = snapshot(&mut conn, 0, btc_snapshot(BTC_VERSION));

    assert!(published.is_empty());
}

// deltas outside a seed

#[test]
fn holds_a_delta_that_arrives_before_the_acknowledgement_and_asks_for_the_snapshot() {
    let mut conn = connection(&[BTC]);

    let published = send(&mut conn, btc_first());

    assert!(published.is_empty());
    assert_eq!(conn.queued_snapshots(), [0]);
    let published = snapshot(&mut conn, 0, btc_snapshot(BTC_VERSION));
    assert_eq!(published[0].1[0], BookLevel { price: 82407.2, size: 5.284 });
}

#[test]
fn keeps_at_most_500_held_deltas() {
    let mut conn = waiting();
    for i in 0..(MAX_HELD_DELTAS as i64 + 5) {
        send(&mut conn, delta(BTC_VERSION + 1 + i, json!([]), json!([])));
    }

    let Some(Seed::Waiting(held)) = conn.state.books.get(&0) else {
        panic!("expected a waiting book");
    };
    assert_eq!(held.len(), MAX_HELD_DELTAS);
    assert_eq!(held[0].change_id, BTC_VERSION + 6);
}

#[test]
fn drops_a_delta_for_an_unknown_market_and_logs_it_once() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["ETH-USDT-PERPETUAL"]);

    assert!(send(&mut conn, btc_first()).is_empty());
    assert!(send(&mut conn, btc_second()).is_empty());

    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
    assert!(conn.queued_snapshots().is_empty());
}

#[test]
fn fails_a_frame_that_is_not_json_without_a_resync() {
    let mut conn = connection(&[BTC]);

    assert!(venue().handle(b"PONG", &mut conn).is_err());
    assert!(!conn.resync_requested());
}

#[test]
fn resyncs_on_a_book_frame_it_cannot_parse() {
    let mut conn = seeded();

    let mut frame = btc_first();
    frame["params"]["data"]["change_id"] = json!("next");
    assert!(venue().handle(frame.to_string().as_bytes(), &mut conn).is_err());

    assert!(conn.take_published().is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn resyncs_on_a_delta_level_it_cannot_read() {
    let mut conn = seeded();

    let published = send(&mut conn, delta(BTC_VERSION + 1, json!([["new", "82407.2", "n/a"]]), json!([])));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn fetches_again_a_snapshot_with_a_level_it_cannot_read() {
    let (logs, _capture) = capture();
    let mut conn = waiting();
    let mut body = btc_snapshot(BTC_VERSION);
    body["result"]["bids"][1] = json!(["82407.1", "n/a"]);

    let published = snapshot(&mut conn, 0, body);

    assert!(published.is_empty());
    assert_eq!(conn.queued_snapshots(), [0]);
    assert!(!conn.resync_requested());
    assert!(logs.events("snapshot_failed")[0].text("error").contains("cannot read"));
}

// Prints the frames the cases above are cut from, and CAPTURE_BTC=1 adds the BTC book and its REST snapshot:
// cargo test capture_orangex_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_orangex_frames() {
    use futures_util::{SinkExt, StreamExt};
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(URL).await.unwrap();
    let http = reqwest::Client::new();
    let subscribe = |id: u64, channels: &[&str]| {
        Message::text(json!({ "jsonrpc": "2.0", "id": id, "method": "/public/subscribe", "params": { "channels": channels } }).to_string())
    };
    let only_btc = std::env::var("CAPTURE_BTC").is_ok();
    if only_btc {
        ws.send(subscribe(4, &["book.BTC-USDT-PERPETUAL.raw"])).await.unwrap();
    }
    ws.send(subscribe(2, &["book.CHR-USDT-PERPETUAL.raw", "book.NOPE-USDT-PERPETUAL.raw"])).await.unwrap();
    ws.send(subscribe(3, &["book.CHR-USDT-PERPETUAL.raw", "book.币安人生-USDT-PERPETUAL.raw"])).await.unwrap();
    ws.send(Message::text("not json")).await.unwrap();

    let mut snapshot_taken = false;
    let started = std::time::Instant::now();
    let mut count = 0;
    while started.elapsed() < Duration::from_secs(12) {
        let Ok(Some(Ok(message))) = tokio::time::timeout(Duration::from_secs(3), ws.next()).await else {
            break;
        };
        if let Message::Text(text) = message {
            count += 1;
            if count <= 12 || (only_btc && text.as_str().contains(BTC) && count <= 40) {
                println!("FRAME {}", text.as_str());
            }
        }
        if !snapshot_taken && started.elapsed() > Duration::from_secs(4) {
            snapshot_taken = true;
            let market = if only_btc { "BTC" } else { "CHR" };
            let url = format!("{REST}{ORDER_BOOK_PATH}?instrument_name={market}-USDT-PERPETUAL&depth={SNAPSHOT_DEPTH}");
            println!("SNAPSHOT {}", http.get(&url).send().await.unwrap().text().await.unwrap());
            ws.send(Message::text(json!({ "jsonrpc": "2.0", "id": PING_ID, "method": "/public/ping" }).to_string())).await.unwrap();
        }
    }
}

// Subscribes CHUNKS channels per frame on one socket and prints each reply, to find the venue's channel limit:
// CHUNKS=50,10 cargo test probe_orangex_channel_limit -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn probe_orangex_channel_limit() {
    use futures_util::{SinkExt, StreamExt};
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let ids: Vec<String> = reqwest::get(format!("{REST}/get_instruments?currency=PERPETUAL"))
        .await
        .unwrap()
        .json::<Value>()
        .await
        .unwrap()["result"]
        .as_array()
        .unwrap()
        .iter()
        .map(|row| row["instrument_name"].as_str().unwrap().to_string())
        .collect();
    let chunks: Vec<usize> = std::env::var("CHUNKS").unwrap().split(',').map(|n| n.parse().unwrap()).collect();
    let url = std::env::var("PROBE_URL").unwrap_or(URL.to_string());
    let (mut ws, _) = tokio_tungstenite::connect_async(url.as_str()).await.unwrap();
    if let Ok(extra) = std::env::var("CHANNELS") {
        let channels: Vec<&str> = extra.split(',').collect();
        for (i, channel) in channels.iter().enumerate() {
            ws.send(Message::text(json!({ "jsonrpc": "2.0", "id": 100 + i, "method": "/public/subscribe", "params": { "channels": [channel] } }).to_string())).await.unwrap();
        }
    }
    let mut next = 0;
    for (i, size) in chunks.iter().enumerate() {
        let channels: Vec<String> = ids[next..next + size].iter().map(|id| channel(id)).collect();
        next += size;
        ws.send(Message::text(json!({ "jsonrpc": "2.0", "id": 10 + i, "method": "/public/subscribe", "params": { "channels": channels } }).to_string())).await.unwrap();
        tokio::time::sleep(Duration::from_millis(300)).await;
    }
    let started = std::time::Instant::now();
    let mut books = std::collections::HashSet::new();
    while started.elapsed() < Duration::from_secs(8) {
        let Ok(Some(Ok(Message::Text(text)))) = tokio::time::timeout(Duration::from_secs(3), ws.next()).await else {
            continue;
        };
        let Ok(frame) = serde_json::from_str::<Value>(text.as_str()) else {
            println!("TEXT {}", text.as_str());
            continue;
        };
        if let Some(name) = frame["params"]["data"]["instrument_name"].as_str() {
            if books.insert(name.to_string()) && books.len() <= 3 {
                let channel = frame["params"]["channel"].as_str().unwrap_or("");
                println!("BOOK {name} on {channel}");
            }
        } else if frame["params"]["channel"].is_string() {
            let channel = frame["params"]["channel"].as_str().unwrap().to_string();
            if books.insert(channel.clone()) {
                let text = text.as_str();
                println!("PUSH {}", &text[..text.len().min(300)]);
            }
        } else {
            let text = text.as_str();
            println!("REPLY {}", &text[..text.len().min(300)]);
        }
    }
    println!("BOOKS {}", books.len());
}
