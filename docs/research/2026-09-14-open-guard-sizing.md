# Open guard sizing: the INTX mark, anchor velocity and the region floor

Date: 2026-09-14, probes and queries between 21:20 and 21:45 UTC, while the sixth run was still writing rows.
Question: what should refuse the three false opens the sixth run showed, the LSK crash rows, the TOWNS coinbase rows and the IO kraken rows, and what does each guard cost outside those rows.
Companion: [`./2026-09-14-fresh-gate-markless-leg.md`](./2026-09-14-fresh-gate-markless-leg.md), which found the markless coinbase leg and measured the INTX mark first.
Design that uses this: [`../implemented/2026-09-14-open-guards-design.md`](../implemented/2026-09-14-open-guards-design.md).

## 0. Method

Three read-only investigations ran in parallel.

- Coinbase International Exchange REST, 30 requests, plus the trading rules and API reference pages.
- The `ArbitrageOpportunity` table on port 5532, 100 rows with ids 2595 to 2694, opened 20:29:46 to 21:17:39 UTC.
  The anchor series on each row give one point per change of either leg's index or mark, so consecutive points less than 3 s apart give one poll-to-poll move.
- The fifth run, 678 `opportunity_closed` events in ClickHouse from 2026-09-11 23:12 to 2026-09-12 09:08 UTC, whose rows were deleted from Postgres before the sixth run.
  Touch sizes are not on the row, so they were parsed from the `Opportunity found` log lines and joined by open time.

Row classes used below: LSK crash 31 rows, TOWNS 9, IO 9, coinbase bot 23 (peak region under 50 quote units, all with a coinbase leg), other 28.

## 1. Coinbase International Exchange as the coinbase anchor source

`GET https://api.international.coinbase.com/api/v1/instruments` is public, needs no key, and returns a bare array of 310 instruments, 450 KB or 66 KB gzipped.
264 are `PERP`, of which 131 are `TRADING` and 133 `DELISTED`, and 46 are `SPOT`.
Every perpetual carries a `quote` with `best_bid_price`, `best_ask_price`, `trade_price`, `index_price`, `mark_price`, `settlement_price`, `limit_up`, `limit_down`, `predicted_funding` and `timestamp`.
`funding_interval` is nanoseconds, `3600000000000` on every perpetual.

The mark is defined in section 10 of Coinbase's trading rules, https://www.coinbase.com/international-exchange/legal/trading-rules.

> CLOB Mark Price = Median (Best Bid Price, Best Ask Price, Last Traded Price)

It is then clamped into the Fair Value band, `min(max(markPrice, limitDown), limitUp)`, which the quote publishes as `limit_up` and `limit_down`, about 7 percent around the index on 97 of the 131 instruments.
The median of bid, ask and last trade is the last trade clamped into the spread whenever the book is not crossed, so the two readings of the earlier doc are one formula.
Fifteen of fifteen quote samples on five instruments and 1,440 of 1,441 list samples match it.
The one miss was AERO, a mark computed one book update before an ask was pulled.

Funding, from section 12 of the same page and the help centre: settlement is hourly on the hour, the premium is the mark over the index minus one divided by 24, and the rate is a one hour TWAP of that premium blended three to one with the previous rate.
`predicted_funding` is that upcoming rate as a fraction per hour, the same unit the other pollers store, and positive means longs pay.
The list carries no settled rate and no next funding time.
The Advanced products call the poller read until today carries `funding_rate` as the last settled rate, not the upcoming one: at 21:26 it showed -0.000425 on TOWNS with `funding_time` 21:00, the exact 21:00 row of `GET /api/v1/instruments/TOWNS-PERP/funding`, while INTX predicted -0.000348 for 22:00.
So the switch also corrects the meaning of `fundingRate` on coinbase to what the anchor block promises.

Mapping: every Advanced product id ends in `-INTX`, and stripping it gives exactly the 131 INTX perpetuals in `TRADING`, with nothing on either side of the diff.
The engine tracks 122 of them, the other nine having no cluster or being denied.

| measurement | value |
|---|---:|
| round on a kept-alive connection with gzip | 0.53 to 0.74 s |
| first round after a reconnect | 1.7 to 5.3 s |
| the Advanced call it replaces | 0.12 s |
| documented limit | 40 requests per second per key, the 429 body says 100 per second |
| rate limit headers | none |

Node's global fetch sends `accept-encoding: gzip` and reuses the socket, so the poller sees the kept-alive figures.
The index in the quote is quantised to the instrument's price tick: the median tick over the 131 instruments is 99 ppm of the price, 22 instruments are over 300 ppm, TOWNS is 545 ppm and POL is 1,031 ppm.
The Advanced index is unrounded.
The fresh premium is the touch over the mark and both sit on the tick grid, so the gate loses nothing, and `indexGapPpm` gains up to half a tick of error.

What the engine reads once the mark is fed: a coinbase mark is never above the ask and never below the bid, so a coinbase buy leg's fresh premium is never negative and a coinbase sell leg's is never positive.
A coinbase leg can only remove fresh edge.
TOWNS reads -1,484 ppm fresh at the open of row 2624, AERO's sell leg reads a bid of 0.4746 over a mark of 0.6034, which is minus 21 percent, and every coinbase-leg row of the sixth run would have been refused as `standing_basis`.
A real coinbase flash is refused with them, and with 5,481 USDC of daily notional on TOWNS that is the right side to err on.

## 2. Anchor velocity

One-poll moves of the index and the mark, in absolute ppm, from consecutive anchor points less than 3 s apart, zeros excluded from the percentiles.

| group | venue | field | moves | p50 | p95 | max | over 1,000 |
|---|---|---|---:|---:|---:|---:|---:|
| LSK crash | binance | index | 36 | 2,509 | 13,321 | 23,160 | 29 |
| LSK crash | binance | mark | 37 | 2,490 | 13,756 | 22,594 | 27 |
| LSK crash | bybit | index | 19 | 6,107 | 14,902 | 18,543 | 16 |
| LSK crash | bybit | mark | 19 | 5,676 | 16,507 | 19,328 | 16 |
| other pairs | binance | index | 43 | 426 | 1,597 | 3,639 | 5 |
| other pairs | bybit | index | 22 | 928 | 4,378 | 5,682 | 10 |
| other pairs | krakenfutures | index | 73 | 224 | 1,703 | 2,825 | 10 |
| other pairs | coinbase | index | 13 | 36 | 252 | 261 | 0 |
| other pairs | okx | index | 4 | 261 | 486 | 511 | 0 |

Every move over 1,000 ppm outside LSK sits on IO, UAI and POWER, and on IO all three venues moved together, so those are real moves in thin coins.
The LSK crash in the bybit index ran from 0.41098 at 20:29:47 to 0.38267 at 20:30:41, 7.1 percent in 54 s, and back to 0.40354 by 20:31:29.

Anchor age at open, which is the open instant minus the leg's `writtenAt`.

| venue | rows | p50 ms | p95 ms | max ms |
|---|---:|---:|---:|---:|
| binance | 68 | 445 | 967 | 1,034 |
| bybit | 68 | 887 | 2,079 | 2,910 |
| coinbase | 32 | 559 | 951 | 1,221 |
| krakenfutures | 13 | 591 | 1,081 | 1,346 |
| okx | 19 | 605 | 773 | 935 |

The largest age difference between the two legs of one row was 2,737 ms, on a bybit route.

The artifact model holds.
On the 22 LSK rows that saw an anchor change while open, the fresh jump at that sample minus the raw jump equals the changed leg's mark move within 2 percent, for example 2,962 against 2,947 and 16,553 against 16,194 ppm.
One poll flips the fresh edge by the whole one-poll move, and during the crash that move was 2,500 to 16,000 ppm.
The model's failure on 2026-09-14 was its velocity assumption, 1,000 ppm per second against an observed median of 2,509 on binance and 6,107 on bybit per poll.

The guard, simulated as the poller would see it: the value written at each leg's `writtenAt` against the last value observed before it.
At 500, 1,000 and 2,000 ppm the same 20 of 31 LSK rows are refused, with known leg moves between 3,727 and 23,160 ppm.
The other 11 LSK opens have no observation before their write, and the first poll after 8 of them moved over 1,000 ppm, so they would most likely have been refused too, leaving 2602, 2634 and 2652.
No row outside LSK has a known leg move over 500 ppm at open, and no non-LSK move over 500 ppm happened within 1.5 s before any open.
Of the 28 LSK closes as `fresh_edge_collapsed`, 14 landed on the sample carrying the anchor change and 22 sat within one cadence of a move over 1,000 ppm, so those closes would defer, and no close outside LSK defers.

Unreadable time outside LSK at 1,000 ppm: 5.8 percent of binance moves, 17.9 percent of bybit, 7.6 percent of kraken, none on coinbase and okx, nearly all on IO, UAI and POWER while those coins moved.
At 500 ppm binance's share triples to 19.2 percent and bybit's rises to 29.5 percent, for no gain on LSK.

Threshold reasoning: the artifact is the velocity times the age difference, and the age difference is at most one bybit cadence plus its slowest reply, 2.9 s in this table.
At 1,000 ppm per poll the bound is about 2,900 ppm, under the 4,000 ppm band between the open threshold of 5,000 and the close threshold of 1,000, so an artifact alone cannot open and close a row.
At 2,000 ppm the bound is 5,800, above the band.

Tick quantisation: bybit publishes its index and mark at the contract tick, median 116 ppm, and four of its twenty markets here exceed 500 ppm per tick, NOT at 2,132 ppm.
Okx is similar on fewer markets, kraken rounds the index to five decimals, binance publishes eight decimals but its mark sits on the trade tick at moments, and coinbase after the INTX switch is at the tick as in section 1.
At 1,000 ppm only NOT on bybit and POL on coinbase read as moving on every single-tick change of their index.

First poll: three rows opened within 3 s of the first anchor write of the run, two TOWNS rows on the dead coinbase book and LSK 2595, the artifact row that opened at 5,321 ppm fresh and fell to 91 within 160 ms.
Treating a slot's first poll as a zero move keeps 2595.

## 3. The region floor

A null edge at open never happened: zero of 106 opens today and zero of 681 in the fifth run said `no depth held`.

Region notional at open by class today, in quote units.

| class | rows | min | p50 | max |
|---|---:|---:|---:|---:|
| LSK crash | 31 | 99 | 518 | 1,514 |
| TOWNS | 9 | 1,381 | 1,381 | 1,422 |
| IO | 9 | 0.4 | 366 | 541 |
| coinbase bot | 23 | 9 | 9 | 31 |
| other | 28 | 247 | 1,982 | 8,010 |

The IO touch held three contracts on every row, 0.4 quote units, with 366 to 541 on the next one or two levels.
The coinbase bot is AERO 13, SAGA 8, MORPHO 1 and S 1, every one a coinbase leg worth 9 to 31, the fourth audit's ten dollar bot, and the fifth run had 95 such rows.

Rows refused by a floor on the region notional at open, null counted as refused.

| floor | today, of 100 | LSK | TOWNS | IO | bot | other | fifth run, of 678 |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 100 | 25 | 1 | 0 | 1 | 23 | 0 | 104 |
| 250 | 29 | 4 | 0 | 1 | 23 | 1 | 135 |
| 500 | 47 | 13 | 0 | 6 | 23 | 5 | 173 |
| 1,000 | 68 | 27 | 0 | 9 | 23 | 9 | 231 |
| 2,000 | 86 | 31 | 9 | 9 | 23 | 14 | 344 |

The nine `other` rows refused at 1,000 today all lived 109 ms or less: PHAROS 34 ms at 247, RECALL 71 ms at 260, RSR 0 ms at 421 and 71 ms at 422, BR 57 ms at 466, ARX 7 ms at 629, B 73 ms at 755, BOT 102 ms and 109 ms at 851.
Every `other` row that lived over 110 ms today opened on a region above 2,000.

In the fifth run the 231 rows refused at 1,000 are 13 basis slices, 96 dust rows, and 122 others: 65 under 100 ms, 23 under a second, 12 between one and ten seconds, 22 of ten seconds or more.
The long ones are almost all dead-book resting orders, the IO class at a smaller size: ICX at 150 for 15 to 209 s on seven rows, OUST at 121 to 225 on an okx ask of a tenth of a coin, GRIFFAIN, XCN and ALCH with a kraken leg, TA on a one coin bybit ask, SPCH on a one coin okx ask, XOM on a hundredth of a coin.
The liquid rows among them are LSK against kraken at 257 for 2.4 s and at 971 for 19.6 s, MYX at 518 for 4.9 s, MORPHO at 338 for 9.1 s and GPS at 883 for 1.9 s.

Regions grow after the open, and a refused route is evaluated again on every tick, since a refusal tracks nothing.
So a region that later clears the floor opens then, and only a region that never reaches it is lost.
AEON opened at 420 and reached 3,772 within 2.7 s, GPS 401 reached 1,610 in 41 ms, UAI 81 reached 1,580 in 81 ms, and ARK 820 reached 15,993, so each of those opens a few ticks late under a floor rather than not at all.
The dust never grows: none of the TOWNS rows, two of nine IO rows by more than a tenth, none of the 23 bot rows, and five of 99 fifth-run dust rows.

Measures compared.
The touch is unusable, because a liquid book holds little at the touch and much behind it: bybit's LSK bid held 5 to 60 quote units in front of 500 to 1,500 unit regions, and a touch floor of 100 refuses 20 of 28 `other` rows.
The peak region is chosen by ppm, not size, and reads 0.4 on two IO rows whose open region was 366 and 510.
The largest region is known only at close.
The region at open is the only measure that exists when the gate runs, and it separates the bot cleanly at any floor from 50 to 240.
It does not separate TOWNS, whose one order at 1,381 sits at the fortieth percentile of real regions, and TOWNS is the markless leg of section 1 instead.
IO-shaped dust spans 52 to 1,049 across both runs with no gap against liquid flashes, so any floor for it is a judgement about size, not a boundary the data draws.

## Evidence

- Rows 2595 to 2694 of `ArbitrageOpportunity`, columns `anchorTsMs`, the four index and mark series, `highestBidAnchorAt`, `lowestAskAnchorAt`, `edgeNotionalAtOpen`, `peakEdgeNotional`, `maxEdgeNotional`, `edgeBuyLevelsAtOpen`, `edgeSellLevelsAtOpen`.
- `opportunity_closed` and `Opportunity found` lines in `signoz_logs.distributed_logs_v2` for both runs.
- INTX probes: `/api/v1/instruments` eleven times, `/api/v1/instruments/{symbol}/quote` fifteen times on BTC, ETH, SOL, TOWNS and MORPHO, `/api/v1/instruments/TOWNS-PERP/funding`, and the Advanced products call once.
- The poll-to-poll move query, which the next audit can re-run.

```sql
WITH e AS (
  SELECT pair, route, "openedAt" + (unnest("anchorTsMs")||' ms')::interval AS at,
         unnest("highestBidIndexSeries") AS si, unnest("highestBidMarkSeries") AS sm,
         unnest("lowestAskIndexSeries") AS bi, unnest("lowestAskMarkSeries") AS bm
  FROM "ArbitrageOpportunity"
), d AS (
  SELECT pair, route, at, lag(at) OVER w AS prev_at,
    greatest(abs((si/lag(si) OVER w-1)*1e6), abs((bi/lag(bi) OVER w-1)*1e6),
      CASE WHEN lag(sm) OVER w>0 AND sm>0 THEN abs((sm/lag(sm) OVER w-1)*1e6) ELSE 0 END,
      CASE WHEN lag(bm) OVER w>0 AND bm>0 THEN abs((bm/lag(bm) OVER w-1)*1e6) ELSE 0 END) AS move
  FROM e WINDOW w AS (PARTITION BY pair, route ORDER BY at)
)
SELECT pair, count(*) AS moves, sum((move > 1000)::int) AS over_1000
FROM d WHERE prev_at IS NOT NULL AND extract(epoch FROM at - prev_at) < 3
GROUP BY pair ORDER BY over_1000 DESC;
```
