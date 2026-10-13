// The engine's received levels are read through Connection::take_published after each frame or REST reply.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

const BTC: &str = "BTCUSDT";
const BIANRENSHENG: &str = "币安人生USDT";
const B_MONEY: &str = "B-MONEYUSDT";

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.strip_suffix("USDT").unwrap();
    testing::market(ID, raw_market_id, base, "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}USDT")));
    }
    markets
}

fn venue() -> Aster {
    Aster::new()
}

fn connection(ids: &[&str]) -> Connection<State> {
    Connection::for_test("aster#perp#0", ids.iter().map(|id| market(id)).collect())
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

// Two consecutive btcusdt@depth20@100ms frames captured live on 2026-10-12, cut from 20 levels a side to 3.
fn btc_first() -> Value {
    json!({ "stream": "btcusdt@depth20@100ms", "data": {
        "e": "depthUpdate", "E": 1791845333484_i64, "T": 1791845333450_i64, "s": "BTCUSDT",
        "U": 599039520750_i64, "u": 599039522069_i64, "pu": 599039520162_i64,
        "b": [["82531.5", "6.910"], ["82531.4", "0.109"], ["82531.1", "0.002"]],
        "a": [["82531.6", "0.002"], ["82534.4", "0.001"], ["82536.8", "0.002"]],
    }})
}

fn btc_second() -> Value {
    json!({ "stream": "btcusdt@depth20@100ms", "data": {
        "e": "depthUpdate", "E": 1791845333623_i64, "T": 1791845333550_i64, "s": "BTCUSDT",
        "U": 599039523419_i64, "u": 599039524529_i64, "pu": 599039522069_i64,
        "b": [["82531.5", "6.971"], ["82531.4", "0.109"], ["82531.1", "0.002"]],
        "a": [["82531.6", "0.002"], ["82534.4", "0.001"], ["82536.8", "0.002"]],
    }})
}

// The same day's frame of a market whose id is in Chinese characters, which the venue writes as raw UTF-8, cut to 2 levels a side.
fn bianrensheng_frame() -> Value {
    json!({ "stream": "币安人生usdt@depth20@100ms", "data": {
        "e": "depthUpdate", "E": 1791845333481_i64, "T": 1791845333450_i64, "s": "币安人生USDT",
        "U": 599039520604_i64, "u": 599039522311_i64, "pu": 599039516335_i64,
        "b": [["0.5712000", "10"], ["0.5704000", "2798"]],
        "a": [["0.5716000", "350"], ["0.5717000", "54"]],
    }})
}

// The REST book of B-MONEYUSDT read at limit 20 on 2026-10-12, whose last change was about four minutes old.
fn b_money_book() -> Value {
    json!({
        "lastUpdateId": 599034807833_i64, "E": 1791845115088_i64, "T": 1791845115050_i64,
        "bids": [["0.0010000", "7928"], ["0.0009900", "10101"], ["0.0009100", "109890"]],
        "asks": [["0.0010100", "99009"], ["0.0013100", "8059"], ["0.0042900", "3368"]],
    })
}

fn btc_first_levels() -> (Vec<BookLevel>, Vec<BookLevel>) {
    (
        levels(&[(82531.5, 6.91), (82531.4, 0.109), (82531.1, 0.002)]),
        levels(&[(82531.6, 0.002), (82534.4, 0.001), (82536.8, 0.002)]),
    )
}

// settings and plan

#[test]
fn pings_every_30_s_subscribes_250_ms_apart_and_retires_before_the_24_hour_cap() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(30)));
    assert_eq!(settings.max_silence, Duration::from_secs(60));
    assert_eq!(settings.subscribe_gap, Duration::from_millis(250));
    assert_eq!(settings.snapshot_gap, Duration::from_millis(400));
    assert_eq!(settings.retire_after, Some(Duration::from_secs(23 * 60 * 60)));
    assert_eq!(settings.retire_jitter, Duration::from_secs(30 * 60));
    assert!(settings.headers.is_empty());
}

#[test]
fn pings_with_a_protocol_ping() {
    assert!(matches!(venue().ping(&mut State::default()), Message::Ping(_)));
}

#[test]
fn spreads_577_markets_over_three_connections_to_the_one_public_socket() {
    let plans = venue().plan(&markets(577));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [193, 193, 191]);
    assert_eq!(plans[0].id, "aster#perp#0");
    assert_eq!(plans[2].id, "aster#perp#2");
    assert!(plans.iter().all(|plan| plan.url == "wss://fstream.asterdex.com/stream"));
}

#[test]
fn keeps_200_markets_on_one_connection_and_splits_201_in_two() {
    let sizes = |count: usize| -> Vec<usize> { venue().plan(&markets(count)).iter().map(|plan| plan.markets.len()).collect() };

    assert_eq!(sizes(200), [200]);
    assert_eq!(sizes(201), [101, 100]);
    assert_eq!(sizes(1), [1]);
    assert!(sizes(0).is_empty());
}

// subscribe_frames

#[test]
fn subscribes_50_lowercased_streams_per_frame() {
    let frames = venue().subscribe_frames(&markets(193), &mut State::default());

    assert_eq!(frames.len(), 4);
    let first = parsed(&frames[0]);
    assert_eq!(first["method"], "SUBSCRIBE");
    assert_eq!(first["id"], 1);
    assert_eq!(first["params"].as_array().unwrap().len(), 50);
    assert_eq!(first["params"][0], "sym0usdt@depth20@100ms");
    let last = parsed(&frames[3]);
    assert_eq!(last["id"], 4);
    assert_eq!(last["params"].as_array().unwrap().len(), 43);
}

#[test]
fn lowercases_an_id_in_chinese_characters_and_a_hyphenated_id_as_written() {
    let slice = vec![market(BIANRENSHENG), market(B_MONEY)];

    let frames = venue().subscribe_frames(&slice, &mut State::default());

    assert_eq!(parsed(&frames[0])["params"], json!(["币安人生usdt@depth20@100ms", "b-moneyusdt@depth20@100ms"]));
}

// handle

#[test]
fn replaces_the_whole_book_on_every_frame() {
    let mut conn = connection(&[BTC]);

    let first = send(&mut conn, btc_first());
    let second = send(&mut conn, btc_second());

    let (bids, asks) = btc_first_levels();
    assert_eq!(first, [(BTC.to_string(), bids, asks.clone())]);
    assert_eq!(second[0].1[0], BookLevel { price: 82531.5, size: 6.971 });
    assert_eq!(second[0].2, asks);
}

#[test]
fn routes_a_frame_by_the_symbol_spelled_in_chinese_characters() {
    let mut conn = connection(&[BTC, BIANRENSHENG]);

    let published = send(&mut conn, bianrensheng_frame());

    assert_eq!(
        published,
        [(
            BIANRENSHENG.to_string(),
            levels(&[(0.5712, 10.0), (0.5704, 2798.0)]),
            levels(&[(0.5716, 350.0), (0.5717, 54.0)]),
        )]
    );
}

#[test]
fn reads_a_frame_whose_symbol_arrives_escaped() {
    let mut conn = connection(&[BIANRENSHENG]);
    let escaped = bianrensheng_frame().to_string().replace("币安人生USDT", "\\u5e01\\u5b89\\u4eba\\u751fUSDT");

    venue().handle(escaped.as_bytes(), &mut conn).unwrap();

    assert_eq!(conn.take_published().len(), 1);
}

#[test]
fn drops_a_frame_for_a_market_the_connection_does_not_hold() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[BIANRENSHENG]);

    assert!(send(&mut conn, btc_first()).is_empty());
    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), BTC);
}

#[test]
fn logs_a_break_in_pu_and_still_applies_the_whole_frame_without_a_resync() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[BTC]);
    send(&mut conn, btc_first());
    let mut skipped = btc_second();
    skipped["data"]["pu"] = json!(599039523000_i64);

    let published = send(&mut conn, skipped);

    assert_eq!(published.len(), 1);
    assert!(!conn.resync_requested());
    let gap = &logs.events("book_sequence_gap")[0];
    assert_eq!(gap.level, Level::WARN);
    assert_eq!(gap.number("expected"), 599039522069.0);
}

#[test]
fn logs_no_gap_on_the_first_frame_or_a_chained_one() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[BTC]);

    send(&mut conn, btc_first());
    send(&mut conn, btc_second());

    assert!(logs.events("book_sequence_gap").is_empty());
}

#[test]
fn takes_an_acknowledgement_quietly_and_logs_an_error_frame() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[BTC]);

    assert!(send(&mut conn, json!({ "id": 1, "result": null })).is_empty());
    assert!(logs.events("venue_error").is_empty());

    // Both captured on 2026-10-12, for a frame that was not JSON and for an unknown method.
    send(&mut conn, json!({ "id": null, "error": { "code": 3, "msg": "Invalid json" } }));
    send(
        &mut conn,
        json!({ "id": 2, "error": { "code": 2, "msg": "Invalid request: unknown method, expected one of SUBSCRIBE, UNSUBSCRIBE, LIST_SUBSCRIPTIONS, SET_PROPERTY, GET_PROPERTY" } }),
    );

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].number("code"), 3.0);
    assert_eq!(errors[1].text("message").split(':').next(), Some("Invalid request"));
}

#[test]
fn fails_a_frame_that_is_not_json() {
    let mut conn = connection(&[BTC]);

    assert!(venue().handle(b"{not json", &mut conn).is_err());
}

// REST seed

#[test]
fn queues_no_rest_read_before_the_seed_wait() {
    let mut conn = connection(&[BTC, B_MONEY]);

    send(&mut conn, json!({ "id": 1, "result": null }));
    send(&mut conn, btc_first());

    assert!(conn.queued_snapshots().is_empty());
    assert!(!conn.state.seeded);
}

#[test]
fn queues_a_rest_read_once_for_every_book_still_empty_after_the_seed_wait() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[BTC, B_MONEY, BIANRENSHENG]);
    send(&mut conn, btc_first());
    conn.state.first_frame_at -= SEED_AFTER_MS;

    send(&mut conn, btc_second());
    send(&mut conn, bianrensheng_frame());

    assert_eq!(conn.queued_snapshots(), [1, 2]);
    assert!(conn.state.seeded);
    assert_eq!(logs.events("book_seed_queued")[0].number("markets"), 2.0);
}

#[test]
fn builds_the_rest_book_url_and_percent_encodes_an_id_in_chinese_characters() {
    assert_eq!(
        venue().snapshot_url(&market(B_MONEY)).unwrap(),
        "https://fapi.asterdex.com/fapi/v3/depth?symbol=B-MONEYUSDT&limit=20"
    );
    assert_eq!(
        venue().snapshot_url(&market(BIANRENSHENG)).unwrap(),
        "https://fapi.asterdex.com/fapi/v3/depth?symbol=%E5%B8%81%E5%AE%89%E4%BA%BA%E7%94%9FUSDT&limit=20"
    );
}

#[test]
fn seeds_a_quiet_book_from_the_rest_reply() {
    let mut conn = connection(&[BTC, B_MONEY]);

    let published = snapshot(&mut conn, 1, b_money_book());

    assert_eq!(
        published,
        [(
            B_MONEY.to_string(),
            levels(&[(0.001, 7928.0), (0.00099, 10101.0), (0.00091, 109890.0)]),
            levels(&[(0.00101, 99009.0), (0.00131, 8059.0), (0.00429, 3368.0)]),
        )]
    );
}

#[test]
fn skips_a_rest_book_older_than_the_frame_the_book_holds() {
    let mut conn = connection(&[BTC]);
    send(&mut conn, btc_second());
    let mut older = b_money_book();
    older["lastUpdateId"] = json!(599039522069_i64);

    assert!(snapshot(&mut conn, 0, older).is_empty());
}

#[test]
fn skips_a_frame_older_than_the_rest_book_the_book_holds() {
    let mut conn = connection(&[BTC]);
    let mut newer = b_money_book();
    newer["lastUpdateId"] = json!(599039523000_i64);
    snapshot(&mut conn, 0, newer);

    assert!(send(&mut conn, btc_first()).is_empty());
    assert_eq!(send(&mut conn, btc_second()).len(), 1);
}

#[test]
fn fails_a_rest_reply_that_is_not_a_book() {
    let mut conn = connection(&[BTC]);

    assert!(venue().handle_snapshot(0, br#"{"code":-1121,"msg":"Invalid symbol."}"#, &mut conn).is_err());
    assert!(venue().handle_snapshot(0, b"<html></html>", &mut conn).is_err());
    assert!(conn.take_published().is_empty());
}
