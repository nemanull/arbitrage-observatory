import { Logger } from '@nestjs/common';
import { createOpportunityQueueMock } from '../../test/fixtures/opportunity-queue';
import { createClusterDepth } from './ClusterIndexBuilder';
import { Engine } from './Engine';
import type {
  BookLevel,
  Cluster,
  ClusterDepth,
  ClusterIndex,
  Market,
  Opportunity,
} from './types';

const VENUES = ['binance', 'bybit'] as const;
const RAW_MARKET_ID = 'BTCUSDT';
const LEVELS = 4; // depth entries per slot, four keeps the index tables short

type ClusterQuote = {
  bid: number;
  ask: number;
  bidSize: number;
  askSize: number;
  recvTs: number;
};

const VALID_QUOTE: ClusterQuote = {
  bid: 100,
  ask: 101,
  bidSize: 2,
  askSize: 3,
  recvTs: 1_000,
};

function makeMarket(venueId: string): Market {
  return {
    venueId,
    rawMarketId: RAW_MARKET_ID,
    base: 'BTC',
    quote: 'USDT',
    takerPpm: 550,
    linear: true,
    contractSize: 1,
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
    sizeMul: Float64Array.from(markets, (m) => m.contractSize),
    bid: new Float64Array(VENUES.length),
    ask: new Float64Array(VENUES.length),
    bidSize: new Float64Array(VENUES.length),
    askSize: new Float64Array(VENUES.length),
    recvTs: new Float64Array(VENUES.length),
    depth: createClusterDepth(VENUES.length, LEVELS),
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
  expect([...cluster.bidSize]).toEqual([0, 0]);
  expect([...cluster.askSize]).toEqual([0, 0]);
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

    engine.updateQuote('binance', RAW_MARKET_ID, VALID_QUOTE);

    expect(index.clusters[0].bid[0]).toBe(100);
    expect(index.clusters[0].ask[0]).toBe(101);
    expect(index.clusters[0].bidSize[0]).toBe(2);
    expect(index.clusters[0].askSize[0]).toBe(3);
    expect(index.clusters[0].recvTs[0]).toBe(1_000);
  });

  it.each<{
    name: string;
    quote: ClusterQuote;
    issue: string;
  }>([
    {
      name: 'non-finite bid',
      quote: { ...VALID_QUOTE, bid: Number.NaN },
      issue: 'bid_not_finite',
    },
    {
      name: 'non-positive bid',
      quote: { ...VALID_QUOTE, bid: 0 },
      issue: 'bid_not_positive',
    },
    {
      name: 'non-finite ask',
      quote: { ...VALID_QUOTE, ask: Number.POSITIVE_INFINITY },
      issue: 'ask_not_finite',
    },
    {
      name: 'non-positive ask',
      quote: { ...VALID_QUOTE, ask: -1 },
      issue: 'ask_not_positive',
    },
    {
      name: 'crossed quote',
      quote: { ...VALID_QUOTE, bid: 102, ask: 101 },
      issue: 'crossed_quote',
    },
    {
      name: 'non-finite bid size',
      quote: { ...VALID_QUOTE, bidSize: Number.NaN },
      issue: 'bid_size_not_finite',
    },
    {
      name: 'negative bid size',
      quote: { ...VALID_QUOTE, bidSize: -1 },
      issue: 'bid_size_negative',
    },
    {
      name: 'non-finite ask size',
      quote: { ...VALID_QUOTE, askSize: Number.POSITIVE_INFINITY },
      issue: 'ask_size_not_finite',
    },
    {
      name: 'negative ask size',
      quote: { ...VALID_QUOTE, askSize: -0.5 },
      issue: 'ask_size_negative',
    },
    {
      name: 'non-finite receive timestamp',
      quote: { ...VALID_QUOTE, recvTs: Number.NaN },
      issue: 'recv_ts_not_finite',
    },
    {
      name: 'non-positive receive timestamp',
      quote: { ...VALID_QUOTE, recvTs: 0 },
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
        bidSize: quote.bidSize,
        askSize: quote.askSize,
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
    const quote = {
      ...VALID_QUOTE,
      bid: Number.NaN,
      ask: -1,
      bidSize: -1,
      recvTs: 0,
    };

    engine.updateQuote('binance', RAW_MARKET_ID, quote);

    expectQuoteColumnsToBeEmpty(index.clusters[0]);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        issues: [
          'bid_not_finite',
          'ask_not_positive',
          'bid_size_negative',
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
    const engine = new Engine(
      index,
      index.venueIndexMap,
      createOpportunityQueueMock(),
    );
    const quote = { ...VALID_QUOTE, bid: 0 };

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

    engine.updateQuote('binance', RAW_MARKET_ID, { ...VALID_QUOTE, bid: 0 });
    engine.updateQuote('binance', RAW_MARKET_ID, {
      ...VALID_QUOTE,
      ask: Number.NaN,
    });

    expect(warn).toHaveBeenCalledTimes(2);
  });
});

// bybit bids 101 against a binance ask of 100: ~8890ppm after 55bp taker each side.
// binance rests 4 at its bid and 5 at its ask, bybit 2 and 3.
function openRoute(engine: Engine): void {
  engine.updateQuote('binance', RAW_MARKET_ID, {
    bid: 99.9,
    ask: 100,
    bidSize: 4,
    askSize: 5,
    recvTs: 1_000,
  });
  engine.updateQuote('bybit', RAW_MARKET_ID, {
    bid: 101,
    ask: 101.5,
    bidSize: 2,
    askSize: 3,
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

function spyOnValidate(engine: Engine) {
  const manager = Reflect.get(engine, 'opportunityManager') as object;

  return jest.spyOn(manager as { validate: () => unknown }, 'validate');
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
    const validate = spyOnValidate(engine);

    engine.updateQuote('binance', RAW_MARKET_ID, VALID_QUOTE);
    engine.updateQuote('binance', RAW_MARKET_ID, {
      ...VALID_QUOTE,
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
    const validate = spyOnValidate(engine);

    engine.updateQuote('binance', RAW_MARKET_ID, VALID_QUOTE);
    engine.markStale('binance', [RAW_MARKET_ID]);

    expect(index.clusters[0].recvTs[0]).toBe(0);

    engine.updateQuote('binance', RAW_MARKET_ID, {
      ...VALID_QUOTE,
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

// Sizes land in the cluster on every message, but only a price change is a tick.
describe('Engine book sizes', () => {
  afterEach(() => {
    jest.restoreAllMocks();
  });

  it('stores a size-only change without running discovery', () => {
    const index = makeIndex();
    const engine = new Engine(
      index,
      index.venueIndexMap,
      createOpportunityQueueMock(),
    );
    const validate = spyOnValidate(engine);

    openRoute(engine);
    const opened = openRoutes(engine).get('bybit-binance') as Opportunity;

    engine.updateQuote('bybit', RAW_MARKET_ID, {
      bid: 101,
      ask: 101.5,
      bidSize: 6,
      askSize: 7,
      recvTs: 2_000,
    });

    expect(validate).toHaveBeenCalledTimes(2); // the two quotes that opened the route
    expect(index.clusters[0].bidSize[1]).toBe(6);
    expect(index.clusters[0].askSize[1]).toBe(7);
    expect(index.clusters[0].recvTs[1]).toBe(2_000);
    expect(opened.ticksSinceStart).toBe(1);
    expect(opened.lastHighestBidSize).toBe(2);

    // the next price tick reads the stored size
    engine.updateQuote('bybit', RAW_MARKET_ID, {
      bid: 101.1,
      ask: 101.5,
      bidSize: 6,
      askSize: 7,
      recvTs: 3_000,
    });

    expect(validate).toHaveBeenCalledTimes(3);
    expect(opened.ticksSinceStart).toBe(2);
    expect(opened.lastHighestBidSize).toBe(6);
  });

  it('rejects a negative size and leaves the slot as it was', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const index = makeIndex();
    const engine = new Engine(
      index,
      index.venueIndexMap,
      createOpportunityQueueMock(),
    );

    engine.updateQuote('binance', RAW_MARKET_ID, VALID_QUOTE);
    engine.updateQuote('binance', RAW_MARKET_ID, {
      bid: 100.5,
      ask: 101.5,
      bidSize: -1,
      askSize: 4,
      recvTs: 2_000,
    });

    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        issues: ['bid_size_negative'],
        bidSize: -1,
        askSize: 4,
      }),
    );
    expect(index.clusters[0].bid[0]).toBe(100);
    expect(index.clusters[0].ask[0]).toBe(101);
    expect(index.clusters[0].bidSize[0]).toBe(2);
    expect(index.clusters[0].askSize[0]).toBe(3);
    expect(index.clusters[0].recvTs[0]).toBe(1_000);
  });

  it('takes a zero size as an empty level, not a broken message', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const index = makeIndex();
    const engine = new Engine(
      index,
      index.venueIndexMap,
      createOpportunityQueueMock(),
    );

    engine.updateQuote('binance', RAW_MARKET_ID, {
      ...VALID_QUOTE,
      bidSize: 0,
      askSize: 0,
    });

    expect(warn).not.toHaveBeenCalled();
    expect(index.clusters[0].bid[0]).toBe(100);
    expect(index.clusters[0].recvTs[0]).toBe(1_000);
  });
});

// A depth update lands in its venue's range of the block and nothing else moves.
// With four levels, bybit's range is indexes 4 to 7.
describe('Engine depth block', () => {
  // bybit's book as the venue sends it, bids falling away from the touch and asks rising.
  // The 101 top would cross binance's ask of 100 if it were a tick.
  const BIDS: BookLevel[] = [
    [101, 2],
    [100.9, 4],
    [100.8, 1],
    [100.7, 8],
  ];
  const ASKS: BookLevel[] = [
    [101.5, 3],
    [101.6, 5],
    [101.7, 2],
    [101.8, 6],
  ];
  const WRITTEN_AT = 1_000;
  const BYBIT = 1;

  afterEach(() => {
    jest.restoreAllMocks();
  });

  function makeEngine(): {
    engine: Engine;
    cluster: Cluster;
    depth: ClusterDepth;
  } {
    const index = makeIndex();
    const engine = new Engine(
      index,
      index.venueIndexMap,
      createOpportunityQueueMock(),
    );

    return {
      engine,
      cluster: index.clusters[0],
      depth: index.clusters[0].depth,
    };
  }

  function slotRange(column: Float64Array, slot: number): number[] {
    return [...column.subarray(slot * LEVELS, (slot + 1) * LEVELS)];
  }

  function snapshotDepth(depth: ClusterDepth) {
    return {
      bidPrice: [...depth.bidPrice],
      bidSize: [...depth.bidSize],
      askPrice: [...depth.askPrice],
      askSize: [...depth.askSize],
      bidLevelCount: [...depth.bidLevelCount],
      askLevelCount: [...depth.askLevelCount],
      writtenAt: [...depth.writtenAt],
    };
  }

  function expectSlotUntouched(depth: ClusterDepth, slot: number): void {
    const empty = new Array<number>(LEVELS).fill(0);

    expect(slotRange(depth.bidPrice, slot)).toEqual(empty);
    expect(slotRange(depth.bidSize, slot)).toEqual(empty);
    expect(slotRange(depth.askPrice, slot)).toEqual(empty);
    expect(slotRange(depth.askSize, slot)).toEqual(empty);
    expect(depth.bidLevelCount[slot]).toBe(0);
    expect(depth.askLevelCount[slot]).toBe(0);
    expect(depth.writtenAt[slot]).toBe(0);
  }

  it('writes both sides into the slot range and stamps the slot', () => {
    const { engine, depth } = makeEngine();

    expect(
      engine.updateDepth('bybit', RAW_MARKET_ID, BIDS, ASKS, WRITTEN_AT),
    ).toBe(true);

    expect(slotRange(depth.bidPrice, BYBIT)).toEqual([
      101, 100.9, 100.8, 100.7,
    ]);
    expect(slotRange(depth.bidSize, BYBIT)).toEqual([2, 4, 1, 8]);
    expect(slotRange(depth.askPrice, BYBIT)).toEqual([
      101.5, 101.6, 101.7, 101.8,
    ]);
    expect(slotRange(depth.askSize, BYBIT)).toEqual([3, 5, 2, 6]);
    expect([...depth.bidLevelCount]).toEqual([0, 4]);
    expect([...depth.askLevelCount]).toEqual([0, 4]);
    expect([...depth.writtenAt]).toEqual([0, WRITTEN_AT]);
    expectSlotUntouched(depth, 0);
  });

  it('keeps the first four levels of a deeper side', () => {
    const { engine, depth } = makeEngine();
    const bids: BookLevel[] = [...BIDS, [100.6, 1], [100.5, 1]];
    const asks: BookLevel[] = [...ASKS, [101.9, 1], [102, 1]];

    // slot 0 is written so a missed truncation would spill into slot 1's range
    expect(
      engine.updateDepth('binance', RAW_MARKET_ID, bids, asks, WRITTEN_AT),
    ).toBe(true);

    expect(slotRange(depth.bidPrice, 0)).toEqual([101, 100.9, 100.8, 100.7]);
    expect(slotRange(depth.askPrice, 0)).toEqual([101.5, 101.6, 101.7, 101.8]);
    expect(depth.bidLevelCount[0]).toBe(4);
    expect(depth.askLevelCount[0]).toBe(4);
    expectSlotUntouched(depth, BYBIT);
  });

  it('records the count of a short side', () => {
    const { engine, depth } = makeEngine();

    expect(
      engine.updateDepth(
        'bybit',
        RAW_MARKET_ID,
        BIDS.slice(0, 2),
        ASKS.slice(0, 2),
        WRITTEN_AT,
      ),
    ).toBe(true);

    // entries past the count are unreachable, so the tail is not asserted
    expect(slotRange(depth.bidPrice, BYBIT).slice(0, 2)).toEqual([101, 100.9]);
    expect(slotRange(depth.askPrice, BYBIT).slice(0, 2)).toEqual([
      101.5, 101.6,
    ]);
    expect(depth.bidLevelCount[BYBIT]).toBe(2);
    expect(depth.askLevelCount[BYBIT]).toBe(2);
    expect(depth.writtenAt[BYBIT]).toBe(WRITTEN_AT);
  });

  it('accepts a one-sided book', () => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { engine, depth } = makeEngine();

    expect(
      engine.updateDepth(
        'bybit',
        RAW_MARKET_ID,
        BIDS.slice(0, 3),
        [],
        WRITTEN_AT,
      ),
    ).toBe(true);

    expect(warn).not.toHaveBeenCalled();
    expect(depth.bidLevelCount[BYBIT]).toBe(3);
    expect(depth.askLevelCount[BYBIT]).toBe(0);
    expect(depth.writtenAt[BYBIT]).toBe(WRITTEN_AT);
  });

  it.each<{
    name: string;
    bids: BookLevel[];
    asks: BookLevel[];
    ts: number;
    issue: string;
  }>([
    {
      name: 'non-positive bid price',
      bids: [[0, 1]],
      asks: ASKS,
      ts: 2_000,
      issue: 'bid_price_invalid',
    },
    {
      name: 'negative ask size',
      bids: BIDS,
      asks: [[101.5, -1]],
      ts: 2_000,
      issue: 'ask_size_invalid',
    },
    {
      name: 'ascending bids',
      bids: [
        [100.9, 1],
        [101, 1],
      ],
      asks: ASKS,
      ts: 2_000,
      issue: 'bids_out_of_order',
    },
    {
      name: 'descending asks',
      bids: BIDS,
      asks: [
        [101.6, 1],
        [101.5, 1],
      ],
      ts: 2_000,
      issue: 'asks_out_of_order',
    },
    {
      name: 'timestamp of zero',
      bids: BIDS.slice(1),
      asks: ASKS.slice(1),
      ts: 0,
      issue: 'ts_not_positive',
    },
  ])(
    'rejects a depth update with $name whole and leaves the slot as it was',
    ({ bids, asks, ts, issue }) => {
      const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
      const { engine, depth } = makeEngine();
      engine.updateDepth('bybit', RAW_MARKET_ID, BIDS, ASKS, WRITTEN_AT);
      const before = snapshotDepth(depth);

      expect(engine.updateDepth('bybit', RAW_MARKET_ID, bids, asks, ts)).toBe(
        false,
      );

      expect(snapshotDepth(depth)).toEqual(before);
      expect(warn).toHaveBeenCalledTimes(1);
      expect(warn).toHaveBeenCalledWith(
        expect.objectContaining({
          event: 'depth_update_rejected',
          venueId: 'bybit',
          rawMarketId: RAW_MARKET_ID,
          pair: 'BTC|USDT',
          issue,
          bids: bids.length,
          asks: asks.length,
        }),
      );
    },
  );

  it.each([
    { name: 'market', venueId: 'binance', rawMarketId: 'ETHUSDT' },
    { name: 'venue', venueId: 'okx', rawMarketId: RAW_MARKET_ID },
  ])('rejects a write for an unknown $name', ({ venueId, rawMarketId }) => {
    const warn = jest.spyOn(Logger.prototype, 'warn').mockImplementation();
    const { engine, depth } = makeEngine();

    expect(
      engine.updateDepth(venueId, rawMarketId, BIDS, ASKS, WRITTEN_AT),
    ).toBe(false);

    expectSlotUntouched(depth, 0);
    expectSlotUntouched(depth, BYBIT);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'depth_update_rejected',
        venueId,
        rawMarketId,
        issue: 'unknown_market',
      }),
    );
  });

  // A depth update is not a tick.
  // Tops that would cross the other slot's quote open nothing.
  it('runs no discovery and leaves layer 1 alone', () => {
    const { engine, cluster } = makeEngine();
    const validate = spyOnValidate(engine);

    // both venues quote inside the other's spread, so nothing is open
    engine.updateQuote('binance', RAW_MARKET_ID, {
      bid: 99.9,
      ask: 100,
      bidSize: 4,
      askSize: 5,
      recvTs: 1_000,
    });
    engine.updateQuote('bybit', RAW_MARKET_ID, {
      bid: 99.95,
      ask: 100.05,
      bidSize: 2,
      askSize: 3,
      recvTs: 1_000,
    });
    expect(validate).toHaveBeenCalledTimes(2);
    expect(openRoutes(engine).size).toBe(0);

    expect(engine.updateDepth('bybit', RAW_MARKET_ID, BIDS, ASKS, 2_000)).toBe(
      true,
    );

    expect(validate).toHaveBeenCalledTimes(2);
    expect(openRoutes(engine).size).toBe(0);
    expect(cluster.bid[BYBIT]).toBe(99.95);
    expect(cluster.ask[BYBIT]).toBe(100.05);
    expect(cluster.recvTs[BYBIT]).toBe(1_000);
  });

  it('drops a write after shutdown and changes nothing', async () => {
    const { engine, depth } = makeEngine();
    engine.updateDepth('bybit', RAW_MARKET_ID, BIDS, ASKS, WRITTEN_AT);
    const before = snapshotDepth(depth);

    await engine.shutdown(9_000);

    expect(
      engine.updateDepth(
        'bybit',
        RAW_MARKET_ID,
        BIDS.slice(1),
        ASKS.slice(1),
        10_000,
      ),
    ).toBe(false);
    expect(snapshotDepth(depth)).toEqual(before);
  });
});
