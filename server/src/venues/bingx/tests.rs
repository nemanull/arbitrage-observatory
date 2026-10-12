// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use flate2::Compression;
use flate2::write::GzEncoder;
use serde_json::{Value, json};
use std::io::Write;
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let (base, quote) = raw_market_id.split_once('-').unwrap();
    testing::market(ID, raw_market_id, base, quote, true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}-USDT")));
    }
    markets
}

fn venue() -> BingX {
    BingX::new()
}

fn connection(raw_ids: &[&str]) -> Connection<State> {
    let mut list = Vec::with_capacity(raw_ids.len());
    for id in raw_ids {
        list.push(market(id));
    }
    Connection::for_test("bingx#swap#0", list)
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

fn gzip(text: &[u8]) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(text).unwrap();
    encoder.finish().unwrap()
}

// Every frame arrives as binary gzip, so each case sends what the socket sends.
fn send_bytes(conn: &mut Connection<State>, text: &[u8]) -> Published {
    venue().handle(&gzip(text), conn).unwrap();
    conn.take_published()
}

fn send(conn: &mut Connection<State>, frame: Value) -> Published {
    send_bytes(conn, frame.to_string().as_bytes())
}

// The acknowledgement as captured live on 2026-10-08, whose data holds two null sides rather than null.
fn ack(id: &str) -> Value {
    json!({ "code": 0, "data": { "asks": null, "bids": null }, "dataType": "", "id": id, "msg": "" })
}

fn depth(symbol: &str, action: &str, id: i64, bids: Value, asks: Value) -> Value {
    json!({
        "code": 0, "dataType": format!("{symbol}@incrDepth"),
        "data": { "action": action, "lastUpdateId": id, "time": 1791514260879_i64, "bids": bids, "asks": asks },
    })
}

// The snapshot and the first update of BTC-USDT captured live on 2026-10-08, cut to three levels a side.
fn btc_snapshot() -> Value {
    depth(
        "BTC-USDT",
        "all",
        593068630,
        json!([["82122.3", "48.5887"], ["82122.1", "1.7066"], ["82121.9", "0.0123"]]),
        json!([["82122.4", "279.6771"], ["82122.6", "0.0547"], ["82122.7", "0.0636"]]),
    )
}

// Its ask array runs worst first, as most update ask arrays do.
fn btc_update() -> Value {
    depth(
        "BTC-USDT",
        "update",
        593068631,
        json!([["82122.3", "56.3739"], ["82122.1", "2.1804"], ["82121.9", "0.0131"]]),
        json!([["82445.2", "0.3151"], ["82123.3", "4.2181"], ["82123.1", "0.1141"]]),
    )
}

fn btc_update_for(symbol: &str) -> Value {
    let mut update = btc_update();
    update["dataType"] = json!(format!("{symbol}@incrDepth"));
    update
}

fn acked_btc() -> Connection<State> {
    let mut conn = connection(&["BTC-USDT"]);
    send(&mut conn, ack("BTC-USDT"));
    conn
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// plan

#[test]
fn puts_180_contracts_on_each_connection_to_the_one_swap_endpoint() {
    let plans = venue().plan(&markets(400));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["bingx#swap#0", "bingx#swap#1", "bingx#swap#2"]);
    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [180, 180, 40]);
    assert!(plans.iter().all(|plan| plan.url == "wss://open-api-swap.bingx.com/swap-market"));
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames and settings

#[test]
fn sends_one_incremental_depth_frame_per_contract_under_ten_a_second() {
    let frames = venue().subscribe_frames(&markets(3), &mut State::default());

    assert_eq!(frames.len(), 3);
    assert_eq!(parsed(&frames[0]), json!({ "id": "SYM0-USDT", "reqType": "sub", "dataType": "SYM0-USDT@incrDepth" }));
    assert_eq!(venue().settings().subscribe_gap, Duration::from_millis(111));
}

#[test]
fn starts_no_ping_timer_and_counts_the_server_ping_as_traffic() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, None);
    assert_eq!(settings.max_silence, Duration::from_secs(15));
}

// handle: keepalive

#[test]
fn answers_the_gzip_ping_with_a_text_pong() {
    let mut conn = connection(&["BTC-USDT"]);

    let published = send_bytes(&mut conn, b"Ping");

    assert!(published.is_empty());
    let sent = conn.take_sent();
    assert_eq!(sent.len(), 1);
    assert_eq!(sent[0], Message::text("Pong"));
}

// handle: books

#[test]
fn hands_the_engine_the_snapshot_of_an_acknowledged_contract() {
    let mut conn = acked_btc();

    let published = send(&mut conn, btc_snapshot());

    assert_eq!(
        published,
        [(
            "BTC-USDT".to_string(),
            levels(&[(82122.3, 48.5887), (82122.1, 1.7066), (82121.9, 0.0123)]),
            levels(&[(82122.4, 279.6771), (82122.6, 0.0547), (82122.7, 0.0636)]),
        )]
    );
    assert!(!conn.resync_requested());
}

#[test]
fn applies_an_update_by_price_whatever_order_its_levels_run_in() {
    let mut conn = acked_btc();
    send(&mut conn, btc_snapshot());

    let published = send(&mut conn, btc_update());

    assert_eq!(
        published,
        [(
            "BTC-USDT".to_string(),
            levels(&[(82122.3, 56.3739), (82122.1, 2.1804), (82121.9, 0.0131)]),
            levels(&[(82122.4, 279.6771), (82122.6, 0.0547), (82122.7, 0.0636), (82123.1, 0.1141), (82123.3, 4.2181), (82445.2, 0.3151)]),
        )]
    );
}

#[test]
fn deletes_a_level_whose_size_is_zero() {
    let mut conn = acked_btc();
    send(&mut conn, btc_snapshot());

    // A delete as the live updates write it, with four decimals of zero.
    let delete = depth("BTC-USDT", "update", 593068631, json!([["82122.1", "0.0000"]]), json!([["82122.6", "0.0000"]]));
    let published = send(&mut conn, delete);

    assert_eq!(
        published,
        [(
            "BTC-USDT".to_string(),
            levels(&[(82122.3, 48.5887), (82121.9, 0.0123)]),
            levels(&[(82122.4, 279.6771), (82122.7, 0.0636)]),
        )]
    );
}

#[test]
fn applies_an_update_whose_id_skips_forward() {
    let mut conn = acked_btc();
    send(&mut conn, btc_snapshot());

    let mut skipped = btc_update();
    skipped["data"]["lastUpdateId"] = json!(593068636);
    let published = send(&mut conn, skipped);

    assert_eq!(published.len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn resyncs_on_an_update_whose_id_does_not_move_forward() {
    let (logs, _capture) = capture();
    let mut conn = acked_btc();
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_update());

    let published = send(&mut conn, btc_update());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_gap");
}

// XRP-USDT on 2026-10-08: one update came 1 ms before the snapshot, with the id just under the snapshot's.
fn xrp_early_update() -> Value {
    depth("XRP-USDT", "update", 988720939, json!([]), json!([["1.3943", "148901"], ["1.3936", "138388"]]))
}

fn xrp_snapshot() -> Value {
    depth(
        "XRP-USDT",
        "all",
        988720940,
        json!([["1.3933", "64572"], ["1.3932", "32981"], ["1.3931", "52861"]]),
        json!([["1.3934", "181162"], ["1.3935", "164178"], ["1.3936", "138712"]]),
    )
}

fn xrp_snapshot_levels() -> (Vec<BookLevel>, Vec<BookLevel>) {
    (
        levels(&[(1.3933, 64572.0), (1.3932, 32981.0), (1.3931, 52861.0)]),
        levels(&[(1.3934, 181162.0), (1.3935, 164178.0), (1.3936, 138712.0)]),
    )
}

#[test]
fn drops_an_update_from_before_the_snapshot_that_the_snapshot_already_holds() {
    let mut conn = connection(&["XRP-USDT"]);
    send(&mut conn, ack("XRP-USDT"));

    assert!(send(&mut conn, xrp_early_update()).is_empty());
    let published = send(&mut conn, xrp_snapshot());

    let (bids, asks) = xrp_snapshot_levels();
    assert_eq!(published, [("XRP-USDT".to_string(), bids, asks)]);
    assert!(!conn.resync_requested());
}

#[test]
fn replays_an_update_from_before_the_snapshot_that_is_newer_than_it() {
    let mut conn = connection(&["XRP-USDT"]);
    send(&mut conn, ack("XRP-USDT"));

    let newer = depth("XRP-USDT", "update", 988720941, json!([["1.3933", "70000"]]), json!([["1.3934", "0"]]));
    assert!(send(&mut conn, newer).is_empty());
    let published = send(&mut conn, xrp_snapshot());

    let (_, asks) = xrp_snapshot_levels();
    assert_eq!(published[0].1[0], BookLevel { price: 1.3933, size: 70000.0 });
    assert_eq!(published[0].2, asks[1..]);
    assert!(!conn.resync_requested());

    let next = depth("XRP-USDT", "update", 988720942, json!([]), json!([["1.3940", "5"]]));
    assert_eq!(send(&mut conn, next).len(), 1);
    assert!(!conn.resync_requested());
}

// ONT-USDT on 2026-10-08: an update stamped 78 ms before the snapshot arrived after it, with the id just under the snapshot's.
#[test]
fn drops_an_update_after_the_snapshot_whose_id_the_snapshot_already_holds() {
    let mut conn = connection(&["ONT-USDT"]);
    send(&mut conn, ack("ONT-USDT"));
    let snapshot = depth(
        "ONT-USDT",
        "all",
        380706333,
        json!([["0.06009", "16453.8"], ["0.06008", "1202.3"]]),
        json!([["0.06013", "4969.3"], ["0.06015", "9913.4"]]),
    );
    send(&mut conn, snapshot);

    let stale = depth("ONT-USDT", "update", 380706332, json!([]), json!([["0.06019", "19034.1"], ["0.06015", "9923.1"]]));
    let published = send(&mut conn, stale);

    assert!(published.is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn resyncs_on_an_update_that_crosses_the_top_without_publishing_it() {
    let (logs, _capture) = capture();
    let mut conn = acked_btc();
    send(&mut conn, btc_snapshot());

    let crossing = depth("BTC-USDT", "update", 593068631, json!([["82122.5", "1.0"]]), json!([]));
    let published = send(&mut conn, crossing);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "crossed_book");
}

#[test]
fn resyncs_without_publishing_when_a_held_update_crosses_the_snapshot() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["XRP-USDT"]);
    send(&mut conn, ack("XRP-USDT"));

    let crossing = depth("XRP-USDT", "update", 988720941, json!([["1.3935", "10"]]), json!([]));
    send(&mut conn, crossing);
    let published = send(&mut conn, xrp_snapshot());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "crossed_book");
}

#[test]
fn resyncs_without_publishing_on_a_crossed_snapshot() {
    let (logs, _capture) = capture();
    let mut conn = acked_btc();

    let crossed = depth("BTC-USDT", "all", 593068630, json!([["82123", "1"]]), json!([["82122.4", "1"]]));
    let published = send(&mut conn, crossed);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "crossed_book");
}

#[test]
fn resyncs_without_publishing_when_two_held_updates_share_an_id() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["XRP-USDT"]);
    send(&mut conn, ack("XRP-USDT"));

    let update = depth("XRP-USDT", "update", 988720941, json!([["1.3933", "70000"]]), json!([]));
    send(&mut conn, update.clone());
    send(&mut conn, update);
    let published = send(&mut conn, xrp_snapshot());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_gap");
}

#[test]
fn resyncs_when_a_full_hold_dropped_an_update_newer_than_the_snapshot() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["XRP-USDT"]);
    send(&mut conn, ack("XRP-USDT"));
    for i in 0..65 {
        send(&mut conn, depth("XRP-USDT", "update", 988720941 + i, json!([["1.3933", "1"]]), json!([])));
    }

    let published = send(&mut conn, xrp_snapshot());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "held_update_dropped");
}

#[test]
fn seeds_from_a_full_hold_whose_dropped_updates_the_snapshot_already_holds() {
    let mut conn = connection(&["XRP-USDT"]);
    send(&mut conn, ack("XRP-USDT"));
    for i in 0..65 {
        send(&mut conn, depth("XRP-USDT", "update", 988720800 + i, json!([["1.3933", "1"]]), json!([])));
    }

    let published = send(&mut conn, xrp_snapshot());

    let (bids, asks) = xrp_snapshot_levels();
    assert_eq!(published, [("XRP-USDT".to_string(), bids, asks)]);
    assert!(!conn.resync_requested());
}

#[test]
fn replays_the_updates_held_around_a_snapshot_that_came_before_its_acknowledgement() {
    let mut conn = connection(&["XRP-USDT"]);
    send(&mut conn, xrp_early_update());
    send(&mut conn, xrp_snapshot());
    send(&mut conn, depth("XRP-USDT", "update", 988720941, json!([["1.3933", "70000"]]), json!([])));

    let published = send(&mut conn, ack("XRP-USDT"));

    assert_eq!(published.len(), 1);
    assert_eq!(published[0].1[0], BookLevel { price: 1.3933, size: 70000.0 });
    assert_eq!(published[0].2, xrp_snapshot_levels().1);
    assert!(!conn.resync_requested());

    assert_eq!(send(&mut conn, depth("XRP-USDT", "update", 988720942, json!([]), json!([["1.3940", "5"]]))).len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn keeps_holding_updates_acknowledged_before_any_snapshot() {
    let mut conn = connection(&["XRP-USDT"]);
    send(&mut conn, xrp_early_update());

    let published = send(&mut conn, ack("XRP-USDT"));

    assert!(published.is_empty());
    assert_eq!(conn.state.early[&0].len(), 1);
    let (bids, asks) = xrp_snapshot_levels();
    assert_eq!(send(&mut conn, xrp_snapshot()), [("XRP-USDT".to_string(), bids, asks)]);
}

#[test]
fn replaces_the_book_on_a_later_snapshot() {
    let mut conn = acked_btc();
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_update());

    let later = depth("BTC-USDT", "all", 593068700, json!([["81000", "1"]]), json!([["81001", "2"]]));
    let published = send(&mut conn, later);

    assert_eq!(published, [("BTC-USDT".to_string(), levels(&[(81000.0, 1.0)]), levels(&[(81001.0, 2.0)]))]);
    assert!(!conn.resync_requested());
}

#[test]
fn holds_the_frames_of_a_contract_until_its_subscribe_is_acknowledged() {
    let mut conn = connection(&["XRP-USDT"]);

    assert!(send(&mut conn, xrp_early_update()).is_empty());
    assert!(send(&mut conn, xrp_snapshot()).is_empty());
    let published = send(&mut conn, ack("XRP-USDT"));

    let (bids, asks) = xrp_snapshot_levels();
    assert_eq!(published, [("XRP-USDT".to_string(), bids, asks)]);
    assert!(!conn.resync_requested());
}

#[test]
fn discards_the_held_frames_of_a_refused_subscribe() {
    let (_logs, _capture) = capture();
    let mut conn = connection(&["XRP-USDT"]);
    send(&mut conn, xrp_snapshot());

    let refusal = json!({ "code": 80015, "data": { "asks": null, "bids": null }, "dataType": "", "id": "XRP-USDT", "msg": "dataType not support" });
    let published = send(&mut conn, refusal);

    assert!(published.is_empty());
    assert!(conn.state.early.is_empty());
    assert!(send(&mut conn, btc_update_for("XRP-USDT")).is_empty());
}

#[test]
fn holds_at_most_64_frames_for_a_market_that_never_gets_its_snapshot() {
    let mut conn = connection(&["XRP-USDT"]);
    send(&mut conn, ack("XRP-USDT"));

    for i in 0..100 {
        send(&mut conn, depth("XRP-USDT", "update", 988720000 + i, json!([["1.3933", "1"]]), json!([])));
    }

    assert_eq!(conn.state.early[&0].len(), 64);
    assert_eq!(conn.state.early[&0][0].last_update_id, 988720036);
    assert!(!conn.resync_requested());
}

#[test]
fn drops_a_frame_for_a_contract_this_connection_does_not_carry() {
    let (logs, _capture) = capture();
    let mut conn = acked_btc();

    let published = send(&mut conn, depth("ETH-USDT", "all", 1, json!([["1", "1"]]), json!([["2", "1"]])));

    assert!(published.is_empty());
    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "ETH-USDT");
}

// handle: acknowledgements and errors

#[test]
fn logs_a_refused_subscribe_as_a_venue_error_naming_its_market() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["NOPE-USDT"]);

    // The refusal of an unknown topic as captured live on 2026-10-08.
    send(&mut conn, json!({ "code": 80015, "data": { "asks": null, "bids": null }, "dataType": "", "id": "NOPE-USDT", "msg": "dataType not support" }));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("market"), "NOPE-USDT");
    assert_eq!(errors[0].number("code"), 80015.0);
    assert_eq!(errors[0].text("message"), "dataType not support");
    assert_eq!(errors[0].text("connection"), "bingx#swap#0");
    assert!(conn.state.acked.is_empty());
}

#[test]
fn logs_an_error_frame_with_no_request_id_as_a_venue_error() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-USDT"]);

    // The shape from docs/profiles/bingx/websocket.md section 6, captured on the coin-M socket on 2026-09-23.
    send(&mut conn, json!({ "code": 100400, "msg": "code:100400:incrDepth dataType is not supported", "timestamp": 1790126693749_i64 }));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].number("code"), 100400.0);
}

#[test]
fn reports_a_frame_that_is_neither_gzip_nor_json() {
    let mut conn = connection(&["BTC-USDT"]);

    assert!(venue().handle(b"not json", &mut conn).is_err());
    assert!(venue().handle(&[0x1f, 0x8b, 0x00], &mut conn).is_err());
}

// A probe of the live socket, which prints each frame decompressed with its levels cut to three a side:
// cargo test bingx::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let (mut ws, _) = tokio_tungstenite::connect_async(PUBLIC_URL).await.unwrap();
    for topic in ["BTC-USDT", "NOPE-USDT", "NCCONICKEL2USD-USDT", "POWER-USDT"] {
        let frame = json!({ "id": topic, "reqType": "sub", "dataType": format!("{topic}@incrDepth") });
        ws.send(Message::text(frame.to_string())).await.unwrap();
    }
    ws.send(Message::text(json!({ "id": "x", "reqType": "sub", "dataType": "BTC-USDT@nope" }).to_string())).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(12);
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Binary(bytes) = message else {
            println!("non binary {message:?}");
            continue;
        };
        let text = wire::gunzip(&bytes).unwrap();
        if text == b"Ping" {
            println!("Ping");
            ws.send(Message::text("Pong")).await.unwrap();
            continue;
        }
        let mut value: Value = serde_json::from_slice(&text).unwrap();
        for side in ["bids", "asks"] {
            if let Some(levels) = value["data"][side].as_array_mut() {
                println!("{side} {}", levels.len());
                levels.truncate(3);
            }
        }
        println!("{value}");
    }
}

// A probe of the id rule on one live socket of 180 contracts, which prints every frame whose id does not move forward:
// cargo test bingx::tests::probe_live_sequence -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn probe_live_sequence() {
    use futures_util::{SinkExt, StreamExt};

    let venue = load(&testing::http()).await.unwrap();
    let skip: usize = std::env::var("PROBE_SKIP").ok().and_then(|s| s.parse().ok()).unwrap_or(0);
    let symbols: Vec<String> = venue.markets.iter().skip(skip).take(180).map(|m| m.raw_market_id.clone()).collect();
    let (mut ws, _) = tokio_tungstenite::connect_async(PUBLIC_URL).await.unwrap();
    let mut pending = symbols.iter();
    let mut subscribe = tokio::time::interval(Duration::from_millis(111));
    let mut last: HashMap<String, (i64, Value)> = HashMap::new();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(90);
    let mut frames = 0u64;
    loop {
        let message = tokio::select! {
            _ = tokio::time::sleep_until(deadline) => break,
            _ = subscribe.tick() => {
                if let Some(symbol) = pending.next() {
                    let frame = json!({ "id": symbol, "reqType": "sub", "dataType": format!("{symbol}@incrDepth") });
                    ws.send(Message::text(frame.to_string())).await.unwrap();
                }
                continue;
            }
            message = ws.next() => message,
        };
        let Some(Ok(Message::Binary(bytes))) = message else {
            println!("other {message:?}");
            continue;
        };
        let text = wire::gunzip(&bytes).unwrap();
        if text == b"Ping" {
            ws.send(Message::text("Pong")).await.unwrap();
            continue;
        }
        frames += 1;
        let value: Value = serde_json::from_slice(&text).unwrap();
        let Some(stream) = value["dataType"].as_str().filter(|s| !s.is_empty()) else {
            if value["code"] != 0 {
                println!("error {value}");
            }
            continue;
        };
        let id = value["data"]["lastUpdateId"].as_i64().unwrap();
        let action = value["data"]["action"].as_str().unwrap().to_string();
        if let Some((previous, previous_frame)) = last.get(stream) {
            if action == "all" || id <= *previous {
                let cut = |v: &Value| {
                    let mut v = v.clone();
                    for side in ["bids", "asks"] {
                        if let Some(levels) = v["data"][side].as_array_mut() {
                            levels.truncate(4);
                        }
                    }
                    v
                };
                println!("{stream} {action} id {id} after {previous}\n  previous {}\n  this     {}", cut(previous_frame), cut(&value));
            }
        }
        last.insert(stream.to_string(), (id, value));
    }
    println!("{frames} frames on {} streams", last.len());
}
