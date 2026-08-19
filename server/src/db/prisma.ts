import { Injectable, type OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

export type Db = PrismaClient;

// Prisma 7 reaches Postgres through a driver adapter, so the connection pool is built here
// rather than declared in schema.prisma.
export function createPrismaClient(connectionString: string): Db {
  return new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
}

@Injectable()
export class PrismaService implements OnModuleDestroy {
  readonly client: Db;

  constructor(configService: ConfigService) {
    this.client = createPrismaClient(
      configService.getOrThrow<string>('DATABASE_URL'),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.client.$disconnect();
  }
}
