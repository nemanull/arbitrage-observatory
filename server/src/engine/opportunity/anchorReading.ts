import type { Cluster, Market } from '../cluster/types';
import type { AnchorIssue, AnchorLeg, AnchorPair } from './types';

export const ANCHOR_SKEW_MS = 5_000;
export const ANCHOR_MAX_AGE_MS = 10_000;
export const MAX_ANCHOR_MOVE_PPM = 1_000; // per poll, on the index or the mark, whichever moved more, see docs/research/2026-09-14-open-guard-sizing.md

export function premium(price: number, reference: number): number {
  return price / reference - 1;
}

export function readAnchorPair(
  cluster: Cluster,
  sellIndex: number,
  buyIndex: number,
  sellMarket: Market,
  buyMarket: Market,
  netPpm: number,
  now: number,
): AnchorPair | AnchorIssue {
  const { anchor } = cluster;
  const sellWrittenAt = anchor.writtenAt[sellIndex];
  const buyWrittenAt = anchor.writtenAt[buyIndex];

  if (sellWrittenAt <= 0 || buyWrittenAt <= 0) {
    return 'anchor_missing';
  }

  if (Math.abs(sellWrittenAt - buyWrittenAt) > ANCHOR_SKEW_MS) {
    return 'anchor_skewed';
  }

  if (now - Math.min(sellWrittenAt, buyWrittenAt) > ANCHOR_MAX_AGE_MS) {
    return 'anchor_stale';
  }

  if (anchor.mark[sellIndex] <= 0 || anchor.mark[buyIndex] <= 0) {
    return 'anchor_no_mark';
  }

  // On a fast tape the fresh edge measures one anchor's lag behind the other rather than the book.
  if (
    anchor.movePpm[sellIndex] > MAX_ANCHOR_MOVE_PPM ||
    anchor.movePpm[buyIndex] > MAX_ANCHOR_MOVE_PPM
  ) {
    return 'anchor_moving';
  }

  const sell = readLeg(cluster, sellIndex, cluster.bid[sellIndex]);
  const buy = readLeg(cluster, buyIndex, cluster.ask[buyIndex]);

  const sellKeeps = 1 - sellMarket.takerPpm / 1_000_000;
  const buyPays = 1 + buyMarket.takerPpm / 1_000_000;

  const sellScale = cluster.bidMul[sellIndex] / sellKeeps;
  const buyScale = cluster.askMul[buyIndex] / buyPays;

  const indexGap = (sell.index * sellScale) / (buy.index * buyScale);
  const carried = (1 + sell.markPremium) / (1 + buy.markPremium);
  const fresh = (1 + sell.freshPremium) / (1 + buy.freshPremium);
  const freshNetPpm = ((fresh * sellKeeps) / buyPays - 1) * 1_000_000;

  return {
    sell,
    buy,
    indexGapPpm: (indexGap - 1) * 1_000_000,
    carriedPpm: (carried - 1) * 1_000_000,
    freshNetPpm,
    standingPpm: netPpm - freshNetPpm,
  };
}

function readLeg(cluster: Cluster, i: number, touch: number): AnchorLeg {
  const { anchor } = cluster;
  const index = anchor.index[i];
  const mark = anchor.mark[i];

  return {
    index,
    mark,
    touch,
    touchPremium: premium(touch, index),
    markPremium: premium(mark, index),
    freshPremium: premium(touch, mark),
    fundingRate: anchor.fundingRate[i],
    fundingIntervalHours: anchor.fundingIntervalHours[i],
    nextFundingAt: anchor.nextFundingAt[i],
    writtenAt: anchor.writtenAt[i],
  };
}
