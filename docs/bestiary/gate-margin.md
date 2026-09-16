# Gate margin

A hard threshold applied to a noisy estimator does not sample the market.
It samples the estimator's upper tail, so the rows that pass the line are the measurement error rather than the edge.

## The row

Row 2763 of the fifth run, from [`../audits/2026-09-15-fifth-run-data-audit.md`](../audits/2026-09-15-fifth-run-data-audit.md).

| field | value |
|---|---|
| pair | `SIREN\|USDT` |
| route | bybit-binance |
| opened | 10:43:18.506 UTC |
| duration | 92,300 ms |
| raw net ppm at open and close | 8,928 and 9,323 |
| fresh net ppm at open and close | 6,513 and 919 |
| region at open | 9,267 quote units |
| close reason | `fresh_edge_collapsed` |
| closed loop on the row's own series | -2,492 ppm |
| times this route was refused as `standing_basis` | 20,364 |

The last two lines are the whole entry.
The route was refused twenty thousand times, it opened once, and the position it describes lost money.

The books behind it never moved the way the row implies.
What moved was bybit's anchor.

| bybit number | before the dip | after the dip | 90 s later |
|---|---|---|---|
| index | 0.0252 | 0.02499 | |
| mark | 0.02528 | 0.02505 | 0.02522 |
| perp | 0.02528 | 0.02528 | |

The bybit index fell 0.8 percent.
The bybit mark, which is a smoothed copy of the index plus a premium, followed it down.
The bybit perp, which is the price the engine trades against, did not move at all.

So the bybit bid now sat 0.84 percent over the bybit mark, and the route read 6,513 ppm of fresh edge.
Over the next 90 seconds the mark climbed back and the fresh edge decayed to 919, which closed the row.
The raw cross still read 9,323 at that moment, exactly where it had been the whole time.

Row 2815 at 18:52 is the same shape, an index dip of 0.85 percent and a mark that climbed from 0.02452 to 0.02485.
On every SIREN row the bybit bid sat 0.57 to 1.06 percent over the bybit mark while the binance ask sat within 0.16 percent of the binance mark.

## The mechanism

The open gate is one comparison in [`../../server/src/engine/opportunity/OpportunityManager.ts`](../../server/src/engine/opportunity/OpportunityManager.ts).
`MIN_NET_PPM` is 5,000 at line 8, and line 139 refuses a cross whose fresh edge falls under it.
The fresh edge itself is one division per leg, each book against its own venue's mark, at anchorReading.ts:61.
There is no margin, no hysteresis and no second sample.

A mark is not a price.
It is a smoothed function of an index, described in [`index-mark-and-premium.md`](./index-mark-and-premium.md).
A perp excursion or an index dip that the mark has not yet absorbed therefore reads as a fresh edge, for exactly as long as the smoothing window lasts.

That makes the fresh edge a standing bias plus noise.
On SIREN the bias is the basis, and the noise is the distance between the index and the mark's memory of it.
A fixed line drawn through such a series is a level crossing detector for the noise.

Now count the samples.
The run refused 3,155,976 opens and wrote 66 rows, and `standing_basis` alone fired 1,754,420 times.
LSK bybit-binance was refused 901,748 times on that one reason.
When a route is measured that often, the question is not whether the estimator will ever reach 5,000.
It is how soon.

The eight routes below were refused 1,186,072 times between them and wrote all 22 rows of this class.

| route | `standing_basis` refusals | fresh at refusal, median and max | rows | fresh at open on the rows |
|---|---:|---|---:|---|
| SIREN bybit-binance | 20,364 | -1,940 and 4,998 | 11 | 5,009 to 9,082 |
| ZIL okx-bybit | 59,812 | -1,049 and 3,978 | 2 | 5,356 and 9,029 |
| ZIL okx-binance | 17,700 | -1,000 and 3,784 | 1 | 5,469 |
| ACE bybit-binance | 106,318 | -1,364 and 4,732 | 2 | 5,169 and 5,291 |
| CVC bybit-binance | 60,273 | -1,424 and 4,638 | 2 | 5,480 and 5,957 |
| LSK bybit-binance | 901,748 | -1,070 and 4,605 | 2 | 5,146 and 10,266 |
| AXL bybit-binance | 6,136 | -1,049 and 4,940 | 1 | 5,148 |
| MTL bybit-binance | 13,721 | -1,512 and 3,956 | 1 | 7,420 |

Read the SIREN line twice.
Twenty thousand refusals, and the highest fresh edge among all of them was 4,998.
The lowest of the eleven rows opened at 5,009.
Eleven ppm separate the population from the sample.

13 of the 22 rows opened under 6,000, and 23 of the run's 66 rows sit within 1,000 ppm of the gate.
The audit records the margin between the highest refusal and the lowest row as often under 300 ppm.

The outcome settles what these rows were.
The raw cross never fell under 5,000 inside 13 of the 22, and it read 4,227 to 26,254 at close across the class.
Nothing converged.
The closed loop, selling the bid series and buying the ask series at open and unwinding at the last sample, is negative on 20 of the 22, from -626 to -2,912 ppm before either venue's own spread.
The two positive ones, CVC 2762 and LSK 2769, lived 34 ms and 100 ms, which is shorter than an order takes to arrive.

## This is not the basis entry

[`standing-basis.md`](./standing-basis.md) explains why these routes carry a permanent gap.
SIREN's bybit index is a basket of markets that cannot be kept together, and CVC and LSK are a binance perp sitting at a discount that funding pays for.
That entry is about the gap.

This entry is about the line drawn through it.
The selection effect needs no basis at all.
Any noisy estimator and any hard threshold produce it, because a threshold crossed once by noise is a threshold crossed.
A basis merely supplies an enormous number of samples on a route that a correct gate would never admit.

## Why the engine cannot see it

The engine already writes down how often it refused a route, and then throws it away.

`reportRejection` keeps a `RejectionWarnState` per pair, route and reason.
It increments `occurrenceCount` at OpportunityManager.ts:293 and spends it on a log line at OpportunityManager.ts:306.
Nothing else in the process reads that map.
It is a private field of the class, written in one method and read in the same method, so the 20,364 SIREN refusals exist only in the logs.

The one piece of memory on the open path does not help either.
`isCrossOldEnough` holds a pending cross for `MIN_CROSS_AGE_MS`, and its map is declared at OpportunityManager.ts:40 as `Map<PairKey, PendingCross>`.
The key is the pair, not the route.
On a five venue cluster the clock therefore restarts whenever the best route changes, and the record it keeps is the raw `netPpm` at first sight rather than anything about the fresh edge.

`readAnchorPair` is a pure function of one sample.
Given the same books and the same anchors it returns the same verdict, whether the route has been crossed for four milliseconds or for four hours.

## How to detect it

Three levels, in increasing order of what they actually remove.

**1. A margin plus a confirming sample.**
Require the fresh edge to clear the gate on two samples, and to clear it by more than the estimator's own noise.
The `PendingCross` record already exists and already spans the two samples, so the cost is one more field.
What this does not fix: it is a smaller threshold problem inside the same threshold, and a route sampled a million times will clear two lines as readily as one.

**2. A cooldown after a recent `standing_basis` refusal.**
A route refused as a basis inside the last minute opens only after the fresh edge has held above the gate across one full anchor refresh on both legs.
One anchor refresh is about two to four seconds, because bybit and coinbase poll at 2,000 ms and every other venue at 1,000 ms.
What this does not fix, stated plainly: the SIREN rows decayed from 6,513 to 919 over 92 seconds, so four seconds in the fresh edge was still far above the gate.
Those rows open later and still open.
The cooldown removes the momentary poke, which is the smaller half of the class.

**3. How long the route's raw cross has been continuously positive.**
This is the one that separates the classes, and it does not depend on the anchors being right.
SIREN held 0.42 to 0.91 percent raw for the whole run and never converged.
ZIL held 1.2 to 2.6 percent.
The single converged dislocation of the run, AKE 2819, had no such history, and its route carries 49 basis refusals against SIREN's 20,364.
A raw cross that has stood for minutes is a basis whatever today's anchors say, and a raw cross that appeared seconds ago is the only kind that can converge.
What this costs is one timestamp per route, written where `forgetCross` already runs at OpportunityManager.ts:251.
What it does not fix: it is a gate on history, so the first minutes of a genuinely new basis still look like a dislocation.

## How common it was

22 of the 66 rows of the fifth run, the second largest class after the 30 rows in which the engine's view lagged the venue during two flash crashes.

| pair | rows |
|---|---:|
| SIREN | 11 |
| ZIL | 3 |
| ACE | 2 |
| CVC | 2 |
| LSK | 2 |
| AXL | 1 |
| MTL | 1 |

21 of the 22 closed as `fresh_edge_collapsed`, and 25 of the run's 32 fresh closes landed on the sample where an anchor changed.
So the poll closed them and the books did not, which is the same estimator that opened them, crossing the line in the other direction.

A live read of all eight routes on 2026-09-16 found each mechanism still in place.
SIREN still crossed raw by 8,669 ppm and read -2,094 fresh, CVC and LSK crossed by 16,198 and 13,577 ppm and read -727 and -1,111 fresh, and ACE, AXL and MTL no longer crossed at all.

## Related

- [`standing-basis.md`](./standing-basis.md) is the mechanism behind the gap these rows sit on.
- [`index-mark-and-premium.md`](./index-mark-and-premium.md) defines the index, the mark and the premium the fresh edge is built from.
- [`flicker.md`](./flicker.md) is the other selection effect, where the price that crosses the line is gone before anything can be sent to it.
- [`slow-venue-resting-order.md`](./slow-venue-resting-order.md) is an honest row that is also not free money.

## Evidence

- The class, the route table and the SIREN index dip: section 2b of [`../audits/2026-09-15-fifth-run-data-audit.md`](../audits/2026-09-15-fifth-run-data-audit.md).
- Every row of the class with its raw, fresh, region, closed loop and refusal count: section 9 of the same document.
- The refusal totals and the gate values in force: section 0 of the same document.
- The live reads that show each route still standing: section 8 of the same document.
- The gate, the discarded count and the pair keyed pending cross: [`../../server/src/engine/opportunity/OpportunityManager.ts`](../../server/src/engine/opportunity/OpportunityManager.ts) lines 8, 40, 139, 251, 293 and 306.
- The fresh edge itself: [`../../server/src/engine/opportunity/anchorReading.ts`](../../server/src/engine/opportunity/anchorReading.ts) line 61.
- The poll cadence behind the four second figure: [`../../server/src/feeds/anchor/AnchorPoller.ts`](../../server/src/feeds/anchor/AnchorPoller.ts) line 7, [`../../server/src/venues/bybit/anchor.ts`](../../server/src/venues/bybit/anchor.ts) line 10 and [`../../server/src/venues/coinbase/anchor.ts`](../../server/src/venues/coinbase/anchor.ts) line 14.
- The repair, sized and ordered: [`../backlog/2026-09-15-open-gate-safeguards.md`](../backlog/2026-09-15-open-gate-safeguards.md) sections 2 and 9.
- The stored rows: `ArbitrageOpportunity` ids 2755 to 2820, fifth run, local database.
