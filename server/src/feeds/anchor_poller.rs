use super::TrackedMarket;
use crate::clock::now_ms;
use crate::engine::cluster::AnchorReading;
use crate::engine::engine::{EngineEvent, Slot, anchor_issue};
use reqwest::header::{ACCEPT, RETRY_AFTER};
use serde::de::DeserializeOwned;
use std::collections::{HashMap, HashSet};
use std::fmt;
use std::future::Future;
use std::sync::Arc;
use std::time::Duration;
use tokio::sync::mpsc::Sender;
use tokio::task::JoinHandle;
use tokio::time::{Instant, MissedTickBehavior, interval};
use tokio_util::sync::CancellationToken;

const REQUEST_TIMEOUT: Duration = Duration::from_secs(10);
const RATE_LIMIT_PAUSE: Duration = Duration::from_secs(60); // when the venue sends no Retry-After
const RATE_LIMITED_STATUSES: [u16; 3] = [403, 418, 429]; // 403 for bybit
const FAILURE_LOG_EVERY: u64 = 30;
const SUMMARY_EVERY_ROUNDS: u64 = 60;

// A row read by its own request inside a multi request round carries its own ts, and every other row takes the round's arrival.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct AnchorRow {
    pub index: f64,
    pub mark: f64, // 0 = the venue publishes none
    pub funding_rate: f64,
    pub funding_interval_hours: f64,
    pub next_funding_at: i64, // Unix ms, 0 = unknown
    pub ts: Option<i64>,
}

pub type AnchorMap = HashMap<String, AnchorRow>; // <raw market id, row> for every market in the venue's round

// A rate limit answer, from the status or from inside a 200 body as MEXC sends it, which pauses the poller.
#[derive(Debug)]
pub struct RateLimited {
    pub url: String,
    pub reason: String, // "429 Too Many Requests", "code 510"
    pub retry_after: Option<Duration>,
}

impl fmt::Display for RateLimited {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        write!(f, "{} from {}", self.reason, self.url)
    }
}

impl std::error::Error for RateLimited {}

// The venue side of an anchor poll, which never touches the timer or the engine channel.
pub trait AnchorVenue: Send + Sync + 'static {
    // No venue republishes faster than once a second, so faster polls return the same numbers.
    fn poll_every(&self) -> Duration {
        Duration::from_secs(1)
    }

    // How long a rate limit answer without a Retry-After pauses the poller.
    fn rate_limit_pause(&self) -> Duration {
        RATE_LIMIT_PAUSE
    }

    fn fetch_round(
        &self,
        http: &reqwest::Client,
        ts: i64,
    ) -> impl Future<Output = anyhow::Result<AnchorMap>> + Send;
}

pub async fn get_json<T: DeserializeOwned>(http: &reqwest::Client, url: &str) -> anyhow::Result<T> {
    let response = http
        .get(url)
        .timeout(REQUEST_TIMEOUT)
        .header(ACCEPT, "application/json")
        .send()
        .await?;
    let status = response.status();

    if !status.is_success() {
        if RATE_LIMITED_STATUSES.contains(&status.as_u16()) {
            let retry_after = response
                .headers()
                .get(RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(retry_after);

            return Err(RateLimited {
                url: url.to_string(),
                reason: status.to_string(),
                retry_after,
            }
            .into());
        }

        anyhow::bail!("{status} from {url}");
    }

    Ok(response.json().await?)
}

// Retry-After is either whole seconds or an HTTP date.
fn retry_after(header: &str) -> Option<Duration> {
    if !header.is_empty() && header.bytes().all(|byte| byte.is_ascii_digit()) {
        return header.parse().ok().map(Duration::from_secs);
    }

    let at = chrono::DateTime::parse_from_rfc2822(header).ok()?;
    let wait_ms = (at.timestamp_millis() - now_ms()).max(0);
    Some(Duration::from_millis(wait_ms as u64))
}

pub fn spawn_poller<V: AnchorVenue>(
    venue: Arc<V>,
    venue_id: &str,
    markets: Vec<TrackedMarket>,
    http: reqwest::Client,
    tx: Sender<EngineEvent>,
    cancel: CancellationToken,
) -> JoinHandle<()> {
    tokio::spawn(run_poller(venue, venue_id.to_string(), markets, http, tx, cancel))
}

async fn run_poller<V: AnchorVenue>(
    venue: Arc<V>,
    venue_id: String,
    markets: Vec<TrackedMarket>,
    http: reqwest::Client,
    tx: Sender<EngineEvent>,
    cancel: CancellationToken,
) {
    let every = venue.poll_every();

    // Under a millisecond, the skipped count would divide by zero.
    if markets.is_empty() || every.as_millis() == 0 {
        tracing::error!(
            event = "anchor_poll_aborted",
            venue = %venue_id,
            markets = markets.len(),
            every_ms = every.as_millis() as u64,
        );
        return;
    }

    tracing::info!(
        event = "anchor_poll_started",
        venue = %venue_id,
        markets = markets.len(),
        every_ms = every.as_millis() as u64,
    );

    let mut poll = PollState::new(venue_id, markets, venue.rate_limit_pause());
    let mut timer = interval(every); // its first tick is immediate, so the first round runs at start
    timer.set_missed_tick_behavior(MissedTickBehavior::Skip);

    loop {
        tokio::select! {
            _ = cancel.cancelled() => break,
            _ = timer.tick() => {}
        }

        let started = Instant::now();
        if poll.paused_until.is_some_and(|until| started < until) {
            continue;
        }

        let fetched = tokio::select! {
            _ = cancel.cancelled() => {
                poll.stopped(true);
                return;
            }
            fetched = venue.fetch_round(&http, now_ms()) => fetched,
        };

        // Stamped on arrival, since a slow reply stamped at the round start reads as skewed against a faster venue.
        let arrived_at = now_ms();
        let took = started.elapsed();

        match fetched.and_then(|rows| poll.readings(&rows, arrived_at)) {
            Ok(readings) => {
                tokio::select! {
                    _ = cancel.cancelled() => break,
                    sent = tx.send(EngineEvent::Anchors(readings)) => if sent.is_err() { break },
                }
                poll.succeeded(took);
            }
            Err(error) => poll.failed(&error, started),
        }

        // The ticks that came due while this round ran, which the overlapping timer of the Nest poller counted as skipped.
        let overran = (started.elapsed().as_millis() / every.as_millis()) as u64;
        poll.window.skipped += overran;
        if overran > 0 {
            timer.tick().await; // the interval fires the first missed tick at once, and Nest skipped it
        }

        if poll.window.rounds + poll.window.failed >= SUMMARY_EVERY_ROUNDS {
            poll.summarize();
        }
    }

    poll.stopped(false);
}

#[derive(Default)]
struct Window {
    rounds: u64,
    failed: u64,
    skipped: u64,  // ticks that came due while the previous round was still running
    written: u64,  // readings sent to the engine
    missing: u64,  // tracked markets the reply did not carry
    rejected: u64, // readings anchor_issue refused
    sum_ms: u64,
    max_ms: u64,
}

struct PollState {
    venue_id: String,
    markets: Vec<TrackedMarket>,
    failures: u64, // consecutive failed rounds
    rate_limit_pause: Duration,
    paused_until: Option<Instant>,
    warned_missing: HashSet<String>,
    window: Window,
}

impl PollState {
    fn new(venue_id: String, markets: Vec<TrackedMarket>, rate_limit_pause: Duration) -> Self {
        Self {
            venue_id,
            markets,
            failures: 0,
            rate_limit_pause,
            paused_until: None,
            warned_missing: HashSet::new(),
            window: Window::default(),
        }
    }

    // A round that yields no reading fails, as it did when the engine refused every one.
    fn readings(&mut self, rows: &AnchorMap, arrived_at: i64) -> anyhow::Result<Vec<(Slot, AnchorReading)>> {
        let mut readings = Vec::with_capacity(self.markets.len());
        let mut missing = 0;
        let mut rejected = 0;

        for tracked in &self.markets {
            let raw_market_id = tracked.market.raw_market_id.as_str();

            // A NaN index fails the comparison too, so it counts as missing like an absent row.
            let Some(row) = rows.get(raw_market_id).filter(|row| row.index > 0.0) else {
                missing += 1;
                if !self.warned_missing.contains(raw_market_id) {
                    self.warned_missing.insert(raw_market_id.to_string());
                    tracing::warn!(
                        event = "anchor_row_missing",
                        venue = %self.venue_id,
                        market = raw_market_id,
                        rows = rows.len(),
                    );
                }
                continue;
            };

            let reading = AnchorReading {
                index: row.index,
                mark: row.mark,
                funding_rate: row.funding_rate,
                funding_interval_hours: row.funding_interval_hours,
                next_funding_at: row.next_funding_at,
                ts: row.ts.unwrap_or(arrived_at),
            };

            if let Some(issue) = anchor_issue(&reading) {
                rejected += 1;
                tracing::warn!(
                    event = "anchor_update_rejected",
                    venue = %self.venue_id,
                    market = raw_market_id,
                    issue,
                    index = reading.index,
                    mark = reading.mark,
                    funding_rate = reading.funding_rate,
                    funding_interval_hours = reading.funding_interval_hours,
                    next_funding_at = reading.next_funding_at,
                    ts = reading.ts,
                );
                continue;
            }

            readings.push((tracked.slot, reading));
        }

        self.window.written += readings.len() as u64;
        self.window.missing += missing;
        self.window.rejected += rejected;

        if readings.is_empty() {
            anyhow::bail!(
                "no tracked market written from {} row(s): {missing} missing, {rejected} rejected",
                rows.len()
            );
        }

        Ok(readings)
    }

    fn succeeded(&mut self, took: Duration) {
        if self.failures > 0 {
            tracing::info!(event = "anchor_poll_recovered", venue = %self.venue_id, failures = self.failures);
            self.failures = 0;
        }

        let ms = took.as_millis() as u64;
        self.window.rounds += 1;
        self.window.sum_ms += ms;
        self.window.max_ms = self.window.max_ms.max(ms);
    }

    fn failed(&mut self, error: &anyhow::Error, started: Instant) {
        self.failures += 1;
        self.window.failed += 1;

        if let Some(limited) = error.downcast_ref::<RateLimited>() {
            let pause = limited.retry_after.unwrap_or(self.rate_limit_pause);
            self.paused_until = Some(started + pause);
            tracing::error!(
                event = "anchor_poll_paused",
                venue = %self.venue_id,
                error = %limited,
                pause_ms = pause.as_millis() as u64,
            );
        } else if self.failures == 1 || self.failures % FAILURE_LOG_EVERY == 0 {
            tracing::warn!(
                event = "anchor_round_failed",
                venue = %self.venue_id,
                failures = self.failures,
                error = format!("{error:#}"),
            );
        }
    }

    fn summarize(&mut self) {
        let w = &self.window;

        tracing::info!(
            event = "anchor_poll_summary",
            venue = %self.venue_id,
            rounds = w.rounds,
            failed = w.failed,
            skipped = w.skipped,
            written = w.written,
            missing = w.missing,
            rejected = w.rejected,
            avg_ms = if w.rounds == 0 { 0 } else { w.sum_ms / w.rounds },
            max_ms = w.max_ms,
        );

        self.window = Window::default();
    }

    fn stopped(&self, in_flight: bool) {
        tracing::info!(
            event = "anchor_poll_stopped",
            venue = %self.venue_id,
            in_flight,
            failures = self.failures,
        );
    }
}

#[cfg(test)]
mod tests;
