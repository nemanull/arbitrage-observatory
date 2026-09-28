import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/cluster/types';
import type {
  EndpointPlan,
  SingleSocketConnection,
} from '../../feeds/book/types';
import { GeminiFeed } from './gemini';
import type { GeminiBookLevel } from './types';

const VENUE_ID = 'gemini';
const LOCAL_NOW = 1_700_000_000_000;
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
    base: rawMarketId.slice(0, rawMarketId.indexOf('usdc')).toUpperCase(),
    quote: 'USDC',
    takerPpm: 700,
    linear: true,
    contractSize: 1,
  };
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
  const venue: Venue = { id: VENUE_ID, name: 'Gemini', markets: venueMarkets };
  const engine = {
    updateBook,
    markStale: jest.fn(),
    depthLevels: LEVELS,
  } as unknown as Engine;
  const feed = new GeminiFeed(venue, engine) as unknown as FeedProbe;

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

// The shape captured live on 2026-09-15, written as text so E keeps the wire's nanosecond integer above 2^53.
function depthFrame(
  s: string,
  U: number,
  u: number,
  b: GeminiBookLevel[],
  a: GeminiBookLevel[],
): Buffer {
  return Buffer.from(
    `{"e":"depthUpdate","E":1789505894447220874,"s":"${s}","U":${U},"u":${u},"b":${JSON.stringify(b)},"a":${JSON.stringify(a)}}`,
  );
}

function control(body: object): Buffer {
  return Buffer.from(JSON.stringify(body));
}

// The ETH snapshot cut down to two levels a side, then the two consecutive deltas captured after it.
const SNAPSHOT_U = 1764527605192323;
const SNAPSHOT_BIDS: GeminiBookLevel[] = [
  ['2482.5500', '1.047'],
  ['2482.0000', '2.000'],
];
const SNAPSHOT_ASKS: GeminiBookLevel[] = [
  ['2483.5000', '1.047'],
  ['2484.0000', '3.000'],
];

function snapshot(c: SingleSocketConnection, feed: FeedProbe): void {
  feed.handleMessage(
    depthFrame(
      'ethusdcperp',
      SNAPSHOT_U,
      SNAPSHOT_U,
      SNAPSHOT_BIDS,
      SNAPSHOT_ASKS,
    ),
    c,
  );
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('GeminiFeed.planEndpoints', () => {
  it('puts every market on one connection that asks for full snapshots', () => {
    const { feed } = makeFeed([market('btcusdcperp'), market('ethusdcperp')]);
    const plans = feed.planEndpoints();

    expect(plans).toHaveLength(1);
    expect(plans[0].id).toBe('gemini#swap#0');
    expect(plans[0].url).toBe('wss://ws.gemini.com?snapshot=-1');
    expect(plans[0].markets).toHaveLength(2);
    expect(feed.maxSilenceMs).toBe(60_000);
  });

  it('returns nothing when the venue lists no markets', () => {
    const { feed } = makeFeed([]);

    expect(feed.planEndpoints()).toEqual([]);
  });
});

describe('GeminiFeed.getSubscribeFrames', () => {
  it('names every market in one frame', () => {
    const { feed } = makeFeed([]);

    expect(
      feed.getSubscribeFrames([market('avaxusdcperp'), market('btcusdcperp')]),
    ).toEqual([
      {
        id: 1,
        method: 'subscribe',
        params: ['avaxusdcperp@depth@100ms', 'btcusdcperp@depth@100ms'],
      },
    ]);
  });
});

describe('GeminiFeed.startKeepalive', () => {
  it('sends the application ping every twenty seconds with a fresh id', () => {
    jest.useFakeTimers();
    const { feed } = makeFeed([market('btcusdcperp')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.startKeepalive(c);
    jest.advanceTimersByTime(40_000);

    expect(socket.send.mock.calls).toEqual([
      ['{"id":1,"method":"ping"}'],
      ['{"id":2,"method":"ping"}'],
    ]);
    expect(c.timers).toHaveLength(1);
  });
});

describe('GeminiFeed.handleMessage', () => {
  it('takes the first frame of a symbol as the whole book', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateBook } = makeFeed([market('ethusdcperp')]);
    const c = connection(feed.planEndpoints()[0]);

    snapshot(c, feed);

    expect(updateBook).toHaveBeenCalledWith(
      VENUE_ID,
      'ethusdcperp',
      [
        [2482.55, 1.047],
        [2482, 2],
      ],
      [
        [2483.5, 1.047],
        [2484, 3],
      ],
      LOCAL_NOW,
    );
  });

  it('applies a frame whose U equals the last u, with unsorted levels', () => {
    const { feed, updateBook } = makeFeed([market('ethusdcperp')]);
    const c = connection(feed.planEndpoints()[0]);
    snapshot(c, feed);

    feed.handleMessage(
      depthFrame(
        'ethusdcperp',
        SNAPSHOT_U,
        1764527605192686,
        [['2482.5500', '0.000']],
        [
          ['2483.5000', '0.000'],
          ['2483.4500', '1.047'],
        ],
      ),
      c,
    );
    feed.handleMessage(
      depthFrame(
        'ethusdcperp',
        1764527605192686,
        1764527605192712,
        [['2482.5500', '1.047']],
        [],
      ),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(3);
    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'ethusdcperp',
      [
        [2482.55, 1.047],
        [2482, 2],
      ],
      [
        [2483.45, 1.047],
        [2484, 3],
      ],
      expect.any(Number),
    );
  });

  it('applies a frame that straddles the last u', () => {
    const { feed, updateBook } = makeFeed([market('ethusdcperp')]);
    const c = connection(feed.planEndpoints()[0]);
    snapshot(c, feed);

    feed.handleMessage(
      depthFrame(
        'ethusdcperp',
        SNAPSHOT_U - 10,
        SNAPSHOT_U + 5,
        [['2482.6000', '0.5']],
        [],
      ),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(2);
    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'ethusdcperp',
      [
        [2482.6, 0.5],
        [2482.55, 1.047],
        [2482, 2],
      ],
      expect.any(Array),
      expect.any(Number),
    );
  });

  it('drops a frame whose u is at or below the last u', () => {
    const { feed, updateBook } = makeFeed([market('ethusdcperp')]);
    const c = connection(feed.planEndpoints()[0]);
    snapshot(c, feed);

    feed.handleMessage(
      depthFrame(
        'ethusdcperp',
        SNAPSHOT_U - 5,
        SNAPSHOT_U,
        [['1.0000', '1']],
        [],
      ),
      c,
    );
    feed.handleMessage(
      depthFrame(
        'ethusdcperp',
        SNAPSHOT_U - 9,
        SNAPSHOT_U - 1,
        [['1.0000', '1']],
        [],
      ),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(1);
  });

  it('restarts the connection when U skips past the last u', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('ethusdcperp')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);
    snapshot(c, feed);

    feed.handleMessage(
      depthFrame(
        'ethusdcperp',
        SNAPSHOT_U + 1,
        SNAPSHOT_U + 9,
        [['2482.6000', '0.5']],
        [],
      ),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(1);
    expect(socket.terminate).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'book_resync',
        rawMarketId: 'ethusdcperp',
        reason: 'sequence_gap',
        expected: SNAPSHOT_U,
        got: SNAPSHOT_U + 1,
      }),
    );
  });

  it('takes the first frame on a new connection as the whole book again', () => {
    const { feed, updateBook } = makeFeed([market('ethusdcperp')]);
    const plan = feed.planEndpoints()[0];
    snapshot(connection(plan), feed);

    // A frame on a reopened connection whose U is far past the old u would read as a gap if the old id were kept.
    feed.handleMessage(
      depthFrame(
        'ethusdcperp',
        SNAPSHOT_U + 1000,
        SNAPSHOT_U + 1000,
        [['2490.0000', '1']],
        [['2491.0000', '1']],
      ),
      connection(plan),
    );

    expect(updateBook).toHaveBeenCalledTimes(2);
    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'ethusdcperp',
      [[2490, 1]],
      [[2491, 1]],
      expect.any(Number),
    );
  });

  it('keeps each symbol on its own update id', () => {
    const { feed, updateBook } = makeFeed([
      market('ethusdcperp'),
      market('btcusdcperp'),
    ]);
    const c = connection(feed.planEndpoints()[0]);
    snapshot(c, feed);

    feed.handleMessage(
      depthFrame(
        'btcusdcperp',
        SNAPSHOT_U + 400,
        SNAPSHOT_U + 400,
        [['75955.500', '0.1387']],
        [['75981.500', '0.1713']],
      ),
      c,
    );
    feed.handleMessage(
      depthFrame(
        'ethusdcperp',
        SNAPSHOT_U,
        SNAPSHOT_U + 500,
        [['2482.6000', '0.5']],
        [],
      ),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(3);
  });

  it('logs a control reply whose status is not 200 and stays silent on the rest', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { feed, updateBook } = makeFeed([market('btcusdcperp')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(control({ id: 1, status: 200 }), c);
    feed.handleMessage(
      control({
        id: 3,
        status: 400,
        error: {
          code: -1013,
          msg: 'Invalid stream name: nosuchperp@depth@100ms',
        },
      }),
      c,
    );

    expect(updateBook).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      'gemini#swap#0: request 3 failed with status 400: -1013 Invalid stream name: nosuchperp@depth@100ms',
    );
  });

  it('drops a symbol the connection did not subscribe to, and warns once', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('btcusdcperp')]);
    const c = connection(feed.planEndpoints()[0]);

    snapshot(c, feed);
    snapshot(c, feed);

    expect(updateBook).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
