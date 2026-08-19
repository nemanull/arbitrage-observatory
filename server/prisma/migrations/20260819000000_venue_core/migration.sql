-- Exchange becomes Venue, and the two tables that held venue settings are gone.
-- Socket settings and fee schedules now live in code next to VenueSpec, so nothing reads them from Postgres.
-- Market and ArbitrageOpportunity are dropped and rebuilt rather than altered, because every column of both changed shape and this stage has no rows worth carrying over.
-- Pair is unchanged and is kept as it is.

-- DropTable
DROP TABLE IF EXISTS "ArbitrageOpportunity";

-- DropTable
DROP TABLE IF EXISTS "ExchangeConfig";

-- DropTable
DROP TABLE IF EXISTS "ExchangeFee";

-- DropTable
DROP TABLE IF EXISTS "Market";

-- DropTable
DROP TABLE IF EXISTS "Exchange";

-- DropEnum
DROP TYPE IF EXISTS "MarketStatus";

-- DropEnum
DROP TYPE IF EXISTS "ArbitrageKind";

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
