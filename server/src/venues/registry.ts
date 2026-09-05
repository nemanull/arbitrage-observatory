import * as ccxt from 'ccxt';
import type { Engine } from '../engine/Engine';
import type { Venue } from '../engine/types';
import type { VenueFeed } from '../ws/VenueFeed';
import { BinanceFeed } from './binance/binance';
import { BybitFeed } from './bybit/bybit';
import { OkxFeed } from './okx/okx';


export type VenueRegistration = {
  takerPpm?: number;
  createExchange: () => ccxt.Exchange;
  createFeed: (venue: Venue, engine: Engine) => VenueFeed;
};

export const VENUE_REGISTRY: Record<string, VenueRegistration> = {
  binance: {
    // No rate here on purpose. The USD-M and COIN-M tier tables are client rendered, so the profile records no static VIP 0 row.
    createExchange: () => new ccxt.binance(),
    createFeed: (venue, engine) => new BinanceFeed(venue, engine),
  },
  bybit: {
    takerPpm: 550,
    createExchange: () => new ccxt.bybit(),
    createFeed: (venue, engine) => new BybitFeed(venue, engine),
  },
  okx: {
    takerPpm: 500, 
    createExchange: () => new ccxt.okx(),
    createFeed: (venue, engine) => new OkxFeed(venue, engine),
  },
};
