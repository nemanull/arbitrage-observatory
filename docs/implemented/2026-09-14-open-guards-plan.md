# Open Guards Implementation Plan

Date: 2026-09-14.
Status: Done.
Design of record: [`2026-09-14-open-guards-design.md`](./2026-09-14-open-guards-design.md).

## Scope guard

This work does not:

- Add a minimum episode age or touch flicker.
- Change any close rule, `closeReasonFor`, or the thresholds `MIN_NET_PPM`, `CLOSURE_NET_PPM`, `ANCHOR_SKEW_MS`, `ANCHOR_MAX_AGE_MS`.
- Add a column, an enum value or a migration.
  Refusals write no row, and the new issues never reach `anchorIssueAtOpen`.
- Change the walk in `ladderWalk.ts`.
- Change any venue poller other than coinbase.

Result: the engine, venue, feed and db suites pass, 266 tests in 17 suites, `tsc` is clean, and eslint and prettier are clean on the changed files.
One live request at 21:40 UTC mapped 131 rows from the INTX list, with TOWNS at index 0.001833 and mark 0.00184, BTC at 78813.4 and 78819, and AERO at 0.5733 and 0.5748.

## Task 1: Coinbase poller

Files: `server/src/venues/coinbase/anchor.ts`, `server/src/venues/coinbase/anchor.spec.ts`, `server/src/venues/coinbase/types.ts`.

- One call to the INTX instruments list replaces the Advanced products call.
- Skip entries whose type is not `PERP`, whose state is `DELISTED`, that carry no quote, or whose interval is not positive.
- Key by symbol plus `-INTX`, write the index, the mark guarded to 0 when not positive, `predicted_funding`, the interval from nanoseconds, and the next hour boundary after `ts`.
- `intervalMs` 2,000 with a trailing comment.
- The spec fixtures are one live list entry cut down, plus a spot, a delisted, a zero interval and a quoteless entry.

## Task 2: The move on the anchor block

Files: `server/src/engine/cluster/types.ts`, `server/src/engine/cluster/ClusterIndexBuilder.ts`, `server/src/engine/Engine.ts`, `server/src/engine/Engine.spec.ts`.

- `ClusterAnchor` gains `movePpm: Float64Array`, with a trailing comment saying what it holds and that it is unbounded until the second poll.
- `createClusterAnchor` allocates it.
- `updateAnchor` sets `anchor.movePpm[i]` from the slot's previous index and mark before it overwrites them, through one small function next to `anchorIssue` that returns `Infinity` when the slot has no previous index and otherwise the larger relative move in ppm.
  The move is the absolute difference over the previous value, in a two line helper, because the ratio form is not exact in doubles.
- Specs: the first poll reads as an unbounded move, the second poll records the larger of the index and mark moves, a poll that repeats the numbers records 0, and the untouched slots stay untouched.

## Task 3: The reader

Files: `server/src/engine/opportunity/anchorReading.ts`, `server/src/engine/opportunity/anchorReading.spec.ts`, `server/src/engine/opportunity/types.ts`, `server/src/db/conversion.ts`, `server/prisma/schema.prisma`.

- `AnchorIssue` gains `anchor_no_mark` and `anchor_moving`.
- `MAX_ANCHOR_MOVE_PPM = 1_000` beside the other reader constants, with a trailing comment naming the research doc.
- After the stale check: refuse `anchor_no_mark` when either slot's mark is not positive, then `anchor_moving` when either slot's `movePpm` exceeds the threshold.
- `readLeg` computes `markPremium` and `freshPremium` over the mark, `referencePrice` goes, and `carried` reads both mark premiums without a null fallback.
- `AnchorLeg.markPremium` becomes `number`, and its comment and the `mark` comment say a route only opens on a positive mark.
- `conversion.ts` writes the marks directly and drops `markOrNull`.
- The comment above the anchor columns in `schema.prisma` stays true, and the mark columns stay nullable for older rows.
  No migration.
- Specs: refuses a leg without a mark, refuses a leg that moved more than the threshold since its previous poll, accepts a leg that moved exactly the threshold, and the fallback and no-mark factor specs go.

## Task 4: The region floor

Files: `server/src/engine/opportunity/OpportunityManager.ts`, `server/src/engine/opportunity/OpportunityManager.spec.ts`.

- `MIN_EDGE_NOTIONAL = 1_000` beside `MIN_NET_PPM`, with a trailing comment naming the bestiary entry.
- `RejectionReason` gains `thin_book`.
- After the fresh gate, once `walkLadders` has run: refuse `thin_book` when the edge is null or its notional is under the floor, reporting the notional, the average edge and the size, with null where there was no depth.
- The anchor refusal log carries both legs' `movePpm`.
- Specs: the `tick` helper seeds one depth level from the bid and ask it writes, with a size large enough to clear the floor, only for a slot that holds no levels yet, so the ladder walk specs keep their own depth.
  New specs: refuses a route whose region is under the floor and says so, refuses a route while a leg holds no depth, refuses `anchor_no_mark` and `anchor_moving` with the reason and the moves in the payload.
  The spec that read a markless venue at its index becomes the no-mark refusal, and the spec that recorded no edge while a leg holds no depth becomes a refusal.
- `Engine.spec.ts`: `openRoute` opens through `updateBook` rather than `updateQuote`, since the floor reads the depth block, with 20 coins of region, and its agreed anchors are polled twice, since a slot's first poll refuses.
  The ladder walk specs of both files scaled their levels by ten for the same reason.

## Task 5: Verify

- `pnpm exec jest src/engine src/venues src/feeds src/db --forceExit` from `server/`, `pnpm typecheck`, eslint and prettier on the changed files.
- A one request live check of the coinbase mapping.
  Done, see the result line above.

## Task 6: Docs and reconcile

Files: `docs/bestiary/index-mark-and-premium.md`, `docs/bestiary/thin-book.md`, `docs/bestiary/standing-basis.md`, `server/src/venues/coinbase/coinbase.ts`, this plan, the design, `docs/README.md`.

- The venue table's coinbase row points at the INTX call with a mark, the `mark` column row and the reader paragraph describe the two new refusals and the floor, and the skew sentence says five seconds.
- One sentence in the thin book entry says the region floor refuses the open since this date.
- The standing basis entry's coinbase source line is updated.
- The coinbase feed comment no longer calls Advanced the only credential-free source.
- Reconcile both docs against what shipped, move them to `docs/implemented/`, and update `docs/README.md`.
