import ccxt from 'ccxt';
import { Exchange as CCXTVenue, Market as CCXTMarket } from 'ccxt';
import { VenueSwapMarkets, SwapMarket } from './types';
import { Logger } from '@nestjs/common';

export class VenueConnector {
  public logger: Logger;

  constructor() {
    this.logger = new Logger();
  }

  venues = [
    new ccxt.pro.binance(),
    new ccxt.pro.bybit(),
    new ccxt.pro.okx(),
    new ccxt.pro.coinbaseinternational(),
    new ccxt.pro.krakenfutures(),
  ]; // This should be a function that later gets all enabled venues from the db

  async getVenueSwapMarkets(
    venue: CCXTVenue,
  ): Promise<VenueSwapMarkets | null> {
    try {
      const markets = await venue.loadMarkets();
      let venueName = venue.name;

      if (!markets) {
        this.logger.error(`Markets for ${venue.name} are undefined`);
      }
      if (!venueName) {
        venueName = venue.id;
        this.logger.warn(`Venue ${venue.id} doesn't have a name`);
      }

      const perpetuals = Object.values(markets).filter(isActiveSwapMarket);

      return {
        venueId: venue.id,
        venueName,
        markets: perpetuals,
      };
    } catch {
      this.logger.error(
        `There was an error with market loading for ${venue.name}`,
      );
    }
    return null;
  }
}

function isActiveSwapMarket(market: CCXTMarket): market is SwapMarket {
  return (
    market !== undefined &&
    market.type === 'swap' &&
    market.swap === true &&
    market.active !== false
  );
}
