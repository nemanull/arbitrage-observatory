import { Logger } from '@nestjs/common';
import type { ClusterIndex, VenueIndexMap } from './types';
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


export class Engine {
  private readonly logger = new Logger(Engine.name);
  
  private readonly ClusterIndex: ClusterIndex;
  private readonly venueIndexMap: VenueIndexMap;
  private readonly opportunityManager: OpportunityManager = new OpportunityManager();

  constructor(clusterIndex: ClusterIndex, venueIndexMap: VenueIndexMap) {
    this.ClusterIndex = clusterIndex;
    this.venueIndexMap = venueIndexMap;
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
      this.opportunityManager.validate(cluster);
    }
  }


  validateQuote(
    quote: SingleMarketClusterQuote,
    venueId: string,
    rawMarketId: string,
    clusterPair: string,
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
    });

    return false;
  }


}
