# Stale quote

A price the engine still holds after it stopped existing.
The venue never sent an update, because its channel only speaks when a trade happens, and the engine has no way to tell that silence apart from a price that has not moved.

## The row

Row 39 of the third run, from [`../research/2026-09-06-third-run-data-audit.md`](../research/2026-09-06-third-run-data-audit.md).

| field | value |
|---|---|
| pair | `TOWNS\|USDT` |
| route | coinbase-bybit |
| opened | 15:23:09 UTC |
| duration | 21,966 ms |
| ticks | 14 |
| net ppm at open | 44,227, which is 4.42% |
| net ppm at close | -3,773 |
| close reason | `spread_collapsed` |

Every sample of the episode, with raw prices.

| t (ms) | coinbase bid | bybit ask | net ppm |
|---:|---|---|---:|
| 0 | 0.002219 | 0.002123 | 44,227 |
| 974 | 0.002219 | 0.002123 | 44,227 |
| 1,967 | 0.002219 | 0.002123 | 44,227 |
| 2,767 | 0.002219 | 0.002123 | 44,227 |
| 2,973 | 0.002219 | 0.002123 | 44,227 |
| 4,106 | 0.002219 | 0.002123 | 44,227 |
| 5,968 | 0.002219 | 0.002123 | 44,227 |
| 7,468 | 0.002219 | 0.002123 | 44,227 |
| 7,966 | 0.002219 | 0.002123 | 44,227 |
| 8,176 | 0.002219 | 0.002123 | 44,227 |
| 8,469 | 0.002219 | 0.002123 | 44,227 |
| 9,978 | 0.002219 | 0.002123 | 44,227 |
| 17,837 | 0.002219 | 0.002123 | 44,227 |
| 21,966 | 0.002117 | 0.002123 | -3,773 |

For 17.8 seconds and thirteen ticks the coinbase bid did not change one digit.
That is not a stable price.
Nothing arrived from coinbase at all.

The thirteen samples were all produced by bybit, which re-sends its top of book about every three seconds even when nothing changes.

At 21,966 ms someone finally traded TOWNS on coinbase.
The channel fired, the true bid turned out to be 0.002117, and the episode closed instantly at minus 0.38%.

The 4.42% never existed.
The coinbase bid the engine was quoting had already died before the episode opened.

## The mechanism

Venues differ in what makes them speak.

| venue | channel | fires when |
|---|---|---|
| binance | `bookTicker` | the top of book changes |
| bybit | `orderbook.1` | the top of book changes, plus an idle re-send about every 3 s |
| okx | `bbo-tbt` | the top of book changes, plus an idle re-send about every 60 s |
| krakenfutures | `ticker` | throttled to one per second |
| coinbase | `ticker` | a trade happens |

Read the last row again.
Coinbase Advanced Trade `ticker` fires on matches, not on quote changes, which is recorded in [`../profiles/coinbase/websocket.md`](../profiles/coinbase/websocket.md).
Between trades the coinbase book moves and the engine hears nothing.

For this instrument that gap is enormous.
The hundred most recent `TOWNS-PERP-INTX` trades at 18:13 UTC span 8.2 hours.
The median gap between trades is 80 seconds, p90 is 894 seconds, and the longest is 2,227 seconds.
65 of the 99 gaps are longer than this entire 22 second episode.

Consecutive prints swing 4 to 6%, for example BUY 0.002277, then SELL 0.002177, then BUY 0.002277 within 46 seconds.
The book alternates between one maker's tight pair of about $25,100 orders and dust behind them, which is the shape described in [`thin-book.md`](./thin-book.md).

So the stored coinbase bid is not a price.
It is the memory of one trade that happened at an unknown time in the past.

## Why the engine cannot see it

The engine holds one bid and one ask per venue, and those values are whatever the venue last said.
Silence is ambiguous, and the two cases are indistinguishable from inside the process.

```
  the venue is quiet because the price genuinely has not moved     the number is real
  the venue is quiet because the channel only fires on trades      the number is fiction
```

`recvTs[v]` records when a message last arrived, not when the price was last true.
The close reasons design in [`../implemented/2026-09-06-close-reasons-design.md`](../implemented/2026-09-06-close-reasons-design.md) rests on the sentence "silence on a live socket means the top of book is unchanged".
Coinbase is the exception to that sentence, and the design does not say so yet.

## Why counting ticks is not enough

The obvious repair is to drop any episode where one leg never moved.
It helps, and it does not solve the problem.

Among the 307 rows of one second or more, 43 have exactly one frozen leg.

| frozen venue | side | rows |
|---|---|---:|
| krakenfutures | bid | 20 |
| binance | ask | 7 |
| okx | bid | 6 |
| bybit | ask | 5 |
| binance | bid | 4 |
| krakenfutures | ask | 1 |

A frozen leg has two different causes.
On coinbase it is a dead price, which is this entry.
On kraken it is a live resting order on a slow venue, which is [`slow-venue-resting-order.md`](./slow-venue-resting-order.md).

Nothing on the row separates them.
Only a book read at the time does.

## How to detect it

Fetch both books when the episode opens, then compare them against the quotes that opened it.

For this row the engine believes coinbase bids 0.002219 while bybit offers 0.002123.
A REST read of the coinbase book at that instant returns a best bid near 0.002117, because that is where the book actually is.

```
  what the engine believed          what a fresh read returns

  coinbase bid   0.002219           coinbase bid   0.002117
  bybit ask      0.002123           bybit ask      0.002123

  crossed by 4.42%                  not crossed at all
```

A snapshot that shows no cross means the opening quote was stale.
The row is marked and closed with a reason of its own, and the whole class dies about 220 ms after the open instead of surviving 22 seconds as a 4.42% headline.

The fetch does not depend on the venue's mood, which is the entire point.
A REST request always answers.

## Two cheaper partial repairs

Both were proposed and neither is built.

A per venue `quoteTtlMs` in [`../../server/src/venues/registry.ts`](../../server/src/venues/registry.ts), set for coinbase only, closing an episode whose coinbase leg has not spoken within the window.
This is cheap and it is a guess about time rather than a reading of the book.

Switching the coinbase feed from `ticker` to `level2`, which is change driven and gives a maintained top of book.
Coinbase's own documentation says the ticker channel is not sufficient for best bid and ask.
The cost is a maintained book per product and about five connections, because `level2` refuses more than about thirty products per connection.

## How common it was

Every TOWNS and MORPHO row of one second or more has a coinbase leg, with median peaks of 6.3% to 6.9%.

| pair | route | rows | median duration | median peak |
|---|---|---:|---|---|
| TOWNS | coinbase-binance | 8 | 4.5 s | 6.35% |
| TOWNS | coinbase-bybit | 6 | 5.5 s | 6.61% |
| MORPHO | coinbase-binance | 5 | 3.5 s | 6.94% |

These are the largest peaks in the table that are not outright unit errors.
They are also entirely fictional.

## Related

- [`slow-venue-resting-order.md`](./slow-venue-resting-order.md) looks identical on a row and is honest.
- [`withdrawn-side.md`](./withdrawn-side.md) is a third way to hold a price that no longer exists.
- [`thin-book.md`](./thin-book.md) explains the book shape that makes coinbase prints swing 4 to 6%.

## Evidence

- The row and its class: section 3c of [`../research/2026-09-06-third-run-data-audit.md`](../research/2026-09-06-third-run-data-audit.md).
- The trade gap measurements at 18:13 UTC: the same section.
- The frozen leg table and the route table: section 4 of the same document.
- The channel behaviour: [`../profiles/coinbase/websocket.md`](../profiles/coinbase/websocket.md).
- The stored row: `ArbitrageOpportunity` id 39, third run, local database.
