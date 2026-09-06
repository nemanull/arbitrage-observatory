# ArbitrageOpportunity: second-run data audit

Date: 2026-09-06 in UTC, which is the evening of 2026-09-05 in PDT.
This follows [`2026-09-05-arbitrage-opportunity-data-audit.md`](./2026-09-05-arbitrage-opportunity-data-audit.md), called "the first audit" below.
Reproduction commands are the same:

```
PGPASSWORD=observatory psql -h 127.0.0.1 -p 5532 -U observatory -d observatory -c '<SQL>'
docker exec arbitrage-observatory-signoz-telemetrystore-clickhouse-0-0-1 clickhouse-client -q '<SQL>'
```

## 0. What the sample is

One process and no restarts.
`Starting Nest application` at 05:21:19.737, `orchestrator_started` at 05:21:24.447, `orchestrator_stopped` at 06:23:36.218.
That is 62.2 minutes, with 753 clusters across 5 venues.
The temporary patch is confirmed live at 05:21:24.424:

```
Denied 3 pair(s) as ticker collisions: QNT|USDT, BB|USDT, ON|USDT
Applied 2 hardcoded price scale(s): okx/ANTHROPIC-USDT-SWAP x10, okx/OPENAI-USDT-SWAP x10
```

The table was cleared before this run.
Ids are contiguous from 1626 to 2916, so about 1625 earlier rows were deleted and leave no trace.
Those were the first audit's 488 rows plus an unpatched process that ran from 04:08 to 04:44.

1291 rows, 57 pairs, 10 routes, 5 venues, 116 551 ticks.
That is 20.8 rows per minute against 22.2 per minute in the first audit.
The row rate did not fall, the rows changed shape.

It was a weekend, Saturday 22:21 to 23:23 PDT.
US equity underlyings were closed, which matters in section 2a.

## 1. The write path is still faithful, with one new caveat

Zero offenders on every invariant the first audit listed.
`ticks = |sampleTsMs|`, all four series equal length, `durationMs = closedAt - openedAt`, `openedAt <= lastSeenAt <= closedAt`, `sampleTsMs[1] = 0`, `sampleTsMs` monotonic and bounded by `durationMs`, `highestBidAtOpen > lowestAskAtOpen`, `netPpmAtOpen >= 5000`.
Three checks the first audit did not run also hold: `peakAt - openedAt = sampleTsMs[argmax]`, `peakHighestBid` and `peakLowestAsk` equal the series at that index, and the route string equals `bidVenue-askVenue`.
No duplicate `(pair, route, openedAt)`, no overlapping episodes on a route, no overlapping reversed routes.

The caveat is scalar versus array precision.
354 rows have `peakNetPpm` different from `max(netPpmSeries)`, 334 have `minNetPpm` different from the series minimum, and 310 have `netPpmAtOpen` different from `netPpmSeries[1]`.
Every difference is at most 1 ULP, with a maximum relative difference of 5.4e-16.
The scalar `Float` columns land with 16 significant digits, for example `10367.12996219991`, and the `Float[]` elements with 17, for example `10367.129962199906`.
This is not a data defect.
The first audit's exact-equality invariants must be run with a tolerance from now on.

Write latency, measured as `createdAt - closedAt`: p50 6 ms, p90 14 ms, max 168 ms.

## 2. The ceiling removed the absurd rows, not the fictional ones

| peakNetPpm | first audit | this run |
|---|---|---|
| > 10% | 258 (52.9%) | **0** |
| 2 to 10% | 71 (14.5%) | 273 (21.1%) |
| 1 to 2% | 28 (5.7%) | 321 (24.9%) |
| < 1% | 131 (26.8%) | 697 (54.0%) |

`MAX_PLAUSIBLE_NET_PPM` fired zero times.
There is no `implausible_net_ppm` warning anywhere in the run.
The denials and scales did the work, and the ceiling is currently a no-op.

Concentration is unchanged.
Five pairs are 999 rows, or 77.4%, where the first audit had six pairs at 76%.

| pair | route | rows | avg peak | ticks | notes |
|---|---|---|---|---|---|
| `ONE\|USDT` | binance-okx | 240 | 4.84% | 2 054 | section 2a, no convergence, under the ceiling |
| `ANTHROPIC\|USDT` | okx-binance | 215 | 1.02% | 21 872 | section 2b, scale works, direction now right |
| `ICX\|USDT` | okx-bybit | 206 | 0.82% | 2 124 | section 2a, half is reference disagreement |
| `ONG\|USDT` | bybit-binance | 176 | 0.62% | 5 973 | section 2c, index-agreeing, standing basis |
| `OPENAI\|USDT` | okx-binance | 162 | 1.91% | 52 196 | section 2b, 45% of all ticks |

### 2a. Reference disagreement: ONE, ICX, and the weekend equity perps

Live index cross-check at 06:30 UTC, seven minutes after the run stopped.
Sources: binance `premiumIndex.indexPrice`, bybit `tickers.indexPrice`, okx `index-tickers.idxPx`, and the BBO from each venue's own ticker.

| pair | bid venue idx | ask venue idx | idx ratio | quoted bid/ask | verdict |
|---|---|---|---|---|---|
| `ONE` | binance 0.0007543 | okx 0.0007163 | **1.0531** | 1.0492 | the entire quoted spread is index disagreement |
| `ICX` | okx 0.014910 | bybit 0.014860 | 1.0034 | 1.0061 | 56% of the quoted gap is index disagreement |
| `ISRG` | bybit 370.50 | okx 368.99 | 1.0041 | 1.0062 | 66%, and the underlying is closed |
| `TSLL` | bybit 9.340 | okx 9.309 | 1.0033 | 1.0026 | closed underlying |

`ONE` is the first audit's section 2c(iii) case, unchanged.
The two perps mark to different baskets 5.3% apart, so a 4.9% quoted spread is not an opportunity and never closes.
Measured against each venue's own anchor, the okx leg is the expensive one by 0.35%, so the trade has negative edge before fees.
It is now the single largest row source, and the 10% ceiling cannot touch it.
The first audit's gate in section 2d, with a tolerance of 1 to 2%, would reject it.
The temporary patch did not name it until 2026-09-06.

`ICX` and the equity perps are the subtler shape.
The references disagree by less than any sane tolerance, yet that disagreement is most of the recorded edge.
Nothing on the row can show this, because the row does not carry either leg's index price.

Weekend equity perps are a new class.
`ISRG` with 45 rows, `TSLL` with 4, `RIOT` with 2 and `GPRO` with 1 are tokenized US equities on bybit and okx while NYSE is closed.
Each venue marks to its own last price or oracle, nothing re-anchors them until Monday, and the books barely tick.
`ISRG` has 111 ticks across 45 episodes, 27 of them single-tick.
A quote arrives, opens an episode, the 5 s sweep closes it, and the next quote reopens it.
The first audit's section 2d still stands: asset class is not the discriminator, since `XAUUSDT` against a gold perp is legitimate.
Market hours of the underlying plainly are a factor, and the gate should know them.

### 2b. The unit scale works, so ANTHROPIC and OPENAI are now right-signed and right-sized

The first audit predicted okx-binance at about +11 500 ppm for ANTHROPIC and about +20 800 ppm for OPENAI after the x10.
This run recorded okx-binance at average peaks of 10 200 and 19 138 ppm.
Not one row sits on the old inverted binance-okx route.
Confirmed.

What they are: okx's `OPENAI` perp trades 1.25% above its own index, at 143.32 against 141.55, while binance's sits on its index, at 1405.98 against 1406.99.
That is a funding-carry premium, not a latency dislocation.
It persisted the whole hour, so it fragmented into 377 episodes at 3.5 and 2.6 per minute.
Those episodes carry 74 068 of the 116 551 ticks, or 63.5%.
Even after the x10 the two venues' indices still differ by 0.6 to 0.7%, because okx's basket includes its own perp.

There is a provenance gap.
The stored `highestBidAtOpen` for these rows is the scaled, fee-adjusted okx quote, for example 1979.1 from 197.9 x 10 x 0.9995.
The x10 is not recorded on the row, unlike `takerPpm`.
The backlog doc already calls for storing it.

### 2c. Index-agreeing pairs, the legitimate class, and it is a standing basis too

| pair | idx ratio | quoted | live per-leg basis |
|---|---|---|---|
| `ONG` bybit-binance | 1.0033 | 1.0095 | binance perp 0.8% below its own index, bybit 0.2% below |
| `T` bybit-binance | 0.9998 | 1.0042 | both below index, bybit by 0.8%, binance by 1.3% |
| `PONS` okx-bybit | **1.0000** | 1.0028 | okx 0.25% above, bybit 0.08% below |
| `SKR` bybit-binance | 0.9994 | 1.0044 | |
| `COTI` bybit-binance | 0.9993 | 1.0005 | brief during the run, gone now |

`ONG` with 176 rows has now persisted across both runs at about 0.6%.
That is a perp-premium difference between venues, held open by funding, not a fleeting mismatch.
The remaining rows, about 100, are sub-second bursts on volatile names.
`DASH` has 18 rows on five routes at 0.0 s, `ZEC` has 16 rows and 5 607 ticks, and `MET`, `BOME` and `NAORIS` at a 3.3% peak are similar.
Plausible, and unjudgeable without size.

## 3. The two new venues are quote-isolated

```
market filter kept 276 of 280 swap markets          (krakenfutures)
krakenfutures: streaming 24 of 276 markets
coinbase:      streaming 56 of 131 markets
```

Single-venue clusters not created: 252 quoted in `USD`, 96 in `USDC`, 189 in `USDT`.
Kraken Futures quotes in USD, and only 24 of its 276 perps find a `XXX|USD` partner, which means a bybit inverse `XXXUSD` or a binance COIN-M contract.
Coinbase INTX quotes in USDC and pairs only with binance's USDC-margined perps and bybit's `XXXPERP`.
The cluster key `${base}|${quote}` keeps USD, USDC and USDT apart.

Output: krakenfutures produced 1 row and coinbase 13.
The kraken row is `APT|USD`, `PF_APTUSD` against bybit inverse `APTUSD`, 2 ticks in 7 ms.
Live, both venues sit at about 0.615, so the cluster is real, but bybit's inverse book is 0.9% wide.
The coinbase rows are on 5 USDC pairs, `BOME` 6, `ARB` 2, `ENA` 2, `ZEC` 2, `POL` 1, with a 2.0% peak on `BOME|USDC` against thin books.
That is 1.1% of rows for 407 subscribed markets.

Two things fall out of this.

`APT|USD` clusters a USD-margined linear contract with an APT-settled inverse one.
The cluster key ignores contract type.
They are price-comparable but not fee- or PnL-comparable.

Whether USD, USDC and USDT should be one quote is a decision, not a bug.
The stablecoin gap is normally under 0.1%, far under `MIN_NET_PPM`, but it is exactly the thing that blows out in a depeg.

The one `ERROR` in eight hours was in the earlier process: `coinbase#swap#0: no traffic for 18151ms, terminating` at 04:42:06.
The coinbase feed went silent for 18 s and reconnected.
That is relevant given the 2026-09-09 cutover.
Also at boot: `CCXT reports 60000 ppm on 131 of 131 markets, and the registry says 400`.
The registry wins, as it does for bybit.

## 4. Structural findings, unchanged from the first audit, with this run's numbers

- Sweep closes 899 rows, or 69.6%. Tick closes 391. One row closed at exactly 6 000 ms. The mean sweep gap is 5 486 ms of unobserved time per row.
- Leg shapes: both moving 578 (44.8%), single tick 203 (15.7%), ask frozen 198 (15.3%), bid frozen 192 (14.9%), both frozen 120 (9.3%). 55% of rows never saw both legs move.
- Reopens: 1 208 in total, 256 within 1 s and 378 in 1 to 5 s. 634, or 52%, fall inside the sweep window.
- Negative `minNetPpm` on 97 rows, always the last sample, because the sample is recorded before the close test. The worst is -48 656 ppm, from a `ONE` leg flipping.
- Age cap hit once: `PONS` id 2674, 300 221 ms, 3 313 ticks, no same-tick reopen.
- Bursts: `HEMI` 13 ticks in 1 ms, `MARSCOIN` 189 in 17 ms, `OPENAI` 2 241 ticks in 5.1 s, which is 436 per second from binance `bookTicker` re-sampling the route on every binance tick.
- Catalog tables `Venue`, `Market` and `Pair` hold 0 rows. Nothing in `server/src` writes them. The rows carry fees by value so they stand alone, but there is still no run identity.

## 5. Delivery: 3 episodes lost, all at shutdown

`Opportunity found` lines: 1 296.
Two of them are OTLP export duplicates with identical body and timestamp, at 05:52:06.159 and 05:52:07.443, so 1 294 are distinct.
Written: 1 291.
The three missing were open when `stop()` ran: `ONG` found at 06:23:13.609, `ONE` at 06:23:15.406, `ISRG` at 06:23:27.217.
The last close was at 06:23:29.761 and the stop at 06:23:36.218.
This confirms the first audit's section 10 on data: there is no shutdown flush.
Zero write failures and zero duplicates.

## 6. How the persistent pairs end

Of the 617 episodes on `ANTHROPIC`, `OPENAI` and `ONE`, none ended because the spread fell below the 0.1% closure threshold.

| pair | episodes | closed by sweep | closed by stale leg | closed below 0.1% | avg open s | samples per open s |
|---|---|---|---|---|---|---|
| `ANTHROPIC` | 215 | 139 | 76 | 0 | 9.2 | 11 |
| `OPENAI` | 162 | 89 | 73 | 0 | 8.4 | 39 |
| `ONE` | 240 | 194 | 46 | 0 | 9.8 | 1 |

Every close is a silence close.
All five feeds are change-driven, so 5 s without a frame on a quiet book means "unchanged", not "unknown".
The engine closes an opportunity because it is stable, then reopens it at the next change.
111 of 214 `ANTHROPIC` reopens and 150 of 239 `ONE` reopens happen within 5 s of the previous close.

## 7. Order of repair, updated

| # | change | why |
|---|---|---|
| 1 | Add `ONE\|USDT` to `DENIED_PAIRS` | Done 2026-09-06. 18.6% of rows, already classified by the first audit, and the gate that would catch it is not built |
| 2 | Record each leg's index price on the sample, or at least at open and peak | `ICX`, `ISRG`, `ANTHROPIC` and `ONG` are all part edge and part reference gap, and the row cannot say which. This is the cheapest column that turns section 2a from a live probe into a query |
| 3 | Close only for a real reason and record `closeReason` | Section 6. Zero of 617 episodes ended on the spread, all ended on silence |
| 4 | Shutdown flush, the first audit's section 15 item 2 | 3 lost, measured |
| 5 | Gate with underlying market hours for equity perps | New class, section 2a |
| 6 | Decide USD, USDC and USDT quote handling | Otherwise kraken and coinbase stay at 1% of output |
| 7 | Tolerance in the invariant checks | Section 1 caveat |

The first audit's items 4 and 5, the two staleness clocks and the per-leg age and size, remain the largest distortions.
55% of rows are frozen-leg rows and 52% of reopens fall inside the sweep window.
