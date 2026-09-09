# ArbitrageOpportunity: first-run data audit

Date: 2026-09-05. Every claim below was adversarially reviewed by an
independent agent; verdicts are marked. Corrections from that review are
folded in, and the four claims that did not survive are recorded in §12
so they are not raised again.

## 0. What the sample actually is

**Not one 45-minute run.** Telemetry shows two processes:

| run | started | stopped | up | outcome |
|---|---|---|---|---|
| 1 | 20:57:58.420 | 20:58:10.137 | 11.7 s | died; every write failed, schema behind |
| 2 | 21:21:19.3 | 21:43:19.4 | 22.0 min | produced all 488 rows |

`min(createdAt)` is 21:21:17.696, so **all 488 rows were written by run 2**;
the 6 rows whose `openedAt` falls in 20:57–20:58 are run-1 episodes whose
BullMQ jobs finally succeeded after the restart. Between the two runs lies
23 minutes of downtime that leaves no trace in the table at all. Every rate
below is therefore per **22 minutes**, not 45.

488 rows, 24 pairs, 6 routes, 3 venues (binance, bybit, okx), swap markets only.

Reproduce:
```
PGPASSWORD=observatory psql -h 127.0.0.1 -p 5532 -U observatory -d observatory -c '<SQL>'
docker exec arbitrage-observatory-signoz-telemetrystore-clickhouse-0-0-1 clickhouse-client -q '<SQL>'
```

## 1. The write path is faithful — every internal invariant holds

Zero offenders over 488 rows on all of: `ticks = cardinality(sampleTsMs)`;
all four series equal length; `durationMs = closedAt - openedAt`;
`openedAt <= lastSeenAt <= closedAt`; `peakNetPpm = max(netPpmSeries)`;
`minNetPpm = min(netPpmSeries)`; `avgNetPpm = avg(netPpmSeries)`;
`netPpmAtOpen = netPpmSeries[1]`; `sampleTsMs[1] = 0`; `sampleTsMs`
monotonic and within `durationMs`; `highestBidAtOpen > lowestAskAtOpen`.

And no pair ever has both directions of a route open simultaneously
(self-join on reversed venues with overlapping `[openedAt, closedAt]`
returns 0 rows). `toOpportunityRow`, `writeOpportunities` and the per-route
bookkeeping in `activeOpportunityMap` are sound. Everything below is upstream.

## 2. 67% of the rows are fiction, and the venues themselves say so — CONFIRMED

| peakNetPpm | rows | share |
|---|---|---|
| > 100% | 225 | 46.1% |
| 10–100% | 33 | 6.8% |
| 2–10% | 71 | 14.5% |
| 1–2% | 28 | 5.7% |
| < 1% | 131 | 26.8% |

The >10% buckets are **exactly five pairs and nothing else**:
ON (76) + ANTHROPIC (61) + OPENAI (50) + BB (38) + QNT (33) = 258 = 52.87%.
Attribution is total, not partial: not one row in those clusters sits on a
legitimate same-asset route.

The decisive test is not price, it is the **venues' own index price**
(binance `indexPrice`, okx `idxPx`) — free, unauthenticated, and definitional:

| pair | binance index | okx index | ratio | mechanism |
|---|---|---|---|---|
| `BB\|USDT` | 0.00963677 | 7.708 | 800× | different underlying |
| `ON\|USDT` | 0.21150 | 74.28 | 351× | different underlying |
| `QNT\|USDT` | 64.883 | 49.79 | 1.30× | different underlying (okx listTime 2026-06-05; 100 h return corr binance/okx +0.40 vs binance/bybit +0.99) |
| `ANTHROPIC\|USDT` | 1944.88 | 196.142 | 9.92× | **same** underlying, okx quotes 1/10 the unit (corr +0.91, ratio cv 0.47% over 100 h) |
| `OPENAI\|USDT` | 1408.60 | 141.796 | 9.93× | same underlying, okx quotes 1/10 the unit (corr +0.98, cv 0.24%) |
| `ONE\|USDT` | 0.00076630 | 0.00072910 | **1.051×** | same underlying, **the two perps reference different indices** |

`ONE|USDT` (71 rows, 14.5%) was the one I had left as "a real 4.7%
dislocation, needs depth to judge". It is not a dislocation. Each perp sits
on its own index (okx bid 0.0007315 vs its idx 0.0007291; binance mark
0.00076520 vs its idx 0.00076630) — there is nothing to converge to.

**53% + 14.5% = 67% of rows are removed by one boot-time index cross-check**,
with no asset-identity ontology required.

### 2b. Why this is not a rounding or scaling bug

The question comes up because 800x looks like a misplaced decimal. It is not,
and four independent things say so.

1. **A decimal error can only produce a power of ten.** The ratios are 800x,
   351x and 1.30x. Only ANTHROPIC/OPENAI (~9.9x) is near one, and that pair
   really is a denomination difference.
2. **The stored number reconstructs exactly.** Row 144 holds
   `highestBidAtOpen = 7.688154` (fee-adjusted). okx `takerPpm` 500 gives
   `bidMul = 0.9995`, so the raw quote was `7.688154 / 0.9995 = 7.69200`.
   OKX's own API reports `OKX_LINEAR_PERPETUAL BB/USDT` at 7.751 today.
   Nothing in the pipeline scaled anything.
3. **The venues configured these as different-magnitude assets.** Each chose a
   tick size about 1/1000th of its own price:

   | instrument | venue tickSz | venue price | ticks per price |
   |---|---|---|---|
   | binance `BBUSDT` | 0.00001 | 0.00964 | 964 |
   | okx `BB-USDT-SWAP` | 0.001 | 7.708 | 7708 |
   | binance `ONUSDT` | 0.0001 | 0.21150 | 2115 |
   | okx `ON-USDT-SWAP` | 0.01 | 74.28 | 7428 |

   If these were one asset, OKX's tick would be 100x binance's entire price —
   the contract would be untradeable. The exchanges are not confused; we are.
4. **Different listings of different things.** binance `BBUSDT` onboarded
   2024-05-13 (the month BounceBit launched); okx `BB-USDT-SWAP` listed
   2026-06-01. binance `ONUSDT` 2025-10-24 vs okx `ON-USDT-SWAP` 2026-07-06.
   OKX lists **no spot market at all** for BB, ON or QNT.

And the reason nothing forces them together: OKX's index for these
perp-only listings is partly or wholly **its own perpetual price**.

```
BB-USDT   index components:  Hyperliquid_Oracle BB/USD 7.7359 (wgt 0.508)
                             OKX_LINEAR_PERPETUAL BB/USDT 7.751 (wgt 0.492)
ON-USDT   index components:  OKX_LINEAR_PERPETUAL ON/USDT 74.21 (wgt 1.0)
QNT-USDT  index components:  OKX_LINEAR_PERPETUAL QNT/USDT 50.64 (wgt 0.5)
                             Hyperliquid_Oracle QNT/USD 50.527 (wgt 0.5)
```

`ON-USDT` is 100% self-referential. There is no spot anchor and therefore no
convergence mechanism — which is exactly why the "spread" persisted for the
whole run instead of closing.

### 2c. Three distinct mechanisms, not one

"53% is fiction" is right about the rows and wrong about the causes. Probing
each venue's own index metadata separates them cleanly.

**(i) Ticker collision — genuinely unrelated assets. BB, ON, QNT.**

| | binance / bybit | okx |
|---|---|---|
| `BB` | **BounceBit** (binance asset registry), bybit launch 2024-05-14, tick 0.000001, ~$0.0096 | listed 2026-06-01, ~$7.74, index = 85% Hyperliquid oracle `BB/USD` + 15% its own perp, **no conversion applied** |
| `ON` | binance onboard 2025-10-24, ~$0.21, **no entry in binance's asset registry at all** (perp-only listing) | listed 2026-07-06 ~$74; bybit launched its own `ONUSDT` 2026-07-21 ~$74 and agrees with okx |
| `QNT` | **Quant** (binance asset registry), bybit since 2023-06-19, ~$64.9 | listed 2026-06-05, ~$50.6, index = its own perp + Hyperliquid oracle `QNT/USD`, no conversion |

Three letters, two assets. 800x is not a scaling error, it is the ratio of two
unrelated tokens' prices — no more meaningful than BTC over DOGE. Note also
that okx's index for all three excludes binance and bybit entirely, so there
is no linkage that could ever pull them together.

**(ii) Unit mismatch — same asset, different contract size. ANTHROPIC, OPENAI.**

OKX publishes the conversion factor itself. `GET /api/v5/market/index-components`
returns `symPx` (the venue's raw quote) **and `cnvPx` (the same quote converted
into OKX's unit)**:

```
ANTHROPIC-USDT   last=196.554
   OKX_LINEAR_PERPETUAL      symPx 197.57    cnvPx 197.570    x1
   Binance_LINEAR_PERPETUAL  symPx 1951.36   cnvPx 195.136    x0.1
   Gate_LINEAR_PERPETUAL     symPx 1969.59   cnvPx 196.959    x0.1

OPENAI-USDT      last=141.421
   Binance_LINEAR_PERPETUAL  symPx 1404.83   cnvPx 140.483    x0.1
   OKX_LINEAR_PERPETUAL      symPx 143.54    cnvPx 143.540    x1
   Gate_LINEAR_PERPETUAL     symPx 1404.86   cnvPx 140.486    x0.1
```

OKX includes Binance's and Gate's contracts in its own index and divides them
by ten. That is machine-readable proof of same-underlying-different-unit, and
it is free and unauthenticated.

**This is the important one, because these rows are not garbage — they are the
best signal in the dataset, destroyed by a missing multiplier.** After
normalising:

| pair | okx | binance (converted) | real basis | after 2x500 ppm taker |
|---|---|---|---|---|
| `OPENAI` | 143.54 | 140.483 | **+2.18%** | ~20 800 ppm |
| `ANTHROPIC` | 197.57 | 195.136 | **+1.25%** | ~11 500 ppm |

A persistent 1-2% cross-venue basis on a pre-IPO synthetic, held open by
different settlement terms rather than by latency, is exactly the phenomenon
an observatory exists to record. The engine currently reports it as 880% and
it gets thrown away with the ticker collisions.

*How to read that block.* Every perpetual marks against an **index price** — the
reference the venue uses for funding and liquidation, computed from other
venues' tapes. `index-components` publishes the recipe. Each component carries
two prices: `symPx`, the price OKX literally read off that venue, and `cnvPx`,
that same price **restated in the units OKX's own contract uses**. OKX's own
row converts by 1 (already in its units); binance's and Gate's convert by
exactly 0.1. The conversion is not only about size — for `BB` the Hyperliquid
component is quoted in **USD** and `cnvPx` also applies the USDT/USD rate
(7.7368 -> 7.7367226).

So OKX is stating, in a free public endpoint: *one binance ANTHROPIC contract
is ten of mine.* Both track the same underlying; binance slices it into units
ten times coarser. That factor is precisely what the engine is missing.

*And the consequence is a wrong direction, not just a wrong magnitude.*
Live quotes, 2026-09-05:

```
binance  bid 1949.42  ask 1949.97          okx  bid 197.43  ask 197.52

engine today (raw):        binance-okx  +8 859 617 ppm   <- all 61 ANTHROPIC rows sit here
                           okx-binance    -898 853 ppm
after okx's own x0.1:      binance-okx      -14 038 ppm   <- a loss
                           okx-binance      +11 465 ppm   <- the real trade
```

Every one of the 61 `ANTHROPIC` and 50 `OPENAI` rows names the losing leg as
the winning one. The stored `route`, `highestBidVenue` and `lowestAskVenue`
are all inverted, so these rows are not merely inflated — they are backwards.

**(iii) Index dispersion — same asset, different reference basket. ONE, ICX.**

Both venues use multi-venue spot indices, and the spot venues genuinely
disagree:

```
okx ONE-USDT index:  OKX 0.000731 (.33)  Binance 0.000766 (.33)
                     Kucoin 0.0007 (.17)  Gate 0.0007021 (.17)   -> last 0.000733
binance ONEUSDT index: 0.00076120
okx ICX-USDT index:  Kucoin 0.01904 (.18)  OKX 0.01493 (.36)
                     Gate 0.014333 (.18)  Bybit 0.01439 (.27)    -> spot dispersion 33%
```

Harmony ONE really does trade 0.000766 on Binance spot and 0.0007 on Kucoin.
The perp spread is a faithful mirror of a fragmented, thin spot market. It is
a real price difference, but it is not capturable between two perps, and the
"opportunity" persists precisely because the underlying spot dislocation does.

### 2d. The admission gate should test agreement, not asset class

An earlier draft of this audit recommended filtering binance's
`TRADIFI_PERPETUAL` contracts out. **That was wrong.** Binance's USD-M book
carries 156 equity, 13 HK-equity, 8 KR-equity, 8 commodity, 2 CN-equity and
2 pre-IPO perpetuals alongside 567 crypto ones, and `XAUUSDT` against another
venue's gold perp is a perfectly legitimate arbitrage pair. Asset class is not
the discriminator.

The discriminator is whether the two venues' own references agree:

1. Read each venue's index for the cluster (binance `GET /fapi/v1/premiumIndex`
   -> `indexPrice`; okx `GET /api/v5/market/index-components` -> `last`).
2. Ratio within a tolerance (~1-2%): same asset, same unit. **Admit.**
3. Ratio explained by a published unit factor: same asset, unit mismatch.
   **Admit with a stored scale factor.** Do **not** pattern-match on powers of
   ten — see §2e, `SHEIN` uses 0.1275.
4. Anything else: **reject the cluster and log it.** BB at 800x, ON at 351x and
   QNT at 1.30x all fall out here, as does `ONE` at 1.051x once the tolerance
   is set — and rejecting `ONE` is correct, because §2c(iii) shows there is no
   convergence mechanism behind it.

This is one boot-time call per venue, it needs no asset ontology, and it fixes
the censoring problem in §2a at the same time.

### 2e. How common is the unit mismatch? Measured: rare, and confined to pre-IPO synthetics

Swept every OKX live USDT swap (457 instruments, 457 indices, 1158 index
components) and computed `cnvPx / symPx` for each component.

| scale factor | components |
|---|---|
| x1 | **1153** |
| x0.1 | 4 |
| x0.1275 | 1 |

The five exceptions, in full:

```
ANTHROPIC-USDT   Binance_LINEAR_PERPETUAL   x0.100000
ANTHROPIC-USDT   Gate_LINEAR_PERPETUAL      x0.100000
OPENAI-USDT      Binance_LINEAR_PERPETUAL   x0.100000
OPENAI-USDT      Gate_LINEAR_PERPETUAL      x0.100000
SHEIN-USDT       Binance_Index              x0.127518
```

Conclusions, each of which matters for the gate design:

1. **It is market-specific, not a venue convention.** OKX does not systematically
   scale Binance. Binance appears as a component 143 times as `Binance`,
   101 as `Binance_Index` and 33 as `Binance_LINEAR_PERPETUAL`; only 3 of
   those 277 carry a factor. Bybit, Gate, Kucoin, Bitget, Mxc, Coinbase,
   Kraken, BingX and Hyperliquid are x1 everywhere except Gate's two premarket rows.
2. **Every exception is a pre-IPO / pre-market synthetic.** ANTHROPIC, OPENAI,
   SHEIN. That is the mechanism: with no underlying token there is no canonical
   unit, so each venue invents one and they do not agree. Ordinary crypto perps
   inherit the token's own unit and never diverge.
3. **The factor is not always a power of ten.** `SHEIN` is 0.127518. A heuristic
   that only recognises x10 / x100 would miss it silently. Read the published
   number; do not infer it.
4. **The factor is stable.** Identical to six significant figures across samples
   20 s apart. It can be read at boot — but it should be re-read on catalog
   re-sync (§15 item 9), not compiled in.
5. **`cnvPx` covers only the venues OKX chose for its index, not the venue you
   are comparing against.** `SHEIN` is the worked example: the x0.1275 is
   against a `Binance_Index` product the engine never sees, while the cluster
   that actually forms is okx + bybit — and those two agree exactly
   (bybit 4.97/4.99, okx 4.97/4.98, listed 2026-08-27 and 2026-09-02).
   Neither Binance nor Bybit publishes an equivalent components endpoint, so
   for a binance-bybit cluster no venue tells you anything.

So `cnvPx` is a **precise refinement where it happens to be available**, not the
gate itself. The gate stays the generic index-agreement test of §2d; `cnvPx`
supplies the exact multiplier for the handful of clusters where OKX is one leg
and a real mismatch exists.

### 2f. How rare across the whole catalog: 0.7% of clusters, 53% of rows

The §2e sweep is OKX's own view. To measure the phenomenon venue-agnostically,
the cluster set was rebuilt exactly as `ClusterIndexBuilder` would
(`isActiveSwapMarket` -> `${base}|${quote}`, first market per venue wins) across
binance, bybit, okx and krakenfutures, then every leg priced from its venue's
own ticker and the max/min ratio taken per cluster.

| venue | live swaps | priced |
|---|---|---|
| binance | 778 | 758 |
| bybit | 837 | 815 |
| okx | 472 | 472 |
| krakenfutures | 280 | 280 |
| coinbase | 131 | **0 — ccxt returns no swap tickers, NOT covered by this sweep** |

**718 clusters have a live price on two or more venues.**

| class | clusters | share |
|---|---|---|
| agree within 3% | **711** | **99.0%** |
| dispersion 3-15% (§2c iii) | 2 | 0.3% |
| unit mismatch x10 | 2 | 0.3% |
| non-decimal mismatch | 3 | 0.4% |

The complete list of broken clusters in the entire five-venue catalog:

```
BB|USDT         x804.16   binance 0.00960  bybit 0.0095995  okx 7.71950
ON|USDT         x361.05   binance 0.20590  bybit 74.2300    okx 74.3400
ANTHROPIC|USDT  x  9.87   binance 1948.70                   okx 197.405
OPENAI|USDT     x  9.79   binance 1402.25                   okx 143.260
QNT|USDT        x  1.29   binance 65.1000  bybit 65.0500    okx 50.5200
```

Five clusters. **0.7% of the catalog — and 53% of the rows.** That asymmetry is
the whole story: a fake spread never converges, so it is permanently "open" and
gets re-detected every few seconds forever, while a real dislocation is rare and
brief. Rarity in the catalog says nothing about share of output.

Two further observations that simplify the gate:

- **Majority vote resolves three of the five for free.** BB, ON and QNT are
  three-venue clusters where two venues agree and one is the outlier
  (okx on BB and QNT, binance on ON). No external call needed — just reject the
  minority leg. Only ANTHROPIC and OPENAI are two-venue clusters, and those are
  exactly the two where OKX publishes `cnvPx`. The two mechanisms cover each
  other with no gap.
- **Kraken Futures is clean.** 280 priced swaps, present in zero broken
  clusters. Adding venues has not so far added collisions — but coinbase was
  not measured, and must be before it is trusted.

Unit mismatch specifically is the rarer half: 2 of 718 clusters (0.28%) here,
5 of 1158 index components (0.43%) in §2e. Both measurements agree that it is
confined to pre-IPO synthetics.

## 3. Duration carries 5–6 s of unobserved time on 78% of rows — CONFIRMED (with a caveat)

`closedAt - lastSeenAt`: 108 rows at 0 ms (closed on a real tick), 380 rows
at 5001–5999 ms (closed by the sweep, mean 5464 ms). Summed, **2076 s of the
5418 s of recorded duration (38.3%) falls after the last observation**.
97 rows (20%) are single-tick episodes carrying ~5.5 s of duration each.

`durationMs = closedAt - openedAt` (`db/conversion.ts:138`), and for a swept
route `closedAt` is `Date.now()` at the sweep tick (`orchestrator.ts:224`),
which is `MAX_QUOTE_AGE_MS` (5 s) plus up to one `SWEEP_INTERVAL_MS` (1 s)
after `lastSeenAt`.

Caveat from review, and it cuts both ways: the tail is **unobserved**, not
proven empty. Identical repeat frames are discarded by the dedupe at
`Engine.ts:92-99` and never recorded, so the spread may equally have
persisted. `durationMs` is not evidence in either direction — which is the
problem. **No column records why an episode ended.**

## 4. One dislocation becomes ~3 rows per minute — CONFIRMED

Over run 2's 22 minutes:

| pair | route | episodes | per minute | mean gap between episodes |
|---|---|---|---|---|
| `ON\|USDT` | bybit-binance | 72 | 3.3 | 30.8 s |
| `ONE\|USDT` | binance-okx | 71 | 3.2 | 27.5 s |
| `ANTHROPIC\|USDT` | binance-okx | 61 | 2.8 | 36.1 s |
| `ONG\|USDT` | bybit-binance | 58 | 2.6 | 3.7 s |
| `ICX\|USDT` | okx-bybit | 57 | 2.6 | 9.1 s |
| `OPENAI\|USDT` | binance-okx | 50 | 2.3 | 18.1 s |

**178 of 454 reopens happen less than 5 s after the previous close.**
Nothing links the fragments: no episode id, no reopen suppression, no
`previousId`.

## 5. Two staleness clocks for one fact — the root of §3 and §4

This is the single defect behind most of the distortion:

- `cluster.recvTs[i]` is advanced by **every** accepted frame *including a
  deduped identical repeat* (`Engine.ts:97`), and is read by discovery
  (`OpportunityManager.ts:359, :384`) and by the tick-path closer (`:220-225`).
- `opportunity.lastSeenAt` is advanced **only** when `validate` reaches
  `recordSample` (`:196`), and is read only by `sweep` (`:246`).
- `Engine.ts:92-99` deliberately advances the first and not the second, for
  any repeat arriving inside `MAX_QUOTE_AGE_MS`.

So a venue re-sending an unchanged best bid/ask looks **fresh to discovery
and stale to the sweep**. (A repeat slower than 5 s does fall through and
does call `validate`; the divergence exists only inside the window.)

Same fifteen lines, second defect: `updateOpportunity:179` calls
`recordSample` **before** `shouldOpportunityBeClosed:182`, whose first test
is leg staleness. Every stale-close therefore appends one phantom
observation built from a quote already judged too old — which can move
`peakNetPpm` and always moves `lastSeenAt`. **CONFIRMED.**

## 6. 52% of episodes never saw both legs move — the stale-leg mirage

Nothing constrains the **skew** between the two legs: a 4.9 s old bid may be
paired with a 1 ms old ask and the difference booked as a spread.

| shape | rows | share | avg ticks | avg durationMs |
|---|---|---|---|---|
| both legs moving | 187 | 38.3% | 144.0 | 17474 |
| **ask leg frozen, bid moving** | 112 | 23.0% | 71.1 | 8024 |
| **single tick** | 97 | 19.9% | 1.0 | 5476 |
| **bid leg frozen, ask moving** | 46 | 9.4% | 5.5 | 7867 |
| **both legs frozen** | 46 | 9.4% | 10.5 | 7784 |

Row 321 (`ARB|USDT`, binance-bybit, 103 ticks in 65 ms):

```
sampleTsMs {0,0,0,0,0,0,0,0,0,0,0,0}
bids       {0.169225,0.169125,0.169125,0.169125,0.169145,0.169155,0.169265,...}  <- binance, repricing 12x in 1 ms
asks       {0.1682625,0.1682625,0.1682625,0.1682625,0.1682625,0.1682625,...}     <- bybit, frozen all episode
netPpm     {5722,5128,5128,5128,5247,5307,5960,5960,5960,6257,6376,6257}
```

**And the row keeps no way to detect this afterwards.** No per-leg `recvTs`,
no per-leg quote age at open, no per-leg tick count, no venue-side event
timestamp — only `lastSeenAt`, which is whichever leg spoke last. All three
feeds stamp `recvTs: Date.now()` at parse time (`binance.ts:110`,
`bybit.ts:101`, `okx.ts:92`) and discard the venue clock that every frame
carries (binance `T`/`E`, bybit `cts`, okx `ts`). **CONFIRMED.**

## 7. No size, anywhere — CONFIRMED

`NormalizedQuote` (`ws/types.ts:27`) is `{rawMarketId, bid, ask, recvTs}`.
Every feed **receives** the top-of-book quantity in the same frame and throws
it away: binance `bookTicker` `B`/`A` (typed in `binance/types.ts:9,11`),
bybit `orderbook.1` `b[0][1]`/`a[0][1]`, okx `bbo-tbt` `bids[0][1]`.
"How deep is the dislocation" is structurally unanswerable, so no stored row
can be told apart from a one-lot mirage.

## 8. Sampling: 46% redundant, event-weighted, uncapped — CONFIRMED

16 414 of 35 722 samples (45.9%) are byte-identical to the previous sample
across all three series. `validate:39` filters by **venue**, not by leg, so
`updateOpportunity` re-reads both legs on any tick that changed either side
of either venue — a tick that moved only binance's ask still re-samples a
route that uses binance's bid. (`Engine.ts:92-99` already drops frames where
both sides are unchanged, so this is not literally "every tick".)

`avgNetPpm = netPpmSum / ticksSinceStart` is an unweighted mean over update
**events**, not over time; it is recomputable from `sampleTsMs` +
`netPpmSeries`, but must not be read as a time-average as stored.

`peakNetPpm` is the exact supremum of the engine's own netPpm path — but on
two of three venues the *venue* decimates the BBO first (bybit `orderbook.1`
and okx `bbo-tbt` are 10 ms-throttled snapshots), so the market's true peak
between ticks is genuinely unobserved.

Nothing caps series length: `recordSample:205-208` pushes unconditionally,
`conversion.ts` passes by reference, the Prisma columns are unbounded arrays,
and nothing bounds the BullMQ payload. `MAX_OPPORTUNITY_AGE_MS` (5 min) is
the only data-independent bound. Peak observed rate: 751 samples in 84 ms
(row 130, `MARSCOIN|USDT`) — and that burst spans only 74 distinct
milliseconds, which means the event loop was draining buffered frames.

## 9. Nothing measures whether the process is keeping up

Every age gate, the sweep, `durationMs` and `sampleTsMs` rest on `Date.now()`
at parse time. If the loop is far enough behind to drain 750 frames in 84 ms,
those timestamps are drain times and every staleness number is wrong by the
lag. There is no way to check: `observability/otel.ts` wires a metric
exporter, but `grep -rn "createCounter|createHistogram|createGauge|getMeter"
server/src` returns **nothing** — not one instrument, on a single Node thread
carrying ~1837 subscriptions plus the engine, the BullMQ producer and OTLP export.

## 10. Delivery is neither at-most-once nor at-least-once — CONFIRMED

- **Duplicates.** The only unique index on `ArbitrageOpportunity` is the
  primary key. `writes.ts:30` uses `createManyAndReturn` with no
  `skipDuplicates` and no deterministic `jobId`, and the queue is configured
  with `attempts: 5`. A retry or a stall re-delivery writes a second,
  byte-identical-but-for-`id` episode that nothing can detect afterwards.
- **Losses.** `Orchestrator.stop()` clears the sweep timer and stops the
  feeds, then returns. It never closes or flushes what is still open, so
  every live episode at shutdown is discarded.
- **Silent losses.** `OpportunityWorker.onFailed:51` logs at the same
  severity for a first attempt that will retry in 1 s and for a fifth that
  ends in permanent loss. The 14 `opportunity_write_failed` lines at
  20:58:07–09 (`The column 'pair of relation ArbitrageOpportunity' does not
  exist`) are exactly that: the process ran against a schema the database
  had not migrated to, and nothing at boot asserts the two agree.
- **No run identity.** No column says which process produced a row, and no
  table records when the observatory was up. The 23-minute gap in §0 is
  indistinguishable from a quiet market — so no rate in this table has a
  denominator.

## 11. Feed liveness is proven at the transport layer only — CONFIRMED

- `VenueFeed.onOpen:99` sends every subscribe frame and never correlates the
  ack. A rejected subscription silently blinds up to 200 symbols for the life
  of the process.
- `startSilenceWatch:193` compares `lastMessageAt`, which is refreshed by
  protocol ping (`:92`), pong (`:93`) and every control frame (`:113`). The
  socket is proven alive; this market's **data** never is.
- `onMessage:114` resets `c.attempt = 0` on any inbound frame including a
  subscribe ack, so an accept-then-drop loop reconnects forever at the floor
  delay (PLAUSIBLE).
- The silence-watch `setInterval` is the only feed timer not `unref`'d, and
  `clearTimers` calls `clearTimeout` on it (works in Node, but by accident).

## 12. Claims that did NOT survive review — do not raise these again

- **bybit `orderbook.1` delta handling — REFUTED.** Reading `data.b?.[0]?.[0]`
  without checking `frame.type` is safe: the feed subscribes only to
  `orderbook.1` (`bybit.ts:118`), which Bybit publishes as a **complete
  snapshot on every message** for spot, linear and inverse
  (`docs/profiles/bybit/websocket.md:371`; re-probed live 2026-09-05 —
  1555 depth-1 frames, 100% `type: snapshot`). A `frame.type === 'snapshot'`
  guard is cheap insurance against a future channel change, not a live bug.
- **bybit taker fee — the registry is RIGHT.** `docs/profiles/bybit/fees.md:77`
  (Bybit's own schedule) gives VIP 0 derivatives taker 0.0550% = 550 ppm for
  linear USDT, linear USDC and inverse alike; ccxt hardcodes 0.06%
  (`bybit.js:2219`), which is stale. The
  `CCXT reports 600 ppm on 837 of 837 markets` warning is the registry doing
  its job — but firing on 100% of markets every boot makes it noise. Downgrade
  it. binance's ccxt 500 ppm matches USDⓈ-M and COIN-M VIP 0. The flat
  per-venue rate in `VenueConnector.toMarket` is a latent limit, not a live
  defect, at these three venues.
- **`MAX_OPPORTUNITY_AGE_MS` same-tick reopen — real but narrow.** It is the
  only close reason with no matching guard in the discovery scan, and it hit
  exactly 1 row in this sample.
- **`avgNetPpm` "weighted by venue message volume"** overstates it: samples
  are per accepted change-bearing quote on the route's **own two legs**;
  invalid quotes, in-window identical repeats and ticks on unrelated venues
  contribute nothing.

## 13. Test suite cannot see any of this — CONFIRMED

- `Engine.spec.ts:26-36` `makeCluster()` allocates `bidMul`/`askMul` as
  zero-filled `Float64Array`s and never fills them, so both are `[0,0]`.
  Every effective price is 0 and **the entire opportunity path is unreachable
  from every Engine test.** Fix this first; it is two lines and it is the
  regression net for everything else.
- The dedupe at `Engine.ts:92-99` — the thing that fabricates the single-tick
  episodes — has **zero** coverage.
- `OpportunityManager.spec.ts:49` introduces its `tick` helper as
  "One tick, exactly as Engine.updateQuote delivers it". It is not: it writes
  the slot and calls `validate` unconditionally, so `:186` asserts a tick that
  production suppresses.
- **`ClusterIndexBuilder` has no spec file at all** — the module responsible
  for 67% of the bad rows.
- The only `closeVenue` test pins a method production never calls;
  `Engine.markStale`, `Engine.sweep` and `Engine.tracks` have none.
- `types.spec.ts` is a tautology on a string literal.

## 14. What is actually signal in these 488 rows

After removing cross-asset and cross-index clusters, single-tick rows,
frozen-leg mirages and re-opened fragments:

| pair | route | peak net | live ms | ticks |
|---|---|---|---|---|
| `PONS\|USDT` | okx-bybit | ~0.60% | 89 930 | 1100 |
| `SKR\|USDT` | bybit-binance | ~0.54% | 78 145 | 1178 |
| `ONG\|USDT` | bybit-binance | ~0.80% | 13 014 | 110 |
| `ICX\|USDT` | okx-bybit | ~0.74% | 7 526 | 11 |

And even these are not safe: for `ICX`, bybit's index is 0.01333 and okx's is
0.01339 — 0.45% of standing basis against a ~0.5% quoted edge. Order 10 rows
of 488 are candidates, and none is confirmable without size and leg ages.

## 15. Order of repair

| # | change | why it comes here | size |
|---|---|---|---|
| 0 | Fill `bidMul`/`askMul` in `Engine.spec.ts` `makeCluster` | every fix below lands with no regression net while the fixture makes the opportunity path unreachable | XS |
| 1 | Cluster admission gate: venue index-price cross-check at build + a `netPpm` ceiling in `validate`, plus `ClusterIndexBuilder.spec.ts` | 67% of rows are fiction, so any statistic recomputed after any other fix is still dominated by them — and the legitimate routes they mask do not exist in the population until this lands | M |
| 2 | Exactly-once episodes: `@@unique([pair, route, openedAt])`, deterministic `jobId`, `skipDuplicates`, async shutdown flush | the only defect that can silently duplicate or delete a whole episode; everything else is at least inferable from the stored row. Land it while the schema is moving | S |
| 3 | Run / exposure identity (`Run` table + FK, uptime windows) | nothing after this can be *validated*: without a persisted uptime window, downtime is indistinguishable from a quiet market and no fix can be shown to have changed anything | S |
| 4 | Unify the two staleness clocks; move the validity gate before `recordSample`; decide and record a close reason | the largest distortion of the quantities themselves — sets `durationMs`, `lastSeenAt`, the peak on 13% of rows, and the episode count, which is the denominator of nearly every per-pair statistic | S code, M judgement |
| 5 | Per-leg observation record: `venueTs`, per-leg `recvTs`/age, top-of-book sizes | 4 defines the episode, 5 defines the sample; without per-leg age and size you cannot separate a real dislocation from the 52% mirage, so adding venues first only adds unjudgeable rows | L |
| 6 | Feed liveness: subscribe-ack correlation, `lastQuoteAt` per market, backoff that survives an ack | a silent 200-market blind spot biases the population and nothing would report it. After 3, because run identity is what makes it visible | M |
| 7 | Discovery completeness: every route ≥ MIN, not only the argmax pair | increases row volume, so it lands only once rows are trustworthy; its value (comparable route counts) needs 3's denominator and 4's episode definition | M |
| 8 | `recordSample`: leg-granular guard, length cap, time-weighted accumulator | first item about cost and ergonomics rather than truth — the series are already lossless and the time-average is recomputable | S–M |
| 9 | Catalog re-sync (the market universe is frozen at `Orchestrator.start`) | bounds how long a run stays trustworthy, not whether a row is right; urgent only once runs are long | M |
| 10 | Metrics instruments (msgs/s, event-loop lag, drop counts) | §9: today there is no way to know whether `recvTs` means arrival time | S |
| 11 | One-liners: `frame.type` guard, skip the just-closed route on the age-cap tick, downgrade the bybit fee WARN, surface exhausted-retry as a distinct event | latent or cosmetic | XS each |

## 16. The architectural question underneath all of it

`ArbitrageOpportunity` is the only populated model. There is no raw quote
store, no periodic cluster snapshot, no sub-threshold record. Every "cannot
be detected after the fact" above — no close reason, no leg age, no size, no
denominator, no re-applicable fee — follows from one choice: **detect,
aggregate and threshold online, at write time.** A 1 Hz BBO snapshot over
~700 clusters is single-digit MB/minute. It would turn every finding here
from permanent data loss into a reprocessing job, and it would let
`MIN_NET_PPM = 5000` be calibrated rather than assumed. (Related: nobody has
justified 5000; and `CLOSURE_NET_PPM = 1000` sits below the cost of a single
entry leg, so every episode's tail is definitionally unprofitable. `netPpm`
charges two taker fills at entry and models neither the two fills that unwind
a delta-neutral perp position nor funding — okx `ONE` funding is currently
+2.88 bps/8h against binance's +0.5 bps, the same order as the edges being
recorded.)
