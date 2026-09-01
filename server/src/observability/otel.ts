import { OTLPLogExporter } from '@opentelemetry/exporter-logs-otlp-proto';
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-proto';
import { OTLPTraceExporter } from '@opentelemetry/exporter-trace-otlp-proto';
import { ExpressInstrumentation } from '@opentelemetry/instrumentation-express';
import { HttpInstrumentation } from '@opentelemetry/instrumentation-http';
import { IORedisInstrumentation } from '@opentelemetry/instrumentation-ioredis';
import { NestInstrumentation } from '@opentelemetry/instrumentation-nestjs-core';
import { PgInstrumentation } from '@opentelemetry/instrumentation-pg';
import { RuntimeNodeInstrumentation } from '@opentelemetry/instrumentation-runtime-node';
import { defaultResource, resourceFromAttributes } from '@opentelemetry/resources';
import { NodeSDK, logs, metrics } from '@opentelemetry/sdk-node';
import {
  ATTR_SERVICE_NAME,
  ATTR_SERVICE_VERSION,
} from '@opentelemetry/semantic-conventions';


const ATTR_DEPLOYMENT_ENVIRONMENT = 'deployment.environment';

const METRIC_EXPORT_INTERVAL_MS = 30_000;

let sdk: NodeSDK | undefined;

// Must run before the instrumented libraries are imported.
export function startOtel(): void {
  const endpoint = process.env.OTEL_EXPORTER_OTLP_ENDPOINT?.trim();
  if (!endpoint || sdk) {
    return;
  }

  const base = endpoint.replace(/\/+$/, '');
  const resource = defaultResource().merge(
    resourceFromAttributes({
      [ATTR_SERVICE_NAME]: process.env.OTEL_SERVICE_NAME ?? 'observatory-server',
      [ATTR_SERVICE_VERSION]: process.env.npm_package_version ?? '0.0.0',
      [ATTR_DEPLOYMENT_ENVIRONMENT]: process.env.NODE_ENV ?? 'development',
    }),
  );

  sdk = new NodeSDK({
    resource,
    traceExporter: new OTLPTraceExporter({ url: `${base}/v1/traces` }),
    logRecordProcessors: [
      new logs.BatchLogRecordProcessor({
        exporter: new OTLPLogExporter({ url: `${base}/v1/logs` }),
      }),
    ],
    metricReaders: [
      new metrics.PeriodicExportingMetricReader({
        exporter: new OTLPMetricExporter({ url: `${base}/v1/metrics` }),
        exportIntervalMillis: METRIC_EXPORT_INTERVAL_MS,
      }),
    ],
    instrumentations: [
      new HttpInstrumentation(),
      new ExpressInstrumentation(),
      new NestInstrumentation(),
      new PgInstrumentation(),
      new IORedisInstrumentation(),
      new RuntimeNodeInstrumentation(),
    ],
  });

  sdk.start();
}

export async function stopOtel(): Promise<void> {
  if (!sdk) {
    return;
  }
  await sdk.shutdown().catch(() => undefined);
  sdk = undefined;
}
