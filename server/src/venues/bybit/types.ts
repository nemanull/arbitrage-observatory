export type BybitOrderbookLevel = [price: string, size: string];

export type BybitOrderbookData = {
  s: string; // contract symbol, uppercase: 'BTCUSDT' or 'BTCUSD'
  b: BybitOrderbookLevel[]; // bids, best first on a snapshot, changed levels only on a delta
  a: BybitOrderbookLevel[]; // asks, likewise
  u: number; // update id, plus one per delta, 1 on the snapshot that follows a venue restart
  seq: number; // cross sequence, comparable across depth channels of the same symbol
};

export type BybitStreamFrame = {
  topic?: string; // 'orderbook.50.BTCUSDT'
  type?: string; // 'snapshot' or 'delta'
  ts?: number; // publish time in milliseconds
  cts?: number; // matching engine time in milliseconds
  data?: Partial<BybitOrderbookData>;
  success?: boolean; // false is the only error signal a control frame gives
  ret_msg?: string; // '' on a subscribe acknowledgement and 'pong' on a ping answer
  conn_id?: string;
  req_id?: string;
  op?: string; // the operation the control frame answers: 'subscribe' or 'ping'
};
