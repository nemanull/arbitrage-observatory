import {
  Market,
  Cluster,
  ClusterAnchor,
  ClusterDepth,
  ClusterIndex,
  ClusterByRawMarketId,
  VenueIndexMap,
  Venue,
  PairKey,
} from './types';
import { DENIED_PAIRS, PRICE_SCALE, getPriceScale } from './clusterOverrides';
import { clusterQuote, marketRank } from './quoteFamily';
import { Logger } from '@nestjs/common';

// Twenty covers the 0.5% band where an edge can still be positive on the finest-tick books, and sits inside what every venue returns cheaply.
export const DEPTH_LEVELS = 20;

export type ClusterIndexBuilderOptions = {
  depthLevels?: number;
};

export function createClusterDepth(
  width: number,
  levels: number,
): ClusterDepth {
  if (!Number.isInteger(levels) || levels < 1 || levels > 255) {
    throw new Error(
      `depth levels must be an integer from 1 to 255, got ${levels}`,
    );
  }

  return {
    maxLevels: levels,
    bidPrice: new Float64Array(width * levels),
    bidSize: new Float64Array(width * levels),
    askPrice: new Float64Array(width * levels),
    askSize: new Float64Array(width * levels),
    bidLevelCount: new Uint8Array(width),
    askLevelCount: new Uint8Array(width),
    writtenAt: new Float64Array(width),
  };
}

export function createClusterAnchor(width: number): ClusterAnchor {
  return {
    index: new Float64Array(width),
    mark: new Float64Array(width),
    fundingRate: new Float64Array(width),
    fundingIntervalHours: new Float64Array(width),
    nextFundingAt: new Float64Array(width),
    writtenAt: new Float64Array(width),
  };
}

export class ClusterIndexBuilder {
  private readonly logger: Logger = new Logger('ClusterIndex');

  public readonly venues: Venue[];
  public readonly venueIndexMap: VenueIndexMap;
  public readonly clusters: Cluster[];
  public readonly clusterByRawMarketId: ClusterByRawMarketId;
  public readonly depthLevels: number;

  constructor(
    venues: Venue[],
    venueIndexMap: VenueIndexMap,
    options: ClusterIndexBuilderOptions = {},
  ) {
    if (venues.length < 2) {
      throw new Error('At least 2 venues are required');
    }

    this.venues = venues;
    this.venueIndexMap = venueIndexMap;
    this.depthLevels = options.depthLevels ?? DEPTH_LEVELS;

    const pairMarkets = this.getPairMarkets();
    this.clusters = this.createClusters(pairMarkets);

    if (this.clusters.length === 0) {
      throw new Error(
        'No clusters could be built — check venue market ingestion',
      );
    }

    this.clusterByRawMarketId = this.createClusterByRawMarketIdMap(
      this.clusters,
    );

    this.logOverrides(pairMarkets);

    this.logger.log(
      `Built ${this.clusters.length} clusters across ${venues.length} venues`,
    );
  }

  createCluster(pair: PairKey, _markets: Market[]): Cluster | null {
    if (_markets.length == 0) {
      this.logger.warn(
        `An empty array of markets was provided to create a cluster`,
      );
      return null;
    }

    const width = this.venues.length;
    let marketCount = 0;

    const markets = new Array<Market | null>(width).fill(null);
    const bidMul = new Float64Array(width);
    const askMul = new Float64Array(width);
    const sizeMul = new Float64Array(width);

    for (const market of _markets) {
      const i = this.venueIndexMap.get(market.venueId);

      if (i === undefined) {
        this.logger.error(
          `Venue ${market.venueId} not found in venueIndexMap, cluster creation failed`,
        );
        return null;
      }
      if (markets[i] !== null) {
        this.logger.warn(
          `${pair}: duplicate ${market.venueId} market; keeping first`,
        );
        continue;
      }

      markets[i] = market;

      //Will be improved
      const scale = getPriceScale(market.venueId, market.rawMarketId);

      bidMul[i] = (1 - market.takerPpm / 1000000) * scale;
      askMul[i] = (1 + market.takerPpm / 1000000) * scale;
      sizeMul[i] = market.contractSize / scale;

      marketCount++;
    }

    if (marketCount < 2) {
      this.logger.log(
        `Cluster must contain at least 2 valid markets. Cluster for ${pair} was not created`,
      );
      return null;
    }

    const c: Cluster = {
      pair,
      markets,
      bidMul,
      askMul,
      sizeMul,
      bid: new Float64Array(width),
      ask: new Float64Array(width),
      bidSize: new Float64Array(width),
      askSize: new Float64Array(width),
      recvTs: new Float64Array(width),
      depth: createClusterDepth(width, this.depthLevels),
      anchor: createClusterAnchor(width),
    };

    return c;
  }

  createClusters(allPairs: Map<PairKey, Market[]>): Cluster[] {
    const clusters: Cluster[] = [];

    for (const pair of allPairs.keys()) {
      if (DENIED_PAIRS.has(pair)) {
        continue;
      }

      const markets = allPairs.get(pair);

      if (markets === undefined) {
        this.logger.error(`Markets for the pair ${pair} are undefined`);
        continue;
      }

      const c = this.createCluster(pair, markets);

      if (c !== null) {
        clusters.push(c);
      }
    }

    return clusters;
  }

  private logOverrides(pairMarkets: Map<PairKey, Market[]>): void {
    const denied = [...pairMarkets.keys()].filter((pair) =>
      DENIED_PAIRS.has(pair),
    );

    if (denied.length > 0) {
      this.logger.warn(
        `Denied ${denied.length} pair(s) as non-comparable clusters: ${denied.join(', ')}`,
      );
    }

    const scaled = PRICE_SCALE.filter((s) =>
      this.clusterByRawMarketId.get(s.venueId)?.has(s.rawMarketId),
    );

    if (scaled.length > 0) {
      this.logger.warn(
        `Applied ${scaled.length} hardcoded price scale(s): ${scaled
          .map((s) => `${s.venueId}/${s.rawMarketId} x${s.scale}`)
          .join(', ')}`,
      );
    }
  }

  createClusterIndex(Clusters: Cluster[]): ClusterIndex {
    const clusterByRawMarketId = this.createClusterByRawMarketIdMap(Clusters);

    return {
      clusters: Clusters,
      clusterByRawMarketId: clusterByRawMarketId,
      venueIndexMap: this.venueIndexMap,
    };
  }

  private getPairMarkets(): Map<PairKey, Market[]> {
    const pairs = new Map<PairKey, Market[]>();

    for (const v of this.venues) {
      for (const m of v.markets) {
        if (m.venueId !== v.id) {
          this.logger.error(
            `${v.id}/${m.rawMarketId} claims venueId ${m.venueId}; skipping`,
          );
          continue;
        }
        if (
          !m.base ||
          !m.quote ||
          m.base.includes('|') ||
          m.quote.includes('|')
        ) {
          this.logger.error(
            `${v.id}/${m.rawMarketId} has invalid symbol ${m.base}/${m.quote}; skipping`,
          );
          continue;
        }

        const pair = this.getPairFromRaw(m.base, m.quote);
        const markets = pairs.get(pair);

        if (markets === undefined) {
          pairs.set(pair, [m]);
          continue;
        }
        const twin = markets.findIndex((x) => x.venueId === m.venueId);

        if (twin === -1) {
          markets.push(m);
          continue;
        }

        const kept =
          marketRank(m) < marketRank(markets[twin]) ? m : markets[twin];
        const dropped = kept === m ? markets[twin] : m;
        markets[twin] = kept;
        this.logger.debug(
          `${pair}: ${m.venueId} keeps ${kept.rawMarketId} over ${dropped.rawMarketId}`,
        );
      }
    }

    if (pairs.size === 0) {
      throw new Error(
        'No valid pairs across any venue — check venue market ingestion',
      );
    }

    return pairs;
  }

  getPairFromRaw(base: string, quote: string): PairKey {
    return `${base}|${clusterQuote(quote)}`;
  }

  separatePairIntoRaw(pair: PairKey): { base: string; quote: string } {
    return { base: pair.split('|')[0], quote: pair.split('|')[1] };
  }

  private createClusterByRawMarketIdMap(
    clusters: Cluster[],
  ): ClusterByRawMarketId {
    const map: ClusterByRawMarketId = new Map();

    for (const v of this.venues) {
      map.set(v.id, new Map<string, Cluster>());
    }

    for (const c of clusters) {
      for (const [i, m] of c.markets.entries()) {
        if (m === null) {
          this.logger.debug(
            `${c.pair} is not listed on venue ${this.venues[i].id}`,
          );
          continue;
        }

        const marketClusterMap = map.get(m.venueId);
        if (marketClusterMap === undefined) {
          this.logger.error(
            `Unknown venue ${m.venueId} on market ${m.rawMarketId}; skipping`,
          );
          continue;
        }
        if (marketClusterMap.has(m.rawMarketId)) {
          this.logger.error(
            `${m.venueId}/${m.rawMarketId} already mapped; cluster ${c.pair} ignored`,
          );
          continue;
        }

        marketClusterMap.set(m.rawMarketId, c);
      }
    }

    return map;
  }
}
