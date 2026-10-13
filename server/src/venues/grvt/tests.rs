// Frames captured live on 2026-10-12 from wss://market-data.grvt.io/ws/full, with the level arrays cut down.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.split('_').next().unwrap();
    testing::market(ID, raw_market_id, base, "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    (0..count).map(|i| market(&format!("SYM{i}_USDT_Perp"))).collect()
}

fn venue() -> Grvt {
    Grvt::new(&[])
}

fn connection() -> Connection<State> {
    Connection::for_test("grvt#perp#0", vec![market("BTC_USDT_Perp"), market("KPEPE_USDT_Perp")])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    pairs.iter().map(|&(price, size)| BookLevel { price, size }).collect()
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

fn btc_ack() -> Value {
    json!({"jsonrpc":"2.0","result":{"stream":"v1.book.d","subs":["BTC_USDT_Perp@100"],"unsubs":[],"num_snapshots":[1],"first_sequence_number":["295941"],"latest_sequence_number":["295940"]},"id":1,"method":"subscribe"})
}

fn btc_snapshot() -> Value {
    json!({"stream":"v1.book.d","selector":"BTC_USDT_Perp@100","sequence_number":"0","feed":{"event_time":"1791845886950000000","instrument":"BTC_USDT_Perp","bids":[{"price":"82343.3","size":"4.02","num_orders":10},{"price":"82339.2","size":"2.428","num_orders":1},{"price":"82338.6","size":"0.002","num_orders":1}],"asks":[{"price":"82343.4","size":"0.036","num_orders":1},{"price":"82348.1","size":"0.078","num_orders":2},{"price":"82349.4","size":"0.728","num_orders":1}]},"prev_sequence_number":"0"})
}

// The first delta after the snapshot, numbered as the acknowledgement said, cut to two of its eleven levels.
fn btc_first_delta() -> Value {
    json!({"stream":"v1.book.d","selector":"BTC_USDT_Perp@100","sequence_number":"295941","feed":{"event_time":"1791845887000062149","instrument":"BTC_USDT_Perp","bids":[{"price":"82339.2","size":"0.0","num_orders":0}],"asks":[{"price":"82349.4","size":"0.5","num_orders":1}]},"prev_sequence_number":"295940"})
}

fn btc_delta(sequence: u64) -> Value {
    json!({"stream":"v1.book.d","selector":"BTC_USDT_Perp@100","sequence_number":sequence.to_string(),"feed":{"event_time":"1791845887100057358","instrument":"BTC_USDT_Perp","bids":[{"price":"82343.2","size":"2.428","num_orders":1}],"asks":[{"price":"82343.6","size":"1.06","num_orders":1}]},"prev_sequence_number":(sequence - 1).to_string()})
}

fn live_btc(conn: &mut Connection<State>) {
    send(conn, btc_ack());
    send(conn, btc_snapshot());
}

// plan and settings

#[test]
fn cuts_184_markets_into_four_even_connections_of_at_most_60() {
    let plans = venue().plan(&markets(184));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [46, 46, 46, 46]);
    assert_eq!(plans[3].id, "grvt#perp#3");
    assert!(plans.iter().all(|plan| plan.url == "wss://market-data.grvt.io/ws/full"));
    assert_eq!(venue().plan(&markets(60)).len(), 1);
    let sizes: Vec<usize> = venue().plan(&markets(61)).iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [31, 30]);
}

#[test]
fn answers_the_server_pings_through_the_runtime_and_paces_every_connection_under_300_subscribes_a_minute() {
    let few = venue().settings();
    assert_eq!(few.ping_every, None);
    assert_eq!(few.max_silence, Duration::from_secs(15));
    assert_eq!(few.subscribe_gap, Duration::from_millis(225));
    assert_eq!(few.connect_stagger, Duration::ZERO);

    // Four connections at once, each one frame per 900 ms, are 4.4 subscribes a second together.
    let all = Grvt::new(&testing::tracked(&markets(184))).settings();
    assert_eq!(all.subscribe_gap, Duration::from_millis(900));
}

// subscribe_frames

#[test]
fn subscribes_every_book_then_every_ticker_one_selector_a_frame_with_ids_that_name_the_market() {
    let frames = venue().subscribe_frames(&[market("BTC_USDT_Perp"), market("KPEPE_USDT_Perp")], &mut State::default());

    let frames: Vec<Value> = frames.iter().map(parsed).collect();
    assert_eq!(
        frames,
        [
            json!({"jsonrpc":"2.0","method":"subscribe","params":{"stream":"v1.book.d","selectors":["BTC_USDT_Perp@100"]},"id":1}),
            json!({"jsonrpc":"2.0","method":"subscribe","params":{"stream":"v1.book.d","selectors":["KPEPE_USDT_Perp@100"]},"id":3}),
            json!({"jsonrpc":"2.0","method":"subscribe","params":{"stream":"v1.ticker.s","selectors":["BTC_USDT_Perp@500"]},"id":2}),
            json!({"jsonrpc":"2.0","method":"subscribe","params":{"stream":"v1.ticker.s","selectors":["KPEPE_USDT_Perp@500"]},"id":4}),
        ]
    );
    assert_eq!(subscription_of(3, &[market("BTC_USDT_Perp"), market("KPEPE_USDT_Perp")]), Some(("v1.book.d", "KPEPE_USDT_Perp")));
    assert_eq!(subscription_of(2, &[market("BTC_USDT_Perp")]), Some(("v1.ticker.s", "BTC_USDT_Perp")));
    assert_eq!(subscription_of(0, &[market("BTC_USDT_Perp")]), None);
    assert_eq!(subscription_of(5, &[market("BTC_USDT_Perp")]), None);
}

// handle

#[test]
fn hands_the_engine_the_snapshot_as_the_whole_book() {
    let mut conn = connection();

    assert!(send(&mut conn, btc_ack()).is_empty());
    let published = send(&mut conn, btc_snapshot());

    assert_eq!(
        published,
        [(
            "BTC_USDT_Perp".to_string(),
            levels(&[(82343.3, 4.02), (82339.2, 2.428), (82338.6, 0.002)]),
            levels(&[(82343.4, 0.036), (82348.1, 0.078), (82349.4, 0.728)]),
        )]
    );
}

#[test]
fn applies_the_delta_the_acknowledgement_names_and_then_each_next_number() {
    let mut conn = connection();
    live_btc(&mut conn);

    let first = send(&mut conn, btc_first_delta());
    assert_eq!(first[0].1, levels(&[(82343.3, 4.02), (82338.6, 0.002)]));
    assert_eq!(first[0].2, levels(&[(82343.4, 0.036), (82348.1, 0.078), (82349.4, 0.5)]));

    let next = send(&mut conn, btc_delta(295942));
    assert_eq!(next[0].1, levels(&[(82343.3, 4.02), (82343.2, 2.428), (82338.6, 0.002)]));
    assert_eq!(next[0].2, levels(&[(82343.4, 0.036), (82343.6, 1.06), (82348.1, 0.078), (82349.4, 0.5)]));
    assert!(!conn.resync_requested());
}

#[test]
fn drops_a_repeated_delta_without_a_resync() {
    let mut conn = connection();
    live_btc(&mut conn);
    send(&mut conn, btc_first_delta());
    send(&mut conn, btc_delta(295942));

    assert!(send(&mut conn, btc_delta(295942)).is_empty());
    assert!(send(&mut conn, btc_first_delta()).is_empty());

    assert!(!conn.resync_requested());
    assert_eq!(send(&mut conn, btc_delta(295943)).len(), 1);
}

#[test]
fn a_skipped_number_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    live_btc(&mut conn);

    assert!(send(&mut conn, btc_delta(295942)).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_gap");
    assert_eq!(logs.events("book_resync")[0].text("market"), "BTC_USDT_Perp");
}

#[test]
fn a_delta_before_the_snapshot_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_ack());

    send(&mut conn, btc_first_delta());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn a_delta_with_no_acknowledged_number_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());

    send(&mut conn, btc_first_delta());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_acknowledgement");
}

#[test]
fn a_level_that_does_not_read_resyncs_instead_of_being_skipped() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    live_btc(&mut conn);
    let mut bad = btc_first_delta();
    bad["feed"]["asks"][0]["size"] = json!("");

    assert!(send(&mut conn, bad).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn a_delta_with_two_empty_sides_moves_the_number_and_publishes_nothing() {
    let mut conn = connection();
    live_btc(&mut conn);
    let mut empty = btc_first_delta();
    empty["feed"]["bids"] = json!([]);
    empty["feed"]["asks"] = json!([]);

    assert!(send(&mut conn, empty).is_empty());

    assert_eq!(send(&mut conn, btc_delta(295942)).len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn a_later_snapshot_replaces_the_book() {
    let mut conn = connection();
    live_btc(&mut conn);
    send(&mut conn, btc_first_delta());
    let mut again = btc_snapshot();
    again["feed"]["bids"] = json!([{"price":"82300.0","size":"1.0","num_orders":1}]);

    let published = send(&mut conn, again);

    assert_eq!(published[0].1, levels(&[(82300.0, 1.0)]));
    assert_eq!(send(&mut conn, btc_delta(295942)).len(), 1);
}

#[test]
fn each_selector_counts_on_its_own() {
    // KPEPE's acknowledgement and first delta from the same capture, cut down.
    let mut conn = connection();
    live_btc(&mut conn);
    send(&mut conn, json!({"jsonrpc":"2.0","result":{"stream":"v1.book.d","subs":["KPEPE_USDT_Perp@100"],"unsubs":[],"num_snapshots":[1],"first_sequence_number":["102515"],"latest_sequence_number":["102514"]},"id":3,"method":"subscribe"}));
    send(&mut conn, json!({"stream":"v1.book.d","selector":"KPEPE_USDT_Perp@100","sequence_number":"0","feed":{"event_time":"1791845888450000000","instrument":"KPEPE_USDT_Perp","bids":[{"price":"0.0039791","size":"2327.0","num_orders":1}],"asks":[{"price":"0.0039806","size":"91941.0","num_orders":1}]},"prev_sequence_number":"0"}));

    let kpepe = send(&mut conn, json!({"stream":"v1.book.d","selector":"KPEPE_USDT_Perp@100","sequence_number":"102515","feed":{"event_time":"1791845888500044162","instrument":"KPEPE_USDT_Perp","bids":[{"price":"0.0039791","size":"0.0","num_orders":0}],"asks":[]},"prev_sequence_number":"102514"}));
    let btc = send(&mut conn, btc_first_delta());

    assert_eq!(kpepe[0].0, "KPEPE_USDT_Perp");
    assert!(kpepe[0].1.is_empty());
    assert_eq!(btc[0].0, "BTC_USDT_Perp");
    assert!(!conn.resync_requested());
}

#[test]
fn logs_a_refused_subscribe_with_its_market_and_keeps_the_connection() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, json!({"jsonrpc":"2.0","error":{"code":3000,"message":"Instrument is invalid"},"id":3,"method":"subscribe"}));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].number("code"), 3000.0);
    assert_eq!(errors[0].text("message"), "Instrument is invalid");
    assert_eq!(errors[0].text("market"), "KPEPE_USDT_Perp");
    assert_eq!(errors[0].text("stream"), "v1.book.d");
    assert_eq!(errors[0].text("connection"), "grvt#perp#0");
    assert!(!conn.resync_requested());
}

#[test]
fn an_unknown_instrument_publishes_nothing_and_an_unknown_frame_is_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let mut other = btc_snapshot();
    other["selector"] = json!("ETH_USDT_Perp@100");

    assert!(send(&mut conn, other).is_empty());
    send(&mut conn, json!({"jsonrpc":"2.0","method":"notice"}));

    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "ETH_USDT_Perp");
    assert_eq!(logs.events("venue_notice").len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn a_frame_that_is_no_json_fails_the_frame_only() {
    let mut conn = connection();

    assert!(venue().handle(b"hello", &mut conn).is_err());
    assert!(!conn.resync_requested());
}

#[test]
fn the_selector_names_the_instrument_and_ns_turn_into_ms() {
    assert_eq!(instrument_of("BTC_USDT_Perp@100"), "BTC_USDT_Perp");
    assert_eq!(instrument_of("BTC_USDT_Perp"), "BTC_USDT_Perp");
    assert_eq!(ns_to_ms(1_791_849_600_000_000_000.0), 1_791_849_600_000);
    assert_eq!(ns_to_ms(f64::NAN), 0);
    assert_eq!(ns_to_ms(0.0), 0);
}
