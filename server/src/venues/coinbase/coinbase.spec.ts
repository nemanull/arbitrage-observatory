import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/types';
import type { EndpointPlan, SingleSocketConnection } from '../../ws/types';
import { CoinbaseFeed } from './coinbase';

const VENUE_ID = 'coinbase';
const TAKER_PPM = 400;

// recvTs must come from the local clock, because MAX_QUOTE_AGE_MS is compared against Date.now() everywhere.
const LOCAL_NOW = 1_700_000_000_000;
const PUBLIC_URL = 'wss://advanced-trade-ws.coinbase.com';

// Every frame below was captured verbatim from the live venue on 2026-09-05.
const SNAPSHOT_FRAME =
  '{"channel":"ticker","timestamp":"2026-09-05T22:10:29.562008293Z","sequence_num":0,"events":[{"type":"snapshot","tickers":[{"type":"ticker","product_id":"BTC-PERP-INTX","price":"79879.1","volume_24_h":"14152.6899","low_24_h":"79445","high_24_h":"80206","low_52_w":"57705.8","high_52_w":"126340.3","price_percent_chg_24_h":"0.25541069034937","best_bid":"79879","best_ask":"79879.1","best_bid_quantity":"2.9352","best_ask_quantity":"1.7389"}]}]}';
const UPDATE_FRAME =
  '{"channel":"ticker","timestamp":"2026-09-05T21:52:10.940239371Z","sequence_num":91,"events":[{"type":"update","tickers":[{"type":"ticker","product_id":"BTC-PERP-INTX","price":"79914.6","volume_24_h":"14174.4213","low_24_h":"79445","high_24_h":"80206","low_52_w":"57705.8","high_52_w":"126340.3","price_percent_chg_24_h":"0.27303411671707","best_bid":"79914.5","best_ask":"79914.6","best_bid_quantity":"0.7944","best_ask_quantity":"0.7554"}]}]}';
const TICKER_ACK =
  '{"channel":"subscriptions","timestamp":"2026-09-05T22:10:29.562097895Z","sequence_num":2,"events":[{"subscriptions":{"ticker":["BTC-PERP-INTX","ETH-PERP-INTX"]}}]}';
const HEARTBEATS_ACK =
  '{"channel":"subscriptions","timestamp":"2026-09-05T22:10:29.563180868Z","sequence_num":3,"events":[{"subscriptions":{"heartbeats":["heartbeats"],"ticker":["BTC-PERP-INTX","ETH-PERP-INTX"]}}]}';
const HEARTBEAT_FRAME =
  '{"channel":"heartbeats","timestamp":"2026-09-05T22:10:30.260465255Z","sequence_num":4,"events":[{"current_time":"2026-09-05 22:10:30.25788961 +0000 UTC m=+139651.272674714","heartbeat_counter":139651}]}';
// The venue reports an unknown channel name as an authentication failure, which is not what went wrong.
const ERROR_FRAME = '{"type":"error","message":"authentication failure"}';

type FeedProbe = {
  planEndpoints(): EndpointPlan[];
  getSubscribeFrames(markets: Market[]): object[];
  startKeepalive(c: SingleSocketConnection): void;
  handleMessage(raw: Buffer, c: SingleSocketConnection): void;
};

function socketStub() {
  return { readyState: 1, OPEN: 1, ping: jest.fn(), send: jest.fn() };
}

function market(rawMarketId: string): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.split('-')[0],
    quote: 'USDC',
    takerPpm: TAKER_PPM,
    linear: true,
  };
}

function markets(count: number): Market[] {
  return Array.from({ length: count }, (_, i) => market(`SYM${i}-PERP-INTX`));
}

function makeFeed(venueMarkets: Market[]) {
  const updateQuote = jest.fn();
  const venue: Venue = {
    id: VENUE_ID,
    name: 'Coinbase Advanced',
    markets: venueMarkets,
  };
  const engine = { updateQuote, markStale: jest.fn() } as unknown as Engine;
  const feed = new CoinbaseFeed(venue, engine) as unknown as FeedProbe;

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

function tickerFrame(tickers: Record<string, unknown>[]): Buffer {
  return Buffer.from(
    JSON.stringify({
      channel: 'ticker',
      sequence_num: 1,
      events: [{ type: 'update', tickers }],
    }),
  );
}

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('CoinbaseFeed.planEndpoints', () => {
  it('puts every market on one connection', () => {
    const { feed } = makeFeed(markets(53));
    const plans = feed.planEndpoints();

    expect(plans).toHaveLength(1);
    expect(plans[0].id).toBe('coinbase#swap#0');
    expect(plans[0].url).toBe(PUBLIC_URL);
    expect(plans[0].markets).toHaveLength(53);
  });

  it('returns nothing when the venue lists no markets', () => {
    const { feed } = makeFeed([]);

    expect(feed.planEndpoints()).toEqual([]);
  });
});

describe('CoinbaseFeed.getSubscribeFrames', () => {
  // The order is load bearing. Every acknowledgement lists the whole subscription set, and the ticker key has to be
  // present on the first one, or the acknowledgement check reads it as every product having been rejected.
  it('subscribes ticker before heartbeats', () => {
    const { feed } = makeFeed([]);
    const frames = feed.getSubscribeFrames(markets(2)) as {
      type: string;
      channel: string;
      product_ids?: string[];
    }[];

    expect(frames).toHaveLength(2);
    expect(frames[0]).toEqual({
      type: 'subscribe',
      channel: 'ticker',
      product_ids: ['SYM0-PERP-INTX', 'SYM1-PERP-INTX'],
    });
    expect(frames[1]).toEqual({ type: 'subscribe', channel: 'heartbeats' });
  });
});

describe('CoinbaseFeed.handleMessage', () => {
  // A snapshot is the only frame the equity tracking perpetuals send outside market hours, so it cannot be filtered out.
  it('submits a quote from both the snapshot and the update', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateQuote } = makeFeed([market('BTC-PERP-INTX')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(Buffer.from(SNAPSHOT_FRAME), c);
    feed.handleMessage(Buffer.from(UPDATE_FRAME), c);

    expect(updateQuote).toHaveBeenNthCalledWith(1, VENUE_ID, 'BTC-PERP-INTX', {
      rawMarketId: 'BTC-PERP-INTX',
      bid: 79879,
      ask: 79879.1,
      recvTs: LOCAL_NOW,
    });
    expect(updateQuote).toHaveBeenNthCalledWith(2, VENUE_ID, 'BTC-PERP-INTX', {
      rawMarketId: 'BTC-PERP-INTX',
      bid: 79914.5,
      ask: 79914.6,
      recvTs: LOCAL_NOW,
    });
  });

  // The envelope names no product, so a frame carrying several tickers has to be routed element by element.
  it('routes every ticker in one frame by its own product id', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateQuote } = makeFeed([
      market('BTC-PERP-INTX'),
      market('ETH-PERP-INTX'),
    ]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      tickerFrame([
        { product_id: 'BTC-PERP-INTX', best_bid: '1', best_ask: '2' },
        { product_id: 'ETH-PERP-INTX', best_bid: '3', best_ask: '4' },
      ]),
      c,
    );

    expect(updateQuote).toHaveBeenCalledTimes(2);
    expect(updateQuote).toHaveBeenNthCalledWith(1, VENUE_ID, 'BTC-PERP-INTX', {
      rawMarketId: 'BTC-PERP-INTX',
      bid: 1,
      ask: 2,
      recvTs: LOCAL_NOW,
    });
    expect(updateQuote).toHaveBeenNthCalledWith(2, VENUE_ID, 'ETH-PERP-INTX', {
      rawMarketId: 'ETH-PERP-INTX',
      bid: 3,
      ask: 4,
      recvTs: LOCAL_NOW,
    });
  });

  it('treats a heartbeat as liveness only', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { feed, updateQuote } = makeFeed([market('BTC-PERP-INTX')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(Buffer.from(HEARTBEAT_FRAME), c);

    expect(updateQuote).not.toHaveBeenCalled();
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('stays silent when the acknowledgement lists every subscribed product', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed } = makeFeed([
      market('BTC-PERP-INTX'),
      market('ETH-PERP-INTX'),
    ]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(Buffer.from(TICKER_ACK), c);
    feed.handleMessage(Buffer.from(HEARTBEATS_ACK), c);

    expect(warn).not.toHaveBeenCalled();
  });

  // The venue never rejects a bad product id, it omits it, so without this check a drifted catalog looks permanently quiet.
  it('warns about a subscribed product the acknowledgement omits', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed } = makeFeed([
      market('BTC-PERP-INTX'),
      market('ETH-PERP-INTX'),
      market('SOL-PERP-INTX'),
    ]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(Buffer.from(TICKER_ACK), c);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0][0]).toContain('SOL-PERP-INTX');
    expect(warn.mock.calls[0][0]).toContain('1 of 3');
  });

  it('warns when the acknowledgement carries no ticker list at all', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed } = makeFeed([market('BTC-PERP-INTX')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      Buffer.from(
        '{"channel":"subscriptions","sequence_num":0,"events":[{"subscriptions":{}}]}',
      ),
      c,
    );

    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('drops a product the connection did not subscribe to, and warns once', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateQuote } = makeFeed([market('BTC-PERP-INTX')]);
    const c = connection(feed.planEndpoints()[0]);
    const raw = tickerFrame([
      { product_id: 'ETH-PERP-INTX', best_bid: '1', best_ask: '2' },
    ]);

    feed.handleMessage(raw, c);
    feed.handleMessage(raw, c);

    expect(updateQuote).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('ignores a ticker missing either side', () => {
    const { feed, updateQuote } = makeFeed([market('BTC-PERP-INTX')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      tickerFrame([{ product_id: 'BTC-PERP-INTX', best_ask: '2' }]),
      c,
    );
    feed.handleMessage(
      tickerFrame([{ product_id: 'BTC-PERP-INTX', best_bid: '1' }]),
      c,
    );
    feed.handleMessage(
      tickerFrame([
        { product_id: 'BTC-PERP-INTX', best_bid: '', best_ask: '2' },
      ]),
      c,
    );

    expect(updateQuote).not.toHaveBeenCalled();
  });

  it('logs the raw text of an error frame', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { feed, updateQuote } = makeFeed([market('BTC-PERP-INTX')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(Buffer.from(ERROR_FRAME), c);

    expect(updateQuote).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(error.mock.calls[0][0]).toContain('authentication failure');
  });
});

describe('CoinbaseFeed.startKeepalive', () => {
  // The venue sends no protocol pings and expects none, so the heartbeats subscription is the whole keepalive.
  it('installs no timer and writes nothing to the socket', () => {
    jest.useFakeTimers();
    const socket = socketStub();
    const { feed } = makeFeed([market('BTC-PERP-INTX')]);
    const c = connection(feed.planEndpoints()[0], socket);

    feed.startKeepalive(c);
    jest.advanceTimersByTime(120_000);

    expect(c.timers).toHaveLength(0);
    expect(socket.ping).not.toHaveBeenCalled();
    expect(socket.send).not.toHaveBeenCalled();
  });
});
