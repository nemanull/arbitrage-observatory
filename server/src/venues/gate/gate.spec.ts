import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/cluster/types';
import type {
  EndpointPlan,
  SingleSocketConnection,
} from '../../feeds/book/types';
import { GateFeed } from './gate';

const VENUE_ID = 'gate';
const TAKER_PPM = 500;
const LOCAL_NOW = 1_789_455_580_300;
const LEVELS = 20;

type FeedProbe = {
  maxSilenceMs: number;
  planEndpoints(): EndpointPlan[];
  getSubscribeFrames(markets: Market[]): object[];
  startKeepalive(c: SingleSocketConnection): void;
  handleMessage(raw: Buffer, c: SingleSocketConnection): void;
};

function market(rawMarketId: string): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.slice(0, rawMarketId.indexOf('_')),
    quote: 'USDT',
    takerPpm: TAKER_PPM,
    linear: true,
    contractSize: 0.0001,
  };
}

function markets(count: number): Market[] {
  return Array.from({ length: count }, (_, i) => market(`SYM${i}_USDT`));
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
  const venue: Venue = { id: VENUE_ID, name: 'Gate', markets: venueMarkets };
  const engine = {
    updateBook,
    markStale: jest.fn(),
    depthLevels: LEVELS,
  } as unknown as Engine;
  const feed = new GateFeed(venue, engine) as unknown as FeedProbe;

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

function frame(body: object): Buffer {
  return Buffer.from(JSON.stringify(body));
}

// The envelope and result of futures.obu frames captured live on 2026-09-15, with the level count cut down.
function obu(result: object): Buffer {
  return frame({
    time: 1789455580,
    time_ms: 1789455580280,
    channel: 'futures.obu',
    event: 'update',
    result,
  });
}

const BTC_SNAPSHOT = obu({
  t: 1789455580261,
  full: true,
  s: 'ob.BTC_USDT.50',
  u: 125033675974,
  b: [
    ['77222.9', '600'],
    ['77222.5', '10'],
  ],
  a: [
    ['77235', '40'],
    ['77235.2', '7'],
  ],
});

// Captured as it came, one delta and then the id only delta that followed it.
const BTC_DELTA = obu({
  t: 1789455580280,
  s: 'ob.BTC_USDT.50',
  U: 125033675975,
  u: 125033676003,
  b: [['77222.9', '648']],
  a: [
    ['77235', '50'],
    ['77235.2', '0'],
  ],
});

const BTC_ID_ONLY_DELTA = obu({
  t: 1789455580300,
  s: 'ob.BTC_USDT.50',
  U: 125033676004,
  u: 125033676011,
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('GateFeed.planEndpoints', () => {
  it('puts 150 markets on each USDT socket', () => {
    const { feed } = makeFeed(markets(983));
    const plans = feed.planEndpoints();

    expect(plans).toHaveLength(7);
    expect(plans.map((p) => p.markets.length)).toEqual([
      150, 150, 150, 150, 150, 150, 83,
    ]);
    expect(plans[0].id).toBe('gate#usdt#0');
    expect(plans[0].url).toBe('wss://fx-ws.gateio.ws/v4/ws/usdt');
    expect(feed.maxSilenceMs).toBe(45_000);
  });
});

describe('GateFeed.getSubscribeFrames', () => {
  it('names every stream of the slice in one frame stamped in seconds', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed } = makeFeed([]);

    const slice = markets(150);
    const frames = feed.getSubscribeFrames(slice);

    expect(frames).toEqual([
      {
        time: 1789455580,
        channel: 'futures.obu',
        event: 'subscribe',
        payload: slice.map((m) => `ob.${m.rawMarketId}.50`),
      },
    ]);
    expect((frames[0] as { payload: string[] }).payload[0]).toBe(
      'ob.SYM0_USDT.50',
    );
  });
});

describe('GateFeed.startKeepalive', () => {
  it('sends futures.ping every 15 seconds with the time in seconds', () => {
    jest.useFakeTimers({ now: LOCAL_NOW });
    const { feed } = makeFeed([market('BTC_USDT')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.startKeepalive(c);
    jest.advanceTimersByTime(14_999);
    expect(socket.send).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(socket.send).toHaveBeenCalledWith(
      JSON.stringify({ time: 1789455595, channel: 'futures.ping' }),
    );
    expect(c.timers).toHaveLength(1);
  });
});

describe('GateFeed.handleMessage', () => {
  it('hands the engine a snapshot as the whole book', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateBook } = makeFeed([market('BTC_USDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(BTC_SNAPSHOT, c);

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'BTC_USDT',
      [
        [77222.9, 600],
        [77222.5, 10],
      ],
      [
        [77235, 40],
        [77235.2, 7],
      ],
      LOCAL_NOW,
    );
  });

  it('applies a delta whose U is the last u plus one', () => {
    const { feed, updateBook } = makeFeed([market('BTC_USDT')]);
    const c = connection(feed.planEndpoints()[0]);
    feed.handleMessage(BTC_SNAPSHOT, c);

    feed.handleMessage(BTC_DELTA, c);

    expect(updateBook).toHaveBeenCalledTimes(2);
    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'BTC_USDT',
      [
        [77222.9, 648],
        [77222.5, 10],
      ],
      [[77235, 50]],
      expect.any(Number),
    );
  });

  it('advances the id on a delta with no levels and publishes nothing for it', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('BTC_USDT')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);
    feed.handleMessage(BTC_SNAPSHOT, c);
    feed.handleMessage(BTC_DELTA, c);

    feed.handleMessage(BTC_ID_ONLY_DELTA, c);
    expect(updateBook).toHaveBeenCalledTimes(2);

    feed.handleMessage(
      obu({
        t: 1789455580320,
        s: 'ob.BTC_USDT.50',
        U: 125033676012,
        u: 125033676015,
        a: [['77234.9', '3']],
      }),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(3);
    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'BTC_USDT',
      expect.any(Array),
      [
        [77234.9, 3],
        [77235, 50],
      ],
      expect.any(Number),
    );
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
  });

  it('restarts the connection on a gap in the update id and applies nothing', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('BTC_USDT')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);
    feed.handleMessage(BTC_SNAPSHOT, c);

    feed.handleMessage(BTC_ID_ONLY_DELTA, c);

    expect(updateBook).toHaveBeenCalledTimes(1);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'book_resync',
        rawMarketId: 'BTC_USDT',
        reason: 'sequence_gap',
        expected: 125033675975,
        got: 125033676004,
      }),
    );
  });

  it('restarts the connection on a delta with no snapshot behind it', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('BTC_USDT')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.handleMessage(BTC_DELTA, c);

    expect(updateBook).not.toHaveBeenCalled();
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({ reason: 'delta_before_snapshot' }),
    );
  });

  it('takes a later full push as a replacement of the book', () => {
    const { feed, updateBook } = makeFeed([market('BTC_USDT')]);
    const c = connection(feed.planEndpoints()[0]);
    feed.handleMessage(BTC_SNAPSHOT, c);
    feed.handleMessage(BTC_DELTA, c);

    feed.handleMessage(
      obu({
        t: 1789455590000,
        full: true,
        s: 'ob.BTC_USDT.50',
        u: 125033680000,
        b: [['77100', '1']],
        a: [['77101', '2']],
      }),
      c,
    );

    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'BTC_USDT',
      [[77100, 1]],
      [[77101, 2]],
      expect.any(Number),
    );
  });

  it('routes a stream back to a contract id spelled outside ASCII', () => {
    const { feed, updateBook } = makeFeed([market('币安人生_USDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      obu({
        t: 1789456261122,
        full: true,
        s: 'ob.币安人生_USDT.50',
        u: 3258990980,
        b: [['0.01603', '777']],
        a: [['0.01609', '115']],
      }),
      c,
    );

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      '币安人生_USDT',
      [[0.01603, 777]],
      [[0.01609, 115]],
      expect.any(Number),
    );
  });

  it('drops a stream the connection did not subscribe to, and warns once', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('ETH_USDT')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.handleMessage(BTC_SNAPSHOT, c);
    feed.handleMessage(BTC_DELTA, c);

    expect(updateBook).not.toHaveBeenCalled();
    expect(socket.terminate).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs an error frame and stays silent on the acknowledgement and the pong', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { feed, updateBook } = makeFeed([market('BTC_USDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      frame({
        time: 1789456334,
        time_ms: 1789456334999,
        conn_id: 'c59a69fd3702aa1d',
        trace_id: '5597c780565cf57ad16784743225b18b',
        channel: 'futures.obu',
        event: 'subscribe',
        payload: ['ob.BTC_USDT.50', 'ob.ETH_USDT.50'],
        result: { status: 'success' },
      }),
      c,
    );
    feed.handleMessage(
      frame({
        time: 1789456354,
        time_ms: 1789456354999,
        conn_id: 'c59a69fd3702aa1d',
        channel: 'futures.pong',
        event: '',
        result: null,
      }),
      c,
    );
    feed.handleMessage(
      frame({
        time: 1789456896,
        time_ms: 1789456896882,
        conn_id: 'bf37dda1698c8b1e',
        channel: 'futures.obu',
        event: 'subscribe',
        payload: ['ob.BTC_USDT.50'],
        error: { code: 2, message: 'Alert sub ob.BTC_USDT.50' },
        result: { status: 'fail' },
      }),
      c,
    );

    expect(updateBook).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      'gate#usdt#0: futures.obu subscribe error 2: Alert sub ob.BTC_USDT.50',
    );
  });
});
