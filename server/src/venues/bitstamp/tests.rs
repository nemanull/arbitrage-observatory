// Ported case for case from old_ts_server/src/venues/bitstamp/bitstamp.spec.ts.
// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

const BIDS: &[(&str, &str)] = &[("77188", "0.41122"), ("77183", "0.32386"), ("77180", "1.87131")];
const ASKS: &[(&str, &str)] = &[("77189", "0.41124"), ("77193", "0.32385"), ("77194", "1.10113")];

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id[..raw_market_id.find("usd").unwrap()].to_uppercase();
    testing::market(ID, raw_market_id, &base, "USD", true)
}

fn venue() -> Bitstamp {
    Bitstamp::new(&[])
}

fn connection(raw_market_ids: &[&str]) -> Connection<HashMap<usize, i64>> {
    let mut markets = Vec::new();
    for id in raw_market_ids {
        markets.push(market(id));
    }
    Connection::for_test("bitstamp#swap#0", markets)
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// The shape captured live on 2026-09-15, with the level count cut down to three.
fn book_frame(raw_market_id: &str, microtimestamp: &str, bids: &[(&str, &str)], asks: &[(&str, &str)]) -> Value {
    json!({
        "data": { "timestamp": &microtimestamp[..10], "microtimestamp": microtimestamp, "bids": bids, "asks": asks },
        "channel": format!("order_book_{raw_market_id}"),
        "event": "data",
    })
}

fn send(conn: &mut Connection<HashMap<usize, i64>>, frame: Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

#[test]
fn waits_a_minute_for_a_first_book_and_tolerates_a_minute_of_silence() {
    let settings = venue().settings();

    assert_eq!(settings.first_book_wait, Duration::from_secs(60));
    assert_eq!(settings.max_silence, Duration::from_secs(60));
}

// plan

#[test]
fn puts_every_market_on_one_connection() {
    let plans = venue().plan(&[market("btcusd-perp"), market("asterusd-perp")]);

    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0].id, "bitstamp#swap#0");
    assert_eq!(plans[0].url, "wss://ws.bitstamp.net");
    assert_eq!(plans[0].markets.len(), 2);
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames

#[test]
fn sends_one_book_channel_per_frame() {
    let frames = venue().subscribe_frames(&[market("btcusd-perp"), market("silverusd-perp")], &mut HashMap::new());

    let parsed: Vec<Value> = frames.iter().map(parsed).collect();
    assert_eq!(
        parsed,
        [
            json!({ "event": "bts:subscribe", "data": { "channel": "order_book_btcusd-perp" } }),
            json!({ "event": "bts:subscribe", "data": { "channel": "order_book_silverusd-perp" } }),
        ]
    );
}

// ping, which replaced startKeepalive

#[test]
fn sends_the_heartbeat_every_twenty_seconds() {
    assert_eq!(parsed(&venue().ping(&mut HashMap::new())), json!({ "event": "bts:heartbeat" }));
    assert_eq!(venue().settings().ping_every, Some(Duration::from_secs(20)));
}

// handle

#[test]
fn hands_the_engine_every_data_frame_as_the_whole_book() {
    let mut conn = connection(&["btcusd-perp"]);

    let first = send(&mut conn, book_frame("btcusd-perp", "1789457617906487", BIDS, ASKS));
    let second = send(&mut conn, book_frame("btcusd-perp", "1789457618106112", &[("77187", "0.5")], &[("77190", "0.2")]));

    assert_eq!(
        first,
        [(
            "btcusd-perp".to_string(),
            levels(&[(77188.0, 0.41122), (77183.0, 0.32386), (77180.0, 1.87131)]),
            levels(&[(77189.0, 0.41124), (77193.0, 0.32385), (77194.0, 1.10113)]),
        )]
    );
    assert_eq!(second, [("btcusd-perp".to_string(), levels(&[(77187.0, 0.5)]), levels(&[(77190.0, 0.2)]))]);
}

#[test]
fn drops_a_frame_whose_microtimestamp_is_not_above_the_last_applied_one() {
    let mut conn = connection(&["btcusd-perp"]);
    send(&mut conn, book_frame("btcusd-perp", "1789457617906487", BIDS, ASKS));

    let older = send(&mut conn, book_frame("btcusd-perp", "1789457617906486", &[("1", "1")], ASKS));
    let equal = send(&mut conn, book_frame("btcusd-perp", "1789457617906487", &[("1", "1")], ASKS));

    assert!(older.is_empty() && equal.is_empty());
}

#[test]
fn keeps_each_market_on_its_own_microtimestamp() {
    let mut conn = connection(&["btcusd-perp", "asterusd-perp"]);

    let btc = send(&mut conn, book_frame("btcusd-perp", "1789457617906487", BIDS, ASKS));
    let aster = send(&mut conn, book_frame("asterusd-perp", "1789456316294301", &[("0.68704", "18089")], &[("0.68806", "30")]));

    assert_eq!(btc.len() + aster.len(), 2);
}

#[test]
fn ends_the_connection_on_a_reconnect_request_so_the_runtime_reopens_it() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["btcusd-perp"]);

    let published = send(&mut conn, json!({ "event": "bts:request_reconnect", "channel": "", "data": null }));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync.len(), 1);
    assert_eq!(resync[0].level, Level::WARN);
    assert_eq!(resync[0].text("reason"), "reconnect_requested");
}

#[test]
fn logs_an_error_frame_and_stays_silent_on_the_acknowledgement_and_the_heartbeat_answer() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["btcusd-perp"]);

    send(&mut conn, json!({ "event": "bts:subscription_succeeded", "channel": "order_book_btcusd-perp", "data": {} }));
    send(&mut conn, json!({ "event": "bts:heartbeat", "channel": "", "data": { "status": "success" } }));
    let published = send(
        &mut conn,
        json!({ "event": "bts:error", "channel": "", "data": { "code": null, "message": "Invalid channel provided." } }),
    );

    assert!(published.is_empty());
    assert!(!conn.resync_requested());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("code"), "none");
    assert_eq!(errors[0].text("message"), "Invalid channel provided.");
}

#[test]
fn ignores_the_diff_and_funding_channels() {
    let mut conn = connection(&["btcusd-perp"]);

    let funding = send(
        &mut conn,
        json!({
            "data": {
                "market": "btcusd-perp", "mark_price": "77186.81199586", "index_price": "77177.99454545454",
                "funding_rate": "0.000123", "timestamp": "1789457618", "next_funding_time": "1789459200",
            },
            "channel": "funding_rate_btcusd-perp",
            "event": "funding_rate_saved",
        }),
    );
    let diff = send(
        &mut conn,
        json!({
            "data": { "timestamp": "1789456316", "microtimestamp": "1789456316507635", "bids": [["77049", "0.00000"]], "asks": [] },
            "channel": "diff_order_book_btcusd-perp",
            "event": "data",
        }),
    );

    assert!(funding.is_empty() && diff.is_empty());
}

#[test]
fn drops_a_market_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["btcusd-perp"]);

    let first = send(&mut conn, book_frame("ethusd-perp", "1789457617906487", BIDS, ASKS));
    let second = send(&mut conn, book_frame("ethusd-perp", "1789457617906488", BIDS, ASKS));

    assert!(first.is_empty() && second.is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}
