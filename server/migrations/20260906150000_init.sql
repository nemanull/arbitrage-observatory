-- Squashed on 2026-09-06 from init, seed_exchanges, venue_core and close_snapshot, which git history keeps up to 4831b20.
-- The seeded Exchange rows were already dropped by venue_core, so the squash loses no data.
-- Generated from schema.prisma so that every column sits where the schema puts it.

-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateEnum
CREATE TYPE "OpportunityCloseReason" AS ENUM ('spread_collapsed', 'feed_down', 'age_cap', 'shutdown');

-- CreateTable
CREATE TABLE "Venue" (
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Venue_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Pair" (
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" SERIAL NOT NULL,
    "base" TEXT NOT NULL,
    "quote" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,

    CONSTRAINT "Pair_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Market" (
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" SERIAL NOT NULL,
    "venueId" INTEGER NOT NULL,
    "pairId" INTEGER NOT NULL,
    "rawMarketId" TEXT NOT NULL,
    "linear" BOOLEAN NOT NULL DEFAULT true,
    "makerPpm" INTEGER NOT NULL,
    "takerPpm" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

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
CREATE UNIQUE INDEX "Venue_slug_key" ON "Venue"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Pair_symbol_key" ON "Pair"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Pair_base_quote_key" ON "Pair"("base", "quote");

-- CreateIndex
CREATE INDEX "Market_pairId_active_idx" ON "Market"("pairId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "Market_venueId_rawMarketId_key" ON "Market"("venueId", "rawMarketId");

-- CreateIndex
CREATE UNIQUE INDEX "Market_venueId_pairId_key" ON "Market"("venueId", "pairId");

-- CreateIndex
CREATE INDEX "ArbitrageOpportunity_openedAt_idx" ON "ArbitrageOpportunity"("openedAt");

-- CreateIndex
CREATE INDEX "ArbitrageOpportunity_pair_openedAt_idx" ON "ArbitrageOpportunity"("pair", "openedAt");

-- CreateIndex
CREATE INDEX "ArbitrageOpportunity_route_openedAt_idx" ON "ArbitrageOpportunity"("route", "openedAt");

-- CreateIndex
CREATE INDEX "ArbitrageOpportunity_peakNetPpm_idx" ON "ArbitrageOpportunity"("peakNetPpm");

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_venueId_fkey" FOREIGN KEY ("venueId") REFERENCES "Venue"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "Pair"("id") ON DELETE CASCADE ON UPDATE CASCADE;
