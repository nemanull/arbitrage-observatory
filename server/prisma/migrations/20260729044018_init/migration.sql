-- CreateEnum
CREATE TYPE "MarketStatus" AS ENUM ('ACTIVE', 'INACTIVE');

-- CreateEnum
CREATE TYPE "ArbitrageKind" AS ENUM ('CEX_CEX');

-- CreateTable
CREATE TABLE "Exchange" (
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" SERIAL NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Exchange_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeConfig" (
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" SERIAL NOT NULL,
    "exchangeId" INTEGER NOT NULL,
    "wsUrl" TEXT NOT NULL,
    "maxStreamsPerConnection" INTEGER NOT NULL,
    "maxArgsPerSubscribe" INTEGER NOT NULL,
    "subscribeIntervalMs" INTEGER NOT NULL DEFAULT 250,
    "keepaliveIntervalMs" INTEGER,
    "idleTimeoutMs" INTEGER NOT NULL,
    "maxConnectionAgeMs" INTEGER,
    "reconnectMinDelayMs" INTEGER NOT NULL DEFAULT 1000,

    CONSTRAINT "ExchangeConfig_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ExchangeFee" (
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" SERIAL NOT NULL,
    "exchangeId" INTEGER NOT NULL,
    "feeClass" TEXT NOT NULL DEFAULT 'default',
    "makerPpm" INTEGER NOT NULL,
    "takerPpm" INTEGER NOT NULL,
    "effectiveFrom" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "effectiveTo" TIMESTAMP(3),
    "sourceUrl" TEXT,

    CONSTRAINT "ExchangeFee_pkey" PRIMARY KEY ("id")
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
    "exchangeId" INTEGER NOT NULL,
    "pairId" INTEGER NOT NULL,
    "venueSymbol" TEXT NOT NULL,
    "status" "MarketStatus" NOT NULL DEFAULT 'ACTIVE',
    "feeClass" TEXT NOT NULL DEFAULT 'default',
    "tickSize" DECIMAL(38,18),
    "qtyStep" DECIMAL(38,18),
    "minNotional" DECIMAL(38,18),
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Market_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ArbitrageOpportunity" (
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "id" BIGSERIAL NOT NULL,
    "kind" "ArbitrageKind" NOT NULL DEFAULT 'CEX_CEX',
    "pairId" INTEGER NOT NULL,
    "buyMarketId" INTEGER NOT NULL,
    "sellMarketId" INTEGER NOT NULL,
    "openedAt" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3) NOT NULL,
    "durationMs" INTEGER NOT NULL,
    "samples" INTEGER NOT NULL,
    "openNetPpm" INTEGER NOT NULL,
    "avgNetPpm" INTEGER NOT NULL,
    "peakAt" TIMESTAMP(3) NOT NULL,
    "peakNetPpm" INTEGER NOT NULL,
    "peakBuyAsk" DECIMAL(38,18) NOT NULL,
    "peakSellBid" DECIMAL(38,18) NOT NULL,
    "peakQty" DECIMAL(38,18) NOT NULL,
    "peakNotionalQuote" DECIMAL(38,18) NOT NULL,
    "peakProfitQuote" DECIMAL(38,18) NOT NULL,
    "peakProfitUsd" DECIMAL(38,18),
    "buyTakerPpm" INTEGER NOT NULL,
    "sellTakerPpm" INTEGER NOT NULL,

    CONSTRAINT "ArbitrageOpportunity_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "Exchange_slug_key" ON "Exchange"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeConfig_exchangeId_key" ON "ExchangeConfig"("exchangeId");

-- CreateIndex
CREATE UNIQUE INDEX "ExchangeFee_exchangeId_feeClass_effectiveFrom_key" ON "ExchangeFee"("exchangeId", "feeClass", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "Pair_symbol_key" ON "Pair"("symbol");

-- CreateIndex
CREATE UNIQUE INDEX "Pair_base_quote_key" ON "Pair"("base", "quote");

-- CreateIndex
CREATE INDEX "Market_pairId_status_idx" ON "Market"("pairId", "status");

-- CreateIndex
CREATE INDEX "Market_exchangeId_status_idx" ON "Market"("exchangeId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Market_exchangeId_venueSymbol_key" ON "Market"("exchangeId", "venueSymbol");

-- CreateIndex
CREATE UNIQUE INDEX "Market_exchangeId_pairId_key" ON "Market"("exchangeId", "pairId");

-- CreateIndex
CREATE INDEX "ArbitrageOpportunity_openedAt_idx" ON "ArbitrageOpportunity"("openedAt");

-- CreateIndex
CREATE INDEX "ArbitrageOpportunity_pairId_openedAt_idx" ON "ArbitrageOpportunity"("pairId", "openedAt");

-- CreateIndex
CREATE INDEX "ArbitrageOpportunity_peakNetPpm_idx" ON "ArbitrageOpportunity"("peakNetPpm");

-- CreateIndex
CREATE INDEX "ArbitrageOpportunity_buyMarketId_sellMarketId_openedAt_idx" ON "ArbitrageOpportunity"("buyMarketId", "sellMarketId", "openedAt");

-- AddForeignKey
ALTER TABLE "ExchangeConfig" ADD CONSTRAINT "ExchangeConfig_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "Exchange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ExchangeFee" ADD CONSTRAINT "ExchangeFee_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "Exchange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_exchangeId_fkey" FOREIGN KEY ("exchangeId") REFERENCES "Exchange"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Market" ADD CONSTRAINT "Market_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "Pair"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArbitrageOpportunity" ADD CONSTRAINT "ArbitrageOpportunity_pairId_fkey" FOREIGN KEY ("pairId") REFERENCES "Pair"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArbitrageOpportunity" ADD CONSTRAINT "ArbitrageOpportunity_buyMarketId_fkey" FOREIGN KEY ("buyMarketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ArbitrageOpportunity" ADD CONSTRAINT "ArbitrageOpportunity_sellMarketId_fkey" FOREIGN KEY ("sellMarketId") REFERENCES "Market"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
