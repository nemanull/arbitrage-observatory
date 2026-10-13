// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(symbol: &str) -> Market {
    let base = symbol.split('/').next().unwrap();
    testing::market(ID, symbol, base, "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}/USDT-P")));
    }
    markets
}

fn venue() -> Hibachi {
    Hibachi::new()
}

fn connection() -> Connection<State> {
    Connection::for_test("hibachi#perp#0", vec![market("BTC/USDT-P"), market("XAG/USDT-P")])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

fn send(conn: &mut Connection<State>, frame: &Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn send_at(conn: &mut Connection<State>, frame: &Value, at: i64) -> Published {
    handle_at(frame.to_string().as_bytes(), conn, at).unwrap();
    conn.take_published()
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

fn sent(conn: &mut Connection<State>) -> Vec<Value> {
    conn.take_sent().iter().map(parsed).collect()
}

fn book_request(method: &str, symbol: &str) -> Value {
    json!({ "method": method, "parameters": { "subscriptions": [{ "symbol": symbol, "topic": "orderbook", "depth": 20 }] } })
}

// Book frames captured live at 22:59 UTC on 2026-10-12 at a depth of 3, so each window is quoted whole, in the order they came.
fn book(symbol: &str, kind: &str, timestamp_ms: i64, granularity: &str, bid: Value, ask: Value) -> Value {
    json!({
        "data": { "ask": ask, "bid": bid }, "depth": 3, "granularity": granularity, "messageType": kind,
        "symbol": symbol, "timestamp_ms": timestamp_ms, "topic": "orderbook",
    })
}

fn side(start: &str, end: &str, levels: &[(&str, &str)]) -> Value {
    let levels: Vec<Value> = levels.iter().map(|(price, quantity)| json!({ "price": price, "quantity": quantity })).collect();
    json!({ "endPrice": end, "levels": levels, "startPrice": start })
}

fn btc_snapshot() -> Value {
    book(
        "BTC/USDT-P",
        "Snapshot",
        1791845939749,
        "0.1",
        side("82348.2", "82339.0", &[("82348.2", "0.0006670000"), ("82347.2", "0.0007690545"), ("82339.0", "0.0243152257")]),
        side("82348.3", "82348.6", &[("82348.3", "0.0303588906"), ("82348.5", "0.2186165133"), ("82348.6", "0.0007690545")]),
    )
}

fn btc_update_050() -> Value {
    book(
        "BTC/USDT-P",
        "Update",
        1791845940050,
        "0.1",
        side(
            "82339.0",
            "82337.5",
            &[("82348.2", "0.0000000000"), ("82347.2", "0.0000000000"), ("82338.8", "0.0016430936"), ("82337.5", "0.0303622458")],
        ),
        side(
            "82339.1",
            "82348.5",
            &[("82339.1", "0.0303622827"), ("82340.2", "0.0045639455"), ("82348.3", "0.0000000000"), ("82348.6", "0.0000000000")],
        ),
    )
}

fn btc_update_351() -> Value {
    book(
        "BTC/USDT-P",
        "Update",
        1791845940351,
        "0.1",
        side("82339.0", "82336.1", &[("82338.8", "0.0000000000"), ("82336.1", "0.0121579832")]),
        side(
            "82339.1",
            "82339.7",
            &[
                ("82339.1", "0.9249907923"),
                ("82339.5", "0.0971700231"),
                ("82339.7", "0.1214625290"),
                ("82340.2", "0.0000000000"),
                ("82348.5", "0.0000000000"),
            ],
        ),
    )
}

// Only the bids changed in this one, so the asks came with no levels and their window alone.
fn btc_update_656() -> Value {
    book(
        "BTC/USDT-P",
        "Update",
        1791845940656,
        "0.1",
        side("82339.0", "82337.5", &[("82338.6", "0.0016430995"), ("82336.1", "0.0000000000")]),
        side("82339.1", "82339.7", &[]),
    )
}

fn xag_snapshot() -> Value {
    book(
        "XAG/USDT-P",
        "Snapshot",
        1791845939673,
        "0.01",
        side("60.36", "60.23", &[("60.36", "28.00940"), ("60.33", "33.13374"), ("60.23", "413.37584")]),
        side("60.37", "60.39", &[("60.37", "36.45112"), ("60.38", "3.31635"), ("60.39", "6.29784")]),
    )
}

// Nothing changed, and the frame came all the same, 302 ms after the one before.
fn xag_unchanged() -> Value {
    book("XAG/USDT-P", "Update", 1791845939975, "0.01", side("60.36", "60.23", &[]), side("60.37", "60.39", &[]))
}

fn xag_update_797() -> Value {
    book(
        "XAG/USDT-P",
        "Update",
        1791845941797,
        "0.01",
        side("60.36", "60.23", &[]),
        side("60.37", "60.39", &[("60.37", "36.45128"), ("60.38", "3.31651")]),
    )
}

// No book crossed on 2026-10-12, so these are the BTC snapshot's window with a bid moved through the ask, as a reopening auction may leave it, and then back.
fn btc_crossing() -> Value {
    book(
        "BTC/USDT-P",
        "Update",
        1791845940050,
        "0.1",
        side("82348.4", "82347.2", &[("82348.4", "0.0100000000"), ("82339.0", "0.0000000000")]),
        side("82348.3", "82348.6", &[]),
    )
}

fn btc_still_crossed() -> Value {
    book(
        "BTC/USDT-P",
        "Update",
        1791845940351,
        "0.1",
        side("82348.4", "82347.2", &[("82348.4", "0.0200000000")]),
        side("82348.3", "82348.6", &[]),
    )
}

fn btc_uncrossing() -> Value {
    book(
        "BTC/USDT-P",
        "Update",
        1791845940656,
        "0.1",
        side("82348.2", "82339.0", &[("82348.4", "0.0000000000"), ("82339.0", "0.0243152257")]),
        side("82348.3", "82348.6", &[]),
    )
}

fn btc_snapshot_levels() -> (Vec<BookLevel>, Vec<BookLevel>) {
    (
        levels(&[(82348.2, 0.000667), (82347.2, 0.0007690545), (82339.0, 0.0243152257)]),
        levels(&[(82348.3, 0.0303588906), (82348.5, 0.2186165133), (82348.6, 0.0007690545)]),
    )
}

// plan and settings

#[test]
fn puts_up_to_60_markets_on_each_socket_of_the_market_url() {
    let plans = venue().plan(&markets(75));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [60, 15]);
    assert_eq!(plans[0].id, "hibachi#perp#0");
    assert_eq!(plans[1].id, "hibachi#perp#1");
    assert_eq!(plans[0].url, "wss://data-api.hibachi.xyz/ws/market");
    assert!(venue().plan(&[]).is_empty());
}

#[test]
fn watches_ten_seconds_of_silence_and_sends_a_protocol_ping_every_20_seconds() {
    let settings = venue().settings();

    assert_eq!(settings.max_silence, Duration::from_secs(10));
    assert_eq!(settings.ping_every, Some(Duration::from_secs(20)));
    assert_eq!(settings.subscribe_gap, Duration::ZERO);
    assert!(matches!(venue().ping(&mut State::default()), Message::Ping(_)));
}

// subscribe_frames

#[test]
fn subscribes_each_market_in_a_frame_of_its_own_at_20_levels() {
    let frames = venue().subscribe_frames(&[market("BTC/USDT-P"), market("XAG/USDT-P")], &mut State::default());

    let frames: Vec<Value> = frames.iter().map(parsed).collect();
    assert_eq!(frames, [book_request("subscribe", "BTC/USDT-P"), book_request("subscribe", "XAG/USDT-P")]);
}

// books

#[test]
fn a_snapshot_replaces_the_book_with_its_window() {
    let mut conn = connection();

    let published = send(&mut conn, &btc_snapshot());

    let (bids, asks) = btc_snapshot_levels();
    assert_eq!(published, [("BTC/USDT-P".to_string(), bids, asks)]);
}

#[test]
fn applies_each_update_by_price_and_deletes_a_level_at_zero() {
    let mut conn = connection();
    send(&mut conn, &btc_snapshot());

    let first = send(&mut conn, &btc_update_050());
    let second = send(&mut conn, &btc_update_351());
    let third = send(&mut conn, &btc_update_656());

    assert_eq!(first[0].1, levels(&[(82339.0, 0.0243152257), (82338.8, 0.0016430936), (82337.5, 0.0303622458)]));
    assert_eq!(first[0].2, levels(&[(82339.1, 0.0303622827), (82340.2, 0.0045639455), (82348.5, 0.2186165133)]));
    assert_eq!(second[0].1, levels(&[(82339.0, 0.0243152257), (82337.5, 0.0303622458), (82336.1, 0.0121579832)]));
    assert_eq!(second[0].2, levels(&[(82339.1, 0.9249907923), (82339.5, 0.0971700231), (82339.7, 0.121462529)]));
    assert_eq!(third[0].1, levels(&[(82339.0, 0.0243152257), (82338.6, 0.0016430995), (82337.5, 0.0303622458)]));
    assert_eq!(third[0].2, second[0].2);
    assert!(sent(&mut conn).is_empty());
}

#[test]
fn an_update_with_no_levels_publishes_nothing_and_keeps_the_book() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, &xag_snapshot());

    let unchanged = send(&mut conn, &xag_unchanged());
    let changed = send(&mut conn, &xag_update_797());

    assert!(unchanged.is_empty());
    assert_eq!(changed[0].2, levels(&[(60.37, 36.45128), (60.38, 3.31651), (60.39, 6.29784)]));
    assert!(logs.events("book_resync").is_empty());
}

#[test]
fn a_later_snapshot_replaces_the_book_whatever_it_held() {
    let mut conn = connection();
    send(&mut conn, &btc_snapshot());
    send(&mut conn, &btc_update_050());

    let published = send(&mut conn, &btc_snapshot());

    let (bids, asks) = btc_snapshot_levels();
    assert_eq!(published, [("BTC/USDT-P".to_string(), bids, asks)]);
}

#[test]
fn a_market_nobody_subscribed_is_dropped_and_logged_once() {
    let (logs, _capture) = capture();
    let mut conn = Connection::for_test("hibachi#perp#0", vec![market("ETH/USDT-P")]);

    assert!(send(&mut conn, &btc_snapshot()).is_empty());
    assert!(send(&mut conn, &btc_update_050()).is_empty());

    let warned = logs.events("unsubscribed_symbol");
    assert_eq!(warned.len(), 1);
    assert_eq!(warned[0].text("market"), "BTC/USDT-P");
    assert!(sent(&mut conn).is_empty());
}

// the window check, the only guard with no sequence

#[test]
fn a_skipped_update_overfills_the_window_and_reseeds_that_market_alone() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, &btc_snapshot());
    send(&mut conn, &xag_snapshot());

    let published = send(&mut conn, &btc_update_351());

    assert_eq!(published, [("BTC/USDT-P".to_string(), Vec::new(), Vec::new())]);
    assert_eq!(sent(&mut conn), [book_request("unsubscribe", "BTC/USDT-P"), book_request("subscribe", "BTC/USDT-P")]);
    assert!(!conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync.len(), 1);
    assert_eq!(resync[0].text("market"), "BTC/USDT-P");
    assert_eq!(resync[0].text("reason"), "window_overfull");
    assert_eq!(resync[0].text("action"), "resubscribe");
    assert_eq!(send(&mut conn, &xag_update_797()).len(), 1);
}

// The window of the 22:59:41.797 update moved a tick, as a frame the book never got would leave it.
#[test]
fn a_window_that_does_not_match_the_book_reseeds_it() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, &xag_snapshot());
    let mut frame = xag_update_797();
    frame["data"]["ask"]["startPrice"] = json!("60.36");

    let published = send(&mut conn, &frame);

    assert_eq!(published, [("XAG/USDT-P".to_string(), Vec::new(), Vec::new())]);
    assert_eq!(logs.events("book_resync")[0].text("reason"), "window_mismatch");
    assert_eq!(sent(&mut conn).len(), 2);
}

#[test]
fn updates_wait_for_the_fresh_snapshot_after_a_reseed() {
    let mut conn = connection();
    send(&mut conn, &btc_snapshot());
    send(&mut conn, &btc_update_351());
    sent(&mut conn);

    let in_flight = send(&mut conn, &btc_update_656());
    let snapshot = send(&mut conn, &btc_snapshot());
    let next = send(&mut conn, &btc_update_050());

    assert!(in_flight.is_empty());
    assert!(sent(&mut conn).is_empty());
    let (bids, asks) = btc_snapshot_levels();
    assert_eq!(snapshot, [("BTC/USDT-P".to_string(), bids, asks)]);
    assert_eq!(next[0].2[0], BookLevel { price: 82339.1, size: 0.0303622827 });
}

#[test]
fn a_reseed_whose_snapshot_never_comes_goes_out_again_after_five_seconds() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send_at(&mut conn, &btc_snapshot(), 1_000);
    send_at(&mut conn, &xag_snapshot(), 1_000);
    send_at(&mut conn, &btc_update_351(), 1_000);
    sent(&mut conn);

    send_at(&mut conn, &xag_unchanged(), 1_000 + RESEED_WAIT_MS - 1);
    assert!(sent(&mut conn).is_empty());
    send_at(&mut conn, &xag_unchanged(), 1_000 + RESEED_WAIT_MS);

    assert_eq!(sent(&mut conn), [book_request("unsubscribe", "BTC/USDT-P"), book_request("subscribe", "BTC/USDT-P")]);
    let resync = logs.events("book_resync");
    assert_eq!(resync.len(), 2);
    assert_eq!(resync[1].text("reason"), "snapshot_missing");
    send_at(&mut conn, &xag_unchanged(), 1_000 + RESEED_WAIT_MS + 1);
    assert!(sent(&mut conn).is_empty());
}

// The 22:59:39.749 snapshot with its bid window moved a tick, as a venue that kept sending a snapshot the check refuses would.
#[test]
fn a_fresh_snapshot_that_fails_again_asks_no_sooner_than_five_seconds_after_the_last_request() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send_at(&mut conn, &btc_snapshot(), 1_000);
    send_at(&mut conn, &xag_snapshot(), 1_000);
    send_at(&mut conn, &btc_update_351(), 1_000);
    assert_eq!(sent(&mut conn).len(), 2);
    let mut refused = btc_snapshot();
    refused["data"]["bid"]["startPrice"] = json!("82348.3");

    let again = send_at(&mut conn, &refused, 1_110);
    let update = send_at(&mut conn, &btc_update_050(), 1_400);

    assert!(again.is_empty() && update.is_empty());
    assert!(sent(&mut conn).is_empty());
    send_at(&mut conn, &xag_unchanged(), 1_000 + RESEED_WAIT_MS);
    assert_eq!(sent(&mut conn), [book_request("unsubscribe", "BTC/USDT-P"), book_request("subscribe", "BTC/USDT-P")]);
    let good = send_at(&mut conn, &btc_snapshot(), 1_000 + RESEED_WAIT_MS + 110);
    assert_eq!(good.len(), 1);
    let reasons: Vec<String> = logs.events("book_resync").iter().map(|line| line.text("reason").to_string()).collect();
    assert_eq!(reasons, ["window_overfull", "window_mismatch", "snapshot_missing"]);
}

#[test]
fn an_update_before_any_snapshot_reseeds_the_market_and_publishes_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(&mut conn, &btc_update_050());

    assert!(published.is_empty());
    assert_eq!(sent(&mut conn), [book_request("unsubscribe", "BTC/USDT-P"), book_request("subscribe", "BTC/USDT-P")]);
    assert_eq!(logs.events("book_resync")[0].text("reason"), "update_before_snapshot");
}

#[test]
fn a_level_that_is_not_a_number_reseeds_the_market() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, &btc_snapshot());
    let mut frame = btc_update_656();
    frame["data"]["bid"]["levels"][1]["quantity"] = json!("not a number");

    let published = send(&mut conn, &frame);

    assert_eq!(published, [("BTC/USDT-P".to_string(), Vec::new(), Vec::new())]);
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

// crossed books

#[test]
fn a_crossed_book_is_held_back_as_an_empty_book_and_published_again_once_it_uncrosses() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send_at(&mut conn, &btc_snapshot(), 1_000);

    let crossing = send_at(&mut conn, &btc_crossing(), 1_300);
    let still = send_at(&mut conn, &btc_still_crossed(), 1_600);
    let uncrossing = send_at(&mut conn, &btc_uncrossing(), 1_900);

    assert_eq!(crossing, [("BTC/USDT-P".to_string(), Vec::new(), Vec::new())]);
    assert!(still.is_empty());
    let (bids, asks) = btc_snapshot_levels();
    assert_eq!(uncrossing, [("BTC/USDT-P".to_string(), bids, asks)]);
    assert!(sent(&mut conn).is_empty());
    assert!(logs.events("book_resync").is_empty());
    let crossed = logs.events("book_crossed");
    assert_eq!(crossed.len(), 1);
    assert_eq!((crossed[0].number("bid"), crossed[0].number("ask")), (82348.4, 82348.3));
    assert_eq!(logs.events("book_uncrossed")[0].number("crossed_ms"), 600.0);
}

#[test]
fn a_snapshot_that_arrives_crossed_publishes_nothing_until_it_uncrosses() {
    let mut conn = connection();
    let mut crossed = btc_snapshot();
    crossed["data"]["bid"] = side("82348.4", "82347.2", &[("82348.4", "0.01"), ("82348.2", "0.000667"), ("82347.2", "0.0007690545")]);

    let first = send(&mut conn, &crossed);
    let uncrossing = send(&mut conn, &btc_uncrossing());

    assert!(first.is_empty());
    assert_eq!(uncrossing[0].1, btc_snapshot_levels().0);
}

// errors and other frames

#[test]
fn an_error_frame_is_logged_as_a_venue_error_and_the_connection_carries_on() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    // Captured live at 22:59 UTC on 2026-10-12, the answer to a subscribe of an unknown symbol.
    let error = json!({
        "error": "Could not find symbol \"FOO/USDT-P\".",
        "original_request": "{\"method\":\"subscribe\",\"parameters\":{\"subscriptions\":[{\"depth\":20,\"symbol\":\"FOO/USDT-P\",\"topic\":\"orderbook\"}]}}",
    });

    assert!(send(&mut conn, &error).is_empty());

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "hibachi#perp#0");
    assert_eq!(errors[0].text("message"), "Could not find symbol \"FOO/USDT-P\".");
    assert!(errors[0].text("request").contains("FOO/USDT-P"));
    assert!(!conn.resync_requested());
    assert!(sent(&mut conn).is_empty());
}

// The researcher's capture of the mark_price topic, which the feed never subscribes to.
#[test]
fn a_frame_of_another_topic_is_a_notice_and_publishes_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(&mut conn, &json!({ "data": { "markPrice": "0.696400000" }, "symbol": "AUD/USDT-P", "topic": "mark_price" }));

    assert!(published.is_empty());
    assert_eq!(logs.events("venue_notice")[0].text("topic"), "mark_price");
}

#[test]
fn a_frame_that_is_not_json_is_an_error() {
    let mut conn = connection();

    assert!(venue().handle(b"not json", &mut conn).is_err());
    assert!(conn.take_published().is_empty());
}

// Prints the frames the feed tests are built from, and checks that an unsubscribe and a subscribe sent back to back bring a fresh snapshot:
// cargo test hibachi::tests::capture_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_frames() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut socket, _) = tokio_tungstenite::connect_async(URL).await.unwrap();
    let started = tokio::time::Instant::now();

    // Three levels a side keep the captured windows short enough to quote whole.
    for symbol in ["BTC/USDT-P", "XAG/USDT-P"] {
        let frame = json!({ "method": "subscribe", "parameters": { "subscriptions": [{ "symbol": symbol, "topic": TOPIC, "depth": 3 }] } });
        socket.send(Message::text(frame.to_string())).await.unwrap();
    }
    socket.send(book_frame("subscribe", "FOO/USDT-P")).await.unwrap();
    socket.send(book_frame("subscribe", "ETH/USDT-P")).await.unwrap();
    socket.send(Message::Ping(Default::default())).await.unwrap();

    let mut phase = 1;
    let mut printed = 0;
    let mut eth: Vec<(i32, String)> = Vec::new();
    let mut reseeded = false;
    let deadline = started + Duration::from_secs(8);
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, socket.next()).await {
        let ms = started.elapsed().as_millis();
        if !reseeded && ms >= 3_000 {
            // What reseed sends, in one burst.
            socket.send(book_frame("unsubscribe", "ETH/USDT-P")).await.unwrap();
            socket.send(book_frame("subscribe", "ETH/USDT-P")).await.unwrap();
            reseeded = true;
            phase = 2;
            println!("{ms} ms: phase 2, unsubscribe and subscribe of ETH/USDT-P sent back to back");
        }
        let text = match message {
            Message::Text(text) => text.to_string(),
            Message::Pong(_) => {
                println!("{ms} ms: pong");
                continue;
            }
            other => {
                println!("{ms} ms: {other:?}");
                continue;
            }
        };
        let value: Value = serde_json::from_str(&text).unwrap();
        if value["symbol"] == "ETH/USDT-P" {
            let kind = value["messageType"].as_str().unwrap_or("").to_string();
            let levels = value["data"]["bid"]["levels"].as_array().map_or(0, Vec::len);
            eth.push((phase, format!("{ms} ms {kind} depth {} bid levels {levels}", value["depth"])));
            continue;
        }
        if printed < 30 || value.get("error").is_some() {
            println!("{ms} ms: {text}");
            printed += 1;
        }
    }

    for (phase, line) in eth.iter().take(4).chain(eth.iter().filter(|(phase, _)| *phase == 2).take(4)) {
        println!("ETH phase {phase}: {line}");
    }
    let snapshots = |wanted: i32| eth.iter().filter(|(phase, line)| *phase == wanted && line.contains("Snapshot")).count();
    println!("ETH snapshots: {} in phase 1, {} in phase 2, frames {}", snapshots(1), snapshots(2), eth.len());
}
