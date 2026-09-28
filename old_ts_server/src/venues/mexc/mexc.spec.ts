import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/cluster/types';
import type {
  EndpointPlan,
  SingleSocketConnection,
} from '../../feeds/book/types';
import { MexcFeed } from './mexc';
import type { MexcBookLevel } from './types';

const VENUE_ID = 'mexc';
const TAKER_PPM = 800;

// recvTs must come from the local clock, because openedAt, sampleTs and durationMs are measured on it across every venue.
const LOCAL_NOW = 1_700_000_000_000;
const LEVELS = 20;

type FeedProbe = {
  subscribeGapMs: number;
  maxSilenceMs: number;
  planEndpoints(): EndpointPlan[];
  getSubscribeFrames(markets: Market[]): object[];
  startKeepalive(c: SingleSocketConnection): void;
  handleMessage(raw: Buffer, c: SingleSocketConnection): void;
  onClose(c: SingleSocketConnection): void;
};

function market(rawMarketId: string): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.split('_')[0],
    quote: 'USDT',
    takerPpm: TAKER_PPM,
    linear: true,
    contractSize: 10,
  };
}

function markets(count: number): Market[] {
  return Array.from({ length: count }, (_, i) => market(`SYM${i}_USDT`));
}

function socketStub() {
  return {
    readyState: 1,
    OPEN: 1,
    send: jest.fn(),
    terminate: jest.fn(),
  };
}

function makeFeed(venueMarkets: Market[]) {
  const updateBook = jest.fn();
  const venue: Venue = { id: VENUE_ID, name: 'MEXC', markets: venueMarkets };
  const engine = {
    updateBook,
    markStale: jest.fn(),
    depthLevels: LEVELS,
  } as unknown as Engine;
  const feed = new MexcFeed(venue, engine) as unknown as FeedProbe;

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

// The shape captured live on 2026-09-15, with the level count cut down.
function fullFrame(
  symbol: string,
  version: number,
  bids: MexcBookLevel[],
  asks: MexcBookLevel[],
): Buffer {
  return Buffer.from(
    JSON.stringify({
      symbol,
      data: { cts: 1789498322165, asks, bids, version },
      channel: 'push.depth.full',
      ts: 1789498322169,
    }),
  );
}

const RIF_BIDS: MexcBookLevel[] = [
  [0.08049, 46, 1],
  [0.08048, 489, 1],
  [0.08047, 420, 1],
];
const RIF_ASKS: MexcBookLevel[] = [
  [0.08055, 48, 1],
  [0.08056, 347, 1],
  [0.08057, 149, 1],
];

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('MexcFeed.planEndpoints', () => {
  it('puts 150 contracts on each connection to the one public endpoint', () => {
    const { feed } = makeFeed(markets(320));
    const plans = feed.planEndpoints();

    expect(plans.map((p) => p.id)).toEqual([
      'mexc#swap#0',
      'mexc#swap#1',
      'mexc#swap#2',
    ]);
    expect(plans.map((p) => p.markets.length)).toEqual([150, 150, 20]);
    expect(plans.every((p) => p.url === 'wss://contract.mexc.com/edge')).toBe(
      true,
    );
  });

  it('returns nothing when the venue lists no markets', () => {
    const { feed } = makeFeed([]);

    expect(feed.planEndpoints()).toEqual([]);
  });
});

describe('MexcFeed.getSubscribeFrames', () => {
  it('sends one full depth frame of 20 levels per contract, paced 50 ms apart', () => {
    const { feed } = makeFeed([]);
    const frames = feed.getSubscribeFrames(markets(150));

    expect(frames).toHaveLength(150);
    expect(frames[0]).toEqual({
      method: 'sub.depth.full',
      param: { symbol: 'SYM0_USDT', limit: 20 },
    });
    expect(feed.subscribeGapMs).toBe(50);
    expect(feed.maxSilenceMs).toBe(45_000);
  });
});

describe('MexcFeed.startKeepalive', () => {
  it('sends the application ping every 15 seconds while the socket is open', () => {
    jest.useFakeTimers();
    const { feed } = makeFeed([market('RIF_USDT')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.startKeepalive(c);
    jest.advanceTimersByTime(15_000);

    expect(socket.send).toHaveBeenCalledWith('{"method":"ping"}');
    expect(c.timers).toHaveLength(1);
  });
});

describe('MexcFeed.handleMessage', () => {
  it('hands the engine a full depth frame as the whole book', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateBook } = makeFeed([market('RIF_USDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      fullFrame('RIF_USDT', 5220571685, RIF_BIDS, RIF_ASKS),
      c,
    );

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'RIF_USDT',
      [
        [0.08049, 46],
        [0.08048, 489],
        [0.08047, 420],
      ],
      [
        [0.08055, 48],
        [0.08056, 347],
        [0.08057, 149],
      ],
      LOCAL_NOW,
    );
  });

  it('replaces the book on every frame, so a level missing from the next frame is gone', () => {
    const { feed, updateBook } = makeFeed([market('RIF_USDT')]);
    const c = connection(feed.planEndpoints()[0]);
    feed.handleMessage(
      fullFrame('RIF_USDT', 5220571685, RIF_BIDS, RIF_ASKS),
      c,
    );

    feed.handleMessage(
      fullFrame('RIF_USDT', 5220571690, [[0.0805, 12, 1]], [[0.08056, 300, 1]]),
      c,
    );

    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'RIF_USDT',
      [[0.0805, 12]],
      [[0.08056, 300]],
      expect.any(Number),
    );
  });

  it('drops a frame whose version is below the last one applied', () => {
    const { feed, updateBook } = makeFeed([market('RIF_USDT')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);
    feed.handleMessage(
      fullFrame('RIF_USDT', 5220571685, RIF_BIDS, RIF_ASKS),
      c,
    );

    feed.handleMessage(
      fullFrame('RIF_USDT', 5220571684, [[0.08, 1, 1]], [[0.09, 1, 1]]),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(1);
    expect(socket.terminate).not.toHaveBeenCalled();
  });

  it('applies an unchanged top that arrives with a higher version', () => {
    const { feed, updateBook } = makeFeed([market('RIF_USDT')]);
    const c = connection(feed.planEndpoints()[0]);
    feed.handleMessage(
      fullFrame('RIF_USDT', 5220571685, RIF_BIDS, RIF_ASKS),
      c,
    );

    feed.handleMessage(
      fullFrame('RIF_USDT', 5220571686, RIF_BIDS, RIF_ASKS),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(2);
  });

  it('takes any version for the first frame after the connection closed', () => {
    const { feed, updateBook } = makeFeed([market('RIF_USDT')]);
    const c = connection(feed.planEndpoints()[0]);
    feed.handleMessage(
      fullFrame('RIF_USDT', 5220571685, RIF_BIDS, RIF_ASKS),
      c,
    );
    feed.onClose(c);

    const reopened = connection(feed.planEndpoints()[0]);
    feed.handleMessage(fullFrame('RIF_USDT', 7, RIF_BIDS, RIF_ASKS), reopened);
    feed.handleMessage(fullFrame('RIF_USDT', 6, RIF_BIDS, RIF_ASKS), reopened);

    expect(updateBook).toHaveBeenCalledTimes(2);
  });

  it('reads a price sent in exponent form', () => {
    const { feed, updateBook } = makeFeed([market('BTC_USDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      Buffer.from(
        '{"symbol":"BTC_USDT","data":{"cts":1789498322165,"asks":[[75481.2,10,1]],"bids":[[7.548E+4,4959,3]],"version":41770922520},"channel":"push.depth.full","ts":1789498322169}',
      ),
      c,
    );

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'BTC_USDT',
      [[75480, 4959]],
      [[75481.2, 10]],
      expect.any(Number),
    );
  });

  it('drops a contract the connection did not subscribe to, and warns once', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('RIF_USDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(fullFrame('ETH_USDT', 1, RIF_BIDS, RIF_ASKS), c);
    feed.handleMessage(fullFrame('ETH_USDT', 2, RIF_BIDS, RIF_ASKS), c);

    expect(updateBook).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs an rs.error frame and stays silent on the acknowledgement and the pong', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { feed, updateBook } = makeFeed([market('RIF_USDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      Buffer.from(
        '{"channel":"rs.sub.depth.full","data":"success","ts":1789498321789}',
      ),
      c,
    );
    feed.handleMessage(
      Buffer.from('{"channel":"pong","data":1789498336785,"ts":1789498336785}'),
      c,
    );
    feed.handleMessage(
      Buffer.from(
        '{"channel":"rs.error","data":"Contract [NOPE_USDT] not exists","ts":1789498321790}',
      ),
      c,
    );

    expect(updateBook).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      'mexc#swap#0: Contract [NOPE_USDT] not exists',
    );
  });

  it('logs the first binary frame, drops every one, and keeps reading text frames', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('RIF_USDT')]);
    const c = connection(feed.planEndpoints()[0]);
    const gzip = Buffer.from([0x1f, 0x8b, 0x08, 0x00, 0x00, 0x00]);

    expect(() => feed.handleMessage(gzip, c)).not.toThrow();
    feed.handleMessage(gzip, c);
    feed.handleMessage(fullFrame('RIF_USDT', 1, RIF_BIDS, RIF_ASKS), c);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(updateBook).toHaveBeenCalledTimes(1);
  });
});
