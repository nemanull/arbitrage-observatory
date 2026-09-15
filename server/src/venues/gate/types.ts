export type GateBookLevel = [price: string, size: string]; // size in contracts, fractional on decimal contracts

export type GateObuResult = {
  t: number; // matching engine time in ms, up to 40 s old on a quiet book's snapshot
  full?: boolean; // true on a snapshot, absent on a delta
  s: string; // stream name: 'ob.BTC_USDT.50'
  U?: number; // first update id of a delta, absent on a snapshot
  u: number; // last update id
  b?: GateBookLevel[]; // bids, best first on a snapshot, unordered on a delta, absent on an id only delta
  a?: GateBookLevel[]; // asks, likewise
};

// One decoded frame off the futures socket.
// Books, acknowledgements, pongs and errors share the envelope, so nothing here is guaranteed to be present.
export type GateStreamFrame = {
  time?: number; // Unix seconds
  time_ms?: number;
  conn_id?: string;
  channel?: string; // 'futures.obu', 'futures.pong' or 'futures.system'
  event?: string; // 'update' on a book, 'subscribe' on an acknowledgement, '' on a pong
  payload?: string[]; // the streams an acknowledgement answers
  error?: { code: number; message?: string } | null;
  result?: (Partial<GateObuResult> & { status?: string; type?: string }) | null; // a book on 'update', { status } on an acknowledgement, null on a pong
};

// One row of GET /api/v4/futures/usdt/contracts, only the fields the anchor reads.
export type GateContract = {
  name: string; // 'BTC_USDT', which is CCXT's market.id
  status: string; // 'trading', 'prelaunch', 'delisting', 'delisted' or 'circuit_breaker'
  is_pre_market: boolean; // true on a contract with no index basket, such as OPENAI_USDT
  index_price: string; // decimal string
  mark_price: string;
  funding_rate: string; // a fraction per interval, not per 8 h
  funding_interval: number; // seconds: 28800, 14400 or 3600
  funding_next_apply: number; // Unix seconds
};
