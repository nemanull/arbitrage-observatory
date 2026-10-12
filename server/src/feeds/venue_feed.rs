use super::TrackedMarket;
use super::anchor_poller::{RateLimited, get_bytes};
use super::order_book::OrderBook;
use crate::clock::now_ms;
use crate::engine::cluster::{BookLevel, ClusterId, Market};
use crate::engine::engine::{BookUpdate, EngineEvent, Levels, Slot};
use futures_util::future::BoxFuture;
use futures_util::{FutureExt, SinkExt, StreamExt};
use std::any::Any;
use std::collections::{HashMap, HashSet, VecDeque};
use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;
use std::time::Duration;
use tokio::net::TcpStream;
use tokio::sync::mpsc::Sender;
use tokio::sync::mpsc::error::TrySendError;
use tokio::task::JoinHandle;
use tokio::time::{Instant, Interval, MissedTickBehavior, interval_at, sleep, sleep_until, timeout};
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::handshake::client::Request;
use tokio_tungstenite::tungstenite::http::{HeaderName, HeaderValue};
use tokio_tungstenite::tungstenite::{Bytes, Message};
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};
use tokio_util::sync::CancellationToken;

const RECONNECT_BASE: Duration = Duration::from_millis(500);
const MAX_RECONNECT_DELAY: Duration = Duration::from_secs(30);
const CONNECT_TIMEOUT: Duration = Duration::from_secs(10);
const CLOSE_GRACE: Duration = Duration::from_secs(2);
const HOUSEKEEPING_EVERY: Duration = Duration::from_secs(1); // silence, the first book watch and retirement are checked on this tick
const UNSERVED_SAMPLE: usize = 3;
const SNAPSHOT_RATE_LIMIT_PAUSE: Duration = Duration::from_secs(10); // when a snapshot's rate limit answer sends no Retry-After
const MAX_SNAPSHOT_BACKOFF: Duration = Duration::from_secs(30);
const SNAPSHOT_FAILURE_LOG_EVERY: u32 = 30;

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;
type SnapshotFetch = BoxFuture<'static, (usize, anyhow::Result<Bytes>)>; // the market's position and the REST reply

#[derive(Debug, Clone)]
pub struct EndpointPlan {
    pub id: String, // "bybit#linear#0"
    pub url: String,
    pub markets: Vec<Market>,
}

#[derive(Debug, Clone)]
pub struct FeedSettings {
    pub max_silence: Duration, // no traffic for this long ends the connection, zero never does
    pub ping_every: Option<Duration>, // sends BookVenue::ping on this period
    pub connect_stagger: Duration, // pause between first opens, for venues that cap handshakes or client messages per IP
    pub reconnect_jitter: Duration,
    pub subscribe_gap: Duration, // pause between subscribe frames on one connection, for venues that close a socket on a burst
    pub first_book_wait: Duration, // after the last subscribe frame, how long a market may hold no book before the connection logs it
    pub retire_after: Option<Duration>, // reopen the socket before the venue's own cap, as binance closes every socket at 24 h
    pub retire_jitter: Duration,
    pub snapshot_gap: Duration, // pause between the starts of two REST snapshot fetches on one connection
    pub headers: &'static [(&'static str, &'static str)], // sent on every handshake, [("User-Agent", "Mozilla/5.0")]
}

impl FeedSettings {
    pub const fn new(max_silence: Duration) -> Self {
        Self {
            max_silence,
            ping_every: None,
            connect_stagger: Duration::ZERO,
            reconnect_jitter: Duration::from_millis(250),
            subscribe_gap: Duration::ZERO,
            first_book_wait: Duration::from_secs(10),
            retire_after: None,
            retire_jitter: Duration::ZERO,
            snapshot_gap: Duration::from_millis(200),
            headers: &[],
        }
    }
}

// The venue side of a book socket, which never touches the socket, a timer or the engine channel.
pub trait BookVenue: Send + Sync + 'static {
    type State: Default + Send + 'static; // the venue's own parse state for one connection, fresh at every connection

    fn settings(&self) -> FeedSettings;

    // Each market belongs to exactly one plan.
    fn plan(&self, markets: &[Market]) -> Vec<EndpointPlan>;

    fn subscribe_frames(&self, markets: &[Market], state: &mut Self::State) -> Vec<Message>;

    fn ping(&self, _state: &mut Self::State) -> Message {
        Message::Ping(Bytes::new())
    }

    // Text and binary frames both arrive as bytes, and an error is logged while the connection carries on.
    fn handle(&self, frame: &[u8], conn: &mut Connection<Self::State>) -> anyhow::Result<()>;

    // Where a market's REST book lives, for a venue whose socket never sends a snapshot and which calls request_snapshot.
    fn snapshot_url(&self, _market: &Market) -> Option<String> {
        None
    }

    // Gets the body of the snapshot_url reply between two frames, and an error is logged while the connection carries on.
    fn handle_snapshot(&self, _position: usize, _body: &[u8], _conn: &mut Connection<Self::State>) -> anyhow::Result<()> {
        Ok(())
    }
}

// One socket's books and routing, kept across reconnects and reset by begin when a connection opens.
pub struct Connection<S> {
    pub state: S,
    id: String,
    markets: Vec<Market>,
    slots: Vec<Slot>,
    positions: HashMap<String, usize>, // raw market id to its position in the plan
    books: Vec<Option<OrderBook>>,     // None until the market's first snapshot on this connection
    recv_ts: Vec<i64>,                 // arrival of the frame that last changed each book
    frame_recv_ts: i64,                // arrival of the frame being handled
    changed: Vec<usize>,               // positions published by the current frame, in order
    is_changed: Vec<bool>,
    pending: VecDeque<usize>, // positions the full channel has not taken yet, oldest first
    is_pending: Vec<bool>,
    resync: bool, // ends the connection after the current frame
    outbox: Vec<Message>, // frames the venue asked to send while handling a frame
    warned_unknown: HashSet<String>,
    snapshots: VecDeque<usize>, // positions waiting for a REST snapshot, oldest first
    is_snapshot_queued: Vec<bool>, // queued or in flight
}

impl<S: Default> Connection<S> {
    fn new(id: String, markets: Vec<Market>, slots: Vec<Slot>) -> Self {
        let count = markets.len();
        let mut positions = HashMap::with_capacity(count);
        for (position, market) in markets.iter().enumerate() {
            positions.insert(market.raw_market_id.clone(), position);
        }

        Self {
            state: S::default(),
            id,
            markets,
            slots,
            positions,
            books: vec![None; count],
            recv_ts: vec![0; count],
            frame_recv_ts: 0,
            changed: Vec::with_capacity(count),
            is_changed: vec![false; count],
            pending: VecDeque::with_capacity(count),
            is_pending: vec![false; count],
            resync: false,
            outbox: Vec::new(),
            warned_unknown: HashSet::new(),
            snapshots: VecDeque::new(),
            is_snapshot_queued: vec![false; count],
        }
    }

    // What a connection learned dies with it, except the warned symbols, which describe the plan.
    // The fetch in flight belongs to the run_connection call that ended, so it is dropped with it.
    fn begin(&mut self) {
        self.state = S::default();
        self.books.fill(None);
        self.recv_ts.fill(0);
        self.changed.clear();
        self.is_changed.fill(false);
        self.pending.clear();
        self.is_pending.fill(false);
        self.resync = false;
        self.outbox.clear();
        self.snapshots.clear();
        self.is_snapshot_queued.fill(false);
    }

    pub fn id(&self) -> &str {
        &self.id
    }

    pub fn markets(&self) -> &[Market] {
        &self.markets
    }

    // The arrival of the frame or snapshot reply being handled, in Unix ms.
    pub fn frame_recv_ts(&self) -> i64 {
        self.frame_recv_ts
    }

    // A venue can deliver a symbol nobody asked for, and a raw id spelled differently from the venue's own looks identical here.
    // The first drop of each symbol is therefore logged, because that second case is otherwise completely silent.
    pub fn position(&mut self, raw_market_id: &str) -> Option<usize> {
        if let Some(&position) = self.positions.get(raw_market_id) {
            return Some(position);
        }

        if !self.warned_unknown.contains(raw_market_id) {
            self.warned_unknown.insert(raw_market_id.to_string());
            tracing::warn!(event = "unsubscribed_symbol", connection = %self.id, market = raw_market_id);
        }

        None
    }

    pub fn book(&mut self, position: usize) -> Option<&mut OrderBook> {
        self.books.get_mut(position)?.as_mut()
    }

    pub fn reset_book(&mut self, position: usize, bids: &[BookLevel], asks: &[BookLevel]) {
        let Some(book) = self.books.get_mut(position) else {
            return;
        };

        book.get_or_insert_with(OrderBook::default).reset(bids, asks);
        self.publish(position);
    }

    // Sends the market's book to the engine once the current frame is handled, however many times this is called.
    pub fn publish(&mut self, position: usize) {
        if self.books.get(position).is_none_or(|book| book.is_none()) {
            return;
        }

        self.recv_ts[position] = self.frame_recv_ts;

        if !self.is_changed[position] {
            self.is_changed[position] = true;
            self.changed.push(position);
        }
    }

    // Sent once the current frame is handled, such as the pong a venue expects to an application ping.
    pub fn send(&mut self, frame: Message) {
        self.outbox.push(frame);
    }

    // Queues a fetch of the market's snapshot_url, and a second call while it is queued or in flight does nothing.
    // The reply reaches handle_snapshot on this connection only, since a reconnect clears the queue.
    pub fn request_snapshot(&mut self, position: usize) {
        let Some(queued) = self.is_snapshot_queued.get_mut(position) else {
            return;
        };
        if *queued {
            return;
        }

        *queued = true;
        self.snapshots.push_back(position);
    }

    // Ends the connection after the current frame, and the venue's next snapshots rebuild the books.
    pub fn resync(&mut self, market: &str, reason: &str) {
        if self.resync {
            return;
        }

        tracing::warn!(event = "book_resync", connection = %self.id, market, reason);
        self.resync = true;
    }

    fn update(&self, position: usize) -> Option<EngineEvent> {
        let book = self.books[position].as_ref()?;

        Some(EngineEvent::Book(BookUpdate {
            slot: self.slots[position],
            bids: Levels::from_slice(book.bids()),
            asks: Levels::from_slice(book.asks()),
            recv_ts: self.recv_ts[position],
        }))
    }

    // While the channel is full a market waits in pending, and the reserve branch sends it later.
    fn flush_changed(&mut self, tx: &Sender<EngineEvent>) -> Result<(), EngineGone> {
        for i in 0..self.changed.len() {
            let position = self.changed[i];
            self.is_changed[position] = false;

            // Already waiting, and its turn sends its newest state.
            if self.is_pending[position] {
                continue;
            }

            // Behind the markets already waiting, so the oldest goes first.
            if !self.pending.is_empty() {
                self.mark_pending(position);
                continue;
            }

            let Some(update) = self.update(position) else {
                continue;
            };

            match tx.try_send(update) {
                Ok(()) => {}
                Err(TrySendError::Full(_)) => self.mark_pending(position),
                Err(TrySendError::Closed(_)) => return Err(EngineGone),
            }
        }

        self.changed.clear();
        Ok(())
    }

    fn mark_pending(&mut self, position: usize) {
        self.is_pending[position] = true;
        self.pending.push_back(position);
    }

    fn next_pending(&mut self) -> Option<EngineEvent> {
        while let Some(position) = self.pending.pop_front() {
            self.is_pending[position] = false;

            if let Some(update) = self.update(position) {
                return Some(update);
            }
        }

        None
    }

    // Several venues acknowledge a misspelled or wrong family stream and then send nothing, so a market with no book after the wait is logged once per connection.
    fn warn_unserved(&self) {
        let mut missing = Vec::new();
        for (position, book) in self.books.iter().enumerate() {
            if book.is_none() {
                missing.push(self.markets[position].raw_market_id.as_str());
            }
        }

        if missing.is_empty() {
            return;
        }

        tracing::warn!(
            event = "book_unserved",
            connection = %self.id,
            missing = missing.len(),
            markets = self.markets.len(),
            sample = ?&missing[..missing.len().min(UNSERVED_SAMPLE)],
        );
    }
}

// Venue tests drive handle on this, as the Nest specs drove handleMessage on a stub connection.
#[cfg(test)]
impl<S: Default> Connection<S> {
    // Market i sits in cluster i, and the connection is open with no frame handled yet.
    pub fn for_test(id: &str, markets: Vec<Market>) -> Self {
        let mut slots = Vec::with_capacity(markets.len());
        for cluster in 0..markets.len() {
            slots.push(Slot { cluster, venue: 0 });
        }

        let mut conn = Self::new(id.to_string(), markets, slots);
        conn.begin();
        conn.frame_recv_ts = 1;
        conn
    }

    // What the engine would get for the frames handled since the last call, as (raw id, bids, asks) in publish order.
    pub fn take_published(&mut self) -> Vec<(String, Vec<BookLevel>, Vec<BookLevel>)> {
        let mut published = Vec::with_capacity(self.changed.len());

        for i in 0..self.changed.len() {
            let position = self.changed[i];
            self.is_changed[position] = false;

            if let Some(EngineEvent::Book(update)) = self.update(position) {
                published.push((
                    self.markets[position].raw_market_id.clone(),
                    update.bids.as_slice().to_vec(),
                    update.asks.as_slice().to_vec(),
                ));
            }
        }

        self.changed.clear();
        published
    }

    pub fn resync_requested(&self) -> bool {
        self.resync
    }

    pub fn take_sent(&mut self) -> Vec<Message> {
        std::mem::take(&mut self.outbox)
    }

    // The positions request_snapshot queued, oldest first.
    pub fn queued_snapshots(&self) -> Vec<usize> {
        self.snapshots.iter().copied().collect()
    }
}

struct EngineGone;

#[derive(Debug, PartialEq, Eq)]
enum Exit {
    Closed,  // the socket ended, so its markets go stale and it reconnects
    Stopped, // cancelled, or the engine is gone
}

// One task per plan, and a market planned twice keeps its first plan, so no slot has two writers.
pub fn spawn_feed<V: BookVenue>(
    venue: Arc<V>,
    venue_id: &str,
    venue_index: usize,
    markets: &[TrackedMarket],
    http: &reqwest::Client,
    tx: &Sender<EngineEvent>,
    cancel: &CancellationToken,
) -> Vec<JoinHandle<()>> {
    let mut slots: HashMap<&str, Slot> = HashMap::with_capacity(markets.len());
    let mut plain = Vec::with_capacity(markets.len());
    for tracked in markets {
        slots.insert(tracked.market.raw_market_id.as_str(), tracked.slot);
        plain.push(tracked.market.clone());
    }

    let plans = venue.plan(&plain);
    let settings = venue.settings();
    let mut tasks = Vec::with_capacity(plans.len());
    let mut streamed = 0;

    for plan in plans {
        let mut kept = Vec::with_capacity(plan.markets.len());
        let mut plan_slots = Vec::with_capacity(plan.markets.len());

        for market in plan.markets {
            match slots.remove(market.raw_market_id.as_str()) {
                Some(slot) => {
                    plan_slots.push(slot);
                    kept.push(market);
                }
                None => tracing::error!(
                    event = "plan_market_refused",
                    connection = %plan.id,
                    market = %market.raw_market_id,
                    reason = "not tracked, or already in another plan",
                ),
            }
        }

        if kept.is_empty() {
            continue;
        }

        streamed += kept.len();
        let socket = EndpointPlan {
            id: plan.id,
            url: plan.url,
            markets: kept,
        };
        let start_delay = settings.connect_stagger * tasks.len() as u32;
        tasks.push(tokio::spawn(run_socket(
            venue.clone(),
            socket,
            plan_slots,
            venue_index,
            start_delay,
            http.clone(),
            tx.clone(),
            cancel.clone(),
        )));
    }

    if !slots.is_empty() {
        let mut sample: Vec<&str> = slots.keys().copied().collect();
        sample.sort_unstable();
        sample.truncate(UNSERVED_SAMPLE);
        tracing::error!(event = "markets_unplanned", venue = venue_id, unplanned = slots.len(), sample = ?sample);
    }

    if tasks.is_empty() {
        tracing::error!(event = "feed_start_aborted", venue = venue_id, reason = "no plan holds a tracked market");
    } else {
        tracing::info!(event = "feed_started", venue = venue_id, connections = tasks.len(), markets = streamed);
    }

    tasks
}

async fn run_socket<V: BookVenue>(
    venue: Arc<V>,
    plan: EndpointPlan,
    slots: Vec<Slot>,
    venue_index: usize,
    start_delay: Duration,
    http: reqwest::Client,
    tx: Sender<EngineEvent>,
    cancel: CancellationToken,
) {
    if !start_delay.is_zero() {
        tokio::select! {
            _ = cancel.cancelled() => return,
            _ = sleep(start_delay) => {}
        }
    }

    let settings = venue.settings();
    let clusters: Vec<ClusterId> = slots.iter().map(|slot| slot.cluster).collect();
    let mut conn = Connection::new(plan.id, plan.markets, slots);
    let mut attempt: u32 = 0;

    loop {
        let exit = run_connection(&*venue, &plan.url, &settings, &mut conn, &mut attempt, &http, &tx, &cancel).await;
        if exit == Exit::Stopped {
            return;
        }

        // The books died with the socket, so its markets stop counting as live and their open routes close.
        let stale = EngineEvent::Stale {
            venue: venue_index,
            clusters: clusters.clone(),
            connection: conn.id.clone(),
        };
        tokio::select! {
            _ = cancel.cancelled() => return,
            sent = tx.send(stale) => if sent.is_err() { return },
        }

        attempt += 1;
        let delay = reconnect_delay(attempt, settings.reconnect_jitter);
        tracing::warn!(
            event = "feed_reconnecting",
            connection = %conn.id,
            delay_ms = delay.as_millis() as u64,
            attempt,
        );

        tokio::select! {
            _ = cancel.cancelled() => return,
            _ = sleep(delay) => {}
        }
    }
}

async fn run_connection<V: BookVenue>(
    venue: &V,
    url: &str,
    settings: &FeedSettings,
    conn: &mut Connection<V::State>,
    attempt: &mut u32,
    http: &reqwest::Client,
    tx: &Sender<EngineEvent>,
    cancel: &CancellationToken,
) -> Exit {
    let request = match handshake_request(url, settings.headers) {
        Ok(request) => request,
        Err(error) => {
            tracing::error!(event = "connection_failed", connection = %conn.id, error = format!("{error:#}"));
            return Exit::Closed;
        }
    };
    let mut ws = tokio::select! {
        _ = cancel.cancelled() => return Exit::Stopped,
        connected = timeout(CONNECT_TIMEOUT, connect_async(request)) => match connected {
            Ok(Ok((ws, _response))) => ws,
            Ok(Err(error)) => {
                tracing::error!(event = "connection_failed", connection = %conn.id, %error);
                return Exit::Closed;
            }
            Err(_) => {
                tracing::error!(event = "connection_failed", connection = %conn.id, error = "timed out");
                return Exit::Closed;
            }
        },
    };

    conn.begin();
    let subscribe = catch_panic(|| venue.subscribe_frames(&conn.markets, &mut conn.state));
    let mut frames: VecDeque<Message> = match subscribe {
        Ok(frames) => frames.into(),
        Err(panic) => {
            tracing::error!(event = "venue_panicked", connection = %conn.id, call = "subscribe_frames", panic);
            return Exit::Closed;
        }
    };
    let frame_count = frames.len();
    tracing::info!(
        event = "connection_opened",
        connection = %conn.id,
        markets = conn.markets.len(),
        subscribe_frames = frame_count,
    );

    // Every frame now, or the first now and one per gap through the subscribe branch.
    let gap = settings.subscribe_gap;
    while let Some(frame) = frames.pop_front() {
        if let Err(error) = ws.send(frame).await {
            tracing::error!(event = "connection_error", connection = %conn.id, %error);
            return Exit::Closed;
        }
        if !gap.is_zero() {
            break;
        }
    }

    let opened_at = Instant::now();
    let mut subscribe_timer = (!frames.is_empty()).then(|| every(gap, opened_at));
    let mut ping_timer = settings
        .ping_every
        .filter(|period| !period.is_zero())
        .map(|period| every(period, opened_at));
    let mut housekeeping = every(HOUSEKEEPING_EVERY, opened_at);
    let mut first_book_due = Some(opened_at + gap * frame_count.saturating_sub(1) as u32 + settings.first_book_wait);
    let retire_at = settings
        .retire_after
        .map(|after| opened_at + after + random_up_to(settings.retire_jitter));
    let mut last_traffic = opened_at;
    let mut snapshot: Option<SnapshotFetch> = None;
    let mut next_snapshot_at = opened_at; // the earliest start of the next fetch
    let mut snapshot_failures: u32 = 0; // consecutive failed fetches on this connection

    loop {
        tokio::select! {
            _ = cancel.cancelled() => {
                let _ = timeout(CLOSE_GRACE, ws.close(None)).await;
                return Exit::Stopped;
            }

            message = ws.next() => {
                let frame: &[u8] = match &message {
                    Some(Ok(Message::Text(text))) => text.as_str().as_bytes(),
                    Some(Ok(Message::Binary(bytes))) => bytes,
                    Some(Ok(Message::Ping(_) | Message::Pong(_))) => {
                        last_traffic = Instant::now();
                        continue;
                    }
                    Some(Ok(Message::Frame(_))) => continue,
                    Some(Ok(Message::Close(close))) => {
                        tracing::warn!(event = "connection_ended", connection = %conn.id, close = ?close);
                        return Exit::Closed;
                    }
                    Some(Err(error)) => {
                        tracing::error!(event = "connection_error", connection = %conn.id, %error);
                        return Exit::Closed;
                    }
                    None => {
                        tracing::warn!(event = "connection_ended", connection = %conn.id);
                        return Exit::Closed;
                    }
                };

                last_traffic = Instant::now();
                *attempt = 0;
                conn.frame_recv_ts = now_ms();

                match catch_panic(|| venue.handle(frame, conn)) {
                    Ok(Ok(())) => {}
                    Ok(Err(error)) => {
                        tracing::error!(event = "frame_handle_failed", connection = %conn.id, %error);
                    }
                    Err(panic) => {
                        tracing::error!(event = "venue_panicked", connection = %conn.id, call = "handle", panic);
                        return Exit::Closed;
                    }
                }

                if let Err(exit) = finish_handled(&mut ws, conn, tx).await {
                    return exit;
                }

                if snapshot.is_none() && !conn.snapshots.is_empty() {
                    match next_snapshot(venue, http, settings.snapshot_gap, conn, &mut next_snapshot_at) {
                        Ok(fetch) => snapshot = fetch,
                        Err(exit) => return exit,
                    }
                }
            }

            (position, fetched) = in_flight(&mut snapshot) => {
                snapshot = None;
                let market = conn.markets[position].raw_market_id.as_str();

                match fetched {
                    Ok(body) => {
                        tracing::debug!(event = "snapshot_fetched", connection = %conn.id, market, bytes = body.len());
                        snapshot_failures = 0;
                        conn.is_snapshot_queued[position] = false;
                        conn.frame_recv_ts = now_ms();

                        match catch_panic(|| venue.handle_snapshot(position, &body, conn)) {
                            Ok(Ok(())) => {}
                            Ok(Err(error)) => {
                                let market = conn.markets[position].raw_market_id.as_str();
                                tracing::error!(event = "snapshot_handle_failed", connection = %conn.id, market, %error);
                            }
                            Err(panic) => {
                                tracing::error!(event = "venue_panicked", connection = %conn.id, call = "handle_snapshot", panic);
                                return Exit::Closed;
                            }
                        }

                        if let Err(exit) = finish_handled(&mut ws, conn, tx).await {
                            return exit;
                        }
                    }
                    Err(error) => {
                        // A run of failures backs off and logs sparsely, so one dead market cannot fetch and warn five times a second.
                        snapshot_failures += 1;
                        if snapshot_failures == 1 || snapshot_failures % SNAPSHOT_FAILURE_LOG_EVERY == 0 {
                            tracing::warn!(
                                event = "snapshot_failed",
                                connection = %conn.id,
                                market,
                                failures = snapshot_failures,
                                error = format!("{error:#}"),
                            );
                        }
                        let mut pause = snapshot_backoff(settings.snapshot_gap, snapshot_failures);
                        if let Some(limited) = error.downcast_ref::<RateLimited>() {
                            pause = pause.max(limited.retry_after.unwrap_or(SNAPSHOT_RATE_LIMIT_PAUSE));
                        }
                        next_snapshot_at = next_snapshot_at.max(Instant::now() + pause);
                        conn.snapshots.push_back(position); // still flagged as queued
                    }
                }

                if !conn.snapshots.is_empty() {
                    match next_snapshot(venue, http, settings.snapshot_gap, conn, &mut next_snapshot_at) {
                        Ok(fetch) => snapshot = fetch,
                        Err(exit) => return exit,
                    }
                }
            }

            _ = tick(&mut ping_timer) => {
                let ping = match catch_panic(|| venue.ping(&mut conn.state)) {
                    Ok(ping) => ping,
                    Err(panic) => {
                        tracing::error!(event = "venue_panicked", connection = %conn.id, call = "ping", panic);
                        return Exit::Closed;
                    }
                };
                if let Err(error) = ws.send(ping).await {
                    tracing::error!(event = "connection_error", connection = %conn.id, %error);
                    return Exit::Closed;
                }
            }

            _ = tick(&mut subscribe_timer) => {
                if let Some(frame) = frames.pop_front()
                    && let Err(error) = ws.send(frame).await
                {
                    tracing::error!(event = "connection_error", connection = %conn.id, %error);
                    return Exit::Closed;
                }
                if frames.is_empty() {
                    subscribe_timer = None;
                }
            }

            _ = housekeeping.tick() => {
                let now = Instant::now();
                let silence = now - last_traffic;

                if !settings.max_silence.is_zero() && silence >= settings.max_silence {
                    tracing::error!(
                        event = "connection_silent",
                        connection = %conn.id,
                        silence_ms = silence.as_millis() as u64,
                    );
                    return Exit::Closed;
                }

                if first_book_due.is_some_and(|due| now >= due) {
                    first_book_due = None;
                    conn.warn_unserved();
                }

                if retire_at.is_some_and(|at| now >= at) {
                    tracing::info!(event = "connection_retired", connection = %conn.id);
                    let _ = timeout(CLOSE_GRACE, ws.close(None)).await;
                    return Exit::Closed;
                }
            }

            permit = tx.reserve(), if !conn.pending.is_empty() => {
                let Ok(permit) = permit else {
                    return Exit::Stopped;
                };
                if let Some(update) = conn.next_pending() {
                    permit.send(update);
                }
            }
        }
    }
}

// Builds the handshake from the URL with the venue's headers, as connect_async(url) would build it without them.
fn handshake_request(url: &str, headers: &[(&str, &str)]) -> anyhow::Result<Request> {
    let mut request = url.into_client_request()?;
    for &(name, value) in headers {
        request
            .headers_mut()
            .insert(HeaderName::from_bytes(name.as_bytes())?, HeaderValue::from_str(value)?);
    }
    Ok(request)
}

// What follows a handled frame or snapshot: the venue's own frames, then the changed books, then a requested resync.
async fn finish_handled<S: Default>(ws: &mut Socket, conn: &mut Connection<S>, tx: &Sender<EngineEvent>) -> Result<(), Exit> {
    for frame in conn.outbox.drain(..) {
        if let Err(error) = ws.send(frame).await {
            tracing::error!(event = "connection_error", connection = %conn.id, %error);
            return Err(Exit::Closed);
        }
    }

    if conn.flush_changed(tx).is_err() {
        return Err(Exit::Stopped);
    }

    if conn.resync {
        return Err(Exit::Closed);
    }

    Ok(())
}

// Starts the fetch of the oldest queued market that has a snapshot_url, no sooner than `next_at`, and moves `next_at` one gap past that start.
fn next_snapshot<V: BookVenue>(
    venue: &V,
    http: &reqwest::Client,
    gap: Duration,
    conn: &mut Connection<V::State>,
    next_at: &mut Instant,
) -> Result<Option<SnapshotFetch>, Exit> {
    while let Some(position) = conn.snapshots.pop_front() {
        let market = &conn.markets[position];
        let url = match catch_panic(|| venue.snapshot_url(market)) {
            Ok(Some(url)) => url,
            Ok(None) => {
                tracing::warn!(event = "snapshot_url_missing", connection = %conn.id, market = %market.raw_market_id);
                conn.is_snapshot_queued[position] = false;
                continue;
            }
            Err(panic) => {
                tracing::error!(event = "venue_panicked", connection = %conn.id, call = "snapshot_url", panic);
                return Err(Exit::Closed);
            }
        };

        let start_at = (*next_at).max(Instant::now());
        *next_at = start_at + gap;
        let http = http.clone();
        return Ok(Some(
            async move {
                sleep_until(start_at).await;
                (position, get_bytes(&http, &url).await)
            }
            .boxed(),
        ));
    }

    Ok(None)
}

// Doubles with each consecutive failure, from two gaps up to MAX_SNAPSHOT_BACKOFF.
fn snapshot_backoff(gap: Duration, failures: u32) -> Duration {
    gap.saturating_mul(1 << failures.min(8)).min(MAX_SNAPSHOT_BACKOFF)
}

// The reply of the fetch in flight, or never when none is, as tick does for an absent timer.
async fn in_flight(fetch: &mut Option<SnapshotFetch>) -> (usize, anyhow::Result<Bytes>) {
    match fetch {
        Some(fetch) => fetch.await,
        None => std::future::pending().await,
    }
}

// select! builds every branch's future even when its timer is off, so an absent timer waits forever instead of unwrapping.
async fn tick(timer: &mut Option<Interval>) {
    match timer {
        Some(timer) => {
            timer.tick().await;
        }
        None => std::future::pending().await,
    }
}

// The first tick lands one period after `from`. tokio's interval panics on a zero period, so callers never pass one.
fn every(period: Duration, from: Instant) -> Interval {
    let mut timer = interval_at(from + period, period);
    timer.set_missed_tick_behavior(MissedTickBehavior::Delay);
    timer
}

fn reconnect_delay(attempt: u32, jitter: Duration) -> Duration {
    let doublings = attempt.saturating_sub(1).min(16);
    let backoff = (RECONNECT_BASE * (1u32 << doublings)).min(MAX_RECONNECT_DELAY);
    backoff + random_up_to(jitter)
}

// A panic in venue code would end the task silently and leave its books in the engine as live legs.
// Caught, it ends the connection like any other close, so the markets go stale and the socket reconnects.
// The next connection resets the state the panic interrupted, which is why AssertUnwindSafe is sound here.
fn catch_panic<T>(call: impl FnOnce() -> T) -> Result<T, String> {
    catch_unwind(AssertUnwindSafe(call)).map_err(|payload| panic_message(payload.as_ref()))
}

fn panic_message(payload: &(dyn Any + Send)) -> String {
    if let Some(text) = payload.downcast_ref::<&str>() {
        return text.to_string();
    }
    if let Some(text) = payload.downcast_ref::<String>() {
        return text.clone();
    }
    "a panic with no message".to_string()
}

fn random_up_to(limit: Duration) -> Duration {
    if limit.is_zero() {
        return Duration::ZERO;
    }

    Duration::from_millis(rand::random_range(0..=limit.as_millis() as u64))
}

#[cfg(test)]
mod tests;
