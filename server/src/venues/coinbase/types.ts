// One changed level. A new_quantity of '0' removes it. The ask side is spelled 'offer'.
export type CoinbaseL2Update = {
  side: 'bid' | 'offer';
  event_time: string; // RFC 3339 with microseconds
  price_level: string;
  new_quantity: string;
};

export type CoinbaseL2Event = {
  type: 'snapshot' | 'update'; // the snapshot is the whole book as updates, in no promised order
  product_id: string; // 'BTC-PERP-INTX'
  updates: CoinbaseL2Update[];
};

export type CoinbaseEvent = Partial<CoinbaseL2Event> & {
  subscriptions?: Record<string, string[]>; // on the subscriptions channel, the connection's whole set per channel
  current_time?: string; // heartbeats
  heartbeat_counter?: number;
};

export type CoinbaseFrame = {
  channel?: string; // 'l2_data', 'heartbeats', or 'subscriptions'
  timestamp?: string; // RFC 3339 with nanosecond precision, unused because recvTs is the local clock
  sequence_num?: number; // one counter per connection across every channel, plus one per frame
  events?: CoinbaseEvent[];
  type?: string; // 'error', which is the only frame shape that carries no channel
  message?: string;
};
