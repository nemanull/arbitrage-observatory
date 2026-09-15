import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/cluster/types';
import type { EndpointPlan, SingleSocketConnection } from './types';
import { VenueFeed } from './VenueFeed';

const VENUE_ID = 'testvenue';
const T0 = 1_700_000_000_000;

function market(rawMarketId: string): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.slice(0, 3),
    quote: 'USDT',
    takerPpm: 500,
    linear: true,
    contractSize: 1,
  };
}

// One subscribe frame per market, so a test controls the frame count through the plan.
class TestFeed extends VenueFeed {
  protected readonly maxSilenceMs = 0;
  subscribeGapMs = 0;
  firstBookWaitMs = 10_000;

  protected planEndpoints(): EndpointPlan[] {
    return [];
  }

  protected getSubscribeFrames(markets: Market[]): object[] {
    return markets.map((m) => ({ subscribe: m.rawMarketId }));
  }

  protected startKeepalive(): void {}

  protected handleMessage(): void {}

  seed(rawMarketId: string): void {
    this.resetBook(rawMarketId, [[100, 1]], [[101, 1]]);
  }
}

type OpenProbe = { onOpen(c: SingleSocketConnection): void };

function makeFeed(markets: Market[]) {
  const venue: Venue = { id: VENUE_ID, name: 'Test Venue', markets };
  const engine = {
    updateBook: jest.fn(),
    markStale: jest.fn(),
    depthLevels: 20,
  } as unknown as Engine;

  return new TestFeed(venue, engine);
}

function connection(markets: Market[]) {
  const socket = { readyState: 1, send: jest.fn(), terminate: jest.fn() };
  const plan: EndpointPlan = { id: `${VENUE_ID}#0`, url: 'wss://x', markets };
  const c = {
    id: plan.id,
    plan,
    socket,
    accepted: new Set(markets.map((m) => m.rawMarketId)),
    lastMessageAt: 0,
    attempt: 0,
    reopenOnClose: true,
    timers: [],
  } as unknown as SingleSocketConnection;

  return { c, socket };
}

function open(feed: TestFeed, c: SingleSocketConnection): void {
  (feed as unknown as OpenProbe).onOpen(c);
}

function sent(socket: { send: jest.Mock }): string[] {
  return socket.send.mock.calls.map(
    ([text]) => (JSON.parse(text as string) as { subscribe: string }).subscribe,
  );
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
});

afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe('VenueFeed subscribe frames', () => {
  it('sends every frame on open when the venue sets no gap', () => {
    const markets = [market('AAA'), market('BBB'), market('CCC')];
    const feed = makeFeed(markets);
    const { c, socket } = connection(markets);

    open(feed, c);

    expect(sent(socket)).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('sends the first frame on open and one more per gap', () => {
    const markets = [market('AAA'), market('BBB'), market('CCC')];
    const feed = makeFeed(markets);
    feed.subscribeGapMs = 1_000;
    const { c, socket } = connection(markets);

    open(feed, c);
    expect(sent(socket)).toEqual(['AAA']);

    jest.advanceTimersByTime(999);
    expect(sent(socket)).toEqual(['AAA']);

    jest.advanceTimersByTime(1);
    expect(sent(socket)).toEqual(['AAA', 'BBB']);

    jest.advanceTimersByTime(5_000);
    expect(sent(socket)).toEqual(['AAA', 'BBB', 'CCC']);
  });

  it('stops sending once the socket is no longer open', () => {
    const markets = [market('AAA'), market('BBB'), market('CCC')];
    const feed = makeFeed(markets);
    feed.subscribeGapMs = 1_000;
    const { c, socket } = connection(markets);

    open(feed, c);
    socket.readyState = 3;
    jest.advanceTimersByTime(5_000);

    expect(sent(socket)).toEqual(['AAA']);
  });
});

describe('VenueFeed first book watch', () => {
  it('logs once the markets that hold no book after the last frame and the wait', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const markets = [market('AAA'), market('BBB'), market('CCC')];
    const feed = makeFeed(markets);
    feed.subscribeGapMs = 1_000;
    const { c } = connection(markets);

    open(feed, c);
    feed.seed('BBB');

    jest.advanceTimersByTime(2_000 + 10_000 - 1);
    expect(warn).not.toHaveBeenCalled();

    jest.advanceTimersByTime(1);
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith({
      event: 'book_unserved',
      connection: c.id,
      missing: 2,
      markets: 3,
      sample: ['AAA', 'CCC'],
    });

    jest.advanceTimersByTime(60_000);
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it('says nothing when every market has a book', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const markets = [market('AAA'), market('BBB')];
    const feed = makeFeed(markets);
    const { c } = connection(markets);

    open(feed, c);
    feed.seed('AAA');
    feed.seed('BBB');
    jest.advanceTimersByTime(20_000);

    expect(warn).not.toHaveBeenCalled();
  });
});
