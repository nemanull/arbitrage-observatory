// The engine's received levels are read through Connection::take_published after each frame or snapshot.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

const SHIB: &str = "kSHIB_USDC_PERP";
const LINK: &str = "LINK_USDC_PERP";
const AAPL: &str = "AAPL.US_USDC_PERP";

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.split('_').next().unwrap();
    testing::market(ID, raw_market_id, base, "USDC", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}_USDC_PERP")));
    }
    markets
}

fn venue() -> Backpack {
    Backpack::new()
}

fn connection(ids: &[&str]) -> Connection<State> {
    Connection::for_test("backpack#perp#0", ids.iter().map(|id| market(id)).collect())
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

fn send(conn: &mut Connection<State>, frame: Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn snapshot(conn: &mut Connection<State>, position: usize, body: Value) -> Published {
    venue().handle_snapshot(position, body.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

// The kSHIB_USDC_PERP REST book of 2026-10-09 at lastUpdateId 233570179, read at limit 5, with bids ascending as the venue sends them.
const SHIB_ID: i64 = 233570179;

fn shib_snapshot_at(last_update_id: i64) -> Value {
    json!({
        "asks": [["0.005405", "124300"], ["0.005406", "186900"], ["0.005407", "1300"], ["0.005408", "1129700"], ["0.005409", "483600"]],
        "bids": [["0.005399", "175500"], ["0.0054", "633500"], ["0.005401", "74400"], ["0.005402", "123000"], ["0.005403", "240500"]],
        "lastUpdateId": last_update_id.to_string(),
        "timestamp": 1791568085553446_i64,
    })
}

fn shib_snapshot() -> Value {
    shib_snapshot_at(SHIB_ID)
}

fn shib_bids() -> Vec<BookLevel> {
    levels(&[(0.005403, 240500.0), (0.005402, 123000.0), (0.005401, 74400.0), (0.0054, 633500.0), (0.005399, 175500.0)])
}

fn shib_asks() -> Vec<BookLevel> {
    levels(&[(0.005405, 124300.0), (0.005406, 186900.0), (0.005407, 1300.0), (0.005408, 1129700.0), (0.005409, 483600.0)])
}

// Consecutive kSHIB deltas captured on the same day: two the snapshot covers, then the three after it.
// The socket pads prices to the tick, "0.005400" where the REST book writes "0.0054".
fn delta(market: &str, id: i64, bids: Value, asks: Value) -> Value {
    json!({
        "data": { "E": 1791568093033008_i64, "T": 1791568093032615_i64, "U": id, "a": asks, "b": bids, "e": "depth", "s": market, "u": id },
        "stream": format!("depth.{market}"),
    })
}

fn shib(id: i64, bids: Value, asks: Value) -> Value {
    delta(SHIB, id, bids, asks)
}

fn shib_covered() -> [Value; 2] {
    [
        shib(233570178, json!([]), json!([["0.005425", "1300"]])),
        shib(233570179, json!([["0.005401", "74400"]]), json!([])),
    ]
}

fn shib_first() -> Value {
    shib(233570180, json!([["0.005396", "1200"]]), json!([]))
}

fn shib_second() -> Value {
    shib(233570181, json!([]), json!([["0.005404", "200"]]))
}

fn shib_third() -> Value {
    shib(233570182, json!([["0.005400", "633300"]]), json!([]))
}

// A kSHIB connection whose snapshot fetch has started, so the runtime has taken it off the queue, as a request made now shows.
fn waiting() -> Connection<State> {
    let mut conn = connection(&[SHIB]);
    conn.state.seeding = true;
    conn.state.books.insert(0, Seed::Waiting(VecDeque::new()));
    conn
}

// A kSHIB connection seeded from the snapshot, with nothing published or queued.
fn seeded() -> Connection<State> {
    let mut conn = waiting();
    snapshot(&mut conn, 0, shib_snapshot());
    conn
}

// settings and plan

#[test]
fn spreads_91_markets_over_four_connections_to_the_one_public_socket() {
    let plans = venue().plan(&markets(91));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [23, 23, 23, 22]);
    assert_eq!(plans[0].id, "backpack#perp#0");
    assert_eq!(plans[3].id, "backpack#perp#3");
    assert_eq!(plans[0].url, "wss://ws.backpack.exchange");
    assert_eq!(plans[3].markets[21].raw_market_id, "SYM90_USDC_PERP");
}

#[test]
fn keeps_30_markets_on_one_connection_and_splits_31_in_two() {
    let sizes = |count: usize| -> Vec<usize> { venue().plan(&markets(count)).iter().map(|plan| plan.markets.len()).collect() };

    assert_eq!(sizes(30), [30]);
    assert_eq!(sizes(31), [16, 15]);
    assert_eq!(sizes(1), [1]);
}

#[test]
fn pings_every_15_seconds_reads_45_seconds_of_silence_as_dead_and_seeds_a_full_connection_within_the_first_book_wait() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(15)));
    assert_eq!(settings.max_silence, Duration::from_secs(45));
    assert_eq!(settings.snapshot_gap, Duration::from_millis(800));
    assert!(settings.first_book_wait > settings.snapshot_gap * MAX_MARKETS_PER_CONNECTION as u32);
    assert!(settings.headers.is_empty());
}

#[test]
fn pings_with_a_protocol_ping() {
    assert!(matches!(venue().ping(&mut State::default()), Message::Ping(_)));
}

// subscribe_frames

#[test]
fn subscribes_each_market_in_its_own_frame() {
    let slice = vec![market(SHIB), market(AAPL)];

    let frames = venue().subscribe_frames(&slice, &mut State::default());

    assert_eq!(frames.len(), 2);
    assert_eq!(parsed(&frames[0]), json!({ "method": "SUBSCRIBE", "params": ["depth.kSHIB_USDC_PERP"] }));
    assert_eq!(parsed(&frames[1])["params"], json!(["depth.AAPL.US_USDC_PERP"]));
}

// snapshot requests

#[test]
fn asks_for_every_market_snapshot_on_the_first_frame_and_holds_the_delta() {
    let mut conn = connection(&[LINK, SHIB, AAPL]);

    let published = send(&mut conn, shib_first());

    assert!(published.is_empty());
    assert_eq!(conn.queued_snapshots(), [0, 1, 2]);
    assert!(matches!(&conn.state.books[&1], Seed::Waiting(held) if held.len() == 1));

    send(&mut conn, shib_second());
    assert_eq!(conn.queued_snapshots(), [0, 1, 2]);
}

#[test]
fn asks_for_the_snapshots_even_when_the_first_frame_is_an_error() {
    let (_logs, _capture) = capture();
    let mut conn = connection(&[LINK, SHIB]);

    send(&mut conn, json!({ "id": null, "error": { "code": 4014, "message": "Invalid symbol" } }));

    assert_eq!(conn.queued_snapshots(), [0, 1]);
}

#[test]
fn builds_the_snapshot_url_for_a_deep_rest_book() {
    let url = venue().snapshot_url(&market(AAPL)).unwrap();

    assert_eq!(url, "https://api.backpack.exchange/api/v1/depth?symbol=AAPL.US_USDC_PERP&limit=1000");
}

// seeding

#[test]
fn seeds_the_book_from_the_rest_snapshot_whose_bids_ascend() {
    let mut conn = waiting();

    let published = snapshot(&mut conn, 0, shib_snapshot());

    assert_eq!(published, [(SHIB.to_string(), shib_bids(), shib_asks())]);
}

#[test]
fn replays_the_held_deltas_newer_than_the_snapshot_and_drops_the_ones_it_covers() {
    let mut conn = waiting();
    for frame in shib_covered() {
        send(&mut conn, frame);
    }
    send(&mut conn, shib_first());
    send(&mut conn, shib_second());

    let published = snapshot(&mut conn, 0, shib_snapshot());

    let mut bids = shib_bids();
    bids.push(BookLevel { price: 0.005396, size: 1200.0 });
    let mut asks = shib_asks();
    asks.insert(0, BookLevel { price: 0.005404, size: 200.0 });
    assert_eq!(published, [(SHIB.to_string(), bids, asks)]);
    assert!(!conn.resync_requested());

    let next = send(&mut conn, shib_third());
    assert_eq!(next[0].1[3], BookLevel { price: 0.0054, size: 633300.0 });
}

#[test]
fn chains_from_a_snapshot_one_update_ahead_of_the_socket() {
    let mut conn = waiting();
    send(&mut conn, shib_covered()[0].clone());

    let published = snapshot(&mut conn, 0, shib_snapshot());
    assert_eq!(published.len(), 1);

    // The delta the snapshot already holds is dropped, and the next one chains.
    assert!(send(&mut conn, shib_covered()[1].clone()).is_empty());
    let next = send(&mut conn, shib_first());
    assert_eq!(next[0].1.last(), Some(&BookLevel { price: 0.005396, size: 1200.0 }));
    assert!(!conn.resync_requested());
}

#[test]
fn takes_a_first_delta_that_straddles_the_snapshot() {
    let mut conn = seeded();
    let straddling = json!({
        "data": { "E": 1, "T": 1, "U": SHIB_ID, "u": SHIB_ID + 1, "a": [], "b": [["0.005396", "1200"]], "e": "depth", "s": SHIB },
        "stream": "depth.kSHIB_USDC_PERP",
    });

    let published = send(&mut conn, straddling);

    assert_eq!(published.len(), 1);
    assert!(!conn.resync_requested());
    assert_eq!(send(&mut conn, shib_second()).len(), 1);
}

#[test]
fn fetches_again_a_snapshot_behind_the_held_deltas_and_publishes_nothing() {
    let (logs, _capture) = capture();
    let mut conn = waiting();
    send(&mut conn, shib_second());
    send(&mut conn, shib_third());

    let published = snapshot(&mut conn, 0, shib_snapshot());

    assert!(published.is_empty());
    assert_eq!(conn.queued_snapshots(), [0]);
    assert!(!conn.resync_requested());
    let behind = logs.events("snapshot_behind");
    assert_eq!(behind.len(), 1);
    assert_eq!(behind[0].level, Level::WARN);
    assert_eq!(behind[0].number("last_update_id"), SHIB_ID as f64);
    assert_eq!(behind[0].number("first"), 233570181.0);

    // A later snapshot, at the first delta, seeds the book and replays the other two.
    let published = snapshot(&mut conn, 0, shib_snapshot_at(233570180));
    assert_eq!(published[0].2[0], BookLevel { price: 0.005404, size: 200.0 });
    assert_eq!(published[0].1[3], BookLevel { price: 0.0054, size: 633300.0 });
}

#[test]
fn logs_a_snapshot_behind_the_socket_on_the_first_miss_and_every_tenth() {
    let (logs, _capture) = capture();
    let mut conn = waiting();
    send(&mut conn, shib_second());

    for _ in 0..20 {
        snapshot(&mut conn, 0, shib_snapshot());
    }

    let behind = logs.events("snapshot_behind");
    assert_eq!(behind.len(), 3);
    assert_eq!(behind[2].number("misses"), 20.0);
    assert_eq!(conn.queued_snapshots(), [0]);
}

#[test]
fn keeps_only_the_newest_held_deltas_so_an_old_snapshot_is_fetched_again() {
    let (_logs, _capture) = capture();
    let mut conn = waiting();
    for i in 0..=MAX_HELD_DELTAS as i64 {
        send(&mut conn, shib(SHIB_ID + 1 + i, json!([["0.005396", "1200"]]), json!([])));
    }

    let published = snapshot(&mut conn, 0, shib_snapshot());

    assert!(published.is_empty());
    assert!(matches!(&conn.state.books[&0], Seed::Waiting(held) if held.len() == MAX_HELD_DELTAS));
    assert_eq!(conn.queued_snapshots(), [0]);
}

#[test]
fn restarts_the_connection_and_publishes_nothing_when_the_held_deltas_break() {
    let (logs, _capture) = capture();
    let mut conn = waiting();
    send(&mut conn, shib_first());
    send(&mut conn, shib_third());

    let published = snapshot(&mut conn, 0, shib_snapshot());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_gap");
}

#[test]
fn ignores_a_snapshot_for_a_market_already_seeded() {
    let mut conn = seeded();
    send(&mut conn, shib_first());

    let published = snapshot(&mut conn, 0, shib_snapshot());

    assert!(published.is_empty());
    assert_eq!(send(&mut conn, shib_second()).len(), 1);
}

#[test]
fn seeds_an_empty_rest_book_as_an_empty_book() {
    let mut conn = waiting();

    let published = snapshot(&mut conn, 0, json!({ "asks": [], "bids": [], "lastUpdateId": "6789929", "timestamp": 1791568085666814_i64 }));

    assert_eq!(published, [(SHIB.to_string(), Vec::new(), Vec::new())]);
}

#[test]
fn leaves_out_delta_levels_beyond_a_snapshot_side_that_filled_the_whole_request() {
    let mut conn = waiting();
    let mut bids = Vec::new();
    for i in 0..SNAPSHOT_LEVELS {
        bids.push(json!([format!("{}", i + 1), "1"]));
    }
    let body = json!({ "asks": [["1001", "1"]], "bids": bids, "lastUpdateId": SHIB_ID.to_string(), "timestamp": 1 });
    snapshot(&mut conn, 0, body);

    send(&mut conn, shib(SHIB_ID + 1, json!([["0.5", "3"], ["999", "2"]]), json!([["2000", "4"]])));

    // The engine gets 20 levels, so the whole book is read from the connection.
    let book = conn.book(0).unwrap();
    assert_eq!(book.bids().len(), SNAPSHOT_LEVELS);
    assert_eq!(book.bids()[1], BookLevel { price: 999.0, size: 2.0 });
    assert_eq!(book.bids().last().unwrap().price, 1.0);
    // The one ask was the whole side, so a level beyond it is kept.
    assert_eq!(book.asks(), &levels(&[(1001.0, 1.0), (2000.0, 4.0)])[..]);
}

// failed snapshot replies

#[test]
fn fetches_again_a_reply_that_is_not_a_book() {
    let (logs, _capture) = capture();
    let mut conn = waiting();

    venue().handle_snapshot(0, br#"{"code":"INVALID_CLIENT_REQUEST","message":"Invalid market symbol"}"#, &mut conn).unwrap();

    assert!(conn.take_published().is_empty());
    assert_eq!(conn.queued_snapshots(), [0]);
    let failed = logs.events("snapshot_failed");
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].level, Level::WARN);
    assert_eq!(failed[0].text("market"), SHIB);
    assert!(failed[0].text("error").contains("lastUpdateId"));
}

#[test]
fn fetches_again_a_reply_that_is_not_json() {
    let (logs, _capture) = capture();
    let mut conn = waiting();

    venue().handle_snapshot(0, b"404 not found", &mut conn).unwrap();

    assert_eq!(conn.queued_snapshots(), [0]);
    assert!(logs.events("snapshot_failed")[0].text("error").contains("not a book"));
}

#[test]
fn logs_a_run_of_failed_replies_on_the_first_and_every_30th_and_a_good_snapshot_ends_the_run() {
    let (logs, _capture) = capture();
    let mut conn = waiting();

    for _ in 0..31 {
        venue().handle_snapshot(0, b"{}", &mut conn).unwrap();
    }
    assert_eq!(logs.events("snapshot_failed").len(), 2);

    snapshot(&mut conn, 0, shib_snapshot());
    venue().handle_snapshot(0, b"{}", &mut conn).unwrap();
    let failed = logs.events("snapshot_failed");
    assert_eq!(failed.len(), 3);
    assert_eq!(failed[2].number("failures"), 1.0);
}

// deltas

#[test]
fn applies_a_chained_delta_with_absolute_sizes_and_deletes_a_zero_size() {
    let mut conn = seeded();

    send(&mut conn, shib_first());
    let published = send(&mut conn, shib(233570181, json!([["0.005403", "0.00"]]), json!([["0.005405", "0"]])));

    assert_eq!(published[0].1[0], BookLevel { price: 0.005402, size: 123000.0 });
    assert_eq!(published[0].2[0], BookLevel { price: 0.005406, size: 186900.0 });
}

#[test]
fn applies_a_frame_of_several_levels_in_any_order() {
    let mut conn = seeded();

    let published = send(&mut conn, shib(SHIB_ID + 1, json!([["0.005390", "5"], ["0.005404", "7"], ["0.005398", "9"]]), json!([])));

    let bids = &published[0].1;
    assert_eq!(bids[0], BookLevel { price: 0.005404, size: 7.0 });
    assert_eq!(bids.len(), 8);
    assert_eq!(bids.last(), Some(&BookLevel { price: 0.00539, size: 5.0 }));
}

#[test]
fn drops_a_delta_the_book_already_holds() {
    let mut conn = seeded();
    send(&mut conn, shib_first());

    assert!(send(&mut conn, shib_first()).is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn restarts_the_connection_on_a_gap_after_the_first_delta() {
    let (logs, _capture) = capture();
    let mut conn = seeded();
    send(&mut conn, shib_first());

    let published = send(&mut conn, shib_third());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync[0].text("market"), SHIB);
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn seeds_the_market_again_with_an_empty_book_when_the_socket_skips_past_a_fresh_snapshot() {
    let (logs, _capture) = capture();
    let mut conn = seeded();

    let published = send(&mut conn, shib_second());

    assert_eq!(published, [(SHIB.to_string(), Vec::new(), Vec::new())]);
    assert!(!conn.resync_requested());
    assert_eq!(conn.queued_snapshots(), [0]);
    assert_eq!(logs.events("snapshot_behind").len(), 1);

    let published = snapshot(&mut conn, 0, shib_snapshot_at(233570180));
    assert_eq!(published[0].2[0], BookLevel { price: 0.005404, size: 200.0 });
}

#[test]
fn routes_each_delta_to_its_own_market() {
    let mut conn = connection(&[LINK, SHIB]);
    conn.state.seeding = true;
    conn.state.books.insert(0, Seed::Waiting(VecDeque::new()));
    conn.state.books.insert(1, Seed::Waiting(VecDeque::new()));
    snapshot(&mut conn, 1, shib_snapshot());

    let published = send(&mut conn, shib_first());

    assert_eq!(published.len(), 1);
    assert_eq!(published[0].0, SHIB);
}

#[test]
fn drops_a_delta_for_a_market_not_on_the_connection_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = seeded();

    assert!(send(&mut conn, delta(LINK, 1345975109, json!([["12.79", "1"]]), json!([]))).is_empty());
    send(&mut conn, delta(LINK, 1345975110, json!([["12.79", "2"]]), json!([])));

    let unknown = logs.events("unsubscribed_symbol");
    assert_eq!(unknown.len(), 1);
    assert_eq!(unknown[0].text("market"), LINK);
    assert!(!conn.resync_requested());
}

#[test]
fn asks_again_for_a_market_whose_book_state_was_lost() {
    let mut conn = connection(&[SHIB]);
    conn.state.seeding = true;

    send(&mut conn, shib_first());

    assert_eq!(conn.queued_snapshots(), [0]);
    assert!(matches!(&conn.state.books[&0], Seed::Waiting(held) if held.len() == 1));
}

// venue frames

#[test]
fn logs_an_error_frame_at_error_with_its_code_and_message() {
    let (logs, _capture) = capture();
    let mut conn = seeded();

    // As the venue answered depth.100ms.BTC_USDC_PERP on 2026-10-09.
    send(&mut conn, json!({ "id": null, "error": { "code": 4008, "message": "Invalid depth window" } }));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "backpack#perp#0");
    assert_eq!(errors[0].text("code"), "4008");
    assert_eq!(errors[0].text("message"), "Invalid depth window");
}

// On 2026-10-09 depth.NOPE_USDC_PERP and depth.5.BTC_USDC_PERP each got this reply, with no id, and a frame that also named LINK got no LINK frames.
#[test]
fn logs_the_refusal_of_an_unknown_symbol_and_keeps_the_other_books() {
    let (logs, _capture) = capture();
    let mut conn = seeded();

    let published = send(&mut conn, json!({ "id": null, "error": { "code": 4014, "message": "Invalid symbol" } }));

    assert!(published.is_empty());
    assert!(!conn.resync_requested());
    let errors = logs.events("venue_error");
    assert_eq!(errors[0].text("code"), "4014");
    assert_eq!(errors[0].text("message"), "Invalid symbol");
    assert_eq!(send(&mut conn, shib_first()).len(), 1);
}

#[test]
fn logs_a_frame_of_another_shape_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = seeded();

    send(&mut conn, json!({ "result": null, "id": 1 }));

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].level, Level::WARN);
}

#[test]
fn fails_a_frame_that_is_not_json() {
    let mut conn = seeded();

    assert!(venue().handle(b"not json", &mut conn).is_err());
}

// Writes the socket frames and REST books the feed tests are built from, one per line:
// BACKPACK_CAPTURE=/tmp/backpack.txt cargo test backpack::tests::capture_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_frames() {
    use crate::clock::now_ms;
    use futures_util::{SinkExt, StreamExt};
    use std::io::Write;

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let path = std::env::var("BACKPACK_CAPTURE").unwrap_or_else(|_| "/tmp/backpack.txt".to_string());
    let mut log = std::fs::File::create(path).unwrap();
    let list = std::env::var("CAPTURE_MARKETS").unwrap_or_else(|_| "LINK_USDC_PERP,kSHIB_USDC_PERP,AAPL.US_USDC_PERP".to_string());
    let symbols: Vec<&str> = list.split(',').collect();
    let http = reqwest::Client::builder().user_agent("arbitrage-observatory").build().unwrap();
    let (mut ws, _) = tokio_tungstenite::connect_async(URL).await.unwrap();

    let markets: Vec<Market> = symbols.iter().map(|symbol| crate::venues::testing::market(ID, symbol, symbol, "USDC", true)).collect();
    for frame in Backpack::new().subscribe_frames(&markets, &mut State::default()) {
        ws.send(frame).await.unwrap();
    }
    // A refused depth window and an unknown stream type, for the error shapes, with an id the reply may echo.
    for stream in ["depth.100ms.BTC_USDC_PERP", "nope.BTC_USDC_PERP"] {
        let frame = serde_json::json!({ "method": "SUBSCRIBE", "params": [stream], "id": 7 });
        ws.send(Message::text(frame.to_string())).await.unwrap();
    }
    ws.send(Message::Ping(Default::default())).await.unwrap();

    let seconds: u64 = std::env::var("CAPTURE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(20);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    let mut snap = tokio::time::interval(Duration::from_secs(5));
    snap.tick().await;
    loop {
        tokio::select! {
            _ = tokio::time::sleep_until(deadline) => break,
            _ = snap.tick() => {
                for symbol in &symbols {
                    let url = format!("{REST}{DEPTH_PATH}?symbol={symbol}&limit=5");
                    let body = http.get(&url).send().await.unwrap().text().await.unwrap();
                    writeln!(log, "rest {} {symbol} {body}", now_ms()).unwrap();
                }
            }
            message = ws.next() => match message {
                Some(Ok(Message::Text(text))) => writeln!(log, "ws {} {}", now_ms(), text.as_str()).unwrap(),
                other => writeln!(log, "socket {} {other:?}", now_ms()).unwrap(),
            },
        }
    }
}
