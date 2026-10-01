// Ported case for case from old_ts_server/src/feeds/anchor/AnchorPoller.spec.ts.
// The cases after the port add 403 and 418, retry_after, a zero poll_every, the summary, the failure and recovery logs, and skipped.

use super::*;
use crate::engine::cluster::Market;
use crate::engine::engine::ENGINE_QUEUE_CAPACITY;
use crate::test_log::capture;
use axum::Router;
use axum::http::{HeaderValue, StatusCode, header};
use axum::response::IntoResponse;
use axum::routing::get;
use std::collections::VecDeque;
use std::sync::Mutex;
use tokio::net::TcpListener;
use tokio::sync::mpsc::{self, Receiver};
use tokio::sync::oneshot;
use tracing::Level;

const VENUE_ID: &str = "testvenue";
const VENUE_INDEX: usize = 2;
const INTERVAL: Duration = Duration::from_secs(1);
const T0: i64 = 1_700_000_000_000;

fn market(raw_market_id: &str) -> Market {
    Market {
        venue_id: VENUE_ID.to_string(),
        raw_market_id: raw_market_id.to_string(),
        base: raw_market_id[..3].to_string(),
        quote: "USDT".to_string(),
        taker_ppm: 500,
        linear: true,
        contract_size: 1.0,
    }
}

// The market at position p of a case's list sits in cluster p.
fn slot(position: usize) -> Slot {
    Slot {
        cluster: position,
        venue: VENUE_INDEX,
    }
}

fn tracked(raw_market_ids: &[&str]) -> Vec<TrackedMarket> {
    let mut markets = Vec::new();
    for (position, raw_market_id) in raw_market_ids.iter().enumerate() {
        markets.push(TrackedMarket {
            market: market(raw_market_id),
            slot: slot(position),
        });
    }
    markets
}

fn row(index: f64) -> AnchorRow {
    AnchorRow {
        index,
        mark: index * 1.001,
        funding_rate: 0.0001,
        funding_interval_hours: 8.0,
        next_funding_at: T0 + 3_600_000,
        ts: None,
    }
}

// Where the TS cases made the engine's updateAnchor return false, the poller's own anchor_issue refuses this row.
fn refused_row() -> AnchorRow {
    AnchorRow {
        mark: -1.0,
        ..row(1.0)
    }
}

fn rows(entries: &[(&str, AnchorRow)]) -> AnchorMap {
    let mut map = AnchorMap::new();
    for (raw_market_id, row) in entries {
        map.insert(raw_market_id.to_string(), *row);
    }
    map
}

enum Reply {
    Rows(AnchorMap),
    Fail(anyhow::Error),
    Held(oneshot::Receiver<AnchorMap>), // a round that stays open until the test answers or the poller drops it
}

// The venue side of the poller is one method returning rows, so the test venue returns whatever the case queues up.
struct TestVenue {
    every: Duration,
    replies: Mutex<VecDeque<Reply>>,
    calls: Mutex<Vec<i64>>, // the ts each round was called with
}

impl TestVenue {
    fn new() -> Self {
        Self::polling_every(INTERVAL)
    }

    fn polling_every(every: Duration) -> Self {
        Self {
            every,
            replies: Mutex::new(VecDeque::new()),
            calls: Mutex::new(Vec::new()),
        }
    }

    fn reply(&self, rows: AnchorMap) {
        self.replies.lock().unwrap().push_back(Reply::Rows(rows));
    }

    fn fail(&self, error: anyhow::Error) {
        self.replies.lock().unwrap().push_back(Reply::Fail(error));
    }

    // Queues a round that stays open until the case sends its rows on the returned sender.
    fn hold(&self) -> oneshot::Sender<AnchorMap> {
        let (answer, held) = oneshot::channel();
        self.replies.lock().unwrap().push_back(Reply::Held(held));
        answer
    }

    fn calls(&self) -> Vec<i64> {
        self.calls.lock().unwrap().clone()
    }
}

impl AnchorVenue for TestVenue {
    fn poll_every(&self) -> Duration {
        self.every
    }

    async fn fetch_round(&self, _http: &reqwest::Client, ts: i64) -> anyhow::Result<AnchorMap> {
        self.calls.lock().unwrap().push(ts);
        let reply = self.replies.lock().unwrap().pop_front();
        match reply {
            None => Ok(AnchorMap::new()),
            Some(Reply::Rows(rows)) => Ok(rows),
            Some(Reply::Fail(error)) => Err(error),
            Some(Reply::Held(held)) => Ok(held.await?),
        }
    }
}

// No proxy, so get_json reaches the local server whatever the environment sets.
fn http() -> reqwest::Client {
    reqwest::Client::builder().no_proxy().build().unwrap()
}

struct Run {
    venue: Arc<TestVenue>,
    rx: Receiver<EngineEvent>,
    cancel: CancellationToken,
    task: JoinHandle<()>,
}

fn start(venue: TestVenue, raw_market_ids: &[&str]) -> Run {
    let venue = Arc::new(venue);
    let (tx, rx) = mpsc::channel(ENGINE_QUEUE_CAPACITY);
    let cancel = CancellationToken::new();
    let task = spawn_poller(
        venue.clone(),
        VENUE_ID,
        tracked(raw_market_ids),
        http(),
        tx,
        cancel.clone(),
    );
    Run {
        venue,
        rx,
        cancel,
        task,
    }
}

impl Run {
    // The readings of every round sent since the last call, one list per round.
    fn sent(&mut self) -> Vec<Vec<(Slot, AnchorReading)>> {
        let mut rounds = Vec::new();
        while let Ok(event) = self.rx.try_recv() {
            match event {
                EngineEvent::Anchors(readings) => rounds.push(readings),
                other => panic!("the poller sent {other:?}"),
            }
        }
        rounds
    }

    // On paused time a task that never ends trips this timeout instead of hanging the case.
    async fn ended(&mut self) {
        let ended = tokio::time::timeout(Duration::from_secs(5), &mut self.task).await;
        ended
            .expect("the poller task ended")
            .expect("the poller task did not panic");
    }

    async fn stop(&mut self) {
        self.cancel.cancel();
        self.ended().await;
    }
}

// Lets the poller finish every step the last clock move or reply made ready, as the TS flush let promises settle.
async fn flush() {
    for _ in 0..16 {
        tokio::task::yield_now().await;
    }
}

async fn next_tick() {
    tokio::time::advance(INTERVAL).await;
    flush().await;
}

// Every field of a sent reading but ts, which each case checks against the clock it expects.
#[track_caller]
fn assert_reading(sent: &(Slot, AnchorReading), slot: Slot, row: AnchorRow) {
    let (sent_slot, reading) = sent;
    assert_eq!(*sent_slot, slot);
    assert_eq!(reading.index, row.index);
    assert_eq!(reading.mark, row.mark);
    assert_eq!(reading.funding_rate, row.funding_rate);
    assert_eq!(reading.funding_interval_hours, row.funding_interval_hours);
    assert_eq!(reading.next_funding_at, row.next_funding_at);
}

fn rate_limited(reason: &str, retry_after: Option<Duration>) -> anyhow::Error {
    RateLimited {
        url: "https://x".to_string(),
        reason: reason.to_string(),
        retry_after,
    }
    .into()
}

// A local server that answers every GET with one fixed reply, so get_json runs against a real socket and real time.
async fn serve(
    status: StatusCode,
    retry_after: Option<&'static str>,
    body: &'static str,
) -> String {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("http://{}/anchors", listener.local_addr().unwrap());
    let reply = move || async move {
        let mut response = (status, body).into_response();
        if let Some(seconds) = retry_after {
            response
                .headers_mut()
                .insert(header::RETRY_AFTER, HeaderValue::from_static(seconds));
        }
        response
    };
    let app = Router::new().route("/anchors", get(reply));
    tokio::spawn(async move { axum::serve(listener, app).await.unwrap() });
    url
}

#[tokio::test(start_paused = true)]
async fn polls_once_at_start_and_then_on_every_interval() {
    let (logs, _guard) = capture();
    let venue = TestVenue::new();
    venue.reply(rows(&[("AAAUSDT", row(1.0))]));
    venue.reply(rows(&[("AAAUSDT", row(2.0))]));
    venue.reply(rows(&[("AAAUSDT", row(3.0))]));
    let mut run = start(venue, &["AAAUSDT"]);

    flush().await;
    let mut rounds = run.sent();
    assert_eq!(rounds.len(), 1);

    next_tick().await;
    rounds.extend(run.sent());
    assert_eq!(rounds.len(), 2);

    next_tick().await;
    rounds.extend(run.sent());
    assert_eq!(rounds.len(), 3);

    let mut indexes = Vec::new();
    for readings in &rounds {
        assert_eq!(readings.len(), 1);
        assert_eq!(readings[0].0, slot(0));
        indexes.push(readings[0].1.index);
    }
    assert_eq!(indexes, [1.0, 2.0, 3.0]);

    let started = logs.events("anchor_poll_started");
    assert_eq!(started.len(), 1);
    assert_eq!(started[0].text("venue"), VENUE_ID);
    assert_eq!(started[0].number("markets"), 1.0);
    assert_eq!(started[0].number("every_ms"), 1_000.0);
    run.stop().await;
}

#[tokio::test(start_paused = true)]
async fn refuses_to_start_a_venue_with_no_markets() {
    let (logs, _guard) = capture();
    let mut run = start(TestVenue::new(), &[]);

    tokio::time::advance(INTERVAL * 3).await;
    flush().await;

    run.ended().await;
    assert!(run.venue.calls().is_empty());
    assert!(run.sent().is_empty());
    let aborted = logs.events("anchor_poll_aborted");
    assert_eq!(aborted.len(), 1);
    assert_eq!(aborted[0].level, Level::ERROR);
    assert_eq!(aborted[0].text("venue"), VENUE_ID);
    assert_eq!(aborted[0].number("markets"), 0.0);
    assert!(logs.events("anchor_poll_started").is_empty());
}

#[tokio::test(start_paused = true)]
async fn writes_every_tracked_market_with_the_same_ts_the_time_the_reply_arrived() {
    let venue = TestVenue::new();
    let answer = venue.hold();
    let mut run = start(venue, &["AAAUSDT", "BBBUSDT"]);
    flush().await;
    let called_at = run.venue.calls()[0];

    // The venue takes real time to answer, so the wall clock at arrival is past the round's start.
    std::thread::sleep(Duration::from_millis(5));
    let before = now_ms();
    answer
        .send(rows(&[
            ("AAAUSDT", row(1.0)),
            ("BBBUSDT", row(2.0)),
            ("ZZZUSDT", row(3.0)),
        ]))
        .unwrap();
    flush().await;
    let after = now_ms();

    let rounds = run.sent();
    assert_eq!(rounds.len(), 1);
    let readings = &rounds[0];
    assert_eq!(readings.len(), 2);
    assert_reading(&readings[0], slot(0), row(1.0));
    assert_reading(&readings[1], slot(1), row(2.0));
    let ts = readings[0].1.ts;
    assert_eq!(readings[1].1.ts, ts);
    assert!(called_at < before);
    assert!(before <= ts && ts <= after, "{before} <= {ts} <= {after}");
    run.stop().await;
}

#[tokio::test(start_paused = true)]
async fn warns_once_for_a_tracked_market_the_reply_never_carries() {
    let (logs, _guard) = capture();
    let venue = TestVenue::new();
    venue.reply(rows(&[("AAAUSDT", row(1.0))]));
    venue.reply(rows(&[("AAAUSDT", row(1.0))]));
    let mut run = start(venue, &["AAAUSDT", "GONEUSDT"]);

    flush().await;
    next_tick().await;

    assert_eq!(run.sent().len(), 2);
    let missing = logs.events("anchor_row_missing");
    assert_eq!(missing.len(), 1);
    assert_eq!(missing[0].level, Level::WARN);
    assert_eq!(missing[0].text("market"), "GONEUSDT");
    assert_eq!(missing[0].number("rows"), 1.0);
    run.stop().await;
}

#[tokio::test(start_paused = true)]
async fn treats_a_row_without_an_index_as_missing_instead_of_sending_it_to_the_engine() {
    let (logs, _guard) = capture();
    let venue = TestVenue::new();
    venue.reply(rows(&[("AAAUSDT", row(1.0)), ("NEWUSDT", row(0.0))]));
    let before = now_ms();
    let mut run = start(venue, &["AAAUSDT", "NEWUSDT"]);
    flush().await;
    let after = now_ms();

    let rounds = run.sent();
    assert_eq!(rounds.len(), 1);
    assert_eq!(rounds[0].len(), 1);
    assert_reading(&rounds[0][0], slot(0), row(1.0));
    let ts = rounds[0][0].1.ts;
    assert!(before <= ts && ts <= after, "{before} <= {ts} <= {after}");

    // Missing, not refused by anchor_issue, which would also keep it from the engine.
    let missing = logs.events("anchor_row_missing");
    assert_eq!(missing.len(), 1);
    assert_eq!(missing[0].text("market"), "NEWUSDT");
    assert!(logs.events("anchor_update_rejected").is_empty());
    run.stop().await;
}

#[tokio::test(start_paused = true)]
async fn skips_a_tick_while_the_previous_round_is_still_in_flight() {
    let venue = TestVenue::new();
    let answer = venue.hold();
    venue.reply(rows(&[("AAAUSDT", row(2.0))]));
    let mut run = start(venue, &["AAAUSDT"]);

    flush().await;
    next_tick().await;
    assert_eq!(run.venue.calls().len(), 1);
    assert!(run.sent().is_empty());

    answer.send(rows(&[("AAAUSDT", row(1.0))])).unwrap();
    flush().await;
    let rounds = run.sent();
    assert_eq!(rounds.len(), 1);
    assert_eq!(rounds[0][0].1.index, 1.0);
    assert_eq!(run.venue.calls().len(), 1); // the tick that came due during the round does not run late

    next_tick().await;
    assert_eq!(run.venue.calls().len(), 2);
    let rounds = run.sent();
    assert_eq!(rounds.len(), 1);
    assert_eq!(rounds[0][0].1.index, 2.0);
    run.stop().await;
}

#[tokio::test(start_paused = true)]
async fn keeps_polling_after_a_failed_round_and_recovers_on_the_next() {
    let venue = TestVenue::new();
    venue.fail(anyhow::anyhow!("socket hang up"));
    venue.reply(rows(&[("AAAUSDT", row(1.0))]));
    let mut run = start(venue, &["AAAUSDT"]);

    flush().await;
    assert!(run.sent().is_empty());

    next_tick().await;
    assert_eq!(run.sent().len(), 1);
    run.stop().await;
}

#[tokio::test(start_paused = true)]
async fn pauses_after_a_rate_limit_answer_for_the_retry_after_the_venue_sent() {
    let (logs, _guard) = capture();
    let venue = TestVenue::new();
    venue.fail(rate_limited(
        "429 Too Many Requests",
        Some(Duration::from_secs(3)),
    ));
    venue.reply(rows(&[("AAAUSDT", row(1.0))]));
    venue.reply(rows(&[("AAAUSDT", row(1.0))]));
    let mut run = start(venue, &["AAAUSDT"]);
    flush().await;

    tokio::time::advance(INTERVAL * 2).await;
    flush().await;
    assert!(run.sent().is_empty());
    assert_eq!(run.venue.calls().len(), 1);

    next_tick().await;
    assert_eq!(run.sent().len(), 1);

    let paused = logs.events("anchor_poll_paused");
    assert_eq!(paused.len(), 1);
    assert_eq!(paused[0].level, Level::ERROR);
    assert_eq!(paused[0].number("pause_ms"), 3_000.0);
    assert_eq!(
        paused[0].text("error"),
        "429 Too Many Requests from https://x"
    );
    run.stop().await;
}

#[tokio::test(start_paused = true)]
async fn keeps_the_ts_a_row_carries_and_stamps_the_others_with_the_arrival() {
    let venue = TestVenue::new();
    let answer = venue.hold();
    let mut run = start(venue, &["AAAUSDT", "BBBUSDT"]);
    flush().await;

    let own = AnchorRow {
        ts: Some(T0 + 120),
        ..row(1.0)
    };
    let before = now_ms();
    answer
        .send(rows(&[("AAAUSDT", own), ("BBBUSDT", row(2.0))]))
        .unwrap();
    flush().await;
    let after = now_ms();

    let rounds = run.sent();
    assert_eq!(rounds.len(), 1);
    assert_reading(&rounds[0][0], slot(0), own);
    assert_eq!(rounds[0][0].1.ts, T0 + 120);
    assert_reading(&rounds[0][1], slot(1), row(2.0));
    let ts = rounds[0][1].1.ts;
    assert!(before <= ts && ts <= after, "{before} <= {ts} <= {after}");
    run.stop().await;
}

#[tokio::test(start_paused = true)]
async fn pauses_for_the_default_pause_on_a_rate_limit_sent_inside_a_successful_reply() {
    let (logs, _guard) = capture();
    let venue = TestVenue::new();
    venue.fail(rate_limited("code 510", None));
    venue.reply(rows(&[("AAAUSDT", row(1.0))]));
    let mut run = start(venue, &["AAAUSDT"]);
    flush().await;

    tokio::time::advance(Duration::from_secs(59)).await;
    flush().await;
    assert!(run.sent().is_empty());
    assert_eq!(run.venue.calls().len(), 1);

    tokio::time::advance(Duration::from_secs(2)).await;
    flush().await;
    assert_eq!(run.sent().len(), 1);

    let paused = logs.events("anchor_poll_paused");
    assert_eq!(paused.len(), 1);
    assert_eq!(paused[0].number("pause_ms"), 60_000.0);
    assert_eq!(paused[0].text("error"), "code 510 from https://x");
    run.stop().await;
}

#[tokio::test(start_paused = true)]
async fn fails_the_round_when_no_tracked_market_could_be_written() {
    let (logs, _guard) = capture();
    let venue = TestVenue::new();
    venue.reply(rows(&[("AAAUSDT", refused_row())]));
    let mut run = start(venue, &["AAAUSDT"]);
    flush().await;

    assert!(run.sent().is_empty());
    let rejected = logs.events("anchor_update_rejected");
    assert_eq!(rejected.len(), 1);
    assert_eq!(rejected[0].level, Level::WARN);
    assert_eq!(rejected[0].text("market"), "AAAUSDT");
    assert_eq!(rejected[0].text("issue"), "mark_invalid");
    let failed = logs.events("anchor_round_failed");
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].level, Level::WARN);
    assert_eq!(failed[0].number("failures"), 1.0);
    assert_eq!(
        failed[0].text("error"),
        "no tracked market written from 1 row(s): 0 missing, 1 rejected"
    );
    run.stop().await;
}

#[tokio::test(start_paused = true)]
async fn aborts_the_round_in_flight_and_polls_no_more() {
    let (logs, _guard) = capture();
    let venue = TestVenue::new();
    let answer = venue.hold();
    venue.reply(rows(&[("AAAUSDT", row(1.0))]));
    let mut run = start(venue, &["AAAUSDT"]);
    flush().await;
    assert!(!answer.is_closed());

    run.cancel.cancel();
    tokio::time::advance(INTERVAL * 3).await;
    flush().await;

    // The round's future held the receiver, so a closed sender means the poller dropped the round.
    assert!(answer.is_closed());
    run.ended().await;
    assert_eq!(run.venue.calls().len(), 1);
    assert!(run.sent().is_empty());
    let stopped = logs.events("anchor_poll_stopped");
    assert_eq!(stopped.len(), 1);
    assert_eq!(stopped[0].text("in_flight"), "true");
}

#[tokio::test(start_paused = true)]
async fn is_idempotent() {
    let (logs, _guard) = capture();
    let venue = TestVenue::new();
    venue.reply(rows(&[("AAAUSDT", row(1.0))]));
    let mut run = start(venue, &["AAAUSDT"]);
    flush().await;

    run.cancel.cancel();
    run.cancel.cancel();
    tokio::time::advance(INTERVAL * 3).await;
    flush().await;

    run.ended().await;
    assert_eq!(run.venue.calls().len(), 1);
    let stopped = logs.events("anchor_poll_stopped");
    assert_eq!(stopped.len(), 1);
    assert_eq!(stopped[0].text("in_flight"), "false");
}

#[tokio::test]
async fn returns_the_decoded_body_on_200() {
    let url = serve(StatusCode::OK, None, r#"{"ok":1}"#).await;

    let body: serde_json::Value = get_json(&http(), &url).await.unwrap();

    assert_eq!(body, serde_json::json!({ "ok": 1 }));
}

#[tokio::test]
async fn throws_an_http_status_error_carrying_the_status_and_retry_after_on_a_non_2xx() {
    let url = serve(StatusCode::TOO_MANY_REQUESTS, Some("7"), "slow down").await;

    let error = get_json::<serde_json::Value>(&http(), &url)
        .await
        .unwrap_err();

    let limited = error
        .downcast_ref::<RateLimited>()
        .expect("a 429 is a rate limit");
    assert_eq!(limited.url, url);
    assert_eq!(limited.reason, "429 Too Many Requests");
    assert_eq!(limited.retry_after, Some(Duration::from_secs(7)));
}

#[tokio::test]
async fn reads_a_500_as_a_plain_failure_and_not_a_rate_limit() {
    let url = serve(StatusCode::INTERNAL_SERVER_ERROR, None, "").await;

    let error = get_json::<serde_json::Value>(&http(), &url)
        .await
        .unwrap_err();

    assert!(error.downcast_ref::<RateLimited>().is_none());
    assert_eq!(
        error.to_string(),
        format!("500 Internal Server Error from {url}")
    );
}

#[tokio::test]
async fn reads_403_and_418_as_rate_limits() {
    let cases = [
        (StatusCode::FORBIDDEN, "403 Forbidden"),
        (StatusCode::IM_A_TEAPOT, "418 I'm a teapot"),
    ];
    for (status, reason) in cases {
        let url = serve(status, None, "").await;

        let error = get_json::<serde_json::Value>(&http(), &url)
            .await
            .unwrap_err();

        let limited = error.downcast_ref::<RateLimited>().expect("a rate limit");
        assert_eq!(limited.reason, reason);
        assert_eq!(limited.retry_after, None);
    }
}

#[test]
fn reads_retry_after_in_whole_seconds() {
    assert_eq!(retry_after("7"), Some(Duration::from_secs(7)));
    assert_eq!(retry_after("0"), Some(Duration::ZERO));
}

#[test]
fn reads_retry_after_as_an_http_date_in_the_future() {
    let at = chrono::Utc::now() + chrono::TimeDelta::seconds(30);
    let header = at.format("%a, %d %b %Y %H:%M:%S GMT").to_string();

    let wait = retry_after(&header).unwrap();

    // The date drops the milliseconds, so the wait falls up to a second short of 30 s.
    assert!(
        wait > Duration::from_secs(28) && wait <= Duration::from_secs(30),
        "{wait:?}"
    );
}

#[test]
fn reads_a_retry_after_date_in_the_past_as_zero() {
    assert_eq!(
        retry_after("Sun, 06 Nov 1994 08:49:37 GMT"),
        Some(Duration::ZERO)
    );
}

#[test]
fn reads_garbage_retry_after_as_none() {
    for header in ["soon", "", "1.5", "-3"] {
        assert_eq!(retry_after(header), None, "{header:?}");
    }
}

#[tokio::test(start_paused = true)]
async fn refuses_to_start_a_venue_with_a_zero_poll_every() {
    let (logs, _guard) = capture();
    let mut run = start(TestVenue::polling_every(Duration::ZERO), &["AAAUSDT"]);
    flush().await;

    // tokio's interval panics on a zero period, so the task must end before it builds one.
    run.ended().await;
    assert!(run.venue.calls().is_empty());
    let aborted = logs.events("anchor_poll_aborted");
    assert_eq!(aborted.len(), 1);
    assert_eq!(aborted[0].number("markets"), 1.0);
    assert_eq!(aborted[0].number("every_ms"), 0.0);
}

#[tokio::test(start_paused = true)]
async fn logs_the_summary_every_60_rounds_with_its_counts() {
    let (logs, _guard) = capture();
    let venue = TestVenue::new();
    venue.fail(anyhow::anyhow!("socket hang up"));
    for _ in 0..2 {
        venue.reply(rows(&[("AAAUSDT", row(1.0)), ("BBBUSDT", refused_row())]));
    }
    for _ in 0..3 {
        venue.reply(rows(&[("AAAUSDT", row(1.0))]));
    }
    for _ in 0..54 {
        venue.reply(rows(&[("AAAUSDT", row(1.0)), ("BBBUSDT", row(2.0))]));
    }
    let mut run = start(venue, &["AAAUSDT", "BBBUSDT"]);

    flush().await;
    for _ in 0..58 {
        next_tick().await;
    }
    assert!(logs.events("anchor_poll_summary").is_empty());

    next_tick().await;
    let summaries = logs.events("anchor_poll_summary");
    assert_eq!(summaries.len(), 1);
    let summary = &summaries[0];
    assert_eq!(summary.level, Level::INFO);
    assert_eq!(summary.text("venue"), VENUE_ID);
    assert_eq!(summary.number("rounds"), 59.0);
    assert_eq!(summary.number("failed"), 1.0);
    assert_eq!(summary.number("skipped"), 0.0);
    assert_eq!(summary.number("written"), (2 + 3 + 54 * 2) as f64);
    assert_eq!(summary.number("missing"), 3.0);
    assert_eq!(summary.number("rejected"), 2.0);
    assert_eq!(summary.number("avg_ms"), 0.0);
    assert_eq!(summary.number("max_ms"), 0.0);
    assert_eq!(logs.events("anchor_update_rejected").len(), 2); // a refused reading warns each time, a missing row only once
    assert_eq!(logs.events("anchor_row_missing").len(), 1);

    // The window starts over, so 60 more rounds that fail on an empty reply count only themselves.
    for _ in 0..60 {
        next_tick().await;
    }
    let summaries = logs.events("anchor_poll_summary");
    assert_eq!(summaries.len(), 2);
    assert_eq!(summaries[1].number("rounds"), 0.0);
    assert_eq!(summaries[1].number("failed"), 60.0);
    assert_eq!(summaries[1].number("written"), 0.0);
    assert_eq!(summaries[1].number("missing"), 120.0);
    assert_eq!(summaries[1].number("rejected"), 0.0);
    run.stop().await;
}

#[tokio::test(start_paused = true)]
async fn logs_a_failure_on_the_first_and_every_30th_in_a_row() {
    let (logs, _guard) = capture();
    let mut run = start(TestVenue::new(), &["AAAUSDT"]); // nothing queued, so every round reads an empty reply and fails

    flush().await;
    for _ in 0..60 {
        next_tick().await;
    }

    let failed = logs.events("anchor_round_failed");
    let mut failures = Vec::new();
    for line in &failed {
        assert_eq!(line.level, Level::WARN);
        failures.push(line.number("failures"));
    }
    assert_eq!(failures, [1.0, 30.0, 60.0]);
    assert_eq!(
        failed[0].text("error"),
        "no tracked market written from 0 row(s): 1 missing, 0 rejected"
    );
    run.stop().await;
}

#[tokio::test(start_paused = true)]
async fn logs_a_recovery_once() {
    let (logs, _guard) = capture();
    let venue = TestVenue::new();
    venue.fail(anyhow::anyhow!("socket hang up"));
    venue.fail(anyhow::anyhow!("socket hang up"));
    venue.reply(rows(&[("AAAUSDT", row(1.0))]));
    venue.reply(rows(&[("AAAUSDT", row(1.0))]));
    let mut run = start(venue, &["AAAUSDT"]);

    flush().await;
    for _ in 0..3 {
        next_tick().await;
    }

    assert_eq!(run.sent().len(), 2);
    let failed = logs.events("anchor_round_failed");
    assert_eq!(failed.len(), 1);
    assert_eq!(failed[0].text("error"), "socket hang up");
    let recovered = logs.events("anchor_poll_recovered");
    assert_eq!(recovered.len(), 1);
    assert_eq!(recovered[0].level, Level::INFO);
    assert_eq!(recovered[0].number("failures"), 2.0);
    run.stop().await;
}

#[tokio::test(start_paused = true)]
async fn counts_the_ticks_a_slow_round_overran_as_skipped() {
    let (logs, _guard) = capture();
    let venue = TestVenue::new();
    venue.reply(rows(&[("AAAUSDT", row(1.0))]));
    let answer = venue.hold();
    for _ in 0..58 {
        venue.reply(rows(&[("AAAUSDT", row(1.0))]));
    }
    let mut run = start(venue, &["AAAUSDT"]);

    flush().await;
    next_tick().await; // the second round starts at 1 s and answers at 4 s
    tokio::time::advance(INTERVAL * 3).await;
    flush().await;
    assert_eq!(run.venue.calls().len(), 2);
    answer.send(rows(&[("AAAUSDT", row(1.0))])).unwrap();
    flush().await;

    for _ in 0..58 {
        next_tick().await;
    }

    let summaries = logs.events("anchor_poll_summary");
    assert_eq!(summaries.len(), 1);
    assert_eq!(summaries[0].number("rounds"), 60.0);
    assert_eq!(summaries[0].number("skipped"), 3.0); // the ticks due at 2, 3 and 4 s
    assert_eq!(summaries[0].number("max_ms"), 3_000.0);
    assert_eq!(summaries[0].number("avg_ms"), 50.0);
    run.stop().await;
}
