import * as ccxt from 'ccxt';
import type { MarketFilter } from '../ccxt/types';
import type { Engine } from '../engine/Engine';
import type { Venue } from '../engine/types';
import type { VenueFeed } from '../ws/VenueFeed';
import { BinanceFeed } from './binance/binance';
import { BybitFeed } from './bybit/bybit';
import { CoinbaseFeed } from './coinbase/coinbase';
import { KrakenFuturesFeed } from './krakenfutures/krakenfutures';
import { OkxFeed } from './okx/okx';


export type VenueRegistration = {
  takerPpm?: number;
  marketFilter?: MarketFilter;
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
  krakenfutures: {
    takerPpm: 500,
    // The four PI_ inverse contracts collide with a PF_ linear contract on the same pair, and their books are frozen.
    // PI_LTCUSD traded nothing at all in 24 hours at a 12.7 percent spread, so linear is the venue's real liquidity.
    marketFilter: (market) => market.linear === true,
    createExchange: () => new ccxt.krakenfutures(),
    createFeed: (venue, engine) => new KrakenFuturesFeed(venue, engine),
  },
  // Coinbase Advanced, whose market ids carry the -INTX suffix, is the only Coinbase platform serving perpetuals publicly.
  // CCXT reports has.swap false here and still lists 131 active swap markets, so the catalog is read rather than the flag.
  coinbase: {
    takerPpm: 400,
    createExchange: () => new ccxt.coinbase(),
    createFeed: (venue, engine) => new CoinbaseFeed(venue, engine),
  },
};
