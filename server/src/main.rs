mod engine;
mod telemetry;

fn main() -> anyhow::Result<()> {
    dotenvy::dotenv().ok();
    let _telemetry = telemetry::init()?;

    tracing::info!("server started");
    Ok(())
}
