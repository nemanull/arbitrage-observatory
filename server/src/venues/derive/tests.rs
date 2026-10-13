// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.strip_suffix("-PERP").unwrap();
    testing::market(ID, raw_market_id, base, "USDC", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}-PERP")));
    }
    markets
}

fn venue() -> Derive {
    Derive::new(&[])
}

fn connection() -> Connection<()> {
    Connection::for_test("derive#perp#0", vec![market("BTC-PERP"), market("CC-PERP")])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

fn book(channel_market: &str, timestamp: i64, publish_id: u64, bids: Value, asks: Value) -> Value {
    json!({"method":"subscription","params":{"channel":format!("orderbook.{channel_market}.1.20"),"data":{
        "timestamp":timestamp,"instrument_name":channel_market,"publish_id":publish_id,"bids":bids,"asks":asks}}})
}

// Consecutive BTC-PERP frames captured live on 2026-10-12, cut from 20 levels a side to three.
// Between the first two, the second and third bids left and two other bids took their places.
fn btc_117410() -> Value {
    book(
        "BTC-PERP",
        1791845512769,
        117410,
        json!([["82534.1","0.0968"],["82531.5","1.2358"],["82530.3","0.02"]]),
        json!([["82534.2","0.02"],["82534.6","0.0363"],["82535.9","0.0605"]]),
    )
}

fn btc_117411() -> Value {
    book(
        "BTC-PERP",
        1791845512972,
        117411,
        json!([["82534.1","0.0968"],["82531.4","0.6179"],["82530.1","0.01"]]),
        json!([["82534.2","0.02"],["82534.6","0.0363"],["82535.9","0.0605"]]),
    )
}

fn btc_117412() -> Value {
    book(
        "BTC-PERP",
        1791845513582,
        117412,
        json!([["82534.1","0.0968"],["82531.4","0.6179"],["82531.3","0.6179"]]),
        json!([["82534.2","0.02"],["82534.6","0.0363"],["82535.9","0.0605"]]),
    )
}

// The whole CC-PERP book of the same capture, two levels a side.
fn cc_6816() -> Value {
    book(
        "CC-PERP",
        1791845512875,
        6816,
        json!([["0.1208","29381.7"],["0.1207","114878"]]),
        json!([["0.1211","135869.3"],["0.1212","8271"]]),
    )
}

fn send(conn: &mut Connection<()>, frame: Value) -> Published {
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
fn puts_every_market_on_one_socket_up_to_5000_so_two_channels_each_stay_inside_the_10000_cap() {
    let plans = venue().plan(&markets(5_001));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [5_000, 1]);
    assert_eq!(plans[0].id, "derive#perp#0");
    assert_eq!(plans[1].id, "derive#perp#1");
    assert_eq!(plans[0].url, "wss://api.derive.xyz/v3/ws");
    assert_eq!(venue().plan(&markets(15)).len(), 1);
}

#[test]
fn ends_a_socket_silent_for_10_seconds_and_leaves_the_keepalive_to_the_server_ping() {
    let settings = venue().settings();

    assert_eq!(settings.max_silence, Duration::from_secs(10));
    assert_eq!(settings.ping_every, None);
    assert_eq!(settings.subscribe_gap, Duration::ZERO);
}

// subscribe_frames

#[test]
fn subscribes_every_book_unaggregated_at_20_levels_then_every_slim_ticker_in_one_request() {
    let frames = venue().subscribe_frames(&[market("BTC-PERP"), market("CC-PERP")], &mut ());

    assert_eq!(frames.len(), 1);
    let frame = parsed(&frames[0]);
    assert_eq!(frame["id"], 1);
    assert_eq!(frame["method"], "subscribe");
    assert_eq!(
        channels(&frame),
        ["orderbook.BTC-PERP.1.20", "orderbook.CC-PERP.1.20", "ticker_slim.BTC-PERP.1000", "ticker_slim.CC-PERP.1000"]
    );
}

#[test]
fn a_full_socket_still_fits_one_request() {
    let frames = venue().subscribe_frames(&markets(5_000), &mut ());

    assert_eq!(frames.len(), 1);
    assert_eq!(channels(&parsed(&frames[0])).len(), 10_000);
}

// handle: books

#[test]
fn hands_the_engine_each_frame_as_the_whole_book() {
    let mut conn = connection();

    let published = send(&mut conn, btc_117410());

    assert_eq!(
        published,
        [(
            "BTC-PERP".to_string(),
            levels(&[(82534.1, 0.0968), (82531.5, 1.2358), (82530.3, 0.02)]),
            levels(&[(82534.2, 0.02), (82534.6, 0.0363), (82535.9, 0.0605)]),
        )]
    );
}

#[test]
fn the_next_frame_replaces_the_book_so_levels_it_leaves_out_are_gone() {
    let mut conn = connection();
    send(&mut conn, btc_117410());

    let published = send(&mut conn, btc_117411());

    assert_eq!(published[0].1, levels(&[(82534.1, 0.0968), (82531.4, 0.6179), (82530.1, 0.01)]));
    assert_eq!(published[0].2, levels(&[(82534.2, 0.02), (82534.6, 0.0363), (82535.9, 0.0605)]));
}

#[test]
fn a_skipped_publish_id_needs_no_resync_since_the_next_frame_is_whole() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_117410());

    let published = send(&mut conn, btc_117412());

    assert_eq!(published[0].1, levels(&[(82534.1, 0.0968), (82531.4, 0.6179), (82531.3, 0.6179)]));
    assert!(!conn.resync_requested());
    assert!(logs.events("book_resync").is_empty());
}

#[test]
fn an_unchanged_book_sent_again_is_published_again() {
    let mut conn = connection();
    send(&mut conn, btc_117412());
    let mut repeat = btc_117412();
    repeat["params"]["data"]["publish_id"] = json!(117413);
    repeat["params"]["data"]["timestamp"] = json!(1791845513784_i64);

    let published = send(&mut conn, repeat);

    assert_eq!(published.len(), 1);
    assert_eq!(published[0].1.len(), 3);
}

// No market sent an empty side on 2026-10-12, and a whole book with none says that side holds no order.
#[test]
fn an_empty_side_empties_that_side_of_the_book() {
    let mut conn = connection();
    send(&mut conn, cc_6816());
    let mut empty = cc_6816();
    empty["params"]["data"]["asks"] = json!([]);

    let published = send(&mut conn, empty);

    assert_eq!(published[0].1, levels(&[(0.1208, 29381.7), (0.1207, 114878.0)]));
    assert!(published[0].2.is_empty());
}

#[test]
fn keeps_the_books_of_two_markets_apart() {
    let mut conn = connection();
    send(&mut conn, btc_117410());

    let published = send(&mut conn, cc_6816());

    assert_eq!(
        published,
        [(
            "CC-PERP".to_string(),
            levels(&[(0.1208, 29381.7), (0.1207, 114878.0)]),
            levels(&[(0.1211, 135869.3), (0.1212, 8271.0)]),
        )]
    );
}

#[test]
fn drops_a_book_the_connection_did_not_subscribe_to_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = Connection::for_test("derive#perp#0", vec![market("ETH-PERP")]);

    let first = send(&mut conn, btc_117410());
    let second = send(&mut conn, btc_117411());

    assert!(first.is_empty() && second.is_empty());
    assert!(!conn.resync_requested());
    let warned = logs.events("unsubscribed_symbol");
    assert_eq!(warned.len(), 1);
    assert_eq!(warned[0].text("market"), "BTC-PERP");
}

#[test]
fn a_ticker_touches_no_book() {
    let mut conn = connection();
    send(&mut conn, btc_117410());

    // The slim ticker captured with the book above.
    let published = send(
        &mut conn,
        json!({"method":"subscription","params":{"channel":"ticker_slim.BTC-PERP.1000","data":{"timestamp":1791845513277_i64,"instrument_ticker":{
            "t":1791845513277_i64,"A":"0.02","a":"82534.2","B":"0.0968","b":"82534.1","f":"0.000012500","option_pricing":null,"I":"82500.3","M":"82531.8",
            "stats":{"c":"90.324","v":"7470353.093","pr":"7474109.415","n":948,"oi":"363.102","h":"84279.9","l":"82282.5","p":"-0.014"},
            "minp":"80913.6","maxp":"84182.5"}}}}),
    );

    assert!(published.is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn reads_the_ticker_market_only_from_a_slim_ticker_at_one_second() {
    assert_eq!(ticker_market("ticker_slim.BTC-PERP.1000"), Some("BTC-PERP"));
    assert_eq!(ticker_market("ticker_slim.BTC-PERP-5.1000"), Some("BTC-PERP-5"));
    assert_eq!(ticker_market("ticker_slim.BTC-PERP.100"), None);
    assert_eq!(ticker_market("ticker.BTC-PERP.1000"), None);
    assert_eq!(ticker_market("orderbook.BTC-PERP.1.20"), None);
}

// handle: session and errors

// Replies and errors captured live on 2026-10-12, each list of channels cut to a few of its 30 or more.
#[test]
fn an_acknowledgement_of_ok_channels_logs_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(
        &mut conn,
        json!({"id":1,"result":{"status":{"orderbook.BTC-PERP.1.20":"ok","ticker_slim.BTC-PERP.1000":"ok"},
            "current_subscriptions":["ticker_slim.BTC-PERP.1000","orderbook.BTC-PERP.1.20"]}}),
    );

    assert!(published.is_empty());
    assert!(logs.events("venue_error").is_empty());
    assert!(logs.events("venue_notice").is_empty());
}

// The second request of the capture, whose unknown name was acknowledged ok and whose repeated channel was already subscribed.
#[test]
fn logs_only_the_refused_channels_of_an_acknowledgement() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(
        &mut conn,
        json!({"id":2,"result":{"status":{"orderbook.BTC-PERP.2.20":"Invalid value `2` for `group`","orderbook.NOPE-PERP.1.20":"ok",
            "ticker_slim.ETH-PERP.1000":"already subscribed"},"current_subscriptions":["ticker_slim.SOL-PERP.1000","orderbook.NOPE-PERP.1.20","ticker_slim.ETH-PERP.1000"]}}),
    );

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "derive#perp#0");
    assert_eq!(errors[0].text("channel"), "orderbook.BTC-PERP.2.20");
    assert_eq!(errors[0].text("status"), "Invalid value `2` for `group`");
}

#[test]
fn logs_a_json_rpc_error_with_its_code_message_and_reason() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(
        &mut conn,
        json!({"jsonrpc":"2.0","error":{"code":-32602,"message":"Invalid params",
            "data":"`ticker` channel has been deprecated. Please use `ticker_slim`. Caught for wallet: "},"id":3}),
    );

    assert!(published.is_empty());
    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].number("code"), -32602.0);
    assert_eq!(errors[0].text("message"), "Invalid params");
    assert_eq!(errors[0].text("data"), "`ticker` channel has been deprecated. Please use `ticker_slim`. Caught for wallet: ");
}

#[test]
fn skips_the_bare_pong_that_answers_a_text_ping() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    venue().handle(b"pong", &mut conn).unwrap();

    assert!(conn.take_published().is_empty());
    assert!(logs.lines().is_empty());
}

#[test]
fn notes_a_json_frame_of_no_known_shape() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, json!({"method":"maintenance","params":null}));

    let notices = logs.events("venue_notice");
    assert_eq!(notices.len(), 1);
    assert_eq!(notices[0].level, Level::WARN);
    assert!(notices[0].text("frame").contains("maintenance"));
}

#[test]
fn fails_a_frame_that_is_not_json_and_quotes_it() {
    let mut conn = connection();

    let error = venue().handle(b"connectionLimitExceeded: 4 sockets", &mut conn).unwrap_err();

    assert!(format!("{error:#}").contains("unreadable frame connectionLimitExceeded: 4 sockets"), "{error:#}");
}

#[test]
fn fails_a_book_frame_without_its_levels() {
    let mut conn = connection();
    let mut frame = btc_117410();
    frame["params"]["data"].as_object_mut().unwrap().remove("bids");

    assert!(venue().handle(frame.to_string().as_bytes(), &mut conn).is_err());
    assert!(conn.take_published().is_empty());
}

// probe

// Prints the raw frames of one book, its ticker, a refused group, the deprecated ticker channel and a text ping, which is how the frames above were checked:
// cargo test derive::tests::capture_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_frames() {
    use crate::clock::now_ms;
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(URL).await.unwrap();
    let good = json!({ "id": 1, "method": "subscribe", "params": {
        "channels": ["orderbook.BTC-PERP.1.20", "ticker_slim.BTC-PERP.1000", "orderbook.BTC-PERP.2.20", "orderbook.NOPE-PERP.1.20"] } });
    let deprecated = json!({ "id": 2, "method": "subscribe", "params": { "channels": ["ticker.BTC-PERP.1000"] } });
    ws.send(Message::text(good.to_string())).await.unwrap();
    ws.send(Message::text(deprecated.to_string())).await.unwrap();
    ws.send(Message::text("ping")).await.unwrap();

    let seconds: u64 = std::env::var("CAPTURE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(5);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        match message {
            Message::Text(text) => println!("{} {}", now_ms(), text.as_str()),
            other => println!("{} {other:?}", now_ms()),
        }
    }
}
