# Book sizes and far sides design

Status: Done.
Recorded: 2026-09-06.
Reconciled: 2026-09-06, the same day, against the shipped code.
Indexed in [`README.md`](../README.md).
Implements the second line of Phase 4 in [`ROADMAP.md`](../ROADMAP.md).
Research: section 6 and item 3 of section 8 in [`2026-09-06-third-run-data-audit.md`](../audits/2026-09-06-third-run-data-audit.md).
The implementation plan is [`2026-09-06-book-sizes-and-far-sides-plan.md`](./2026-09-06-book-sizes-and-far-sides-plan.md).

## Problem

A stored opportunity carries the best bid of the venue we sell on and the best ask of the venue we buy on, and nothing else about either book.
It cannot say how many coins stood behind either price, and it cannot say what the other side of each book was, which is the price of the unwind and the width that marks a thin market.
Every feed already delivers the size next to the price and every cluster already holds both sides of every market.
The engine drops the sizes at each feed's `submit` call and never reads the far sides.

## Decisions

1. Sizes are recorded at the top of book only, from the messages the feeds already parse.
   No depth channel is subscribed and no snapshot is fetched.
   Depth is the third line of Phase 4 and gets its own design.
2. The cluster stores raw sizes next to raw prices, and a size multiplier is applied when a reading is taken.
   This mirrors the prices: [`OpportunityManager.ts:207-208`](../../server/src/engine/opportunity/OpportunityManager.ts) multiplies `cluster.bid[b] * cluster.bidMul[b]` at read time, and [`Engine.ts`](../../server/src/engine/Engine.ts) writes the raw quote into the slot.
   `sizeMul[i] = contractSize / priceScale`, so on a price-scaled market the product of an adjusted price and an adjusted size is still the raw notional.
3. A size-only change is not a tick.
   `Engine.updateQuote` writes both sizes before its repeat check, and the repeat check keeps comparing prices only, so bybit's idle re-sends and a maker resizing at the touch never run discovery.
4. `Market` carries `contractSize`, taken from ccxt at boot and defaulting to 1 when ccxt reports none.
   The builder derives `sizeMul` from it the way it derives `bidMul` from `takerPpm`, in [`ClusterIndexBuilder.ts:84-85`](../../server/src/engine/cluster/ClusterIndexBuilder.ts).
5. The `Observation` carries four more numbers: the touch size of each leg in coins, and the far side of each leg adjusted by the same multipliers as `highestBid` and `lowestAsk`.
6. The `Opportunity` keeps those four numbers at open, at peak and at the last tick, twelve scalars in all, and adds no series, so `MAX_SERIES_LENGTH` still bounds the row.
7. Quote validation rejects a non-finite or negative size with its own issue code and keeps the quote otherwise.
   A zero size is accepted, because an empty level is a fact about the book and not a broken message.
8. The row, the schema, the converter and the migration are out of scope.
   This design ends at the in-memory `Opportunity`, and the next design carries the twelve numbers to the row together with the snapshot.
9. The `Opportunity found` log line gains the two touch sizes in coins, so a dust reading is visible in the logs before it is visible in the table.
   The `quote_update_rejected` warning carries both sizes for the same reason.

## Rejected alternatives

- Multiplying sizes at write time.
  It would make sizes the only adjusted arrays in a cluster of raw ones, and the repeat check would have to compare adjusted numbers.
- Converting contracts to coins inside each feed.
  The okx feed would need its own table of contract values, and the unit logic would live in five parsers instead of one builder.
- A size series next to the price series.
  It doubles the per-tick cost of a row for a number that only matters at open, peak and close.
- `contractSize` on the cluster only.
  The builder reads `Market` for every per-market constant, and the row cites `Market` for the fee it used, so the source belongs there.

## Types

As landed in [`types.ts`](../../server/src/engine/cluster/types.ts), [`ws/types.ts`](../../server/src/feeds/book/types.ts) and [`Engine.ts`](../../server/src/engine/Engine.ts):

| type | addition |
|---|---|
| `Market` | `contractSize: number` |
| `NormalizedQuote` and `SingleMarketClusterQuote` | `bidSize: number`, `askSize: number`, raw contracts |
| `Cluster` | `sizeMul`, `bidSize`, `askSize`, three `Float64Array` with one slot per venue |
| `Observation` | `highestBidSize`, `lowestAskSize`, `highestBidLegAsk`, `lowestAskLegBid` |
| `Opportunity` | the same four at open, as `peak*` and as `last*` |

## Evidence

- Sizes on the wire, dropped at submit before this change: [`binance/types.ts:9-11`](../../server/src/venues/binance/types.ts), [`coinbase/types.ts:6-7`](../../server/src/venues/coinbase/types.ts), [`krakenfutures/types.ts:6-7`](../../server/src/venues/krakenfutures/types.ts), [`bybit/types.ts:3`](../../server/src/venues/bybit/types.ts), and the feed hand-off at [`VenueFeed.ts:162-164`](../../server/src/feeds/book/VenueFeed.ts).
- Both sides in memory: `bid` and `ask` in `Cluster`, one slot per venue.
- `contractSize` discarded today: [`connector.ts:138`](../../server/src/ccxt/connector.ts) `toMarket`.
- The third-run audit, section 6, for what the row cannot say without these numbers.
