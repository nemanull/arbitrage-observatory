import { Logger } from '@nestjs/common';
import type { Queue } from 'bullmq';
import type {
  AnchorReading,
  BookLevel,
  Cluster,
  ClusterIndex,
  PairKey,
  VenueIndexMap,
} from './cluster/types';
import { DEPTH_LEVELS } from './cluster/ClusterIndexBuilder';
import { OpportunityLifecycle } from './opportunity/OpportunityLifecycle';
import { OpportunityManager } from './opportunity/OpportunityManager';
import type { OpportunityClosedJob } from './opportunity/OpportunityWorker';

type SingleMarketClusterQuote = {
  bid: number;
  ask: number;
  bidSize: number; // raw contracts, as the venue counts them
  askSize: number;
  recvTs: number;
};

type QuoteValidationIssue =
  | 'bid_not_finite'
  | 'bid_not_positive'
  | 'ask_not_finite'
  | 'ask_not_positive'
  | 'crossed_quote'
  | 'bid_size_not_finite'
  | 'bid_size_negative' // zero is valid: an empty level is a fact about the book
  | 'ask_size_not_finite'
  | 'ask_size_negative'
  | 'recv_ts_not_finite'
  | 'recv_ts_not_positive';

// A venue that keeps sending the same broken quote would otherwise log once per tick.
// One warning per (venue, market, issue set) per window; the next warning carries the counts.
const INVALID_QUOTE_WARN_WINDOW_MS = 10_000;

type Slot = { cluster: Cluster; venueIndex: number };

type InvalidQuoteWarnState = {
  occurrenceCount: number; // rejections seen for this key since the engine started
  suppressedCount: number; // rejections swallowed since the last warning
  lastWarnedAt: number;
};

export class Engine {
  private readonly logger = new Logger(Engine.name);

  private readonly ClusterIndex: ClusterIndex;
  private readonly venueIndexMap: VenueIndexMap;
  private readonly opportunityLifecycle: OpportunityLifecycle;
  private readonly opportunityManager: OpportunityManager;
  private readonly invalidQuoteWarnStates = new Map<
    string,
    InvalidQuoteWarnState
  >();
  private stopping = false; // once shutdown has flushed, a late frame must not open a route nobody will flush
  readonly depthLevels: number; // levels per side a feed hands updateBook, what the block holds

  constructor(
    clusterIndex: ClusterIndex,
    venueIndexMap: VenueIndexMap,
    queue: Queue<OpportunityClosedJob>,
  ) {
    this.ClusterIndex = clusterIndex;
    this.venueIndexMap = venueIndexMap;
    this.opportunityLifecycle = new OpportunityLifecycle(queue);
    this.opportunityManager = new OpportunityManager(this.opportunityLifecycle);
    this.depthLevels =
      clusterIndex.clusters[0]?.depth.maxLevels ?? DEPTH_LEVELS;
  }

  updateQuote(
    venueId: string,
    rawMarketId: string,
    clusterQuote: SingleMarketClusterQuote,
  ): void {
    if (this.stopping) {
      return;
    }

    const venueMap = this.ClusterIndex.clusterByRawMarketId.get(venueId);
    if (!venueMap) {
      this.logger.warn(`No venue map found for venueId: ${venueId}`);
      return;
    }

    const cluster = venueMap.get(rawMarketId);
    if (!cluster) {
      this.logger.warn(
        `No cluster found for rawMarketId: ${rawMarketId} on venueId: ${venueId}`,
      );
      return;
    }

    const venueIndex = this.venueIndexMap.get(venueId);
    if (venueIndex === undefined) {
      this.logger.warn(
        `No venueIndex found in the venueIndexMap for venueId: ${venueId}`,
      );
      return;
    }

    this.applyQuote(
      { cluster, venueIndex },
      venueId,
      rawMarketId,
      clusterQuote,
    );
  }

  updateBook(
    venueId: string,
    rawMarketId: string,
    bids: readonly BookLevel[],
    asks: readonly BookLevel[],
    recvTs: number,
  ): boolean {
    if (this.stopping) {
      return false;
    }

    const slot = this.resolveSlot(venueId, rawMarketId);
    if (slot === null) {
      this.logger.warn({
        event: 'book_update_rejected',
        venueId,
        rawMarketId,
        issue: 'unknown_market',
      });
      return false;
    }

    if (!this.writeDepth(slot, venueId, rawMarketId, bids, asks, recvTs)) {
      return false;
    }

    if (bids.length === 0 || asks.length === 0) {
      this.dropQuote(
        slot,
        venueId,
        rawMarketId,
        recvTs,
        bids.length === 0 ? 'bids' : 'asks',
      );
      return true;
    }

    this.applyQuote(slot, venueId, rawMarketId, {
      bid: bids[0][0],
      ask: asks[0][0],
      bidSize: bids[0][1],
      askSize: asks[0][1],
      recvTs,
    });

    return true;
  }

  private applyQuote(
    slot: Slot,
    venueId: string,
    rawMarketId: string,
    clusterQuote: SingleMarketClusterQuote,
  ): void {
    const { cluster, venueIndex } = slot;

    if (
      !this.validateQuote(
        clusterQuote,
        venueId,
        rawMarketId,
        cluster.pair,
        venueIndex,
      )
    ) {
      return;
    }

    // Sizes land before the repeat check, so a size-only change is stored but never runs discovery.
    cluster.bidSize[venueIndex] = clusterQuote.bidSize;
    cluster.askSize[venueIndex] = clusterQuote.askSize;

    // A repeat of the same prices carries nothing new for a live slot, whatever the sizes did.
    // After markStale the slot is not live, so the same numbers are a fresh quote and run discovery.
    if (
      cluster.recvTs[venueIndex] > 0 &&
      cluster.bid[venueIndex] === clusterQuote.bid &&
      cluster.ask[venueIndex] === clusterQuote.ask
    ) {
      cluster.recvTs[venueIndex] = clusterQuote.recvTs;
      return;
    }

    cluster.bid[venueIndex] = clusterQuote.bid;
    cluster.ask[venueIndex] = clusterQuote.ask;
    cluster.recvTs[venueIndex] = clusterQuote.recvTs;

    this.opportunityManager.validate(cluster, venueIndex, clusterQuote.recvTs);
  }

  private dropQuote(
    slot: Slot,
    venueId: string,
    rawMarketId: string,
    now: number,
    emptySide: 'bids' | 'asks',
  ): void {
    const { cluster, venueIndex } = slot;
    const wasLive = cluster.recvTs[venueIndex] > 0;

    cluster.recvTs[venueIndex] = 0;
    const closed = this.opportunityLifecycle.closeOpportunitiesOnVenue(
      cluster.pair,
      venueIndex,
      now,
    ).length;

    if (wasLive) {
      this.logger.warn({
        event: 'book_one_sided',
        venueId,
        rawMarketId,
        pair: cluster.pair,
        emptySide,
        closed,
      });
    }
  }

  // The age cap needs a timer. A route whose legs stop changing has no tick left to reach it.
  sweep(now: number): number {
    return this.opportunityLifecycle.sweep(now).length;
  }

  tracks(venueId: string, rawMarketId: string): boolean {
    return this.resolveSlot(venueId, rawMarketId) !== null;
  }

  // Called when a socket dies. Its markets stop counting as live until their next frame, and every open route on them closes here, because no later tick can be trusted to do it.
  // The depth goes with the quote, since the same socket carried both.
  markStale(venueId: string, rawMarketIds: readonly string[]): void {
    const venueIndex = this.venueIndexMap.get(venueId);
    const clusters = this.ClusterIndex.clusterByRawMarketId.get(venueId);

    if (venueIndex === undefined || clusters === undefined) {
      return;
    }

    const now = Date.now();
    let closed = 0;

    for (const rawMarketId of rawMarketIds) {
      const cluster = clusters.get(rawMarketId);
      if (cluster === undefined) continue;

      cluster.recvTs[venueIndex] = 0;
      cluster.depth.bidLevelCount[venueIndex] = 0;
      cluster.depth.askLevelCount[venueIndex] = 0;
      cluster.depth.writtenAt[venueIndex] = 0;
      closed += this.opportunityLifecycle.closeOpportunitiesOnVenue(
        cluster.pair,
        venueIndex,
        now,
      ).length;
    }

    if (closed > 0) {
      this.logger.log({
        event: 'feed_down_closed_opportunities',
        venueId,
        markets: rawMarketIds.length,
        closed,
      });
    }
  }

  // Closes every open route and waits for the queue. Quotes arriving after this are dropped.
  shutdown(now: number): Promise<number> {
    this.stopping = true;
    return this.opportunityLifecycle.shutdown(now);
  }

  private resolveSlot(venueId: string, rawMarketId: string): Slot | null {
    const cluster = this.ClusterIndex.clusterByRawMarketId
      .get(venueId)
      ?.get(rawMarketId);
    if (cluster === undefined) {
      return null;
    }

    const venueIndex = this.venueIndexMap.get(venueId);
    if (venueIndex === undefined) {
      return null;
    }

    return { cluster, venueIndex };
  }

  updateDepth(
    venueId: string,
    rawMarketId: string,
    bids: readonly BookLevel[],
    asks: readonly BookLevel[],
    ts: number,
  ): boolean {
    if (this.stopping) {
      return false;
    }

    const slot = this.resolveSlot(venueId, rawMarketId);
    if (slot === null) {
      this.logger.warn({
        event: 'depth_update_rejected',
        venueId,
        rawMarketId,
        issue: 'unknown_market',
      });
      return false;
    }

    return this.writeDepth(slot, venueId, rawMarketId, bids, asks, ts);
  }

  private writeDepth(
    slot: Slot,
    venueId: string,
    rawMarketId: string,
    bids: readonly BookLevel[],
    asks: readonly BookLevel[],
    ts: number,
  ): boolean {
    const issue =
      depthIssue(bids, 'bid') ??
      depthIssue(asks, 'ask') ??
      (!Number.isFinite(ts) || ts <= 0 ? 'ts_not_positive' : null);

    if (issue !== null) {
      this.logger.warn({
        event: 'depth_update_rejected',
        venueId,
        rawMarketId,
        pair: slot.cluster.pair,
        issue,
        bids: bids.length,
        asks: asks.length,
      });
      return false;
    }

    const depth = slot.cluster.depth;
    const base = slot.venueIndex * depth.maxLevels;
    const bidLevelCount = Math.min(bids.length, depth.maxLevels);
    const askLevelCount = Math.min(asks.length, depth.maxLevels);

    for (let l = 0; l < bidLevelCount; l++) {
      depth.bidPrice[base + l] = bids[l][0];
      depth.bidSize[base + l] = bids[l][1];
    }

    for (let l = 0; l < askLevelCount; l++) {
      depth.askPrice[base + l] = asks[l][0];
      depth.askSize[base + l] = asks[l][1];
    }

    depth.bidLevelCount[slot.venueIndex] = bidLevelCount;
    depth.askLevelCount[slot.venueIndex] = askLevelCount;
    depth.writtenAt[slot.venueIndex] = ts;

    return true;
  }

  // An anchor write is not a tick. It labels a route the next time one opens, peaks or closes, and opens nothing itself.
  updateAnchor(
    venueId: string,
    rawMarketId: string,
    reading: AnchorReading,
  ): boolean {
    if (this.stopping) {
      return false;
    }

    const slot = this.resolveSlot(venueId, rawMarketId);
    if (slot === null) {
      this.logger.warn({
        event: 'anchor_update_rejected',
        venueId,
        rawMarketId,
        issue: 'unknown_market',
      });
      return false;
    }

    const issue = anchorIssue(reading);
    if (issue !== null) {
      this.logger.warn({
        event: 'anchor_update_rejected',
        venueId,
        rawMarketId,
        pair: slot.cluster.pair,
        issue,
        ...reading,
      });
      return false;
    }

    const { anchor } = slot.cluster;
    const i = slot.venueIndex;

    anchor.index[i] = reading.index;
    anchor.mark[i] = reading.mark;
    anchor.fundingRate[i] = reading.fundingRate;
    anchor.fundingIntervalHours[i] = reading.fundingIntervalHours;
    anchor.nextFundingAt[i] = reading.nextFundingAt;
    anchor.writtenAt[i] = reading.ts;

    return true;
  }

  validateQuote(
    quote: SingleMarketClusterQuote,
    venueId: string,
    rawMarketId: string,
    clusterPair: PairKey,
    venueIndex: number,
  ): boolean {
    let issues: QuoteValidationIssue[] | undefined;
    const bidIsFinite = Number.isFinite(quote.bid);
    const askIsFinite = Number.isFinite(quote.ask);

    if (!bidIsFinite) {
      (issues ??= []).push('bid_not_finite');
    } else if (quote.bid <= 0) {
      (issues ??= []).push('bid_not_positive');
    }

    if (!askIsFinite) {
      (issues ??= []).push('ask_not_finite');
    } else if (quote.ask <= 0) {
      (issues ??= []).push('ask_not_positive');
    }

    if (
      bidIsFinite &&
      quote.bid > 0 &&
      askIsFinite &&
      quote.ask > 0 &&
      quote.bid > quote.ask
    ) {
      (issues ??= []).push('crossed_quote');
    }

    if (!Number.isFinite(quote.bidSize)) {
      (issues ??= []).push('bid_size_not_finite');
    } else if (quote.bidSize < 0) {
      (issues ??= []).push('bid_size_negative');
    }

    if (!Number.isFinite(quote.askSize)) {
      (issues ??= []).push('ask_size_not_finite');
    } else if (quote.askSize < 0) {
      (issues ??= []).push('ask_size_negative');
    }

    if (!Number.isFinite(quote.recvTs)) {
      (issues ??= []).push('recv_ts_not_finite');
    } else if (quote.recvTs <= 0) {
      (issues ??= []).push('recv_ts_not_positive');
    }

    if (issues === undefined) {
      return true;
    }

    this.reportInvalidQuote(
      quote,
      issues,
      venueId,
      rawMarketId,
      clusterPair,
      venueIndex,
    );

    return false;
  }

  private reportInvalidQuote(
    quote: SingleMarketClusterQuote,
    issues: QuoteValidationIssue[],
    venueId: string,
    rawMarketId: string,
    clusterPair: PairKey,
    venueIndex: number,
  ): void {
    const key = `${venueId}|${rawMarketId}|${issues.join(',')}`;
    const now = Date.now();
    let state = this.invalidQuoteWarnStates.get(key);

    if (state === undefined) {
      state = {
        occurrenceCount: 0,
        suppressedCount: 0,
        lastWarnedAt: Number.NEGATIVE_INFINITY,
      };
      this.invalidQuoteWarnStates.set(key, state);
    }

    state.occurrenceCount += 1;

    if (now - state.lastWarnedAt < INVALID_QUOTE_WARN_WINDOW_MS) {
      state.suppressedCount += 1;
      return;
    }

    this.logger.warn({
      event: 'quote_update_rejected',
      reason: 'invalid_quote',
      issues,
      venueId,
      rawMarketId,
      clusterPair,
      venueIndex,
      bid: quote.bid,
      ask: quote.ask,
      bidSize: quote.bidSize,
      askSize: quote.askSize,
      recvTs: quote.recvTs,
      occurrenceCount: state.occurrenceCount,
      suppressedCount: state.suppressedCount,
    });

    state.lastWarnedAt = now;
    state.suppressedCount = 0;
  }
}

type DepthIssue =
  | 'bid_price_invalid'
  | 'bid_size_invalid'
  | 'bids_out_of_order'
  | 'ask_price_invalid'
  | 'ask_size_invalid'
  | 'asks_out_of_order'
  | 'ts_not_positive';

type AnchorIssue =
  | 'index_invalid' // finite and positive
  | 'mark_invalid' // finite and not negative, zero means the venue publishes none
  | 'funding_rate_invalid' // finite, either sign, zero is a real rate
  | 'funding_interval_invalid' // finite and positive hours
  | 'next_funding_at_invalid' // finite and not negative, zero means unknown
  | 'ts_not_positive';

function anchorIssue(r: AnchorReading): AnchorIssue | null {
  if (!Number.isFinite(r.index) || r.index <= 0) {
    return 'index_invalid';
  }
  if (!Number.isFinite(r.mark) || r.mark < 0) {
    return 'mark_invalid';
  }
  if (!Number.isFinite(r.fundingRate)) {
    return 'funding_rate_invalid';
  }
  if (!Number.isFinite(r.fundingIntervalHours) || r.fundingIntervalHours <= 0) {
    return 'funding_interval_invalid';
  }
  if (!Number.isFinite(r.nextFundingAt) || r.nextFundingAt < 0) {
    return 'next_funding_at_invalid';
  }
  if (!Number.isFinite(r.ts) || r.ts <= 0) {
    return 'ts_not_positive';
  }
  return null;
}

function depthIssue(
  levels: readonly BookLevel[],
  side: 'bid' | 'ask',
): DepthIssue | null {
  for (let l = 0; l < levels.length; l++) {
    const [price, size] = levels[l];

    if (!Number.isFinite(price) || price <= 0) {
      return side === 'bid' ? 'bid_price_invalid' : 'ask_price_invalid';
    }

    if (!Number.isFinite(size) || size < 0) {
      return side === 'bid' ? 'bid_size_invalid' : 'ask_size_invalid';
    }

    if (l > 0) {
      const previous = levels[l - 1][0];
      const ordered = side === 'bid' ? price <= previous : price >= previous;

      if (!ordered) {
        return side === 'bid' ? 'bids_out_of_order' : 'asks_out_of_order';
      }
    }
  }

  return null;
}
