import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/cluster/types';
import type {
  EndpointPlan,
  SingleSocketConnection,
} from '../../feeds/book/types';
import { OkxFeed } from './okx';
import type { OkxBookLevel } from './types';

const VENUE_ID = 'okx';
const TAKER_PPM = 500;

// recvTs must come from the local clock, because openedAt, sampleTs and durationMs are measured on it across every venue.
const LOCAL_NOW = 1_700_000_000_000;
const LEVELS = 20;

type FeedProbe = {
  planEndpoints(): EndpointPlan[];
  getSubscribeFrames(markets: Market[]): object[];
  handleMessage(raw: Buffer, c: SingleSocketConnection): void;
};

function market(rawMarketId: string): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.split('-')[0],
    quote: 'USDT',
    takerPpm: TAKER_PPM,
    linear: true,
    contractSize: 0.01,
  };
}

function markets(count: number): Market[] {
  return Array.from({ length: count }, (_, i) => market(`SYM${i}-USDT-SWAP`));
}

function socketStub() {
  return { readyState: 1, OPEN: 1, send: jest.fn(), terminate: jest.fn() };
}

function makeFeed(venueMarkets: Market[]) {
  const updateBook = jest.fn();
  const venue: Venue = { id: VENUE_ID, name: 'OKX', markets: venueMarkets };
  const engine = {
    updateBook,
    markStale: jest.fn(),
    depthLevels: LEVELS,
  } as unknown as Engine;
  const feed = new OkxFeed(venue, engine) as unknown as FeedProbe;

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

// The shape captured live on 2026-09-07, with the level count cut down. The checksum is retired and always 0.
function booksFrame(
  instId: string,
  action: 'snapshot' | 'update',
  prevSeqId: number,
  seqId: number,
  bids: OkxBookLevel[],
  asks: OkxBookLevel[],
): Buffer {
  return Buffer.from(
    JSON.stringify({
      arg: { channel: 'books', instId },
      action,
      data: [
        { asks, bids, ts: '1788746279107', checksum: 0, prevSeqId, seqId },
      ],
    }),
  );
}

const SNAPSHOT_BIDS: OkxBookLevel[] = [
  ['79904.6', '362.46', '0', '52'],
  ['79904.5', '10', '0', '2'],
];
const SNAPSHOT_ASKS: OkxBookLevel[] = [
  ['79904.7', '42.95', '0', '16'],
  ['79904.8', '5', '0', '1'],
];

afterEach(() => jest.restoreAllMocks());

describe('OkxFeed.planEndpoints', () => {
  it('chunks every market onto the one public endpoint', () => {
    const { feed } = makeFeed(markets(300));
    const plans = feed.planEndpoints();

    expect(plans.map((p) => p.id)).toEqual(['okx#swap#0', 'okx#swap#1']);
    expect(plans.map((p) => p.markets.length)).toEqual([250, 50]);
    expect(plans[0].url).toBe('wss://ws.okx.com:8443/ws/v5/public');
  });

  it('returns nothing when the venue lists no markets', () => {
    const { feed } = makeFeed([]);

    expect(feed.planEndpoints()).toEqual([]);
  });
});

describe('OkxFeed.getSubscribeFrames', () => {
  it('builds one books argument per market and splits them across frames', () => {
    const { feed } = makeFeed([]);
    const frames = feed.getSubscribeFrames(markets(250)) as {
      id: string;
      op: string;
      args: { channel: string; instId: string }[];
    }[];

    expect(frames).toHaveLength(2);
    expect(frames[0].op).toBe('subscribe');
    expect(frames[0].args).toHaveLength(200);
    expect(frames[0].args[0]).toEqual({
      channel: 'books',
      instId: 'SYM0-USDT-SWAP',
    });
    expect(frames[1].args).toHaveLength(50);
    expect(frames.map((f) => f.id)).toEqual(['sub0', 'sub1']);
  });
});

describe('OkxFeed.handleMessage', () => {
  it('hands the engine a subscribed snapshot as the whole book, reading the first two of each tuple', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateBook } = makeFeed([market('BTC-USDT-SWAP')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      booksFrame(
        'BTC-USDT-SWAP',
        'snapshot',
        -1,
        100,
        SNAPSHOT_BIDS,
        SNAPSHOT_ASKS,
      ),
      c,
    );

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'BTC-USDT-SWAP',
      [
        [79904.6, 362.46],
        [79904.5, 10],
      ],
      [
        [79904.7, 42.95],
        [79904.8, 5],
      ],
      LOCAL_NOW,
    );
  });

  it('applies an update whose prevSeqId is the last seqId', () => {
    const { feed, updateBook } = makeFeed([market('BTC-USDT-SWAP')]);
    const c = connection(feed.planEndpoints()[0]);
    feed.handleMessage(
      booksFrame(
        'BTC-USDT-SWAP',
        'snapshot',
        -1,
        100,
        SNAPSHOT_BIDS,
        SNAPSHOT_ASKS,
      ),
      c,
    );

    feed.handleMessage(
      booksFrame(
        'BTC-USDT-SWAP',
        'update',
        100,
        101,
        [['79904.6', '0', '0', '0']],
        [['79904.7', '1', '0', '1']],
      ),
      c,
    );

    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'BTC-USDT-SWAP',
      [[79904.5, 10]],
      [
        [79904.7, 1],
        [79904.8, 5],
      ],
      expect.any(Number),
    );
  });

  it('skips a liveness update and keeps the chain where it was', () => {
    const { feed, updateBook } = makeFeed([market('BTC-USDT-SWAP')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);
    feed.handleMessage(
      booksFrame(
        'BTC-USDT-SWAP',
        'snapshot',
        -1,
        100,
        SNAPSHOT_BIDS,
        SNAPSHOT_ASKS,
      ),
      c,
    );

    feed.handleMessage(
      booksFrame('BTC-USDT-SWAP', 'update', 100, 100, [], []),
      c,
    );
    feed.handleMessage(
      booksFrame(
        'BTC-USDT-SWAP',
        'update',
        100,
        101,
        [['79904.4', '1', '0', '1']],
        [],
      ),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(2);
    expect(socket.terminate).not.toHaveBeenCalled();
  });

  it('restarts the connection when prevSeqId does not chain', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('BTC-USDT-SWAP')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);
    feed.handleMessage(
      booksFrame(
        'BTC-USDT-SWAP',
        'snapshot',
        -1,
        100,
        SNAPSHOT_BIDS,
        SNAPSHOT_ASKS,
      ),
      c,
    );

    feed.handleMessage(
      booksFrame(
        'BTC-USDT-SWAP',
        'update',
        101,
        102,
        [['79904.4', '1', '0', '1']],
        [],
      ),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(1);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'book_resync',
        rawMarketId: 'BTC-USDT-SWAP',
        reason: 'sequence_gap',
        expected: 100,
        got: 101,
      }),
    );
  });

  it('restarts the connection on an update with no snapshot behind it', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('BTC-USDT-SWAP')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.handleMessage(
      booksFrame(
        'BTC-USDT-SWAP',
        'update',
        99,
        100,
        [['79904.4', '1', '0', '1']],
        [],
      ),
      c,
    );

    expect(updateBook).not.toHaveBeenCalled();
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it('returns on the literal pong keepalive answer without parsing it', () => {
    const { feed, updateBook } = makeFeed([market('BTC-USDT-SWAP')]);
    const c = connection(feed.planEndpoints()[0]);

    expect(() => feed.handleMessage(Buffer.from('pong'), c)).not.toThrow();
    expect(updateBook).not.toHaveBeenCalled();
  });

  it('drops an instId the connection did not subscribe to, and warns once', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('BTC-USDT-SWAP')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      booksFrame(
        'ETH-USDT-SWAP',
        'snapshot',
        -1,
        1,
        SNAPSHOT_BIDS,
        SNAPSHOT_ASKS,
      ),
      c,
    );
    feed.handleMessage(
      booksFrame(
        'ETH-USDT-SWAP',
        'snapshot',
        -1,
        1,
        SNAPSHOT_BIDS,
        SNAPSHOT_ASKS,
      ),
      c,
    );

    expect(updateBook).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs an error event and a notice event, and stays silent on an acknowledgement', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('BTC-USDT-SWAP')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      Buffer.from(
        JSON.stringify({
          id: 'sub0',
          event: 'subscribe',
          arg: { channel: 'books', instId: 'BTC-USDT-SWAP' },
          connId: 'f280d68a',
        }),
      ),
      c,
    );
    feed.handleMessage(
      Buffer.from(
        JSON.stringify({ event: 'error', code: '60018', msg: 'Wrong URL' }),
      ),
      c,
    );
    feed.handleMessage(
      Buffer.from(
        JSON.stringify({
          event: 'notice',
          code: '64008',
          msg: 'The connection will soon be closed for a service upgrade.',
        }),
      ),
      c,
    );

    expect(updateBook).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
