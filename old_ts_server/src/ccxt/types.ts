import { MarketInterface as CCXTMarketInterface } from 'ccxt';

export type VenueSwapMarkets = {
  venueId: string; // The ccxt exchange id, which is also Venue.id in src/engine/cluster/types.ts
  venueName: string;
  markets: SwapMarket[];
};

export type SwapMarket = CCXTMarketInterface & {
  type: 'swap';
  swap: true;
};

// Narrows a venue's swap markets before clustering.
// A venue contributes at most one market per pair, so a venue that lists two contracts on one pair chooses between them here.
export type MarketFilter = (market: SwapMarket) => boolean;

export type VenueConnectorOptions = {
  takerPpm?: number;
  ccxtTakerPpm?: number;
  ignoreCcxtTakerPpm?: boolean; // CCXT's fee describes orders the registry rate does not, so no market is compared: MEXC's web and app rate
  contractSize?: number; // pins every market's size, for a venue whose CCXT catalog misreads it
  marketFilter?: MarketFilter;
};
