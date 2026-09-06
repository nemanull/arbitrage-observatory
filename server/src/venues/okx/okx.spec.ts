import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/types';
import type { EndpointPlan, SingleSocketConnection } from '../../ws/types';
import { OkxFeed } from './okx';

const VENUE_ID = 'okx';
const TAKER_PPM = 500;

// recvTs must come from the local clock, because openedAt, sampleTs and durationMs are measured on it across every venue.
// A venue timestamp here would make staleness depend on clock skew, so the quote is asserted whole rather than partially.
const LOCAL_NOW = 1_700_000_000_000;
const PUBLIC_URL = 'wss://ws.okx.com:8443/ws/v5/public';

// Both frames are recorded verbatim from the live venue in the design doc.
const BBO_FRAME =
  '{"arg":{"channel":"bbo-tbt","instId":"DATA-USDT-SWAP"},"data":[{"asks":[["0.1811","3","0","3"]],"bids":[["0.181","557","0","2"]],"ts":"1788196767000","seqId":83043901}]}';
const SUBSCRIBE_ACK =
  '{"id":"bbo","event":"subscribe","arg":{"channel":"bbo-tbt","instId":"BTC-USD-SWAP"},"connId":"2fbc0d1f"}';

type FeedProbe = {
  planEndpoints(): EndpointPlan[];
  getSubscribeFrames(markets: Market[]): object[];
  handleMessage(raw: Buffer, c: SingleSocketConnection): void;
};

function market(rawMarketId: string, linear = true): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.split('-')[0],
    quote: linear ? 'USDT' : 'USD',
    takerPpm: TAKER_PPM,
    linear,
  };
}

function markets(count: number): Market[] {
  return Array.from({ length: count }, (_, i) => market(`SYM${i}-USDT-SWAP`));
}

function makeFeed(venueMarkets: Market[]) {
  const updateQuote = jest.fn();
  const venue: Venue = { id: VENUE_ID, name: 'OKX', markets: venueMarkets };
  const engine = { updateQuote, markStale: jest.fn() } as unknown as Engine;
  const feed = new OkxFeed(venue, engine) as unknown as FeedProbe;

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

function bbo(instId: string, bids: string[][], asks: string[][]): Buffer {
  return Buffer.from(
    JSON.stringify({
      arg: { channel: 'bbo-tbt', instId },
      data: [{ asks, bids, ts: '1788196767000', seqId: 83043901 }],
    }),
  );
}

afterEach(() => jest.restoreAllMocks());

describe('OkxFeed.planEndpoints', () => {
  it('chunks every market onto the one public endpoint', () => {
    // Inverse swaps share the endpoint with linear ones, so they land on the same plan rather than a family of their own.
    const { feed } = makeFeed([
      market('BTC-USDT-SWAP'),
      market('BTC-USD-SWAP', false),
      ...markets(298),
    ]);
    const plans = feed.planEndpoints();

    expect(plans.map((p) => p.id)).toEqual(['okx#swap#0', 'okx#swap#1']);
    expect(plans.map((p) => p.markets.length)).toEqual([250, 50]);
    expect(plans.map((p) => p.url)).toEqual([PUBLIC_URL, PUBLIC_URL]);
    expect(plans[0].markets.slice(0, 2).map((m) => m.rawMarketId)).toEqual([
      'BTC-USDT-SWAP',
      'BTC-USD-SWAP',
    ]);
  });

  it('returns nothing when the venue lists no markets', () => {
    const { feed } = makeFeed([]);

    expect(feed.planEndpoints()).toEqual([]);
  });
});

describe('OkxFeed.getSubscribeFrames', () => {
  it('builds one argument per market and splits them across frames', () => {
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
      channel: 'bbo-tbt',
      instId: 'SYM0-USDT-SWAP',
    });
    expect(frames[1].args).toHaveLength(50);
    expect(frames.map((f) => f.id)).toEqual(['sub0', 'sub1']);
  });
});

describe('OkxFeed.handleMessage', () => {
  it('submits a subscribed bbo-tbt snapshot as a quote', () => {
    jest.spyOn(Date, 'now').mockReturnValue(LOCAL_NOW);
    const { feed, updateQuote } = makeFeed([market('DATA-USDT-SWAP')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(Buffer.from(BBO_FRAME), c);

    expect(updateQuote).toHaveBeenCalledWith(VENUE_ID, 'DATA-USDT-SWAP', {
      rawMarketId: 'DATA-USDT-SWAP',
      bid: 0.181,
      ask: 0.1811,
      recvTs: LOCAL_NOW,
    });
  });

  it('returns on the literal pong keepalive answer without parsing it', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const { feed, updateQuote } = makeFeed([market('DATA-USDT-SWAP')]);
    const c = connection(feed.planEndpoints()[0]);

    expect(() => feed.handleMessage(Buffer.from('pong'), c)).not.toThrow();
    expect(updateQuote).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
  });

  it('drops an instId the connection did not subscribe to, and warns once', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateQuote } = makeFeed([market('DATA-USDT-SWAP')]);
    const c = connection(feed.planEndpoints()[0]);
    const raw = bbo(
      'ETH-USDT-SWAP',
      [['1', '1', '0', '1']],
      [['2', '1', '0', '1']],
    );

    feed.handleMessage(raw, c);
    feed.handleMessage(raw, c);

    expect(updateQuote).not.toHaveBeenCalled();
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('ignores a one sided book', () => {
    const { feed, updateQuote } = makeFeed([market('DATA-USDT-SWAP')]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      bbo('DATA-USDT-SWAP', [], [['0.1811', '3', '0', '3']]),
      c,
    );
    feed.handleMessage(
      bbo('DATA-USDT-SWAP', [['0.181', '557', '0', '2']], []),
      c,
    );

    expect(updateQuote).not.toHaveBeenCalled();
  });

  it('logs an error event and a notice event, and stays silent on an acknowledgement', () => {
    const error = jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { feed, updateQuote } = makeFeed([market('BTC-USD-SWAP', false)]);
    const c = connection(feed.planEndpoints()[0]);

    feed.handleMessage(
      Buffer.from(
        JSON.stringify({
          event: 'error',
          code: '60012',
          msg: 'Invalid request: {"op": "subscribe"}',
          connId: '2fbc0d1f',
        }),
      ),
      c,
    );
    feed.handleMessage(
      Buffer.from(
        JSON.stringify({
          event: 'notice',
          code: '64008',
          msg: 'The connection will soon be closed for a service upgrade. Please reconnect.',
          connId: '2fbc0d1f',
        }),
      ),
      c,
    );
    const log = jest.spyOn(Logger.prototype, 'log').mockImplementation();
    const debug = jest.spyOn(Logger.prototype, 'debug').mockImplementation();
    feed.handleMessage(Buffer.from(SUBSCRIBE_ACK), c);

    expect(updateQuote).not.toHaveBeenCalled();
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledTimes(1);
    // A plan opens with 250 acknowledgements, so one log line each would bury the open of every socket.
    expect(log).not.toHaveBeenCalled();
    expect(debug).not.toHaveBeenCalled();
  });
});
