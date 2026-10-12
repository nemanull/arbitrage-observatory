// The engine's received levels are read through Connection::take_published after each frame or snapshot.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level as LogLevel;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

const BTC: &str = "BTCUSDT";

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.strip_suffix("USDT").unwrap();
    Market {
        taker_ppm: 600,
        ..testing::market(ID, raw_market_id, base, "USDT", true)
    }
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}USDT")));
    }
    markets
}

fn venue() -> TrubitPro {
    TrubitPro::new(&[])
}

fn connection(ids: &[&str]) -> Connection<State> {
    Connection::for_test("trubitpro#perp#0", ids.iter().map(|id| market(id)).collect())
}

// A level of qty USDT at price holds qty / price coins.
fn coins(levels: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut coins = Vec::with_capacity(levels.len());
    for &(price, qty) in levels {
        coins.push(BookLevel { price, size: qty / price });
    }
    coins
}

fn text(frame: &Message) -> String {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    text.as_str().to_string()
}

fn send(conn: &mut Connection<State>, frame: Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn snapshot(conn: &mut Connection<State>, position: usize, body: Value) -> Published {
    venue().handle_snapshot(position, body.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

// The acknowledgement of a subscribe, as the venue answered on 2026-10-09.
fn ack(symbol: &str) -> Value {
    json!({ "agent": null, "clazz": "DepthUpdateEvent", "key": null, "subKey": symbol, "success": true, "user": null })
}

fn level(price: f64, qty: f64, count: u32) -> Value {
    json!({ "count": count, "iceCount": 0, "price": price, "qty": qty })
}

// The BTCUSDT depth reply of 2026-10-09 at 20:12:45 UTC, cut to three levels a side.
fn btc_snapshot() -> Value {
    json!({ "code": 0, "message": "OK", "result": {
        "buyDepth": [level(82366.2, 16897.0, 4), level(82366.1, 17855.0, 6), level(82366.0, 17691.0, 6)],
        "sellDepth": [level(82366.3, 17222.0, 5), level(82366.4, 14427.0, 3), level(82366.5, 17310.0, 6)],
        "trades": null,
    }})
}

fn btc_seed_book() -> (Vec<BookLevel>, Vec<BookLevel>) {
    (
        coins(&[(82366.2, 16897.0), (82366.1, 17855.0), (82366.0, 17691.0)]),
        coins(&[(82366.3, 17222.0), (82366.4, 14427.0), (82366.5, 17310.0)]),
    )
}

// The first BTCUSDT frame after that reply, 477 ms later, which deletes the seed's best bid, with its trades cut to one.
fn btc_frame() -> Value {
    json!({
        "buyDepth": [level(82366.1, 12783.0, 5), level(82365.8, 18275.0, 5), level(82364.2, 92780.0, 5), level(82366.2, 0.0, 0)],
        "key": BTC,
        "sellDepth": [level(82366.4, 18898.0, 4)],
        "trades": [{
            "buyActive": false, "id": "1791576765606000032", "price": 82366.1, "qty": 2564.0, "symbol": BTC,
            "timestamp": "Oct 09, 2026 08:12:45 PM", "tms": "1791576765606",
        }],
    })
}

// A later frame of the same capture, which changes one level a side.
fn btc_quiet_frame() -> Value {
    json!({ "buyDepth": [level(82366.2, 12092.0, 3)], "key": BTC, "sellDepth": [level(82366.3, 15659.0, 5)], "trades": [] })
}

// A BTC connection whose snapshot fetch has started, so the runtime has taken it off the queue, as a request made now shows.
fn waiting() -> Connection<State> {
    let mut conn = connection(&[BTC]);
    conn.state.seeds.insert(0, Seed::Waiting);
    conn
}

// A BTC connection seeded from the snapshot, with nothing published or queued.
fn seeded() -> Connection<State> {
    let mut conn = waiting();
    snapshot(&mut conn, 0, btc_snapshot());
    conn
}

// settings and plan

#[test]
fn puts_up_to_50_markets_on_each_connection_to_the_market_socket() {
    let plans = venue().plan(&markets(60));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [50, 10]);
    assert_eq!(plans[0].id, "trubitpro#perp#0");
    assert_eq!(plans[1].id, "trubitpro#perp#1");
    assert_eq!(plans[0].url, "wss://api-futures.trubit.com/ws/market");
}

#[test]
fn pings_every_5_seconds_reads_15_seconds_of_silence_as_dead_and_seeds_50_markets_within_the_first_book_wait() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(5)));
    assert_eq!(settings.max_silence, Duration::from_secs(15));
    assert_eq!(settings.snapshot_gap, Duration::from_millis(200));
    assert!(settings.first_book_wait > settings.snapshot_gap * MARKETS_PER_CONNECTION as u32);
}

// subscribe_frames and ping

#[test]
fn subscribes_one_market_per_frame_on_the_depth_update_channel() {
    let frames = venue().subscribe_frames(&markets(3), &mut State::default());

    assert_eq!(frames.len(), 3);
    let first: Value = serde_json::from_str(&text(&frames[0])).unwrap();
    assert_eq!(first, json!({ "op": "subscribe", "key": "SYM0USDT", "channel": "depthUpdate" }));
    assert!(text(&frames[2]).contains("SYM2USDT"));
}

#[test]
fn pings_with_the_bare_text_ping() {
    assert_eq!(text(&venue().ping(&mut State::default())), "ping");
}

// acknowledgement and seeding

#[test]
fn asks_for_the_snapshot_of_each_acknowledged_market_once() {
    let mut conn = connection(&["ETHUSDT", BTC]);

    send(&mut conn, ack(BTC));
    send(&mut conn, ack("ETHUSDT"));
    send(&mut conn, ack(BTC));

    assert_eq!(conn.queued_snapshots(), [1, 0]);
    assert_eq!(conn.state.seeds[&1], Seed::Waiting);
}

#[test]
fn reads_the_snapshot_from_the_top_20_depth_call() {
    assert_eq!(
        venue().snapshot_url(&market(BTC)).unwrap(),
        "https://api-futures.trubit.com/market/api/v1/depth/list?symbol=BTCUSDT&level=20"
    );
}

#[test]
fn drops_frames_until_the_snapshot_then_publishes_the_seed_with_sizes_in_coins() {
    let mut conn = waiting();

    assert!(send(&mut conn, btc_frame()).is_empty());
    let published = snapshot(&mut conn, 0, btc_snapshot());

    let (bids, asks) = btc_seed_book();
    assert_eq!(published, [(BTC.to_string(), bids, asks)]);
    assert!(conn.queued_snapshots().is_empty());
    assert_eq!(conn.state.seeds[&0], Seed::Live { seeded_at: 1 });
}

#[test]
fn applies_a_frame_by_price_where_a_zero_qty_deletes_the_level() {
    let mut conn = seeded();

    let published = send(&mut conn, btc_frame());

    let bids = coins(&[(82366.1, 12783.0), (82366.0, 17691.0), (82365.8, 18275.0), (82364.2, 92780.0)]);
    let asks = coins(&[(82366.3, 17222.0), (82366.4, 18898.0), (82366.5, 17310.0)]);
    assert_eq!(published, [(BTC.to_string(), bids, asks)]);
}

#[test]
fn a_frame_with_empty_sides_changes_nothing_and_still_publishes() {
    let mut conn = seeded();

    let published = send(&mut conn, json!({ "buyDepth": [], "key": BTC, "sellDepth": [], "trades": [] }));

    let (bids, asks) = btc_seed_book();
    assert_eq!(published, [(BTC.to_string(), bids, asks)]);
}

#[test]
fn asks_for_a_snapshot_on_a_frame_ahead_of_the_acknowledgement() {
    let mut conn = connection(&[BTC]);

    assert!(send(&mut conn, btc_frame()).is_empty());

    assert_eq!(conn.queued_snapshots(), [0]);
    assert_eq!(conn.state.seeds[&0], Seed::Waiting);
}

#[test]
fn asks_for_a_fresh_snapshot_on_the_first_frame_a_minute_after_the_seed_and_keeps_publishing() {
    let mut conn = seeded();
    send(&mut conn, btc_quiet_frame());
    assert!(conn.queued_snapshots().is_empty());

    conn.state.seeds.insert(0, Seed::Live { seeded_at: 1 - RESEED_EVERY_MS });
    let published = send(&mut conn, btc_frame());

    assert_eq!(published.len(), 1);
    assert_eq!(conn.queued_snapshots(), [0]);
}

#[test]
fn a_fresh_snapshot_replaces_the_live_book() {
    let mut conn = seeded();
    send(&mut conn, btc_frame());
    conn.state.seeds.insert(0, Seed::Live { seeded_at: 1 - RESEED_EVERY_MS });

    let published = snapshot(&mut conn, 0, btc_snapshot());

    let (bids, asks) = btc_seed_book();
    assert_eq!(published, [(BTC.to_string(), bids, asks)]);
    assert_eq!(conn.state.seeds[&0], Seed::Live { seeded_at: 1 });
}

// what a lost frame looks like

#[test]
fn empties_a_crossed_book_and_seeds_that_market_again() {
    let (logs, _capture) = capture();
    let mut conn = seeded();
    let mut crossed = btc_quiet_frame();
    crossed["buyDepth"] = json!([level(82366.4, 5000.0, 1)]);
    crossed["sellDepth"] = json!([]);

    let published = send(&mut conn, crossed);

    assert_eq!(published, [(BTC.to_string(), vec![], vec![])]);
    assert_eq!(conn.queued_snapshots(), [0]);
    assert_eq!(conn.state.seeds[&0], Seed::Waiting);
    assert!(!conn.resync_requested());
    let line = &logs.events("book_reseed")[0];
    assert_eq!(line.level, LogLevel::WARN);
    assert_eq!(line.text("reason"), "crossed_book");
}

#[test]
fn drops_frames_after_a_reseed_until_its_snapshot_arrives() {
    let mut conn = seeded();
    let mut crossed = btc_quiet_frame();
    crossed["buyDepth"] = json!([level(82366.4, 5000.0, 1)]);
    send(&mut conn, crossed);

    assert!(send(&mut conn, btc_quiet_frame()).is_empty());
    let published = snapshot(&mut conn, 0, btc_snapshot());

    assert_eq!(published.len(), 1);
    assert_eq!(published[0].1, btc_seed_book().0);
}

#[test]
fn empties_a_book_whose_frame_holds_a_level_it_cannot_read_and_seeds_it_again() {
    let (logs, _capture) = capture();
    let mut conn = seeded();
    let mut broken = btc_quiet_frame();
    broken["sellDepth"] = json!([{ "count": 1, "iceCount": 0, "price": "x", "qty": 10.0 }]);

    let published = send(&mut conn, broken);

    assert_eq!(published, [(BTC.to_string(), vec![], vec![])]);
    assert_eq!(conn.queued_snapshots(), [0]);
    assert_eq!(logs.events("book_reseed")[0].text("reason"), "unreadable_level");
}

// The venue deletes each level that leaves its window, so a 21st bid after the BTC seed of 20 means a lost delete.
#[test]
fn empties_a_book_that_grows_past_the_20_level_window_and_seeds_it_again() {
    let (logs, _capture) = capture();
    let mut conn = waiting();
    let mut deep = btc_snapshot();
    let bids: Vec<Value> = (0..20).map(|i| level(82366.0 - i as f64, 1000.0, 1)).collect();
    deep["result"]["buyDepth"] = json!(bids);
    snapshot(&mut conn, 0, deep);
    let mut inside = btc_quiet_frame();
    inside["buyDepth"] = json!([level(82347.0, 0.0, 0), level(82346.0, 1000.0, 1)]);
    inside["sellDepth"] = json!([]);
    assert_eq!(send(&mut conn, inside)[0].1.len(), 20, "a level that replaces a deleted one stays in the window");

    let mut past = btc_quiet_frame();
    past["buyDepth"] = json!([level(82345.0, 1000.0, 1)]);
    past["sellDepth"] = json!([]);
    let published = send(&mut conn, past);

    assert_eq!(published, [(BTC.to_string(), vec![], vec![])]);
    assert_eq!(conn.queued_snapshots(), [0]);
    assert_eq!(logs.events("book_reseed")[0].text("reason"), "deeper_than_window");
}

#[test]
fn empties_the_book_a_frame_that_does_not_parse_names_and_seeds_it_again() {
    let (logs, _capture) = capture();
    let mut conn = seeded();
    let mut broken = btc_quiet_frame();
    broken["buyDepth"] = json!({ "price": 82366.2 });

    assert!(venue().handle(broken.to_string().as_bytes(), &mut conn).is_err());

    assert_eq!(conn.take_published(), [(BTC.to_string(), vec![], vec![])]);
    assert_eq!(conn.queued_snapshots(), [0]);
    assert!(!conn.resync_requested());
    assert_eq!(logs.events("book_reseed")[0].text("reason"), "book_frame_unreadable");
}

#[test]
fn resyncs_the_connection_on_a_book_frame_that_names_no_market() {
    let mut conn = seeded();

    assert!(venue().handle(br#"{"buyDepth":[{"price":82366.2,"qty":1"#, &mut conn).is_err());

    assert!(conn.resync_requested());
}

// snapshot replies that carry no usable book

#[test]
fn fetches_again_after_a_reply_with_a_nonzero_code_and_logs_the_first_failure() {
    let (logs, _capture) = capture();
    let mut conn = waiting();

    // The live answer to an unknown symbol on 2026-10-09.
    let published = snapshot(&mut conn, 0, json!({ "code": 24001, "message": "Symbol not found", "result": null }));

    assert!(published.is_empty());
    assert_eq!(conn.queued_snapshots(), [0]);
    assert_eq!(conn.state.seeds[&0], Seed::Waiting);
    let line = &logs.events("snapshot_failed")[0];
    assert!(line.text("error").contains("code 24001: Symbol not found"));
}

#[test]
fn logs_a_run_of_bad_replies_on_the_first_and_every_30th() {
    let (logs, _capture) = capture();
    let mut conn = waiting();

    for _ in 0..30 {
        snapshot(&mut conn, 0, json!({ "code": 1, "msg": "FAILED", "data": null }));
    }

    assert_eq!(logs.events("snapshot_failed").len(), 2);
}

#[test]
fn refuses_a_crossed_snapshot_and_fetches_it_again() {
    let mut conn = waiting();
    let mut crossed = btc_snapshot();
    crossed["result"]["buyDepth"] = json!([level(82366.4, 16897.0, 4)]);

    assert!(snapshot(&mut conn, 0, crossed).is_empty());

    assert_eq!(conn.queued_snapshots(), [0]);
}

#[test]
fn refuses_a_snapshot_with_a_level_it_cannot_read() {
    let mut conn = waiting();
    let mut broken = btc_snapshot();
    broken["result"]["sellDepth"][1]["qty"] = json!(null);

    assert!(snapshot(&mut conn, 0, broken).is_empty());

    assert_eq!(conn.queued_snapshots(), [0]);
}

#[test]
fn a_failed_reseed_leaves_the_live_book_in_place() {
    let mut conn = seeded();

    venue().handle_snapshot(0, b"not json", &mut conn).unwrap();

    assert!(conn.take_published().is_empty());
    assert_eq!(conn.queued_snapshots(), [0]);
    assert_eq!(conn.state.seeds[&0], Seed::Live { seeded_at: 1 });
    assert_eq!(conn.book(0).unwrap().bids(), btc_seed_book().0);
}

// other frames

#[test]
fn ignores_the_pong_and_the_open_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[BTC]);

    venue().handle(b"pong", &mut conn).unwrap();
    send(&mut conn, json!({ "key": null, "message": "On connect", "state": true, "tag": 0 }));

    assert!(logs.lines().iter().all(|line| line.level > LogLevel::INFO));
}

#[test]
fn logs_an_error_frame_and_a_refused_subscribe_as_venue_errors() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[BTC]);

    // The answer to {"op":"ping"} on 2026-10-09.
    send(&mut conn, json!({ "errMsg": "failed to deSerialize" }));
    send(&mut conn, json!({ "success": false, "subKey": BTC }));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].level, LogLevel::ERROR);
    assert_eq!(errors[0].text("message"), "failed to deSerialize");
    assert!(conn.queued_snapshots().is_empty());
}

#[test]
fn logs_a_frame_of_unknown_shape_as_a_venue_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[BTC]);

    send(&mut conn, json!({ "event": "openInterest", "key": BTC, "value": 435.07 }));

    assert_eq!(logs.events("venue_notice").len(), 1);
}

#[test]
fn drops_a_frame_and_an_acknowledgement_for_a_symbol_it_did_not_subscribe() {
    let (logs, _capture) = capture();
    let mut conn = seeded();
    let mut other = btc_frame();
    other["key"] = json!("NOPEUSDT");

    assert!(send(&mut conn, other).is_empty());
    send(&mut conn, ack("NOPEUSDT"));

    assert!(conn.queued_snapshots().is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

#[test]
fn fails_a_frame_that_is_not_json() {
    let mut conn = connection(&[BTC]);

    assert!(venue().handle(b"not json", &mut conn).is_err());
    assert!(!conn.resync_requested());
}

// A probe of the live socket, which prints every frame but the book frames after the second of each market, with the trades cut to their count:
// cargo test trubitpro::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(URL).await.unwrap();
    let list = std::env::var("CAPTURE_MARKETS").unwrap_or_else(|_| "BTCUSDT,MASKUSDT,NOPEUSDT".to_string());
    let seconds: u64 = std::env::var("CAPTURE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(4);
    let every = std::env::var("CAPTURE_EVERY").is_ok(); // print every book frame, whole
    for symbol in list.split(',') {
        ws.send(Message::text(json!({ "op": "subscribe", "key": symbol, "channel": CHANNEL }).to_string())).await.unwrap();
    }
    ws.send(Message::text("ping")).await.unwrap();
    ws.send(Message::text(json!({ "op": "ping" }).to_string())).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    let mut seen: HashMap<String, usize> = HashMap::new();
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let Ok(mut value) = serde_json::from_str::<Value>(text.as_str()) else {
            println!("text {}", text.as_str());
            continue;
        };
        if value["buyDepth"].is_array() {
            let count = seen.entry(value["key"].to_string()).or_default();
            *count += 1;
            if every {
                println!("{} {value}", crate::clock::now_ms());
                continue;
            }
            if *count > 2 {
                continue;
            }
            if let Some(trades) = value["trades"].as_array() {
                value["trades"] = json!(trades.len());
            }
        }
        println!("{} {value}", crate::clock::now_ms());
    }
    println!("book frames by market {seen:?}");
}
