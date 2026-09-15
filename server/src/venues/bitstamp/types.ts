export type BitstampBookLevel = [price: string, amount: string];

export type BitstampBookData = {
  timestamp: string; // Unix seconds as a string
  microtimestamp: string; // Unix microseconds as a string, 16 digits, which a double holds exactly
  bids: BitstampBookLevel[]; // the whole side up to 100 levels, best first
  asks: BitstampBookLevel[]; // likewise
};

export type BitstampErrorData = {
  code: number | null; // null or 4009
  message: string; // 'Invalid channel provided.'
};

// One decoded frame off the public socket.
// Book data, acknowledgements, heartbeat answers, errors and the reconnect request all share it.
export type BitstampStreamFrame = {
  event?: string; // 'data', 'bts:subscription_succeeded', 'bts:heartbeat', 'bts:error' or 'bts:request_reconnect'
  channel?: string; // 'order_book_btcusd-perp', '' on session frames
  data?: Partial<BitstampBookData & BitstampErrorData> | null; // null on the reconnect request
};

// One row of GET /api/v2/ticker/, only the fields the anchor reads. Every number is a decimal string.
export type BitstampTicker = {
  market: string; // 'BTC/USD-PERP', which is not the socket's id
  market_type: string; // 'PERPETUAL' or 'SPOT'
  timestamp: string; // Unix seconds of the venue's last republish, about every 2 s
  index_price?: string; // absent on spot rows
  mark_price?: string;
};

// GET /api/v2/funding_rate/<rawMarketId>/.
export type BitstampFundingRate = {
  funding_rate: string; // a fraction per 8 hour interval, the running rate for the upcoming settlement
  timestamp: string; // Unix seconds of the reply, not of a rate change
  market: string; // 'BTC/USD-PERP'
  next_funding_time: string; // Unix seconds
};
