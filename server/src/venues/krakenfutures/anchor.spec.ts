import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/types';
import type { AnchorRows } from '../../feeds/anchor/types';
import { KrakenFuturesAnchorPoller } from './anchor';

const VENUE_ID = 'krakenfutures';
const T0 = Date.parse('2026-09-10T04:52:40.047Z');
const NEXT_HOUR = Date.parse('2026-09-10T05:00:00.000Z');

type Probe = {
  fetchRound(ts: number, signal: AbortSignal): Promise<AnchorRows>;
};

function market(rawMarketId: string): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.slice(3, 6),
    quote: 'USD',
    takerPpm: 500,
    linear: true,
    contractSize: 1,
  };
}

// Shape captured live on 2026-09-10 at 04:52 UTC.
const XBT_TICKER = {
  symbol: 'PF_XBTUSD',
  last: 78285,
  lastTime: '2026-09-10T04:52:29.08081Z',
  tag: 'perpetual',
  pair: 'XBT:USD',
  markPrice: 78288.74778169378,
  bid: 78291,
  bidSize: 0.0003,
  ask: 78292,
  askSize: 0.2219,
  vol24h: 6338.5123,
  openInterest: 2105.9165,
  fundingRate: 1.444418177964,
  fundingRatePrediction: 1.37670583456525,
  suspended: false,
  indexPrice: 78279.34,
  postOnly: false,
  change24h: -1.1,
};

const DATED_TICKER = {
  symbol: 'FF_XBTUSD_260925',
  tag: 'quarter',
  markPrice: 78500.1,
  indexPrice: 78279.34,
  suspended: false,
};

const UNPRICED_TICKER = {
  symbol: 'PF_NEWUSD',
  tag: 'perpetual',
  suspended: false,
  postOnly: true,
};

function reply(tickers: unknown[], result = 'success') {
  return {
    result,
    error: result === 'success' ? undefined : 'apiLimitExceeded',
    serverTime: '2026-09-10T04:52:40.047Z',
    tickers,
  };
}

function makePoller(markets: Market[], body: unknown) {
  const venue: Venue = { id: VENUE_ID, name: 'Kraken Futures', markets };
  const engine = { updateAnchor: jest.fn() } as unknown as Engine;
  const poller = new KrakenFuturesAnchorPoller(venue, engine);
  jest
    .spyOn(
      poller as unknown as { getJson: (url: string) => Promise<unknown> },
      'getJson',
    )
    .mockResolvedValue(body);

  return poller as unknown as Probe;
}

const signal = new AbortController().signal;

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('KrakenFuturesAnchorPoller.fetchRound', () => {
  it('turns the absolute rate into a fraction of the mark and settles on the next whole hour', async () => {
    const poller = makePoller([market('PF_XBTUSD')], reply([XBT_TICKER]));

    const rows = await poller.fetchRound(T0, signal);

    expect(rows.get('PF_XBTUSD')).toEqual({
      index: 78279.34,
      mark: 78288.74778169378,
      fundingRate: 1.444418177964 / 78288.74778169378,
      fundingIntervalHours: 1,
      nextFundingAt: NEXT_HOUR,
    });
    expect(rows.get('PF_XBTUSD')?.fundingRate).toBeCloseTo(0.0000184499, 10);
  });

  it('leaves out dated contracts and perpetuals the venue has not priced', async () => {
    const poller = makePoller(
      [market('PF_XBTUSD')],
      reply([DATED_TICKER, UNPRICED_TICKER, XBT_TICKER]),
    );

    const rows = await poller.fetchRound(T0, signal);

    expect([...rows.keys()]).toEqual(['PF_XBTUSD']);
  });

  it('fails the round on a venue error', async () => {
    const poller = makePoller([market('PF_XBTUSD')], reply([], 'error'));

    await expect(poller.fetchRound(T0, signal)).rejects.toThrow(
      'apiLimitExceeded',
    );
  });
});
