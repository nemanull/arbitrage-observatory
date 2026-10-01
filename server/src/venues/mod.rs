// An adapter is one module here, one arm in load_venue and one arm in start_venue.

mod binance;
mod bitget;
mod bitstamp;
mod bybit;
mod catalog;
mod coinbase;
mod gate;
mod gemini;
mod krakenfutures;
#[cfg(test)]
mod live_tests;
mod mexc;
mod okx;
#[cfg(test)]
mod testing;
mod wire;

use crate::engine::cluster::Venue;
use crate::engine::engine::EngineEvent;
use crate::feeds::TrackedMarket;
use crate::feeds::anchor_poller::{AnchorVenue, spawn_poller};
use crate::feeds::venue_feed::{BookVenue, spawn_feed};
use binance::Binance;
use bitget::Bitget;
use bitstamp::Bitstamp;
use bybit::Bybit;
use coinbase::Coinbase;
use gate::Gate;
use gemini::Gemini;
use krakenfutures::KrakenFutures;
use mexc::Mexc;
use okx::Okx;
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
pub async fn load_venue(id: &str, http: &reqwest::Client) -> anyhow::Result<Venue> {
    match id {
        binance::ID => binance::load(http).await,
        bybit::ID => bybit::load(http).await,
        okx::ID => okx::load(http).await,
        krakenfutures::ID => krakenfutures::load(http).await,
        coinbase::ID => coinbase::load(http).await,
        gate::ID => gate::load(http).await,
        bitget::ID => bitget::load(http).await,
        mexc::ID => mexc::load(http).await,
        bitstamp::ID => bitstamp::load(http).await,
        gemini::ID => gemini::load(http).await,
        _ => anyhow::bail!("{id} has no adapter"),
    }
}

pub fn start_venue(run: VenueRun) -> anyhow::Result<Vec<JoinHandle<()>>> {
    let tasks = match run.venue_id.as_str() {
        binance::ID => start(Binance::new(&run.markets), run),
        bybit::ID => start(Bybit::new(&run.markets), run),
        okx::ID => start(Okx::new(&run.markets), run),
        krakenfutures::ID => start(KrakenFutures::new(), run),
        coinbase::ID => start(Coinbase::new(), run),
        gate::ID => start(Gate::new(), run),
        bitget::ID => start(Bitget::new(&run.markets), run),
        mexc::ID => start(Mexc::new(), run),
        bitstamp::ID => start(Bitstamp::new(&run.markets), run),
        gemini::ID => start(Gemini::new(&run.markets), run),
        _ => anyhow::bail!("{} has no adapter", run.venue_id),
    };
    Ok(tasks)
}

// The book socket and the anchor poll of one venue, the only writers of its slots.
fn start<V: BookVenue + AnchorVenue>(venue: V, run: VenueRun) -> Vec<JoinHandle<()>> {
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
