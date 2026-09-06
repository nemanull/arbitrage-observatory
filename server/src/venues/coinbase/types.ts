export type CoinbaseTicker = {
  type: string; 
  product_id: string; 
  best_bid: string;
  best_ask: string;
  best_bid_quantity: string;
  best_ask_quantity: string;
};

export type CoinbaseEvent = {
  type?: string; 
  tickers?: CoinbaseTicker[];
  subscriptions?: Record<string, string[]>;
};


export type CoinbaseFrame = {
  channel?: string; // 'ticker', 'heartbeats', or 'subscriptions'
  timestamp?: string; // RFC 3339 with nanosecond precision, unused because recvTs is the local clock
  sequence_num?: number; // per connection, not per product
  events?: CoinbaseEvent[];
  type?: string; // 'error', which is the only frame shape that carries no channel
  message?: string;
};
