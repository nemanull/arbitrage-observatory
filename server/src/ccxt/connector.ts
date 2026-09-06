import { Exchange as CCXTVenue, Market as CCXTMarket } from 'ccxt';
import { VenueSwapMarkets, SwapMarket, MarketFilter } from './types';
import { Logger } from '@nestjs/common';
import type { Market, Venue } from '../engine/types';

export class VenueConnector {
  public logger: Logger;
  private venue: CCXTVenue;
  private takerPpm: number | undefined;
  private marketFilter: MarketFilter | undefined;

  // takerPpm overrides what CCXT reports, because CCXT ships one static table and the profile research is the verified source.
  // marketFilter narrows the venue's swap markets, because a venue contributes at most one market per pair and some list two.
  constructor(
    venue: CCXTVenue,
    takerPpm?: number,
    marketFilter?: MarketFilter,
  ) {
    this.venue = venue;
    this.takerPpm = takerPpm;
    this.marketFilter = marketFilter;
    this.logger = new Logger(`CCXT ${venue.id}`);
  }

  async loadVenue(): Promise<Venue | null> {
    const swapMarkets = await this.getVenueSwapMarkets();

    if (swapMarkets === null) {
      return null;
    }

    const venue = this.toVenue(swapMarkets);

    if (venue.markets.length === 0) {
      this.logger.error('no usable swap markets; skipping the venue');
      return null;
    }

    this.logger.log(
      this.takerPpm === undefined
        ? `${venue.markets.length} swap markets, taker fee from CCXT`
        : `${venue.markets.length} swap markets, taker fee ${this.takerPpm} ppm from the registry`,
    );

    return venue;
  }

  async getVenueSwapMarkets(): Promise<VenueSwapMarkets | null> {
    const venue = this.venue;

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

      const swaps = Object.values(markets).filter(isActiveSwapMarket);
      const filter = this.marketFilter;
      const perpetuals =
        filter === undefined ? swaps : swaps.filter((m) => filter(m));

      if (perpetuals.length < swaps.length) {
        this.logger.log(
          `market filter kept ${perpetuals.length} of ${swaps.length} swap markets`,
        );
      }

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

  private toVenue(swapMarkets: VenueSwapMarkets): Venue {
    const markets: Market[] = [];
    const reportedPpm = new Set<number>();
    let skipped = 0;
    let disagreeing = 0;

    for (const ccxtMarket of swapMarkets.markets) {
      const market = this.toMarket(swapMarkets.venueId, ccxtMarket);

      if (market === null) {
        skipped++;
        continue;
      }

      const ccxtPpm = toPpm(ccxtMarket.taker);

      if (ccxtPpm !== null && ccxtPpm !== market.takerPpm) {
        reportedPpm.add(ccxtPpm);
        disagreeing++;
      }

      markets.push(market);
    }

    if (skipped > 0) {
      this.logger.warn(
        `skipped ${skipped} market(s) missing an id, a symbol, or a taker fee`,
      );
    }

    if (disagreeing > 0) {
      this.logger.warn(
        `CCXT reports ${[...reportedPpm].join(', ')} ppm on ${disagreeing} of ${markets.length} markets, and the registry says ${this.takerPpm}`,
      );
    }

    return {
      id: swapMarkets.venueId,
      name: swapMarkets.venueName,
      markets,
    };
  }

  private toMarket(venueId: string, market: SwapMarket): Market | null {
    if (!market.id || !market.base || !market.quote) {
      return null;
    }

    const takerPpm = this.takerPpm ?? toPpm(market.taker);

    if (takerPpm === null) {
      return null;
    }

    return {
      venueId,
      rawMarketId: market.id,
      base: market.base,
      quote: market.quote,
      takerPpm,
      linear: market.linear === true,
    };
  }
}

function toPpm(taker: number | undefined): number | null {
  if (typeof taker !== 'number' || !Number.isFinite(taker)) {
    return null;
  }

  return Math.round(taker * 1_000_000);
}

function isActiveSwapMarket(market: CCXTMarket): market is SwapMarket {
  return (
    market !== undefined &&
    market.type === 'swap' &&
    market.swap === true &&
    market.active !== false
  );
}
