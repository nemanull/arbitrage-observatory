import { Logger } from '@nestjs/common';
import type { Engine } from '../../engine/Engine';
import type { Market, Venue } from '../../engine/types';
import type { AnchorRows } from '../../feeds/anchor/types';
import { CoinbaseAnchorPoller } from './anchor';

const VENUE_ID = 'coinbase';
const T0 = Date.parse('2026-09-10T04:52:40.000Z');

type Probe = {
  fetchRound(ts: number, signal: AbortSignal): Promise<AnchorRows>;
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

// Shape captured live on 2026-09-10, cut down to the fields the poller reads plus a few it ignores.
const BTC_PRODUCT = {
  product_id: 'BTC-PERP-INTX',
  status: 'STANDARD',
  price: '78291.5',
  future_product_details: {
    venue: 'neptune',
    contract_code: 'BTC',
    contract_expiry_type: 'PERPETUAL',
    funding_interval: '3600s',
    open_interest: '1584.0176',
    funding_rate: '0.000004',
    funding_time: '2026-09-10T04:00:00.000039Z',
    index_price: '78281.02607953125',
  },
};

const SPOT_PRODUCT = {
  product_id: 'BTC-USD',
  status: 'online',
  future_product_details: null,
};

const ODD_INTERVAL_PRODUCT = {
  product_id: 'ODD-PERP-INTX',
  status: 'STANDARD',
  future_product_details: {
    ...BTC_PRODUCT.future_product_details,
    funding_interval: '',
  },
};

function makePoller(markets: Market[], products: unknown[]) {
  const venue: Venue = { id: VENUE_ID, name: 'Coinbase Advanced', markets };
  const engine = { updateAnchor: jest.fn() } as unknown as Engine;
  const poller = new CoinbaseAnchorPoller(venue, engine);
  jest
    .spyOn(
      poller as unknown as { getJson: (url: string) => Promise<unknown> },
      'getJson',
    )
    .mockResolvedValue({ products, num_products: products.length });

  return poller as unknown as Probe;
}

const signal = new AbortController().signal;

beforeEach(() => {
  jest.spyOn(Logger.prototype, 'log').mockImplementation(() => undefined);
});

afterEach(() => jest.restoreAllMocks());

describe('CoinbaseAnchorPoller.fetchRound', () => {
  it('maps a perpetual with no mark and the next settlement one interval after the last', async () => {
    const poller = makePoller([market('BTC-PERP-INTX')], [BTC_PRODUCT]);

    const rows = await poller.fetchRound(T0, signal);

    expect(rows.get('BTC-PERP-INTX')).toEqual({
      index: 78281.02607953125,
      mark: 0,
      fundingRate: 0.000004,
      fundingIntervalHours: 1,
      nextFundingAt: Date.parse('2026-09-10T05:00:00.000Z'),
    });
  });

  it('leaves out products without future details or without a usable interval', async () => {
    const poller = makePoller(
      [market('BTC-PERP-INTX')],
      [SPOT_PRODUCT, ODD_INTERVAL_PRODUCT, BTC_PRODUCT],
    );

    const rows = await poller.fetchRound(T0, signal);

    expect([...rows.keys()]).toEqual(['BTC-PERP-INTX']);
  });
});
