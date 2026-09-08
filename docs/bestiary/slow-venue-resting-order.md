# Slow venue resting order

A leg that never moves for the whole episode, where the price is real and someone would genuinely have traded at it.
This is the one entry in the bestiary that is not a mirage.
It is here because on a row it is indistinguishable from [`stale-quote.md`](./stale-quote.md), which is pure fiction.

## The row

Row 326 of the third run, from [`../research/2026-09-06-third-run-data-audit.md`](../research/2026-09-06-third-run-data-audit.md).

| field | value |
|---|---|
| pair | `LAYER\|USDT` |
| route | krakenfutures-binance |
| opened | 16:21:03 UTC |
| duration | 28,623 ms |
| ticks | 1,774 |
| net ppm at open | 5,031 |
| peak net ppm | 6,611, which is 0.66% |
| net ppm at close | 922 |
| close reason | `spread_collapsed` |

The two series over 1,774 samples, with raw prices.

| leg | distinct values | range |
|---|---:|---|
| krakenfutures bid | 1 | 0.08333 on every sample |
| binance ask | 44 | 0.08270 to 0.08317 |

Kraken published one number, 1,774 times, for 28.6 seconds.
Binance moved through 44 distinct values underneath it.

```
  0.08333   kraken bid, flat for 28.6 s
  ..........................................................

  0.08317   binance ask, high
      .  ..    .
    .  ..  . ..  .   .
  ..          .    ..  .. .
  0.08270   binance ask, low
```

## Why this one is real

Every check the audit could run says the kraken bid was a live order.

A live read of `PF_LAYERUSD` at 18:13 UTC found:

| measurement | value |
|---|---|
| notional at the kraken bid | $1,059 |
| notional at the kraken ask | $470 |
| kraken's own touch width | 0.75% |
| bids within 1% of the touch | $14,788 |
| 24 hour volume | $19,127 |

The two venues also agree about what LAYER is worth.
Kraken's and binance's index prices differ by 0.004%.
Funding is near zero on both.

So this was not a pricing disagreement and it was not a dead quote.
It was a resting bid whose owner did not move it for 28 seconds while binance fell.

Quoting the audit directly, this is the only class in the run where the recorded edge belonged to a real order on a converging pair.

## The mechanism

Kraken's `ticker` channel is throttled to one update per second, which is recorded in [`../profiles/kraken/websocket.md`](../profiles/kraken/websocket.md).
That throttle explains why kraken looks slow, and it does not explain why the price was flat.
A throttled channel still reports a change within a second.

The price was flat because the order really did not move.
On an instrument with $19,127 of daily volume there may be one participant quoting, and that participant is not a latency sensitive bot.
It posts a bid, walks away, and repositions on its own schedule.

Meanwhile binance is liquid and fast, so it repriced 44 times in the same window.
The spread between them is the difference between a market that updates continuously and one order that does not.

## Why it is still not free money

Two problems, and neither is visible on the row.

**The unwind crosses kraken's own width.**
Kraken's touch is 0.75% wide.
You sell into the bid at 0.08333 and buy on binance at 0.08290, which is the 0.66% edge.
Now you are short on kraken and long on binance, and closing the kraken side immediately means paying kraken's ask, which is 0.75% above its bid.
That costs more than the edge.

The trade only keeps its profit with a patient unwind, either waiting for the two marks to converge or posting on kraken instead of taking.
Patience is a different strategy with different risk, and nothing in this system models it.

**The size is dust.**
$1,059 at the bid, at 0.66%, is about seven dollars of gross edge before fees.
The taker fees on this route are 500 ppm on each leg, which is 0.1% round trip, so the net is about five dollars.

## Why depth is the only separator

Compare this row against row 39 in [`stale-quote.md`](./stale-quote.md).

| | row 326, kraken | row 39, coinbase |
|---|---|---|
| one leg frozen for the whole episode | yes | yes |
| duration over one second | yes | yes |
| close reason | `spread_collapsed` | `spread_collapsed` |
| the frozen price was real | yes | no |

Every field the row carries is the same shape.
The difference is what was sitting behind the frozen price, and only a book read at the time can say.

```
  fresh read of the frozen leg

  kraken   0.08333   $1,059 resting, $14,788 within 1%     the order is there
  coinbase 0.002219  nothing, the real bid is 0.002117     the order is gone
```

This is the reason depth is not only a filter that deletes rows.
For this class it is what lets a row be kept with confidence.
Without it, the honest rows and the fictional ones have to be thrown away together.

Among the 307 rows of one second or more, 43 have exactly one frozen leg, and 21 of those are kraken.

## How common it was

| pair | route | rows | median duration | median peak |
|---|---|---:|---|---|
| LAYER | krakenfutures-binance | 24 | 4.1 s | 0.83% |
| LAYER | krakenfutures-okx | 15 | 2.7 s | 0.98% |

The 60 rows that survive the strict filters of section 4 of the audit are mostly this class.
That is the honest core of the third run.
It is 8% of the table, and every one of them is a few dollars.

## How to detect it

The detection is the same fetch as every other entry, read the other way.

1. Fetch both books at the open.
2. If the fresh book confirms the frozen price, the leg is a real resting order and the row is kept.
3. Walk the levels for the notional available at that price.
4. Record each leg's own width, because an unwind that crosses a 0.75% width turns a 0.66% edge into a loss.

Point 4 matters more here than anywhere else in the bestiary.
A row can be completely honest about the cross and still describe a trade that loses money on exit.
Each leg's own width shipped on 2026-09-06 in [`../implemented/2026-09-06-book-sizes-and-far-sides-design.md`](../implemented/2026-09-06-book-sizes-and-far-sides-design.md), and carrying it to the row is the first line of Phase 5 in [`../ROADMAP.md`](../ROADMAP.md).

## Related

- [`stale-quote.md`](./stale-quote.md) is the class this one must be separated from.
- [`thin-book.md`](./thin-book.md) explains why $1,059 at the touch is the number that decides whether this is worth anything.

## Evidence

- The row and its class: section 3d of [`../research/2026-09-06-third-run-data-audit.md`](../research/2026-09-06-third-run-data-audit.md).
- The live read at 18:13 UTC: the same section.
- The frozen leg table and the survivor counts: section 4 of the same document.
- The throttle: [`../profiles/kraken/websocket.md`](../profiles/kraken/websocket.md).
- The stored row: `ArbitrageOpportunity` id 326, third run, local database.
