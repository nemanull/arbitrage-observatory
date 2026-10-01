mod clock;
mod db;
mod engine;
mod feeds;
mod orchestrator;
#[cfg(test)]
mod pipeline_tests;
mod telemetry;
#[cfg(test)]
mod test_log;
mod venues;

use engine::opportunity::opportunity_writer::{QUEUE_CAPACITY, run_writer};
use std::time::Duration;

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    let _telemetry = telemetry::init()?;

    // tokio-tungstenite's rustls brings no crypto provider of its own, and the first wss connect panics without one.
    rustls::crypto::aws_lc_rs::default_provider()
        .install_default()
        .map_err(|_| anyhow::anyhow!("a rustls crypto provider was already installed"))?;

    let pool = db::db::connect(&std::env::var("DATABASE_URL")?).await?;
    tracing::info!(connections = pool.size(), "connected to postgres");

    let (closed_tx, closed_rx) = tokio::sync::mpsc::channel(QUEUE_CAPACITY);
    let writer = tokio::spawn(run_writer(pool, closed_rx)); // the writer task now holds a pool handle
    let http = reqwest::Client::builder()
        .user_agent("arbitrage-observatory")
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(30)) // a venue loader that sets no timeout of its own cannot hang the boot
        .build()?;

    // A boot failure must exit nonzero rather than leave a process that streams nothing.
    let result = match orchestrator::start(closed_tx, http).await {
        Ok(run) => run.run_until_stopped().await,
        Err(error) => Err(error),
    };

    // The lifecycle held the writer's only sender, so once the run has stopped the writer drains the queue and returns.
    writer.await?;
    tracing::info!("server stopped");

    result
}
