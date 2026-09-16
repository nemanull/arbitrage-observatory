# Book sizes and far sides plan

Status: Done.
Recorded: 2026-09-06.
Reconciled: 2026-09-06 against the shipped code, with the deviations noted inline.
Indexed in [`README.md`](../README.md).
Design of record: [`2026-09-06-book-sizes-and-far-sides-design.md`](./2026-09-06-book-sizes-and-far-sides-design.md).

## Scope guard

This work does not:

- change the database schema, the converter, the migration or the generated client
- subscribe to any depth channel or fetch any snapshot
- add a close reason or a gate on size or width
- add a series to the opportunity
- change which channel any feed subscribes to

## Tasks

1. Types. Done.
   `server/src/engine/cluster/types.ts`, `server/src/feeds/book/types.ts`, `server/src/engine/Engine.ts` `SingleMarketClusterQuote`.
2. Connector.
   `server/src/ccxt/connector.ts` `toMarket` sets `contractSize` from the ccxt market, defaulting to 1, and logs one summary line per venue when any market has a contract size other than 1.
   No `Market` literal existed outside the two engine specs and the feed specs, so the sweep touched nothing, and the feed specs were updated under task 6.
   A new `server/src/ccxt/connector.spec.ts` covers the default for every bad value and the summary line.
3. Builder.
   `server/src/engine/cluster/ClusterIndexBuilder.ts` `createCluster` allocates `sizeMul`, `bidSize` and `askSize` and fills `sizeMul[i] = market.contractSize / scale`.
   `ClusterIndexBuilder.spec.ts` asserts the multiplier for a plain market and for a scaled one, and no `Cluster` literal existed outside the two engine specs.
4. Engine.
   `server/src/engine/Engine.ts` `validateQuote` adds `bid_size_not_finite`, `bid_size_negative`, `ask_size_not_finite`, `ask_size_negative`.
   `updateQuote` writes `bidSize` and `askSize` into the slot before the repeat check, which stays on prices, and the rejection warning carries both sizes.
   `Engine.spec.ts` gains a size-only change that updates the arrays and does not run discovery, and a negative size that is rejected and leaves the arrays untouched.
5. Manager.
   `server/src/engine/opportunity/OpportunityManager.ts` `validate` builds the `Observation` with the four new numbers from the cluster arrays and multipliers.
   `createNewOpportunity`, `recordSample`, `updateOpportunity` and the existing-route path of `trackOpportunity` carry them at open, peak and last.
   The open log line gains the two sizes in coins.
   `OpportunityManager.spec.ts` asserts the twelve numbers at open, after a new peak, and at close.
6. Feeds.
   Each of `binance.ts`, `bybit.ts`, `okx.ts`, `coinbase.ts` and `krakenfutures.ts` under `server/src/venues/` fills `bidSize` and `askSize` on `submit` from the fields it already parses, as `Number(...)`, and leaves rejection of a bad value to the engine.
   Each feed spec that asserts the exact `updateQuote` object gains the two sizes.
7. Verify.
   `npx tsc --noEmit -p tsconfig.json`, `npx eslint src`, and `npx jest src/engine src/venues src/ccxt --forceExit` from `server/`.
8. Reconcile. Done.
   Verified from `server/`: tsc clean, eslint clean, prettier clean on every changed file, and 109 tests in 10 suites passing across `src/engine`, `src/venues`, `src/ccxt` and `src/db`.
