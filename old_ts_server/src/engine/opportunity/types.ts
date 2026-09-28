import type { Cluster, Market, PairKey } from '../cluster/types';

type RouteKey = string; // "bybit-binance": the venue we sell on, then the venue we buy on

export type CloseReason =
  | 'spread_collapsed' // fell below CLOSURE_NET_PPM
  | 'fresh_edge_collapsed' // the fresh edge fell below CLOSURE_NET_PPM while the raw cross still cleared it
  | 'feed_down' // the socket carrying one leg closed
  | 'age_cap' // MAX_OPPORTUNITY_AGE_MS
  | 'shutdown';

// One leg's anchor as read at open, see anchorReading.ts. Prices are raw venue prices, premiums are fractions: 0.01 = one percent above.
export type AnchorLeg = {
  index: number;
  mark: number; // a route opens only on a positive mark
  touch: number; // the price at the top of the book that your trade would actually hit on that leg
  touchPremium: number; // touch over index minus one, what the book says
  markPremium: number; // mark over index minus one, what the venue has accepted
  freshPremium: number; // touch over mark minus one, what the book says that the venue has not absorbed
  fundingRate: number;
  fundingIntervalHours: number;
  nextFundingAt: number;
  writtenAt: number;
};

// The cross factors into three parts, docs/bestiary/index-mark-and-premium.md. In fractions, 1 + netPpm = (1 + indexGapPpm) × (1 + carriedPpm) × (1 + freshNetPpm).
export type AnchorPair = {
  sell: AnchorLeg; // the venue of the highest bid
  buy: AnchorLeg; // the venue of the lowest ask
  indexGapPpm: number; // sell index over buy index minus one, after the venue price scales: the structural part, which funding never closes
  carriedPpm: number; // the accepted premiums' gap, the part funding is pricing and closes over hours
  freshNetPpm: number; // the net edge after fees once each book is divided by its own anchor, the part a taker cross can capture
  standingPpm: number; // netPpm minus freshNetPpm, the part the two anchors already explain
};

// Why readAnchorPair could not judge a route, which refuses it, see anchorReading.ts.
// A refused route writes no row, so the AnchorIssue enum in schema.prisma keeps only the three that could open a route unjudged before 2026-09-14.
export type AnchorIssue =
  | 'anchor_missing'
  | 'anchor_stale'
  | 'anchor_skewed'
  | 'anchor_no_mark'
  | 'anchor_moving';

export type EdgeSample = {
  avgPpm: number; // average edge over the whole region after fees. 0 when the region is empty
  size: number; // coins in the region, the same quantity bought and sold
  notional: number; // what buying the region costs after fees, in the quote asset
  exhausted: boolean; // the region ended because a book ran out of held levels, so size and notional are lower bounds
  buyLevels: number; // ask levels the region reaches into on the buy venue
  sellLevels: number; // bid levels on the sell venue
};

// netPpm, highestBid, lowestAsk are all after fee adjustments. An output of a runtime validation
export type Opportunity = {
  highestBidMarket: Market;
  lowestAskMarket: Market;

  highestBidVenueIndex: number;
  lowestAskVenueIndex: number;

  // open snapshot
  openedAt: number;
  netPpmAtOpen: number;
  highestBidAtOpen: number;
  lowestAskAtOpen: number;

  highestBidSizeAtOpen: number;
  lowestAskSizeAtOpen: number;
  highestBidLegAskAtOpen: number;
  lowestAskLegBidAtOpen: number;

  // O(1), every tick, never sampled away
  ticksSinceStart: number;
  netPpmSum: number;
  peakNetPpm: number;
  peakAt: number;
  peakHighestBid: number;
  peakLowestAsk: number;
  peakHighestBidSize: number;
  peakLowestAskSize: number;
  peakHighestBidLegAsk: number;
  peakLowestAskLegBid: number;
  minNetPpm: number;
  lastSeenAt: number;
  lastNetPpm: number;
  lastHighestBidSize: number;
  lastLowestAskSize: number;
  lastHighestBidLegAsk: number;
  lastLowestAskLegBid: number;

  netPpmSeries: number[];
  highestBidSeries: number[];
  lowestAskSeries: number[];
  sampleTs: number[]; // ms since openedAt, one per sample
  edgeAvgPpmSeries: number[]; // the walk per sample, aligned with sampleTs, -1 where a leg held no depth
  edgeNotionalSeries: number[];

  anchorAtOpen: AnchorPair; // a route opens only on readable anchors
  peakAnchor: AnchorPair | null; // the anchors at the sample where netPpm peaked
  lastAnchor: AnchorPair | null;
  freshNetPpmSeries: number[]; // aligned with sampleTs, NO_ANCHOR where no anchor could be read at that sample
  anchorTsMs: number[]; // ms since openedAt, one entry whenever either leg's index or mark changed, not capped since anchors change at most once a second
  highestBidIndexSeries: number[]; // aligned with anchorTsMs, raw venue prices
  highestBidMarkSeries: number[];
  lowestAskIndexSeries: number[];
  lowestAskMarkSeries: number[];

  edgeAtOpen: EdgeSample | null;
  peakEdge: EdgeSample | null;
  peakEdgeAt: number;
  maxEdgeNotional: number; // the largest region seen on any sample, in the quote asset
  lastEdge: EdgeSample | null;
  edgeSamples: number; // samples where both legs held depth

  closedAt: number | null;
  closeReason: CloseReason | null;
};

export type Observation = {
  cluster: Cluster;
  highestBidMarket: Market;
  lowestAskMarket: Market;
  highestBidVenueIndex: number;
  lowestAskVenueIndex: number;
  highestBid: number;
  lowestAsk: number;
  highestBidSize: number; // coins we could sell at highestBid, already × sizeMul
  lowestAskSize: number; // coins we could buy at lowestAsk
  highestBidLegAsk: number; // the other side of the venue we sell on, fee adjusted like highestBid. Its distance to highestBid is that book's width
  lowestAskLegBid: number; // the other side of the venue we buy on
  netPpm: number;
  anchor: AnchorPair;
  now: number;
};

export type ActiveOpportunityMap = Map<PairKey, Map<RouteKey, Opportunity>>; // <"BTC|USDT", <"bybit-binance", Opportunity>>
