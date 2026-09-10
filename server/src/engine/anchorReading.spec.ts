import {
  ANCHOR_MAX_AGE_MS,
  ANCHOR_SKEW_MS,
  readAnchorPair,
} from './anchorReading';
import { createClusterAnchor, createClusterDepth } from './ClusterIndexBuilder';
import type { AnchorPair, Cluster, Market } from './types';

const SELL = 0;
const BUY = 1;
const NOW = 100_000;

function market(venueId: string, takerPpm: number): Market {
  return {
    venueId,
    rawMarketId: 'BTCUSDT',
    base: 'BTC',
    quote: 'USDT',
    takerPpm,
    linear: true,
    contractSize: 1,
  };
}

const sellMarket = market('bybit', 550);
const buyMarket = market('binance', 500);

// Two slots, the sell venue first. The multipliers are unused by the reading and left at one.
function makeCluster(sellBid: number, buyAsk: number): Cluster {
  const width = 2;
  const cluster: Cluster = {
    pair: 'BTC|USDT',
    markets: [sellMarket, buyMarket],
    bidMul: new Float64Array(width).fill(1),
    askMul: new Float64Array(width).fill(1),
    sizeMul: new Float64Array(width).fill(1),
    bid: new Float64Array(width),
    ask: new Float64Array(width),
    bidSize: new Float64Array(width),
    askSize: new Float64Array(width),
    recvTs: new Float64Array(width).fill(NOW),
    depth: createClusterDepth(width, 2),
    anchor: createClusterAnchor(width),
  };
  cluster.bid[SELL] = sellBid;
  cluster.ask[BUY] = buyAsk;
  return cluster;
}

function writeAnchor(
  cluster: Cluster,
  i: number,
  index: number,
  mark: number,
  writtenAt = NOW - 200,
) {
  cluster.anchor.index[i] = index;
  cluster.anchor.mark[i] = mark;
  cluster.anchor.fundingRate[i] = 0.0001;
  cluster.anchor.fundingIntervalHours[i] = 8;
  cluster.anchor.nextFundingAt[i] = NOW + 3_600_000;
  cluster.anchor.writtenAt[i] = writtenAt;
}

// The engine's own reading of the same two touches after fees.
function netPpm(sellBid: number, buyAsk: number): number {
  return ((sellBid * 0.99945) / (buyAsk * 1.0005) - 1) * 1_000_000;
}

function read(cluster: Cluster, net: number, now = NOW) {
  return readAnchorPair(cluster, SELL, BUY, sellMarket, buyMarket, net, now);
}

describe('readAnchorPair freshness', () => {
  it('reports a leg that was never written', () => {
    const cluster = makeCluster(101, 100);
    writeAnchor(cluster, SELL, 100.5, 100.5);

    expect(read(cluster, netPpm(101, 100))).toBe('anchor_missing');
  });

  it('reports two legs further apart than the skew allows', () => {
    const cluster = makeCluster(101, 100);
    writeAnchor(cluster, SELL, 100.5, 100.5, NOW - 100);
    writeAnchor(cluster, BUY, 100.5, 100.5, NOW - 100 - ANCHOR_SKEW_MS - 1);

    expect(read(cluster, netPpm(101, 100))).toBe('anchor_skewed');
  });

  it('accepts two legs exactly at the skew', () => {
    const cluster = makeCluster(101, 100);
    writeAnchor(cluster, SELL, 100.5, 100.5, NOW - 100);
    writeAnchor(cluster, BUY, 100.5, 100.5, NOW - 100 - ANCHOR_SKEW_MS);

    expect(typeof read(cluster, netPpm(101, 100))).toBe('object');
  });

  it('reports a pair older than the age limit', () => {
    const cluster = makeCluster(101, 100);
    const writtenAt = NOW - ANCHOR_MAX_AGE_MS - 1;
    writeAnchor(cluster, SELL, 100.5, 100.5, writtenAt);
    writeAnchor(cluster, BUY, 100.5, 100.5, writtenAt);

    expect(read(cluster, netPpm(101, 100))).toBe('anchor_stale');
  });
});

describe('readAnchorPair fresh edge', () => {
  it('equals the net edge when the two anchors agree', () => {
    const cluster = makeCluster(101, 100);
    writeAnchor(cluster, SELL, 100.5, 100.5);
    writeAnchor(cluster, BUY, 100.5, 100.5);
    const net = netPpm(101, 100);

    const pair = read(cluster, net) as AnchorPair;

    expect(pair.freshNetPpm).toBeCloseTo(net, 6);
    expect(pair.standingPpm).toBeCloseTo(0, 6);
    expect(pair.sell.premium).toBe(0);
    expect(pair.buy.premium).toBe(0);
  });

  it('removes the part of the cross the anchors explain', () => {
    const cluster = makeCluster(101, 100);
    writeAnchor(cluster, SELL, 101, 101); // the sell venue holds its perp one percent over the buy venue's
    writeAnchor(cluster, BUY, 100, 100);
    const net = netPpm(101, 100);

    const pair = read(cluster, net) as AnchorPair;

    // Both books sit exactly on their anchors, so nothing is fresh and the fees are all that is left.
    expect(pair.freshNetPpm).toBeCloseTo(netPpm(1, 1), 6);
    expect(pair.standingPpm).toBeCloseTo(net - netPpm(1, 1), 6);
  });

  it('reads the standing part from the mark and not the index', () => {
    const cluster = makeCluster(101, 100);
    writeAnchor(cluster, SELL, 100, 101); // index agrees with the buy venue, the mark carries a one percent premium
    writeAnchor(cluster, BUY, 100, 100);

    const pair = read(cluster, netPpm(101, 100)) as AnchorPair;

    expect(pair.sell.premium).toBeCloseTo(0.01, 12);
    expect(pair.freshNetPpm).toBeCloseTo(netPpm(1, 1), 6);
  });

  it('falls back to the index for a venue that publishes no mark', () => {
    const cluster = makeCluster(101, 100);
    writeAnchor(cluster, SELL, 100.5, 100.5);
    writeAnchor(cluster, BUY, 100.5, 0);
    const net = netPpm(101, 100);

    const pair = read(cluster, net) as AnchorPair;

    expect(pair.buy.premium).toBeNull();
    expect(pair.buy.mark).toBe(0);
    expect(pair.freshNetPpm).toBeCloseTo(net, 6);
  });

  it('cancels a venue price scale by dividing each book by its own anchor', () => {
    const cluster = makeCluster(1010, 100); // the sell venue quotes ten times the buy venue's unit
    writeAnchor(cluster, SELL, 1005, 1005);
    writeAnchor(cluster, BUY, 100.5, 100.5);

    const pair = read(cluster, netPpm(101, 100)) as AnchorPair;

    expect(pair.freshNetPpm).toBeCloseTo(netPpm(101, 100), 6);
  });

  it('copies funding onto both legs', () => {
    const cluster = makeCluster(101, 100);
    writeAnchor(cluster, SELL, 100.5, 100.5, NOW - 50);
    writeAnchor(cluster, BUY, 100.5, 100.5, NOW - 150);
    cluster.anchor.fundingRate[SELL] = -0.0038;
    cluster.anchor.fundingIntervalHours[SELL] = 4;

    const pair = read(cluster, netPpm(101, 100)) as AnchorPair;

    expect(pair.sell.fundingRate).toBe(-0.0038);
    expect(pair.sell.fundingIntervalHours).toBe(4);
    expect(pair.sell.writtenAt).toBe(NOW - 50);
    expect(pair.buy.fundingRate).toBe(0.0001);
    expect(pair.buy.writtenAt).toBe(NOW - 150);
  });
});
