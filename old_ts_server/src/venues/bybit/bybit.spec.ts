import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/cluster/types';
import type {
  EndpointPlan,
  SingleSocketConnection,
} from '../../feeds/book/types';
import { BybitFeed } from './bybit';
import type { BybitOrderbookLevel } from './types';

const VENUE_ID = 'bybit';
const TAKER_PPM = 550;

// recvTs must come from the local clock, because openedAt, sampleTs and durationMs are measured on it across every venue.
const LOCAL_NOW = 1_700_000_000_000;
const LEVELS = 20;

type FeedProbe = {
  planEndpoints(): EndpointPlan[];
  getSubscribeFrames(markets: Market[]): object[];
  startKeepalive(c: SingleSocketConnection): void;
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
  const venue: Venue = { id: VENUE_ID, name: 'Bybit', markets: venueMarkets };
  const engine = {
    updateBook,
    markStale: jest.fn(),
    depthLevels: LEVELS,
  } as unknown as Engine;
  const feed = new BybitFeed(venue, engine) as unknown as FeedProbe;

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

// The shape captured live on 2026-09-07, with the level count cut down.
function bookFrame(
  symbol: string,
  type: 'snapshot' | 'delta',
  u: number,
  b: BybitOrderbookLevel[],
  a: BybitOrderbookLevel[],
): Buffer {
  return Buffer.from(
    JSON.stringify({
      topic: `orderbook.50.${symbol}`,
      type,
      ts: 1788746279128,
      cts: 1788746279122,
      data: { s: symbol, b, a, u, seq: 806353894408 },
    }),
  );
}

function control(success: boolean, retMsg: string, op: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      success,
      ret_msg: retMsg,
      conn_id: 'da7toku0nfamcecd8s50-3meem',
      req_id: 'sub-1',
      op,
    }),
  );
}

const SNAPSHOT_BIDS: BybitOrderbookLevel[] = [
  ['79909.40', '2.189'],
  ['79909.30', '1.000'],
];
const SNAPSHOT_ASKS: BybitOrderbookLevel[] = [
  ['79909.50', '0.652'],
  ['79909.60', '3.000'],
];

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('BybitFeed.planEndpoints', () => {
  it('chunks linear markets onto the linear endpoint', () => {
    const { feed } = makeFeed(markets(250));
    const plans = feed.planEndpoints();

    expect(plans.map((p) => p.id)).toEqual([
      'bybit#linear#0',
      'bybit#linear#1',
    ]);
    expect(plans.map((p) => p.markets.length)).toEqual([200, 50]);
    expect(plans[0].url).toBe('wss://stream.bybit.com/v5/public/linear');
  });

  it('sends inverse markets to the inverse endpoint on their own plans', () => {
    const { feed } = makeFeed([market('BTCUSDT'), market('BTCUSD', false)]);
    const plans = feed.planEndpoints();

    expect(plans.map((p) => p.id)).toEqual([
      'bybit#linear#0',
      'bybit#inverse#0',
    ]);
    expect(plans[1].url).toBe('wss://stream.bybit.com/v5/public/inverse');
  });

  it('returns nothing when the venue lists no markets', () => {
    const { feed } = makeFeed([]);

    expect(feed.planEndpoints()).toEqual([]);
  });
});

describe('BybitFeed.getSubscribeFrames', () => {
  it('builds depth fifty topics and splits them across frames', () => {
    const { feed } = makeFeed([]);
    const frames = feed.getSubscribeFrames(markets(250)) as {
      req_id: string;
      op: string;
      args: string[];
    }[];

    expect(frames).toHaveLength(2);
    expect(frames[0].op).toBe('subscribe');
    expect(frames[0].args).toHaveLength(200);
    expect(frames[0].args[0]).toBe('orderbook.50.SYM0USDT');
    expect(frames[1].args).toHaveLength(50);
    expect(frames.map((f) => f.req_id)).toEqual(['sub-1', 'sub-2']);
  });
});

describe('BybitFeed.startKeepalive', () => {
  it('sends the application ping while the socket is open', () => {
    jest.useFakeTimers();
    const { feed } = makeFeed([market('BTCUSDT')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.startKeepalive(c);
    jest.advanceTimersByTime(20_000);

    expect(socket.send).toHaveBeenCalledWith(JSON.stringify({ op: 'ping' }));
    expect(c.timers).toHaveLength(1);
  });
});

describe('BybitFeed.handleMessage', () => {
  it('hands the engine a subscribed snapshot as the whole book', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      bookFrame('BTCUSDT', 'snapshot', 100, SNAPSHOT_BIDS, SNAPSHOT_ASKS),
      c,
    );

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'BTCUSDT',
      [
        [79909.4, 2.189],
        [79909.3, 1],
      ],
      [
        [79909.5, 0.652],
        [79909.6, 3],
      ],
      LOCAL_NOW,
    );
  });

  it('applies a delta with the next update id and hands over the new top', () => {
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);
    feed.handleMessage(
      bookFrame('BTCUSDT', 'snapshot', 100, SNAPSHOT_BIDS, SNAPSHOT_ASKS),
      c,
    );

    // The best bid is pulled and a new best ask arrives.
    feed.handleMessage(
      bookFrame(
        'BTCUSDT',
        'delta',
        101,
        [['79909.40', '0']],
        [['79909.45', '1.5']],
      ),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(2);
    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'BTCUSDT',
      [[79909.3, 1]],
      [
        [79909.45, 1.5],
        [79909.5, 0.652],
        [79909.6, 3],
      ],
      expect.any(Number),
    );
  });

  it('restarts the connection on a gap in the update id and applies nothing', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);
    feed.handleMessage(
      bookFrame('BTCUSDT', 'snapshot', 100, SNAPSHOT_BIDS, SNAPSHOT_ASKS),
      c,
    );

    feed.handleMessage(
      bookFrame('BTCUSDT', 'delta', 102, [['79909.40', '0']], []),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(1);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'book_resync',
        rawMarketId: 'BTCUSDT',
        reason: 'sequence_gap',
        expected: 101,
        got: 102,
      }),
    );
  });

  it('restarts the connection on a delta with no snapshot behind it', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.handleMessage(
      bookFrame('BTCUSDT', 'delta', 5, [['79909.40', '1']], []),
      c,
    );

    expect(updateBook).not.toHaveBeenCalled();
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it('takes a restart snapshot with u of 1 as a replacement of the book', () => {
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);
    feed.handleMessage(
      bookFrame('BTCUSDT', 'snapshot', 100, SNAPSHOT_BIDS, SNAPSHOT_ASKS),
      c,
    );

    feed.handleMessage(
      bookFrame(
        'BTCUSDT',
        'snapshot',
        1,
        [['79000.00', '1']],
        [['79001.00', '1']],
      ),
      c,
    );
    feed.handleMessage(
      bookFrame('BTCUSDT', 'delta', 2, [['78999.00', '1']], []),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(3);
    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'BTCUSDT',
      [
        [79000, 1],
        [78999, 1],
      ],
      [[79001, 1]],
      expect.any(Number),
    );
  });

  it('passes a one sided book through with the empty side empty', () => {
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      bookFrame('BTCUSDT', 'snapshot', 100, SNAPSHOT_BIDS, []),
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
      bookFrame('ETHUSDT', 'snapshot', 1, SNAPSHOT_BIDS, SNAPSHOT_ASKS),
      c,
    );
    feed.handleMessage(
      bookFrame('ETHUSDT', 'snapshot', 1, SNAPSHOT_BIDS, SNAPSHOT_ASKS),
      c,
    );

    expect(updateBook).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs a rejected control frame and stays silent on the acknowledgement and the pong', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { feed, updateBook } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(control(true, '', 'subscribe'), c);
    feed.handleMessage(control(true, 'pong', 'ping'), c);
    feed.handleMessage(control(false, 'Invalid symbol', 'subscribe'), c);

    expect(updateBook).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
