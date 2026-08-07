


export interface Market {
  venueId: string;     // 'bybit'
  rawMarketId: string;     // 'BTCUSDT' — the symbol exactly as the venue's socket spells it
  base: string;      // 'BTC'
  settle: string;    // 'USDT'
  takerPpm: number;  // taker fee in parts per million: 550 = 0.055%
  linear: boolean;
}


// A Cluster is a set of markets that trade the same asset on different exchanges - same base, same settlement currency, so prices are comparable.
// Every array is one slot per venue, so a cluster never has to grow. readonly forbids replacing an array, not writing into one.
export type Cluster = {
  readonly pair: string;             // 'BTC|USDT'
  readonly markets: Market[];       // who occupies each slot
  readonly bidMul: Float64Array;    // 1 − taker, per slot
  readonly askMul: Float64Array;    // 1 + taker, per slot
  readonly bid: Float64Array;       // live quotes, overwritten in place
  readonly ask: Float64Array;
  readonly recvTs: Float64Array;    // 0 = never spoke, and also = venue does not list this pair
}

// "This market lives in that cluster, at position i." Built once, reused forever.
export type Slot = { cluster: Cluster; i: number }

// Never replaced. Refresh mutates these containers, so a captured reference stays correct.
export type ClusterIndex = {
  readonly clusters: Cluster[];
  readonly idBySymbol: Map<string, Map<string, Slot>>;  // venue → wire symbol → slot
  readonly slotsByVenue: Map<string, Slot[]>;           // venue → its slots (see below)
}

export type Opportunity = {
  netPpm: number;  // fee-adjusted entry edge, parts per million
  buy: Market;     // market to buy on  (lowest cost after fees)
  sell: Market;    // market to sell on (highest proceeds after fees)
}
