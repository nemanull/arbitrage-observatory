// Ported case for case from old_ts_server/src/feeds/book/VenueFeed.spec.ts, on real time and local sockets in place of fake timers.
// The cases after the port are new: the runtime against local WebSocket servers, reconnect_delay, FeedSettings and spawn_feed.

use super::*;
use crate::engine::cluster::index_builder::DEPTH_LEVEL;
use crate::test_log::capture;
use serde::{Deserialize, Serialize};
use tokio::net::{TcpListener, TcpStream};
use tokio::sync::mpsc::{self, Receiver};
use tokio::time::sleep_until;
use tokio_tungstenite::{WebSocketStream, accept_async};
use tracing::Level;

const VENUE: &str = "testvenue";
const VENUE_INDEX: usize = 2;
const PLAN_ID: &str = "testvenue#0";
const WAIT: Duration = Duration::from_secs(3); // the longest one step of a case may take
const NOWHERE: &str = "ws://127.0.0.1:1"; // nothing listens on port 1, so a connect is refused at once

fn market(raw_market_id: &str) -> Market {
    Market {
        venue_id: VENUE.to_string(),
        raw_market_id: raw_market_id.to_string(),
        base: raw_market_id.to_string(),
        quote: "USDT".to_string(),
        taker_ppm: 500,
        linear: true,
        contract_size: 1.0,
    }
}

// Market i of a case sits in cluster 10 + i, so a book that reaches the wrong slot shows.
fn tracked(raw_market_ids: &[&str]) -> Vec<TrackedMarket> {
    let mut markets = Vec::new();
    for (i, raw_market_id) in raw_market_ids.iter().enumerate() {
        markets.push(TrackedMarket {
            market: market(raw_market_id),
            slot: Slot {
                cluster: 10 + i,
                venue: VENUE_INDEX,
            },
        });
    }
    markets
}

fn endpoint(id: &str, url: &str, raw_market_ids: &[&str]) -> EndpointPlan {
    let mut markets = Vec::new();
    for raw_market_id in raw_market_ids {
        markets.push(market(raw_market_id));
    }
    EndpointPlan {
        id: id.to_string(),
        url: url.to_string(),
        markets,
    }
}

// No ping, no silence check, no retirement, and the first reconnect exactly 500 ms after a socket ends.
fn quiet() -> FeedSettings {
    FeedSettings {
        reconnect_jitter: Duration::ZERO,
        ..FeedSettings::new(Duration::ZERO)
    }
}

fn level(price: f64, size: f64) -> BookLevel {
    BookLevel { price, size }
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut out = Vec::new();
    for &(price, size) in pairs {
        out.push(level(price, size));
    }
    out
}

// A frame is a JSON list of ops, so one frame can change one market several times.
#[derive(Serialize, Deserialize)]
#[serde(tag = "op", rename_all = "snake_case")]
enum Op {
    Snapshot {
        market: String,
        bids: Vec<(f64, f64)>,
        asks: Vec<(f64, f64)>,
    },
    Bid {
        market: String,
        price: f64,
        size: f64,
    },
    Ask {
        market: String,
        price: f64,
        size: f64,
    },
    Resync {
        market: String,
    },
    Reply {
        text: String,
    },
    Fail,
    Panic,
}

fn snapshot(market: &str, bids: &[(f64, f64)], asks: &[(f64, f64)]) -> Op {
    Op::Snapshot {
        market: market.to_string(),
        bids: bids.to_vec(),
        asks: asks.to_vec(),
    }
}

fn bid(market: &str, price: f64, size: f64) -> Op {
    Op::Bid {
        market: market.to_string(),
        price,
        size,
    }
}

fn ask(market: &str, price: f64, size: f64) -> Op {
    Op::Ask {
        market: market.to_string(),
        price,
        size,
    }
}

fn resync(market: &str) -> Op {
    Op::Resync {
        market: market.to_string(),
    }
}

// What an adapter's handle does, in the order the design asks: position, then book, then publish.
fn apply<S: Default>(frame: &[u8], conn: &mut Connection<S>) -> anyhow::Result<()> {
    let ops: Vec<Op> = serde_json::from_slice(frame)?;
    for op in ops {
        match op {
            Op::Snapshot { market, bids, asks } => {
                let Some(position) = conn.position(&market) else {
                    continue;
                };
                conn.reset_book(position, &levels(&bids), &levels(&asks));
            }
            Op::Bid { market, price, size } => {
                let Some(position) = conn.position(&market) else {
                    continue;
                };
                let Some(book) = conn.book(position) else {
                    continue;
                };
                book.set_bid(price, size);
                conn.publish(position);
            }
            Op::Ask { market, price, size } => {
                let Some(position) = conn.position(&market) else {
                    continue;
                };
                let Some(book) = conn.book(position) else {
                    continue;
                };
                book.set_ask(price, size);
                conn.publish(position);
            }
            Op::Resync { market } => conn.resync(&market, "sequence_gap"),
            Op::Reply { text } => conn.send(Message::text(text)),
            Op::Fail => anyhow::bail!("the venue could not read this frame"),
            Op::Panic => panic!("the venue indexed past its state"),
        }
    }
    Ok(())
}

// Each subscribe frame is one market's raw id, as the spec's venue sent.
fn one_frame_per_market(markets: &[Market]) -> Vec<Message> {
    let mut frames = Vec::new();
    for market in markets {
        frames.push(Message::text(market.raw_market_id.clone()));
    }
    frames
}

// Its plans are fixed by the case, so a plan can hold a market nobody tracks.
struct TestVenue {
    settings: FeedSettings,
    plans: Vec<EndpointPlan>,
}

impl BookVenue for TestVenue {
    type State = ();

    fn settings(&self) -> FeedSettings {
        self.settings.clone()
    }

    fn plan(&self, _markets: &[Market]) -> Vec<EndpointPlan> {
        self.plans.clone()
    }

    fn subscribe_frames(&self, markets: &[Market], _state: &mut ()) -> Vec<Message> {
        one_frame_per_market(markets)
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<()>) -> anyhow::Result<()> {
        apply(frame, conn)
    }
}

// Pings with text that counts the pings of its connection, so the count shows whether the state started fresh.
struct TextPingVenue {
    url: String,
}

impl BookVenue for TextPingVenue {
    type State = u32; // pings sent on this connection

    fn settings(&self) -> FeedSettings {
        FeedSettings {
            ping_every: Some(Duration::from_millis(200)),
            ..quiet()
        }
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        vec![EndpointPlan {
            id: PLAN_ID.to_string(),
            url: self.url.clone(),
            markets: markets.to_vec(),
        }]
    }

    fn subscribe_frames(&self, markets: &[Market], _sent: &mut u32) -> Vec<Message> {
        one_frame_per_market(markets)
    }

    fn ping(&self, sent: &mut u32) -> Message {
        *sent += 1;
        Message::text(format!("ping {sent}"))
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<u32>) -> anyhow::Result<()> {
        apply(frame, conn)
    }
}

// One socket, PLAN_ID on url, carrying the given markets as clusters 10, 11 and so on.
fn start(
    url: &str,
    settings: FeedSettings,
    raw_market_ids: &[&str],
    tx: &Sender<EngineEvent>,
    cancel: &CancellationToken,
) -> Vec<JoinHandle<()>> {
    let venue = TestVenue {
        settings,
        plans: vec![endpoint(PLAN_ID, url, raw_market_ids)],
    };
    spawn_feed(Arc::new(venue), VENUE, VENUE_INDEX, &tracked(raw_market_ids), tx, cancel)
}

// Cancels the feed and waits for its tasks, so a task that panicked fails the case.
async fn stop(cancel: &CancellationToken, tasks: Vec<JoinHandle<()>>) {
    cancel.cancel();
    for task in tasks {
        timeout(WAIT, task).await.expect("a task outlived its cancel").unwrap();
    }
}

type Socket = WebSocketStream<TcpStream>;

async fn listen() -> (TcpListener, String) {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let url = format!("ws://{}", listener.local_addr().unwrap());
    (listener, url)
}

async fn accept(listener: &TcpListener) -> Socket {
    let (stream, _) = timeout(WAIT, listener.accept())
        .await
        .expect("the feed did not connect")
        .unwrap();
    accept_async(stream).await.unwrap()
}

async fn send(socket: &mut Socket, ops: &[Op]) {
    let text = serde_json::to_string(ops).unwrap();
    socket.send(Message::text(text)).await.unwrap();
}

// The next text frame from the feed, past any ping or pong.
async fn read_text(socket: &mut Socket) -> String {
    loop {
        let message = timeout(WAIT, socket.next()).await.expect("the feed sent no text frame");
        match message {
            Some(Ok(Message::Text(text))) => return text.as_str().to_string(),
            Some(Ok(Message::Ping(_) | Message::Pong(_))) => {}
            other => panic!("expected a text frame, got {other:?}"),
        }
    }
}

async fn read_texts(socket: &mut Socket, count: usize) -> Vec<String> {
    let mut texts = Vec::new();
    for _ in 0..count {
        texts.push(read_text(socket).await);
    }
    texts
}

// Reads until the feed's side of the socket is gone, failing on any text frame on the way.
async fn expect_end(socket: &mut Socket) {
    loop {
        let message = timeout(WAIT, socket.next()).await.expect("the feed kept the socket open");
        match message {
            Some(Ok(Message::Text(text))) => panic!("the feed sent {text} on a socket it should have left"),
            Some(Ok(_)) => {}
            Some(Err(_)) | None => return,
        }
    }
}

async fn next_event(rx: &mut Receiver<EngineEvent>) -> EngineEvent {
    match timeout(WAIT, rx.recv()).await {
        Ok(Some(event)) => event,
        Ok(None) => panic!("the engine channel closed"),
        Err(_) => panic!("no engine event within {WAIT:?}"),
    }
}

async fn next_book(rx: &mut Receiver<EngineEvent>) -> BookUpdate {
    let event = next_event(rx).await;
    let EngineEvent::Book(update) = event else {
        panic!("expected a book, got {event:?}");
    };
    update
}

// The next event must be the Stale of the case's one socket, naming every cluster of its plan.
async fn expect_stale(rx: &mut Receiver<EngineEvent>, clusters: &[ClusterId]) {
    let event = next_event(rx).await;
    let EngineEvent::Stale {
        venue,
        clusters: stale,
        connection,
    } = event
    else {
        panic!("expected a stale, got {event:?}");
    };
    assert_eq!(venue, VENUE_INDEX);
    assert_eq!(stale, clusters);
    assert_eq!(connection, PLAN_ID);
}

#[tokio::test]
async fn sends_every_frame_on_open_when_the_venue_sets_no_gap() {
    let (logs, _guard) = capture();
    let (listener, url) = listen().await;
    let (tx, _rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let tasks = start(&url, quiet(), &["AAA", "BBB", "CCC"], &tx, &cancel);

    let mut socket = accept(&listener).await;
    let first = read_text(&mut socket).await;
    let first_at = Instant::now();
    let rest = read_texts(&mut socket, 2).await;

    assert_eq!(first, "AAA");
    assert_eq!(rest, ["BBB", "CCC"]);
    assert!(first_at.elapsed() < Duration::from_millis(100), "the frames came {:?} apart", first_at.elapsed());

    let opened = logs.events("connection_opened");
    assert_eq!(opened.len(), 1);
    assert_eq!(opened[0].level, Level::INFO);
    assert_eq!(opened[0].text("connection"), PLAN_ID);
    assert_eq!(opened[0].number("markets"), 3.0);
    assert_eq!(opened[0].number("subscribe_frames"), 3.0);

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn sends_the_first_frame_on_open_and_one_more_per_gap() {
    let gap = Duration::from_millis(300);
    let (listener, url) = listen().await;
    let (tx, _rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let settings = FeedSettings {
        subscribe_gap: gap,
        ..quiet()
    };
    let tasks = start(&url, settings, &["AAA", "BBB", "CCC"], &tx, &cancel);

    let mut socket = accept(&listener).await;
    let accepted = Instant::now();
    let mut arrivals = Vec::new();
    for expected in ["AAA", "BBB", "CCC"] {
        assert_eq!(read_text(&mut socket).await, expected);
        arrivals.push(accepted.elapsed());
    }

    // Pacing starts after the handshake, so the lower bounds are exact and only the upper ones allow for a busy machine.
    assert!(arrivals[0] < gap / 2, "the first frame waited {:?}", arrivals[0]);
    for (i, arrival) in arrivals.iter().enumerate().skip(1) {
        let due = gap * i as u32;
        assert!(*arrival >= due && *arrival < due + gap, "frame {i} came after {arrival:?}");
    }

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn stops_sending_once_the_socket_is_no_longer_open() {
    let (logs, _guard) = capture();
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let settings = FeedSettings {
        subscribe_gap: Duration::from_millis(300),
        ..quiet()
    };
    let tasks = start(&url, settings, &["AAA", "BBB", "CCC"], &tx, &cancel);

    let mut first = accept(&listener).await;
    assert_eq!(read_text(&mut first).await, "AAA");
    first.close(None).await.unwrap();

    // Nothing follows the close on the first socket, and the pacing starts over on the next one.
    expect_end(&mut first).await;
    expect_stale(&mut rx, &[10, 11, 12]).await;
    let mut second = accept(&listener).await;
    assert_eq!(read_texts(&mut second, 3).await, ["AAA", "BBB", "CCC"]);

    assert_eq!(logs.events("connection_ended").len(), 1);
    assert!(logs.events("connection_error").is_empty(), "a frame went to a socket that was gone");

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn logs_once_the_markets_that_hold_no_book_after_the_last_frame_and_the_wait() {
    let (logs, _guard) = capture();
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    // Due two gaps and the wait after the open, at 1.5 s, between the housekeeping ticks at 1 s and 2 s.
    let settings = FeedSettings {
        subscribe_gap: Duration::from_millis(250),
        first_book_wait: Duration::from_secs(1),
        ..quiet()
    };
    let tasks = start(&url, settings, &["AAA", "BBB", "CCC"], &tx, &cancel);

    let mut socket = accept(&listener).await;
    let accepted = Instant::now();
    assert_eq!(read_text(&mut socket).await, "AAA");
    send(&mut socket, &[snapshot("BBB", &[(100.0, 1.0)], &[(101.0, 1.0)])]).await;
    next_book(&mut rx).await;

    sleep_until(accepted + Duration::from_millis(1_300)).await;
    assert!(logs.events("book_unserved").is_empty(), "warned before the last frame and the wait were over");

    sleep_until(accepted + Duration::from_millis(2_500)).await;
    let warnings = logs.events("book_unserved");
    assert_eq!(warnings.len(), 1);
    assert_eq!(warnings[0].level, Level::WARN);
    assert_eq!(warnings[0].text("connection"), PLAN_ID);
    assert_eq!(warnings[0].number("missing"), 2.0);
    assert_eq!(warnings[0].number("markets"), 3.0);
    assert_eq!(warnings[0].text("sample"), r#"["AAA", "CCC"]"#);

    sleep_until(accepted + Duration::from_millis(3_500)).await;
    assert_eq!(logs.events("book_unserved").len(), 1, "warned again on a later tick");

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn says_nothing_when_every_market_has_a_book() {
    let (logs, _guard) = capture();
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    // Due 200 ms after the open, so the housekeeping tick at 1 s checks it.
    let settings = FeedSettings {
        first_book_wait: Duration::from_millis(200),
        ..quiet()
    };
    let tasks = start(&url, settings, &["AAA", "BBB"], &tx, &cancel);

    let mut socket = accept(&listener).await;
    let accepted = Instant::now();
    read_texts(&mut socket, 2).await;
    send(
        &mut socket,
        &[
            snapshot("AAA", &[(100.0, 1.0)], &[(101.0, 1.0)]),
            snapshot("BBB", &[(100.0, 1.0)], &[(101.0, 1.0)]),
        ],
    )
    .await;
    next_book(&mut rx).await;
    next_book(&mut rx).await;

    sleep_until(accepted + Duration::from_millis(1_500)).await;
    assert!(logs.events("book_unserved").is_empty());

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn a_snapshot_publishes_the_market_with_its_slot_its_levels_best_first_and_the_recv_ts_of_its_frame() {
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let tasks = start(&url, quiet(), &["AAA", "BBB"], &tx, &cancel);
    let mut socket = accept(&listener).await;
    read_texts(&mut socket, 2).await;

    // More bids than the engine keeps, worst first, so the update must sort them and keep the best.
    let mut bids = Vec::new();
    for i in (0..DEPTH_LEVEL + 5).rev() {
        bids.push((100.0 - i as f64, 1.0 + i as f64));
    }
    let before = now_ms();
    send(&mut socket, &[snapshot("BBB", &bids, &[(103.0, 3.0), (101.0, 1.0), (102.0, 2.0)])]).await;
    let update = next_book(&mut rx).await;
    let after = now_ms();

    assert_eq!(
        update.slot,
        Slot {
            cluster: 11,
            venue: VENUE_INDEX
        }
    );
    let best_bids = update.bids.as_slice();
    assert_eq!(best_bids.len(), DEPTH_LEVEL);
    for (i, best) in best_bids.iter().enumerate() {
        assert_eq!(*best, level(100.0 - i as f64, 1.0 + i as f64), "bid {i}");
    }
    assert_eq!(update.asks.as_slice(), [level(101.0, 1.0), level(102.0, 2.0), level(103.0, 3.0)]);
    assert!(
        before <= update.recv_ts && update.recv_ts <= after,
        "recv_ts {} is outside the frame's flight {before}..{after}",
        update.recv_ts
    );

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn text_and_binary_frames_both_reach_handle_as_bytes() {
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let tasks = start(&url, quiet(), &["AAA", "BBB"], &tx, &cancel);
    let mut socket = accept(&listener).await;
    read_texts(&mut socket, 2).await;

    send(&mut socket, &[snapshot("AAA", &[(100.0, 1.0)], &[(101.0, 1.0)])]).await;
    let binary = serde_json::to_vec(&[snapshot("BBB", &[(50.0, 1.0)], &[(51.0, 1.0)])]).unwrap();
    socket.send(Message::binary(binary)).await.unwrap();

    assert_eq!(next_book(&mut rx).await.slot.cluster, 10);
    assert_eq!(next_book(&mut rx).await.slot.cluster, 11);

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn a_frame_that_publishes_one_market_several_times_sends_it_once() {
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let tasks = start(&url, quiet(), &["AAA", "BBB"], &tx, &cancel);
    let mut socket = accept(&listener).await;
    read_texts(&mut socket, 2).await;

    send(
        &mut socket,
        &[
            snapshot("AAA", &[(100.0, 1.0)], &[(101.0, 1.0)]),
            bid("AAA", 100.5, 2.0),
            ask("AAA", 100.8, 3.0),
        ],
    )
    .await;
    // Another market's frame behind it, so a second copy of AAA would arrive in between.
    send(&mut socket, &[snapshot("BBB", &[(50.0, 1.0)], &[(51.0, 1.0)])]).await;

    let first = next_book(&mut rx).await;
    let second = next_book(&mut rx).await;
    assert_eq!(first.slot.cluster, 10);
    assert_eq!(first.bids.as_slice(), [level(100.5, 2.0), level(100.0, 1.0)]);
    assert_eq!(first.asks.as_slice(), [level(100.8, 3.0), level(101.0, 1.0)]);
    assert_eq!(second.slot.cluster, 11, "AAA went out more than once for one frame");

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn a_delta_applied_through_book_then_publish_sends_the_new_top() {
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let tasks = start(&url, quiet(), &["AAA"], &tx, &cancel);
    let mut socket = accept(&listener).await;
    read_texts(&mut socket, 1).await;

    // Before its first snapshot a market has no book, so this delta changes nothing and sends nothing.
    send(&mut socket, &[bid("AAA", 99.0, 1.0)]).await;
    send(&mut socket, &[snapshot("AAA", &[(100.0, 1.0)], &[(101.0, 1.0), (102.0, 2.0)])]).await;
    let first = next_book(&mut rx).await;
    assert_eq!(first.bids.as_slice(), [level(100.0, 1.0)]);
    assert_eq!(first.asks.as_slice(), [level(101.0, 1.0), level(102.0, 2.0)]);

    send(&mut socket, &[bid("AAA", 100.5, 2.0)]).await;
    let raised = next_book(&mut rx).await;
    assert_eq!(raised.bids.as_slice(), [level(100.5, 2.0), level(100.0, 1.0)]);

    send(&mut socket, &[ask("AAA", 101.0, 0.0)]).await;
    let lifted = next_book(&mut rx).await;
    assert_eq!(lifted.asks.as_slice(), [level(102.0, 2.0)]);

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn an_unsubscribed_symbol_is_dropped_and_warned_once_per_socket() {
    let (logs, _guard) = capture();
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let tasks = start(&url, quiet(), &["AAA"], &tx, &cancel);
    let (bids, asks) = ([(100.0, 1.0)], [(101.0, 1.0)]);

    let mut first = accept(&listener).await;
    read_texts(&mut first, 1).await;
    send(&mut first, &[snapshot("ZZZ", &bids, &asks), snapshot("YYY", &bids, &asks)]).await;
    send(&mut first, &[snapshot("ZZZ", &bids, &asks)]).await;
    send(&mut first, &[snapshot("AAA", &bids, &asks)]).await;
    assert_eq!(next_book(&mut rx).await.slot.cluster, 10, "a symbol nobody subscribed reached the engine");

    // The warned symbols belong to the socket's plan, so its next connection does not warn them again.
    first.close(None).await.unwrap();
    expect_stale(&mut rx, &[10]).await;
    let mut second = accept(&listener).await;
    read_texts(&mut second, 1).await;
    send(&mut second, &[snapshot("ZZZ", &bids, &asks), snapshot("AAA", &bids, &asks)]).await;
    assert_eq!(next_book(&mut rx).await.slot.cluster, 10);

    let warnings = logs.events("unsubscribed_symbol");
    assert_eq!(warnings.len(), 2);
    assert_eq!(warnings[0].text("market"), "ZZZ");
    assert_eq!(warnings[1].text("market"), "YYY");
    for warning in &warnings {
        assert_eq!(warning.level, Level::WARN);
        assert_eq!(warning.text("connection"), PLAN_ID);
    }

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn coalescing_keeps_reading_while_the_channel_is_full_and_sends_each_market_at_its_newest_state() {
    // One slot left unread until the socket is done, so every book after the first finds the channel full.
    let (tx, mut rx) = mpsc::channel(1);
    let (listener, url) = listen().await;
    let cancel = CancellationToken::new();
    let tasks = start(&url, quiet(), &["AAA", "BBB"], &tx, &cancel);
    let mut socket = accept(&listener).await;
    read_texts(&mut socket, 2).await;

    // Each frame lifts one market, alternating, so a book that went backwards would show a lower price.
    let frames = 2_000;
    for i in 0..frames {
        let market = if i % 2 == 0 { "AAA" } else { "BBB" };
        let price = 100.0 + i as f64;
        send(&mut socket, &[snapshot(market, &[(price, 1.0)], &[(price + 0.5, 1.0)])]).await;
    }

    // The pong to a ping sent after the last frame proves the feed read every frame while the channel stayed full.
    socket.send(Message::Ping(Bytes::from_static(b"last"))).await.unwrap();
    loop {
        let message = timeout(WAIT, socket.next())
            .await
            .expect("the feed stopped reading while the channel was full");
        match message {
            Some(Ok(Message::Pong(payload))) if payload == "last" => break,
            Some(Ok(_)) => {}
            other => panic!("the socket failed before the pong: {other:?}"),
        }
    }
    let read_all_at = now_ms();

    // A book stamped at its flush rather than at its frame's arrival would carry a later recv_ts than this.
    sleep(Duration::from_millis(200)).await;
    let mut books = Vec::new();
    while let Ok(Some(event)) = timeout(Duration::from_millis(300), rx.recv()).await {
        let EngineEvent::Book(update) = event else {
            panic!("expected a book, got {event:?}");
        };
        books.push(update);
    }

    // No market went backwards, in price or in recv_ts.
    for cluster in [10, 11] {
        let mut previous: Option<&BookUpdate> = None;
        for book in &books {
            if book.slot.cluster != cluster {
                continue;
            }
            if let Some(previous) = previous {
                assert!(book.bids.as_slice()[0].price > previous.bids.as_slice()[0].price);
                assert!(book.recv_ts >= previous.recv_ts);
            }
            previous = Some(book);
        }
    }

    // The first frame took the slot, then each waiting market went out once, oldest first, at its newest state.
    let newest_bbb = 100.0 + (frames - 1) as f64;
    let newest_aaa = newest_bbb - 1.0;
    let mut sent = Vec::new();
    for book in &books {
        sent.push((book.slot.cluster, book.bids.as_slice()[0].price));
    }
    assert_eq!(sent, [(10, 100.0), (11, newest_bbb), (10, newest_aaa)]);

    for book in &books {
        assert!(
            book.recv_ts <= read_all_at,
            "a book carries recv_ts {} though every frame had arrived by {read_all_at}",
            book.recv_ts
        );
    }

    stop(&cancel, tasks).await;
}

// The queue itself, without a socket, because the select! loop picks among ready branches at random.
#[test]
fn a_market_that_changes_while_others_wait_goes_out_behind_them() {
    let mut markets = Vec::new();
    let mut slots = Vec::new();
    for tracked in tracked(&["AAA", "BBB", "CCC"]) {
        markets.push(tracked.market);
        slots.push(tracked.slot);
    }
    let mut conn: Connection<()> = Connection::new(PLAN_ID.to_string(), markets, slots);
    let (tx, mut rx) = mpsc::channel(1);

    conn.reset_book(0, &[level(100.0, 1.0)], &[level(101.0, 1.0)]);
    assert!(conn.flush_changed(&tx).is_ok());
    conn.reset_book(1, &[level(50.0, 1.0)], &[level(51.0, 1.0)]);
    assert!(conn.flush_changed(&tx).is_ok());
    let Ok(EngineEvent::Book(first)) = rx.try_recv() else {
        panic!("AAA did not take the free slot");
    };
    assert_eq!(first.slot.cluster, 10);

    // The slot is free again, yet CCC waits behind BBB, and BBB's later change rides its place in the queue.
    conn.reset_book(2, &[level(10.0, 1.0)], &[level(11.0, 1.0)]);
    assert!(conn.flush_changed(&tx).is_ok());
    conn.reset_book(1, &[level(50.5, 1.0)], &[level(51.0, 1.0)]);
    assert!(conn.flush_changed(&tx).is_ok());
    assert!(rx.try_recv().is_err(), "a market went out ahead of the ones already waiting");

    let mut waited = Vec::new();
    while let Some(event) = conn.next_pending() {
        let EngineEvent::Book(update) = event else {
            panic!("expected a book, got {event:?}");
        };
        waited.push((update.slot.cluster, update.bids.as_slice()[0].price));
    }
    assert_eq!(waited, [(11, 50.5), (12, 10.0)]);
}

#[tokio::test]
async fn a_resync_ends_the_connection_after_its_frame_sends_stale_and_reconnects_with_no_books() {
    let (logs, _guard) = capture();
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let tasks = start(&url, quiet(), &["AAA", "BBB"], &tx, &cancel);

    let mut first = accept(&listener).await;
    read_texts(&mut first, 2).await;
    send(&mut first, &[snapshot("AAA", &[(100.0, 1.0)], &[(101.0, 1.0)])]).await;
    send(&mut first, &[snapshot("BBB", &[(50.0, 1.0)], &[(51.0, 1.0)])]).await;
    next_book(&mut rx).await;
    next_book(&mut rx).await;

    // The frame that asks for the resync is finished first, so its own change reaches the engine ahead of the Stale.
    send(&mut first, &[resync("AAA"), bid("BBB", 50.5, 1.0), resync("BBB")]).await;
    let last = next_book(&mut rx).await;
    assert_eq!(last.slot.cluster, 11);
    assert_eq!(last.bids.as_slice()[0], level(50.5, 1.0));
    expect_stale(&mut rx, &[10, 11]).await;
    let stale_at = Instant::now();
    expect_end(&mut first).await;

    let mut second = accept(&listener).await;
    assert!(stale_at.elapsed() >= Duration::from_millis(450), "reconnected after {:?}", stale_at.elapsed());
    assert_eq!(read_texts(&mut second, 2).await, ["AAA", "BBB"]);

    // A delta finds no book on the new connection, so nothing goes out before a snapshot.
    send(&mut second, &[bid("AAA", 100.5, 1.0)]).await;
    send(&mut second, &[snapshot("BBB", &[(50.0, 1.0)], &[(51.0, 1.0)])]).await;
    assert_eq!(next_book(&mut rx).await.slot.cluster, 11, "the old AAA book outlived its connection");

    let resyncs = logs.events("book_resync");
    assert_eq!(resyncs.len(), 1, "a second resync in the same frame logged again");
    assert_eq!(resyncs[0].level, Level::WARN);
    assert_eq!(resyncs[0].text("connection"), PLAN_ID);
    assert_eq!(resyncs[0].text("market"), "AAA");
    assert_eq!(resyncs[0].text("reason"), "sequence_gap");
    let reconnects = logs.events("feed_reconnecting");
    assert_eq!(reconnects.len(), 1);
    assert_eq!(reconnects[0].number("attempt"), 1.0);
    assert_eq!(reconnects[0].number("delay_ms"), 500.0);

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn an_error_from_handle_is_logged_as_frame_handle_failed_and_the_connection_carries_on() {
    let (logs, _guard) = capture();
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let tasks = start(&url, quiet(), &["AAA", "BBB"], &tx, &cancel);
    let mut socket = accept(&listener).await;
    read_texts(&mut socket, 2).await;

    // What the frame changed before it failed still goes out, without waiting for another frame.
    send(&mut socket, &[snapshot("AAA", &[(100.0, 1.0)], &[(101.0, 1.0)]), Op::Fail]).await;
    assert_eq!(next_book(&mut rx).await.slot.cluster, 10);
    socket.send(Message::text("not json")).await.unwrap();
    send(&mut socket, &[snapshot("BBB", &[(50.0, 1.0)], &[(51.0, 1.0)])]).await;
    assert_eq!(next_book(&mut rx).await.slot.cluster, 11);

    let failures = logs.events("frame_handle_failed");
    assert_eq!(failures.len(), 2);
    assert_eq!(failures[0].text("error"), "the venue could not read this frame");
    for failure in &failures {
        assert_eq!(failure.level, Level::ERROR);
        assert_eq!(failure.text("connection"), PLAN_ID);
    }
    assert!(logs.events("feed_reconnecting").is_empty(), "a failed frame ended the connection");

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn a_panic_in_venue_code_ends_the_connection_sends_stale_and_reconnects() {
    let (logs, _guard) = capture();
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let tasks = start(&url, quiet(), &["AAA", "BBB"], &tx, &cancel);

    let mut first = accept(&listener).await;
    read_texts(&mut first, 2).await;
    send(&mut first, &[snapshot("AAA", &[(100.0, 1.0)], &[(101.0, 1.0)])]).await;
    next_book(&mut rx).await;

    // The change made before the panic is dropped with the connection's books.
    send(&mut first, &[bid("AAA", 100.5, 1.0), Op::Panic]).await;
    expect_stale(&mut rx, &[10, 11]).await;
    expect_end(&mut first).await;

    let mut second = accept(&listener).await;
    assert_eq!(read_texts(&mut second, 2).await, ["AAA", "BBB"]);

    let panics = logs.events("venue_panicked");
    assert_eq!(panics.len(), 1);
    assert_eq!(panics[0].level, Level::ERROR);
    assert_eq!(panics[0].text("call"), "handle");
    assert_eq!(panics[0].text("panic"), "the venue indexed past its state");

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn a_frame_sent_from_handle_reaches_the_server_once_the_frame_is_handled() {
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let tasks = start(&url, quiet(), &["AAA"], &tx, &cancel);
    let mut socket = accept(&listener).await;
    read_texts(&mut socket, 1).await;

    let reply = Op::Reply {
        text: r#"{"pong":7}"#.to_string(),
    };
    send(&mut socket, &[reply, snapshot("AAA", &[(100.0, 1.0)], &[(101.0, 1.0)])]).await;
    assert_eq!(read_text(&mut socket).await, r#"{"pong":7}"#);
    next_book(&mut rx).await;

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn a_silent_connection_ends_with_connection_silent_sends_stale_and_reconnects() {
    let (logs, _guard) = capture();
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let settings = FeedSettings {
        max_silence: Duration::from_secs(1),
        ..quiet()
    };
    let tasks = start(&url, settings, &["AAA"], &tx, &cancel);

    let mut first = accept(&listener).await;
    let accepted = Instant::now();
    read_texts(&mut first, 1).await;

    // Silence is checked on the housekeeping tick, so the socket ends at the first tick at or after max_silence.
    expect_stale(&mut rx, &[10]).await;
    let silent_after = accepted.elapsed();
    assert!(
        silent_after >= Duration::from_secs(1) && silent_after < Duration::from_millis(1_800),
        "the socket ended after {silent_after:?}"
    );
    let mut second = accept(&listener).await;
    read_texts(&mut second, 1).await;

    let silent = logs.events("connection_silent");
    assert_eq!(silent.len(), 1);
    assert_eq!(silent[0].level, Level::ERROR);
    assert_eq!(silent[0].text("connection"), PLAN_ID);
    assert!(silent[0].number("silence_ms") >= 1_000.0);

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn protocol_pings_from_the_server_count_as_traffic() {
    let (logs, _guard) = capture();
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let settings = FeedSettings {
        max_silence: Duration::from_secs(1),
        ..quiet()
    };
    let tasks = start(&url, settings, &["AAA"], &tx, &cancel);
    let mut socket = accept(&listener).await;
    read_texts(&mut socket, 1).await;

    // Pings for 2.4 s carry the socket past the checks at 1 s and 2 s that would end a silent one.
    for _ in 0..8 {
        sleep(Duration::from_millis(300)).await;
        socket.send(Message::Ping(Bytes::new())).await.unwrap();
    }

    if let Ok(event) = rx.try_recv() {
        panic!("a socket with pings went silent: {event:?}");
    }
    assert!(logs.events("connection_silent").is_empty());

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn ping_every_sends_a_protocol_ping_on_its_period_by_default() {
    let period = Duration::from_millis(300);
    let (listener, url) = listen().await;
    let (tx, _rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let settings = FeedSettings {
        ping_every: Some(period),
        ..quiet()
    };
    let tasks = start(&url, settings, &["AAA"], &tx, &cancel);
    let mut socket = accept(&listener).await;
    let accepted = Instant::now();
    read_texts(&mut socket, 1).await;

    let mut pings = Vec::new();
    while pings.len() < 3 {
        match timeout(WAIT, socket.next()).await.expect("the feed did not ping") {
            Some(Ok(Message::Ping(_))) => pings.push(accepted.elapsed()),
            other => panic!("expected a protocol ping, got {other:?}"),
        }
    }

    // Ping i is due i + 1 periods after the open and never sooner, so only the upper bound allows for a busy machine.
    for (i, at) in pings.iter().enumerate() {
        let due = period * (i as u32 + 1);
        assert!(*at >= due && *at < due + Duration::from_millis(250), "ping {i} came after {at:?}");
    }

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn a_venue_can_ping_with_text_and_its_state_starts_fresh_on_every_connection() {
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let venue = TextPingVenue { url };
    let tasks = spawn_feed(Arc::new(venue), VENUE, VENUE_INDEX, &tracked(&["AAA"]), &tx, &cancel);

    let mut first = accept(&listener).await;
    assert_eq!(read_texts(&mut first, 3).await, ["AAA", "ping 1", "ping 2"]);
    first.close(None).await.unwrap();
    expect_stale(&mut rx, &[10]).await;

    let mut second = accept(&listener).await;
    assert_eq!(read_texts(&mut second, 2).await, ["AAA", "ping 1"]);

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn retire_after_closes_the_socket_with_a_close_frame_sends_stale_and_reconnects() {
    let (logs, _guard) = capture();
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let settings = FeedSettings {
        retire_after: Some(Duration::from_secs(1)),
        ..quiet()
    };
    let tasks = start(&url, settings, &["AAA"], &tx, &cancel);

    let mut first = accept(&listener).await;
    let accepted = Instant::now();
    read_texts(&mut first, 1).await;
    match timeout(WAIT, first.next()).await.expect("the socket was never retired") {
        Some(Ok(Message::Close(_))) => {}
        other => panic!("expected a close frame, got {other:?}"),
    }
    let retired_after = accepted.elapsed();
    assert!(
        retired_after >= Duration::from_secs(1) && retired_after < Duration::from_millis(1_800),
        "retired after {retired_after:?}"
    );

    expect_stale(&mut rx, &[10]).await;
    let mut second = accept(&listener).await;
    read_texts(&mut second, 1).await;

    let retired = logs.events("connection_retired");
    assert_eq!(retired.len(), 1);
    assert_eq!(retired[0].level, Level::INFO);
    assert_eq!(retired[0].text("connection"), PLAN_ID);

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn a_refused_connect_logs_connection_failed_sends_stale_and_backs_off() {
    let (logs, _guard) = capture();
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let tasks = start(NOWHERE, quiet(), &["AAA", "BBB"], &tx, &cancel);

    expect_stale(&mut rx, &[10, 11]).await;
    let first_failure = Instant::now();
    expect_stale(&mut rx, &[10, 11]).await;
    let backoff = first_failure.elapsed();
    assert!(
        backoff >= Duration::from_millis(450) && backoff < Duration::from_secs(1),
        "the second attempt came after {backoff:?}"
    );

    // The third attempt waits a second, and a cancel cuts that wait short.
    let cancelled_at = Instant::now();
    stop(&cancel, tasks).await;
    assert!(cancelled_at.elapsed() < Duration::from_millis(300));

    let failures = logs.events("connection_failed");
    assert_eq!(failures.len(), 2);
    for failure in &failures {
        assert_eq!(failure.level, Level::ERROR);
        assert_eq!(failure.text("connection"), PLAN_ID);
    }
    let reconnects = logs.events("feed_reconnecting");
    assert_eq!(reconnects.len(), 2);
    assert_eq!(reconnects[0].number("attempt"), 1.0);
    assert_eq!(reconnects[0].number("delay_ms"), 500.0);
    assert_eq!(reconnects[1].number("attempt"), 2.0);
    assert_eq!(reconnects[1].number("delay_ms"), 1_000.0);
}

#[tokio::test]
async fn a_data_frame_resets_the_reconnect_backoff() {
    let (logs, _guard) = capture();
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let tasks = start(&url, quiet(), &["AAA"], &tx, &cancel);

    // Two handshakes cut off by dropping the stream, so the backoff climbs to its second step.
    for _ in 0..2 {
        let (stream, _) = timeout(WAIT, listener.accept())
            .await
            .expect("the feed did not connect")
            .unwrap();
        drop(stream);
        expect_stale(&mut rx, &[10]).await;
    }

    let mut socket = accept(&listener).await;
    read_texts(&mut socket, 1).await;
    send(&mut socket, &[snapshot("AAA", &[(100.0, 1.0)], &[(101.0, 1.0)])]).await;
    next_book(&mut rx).await;
    socket.close(None).await.unwrap();
    expect_stale(&mut rx, &[10]).await;

    let mut backoffs = Vec::new();
    for line in logs.events("feed_reconnecting") {
        backoffs.push((line.number("attempt"), line.number("delay_ms")));
    }
    assert_eq!(backoffs, [(1.0, 500.0), (2.0, 1_000.0), (1.0, 500.0)]);
    assert_eq!(logs.events("connection_failed").len(), 2);

    stop(&cancel, tasks).await;
}

#[test]
fn reconnect_delay_doubles_from_500_ms_to_30_s() {
    let expected = [
        (1, 500),
        (2, 1_000),
        (3, 2_000),
        (4, 4_000),
        (5, 8_000),
        (6, 16_000),
        (7, 30_000),
        (8, 30_000),
        (1_000, 30_000),
        (u32::MAX, 30_000),
    ];
    for (attempt, millis) in expected {
        assert_eq!(reconnect_delay(attempt, Duration::ZERO), Duration::from_millis(millis), "attempt {attempt}");
    }
}

#[test]
fn reconnect_delay_adds_at_most_the_jitter() {
    let jitter = Duration::from_millis(250);
    let mut jittered = false;
    for _ in 0..1_000 {
        let delay = reconnect_delay(1, jitter);
        assert!(delay >= Duration::from_millis(500) && delay <= Duration::from_millis(750), "{delay:?}");
        jittered |= delay > Duration::from_millis(500);
    }
    assert!(jittered, "a thousand delays carried no jitter");
}

#[tokio::test]
async fn a_cancel_sends_a_close_frame_ends_the_task_and_sends_no_stale() {
    let (listener, url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let tasks = start(&url, quiet(), &["AAA"], &tx, &cancel);
    let mut socket = accept(&listener).await;
    read_texts(&mut socket, 1).await;
    send(&mut socket, &[snapshot("AAA", &[(100.0, 1.0)], &[(101.0, 1.0)])]).await;
    next_book(&mut rx).await;

    cancel.cancel();
    match timeout(WAIT, socket.next()).await.expect("the feed sent no close frame") {
        Some(Ok(Message::Close(_))) => {}
        other => panic!("expected a close frame, got {other:?}"),
    }
    for task in tasks {
        timeout(WAIT, task).await.expect("a task outlived its cancel").unwrap();
    }

    drop(tx);
    if let Some(event) = rx.recv().await {
        panic!("a cancelled feed sent {event:?}");
    }
}

#[tokio::test]
async fn a_cancel_during_the_stagger_ends_the_task_before_it_connects() {
    let (listener, url) = listen().await;
    let (tx, _rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let venue = TestVenue {
        settings: FeedSettings {
            connect_stagger: Duration::from_secs(10),
            ..quiet()
        },
        plans: vec![endpoint("testvenue#0", NOWHERE, &["AAA"]), endpoint("testvenue#1", &url, &["BBB"])],
    };
    let tasks = spawn_feed(Arc::new(venue), VENUE, VENUE_INDEX, &tracked(&["AAA", "BBB"]), &tx, &cancel);

    stop(&cancel, tasks).await;
    assert!(
        timeout(Duration::from_millis(100), listener.accept()).await.is_err(),
        "the staggered plan connected after its cancel"
    );
}

#[tokio::test]
async fn an_engine_that_is_gone_ends_the_task_on_the_next_book() {
    let (listener, url) = listen().await;
    let (tx, rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let tasks = start(&url, quiet(), &["AAA"], &tx, &cancel);
    let mut socket = accept(&listener).await;
    read_texts(&mut socket, 1).await;

    drop(rx);
    send(&mut socket, &[snapshot("AAA", &[(100.0, 1.0)], &[(101.0, 1.0)])]).await;

    for task in tasks {
        timeout(WAIT, task).await.expect("the task outlived its engine").unwrap();
    }
}

#[tokio::test]
async fn an_engine_that_is_gone_ends_the_task_instead_of_reconnecting_forever() {
    let (tx, rx) = mpsc::channel(8);
    drop(rx);
    let cancel = CancellationToken::new();
    // Every connect is refused, so the task would back off and retry for as long as it runs.
    let tasks = start(NOWHERE, quiet(), &["AAA"], &tx, &cancel);

    for task in tasks {
        timeout(WAIT, task).await.expect("the task outlived its engine").unwrap();
    }
}

#[tokio::test]
async fn spawn_feed_refuses_a_market_planned_twice_and_a_planned_market_that_is_not_tracked() {
    let (logs, _guard) = capture();
    let (first_listener, first_url) = listen().await;
    let (second_listener, second_url) = listen().await;
    let (tx, mut rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    // Nobody tracks XXX, both plans hold BBB, and no plan holds DDD.
    let venue = TestVenue {
        settings: quiet(),
        plans: vec![
            endpoint("testvenue#0", &first_url, &["XXX", "AAA", "BBB"]),
            endpoint("testvenue#1", &second_url, &["BBB", "CCC"]),
        ],
    };
    let markets = tracked(&["AAA", "BBB", "CCC", "DDD"]);
    let tasks = spawn_feed(Arc::new(venue), VENUE, VENUE_INDEX, &markets, &tx, &cancel);
    assert_eq!(tasks.len(), 2);

    // Each socket subscribes only what it kept, and each kept market still writes its own slot.
    let mut first = accept(&first_listener).await;
    assert_eq!(read_texts(&mut first, 2).await, ["AAA", "BBB"]);
    let mut second = accept(&second_listener).await;
    assert_eq!(read_text(&mut second).await, "CCC");
    send(&mut first, &[snapshot("BBB", &[(100.0, 1.0)], &[(101.0, 1.0)])]).await;
    assert_eq!(next_book(&mut rx).await.slot.cluster, 11);
    send(&mut second, &[snapshot("CCC", &[(100.0, 1.0)], &[(101.0, 1.0)])]).await;
    assert_eq!(next_book(&mut rx).await.slot.cluster, 12);

    let refused = logs.events("plan_market_refused");
    assert_eq!(refused.len(), 2);
    assert_eq!(refused[0].text("connection"), "testvenue#0");
    assert_eq!(refused[0].text("market"), "XXX");
    assert_eq!(refused[1].text("connection"), "testvenue#1");
    assert_eq!(refused[1].text("market"), "BBB");
    for line in &refused {
        assert_eq!(line.level, Level::ERROR);
    }

    let unplanned = logs.events("markets_unplanned");
    assert_eq!(unplanned.len(), 1);
    assert_eq!(unplanned[0].level, Level::ERROR);
    assert_eq!(unplanned[0].text("venue"), VENUE);
    assert_eq!(unplanned[0].number("unplanned"), 1.0);
    assert_eq!(unplanned[0].text("sample"), r#"["DDD"]"#);

    let started = logs.events("feed_started");
    assert_eq!(started.len(), 1);
    assert_eq!(started[0].number("connections"), 2.0);
    assert_eq!(started[0].number("markets"), 3.0);

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn spawn_feed_staggers_first_opens_by_connect_stagger() {
    let stagger = Duration::from_millis(300);
    let raw_market_ids = ["AAA", "BBB", "CCC"];
    let mut listeners = Vec::new();
    let mut plans = Vec::new();
    for (i, raw_market_id) in raw_market_ids.iter().enumerate() {
        let (listener, url) = listen().await;
        plans.push(endpoint(&format!("testvenue#{i}"), &url, &[raw_market_id]));
        listeners.push(listener);
    }
    let venue = TestVenue {
        settings: FeedSettings {
            connect_stagger: stagger,
            ..quiet()
        },
        plans,
    };
    let (tx, _rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let started = Instant::now();
    let tasks = spawn_feed(Arc::new(venue), VENUE, VENUE_INDEX, &tracked(&raw_market_ids), &tx, &cancel);

    // Plan i waits i staggers and never less, so only the upper bound allows for a busy machine.
    let mut sockets = Vec::new();
    for (i, listener) in listeners.iter().enumerate() {
        sockets.push(accept(listener).await);
        let opened = started.elapsed();
        let due = stagger * i as u32;
        assert!(opened >= due && opened < due + Duration::from_millis(250), "plan {i} opened after {opened:?}");
    }

    stop(&cancel, tasks).await;
}

#[tokio::test]
async fn spawn_feed_spawns_nothing_for_an_empty_plan() {
    let (logs, _guard) = capture();
    let (tx, _rx) = mpsc::channel(8);
    let cancel = CancellationToken::new();
    let markets = tracked(&["AAA", "BBB"]);

    // A venue that plans no socket, then one whose plans hold no tracked market.
    let no_plans = TestVenue {
        settings: quiet(),
        plans: Vec::new(),
    };
    assert!(spawn_feed(Arc::new(no_plans), VENUE, VENUE_INDEX, &markets, &tx, &cancel).is_empty());
    let empty_plans = TestVenue {
        settings: quiet(),
        plans: vec![endpoint("testvenue#0", NOWHERE, &[]), endpoint("testvenue#1", NOWHERE, &["XXX"])],
    };
    assert!(spawn_feed(Arc::new(empty_plans), VENUE, VENUE_INDEX, &markets, &tx, &cancel).is_empty());

    let aborted = logs.events("feed_start_aborted");
    assert_eq!(aborted.len(), 2);
    for line in &aborted {
        assert_eq!(line.level, Level::ERROR);
        assert_eq!(line.text("venue"), VENUE);
    }
    let unplanned = logs.events("markets_unplanned");
    assert_eq!(unplanned.len(), 2);
    for line in &unplanned {
        assert_eq!(line.number("unplanned"), 2.0);
        assert_eq!(line.text("sample"), r#"["AAA", "BBB"]"#);
    }
    assert!(logs.events("feed_started").is_empty());
}

#[test]
fn feed_settings_new_fills_the_venue_feed_defaults() {
    let settings = FeedSettings::new(Duration::from_secs(30));

    assert_eq!(settings.max_silence, Duration::from_secs(30));
    assert_eq!(settings.ping_every, None);
    assert_eq!(settings.connect_stagger, Duration::ZERO);
    assert_eq!(settings.reconnect_jitter, Duration::from_millis(250));
    assert_eq!(settings.subscribe_gap, Duration::ZERO);
    assert_eq!(settings.first_book_wait, Duration::from_secs(10));
    assert_eq!(settings.retire_after, None);
    assert_eq!(settings.retire_jitter, Duration::ZERO);
}
