import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/cluster/types';
import type { AnchorMap } from '../../feeds/anchor/types';
import { OkxAnchorPoller } from './anchor';

const VENUE_ID = 'okx';
const T0 = 1_789_015_953_991;

type Probe = {
  fetchRound(ts: number, signal: AbortSignal): Promise<AnchorMap>;
};

function market(rawMarketId: string, quote = 'USDT'): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.slice(0, rawMarketId.indexOf('-')),
    quote,
    takerPpm: 500,
    linear: quote !== 'USD',
    contractSize: 1,
  };
}

// Shapes captured live on 2026-09-10.
const SOPH_FUNDING = {
  formulaType: 'withRate',
  fundingRate: '-0.0012630077877366',
  fundingTime: '1789027200000',
  impactValue: '2000.0000000000000000',
  instId: 'SOPH-USDT-SWAP',
  instType: 'SWAP',
  interestRate: '0.0001000000000000',
  maxFundingRate: '0.01',
  method: 'current_period',
  minFundingRate: '-0.01',
  nextFundingRate: '',
  nextFundingTime: '1789041600000',
  premium: '-0.0036170725825898',
  prevFundingTime: '1789012800000',
  settFundingRate: '-0.0013346896995797',
  settState: 'settled',
  ts: '1789015936441',
};

const BTC_USD_FUNDING = {
  ...SOPH_FUNDING,
  instId: 'BTC-USD-SWAP',
  fundingRate: '0.0001',
  fundingTime: '1789027200000',
  nextFundingTime: '1789056000000',
};

// A tradfi instrument that the funding reply lists and the swap mark reply does not.
const XAU_FUNDING = {
  ...SOPH_FUNDING,
  instId: 'XAU-USD_UM_XPERP-310502',
  instType: 'SWAP',
};

const SOPH_MARK = {
  instId: 'SOPH-USDT-SWAP',
  instType: 'SWAP',
  markPx: '0.004128',
  ts: '1789015953991',
};

const BTC_USD_MARK = {
  instId: 'BTC-USD-SWAP',
  instType: 'SWAP',
  markPx: '78290.1',
  ts: '1789015953991',
};

const SOPH_INDEX = {
  instId: 'SOPH-USDT',
  idxPx: '0.004147',
  high24h: '0.00582',
  low24h: '0.003924',
  open24h: '0.005291',
  sodUtc0: '0.004213',
  sodUtc8: '0.004963',
  ts: '1789015952092',
};

const BTC_USD_INDEX = {
  instId: 'BTC-USD',
  idxPx: '78278.5',
  ts: '1789015953095',
};

const SOPH_INSTRUMENT = {
  instId: 'SOPH-USDT-SWAP',
  uly: 'SOPH-USDT',
  instFamily: 'SOPH-USDT',
  settleCcy: 'USDT',
  ctVal: '100',
  state: 'live',
};

const BTC_USD_INSTRUMENT = {
  instId: 'BTC-USD-SWAP',
  uly: 'BTC-USD',
  instFamily: 'BTC-USD',
  settleCcy: 'BTC',
  ctVal: '100',
  state: 'live',
};

const FUNDING_URL = 'https://www.okx.com/api/v5/public/funding-rate?instId=ANY';
const MARK_URL = 'https://www.okx.com/api/v5/public/mark-price?instType=SWAP';
const INDEX_USDT_URL =
  'https://www.okx.com/api/v5/market/index-tickers?quoteCcy=USDT';
const INDEX_USD_URL =
  'https://www.okx.com/api/v5/market/index-tickers?quoteCcy=USD';
const INSTRUMENTS_URL =
  'https://www.okx.com/api/v5/public/instruments?instType=SWAP';

function ok(data: unknown[]) {
  return { code: '0', msg: '', data };
}

function makePoller(markets: Market[], replies: Record<string, unknown>) {
  const venue: Venue = { id: VENUE_ID, name: 'OKX', markets };
  const engine = { updateAnchor: jest.fn() } as unknown as Engine;
  const poller = new OkxAnchorPoller(venue, engine);
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

const signal = new AbortController().signal;

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('OkxAnchorPoller.fetchRound instruments', () => {
  it('asks only for the index quotes the tracked markets settle against', async () => {
    const usdtOnly = makePoller([market('SOPH-USDT-SWAP')], {
      [INSTRUMENTS_URL]: ok([SOPH_INSTRUMENT, BTC_USD_INSTRUMENT]),
      [FUNDING_URL]: ok([SOPH_FUNDING, BTC_USD_FUNDING]),
      [MARK_URL]: ok([SOPH_MARK, BTC_USD_MARK]),
      [INDEX_USDT_URL]: ok([SOPH_INDEX]),
    });

    await usdtOnly.poller.fetchRound(T0, signal);

    const urls = usdtOnly.getJson.mock.calls.map((c) => c[0]);
    expect(urls).toContain(INDEX_USDT_URL);
    expect(urls).not.toContain(INDEX_USD_URL);
  });

  it('reads the table on the first round and then once an hour', async () => {
    const { poller, getJson } = makePoller([market('SOPH-USDT-SWAP')], {
      [INSTRUMENTS_URL]: ok([SOPH_INSTRUMENT]),
      [FUNDING_URL]: ok([SOPH_FUNDING]),
      [MARK_URL]: ok([SOPH_MARK]),
      [INDEX_USDT_URL]: ok([SOPH_INDEX]),
    });

    await poller.fetchRound(T0, signal);
    await poller.fetchRound(T0 + 1_000, signal);
    await poller.fetchRound(T0 + 60 * 60 * 1000, signal);

    const instrumentReads = getJson.mock.calls.filter(
      (c) => c[0] === INSTRUMENTS_URL,
    );
    expect(instrumentReads).toHaveLength(2);
  });

  it('fails the round on a venue error code from the instruments call', async () => {
    const { poller } = makePoller([market('SOPH-USDT-SWAP')], {
      [INSTRUMENTS_URL]: { code: '50011', msg: 'Too Many Requests', data: [] },
    });

    await expect(poller.fetchRound(T0, signal)).rejects.toThrow(
      'instruments code 50011',
    );
  });
});

describe('OkxAnchorPoller.fetchRound', () => {
  it('joins funding, mark and index and derives the interval from the two settlement times', async () => {
    const { poller } = makePoller([market('SOPH-USDT-SWAP')], {
      [INSTRUMENTS_URL]: ok([SOPH_INSTRUMENT]),
      [FUNDING_URL]: ok([SOPH_FUNDING]),
      [MARK_URL]: ok([SOPH_MARK]),
      [INDEX_USDT_URL]: ok([SOPH_INDEX]),
    });

    const rows = await poller.fetchRound(T0, signal);

    expect(rows.get('SOPH-USDT-SWAP')).toEqual({
      index: 0.004147,
      mark: 0.004128,
      fundingRate: -0.0012630077877366,
      fundingIntervalHours: 4,
      nextFundingAt: 1789027200000,
    });
  });

  it('reads an inverse swap through its own USD index', async () => {
    const { poller } = makePoller(
      [market('SOPH-USDT-SWAP'), market('BTC-USD-SWAP', 'USD')],
      {
        [INSTRUMENTS_URL]: ok([SOPH_INSTRUMENT, BTC_USD_INSTRUMENT]),
        [FUNDING_URL]: ok([SOPH_FUNDING, BTC_USD_FUNDING]),
        [MARK_URL]: ok([SOPH_MARK, BTC_USD_MARK]),
        [INDEX_USDT_URL]: ok([SOPH_INDEX]),
        [INDEX_USD_URL]: ok([BTC_USD_INDEX]),
      },
    );

    const rows = await poller.fetchRound(T0, signal);

    expect(rows.get('BTC-USD-SWAP')).toEqual({
      index: 78278.5,
      mark: 78290.1,
      fundingRate: 0.0001,
      fundingIntervalHours: 8,
      nextFundingAt: 1789027200000,
    });
  });

  it('drops a funding row that has no mark, which is how the tradfi instruments fall out', async () => {
    const { poller } = makePoller([market('SOPH-USDT-SWAP')], {
      [INSTRUMENTS_URL]: ok([SOPH_INSTRUMENT]),
      [FUNDING_URL]: ok([XAU_FUNDING, SOPH_FUNDING]),
      [MARK_URL]: ok([SOPH_MARK]),
      [INDEX_USDT_URL]: ok([SOPH_INDEX]),
    });

    const rows = await poller.fetchRound(T0, signal);

    expect([...rows.keys()]).toEqual(['SOPH-USDT-SWAP']);
  });

  it('drops a swap whose index the round did not carry', async () => {
    const { poller } = makePoller([market('SOPH-USDT-SWAP')], {
      [INSTRUMENTS_URL]: ok([SOPH_INSTRUMENT]),
      [FUNDING_URL]: ok([SOPH_FUNDING]),
      [MARK_URL]: ok([SOPH_MARK]),
      [INDEX_USDT_URL]: ok([]),
    });

    const rows = await poller.fetchRound(T0, signal);

    expect(rows.size).toBe(0);
  });

  it('fails the round when one of the three calls returns a venue error', async () => {
    const { poller } = makePoller([market('SOPH-USDT-SWAP')], {
      [INSTRUMENTS_URL]: ok([SOPH_INSTRUMENT]),
      [FUNDING_URL]: ok([SOPH_FUNDING]),
      [MARK_URL]: { code: '50013', msg: 'System busy', data: [] },
      [INDEX_USDT_URL]: ok([SOPH_INDEX]),
    });

    await expect(poller.fetchRound(T0, signal)).rejects.toThrow(
      'mark-price code 50013',
    );
  });
});
