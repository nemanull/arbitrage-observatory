import { Logger } from '@nestjs/common';
import {
  createClusterAnchor,
  createClusterDepth,
} from '../cluster/ClusterIndexBuilder';
import { MAX_ANCHOR_MOVE_PPM } from './anchorReading';
import {
  MAX_SERIES_LENGTH,
  NO_ANCHOR,
  NO_EDGE,
  OpportunityLifecycle,
} from './OpportunityLifecycle';
import { OpportunityManager } from './OpportunityManager';
import { OPPORTUNITY_CLOSED_JOB } from './OpportunityWorker';
import type { Cluster, Market } from '../cluster/types';
import type { ActiveOpportunityMap, AnchorPair } from './types';
import {
  createOpportunityQueueMock,
  type OpportunityQueueMock,
} from '../../../test/fixtures/opportunity-queue';

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

// Every venue's index and mark in a polled cluster, so the anchors explain nothing and the fresh edge equals the raw edge.
const AGREED_INDEX = 100;

// Clusters whose pollers keep writing, so every tick finds both anchors fresh. The anchor specs build theirs unpolled and write each reading by hand.
const polled = new WeakSet<Cluster>();

function makeCluster(polling = true): Cluster {
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

  const cluster: Cluster = {
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
    depth: createClusterDepth(width, 4), // four levels a slot, one seeded by tick and the rest filled by the ladder walk tests
    anchor: createClusterAnchor(width),
  };

  if (polling) {
    cluster.anchor.index.fill(AGREED_INDEX);
    cluster.anchor.mark.fill(AGREED_INDEX);
    cluster.anchor.fundingIntervalHours.fill(8);
    polled.add(cluster);
  }

  return cluster;
}

// What trackOpportunity is handed for a route whose anchors agree. It records whatever it is given.
const AGREED_ANCHOR: AnchorPair = (() => {
  const leg = {
    index: AGREED_INDEX,
    mark: AGREED_INDEX,
    touch: AGREED_INDEX,
    touchPremium: 0,
    markPremium: 0,
    freshPremium: 0,
    fundingRate: 0,
    fundingIntervalHours: 8,
    nextFundingAt: 0,
    writtenAt: 1_000,
  };
  return {
    sell: leg,
    buy: { ...leg },
    indexGapPpm: 0,
    carriedPpm: 0,
    freshNetPpm: 8_000,
    standingPpm: 0,
  };
})();

// The block as Engine.updateBook fills it, one side of one slot at a time.
function setSide(
  cluster: Cluster,
  slot: number,
  side: 'bid' | 'ask',
  levels: [number, number][],
): void {
  const base = slot * cluster.depth.maxLevels;
  const price =
    side === 'bid' ? cluster.depth.bidPrice : cluster.depth.askPrice;
  const size = side === 'bid' ? cluster.depth.bidSize : cluster.depth.askSize;
  levels.forEach(([p, q], l) => {
    price[base + l] = p;
    size[base + l] = q;
  });
  (side === 'bid' ? cluster.depth.bidLevelCount : cluster.depth.askLevelCount)[
    slot
  ] = levels.length;
}

// Enough coins on one level that the region behind any cross near 100 clears MIN_EDGE_NOTIONAL.
const SEEDED_SIZE = 100;

// A quote arrives on a book message, so a tick rests one level at each touch.
// Only a side that holds nothing yet is seeded, so a spec that fills the block itself keeps its own levels.
function seedDepth(
  cluster: Cluster,
  slot: number,
  bid: number,
  ask: number,
): void {
  if (cluster.depth.bidLevelCount[slot] === 0) {
    setSide(cluster, slot, 'bid', [[bid, SEEDED_SIZE]]);
  }

  if (cluster.depth.askLevelCount[slot] === 0) {
    setSide(cluster, slot, 'ask', [[ask, SEEDED_SIZE]]);
  }
}

// One tick, exactly as Engine.updateBook delivers it: one venue's quote lands in its slot with a level behind it,
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
  seedDepth(cluster, index, bid, ask);

  if (polled.has(cluster)) {
    cluster.anchor.writtenAt.fill(now);
  }

  return manager.validate(cluster, index, now);
}

function createManager(
  queue: OpportunityQueueMock = createOpportunityQueueMock(),
): OpportunityManager {
  return new OpportunityManager(new OpportunityLifecycle(queue));
}

function lifecycleOf(manager: OpportunityManager): OpportunityLifecycle {
  return Reflect.get(manager, 'lifecycle') as OpportunityLifecycle;
}

function activeMap(manager: OpportunityManager): ActiveOpportunityMap {
  return Reflect.get(
    lifecycleOf(manager),
    'activeOpportunityMap',
  ) as ActiveOpportunityMap;
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
    const manager = createManager();
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
    const manager = createManager();
    const cluster = makeCluster();

    tick(manager, cluster, BINANCE, 99.9, 100, 1_000);
    expect(tick(manager, cluster, BYBIT, 100.41, 101.5, 1_000)).toBeNull(); // ~2996ppm
    expect(tick(manager, cluster, OKX, 99.4, 100.5, 1_000)).toBeNull();

    expect(routes(manager)).toBeUndefined();
  });

  // The open threshold gates opening only. An episode that dips below it is still the
  // same episode and has to keep receiving data, or the 5000/1000 band cannot work.
  it('keeps feeding an open route that has fallen below MIN_NET_PPM', () => {
    const manager = createManager();
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
    const manager = createManager();
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
    const manager = createManager();
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
    const manager = createManager();
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
    const manager = createManager();
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
    const manager = createManager();
    const cluster = makeCluster();

    const opened = openOn(manager, cluster, 1_000)!;

    // binance keeps printing, bybit does not
    tick(manager, cluster, BINANCE, 99.9, 100, 120_000);

    expect(opened.closedAt).toBeNull();
    expect(opened.lastSeenAt).toBe(120_000);
    expect(lifecycleOf(manager).sweep(120_000)).toEqual([]);
    expect(routes(manager)!.get('bybit-binance')).toBe(opened);
  });

  it('sweeps a route that reached MAX_OPPORTUNITY_AGE_MS', () => {
    const manager = createManager();
    const cluster = makeCluster();

    const opened = openOn(manager, cluster, 1_000)!;

    expect(lifecycleOf(manager).sweep(1_000 + AGE_CAP_MS - 1)).toEqual([]);
    expect(opened.closedAt).toBeNull();

    const closed = lifecycleOf(manager).sweep(1_000 + AGE_CAP_MS);

    expect(closed).toEqual([opened]);
    expect(opened.closedAt).toBe(1_000 + AGE_CAP_MS);
    expect(opened.closeReason).toBe('age_cap');
    expect(activeMap(manager).has('BTC|USDT')).toBe(false);
  });

  // The cap is a chunk boundary, not the end of the basis: the tick that closes the old episode opens the next one.
  it('closes at the cap on the tick path and lets the same tick reopen the route', () => {
    const manager = createManager();
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

describe('OpportunityLifecycle feed down', () => {
  it('closes every route with a leg in the dead slot, and only those', () => {
    const manager = createManager();
    const cluster = makeCluster();

    openOn(manager, cluster, 1_000);
    tick(manager, cluster, OKX, 99.4, 99.5, 2_000); // bybit-okx opens alongside bybit-binance
    tick(manager, cluster, BYBIT, 101, 101.5, 2_000);
    tick(manager, cluster, BINANCE, 99.9, 100, 2_000);

    expect(routes(manager)!.size).toBe(2);

    expect(
      lifecycleOf(manager).closeOpportunitiesOnVenue('BTC|USDT', OKX, 3_000),
    ).toHaveLength(1);
    expect([...routes(manager)!.keys()]).toEqual(['bybit-binance']);

    const closed = lifecycleOf(manager).closeOpportunitiesOnVenue(
      'BTC|USDT',
      BYBIT,
      4_000,
    );

    expect(closed).toHaveLength(1);
    expect(closed[0].closedAt).toBe(4_000);
    expect(closed[0].closeReason).toBe('feed_down');
    expect(activeMap(manager).has('BTC|USDT')).toBe(false);
  });

  it('ignores a leg whose socket is down when discovering', () => {
    const manager = createManager();
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
    const manager = createManager();

    expect(
      lifecycleOf(manager).closeOpportunitiesOnVenue('BTC|USDT', BYBIT, 1_000),
    ).toEqual([]);
  });
});

describe('OpportunityLifecycle.shutdown', () => {
  it('closes every open route with shutdown and waits for the queue', async () => {
    const queue = createOpportunityQueueMock();
    let settle: () => void = () => undefined;
    const add = jest.spyOn(queue, 'add').mockImplementation(
      () =>
        new Promise((resolve) => {
          settle = () => resolve({});
        }) as never,
    );
    const manager = createManager(queue);
    const cluster = makeCluster();

    const opened = openOn(manager, cluster, 1_000)!;

    let done = false;
    const closing = lifecycleOf(manager)
      .shutdown(5_000)
      .then((count) => {
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
    const manager = createManager(queue);
    const cluster = makeCluster();

    openOn(manager, cluster, 1_000);
    tick(manager, cluster, BYBIT, 100.1, 101.5, 2_000); // collapses, write in flight

    let done = false;
    const closing = lifecycleOf(manager)
      .shutdown(3_000)
      .then(() => {
        done = true;
      });

    await Promise.resolve();
    expect(done).toBe(false);

    settle();
    await closing;
    expect(done).toBe(true);
  });
});

describe('OpportunityLifecycle series cap', () => {
  it('stops the series at MAX_SERIES_LENGTH while the counters keep going', () => {
    const manager = createManager();
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
      anchor: AGREED_ANCHOR,
      now: 1_000,
    };

    const opportunity = lifecycleOf(manager).trackOpportunity(observation);

    for (let i = 1; i < MAX_SERIES_LENGTH + 5; i++) {
      lifecycleOf(manager).trackOpportunity({
        ...observation,
        netPpm: 8_000 + i,
        now: 1_000 + i,
      });
    }

    // past the cap: a new peak and a new minimum, neither of which the series can hold
    lifecycleOf(manager).trackOpportunity({
      ...observation,
      netPpm: 20_000,
      now: 20_000,
    });
    lifecycleOf(manager).trackOpportunity({
      ...observation,
      netPpm: 500,
      now: 20_001,
    });

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

describe('OpportunityLifecycle.trackOpportunity', () => {
  // It is the caller that owns MIN_NET_PPM and CLOSE_NET_PPM; this records whatever it is given.
  it('records a reading regardless of how small the edge is', () => {
    const manager = createManager();
    const cluster = makeCluster();

    const opportunity = lifecycleOf(manager).trackOpportunity({
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
      anchor: AGREED_ANCHOR,
      now: 1_000,
    });

    expect(opportunity.netPpmAtOpen).toBe(100);
    expect(routes(manager)!.get('bybit-binance')).toBe(opportunity);
  });

  it('updates the existing route instead of replacing it', () => {
    const manager = createManager();
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
      anchor: AGREED_ANCHOR,
      now: 1_000,
    };

    const first = lifecycleOf(manager).trackOpportunity(observation);
    const second = lifecycleOf(manager).trackOpportunity({
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
    const manager = createManager(queue);
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
    const manager = createManager();
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
    const manager = createManager();
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
    const manager = createManager();
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
    const manager = createManager();
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
    const manager = createManager();
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
    const manager = createManager();
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
    const manager = createManager();
    const cluster = makeCluster();
    cluster.sizeMul[BYBIT] = 10; // ten coins per contract

    const opened = openWithSizes(manager, cluster);

    expect(opened.highestBidSizeAtOpen).toBe(20);
    expect(opened.lowestAskSizeAtOpen).toBe(5); // binance stays at one coin per contract
  });
});

// The walk reads the depth block on every sample.
// The regions here hold twenty coins or more, so they clear the floor at open.
describe('OpportunityManager ladder walk', () => {
  it('records the region behind the opening cross, from the buy asks and the sell bids', () => {
    const manager = createManager();
    const cluster = makeCluster();
    // We buy binance asks and sell into bybit bids.
    // Twenty coins cross at 100 against 101, then ten at 100.2 against 100.9, then 100.9 against 100.9 does not once both fees are on.
    setSide(cluster, BINANCE, 'ask', [
      [100, 20],
      [100.2, 10],
      [100.9, 30],
    ]);
    setSide(cluster, BYBIT, 'bid', [
      [101, 20],
      [100.9, 40],
    ]);

    const opened = openOn(manager, cluster, 1_000)!;

    expect(opened.edgeAtOpen).not.toBeNull();
    expect(opened.edgeAtOpen!.size).toBeCloseTo(30, 9);
    expect(opened.edgeAtOpen!.notional).toBeCloseTo(
      (100 * 20 + 100.2 * 10) * (1 + TAKER_PPM / 1_000_000),
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
    const manager = createManager();
    const cluster = makeCluster();
    setSide(cluster, BINANCE, 'ask', [[100, 20]]);
    setSide(cluster, BYBIT, 'bid', [[101, 20]]);
    const opened = openOn(manager, cluster, 1_000)!;
    const openEdge = opened.edgeAtOpen!;

    // A deeper but thinner edge on the next bybit tick: more notional, a lower average.
    setSide(cluster, BINANCE, 'ask', [
      [100, 20],
      [100.4, 100],
    ]);
    setSide(cluster, BYBIT, 'bid', [
      [101, 20],
      [100.9, 100],
    ]);
    tick(manager, cluster, BYBIT, 101, 101.5, 2_000);

    expect(opened.peakEdge).toBe(openEdge);
    expect(opened.peakEdgeAt).toBe(1_000);
    expect(opened.lastEdge!.size).toBeCloseTo(120, 9);
    expect(opened.maxEdgeNotional).toBeCloseTo(opened.lastEdge!.notional, 9);
    expect(opened.edgeSamples).toBe(2);

    // A better average on the tick after, with the same top of book.
    setSide(cluster, BYBIT, 'bid', [[101.4, 1]]);
    tick(manager, cluster, BYBIT, 101.4, 101.5, 3_000);

    expect(opened.peakEdgeAt).toBe(3_000);
    expect(opened.peakEdge!.avgPpm).toBeGreaterThan(openEdge.avgPpm);
    expect(opened.edgeSamples).toBe(3);
  });

  it('records no edge on a sample where a leg holds no depth, and counts only the samples that had one', () => {
    const manager = createManager();
    const cluster = makeCluster();
    setSide(cluster, BINANCE, 'ask', [[100, 20]]);
    setSide(cluster, BYBIT, 'bid', [[101, 20]]);
    const opened = openOn(manager, cluster, 1_000)!;

    setSide(cluster, BINANCE, 'ask', []); // binance's asks leave the block, and a bybit tick does not refill them
    tick(manager, cluster, BYBIT, 101, 101.5, 2_000);

    expect(opened.lastEdge).toBeNull();
    expect(opened.peakEdge).toBe(opened.edgeAtOpen);
    expect(opened.maxEdgeNotional).toBeCloseTo(opened.edgeAtOpen!.notional, 9);
    expect(opened.edgeSamples).toBe(1);
    expect(opened.edgeAvgPpmSeries).toEqual([expect.any(Number), NO_EDGE]);
  });
});

// The floor reads the walk at open, docs/bestiary/thin-book.md.
// A refused route is tried again on every tick.
describe('OpportunityManager region floor', () => {
  it('refuses a route whose region is under MIN_EDGE_NOTIONAL and says so', () => {
    const manager = createManager();
    const cluster = makeCluster();
    const warn = warnings(manager);
    setSide(cluster, BINANCE, 'ask', [[100, 2]]); // two coins behind the cross, about 200 quote units
    setSide(cluster, BYBIT, 'bid', [[101, 2]]);

    expect(openOn(manager, cluster, 1_000)).toBeNull();

    expect(routes(manager)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1);
    const payload = warn.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.event).toBe('opportunity_rejected');
    expect(payload.reason).toBe('thin_book');
    expect(payload.route).toBe('bybit-binance');
    expect(payload.edgeNotional as number).toBeCloseTo(
      200 * (1 + TAKER_PPM / 1_000_000),
      9,
    );
    expect(payload.edgeSize).toBe(2);
    expect(Math.round(payload.edgeAvgPpm as number)).toBe(8_890);
  });

  it('refuses a route while a leg holds no depth', () => {
    const manager = createManager();
    const cluster = makeCluster();
    const warn = warnings(manager);
    tick(manager, cluster, BINANCE, 99.9, 100, 1_000);
    setSide(cluster, BINANCE, 'ask', []); // the asks behind binance's quote are gone from the block

    expect(tick(manager, cluster, BYBIT, 101, 101.5, 1_000)).toBeNull();

    expect(routes(manager)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'opportunity_rejected',
        reason: 'thin_book',
        route: 'bybit-binance',
        edgeNotional: null,
        edgeAvgPpm: null,
        edgeSize: null,
      }),
    );
  });
});

describe('OpportunityManager edge on the row', () => {
  it('carries the walk at open, peak and close and the two series onto the row', () => {
    const queue = createOpportunityQueueMock();
    const add = jest.spyOn(queue, 'add');
    const manager = createManager(queue);
    const cluster = makeCluster();

    // Twenty coins behind the opening cross, a better average on one coin on the second tick, and a collapse on the third.
    setSide(cluster, BINANCE, 'ask', [[100, 20]]);
    setSide(cluster, BYBIT, 'bid', [[101, 20]]);
    const opened = openOn(manager, cluster, 1_000)!;
    setSide(cluster, BYBIT, 'bid', [[101.4, 1]]);
    tick(manager, cluster, BYBIT, 101.4, 101.5, 2_000);
    // The walk reads the block, so the collapse has to land there too, as updateBook would have it.
    setSide(cluster, BYBIT, 'bid', [[100.05, 1]]);
    tick(manager, cluster, BYBIT, 100.05, 100.1, 3_000);

    expect(opened.closeReason).toBe('spread_collapsed');
    const row = add.mock.calls[0][1].rows[0];
    expect(row.edgeSizeAtOpen).toBe(20);
    expect(row.edgeSamples).toBe(3);
    expect(row.peakEdgeAt).toBe(new Date(2_000).toISOString());
    expect(row.peakEdgeSize).toBe(1);
    expect(row.peakEdgeExhausted).toBe(true);
    expect(row.maxEdgeNotional).toBeCloseTo(
      2_000 * (1 + TAKER_PPM / 1_000_000),
      9,
    );
    expect(row.edgeSizeAtClose).toBe(0); // the tops no longer cross, so the region is empty
    expect(row.edgeAvgPpmSeries).toEqual([
      expect.any(Number),
      expect.any(Number),
      0,
    ]);
    expect(row.edgeNotionalSeries).toEqual([
      expect.any(Number),
      expect.any(Number),
      0,
    ]);
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

  it('refuses a cross whose anchors were never written', () => {
    const manager = createManager();
    const cluster = makeCluster(false);
    const warn = warnings(manager);

    const opened = openOn(manager, cluster, NOW);

    expect(opened).toBeNull();
    expect(routes(manager)).toBeUndefined();
    expect(warn).toHaveBeenCalledTimes(1); // the okx tick behind it is the same route inside the window
    const payload = warn.mock.calls[0][0] as Record<string, unknown>;
    expect(payload.event).toBe('opportunity_rejected');
    expect(payload.reason).toBe('anchor_missing');
    expect(payload.route).toBe('bybit-binance');
    expect(payload.netPpm as number).toBeGreaterThan(5_000);
  });

  // bybit's anchor sits one percent over binance's, which is the whole cross: the market already holds these two perps apart.
  it('rejects a cross the two anchors already explain', () => {
    const manager = createManager();
    const cluster = makeCluster(false);
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
    expect(Math.round(payload.indexGapPpm as number)).toBe(9_980); // all of it is the index gap, the marks sit on their indices
    expect(payload.carriedPpm as number).toBeCloseTo(0, 6);
    expect(payload.occurrenceCount).toBe(1);
  });

  it('opens when the anchors agree and records both legs on the route', () => {
    const manager = createManager();
    const cluster = makeCluster(false);
    anchorLeg(cluster, BINANCE, 100.5, 100.5, NOW - 100, 0.0001);
    anchorLeg(cluster, BYBIT, 100.5, 100.6, NOW - 300, -0.0038);

    const opened = openOn(manager, cluster, NOW);

    expect(opened).not.toBeNull();
    const anchor = opened!.anchorAtOpen;
    expect(anchor.sell.index).toBe(100.5);
    expect(anchor.sell.mark).toBe(100.6);
    expect(anchor.sell.fundingRate).toBe(-0.0038);
    expect(anchor.sell.writtenAt).toBe(NOW - 300);
    expect(anchor.buy.markPremium).toBe(0);
    // bybit's mark sits ten basis points over its index, so that much of the cross is standing and the rest is fresh.
    const net = opened!.netPpmAtOpen;
    const fresh = ((1 + net / 1_000_000) / (100.6 / 100.5) - 1) * 1_000_000;
    expect(anchor.freshNetPpm).toBeCloseTo(fresh, 6);
    expect(anchor.standingPpm).toBeCloseTo(net - fresh, 6);
    expect(Math.round(anchor.standingPpm)).toBe(1_003);
  });

  it('refuses a venue without a mark', () => {
    const manager = createManager();
    const cluster = makeCluster(false);
    const warn = warnings(manager);
    anchorLeg(cluster, BINANCE, 100.5, 0, NOW - 100);
    anchorLeg(cluster, BYBIT, 100.5, 100.5, NOW - 100);

    expect(openOn(manager, cluster, NOW)).toBeNull();

    expect(routes(manager)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'opportunity_rejected',
        reason: 'anchor_no_mark',
        route: 'bybit-binance',
      }),
    );
  });

  it('refuses a cross while an anchor is moving', () => {
    const manager = createManager();
    const cluster = makeCluster(false);
    const warn = warnings(manager);
    anchorLeg(cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchorLeg(cluster, BYBIT, 100.5, 100.5, NOW - 100);
    cluster.anchor.movePpm[BYBIT] = MAX_ANCHOR_MOVE_PPM + 1; // bybit's last poll moved more than the reader allows

    expect(openOn(manager, cluster, NOW)).toBeNull();

    expect(routes(manager)).toBeUndefined();
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        event: 'opportunity_rejected',
        reason: 'anchor_moving',
        route: 'bybit-binance',
        sellMovePpm: MAX_ANCHOR_MOVE_PPM + 1,
        buyMovePpm: 0,
      }),
    );
  });

  it('refuses a cross whose two anchors are too far apart in time or too old', () => {
    const skewed = createManager();
    const skewedWarn = warnings(skewed);
    const skewedCluster = makeCluster(false);
    anchorLeg(skewedCluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchorLeg(skewedCluster, BYBIT, 100.5, 100.5, NOW - 6_000);

    const stale = createManager();
    const staleWarn = warnings(stale);
    const staleCluster = makeCluster(false);
    anchorLeg(staleCluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchorLeg(staleCluster, BYBIT, 100.5, 100.5, NOW - 100);

    expect(openOn(skewed, skewedCluster, NOW)).toBeNull();
    expect(openOn(stale, staleCluster, NOW + 20_000)).toBeNull(); // both read twenty seconds before the cross
    const reason = (spy: jest.SpyInstance) =>
      ((spy.mock.calls as unknown[][])[0][0] as Record<string, unknown>).reason;
    expect(reason(skewedWarn)).toBe('anchor_skewed');
    expect(reason(staleWarn)).toBe('anchor_stale');
  });

  it('opens on two anchors read within the skew', () => {
    const manager = createManager();
    const cluster = makeCluster(false);
    anchorLeg(cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchorLeg(cluster, BYBIT, 100.5, 100.5, NOW - 4_000); // a slow bybit round, stamped when its reply arrived

    expect(openOn(manager, cluster, NOW)?.anchorAtOpen.buy.writtenAt).toBe(
      NOW - 100,
    );
  });

  it('warns once per window while a standing basis keeps coming back', () => {
    const manager = createManager();
    const cluster = makeCluster(false);
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
    const manager = createManager();
    const cluster = makeCluster(false);
    const logger = Reflect.get(lifecycleOf(manager), 'logger') as Logger;
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
    const manager = createManager();
    const cluster = makeCluster(false);
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
    const manager = createManager();
    const cluster = makeCluster(false);
    anchorLeg(cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchorLeg(cluster, BYBIT, 100.5, 100.5, NOW - 100);

    const opened = openOn(manager, cluster, NOW)!;
    tick(manager, cluster, BYBIT, 101.1, 101.5, NOW + 20_000); // both anchors are now stale

    expect(opened.freshNetPpmSeries).toEqual([expect.any(Number), NO_ANCHOR]);
    expect(opened.anchorTsMs).toEqual([0]);
    expect(opened.lastAnchor).toBeNull();
    expect(opened.closedAt).toBeNull(); // a sample with no verdict closes nothing
  });

  it('closes as fresh_edge_collapsed once the anchors explain a cross that still clears', () => {
    const queue = createOpportunityQueueMock();
    const manager = createManager(queue);
    const cluster = makeCluster(false);
    warnings(manager);
    anchorLeg(cluster, BINANCE, 100.5, 100.5, NOW - 100);
    anchorLeg(cluster, BYBIT, 100.5, 100.5, NOW - 100);

    const opened = openOn(manager, cluster, NOW)!;
    // bybit's index and mark climb to its book, so the same raw cross is now almost all standing.
    anchorLeg(cluster, BYBIT, 101.4, 101.4, NOW + 900);
    tick(manager, cluster, BYBIT, 101, 101.5, NOW + 1_000);

    expect(opened.closeReason).toBe('fresh_edge_collapsed');
    expect(opened.lastNetPpm).toBeGreaterThan(5_000);
    expect(opened.lastAnchor!.freshNetPpm).toBeLessThan(1_000);
    expect(routes(manager)!.has('bybit-binance')).toBe(false); // and discovery refuses it as a standing basis on the same tick
    expect(enqueuedRow(queue).closeReason).toBe('fresh_edge_collapsed');
  });

  it('keeps the anchors at the peak sample', () => {
    const manager = createManager();
    const cluster = makeCluster(false);
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
    const manager = createManager(queue);
    const cluster = makeCluster(false);
    anchorLeg(cluster, BINANCE, 100.5, 100.5, NOW - 300); // binance's mark sits on its index
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
    expect(row.lowestAskMarkAtOpen).toBe(100.5);
    expect(row.lowestAskFundingIntervalHours).toBe(8);
    expect(row.lowestAskAnchorAt).toBe(new Date(NOW - 300).toISOString());
    expect(row.anchorIssueAtOpen).toBeNull();
    expect(row.freshNetPpmAtOpen).toBe(opened.anchorAtOpen?.freshNetPpm);
    expect(row.standingPpmAtOpen).toBe(opened.anchorAtOpen?.standingPpm);
    expect(row.freshNetPpmAtPeak).toBe(opened.peakAnchor?.freshNetPpm);
    expect(row.freshNetPpmAtClose).toBe(opened.lastAnchor?.freshNetPpm);
    expect(row.standingPpmAtClose).toBe(opened.lastAnchor?.standingPpm);
    expect(row.indexGapPpmAtOpen).toBeCloseTo(0, 6);
    expect(Math.round(row.carriedPpmAtOpen as number)).toBe(995); // bybit's ten basis points over its index, binance carries nothing
    expect(row.carriedPpmAtPeak).toBe(opened.peakAnchor?.carriedPpm);
    expect(row.carriedPpmAtClose).toBe(opened.lastAnchor?.carriedPpm);
    expect(row.highestBidFreshPremiumAtOpen).toBe(
      opened.anchorAtOpen?.sell.freshPremium,
    );
    expect(row.lowestAskFreshPremiumAtOpen).toBe(
      opened.anchorAtOpen?.buy.freshPremium,
    );
    expect(row.freshNetPpmSeries).toEqual(opened.freshNetPpmSeries);
    expect(row.anchorTsMs).toEqual([0]);
    expect(row.highestBidMarkSeries).toEqual([100.6]);
    expect(row.lowestAskMarkSeries).toEqual([100.5]);
  });
});
