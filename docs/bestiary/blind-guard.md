# Blind guard

A guard that refuses to judge a measurement, wired into the path that opens a position and not into the path that closes one.
During exactly the event it was built for it keeps the engine out of new routes, and it keeps the engine inside every route it already holds.

## The row

Row 2795 of the fifth run, from [`../audits/2026-09-15-fifth-run-data-audit.md`](../audits/2026-09-15-fifth-run-data-audit.md).

| field | value |
|---|---|
| pair | `AERO\|USDT` |
| route | okx-bybit |
| opened | 18:37:10.608 UTC |
| duration | 5,454 ms |
| net ppm at open | 5,340 |
| net ppm at close | -861 |
| fresh net ppm at open | 6,656 |
| fresh net ppm at close | null |
| close reason | `spread_collapsed` |
| samples with no anchor reading | 164 of 165 |
| entries in `anchorTsMs` | 1 |

Eight samples of the episode, with the fee adjusted prices divided back out.

| t (ms) | okx bid | bybit ask | net ppm | fresh ppm |
|---:|---|---|---:|---|
| 0 | 0.535000 | 0.531600 | 5,340 | 6,656 |
| 298 | 0.535000 | 0.531700 | 5,151 | blind |
| 1,268 | 0.534800 | 0.528000 | 11,816 | blind |
| 1,627 | 0.535000 | 0.530200 | 7,994 | blind |
| 2,151 | 0.534400 | 0.529200 | 8,766 | blind |
| 3,194 | 0.532900 | 0.529800 | 4,796 | blind |
| 5,366 | 0.532200 | 0.529500 | 4,044 | blind |
| 5,454 | 0.529600 | 0.529500 | -861 | blind |

One sample of the 165 carries a fresh reading, and it is the sample that opened the route.
Every sample after 298 ms is stored as -2,000,000, which is the marker for a sample where no anchor could be read.

The anchors behind the whole episode are four numbers, all written before it started.
The okx index was 0.5379 and the okx mark 0.5346, read at 18:37:09.484.
The bybit index was 0.535 and the bybit mark 0.5353, read at 18:37:10.046.
`anchorTsMs` holds a single zero, so the row states that neither leg's index or mark changed across 5.45 seconds of a market wide flash crash.

The book behind the row is not what the row shows either, because 18:37 was a flash drop on every venue in the same second and AERO fell 1.6 to 2.0 percent.
The last okx taker sell at or above 0.5349 was at 18:37:09.357, and okx printed 0.5286 to 0.5325 during 18:37:10.
The okx leg of this row sits 3.7 seconds behind its own trade tape, so the 0.535 bid it was selling into had stopped existing before the row opened.

That lag is the class of the row, and it is not what this entry is about.
The question here is why a row built on a dead price ran five and a half seconds at 4,000 to 5,000 ppm raw.

## The mechanism

Each leg carries an anchor, meaning the venue's own index and mark, described in [`index-mark-and-premium.md`](./index-mark-and-premium.md).
The fresh edge divides each book by its own anchor, so it measures the part of a cross that the two anchors do not already explain.

A REST poller refreshes those anchors every 1,000 ms, and every 2,000 ms on bybit and coinbase, set by `DEFAULT_INTERVAL_MS` at [`../../server/src/feeds/anchor/AnchorPoller.ts`](../../server/src/feeds/anchor/AnchorPoller.ts) line 7 and by those two venue pollers.
Every poll records how far that leg moved since the previous poll, at [`../../server/src/engine/Engine.ts`](../../server/src/engine/Engine.ts) line 413, taking the larger of the index move and the mark move.

The guard is one branch in [`../../server/src/engine/opportunity/anchorReading.ts`](../../server/src/engine/opportunity/anchorReading.ts).

```ts
  // On a fast tape the fresh edge measures one anchor's lag behind the other rather than the book.
  if (
    anchor.movePpm[sellIndex] > MAX_ANCHOR_MOVE_PPM ||
    anchor.movePpm[buyIndex] > MAX_ANCHOR_MOVE_PPM
  ) {
    return 'anchor_moving';
  }
```

`MAX_ANCHOR_MOVE_PPM` is 1,000 at line 6 of the same file.
The reasoning is sound and it was measured before it shipped.
One poll flips the fresh edge by that leg's whole one poll move, and during the crash of [`../research/2026-09-14-open-guard-sizing.md`](../research/2026-09-14-open-guard-sizing.md) that move was 2,500 to 16,000 ppm.
So on a fast tape a fresh reading says which poller answered last rather than what the books did, and the right answer is to decline to judge it.

The value it writes is sticky, because `movePpm` holds whatever the last poll wrote until the next poll overwrites it.
One violent poll therefore blinds every book sample that lands in the gap behind it.
Row 2795 took 164 book samples in that gap.

## Why the engine cannot see it

The refusal reaches the open path as a string and the close path as nothing at all.

On the open path, [`../../server/src/engine/opportunity/OpportunityManager.ts`](../../server/src/engine/opportunity/OpportunityManager.ts) line 123 says "No verdict, no row", and the string becomes a counted rejection with its own name.

On the close path the same string is thrown away one line after it arrives, in [`../../server/src/engine/opportunity/OpportunityLifecycle.ts`](../../server/src/engine/opportunity/OpportunityLifecycle.ts) line 196.

```ts
const anchor = typeof anchorRead === 'string' ? null : anchorRead;
```

From there the null travels to the close rule, whose parameter comment states the behaviour outright at line 305.

```ts
    anchor: AnchorPair | null, // null when this sample's anchors could not be read, which closes nothing
```

Line 320 is the rule itself, and it can only fire on a non null anchor.

```ts
    if (anchor !== null && anchor.freshNetPpm < CLOSURE_NET_PPM) {
      return 'fresh_edge_collapsed';
    }
```

So the fresh close is switched off for exactly as long as the fresh open is, and the raw cross is the only rule left.
On row 2795 the raw cross stayed above the closure threshold until the last sample.

The same null then silently edits the row.
Line 248 stores it as `lastAnchor`, which is what line 453 reads to write `freshNetPpmAtClose`.
Line 279 stores it as `peakAnchor` whenever the peak lands on a blind sample.
Line 296 writes the -2,000,000 marker into the series.
Line 250 guards the anchor history, so a blind sample appends nothing to `anchorTsMs`.

That last one is the worst of the four, because a poll that moved more than 1,000 ppm is the strongest possible evidence that an anchor changed.
It is the exact condition under which the row records that no anchor changed.

## What the row says instead

Four consequences land on the table itself, and three of them are in the audit's list of misleading columns in section 4.

- `freshNetPpmAtClose` is null on 15 rows and `freshNetPpmAtPeak` on 14, because the closing or peak sample was blind.
- `anchorTsMs` of a single zero says nothing moved, on rows where the anchors were moving hard enough to blind the reader.
- `closeReason` of `fresh_edge_collapsed` on 25 of the 32 fresh closes names the poll that landed rather than a convergence, and the raw cross read 4,204 to 21,974 on those closing samples.
- The row carries no field saying why it went blind, because the reason string never survives line 196.

The deferral was visible before it shipped, because the sizing research recorded that 22 of 28 LSK fresh closes sat within one cadence of a move over 1,000 ppm, "so those closes would defer".
It was written down as a cost of the open guard and not as a property of the close path.

## The general lesson

A refusal is a statement about the measurement, not about the market, and it has to reach every decision that consumes that measurement.
A guard placed only where state is created, and not where state is destroyed, turns "I cannot tell" into "nothing has changed".
Uncertainty becomes persistence, and it does so at the worst moment, because a guard fires hardest during the event it was built for.

Any system with an open path and a close path has this shape available to it.
For every input a decision refuses to trust, find the decision that undoes it, and check that the refusal is wired there too.

## How to detect it

Three rules, and none of them needs a measurement the process does not already have.

1. Count consecutive blind samples on the open row.
   In the stored data this is a run of -2,000,000 in `freshNetPpmSeries`, and in the process it is one integer on the `Opportunity` object.
2. Close a route that has been blind for longer than one anchor cadence.
   That is 1,000 ms for binance, okx and krakenfutures, and 2,000 ms for bybit and coinbase.
   A route the engine has been unable to judge for a full refresh of both legs is not a route it should still be holding.
3. Record the last refusal reason on the row.
   The string exists at line 196 and dies there.

The third rule needs a schema change, and its shape is worth reading.
[`../../server/prisma/schema.prisma`](../../server/prisma/schema.prisma) declares `AnchorIssue` at line 85 with three values, `anchor_missing`, `anchor_stale` and `anchor_skewed`.
The engine's own type at [`../../server/src/engine/opportunity/types.ts`](../../server/src/engine/opportunity/types.ts) line 38 has five, because the guards added on 2026-09-14 introduced `anchor_no_mark` and `anchor_moving`, so the database cannot spell the two newest refusals at all.
The only column of that type is `anchorIssueAtOpen` at line 192, and its doc comment says it exists for rows written before a route had to open on readable anchors.
There is no column for a mid episode refusal and no enum value for the refusal that dominates the run, so detecting this failure means adding both.

## How common it was

The fifth run refused 3,155,976 opens and wrote 66 rows.
`anchor_moving` accounts for 1,391,547 of those refusals, second only to a standing basis at 1,754,420.

Inside the 66 rows that did open, 2,799 of the 5,032 samples are blind, which is 55.6 percent.
22 of the 66 rows are at least half blind.

The three rows whose blind share the audit names.

| id | pair | route | duration | blind samples | `anchorTsMs` entries | closed | net at close | fresh at close |
|---:|---|---|---:|---|---:|---|---:|---|
| 2770 | LSK | bybit-binance | 11,194 ms | 469 of 483 | 2 | `fresh_edge_collapsed` | 15,476 | 298 |
| 2795 | AERO | okx-bybit | 5,454 ms | 164 of 165 | 1 | `spread_collapsed` | -861 | null |
| 2801 | SIREN | bybit-binance | 13,551 ms | 98 of 107 | 4 | `fresh_edge_collapsed` | 7,475 | -1,448 |

Rows 2770 and 2801 show the other half of the shape, because both closed on a fresh reading taken on one of the few samples that could see anything, with the raw cross still at 1.5 and 0.75 percent.
A route that is blind most of the time closes when the blindness happens to lift, which is not the same event as a cross going away.

The sizing research had measured unreadable time outside LSK at 5.8 percent of binance moves, 17.9 percent of bybit and 7.6 percent of kraken, with none on okx or coinbase.
Those shares came from a tape that was mostly quiet, and the guard's cost concentrates in the minutes when it is doing its job.

## Related

- [`index-mark-and-premium.md`](./index-mark-and-premium.md) defines the anchors and the fresh edge that this guard refuses to compute.
- [`lagging-view.md`](./lagging-view.md) is what row 2795 actually was, and this entry is why it stayed open.
- [`standing-basis.md`](./standing-basis.md) is the class the fresh gate exists to refuse, and it is what keeps a raw cross open while the fresh rule is blind.
- [`slow-venue-resting-order.md`](./slow-venue-resting-order.md) and [`flicker.md`](./flicker.md) are two other classes present in the same run's rows.

## Evidence

- The blind sample counts and the misleading columns: sections 0, 3 and 4 of [`../audits/2026-09-15-fifth-run-data-audit.md`](../audits/2026-09-15-fifth-run-data-audit.md).
- Row 2795 and the AERO okx tape: sections 2a and 9 of the same document, with the refusal counts and the close reason mix in section 0.
- The threshold, the artifact model and the deferred closes: [`../research/2026-09-14-open-guard-sizing.md`](../research/2026-09-14-open-guard-sizing.md).
- The rule that is switched off, and the two rules it should have: section 5 of [`../backlog/2026-09-15-open-gate-safeguards.md`](../backlog/2026-09-15-open-gate-safeguards.md).
- The stored rows: `ArbitrageOpportunity` ids 2770, 2795 and 2801, fifth run, local database.
