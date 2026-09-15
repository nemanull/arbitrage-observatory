# Binance real time depth, implementation plan

Implements [`2026-09-15-binance-realtime-depth-design.md`](./2026-09-15-binance-realtime-depth-design.md).

## Scope guard

This work does not:

- Change any other venue's feed, including the OKX `bbo-tbt` option the research measured.
- Add a second writer of the top of book.
- Add a REST call to the book path.
- Change `OrderBook`, `Engine` or the opportunity path.
- Add a stream name to the frames the other feeds emit.

## Tasks

### 1. `server/src/venues/binance/binance.ts`

- Replace `STREAM_SUFFIX` with `DIFF_SUFFIX` of `@depth@0ms` and `SNAPSHOT_SUFFIX` of `@depth20@100ms`.
- Point both hosts at the combined endpoint: `wss://fstream.binance.com/public/stream` and `wss://dstream.binance.com/stream`.
  A plan's url carries the first market's two streams, and the subscribe frames carry every market's two streams, which is what the feed does today with one stream.
- Keep 200 markets per connection, which is now 400 streams against a documented cap of 1,024.
- Add per symbol state: the last applied update id, the window's deepest bid price and the window's deepest ask price.
  A symbol with no state is unsynced and drops diffs until a snapshot arrives.
- Route a frame by its stream name.
  A name ending in `DIFF_SUFFIX` is a diff, anything else carrying `depthUpdate` is a snapshot, which keeps a bare frame readable as a snapshot.
- Snapshot path: drop it when `u` is at or behind the last applied id, otherwise reset the book, set the window from the deepest level of each side, store `u` and publish.
- Diff path: drop it when the symbol is unsynced or `u` is at or behind the last applied id.
  Mark unsynced and warn `book_desync` when neither `pu` equals the last applied id nor `U` is at most one past it.
  Otherwise apply every level inside the window, store `u` and publish.
- Do not call `resync` on a sequence break.

### 2. `server/src/venues/binance/binance.spec.ts`

Cases to add or rewrite, with the payload shape the probe captured:

- A plan's url names the combined endpoint and both streams of its first market.
- Subscribe frames carry two streams per market and still split at 100 streams.
- A snapshot opens the book, and a following diff moves one level and publishes the merged top.
- A diff that arrives before any snapshot is dropped.
- A diff whose `pu` skips is dropped, warns, and leaves the socket open, and the next snapshot recovers the symbol.
- A diff that straddles the snapshot, `U` at most one past the last id, is applied.
- A snapshot at or behind the last applied id is dropped.
- A diff level below the window's deepest bid, or above its deepest ask, is ignored.
- A level removed by a diff, size zero, leaves the book.
- The existing cases for unknown symbols, one sided books, level counts and rejected subscriptions stay green.

### 3. Verification

- `npx jest src/venues/binance src/feeds src/engine --forceExit` from `server/`.
- `npx tsc --noEmit`, `npx eslint`, `npx prettier --check` on the touched files.
- Run the engine and confirm on the live socket: publishes per second for binance, `book_desync` count, and no `book_resync` from binance.

## Reconcile

After the run, update the design with the measured publish rate and the loop cost, then move both docs to [`implemented/`](../implemented/) and update [`README.md`](../README.md).
