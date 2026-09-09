# ArbitrageOpportunity: third-run data audit

Date: 2026-09-06 in UTC.
This follows [`2026-09-06-second-run-data-audit.md`](./2026-09-06-second-run-data-audit.md), called "the second audit" below, and [`2026-09-05-first-run-data-audit.md`](./2026-09-05-first-run-data-audit.md), called "the first audit".
It is the first run with the quote family from [`2026-09-06-quote-family-design.md`](../implemented/2026-09-06-quote-family-design.md), so kraken and coinbase pair with the USDT venues for the first time.
Reproduction commands are the same as in the second audit.

## 0. What the sample is

One process after a 40 second false start.
`Starting Nest application` at 15:18:55.824, `orchestrator_started` at 15:18:57.957, `orchestrator_stopped` at 18:05:29.260.
That is 2 hours 46 minutes, with 690 clusters across 5 venues.
Boot lines: `Denied 4 pair(s) as non-comparable clusters: ONE|USDT, QNT|USDT, BB|USDT, ON|USDT` and `Applied 2 hardcoded price scale(s): okx/ANTHROPIC-USDT-SWAP x10, okx/OPENAI-USDT-SWAP x10`.
Markets streamed: bybit 656 of 837, binance 651 of 780, okx 429 of 472, krakenfutures 247 of 276, coinbase 124 of 131.
The table was wiped before the run and holds 745 rows with `openedAt` from 15:18:58 to 18:04:14.

| closeReason | rows |
|---|---|
| spread_collapsed | 596 |
| age_cap | 146 |
| shutdown | 2 |
| feed_down | 1 |

## 1. Reading a row

Every stored price already carries the taker fee.
[`ClusterIndexBuilder.ts:84-85`](../../server/src/engine/ClusterIndexBuilder.ts) multiplies a bid by `1 - takerPpm / 1e6` and an ask by `1 + takerPpm / 1e6`.
[`OpportunityManager.ts:93`](../../server/src/engine/OpportunityManager.ts) then reads `netPpm = (highestBid / lowestAsk - 1) * 1e6`.
So a net reading is the edge on the first unit after one fill on each leg, and a raw price is recovered by dividing the stored one by its multiplier.

Row 16, `S|USDT`, route binance-coinbase, fees 500 and 400 ppm:

| | tick 1, 15:19:58.982 | tick 2, 15:20:01.048 |
|---|---|---|
| binance SUSDT bid, raw | 0.02949 | 0.02949 |
| coinbase S-PERP-INTX ask, raw | 0.02931 | 0.03150 |
| net reading | +5,236 ppm | -64,652 ppm |

The coinbase ask moved 7.5% in one tick while binance stood still.
The episode closed as spread_collapsed, and the row's `roundTripPpm` reads 68,088.

## 2. roundTripPpm measures the last jump, not a profit

[`conversion.ts:39-44`](../../server/src/db/conversion.ts) computes `netPpmAtOpen - netPpmAtClose - 2 * (both taker fees)`.
Both readings carry the same fee term, so the subtraction cancels it, and the four fills of a round trip are charged once.
The fee handling is right.
The wrong part is the sides.
The formula treats the ask venue's ask as the price received when unwinding there, and the bid venue's bid as the price paid to unwind on the other side.
A real unwind sells into the ask venue's bid and buys from the bid venue's ask, so the formula overstates by each venue's own width at the closing tick.
The schema comment at [`schema.prisma:111-113`](../../server/prisma/schema.prisma) already calls the column an upper bound for this reason.

On a tight book the error is noise.
On a thin book the width can be the whole number.
The column is therefore large exactly when one book jumped through its own width in a single tick, which is what thin books do.
It is negative on the episodes that held for five minutes, because the age cap closed them while the spread was still open.

| row | one-tick jump | roundTripPpm | peakNetPpm |
|---|---|---|---|
| 16, S binance-coinbase | coinbase ask +7.5% | 68,088 | 5,236 |
| 113, NAORIS binance-bybit | binance bid -0.73% | 5,223 | 7,789 |
| 101, ANTHROPIC okx-binance, 300 s | none, age cap | -1,083 | 13,930 |
| 102, SIREN bybit-binance, 300 s | none, age cap | -1,398 | 8,210 |

Recommendation: remove the column.
It is derived from the row, so nothing is lost.
References are the schema lines above, [`migration.sql:69`](../../server/prisma/migrations/20260906150000_init/migration.sql), the converter, [`OpportunityManager.spec.ts:520`](../../server/src/engine/OpportunityManager.spec.ts), the column table row at [`2026-08-19-schema-rework-design.md:91`](../implemented/2026-08-19-schema-rework-design.md), and the generated client under `server/src/db/generated/`.
The column was removed later the same day, from the schema, the init migration, the converter, the spec, the generated client and the local database.

## 3. Four rows, four classes

| row | pair, route | duration | ticks | peak | what happened | class |
|---|---|---|---|---|---|---|
| 16 | S, binance-coinbase | 2.1 s | 2 | 0.52% | coinbase ask fell through to a resting order 7% above the touch | thin book width flip |
| 113 | NAORIS, binance-bybit | 0 ms | 2 | 0.78% | one binance bid 0.73% above the next level, gone within the same millisecond | sub-second flicker |
| 39 | TOWNS, coinbase-bybit | 22.0 s | 14 | 4.42% | coinbase bid frozen for 22 s on a trade-driven channel, then re-read 4.6% lower at the next trade | stale quote |
| 326 | LAYER, krakenfutures-binance | 28.6 s | 1,774 | 0.66% | kraken bid unchanged while binance's ask moved 0.2% to 0.76% below it | slow venue resting order |

### 3a. Row 16, thin book

Live at 15:28 UTC the coinbase S-PERP-INTX ask side read 356 contracts at 0.02951, then 848,833 at 0.02957, then 18,524 at 0.02996, then 11,633 at 0.0315.
One maker's pair of orders held about 97% of the depth near the touch, and the 0.0315 order was resting 7% above it.
Remove the maker and the book is 0.0293 to 0.0315, which is the row's closing reading.
The coinbase ask reading took only two values across all 11 `S|USDT` rows of the first ten minutes, 0.02931 and 0.0315.

### 3b. Row 113, flicker

Both ticks carry the same millisecond and `sampleTsMs` is `{0,0}`.
The binance bid read raw 0.03991 and then 0.03962 while bybit's ask stayed at 0.03956.
Live at 15:45 UTC the bybit NAORIS touch held about 140 dollars and binance's levels ran 10 to 600 dollars each.
The second audit's "sub-second bursts on volatile names" is this class, and 438 of the 745 rows are under one second.

### 3c. Row 39, stale quote

The coinbase feed subscribes to the Advanced Trade `ticker` channel, which emits on trades and not on quote changes, per [`coinbase/websocket.md:42-45`](../profiles/coinbase/websocket.md).
Between trades the engine's coinbase quote is frozen.
The 100 most recent TOWNS-PERP-INTX trades at 18:13 UTC span 8.2 hours, with a median gap of 80 s, a p90 of 894 s and a maximum of 2,227 s.
65 of the 99 gaps exceed the 22 s this episode lasted.
Consecutive prints swing 4 to 6%, for example BUY 0.002277, SELL 0.002177, BUY 0.002277 within 46 seconds, because the book alternates between one maker's tight pair of 25,100 dollar orders and dust levels behind it.
Bybit and binance TOWNS index prices agree within 0.035%, and their touches hold 65 to 507 dollars.
The 4.4% was the coinbase reading from an earlier trade, not a price anyone could sell to.
Among the rows over one second, the 14 TOWNS rows and the 5 MORPHO rows, with median peaks of 6.3% to 6.9%, all have a coinbase leg.

### 3d. Row 326, slow venue

Kraken's ticker is throttled to one update per second, per [`kraken/websocket.md:763`](../profiles/kraken/websocket.md).
The kraken bid read raw 0.08333 on every one of the 1,774 ticks while binance's ask took 44 distinct values between raw 0.08270 and 0.08317.
Live at 18:13 UTC the kraken PF_LAYERUSD touch held 1,059 dollars on the bid and 470 on the ask, 0.75% wide, with 14,788 dollars of bids within 1% of the touch and 19,127 dollars of volume in 24 hours.
Kraken's and binance's index prices agree within 0.004%, and funding is near zero on both.
So the bid was most likely a real resting order that its owner did not move for 28 s while binance fell.
Selling into it and buying on binance would have netted 0.1% to 0.66% on roughly a thousand dollars.
An immediate unwind crosses kraken's own 0.75% width and loses more than that.
A patient unwind, waiting for the two marks to meet or posting on kraken, keeps it.
This is the only class in the run where the recorded edge belonged to a real order on a converging pair.
It is also dust at current sizes.

## 4. Survivors of the honest filters

| filter, cumulative | rows | strict variant |
|---|---|---|
| all | 745 | 745 |
| durationMs >= 1000 | 307 | 307 |
| both legs moved | 264 | 196 |
| peakNetPpm <= 30,000 | 256 | 195 |
| closeReason = spread_collapsed | 121 | 60 |

The strict variant ignores the closing tick when deciding whether a leg moved, because a leg whose only change is the tick that closed the episode was frozen for the whole episode.
Row 39 counts as "both moved" only under the loose reading.

Among the 307 rows over one second, 43 have exactly one frozen leg and none have two.

| frozen venue | side | rows |
|---|---|---|
| krakenfutures | bid | 20 |
| binance | ask | 7 |
| okx | bid | 6 |
| bybit | ask | 5 |
| binance | bid | 4 |
| krakenfutures | ask | 1 |

A frozen leg has two different causes in this run.
On coinbase it is a stale quote, section 3c.
On kraken it is a resting order on a slow venue, section 3d.
Nothing on the row separates them, and only a book read at the time does.

The top routes over one second, with the class each belongs to:

| pair | route | rows | median duration | median peak | class |
|---|---|---|---|---|---|
| ONG | bybit-binance | 33 | 300 s | 0.71% | funding carry, binance perp 0.6% under its index, shorts pay 0.056% per interval |
| ANTHROPIC | okx-binance | 32 | 300 s | 1.34% | funding carry, okx premium, second audit |
| OPENAI | okx-binance | 32 | 300 s | 2.12% | funding carry, okx premium, second audit |
| SIREN | bybit-binance | 27 | 300 s | 0.71% | index disagreement, binance index 0.02813 against bybit 0.02860 |
| LAYER | krakenfutures-binance | 24 | 4.1 s | 0.83% | slow venue |
| LAYER | krakenfutures-okx | 15 | 2.7 s | 0.98% | slow venue |
| ICX | okx-bybit | 11 | 30.6 s | 0.61% | index disagreement, second audit |
| ICX | krakenfutures-bybit | 11 | 300 s | 1.27% | index disagreement |
| S | binance-coinbase | 9 | 3.0 s | 0.59% | thin book and stale quote |
| TOWNS | coinbase-binance | 8 | 4.5 s | 6.35% | stale quote |
| TOWNS | coinbase-bybit | 6 | 5.5 s | 6.61% | stale quote |
| MORPHO | coinbase-binance | 5 | 3.5 s | 6.94% | stale quote |

The 146 age-cap rows are the carry and disagreement classes.
The 60 strict survivors are mostly the kraken slow-venue class.
Every class that survives a second survives because nobody can take it, because the size is dust, or because the quote is not real.

## 5. Live probes

All at 2026-09-06 UTC, all endpoints public and unauthenticated.

| time | probe | result |
|---|---|---|
| 15:28 | coinbase S-PERP-INTX product_book | asks 0.02951 x 356, 0.02957 x 848,833, 0.02996 x 18,524, 0.0315 x 11,633 |
| 15:28 | binance SUSDT depth | five levels within 0.03%, 4,774 to 218,263 contracts each |
| 15:45 | bybit and binance NAORISUSDT books | 0.15% and 0.08% wide, 140 dollars at the bybit touch |
| 15:57 | binance premiumIndex and bybit tickers, SIREN | binance index 0.02813, bybit index 0.02860, perps 0.7% apart and still crossed |
| 15:57 | same for ONG | binance mark 0.09155 against index 0.09212, funding -0.000555, bybit touch 281 contracts |
| 15:57 | kraken PF_LAYERUSD ticker and book | 1.3% wide, vol24h 159,976 contracts |
| 18:13 | coinbase TOWNS-PERP-INTX book and trades | section 3c |
| 18:13 | kraken PF_LAYERUSD and binance LAYERUSDT | section 3d |

## 6. What the row cannot say

| question | needs | on the row | on the wire |
|---|---|---|---|
| is the first unit crossed after fees | best bid, best ask, fees | yes | yes |
| did it last | durationMs, ticks | yes | yes |
| is the quote current | per venue liveness | no | bybit re-sends every 3 s, okx every 60 s, kraken 1 per s, binance on change only, coinbase on trades only |
| how much size sat at the price | top-of-book sizes | no | yes, every feed sends them and drops them |
| what would the unwind cost | each leg's own other side | no | yes, [`types.ts:33-34`](../../server/src/engine/types.ts) holds both sides of every market |
| what is the edge at 1k, 5k, 20k dollars | depth | no | no, needs a snapshot or a depth channel |

Sizes are parsed and discarded at each feed's `submit` call, for example [`binance/types.ts:9-11`](../../server/src/venues/binance/types.ts) and [`coinbase/types.ts:6-7`](../../server/src/venues/coinbase/types.ts).
The feed hands the engine a `NormalizedQuote` from [`ws/types.ts:27-32`](../../server/src/ws/types.ts) through [`VenueFeed.ts:162-164`](../../server/src/ws/VenueFeed.ts).

## 7. Has a capturable opportunity been recorded

Not one that the row can prove.
The rows that held for a second are structural spreads and slow-venue resting orders.
The structural ones pay through funding over days, or never, and the slow-venue ones were real for about a thousand dollars each.
No row shows a cross that a reader could open and close for a meaningful notional, and no row could show it, because size and unwind cost are not recorded.
The averaging plan, mean net ppm times a budget, would have produced a number with no relation to any fill.

## 8. Order of repair, proposed

Sizes come from a read-only code map of 2026-09-06 and are not commitments.

1. Remove `roundTripPpm`.
   Files in section 2.
   A drop-column migration keeps this run's rows and follows the additive rule of the schema rework design, while editing the init migration forces `prisma migrate reset --force` on every database that applied it.
   Size S.
2. Add `MIN_EPISODE_MS = 1_000` next to `MIN_NET_PPM` at [`OpportunityManager.ts:18`](../../server/src/engine/OpportunityManager.ts).
   Every close path, tick at `:217`, feed down at `:357`, sweep at `:389` and shutdown, funnels into `closeOpportunity` at `:403`, so the gate sits there between the map delete and `enqueueClosed` at `:440` and returns true without writing.
   The `opportunity_closed` log needs a `written` flag, and the `opportunities_written` count in [`OpportunityWorker.ts`](../../server/src/engine/OpportunityWorker.ts) stays the only write count.
   Existing close specs open at 1,000 ms and close at 2,000 ms or later, so a strict comparison keeps them green.
   This removes 438 of 745 rows.
   Size S.
3. Record top-of-book sizes and each leg's own width.
   Add `bidSize` and `askSize` to `NormalizedQuote` and to each feed's `submit`, to the cluster arrays allocated in [`ClusterIndexBuilder.ts`](../../server/src/engine/ClusterIndexBuilder.ts), and six scalars on the row for open, peak and close.
   Width per leg is `cluster.ask[i] / cluster.bid[i] - 1` and needs no size.
   Record, do not gate, so the ranking can filter in SQL.
   A size-only change must not count as a tick.
   Size M.
4. Coinbase: `level2` or off.
   Coinbase's own docs say the ticker channel is not sufficient for best bid and ask, and the three routes with the highest peaks over one second are all coinbase legs.
   Until `level2` lands, disabling the venue in [`registry.ts`](../../server/src/venues/registry.ts) removes the stale class outright.
5. Confirmation snapshot at `MIN_EPISODE_MS`.
   No HTTP client exists in `src/` apart from ccxt, which is used at boot only through [`connector.ts:13`](../../server/src/ccxt/connector.ts) and [`registry.ts:14`](../../server/src/venues/registry.ts).
   ccxt implements `fetchOrderBook` for all five venues, and the 1 s sweep timer at [`orchestrator.ts:108-111`](../../server/src/orchestrator.ts) is the once-per-episode hook.
   Shape: a `BookFetcher` injected into the engine, a pending promise set mirroring `pendingWrites`, no await on the tick path, results applied only while `closedAt` is null, a new close reason `quote_stale` when the snapshot shows no cross, and nullable columns for touch sizes, widths and net ppm at fixed notionals.
   Kraken's 600 ms ccxt limiter queues an opening burst, okx sizes are in contracts, and coinbase INTX `product_book` without credentials is unverified.
   Size L.
6. Index cross-check at open, as in the first audit's probe, to tag carry and disagreement without a human.
   Later.

Specs touched: `OpportunityManager.spec.ts`, `Engine.spec.ts`, the five feed specs, `ClusterIndexBuilder.spec.ts`, and a book fetcher fixture for item 5.
Run them with `npx jest src/engine src/venues --forceExit`, because the full suite hangs.
