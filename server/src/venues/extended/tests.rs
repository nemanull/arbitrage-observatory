// Levels and times come from frames captured live on 2026-10-12 on the all-markets book stream, trimmed to the top levels.
// Each case numbers its own frames, since seq counts every frame of every market on the connection.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.split('-').next().unwrap();
    testing::market(ID, raw_market_id, base, "USDC", true)
}

fn venue() -> Extended {
    Extended::new(&[])
}

fn connection() -> Connection<State> {
    Connection::for_test("extended#perp#0", vec![market("BTC-USD"), market("ETH-USD")])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    pairs.iter().map(|&(price, size)| BookLevel { price, size }).collect()
}

fn send(conn: &mut Connection<State>, frame: Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn published(published: &Published, raw_market_id: &str) -> (Vec<BookLevel>, Vec<BookLevel>) {
    let (_, bids, asks) = published.iter().find(|(id, _, _)| id == raw_market_id).unwrap();
    (bids.clone(), asks.clone())
}

// Snapshot levels are (price, absolute size).
fn snapshot(seq: i64, market: &str, ts: i64, bids: &[(&str, &str)], asks: &[(&str, &str)]) -> Value {
    let side = |side: &[(&str, &str)]| side.iter().map(|(p, q)| json!({ "q": q, "p": p })).collect::<Vec<_>>();
    json!({ "type": "SNAPSHOT", "data": { "t": "SNAPSHOT", "m": market, "b": side(bids), "a": side(asks), "d": "f" }, "ts": ts, "seq": seq })
}

// Delta levels are (price, change, absolute size).
fn delta(seq: i64, market: &str, ts: i64, bids: &[(&str, &str, &str)], asks: &[(&str, &str, &str)]) -> Value {
    let side = |side: &[(&str, &str, &str)]| side.iter().map(|(p, q, c)| json!({ "q": q, "p": p, "c": c })).collect::<Vec<_>>();
    json!({ "type": "DELTA", "data": { "t": "DELTA", "m": market, "b": side(bids), "a": side(asks), "d": "f" }, "ts": ts, "seq": seq })
}

// The first frame of the stream, the last periodic BTC snapshot, which arrived 15.6 s after its ts.
fn btc_snapshot(seq: i64) -> Value {
    snapshot(
        seq,
        "BTC-USD",
        1791844463422,
        &[("82460", "1.62608"), ("82459", "0.00095"), ("82458", "0.00020")],
        &[("82461", "5.65889"), ("82462", "0.60640"), ("82463", "0.74260")],
    )
}

// The two replayed deltas after it, 100 and 200 ms after its ts.
fn btc_delta(seq: i64) -> Value {
    delta(seq, "BTC-USD", 1791844463524, &[], &[("82463", "-0.1362", "0.60640")])
}

fn btc_next_delta(seq: i64) -> Value {
    delta(seq, "BTC-USD", 1791844463621, &[("82460", "-0.03454", "1.59154")], &[])
}

fn btc_replayed() -> (Vec<BookLevel>, Vec<BookLevel>) {
    (
        levels(&[(82460.0, 1.59154), (82459.0, 0.00095), (82458.0, 0.0002)]),
        levels(&[(82461.0, 5.65889), (82462.0, 0.6064), (82463.0, 0.6064)]),
    )
}

// A delta that removes the best bid and lifts an ask to the old bid, where q is not the size.
fn btc_removal(seq: i64) -> Value {
    delta(
        seq,
        "BTC-USD",
        1791844464524,
        &[("82460", "-1.45534", "0"), ("82459", "-0.17096", "0.00084")],
        &[("82460", "7.89709", "7.89709"), ("82461", "-3.34916", "2.80212")],
    )
}

// The ETH snapshot that followed the BTC replay, 15.8 s after its ts.
fn eth_snapshot(seq: i64) -> Value {
    snapshot(seq, "ETH-USD", 1791844463419, &[("2484.1", "0.029"), ("2484", "15.664")], &[("2484.2", "72.271"), ("2484.3", "41.310")])
}

fn eth_delta(seq: i64) -> Value {
    delta(seq, "ETH-USD", 1791844464214, &[], &[("2484.2", "-0.895", "71.376")])
}

// A market the plan does not hold, which the all-markets stream carries anyway.
fn untracked(seq: i64) -> Value {
    delta(seq, "AIA-USD", 1791844090000, &[("0.078153", "-6130", "0")], &[])
}

// BTC and ETH both released, with frames 1 to 3 handled and nothing left to take.
fn live() -> Connection<State> {
    let mut conn = connection();
    send(&mut conn, btc_snapshot(1));
    send(&mut conn, eth_snapshot(2));
    send(&mut conn, untracked(3));
    conn
}

// plan and settings

#[test]
fn puts_every_market_on_one_socket_at_the_all_markets_url() {
    let plans = venue().plan(&[market("BTC-USD"), market("ETH-USD"), market("XAU-USD")]);

    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0].id, "extended#perp#0");
    assert_eq!(plans[0].url, "wss://api.starknet.extended.exchange/stream.extended.exchange/v1/orderbooks");
    assert_eq!(plans[0].markets.len(), 3);
    assert!(venue().plan(&[]).is_empty());
}

#[test]
fn sends_a_user_agent_leaves_the_pings_to_the_server_and_ends_a_socket_silent_for_10_s() {
    let settings = venue().settings();

    assert_eq!(settings.headers, [("User-Agent", "arbitrage-observatory")]);
    assert_eq!(settings.ping_every, None);
    assert_eq!(settings.max_silence, Duration::from_secs(10));
}

#[test]
fn sends_nothing_after_the_handshake() {
    assert!(venue().subscribe_frames(&[market("BTC-USD")], &mut State::default()).is_empty());
}

// the opening replay

#[test]
fn holds_the_opening_snapshot_and_its_replay_until_a_frame_of_another_market_arrives() {
    let mut conn = connection();

    let snapshot = send(&mut conn, btc_snapshot(1));
    let first = send(&mut conn, btc_delta(2));
    let second = send(&mut conn, btc_next_delta(3));
    let released = send(&mut conn, eth_snapshot(4));

    assert!(snapshot.is_empty() && first.is_empty() && second.is_empty());
    assert_eq!(released.len(), 1);
    assert_eq!(published(&released, "BTC-USD"), btc_replayed());
    assert!(!conn.resync_requested());
}

#[test]
fn releases_the_next_held_market_on_the_first_live_frame_of_another() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot(1));
    send(&mut conn, eth_snapshot(2));

    let held = send(&mut conn, eth_delta(3));
    let released = send(&mut conn, btc_removal(4));

    assert!(held.is_empty());
    let names: Vec<&str> = released.iter().map(|(id, _, _)| id.as_str()).collect();
    assert_eq!(names, ["ETH-USD", "BTC-USD"]);
    assert_eq!(
        published(&released, "ETH-USD"),
        (levels(&[(2484.1, 0.029), (2484.0, 15.664)]), levels(&[(2484.2, 71.376), (2484.3, 41.31)]))
    );
}

#[test]
fn a_frame_of_an_untracked_market_ends_the_held_replay_and_is_dropped_without_a_warning() {
    let (logs, _capture) = capture();
    let mut conn = Connection::for_test("extended#perp#0", vec![market("BTC-USD")]);
    send(&mut conn, btc_snapshot(1));
    send(&mut conn, btc_delta(2));
    send(&mut conn, btc_next_delta(3));

    let released = send(&mut conn, untracked(4));

    assert_eq!(released.len(), 1);
    assert_eq!(published(&released, "BTC-USD"), btc_replayed());
    assert!(logs.events("unsubscribed_symbol").is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn a_second_snapshot_of_the_held_market_replaces_the_held_book() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot(1));
    send(&mut conn, btc_delta(2));

    send(&mut conn, snapshot(3, "BTC-USD", 1791844464721, &[("82459", "1.45625")], &[("82460", "9.60018")]));
    let released = send(&mut conn, eth_snapshot(4));

    assert_eq!(published(&released, "BTC-USD"), (levels(&[(82459.0, 1.45625)]), levels(&[(82460.0, 9.60018)])));
}

// live frames

#[test]
fn applies_a_live_delta_by_its_absolute_size_and_removes_a_level_at_zero() {
    let mut conn = live();

    let update = send(&mut conn, btc_removal(4));

    assert_eq!(update.len(), 1);
    assert_eq!(
        published(&update, "BTC-USD"),
        (
            levels(&[(82459.0, 0.00084), (82458.0, 0.0002)]),
            levels(&[(82460.0, 7.89709), (82461.0, 2.80212), (82462.0, 0.6064), (82463.0, 0.7426)]),
        )
    );
}

#[test]
fn an_empty_delta_moves_the_count_without_publishing() {
    let mut conn = live();

    let quiet = send(&mut conn, delta(4, "BTC-USD", 1791844523194, &[], &[]));
    let next = send(&mut conn, btc_removal(5));

    assert!(quiet.is_empty());
    assert_eq!(next.len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn a_periodic_snapshot_replaces_a_live_book_at_once() {
    let mut conn = live();

    let update = send(&mut conn, snapshot(4, "BTC-USD", 1791844464721, &[("82459", "1.45625")], &[("82460", "9.60018")]));

    assert_eq!(published(&update, "BTC-USD"), (levels(&[(82459.0, 1.45625)]), levels(&[(82460.0, 9.60018)])));
}

#[test]
fn keeps_each_market_on_its_own_book() {
    let mut conn = live();

    let eth = send(&mut conn, eth_delta(4));
    let btc = send(&mut conn, btc_removal(5));

    assert_eq!(eth[0].0, "ETH-USD");
    assert_eq!(eth[0].2, levels(&[(2484.2, 71.376), (2484.3, 41.31)]));
    assert_eq!(btc[0].0, "BTC-USD");
    assert_eq!(btc[0].1[0], BookLevel { price: 82459.0, size: 0.00084 });
}

// gaps and faults

#[test]
fn counts_frames_of_untracked_markets_into_the_one_sequence() {
    let mut conn = live();

    send(&mut conn, untracked(4));
    send(&mut conn, untracked(5));
    let update = send(&mut conn, btc_removal(6));

    assert_eq!(update.len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn restarts_the_connection_when_the_count_skips_on_any_market() {
    let (logs, _capture) = capture();
    let mut conn = live();

    let update = send(&mut conn, untracked(5));

    assert!(update.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync[0].text("market"), "AIA-USD");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn restarts_the_connection_on_a_repeated_count() {
    let mut conn = live();

    let update = send(&mut conn, btc_removal(3));

    assert!(update.is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn restarts_the_connection_when_the_first_frame_is_not_number_1() {
    let mut conn = connection();

    send(&mut conn, btc_snapshot(2));

    assert!(conn.resync_requested());
}

#[test]
fn restarts_the_connection_on_a_delta_before_its_snapshot() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let update = send(&mut conn, btc_delta(1));

    assert!(update.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn restarts_the_connection_on_a_delta_level_with_no_absolute_size() {
    let (logs, _capture) = capture();
    let mut conn = live();
    let mut broken = btc_removal(4);
    broken["data"]["b"][0].as_object_mut().unwrap().remove("c");

    let update = send(&mut conn, broken);

    assert!(update.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn restarts_the_connection_on_a_snapshot_level_it_cannot_read() {
    let mut conn = connection();
    let mut broken = btc_snapshot(1);
    broken["data"]["a"][0]["p"] = json!("x");

    send(&mut conn, broken);

    assert!(conn.resync_requested());
}

// A frame that fails to parse is lost, so the one after it no longer counts on and the connection restarts.
#[test]
fn restarts_the_connection_after_a_frame_that_does_not_parse() {
    let mut conn = live();
    let mut broken = btc_removal(4);
    broken["data"]["b"] = json!({ "82460": "0" });

    assert!(venue().handle(broken.to_string().as_bytes(), &mut conn).is_err());
    let update = send(&mut conn, btc_removal(5));

    assert!(update.is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn logs_a_frame_of_a_type_it_does_not_know_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = live();
    let mut unknown = btc_removal(4);
    unknown["type"] = json!("STATUS");

    let update = send(&mut conn, unknown);

    assert!(update.is_empty());
    assert_eq!(logs.events("venue_notice")[0].text("kind"), "STATUS");
    assert!(!conn.resync_requested());
}

// Prints a short summary of each frame of a live session and the first frame of each named market, trimmed, the source of the captures above:
// CAPTURE_MARKETS=BTC-USD,ETH-USD PROBE_SECONDS=8 cargo test extended::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use crate::clock::now_ms;
    use futures_util::StreamExt;
    use std::collections::HashSet;
    use tokio_tungstenite::tungstenite::client::IntoClientRequest;

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let mut request = URL.into_client_request().unwrap();
    for &(name, value) in HEADERS {
        request.headers_mut().insert(name, value.parse().unwrap());
    }
    let (mut ws, _) = tokio_tungstenite::connect_async(request).await.unwrap();
    let wanted: Vec<String> = std::env::var("CAPTURE_MARKETS")
        .unwrap_or_else(|_| "BTC-USD,ETH-USD".to_string())
        .split(',')
        .map(str::to_string)
        .collect();
    let seconds: u64 = std::env::var("PROBE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(8);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    let mut printed = HashSet::new();

    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            continue;
        };
        let arrived = now_ms();
        let mut frame: Value = serde_json::from_str(text.as_str()).unwrap();
        let name = frame["data"]["m"].as_str().unwrap_or("").to_string();
        let age = arrived - frame["ts"].as_i64().unwrap_or(0);
        println!("{arrived} {} {name} seq {} age {age}", frame["type"], frame["seq"]);
        if wanted.contains(&name) && printed.insert((name.clone(), frame["type"].to_string())) {
            for side in ["b", "a"] {
                if let Some(levels) = frame["data"][side].as_array_mut() {
                    levels.truncate(3);
                }
            }
            println!("{arrived} {frame}");
        }
    }
}
