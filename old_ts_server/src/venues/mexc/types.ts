// One level of a MEXC book, a positional array of JSON numbers. A price can arrive in exponent form, as 7.548E+4.
export type MexcBookLevel = [price: number, size: number, orderCount: number];

export type MexcDepthData = {
  bids: MexcBookLevel[]; // sizes in contracts, descending on push.depth.full
  asks: MexcBookLevel[]; // ascending on push.depth.full
  version: number; // the venue's book counter, never went backwards on push.depth.full
  cts: number; // matching engine time in ms
};

// Data, acknowledgements, pongs and errors share the socket, so nothing here is guaranteed to be present.
export type MexcStreamFrame = {
  channel?: string; // 'push.depth.full', 'rs.sub.depth.full', 'rs.error' or 'pong'
  symbol?: string; // 'BTC_USDT', set on push frames only
  data?: MexcDepthData | string | number; // the book on a push, 'success' on an acknowledgement, the error text on rs.error, ms on a pong
  ts?: number; // push time in ms
};

// One row of GET /api/v1/contract/funding_rate, every number a JSON number.
export type MexcFundingRate = {
  symbol: string; // 'BTC_USDT'
  idxPrice: number;
  fairPrice: number; // MEXC's mark
  fundingRate: number; // fraction per interval for the upcoming settlement
  maxFundingRate: number;
  minFundingRate: number;
  collectCycle: number; // hours: 1, 4, 8 or 24
  nextSettleTime: number; // Unix ms
  timestamp: number; // Unix ms, when the reply was built
};

export type MexcReply<T> = {
  success: boolean;
  code: number; // 0 on success, 510 when rate limited, 1001 for an unknown contract
  message?: string; // present on an error only
  data: T;
};
