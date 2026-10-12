// The engine's received levels are read through Connection::take_published after each frame or snapshot.
// Frames and replies were captured live on 2026-10-09 at 19:43 UTC with the ignored case at the end, and cut to three levels.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

const KNC: &str = "KNC_USDT";
const KNC_VERSION: i64 = 43561779; // the push and the REST book read at the same moment carried this one version
const KNC_BIDS: &[[f64; 3]] = &[[0.1354, 65435.0, 1.0], [0.1353, 49445.0, 1.0], [0.1352, 58210.0, 1.0]];
const KNC_ASKS: &[[f64; 3]] = &[[0.1356, 153488.0, 1.0], [0.1357, 65217.0, 1.0], [0.1358, 50589.0, 1.0]];

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.split('_').next().unwrap();
    Market {
        contract_size: 1.0,
        taker_ppm: 600,
        ..testing::market(ID, raw_market_id, base, "USDT", true)
    }
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}_USDT")));
    }
    markets
}

fn venue() -> Biconomy {
    Biconomy::with_rest("https://openapi.biconomy.com")
}

fn connection(ids: &[&str]) -> Connection<State> {
    Connection::for_test("biconomy#swap#0", ids.iter().map(|id| market(id)).collect())
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

fn knc_bids() -> Vec<BookLevel> {
    levels(&[(0.1354, 65435.0), (0.1353, 49445.0), (0.1352, 58210.0)])
}

fn knc_asks() -> Vec<BookLevel> {
    levels(&[(0.1356, 153488.0), (0.1357, 65217.0), (0.1358, 50589.0)])
}

fn push(symbol: &str, version: i64, bids: &[[f64; 3]], asks: &[[f64; 3]]) -> Value {
    json!({
        "data": { "asks": asks, "bids": bids, "version": version },
        "channel": "push.depth.full",
        "ts": 1791575025778_i64,
        "s": symbol,
    })
}

fn rest_book(version: i64, bids: &[[f64; 3]], asks: &[[f64; 3]]) -> Value {
    json!({ "success": true, "code": 0, "data": { "asks": asks, "bids": bids, "version": version, "timestamp": 1791575025590_i64 } })
}

fn send_bytes(conn: &mut Connection<State>, frame: &[u8]) -> Published {
    venue().handle(frame, conn).unwrap();
    conn.take_published()
}

fn send(conn: &mut Connection<State>, frame: Value) -> Published {
    send_bytes(conn, frame.to_string().as_bytes())
}

fn snapshot(conn: &mut Connection<State>, position: usize, body: Value) -> Published {
    venue().handle_snapshot(position, body.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn pong() -> &'static [u8] {
    br#"{"channel":"pong","data":1791575015552,"ts":1791575015552}"#
}

// The connection's first frame arrived SEED_AFTER_MS before the next one, as for_test stamps every frame at 1.
fn past_the_seed_wait(conn: &mut Connection<State>) {
    conn.state.first_frame_at = Some(1 - SEED_AFTER_MS);
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// plan

#[test]
fn puts_150_contracts_on_each_connection_to_the_one_public_socket() {
    let plans = venue().plan(&markets(316));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["biconomy#swap#0", "biconomy#swap#1", "biconomy#swap#2"]);
    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [150, 150, 16]);
    assert!(plans.iter().all(|plan| plan.url == "wss://openapi.biconomy.com/future/websocket"));
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// settings, subscribe_frames and ping

#[test]
fn sends_one_full_depth_frame_of_20_levels_per_contract_in_one_burst() {
    let frames = venue().subscribe_frames(&markets(150), &mut State::default());

    assert_eq!(frames.len(), 150);
    assert_eq!(
        parsed(&frames[0]),
        json!({ "method": "subscribe.depth.full", "params": { "symbol": "SYM0_USDT", "limit": 20 } })
    );
    assert_eq!(venue().settings().subscribe_gap, Duration::ZERO);
}

#[test]
fn pings_every_15_seconds_and_reads_45_seconds_of_silence_as_dead() {
    let settings = venue().settings();

    assert_eq!(parsed(&venue().ping(&mut State::default())), json!({ "method": "ping" }));
    assert_eq!(settings.ping_every, Some(Duration::from_secs(15)));
    assert_eq!(settings.max_silence, Duration::from_secs(45));
}

#[test]
fn paces_rest_seeds_250_ms_apart_and_waits_for_them_before_calling_a_book_unserved() {
    let settings = venue().settings();

    assert_eq!(settings.snapshot_gap, Duration::from_millis(250));
    assert!(settings.first_book_wait >= Duration::from_millis(SEED_AFTER_MS as u64) + settings.snapshot_gap * 40);
}

// handle

#[test]
fn hands_the_engine_a_full_depth_push_as_the_whole_book() {
    let mut conn = connection(&[KNC]);

    let published = send(&mut conn, push(KNC, KNC_VERSION, KNC_BIDS, KNC_ASKS));

    assert_eq!(published, [(KNC.to_string(), knc_bids(), knc_asks())]);
}

#[test]
fn replaces_the_book_on_every_push_so_a_level_missing_from_the_next_push_is_gone() {
    let mut conn = connection(&[KNC]);
    send(&mut conn, push(KNC, KNC_VERSION, KNC_BIDS, KNC_ASKS));

    let published = send(&mut conn, push(KNC, KNC_VERSION + 4, &[[0.1355, 12.0, 1.0]], &[[0.1357, 300.0, 1.0]]));

    assert_eq!(published, [(KNC.to_string(), levels(&[(0.1355, 12.0)]), levels(&[(0.1357, 300.0)]))]);
}

#[test]
fn drops_a_push_that_repeats_the_last_version() {
    let mut conn = connection(&[KNC]);
    send(&mut conn, push(KNC, KNC_VERSION, KNC_BIDS, KNC_ASKS));

    let same = send(&mut conn, push(KNC, KNC_VERSION, &[[0.13, 1.0, 1.0]], &[[0.14, 1.0, 1.0]]));

    assert!(same.is_empty());
    assert!(!conn.resync_requested());
}

// Dropping it and every push after it would leave the book frozen while it is still published.
#[test]
fn resyncs_on_a_push_whose_version_went_back() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[KNC]);
    send(&mut conn, push(KNC, KNC_VERSION, KNC_BIDS, KNC_ASKS));

    let older = send(&mut conn, push(KNC, KNC_VERSION - 1, &[[0.13, 1.0, 1.0]], &[[0.14, 1.0, 1.0]]));

    assert!(older.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "version_went_back");
}

#[test]
fn resyncs_on_a_push_missing_a_side_instead_of_publishing_it_one_sided() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[KNC]);
    send(&mut conn, push(KNC, KNC_VERSION, KNC_BIDS, KNC_ASKS));

    let frame = json!({ "data": { "asks": KNC_ASKS, "version": KNC_VERSION + 1 }, "channel": "push.depth.full", "s": KNC });
    let error = venue().handle(frame.to_string().as_bytes(), &mut conn).unwrap_err();

    assert!(error.to_string().contains("missing field `bids`"), "{error:#}");
    assert!(conn.take_published().is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "unreadable_push");
}

#[test]
fn resyncs_on_a_push_whose_level_cannot_be_read() {
    let mut conn = connection(&[KNC]);

    let error = venue()
        .handle(br#"{"data":{"asks":[[0.1356]],"bids":[],"version":43561780},"channel":"push.depth.full","s":"KNC_USDT"}"#, &mut conn)
        .unwrap_err();

    assert!(error.to_string().contains("invalid length"), "{error:#}");
    assert!(conn.take_published().is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn fails_a_push_without_a_symbol_and_keeps_the_connection() {
    let mut conn = connection(&[KNC]);

    let frame = json!({ "data": { "asks": KNC_ASKS, "bids": KNC_BIDS, "version": KNC_VERSION }, "channel": "push.depth.full" });
    let error = venue().handle(frame.to_string().as_bytes(), &mut conn).unwrap_err();

    assert!(error.to_string().contains("push without a symbol"), "{error:#}");
    assert!(conn.take_published().is_empty());
    assert!(!conn.resync_requested());
}

// When only deeper levels change, the venue resends an identical top 20 under a new version.
#[test]
fn applies_an_unchanged_top_that_arrives_with_a_higher_version() {
    let mut conn = connection(&[KNC]);
    send(&mut conn, push(KNC, KNC_VERSION, KNC_BIDS, KNC_ASKS));

    let published = send(&mut conn, push(KNC, KNC_VERSION + 1, KNC_BIDS, KNC_ASKS));

    assert_eq!(published.len(), 1);
}

// A fresh connection holds fresh state, which is how the runtime opens every reconnect.
#[test]
fn takes_any_version_for_the_first_push_after_the_connection_closed() {
    let mut first = connection(&[KNC]);
    send(&mut first, push(KNC, KNC_VERSION, KNC_BIDS, KNC_ASKS));

    let mut reopened = connection(&[KNC]);
    let lower = send(&mut reopened, push(KNC, 7, KNC_BIDS, KNC_ASKS));

    assert_eq!(lower.len(), 1);
    assert!(!reopened.resync_requested());
}

#[test]
fn reads_a_price_sent_in_exponent_form() {
    let mut conn = connection(&["BTC_USDT"]);

    let published = send_bytes(
        &mut conn,
        br#"{"data":{"asks":[[82373.9,20145,1]],"bids":[[8.23738E+4,34638,1]],"version":10981199650},"channel":"push.depth.full","ts":1791575015459,"s":"BTC_USDT"}"#,
    );

    assert_eq!(published, [("BTC_USDT".to_string(), levels(&[(82373.8, 34638.0)]), levels(&[(82373.9, 20145.0)]))]);
}

#[test]
fn drops_a_contract_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[KNC]);

    let first = send(&mut conn, push("ETH_USDT", 1, KNC_BIDS, KNC_ASKS));
    let second = send(&mut conn, push("ETH_USDT", 2, KNC_BIDS, KNC_ASKS));

    assert!(first.is_empty() && second.is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

#[test]
fn logs_each_error_frame_and_stays_silent_on_the_acknowledgement_the_pong_and_the_client_id() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[KNC]);

    send_bytes(&mut conn, br#"{"channel":"response.subscribe.depth.full","data":"success","ts":1791575015548}"#);
    send_bytes(&mut conn, pong());
    send_bytes(
        &mut conn,
        br#"{"channel":"clientId","data":"223006fffe11c3c3-00000001-006e4204-b537da10951ccb15-2375d86c","ts":1791575015552}"#,
    );
    send_bytes(&mut conn, br#"{"channel":"response.error","data":"Contract [NOPE_USDT] not exists","ts":1791575015552}"#);
    let published = send_bytes(&mut conn, br#"{"channel":"response.error","data":"Not support limit","ts":1791575015552}"#);

    assert!(published.is_empty());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("message"), "Contract [NOPE_USDT] not exists");
    assert_eq!(errors[1].text("message"), "Not support limit");
    assert!(logs.events("venue_notice").is_empty());
}

#[test]
fn logs_a_frame_on_an_unknown_channel_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[KNC]);

    send_bytes(&mut conn, br#"{"channel":"push.index.price","data":{"price":0.1355,"symbol":"KNC_USDT"},"symbol":"KNC_USDT","ts":1791575015552}"#);

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].level, Level::WARN);
}

#[test]
fn fails_a_frame_that_is_not_json_and_keeps_reading() {
    let mut conn = connection(&[KNC]);

    assert!(venue().handle(b"not json", &mut conn).is_err());
    assert_eq!(send(&mut conn, push(KNC, KNC_VERSION, KNC_BIDS, KNC_ASKS)).len(), 1);
}

// seeding the quiet books from REST

#[test]
fn asks_for_no_snapshot_before_the_seed_wait_has_passed() {
    let mut conn = connection(&[KNC, "BTC_USDT"]);

    send_bytes(&mut conn, pong());
    send_bytes(&mut conn, pong());

    assert!(conn.queued_snapshots().is_empty());
}

#[test]
fn asks_once_for_the_snapshot_of_every_book_still_empty_after_the_seed_wait() {
    let (logs, _capture) = capture();
    let mut conn = connection(&[KNC, "BTC_USDT", "NATGAS_USDT"]);
    send(&mut conn, push("BTC_USDT", 10981199650, KNC_BIDS, KNC_ASKS));
    past_the_seed_wait(&mut conn);

    send_bytes(&mut conn, pong());
    send_bytes(&mut conn, pong());

    assert_eq!(conn.queued_snapshots(), [0, 2]);
    let seeding = logs.events("book_seeding");
    assert_eq!(seeding.len(), 1);
    assert_eq!(seeding[0].number("requested"), 2.0);
    assert_eq!(seeding[0].number("markets"), 3.0);
}

#[test]
fn counts_the_seed_wait_from_the_first_frame_on_the_connection() {
    let mut conn = connection(&[KNC]);

    send_bytes(&mut conn, pong());

    assert_eq!(conn.state.first_frame_at, Some(1));
    assert!(!conn.state.seeded);
}

#[test]
fn builds_the_snapshot_url_for_the_rest_book_of_20_levels() {
    let url = venue().snapshot_url(&market(KNC)).unwrap();

    assert_eq!(url, "https://openapi.biconomy.com/future/api/v1/depth/KNC_USDT?limit=20");
}

#[test]
fn seeds_a_quiet_book_from_the_rest_snapshot() {
    let mut conn = connection(&[KNC]);

    let published = snapshot(&mut conn, 0, rest_book(KNC_VERSION, KNC_BIDS, KNC_ASKS));

    assert_eq!(published, [(KNC.to_string(), knc_bids(), knc_asks())]);
}

#[test]
fn drops_a_snapshot_no_newer_than_the_push_already_applied() {
    let mut conn = connection(&[KNC]);
    send(&mut conn, push(KNC, KNC_VERSION, KNC_BIDS, KNC_ASKS));

    let same = snapshot(&mut conn, 0, rest_book(KNC_VERSION, &[[0.13, 1.0, 1.0]], &[[0.14, 1.0, 1.0]]));
    let older = snapshot(&mut conn, 0, rest_book(KNC_VERSION - 9, &[[0.13, 1.0, 1.0]], &[[0.14, 1.0, 1.0]]));

    assert!(same.is_empty() && older.is_empty());
}

#[test]
fn takes_a_newer_snapshot_and_then_drops_a_push_older_than_it() {
    let mut conn = connection(&[KNC]);
    send(&mut conn, push(KNC, KNC_VERSION - 5, &[[0.13, 1.0, 1.0]], &[[0.14, 1.0, 1.0]]));

    let seeded = snapshot(&mut conn, 0, rest_book(KNC_VERSION, KNC_BIDS, KNC_ASKS));
    let late = send(&mut conn, push(KNC, KNC_VERSION - 2, &[[0.13, 1.0, 1.0]], &[[0.14, 1.0, 1.0]]));
    let next = send(&mut conn, push(KNC, KNC_VERSION + 1, KNC_BIDS, KNC_ASKS));

    assert_eq!(seeded, [(KNC.to_string(), knc_bids(), knc_asks())]);
    assert!(late.is_empty());
    assert_eq!(next.len(), 1);
    assert!(!conn.resync_requested(), "a push older than the REST read but newer than the last push is no restart");
}

#[test]
fn fails_a_rest_book_without_a_version_and_leaves_the_book_alone() {
    let mut conn = connection(&[KNC]);

    let body = json!({ "success": true, "code": 0, "data": { "asks": KNC_ASKS, "bids": KNC_BIDS, "timestamp": 1791575025590_i64 } });
    let error = venue().handle_snapshot(0, body.to_string().as_bytes(), &mut conn).unwrap_err();

    assert!(error.to_string().contains("missing field `version`"), "{error:#}");
    assert!(conn.take_published().is_empty());
}

// A delisted contract's REST book reads this way, and an active one with no orders would too.
#[test]
fn publishes_an_empty_rest_book_as_an_empty_book() {
    let mut conn = connection(&[KNC]);

    let published = snapshot(&mut conn, 0, json!({ "success": true, "code": 0, "data": { "asks": [], "bids": [], "version": 0, "timestamp": 1791574616849_i64 } }));

    assert_eq!(published, [(KNC.to_string(), Vec::new(), Vec::new())]);
}

#[test]
fn fails_a_snapshot_reply_whose_success_is_false_and_leaves_the_book_alone() {
    let mut conn = connection(&[KNC]);

    let error = venue()
        .handle_snapshot(0, br#"{"success":false,"code":1001,"message":"Contract does not exist!"}"#, &mut conn)
        .unwrap_err();

    assert!(error.to_string().contains("depth code 1001: Contract does not exist!"), "{error:#}");
    assert!(conn.take_published().is_empty());
}

// Prints the replies to the frames the cases below use, which is how they were captured.
// cargo test biconomy::tests::prints_the_live_frames_the_cases_use -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn prints_the_live_frames_the_cases_use() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(PUBLIC_URL).await.unwrap();
    let frames = [
        r#"{"method":"subscribe.depth.full","params":{"symbol":"BTC_USDT","limit":20}}"#,
        r#"{"method":"subscribe.depth.full","params":{"symbol":"KNC_USDT","limit":20}}"#,
        r#"{"method":"subscribe.depth.full","params":{"symbol":"NOPE_USDT","limit":20}}"#,
        r#"{"method":"subscribe.depth.full","params":{"symbol":"ETH_USDT","limit":30}}"#,
        r#"{"method":"subscribe.depth.full","params":{"symbol":"LRC_USDT","limit":20}}"#,
        r#"{"method":"ping"}"#,
    ];
    for frame in frames {
        ws.send(Message::text(frame)).await.unwrap();
    }

    let deadline = tokio::time::Instant::now() + Duration::from_secs(12);
    let mut pushes: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            println!("{message:?}");
            continue;
        };
        let text = text.as_str();
        if !text.contains("push.depth.full") {
            println!("{text}");
            continue;
        }
        // Each push once per symbol in full and then only its version and envelope, since a top 20 is long.
        let symbol = text.rsplit("\"s\":\"").next().unwrap_or_default().to_string();
        let seen = pushes.entry(symbol).or_default();
        *seen += 1;
        if *seen == 1 {
            println!("{text}");
        } else if *seen <= 4 {
            println!("{}", &text[text.find("\"version\"").unwrap_or(0)..]);
        }
    }
}
