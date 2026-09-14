import type { PairKey } from '../engine/cluster/types';
import type { AnchorLeg, Opportunity } from '../engine/opportunity/types';
import type { ArbitrageOpportunityRow } from './writes';

// Turns a closed Opportunity into the row the worker inserts.
// This is the only place that knows both shapes, which keeps writes.ts free of engine types and the queue payload plain JSON.
// The caller passes pair and route because an Opportunity carries neither: pair is the key of the map it lived in, and route is getRouteKey in OpportunityLifecycle.ts.
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

  const anchor = opportunity.anchorAtOpen;
  const { sell, buy } = anchor;

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
    edgeAvgPpmSeries: opportunity.edgeAvgPpmSeries,
    edgeNotionalSeries: opportunity.edgeNotionalSeries,

    edgeAvgPpmAtOpen: opportunity.edgeAtOpen?.avgPpm ?? null,
    edgeSizeAtOpen: opportunity.edgeAtOpen?.size ?? null,
    edgeNotionalAtOpen: opportunity.edgeAtOpen?.notional ?? null,
    edgeExhaustedAtOpen: opportunity.edgeAtOpen?.exhausted ?? null,
    edgeBuyLevelsAtOpen: opportunity.edgeAtOpen?.buyLevels ?? null,
    edgeSellLevelsAtOpen: opportunity.edgeAtOpen?.sellLevels ?? null,

    peakEdgeAvgPpm: opportunity.peakEdge?.avgPpm ?? null,
    peakEdgeSize: opportunity.peakEdge?.size ?? null,
    peakEdgeNotional: opportunity.peakEdge?.notional ?? null,
    peakEdgeExhausted: opportunity.peakEdge?.exhausted ?? null,
    peakEdgeAt:
      opportunity.peakEdge === null
        ? null
        : new Date(opportunity.peakEdgeAt).toISOString(),

    edgeAvgPpmAtClose: opportunity.lastEdge?.avgPpm ?? null,
    edgeSizeAtClose: opportunity.lastEdge?.size ?? null,
    edgeNotionalAtClose: opportunity.lastEdge?.notional ?? null,
    edgeExhaustedAtClose: opportunity.lastEdge?.exhausted ?? null,

    maxEdgeNotional: opportunity.maxEdgeNotional,
    edgeSamples: opportunity.edgeSamples,

    highestBidIndexAtOpen: sell.index,
    highestBidMarkAtOpen: markOrNull(sell),
    highestBidFreshPremiumAtOpen: sell.freshPremium,
    highestBidFundingRateAtOpen: sell.fundingRate,
    highestBidFundingIntervalHours: sell.fundingIntervalHours,
    highestBidNextFundingAt: timeOrNull(sell.nextFundingAt),
    highestBidAnchorAt: timeOrNull(sell.writtenAt),
    lowestAskIndexAtOpen: buy.index,
    lowestAskMarkAtOpen: markOrNull(buy),
    lowestAskFreshPremiumAtOpen: buy.freshPremium,
    lowestAskFundingRateAtOpen: buy.fundingRate,
    lowestAskFundingIntervalHours: buy.fundingIntervalHours,
    lowestAskNextFundingAt: timeOrNull(buy.nextFundingAt),
    lowestAskAnchorAt: timeOrNull(buy.writtenAt),
    anchorIssueAtOpen: null, // only rows from before 2026-09-14 opened unjudged

    freshNetPpmAtOpen: anchor.freshNetPpm,
    standingPpmAtOpen: anchor.standingPpm,
    indexGapPpmAtOpen: anchor.indexGapPpm,
    carriedPpmAtOpen: anchor.carriedPpm,
    freshNetPpmAtPeak: opportunity.peakAnchor?.freshNetPpm ?? null,
    standingPpmAtPeak: opportunity.peakAnchor?.standingPpm ?? null,
    indexGapPpmAtPeak: opportunity.peakAnchor?.indexGapPpm ?? null,
    carriedPpmAtPeak: opportunity.peakAnchor?.carriedPpm ?? null,
    freshNetPpmAtClose: opportunity.lastAnchor?.freshNetPpm ?? null,
    standingPpmAtClose: opportunity.lastAnchor?.standingPpm ?? null,
    indexGapPpmAtClose: opportunity.lastAnchor?.indexGapPpm ?? null,
    carriedPpmAtClose: opportunity.lastAnchor?.carriedPpm ?? null,

    freshNetPpmSeries: opportunity.freshNetPpmSeries,
    anchorTsMs: opportunity.anchorTsMs,
    highestBidIndexSeries: opportunity.highestBidIndexSeries,
    highestBidMarkSeries: opportunity.highestBidMarkSeries,
    lowestAskIndexSeries: opportunity.lowestAskIndexSeries,
    lowestAskMarkSeries: opportunity.lowestAskMarkSeries,
  };
}

// The engine keeps 0 for a venue that publishes no mark and for an unknown settlement time, and the row says null.
function markOrNull(leg: AnchorLeg): number | null {
  return leg.mark <= 0 ? null : leg.mark;
}

function timeOrNull(ms: number): string | null {
  return ms <= 0 ? null : new Date(ms).toISOString();
}
