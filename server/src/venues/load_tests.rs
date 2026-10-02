// The saturation replay of docs/plans/2026-10-01-rust-docs-and-load-replay-design.md, which runs only on request.
// It records the live venues, then replays the recording as copies of them through the real feeds and engine:
// cargo test --release load_replay -- --ignored --nocapture
// LIVE_VENUES, REPLAY_RECORD_SECONDS, REPLAY_COPIES, REPLAY_SPEEDS, REPLAY_RATES and REPLAY_THREADS override the defaults below.

use super::binance::{self, Binance};
use super::bitget::{self, Bitget};
use super::bitstamp::{self, Bitstamp};
use super::bybit::{self, Bybit};
use super::coinbase::{self, Coinbase};
use super::gate::{self, Gate};
use super::gemini::{self, Gemini};
use super::krakenfutures::{self, KrakenFutures};
use super::load_venue;
use super::mexc::{self, Mexc};
use super::okx::{self, Okx};
use super::testing::tracked;
use crate::engine::cluster::{ClusterIndex, Market, Venue};
use crate::engine::engine::{ENGINE_QUEUE_CAPACITY, Engine, EngineEvent, Slot, run_engine};
use crate::engine::opportunity::opportunity_lifecycle::OpportunityLifecycle;
use crate::engine::opportunity::opportunity_manager::OpportunityManager;
use crate::engine::opportunity::opportunity_writer::QUEUE_CAPACITY;
use crate::feeds::TrackedMarket;
use crate::feeds::venue_feed::{BookVenue, Connection, EndpointPlan, FeedSettings, spawn_feed};
use crate::test_log::Logged;
use futures_util::future::join_all;
use futures_util::{SinkExt, StreamExt};
use std::collections::{BTreeMap, HashMap};
use std::sync::atomic::AtomicU64;
use std::sync::atomic::Ordering::Relaxed;
use std::sync::{Arc, Mutex};
use std::time::Duration;
use tokio::net::TcpListener;
use tokio::runtime::Runtime;
use tokio::sync::mpsc::{self, Sender};
use tokio::task::JoinHandle;
use tokio::time::{Instant, interval, sleep_until};
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::Message;
use tokio_util::sync::CancellationToken;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::layer::{Context, SubscriberExt};
use tracing_subscriber::util::SubscriberInitExt;
use tracing_subscriber::{EnvFilter, Layer, fmt};

// Every adapter but coinbase, whose perpetuals Coinbase International has shown as paused since 2026-10-01.
const NINE: &[&str] = &["binance", "bybit", "okx", "krakenfutures", "gate", "bitget", "mexc", "bitstamp", "gemini"];

const RECORD_SECONDS: u64 = 60;
const COPIES: usize = 7;
const SPEEDS: &str = "1,2,4";
const REPLAY_THREADS: usize = 8;
const COPY_STAGGER: Duration = Duration::from_secs(1);
const SAMPLE_EVERY: Duration = Duration::from_millis(10);
const SUMMARY_WAIT: Duration = Duration::from_secs(150); // an engine logs a summary every 60 s, so this only bounds a dead one
const USER_HZ: f64 = 100.0; // the unit of CPU time in /proc on Linux

// The verdict of design decision 10.
const MIN_DELIVERED: f64 = 0.99;
const MAX_LATE_MS: f64 = 100.0;
const MIN_BOOKS_PER_FRAME: f64 = 0.98; // of the slowest stage's
const MAX_QUEUE_LAG_MS: f64 = 100.0;

struct Frame {
    at: Duration, // after the first frame of its session
    message: Message,
}

#[derive(Default)]
struct Recorder {
    sessions: Mutex<HashMap<String, u32>>, // connections opened per plan id
    frames: Mutex<HashMap<String, (std::time::Instant, Vec<Frame>)>>,
}

impl Recorder {
    // Only a plan's first session is kept, so a replayed loop is one unbroken session.
    fn keep(&self, plan: &str, frame: &[u8]) {
        if self.sessions.lock().unwrap().get(plan) != Some(&1) {
            return;
        }

        let message = match std::str::from_utf8(frame) {
            Ok(text) => Message::text(text.to_string()),
            Err(_) => Message::binary(frame.to_vec()),
        };
        let now = std::time::Instant::now();
        let mut frames = self.frames.lock().unwrap();
        let (first, kept) = frames.entry(plan.to_string()).or_insert_with(|| (now, Vec::new()));
        kept.push(Frame { at: now - *first, message });
    }
}

#[derive(Default)]
struct Counters {
    frames: AtomicU64,
    bytes: AtomicU64,
}

enum Mode {
    Record(Arc<Recorder>),
    Replay {
        copy: usize,
        urls: HashMap<String, String>, // plan id to its replay server
        handled: Arc<Counters>,
    },
}

// A venue whose feed records or replays, and which otherwise runs its adapter unchanged.
struct Tap<V> {
    inner: V,
    mode: Mode,
    plan_of: HashMap<String, String>, // raw market id to plan id
}

impl<V: BookVenue> BookVenue for Tap<V> {
    type State = V::State;

    fn settings(&self) -> FeedSettings {
        self.inner.settings()
    }

    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan> {
        let plans = self.inner.plan(markets);
        let Mode::Replay { copy, urls, .. } = &self.mode else {
            return plans;
        };

        // A plan that recorded nothing has no server, and spawn_feed logs its markets as unplanned.
        let mut local = Vec::with_capacity(plans.len());
        for plan in plans {
            if let Some(url) = urls.get(&plan.id) {
                local.push(EndpointPlan {
                    id: format!("{}~{copy}", plan.id),
                    url: url.clone(),
                    markets: plan.markets,
                });
            }
        }
        local
    }

    fn subscribe_frames(&self, markets: &[Market], state: &mut V::State) -> Vec<Message> {
        if let Mode::Record(recorder) = &self.mode
            && let Some(market) = markets.first()
            && let Some(plan) = self.plan_of.get(&market.raw_market_id)
        {
            *recorder.sessions.lock().unwrap().entry(plan.clone()).or_default() += 1;
        }
        self.inner.subscribe_frames(markets, state)
    }

    fn ping(&self, state: &mut V::State) -> Message {
        self.inner.ping(state)
    }

    fn handle(&self, frame: &[u8], conn: &mut Connection<V::State>) -> anyhow::Result<()> {
        match &self.mode {
            Mode::Record(recorder) => recorder.keep(conn.id(), frame),
            Mode::Replay { handled, .. } => {
                handled.frames.fetch_add(1, Relaxed);
                handled.bytes.fetch_add(frame.len() as u64, Relaxed);
            }
        }
        self.inner.handle(frame, conn)
    }
}

fn spawn_tap<V: BookVenue>(
    inner: V,
    mode: Mode,
    venue_id: &str,
    venue_index: usize,
    markets: &[TrackedMarket],
    tx: &Sender<EngineEvent>,
    cancel: &CancellationToken,
) -> Vec<JoinHandle<()>> {
    let mut plain = Vec::with_capacity(markets.len());
    for tracked in markets {
        plain.push(tracked.market.clone());
    }

    let mut plan_of = HashMap::new();
    for plan in inner.plan(&plain) {
        for market in plan.markets {
            plan_of.insert(market.raw_market_id, plan.id.clone());
        }
    }

    let tap = Tap { inner, mode, plan_of };
    spawn_feed(Arc::new(tap), venue_id, venue_index, markets, tx, cancel)
}

// The adapter behind an id, built as start_venue builds it.
fn spawn_venue(
    adapter: &str,
    mode: Mode,
    venue_id: &str,
    venue_index: usize,
    markets: &[TrackedMarket],
    tx: &Sender<EngineEvent>,
    cancel: &CancellationToken,
) -> Vec<JoinHandle<()>> {
    match adapter {
        binance::ID => spawn_tap(Binance::new(markets), mode, venue_id, venue_index, markets, tx, cancel),
        bybit::ID => spawn_tap(Bybit::new(markets), mode, venue_id, venue_index, markets, tx, cancel),
        okx::ID => spawn_tap(Okx::new(markets), mode, venue_id, venue_index, markets, tx, cancel),
        krakenfutures::ID => spawn_tap(KrakenFutures::new(), mode, venue_id, venue_index, markets, tx, cancel),
        coinbase::ID => spawn_tap(Coinbase::new(), mode, venue_id, venue_index, markets, tx, cancel),
        gate::ID => spawn_tap(Gate::new(), mode, venue_id, venue_index, markets, tx, cancel),
        bitget::ID => spawn_tap(Bitget::new(markets), mode, venue_id, venue_index, markets, tx, cancel),
        mexc::ID => spawn_tap(Mexc::new(), mode, venue_id, venue_index, markets, tx, cancel),
        bitstamp::ID => spawn_tap(Bitstamp::new(markets), mode, venue_id, venue_index, markets, tx, cancel),
        gemini::ID => spawn_tap(Gemini::new(markets), mode, venue_id, venue_index, markets, tx, cancel),
        _ => panic!("{adapter} has no adapter"),
    }
}

#[derive(Default)]
struct ServerStats {
    frames: AtomicU64,
    bytes: AtomicU64,
    loops: AtomicU64,
    late_max_us: AtomicU64, // how far behind its schedule the server fell
}

// One recorded connection, sent at `speed` times its recorded pace and then closed, for as many connections as the client opens.
async fn serve(
    listener: TcpListener,
    frames: Arc<Vec<Frame>>,
    speed: f64,
    stats: Arc<ServerStats>,
    cancel: CancellationToken,
) {
    loop {
        let stream = tokio::select! {
            _ = cancel.cancelled() => return,
            accepted = listener.accept() => match accepted {
                Ok((stream, _)) => stream,
                Err(_) => continue,
            },
        };
        let _ = stream.set_nodelay(true);
        let Ok(ws) = accept_async(stream).await else {
            continue;
        };
        let (mut sink, mut source) = ws.split();
        // The client's subscribes and pings are read and dropped.
        let reader = tokio::spawn(async move { while let Some(Ok(_)) = source.next().await {} });
        stats.loops.fetch_add(1, Relaxed);

        let start = Instant::now();
        for frame in frames.iter() {
            let due = start + frame.at.div_f64(speed);
            let now = Instant::now();
            if due > now {
                if sink.flush().await.is_err() {
                    break;
                }
                tokio::select! {
                    _ = cancel.cancelled() => {
                        reader.abort();
                        return;
                    }
                    _ = sleep_until(due) => {}
                }
            } else {
                stats.late_max_us.fetch_max((now - due).as_micros() as u64, Relaxed);
            }

            let bytes = frame.message.len() as u64;
            if sink.feed(frame.message.clone()).await.is_err() {
                break;
            }
            stats.frames.fetch_add(1, Relaxed);
            stats.bytes.fetch_add(bytes, Relaxed);
        }

        let _ = sink.close().await;
        reader.abort();
    }
}

#[derive(Default)]
struct QueueStats {
    deepest: AtomicU64,
    full: AtomicU64, // samples that found the engine queue full
    samples: AtomicU64,
}

async fn sample_queue(tx: Sender<EngineEvent>, stats: Arc<QueueStats>, cancel: CancellationToken) {
    let mut timer = interval(SAMPLE_EVERY);
    loop {
        tokio::select! {
            _ = cancel.cancelled() => return,
            _ = timer.tick() => {}
        }
        let depth = ENGINE_QUEUE_CAPACITY - tx.capacity();
        stats.deepest.fetch_max(depth as u64, Relaxed);
        stats.samples.fetch_add(1, Relaxed);
        if depth == ENGINE_QUEUE_CAPACITY {
            stats.full.fetch_add(1, Relaxed);
        }
    }
}

// The orchestrator's sweeper, which also makes the engine log its summary.
async fn sweep(tx: Sender<EngineEvent>, cancel: CancellationToken) {
    let mut timer = interval(Duration::from_secs(1));
    timer.tick().await;
    loop {
        tokio::select! {
            _ = cancel.cancelled() => return,
            _ = timer.tick() => {}
        }
        tokio::select! {
            _ = cancel.cancelled() => return,
            sent = tx.send(EngineEvent::Sweep) => if sent.is_err() { return },
        }
    }
}

// Keeps the engine's summary lines, which carry the books it applied and its worst queue lag.
#[derive(Clone, Default)]
struct Summaries(Arc<Mutex<Vec<Logged>>>);

impl<S: tracing::Subscriber> Layer<S> for Summaries {
    fn on_event(&self, event: &tracing::Event<'_>, _context: Context<'_, S>) {
        if !event.metadata().target().ends_with("engine::engine") {
            return;
        }

        let mut line = Logged {
            level: *event.metadata().level(),
            numbers: HashMap::new(),
            texts: HashMap::new(),
        };
        event.record(&mut line);
        if line.texts.get("event").is_some_and(|name| name == "engine_summary") {
            self.0.lock().unwrap().push(line);
        }
    }
}

impl Summaries {
    fn count(&self) -> usize {
        self.0.lock().unwrap().len()
    }

    fn get(&self, i: usize) -> Logged {
        self.0.lock().unwrap()[i].clone()
    }
}

// CPU time in /proc ticks, summed by thread name.
fn cpu_ticks() -> HashMap<String, u64> {
    let mut ticks = HashMap::new();
    for entry in std::fs::read_dir("/proc/self/task").unwrap() {
        let Ok(stat) = std::fs::read_to_string(entry.unwrap().path().join("stat")) else {
            continue;
        };
        let (Some(open), Some(close)) = (stat.find('('), stat.rfind(')')) else {
            continue;
        };

        // After the name the state comes first, so utime and stime are the 12th and 13th fields.
        let fields: Vec<&str> = stat[close + 2..].split(' ').collect();
        let used = fields[11].parse::<u64>().unwrap() + fields[12].parse::<u64>().unwrap();
        *ticks.entry(stat[open + 1..close].to_string()).or_default() += used;
    }
    ticks
}

fn rss_mb() -> f64 {
    let status = std::fs::read_to_string("/proc/self/status").unwrap();
    for line in status.lines() {
        if let Some(rest) = line.strip_prefix("VmRSS:") {
            let kb: f64 = rest.trim().trim_end_matches("kB").trim().parse().unwrap();
            return kb / 1024.0;
        }
    }
    0.0
}

fn env_or<T: std::str::FromStr>(name: &str, default: T) -> T {
    match std::env::var(name) {
        Ok(value) => value.trim().parse().unwrap_or_else(|_| panic!("{name} is not valid: {value}")),
        Err(_) => default,
    }
}

fn venue_ids() -> Vec<String> {
    match std::env::var("LIVE_VENUES") {
        Ok(list) if !list.trim().is_empty() => list.split(',').map(|id| id.trim().to_string()).collect(),
        _ => NINE.iter().map(|id| id.to_string()).collect(),
    }
}

// REPLAY_RATES names each stage by the frames a second all copies should send, and becomes a speed against the recording's own rate.
fn speeds(recorded_rate: f64, copies: usize) -> Vec<f64> {
    let (name, list) = match std::env::var("REPLAY_RATES") {
        Ok(list) => ("REPLAY_RATES", list),
        Err(_) => ("REPLAY_SPEEDS", std::env::var("REPLAY_SPEEDS").unwrap_or_else(|_| SPEEDS.to_string())),
    };

    let mut speeds = Vec::new();
    for value in list.split(',') {
        let value: f64 = value.trim().parse().unwrap_or_else(|_| panic!("{name} holds {value}"));
        assert!(value > 0.0, "{name} must hold positive numbers");
        if name == "REPLAY_RATES" {
            speeds.push(value / (recorded_rate * copies as f64));
        } else {
            speeds.push(value);
        }
    }
    speeds.sort_by(f64::total_cmp); // the slowest stage is the coalescing baseline
    speeds
}

// The frames a second one copy sends at speed 1.
fn recorded_rate(recordings: &HashMap<String, Arc<Vec<Frame>>>) -> f64 {
    let mut rate = 0.0;
    for frames in recordings.values() {
        if let Some(last) = frames.last() {
            rate += frames.len() as f64 / last.at.as_secs_f64().max(1.0);
        }
    }
    rate
}

// The markets a run would stream: those the real index puts in a cluster, as orchestrator::tracked_venues keeps them.
fn streamed(venues: &[Venue]) -> Vec<Venue> {
    let index = ClusterIndex::build_index(venues).unwrap();
    let mut streamed = Vec::with_capacity(venues.len());

    for venue in venues {
        let mut markets = Vec::new();
        for market in &venue.markets {
            if index.cluster_by_raw_market_id.get(&venue.id, &market.raw_market_id).is_some() {
                markets.push(market.clone());
            }
        }
        println!("REPLAY venue {} lists {} and streams {}", venue.id, venue.markets.len(), markets.len());
        streamed.push(Venue {
            id: venue.id.clone(),
            name: venue.name.clone(),
            markets,
        });
    }

    streamed
}

// Each plan id to the frames of its first session.
fn record(sut: &Runtime, venues: &[Venue], seconds: u64) -> HashMap<String, Arc<Vec<Frame>>> {
    let recorder = Arc::new(Recorder::default());
    let cancel = CancellationToken::new();
    let (tx, mut rx) = mpsc::channel(ENGINE_QUEUE_CAPACITY);

    let tasks = sut.block_on(async {
        tokio::spawn(async move { while rx.recv().await.is_some() {} });
        let mut tasks = Vec::new();
        for venue in venues {
            let markets = tracked(&venue.markets);
            tasks.extend(spawn_venue(&venue.id, Mode::Record(recorder.clone()), &venue.id, 0, &markets, &tx, &cancel));
        }
        tasks
    });
    drop(tx);

    std::thread::sleep(Duration::from_secs(seconds));
    cancel.cancel();
    sut.block_on(join_all(tasks));

    let sessions = recorder.sessions.lock().unwrap().clone();
    let frames = std::mem::take(&mut *recorder.frames.lock().unwrap());
    let mut recordings = HashMap::new();
    let mut by_venue: BTreeMap<String, (usize, usize, u64, f64, u32)> = BTreeMap::new(); // plans, frames, bytes, longest session, reopened plans

    for (plan, (_, kept)) in frames {
        let venue = plan.split('#').next().unwrap_or_default().to_string();
        let entry = by_venue.entry(venue).or_default();
        entry.0 += 1;
        entry.1 += kept.len();
        for frame in &kept {
            entry.2 += frame.message.len() as u64;
        }
        if let Some(last) = kept.last() {
            entry.3 = entry.3.max(last.at.as_secs_f64());
        }
        if sessions.get(&plan).is_some_and(|&opened| opened > 1) {
            entry.4 += 1;
        }
        recordings.insert(plan, Arc::new(kept));
    }

    for (venue, (plans, frames, bytes, longest, reopened)) in &by_venue {
        println!(
            "REPLAY recorded {venue}: {plans} connections, {frames} frames, {:.1} MB, {:.0} frames/s over {longest:.1} s, {reopened} reopened",
            *bytes as f64 / 1e6,
            *frames as f64 / longest.max(1.0),
        );
    }

    recordings
}

struct VenueCopy {
    adapter: String,
    copy: usize,
    venue_id: String,
    venue_index: usize,
    markets: Vec<TrackedMarket>,
}

fn copy_venues(streamed: &[Venue], copies: usize) -> Vec<Venue> {
    let mut venues = Vec::with_capacity(streamed.len() * copies);
    for copy in 0..copies {
        for venue in streamed {
            let id = format!("{}~{copy}", venue.id);
            let mut markets = Vec::with_capacity(venue.markets.len());
            for market in &venue.markets {
                markets.push(Market {
                    venue_id: id.clone(),
                    ..market.clone()
                });
            }
            venues.push(Venue {
                id: id.clone(),
                name: id,
                markets,
            });
        }
    }
    venues
}

// Every copy with its slots, resolved once, since building the index again gives the same slots.
fn layout(venues: &[Venue]) -> Vec<VenueCopy> {
    let index = ClusterIndex::build_index(venues).unwrap();
    let mut layout = Vec::with_capacity(venues.len());

    for venue in venues {
        let venue_index = index.venue_index_map.get(&venue.id).unwrap();
        let mut markets = Vec::with_capacity(venue.markets.len());
        for market in &venue.markets {
            if let Some(cluster) = index.cluster_by_raw_market_id.get(&venue.id, &market.raw_market_id) {
                markets.push(TrackedMarket {
                    market: market.clone(),
                    slot: Slot {
                        cluster,
                        venue: venue_index,
                    },
                });
            }
        }

        let (adapter, copy) = venue.id.split_once('~').unwrap();
        layout.push(VenueCopy {
            adapter: adapter.to_string(),
            copy: copy.parse().unwrap(),
            venue_id: venue.id.clone(),
            venue_index,
            markets,
        });
    }

    layout
}

struct Snapshot {
    at: Instant,
    handled_frames: u64,
    handled_bytes: u64,
    sent_frames: u64,
    loops: u64,
    queue_full: u64,
    queue_samples: u64,
    rows: u64,
    cpu: HashMap<String, u64>,
}

struct Stage {
    speed: f64,
    connections: usize,
    seconds: f64,
    offered: f64,         // frames a second the servers sent
    delivered: f64,       // frames a second the feeds handled
    megabytes: f64,       // a second, as the feeds read them
    books: f64,           // a second, applied by the engine
    books_per_frame: f64,
    loops: u64,
    feed_cores: f64,
    engine_cores: f64,
    replay_cores: f64,
    deepest_queue: u64,
    queue_full: u64,
    queue_samples: u64,
    queue_lag_ms: f64, // the engine summary's max_queue_lag_ms
    late_ms: f64,      // how far the furthest behind server fell behind its schedule
    rows: u64,
    rss_mb: f64,
}

fn snapshot(
    handled: &[Arc<Counters>],
    servers: &[Arc<ServerStats>],
    queue: &QueueStats,
    rows: &AtomicU64,
) -> Snapshot {
    let mut snapshot = Snapshot {
        at: Instant::now(),
        handled_frames: 0,
        handled_bytes: 0,
        sent_frames: 0,
        loops: 0,
        queue_full: queue.full.load(Relaxed),
        queue_samples: queue.samples.load(Relaxed),
        rows: rows.load(Relaxed),
        cpu: cpu_ticks(),
    };
    for counters in handled {
        snapshot.handled_frames += counters.frames.load(Relaxed);
        snapshot.handled_bytes += counters.bytes.load(Relaxed);
    }
    for stats in servers {
        snapshot.sent_frames += stats.frames.load(Relaxed);
        snapshot.loops += stats.loops.load(Relaxed);
    }
    snapshot
}

fn cores(before: &Snapshot, after: &Snapshot, thread: &str, seconds: f64) -> f64 {
    let ticks = after.cpu.get(thread).copied().unwrap_or(0) - before.cpu.get(thread).copied().unwrap_or(0);
    ticks as f64 / USER_HZ / seconds
}

fn wait_for_summary(summaries: &Summaries, count: usize) {
    let deadline = std::time::Instant::now() + SUMMARY_WAIT;
    while summaries.count() < count {
        assert!(std::time::Instant::now() < deadline, "the engine logged no summary within {SUMMARY_WAIT:?}");
        std::thread::sleep(Duration::from_millis(20));
    }
}

fn run_stage(
    speed: f64,
    venues: &[Venue],
    layout: &[VenueCopy],
    recordings: &HashMap<String, Arc<Vec<Frame>>>,
    sut: &Runtime,
    replay: &Runtime,
    summaries: &Summaries,
) -> Stage {
    let stop_servers = CancellationToken::new();
    let stop_feeds = CancellationToken::new();
    let stop_helpers = CancellationToken::new();

    // One server per copy and recorded connection.
    let mut servers = Vec::new();
    let mut urls_by_venue: Vec<HashMap<String, String>> = Vec::with_capacity(layout.len());
    for venue in layout {
        let mut urls = HashMap::new();
        for (plan, frames) in recordings {
            if plan.split('#').next() != Some(venue.adapter.as_str()) {
                continue;
            }
            let listener = replay.block_on(TcpListener::bind("127.0.0.1:0")).unwrap();
            urls.insert(plan.clone(), format!("ws://{}", listener.local_addr().unwrap()));
            let stats = Arc::new(ServerStats::default());
            servers.push(stats.clone());
            replay.spawn(serve(listener, frames.clone(), speed, stats, stop_servers.clone()));
        }
        urls_by_venue.push(urls);
    }

    // A fresh engine, built as orchestrator::start builds it, with rows counted instead of written.
    let index = ClusterIndex::build_index(venues).unwrap();
    let (closed_tx, mut closed_rx) = mpsc::channel(QUEUE_CAPACITY);
    let rows = Arc::new(AtomicU64::new(0));
    let counted = rows.clone();
    replay.spawn(async move {
        while closed_rx.recv().await.is_some() {
            counted.fetch_add(1, Relaxed);
        }
    });
    let engine = Engine::new(index.clusters, OpportunityManager::new(OpportunityLifecycle::new(closed_tx)));
    let (tx, rx) = mpsc::channel(ENGINE_QUEUE_CAPACITY);
    let first_summary = summaries.count() + 1;
    let engine_thread = std::thread::Builder::new()
        .name("engine".to_string())
        .spawn(move || run_engine(engine, rx))
        .unwrap();

    let queue = Arc::new(QueueStats::default());
    replay.spawn(sweep(tx.clone(), stop_helpers.clone()));
    replay.spawn(sample_queue(tx.clone(), queue.clone(), stop_helpers.clone()));

    // Copy r starts r seconds after copy 0, decision 6.
    let started = std::time::Instant::now();
    let mut feeds = Vec::new();
    let mut handled = Vec::with_capacity(layout.len());
    let mut by_copy: BTreeMap<usize, Vec<usize>> = BTreeMap::new();
    for (i, venue) in layout.iter().enumerate() {
        by_copy.entry(venue.copy).or_default().push(i);
    }
    for (copy, members) in &by_copy {
        let due = started + COPY_STAGGER * *copy as u32;
        std::thread::sleep(due.saturating_duration_since(std::time::Instant::now()));
        for &i in members {
            let venue = &layout[i];
            let counters = Arc::new(Counters::default());
            handled.push(counters.clone());
            let mode = Mode::Replay {
                copy: venue.copy,
                urls: urls_by_venue[i].clone(),
                handled: counters,
            };
            let tasks = sut.block_on(async {
                spawn_venue(&venue.adapter, mode, &venue.venue_id, venue.venue_index, &venue.markets, &tx, &stop_feeds)
            });
            feeds.extend(tasks);
        }
    }

    // The first summary window holds the ramp, so the second one is measured.
    wait_for_summary(summaries, first_summary);
    for stats in &servers {
        stats.late_max_us.store(0, Relaxed);
    }
    queue.deepest.store(0, Relaxed);
    let before = snapshot(&handled, &servers, &queue, &rows);

    wait_for_summary(summaries, first_summary + 1);
    let after = snapshot(&handled, &servers, &queue, &rows);
    let summary = summaries.get(first_summary);
    let mut late_us = 0;
    for stats in &servers {
        late_us = late_us.max(stats.late_max_us.load(Relaxed));
    }
    let deepest_queue = queue.deepest.load(Relaxed);
    let rss_mb = rss_mb();

    stop_feeds.cancel();
    sut.block_on(join_all(feeds));
    stop_servers.cancel();
    stop_helpers.cancel();
    let _ = sut.block_on(tx.send(EngineEvent::Shutdown));
    drop(tx);
    engine_thread.join().unwrap();

    let seconds = (after.at - before.at).as_secs_f64();
    let delivered_frames = (after.handled_frames - before.handled_frames) as f64;
    let books = summary.number("books") / (summary.number("window_ms") / 1000.0);

    Stage {
        speed,
        connections: servers.len(),
        seconds,
        offered: (after.sent_frames - before.sent_frames) as f64 / seconds,
        delivered: delivered_frames / seconds,
        megabytes: (after.handled_bytes - before.handled_bytes) as f64 / 1e6 / seconds,
        books,
        books_per_frame: books / (delivered_frames / seconds),
        loops: after.loops - before.loops,
        feed_cores: cores(&before, &after, "feed", seconds),
        engine_cores: cores(&before, &after, "engine", seconds),
        replay_cores: cores(&before, &after, "replay", seconds),
        deepest_queue,
        queue_full: after.queue_full - before.queue_full,
        queue_samples: after.queue_samples - before.queue_samples,
        queue_lag_ms: summary.number("max_queue_lag_ms"),
        late_ms: late_us as f64 / 1000.0,
        rows: after.rows - before.rows,
        rss_mb,
    }
}

fn print_stage(stage: &Stage, baseline: f64) {
    let kept_up = stage.delivered >= MIN_DELIVERED * stage.offered
        && stage.late_ms <= MAX_LATE_MS
        && stage.queue_full == 0
        && stage.books_per_frame >= MIN_BOOKS_PER_FRAME * baseline
        && stage.queue_lag_ms < MAX_QUEUE_LAG_MS;

    println!(
        "REPLAY stage speed={:.2} connections={} window_s={:.1} offered_fps={:.0} delivered_fps={:.0} delivered_mb_s={:.1} books_s={:.0} books_per_frame={:.3} loops={} feed_cores={:.2} feed_us_per_frame={:.2} engine_cores={:.3} engine_us_per_book={:.3} replay_cores={:.2} deepest_queue={} queue_full_samples={}/{} max_queue_lag_ms={} server_late_ms={:.1} rows={} rss_mb={:.0} kept_up={}",
        stage.speed,
        stage.connections,
        stage.seconds,
        stage.offered,
        stage.delivered,
        stage.megabytes,
        stage.books,
        stage.books_per_frame,
        stage.loops,
        stage.feed_cores,
        stage.feed_cores / stage.delivered * 1e6,
        stage.engine_cores,
        stage.engine_cores / stage.books * 1e6,
        stage.replay_cores,
        stage.deepest_queue,
        stage.queue_full,
        stage.queue_samples,
        stage.queue_lag_ms,
        stage.late_ms,
        stage.rows,
        stage.rss_mb,
        kept_up,
    );
}

#[test]
#[ignore]
fn load_replay() {
    let summaries = Summaries::default();
    let console = EnvFilter::builder()
        .with_default_directive(LevelFilter::INFO.into())
        .from_env_lossy();
    tracing_subscriber::registry()
        .with(fmt::layer().with_filter(console))
        .with(summaries.clone().with_filter(LevelFilter::INFO))
        .try_init()
        .expect("load_replay sets the global subscriber, so run it alone");
    let _ = rustls::crypto::aws_lc_rs::default_provider().install_default();

    let record_seconds: u64 = env_or("REPLAY_RECORD_SECONDS", RECORD_SECONDS);
    let copies: usize = env_or("REPLAY_COPIES", COPIES);
    let replay_threads: usize = env_or("REPLAY_THREADS", REPLAY_THREADS);

    // The server under test keeps tokio's default worker count, as main does.
    let sut = tokio::runtime::Builder::new_multi_thread()
        .thread_name("feed")
        .enable_all()
        .build()
        .unwrap();
    let replay = tokio::runtime::Builder::new_multi_thread()
        .worker_threads(replay_threads)
        .thread_name("replay")
        .enable_all()
        .build()
        .unwrap();

    let http = reqwest::Client::builder()
        .user_agent("arbitrage-observatory")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30))
        .build()
        .unwrap();
    let mut venues = Vec::new();
    for id in venue_ids() {
        match sut.block_on(load_venue(&id, &http)) {
            Ok(venue) => venues.push(venue),
            Err(error) => panic!("{id} failed to load: {error:#}"),
        }
    }

    let streamed = streamed(&venues);
    let recordings = record(&sut, &streamed, record_seconds);
    let copied = copy_venues(&streamed, copies);
    let layout = layout(&copied);

    let mut markets = 0;
    for venue in &layout {
        markets += venue.markets.len();
    }
    println!(
        "REPLAY {} venues as {copies} copies of {}, {markets} markets, {} recorded connections a copy",
        layout.len(),
        streamed.len(),
        recordings.len(),
    );

    let rate = recorded_rate(&recordings);
    let speeds = speeds(rate, copies);
    println!("REPLAY speeds {speeds:.2?} against {rate:.0} recorded frames a second a copy");

    let mut stages = Vec::new();
    for speed in speeds {
        let stage = run_stage(speed, &copied, &layout, &recordings, &sut, &replay, &summaries);
        print_stage(&stage, stages.first().map_or(stage.books_per_frame, |first: &Stage| first.books_per_frame));
        stages.push(stage);
    }

    println!("REPLAY summary, the first stage is the books per frame baseline");
    let baseline = stages[0].books_per_frame;
    for stage in &stages {
        print_stage(stage, baseline);
    }
}
