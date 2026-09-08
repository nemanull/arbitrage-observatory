import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/types';
import type { EndpointPlan, SingleSocketConnection } from '../../ws/types';
import { KrakenFuturesFeed } from './krakenfutures';

const VENUE_ID = 'krakenfutures';
const TAKER_PPM = 500;

// recvTs must come from the local clock, because openedAt, sampleTs and durationMs are measured on it across every venue.
const LOCAL_NOW = 1_700_000_000_000;
const LEVELS = 20;

type FeedProbe = {
  planEndpoints(): EndpointPlan[];
  getSubscribeFrames(markets: Market[]): object[];
  startKeepalive(c: SingleSocketConnection): void;
  handleMessage(raw: Buffer, c: SingleSocketConnection): void;
};

function market(rawMarketId: string): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.slice(3, -3),
    quote: 'USD',
    takerPpm: TAKER_PPM,
    linear: true,
    contractSize: 1,
  };
}

function markets(count: number): Market[] {
  return Array.from({ length: count }, (_, i) => market(`PF_SYM${i}USD`));
}

function socketStub() {
  return {
    readyState: 1,
    OPEN: 1,
    ping: jest.fn(),
    send: jest.fn(),
    terminate: jest.fn(),
  };
}

function makeFeed(venueMarkets: Market[]) {
  const updateBook = jest.fn();
  const venue: Venue = {
    id: VENUE_ID,
    name: 'Kraken Futures',
    markets: venueMarkets,
  };
  const engine = {
    updateBook,
    markStale: jest.fn(),
    depthLevels: LEVELS,
  } as unknown as Engine;
  const feed = new KrakenFuturesFeed(venue, engine) as unknown as FeedProbe;

  return { feed, updateBook };
}

function connection(
  plan: EndpointPlan,
  socket = socketStub(),
): SingleSocketConnection {
  return {
    id: plan.id,
    plan,
    socket,
    accepted: new Set(plan.markets.map((m) => m.rawMarketId)),
    lastMessageAt: 0,
    attempt: 0,
    reopenOnClose: true,
    timers: [],
  } as unknown as SingleSocketConnection;
}

// The shapes captured live on 2026-09-07, with the level count cut down. Prices and quantities are JSON numbers.
function snapshot(
  productId: string,
  seq: number,
  bids: { price: number; qty: number }[],
  asks: { price: number; qty: number }[],
): Buffer {
  return Buffer.from(
    JSON.stringify({
      feed: 'book_snapshot',
      product_id: productId,
      timestamp: 1788746279044,
      seq,
      tickSize: null,
      bids,
      asks,
    }),
  );
}

function delta(
  productId: string,
  seq: number,
  side: 'buy' | 'sell',
  price: number,
  qty: number,
): Buffer {
  return Buffer.from(
    JSON.stringify({
      feed: 'book',
      product_id: productId,
      side,
      seq,
      price,
      qty,
      timestamp: 1788746279050,
    }),
  );
}

const SNAPSHOT_BIDS = [
  { price: 79943, qty: 0.0062 },
  { price: 79942, qty: 1.5 },
];
const SNAPSHOT_ASKS = [
  { price: 79944, qty: 0.048 },
  { price: 79945, qty: 2 },
];

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('KrakenFuturesFeed.planEndpoints', () => {
  it('chunks every market onto the one public endpoint', () => {
    const { feed } = makeFeed(markets(150));
    const plans = feed.planEndpoints();

    expect(plans.map((p) => p.id)).toEqual([
      'krakenfutures#swap#0',
      'krakenfutures#swap#1',
    ]);
    expect(plans.map((p) => p.markets.length)).toEqual([100, 50]);
    expect(plans[0].url).toBe('wss://futures.kraken.com/ws/v1');
  });

  it('returns nothing when the venue lists no markets', () => {
    const { feed } = makeFeed([]);

    expect(feed.planEndpoints()).toEqual([]);
  });
});

describe('KrakenFuturesFeed.getSubscribeFrames', () => {
  it('names the book feed once and passes the product ids as one array', () => {
    const { feed } = makeFeed([]);
    const frames = feed.getSubscribeFrames(markets(150)) as {
      event: string;
      feed: string;
      product_ids: string[];
    }[];

    expect(frames).toHaveLength(2);
    expect(frames[0].event).toBe('subscribe');
    expect(frames[0].feed).toBe('book');
    expect(frames[0].product_ids).toHaveLength(100);
    expect(frames[0].product_ids[0]).toBe('PF_SYM0USD');
    expect(frames[1].product_ids).toHaveLength(50);
  });
});

describe('KrakenFuturesFeed.handleMessage', () => {
  it('hands the engine a subscribed snapshot as the whole book', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateBook } = makeFeed([market('PF_XBTUSD')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      snapshot('PF_XBTUSD', 186304944, SNAPSHOT_BIDS, SNAPSHOT_ASKS),
      c,
    );

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'PF_XBTUSD',
      [
        [79943, 0.0062],
        [79942, 1.5],
      ],
      [
        [79944, 0.048],
        [79945, 2],
      ],
      LOCAL_NOW,
    );
  });

  it('applies one level deltas in sequence on either side', () => {
    const { feed, updateBook } = makeFeed([market('PF_XBTUSD')]);
    const c = connection(feed.planEndpoints()[0]);
    feed.handleMessage(
      snapshot('PF_XBTUSD', 186304944, SNAPSHOT_BIDS, SNAPSHOT_ASKS),
      c,
    );

    feed.handleMessage(delta('PF_XBTUSD', 186304945, 'buy', 79943, 0.5), c);
    feed.handleMessage(delta('PF_XBTUSD', 186304946, 'sell', 79944, 0), c);

    expect(updateBook).toHaveBeenCalledTimes(3);
    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'PF_XBTUSD',
      [
        [79943, 0.5],
        [79942, 1.5],
      ],
      [[79945, 2]],
      expect.any(Number),
    );
  });

  it('keeps the sequence per product, so two products interleave freely', () => {
    const { feed, updateBook } = makeFeed([
      market('PF_XBTUSD'),
      market('PF_ETHUSD'),
    ]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);
    feed.handleMessage(
      snapshot('PF_XBTUSD', 10, SNAPSHOT_BIDS, SNAPSHOT_ASKS),
      c,
    );
    feed.handleMessage(
      snapshot(
        'PF_ETHUSD',
        500,
        [{ price: 3000, qty: 1 }],
        [{ price: 3001, qty: 1 }],
      ),
      c,
    );

    feed.handleMessage(delta('PF_ETHUSD', 501, 'buy', 2999, 1), c);
    feed.handleMessage(delta('PF_XBTUSD', 11, 'buy', 79941, 1), c);
    feed.handleMessage(delta('PF_ETHUSD', 502, 'sell', 3002, 1), c);

    expect(socket.terminate).not.toHaveBeenCalled();
    expect(updateBook).toHaveBeenCalledTimes(5);
  });

  it('restarts the connection on a sequence gap and applies nothing', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('PF_XBTUSD')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);
    feed.handleMessage(
      snapshot('PF_XBTUSD', 186304944, SNAPSHOT_BIDS, SNAPSHOT_ASKS),
      c,
    );

    feed.handleMessage(delta('PF_XBTUSD', 186304947, 'buy', 79943, 0.5), c);

    expect(updateBook).toHaveBeenCalledTimes(1);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'book_resync',
        rawMarketId: 'PF_XBTUSD',
        reason: 'sequence_gap',
        expected: 186304945,
        got: 186304947,
      }),
    );
  });

  it('restarts the connection on a delta with no snapshot behind it', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('PF_XBTUSD')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.handleMessage(delta('PF_XBTUSD', 1, 'buy', 79943, 0.5), c);

    expect(updateBook).not.toHaveBeenCalled();
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it('passes a one sided snapshot through with the empty side empty', () => {
    const { feed, updateBook } = makeFeed([market('PF_LAYERUSD')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(snapshot('PF_LAYERUSD', 7, SNAPSHOT_BIDS, []), c);

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'PF_LAYERUSD',
      expect.any(Array),
      [],
      expect.any(Number),
    );
  });

  it('drops a product the connection did not subscribe to, and warns once', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('PF_XBTUSD')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      snapshot('PF_ETHUSD', 1, SNAPSHOT_BIDS, SNAPSHOT_ASKS),
      c,
    );
    feed.handleMessage(
      snapshot('PF_ETHUSD', 1, SNAPSHOT_BIDS, SNAPSHOT_ASKS),
      c,
    );

    expect(updateBook).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs an alert and stays silent on the banner and the acknowledgement', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { feed, updateBook } = makeFeed([market('PF_XBTUSD')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      Buffer.from(JSON.stringify({ event: 'info', version: 1 })),
      c,
    );
    feed.handleMessage(
      Buffer.from(
        JSON.stringify({
          event: 'subscribed',
          feed: 'book',
          product_ids: ['PF_XBTUSD'],
        }),
      ),
      c,
    );
    feed.handleMessage(
      Buffer.from(
        JSON.stringify({
          event: 'alert',
          message: 'Bad request: invalid product `PF_NOPEUSD`',
        }),
      ),
      c,
    );

    expect(updateBook).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });
});

describe('KrakenFuturesFeed.startKeepalive', () => {
  it('sends a protocol ping and never a JSON one', () => {
    jest.useFakeTimers();
    const { feed } = makeFeed([market('PF_XBTUSD')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.startKeepalive(c);
    jest.advanceTimersByTime(20_000);

    expect(socket.ping).toHaveBeenCalledTimes(1);
    expect(socket.send).not.toHaveBeenCalled();
  });
});
