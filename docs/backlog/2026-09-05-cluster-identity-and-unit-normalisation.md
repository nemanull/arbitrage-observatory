# Cluster identity and unit normalisation

Status: Not started. A temporary hardcoded patch is in place.
Recorded: 2026-09-05.
Indexed in [BACKLOG.md](../BACKLOG.md).

Replace the two hardcoded tables in `server/src/engine/cluster/clusterOverrides.ts` with a gate that decides,
from the venues' own published references, whether two markets are the same asset and whether they are
quoted in the same unit.

## Finding

A cluster is keyed on `${base}|${quote}` and nothing else.
`ClusterIndexBuilder.getPairFromRaw` in `server/src/engine/cluster/ClusterIndexBuilder.ts:183` builds the key,
and `getPairMarkets` at `:133` groups by it.
The guards along that path check venue id consistency at `:138`, empty or `|`-containing symbols at `:144`,
and one market per venue at `:163` and `:68`.
None of them is about identity or denomination.

`VenueConnector.toMarket` at `server/src/ccxt/connector.ts:114` has already discarded `contractSize`,
`settle` and `info` before the engine sees a market, so no unit information reaches the cluster builder.
`OpportunityManager.validate` at `server/src/engine/opportunity/OpportunityManager.ts:79` applies a floor on `netPpm`
and no ceiling.

Two venues that list different assets under the same ticker therefore form a cluster,
and so do two venues that list the same asset in different contract units.

## Evidence

The cluster set was rebuilt on 2026-09-05 exactly as `ClusterIndexBuilder` builds it, across binance,
bybit, okx and krakenfutures, and every leg was priced from its own venue's ticker.

| Venue | Live swaps | Priced |
| --- | ---: | ---: |
| binance | 778 | 758 |
| bybit | 837 | 815 |
| okx | 472 | 472 |
| krakenfutures | 280 | 280 |
| coinbase | 131 | 0, ccxt returns no swap tickers |

718 clusters had a live price on two or more venues.

| Class | Clusters | Share |
| --- | ---: | ---: |
| Agree within 3% | 711 | 99.0% |
| Dispersion 3–15% | 2 | 0.3% |
| Unit mismatch ×10 | 2 | 0.3% |
| Non-decimal mismatch | 3 | 0.4% |

The five broken clusters, in full, and they fall into two different categories.

| Pair | Ratio | binance | bybit | okx | Category |
| --- | ---: | ---: | ---: | ---: | --- |
| `BB\|USDT` | ×804 | 0.00960 | 0.0095995 | 7.7195 | Ticker collision, okx is the odd leg |
| `ON\|USDT` | ×361 | 0.20590 | 74.2300 | 74.3400 | Ticker collision, binance is the odd leg |
| `QNT\|USDT` | ×1.29 | 65.1000 | 65.0500 | 50.5200 | Ticker collision, okx is the odd leg |
| `ANTHROPIC\|USDT` | ×9.87 | 1948.70 | — | 197.405 | Unit mismatch, okx quotes a tenth |
| `OPENAI\|USDT` | ×9.79 | 1402.25 | — | 143.260 | Unit mismatch, okx quotes a tenth |

The collisions are confirmed by venue metadata rather than by price alone.
Binance's asset registry names `BB` as BounceBit and `QNT` as Quant, and has no entry at all for `ON`.
Bybit launched `BBUSDT` on 2024-05-14 with a tick of 0.000001, and okx listed `BB-USDT-SWAP` on 2026-06-01
with a tick of 0.001 — a tick larger than the whole binance price.
Okx's index for `BB`, `ON` and `QNT` excludes binance and bybit entirely, so no reference links them.

The unit mismatch is published by okx itself.
`GET /api/v5/market/index-components` returns `symPx`, the price okx read off another venue, and `cnvPx`,
the same price restated in okx's own unit.

```
ANTHROPIC-USDT   last=196.554
   OKX_LINEAR_PERPETUAL      symPx 197.57    cnvPx 197.570    x1
   Binance_LINEAR_PERPETUAL  symPx 1951.36   cnvPx 195.136    x0.1
   Gate_LINEAR_PERPETUAL     symPx 1969.59   cnvPx 196.959    x0.1
```

Across all 457 live okx USDT swaps, 1158 index components, only five carry any factor:
the four rows above for `ANTHROPIC` and `OPENAI`, plus `SHEIN-USDT`'s `Binance_Index` component at
0.127518. Every one is a pre-IPO synthetic. With no underlying token there is no canonical unit, so each
venue invents one. Ordinary crypto perps inherit the token's unit and never diverge.
The factors are stable to six significant figures across samples twenty seconds apart.

## Symptoms today

Five clusters out of 718 is 0.7% of the catalog, and they produced 53% of the rows in the first
real run — 258 of 488. The asymmetry is the whole point: a fake spread never converges, so it stays
open and is re-detected every few seconds forever, while a real dislocation is rare and brief.
Rarity in the catalog says nothing about share of output.

The second symptom is worse than the false rows.
Discovery takes a single cluster-wide argmax bid and argmin ask
(`OpportunityManager.ts:351` and `:376`) and returns early when that one route is already open (`:66`).
An alien leg therefore does not merely add noise, it censors the legitimate route in its own cluster.
The database proves it: there is not one binance-bybit row for `BB`, `ON` or `QNT`, even though
binance and bybit agree on all three to within 0.05%.

The third symptom is that the unit mismatch inverts the trade.
With the factor applied, the profitable direction on `ANTHROPIC` is okx-binance at roughly +11 500 ppm
net, while the engine recorded 61 rows on binance-okx, which is a loss of about −14 000 ppm.
All 61 `ANTHROPIC` and 50 `OPENAI` rows name the losing leg as the winning one.

## The temporary patch

`server/src/engine/cluster/clusterOverrides.ts` holds two hardcoded tables and
`OpportunityManager` holds a plausibility ceiling.
`DENIED_PAIRS` drops the three collisions, and since 2026-09-06 the `ONE|USDT` index-dispersion pair, before a cluster is built.
`PRICE_SCALE` multiplies okx's `ANTHROPIC-USDT-SWAP` and `OPENAI-USDT-SWAP` by 10 so the cluster is
comparable and the real basis is recorded.
`MAX_PLAUSIBLE_NET_PPM` rejects and logs anything above 10%, as the net for the next collision the
tables do not know about. The largest legitimate reading in the 488-row sample was 9704 ppm.

Everything about that is temporary. It is a fixed list against a moving catalog, it needs a human to
notice each new collision, and it carries no evidence trail — a reader of the code cannot tell which
entries are still true.

## Why it matters

Every statistic the observatory produces has these rows in its denominator.
Until the gate exists, no rate, no duration distribution and no per-venue comparison recomputed after
any other fix means anything, because the population is still dominated by fiction.
The censoring effect also means the fix is not only subtractive: legitimate routes that do not exist in
the data today appear once the alien legs are removed.

## What finishing this means

The gate tests agreement, not asset class.

1. At catalog build, read each venue's own reference for the cluster.
   Binance publishes it at `GET /fapi/v1/premiumIndex` as `indexPrice`.
   Okx publishes it at `GET /api/v5/market/index-components` as `last`.
2. References agree within a tolerance: same asset, same unit. Admit.
3. References differ by a factor the venue itself publishes: same asset, different unit.
   Admit, and store the factor with the market.
   Do not pattern-match on powers of ten — `SHEIN` uses 0.127518, and a heuristic that only recognises
   ×10 and ×100 would miss it silently.
4. Anything else: reject the cluster and log it, with the measured ratio, so a new collision is a line
   in the log rather than a fortnight of poisoned rows.

Two properties make this cheaper than it looks.

A majority vote resolves a three-venue cluster with no external call at all.
`BB`, `ON` and `QNT` are each three-venue clusters where two venues agree and one is the outlier.
Only `ANTHROPIC` and `OPENAI` are two-venue clusters where a vote is impossible, and those are exactly
the two where okx publishes `cnvPx`. The two mechanisms cover each other with no gap.

Asset class is not a discriminator and must not be used as one.
Binance's USD-M book carries 156 equity, 13 HK-equity, 8 KR-equity, 8 commodity, 2 CN-equity and 2
pre-IPO perpetuals alongside 567 crypto ones. `XAUUSDT` against another venue's gold perp is a
legitimate pair. An earlier draft of the audit recommended filtering `TRADIFI_PERPETUAL` out; that was
wrong and is recorded here so it is not proposed again.

The scale factor belongs on `Market` next to `takerPpm`, and it must be stored on the opportunity row
the same way the taker rates are, so a row survives a later factor change.
It must be re-resolved on catalog re-sync rather than compiled in.

## A market the engine cannot see

Bybit trades `ANTHROPICUSDT` — the venue's own UI shows it at 1,969.20 against an index
`.MANTHROPICUSDT` of 1,972.03, which agrees with binance's 1,951.05 and disagrees with okx's 197.4 by
the same factor of ten.

The engine will never see it. Bybit does not return it under `category=linear`
(855 instruments, checked with full pagination on 2026-09-05), and ccxt does surface
`ANTHROPICUSDT` and `OPENAIUSDT` for bybit but reports `active: false`, so
`isActiveSwapMarket` in `server/src/ccxt/connector.ts:139` skips both.

Two consequences.

The hardcoded `PRICE_SCALE` is correct as written precisely because of this: the `ANTHROPIC` and
`OPENAI` clusters are binance and okx only, so scaling the okx leg makes the cluster whole. If bybit's
listing ever becomes active in ccxt the cluster becomes three-venue, and the table still holds, because
bybit shares binance's unit and needs no entry.

The larger point is that a real, liquid leg is invisible to the ingest path and nothing reports it.
The engine cannot distinguish "this venue does not list this market" from "ccxt says inactive" from
"the venue returned it under a category we do not query". That belongs with the gate work: whatever
decides a cluster is admissible should also be able to say which legs it could not see.

## Known blockers

Only okx publishes an index-components endpoint.
Binance's `GET /fapi/v1/indexInfo` covers composite index symbols only, and bybit publishes index prices
but not their composition. For a binance-bybit cluster no venue tells you anything, so the generic
agreement test has to carry that case alone.

`cnvPx` covers only the venues okx chose for its own index, not necessarily the venue being compared.
`SHEIN` is the worked example: the ×0.127518 is against a `Binance_Index` product the engine never sees,
while the cluster that actually forms is okx and bybit, and those two agree exactly.

Coinbase was never measured. Ccxt's `coinbase` returned no swap tickers, so its 131 swap markets are
absent from the sweep above and must be checked before anything it produces is trusted.
See [`2026-09-05-coinbase-derivatives-cutover.md`](./2026-09-05-coinbase-derivatives-cutover.md).

The market universe is frozen at `Orchestrator.start`, so a gate that runs only at boot inherits that
limit. A collision that appears mid-run is invisible until a restart.

## Full evidence

[`../audits/2026-09-05-first-run-data-audit.md`](../audits/2026-09-05-first-run-data-audit.md)
sections 2 through 2f carry the queries, the raw API payloads and the adversarial review of each claim.
