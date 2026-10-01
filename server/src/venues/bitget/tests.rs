// Ported case for case from old_ts_server/src/venues/bitget/bitget.spec.ts.
// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

const SNAPSHOT_SEQ: i64 = 427583461144;
const SNAPSHOT_ASKS: &[(&str, &str)] = &[("0.01039", "4499.23"), ("0.0104", "116536.86")];
const SNAPSHOT_BIDS: &[(&str, &str)] = &[("0.01038", "4311.15"), ("0.01037", "175152.28")];
const NO_LEVELS: &[(&str, &str)] = &[];

fn market(raw_market_id: &str, quote: &str) -> Market {
    testing::market(ID, raw_market_id, &raw_market_id[..3], quote, true)
}

fn markets(count: usize, quote: &str) -> Vec<Market> {
    let suffix = if quote == "USDC" { "PERP" } else { quote };
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}{suffix}"), quote));
    }
    markets
}

fn venue() -> Bitget {
    Bitget::new(&[])
}

fn connection(raw_market_id: &str, quote: &str) -> Connection<HashMap<usize, i64>> {
    Connection::for_test("bitget#usdt-futures#0", vec![market(raw_market_id, quote)])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// The v3 shape captured live on 2026-09-15, with the level count cut down.
fn books_frame(
    symbol: &str,
    action: &str,
    seq: i64,
    pseq: i64,
    bids: &[(&str, &str)],
    asks: &[(&str, &str)],
    inst_type: &str,
) -> Value {
    json!({
        "action": action,
        "arg": { "instType": inst_type, "topic": "books", "symbol": symbol },
        "data": [{ "a": asks, "b": bids, "seq": seq, "pseq": pseq, "ts": "1789456512452", "maxdepth": "1000" }],
        "ts": 1789456512454_i64,
    })
}

fn update(seq: i64, pseq: i64, bids: &[(&str, &str)], asks: &[(&str, &str)]) -> Value {
    books_frame("MAVUSDT", "update", seq, pseq, bids, asks, "usdt-futures")
}

fn snapshot(symbol: &str) -> Value {
    books_frame(symbol, "snapshot", SNAPSHOT_SEQ, 0, SNAPSHOT_BIDS, SNAPSHOT_ASKS, "usdt-futures")
}

fn send_bytes(conn: &mut Connection<HashMap<usize, i64>>, frame: &[u8]) -> Published {
    venue().handle(frame, conn).unwrap();
    conn.take_published()
}

fn send(conn: &mut Connection<HashMap<usize, i64>>, frame: Value) -> Published {
    send_bytes(conn, frame.to_string().as_bytes())
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

#[test]
fn paces_subscribe_frames_and_opens_a_second_apart_and_allows_a_minute_of_silence() {
    let settings = venue().settings();

    assert_eq!(settings.subscribe_gap, Duration::from_secs(1));
    assert_eq!(settings.connect_stagger, Duration::from_secs(1));
    assert_eq!(settings.max_silence, Duration::from_secs(60));
}

// plan

#[test]
fn chunks_markets_fifty_to_a_connection_on_the_one_v3_endpoint() {
    let plans = venue().plan(&markets(120, "USDT"));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["bitget#usdt-futures#0", "bitget#usdt-futures#1", "bitget#usdt-futures#2"]);
    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [50, 50, 20]);
    assert_eq!(plans[0].url, "wss://ws.bitget.com/v3/ws/public");
}

#[test]
fn splits_plans_by_the_inst_type_the_quote_names() {
    let plans = venue().plan(&[market("BTCPERP", "USDC"), market("BTCUSDT", "USDT"), market("ETHPERP", "USDC")]);

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["bitget#usdt-futures#0", "bitget#usdc-futures#0"]);
    assert_eq!(testing::raw_ids(&plans[1].markets), ["BTCPERP", "ETHPERP"]);
}

// spawn_feed logs the market every plan left out as markets_unplanned, which replaced the feed's own error line.
#[test]
fn leaves_out_a_market_whose_quote_names_no_inst_type() {
    let plans = venue().plan(&[market("BTCUSDT", "USDT"), market("BTCUSD", "USD")]);

    let planned: Vec<&str> = plans.iter().flat_map(|plan| testing::raw_ids(&plan.markets)).collect();
    assert_eq!(planned, ["BTCUSDT"]);
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames

#[test]
fn builds_v3_books_arguments_ten_to_a_frame() {
    let frames = venue().subscribe_frames(&markets(25, "USDT"), &mut HashMap::new());

    let sizes: Vec<usize> = frames.iter().map(|frame| parsed(frame)["args"].as_array().unwrap().len()).collect();
    assert_eq!(sizes, [10, 10, 5]);
    let first = parsed(&frames[0]);
    assert_eq!(first["op"], "subscribe");
    assert_eq!(first["args"][0], json!({ "instType": "usdt-futures", "topic": "books", "symbol": "SYM0USDT" }));
}

#[test]
fn takes_the_inst_type_from_each_market_quote() {
    let frames = venue().subscribe_frames(&[market("BTCUSDT", "USDT"), market("BTCPERP", "USDC")], &mut HashMap::new());

    let frame = parsed(&frames[0]);
    assert_eq!(frame["args"][0]["instType"], "usdt-futures");
    assert_eq!(frame["args"][1]["instType"], "usdc-futures");
}

// ping, which replaced startKeepalive

#[test]
fn sends_the_text_ping_every_25_seconds() {
    let Message::Text(ping) = venue().ping(&mut HashMap::new()) else {
        panic!("the ping is text");
    };

    assert_eq!(ping.as_str(), "ping");
    assert_eq!(venue().settings().ping_every, Some(Duration::from_secs(25)));
}

// handle

#[test]
fn hands_the_engine_a_subscribed_snapshot_as_the_whole_book() {
    let mut conn = connection("MAVUSDT", "USDT");

    let published = send(&mut conn, snapshot("MAVUSDT"));

    assert_eq!(
        published,
        [(
            "MAVUSDT".to_string(),
            levels(&[(0.01038, 4311.15), (0.01037, 175152.28)]),
            levels(&[(0.01039, 4499.23), (0.0104, 116536.86)]),
        )]
    );
}

#[test]
fn applies_the_captured_updates_whose_pseq_chains_to_the_last_seq() {
    let mut conn = connection("MAVUSDT", "USDT");
    let mut published = send(&mut conn, snapshot("MAVUSDT")).len();

    published += send(&mut conn, update(427583480559, SNAPSHOT_SEQ, &[("0.00519", "30828.52")], NO_LEVELS)).len();
    published += send(
        &mut conn,
        update(
            427583480664,
            427583480559,
            &[("0.01036", "463711.3"), ("0.01035", "175053.47")],
            &[("0.0104", "116536.86"), ("0.01042", "382403.68")],
        ),
    )
    .len();
    // The best bid is pulled.
    let last = send(&mut conn, update(427583480700, 427583480664, &[("0.01038", "0")], NO_LEVELS));
    published += last.len();

    assert_eq!(published, 4);
    assert_eq!(
        last[0].1,
        levels(&[(0.01037, 175152.28), (0.01036, 463711.3), (0.01035, 175053.47), (0.00519, 30828.52)])
    );
    assert_eq!(last[0].2, levels(&[(0.01039, 4499.23), (0.0104, 116536.86), (0.01042, 382403.68)]));
}

#[test]
fn routes_a_usdc_m_book_the_same_way() {
    let mut conn = connection("BTCPERP", "USDC");

    let published = send(
        &mut conn,
        books_frame("BTCPERP", "snapshot", 559103756610, 0, &[("75850.1", "0.5")], &[("75850.2", "0.7")], "usdc-futures"),
    );

    assert_eq!(published, [("BTCPERP".to_string(), levels(&[(75850.1, 0.5)]), levels(&[(75850.2, 0.7)]))]);
}

#[test]
fn restarts_the_connection_on_a_pseq_that_skips_a_frame_and_applies_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection("MAVUSDT", "USDT");
    send(&mut conn, snapshot("MAVUSDT"));

    let published = send(&mut conn, update(427583480664, 427583480559, &[("0.01036", "463711.3")], NO_LEVELS));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync.len(), 1);
    assert_eq!(resync[0].text("market"), "MAVUSDT");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn restarts_the_connection_on_an_update_whose_pseq_is_0() {
    let (logs, _capture) = capture();
    let mut conn = connection("MAVUSDT", "USDT");
    send(&mut conn, snapshot("MAVUSDT"));

    let published = send(&mut conn, update(5, 0, &[("0.01036", "1")], NO_LEVELS));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_reset");
}

#[test]
fn restarts_the_connection_on_an_update_with_no_snapshot_behind_it() {
    let (logs, _capture) = capture();
    let mut conn = connection("MAVUSDT", "USDT");

    let published = send(&mut conn, update(427583480559, SNAPSHOT_SEQ, &[("0.00519", "30828.52")], NO_LEVELS));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "update_before_snapshot");
}

#[test]
fn ignores_the_bare_text_pong_without_parsing_it() {
    let (logs, _capture) = capture();
    let mut conn = connection("MAVUSDT", "USDT");

    let published = send_bytes(&mut conn, b"pong");

    assert!(published.is_empty());
    assert!(logs.events("venue_error").is_empty());
}

#[test]
fn drops_a_symbol_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = connection("MAVUSDT", "USDT");

    let first = send(&mut conn, snapshot("CELRUSDT"));
    let second = send(&mut conn, snapshot("CELRUSDT"));

    assert!(first.is_empty() && second.is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

#[test]
fn logs_an_error_event_and_stays_silent_on_the_acknowledgement() {
    let (logs, _capture) = capture();
    let mut conn = connection("MAVUSDT", "USDT");

    send(
        &mut conn,
        json!({
            "event": "subscribe",
            "arg": { "instType": "usdt-futures", "topic": "books", "symbol": "MAVUSDT" },
            "connId": "06ea84fffe987173-00008a15-033b0931-fa9263af713ab269-b2bdfd7d",
        }),
    );
    let published = send(
        &mut conn,
        json!({
            "event": "error",
            "code": 30001,
            "msg": "{\"instType\":\"usdt-futures\",\"symbol\":\"NOPEUSDT\",\"topic\":\"books\"} doesn't exist",
            "connId": "0ac601fffe2331d1-0000b8a2-02ec8f7d-12be2501ca6d557e-522cdcdf",
        }),
    );

    assert!(published.is_empty());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].number("code"), 30001.0);
}
