// Ported case for case from old_ts_server/src/venues/gemini/gemini.spec.ts.
// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

// The ETH snapshot cut down to two levels a side, then the two consecutive deltas captured after it.
const SNAPSHOT_U: i64 = 1764527605192323;
const SNAPSHOT_BIDS: &[(&str, &str)] = &[("2482.5500", "1.047"), ("2482.0000", "2.000")];
const SNAPSHOT_ASKS: &[(&str, &str)] = &[("2483.5000", "1.047"), ("2484.0000", "3.000")];
const NO_LEVELS: &[(&str, &str)] = &[];

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id[..raw_market_id.find("usdc").unwrap()].to_uppercase();
    testing::market(ID, raw_market_id, &base, "USDC", true)
}

fn venue() -> Gemini {
    Gemini::new(&[])
}

fn connection(raw_market_ids: &[&str]) -> Connection<State> {
    let mut markets = Vec::new();
    for id in raw_market_ids {
        markets.push(market(id));
    }
    Connection::for_test("gemini#swap#0", markets)
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// The shape captured live on 2026-09-15, written as text so E keeps the wire's nanosecond integer above 2^53.
fn depth_frame(s: &str, first: i64, last: i64, bids: &[(&str, &str)], asks: &[(&str, &str)]) -> String {
    format!(
        r#"{{"e":"depthUpdate","E":1789505894447220874,"s":"{s}","U":{first},"u":{last},"b":{},"a":{}}}"#,
        json!(bids),
        json!(asks)
    )
}

fn send(conn: &mut Connection<State>, frame: &str) -> Published {
    venue().handle(frame.as_bytes(), conn).unwrap();
    conn.take_published()
}

fn snapshot(conn: &mut Connection<State>) -> Published {
    send(conn, &depth_frame("ethusdcperp", SNAPSHOT_U, SNAPSHOT_U, SNAPSHOT_BIDS, SNAPSHOT_ASKS))
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// plan

#[test]
fn puts_every_market_on_one_connection_that_asks_for_full_snapshots() {
    let plans = venue().plan(&[market("btcusdcperp"), market("ethusdcperp")]);

    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0].id, "gemini#swap#0");
    assert_eq!(plans[0].url, "wss://ws.gemini.com/?snapshot=-1");
    assert_eq!(plans[0].markets.len(), 2);
    assert_eq!(venue().settings().max_silence, Duration::from_secs(60));
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames

#[test]
fn names_every_market_in_one_frame() {
    let frames = venue().subscribe_frames(&[market("avaxusdcperp"), market("btcusdcperp")], &mut State::default());

    let parsed: Vec<Value> = frames.iter().map(parsed).collect();
    assert_eq!(
        parsed,
        [json!({ "id": 1, "method": "subscribe", "params": ["avaxusdcperp@depth@100ms", "btcusdcperp@depth@100ms"] })]
    );
}

// ping, which replaced startKeepalive

#[test]
fn sends_the_application_ping_every_twenty_seconds_with_a_fresh_id() {
    let venue = venue();
    let mut state = State::default();

    let first = parsed(&venue.ping(&mut state));
    let second = parsed(&venue.ping(&mut state));

    assert_eq!(first, json!({ "id": 1, "method": "ping" }));
    assert_eq!(second, json!({ "id": 2, "method": "ping" }));
    assert_eq!(venue.settings().ping_every, Some(Duration::from_secs(20)));
}

// handle

#[test]
fn takes_the_first_frame_of_a_symbol_as_the_whole_book() {
    let mut conn = connection(&["ethusdcperp"]);

    let published = snapshot(&mut conn);

    assert_eq!(
        published,
        [(
            "ethusdcperp".to_string(),
            levels(&[(2482.55, 1.047), (2482.0, 2.0)]),
            levels(&[(2483.5, 1.047), (2484.0, 3.0)]),
        )]
    );
}

#[test]
fn applies_a_frame_whose_first_id_equals_the_last_u_with_unsorted_levels() {
    let mut conn = connection(&["ethusdcperp"]);
    let mut published = snapshot(&mut conn).len();

    published += send(
        &mut conn,
        &depth_frame(
            "ethusdcperp",
            SNAPSHOT_U,
            1764527605192686,
            &[("2482.5500", "0.000")],
            &[("2483.5000", "0.000"), ("2483.4500", "1.047")],
        ),
    )
    .len();
    let last = send(&mut conn, &depth_frame("ethusdcperp", 1764527605192686, 1764527605192712, &[("2482.5500", "1.047")], NO_LEVELS));
    published += last.len();

    assert_eq!(published, 3);
    assert_eq!(last[0].1, levels(&[(2482.55, 1.047), (2482.0, 2.0)]));
    assert_eq!(last[0].2, levels(&[(2483.45, 1.047), (2484.0, 3.0)]));
}

#[test]
fn applies_a_frame_that_straddles_the_last_u() {
    let mut conn = connection(&["ethusdcperp"]);
    snapshot(&mut conn);

    let published = send(&mut conn, &depth_frame("ethusdcperp", SNAPSHOT_U - 10, SNAPSHOT_U + 5, &[("2482.6000", "0.5")], NO_LEVELS));

    assert_eq!(published[0].1, levels(&[(2482.6, 0.5), (2482.55, 1.047), (2482.0, 2.0)]));
}

#[test]
fn drops_a_frame_whose_u_is_at_or_below_the_last_u() {
    let mut conn = connection(&["ethusdcperp"]);
    snapshot(&mut conn);

    let equal = send(&mut conn, &depth_frame("ethusdcperp", SNAPSHOT_U - 5, SNAPSHOT_U, &[("1.0000", "1")], NO_LEVELS));
    let below = send(&mut conn, &depth_frame("ethusdcperp", SNAPSHOT_U - 9, SNAPSHOT_U - 1, &[("1.0000", "1")], NO_LEVELS));

    assert!(equal.is_empty() && below.is_empty());
}

#[test]
fn restarts_the_connection_when_the_first_id_skips_past_the_last_u() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["ethusdcperp"]);
    snapshot(&mut conn);

    let published = send(&mut conn, &depth_frame("ethusdcperp", SNAPSHOT_U + 1, SNAPSHOT_U + 9, &[("2482.6000", "0.5")], NO_LEVELS));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync.len(), 1);
    assert_eq!(resync[0].text("market"), "ethusdcperp");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

// A frame on a reopened connection whose U is far past the old u would read as a gap if the old id were kept.
#[test]
fn takes_the_first_frame_on_a_new_connection_as_the_whole_book_again() {
    let mut first = connection(&["ethusdcperp"]);
    snapshot(&mut first);

    let mut reopened = connection(&["ethusdcperp"]);
    let published = send(
        &mut reopened,
        &depth_frame("ethusdcperp", SNAPSHOT_U + 1000, SNAPSHOT_U + 1000, &[("2490.0000", "1")], &[("2491.0000", "1")]),
    );

    assert_eq!(published, [("ethusdcperp".to_string(), levels(&[(2490.0, 1.0)]), levels(&[(2491.0, 1.0)]))]);
}

#[test]
fn keeps_each_symbol_on_its_own_update_id() {
    let mut conn = connection(&["ethusdcperp", "btcusdcperp"]);
    let mut published = snapshot(&mut conn).len();

    published += send(
        &mut conn,
        &depth_frame("btcusdcperp", SNAPSHOT_U + 400, SNAPSHOT_U + 400, &[("75955.500", "0.1387")], &[("75981.500", "0.1713")]),
    )
    .len();
    published += send(&mut conn, &depth_frame("ethusdcperp", SNAPSHOT_U, SNAPSHOT_U + 500, &[("2482.6000", "0.5")], NO_LEVELS)).len();

    assert_eq!(published, 3);
    assert!(!conn.resync_requested());
}

#[test]
fn logs_a_control_reply_whose_status_is_not_200_and_stays_silent_on_the_rest() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["btcusdcperp"]);

    send(&mut conn, r#"{"id":1,"status":200}"#);
    let published = send(
        &mut conn,
        r#"{"id":3,"status":400,"error":{"code":-1013,"msg":"Invalid stream name: nosuchperp@depth@100ms"}}"#,
    );

    assert!(published.is_empty());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("request"), "3");
    assert_eq!(errors[0].number("status"), 400.0);
    assert_eq!(errors[0].number("code"), -1013.0);
    assert_eq!(errors[0].text("message"), "Invalid stream name: nosuchperp@depth@100ms");
}

#[test]
fn drops_a_symbol_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["btcusdcperp"]);

    let first = snapshot(&mut conn);
    let second = snapshot(&mut conn);

    assert!(first.is_empty() && second.is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}
