export type KrakenFuturesTicker = {
  feed: 'ticker';
  product_id: string; // contract symbol: 'PF_XBTUSD', where the base asset is spelled XBT rather than BTC
  bid: number;
  ask: number;
  bid_size: number;
  ask_size: number;
  time: number; 
};

export type KrakenFuturesFrame = Partial<KrakenFuturesTicker> & {
  event?: string; // 'info' once on connect, 'subscribed' once per product, 'alert' for every error
  message?: string; // free text on an alert, carrying the offending product id in backticks
  product_ids?: string[]; // echoed back on a subscribe acknowledgement
  version?: number;
};
