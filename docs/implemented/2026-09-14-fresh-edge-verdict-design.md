# Fresh Edge Verdict Design

Date: 2026-09-14.
Status: Done.
Plan: [`2026-09-14-fresh-edge-verdict-plan.md`](./2026-09-14-fresh-edge-verdict-plan.md).
Vocabulary: [`../bestiary/index-mark-and-premium.md`](../bestiary/index-mark-and-premium.md) and [`../bestiary/standing-basis.md`](../bestiary/standing-basis.md).

## Purpose

The fresh edge is the net edge after fees once each book is divided by its own anchor, and it is the only part of a cross a taker can capture.
Since 2026-09-10 the engine refuses to open a route whose fresh edge is under `MIN_NET_PPM`.
Two holes still let a standing basis into the table and keep it there for five minutes.

The first hole is at open.
A route whose anchors cannot be read opens anyway with no anchor, so the gate never runs.
The second hole is after open.
Nothing reads the fresh edge again, and the route closes only when the raw cross falls under `CLOSURE_NET_PPM`, which a basis never does.

This design makes the fresh edge the verdict at both ends of an episode.

## Evidence

The fifth run, from 2026-09-11 23:00 to 2026-09-12 10:00 UTC, wrote 92 `age_cap` rows.

- 89 of them opened with `anchorIssueAtOpen = anchor_skewed`, and every one sits on a bybit route.
  82 of the 89 closed with a fresh edge under `MIN_NET_PPM`.
- 3 of them opened judged, with a fresh edge between 5,022 and 8,198 ppm, and closed with a fresh edge between -1,594 and -1,405 ppm while the raw cross stayed above 4,000 ppm.
- Row 1365, `IOST|USDT` bybit-binance, opened skewed at 23:22:51.600.
  Its fresh series is unreadable for the first three samples and negative on every readable sample from 313 ms to 300 s, between about -600 and -2,500 ppm.
  Its raw cross stayed between 3,100 and 7,500 ppm, so it ran to the age cap.

The skew comes from the poller.
Bybit polls every two seconds and the other venues every second.
`writtenAt` was the round start, taken before the request, and a bybit round averaged about 700 ms.
So for part of every bybit cycle the two legs read further apart than `ANCHOR_SKEW_MS`, which was 2.5 s.

The index quarantine landed on 2026-09-13, after the fifth run, and no run long enough to judge it has happened since.
It read the same `AnchorPair` the fresh gate reads, so it ran only when the anchors were readable and only at open.
It closed neither hole.

## Decisions

1. A route opens only on a readable verdict.
   When `readAnchorPair` returns `anchor_missing`, `anchor_skewed` or `anchor_stale`, discovery refuses the route and reports the refusal with the issue as its reason.
   A poller outage therefore produces no rows, not unjudged rows.
   Built at [`server/src/engine/opportunity/OpportunityManager.ts:103`](../../server/src/engine/opportunity/OpportunityManager.ts), with the issue added to `RejectionReason` at `:13`.
2. An open route closes when its fresh edge falls under `CLOSURE_NET_PPM`.
   The new close reason is `fresh_edge_collapsed`.
   A sample whose anchors cannot be read does not close the route, and the raw cross, the feed and the age cap still close it.
   The order in `closeReasonFor` is `feed_down`, `spread_collapsed`, `fresh_edge_collapsed`, `age_cap`.
   Built at [`server/src/engine/opportunity/OpportunityLifecycle.ts:300`](../../server/src/engine/opportunity/OpportunityLifecycle.ts), and `updateOpportunity` passes the sample's anchor at `:213`.
3. The index quarantine is removed.
   A cross the index gap explains already fails the fresh gate, so the watch only ever added the refusal of a fresh edge that sits on top of an index gap.
   A perp to perp trade moves no coins, so that fresh edge can still close.
   `watchIndexGap`, `skipsQuarantined`, `IndexWatch` and the five quarantine constants are gone from `OpportunityManager`, which is 258 lines.
4. `writtenAt` is the time the poll reply arrived, not the round start.
   Built at [`server/src/feeds/anchor/AnchorPoller.ts:105`](../../server/src/feeds/anchor/AnchorPoller.ts).
   The round start still drives the pause check and `fetchRound`.
5. `ANCHOR_SKEW_MS` is 5,000.
   Indexes move slowly, and the fabricated gaps in the fourth run audit came from reads three minutes apart.
   `ANCHOR_MAX_AGE_MS` stays at 10,000.
   Built at [`server/src/engine/opportunity/anchorReading.ts:4`](../../server/src/engine/opportunity/anchorReading.ts).
6. The engine types carry the invariant.
   `Observation.anchor` and `Opportunity.anchorAtOpen` are an `AnchorPair` and never null, and `anchorIssue` leaves both types.
   The `anchorIssueAtOpen` column and the `AnchorIssue` enum stay in the schema for earlier rows, and new rows write the column as null ([`server/src/db/conversion.ts:99`](../../server/src/db/conversion.ts)).
7. `fresh_edge_collapsed` is a new value of the `OpportunityCloseReason` enum, added by a migration.
   The close rule needs no schema, but the row stores its label, and Postgres refuses a label the enum does not list.
   Built at [`server/prisma/schema.prisma:78`](../../server/prisma/schema.prisma) and [`server/prisma/migrations/20260914120000_fresh_edge_close/migration.sql`](../../server/prisma/migrations/20260914120000_fresh_edge_close/migration.sql).
   The migration is not applied by this work.

## Rejected alternatives

- Open an unreadable route and judge it on its first readable sample.
  It still writes short rows, and it keeps the unjudged path alive in the lifecycle.
- Close a route on an unreadable sample.
  A skewed bybit sample would end a real episode.
- Keep the quarantine.
  It closes neither hole and duplicates the fresh gate for every row the table has shown.
- Reuse `spread_collapsed` for the fresh close.
  It saves a migration, and the table can then no longer say which rule ended an episode.
- Only widen the skew, or only move the timestamp.
  Either alone leaves a bybit cycle close to the tolerance.

## Scope

In scope: the open gate, the close rule, the quarantine removal, the poller timestamp, the skew tolerance, the engine types, the enum value, the specs, and the bestiary text that describes the reader.

Out of scope: flicker and `MIN_EPISODE_MS` ([issue #12](https://github.com/nemanull/arbitrage-observatory/issues/12)), funding classification, dropping the `anchorIssueAtOpen` column, and any change to `MIN_NET_PPM`, `CLOSURE_NET_PPM` or `MAX_OPPORTUNITY_AGE_MS`.
