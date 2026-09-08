export type BinanceDepthLevel = [price: string, quantity: string];

export type BinanceDepthUpdate = {
  e: 'depthUpdate';
  E: number; // event time in milliseconds
  T: number; // matching engine time in milliseconds
  s: string; // contract symbol, uppercase: 'BTCUSDT' or 'BTCUSD_PERP'
  U: number; // first update id covered by this event
  u: number; // last update id covered by this event
  pu: number; // last update id of the previous event, which only the diff stream needs to chain
  b: BinanceDepthLevel[]; // bids, best first
  a: BinanceDepthLevel[]; // asks, best first
  ps?: string; // underlying pair, COIN-M only
  st?: number; // 1 is USD-M, 2 is COIN-M
};

export type BinanceStreamFrame = Partial<BinanceDepthUpdate> & {
  stream?: string;
  data?: Partial<BinanceDepthUpdate>;
  id?: number;
  result?: null;
  error?: { code: number; msg: string };
};
