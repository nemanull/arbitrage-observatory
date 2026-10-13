// Frames captured live on 2026-10-12 at 23:03 UTC with capture_frames below, with the level arrays cut down.
// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::clock::now_ms;
use crate::test_log::capture;
use crate::venues::testing;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

const CONNECTION_ID: &str = "1ead9c26-41ff-458f-bfa4-57373ba147f1";

fn market(ticker: &str) -> Market {
    let base = ticker.split('-').next().unwrap();
    testing::market(ID, ticker, base, "USDC", true)
}

fn markets(count: usize) -> Vec<Market> {
    (0..count).map(|i| market(&format!("SYM{i}-USD"))).collect()
}

fn venue() -> Dydx {
    Dydx::new()
}

fn connection(tickers: &[&str]) -> Connection<State> {
    Connection::for_test("dydx#perp#0", tickers.iter().map(|ticker| market(ticker)).collect())
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    pairs.iter().map(|&(price, size)| BookLevel { price, size }).collect()
}

fn send(conn: &mut Connection<State>, frame: &Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

fn subscribed(message_id: i64, ticker: &str, bids: &[(&str, &str)], asks: &[(&str, &str)]) -> Value {
    let side = |pairs: &[(&str, &str)]| -> Vec<Value> { pairs.iter().map(|(price, size)| json!({ "price": price, "size": size })).collect() };
    json!({
        "type": "subscribed", "connection_id": CONNECTION_ID, "message_id": message_id, "channel": "v4_orderbook", "id": ticker,
        "contents": { "bids": side(bids), "asks": side(asks) },
    })
}

fn data(message_id: i64, ticker: &str, contents: Value) -> Value {
    json!({
        "type": "channel_data", "connection_id": CONNECTION_ID, "message_id": message_id, "id": ticker,
        "channel": "v4_orderbook", "version": "1.0.0", "contents": contents,
    })
}

// Four books subscribed 30 ms apart, in the order the frames came: DOGE's subscribe held 4 while SOL's and BTC's deltas took 5 to 7.
fn btc_snapshot() -> Value {
    subscribed(1, "BTC-USD", &[("82034", "0.0609"), ("82031", "0.1797")], &[("82045", "0.3122"), ("82055", "0.2722")])
}

fn eth_snapshot() -> Value {
    subscribed(2, "ETH-USD", &[("2460.8", "2.031"), ("2460", "4.065")], &[("2461.6", "2.031"), ("2461.7", "0.002")])
}

fn sol_snapshot() -> Value {
    subscribed(3, "SOL-USD", &[("106.15", "47"), ("106.11", "1941.4")], &[("106.21", "47"), ("106.26", "186.6")])
}

fn doge_snapshot() -> Value {
    subscribed(4, "DOGE-USD", &[("0.08295", "10900"), ("0.08262", "100800")], &[("0.08376", "117700"), ("0.08377", "99500")])
}

fn four_books() -> Connection<State> {
    connection(&["BTC-USD", "ETH-USD", "SOL-USD", "DOGE-USD"])
}

// Every frame up to the last snapshot of the four, and the first data frame after it.
fn four_books_opened(conn: &mut Connection<State>) -> Vec<Published> {
    let frames = [
        json!({ "type": "connected", "connection_id": CONNECTION_ID, "message_id": 0 }),
        btc_snapshot(),
        eth_snapshot(),
        sol_snapshot(),
        data(5, "SOL-USD", json!({ "asks": [["116.91", "1.6"]] })),
        data(6, "BTC-USD", json!({ "asks": [["83790", "0.0563"]] })),
        data(7, "SOL-USD", json!({ "asks": [["107.91", "8.8"]] })),
        doge_snapshot(),
        data(8, "SOL-USD", json!({ "asks": [["107.7", "4.4"]] })),
    ];
    frames.iter().map(|frame| send(conn, frame)).collect()
}

// plan, settings and subscribe frames

#[test]
fn puts_at_most_25_markets_on_a_socket_under_the_cap_of_32_books() {
    let plans = venue().plan(&markets(73));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [25, 25, 23]);
    assert_eq!(plans[2].id, "dydx#perp#2");
    assert!(plans.iter().all(|plan| plan.url == "wss://indexer.dydx.trade/v4/ws"));
    assert!(venue().plan(&[]).is_empty());
}

#[test]
fn pings_every_10_seconds_inside_a_20_second_silence_and_paces_subscribes_at_30_ms() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(10)));
    assert_eq!(settings.max_silence, Duration::from_secs(20));
    assert_eq!(settings.subscribe_gap, Duration::from_millis(30));
    assert!(matches!(venue().ping(&mut State::default()), Message::Ping(_)));
}

#[test]
fn subscribes_each_book_with_a_frame_of_its_own() {
    let frames = venue().subscribe_frames(&[market("BTC-USD"), market("1INCH-USD")], &mut State::default());

    let frames: Vec<Value> = frames.iter().map(parsed).collect();
    assert_eq!(
        frames,
        [
            json!({ "type": "subscribe", "channel": "v4_orderbook", "id": "BTC-USD" }),
            json!({ "type": "subscribe", "channel": "v4_orderbook", "id": "1INCH-USD" }),
        ]
    );
}

// snapshots and deltas

#[test]
fn hands_the_engine_a_snapshot_as_the_whole_book() {
    let mut conn = four_books();

    let published = send(&mut conn, &btc_snapshot());

    assert_eq!(
        published,
        [(
            "BTC-USD".to_string(),
            levels(&[(82034.0, 0.0609), (82031.0, 0.1797)]),
            levels(&[(82045.0, 0.3122), (82055.0, 0.2722)]),
        )]
    );
}

#[test]
fn applies_a_delta_as_the_new_total_size_and_removes_a_level_of_size_zero() {
    let mut conn = four_books();
    send(&mut conn, &btc_snapshot());

    let added = send(&mut conn, &data(6, "BTC-USD", json!({ "asks": [["83790", "0.0563"]] })));
    let changed = send(&mut conn, &data(7, "BTC-USD", json!({ "bids": [["82031", "0.5"]], "asks": [["82045", "0"]] })));

    assert_eq!(added[0].2, levels(&[(82045.0, 0.3122), (82055.0, 0.2722), (83790.0, 0.0563)]));
    assert_eq!(changed[0].1, levels(&[(82034.0, 0.0609), (82031.0, 0.5)]));
    assert_eq!(changed[0].2, levels(&[(82055.0, 0.2722), (83790.0, 0.0563)]));
    assert!(!conn.resync_requested());
}

#[test]
fn an_empty_delta_publishes_nothing() {
    let mut conn = four_books();
    send(&mut conn, &btc_snapshot());

    assert!(send(&mut conn, &data(6, "BTC-USD", json!({}))).is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn restarts_the_connection_on_a_delta_with_no_snapshot_behind_it() {
    let (logs, _capture) = capture();
    let mut conn = four_books();

    let published = send(&mut conn, &data(5, "SOL-USD", json!({ "asks": [["116.91", "1.6"]] })));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

// the message_id chain

#[test]
fn accepts_data_frames_that_step_over_the_numbers_pending_subscribes_hold() {
    let (logs, _capture) = capture();
    let mut conn = four_books();

    let published = four_books_opened(&mut conn);

    assert!(!conn.resync_requested());
    assert!(logs.events("book_resync").is_empty());
    assert_eq!(published[4][0].2[1], BookLevel { price: 106.26, size: 186.6 });
    assert_eq!(published[7][0].0, "DOGE-USD");
    assert_eq!(published[8][0].2[..2], levels(&[(106.21, 47.0), (106.26, 186.6)]));
}

// The frames after the first one past the last snapshot are numbered by hand, as the next frames on that connection would be.
#[test]
fn anchors_on_the_first_data_frame_after_the_last_answer_and_restarts_on_any_other_step() {
    let (logs, _capture) = capture();
    let mut conn = four_books();
    four_books_opened(&mut conn);

    let next = send(&mut conn, &data(9, "BTC-USD", json!({ "bids": [["82033", "1"]] })));
    assert_eq!(next[0].1[1], BookLevel { price: 82033.0, size: 1.0 });
    assert!(!conn.resync_requested());

    let skipped = send(&mut conn, &data(11, "BTC-USD", json!({ "bids": [["82032", "1"]] })));

    assert!(skipped.is_empty());
    assert!(conn.resync_requested());
    let gap = logs.events("message_id_gap");
    assert_eq!((gap[0].number("expected"), gap[0].number("got")), (10.0, 11.0));
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_gap");
}

#[test]
fn restarts_the_connection_when_the_chain_steps_back() {
    let mut conn = four_books();
    four_books_opened(&mut conn);

    let repeated = send(&mut conn, &data(8, "SOL-USD", json!({ "asks": [["107.7", "4.4"]] })));

    assert!(repeated.is_empty());
    assert!(conn.resync_requested());
}

// A refused subscribe, captured as it came between two snapshots, answers with the number its subscribe took.
fn refused() -> Value {
    json!({
        "type": "error", "message": "Invalid subscription id for channel: (v4_orderbook-FOO-USD)",
        "connection_id": CONNECTION_ID, "message_id": 3,
    })
}

#[test]
fn a_refused_subscribe_counts_as_answered_so_the_chain_still_anchors() {
    let mut conn = connection(&["BTC-USD", "ETH-USD", "FOO-USD", "JTO-USD"]);
    send(&mut conn, &subscribed(1, "BTC-USD", &[("81971", "0.1797")], &[("81988", "0.0609")]));
    send(&mut conn, &subscribed(2, "ETH-USD", &[("2458.5", "4.067"), ("2399.8", "1")], &[("2460.2", "2.032")]));
    send(&mut conn, &refused());
    send(&mut conn, &subscribed(4, "JTO-USD", &[("0.4993", "11616")], &[("0.513", "5653")]));

    let first = send(&mut conn, &data(5, "ETH-USD", json!({ "bids": [["2399.8", "0"]] })));
    send(&mut conn, &data(6, "ETH-USD", json!({ "bids": [["2414.8", "0"]] })));
    assert!(!conn.resync_requested());
    assert_eq!(first[0].1, levels(&[(2458.5, 4.067)]));

    send(&mut conn, &data(8, "ETH-USD", json!({ "bids": [["2414.8", "0"]] })));
    assert!(conn.resync_requested());
}

// Captured live on 2026-10-12 at 23:16 UTC in steady state: an unknown channel's error repeated the number of the frame before it,
// and an unknown ticker's error took the next number, so the data frame after it stepped by 2 from the last data frame.
#[test]
fn anchors_the_chain_again_on_the_data_frame_after_an_error() {
    let mut conn = four_books();
    four_books_opened(&mut conn);
    let unknown_channel = json!({ "type": "error", "message": "Invalid channel: v4_nosuch", "connection_id": CONNECTION_ID, "message_id": 8 });
    let unknown_ticker = json!({
        "type": "error", "message": "Invalid subscription id for channel: (v4_orderbook-FOO-USD)", "connection_id": CONNECTION_ID, "message_id": 10,
    });

    send(&mut conn, &unknown_channel);
    send(&mut conn, &data(9, "SOL-USD", json!({ "asks": [["107.6", "1"]] })));
    send(&mut conn, &unknown_ticker);
    send(&mut conn, &data(11, "SOL-USD", json!({ "asks": [["107.6", "0"]] })));
    assert!(!conn.resync_requested());

    send(&mut conn, &data(13, "SOL-USD", json!({ "asks": [["107.6", "2"]] })));
    assert!(conn.resync_requested());
}

#[test]
fn logs_an_error_frame_as_a_venue_error_and_keeps_the_connection() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["BTC-USD", "FOO-USD"]);

    send(&mut conn, &refused());

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "dydx#perp#0");
    assert_eq!(errors[0].text("message"), "Invalid subscription id for channel: (v4_orderbook-FOO-USD)");
    assert_eq!(errors[0].number("message_id"), 3.0);
    assert!(!conn.resync_requested());
}

// crossed books

#[test]
fn a_new_bid_at_or_above_the_best_ask_drops_the_older_asks_it_crosses() {
    let (logs, _capture) = capture();
    let mut conn = four_books();
    send(&mut conn, &btc_snapshot());

    let published = send(&mut conn, &data(6, "BTC-USD", json!({ "bids": [["82055", "1"]] })));

    assert_eq!(published[0].1[0], BookLevel { price: 82055.0, size: 1.0 });
    assert!(published[0].2.is_empty());
    let uncrossed = logs.events("book_uncrossed");
    assert_eq!(uncrossed[0].text("market"), "BTC-USD");
    assert_eq!((uncrossed[0].number("bid"), uncrossed[0].number("ask")), (82055.0, 82045.0));
    assert_eq!((uncrossed[0].number("dropped_bids"), uncrossed[0].number("dropped_asks")), (0.0, 2.0));
    assert!(!conn.resync_requested());
}

#[test]
fn a_new_ask_at_or_below_the_best_bid_drops_the_older_bids_it_crosses() {
    let mut conn = four_books();
    send(&mut conn, &btc_snapshot());

    let published = send(&mut conn, &data(6, "BTC-USD", json!({ "asks": [["82033", "2"]] })));

    assert_eq!(published[0].1, levels(&[(82031.0, 0.1797)]));
    assert_eq!(published[0].2, levels(&[(82033.0, 2.0), (82045.0, 0.3122), (82055.0, 0.2722)]));
}

#[test]
fn a_frame_that_crosses_itself_drops_both_of_its_levels() {
    let mut conn = four_books();
    send(&mut conn, &btc_snapshot());

    let published = send(&mut conn, &data(6, "BTC-USD", json!({ "bids": [["82060", "1"]], "asks": [["82040", "2"]] })));

    assert_eq!(published[0].1, levels(&[(82034.0, 0.0609), (82031.0, 0.1797)]));
    assert_eq!(published[0].2, levels(&[(82045.0, 0.3122), (82055.0, 0.2722)]));
}

#[test]
fn a_crossed_snapshot_drops_both_touching_levels_until_it_uncrosses() {
    let (logs, _capture) = capture();
    let mut conn = four_books();
    let crossed = subscribed(1, "BTC-USD", &[("82050", "1"), ("82048", "2"), ("82034", "3")], &[("82045", "4"), ("82047", "5"), ("82055", "6")]);

    let published = send(&mut conn, &crossed);

    assert_eq!(published[0].1, levels(&[(82034.0, 3.0)]));
    assert_eq!(published[0].2, levels(&[(82055.0, 6.0)]));
    let uncrossed = logs.events("book_uncrossed");
    assert_eq!(uncrossed.len(), 1);
    assert_eq!((uncrossed[0].number("bid"), uncrossed[0].number("ask")), (82050.0, 82045.0));
    assert_eq!((uncrossed[0].number("dropped_bids"), uncrossed[0].number("dropped_asks")), (2.0, 2.0));
}

#[test]
fn a_book_that_never_crosses_logs_no_uncross() {
    let (logs, _capture) = capture();
    let mut conn = four_books();

    four_books_opened(&mut conn);

    assert!(logs.events("book_uncrossed").is_empty());
}

// levels and frames that do not read

#[test]
fn restarts_the_connection_on_a_delta_level_it_cannot_read() {
    let (logs, _capture) = capture();
    let mut conn = four_books();
    send(&mut conn, &btc_snapshot());

    let published = send(&mut conn, &data(6, "BTC-USD", json!({ "bids": [["82031", ""]] })));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn restarts_the_connection_on_a_snapshot_level_it_cannot_read() {
    let mut conn = four_books();

    let published = send(&mut conn, &subscribed(1, "BTC-USD", &[("x", "0.0609")], &[("82045", "0.3122")]));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn restarts_the_connection_on_a_book_frame_that_does_not_parse() {
    let (logs, _capture) = capture();
    let mut conn = four_books();
    send(&mut conn, &btc_snapshot());
    let broken = data(6, "BTC-USD", json!({ "bids": { "82031": "0.5" } }));

    assert!(venue().handle(broken.to_string().as_bytes(), &mut conn).is_err());
    assert!(conn.take_published().is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "frame_unreadable");
}

#[test]
fn a_frame_that_is_not_json_is_an_error() {
    let mut conn = four_books();

    assert!(venue().handle(b"not json", &mut conn).is_err());
    assert!(conn.take_published().is_empty());
}

// routing and the frames that carry no book

#[test]
fn drops_a_ticker_the_connection_did_not_subscribe_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["ETH-USD"]);

    let snapshot = send(&mut conn, &btc_snapshot());
    let delta = send(&mut conn, &data(2, "BTC-USD", json!({ "asks": [["83790", "0.0563"]] })));

    assert!(snapshot.is_empty() && delta.is_empty());
    assert!(!conn.resync_requested());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

#[test]
fn stays_silent_on_the_connected_frame_and_logs_any_unknown_frame_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = four_books();

    send(&mut conn, &json!({ "type": "connected", "connection_id": CONNECTION_ID, "message_id": 0 }));
    assert!(logs.lines().is_empty());

    send(&mut conn, &json!({ "type": "unsubscribed", "connection_id": CONNECTION_ID, "message_id": 9, "channel": "v4_orderbook", "id": "BTC-USD" }));
    assert_eq!(logs.events("venue_notice").len(), 1);
    assert!(conn.take_sent().is_empty());
}

// Prints the frames of a short live session, the source of the captures above:
// CAPTURE_MARKETS=BTC-USD,ETH-USD,FOO-USD,JTO-USD cargo test dydx::tests::capture_frames -- --ignored --nocapture
// The first 40 frames are printed whole, and every later one as its type, message_id and ticker.
#[tokio::test]
#[ignore]
async fn capture_frames() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut socket, _) = tokio_tungstenite::connect_async(URL).await.unwrap();
    let list = std::env::var("CAPTURE_MARKETS").unwrap_or_else(|_| "BTC-USD,ETH-USD,FOO-USD,JTO-USD".to_string());
    let markets: Vec<Market> = list.split(',').map(market).collect();
    let seconds: u64 = std::env::var("CAPTURE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(5);
    for frame in venue().subscribe_frames(&markets, &mut State::default()) {
        socket.send(frame).await.unwrap();
        tokio::time::sleep(Duration::from_millis(30)).await;
    }

    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    let mut printed = 0;
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, socket.next()).await {
        let Message::Text(text) = message else {
            println!("{} {message:?}", now_ms());
            continue;
        };
        if printed < 40 {
            println!("{} {text}", now_ms());
        } else {
            let frame: Value = serde_json::from_str(text.as_str()).unwrap();
            println!("{} {} {} {}", now_ms(), frame["type"], frame["message_id"], frame["id"]);
        }
        printed += 1;
    }
}
