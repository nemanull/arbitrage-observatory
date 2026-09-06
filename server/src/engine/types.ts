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
};

// A Cluster is a set of markets that trade the same asset on different exchanges with the same base and a dollar settlement asset.
// USD, USDC and USDT count as one asset here.
// Every array is one slot per venue, so a cluster never has to grow. readonly forbids replacing an array, not writing into one.
export type Cluster = {
  readonly pair: PairKey; // 'BTC|USDT'
  readonly markets: (Market | null)[];
  readonly bidMul: Float64Array; // Bid multiplier: 1 - taker fee
  readonly askMul: Float64Array; // Ask multiplier: 1 + taker fee
  readonly bid: Float64Array;
  readonly ask: Float64Array;
  readonly recvTs: Float64Array; // Unix ms. 0 = never spoke, venue does not list this pair, or its socket is down (Engine.markStale)
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

  // O(1), every tick, never sampled away
  ticksSinceStart: number;
  netPpmSum: number;
  peakNetPpm: number;
  peakAt: number;
  peakHighestBid: number;
  peakLowestAsk: number;
  minNetPpm: number;
  lastSeenAt: number;
  lastNetPpm: number;

  netPpmSeries: number[];
  highestBidSeries: number[];
  lowestAskSeries: number[];
  sampleTs: number[]; // ms since openedAt, one per sample. The four series stop at MAX_SERIES_LENGTH, the counters above do not

  closedAt: number | null;
  closeReason: CloseReason | null;
};

// One fee-adjusted reading of a single route.
export type Observation = {
  cluster: Cluster;
  highestBidMarket: Market;
  lowestAskMarket: Market;
  highestBidVenueIndex: number;
  lowestAskVenueIndex: number;
  highestBid: number;
  lowestAsk: number;
  netPpm: number;
  now: number;
};

export type ActiveOpportunityMap = Map<PairKey, Map<RouteKey, Opportunity>>; // <"BTC|USDT", <"bybit-binance", Opportunity>>
