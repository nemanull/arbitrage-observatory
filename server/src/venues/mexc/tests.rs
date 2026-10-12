// Ported case for case from old_ts_server/src/venues/mexc/mexc.spec.ts.
// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

const RIF_BIDS: &[[f64; 3]] = &[[0.08049, 46.0, 1.0], [0.08048, 489.0, 1.0], [0.08047, 420.0, 1.0]];
const RIF_ASKS: &[[f64; 3]] = &[[0.08055, 48.0, 1.0], [0.08056, 347.0, 1.0], [0.08057, 149.0, 1.0]];

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.split('_').next().unwrap();
    Market {
        contract_size: 0.0001,
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

fn venue() -> Mexc {
    Mexc::new()
}

fn connection(raw_market_id: &str) -> Connection<State> {
    Connection::for_test("mexc#swap#0", vec![market(raw_market_id)])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// The shape captured live on 2026-09-15, with the level count cut down.
fn full_frame(symbol: &str, version: i64, bids: &[[f64; 3]], asks: &[[f64; 3]]) -> Value {
    json!({
        "symbol": symbol,
        "data": { "cts": 1789498322165_i64, "asks": asks, "bids": bids, "version": version },
        "channel": "push.depth.full",
        "ts": 1789498322169_i64,
    })
}

fn send_bytes(conn: &mut Connection<State>, frame: &[u8]) -> Published {
    venue().handle(frame, conn).unwrap();
    conn.take_published()
}

fn send(conn: &mut Connection<State>, frame: Value) -> Published {
    send_bytes(conn, frame.to_string().as_bytes())
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// plan

#[test]
fn puts_150_contracts_on_each_connection_to_the_one_public_endpoint() {
    let plans = venue().plan(&markets(320));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["mexc#swap#0", "mexc#swap#1", "mexc#swap#2"]);
    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [150, 150, 20]);
    assert!(plans.iter().all(|plan| plan.url == "wss://contract.mexc.com/edge"));
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames

#[test]
fn sends_one_full_depth_frame_of_20_levels_per_contract_paced_50_ms_apart() {
    let frames = venue().subscribe_frames(&markets(150), &mut State::default());

    assert_eq!(frames.len(), 150);
    assert_eq!(parsed(&frames[0]), json!({ "method": "sub.depth.full", "param": { "symbol": "SYM0_USDT", "limit": 20 } }));
    assert_eq!(venue().settings().subscribe_gap, Duration::from_millis(50));
    assert_eq!(venue().settings().max_silence, Duration::from_secs(45));
}

// ping, which replaced startKeepalive

#[test]
fn sends_the_application_ping_every_15_seconds() {
    assert_eq!(parsed(&venue().ping(&mut State::default())), json!({ "method": "ping" }));
    assert_eq!(venue().settings().ping_every, Some(Duration::from_secs(15)));
}

// handle

#[test]
fn hands_the_engine_a_full_depth_frame_as_the_whole_book() {
    let mut conn = connection("RIF_USDT");

    let published = send(&mut conn, full_frame("RIF_USDT", 5220571685, RIF_BIDS, RIF_ASKS));

    assert_eq!(
        published,
        [(
            "RIF_USDT".to_string(),
            levels(&[(0.08049, 46.0), (0.08048, 489.0), (0.08047, 420.0)]),
            levels(&[(0.08055, 48.0), (0.08056, 347.0), (0.08057, 149.0)]),
        )]
    );
}

#[test]
fn replaces_the_book_on_every_frame_so_a_level_missing_from_the_next_frame_is_gone() {
    let mut conn = connection("RIF_USDT");
    send(&mut conn, full_frame("RIF_USDT", 5220571685, RIF_BIDS, RIF_ASKS));

    let published = send(&mut conn, full_frame("RIF_USDT", 5220571690, &[[0.0805, 12.0, 1.0]], &[[0.08056, 300.0, 1.0]]));

    assert_eq!(published, [("RIF_USDT".to_string(), levels(&[(0.0805, 12.0)]), levels(&[(0.08056, 300.0)]))]);
}

#[test]
fn drops_a_frame_whose_version_is_below_the_last_one_applied() {
    let mut conn = connection("RIF_USDT");
    send(&mut conn, full_frame("RIF_USDT", 5220571685, RIF_BIDS, RIF_ASKS));

    let published = send(&mut conn, full_frame("RIF_USDT", 5220571684, &[[0.08, 1.0, 1.0]], &[[0.09, 1.0, 1.0]]));

    assert!(published.is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn applies_an_unchanged_top_that_arrives_with_a_higher_version() {
    let mut conn = connection("RIF_USDT");
    send(&mut conn, full_frame("RIF_USDT", 5220571685, RIF_BIDS, RIF_ASKS));

    let published = send(&mut conn, full_frame("RIF_USDT", 5220571686, RIF_BIDS, RIF_ASKS));

    assert_eq!(published.len(), 1);
}

// A fresh connection holds fresh state, which is how the runtime opens every reconnect.
#[test]
fn takes_any_version_for_the_first_frame_after_the_connection_closed() {
    let mut first = connection("RIF_USDT");
    send(&mut first, full_frame("RIF_USDT", 5220571685, RIF_BIDS, RIF_ASKS));

    let mut reopened = connection("RIF_USDT");
    let lower = send(&mut reopened, full_frame("RIF_USDT", 7, RIF_BIDS, RIF_ASKS));
    let older = send(&mut reopened, full_frame("RIF_USDT", 6, RIF_BIDS, RIF_ASKS));

    assert_eq!(lower.len(), 1);
    assert!(older.is_empty());
}

#[test]
fn reads_a_price_sent_in_exponent_form() {
    let mut conn = connection("BTC_USDT");

    let published = send_bytes(
        &mut conn,
        br#"{"symbol":"BTC_USDT","data":{"cts":1789498322165,"asks":[[75481.2,10,1]],"bids":[[7.548E+4,4959,3]],"version":41770922520},"channel":"push.depth.full","ts":1789498322169}"#,
    );

    assert_eq!(published, [("BTC_USDT".to_string(), levels(&[(75480.0, 4959.0)]), levels(&[(75481.2, 10.0)]))]);
}

#[test]
fn drops_a_contract_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = connection("RIF_USDT");

    let first = send(&mut conn, full_frame("ETH_USDT", 1, RIF_BIDS, RIF_ASKS));
    let second = send(&mut conn, full_frame("ETH_USDT", 2, RIF_BIDS, RIF_ASKS));

    assert!(first.is_empty() && second.is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

#[test]
fn logs_an_rs_error_frame_and_stays_silent_on_the_acknowledgement_and_the_pong() {
    let (logs, _capture) = capture();
    let mut conn = connection("RIF_USDT");

    send_bytes(&mut conn, br#"{"channel":"rs.sub.depth.full","data":"success","ts":1789498321789}"#);
    send_bytes(&mut conn, br#"{"channel":"pong","data":1789498336785,"ts":1789498336785}"#);
    let published = send_bytes(&mut conn, br#"{"channel":"rs.error","data":"Contract [NOPE_USDT] not exists","ts":1789498321790}"#);

    assert!(published.is_empty());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("message"), "Contract [NOPE_USDT] not exists");
}

#[test]
fn logs_the_first_binary_frame_drops_every_one_and_keeps_reading_text_frames() {
    let (logs, _capture) = capture();
    let mut conn = connection("RIF_USDT");
    let gzip = [0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00];

    send_bytes(&mut conn, &gzip);
    send_bytes(&mut conn, &gzip);
    let published = send(&mut conn, full_frame("RIF_USDT", 1, RIF_BIDS, RIF_ASKS));

    let warnings = logs.events("binary_frame_dropped");
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].number("bytes"), 6.0);
    assert_eq!(published.len(), 1);
}

// Ourbit and BYDFi, which run this module through their profiles.

fn clone_connection(profile: &Profile, raw_market_id: &str) -> Connection<State> {
    let market = Market {
        contract_size: 0.0001,
        ..testing::market(profile.id, raw_market_id, raw_market_id.split('_').next().unwrap(), "USDT", true)
    };
    Connection::for_test(&format!("{}#swap#0", profile.id), vec![market])
}

fn clone_send(profile: &'static Profile, conn: &mut Connection<State>, frame: &[u8]) -> Published {
    Mexc::for_venue(profile).handle(frame, conn).unwrap();
    conn.take_published()
}

// Captured live on 2026-10-09 from wss://futures.ourbit.com/edge, cut to three levels per side.
const OURBIT_BTC: &[u8] = br#"{"symbol":"BTC_USDT","data":{"asks":[[82474.5,121249,1],[82474.6,35095,1],[82474.7,44467,1]],"bids":[[82474.4,121249,1],[82474.3,96136,4],[82474.2,28217,1]],"version":12678017692},"channel":"push.depth.full","ts":1791574120877}"#;

// Captured live on 2026-10-09 from wss://futures.bydfi.com/edge, cut to three levels per side.
const BYDFI_SOL_USDC: &[u8] = br#"{"symbol":"SOL_USDC","data":{"asks":[[109.12,26735,1],[109.13,53359,1],[109.14,26892,1]],"bids":[[109.11,151911,1],[108.95,25442,1],[108.94,8696,1]],"version":114461355},"channel":"push.depth.full","ts":1791574130992}"#;

#[test]
fn plans_each_clone_on_its_own_socket_host_with_150_contracts_a_connection() {
    let ourbit = Mexc::for_venue(&OURBIT).plan(&markets(160));
    let bydfi = Mexc::for_venue(&BYDFI).plan(&markets(10));

    let ids: Vec<&str> = ourbit.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["ourbit#swap#0", "ourbit#swap#1"]);
    assert_eq!(ourbit[0].markets.len(), 150);
    assert!(ourbit.iter().all(|plan| plan.url == "wss://futures.ourbit.com/edge"));
    assert_eq!(bydfi.len(), 1);
    assert_eq!(bydfi[0].id, "bydfi#swap#0");
    assert_eq!(bydfi[0].url, "wss://futures.bydfi.com/edge");
}

// Limit 20 was acknowledged and limit 30 refused on both clones on 2026-10-09, and both answered the ping with a pong.
#[test]
fn sends_the_clones_the_same_frames_and_ping_as_mexc() {
    for profile in [&OURBIT, &BYDFI] {
        let venue = Mexc::for_venue(profile);
        let frames = venue.subscribe_frames(&[market("BTC_USDT")], &mut State::default());

        assert_eq!(parsed(&frames[0]), json!({ "method": "sub.depth.full", "param": { "symbol": "BTC_USDT", "limit": 20 } }));
        assert_eq!(parsed(&venue.ping(&mut State::default())), json!({ "method": "ping" }));
        assert_eq!(venue.settings().ping_every, Some(Duration::from_secs(15)));
        assert_eq!(venue.settings().max_silence, Duration::from_secs(45));
    }
}

#[test]
fn hands_the_engine_an_ourbit_push_as_the_whole_book() {
    let mut conn = clone_connection(&OURBIT, "BTC_USDT");

    let published = clone_send(&OURBIT, &mut conn, OURBIT_BTC);

    assert_eq!(
        published,
        [(
            "BTC_USDT".to_string(),
            levels(&[(82474.4, 121249.0), (82474.3, 96136.0), (82474.2, 28217.0)]),
            levels(&[(82474.5, 121249.0), (82474.6, 35095.0), (82474.7, 44467.0)]),
        )]
    );
}

#[test]
fn drops_a_bydfi_push_whose_version_is_below_the_last_one_applied() {
    let mut conn = clone_connection(&BYDFI, "SOL_USDC");
    assert_eq!(clone_send(&BYDFI, &mut conn, BYDFI_SOL_USDC).len(), 1);

    let older = String::from_utf8(BYDFI_SOL_USDC.to_vec()).unwrap().replace("114461355", "114461354");
    let published = clone_send(&BYDFI, &mut conn, older.as_bytes());

    assert!(published.is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn logs_a_clone_refusal_as_a_venue_error_with_its_connection() {
    let (logs, _capture) = capture();
    let mut conn = clone_connection(&OURBIT, "BTC_USDT");

    // The acknowledgement, the pong and the two refusals, captured live on 2026-10-09.
    clone_send(&OURBIT, &mut conn, br#"{"channel":"rs.sub.depth.full","data":"success","ts":1791573866142}"#);
    clone_send(&OURBIT, &mut conn, br#"{"channel":"pong","data":1791573866153,"ts":1791573866153}"#);
    clone_send(&OURBIT, &mut conn, br#"{"channel":"rs.error","data":"Contract [NOPE_USDT] not exists","ts":1791573866150}"#);
    clone_send(&OURBIT, &mut conn, br#"{"channel":"rs.error","data":"Not support limit","ts":1791573866150}"#);

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].text("connection"), "ourbit#swap#0");
    assert_eq!(errors[1].text("message"), "Not support limit");
}

#[test]
fn drops_a_clone_push_for_a_contract_the_connection_did_not_subscribe_to() {
    let (logs, _capture) = capture();
    let mut conn = clone_connection(&BYDFI, "BTC_USDT");

    assert!(clone_send(&BYDFI, &mut conn, BYDFI_SOL_USDC).is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

// Prints the frames the profile tests use, from each clone's socket.
// cargo test mexc::tests::capture_clone_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_clone_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    for (profile, quiet) in [(&OURBIT, "HEI_USDT"), (&BYDFI, "SOL_USDC")] {
        let (mut ws, _) = tokio_tungstenite::connect_async(profile.public_url).await.unwrap();
        for (symbol, limit) in [("BTC_USDT", 20), (quiet, 20), ("NOPE_USDT", 20), ("ETH_USDT", 30), ("BTC_USD", 20)] {
            let frame = json!({ "method": SUBSCRIBE_METHOD, "param": { "symbol": symbol, "limit": limit } });
            ws.send(Message::text(frame.to_string())).await.unwrap();
        }
        ws.send(Message::text(r#"{"method":"ping"}"#)).await.unwrap();

        let deadline = tokio::time::Instant::now() + Duration::from_secs(8);
        let mut pushes: HashMap<String, usize> = HashMap::new();
        while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
            let Message::Text(text) = message else {
                println!("{} other {message:?}", profile.id);
                continue;
            };
            let value: Value = serde_json::from_str(text.as_str()).unwrap();
            if value["channel"] == PUSH_CHANNEL {
                let symbol = value["symbol"].as_str().unwrap_or_default().to_string();
                let count = pushes.entry(symbol).or_default();
                *count += 1;
                if *count > 1 {
                    continue;
                }
            }
            let text = text.as_str();
            println!("{} {} ... {}", profile.id, &text[..text.len().min(200)], &text[text.len().saturating_sub(160)..]);
        }
        println!("{} pushes {pushes:?}", profile.id);
    }
}
