# Close Reasons Implementation Plan

Date: 2026-09-06.
Status: Done.
Design of record: [`2026-09-06-close-reasons-design.md`](./2026-09-06-close-reasons-design.md).

## Scope guard

This work does not:

- Add per-leg ages, sizes, or index prices to the sample.
- Change `MIN_NET_PPM`, `CLOSURE_NET_PPM`, or `MAX_OPPORTUNITY_AGE_MS`.
- Add per-market liveness inside a live socket.
- Decimate or bucket the series.
- Link consecutive age-capped episodes.
- Touch the cluster overrides or the plausibility ceiling.

## Task 1: Schema and migration

Files: `server/prisma/schema.prisma`, `server/prisma/migrations/20260906000000_close_reason/migration.sql`.

- Add `enum OpportunityCloseReason { spread_collapsed feed_down age_cap shutdown }`.
- Add `closeReason OpportunityCloseReason` to `ArbitrageOpportunity` after `closedAt`.
- Update the `lastSeenAt` and `ticks` column comments to the new meaning.
- Write the migration by hand in the style of `20260819000000_venue_core`.
  It raises if the table has rows, creates the enum, and adds the column `NOT NULL`.
- Run `prisma generate` so the client type carries the column.

## Task 2: Engine types and OpportunityManager

Files: `server/src/engine/types.ts`, `server/src/engine/OpportunityManager.ts`, `server/src/db/conversion.ts`.

- Add `CloseReason` to the types and `closeReason: CloseReason | null` and `minNetPpm: number` to `Opportunity`.
- Delete `MAX_QUOTE_AGE_MS`.
- Add `MAX_SERIES_LENGTH = 10_000` and apply it in `recordSample`.
- Track `minNetPpm` in `createNewOpportunity` and `recordSample`.
- Replace `shouldOpportunityBeClosed` with `closeReasonFor`, which returns `feed_down`, `spread_collapsed`, `age_cap`, or `null`.
- `closeOpportunity` takes the reason, stores it, and logs it.
- `sweep` closes only routes past `MAX_OPPORTUNITY_AGE_MS`.
- Replace `closeVenue` with `closeOpportunitiesOnVenue(pair, venueIndex, now)`.
- Add `shutdown(now)`, which closes every open route with `shutdown` and awaits the in-flight queue writes.
- Discovery skips a leg whose `recvTs` is 0 instead of one older than the window.
- `toOpportunityRow` writes `closeReason` and reads `minNetPpm` from the opportunity.

## Task 3: Engine

Files: `server/src/engine/Engine.ts`.

- Drop the time window from the dedupe and keep the identical-repeat drop for a live slot.
- `markStale` zeroes `recvTs` and closes the routes on each affected cluster, then logs one line per call.
- Add `shutdown(now)` and an `ignore quotes after shutdown` flag.
- Update the comment on `sweep`.

## Task 4: Orchestrator

Files: `server/src/orchestrator.ts`.

- `stop` becomes async: clear the timer, stop the feeds, `await engine.shutdown(Date.now())`, log the count.
- Replace `onApplicationShutdown` with `beforeApplicationShutdown`.

## Task 5: Tests

Files: `server/src/engine/OpportunityManager.spec.ts`, `server/src/engine/Engine.spec.ts`, and the five venue specs' comment on `recvTs`.

- Fill `bidMul` and `askMul` in the Engine spec fixture, so the opportunity path is reachable.
- A quiet route stays open, and the sweep does not close it.
- The sweep and the tick path close at the age cap with `age_cap`, and the same tick reopens the route.
- A collapse closes with `spread_collapsed` and the row carries it.
- `closeOpportunitiesOnVenue` closes with `feed_down`, and discovery ignores a leg with `recvTs` 0.
- `shutdown` closes with `shutdown` and awaits the queue.
- The series stops at `MAX_SERIES_LENGTH` while `ticks`, `peakNetPpm` and `minNetPpm` keep moving.
- `Engine.updateQuote` drops an identical repeat at any age and accepts one after `markStale`.
- `Engine.markStale` closes the open routes on the dead markets.
- `Engine.shutdown` ignores later quotes.

## Task 6: Verification

- `npx jest` on the engine specs and the venue specs, with `--forceExit`.
- `npx tsc --noEmit`.
- `npx eslint` and `npx prettier --check` on the changed files.
- Apply the migration chain to a scratch database, so the hand-written SQL is proven to run, then drop it.

## Task 7: Reconcile

- Re-resolve every `file:line` citation in the design against the final code.
- Update [`../WIKI.md`](../WIKI.md) with the four close reasons.
- Move the design and this plan to `implemented/` and update [`../README.md`](../README.md).

## Reconciliation

Every task shipped as written, with these notes.

- Task 1: the migration was proven twice.
  The full chain applied to an empty scratch database and produced the enum and a `NOT NULL` column, and a row inserted with `age_cap` was accepted.
  The guard was run as a standalone block against the live table, which held 1 291 rows, and it raised with the intended message.
  The local database was not migrated, because it holds those rows.
- Task 2: `closeReasonFor` is public rather than private, so a test can assert a reason without driving a tick.
  `shutdown` waits with `Promise.allSettled`, so a failed enqueue, which is already logged, cannot hold the process open.
- Task 3: `markStale` logs only when it closed at least one route, because the feed already logs every reconnect and a socket that closes with nothing open would otherwise add a line per attempt.
- Task 4: `stop` stops the feeds before the flush, and `Engine.shutdown` sets a flag that drops any frame a closing socket still delivers.
- Task 5: 89 tests pass across the engine, venue and ccxt specs.
  The persistence test asserts `minNetPpm` below the closure threshold instead of an exact number, because the collapsing sample is a derived float.
- Task 6: `tsc`, `eslint` and `prettier` are clean on every changed file.
- The `Engine.spec.ts` fixture fix, item 0 of the first audit's order of repair, landed here.
