import { Logger } from '@nestjs/common';
import type { ClusterIndex, PairKey, VenueIndexMap } from './types';
import { OpportunityManager } from './OpportunityManager';


type SingleMarketClusterQuote = {
  bid: number;
  ask: number;
  recvTs: number;
};

type QuoteValidationIssue =
  | 'bid_not_finite'
  | 'bid_not_positive'
  | 'ask_not_finite'
  | 'ask_not_positive'
  | 'crossed_quote'
  | 'recv_ts_not_finite'
  | 'recv_ts_not_positive';

// A venue that keeps sending the same broken quote would otherwise log once per tick.
// One warning per (venue, market, issue set) per window; the next warning carries the counts.
const INVALID_QUOTE_WARN_WINDOW_MS = 10_000;

type InvalidQuoteWarnState = {
  occurrenceCount: number; // rejections seen for this key since the engine started
  suppressedCount: number; // rejections swallowed since the last warning
  lastWarnedAt: number;
};

export class Engine {
  private readonly logger = new Logger(Engine.name);
  
  private readonly ClusterIndex: ClusterIndex;
  private readonly venueIndexMap: VenueIndexMap;
  private readonly opportunityManager: OpportunityManager;
  private readonly invalidQuoteWarnStates = new Map<string, InvalidQuoteWarnState>();

  constructor(clusterIndex: ClusterIndex, venueIndexMap: VenueIndexMap) {
    this.ClusterIndex = clusterIndex;
    this.venueIndexMap = venueIndexMap;
    this.opportunityManager = new OpportunityManager();
  }

  
  updateQuote(
    venueId: string,
    rawMarketId: string,
    clusterQuote: SingleMarketClusterQuote,
  ): void {
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
      this.logger.warn(`No venueIndex found in the venueIndexMap for venueId: ${venueId}`);
      return;
    }

    if (
      this.validateQuote(
        clusterQuote,
        venueId,
        rawMarketId,
        cluster.pair,
        venueIndex,
      )
    ) {
      cluster.bid[venueIndex] = clusterQuote.bid;
      cluster.ask[venueIndex] = clusterQuote.ask;
      cluster.recvTs[venueIndex] = clusterQuote.recvTs;


      // Evaluate the opportunity
      this.opportunityManager.validate(cluster, venueIndex, clusterQuote.recvTs);
    }
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

    if (!Number.isFinite(quote.recvTs)) {
      (issues ??= []).push('recv_ts_not_finite');
    } else if (quote.recvTs <= 0) {
      (issues ??= []).push('recv_ts_not_positive');
    }

    if (issues === undefined) {
      return true;
    }

    this.reportInvalidQuote(quote, issues, venueId, rawMarketId, clusterPair, venueIndex);

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
      state = { occurrenceCount: 0, suppressedCount: 0, lastWarnedAt: Number.NEGATIVE_INFINITY };
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
      recvTs: quote.recvTs,
      occurrenceCount: state.occurrenceCount,
      suppressedCount: state.suppressedCount,
    });

    state.lastWarnedAt = now;
    state.suppressedCount = 0;
  }


}
