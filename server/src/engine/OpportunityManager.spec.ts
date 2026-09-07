import { Logger } from '@nestjs/common';
import { createClusterDepth } from './ClusterIndexBuilder';
import { MAX_SERIES_LENGTH, OpportunityManager } from './OpportunityManager';
import { OPPORTUNITY_CLOSED_JOB } from './OpportunityWorker';
import type { ActiveOpportunityMap, Cluster, Market } from './types';
import { createOpportunityQueueMock } from '../../test/fixtures/opportunity-queue';

const TAKER_PPM = 550;
const AGE_CAP_MS = 5 * 60_000;

function market(venueId: string): Market {
  return {
    venueId,
    rawMarketId: 'BTCUSDT',
    base: 'BTC',
    quote: 'USDT',
    takerPpm: TAKER_PPM,
    linear: true,
    contractSize: 1,
  };
}

const binanceMarket = market('binance'); // slot 0
const bybitMarket = market('bybit'); // slot 1
const okxMarket = market('okx'); // slot 2

const BINANCE = 0;
const BYBIT = 1;
const OKX = 2;

function makeCluster(): Cluster {
  const markets = [binanceMarket, bybitMarket, okxMarket];
  const width = markets.length;
  const bidMul = new Float64Array(width);
  const askMul = new Float64Array(width);
  const sizeMul = new Float64Array(width);

  markets.forEach((m, i) => {
    bidMul[i] = 1 - m.takerPpm / 1_000_000;
    askMul[i] = 1 + m.takerPpm / 1_000_000;
    sizeMul[i] = m.contractSize;
  });

  return {
    pair: 'BTC|USDT',
    markets,
    bidMul,
    askMul,
    sizeMul,
    bid: new Float64Array(width),
    ask: new Float64Array(width),
    bidSize: new Float64Array(width),
    askSize: new Float64Array(width),
    recvTs: new Float64Array(width),
    depth: createClusterDepth(width, 4), // the manager never reads the block
  };
}

// One tick, exactly as Engine.updateQuote delivers it: one venue's quote lands in its slot,
// then validate runs for that venue.
function tick(
  manager: OpportunityManager,
  cluster: Cluster,
  index: number,
  bid: number,
  ask: number,
  now: number,
  bidSize = 0,
  askSize = 0,
) {
  cluster.bid[index] = bid;
  cluster.ask[index] = ask;
  cluster.bidSize[index] = bidSize;
  cluster.askSize[index] = askSize;
  cluster.recvTs[index] = now;

  return manager.validate(cluster, index, now);
}

function activeMap(manager: OpportunityManager): ActiveOpportunityMap {
  return Reflect.get(manager, 'activeOpportunityMap') as ActiveOpportunityMap;
}

function routes(manager: OpportunityManager) {
  return activeMap(manager).get('BTC|USDT');
}

function warnings(manager: OpportunityManager) {
  const logger = Reflect.get(manager, 'logger') as Logger;
  return jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
}

// bybit bids 101 against a binance ask of 100: ~8890ppm after 55bp taker each side.
// Returns what the bybit tick opened.
function openOn(manager: OpportunityManager, cluster: Cluster, now: number) {
  tick(manager, cluster, BINANCE, 99.9, 100, now);
  const opened = tick(manager, cluster, BYBIT, 101, 101.5, now);
  tick(manager, cluster, OKX, 99.4, 100.5, now);

  return opened;
}

describe('OpportunityManager.validate', () => {
  it('opens the best route once it clears MIN_NET_PPM', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const opened = openOn(manager, cluster, 1_000);

    expect(opened).not.toBeNull();
    expect(opened?.highestBidMarket.venueId).toBe('bybit');
    expect(opened?.lowestAskMarket.venueId).toBe('binance');
    expect(Math.round(opened!.netPpmAtOpen)).toBe(8_890);
    expect(opened?.openedAt).toBe(1_000);
    expect(opened?.closedAt).toBeNull();
    expect(opened?.closeReason).toBeNull();
    expect([...routes(manager)!.keys()]).toEqual(['bybit-binance']);
  });

  it('does not open a route below MIN_NET_PPM', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    tick(manager, cluster, BINANCE, 99.9, 100, 1_000);
    expect(tick(manager, cluster, BYBIT, 100.41, 101.5, 1_000)).toBeNull(); // ~2996ppm
    expect(tick(manager, cluster, OKX, 99.4, 100.5, 1_000)).toBeNull();

    expect(routes(manager)).toBeUndefined();
  });

  // The open threshold gates opening only. An episode that dips below it is still the
  // same episode and has to keep receiving data, or the 5000/1000 band cannot work.
  it('keeps feeding an open route that has fallen below MIN_NET_PPM', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const opened = openOn(manager, cluster, 1_000)!;

    // ~2996ppm: under open, over close
    expect(tick(manager, cluster, BYBIT, 100.41, 101.5, 2_000)).toBeNull(); // nothing new opened

    const stillOpen = routes(manager)!.get('bybit-binance');
    expect(stillOpen).toBe(opened);
    expect(stillOpen?.closedAt).toBeNull();
    expect(stillOpen?.lastSeenAt).toBe(2_000);
    expect(stillOpen?.netPpmSeries).toHaveLength(2);
    expect(Math.round(stillOpen!.netPpmSeries[1])).toBe(2_996);
    expect(Math.round(stillOpen!.minNetPpm)).toBe(2_996);
    expect(stillOpen?.sampleTs).toEqual([0, 1_000]);
  });

  it('closes an open route once it falls below CLOSE_NET_PPM', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const opened = openOn(manager, cluster, 1_000)!;

    tick(manager, cluster, BYBIT, 100.1, 101.5, 2_000); // ~-100ppm

    expect(routes(manager)!.has('bybit-binance')).toBe(false);
    expect(opened.closedAt).toBe(2_000);
    expect(opened.closeReason).toBe('spread_collapsed');
    // the collapsing tick is recorded before the close, so the series ends on it
    expect(opened.netPpmSeries).toHaveLength(2);
    expect(opened.minNetPpm).toBe(opened.netPpmSeries[1]);
  });

  it('tracks the peak instant, including the two prices behind it', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const opened = openOn(manager, cluster, 1_000)!;

    tick(manager, cluster, BYBIT, 101, 101.5, 2_000);
    tick(manager, cluster, OKX, 99.4, 99.5, 2_000); // best ask moves to okx, ~13959ppm

    tick(manager, cluster, BYBIT, 100.41, 101.5, 3_000); // back down

    const okxRoute = routes(manager)!.get('bybit-okx')!;
    expect(Math.round(okxRoute.peakNetPpm)).toBe(13_959);
    expect(okxRoute.peakAt).toBe(2_000);
    expect(okxRoute.peakHighestBid).toBeCloseTo(101 * (1 - TAKER_PPM / 1e6), 9);
    expect(okxRoute.peakLowestAsk).toBeCloseTo(99.5 * (1 + TAKER_PPM / 1e6), 9);
    // the earlier binance route peaked on its own, separate reading
    expect(Math.round(opened.peakNetPpm)).toBe(8_890);
  });
});

describe('OpportunityManager concurrent routes on one pair', () => {
  it('holds a second route open alongside the first', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    openOn(manager, cluster, 1_000); // best ask is binance -> bybit-binance

    const second = tick(manager, cluster, OKX, 99.4, 99.5, 2_000); // okx undercuts -> bybit-okx
    tick(manager, cluster, BYBIT, 101, 101.5, 2_000);
    tick(manager, cluster, BINANCE, 99.9, 100, 2_000);

    expect(second?.lowestAskMarket.venueId).toBe('okx');
    expect([...routes(manager)!.keys()]).toEqual([
      'bybit-binance',
      'bybit-okx',
    ]);
  });

  // Once okx undercuts it, bybit-binance is never the cluster's best route again, so
  // only the per-route update path can still see it.
  it('keeps updating a route the cluster scan no longer reports', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const overtaken = openOn(manager, cluster, 1_000)!;

    tick(manager, cluster, OKX, 99.4, 99.5, 2_000); // bybit-okx is the best route from here on
    tick(manager, cluster, BINANCE, 99.9, 100, 2_000); // a leg of the overtaken route ticks

    expect(overtaken.lastSeenAt).toBe(2_000);
    expect(overtaken.netPpmSeries).toHaveLength(2);

    // and it still closes on its own terms rather than lingering as a zombie
    tick(manager, cluster, BINANCE, 99.9, 101.2, 3_000); // binance ask rises, that route collapses
    tick(manager, cluster, BYBIT, 101, 101.5, 3_000);
    tick(manager, cluster, OKX, 99.4, 99.5, 3_000);

    expect(overtaken.closedAt).toBe(3_000);
    expect(overtaken.closeReason).toBe('spread_collapsed');
    expect([...routes(manager)!.keys()]).toEqual(['bybit-okx']);
  });
});

// Silence is not a close reason. Every feed is change-driven, so a leg that has not printed is a leg
// that has not changed, and only the age cap, a collapse, a dead socket or a shutdown ends an episode.
describe('OpportunityManager silence and the age cap', () => {
  it('keeps a route open while one leg stays quiet for minutes', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const opened = openOn(manager, cluster, 1_000)!;

    // binance keeps printing, bybit does not
    tick(manager, cluster, BINANCE, 99.9, 100, 120_000);

    expect(opened.closedAt).toBeNull();
    expect(opened.lastSeenAt).toBe(120_000);
    expect(manager.sweep(120_000)).toEqual([]);
    expect(routes(manager)!.get('bybit-binance')).toBe(opened);
  });

  it('sweeps a route that reached MAX_OPPORTUNITY_AGE_MS', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const opened = openOn(manager, cluster, 1_000)!;

    expect(manager.sweep(1_000 + AGE_CAP_MS - 1)).toEqual([]);
    expect(opened.closedAt).toBeNull();

    const closed = manager.sweep(1_000 + AGE_CAP_MS);

    expect(closed).toEqual([opened]);
    expect(opened.closedAt).toBe(1_000 + AGE_CAP_MS);
    expect(opened.closeReason).toBe('age_cap');
    expect(activeMap(manager).has('BTC|USDT')).toBe(false);
  });

  // The cap is a chunk boundary, not the end of the basis: the tick that closes the old episode opens the next one.
  it('closes at the cap on the tick path and lets the same tick reopen the route', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const first = openOn(manager, cluster, 1_000)!;

    const second = tick(
      manager,
      cluster,
      BYBIT,
      101,
      101.5,
      1_000 + AGE_CAP_MS,
    );

    expect(first.closedAt).toBe(1_000 + AGE_CAP_MS);
    expect(first.closeReason).toBe('age_cap');
    expect(first.netPpmSeries).toHaveLength(2);
    expect(second).not.toBeNull();
    expect(second).not.toBe(first);
    expect(second?.openedAt).toBe(1_000 + AGE_CAP_MS);
    expect(routes(manager)!.get('bybit-binance')).toBe(second);
  });
});

describe('OpportunityManager feed down', () => {
  it('closes every route with a leg in the dead slot, and only those', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    openOn(manager, cluster, 1_000);
    tick(manager, cluster, OKX, 99.4, 99.5, 2_000); // bybit-okx opens alongside bybit-binance
    tick(manager, cluster, BYBIT, 101, 101.5, 2_000);
    tick(manager, cluster, BINANCE, 99.9, 100, 2_000);

    expect(routes(manager)!.size).toBe(2);

    expect(
      manager.closeOpportunitiesOnVenue('BTC|USDT', OKX, 3_000),
    ).toHaveLength(1);
    expect([...routes(manager)!.keys()]).toEqual(['bybit-binance']);

    const closed = manager.closeOpportunitiesOnVenue('BTC|USDT', BYBIT, 4_000);

    expect(closed).toHaveLength(1);
    expect(closed[0].closedAt).toBe(4_000);
    expect(closed[0].closeReason).toBe('feed_down');
    expect(activeMap(manager).has('BTC|USDT')).toBe(false);
  });

  it('ignores a leg whose socket is down when discovering', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    tick(manager, cluster, BINANCE, 99.9, 100, 1_000);
    tick(manager, cluster, OKX, 99.4, 100.5, 1_000);
    cluster.bid[BYBIT] = 101;
    cluster.ask[BYBIT] = 101.5;
    cluster.recvTs[BYBIT] = 0; // the numbers are there, the socket is not

    expect(tick(manager, cluster, BINANCE, 99.9, 100.01, 2_000)).toBeNull();
    expect(routes(manager)).toBeUndefined();
  });

  it('returns nothing for a pair with no open routes', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());

    expect(manager.closeOpportunitiesOnVenue('BTC|USDT', BYBIT, 1_000)).toEqual(
      [],
    );
  });
});

describe('OpportunityManager.shutdown', () => {
  it('closes every open route with shutdown and waits for the queue', async () => {
    const queue = createOpportunityQueueMock();
    let settle: () => void = () => undefined;
    const add = jest.spyOn(queue, 'add').mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = () => resolve({});
        }) as never,
    );
    const manager = new OpportunityManager(queue);
    const cluster = makeCluster();

    const opened = openOn(manager, cluster, 1_000)!;

    let done = false;
    const closing = manager.shutdown(5_000).then((count) => {
      done = true;
      return count;
    });

    expect(opened.closedAt).toBe(5_000);
    expect(opened.closeReason).toBe('shutdown');
    expect(add).toHaveBeenCalledTimes(1);
    expect(activeMap(manager).size).toBe(0);

    await Promise.resolve();
    expect(done).toBe(false); // still waiting on Redis

    settle();
    expect(await closing).toBe(1);
  });

  it('also waits for a write that was already in flight', async () => {
    const queue = createOpportunityQueueMock();
    let settle: () => void = () => undefined;
    jest.spyOn(queue, 'add').mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = () => resolve({});
        }) as never,
    );
    const manager = new OpportunityManager(queue);
    const cluster = makeCluster();

    openOn(manager, cluster, 1_000);
    tick(manager, cluster, BYBIT, 100.1, 101.5, 2_000); // collapses, write in flight

    let done = false;
    const closing = manager.shutdown(3_000).then(() => {
      done = true;
    });

    await Promise.resolve();
    expect(done).toBe(false);

    settle();
    await closing;
    expect(done).toBe(true);
  });
});

describe('OpportunityManager series cap', () => {
  it('stops the series at MAX_SERIES_LENGTH while the counters keep going', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const observation = {
      cluster,
      highestBidMarket: bybitMarket,
      lowestAskMarket: binanceMarket,
      highestBidVenueIndex: BYBIT,
      lowestAskVenueIndex: BINANCE,
      highestBid: 101,
      lowestAsk: 100,
      highestBidSize: 2,
      lowestAskSize: 5,
      highestBidLegAsk: 101.5,
      lowestAskLegBid: 99.9,
      netPpm: 8_000,
      now: 1_000,
    };

    const opportunity = manager.trackOpportunity(observation);

    for (let i = 1; i < MAX_SERIES_LENGTH + 5; i++) {
      manager.trackOpportunity({
        ...observation,
        netPpm: 8_000 + i,
        now: 1_000 + i,
      });
    }

    // past the cap: a new peak and a new minimum, neither of which the series can hold
    manager.trackOpportunity({ ...observation, netPpm: 20_000, now: 20_000 });
    manager.trackOpportunity({ ...observation, netPpm: 500, now: 20_001 });

    expect(opportunity.netPpmSeries).toHaveLength(MAX_SERIES_LENGTH);
    expect(opportunity.highestBidSeries).toHaveLength(MAX_SERIES_LENGTH);
    expect(opportunity.lowestAskSeries).toHaveLength(MAX_SERIES_LENGTH);
    expect(opportunity.sampleTs).toHaveLength(MAX_SERIES_LENGTH);
    expect(opportunity.ticksSinceStart).toBe(1 + MAX_SERIES_LENGTH + 4 + 2); // the open, the loop, the two past the cap
    expect(opportunity.peakNetPpm).toBe(20_000);
    expect(opportunity.peakAt).toBe(20_000);
    expect(opportunity.minNetPpm).toBe(500);
    expect(opportunity.lastSeenAt).toBe(20_001);
  });
});

describe('OpportunityManager.trackOpportunity', () => {
  // It is the caller that owns MIN_NET_PPM and CLOSE_NET_PPM; this records whatever it is given.
  it('records a reading regardless of how small the edge is', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const opportunity = manager.trackOpportunity({
      cluster,
      highestBidMarket: bybitMarket,
      lowestAskMarket: binanceMarket,
      highestBidVenueIndex: BYBIT,
      lowestAskVenueIndex: BINANCE,
      highestBid: 100.01,
      lowestAsk: 100,
      highestBidSize: 2,
      lowestAskSize: 5,
      highestBidLegAsk: 100.02,
      lowestAskLegBid: 99.99,
      netPpm: 100,
      now: 1_000,
    });

    expect(opportunity.netPpmAtOpen).toBe(100);
    expect(routes(manager)!.get('bybit-binance')).toBe(opportunity);
  });

  it('updates the existing route instead of replacing it', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const observation = {
      cluster,
      highestBidMarket: bybitMarket,
      lowestAskMarket: binanceMarket,
      highestBidVenueIndex: BYBIT,
      lowestAskVenueIndex: BINANCE,
      highestBid: 101,
      lowestAsk: 100,
      highestBidSize: 2,
      lowestAskSize: 5,
      highestBidLegAsk: 101.5,
      lowestAskLegBid: 99.9,
      netPpm: 8_000,
      now: 1_000,
    };

    const first = manager.trackOpportunity(observation);
    const second = manager.trackOpportunity({
      ...observation,
      netPpm: 9_000,
      now: 1_500,
    });

    expect(second).toBe(first);
    expect(first.netPpmAtOpen).toBe(8_000);
    expect(first.peakNetPpm).toBe(9_000);
    expect(first.peakAt).toBe(1_500);
    expect(first.minNetPpm).toBe(8_000);
    expect(first.netPpmSeries).toEqual([8_000, 9_000]);
    expect(first.sampleTs).toEqual([0, 500]);
    expect(routes(manager)!.size).toBe(1);
  });
});

describe('OpportunityManager persistence', () => {
  it('enqueues the closed opportunity with its reason', () => {
    const queue = createOpportunityQueueMock();
    const add = jest.spyOn(queue, 'add');
    const manager = new OpportunityManager(queue);
    const cluster = makeCluster();

    openOn(manager, cluster, 1_000);
    tick(manager, cluster, BYBIT, 100.1, 101.5, 2_000);

    expect(add).toHaveBeenCalledTimes(1);
    expect(add).toHaveBeenCalledWith(OPPORTUNITY_CLOSED_JOB, {
      rows: [
        expect.objectContaining({
          pair: 'BTC|USDT',
          route: 'bybit-binance',
          openedAt: new Date(1_000).toISOString(),
          closedAt: new Date(2_000).toISOString(),
          closeReason: 'spread_collapsed',
          ticks: 2,
        }),
      ],
    });
    // the collapsing sample is the minimum, and it is what closed the route
    expect(add.mock.calls[0][1].rows[0].minNetPpm).toBeLessThan(1_000);
    expect(add.mock.calls[0][1].rows[0].netPpmAtClose).toBe(
      add.mock.calls[0][1].rows[0].minNetPpm,
    );
  });
});

// The general net for a collision clusterOverrides does not know about. okx bidding 1000 against a
// binance ask of 100 is ~8.99M ppm: the two legs are not the same asset, whatever the ticker says.
describe('OpportunityManager plausibility ceiling', () => {
  it('rejects a reading above MAX_PLAUSIBLE_NET_PPM, and says so', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    const warn = warnings(manager);

    tick(manager, cluster, BINANCE, 99.9, 100, 1_000);
    expect(tick(manager, cluster, OKX, 1_000, 1_001, 1_000)).toBeNull();

    expect(routes(manager)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'opportunity_rejected',
        reason: 'implausible_net_ppm',
        pair: 'BTC|USDT',
        route: 'okx-binance',
        maxPlausibleNetPpm: 100_000,
      }),
    );
  });

  it('still opens a large but plausible edge', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    const warn = warnings(manager);

    tick(manager, cluster, BINANCE, 99.9, 100, 1_000);
    const opened = tick(manager, cluster, OKX, 109, 110, 1_000); // ~88802ppm, under the ceiling

    expect(Math.round(opened!.netPpmAtOpen)).toBe(88_802);
    expect(warn).not.toHaveBeenCalled();
  });

  // A cluster like this is broken on every tick for the life of the process. The bursts are 4s apart
  // while the warning window is 10s.
  it('warns once per window and carries the suppressed count', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    const warn = warnings(manager);

    for (const now of [1_000, 4_000, 8_000]) {
      tick(manager, cluster, BINANCE, 99.9, 100, now);
      tick(manager, cluster, OKX, 1_000, 1_001, now);
    }

    expect(warn).toHaveBeenCalledTimes(1);

    tick(manager, cluster, BINANCE, 99.9, 100, 12_000);

    expect(warn).toHaveBeenCalledTimes(2);
    expect(warn).toHaveBeenLastCalledWith(
      expect.objectContaining({
        occurrenceCount: 6,
        suppressedCount: 4,
      }),
    );
  });
});

// The cluster holds raw sizes, so a reading applies sizeMul.
// The far sides go through the same multipliers as the touch.
describe('OpportunityManager book sizes and far sides', () => {
  const BID_MUL = 1 - TAKER_PPM / 1e6;
  const ASK_MUL = 1 + TAKER_PPM / 1e6;
  // expect.closeTo is typed any, which the lint forbids inside an object literal
  const near = (value: number): number => expect.closeTo(value, 9) as number;

  // bybit-binance opens on the bybit tick.
  // binance rests 4 at its bid and 5 at its ask, bybit 2 and 3.
  function openWithSizes(manager: OpportunityManager, cluster: Cluster) {
    tick(manager, cluster, BINANCE, 99.9, 100, 1_000, 4, 5);
    return tick(manager, cluster, BYBIT, 101, 101.5, 1_000, 2, 3)!;
  }

  it('snapshots the sizes and far sides of the tick that opened the route', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const opened = openWithSizes(manager, cluster);

    expect(opened).toMatchObject({
      highestBidSizeAtOpen: 2,
      lowestAskSizeAtOpen: 5,
      highestBidLegAskAtOpen: near(101.5 * ASK_MUL),
      lowestAskLegBidAtOpen: near(99.9 * BID_MUL),
      peakHighestBidSize: 2,
      peakLowestAskSize: 5,
      peakHighestBidLegAsk: near(101.5 * ASK_MUL),
      peakLowestAskLegBid: near(99.9 * BID_MUL),
      lastHighestBidSize: 2,
      lastLowestAskSize: 5,
      lastHighestBidLegAsk: near(101.5 * ASK_MUL),
      lastLowestAskLegBid: near(99.9 * BID_MUL),
    });
  });

  it('moves the peak reading with a new peak and keeps the open one', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const opened = openWithSizes(manager, cluster);

    tick(manager, cluster, BYBIT, 101.2, 101.7, 2_000, 6, 7); // ~10887ppm, a new peak
    tick(manager, cluster, BYBIT, 100.8, 101.3, 3_000, 8, 9); // ~6892ppm, under it

    expect(opened.peakAt).toBe(2_000);
    expect(opened).toMatchObject({
      highestBidSizeAtOpen: 2,
      lowestAskSizeAtOpen: 5,
      highestBidLegAskAtOpen: near(101.5 * ASK_MUL),
      lowestAskLegBidAtOpen: near(99.9 * BID_MUL),
      peakHighestBidSize: 6,
      peakLowestAskSize: 5,
      peakHighestBidLegAsk: near(101.7 * ASK_MUL),
      peakLowestAskLegBid: near(99.9 * BID_MUL),
      lastHighestBidSize: 8,
      lastLowestAskSize: 5,
      lastHighestBidLegAsk: near(101.3 * ASK_MUL),
      lastLowestAskLegBid: near(99.9 * BID_MUL),
    });
  });

  it('carries the last reading of either leg through to the close', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const opened = openWithSizes(manager, cluster);

    tick(manager, cluster, BINANCE, 99.8, 100.05, 2_000, 12, 13); // the buy leg moves, ~8386ppm

    expect(opened).toMatchObject({
      lastHighestBidSize: 2,
      lastLowestAskSize: 13,
      lastHighestBidLegAsk: near(101.5 * ASK_MUL),
      lastLowestAskLegBid: near(99.8 * BID_MUL),
    });

    tick(manager, cluster, BYBIT, 100.1, 101.4, 3_000, 10, 11); // ~-600ppm, collapses

    expect(opened.closeReason).toBe('spread_collapsed');
    expect(opened).toMatchObject({
      highestBidSizeAtOpen: 2,
      lowestAskSizeAtOpen: 5,
      peakHighestBidSize: 2,
      peakLowestAskSize: 5,
      peakHighestBidLegAsk: near(101.5 * ASK_MUL),
      peakLowestAskLegBid: near(99.9 * BID_MUL),
      lastHighestBidSize: 10,
      lastLowestAskSize: 13,
      lastHighestBidLegAsk: near(101.4 * ASK_MUL),
      lastLowestAskLegBid: near(99.8 * BID_MUL),
    });
  });

  it('reads a raw size through the slot multiplier', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    cluster.sizeMul[BYBIT] = 10; // ten coins per contract

    const opened = openWithSizes(manager, cluster);

    expect(opened.highestBidSizeAtOpen).toBe(20);
    expect(opened.lowestAskSizeAtOpen).toBe(5); // binance stays at one coin per contract
  });
});
