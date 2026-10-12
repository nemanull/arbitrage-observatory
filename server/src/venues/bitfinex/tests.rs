// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

const BTC: &str = "tBTCF0:USTF0";
const INDEX: &str = "tEUROPE50IXF0:USTF0";

fn market(raw_market_id: &str) -> Market {
    testing::market(ID, raw_market_id, raw_market_id, "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("tSYM{i}F0:USTF0")));
    }
    markets
}

fn venue() -> Bitfinex {
    Bitfinex::new()
}

fn connection(raw_ids: &[&str]) -> Connection<State> {
    let mut list = Vec::with_capacity(raw_ids.len());
    for id in raw_ids {
        list.push(market(id));
    }
    Connection::for_test("bitfinex#public#0", list)
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

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// Frames captured live on 2026-10-09 with the SEQ_ALL flag, snapshots cut to three levels a side.
fn btc_subscribed() -> Value {
    json!({ "chanId": 223912, "channel": "book", "event": "subscribed", "freq": "F0", "len": "25", "pair": "BTCF0:USTF0", "prec": "P0", "symbol": BTC })
}

fn index_subscribed() -> Value {
    json!({ "chanId": 223913, "channel": "book", "event": "subscribed", "freq": "F0", "len": "25", "pair": "EUROPE50IXF0:USTF0", "prec": "P0", "symbol": INDEX })
}

fn index_snapshot(seq: i64) -> Value {
    json!([223913, [[6050, 1, 0.001], [5691.2, 1, 0.00175709], [6680.9, 1, -0.0014968]], seq])
}

fn btc_snapshot(seq: i64) -> Value {
    json!([223912, [
        [82708, 2, 0.03704626], [82703, 1, 0.01820632], [82701, 1, 0.00012496],
        [82720, 1, -0.03629884], [82723, 1, -0.00760202], [82733, 1, -0.4356],
    ], seq])
}

// Both books acknowledged and seeded, with the socket's counter at 2.
fn seeded() -> Connection<State> {
    let mut conn = connection(&[BTC, INDEX]);
    send(&mut conn, index_subscribed());
    send(&mut conn, index_snapshot(1));
    send(&mut conn, btc_subscribed());
    send(&mut conn, btc_snapshot(2));
    conn
}

fn btc_bids() -> Vec<BookLevel> {
    levels(&[(82708.0, 0.03704626), (82703.0, 0.01820632), (82701.0, 0.00012496)])
}

fn btc_asks() -> Vec<BookLevel> {
    levels(&[(82720.0, 0.03629884), (82723.0, 0.00760202), (82733.0, 0.4356)])
}

// plan

#[test]
fn puts_25_contracts_on_each_connection_to_the_one_public_endpoint() {
    let plans = venue().plan(&markets(76));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["bitfinex#public#0", "bitfinex#public#1", "bitfinex#public#2", "bitfinex#public#3"]);
    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [25, 25, 25, 1]);
    assert!(plans.iter().all(|plan| plan.url == "wss://api-pub.bitfinex.com/ws/2"));
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames, ping and settings

#[test]
fn sends_the_sequence_flag_first_then_one_25_level_book_per_frame() {
    let frames = venue().subscribe_frames(&[market(BTC), market(INDEX)], &mut State::default());

    let frames: Vec<Value> = frames.iter().map(parsed).collect();
    assert_eq!(
        frames,
        [
            json!({ "event": "conf", "flags": 65536 }),
            json!({ "event": "subscribe", "channel": "book", "symbol": BTC, "prec": "P0", "freq": "F0", "len": "25" }),
            json!({ "event": "subscribe", "channel": "book", "symbol": INDEX, "prec": "P0", "freq": "F0", "len": "25" }),
        ]
    );
}

#[test]
fn pings_with_the_json_ping_in_unix_ms_every_twenty_seconds() {
    let before = now_ms();
    let frame = parsed(&venue().ping(&mut State::default()));
    let after = now_ms();

    assert_eq!(frame["event"], "ping");
    let cid = frame["cid"].as_i64().unwrap();
    assert!((before..=after).contains(&cid), "{cid}");
    assert_eq!(venue().settings().ping_every, Some(Duration::from_secs(20)));
}

#[test]
fn ends_a_socket_silent_past_two_heartbeats_and_staggers_the_opens() {
    let settings = venue().settings();

    assert_eq!(settings.max_silence, Duration::from_secs(35));
    assert_eq!(settings.connect_stagger, Duration::from_secs(3));
    assert_eq!(settings.subscribe_gap, Duration::ZERO);
}

// handle: books

#[test]
fn hands_the_engine_the_snapshot_split_by_the_sign_of_the_amount() {
    let mut conn = connection(&[BTC]);
    send(&mut conn, btc_subscribed());

    let published = send(&mut conn, btc_snapshot(1));

    assert_eq!(published, [(BTC.to_string(), btc_bids(), btc_asks())]);
    assert!(!conn.resync_requested());
}

#[test]
fn routes_each_frame_by_the_chan_id_of_its_acknowledgement() {
    let mut conn = connection(&[BTC, INDEX]);
    send(&mut conn, index_subscribed());

    let published = send(&mut conn, index_snapshot(1));

    assert_eq!(
        published,
        [(INDEX.to_string(), levels(&[(6050.0, 0.001), (5691.2, 0.00175709)]), levels(&[(6680.9, 0.0014968)]))]
    );
}

#[test]
fn sets_a_level_on_a_positive_count_and_deletes_it_on_a_count_of_zero() {
    let mut conn = seeded();

    send(&mut conn, json!([223912, [82708, 1, 0.03630353], 3]));
    send(&mut conn, json!([223912, [82720, 2, -0.04429884], 4]));
    send(&mut conn, json!([223912, [82703, 0, 1], 5]));
    let published = send(&mut conn, json!([223912, [82723, 0, -1], 6]));

    assert_eq!(
        published,
        [(
            BTC.to_string(),
            levels(&[(82708.0, 0.03630353), (82701.0, 0.00012496)]),
            levels(&[(82720.0, 0.04429884), (82733.0, 0.4356)]),
        )]
    );
    assert!(!conn.resync_requested());
}

#[test]
fn adds_a_new_level_inside_the_window() {
    let mut conn = seeded();

    let published = send(&mut conn, json!([223912, [82718, 1, -0.00724904], 3]));

    assert_eq!(published[0].2[0], BookLevel { price: 82718.0, size: 0.00724904 });
}

#[test]
fn replaces_the_book_on_a_second_snapshot() {
    let mut conn = seeded();
    send(&mut conn, json!([223912, [82708, 0, 1], 3]));

    let published = send(&mut conn, btc_snapshot(4));

    assert_eq!(published, [(BTC.to_string(), btc_bids(), btc_asks())]);
}

#[test]
fn publishes_an_empty_book_for_an_empty_snapshot() {
    let mut conn = connection(&[BTC]);
    send(&mut conn, btc_subscribed());

    let published = send(&mut conn, json!([223912, [], 1]));

    assert_eq!(published, [(BTC.to_string(), Vec::new(), Vec::new())]);
}

#[test]
fn takes_a_heartbeat_as_a_step_of_the_sequence_and_publishes_nothing() {
    let mut conn = seeded();

    assert!(send(&mut conn, json!([223912, "hb", 3])).is_empty());
    assert!(send(&mut conn, json!([223913, "hb", 4])).is_empty());
    send(&mut conn, json!([223912, [82708, 1, 0.03630353], 5]));

    assert!(!conn.resync_requested());
}

#[test]
fn counts_a_heartbeat_that_comes_before_its_acknowledgement() {
    let mut conn = connection(&[BTC, INDEX]);

    // The order captured live on 2026-10-09, when both acks came after the first heartbeats.
    assert!(send(&mut conn, json!([223912, "hb", 1])).is_empty());
    assert!(send(&mut conn, json!([223913, "hb", 2])).is_empty());
    send(&mut conn, index_subscribed());
    let published = send(&mut conn, index_snapshot(3));

    assert_eq!(published.len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn never_books_a_snapshot_that_comes_before_its_acknowledgement() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[BTC]);

    assert!(venue().handle(btc_snapshot(1).to_string().as_bytes(), &mut conn).is_err());
    send(&mut conn, btc_subscribed());
    let published = send(&mut conn, json!([223912, [82708, 1, 0.03630353], 2]));

    assert!(published.is_empty());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn resyncs_on_the_frame_after_one_it_could_not_read() {
    let (logs, _capture) = capture();
    let mut conn = seeded();

    assert!(venue().handle(b"[223912, {}, 3]", &mut conn).is_err());
    let published = send(&mut conn, json!([223912, [82708, 1, 0.03630353], 4]));

    assert!(published.is_empty());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_gap");
}

#[test]
fn resyncs_the_connection_on_a_gap_in_the_socket_sequence() {
    let (logs, _capture) = capture();
    let mut conn = seeded();

    assert!(send(&mut conn, json!([223912, [82708, 1, 0.03630353], 4])).is_empty());

    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync[0].text("market"), "connection");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn resyncs_when_the_first_frame_does_not_start_the_sequence_at_one() {
    let mut conn = connection(&[BTC]);
    send(&mut conn, btc_subscribed());

    assert!(send(&mut conn, btc_snapshot(2)).is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn resyncs_a_frame_without_a_sequence_since_the_flag_did_not_apply() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[BTC]);
    send(&mut conn, btc_subscribed());

    // The shape of a snapshot with no flag, from the profile's capture of 2026-09-23.
    assert!(send(&mut conn, json!([223912, [[86704, 1, 0.03460649]]])).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_missing");
}

#[test]
fn resyncs_an_update_that_comes_before_its_snapshot() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[BTC]);
    send(&mut conn, btc_subscribed());

    assert!(send(&mut conn, json!([223912, [82708, 1, 0.03630353], 1])).is_empty());

    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync[0].text("market"), BTC);
    assert_eq!(resync[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn fails_a_book_frame_on_a_channel_no_subscribe_acknowledged() {
    let mut conn = connection(&[BTC]);

    assert!(venue().handle(json!([999, [82708, 1, 0.03630353], 1]).to_string().as_bytes(), &mut conn).is_err());
    assert!(conn.take_published().is_empty());
}

#[test]
fn ignores_an_acknowledgement_for_a_symbol_this_connection_did_not_subscribe() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[BTC]);

    send(&mut conn, index_subscribed());

    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), INDEX);
    assert!(venue().handle(index_snapshot(1).to_string().as_bytes(), &mut conn).is_err());
}

// handle: events

#[test]
fn takes_the_info_conf_and_pong_frames_quietly() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[BTC]);

    // As captured live on 2026-10-09.
    let info = json!({ "event": "info", "platform": { "status": 1 }, "serverId": "bfad8800-da8a-4463-9a41-76c57dbc18be", "version": 2 });
    let conf = json!({ "event": "conf", "flags": 65536, "status": "OK" });
    let pong = json!({ "cid": 1791568048835_i64, "event": "pong", "ts": 1791568048911_i64 });

    assert!(send(&mut conn, info).is_empty());
    assert!(send(&mut conn, conf).is_empty());
    assert!(send(&mut conn, pong).is_empty());
    assert!(conn.take_sent().is_empty());
    assert!(!conn.resync_requested());
    assert!(logs.lines().is_empty());
}

#[test]
fn logs_a_refused_subscribe_as_a_venue_error() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[BTC]);

    // As captured live on 2026-10-09.
    let refused = json!({
        "channel": "book", "code": 10300, "event": "error", "freq": "F0", "len": "25", "msg": "symbol: invalid",
        "pair": "NOPEF0:USTF0", "prec": "P0", "symbol": "tNOPEF0:USTF0",
    });
    assert!(send(&mut conn, refused).is_empty());

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "bitfinex#public#0");
    assert_eq!(errors[0].text("market"), "tNOPEF0:USTF0");
    assert_eq!(errors[0].number("code"), 10300.0);
    assert_eq!(errors[0].text("message"), "symbol: invalid");
    assert!(!conn.resync_requested());
}

#[test]
fn logs_a_refused_conf_as_a_venue_error() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[BTC]);

    assert!(send(&mut conn, json!({ "event": "conf", "flags": 65536, "status": "FAILED" })).is_empty());

    assert_eq!(logs.events("venue_error")[0].text("request"), "conf");
}

#[test]
fn reconnects_when_the_venue_asks_and_when_maintenance_ends() {
    for code in [20051, 20061] {
        let (logs, _capture) = capture();
        let mut conn = seeded();

        send(&mut conn, json!({ "event": "info", "code": code, "msg": "Stopping. Please try to reconnect" }));

        assert!(conn.resync_requested());
        assert_eq!(logs.events("venue_notice")[0].number("code"), code as f64);
        assert_eq!(logs.events("book_resync")[0].text("reason"), "reconnect_requested");
    }
}

#[test]
fn logs_the_start_of_maintenance_and_a_platform_under_maintenance_as_notices() {
    let (logs, _capture) = capture();
    let mut conn = seeded();

    send(&mut conn, json!({ "event": "info", "code": 20060, "msg": "Entering in Maintenance mode" }));
    send(&mut conn, json!({ "event": "info", "platform": { "status": 0 }, "version": 2 }));

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 2);
    assert!(notices.iter().all(|notice| notice.text("kind") == "maintenance"));
    assert!(!conn.resync_requested());
}

#[test]
fn logs_any_other_info_code_as_a_notice_and_keeps_the_books() {
    let (logs, _capture) = capture();
    let mut conn = seeded();

    send(&mut conn, json!({ "event": "info", "code": 20099, "msg": "unknown" }));

    assert_eq!(logs.events("venue_notice")[0].number("code"), 20099.0);
    assert!(!conn.resync_requested());
}

#[test]
fn logs_an_unknown_event_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[BTC]);

    send(&mut conn, json!({ "event": "unsubscribed", "status": "OK", "chanId": 223912 }));

    assert_eq!(logs.events("venue_notice")[0].text("kind"), "unsubscribed");
    assert!(logs.events("venue_error").is_empty());
}

#[test]
fn reports_a_frame_that_is_not_json() {
    let mut conn = connection(&[BTC]);

    assert!(venue().handle(b"not json", &mut conn).is_err());
    assert!(venue().handle(b"[223912, {}, 1]", &mut conn).is_err());
}

// A probe of the live socket, which prints every frame of a few books for a while, with snapshots cut to three levels a side:
// CAPTURE_MARKETS=tBTCF0:USTF0 CAPTURE_SECONDS=20 cargo test bitfinex::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(PUBLIC_URL).await.unwrap();
    let list = std::env::var("CAPTURE_MARKETS").unwrap_or_else(|_| "tBTCF0:USTF0,tEUROPE50IXF0:USTF0,tNOPEF0:USTF0".to_string());
    let seconds: u64 = std::env::var("CAPTURE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(20);
    let mut markets = Vec::new();
    for symbol in list.split(',') {
        markets.push(crate::venues::testing::market(ID, symbol, symbol, "USDT", true));
    }
    for frame in Bitfinex::new().subscribe_frames(&markets, &mut State::default()) {
        ws.send(frame).await.unwrap();
    }
    ws.send(Bitfinex::new().ping(&mut State::default())).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    let mut printed = 0;
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let mut value: Value = serde_json::from_str(text.as_str()).unwrap();
        if let Some(entries) = value.get_mut(1).and_then(Value::as_array_mut)
            && entries.first().is_some_and(Value::is_array)
        {
            println!("snapshot of {} levels", entries.len());
            let asks: Vec<Value> = entries.iter().filter(|e| e[2].as_f64().unwrap_or(0.0) < 0.0).take(3).cloned().collect();
            entries.retain(|e| e[2].as_f64().unwrap_or(0.0) > 0.0);
            entries.truncate(3);
            entries.extend(asks);
        }
        printed += 1;
        if printed <= 60 || value.get(1).is_some_and(Value::is_string) {
            println!("{value}");
        }
    }
    println!("{printed} frames");
}

