import type {
  AnchorIssue,
  AnchorLeg,
  AnchorPair,
  Cluster,
  Market,
} from './types';

export const ANCHOR_SKEW_MS = 2_500;
export const ANCHOR_MAX_AGE_MS = 10_000;

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

  const sell = readLeg(cluster, sellIndex);
  const buy = readLeg(cluster, buyIndex);

  const deflatedBid = cluster.bid[sellIndex] / anchorPrice(sell);
  const deflatedAsk = cluster.ask[buyIndex] / anchorPrice(buy);
  const sellKeeps = 1 - sellMarket.takerPpm / 1_000_000;
  const buyPays = 1 + buyMarket.takerPpm / 1_000_000;
  const freshNetPpm =
    ((deflatedBid * sellKeeps) / (deflatedAsk * buyPays) - 1) * 1_000_000;

  return {
    sell,
    buy,
    freshNetPpm,
    standingPpm: netPpm - freshNetPpm,
  };
}

function readLeg(cluster: Cluster, i: number): AnchorLeg {
  const { anchor } = cluster;
  const index = anchor.index[i];
  const mark = anchor.mark[i];

  return {
    index,
    mark,
    premium: mark > 0 ? mark / index - 1 : null,
    fundingRate: anchor.fundingRate[i],
    fundingIntervalHours: anchor.fundingIntervalHours[i],
    nextFundingAt: anchor.nextFundingAt[i],
    writtenAt: anchor.writtenAt[i],
  };
}

function anchorPrice(leg: AnchorLeg): number {
  return leg.mark > 0 ? leg.mark : leg.index;
}
