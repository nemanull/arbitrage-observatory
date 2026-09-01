import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/types';
import type { EndpointPlan, SingleSocketConnection } from '../../ws/types';
import { BybitFeed } from './bybit';
import type { BybitOrderbookLevel } from './types';

const VENUE_ID = 'bybit';
const TAKER_PPM = 550;

// recvTs must come from the local clock, because MAX_QUOTE_AGE_MS is compared against Date.now() everywhere.
// A venue timestamp here would make staleness depend on clock skew, so the quote is asserted whole rather than partially.
const LOCAL_NOW = 1_700_000_000_000;

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
  };
}

function markets(count: number, linear = true): Market[] {
  return Array.from({ length: count }, (_, i) => market(`SYM${i}USDT`, linear));
}

function makeFeed(venueMarkets: Market[]) {
  const updateQuote = jest.fn();
  const venue: Venue = { id: VENUE_ID, name: 'Bybit', markets: venueMarkets };
  const engine = { updateQuote, markStale: jest.fn() } as unknown as Engine;
  const feed = new BybitFeed(venue, engine) as unknown as FeedProbe;

  return { feed, updateQuote };
}

function connection(plan: EndpointPlan): SingleSocketConnection {
  return {
    id: plan.id,
    plan,
    accepted: new Set(plan.markets.map((m) => m.rawMarketId)),
    lastMessageAt: 0,
    attempt: 0,
    reopenOnClose: true,
    timers: [],
  } as unknown as SingleSocketConnection;
}

// Both sides are arrays of pairs, so a side is passed in whole and an empty one stands for a one sided book.
function snapshot(
  symbol: string,
  b: BybitOrderbookLevel[],
  a: BybitOrderbookLevel[],
): Buffer {
  return Buffer.from(
    JSON.stringify({
      topic: `orderbook.1.${symbol}`,
      ts: 1788196766989,
      type: 'snapshot',
      data: { s: symbol, b, a, u: 2754993, seq: 167284197064 },
      cts: 1788196766988,
    }),
  );
}

function control(success: boolean, retMsg: string, op: string): Buffer {
  return Buffer.from(
    JSON.stringify({
      success,
      ret_msg: retMsg,
      conn_id: 'da7toksptl6ofi3lcj7g-1d8b6',
      req_id: 'big',
      op,
    }),
  );
}

afterEach(() => jest.restoreAllMocks());

describe('BybitFeed.planEndpoints', () => {
  it('chunks linear markets onto the linear endpoint', () => {
    const { feed } = makeFeed(markets(250));
    const plans = feed.planEndpoints();

    expect(plans.map((p) => p.id)).toEqual([
      'bybit#linear#0',
      'bybit#linear#1',
    ]);
    expect(plans.map((p) => p.markets.length)).toEqual([200, 50]);
    expect(plans.map((p) => p.url)).toEqual([
      'wss://stream.bybit.com/v5/public/linear',
      'wss://stream.bybit.com/v5/public/linear',
    ]);
  });

  it('sends inverse markets to the inverse endpoint on their own plans', () => {
    const { feed } = makeFeed([market('BTCUSDT'), market('BTCUSD', false)]);
    const plans = feed.planEndpoints();

    expect(plans.map((p) => p.id)).toEqual([
      'bybit#linear#0',
      'bybit#inverse#0',
    ]);
    expect(plans[1].url).toBe('wss://stream.bybit.com/v5/public/inverse');
    expect(plans[1].markets.map((m) => m.rawMarketId)).toEqual(['BTCUSD']);
  });

  it('returns nothing when the venue lists no markets', () => {
    const { feed } = makeFeed([]);

    expect(feed.planEndpoints()).toEqual([]);
  });
});

describe('BybitFeed.getSubscribeFrames', () => {
  it('builds depth one topics and splits them across frames', () => {
    const { feed } = makeFeed([]);
    const frames = feed.getSubscribeFrames(markets(250)) as {
      req_id: string;
      op: string;
      args: string[];
    }[];

    expect(frames).toHaveLength(2);
    expect(frames[0].op).toBe('subscribe');
    expect(frames[0].args).toHaveLength(200);
    expect(frames[0].args[0]).toBe('orderbook.1.SYM0USDT');
    expect(frames[1].args).toHaveLength(50);
    expect(frames[1].args[0]).toBe('orderbook.1.SYM200USDT');
    expect(frames.map((f) => f.req_id)).toEqual(['sub-1', 'sub-2']);
  });
});

describe('BybitFeed.startKeepalive', () => {
  it('sends the application ping while the socket is open', () => {
    jest.useFakeTimers();
    const send = jest.fn();
    const { feed } = makeFeed([market('BTCUSDT')]);
    const c = connection(feed.planEndpoints()[0]);
    c.socket = { readyState: 1, OPEN: 1, send } as unknown as typeof c.socket;

    feed.startKeepalive(c);
    jest.advanceTimersByTime(60_000);

    expect(send).toHaveBeenCalledTimes(3);
    expect(send).toHaveBeenLastCalledWith('{"op":"ping"}');
    expect(c.timers).toHaveLength(1);

    jest.useRealTimers();
  });
});

describe('BybitFeed.handleMessage', () => {
  it('submits a subscribed depth one snapshot as a quote', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateQuote } = makeFeed([market('0GUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      snapshot('0GUSDT', [['0.2225', '1952.1']], [['0.2226', '1.2']]),
      c,
    );

    expect(updateQuote).toHaveBeenCalledWith(VENUE_ID, '0GUSDT', {
      rawMarketId: '0GUSDT',
      bid: 0.2225,
      ask: 0.2226,
      recvTs: LOCAL_NOW,
    });
  });

  it('drops a symbol the connection did not subscribe to, and warns once', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateQuote } = makeFeed([market('0GUSDT')]);
    const c = connection(feed.planEndpoints()[0]);
    const raw = snapshot('BTCUSDT', [['1', '2']], [['3', '4']]);

    feed.handleMessage(raw, c);
    feed.handleMessage(raw, c);

    expect(updateQuote).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('ignores a one sided book', () => {
    const { feed, updateQuote } = makeFeed([market('0GUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(snapshot('0GUSDT', [['0.2225', '1952.1']], []), c);
    feed.handleMessage(snapshot('0GUSDT', [], [['0.2226', '1.2']]), c);

    expect(updateQuote).not.toHaveBeenCalled();
  });

  it('logs a rejected control frame and stays silent on the acknowledgement and the pong', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { feed, updateQuote } = makeFeed([market('0GUSDT')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(control(true, '', 'subscribe'), c);
    feed.handleMessage(control(true, 'pong', 'ping'), c);
    feed.handleMessage(
      control(false, 'Invalid symbol :orderbook.1.0G', 'subscribe'),
      c,
    );

    expect(updateQuote).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
  });
});
