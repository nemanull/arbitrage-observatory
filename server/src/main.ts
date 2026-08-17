import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import dotenv from 'dotenv';
import { AppModule } from './app.module';

async function bootstrap(): Promise<void> {
  dotenv.config();

  const port = process.env.PORT ?? 3000;
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  await app.listen(port);

  logger.log(`Server is running on http://localhost:${port}`);
}

void bootstrap();
