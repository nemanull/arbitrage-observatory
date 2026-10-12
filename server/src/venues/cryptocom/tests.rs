// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.strip_suffix("USD-PERP").unwrap();
    testing::market(ID, raw_market_id, base, "USD", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}USD-PERP")));
    }
    markets
}

fn venue() -> Cryptocom {
    Cryptocom::new(&[])
}

fn connection() -> Connection<HashMap<usize, u64>> {
    Connection::for_test("cryptocom#perp#0", vec![market("BTCUSD-PERP"), market("NVDAUSD-PERP")])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// Book frames captured live on 2026-10-08, with the snapshot cut to three levels a side.
fn btc_snapshot() -> Value {
    json!({"id":-1,"method":"subscribe","code":0,"result":{"instrument_name":"BTCUSD-PERP","subscription":"book.BTCUSD-PERP.50","channel":"book","depth":50,"data":[{
        "asks":[["82096.1","0.0085","3"],["82096.2","0.0020","1"],["82097.6","0.0400","1"]],
        "bids":[["82096.0","0.0601","3"],["82095.9","0.0020","1"],["82094.4","0.0332","1"]],
        "t":1791514283622_i64,"tt":1791514283573_i64,"u":376190553920480_i64,"cs":-1950153049}]}})
}

// The delta that followed the snapshot, which deletes a level outside the three kept here and adds one.
fn btc_delta() -> Value {
    json!({"id":-1,"method":"subscribe","code":0,"result":{"instrument_name":"BTCUSD-PERP","subscription":"book.BTCUSD-PERP.50","channel":"book.update","depth":50,"data":[{
        "update":{"asks":[],"bids":[["82056.4","0","0"],["82047.1","0.0139","1"]]},
        "t":1791514283663_i64,"tt":1791514283650_i64,"u":376190554134016_i64,"pu":376190553920480_i64,"cs":967792609}]}})
}

// The next delta in the capture, cut to the levels that touch the three kept here.
fn btc_second_delta() -> Value {
    json!({"id":-1,"method":"subscribe","code":0,"result":{"instrument_name":"BTCUSD-PERP","subscription":"book.BTCUSD-PERP.50","channel":"book.update","depth":50,"data":[{
        "update":{"asks":[["82096.2","0","0"],["82104.2","0.0028","1"]],"bids":[["82094.2","0.0028","1"],["82047.1","0","0"]]},
        "t":1791514283705_i64,"tt":1791514283701_i64,"u":376190554306624_i64,"pu":376190554134016_i64,"cs":-304703069}]}})
}

// An idle delta, with u equal to pu and tt 5 s older than t, here chained after btc_delta.
fn btc_idle_delta() -> Value {
    json!({"id":-1,"method":"subscribe","code":0,"result":{"instrument_name":"BTCUSD-PERP","subscription":"book.BTCUSD-PERP.50","channel":"book.update","depth":50,"data":[{
        "update":{"asks":[],"bids":[]},
        "t":1791514312270_i64,"tt":1791514307257_i64,"u":376190554134016_i64,"pu":376190554134016_i64,"cs":-1219592903}]}})
}

fn send(conn: &mut Connection<HashMap<usize, u64>>, frame: Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

fn channels(frame: &Value) -> Vec<&str> {
    frame["params"]["channels"].as_array().unwrap().iter().map(|c| c.as_str().unwrap()).collect()
}

// plan and settings

#[test]
fn puts_100_markets_on_each_socket_so_four_channels_each_stay_inside_the_400_cap() {
    let plans = venue().plan(&markets(409));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [100, 100, 100, 100, 9]);
    assert_eq!(plans[0].id, "cryptocom#perp#0");
    assert_eq!(plans[4].id, "cryptocom#perp#4");
    assert_eq!(plans[0].url, "wss://stream.crypto.com/exchange/v1/market");
}

#[test]
fn ends_a_socket_silent_for_15_seconds_paces_its_subscribes_and_sends_no_ping_of_its_own() {
    let settings = venue().settings();

    assert_eq!(settings.max_silence, Duration::from_secs(15));
    assert_eq!(settings.subscribe_gap, Duration::from_millis(250));
    assert_eq!(settings.ping_every, None);
}

// subscribe_frames

#[test]
fn subscribes_the_books_then_the_mark_index_and_funding_channels_one_kind_per_frame() {
    let slice = markets(100);

    let frames: Vec<Value> = venue().subscribe_frames(&slice, &mut HashMap::new()).iter().map(parsed).collect();

    assert_eq!(frames.len(), 4);
    let ids: Vec<i64> = frames.iter().map(|frame| frame["id"].as_i64().unwrap()).collect();
    assert_eq!(ids, [1, 2, 3, 4]);
    assert!(frames.iter().all(|frame| frame["method"] == "subscribe" && frame["nonce"].as_i64().unwrap() > 0));

    assert_eq!(frames[0]["params"]["book_subscription_type"], "SNAPSHOT_AND_UPDATE");
    assert_eq!(frames[0]["params"]["book_update_frequency"], 10);
    assert_eq!(channels(&frames[0])[0], "book.SYM0USD-PERP.50");
    assert_eq!(channels(&frames[1])[0], "mark.SYM0USD-PERP");
    assert_eq!(channels(&frames[2])[0], "index.SYM0USD-INDEX");
    assert_eq!(channels(&frames[3])[99], "funding.SYM99USD-PERP");
    assert!(frames[1]["params"].get("book_subscription_type").is_none());

    let total: usize = frames.iter().map(|frame| channels(frame).len()).sum();
    assert_eq!(total, 400);
}

#[test]
fn a_short_slice_still_gets_one_frame_per_kind() {
    let frames = venue().subscribe_frames(&markets(9), &mut HashMap::new());

    assert_eq!(frames.len(), 4);
    assert!(frames.iter().all(|frame| channels(&parsed(frame)).len() == 9));
}

// handle: books

#[test]
fn hands_the_engine_a_snapshot_as_the_whole_book() {
    let mut conn = connection();

    let published = send(&mut conn, btc_snapshot());

    assert_eq!(
        published,
        [(
            "BTCUSD-PERP".to_string(),
            levels(&[(82096.0, 0.0601), (82095.9, 0.002), (82094.4, 0.0332)]),
            levels(&[(82096.1, 0.0085), (82096.2, 0.002), (82097.6, 0.04)]),
        )]
    );
}

#[test]
fn applies_deltas_whose_pu_is_the_last_u_and_deletes_a_level_sent_with_size_zero() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());

    let first = send(&mut conn, btc_delta());
    let second = send(&mut conn, btc_second_delta());

    assert_eq!(first[0].1, levels(&[(82096.0, 0.0601), (82095.9, 0.002), (82094.4, 0.0332), (82047.1, 0.0139)]));
    assert_eq!(second[0].1, levels(&[(82096.0, 0.0601), (82095.9, 0.002), (82094.4, 0.0332), (82094.2, 0.0028)]));
    assert_eq!(second[0].2, levels(&[(82096.1, 0.0085), (82097.6, 0.04), (82104.2, 0.0028)]));
    assert!(!conn.resync_requested());
}

#[test]
fn an_idle_delta_publishes_nothing_and_keeps_the_chain() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_delta());

    let idle = send(&mut conn, btc_idle_delta());
    let next = send(&mut conn, btc_second_delta());

    assert!(idle.is_empty());
    assert_eq!(next.len(), 1);
    assert!(!conn.resync_requested());
    assert!(logs.events("book_resync").is_empty());
}

#[test]
fn restarts_the_connection_on_a_delta_whose_pu_is_not_the_last_u() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());

    let published = send(&mut conn, btc_second_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync.len(), 1);
    assert_eq!(resync[0].text("market"), "BTCUSD-PERP");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn restarts_the_connection_on_a_delta_that_carries_no_pu() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut delta = btc_delta();
    delta["result"]["data"][0].as_object_mut().unwrap().remove("pu");

    let published = send(&mut conn, delta);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_gap");
}

#[test]
fn applies_every_chained_delta_of_a_frame_that_holds_several() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut frame = btc_delta();
    frame["result"]["data"] = json!([btc_delta()["result"]["data"][0], btc_second_delta()["result"]["data"][0]]);

    let published = send(&mut conn, frame);

    assert_eq!(published[0].1, levels(&[(82096.0, 0.0601), (82095.9, 0.002), (82094.4, 0.0332), (82094.2, 0.0028)]));
    assert_eq!(conn.state[&0], 376190554306624);
    assert!(!conn.resync_requested());
}

#[test]
fn stops_a_frame_of_several_deltas_at_its_first_gap() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut frame = btc_delta();
    frame["result"]["data"] = json!([btc_second_delta()["result"]["data"][0], btc_delta()["result"]["data"][0]]);

    let published = send(&mut conn, frame);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(conn.state[&0], 376190553920480);
}

#[test]
fn restarts_the_connection_on_a_delta_with_no_snapshot_behind_it() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(&mut conn, btc_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn takes_a_later_snapshot_as_a_replacement_of_the_book_and_of_the_chain() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_delta());

    let mut again = btc_snapshot();
    again["result"]["data"][0]["u"] = json!(376190554134016_i64);
    again["result"]["data"][0]["bids"] = json!([["82000.0", "1.0000", "1"]]);
    let replaced = send(&mut conn, again);
    let next = send(&mut conn, btc_second_delta());

    assert_eq!(replaced[0].1, levels(&[(82000.0, 1.0)]));
    assert_eq!(next[0].1, levels(&[(82094.2, 0.0028), (82000.0, 1.0)]));
    assert!(!conn.resync_requested());
}

#[test]
fn keeps_the_books_of_two_markets_apart() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());

    // NVDAUSD-PERP's snapshot from the same capture, cut to one level a side.
    let published = send(
        &mut conn,
        json!({"id":-1,"method":"subscribe","code":0,"result":{"instrument_name":"NVDAUSD-PERP","subscription":"book.NVDAUSD-PERP.50","channel":"book","depth":50,"data":[{
            "asks":[["232.23","0.30","1"]],"bids":[["232.18","0.30","1"]],"t":1791514283630_i64,"tt":1791514283600_i64,"u":376190540966528_i64,"cs":1}]}}),
    );

    assert_eq!(published, [("NVDAUSD-PERP".to_string(), levels(&[(232.18, 0.3)]), levels(&[(232.23, 0.3)]))]);
}

#[test]
fn drops_a_book_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = Connection::for_test("cryptocom#perp#0", vec![market("ETHUSD-PERP")]);

    let snapshot = send(&mut conn, btc_snapshot());
    let delta = send(&mut conn, btc_delta());

    assert!(snapshot.is_empty() && delta.is_empty());
    assert!(!conn.resync_requested());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

// handle: session and errors

#[test]
fn answers_a_heartbeat_with_respond_heartbeat_under_the_same_id() {
    let mut conn = connection();

    let published = send(&mut conn, json!({"id":1791514356178_i64,"method":"public/heartbeat","code":0}));

    assert!(published.is_empty());
    let sent: Vec<Value> = conn.take_sent().iter().map(parsed).collect();
    assert_eq!(sent, [json!({ "id": 1791514356178_i64, "method": "public/respond-heartbeat" })]);
}

#[test]
fn logs_an_error_reply_and_stays_silent_on_a_book_acknowledgement() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, json!({"id":1,"method":"subscribe","code":0,"channel":"book.BTCUSD-PERP.50"}));
    let published = send(
        &mut conn,
        json!({"id":1,"method":"subscribe","code":40003,"channel":"book.NOPEUSD-PERP.50","message":"Unknown symbol"}),
    );
    send(&mut conn, json!({"id":9,"method":"subscribe","code":40107,"message":"Maximum subscriptions exceeded"}));

    assert!(published.is_empty());
    assert!(conn.take_sent().is_empty());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "cryptocom#perp#0");
    assert_eq!(errors[0].number("code"), 40003.0);
    assert_eq!(errors[0].text("channel"), "book.NOPEUSD-PERP.50");
    assert_eq!(errors[0].text("message"), "Unknown symbol");
    assert_eq!(errors[1].number("code"), 40107.0);
}

#[test]
fn an_anchor_push_touches_no_book() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());

    let published = send(
        &mut conn,
        json!({"id":-1,"method":"subscribe","code":0,"result":{"instrument_name":"BTCUSD-PERP","subscription":"mark.BTCUSD-PERP","channel":"mark","data":[{"v":"82099.7","t":1791514283000_i64}]}}),
    );

    assert!(published.is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn fails_a_frame_that_is_not_json() {
    let mut conn = connection();

    assert!(venue().handle(b"not json", &mut conn).is_err());
}

#[test]
fn names_the_index_after_the_perpetual_and_back() {
    assert_eq!(index_name("BTCUSD-PERP"), "BTCUSD-INDEX");
    assert_eq!(raw_of_index("BTCUSD-INDEX").as_deref(), Some("BTCUSD-PERP"));
    assert_eq!(raw_of_index("BTCUSD-PERP"), None);
}

// probe

// Prints the raw frames of a few channels, which is how the frames below were captured:
// cargo test cryptocom::tests::capture_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(MARKET_URL).await.unwrap();
    tokio::time::sleep(Duration::from_secs(1)).await;
    let book = serde_json::json!({ "id": 1, "method": "subscribe", "params": {
        "channels": ["book.BTCUSD-PERP.50", "book.NVDAUSD-PERP.50", "book.NOPEUSD-PERP.50"],
        "book_subscription_type": "SNAPSHOT_AND_UPDATE", "book_update_frequency": 10 }, "nonce": now_ms() });
    let anchor = serde_json::json!({ "id": 2, "method": "subscribe", "params": {
        "channels": ["mark.BTCUSD-PERP", "index.BTCUSD-INDEX", "funding.BTCUSD-PERP", "index.BTCUSD-PERP"] }, "nonce": now_ms() });
    ws.send(Message::text(book.to_string())).await.unwrap();
    ws.send(Message::text(anchor.to_string())).await.unwrap();

    let seconds: u64 = std::env::var("CAPTURE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(40);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            continue;
        };
        println!("{} {}", now_ms(), text.as_str());
        if text.as_str().contains("public/heartbeat") {
            let frame: serde_json::Value = serde_json::from_str(text.as_str()).unwrap();
            let answer = serde_json::json!({ "id": frame["id"], "method": "public/respond-heartbeat" });
            ws.send(Message::text(answer.to_string())).await.unwrap();
        }
    }
}
