-- The anchors land on the row, docs/bestiary/index-mark-and-premium.md: each leg's index, mark and funding at open, the fresh and standing edge at open, peak and close, the fresh edge per sample, and the anchors over the episode.
-- Every new column is nullable or an empty array, so earlier rows keep their meaning with no anchor recorded.

-- CreateEnum
CREATE TYPE "AnchorIssue" AS ENUM ('anchor_missing', 'anchor_stale', 'anchor_skewed');

-- AlterTable
ALTER TABLE "ArbitrageOpportunity"
  ADD COLUMN "highestBidIndexAtOpen" DOUBLE PRECISION,
  ADD COLUMN "highestBidMarkAtOpen" DOUBLE PRECISION,
  ADD COLUMN "highestBidFundingRateAtOpen" DOUBLE PRECISION,
  ADD COLUMN "highestBidFundingIntervalHours" DOUBLE PRECISION,
  ADD COLUMN "highestBidNextFundingAt" TIMESTAMP(3),
  ADD COLUMN "highestBidAnchorAt" TIMESTAMP(3),
  ADD COLUMN "lowestAskIndexAtOpen" DOUBLE PRECISION,
  ADD COLUMN "lowestAskMarkAtOpen" DOUBLE PRECISION,
  ADD COLUMN "lowestAskFundingRateAtOpen" DOUBLE PRECISION,
  ADD COLUMN "lowestAskFundingIntervalHours" DOUBLE PRECISION,
  ADD COLUMN "lowestAskNextFundingAt" TIMESTAMP(3),
  ADD COLUMN "lowestAskAnchorAt" TIMESTAMP(3),
  ADD COLUMN "anchorIssueAtOpen" "AnchorIssue",
  ADD COLUMN "freshNetPpmAtOpen" DOUBLE PRECISION,
  ADD COLUMN "standingPpmAtOpen" DOUBLE PRECISION,
  ADD COLUMN "freshNetPpmAtPeak" DOUBLE PRECISION,
  ADD COLUMN "standingPpmAtPeak" DOUBLE PRECISION,
  ADD COLUMN "freshNetPpmAtClose" DOUBLE PRECISION,
  ADD COLUMN "standingPpmAtClose" DOUBLE PRECISION,
  ADD COLUMN "freshNetPpmSeries" DOUBLE PRECISION[],
  ADD COLUMN "anchorTsMs" INTEGER[],
  ADD COLUMN "highestBidIndexSeries" DOUBLE PRECISION[],
  ADD COLUMN "highestBidMarkSeries" DOUBLE PRECISION[],
  ADD COLUMN "lowestAskIndexSeries" DOUBLE PRECISION[],
  ADD COLUMN "lowestAskMarkSeries" DOUBLE PRECISION[];

-- CreateIndex
CREATE INDEX "ArbitrageOpportunity_freshNetPpmAtOpen_idx" ON "ArbitrageOpportunity"("freshNetPpmAtOpen");
