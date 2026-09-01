// The USD-M and COIN-M bookTicker event, which is complete top-of-book state on every message.
// Prices and quantities arrive as decimal strings.
export type BinanceBookTicker = {
  e: 'bookTicker';
  u: number; // order book update id
  s: string; // contract symbol, uppercase: 'BTCUSDT' or 'BTCUSD_PERP'
  ps?: string; // underlying pair, only on selected streams
  b: string; // best bid price
  B: string; // best bid quantity
  a: string; // best ask price
  A: string; // best ask quantity
  T: number; // matching engine time in milliseconds
  E: number; // event time in milliseconds
  st?: number; // 1 is USD-M, 2 is COIN-M
};

export type BinanceStreamFrame = Partial<BinanceBookTicker> & {
  stream?: string;
  data?: Partial<BinanceBookTicker>;
  id?: number;
  result?: null;
  error?: { code: number; msg: string };
};
