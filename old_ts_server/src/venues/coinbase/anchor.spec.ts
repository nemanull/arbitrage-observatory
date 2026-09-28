import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/cluster/types';
import type { AnchorMap } from '../../feeds/anchor/types';
import { CoinbaseAnchorPoller } from './anchor';

const VENUE_ID = 'coinbase';
const T0 = Date.parse('2026-09-14T21:23:12.000Z');

type Probe = {
  fetchRound(ts: number, signal: AbortSignal): Promise<AnchorMap>;
};

function market(rawMarketId: string): Market {
  return {
    venueId: VENUE_ID,
    rawMarketId,
    base: rawMarketId.slice(0, rawMarketId.indexOf('-')),
    quote: 'USDC',
    takerPpm: 400,
    linear: true,
    contractSize: 1,
  };
}

// One entry of the INTX instruments list captured live on 2026-09-14, cut down to the fields the poller reads plus a few it ignores.
const TOWNS_PERP = {
  instrument_id: '475671915168530442',
  symbol: 'TOWNS-PERP',
  type: 'PERP',
  mode: 'STANDARD',
  quote_asset_name: 'USDC',
  quote_increment: '0.000001',
  open_interest: '40891892',
  funding_interval: '3600000000000',
  trading_state: 'TRADING',
  quote: {
    best_bid_price: '0.0016',
    best_bid_size: '125000',
    best_ask_price: '0.00184',
    best_ask_size: '750455',
    trade_price: '0.001873',
    trade_qty: '5535',
    index_price: '0.001836',
    mark_price: '0.00184',
    settlement_price: '0.00184',
    limit_up: '0.001964',
    limit_down: '0.001708',
    predicted_funding: '-0.000348',
    timestamp: '2026-09-14T21:23:11.825Z',
  },
  underlying_type: 'SPOT',
  execution_exchange: 'COINBASE_INTERNATIONAL_EXCHANGE',
};

const ETH_SPOT = {
  symbol: 'ETH-USDC',
  type: 'SPOT',
  funding_interval: '0',
  trading_state: 'TRADING',
  quote: {
    index_price: '2558.28',
    mark_price: '2558.28',
    predicted_funding: '0',
    timestamp: '2026-09-14T21:23:11.855Z',
  },
};

// A delisted perpetual keeps a frozen quote from the delisting day, with sizes of 0 and no bid or ask price.
const MATIC_DELISTED = {
  symbol: 'MATIC-PERP',
  type: 'PERP',
  funding_interval: '3600000000000',
  trading_state: 'DELISTED',
  quote: {
    best_bid_size: '0',
    best_ask_size: '0',
    trade_price: '0.3973',
    index_price: '0.4032',
    mark_price: '0.3973',
    predicted_funding: '-0.000014',
    timestamp: '2026-09-03T19:45:52.533Z',
  },
};

const ZERO_INTERVAL_PERP = {
  ...TOWNS_PERP,
  symbol: 'ZERO-PERP',
  funding_interval: '0',
};

const QUOTELESS_PERP = { ...TOWNS_PERP, symbol: 'BARE-PERP', quote: undefined };

function makePoller(markets: Market[], instruments: unknown[]) {
  const venue: Venue = { id: VENUE_ID, name: 'Coinbase Advanced', markets };
  const engine = { updateAnchor: jest.fn() } as unknown as Engine;
  const poller = new CoinbaseAnchorPoller(venue, engine);
  jest
    .spyOn(
      poller as unknown as { getJson: (url: string) => Promise<unknown> },
      'getJson',
    )
    .mockResolvedValue(instruments);

  return poller as unknown as Probe;
}

const signal = new AbortController().signal;

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('CoinbaseAnchorPoller.fetchRound', () => {
  it('maps a trading perpetual to its index, mark, predicted rate and the next hour boundary after ts', async () => {
    const poller = makePoller([market('TOWNS-PERP-INTX')], [TOWNS_PERP]);

    const rows = await poller.fetchRound(T0, signal);

    expect(rows.get('TOWNS-PERP-INTX')).toEqual({
      index: 0.001836,
      mark: 0.00184,
      fundingRate: -0.000348,
      fundingIntervalHours: 1,
      nextFundingAt: Date.parse('2026-09-14T22:00:00.000Z'),
    });
  });

  it('writes mark 0 when mark_price is not positive', async () => {
    const poller = makePoller(
      [market('TOWNS-PERP-INTX')],
      [{ ...TOWNS_PERP, quote: { ...TOWNS_PERP.quote, mark_price: '0' } }],
    );

    const rows = await poller.fetchRound(T0, signal);

    expect(rows.get('TOWNS-PERP-INTX')?.mark).toBe(0);
  });

  it('leaves out spot, delisted, zero-interval and quoteless entries', async () => {
    const poller = makePoller(
      [market('TOWNS-PERP-INTX')],
      [
        ETH_SPOT,
        MATIC_DELISTED,
        ZERO_INTERVAL_PERP,
        QUOTELESS_PERP,
        TOWNS_PERP,
      ],
    );

    const rows = await poller.fetchRound(T0, signal);

    expect([...rows.keys()]).toEqual(['TOWNS-PERP-INTX']);
  });
});
