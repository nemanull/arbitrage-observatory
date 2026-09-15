import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/cluster/types';
import type { AnchorMap } from '../../feeds/anchor/types';
import { GateAnchorPoller } from './anchor';

const VENUE_ID = 'gate';
const T0 = 1_789_505_584_421;

type Probe = {
  intervalMs: number;
  rateLimitPauseMs: number;
  fetchRound(ts: number, signal: AbortSignal): Promise<AnchorMap>;
};

function market(rawMarketId: string): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.slice(0, rawMarketId.indexOf('_')),
    quote: 'USDT',
    takerPpm: 500,
    linear: true,
    contractSize: 0.0001,
  };
}

// Rows captured live on 2026-09-15, cut down to the fields the poller reads plus a few it ignores.
const BTC_CONTRACT = {
  name: 'BTC_USDT',
  type: 'direct',
  quanto_multiplier: '0.0001',
  status: 'trading',
  is_pre_market: false,
  in_delisting: false,
  index_price: '75937.25',
  mark_price: '75913.6',
  last_price: '75913.5',
  funding_rate: '0.000014',
  funding_interval: 28800,
  funding_next_apply: 1789516800,
  maker_fee_rate: '-0.0001',
  taker_fee_rate: '0.00075',
};

const IOST_CONTRACT = {
  name: 'IOST_USDT',
  status: 'trading',
  is_pre_market: false,
  index_price: '0.000741',
  mark_price: '0.000738',
  funding_rate: '-0.000161',
  funding_interval: 3600,
  funding_next_apply: 1789506000,
};

const ANDURIL_PRE_MARKET = {
  name: 'ANDURIL_USDT',
  status: 'trading',
  is_pre_market: true,
  index_price: '125.49',
  mark_price: '125.49',
  funding_rate: '0',
  funding_interval: 28800,
  funding_next_apply: 1789516800,
};

// Every contract read trading on 2026-09-15, so this row is the BTC capture with a documented non trading status.
const DELISTING_CONTRACT = {
  ...BTC_CONTRACT,
  name: 'OLD_USDT',
  status: 'delisting',
};

const CONTRACTS_URL = 'https://api.gateio.ws/api/v4/futures/usdt/contracts';

function makePoller(markets: Market[], body: unknown) {
  const venue: Venue = { id: VENUE_ID, name: 'Gate', markets };
  const engine = { updateAnchor: jest.fn() } as unknown as Engine;
  const poller = new GateAnchorPoller(venue, engine);
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

describe('GateAnchorPoller', () => {
  it('polls every second and pauses for one ten second window on a rate limit', () => {
    const { poller } = makePoller([market('BTC_USDT')], []);

    expect(poller.intervalMs).toBe(1_000);
    expect(poller.rateLimitPauseMs).toBe(10_000);
  });
});

describe('GateAnchorPoller.fetchRound', () => {
  it('maps a trading contract with its interval in hours and next settlement in ms', async () => {
    const { poller, getJson } = makePoller(
      [market('BTC_USDT'), market('IOST_USDT')],
      [BTC_CONTRACT, IOST_CONTRACT],
    );

    const rows = await poller.fetchRound(T0, signal);

    expect(getJson.mock.calls.map((c) => c[0])).toEqual([CONTRACTS_URL]);
    expect(rows.get('BTC_USDT')).toEqual({
      index: 75937.25,
      mark: 75913.6,
      fundingRate: 0.000014,
      fundingIntervalHours: 8,
      nextFundingAt: 1789516800000,
    });
    expect(rows.get('IOST_USDT')?.fundingIntervalHours).toBe(1);
    expect(rows.get('IOST_USDT')?.nextFundingAt).toBe(1789506000000);
  });

  it('leaves out a pre market contract and a contract that is not trading', async () => {
    const { poller } = makePoller(
      [market('BTC_USDT')],
      [ANDURIL_PRE_MARKET, DELISTING_CONTRACT, BTC_CONTRACT],
    );

    const rows = await poller.fetchRound(T0, signal);

    expect([...rows.keys()]).toEqual(['BTC_USDT']);
  });
});
