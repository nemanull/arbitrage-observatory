export type GeminiBookLevel = [price: string, quantity: string];

export type GeminiDepthUpdate = {
  e: string; // 'depthUpdate'
  E: number; // event time in ns, above 2^53, so it parses only to about the millisecond
  s: string; // lowercase symbol, 'btcusdcperp'
  U: number; // first update id, equal to u on the snapshot
  u: number; // last update id, from one range every symbol shares
  b: GeminiBookLevel[]; // absolute levels on the snapshot, changed levels after it, unsorted inside a frame
  a: GeminiBookLevel[]; // likewise
};

// One decoded frame off the public socket.
// Depth frames carry `e`, and control replies carry `id` and `status` instead.
export type GeminiStreamFrame = Partial<GeminiDepthUpdate> & {
  id?: number | string; // echoed from the request
  status?: number; // 200 on success
  error?: { code: number; msg: string }; // code -1013 for an unknown stream name
};

// GET /v1/riskstats/<rawMarketId>, which names no symbol, so the row is keyed by the request. Every number is a decimal string.
export type GeminiRiskStats = {
  product_type: string; // 'PerpetualSwapContract'
  mark_price: string;
  index_price: string;
  open_interest: string;
  open_interest_notional: string;
};

// GET /v1/fundingamount/<rawMarketId>, where every number is a JSON number.
export type GeminiFundingAmount = {
  symbol: string; // echoes the request's case
  fundingDateTime: string; // ISO time of the last settlement
  fundingTimestampMilliSecs: number; // Unix ms of the last settlement
  nextFundingTimestamp: number; // Unix ms of the next settlement, in the past for 10 to 20 s after each hour
  fundingAmount: number; // settled at the last settlement
  estimatedFundingAmount: number; // quote currency per long base unit at the next settlement, not a rate
};
