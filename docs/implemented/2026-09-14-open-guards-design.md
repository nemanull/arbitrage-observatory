# Open Guards Design

Date: 2026-09-14.
Status: Done.
Plan: [`2026-09-14-open-guards-plan.md`](./2026-09-14-open-guards-plan.md).
Research: [`../research/2026-09-14-open-guard-sizing.md`](../research/2026-09-14-open-guard-sizing.md) and [`../research/2026-09-14-fresh-gate-markless-leg.md`](../research/2026-09-14-fresh-gate-markless-leg.md).
Vocabulary: [`../bestiary/index-mark-and-premium.md`](../bestiary/index-mark-and-premium.md), [`../bestiary/thin-book.md`](../bestiary/thin-book.md) and [`../bestiary/slow-venue-resting-order.md`](../bestiary/slow-venue-resting-order.md).

## Purpose

The fresh edge became the verdict at open and close on 2026-09-14, see [`../implemented/2026-09-14-fresh-edge-verdict-design.md`](../implemented/2026-09-14-fresh-edge-verdict-design.md).
The first run under it wrote no unjudged row and refused every standing basis, and it still wrote three kinds of row that are not an opportunity.

1. A flash crash on LSK produced 31 rows in four minutes.
   The fresh edge at each open was the lag of one leg's anchor behind a tape moving about 1,300 ppm a second, and the next poll flipped it by 6,000 to 23,000 ppm and closed the row.
2. A resting order on a dead coinbase book produced nine TOWNS rows to the age cap.
   Coinbase supplied no mark, so its leg was judged over its index and the fresh gate was the raw gate there.
3. A three contract ask on a dead kraken book produced nine IO rows to the age cap, on regions of 366 to 541 quote units, and a ten dollar coinbase bot produced 23 rows under 31 quote units.

This design adds three refusals at open and gives coinbase a mark.
Each refusal is one condition and one name, so the table can say why a route did not open.

## Evidence

From the research above.

- During the crash 47 of the 62 observed anchor polls moved more than 1,000 ppm, against 5 of 165 observed polls outside LSK and IO.
  The fresh jump at the first anchor change of a row equals the changed leg's mark move within 2 percent on all 22 rows that saw one, so the artifact is the one-poll move itself.
- At 500, 1,000 and 2,000 ppm the guard refuses the same 20 of 31 LSK rows, and no row outside LSK has a known leg move over 500 ppm at open.
  The largest age difference between two legs was 2.9 s, so at 1,000 ppm per poll the worst artifact is about 2,900 ppm, under the 4,000 ppm band between the open and close thresholds, and at 2,000 ppm it is not.
- The INTX instruments call carries a mark for every coinbase perpetual, defined as the median of best bid, best ask and last trade, clamped into a band of the index.
  With it a coinbase leg never adds fresh edge, TOWNS reads -1,484 ppm at its open, and every coinbase-leg row of the run is refused.
- A floor of 1,000 quote units on the region at open refuses all nine IO rows, the 23 bot rows and 27 of the 31 LSK rows, and outside those it refuses nine rows today that all lived 109 ms or less.
  A refused route is evaluated again on every tick, so a region that grows past the floor opens late rather than never.
- A null edge at open, a leg holding no depth, happened on none of the 787 opens of both runs.

## Decisions

1. A leg whose index or mark moved more than `MAX_ANCHOR_MOVE_PPM` between its last two polls makes the pair unreadable.
   The reader returns a new issue, `anchor_moving`, discovery refuses the route with it, and a sample carrying it closes nothing, like every other unreadable sample.
   `MAX_ANCHOR_MOVE_PPM` is 1,000, on the larger of the index move and the mark move, compared raw and not normalised by the time between the polls.
   Built at [`server/src/engine/opportunity/anchorReading.ts:46`](../../server/src/engine/opportunity/anchorReading.ts), with the constant at `:6`.
2. The anchor block carries the move.
   `ClusterAnchor` at [`server/src/engine/cluster/types.ts:35`](../../server/src/engine/cluster/types.ts) carries `movePpm`, one number per slot.
   `Engine.updateAnchor` writes it at [`server/src/engine/Engine.ts:413`](../../server/src/engine/Engine.ts) from the slot's previous index and mark before it overwrites them, through `anchorMovePpm` at `:582`.
   The move is the absolute difference over the previous value, in ppm, so 100 to 101 reads exactly 10,000.
   A slot polled once has nothing to compare against and reads as an unbounded move until its second poll lands, so the first poll after boot or after a market appears refuses the route.
   The refusal log carries both legs' moves, at [`server/src/engine/opportunity/OpportunityManager.ts:114`](../../server/src/engine/opportunity/OpportunityManager.ts), so the next audit reads the refused move instead of reconstructing it from row timelines.
   A first poll shows as an infinite move there.
3. A leg without a mark makes the pair unreadable.
   The reader returns `anchor_no_mark` when either slot's mark is not positive, checked before the arithmetic, at [`anchorReading.ts:38`](../../server/src/engine/opportunity/anchorReading.ts).
   The fallback that measured a markless leg over its index is gone from `readLeg` at `:73`, and `AnchorLeg.markPremium` at [`server/src/engine/opportunity/types.ts:18`](../../server/src/engine/opportunity/types.ts) is a number and never null.
   `markOrNull` left [`server/src/db/conversion.ts`](../../server/src/db/conversion.ts), which writes both marks at `:86`, since a route that opened always has them.
   The columns stay nullable for the rows written before this date, and their comments in `schema.prisma` say so.
4. The coinbase poller reads Coinbase International Exchange.
   [`server/src/venues/coinbase/anchor.ts`](../../server/src/venues/coinbase/anchor.ts) makes one call to `GET https://api.international.coinbase.com/api/v1/instruments`, keys each perpetual by its symbol plus `-INTX`, skips spot, delisted and quoteless entries, and writes the index, the mark, `predicted_funding` as the upcoming rate, the interval from nanoseconds, and the next settlement on the hour.
   It polls every 2 s, because a round takes 0.5 to 0.7 s and the first after a reconnect up to 5 s.
   Built at [`server/src/venues/coinbase/anchor.ts:7`](../../server/src/venues/coinbase/anchor.ts), with the cadence at `:14`.
   The tick-quantised INTX index is accepted, since the fresh premium is the touch over the mark and both sit on the tick grid.
5. A route whose profitable region at open holds less than `MIN_EDGE_NOTIONAL` is refused.
   `MIN_EDGE_NOTIONAL` is 1,000 quote units, the first checkpoint of the detection recipe in [`../bestiary/thin-book.md`](../bestiary/thin-book.md).
   The measure is `edge.notional` from `walkLadders` at [`server/src/engine/opportunity/OpportunityManager.ts:145`](../../server/src/engine/opportunity/OpportunityManager.ts), what buying the whole profitable region costs after fees, and a null edge is refused too.
   The refusal reason is `thin_book`, reported through `reportRejection` at `:150` with the region's notional, average edge and size, after the fresh gate at `:121`.
   The walk now runs before the four size reads so the refusals sit together, and the open log line lost its no-depth branch, since the edge is never null past the floor.
   This reverses the decision of 2026-09-07 that the ladder walk is a measurement and not a gate.
   The IO rows and the bot rows have no anchor signature, because their anchors are honest and their book is the dust, and the region at open is the only reading at the gate that sees it.
6. The order of the refusals in `validate` is raw edge, plausibility, anchor issues, standing basis, thin book.
   Inside the reader the order is missing, skewed, stale, no mark, moving.
   Each check is one condition, and none of them adds a branch to the lifecycle.
7. Nothing changes in the close rules.
   `closeReasonFor` at [`server/src/engine/opportunity/OpportunityLifecycle.ts:300`](../../server/src/engine/opportunity/OpportunityLifecycle.ts) keeps its order, and a moving or markless sample is an unreadable sample that closes nothing, so a route that opened calmly rides a crash on the raw rule and the age cap.

## Rejected alternatives

- Normalise the anchor move by the time between polls.
  A move measured after a failed round or a rate limit pause spans more time and refuses one open more than needed, which is rare and safe, and the raw comparison is one subtraction the reader can show.
- 500 or 2,000 ppm.
  500 triples the unreadable time on binance and bybit for no gain on LSK, and 2,000 lets an artifact of 5,800 ppm open and close a row on its own.
- Treat a slot's first poll as a zero move.
  It keeps row 2595, the artifact row that opened 2.2 s after the first anchor write of the run, and the cost of refusing is one cadence per boot.
- Require the fresh verdict to survive one full anchor refresh on both legs.
  It removes 58 of the 78 non-cap rows of the run, but only because it is a minimum episode of one cadence in disguise, which is the issue #12 decision made implicitly.
- Keep judging a markless leg over its index.
  It makes the fresh gate the raw gate on every route with such a leg, which is how nine TOWNS rows opened, and no unjudged row is the rule since 2026-09-14.
- Keep the Advanced products call for coinbase and add INTX only for the mark.
  The Advanced call's rate is the last settled one, not the upcoming one the block promises, and two clocks per round buy only an unrounded index that the gate does not read.
- Compute an accepted premium in the engine from the books it holds.
  It would judge every venue by one reading, and it is a design with a time constant, a warm-up and a post-crash lag, not a guard.
- A floor on the touch instead of the region.
  A liquid book holds little at the touch and much behind it, and a touch floor of 100 refuses 20 of 28 real rows.
- A floor of 250 or 600.
  250 separates only the bot and leaves every IO row, and 600 is fitted to IO's 366 to 541 rather than to a number the project already uses.
- Close the band, or close on a frozen region.
  Both act after the open, and the ask was to refuse the open.

## Scope

In scope: the move on the anchor block, the two new reader issues, the region floor, the coinbase poller, the specs, the bestiary sentences that describe the reader and the coinbase source, and the stale comment in the coinbase feed that calls Advanced the only credential-free source.

Out of scope: a minimum episode age ([issue #12](https://github.com/nemanull/arbitrage-observatory/issues/12)), any change to the close rules or their thresholds, each leg's own width on the row, a rule on a region that never changes, storing the touch sizes on the row, and any change to `MIN_NET_PPM`, `CLOSURE_NET_PPM`, `ANCHOR_SKEW_MS` or `ANCHOR_MAX_AGE_MS`.
