export type PairKey = string; // "BTC|USDT". USD and USDC markets sit under the USDT key, see quoteFamily.ts

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
