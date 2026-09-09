# Thin book

A market whose best price is real and current, with almost no money resting behind it.
The engine records the price.
It cannot record that the price was worth eleven dollars.

## The row

Row 16 of the third run, from [`../audits/2026-09-06-third-run-data-audit.md`](../audits/2026-09-06-third-run-data-audit.md).

| field | value |
|---|---|
| pair | `S\|USDT` |
| route | binance-coinbase |
| opened | 15:19:58 UTC |
| duration | 2,066 ms |
| ticks | 2 |
| net ppm at open | 5,236, which is 0.52% |
| net ppm at close | -64,652, which is -6.47% |
| close reason | `spread_collapsed` |

The whole episode is two samples.
Prices below are raw, before the taker fee that the stored series already folds in.

| t (ms) | binance bid | coinbase ask | net ppm |
|---:|---|---|---:|
| 0 | 0.02949 | 0.02931 | 5,236 |
| 2,066 | 0.02949 | 0.03150 | -64,652 |

Binance did not move at all.
The coinbase ask jumped 7.5% in one step, from 0.02931 to 0.03150.
No large trade caused that jump.

## What the book actually held

A live read of the coinbase `S-PERP-INTX` ask side at 15:28 UTC, recorded in section 5 of the third run audit.

| level | price | size | notional | cumulative | distance from touch |
|---:|---|---:|---:|---:|---:|
| 0 | 0.02951 | 356 | $11 | $11 | 0.00% |
| 1 | 0.02957 | 848,833 | $25,100 | $25,110 | 0.20% |
| 2 | 0.02996 | 18,524 | $555 | $25,665 | 1.52% |
| 3 | 0.03150 | 11,633 | $366 | $26,032 | 6.74% |

Drawn as a profile, where each block is about a thousand dollars.

```
  0.02951   |                                      $11
  0.02957   | #########################            $25,100
  0.02996   |                                      $555
  0.03150   |                                      $366
```

One order holds 97% of everything near the touch.
The other three levels together hold $932.
The engine stores only the top line, so it stores eleven dollars and calls it the price of S on coinbase.

## The mechanism

A market maker runs a bot on this instrument.
The bot posts a buy order and a sell order, then cancels and reposts them whenever it likes.
Cancelling costs nothing and takes no time.
On a small instrument there may be only one or two such bots active at all.

The bot owns the $25,100 order at 0.02957.
When it steps away, the book behind it is $932 spread across three levels, two of which are more than 1.5% away.

```
  bot is quoting                        bot has cancelled

  0.02951        $11                    0.02951        $11
  0.02957    $25,100                    (gone)
  0.02996       $555                    0.02996       $555
  0.03150       $366                    0.03150       $366

  best ask 0.02951                      best ask 0.02951
```

The best ask does not move at the moment of the cancel.
It moves when the $11 at 0.02951 is taken by any small trade, because the next resting order is 1.5% away, and then 6.7% away.

Nobody changed their opinion about the value of S.
One bot pulled its quotes, a few dollars of dust cleared, and the recorded price moved 7%.

The evidence that this is what happened is in the readings themselves.
The coinbase ask took only two values across all eleven `S|USDT` rows of the first ten minutes, 0.02931 and 0.0315.
A price that alternates between exactly two values is not a market finding a level.
It is one order appearing and disappearing.

## Why the engine cannot see it

The cluster holds one price and one size per venue, in `bid[v]`, `ask[v]`, `bidSize[v]` and `askSize[v]`.
Top of book size shipped on 2026-09-06 and helps, because it would have shown 356 contracts at the touch.
It still cannot show that level 1 is 2,400 times larger than level 0, or that level 3 is 6.7% away.

A book of $11 at the touch and $25,000 evenly spread behind it produces the same row as a book of $11 at the touch and nothing behind it.
Those two markets are not the same market.

## How to detect it

Fetch twenty levels for both legs when the episode opens, then walk them.

1. Sum price times size down each side until a target notional is reached.
   The notional available at or better than the touch answers whether a trade of that size was possible.
2. Record the edge at 1,000, 5,000 and 20,000 dollars.
   For row 16 the edge at 1,000 dollars is deeply negative, because the first $11 is followed by a level 0.2% worse.
3. Compare the largest level against the sum of the top twenty.
   A single level holding most of the near depth means the book is one participant, and the touch is only as durable as that participant's patience.
4. Measure the gap from level 0 to level 2.
   A wide gap says what happens the moment the touch is consumed.

The write path that receives these levels is `Engine.updateDepth` in [`../../server/src/engine/Engine.ts`](../../server/src/engine/Engine.ts).
The block it writes into is described in [`../implemented/2026-09-06-depth-block-design.md`](../implemented/2026-09-06-depth-block-design.md).
Since 2026-09-07 the WebSocket book feeds fill it, one maintained book per market, verified in [`../research/2026-09-07-depth-sequence-gaps.md`](../research/2026-09-07-depth-sequence-gaps.md).

## What depth does not solve

The class contains two different animals, and only one of them yields to a snapshot.

| | what happened | does a snapshot catch it |
|---|---|---|
| structurally thin | there was never size, $11 at the touch and $555 behind it | yes, the edge at 1,000 dollars is negative and the row dies |
| pulled | there was $25,100 at the moment of the read, and the maker cancelled before an order could arrive | no, the snapshot says the book is deep and the snapshot is right about the past |

The walk answers the first one, and that is most of the `S` rows.

It cannot answer the second, and no snapshot can.
A snapshot describes one instant.
An order arrives at that instant plus a round trip, and a maker cancels in well under a millisecond.
The information needed does not exist yet at the moment it would be needed.

This is a race rather than a missing measurement, so more data does not close it.

What would at least make the table honest about the second case is a number no snapshot can produce: how long a level survives.
Level lifetime is a property of a sequence of books rather than of one book.
A maintained book sees every cancellation and could report that the large level on this instrument has a median lifetime of some tens of milliseconds, which is what decides whether the market is takeable at all.
That is the stream of Phase 6 in [`../ROADMAP.md`](../ROADMAP.md), not the fetch of Phase 4.

Past that the question stops being observation and becomes execution.
The way to stop losing a cancellation race is to stop entering one, by resting an order rather than taking on the side that is thin.
That changes what the word capturable means, so the legitimacy ruleset of Phase 5 will have to say which of the two it measures.

## How common it was

In the third run, `S` on binance-coinbase produced 9 rows over one second, with a median peak of 0.59%.
The class is small by count and large by peak, because a thin book produces the widest fake spreads in the table.

It is also the class that survives every filter built from prices alone.
The prices are real and current.
Only the size behind them is missing.

## Related

- [`flicker.md`](./flicker.md) is the same absence of depth on a much shorter timescale.
- [`stale-quote.md`](./stale-quote.md) is the case where the price itself is no longer real.
- [`withdrawn-side.md`](./withdrawn-side.md) is the extreme of this one, where a side of the book empties completely.

## Evidence

- The row and its class: section 3a of [`../audits/2026-09-06-third-run-data-audit.md`](../audits/2026-09-06-third-run-data-audit.md).
- The live book read at 15:28 UTC: section 5 of the same document.
- Depth levels observed on other venues the same day: section 1a of [`../research/2026-09-06-venue-depth-endpoints-probe.md`](../research/2026-09-06-venue-depth-endpoints-probe.md).
- The stored row: `ArbitrageOpportunity` id 16, third run, local database.
