import { Logger } from '@nestjs/common';
import { readAnchorPair } from './anchorReading';
import { walkLadders } from './ladderWalk';
import { getRouteKey, type OpportunityLifecycle } from './OpportunityLifecycle';
import type { Cluster, Market } from '../cluster/types';
import type { AnchorIssue, Opportunity } from './types';

const MIN_NET_PPM = 5_000; // after fees
const MAX_PLAUSIBLE_NET_PPM = 100_000;

const REJECTION_WARN_WINDOW_MS = 10_000;

type RejectionReason = 'implausible_net_ppm' | 'standing_basis' | AnchorIssue;

type RejectionWarnState = {
  occurrenceCount: number; // rejections seen for this route and reason since the engine started
  suppressedCount: number; // rejections swallowed since the last warning
  lastWarnedAt: number;
};

export class OpportunityManager {
  private logger = new Logger(OpportunityManager.name);
  private readonly rejectionWarnStates = new Map<string, RejectionWarnState>();

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
      this.lifecycle.doesOpportunityAlreadyExist(
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
        cluster,
        highestBidMarket,
        lowestAskMarket,
        now,
        { netPpm },
      );
      return null;
    }

    if (anchor.freshNetPpm < MIN_NET_PPM) {
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

    const highestBidSize = cluster.bidSize[b] * cluster.sizeMul[b];
    const lowestAskSize = cluster.askSize[a] * cluster.sizeMul[a];
    const highestBidLegAsk = cluster.ask[b] * cluster.askMul[b];
    const lowestAskLegBid = cluster.bid[a] * cluster.bidMul[a];

    const edge = walkLadders(cluster, a, b);

    this.logger.log(
      `Opportunity found between venues ${highestBidMarket.venueId} and ${lowestAskMarket.venueId} for ${lowestAskMarket.base} / ${lowestAskMarket.quote}: ${netPpm}ppm at ${new Date(now).toISOString()}, ${highestBidSize} coins at the bid and ${lowestAskSize} at the ask, ${edge === null ? 'no depth held' : `${Math.round(edge.avgPpm)}ppm over ${edge.notional.toFixed(0)} of notional${edge.exhausted ? ' with a book exhausted' : ''}`}, ${Math.round(anchor.freshNetPpm)}ppm fresh against the anchors`,
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

  private reportRejection(
    reason: RejectionReason,
    cluster: Cluster,
    highestBidMarket: Market,
    lowestAskMarket: Market,
    now: number,
    detail: Record<string, number | null>,
  ): void {
    const route = getRouteKey(highestBidMarket, lowestAskMarket);
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
