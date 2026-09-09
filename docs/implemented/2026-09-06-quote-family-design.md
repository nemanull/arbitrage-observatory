# Quote family design

Status: Done.
Recorded: 2026-09-06.
Indexed in [`README.md`](../README.md).
Decides item 6 of [`2026-09-06-second-run-data-audit.md`](../audits/2026-09-06-second-run-data-audit.md).
The work was small enough that the implementation plan is folded into the last section of this doc.

## Problem

Kraken Futures quotes every perpetual in USD and Coinbase International in USDC, while binance, bybit and okx quote in USDT.
The cluster key was the base and the quote as the venue spells it, so the three quotes were three different assets.
Kraken found a partner on 24 of its 276 markets and coinbase on 56 of 131, and every partner was an inverse or USDC contract with a thin book.
Over the eight hour run of 2026-09-06 the two venues produced 14 of 1291 rows.
A live probe of those 80 clusters on 2026-09-06 found none within reach of the 5000 ppm opening threshold.
The median best net reading was -245 ppm for the kraken clusters and -900 ppm for the coinbase clusters.

## Decisions

1. USD, USDC and USDT count as one settlement asset for clustering, and the key spells it USDT.
   Their basis is normally under 100 ppm against a 5000 ppm opening threshold.
   The row keeps both raw market ids, so a mixed cluster stays auditable.
2. A venue contributes one contract per pair, chosen by rank: linear before inverse, then USDT, USDC, USD.
   The order in which CCXT lists a venue's markets decides nothing.
3. The choice is logged at debug, because it is the normal path for 163 markets: binance 58, bybit 90, okx 15.
4. Any other quote stays its own key.
   That covers BTC, the three binance USD1 perps, and the two binance markets CCXT reads as quoted in U, until someone checks what they are.
5. No new columns and no migration.
   Recording each leg's quote on the row was deferred, because the raw market ids already carry it.

## Rejected alternatives

- Spelling the family key USD.
  It is more honest about the kraken and coinbase legs, but it re-spells `DENIED_PAIRS` and every stored pair for no change in behaviour.
- A market filter per venue in [`registry.ts`](../../server/src/venues/registry.ts), keeping linear USDT contracts only on binance, bybit and okx.
  It follows the kraken pattern, but it needs three copies and drops a venue wherever it lists a coin only in USDC or as an inverse contract.
- Mapping the quote in the key without the rank.
  Measured on the CCXT catalogs of 2026-09-06, the old keep-the-first-listed rule then leaves bybit on its USDC PERP contract for 65 pairs and okx on its inverse swap for 15, with BTC, ETH, XRP and BCH among them.

## Evidence

- The key is built by `getPairFromRaw` in [`ClusterIndexBuilder.ts`](../../server/src/engine/ClusterIndexBuilder.ts) at line 240, which folds the quote through `clusterQuote`.
- The rank decides between a venue's twins in `getPairMarkets` at line 217 of the same file.
- The family map and the rank live in [`quoteFamily.ts`](../../server/src/engine/quoteFamily.ts) at lines 6 and 18.
  They are kept out of [`clusterOverrides.ts`](../../server/src/engine/clusterOverrides.ts), which lists exceptions for specific pairs and markets, because the family is a rule for every venue.
- The connector in [`connector.ts`](../../server/src/ccxt/connector.ts) at line 153 still copies the quote from CCXT unchanged, so `Market.quote` is what the venue says.

Simulated on the live CCXT catalogs on 2026-09-06 with the same grouping the builder uses.
The first row reproduces the 752 clusters the engine logged at boot, after the 4 denials.

| key | clusters | krakenfutures | coinbase | binance | bybit | okx | five-venue |
|---|---|---|---|---|---|---|---|
| base and raw quote | 756 | 24 | 56 | 701 | 729 | 442 | 0 |
| base and family, ranked | 694 | 249 | 124 | 655 | 659 | 433 | 72 |

The total falls because `BTC|USDT`, `BTC|USDC` and `BTC|USD` were three clusters and are now one.
After the merge no inverse or USDC contract is chosen on binance, bybit or okx.

## Caveats

- A stablecoin depeg turns every mixed cluster into phantom rows at once.
  The raw market ids on the row identify them after the fact, and no guard exists yet.
- The ticker-only cluster identity in [`2026-09-05-cluster-identity-and-unit-normalisation.md`](../backlog/2026-09-05-cluster-identity-and-unit-normalisation.md) now spans 72 five-venue clusters.
- Rows of the kind the second audit found for `APT|USD`, a kraken linear against a 0.9% wide bybit inverse book, no longer occur, because the inverse contract is never chosen.

## What shipped

1. [`quoteFamily.ts`](../../server/src/engine/quoteFamily.ts): `QUOTE_FAMILY`, `clusterQuote` and `marketRank`.
2. [`ClusterIndexBuilder.ts`](../../server/src/engine/ClusterIndexBuilder.ts): the key folds the quote, and `getPairMarkets` keeps the better ranked twin at debug instead of the first listed at error.
3. [`types.ts`](../../server/src/engine/types.ts): comments on `PairKey`, `Market.quote` and `Cluster`.
4. [`ClusterIndexBuilder.spec.ts`](../../server/src/engine/ClusterIndexBuilder.spec.ts): four cases, the merge, the rank against listing order, a venue with nothing better than a twin, and a non-dollar quote.
5. [`WIKI.md`](../WIKI.md): the cluster definition.

Not touched: the engine, the manager, the feeds, the connector, the schema and the app, none of which read the quote.
