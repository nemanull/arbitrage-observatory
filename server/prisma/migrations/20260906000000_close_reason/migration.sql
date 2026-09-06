-- closeReason records why an episode ended, and from now on only these four things end one.
-- Rows written before this column existed were closed by a 5 s silence rule that no longer exists.
-- None of the four reasons describes those rows truthfully, so the migration refuses to label them and asks for an empty table instead.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM "ArbitrageOpportunity") THEN
    RAISE EXCEPTION 'ArbitrageOpportunity holds rows written before closeReason existed. Clear the table, then rerun the migration.';
  END IF;
END $$;

-- CreateEnum
CREATE TYPE "OpportunityCloseReason" AS ENUM ('spread_collapsed', 'feed_down', 'age_cap', 'shutdown');

-- AlterTable
ALTER TABLE "ArbitrageOpportunity" ADD COLUMN "closeReason" "OpportunityCloseReason" NOT NULL;
