// The engine's received levels are read through Connection::take_published after each frame.

use super::*;
use crate::test_log::capture;
use crate::venues::testing;
use flate2::Compression;
use flate2::write::GzEncoder;
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use std::collections::HashMap;
use std::io::Write;
use std::time::Duration;
use tokio::time::{Instant, timeout};
use tokio_tungstenite::connect_async;
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

const T0: i64 = 1_791_576_064_000; // 2026-10-09 20:01:04 UTC, when these frames were captured

fn market(venue_id: &str, raw_market_id: &str) -> Market {
    testing::market(venue_id, raw_market_id, "BTC", "USDT", true)
}

fn venue(profile: &'static Profile) -> Chainup {
    Chainup::with_hosts(profile, &[], profile.rest, "http://127.0.0.1:9")
}

fn connection(profile: &Profile, raws: &[&str]) -> Connection<()> {
    let markets = raws.iter().map(|raw| market(profile.id, raw)).collect();
    Connection::for_test(&format!("{}#perp#0", profile.id), markets)
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    pairs.iter().map(|&(price, size)| BookLevel { price, size }).collect()
}

fn gzip(frame: &Value) -> Vec<u8> {
    let mut encoder = GzEncoder::new(Vec::new(), Compression::default());
    encoder.write_all(frame.to_string().as_bytes()).unwrap();
    encoder.finish().unwrap()
}

fn send(venue: &Chainup, conn: &mut Connection<()>, frame: &[u8]) -> Published {
    venue.handle_at(frame, conn, T0).unwrap();
    conn.take_published()
}

fn text(frame: &Message) -> String {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    text.to_string()
}

fn channels(frames: &[Message]) -> Vec<String> {
    frames
        .iter()
        .map(|frame| {
            let value: Value = serde_json::from_str(&text(frame)).unwrap();
            assert_eq!(value["event"], "sub");
            value["params"]["channel"].as_str().unwrap().to_string()
        })
        .collect()
}

// Frames captured live on 2026-10-09, with each book cut to three levels a side.
// Aivora sends text, with four strings per level: price, size, cumulative size and cumulative price times size.
fn aivora_book() -> Value {
    json!({"eventResp":"sub","channel":"market_e_btcusdt_depth_0.1","tick":{
        "asks":[["82342.5","57542","57542","4738152135.0"],["82342.6","53742","111284","9163408144.2"],["82342.7","68106","179390","14771440070.4"]],
        "bids":[["82342.4","62412","62412","5139153868.8"],["82342.3","63013","125425","10328002658.7"],["82342.2","50122","175547","14452338167.1"]],
        "ts":"2026-10-09T20:01:04Z"},"ts":"2026-10-09T20:01:05Z"})
}

fn aivora_ticker() -> Value {
    json!({"eventResp":"sub","channel":"market_e_btcusdt","tick":{"symbol":"E_BTCUSDT","open":"81803.2","close":"82342.5","amount":"7098786132004.4",
        "vol":"86027351","piece":"0","high":"83379.7","low":"81563.2","rose":"0.704198653","timestamp":1791576064,"utime":"2026-10-09T20:01:04Z",
        "base":"BTC","quote":"USDT","sign_price":"82342.4","index_price":"82364.6366666666666667","funding_rate_last":"-0.0000525627429384",
        "funding_rate_next":"0.0000800000000000","ts":1791576064000_i64,"admin_fund_rate_source":"\"third\"","last_fund_rate_third":"-0.0000312"},
        "ts":"2026-10-09T20:01:05Z"})
}

// SPCX's ticker carries neither sign_price nor index_price, and its REST index read 0.
fn aivora_spcx_ticker() -> Value {
    json!({"eventResp":"sub","channel":"market_e_spcxusdt","tick":{"symbol":"E_SPCXUSDT","open":"161.65","close":"162.92","base":"SPCX","quote":"USDT",
        "funding_rate_last":"0.","ts":1791577513000_i64,"admin_fund_rate_source":"\"third\"","last_fund_rate_third":"0.00033963"},"ts":"2026-10-09T20:25:14Z"})
}

fn aivora_ping() -> Value {
    json!({"ts":"2026-10-09T20:01:12Z","ping":1791576072})
}

// FameEX, x.me and Koinbay send gzip, with the bids under buys and numbers for prices and sizes.
fn fameex_book() -> Value {
    json!({"channel":"market_e_btcusdt_depth_step0","event_rep":"","status":"ok","tick":{
        "asks":[[82346.0,10931],[82346.3,248],[82346.4,251]],"buys":[[82345.9,604],[82345.6,201],[82345.5,350]]},"ts":1791576100387_i64})
}

fn fameex_next_book() -> Value {
    json!({"channel":"market_e_btcusdt_depth_step0","event_rep":"","status":"ok","tick":{
        "asks":[[82344.2,13166],[82344.5,266]],"buys":[[82344.1,1212]]},"ts":1791576100887_i64})
}

// The answer to the client's {"pong":ms}.
fn fameex_ping() -> Value {
    json!({"ping":1791576114})
}

fn xme_ticker() -> Value {
    json!({"event_rep":"","channel":"market_e_btcusdt_ticker","data":null,"tick":{"mark":"82313.3","index":"82305.4","amount":"5423726467269.2",
        "vol":"65745377","high":"83517.6","low":"81570.6","open":"81754.8","close":"82299.2","rose":"0.0067","funds_rate":"0.00018579"},
        "ts":1791576314252_i64,"status":"ok"})
}

// The one frame an unknown symbol gets.
fn xme_empty_book() -> Value {
    json!({"event_rep":"","channel":"market_e_btcusdt_depth_step0","data":null,"tick":{"asks":[],"buys":[]},"ts":1791576314000_i64,"status":"ok"})
}

fn xme_ping() -> Value {
    json!({"ping":1791576318})
}

fn koinbay_mark() -> Value {
    json!({"event_rep":"","channel":"mark_price_e_btcusdt","data":null,"tick":{"tagPrice":"82316.74552980666209560",
        "indexPrice":"82342.66999999999542890","currentFundRate":"0.0001000000000000","nextFundRate":"0.000100",
        "nextSettlementTime":"1791590400000","symbol":"e_btcusdt"},"ts":1791576344000_i64,"status":"ok","timezone":""})
}

fn koinbay_book() -> Value {
    json!({"event_rep":"","channel":"market_e_ssvusdt_depth_step0","data":null,"tick":{
        "asks":[[2.843,215],[2.845,412],[2.847,68]],"buys":[[2.81,68],[2.809,217],[2.808,212]]},"ts":1791576344000_i64,"status":"ok","timezone":""})
}

fn schedule(venue: &Chainup, raw: &str, hours: f64, next_at: i64) {
    let row = markets::ScheduleRow { raw: raw.to_string(), contract: String::new(), interval_hours: hours, next_at };
    venue.schedule.lock().unwrap().replace(vec![row]);
}

#[test]
fn each_member_keeps_its_silence_limit_and_only_fameex_pings() {
    assert_eq!(venue(&AIVORA).settings().max_silence, Duration::from_secs(25));
    assert_eq!(venue(&FAMEEX).settings().max_silence, Duration::from_secs(10));
    assert_eq!(venue(&XME).settings().max_silence, Duration::from_secs(10));
    assert_eq!(venue(&KOINBAY).settings().max_silence, Duration::from_secs(30));
    assert_eq!(venue(&FAMEEX).settings().ping_every, Some(Duration::from_secs(15)));
    for profile in [&AIVORA, &XME, &KOINBAY] {
        assert_eq!(venue(profile).settings().ping_every, None);
    }
}

#[test]
fn fameex_pings_with_a_pong_of_the_clock_in_ms() {
    let frame = text(&venue(&FAMEEX).ping(&mut ()));
    let value: Value = serde_json::from_str(&frame).unwrap();

    assert!(value["pong"].as_i64().unwrap() > T0);
}

#[test]
fn plans_each_member_in_slices_of_its_connection_size() {
    let markets: Vec<Market> = (0..300).map(|i| market(XME.id, &format!("e_sym{i}usdt"))).collect();

    let plans = venue(&XME).plan(&markets);

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [133, 133, 34]);
    assert_eq!(plans[1].id, "xme#perp#1");
    assert_eq!(plans[0].url, "wss://futuresws.x.me/kline-api/ws");
}

#[test]
fn subscribes_each_book_with_the_anchor_channel_of_the_member() {
    let markets = [market("x", "e_btcusdt")];

    let fameex = channels(&venue(&FAMEEX).subscribe_frames(&markets, &mut ()));
    let xme = channels(&venue(&XME).subscribe_frames(&markets, &mut ()));
    let koinbay = channels(&venue(&KOINBAY).subscribe_frames(&markets, &mut ()));

    assert_eq!(fameex, ["market_e_btcusdt_depth_step0"]);
    assert_eq!(xme, ["market_e_btcusdt_depth_step0", "market_e_btcusdt_ticker"]);
    assert_eq!(koinbay, ["market_e_btcusdt_depth_step0", "mark_price_e_btcusdt"]);
}

#[test]
fn aivora_subscribes_the_book_at_its_price_tick_and_leaves_out_a_contract_with_no_known_tick() {
    markets::set_depth_step("aivora", "e_tickonlyusdt", "0.01".to_string());
    let markets = [market("aivora", "e_tickonlyusdt"), market("aivora", "e_unknowntickusdt")];
    let aivora = venue(&AIVORA);

    let plans = aivora.plan(&markets);
    let subscribed = channels(&aivora.subscribe_frames(&plans[0].markets, &mut ()));

    assert_eq!(plans.len(), 1);
    assert_eq!(plans[0].markets.len(), 1);
    assert_eq!(subscribed, ["market_e_tickonlyusdt_depth_0.01", "market_e_tickonlyusdt"]);
}

#[test]
fn an_aivora_text_book_replaces_the_book_and_skips_the_cumulative_columns() {
    let mut conn = connection(&AIVORA, &["e_btcusdt"]);

    let published = send(&venue(&AIVORA), &mut conn, aivora_book().to_string().as_bytes());

    assert_eq!(published.len(), 1);
    assert_eq!(published[0].0, "e_btcusdt");
    assert_eq!(published[0].1, levels(&[(82342.4, 62412.0), (82342.3, 63013.0), (82342.2, 50122.0)]));
    assert_eq!(published[0].2, levels(&[(82342.5, 57542.0), (82342.6, 53742.0), (82342.7, 68106.0)]));
}

#[test]
fn a_gzip_book_replaces_the_whole_book_each_frame() {
    let fameex = venue(&FAMEEX);
    let mut conn = connection(&FAMEEX, &["e_btcusdt"]);
    send(&fameex, &mut conn, &gzip(&fameex_book()));

    let published = send(&fameex, &mut conn, &gzip(&fameex_next_book()));

    assert_eq!(published[0].1, levels(&[(82344.1, 1212.0)]));
    assert_eq!(published[0].2, levels(&[(82344.2, 13166.0), (82344.5, 266.0)]));
}

#[test]
fn an_empty_book_frame_empties_the_book() {
    let xme = venue(&XME);
    let mut conn = connection(&XME, &["e_btcusdt"]);
    send(&xme, &mut conn, &gzip(&fameex_book()));

    let published = send(&xme, &mut conn, &gzip(&xme_empty_book()));

    assert_eq!(published.len(), 1);
    assert!(published[0].1.is_empty() && published[0].2.is_empty());
}

#[test]
fn a_book_of_an_unsubscribed_symbol_is_dropped_with_one_warning() {
    let (logs, _capture) = capture();
    let koinbay = venue(&KOINBAY);
    let mut conn = connection(&KOINBAY, &["e_btcusdt"]);

    assert!(send(&koinbay, &mut conn, &gzip(&koinbay_book())).is_empty());
    assert!(send(&koinbay, &mut conn, &gzip(&koinbay_book())).is_empty());

    let warned = logs.events("unsubscribed_symbol");
    assert_eq!(warned.len(), 1);
    assert_eq!(warned[0].text("market"), "e_ssvusdt");
}

#[test]
fn answers_the_server_ping_with_the_same_number_on_the_pinged_members() {
    let mut conn = connection(&AIVORA, &["e_btcusdt"]);
    venue(&AIVORA).handle_at(aivora_ping().to_string().as_bytes(), &mut conn, T0).unwrap();
    let mut xme_conn = connection(&XME, &["e_btcusdt"]);
    venue(&XME).handle_at(&gzip(&xme_ping()), &mut xme_conn, T0).unwrap();

    assert_eq!(text(&conn.take_sent()[0]), r#"{"pong":1791576072}"#);
    assert_eq!(text(&xme_conn.take_sent()[0]), r#"{"pong":1791576318}"#);
}

// FameEX answers each pong with a ping, so a pong in return would loop at about three frames a second.
#[test]
fn fameex_does_not_answer_the_ping_its_own_pong_draws() {
    let mut conn = connection(&FAMEEX, &["e_btcusdt"]);

    venue(&FAMEEX).handle_at(&gzip(&fameex_ping()), &mut conn, T0).unwrap();

    assert!(conn.take_sent().is_empty());
    assert!(conn.take_published().is_empty());
}

#[test]
fn logs_a_frame_whose_status_is_not_ok_as_a_venue_error() {
    let (logs, _capture) = capture();
    let mut conn = connection(&XME, &["e_btcusdt"]);
    let mut frame = xme_empty_book();
    frame["status"] = json!("error");

    venue(&XME).handle_at(&gzip(&frame), &mut conn, T0).unwrap();

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 1);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "xme#perp#0");
    assert!(conn.take_published().is_empty());
}

// x.me echoes a frame whose event it does not know, verbatim.
#[test]
fn logs_an_echoed_event_as_a_venue_notice() {
    let (logs, _capture) = capture();
    let mut conn = connection(&XME, &["e_btcusdt"]);
    let echo = json!({"event":"nope","params":{"channel":"market_e_btcusdt_depth_step0","cb_id":"1"}});

    venue(&XME).handle_at(&gzip(&echo), &mut conn, T0).unwrap();

    assert_eq!(logs.events("venue_notice")[0].text("venue_event"), "nope");
}

#[test]
fn a_frame_that_is_neither_json_nor_gzip_fails_without_a_resync() {
    let mut conn = connection(&XME, &["e_btcusdt"]);

    assert!(venue(&XME).handle_at(b"Bye", &mut conn, T0).is_err());
    assert!(!conn.resync_requested());
}

// What a broken gzip frame held is unknown, and a Koinbay book that stops moving would never be sent again.
#[test]
fn a_frame_that_does_not_gunzip_resyncs_the_connection() {
    let mut conn = connection(&KOINBAY, &["e_btcusdt"]);

    assert!(venue(&KOINBAY).handle_at(&[0x1f, 0x8b, 0, 1], &mut conn, T0).is_err());

    assert!(conn.resync_requested());
}

#[test]
fn a_book_frame_that_does_not_parse_resyncs_the_connection() {
    let mut conn = connection(&FAMEEX, &["e_btcusdt"]);
    let mut frame = fameex_book();
    frame["tick"]["asks"][0] = json!([82346.0]);

    assert!(venue(&FAMEEX).handle_at(&gzip(&frame), &mut conn, T0).is_err());

    assert!(conn.resync_requested());
    assert!(conn.take_published().is_empty());
}

#[test]
fn a_book_frame_without_a_side_resyncs_rather_than_publish_a_one_sided_book() {
    let (logs, _capture) = capture();
    let fameex = venue(&FAMEEX);
    let mut conn = connection(&FAMEEX, &["e_btcusdt"]);
    let mut frame = fameex_book();
    frame["tick"].as_object_mut().unwrap().remove("buys");

    assert!(send(&fameex, &mut conn, &gzip(&frame)).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "book_side_missing");
}

#[test]
fn a_crossed_push_empties_its_book_until_a_push_that_is_not_crossed() {
    let (logs, _capture) = capture();
    let fameex = venue(&FAMEEX);
    let mut conn = connection(&FAMEEX, &["e_btcusdt"]);
    send(&fameex, &mut conn, &gzip(&fameex_book()));
    let mut crossed = fameex_book();
    crossed["tick"]["buys"][0] = json!([82346.0, 604]);

    let emptied = send(&fameex, &mut conn, &gzip(&crossed));
    let still_empty = send(&fameex, &mut conn, &gzip(&crossed));
    let restored = send(&fameex, &mut conn, &gzip(&fameex_next_book()));

    assert!(emptied[0].1.is_empty() && emptied[0].2.is_empty());
    assert!(still_empty[0].1.is_empty() && still_empty[0].2.is_empty());
    assert_eq!(restored[0].1, levels(&[(82344.1, 1212.0)]));
    assert!(!conn.resync_requested());
    let warned = logs.events("book_crossed");
    assert_eq!(warned.len(), 1);
    assert_eq!(warned[0].number("bid"), 82346.0);
}

#[test]
fn a_level_that_does_not_read_resyncs_rather_than_publish_a_book_without_it() {
    let (logs, _capture) = capture();
    let aivora = venue(&AIVORA);
    let mut conn = connection(&AIVORA, &["e_btcusdt"]);
    let mut frame = aivora_book();
    frame["tick"]["bids"][0] = json!(["NaN", "62412", "62412", "0"]);

    assert!(send(&aivora, &mut conn, frame.to_string().as_bytes()).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[tokio::test]
async fn the_aivora_ticker_writes_index_mark_and_the_third_party_rate_with_the_scheduled_interval() {
    let aivora = venue(&AIVORA);
    schedule(&aivora, "e_btcusdt", 8.0, 1791590400000);
    let mut conn = connection(&AIVORA, &["e_btcusdt"]);

    assert!(send(&aivora, &mut conn, aivora_ticker().to_string().as_bytes()).is_empty());

    let row = aivora.anchors.rows()["e_btcusdt"];
    assert_eq!((row.index, row.mark, row.funding_rate), (82364.6366666666666667, 82342.4, -0.0000312));
    assert_eq!((row.funding_interval_hours, row.next_funding_at, row.ts), (8.0, 1791590400000, Some(T0)));
}

#[test]
fn a_ticker_without_an_index_leaves_its_market_unanchored() {
    let aivora = venue(&AIVORA);
    schedule(&aivora, "e_spcxusdt", 8.0, 1791590400000);
    let mut conn = connection(&AIVORA, &["e_spcxusdt"]);

    send(&aivora, &mut conn, aivora_spcx_ticker().to_string().as_bytes());

    assert!(aivora.anchors.rows().is_empty());
}

#[test]
fn a_market_stays_unanchored_until_the_schedule_holds_its_interval() {
    let xme = venue(&XME);
    let mut conn = connection(&XME, &["e_btcusdt"]);
    send(&xme, &mut conn, &gzip(&xme_ticker()));
    assert!(xme.anchors.rows().is_empty());

    schedule(&xme, "e_btcusdt", 4.0, 1791576000000);
    send(&xme, &mut conn, &gzip(&xme_ticker()));

    let row = xme.anchors.rows()["e_btcusdt"];
    assert_eq!((row.index, row.mark, row.funding_rate), (82305.4, 82313.3, 0.00018579));
    assert_eq!((row.funding_interval_hours, row.next_funding_at), (4.0, 1791576000000));
}

#[test]
fn the_koinbay_mark_frame_brings_its_own_next_settlement() {
    let koinbay = venue(&KOINBAY);
    schedule(&koinbay, "e_btcusdt", 8.0, 0);
    let mut conn = connection(&KOINBAY, &["e_btcusdt"]);

    send(&koinbay, &mut conn, &gzip(&koinbay_mark()));

    let row = koinbay.anchors.rows()["e_btcusdt"];
    assert_eq!((row.index, row.mark), (82342.66999999999542890, 82316.74552980666209560));
    assert_eq!(row.funding_rate, 0.0001);
    assert_eq!((row.funding_interval_hours, row.next_funding_at), (8.0, 1791590400000));
}

// nextFundRate is a rounded default on Koinbay, 0.000012 where every settlement of E-T-USDT was 0.0000125.
#[test]
fn the_koinbay_rate_is_current_fund_rate_where_the_two_rates_differ() {
    let koinbay = venue(&KOINBAY);
    schedule(&koinbay, "e_btcusdt", 8.0, 0);
    let mut conn = connection(&KOINBAY, &["e_btcusdt"]);
    let mut frame = koinbay_mark();
    frame["tick"]["currentFundRate"] = json!("0.0000370333333333");
    frame["tick"]["nextFundRate"] = json!("0.000073");

    send(&koinbay, &mut conn, &gzip(&frame));

    assert_eq!(koinbay.anchors.rows()["e_btcusdt"].funding_rate, 0.0000370333333333);
}

#[test]
fn an_anchor_frame_of_an_unsubscribed_symbol_is_ignored() {
    let koinbay = venue(&KOINBAY);
    schedule(&koinbay, "e_btcusdt", 8.0, 0);
    let mut conn = connection(&KOINBAY, &["e_ssvusdt"]);

    send(&koinbay, &mut conn, &gzip(&koinbay_mark()));

    assert!(koinbay.anchors.rows().is_empty());
}

#[test]
fn fameex_reads_no_anchor_from_its_socket() {
    let fameex = venue(&FAMEEX);
    schedule(&fameex, "e_btcusdt", 8.0, 0);
    let mut conn = connection(&FAMEEX, &["e_btcusdt"]);
    let mut ticker = xme_ticker();
    ticker["channel"] = json!("market_e_btcusdt_ticker");

    send(&fameex, &mut conn, &gzip(&ticker));

    assert!(fameex.anchors.rows().is_empty());
}

#[test]
fn the_depth_channel_names_its_symbol_for_either_step_spelling() {
    assert_eq!(depth_raw("market_e_btcusdt_depth_step0"), Some("e_btcusdt"));
    assert_eq!(depth_raw("market_e_btcusdt_depth_0.1"), Some("e_btcusdt"));
    assert_eq!(depth_raw("market_e_btcusdt_ticker"), None);
    assert_eq!(depth_raw("mark_price_e_btcusdt"), None);
}

// Prints the first frames of each channel, gunzipped, and answers the server's pings:
// PROBE_URL=wss://futuresws.x.me/kline-api/ws PROBE_CHANNELS=market_e_btcusdt_ticker PROBE_SECONDS=20 cargo test chainup_probe -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn chainup_probe() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let url = std::env::var("PROBE_URL").unwrap();
    let channels = std::env::var("PROBE_CHANNELS").unwrap();
    let seconds: u64 = std::env::var("PROBE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(20);
    let per_channel: usize = std::env::var("PROBE_FRAMES").ok().and_then(|s| s.parse().ok()).unwrap_or(2);
    let client_pong = std::env::var("PROBE_CLIENT_PONG").is_ok();
    let extra = std::env::var("PROBE_SEND").ok();

    let (mut socket, _) = connect_async(url.as_str()).await.unwrap();
    for channel in channels.split(',') {
        let frame = serde_json::json!({"event":"sub","params":{"channel":channel,"cb_id":"1"}});
        socket.send(Message::text(frame.to_string())).await.unwrap();
    }
    if let Some(extra) = extra {
        socket.send(Message::text(extra)).await.unwrap();
    }

    let started = Instant::now();
    let deadline = started + Duration::from_secs(seconds);
    let mut last_pong = Instant::now();
    let mut seen: HashMap<String, usize> = HashMap::new();
    let mut gaps: HashMap<String, (i64, i64)> = HashMap::new(); // last arrival, max gap
    loop {
        if client_pong && last_pong.elapsed() > Duration::from_secs(15) {
            let ms = crate::clock::now_ms();
            socket.send(Message::text(format!("{{\"pong\":{ms}}}"))).await.unwrap();
            last_pong = Instant::now();
        }
        let Ok(Some(message)) = timeout(deadline.saturating_duration_since(Instant::now()).min(Duration::from_secs(1)), socket.next()).await else {
            if Instant::now() >= deadline {
                break;
            }
            continue;
        };
        let message = message.unwrap();
        let (kind, body) = match &message {
            Message::Binary(bytes) => ("binary", String::from_utf8(wire::gunzip(bytes).unwrap()).unwrap()),
            Message::Text(text) => ("text", text.to_string()),
            other => {
                println!("{:>6} other {other:?}", started.elapsed().as_millis());
                continue;
            }
        };
        let value: serde_json::Value = serde_json::from_str(&body).unwrap_or(serde_json::Value::Null);
        if let Some(ping) = value.get("ping") {
            println!("{:>6} {kind} {body}", started.elapsed().as_millis());
            socket.send(Message::text(format!("{{\"pong\":{ping}}}"))).await.unwrap();
            continue;
        }
        let channel = value.get("channel").and_then(|c| c.as_str()).unwrap_or("?").to_string();
        let now = crate::clock::now_ms();
        let entry = gaps.entry(channel.clone()).or_insert((now, 0));
        entry.1 = entry.1.max(now - entry.0);
        entry.0 = now;
        let count = seen.entry(channel).or_default();
        *count += 1;
        if *count <= per_channel {
            println!("{:>6} {kind} {}", started.elapsed().as_millis(), &body[..body.len().min(1500)]);
        }
    }
    let mut counts: Vec<_> = seen.into_iter().collect();
    counts.sort();
    for (channel, count) in counts {
        println!("{channel}: {count} frames, max gap {} ms", gaps[&channel].1);
    }
}

// Times live anchor rounds of one member through the adapter: PROBE_VENUE=fameex cargo test chainup_round_probe -- --ignored --nocapture
#[tokio::test]
#[ignore]
async fn chainup_round_probe() {
    use crate::feeds::anchor_poller::AnchorVenue;
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let id = std::env::var("PROBE_VENUE").unwrap();
    let http = reqwest::Client::builder().user_agent("arbitrage-observatory").build().unwrap();
    let venue = crate::venues::load_venue(&id, &http).await.unwrap();
    let profile = [&super::AIVORA, &super::FAMEEX, &super::XME, &super::KOINBAY].into_iter().find(|p| p.id == id).unwrap();
    let adapter = super::Chainup::new(profile, &crate::venues::testing::tracked(&venue.markets));
    for _ in 0..4 {
        let started = Instant::now();
        let round = adapter.fetch_round(&http, crate::clock::now_ms()).await;
        match round {
            Ok(rows) => {
                let mut ages: Vec<i64> = rows.values().map(|row| crate::clock::now_ms() - row.ts.unwrap_or(0)).collect();
                ages.sort();
                println!("{} rows in {} ms, row ages {:?} to {:?}", rows.len(), started.elapsed().as_millis(), ages.first(), ages.last());
            }
            Err(error) => println!("failed in {} ms: {error:#}", started.elapsed().as_millis()),
        }
    }
}
