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
}

// A Cluster is a set of markets that trade the same asset on different exchanges with the same base and settlement currency.
// Every array is one slot per venue, so a cluster never has to grow. readonly forbids replacing an array, not writing into one.
export type Cluster = {
  readonly pair: string; // 'BTC|USDT'
  readonly markets: (Market | null)[]; // who occupies each slot
  readonly bidMul: Float64Array; // Bid multiplier: 1 - taker fee
  readonly askMul: Float64Array; // Ask multiplier: 1 + taker fee
  readonly bid: Float64Array; 
  readonly ask: Float64Array;
  readonly recvTs: Float64Array; // 0 = never spoke, and also = venue does not list this pair. Unix timestamp in milliseconds
};

export type ClusterIndex = {
  clusters: Cluster[];
  clusterByRawMarketId: ClusterByRawMarketId;
  venueIndexMap: VenueIndexMap;
};

export type ClusterByRawMarketId = Map<string, Map<string, Cluster>>; // <binance, <BTCUSDT, Cluster>> We use it to understand which cluster a market belongs to 
export type VenueIndexMap = Map<string, number>; // <"binance", 0> index 


export type Opportunity = {
  netPpm: number;
  highestBid: number;
  lowestAsk: number;
  highestBidMarket: Market; 
  lowestAskMarket: Market; 
};
