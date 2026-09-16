# ArbitrageOpportunity: fifth-run data audit

Date: 2026-09-15 in UTC, with live probes on 2026-09-16 between 00:50 and 01:20 UTC.
This follows [`2026-09-08-fourth-run-data-audit.md`](./2026-09-08-fourth-run-data-audit.md), called "the fourth audit" below.
It is the fifth audit in this folder, and the runs between the two audits were judged inside the design and research docs that shipped the fresh edge verdict, the open guards and the minimum cross age.
It audits the first run on the home server, which is also the first run with the minimum cross age of [`../plans/2026-09-15-minimum-cross-age-design.md`](../plans/2026-09-15-minimum-cross-age-design.md) and the Binance real time depth of [`../plans/2026-09-15-binance-realtime-depth-design.md`](../plans/2026-09-15-binance-realtime-depth-design.md).
Every number below was read from the table, from the SigNoz logs of the home server, or from a public REST probe, and the probe times are in section 8.
Two independent passes worked the rows and the venue tapes, and the decisive tape comparisons were re-derived by hand before their results were folded in.

## 0. What the sample is

One process on the home server, pid 31488.
`orchestrator_started` at 06:56:37.901 and `orchestrator_stopped` at 23:43:09.113, which is 16 hours and 46 minutes.
Boot: `Built 694 clusters across 5 venues` and `Denied 4 pair(s) as non-comparable clusters: ONE|USDT, QNT|USDT, BB|USDT, ON|USDT`.
Markets streamed: bybit 659 of 852, binance 652 of 782, okx 434 of 479, krakenfutures 247 of 275, coinbase 124 of 131.
The rows were imported into the laptop database with an id offset of 2,754, so they are ids 2755 to 2820, 66 rows, with `openedAt` from 07:31:03 to 22:27:16.
Ids 2737 to 2754 are the laptop run of the same morning and are not part of this audit.
Every one of the 66 rows matches an `opportunity_closed` log line by pair, route and `closedAt` within 2 ms.

The gates in force were the raw cross and the fresh edge at `MIN_NET_PPM` 5,000, `MAX_ANCHOR_MOVE_PPM` 1,000 per poll, `MIN_EDGE_NOTIONAL` 1,000 quote units, `MIN_CROSS_AGE_MS` 100, and `CLOSURE_NET_PPM` 1,000 on both the raw cross and the fresh edge.

| closeReason | rows |
|---|---:|
| fresh_edge_collapsed | 32 |
| spread_collapsed | 30 |
| feed_down | 4 |
| age_cap | 0 |

| durationMs | rows |
|---|---:|
| under 100 ms | 2 |
| 100 ms to 1 s | 18 |
| 1 s to 10 s | 27 |
| 10 s to 60 s | 16 |
| over 60 s | 3 |

Venue legs across the 66 rows: binance 51, bybit 51, okx 18, krakenfutures 12, coinbase 0.

The run refused 3,155,976 opens and wrote 66 rows.

| refusal | occurrences |
|---|---:|
| standing_basis | 1,754,420 |
| anchor_moving | 1,391,547 |
| thin_book | 8,367 |
| anchor_skewed | 1,247 |
| unconfirmed_cross | 394 |
| anchor_missing | 1 |

355 pairs and 852 pair routes were refused at least once.
LSK bybit-binance alone was refused 901,748 times as a standing basis and 1,080,977 times as a moving anchor, and it wrote two rows.

One fact about the export matters for the next audit.
The SigNoz JSON export carries `attributes_string` only, so every number on a refusal line, `netPpm`, `freshNetPpm`, `occurrenceCount`, `ageMs` and `edgeNotional`, and every number on an `anchor_poll_summary` line, is missing from it.
The numbers above come from a second export of `attributes_number` read straight from the home server's ClickHouse over ssh.

## 1. Has a capturable opportunity been recorded

No.
Of the 66 rows, 58 describe a cross that a taker could not have taken, and the eight that remain are sub second flashes and one nine second convergence on regions of 1,366 to 5,628 quote units.

- 30 rows are the engine's own delayed view of okx and krakenfutures, and in five cases of binance, inside two market wide flash crashes at 18:37 and 18:45 to 18:49 UTC.
  The crosses did not exist on the venues' clocks.
- 22 rows are a standing basis that crossed the fresh gate by 9 to 4,082 ppm for 34 ms to 193 s while one venue's mark sat away from its own perp.
  The raw cross never converged on any of them, and every closed loop is negative.
- 6 rows are a kraken quote on a one maker book that did not reprice for 0.4 s to 14.8 s.
- 7 rows are a flash on one pair that the other venue matched within 127 ms to 1.4 s, and the tape check that refuted the burst rows could not be run on their bybit legs.
- 1 row, AKE 2819, is a two sided dislocation that converged over nine seconds on a 1,502 quote unit region, about 3,100 ppm before each venue's own spread, which is under five dollars.

The minimum cross age did what it was built for.
394 crosses died before their 100 ms, at a median age of 33 ms, and no row opened on a first sample under 5,000.
The class it removed, the flicker of [`../bestiary/flicker.md`](../bestiary/flicker.md), was 21 of 39 rows in the run before it and is 2 of 66 here.

## 2. The classes of this run

| class | rows | pairs | what the books showed |
|---|---:|---|---|
| view lagged in a crash | 30 | RAVE 2, SPX, OP 3, KAT, KAITO, LAB, ETH, STX, MUBARAK, INIT, AERO, SQD, ASTER 2, FOGO, SAND, LINEA, C, MARSCOIN, HEMI, POWR, TRIA, 1000LUNC, ESPORTS, IOST 3 | okx and kraken legs 1.1 to 3.7 s behind their own tapes, binance legs 1 s behind on three rows and current on the rest |
| gate margin basis | 22 | SIREN 11, ZIL 3, ACE 2, CVC 2, LSK 2, AXL, MTL | fresh edge 5,009 to 9,082 at open while the route sat refused as standing_basis in thousands of ten second windows |
| kraken resting order | 6 | BAT, MNT, SSV, CVX, VELO, CRO | one kraken value for the whole row on books with 3,047 to 153,476 dollars of daily volume |
| single pair flash | 7 | EVAA, POWER, ZKC, IOTA, AKE 2, UAI | one venue moved 0.8 to 6 percent against its mark and the other followed within 1.4 s |
| converged dislocation | 1 | AKE | both legs moved toward each other for nine seconds |

### 2a. The view lagged the venue inside two flash crashes

The 18:37 minute was a market wide flash drop with a recovery inside the minute.
Binance ETHUSDT printed open 2419.41, low 2371.50 and close 2410.01 on 186,731 ETH of volume, against 5,452 to 16,743 ETH in each of the four minutes before.
BTCUSDT fell from 76,468.6 to 75,813.1.
Kraken PF_ETHUSD printed a low of 2360.5, under binance's low, and closed at 2410.0.
The one minute lows were 1.98 percent under the open on binance, 2.25 on okx, 2.02 on bybit and 2.43 on kraken for ETH, and RAVE fell 5.7 percent, STX 4.3 to 5.2, OP 2.8 to 3.1, KAITO 2.0 to 2.2 and AERO 1.6 to 2.0.
A second leg followed at 18:45, when BTC fell from 75,745 to 75,312, MARSCOIN 3.7 percent and C 3.4 percent, and IOST kept falling to a 2.8 percent low at 18:49.
Every venue printed each drop in the same second, and okx crashed RAVE, OP, KAITO and AERO in the same second as binance did.

What lagged was the engine's view of the slow sockets, measured against the venues' own trade tapes.

| row | leg | the row showed | the venue's tape said |
|---|---|---|---|
| 2787 ETH krakenfutures-binance | kraken bid | 2406.6 at 18:37:11.669, walking down to 2386.0 by 18:37:13.976 | last print at or above 2405 at 18:37:09.458, prints of 2376.0 to 2383.4 during 18:37:11, 2367.8 at 18:37:12.000 |
| 2787 ETH krakenfutures-binance | binance ask | 2378.49 from 18:37:11.669 to 12.545 | 826 taker buys down to 2374.91 in that window, then 657 down to 2371.51 while the row held 2378.37 |
| 2784 KAITO okx-binance | okx bid | 0.2912 from 18:37:10.144 to 12.370 | last print at or above 0.2912 at 18:37:09.182, 655 prints of 0.2858 to 0.2880 during 18:37:10 |
| 2782 OP okx-binance | okx bid | 0.09778 at 18:37:10.502 | prints at or above 0.09778 only from 18:37:08.070 to 09.432, 0.09628 to 0.097 during 18:37:10 |
| 2785 OP krakenfutures-binance | kraken bid | 0.09757 from 18:37:10.659, 0.09747 from 12.973 | six kraken prints in 35 s, a sell at 0.0976 at 18:37:04.000, then taker sells at 0.09586 and 0.09662 at 18:37:13.000 |
| 2779 and 2780 RAVE okx | okx bid | 0.1797 from 18:37:01.649 to 02.257 | last print at or above 0.1797 at 18:37:00.528, 1,874 prints of 0.1743 to 0.1793 during 18:37:01 |
| 2795 AERO okx-bybit | okx bid | 0.535 to 0.5351 from 18:37:10.608 to 12.367 | last taker sell at or above 0.5349 at 18:37:09.357, 0.5286 to 0.5325 during 18:37:10 |
| 2788 STX krakenfutures-binance | kraken bid | 0.25237 from 18:37:09.863 to 12.398 | a 20,180 STX bid placed at 14:35:30, consumed by 14 taker sells between 18:37:09.428 and 09.450 |

Fitting each leg's series to the venue's last print with a time shift, the okx legs sit 1.1 to 3.7 s behind their tape, KAITO 3.1 s, AERO 3.7 s, RAVE 1.7 to 1.8 s and OP 1.2 s.
The kraken legs sit 2.2 to 2.9 s behind.
The binance legs of ETH, OP and STX sit about 1 s behind, and the binance legs of KAITO, RAVE, MARSCOIN and C track their tape within 0.1 to 0.7 s.
So each row is the lagging leg's pre crash price against the current leg's post crash price.
The one cross that existed on the venues' clocks is STX at 18:37:09.43, a four hour old 20,180 STX kraken bid worth 5,093 dollars hit while binance printed at or under the row's buy price, and it lasted about 25 ms.
The row opened 413 ms after that bid was gone.

The process was not stalled.
Between 18:37:10 and 18:37:16 eight to twelve rows were open, and no gap of 150 ms passed without a sample from one of them, the longest silence being 157 ms at 18:37:16.410.
Each socket was late by its own amount, which is a per socket backlog and not a blocked loop.
Where the time went cannot be read from this run, because every frame from every venue carries an exchange timestamp and `publish` in [`../../server/src/feeds/book/VenueFeed.ts`](../../server/src/feeds/book/VenueFeed.ts) stamps the book with `Date.now()` instead.

The binance sockets broke under the burst.
`binance#linear#0` reconnected 146 times and `binance#linear#1` 47 times between 18:37:15.302 and 18:56:46.739, a median of 2.8 s apart, each followed by the four subscribe acknowledgements a median 1.8 s later, while connections 2 and 3 never reconnected.
The first reconnect came 13.7 s after the first burst row and 5.2 s after the 18:37:10 cluster, so no first burst row opened on a reseeded book.
The client's own idle kill fired once all day, on bybit at 11:15:38, and never on binance, and the reconnect line carries no close code, so a server side close of a slow consumer is the likely cause and cannot be proven from this export.
Hour 13 had 21 binance reconnects with the same 3 s cadence at 13:34 and 13:39, so the shape is not new.
Anchor polls suffered too: in hour 18 every venue's `maxMs` reached 6,600 to 8,100 ms with 314 skipped rounds, against 63 of 1,007 minutes with any venue over 3,000 ms across the run.

Five rows are the binance socket itself.
1000LUNC 2792 opened 84 ms before `binance#linear#0` closed and has one sample.
ESPORTS 2798 opened 802 ms after `binance#linear#1` was reseeded, held one binance bid at its mark while the bybit ask sat 2.69 percent under the bybit mark, and died when that socket closed 206 ms later.
IOST 2811, 2813 and 2812 are one wick: bybit and okx bottomed at 18:49:05.09, binance's deeper wick arrived 1.7 s later, and the server closed `binance#linear#0` at 18:49:08.010.
CVX 2794 and SIREN 2800 also closed as `feed_down` under a binance close and are counted in their own classes.

Nothing in the gates reads a leg's lag.
`anchor_moving` wrote 232 refusal lines in the 18:37 minute and went blind on the rows it had already admitted, and a blind sample closes nothing, which is how AERO 2795 ran 5 s at 4,000 to 5,000 raw.
The minimum cross age measures our own clock, so a stale leg that stays stale passes it.

### 2b. Standing basis at the gate margin

The fresh gate held these routes back for most of the run and let 22 excursions through.

| route | standing_basis refusals | fresh at refusal, median and max | rows | fresh at open on the rows |
|---|---:|---|---:|---|
| SIREN bybit-binance | 20,364 | -1,940 and 4,998 | 11 | 5,009 to 9,082 |
| ZIL okx-bybit | 59,812 | -1,049 and 3,978 | 2 | 5,356 and 9,029 |
| ZIL okx-binance | 17,700 | -1,000 and 3,784 | 1 | 5,469 |
| ACE bybit-binance | 106,318 | -1,364 and 4,732 | 2 | 5,169 and 5,291 |
| CVC bybit-binance | 60,273 | -1,424 and 4,638 | 2 | 5,480 and 5,957 |
| LSK bybit-binance | 901,748 | -1,070 and 4,605 | 2 | 5,146 and 10,266 |
| AXL bybit-binance | 6,136 | -1,049 and 4,940 | 1 | 5,148 |
| MTL bybit-binance | 13,721 | -1,512 and 3,956 | 1 | 7,420 |

13 of the 22 opened under 6,000, at 5,009 to 5,957, and 23 of the 66 rows sit within 1,000 ppm of the gate.
The raw cross never fell under 5,000 inside 13 of the 22, and it read 4,227 to 26,254 at close on every one of them.
21 closed as `fresh_edge_collapsed`, and 25 of the run's 32 fresh closes landed on the sample where an anchor changed, so the poll closed them and the books did not.
The closed loop, selling the bid series and buying the ask series at open and unwinding at the last sample, is -626 to -3,315 ppm on all 22 before either venue's own spread.

The mechanism differs by pair, and a live read on 2026-09-16 shows each one still standing.

SIREN is a bybit index dip inside a thin basket.
Bybit's SIREN index is BinanceAlpha 0.3, Mexc 0.3, Binance_Futures 0.3 and Binance_Index 0.1, and binance's is its own perp 0.375, binance alpha 0.375 and a pancakeswap pool 0.25.
Mexc printed 0.02569 against alpha's 0.02477, 3.7 percent apart, because SIREN is disabled on gate and its deposits are disabled on kucoin, so the basket's spot venues cannot be kept together.
In the minute of row 2763 the bybit index fell 0.8 percent, from 0.0252 to 0.02499, the bybit mark followed it from 0.02528 to 0.02505, and the bybit perp stayed at 0.02528.
The bybit bid therefore read 0.84 percent over the bybit mark and the route read 6,513 ppm fresh.
Over the next 90 s the bybit mark climbed back to 0.02522 and the fresh edge fell to 919, which closed the row while the raw cross still read 9,323.
Row 2815 at 18:52 is the same shape, an index dip of 0.85 percent and a mark that climbed from 0.02452 to 0.02485.
On every SIREN row the bybit bid sat 0.57 to 1.06 percent over the bybit mark while the binance ask sat within 0.16 percent of the binance mark.
Live, the route still crosses raw by 8,669 ppm after fees and reads -2,094 ppm fresh, and both legs' funding pays against the short bybit long binance position, about 0.15 percent per four hour interval.

ZIL is the ONE shape of [`../bestiary/standing-basis.md`](../bestiary/standing-basis.md), an index gap that nothing can close.
Okx's ZIL index sits 22,750 ppm over binance's and 21,731 over bybit's, because okx weights bybit, mexc and kucoin spot at 46.7 percent and those markets are stranded: ZIL is disabled on gate and its deposits and withdrawals are disabled on kucoin, so bybit spot trades 4.1 percent above binance spot.
The okx perp sits 1.2 percent under its own inflated index with funding at the -1 percent floor.
The three rows opened when the other leg's mark lagged its perp, binance's by 0.80 percent on 2756, and the routes read -646 and -696 fresh live.

CVC, LSK, ACE, AXL and MTL are the binance perp's discount to its index, carried by funding.
Live, the binance mark sits 2.15 percent under the CVC index with longs receiving 0.987 percent per four hours, 1.97 percent under the LSK index at 0.379 percent per hour, and 0.33, 0.57 and 0.77 percent under the ACE, AXL and MTL indices.
The rows opened when a spike put the binance ask 0.56 to 0.80 percent under the binance mark, and closed when the mark caught up.
Live, CVC and LSK still cross raw by 16,198 and 13,577 ppm and read -727 and -1,111 fresh, and ACE, AXL and MTL no longer cross.

The gate refused these routes with fresh maxima of 3,784 to 4,998 and admitted 13 of the rows at 5,009 to 5,957, so the margin between a refusal and a row was often under 300 ppm.
A mark is a smoothed function of an index, and a perp excursion or an index dip that the mark has not absorbed reads as fresh for exactly as long as the smoothing window.

### 2c. Kraken resting orders on one maker books

Six rows carry a kraken leg that held one value for the whole row, 0.4 s to 14.8 s, while the other leg moved.
Live reads of the six books on 2026-09-16 at 01:05 UTC.

| market | levels bid, ask | own spread | 24 h volume | last trade age | one maker |
|---|---|---:|---:|---|---|
| PF_BATUSD | 11, 6 | 0.45 percent | 153,476 dollars | 4 min | no, but thin |
| PF_MNTUSD | 16, 13 | 0.63 percent | 3,047 dollars | 6 min | yes, size 5,559 repeated |
| PF_SSVUSD | 23, 15 | 0.40 percent | 4,860 dollars | 356 min | yes, size 345.1 on both sides |
| PF_CVXUSD | 25, 12 | 0.70 percent | 81,873 dollars | 5 min | mostly, size 913 on both sides |
| PF_VELOUSD | 5, 5 | 0.48 percent | 6,896 dollars | 5 min | yes, 291,000 contracts a side |
| PF_CROUSD | 26, 43 | 0.60 percent | 83,470 dollars | 141 min | yes at the touch, 15,000 a side |

BAT 2758 bought one kraken ask of 0.074 for 6.6 s while the kraken mark read 0.07477, so the ask sat 1.03 percent under kraken's own mark, which is the 1 percent cap kraken publishes on its mark premium.
CRO 2797 sold one kraken bid of 0.057 for 14.8 s with the kraken mark 5,789 ppm over its index, again near the cap.
SSV 2793, CVX 2794, VELO 2796 and CRO 2797 sit inside the 18:37 burst, so their kraken legs are also 2 to 3 s stale, and the row cannot say which of the two facts it is showing.
The region floor passed them at 1,181 to 9,460 quote units, and the row carries no far side, so a kraken spread of 0.40 to 0.70 percent is invisible on it.
This is the class of [`../bestiary/slow-venue-resting-order.md`](../bestiary/slow-venue-resting-order.md), a real order and not free money.

### 2d. Single pair flashes

Seven rows outside the bursts are one venue moving against its own mark and the other following.
EVAA 2755: the bybit ask sat 5.19 percent under the bybit mark and rebounded 1.34 percent while binance fell 1.61 percent to meet it at 319 ms.
POWER 2760: the binance bid sat 0.88 percent over the binance mark for 1.27 s until the bybit ask rose 0.49 percent in 6 ms.
ZKC 2772: the binance ask sat 1.30 percent under its mark, and the bybit bid held for 327 ms then fell 1.24 percent in 41 ms.
IOTA 2773: the bybit ask sat 0.80 percent under its mark, and the net read over 5,000 for 74 ms only.
AKE 2775 and 2776: a flash crash 6 percent deep on binance, 134 ms and 127 ms, gone before an order could arrive.
UAI 2777: the binance bid sat 0.90 percent over its mark for 975 ms.
On the row's own arithmetic five of the seven close positive, 2,319 to 27,377 ppm, on regions of 1,366 to 5,628 quote units.
Bybit publishes no trade history by time, so the check that refuted the burst rows could not be run on their bybit legs, and the burst showed that a 1 s lag on this host is ordinary under load.
They are the flash lag class of the fourth audit, section 2f, now surviving the minimum cross age because they lived longer than 100 ms.

### 2e. One converged dislocation

AKE 2819 opened at 20:23:56 with the binance bid 0.40 percent over the binance mark and the bybit ask 0.25 percent under the bybit mark, 6,648 ppm raw and 5,422 fresh.
Binance slid 0.27 percent and bybit rose 0.25 percent over nine seconds, the raw cross fell to 1,412 and the poll closed it.
The region was 1,502 quote units and the closed loop about 3,100 ppm before each venue's own spread, which live is 578 ppm on bybit.
That is under five dollars.

## 3. What the gates did

- The minimum cross age refused 394 crosses at a median age of 33 ms and a p90 of 89 ms, 31 of them over 100 ms because the guards kept refusing a pending cross until it vanished.
  No row opened on a first sample under 5,000, and 2 rows lived under 100 ms, CVC 2762 at 34 ms and 1000LUNC 2792 at 83 ms.
- `standing_basis` refused 1,754,420 opens, and the routes that wrote rows were refused with fresh maxima of 3,784 to 4,998.
- `anchor_moving` refused 1,391,547 opens, and 2,799 of the 5,032 samples on the 66 rows, 55.6 percent, were blind because a poll inside the row moved more than 1,000 ppm.
  22 rows are at least half blind.
  A blind sample closes nothing, and `freshNetPpmAtClose` and `freshNetPpmAtPeak` are null on 15 and 14 rows because the closing or peak sample was blind.
- `thin_book` refused 8,367 opens at a median region of 10 quote units, and no coinbase leg reached a row.
- The fresh close fired 32 times, 25 of them on the sample where an anchor changed.
- The binance real time depth logged 7 `book_desync` sequence gaps on 3 markets, POWERUSDT, AKEUSDT and ETHUSDT, none between 18:37 and 18:46, and its legs tracked the tape within 0.1 to 0.7 s outside the burst.

## 4. Misleading parts of the table

1. `netPpmAtOpen`, `peakNetPpm`, `durationMs` and every edge column on the 30 lag rows.
   They measure the distance between two clocks, and `edgeNotionalAtOpen` of 134,355 on ETH 2787 is the size of a region that never existed.
2. `freshNetPpmAtClose` null on 15 rows and `freshNetPpmAtPeak` null on 14.
   A null means the sample was refused as `anchor_moving`, and the last readable value sits in `freshNetPpmSeries`.
3. `anchorTsMs` of a single zero on a blind row.
   The anchors changed, but a blind sample records no anchor, so the series says nothing moved.
4. `closeReason` of `fresh_edge_collapsed` on 25 of 32 rows.
   It names the poll that landed, not a convergence, and the raw cross read 4,204 to 21,974 on those closing samples.
5. `edgeNotionalAtOpen` on a kraken leg.
   It is one maker's quote counted at face value, with that venue's own spread of 0.40 to 0.70 percent missing from the row, because [`../../server/src/db/conversion.ts`](../../server/src/db/conversion.ts) writes neither far side.

## 5. Order of repair, proposed

1. Carry each frame's exchange timestamp into the book and onto the row, and refuse a route whose legs' exchange times differ by more than about 250 ms or trail `now` by more than that.
   Every venue frame carries one, and the 30 lag rows sat 1 to 3.7 s behind.
   Size S.
2. Give the fresh gate memory.
   A route refused as `standing_basis` inside the last minute opens only when the fresh edge has held above the gate across one full anchor refresh on both legs.
   It removes the gate margin class, 22 rows, and would not have touched AKE 2819.
   Size S.
3. Write the far sides on the row and refuse a leg whose own spread exceeds the fresh edge, together with the age of the venue's last trade for kraken.
   It removes the six kraken rows.
   Size S.
4. Treat a socket that closed inside the last few seconds as unhealthy until its second snapshot, and log the close code on the reconnect line.
   It removes the five binance socket rows and names the cause of the flapping.
   Size S.
5. Record a mid episode refusal on the row, and close a route that has been blind for more than one anchor cadence.
   Size S.

## 6. Things to verify on the next run

1. Per leg lag.
   With exchange timestamps on the row, count rows where either leg trails the other by over 250 ms at open, and expect the 18:37 shape to become refusals.
2. Fresh margin.
   Count rows with `freshNetPpmAtOpen` under 6,000 whose route was refused as `standing_basis` in the ten minutes before the open.
   This run had 13 such rows in the basis class.
3. Blind share.
   Count samples at -2,000,000 in `freshNetPpmSeries` over all samples, this run 55.6 percent, and rows with a null `freshNetPpmAtClose`, this run 15.
4. Poll closes.
   Count `fresh_edge_collapsed` rows whose closing sample is within 50 ms of the last `anchorTsMs` entry, this run 25 of 32.
5. Kraken legs.
   Count rows where a kraken leg holds one distinct value with the closing sample dropped, this run 6 of 12 kraken legs.
6. Socket health.
   Count reconnect lines per connection per hour, this run 193 in hour 18 on two binance connections, and join `feed_down` rows to them.
7. Minimum cross age.
   Count `unconfirmed_cross` occurrences and rows under 100 ms, this run 394 and 2.
8. The export.
   Export `attributes_number` with the logs, or the refusal numbers are lost.

## 7. Data hygiene

- The rows were imported from the home server with an id offset of 2,754, and every row matches its close line, so the import is complete.
- `opportunities_written` fired 66 times against 66 `opportunity_closed` lines, so no job was left in the queue.
- 187 `book_one_sided` lines were written, all on coinbase, 80 of them in hour 18.
- The reconnect line of a feed carries no close code, so the cause of a socket close is never on record.

## 8. Live probes

All endpoints public and unauthenticated, raw responses under the session scratch directory.

| time UTC | probe | result |
|---|---|---|
| 2026-09-16 00:50 | ClickHouse on the home server over ssh | the numeric refusal and poll fields the JSON export lacks |
| 2026-09-16 00:55 to 01:20 | binance 1 m klines and aggTrades, kraken 1 m OHLC and executions for ETH and BTC, 18:33 to 18:51 and 18:37:05 to 18:37:16 | the flash crash, the kraken lag on row 2787, the binance leg current |
| 2026-09-16 01:01 to 01:08 | binance aggTrades, okx history trades and 1 s candles, kraken executions and OHLC, bybit 1 m klines for ETH, KAITO, OP, RAVE, AERO, STX, MARSCOIN, C | the lag fits of section 2a |
| 2026-09-16 01:04 to 01:05 | binance and bybit SIREN constituents, premium index, funding, books, mark and index klines for 10:42 to 10:46 and 18:51 to 18:55 | the bybit index dip behind the SIREN rows |
| 2026-09-16 01:05 | index, mark, funding, baskets and books for ZIL, CVC, LSK, ACE, AXL, MTL and AKE, and gate and kucoin wallet status | the standing bases of section 2b |
| 2026-09-16 01:05 | kraken order books and tickers for PF_BATUSD, PF_MNTUSD, PF_SSVUSD, PF_CVXUSD, PF_VELOUSD, PF_CROUSD | the one maker books of section 2c |

## 9. Every row

Prices are raw, with the fees divided out.
`net` and `fresh` are ppm at open and at close, `region` is `edgeNotionalAtOpen` in quote units, `loop` is the closed loop in ppm on the row's own series before either venue's own spread, and `basis refusals` is how often the same pair and route was refused as `standing_basis` over the run.
A `blind` fresh at close means the closing sample was refused as `anchor_moving`.

| id | pair | route | open UTC | ms | close | class | net open, close | fresh open, close | region | loop | basis refusals | reading |
|---:|---|---|---|---:|---|---|---|---|---:|---:|---:|---|
| 2755 | EVAA | binance-bybit | 07:31:03.327 | 319 | spread | single pair flash | 30299, 330 | 31129, 1107 | 1872 | 27377 | 0 | bybit EVAA ask 5.19% under the bybit mark at open (a bybit flash crash), binance bid 2.14% under its mark. bybit rebounded +1.34% and binance fell -1.61% to meet at 319 ms |
| 2756 | ZIL | okx-binance | 07:42:13.05 | 8076 | fresh | gate margin basis | 23374, 21974 | 5469, -1663 | 23476 | -626 | 17700 | binance ask 0.80% under the binance mark, okx bid 0.16% under its mark. okx ZIL index 4.16% above the binance index (different anchors). raw never converged |
| 2757 | ACE | bybit-binance | 07:57:56.474 | 15950 | fresh | gate margin basis | 5918, 5740 | 5291, 799 | 2371 | -1924 | 106318 | binance ask 0.66% under the binance mark, bybit bid 0.03% under its mark. opened 124 s before the 08:00 settlement on both legs (bybit -0.605%/4h, binance -0.410%/4h). raw min 3,133 at 14.8 s |
| 2758 | BAT | bybit-krakenfutures | 08:02:56.535 | 6634 | fresh | kraken resting order | 9750, 7050 | 7973, 568 | 2711 | 574 | 103 | kraken ask one value for 6.6 s and 1.03% under the kraken mark, which is the 1% premium cap, so the kraken leg reads +1% fresh whatever the book does. bybit bid fell 0.27% |
| 2759 | AXL | bybit-binance | 08:33:59.198 | 14954 | fresh | gate margin basis | 13209, 12839 | 5148, -1784 | 4016 | -1730 | 6136 | binance ask 0.56% under the binance mark, bybit bid 0.06% over its mark. raw cross 1.1 to 1.3% never converged |
| 2760 | POWER | binance-bybit | 08:43:46.664 | 1275 | spread | single pair flash | 6112, 847 | 7305, 1441 | 1366 | 3157 | 0 | binance bid 0.88% over the binance mark (binance spike), bybit ask at its mark. bybit ask stayed within 0.15196 to 0.15207 for 1.27 s then rose 0.49% in 6 ms |
| 2761 | ACE | bybit-binance | 08:49:29.683 | 26869 | fresh | gate margin basis | 6287, 6712 | 5169, -1233 | 1670 | -2521 | 106318 | binance ask 0.75% under the binance mark, bybit bid 0.13% under. raw dipped to 4,983 at 598 ms then 5,000 to 6,700 for 26 s |
| 2762 | CVC | bybit-binance | 09:39:42.207 | 34 | fresh | gate margin basis | 17780, 12151 | 5957, 393 | 11314 | 3436 | 60273 | binance ask 0.73% under its mark. bybit bid fell 0.45% inside 34 ms and fresh went 5,957 to 393 on the books. raw 1.2% never converged |
| 2763 | SIREN | bybit-binance | 10:43:18.506 | 92300 | fresh | gate margin basis | 8928, 9323 | 6513, 919 | 9267 | -2492 | 20364 | bybit bid 0.84% over the bybit mark, binance ask 0.08% over its mark. bybit mark 0.11% over the bybit index. raw 0.9% for 92 s never converged |
| 2764 | SIREN | bybit-binance | 10:49:18.505 | 42381 | fresh | gate margin basis | 7362, 6527 | 5791, -2775 | 4417 | -1268 | 20364 | bybit bid 0.60% over the bybit mark, binance ask 0.08% under its mark. raw dipped to 3,732 once at 23 s, 6,527 at close |
| 2765 | SIREN | bybit-binance | 10:57:14.664 | 56926 | fresh | gate margin basis | 5749, 5749 | 5749, -4616 | 3358 | -2100 | 20364 | bybit bid 0.72% over the bybit mark, binance ask 0.04% over. books ended where they started, closed by the poll |
| 2766 | ZIL | okx-bybit | 11:43:08.671 | 8283 | fresh | gate margin basis | 26254, 26254 | 9029, 948 | 8369 | -2100 | 59812 | okx bid 0.94% over the okx mark, bybit ask 0.07% under. raw 2.6% never converged. refused standing_basis 59,812 times on this route |
| 2767 | CVC | bybit-binance | 12:00:38.179 | 15063 | fresh | gate margin basis | 8943, 8629 | 5480, 597 | 6880 | -1789 | 60273 | bybit bid 0.51% over the bybit mark, binance ask 0.14% under. raw 0.7 to 0.9% never converged |
| 2768 | SIREN | bybit-binance | 12:23:49.854 | 193150 | fresh | gate margin basis | 6181, 5776 | 6850, -2649 | 4319 | -1698 | 20364 | bybit bid 0.80% over the bybit mark, binance ask 0.01% over. raw 0.58 to 0.62% for 193 s never converged |
| 2769 | LSK | bybit-binance | 12:43:24.602 | 100 | fresh | gate margin basis | 24720, 15035 | 10266, 717 | 4283 | 7316 | 901748 | binance ask 1.43% under its mark on the LSK crash tape (route refused 901,748 standing_basis and 1,080,977 anchor_moving). bybit bid fell 1.32% inside 100 ms |
| 2770 | LSK | bybit-binance | 13:15:19.004 | 11194 | fresh | gate margin basis | 15560, 15476 | 5146, 298 | 1093 | -2017 | 901748 | bybit bid 0.80% over the bybit mark, binance ask 0.18% over. 469 of 483 samples blind (anchor_moving). raw 1.5% never converged |
| 2771 | MTL | bybit-binance | 13:44:50.143 | 17992 | fresh | gate margin basis | 5286, 4227 | 7420, 596 | 6889 | -1045 | 13721 | binance ask 0.49% under its mark and bybit bid 0.35% over its mark. raw fell to 3,873 at 72 ms and stayed 0.4 to 0.5% for 18 s |
| 2772 | ZKC | bybit-binance | 14:04:48.678 | 368 | spread | single pair flash | 12932, 349 | 11441, blind | 5628 | 10322 | 14 | binance ask 1.30% under the binance mark (binance flash down). bybit bid held 0.04349 for 327 ms then fell 1.24% in 41 ms to meet it |
| 2773 | IOTA | binance-bybit | 14:35:22.595 | 1391 | spread | single pair flash | 5075, -316 | 5255, -137 | 3099 | 3277 | 0 | bybit ask 0.80% under the bybit mark (bybit dip). net over 5,000 for 74 ms only, then 1,600 to 4,300 for 1.3 s as bybit climbed +0.25% and binance slid -0.29% |
| 2774 | SIREN | bybit-binance | 14:41:16.65 | 54143 | fresh | gate margin basis | 6230, 5429 | 5009, 879 | 4774 | -1305 | 20364 | bybit bid 0.69% over the bybit mark, binance ask 0.08% over. raw 0.46 to 0.62% for 54 s, closed by the poll |
| 2775 | AKE | bybit-binance | 16:44:46.962 | 134 | spread | single pair flash | 23355, 690 | 27394, 4640 | 1973 | 20234 | 7 | both legs far under their marks (bybit bid -3.34%, binance ask -6.02%): a flash crash deeper on binance. net fell under 5,000 at 120 ms |
| 2776 | AKE | bybit-binance | 16:45:02.684 | 127 | spread | single pair flash | 6529, -2330 | 7734, -1135 | 1668 | 6721 | 7 | binance ask 0.69% under its mark 15.6 s after row 2775. bybit bid fell 0.66% inside 127 ms |
| 2777 | UAI | binance-bybit | 16:50:09.016 | 975 | fresh | single pair flash | 5436, 1015 | 5515, 888 | 3026 | 2319 | 2 | binance bid 0.90% over the binance mark (binance spike), bybit ask 0.24% over its mark. bybit ask rose 0.52% at 891 to 975 ms and followed |
| 2778 | MNT | bybit-krakenfutures | 16:52:45.248 | 440 | spread | kraken resting order | 5727, -2684 | 5823, -2589 | 1910 | 6334 | 0 | bybit bid 0.96% over the bybit mark (bybit spike). kraken ask one value 0.5454 for 440 ms then repriced +0.84% in one step |
| 2779 | RAVE | okx-binance | 18:37:01.764 | 1172 | spread | view lagged in a crash | 13667, -10589 | 14792, blind | 17147 | 21929 | 1 | binance ask 1.83% under the binance mark at 18:37:01, okx bid 0.28% under its mark. okx bid stepped down 4 times then fell 2.06% in one frame at 1,172 ms to 0.1754, below the binance ask. both indices agreed at 18:37:00.29 |
| 2780 | RAVE | okx-bybit | 18:37:01.649 | 1287 | spread | view lagged in a crash | 11902, -10638 | 12464, blind | 16077 | 20138 | 0 | bybit ask 1.61% under the bybit mark, okx bid 0.28% under its mark. same okx bid as row 2779, same one frame collapse at 1,287 ms |
| 2781 | SPX | okx-bybit | 18:37:05.238 | 1298 | spread | view lagged in a crash | 7343, 667 | 6482, blind | 5880 | 4546 | 1 | bybit ask 0.71% under the bybit mark, okx bid 0.04% over. okx bid fell 0.38% and bybit rose 0.28% to meet at 1,298 ms |
| 2782 | OP | okx-binance | 18:37:10.502 | 742 | spread | view lagged in a crash | 9010, -2238 | 8701, blind | 15317 | 9146 | 0 | binance ask 1.11% under the binance mark, okx bid 0.15% under. okx bid stepped down 6 times, 1.13% in 742 ms |
| 2783 | KAT | okx-binance | 18:37:10.52 | 2427 | spread | view lagged in a crash | 5509, -1000 | 7873, blind | 3597 | 4464 | 0 | binance ask 1.02% under its mark, okx bid 0.14% under. okx bid fell 0.79% over 2.4 s |
| 2784 | KAITO | okx-binance | 18:37:10.144 | 4596 | spread | view lagged in a crash | 11154, -652 | 11849, blind | 27486 | 9659 | 0 | binance ask 1.24% under its mark, okx bid 0.03% over. okx bid held 0.2912 for 2.0 s then stepped to 0.2874 by 4.6 s. binance ask changed 13 times |
| 2785 | OP | krakenfutures-binance | 18:37:10.659 | 4102 | spread | view lagged in a crash | 6843, -1206 | 5142, blind | 12888 | 5981 | 0 | binance ask 1.08% under its mark, kraken bid 0.47% under. kraken bid fell 0.96% over 4.1 s in 4 steps |
| 2786 | LAB | okx-binance | 18:37:10.491 | 3866 | spread | view lagged in a crash | 7314, 20 | 7486, blind | 8670 | 5198 | 1 | binance ask 0.76% under its mark, okx bid 0.08% over. okx bid fell 1.31% and binance ask 0.59% over 3.9 s |
| 2787 | ETH | krakenfutures-binance | 18:37:11.669 | 2307 | fresh | view lagged in a crash | 10807, 3395 | 8373, 978 | 134355 | 5324 | 1 | binance ETH ask 2378.49 sat 0.96% under the binance mark 2401.64 and 1.03% under the binance index 2403.25 while the kraken bid 2406.6 sat at the kraken index 2408.46. kraken bid then fell 0.86% in 96 steps over 2.3 s. binance ask |
| 2788 | STX | krakenfutures-binance | 18:37:09.863 | 3114 | spread | view lagged in a crash | 10087, -2454 | 8156, -8951 | 6402 | 10301 | 1 | binance ask 0.99% under its mark, kraken bid 0.08% under. kraken bid one value 0.25237 for 2.5 s then 0.2504 and a 1.4% drop at 3,114 ms |
| 2789 | MUBARAK | okx-binance | 18:37:10.51 | 4614 | spread | view lagged in a crash | 5448, -1673 | 5330, blind | 4235 | 5065 | 0 | binance ask 0.71% under its mark, okx bid 0.08% under. okx bid fell 0.94% over 4.6 s |
| 2790 | OP | krakenfutures-bybit | 18:37:14.478 | 1297 | fresh | view lagged in a crash | 14564, 1958 | 13506, 913 | 3346 | 10373 | 0 | bybit ask 2.00% under the bybit mark, kraken bid 0.57% under. kraken bid two values then fell 0.86% at 1,297 ms while bybit rose 0.39% |
| 2791 | INIT | okx-bybit | 18:37:11.818 | 3976 | spread | view lagged in a crash | 6832, -1201 | 7135, blind | 1452 | 5890 | 0 | bybit ask 0.81% under the bybit mark, okx bid at its mark. okx bid fell 0.65% over 4.0 s |
| 2792 | 1000LUNC | binance-bybit | 18:37:15.218 | 83 | feed_down | view lagged in a crash | 5135, 5135 | 5574, 5574 | 1273 | -2100 | 0 | one sample. binance bid 0.45% under its mark, bybit ask 1.10% under. binance#linear#0 closed 84 ms after the open and the row died with it |
| 2793 | SSV | krakenfutures-bybit | 18:37:13.019 | 2879 | spread | kraken resting order | 5084, -2129 | 6511, -712 | 1473 | 5092 | 1 | bybit ask 0.89% under the bybit mark, kraken bid 0.14% under. kraken bid one value for 2.9 s then dropped 0.50% in one step while bybit rose 0.22% |
| 2794 | CVX | krakenfutures-binance | 18:37:13.805 | 2845 | feed_down | kraken resting order | 5760, 4204 | 5196, 4160 | 4231 | -450 | 9 | binance ask 0.86% under the binance mark, kraken bid 0.25% under. kraken bid one value for 2.8 s. binance#linear#1 closed at 18:37:16.649 and the row died with it |
| 2795 | AERO | okx-bybit | 18:37:10.608 | 5454 | spread | view lagged in a crash | 5340, -861 | 6656, blind | 9487 | 4043 | 0 | bybit ask 0.69% under the bybit mark, okx bid 0.07% over. net under 5,000 from 391 ms and 4,000 to 5,000 for 5 s while both legs drifted down. 164 of 165 samples blind |
| 2796 | VELO | krakenfutures-bybit | 18:37:12.775 | 10171 | fresh | kraken resting order | 7843, 7096 | 7067, -331 | 1181 | -1358 | 11 | bybit ask 1.00% under the bybit mark, kraken bid 0.20% under. kraken bid one value for 10.2 s, raw 0.7% never converged. closed on the poll at 10,171 ms |
| 2797 | CRO | krakenfutures-bybit | 18:37:12.386 | 14787 | fresh | kraken resting order | 12990, 11371 | 5610, 877 | 9460 | -499 | 38 | kraken bid 0.057 one value for 14.8 s, 0.24% over the kraken mark. bybit ask 0.43% under its mark. raw 1.1 to 1.5% never converged. closed on the poll |
| 2798 | ESPORTS | binance-bybit | 18:37:40.531 | 206 | feed_down | view lagged in a crash | 26176, 24029 | 26594, 24447 | 15818 | -4 | 0 | binance bid 0.0098 one value at its mark for 206 ms while the bybit ask sat 2.69% under the bybit mark. opened 802 ms after binance#linear#1 was reseeded (ack 18:37:39.729) and closed by that socket closing at 18:37:40.737 |
| 2799 | SQD | binance-bybit | 18:37:53.749 | 103 | fresh | view lagged in a crash | 8566, 1419 | 7734, 593 | 2825 | 5057 | 24 | binance bid 1.10% over the binance mark and rising (+0.28% in 8 ms). bybit ask rose 1.00% by 103 ms and closed it on the books |
| 2800 | SIREN | bybit-binance | 18:41:24.897 | 542 | feed_down | gate margin basis | 5831, 6236 | 5017, 5829 | 4328 | -2502 | 20364 | bybit bid 0.57% over the bybit mark, binance ask 0.04% under its mark. opened 379 ms after binance#linear#1 was reseeded (ack 18:41:24.518) and closed by that socket closing at 18:41:25.439 |
| 2801 | SIREN | bybit-binance | 18:43:29.691 | 13551 | fresh | gate margin basis | 6657, 7475 | 5430, -1448 | 7490 | -2912 | 20364 | bybit bid 0.81% over the bybit mark, binance ask 0.16% over. 98 of 107 samples blind. raw 0.54 to 0.75% never converged |
| 2802 | ASTER | okx-binance | 18:45:44.144 | 237 | spread | view lagged in a crash | 6466, -701 | 7252, 80 | 51430 | 5127 | 0 | binance ask 1.19% under the binance mark, okx bid 0.37% under. okx bid fell 0.62% at 237 ms. last crossing sample under 200 ms |
| 2803 | ASTER | krakenfutures-binance | 18:45:43.864 | 404 | fresh | view lagged in a crash | 7512, 1089 | 7248, 887 | 37851 | 4383 | 1 | binance ask 1.20% under the binance mark, kraken bid 0.38% under. kraken bid fell 0.52% in 15 steps and binance rose 0.12%. net 2,136 at 352 ms |
| 2804 | FOGO | okx-binance | 18:45:42.882 | 1583 | spread | view lagged in a crash | 9717, 520 | 11383, 2187 | 5587 | 7032 | 0 | binance ask 1.75% under the binance mark, okx bid 0.53% under. okx bid fell 1.74% and binance ask 0.84% over 1.6 s |
| 2805 | SAND | krakenfutures-bybit | 18:45:44.103 | 525 | spread | view lagged in a crash | 6218, -1956 | 7032, -1172 | 1490 | 6038 | 0 | bybit ask 1.58% under the bybit mark, kraken bid 0.79% under. kraken bid fell 0.63% at 525 ms |
| 2806 | LINEA | okx-bybit | 18:45:44.512 | 254 | spread | view lagged in a crash | 8862, 189 | 10907, blind | 6435 | 6500 | 0 | bybit ask 2.10% under the bybit mark, okx bid 0.93% under. okx bid fell 0.82% at 254 ms |
| 2807 | C | bybit-binance | 18:45:44.209 | 1132 | spread | view lagged in a crash | 18680, 797 | 15171, blind | 1821 | 15592 | 0 | binance ask 2.36% under the binance mark, bybit bid 0.78% under. bybit bid fell 0.99% and binance ask rose 0.78% to meet at 1,132 ms |
| 2808 | MARSCOIN | bybit-binance | 18:45:44.148 | 1432 | spread | view lagged in a crash | 11446, 441 | 11231, blind | 1540 | 8776 | 0 | binance ask 1.68% under the binance mark, bybit bid 0.47% under. bybit bid fell 1.12% in 5 steps over 1.4 s. 7 same millisecond sample clumps |
| 2809 | HEMI | binance-bybit | 18:46:03.833 | 1359 | spread | view lagged in a crash | 5590, -3151 | 5590, -3151 | 1499 | 6606 | 0 | bybit ask 0.80% under the bybit mark, binance bid 0.14% under. net under 5,000 from 80 ms as bybit climbed, binance bid drifted -0.15% in 10 steps then fell 0.55% in one frame at 1,359 ms. binance#linear#0 closed 469 ms later |
| 2810 | POWR | binance-bybit | 18:48:31.035 | 318 | spread | view lagged in a crash | 9987, -5390 | 12934, -2488 | 6732 | 13150 | 0 | bybit ask 1.69% under the bybit mark, binance bid 0.32% under its mark and 1.14% under the binance index. binance bid 0.0604 one value for 318 ms then swept 1.36% in one frame to 0.05958, below the bybit ask |
| 2811 | IOST | binance-bybit | 18:49:04.931 | 1742 | spread | view lagged in a crash | 8313, -4717 | 9669, -3379 | 2680 | 10810 | 0 | bybit ask 1.17% under the bybit mark at 18:49:04.93, binance bid 0.11% under its mark. binance bid drifted 0.0007431 to 0.0007414 in 15 steps for 1.6 s then fell 1.16% at 1,742 ms. bybit wick bottom 0.000731 at 18:49:05.09. binanc |
| 2812 | IOST | bybit-binance | 18:49:06.811 | 261 | fresh | view lagged in a crash | 8425, 1811 | 7071, 466 | 1673 | 4511 | 0 | reverse route 138 ms after row 2813 closed: binance ask 0.0007275 sat 2.20% under the binance mark, the deepest print of the wick, 1.7 s after bybit bottomed. binance ask then rose 0.80% in 261 ms |
| 2813 | IOST | binance-okx | 18:49:05.279 | 1394 | spread | view lagged in a crash | 15250, -1136 | 15250, -1136 | 6084 | 14168 | 0 | okx ask 1.65% under the okx mark at 18:49:05.28 (okx and bybit dipped together), binance bid 0.05% under its mark. binance fell 1.44% at 1,394 ms, 1.34 s before the server closed binance#linear#0 |
| 2814 | TRIA | okx-bybit | 18:49:25.784 | 237 | fresh | view lagged in a crash | 7184, 1392 | 6577, 789 | 1278 | 3645 | 2 | bybit ask 1.21% under the bybit mark, okx bid 0.45% under. 5 samples, okx bid fell 0.67% at 237 ms where raw still read 1,392 and fresh 789. no sample between 4 and 237 ms |
| 2815 | SIREN | bybit-binance | 18:52:27.963 | 56454 | fresh | gate margin basis | 6278, 6254 | 6278, -3464 | 4021 | -2076 | 20364 | bybit bid 0.82% over the bybit mark, binance ask 0.08% over its mark. raw 0.42 to 0.63% for 56 s, 26 anchor changes, never converged |
| 2816 | SIREN | bybit-binance | 19:19:49.782 | 41474 | fresh | gate margin basis | 5331, 6140 | 7343, -1449 | 4010 | -2903 | 20364 | bybit bid 0.88% over the bybit mark, binance ask 0.04% over. raw 0.49 to 0.61% for 41 s never converged |
| 2817 | SIREN | bybit-binance | 19:22:32.331 | 48780 | fresh | gate margin basis | 5743, 5336 | 6141, -2093 | 3705 | -1695 | 20364 | bybit bid 0.80% over the bybit mark, binance ask 0.08% over. raw 0.45 to 0.57% for 49 s never converged |
| 2818 | ZIL | okx-bybit | 19:41:12.297 | 11516 | fresh | gate margin basis | 12527, 12532 | 5356, 733 | 8969 | -2105 | 59812 | okx bid 0.35% over the okx mark and bybit ask 0.29% under its mark. raw 1.2% never converged. route refused standing_basis 59,812 times |
| 2819 | AKE | binance-bybit | 20:23:56.223 | 9016 | fresh | converged dislocation | 6648, 1412 | 5422, 53 | 1502 | 3114 | 49 | binance bid 0.40% over the binance mark and bybit ask 0.25% under the bybit mark. net 6,648 fell to 5,300 by 3.9 s and 1,600 by 8.5 s as binance slid -0.27% and bybit rose +0.25%. closed on the poll at 9,016 ms with raw 1,412 |
| 2820 | SIREN | bybit-binance | 22:27:16.7 | 72837 | fresh | gate margin basis | 9082, 8275 | 9082, -2257 | 9721 | -1301 | 20364 | bybit bid 1.06% over the bybit mark, binance ask 0.04% over. raw 0.79 to 0.91% for 73 s never converged |
