import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/cluster/types';
import type {
  EndpointPlan,
  SingleSocketConnection,
} from '../../feeds/book/types';
import { BitgetFeed } from './bitget';
import type { BitgetBookLevel } from './types';

const VENUE_ID = 'bitget';
const TAKER_PPM = 600;

// recvTs must come from the local clock, because openedAt, sampleTs and durationMs are measured on it across every venue.
const LOCAL_NOW = 1_700_000_000_000;
const LEVELS = 20;

type FeedProbe = {
  maxSilenceMs: number;
  connectStaggerMs: number;
  subscribeGapMs: number;
  planEndpoints(): EndpointPlan[];
  getSubscribeFrames(markets: Market[]): object[];
  startKeepalive(c: SingleSocketConnection): void;
  handleMessage(raw: Buffer, c: SingleSocketConnection): void;
};

type SubscribeFrame = {
  op: string;
  args: { instType: string; topic: string; symbol: string }[];
};

function market(rawMarketId: string, quote = 'USDT'): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.slice(0, 3),
    quote,
    takerPpm: TAKER_PPM,
    linear: true,
    contractSize: 1,
  };
}

function markets(count: number, quote = 'USDT'): Market[] {
  const suffix = quote === 'USDC' ? 'PERP' : quote;
  return Array.from({ length: count }, (_, i) =>
    market(`SYM${i}${suffix}`, quote),
  );
}

function socketStub() {
  return { readyState: 1, OPEN: 1, send: jest.fn(), terminate: jest.fn() };
}

function makeFeed(venueMarkets: Market[]) {
  const updateBook = jest.fn();
  const venue: Venue = { id: VENUE_ID, name: 'Bitget', markets: venueMarkets };
  const engine = {
    updateBook,
    markStale: jest.fn(),
    depthLevels: LEVELS,
  } as unknown as Engine;
  const feed = new BitgetFeed(venue, engine) as unknown as FeedProbe;

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

// The v3 shape captured live on 2026-09-15, with the level count cut down.
function booksFrame(
  symbol: string,
  action: 'snapshot' | 'update',
  seq: string,
  pseq: string,
  b: BitgetBookLevel[],
  a: BitgetBookLevel[],
  instType = 'usdt-futures',
): Buffer {
  const arg = JSON.stringify({ instType, topic: 'books', symbol });
  return Buffer.from(
    `{"action":"${action}","arg":${arg},"data":[{"a":${JSON.stringify(a)},"b":${JSON.stringify(b)},"seq":${seq},"pseq":${pseq},"ts":"1789456512452","maxdepth":"1000"}],"ts":1789456512454}`,
  );
}

const SNAPSHOT_SEQ = '427583461144';
const SNAPSHOT_ASKS: BitgetBookLevel[] = [
  ['0.01039', '4499.23'],
  ['0.0104', '116536.86'],
];
const SNAPSHOT_BIDS: BitgetBookLevel[] = [
  ['0.01038', '4311.15'],
  ['0.01037', '175152.28'],
];

function snapshot(symbol = 'MAVUSDT'): Buffer {
  return booksFrame(
    symbol,
    'snapshot',
    SNAPSHOT_SEQ,
    '0',
    SNAPSHOT_BIDS,
    SNAPSHOT_ASKS,
  );
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('BitgetFeed', () => {
  it('paces subscribe frames and opens a second apart, and allows a minute of silence', () => {
    const { feed } = makeFeed([]);

    expect(feed.subscribeGapMs).toBe(1_000);
    expect(feed.connectStaggerMs).toBe(1_000);
    expect(feed.maxSilenceMs).toBe(60_000);
  });
});

describe('BitgetFeed.planEndpoints', () => {
  it('chunks markets fifty to a connection on the one v3 endpoint', () => {
    const { feed } = makeFeed(markets(120));
    const plans = feed.planEndpoints();

    expect(plans.map((p) => p.id)).toEqual([
      'bitget#usdt-futures#0',
      'bitget#usdt-futures#1',
      'bitget#usdt-futures#2',
    ]);
    expect(plans.map((p) => p.markets.length)).toEqual([50, 50, 20]);
    expect(plans[0].url).toBe('wss://ws.bitget.com/v3/ws/public');
  });

  it('splits plans by the instType the quote names', () => {
    const { feed } = makeFeed([
      market('BTCPERP', 'USDC'),
      market('BTCUSDT'),
      market('ETHPERP', 'USDC'),
    ]);
    const plans = feed.planEndpoints();

    expect(plans.map((p) => p.id)).toEqual([
      'bitget#usdt-futures#0',
      'bitget#usdc-futures#0',
    ]);
    expect(plans[1].markets.map((m) => m.rawMarketId)).toEqual([
      'BTCPERP',
      'ETHPERP',
    ]);
  });

  it('leaves out and logs a market whose quote names no instType', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { feed } = makeFeed([market('BTCUSDT'), market('BTCUSD', 'USD')]);
    const plans = feed.planEndpoints();

    expect(plans.flatMap((p) => p.markets.map((m) => m.rawMarketId))).toEqual([
      'BTCUSDT',
    ]);
    expect(error).toHaveBeenCalledTimes(1);
  });

  it('returns nothing when the venue lists no markets', () => {
    const { feed } = makeFeed([]);

    expect(feed.planEndpoints()).toEqual([]);
  });
});

describe('BitgetFeed.getSubscribeFrames', () => {
  it('builds v3 books arguments, ten to a frame', () => {
    const { feed } = makeFeed([]);
    const frames = feed.getSubscribeFrames(markets(25)) as SubscribeFrame[];

    expect(frames.map((f) => f.args.length)).toEqual([10, 10, 5]);
    expect(frames[0].op).toBe('subscribe');
    expect(frames[0].args[0]).toEqual({
      instType: 'usdt-futures',
      topic: 'books',
      symbol: 'SYM0USDT',
    });
  });

  it('takes the instType from each market quote', () => {
    const { feed } = makeFeed([]);
    const [frame] = feed.getSubscribeFrames([
      market('BTCUSDT'),
      market('BTCPERP', 'USDC'),
    ]) as SubscribeFrame[];

    expect(frame.args.map((a) => a.instType)).toEqual([
      'usdt-futures',
      'usdc-futures',
    ]);
  });
});

describe('BitgetFeed.startKeepalive', () => {
  it('sends the text ping every 25 seconds while the socket is open', () => {
    jest.useFakeTimers();
    const { feed } = makeFeed([market('BTCUSDT')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.startKeepalive(c);
    jest.advanceTimersByTime(25_000);

    expect(socket.send).toHaveBeenCalledWith('ping');
    expect(c.timers).toHaveLength(1);
  });
});

describe('BitgetFeed.handleMessage', () => {
  it('hands the engine a subscribed snapshot as the whole book', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateBook } = makeFeed([market('MAVUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(snapshot(), c);

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'MAVUSDT',
      [
        [0.01038, 4311.15],
        [0.01037, 175152.28],
      ],
      [
        [0.01039, 4499.23],
        [0.0104, 116536.86],
      ],
      LOCAL_NOW,
    );
  });

  it('applies the captured updates whose pseq chains to the last seq', () => {
    const { feed, updateBook } = makeFeed([market('MAVUSDT')]);
    const c = connection(feed.planEndpoints()[0]);
    feed.handleMessage(snapshot(), c);

    feed.handleMessage(
      booksFrame(
        'MAVUSDT',
        'update',
        '427583480559',
        SNAPSHOT_SEQ,
        [['0.00519', '30828.52']],
        [],
      ),
      c,
    );
    feed.handleMessage(
      booksFrame(
        'MAVUSDT',
        'update',
        '427583480664',
        '427583480559',
        [
          ['0.01036', '463711.3'],
          ['0.01035', '175053.47'],
        ],
        [
          ['0.0104', '116536.86'],
          ['0.01042', '382403.68'],
        ],
      ),
      c,
    );

    // The best bid is pulled.
    feed.handleMessage(
      booksFrame(
        'MAVUSDT',
        'update',
        '427583480700',
        '427583480664',
        [['0.01038', '0']],
        [],
      ),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(4);
    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'MAVUSDT',
      [
        [0.01037, 175152.28],
        [0.01036, 463711.3],
        [0.01035, 175053.47],
        [0.00519, 30828.52],
      ],
      [
        [0.01039, 4499.23],
        [0.0104, 116536.86],
        [0.01042, 382403.68],
      ],
      expect.any(Number),
    );
  });

  it('routes a USDC-M book the same way', () => {
    const { feed, updateBook } = makeFeed([market('BTCPERP', 'USDC')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      booksFrame(
        'BTCPERP',
        'snapshot',
        '559103756610',
        '0',
        [['75850.1', '0.5']],
        [['75850.2', '0.7']],
        'usdc-futures',
      ),
      c,
    );

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'BTCPERP',
      [[75850.1, 0.5]],
      [[75850.2, 0.7]],
      expect.any(Number),
    );
  });

  it('restarts the connection on a pseq that skips a frame and applies nothing', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('MAVUSDT')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);
    feed.handleMessage(snapshot(), c);

    feed.handleMessage(
      booksFrame(
        'MAVUSDT',
        'update',
        '427583480664',
        '427583480559',
        [['0.01036', '463711.3']],
        [],
      ),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(1);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'book_resync',
        rawMarketId: 'MAVUSDT',
        reason: 'sequence_gap',
        expected: Number(SNAPSHOT_SEQ),
        got: 427583480559,
      }),
    );
  });

  it('restarts the connection on an update whose pseq is 0', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('MAVUSDT')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);
    feed.handleMessage(snapshot(), c);

    feed.handleMessage(
      booksFrame('MAVUSDT', 'update', '5', '0', [['0.01036', '1']], []),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(1);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'sequence_reset' }),
    );
  });

  it('restarts the connection on an update with no snapshot behind it', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('MAVUSDT')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.handleMessage(
      booksFrame(
        'MAVUSDT',
        'update',
        '427583480559',
        SNAPSHOT_SEQ,
        [['0.00519', '30828.52']],
        [],
      ),
      c,
    );

    expect(updateBook).not.toHaveBeenCalled();
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'update_before_snapshot' }),
    );
  });

  it('ignores the bare text pong without parsing it', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { feed, updateBook } = makeFeed([market('MAVUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    expect(() => feed.handleMessage(Buffer.from('pong'), c)).not.toThrow();
    expect(updateBook).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('drops a symbol the connection did not subscribe to, and warns once', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('MAVUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(snapshot('CELRUSDT'), c);
    feed.handleMessage(snapshot('CELRUSDT'), c);

    expect(updateBook).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs an error event and stays silent on the acknowledgement', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { feed, updateBook } = makeFeed([market('MAVUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      Buffer.from(
        JSON.stringify({
          event: 'subscribe',
          arg: { instType: 'usdt-futures', topic: 'books', symbol: 'MAVUSDT' },
          connId:
            '06ea84fffe987173-00008a15-033b0931-fa9263af713ab269-b2bdfd7d',
        }),
      ),
      c,
    );
    feed.handleMessage(
      Buffer.from(
        JSON.stringify({
          event: 'error',
          code: 30001,
          msg: '{"instType":"usdt-futures","symbol":"NOPEUSDT","topic":"books"} doesn\'t exist',
          connId:
            '0ac601fffe2331d1-0000b8a2-02ec8f7d-12be2501ca6d557e-522cdcdf',
        }),
      ),
      c,
    );

    expect(updateBook).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('30001');
  });
});
