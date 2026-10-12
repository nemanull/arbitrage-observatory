// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::clock::now_ms;
use crate::test_log::capture;
use crate::venues::testing;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::io::Write;
use tokio::time::timeout;
use tokio_tungstenite::connect_async;
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.split('_').next().unwrap();
    testing::market(ID, raw_market_id, base, "USDT", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}_USDT_PERPETUAL")));
    }
    markets
}

fn venue() -> Tothemoon {
    Tothemoon::new(&[])
}

fn connection() -> Connection<HashMap<usize, u64>> {
    Connection::for_test("tothemoon#perp#0", vec![market("BTC_USDT_PERPETUAL"), market("ATOM_USDT_PERPETUAL")])
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

fn book_frame(raw: &str, nonce: u64, bids: Value, asks: Value) -> Value {
    json!({"type":"subscriptionData","server_timestamp":1791576081471_i64,"request_id":raw,"payload":{
        "channel":format!("contractsOrderbookVolumes.{raw}"),
        "data":{"volumes":{"bids":bids,"asks":asks},"instrument_id":raw,"timestamp":1791576080968_i64,"offset":630700940184_i64,"provider_offset":127602809701_i64},
        "nonce":nonce}})
}

// BTC's first five book frames, captured live on 2026-10-09.
// The snapshot holds resting orders at 0.3 and 113625.7, at the edge of its window, and its extended_volumes is cut to one level.
fn btc_snapshot() -> Value {
    json!({"type":"subscriptionData","server_timestamp":1791576081471_i64,"request_id":"BTC_USDT_PERPETUAL","payload":{"channel":"contractsOrderbookVolumes.BTC_USDT_PERPETUAL","data":{"volumes":{
        "bids":{"82283.8":"327018","82283.2":"332220","82326.0":"35204","82322.0":"108759","82326.6":"45326","82326.3":"37226","82283.6":"319012","82322.1":"90709","82321.7":"72974","82283.0":"389802","82326.5":"38984","82321.8":"102018","0.3":"346","82283.5":"312248","82326.7":"50302","82321.4":"91962"},
        "asks":{"82370.1":"350541","82369.9":"345428","82332.8":"64642","82370.0":"380660","82332.7":"110808","82332.6":"107932","82332.4":"76272","82332.5":"98029","82328.3":"40932","82328.0":"46422","82327.9":"58622","82327.8":"56721","113625.7":"262","82328.1":"55677","82370.8":"411400","82370.9":"392283"}},
        "instrument_id":"BTC_USDT_PERPETUAL","timestamp":1791576080968_i64,"offset":630700940184_i64,"provider_offset":127602809701_i64,
        "extended_volumes":{"base":{"bids":{"0.3":"0.00034600"},"asks":{}}}},"nonce":1}})
}

// The second whole window, fresher by 367 ms, without the two resting orders and without extended_volumes.
fn btc_window() -> Value {
    json!({"type":"subscriptionData","server_timestamp":1791576081471_i64,"request_id":"BTC_USDT_PERPETUAL","payload":{"channel":"contractsOrderbookVolumes.BTC_USDT_PERPETUAL","data":{"volumes":{
        "bids":{"82322.0":"108759","82283.6":"319012","82321.4":"91962","82326.3":"37226","82322.1":"90709","82321.7":"72974","82283.5":"312248","82326.5":"38984","82326.6":"45326","82321.8":"102018","82283.0":"389802","82283.2":"332220","82283.8":"327018","82326.0":"70185"},
        "asks":{"82328.3":"95632","82332.8":"64642","82328.0":"46422","82332.7":"110808","82370.9":"392283","82370.1":"350541","82332.6":"107932","82369.9":"345428","82327.9":"58622","82370.8":"411400","82328.1":"55677","82332.4":"76272","82332.5":"98029","82370.0":"380660"}},
        "instrument_id":"BTC_USDT_PERPETUAL","timestamp":1791576081335_i64,"offset":630700940751_i64,"provider_offset":127602809958_i64},"nonce":2}})
}

// Nonce 3 carries an older timestamp and offset than nonce 2, and still applies.
fn btc_older_delta() -> Value {
    json!({"type":"subscriptionData","server_timestamp":1791576081480_i64,"request_id":"BTC_USDT_PERPETUAL","payload":{"channel":"contractsOrderbookVolumes.BTC_USDT_PERPETUAL","data":{"volumes":{
        "bids":{"82326.0":"70185","82326.6":"0"},"asks":{"82327.8":"0","82328.3":"95632"}},
        "instrument_id":"BTC_USDT_PERPETUAL","timestamp":1791576081311_i64,"offset":630700940697_i64,"provider_offset":127602809933_i64,
        "extended_volumes":{"base":{"bids":{"82326.0":"0.07018500","82326.6":"0"},"asks":{"82327.8":"0","82328.3":"0.09563200"}}}},"nonce":3}})
}

fn btc_delta() -> Value {
    json!({"type":"subscriptionData","server_timestamp":1791576081534_i64,"request_id":"BTC_USDT_PERPETUAL","payload":{"channel":"contractsOrderbookVolumes.BTC_USDT_PERPETUAL","data":{"volumes":{
        "bids":{"82326.3":"57333","82326.5":"59824"},"asks":{"82327.9":"0","82328.1":"38454","82328.0":"46051"}},
        "instrument_id":"BTC_USDT_PERPETUAL","timestamp":1791576081343_i64,"offset":630700940770_i64,"provider_offset":127602809965_i64},"nonce":4}})
}

// A side with no change is an empty object.
fn btc_one_sided_delta() -> Value {
    json!({"type":"subscriptionData","server_timestamp":1791576081589_i64,"request_id":"BTC_USDT_PERPETUAL","payload":{"channel":"contractsOrderbookVolumes.BTC_USDT_PERPETUAL","data":{"volumes":{
        "bids":{},"asks":{"82327.9":"35015"}},
        "instrument_id":"BTC_USDT_PERPETUAL","timestamp":1791576081394_i64,"offset":630700941963_i64,"provider_offset":127602809991_i64},"nonce":5}})
}

// ATOM's nonce 2 was a delta, not a second window, on 2026-10-09.
fn atom_snapshot() -> Value {
    json!({"type":"subscriptionData","server_timestamp":1791576080530_i64,"request_id":"ATOM_USDT_PERPETUAL","payload":{"channel":"contractsOrderbookVolumes.ATOM_USDT_PERPETUAL","data":{"volumes":{
        "bids":{"2.012":"131874","2.016":"121527","2.011":"200644","2.015":"91090"},"asks":{"2.024":"162678","2.021":"138610","2.020":"80828","2.019":"107857","2.023":"77006"}},
        "instrument_id":"ATOM_USDT_PERPETUAL","timestamp":1791576080059_i64,"offset":630700935683_i64,"provider_offset":127602809025_i64},"nonce":1}})
}

fn atom_delta() -> Value {
    json!({"type":"subscriptionData","server_timestamp":1791576080622_i64,"request_id":"ATOM_USDT_PERPETUAL","payload":{"channel":"contractsOrderbookVolumes.ATOM_USDT_PERPETUAL","data":{"volumes":{
        "bids":{"2.012":"131874","2.016":"0","2.015":"91090"},"asks":{"2.020":"80828","2.023":"77006","2.019":"107857"}},
        "instrument_id":"ATOM_USDT_PERPETUAL","timestamp":1791576080052_i64,"offset":630700935673_i64,"provider_offset":127602809020_i64},"nonce":2}})
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

fn top(published: &Published) -> (BookLevel, BookLevel) {
    let (_, bids, asks) = &published[0];
    (bids[0], asks[0])
}

// plan and settings

#[test]
fn puts_25_markets_on_each_socket_of_the_web_app_host() {
    let plans = venue().plan(&markets(30));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [25, 5]);
    assert_eq!(plans[0].id, "tothemoon#perp#0");
    assert_eq!(plans[1].id, "tothemoon#perp#1");
    assert_eq!(plans[0].url, "wss://octopus-prod-ws.cryptology.com/v1/connect");
}

#[test]
fn ends_a_socket_silent_for_5_seconds_paces_its_subscribes_and_sends_no_ping_of_its_own() {
    let settings = venue().settings();

    assert_eq!(settings.max_silence, Duration::from_secs(5));
    assert_eq!(settings.subscribe_gap, Duration::from_millis(250));
    assert_eq!(settings.ping_every, None);
}

// subscribe_frames

#[test]
fn subscribes_the_tickers_then_one_book_channel_per_frame_named_by_the_raw_id() {
    let slice = vec![market("BTC_USDT_PERPETUAL"), market("XAU_USDT_PERPETUAL")];

    let frames: Vec<Value> = venue().subscribe_frames(&slice, &mut HashMap::new()).iter().map(parsed).collect();

    assert_eq!(
        frames,
        [
            json!({"type":"subscribe","channel":"turboTickers.*","request_id":"tickers"}),
            json!({"type":"subscribe","channel":"contractsOrderbookVolumes.BTC_USDT_PERPETUAL","request_id":"BTC_USDT_PERPETUAL"}),
            json!({"type":"subscribe","channel":"contractsOrderbookVolumes.XAU_USDT_PERPETUAL","request_id":"XAU_USDT_PERPETUAL"}),
        ]
    );
}

// books

#[test]
fn the_first_frame_replaces_the_book_with_levels_sorted_from_their_unordered_keys() {
    let mut conn = connection();

    let published = send(&mut conn, btc_snapshot());

    assert_eq!(published.len(), 1);
    let (raw, bids, asks) = &published[0];
    assert_eq!(raw, "BTC_USDT_PERPETUAL");
    assert_eq!(bids.len(), 16);
    assert_eq!(asks.len(), 16);
    assert_eq!(bids[..2], levels(&[(82326.7, 50302.0), (82326.6, 45326.0)]));
    assert_eq!(asks[..2], levels(&[(82327.8, 56721.0), (82327.9, 58622.0)]));
    assert_eq!(bids[15], BookLevel { price: 0.3, size: 346.0 });
    assert_eq!(asks[15], BookLevel { price: 113625.7, size: 262.0 });
}

#[test]
fn a_whole_window_at_nonce_2_replaces_the_book_so_no_level_of_the_stale_snapshot_survives() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());

    let published = send(&mut conn, btc_window());

    let (_, bids, asks) = &published[0];
    assert_eq!(bids.len(), 14);
    assert_eq!(asks.len(), 14);
    assert_eq!(top(&published), (BookLevel { price: 82326.6, size: 45326.0 }, BookLevel { price: 82327.9, size: 58622.0 }));
    assert!(bids.iter().all(|level| level.price != 0.3 && level.price != 82326.7));
    assert!(asks.iter().all(|level| level.price != 113625.7 && level.price != 82327.8));
}

#[test]
fn the_older_frame_after_the_window_still_applies_and_a_zero_deletes() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_window());

    let published = send(&mut conn, btc_older_delta());

    assert_eq!(top(&published), (BookLevel { price: 82326.5, size: 38984.0 }, BookLevel { price: 82327.9, size: 58622.0 }));
    assert_eq!(published[0].1[2], BookLevel { price: 82326.0, size: 70185.0 });
    assert_eq!(published[0].2[3], BookLevel { price: 82328.3, size: 95632.0 });
}

#[test]
fn later_deltas_merge_by_price_and_an_empty_side_changes_nothing() {
    let mut conn = connection();
    for frame in [btc_snapshot(), btc_window(), btc_older_delta()] {
        send(&mut conn, frame);
    }

    let published = send(&mut conn, btc_delta());
    assert_eq!(top(&published), (BookLevel { price: 82326.5, size: 59824.0 }, BookLevel { price: 82328.0, size: 46051.0 }));
    let bids_before = published[0].1.clone();

    let published = send(&mut conn, btc_one_sided_delta());
    assert_eq!(published[0].1, bids_before);
    assert_eq!(published[0].2[0], BookLevel { price: 82327.9, size: 35015.0 });
    assert!(!conn.resync_requested());
}

#[test]
fn a_nonce_2_that_is_not_a_whole_window_merges_as_a_delta() {
    let mut conn = connection();
    send(&mut conn, atom_snapshot());

    let published = send(&mut conn, atom_delta());

    let (raw, bids, asks) = &published[0];
    assert_eq!(raw, "ATOM_USDT_PERPETUAL");
    assert_eq!(bids, &levels(&[(2.015, 91090.0), (2.012, 131874.0), (2.011, 200644.0)]));
    assert_eq!(asks.len(), 5);
}

#[test]
fn a_whole_window_after_nonce_3_merges_as_a_delta() {
    let mut conn = connection();
    for frame in [btc_snapshot(), btc_window(), btc_older_delta()] {
        send(&mut conn, frame);
    }
    let mut late = btc_window();
    late["payload"]["nonce"] = json!(4);
    late["payload"]["data"]["volumes"]["bids"].as_object_mut().unwrap().remove("82326.6");

    let published = send(&mut conn, late);

    assert_eq!(published[0].1[0], BookLevel { price: 82326.5, size: 38984.0 });
}

#[test]
fn a_new_snapshot_replaces_the_book_and_restarts_the_count() {
    let mut conn = connection();
    for frame in [btc_snapshot(), btc_window(), btc_older_delta()] {
        send(&mut conn, frame);
    }

    let published = send(&mut conn, btc_snapshot());
    assert_eq!(published[0].1.len(), 16);
    send(&mut conn, btc_window());

    assert!(!conn.resync_requested());
}

#[test]
fn a_nonce_gap_resyncs_without_publishing() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_window());

    let published = send(&mut conn, btc_delta());

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "nonce_gap");
}

#[test]
fn a_delta_before_the_snapshot_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    assert!(send(&mut conn, btc_window()).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn a_delta_that_crosses_the_book_resyncs_without_publishing_it() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_window());

    let published = send(&mut conn, book_frame("BTC_USDT_PERPETUAL", 3, json!({"82330.0":"1000"}), json!({})));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "crossed_book");
}

#[test]
fn a_crossed_snapshot_is_refused_before_it_is_published() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(&mut conn, book_frame("BTC_USDT_PERPETUAL", 1, json!({"82330.0":"1000"}), json!({"82329.0":"1000"})));

    assert!(published.is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "crossed_snapshot");
}

#[test]
fn markets_keep_their_own_nonce() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, atom_snapshot());

    send(&mut conn, btc_window());
    send(&mut conn, atom_delta());

    assert!(!conn.resync_requested());
}

#[test]
fn a_book_for_an_unsubscribed_symbol_is_dropped_with_a_warning() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    let published = send(&mut conn, book_frame("ETH_USDT_PERPETUAL", 1, json!({"2477.19":"1"}), json!({"2477.27":"1"})));

    assert!(published.is_empty());
    assert!(!conn.resync_requested());
    assert_eq!(logs.events("unsubscribed_symbol")[0].text("market"), "ETH_USDT_PERPETUAL");
}

#[test]
fn ignores_the_welcome_and_the_acknowledgements() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    // Captured live on 2026-10-09.
    let welcome = json!({"type":"welcomeMessage","server_timestamp":1791576031744_i64,"payload":{"message":"[prod] Welcome to Cryptology!","connection_id":"6f207b9d-f701-427c-9b94-1ad19e379a1b"}});
    let ack = json!({"type":"subscribedSuccessful","server_timestamp":1791576031895_i64,"request_id":"BTC_USDT_PERPETUAL","payload":{"channel":"contractsOrderbookVolumes.BTC_USDT_PERPETUAL"}});

    assert!(send(&mut conn, welcome).is_empty());
    assert!(send(&mut conn, ack).is_empty());
    assert!(logs.lines().iter().all(|line| line.level > Level::INFO));
}

#[test]
fn logs_an_error_frame_as_venue_error() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    // Captured live on 2026-10-09.
    let error = json!({"type":"errorMessage","server_timestamp":1791576295036_i64,"request_id":"e4","payload":{"code":"COMMON_ERROR","message":"invalid request params: invalid channel fooBar.BTC_USDT_PERPETUAL: invalid channel type fooBar"}});
    send(&mut conn, error);

    let lines = logs.events("venue_error");
    assert_eq!(lines.len(), 1);
    assert_eq!(lines[0].level, Level::ERROR);
    assert_eq!(lines[0].text("code"), "COMMON_ERROR");
    assert_eq!(lines[0].text("request_id"), "e4");
    assert_eq!(lines[0].text("connection"), "tothemoon#perp#0");
    assert!(!conn.resync_requested());
}

#[test]
fn logs_a_null_answer_for_an_unlisted_id_as_venue_error_without_a_resync() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    // Captured live on 2026-10-09.
    let null = json!({"type":"subscriptionData","server_timestamp":1791576295315_i64,"request_id":"NOPE_USDT_PERPETUAL","payload":{"channel":"contractsOrderbookVolumes.NOPE_USDT_PERPETUAL","data":null,"nonce":1}});
    send(&mut conn, null);

    let lines = logs.events("venue_error");
    assert_eq!(lines[0].text("channel"), "contractsOrderbookVolumes.NOPE_USDT_PERPETUAL");
    assert!(!conn.resync_requested());
}

#[test]
fn logs_an_unknown_frame_type_as_a_venue_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send(&mut conn, json!({"type":"THROTTLING","server_timestamp":1791576295315_i64,"payload":{"overflow_level":500}}));

    let lines = logs.events("venue_notice");
    assert_eq!(lines[0].level, Level::WARN);
    assert_eq!(lines[0].text("kind"), "THROTTLING");
}

#[test]
fn fails_on_a_frame_that_is_not_json() {
    let mut conn = connection();

    assert!(venue().handle(b"hello", &mut conn).is_err());
}

#[test]
fn a_ticker_publishes_no_book() {
    let mut conn = connection();
    let ticker = json!({"type":"subscriptionData","server_timestamp":1791576079945_i64,"request_id":"tickers","payload":{"channel":"turboTickers.*","data":{
        "instrument_id":"BTC_USDT_PERPETUAL","mark_price":"82359.3","index_price":"82359.3","funding_rate":"0","funding_interval":28800000,
        "best_bid":"82326.6","best_ask":"82327.8"},"nonce":11}});

    assert!(send(&mut conn, ticker).is_empty());
}

#[test]
fn a_whole_window_at_nonce_3_also_replaces_the_book() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, book_frame("BTC_USDT_PERPETUAL", 2, json!({"82326.6":"1"}), json!({})));
    let mut window = btc_window();
    window["payload"]["nonce"] = json!(3);

    let published = send(&mut conn, window);

    assert_eq!(published[0].1.len(), 14);
    assert!(published[0].1.iter().all(|level| level.price != 0.3 && level.price != 82326.7));
}

#[test]
fn a_full_frame_at_nonce_2_that_deletes_a_level_merges_as_a_delta() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut frame = btc_window();
    frame["payload"]["data"]["volumes"]["bids"]["82326.7"] = json!("0");

    let published = send(&mut conn, frame);

    let bids = &published[0].1;
    assert_eq!(bids[0], BookLevel { price: 82326.6, size: 45326.0 });
    assert!(bids.iter().any(|level| level.price == 0.3));
}

#[test]
fn a_crossed_whole_window_at_nonce_2_resyncs_without_publishing() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut window = btc_window();
    window["payload"]["data"]["volumes"]["bids"]["82400.0"] = json!("1");

    assert!(send(&mut conn, window).is_empty());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "crossed_snapshot");
}

#[test]
fn an_unreadable_level_in_a_snapshot_resyncs_without_publishing() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let mut snapshot = btc_snapshot();
    snapshot["payload"]["data"]["volumes"]["asks"]["82327.8"] = json!("");

    assert!(send(&mut conn, snapshot).is_empty());
    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn an_unreadable_deletion_resyncs_rather_than_leave_the_level_standing() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    send(&mut conn, btc_window());

    let published = send(&mut conn, book_frame("BTC_USDT_PERPETUAL", 3, json!({"82326.6":"zero"}), json!({})));

    assert!(published.is_empty());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn a_book_frame_without_volumes_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut frame = btc_delta();
    frame["payload"]["nonce"] = json!(2);
    frame["payload"]["data"].as_object_mut().unwrap().remove("volumes");

    assert!(send(&mut conn, frame).is_empty());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "book_frame_without_volumes");
}

#[test]
fn a_book_frame_without_a_nonce_resyncs() {
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let mut frame = btc_delta();
    frame["payload"].as_object_mut().unwrap().remove("nonce");

    assert!(send(&mut conn, frame).is_empty());
    assert!(conn.resync_requested());
}

#[test]
fn a_book_frame_that_does_not_parse_resyncs_at_once() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send(&mut conn, btc_snapshot());
    let frame = btc_delta().to_string().replacen("\"nonce\":4", "\"nonce\":\"four\"", 1);

    assert!(venue().handle(frame.as_bytes(), &mut conn).is_err());
    assert!(conn.take_published().is_empty());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "book_frame_unreadable");
}

#[test]
fn a_ticker_frame_that_does_not_parse_leaves_the_books_alone() {
    let mut conn = connection();
    let frame = r#"{"type":"subscriptionData","request_id":"tickers","payload":{"channel":"turboTickers.*","data":{"instrument_id":7},"nonce":"x"}}"#;

    assert!(venue().handle(frame.as_bytes(), &mut conn).is_err());
    assert!(!conn.resync_requested());
}

// probe

// Records every frame of the catalog, ticker and book channels to PROBE_OUT, one line per frame with its arrival in ms.
// PROBE_OUT=/tmp/frames.jsonl PROBE_SECONDS=60 cargo test tothemoon::tests::probe -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn probe() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let out = std::env::var("PROBE_OUT").unwrap();
    let seconds: u64 = std::env::var("PROBE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(60);
    let books = std::env::var("PROBE_BOOKS").unwrap_or_default();
    let mut file = std::fs::File::create(out).unwrap();
    let (mut ws, _) = connect_async("wss://octopus-prod-ws.cryptology.com/v1/connect").await.unwrap();
    let mut channels = vec![
        "turboFutureInstruments.*".to_string(),
        "turboEmergencyMode.*".to_string(),
        "turboTickers.*".to_string(),
    ];
    for id in books.split(',').filter(|id| !id.is_empty()) {
        channels.push(format!("contractsOrderbookVolumes.{id}"));
    }
    let mut raw: Vec<String> = std::env::var("PROBE_RAW").unwrap_or_default().lines().map(str::to_string).collect();
    raw.reverse();
    let mut pending = channels.into_iter();
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    let mut next_send = tokio::time::Instant::now();
    loop {
        if tokio::time::Instant::now() >= next_send && let Some(channel) = pending.next() {
            let request_id = channel.split('.').nth(1).unwrap_or("x").to_string();
            let request_id = if request_id == "*" { channel.clone() } else { request_id };
            let frame = serde_json::json!({"type":"subscribe","channel":channel,"request_id":request_id});
            ws.send(Message::text(frame.to_string())).await.unwrap();
            next_send = tokio::time::Instant::now() + Duration::from_millis(250);
        } else if tokio::time::Instant::now() >= next_send && let Some(frame) = raw.pop() {
            ws.send(Message::text(frame)).await.unwrap();
            next_send = tokio::time::Instant::now() + Duration::from_millis(250);
        }
        let left = deadline.saturating_duration_since(tokio::time::Instant::now());
        if left.is_zero() {
            break;
        }
        match timeout(left.min(Duration::from_millis(100)), ws.next()).await {
            Ok(Some(Ok(Message::Text(text)))) => {
                writeln!(file, "{}\t{}", now_ms(), text.as_str().trim_end()).unwrap();
            }
            Ok(Some(Ok(other))) => {
                writeln!(file, "{}\t#{other:?}", now_ms()).unwrap();
            }
            Ok(Some(Err(error))) => panic!("{error}"),
            Ok(None) => break,
            Err(_) => {}
        }
    }
}
