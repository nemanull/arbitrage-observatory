import { Logger } from '@nestjs/common';
import { createClusterAnchor, createClusterDepth } from './ClusterIndexBuilder';
import {
  MAX_SERIES_LENGTH,
  NO_ANCHOR,
  OpportunityManager,
} from './OpportunityManager';
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
    depth: createClusterDepth(width, 4), // four levels a slot, filled by the ladder walk tests only
    anchor: createClusterAnchor(width),
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
      anchor: null,
      anchorIssue: null,
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
      anchor: null,
      anchorIssue: null,
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
      anchor: null,
      anchorIssue: null,
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

// The walk reads the depth block on every sample. The block is filled here the way Engine.updateBook fills it.
describe('OpportunityManager ladder walk', () => {
  const LEVELS = 4;

  function setSide(
    cluster: Cluster,
    slot: number,
    side: 'bid' | 'ask',
    levels: [number, number][],
  ): void {
    const base = slot * LEVELS;
    const price =
      side === 'bid' ? cluster.depth.bidPrice : cluster.depth.askPrice;
    const size = side === 'bid' ? cluster.depth.bidSize : cluster.depth.askSize;
    levels.forEach(([p, q], l) => {
      price[base + l] = p;
      size[base + l] = q;
    });
    (side === 'bid'
      ? cluster.depth.bidLevelCount
      : cluster.depth.askLevelCount)[slot] = levels.length;
  }

  it('records the region behind the opening cross, from the buy asks and the sell bids', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    // We buy binance asks and sell into bybit bids. Two coins cross at 100 against 101, then one at 100.2 against 100.9, then 100.9 against 100.9 does not once both fees are on.
    setSide(cluster, BINANCE, 'ask', [
      [100, 2],
      [100.2, 1],
      [100.9, 3],
    ]);
    setSide(cluster, BYBIT, 'bid', [
      [101, 2],
      [100.9, 4],
    ]);

    const opened = openOn(manager, cluster, 1_000)!;

    expect(opened.edgeAtOpen).not.toBeNull();
    expect(opened.edgeAtOpen!.size).toBeCloseTo(3, 9);
    expect(opened.edgeAtOpen!.notional).toBeCloseTo(
      (100 * 2 + 100.2) * (1 + TAKER_PPM / 1_000_000),
      6,
    );
    expect(opened.edgeAtOpen!.exhausted).toBe(false);
    expect(opened.edgeAtOpen!.buyLevels).toBe(2);
    expect(opened.edgeAtOpen!.sellLevels).toBe(2);
    expect(opened.peakEdge).toBe(opened.edgeAtOpen);
    expect(opened.peakEdgeAt).toBe(1_000);
    expect(opened.lastEdge).toBe(opened.edgeAtOpen);
    expect(opened.maxEdgeNotional).toBeCloseTo(opened.edgeAtOpen!.notional, 9);
    expect(opened.edgeSamples).toBe(1);
  });

  it('moves the peak with a better average edge and keeps the largest region on its own', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    setSide(cluster, BINANCE, 'ask', [[100, 1]]);
    setSide(cluster, BYBIT, 'bid', [[101, 1]]);
    const opened = openOn(manager, cluster, 1_000)!;
    const openEdge = opened.edgeAtOpen!;

    // A deeper but thinner edge on the next bybit tick: more notional, a lower average.
    setSide(cluster, BINANCE, 'ask', [
      [100, 1],
      [100.4, 5],
    ]);
    setSide(cluster, BYBIT, 'bid', [
      [101, 1],
      [100.9, 5],
    ]);
    tick(manager, cluster, BYBIT, 101, 101.5, 2_000);

    expect(opened.peakEdge).toBe(openEdge);
    expect(opened.peakEdgeAt).toBe(1_000);
    expect(opened.lastEdge!.size).toBeCloseTo(6, 9);
    expect(opened.maxEdgeNotional).toBeCloseTo(opened.lastEdge!.notional, 9);
    expect(opened.edgeSamples).toBe(2);

    // A better average on the tick after, with the same top of book.
    setSide(cluster, BYBIT, 'bid', [[101.4, 1]]);
    tick(manager, cluster, BYBIT, 101.4, 101.5, 3_000);

    expect(opened.peakEdgeAt).toBe(3_000);
    expect(opened.peakEdge!.avgPpm).toBeGreaterThan(openEdge.avgPpm);
    expect(opened.edgeSamples).toBe(3);
  });

  it('records no edge while a leg holds no depth, and counts only the samples that had one', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const opened = openOn(manager, cluster, 1_000)!;

    expect(opened.edgeAtOpen).toBeNull();
    expect(opened.peakEdge).toBeNull();
    expect(opened.lastEdge).toBeNull();
    expect(opened.maxEdgeNotional).toBe(0);
    expect(opened.edgeSamples).toBe(0);

    setSide(cluster, BINANCE, 'ask', [[100, 1]]);
    setSide(cluster, BYBIT, 'bid', [[101, 1]]);
    tick(manager, cluster, BYBIT, 101, 101.5, 2_000);

    expect(opened.edgeAtOpen).toBeNull();
    expect(opened.peakEdge).not.toBeNull();
    expect(opened.peakEdgeAt).toBe(2_000);
    expect(opened.edgeSamples).toBe(1);
  });
});

describe('OpportunityManager edge on the row', () => {
  it('carries the walk at open, peak and close and the two series onto the row', () => {
    const queue = createOpportunityQueueMock();
    const add = jest.spyOn(queue, 'add');
    const manager = new OpportunityManager(queue);
    const cluster = makeCluster();
    const LEVELS = 4;
    const set = (
      slot: number,
      side: 'bid' | 'ask',
      levels: [number, number][],
    ) => {
      const base = slot * LEVELS;
      const price =
        side === 'bid' ? cluster.depth.bidPrice : cluster.depth.askPrice;
      const size =
        side === 'bid' ? cluster.depth.bidSize : cluster.depth.askSize;
      levels.forEach(([p, q], l) => {
        price[base + l] = p;
        size[base + l] = q;
      });
      (side === 'bid'
        ? cluster.depth.bidLevelCount
        : cluster.depth.askLevelCount)[slot] = levels.length;
    };

    // No depth on the opening tick, depth on the second, and a collapse on the third.
    const opened = openOn(manager, cluster, 1_000)!;
    set(BINANCE, 'ask', [[100, 1]]);
    set(BYBIT, 'bid', [[101, 1]]);
    tick(manager, cluster, BYBIT, 101, 101.5, 2_000);
    // The walk reads the block, so the collapse has to land there too, as updateBook would have it.
    set(BYBIT, 'bid', [[100.05, 1]]);
    tick(manager, cluster, BYBIT, 100.05, 100.1, 3_000);

    expect(opened.closeReason).toBe('spread_collapsed');
    const row = add.mock.calls[0][1].rows[0];
    expect(row.edgeAvgPpmAtOpen).toBeNull();
    expect(row.edgeSamples).toBe(2);
    expect(row.peakEdgeAt).toBe(new Date(2_000).toISOString());
    expect(row.peakEdgeSize).toBe(1);
    expect(row.peakEdgeExhausted).toBe(true);
    expect(row.maxEdgeNotional).toBeCloseTo(
      100 * (1 + TAKER_PPM / 1_000_000),
      9,
    );
    expect(row.edgeSizeAtClose).toBe(0); // the tops no longer cross, so the region is empty
    expect(row.edgeAvgPpmSeries).toEqual([-1, expect.any(Number), 0]);
    expect(row.edgeNotionalSeries).toEqual([-1, expect.any(Number), 0]);
  });
});

describe('OpportunityManager anchor filter', () => {
  const NOW = 10_000;

  function anchorLeg(
    cluster: Cluster,
    i: number,
    index: number,
    mark: number,
    writtenAt: number,
    fundingRate = 0.0001,
  ) {
    cluster.anchor.index[i] = index;
    cluster.anchor.mark[i] = mark;
    cluster.anchor.fundingRate[i] = fundingRate;
    cluster.anchor.fundingIntervalHours[i] = 8;
    cluster.anchor.nextFundingAt[i] = NOW + 3_600_000;
    cluster.anchor.writtenAt[i] = writtenAt;
  }

  it('opens unjudged when no anchor has been written yet', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const opened = openOn(manager, cluster, NOW);

    expect(opened).not.toBeNull();
    expect(opened?.anchorAtOpen).toBeNull();
  });

  // bybit's anchor sits one percent over binance's, which is the whole cross: the market already holds these two perps apart.
  it('rejects a cross the two anchors already explain', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    const warn = warnings(manager);
    anchorLeg(cluster, BINANCE, 100.2, 100.2, NOW - 100);
    anchorLeg(cluster, BYBIT, 101.2, 101.2, NOW - 100);

    const opened = openOn(manager, cluster, NOW);

    expect(opened).toBeNull();
    expect(routes(manager)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const payload = warn.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.event).toBe('opportunity_rejected');
    expect(payload.reason).toBe('standing_basis');
    expect(payload.route).toBe('bybit-binance');
    expect(payload.freshNetPpm as number).toBeLessThan(0);
    expect(payload.standingPpm as number).toBeGreaterThan(9_000);
    expect(payload.occurrenceCount).toBe(1);
  });

  it('opens when the anchors agree and records both legs on the route', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    anchorLeg(cluster, BINANCE, 100.5, 100.5, NOW - 100, 0.0001);
    anchorLeg(cluster, BYBIT, 100.5, 100.6, NOW - 300, -0.0038);

    const opened = openOn(manager, cluster, NOW);

    expect(opened).not.toBeNull();
    const anchor = opened!.anchorAtOpen!;
    expect(anchor.sell.index).toBe(100.5);
    expect(anchor.sell.mark).toBe(100.6);
    expect(anchor.sell.fundingRate).toBe(-0.0038);
    expect(anchor.sell.writtenAt).toBe(NOW - 300);
    expect(anchor.buy.premium).toBe(0);
    // bybit's mark sits ten basis points over its index, so that much of the cross is standing and the rest is fresh.
    const net = opened!.netPpmAtOpen;
    const fresh = ((1 + net / 1_000_000) / (100.6 / 100.5) - 1) * 1_000_000;
    expect(anchor.freshNetPpm).toBeCloseTo(fresh, 6);
    expect(anchor.standingPpm).toBeCloseTo(net - fresh, 6);
    expect(Math.round(anchor.standingPpm)).toBe(1_003);
  });

  it('reads a venue without a mark at its index', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    anchorLeg(cluster, BINANCE, 100.5, 0, NOW - 100);
    anchorLeg(cluster, BYBIT, 100.5, 100.5, NOW - 100);

    const opened = openOn(manager, cluster, NOW);

    expect(opened).not.toBeNull();
    expect(opened!.anchorAtOpen!.buy.premium).toBeNull();
    expect(opened!.anchorAtOpen!.freshNetPpm).toBeCloseTo(
      opened!.netPpmAtOpen,
      6,
    );
  });

  it('opens unjudged when the two anchors are too far apart in time or too old', () => {
    const skewed = new OpportunityManager(createOpportunityQueueMock());
    const skewedCluster = makeCluster();
    anchorLeg(skewedCluster, BINANCE, 100.2, 100.2, NOW - 100);
    anchorLeg(skewedCluster, BYBIT, 101.2, 101.2, NOW - 3_000);

    const stale = new OpportunityManager(createOpportunityQueueMock());
    const staleCluster = makeCluster();
    anchorLeg(staleCluster, BINANCE, 100.2, 100.2, NOW - 20_000);
    anchorLeg(staleCluster, BYBIT, 101.2, 101.2, NOW - 20_000);

    expect(openOn(skewed, skewedCluster, NOW)?.anchorAtOpen).toBeNull();
    expect(openOn(stale, staleCluster, NOW)?.anchorAtOpen).toBeNull();
  });

  it('warns once per window while a standing basis keeps coming back', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    const warn = warnings(manager);
    anchorLeg(cluster, BINANCE, 100.2, 100.2, NOW - 100);
    anchorLeg(cluster, BYBIT, 101.2, 101.2, NOW - 100);

    openOn(manager, cluster, NOW);
    tick(manager, cluster, BYBIT, 101.01, 101.5, NOW + 1_000);
    // The pollers keep writing while the basis stands, so the anchors are fresh again for the tick past the window.
    anchorLeg(cluster, BINANCE, 100.2, 100.2, NOW + 10_900);
    anchorLeg(cluster, BYBIT, 101.2, 101.2, NOW + 10_900);
    tick(manager, cluster, BYBIT, 101.02, 101.5, NOW + 11_000);

    expect(warn).toHaveBeenCalledTimes(2);
    const second = warn.mock.calls[1][0] as Record<string, unknown>;
    expect(second.occurrenceCount).toBe(4); // the open attempt, the okx tick behind it, and two bybit ticks
    expect(second.suppressedCount).toBe(2);
  });

  it('carries the anchor into the close log', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    const logger = Reflect.get(manager, 'logger') as Logger;
    const log = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    anchorLeg(cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchorLeg(cluster, BYBIT, 100.5, 100.5, NOW - 100);

    openOn(manager, cluster, NOW);
    tick(manager, cluster, BYBIT, 100, 100.5, NOW + 50); // collapses

    const closed = log.mock.calls
      .map((c) => c[0] as Record<string, unknown>)
      .find((entry) => entry.event === 'opportunity_closed')!;
    expect(closed.freshNetPpmAtOpen as number).toBeCloseTo(
      closed.netPpmAtOpen as number,
      6,
    );
    expect(closed.standingPpmAtOpen as number).toBeCloseTo(0, 6);
  });
});

describe('OpportunityManager anchor on the row', () => {
  const NOW = 10_000;

  function anchorLeg(
    cluster: Cluster,
    i: number,
    index: number,
    mark: number,
    writtenAt: number,
  ) {
    cluster.anchor.index[i] = index;
    cluster.anchor.mark[i] = mark;
    cluster.anchor.fundingRate[i] = i === BYBIT ? -0.0038 : 0.0001;
    cluster.anchor.fundingIntervalHours[i] = i === BYBIT ? 4 : 8;
    cluster.anchor.nextFundingAt[i] = NOW + 3_600_000;
    cluster.anchor.writtenAt[i] = writtenAt;
  }

  // The queue mock's add is already a jest.fn, so the spy is the same function and carries the calls made before this line.
  function enqueuedRow(queue: ReturnType<typeof createOpportunityQueueMock>) {
    const calls = jest.spyOn(queue, 'add').mock.calls as unknown as [
      string,
      { rows: Record<string, unknown>[] },
    ][];
    return calls[0][1].rows[0];
  }

  it('records the anchor series only when a leg moved, and the fresh series on every sample', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    anchorLeg(cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchorLeg(cluster, BYBIT, 100.5, 100.5, NOW - 100);

    const opened = openOn(manager, cluster, NOW)!;
    tick(manager, cluster, BYBIT, 101.1, 101.5, NOW + 100); // same anchors
    anchorLeg(cluster, BYBIT, 100.5, 100.7, NOW + 900); // the poller moved bybit's mark
    tick(manager, cluster, BYBIT, 101.2, 101.5, NOW + 1_000);
    tick(manager, cluster, BINANCE, 99.9, 100.1, NOW + 1_100); // same anchors again

    expect(opened.anchorTsMs).toEqual([0, 1_000]);
    expect(opened.highestBidMarkSeries).toEqual([100.5, 100.7]);
    expect(opened.highestBidIndexSeries).toEqual([100.5, 100.5]);
    expect(opened.lowestAskIndexSeries).toEqual([100.5, 100.5]);
    expect(opened.lowestAskMarkSeries).toEqual([100.5, 100.5]);
    expect(opened.freshNetPpmSeries).toHaveLength(opened.sampleTs.length);
    expect(opened.freshNetPpmSeries[0]).toBeCloseTo(opened.netPpmAtOpen, 6);
    // From the third sample on, ten basis points of bybit's premium are standing and the fresh series sits under the net series.
    expect(opened.freshNetPpmSeries[2]).toBeLessThan(
      opened.netPpmSeries[2] - 900,
    );
    expect(opened.lastAnchor?.sell.mark).toBe(100.7);
  });

  it('marks the samples where the anchor could not be read and leaves the anchor series alone', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    anchorLeg(cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchorLeg(cluster, BYBIT, 100.5, 100.5, NOW - 100);

    const opened = openOn(manager, cluster, NOW)!;
    tick(manager, cluster, BYBIT, 101.1, 101.5, NOW + 20_000); // both anchors are now stale

    expect(opened.freshNetPpmSeries).toEqual([expect.any(Number), NO_ANCHOR]);
    expect(opened.anchorTsMs).toEqual([0]);
    expect(opened.lastAnchor).toBeNull();
  });

  it('keeps the anchors at the peak sample', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    anchorLeg(cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchorLeg(cluster, BYBIT, 100.5, 100.5, NOW - 100);

    const opened = openOn(manager, cluster, NOW)!;
    anchorLeg(cluster, BYBIT, 100.5, 100.6, NOW + 400);
    tick(manager, cluster, BYBIT, 102, 102.5, NOW + 500); // the peak, with bybit's mark moved

    expect(opened.peakAt).toBe(NOW + 500);
    expect(opened.peakAnchor?.sell.mark).toBe(100.6);
    expect(opened.anchorAtOpen?.sell.mark).toBe(100.5);
  });

  it('writes the anchors, the derived edges and the series onto the row', () => {
    const queue = createOpportunityQueueMock();
    const manager = new OpportunityManager(queue);
    const cluster = makeCluster();
    anchorLeg(cluster, BINANCE, 100.5, 0, NOW - 300); // a venue without a mark
    anchorLeg(cluster, BYBIT, 100.5, 100.6, NOW - 100);

    const opened = openOn(manager, cluster, NOW)!;
    tick(manager, cluster, BYBIT, 100.1, 101.5, NOW + 50); // collapses
    const row = enqueuedRow(queue);

    expect(row.highestBidIndexAtOpen).toBe(100.5);
    expect(row.highestBidMarkAtOpen).toBe(100.6);
    expect(row.highestBidFundingRateAtOpen).toBe(-0.0038);
    expect(row.highestBidFundingIntervalHours).toBe(4);
    expect(row.highestBidNextFundingAt).toBe(
      new Date(NOW + 3_600_000).toISOString(),
    );
    expect(row.highestBidAnchorAt).toBe(new Date(NOW - 100).toISOString());
    expect(row.lowestAskMarkAtOpen).toBeNull();
    expect(row.lowestAskFundingIntervalHours).toBe(8);
    expect(row.lowestAskAnchorAt).toBe(new Date(NOW - 300).toISOString());
    expect(row.anchorIssueAtOpen).toBeNull();
    expect(row.freshNetPpmAtOpen).toBe(opened.anchorAtOpen?.freshNetPpm);
    expect(row.standingPpmAtOpen).toBe(opened.anchorAtOpen?.standingPpm);
    expect(row.freshNetPpmAtPeak).toBe(opened.peakAnchor?.freshNetPpm);
    expect(row.freshNetPpmAtClose).toBe(opened.lastAnchor?.freshNetPpm);
    expect(row.standingPpmAtClose).toBe(opened.lastAnchor?.standingPpm);
    expect(row.freshNetPpmSeries).toEqual(opened.freshNetPpmSeries);
    expect(row.anchorTsMs).toEqual([0]);
    expect(row.highestBidMarkSeries).toEqual([100.6]);
    expect(row.lowestAskMarkSeries).toEqual([0]);
  });

  it('writes nulls, the issue and empty series for a route that opened unjudged', () => {
    const queue = createOpportunityQueueMock();
    const manager = new OpportunityManager(queue);
    const cluster = makeCluster();
    anchorLeg(cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchorLeg(cluster, BYBIT, 100.5, 100.5, NOW - 5_000); // skewed

    openOn(manager, cluster, NOW);
    tick(manager, cluster, BYBIT, 100.1, 101.5, NOW + 50);
    const row = enqueuedRow(queue);

    expect(row.anchorIssueAtOpen).toBe('anchor_skewed');
    expect(row.highestBidIndexAtOpen).toBeNull();
    expect(row.lowestAskNextFundingAt).toBeNull();
    expect(row.freshNetPpmAtOpen).toBeNull();
    expect(row.freshNetPpmAtClose).toBeNull();
    expect(row.freshNetPpmSeries).toEqual([NO_ANCHOR, NO_ANCHOR]);
    expect(row.anchorTsMs).toEqual([]);
    expect(row.highestBidIndexSeries).toEqual([]);
  });
});

describe('OpportunityManager index quarantine', () => {
  const NOW = 100_000;
  const SECOND = 1_000;

  // Both legs read fresh at the tick, mark equal to index so the premiums explain nothing.
  function anchors(
    cluster: Cluster,
    binanceIndex: number,
    bybitIndex: number,
    now: number,
  ) {
    for (const [i, index] of [
      [BINANCE, binanceIndex],
      [BYBIT, bybitIndex],
    ]) {
      cluster.anchor.index[i] = index;
      cluster.anchor.mark[i] = index;
      cluster.anchor.fundingRate[i] = 0.0001;
      cluster.anchor.fundingIntervalHours[i] = 8;
      cluster.anchor.nextFundingAt[i] = now + 3_600_000;
      cluster.anchor.writtenAt[i] = now - 100;
    }
  }

  // bybit bids 106 against a binance ask of 100, the shape of a pair chained to two different indices.
  // Either tick can be the one that discovers the route, so whichever opened it is returned.
  function cross(manager: OpportunityManager, cluster: Cluster, now: number) {
    return (
      tick(manager, cluster, BINANCE, 99.9, 100, now) ??
      tick(manager, cluster, BYBIT, 106, 106.5, now)
    );
  }

  function events(spy: jest.SpyInstance): string[] {
    return (spy.mock.calls as unknown[][]).map(
      (c) => (c[0] as { event?: string }).event ?? 'text',
    );
  }

  it('sets a route aside once its indices have been apart for a minute, and stops reading it', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    const warn = warnings(manager);

    for (let t = 0; t <= 70; t += 10) {
      anchors(cluster, 100, 106, NOW + t * SECOND);
      expect(cross(manager, cluster, NOW + t * SECOND)).toBeNull();
    }

    const seen = events(warn);
    const quarantined = seen.indexOf('route_quarantined');
    expect(quarantined).toBeGreaterThan(0);
    expect(seen.slice(0, quarantined)).toEqual(
      Array<string>(quarantined).fill('opportunity_rejected'),
    );
    expect(seen.slice(quarantined + 1)).toEqual([]); // the ticks after it reach no anchor read and no log
    const payload = warn.mock.calls[quarantined][0] as Record<string, unknown>;
    expect(payload.route).toBe('bybit-binance');
    expect(Math.round(payload.gapPpm as number)).toBe(60_000); // the sell leg's index over the buy leg's
    expect(payload.apartMs).toBe(60_000);
    expect(routes(manager)).toBeUndefined();
  });

  it('does not set a route aside on a gap that closes inside the minute', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    const warn = warnings(manager);

    for (let t = 0; t <= 40; t += 10) {
      anchors(cluster, 100, 106, NOW + t * SECOND);
      expect(cross(manager, cluster, NOW + t * SECOND)).toBeNull();
    }
    anchors(cluster, 100, 100, NOW + 50 * SECOND);
    const opened = cross(manager, cluster, NOW + 50 * SECOND);

    expect(opened).not.toBeNull();
    expect(events(warn)).not.toContain('route_quarantined');
  });

  it('releases the route once the indices have agreed for five minutes of rechecks', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    const warn = warnings(manager);
    const logger = Reflect.get(manager, 'logger') as Logger;
    const log = jest.spyOn(logger, 'log').mockImplementation(() => undefined);

    for (let t = 0; t <= 60; t += 10) {
      anchors(cluster, 100, 106, NOW + t * SECOND);
      cross(manager, cluster, NOW + t * SECOND);
    }
    expect(events(warn)).toContain('route_quarantined');

    const rechecks = [120, 180, 240, 300, 360].map((t) => {
      anchors(cluster, 100, 100, NOW + t * SECOND);
      return cross(manager, cluster, NOW + t * SECOND);
    });
    anchors(cluster, 100, 100, NOW + 420 * SECOND);
    const opened = cross(manager, cluster, NOW + 420 * SECOND);

    expect(rechecks).toEqual([null, null, null, null, null]);
    expect(events(log)).toContain('route_released');
    expect(opened).not.toBeNull();
    expect(opened?.openedAt).toBe(NOW + 420 * SECOND);
  });

  it('keeps a route aside while the rechecks still see the gap', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    const logger = Reflect.get(manager, 'logger') as Logger;
    const log = jest.spyOn(logger, 'log').mockImplementation(() => undefined);
    warnings(manager);

    for (let t = 0; t <= 60; t += 10) {
      anchors(cluster, 100, 106, NOW + t * SECOND);
      cross(manager, cluster, NOW + t * SECOND);
    }
    for (const t of [120, 180, 240, 300, 360, 420, 480]) {
      anchors(cluster, 100, 106, NOW + t * SECOND);
      expect(cross(manager, cluster, NOW + t * SECOND)).toBeNull();
    }

    expect(events(log)).not.toContain('route_released');
  });

  it('neither convicts nor releases on anchors it cannot read', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    const warn = warnings(manager);

    for (let t = 0; t <= 120; t += 10) {
      anchors(cluster, 100, 106, NOW); // written once, stale after ten seconds
      cross(manager, cluster, NOW + t * SECOND);
    }

    expect(events(warn)).not.toContain('route_quarantined');
    expect(routes(manager)?.get('bybit-binance')?.anchorAtOpen).toBeNull(); // it opened unjudged instead
  });

  it('compares the indices in the same unit as the books', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();
    const warn = warnings(manager);
    // bybit quotes a tenth of binance's unit, and the cluster builder gave it a price scale of ten.
    cluster.bidMul[BYBIT] *= 10;
    cluster.askMul[BYBIT] *= 10;
    cluster.sizeMul[BYBIT] /= 10;

    let opened = null;
    for (let t = 0; t <= 70; t += 10) {
      anchors(cluster, 100.5, 10.05, NOW + t * SECOND);
      tick(manager, cluster, BINANCE, 99.9, 100, NOW + t * SECOND);
      opened ??= tick(manager, cluster, BYBIT, 10.1, 10.15, NOW + t * SECOND);
    }

    expect(opened).not.toBeNull();
    expect(events(warn)).not.toContain('route_quarantined');
  });
});
