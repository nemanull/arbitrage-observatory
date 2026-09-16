# Arbitrage Observatory

[![CI](https://github.com/nemanull/arbitrage-observatory/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/nemanull/arbitrage-observatory/actions/workflows/ci.yml)

Arbitrage Observatory is a research platform for measuring whether cross-venue arbitrage in cryptocurrency perpetual futures is capturable from a retail network position, meaning no exchange relationship, no negotiated fee tier and no colocation.

It maintains a live order book for most perpetual markets on five centralised exchanges, identifies price gaps that remain profitable after both taker fees, and records each one as an episode.
An episode is the whole life of a gap rather than a snapshot of it, so a stored row carries the per-tick price series, the depth on both sides, and the reference prices each venue published while the gap was open.

The system is read-only.
It holds no API credentials, contains no order placement path, and has never submitted an order.
Every profit figure in this repository is arithmetic over a stored price series rather than a fill.

## Results

Five runs have been audited, 3,187 stored rows between them.
None has been shown to represent capturable profit.
The table was cleared between several of those runs, so the figure is the sum of the audited runs rather than a lifetime total.

The most recent audited run reflects the current gate set.
It ran for 16 hours and 46 minutes across 694 clusters on five venues, refused 3,155,976 attempts to open a route, and stored 66 rows.

The refusal count records occurrences rather than distinct gaps, because a gap that persists is re-judged on every tick.
One pair, LSK on Bybit against Binance, accounts for 1,982,725 of them and still produced two rows.

| Refusal | Occurrences | Basis |
| --- | ---: | --- |
| `standing_basis` | 1,754,420 | The gap is explained by the two venues' own reference prices rather than by a dislocation between them. |
| `anchor_moving` | 1,391,547 | The venue's own reference moved more than 1,000 ppm within a single poll, so no reading could be judged against it. |
| `thin_book` | 8,367 | The profitable region held under 1,000 quote units, at a median of 10. |
| `anchor_skewed` | 1,247 | The two legs' references were read more than five seconds apart. |
| `unconfirmed_cross` | 394 | The gap was not confirmed at 100 ms, at a median age of 33 ms. 31 of them lived past 100 ms and were refused by another guard while pending. |
| `anchor_missing` | 1 | A leg published no reference at all. |

Of the 66 stored rows, 58 describe a gap that a taker could not have taken.

- Thirty record the engine's own view of a venue running 1.1 to 3.7 seconds behind that venue's trade tape during two flash crashes, so the gap did not exist on the venue's clock.
- Twenty-two are standing bases that cleared the fresh-edge gate by margins as small as 9 ppm.
- Six are single resting orders, each on a book with one maker in it.

The remaining eight are seven single-pair flashes, five of them sub-second and two a little over a second, plus one nine-second convergence worth under five dollars.

The run contained one gap that provably existed on both venues' clocks: a four-hour-old Kraken bid for 20,180 STX, worth 5,093 dollars, consumed by fourteen taker sells in roughly 25 milliseconds.
The engine opened its row 413 milliseconds after that bid was gone.

Every row of the run is classified in [docs/audits/2026-09-15-fifth-run-data-audit.md](./docs/audits/2026-09-15-fifth-run-data-audit.md).

## Limitations

The null result is bounded by three things, and none of them is settled.

Recall is unmeasured.
The engine has never produced a confirmed true positive, so "no capturable row was found" and "the gates are too tight" cannot be distinguished from inside the dataset.
Separating them requires a replay against a dislocation known to have been real, which is the next piece of work.

No gate reads the age of a price.
Every venue adapter parses the exchange timestamp off the frame and then discards it, so a stale quote and a current one are indistinguishable at the gate.
That omission accounts for thirty of the 66 surviving rows.

Coverage is partial and varies by run.
The fifth run streamed 659 of Bybit's 852 perpetual markets, 652 of Binance's 782, 434 of OKX's 479, 247 of Kraken's 275 and 124 of Coinbase's 131.

## Failure classes

Each run surfaced a new mechanism by which a correctly read, fee-adjusted price gap can be worth nothing.
They are catalogued in [docs/bestiary/](./docs/bestiary/), one file per class, each anchored to the row that produced it and the order book behind that row.

| Class | Mechanism |
| --- | --- |
| [`stale-quote.md`](./docs/bestiary/stale-quote.md) | A price held for 22 seconds after it stopped existing, because the Coinbase channel publishes on trades rather than on quote changes. |
| [`standing-basis.md`](./docs/bestiary/standing-basis.md) | A gap two perpetuals hold open indefinitely, because each is anchored to its own venue's index and nothing anchors them to each other. |
| [`thin-book.md`](./docs/bestiary/thin-book.md) | A best price that is entirely genuine and holds eleven dollars, posted by the single maker whose cancellation moves it seven percent. |
| [`edge-at-the-touch.md`](./docs/bestiary/edge-at-the-touch.md) | Treating the best level as infinitely deep, and the ladder walk that replaced that reading. |
| [`slow-venue-resting-order.md`](./docs/bestiary/slow-venue-resting-order.md) | A real order left untouched for 28 seconds, the one class that is not an artefact and still not free money. |

## Method

A route must clear every gate below before a row opens.
The thresholds are defined in [`OpportunityManager.ts`](./server/src/engine/opportunity/OpportunityManager.ts) and [`anchorReading.ts`](./server/src/engine/opportunity/anchorReading.ts).
Most were chosen rather than derived, and the two that were sized against a measurement name that measurement in a comment.

| Gate | Threshold | Rationale |
| --- | --- | --- |
| Net edge after both taker fees | 5,000 ppm | Below half a percent nothing survives the round trip. |
| Fresh edge, each book divided by its own venue's mark | 5,000 ppm | Separates a dislocation from a basis the market holds open deliberately. |
| Reference age and inter-leg skew | 10 s and 5 s | A judgement made against a stale reference is not a judgement. |
| Reference movement within one poll | 1,000 ppm | A reference in motion cannot establish a fair price. |
| Profitable region across the ladder | 1,000 quote units | The edge at the touch is not the edge, so both ladders are walked. |
| Gap age on the same route | 100 ms | Our view of a venue is 53 to 91 ms old and an order needs comparable time again. This measures our own first sight of the gap, not the exchange clock, which is the limitation named above. |
| Plausibility ceiling | 100,000 ppm | Above ten percent the reading is bad data rather than an opportunity. |

An open route is re-judged on every tick and closes for exactly one of five recorded reasons.
Silence is not among them.
Every feed is change-driven, so a leg that has not printed is a leg that has not changed.

### Measurement environment

Network position is part of the experiment rather than an implementation detail, since the question concerns a retail operator.

Four of the five live venues were measured against their own timestamps, and Binance, Bybit, OKX and Coinbase all agree with this host to within 5 ms.
A book frame arrives 53 to 69 ms after Binance stamped it, 89 to 91 ms after Bybit and 53 ms after OKX.
Coinbase frame arrival and Kraken Futures were not measured.
Request round trips range from 92 to 172 ms.
Binance answers from `ap-northeast-1` in Tokyo.
Bybit and OKX answer from CDN edges, so their origin is inferred from the round trip rather than measured.

That view age is what sets the 100 ms gate on gap age, and it is why a 25 millisecond dislocation was never reachable from this host.
A machine beside a matching engine would change those figures.
It would not change the standing basis, the thin book or the single-maker order, which together account for most of what the runs found.
The full breakdown is in [`2026-09-15-binance-realtime-depth.md`](./docs/research/2026-09-15-binance-realtime-depth.md).

## Architecture

```
venue WebSocket          one book feed per venue, 20 levels a side, sequence checked
    |
ClusterIndexBuilder      markets trading the same asset grouped into one cluster,
    |                    with USD, USDC and USDT treated as one settlement asset
Engine                   flat Float64Array per cluster, best bid and best ask
    |                    recomputed per frame, taker fees folded into multipliers
OpportunityManager       the gates above, one recorded reason per refusal
    |
OpportunityLifecycle     open routes sampled per tick, carrying the ladder walk
    |                    and the reference reading on every sample
BullMQ and Postgres      the closed episode written as one row with its full series
```

Holding each cluster in flat typed arrays, with taker fees folded into multipliers once at build time, makes judging a frame arithmetic over a contiguous block rather than a lookup.
[`2026-09-07-depth-stream-scaling.md`](./docs/research/2026-09-07-depth-stream-scaling.md) measures the path at 26.2 microseconds of process CPU per message without deflate.
The handler accounts for 12.5 of those microseconds, and parsing for 73 percent of the handler.

A separate REST poller reads what each venue believes about its own market roughly once a second: the index, the mark and the funding rate.
Bybit and Coinbase poll every two seconds instead, because a one hertz round does not complete against either.
Without those figures a dislocation cannot be distinguished from a basis, which is what the first four runs established.

The stored schema is [`schema.prisma`](./server/prisma/schema.prisma).

## Scope

- Five venues run live: Binance, Bybit, OKX, Kraken Futures and Coinbase.
  Five further adapters are written, tested and registered but not activated: Gate, Bitget, MEXC, Bitstamp and Gemini.
- [`app/`](./app/) is the stock Vite starter page, with only its title and manifest touched.
  No interface has been built and the engine does not require one, so stored episodes are read through Prisma Studio, `psql` or SigNoz.
- The HTTP surface is three routes that report and control a run, not an API over the data.
- None of those five additional exchanges permits a US operator to trade its perpetuals.
  Observation is available from this host and execution is not.

## Documentation

Documentation is the larger part of this project, and every file in it is indexed in [docs/README.md](./docs/README.md).

| Directory | Contents |
| --- | --- |
| [docs/audits/](./docs/audits/) | One file per audited run, oldest first, each citing the audit before it. The newest describes current behaviour. |
| [docs/bestiary/](./docs/bestiary/) | One file per mechanism by which an arbitrage reading can be wrong. |
| [docs/research/](./docs/research/) | Probes and feasibility studies, including a measurement of 12.48 million book deltas across four venues with zero sequence gaps. |
| [docs/profiles/](./docs/profiles/) | 25 venue profile documents across ten exchanges, each built from captured frames rather than vendor documentation. |
| [docs/implemented/](./docs/implemented/) | Reconciled designs and plans for work that has shipped. |

Open work is tracked in [GitHub issues](https://github.com/nemanull/arbitrage-observatory/issues) and in [docs/BACKLOG.md](./docs/BACKLOG.md).

## Repository

```
server/     the engine, NestJS and TypeScript, compiled with tsgo
app/        placeholder frontend, an unmodified Vite starter
docs/       research, designs, run audits and the failure catalogue
scripts/    23 probe scripts, the raw evidence behind the research, plus a Redis helper
infra/      a vendored SigNoz stack for local observability
```

Installation, configuration and the commands for running a session are in [SETUP.md](./SETUP.md).
Working conventions are in [AGENTS.md](./AGENTS.md), and the documentation tree has its own rules in [docs/AGENTS.md](./docs/AGENTS.md).

## Status

Active, and the question is open.
The engine sustains a full day of streaming, the gate set holds, and each run so far has exposed a class of false positive the previous gates did not cover.

The current conclusion is that additional gates cannot settle the question on their own.
No stored row records whether a taker would have been filled, so the next step is a closed-loop replay that produces that label.

Continuous integration runs the typecheck, the linters, the 389 unit tests and both builds on every push, and needs no database or network access to do it.

## License

MIT, see [LICENSE](./LICENSE).
