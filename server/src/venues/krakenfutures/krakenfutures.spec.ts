import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/types';
import type { EndpointPlan, SingleSocketConnection } from '../../ws/types';
import { KrakenFuturesFeed } from './krakenfutures';

const VENUE_ID = 'krakenfutures';
const TAKER_PPM = 500;

// recvTs must come from the local clock, because MAX_QUOTE_AGE_MS is compared against Date.now() everywhere.
const LOCAL_NOW = 1_700_000_000_000;
const PUBLIC_URL = 'wss://futures.kraken.com/ws/v1';

// Every frame below was captured verbatim from the live venue on 2026-09-05.
const TICKER_FRAME =
  '{"time":1788646159008,"product_id":"PF_XBTUSD","funding_rate":0.9941052570914733,"funding_rate_prediction":0.74094239761875,"relative_funding_rate":0.000012439370833333,"relative_funding_rate_prediction":9.275625e-6,"next_funding_rate_time":1788649200000,"leverage":"100x","premium":0.0,"feed":"ticker","bid":79874.0,"ask":79875.0,"bid_size":0.0656,"ask_size":0.0617,"volume":2426.872,"dtm":0,"index":79871.28,"last":79874.0,"change":0.3,"suspended":false,"tag":"perpetual","pair":"XBT:USD","openInterest":2055.214,"markPrice":79873.40587777576,"maturityTime":0,"post_only":false,"volumeQuote":193603003.7945,"open":79634.0,"high":80210.0,"low":79457.0}';

// A low priced contract, whose prices arrive in exponent notation rather than as plain decimals.
const EXPONENT_FRAME =
  '{"time":1788646159008,"product_id":"PF_SHIBUSD","feed":"ticker","bid":5.494e-6,"ask":5.498e-6,"bid_size":200803000.0,"ask_size":20812000.0,"tag":"perpetual","pair":"SHIB:USD"}';

const CONNECT_BANNER = '{"event":"info","version":1}';
const SUBSCRIBE_ACK =
  '{"event":"subscribed","feed":"ticker","product_ids":["PF_XBTUSD"]}';
const ALERT_FRAME =
  '{"event":"alert","message":"Couldn\'t subscribe to invalid product `PF_NOTAREALTHING`"}';

type FeedProbe = {
  planEndpoints(): EndpointPlan[];
  getSubscribeFrames(markets: Market[]): object[];
  startKeepalive(c: SingleSocketConnection): void;
  handleMessage(raw: Buffer, c: SingleSocketConnection): void;
};

function socketStub() {
  return { readyState: 1, OPEN: 1, ping: jest.fn(), send: jest.fn() };
}

// CCXT normalizes the base to BTC while market.id keeps the venue's XBT spelling, so the two are never derived from each other.
function market(rawMarketId: string, base = 'BTC'): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base,
    quote: 'USD',
    takerPpm: TAKER_PPM,
    linear: true,
  };
}

function markets(count: number): Market[] {
  return Array.from({ length: count }, (_, i) =>
    market(`PF_SYM${i}USD`, `SYM${i}`),
  );
}

function makeFeed(venueMarkets: Market[]) {
  const updateQuote = jest.fn();
  const venue: Venue = {
    id: VENUE_ID,
    name: 'Kraken Futures',
    markets: venueMarkets,
  };
  const engine = { updateQuote, markStale: jest.fn() } as unknown as Engine;
  const feed = new KrakenFuturesFeed(venue, engine) as unknown as FeedProbe;

  return { feed, updateQuote };
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

function ticker(productId: string, bid: unknown, ask: unknown): Buffer {
  return Buffer.from(
    JSON.stringify({ feed: 'ticker', product_id: productId, bid, ask }),
  );
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('KrakenFuturesFeed.planEndpoints', () => {
  it('chunks every market onto the one public endpoint', () => {
    const { feed } = makeFeed([market('PF_XBTUSD'), ...markets(120)]);
    const plans = feed.planEndpoints();

    expect(plans.map((p) => p.id)).toEqual([
      'krakenfutures#swap#0',
      'krakenfutures#swap#1',
    ]);
    expect(plans.map((p) => p.markets.length)).toEqual([100, 21]);
    expect(plans.map((p) => p.url)).toEqual([PUBLIC_URL, PUBLIC_URL]);
  });

  it('returns nothing when the venue lists no markets', () => {
    const { feed } = makeFeed([]);

    expect(feed.planEndpoints()).toEqual([]);
  });
});

describe('KrakenFuturesFeed.getSubscribeFrames', () => {
  it('names the feed once and passes the product ids as one array', () => {
    const { feed } = makeFeed([]);
    const frames = feed.getSubscribeFrames(markets(250)) as {
      event: string;
      feed: string;
      product_ids: string[];
    }[];

    expect(frames).toHaveLength(3);
    expect(frames[0].event).toBe('subscribe');
    expect(frames[0].feed).toBe('ticker');
    expect(frames[0].product_ids).toHaveLength(100);
    expect(frames[0].product_ids[0]).toBe('PF_SYM0USD');
    expect(frames[2].product_ids).toHaveLength(50);
  });
});

describe('KrakenFuturesFeed.handleMessage', () => {
  it('submits a subscribed ticker frame as a quote', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateQuote } = makeFeed([market('PF_XBTUSD')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(Buffer.from(TICKER_FRAME), c);

    expect(updateQuote).toHaveBeenCalledWith(VENUE_ID, 'PF_XBTUSD', {
      rawMarketId: 'PF_XBTUSD',
      bid: 79874,
      ask: 79875,
      recvTs: LOCAL_NOW,
    });
  });

  // Kraken is the only venue that sends prices as JSON numbers.
  // A string guard copied from another feed would reject every quote while the socket stayed healthy, so this is the regression guard.
  it('takes numeric prices straight through, including exponent notation', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateQuote } = makeFeed([market('PF_SHIBUSD', 'SHIB')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(Buffer.from(EXPONENT_FRAME), c);

    expect(updateQuote).toHaveBeenCalledWith(VENUE_ID, 'PF_SHIBUSD', {
      rawMarketId: 'PF_SHIBUSD',
      bid: 5.494e-6,
      ask: 5.498e-6,
      recvTs: LOCAL_NOW,
    });
  });

  it('drops a product the connection did not subscribe to, and warns once', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateQuote } = makeFeed([market('PF_XBTUSD')]);
    const c = connection(feed.planEndpoints()[0]);
    const raw = ticker('PF_ETHUSD', 2491.5, 2491.6);

    feed.handleMessage(raw, c);
    feed.handleMessage(raw, c);

    expect(updateQuote).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('ignores a zero sided and a one sided book', () => {
    const { feed, updateQuote } = makeFeed([market('PF_XBTUSD')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(ticker('PF_XBTUSD', 0, 0), c);
    feed.handleMessage(ticker('PF_XBTUSD', 79874, undefined), c);
    feed.handleMessage(ticker('PF_XBTUSD', undefined, 79875), c);

    expect(updateQuote).not.toHaveBeenCalled();
  });

  it('logs an alert and stays silent on the banner and the acknowledgement', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    const { feed, updateQuote } = makeFeed([market('PF_XBTUSD')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(Buffer.from(ALERT_FRAME), c);
    feed.handleMessage(Buffer.from(CONNECT_BANNER), c);
    feed.handleMessage(Buffer.from(SUBSCRIBE_ACK), c);

    expect(updateQuote).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    // A plan opens with one acknowledgement per product, so a line each would bury the open of every socket.
    expect(warn).not.toHaveBeenCalled();
    expect(log).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });
});

describe('KrakenFuturesFeed.startKeepalive', () => {
  // Every JSON ping shape this venue accepts is answered with 'Bad websocket message', because the JSON
  // application ping Kraken documents belongs to the spot socket. Only a protocol ping works here.
  it('sends a protocol ping and never a JSON one', () => {
    jest.useFakeTimers();
    const socket = socketStub();
    const { feed } = makeFeed([market('PF_XBTUSD')]);
    const c = connection(feed.planEndpoints()[0], socket);

    feed.startKeepalive(c);
    jest.advanceTimersByTime(60_000);

    expect(socket.ping).toHaveBeenCalledTimes(3);
    expect(socket.send).not.toHaveBeenCalled();
    expect(c.timers).toHaveLength(1);
  });
});
