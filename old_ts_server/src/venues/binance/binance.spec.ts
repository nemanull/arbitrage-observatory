import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/cluster/types';
import type {
  EndpointPlan,
  SingleSocketConnection,
} from '../../feeds/book/types';
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

// The shape captured live on 2026-09-15, with the level count cut down. Both channels send these fields.
const FIRST_ID = 11493080433094;

type Ids = { U?: number; u?: number; pu?: number };

function depthUpdate(
  symbol: string,
  b: [string, string][],
  a: [string, string][],
  ids: Ids = {},
): object {
  const u = ids.u ?? FIRST_ID;

  return {
    e: 'depthUpdate',
    s: symbol,
    U: ids.U ?? u,
    u,
    pu: ids.pu ?? u - 1,
    E: 1788746280299,
    T: 1788746280297,
    b,
    a,
  };
}

function snapshotFrame(
  symbol: string,
  b: [string, string][],
  a: [string, string][],
  ids: Ids = {},
): object {
  return {
    stream: `${symbol.toLowerCase()}@depth20@100ms`,
    data: depthUpdate(symbol, b, a, ids),
  };
}

function diffFrame(
  symbol: string,
  b: [string, string][],
  a: [string, string][],
  ids: Ids,
): object {
  return {
    stream: `${symbol.toLowerCase()}@depth@0ms`,
    data: depthUpdate(symbol, b, a, ids),
  };
}

function send(feed: FeedProbe, c: SingleSocketConnection, frame: object): void {
  feed.handleMessage(Buffer.from(JSON.stringify(frame)), c);
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
      'wss://fstream.binance.com/public/stream?streams=sym0usdt@depth@0ms/sym0usdt@depth20@100ms',
    );
    expect(plans[1].url).toBe(
      'wss://fstream.binance.com/public/stream?streams=sym200usdt@depth@0ms/sym200usdt@depth20@100ms',
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
      'wss://dstream.binance.com/stream?streams=btcusd_perp@depth@0ms/btcusd_perp@depth20@100ms',
    );
  });

  it('returns nothing when the venue lists no markets', () => {
    const { feed } = makeFeed([]);

    expect(feed.planEndpoints()).toEqual([]);
  });
});

describe('BinanceFeed.getSubscribeFrames', () => {
  it('lowercases both stream names per market and splits them across frames', () => {
    const { feed } = makeFeed([]);
    const frames = feed.getSubscribeFrames(markets(150)) as {
      method: string;
      params: string[];
      id: number;
    }[];

    expect(frames).toHaveLength(3);
    expect(frames[0].method).toBe('SUBSCRIBE');
    expect(frames[0].params).toHaveLength(100);
    expect(frames[0].params.slice(0, 2)).toEqual([
      'sym0usdt@depth@0ms',
      'sym0usdt@depth20@100ms',
    ]);
    expect(frames[2].params).toHaveLength(100);
    expect(frames.map((f) => f.id)).toEqual([1, 2, 3]);
  });
});

describe('BinanceFeed.handleMessage', () => {
  it('seeds the book from a snapshot and hands it to the engine', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    send(feed, c, snapshotFrame('BTCUSDT', BIDS, ASKS));

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

  it('merges a diff onto the seeded book instead of replacing it', () => {
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);
    send(feed, c, snapshotFrame('BTCUSDT', BIDS, ASKS));

    send(
      feed,
      c,
      diffFrame('BTCUSDT', [['79909.35', '2']], [['79909.40', '9']], {
        u: FIRST_ID + 1,
        pu: FIRST_ID,
      }),
    );

    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'BTCUSDT',
      [
        [79909.35, 2],
        [79909.3, 23.163],
        [79909.2, 1.5],
      ],
      [
        [79909.4, 9],
        [79909.5, 2],
      ],
      expect.any(Number),
    );
  });

  it('applies the first diff after a snapshot when it straddles the snapshot id', () => {
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);
    send(feed, c, snapshotFrame('BTCUSDT', BIDS, ASKS));

    send(
      feed,
      c,
      diffFrame('BTCUSDT', [['79909.30', '4']], [], {
        U: FIRST_ID - 10,
        u: FIRST_ID + 5,
        pu: FIRST_ID - 11,
      }),
    );

    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'BTCUSDT',
      [
        [79909.3, 4],
        [79909.2, 1.5],
      ],
      expect.any(Array),
      expect.any(Number),
    );
  });

  it('removes a level a diff zeroes', () => {
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);
    send(feed, c, snapshotFrame('BTCUSDT', BIDS, ASKS));

    send(
      feed,
      c,
      diffFrame('BTCUSDT', [['79909.30', '0']], [], {
        u: FIRST_ID + 1,
        pu: FIRST_ID,
      }),
    );

    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'BTCUSDT',
      [[79909.2, 1.5]],
      expect.any(Array),
      expect.any(Number),
    );
  });

  it('ignores a diff level outside the window the snapshot covered', () => {
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);
    send(feed, c, snapshotFrame('BTCUSDT', BIDS, ASKS));

    send(
      feed,
      c,
      diffFrame(
        'BTCUSDT',
        [
          ['79909.25', '3'],
          ['79909.10', '7'],
        ],
        [
          ['79909.45', '3'],
          ['79909.60', '7'],
        ],
        { u: FIRST_ID + 1, pu: FIRST_ID },
      ),
    );

    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'BTCUSDT',
      [
        [79909.3, 23.163],
        [79909.25, 3],
        [79909.2, 1.5],
      ],
      [
        [79909.4, 4.611],
        [79909.45, 3],
        [79909.5, 2],
      ],
      expect.any(Number),
    );
  });

  it('drops a diff that arrives before any snapshot', () => {
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    send(
      feed,
      c,
      diffFrame('BTCUSDT', BIDS, ASKS, { u: FIRST_ID, pu: FIRST_ID - 1 }),
    );

    expect(updateBook).not.toHaveBeenCalled();
  });

  it('drops a diff whose sequence skips, warns, and keeps the socket open', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);
    send(feed, c, snapshotFrame('BTCUSDT', BIDS, ASKS));

    send(
      feed,
      c,
      diffFrame('BTCUSDT', [['79909.30', '4']], [], {
        U: FIRST_ID + 50,
        u: FIRST_ID + 60,
        pu: FIRST_ID + 49,
      }),
    );

    const socket = c.socket as unknown as { terminate: jest.Mock };

    expect(updateBook).toHaveBeenCalledTimes(1);
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ event: 'book_desync', rawMarketId: 'BTCUSDT' }),
    );
  });

  it('recovers a desynced symbol on the next snapshot', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);
    send(feed, c, snapshotFrame('BTCUSDT', BIDS, ASKS));
    send(
      feed,
      c,
      diffFrame('BTCUSDT', [['79909.30', '4']], [], {
        U: FIRST_ID + 50,
        u: FIRST_ID + 60,
        pu: FIRST_ID + 49,
      }),
    );

    send(
      feed,
      c,
      snapshotFrame('BTCUSDT', [['79909.10', '5']], [['79909.70', '6']], {
        u: FIRST_ID + 70,
      }),
    );
    send(
      feed,
      c,
      diffFrame('BTCUSDT', [['79909.15', '8']], [], {
        u: FIRST_ID + 71,
        pu: FIRST_ID + 70,
      }),
    );

    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'BTCUSDT',
      [
        [79909.15, 8],
        [79909.1, 5],
      ],
      [[79909.7, 6]],
      expect.any(Number),
    );
  });

  it('ignores a snapshot the diffs have already passed', () => {
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);
    send(feed, c, snapshotFrame('BTCUSDT', BIDS, ASKS));
    send(
      feed,
      c,
      diffFrame('BTCUSDT', [['79909.35', '2']], [], {
        u: FIRST_ID + 1,
        pu: FIRST_ID,
      }),
    );

    send(feed, c, snapshotFrame('BTCUSDT', BIDS, ASKS));

    expect(updateBook).toHaveBeenCalledTimes(2);
    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'BTCUSDT',
      [
        [79909.35, 2],
        [79909.3, 23.163],
        [79909.2, 1.5],
      ],
      expect.any(Array),
      expect.any(Number),
    );
  });

  it('waits for the next snapshot when a diff empties a side of the window', () => {
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);
    send(feed, c, snapshotFrame('BTCUSDT', BIDS, ASKS));

    send(
      feed,
      c,
      diffFrame(
        'BTCUSDT',
        [
          ['79909.30', '0'],
          ['79909.20', '0'],
        ],
        [],
        { u: FIRST_ID + 1, pu: FIRST_ID },
      ),
    );

    // The venue still has bids under the window, so an empty side here is our window running out, not the book losing a side.
    expect(updateBook).toHaveBeenCalledTimes(1);

    send(
      feed,
      c,
      snapshotFrame('BTCUSDT', [['79909.10', '5']], ASKS, { u: FIRST_ID + 2 }),
    );

    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'BTCUSDT',
      [[79909.1, 5]],
      expect.any(Array),
      expect.any(Number),
    );
  });

  it('reads a frame with no stream name as a snapshot', () => {
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    send(feed, c, depthUpdate('BTCUSDT', BIDS, ASKS));

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'BTCUSDT',
      expect.any(Array),
      expect.any(Array),
      expect.any(Number),
    );
  });

  it('hands over only as many levels as the engine holds', () => {
    const { feed, updateBook } = makeFeed([market('BTCUSDT')], 1);
    const c = connection(feed.planEndpoints()[0]);

    send(feed, c, snapshotFrame('BTCUSDT', BIDS, ASKS));

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'BTCUSDT',
      [[79909.3, 23.163]],
      [[79909.4, 4.611]],
      expect.any(Number),
    );
  });

  it('passes a one sided book through with the empty side empty', () => {
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    send(feed, c, snapshotFrame('BTCUSDT', BIDS, []));

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

    send(feed, c, snapshotFrame('ETHUSDT', BIDS, ASKS));
    send(feed, c, snapshotFrame('ETHUSDT', BIDS, ASKS));

    expect(updateBook).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs a rejected subscription and leaves the engine alone', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    send(feed, c, { error: { code: -1121, msg: 'Invalid symbol.' }, id: 1 });
    send(feed, c, { result: null, id: 1 });

    expect(updateBook).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
