import { Exchange as CCXTVenue, Market as CCXTMarket } from 'ccxt';
import {
  VenueSwapMarkets,
  SwapMarket,
  MarketFilter,
  VenueConnectorOptions,
} from './types';
import { Logger } from '@nestjs/common';
import type { Market, Venue } from '../engine/cluster/types';

export class VenueConnector {
  public logger: Logger;
  private venue: CCXTVenue;
  protected takerPpm: number | undefined;
  protected ccxtTakerPpm: number | undefined;
  private ignoreCcxtTakerPpm: boolean;
  private contractSize: number | undefined;
  private marketFilter: MarketFilter | undefined;

  // The options are the venue's registration, so a rate lives beside the venue it describes rather than at this call site.
  constructor(venue: CCXTVenue, options: VenueConnectorOptions = {}) {
    this.venue = venue;
    this.takerPpm = options.takerPpm;
    this.ccxtTakerPpm = options.ccxtTakerPpm;
    this.ignoreCcxtTakerPpm = options.ignoreCcxtTakerPpm === true;
    this.contractSize = options.contractSize;
    this.marketFilter = options.marketFilter;
    this.logger = new Logger(`CCXT ${venue.id}`);
  }

  // True when CCXT's number is the one the registration already accounts for, which is the case that needs no warning.
  // A venue whose CCXT fee describes other orders, so that no single number can describe what CCXT reports, sets ignoreCcxtTakerPpm.
  protected isExpectedCcxtTakerPpm(ccxtPpm: number, market: Market): boolean {
    if (this.ignoreCcxtTakerPpm) {
      return true;
    }

    return ccxtPpm === (this.ccxtTakerPpm ?? market.takerPpm);
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
    let unexpected = 0;
    let nonUnitContracts = 0;

    for (const ccxtMarket of swapMarkets.markets) {
      const market = this.toMarket(swapMarkets.venueId, ccxtMarket);

      if (market === null) {
        skipped++;
        continue;
      }

      const ccxtPpm = toPpm(ccxtMarket.taker);

      if (ccxtPpm !== null && !this.isExpectedCcxtTakerPpm(ccxtPpm, market)) {
        reportedPpm.add(ccxtPpm);
        unexpected++;
      }

      if (market.contractSize !== 1) {
        nonUnitContracts++;
      }

      markets.push(market);
    }

    if (skipped > 0) {
      this.logger.warn(
        `skipped ${skipped} market(s) missing an id, a symbol, or a taker fee`,
      );
    }

    if (unexpected > 0) {
      this.logger.warn(
        `CCXT reports ${[...reportedPpm].join(', ')} ppm on ${unexpected} of ${markets.length} markets, and ${this.ccxtTakerPpm ?? this.takerPpm} ppm was expected`,
      );
    }

    if (nonUnitContracts > 0) {
      this.logger.log(
        `${nonUnitContracts} of ${markets.length} markets have a contract size other than 1 coin, so their sizes arrive in contracts`,
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
      contractSize: this.contractSize ?? toContractSize(market.contractSize),
    };
  }
}

function toPpm(taker: number | undefined): number | null {
  if (typeof taker !== 'number' || !Number.isFinite(taker)) {
    return null;
  }

  return Math.round(taker * 1_000_000);
}

function toContractSize(size: number | null | undefined): number {
  if (typeof size !== 'number' || !Number.isFinite(size) || size <= 0) {
    return 1;
  }

  return size;
}

function isActiveSwapMarket(market: CCXTMarket): market is SwapMarket {
  return (
    market !== undefined &&
    market.type === 'swap' &&
    market.swap === true &&
    market.active !== false
  );
}
