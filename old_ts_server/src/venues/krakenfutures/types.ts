export type KrakenBookLevel = { price: number; qty: number };

export type KrakenBookSnapshot = {
  feed: 'book_snapshot';
  product_id: string; // contract symbol: 'PF_XBTUSD', where the base asset is spelled XBT rather than BTC
  timestamp: number; // milliseconds
  seq: number; // per product, and the next delta carries seq plus one
  tickSize: number | null;
  bids: KrakenBookLevel[];
  asks: KrakenBookLevel[];
};

export type KrakenBookDelta = {
  feed: 'book';
  product_id: string;
  side: 'buy' | 'sell'; // buy is the bid side
  seq: number;
  price: number;
  qty: number;
  timestamp: number;
};

export type KrakenFuturesFrame = {
  feed?: string; // 'book_snapshot', 'book', or absent on a control frame
  product_id?: string;
  event?: string; // 'info' once on connect, 'subscribed' once per frame, 'alert' for every error
  message?: string; // free text on an alert, carrying the offending product id in backticks
  product_ids?: string[]; // echoed back on a subscribe acknowledgement
  version?: number;
};

// One row of GET /derivatives/api/v3/tickers, only the fields the anchor reads. Numbers arrive as JSON numbers.
export type KrakenTicker = {
  symbol: string; // 'PF_XBTUSD'
  tag?: string; // 'perpetual', 'month', 'quarter' or 'week'
  markPrice?: number;
  indexPrice?: number;
  fundingRate?: number; // absolute, in quote currency per contract, for the running hour
  fundingRatePrediction?: number; // absolute, the estimate for the next settlement
  suspended?: boolean;
  postOnly?: boolean;
  isUnderlyingMarketClosed?: boolean; // tradfi contracts only
};

export type KrakenTickersReply = {
  result: string; // 'success' or 'error'
  error?: string;
  serverTime: string; // RFC 3339
  tickers: KrakenTicker[];
};
