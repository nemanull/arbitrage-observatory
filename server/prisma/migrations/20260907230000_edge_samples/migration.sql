-- The ladder walk lands on the row: the average edge over the region both books were paying for, at open, at its peak and at close, plus the per tick series.
-- Every new column is nullable or defaulted, so the 745 rows of the third run keep their meaning with no edge recorded.

-- AlterTable
ALTER TABLE "ArbitrageOpportunity"
  ADD COLUMN "edgeAvgPpmSeries" DOUBLE PRECISION[],
  ADD COLUMN "edgeNotionalSeries" DOUBLE PRECISION[],
  ADD COLUMN "edgeAvgPpmAtOpen" DOUBLE PRECISION,
  ADD COLUMN "edgeSizeAtOpen" DOUBLE PRECISION,
  ADD COLUMN "edgeNotionalAtOpen" DOUBLE PRECISION,
  ADD COLUMN "edgeExhaustedAtOpen" BOOLEAN,
  ADD COLUMN "edgeBuyLevelsAtOpen" INTEGER,
  ADD COLUMN "edgeSellLevelsAtOpen" INTEGER,
  ADD COLUMN "peakEdgeAvgPpm" DOUBLE PRECISION,
  ADD COLUMN "peakEdgeSize" DOUBLE PRECISION,
  ADD COLUMN "peakEdgeNotional" DOUBLE PRECISION,
  ADD COLUMN "peakEdgeExhausted" BOOLEAN,
  ADD COLUMN "peakEdgeAt" TIMESTAMP(3),
  ADD COLUMN "edgeAvgPpmAtClose" DOUBLE PRECISION,
  ADD COLUMN "edgeSizeAtClose" DOUBLE PRECISION,
  ADD COLUMN "edgeNotionalAtClose" DOUBLE PRECISION,
  ADD COLUMN "edgeExhaustedAtClose" BOOLEAN,
  ADD COLUMN "maxEdgeNotional" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "edgeSamples" INTEGER NOT NULL DEFAULT 0;

-- CreateIndex
CREATE INDEX "ArbitrageOpportunity_peakEdgeAvgPpm_idx" ON "ArbitrageOpportunity"("peakEdgeAvgPpm");

-- CreateIndex
CREATE INDEX "ArbitrageOpportunity_maxEdgeNotional_idx" ON "ArbitrageOpportunity"("maxEdgeNotional");
