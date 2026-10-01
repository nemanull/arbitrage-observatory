// Ports no TS spec, since the Nest server had no end to end test.
// Two fake venues on local sockets drive the real engine thread through the cases of plan task 12.

use crate::clock::now_ms;
use crate::engine::cluster::{AnchorReading, BookLevel, ClusterIndex, Market, Venue};
use crate::engine::engine::{
    BookUpdate, ENGINE_QUEUE_CAPACITY, Engine, EngineEvent, Levels, Slot, run_engine,
};
use crate::engine::opportunity::opportunity_lifecycle::{
    MAX_OPPORTUNITY_AGE_MS, OpportunityLifecycle, get_route_key,
};
use crate::engine::opportunity::opportunity_manager::{MIN_CROSS_AGE_MS, OpportunityManager};
use crate::engine::opportunity::{CloseReason, Opportunity};
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings, spawn_feed};
use crate::test_log::{Logged, Logs, capture};
use futures_util::{SinkExt, StreamExt};
use serde::Deserialize;
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::sync::mpsc::{self, Receiver, Sender, UnboundedReceiver, UnboundedSender};
use tokio::sync::oneshot;
use tokio::task::JoinHandle;
use tokio::time::{sleep, timeout};
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;
use tracing::subscriber::DefaultGuard;
use tracing_subscriber::layer::SubscriberExt;

// A working pipeline takes milliseconds for any of these waits, so this only bounds a broken one.
const WAIT: Duration = Duration::from_secs(3);

// The top level of each side, as (price, size).
#[derive(Clone, Copy)]
struct Book {
    bid: (f64, f64),
    ask: (f64, f64),
}

// alpha asks 100 for 50 coins.
const ALPHA_BOOK: Book = Book {
    bid: (99.9, 10.0),
    ask: (100.0, 50.0),
};

// beta's bid crosses alpha's ask by about 8,500 ppm after fees, then by about 9,000.
// Its 30 coins against alpha's 50 make a region of about 3,000 quote units, well over MIN_EDGE_NOTIONAL.
const BETA_FIRST_BOOK: Book = Book {
    bid: (100.95, 30.0),
    ask: (101.5, 10.0),
};
const BETA_SECOND_BOOK: Book = Book {
    bid: (101.0, 30.0),
    ask: (101.5, 10.0),
};

// One frame is one market's whole book: {"m":"BTCUSDT","b":[[99.9,10]],"a":[[100,50]]}.
#[derive(Deserialize)]
struct Snapshot {
    m: String,
    b: Vec<(f64, f64)>,
    a: Vec<(f64, f64)>,
}

struct TestVenue {
    id: &'static str,
    url: String,
}

impl BookVenue for TestVenue {
    type State = ();

    fn settings(&self) -> FeedSettings {
        FeedSettings::new(Duration::ZERO) // silence never ends a socket here, only the case does
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        vec![EndpointPlan {
            id: format!("{}#0", self.id),
            url: self.url.clone(),
            markets: markets.to_vec(),
        }]
    }

    fn subscribe_frames(&self, markets: &[Market], _state: &mut ()) -> Vec<Message> {
        let mut ids = Vec::new();
        for market in markets {
            ids.push(market.raw_market_id.as_str());
        }
        vec![Message::text(ids.join(","))]
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<()>) -> anyhow::Result<()> {
        let snapshot: Snapshot = serde_json::from_slice(frame)?;
        let Some(position) = conn.position(&snapshot.m) else {
            return Ok(());
        };
        conn.reset_book(position, &levels(&snapshot.b), &levels(&snapshot.a));
        Ok(())
    }
}

fn levels(pairs: &[(f64, f64)]) -> Vec<BookLevel> {
    let mut levels = Vec::with_capacity(pairs.len());
    for &(price, size) in pairs {
        levels.push(BookLevel { price, size });
    }
    levels
}

enum ServerStep {
    Send(String),
    Drop, // ends the connection without a close frame, as a dead network does
}

// One venue's socket on a local port, which accepts one connection and sends what the case hands it.
struct FakeServer {
    url: String,
    steps: UnboundedSender<ServerStep>,
}

impl FakeServer {
    // Also returns the subscription the feed sends first.
    async fn start() -> (Self, oneshot::Receiver<String>) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}", listener.local_addr().unwrap());
        let (steps, steps_rx) = mpsc::unbounded_channel();
        let (subscribed_tx, subscribed) = oneshot::channel();
        tokio::spawn(serve(listener, steps_rx, subscribed_tx));
        (Self { url, steps }, subscribed)
    }

    fn send_book(&self, market: &str, book: Book) {
        let frame = serde_json::json!({
            "m": market,
            "b": [[book.bid.0, book.bid.1]],
            "a": [[book.ask.0, book.ask.1]],
        });
        self.steps
            .send(ServerStep::Send(frame.to_string()))
            .unwrap();
    }

    fn drop_connection(&self) {
        self.steps.send(ServerStep::Drop).unwrap();
    }
}

async fn serve(
    listener: TcpListener,
    mut steps: UnboundedReceiver<ServerStep>,
    subscribed: oneshot::Sender<String>,
) {
    let (stream, _) = listener.accept().await.unwrap();
    let mut ws = tokio_tungstenite::accept_async(stream).await.unwrap();
    let subscription = ws.next().await.unwrap().unwrap();
    let _ = subscribed.send(subscription.into_text().unwrap().to_string());

    loop {
        tokio::select! {
            step = steps.recv() => match step {
                Some(ServerStep::Send(frame)) => ws.send(Message::text(frame)).await.unwrap(),
                Some(ServerStep::Drop) => break,
                None => return,
            },
            // After its subscription a feed sends nothing but the close frame of a stop.
            _ = ws.next() => return,
        }
    }

    drop(ws);
    // Holds the port, so the feed's reconnect cannot reach a server that a later case bound to it.
    while steps.recv().await.is_some() {}
}

// orchestrator::tracked_venues for one venue: its index, and its markets that sit in a cluster with their slots.
fn track(index: &ClusterIndex, venue: &Venue) -> (usize, Vec<TrackedMarket>) {
    let venue_index = index.venue_index_map.get(&venue.id).unwrap();
    let mut markets = Vec::new();

    for market in &venue.markets {
        if let Some(cluster) = index
            .cluster_by_raw_market_id
            .get(&venue.id, &market.raw_market_id)
        {
            markets.push(TrackedMarket {
                market: market.clone(),
                slot: Slot {
                    cluster,
                    venue: venue_index,
                },
            });
        }
    }

    (venue_index, markets)
}

// A venue of linear USDT perps, each listed as (raw id, base).
fn venue(id: &str, listings: &[(&str, &str)]) -> Venue {
    let mut markets = Vec::new();
    for &(raw_market_id, base) in listings {
        markets.push(Market {
            venue_id: id.to_string(),
            raw_market_id: raw_market_id.to_string(),
            base: base.to_string(),
            quote: "USDT".to_string(),
            taker_ppm: 500,
            linear: true,
            contract_size: 1.0,
        });
    }

    Venue {
        id: id.to_string(),
        name: id.to_string(),
        markets,
    }
}

// The real pipeline minus the venue registry, built as orchestrator::start builds it.
struct Pipeline {
    alpha: FakeServer,
    beta: FakeServer,
    alpha_slot: Slot,
    beta_slot: Slot,
    cancel: CancellationToken,
    feeds: Vec<JoinHandle<()>>,
    engine_tx: Sender<EngineEvent>,
    engine_done: oneshot::Receiver<usize>, // the routes the engine's shutdown closed
    engine_thread: Option<std::thread::JoinHandle<()>>,
    closed: Receiver<Opportunity>, // the writer's end
    logs: Logs,
    _capture: DefaultGuard,
}

impl Pipeline {
    async fn start() -> Self {
        let (logs, capture) = capture();

        // alpha also lists ETHUSDT, which no other venue lists, so it sits in no cluster.
        let venues = [
            venue("alpha", &[("BTCUSDT", "BTC"), ("ETHUSDT", "ETH")]),
            venue("beta", &[("BTC-USDT", "BTC")]),
        ];
        let index = ClusterIndex::build_index(&venues).unwrap();
        let (alpha_index, alpha_markets) = track(&index, &venues[0]);
        let (beta_index, beta_markets) = track(&index, &venues[1]);

        let (closed_tx, closed) = mpsc::channel(64);
        let manager = OpportunityManager::new(OpportunityLifecycle::new(closed_tx));
        let engine = Engine::new(index.clusters, manager);
        let (engine_tx, engine_rx) = mpsc::channel(ENGINE_QUEUE_CAPACITY);
        let (done_tx, engine_done) = oneshot::channel();
        let engine_logs = logs.clone();
        let engine_thread = std::thread::Builder::new()
            .name("engine".to_string())
            .spawn(move || {
                // The engine logs on its own thread, so the case's capture goes there too.
                let _capture = tracing::subscriber::set_default(
                    tracing_subscriber::registry().with(engine_logs),
                );
                let closed = run_engine(engine, engine_rx);
                let _ = done_tx.send(closed);
            })
            .unwrap();

        let (alpha, alpha_subscribed) = FakeServer::start().await;
        let (beta, beta_subscribed) = FakeServer::start().await;
        let cancel = CancellationToken::new();
        let alpha_venue = TestVenue {
            id: "alpha",
            url: alpha.url.clone(),
        };
        let beta_venue = TestVenue {
            id: "beta",
            url: beta.url.clone(),
        };
        let mut feeds = spawn_feed(
            Arc::new(alpha_venue),
            "alpha",
            alpha_index,
            &alpha_markets,
            &engine_tx,
            &cancel,
        );
        feeds.extend(spawn_feed(
            Arc::new(beta_venue),
            "beta",
            beta_index,
            &beta_markets,
            &engine_tx,
            &cancel,
        ));

        // Only clustered markets are streamed, so ETHUSDT is never subscribed.
        let alpha_subscription = within("alpha's subscription", alpha_subscribed).await;
        let beta_subscription = within("beta's subscription", beta_subscribed).await;
        assert_eq!(alpha_subscription.unwrap(), "BTCUSDT");
        assert_eq!(beta_subscription.unwrap(), "BTC-USDT");

        Self {
            alpha,
            beta,
            alpha_slot: alpha_markets[0].slot,
            beta_slot: beta_markets[0].slot,
            cancel,
            feeds,
            engine_tx,
            engine_done,
            engine_thread: Some(engine_thread),
            closed,
            logs,
            _capture: capture,
        }
    }

    async fn send(&self, event: EngineEvent) {
        let sent = within(
            "the engine channel to take an event",
            self.engine_tx.send(event),
        )
        .await;
        sent.expect("the engine is running");
    }

    // Both legs anchored at 100, so the anchors explain nothing and the fresh edge equals the raw one.
    // Two rounds per venue, because a slot's first poll reads as an unbounded move and refuses the route.
    async fn write_anchors(&self, ts: i64) {
        let reading = AnchorReading {
            index: 100.0,
            mark: 100.0,
            funding_rate: 0.0001,
            funding_interval_hours: 8.0,
            next_funding_at: 0,
            ts,
        };

        for _round in 0..2 {
            self.send(EngineEvent::Anchors(vec![(self.alpha_slot, reading)]))
                .await;
            self.send(EngineEvent::Anchors(vec![(self.beta_slot, reading)]))
                .await;
        }
    }

    // Opens beta-alpha through the two sockets and returns the engine's opportunity_opened line.
    async fn open_route(&self) -> Logged {
        self.alpha.send_book("BTCUSDT", ALPHA_BOOK);
        self.beta.send_book("BTC-USDT", BETA_FIRST_BOOK);
        // The cross opens on a tick MIN_CROSS_AGE_MS after the one that first showed it, by the frames' arrival stamps.
        sleep(Duration::from_millis(3 * MIN_CROSS_AGE_MS as u64)).await;
        self.beta.send_book("BTC-USDT", BETA_SECOND_BOOK);

        wait_for(&self.logs, "opportunity_opened").await
    }

    // A book as a feed sends it, but straight onto the engine channel with the arrival stamp the case picks.
    async fn send_book(&self, slot: Slot, book: Book, recv_ts: i64) {
        let (bid, bid_size) = book.bid;
        let (ask, ask_size) = book.ask;
        let update = BookUpdate {
            slot,
            bids: Levels::from_slice(&[BookLevel {
                price: bid,
                size: bid_size,
            }]),
            asks: Levels::from_slice(&[BookLevel {
                price: ask,
                size: ask_size,
            }]),
            recv_ts,
        };
        self.send(EngineEvent::Book(update)).await;
    }

    // The orchestrator's stop order, so a cancelled feed sends no Stale and every open route closes as shutdown.
    // Returns the number of routes the engine's shutdown closed.
    async fn stop(&mut self) -> usize {
        self.cancel.cancel();
        for feed in self.feeds.drain(..) {
            within("a feed to stop", feed)
                .await
                .expect("the feed task does not panic");
        }

        self.send(EngineEvent::Shutdown).await;
        let done = within("the engine to stop", &mut self.engine_done).await;
        let closed = done.expect("the engine thread reports its end");

        let thread = self.engine_thread.take().unwrap();
        thread.join().expect("the engine thread exits cleanly");
        closed
    }

    // Every row still in the writer's channel, read to its end, which the engine's shutdown causes by dropping the sender.
    async fn closed_rows(&mut self) -> Vec<Opportunity> {
        let mut rows = Vec::new();
        while let Some(row) = within("the closed rows channel to end", self.closed.recv()).await {
            rows.push(row);
        }
        rows
    }
}

// Bounds a wait, so a broken pipeline fails the case instead of hanging it.
async fn within<T>(what: &str, future: impl Future<Output = T>) -> T {
    match timeout(WAIT, future).await {
        Ok(output) => output,
        Err(_) => panic!("waited longer than {WAIT:?} for {what}"),
    }
}

// The first line of `event`, which the engine thread may log a moment after the step that causes it.
async fn wait_for(logs: &Logs, event: &str) -> Logged {
    let poll = async {
        loop {
            if let Some(line) = logs.events(event).into_iter().next() {
                return line;
            }
            sleep(Duration::from_millis(5)).await;
        }
    };

    within(&format!("{event} to be logged"), poll).await
}

fn route(row: &Opportunity) -> String {
    get_route_key(&row.highest_bid_market, &row.lowest_ask_market)
}

#[tokio::test]
async fn a_cross_opens_a_route_and_a_stop_closes_it_as_shutdown() {
    let mut pipeline = Pipeline::start().await;
    pipeline.write_anchors(now_ms()).await;

    let opened = pipeline.open_route().await;
    assert_eq!(opened.text("route"), "beta-alpha");

    assert_eq!(pipeline.stop().await, 1);
    let rows = pipeline.closed_rows().await;

    assert_eq!(rows.len(), 1, "expected exactly one closed opportunity");
    let row = &rows[0];
    assert_eq!(route(row), "beta-alpha");
    assert_eq!(row.close_reason, Some(CloseReason::Shutdown));
    assert!(
        row.net_ppm_at_open > 5_000.0,
        "{} ppm at open",
        row.net_ppm_at_open
    );
    assert_eq!(
        row.anchor_at_open.sell.touch, 101.0,
        "opened on beta's second book"
    );
    let edge = row.edge_at_open.expect("both legs held depth at the open");
    assert_eq!(edge.size, 30.0); // beta's whole bid, under alpha's 50 coins at the ask
    assert!(
        edge.notional > 1_000.0,
        "{} quote units at open",
        edge.notional
    );

    let closed = pipeline.logs.events("opportunity_closed");
    assert_eq!(closed.len(), 1);
    assert_eq!(closed[0].text("reason"), "shutdown");
    // A cancelled feed sends no Stale, so nothing closed as feed_down ahead of the shutdown.
    let feed_down = pipeline.logs.events("feed_down_closed_opportunities");
    assert!(feed_down.is_empty());
}

#[tokio::test]
async fn a_socket_that_dies_closes_its_routes_as_feed_down() {
    let mut pipeline = Pipeline::start().await;
    pipeline.write_anchors(now_ms()).await;
    pipeline.open_route().await;

    pipeline.alpha.drop_connection();
    let row = within("the feed_down row", pipeline.closed.recv()).await;
    let row = row.expect("the engine is running");

    assert_eq!(route(&row), "beta-alpha");
    assert_eq!(row.close_reason, Some(CloseReason::FeedDown));
    let down = wait_for(&pipeline.logs, "feed_down_closed_opportunities").await;
    assert_eq!(down.text("connection"), "alpha#0");
    assert_eq!(down.number("markets"), 1.0);
    assert_eq!(down.number("closed"), 1.0);

    assert_eq!(pipeline.stop().await, 0);
    assert!(pipeline.closed_rows().await.is_empty());
}

#[tokio::test]
async fn a_sweep_with_nothing_open_closes_nothing() {
    let mut pipeline = Pipeline::start().await;

    pipeline.send(EngineEvent::Sweep).await;

    // The engine reads its channel in order, so the shutdown is handled after the sweep.
    assert_eq!(pipeline.stop().await, 0);
    assert!(pipeline.closed_rows().await.is_empty());
    let sweeps = pipeline.logs.events("sweep_closed_opportunities");
    assert!(sweeps.is_empty());
}

#[tokio::test]
async fn the_age_cap_closes_a_route_through_a_sweep() {
    let mut pipeline = Pipeline::start().await;
    // A feed stamps every frame with the wall clock, so books older than the cap go straight onto the engine channel.
    let first_seen = now_ms() - MAX_OPPORTUNITY_AGE_MS - 1_000;
    let opened_at = first_seen + MIN_CROSS_AGE_MS;
    pipeline.write_anchors(first_seen).await;
    pipeline
        .send_book(pipeline.alpha_slot, ALPHA_BOOK, first_seen)
        .await;
    pipeline
        .send_book(pipeline.beta_slot, BETA_FIRST_BOOK, first_seen)
        .await;
    pipeline
        .send_book(pipeline.beta_slot, BETA_SECOND_BOOK, opened_at)
        .await;
    wait_for(&pipeline.logs, "opportunity_opened").await;

    pipeline.send(EngineEvent::Sweep).await;
    let row = within("the age_cap row", pipeline.closed.recv()).await;
    let row = row.expect("the engine is running");

    assert_eq!(route(&row), "beta-alpha");
    assert_eq!(row.close_reason, Some(CloseReason::AgeCap));
    assert_eq!(row.opened_at, opened_at);
    let closed_at = row.closed_at.expect("a closed row carries its close time");
    assert!(
        closed_at - opened_at >= MAX_OPPORTUNITY_AGE_MS,
        "closed {} ms after the open",
        closed_at - opened_at
    );
    let sweep = wait_for(&pipeline.logs, "sweep_closed_opportunities").await;
    assert_eq!(sweep.number("closed"), 1.0);

    assert_eq!(pipeline.stop().await, 0);
    assert!(pipeline.closed_rows().await.is_empty());
}
