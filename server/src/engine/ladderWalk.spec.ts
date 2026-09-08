import { createClusterDepth } from './ClusterIndexBuilder';
import { walkLadders } from './ladderWalk';
import type { BookLevel, Cluster, Market } from './types';

const LEVELS = 5;
const BUY = 0; // binance, we buy its asks
const SELL = 1; // bybit, we sell into its bids

function market(venueId: string, takerPpm: number, contractSize = 1): Market {
  return {
    venueId,
    rawMarketId: 'BTCUSDT',
    base: 'BTC',
    quote: 'USDT',
    takerPpm,
    linear: true,
    contractSize,
  };
}

// Fees default to zero so the arithmetic in the examples can be checked by hand.
function makeCluster(
  takerPpm = 0,
  contractSizes: [number, number] = [1, 1],
): Cluster {
  const markets = [
    market('binance', takerPpm, contractSizes[0]),
    market('bybit', takerPpm, contractSizes[1]),
  ];
  const width = markets.length;

  return {
    pair: 'BTC|USDT',
    markets,
    bidMul: Float64Array.from(markets, (m) => 1 - m.takerPpm / 1_000_000),
    askMul: Float64Array.from(markets, (m) => 1 + m.takerPpm / 1_000_000),
    sizeMul: Float64Array.from(markets, (m) => m.contractSize),
    bid: new Float64Array(width),
    ask: new Float64Array(width),
    bidSize: new Float64Array(width),
    askSize: new Float64Array(width),
    recvTs: new Float64Array(width),
    depth: createClusterDepth(width, LEVELS),
  };
}

function setAsks(cluster: Cluster, slot: number, levels: BookLevel[]): void {
  const base = slot * LEVELS;
  levels.forEach(([price, size], l) => {
    cluster.depth.askPrice[base + l] = price;
    cluster.depth.askSize[base + l] = size;
  });
  cluster.depth.askLevelCount[slot] = levels.length;
}

function setBids(cluster: Cluster, slot: number, levels: BookLevel[]): void {
  const base = slot * LEVELS;
  levels.forEach(([price, size], l) => {
    cluster.depth.bidPrice[base + l] = price;
    cluster.depth.bidSize[base + l] = size;
  });
  cluster.depth.bidLevelCount[slot] = levels.length;
}

describe('walkLadders', () => {
  it('walks both ladders from the touch and stops where the marginal edge turns negative', () => {
    const cluster = makeCluster();
    setAsks(cluster, BUY, [
      [100.05, 2],
      [100.1, 4],
      [100.2, 5],
      [100.35, 3],
    ]);
    setBids(cluster, SELL, [
      [100.6, 1],
      [100.55, 3],
      [100.3, 6],
      [100.1, 2],
    ]);

    const edge = walkLadders(cluster, BUY, SELL)!;

    // Ten coins cross: 2 at 100.05, 4 at 100.10 and 4 of the 5 at 100.20 against 1 at 100.60, 3 at 100.55 and 6 at 100.30.
    // The fifth coin at 100.20 would sell at 100.10, so the walk stops there with a level left on each side.
    expect(edge.size).toBeCloseTo(10, 9);
    expect(edge.notional).toBeCloseTo(1_001.3, 6);
    expect(edge.avgPpm).toBeCloseTo((1_004.05 / 1_001.3 - 1) * 1_000_000, 3);
    expect(edge.exhausted).toBe(false);
    expect(edge.buyLevels).toBe(3);
    expect(edge.sellLevels).toBe(3);
  });

  it('reports a region bounded by the held depth as exhausted', () => {
    const cluster = makeCluster();
    setAsks(cluster, BUY, [[100, 1]]);
    setBids(cluster, SELL, [
      [101, 5],
      [100.9, 5],
    ]);

    const edge = walkLadders(cluster, BUY, SELL)!;

    expect(edge.size).toBe(1);
    expect(edge.exhausted).toBe(true);
    expect(edge.buyLevels).toBe(1);
    expect(edge.sellLevels).toBe(1);
  });

  it('returns null when a leg holds no depth at all', () => {
    const cluster = makeCluster();
    setAsks(cluster, BUY, [[100, 1]]);

    expect(walkLadders(cluster, BUY, SELL)).toBeNull();

    setBids(cluster, SELL, [[101, 1]]);
    cluster.depth.askLevelCount[BUY] = 0;

    expect(walkLadders(cluster, BUY, SELL)).toBeNull();
  });

  it('returns an empty region when the tops do not cross', () => {
    const cluster = makeCluster();
    setAsks(cluster, BUY, [[100, 1]]);
    setBids(cluster, SELL, [[99.9, 1]]);

    const edge = walkLadders(cluster, BUY, SELL)!;

    expect(edge.size).toBe(0);
    expect(edge.avgPpm).toBe(0);
    expect(edge.notional).toBe(0);
    expect(edge.exhausted).toBe(false);
  });

  it('applies the taker fee to both legs, which can end the region early', () => {
    // Without fees the whole ladder crosses. With 55 bp each side the second level pair no longer does.
    const cluster = makeCluster(5_500);
    setAsks(cluster, BUY, [
      [100, 1],
      [100.5, 1],
    ]);
    setBids(cluster, SELL, [
      [102, 1],
      [101.5, 1],
    ]);

    const edge = walkLadders(cluster, BUY, SELL)!;

    expect(edge.size).toBe(1);
    expect(edge.notional).toBeCloseTo(100.55, 9);
    expect(edge.avgPpm).toBeCloseTo(
      ((102 * 0.9945) / (100 * 1.0055) - 1) * 1_000_000,
      6,
    );
    expect(edge.exhausted).toBe(false);
  });

  it('brings contract sizes to coins through sizeMul before matching quantities', () => {
    // The buy venue counts contracts of a hundredth of a coin, so 300 contracts is 3 coins.
    const cluster = makeCluster(0, [0.01, 1]);
    setAsks(cluster, BUY, [[100, 300]]);
    setBids(cluster, SELL, [[101, 5]]);

    const edge = walkLadders(cluster, BUY, SELL)!;

    expect(edge.size).toBeCloseTo(3, 9);
    expect(edge.notional).toBeCloseTo(300, 9);
    expect(edge.exhausted).toBe(true);
  });

  it('passes over a zero size level without counting it', () => {
    const cluster = makeCluster();
    setAsks(cluster, BUY, [
      [100, 0],
      [100.1, 2],
    ]);
    setBids(cluster, SELL, [[101, 2]]);

    const edge = walkLadders(cluster, BUY, SELL)!;

    expect(edge.size).toBe(2);
    expect(edge.notional).toBeCloseTo(200.2, 9);
    expect(edge.buyLevels).toBe(1);
  });
});
