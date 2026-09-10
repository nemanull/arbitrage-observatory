import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/types';
import type { AnchorRows } from '../../feeds/anchor/types';
import { BybitAnchorPoller } from './anchor';

const VENUE_ID = 'bybit';
const T0 = 1_789_015_942_967;

type Probe = {
  intervalMs: number;
  rateLimitPauseMs: number;
  fetchRound(ts: number, signal: AbortSignal): Promise<AnchorRows>;
};

function market(rawMarketId: string, linear = true): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.slice(0, 3),
    quote: linear ? 'USDT' : 'USD',
    takerPpm: 550,
    linear,
    contractSize: 1,
  };
}

// Shapes captured live on 2026-09-10, cut down to the fields the poller reads plus a few it ignores.
const SOPH_TICKER = {
  symbol: 'SOPHUSDT',
  lastPrice: '0.004129',
  indexPrice: '0.004148',
  markPrice: '0.004136',
  fundingRate: '-0.00102581',
  nextFundingTime: '1789027200000',
  bid1Price: '0.004128',
  ask1Price: '0.004131',
  fundingIntervalHour: '4',
  fundingCap: '0.02',
};

const DATED_TICKER = {
  symbol: 'BTCUSDT-11SEP26',
  indexPrice: '78320.7',
  markPrice: '78302.8',
  fundingRate: '',
  nextFundingTime: '0',
  fundingIntervalHour: '',
  fundingCap: '',
};

const BTC_INVERSE_TICKER = {
  symbol: 'BTCUSD',
  indexPrice: '78151.67',
  markPrice: '78110.19',
  fundingRate: '0.00005986',
  nextFundingTime: '1789027200000',
  fundingIntervalHour: '8',
  fundingCap: '0.005',
};

function reply(category: string, list: unknown[], retCode = 0) {
  return {
    retCode,
    retMsg: retCode === 0 ? 'OK' : 'params error',
    result: { category, list },
    time: T0,
  };
}

function makePoller(markets: Market[], replies: Record<string, unknown>) {
  const venue: Venue = { id: VENUE_ID, name: 'Bybit', markets };
  const engine = { updateAnchor: jest.fn() } as unknown as Engine;
  const poller = new BybitAnchorPoller(venue, engine);
  const getJson = jest
    .spyOn(
      poller as unknown as { getJson: (url: string) => Promise<unknown> },
      'getJson',
    )
    .mockImplementation((url: string) => {
      const body = replies[url];
      return body === undefined
        ? Promise.reject(new Error(`unexpected ${url}`))
        : Promise.resolve(body);
    });

  return { poller: poller as unknown as Probe, getJson };
}

const LINEAR_URL = 'https://api.bybit.com/v5/market/tickers?category=linear';
const INVERSE_URL = 'https://api.bybit.com/v5/market/tickers?category=inverse';

const signal = new AbortController().signal;

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('BybitAnchorPoller', () => {
  it('polls every two seconds and pauses ten minutes on a rate limit', () => {
    const { poller } = makePoller([market('SOPHUSDT')], {});

    expect(poller.intervalMs).toBe(2_000);
    expect(poller.rateLimitPauseMs).toBe(10 * 60 * 1000);
  });
});

describe('BybitAnchorPoller.fetchRound', () => {
  it('maps a linear ticker with the interval and next settlement it carries', async () => {
    const { poller } = makePoller([market('SOPHUSDT')], {
      [LINEAR_URL]: reply('linear', [SOPH_TICKER]),
    });

    const rows = await poller.fetchRound(T0, signal);

    expect(rows.get('SOPHUSDT')).toEqual({
      index: 0.004148,
      mark: 0.004136,
      fundingRate: -0.00102581,
      fundingIntervalHours: 4,
      nextFundingAt: 1789027200000,
    });
  });

  it('leaves out the dated futures that share the reply', async () => {
    const { poller } = makePoller([market('SOPHUSDT')], {
      [LINEAR_URL]: reply('linear', [DATED_TICKER, SOPH_TICKER]),
    });

    const rows = await poller.fetchRound(T0, signal);

    expect([...rows.keys()]).toEqual(['SOPHUSDT']);
  });

  it('calls the inverse family only when an inverse market is tracked', async () => {
    const linearOnly = makePoller([market('SOPHUSDT')], {
      [LINEAR_URL]: reply('linear', [SOPH_TICKER]),
    });
    await linearOnly.poller.fetchRound(T0, signal);
    expect(linearOnly.getJson.mock.calls.map((c) => c[0])).toEqual([
      LINEAR_URL,
    ]);

    const both = makePoller([market('SOPHUSDT'), market('BTCUSD', false)], {
      [LINEAR_URL]: reply('linear', [SOPH_TICKER]),
      [INVERSE_URL]: reply('inverse', [BTC_INVERSE_TICKER]),
    });
    const rows = await both.poller.fetchRound(T0, signal);
    expect(both.getJson.mock.calls.map((c) => c[0])).toEqual([
      LINEAR_URL,
      INVERSE_URL,
    ]);
    expect(rows.get('BTCUSD')?.fundingIntervalHours).toBe(8);
  });

  it('fails the round on a venue error code', async () => {
    const { poller } = makePoller([market('SOPHUSDT')], {
      [LINEAR_URL]: reply('linear', [], 10001),
    });

    await expect(poller.fetchRound(T0, signal)).rejects.toThrow(
      'retCode 10001',
    );
  });
});
