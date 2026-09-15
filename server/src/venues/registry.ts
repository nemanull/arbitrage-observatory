import * as ccxt from 'ccxt';
import type { VenueConnectorOptions } from '../ccxt/types';
import type { Engine } from '../engine/Engine';
import type { Venue } from '../engine/cluster/types';
import type { AnchorPoller } from '../feeds/anchor/AnchorPoller';
import type { VenueFeed } from '../feeds/book/VenueFeed';
import { BinanceAnchorPoller } from './binance/anchor';
import { BinanceFeed } from './binance/binance';
import { BitgetAnchorPoller } from './bitget/anchor';
import { BitgetFeed } from './bitget/bitget';
import { BitstampAnchorPoller } from './bitstamp/anchor';
import { BitstampFeed } from './bitstamp/bitstamp';
import { BybitAnchorPoller } from './bybit/anchor';
import { BybitFeed } from './bybit/bybit';
import { CoinbaseAnchorPoller } from './coinbase/anchor';
import { CoinbaseFeed } from './coinbase/coinbase';
import { GateAnchorPoller } from './gate/anchor';
import { GateFeed } from './gate/gate';
import { GeminiAnchorPoller } from './gemini/anchor';
import { GeminiFeed } from './gemini/gemini';
import { KrakenFuturesAnchorPoller } from './krakenfutures/anchor';
import { KrakenFuturesFeed } from './krakenfutures/krakenfutures';
import { MexcAnchorPoller } from './mexc/anchor';
import { MexcFeed } from './mexc/mexc';
import { OkxAnchorPoller } from './okx/anchor';
import { OkxFeed } from './okx/okx';

export type VenueRegistration = VenueConnectorOptions & {
  createExchange: () => ccxt.Exchange;
  createFeed: (venue: Venue, engine: Engine) => VenueFeed; // the book socket, the only writer of quotes and depth
  createAnchorPoller: (venue: Venue, engine: Engine) => AnchorPoller; // the index, mark and funding poll, the only writer of the anchor block
};

export const VENUE_REGISTRY: Record<string, VenueRegistration> = {
  binance: {
    // No rate here on purpose. The USD-M and COIN-M tier tables are client rendered, so the profile records no static VIP 0 row.
    // Binance therefore runs on CCXT's own constant, and declaring that constant is the only watch this venue has.
    // ccxt/js/src/binance.js:1248 for linear and :1283 for inverse both read 0.000500, which matches the published VIP 0 taker.
    ccxtTakerPpm: 500,
    createExchange: () => new ccxt.binance(),
    createFeed: (venue, engine) => new BinanceFeed(venue, engine),
    createAnchorPoller: (venue, engine) =>
      new BinanceAnchorPoller(venue, engine),
  },
  bybit: {
    takerPpm: 550,
    // The public instruments-info response carries no fee, so CCXT falls back to a constant at ccxt/js/src/bybit.js:2219.
    // 0.06 percent was bybit's own non-VIP derivatives taker before the move to 0.055, so the constant is stale rather than about some other product.
    ccxtTakerPpm: 600,
    createExchange: () => new ccxt.bybit(),
    createFeed: (venue, engine) => new BybitFeed(venue, engine),
    createAnchorPoller: (venue, engine) => new BybitAnchorPoller(venue, engine),
  },
  okx: {
    takerPpm: 500,
    createExchange: () => new ccxt.okx(),
    createFeed: (venue, engine) => new OkxFeed(venue, engine),
    createAnchorPoller: (venue, engine) => new OkxAnchorPoller(venue, engine),
  },
  krakenfutures: {
    takerPpm: 500,
    // The four PI_ inverse contracts collide with a PF_ linear contract on the same pair, and their books are frozen.
    // PI_LTCUSD traded nothing at all in 24 hours at a 12.7 percent spread, so linear is the venue's real liquidity.
    marketFilter: (market) => market.linear === true,
    createExchange: () => new ccxt.krakenfutures(),
    createFeed: (venue, engine) => new KrakenFuturesFeed(venue, engine),
    createAnchorPoller: (venue, engine) =>
      new KrakenFuturesAnchorPoller(venue, engine),
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
    createAnchorPoller: (venue, engine) =>
      new CoinbaseAnchorPoller(venue, engine),
  },

  // The venues below are built and not yet started. A venue runs only when its id is in Orchestrator.activeVenues.
  // docs/implemented/2026-09-15-five-venue-adapters-plan.md lists what each one needs checked before that.
  gate: {
    // ccxt/js/src/gate.js:1653 hardcodes 0.0005 on every contract, which equals the published VIP 0 USDT-M taker, so the connector warns only if a later CCXT release changes it.
    takerPpm: 500,
    // The filter drops BTC_USD, the one BTC-settled inverse contract, whose quanto_multiplier of 0 becomes a contract size of 1 at ccxt/js/src/gate.js:1630.
    // It also keeps the feed and the poller on the one USDT socket and contracts call, see docs/profiles/gate/rest.md section 2.
    marketFilter: (market) =>
      market.linear === true && market.settle === 'USDT',
    createExchange: () => new ccxt.gate(),
    createFeed: (venue, engine) => new GateFeed(venue, engine),
    createAnchorPoller: (venue, engine) => new GateAnchorPoller(venue, engine),
  },
  bitget: {
    // CCXT reads each contract's takerFeeRate at ccxt/js/src/bitget.js:2223, 0.0006 on all 836 kept markets on 2026-09-15, so the connector warns the day Bitget changes one.
    takerPpm: 600,
    // CCXT loads all six product types at ccxt/js/src/bitget.js:2012, so 9 Coin-M contracts and 7 demo markets arrive as active swaps.
    // Coin-M settles in its base coin and demo markets settle in SUSDT, SUSDC, SBTC or SETH, and the feed and poller address USDT-M and USDC-M only.
    marketFilter: (market) =>
      market.linear === true &&
      (market.settle === 'USDT' || market.settle === 'USDC'),
    createExchange: () => new ccxt.bitget(),
    createFeed: (venue, engine) => new BitgetFeed(venue, engine),
    createAnchorPoller: (venue, engine) =>
      new BitgetAnchorPoller(venue, engine),
  },
  mexc: {
    // API orders pay 0.08 percent since 2026-06-01, which overrides every per contract rate, see docs/profiles/mexc/fees.md section 9.
    // The API rate changed twice in two months, so re-read https://www.mexc.com/announcements/api-updates before starting this venue.
    takerPpm: 800,
    // CCXT reads each contract's web and app takerFeeRate at ccxt/js/src/mexc.js:1465, 0 to 1,000 ppm, and no API order pays it.
    ignoreCcxtTakerPpm: true,
    // 41 of 1,184 active swaps carried apiAllowed false on 2026-09-15, mostly Innovation Zone pairs the API cannot trade.
    // CCXT keeps the raw catalog row as info at ccxt/js/src/mexc.js:1495, typed any, so the field is read through a cast.
    marketFilter: (market) =>
      (market.info as { apiAllowed?: boolean }).apiAllowed === true,
    createExchange: () => new ccxt.mexc(),
    createFeed: (venue, engine) => new MexcFeed(venue, engine),
    createAnchorPoller: (venue, engine) => new MexcAnchorPoller(venue, engine),
  },
  bitstamp: {
    // 150 ppm is the perpetual taker under both Early Bird programmes, which last until Bitstamp introduces volume tiers, see docs/profiles/bitstamp/fees.md section 9.
    // The day the tiers land, every Bitstamp leg is mispriced until this changes.
    takerPpm: 150,
    // The public markets reply carries no fee, so CCXT falls back to its first spot tier taker at ccxt/js/src/bitstamp.js:439.
    ccxtTakerPpm: 4000,
    createExchange: () => new ccxt.bitstamp(),
    createFeed: (venue, engine) => new BitstampFeed(venue, engine),
    createAnchorPoller: (venue, engine) =>
      new BitstampAnchorPoller(venue, engine),
  },
  gemini: {
    takerPpm: 700,
    // CCXT reads no fee and falls back to a constant at ccxt/js/src/gemini.js:228, and 0.004 matches no Gemini perpetual rate, see docs/profiles/gemini/fees.md section 9.
    ccxtTakerPpm: 4000,
    // The books are in base units, and ccxt/js/src/gemini.js:822 copies the price tick into contractSize on the day its catalog scrape succeeds.
    contractSize: 1,
    createExchange: () => new ccxt.gemini(),
    createFeed: (venue, engine) => new GeminiFeed(venue, engine),
    createAnchorPoller: (venue, engine) =>
      new GeminiAnchorPoller(venue, engine),
  },
};
