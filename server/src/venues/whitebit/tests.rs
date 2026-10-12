// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.split('_').next().unwrap();
    testing::market(ID, raw_market_id, base, "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}_PERP")));
    }
    markets
}

fn venue() -> Whitebit {
    Whitebit::new()
}

// The order of the capture's subscribe requests, so request 4 is NOPE_PERP.
fn connection() -> Connection<HashMap<usize, i64>> {
    let markets = vec![market("ETH_PERP"), market("BTC_PERP"), market("STG_PERP"), market("NOPE_PERP"), market("NVDA_PERP")];
    Connection::for_test("whitebit#perp#0", markets)
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// Frames captured live on 2026-10-08 with the server's spacing removed and the levels cut down.
// The ETH deltas follow the ETH snapshot in the order they came.
fn eth_snapshot() -> Value {
    json!({"method":"depth_update","params":[true,{"timestamp":1791514470.73676,"update_id":21583643648_i64,"asks":[["2496.11","10.39"],["2496.55","40.06"],["2496.88","0.43"]],"bids":[["2496.1","0.32"],["2496.08","1.11"],["2495.94","2.1"]],"event_time":1791514471.861449},"ETH_PERP"],"id":null})
}

fn eth_delta() -> Value {
    json!({"method":"depth_update","params":[false,{"timestamp":1791514472.443103,"update_id":21583643796_i64,"past_update_id":21583643648_i64,"asks":[["2496.09","0.32"],["2496.11","10.03"],["2498.13","0"]],"bids":[["2496.1","0"],["2496.01","0.1"],["2495.64","0"],["2495.19","0"]],"event_time":1791514472.494516},"ETH_PERP"],"id":null})
}

fn eth_next_delta() -> Value {
    json!({"method":"depth_update","params":[false,{"timestamp":1791514472.544401,"update_id":21583644056_i64,"past_update_id":21583643796_i64,"asks":[["2495.85","0.32"],["2496.09","0"],["2496.11","0"],["2496.55","0"]],"bids":[["2496.08","0"],["2496.01","0"],["2495.94","0"],["2495.84","2.25"]],"event_time":1791514472.619905},"ETH_PERP"],"id":null})
}

// A delta that leaves the asks out, chained to the snapshot before it.
fn btc_snapshot() -> Value {
    json!({"method":"depth_update","params":[true,{"timestamp":1791514331.145607,"update_id":24722354050_i64,"asks":[["82083.7","0.016"],["82095.8","0.008"]],"bids":[["82083.6","0.016"],["82079.3","0.158"]],"event_time":1791514331.21},"BTC_PERP"],"id":null})
}

fn btc_bids_only_delta() -> Value {
    json!({"method":"depth_update","params":[false,{"timestamp":1791514331.3953731,"update_id":24722354160_i64,"past_update_id":24722354050_i64,"bids":[["82075.1","0.305"],["82039.1","0"]],"event_time":1791514331.5551839},"BTC_PERP"],"id":null})
}

// STG_PERP left the catalog after its delisting, and its subscribe still answers with an empty book.
fn stg_empty_snapshot() -> Value {
    json!({"method":"depth_update","params":[true,{"timestamp":1791514471.939474,"update_id":776082935,"asks":[],"bids":[],"event_time":1791514472.005555},"STG_PERP"],"id":null})
}

// The subscribe answer, then the keepalive after 10 s of quiet, whose update_id moved with changes outside the window.
fn nvda_snapshot() -> Value {
    json!({"method":"depth_update","params":[true,{"timestamp":1791514428.99486,"update_id":526384764,"asks":[["232.49","0.55"],["232.52","2.19"],["232.54","3.79"]],"bids":[["232.44","4.3"],["232.39","0.37"],["232.37","2.77"]],"event_time":1791514434.057806},"NVDA_PERP"],"id":null})
}

fn nvda_keepalive() -> Value {
    json!({"method":"depth_update","params":[true,{"timestamp":1791514446.396068,"update_id":526385026,"asks":[["232.52","0.76"],["232.54","2.8"],["232.56","3.03"]],"bids":[["232.44","4.3"],["232.41","0.33"],["232.39","1.54"]],"event_time":1791514446.434631},"NVDA_PERP"],"id":null})
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

// plan

#[test]
fn puts_200_markets_on_each_socket() {
    let plans = venue().plan(&markets(395));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [200, 195]);
    assert_eq!(plans[0].id, "whitebit#perp#0");
    assert_eq!(plans[1].id, "whitebit#perp#1");
    assert_eq!(plans[0].url, "wss://wss.whitebit.com/ws");
}

#[test]
fn pings_every_20_seconds_and_ends_a_socket_silent_for_30() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(20)));
    assert_eq!(settings.max_silence, Duration::from_secs(30));
    assert_eq!(parsed(&venue().ping(&mut HashMap::new())), json!({ "id": 0, "method": "ping", "params": [] }));
}

// subscribe_frames

#[test]
fn subscribes_each_market_at_20_levels_with_multi_depth_and_its_position_as_the_request_id() {
    let frames = venue().subscribe_frames(&markets(3), &mut HashMap::new());

    assert_eq!(frames.len(), 3);
    assert_eq!(parsed(&frames[0]), json!({ "id": 1, "method": "depth_subscribe", "params": ["SYM0_PERP", 20, "0", true] }));
    assert_eq!(parsed(&frames[2])["id"], 3);
    assert_eq!(parsed(&frames[2])["params"][0], "SYM2_PERP");
}

// handle

#[test]
fn hands_the_engine_a_snapshot_as_the_whole_book() {
    let mut conn = connection();

    let published = send(&mut conn, eth_snapshot());

    assert_eq!(
        published,
        [(
            "ETH_PERP".to_string(),
            levels(&[(2496.1, 0.32), (2496.08, 1.11), (2495.94, 2.1)]),
            levels(&[(2496.11, 10.39), (2496.55, 40.06), (2496.88, 0.43)]),
        )]
    );
    assert_eq!(conn.state[&0], 21583643648);
}

#[test]
fn applies_deltas_chained_by_past_update_id_and_removes_zero_levels() {
    let mut conn = connection();
    send(&mut conn, eth_snapshot());

    let first = send(&mut conn, eth_delta());
    let second = send(&mut conn, eth_next_delta());

    assert_eq!(first[0].1, levels(&[(2496.08, 1.11), (2496.01, 0.1), (2495.94, 2.1)]));
    assert_eq!(first[0].2, levels(&[(2496.09, 0.32), (2496.11, 10.03), (2496.55, 40.06), (2496.88, 0.43)]));
    assert_eq!(second[0].1, levels(&[(2495.84, 2.25)]));
    assert_eq!(second[0].2, levels(&[(2495.85, 0.32), (2496.88, 0.43)]));
    assert_eq!(conn.state[&0], 21583644056);
    assert!(!conn.resync_requested());
}

#[test]
fn a_delta_that_leaves_a_side_out_keeps_that_side() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());

    let published = send(&mut conn, btc_bids_only_delta());

    assert_eq!(published[0].1, levels(&[(82083.6, 0.016), (82079.3, 0.158), (82075.1, 0.305)]));
    assert_eq!(published[0].2, levels(&[(82083.7, 0.016), (82095.8, 0.008)]));
}

#[test]
fn a_chained_delta_with_neither_side_moves_the_chain_and_publishes_nothing() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut frame = btc_bids_only_delta();
    frame["params"][1].as_object_mut().unwrap().remove("bids");

    let published = send(&mut conn, frame);

    assert!(published.is_empty());
    assert_eq!(conn.state[&1], 24722354160);
    assert!(!conn.resync_requested());
}

#[test]
fn a_delta_after_a_snapshot_of_another_market_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, eth_snapshot());

    let published = send(&mut conn, btc_bids_only_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("market"), "BTC_PERP");
}

#[test]
fn a_delta_whose_past_update_id_misses_the_last_one_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, eth_snapshot());

    let published = send(&mut conn, eth_next_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync[0].text("market"), "ETH_PERP");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn a_delta_before_any_snapshot_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(&mut conn, eth_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn a_keepalive_snapshot_replaces_the_book_and_moves_the_chain_to_its_update_id() {
    let mut conn = connection();
    send(&mut conn, nvda_snapshot());

    let published = send(&mut conn, nvda_keepalive());

    assert_eq!(published[0].1, levels(&[(232.44, 4.3), (232.41, 0.33), (232.39, 1.54)]));
    assert_eq!(published[0].2, levels(&[(232.52, 0.76), (232.54, 2.8), (232.56, 3.03)]));
    assert_eq!(conn.state[&4], 526385026);
}

#[test]
fn an_empty_snapshot_publishes_an_empty_book() {
    let mut conn = connection();

    let published = send(&mut conn, stg_empty_snapshot());

    assert_eq!(published, [("STG_PERP".to_string(), Vec::new(), Vec::new())]);
}

#[test]
fn drops_a_book_for_a_market_the_connection_does_not_hold() {
    let (logs, _capture) = capture();
    let mut conn = Connection::for_test("whitebit#perp#0", vec![market("BTC_PERP")]);

    let published = send(&mut conn, eth_snapshot());

    assert!(published.is_empty());
    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "ETH_PERP");
}

#[test]
fn logs_an_error_reply_with_the_market_its_request_id_names() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(&mut conn, json!({"error":{"code":9,"message":"market NOPE_PERP does not exist"},"result":null,"id":4}));

    assert!(published.is_empty());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "whitebit#perp#0");
    assert_eq!(errors[0].text("market"), "NOPE_PERP");
    assert_eq!(errors[0].number("code"), 9.0);
    assert_eq!(errors[0].number("request"), 4.0);
    assert_eq!(errors[0].text("message"), "market NOPE_PERP does not exist");
}

#[test]
fn an_error_reply_to_the_ping_names_no_market() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, json!({"error":{"code":4,"message":"method not found"},"result":null,"id":0}));

    assert_eq!(logs.events("venue_error")[0].text("market"), "");
}

#[test]
fn ignores_the_subscribe_acknowledgement_and_the_pong() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    assert!(send(&mut conn, json!({"error":null,"result":{"status":"success"},"id":1})).is_empty());
    assert!(send(&mut conn, json!({"error":null,"result":"pong","id":0})).is_empty());
    assert!(logs.lines().iter().all(|line| line.level > Level::WARN));
}

#[test]
fn ignores_a_push_of_another_channel() {
    let mut conn = connection();

    // The premium index push, captured on 2026-09-22, which the feed never subscribes.
    let frame = json!({"method":"premiumIndex_update","params":[["BTC_PERP","86167.8","86224.5","0.00006382",1790121600000_i64,1790113268.565173]],"id":null});

    assert!(send(&mut conn, frame).is_empty());
}

#[test]
fn an_error_reply_with_an_id_outside_the_plan_names_no_market() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, json!({"error":{"code":1,"message":"invalid argument"},"result":null,"id":-9223372036854775807_i64}));
    send(&mut conn, json!({"error":{"code":1,"message":"invalid argument"},"result":null,"id":99}));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert!(errors.iter().all(|error| error.text("market").is_empty()));
}

#[test]
fn ignores_params_of_any_other_shape() {
    let mut conn = connection();

    assert!(send(&mut conn, json!({"method":"market_update","params":{"BTC_PERP":{}},"id":null})).is_empty());
    assert!(send(&mut conn, json!({"method":"depth_update","params":null,"id":null})).is_empty());
}

#[test]
fn a_frame_that_is_not_json_is_an_error() {
    let mut conn = connection();

    assert!(venue().handle(b"pong", &mut conn).is_err());
}

// Prints the frames the feed tests are built from:
// cargo test whitebit::tests::capture_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_frames() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut socket, _) = tokio_tungstenite::connect_async(PUBLIC_URL).await.unwrap();
    let list = std::env::var("CAPTURE_MARKETS").unwrap_or_else(|_| "ETH_PERP,BTC_PERP,NOPE_PERP".to_string());
    let markets: Vec<&str> = list.split(',').collect();
    for (i, market) in markets.iter().enumerate() {
        let frame = serde_json::json!({ "id": i + 1, "method": "depth_subscribe", "params": [market, DEPTH, "0", true] });
        socket.send(Message::text(frame.to_string())).await.unwrap();
    }
    socket.send(Message::text(r#"{"id":0,"method":"ping","params":[]}"#)).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(25);
    let mut deltas = 0;
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, socket.next()).await {
        let Message::Text(text) = message else {
            continue;
        };
        let delta = text.contains(r#""params": [false"#);
        if !delta || deltas < 20 {
            println!("{text}");
        }
        deltas += usize::from(delta);
    }
}
