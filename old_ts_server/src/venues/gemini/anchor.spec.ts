import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/cluster/types';
import type { AnchorMap } from '../../feeds/anchor/types';
import { HttpStatusError } from '../../shared/errors';
import { GeminiAnchorPoller } from './anchor';

const VENUE_ID = 'gemini';

// 20:49 UTC on 2026-09-15, between the 20:00 and 21:00 settlements of the replies below.
const T0 = 1_789_505_369_257;
const LAST_SETTLEMENT = 1_789_502_400_000;
const NEXT_SETTLEMENT = 1_789_506_000_000;

type Probe = {
  intervalMs: number;
  fetchRound(ts: number, signal: AbortSignal): Promise<AnchorMap>;
};

function market(rawMarketId: string): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.slice(0, rawMarketId.indexOf('usdc')).toUpperCase(),
    quote: 'USDC',
    takerPpm: 700,
    linear: true,
    contractSize: 1,
  };
}

// Replies captured live on 2026-09-15.
const BTC_RISK = {
  product_type: 'PerpetualSwapContract',
  mark_price: '75923.455',
  index_price: '75881.41733',
  open_interest: '18.5719',
  open_interest_notional: '1410042.8138',
};

const ETH_RISK = {
  product_type: 'PerpetualSwapContract',
  mark_price: '2407.3303',
  index_price: '2406.124',
  open_interest: '117.044',
  open_interest_notional: '281763.5675',
};

function fundingReply(
  symbol: string,
  estimate: number,
  next = NEXT_SETTLEMENT,
) {
  return {
    symbol,
    fundingDateTime: '2026-09-15T20:00:00.000Z',
    fundingTimestampMilliSecs: LAST_SETTLEMENT,
    nextFundingTimestamp: next,
    fundingAmount: 4.09585,
    estimatedFundingAmount: estimate,
  };
}

const RISK_URL = 'https://api.gemini.com/v1/riskstats/';
const FUNDING_URL = 'https://api.gemini.com/v1/fundingamount/';

// A reply is a body, or a function of the URL for a request that fails or never answers.
function makePoller(markets: Market[], replies: Record<string, unknown>) {
  const venue: Venue = { id: VENUE_ID, name: 'Gemini', markets };
  const engine = { updateAnchor: jest.fn() } as unknown as Engine;
  const poller = new GeminiAnchorPoller(venue, engine);
  const getJson = jest
    .spyOn(
      poller as unknown as { getJson: (url: string) => Promise<unknown> },
      'getJson',
    )
    .mockImplementation((url: string) => {
      const reply = replies[url];
      if (typeof reply === 'function') {
        return (reply as (url: string) => Promise<unknown>)(url);
      }
      return reply === undefined
        ? Promise.reject(new HttpStatusError(url, 404, null))
        : Promise.resolve(reply);
    });

  const fundingCalls = () =>
    getJson.mock.calls
      .map((c) => c[0])
      .filter((url) => url.startsWith(FUNDING_URL))
      .map((url) => url.slice(FUNDING_URL.length));

  return { poller: poller as unknown as Probe, getJson, fundingCalls };
}

const signal = new AbortController().signal;
const settle = () => new Promise((resolve) => setImmediate(resolve));

let now = T0;

beforeEach(() => {
  now = T0;
  jest.spyOn(Date, 'now').mockImplementation(() => now);
  jest.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

// Rounds until every market holds a funding reading, one refresh per round, 4 s apart.
async function warmUp(poller: Probe, rounds: number): Promise<void> {
  for (let i = 0; i < rounds; i++) {
    await poller.fetchRound(now, signal);
    await settle();
    now += 4_000;
  }
}

const BOTH = {
  [`${RISK_URL}btcusdcperp`]: BTC_RISK,
  [`${RISK_URL}ethusdcperp`]: ETH_RISK,
  [`${FUNDING_URL}btcusdcperp`]: fundingReply('btcusdcperp', 4.47479),
  [`${FUNDING_URL}ethusdcperp`]: fundingReply('ethusdcperp', 0.06128),
};

describe('GeminiAnchorPoller.intervalMs', () => {
  it('keeps riskstats under 90 requests a minute with a floor of three seconds', () => {
    const six = Array.from({ length: 6 }, (_, i) => market(`c${i}usdcperp`));

    expect(makePoller(six, {}).poller.intervalMs).toBe(4_000);
    expect(
      makePoller([market('btcusdcperp'), market('ethusdcperp')], {}).poller
        .intervalMs,
    ).toBe(3_000);
  });
});

describe('GeminiAnchorPoller.fetchRound', () => {
  it('leaves a market out until its funding lands, then maps the amount over the mark', async () => {
    const { poller, fundingCalls } = makePoller(
      [market('btcusdcperp'), market('ethusdcperp')],
      BOTH,
    );

    const first = await poller.fetchRound(now, signal);
    expect(first.size).toBe(0);
    expect(fundingCalls()).toEqual(['btcusdcperp']);

    await settle();
    now += 4_000;
    const second = await poller.fetchRound(now, signal);

    expect([...second.keys()]).toEqual(['btcusdcperp']);
    expect(second.get('btcusdcperp')).toEqual({
      index: 75881.41733,
      mark: 75923.455,
      fundingRate: 4.47479 / 75923.455,
      fundingIntervalHours: 1,
      nextFundingAt: NEXT_SETTLEMENT,
      ts: now,
    });
    expect(fundingCalls()).toEqual(['btcusdcperp', 'ethusdcperp']);
  });

  it('stamps each row with its own reply arrival', async () => {
    const release: Record<string, (body: unknown) => void> = {};
    const deferred = (url: string) =>
      new Promise((resolve) => (release[url] = resolve));
    const { poller, getJson } = makePoller(
      [market('btcusdcperp'), market('ethusdcperp')],
      BOTH,
    );
    await warmUp(poller, 2);
    getJson.mockImplementation(deferred);

    const round = poller.fetchRound(now, signal);
    now += 100;
    release[`${RISK_URL}btcusdcperp`](BTC_RISK);
    await settle();
    now += 800;
    release[`${RISK_URL}ethusdcperp`](ETH_RISK);
    const rows = await round;

    expect(rows.get('btcusdcperp')?.ts).toBe(T0 + 8_000 + 100);
    expect(rows.get('ethusdcperp')?.ts).toBe(T0 + 8_000 + 900);
  });

  it('leaves out a market whose riskstats failed and writes the rest', async () => {
    const { poller, getJson } = makePoller(
      [market('btcusdcperp'), market('ethusdcperp')],
      BOTH,
    );
    await warmUp(poller, 2);
    getJson.mockImplementation((url: string) =>
      url === `${RISK_URL}btcusdcperp`
        ? Promise.reject(new HttpStatusError(url, 500, null))
        : Promise.resolve(ETH_RISK),
    );

    const rows = await poller.fetchRound(now, signal);

    expect([...rows.keys()]).toEqual(['ethusdcperp']);
  });

  it('rethrows the first error when every riskstats request failed', async () => {
    const rateLimited = (url: string) =>
      Promise.reject(new HttpStatusError(url, 429, null));
    const { poller, fundingCalls } = makePoller(
      [market('btcusdcperp'), market('ethusdcperp')],
      {
        [`${RISK_URL}btcusdcperp`]: rateLimited,
        [`${RISK_URL}ethusdcperp`]: rateLimited,
      },
    );

    const error = await poller.fetchRound(now, signal).catch((e: unknown) => e);

    expect(error).toBeInstanceOf(HttpStatusError);
    expect((error as HttpStatusError).rateLimited).toBe(true);
    expect((error as HttpStatusError).url).toBe(`${RISK_URL}btcusdcperp`);
    expect(fundingCalls()).toEqual([]);
  });

  it('keeps one funding request in flight at most', async () => {
    const { poller, fundingCalls } = makePoller(
      [market('btcusdcperp'), market('ethusdcperp')],
      {
        ...BOTH,
        [`${FUNDING_URL}btcusdcperp`]: () => new Promise(() => undefined),
      },
    );

    await warmUp(poller, 3);

    expect(fundingCalls()).toEqual(['btcusdcperp']);
  });

  it('refreshes the oldest reading once it is older than a minute', async () => {
    const { poller, fundingCalls } = makePoller(
      [market('btcusdcperp'), market('ethusdcperp')],
      BOTH,
    );
    await warmUp(poller, 2);

    // Both readings are fresh, so the next rounds read no funding.
    await warmUp(poller, 10);
    expect(fundingCalls()).toEqual(['btcusdcperp', 'ethusdcperp']);

    now = T0 + 61_000;
    await poller.fetchRound(now, signal);

    expect(fundingCalls()).toEqual([
      'btcusdcperp',
      'ethusdcperp',
      'btcusdcperp',
    ]);
  });

  it('leaves out and refreshes a reading whose next settlement has passed', async () => {
    const { poller, fundingCalls } = makePoller(
      [market('btcusdcperp'), market('ethusdcperp')],
      {
        ...BOTH,
        [`${FUNDING_URL}ethusdcperp`]: fundingReply(
          'ethusdcperp',
          0.06128,
          T0 + 10_000,
        ),
      },
    );
    await warmUp(poller, 2);

    now = T0 + 12_000;
    const rows = await poller.fetchRound(now, signal);

    expect([...rows.keys()]).toEqual(['btcusdcperp']);
    expect(fundingCalls()).toEqual([
      'btcusdcperp',
      'ethusdcperp',
      'ethusdcperp',
    ]);
  });

  it('logs a failed funding request and moves on to the next market', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { poller, fundingCalls } = makePoller(
      [market('btcusdcperp'), market('ethusdcperp')],
      {
        [`${RISK_URL}btcusdcperp`]: BTC_RISK,
        [`${RISK_URL}ethusdcperp`]: ETH_RISK,
        [`${FUNDING_URL}ethusdcperp`]: fundingReply('ethusdcperp', 0.06128),
      },
    );

    await warmUp(poller, 3);

    expect(fundingCalls()).toEqual([
      'btcusdcperp',
      'ethusdcperp',
      'btcusdcperp',
    ]);
    expect(warn).toHaveBeenCalledWith(
      `funding read for btcusdcperp failed: 404 from ${FUNDING_URL}btcusdcperp`,
    );
  });
});
