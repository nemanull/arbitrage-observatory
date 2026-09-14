# Fresh Edge Verdict Implementation Plan

Date: 2026-09-14.
Status: Done.
Design of record: [`2026-09-14-fresh-edge-verdict-design.md`](./2026-09-14-fresh-edge-verdict-design.md).

## Scope guard

This work does not:

- Add a minimum episode age or touch flicker.
- Change `MIN_NET_PPM`, `CLOSURE_NET_PPM`, `MAX_OPPORTUNITY_AGE_MS` or `ANCHOR_MAX_AGE_MS`.
- Drop the `anchorIssueAtOpen` column or the `AnchorIssue` enum.
- Classify funding or settlement instants.
- Change any venue poller's cadence.
- Apply the migration to a database.

## Task 1: Poller timestamp and skew

Files: `server/src/feeds/anchor/AnchorPoller.ts`, `server/src/feeds/anchor/AnchorPoller.spec.ts`, `server/src/engine/opportunity/anchorReading.ts`.

- `round` passes `Date.now()` taken after `fetchRound` resolves to `apply`, and keeps the round start for the pause check and `fetchRound`.
- `ANCHOR_SKEW_MS` becomes 5,000.
- The spec asserts the reply time instead of the round start.
- The spec imports `HttpStatusError` from `server/src/shared/errors.ts`, where the error now lives, which also clears two failures that predate this work.

## Task 2: Engine types

Files: `server/src/engine/opportunity/types.ts`, `server/src/db/conversion.ts`.

- `CloseReason` gains `fresh_edge_collapsed`.
- `Observation.anchor` becomes `AnchorPair`, and `Observation.anchorIssue` is removed.
- `Opportunity.anchorAtOpen` becomes `AnchorPair`, and `Opportunity.anchorIssueAtOpen` is removed.
- `toOpportunityRow` reads the open anchor without null checks and writes `anchorIssueAtOpen` as null.

## Task 3: Discovery

Files: `server/src/engine/opportunity/OpportunityManager.ts`.

- An `AnchorIssue` from `readAnchorPair` is reported through `reportRejection` with the issue as the reason, and discovery returns.
- `watchIndexGap`, `skipsQuarantined`, `IndexWatch`, `indexWatches` and the five quarantine constants are removed.

## Task 4: Lifecycle

Files: `server/src/engine/opportunity/OpportunityLifecycle.ts`.

- `createNewOpportunity` fills the anchor series from the open anchor without null checks.
- `closeReasonFor` takes the sample's `AnchorPair` or null and returns `fresh_edge_collapsed` when it is readable and its `freshNetPpm` is under `CLOSURE_NET_PPM`, after `spread_collapsed` and before `age_cap`.
- `updateOpportunity` passes the sample's anchor to `closeReasonFor`.

## Task 5: Schema

Files: `server/prisma/schema.prisma`, `server/prisma/migrations/20260914120000_fresh_edge_close/migration.sql`, `server/src/db/generated/prisma/`.

- Add `fresh_edge_collapsed` to `OpportunityCloseReason`.
- The migration is one `ALTER TYPE ... ADD VALUE`.
- Update the anchor column comment that says a route opened unjudged.
- Run `prisma generate`.

## Task 6: Specs

Files: `server/src/engine/opportunity/OpportunityManager.spec.ts`, `server/src/engine/Engine.spec.ts`.

- The manager spec's cluster carries agreeing anchors that the pollers keep writing, so the specs that open routes still open them.
- The unjudged open specs become refusal specs, one per issue, and a new spec opens on two anchors read four seconds apart.
- The quarantine block is removed.
- New specs: a route closes as `fresh_edge_collapsed` when its anchors move under the book, and an unreadable sample does not close it.
- The trackOpportunity and series cap specs pass an agreeing `AnchorPair`.
- The Engine spec writes agreeing anchors through `Engine.updateAnchor` before it opens a route.

## Task 7: Docs and reconcile

Files: `docs/bestiary/index-mark-and-premium.md`, this plan, the design, `docs/README.md`.

Result: the engine, feed, venue, db and ccxt suites pass, 259 tests in 18 suites, and `tsc` and `eslint` are clean on the changed files.

- Rewrite the reader paragraph and the status line in the bestiary entry.
- Reconcile both docs against what shipped, move them to `docs/implemented/`, and add their lines to `docs/README.md`.
