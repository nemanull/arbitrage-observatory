# Depth block design

Status: Done.
Recorded: 2026-09-06.
Reconciled: 2026-09-06 against the shipped code.
Indexed in [`README.md`](../README.md).
Implements the in-memory half of the third line of Phase 4 in [`ROADMAP.md`](../ROADMAP.md).
Builds on [`2026-09-06-book-sizes-and-far-sides-design.md`](../implemented/2026-09-06-book-sizes-and-far-sides-design.md), which put layer 1 sizes in the cluster.
The implementation plan is [`2026-09-06-depth-block-plan.md`](./2026-09-06-depth-block-plan.md).

## Problem

A guard that decides whether a route is worth opening at a given notional needs the levels behind the touch on both legs, at runtime, in memory.
The cluster holds layer 1 only.
Where the depth comes from, a REST fetch first and possibly a subscription later, is a separate concern from where they live and how they are read.
This design settles the second part only.

## Decisions

1. Depth lives in the cluster, in a block of flat typed arrays with one range of `maxLevels` entries per venue slot, allocated once at build and never resized.
   Level `l` of venue slot `v` sits at index `v * maxLevels + l`.
   This is the layer 1 layout, `bid[v]`, with a second dimension.
2. The block is its own type, `ClusterDepth`, on `Cluster.depth`, so its names do not collide with the layer 1 `bidSize` and `askSize` and need no prefix.
   Prices and sizes are raw, as the venue quotes and counts them, like every other array in the cluster.
3. `maxLevels` is 20 by default and is a constructor option of the builder.
   Twenty covers the 0.5% band where an edge can still be positive on the finest-tick books, which take about sixteen levels, and it sits inside what every venue returns cheaply.
   The whole block is about 2.2 MB across all markets, so nothing is allocated lazily.
4. The block is written only by `Engine.updateDepth`, which resolves the slot through the engine's existing silent `resolveSlot` and warns once with issue `unknown_market` when it finds nothing, copies up to `maxLevels` entries per side, records the filled counts and the write time, and runs no discovery.
   A depth update is not a tick.
5. A depth update is rejected whole, with a warning, when any level has a non-finite or non-positive price, a non-finite or negative size, or when the side is out of order.
   Bids must be non-increasing and asks non-decreasing, because the walk relies on it.
   An empty side is accepted, because a one-sided book is a fact worth holding.
6. Nothing is ever cleared.
   `bidLevelCount` and `askLevelCount` are the truth about a slot, entries past them are unreachable, and `writtenAt` lets a reader refuse depth older than the episode it is judging.
7. The fetcher, the walk, the guard, the close reason and the row are out of scope.
   They are the next design, which will call `updateDepth` and read the block.

## Rejected alternatives

- An array of `Float64Array`, one per venue.
  It adds an indirection per venue, cannot be laid over one `SharedArrayBuffer` later, and reads no better than a base offset.
- A `BookSnapshot` object per episode instead of a block in the cluster.
  It works for a one-shot fetch, but a subscription for open episodes would then need a second representation, and the guard would read two shapes.
- Clearing a slot when its episode closes.
  It adds a code path for no reader benefit, since counts and `writtenAt` already say what is held and how old it is.
- Depth for every market from a stream.
  Five to ten times the message rate and maintained books on three venues, for levels the guard reads twice per episode.

## Types

```ts
export type BookLevel = [price: number, size: number];

export type ClusterDepth = {
  readonly maxLevels: number;
  readonly bidPrice: Float64Array; // width × maxLevels, descending inside a slot
  readonly bidSize: Float64Array;
  readonly askPrice: Float64Array; // ascending inside a slot
  readonly askSize: Float64Array;
  readonly bidLevelCount: Uint8Array; // filled entries per slot, 0 = nothing held
  readonly askLevelCount: Uint8Array;
  readonly writtenAt: Float64Array; // Unix ms per slot, 0 = never
};
```

## Evidence

- Layer 1 layout and the slot convention: `Cluster` in [`types.ts`](../../server/src/engine/types.ts), one entry per venue, and `createCluster` in [`ClusterIndexBuilder.ts`](../../server/src/engine/ClusterIndexBuilder.ts).
- Slot resolution and quote validation that `updateDepth` mirrors: `updateQuote` and `validateQuote` in [`Engine.ts`](../../server/src/engine/Engine.ts).
- Level counts observed on live books on 2026-09-06, section 3 of [`2026-09-06-third-run-data-audit.md`](../research/2026-09-06-third-run-data-audit.md): five binance levels covered about 13,500 dollars, and kraken's whole LAYER book had thirteen bids and six asks.
