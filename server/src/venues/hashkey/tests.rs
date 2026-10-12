// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

const BTC: &str = "BTCUSDT-PERPETUAL";
const ETH: &str = "ETHUSDT-PERPETUAL";

fn market(id: &str) -> Market {
    testing::market(ID, id, &id[..3], "USDT", true)
}

fn venue() -> Hashkey {
    Hashkey::new(&[])
}

fn connection() -> Connection<HashMap<usize, u64>> {
    Connection::for_test("hashkey#perp#0", vec![market(BTC), market(ETH)])
}

fn level(price: f64, size: f64) -> BookLevel {
    BookLevel { price, size }
}

fn send(conn: &mut Connection<HashMap<usize, u64>>, frame: &Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// Frames captured live on 2026-10-09 at 18:36 UTC from v2, in the order they came, with the levels cut to three a side.
fn ack(symbol: &str) -> Value {
    json!({ "topic": "depth", "event": "sub", "params": { "symbol": symbol }, "code": "0", "msg": "Success" })
}

fn unknown_symbol() -> Value {
    json!({ "topic": "depth", "event": "sub", "params": { "symbol": "NOPEUSDT-PERPETUAL" }, "code": "-100011", "msg": "Parameter error!" })
}

fn invalid_json() -> Value {
    json!({ "code": "-10001", "desc": "Invalid JSON!" })
}

fn pong() -> Value {
    json!({ "pong": 1791570979279_i64 })
}

fn eth_9469() -> Value {
    json!({ "topic": "depth", "params": { "symbol": ETH }, "data": {
        "s": ETH, "t": 1791570979469_i64, "v": "56043857_2",
        "b": [["2480.59", "8"], ["2477.56", "20199"], ["2477.38", "61"]],
        "a": [["2480.6", "190657"], ["2481", "202"], ["2481.19", "202"]],
    }})
}

fn btc_9570() -> Value {
    json!({ "topic": "depth", "params": { "symbol": BTC }, "data": {
        "s": BTC, "t": 1791570979570_i64, "v": "27621095_1",
        "b": [["82364.1", "5"], ["82327.4", "2"], ["82325.7", "608"]],
        "a": [["82364.2", "1218"], ["82387.8", "14"], ["82401.7", "538"]],
    }})
}

fn btc_9771() -> Value {
    json!({ "topic": "depth", "params": { "symbol": BTC }, "data": {
        "s": BTC, "t": 1791570979771_i64, "v": "27621104_1",
        "b": [["82364.1", "5"], ["82327.4", "2"], ["82325.7", "608"]],
        "a": [["82364.2", "1218"], ["82387.8", "14"], ["82390", "2283"]],
    }})
}

// The REST book of BTC captured live on 2026-10-09 at 18:37 UTC, cut to three levels a side from 87 bids and 60 asks.
fn btc_rest_book() -> Value {
    json!({ "t": 1791571049724_i64,
        "b": [["82338.9", "6"], ["82336.1", "2"], ["82333.2", "608"]],
        "a": [["82339", "1222"], ["82347.8", "2"], ["82383.7", "14"]],
    })
}

#[test]
fn pings_every_ten_seconds_and_ends_a_connection_silent_for_twenty_five() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(10)));
    assert_eq!(settings.max_silence, Duration::from_secs(25));
    let ping = parsed(&venue().ping(&mut HashMap::new()));
    assert!(ping["ping"].as_i64().unwrap() > 1_700_000_000_000);
}

#[test]
fn plans_every_market_on_one_v2_socket() {
    let plans = venue().plan(&[market(BTC), market(ETH)]);

    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0].id, "hashkey#perp#0");
    assert_eq!(plans[0].url, "wss://stream-glb.hashkey.com/quote/ws/v2");
    assert_eq!(testing::raw_ids(&plans[0].markets), [BTC, ETH]);
}

#[test]
fn subscribes_each_market_in_its_own_frame() {
    let frames = venue().subscribe_frames(&[market(BTC), market(ETH)], &mut HashMap::new());

    assert_eq!(frames.len(), 2);
    assert_eq!(parsed(&frames[0]), json!({ "topic": "depth", "event": "sub", "params": { "symbol": BTC } }));
    assert_eq!(parsed(&frames[1])["params"]["symbol"], ETH);
}

#[test]
fn every_push_replaces_the_whole_book() {
    let mut conn = connection();

    let first = send(&mut conn, &btc_9570());
    let second = send(&mut conn, &btc_9771());

    assert_eq!(first[0].0, BTC);
    assert_eq!(first[0].1, [level(82364.1, 5.0), level(82327.4, 2.0), level(82325.7, 608.0)]);
    assert_eq!(first[0].2[2], level(82401.7, 538.0));
    // 82401.7 left the book in the second push, which a delta could only say with a zero size.
    assert_eq!(second[0].2, [level(82364.2, 1218.0), level(82387.8, 14.0), level(82390.0, 2283.0)]);
}

#[test]
fn routes_each_push_by_its_symbol() {
    let mut conn = connection();

    let published = send(&mut conn, &eth_9469());

    assert_eq!(published.len(), 1);
    assert_eq!(published[0].0, ETH);
    assert_eq!(published[0].2[0], level(2480.6, 190657.0));
}

#[test]
fn drops_a_push_that_repeats_the_last_version() {
    let mut conn = connection();
    send(&mut conn, &btc_9771());

    assert!(send(&mut conn, &btc_9771()).is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn resyncs_when_the_version_goes_back() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, &btc_9771());

    assert!(send(&mut conn, &btc_9570()).is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("market"), BTC);
}

// An empty side is a real state of a whole book, as on the delisted BTCUSD-PERPETUAL's v1 snapshot of 2026-09-23.
#[test]
fn a_push_with_an_empty_side_empties_that_side() {
    let mut conn = connection();
    send(&mut conn, &btc_9570());
    let mut frame = btc_9771();
    frame["data"]["a"] = json!([]);

    let published = send(&mut conn, &frame);

    assert_eq!(published[0].1.len(), 3);
    assert!(published[0].2.is_empty());
}

#[test]
fn a_push_missing_a_side_is_an_error_and_publishes_nothing() {
    let mut conn = connection();
    let mut frame = btc_9570();
    frame["data"].as_object_mut().unwrap().remove("a");

    assert!(venue().handle(frame.to_string().as_bytes(), &mut conn).is_err());
    assert!(conn.take_published().is_empty());
}

#[test]
fn the_version_of_each_market_is_its_own() {
    let mut conn = connection();
    send(&mut conn, &eth_9469()); // 56043857 is far above BTC's 27621095

    assert_eq!(send(&mut conn, &btc_9570()).len(), 1);
}

#[test]
fn applies_a_push_whose_version_does_not_parse() {
    let mut conn = connection();
    send(&mut conn, &btc_9771());
    let mut frame = btc_9570();
    frame["data"]["v"] = json!("");

    assert_eq!(send(&mut conn, &frame).len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn a_push_whose_version_does_not_parse_keeps_the_last_version() {
    let mut conn = connection();
    send(&mut conn, &btc_9570());
    let mut frame = btc_9771();
    frame["data"]["v"] = json!("");
    send(&mut conn, &frame);

    assert_eq!(send(&mut conn, &btc_9771()).len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn drops_a_push_for_a_symbol_it_did_not_subscribe() {
    let (logs, _capture) = capture();
    let mut conn = Connection::for_test("hashkey#perp#0", vec![market(ETH)]);

    venue().handle(btc_9570().to_string().as_bytes(), &mut conn).unwrap();

    assert!(conn.take_published().is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

#[test]
fn the_acknowledgement_requests_the_rest_seed_of_its_market() {
    let mut conn = connection();

    send(&mut conn, &ack(ETH));
    send(&mut conn, &ack(BTC));
    send(&mut conn, &ack(BTC)); // a duplicate subscribe is acknowledged again

    assert_eq!(conn.queued_snapshots(), [1, 0]);
}

#[test]
fn an_acknowledgement_after_the_first_push_requests_no_seed() {
    let mut conn = connection();
    send(&mut conn, &btc_9570());

    send(&mut conn, &ack(BTC));

    assert!(conn.queued_snapshots().is_empty());
}

#[test]
fn seeds_the_rest_book_of_a_market_the_socket_has_not_served() {
    let mut conn = connection();
    send(&mut conn, &ack(BTC));

    venue().handle_snapshot(0, btc_rest_book().to_string().as_bytes(), &mut conn).unwrap();
    let published = conn.take_published();

    assert_eq!(published.len(), 1);
    assert_eq!(published[0].0, BTC);
    assert_eq!(published[0].1, [level(82338.9, 6.0), level(82336.1, 2.0), level(82333.2, 608.0)]);
    assert_eq!(published[0].2[0], level(82339.0, 1222.0));
}

#[test]
fn a_push_after_the_seed_replaces_it() {
    let mut conn = connection();
    venue().handle_snapshot(0, btc_rest_book().to_string().as_bytes(), &mut conn).unwrap();
    conn.take_published();

    let published = send(&mut conn, &btc_9570());

    assert_eq!(published[0].1[0], level(82364.1, 5.0));
}

#[test]
fn ignores_a_seed_that_arrives_after_the_first_push() {
    let mut conn = connection();
    send(&mut conn, &btc_9570());

    venue().handle_snapshot(0, btc_rest_book().to_string().as_bytes(), &mut conn).unwrap();

    assert!(conn.take_published().is_empty());
    assert_eq!(send(&mut conn, &btc_9771())[0].1[0], level(82364.1, 5.0));
}

#[test]
fn a_seed_that_is_not_a_book_is_an_error() {
    let mut conn = connection();

    let reply = json!({ "code": -100011, "msg": "Not supported symbols" }); // the body of the 400 for an unknown symbol

    assert!(venue().handle_snapshot(0, reply.to_string().as_bytes(), &mut conn).is_err());
    assert!(conn.take_published().is_empty());
}

#[test]
fn seeds_from_the_rest_book_of_two_hundred_levels() {
    let url = venue().snapshot_url(&market(BTC)).unwrap();

    assert_eq!(url, "https://api-glb.hashkey.com/quote/v1/depth?symbol=BTCUSDT-PERPETUAL&limit=200");
}

#[test]
fn logs_a_request_error_with_its_market_and_message() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    assert!(send(&mut conn, &unknown_symbol()).is_empty());

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "hashkey#perp#0");
    assert_eq!(errors[0].text("market"), "NOPEUSDT-PERPETUAL");
    assert_eq!(errors[0].text("code"), "-100011");
    assert_eq!(errors[0].text("message"), "Parameter error!");
    assert!(conn.queued_snapshots().is_empty());
}

#[test]
fn logs_an_error_that_names_no_request_with_its_description() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, &invalid_json());
    send(&mut conn, &json!({ "code": -10004, "desc": "Invalid topic!" })); // live as the string "-10004", here as a number

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].text("code"), "-10001");
    assert_eq!(errors[0].text("message"), "Invalid JSON!");
    assert_eq!(errors[0].text("market"), "");
    assert_eq!(errors[1].text("code"), "-10004");
}

#[test]
fn the_pong_and_the_acknowledgements_log_nothing_above_debug() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    assert!(send(&mut conn, &pong()).is_empty());
    assert!(send(&mut conn, &ack(BTC)).is_empty());
    let cancel = json!({ "topic": "depth", "event": "cancel", "params": { "symbol": BTC }, "code": "0", "msg": "Success" });
    assert!(send(&mut conn, &cancel).is_empty());

    assert!(logs.lines().iter().all(|line| line.level > Level::INFO));
}

#[test]
fn logs_a_frame_it_does_not_know_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, &json!({ "topic": "bbo", "params": { "symbol": BTC }, "data": { "s": BTC, "b": "86645.7", "bz": "310" } }));

    assert_eq!(logs.events("venue_notice").len(), 1);
}

#[test]
fn reports_a_frame_that_is_not_json() {
    let mut conn = connection();

    assert!(venue().handle(b"not json", &mut conn).is_err());
}

// A probe of the live socket, which prints each frame with its levels cut to three a side:
// cargo test hashkey::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let (mut ws, _) = tokio_tungstenite::connect_async(URL).await.unwrap();
    for symbol in [BTC, ETH, "NOPEUSDT-PERPETUAL", "BTCUSD-PERPETUAL"] {
        let frame = json!({ "topic": TOPIC, "event": "sub", "params": { "symbol": symbol } });
        ws.send(Message::text(frame.to_string())).await.unwrap();
    }
    ws.send(Message::text("not json")).await.unwrap();
    ws.send(Message::text(json!({ "topic": "nope", "event": "sub", "params": { "symbol": BTC } }).to_string()))
        .await
        .unwrap();
    ws.send(Message::text(json!({ "ping": 12345 }).to_string())).await.unwrap();

    let seconds: u64 = std::env::var("PROBE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(12);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            println!("non text {message:?}");
            continue;
        };
        let mut value: Value = serde_json::from_str(text.as_str()).unwrap();
        if let Some(data) = value.get_mut("data") {
            for side in ["b", "a"] {
                if let Some(levels) = data.get_mut(side).and_then(Value::as_array_mut) {
                    print!("{side} {} ", levels.len());
                    levels.truncate(3);
                }
            }
        }
        println!("{} {value}", now_ms());
    }
}
