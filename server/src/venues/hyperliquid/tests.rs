// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::feeds::anchor_poller::AnchorVenue;
use crate::test_log::capture;
use crate::venues::testing;
use axum::Router;
use axum::http::header::CONTENT_TYPE;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::post;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(coin: &str) -> Market {
    testing::market(ID, coin, coin, "USDC", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}")));
    }
    markets
}

fn venue() -> Hyperliquid {
    Hyperliquid::new()
}

fn connection() -> Connection<HashMap<usize, Track>> {
    Connection::for_test("hyperliquid#perp#0", vec![market("BTC"), market("kPEPE"), market("MATIC")])
}

fn level(price: f64, size: f64) -> BookLevel {
    BookLevel { price, size }
}

fn send(conn: &mut Connection<HashMap<usize, Track>>, frame: &Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// Frames captured live on 2026-10-08 from the fast book and bbo of BTC, kPEPE and the delisted MATIC, in the order they came.
fn btc_book_038180() -> Value {
    json!({ "channel": "l2Book", "data": { "coin": "BTC", "time": 1791524038180_i64, "levels": [
        [{ "px": "82514.0", "sz": "23.7828", "n": 67 }, { "px": "82513.0", "sz": "0.56121", "n": 4 }, { "px": "82512.0", "sz": "1.21377", "n": 4 },
         { "px": "82511.0", "sz": "2.05943", "n": 6 }, { "px": "82510.0", "sz": "1.879", "n": 13 }],
        [{ "px": "82515.0", "sz": "2.23235", "n": 12 }, { "px": "82517.0", "sz": "0.03657", "n": 2 }, { "px": "82518.0", "sz": "1.03629", "n": 4 },
         { "px": "82519.0", "sz": "0.83883", "n": 1 }, { "px": "82520.0", "sz": "4.7892", "n": 4 }],
    ], "fast": true } })
}

fn btc_bbo_038722() -> Value {
    json!({ "channel": "bbo", "data": { "coin": "BTC", "time": 1791524038722_i64, "bbo": [
        { "px": "82514.0", "sz": "25.18917", "n": 73 }, { "px": "82515.0", "sz": "1.30903", "n": 10 },
    ] } })
}

fn btc_book_038722() -> Value {
    json!({ "channel": "l2Book", "data": { "coin": "BTC", "time": 1791524038722_i64, "levels": [
        [{ "px": "82514.0", "sz": "25.18917", "n": 73 }, { "px": "82513.0", "sz": "0.24289", "n": 4 }, { "px": "82512.0", "sz": "0.005", "n": 1 },
         { "px": "82511.0", "sz": "0.005", "n": 1 }, { "px": "82510.0", "sz": "2.86889", "n": 11 }],
        [{ "px": "82515.0", "sz": "1.30903", "n": 10 }, { "px": "82517.0", "sz": "0.00022", "n": 1 }, { "px": "82518.0", "sz": "0.76941", "n": 4 },
         { "px": "82519.0", "sz": "0.09694", "n": 1 }, { "px": "82520.0", "sz": "3.49175", "n": 4 }],
    ], "fast": true } })
}

fn btc_bbo_038925() -> Value {
    json!({ "channel": "bbo", "data": { "coin": "BTC", "time": 1791524038925_i64, "bbo": [
        { "px": "82514.0", "sz": "23.51469", "n": 69 }, { "px": "82515.0", "sz": "1.43022", "n": 11 },
    ] } })
}

fn kpepe_book() -> Value {
    json!({ "channel": "l2Book", "data": { "coin": "kPEPE", "time": 1791524038180_i64, "levels": [
        [{ "px": "0.003942", "sz": "800942.0", "n": 1 }, { "px": "0.003941", "sz": "3003966.0", "n": 6 }],
        [{ "px": "0.003943", "sz": "8262455.0", "n": 7 }, { "px": "0.003944", "sz": "6544677.0", "n": 11 }],
    ], "fast": true } })
}

fn matic_book() -> Value {
    json!({ "channel": "l2Book", "data": { "coin": "MATIC", "time": 1791524062087_i64, "levels": [[], []], "fast": true } })
}

// The BTC touch of 038925 with its prices moved by hand, as a touch looks after the price ticks down.
fn btc_bbo_ticked_down(time: i64) -> Value {
    json!({ "channel": "bbo", "data": { "coin": "BTC", "time": time, "bbo": [
        { "px": "82512.0", "sz": "3.0", "n": 5 }, { "px": "82513.0", "sz": "0.5", "n": 2 },
    ] } })
}

// plan and settings

#[test]
fn puts_every_market_on_one_socket() {
    let plans = venue().plan(&markets(178));

    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0].id, "hyperliquid#perp#0");
    assert_eq!(plans[0].url, "wss://api.hyperliquid.xyz/ws");
    assert_eq!(plans[0].markets.len(), 178);
    assert!(venue().plan(&[]).is_empty());
}

#[test]
fn watches_ten_seconds_of_silence_pings_every_30_seconds_and_paces_subscribes_at_5_ms() {
    let settings = venue().settings();

    assert_eq!(settings.max_silence, Duration::from_secs(10));
    assert_eq!(settings.ping_every, Some(Duration::from_secs(30)));
    assert_eq!(settings.subscribe_gap, Duration::from_millis(5));
}

// subscribe_frames and ping

#[test]
fn subscribes_the_fast_book_and_the_touch_of_each_coin_one_frame_each() {
    let frames = venue().subscribe_frames(&[market("BTC"), market("kPEPE")], &mut HashMap::new());

    let frames: Vec<Value> = frames.iter().map(parsed).collect();
    assert_eq!(
        frames,
        [
            json!({ "method": "subscribe", "subscription": { "type": "l2Book", "coin": "BTC", "fast": true } }),
            json!({ "method": "subscribe", "subscription": { "type": "bbo", "coin": "BTC" } }),
            json!({ "method": "subscribe", "subscription": { "type": "l2Book", "coin": "kPEPE", "fast": true } }),
            json!({ "method": "subscribe", "subscription": { "type": "bbo", "coin": "kPEPE" } }),
        ]
    );
}

#[test]
fn pings_with_the_method_ping() {
    assert_eq!(parsed(&venue().ping(&mut HashMap::new())), json!({ "method": "ping" }));
}

// books

#[test]
fn a_book_frame_replaces_the_book_with_its_levels() {
    let mut conn = connection();

    let published = send(&mut conn, &btc_book_038180());

    assert_eq!(published.len(), 1);
    let (coin, bids, asks) = &published[0];
    assert_eq!(coin, "BTC");
    assert_eq!(bids.len(), 5);
    assert_eq!(asks.len(), 5);
    assert_eq!(bids[0], level(82514.0, 23.7828));
    assert_eq!(bids[4], level(82510.0, 1.879));
    assert_eq!(asks[0], level(82515.0, 2.23235));
    assert_eq!(asks[1], level(82517.0, 0.03657));
}

#[test]
fn every_book_frame_replaces_the_whole_book() {
    let mut conn = connection();
    send(&mut conn, &btc_book_038180());

    let published = send(&mut conn, &btc_book_038722());

    let (_, bids, asks) = &published[0];
    assert_eq!(bids[..2], [level(82514.0, 25.18917), level(82513.0, 0.24289)]);
    assert_eq!(asks[1], level(82517.0, 0.00022));
    assert_eq!(bids.len(), 5);
}

#[test]
fn a_book_older_than_the_book_applied_is_dropped() {
    let mut conn = connection();
    send(&mut conn, &btc_book_038722());

    assert!(send(&mut conn, &btc_book_038180()).is_empty());
    let repeat = send(&mut conn, &btc_book_038722());
    assert_eq!(repeat[0].1[0], level(82514.0, 25.18917));
}

#[test]
fn a_k_coin_keeps_its_prices_and_sizes_per_thousand_tokens() {
    let mut conn = connection();

    let published = send(&mut conn, &kpepe_book());

    let (coin, bids, asks) = &published[0];
    assert_eq!(coin, "kPEPE");
    assert_eq!(bids[0], level(0.003942, 800942.0));
    assert_eq!(asks[0], level(0.003943, 8262455.0));
}

#[test]
fn a_delisted_coin_publishes_an_empty_book() {
    let mut conn = connection();

    let published = send(&mut conn, &matic_book());

    assert_eq!(published, [("MATIC".to_string(), Vec::new(), Vec::new())]);
}

// touches

#[test]
fn a_touch_newer_than_the_book_moves_the_top_and_keeps_the_depth() {
    let mut conn = connection();
    send(&mut conn, &btc_book_038722());

    let published = send(&mut conn, &btc_bbo_038925());

    let (_, bids, asks) = &published[0];
    assert_eq!(bids[0], level(82514.0, 23.51469));
    assert_eq!(asks[0], level(82515.0, 1.43022));
    assert_eq!(bids[1], level(82513.0, 0.24289));
    assert_eq!((bids.len(), asks.len()), (5, 5));
}

#[test]
fn a_touch_below_the_book_top_drops_the_levels_it_passed() {
    let mut conn = connection();
    send(&mut conn, &btc_book_038722());

    let published = send(&mut conn, &btc_bbo_ticked_down(1791524038925));

    let (_, bids, asks) = &published[0];
    assert_eq!(bids[..3], [level(82512.0, 3.0), level(82511.0, 0.005), level(82510.0, 2.86889)]);
    assert_eq!(asks[..2], [level(82513.0, 0.5), level(82515.0, 1.30903)]);
    assert!(bids[0].price < asks[0].price);
}

#[test]
fn a_touch_from_the_book_block_or_older_changes_nothing() {
    let mut conn = connection();
    send(&mut conn, &btc_book_038722());

    assert!(send(&mut conn, &btc_bbo_038722()).is_empty());
    assert!(send(&mut conn, &btc_bbo_ticked_down(1791524038180)).is_empty());
}

#[test]
fn a_touch_older_than_the_newest_touch_is_dropped() {
    let mut conn = connection();
    send(&mut conn, &btc_book_038180());
    send(&mut conn, &btc_bbo_038925());

    let published = send(&mut conn, &btc_bbo_ticked_down(1791524038722));

    assert!(published.is_empty());
}

#[test]
fn a_touch_before_the_first_book_waits_and_then_lands_on_an_older_book() {
    let mut conn = connection();

    assert!(send(&mut conn, &btc_bbo_038722()).is_empty());
    let published = send(&mut conn, &btc_book_038180());

    let (_, bids, asks) = &published[0];
    assert_eq!(bids[0], level(82514.0, 25.18917));
    assert_eq!(asks[0], level(82515.0, 1.30903));
    assert_eq!(bids[1], level(82513.0, 0.56121));
}

#[test]
fn a_book_older_than_the_newest_touch_keeps_that_touch() {
    let mut conn = connection();
    send(&mut conn, &btc_book_038180());
    send(&mut conn, &btc_bbo_ticked_down(1791524038925));

    let published = send(&mut conn, &btc_book_038722());

    let (_, bids, asks) = &published[0];
    assert_eq!(bids[0], level(82512.0, 3.0));
    assert_eq!(asks[0], level(82513.0, 0.5));
}

#[test]
fn a_null_side_on_a_touch_empties_that_side() {
    let mut conn = connection();
    send(&mut conn, &btc_book_038722());
    let mut frame = btc_bbo_038925();
    frame["data"]["bbo"][1] = Value::Null;

    let published = send(&mut conn, &frame);

    let (_, bids, asks) = &published[0];
    assert_eq!(bids[0], level(82514.0, 23.51469));
    assert!(asks.is_empty());
}

// routing, errors and the session

#[test]
fn a_coin_nobody_subscribed_is_dropped_and_logged_once() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let mut frame = btc_book_038180();
    frame["data"]["coin"] = json!("ETH");

    assert!(send(&mut conn, &frame).is_empty());
    assert!(send(&mut conn, &frame).is_empty());

    let warned = logs.events("unsubscribed_symbol");
    assert_eq!(warned.len(), 1);
    assert_eq!(warned[0].text("market"), "ETH");
}

// Both captured live on 2026-10-08, a second subscribe of one stream and a coin array.
#[test]
fn an_error_frame_is_logged_as_a_venue_error_and_the_connection_carries_on() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let already = json!({ "channel": "error", "data": "Already subscribed: {\"type\":\"bbo\",\"coin\":\"BTC\"}" });
    let refused = json!({ "channel": "error", "data": "Error parsing JSON into valid websocket request: {\"method\":\"subscribe\",\"subscription\":{\"type\":\"bbo\",\"coin\":[\"BTC\",\"ETH\"]}}" });

    send(&mut conn, &already);
    send(&mut conn, &refused);

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "hyperliquid#perp#0");
    assert!(errors[0].text("message").starts_with("Already subscribed"));
    assert!(errors[1].text("message").contains("valid websocket request"));
    assert!(!conn.resync_requested());
}

#[test]
fn acknowledgements_and_pongs_publish_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let ack = json!({ "channel": "subscriptionResponse", "data": { "method": "subscribe", "subscription": { "type": "l2Book", "coin": "BTC", "nSigFigs": null, "mantissa": null, "fast": true } } });

    assert!(send(&mut conn, &ack).is_empty());
    assert!(send(&mut conn, &json!({ "channel": "pong" })).is_empty());
    assert!(logs.lines().is_empty());
    assert!(conn.take_sent().is_empty());
}

#[test]
fn a_frame_that_is_not_json_or_a_book_without_both_sides_is_an_error() {
    let mut conn = connection();
    let mut one_side = btc_book_038180();
    one_side["data"]["levels"] = json!([[{ "px": "1.0", "sz": "1.0", "n": 1 }]]);

    assert!(venue().handle(b"not json", &mut conn).is_err());
    assert!(venue().handle(one_side.to_string().as_bytes(), &mut conn).is_err());
    assert!(conn.take_published().is_empty());
}

// info calls

// Answers like the venue: POST /info routed by the body's type, 422 for any other type, and 405 for a GET.
async fn info_host(calls: Arc<Mutex<Vec<(String, Value)>>>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let universe = json!({ "universe": [{ "name": "BTC" }, { "name": "MATIC", "isDelisted": true }], "collateralToken": 0 });
    let context = json!({ "funding": "0.0000125", "oraclePx": "82533.0", "markPx": "82512.0" });
    let answer = move |headers: HeaderMap, body: String| {
        let calls = calls.clone();
        let universe = universe.clone();
        let context = context.clone();
        async move {
            let body: Value = serde_json::from_str(&body).unwrap_or(Value::Null);
            let content_type = headers.get(CONTENT_TYPE).and_then(|value| value.to_str().ok()).unwrap_or("").to_string();
            calls.lock().unwrap().push((content_type, body.clone()));
            match body["type"].as_str() {
                Some("meta") => axum::Json(universe).into_response(),
                Some("metaAndAssetCtxs") => axum::Json(json!([universe, [context.clone(), context]])).into_response(),
                _ => (StatusCode::UNPROCESSABLE_ENTITY, "Failed to deserialize the JSON body into the target type").into_response(),
            }
        }
    };
    let app = Router::new().route(INFO_PATH, post(answer));
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    url
}

#[tokio::test]
async fn the_loader_and_the_anchor_each_post_their_info_type_as_json() {
    let calls = Arc::new(Mutex::new(Vec::new()));
    let url = info_host(calls.clone()).await;

    let venue = markets::load_from(&testing::http(), &url).await.unwrap();
    let rows = Hyperliquid::with_rest(&url).fetch_round(&testing::http(), 1_791_523_914_000).await.unwrap();

    assert_eq!(testing::raw_ids(&venue.markets), ["BTC"]);
    assert_eq!(rows["BTC"].index, 82533.0);
    assert_eq!(
        *calls.lock().unwrap(),
        [
            ("application/json".to_string(), json!({ "type": "meta" })),
            ("application/json".to_string(), json!({ "type": "metaAndAssetCtxs" })),
        ]
    );
}

// Prints the frames the feed tests are built from:
// cargo test hyperliquid::tests::capture_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_frames() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut socket, _) = tokio_tungstenite::connect_async(URL).await.unwrap();
    let list = std::env::var("CAPTURE_MARKETS").unwrap_or_else(|_| "BTC,kPEPE".to_string());
    let markets: Vec<Market> = list.split(',').map(market).collect();
    let mut state = HashMap::new();
    for frame in venue().subscribe_frames(&markets, &mut state) {
        socket.send(frame).await.unwrap();
    }
    // A second subscribe and a coin array, which both answer on the error channel.
    socket.send(Message::text(r#"{"method":"subscribe","subscription":{"type":"bbo","coin":"BTC"}}"#)).await.unwrap();
    socket.send(Message::text(r#"{"method":"subscribe","subscription":{"type":"bbo","coin":["BTC","ETH"]}}"#)).await.unwrap();
    socket.send(venue().ping(&mut state)).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(6);
    let mut printed = 0;
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, socket.next()).await {
        let Message::Text(text) = message else {
            continue;
        };
        if printed < 40 {
            println!("{text}");
        }
        printed += 1;
    }
}
