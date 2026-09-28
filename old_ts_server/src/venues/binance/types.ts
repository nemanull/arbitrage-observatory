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

// One row of GET /fapi/v1/premiumIndex without a symbol, which is every contract on the host including the dated ones.
export type BinancePremiumIndex = {
  symbol: string;
  markPrice: string;
  indexPrice: string;
  estimatedSettlePrice: string;
  lastFundingRate: string; // the rate for the upcoming settlement despite the name, as a fraction
  interestRate: string;
  nextFundingTime: number; // Unix ms
  time: number; // Unix ms, whole seconds
};

// One row of GET /fapi/v1/fundingInfo, which listed every trading perpetual on 2026-09-10 and none of the settling ones.
export type BinanceFundingInfo = {
  symbol: string;
  adjustedFundingRateCap: string;
  adjustedFundingRateFloor: string;
  fundingIntervalHours: number;
  disclaimer: boolean;
};
