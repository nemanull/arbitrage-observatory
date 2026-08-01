import { MarketInterface as CCXTMarketInterface } from 'ccxt';

export type ExchangeSwapMarkets = {
  exchangeId: string;
  exchangeName: string;
  markets: SwapMarket[];
};

export type SwapMarket = CCXTMarketInterface & {
  type: 'swap';
  swap: true;
};
