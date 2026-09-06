import { InjectQueue } from '@nestjs/bullmq';
import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnApplicationShutdown,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import { VenueConnector } from './ccxt/connector';
import { ClusterIndexBuilder } from './engine/ClusterIndexBuilder';
import { Engine } from './engine/Engine';
import {
  OPPORTUNITY_CLOSED_QUEUE,
  type OpportunityClosedJob,
} from './engine/OpportunityWorker';
import { createVenueIndexMap } from './engine/shared';
import type { ClusterIndex, Venue } from './engine/types';
import { VENUE_REGISTRY } from './venues/registry';
import type { VenueFeed } from './ws/VenueFeed';

const SWEEP_INTERVAL_MS = 1_000;

type Run = {
  venues: Venue[];
  clusterIndex: ClusterIndex;
  engine: Engine;
  feeds: VenueFeed[];
  sweepTimer: NodeJS.Timeout;
  startedAt: number;
};

export type OrchestratorStatus = {
  running: boolean;
  startedAt: number | null;
  clusters: number;
  venues: { id: string; markets: number }[];
};

@Injectable()
export class Orchestrator
  implements OnApplicationBootstrap, OnApplicationShutdown
{
  private readonly logger = new Logger(Orchestrator.name);

  // Later this will be a db query
  private activeVenues: string[] = [
    'binance',
    'bybit',
    'okx',
    'krakenfutures',
    'coinbase',
  ];

  private run: Run | null = null;
  private starting = false;

  constructor(
    @InjectQueue(OPPORTUNITY_CLOSED_QUEUE)
    private readonly queue: Queue<OpportunityClosedJob>,
  ) {}

  async onApplicationBootstrap(): Promise<void> {
    await this.start();
  }

  onApplicationShutdown(): void {
    this.stop();
  }

  async start(): Promise<void> {
    if (this.run !== null || this.starting) {
      this.logger.warn('start ignored: a run is already active');
      return;
    }

    this.starting = true;

    try {
      const venues = await this.loadVenues();

      if (venues.length < 2) {
        throw new Error(
          `${venues.length} venue(s) loaded, arbitrage needs at least 2`,
        );
      }

      const venueIndexMap = createVenueIndexMap(venues);
      const builder = new ClusterIndexBuilder(venues, venueIndexMap);
      const clusterIndex: ClusterIndex = {
        clusters: builder.clusters,
        clusterByRawMarketId: builder.clusterByRawMarketId,
        venueIndexMap,
      };

      const engine = new Engine(clusterIndex, venueIndexMap, this.queue);
      const feeds = this.createFeeds(venues, engine);

      if (feeds.length < 2) {
        throw new Error(
          `${feeds.length} feed(s) created, arbitrage needs at least 2`,
        );
      }

      for (const feed of feeds) {
        feed.start();
      }

      const sweepTimer = setInterval(
        () => this.sweep(engine),
        SWEEP_INTERVAL_MS,
      );

      this.run = {
        venues,
        clusterIndex,
        engine,
        feeds,
        sweepTimer,
        startedAt: Date.now(),
      };

      this.logger.log({
        event: 'orchestrator_started',
        venues: venues.map((venue) => venue.id),
        markets: venues.reduce((sum, venue) => sum + venue.markets.length, 0),
        clusters: clusterIndex.clusters.length,
      });
    } catch (e) {
      this.logger.fatal(`start failed: ${(e as Error).message}`);
      throw e;
    } finally {
      this.starting = false;
    }
  }

  stop(): void {
    const run = this.run;
    if (run === null) {
      return;
    }

    this.run = null;
    clearInterval(run.sweepTimer);

    for (const feed of run.feeds) {
      feed.stop();
    }

    this.logger.log({
      event: 'orchestrator_stopped',
      venues: run.venues.map((venue) => venue.id),
      upMs: Date.now() - run.startedAt,
    });
  }

  status(): OrchestratorStatus {
    const run = this.run;

    if (run === null) {
      return { running: false, startedAt: null, clusters: 0, venues: [] };
    }

    return {
      running: true,
      startedAt: run.startedAt,
      clusters: run.clusterIndex.clusters.length,
      venues: run.venues.map((venue) => ({
        id: venue.id,
        markets: venue.markets.length,
      })),
    };
  }

  private async loadVenues(): Promise<Venue[]> {
    const loaded = await Promise.all(
      this.activeVenues.map((venueId) => this.loadVenue(venueId)),
    );

    return loaded.filter((venue) => venue !== null);
  }

  private async loadVenue(venueId: string): Promise<Venue | null> {
    const registration = VENUE_REGISTRY[venueId];

    if (registration === undefined) {
      this.logger.error(`${venueId} has no feed implementation; skipping it`);
      return null;
    }

    return new VenueConnector(
      registration.createExchange(),
      registration,
    ).loadVenue();
  }

  private createFeeds(venues: Venue[], engine: Engine): VenueFeed[] {
    const feeds: VenueFeed[] = [];

    for (const venue of venues) {
      const registration = VENUE_REGISTRY[venue.id];

      if (registration === undefined) {
        this.logger.error(
          `${venue.id} has no feed implementation; skipping it`,
        );
        continue;
      }

      const markets = venue.markets.filter((market) =>
        engine.tracks(venue.id, market.rawMarketId),
      );

      if (markets.length === 0) {
        this.logger.error(`${venue.id} shares no cluster with another venue`);
        continue;
      }

      this.logger.log(
        `${venue.id}: streaming ${markets.length} of ${venue.markets.length} markets`,
      );

      feeds.push(registration.createFeed({ ...venue, markets }, engine));
    }

    return feeds;
  }

  private sweep(engine: Engine): void {
    try {
      const closed = engine.sweep(Date.now());

      if (closed > 0) {
        this.logger.log({ event: 'sweep_closed_opportunities', closed });
      }
    } catch (e) {
      this.logger.error(`sweep failed: ${(e as Error).message}`);
    }
  }
}
