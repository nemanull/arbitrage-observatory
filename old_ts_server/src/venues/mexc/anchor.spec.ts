import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/cluster/types';
import type { AnchorMap } from '../../feeds/anchor/types';
import { RateLimitReplyError } from '../../shared/errors';
import { MexcAnchorPoller } from './anchor';

const VENUE_ID = 'mexc';
const T0 = 1_789_455_551_670;
const FUNDING_URL = 'https://api.mexc.com/api/v1/contract/funding_rate';

type Probe = {
  intervalMs: number;
  rateLimitPauseMs: number;
  fetchRound(ts: number, signal: AbortSignal): Promise<AnchorMap>;
};

function market(rawMarketId: string): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.split('_')[0],
    quote: 'USDT',
    takerPpm: 800,
    linear: true,
    contractSize: 0.0001,
  };
}

// Rows captured live on 2026-09-15, BTC_USDT at 06:59 and RIF_USDT at 20:50 UTC, with the cap and timestamp fields the poller ignores.
const BTC_ROW = {
  symbol: 'BTC_USDT',
  fundingRate: 0.000067,
  maxFundingRate: 0.0018,
  minFundingRate: -0.0018,
  collectCycle: 8,
  nextSettleTime: 1789459200000,
  timestamp: 1789455551670,
  idxPrice: 77271.6,
  fairPrice: 77240.4,
};

const RIF_ROW = {
  symbol: 'RIF_USDT',
  fundingRate: 0.00005,
  maxFundingRate: 0.03,
  minFundingRate: -0.03,
  collectCycle: 4,
  nextSettleTime: 1789516800000,
  timestamp: 1789505423033,
  idxPrice: 0.08181,
  fairPrice: 0.08218,
};

function makePoller(markets: Market[], body: unknown) {
  const venue: Venue = { id: VENUE_ID, name: 'MEXC', markets };
  const engine = { updateAnchor: jest.fn() } as unknown as Engine;
  const poller = new MexcAnchorPoller(venue, engine);
  const getJson = jest
    .spyOn(
      poller as unknown as { getJson: (url: string) => Promise<unknown> },
      'getJson',
    )
    .mockResolvedValue(body);

  return { poller: poller as unknown as Probe, getJson };
}

const signal = new AbortController().signal;

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('MexcAnchorPoller', () => {
  it('polls every second and pauses a minute on a rate limit', () => {
    const { poller } = makePoller([market('BTC_USDT')], {});

    expect(poller.intervalMs).toBe(1_000);
    expect(poller.rateLimitPauseMs).toBe(60_000);
  });
});

describe('MexcAnchorPoller.fetchRound', () => {
  it('maps every row of the one funding call by its symbol', async () => {
    const { poller, getJson } = makePoller([market('BTC_USDT')], {
      success: true,
      code: 0,
      data: [BTC_ROW, RIF_ROW],
    });

    const rows = await poller.fetchRound(T0, signal);

    expect(getJson.mock.calls.map((c) => c[0])).toEqual([FUNDING_URL]);
    expect(rows.get('BTC_USDT')).toEqual({
      index: 77271.6,
      mark: 77240.4,
      fundingRate: 0.000067,
      fundingIntervalHours: 8,
      nextFundingAt: 1789459200000,
    });
    expect(rows.get('RIF_USDT')?.fundingIntervalHours).toBe(4);
  });

  it('fails the round on a reply whose success is false', async () => {
    const { poller } = makePoller([market('NOPE_USDT')], {
      success: false,
      code: 1001,
      message: 'Contract does not exist',
    });

    await expect(poller.fetchRound(T0, signal)).rejects.toThrow(
      'code 1001: Contract does not exist',
    );
  });

  it('fails the round on a nonzero code even when success is true', async () => {
    const { poller } = makePoller([market('BTC_USDT')], {
      success: true,
      code: 2,
      data: [BTC_ROW],
    });

    await expect(poller.fetchRound(T0, signal)).rejects.toThrow('code 2');
  });

  it('raises RateLimitReplyError on code 510 so the base class pauses', async () => {
    const { poller } = makePoller([market('BTC_USDT')], {
      success: false,
      code: 510,
      message: 'Requests are too frequent, please try again later',
    });

    const failure = poller.fetchRound(T0, signal);

    await expect(failure).rejects.toBeInstanceOf(RateLimitReplyError);
    await expect(failure).rejects.toMatchObject({
      code: 510,
      url: FUNDING_URL,
      rateLimited: true,
    });
  });
});
