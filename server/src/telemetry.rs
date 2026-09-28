use anyhow::Context;
use opentelemetry_appender_tracing::layer::OpenTelemetryTracingBridge;
use opentelemetry_otlp::{LogExporter, WithExportConfig};
use opentelemetry_sdk::Resource;
use opentelemetry_sdk::logs::SdkLoggerProvider;
use tracing_subscriber::filter::LevelFilter;
use tracing_subscriber::prelude::*;
use tracing_subscriber::{EnvFilter, fmt};

const DEFAULT_SERVICE_NAME: &str = "observatory-server";

pub struct Telemetry {
    logs: Option<SdkLoggerProvider>,
}

impl Drop for Telemetry {
    fn drop(&mut self) {
        if let Some(logs) = &self.logs
            && let Err(err) = logs.shutdown()
        {
            eprintln!("otel log flush failed: {err}");
        }
    }
}

pub fn init() -> anyhow::Result<Telemetry> {
    let console = fmt::layer().with_filter(level_from_env("RUST_LOG")?);

    let endpoint = std::env::var("OTEL_EXPORTER_OTLP_ENDPOINT").unwrap_or_default();
    let endpoint = endpoint.trim().trim_end_matches('/');
    let logs = if endpoint.is_empty() {
        None
    } else {
        Some(logger_provider(endpoint)?)
    };

    let otel = match &logs {
        Some(provider) => Some(OpenTelemetryTracingBridge::new(provider).with_filter(otel_filter()?)),
        None => None,
    };

    tracing_subscriber::registry().with(console).with(otel).init();

    match &logs {
        Some(_) => tracing::info!(endpoint, "exporting logs to OTLP"),
        None => tracing::info!("OTEL_EXPORTER_OTLP_ENDPOINT is empty, logs stay on the console"),
    }
    Ok(Telemetry { logs })
}

fn logger_provider(endpoint: &str) -> anyhow::Result<SdkLoggerProvider> {
    let exporter = LogExporter::builder()
        .with_http()
        .with_endpoint(format!("{endpoint}/v1/logs"))
        .build()
        .context("building the OTLP log exporter")?;
    let service = std::env::var("OTEL_SERVICE_NAME").unwrap_or_else(|_| DEFAULT_SERVICE_NAME.into());

    Ok(SdkLoggerProvider::builder()
        .with_resource(Resource::builder().with_service_name(service).build())
        .with_batch_exporter(exporter)
        .build())
}

fn otel_filter() -> anyhow::Result<EnvFilter> {
    Ok(level_from_env("OTEL_LOG_LEVEL")?
        .add_directive("hyper=off".parse()?)
        .add_directive("h2=off".parse()?)
        .add_directive("reqwest=off".parse()?)
        .add_directive("opentelemetry=off".parse()?))
}

fn level_from_env(var: &str) -> anyhow::Result<EnvFilter> {
    EnvFilter::builder()
        .with_default_directive(LevelFilter::INFO.into())
        .with_env_var(var)
        .from_env()
        .with_context(|| format!("{var} is not a valid log filter"))
}
