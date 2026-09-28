import './observability/instrument';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { OtelLogger } from './observability/OtelLogger';
import { stopOtel } from './observability/otel';

async function bootstrap(): Promise<void> {
  const port = process.env.PORT ?? 3000;
  const logger = new Logger('Bootstrap');
  // Buffering holds Nest's own startup lines until the exporting logger is installed.
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  app.useLogger(new OtelLogger());
  app.flushLogs();

  for (const signal of ['SIGINT', 'SIGTERM'] as const) {
    process.once(signal, () => {
      // Close first so the workers stop and log their last lines, then flush what is buffered.
      void app
        .close()
        .catch(() => undefined)
        .then(stopOtel)
        .finally(() => process.exit(0));
    });
  }

  await app.listen(port);

  logger.log(`Server is running on http://localhost:${port}`);
}

// A boot failure must exit nonzero rather than leave a process that listens but streams nothing.
void bootstrap().catch((e: Error) => {
  console.error(e);
  process.exit(1);
});
