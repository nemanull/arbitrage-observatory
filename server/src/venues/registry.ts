import * as ccxt from 'ccxt';
import type { VenueConnectorOptions } from '../ccxt/types';
import type { Engine } from '../engine/Engine';
import type { Venue } from '../engine/types';
import type { VenueFeed } from '../ws/VenueFeed';
import { BinanceFeed } from './binance/binance';
import { BybitFeed } from './bybit/bybit';
import { CoinbaseFeed } from './coinbase/coinbase';
import { KrakenFuturesFeed } from './krakenfutures/krakenfutures';
import { OkxFeed } from './okx/okx';


export type VenueRegistration = VenueConnectorOptions & {
  createExchange: () => ccxt.Exchange;
  createFeed: (venue: Venue, engine: Engine) => VenueFeed;
};

export const VENUE_REGISTRY: Record<string, VenueRegistration> = {
  binance: {
    // No rate here on purpose. The USD-M and COIN-M tier tables are client rendered, so the profile records no static VIP 0 row.
    // Binance therefore runs on CCXT's own constant, and declaring that constant is the only watch this venue has.
    // ccxt/js/src/binance.js:1248 for linear and :1283 for inverse both read 0.000500, which matches the published VIP 0 taker.
    ccxtTakerPpm: 500,
    createExchange: () => new ccxt.binance(),
    createFeed: (venue, engine) => new BinanceFeed(venue, engine),
  },
  bybit: {
    takerPpm: 550,
    // The public instruments-info response carries no fee, so CCXT falls back to a constant at ccxt/js/src/bybit.js:2219.
    // 0.06 percent was bybit's own non-VIP derivatives taker before the move to 0.055, so the constant is stale rather than about some other product.
    ccxtTakerPpm: 600,
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
    // CCXT reads no fee without credentials and falls back to a constant at ccxt/js/src/coinbase.js:1825, where the literal 0.06 means six percent.
    // Coinbase publishes 0.60 percent as the Advanced spot ceiling, so the literal reads as that number with the decimal shifted twice. It is not a rate Coinbase charges anywhere.
    ccxtTakerPpm: 60000,
    createExchange: () => new ccxt.coinbase(),
    createFeed: (venue, engine) => new CoinbaseFeed(venue, engine),
  },
};
