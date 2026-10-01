// Ported case for case from old_ts_server/src/venues/binance/binance.spec.ts.
// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::engine::cluster::index_builder::DEPTH_LEVEL;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

// The shape captured live on 2026-09-15, with the level count cut down.
// Both channels send these fields.
const FIRST_ID: i64 = 11493080433094;

const BIDS: &[(&str, &str)] = &[("79909.30", "23.163"), ("79909.20", "1.500")];
const ASKS: &[(&str, &str)] = &[("79909.40", "4.611"), ("79909.50", "2.000")];

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str, linear: bool) -> Market {
    testing::market(ID, raw_market_id, &raw_market_id[..3], "USDT", linear)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}USDT"), true));
    }
    markets
}

fn venue() -> Binance {
    Binance::new(&[])
}

fn connection(markets: Vec<Market>) -> Connection<HashMap<usize, SymbolState>> {
    Connection::for_test("binance#linear#0", markets)
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

#[derive(Default, Clone, Copy)]
struct Ids {
    first: Option<i64>,    // U
    last: Option<i64>,     // u
    previous: Option<i64>, // pu
}

fn last(u: i64) -> Ids {
    Ids {
        last: Some(u),
        ..Ids::default()
    }
}

fn chained(u: i64) -> Ids {
    Ids {
        last: Some(u),
        previous: Some(u - 1),
        ..Ids::default()
    }
}

fn depth_update(symbol: &str, bids: &[(&str, &str)], asks: &[(&str, &str)], ids: Ids) -> Value {
    let u = ids.last.unwrap_or(FIRST_ID);
    json!({
        "e": "depthUpdate",
        "s": symbol,
        "U": ids.first.unwrap_or(u),
        "u": u,
        "pu": ids.previous.unwrap_or(u - 1),
        "E": 1788746280299_i64,
        "T": 1788746280297_i64,
        "b": bids,
        "a": asks,
    })
}

fn snapshot_frame(symbol: &str, bids: &[(&str, &str)], asks: &[(&str, &str)], ids: Ids) -> Value {
    json!({
        "stream": format!("{}@depth20@100ms", symbol.to_lowercase()),
        "data": depth_update(symbol, bids, asks, ids),
    })
}

fn diff_frame(symbol: &str, bids: &[(&str, &str)], asks: &[(&str, &str)], ids: Ids) -> Value {
    json!({
        "stream": format!("{}@depth@0ms", symbol.to_lowercase()),
        "data": depth_update(symbol, bids, asks, ids),
    })
}

// Handles one frame and returns what the engine would get for it.
fn send(conn: &mut Connection<HashMap<usize, SymbolState>>, frame: Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn seeded() -> Connection<HashMap<usize, SymbolState>> {
    let mut conn = connection(vec![market("BTCUSDT", true)]);
    assert_eq!(send(&mut conn, snapshot_frame("BTCUSDT", BIDS, ASKS, Ids::default())).len(), 1);
    conn
}

// plan

#[test]
fn chunks_linear_markets_onto_the_usd_m_book_host() {
    let plans = venue().plan(&markets(250));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["binance#linear#0", "binance#linear#1"]);
    assert_eq!(plans[0].markets.len(), 200);
    assert_eq!(plans[1].markets.len(), 50);
    assert_eq!(
        plans[0].url,
        "wss://fstream.binance.com/public/stream?streams=sym0usdt@depth@0ms/sym0usdt@depth20@100ms"
    );
    assert_eq!(
        plans[1].url,
        "wss://fstream.binance.com/public/stream?streams=sym200usdt@depth@0ms/sym200usdt@depth20@100ms"
    );
}

#[test]
fn sends_inverse_markets_to_the_coin_m_host_on_their_own_plans() {
    let plans = venue().plan(&[market("BTCUSDT", true), market("BTCUSD_PERP", false)]);

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["binance#linear#0", "binance#inverse#0"]);
    assert_eq!(
        plans[1].url,
        "wss://dstream.binance.com/stream?streams=btcusd_perp@depth@0ms/btcusd_perp@depth20@100ms"
    );
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames

#[test]
fn lowercases_both_stream_names_per_market_and_splits_them_across_frames() {
    let frames = venue().subscribe_frames(&markets(150), &mut HashMap::new());

    assert_eq!(frames.len(), 3);
    let mut parsed = Vec::new();
    for frame in &frames {
        let Message::Text(text) = frame else {
            panic!("a subscribe frame is text");
        };
        parsed.push(serde_json::from_str::<Value>(text.as_str()).unwrap());
    }
    assert_eq!(parsed[0]["method"], "SUBSCRIBE");
    assert_eq!(parsed[0]["params"].as_array().unwrap().len(), 100);
    assert_eq!(parsed[0]["params"][0], "sym0usdt@depth@0ms");
    assert_eq!(parsed[0]["params"][1], "sym0usdt@depth20@100ms");
    assert_eq!(parsed[2]["params"].as_array().unwrap().len(), 100);
    let ids: Vec<&Value> = parsed.iter().map(|frame| &frame["id"]).collect();
    assert_eq!(ids, [1, 2, 3]);
}

// settings

#[test]
fn pings_every_30_s_and_retires_the_socket_before_the_24_hour_cap() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(30)));
    assert_eq!(settings.max_silence, Duration::from_secs(240));
    assert_eq!(settings.retire_after, Some(Duration::from_secs(23 * 60 * 60)));
    assert_eq!(settings.retire_jitter, Duration::from_secs(30 * 60));
}

// handle

#[test]
fn seeds_the_book_from_a_snapshot_and_hands_it_to_the_engine() {
    let mut conn = connection(vec![market("BTCUSDT", true)]);

    let published = send(&mut conn, snapshot_frame("BTCUSDT", BIDS, ASKS, Ids::default()));

    assert_eq!(
        published,
        [(
            "BTCUSDT".to_string(),
            levels(&[(79909.3, 23.163), (79909.2, 1.5)]),
            levels(&[(79909.4, 4.611), (79909.5, 2.0)]),
        )]
    );
}

#[test]
fn merges_a_diff_onto_the_seeded_book_instead_of_replacing_it() {
    let mut conn = seeded();

    let published = send(
        &mut conn,
        diff_frame("BTCUSDT", &[("79909.35", "2")], &[("79909.40", "9")], chained(FIRST_ID + 1)),
    );

    assert_eq!(published[0].1, levels(&[(79909.35, 2.0), (79909.3, 23.163), (79909.2, 1.5)]));
    assert_eq!(published[0].2, levels(&[(79909.4, 9.0), (79909.5, 2.0)]));
}

#[test]
fn applies_the_first_diff_after_a_snapshot_when_it_straddles_the_snapshot_id() {
    let mut conn = seeded();

    let published = send(
        &mut conn,
        diff_frame(
            "BTCUSDT",
            &[("79909.30", "4")],
            &[],
            Ids {
                first: Some(FIRST_ID - 10),
                last: Some(FIRST_ID + 5),
                previous: Some(FIRST_ID - 11),
            },
        ),
    );

    assert_eq!(published[0].1, levels(&[(79909.3, 4.0), (79909.2, 1.5)]));
}

#[test]
fn removes_a_level_a_diff_zeroes() {
    let mut conn = seeded();

    let published = send(&mut conn, diff_frame("BTCUSDT", &[("79909.30", "0")], &[], chained(FIRST_ID + 1)));

    assert_eq!(published[0].1, levels(&[(79909.2, 1.5)]));
}

#[test]
fn ignores_a_diff_level_outside_the_window_the_snapshot_covered() {
    let mut conn = seeded();

    let published = send(
        &mut conn,
        diff_frame(
            "BTCUSDT",
            &[("79909.25", "3"), ("79909.10", "7")],
            &[("79909.45", "3"), ("79909.60", "7")],
            chained(FIRST_ID + 1),
        ),
    );

    assert_eq!(published[0].1, levels(&[(79909.3, 23.163), (79909.25, 3.0), (79909.2, 1.5)]));
    assert_eq!(published[0].2, levels(&[(79909.4, 4.611), (79909.45, 3.0), (79909.5, 2.0)]));
}

#[test]
fn drops_a_diff_that_arrives_before_any_snapshot() {
    let mut conn = connection(vec![market("BTCUSDT", true)]);

    let published = send(&mut conn, diff_frame("BTCUSDT", BIDS, ASKS, chained(FIRST_ID)));

    assert!(published.is_empty());
}

#[test]
fn drops_a_diff_whose_sequence_skips_warns_and_keeps_the_socket_open() {
    let (logs, _capture) = capture();
    let mut conn = seeded();

    let published = send(
        &mut conn,
        diff_frame(
            "BTCUSDT",
            &[("79909.30", "4")],
            &[],
            Ids {
                first: Some(FIRST_ID + 50),
                last: Some(FIRST_ID + 60),
                previous: Some(FIRST_ID + 49),
            },
        ),
    );

    assert!(published.is_empty());
    assert!(!conn.resync_requested());
    let desync = logs.events("book_desync");
    assert_eq!(desync.len(), 1);
    assert_eq!(desync[0].level, Level::WARN);
    assert_eq!(desync[0].text("market"), "BTCUSDT");
    assert_eq!(desync[0].number("expected"), FIRST_ID as f64);
}

#[test]
fn recovers_a_desynced_symbol_on_the_next_snapshot() {
    let (_logs, _capture) = capture();
    let mut conn = seeded();
    send(
        &mut conn,
        diff_frame(
            "BTCUSDT",
            &[("79909.30", "4")],
            &[],
            Ids {
                first: Some(FIRST_ID + 50),
                last: Some(FIRST_ID + 60),
                previous: Some(FIRST_ID + 49),
            },
        ),
    );

    send(&mut conn, snapshot_frame("BTCUSDT", &[("79909.10", "5")], &[("79909.70", "6")], last(FIRST_ID + 70)));
    let published = send(&mut conn, diff_frame("BTCUSDT", &[("79909.15", "8")], &[], chained(FIRST_ID + 71)));

    assert_eq!(published[0].1, levels(&[(79909.15, 8.0), (79909.1, 5.0)]));
    assert_eq!(published[0].2, levels(&[(79909.7, 6.0)]));
}

#[test]
fn ignores_a_snapshot_the_diffs_have_already_passed() {
    let mut conn = seeded();
    send(&mut conn, diff_frame("BTCUSDT", &[("79909.35", "2")], &[], chained(FIRST_ID + 1)));

    let published = send(&mut conn, snapshot_frame("BTCUSDT", BIDS, ASKS, Ids::default()));

    assert!(published.is_empty());
    let book = conn.book(0).unwrap();
    assert_eq!(book.bids(), levels(&[(79909.35, 2.0), (79909.3, 23.163), (79909.2, 1.5)]));
}

#[test]
fn waits_for_the_next_snapshot_when_a_diff_empties_a_side_of_the_window() {
    let mut conn = seeded();

    let published = send(
        &mut conn,
        diff_frame("BTCUSDT", &[("79909.30", "0"), ("79909.20", "0")], &[], chained(FIRST_ID + 1)),
    );

    // The venue still has bids under the window, so an empty side here is our window running out, not the book losing a side.
    assert!(published.is_empty());

    let published = send(&mut conn, snapshot_frame("BTCUSDT", &[("79909.10", "5")], ASKS, last(FIRST_ID + 2)));

    assert_eq!(published[0].1, levels(&[(79909.1, 5.0)]));
}

#[test]
fn reads_a_frame_with_no_stream_name_as_a_snapshot() {
    let mut conn = connection(vec![market("BTCUSDT", true)]);

    let published = send(&mut conn, depth_update("BTCUSDT", BIDS, ASKS, Ids::default()));

    assert_eq!(published.len(), 1);
    assert_eq!(published[0].0, "BTCUSDT");
}

#[test]
fn hands_over_only_as_many_levels_as_the_engine_holds() {
    let mut conn = connection(vec![market("BTCUSDT", true)]);
    let mut prices = Vec::new();
    for i in 0..DEPTH_LEVEL + 5 {
        prices.push((format!("{}", 79909.0 - i as f64), "1".to_string()));
    }
    let bids: Vec<(&str, &str)> = prices.iter().map(|(p, s)| (p.as_str(), s.as_str())).collect();

    let published = send(&mut conn, snapshot_frame("BTCUSDT", &bids, ASKS, Ids::default()));

    assert_eq!(published[0].1.len(), DEPTH_LEVEL);
    assert_eq!(published[0].1[0], BookLevel { price: 79909.0, size: 1.0 });
}

#[test]
fn passes_a_one_sided_book_through_with_the_empty_side_empty() {
    let mut conn = connection(vec![market("BTCUSDT", true)]);

    let published = send(&mut conn, snapshot_frame("BTCUSDT", BIDS, &[], Ids::default()));

    assert_eq!(published[0].1.len(), 2);
    assert!(published[0].2.is_empty());
}

#[test]
fn drops_a_symbol_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = connection(vec![market("BTCUSDT", true)]);

    let first = send(&mut conn, snapshot_frame("ETHUSDT", BIDS, ASKS, Ids::default()));
    let second = send(&mut conn, snapshot_frame("ETHUSDT", BIDS, ASKS, Ids::default()));

    assert!(first.is_empty() && second.is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

#[test]
fn logs_a_rejected_subscription_and_leaves_the_engine_alone() {
    let (logs, _capture) = capture();
    let mut conn = connection(vec![market("BTCUSDT", true)]);

    let rejected = send(&mut conn, json!({ "error": { "code": -1121, "msg": "Invalid symbol." }, "id": 1 }));
    let acknowledged = send(&mut conn, json!({ "result": null, "id": 1 }));

    assert!(rejected.is_empty() && acknowledged.is_empty());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].number("code"), -1121.0);
    assert_eq!(errors[0].text("message"), "Invalid symbol.");
}
