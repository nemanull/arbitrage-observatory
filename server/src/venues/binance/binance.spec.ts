import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/types';
import type { EndpointPlan, SingleSocketConnection } from '../../ws/types';
import { BinanceFeed } from './binance';

const VENUE_ID = 'binance';
const TAKER_PPM = 500;

// recvTs must come from the local clock, because openedAt, sampleTs and durationMs are measured on it across every venue.
const LOCAL_NOW = 1_700_000_000_000;
const LEVELS = 20;

type FeedProbe = {
  planEndpoints(): EndpointPlan[];
  getSubscribeFrames(markets: Market[]): object[];
  handleMessage(raw: Buffer, c: SingleSocketConnection): void;
};

function market(rawMarketId: string, linear = true): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.slice(0, 3),
    quote: 'USDT',
    takerPpm: TAKER_PPM,
    linear,
    contractSize: 1,
  };
}

function markets(count: number, linear = true): Market[] {
  return Array.from({ length: count }, (_, i) => market(`SYM${i}USDT`, linear));
}

function makeFeed(venueMarkets: Market[], depthLevels = LEVELS) {
  const updateBook = jest.fn();
  const venue: Venue = { id: VENUE_ID, name: 'Binance', markets: venueMarkets };
  const engine = {
    updateBook,
    markStale: jest.fn(),
    depthLevels,
  } as unknown as Engine;
  const feed = new BinanceFeed(venue, engine) as unknown as FeedProbe;

  return { feed, updateBook };
}

function connection(plan: EndpointPlan): SingleSocketConnection {
  return {
    id: plan.id,
    plan,
    socket: { readyState: 1, OPEN: 1, terminate: jest.fn() },
    accepted: new Set(plan.markets.map((m) => m.rawMarketId)),
    lastMessageAt: 0,
    attempt: 0,
    reopenOnClose: true,
    timers: [],
  } as unknown as SingleSocketConnection;
}

// The shape captured live on 2026-09-07, with the level count cut down.
function depthUpdate(
  symbol: string,
  b: [string, string][],
  a: [string, string][],
): object {
  return {
    e: 'depthUpdate',
    s: symbol,
    U: 11493080425500,
    u: 11493080433094,
    pu: 11493080425283,
    E: 1788746280299,
    T: 1788746280297,
    b,
    a,
  };
}

const BIDS: [string, string][] = [
  ['79909.30', '23.163'],
  ['79909.20', '1.500'],
];
const ASKS: [string, string][] = [
  ['79909.40', '4.611'],
  ['79909.50', '2.000'],
];

afterEach(() => jest.restoreAllMocks());

describe('BinanceFeed.planEndpoints', () => {
  it('chunks linear markets onto the USD-M book host', () => {
    const { feed } = makeFeed(markets(250));
    const plans = feed.planEndpoints();

    expect(plans.map((p) => p.id)).toEqual([
      'binance#linear#0',
      'binance#linear#1',
    ]);
    expect(plans.map((p) => p.markets.length)).toEqual([200, 50]);
    expect(plans[0].url).toBe(
      'wss://fstream.binance.com/public/ws/sym0usdt@depth20@100ms',
    );
    expect(plans[1].url).toBe(
      'wss://fstream.binance.com/public/ws/sym200usdt@depth20@100ms',
    );
  });

  it('sends inverse markets to the COIN-M host on their own plans', () => {
    const { feed } = makeFeed([
      market('BTCUSDT'),
      market('BTCUSD_PERP', false),
    ]);
    const plans = feed.planEndpoints();

    expect(plans.map((p) => p.id)).toEqual([
      'binance#linear#0',
      'binance#inverse#0',
    ]);
    expect(plans[1].url).toBe(
      'wss://dstream.binance.com/ws/btcusd_perp@depth20@100ms',
    );
  });

  it('returns nothing when the venue lists no markets', () => {
    const { feed } = makeFeed([]);

    expect(feed.planEndpoints()).toEqual([]);
  });
});

describe('BinanceFeed.getSubscribeFrames', () => {
  it('lowercases the stream names and splits them across frames', () => {
    const { feed } = makeFeed([]);
    const frames = feed.getSubscribeFrames(markets(150)) as {
      method: string;
      params: string[];
      id: number;
    }[];

    expect(frames).toHaveLength(2);
    expect(frames[0].method).toBe('SUBSCRIBE');
    expect(frames[0].params).toHaveLength(100);
    expect(frames[0].params[0]).toBe('sym0usdt@depth20@100ms');
    expect(frames[1].params).toHaveLength(50);
    expect(frames.map((f) => f.id)).toEqual([1, 2]);
  });
});

describe('BinanceFeed.handleMessage', () => {
  it('hands the engine a subscribed depth update as the whole book', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      Buffer.from(JSON.stringify(depthUpdate('BTCUSDT', BIDS, ASKS))),
      c,
    );

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'BTCUSDT',
      [
        [79909.3, 23.163],
        [79909.2, 1.5],
      ],
      [
        [79909.4, 4.611],
        [79909.5, 2],
      ],
      LOCAL_NOW,
    );
  });

  it('replaces the book on every message rather than merging', () => {
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);
    feed.handleMessage(
      Buffer.from(JSON.stringify(depthUpdate('BTCUSDT', BIDS, ASKS))),
      c,
    );

    feed.handleMessage(
      Buffer.from(
        JSON.stringify(
          depthUpdate('BTCUSDT', [['79909.10', '1']], [['79909.60', '1']]),
        ),
      ),
      c,
    );

    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'BTCUSDT',
      [[79909.1, 1]],
      [[79909.6, 1]],
      expect.any(Number),
    );
  });

  it('hands over only as many levels as the engine holds', () => {
    const { feed, updateBook } = makeFeed([market('BTCUSDT')], 1);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      Buffer.from(JSON.stringify(depthUpdate('BTCUSDT', BIDS, ASKS))),
      c,
    );

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'BTCUSDT',
      [[79909.3, 23.163]],
      [[79909.4, 4.611]],
      expect.any(Number),
    );
  });

  it('unwraps the combined stream envelope', () => {
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      Buffer.from(
        JSON.stringify({
          stream: 'btcusdt@depth20@100ms',
          data: depthUpdate('BTCUSDT', BIDS, ASKS),
        }),
      ),
      c,
    );

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'BTCUSDT',
      expect.any(Array),
      expect.any(Array),
      expect.any(Number),
    );
  });

  it('passes a one sided book through with the empty side empty', () => {
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      Buffer.from(JSON.stringify(depthUpdate('BTCUSDT', BIDS, []))),
      c,
    );

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'BTCUSDT',
      expect.any(Array),
      [],
      expect.any(Number),
    );
  });

  it('drops a symbol the connection did not subscribe to, and warns once', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      Buffer.from(JSON.stringify(depthUpdate('ETHUSDT', BIDS, ASKS))),
      c,
    );
    feed.handleMessage(
      Buffer.from(JSON.stringify(depthUpdate('ETHUSDT', BIDS, ASKS))),
      c,
    );

    expect(updateBook).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs a rejected subscription and leaves the engine alone', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      Buffer.from(
        JSON.stringify({
          error: { code: -1121, msg: 'Invalid symbol.' },
          id: 1,
        }),
      ),
      c,
    );
    feed.handleMessage(Buffer.from(JSON.stringify({ result: null, id: 1 })), c);

    expect(updateBook).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
