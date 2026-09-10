import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/types';
import type { AnchorRows } from '../../feeds/anchor/types';
import { BinanceAnchorPoller } from './anchor';

const VENUE_ID = 'binance';
const T0 = 1_789_015_935_000;

type Probe = {
  fetchRound(ts: number, signal: AbortSignal): Promise<AnchorRows>;
};

function market(rawMarketId: string, linear = true): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.slice(0, 3),
    quote: linear ? 'USDT' : 'USD',
    takerPpm: 500,
    linear,
    contractSize: 1,
  };
}

// Shapes captured live on 2026-09-10.
const SOPH_PREMIUM = {
  symbol: 'SOPHUSDT',
  markPrice: '0.00412731',
  indexPrice: '0.00414811',
  estimatedSettlePrice: '0.00424294',
  lastFundingRate: '-0.00030909',
  interestRate: '0.00010000',
  nextFundingTime: 1789016400000,
  time: 1789015935000,
};

const BTC_PREMIUM = {
  ...SOPH_PREMIUM,
  symbol: 'BTCUSDT',
  markPrice: '79150.26',
  indexPrice: '79182.32',
  lastFundingRate: '0.00010000',
  nextFundingTime: 1789027200000,
};

const AAVE_COIN_M = {
  symbol: 'AAVEUSD_PERP',
  pair: 'AAVEUSD',
  markPrice: '124.26148470',
  indexPrice: '124.37839774',
  estimatedSettlePrice: '124.62477498',
  lastFundingRate: '0.00001125',
  interestRate: '0.00010000',
  nextFundingTime: 1789027200000,
  time: 1789022136000,
};

const SOPH_FUNDING_INFO = {
  symbol: 'SOPHUSDT',
  adjustedFundingRateCap: '0.02000000',
  adjustedFundingRateFloor: '-0.02000000',
  fundingIntervalHours: 1,
  disclaimer: false,
  updateTime: 1788868860638,
};

function makePoller(markets: Market[], replies: Record<string, unknown>) {
  const venue: Venue = { id: VENUE_ID, name: 'Binance', markets };
  const engine = { updateAnchor: jest.fn() } as unknown as Engine;
  const poller = new BinanceAnchorPoller(venue, engine);
  const getJson = jest
    .spyOn(
      poller as unknown as { getJson: (url: string) => Promise<unknown> },
      'getJson',
    )
    .mockImplementation((url: string) => {
      const reply = replies[url];
      return reply === undefined
        ? Promise.reject(new Error(`unexpected ${url}`))
        : Promise.resolve(reply);
    });

  return { poller: poller as unknown as Probe, getJson };
}

const PREMIUM_URL = 'https://fapi.binance.com/fapi/v1/premiumIndex';
const COIN_M_PREMIUM_URL = 'https://dapi.binance.com/dapi/v1/premiumIndex';
const FUNDING_INFO_URL = 'https://fapi.binance.com/fapi/v1/fundingInfo';

const signal = new AbortController().signal;

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('BinanceAnchorPoller.fetchRound', () => {
  it('maps a premiumIndex row and takes the interval from fundingInfo', async () => {
    const { poller } = makePoller([market('SOPHUSDT'), market('BTCUSDT')], {
      [FUNDING_INFO_URL]: [SOPH_FUNDING_INFO],
      [PREMIUM_URL]: [SOPH_PREMIUM, BTC_PREMIUM],
    });

    const rows = await poller.fetchRound(T0, signal);

    expect(rows.get('SOPHUSDT')).toEqual({
      index: 0.00414811,
      mark: 0.00412731,
      fundingRate: -0.00030909,
      fundingIntervalHours: 1,
      nextFundingAt: 1789016400000,
    });
  });

  it('gives a symbol absent from fundingInfo the eight hour default', async () => {
    const { poller } = makePoller([market('SOPHUSDT'), market('BTCUSDT')], {
      [FUNDING_INFO_URL]: [SOPH_FUNDING_INFO],
      [PREMIUM_URL]: [SOPH_PREMIUM, BTC_PREMIUM],
    });

    const rows = await poller.fetchRound(T0, signal);

    expect(rows.get('BTCUSDT')?.fundingIntervalHours).toBe(8);
  });

  it('reads the interval table on the first round and then once an hour', async () => {
    const { poller, getJson } = makePoller([market('SOPHUSDT')], {
      [FUNDING_INFO_URL]: [],
      [PREMIUM_URL]: [SOPH_PREMIUM],
    });

    await poller.fetchRound(T0, signal);
    await poller.fetchRound(T0 + 1_000, signal);
    await poller.fetchRound(T0 + 60 * 60 * 1000, signal);

    expect(getJson.mock.calls.map((c) => c[0])).toEqual([
      FUNDING_INFO_URL,
      PREMIUM_URL,
      PREMIUM_URL,
      FUNDING_INFO_URL,
      PREMIUM_URL,
    ]);
  });

  it('retries the interval table on the next round after it fails', async () => {
    const { poller, getJson } = makePoller([market('SOPHUSDT')], {
      [PREMIUM_URL]: [SOPH_PREMIUM],
    });

    await expect(poller.fetchRound(T0, signal)).rejects.toThrow('unexpected');

    getJson.mockImplementation((url: string) =>
      Promise.resolve(url === FUNDING_INFO_URL ? [] : [SOPH_PREMIUM]),
    );
    const rows = await poller.fetchRound(T0 + 1_000, signal);

    expect(rows.get('SOPHUSDT')?.fundingIntervalHours).toBe(8);
  });

  it('adds the COIN-M host when an inverse market is tracked, at the default interval', async () => {
    const { poller, getJson } = makePoller(
      [market('SOPHUSDT'), market('AAVEUSD_PERP', false)],
      {
        [FUNDING_INFO_URL]: [SOPH_FUNDING_INFO],
        [PREMIUM_URL]: [SOPH_PREMIUM],
        [COIN_M_PREMIUM_URL]: [AAVE_COIN_M],
      },
    );

    const rows = await poller.fetchRound(T0, signal);

    expect(getJson.mock.calls.map((c) => c[0])).toContain(COIN_M_PREMIUM_URL);
    expect(rows.get('AAVEUSD_PERP')).toEqual({
      index: 124.37839774,
      mark: 124.2614847,
      fundingRate: 0.00001125,
      fundingIntervalHours: 8,
      nextFundingAt: 1789027200000,
    });
  });

  it('carries every row the host returns, tracked or not', async () => {
    const { poller } = makePoller([market('SOPHUSDT')], {
      [FUNDING_INFO_URL]: [],
      [PREMIUM_URL]: [SOPH_PREMIUM, BTC_PREMIUM],
    });

    const rows = await poller.fetchRound(T0, signal);

    expect([...rows.keys()]).toEqual(['SOPHUSDT', 'BTCUSDT']);
  });

  it('fails the round when the host fails', async () => {
    const { poller } = makePoller([market('SOPHUSDT')], {
      [FUNDING_INFO_URL]: [],
    });

    await expect(poller.fetchRound(T0, signal)).rejects.toThrow('unexpected');
  });
});
