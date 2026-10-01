// Ported case for case from old_ts_server/src/venues/krakenfutures/krakenfutures.spec.ts.
// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tokio_tungstenite::tungstenite::Bytes;
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    testing::market(ID, raw_market_id, &raw_market_id[3..6], "USD", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("PF_SYM{i}USD")));
    }
    markets
}

fn venue() -> KrakenFutures {
    KrakenFutures::new()
}

fn connection(raw_market_ids: &[&str]) -> Connection<HashMap<usize, i64>> {
    let mut markets = Vec::new();
    for id in raw_market_ids {
        markets.push(market(id));
    }
    Connection::for_test("krakenfutures#swap#0", markets)
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

fn snapshot_bids() -> Value {
    json!([{ "price": 79943, "qty": 0.0062 }, { "price": 79942, "qty": 1.5 }])
}

fn snapshot_asks() -> Value {
    json!([{ "price": 79944, "qty": 0.048 }, { "price": 79945, "qty": 2 }])
}

// The shapes captured live on 2026-09-07, with the level count cut down.
// Prices and quantities are JSON numbers.
fn snapshot(product_id: &str, seq: i64, bids: Value, asks: Value) -> Value {
    json!({
        "feed": "book_snapshot",
        "product_id": product_id,
        "timestamp": 1788746279044_i64,
        "seq": seq,
        "tickSize": null,
        "bids": bids,
        "asks": asks,
    })
}

fn delta(product_id: &str, seq: i64, side: &str, price: f64, qty: f64) -> Value {
    json!({
        "feed": "book",
        "product_id": product_id,
        "side": side,
        "seq": seq,
        "price": price,
        "qty": qty,
        "timestamp": 1788746279050_i64,
    })
}

fn send(conn: &mut Connection<HashMap<usize, i64>>, frame: Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

// plan

#[test]
fn chunks_every_market_onto_the_one_public_endpoint() {
    let plans = venue().plan(&markets(150));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["krakenfutures#swap#0", "krakenfutures#swap#1"]);
    assert_eq!(plans[0].markets.len(), 100);
    assert_eq!(plans[1].markets.len(), 50);
    assert_eq!(plans[0].url, "wss://futures.kraken.com/ws/v1");
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames

#[test]
fn names_the_book_feed_once_and_passes_the_product_ids_as_one_array() {
    let frames = venue().subscribe_frames(&markets(150), &mut HashMap::new());

    assert_eq!(frames.len(), 2);
    let mut parsed = Vec::new();
    for frame in &frames {
        let Message::Text(text) = frame else {
            panic!("a subscribe frame is text");
        };
        parsed.push(serde_json::from_str::<Value>(text.as_str()).unwrap());
    }
    assert_eq!(parsed[0]["event"], "subscribe");
    assert_eq!(parsed[0]["feed"], "book");
    assert_eq!(parsed[0]["product_ids"].as_array().unwrap().len(), 100);
    assert_eq!(parsed[0]["product_ids"][0], "PF_SYM0USD");
    assert_eq!(parsed[1]["product_ids"].as_array().unwrap().len(), 50);
}

// handle

#[test]
fn hands_the_engine_a_subscribed_snapshot_as_the_whole_book() {
    let mut conn = connection(&["PF_XBTUSD"]);

    let published = send(&mut conn, snapshot("PF_XBTUSD", 186304944, snapshot_bids(), snapshot_asks()));

    assert_eq!(
        published,
        [(
            "PF_XBTUSD".to_string(),
            levels(&[(79943.0, 0.0062), (79942.0, 1.5)]),
            levels(&[(79944.0, 0.048), (79945.0, 2.0)]),
        )]
    );
}

#[test]
fn applies_one_level_deltas_in_sequence_on_either_side() {
    let mut conn = connection(&["PF_XBTUSD"]);
    send(&mut conn, snapshot("PF_XBTUSD", 186304944, snapshot_bids(), snapshot_asks()));

    let bid = send(&mut conn, delta("PF_XBTUSD", 186304945, "buy", 79943.0, 0.5));
    let ask = send(&mut conn, delta("PF_XBTUSD", 186304946, "sell", 79944.0, 0.0));

    assert_eq!(bid.len(), 1);
    assert_eq!(ask[0].1, levels(&[(79943.0, 0.5), (79942.0, 1.5)]));
    assert_eq!(ask[0].2, levels(&[(79945.0, 2.0)]));
}

#[test]
fn keeps_the_sequence_per_product_so_two_products_interleave_freely() {
    let mut conn = connection(&["PF_XBTUSD", "PF_ETHUSD"]);
    let mut published = 0;
    published += send(&mut conn, snapshot("PF_XBTUSD", 10, snapshot_bids(), snapshot_asks())).len();
    published += send(
        &mut conn,
        snapshot("PF_ETHUSD", 500, json!([{ "price": 3000, "qty": 1 }]), json!([{ "price": 3001, "qty": 1 }])),
    )
    .len();

    published += send(&mut conn, delta("PF_ETHUSD", 501, "buy", 2999.0, 1.0)).len();
    published += send(&mut conn, delta("PF_XBTUSD", 11, "buy", 79941.0, 1.0)).len();
    published += send(&mut conn, delta("PF_ETHUSD", 502, "sell", 3002.0, 1.0)).len();

    assert!(!conn.resync_requested());
    assert_eq!(published, 5);
}

#[test]
fn restarts_the_connection_on_a_sequence_gap_and_applies_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["PF_XBTUSD"]);
    send(&mut conn, snapshot("PF_XBTUSD", 186304944, snapshot_bids(), snapshot_asks()));

    let published = send(&mut conn, delta("PF_XBTUSD", 186304947, "buy", 79943.0, 0.5));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(conn.book(0).unwrap().bids()[0], BookLevel { price: 79943.0, size: 0.0062 });
    let resync = logs.events("book_resync");
    assert_eq!(resync.len(), 1);
    assert_eq!(resync[0].text("market"), "PF_XBTUSD");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn restarts_the_connection_on_a_delta_with_no_snapshot_behind_it() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["PF_XBTUSD"]);

    let published = send(&mut conn, delta("PF_XBTUSD", 1, "buy", 79943.0, 0.5));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn passes_a_one_sided_snapshot_through_with_the_empty_side_empty() {
    let mut conn = connection(&["PF_LAYERUSD"]);

    let published = send(&mut conn, snapshot("PF_LAYERUSD", 7, snapshot_bids(), json!([])));

    assert_eq!(published[0].1.len(), 2);
    assert!(published[0].2.is_empty());
}

#[test]
fn drops_a_product_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["PF_XBTUSD"]);

    let first = send(&mut conn, snapshot("PF_ETHUSD", 1, snapshot_bids(), snapshot_asks()));
    let second = send(&mut conn, snapshot("PF_ETHUSD", 1, snapshot_bids(), snapshot_asks()));

    assert!(first.is_empty() && second.is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

#[test]
fn logs_an_alert_and_stays_silent_on_the_banner_and_the_acknowledgement() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["PF_XBTUSD"]);

    send(&mut conn, json!({ "event": "info", "version": 1 }));
    send(&mut conn, json!({ "event": "subscribed", "feed": "book", "product_ids": ["PF_XBTUSD"] }));
    let published = send(&mut conn, json!({ "event": "alert", "message": "Bad request: invalid product `PF_NOPEUSD`" }));

    assert!(published.is_empty());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("message"), "Bad request: invalid product `PF_NOPEUSD`");
}

// ping, which replaced startKeepalive

#[test]
fn sends_a_protocol_ping_and_never_a_json_one() {
    let venue = venue();

    assert_eq!(venue.ping(&mut HashMap::new()), Message::Ping(Bytes::new()));
    assert_eq!(venue.settings().ping_every, Some(Duration::from_secs(20)));
    assert_eq!(venue.settings().max_silence, Duration::from_secs(30));
}
