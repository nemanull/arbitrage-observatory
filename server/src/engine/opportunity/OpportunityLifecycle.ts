import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { toOpportunityRow } from '../../db/conversion';
import { readAnchorPair } from './anchorReading';
import { walkLadders } from './ladderWalk';
import {
  OPPORTUNITY_CLOSED_JOB,
  type OpportunityClosedJob,
} from './OpportunityWorker';
import type { Cluster, Market, PairKey } from '../cluster/types';
import type {
  ActiveOpportunityMap,
  AnchorPair,
  CloseReason,
  EdgeSample,
  Observation,
  Opportunity,
} from './types';

const CLOSURE_NET_PPM = 1_000; // after fees
const MAX_OPPORTUNITY_AGE_MS = 5 * 60_000;
// A route that never collapses runs to MAX_OPPORTUNITY_AGE_MS, which at the 436 samples/s seen on OPENAI is 130k samples. The counters keep going past this, only the series stop.
export const MAX_SERIES_LENGTH = 10_000;
// A real average edge or notional is never negative, so this marks a sample where a leg held no depth in the edge series.
export const NO_EDGE = -1;
// A fresh edge is never under minus one million ppm, since a price ratio cannot be negative, so this marks a sample where no anchor could be read.
export const NO_ANCHOR = -2_000_000;

export class OpportunityLifecycle {
  private logger = new Logger(OpportunityLifecycle.name);
  private activeOpportunityMap: ActiveOpportunityMap = new Map();
  private readonly pendingWrites = new Set<Promise<void>>(); // queue writes in flight, so shutdown can wait for them

  constructor(private readonly queue: Queue<OpportunityClosedJob>) {}

  updateOpportunitiesOnVenue(
    cluster: Cluster,
    venueIndex: number,
    now: number,
  ): void {
    const routes = this.activeOpportunityMap.get(cluster.pair);

    if (routes === undefined) {
      return;
    }

    for (const opportunity of routes.values()) {
      const b = opportunity.highestBidVenueIndex;
      const a = opportunity.lowestAskVenueIndex;
      if (b !== venueIndex && a !== venueIndex) continue;
      this.updateOpportunity(opportunity, cluster, now);
    }
  }

  trackOpportunity(O: Observation): Opportunity {
    const routeKey = getRouteKey(O.highestBidMarket, O.lowestAskMarket);
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
        walkLadders(O.cluster, O.lowestAskVenueIndex, O.highestBidVenueIndex),
        O.anchor,
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

    return opportunities.has(getRouteKey(highestBidMarket, lowestAskMarket));
  }

  createNewOpportunity(O: Observation): Opportunity {
    const edge = walkLadders(
      O.cluster,
      O.lowestAskVenueIndex,
      O.highestBidVenueIndex,
    );

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
      edgeAvgPpmSeries: [edge?.avgPpm ?? NO_EDGE],
      edgeNotionalSeries: [edge?.notional ?? NO_EDGE],

      anchorAtOpen: O.anchor,
      peakAnchor: O.anchor,
      lastAnchor: O.anchor,
      freshNetPpmSeries: [O.anchor.freshNetPpm],
      anchorTsMs: [0],
      highestBidIndexSeries: [O.anchor.sell.index],
      highestBidMarkSeries: [O.anchor.sell.mark],
      lowestAskIndexSeries: [O.anchor.buy.index],
      lowestAskMarkSeries: [O.anchor.buy.mark],

      edgeAtOpen: edge,
      peakEdge: edge,
      peakEdgeAt: O.now,
      maxEdgeNotional: edge?.notional ?? 0,
      lastEdge: edge,
      edgeSamples: edge === null ? 0 : 1,

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
    const anchorRead = readAnchorPair(
      cluster,
      b,
      a,
      opportunity.highestBidMarket,
      opportunity.lowestAskMarket,
      netPpm,
      now,
    );
    const anchor = typeof anchorRead === 'string' ? null : anchorRead;

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
      walkLadders(cluster, a, b),
      anchor,
    );

    // Recorded first, so a collapsing tick ends the series and the close log sees it
    const reason = this.closeReasonFor(
      opportunity,
      cluster,
      now,
      netPpm,
      anchor,
    );

    if (reason !== null) {
      this.closeOpportunity(opportunity, cluster.pair, now, reason);
    }
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
    edge: EdgeSample | null,
    anchor: AnchorPair | null,
  ): void {
    opportunity.ticksSinceStart += 1;
    opportunity.netPpmSum += netPpm;
    opportunity.lastSeenAt = now;
    opportunity.lastNetPpm = netPpm;
    opportunity.lastHighestBidSize = highestBidSize;
    opportunity.lastLowestAskSize = lowestAskSize;
    opportunity.lastHighestBidLegAsk = highestBidLegAsk;
    opportunity.lastLowestAskLegBid = lowestAskLegBid;
    opportunity.lastEdge = edge;
    opportunity.lastAnchor = anchor;

    if (anchor !== null) {
      recordAnchorChange(opportunity, anchor, now);
    }

    if (edge !== null) {
      opportunity.edgeSamples += 1;

      if (edge.notional > opportunity.maxEdgeNotional) {
        opportunity.maxEdgeNotional = edge.notional;
      }

      if (
        opportunity.peakEdge === null ||
        edge.avgPpm > opportunity.peakEdge.avgPpm
      ) {
        opportunity.peakEdge = edge;
        opportunity.peakEdgeAt = now;
      }
    }

    if (netPpm > opportunity.peakNetPpm) {
      opportunity.peakNetPpm = netPpm;
      opportunity.peakAt = now;
      opportunity.peakHighestBid = highestBid;
      opportunity.peakLowestAsk = lowestAsk;
      opportunity.peakHighestBidSize = highestBidSize;
      opportunity.peakLowestAskSize = lowestAskSize;
      opportunity.peakHighestBidLegAsk = highestBidLegAsk;
      opportunity.peakLowestAskLegBid = lowestAskLegBid;
      opportunity.peakAnchor = anchor;
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
    opportunity.edgeAvgPpmSeries.push(edge?.avgPpm ?? NO_EDGE);
    opportunity.edgeNotionalSeries.push(edge?.notional ?? NO_EDGE);
    opportunity.freshNetPpmSeries.push(anchor?.freshNetPpm ?? NO_ANCHOR);
  }

  // Silence is not on this list. Every feed is change-driven, so a quiet leg is an unchanged leg, and a dead one is reported by markStale.
  closeReasonFor(
    opportunity: Opportunity,
    cluster: Cluster,
    now: number,
    netPpm: number,
    anchor: AnchorPair | null, // null when this sample's anchors could not be read, which closes nothing
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

    // A basis keeps the raw cross open for as long as it stands, so the raw rule alone runs it to the age cap.
    if (anchor !== null && anchor.freshNetPpm < CLOSURE_NET_PPM) {
      return 'fresh_edge_collapsed';
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

    const routeKey = getRouteKey(
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
      edgeAvgPpmAtOpen: opportunity.edgeAtOpen?.avgPpm ?? null,
      edgeNotionalAtOpen: opportunity.edgeAtOpen?.notional ?? null,
      peakEdgeAvgPpm: opportunity.peakEdge?.avgPpm ?? null,
      peakEdgeNotional: opportunity.peakEdge?.notional ?? null,
      maxEdgeNotional: opportunity.maxEdgeNotional,
      edgeSamples: opportunity.edgeSamples,
      freshNetPpmAtOpen: opportunity.anchorAtOpen?.freshNetPpm ?? null,
      standingPpmAtOpen: opportunity.anchorAtOpen?.standingPpm ?? null,
      indexGapPpmAtOpen: opportunity.anchorAtOpen?.indexGapPpm ?? null,
      carriedPpmAtOpen: opportunity.anchorAtOpen?.carriedPpm ?? null,
      freshNetPpmAtClose: opportunity.lastAnchor?.freshNetPpm ?? null,
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
}

export function getRouteKey(
  highestBidMarket: Market,
  lowestAskMarket: Market,
): string {
  return `${highestBidMarket.venueId}-${lowestAskMarket.venueId}`;
}

// The anchors change at most once a second, so the series takes an entry only when a value moved, and a poll that rewrote the same numbers adds nothing.
function recordAnchorChange(
  opportunity: Opportunity,
  anchor: AnchorPair,
  now: number,
): void {
  const last = opportunity.anchorTsMs.length - 1;

  if (
    last >= 0 &&
    opportunity.highestBidIndexSeries[last] === anchor.sell.index &&
    opportunity.highestBidMarkSeries[last] === anchor.sell.mark &&
    opportunity.lowestAskIndexSeries[last] === anchor.buy.index &&
    opportunity.lowestAskMarkSeries[last] === anchor.buy.mark
  ) {
    return;
  }

  opportunity.anchorTsMs.push(now - opportunity.openedAt);
  opportunity.highestBidIndexSeries.push(anchor.sell.index);
  opportunity.highestBidMarkSeries.push(anchor.sell.mark);
  opportunity.lowestAskIndexSeries.push(anchor.buy.index);
  opportunity.lowestAskMarkSeries.push(anchor.buy.mark);
}
