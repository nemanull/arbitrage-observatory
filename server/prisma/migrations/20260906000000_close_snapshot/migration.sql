-- closeReason records why an episode ended, and from now on only these four things end one.
-- netPpmAtClose is the last reading before it did, so a round trip's ceiling is netPpmAtOpen minus this minus the two closing fills.
-- Rows written before these columns existed were closed by a 5 s silence rule that no longer exists.
-- None of the four reasons describes those rows truthfully, so the migration refuses to label them and asks for an empty table instead.
-- The table is then dropped and rebuilt rather than altered, as venue_core did, so the columns sit in schema order instead of trailing the array series.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ArbitrageOpportunity") THEN
    RAISE EXCEPTION 'ArbitrageOpportunity holds rows written before closeReason existed. Clear the table, then rerun the migration.';
  END IF;
END $$;

DROP TABLE IF EXISTS "ArbitrageOpportunity";
DROP TYPE IF EXISTS "OpportunityCloseReason";

-- CreateEnum
CREATE TYPE "OpportunityCloseReason" AS ENUM ('spread_collapsed', 'feed_down', 'age_cap', 'shutdown');

-- CreateTable
CREATE TABLE "ArbitrageOpportunity" (
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" BIGSERIAL NOT NULL,
    "pair" TEXT NOT NULL,
    "route" TEXT NOT NULL,
    "highestBidVenue" TEXT NOT NULL,
    "highestBidRawMarketId" TEXT NOT NULL,
    "lowestAskVenue" TEXT NOT NULL,
    "lowestAskRawMarketId" TEXT NOT NULL,
    "highestBidTakerPpm" INTEGER NOT NULL,
    "lowestAskTakerPpm" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "netPpmAtOpen" DOUBLE PRECISION NOT NULL,
    "highestBidAtOpen" DOUBLE PRECISION NOT NULL,
    "lowestAskAtOpen" DOUBLE PRECISION NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "closeReason" "OpportunityCloseReason" NOT NULL,
    "netPpmAtClose" DOUBLE PRECISION NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "ticks" INTEGER NOT NULL,
    "avgNetPpm" DOUBLE PRECISION NOT NULL,
    "peakNetPpm" DOUBLE PRECISION NOT NULL,
    "peakAt" TIMESTAMP(3) NOT NULL,
    "peakHighestBid" DOUBLE PRECISION NOT NULL,
    "peakLowestAsk" DOUBLE PRECISION NOT NULL,
    "minNetPpm" DOUBLE PRECISION NOT NULL,
    "sampleTsMs" INTEGER[],
    "netPpmSeries" DOUBLE PRECISION[],
    "highestBidSeries" DOUBLE PRECISION[],
    "lowestAskSeries" DOUBLE PRECISION[],

    CONSTRAINT "ArbitrageOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ArbitrageOpportunity_openedAt_idx" ON "ArbitrageOpportunity"("openedAt");
CREATE INDEX "ArbitrageOpportunity_pair_openedAt_idx" ON "ArbitrageOpportunity"("pair", "openedAt");
CREATE INDEX "ArbitrageOpportunity_route_openedAt_idx" ON "ArbitrageOpportunity"("route", "openedAt");
CREATE INDEX "ArbitrageOpportunity_peakNetPpm_idx" ON "ArbitrageOpportunity"("peakNetPpm");
