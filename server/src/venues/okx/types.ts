// One level of an OKX book, which is a positional array rather than an object.
export type OkxBookLevel = [
  price: string,
  size: string,
  deprecated: string,
  orderCount: string,
];

export type OkxBooksData = {
  asks: OkxBookLevel[];
  bids: OkxBookLevel[];
  ts: string; // venue send time in milliseconds, as a decimal string
  checksum: number; // retired 2026-06-23, always 0
  prevSeqId: number; // -1 on a snapshot, otherwise the seqId of the message this one follows
  seqId: number;
};

// One decoded frame off the public socket.
// Data, subscribe acknowledgements, errors, and notices all share the socket, so nothing here is guaranteed to be present.
export type OkxStreamFrame = {
  arg?: { channel: string; instId: string };
  action?: string; // 'snapshot' or 'update' on a books frame
  data?: OkxBooksData[];
  event?: string; // 'subscribe', 'error', or 'notice'
  code?: string;
  msg?: string;
  connId?: string;
  id?: string; // echoed back from the request that caused this frame
};

export type OkxReply<T> = {
  code: string; // '0' on success
  msg: string;
  data: T[];
};

// One row of GET /api/v5/public/funding-rate?instId=ANY, which also lists the tradfi instruments that are not swaps.
export type OkxFundingRate = {
  instId: string; // 'BTC-USDT-SWAP'
  instType: string;
  fundingRate: string; // the rate for the settlement at fundingTime, as a fraction
  fundingTime: string; // Unix ms as a string, the upcoming settlement
  nextFundingRate: string; // '' outside the last part of the interval
  nextFundingTime: string; // Unix ms as a string, the settlement after fundingTime
  premium: string;
  settFundingRate: string; // the rate the last settlement charged
  ts: string; // Unix ms as a string, when the venue last recomputed this row
};

export type OkxMarkPrice = {
  instId: string;
  instType: string;
  markPx: string;
  ts: string;
};

// One row of GET /api/v5/market/index-tickers, keyed by the index id rather than the instrument id.
export type OkxIndexTicker = {
  instId: string; // 'BTC-USDT'
  idxPx: string;
  ts: string;
};

export type OkxInstrument = {
  instId: string; // 'BTC-USDT-SWAP'
  uly: string; // 'BTC-USDT', the index the swap settles against
  settleCcy: string;
  state: string; // 'live'
};
