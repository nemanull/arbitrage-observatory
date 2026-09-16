# Depth block plan

Status: Done.
Recorded: 2026-09-06.
Reconciled: 2026-09-06 against the shipped code, with the deviations noted inline.
Indexed in [`README.md`](../README.md).
Design of record: [`2026-09-06-depth-block-design.md`](./2026-09-06-depth-block-design.md).

## Scope guard

This work does not:

- fetch depth from any venue, over REST or a socket
- walk the depth, compute an edge at a notional, or close a route on depth
- add a close reason, a column, or anything on the row
- change `updateQuote`, the tick path, or discovery

## Tasks

1. Types.
   `server/src/engine/cluster/types.ts` gains `BookLevel` and `ClusterDepth`, and `Cluster` gains `depth`.
2. Builder.
   `server/src/engine/cluster/ClusterIndexBuilder.ts` exports `DEPTH_LEVELS` and `createClusterDepth(width, levels)`, takes `depthLevels` as a constructor option, and allocates the block in `createCluster`.
3. Engine.
   `server/src/engine/Engine.ts` adds `updateDepth(venueId, rawMarketId, bids, asks, ts)` with the validation of the design and a `depth_update_rejected` warning.
   Deviation: the file already had a silent `resolveSlot` used by `tracks`, so `updateDepth` reuses it and warns on a miss itself, and `updateQuote` keeps its own warning lookup untouched.
4. Specs.
   `ClusterIndexBuilder.spec.ts` asserts the block's shape and the option.
   `Engine.spec.ts` covers a write, truncation, a short side, a one-sided book, each rejection, an unknown market, and that a write runs no discovery.
   `Engine.spec.ts` and `OpportunityManager.spec.ts` build their clusters with `createClusterDepth`, at 4 levels so the index tables stay short.
   Prettier also reformatted three pre-existing long lines in `ClusterIndexBuilder.spec.ts` and a blank line in `krakenfutures.ts`.
5. Verify.
   `npx tsc --noEmit -p tsconfig.json`, `npx eslint src`, prettier on the changed files, and `npx jest src/engine --forceExit` from `server/`.
6. Reconcile. Done.
   Verified from `server/`: tsc clean, eslint clean, prettier clean on every changed file, and the engine, venue, ccxt and db suites passing.
