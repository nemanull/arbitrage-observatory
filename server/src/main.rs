mod db;
mod engine;
mod telemetry;

use engine::opportunity::opportunity_writer::{QUEUE_CAPACITY, run_writer};

#[tokio::main]
async fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    let _telemetry = telemetry::init()?;

    let pool = db::db::connect(&std::env::var("DATABASE_URL")?).await?;
    tracing::info!(connections = pool.size(), "connected to postgres");

    let (tx, rx) = tokio::sync::mpsc::channel(QUEUE_CAPACITY);
    let writer = tokio::spawn(run_writer(pool.clone(), rx)); // the writer task now holds a pool handle


    
    tracing::info!("server started");

    Ok(())
}
