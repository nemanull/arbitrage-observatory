// Feed tests on frames captured live from wss://stream.zoomex.com/v5/public/linear on 2026-10-09, with the levels cut down.
// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    testing::market(ID, raw_market_id, &raw_market_id[..3], "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}USDT")));
    }
    markets
}

fn venue() -> Zoomex {
    Zoomex::new(&[])
}

fn connection() -> Connection<HashMap<usize, i64>> {
    Connection::for_test("zoomex#linear#0", vec![market("BTCUSDT"), market("CHRUSDT")])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// The own BTCUSDT book's snapshot, whose `u` is Zoomex's own and not Bybit's.
fn btc_snapshot() -> Value {
    json!({
        "cts": 1791571959352_i64,
        "data": {
            "a": [["82489.60", "30.112"], ["82489.70", "34.559"], ["82489.80", "9.053"]],
            "b": [["82489.50", "36.567"], ["82489.40", "16.632"], ["82488.20", "22.188"]],
            "s": "BTCUSDT", "seq": 267266127703_i64, "u": 17400848,
        },
        "topic": "orderbook.50.BTCUSDT", "ts": 1791571959637_i64, "type": "snapshot",
    })
}

fn btc_delta(u: i64) -> Value {
    json!({
        "cts": 1791571960355_i64,
        "data": { "a": [["82489.60", "30.076"]], "b": [], "s": "BTCUSDT", "seq": 267266129548_i64, "u": u },
        "topic": "orderbook.50.BTCUSDT", "ts": 1791571960357_i64, "type": "delta",
    })
}

// The relayed CHRUSDT book, which carries Bybit's `u` and `seq`.
fn chr_snapshot() -> Value {
    json!({
        "cts": 1791571959544_i64,
        "data": {
            "a": [["0.022994", "881.6"], ["0.022996", "342.8"], ["0.022999", "881.6"]],
            "b": [["0.022961", "1430.0"], ["0.022953", "342.8"], ["0.022952", "342.8"]],
            "s": "CHRUSDT", "seq": 354937861906_i64, "u": 36248574,
        },
        "topic": "orderbook.50.CHRUSDT", "ts": 1791571959577_i64, "type": "snapshot",
    })
}

fn chr_delta(u: i64) -> Value {
    json!({
        "cts": 1791571959954_i64,
        "data": {
            "a": [["0.022996", "0"]],
            "b": [["0.022968", "342.8"], ["0.022961", "0"]],
            "s": "CHRUSDT", "seq": 354937862817_i64, "u": u,
        },
        "topic": "orderbook.50.CHRUSDT", "ts": 1791571959957_i64, "type": "delta",
    })
}

// A control frame carries no `data` and no `topic`.
fn control(success: bool, ret_msg: &str, op: &str) -> Value {
    json!({
        "success": success,
        "ret_msg": ret_msg,
        "conn_id": "db292md48aephea0qcg0-13xiy",
        "req_id": "sub-2",
        "op": op,
    })
}

fn send(conn: &mut Connection<HashMap<usize, i64>>, frame: Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn text(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// plan

#[test]
fn chunks_markets_onto_linear_sockets_of_two_hundred() {
    let plans = venue().plan(&markets(450));

    let ids: Vec<&str> = plans.iter().map(|plan| plan.id.as_str()).collect();
    assert_eq!(ids, ["zoomex#linear#0", "zoomex#linear#1", "zoomex#linear#2"]);
    assert_eq!(plans[0].markets.len(), 200);
    assert_eq!(plans[2].markets.len(), 50);
    assert_eq!(plans[0].url, "wss://stream.zoomex.com/v5/public/linear");
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames

#[test]
fn subscribes_each_depth_fifty_topic_in_its_own_frame_so_a_refusal_costs_only_that_market() {
    let frames = venue().subscribe_frames(&markets(200), &mut HashMap::new());

    assert_eq!(frames.len(), 200);
    let first = text(&frames[0]);
    let last = text(&frames[199]);
    assert_eq!(first, json!({ "req_id": "sub-1", "op": "subscribe", "args": ["orderbook.50.SYM0USDT"] }));
    assert_eq!(last, json!({ "req_id": "sub-200", "op": "subscribe", "args": ["orderbook.50.SYM199USDT"] }));
}

// ping

#[test]
fn pings_every_5_s_because_the_server_closes_a_socket_silent_for_10_s() {
    let venue = venue();

    assert_eq!(text(&venue.ping(&mut HashMap::new())), json!({ "op": "ping" }));
    assert_eq!(venue.settings().ping_every, Some(Duration::from_secs(5)));
    assert_eq!(venue.settings().max_silence, Duration::from_secs(15));
}

// handle

#[test]
fn hands_the_engine_a_subscribed_snapshot_as_the_whole_book() {
    let mut conn = connection();

    let published = send(&mut conn, btc_snapshot());

    assert_eq!(
        published,
        [(
            "BTCUSDT".to_string(),
            levels(&[(82489.5, 36.567), (82489.4, 16.632), (82488.2, 22.188)]),
            levels(&[(82489.6, 30.112), (82489.7, 34.559), (82489.8, 9.053)]),
        )]
    );
}

#[test]
fn applies_a_delta_with_the_next_update_id_and_deletes_a_level_of_size_zero() {
    let mut conn = connection();
    send(&mut conn, chr_snapshot());

    let published = send(&mut conn, chr_delta(36248575));

    assert_eq!(published.len(), 1);
    assert_eq!(published[0].0, "CHRUSDT");
    assert_eq!(published[0].1, levels(&[(0.022968, 342.8), (0.022953, 342.8), (0.022952, 342.8)]));
    assert_eq!(published[0].2, levels(&[(0.022994, 881.6), (0.022999, 881.6)]));
}

#[test]
fn chains_each_market_by_its_own_update_id() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, chr_snapshot());

    let chr = send(&mut conn, chr_delta(36248575));
    let btc = send(&mut conn, btc_delta(17400849));

    assert_eq!(chr.len(), 1);
    assert_eq!(btc[0].2[0], BookLevel { price: 82489.6, size: 30.076 });
    assert!(!conn.resync_requested());
}

#[test]
fn routes_by_the_topic_when_an_own_book_names_an_internal_symbol() {
    let mut conn = connection();
    let mut snapshot = btc_snapshot();
    snapshot["data"]["s"] = json!("BTC2USDT");

    let published = send(&mut conn, snapshot);

    assert_eq!(published.len(), 1);
    assert_eq!(published[0].0, "BTCUSDT");
}

#[test]
fn restarts_the_connection_on_a_gap_in_the_update_id_and_applies_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, chr_snapshot());

    let published = send(&mut conn, chr_delta(36248576));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(conn.book(1).unwrap().bids()[0], BookLevel { price: 0.022961, size: 1430.0 });
    let resync = logs.events("book_resync");
    assert_eq!(resync.len(), 1);
    assert_eq!(resync[0].level, Level::WARN);
    assert_eq!(resync[0].text("market"), "CHRUSDT");
    assert_eq!(resync[0].text("reason"), "sequence_gap");
}

#[test]
fn restarts_the_connection_on_a_delta_with_no_snapshot_behind_it() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(&mut conn, chr_delta(36248575));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn takes_a_restart_snapshot_with_u_of_1_as_a_replacement_of_the_book() {
    let mut conn = connection();
    send(&mut conn, chr_snapshot());
    let mut restart = chr_snapshot();
    restart["data"]["u"] = json!(1);
    restart["data"]["b"] = json!([["0.022900", "1"]]);
    restart["data"]["a"] = json!([["0.023000", "1"]]);

    let replaced = send(&mut conn, restart);
    let mut next = chr_delta(2);
    next["data"]["a"] = json!([]);
    next["data"]["b"] = json!([["0.022899", "2"]]);
    let published = send(&mut conn, next);

    assert_eq!(replaced.len(), 1);
    assert_eq!(published[0].1, levels(&[(0.0229, 1.0), (0.022899, 2.0)]));
    assert_eq!(published[0].2, levels(&[(0.023, 1.0)]));
}

#[test]
fn passes_a_one_sided_book_through_with_the_empty_side_empty() {
    let mut conn = connection();
    let mut snapshot = btc_snapshot();
    snapshot["data"]["a"] = json!([]);

    let published = send(&mut conn, snapshot);

    assert_eq!(published[0].1.len(), 3);
    assert!(published[0].2.is_empty());
}

#[test]
fn drops_a_symbol_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = Connection::for_test("zoomex#linear#0", vec![market("BTCUSDT")]);

    let first = send(&mut conn, chr_snapshot());
    let second = send(&mut conn, chr_snapshot());

    assert!(first.is_empty() && second.is_empty());
    assert_eq!(logs.events("unsubscribed_symbol").len(), 1);
}

#[test]
fn logs_a_refused_topic_and_stays_silent_on_the_acknowledgement_and_the_pong() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, control(true, "", "subscribe"));
    send(&mut conn, control(true, "pong", "ping"));
    let published = send(&mut conn, control(false, "error:handler not found,topic:orderbook.50.NOPEUSDT", "subscribe"));

    assert!(published.is_empty());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("op"), "subscribe");
    assert_eq!(errors[0].text("message"), "error:handler not found,topic:orderbook.50.NOPEUSDT");
}

#[test]
fn fails_on_a_frame_that_is_not_json() {
    let mut conn = connection();

    assert!(venue().handle(b"not json", &mut conn).is_err());
}

// A probe of the live socket, which prints the first frames of each topic with their levels cut to three a side:
// cargo test zoomex::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(LINEAR_URL).await.unwrap();
    let list = std::env::var("CAPTURE_MARKETS").unwrap_or_else(|_| "BTCUSDT,CHRUSDT".to_string());
    let mut args = Vec::new();
    for symbol in list.split(',') {
        args.push(format!("orderbook.{DEPTH}.{symbol}"));
    }
    ws.send(Message::text(json!({ "req_id": "sub-1", "op": "subscribe", "args": args }).to_string())).await.unwrap();
    ws.send(Message::text(json!({ "req_id": "sub-2", "op": "subscribe", "args": ["orderbook.50.NOPEUSDT"] }).to_string())).await.unwrap();
    ws.send(Message::text(r#"{"op":"ping"}"#)).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(4);
    let mut seen: HashMap<String, usize> = HashMap::new();
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let mut value: Value = serde_json::from_str(text.as_str()).unwrap();
        let key = value["topic"].to_string();
        let count = seen.entry(key).or_default();
        *count += 1;
        if value["topic"].is_string() && *count > 3 {
            continue;
        }
        for side in ["b", "a"] {
            // get_mut, because indexing a Value mutably inserts the missing keys into the printed frame.
            if let Some(levels) = value.get_mut("data").and_then(|data| data.get_mut(side)).and_then(Value::as_array_mut) {
                println!("{side} {}", levels.len());
                levels.truncate(3);
            }
        }
        println!("{value}");
    }
}
