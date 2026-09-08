import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/types';
import type { EndpointPlan, SingleSocketConnection } from '../../ws/types';
import { CoinbaseFeed } from './coinbase';

const VENUE_ID = 'coinbase';
const TAKER_PPM = 400;

// recvTs must come from the local clock, because openedAt, sampleTs and durationMs are measured on it across every venue.
const LOCAL_NOW = 1_700_000_000_000;
const LEVELS = 20;
const PUBLIC_URL = 'wss://advanced-trade-ws.coinbase.com';

// Captured verbatim from the live venue on 2026-09-07, with the update count cut down.
const SNAPSHOT_FRAME =
  '{"channel":"l2_data","client_id":"","timestamp":"2026-09-07T01:57:58.894355Z","sequence_num":0,"events":[{"type":"snapshot","product_id":"BTC-PERP-INTX","updates":[{"side":"offer","event_time":"2026-09-07T01:57:58.894355Z","price_level":"79944.1","new_quantity":"1.2"},{"side":"bid","event_time":"2026-09-07T01:57:58.894355Z","price_level":"79943.9","new_quantity":"3.0105"},{"side":"bid","event_time":"2026-09-07T01:57:58.894355Z","price_level":"79943.8","new_quantity":"0.5"},{"side":"offer","event_time":"2026-09-07T01:57:58.894355Z","price_level":"79944","new_quantity":"0.048"}]}]}';
const LEVEL2_ACK =
  '{"channel":"subscriptions","timestamp":"2026-09-07T23:37:22.278662782Z","sequence_num":1,"events":[{"subscriptions":{"level2":["BTC-PERP-INTX","ETH-PERP-INTX"]}}]}';
const HEARTBEATS_ACK =
  '{"channel":"subscriptions","timestamp":"2026-09-07T23:37:22.278739877Z","sequence_num":2,"events":[{"subscriptions":{"heartbeats":["heartbeats"],"level2":["BTC-PERP-INTX","ETH-PERP-INTX"]}}]}';
const HEARTBEAT_FRAME =
  '{"channel":"heartbeats","timestamp":"2026-09-07T23:37:22.675755362Z","sequence_num":3,"events":[{"current_time":"2026-09-07 23:37:22.674409 +0000 UTC m=+139651.272674714","heartbeat_counter":139651}]}';
// The venue reports an unknown channel name as an authentication failure, which is not what went wrong.
const ERROR_FRAME = '{"type":"error","message":"authentication failure"}';

type FeedProbe = {
  planEndpoints(): EndpointPlan[];
  getSubscribeFrames(markets: Market[]): object[];
  startKeepalive(c: SingleSocketConnection): void;
  handleMessage(raw: Buffer, c: SingleSocketConnection): void;
};

function socketStub() {
  return {
    readyState: 1,
    OPEN: 1,
    ping: jest.fn(),
    send: jest.fn(),
    terminate: jest.fn(),
  };
}

function market(rawMarketId: string): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.split('-')[0],
    quote: 'USDC',
    takerPpm: TAKER_PPM,
    linear: true,
    contractSize: 1,
  };
}

function markets(count: number): Market[] {
  return Array.from({ length: count }, (_, i) => market(`SYM${i}-PERP-INTX`));
}

function makeFeed(venueMarkets: Market[]) {
  const updateBook = jest.fn();
  const venue: Venue = {
    id: VENUE_ID,
    name: 'Coinbase Advanced',
    markets: venueMarkets,
  };
  const engine = {
    updateBook,
    markStale: jest.fn(),
    depthLevels: LEVELS,
  } as unknown as Engine;
  const feed = new CoinbaseFeed(venue, engine) as unknown as FeedProbe;

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

function l2Frame(
  sequence: number,
  events: {
    type: 'snapshot' | 'update';
    product_id: string;
    updates: {
      side: 'bid' | 'offer';
      price_level: string;
      new_quantity: string;
    }[];
  }[],
): Buffer {
  return Buffer.from(
    JSON.stringify({ channel: 'l2_data', sequence_num: sequence, events }),
  );
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('CoinbaseFeed.planEndpoints', () => {
  it('puts about thirty products on each connection', () => {
    const { feed } = makeFeed(markets(61));
    const plans = feed.planEndpoints();

    expect(plans.map((p) => p.id)).toEqual([
      'coinbase#swap#0',
      'coinbase#swap#1',
      'coinbase#swap#2',
    ]);
    expect(plans.map((p) => p.markets.length)).toEqual([30, 30, 1]);
    expect(plans[0].url).toBe(PUBLIC_URL);
  });

  it('returns nothing when the venue lists no markets', () => {
    const { feed } = makeFeed([]);

    expect(feed.planEndpoints()).toEqual([]);
  });
});

describe('CoinbaseFeed.getSubscribeFrames', () => {
  it('subscribes level2 before heartbeats', () => {
    const { feed } = makeFeed([]);
    const frames = feed.getSubscribeFrames(markets(2));

    expect(frames).toEqual([
      {
        type: 'subscribe',
        channel: 'level2',
        product_ids: ['SYM0-PERP-INTX', 'SYM1-PERP-INTX'],
      },
      { type: 'subscribe', channel: 'heartbeats' },
    ]);
  });
});

describe('CoinbaseFeed.handleMessage', () => {
  const BTC = market('BTC-PERP-INTX');
  const ETH = market('ETH-PERP-INTX');

  it('hands the engine a snapshot as the whole book, sorted, with offers as asks', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateBook } = makeFeed([BTC, ETH]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(Buffer.from(SNAPSHOT_FRAME), c);

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'BTC-PERP-INTX',
      [
        [79943.9, 3.0105],
        [79943.8, 0.5],
      ],
      [
        [79944, 0.048],
        [79944.1, 1.2],
      ],
      LOCAL_NOW,
    );
  });

  it('applies an update event and hands over the new top', () => {
    const { feed, updateBook } = makeFeed([BTC, ETH]);
    const c = connection(feed.planEndpoints()[0]);
    feed.handleMessage(Buffer.from(SNAPSHOT_FRAME), c);

    feed.handleMessage(
      l2Frame(1, [
        {
          type: 'update',
          product_id: 'BTC-PERP-INTX',
          updates: [
            { side: 'bid', price_level: '79943.9', new_quantity: '0' },
            { side: 'offer', price_level: '79944', new_quantity: '2' },
          ],
        },
      ]),
      c,
    );

    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'BTC-PERP-INTX',
      [[79943.8, 0.5]],
      [
        [79944, 2],
        [79944.1, 1.2],
      ],
      expect.any(Number),
    );
  });

  it('counts the sequence across every channel on the connection', () => {
    const { feed, updateBook } = makeFeed([BTC, ETH]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.handleMessage(Buffer.from(SNAPSHOT_FRAME), c);
    feed.handleMessage(Buffer.from(LEVEL2_ACK), c);
    feed.handleMessage(Buffer.from(HEARTBEATS_ACK), c);
    feed.handleMessage(Buffer.from(HEARTBEAT_FRAME), c);
    feed.handleMessage(
      l2Frame(4, [
        {
          type: 'update',
          product_id: 'BTC-PERP-INTX',
          updates: [{ side: 'bid', price_level: '79943.7', new_quantity: '1' }],
        },
      ]),
      c,
    );

    expect(socket.terminate).not.toHaveBeenCalled();
    expect(updateBook).toHaveBeenCalledTimes(2);
  });

  it('restarts the connection on a sequence gap and drops the frame', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([BTC, ETH]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);
    feed.handleMessage(Buffer.from(SNAPSHOT_FRAME), c);

    feed.handleMessage(
      l2Frame(2, [
        {
          type: 'update',
          product_id: 'BTC-PERP-INTX',
          updates: [{ side: 'bid', price_level: '79943.7', new_quantity: '1' }],
        },
      ]),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(1);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'book_resync',
        reason: 'sequence_gap',
        expected: 1,
        got: 2,
      }),
    );
  });

  it('restarts the connection on an update with no snapshot behind it', () => {
    jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([BTC, ETH]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.handleMessage(
      l2Frame(0, [
        {
          type: 'update',
          product_id: 'BTC-PERP-INTX',
          updates: [{ side: 'bid', price_level: '79943.7', new_quantity: '1' }],
        },
      ]),
      c,
    );

    expect(updateBook).not.toHaveBeenCalled();
    expect(socket.terminate).toHaveBeenCalledTimes(1);
  });

  it('routes every event in one frame by its own product id', () => {
    const { feed, updateBook } = makeFeed([BTC, ETH]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      l2Frame(0, [
        {
          type: 'snapshot',
          product_id: 'BTC-PERP-INTX',
          updates: [{ side: 'bid', price_level: '79943.9', new_quantity: '1' }],
        },
        {
          type: 'snapshot',
          product_id: 'ETH-PERP-INTX',
          updates: [{ side: 'offer', price_level: '3001', new_quantity: '2' }],
        },
      ]),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(2);
    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'BTC-PERP-INTX',
      [[79943.9, 1]],
      [],
      expect.any(Number),
    );
    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'ETH-PERP-INTX',
      [],
      [[3001, 2]],
      expect.any(Number),
    );
  });

  it('treats a heartbeat as liveness only', () => {
    const { feed, updateBook } = makeFeed([BTC, ETH]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(Buffer.from(HEARTBEAT_FRAME), c);

    expect(updateBook).not.toHaveBeenCalled();
  });

  it('stays silent when the acknowledgement lists every subscribed product', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed } = makeFeed([BTC, ETH]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(Buffer.from(LEVEL2_ACK), c);
    feed.handleMessage(Buffer.from(HEARTBEATS_ACK), c);

    expect(warn).not.toHaveBeenCalled();
  });

  it('warns about a subscribed product the acknowledgement omits', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed } = makeFeed([BTC, ETH, market('SOL-PERP-INTX')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(Buffer.from(LEVEL2_ACK), c);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('1 of 3');
    expect(warn.mock.calls[0][0]).toContain('SOL-PERP-INTX');
  });

  it('warns when the acknowledgement carries no level2 list at all', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed } = makeFeed([BTC]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      Buffer.from(
        JSON.stringify({
          channel: 'subscriptions',
          sequence_num: 0,
          events: [{ subscriptions: { heartbeats: ['heartbeats'] } }],
        }),
      ),
      c,
    );

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('1 of 1');
  });

  it('drops a product the connection did not subscribe to, and warns once', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([BTC]);
    const c = connection(feed.planEndpoints()[0]);
    const stray = {
      type: 'snapshot' as const,
      product_id: 'ETH-PERP-INTX',
      updates: [
        { side: 'bid' as const, price_level: '3000', new_quantity: '1' },
      ],
    };

    feed.handleMessage(l2Frame(0, [stray]), c);
    feed.handleMessage(l2Frame(1, [stray]), c);

    expect(updateBook).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs the raw text of an error frame', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { feed } = makeFeed([BTC]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(Buffer.from(ERROR_FRAME), c);

    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('authentication failure');
  });
});

describe('CoinbaseFeed.startKeepalive', () => {
  it('installs no timer and writes nothing to the socket', () => {
    jest.useFakeTimers();
    const { feed } = makeFeed([market('BTC-PERP-INTX')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.startKeepalive(c);
    jest.advanceTimersByTime(60_000);

    expect(c.timers).toHaveLength(0);
    expect(socket.send).not.toHaveBeenCalled();
    expect(socket.ping).not.toHaveBeenCalled();
  });
});
