// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::feeds::anchor_poller::AnchorVenue;
use crate::test_log::capture;
use crate::venues::testing;
use axum::Router;
use axum::http::header::CONTENT_TYPE;
use axum::http::{HeaderMap, StatusCode};
use axum::response::IntoResponse;
use axum::routing::get;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::sync::{Arc, Mutex};
use tokio::net::TcpListener;
use tracing::Level as LogLevel;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(symbol: &str) -> Market {
    testing::market(ID, symbol, symbol, "USDC", true)
}

fn markets(count: usize) -> Vec<Market> {
    (0..count).map(|i| market(&format!("SYM{i}"))).collect()
}

fn venue() -> Pacifica {
    Pacifica::new()
}

fn connection() -> Connection<HashMap<usize, i64>> {
    Connection::for_test("pacifica#perp#0", vec![market("BTC"), market("kPEPE")])
}

fn level(price: f64, size: f64) -> BookLevel {
    BookLevel { price, size }
}

fn send(conn: &mut Connection<HashMap<usize, i64>>, frame: &Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// Frames captured live on 2026-10-12 at 22:45 UTC with the capture below, in the order they came.
// The first BTC book, whole, with its 10 levels a side.
fn btc_book_129626() -> Value {
    json!({ "channel": "book", "data": { "s": "BTC", "l": [
        [{ "p": "82539", "a": "0.00015", "n": 1 }, { "p": "82522", "a": "0.018", "n": 1 }, { "p": "82517", "a": "0.01817", "n": 1 },
         { "p": "82516", "a": "0.01817", "n": 1 }, { "p": "82515", "a": "0.01817", "n": 1 }, { "p": "82514", "a": "0.03028", "n": 2 },
         { "p": "82513", "a": "0.07903", "n": 2 }, { "p": "82512", "a": "0.56336", "n": 2 }, { "p": "82511", "a": "0.03028", "n": 2 },
         { "p": "82510", "a": "0.07586", "n": 4 }],
        [{ "p": "82540", "a": "2.41862", "n": 22 }, { "p": "82541", "a": "0.0543", "n": 2 }, { "p": "82542", "a": "0.34872", "n": 3 },
         { "p": "82543", "a": "0.59938", "n": 3 }, { "p": "82544", "a": "0.01817", "n": 1 }, { "p": "82545", "a": "0.0543", "n": 2 },
         { "p": "82546", "a": "0.66024", "n": 4 }, { "p": "82547", "a": "0.01929", "n": 3 }, { "p": "82548", "a": "0.01817", "n": 1 },
         { "p": "82549", "a": "0.56325", "n": 2 }],
    ], "t": 1791845129626_i64, "li": 14139340761_i64 } })
}

// The next BTC push, 240 ms later, cut to three levels a side.
fn btc_book_130071() -> Value {
    json!({ "channel": "book", "data": { "s": "BTC", "l": [
        [{ "p": "82539", "a": "0.00015", "n": 1 }, { "p": "82522", "a": "0.018", "n": 1 }, { "p": "82519", "a": "0.13935", "n": 1 }],
        [{ "p": "82540", "a": "2.41862", "n": 22 }, { "p": "82541", "a": "0.0543", "n": 2 }, { "p": "82542", "a": "0.34872", "n": 3 }],
    ], "t": 1791845130071_i64, "li": 14139341001_i64 } })
}

// A quiet book is pushed again unchanged, with the same t and li, cut to two levels a side.
fn kpepe_book() -> Value {
    json!({ "channel": "book", "data": { "s": "kPEPE", "l": [
        [{ "p": "0.003982", "a": "3473138", "n": 1 }, { "p": "0.003981", "a": "3474246", "n": 1 }],
        [{ "p": "0.003986", "a": "117088", "n": 1 }, { "p": "0.003987", "a": "1053417", "n": 2 }],
    ], "t": 1791845128814_i64, "li": 14139339306_i64 } })
}

// plan and settings

#[test]
fn puts_20_markets_on_each_socket_for_the_published_cap() {
    let plans = venue().plan(&markets(77));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [20, 20, 20, 17]);
    assert_eq!(plans[0].id, "pacifica#perp#0");
    assert_eq!(plans[3].id, "pacifica#perp#3");
    assert!(plans.iter().all(|plan| plan.url == "wss://ws.pacifica.fi/ws"));
    assert!(venue().plan(&[]).is_empty());
}

#[test]
fn watches_five_seconds_of_silence_pings_every_30_seconds_and_retires_before_the_24_hour_close() {
    let settings = venue().settings();

    assert_eq!(settings.max_silence, Duration::from_secs(5));
    assert_eq!(settings.ping_every, Some(Duration::from_secs(30)));
    assert_eq!(settings.retire_after, Some(Duration::from_secs(23 * 60 * 60)));
    assert_eq!(settings.retire_jitter, Duration::from_secs(30 * 60));
}

// subscribe_frames and ping

#[test]
fn subscribes_the_book_of_each_market_one_frame_each_with_its_aggregation_level() {
    let frames = venue().subscribe_frames(&[market("BTC"), market("kPEPE")], &mut HashMap::new());

    let frames: Vec<Value> = frames.iter().map(parsed).collect();
    assert_eq!(
        frames,
        [
            json!({ "method": "subscribe", "params": { "source": "book", "symbol": "BTC", "agg_level": 1 } }),
            json!({ "method": "subscribe", "params": { "source": "book", "symbol": "kPEPE", "agg_level": 1 } }),
        ]
    );
}

#[test]
fn pings_with_a_text_frame_since_the_server_counts_only_client_messages() {
    assert_eq!(parsed(&venue().ping(&mut HashMap::new())), json!({ "method": "ping" }));
}

// books

#[test]
fn a_book_frame_is_the_whole_book_of_ten_levels_a_side() {
    let mut conn = connection();

    let published = send(&mut conn, &btc_book_129626());

    assert_eq!(published.len(), 1);
    let (symbol, bids, asks) = &published[0];
    assert_eq!(symbol, "BTC");
    assert_eq!((bids.len(), asks.len()), (10, 10));
    assert_eq!(bids[0], level(82539.0, 0.00015));
    assert_eq!(bids[9], level(82510.0, 0.07586));
    assert_eq!(asks[0], level(82540.0, 2.41862));
    assert_eq!(asks[9], level(82549.0, 0.56325));
}

#[test]
fn every_book_frame_replaces_the_whole_book() {
    let mut conn = connection();
    send(&mut conn, &btc_book_129626());

    let published = send(&mut conn, &btc_book_130071());

    let (_, bids, asks) = &published[0];
    assert_eq!(bids, &[level(82539.0, 0.00015), level(82522.0, 0.018), level(82519.0, 0.13935)]);
    assert_eq!(asks.len(), 3);
}

#[test]
fn an_unchanged_repeat_is_published_again_as_a_sign_of_life() {
    let mut conn = connection();
    send(&mut conn, &kpepe_book());

    let repeat = send(&mut conn, &kpepe_book());

    assert_eq!(repeat.len(), 1);
    assert!(!conn.resync_requested());
}

#[test]
fn a_k_market_keeps_its_prices_and_sizes_per_thousand_tokens() {
    let mut conn = connection();

    let published = send(&mut conn, &kpepe_book());

    let (symbol, bids, asks) = &published[0];
    assert_eq!(symbol, "kPEPE");
    assert_eq!(bids[0], level(0.003982, 3473138.0));
    assert_eq!(asks[0], level(0.003986, 117088.0));
}

#[test]
fn an_empty_side_publishes_a_one_sided_book() {
    let mut conn = connection();
    let mut frame = btc_book_130071();
    frame["data"]["l"][1] = json!([]);

    let published = send(&mut conn, &frame);

    let (_, bids, asks) = &published[0];
    assert_eq!(bids.len(), 3);
    assert!(asks.is_empty());
}

#[test]
fn a_book_whose_last_id_went_back_restarts_the_connection() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, &btc_book_130071());

    let published = send(&mut conn, &btc_book_129626());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_frame_older")[0].number("li"), 14139340761.0);
    let resync = logs.events("book_resync");
    assert_eq!(resync[0].text("market"), "BTC");
    assert_eq!(resync[0].text("reason"), "sequence_went_back");
}

#[test]
fn each_market_keeps_its_own_last_id() {
    let mut conn = connection();
    send(&mut conn, &btc_book_130071());

    let published = send(&mut conn, &kpepe_book());

    assert_eq!(published[0].0, "kPEPE");
    assert!(!conn.resync_requested());
}

#[test]
fn a_book_without_a_last_id_is_applied() {
    let mut conn = connection();
    send(&mut conn, &btc_book_130071());
    let mut frame = btc_book_129626();
    frame["data"].as_object_mut().unwrap().remove("li");

    let published = send(&mut conn, &frame);

    assert_eq!(published[0].1.len(), 10);
    assert!(!conn.resync_requested());
}

#[test]
fn a_level_it_cannot_read_restarts_the_connection() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, &btc_book_129626());
    let mut frame = btc_book_130071();
    frame["data"]["l"][0][1]["a"] = json!("x");

    let published = send(&mut conn, &frame);

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn a_book_frame_it_cannot_read_restarts_the_connection() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let mut one_side = btc_book_130071();
    one_side["data"]["l"] = json!([[{ "p": "82539", "a": "0.00015", "n": 1 }]]);

    assert!(venue().handle(one_side.to_string().as_bytes(), &mut conn).is_err());

    assert!(conn.take_published().is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "book_frame_unreadable");
}

#[test]
fn a_frame_that_is_not_json_is_an_error_and_the_connection_carries_on() {
    let mut conn = connection();

    assert!(venue().handle(b"not json", &mut conn).is_err());
    assert!(!conn.resync_requested());
}

// routing, errors and the session

#[test]
fn a_symbol_nobody_subscribed_is_dropped_and_logged_once() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let mut frame = btc_book_130071();
    frame["data"]["s"] = json!("ETH");

    assert!(send(&mut conn, &frame).is_empty());
    assert!(send(&mut conn, &frame).is_empty());

    let warned = logs.events("unsubscribed_symbol");
    assert_eq!(warned.len(), 1);
    assert_eq!(warned[0].text("market"), "ETH");
}

// Captured live on 2026-10-12, the answers to book on NOPE, then on btc, then without agg_level.
#[test]
fn an_error_frame_is_logged_as_a_venue_error_and_the_connection_carries_on() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, &json!({ "error": "Symbol not found" }));
    send(&mut conn, &json!({ "code": 400, "err": "Invalid subscription parameters.", "t": 1791845129902_i64 }));

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].level, LogLevel::ERROR);
    assert_eq!(errors[0].text("connection"), "pacifica#perp#0");
    assert_eq!(errors[0].text("message"), "Symbol not found");
    assert_eq!(errors[1].text("message"), "Invalid subscription parameters.");
    assert_eq!(errors[1].number("code"), 400.0);
    assert!(!conn.resync_requested());
}

#[test]
fn acknowledgements_and_pongs_publish_nothing_and_log_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    assert!(send(&mut conn, &json!({ "channel": "subscribe", "data": { "source": "book", "symbol": "BTC", "agg_level": 1 } })).is_empty());
    assert!(send(&mut conn, &json!({ "channel": "unsubscribe", "data": { "source": "book", "symbol": "BTC", "agg_level": 1 } })).is_empty());
    assert!(send(&mut conn, &json!({ "channel": "pong" })).is_empty());
    assert!(logs.lines().is_empty());
    assert!(conn.take_sent().is_empty());
}

#[test]
fn a_frame_it_does_not_know_is_logged_as_a_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, &json!({ "channel": "bbo", "data": { "s": "ETH", "b": "2491", "a": "2491.1" } }));
    send(&mut conn, &json!({ "notice": "maintenance" }));

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 2);
    assert_eq!(notices[0].text("channel"), "bbo");
    assert!(notices[1].text("frame").contains("maintenance"));
}

// The REST host

// Answers like CloudFront in front of the venue: a GET that carries a body or a content type is refused with a 403 page.
async fn cloudfront_host(seen: Arc<Mutex<Vec<String>>>) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}", listener.local_addr().unwrap());
    let route = |reply: Value| {
        let seen = seen.clone();
        move |headers: HeaderMap, body: String| {
            let seen = seen.clone();
            let reply = reply.clone();
            async move {
                let content_type = headers.get(CONTENT_TYPE).and_then(|value| value.to_str().ok()).unwrap_or("").to_string();
                seen.lock().unwrap().push(format!("{content_type}|{body}"));
                if !body.is_empty() || !content_type.is_empty() {
                    return (StatusCode::FORBIDDEN, "The request could not be satisfied").into_response();
                }
                axum::Json(json!({ "success": true, "data": reply, "error": null, "code": null })).into_response()
            }
        }
    };
    let info = json!([{ "symbol": "BTC", "instrument_type": "perpetual", "base_asset": "BTC" }]);
    let prices = json!([{ "symbol": "BTC", "oracle": "82583.7426", "mark": "82579", "funding": "0.0000125" }]);
    let app = Router::new()
        .route(markets::INFO_PATH, get(route(info)))
        .route(anchor::PRICES_PATH, get(route(prices)));
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    url
}

#[tokio::test]
async fn the_loader_and_the_anchor_send_plain_gets_with_no_body() {
    let seen = Arc::new(Mutex::new(Vec::new()));
    let url = cloudfront_host(seen.clone()).await;

    let venue = markets::load_from(&testing::http(), &url).await.unwrap();
    let rows = Pacifica::with_rest(&url).fetch_round(&testing::http(), 1_791_845_110_000).await.unwrap();

    assert_eq!(testing::raw_ids(&venue.markets), ["BTC"]);
    assert_eq!(rows["BTC"].index, 82583.7426);
    assert_eq!(*seen.lock().unwrap(), ["|", "|"]);
}

// Prints the frames the feed tests are built from:
// cargo test pacifica::tests::capture_frames -- --ignored --nocapture
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
    // An unknown symbol, a lowercase one and a book without agg_level, which all answer with errors.
    for symbol in ["NOPE", "btc"] {
        let frame = json!({ "method": "subscribe", "params": { "source": "book", "symbol": symbol, "agg_level": 1 } });
        socket.send(Message::text(frame.to_string())).await.unwrap();
    }
    socket.send(Message::text(r#"{"method":"subscribe","params":{"source":"book","symbol":"ETH"}}"#)).await.unwrap();
    socket.send(venue().ping(&mut state)).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(3);
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, socket.next()).await {
        if let Message::Text(text) = message {
            println!("{} {text}", crate::clock::now_ms());
        }
    }
}
