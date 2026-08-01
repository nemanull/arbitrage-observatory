import {
  getSharedConfigToken,
  type BullRootModuleOptions,
} from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';

describe('AppModule', () => {
  const redisUrl = 'redis://queue-user:queue-password@redis.example:6380/4';
  const originalRedisUrl = process.env.REDIS_URL;

  beforeEach(() => {
    process.env.REDIS_URL = redisUrl;
  });

  afterEach(() => {
    if (originalRedisUrl === undefined) {
      delete process.env.REDIS_URL;
      return;
    }

    process.env.REDIS_URL = originalRedisUrl;
  });

  it('registers REDIS_URL as the shared BullMQ connection', async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    try {
      const bullOptions = moduleRef.get<BullRootModuleOptions>(
        getSharedConfigToken(),
      );

      expect(bullOptions.connection).toMatchObject({ url: redisUrl });
    } finally {
      await moduleRef.close();
    }
  });

  it('rejects initialization when REDIS_URL is missing', async () => {
    delete process.env.REDIS_URL;

    await expect(
      Test.createTestingModule({
        imports: [AppModule],
      }).compile(),
    ).rejects.toThrow('Configuration key "REDIS_URL" does not exist');
  });
});
