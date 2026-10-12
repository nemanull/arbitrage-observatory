// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::clock::now_ms;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.strip_suffix("_USDC-PERPETUAL").unwrap();
    testing::market(ID, raw_market_id, base, "USDC", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}_USDC-PERPETUAL")));
    }
    markets
}

fn venue() -> Deribit {
    Deribit::new(&[])
}

// Subscribed as a run subscribes, so the acknowledgement check has the requested channels.
fn connection() -> Connection<State> {
    let markets = vec![market("NVDA_USDC-PERPETUAL"), market("ALGO_USDC-PERPETUAL")];
    let mut conn = Connection::for_test("deribit#perp#0", markets.clone());
    venue().subscribe_frames(&markets, &mut conn.state);
    conn
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// Book frames captured live on 2026-10-08, with each snapshot cut to three levels a side.
fn nvda_snapshot() -> Value {
    json!({"jsonrpc":"2.0","method":"subscription","params":{"channel":"book.NVDA_USDC-PERPETUAL.100ms","data":{
        "timestamp":1791523913677_i64,"type":"snapshot","change_id":202934986396_i64,"instrument_name":"NVDA_USDC-PERPETUAL",
        "bids":[["new",233.06,5.89],["new",233.03,3.47],["new",233.02,4.24]],
        "asks":[["new",233.07,36.55],["new",233.08,6.23],["new",233.09,10.66]]}}})
}

fn nvda_delta() -> Value {
    json!({"jsonrpc":"2.0","method":"subscription","params":{"channel":"book.NVDA_USDC-PERPETUAL.100ms","data":{
        "timestamp":1791523915065_i64,"type":"change","change_id":202935001815_i64,"instrument_name":"NVDA_USDC-PERPETUAL",
        "bids":[["change",233.06,3.73],["new",233.05,2.16]],"asks":[["change",233.07,30.32],["change",233.11,18.69]],
        "prev_change_id":202934986396_i64}}})
}

// The next delta in the capture, with an empty bid side.
fn nvda_second_delta() -> Value {
    json!({"jsonrpc":"2.0","method":"subscription","params":{"channel":"book.NVDA_USDC-PERPETUAL.100ms","data":{
        "timestamp":1791523915675_i64,"type":"change","change_id":202935006829_i64,"instrument_name":"NVDA_USDC-PERPETUAL",
        "bids":[],"asks":[["change",233.32,353.9]],"prev_change_id":202935001815_i64}}})
}

fn algo_snapshot() -> Value {
    json!({"jsonrpc":"2.0","method":"subscription","params":{"channel":"book.ALGO_USDC-PERPETUAL.100ms","data":{
        "timestamp":1791523913668_i64,"type":"snapshot","change_id":202934986363_i64,"instrument_name":"ALGO_USDC-PERPETUAL",
        "bids":[["new",0.11978,1001.0],["new",0.11977,1002.0],["new",0.11976,126085.0]],
        "asks":[["new",0.11995,169.0],["new",0.12,1002.0],["new",0.12003,129134.0]]}}})
}

// The delta that followed, which deletes the third ask and levels outside the three kept here.
fn algo_delta() -> Value {
    json!({"jsonrpc":"2.0","method":"subscription","params":{"channel":"book.ALGO_USDC-PERPETUAL.100ms","data":{
        "timestamp":1791523914517_i64,"type":"change","change_id":202934995745_i64,"instrument_name":"ALGO_USDC-PERPETUAL",
        "bids":[["change",0.11978,127065.0],["change",0.11977,1002.0],["change",0.11976,129425.0],["delete",0.11974,0.0],["change",0.11961,717494.0],["delete",0.11959,0.0]],
        "asks":[["change",0.12,1002.0],["delete",0.12003,0.0],["new",0.12005,129112.0],["change",0.12017,293922.0],["change",0.12018,5602.0],["new",0.1202,420133.0]],
        "prev_change_id":202934986363_i64}}})
}

fn send(conn: &mut Connection<State>, frame: Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// plan and settings

#[test]
fn puts_50_markets_on_each_socket_of_the_one_address() {
    let plans = venue().plan(&markets(134));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [50, 50, 34]);
    assert_eq!(plans[0].id, "deribit#perp#0");
    assert_eq!(plans[2].id, "deribit#perp#2");
    assert!(plans.iter().all(|plan| plan.url == "wss://www.deribit.com/ws/api/v2"));
}

#[test]
fn ends_a_socket_silent_for_35_seconds_and_sends_no_ping_of_its_own() {
    let settings = venue().settings();

    assert_eq!(settings.max_silence, Duration::from_secs(35));
    assert_eq!(settings.ping_every, None);
    assert!(settings.headers.is_empty());
}

// subscribe_frames

#[test]
fn sets_a_ten_second_heartbeat_then_subscribes_every_book_of_the_slice_in_one_call() {
    let slice = markets(50);
    let mut state = State::default();

    let frames: Vec<Value> = venue().subscribe_frames(&slice, &mut state).iter().map(parsed).collect();

    assert_eq!(frames.len(), 2);
    assert_eq!(
        frames[0],
        json!({ "jsonrpc": "2.0", "id": 1, "method": "public/set_heartbeat", "params": { "interval": 10 } })
    );
    assert_eq!(frames[1]["id"], 2);
    assert_eq!(frames[1]["method"], "public/subscribe");
    let channels = frames[1]["params"]["channels"].as_array().unwrap();
    assert_eq!(channels.len(), 50);
    assert_eq!(channels[0], "book.SYM0_USDC-PERPETUAL.100ms");
    assert_eq!(channels[49], "book.SYM49_USDC-PERPETUAL.100ms");
    assert_eq!(state.requested.len(), 50);
}

// handle: books

#[test]
fn hands_the_engine_a_snapshot_as_the_whole_book() {
    let mut conn = connection();

    let published = send(&mut conn, nvda_snapshot());

    assert_eq!(
        published,
        [(
            "NVDA_USDC-PERPETUAL".to_string(),
            levels(&[(233.06, 5.89), (233.03, 3.47), (233.02, 4.24)]),
            levels(&[(233.07, 36.55), (233.08, 6.23), (233.09, 10.66)]),
        )]
    );
    assert_eq!(conn.state.last[&0], 202934986396);
}

#[test]
fn applies_deltas_whose_prev_change_id_is_the_last_change_id() {
    let mut conn = connection();
    send(&mut conn, nvda_snapshot());

    let first = send(&mut conn, nvda_delta());
    let second = send(&mut conn, nvda_second_delta());

    assert_eq!(first[0].1, levels(&[(233.06, 3.73), (233.05, 2.16), (233.03, 3.47), (233.02, 4.24)]));
    assert_eq!(first[0].2, levels(&[(233.07, 30.32), (233.08, 6.23), (233.09, 10.66), (233.11, 18.69)]));
    assert_eq!(second[0].1, first[0].1);
    assert_eq!(second[0].2, levels(&[(233.07, 30.32), (233.08, 6.23), (233.09, 10.66), (233.11, 18.69), (233.32, 353.9)]));
    assert_eq!(conn.state.last[&0], 202935006829);
    assert!(!conn.resync_requested());
}

#[test]
fn deletes_a_level_sent_with_the_delete_action_and_amount_zero() {
    let mut conn = connection();
    send(&mut conn, algo_snapshot());

    let published = send(&mut conn, algo_delta());

    assert_eq!(
        published[0].1,
        levels(&[(0.11978, 127065.0), (0.11977, 1002.0), (0.11976, 129425.0), (0.11961, 717494.0)])
    );
    assert_eq!(
        published[0].2,
        levels(&[(0.11995, 169.0), (0.12, 1002.0), (0.12005, 129112.0), (0.12017, 293922.0), (0.12018, 5602.0), (0.1202, 420133.0)])
    );
}

#[test]
fn reads_an_amount_in_exponent_form() {
    let mut conn = connection();
    send(&mut conn, nvda_snapshot());
    send(&mut conn, nvda_delta());
    let delta: Value = serde_json::from_str(&nvda_second_delta().to_string().replace("353.9", "2.2e3")).unwrap();

    let published = send(&mut conn, delta);

    assert_eq!(published[0].2.last(), Some(&BookLevel { price: 233.32, size: 2200.0 }));
}

// No delta with both sides empty arrived on 2026-09-22 or 2026-10-08, so this is the captured delta with its levels removed.
#[test]
fn advances_the_chain_on_a_delta_with_no_levels_without_publishing() {
    let mut conn = connection();
    send(&mut conn, nvda_snapshot());
    let mut empty = nvda_delta();
    empty["params"]["data"]["bids"] = json!([]);
    empty["params"]["data"]["asks"] = json!([]);

    let published = send(&mut conn, empty);
    let next = send(&mut conn, nvda_second_delta());

    assert!(published.is_empty());
    assert_eq!(next[0].2.last(), Some(&BookLevel { price: 233.32, size: 353.9 }));
    assert!(!conn.resync_requested());
}

// A delta for one book must not advance or break the chain of another.
#[test]
fn restarts_the_connection_on_a_delta_whose_prev_change_id_is_another_books_change_id() {
    let mut conn = connection();
    send(&mut conn, nvda_snapshot());
    send(&mut conn, algo_snapshot());
    let mut crossed = algo_delta();
    crossed["params"]["data"]["prev_change_id"] = json!(202934986396_i64);

    let published = send(&mut conn, crossed);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn restarts_the_connection_on_a_delta_whose_prev_change_id_is_not_the_last_change_id() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, nvda_snapshot());

    let published = send(&mut conn, nvda_second_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    let resync = logs.events("book_resync");
    assert_eq!(resync.len(), 1);
    assert_eq!(resync[0].text("market"), "NVDA_USDC-PERPETUAL");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

// The change_id counter is shared by every USDC instrument, so a chain read as the last id plus one would break here.
#[test]
fn keeps_two_books_chained_on_their_own_ids_while_the_shared_counter_interleaves_them() {
    let mut conn = connection();
    send(&mut conn, algo_snapshot());
    send(&mut conn, nvda_snapshot());

    let algo = send(&mut conn, algo_delta());
    let nvda = send(&mut conn, nvda_delta());

    assert_eq!(algo[0].0, "ALGO_USDC-PERPETUAL");
    assert_eq!(nvda[0].0, "NVDA_USDC-PERPETUAL");
    assert_eq!(nvda[0].1[0], BookLevel { price: 233.06, size: 3.73 });
    assert!(!conn.resync_requested());
}

#[test]
fn restarts_the_connection_on_a_delta_that_carries_no_prev_change_id() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, nvda_snapshot());
    let mut delta = nvda_delta();
    delta["params"]["data"].as_object_mut().unwrap().remove("prev_change_id");

    let published = send(&mut conn, delta);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_gap");
}

#[test]
fn restarts_the_connection_on_a_delta_with_no_snapshot_behind_it() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(&mut conn, nvda_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn takes_a_later_snapshot_as_a_replacement_of_the_book_and_of_the_chain() {
    let mut conn = connection();
    send(&mut conn, nvda_snapshot());

    let mut again = nvda_snapshot();
    again["params"]["data"]["change_id"] = json!(202935001815_i64);
    again["params"]["data"]["bids"] = json!([["new", 232.0, 1.0]]);
    let replaced = send(&mut conn, again);
    let next = send(&mut conn, nvda_second_delta());

    assert_eq!(replaced[0].1, levels(&[(232.0, 1.0)]));
    assert_eq!(next[0].1, levels(&[(232.0, 1.0)]));
    assert!(!conn.resync_requested());
}

#[test]
fn a_snapshot_with_an_empty_side_publishes_a_one_sided_book() {
    let mut conn = connection();
    let mut snapshot = nvda_snapshot();
    snapshot["params"]["data"]["asks"] = json!([]);

    let published = send(&mut conn, snapshot);

    assert_eq!(published[0].1.len(), 3);
    assert!(published[0].2.is_empty());
}

#[test]
fn drops_a_book_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn: Connection<State> = Connection::for_test("deribit#perp#0", vec![market("BTC_USDC-PERPETUAL")]);

    let snapshot = send(&mut conn, nvda_snapshot());
    let delta = send(&mut conn, nvda_delta());

    assert!(snapshot.is_empty() && delta.is_empty());
    assert!(!conn.resync_requested());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

// handle: session, acknowledgements and errors

#[test]
fn answers_each_test_request_with_public_test_under_a_fresh_id() {
    let mut conn = connection();
    let test_request = json!({"params":{"type":"test_request"},"method":"heartbeat","jsonrpc":"2.0"});

    let published = send(&mut conn, test_request.clone());
    send(&mut conn, test_request);

    assert!(published.is_empty());
    let sent: Vec<Value> = conn.take_sent().iter().map(parsed).collect();
    assert_eq!(
        sent,
        [
            json!({ "jsonrpc": "2.0", "id": 3, "method": "public/test", "params": {} }),
            json!({ "jsonrpc": "2.0", "id": 4, "method": "public/test", "params": {} }),
        ]
    );
}

#[test]
fn stays_silent_on_a_plain_heartbeat_and_on_the_replies_to_its_own_requests() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, json!({"params":{"type":"heartbeat"},"method":"heartbeat","jsonrpc":"2.0"}));
    send(&mut conn, json!({"jsonrpc":"2.0","id":1,"result":"ok","usIn":1791523914122202_i64,"usOut":1791523914122243_i64,"usDiff":41,"testnet":false}));
    send(&mut conn, json!({"jsonrpc":"2.0","id":11,"result":{"version":"1.2.26"},"usIn":1791523924763727_i64,"usOut":1791523924763782_i64,"usDiff":55,"testnet":false}));

    assert!(conn.take_sent().is_empty());
    assert!(!conn.resync_requested());
    assert!(logs.events("venue_error").is_empty());
    assert!(logs.events("channels_unacknowledged").is_empty());
}

#[test]
fn passes_an_acknowledgement_that_lists_every_requested_channel_in_any_order() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(
        &mut conn,
        json!({"jsonrpc":"2.0","id":2,"result":["book.ALGO_USDC-PERPETUAL.100ms","book.NVDA_USDC-PERPETUAL.100ms"],"usIn":1791523914125284_i64,"usOut":1791523914125505_i64,"usDiff":221,"testnet":false}),
    );

    assert!(logs.events("channels_unacknowledged").is_empty());
}

// The venue drops an unknown channel from the acknowledgement with no error, as book.NOPE_USDC-PERPETUAL.100ms was on 2026-10-08.
#[test]
fn warns_about_each_channel_the_acknowledgement_left_out() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(
        &mut conn,
        json!({"jsonrpc":"2.0","id":2,"result":["book.NVDA_USDC-PERPETUAL.100ms"],"usIn":1791523914125284_i64,"usOut":1791523914125505_i64,"usDiff":221,"testnet":false}),
    );

    let warned = logs.events("channels_unacknowledged");
    assert_eq!(warned.len(), 1);
    assert_eq!(warned[0].level, Level::WARN);
    assert_eq!(warned[0].text("connection"), "deribit#perp#0");
    assert_eq!(warned[0].number("missing"), 1.0);
    assert_eq!(warned[0].number("requested"), 2.0);
    assert!(warned[0].text("sample").contains("book.ALGO_USDC-PERPETUAL.100ms"));
}

#[test]
fn logs_an_error_reply_and_an_error_with_no_id() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(
        &mut conn,
        json!({"jsonrpc":"2.0","id":2,"error":{"code":13778,"message":"raw_subscriptions_not_available_for_unauthorized"},"usIn":1791523940665222_i64,"usOut":1791523940665296_i64,"usDiff":74,"testnet":false}),
    );
    send(
        &mut conn,
        json!({"jsonrpc":"2.0","error":{"code":11050,"data":"invalid json","message":"bad_request"},"usIn":1791523914125578_i64,"usOut":1791523914125591_i64,"usDiff":13,"testnet":false}),
    );

    assert!(published.is_empty());
    assert!(conn.take_sent().is_empty());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "deribit#perp#0");
    assert_eq!(errors[0].number("id"), 2.0);
    assert_eq!(errors[0].number("code"), 13778.0);
    assert_eq!(errors[0].text("message"), "raw_subscriptions_not_available_for_unauthorized");
    assert_eq!(errors[1].number("code"), 11050.0);
    assert_eq!(errors[1].text("data"), "\"invalid json\"");
}

#[test]
fn fails_a_frame_that_is_not_json() {
    let mut conn = connection();

    assert!(venue().handle(b"not json", &mut conn).is_err());
}

// probe

// Prints the raw frames of a few channels, which is how the frames below were captured:
// CAPTURE_CHANNELS=book.BTC_USDC-PERPETUAL.100ms cargo test deribit::tests::capture_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(WS_URL).await.unwrap();
    let channels: Vec<String> = std::env::var("CAPTURE_CHANNELS")
        .unwrap_or_else(|_| "book.BTC_USDC-PERPETUAL.100ms,book.NOPE_USDC-PERPETUAL.100ms".to_string())
        .split(',')
        .map(str::to_string)
        .collect();
    let heartbeat = serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "public/set_heartbeat", "params": { "interval": 10 } });
    let subscribe = serde_json::json!({ "jsonrpc": "2.0", "id": 2, "method": "public/subscribe", "params": { "channels": channels } });
    ws.send(Message::text(heartbeat.to_string())).await.unwrap();
    ws.send(Message::text(subscribe.to_string())).await.unwrap();
    if let Ok(extra) = std::env::var("CAPTURE_SEND") {
        ws.send(Message::text(extra)).await.unwrap();
    }

    let seconds: u64 = std::env::var("CAPTURE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(30);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    let mut id = 10;
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            continue;
        };
        println!("{} {}", now_ms(), text.as_str());
        if text.as_str().contains("test_request") {
            id += 1;
            let answer = serde_json::json!({ "jsonrpc": "2.0", "id": id, "method": "public/test", "params": {} });
            ws.send(Message::text(answer.to_string())).await.unwrap();
        }
    }
}
