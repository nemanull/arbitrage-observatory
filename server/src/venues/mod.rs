// An adapter is one module here, one arm in load_venue and one arm in start_venue.

use crate::engine::cluster::Venue;
use crate::engine::engine::EngineEvent;
use crate::feeds::TrackedMarket;
use crate::feeds::anchor_poller::{AnchorVenue, spawn_poller};
use crate::feeds::venue_feed::{BookVenue, spawn_feed};
use std::sync::Arc;
use tokio::sync::mpsc::Sender;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;

// What one venue's tasks need from the run.
pub struct VenueRun {
    pub venue_id: String,
    pub venue_index: usize,
    pub markets: Vec<TrackedMarket>, // only the markets that sit in a cluster
    pub http: reqwest::Client,
    pub tx: Sender<EngineEvent>,
    pub cancel: CancellationToken,
}

// Reads the venue's perpetual markets, each with its taker fee and contract size, from the venue's own instruments call.
pub async fn load_venue(id: &str, _http: &reqwest::Client) -> anyhow::Result<Venue> {
    match id {
        _ => anyhow::bail!("{id} has no adapter"),
    }
}

pub fn start_venue(run: VenueRun) -> anyhow::Result<Vec<JoinHandle<()>>> {
    match run.venue_id.as_str() {
        _ => anyhow::bail!("{} has no adapter", run.venue_id),
    }
}

// The book socket and the anchor poll of one venue, the only writers of its slots.
#[allow(dead_code)] // live once the first adapter has an arm in start_venue
pub fn start<V: BookVenue + AnchorVenue>(venue: V, run: VenueRun) -> Vec<JoinHandle<()>> {
    let venue = Arc::new(venue);
    let mut tasks = spawn_feed(
        venue.clone(),
        &run.venue_id,
        run.venue_index,
        &run.markets,
        &run.tx,
        &run.cancel,
    );
    tasks.push(spawn_poller(
        venue,
        &run.venue_id,
        run.markets,
        run.http,
        run.tx,
        run.cancel,
    ));
    tasks
}
