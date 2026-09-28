import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/cluster/types';
import type { AnchorMap } from '../../feeds/anchor/types';
import { HttpStatusError } from '../../shared/errors';
import { BitstampAnchorPoller } from './anchor';

const VENUE_ID = 'bitstamp';

// One second after the tickers below were republished.
const ARRIVAL = 1_789_505_678_000;

type Probe = {
  intervalMs: number;
  fetchRound(ts: number, signal: AbortSignal): Promise<AnchorMap>;
};

function market(rawMarketId: string): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.slice(0, rawMarketId.indexOf('usd')).toUpperCase(),
    quote: 'USD',
    takerPpm: 150,
    linear: true,
    contractSize: 1,
  };
}

// Rows captured live on 2026-09-15, cut down to the fields the poller reads plus a few it ignores.
const BTC_SPOT = {
  timestamp: '1789505677',
  last: '75906.23',
  bid: '75906.22',
  ask: '75906.23',
  market_type: 'SPOT',
  pair: 'BTC/USD',
  market: 'BTC/USD',
};

const ETH_PERP = {
  timestamp: '1789505677',
  last: '2407.6',
  market_type: 'PERPETUAL',
  pair: 'ETH/USD-PERP',
  market: 'ETH/USD-PERP',
  index_price: '2407.3460000000005',
  mark_price: '2408.04888561',
  open_interest: '1786.142',
};

const ASTER_PERP = {
  timestamp: '1789505677',
  last: '0.67510',
  market_type: 'PERPETUAL',
  pair: 'ASTER/USD-PERP',
  market: 'ASTER/USD-PERP',
  index_price: '0.6763',
  mark_price: '0.67689281',
  open_interest: '712841',
};

const BTC_PERP = {
  timestamp: '1789505352',
  market_type: 'PERPETUAL',
  pair: 'BTC/USD-PERP',
  market: 'BTC/USD-PERP',
  index_price: '75871.12066666665',
  mark_price: '75895.30133771',
};

const TICKERS = [BTC_SPOT, ETH_PERP, ASTER_PERP, BTC_PERP];

const TICKER_URL = 'https://www.bitstamp.net/api/v2/ticker/';

function fundingUrl(rawMarketId: string): string {
  return `https://www.bitstamp.net/api/v2/funding_rate/${rawMarketId}/`;
}

function funding(market: string, rate: string) {
  return {
    funding_rate: rate,
    timestamp: '1789505678',
    market,
    next_funding_time: '1789516800',
  };
}

const FUNDING: Record<string, unknown> = {
  [fundingUrl('ethusd-perp')]: funding('ETH/USD-PERP', '0.000026'),
  [fundingUrl('asterusd-perp')]: funding('ASTER/USD-PERP', '0.00001'),
  [fundingUrl('btcusd-perp')]: funding('BTC/USD-PERP', '0.000253'),
};

function makePoller(markets: Market[], replies: Record<string, unknown>) {
  const venue: Venue = { id: VENUE_ID, name: 'Bitstamp', markets };
  const engine = { updateAnchor: jest.fn() } as unknown as Engine;
  const poller = new BitstampAnchorPoller(venue, engine);
  const getJson = jest
    .spyOn(
      poller as unknown as { getJson: (url: string) => Promise<unknown> },
      'getJson',
    )
    .mockImplementation((url: string) => {
      const body = replies[url];
      return body === undefined
        ? Promise.reject(new HttpStatusError(url, 404, null))
        : Promise.resolve(body);
    });

  return { poller: poller as unknown as Probe, getJson };
}

const signal = new AbortController().signal;

beforeEach(() => {
  jest.spyOn(Date, 'now').mockReturnValue(ARRIVAL);
});

afterEach(() => jest.restoreAllMocks());

describe('BitstampAnchorPoller', () => {
  it('polls every second', () => {
    const { poller } = makePoller([market('ethusd-perp')], {});

    expect(poller.intervalMs).toBe(1_000);
  });
});

describe('BitstampAnchorPoller.fetchRound', () => {
  it('maps a perpetual ticker onto the id the socket uses, with funding from its own call', async () => {
    const { poller } = makePoller([market('ethusd-perp')], {
      [TICKER_URL]: TICKERS,
      ...FUNDING,
    });

    const rows = await poller.fetchRound(ARRIVAL, signal);

    expect(rows.get('ethusd-perp')).toEqual({
      index: 2407.3460000000005,
      mark: 2408.04888561,
      fundingRate: 0.000026,
      fundingIntervalHours: 8,
      nextFundingAt: 1_789_516_800_000,
      ts: 1_789_505_677_000,
    });
  });

  it('ignores spot rows that share the ticker reply', async () => {
    const { poller } = makePoller([market('ethusd-perp')], {
      [TICKER_URL]: TICKERS,
      ...FUNDING,
    });

    const rows = await poller.fetchRound(ARRIVAL, signal);

    expect([...rows.keys()]).toEqual(['ethusd-perp']);
  });

  it('reads one funding market per round in rotation and writes a market only once its funding landed', async () => {
    const { poller, getJson } = makePoller(
      [market('ethusd-perp'), market('asterusd-perp'), market('btcusd-perp')],
      { [TICKER_URL]: TICKERS, ...FUNDING },
    );

    const first = await poller.fetchRound(ARRIVAL, signal);
    const second = await poller.fetchRound(ARRIVAL, signal);
    const third = await poller.fetchRound(ARRIVAL, signal);
    await poller.fetchRound(ARRIVAL, signal);

    expect([...first.keys()]).toEqual(['ethusd-perp']);
    expect([...second.keys()]).toEqual(['ethusd-perp', 'asterusd-perp']);
    expect([...third.keys()].sort()).toEqual([
      'asterusd-perp',
      'btcusd-perp',
      'ethusd-perp',
    ]);
    expect(
      getJson.mock.calls.map((c) => c[0]).filter((url) => url !== TICKER_URL),
    ).toEqual([
      fundingUrl('ethusd-perp'),
      fundingUrl('asterusd-perp'),
      fundingUrl('btcusd-perp'),
      fundingUrl('ethusd-perp'),
    ]);
  });

  it('stamps a row with the ticker second, capped at the reply arrival', async () => {
    // The clock trails the venue by two seconds, so the ticker second lies ahead of arrival.
    const early = 1_789_505_675_500;
    jest.spyOn(Date, 'now').mockReturnValue(early);
    const { poller } = makePoller(
      [market('ethusd-perp'), market('btcusd-perp')],
      { [TICKER_URL]: TICKERS, ...FUNDING },
    );

    await poller.fetchRound(early, signal);
    const rows = await poller.fetchRound(early, signal);

    expect(rows.get('ethusd-perp')?.ts).toBe(early);
    expect(rows.get('btcusd-perp')?.ts).toBe(1_789_505_352_000);
  });

  it('leaves out a market whose funding call fails, logs it once and keeps the round', async () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { poller } = makePoller(
      [market('ethusd-perp'), market('asterusd-perp')],
      {
        [TICKER_URL]: TICKERS,
        [fundingUrl('ethusd-perp')]: FUNDING[fundingUrl('ethusd-perp')],
      },
    );

    for (let i = 0; i < 4; i++) {
      const rows = await poller.fetchRound(ARRIVAL, signal);
      expect([...rows.keys()]).toEqual(['ethusd-perp']);
    }

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      `funding read for asterusd-perp failed: 404 from ${fundingUrl('asterusd-perp')}`,
    );
  });

  it('fails the round when the ticker call fails', async () => {
    const { poller } = makePoller([market('ethusd-perp')], FUNDING);

    await expect(poller.fetchRound(ARRIVAL, signal)).rejects.toThrow(
      `404 from ${TICKER_URL}`,
    );
  });
});
