export type BitgetBookLevel = [price: string, size: string];

// One entry of a v3 `books` frame, which always carries exactly one.
export type BitgetBooksData = {
  a: BitgetBookLevel[]; // asks ascending, the whole side on a snapshot and changed levels on an update, size '0' removes
  b: BitgetBookLevel[]; // bids descending, likewise
  seq: number; // near 10^12 on USDT-M and USDC-M, where a double is exact, and above 2^53 on the Coin-M contracts the registry filter drops
  pseq: number; // the previous frame's seq, 0 on a snapshot
  ts: string; // matching engine time in ms, as a decimal string
  maxdepth: string; // '1000', spelled in lowercase on the wire
};

// One decoded frame off the v3 public socket.
// Data, subscribe acknowledgements and errors share the socket, so nothing here is guaranteed to be present.
export type BitgetStreamFrame = {
  action?: string; // 'snapshot' or 'update' on a books frame
  arg?: { instType: string; topic: string; symbol: string }; // absent on a v3 error
  data?: BitgetBooksData[];
  ts?: number; // push time in ms
  event?: string; // 'subscribe' or 'error'
  code?: number; // 30001 for a symbol the instType does not list
  msg?: string; // names the refused argument on an error
  connId?: string;
};

export type BitgetReply<T> = {
  code: string; // '00000' on success
  msg: string;
  requestTime: number; // Unix ms
  data: T[];
};

// One row of GET /api/v2/mix/market/tickers, only the fields the anchor reads.
// Every number is a decimal string.
export type BitgetTicker = {
  symbol: string; // 'BTCUSDT', or 'BTCPERP' on USDC-M
  indexPrice: string;
  markPrice: string; // equal to the last trade on a third to a half of the contracts
  fundingRate: string; // can trail the funding call by one poll at a settlement
  ts: string; // Unix ms as a string, one stamp for the whole reply
};

// One row of GET /api/v2/mix/market/current-fund-rate.
export type BitgetFundingRate = {
  symbol: string;
  fundingRate: string; // the running rate for the upcoming settlement, as a fraction
  fundingRateInterval: string; // hours: '1', '4' or '8'
  nextUpdate: string; // Unix ms as a string
  minFundingRate: string | null;
  maxFundingRate: string | null; // null on the pre-listing and test symbols the tickers call does not list
};
