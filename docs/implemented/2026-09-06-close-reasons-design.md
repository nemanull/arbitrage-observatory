# Close Reasons Design

Date: 2026-09-06.
Status: Done.
Research: [`../research/2026-09-06-second-run-data-audit.md`](../research/2026-09-06-second-run-data-audit.md) section 6, and [`../research/2026-09-05-arbitrage-opportunity-data-audit.md`](../research/2026-09-05-arbitrage-opportunity-data-audit.md) sections 3, 5 and 10.
Plan: [`2026-09-06-close-reasons-plan.md`](./2026-09-06-close-reasons-plan.md).

## Purpose

Before this change an episode ended when either leg had produced no sample for 5 s.
Every feed is change-driven, so on a quiet book 5 s of silence means the quote is unchanged, not unknown.
The engine therefore closed an opportunity because it was stable, and reopened it at the next change.
In the second run, 617 episodes on `ANTHROPIC`, `OPENAI` and `ONE` ended and not one of them ended because the spread fell below the closure threshold.
The row could not show this, because it did not record why it closed.

This design makes an episode end only for a reason a reader can verify, records that reason on the row, and moves quote freshness to the layer that can actually observe it.

## Scope

In scope:

- The close rules in `OpportunityManager` and the sweep in `Orchestrator`.
- The feed-down path from `VenueFeed` through `Engine.markStale`.
- A shutdown flush of open episodes.
- A `closeReason` column and migration.
- A bound on the per tick series, because the new rules make episodes long.

Out of scope:

- Per-market liveness inside a live socket, which is item 6 of the first audit.
- Per-leg ages, sizes, and index prices on the sample.
- Time-bucketed or decimated series.
- Linking consecutive age-capped chunks of one basis.

## Decisions

1. A leg is live when the feed says so, and wall-clock age plays no part.
   A leg is valid for discovery and for an open route exactly when `cluster.recvTs[i] > 0`.
   `VenueFeed.onClose` reports a dead socket by calling `Engine.markStale`, which sets `recvTs` to 0 for every market on that socket ([`server/src/ws/VenueFeed.ts:125`](../../server/src/ws/VenueFeed.ts), [`server/src/engine/Engine.ts:124`](../../server/src/engine/Engine.ts)).
   The first accepted frame after a reconnect restores it ([`server/src/engine/Engine.ts:109`](../../server/src/engine/Engine.ts)).
   `MAX_QUOTE_AGE_MS` is gone.
   Discovery skips a slot whose `recvTs` is 0 ([`server/src/engine/OpportunityManager.ts:488`](../../server/src/engine/OpportunityManager.ts) and `:512`).
2. Exactly four things end an episode, and each is recorded.
   `closeReasonFor` decides the tick path ([`server/src/engine/OpportunityManager.ts:299`](../../server/src/engine/OpportunityManager.ts)).
   `spread_collapsed`: the route's own reading fell below `CLOSURE_NET_PPM` on a tick (`:314`).
   `feed_down`: the socket carrying one of the legs closed.
   `age_cap`: the episode reached `MAX_OPPORTUNITY_AGE_MS`, on the tick path (`:318`) or from the sweep.
   `shutdown`: the orchestrator stopped.
   Silence is not on the list.
3. `feed_down` is event-driven.
   `Engine.markStale` closes every open route with a leg on one of the dead markets in the same call that zeroes their `recvTs`, through `closeOpportunitiesOnVenue` ([`server/src/engine/OpportunityManager.ts:334`](../../server/src/engine/OpportunityManager.ts)).
   `closeVenue`, which production never called, is gone.
   A whole-venue close would be too coarse, because a venue runs several sockets and only one of them died.
   The tick path keeps a guard that returns `feed_down` if an open route ever has a leg with `recvTs` 0 (`:310`), which documents the invariant rather than a reachable path.
4. The sweep enforces only the age cap ([`server/src/engine/OpportunityManager.ts:325`](../../server/src/engine/OpportunityManager.ts)).
   It stays on the 1 s timer at [`server/src/orchestrator.ts:109`](../../server/src/orchestrator.ts), because a route whose legs stop changing has no tick left to reach it.
   The cap is a chunk boundary rather than the end of a basis: the tick that closes the old episode runs discovery and opens the next one.
5. Shutdown flushes instead of dropping.
   `Orchestrator.stop` clears the sweep timer, stops the feeds, closes every open route with `shutdown`, and awaits the queue writes before returning ([`server/src/orchestrator.ts:137`](../../server/src/orchestrator.ts)).
   The feeds are stopped first so no new episode can open behind the flush.
   Their socket close events land later and find nothing open.
   `stop` runs from `beforeApplicationShutdown` (`:67`), which Nest completes for every module before any `onApplicationShutdown`, and `BullModule` closes the queue in `onApplicationShutdown` ([`server/node_modules/@nestjs/bullmq/dist/bull.providers.js:51`](../../server/node_modules/@nestjs/bullmq/dist/bull.providers.js)).
   `OpportunityManager` keeps the set of in-flight queue writes ([`server/src/engine/OpportunityManager.ts:40`](../../server/src/engine/OpportunityManager.ts)), so `shutdown` (`:368`) also waits for closes that were still being enqueued when the signal arrived.
   The tick path keeps not awaiting a write, for the reason stated at `:443`.
   The engine ignores quotes once shutdown has begun ([`server/src/engine/Engine.ts:59`](../../server/src/engine/Engine.ts)), so a frame already buffered by a closing socket cannot open a route that nothing would flush.
6. `closeReason` is a Prisma enum with the same lowercase values as the engine union, so nothing maps between them.
   The column is `NOT NULL`.
   The migration refuses to run while the table has rows, because a row closed by the old silence rule cannot be labelled with any of the four reasons truthfully.
   The table is cleared between experimental runs today, so this costs nothing in practice.
7. The four series are capped at `MAX_SERIES_LENGTH = 10 000` samples and the aggregates keep counting ([`server/src/engine/OpportunityManager.ts:23`](../../server/src/engine/OpportunityManager.ts), `:288`).
   Without a cap, decision 2 lets a single 5 minute chunk of `OPENAI` reach about 130 000 samples, at the 436 samples per second measured in the second run.
   The cap keeps the first 10 000 samples.
   `ticks`, `avgNetPpm`, `peakNetPpm`, `minNetPpm` and `lastSeenAt` are still computed over every tick.
   `minNetPpm` is a running value on the `Opportunity`, next to `peakNetPpm`, and the row reads it from there ([`server/src/db/conversion.ts:47`](../../server/src/db/conversion.ts)).
   The invariant `ticks = |sampleTsMs|` becomes `|sampleTsMs| = min(ticks, 10 000)`.
   The longest series in either run so far is 4 135 samples, so no observed row would have lost anything.
8. The identical-repeat dedupe in `Engine.updateQuote` stays, without its time window ([`server/src/engine/Engine.ts:98`](../../server/src/engine/Engine.ts)).
   A repeat is dropped whenever the slot is live, and it refreshes `recvTs`.
   A repeat that arrives after `markStale` is not a repeat of a live quote, so it re-validates the leg and runs discovery.
9. Every close logs its reason.
   `opportunity_closed` carries `reason` and `minNetPpm`.
   `markStale` logs `feed_down_closed_opportunities` with the venue, the number of markets on the socket, and the number of routes it closed, when that number is not zero.
   `sweep_closed_opportunities` keeps its name and now means age-capped routes.
   `orchestrator_stopped` carries the number of routes flushed.

## Rejected alternatives

- Lengthen `MAX_QUOTE_AGE_MS`.
  A longer window still closes on silence, only less often, and the row still cannot say why it closed.
- Refresh `lastSeenAt` on deduped repeats, which is the two-clocks fix from the first audit.
  It only helps on a venue that re-sends identical frames.
  Binance `bookTicker` and OKX `bbo-tbt` send nothing while the book is unchanged, so the sweep would still close their routes.
- A per-market silence watch inside the feed.
  No venue publishes a per-market heartbeat, so per-market silence is not observable as liveness.
  A subscription that dies inside a live socket remains the residual risk of this design.
  It shows up as an age-capped episode whose leg never moved, and it belongs to item 6 of the first audit.
- A nullable `closeReason`.
  Honest for old rows, but every reader would carry the null forever, and the table is cleared between runs anyway.
- A decimated or time-bucketed series instead of a cap.
  That is the right long-term shape and is item 8 of the first audit.
  The cap is the boring bound that could land with this change.
- Skipping a sample that is identical to the previous one.
  Safe and worth doing, but it changes what `ticks` counts, so it is a separate change.

## Follow-ups

- Skip identical consecutive samples, which were 46% of all samples in the first audit.
- Time-bucketed series, so a long episode keeps its whole shape.
- Per-market liveness, with subscribe acknowledgement correlation and a per-market last quote time.
- A link between consecutive age-capped chunks of one basis.
- Each leg's index price on the sample, so a reference gap can be separated from an edge in a query.
