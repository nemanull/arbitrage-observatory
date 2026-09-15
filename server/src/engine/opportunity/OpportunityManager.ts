import { Logger } from '@nestjs/common';
import { readAnchorPair } from './anchorReading';
import { walkLadders } from './ladderWalk';
import { getRouteKey, type OpportunityLifecycle } from './OpportunityLifecycle';
import type { Cluster, Market, PairKey } from '../cluster/types';
import type { AnchorIssue, Opportunity } from './types';

const MIN_NET_PPM = 5_000; // after fees
const MIN_EDGE_NOTIONAL = 1_000; // quote units the profitable region must hold at open, the first checkpoint of docs/bestiary/thin-book.md
const MAX_PLAUSIBLE_NET_PPM = 100_000;

// How long a cross must survive before it can open a route.
// Our view of a venue is 55 to 91 ms old and an order needs about as long again, so anything shorter than this ended before we could reach it.
export const MIN_CROSS_AGE_MS = 100;

const REJECTION_WARN_WINDOW_MS = 10_000;

type RejectionReason =
  | 'implausible_net_ppm'
  | 'standing_basis'
  | 'thin_book'
  | 'unconfirmed_cross'
  | AnchorIssue;

type PendingCross = {
  route: string;
  firstSeenAt: number;
  netPpm: number; // the reading at first sight, for the rejection line when it never confirms
};

type RejectionWarnState = {
  occurrenceCount: number; // rejections seen for this route and reason since the engine started
  suppressedCount: number; // rejections swallowed since the last warning
  lastWarnedAt: number;
};

export class OpportunityManager {
  private logger = new Logger(OpportunityManager.name);
  private readonly rejectionWarnStates = new Map<string, RejectionWarnState>();
  private readonly pendingCrosses = new Map<PairKey, PendingCross>();

  constructor(private readonly lifecycle: OpportunityLifecycle) {}

  validate(
    cluster: Cluster,
    venueIndex: number,
    now: number,
  ): Opportunity | null {
    this.lifecycle.updateOpportunitiesOnVenue(cluster, venueIndex, now);

    const highestBidResult = this.getEffectiveHighestBid(cluster);
    const lowestAskResult = this.getEffectiveLowestAsk(cluster);

    if (highestBidResult === null || lowestAskResult === null) {
      this.forgetCross(cluster.pair, now);
      return null;
    }

    const { index: highestBidIndex, value: highestBid } = highestBidResult;
    const { index: lowestAskIndex, value: lowestAsk } = lowestAskResult;

    if (highestBidIndex === lowestAskIndex) {
      this.forgetCross(cluster.pair, now);
      return null;
    }

    const highestBidMarket = cluster.markets[highestBidIndex];
    const lowestAskMarket = cluster.markets[lowestAskIndex];

    if (highestBidMarket === null || lowestAskMarket === null) {
      this.forgetCross(cluster.pair, now);
      return null;
    }

    if (
      this.lifecycle.doesOpportunityAlreadyExist(
        cluster.pair,
        highestBidMarket,
        lowestAskMarket,
      )
    ) {
      // Already tracked. The loop above fed it on this tick if one of its legs moved
      this.pendingCrosses.delete(cluster.pair);
      return null;
    }

    const netPpm = (highestBid / lowestAsk - 1) * 1_000_000;

    if (netPpm < MIN_NET_PPM) {
      this.forgetCross(cluster.pair, now);
      return null;
    }

    if (netPpm > MAX_PLAUSIBLE_NET_PPM) {
      this.reportRejection(
        'implausible_net_ppm',
        cluster.pair,
        getRouteKey(highestBidMarket, lowestAskMarket),
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

    const anchor = readAnchorPair(
      cluster,
      b,
      a,
      highestBidMarket,
      lowestAskMarket,
      netPpm,
      now,
    );

    // No verdict, no row. A route whose anchors cannot be read is refused rather than opened unjudged.
    if (typeof anchor === 'string') {
      this.reportRejection(
        anchor,
        cluster.pair,
        getRouteKey(highestBidMarket, lowestAskMarket),
        now,
        {
          netPpm,
          sellMovePpm: cluster.anchor.movePpm[b],
          buyMovePpm: cluster.anchor.movePpm[a],
        },
      );
      return null;
    }

    if (anchor.freshNetPpm < MIN_NET_PPM) {
      this.reportRejection(
        'standing_basis',
        cluster.pair,
        getRouteKey(highestBidMarket, lowestAskMarket),
        now,
        {
          netPpm,
          freshNetPpm: anchor.freshNetPpm,
          standingPpm: anchor.standingPpm,
          indexGapPpm: anchor.indexGapPpm,
          carriedPpm: anchor.carriedPpm,
          sellMarkPremium: anchor.sell.markPremium,
          buyMarkPremium: anchor.buy.markPremium,
          sellFreshPremium: anchor.sell.freshPremium,
          buyFreshPremium: anchor.buy.freshPremium,
          sellIndex: anchor.sell.index,
          buyIndex: anchor.buy.index,
        },
      );
      return null;
    }

    const edge = walkLadders(cluster, a, b);

    // A region this small is dust or a resting order nobody takes, and the anchors cannot see either.
    if (edge === null || edge.notional < MIN_EDGE_NOTIONAL) {
      this.reportRejection(
        'thin_book',
        cluster.pair,
        getRouteKey(highestBidMarket, lowestAskMarket),
        now,
        {
          netPpm,
          freshNetPpm: anchor.freshNetPpm,
          edgeNotional: edge?.notional ?? null,
          edgeAvgPpm: edge?.avgPpm ?? null,
          edgeSize: edge?.size ?? null,
        },
      );
      return null;
    }

    // Last, because a cross that the guards refuse is still a cross, and its age keeps running while they do.
    if (
      !this.isCrossOldEnough(
        cluster.pair,
        highestBidMarket,
        lowestAskMarket,
        netPpm,
        now,
      )
    ) {
      return null;
    }

    const highestBidSize = cluster.bidSize[b] * cluster.sizeMul[b];
    const lowestAskSize = cluster.askSize[a] * cluster.sizeMul[a];
    const highestBidLegAsk = cluster.ask[b] * cluster.askMul[b];
    const lowestAskLegBid = cluster.bid[a] * cluster.bidMul[a];

    this.logger.log(
      `Opportunity found between venues ${highestBidMarket.venueId} and ${lowestAskMarket.venueId} for ${lowestAskMarket.base} / ${lowestAskMarket.quote}: ${netPpm}ppm at ${new Date(now).toISOString()}, ${highestBidSize} coins at the bid and ${lowestAskSize} at the ask, ${Math.round(edge.avgPpm)}ppm over ${edge.notional.toFixed(0)} of notional${edge.exhausted ? ' with a book exhausted' : ''}, ${Math.round(anchor.freshNetPpm)}ppm fresh against the anchors`,
    );

    return this.lifecycle.trackOpportunity({
      cluster,
      highestBid,
      lowestAsk,
      highestBidSize,
      lowestAskSize,
      highestBidLegAsk,
      lowestAskLegBid,
      netPpm,
      anchor,
      highestBidMarket,
      lowestAskMarket,
      highestBidVenueIndex: highestBidIndex,
      lowestAskVenueIndex: lowestAskIndex,
      now,
    });
  }

  // A cross opens a route only on a tick at least MIN_CROSS_AGE_MS after the tick that first showed it.
  // The clock belongs to the cross, so a different best route restarts it.
  private isCrossOldEnough(
    pair: PairKey,
    highestBidMarket: Market,
    lowestAskMarket: Market,
    netPpm: number,
    now: number,
  ): boolean {
    const route = getRouteKey(highestBidMarket, lowestAskMarket);
    const pending = this.pendingCrosses.get(pair);

    if (pending === undefined || pending.route !== route) {
      if (pending !== undefined) {
        this.reportUnconfirmed(pair, pending, now);
      }

      this.pendingCrosses.set(pair, { route, firstSeenAt: now, netPpm });
      return false;
    }

    if (now - pending.firstSeenAt < MIN_CROSS_AGE_MS) {
      return false;
    }

    this.pendingCrosses.delete(pair);
    return true;
  }

  private forgetCross(pair: PairKey, now: number): void {
    const pending = this.pendingCrosses.get(pair);

    if (pending === undefined) {
      return;
    }

    this.pendingCrosses.delete(pair);
    this.reportUnconfirmed(pair, pending, now);
  }

  private reportUnconfirmed(
    pair: PairKey,
    pending: PendingCross,
    now: number,
  ): void {
    this.reportRejection('unconfirmed_cross', pair, pending.route, now, {
      netPpm: pending.netPpm,
      ageMs: now - pending.firstSeenAt,
      minCrossAgeMs: MIN_CROSS_AGE_MS,
    });
  }

  private reportRejection(
    reason: RejectionReason,
    pair: PairKey,
    route: string,
    now: number,
    detail: Record<string, number | null>,
  ): void {
    const key = `${pair}|${route}|${reason}`;
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
      pair,
      route,
      ...detail,
      occurrenceCount: state.occurrenceCount,
      suppressedCount: state.suppressedCount,
    });

    state.lastWarnedAt = now;
    state.suppressedCount = 0;
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
