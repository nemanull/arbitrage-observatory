export type PairKey = string; // "BTC|USDT". USD and USDC markets sit under the USDT key, see quoteFamily.ts
type RouteKey = string; // "bybit-binance": the venue we sell on, then the venue we buy on

export type CloseReason =
  | 'spread_collapsed' // fell below CLOSURE_NET_PPM
  | 'feed_down' // the socket carrying one leg closed
  | 'age_cap' // MAX_OPPORTUNITY_AGE_MS
  | 'shutdown';

export type Venue = {
  id: string; // 'binance',
  name: string; // 'Binance'
  markets: Market[];
};

export type Market = {
  venueId: string; // 'bybit'
  rawMarketId: string; // 'BTCUSDT': the symbol exactly as the venue's socket spells it
  base: string; // 'BTC'
  quote: string; // 'USDT'
  takerPpm: number; // taker fee in parts per million: 550 = 0.055%
  linear: boolean;
  contractSize: number;
};

export type BookLevel = [price: number, size: number];

export type ClusterDepth = {
  readonly maxLevels: number; // default at 20
  readonly bidPrice: Float64Array; // width × maxLevels, descending inside a slot
  readonly bidSize: Float64Array; // raw contracts
  readonly askPrice: Float64Array; // ascending inside a slot
  readonly askSize: Float64Array;
  readonly bidLevelCount: Uint8Array; // filled entries per slot, 0 = nothing held
  readonly askLevelCount: Uint8Array;
  readonly writtenAt: Float64Array; // Unix ms per slot, 0 = never. A reader refuses depth older than the episode it judges
};

export type ClusterAnchor = {
  readonly index: Float64Array; // the venue's index price, 0 = never read
  readonly mark: Float64Array; // 0 = the venue publishes none (coinbase)
  readonly fundingRate: Float64Array; // the rate for the upcoming settlement, as a fraction: -0.0038 = shorts pay longs 0.38%
  readonly fundingIntervalHours: Float64Array; // 1, 4 or 8
  readonly nextFundingAt: Float64Array; // Unix ms, 0 = unknown
  readonly writtenAt: Float64Array; // Unix ms per slot, 0 = never. A reader refuses two legs further apart than anchorReading.ts allows
};

export type AnchorReading = {
  index: number;
  mark: number;
  fundingRate: number;
  fundingIntervalHours: number;
  nextFundingAt: number;
  ts: number; // Unix ms when the venue published it, or when the poll returned
};

// One leg's anchor as read at open, see anchorReading.ts
export type AnchorLeg = {
  index: number;
  mark: number; // 0 = the venue publishes none
  premium: number | null; // mark over index minus one, null without a mark
  fundingRate: number;
  fundingIntervalHours: number;
  nextFundingAt: number;
  writtenAt: number;
};

export type AnchorPair = {
  sell: AnchorLeg; // the venue of the highest bid
  buy: AnchorLeg; // the venue of the lowest ask
  freshNetPpm: number; // the net edge after fees once each book is divided by its own anchor, the part a taker cross can capture
  standingPpm: number; // netPpm minus freshNetPpm, the part the two anchors already explain
};

export type AnchorIssue = 'anchor_missing' | 'anchor_stale' | 'anchor_skewed'; // why a route has no AnchorPair, see anchorReading.ts

export type EdgeSample = {
  avgPpm: number; // average edge over the whole region after fees. 0 when the region is empty
  size: number; // coins in the region, the same quantity bought and sold
  notional: number; // what buying the region costs after fees, in the quote asset
  exhausted: boolean; // the region ended because a book ran out of held levels, so size and notional are lower bounds
  buyLevels: number; // ask levels the region reaches into on the buy venue
  sellLevels: number; // bid levels on the sell venue
};

export type Cluster = {
  readonly pair: PairKey; // 'BTC|USDT'
  readonly markets: (Market | null)[];
  readonly bidMul: Float64Array; // Bid multiplier: (1 - taker fee) × price scale, applied when a reading is taken, never at write
  readonly askMul: Float64Array; // Ask multiplier: (1 + taker fee) × price scale
  readonly sizeMul: Float64Array; // contractSize / price scale, so price × size keeps the raw notional on a scaled market
  readonly bid: Float64Array; // raw, as the venue quotes it
  readonly ask: Float64Array;
  readonly bidSize: Float64Array; // raw contracts resting at the bid. Written on every message, but a size-only change is not a tick
  readonly askSize: Float64Array;
  readonly recvTs: Float64Array; // Unix ms. 0 = never spoke, venue does not list this pair, or its socket is down (Engine.markStale)
  readonly depth: ClusterDepth;
  readonly anchor: ClusterAnchor; // written by a poller, not by the book socket, so markStale leaves it alone
};

export type ClusterIndex = {
  clusters: Cluster[];
  clusterByRawMarketId: ClusterByRawMarketId;
  venueIndexMap: VenueIndexMap;
};

export type ClusterByRawMarketId = Map<string, Map<string, Cluster>>; // <binance, <BTCUSDT, Cluster>> We use it to understand which cluster a market belongs to
export type VenueIndexMap = Map<string, number>; // <"binance", 0> index

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

  anchorAtOpen: AnchorPair | null; // null when a leg's anchor was missing, stale or skewed, so the route opened unjudged
  anchorIssueAtOpen: AnchorIssue | null; // why anchorAtOpen is null
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
  anchor: AnchorPair | null;
  anchorIssue: AnchorIssue | null;
  now: number;
};

export type ActiveOpportunityMap = Map<PairKey, Map<RouteKey, Opportunity>>; // <"BTC|USDT", <"bybit-binance", Opportunity>>
