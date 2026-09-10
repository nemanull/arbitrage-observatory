import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import { toOpportunityRow } from '../db/conversion';
import { readAnchorPair } from './anchorReading';
import { walkLadders } from './ladderWalk';
import {
  OPPORTUNITY_CLOSED_JOB,
  type OpportunityClosedJob,
} from './OpportunityWorker';
import type {
  ActiveOpportunityMap,
  AnchorPair,
  CloseReason,
  Cluster,
  EdgeSample,
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
// A real average edge or notional is never negative, so this marks a sample where a leg held no depth in the edge series.
export const NO_EDGE = -1;
// A fresh edge is never under minus one million ppm, since a price ratio cannot be negative, so this marks a sample where no anchor could be read.
export const NO_ANCHOR = -2_000_000;

const REJECTION_WARN_WINDOW_MS = 10_000;

// A route whose two venues chain their perps to different numbers never closes, docs/bestiary/standing-basis.md.
// Once the index gap has held past the tolerance for a minute of readable samples the route is set aside, and discovery skips it apart from one read a minute that can release it.
const INDEX_GAP_QUARANTINE_PPM = 20_000;
const INDEX_GAP_RELEASE_PPM = 10_000; // under the quarantine gap, so a route does not flap on the boundary
const QUARANTINE_AFTER_MS = 60_000;
const RELEASE_AFTER_MS = 5 * 60_000;
const QUARANTINE_RECHECK_MS = 60_000;

type IndexWatch = {
  apartSince: number; // first of the current run of readable samples over the quarantine gap, 0 when the last one was under
  togetherSince: number; // first of the current run under the release gap, 0 when the last one was over
  quarantinedAt: number; // 0 while the route is live
  checkedAt: number; // the last readable sample
  gapPpm: number;
};

type RejectionReason = 'implausible_net_ppm' | 'standing_basis';

type RejectionWarnState = {
  occurrenceCount: number; // rejections seen for this route and reason since the engine started
  suppressedCount: number; // rejections swallowed since the last warning
  lastWarnedAt: number;
};

export class OpportunityManager {
  private logger = new Logger(OpportunityManager.name);
  private activeOpportunityMap: ActiveOpportunityMap = new Map();
  private readonly rejectionWarnStates = new Map<string, RejectionWarnState>();
  private readonly indexWatches = new Map<string, IndexWatch>(); // keyed by pair and route
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

    const watchKey = `${cluster.pair}|${this.getRouteKey(highestBidMarket, lowestAskMarket)}`;

    if (this.skipsQuarantined(watchKey, now)) {
      return null;
    }

    const netPpm = (highestBid / lowestAsk - 1) * 1_000_000;

    if (netPpm < MIN_NET_PPM) {
      return null;
    }

    if (netPpm > MAX_PLAUSIBLE_NET_PPM) {
      this.reportRejection(
        'implausible_net_ppm',
        cluster,
        highestBidMarket,
        lowestAskMarket,
        now,
        {
          netPpm,
          maxPlausibleNetPpm: MAX_PLAUSIBLE_NET_PPM,
          highestBid,
          lowestAsk,
        },
      );
      return null;
    }

    const b = highestBidIndex;
    const a = lowestAskIndex;

    // A cross the two venues' own anchors already explain is a basis, docs/bestiary/standing-basis.md, and no taker cross captures it.
    // A route whose anchors cannot be read opens anyway and carries null, so a poller outage loses no episode and the row still says it was unjudged.
    const anchorRead = readAnchorPair(
      cluster,
      b,
      a,
      highestBidMarket,
      lowestAskMarket,
      netPpm,
      now,
    );
    const anchor = typeof anchorRead === 'string' ? null : anchorRead;
    const anchorIssue = typeof anchorRead === 'string' ? anchorRead : null;

    if (
      anchor !== null &&
      this.watchIndexGap(
        watchKey,
        cluster,
        anchor,
        b,
        a,
        highestBidMarket,
        lowestAskMarket,
        now,
      )
    ) {
      return null;
    }

    if (anchor !== null && anchor.freshNetPpm < MIN_NET_PPM) {
      this.reportRejection(
        'standing_basis',
        cluster,
        highestBidMarket,
        lowestAskMarket,
        now,
        {
          netPpm,
          freshNetPpm: anchor.freshNetPpm,
          standingPpm: anchor.standingPpm,
          sellPremium: anchor.sell.premium,
          buyPremium: anchor.buy.premium,
          sellIndex: anchor.sell.index,
          buyIndex: anchor.buy.index,
        },
      );
      return null;
    }

    const highestBidSize = cluster.bidSize[b] * cluster.sizeMul[b];
    const lowestAskSize = cluster.askSize[a] * cluster.sizeMul[a];
    const highestBidLegAsk = cluster.ask[b] * cluster.askMul[b];
    const lowestAskLegBid = cluster.bid[a] * cluster.bidMul[a];

    const edge = walkLadders(cluster, a, b);

    this.logger.log(
      `Opportunity found between venues ${highestBidMarket.venueId} and ${lowestAskMarket.venueId} for ${lowestAskMarket.base} / ${lowestAskMarket.quote}: ${netPpm}ppm at ${new Date(now).toISOString()}, ${highestBidSize} coins at the bid and ${lowestAskSize} at the ask, ${edge === null ? 'no depth held' : `${Math.round(edge.avgPpm)}ppm over ${edge.notional.toFixed(0)} of notional${edge.exhausted ? ' with a book exhausted' : ''}`}, ${anchor === null ? `anchors ${anchorIssue}` : `${Math.round(anchor.freshNetPpm)}ppm fresh against the anchors`}`,
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
      anchor,
      anchorIssue,
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

    return opportunities.has(
      this.getRouteKey(highestBidMarket, lowestAskMarket),
    );
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
      anchorIssueAtOpen: O.anchorIssue,
      peakAnchor: O.anchor,
      lastAnchor: O.anchor,
      freshNetPpmSeries: [O.anchor?.freshNetPpm ?? NO_ANCHOR],
      anchorTsMs: O.anchor === null ? [] : [0],
      highestBidIndexSeries: O.anchor === null ? [] : [O.anchor.sell.index],
      highestBidMarkSeries: O.anchor === null ? [] : [O.anchor.sell.mark],
      lowestAskIndexSeries: O.anchor === null ? [] : [O.anchor.buy.index],
      lowestAskMarkSeries: O.anchor === null ? [] : [O.anchor.buy.mark],

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
      typeof anchorRead === 'string' ? null : anchorRead,
    );

    // Recorded first, so a collapsing tick ends the series and the close log sees it
    const reason = this.closeReasonFor(opportunity, cluster, now, netPpm);

    if (reason !== null) {
      this.closeOpportunity(opportunity, cluster.pair, now, reason);
    }
  }

  // While a route is set aside, one sample a minute gets through to the anchor read, so the watch can release it.
  private skipsQuarantined(key: string, now: number): boolean {
    const watch = this.indexWatches.get(key);

    return (
      watch !== undefined &&
      watch.quarantinedAt > 0 &&
      now - watch.checkedAt < QUARANTINE_RECHECK_MS
    );
  }

  // Returns true when the route is set aside after this sample, so discovery stops here and stays quiet.
  private watchIndexGap(
    key: string,
    cluster: Cluster,
    anchor: AnchorPair,
    b: number,
    a: number,
    highestBidMarket: Market,
    lowestAskMarket: Market,
    now: number,
  ): boolean {
    const gapPpm = scaledIndexGapPpm(
      cluster,
      anchor,
      b,
      a,
      highestBidMarket,
      lowestAskMarket,
    );
    let watch = this.indexWatches.get(key);

    if (watch === undefined) {
      watch = {
        apartSince: 0,
        togetherSince: 0,
        quarantinedAt: 0,
        checkedAt: 0,
        gapPpm,
      };
      this.indexWatches.set(key, watch);
    }

    watch.checkedAt = now;
    watch.gapPpm = gapPpm;

    const apart = Math.abs(gapPpm) > INDEX_GAP_QUARANTINE_PPM;
    const together = Math.abs(gapPpm) < INDEX_GAP_RELEASE_PPM;
    watch.apartSince = apart ? watch.apartSince || now : 0;
    watch.togetherSince = together ? watch.togetherSince || now : 0;

    const detail = {
      pair: cluster.pair,
      route: this.getRouteKey(highestBidMarket, lowestAskMarket),
      gapPpm,
      sellIndex: anchor.sell.index,
      buyIndex: anchor.buy.index,
    };

    if (watch.quarantinedAt === 0) {
      if (
        watch.apartSince > 0 &&
        now - watch.apartSince >= QUARANTINE_AFTER_MS
      ) {
        watch.quarantinedAt = now;
        this.logger.warn({
          event: 'route_quarantined',
          ...detail,
          apartMs: now - watch.apartSince,
        });
        return true;
      }

      return false;
    }

    if (
      watch.togetherSince > 0 &&
      now - watch.togetherSince >= RELEASE_AFTER_MS
    ) {
      this.logger.log({
        event: 'route_released',
        ...detail,
        quarantinedMs: now - watch.quarantinedAt,
      });
      watch.quarantinedAt = 0;
      return false;
    }

    return true;
  }

  // A rejected cross comes back on every tick while it lasts, so each route and reason warns once per window and counts the rest.
  private reportRejection(
    reason: RejectionReason,
    cluster: Cluster,
    highestBidMarket: Market,
    lowestAskMarket: Market,
    now: number,
    detail: Record<string, number | null>,
  ): void {
    const route = this.getRouteKey(highestBidMarket, lowestAskMarket);
    const key = `${cluster.pair}|${route}|${reason}`;
    let state = this.rejectionWarnStates.get(key);

    if (state === undefined) {
      state = {
        occurrenceCount: 0,
        suppressedCount: 0,
        lastWarnedAt: Number.NEGATIVE_INFINITY,
      };
      this.rejectionWarnStates.set(key, state);
    }

    state.occurrenceCount += 1;

    if (now - state.lastWarnedAt < REJECTION_WARN_WINDOW_MS) {
      state.suppressedCount += 1;
      return;
    }

    this.logger.warn({
      event: 'opportunity_rejected',
      reason,
      pair: cluster.pair,
      route,
      ...detail,
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
      edgeAvgPpmAtOpen: opportunity.edgeAtOpen?.avgPpm ?? null,
      edgeNotionalAtOpen: opportunity.edgeAtOpen?.notional ?? null,
      peakEdgeAvgPpm: opportunity.peakEdge?.avgPpm ?? null,
      peakEdgeNotional: opportunity.peakEdge?.notional ?? null,
      maxEdgeNotional: opportunity.maxEdgeNotional,
      edgeSamples: opportunity.edgeSamples,
      freshNetPpmAtOpen: opportunity.anchorAtOpen?.freshNetPpm ?? null,
      standingPpmAtOpen: opportunity.anchorAtOpen?.standingPpm ?? null,
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

// The two indices are raw venue prices, so each venue's price scale goes back on before they are compared, the same way the books are.
function scaledIndexGapPpm(
  cluster: Cluster,
  anchor: AnchorPair,
  b: number,
  a: number,
  highestBidMarket: Market,
  lowestAskMarket: Market,
): number {
  const sellScale =
    cluster.bidMul[b] / (1 - highestBidMarket.takerPpm / 1_000_000);
  const buyScale =
    cluster.askMul[a] / (1 + lowestAskMarket.takerPpm / 1_000_000);

  return (
    ((anchor.sell.index * sellScale) / (anchor.buy.index * buyScale) - 1) *
    1_000_000
  );
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
