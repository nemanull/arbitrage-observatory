import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/cluster/types';
import type {
  EndpointPlan,
  SingleSocketConnection,
} from '../../feeds/book/types';
import { BitstampFeed } from './bitstamp';
import type { BitstampBookLevel } from './types';

const VENUE_ID = 'bitstamp';
const LOCAL_NOW = 1_700_000_000_000;
const LEVELS = 20;

type FeedProbe = {
  maxSilenceMs: number;
  firstBookWaitMs: number;
  planEndpoints(): EndpointPlan[];
  getSubscribeFrames(markets: Market[]): object[];
  startKeepalive(c: SingleSocketConnection): void;
  handleMessage(raw: Buffer, c: SingleSocketConnection): void;
};

function market(rawMarketId: string): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.slice(0, rawMarketId.indexOf('usd')).toUpperCase(),
    quote: 'USD',
    takerPpm: 150,
    linear: true,
    contractSize: 1,
  };
}

function socketStub() {
  return {
    readyState: 1,
    OPEN: 1,
    send: jest.fn(),
    close: jest.fn(),
    once: jest.fn(),
    terminate: jest.fn(),
  };
}

function makeFeed(venueMarkets: Market[]) {
  const updateBook = jest.fn();
  const venue: Venue = {
    id: VENUE_ID,
    name: 'Bitstamp',
    markets: venueMarkets,
  };
  const engine = {
    updateBook,
    markStale: jest.fn(),
    depthLevels: LEVELS,
  } as unknown as Engine;
  const feed = new BitstampFeed(venue, engine) as unknown as FeedProbe;

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
    reopenOnClose: false,
    timers: [],
  } as unknown as SingleSocketConnection;
}

function frame(body: object): Buffer {
  return Buffer.from(JSON.stringify(body));
}

// The shape captured live on 2026-09-15, with the level count cut down to three.
function bookFrame(
  rawMarketId: string,
  microtimestamp: string,
  bids: BitstampBookLevel[],
  asks: BitstampBookLevel[],
): Buffer {
  return frame({
    data: {
      timestamp: microtimestamp.slice(0, 10),
      microtimestamp,
      bids,
      asks,
    },
    channel: `order_book_${rawMarketId}`,
    event: 'data',
  });
}

const BIDS: BitstampBookLevel[] = [
  ['77188', '0.41122'],
  ['77183', '0.32386'],
  ['77180', '1.87131'],
];
const ASKS: BitstampBookLevel[] = [
  ['77189', '0.41124'],
  ['77193', '0.32385'],
  ['77194', '1.10113'],
];

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('BitstampFeed', () => {
  it('waits a minute for a first book and tolerates a minute of silence', () => {
    const { feed } = makeFeed([]);

    expect(feed.firstBookWaitMs).toBe(60_000);
    expect(feed.maxSilenceMs).toBe(60_000);
  });
});

describe('BitstampFeed.planEndpoints', () => {
  it('puts every market on one connection', () => {
    const { feed } = makeFeed([market('btcusd-perp'), market('asterusd-perp')]);
    const plans = feed.planEndpoints();

    expect(plans).toHaveLength(1);
    expect(plans[0].id).toBe('bitstamp#swap#0');
    expect(plans[0].url).toBe('wss://ws.bitstamp.net');
    expect(plans[0].markets).toHaveLength(2);
  });

  it('returns nothing when the venue lists no markets', () => {
    const { feed } = makeFeed([]);

    expect(feed.planEndpoints()).toEqual([]);
  });
});

describe('BitstampFeed.getSubscribeFrames', () => {
  it('sends one book channel per frame', () => {
    const { feed } = makeFeed([]);

    expect(
      feed.getSubscribeFrames([
        market('btcusd-perp'),
        market('silverusd-perp'),
      ]),
    ).toEqual([
      { event: 'bts:subscribe', data: { channel: 'order_book_btcusd-perp' } },
      {
        event: 'bts:subscribe',
        data: { channel: 'order_book_silverusd-perp' },
      },
    ]);
  });
});

describe('BitstampFeed.startKeepalive', () => {
  it('sends the heartbeat every twenty seconds while the socket is open', () => {
    jest.useFakeTimers();
    const { feed } = makeFeed([market('btcusd-perp')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.startKeepalive(c);
    jest.advanceTimersByTime(20_000);

    expect(socket.send).toHaveBeenCalledWith('{"event":"bts:heartbeat"}');
    expect(c.timers).toHaveLength(1);
  });
});

describe('BitstampFeed.handleMessage', () => {
  it('hands the engine every data frame as the whole book', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateBook } = makeFeed([market('btcusd-perp')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      bookFrame('btcusd-perp', '1789457617906487', BIDS, ASKS),
      c,
    );
    feed.handleMessage(
      bookFrame(
        'btcusd-perp',
        '1789457618106112',
        [['77187', '0.5']],
        [['77190', '0.2']],
      ),
      c,
    );

    expect(updateBook).toHaveBeenNthCalledWith(
      1,
      VENUE_ID,
      'btcusd-perp',
      [
        [77188, 0.41122],
        [77183, 0.32386],
        [77180, 1.87131],
      ],
      [
        [77189, 0.41124],
        [77193, 0.32385],
        [77194, 1.10113],
      ],
      LOCAL_NOW,
    );
    expect(updateBook).toHaveBeenLastCalledWith(
      VENUE_ID,
      'btcusd-perp',
      [[77187, 0.5]],
      [[77190, 0.2]],
      LOCAL_NOW,
    );
  });

  it('drops a frame whose microtimestamp is not above the last applied one', () => {
    const { feed, updateBook } = makeFeed([market('btcusd-perp')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      bookFrame('btcusd-perp', '1789457617906487', BIDS, ASKS),
      c,
    );
    feed.handleMessage(
      bookFrame('btcusd-perp', '1789457617906486', [['1', '1']], ASKS),
      c,
    );
    feed.handleMessage(
      bookFrame('btcusd-perp', '1789457617906487', [['1', '1']], ASKS),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(1);
  });

  it('keeps each market on its own microtimestamp', () => {
    const { feed, updateBook } = makeFeed([
      market('btcusd-perp'),
      market('asterusd-perp'),
    ]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      bookFrame('btcusd-perp', '1789457617906487', BIDS, ASKS),
      c,
    );
    feed.handleMessage(
      bookFrame(
        'asterusd-perp',
        '1789456316294301',
        [['0.68704', '18089']],
        [['0.68806', '30']],
      ),
      c,
    );

    expect(updateBook).toHaveBeenCalledTimes(2);
  });

  it('closes the connection with reopen on a reconnect request', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('btcusd-perp')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.handleMessage(
      frame({ event: 'bts:request_reconnect', channel: '', data: null }),
      c,
    );

    expect(socket.close).toHaveBeenCalledTimes(1);
    expect(c.reopenOnClose).toBe(true);
    expect(updateBook).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('logs an error frame and stays silent on the acknowledgement and the heartbeat answer', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { feed, updateBook } = makeFeed([market('btcusd-perp')]);
    const socket = socketStub();
    const c = connection(feed.planEndpoints()[0], socket);

    feed.handleMessage(
      frame({
        event: 'bts:subscription_succeeded',
        channel: 'order_book_btcusd-perp',
        data: {},
      }),
      c,
    );
    feed.handleMessage(
      frame({
        event: 'bts:heartbeat',
        channel: '',
        data: { status: 'success' },
      }),
      c,
    );
    feed.handleMessage(
      frame({
        event: 'bts:error',
        channel: '',
        data: { code: null, message: 'Invalid channel provided.' },
      }),
      c,
    );

    expect(updateBook).not.toHaveBeenCalled();
    expect(socket.close).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error).toHaveBeenCalledWith(
      'bitstamp#swap#0: bts:error (code none): Invalid channel provided.',
    );
  });

  it('ignores the diff and funding channels', () => {
    const { feed, updateBook } = makeFeed([market('btcusd-perp')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      frame({
        data: {
          market: 'btcusd-perp',
          mark_price: '77186.81199586',
          index_price: '77177.99454545454',
          funding_rate: '0.000123',
          timestamp: '1789457618',
          next_funding_time: '1789459200',
        },
        channel: 'funding_rate_btcusd-perp',
        event: 'funding_rate_saved',
      }),
      c,
    );
    feed.handleMessage(
      frame({
        data: {
          timestamp: '1789456316',
          microtimestamp: '1789456316507635',
          bids: [['77049', '0.00000']],
          asks: [],
        },
        channel: 'diff_order_book_btcusd-perp',
        event: 'data',
      }),
      c,
    );

    expect(updateBook).not.toHaveBeenCalled();
  });

  it('drops a market the connection did not subscribe to, and warns once', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateBook } = makeFeed([market('btcusd-perp')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      bookFrame('ethusd-perp', '1789457617906487', BIDS, ASKS),
      c,
    );
    feed.handleMessage(
      bookFrame('ethusd-perp', '1789457617906488', BIDS, ASKS),
      c,
    );

    expect(updateBook).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
