import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/types';
import type { EndpointPlan, SingleSocketConnection } from '../../ws/types';
import { BinanceFeed } from './binance';

const VENUE_ID = 'binance';
const TAKER_PPM = 500;

// recvTs must come from the local clock, because openedAt, sampleTs and durationMs are measured on it across every venue.
// A venue timestamp here would make staleness depend on clock skew, so the quote is asserted whole rather than partially.
const LOCAL_NOW = 1_700_000_000_000;

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
  };
}

function markets(count: number, linear = true): Market[] {
  return Array.from({ length: count }, (_, i) => market(`SYM${i}USDT`, linear));
}

function makeFeed(venueMarkets: Market[]) {
  const updateQuote = jest.fn();
  const venue: Venue = { id: VENUE_ID, name: 'Binance', markets: venueMarkets };
  const engine = { updateQuote, markStale: jest.fn() } as unknown as Engine;
  const feed = new BinanceFeed(venue, engine) as unknown as FeedProbe;

  return { feed, updateQuote };
}

function connection(plan: EndpointPlan): SingleSocketConnection {
  return {
    id: plan.id,
    plan,
    accepted: new Set(plan.markets.map((m) => m.rawMarketId)),
    lastMessageAt: 0,
    attempt: 0,
    reopenOnClose: true,
    timers: [],
  } as unknown as SingleSocketConnection;
}

function bookTicker(symbol: string, bid: string, ask: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      e: 'bookTicker',
      u: 1,
      s: symbol,
      b: bid,
      B: '1',
      a: ask,
      A: '1',
      T: 1,
      E: 1,
      st: 1,
    }),
  );
}

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
      'wss://fstream.binance.com/public/ws/sym0usdt@bookTicker',
    );
    expect(plans[1].url).toBe(
      'wss://fstream.binance.com/public/ws/sym200usdt@bookTicker',
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
      'wss://dstream.binance.com/ws/btcusd_perp@bookTicker',
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
    expect(frames[0].params[0]).toBe('sym0usdt@bookTicker');
    expect(frames[1].params).toHaveLength(50);
    expect(frames.map((f) => f.id)).toEqual([1, 2]);
  });
});

describe('BinanceFeed.handleMessage', () => {
  it('submits a subscribed bookTicker as a quote', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateQuote } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(bookTicker('BTCUSDT', '1943.64', '1943.65'), c);

    expect(updateQuote).toHaveBeenCalledWith(VENUE_ID, 'BTCUSDT', {
      rawMarketId: 'BTCUSDT',
      bid: 1943.64,
      ask: 1943.65,
      recvTs: LOCAL_NOW,
    });
  });

  it('unwraps the combined stream envelope', () => {
    const { feed, updateQuote } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);
    const raw = Buffer.from(
      JSON.stringify({
        stream: 'btcusdt@bookTicker',
        data: JSON.parse(
          bookTicker('BTCUSDT', '10', '11').toString('utf8'),
        ) as unknown,
      }),
    );

    feed.handleMessage(raw, c);

    expect(updateQuote).toHaveBeenCalledWith(
      VENUE_ID,
      'BTCUSDT',
      expect.objectContaining({ bid: 10, ask: 11 }),
    );
  });

  it('drops a symbol the connection did not subscribe to, and warns once', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateQuote } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(bookTicker('ETHUSDT', '1', '2'), c);
    feed.handleMessage(bookTicker('ETHUSDT', '1', '2'), c);

    expect(updateQuote).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs a rejected subscription and leaves the engine alone', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { feed, updateQuote } = makeFeed([market('BTCUSDT')]);
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

    expect(updateQuote).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
