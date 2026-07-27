import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

const PORT = process.env.PORT ?? 3000;

/**
 * Creates the Nest application and starts the HTTP listener.
 * The logger is given a context so the startup line is tagged [Bootstrap].
 */
async function bootstrap(): Promise<void> {
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule);
  await app.listen(PORT);

  logger.log(`Server is running on http://localhost:${PORT}`);
}

void bootstrap();
