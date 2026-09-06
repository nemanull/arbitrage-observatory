import { Logger } from '@nestjs/common';
import { createOpportunityQueueMock } from '../../test/fixtures/opportunity-queue';
import { Engine } from './Engine';
import type { Cluster, ClusterIndex, Market } from './types';

const VENUES = ['binance', 'bybit'] as const;
const RAW_MARKET_ID = 'BTCUSDT';

type ClusterQuote = {
  bid: number;
  ask: number;
  recvTs: number;
};

function makeMarket(venueId: string): Market {
  return {
    venueId,
    rawMarketId: RAW_MARKET_ID,
    base: 'BTC',
    quote: 'USDT',
    takerPpm: 550,
    linear: true,
  };
}

// The multipliers are filled, so a quote pair that clears the fees can open a route. Zero-filled they cannot.
function makeCluster(): Cluster {
  const markets = VENUES.map(makeMarket);

  return {
    pair: 'BTC|USDT',
    markets,
    bidMul: Float64Array.from(markets, (m) => 1 - m.takerPpm / 1_000_000),
    askMul: Float64Array.from(markets, (m) => 1 + m.takerPpm / 1_000_000),
    bid: new Float64Array(VENUES.length),
    ask: new Float64Array(VENUES.length),
    recvTs: new Float64Array(VENUES.length),
  };
}

function makeIndex(): ClusterIndex {
  const cluster = makeCluster();

  return {
    clusters: [cluster],
    clusterByRawMarketId: new Map(
      VENUES.map((venueId) => [venueId, new Map([[RAW_MARKET_ID, cluster]])]),
    ),
    venueIndexMap: new Map(VENUES.map((venueId, i) => [venueId, i])),
  };
}

function expectQuoteColumnsToBeEmpty(cluster: Cluster): void {
  expect([...cluster.bid]).toEqual([0, 0]);
  expect([...cluster.ask]).toEqual([0, 0]);
  expect([...cluster.recvTs]).toEqual([0, 0]);
}

describe('Engine.updateQuote', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('updates the quote at venue index zero', () => {
    jest.spyOn(Logger.prototype, 'error').mockImplementation();
    const index = makeIndex();
    const engine = new Engine(
      index,
      index.venueIndexMap,
      createOpportunityQueueMock(),
    );

    engine.updateQuote('binance', RAW_MARKET_ID, {
      bid: 100,
      ask: 101,
      recvTs: 1_000,
    });

    expect(index.clusters[0].bid[0]).toBe(100);
    expect(index.clusters[0].ask[0]).toBe(101);
    expect(index.clusters[0].recvTs[0]).toBe(1_000);
  });

  it.each<{
    name: string;
    quote: ClusterQuote;
    issue: string;
  }>([
    {
      name: 'non-finite bid',
      quote: { bid: Number.NaN, ask: 101, recvTs: 1_000 },
      issue: 'bid_not_finite',
    },
    {
      name: 'non-positive bid',
      quote: { bid: 0, ask: 101, recvTs: 1_000 },
      issue: 'bid_not_positive',
    },
    {
      name: 'non-finite ask',
      quote: { bid: 100, ask: Number.POSITIVE_INFINITY, recvTs: 1_000 },
      issue: 'ask_not_finite',
    },
    {
      name: 'non-positive ask',
      quote: { bid: 100, ask: -1, recvTs: 1_000 },
      issue: 'ask_not_positive',
    },
    {
      name: 'crossed quote',
      quote: { bid: 102, ask: 101, recvTs: 1_000 },
      issue: 'crossed_quote',
    },
    {
      name: 'non-finite receive timestamp',
      quote: { bid: 100, ask: 101, recvTs: Number.NaN },
      issue: 'recv_ts_not_finite',
    },
    {
      name: 'non-positive receive timestamp',
      quote: { bid: 100, ask: 101, recvTs: 0 },
      issue: 'recv_ts_not_positive',
    },
  ])('reports a $name with update context', ({ quote, issue }) => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const index = makeIndex();
    const engine = new Engine(
      index,
      index.venueIndexMap,
      createOpportunityQueueMock(),
    );

    engine.updateQuote('binance', RAW_MARKET_ID, quote);

    expectQuoteColumnsToBeEmpty(index.clusters[0]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'quote_update_rejected',
        reason: 'invalid_quote',
        issues: [issue],
        venueId: 'binance',
        rawMarketId: RAW_MARKET_ID,
        clusterPair: 'BTC|USDT',
        venueIndex: 0,
        bid: quote.bid,
        ask: quote.ask,
        recvTs: quote.recvTs,
      }),
    );
  });

  it('reports every applicable issue for one rejected quote', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const index = makeIndex();
    const engine = new Engine(
      index,
      index.venueIndexMap,
      createOpportunityQueueMock(),
    );
    const quote = { bid: Number.NaN, ask: -1, recvTs: 0 };

    engine.updateQuote('binance', RAW_MARKET_ID, quote);

    expectQuoteColumnsToBeEmpty(index.clusters[0]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        issues: ['bid_not_finite', 'ask_not_positive', 'recv_ts_not_positive'],
      }),
    );
  });

  it('rate limits repeated validation warnings and reports suppressed counts', () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const index = makeIndex();
    const engine = new Engine(
      index,
      index.venueIndexMap,
      createOpportunityQueueMock(),
    );
    const quote = { bid: 0, ask: 101, recvTs: 1_000 };

    engine.updateQuote('binance', RAW_MARKET_ID, quote);
    now = 2_000;
    engine.updateQuote('binance', RAW_MARKET_ID, quote);
    now = 3_000;
    engine.updateQuote('binance', RAW_MARKET_ID, quote);

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        occurrenceCount: 1,
        suppressedCount: 0,
      }),
    );

    now = 11_000;
    engine.updateQuote('binance', RAW_MARKET_ID, quote);

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        occurrenceCount: 4,
        suppressedCount: 2,
      }),
    );
  });

  it('reports a different validation issue during the suppression window', () => {
    jest.spyOn(Date, 'now').mockReturnValue(1_000);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const index = makeIndex();
    const engine = new Engine(
      index,
      index.venueIndexMap,
      createOpportunityQueueMock(),
    );

    engine.updateQuote('binance', RAW_MARKET_ID, {
      bid: 0,
      ask: 101,
      recvTs: 1_000,
    });
    engine.updateQuote('binance', RAW_MARKET_ID, {
      bid: 100,
      ask: Number.NaN,
      recvTs: 1_000,
    });

    expect(warn).toHaveBeenCalledTimes(2);
  });
});

// bybit bids 101 against a binance ask of 100: ~8890ppm after 55bp taker each side.
function openRoute(engine: Engine): void {
  engine.updateQuote('binance', RAW_MARKET_ID, {
    bid: 99.9,
    ask: 100,
    recvTs: 1_000,
  });
  engine.updateQuote('bybit', RAW_MARKET_ID, {
    bid: 101,
    ask: 101.5,
    recvTs: 1_000,
  });
}

function openRoutes(engine: Engine): Map<string, unknown> {
  const manager = Reflect.get(engine, 'opportunityManager') as object;
  const active = Reflect.get(manager, 'activeOpportunityMap') as Map<
    string,
    Map<string, unknown>
  >;

  return active.get('BTC|USDT') ?? new Map<string, unknown>();
}

describe('Engine repeats and dead sockets', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('drops an identical repeat at any age and only refreshes recvTs', () => {
    const index = makeIndex();
    const engine = new Engine(
      index,
      index.venueIndexMap,
      createOpportunityQueueMock(),
    );
    const manager = Reflect.get(engine, 'opportunityManager') as object;
    const validate = jest.spyOn(
      manager as { validate: () => unknown },
      'validate',
    );

    engine.updateQuote('binance', RAW_MARKET_ID, {
      bid: 100,
      ask: 101,
      recvTs: 1_000,
    });
    engine.updateQuote('binance', RAW_MARKET_ID, {
      bid: 100,
      ask: 101,
      recvTs: 120_000,
    });

    expect(validate).toHaveBeenCalledTimes(1);
    expect(index.clusters[0].recvTs[0]).toBe(120_000);
  });

  it('takes the same numbers as a fresh quote after markStale', () => {
    const index = makeIndex();
    const engine = new Engine(
      index,
      index.venueIndexMap,
      createOpportunityQueueMock(),
    );
    const manager = Reflect.get(engine, 'opportunityManager') as object;
    const validate = jest.spyOn(
      manager as { validate: () => unknown },
      'validate',
    );

    engine.updateQuote('binance', RAW_MARKET_ID, {
      bid: 100,
      ask: 101,
      recvTs: 1_000,
    });
    engine.markStale('binance', [RAW_MARKET_ID]);

    expect(index.clusters[0].recvTs[0]).toBe(0);

    engine.updateQuote('binance', RAW_MARKET_ID, {
      bid: 100,
      ask: 101,
      recvTs: 2_000,
    });

    expect(validate).toHaveBeenCalledTimes(2);
    expect(index.clusters[0].recvTs[0]).toBe(2_000);
  });

  it('closes the open routes on the dead markets with feed_down', () => {
    jest.spyOn(Date, 'now').mockReturnValue(5_000);
    const queue = createOpportunityQueueMock();
    const add = jest.spyOn(queue, 'add');
    const index = makeIndex();
    const engine = new Engine(index, index.venueIndexMap, queue);

    openRoute(engine);
    expect([...openRoutes(engine).keys()]).toEqual(['bybit-binance']);

    engine.markStale('bybit', [RAW_MARKET_ID]);

    expect(openRoutes(engine).size).toBe(0);
    expect(add).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        rows: [
          expect.objectContaining({
            closeReason: 'feed_down',
            closedAt: new Date(5_000).toISOString(),
          }),
        ],
      }),
    );
  });

  it('flushes on shutdown and ignores quotes from then on', async () => {
    const queue = createOpportunityQueueMock();
    const add = jest.spyOn(queue, 'add');
    const index = makeIndex();
    const engine = new Engine(index, index.venueIndexMap, queue);

    openRoute(engine);

    expect(await engine.shutdown(9_000)).toBe(1);
    expect(add).toHaveBeenCalledWith(
      expect.any(String),
      expect.objectContaining({
        rows: [expect.objectContaining({ closeReason: 'shutdown' })],
      }),
    );

    openRoute(engine);

    expect(openRoutes(engine).size).toBe(0);
    expect(add).toHaveBeenCalledTimes(1);
  });
});
