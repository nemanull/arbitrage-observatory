import { ClusterIndexBuilder } from './ClusterIndexBuilder';
import { createVenueIndexMap } from './shared';
import type { Market, Venue } from './types';

// Covers only what clusterOverrides and quoteFamily add. Everything else about the builder is untested for now.

const TAKER_PPM: Record<string, number> = {
  binance: 500,
  bybit: 550,
  okx: 500,
  krakenfutures: 500,
  coinbase: 400,
};

const BINANCE = 0;
const BYBIT = 1;
const OKX = 2;

function market(
  venueId: string,
  rawMarketId: string,
  base: string,
  contract: Partial<Pick<Market, 'quote' | 'linear'>> = {},
): Market {
  return {
    venueId,
    rawMarketId,
    base,
    quote: 'USDT',
    takerPpm: TAKER_PPM[venueId],
    linear: true,
    ...contract,
  };
}

function venue(id: string, markets: Market[]): Venue {
  return { id, name: id, markets };
}

function build(venues: Venue[]): ClusterIndexBuilder {
  return new ClusterIndexBuilder(venues, createVenueIndexMap(venues));
}

describe('ClusterIndexBuilder DENIED_PAIRS', () => {
  it('never builds a cluster for a denied pair', () => {
    const builder = build([
      venue('binance', [
        market('binance', 'BTCUSDT', 'BTC'),
        market('binance', 'BBUSDT', 'BB'), // x804 against okx, unrelated assets
      ]),
      venue('bybit', [
        market('bybit', 'BTCUSDT', 'BTC'),
        market('bybit', 'BBUSDT', 'BB'),
      ]),
      venue('okx', [
        market('okx', 'BTC-USDT-SWAP', 'BTC'),
        market('okx', 'BB-USDT-SWAP', 'BB'),
      ]),
    ]);

    expect(builder.clusters.map((c) => c.pair)).toEqual(['BTC|USDT']);
  });

  // No cluster is also what stops the feeds subscribing: Orchestrator.createFeeds keeps only the markets
  // Engine.tracks answers true for, and that answer is this map.
  it('leaves a denied pair out of clusterByRawMarketId, so nothing subscribes to it', () => {
    const builder = build([
      venue('binance', [
        market('binance', 'BTCUSDT', 'BTC'),
        market('binance', 'ONUSDT', 'ON'),
        market('binance', 'QNTUSDT', 'QNT'),
      ]),
      venue('bybit', [
        market('bybit', 'BTCUSDT', 'BTC'),
        market('bybit', 'ONUSDT', 'ON'),
        market('bybit', 'QNTUSDT', 'QNT'),
      ]),
    ]);

    const binance = builder.clusterByRawMarketId.get('binance')!;

    expect(binance.has('BTCUSDT')).toBe(true);
    expect(binance.has('ONUSDT')).toBe(false);
    expect(binance.has('QNTUSDT')).toBe(false);
  });
});

describe('ClusterIndexBuilder PRICE_SCALE', () => {
  it('folds the scale into the multipliers of the scaled market only', () => {
    const builder = build([
      venue('binance', [market('binance', 'ANTHROPICUSDT', 'ANTHROPIC')]),
      venue('bybit', [market('bybit', 'ANTHROPICUSDT', 'ANTHROPIC')]),
      // okx quotes a tenth of the unit the other two use, and publishes the x0.1 itself
      venue('okx', [market('okx', 'ANTHROPIC-USDT-SWAP', 'ANTHROPIC')]),
    ]);

    const cluster = builder.clusters[0];

    expect(cluster.pair).toBe('ANTHROPIC|USDT');

    expect(cluster.bidMul[OKX]).toBeCloseTo((1 - 500 / 1e6) * 10, 12);
    expect(cluster.askMul[OKX]).toBeCloseTo((1 + 500 / 1e6) * 10, 12);

    expect(cluster.bidMul[BINANCE]).toBeCloseTo(1 - 500 / 1e6, 12);
    expect(cluster.askMul[BINANCE]).toBeCloseTo(1 + 500 / 1e6, 12);
    expect(cluster.bidMul[BYBIT]).toBeCloseTo(1 - 550 / 1e6, 12);
    expect(cluster.askMul[BYBIT]).toBeCloseTo(1 + 550 / 1e6, 12);
  });

  it('leaves an unnamed market on the same venue alone', () => {
    const builder = build([
      venue('binance', [market('binance', 'BTCUSDT', 'BTC')]),
      venue('okx', [market('okx', 'BTC-USDT-SWAP', 'BTC')]),
    ]);

    const cluster = builder.clusters[0];

    expect(cluster.bidMul[1]).toBeCloseTo(1 - 500 / 1e6, 12);
    expect(cluster.askMul[1]).toBeCloseTo(1 + 500 / 1e6, 12);
  });
});

describe('ClusterIndexBuilder QUOTE_FAMILY', () => {
  it('clusters USD, USDC and USDT markets of one coin under the USDT key', () => {
    const b = build([
      venue('binance', [market('binance', 'BTCUSDT', 'BTC')]),
      venue('krakenfutures', [
        market('krakenfutures', 'PF_XBTUSD', 'BTC', { quote: 'USD' }),
      ]),
      venue('coinbase', [
        market('coinbase', 'BTC-PERP-INTX', 'BTC', { quote: 'USDC' }),
      ]),
    ]);

    expect(b.clusters.map((c) => c.pair)).toEqual(['BTC|USDT']);
    expect(b.clusters[0].markets.map((m) => m?.rawMarketId)).toEqual([
      'BTCUSDT',
      'PF_XBTUSD',
      'BTC-PERP-INTX',
    ]);
    expect(b.clusterByRawMarketId.get('krakenfutures')?.get('PF_XBTUSD')).toBe(
      b.clusters[0],
    );
    expect(b.clusterByRawMarketId.get('coinbase')?.get('BTC-PERP-INTX')).toBe(
      b.clusters[0],
    );
  });

  it('keeps the USDT linear contract when a venue lists twins, whatever the listing order', () => {
    const b = build([
      venue('binance', [
        market('binance', 'BTCUSD_PERP', 'BTC', { quote: 'USD', linear: false }),
        market('binance', 'BTCUSDC', 'BTC', { quote: 'USDC' }),
        market('binance', 'BTCUSDT', 'BTC'),
      ]),
      venue('bybit', [
        market('bybit', 'BTCUSDT', 'BTC'),
        market('bybit', 'BTCPERP', 'BTC', { quote: 'USDC' }),
        market('bybit', 'BTCUSD', 'BTC', { quote: 'USD', linear: false }),
      ]),
    ]);

    expect(b.clusters.map((c) => c.pair)).toEqual(['BTC|USDT']);
    expect(b.clusters[0].markets.map((m) => m?.rawMarketId)).toEqual([
      'BTCUSDT',
      'BTCUSDT',
    ]);
    // The twins are not in the index, so no feed subscribes to them.
    expect(b.clusterByRawMarketId.get('binance')?.has('BTCUSD_PERP')).toBe(false);
    expect(b.clusterByRawMarketId.get('binance')?.has('BTCUSDC')).toBe(false);
    expect(b.clusterByRawMarketId.get('bybit')?.has('BTCPERP')).toBe(false);
    expect(b.clusterByRawMarketId.get('bybit')?.has('BTCUSD')).toBe(false);
  });

  it('keeps a USDC or inverse contract where a venue has nothing better', () => {
    const b = build([
      venue('binance', [market('binance', 'ETHUSDC', 'ETH', { quote: 'USDC' })]),
      venue('bybit', [
        market('bybit', 'ETHUSD', 'ETH', { quote: 'USD', linear: false }),
      ]),
    ]);

    expect(b.clusters.map((c) => c.pair)).toEqual(['ETH|USDT']);
    expect(b.clusters[0].markets.map((m) => m?.rawMarketId)).toEqual([
      'ETHUSDC',
      'ETHUSD',
    ]);
  });

  it('leaves a non-dollar quote in its own cluster', () => {
    const b = build([
      venue('binance', [
        market('binance', 'ETHBTC', 'ETH', { quote: 'BTC' }),
        market('binance', 'ETHUSDT', 'ETH'),
      ]),
      venue('bybit', [market('bybit', 'ETHUSDT', 'ETH')]),
    ]);

    expect(b.clusters.map((c) => c.pair)).toEqual(['ETH|USDT']);
    expect(b.clusters[0].markets.map((m) => m?.rawMarketId)).toEqual([
      'ETHUSDT',
      'ETHUSDT',
    ]);
  });
});
