import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { toOpportunityRow } from '../db/conversion';
import {
  OPPORTUNITY_CLOSED_JOB,
  type OpportunityClosedJob,
} from './OpportunityWorker';
import type {
  Cluster,
  Opportunity,
  PairKey,
  Observation,
  ActiveOpportunityMap,
  Market,
} from './types';

const MIN_NET_PPM = 5_000; // after fees
const CLOSURE_NET_PPM = 1_000; // after fees
const MAX_QUOTE_AGE_MS = 5_000;
const MAX_OPPORTUNITY_AGE_MS = 5 * 60_000;

export class OpportunityManager {
  private logger = new Logger(OpportunityManager.name);
  private activeOpportunityMap: ActiveOpportunityMap = new Map();

  // Optional so the engine still runs without Redis, for example in the specs.
  constructor(private readonly queue?: Queue<OpportunityClosedJob>) {}

  validate(cluster: Cluster, venueIndex: number, now: number): void | null {
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
    const highestBidResult = this.getEffectiveHighestBid(cluster, now);
    const lowestAskResult = this.getEffectiveLowestAsk(cluster, now);

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

    if (this.doesOpportunityAlreadyExist(cluster.pair, highestBidMarket, lowestAskMarket)) {
      // Already tracked. The loop above fed it on this tick if one of its legs moved
      return null;
    }

    const netPpm = (highestBid / lowestAsk - 1) * 1_000_000;

    if (netPpm < MIN_NET_PPM) {
      return null;
    }

    this.logger.log(
      `Opportunity found between venues ${highestBidMarket.venueId} and ${lowestAskMarket.venueId} for ${lowestAskMarket.base} / ${lowestAskMarket.quote}: ${netPpm}ppm at ${new Date(now).toISOString()}`,
    );
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
      this.recordSample(existing, O.highestBid, O.lowestAsk, O.netPpm, O.now);
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

    return opportunities.has(this.getRouteKey(highestBidMarket, lowestAskMarket));
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

      ticksSinceStart: 1,
      netPpmSum: O.netPpm,
      peakNetPpm: O.netPpm,
      peakAt: O.now,
      peakHighestBid: O.highestBid,
      peakLowestAsk: O.lowestAsk,
      lastSeenAt: O.now,

      netPpmSeries: [O.netPpm],
      highestBidSeries: [O.highestBid],
      lowestAskSeries: [O.lowestAsk],
      sampleTs: [0],

      closedAt: null,
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
    const netPpm = (highestBid / lowestAsk - 1) * 1_000_000;

    this.recordSample(opportunity, highestBid, lowestAsk, netPpm, now);

    // Recorded first, so a collapsing tick ends the series and the close log sees it
    if (this.shouldOpportunityBeClosed(opportunity, cluster, now, netPpm)) {
      this.closeOpportunity(opportunity, cluster.pair, now);
    }
  }

  private recordSample(
    opportunity: Opportunity,
    highestBid: number,
    lowestAsk: number,
    netPpm: number,
    now: number,
  ): void {
    opportunity.ticksSinceStart += 1;
    opportunity.netPpmSum += netPpm;
    opportunity.lastSeenAt = now;

    if (netPpm > opportunity.peakNetPpm) {
      opportunity.peakNetPpm = netPpm;
      opportunity.peakAt = now;
      opportunity.peakHighestBid = highestBid;
      opportunity.peakLowestAsk = lowestAsk;
    }

    opportunity.netPpmSeries.push(netPpm);
    opportunity.highestBidSeries.push(highestBid);
    opportunity.lowestAskSeries.push(lowestAsk);
    opportunity.sampleTs.push(now - opportunity.openedAt);
  }

  shouldOpportunityBeClosed(
    opportunity: Opportunity,
    cluster: Cluster,
    now: number,
    netPpm: number,
  ): boolean {
    const bidIndex = opportunity.highestBidVenueIndex;
    const askIndex = opportunity.lowestAskVenueIndex;

    if (
      now - cluster.recvTs[bidIndex] > MAX_QUOTE_AGE_MS ||
      now - cluster.recvTs[askIndex] > MAX_QUOTE_AGE_MS
    ) {
      return true;
    }

    if (
      cluster.markets[bidIndex] === null ||
      cluster.markets[askIndex] === null ||
      cluster.bid[bidIndex] <= 0 ||
      cluster.ask[askIndex] <= 0
    ) {
      return true;
    }

    if (now - opportunity.openedAt > MAX_OPPORTUNITY_AGE_MS) {
      return true;
    }

    return netPpm < CLOSURE_NET_PPM;
  }

  
  sweep(now: number): Opportunity[] {
    return this.closeWhere(
      now,
      (opportunity) => now - opportunity.lastSeenAt > MAX_QUOTE_AGE_MS,
    );
  }

  // Closes every open route with a leg on the venue, e.g. when its socket dies.
  closeVenue(venueId: string, now: number): Opportunity[] {
    return this.closeWhere(
      now,
      (opportunity) =>
        opportunity.highestBidMarket.venueId === venueId ||
        opportunity.lowestAskMarket.venueId === venueId,
    );
  }

  private closeWhere(
    now: number,
    shouldClose: (opportunity: Opportunity) => boolean,
  ): Opportunity[] {
    const closed: Opportunity[] = [];

    for (const [pair, routes] of this.activeOpportunityMap) {
      for (const opportunity of routes.values()) {
        if (!shouldClose(opportunity)) continue;

        if (this.closeOpportunity(opportunity, pair, now)) {
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
  ): boolean {
    if (opportunity.closedAt !== null) {
      this.logger.error(
        `Opportunity for ${pair} at ${now} wasn't closed because it's already closed`,
      );
      return false;
    }

    opportunity.closedAt = now;

    const routeKey = this.getRouteKey(
      opportunity.highestBidMarket,
      opportunity.lowestAskMarket,
    );

    this.activeOpportunityMap.get(pair)?.delete(routeKey);

    this.logger.log({
      event: 'opportunity_closed',
      pair,
      route: routeKey,
      durationMs: opportunity.closedAt - opportunity.openedAt,
      ticks: opportunity.ticksSinceStart,
      netPpmAtOpen: opportunity.netPpmAtOpen,
      meanNetPpm: opportunity.netPpmSum / opportunity.ticksSinceStart,
      peakNetPpm: opportunity.peakNetPpm,
      peakAt: opportunity.peakAt,
    });

    this.enqueueClosed(opportunity, pair, routeKey);

    return true;
  }

  // Never awaited. Awaiting Redis here would make the whole tick a promise chain, and another quote could mutate the cluster halfway through it.
  private enqueueClosed(
    opportunity: Opportunity,
    pair: PairKey,
    route: string,
  ): void {
    if (this.queue === undefined) return;

    const rows = [toOpportunityRow(opportunity, pair, route)];

    void this.queue
      .add(OPPORTUNITY_CLOSED_JOB, { rows })
      .catch((error: Error) => {
        this.logger.error({
          event: 'opportunity_enqueue_failed',
          pair,
          route,
          error: error.message,
        });
      });
  }

  getRouteKey(
    highestBidMarket: Market,
    lowestAskMarket: Market,
  ): string {
    return `${highestBidMarket.venueId}-${lowestAskMarket.venueId}`;
  }


  private getEffectiveHighestBid(
    cluster: Cluster,
    now: number,
  ): { index: number; value: number } | null {
    let highest = 0;
    let index = -1;

    for (let i = 0; i < cluster.bid.length; i++) {
      if (now - cluster.recvTs[i] > MAX_QUOTE_AGE_MS) continue;

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
    now: number,
  ): { index: number; value: number } | null {
    let lowest = Infinity;
    let index = -1;

    for (let i = 0; i < cluster.ask.length; i++) {
      if (now - cluster.recvTs[i] > MAX_QUOTE_AGE_MS) continue;

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
