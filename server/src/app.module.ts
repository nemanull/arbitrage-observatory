import { BullModule, type BullRootModuleOptions } from '@nestjs/bullmq';
import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { BullMQOtel } from 'bullmq-otel';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './db/prisma';
import {
  OpportunityWorker,
  OPPORTUNITY_CLOSED_QUEUE,
} from './engine/OpportunityWorker';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    BullModule.forRootAsync({
      imports: [ConfigModule],
      inject: [ConfigService],
      useFactory: (configService: ConfigService): BullRootModuleOptions => ({
        connection: {
          url: configService.getOrThrow<string>('REDIS_URL'),
        },
        telemetry: new BullMQOtel('observatory-queue'),
      }),
    }),
    BullModule.registerQueue({
      name: OPPORTUNITY_CLOSED_QUEUE,
      defaultJobOptions: {
        attempts: 5,
        backoff: { type: 'exponential', delay: 1_000 },
      },
    }),
  ],
  controllers: [AppController],
  providers: [AppService, PrismaService, OpportunityWorker],
})
export class AppModule {}
