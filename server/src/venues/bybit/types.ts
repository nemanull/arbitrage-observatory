// One level of the depth one order book, which Bybit publishes as a complete snapshot on every message.
// Prices and sizes arrive as decimal strings.
export type BybitOrderbookLevel = [price: string, size: string];

export type BybitOrderbookData = {
  s: string; // contract symbol, uppercase: 'BTCUSDT' or 'BTCUSD'
  b: BybitOrderbookLevel[]; // bids, best first, one level on this channel
  a: BybitOrderbookLevel[]; // asks, best first, one level on this channel
  u: number; // order book update id, which depth one is documented to repeat
  seq: number; // cross sequence, comparable across the whole venue
};

// One decoded frame off a public socket.
// Book data, subscribe acknowledgements, and ping answers all share the socket, so nothing here is guaranteed to be present.
// The live venue carries `cts` at the top level of the frame, where the profile draws it inside `data`.
export type BybitStreamFrame = {
  topic?: string; // 'orderbook.1.BTCUSDT'
  type?: string; // 'snapshot' on every depth one message
  ts?: number; // publish time in milliseconds
  cts?: number; // matching engine time in milliseconds
  data?: Partial<BybitOrderbookData>;
  success?: boolean; // false is the only error signal a control frame gives
  ret_msg?: string; // '' on a subscribe acknowledgement and 'pong' on a ping answer
  conn_id?: string;
  req_id?: string;
  op?: string; // the operation the control frame answers: 'subscribe' or 'ping'
};
