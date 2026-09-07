import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { toOpportunityRow } from '../db/conversion';
import {
  OPPORTUNITY_CLOSED_JOB,
  type OpportunityClosedJob,
} from './OpportunityWorker';
import type {
  ActiveOpportunityMap,
  CloseReason,
  Cluster,
  Market,
  Observation,
  Opportunity,
  PairKey,
} from './types';

const MIN_NET_PPM = 5_000; // after fees
const MAX_PLAUSIBLE_NET_PPM = 100_000;
const CLOSURE_NET_PPM = 1_000; // after fees
const MAX_OPPORTUNITY_AGE_MS = 5 * 60_000;
// A route that never collapses runs to MAX_OPPORTUNITY_AGE_MS, which at the 436 samples/s seen on OPENAI is 130k samples. The counters keep going past this, only the series stop.
export const MAX_SERIES_LENGTH = 10_000;

const IMPLAUSIBLE_NET_PPM_WARN_WINDOW_MS = 10_000;

type ImplausibleNetPpmWarnState = {
  occurrenceCount: number; // rejections seen for this route since the engine started
  suppressedCount: number; // rejections swallowed since the last warning
  lastWarnedAt: number;
};

export class OpportunityManager {
  private logger = new Logger(OpportunityManager.name);
  private activeOpportunityMap: ActiveOpportunityMap = new Map();
  private readonly implausibleNetPpmWarnStates = new Map<
    string,
    ImplausibleNetPpmWarnState
  >();
  private readonly pendingWrites = new Set<Promise<void>>(); // queue writes in flight, so shutdown can wait for them

  constructor(private readonly queue: Queue<OpportunityClosedJob>) {}

  validate(
    cluster: Cluster,
    venueIndex: number,
    now: number,
  ): Opportunity | null {
    const routes = this.activeOpportunityMap.get(cluster.pair);

    if (routes !== undefined) {
      for (const opportunity of routes.values()) {
        const b = opportunity.highestBidVenueIndex;
        const a = opportunity.lowestAskVenueIndex;
        if (b !== venueIndex && a !== venueIndex) continue;
        this.updateOpportunity(opportunity, cluster, now);
      }
    }

    // The cluster-wide scan only discovers. It never updates.
    const highestBidResult = this.getEffectiveHighestBid(cluster);
    const lowestAskResult = this.getEffectiveLowestAsk(cluster);

    if (highestBidResult === null || lowestAskResult === null) {
      return null;
    }

    const { index: highestBidIndex, value: highestBid } = highestBidResult;
    const { index: lowestAskIndex, value: lowestAsk } = lowestAskResult;

    if (highestBidIndex === lowestAskIndex) {
      return null;
    }

    const highestBidMarket = cluster.markets[highestBidIndex];
    const lowestAskMarket = cluster.markets[lowestAskIndex];

    if (highestBidMarket === null || lowestAskMarket === null) {
      return null;
    }

    if (
      this.doesOpportunityAlreadyExist(
        cluster.pair,
        highestBidMarket,
        lowestAskMarket,
      )
    ) {
      // Already tracked. The loop above fed it on this tick if one of its legs moved
      return null;
    }

    const netPpm = (highestBid / lowestAsk - 1) * 1_000_000;

    if (netPpm < MIN_NET_PPM) {
      return null;
    }

    if (netPpm > MAX_PLAUSIBLE_NET_PPM) {
      this.reportImplausibleNetPpm(
        cluster,
        highestBidMarket,
        lowestAskMarket,
        highestBid,
        lowestAsk,
        netPpm,
        now,
      );
      return null;
    }

    const b = highestBidIndex;
    const a = lowestAskIndex;
    const highestBidSize = cluster.bidSize[b] * cluster.sizeMul[b];
    const lowestAskSize = cluster.askSize[a] * cluster.sizeMul[a];
    const highestBidLegAsk = cluster.ask[b] * cluster.askMul[b];
    const lowestAskLegBid = cluster.bid[a] * cluster.bidMul[a];

    this.logger.log(
      `Opportunity found between venues ${highestBidMarket.venueId} and ${lowestAskMarket.venueId} for ${lowestAskMarket.base} / ${lowestAskMarket.quote}: ${netPpm}ppm at ${new Date(now).toISOString()}, ${highestBidSize} coins at the bid and ${lowestAskSize} at the ask`,
    );

    return this.trackOpportunity({
      cluster,
      highestBid,
      lowestAsk,
      highestBidSize,
      lowestAskSize,
      highestBidLegAsk,
      lowestAskLegBid,
      netPpm,
      highestBidMarket,
      lowestAskMarket,
      highestBidVenueIndex: highestBidIndex,
      lowestAskVenueIndex: lowestAskIndex,
      now,
    });
  }

  trackOpportunity(O: Observation): Opportunity {
    const routeKey = this.getRouteKey(O.highestBidMarket, O.lowestAskMarket);
    let routes = this.activeOpportunityMap.get(O.cluster.pair);

    if (routes === undefined) {
      routes = new Map();
      this.activeOpportunityMap.set(O.cluster.pair, routes);
    }

    const existing = routes.get(routeKey);

    if (existing !== undefined) {
      this.recordSample(
        existing,
        O.highestBid,
        O.lowestAsk,
        O.highestBidSize,
        O.lowestAskSize,
        O.highestBidLegAsk,
        O.lowestAskLegBid,
        O.netPpm,
        O.now,
      );
      return existing;
    }

    const opportunity = this.createNewOpportunity(O);
    routes.set(routeKey, opportunity);
    return opportunity;
  }

  doesOpportunityAlreadyExist(
    pair: PairKey,
    highestBidMarket: Market,
    lowestAskMarket: Market,
  ): boolean {
    const opportunities = this.activeOpportunityMap.get(pair);

    if (opportunities === undefined || opportunities.size === 0) {
      return false;
    }

    return opportunities.has(
      this.getRouteKey(highestBidMarket, lowestAskMarket),
    );
  }

  createNewOpportunity(O: Observation): Opportunity {
    return {
      highestBidMarket: O.highestBidMarket,
      lowestAskMarket: O.lowestAskMarket,

      highestBidVenueIndex: O.highestBidVenueIndex,
      lowestAskVenueIndex: O.lowestAskVenueIndex,

      openedAt: O.now,
      netPpmAtOpen: O.netPpm,
      highestBidAtOpen: O.highestBid,
      lowestAskAtOpen: O.lowestAsk,
      highestBidSizeAtOpen: O.highestBidSize,
      lowestAskSizeAtOpen: O.lowestAskSize,
      highestBidLegAskAtOpen: O.highestBidLegAsk,
      lowestAskLegBidAtOpen: O.lowestAskLegBid,

      ticksSinceStart: 1,
      netPpmSum: O.netPpm,
      peakNetPpm: O.netPpm,
      peakAt: O.now,
      peakHighestBid: O.highestBid,
      peakLowestAsk: O.lowestAsk,
      peakHighestBidSize: O.highestBidSize,
      peakLowestAskSize: O.lowestAskSize,
      peakHighestBidLegAsk: O.highestBidLegAsk,
      peakLowestAskLegBid: O.lowestAskLegBid,
      minNetPpm: O.netPpm,
      lastSeenAt: O.now,
      lastNetPpm: O.netPpm,
      lastHighestBidSize: O.highestBidSize,
      lastLowestAskSize: O.lowestAskSize,
      lastHighestBidLegAsk: O.highestBidLegAsk,
      lastLowestAskLegBid: O.lowestAskLegBid,

      netPpmSeries: [O.netPpm],
      highestBidSeries: [O.highestBid],
      lowestAskSeries: [O.lowestAsk],
      sampleTs: [0],

      closedAt: null,
      closeReason: null,
    };
  }

  // Re-reads an open route from its own two legs, records the sample, then decides whether it closes
  updateOpportunity(
    opportunity: Opportunity,
    cluster: Cluster,
    now: number,
  ): void {
    const b = opportunity.highestBidVenueIndex;
    const a = opportunity.lowestAskVenueIndex;
    const highestBid = cluster.bid[b] * cluster.bidMul[b];
    const lowestAsk = cluster.ask[a] * cluster.askMul[a];
    const highestBidSize = cluster.bidSize[b] * cluster.sizeMul[b];
    const lowestAskSize = cluster.askSize[a] * cluster.sizeMul[a];
    const highestBidLegAsk = cluster.ask[b] * cluster.askMul[b];
    const lowestAskLegBid = cluster.bid[a] * cluster.bidMul[a];
    const netPpm = (highestBid / lowestAsk - 1) * 1_000_000;

    this.recordSample(
      opportunity,
      highestBid,
      lowestAsk,
      highestBidSize,
      lowestAskSize,
      highestBidLegAsk,
      lowestAskLegBid,
      netPpm,
      now,
    );

    // Recorded first, so a collapsing tick ends the series and the close log sees it
    const reason = this.closeReasonFor(opportunity, cluster, now, netPpm);

    if (reason !== null) {
      this.closeOpportunity(opportunity, cluster.pair, now, reason);
    }
  }

  private reportImplausibleNetPpm(
    cluster: Cluster,
    highestBidMarket: Market,
    lowestAskMarket: Market,
    highestBid: number,
    lowestAsk: number,
    netPpm: number,
    now: number,
  ): void {
    const route = this.getRouteKey(highestBidMarket, lowestAskMarket);
    const key = `${cluster.pair}|${route}`;
    let state = this.implausibleNetPpmWarnStates.get(key);

    if (state === undefined) {
      state = {
        occurrenceCount: 0,
        suppressedCount: 0,
        lastWarnedAt: Number.NEGATIVE_INFINITY,
      };
      this.implausibleNetPpmWarnStates.set(key, state);
    }

    state.occurrenceCount += 1;

    if (now - state.lastWarnedAt < IMPLAUSIBLE_NET_PPM_WARN_WINDOW_MS) {
      state.suppressedCount += 1;
      return;
    }

    this.logger.warn({
      event: 'opportunity_rejected',
      reason: 'implausible_net_ppm',
      pair: cluster.pair,
      route,
      netPpm,
      maxPlausibleNetPpm: MAX_PLAUSIBLE_NET_PPM,
      highestBid,
      lowestAsk,
      occurrenceCount: state.occurrenceCount,
      suppressedCount: state.suppressedCount,
    });

    state.lastWarnedAt = now;
    state.suppressedCount = 0;
  }

  private recordSample(
    opportunity: Opportunity,
    highestBid: number,
    lowestAsk: number,
    highestBidSize: number,
    lowestAskSize: number,
    highestBidLegAsk: number,
    lowestAskLegBid: number,
    netPpm: number,
    now: number,
  ): void {
    opportunity.ticksSinceStart += 1;
    opportunity.netPpmSum += netPpm;
    opportunity.lastSeenAt = now;
    opportunity.lastNetPpm = netPpm;
    opportunity.lastHighestBidSize = highestBidSize;
    opportunity.lastLowestAskSize = lowestAskSize;
    opportunity.lastHighestBidLegAsk = highestBidLegAsk;
    opportunity.lastLowestAskLegBid = lowestAskLegBid;

    if (netPpm > opportunity.peakNetPpm) {
      opportunity.peakNetPpm = netPpm;
      opportunity.peakAt = now;
      opportunity.peakHighestBid = highestBid;
      opportunity.peakLowestAsk = lowestAsk;
      opportunity.peakHighestBidSize = highestBidSize;
      opportunity.peakLowestAskSize = lowestAskSize;
      opportunity.peakHighestBidLegAsk = highestBidLegAsk;
      opportunity.peakLowestAskLegBid = lowestAskLegBid;
    }

    if (netPpm < opportunity.minNetPpm) {
      opportunity.minNetPpm = netPpm;
    }

    if (opportunity.netPpmSeries.length >= MAX_SERIES_LENGTH) {
      return;
    }

    opportunity.netPpmSeries.push(netPpm);
    opportunity.highestBidSeries.push(highestBid);
    opportunity.lowestAskSeries.push(lowestAsk);
    opportunity.sampleTs.push(now - opportunity.openedAt);
  }

  // Silence is not on this list. Every feed is change-driven, so a quiet leg is an unchanged leg, and a dead one is reported by markStale.
  closeReasonFor(
    opportunity: Opportunity,
    cluster: Cluster,
    now: number,
    netPpm: number,
  ): CloseReason | null {
    const bidIndex = opportunity.highestBidVenueIndex;
    const askIndex = opportunity.lowestAskVenueIndex;

    // closeOpportunitiesOnVenue closes these itself. This only guards the invariant that an open route has two live legs
    if (cluster.recvTs[bidIndex] <= 0 || cluster.recvTs[askIndex] <= 0) {
      return 'feed_down';
    }

    if (netPpm < CLOSURE_NET_PPM) {
      return 'spread_collapsed';
    }

    if (now - opportunity.openedAt >= MAX_OPPORTUNITY_AGE_MS) {
      return 'age_cap';
    }

    return null;
  }

  // The age cap needs a timer. A route whose legs stop changing has no tick left to reach it.
  sweep(now: number): Opportunity[] {
    return this.closeOpportunitiesWhere(
      now,
      'age_cap',
      (opportunity) => now - opportunity.openedAt >= MAX_OPPORTUNITY_AGE_MS,
    );
  }

  // Closes every open opportunity on the pair with a leg on this venue, which is what a dying socket needs.
  closeOpportunitiesOnVenue(
    pair: PairKey,
    venueIndex: number,
    now: number,
  ): Opportunity[] {
    const routes = this.activeOpportunityMap.get(pair);

    if (routes === undefined) {
      return [];
    }

    const closed: Opportunity[] = [];

    for (const opportunity of routes.values()) {
      if (
        opportunity.highestBidVenueIndex !== venueIndex &&
        opportunity.lowestAskVenueIndex !== venueIndex
      ) {
        continue;
      }

      if (this.closeOpportunity(opportunity, pair, now, 'feed_down')) {
        closed.push(opportunity);
      }
    }

    if (routes.size === 0) {
      this.activeOpportunityMap.delete(pair);
    }

    return closed;
  }

  // Closes everything and waits for the queue, so a stop loses no episode. Returns how many it closed.
  async shutdown(now: number): Promise<number> {
    const closed = this.closeOpportunitiesWhere(now, 'shutdown', () => true);

    await Promise.allSettled([...this.pendingWrites]);

    return closed.length;
  }

  private closeOpportunitiesWhere(
    now: number,
    reason: CloseReason,
    shouldClose: (opportunity: Opportunity) => boolean,
  ): Opportunity[] {
    const closed: Opportunity[] = [];

    for (const [pair, routes] of this.activeOpportunityMap) {
      for (const opportunity of routes.values()) {
        if (!shouldClose(opportunity)) continue;

        if (this.closeOpportunity(opportunity, pair, now, reason)) {
          closed.push(opportunity);
        }
      }

      if (routes.size === 0) {
        this.activeOpportunityMap.delete(pair);
      }
    }

    return closed;
  }

  // Returns whether this call is the one that closed the route.
  closeOpportunity(
    opportunity: Opportunity,
    pair: PairKey,
    now: number,
    reason: CloseReason,
  ): boolean {
    if (opportunity.closedAt !== null) {
      this.logger.error(
        `Opportunity for ${pair} at ${now} wasn't closed because it's already closed`,
      );
      return false;
    }

    opportunity.closedAt = now;
    opportunity.closeReason = reason;

    const routeKey = this.getRouteKey(
      opportunity.highestBidMarket,
      opportunity.lowestAskMarket,
    );

    this.activeOpportunityMap.get(pair)?.delete(routeKey);

    this.logger.log({
      event: 'opportunity_closed',
      pair,
      route: routeKey,
      reason,
      durationMs: opportunity.closedAt - opportunity.openedAt,
      ticks: opportunity.ticksSinceStart,
      netPpmAtOpen: opportunity.netPpmAtOpen,
      meanNetPpm: opportunity.netPpmSum / opportunity.ticksSinceStart,
      peakNetPpm: opportunity.peakNetPpm,
      peakAt: opportunity.peakAt,
      minNetPpm: opportunity.minNetPpm,
    });

    this.enqueueClosed(opportunity, pair, routeKey);

    return true;
  }

  // Never awaited on the tick path. Awaiting Redis here would make the whole tick a promise chain, and another quote could mutate the cluster halfway through it.
  // The promise is kept so shutdown can wait for it.
  private enqueueClosed(
    opportunity: Opportunity,
    pair: PairKey,
    route: string,
  ): void {
    if (this.queue === undefined) {
      this.logger.error(`Queue was undefined during closing process`);
      return;
    }

    const rows = [toOpportunityRow(opportunity, pair, route)];

    const write: Promise<void> = this.queue
      .add(OPPORTUNITY_CLOSED_JOB, { rows })
      .then(
        () => undefined,
        (error: Error) => {
          this.logger.error({
            event: 'opportunity_enqueue_failed',
            pair,
            route,
            error: error.message,
          });
        },
      )
      .finally(() => {
        this.pendingWrites.delete(write);
      });

    this.pendingWrites.add(write);
  }

  getRouteKey(highestBidMarket: Market, lowestAskMarket: Market): string {
    return `${highestBidMarket.venueId}-${lowestAskMarket.venueId}`;
  }

  private getEffectiveHighestBid(
    cluster: Cluster,
  ): { index: number; value: number } | null {
    let highest = 0;
    let index = -1;

    for (let i = 0; i < cluster.bid.length; i++) {
      if (cluster.recvTs[i] <= 0) continue;

      const bidAfterFees = cluster.bid[i] * cluster.bidMul[i];

      if (bidAfterFees > highest) {
        highest = bidAfterFees;
        index = i;
      }
    }

    if (highest === 0) {
      return null;
    }

    return { index, value: highest };
  }

  private getEffectiveLowestAsk(
    cluster: Cluster,
  ): { index: number; value: number } | null {
    let lowest = Infinity;
    let index = -1;

    for (let i = 0; i < cluster.ask.length; i++) {
      if (cluster.recvTs[i] <= 0) continue;

      const ask = cluster.ask[i];
      const askAfterFees = ask * cluster.askMul[i];

      if (ask > 0 && askAfterFees < lowest) {
        lowest = askAfterFees;
        index = i;
      }
    }

    if (lowest === Infinity) {
      return null;
    }

    return { index, value: lowest };
  }
}
