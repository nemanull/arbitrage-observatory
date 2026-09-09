# Flicker

A cross that existed for a few milliseconds and was never tradeable.
One venue printed a price far from its own next level, and the price was gone before anything could be sent to it.

## The row

Row 113 of the third run, from [`../audits/2026-09-06-third-run-data-audit.md`](../audits/2026-09-06-third-run-data-audit.md).

| field | value |
|---|---|
| pair | `NAORIS\|USDT` |
| route | binance-bybit |
| opened | 15:35:40 UTC |
| duration | 0 ms |
| ticks | 2 |
| net ppm at open | 7,789, which is 0.78% |
| net ppm at close | 466 |
| close reason | `spread_collapsed` |

Both samples carry the same millisecond.
`sampleTsMs` is `{0, 0}`.

| t (ms) | binance bid | bybit ask | net ppm |
|---:|---|---|---:|
| 0 | 0.03991 | 0.03956 | 7,789 |
| 0 | 0.03962 | 0.03956 | 466 |

The binance bid read 0.03991 and then 0.03962 inside the same millisecond.
Bybit did not move.

## What was really there

The binance bid at 0.03991 was 0.73% above binance's own next bid level.
It was one order, alone, with a gap beneath it.

```
  binance bid side, at the instant of the open

  0.03991   | #                      one order, alone
            |
            |                        0.73% of empty space
            |
  0.03962   | ####                   where the rest of the book starts
  0.03958   | ###
  0.03955   | #####
```

A live read at 15:45 UTC found the bybit NAORIS touch holding about $140, and binance levels running from $10 to $600 each.
These are not markets where an order of any size can rest at the touch without being obvious.

## The mechanism

Three things produce this shape, and the row cannot tell them apart.

A large order arrives and eats several levels, so the best bid briefly becomes a level that used to be deep in the book.
The book refills within milliseconds.

A maker posts an aggressive quote, sees it about to be hit, and cancels.
Modern makers cancel in under a millisecond.

A maker posts a quote by mistake, at a price it did not intend, and pulls it immediately.

In all three cases the price was published and it was real for as long as it was published.
It was not available for as long as it takes to route an order to a different exchange.

## Why the engine records it anyway

`Engine.updateQuote` in [`../../server/src/engine/Engine.ts`](../../server/src/engine/Engine.ts) treats every message as a tick.
A tick that crosses opens an episode, and an episode that opens is written when it closes.
Nothing in that path has an opinion about how long a price lasted.

The result is that a price which existed for under a millisecond becomes a row that sits next to a genuine multi second dislocation, with a larger number in the peak column.

## How common it was

This is the largest class in the third run by a wide margin.

| filter | rows |
|---|---:|
| all rows in the run | 745 |
| rows under one second | 438 |
| rows of one second or more | 307 |

That is 59% of the table.
The second run audit called the same thing "sub-second bursts on volatile names", so it is not specific to one run or one pair.

## How to detect it

There are two answers, and the cheap one is not the right one.

### The cheap answer, which is what will ship first

A minimum episode age, `MIN_EPISODE_MS`, checked in `closeOpportunity` in [`../../server/src/engine/OpportunityManager.ts`](../../server/src/engine/OpportunityManager.ts) before the row is queued.
An episode shorter than the threshold is closed and not written.
At 1,000 ms it removes 438 of the 745 rows and touches nothing else.

The threshold belongs in configuration rather than in a constant, which is the first line of Phase 4 in [`../ROADMAP.md`](../ROADMAP.md).
The right number is a property of how fast the system could actually trade, and that is not known yet.

This filter works and it is blunt.
Duration is a proxy for the real property, and it discards genuine fast dislocations along with the phantoms.

### The real answer, which needs a book already in memory

A flicker is not merely correlated with thin depth.
It is a depth event.

The binance bid printed 0.03991 because that order sat 0.73% above binance's own next level.
Had there been a wall of orders at 0.03990, there would have been nothing to flicker.
The gap between level 0 and level 1 is the mechanism, not a symptom of it.

That makes the gap a better filter than duration, for three reasons.

1. Duration is a proxy and the gap is the cause.
2. Duration discards real fast dislocations, and the gap does not.
3. Duration cannot be evaluated until the episode is over, and the gap is known at the moment of the print.

## Why the depth fetch cannot deliver that

Since 2026-09-07 every market's book streams from the venue's WebSocket into the depth block, so at the open tick the block is at most 100 ms old and nothing has to be fetched, measured in [`../research/2026-09-07-depth-stream-scaling.md`](../research/2026-09-07-depth-stream-scaling.md).
Most of this class is already over by then.

All 745 rows of the third run, bucketed by duration.

| duration | rows | share |
|---|---:|---:|
| 0 ms | 7 | 0.9% |
| 1 to 99 ms | 289 | 38.8% |
| 100 to 249 ms | 53 | 7.1% |
| 250 to 999 ms | 89 | 11.9% |
| 1 to 10 s | 116 | 15.6% |
| 10 s and over | 191 | 25.6% |

349 rows, which is 47% of the table, close before the request fired at their open would return.
About 40% are gone before even the fastest venue answers.

The snapshot that eventually lands describes a book that has already refilled.
It still says something, because it shows the terrain is thin and gappy.
It cannot show the phantom level, and the phantom level is what it went to look at.

What is needed instead is the book already held in memory at the instant of the print.
That is the stream that follows open episodes, which is Phase 6 of [`../ROADMAP.md`](../ROADMAP.md), not the fetch of Phase 4.

Note what this says about where the gap really is.
The flicker was never invisible.
`bookTicker` delivered 0.03991 and then 0.03962, which is exactly why this row carries two samples at t=0.
The event was seen.
The context around it was not, and context is a maintained book rather than a request made afterwards.

One limitation applies to the stream too.
Binance `depth20@100ms` publishes state every 100 ms, so it coalesces.
A level that appears and disappears inside one interval never reaches any frame.
Catching the phantom itself needs the real-time diff stream, which is heavier than the channel Phase 6 currently names.

## A caution

A short episode is not automatically fiction.
A real dislocation can also be repaired in under a second, and a fast enough system could take it.
The reason to drop these rows today is that this system cannot act in a millisecond, so a row it could never have traded is noise in the table.

If the execution path ever gets faster, the threshold moves.
That is the second reason the age gate is a configuration value and not a constant.
It is also the reason the level 0 to level 1 gap is the better long term test, because a real fast dislocation has a book behind it and a phantom does not.

## Related

- [`thin-book.md`](./thin-book.md) is the same missing depth, held for seconds instead of milliseconds.
- [`stale-quote.md`](./stale-quote.md) is the opposite failure, where a price lasts far too long because nobody sent an update.

## Evidence

- The row and its class: section 3b of [`../audits/2026-09-06-third-run-data-audit.md`](../audits/2026-09-06-third-run-data-audit.md).
- The live book read at 15:45 UTC: section 5 of the same document.
- The survivor counts: section 4 of the same document.
- The stored row: `ArbitrageOpportunity` id 113, third run, local database.
