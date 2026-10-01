-- A route now closes when its fresh edge falls below the closure threshold, docs/implemented/2026-09-14-fresh-edge-verdict-design.md.
-- Earlier rows keep their reasons, and no row carries the new value until the engine writes one.

-- AlterEnum
ALTER TYPE "OpportunityCloseReason" ADD VALUE 'fresh_edge_collapsed';
