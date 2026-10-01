// Ported case for case from old_ts_server/src/venues/coinbase/coinbase.spec.ts.
// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

// Captured verbatim from the live venue on 2026-09-07, with the update count cut down.
const SNAPSHOT_FRAME: &str = r#"{"channel":"l2_data","client_id":"","timestamp":"2026-09-07T01:57:58.894355Z","sequence_num":0,"events":[{"type":"snapshot","product_id":"BTC-PERP-INTX","updates":[{"side":"offer","event_time":"2026-09-07T01:57:58.894355Z","price_level":"79944.1","new_quantity":"1.2"},{"side":"bid","event_time":"2026-09-07T01:57:58.894355Z","price_level":"79943.9","new_quantity":"3.0105"},{"side":"bid","event_time":"2026-09-07T01:57:58.894355Z","price_level":"79943.8","new_quantity":"0.5"},{"side":"offer","event_time":"2026-09-07T01:57:58.894355Z","price_level":"79944","new_quantity":"0.048"}]}]}"#;
const LEVEL2_ACK: &str = r#"{"channel":"subscriptions","timestamp":"2026-09-07T23:37:22.278662782Z","sequence_num":1,"events":[{"subscriptions":{"level2":["BTC-PERP-INTX","ETH-PERP-INTX"]}}]}"#;
const HEARTBEATS_ACK: &str = r#"{"channel":"subscriptions","timestamp":"2026-09-07T23:37:22.278739877Z","sequence_num":2,"events":[{"subscriptions":{"heartbeats":["heartbeats"],"level2":["BTC-PERP-INTX","ETH-PERP-INTX"]}}]}"#;
const HEARTBEAT_FRAME: &str = r#"{"channel":"heartbeats","timestamp":"2026-09-07T23:37:22.675755362Z","sequence_num":3,"events":[{"current_time":"2026-09-07 23:37:22.674409 +0000 UTC m=+139651.272674714","heartbeat_counter":139651}]}"#;
// The venue reports an unknown channel name as an authentication failure, which is not what went wrong.
const ERROR_FRAME: &str = r#"{"type":"error","message":"authentication failure"}"#;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.split('-').next().unwrap();
    testing::market(ID, raw_market_id, base, "USDC", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}-PERP-INTX")));
    }
    markets
}

fn venue() -> Coinbase {
    Coinbase::new()
}

fn connection(raw_market_ids: &[&str]) -> Connection<Option<i64>> {
    let mut markets = Vec::new();
    for id in raw_market_ids {
        markets.push(market(id));
    }
    Connection::for_test("coinbase#swap#0", markets)
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

fn l2_frame(sequence: i64, events: Value) -> String {
    json!({ "channel": "l2_data", "sequence_num": sequence, "events": events }).to_string()
}

fn update(side: &str, price_level: &str, new_quantity: &str) -> Value {
    json!({ "side": side, "price_level": price_level, "new_quantity": new_quantity })
}

fn send(conn: &mut Connection<Option<i64>>, frame: &str) -> Published {
    venue().handle(frame.as_bytes(), conn).unwrap();
    conn.take_published()
}

// plan

#[test]
fn puts_about_thirty_products_on_each_connection() {
    let plans = venue().plan(&markets(61));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["coinbase#swap#0", "coinbase#swap#1", "coinbase#swap#2"]);
    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [30, 30, 1]);
    assert_eq!(plans[0].url, PUBLIC_URL);
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames

#[test]
fn subscribes_level2_before_heartbeats() {
    let frames = venue().subscribe_frames(&markets(2), &mut None);

    let mut parsed = Vec::new();
    for frame in &frames {
        let Message::Text(text) = frame else {
            panic!("a subscribe frame is text");
        };
        parsed.push(serde_json::from_str::<Value>(text.as_str()).unwrap());
    }
    assert_eq!(
        parsed,
        [
            json!({ "type": "subscribe", "channel": "level2", "product_ids": ["SYM0-PERP-INTX", "SYM1-PERP-INTX"] }),
            json!({ "type": "subscribe", "channel": "heartbeats" }),
        ]
    );
}

// handle

#[test]
fn hands_the_engine_a_snapshot_as_the_whole_book_sorted_with_offers_as_asks() {
    let mut conn = connection(&["BTC-PERP-INTX", "ETH-PERP-INTX"]);

    let published = send(&mut conn, SNAPSHOT_FRAME);

    assert_eq!(
        published,
        [(
            "BTC-PERP-INTX".to_string(),
            levels(&[(79943.9, 3.0105), (79943.8, 0.5)]),
            levels(&[(79944.0, 0.048), (79944.1, 1.2)]),
        )]
    );
}

#[test]
fn applies_an_update_event_and_hands_over_the_new_top() {
    let mut conn = connection(&["BTC-PERP-INTX", "ETH-PERP-INTX"]);
    send(&mut conn, SNAPSHOT_FRAME);

    let published = send(
        &mut conn,
        &l2_frame(
            1,
            json!([{ "type": "update", "product_id": "BTC-PERP-INTX", "updates": [update("bid", "79943.9", "0"), update("offer", "79944", "2")] }]),
        ),
    );

    assert_eq!(published[0].1, levels(&[(79943.8, 0.5)]));
    assert_eq!(published[0].2, levels(&[(79944.0, 2.0), (79944.1, 1.2)]));
}

#[test]
fn counts_the_sequence_across_every_channel_on_the_connection() {
    let mut conn = connection(&["BTC-PERP-INTX", "ETH-PERP-INTX"]);
    let mut published = 0;

    published += send(&mut conn, SNAPSHOT_FRAME).len();
    published += send(&mut conn, LEVEL2_ACK).len();
    published += send(&mut conn, HEARTBEATS_ACK).len();
    published += send(&mut conn, HEARTBEAT_FRAME).len();
    published += send(
        &mut conn,
        &l2_frame(4, json!([{ "type": "update", "product_id": "BTC-PERP-INTX", "updates": [update("bid", "79943.7", "1")] }])),
    )
    .len();

    assert!(!conn.resync_requested());
    assert_eq!(published, 2);
}

#[test]
fn restarts_the_connection_on_a_sequence_gap_and_drops_the_frame() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP-INTX", "ETH-PERP-INTX"]);
    send(&mut conn, SNAPSHOT_FRAME);

    let published = send(
        &mut conn,
        &l2_frame(2, json!([{ "type": "update", "product_id": "BTC-PERP-INTX", "updates": [update("bid", "79943.7", "1")] }])),
    );

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(conn.book(0).unwrap().bids().len(), 2);
    let resync = logs.events("book_resync");
    assert_eq!(resync.len(), 1);
    assert_eq!(resync[0].text("market"), "connection");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn restarts_the_connection_on_an_update_with_no_snapshot_behind_it() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP-INTX", "ETH-PERP-INTX"]);

    let published = send(
        &mut conn,
        &l2_frame(0, json!([{ "type": "update", "product_id": "BTC-PERP-INTX", "updates": [update("bid", "79943.7", "1")] }])),
    );

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "update_before_snapshot");
}

#[test]
fn routes_every_event_in_one_frame_by_its_own_product_id() {
    let mut conn = connection(&["BTC-PERP-INTX", "ETH-PERP-INTX"]);

    let published = send(
        &mut conn,
        &l2_frame(
            0,
            json!([
                { "type": "snapshot", "product_id": "BTC-PERP-INTX", "updates": [update("bid", "79943.9", "1")] },
                { "type": "snapshot", "product_id": "ETH-PERP-INTX", "updates": [update("offer", "3001", "2")] },
            ]),
        ),
    );

    assert_eq!(
        published,
        [
            ("BTC-PERP-INTX".to_string(), levels(&[(79943.9, 1.0)]), Vec::new()),
            ("ETH-PERP-INTX".to_string(), Vec::new(), levels(&[(3001.0, 2.0)])),
        ]
    );
}

#[test]
fn treats_a_heartbeat_as_liveness_only() {
    let mut conn = connection(&["BTC-PERP-INTX", "ETH-PERP-INTX"]);

    assert!(send(&mut conn, HEARTBEAT_FRAME).is_empty());
}

#[test]
fn stays_silent_when_the_acknowledgement_lists_every_subscribed_product() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP-INTX", "ETH-PERP-INTX"]);

    send(&mut conn, LEVEL2_ACK);
    send(&mut conn, HEARTBEATS_ACK);

    assert!(logs.events("subscription_missing").is_empty());
}

#[test]
fn warns_about_a_subscribed_product_the_acknowledgement_omits() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP-INTX", "ETH-PERP-INTX", "SOL-PERP-INTX"]);

    send(&mut conn, LEVEL2_ACK);

    let missing = logs.events("subscription_missing");
    assert_eq!(missing.len(), 1);
    assert_eq!(missing[0].level, Level::WARN);
    assert_eq!(missing[0].number("missing"), 1.0);
    assert_eq!(missing[0].number("markets"), 3.0);
    assert!(missing[0].text("sample").contains("SOL-PERP-INTX"));
}

#[test]
fn warns_when_the_acknowledgement_carries_no_level2_list_at_all() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP-INTX"]);

    send(
        &mut conn,
        r#"{"channel":"subscriptions","sequence_num":0,"events":[{"subscriptions":{"heartbeats":["heartbeats"]}}]}"#,
    );

    let missing = logs.events("subscription_missing");
    assert_eq!(missing.len(), 1);
    assert_eq!(missing[0].number("missing"), 1.0);
    assert_eq!(missing[0].number("markets"), 1.0);
}

#[test]
fn drops_a_product_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP-INTX"]);
    let stray = json!([{ "type": "snapshot", "product_id": "ETH-PERP-INTX", "updates": [update("bid", "3000", "1")] }]);

    let first = send(&mut conn, &l2_frame(0, stray.clone()));
    let second = send(&mut conn, &l2_frame(1, stray));

    assert!(first.is_empty() && second.is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

#[test]
fn logs_the_raw_text_of_an_error_frame() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-PERP-INTX"]);

    send(&mut conn, ERROR_FRAME);

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert!(errors[0].text("message").contains("authentication failure"));
}

// settings, which replaced startKeepalive

#[test]
fn installs_no_ping_and_relies_on_the_heartbeats_channel() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, None);
    assert_eq!(settings.max_silence, Duration::from_secs(15));
    assert_eq!(settings.connect_stagger, Duration::from_millis(300));
    assert_eq!(settings.reconnect_jitter, Duration::from_millis(1_500));
}
