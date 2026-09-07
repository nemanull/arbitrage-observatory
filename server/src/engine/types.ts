export type PairKey = string; // "BTC|USDT". USD and USDC markets sit under the USDT key, see quoteFamily.ts
type RouteKey = string; // "bybit-binance": the venue we sell on, then the venue we buy on

export type CloseReason =
  | 'spread_collapsed' // the route's own reading fell below CLOSURE_NET_PPM
  | 'feed_down' // the socket carrying one leg closed
  | 'age_cap' // MAX_OPPORTUNITY_AGE_MS, the chunk boundary of a basis that never collapses
  | 'shutdown'; // the orchestrator stopped and flushed the route

export type Venue = {
  id: string; // 'binance',
  name: string; // 'Binance'
  markets: Market[];
};

export type Market = {
  venueId: string; // 'bybit'
  rawMarketId: string; // 'BTCUSDT': the symbol exactly as the venue's socket spells it
  base: string; // 'BTC'
  quote: string; // 'USDT', as the venue spells it. The cluster key folds USD and USDC into USDT
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

// A Cluster is a set of markets that trade the same asset on different exchanges with the same base and a dollar settlement asset.
// USD, USDC and USDT count as one asset here.
// Every array is one slot per venue, so a cluster never has to grow. readonly forbids replacing an array, not writing into one.
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

  // positions of the venues in the cluster
  highestBidVenueIndex: number;
  lowestAskVenueIndex: number;

  // open snapshot
  openedAt: number;
  netPpmAtOpen: number;
  highestBidAtOpen: number;
  lowestAskAtOpen: number;
  // The far sides and the touch sizes are kept at open, peak and last only. No series, so MAX_SERIES_LENGTH still bounds the row
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
  sampleTs: number[]; // ms since openedAt, one per sample. The four series stop at MAX_SERIES_LENGTH, the counters above do not

  closedAt: number | null;
  closeReason: CloseReason | null;
};

// One fee-adjusted reading of a single route, with the far side and the touch size of each leg.
export type Observation = {
  cluster: Cluster;
  highestBidMarket: Market;
  lowestAskMarket: Market;
  highestBidVenueIndex: number;
  lowestAskVenueIndex: number;
  highestBid: number;
  lowestAsk: number;
  highestBidSize: number; // coins you could sell at highestBid, already × sizeMul
  lowestAskSize: number; // coins you could buy at lowestAsk
  highestBidLegAsk: number; // the other side of the venue we sell on, fee adjusted like highestBid. Its distance to highestBid is that book's width
  lowestAskLegBid: number; // the other side of the venue we buy on
  netPpm: number;
  now: number;
};

export type ActiveOpportunityMap = Map<PairKey, Map<RouteKey, Opportunity>>; // <"BTC|USDT", <"bybit-binance", Opportunity>>
