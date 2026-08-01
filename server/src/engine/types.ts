


export interface Market {
  venueId: string;     // 'bybit'
  rawMarketId: string;     // 'BTCUSDT' — the symbol exactly as the venue's socket spells it
  base: string;      // 'BTC'
  settle: string;    // 'USDT'
  takerPpm: number;  // taker fee in parts per million: 550 = 0.055%
  linear: boolean;
}


// A Cluster is a set of markets that trade the same asset on different exchanges - same base, same settlement currency, so prices are comparable.
export type Cluster = {
  pair: string;             // 'BTC|USDT'
  markets: Market[];       // who occupies each slot
  bidMul: Float64Array;    // 1 − taker, per slot
  askMul: Float64Array;    // 1 + taker, per slot
  bid: Float64Array;       // live quotes, overwritten in place
  ask: Float64Array;
  recvTs: Float64Array;    // 0 = never spoke → excluded from the scan
}

// "This market lives in that cluster, at position i." Built once, reused forever.
export type Slot = { cluster: Cluster; i: number }

export type ClusterIndex = {
  clusters: Cluster[];
  idBySymbol: Map<string, Map<string, Slot>>;  // venue → wire symbol → slot
  slotsByVenue: Map<string, Slot[]>;           // venue → its slots (see below)
}

export type Opportunity = {
  netPpm: number;  // fee-adjusted entry edge, parts per million
  buy: Market;     // market to buy on  (lowest cost after fees)
  sell: Market;    // market to sell on (highest proceeds after fees)
}

