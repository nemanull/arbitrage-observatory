# Rust venue adapters, plan

Implements [`2026-10-01-rust-venue-adapters-design.md`](./2026-10-01-rust-venue-adapters-design.md), which is the design of record.
Decision numbers below are that doc's.

## Scope guard

This work does not:

- start gate, bitget, mexc, bitstamp or gemini, so `ACTIVE_VENUES` keeps its five ids,
- add exchange timestamps, kernel stamps or a lag gate, which are items 1, 2 and 4 of [`2026-09-17-rust-rewrite-requirements.md`](../backlog/2026-09-17-rust-rewrite-requirements.md),
- change the engine, the opportunity code or the runtimes beyond `price_scale` and the test only harness of decision 15,
- touch [`old_ts_server/`](https://github.com/nemanull/arbitrage-observatory/tree/c642b40e4d0648c13ef30f666f5d76ebb9fd6d53/old_ts_server), CI, the database schema or the migrations,
- commit anything, because the user commits.

## Status

| Task | Status |
|---|---|
| 1. `price_scale` on `Market` | Done |
| 2. reqwest gzip | Done |
| 3. `venues/wire.rs` | Done |
| 4. `venues/catalog.rs` | Done |
| 5. `Connection` test harness | Done |
| 6. Registry arms and live tests | Done |
| 7. binance | Done |
| 8. bybit | Done |
| 9. okx | Done |
| 10. krakenfutures | Done |
| 11. coinbase | Done |
| 12. Catalog parity for the five | Done |
| 13. Live smoke for the five | Done |
| 14. Test run | Done |
| 15. gate | Done |
| 16. bitget | Done |
| 17. mexc | Done |
| 18. bitstamp | Done |
| 19. gemini | Done |
| 20. Catalog parity and live smoke for the later five | Done |
| 21. Reconcile | Done |

## Rules for every venue task

- The Nest adapter is the specification: `old_ts_server/src/venues/<id>/<id>.ts`, `anchor.ts`, `types.ts`, and the two spec files beside them.
  A behaviour that differs from the Nest adapter needs a decision in the design.
- Port every case of `<id>.spec.ts` and `anchor.spec.ts`, named after the case in snake case, and keep the fixture values.
  A case whose count changes because the runtime sends one update per market per frame says so in a short comment.
- Loader tests feed a reply trimmed from the venue's live reply of 2026-10-01 through the pure parse function and assert the markets, including one inactive row, one dated row and one row of every family the venue lists.
- Keep the split of decision 1: the fetch is a thin async wrapper, and the parse is a plain function the tests call.
- Logging follows root [`AGENTS.md`](../../AGENTS.md) section 3: a loader logs one `catalog_read` line, a poller cache refresh logs one line, and a venue error frame logs at error with the connection id.
- Comments follow root [`AGENTS.md`](../../AGENTS.md) sections 1 and 2, and the crate keeps them to what the code needs.
- Run `cargo test` from `server/` before a task is Done.
  The laptop had about 3 GB of free memory on 2026-10-01 and `/tmp` is memory backed, so only one cargo build runs at a time and no build directory goes under `/tmp`.

## Tasks

### 1. `price_scale` on `Market`, decision 8

- `server/src/engine/cluster.rs`: add `pub price_scale: f64` to `Market`, after `contract_size`.
- `server/src/engine/cluster/index_builder.rs:75`: multiply `bid_mul` and `ask_mul` by `market.price_scale`, divide `size_mul` by it, and add a test that a scale of 10 lands in all three.
- Add `price_scale: 1.0` to every other `Market` literal: `orchestrator.rs`, `pipeline_tests.rs`, `index_builder.rs` tests, `ladder_walk.rs`, `anchor_reading.rs`, `engine/engine/tests.rs`, `opportunity_manager/tests.rs`, `venue_feed/tests.rs` and `anchor_poller/tests.rs`.

### 2. reqwest gzip, decision 10

- `server/Cargo.toml`: `reqwest` features become `["json", "gzip"]`.

### 3. `venues/wire.rs`, decisions 11 and 12

- `number`, which reads a decimal string as an `f64` and anything unparseable as NaN, and `nan`, the default of a missing field.
- `num`, a `deserialize_with` function that reads a decimal string, a JSON number or a null into an `f64`.
- `levels`, a `deserialize_with` function that reads an array of level arrays into `Vec<BookLevel>`, taking the first two entries of each as price and size through `num` and skipping the rest.
- Tests for each, including an exponent string, an empty string, a null, a four entry okx level and a three entry mexc level.

### 4. `venues/catalog.rs`, decisions 6, 9 and 13

- `currency_code(id, venue_table)` returns the code: uppercase, then the venue table, then the base table of `XBT` to `BTC` and `BCHSV` to `BSV`.
- `contract_size(size)` reads a size that is not a positive number as 1, as the Nest connector read it.
- `finish(venue_id, name, rows, markets, denied)` returns the `Venue`: it removes each denied raw id and logs `market_denied` with its reason, logs `market_price_scaled` for every scaled market and one `catalog_read` line, and fails a venue left with no market.
- Tests for all three.

### 5. `Connection` test harness, decision 15

- `server/src/feeds/venue_feed.rs`, one `#[cfg(test)] impl<S: Default> Connection<S>` block:
  `for_test(id, markets)` builds a connection whose market i sits in cluster i and opens it,
  `take_published()` returns each published book as `(raw id, bids, asks)` cut to the engine's depth, in publish order, and clears the marks,
  `resync_requested()` reads the flag,
  `take_sent()` drains the queued replies.

### 6. Registry arms and live tests, decisions 15, 17 and 18

- `server/src/venues/mod.rs`: declare `wire`, `catalog` and one module per venue, add one arm per venue in `load_venue` and in `start_venue`, and drop the `#[allow(dead_code)]` on `start`.
- `server/src/venues/testing.rs`, `#[cfg(test)]`: market builders, and `MockRest`, a local axum host that answers each path and query with what a case set, 404 for anything else, can delay or hold a reply, and records every request in order.
- `server/src/venues/live_tests.rs`, `#[cfg(test)]`, every test `#[ignore]`:
  `live_catalog` loads every venue named in `LIVE_VENUES`, a comma list in the environment that defaults to all ten, and prints one line per market: id, base, quote, linear, contract size, taker ppm and price scale,
  `live_smoke` starts each venue in `LIVE_VENUES` through `start_venue` on every market it lists, with a stand-in engine channel, for `LIVE_SECONDS` seconds, default 90, and prints per venue the markets that never got a book, crossed tops, stale events, anchor rounds and the tracked markets the anchors never carried.
  `live_smoke` fails when a market never gets a book, when a top is crossed, when a stale event arrives, or on any `frame_handle_failed`, `venue_panicked`, `venue_error`, `book_resync`, `markets_unplanned` or `plan_market_refused`.
  It also prints the books that never showed both sides and the first line of every warning kind.

### 7 to 11. The five running venues

Each task writes `server/src/venues/<id>.rs`, `server/src/venues/<id>/anchor.rs`, `server/src/venues/<id>/markets.rs` and `server/src/venues/<id>/tests.rs`, from the Nest adapter and the design's tables.

- 7, binance: two families on two hosts, the diff and snapshot channels, the window rule, the 24 h retirement, the hourly `fundingInfo` table behind a lock, and the `ONUSDT` and `ONEUSDT` denials.
- 8, bybit: two families, `u` chaining, the JSON ping, the 2 s poll, the 10 min rate limit pause, and cursor paging in the loader.
- 9, okx: `seqId` chaining with the equal pair heartbeat, the text ping and pong, the 400 ms stagger, the three anchor calls and the hourly instruments table behind a lock, the `BB-USDT-SWAP` and `QNT-USDT-SWAP` denials, and the scale of 10 on `ANTHROPIC-USDT-SWAP` and `OPENAI-USDT-SWAP`.
- 10, krakenfutures: `seq` chaining per product, object levels, the funding division by the mark, the linear only filter, and `XBT` to `BTC`.
- 11, coinbase: the connection wide `sequence_num`, the subscriptions check against `conn.markets()`, no ping, the INTX anchor on a 2 s poll, and `-INTX` ids.

### 12. Catalog parity for the five

- Run `LIVE_VENUES=binance,bybit,okx,krakenfutures,coinbase cargo test live_catalog -- --ignored --nocapture`.
- On the same minute, dump CCXT 4.5.68's `loadMarkets` for each venue the way [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/c642b40e4d0648c13ef30f666f5d76ebb9fd6d53/old_ts_server/src/ccxt/connector.ts) built markets, with the filters, fees and pinned sizes of [`registry.ts`](https://github.com/nemanull/arbitrage-observatory/blob/c642b40e4d0648c13ef30f666f5d76ebb9fd6d53/old_ts_server/src/venues/registry.ts).
  CCXT 4.5.68 sits in the pnpm store under `node_modules/.pnpm/`, and its `dist/ccxt.cjs` loads with a plain `require`.
- Diff id, base, quote, linear and contract size.
  The expected differences are the four denied markets, and the two scaled okx markets differ only in `price_scale`.
- Anything else is either fixed or written into the design with its reason.

### 13. Live smoke for the five

- Run `LIVE_VENUES=binance,bybit,okx,krakenfutures,coinbase LIVE_SECONDS=90 cargo test --release live_smoke -- --ignored --nocapture`.
- Pass means every market got a book, no top was crossed, no stale event arrived, no frame failed to parse, and every tracked market got an anchor row or a known reason for having none.

### 14. Test run

- `cargo build --release`, then copy `server/target/release/server` to `server/target/test-run/server`, so later builds never replace the running file.
- Run it from `server/` with `RUST_LOG=info` and an empty `OTEL_EXPORTER_OTLP_ENDPOINT`, because SigNoz was not running on 2026-10-01, and write the console to `logs/2026-10-01-rust-test-run.log` at the repository root.
- Rows land in the local Postgres on port 5532, after the 84 rows already there, whose highest id was 2820.
- Health at 2, 10 and 30 minutes:
  - boot logs five `venue_loaded`, five `venue_tracked`, five `feed_started`, five `anchor_poll_started` and one `orchestrator_started`,
  - zero `frame_handle_failed`, `venue_panicked`, `plan_market_refused` and `markets_unplanned`,
  - every `book_unserved` explained,
  - `book_resync` and `feed_reconnecting` counted per venue, and any more than a few an hour investigated,
  - `anchor_poll_summary` per venue with `written` near tracked markets times rounds and `missing` explained,
  - `engine_summary` with `max_queue_lag_ms` read and `queued` near zero,
  - `opportunities_written` present and no `opportunity_write_failed`.
- The run keeps going after the 30 minute check, and the final report gives its process id and the `kill -INT` that stops it with a clean flush.

What the run showed, started at 19:57:57 UTC on 2026-10-01 as process 3606931:

- Boot loaded the five venues, 802 binance, 873 bybit, 493 okx, 204 krakenfutures and 131 coinbase markets, built 706 clusters, and streamed 2,094 markets: 667, 674, 451, 178 and 124.
- At 33 minutes the engine applied 666,000 to 1,217,000 books a minute, with a worst queue lag of 3 to 10 ms and an empty queue at every summary.
- Every poller ran 60 rounds a summary with no failed round, no missing row and no rejected reading, and bybit's 2 s rounds averaged 529 to 687 ms.
- One binance socket was reset by the venue at 20:00:57 and reopened 1.1 s later, and no other socket closed.
- The open gate refused 505 crosses as standing basis, 57 on a moving anchor, 6 as too young and 1 as a thin book, including the scaled okx ANTHROPIC and OPENAI crosses.
- Two rows were written, ids 2821 and 2822, with no write failure, which ran the writer's insert against Postgres for the first time: a 4.4 s kraken side SYN dislocation and a 1 ms IWM flicker.
- The process held 49 MB and about half a core.

### 15 to 19. The five later venues

The same four files per venue, from the Nest adapter, with an arm in both match statements and no entry in `ACTIVE_VENUES`.

- 15, gate: the USDT socket only, `full` pushes, `U` chaining, id only deltas, the JSON ping with the time in seconds, the one call poller with its 10 s pause, and gate's currency table.
- 16, bitget: two instTypes chosen by quote, ten arguments a frame a second apart, `pseq` chaining and resets, two calls per product type, the `takerFeeRate` warning of decision 7, and bitget's currency table.
- 17, mexc: one contract per subscribe frame 50 ms apart, whole book pushes with the `version` guard, the binary frame warning, code 510 as `RateLimited` with reason `code 510`, the `apiAllowed` filter, and mexc's currency table.
- 18, bitstamp: one channel per frame, whole book pushes with the `microtimestamp` guard, `bts:request_reconnect` as a resync, the 60 s first book wait, the ticker plus one funding read per round with the ts cap, and the markets call.
- 19, gemini: one socket on `wss://ws.gemini.com/?snapshot=-1`, the first frame per symbol as the snapshot, `U` and `u` per symbol, the request id counter in the connection state, riskstats per market with the cadence rule, and the funding refresh that runs beside the rounds on a spawned task, one request at a time.

### 20. Catalog parity and live smoke for the later five

- Tasks 12 and 13 with `LIVE_VENUES=gate,bitget,mexc,bitstamp,gemini`.
- Gemini's smoke runs at least 90 s, because its poll is 3 s or longer and its funding refresh is one market at a time.
- All ten catalogs matched CCXT, and every smoke passed except the explained cases in the design's last section: mexc's six unopened stock perpetuals and coinbase's empty books.
- Gemini's first smoke failed every handshake with `400 Bad Request` until the socket URL gained its `/`.

### 21. Reconcile

- Audit the design and this plan against the code, edit every claim that changed, and set every status.
- Re-resolve every `file:line` citation in both docs against the final code.
- Move both docs to [`implemented/`](../implemented/) and update [`README.md`](../README.md).
