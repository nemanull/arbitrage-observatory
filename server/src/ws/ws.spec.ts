import type WebSocket from 'ws';
import type { Cluster, ClusterIndex, Market, Slot } from '../engine/types';
import type {
  EndpointPlan,
  NormalizedQuote,
  VenueConnection,
  VenueSpec,
} from './types';
import { VenueFeed, WSVenueLogic } from './ws';

const testSpec: VenueSpec = {
  keepalive: {
    mode: 'server',
    intervalMs: 0,
    onlyWhenIdle: false,
  },
  chunk: {
    unit: 'none',
    budget: 0,
    scope: 'frame',
  },
  unknownSymbolIsExpected: false,
};

// Slot 0 is venue 'test', slot 1 is venue 'other'. Fixed for every cluster.
const VENUES = ['test', 'other'] as const;

function market(venueId: string, rawMarketId: string, base: string): Market {
  return { venueId, rawMarketId, base, settle: 'USDT', takerPpm: 550, linear: true };
}

function makeCluster(base: string, rawMarketId: string): Cluster {
  const markets = VENUES.map((venueId) => market(venueId, rawMarketId, base));

  return {
    pair: `${base}|USDT`,
    markets,
    bidMul: Float64Array.from(markets, (m) => 1 - m.takerPpm / 1e6),
    askMul: Float64Array.from(markets, (m) => 1 + m.takerPpm / 1e6),
    bid: new Float64Array(VENUES.length),
    ask: new Float64Array(VENUES.length),
    recvTs: new Float64Array(VENUES.length),
  };
}

// One cluster, whose wire symbol BTCUSDT is spelled the same on both venues.
function makeIndex(): ClusterIndex {
  const cluster = makeCluster('BTC', 'BTCUSDT');
  const slots: Slot[] = VENUES.map((_, i) => ({ cluster, i }));

  return {
    clusters: [cluster],
    idBySymbol: new Map(
      VENUES.map((venueId, i) => [venueId, new Map([['BTCUSDT', slots[i]]])]),
    ),
    slotsByVenue: new Map(VENUES.map((venueId, i) => [venueId, [slots[i]]])),
  };
}

class TestVenueFeed extends VenueFeed {
  public readonly venueId = 'test';
  public readonly spec = testSpec;

  public getAllEndpoints(markets: Market[]): EndpointPlan[] {
    return [{ url: 'wss://example.test', markets }];
  }

  public getSubscribeFrames(markets: Market[]): object[] {
    return [
      { op: 'subscribe', markets: markets.map((market) => market.rawMarketId) },
    ];
  }

  public handleMessages(): void {}

  public emit(connection: VenueConnection, quote: NormalizedQuote): void {
    this.submit(connection, quote);
  }
}

const connection: VenueConnection = {
  id: 'test-1',
  socket: {} as WebSocket,
  endpoint: { url: 'wss://example.test', markets: [] },
};

function quote(rawMarketId: string): NormalizedQuote {
  return { rawMarketId, bid: 100, ask: 101, receivedAtMs: 1_000 };
}

describe('VenueFeed.submit', () => {
  it('writes the quote into the slot for its own venue', () => {
    const index = makeIndex();
    const feed = new TestVenueFeed(index);

    feed.emit(connection, quote('BTCUSDT'));

    const cluster = index.clusters[0];
    expect(cluster.bid[0]).toBe(100);
    expect(cluster.ask[0]).toBe(101);
    expect(cluster.recvTs[0]).toBe(1_000);
  });

  it('does not write into another venue sharing the same wire symbol', () => {
    const index = makeIndex();
    const feed = new TestVenueFeed(index);

    feed.emit(connection, quote('BTCUSDT'));

    const cluster = index.clusters[0];
    expect(cluster.bid[1]).toBe(0);
    expect(cluster.ask[1]).toBe(0);
    expect(cluster.recvTs[1]).toBe(0);
  });

  it('counts an unknown symbol and writes nothing', () => {
    const index = makeIndex();
    const feed = new TestVenueFeed(index);

    feed.emit(connection, quote('DOGEUSDT'));

    expect(feed.unknownSymbols).toBe(1);
    expect(index.clusters[0].recvTs[0]).toBe(0);
    expect(index.clusters[0].recvTs[1]).toBe(0);
  });

  it('resolves a market that refresh added after the feed was built', () => {
    const index = makeIndex();
    const feed = new TestVenueFeed(index);

    // What an in place refresh does for a newly listed pair.
    const added = makeCluster('ETH', 'ETHUSDT');
    index.clusters.push(added);
    index.idBySymbol.get('test')?.set('ETHUSDT', { cluster: added, i: 0 });

    feed.emit(connection, quote('ETHUSDT'));

    expect(added.bid[0]).toBe(100);
    expect(feed.unknownSymbols).toBe(0);
  });

  it('stops resolving a market that refresh removed', () => {
    const index = makeIndex();
    const feed = new TestVenueFeed(index);

    index.idBySymbol.get('test')?.delete('BTCUSDT');

    feed.emit(connection, quote('BTCUSDT'));

    expect(feed.unknownSymbols).toBe(1);
    expect(index.clusters[0].recvTs[0]).toBe(0);
  });
});

describe('WSVenueLogic', () => {
  it('owns the venue feeds supplied by the composition root', () => {
    const feed = new TestVenueFeed(makeIndex());
    const logic = new WSVenueLogic([feed]);

    expect(logic.feeds).toEqual([feed]);
  });
});
