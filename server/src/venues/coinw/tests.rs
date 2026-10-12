// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use std::collections::HashMap;
use tracing::Level as LogLevel;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.strip_suffix("_USDC").unwrap_or(raw_market_id);
    testing::market(ID, raw_market_id, base, "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}")));
    }
    markets
}

fn venue() -> Coinw {
    Coinw::new(&[])
}

fn connection() -> Connection<()> {
    Connection::for_test("coinw#perp#0", vec![market("BTC"), market("BTC_USDC"), market("1000PEPE")])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

// Frames captured live on 2026-10-09, with each book cut to its first three levels a side.
fn btc_depth() -> Value {
    json!({"biz":"futures","data":{
        "asks":[{"m":"1.016","p":"82688.5"},{"m":"0.402","p":"82688.6"},{"m":"0.763","p":"82688.7"}],
        "bids":[{"m":"1.662","p":"82688.3"},{"m":"0.778","p":"82688.2"},{"m":"0.443","p":"82688.1"}],
        "n":"btc","t":1791568298777_i64},"pairCode":"BTC","type":"depth"})
}

// The next BTC frame, which carries the top-level time that the first frame after a subscribe lacks.
fn btc_next_depth() -> Value {
    json!({"biz":"futures","data":{
        "asks":[{"m":"1.016","p":"82688.5"},{"m":"0.112","p":"82688.6"},{"m":"0.763","p":"82688.7"}],
        "bids":[{"m":"1.667","p":"82688.3"},{"m":"0.555","p":"82688.2"},{"m":"0.443","p":"82688.1"}],
        "n":"btc","t":1791568298994_i64},"pairCode":"BTC","time":49821452844116401_i64,"type":"depth"})
}

fn pepe_depth() -> Value {
    json!({"biz":"futures","data":{
        "asks":[{"m":"2611000","p":"0.003912"},{"m":"3625000","p":"0.0039121"},{"m":"3610000","p":"0.0039122"}],
        "bids":[{"m":"3015000","p":"0.0039118"},{"m":"3083000","p":"0.0039117"},{"m":"3867000","p":"0.0039116"}],
        "n":"1000pepe","t":1791568298818_i64},"pairCode":"1000PEPE","type":"depth"})
}

fn ack(kind: &str, pair: &str) -> Value {
    json!({"biz":"futures","channel":"subscribe","data":{"result":true},"pairCode":pair,"type":kind})
}

fn refused_subscribe() -> Value {
    json!({"biz":"futures","channel":"subscribe","data":{"errorCode":1007,"errorMsg":"Invalid parameter","result":false},"pairCode":"BTC","type":"deep"})
}

// The answer to the text "ping".
fn rate_limit_error() -> Value {
    json!({"errorCode":1001,"errorMsg":"Rate Limit","result":false})
}

// The answer to a sub with no params, as the profile captured it on 2026-09-23.
fn exception_error() -> Value {
    json!({"result":false,"errorCode":500,"errorMsg":"exception"})
}

fn pong() -> Value {
    json!({"event":"pong"})
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

#[test]
fn settings_ping_every_20_s_and_call_30_s_of_silence_dead() {
    let settings = venue().settings();

    assert_eq!(settings.ping_every, Some(Duration::from_secs(20)));
    assert_eq!(settings.max_silence, Duration::from_secs(30));
    assert_eq!(settings.subscribe_gap, Duration::from_millis(50));
    assert_eq!(settings.connect_stagger, Duration::from_secs(20));
}

#[test]
fn the_ping_is_the_ping_event() {
    assert_eq!(parsed(&venue().ping(&mut ())), json!({"event": "ping"}));
}

#[test]
fn plans_even_connections_of_at_most_100_markets_on_one_url() {
    let plans = venue().plan(&markets(376));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [94, 94, 94, 94]);
    assert!(plans.iter().all(|plan| plan.url == "wss://ws.futurescw.com/perpum"));
    assert_eq!(plans[3].id, "coinw#perp#3");
    assert_eq!(venue().plan(&markets(100)).len(), 1);
    let sizes: Vec<usize> = venue().plan(&markets(101)).iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [51, 50]);
}

#[test]
fn a_full_connection_stays_under_the_513_subscription_cap() {
    let frames = venue().subscribe_frames(&markets(MARKETS_PER_CONNECTION), &mut ());

    assert_eq!(frames.len(), 400);
    assert!(frames.len() < 513);
}

#[test]
fn subscribes_each_market_to_its_book_and_three_anchor_channels_one_frame_each() {
    let frames = venue().subscribe_frames(&[market("BTC"), market("BTC_USDC")], &mut ());

    let parsed: Vec<Value> = frames.iter().map(parsed).collect();
    assert_eq!(parsed.len(), 8);
    assert_eq!(parsed[0], json!({"event": "sub", "params": {"biz": "futures", "type": "depth", "pairCode": "BTC"}}));
    let kinds: Vec<&str> = parsed.iter().map(|frame| frame["params"]["type"].as_str().unwrap()).collect();
    assert_eq!(kinds, ["depth", "index_price", "mark_price", "funding_rate", "depth", "index_price", "mark_price", "funding_rate"]);
    assert_eq!(parsed[7]["params"]["pairCode"], "BTC_USDC");
}

#[test]
fn depth_subscriptions_stay_within_the_documented_10_per_2_s_across_the_stagger() {
    let settings = venue().settings();
    let per_depth = settings.subscribe_gap * CHANNELS.len() as u32;
    let busiest = venue().plan(&markets(400)).iter().map(|plan| plan.markets.len()).max().unwrap();

    assert!(per_depth >= Duration::from_millis(200));
    assert!(settings.subscribe_gap * (busiest * CHANNELS.len()) as u32 <= settings.connect_stagger);
}

#[test]
fn a_depth_frame_resets_the_book_with_its_levels_in_base_coins() {
    let mut conn = connection();

    let published = send(&mut conn, btc_depth());

    assert_eq!(
        published,
        [(
            "BTC".to_string(),
            levels(&[(82688.3, 1.662), (82688.2, 0.778), (82688.1, 0.443)]),
            levels(&[(82688.5, 1.016), (82688.6, 0.402), (82688.7, 0.763)]),
        )]
    );
}

#[test]
fn every_depth_frame_replaces_the_whole_book() {
    let mut conn = connection();
    send(&mut conn, btc_depth());
    let mut next = btc_next_depth();
    next["data"]["bids"].as_array_mut().unwrap().truncate(1);

    let published = send(&mut conn, next);

    assert_eq!(published[0].1, levels(&[(82688.3, 1.667)]));
    assert_eq!(published[0].2, levels(&[(82688.5, 1.016), (82688.6, 0.112), (82688.7, 0.763)]));
}

#[test]
fn keeps_the_first_20_of_200_levels_a_side() {
    let mut conn = connection();

    let published = send(&mut conn, deep_frame(200));

    assert_eq!(published[0].1.len(), DEPTH_LEVEL);
    assert_eq!(published[0].2.len(), DEPTH_LEVEL);
    assert_eq!(published[0].1[0].price, 82688.3);
    assert_eq!(published[0].2[0].price, 82688.5);
}

fn deep_frame(levels: usize) -> Value {
    let mut frame = btc_depth();
    let mut bids = Vec::new();
    let mut asks = Vec::new();
    for i in 0..levels {
        bids.push(json!({"m": "1.234", "p": format!("{:.1}", 82688.3 - i as f64 * 0.1)}));
        asks.push(json!({"m": "0.567", "p": format!("{:.1}", 82688.5 + i as f64 * 0.1)}));
    }
    frame["data"]["bids"] = json!(bids);
    frame["data"]["asks"] = json!(asks);
    frame
}

#[test]
fn the_trim_keeps_the_first_20_levels_a_side_and_the_rest_of_the_frame() {
    let frame = deep_frame(200);

    let trimmed: Value = serde_json::from_slice(&top_of_book(frame.to_string().as_bytes())).unwrap();

    let mut expected = frame.clone();
    expected["data"]["bids"].as_array_mut().unwrap().truncate(DEPTH_LEVEL);
    expected["data"]["asks"].as_array_mut().unwrap().truncate(DEPTH_LEVEL);
    assert_eq!(trimmed, expected);
}

#[test]
fn the_trim_leaves_a_short_book_and_an_anchor_push_untouched() {
    let short = deep_frame(DEPTH_LEVEL).to_string();
    let index = r#"{"biz":"futures","data":{"n":"btc","p":82728.9,"t":1791568299170},"pairCode":"btc","type":"index_price"}"#;

    assert!(matches!(top_of_book(short.as_bytes()), Cow::Borrowed(_)));
    assert!(matches!(top_of_book(index.as_bytes()), Cow::Borrowed(_)));
}

#[test]
fn a_frame_the_trim_cannot_read_is_parsed_whole_and_still_keeps_20_levels() {
    let mut conn = connection();
    let spaced = deep_frame(200).to_string().replace(r#""bids":["#, r#""bids": ["#).replace(r#""asks":["#, r#""asks": ["#);
    assert!(matches!(top_of_book(spaced.as_bytes()), Cow::Borrowed(_)));

    venue().handle(spaced.as_bytes(), &mut conn).unwrap();
    let published = conn.take_published();

    assert_eq!(published[0].1.len(), DEPTH_LEVEL);
    assert_eq!(published[0].2[DEPTH_LEVEL - 1].price, 82690.4);
}

#[test]
fn an_empty_depth_frame_empties_the_book() {
    let mut conn = connection();
    send(&mut conn, btc_depth());
    let mut frame = btc_next_depth();
    frame["data"]["bids"] = json!([]);
    frame["data"]["asks"] = json!([]);

    let published = send(&mut conn, frame);

    assert_eq!(published, [("BTC".to_string(), Vec::new(), Vec::new())]);
}

#[test]
fn routes_each_book_by_its_pair_code() {
    let mut conn = connection();

    send(&mut conn, btc_depth());
    let published = send(&mut conn, pepe_depth());

    assert_eq!(published[0].0, "1000PEPE");
    assert_eq!(published[0].1[0], BookLevel { price: 0.0039118, size: 3_015_000.0 });
}

#[test]
fn a_depth_frame_of_an_unknown_pair_publishes_nothing_and_warns_once() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let mut frame = btc_depth();
    frame["pairCode"] = json!("NOPE");

    assert!(send(&mut conn, frame.clone()).is_empty());
    assert!(send(&mut conn, frame).is_empty());

    let warned = logs.events("unsubscribed_symbol");
    assert_eq!(warned.len(), 1);
    assert_eq!(warned[0].text("market"), "NOPE");
}

#[test]
fn acknowledgements_and_pongs_change_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    for frame in [ack("depth", "BTC"), ack("index_price", "BTC"), ack("depth", "NOPE"), pong()] {
        assert!(send(&mut conn, frame).is_empty());
    }

    assert!(conn.take_sent().is_empty());
    assert!(!conn.resync_requested());
    assert!(logs.lines().iter().all(|line| line.level > LogLevel::WARN));
}

#[test]
fn a_refused_subscribe_is_logged_as_a_venue_error() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    assert!(send(&mut conn, refused_subscribe()).is_empty());

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].text("connection"), "coinw#perp#0");
    assert_eq!(errors[0].number("code"), 1007.0);
    assert_eq!(errors[0].text("message"), "Invalid parameter");
    assert_eq!(errors[0].text("channel"), "deep");
    assert_eq!(errors[0].text("market"), "BTC");
}

#[test]
fn a_refused_request_of_no_channel_is_logged_as_a_venue_error() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, rate_limit_error());
    send(&mut conn, exception_error());

    let errors = logs.events("venue_error");
    let codes: Vec<f64> = errors.iter().map(|line| line.number("code")).collect();
    assert_eq!(codes, [1001.0, 500.0]);
    assert_eq!(errors[0].text("message"), "Rate Limit");
}

#[test]
fn an_anchor_push_publishes_no_book() {
    let mut conn = connection();

    let frame = json!({"biz":"futures","data":{"n":"btc","p":82728.9,"t":1791568299170_i64},"pairCode":"btc","type":"index_price"});

    assert!(send(&mut conn, frame).is_empty());
}

#[test]
fn an_unparsable_frame_is_an_error() {
    let mut conn = connection();

    assert!(venue().handle(b"not json", &mut conn).is_err());
}

// The book would otherwise show the second bid as the best.
#[test]
fn an_unreadable_level_resyncs_rather_than_publishing_a_book_without_it() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let mut frame = btc_depth();
    frame["data"]["bids"][0]["p"] = json!("");

    assert!(send(&mut conn, frame).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "unordered_book");
}

#[test]
fn a_side_out_of_order_resyncs_since_the_trim_may_have_cut_the_real_top() {
    for side in ["bids", "asks"] {
        let mut conn = connection();
        let mut frame = deep_frame(200);
        frame["data"][side].as_array_mut().unwrap().swap(3, 4);

        assert!(send(&mut conn, frame).is_empty());
        assert!(conn.resync_requested(), "{side}");
    }
}

// BOT's bids held 27.77, 27.76, 27.76 and 27.74 on 2026-10-09.
#[test]
fn a_price_repeated_on_adjacent_levels_is_kept_with_its_last_size() {
    let mut conn = connection();
    let mut frame = btc_depth();
    frame["data"]["bids"] = json!([{"p":"27.77","m":"177.6"},{"p":"27.76","m":"1.8"},{"p":"27.76","m":"142.7"},{"p":"27.74","m":"126.7"}]);
    frame["data"]["asks"] = json!([{"p":"29.31","m":"26"}]);

    let published = send(&mut conn, frame);

    assert!(!conn.resync_requested());
    assert_eq!(published[0].1, levels(&[(27.77, 177.6), (27.76, 142.7), (27.74, 126.7)]));
}

#[test]
fn a_negative_size_resyncs() {
    let mut conn = connection();
    let mut frame = btc_depth();
    frame["data"]["asks"][1]["m"] = json!("-0.402");

    assert!(send(&mut conn, frame).is_empty());
    assert!(conn.resync_requested());
}

// The wire's own key order, asks before bids and p before m, beside a frame with bids first.
#[test]
fn the_trim_keeps_valid_json_whichever_side_comes_first() {
    let level = |price: f64| format!(r#"{{"p":"{price:.1}","m":"0.5"}}"#);
    let side = |from: f64, step: f64| (0..30).map(|i| level(from + step * i as f64)).collect::<Vec<_>>().join(",");
    let asks = side(82688.5, 0.1);
    let bids = side(82688.3, -0.1);
    let wire = format!(r#"{{"biz":"futures","pairCode":"BTC","data":{{"t":1791568298777,"asks":[{asks}],"bids":[{bids}],"n":"btc"}},"time":1,"type":"depth"}}"#);
    let flipped = format!(r#"{{"biz":"futures","pairCode":"BTC","data":{{"t":1791568298777,"bids":[{bids}],"asks":[{asks}],"n":"btc"}},"time":1,"type":"depth"}}"#);

    for text in [wire, flipped] {
        let trimmed: Value = serde_json::from_slice(&top_of_book(text.as_bytes())).unwrap();
        let mut expected: Value = serde_json::from_str(&text).unwrap();
        expected["data"]["bids"].as_array_mut().unwrap().truncate(DEPTH_LEVEL);
        expected["data"]["asks"].as_array_mut().unwrap().truncate(DEPTH_LEVEL);
        assert_eq!(trimmed, expected);

        let mut conn = connection();
        venue().handle(text.as_bytes(), &mut conn).unwrap();
        let published = conn.take_published();
        assert_eq!(published[0].1[DEPTH_LEVEL - 1].price, 82686.4);
        assert_eq!(published[0].2[DEPTH_LEVEL - 1].price, 82690.4);
    }
}

fn sub(kind: &str, pair: &str) -> Message {
    Message::text(json!({"event":"sub","params":{"biz":"futures","type":kind,"pairCode":pair}}).to_string())
}

// A probe of the live socket, which prints the first two frames of each stream with their levels cut to three a side:
// cargo test coinw::tests::capture_live_frames -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(SOCKET_URL).await.unwrap();
    for pair in ["BTC", "BTC_USDC", "1000PEPE", "NOPE", "BTCUSDT"] {
        ws.send(sub("depth", pair)).await.unwrap();
    }
    for kind in ["index_price", "mark_price", "funding_rate"] {
        for pair in ["BTC", "BTC_USDC"] {
            ws.send(sub(kind, pair)).await.unwrap();
        }
    }
    ws.send(sub("deep", "BTC")).await.unwrap();
    ws.send(Message::text(r#"{"event":"ping"}"#)).await.unwrap();
    ws.send(Message::text("ping")).await.unwrap();
    ws.send(Message::text(r#"{"event":"sub"}"#)).await.unwrap();

    let deadline = tokio::time::Instant::now() + Duration::from_secs(7);
    let mut seen: HashMap<String, usize> = HashMap::new();
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let mut value: Value = serde_json::from_str(text.as_str()).unwrap();
        let key = format!("{}{}{}", value["type"], value["pairCode"], value["channel"]);
        let count = seen.entry(key).or_default();
        *count += 1;
        if *count > 2 {
            continue;
        }
        // get_mut, since indexing a Value mutably would add the missing sides as nulls to the printed frame.
        for side in ["bids", "asks"] {
            if let Some(levels) = value.get_mut("data").and_then(|data| data.get_mut(side)).and_then(Value::as_array_mut) {
                println!("{side} {}", levels.len());
                levels.truncate(3);
            }
        }
        println!("{value}");
    }
    println!("{seen:?}");
}

// How many of N subscriptions sent G ms apart on one socket are served:
// PROBE_PAIRS=BTC,ETH PROBE_GAP_MS=50 cargo test coinw::tests::probe_subscribe_rate -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn probe_subscribe_rate() {
    use futures_util::{SinkExt, StreamExt};
    use std::sync::Arc;
    use std::sync::atomic::{AtomicBool, Ordering};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let pairs: Vec<String> = std::env::var("PROBE_PAIRS").unwrap().split(',').map(str::to_string).collect();
    let gap: u64 = std::env::var("PROBE_GAP_MS").ok().and_then(|s| s.parse().ok()).unwrap_or(250);
    let kinds: Vec<String> = std::env::var("PROBE_KINDS").unwrap_or("depth".into()).split(',').map(str::to_string).collect();
    let watch: u64 = std::env::var("PROBE_WATCH_S").ok().and_then(|s| s.parse().ok()).unwrap_or(10);
    let (ws, _) = tokio_tungstenite::connect_async(SOCKET_URL).await.unwrap();
    let (mut sink, mut stream) = ws.split();
    let started = tokio::time::Instant::now();
    let sent_all = Arc::new(AtomicBool::new(false));
    let flag = sent_all.clone();
    tokio::spawn(async move {
        for pair in &pairs {
            for kind in &kinds {
                sink.send(sub(kind, pair)).await.unwrap();
                tokio::time::sleep(Duration::from_millis(gap)).await;
            }
        }
        println!("sent all in {} ms", started.elapsed().as_millis());
        flag.store(true, Ordering::SeqCst);
        loop {
            tokio::time::sleep(Duration::from_secs(15)).await;
            if sink.send(Message::text(r#"{"event":"ping"}"#)).await.is_err() {
                return;
            }
        }
    });

    let mut first: HashMap<String, u128> = HashMap::new();
    let mut frames: HashMap<String, usize> = HashMap::new();
    let mut acks = 0;
    let mut refusals = Vec::new();
    let mut deadline: Option<tokio::time::Instant> = None;
    loop {
        if deadline.is_none() && sent_all.load(Ordering::SeqCst) {
            deadline = Some(tokio::time::Instant::now() + Duration::from_secs(watch));
        }
        let wait = deadline.unwrap_or(tokio::time::Instant::now() + Duration::from_secs(1));
        let message = match tokio::time::timeout_at(wait, stream.next()).await {
            Ok(Some(Ok(message))) => message,
            Ok(other) => {
                println!("socket ended {other:?} at {} ms", started.elapsed().as_millis());
                break;
            }
            Err(_) if deadline.is_some() => break,
            Err(_) => continue,
        };
        let Message::Text(text) = message else { continue };
        let value: Value = serde_json::from_str(text.as_str()).unwrap();
        if value["channel"] == "subscribe" {
            acks += 1;
            if value["data"]["result"] != true {
                refusals.push(value.to_string());
            }
            continue;
        }
        if value["result"] == false {
            refusals.push(value.to_string());
            continue;
        }
        let key = format!("{}:{}", value["type"].as_str().unwrap_or("?"), value["pairCode"].as_str().unwrap_or("?").to_uppercase());
        first.entry(key.clone()).or_insert(started.elapsed().as_millis());
        *frames.entry(key).or_default() += 1;
    }
    let mut served: Vec<_> = first.iter().collect();
    served.sort_by_key(|(_, at)| **at);
    println!("acks {acks}, streams served {}, refusals {}", served.len(), refusals.len());
    for r in refusals.iter().take(5) {
        println!("refusal {r}");
    }
    println!("last first frame {:?}", served.last());
    if std::env::var("PROBE_VERBOSE").is_ok() {
        for (key, at) in &served {
            println!("first {key} at {at} ms, {} frames", frames[*key]);
        }
    }
    let mut by_kind: HashMap<&str, usize> = HashMap::new();
    for key in first.keys() {
        *by_kind.entry(key.split(':').next().unwrap()).or_default() += 1;
    }
    println!("served by kind {by_kind:?}");
}

// Several staggered sockets, each subscribing its slice of the pairs, then each socket's served count and the first unserved positions:
// PROBE_PAIRS=... PROBE_CONNS=4 PROBE_STAGGER_S=20 PROBE_GAP_MS=50 cargo test coinw::tests::probe_connections -- --ignored --nocapture
#[tokio::test(flavor = "multi_thread", worker_threads = 4)]
#[ignore]
async fn probe_connections() {
    use futures_util::{SinkExt, StreamExt};

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let pairs: Vec<String> = std::env::var("PROBE_PAIRS").unwrap().split(',').map(str::to_string).collect();
    let conns: usize = std::env::var("PROBE_CONNS").ok().and_then(|s| s.parse().ok()).unwrap_or(4);
    let stagger: u64 = std::env::var("PROBE_STAGGER_S").ok().and_then(|s| s.parse().ok()).unwrap_or(20);
    let gap: u64 = std::env::var("PROBE_GAP_MS").ok().and_then(|s| s.parse().ok()).unwrap_or(50);
    let kinds: Vec<String> = std::env::var("PROBE_KINDS").unwrap_or("depth,index_price,mark_price,funding_rate".into()).split(',').map(str::to_string).collect();
    let watch: u64 = std::env::var("PROBE_WATCH_S").ok().and_then(|s| s.parse().ok()).unwrap_or(15);
    let per = pairs.len().div_ceil(conns);
    let started = tokio::time::Instant::now();
    let end = started + Duration::from_secs(stagger * (conns as u64 - 1)) + Duration::from_millis(gap * (per * kinds.len()) as u64) + Duration::from_secs(watch);

    let mut tasks = Vec::new();
    for (i, slice) in pairs.chunks(per).enumerate() {
        let slice = slice.to_vec();
        let kinds = kinds.clone();
        tasks.push(tokio::spawn(async move {
            tokio::time::sleep(Duration::from_secs(stagger * i as u64)).await;
            let (ws, _) = tokio_tungstenite::connect_async(SOCKET_URL).await.unwrap();
            let (mut sink, mut stream) = ws.split();
            let opened = started.elapsed().as_millis();
            let to_send = slice.clone();
            let sender = tokio::spawn(async move {
                for pair in &to_send {
                    for kind in &kinds {
                        sink.send(sub(kind, pair)).await.unwrap();
                        tokio::time::sleep(Duration::from_millis(gap)).await;
                    }
                }
                loop {
                    tokio::time::sleep(Duration::from_secs(15)).await;
                    if sink.send(Message::text(r#"{"event":"ping"}"#)).await.is_err() {
                        return;
                    }
                }
            });
            let mut served: HashMap<String, usize> = HashMap::new();
            let mut acks = 0;
            let mut refusals = 0;
            let mut max_lag: i64 = 0;
            while let Ok(Some(Ok(message))) = tokio::time::timeout_at(end, stream.next()).await {
                let Message::Text(text) = message else { continue };
                #[derive(serde::Deserialize)]
                struct Light {
                    #[serde(rename = "type")]
                    kind: Option<String>,
                    #[serde(rename = "pairCode")]
                    pair: Option<String>,
                    channel: Option<String>,
                    result: Option<bool>,
                    data: Option<LightData>,
                }
                #[derive(serde::Deserialize)]
                struct LightData {
                    result: Option<bool>,
                    t: Option<i64>,
                }
                let value: Light = serde_json::from_str(text.as_str()).unwrap();
                if value.channel.as_deref() == Some("subscribe") {
                    acks += 1;
                    if value.data.as_ref().and_then(|d| d.result) != Some(true) {
                        refusals += 1;
                    }
                    continue;
                }
                if value.result == Some(false) {
                    println!("conn {i} error {text}");
                    continue;
                }
                if let Some(t) = value.data.as_ref().and_then(|d| d.t) {
                    max_lag = max_lag.max(crate::clock::now_ms() - t);
                }
                if let Some(pair) = value.pair {
                    *served.entry(format!("{}:{}", value.kind.unwrap_or_default(), pair.to_uppercase())).or_default() += 1;
                }
            }
            sender.abort();
            let mut unserved = Vec::new();
            for (position, pair) in slice.iter().enumerate() {
                if !served.contains_key(&format!("depth:{pair}")) {
                    unserved.push(position);
                }
            }
            println!(
                "conn {i} opened at {opened} ms: {} pairs, {acks} acks, {refusals} refusals, {} streams, max lag {max_lag} ms, depth unserved at positions {unserved:?}",
                slice.len(),
                served.len()
            );
        }));
    }
    for task in tasks {
        task.await.unwrap();
    }
}

// The cost of one 200 level depth frame through handle, in this build:
// cargo test coinw::tests::probe_parse_cost -- --ignored --nocapture
#[test]
#[ignore]
fn probe_parse_cost() {
    let bytes = deep_frame(200).to_string().into_bytes();
    let mut conn = connection();
    let venue = venue();
    let rounds = 2_000;

    let started = std::time::Instant::now();
    for _ in 0..rounds {
        venue.handle(&bytes, &mut conn).unwrap();
        conn.take_published();
    }
    let handle = started.elapsed() / rounds;

    let started = std::time::Instant::now();
    for _ in 0..rounds {
        let _: Value = serde_json::from_slice(&bytes).unwrap();
    }
    let value = started.elapsed() / rounds;

    let started = std::time::Instant::now();
    for _ in 0..rounds {
        let _: IgnoredAny = serde_json::from_slice(&bytes).unwrap();
    }
    let ignored = started.elapsed() / rounds;
    println!("{} bytes: handle {handle:?}, Value {value:?}, IgnoredAny {ignored:?}", bytes.len());
}
