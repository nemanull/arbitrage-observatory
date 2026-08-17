import { Logger } from '@nestjs/common';
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

function makeCluster(): Cluster {
  return {
    pair: 'BTC|USDT',
    markets: VENUES.map(makeMarket),
    bidMul: new Float64Array(VENUES.length),
    askMul: new Float64Array(VENUES.length),
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
      VENUES.map((venueId) => [
        venueId,
        new Map([[RAW_MARKET_ID, cluster]]),
      ]),
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
    const engine = new Engine(index, index.venueIndexMap);

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
    const engine = new Engine(index, index.venueIndexMap);

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
    const engine = new Engine(index, index.venueIndexMap);
    const quote = { bid: Number.NaN, ask: -1, recvTs: 0 };

    engine.updateQuote('binance', RAW_MARKET_ID, quote);

    expectQuoteColumnsToBeEmpty(index.clusters[0]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        issues: [
          'bid_not_finite',
          'ask_not_positive',
          'recv_ts_not_positive',
        ],
      }),
    );
  });

  it('rate limits repeated validation warnings and reports suppressed counts', () => {
    let now = 1_000;
    jest.spyOn(Date, 'now').mockImplementation(() => now);
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const index = makeIndex();
    const engine = new Engine(index, index.venueIndexMap);
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
    const engine = new Engine(index, index.venueIndexMap);

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
