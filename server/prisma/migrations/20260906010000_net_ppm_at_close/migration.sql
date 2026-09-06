-- netPpmAtClose is the last reading before the episode ended.
-- No guard and no backfill: close_reason already requires an empty table, so no row predates this column.

-- AlterTable
ALTER TABLE "ArbitrageOpportunity" ADD COLUMN "netPpmAtClose" DOUBLE PRECISION NOT NULL;
