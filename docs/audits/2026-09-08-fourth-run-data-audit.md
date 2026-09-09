# ArbitrageOpportunity: fourth-run data audit

Date: 2026-09-08 in UTC.
This follows [`2026-09-06-third-run-data-audit.md`](./2026-09-06-third-run-data-audit.md), called "the third audit" below.
It is the first run with a WebSocket order book from every venue and with the ladder walk of [`../bestiary/edge-at-the-touch.md`](../bestiary/edge-at-the-touch.md) on the row.
Section 7 is a checklist of what to verify on the next run, and it is the reason this document exists.
Every number below was read from the table, the SigNoz logs, or a live probe on 2026-09-08, and the probe times are in section 9.
A second independent pass re-derived every table count and re-probed the venues at 19:00 the same day, and its corrections are folded in.

## 0. What the sample is

One process after an eleven second false start that left no rows.
`Starting Nest application` at 04:58:07, `orchestrator_started` at 04:58:09, `orchestrator_stopped` at 06:23:18.
That is 85 minutes, with 687 clusters across 5 venues.
Markets streamed: bybit 655 of 841, binance 648 of 782, okx 427 of 473, krakenfutures 246 of 275, coinbase 122 of 131.
Boot line: `Denied 8 pair(s) as non-comparable clusters: ONE|USDT, QNT|USDT, ONG|USDT, BB|USDT, SIREN|USDT, ON|USDT, OPENAI|USDT, ANTHROPIC|USDT`.
The table holds 597 rows, ids 759 to 1355, with `openedAt` from 04:58:11 to 06:22:32.

Two facts about the hour matter more than anything in the code.
SOPH rose 106 percent in the 24 hours around the run and swung 23 percent inside one ten minute bucket.
It was Tuesday pre-market after the Labor Day close, so every tokenised equity perp had a frozen underlying.

| closeReason | rows |
|---|---:|
| spread_collapsed | 565 |
| age_cap | 27 |
| feed_down | 3 |
| shutdown | 2 |

## 1. Has a capturable opportunity been recorded

No.
Five pairs produce 389 of the 597 rows, and each is a spread that was still open two hours after the run for a reason the row cannot see.
49 of the 70 coinbase legged rows rest on a coinbase touch under 15 dollars, and the other 21 on 20 to 1,031 dollars.
Of the rest, 127 of 138 rows lived under one second.
The strict filter ladder in section 4 leaves 46 rows, 45 of which are slices of the CP basis and one is four dollars of kraken dust.

Two things in the run were real prices with real depth, and neither is an arbitrage the engine models.
BNC bybit traded 2.8 to 3.3 percent above BNC binance for ten minutes on thousands of dollars of depth, rows 1133, 1185 and 1218.
BNC is a tokenised US stock whose underlying was closed, and the gap converged inside the run.
SOPH okx traded 0.35 to 1.3 percent under bybit and binance for the whole run and after it, with a full depth region of about 12,000 dollars at the touch of a 100 percent pump.
Both are positions to hold against funding and convergence, not a round trip, and section 2 says what each one costs to hold.

## 2. The classes of this run

| class | rows | pairs | what the books showed |
|---|---:|---|---|
| standing basis | 352 | SOPH 256, CP 86, HEMI 10 | one venue persistently under the others, both books deep, cross still open at 06:45 |
| off-hours equity perp | 37 | BNC 30, ISRG 7 | underlying closed, indices frozen or self-referential, marks 3 to 8 percent apart |
| coinbase ten dollar bot | 62 | AERO 43, MORPHO 12, TOWNS 7 | one 10 USDC order 5 to 7 percent off market on a book with no other participant |
| flash lag | about 130 | ARB, PONS, DOOD, IOST, FORM, AWE, PIEVERSE, AVNT, CATI, BIRB, HAEDAL and the bursts inside SOPH and CP | one venue moved 1 to 2 percent in a frame and the other followed within 4 to 200 ms |
| dead kraken market | 13 | CRO, CHILLGUY, ICX, CATI, VELO, SYRUP, COOKIE, CFG, RARE | 3,000 to 140,000 dollars of daily volume and widths of 1.4 to 13.7 percent |

The classes overlap.
A SOPH row under one second is a flash inside a basis, and an ARB coinbase row is a flash on a dust venue.
The counts above assign each row to the class that explains its price, not its duration.

### 2a. SOPH, a basis under a pump

Sophon is the same asset on binance, bybit and okx, and the three indices agreed within 0.29 percent on a same second read.
The okx perp traded 1.3 percent under its own index at 06:36, bybit 0.5 percent under and binance 0.85 percent under, so the cross is okx's deeper discount and not a different reference.
The bybit-okx route crossed on every one of five reads between 06:36 and 06:45, at 3,454 to 7,245 ppm at the touch.
With the engine's twenty held levels the region read 2,600 to 4,400 dollars and was exhausted on the bybit side every time.
With the whole book the region was 11,840 dollars at 2,270 ppm average, 29 buy levels against 37 sell levels, and it ended on price.
Predicted funding for 08:00 was okx -0.381 percent, bybit -0.156 percent and binance -0.081 percent per four hours, which pays the long okx short bybit pair about 0.22 percent per interval.
Realised funding over the 24 hours before the run was 0.005 percent on bybit and near zero elsewhere, so no carry had been paid before it.
The interval that contained the run settled at 08:00 at -0.27 percent on bybit, -0.46 percent on okx and -0.23 percent on binance, so the pair earned about 0.2 percent for that interval.
After 08:00 bybit and binance moved SOPH to hourly settlement at their -2 percent cap while okx stayed at -1 percent, so the carry reversed sign, and by 19:01 the bybit-okx cross no longer cleared fees.
The full depth numbers rest on the single 06:45 deep read, since the other four reads fetched only 20 okx levels.

On the row this looks like 256 episodes.
Six chains open at the millisecond the previous row hit the age cap: SOPH binance-okx 791 to 805, 919 to 935 to 938 and 963 to 992, SOPH bybit-okx 806 to 820 and 1224 to 1231, and BNC bybit-binance 1185 to 1218, which is 13 rows with spans of 389 to 684 seconds.
Allowing a reopen within two seconds merges SOPH into episodes of up to 27.6 minutes.
The 1,000 ppm closure threshold sits inside the noise of a 6,000 ppm basis, so 231 rows sit in 58 sequences that close and reopen within two seconds, 49 of them within 100 ms.
The peaks are not the basis either.
Row 1007's peak of 32,046 ppm is one 100 ms okx dip from raw 0.010147 to 0.009946 at 05:36:45.758, 41.4 s into a 63 s episode.
Row 1008 peaks on the same dip and row 1316 on a 4 ms okx dip in the last 100 ms before it collapsed.

### 2b. CP, a basis that pays against the trade

CP is four days old on bybit and six on okx.
Both perps trade far under the 0.0218 index, bybit's mark 2.9 percent under and okx's 6.0 percent under.
Bybit's predicted funding was -2.0 percent per four hours against a 2.5 percent cap, and okx's sat at its -1 percent floor.
Selling bybit and buying okx pays the bybit rate and receives the okx rate, so at the predicted rates the arbitrage direction bled 1 percent per interval and the 2 percent touch gap was eight hours of carry.
The 08:00 settlement realised -1.17 percent on bybit and -0.94 percent on okx, a 0.23 percent bleed for that interval, and by 19:01 the cross no longer cleared fees.
Binance lists no CP perp, so an index check on this pair has two legs.
Live at 06:36 to 06:45 the touch crossed at 17,854 to 24,047 ppm and the full depth region was 24,970 dollars at 9,851 ppm.
The 86 rows, mean peak 8,467 ppm, describe this faithfully and none of them was an arbitrage.

### 2c. HEMI, the ONE pattern with a small index gap

Binance's HEMI wallet is closed on every network, binance spot HEMI trades 2.1 percent above gate and mexc, and binance's index is 74 percent its own spot.
That is the mechanism the second audit found on ONE, but here the two indices sit 0.14 percent apart rather than 5 percent, so the perps still converge.
Both perps pay -0.2 to -0.46 percent per four hours to longs, and a short bybit long binance pair is about funding neutral.
The ten rows lasted 14 to 300 seconds with regions of 1,484 to 3,076 dollars at 3,226 to 5,546 ppm, all exhausted at open, and eight closed by collapse.
These were small, real, and capturable only as a held pair.
At 19:01 the bybit-binance route still crossed at about 1,500 ppm on an 1,100 dollar region, and okx lists no HEMI perp.

### 2d. BNC and ISRG, equity perps on a closed market

BNC on both venues is CEA Industries, a NASDAQ stock, and not Bifrost.
A wallet lookup by coin symbol on gate or kucoin returns Bifrost, so the second audit's wallet probe would misclassify this pair.
Binance's index was 97 percent a dxfeed equity feed that reported -1 with the market closed, and bybit's mark sat 8.2 percent above its 4.255 index at 06:36.
With the market open at 19:02 the two marks were 0.02 percent apart and binance's index had become a six source composite, so the gap is a closed market state.
Bybit's instrument metadata carries `symbolType` stock, `marketRegion` and `underlyingTicker`, which classifies an equity perp without a wallet probe.
Bybit's BNC bid rose from raw 4.508 to 4.630 over 165 seconds of row 1133 while binance's ask moved between 4.480 and 4.488, then bybit came back down and the spread collapsed at 05:57.
The binance ask was not frozen, it changed seven times across the 14 minutes of the three rows, but nothing on the row separates a quiet leg from a dead one.

ISRG's bybit index was bybit's own last price and okx's was a single Ondo ticker, 0.85 percent apart, and with the market open at 19:02 both had become real composites.
Bybit's one minute candles print 367.84 unchanged from 05:00 to 05:40.
All seven rows are 300 second age caps on 110 to 861 dollars of notional, and okx's market order cap on that instrument is 4.4 shares.

### 2e. Coinbase, one bot and no takers

The coinbase bid on the 21 AERO coinbase-binance rows holds 14.9 to 17.7 coins at raw 0.642 to 0.690, which is 9.55 to 11.28 dollars on every row.
Five of the seven TOWNS rows carry 4,410 to 4,520 coins at 9.64 dollars, and the six MORPHO rows where coinbase is the bid carry 4.0 to 4.2 coins at about 10 dollars.
Ten dollars is coinbase's minimum quote size on every product probed.
The coinbase TOWNS tape prints buys of exactly those sizes at 05:06:30, 05:12:20, 05:17:13, 05:27:41 and 05:36:49, which match rows 797, 861, 889, 934 and 1004, each print landing 150 to 250 ms before the row's close.
So the 5.5 to 7.1 percent peaks on 62 rows are one dollar cost averaging bot placing its next ten dollar order above the market.
On 48 of the 70 coinbase rows the coinbase leg holds one value until the closing sample, and on 45 of them that sample is the order being filled, after which the bid falls 9 to 23 percent to the next resting level.
The five MORPHO rows where coinbase is the ask carry 5 to 60 coins, 12 to 145 dollars, and the ARB rows 863 to 866 carry a 1,031 dollar coinbase touch, so not every coinbase row is dust.
At 06:36 AERO-PERP-INTX held 8 bids and 7 asks in total, was 4.9 percent wide, and had traded 25,500 dollars in 24 hours with a median print of 10.4 dollars.
At 19:02 it held 6 bids and 4 asks, was 26 percent wide, and 85 of its last 100 prints were between 9 and 11.5 dollars.
The reverse rows 1264, 1265 and 1266, where a coinbase ask sat 3 percent under binance's bid for 143 seconds on 270 to 793 dollars, were real resting asks that nobody took.
That says the venue has no arbitrageurs, and it is also the answer to why the ten dollar bids survive for an hour.
At 19:02 the ARB coinbase-bybit route crossed at 778 ppm after fees, so the venue does produce crosses under the gate between reads.
All 18 `book_one_sided` events of the run are coinbase, ETC losing its bids ten times and MORPHO its asks five times, and the three `feed_down` rows are MORPHO's ask side emptying rather than a socket loss.

### 2f. Flash lag on liquid pairs

Rows 862 to 866 opened within 114 ms of each other at 05:12:22 on five ARB routes.
Bybit's ask had dipped to raw 0.17367 against binance's bid of 0.17577 and recovered to 0.17541 within 76 ms, and coinbase's ask moved 50 to 145 ms after each row opened.
The regions at open were 9,214 to 30,594 dollars and four of the five were exhausted, which is real depth that existed for less time than an order could travel.
PONS row 917 is the same shape with a 65,930 dollar region at 15,768 ppm for 83 ms, and DOOD, IOST, FORM, AWE, PIEVERSE, AVNT, CATI, BIRB and HAEDAL are the same shape at 2 to 200 ms.
At 06:36 not one of these pairs crossed after fees on any route.
Of the 309 rows under one second, 172 opened on a bybit side jump, 102 closed on the very next sample, and the first move after the open lowered the reading on 259.

## 3. Misleading parts of the table

Each item names the column, what a reader takes it to mean, and what it measures in this run.

1. `netPpmAtOpen` and `peakNetPpm` on a coinbase leg.
   The best level is a ten dollar order, so 5 to 7 percent is the price of one bot's next fill.
   62 rows.
2. `peakNetPpm` on a long row.
   The peak is the opening sample on 340 rows, and on the long SOPH rows it is a 4 to 100 ms dip on the okx ask, rows 1007, 1008 and 1316.
3. `peakEdgeAvgPpm`, `peakEdgeNotional` and `peakEdgeAt`.
   The peak edge is chosen by average ppm, and a shrinking region raises the average, so it lands on the thinnest sample.
   34 rows carry a peak region under a fifth of `maxEdgeNotional`, some of it cents.
4. `maxEdgeNotional`.
   The largest region comes when the books have nearly met, because more level pairs still cross by a little.
   108 rows reach it at under 2,000 ppm, and the column carries no timestamp and no ppm.
5. `edgeExhaustedAtOpen`, `edgeSizeAtOpen` and `edgeNotionalAtOpen`.
   The flag is set on 327 rows at open and 338 at the peak, and on 321 of the 327 it is the twenty level window ending rather than the venue's book ending.
   On SOPH one tick is 98 ppm and a 6,000 ppm cross is 51 to 66 ticks of ladder, which forty held levels cannot span.
   The live SOPH region was 2,644 dollars exhausted with twenty levels and 11,840 dollars on price with the whole book, so the notional columns are lower bounds by a factor of three to four on the pairs that dominate the table and the average ppm is biased upward.
   The row does not say which side ran out.
6. `durationMs`, `openedAt` and `netPpmAtOpen` on an age cap chain.
   Six chains open at the millisecond the previous row closed, and the opening reading never crossed 5,000 from below.
   The true episodes run 389 to 684 seconds in the strict reading and up to 27.6 minutes when reopens within two seconds are merged.
7. `durationMs` on a sweep closed row.
   Row 1251 ISRG reads 300,665 ms with four samples at 0, 20, 39 and 59 ms, so 300.6 seconds of it were never observed.
   `lastSeenAt` is the honest clock.
8. `closeReason` of `feed_down`.
   Rows 779, 1148 and 1149 closed because the coinbase MORPHO book lost its ask side, within two milliseconds of a `book_one_sided` log line.
   The run's one real socket loss, coinbase connection 3 at 05:05:33 after 16 seconds of silence, closed nothing.
9. `avgNetPpm`.
   It is tick weighted and includes the closing sample, which by construction reads under 1,000 ppm and on half of the coinbase rows reads -5 to -20.6 percent.
   227 rows differ from a time weighted mean by over 1,000 ppm, 220 of them downward.
10. `netPpmAtClose` and `minNetPpm` on a collapsed row.
    Both are the first non crossing reading, so their size is the closing jump and not the spread.
    33 rows read under -50,000 ppm, 32 of them coinbase legs and one ICX row 879 on krakenfutures-okx.
11. `edgeAvgPpmAtClose`, `edgeNotionalAtClose` and `edgeExhaustedAtClose` on a collapsed row.
    The walk stops at the first pair with zero size, so they read 0, 0 and false on 317 rows, which is a non measurement shaped like a measurement.
12. `ticks` and `edgeSamples`.
    `ticks` counts both legs, so bybit's 20 ms deltas dominate it, and `edgeSamples` equals `ticks` on every row, which only says both legs held one level.
    Three rows exceed the 10,000 sample series cap and one of them loses its closing sample.
13. Route counts per pair.
    Discovery opens the one argmax bid against the one argmin ask per tick, so "SOPH bybit-okx 124 against binance-okx 97" says which venue bid highest at each opening tick and nothing about which routes crossed.
14. The `Opportunity found` log line.
    It labels the pair with the ask market's own quote, so 23 rows log as USDC or USD pairs and a search by the cluster key misses them.
    It is also the only place the touch sizes survive, and read back, the smaller touch held under 100 dollars on 442 of 597 rows and never exceeded 3,097.

What is not misleading.
Units are right on every row.
Every okx, coinbase and kraken contract size probed equals ccxt's, including okx SOPH at 100 coins per contract, so `edgeSize` is coins and `edgeNotional` is the quote asset.
The raw cross check passes on every row, with the fee stripped bid at least 6,020 ppm over the fee stripped ask at open, so no row is a fee artefact.
`sampleTsMs` is monotonic everywhere.

## 4. Survivors of the honest filters

Cumulative, in this order.

| filter | rows |
|---|---:|
| all | 597 |
| durationMs >= 1000 | 288 |
| both legs moved, closing sample excluded | 253 |
| closeReason spread_collapsed | 228 |
| peakEdgeNotional >= 1000 | 201 |
| peakEdgeAvgPpm >= 2000 | 198 |
| not on a same millisecond age cap chain, which removes SOPH and BNC | 58 |
| no coinbase leg | 58 |
| not exhausted at the peak | 46 |

Of the 46, 45 are CP bybit-okx and belong to section 2b, and one is CHILLGUY row 1252, a resting kraken bid worth about four dollars of edge on a book 0.52 percent wide.
Widening the chain rule to any reopen within two seconds after an age cap also removes CP, ISRG and MORPHO, and leaves row 1252 alone.
Outside the five standing basis pairs and without a coinbase leg there are 138 rows, and 127 of them are under one second.

## 5. What the code does that the row does not say

References are to the working tree of 2026-09-08.

- The age cap close on the tick path rediscovers the same route in the same call, [`OpportunityManager.ts:55-95`](../../server/src/engine/OpportunityManager.ts), and [`OpportunityManager.spec.ts:268`](../../server/src/engine/OpportunityManager.spec.ts) asserts it.
  That is the chain of section 3 item 6.
- Nothing reads `writtenAt` and `recvTs` is only tested for zero, [`Engine.ts:183-192`](../../server/src/engine/Engine.ts) and [`OpportunityManager.ts:413`](../../server/src/engine/OpportunityManager.ts).
  Every book channel is change driven, measured on binance depth20 at 100 ms as zero frames in 12 seconds on ISRGUSDT and no identical consecutive frames on BNCUSDT, so a quiet leg and a dead leg look the same for as long as the socket stays up.
- The sweep and the one sided close carry no closing sample, [`OpportunityManager.ts:429-469`](../../server/src/engine/OpportunityManager.ts), so `netPpmAtClose` and the close edge are the last leg tick.
- Touch sizes and each leg's far side are computed on every sample and dropped by [`conversion.ts`](../../server/src/db/conversion.ts), which writes none of the twelve fields in [`types.ts:85-107`](../../server/src/engine/types.ts).
- The comment on `DEPTH_LEVELS` at [`ClusterIndexBuilder.ts:15`](../../server/src/engine/ClusterIndexBuilder.ts) claims twenty levels cover the 0.5 percent band on the finest tick books, and section 3 item 5 shows it does not.
  Bybit sends 50 levels and okx 400, and the block keeps 20.
- `Engine.updateBook` writes the depth before the quote is validated, [`Engine.ts:133-148`](../../server/src/engine/Engine.ts), so a rejected top leaves the ladder new and the touch old for that leg.
  Zero quotes were rejected in this run, so no row is affected yet.
- `Engine.applyQuote` returns before discovery when the top prices repeat even though the block was rewritten, [`Engine.ts:186-191`](../../server/src/engine/Engine.ts), so a region that drains below the touch between top ticks is never sampled.
- The inverse contract path is latent and wrong.
  ccxt reports binance COIN-M contract sizes in USD, and `sizeMul` would call one BTCUSD_PERP contract 100 coins, but the code audit found a linear twin that `marketRank` prefers for all 42 inverse contracts, so no row is affected today.
- Binance ICXUSDT is `SETTLING` since 2026-08-26 and still publishes an index and a mark 1 percent above the market.
  The run had no binance ICX rows, but an index check that does not filter on status `TRADING` would see a 1 percent disagreement there, and binance listed 130 `SETTLING` and one `PENDING_TRADING` symbol on 2026-09-08.

## 6. Data hygiene

- Six jobs from the third run, ids 2425 to 2430, still carry `roundTripPpm` and fail with `Unknown argument roundTripPpm` at every boot, 30 error lines across the false start and the run.
  [`scripts/redis-flush.sh`](../../scripts/redis-flush.sh) exists and was not run.
- 598 `Opportunity found` lines in the run against 597 rows.
  The missing one is SOPH bybit-binance, found at 06:23:13.786 at 6,433 ppm and closed by the shutdown at 06:23:18.246 after 4,460 ms and 201 ticks.
  Its write is BullMQ job 3032, still waiting in `bull:opportunity-closed:wait` with its data intact.
  `OpportunityManager.shutdown` awaits the `queue.add` promises and not the worker, so the worker's own shutdown hook closed before it fetched the last job.
  The next boot will write it as a row dated 2026-09-08 06:23:13.786 inside whatever run comes next.
- Two processes started 46 seconds apart and the row carries no run id, so nothing joins a row to the boot lines that state its cluster count and coverage.
- The coinbase cutover of 2026-09-09 from [`../backlog/2026-09-05-coinbase-derivatives-cutover.md`](../backlog/2026-09-05-coinbase-derivatives-cutover.md) is one day away.
  At 06:45 the PERP-INTX ids still served, the successor gateway listed 38 perpetuals, and AERO, TOWNS, MORPHO, ARB, SOPH and CP were not among them.
  94 of the observatory's 131 coinbase markets have no successor instrument today.

## 7. Things to verify on the next run

Each item is a check with the query or probe that settles it.
Run them in this order and record the numbers next to the third and fourth run values.

1. The stale queue is empty.
   Boot the server once so the worker drains job 3032 into the table, because [`scripts/redis-flush.sh`](../../scripts/redis-flush.sh) refuses while a job waits and its `--force` would discard that episode.
   Then run the flush to clear the six failed jobs, and after the start confirm zero `opportunity_write_failed` events in the first minute.
   The Prisma error text sits in the `error` attribute and not in the log body, so search the event name or the attribute.
2. Every found episode is written.
   Match every `Opportunity found` line to a row by pair, route and `openedAt` to the millisecond, since the found line prints the ask market's own quote and `opportunity_closed` lines land one millisecond after `closedAt`.
   Count distinct events over timestamp and attributes rather than `uniqExact(body)`, which undercounts identical bodies in the same nanosecond.
   The fourth run read 598 against 597, and the next run's table will hold one extra row from job 3032 dated 2026-09-08.
3. The standing basis pairs are still open and still unclassified.
   Query rows grouped by pair for SOPH, CP, HEMI, BNC and ISRG, and expect them to lead the table again unless they were denied or the index, mark and funding classification of [`../backlog/2026-09-07-standing-basis-classification.md`](../backlog/2026-09-07-standing-basis-classification.md) shipped.
   Probe each with one same second read of the three indices, the three marks and the predicted funding, because a three minute skew fabricated 0.6 to 0.9 percent index gaps on IOST, CATI and HAEDAL in this audit.
4. Age cap chains.
   Count rows whose `openedAt` equals another row's `closedAt` on the same pair and route to the millisecond.
   The fourth run had six chains.
   If a chain exists the pair is a basis and its rows should be read as one episode.
5. The coinbase ten dollar bot.
   Count coinbase legged rows whose `edgeNotionalAtOpen` is under 50 dollars.
   The fourth run had 55 such rows across all venues, nearly all coinbase.
   If the cutover retired the PERP-INTX ids, confirm what coinbase streamed at all and whether the registry should disable the venue until successor instruments exist.
6. Sub second rows.
   Count rows with `durationMs` under 1,000.
   The fourth run had 309 of 597, and the third had 438 of 745.
   The minimum episode age from Phase 4 of [`../ROADMAP.md`](../ROADMAP.md) removes them and has not shipped.
7. The exhausted rate.
   Count rows with `edgeExhaustedAtOpen` true.
   The fourth run had 327 of 597.
   If the held levels were raised, expect the rate to fall on SOPH, HEMI and BNC first, and compare `edgeNotionalAtOpen` on the same pairs with a REST book of the whole depth walked by hand.
8. Frozen legs.
   For every row over one second count distinct values per leg series with the closing sample dropped.
   The fourth run had nine rows with one constant leg, okx ISRG asks and binance BNC sides.
   Until a per leg age is on the row this is the only way to see them.
9. Equity perps outside market hours.
   List rows on ISRG, BNC, UNH and any other tokenised stock and check the underlying's session against `openedAt`.
   If the run is inside US market hours the class should be absent, and if it is outside, every row on these pairs is expected to hit the age cap.
   Bybit's `instruments-info` carries `symbolType`, `marketRegion` and `underlyingTicker`, which lists the equity perps directly.
10. Flash lag.
    For the rows under 200 ms on liquid pairs, read the first two samples of each leg and confirm one venue moved over 1 percent in one frame and the other followed.
    Then check the venue's one minute candle for that minute.
    The fourth run's ARB, PONS and DOOD rows sat inside 2 percent candles.
11. Peak columns.
    Count rows where `peakEdgeNotional` is under a fifth of `maxEdgeNotional`, and rows where the ppm at the max notional sample is under 2,000.
    The fourth run had 34 and 108.
12. The close sample.
    Count `spread_collapsed` rows with `edgeNotionalAtClose` equal to zero, and `age_cap` rows whose `lastSeenAt` is more than ten seconds before `closedAt`.
    The fourth run had 317 and the ISRG rows.
13. The one sided close.
    Join `feed_down` rows to `book_one_sided` log lines at the same millisecond.
    All three matched in the fourth run, and the enum still has no `side_empty` reason.
14. Binance status filter.
    Confirm no `SETTLING` or `PENDING_TRADING` binance market reached a cluster, and that ICXUSDT is excluded.
    On 2026-09-08 binance listed 766 `TRADING`, 130 `SETTLING` and one `PENDING_TRADING` symbol.
15. The pair label in `Opportunity found`.
    Count lines whose pair reads `/ USDC` or `/ USD` and confirm they match rows whose ask market is a USDC or USD contract, 23 in the fourth run.
16. Coverage.
    Record the five `streaming N of M markets` lines and the cluster count, and diff them against the fourth run's values in section 0.

## 8. Order of repair, proposed

Sizes are estimates from a read only code map and are not commitments.
Every item below and every gap of section 5 is a GitHub issue, numbers 3 to 16, listed in [`../backlog/2026-09-08-judgment-inputs.md`](../backlog/2026-09-08-judgment-inputs.md) and in the repository's issue tracker.

1. Drain the queue at shutdown by polling the waiting and active counts after `engine.shutdown`, run the redis flush before every start, and add a run id to the row.
   Size S.
2. Minimum episode age, Phase 4 of the roadmap.
   Removes 309 rows of this run.
   Size S.
3. Index, mark and funding per leg at open, read in one pass per venue so both legs share a second, with status `TRADING` filtered.
   Tags SOPH, CP, HEMI, BNC and ISRG, which are 389 rows, and replaces the hand kept denial list.
   Bybit's `symbolType` field tags the equity perps on its own.
   Size M.
4. Per leg age at open, peak and close, and a `side_empty` close reason.
   Size S.
5. Touch sizes and far sides on the row, which are already in memory.
   Size S.
6. Depth window as a price band rather than a flat twenty, keeping bybit's 50 and okx's 400 where the venue sends them, with the side that ran out recorded on the row.
   Size M.
7. Peak edge with a minimum region, a timestamp and a ppm on `maxEdgeNotional`, and a time weighted average.
   Size S.
8. Coinbase off, or at least a minimum region of 50 dollars, until the cutover settles and a successor instrument list exists.
   Size S.

## 9. Live probes

All at 2026-09-08 UTC, all endpoints public and unauthenticated, raw responses under the session scratch directory.

| time | probe | result |
|---|---|---|
| 06:27 | binance premiumIndex, bybit tickers, okx index and instruments, SOPH | up 106 percent in 24 h, funding -0.07 to -0.14 percent, okx ctVal 100 |
| 06:36 to 06:45 | books x5 on SOPH bybit, binance, okx | bybit-okx crossed 3,454 to 7,245 ppm on every read, 11,840 dollar full region at 2,270 ppm |
| 06:36 to 06:45 | books x4 on CP bybit, okx | 17,854 to 24,047 ppm, 24,970 dollar full region, funding at both caps against the arb |
| 06:36 | bybit and binance instrument metadata, BNC | CEA Industries on both, index -1 with the market closed, marks 3 percent apart |
| 06:36 | binance wallet, gate, mexc, HEMI | binance wallet closed on every network, binance spot 2.1 percent above gate and mexc |
| 06:37 | bybit and okx ISRG index components and candles | bybit index equals its last price, okx index is one Ondo ticker, candles flat 05:00 to 05:40 |
| 06:36 to 06:51 | coinbase product_book and tape, AERO, TOWNS, MORPHO, ARB, PENDLE, AVNT | 8 bids and 7 asks on AERO, ten dollar prints matching rows to the second, no route crossing |
| 06:41 | binance depth20 at 100 ms on BNC, SOPH, HEMI, ARIA for 30 s | change driven, zero identical frames, 9.8 s gaps on ARIA |
| 06:42 | ccxt loadMarkets against okx, coinbase, kraken, bybit, binance instrument endpoints | contract sizes agree on every market probed |
| 06:45 | coinbase Advanced products, drb.coinbase.com instruments, INTX instruments | PERP-INTX ids live, 38 successor perpetuals, none for the run's coinbase pairs |
| 06:45:21 to 06:45:24 | same second index reread on 26 pairs | gaps over 0.25 percent only on ARIA, SOPH, ICX |
| 19:01 to 19:05 | re-probe of SOPH, CP, HEMI, BNC, ISRG, AERO and ARB books, indices and funding | SOPH and CP no longer clear fees, HEMI still 1,500 ppm, BNC marks 0.02 percent apart with the market open, AERO 26 percent wide, ARB coinbase-bybit 778 ppm |
