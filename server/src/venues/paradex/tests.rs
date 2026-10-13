// The engine's received levels are read through Connection::take_published after each frame.

use super::sbe::tests::{ETH_DELTA, XPT_FUNDING, XPT_SNAPSHOT, XPT_SUMMARY, hex};
use super::*;
use crate::feeds::anchor_poller::{AnchorMap, AnchorRow, AnchorVenue};
use crate::test_log::capture;
use crate::venues::testing::{self, http};
use futures_util::{SinkExt, StreamExt};
use serde_json::{Value, json};
use tracing::Level;

type Published = Vec<(String, Vec<BookLevel>, Vec<BookLevel>)>;

fn market(raw_market_id: &str) -> Market {
    let base = raw_market_id.split('-').next().unwrap();
    testing::market(ID, raw_market_id, base, "USD", true)
}

fn markets(count: usize) -> Vec<Market> {
    let mut markets = Vec::with_capacity(count);
    for i in 0..count {
        markets.push(market(&format!("SYM{i}-USD-PERP")));
    }
    markets
}

fn venue() -> Paradex {
    Paradex::new(&[])
}

fn connection() -> Connection<State> {
    let markets = vec![market("BTC-USD-PERP"), market("kPEPE-USD-PERP"), market("XPT-USD-PERP"), market("ETH-USD-PERP")];
    Connection::for_test("paradex#perp#0", markets)
}

fn level(price: f64, size: f64) -> BookLevel {
    BookLevel { price, size }
}

fn to_hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn send(venue: &Paradex, conn: &mut Connection<State>, frame: &[u8]) -> Published {
    venue.handle(frame, conn).unwrap();
    conn.take_published()
}

fn send_hex(conn: &mut Connection<State>, frame: &str) -> Published {
    send(&venue(), conn, &hex(frame))
}

fn send_text(conn: &mut Connection<State>, frame: &Value) -> Published {
    send(&venue(), conn, frame.to_string().as_bytes())
}

fn parsed(frame: &Message) -> Value {
    let Message::Text(text) = frame else {
        panic!("expected a text frame, got {frame:?}");
    };
    serde_json::from_str(text.as_str()).unwrap()
}

// Book frames captured live on 2026-10-12.
// The BTC chain was kept by the researcher's ws-probe.py at 22:36 UTC: a snapshot@15@50ms frame at seq 7689989220, then the next two deltas.
// That channel shares the deltas channel's template and sequence, and its frame stands in for the whole-book snapshot, which runs to 2 KB on BTC.
// The kPEPE frames came from capture_frames at 23:00 UTC, a whole-book snapshot and the two deltas after it, which name no level.
const BTC_SNAPSHOT: &str = concat!(
    "590003000100010070bd4955ac5d060064ec5bca01000000000000000000000080000000000000008000000000000000800000000000000080000000000000008000000000000000800000",
    "0000000000800000000000000080000000000000008010000f00804441d581070000b04d110000000000008177d381070000983a00000000000080a15fc381070000584f21000000000000",
    "3e709b81070000584f21000000000080da80738107000018790000000000008072f76981070000584f210000000000000f084281070000584f21000000000080ab181a81070000584f2100",
    "00000000004829f280070000584f21000000000080c8ebbb80070000584f21000000000080523bab80070000384a000000000000000b9a9180070000584f210000000000003e436a800700",
    "00c05d00000000000000b7af6680070000584f21000000000080e5be5d8007000080bb00000000000010000f00804e275d82070000584f2100000000000074029182070000584f21000000",
    "0000007f6dac82070000307500000000000080d7f1b882070000584f21000000000000b191f182070000187900000000000000737dfd820700003075000000000000000838088307000058",
    "4f2100000000000013a32383070000384a00000000000080387e5783070000584f2100000000000069c4a683070000584f21000000000080fca0bb83070000983a00000000000080990af6",
    "83070000584f210000000000001fc00384070000983a000000000000003a897e84070000c83200000000000000505fb584070000c05d0000000000000c4254432d5553442d50455250",
);
const BTC_DELTA_221: &str = "5900030001000100e8675455ac5d060065ec5bca010000000100000000000000800000000000000080000000000000008000000000000000800000000000000080000000000000008000000000000000800000000000000080000000000000008010000100804441d5810700000000000000000000100000000c4254432d5553442d50455250";
const BTC_DELTA_222: &str = "5900030001000100e8675455ac5d060066ec5bca010000000100000000000000800000000000000080000000000000008000000000000000800000000000000080000000000000008000000000000000800000000000000080000000000000008010000100805268dc81070000b04d110000000000100000000c4254432d5553442d50455250";
const KPEPE_SNAPSHOT: &str = "5900030001000100807082a9ac5d06003af1b13a0000000000407e05000000000000a507870d0000008824120000000000003e1ca32f0000000000000000000080000000000000008000000000000000800000000000000080000000000000008010000400407e05000000000000a507870d000000b09b0400000000000022eae23d000000887e03000000000000017c5f3c000000b8120300000000000063c8b957130000100002008824120000000000003e1ca32f000000a87212000000000000e455df380300000e6b504550452d5553442d50455250";
const KPEPE_DELTA_155: &str = "590003000100010010e794a9ac5d06003bf1b13a000000000100000000000000800000000000000080000000000000008000000000000000800000000000000080000000000000008000000000000000800000000000000080000000000000008010000000100000000e6b504550452d5553442d50455250";
const KPEPE_DELTA_156: &str = "590003000100010010e794a9ac5d06003cf1b13a000000000100000000000000800000000000000080000000000000008000000000000000800000000000000080000000000000008000000000000000800000000000000080000000000000008010000000100000000e6b504550452d5553442d50455250";

// The same frame with its market name, its seq or its package type changed, for the cases no capture shows.
fn renamed(frame: &str, market: &str) -> Vec<u8> {
    let bytes = hex(frame);
    let old = sbe::book(&bytes, &sbe::header(&bytes).unwrap()).unwrap().market.len();
    let mut out = bytes[..bytes.len() - 1 - old].to_vec();
    out.push(market.len() as u8);
    out.extend_from_slice(market.as_bytes());
    out
}

fn with_seq(frame: &str, seq: i64) -> Vec<u8> {
    let mut bytes = hex(frame);
    bytes[16..24].copy_from_slice(&seq.to_le_bytes());
    bytes
}

fn with_package_type(frame: &str, pkg_type: u8) -> Vec<u8> {
    let mut bytes = hex(frame);
    bytes[24] = pkg_type;
    bytes
}

// plan and settings

#[test]
fn puts_thirty_markets_on_each_socket_with_the_sbe_parameters() {
    let plans = venue().plan(&markets(66));

    let sizes: Vec<usize> = plans.iter().map(|plan| plan.markets.len()).collect();
    assert_eq!(sizes, [30, 30, 6]);
    assert_eq!(plans[2].id, "paradex#perp#2");
    assert!(plans.iter().all(|plan| plan.url == "wss://ws.api.prod.paradex.trade/v1?sbeSchemaId=1&sbeSchemaVersion=1"));
    assert_eq!(plans[1].markets[0].raw_market_id, "SYM30-USD-PERP");
    assert!(venue().plan(&[]).is_empty());
}

#[test]
fn watches_ten_seconds_of_silence_and_sends_no_ping_of_its_own() {
    let settings = venue().settings();

    assert_eq!(settings.max_silence, Duration::from_secs(10));
    assert_eq!(settings.ping_every, None);
    assert_eq!(settings.subscribe_gap, Duration::ZERO);
}

// subscribe_frames

#[test]
fn subscribes_every_funding_period_then_each_book_then_each_summary_one_numbered_request_each() {
    let mut state = State::default();

    let frames = venue().subscribe_frames(&[market("BTC-USD-PERP"), market("kPEPE-USD-PERP")], &mut state);

    let frames: Vec<Value> = frames.iter().map(parsed).collect();
    let subscribe = |id: u64, channel: &str| json!({ "jsonrpc": "2.0", "method": "subscribe", "params": { "channel": channel }, "id": id });
    assert_eq!(
        frames,
        [
            subscribe(1, "funding_data.ALL"),
            subscribe(2, "order_book.BTC-USD-PERP.deltas"),
            subscribe(3, "order_book.kPEPE-USD-PERP.deltas"),
            subscribe(4, "markets_summary.BTC-USD-PERP"),
            subscribe(5, "markets_summary.kPEPE-USD-PERP"),
        ]
    );
    assert_eq!(state.channels[2], "order_book.kPEPE-USD-PERP.deltas");
}

// books

#[test]
fn a_snapshot_replaces_the_book_best_first() {
    let mut conn = connection();

    let published = send_hex(&mut conn, BTC_SNAPSHOT);

    let (raw, bids, asks) = &published[0];
    assert_eq!(raw, "BTC-USD-PERP");
    assert_eq!((bids.len(), asks.len()), (15, 15));
    assert_eq!(bids[..3], [level(82542.1, 0.01134), level(82541.8, 0.00015), level(82539.1, 0.02183)]);
    assert_eq!(asks[..3], [level(82564.9, 0.02183), level(82573.6, 0.02183), level(82578.2, 0.0003)]);
}

#[test]
fn each_delta_applies_its_levels_in_sequence_and_a_zero_size_removes_one() {
    let mut conn = connection();
    send_hex(&mut conn, BTC_SNAPSHOT);

    let removed = send_hex(&mut conn, BTC_DELTA_221);
    let added = send_hex(&mut conn, BTC_DELTA_222);

    assert_eq!(removed[0].1[0], level(82541.8, 0.00015));
    assert_eq!(removed[0].1.len(), 14);
    assert_eq!(added[0].1[..2], [level(82543.3, 0.01134), level(82541.8, 0.00015)]);
    assert_eq!(added[0].2[0], level(82564.9, 0.02183));
    assert!(!conn.resync_requested());
}

#[test]
fn a_delta_that_names_no_level_moves_the_sequence_and_publishes_nothing() {
    let mut conn = connection();
    let snapshot = send_hex(&mut conn, KPEPE_SNAPSHOT);

    assert!(send_hex(&mut conn, KPEPE_DELTA_155).is_empty());
    assert!(send_hex(&mut conn, KPEPE_DELTA_156).is_empty());

    assert_eq!(snapshot[0].1[0], level(0.0036, 581.0));
    assert_eq!(snapshot[0].2[0], level(0.01189, 2046.0));
    assert!(!conn.resync_requested());
}

#[test]
fn a_skipped_seq_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send_hex(&mut conn, BTC_SNAPSHOT);

    assert!(send_hex(&mut conn, BTC_DELTA_222).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "sequence_gap");
    assert_eq!(logs.events("book_resync")[0].text("market"), "BTC-USD-PERP");
}

#[test]
fn a_repeated_or_older_seq_resyncs_too() {
    let mut conn = connection();
    send_hex(&mut conn, BTC_SNAPSHOT);
    send_hex(&mut conn, BTC_DELTA_221);

    send_hex(&mut conn, BTC_DELTA_221);

    assert!(conn.resync_requested());
}

#[test]
fn a_delta_before_the_snapshot_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    assert!(send_hex(&mut conn, ETH_DELTA).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "delta_before_snapshot");
}

#[test]
fn a_later_snapshot_replaces_the_book_and_restarts_the_sequence() {
    let mut conn = connection();
    send_hex(&mut conn, BTC_SNAPSHOT);
    send_hex(&mut conn, BTC_DELTA_221);

    let replaced = send(&venue(), &mut conn, &with_seq(BTC_SNAPSHOT, 7689989300));
    let next = send(&venue(), &mut conn, &with_seq(BTC_DELTA_222, 7689989301));

    assert_eq!(replaced[0].1[0], level(82542.1, 0.01134));
    assert_eq!(next[0].1[0], level(82543.3, 0.01134));
    assert!(!conn.resync_requested());
}

#[test]
fn an_unknown_package_type_resyncs() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send_hex(&mut conn, BTC_SNAPSHOT);

    send(&venue(), &mut conn, &with_package_type(BTC_DELTA_221, 7));

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "package_type_unknown");
}

#[test]
fn a_null_level_resyncs_rather_than_being_skipped() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    send_hex(&mut conn, BTC_SNAPSHOT);
    let mut frame = hex(BTC_DELTA_221);
    let size_at = 8 + 89 + 4 + 8;
    frame[size_at..size_at + 8].copy_from_slice(&i64::MIN.to_le_bytes());

    assert!(send(&venue(), &mut conn, &frame).is_empty());

    assert!(conn.resync_requested());
    assert_eq!(logs.events("book_resync")[0].text("reason"), "level_unreadable");
}

#[test]
fn a_market_nobody_subscribed_is_dropped_and_logged_once() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let frame = renamed(XPT_SNAPSHOT, "SOL-USD-PERP");

    assert!(send(&venue(), &mut conn, &frame).is_empty());
    assert!(send(&venue(), &mut conn, &frame).is_empty());

    let warned = logs.events("unsubscribed_symbol");
    assert_eq!(warned.len(), 1);
    assert_eq!(warned[0].text("market"), "SOL-USD-PERP");
    assert!(!conn.resync_requested());
}

// A HeartbeatEvent, template 40, built by hand from the schema since no idle socket got one.
#[test]
fn a_heartbeat_or_any_template_the_feed_never_subscribed_is_skipped() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let heartbeat = hex("1000280001000100e8675455ac5d06000000000000000000");
    let mut trade_like = hex(XPT_SNAPSHOT);
    trade_like[2..4].copy_from_slice(&1u16.to_le_bytes());

    assert!(send(&venue(), &mut conn, &heartbeat).is_empty());
    assert!(send(&venue(), &mut conn, &trade_like).is_empty());

    assert!(logs.lines().is_empty());
    assert!(!conn.resync_requested());
}

#[test]
fn a_book_frame_cut_short_is_an_error_and_publishes_nothing() {
    let mut conn = connection();
    let frame = hex(XPT_SNAPSHOT);

    assert!(venue().handle(&frame[..frame.len() - 3], &mut conn).is_err());
    assert!(conn.take_published().is_empty());
    assert!(!conn.resync_requested());
}

// text frames

// Captured live on 2026-10-12 at 23:00 UTC: an acknowledgement, an unknown market, a refused parameter and a request that did not parse.
#[test]
fn an_acknowledgement_publishes_and_logs_nothing() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    let ack = json!({"jsonrpc":"2.0","id":1,"result":{"channel":"order_book.XPT-USD-PERP.deltas"},"usIn":1791846044814060_i64,"usDiff":143,"usOut":1791846044814203_i64});

    assert!(send_text(&mut conn, &ack).is_empty());

    assert!(logs.lines().is_empty());
    assert!(conn.take_sent().is_empty());
}

#[test]
fn an_error_reply_is_logged_as_a_venue_error_naming_the_channel_of_its_request() {
    let (logs, _capture) = capture();
    let mut conn = connection();
    venue().subscribe_frames(&[market("NOPE-USD-PERP"), market("BTC-USD-PERP")], &mut conn.state);
    let unknown = json!({"jsonrpc":"2.0","id":2,"error":{"code":-32600,"message":"invalid subscribe request","data":"market does not exist"},"usIn":1791846044820208_i64,"usDiff":56,"usOut":1791846044820264_i64});
    let unparsed = json!({"jsonrpc":"2.0","id":0,"error":{"code":-32700,"message":"unable to parse request"},"usIn":0,"usDiff":0,"usOut":0});

    send_text(&mut conn, &unknown);
    send_text(&mut conn, &unparsed);

    let errors = logs.events("venue_error");
    assert_eq!(errors.len(), 2);
    assert_eq!(errors[0].level, Level::ERROR);
    assert_eq!(errors[0].text("connection"), "paradex#perp#0");
    assert_eq!(errors[0].text("channel"), "order_book.NOPE-USD-PERP.deltas");
    assert_eq!(errors[0].number("code"), -32600.0);
    assert_eq!(errors[0].text("data"), "market does not exist");
    assert_eq!(errors[1].text("channel"), "");
    assert_eq!(errors[1].text("message"), "unable to parse request");
    assert!(!conn.resync_requested());
}

#[test]
fn a_text_frame_that_is_neither_a_reply_nor_json_is_a_notice_or_an_error() {
    let (logs, _capture) = capture();
    let mut conn = connection();

    send_text(&mut conn, &json!({ "jsonrpc": "2.0", "method": "maintenance" }));

    assert_eq!(logs.events("venue_notice").len(), 1);
    assert!(venue().handle(b"not json", &mut conn).is_err());
}

// anchors, through handle as the socket delivers them

const T0: i64 = 1_791_846_045_000; // 2026-10-12 23:00:45 UTC, about when the XPT frames arrived

fn feed(venue: &Paradex, conn: &mut Connection<State>, frame: &str, at: i64) {
    venue.handle_at(&hex(frame), conn, at).unwrap();
}

async fn round(venue: &Paradex) -> anyhow::Result<AnchorMap> {
    venue.fetch_round(&http(), T0).await
}

#[tokio::test]
async fn a_market_is_anchored_from_its_summary_once_its_funding_period_has_arrived() {
    let venue = venue();
    let mut conn = connection();

    feed(&venue, &mut conn, XPT_SUMMARY, T0);
    assert!(round(&venue).await.unwrap().is_empty());
    feed(&venue, &mut conn, XPT_FUNDING, T0 + 4_000);
    assert!(round(&venue).await.unwrap().is_empty());
    feed(&venue, &mut conn, XPT_SUMMARY, T0 + 5_000);

    assert_eq!(
        round(&venue).await.unwrap()["XPT-USD-PERP"],
        AnchorRow {
            index: 1692.19054,
            mark: 1693.38087206,
            funding_rate: 0.000052967371,
            funding_interval_hours: 8.0,
            next_funding_at: 0,
            ts: Some(T0 + 5_000),
        }
    );
}

#[tokio::test]
async fn a_null_index_keeps_the_market_out() {
    let venue = venue();
    let mut conn = connection();
    let mut summary = hex(XPT_SUMMARY);
    summary[8 + 24..8 + 32].copy_from_slice(&i64::MIN.to_le_bytes());
    feed(&venue, &mut conn, XPT_FUNDING, T0);

    venue.handle_at(&summary, &mut conn, T0).unwrap();

    assert!(round(&venue).await.unwrap().is_empty());
}

#[tokio::test]
async fn a_reconnect_keeps_the_row_while_its_period_arrives_again() {
    let venue = venue();
    let mut conn = connection();
    feed(&venue, &mut conn, XPT_FUNDING, T0);
    feed(&venue, &mut conn, XPT_SUMMARY, T0);
    let mut reopened = connection();

    feed(&venue, &mut reopened, XPT_SUMMARY, T0 + 1_000);

    let row = round(&venue).await.unwrap()["XPT-USD-PERP"];
    assert_eq!((row.funding_interval_hours, row.ts), (8.0, Some(T0 + 1_000)));
}

// funding_data.ALL sends every socket the periods of the other sockets' markets.
#[tokio::test]
async fn a_funding_frame_for_a_market_of_another_socket_is_kept_without_a_warning() {
    let (logs, _capture) = capture();
    let venue = venue();
    let mut conn = Connection::for_test("paradex#perp#1", vec![market("BTC-USD-PERP")]);

    feed(&venue, &mut conn, XPT_FUNDING, T0);

    assert_eq!(conn.state.period_hours["XPT-USD-PERP"], 8.0);
    assert!(logs.lines().is_empty());
    assert!(round(&venue).await.unwrap().is_empty());
}

#[tokio::test]
async fn handle_stamps_the_summary_with_the_frame_arrival() {
    let venue = venue();
    let mut conn = connection();

    venue.handle(&hex(XPT_FUNDING), &mut conn).unwrap();
    venue.handle(&hex(XPT_SUMMARY), &mut conn).unwrap();

    assert_eq!(round(&venue).await.unwrap()["XPT-USD-PERP"].ts, Some(conn.frame_recv_ts()));
}

#[tokio::test]
async fn a_round_fails_whole_until_every_market_is_anchored_or_the_warmup_ends() {
    let mut venue = Paradex::new(&testing::tracked(&[market("XPT-USD-PERP"), market("BTC-USD-PERP")]));
    let mut conn = connection();
    feed(&venue, &mut conn, XPT_FUNDING, T0);
    feed(&venue, &mut conn, XPT_SUMMARY, T0);

    let error = round(&venue).await.unwrap_err();
    assert_eq!(format!("{error}"), "warming up, 1 of 2 markets have their index, mark and funding");

    venue.first_round = OnceLock::from(Instant::now() - anchor::WARMUP);
    assert_eq!(round(&venue).await.unwrap().keys().collect::<Vec<_>>(), ["XPT-USD-PERP"]);
}

#[test]
fn polls_every_second() {
    assert_eq!(venue().poll_every(), Duration::from_secs(1));
}

// Prints the frames the feed tests are built from, text verbatim and binary as hex with its template and size:
// CAPTURE_MARKETS=XPT-USD-PERP,ETH-USD-PERP cargo test paradex::tests::capture_frames -- --ignored --nocapture
// Each line starts with the ms since the socket opened, which is how the server's pace of subscribe requests showed on 2026-10-12.
#[tokio::test]
#[ignore]
async fn capture_frames() {
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();
    let (mut socket, _) = tokio_tungstenite::connect_async(URL).await.unwrap();
    let opened = tokio::time::Instant::now();
    let list = std::env::var("CAPTURE_MARKETS").unwrap_or_else(|_| "XPT-USD-PERP,ETH-USD-PERP".to_string());
    let max_bytes: usize = std::env::var("CAPTURE_MAX_BYTES").ok().and_then(|s| s.parse().ok()).unwrap_or(700);
    let markets: Vec<Market> = list.split(',').map(market).collect();
    let mut state = State::default();
    for frame in Paradex::new(&[]).subscribe_frames(&markets, &mut state) {
        socket.send(frame).await.unwrap();
    }
    // An unknown market, a refused parameter and a request that does not parse, which each answer with an error.
    let refusals = [
        r#"{"jsonrpc":"2.0","method":"subscribe","params":{"channel":"order_book.NOPE-USD-PERP.deltas"},"id":901}"#,
        r#"{"jsonrpc":"2.0","method":"subscribe","params":{"channel":"order_book.BTC-USD-PERP.deltas@15@50ms"},"id":902}"#,
        r#"{"jsonrpc":"2.0","method":"subscribe""#,
    ];
    for refusal in refusals {
        socket.send(Message::text(refusal)).await.unwrap();
    }

    let seconds: u64 = std::env::var("CAPTURE_SECONDS").ok().and_then(|s| s.parse().ok()).unwrap_or(8);
    let deadline = tokio::time::Instant::now() + Duration::from_secs(seconds);
    let mut printed = 0;
    while let Ok(Some(Ok(message))) = tokio::time::timeout_at(deadline, socket.next()).await {
        match message {
            Message::Text(text) => println!("{:>6} text {text}", opened.elapsed().as_millis()),
            Message::Binary(bytes) => {
                let Some(header) = sbe::header(&bytes) else {
                    println!("{:>6} short binary {}", opened.elapsed().as_millis(), to_hex(&bytes));
                    continue;
                };
                let market = match header.template_id {
                    sbe::BOOK => sbe::book(&bytes, &header).map(|book| format!("{} seq {} type {} bids {} asks {}", book.market, book.seq, book.pkg_type, book.bids.len(), book.asks.len())),
                    sbe::SUMMARY => sbe::summary(&bytes, &header).map(|s| format!("{} mark {} index {} funding {}", s.market, s.mark, s.index, s.funding_rate)),
                    sbe::FUNDING => sbe::funding(&bytes, &header).map(|f| format!("{} period {}", f.market, f.period_hours)),
                    _ => Ok(String::new()),
                };
                let market = market.unwrap_or_else(|error| format!("undecoded: {error:#}"));
                if bytes.len() <= max_bytes && printed < 60 {
                    println!("{:>6} binary template {} block {} bytes {} {market}\n  {}", opened.elapsed().as_millis(), header.template_id, header.block_length, bytes.len(), to_hex(&bytes));
                    printed += 1;
                } else {
                    println!("{:>6} binary template {} block {} bytes {} {market}", opened.elapsed().as_millis(), header.template_id, header.block_length, bytes.len());
                }
            }
            other => println!("{:>6} other {other:?}", opened.elapsed().as_millis()),
        }
    }
}
