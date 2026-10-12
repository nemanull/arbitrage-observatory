// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use std::collections::BTreeMap;
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    testing::market(ID, raw_market_id, raw_market_id.strip_suffix("_usdt").unwrap(), "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("sym{i}_usdt")));
    }
    markets
}

fn venue() -> Bitradex {
    Bitradex::new(&[])
}

fn connection() -> Connection<<Bitradex as BookVenue>::State> {
    Connection::for_test("bitradex#linear#0", vec![market("xmr_usdt"), market("btc_usdt")])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

fn send(conn: &mut Connection<<Bitradex as BookVenue>::State>, frame: Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn send_text(conn: &mut Connection<<Bitradex as BookVenue>::State>, text: &str) -> Published {
    venue().handle(text.as_bytes(), conn).unwrap();
    conn.take_published()
}

fn snapshot(symbol: &str, id: &str, bids: Value, asks: Value) -> Value {
    json!({ "topic": "depth", "event": format!("depth@{symbol},20"), "data": { "s": symbol, "id": id, "a": asks, "b": bids } })
}

fn delta(symbol: &str, pu: &str, fu: &str, u: &str, bids: Value, asks: Value) -> Value {
    json!({
        "topic": "depth_update", "event": format!("depth_update@{symbol},100ms"),
        "data": { "s": symbol, "pu": pu, "fu": fu, "u": u, "a": asks, "b": bids, "t": 1791572887174_i64 },
    })
}

// Frames captured live on 2026-10-09 at 19:08 UTC, in arrival order, with the snapshots cut to three of their 20 levels a side.
// The second snapshot arrived before the delta that carries its id.
fn xmr_first_snapshot() -> Value {
    snapshot(
        "xmr_usdt",
        "1452658497057",
        json!([["525.01", "1460"], ["525.0", "1292"], ["524.99", "1732"]]),
        json!([["525.08", "1448"], ["525.09", "2699"], ["525.12", "1625"]]),
    )
}

fn xmr_second_snapshot() -> Value {
    snapshot(
        "xmr_usdt",
        "1452658497067",
        json!([["524.92", "9780"], ["524.9", "1224"], ["524.88", "7760"]]),
        json!([["525.08", "1448"], ["525.09", "2699"], ["525.12", "1625"]]),
    )
}

fn xmr_delta_held_by_the_second_snapshot() -> Value {
    delta("xmr_usdt", "1452658497057", "1452658497058", "1452658497067", json!([["525.01", "0"], ["525.0", "0"], ["524.99", "0"]]), json!([]))
}

fn xmr_next_delta() -> Value {
    delta(
        "xmr_usdt",
        "1452658497067",
        "1452658497068",
        "1452658497100",
        json!([["524.92", "1444"], ["524.91", "1632"], ["524.89", "89"]]),
        json!([["524.99", "1464"], ["525.0", "1564"], ["525.02", "127"]]),
    )
}

fn xmr_delta_after_next() -> Value {
    delta("xmr_usdt", "1452658497100", "1452658497101", "1452658497101", json!([]), json!([["525.03", "341"]]))
}

// The btc_usdt book of the same minute, deepened to 20 levels a side by the 0.1 tick, so its window has an edge.
fn btc_full_snapshot(id: &str) -> Value {
    let mut bids = Vec::new();
    let mut asks = Vec::new();
    for i in 0..20 {
        bids.push(json!([format!("{:.1}", 82492.1 - i as f64 * 0.1), "17720"]));
        asks.push(json!([format!("{:.1}", 82492.2 + i as f64 * 0.1), "23732"]));
    }
    snapshot("btc_usdt", id, json!(bids), json!(asks))
}

#[test]
fn plans_sixty_markets_a_socket_on_the_public_futures_url() {
    let plans = venue().plan(&markets(121));

    assert_eq!(plans.len(), 3);
    assert_eq!(plans[0].id, "bitradex#linear#0");
    assert_eq!(plans[0].url, "wss://fws.bitradex.ai/public");
    assert_eq!((plans[0].markets.len(), plans[1].markets.len(), plans[2].markets.len()), (60, 60, 1));
}

#[test]
fn subscribes_the_snapshot_and_delta_topics_of_ten_markets_a_frame() {
    let frames = venue().subscribe_frames(&markets(12), &mut HashMap::new());

    assert_eq!(frames.len(), 2);
    let first: Value = serde_json::from_str(frames[0].to_text().unwrap()).unwrap();
    assert_eq!(first["method"], "subscribe");
    assert_eq!(first["id"], "1");
    assert_eq!(first["params"].as_array().unwrap().len(), 20);
    assert_eq!(first["params"][0], "depth@sym0_usdt,20");
    assert_eq!(first["params"][1], "depth_update@sym0_usdt,100ms");
    let second: Value = serde_json::from_str(frames[1].to_text().unwrap()).unwrap();
    assert_eq!(second["id"], "2");
    assert_eq!(second["params"].as_array().unwrap().len(), 4);
}

#[test]
fn sends_a_text_ping_every_15_seconds_and_ends_a_socket_silent_for_20() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(15)));
    assert_eq!(settings.max_silence, Duration::from_secs(20));
    assert_eq!(venue().ping(&mut HashMap::new()), Message::text("ping"));
}

#[test]
fn a_snapshot_seeds_the_book() {
    let mut conn = connection();

    let published = send(&mut conn, xmr_first_snapshot());

    assert_eq!(
        published,
        [(
            "xmr_usdt".to_string(),
            levels(&[(525.01, 1460.0), (525.0, 1292.0), (524.99, 1732.0)]),
            levels(&[(525.08, 1448.0), (525.09, 2699.0), (525.12, 1625.0)]),
        )]
    );
}

#[test]
fn a_snapshot_repeating_the_id_the_book_holds_publishes_nothing() {
    let mut conn = connection();
    send(&mut conn, xmr_first_snapshot());

    assert!(send(&mut conn, xmr_first_snapshot()).is_empty());
}

#[test]
fn a_delta_the_snapshot_already_holds_is_skipped_and_the_next_one_chains() {
    let mut conn = connection();
    send(&mut conn, xmr_first_snapshot());
    send(&mut conn, xmr_second_snapshot());

    assert!(send(&mut conn, xmr_delta_held_by_the_second_snapshot()).is_empty());
    let published = send(&mut conn, xmr_next_delta());
    let published_after = send(&mut conn, xmr_delta_after_next());

    assert_eq!(published[0].1, levels(&[(524.92, 1444.0), (524.91, 1632.0), (524.9, 1224.0), (524.89, 89.0), (524.88, 7760.0)]));
    assert_eq!(published[0].2[..2], levels(&[(524.99, 1464.0), (525.0, 1564.0)]));
    assert_eq!(published_after[0].2[..4], levels(&[(524.99, 1464.0), (525.0, 1564.0), (525.02, 127.0), (525.03, 341.0)]));
    assert!(!conn.resync_requested());
}

#[test]
fn a_delta_may_empty_a_side_the_snapshot_held_whole() {
    let mut conn = connection();
    send(&mut conn, xmr_first_snapshot());

    let published = send(&mut conn, xmr_delta_held_by_the_second_snapshot());

    assert_eq!(published[0].1, []);
    assert_eq!(published[0].2.len(), 3);
    assert!(!conn.resync_requested());
}

#[test]
fn a_delta_whose_range_straddles_the_snapshot_id_applies() {
    let mut conn = connection();
    send(&mut conn, snapshot("xmr_usdt", "1452658497080", json!([["524.92", "9780"]]), json!([["525.08", "1448"]])));

    let published = send(&mut conn, xmr_next_delta());

    assert_eq!(published[0].1[0], BookLevel { price: 524.92, size: 1444.0 });
    assert!(!conn.resync_requested());
}

#[test]
fn a_delta_before_any_snapshot_is_dropped() {
    let mut conn = connection();

    assert!(send(&mut conn, xmr_next_delta()).is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn a_gap_in_the_chain_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, xmr_first_snapshot());

    assert!(send(&mut conn, xmr_next_delta()).is_empty());

    assert!(conn.resync_requested());
    let desync = &logs.events("book_desync")[0];
    assert_eq!(desync.text("market"), "xmr_usdt");
    assert_eq!(desync.number("expected"), 1452658497057.0);
    assert_eq!(desync.number("fu"), 1452658497068.0);
}

#[test]
fn an_older_snapshot_does_not_rewind_the_book() {
    let mut conn = connection();
    send(&mut conn, xmr_second_snapshot());
    send(&mut conn, xmr_next_delta());

    assert!(send(&mut conn, xmr_second_snapshot()).is_empty());
    assert!(send(&mut conn, xmr_first_snapshot()).is_empty());
    assert_eq!(send(&mut conn, xmr_delta_after_next()).len(), 1);
}

#[test]
fn a_newer_snapshot_replaces_the_book() {
    let mut conn = connection();
    send(&mut conn, xmr_first_snapshot());
    let next = snapshot("xmr_usdt", "1452658497103", json!([["524.92", "1444"]]), json!([["524.99", "1464"]]));

    let published = send(&mut conn, next);

    assert_eq!(published[0].1, levels(&[(524.92, 1444.0)]));
    assert_eq!(published[0].2, levels(&[(524.99, 1464.0)]));
}

#[test]
fn a_delta_writes_only_inside_the_window_of_a_full_snapshot() {
    let mut conn = connection();
    send(&mut conn, btc_full_snapshot("1452894015776"));

    // 82490.1 and 82494.2 sit outside the 20 levels, and 82490.2 and 82494.1 are the window's edges.
    let frame = delta(
        "btc_usdt",
        "1452894015776",
        "1452894015777",
        "1452894015780",
        json!([["82490.1", "5"], ["82490.2", "6"]]),
        json!([["82494.2", "7"], ["82494.1", "8"]]),
    );
    let published = send(&mut conn, frame);

    let (bids, asks) = (&published[0].1, &published[0].2);
    assert_eq!(bids.len(), 20);
    assert_eq!(bids[19], BookLevel { price: 82490.2, size: 6.0 });
    assert_eq!(asks.len(), 20);
    assert_eq!(asks[19], BookLevel { price: 82494.1, size: 8.0 });
}

#[test]
fn a_delta_writes_anywhere_on_a_side_the_snapshot_held_whole() {
    let mut conn = connection();
    send(&mut conn, xmr_first_snapshot());
    let frame = delta("xmr_usdt", "1452658497057", "1452658497058", "1452658497058", json!([["500.0", "1"]]), json!([["600.0", "2"]]));

    let published = send(&mut conn, frame);

    assert_eq!(published[0].1.last(), Some(&BookLevel { price: 500.0, size: 1.0 }));
    assert_eq!(published[0].2.last(), Some(&BookLevel { price: 600.0, size: 2.0 }));
}

#[test]
fn a_side_emptied_inside_the_window_of_a_full_snapshot_waits_for_the_next_snapshot() {
    let mut conn = connection();
    send(&mut conn, btc_full_snapshot("1452894015776"));
    let mut removed = Vec::new();
    for i in 0..20 {
        removed.push(json!([format!("{:.1}", 82492.1 - i as f64 * 0.1), "0"]));
    }

    assert!(send(&mut conn, delta("btc_usdt", "1452894015776", "1452894015777", "1452894015777", json!(removed), json!([]))).is_empty());

    // Unseeded again, so a delta that chains onto the dropped state is not applied either.
    let next = delta("btc_usdt", "1452894015777", "1452894015778", "1452894015778", json!([["82491.0", "1"]]), json!([]));
    assert!(send(&mut conn, next).is_empty());
    assert!(!conn.resync_requested());
    assert_eq!(send(&mut conn, btc_full_snapshot("1452894015778")).len(), 1);
}

#[test]
fn a_delta_with_a_level_it_cannot_read_resyncs_and_publishes_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, xmr_first_snapshot());

    let frame = delta("xmr_usdt", "1452658497057", "1452658497058", "1452658497058", json!([["525.01", "x"]]), json!([]));

    assert!(send(&mut conn, frame).is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_desync")[0].text("reason"), "unreadable_level");
}

#[test]
fn a_snapshot_with_a_level_it_cannot_read_resyncs_and_publishes_nothing() {
    let mut conn = connection();

    let frame = snapshot("xmr_usdt", "1452658497057", json!([["525.01", "1460"], ["", "1292"]]), json!([["525.08", "1448"]]));

    assert!(send(&mut conn, frame).is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn a_crossed_snapshot_resyncs_and_publishes_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let frame = snapshot("xmr_usdt", "1452658497057", json!([["525.08", "1460"]]), json!([["525.08", "1448"]]));

    assert!(send(&mut conn, frame).is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_desync")[0].text("reason"), "crossed_book");
}

#[test]
fn a_delta_that_crosses_the_book_resyncs_and_publishes_nothing() {
    let mut conn = connection();
    send(&mut conn, xmr_first_snapshot());

    let frame = delta("xmr_usdt", "1452658497057", "1452658497058", "1452658497058", json!([["525.1", "5"]]), json!([]));

    assert!(send(&mut conn, frame).is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn a_frame_on_a_topic_it_did_not_subscribe_is_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let frame = json!({ "topic": "mark_price", "event": "mark_price@xmr_usdt", "data": { "s": "xmr_usdt", "p": "525.04", "t": 1791572887174_i64 } });

    assert!(send(&mut conn, frame).is_empty());
    assert_eq!(logs.events("venue_notice")[0].text("topic"), "mark_price");
    assert!(!conn.resync_requested());
}

#[test]
fn ignores_a_symbol_the_connection_does_not_carry() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    assert!(send(&mut conn, snapshot("eth_usdt", "1452841714981", json!([["2485.11", "7205"]]), json!([["2485.12", "10272"]]))).is_empty());
    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "eth_usdt");
}

#[test]
fn reads_the_acknowledgement_and_the_pong_quietly() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    // Both captured live on 2026-10-09.
    assert!(send(&mut conn, json!({ "code": 0, "data": { "a": null, "b": null }, "id": "1", "msg": "success" })).is_empty());
    assert!(send_text(&mut conn, "pong").is_empty());

    assert!(logs.lines().iter().all(|line| line.level > Level::WARN), "{:?}", logs.lines());
    assert_eq!(logs.events("subscribe_acknowledged")[0].text("id"), "1");
}

#[test]
fn logs_the_answer_to_an_unreadable_frame_and_a_refusal_as_venue_errors() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    // The bare text the socket answered a string of params with on 2026-10-09, and a refusal in the acknowledgement's shape.
    send_text(&mut conn, "Invalid parameter");
    send(&mut conn, json!({ "code": 1, "data": null, "id": "3", "msg": "failure" }));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("message"), "Invalid parameter");
    assert_eq!(errors[1].number("code"), 1.0);
    assert_eq!(errors[1].text("connection"), "bitradex#linear#0");
}

#[test]
fn fails_a_frame_with_no_sequence_id() {
    let mut conn = connection();
    let frame = json!({ "topic": "depth", "event": "depth@xmr_usdt,20", "data": { "s": "xmr_usdt", "a": [], "b": [] } });

    assert!(venue().handle(frame.to_string().as_bytes(), &mut conn).is_err());
    let frame = json!({ "topic": "depth_update", "event": "depth_update@xmr_usdt,100ms", "data": { "s": "xmr_usdt", "u": "1", "a": [], "b": [] } });
    assert!(venue().handle(frame.to_string().as_bytes(), &mut conn).is_err());
}

// Prints trimmed frames and checks the snapshot and delta chain against each other, for the frames the tests above hold.
// Prices key the books as strings, so compare symbols whose prices keep one number of integer digits.
// On 2026-10-09 eight symbols over 60 s gave 218 deltas with no gap, and no snapshot differed from the delta book in its top 5 levels.
// PROBE_SYMBOLS=btc_usdt,eth_usdt PROBE_SECONDS=30 cargo test bitradex::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let symbols: Vec<String> = std::env::var("PROBE_SYMBOLS").unwrap_or("btc_usdt,eth_usdt,xmr_usdt".into()).split(',').map(String::from).collect();
    let seconds: u64 = std::env::var("PROBE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(20);
    let extra: Vec<String> = std::env::var("PROBE_TOPICS").unwrap_or_default().split(',').filter(|s| !s.is_empty()).map(String::from).collect();
    let (mut ws, response) = tokio_tungstenite::connect_async(BOOK_URL).await.unwrap();
    println!("status {}", response.status());

    let mut params = Vec::new();
    for symbol in &symbols {
        params.push(format!("depth@{symbol},20"));
        params.push(format!("depth_update@{symbol},100ms"));
    }
    params.extend(extra);
    ws.send(Message::text(json!({ "method": "subscribe", "params": params, "id": "1" }).to_string())).await.unwrap();
    for raw in std::env::var("PROBE_RAW").unwrap_or_default().split('|').filter(|s| !s.is_empty()) {
        ws.send(Message::text(raw.to_string())).await.unwrap();
    }

    type Side = BTreeMap<String, String>;
    let mut books: HashMap<String, (Side, Side, String)> = HashMap::new();
    let (mut printed, mut snapshots, mut deltas, mut gaps, mut same, mut differ) = (0, 0, 0, 0, 0, 0);
    let (mut stale, mut straddles, mut differ_top, mut after) = (0, 0, 0, 0);
    let mut last_ping = tokio::time::Instant::now();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        if last_ping.elapsed() > Duration::from_secs(15) {
            ws.send(Message::text("ping")).await.unwrap();
            last_ping = tokio::time::Instant::now();
        }
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let Ok(mut value) = serde_json::from_str::<Value>(text.as_str()) else {
            println!("text {text}");
            continue;
        };
        let topic = value["topic"].as_str().unwrap_or("").to_string();
        let data = value["data"].clone();
        let symbol = data["s"].as_str().unwrap_or("").to_string();
        let side = |levels: &Value| -> Vec<(String, String)> {
            levels.as_array().map(|l| l.iter().map(|x| (x[0].as_str().unwrap().to_string(), x[1].as_str().unwrap().to_string())).collect()).unwrap_or_default()
        };
        match topic.as_str() {
            "depth" => {
                snapshots += 1;
                let id = data["id"].as_str().unwrap_or("").to_string();
                let bids: Side = side(&data["b"]).into_iter().collect();
                let asks: Side = side(&data["a"]).into_iter().collect();
                if let Some((own_bids, own_asks, last)) = books.get(&symbol) {
                    if id.parse::<i64>().unwrap() < last.parse::<i64>().unwrap() { after += 1; continue; }
                    if *last == id {
                        // Compare the snapshot's 20 levels with the top 20 of the book the deltas kept.
                        let top_b: Side = own_bids.iter().rev().take(bids.len()).map(|(k, v)| (k.clone(), v.clone())).collect();
                        let top_a: Side = own_asks.iter().take(asks.len()).map(|(k, v)| (k.clone(), v.clone())).collect();
                        if top_b == bids && top_a == asks { same += 1 } else {
                            differ += 1;
                            let top = |own: &Side, snap: &Side, rev: bool| -> bool {
                                let o: Vec<_> = if rev { own.iter().rev().take(5).collect() } else { own.iter().take(5).collect() };
                                let n: Vec<_> = if rev { snap.iter().rev().take(5).collect() } else { snap.iter().take(5).collect() };
                                o == n
                            };
                            if !(top(own_bids, &bids, true) && top(own_asks, &asks, false)) { differ_top += 1; if differ_top < 4 { println!("differ in top 5 {symbol} id {id}") } }
                        }
                    }
                }
                books.insert(symbol.clone(), (bids, asks, id));
            }
            "depth_update" => {
                deltas += 1;
                if let Some((bids, asks, last)) = books.get_mut(&symbol) {
                    let id = |key: &str| data[key].as_str().unwrap_or("0").parse::<i64>().unwrap();
                    let at: i64 = last.parse().unwrap();
                    if id("u") <= at {
                        stale += 1;
                        continue;
                    }
                    if id("pu") != at && id("fu") <= at + 1 {
                        straddles += 1;
                    } else if id("pu") != at {
                        gaps += 1;
                        println!("gap {symbol} last {last} pu {} fu {} u {}", data["pu"], data["fu"], data["u"]);
                    }
                    for (p, s) in side(&data["b"]) { if s.parse::<f64>().unwrap() == 0.0 { bids.remove(&p); } else { bids.insert(p, s); } }
                    for (p, s) in side(&data["a"]) { if s.parse::<f64>().unwrap() == 0.0 { asks.remove(&p); } else { asks.insert(p, s); } }
                    *last = data["u"].as_str().unwrap_or("").to_string();
                }
            }
            _ => {}
        }
        if printed < 2 || (topic != "depth" && topic != "depth_update") {
            printed += 1;
            for side in ["a", "b"] {
                if let Some(levels) = value["data"][side].as_array_mut() {
                    levels.truncate(3);
                }
            }
            println!("{value}");
        }
    }
    println!("snapshots {snapshots} deltas {deltas} stale {stale} straddles {straddles} gaps {gaps} snapshots behind the deltas {after} equal to the delta book {same} differing {differ} differing in the top 5 {differ_top}");
}

// Measures whether the book relays binance's USD-M book, by sampling both touches every 100 ms on the same symbols.
// On 2026-10-09 over 90 s, btc, eth, sol, sui and trump showed binance's exact touch in 83 to 98 % of samples, about 1.1 s behind it.
// xrp, link, xmr and cookie never did, and the sizes behind an equal touch are the venue's own, so a maker pegs to binance on some markets.
// PROBE_SYMBOLS=btc_usdt,eth_usdt PROBE_SECONDS=120 cargo test bitradex::tests::measure_binance_relay -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn measure_binance_relay() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let symbols: Vec<String> = std::env::var("PROBE_SYMBOLS")
        .unwrap_or("btc_usdt,eth_usdt,sol_usdt,xrp_usdt,doge_usdt,sui_usdt,link_usdt,trump_usdt,xmr_usdt,cookie_usdt".into())
        .split(',')
        .map(String::from)
        .collect();
    let seconds: u64 = std::env::var("PROBE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(60);
    let binance_symbol = |s: &str| s.replace('_', "").to_uppercase();

    let (mut own, _) = tokio_tungstenite::connect_async(BOOK_URL).await.unwrap();
    let mut params = Vec::new();
    for symbol in &symbols {
        params.push(format!("depth@{symbol},20"));
    }
    own.send(Message::text(json!({ "method": "subscribe", "params": params, "id": "1" }).to_string())).await.unwrap();
    let streams: Vec<String> = symbols.iter().map(|s| format!("{}@bookTicker", binance_symbol(s).to_lowercase())).collect();
    let (mut reference, _) = tokio_tungstenite::connect_async(format!("wss://fstream.binance.com/public/stream?streams={}", streams.join("/"))).await.unwrap();

    // Each venue's current touch, and binance's touch history with arrival times for the lag.
    let mut own_touch: HashMap<String, (f64, f64)> = HashMap::new();
    let mut binance_touch: HashMap<String, (f64, f64)> = HashMap::new();
    let mut binance_history: HashMap<String, Vec<(tokio::time::Instant, f64, f64)>> = HashMap::new();
    let mut own_changes: HashMap<String, usize> = HashMap::new();
    let mut binance_changes: HashMap<String, usize> = HashMap::new();
    let mut lags: HashMap<String, Vec<u128>> = HashMap::new();
    let mut unmatched: HashMap<String, usize> = HashMap::new();
    let mut samples: HashMap<String, (usize, usize, usize)> = HashMap::new(); // (samples, bid equal, ask equal)
    let mut tick = tokio::time::interval(Duration::from_millis(100));
    let mut ping = tokio::time::interval(Duration::from_secs(15));
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(deadline) => break,
            _ = ping.tick() => { own.send(Message::text("ping")).await.unwrap(); }
            _ = tick.tick() => {
                for symbol in &symbols {
                    let (Some(a), Some(b)) = (own_touch.get(symbol), binance_touch.get(&binance_symbol(symbol))) else { continue };
                    let entry = samples.entry(symbol.clone()).or_default();
                    entry.0 += 1;
                    if a.0 == b.0 { entry.1 += 1 }
                    if a.1 == b.1 { entry.2 += 1 }
                }
            }
            Some(Ok(message)) = own.next() => {
                let Message::Text(text) = message else { continue };
                let Ok(value) = serde_json::from_str::<Value>(text.as_str()) else { continue };
                if value["topic"] != "depth" { continue }
                let symbol = value["data"]["s"].as_str().unwrap_or("").to_string();
                let price = |side: &str| value["data"][side][0][0].as_str().and_then(|p| p.parse::<f64>().ok()).unwrap_or(f64::NAN);
                let touch = (price("b"), price("a"));
                if own_touch.get(&symbol) != Some(&touch) {
                    *own_changes.entry(symbol.clone()).or_default() += 1;
                    // How long ago binance last showed this exact touch, within the last 5 s.
                    let now = tokio::time::Instant::now();
                    let history = binance_history.get(&binance_symbol(&symbol)).map(Vec::as_slice).unwrap_or(&[]);
                    match history.iter().rev().find(|(at, bid, ask)| *bid == touch.0 && *ask == touch.1 && now.duration_since(*at) < Duration::from_secs(5)) {
                        Some((at, _, _)) => lags.entry(symbol.clone()).or_default().push(now.duration_since(*at).as_millis()),
                        None => *unmatched.entry(symbol.clone()).or_default() += 1,
                    }
                    own_touch.insert(symbol, touch);
                }
            }
            Some(Ok(message)) = reference.next() => {
                let Message::Text(text) = message else { continue };
                let Ok(value) = serde_json::from_str::<Value>(text.as_str()) else { continue };
                let data = &value["data"];
                let symbol = data["s"].as_str().unwrap_or("").to_string();
                let number = |key: &str| data[key].as_str().and_then(|p| p.parse::<f64>().ok()).unwrap_or(f64::NAN);
                let touch = (number("b"), number("a"));
                if binance_touch.get(&symbol) != Some(&touch) {
                    *binance_changes.entry(symbol.clone()).or_default() += 1;
                    let history = binance_history.entry(symbol.clone()).or_default();
                    history.push((tokio::time::Instant::now(), touch.0, touch.1));
                    if history.len() > 20_000 { history.drain(..10_000); }
                    binance_touch.insert(symbol, touch);
                }
            }
        }
    }

    for symbol in &symbols {
        let (n, bid, ask) = samples.get(symbol).copied().unwrap_or_default();
        let mut lag = lags.get(symbol).cloned().unwrap_or_default();
        lag.sort();
        let median = lag.get(lag.len() / 2).copied().unwrap_or(0);
        println!(
            "{symbol}: samples {n}, bid equal {:.0}%, ask equal {:.0}%, own touch changes {}, binance touch changes {}, own touches binance showed within 5 s {} (median lag {median} ms), never shown {}",
            100.0 * bid as f64 / n.max(1) as f64,
            100.0 * ask as f64 / n.max(1) as f64,
            own_changes.get(symbol).copied().unwrap_or(0),
            binance_changes.get(&binance_symbol(symbol)).copied().unwrap_or(0),
            lag.len(),
            unmatched.get(symbol).copied().unwrap_or(0),
        );
    }
}
