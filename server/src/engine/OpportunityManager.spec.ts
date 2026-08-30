import { OpportunityManager } from './OpportunityManager';
import { OPPORTUNITY_CLOSED_JOB } from './OpportunityWorker';
import type { ActiveOpportunityMap, Cluster, Market } from './types';
import { createOpportunityQueueMock } from '../../test/fixtures/opportunity-queue';

const TAKER_PPM = 550;

function market(venueId: string): Market {
  return {
    venueId,
    rawMarketId: 'BTCUSDT',
    base: 'BTC',
    quote: 'USDT',
    takerPpm: TAKER_PPM,
    linear: true,
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

  markets.forEach((m, i) => {
    bidMul[i] = 1 - m.takerPpm / 1_000_000;
    askMul[i] = 1 + m.takerPpm / 1_000_000;
  });

  return {
    pair: 'BTC|USDT',
    markets,
    bidMul,
    askMul,
    bid: new Float64Array(width),
    ask: new Float64Array(width),
    recvTs: new Float64Array(width),
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
) {
  cluster.bid[index] = bid;
  cluster.ask[index] = ask;
  cluster.recvTs[index] = now;

  return manager.validate(cluster, index, now);
}

function activeMap(manager: OpportunityManager): ActiveOpportunityMap {
  return Reflect.get(manager, 'activeOpportunityMap') as ActiveOpportunityMap;
}

function routes(manager: OpportunityManager) {
  return activeMap(manager).get('BTC|USDT');
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
    expect(stillOpen?.sampleTs).toEqual([0, 1_000]);
  });

  it('closes an open route once it falls below CLOSE_NET_PPM', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const opened = openOn(manager, cluster, 1_000)!;

    tick(manager, cluster, BYBIT, 100.1, 101.5, 2_000); // ~-100ppm

    expect(routes(manager)!.has('bybit-binance')).toBe(false);
    expect(opened.closedAt).toBe(2_000);
    // the collapsing tick is recorded before the close, so the series ends on it
    expect(opened.netPpmSeries).toHaveLength(2);
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
    expect([...routes(manager)!.keys()]).toEqual(['bybit-okx']);
  });
});

describe('OpportunityManager staleness', () => {
  it('closes a route whose older leg has gone quiet', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const opened = openOn(manager, cluster, 1_000)!;

    // binance keeps printing, bybit does not
    tick(manager, cluster, BINANCE, 99.9, 100, 40_000);

    expect(opened.closedAt).toBe(40_000);
    expect(routes(manager)!.size).toBe(0);
  });

  it('sweeps open routes that no tick can reach', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    const opened = openOn(manager, cluster, 1_000)!;

    expect(manager.sweep(2_000)).toEqual([]);
    expect(opened.closedAt).toBeNull();

    const closed = manager.sweep(40_000);

    expect(closed).toEqual([opened]);
    expect(opened.closedAt).toBe(40_000);
    expect(activeMap(manager).has('BTC|USDT')).toBe(false);
  });

  it('closes every route touching a dead venue', () => {
    const manager = new OpportunityManager(createOpportunityQueueMock());
    const cluster = makeCluster();

    openOn(manager, cluster, 1_000);
    tick(manager, cluster, OKX, 99.4, 99.5, 2_000);
    tick(manager, cluster, BYBIT, 101, 101.5, 2_000);
    tick(manager, cluster, BINANCE, 99.9, 100, 2_000);

    expect(routes(manager)!.size).toBe(2);

    const closed = manager.closeVenue('bybit', 3_000);

    expect(closed).toHaveLength(2); // bybit is the sell leg of both
    expect(activeMap(manager).has('BTC|USDT')).toBe(false);
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
    expect(first.netPpmSeries).toEqual([8_000, 9_000]);
    expect(first.sampleTs).toEqual([0, 500]);
    expect(routes(manager)!.size).toBe(1);
  });
});

describe('OpportunityManager persistence', () => {
  it('enqueues the closed opportunity', () => {
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
        }),
      ],
    });
  });
});
