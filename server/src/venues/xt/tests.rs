// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let (base, quote) = raw_market_id.split_once('_').unwrap();
    testing::market(ID, raw_market_id, &base.to_uppercase(), &quote.to_uppercase(), true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("sym{i}_usdt")));
    }
    markets
}

fn venue() -> Xt {
    Xt::new()
}

fn connection(raw_ids: &[&str]) -> Connection<State> {
    let mut list = Vec::with_capacity(raw_ids.len());
    for id in raw_ids {
        list.push(market(id));
    }
    Connection::for_test("xt#linear#0", list)
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

fn send(conn: &mut Connection<State>, frame: Value) -> Published {
    venue().handle(frame.to_string().as_bytes(), conn).unwrap();
    conn.take_published()
}

fn sent(conn: &mut Connection<State>) -> Vec<Value> {
    let mut frames = Vec::new();
    for frame in conn.take_sent() {
        frames.push(parsed(&frame));
    }
    frames
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

fn delta(symbol: &str, fu: u64, u: u64, b: Value, a: Value, t: i64) -> Value {
    json!({
        "topic": "depth_update", "event": format!("depth_update@{symbol},100ms"),
        "data": { "s": symbol, "pu": (fu - 1).to_string(), "fu": fu.to_string(), "u": u.to_string(), "a": a, "b": b, "t": t },
    })
}

fn seed(symbol: &str, id: u64, b: Value, a: Value, t: i64) -> Value {
    json!({ "topic": "depth", "event": format!("depth@{symbol},50"), "data": { "s": symbol, "id": id.to_string(), "a": a, "b": b, "t": t } })
}

// Frames captured live on 2026-10-09 at 17:58 UTC, in the order they arrived, with levels cut to three a side.
// The seed for id ...462 arrived after the deltas up to ...496.
const BTC: u64 = 1603672968000;

fn btc_deltas() -> [Value; 5] {
    [
        delta(
            "btc_usdt", BTC + 439, BTC + 450,
            json!([["82700.6", "56746"], ["82700.4", "0"], ["82700.3", "268"]]),
            json!([["82700.9", "65421"], ["82701.1", "2462"], ["82701.2", "0"]]),
            1791568721890,
        ),
        delta(
            "btc_usdt", BTC + 451, BTC + 462,
            json!([["82700.6", "110127"], ["82700.4", "3605"], ["82700.3", "0"]]),
            json!([["82700.9", "94071"], ["82701.1", "1040"], ["82701.6", "1655"]]),
            1791568722009,
        ),
        delta(
            "btc_usdt", BTC + 463, BTC + 473,
            json!([["82700.6", "122961"], ["82700.4", "3246"], ["82617.8", "178249"]]),
            json!([["82700.9", "155608"], ["82701.1", "2579"], ["82783.7", "160789"]]),
            1791568722222,
        ),
        delta(
            "btc_usdt", BTC + 474, BTC + 484,
            json!([["82700.6", "142937"], ["82700.4", "2741"], ["82617.8", "195507"]]),
            json!([["82700.9", "101840"], ["82701.1", "0"], ["82701.2", "2271"]]),
            1791568722255,
        ),
        delta(
            "btc_usdt", BTC + 485, BTC + 496,
            json!([["82700.6", "63001"], ["82700.4", "3492"], ["82617.8", "155520"]]),
            json!([["82700.9", "82398"], ["82701.1", "4147"], ["82701.2", "0"]]),
            1791568722435,
        ),
    ]
}

fn btc_seed() -> Value {
    seed(
        "btc_usdt", BTC + 462,
        json!([["82700.6", "110127"], ["82700.4", "3605"], ["82700.2", "3540"]]),
        json!([["82700.9", "94071"], ["82701.1", "1040"], ["82701.4", "2670"]]),
        1791568722009,
    )
}

fn btc_next_delta() -> Value {
    delta(
        "btc_usdt", BTC + 497, BTC + 506,
        json!([["82700.6", "118499"], ["82700.4", "580"], ["82617.8", "204727"]]),
        json!([["82700.9", "18496"], ["82701.1", "2066"], ["82783.7", "196429"]]),
        1791568722489,
    )
}

// The book after btc_seed and the three deltas past its id.
fn btc_book() -> (Vec<BookLevel>, Vec<BookLevel>) {
    (
        levels(&[(82700.6, 63001.0), (82700.4, 3492.0), (82700.2, 3540.0), (82617.8, 155520.0)]),
        levels(&[(82700.9, 82398.0), (82701.1, 4147.0), (82701.4, 2670.0), (82783.7, 160789.0)]),
    )
}

// A quiet contract whose first frame was its seed, captured live on 2026-10-09 at 17:49 UTC.
const LOBSTER: u64 = 1603600988000;

fn lobster_seed(id: u64) -> Value {
    seed(
        "龙虾_usdt", LOBSTER + id,
        json!([["0.044100", "9"], ["0.044097", "48"], ["0.044095", "15"]]),
        json!([["0.044124", "7"], ["0.044126", "8"], ["0.044127", "8"]]),
        1791568183972,
    )
}

fn lobster_delta() -> Value {
    delta(
        "龙虾_usdt", LOBSTER + 78, LOBSTER + 90,
        json!([["0.044100", "0"], ["0.044099", "20"], ["0.044097", "73"]]),
        json!([["0.044123", "12"], ["0.044124", "0"], ["0.044234", "977"]]),
        1791568184778,
    )
}

// plan

#[test]
fn puts_100_contracts_on_each_connection_to_the_one_market_endpoint() {
    let plans = venue().plan(&markets(691));

    assert_eq!(plans.len(), 7);
    assert_eq!(plans[0].id, "xt#linear#0");
    assert_eq!(plans[6].id, "xt#linear#6");
    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [100, 100, 100, 100, 100, 100, 91]);
    assert!(plans.iter().all(|plan| plan.url == "wss://fstream.xt.com/ws/market"));
}

#[test]
fn returns_nothing_when_the_venue_lists_no_markets() {
    assert!(venue().plan(&[]).is_empty());
}

// subscribe_frames, ping and settings

#[test]
fn subscribes_the_delta_and_seed_streams_of_a_connection_in_one_frame() {
    let frames = venue().subscribe_frames(&markets(100), &mut State::default());

    assert_eq!(frames.len(), 1);
    let first = parsed(&frames[0]);
    assert_eq!(first["method"], "SUBSCRIBE");
    assert_eq!(first["id"], "subscribe#0");
    let params = first["params"].as_array().unwrap();
    assert_eq!(params.len(), 200);
    assert_eq!(params[0], "depth_update@sym0_usdt,100ms");
    assert_eq!(params[1], "depth@sym0_usdt,50");
    assert_eq!(params[199], "depth@sym99_usdt,50");
}

#[test]
fn pings_with_a_text_ping_every_15_seconds_and_gives_up_after_45_silent_seconds() {
    let Message::Text(ping) = venue().ping(&mut State::default()) else {
        panic!("expected a text ping");
    };
    assert_eq!(ping.as_str(), "ping");

    let settings = venue().settings();
    assert_eq!(settings.ping_every, Some(Duration::from_secs(15)));
    assert_eq!(settings.max_silence, Duration::from_secs(45));
}

// seeds and deltas

#[test]
fn seeds_from_a_depth_frame_and_replays_the_kept_deltas_past_its_id() {
    let mut conn = connection(&["btc_usdt"]);
    for frame in btc_deltas() {
        assert!(send(&mut conn, frame).is_empty());
    }

    let published = send(&mut conn, btc_seed());

    let (bids, asks) = btc_book();
    assert_eq!(published, [("btc_usdt".to_string(), bids, asks)]);
    assert!(!conn.resync_requested());
}

#[test]
fn applies_a_chained_delta_and_deletes_a_zero_size_level() {
    let mut conn = connection(&["btc_usdt"]);
    for frame in btc_deltas() {
        send(&mut conn, frame);
    }
    send(&mut conn, btc_seed());

    let published = send(&mut conn, btc_next_delta());

    assert_eq!(published.len(), 1);
    let (_, bids, asks) = &published[0];
    assert_eq!(bids[..2], levels(&[(82700.6, 118499.0), (82700.4, 580.0)]));
    assert_eq!(asks[..2], levels(&[(82700.9, 18496.0), (82701.1, 2066.0)]));

    let published = send(&mut conn, delta("btc_usdt", BTC + 507, BTC + 521, json!([["82700.6", "0"]]), json!([]), 1791568722640));
    assert_eq!(published[0].1[0], BookLevel { price: 82700.4, size: 580.0 });
}

#[test]
fn skips_a_seed_older_than_the_first_kept_delta_and_takes_the_next() {
    // The first btc_usdt seed of a run on 2026-10-09 at 17:49 UTC sat 24 ids below the first delta the socket sent.
    let mut conn = connection(&["btc_usdt"]);
    let [_, _, third, fourth, fifth] = btc_deltas();
    send(&mut conn, third);

    let older = seed("btc_usdt", BTC + 386, json!([["82636.8", "134614"]]), json!([["82637.1", "92193"]]), 1791568183960);
    assert!(send(&mut conn, older).is_empty());

    send(&mut conn, fourth);
    send(&mut conn, fifth);
    let seed = seed("btc_usdt", BTC + 473, json!([["82700.6", "122961"]]), json!([["82700.9", "155608"]]), 1791568722222);
    let published = send(&mut conn, seed);
    assert_eq!(published[0].1[0], BookLevel { price: 82700.6, size: 63001.0 });
    assert_eq!(published[0].2[0], BookLevel { price: 82700.9, size: 82398.0 });
}

#[test]
fn publishes_a_seed_alone_and_chains_the_first_delta_that_straddles_it() {
    let mut conn = connection(&["龙虾_usdt"]);

    let published = send(&mut conn, lobster_seed(77));
    assert_eq!(published[0].1[0], BookLevel { price: 0.0441, size: 9.0 });

    let published = send(&mut conn, lobster_delta());
    assert_eq!(published[0].1[0], BookLevel { price: 0.044099, size: 20.0 });
    assert_eq!(published[0].2[0], BookLevel { price: 0.044123, size: 12.0 });
}

#[test]
fn a_newer_seed_replaces_one_no_delta_has_reached_and_an_older_one_is_ignored() {
    let mut conn = connection(&["龙虾_usdt"]);
    send(&mut conn, lobster_seed(77));

    assert!(send(&mut conn, lobster_seed(70)).is_empty());
    assert_eq!(send(&mut conn, lobster_seed(90)).len(), 1);
    // Wholly at or below the seed's id, so it changes nothing.
    assert!(send(&mut conn, lobster_delta()).is_empty());
}

#[test]
fn a_delta_that_skips_past_the_seed_empties_the_book_and_waits_for_the_next_seed() {
    let mut conn = connection(&["龙虾_usdt"]);
    send(&mut conn, lobster_seed(70));

    // The seed was published, and the ids between it and this delta never arrived.
    assert_eq!(send(&mut conn, lobster_delta()), [("龙虾_usdt".to_string(), Vec::new(), Vec::new())]);
    assert!(!conn.resync_requested());

    // The next seed bridges the delta that was kept.
    let published = send(&mut conn, lobster_seed(77));
    assert_eq!(published[0].1[0], BookLevel { price: 0.044099, size: 20.0 });
}

#[test]
fn ignores_a_seed_once_the_deltas_carry_the_book() {
    let mut conn = connection(&["龙虾_usdt"]);
    send(&mut conn, lobster_seed(77));
    send(&mut conn, lobster_delta());

    assert!(send(&mut conn, lobster_seed(95)).is_empty());
}

#[test]
fn ignores_a_delta_already_applied() {
    let mut conn = connection(&["龙虾_usdt"]);
    send(&mut conn, lobster_seed(77));
    send(&mut conn, lobster_delta());

    assert!(send(&mut conn, lobster_delta()).is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn a_gap_empties_the_book_and_subscribes_the_seed_stream_again() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["龙虾_usdt"]);
    send(&mut conn, lobster_seed(77));
    send(&mut conn, lobster_delta());

    // The venue dropped ids ...91 on this socket, as it did for 4 to 27 markets at once several times a minute on 2026-10-09.
    let published = send(&mut conn, delta("龙虾_usdt", LOBSTER + 92, LOBSTER + 113, json!([["0.044104", "3"]]), json!([]), 1791568185594));

    assert_eq!(published, [("龙虾_usdt".to_string(), Vec::new(), Vec::new())]);
    assert!(!conn.resync_requested());
    let desync = &logs.events("book_desync")[0];
    assert_eq!(desync.text("reason"), "sequence_gap");
    assert_eq!(desync.number("expected"), (LOBSTER + 91) as f64);
    assert_eq!(desync.number("fu"), (LOBSTER + 92) as f64);
    assert_eq!(conn.state.reseed.streams, ["depth@龙虾_usdt,50"]);
    // The live market's unsubscribe had not left yet, so it is withdrawn.
    assert!(conn.state.unsubscribe.streams.is_empty());

    // The fresh seed bridges the delta that showed the gap.
    let published = send(&mut conn, lobster_seed(100));
    assert_eq!(published[0].1[0], BookLevel { price: 0.044104, size: 3.0 });
}

#[test]
fn a_gap_inside_the_kept_deltas_reseeds_when_the_seed_replays_them() {
    let mut conn = connection(&["btc_usdt"]);
    let [first, second, third, _, fifth] = btc_deltas();
    for frame in [first, second, third, fifth] {
        send(&mut conn, frame);
    }

    let published = send(&mut conn, btc_seed());

    assert_eq!(published, [("btc_usdt".to_string(), Vec::new(), Vec::new())]);
    assert_eq!(conn.state.reseed.streams, ["depth@btc_usdt,50"]);
}

#[test]
fn sends_the_reseeds_of_a_burst_in_one_frame_after_100_ms() {
    let mut conn = connection(&["btc_usdt", "龙虾_usdt"]);
    send(&mut conn, lobster_seed(77));
    send(&mut conn, lobster_delta());
    send(&mut conn, delta("龙虾_usdt", LOBSTER + 92, LOBSTER + 92, json!([]), json!([]), 1));
    send(&mut conn, delta("btc_usdt", BTC + 439, BTC + 450, json!([]), json!([]), 1));
    assert!(sent(&mut conn).is_empty());

    // for_test stamps every frame at 1 ms, so the queue is moved 100 ms back.
    conn.state.reseed.since = 1 - 100;
    send(&mut conn, delta("btc_usdt", BTC + 451, BTC + 462, json!([]), json!([]), 1));

    assert_eq!(sent(&mut conn), [json!({ "method": "SUBSCRIBE", "params": ["depth@龙虾_usdt,50"], "id": "reseed" })]);
}

#[test]
fn keeps_at_most_64_deltas_while_it_waits_for_a_seed() {
    let mut conn = connection(&["龙虾_usdt"]);
    for i in 0..70 {
        send(&mut conn, delta("龙虾_usdt", LOBSTER + 100 + i, LOBSTER + 100 + i, json!([["0.044099", (i + 1).to_string()]]), json!([]), 1));
    }

    // The six oldest were dropped, so a seed below them cannot bridge and one at the seventh can.
    assert!(send(&mut conn, seed("龙虾_usdt", LOBSTER + 104, json!([["0.0441", "1"]]), json!([["0.0442", "1"]]), 1)).is_empty());
    let published = send(&mut conn, seed("龙虾_usdt", LOBSTER + 105, json!([["0.0441", "1"]]), json!([["0.0442", "1"]]), 1));
    assert_eq!(published[0].1, levels(&[(0.0441, 1.0), (0.044099, 70.0)]));
}

// unsubscribing the seed streams

#[test]
fn unsubscribes_the_seed_streams_of_live_markets_once_a_second_has_passed() {
    let mut conn = connection(&["btc_usdt", "龙虾_usdt"]);
    send(&mut conn, lobster_seed(77));
    send(&mut conn, lobster_delta());
    assert!(sent(&mut conn).is_empty());

    for frame in btc_deltas() {
        send(&mut conn, frame);
    }
    send(&mut conn, btc_seed());
    assert!(sent(&mut conn).is_empty());

    // for_test stamps every frame at 1 ms, so the queue is moved a second back.
    conn.state.unsubscribe.since = 1 - 1_000;
    send(&mut conn, btc_next_delta());
    let frames = sent(&mut conn);
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0], json!({ "method": "UNSUBSCRIBE", "params": ["depth@龙虾_usdt,50", "depth@btc_usdt,50"], "id": "seeded" }));
    assert!(conn.state.unsubscribe.streams.is_empty());
}

#[test]
fn unsubscribes_at_once_when_50_seed_streams_are_queued() {
    let mut conn = Connection::for_test("xt#linear#0", markets(50));
    for i in 0..50 {
        let symbol = format!("sym{i}_usdt");
        send(&mut conn, seed(&symbol, 10, json!([["1.0", "1"]]), json!([["1.1", "1"]]), 1));
        send(&mut conn, delta(&symbol, 11, 11, json!([["1.0", "2"]]), json!([]), 1));
    }

    let frames = sent(&mut conn);
    assert_eq!(frames.len(), 1);
    assert_eq!(frames[0]["params"].as_array().unwrap().len(), 50);
}

#[test]
fn reseeds_a_crossed_book_and_publishes_it_empty_meanwhile() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["龙虾_usdt"]);
    send(&mut conn, lobster_seed(77));
    send(&mut conn, lobster_delta());

    // A bid at the best ask, as a level the seed held after the venue removed it would cross once the touch moved through it.
    let published = send(&mut conn, delta("龙虾_usdt", LOBSTER + 91, LOBSTER + 91, json!([["0.044123", "5"]]), json!([]), 1));

    assert_eq!(published, [("龙虾_usdt".to_string(), Vec::new(), Vec::new())]);
    assert_eq!(conn.state.reseed.streams, ["depth@龙虾_usdt,50"]);
    assert!(conn.state.unsubscribe.streams.is_empty());
    assert!(!conn.resync_requested());
    assert_eq!(logs.events("book_desync")[0].text("reason"), "crossed");

    // Deltas wait for the fresh seed, which replays them.
    assert!(send(&mut conn, delta("龙虾_usdt", LOBSTER + 92, LOBSTER + 92, json!([["0.044101", "4"]]), json!([]), 1)).is_empty());
    let published = send(&mut conn, lobster_seed(91));
    assert_eq!(published[0].1[0], BookLevel { price: 0.044101, size: 4.0 });
}

#[test]
fn a_seed_older_than_the_delta_that_crossed_bridges_through_it() {
    let mut conn = connection(&["龙虾_usdt"]);
    send(&mut conn, lobster_seed(77));
    send(&mut conn, lobster_delta());
    send(&mut conn, delta("龙虾_usdt", LOBSTER + 91, LOBSTER + 91, json!([["0.044123", "5"]]), json!([]), 1));

    // Seeds trail the deltas by a few hundred ms, so the first one after the reseed can sit below the delta that crossed.
    let published = send(&mut conn, lobster_seed(90));

    assert_eq!(published[0].1[0], BookLevel { price: 0.044123, size: 5.0 });
    assert_eq!(published[0].2[0], BookLevel { price: 0.044124, size: 7.0 });
}

// control frames and errors

#[test]
fn takes_the_pong_and_an_acknowledgement_quietly() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["btc_usdt"]);

    venue().handle(b"pong", &mut conn).unwrap();
    // Captured live on 2026-10-09.
    send(&mut conn, json!({ "code": 0, "data": { "a": null, "b": null }, "id": "subscribe#0", "msg": "success", "sessionId": "rs-1144394" }));

    assert!(logs.lines().iter().all(|line| line.level > Level::INFO));
}

#[test]
fn logs_a_refused_subscribe_as_a_venue_error() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["btc_usdt"]);

    // Captured live on 2026-10-09 for an unknown symbol, in a frame whose other streams were all served.
    send(
        &mut conn,
        json!({ "code": 1, "data": { "a": null, "b": null }, "id": "probe", "msg": "checkSymbol error, symbol:nope_usdt", "sessionId": "rs-1144842" }),
    );

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("message"), "checkSymbol error, symbol:nope_usdt");
    assert_eq!(errors[0].number("code"), 1.0);
}

#[test]
fn logs_an_unknown_topic_and_a_bare_message_as_notices() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["btc_usdt"]);

    send(&mut conn, json!({ "topic": "mark_price", "event": "mark_price@btc_usdt", "data": { "s": "btc_usdt", "p": "86648.8", "t": 1790134049859_i64 } }));
    send(&mut conn, json!({ "msg": "maintenance" }));

    assert_eq!(logs.events("venue_notice").len(), 2);
}

#[test]
fn drops_a_symbol_the_connection_did_not_subscribe() {
    let (logs, _capture) = capture();
    let mut conn = connection(&["btc_usdt"]);

    assert!(send(&mut conn, lobster_seed(77)).is_empty());

    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "龙虾_usdt");
}

#[test]
fn fails_a_frame_that_is_not_json_or_a_delta_without_its_ids() {
    let mut conn = connection(&["btc_usdt"]);

    assert!(venue().handle(b"not json", &mut conn).is_err());
    let frame = json!({ "topic": "depth_update", "data": { "s": "btc_usdt", "a": [], "b": [] } });
    assert!(venue().handle(frame.to_string().as_bytes(), &mut conn).is_err());
    let frame = json!({ "topic": "depth", "data": { "s": "btc_usdt", "a": [], "b": [] } });
    assert!(venue().handle(frame.to_string().as_bytes(), &mut conn).is_err());
}

// probe

// A probe of the live socket, which prints the first frames of each stream with their levels cut to three a side:
// CAPTURE_MARKETS=btc_usdt,eth_usdt cargo test xt::tests::capture_live_frames -- --ignored --nocapture
// After 4 s it unsubscribes the first market's seed stream, to show whether its depth frames stop.
#[tokio::test]
#[ignore]
async fn capture_live_frames() {
    use futures_util::{SinkExt, StreamExt};
    use std::collections::HashMap;

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut ws, _) = tokio_tungstenite::connect_async(BOOK_URL).await.unwrap();
    let list = std::env::var("CAPTURE_MARKETS").unwrap_or_else(|_| "btc_usdt,1000pepe_usdt,龙虾_usdt,nope_usdt".to_string());
    let symbols: Vec<&str> = list.split(',').collect();
    let mut params = Vec::new();
    for symbol in &symbols {
        params.push(format!("depth_update@{symbol},100ms"));
        params.push(format!("depth@{symbol},50"));
    }
    ws.send(Message::text(json!({ "method": "SUBSCRIBE", "params": params, "id": "probe" }).to_string())).await.unwrap();
    ws.send(Message::text("ping")).await.unwrap();

    let started = tokio::time::Instant::now();
    let deadline = started + Duration::from_secs(10);
    let mut unsubscribed = false;
    let mut seen: HashMap<String, usize> = HashMap::new();
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, ws.next()).await {
        if !unsubscribed && started.elapsed() > Duration::from_secs(4) {
            unsubscribed = true;
            let frame = json!({ "method": "UNSUBSCRIBE", "params": [format!("depth@{},50", symbols[0])], "id": "unsub" });
            ws.send(Message::text(frame.to_string())).await.unwrap();
            println!("{:?} sent {frame}", started.elapsed());
        }
        let Message::Text(text) = message else {
            println!("other {message:?}");
            continue;
        };
        let Ok(mut value) = serde_json::from_str::<Value>(text.as_str()) else {
            println!("{:?} text {text}", started.elapsed());
            continue;
        };
        let key = value["event"].to_string();
        let count = seen.entry(key).or_default();
        *count += 1;
        let limit: usize = std::env::var("CAPTURE_FRAMES").ok().and_then(|n| n.parse().ok()).unwrap_or(3);
        if value["topic"].is_string() && *count > limit {
            continue;
        }
        for side in ["b", "a"] {
            if let Some(levels) = value["data"][side].as_array_mut() {
                print!("{side} {} ", levels.len());
                levels.truncate(3);
            }
        }
        println!("{:?} {value}", started.elapsed());
    }
    println!("{seen:?}");
}

// A probe of the delta chain itself: it opens sockets on every listed contract and prints each break of pu against the last u.
// PROBE_PER_SOCKET sets the markets a socket, and PROBE_SEEDS also subscribes the seed streams:
// LIVE_SECONDS=90 PROBE_PER_SOCKET=50 cargo test xt::tests::probe_delta_chain -- --ignored --nocapture
// On 2026-10-09 it saw 27 breaks in 90 s with 200 markets a socket and 18 with 50, each in a burst of markets on one socket.
#[tokio::test]
#[ignore]
async fn probe_delta_chain() {
    use futures_util::{SinkExt, StreamExt};
    use std::collections::HashMap;

    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let http = reqwest::Client::new();
    let venue = load(&http).await.unwrap();
    let seconds: u64 = std::env::var("LIVE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(60);
    let seeds = std::env::var("PROBE_SEEDS").is_ok();
    let mut tasks = Vec::new();
    let per_socket: usize = std::env::var("PROBE_PER_SOCKET").ok().and_then(|n| n.parse().ok()).unwrap_or(MARKETS_PER_CONNECTION);
    for (i, slice) in venue.markets.chunks(per_socket).enumerate() {
        let plan = EndpointPlan { id: format!("{ID}#probe#{i}"), url: BOOK_URL.to_string(), markets: slice.to_vec() };
        tasks.push(tokio::spawn(async move {
            let (mut ws, _) = tokio_tungstenite::connect_async(BOOK_URL).await.unwrap();
            for slice in plan.markets.chunks(MARKETS_PER_FRAME) {
                let mut params = Vec::new();
                for market in slice {
                    params.push(format!("{DELTA_TOPIC}@{},100ms", market.raw_market_id));
                    if seeds {
                        params.push(seed_stream(&market.raw_market_id));
                    }
                }
                ws.send(Message::text(json!({ "method": "SUBSCRIBE", "params": params, "id": "probe" }).to_string())).await.unwrap();
            }
            let started = tokio::time::Instant::now();
            let deadline = started + Duration::from_secs(seconds);
            let mut ping = tokio::time::interval(Duration::from_secs(15));
            let mut last: HashMap<String, (u64, u64)> = HashMap::new(); // symbol to (u, deltas seen)
            let (mut deltas, mut breaks) = (0, 0);
            loop {
                let message = tokio::select! {
                    _ = tokio::time::sleep_until(deadline) => break,
                    _ = ping.tick() => { ws.send(Message::text("ping")).await.unwrap(); continue; }
                    message = ws.next() => message,
                };
                let Some(Ok(Message::Text(text))) = message else { continue };
                let Ok(value) = serde_json::from_str::<Value>(text.as_str()) else { continue };
                if value["topic"] != "depth_update" {
                    continue;
                }
                let data = &value["data"];
                let symbol = data["s"].as_str().unwrap().to_string();
                let read = |field: &str| data[field].as_str().unwrap().parse::<u64>().unwrap();
                let (pu, fu, u) = (read("pu"), read("fu"), read("u"));
                deltas += 1;
                let entry = last.entry(symbol.clone()).or_insert((pu, 0));
                if entry.0 != pu || fu != pu + 1 {
                    breaks += 1;
                    println!(
                        "{} {symbol} at {:?}: last u {} then pu {pu} fu {fu} u {u}, after {} deltas",
                        plan.id, started.elapsed(), entry.0, entry.1
                    );
                }
                *entry = (u, entry.1 + 1);
            }
            println!("{}: {deltas} deltas, {breaks} breaks", plan.id);
        }));
    }
    for task in tasks {
        task.await.unwrap();
    }
}
