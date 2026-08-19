import { MarketInterface as CCXTMarketInterface } from 'ccxt';

export type VenueSwapMarkets = {
  venueId: string; // The ccxt exchange id, which is also Venue.id in src/engine/types.ts
  venueName: string;
  markets: SwapMarket[];
};

export type SwapMarket = CCXTMarketInterface & {
  type: 'swap';
  swap: true;
};
