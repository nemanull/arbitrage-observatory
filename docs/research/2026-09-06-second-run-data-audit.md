# ArbitrageOpportunity: second-run data audit

Date: 2026-09-06 (UTC; the evening of 2026-09-05 PDT). Follows
[`2026-09-05-arbitrage-opportunity-data-audit.md`](./2026-09-05-arbitrage-opportunity-data-audit.md),
which this doc refers to as "the first audit". Same reproduction commands:

```
PGPASSWORD=observatory psql -h 127.0.0.1 -p 5532 -U observatory -d observatory -c '<SQL>'
docker exec arbitrage-observatory-signoz-telemetrystore-clickhouse-0-0-1 clickhouse-client -q '<SQL>'
```

## 0. What the sample is

One process, no restarts: `Starting Nest application` 05:21:19.737, `orchestrator_started`
05:21:24.447, `orchestrator_stopped` 06:23:36.218 — **62.2 minutes**, 753 clusters across 5 venues.
The temporary patch is confirmed live at 05:21:24.424:

```
Denied 3 pair(s) as ticker collisions: QNT|USDT, BB|USDT, ON|USDT
Applied 2 hardcoded price scale(s): okx/ANTHROPIC-USDT-SWAP x10, okx/OPENAI-USDT-SWAP x10
```

The table was cleared before this run: ids are contiguous 1626–2916, so ~1625 earlier rows (the
first audit's 488 plus an unpatched 04:08–04:44 process) were deleted and leave no trace.

**1291 rows, 57 pairs, 10 routes, 5 venues, 116 551 ticks.** 20.8 rows/min against 22.2/min in
the first audit — the row rate did not fall, the rows changed shape.

It was a weekend: Saturday 22:21–23:23 PDT. US equity underlyings were closed (§3).

## 1. The write path is still faithful, with one new caveat

Zero offenders on: `ticks = |sampleTsMs|`, all four series equal length,
`durationMs = closedAt − openedAt`, `openedAt ≤ lastSeenAt ≤ closedAt`, `sampleTsMs[1] = 0`,
`sampleTsMs` monotonic and ≤ `durationMs`, `highestBidAtOpen > lowestAskAtOpen`,
`netPpmAtOpen ≥ 5000`, `peakAt − openedAt = sampleTsMs[argmax]`, `peakHighestBid` /
`peakLowestAsk` = the series at that index, `avgNetPpm = avg(netPpmSeries)`, route string =
`bidVenue-askVenue`, no same-venue routes. No duplicate `(pair, route, openedAt)`, no overlapping
episodes on a route, no overlapping reversed routes.

**Caveat — scalar vs array precision.** 354 rows have `peakNetPpm ≠ max(netPpmSeries)`, 334
`minNetPpm ≠ min(...)`, 310 `netPpmAtOpen ≠ netPpmSeries[1]`. Every difference is ≤ 1 ULP
(max relative 5.4e-16): the scalar `Float` columns land with 16 significant digits
(`10367.12996219991`) and the `Float[]` elements with 17 (`10367.129962199906`). Not a data
defect — but the first audit's exact-equality invariants must be run with a tolerance from now on.

Write latency `createdAt − closedAt`: p50 6 ms, p90 14 ms, max 168 ms.

## 2. The ceiling removed the absurd rows, not the fictional ones

| peakNetPpm | first audit | this run |
|---|---|---|
| > 10% | 258 (52.9%) | **0** |
| 2–10% | 71 (14.5%) | 273 (21.1%) |
| 1–2% | 28 (5.7%) | 321 (24.9%) |
| < 1% | 131 (26.8%) | 697 (54.0%) |

`MAX_PLAUSIBLE_NET_PPM` fired **zero times** (no `implausible_net_ppm` warning in the run). The
denials and scales did the work; the ceiling is currently a no-op.

Concentration is unchanged: five pairs are 999 rows, **77.4%** (first audit: six pairs, 76%).

| pair | route | rows | avg peak | ticks | notes |
|---|---|---|---|---|---|
| `ONE\|USDT` | binance-okx | 240 | 4.84% | 2 054 | §2a — no convergence, under the ceiling |
| `ANTHROPIC\|USDT` | okx-binance | 215 | 1.02% | 21 872 | §2b — scale works, direction now right |
| `ICX\|USDT` | okx-bybit | 206 | 0.82% | 2 124 | §2a — half is reference disagreement |
| `ONG\|USDT` | bybit-binance | 176 | 0.62% | 5 973 | §2c — index-agreeing, standing basis |
| `OPENAI\|USDT` | okx-binance | 162 | 1.91% | 52 196 | §2b — 45% of all ticks |

### 2a. Reference disagreement: ONE, ICX, and the weekend equity perps

Live index cross-check at 06:30 UTC, seven minutes after the run stopped (binance
`premiumIndex.indexPrice`, bybit `tickers.indexPrice`, okx `index-tickers.idxPx`; BBO from each
venue's own ticker):

| pair | bid venue idx | ask venue idx | idx ratio | quoted bid/ask | verdict |
|---|---|---|---|---|---|
| `ONE` | binance 0.0007543 | okx 0.0007163 | **1.0531** | 1.0492 | the entire quoted spread is index disagreement |
| `ICX` | okx 0.014910 | bybit 0.014860 | 1.0034 | 1.0061 | 56% of the quoted gap is index disagreement |
| `ISRG` | bybit 370.50 | okx 368.99 | 1.0041 | 1.0062 | 66% — and the underlying is closed |
| `TSLL` | bybit 9.340 | okx 9.309 | 1.0033 | 1.0026 | closed underlying |

`ONE` is the first audit's §2c(iii) case, unchanged: the two perps mark to different baskets
5.3% apart, so a 4.9% quoted spread is not an opportunity and never closes. It is now the single
largest row source, and the 10% ceiling cannot touch it. The first audit's gate (§2d, tolerance
1–2%) would reject it; the temporary patch does not name it.

`ICX` and the equity perps are the subtler shape: the references disagree by less than any sane
tolerance, yet that disagreement is most of the recorded "edge". Nothing on the row can show
this, because the row does not carry either leg's index price.

**Weekend equity perps are a new class.** `ISRG` (45 rows), `TSLL` (4), `RIOT` (2), `GPRO` (1)
are tokenized US equities on bybit/okx while NYSE is closed. Each venue marks to its own last or
oracle, nothing re-anchors them until Monday, and the books barely tick: `ISRG` has **111 ticks
across 45 episodes, 27 of them single-tick** — a quote arrives, opens an episode, the 5 s sweep
closes it, the next quote reopens it. Recall the first audit's §2d: asset class is *not* the
discriminator — `XAUUSDT` against a gold perp is legitimate — but market hours of the underlying
plainly are a factor, and the gate should know them.

### 2b. The unit scale works — ANTHROPIC and OPENAI are now right-signed and right-sized

The first audit predicted okx-binance at ~+11 500 ppm (ANTHROPIC) and ~+20 800 ppm (OPENAI) after
the ×10. This run recorded okx-binance at avg peak 10 200 and 19 138 ppm; not one row on the old
inverted binance-okx route. Confirmed.

What they are: okx's `OPENAI` perp trades **+1.25% above its own index** (143.32 vs 141.55) while
binance's sits on its index (1405.98 vs 1406.99). That is a funding-carry premium, not a latency
dislocation, and it persisted the whole hour — so it fragmented into 377 episodes (3.5/min and
2.6/min) carrying **74 068 of 116 551 ticks (63.5%)**. Even after the ×10 the two venues' indices
still differ by 0.6–0.7%, because okx's basket includes its own perp.

Provenance gap: the stored `highestBidAtOpen` for these rows is the scaled, fee-adjusted okx quote
(e.g. 1979.1 = 197.9 × 10 × 0.9995). The ×10 is not recorded on the row, unlike `takerPpm`. The
backlog doc already calls for storing it.

### 2c. Index-agreeing pairs — the legitimate class, and it is a standing basis too

| pair | idx ratio | quoted | live per-leg basis |
|---|---|---|---|
| `ONG` bybit-binance | 1.0033 | 1.0095 | binance perp −0.8% vs its own index, bybit −0.2% |
| `T` bybit-binance | 0.9998 | 1.0042 | both below index, bybit −0.8%, binance −1.3% |
| `PONS` okx-bybit | **1.0000** | 1.0028 | okx +0.25%, bybit −0.08% |
| `SKR` bybit-binance | 0.9994 | 1.0044 | |
| `COTI` bybit-binance | 0.9993 | 1.0005 | brief during the run, gone now |

`ONG` (176 rows) has now persisted across both runs at ~0.6%: a perp-premium difference between
venues, held open by funding, not a fleeting mismatch. The remaining ~100 rows are sub-second
bursts on volatile names (`DASH` 18 rows on five routes at 0.0 s, `ZEC` 16 rows / 5 607 ticks,
`MET`, `BOME`, `NAORIS` at 3.3% peak) — plausible, unjudgeable without size.

## 3. The two new venues are quote-isolated

```
market filter kept 276 of 280 swap markets          (krakenfutures)
krakenfutures: streaming 24 of 276 markets
coinbase:      streaming 56 of 131 markets
```

Single-venue clusters not created: **252 `USD`**, 96 `USDC`, 189 `USDT`. Kraken Futures quotes in
USD, and only 24 of its 276 perps find a `XXX|USD` partner (bybit inverse `XXXUSD`, binance COIN-M).
Coinbase INTX quotes in USDC and pairs only with binance's USDC-margined perps and bybit's
`XXXPERP`. The cluster key `${base}|${quote}` keeps USD, USDC and USDT apart.

Output: krakenfutures **1 row** (`APT|USD`, `PF_APTUSD` vs bybit inverse `APTUSD`, 2 ticks, 7 ms —
live both venues sit at ~0.615, so the cluster is real, but bybit's inverse book is 0.9% wide);
coinbase **13 rows** on 5 USDC pairs (`BOME` 6, `ARB` 2, `ENA` 2, `ZEC` 2, `POL` 1), peak 2.0% on
`BOME|USDC` against thin books. 1.1% of rows for 407 subscribed markets.

Two things that fall out of this:

- `APT|USD` clusters a USD-margined linear contract with an APT-settled inverse one. The cluster
  key ignores contract type. Price-comparable, fee- and PnL-incomparable.
- Whether USD/USDC/USDT should be one quote is a decision, not a bug: the stablecoin gap is
  normally < 0.1%, far under `MIN_NET_PPM`, but it is exactly the thing that blows out in a depeg.

The one `ERROR` in eight hours was in the earlier process: `coinbase#swap#0: no traffic for 18151ms,
terminating` at 04:42:06 — the coinbase feed went silent for 18 s and reconnected. Relevant given
the 2026-09-09 cutover. Also at boot: `CCXT reports 60000 ppm on 131 of 131 markets, and the
registry says 400` — the registry wins, as for bybit.

## 4. Structural findings, unchanged from the first audit — the numbers for this run

- **Sweep closes 899 rows (69.6%)**, tick closes 391, one at exactly 6 000 ms. Mean sweep gap
  5 486 ms of unobserved time per row.
- **Leg shapes:** both moving 578 (44.8%); single tick 203 (15.7%); ask frozen 198 (15.3%); bid
  frozen 192 (14.9%); both frozen 120 (9.3%). **55% of rows never saw both legs move.**
- **Reopens:** 1 208; 256 within 1 s, 378 in 1–5 s — **634 (52%) inside the sweep window.**
- **Negative `minNetPpm` on 97 rows**, always the last sample (recorded before the close test),
  worst −48 656 ppm (a `ONE` leg flipping).
- **Age cap hit once:** `PONS` id 2674, 300 221 ms, 3 313 ticks; no same-tick reopen.
- **Bursts:** `HEMI` 13 ticks in 1 ms, `MARSCOIN` 189 in 17 ms, `OPENAI` 2 241 ticks in 5.1 s
  (436/s) — binance `bookTicker` rate re-sampling the route on every binance tick.
- **Catalog tables** `Venue`, `Market`, `Pair`: 0 rows. Nothing in `server/src` writes them. The
  rows carry fees by value so they stand alone, but there is still no run identity.

## 5. Delivery: 3 episodes lost, all at shutdown

`Opportunity found` lines: 1 296, of which 2 are OTLP export duplicates (identical body and
timestamp, 05:52:06.159 and 05:52:07.443) — **1 294 distinct**. Written: 1 291. The three missing
were open when `stop()` ran: `ONG` found 06:23:13.609, `ONE` 06:23:15.406, `ISRG` 06:23:27.217;
last close 06:23:29.761, stop 06:23:36.218. First audit §10 (no shutdown flush), confirmed on
data. Zero write failures, zero duplicates.

## 6. Order of repair, updated

| # | change | why |
|---|---|---|
| 1 | Add `ONE\|USDT` to `DENIED_PAIRS` now | 18.6% of rows, the first audit already classified it, the gate that would catch it is not built |
| 2 | Record each leg's index price on the sample (or at least at open and peak) | `ICX`, `ISRG`, `ANTHROPIC`, `ONG` are all "part edge, part reference gap" and the row cannot say which; this is the cheapest column that turns §2a from a live probe into a query |
| 3 | Shutdown flush (first audit §15 item 2) | 3 lost, measured |
| 4 | Gate with underlying market hours for equity perps | new class, §2a |
| 5 | Decide USD/USDC/USDT quote handling | otherwise kraken and coinbase stay at 1% of output |
| 6 | Tolerance in the invariant checks | §1 caveat |

The first audit's items 4 (two staleness clocks, close reason) and 5 (per-leg age and size) remain
the largest distortions: 55% frozen-leg rows, 52% reopens inside the sweep window.
