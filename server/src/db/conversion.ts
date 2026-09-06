import type { Opportunity, PairKey } from '../engine/types';
import type { ArbitrageOpportunityRow } from './writes';

// Turns a closed Opportunity into the row the worker inserts.
// This is the only place that knows both shapes, which keeps writes.ts free of engine types and the queue payload plain JSON.
// The caller passes pair and route because an Opportunity carries neither: pair is the key of the map it lived in, and route is OpportunityManager.getRouteKey.
export function toOpportunityRow(
  opportunity: Opportunity,
  pair: PairKey,
  route: string,
): ArbitrageOpportunityRow {
  const closedAt = opportunity.closedAt;
  const closeReason = opportunity.closeReason;

  if (closedAt === null || closeReason === null) {
    throw new Error(`Opportunity for ${pair} on route ${route} is still open`);
  }

  return {
    pair,
    route,

    highestBidVenue: opportunity.highestBidMarket.venueId,
    highestBidRawMarketId: opportunity.highestBidMarket.rawMarketId,
    lowestAskVenue: opportunity.lowestAskMarket.venueId,
    lowestAskRawMarketId: opportunity.lowestAskMarket.rawMarketId,

    highestBidTakerPpm: opportunity.highestBidMarket.takerPpm,
    lowestAskTakerPpm: opportunity.lowestAskMarket.takerPpm,

    openedAt: new Date(opportunity.openedAt).toISOString(),
    netPpmAtOpen: opportunity.netPpmAtOpen,
    highestBidAtOpen: opportunity.highestBidAtOpen,
    lowestAskAtOpen: opportunity.lowestAskAtOpen,

    closedAt: new Date(closedAt).toISOString(),
    closeReason,
    netPpmAtClose: opportunity.lastNetPpm,
    roundTripPpm:
      opportunity.netPpmAtOpen -
      opportunity.lastNetPpm -
      2 *
        (opportunity.highestBidMarket.takerPpm +
          opportunity.lowestAskMarket.takerPpm),
    lastSeenAt: new Date(opportunity.lastSeenAt).toISOString(),
    durationMs: closedAt - opportunity.openedAt,

    ticks: opportunity.ticksSinceStart,
    avgNetPpm: opportunity.netPpmSum / opportunity.ticksSinceStart,
    peakNetPpm: opportunity.peakNetPpm,
    peakAt: new Date(opportunity.peakAt).toISOString(),
    peakHighestBid: opportunity.peakHighestBid,
    peakLowestAsk: opportunity.peakLowestAsk,
    minNetPpm: opportunity.minNetPpm,

    sampleTsMs: opportunity.sampleTs,
    netPpmSeries: opportunity.netPpmSeries,
    highestBidSeries: opportunity.highestBidSeries,
    lowestAskSeries: opportunity.lowestAskSeries,
  };
}
