-- The cross factors into three parts, docs/bestiary/index-mark-and-premium.md: the index gap, the accepted premiums' gap, and the fresh edge already on the row.
-- The two new factors land at open, peak and close, and each leg's fresh premium at open says which book sits off its anchor.
-- Every new column is nullable, so earlier rows keep their meaning with no factor recorded.

-- AlterTable
ALTER TABLE "ArbitrageOpportunity"
  ADD COLUMN "highestBidFreshPremiumAtOpen" DOUBLE PRECISION,
  ADD COLUMN "lowestAskFreshPremiumAtOpen" DOUBLE PRECISION,
  ADD COLUMN "indexGapPpmAtOpen" DOUBLE PRECISION,
  ADD COLUMN "carriedPpmAtOpen" DOUBLE PRECISION,
  ADD COLUMN "indexGapPpmAtPeak" DOUBLE PRECISION,
  ADD COLUMN "carriedPpmAtPeak" DOUBLE PRECISION,
  ADD COLUMN "indexGapPpmAtClose" DOUBLE PRECISION,
  ADD COLUMN "carriedPpmAtClose" DOUBLE PRECISION;
