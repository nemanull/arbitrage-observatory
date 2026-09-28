import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/cluster/types';
import type { AnchorMap } from '../../feeds/anchor/types';
import { BitgetAnchorPoller } from './anchor';

const VENUE_ID = 'bitget';
const T0 = 1_789_456_276_980;

type Probe = {
  intervalMs: number;
  fetchRound(ts: number, signal: AbortSignal): Promise<AnchorMap>;
};

function market(rawMarketId: string, quote = 'USDT'): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.slice(0, 3),
    quote,
    takerPpm: 600,
    linear: true,
    contractSize: 1,
  };
}

// Shapes captured live on 2026-09-15, cut down to the fields the poller reads plus a few it ignores.
const BTC_TICKER = {
  symbol: 'BTCUSDT',
  lastPr: '77202.1',
  askPr: '77202.1',
  bidPr: '77202',
  ts: '1789456276886',
  indexPrice: '77237.976',
  fundingRate: '0.0001',
  markPrice: '77202.1',
};

const BTC_FUNDING = {
  symbol: 'BTCUSDT',
  fundingRate: '0.0001',
  fundingRateInterval: '8',
  nextUpdate: '1789459200000',
  minFundingRate: '-0.003',
  maxFundingRate: '0.003',
};

// MTLUSDT, a 1 hour contract, one second after its 19:00 UTC settlement.
// The rates come from the settlement watch, where the tickers call still carried the settled rate.
const MTL_TICKER = {
  ...BTC_TICKER,
  symbol: 'MTLUSDT',
  indexPrice: '0.2704133333333333',
  markPrice: '0.2689',
  fundingRate: '-0.000457',
};

const MTL_FUNDING = {
  symbol: 'MTLUSDT',
  fundingRate: '-0.000449',
  fundingRateInterval: '1',
  nextUpdate: '1789502400000',
  minFundingRate: '-0.02',
  maxFundingRate: '0.02',
};

// A pre-listing symbol the funding call lists and the tickers call does not.
const PLAY_FUNDING = {
  symbol: 'PLAYUSDT',
  fundingRate: '0.00005',
  fundingRateInterval: '4',
  nextUpdate: '1789516800000',
  minFundingRate: null,
  maxFundingRate: null,
};

const BTC_PERP_TICKER = {
  ...BTC_TICKER,
  symbol: 'BTCPERP',
  indexPrice: '75897.218',
  markPrice: '75862.3',
  fundingRate: '0.00004',
};

const BTC_PERP_FUNDING = {
  ...BTC_FUNDING,
  symbol: 'BTCPERP',
  fundingRate: '0.00004',
};

function reply(data: unknown[], code = '00000') {
  return {
    code,
    msg:
      code === '00000' ? 'success' : 'Parameter NOPE-FUTURES cannot be empty',
    requestTime: T0,
    data,
  };
}

function makePoller(markets: Market[], replies: Record<string, unknown>) {
  const venue: Venue = { id: VENUE_ID, name: 'Bitget', markets };
  const engine = { updateAnchor: jest.fn() } as unknown as Engine;
  const poller = new BitgetAnchorPoller(venue, engine);
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

const USDT_TICKERS_URL =
  'https://api.bitget.com/api/v2/mix/market/tickers?productType=USDT-FUTURES';
const USDT_FUNDING_URL =
  'https://api.bitget.com/api/v2/mix/market/current-fund-rate?productType=USDT-FUTURES';
const USDC_TICKERS_URL =
  'https://api.bitget.com/api/v2/mix/market/tickers?productType=USDC-FUTURES';
const USDC_FUNDING_URL =
  'https://api.bitget.com/api/v2/mix/market/current-fund-rate?productType=USDC-FUTURES';

const signal = new AbortController().signal;

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('BitgetAnchorPoller', () => {
  it('polls every second', () => {
    const { poller } = makePoller([market('BTCUSDT')], {});

    expect(poller.intervalMs).toBe(1_000);
  });
});

describe('BitgetAnchorPoller.fetchRound', () => {
  it('joins index and mark from the tickers with rate, interval and next settlement from the funding call', async () => {
    const { poller } = makePoller([market('BTCUSDT'), market('MTLUSDT')], {
      [USDT_TICKERS_URL]: reply([BTC_TICKER, MTL_TICKER]),
      [USDT_FUNDING_URL]: reply([BTC_FUNDING, MTL_FUNDING]),
    });

    const rows = await poller.fetchRound(T0, signal);

    expect(rows.get('BTCUSDT')).toEqual({
      index: 77237.976,
      mark: 77202.1,
      fundingRate: 0.0001,
      fundingIntervalHours: 8,
      nextFundingAt: 1789459200000,
    });
    expect(rows.get('MTLUSDT')).toEqual({
      index: 0.2704133333333333,
      mark: 0.2689,
      fundingRate: -0.000449,
      fundingIntervalHours: 1,
      nextFundingAt: 1789502400000,
    });
  });

  it('leaves out a symbol that only one of the two replies carries', async () => {
    const { poller } = makePoller([market('BTCUSDT')], {
      [USDT_TICKERS_URL]: reply([BTC_TICKER, MTL_TICKER]),
      [USDT_FUNDING_URL]: reply([PLAY_FUNDING, BTC_FUNDING]),
    });

    const rows = await poller.fetchRound(T0, signal);

    expect([...rows.keys()]).toEqual(['BTCUSDT']);
  });

  it('calls the USDC-M pair only while a USDC market is tracked', async () => {
    const usdtOnly = makePoller([market('BTCUSDT')], {
      [USDT_TICKERS_URL]: reply([BTC_TICKER]),
      [USDT_FUNDING_URL]: reply([BTC_FUNDING]),
    });
    await usdtOnly.poller.fetchRound(T0, signal);
    expect(usdtOnly.getJson.mock.calls.map((c) => c[0])).toEqual([
      USDT_TICKERS_URL,
      USDT_FUNDING_URL,
    ]);

    const both = makePoller([market('BTCUSDT'), market('BTCPERP', 'USDC')], {
      [USDT_TICKERS_URL]: reply([BTC_TICKER]),
      [USDT_FUNDING_URL]: reply([BTC_FUNDING]),
      [USDC_TICKERS_URL]: reply([BTC_PERP_TICKER]),
      [USDC_FUNDING_URL]: reply([BTC_PERP_FUNDING]),
    });
    const rows = await both.poller.fetchRound(T0, signal);
    expect(both.getJson.mock.calls.map((c) => c[0])).toEqual([
      USDT_TICKERS_URL,
      USDT_FUNDING_URL,
      USDC_TICKERS_URL,
      USDC_FUNDING_URL,
    ]);
    expect(rows.get('BTCPERP')?.mark).toBe(75862.3);
  });

  it('fails the round on a code other than 00000', async () => {
    const { poller } = makePoller([market('BTCUSDT')], {
      [USDT_TICKERS_URL]: reply([BTC_TICKER]),
      [USDT_FUNDING_URL]: reply([], '40019'),
    });

    await expect(poller.fetchRound(T0, signal)).rejects.toThrow(
      'current-fund-rate code 40019',
    );
  });
});
