import {
  getQueueToken,
  getSharedConfigToken,
  type BullRootModuleOptions,
} from '@nestjs/bullmq';
import { Test } from '@nestjs/testing';
import { AppModule } from './app.module';
import {
  OpportunityWorker,
  OPPORTUNITY_CLOSED_QUEUE,
} from './engine/opportunity/OpportunityWorker';

// CCXT's CommonJS build reaches an ESM-only dependency, and Jest's runtime cannot require ESM.
// The venue registry only calls into CCXT when a connector is built, which this module test never does.
jest.mock('ccxt', () => ({}));

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
    // The queue and the worker each dial Redis the moment they are constructed.
    // Nest's close does not wait for a dial at an address that does not answer.
    // Stubbing both leaves the shared config, which is the thing under test.
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideProvider(getQueueToken(OPPORTUNITY_CLOSED_QUEUE))
      .useValue({})
      .overrideProvider(OpportunityWorker)
      .useValue({})
      .compile();

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
