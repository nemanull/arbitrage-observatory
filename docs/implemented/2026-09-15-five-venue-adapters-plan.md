# Five venue adapters, implementation plan

Implements [`2026-09-15-five-venue-adapters-design.md`](./2026-09-15-five-venue-adapters-design.md).
Decision numbers below refer to that design.

## Scope guard

This work does not:

- Add any venue to `activeVenues` in [`orchestrator.ts`](../../server/src/orchestrator.ts), or start a feed or a poller in a real run.
- Change `DENIED_PAIRS`, `PRICE_SCALE`, the quote family, the anchor reader, `Engine`, `OpportunityManager` or the database.
- Add a REST book seed, a socket anchor, or a rate limit rule for HTTP 400 bodies.
- Change the behaviour of the existing five venues beyond the `book_unserved` warning of decision 8.
- Commit anything.
  The user commits.

## Status

| task | owner | status |
|---|---|---|
| 1. Shared changes | main session | Done |
| 2. Gate | agent 1 | Done |
| 3. Bitget | agent 2 | Done |
| 4. MEXC | agent 3 | Done |
| 5. Bitstamp | agent 4 | Done |
| 6. Gemini | agent 4 | Done |
| 7. Registry entries | main session | Done |
| 8. Verification | main session | Done |
| 9. Reconcile | main session | Done |

## Rules for the venue tasks

- A venue task edits only `server/src/venues/<id>/`.
  A change a venue needs outside its folder is reported back, not made.
- The registry entry is written in task 7, so a venue task never edits [`registry.ts`](../../server/src/venues/registry.ts).
- Frame and reply shapes come from the venue's profile, and a spec fixture is a captured frame cut down to the fields the code reads plus one it ignores, as [`bybit/anchor.spec.ts`](../../server/src/venues/bybit/anchor.spec.ts) does.
- Where the profile and the live wire disagree, the wire wins, and the report names the difference.
- Tests run on explicit paths with `--runInBand --forceExit`, never the whole suite, because the machine runs out of memory.
  A shared lock file serializes jest, `tsgo` and the live smoke across agents.
- Code follows the comment and prose rules of the root [`AGENTS.md`](../../AGENTS.md): comments only for intent or a non-obvious fact, one sentence per line, no arrows.
- Every feed and poller keeps the existing logs, and adds none on the hot path.

## Tasks

### 1. Shared changes

`server/src/ccxt/types.ts` and `server/src/ccxt/connector.ts`, decisions 3 and 4:

- Add `ignoreCcxtTakerPpm?: boolean` and `contractSize?: number` to `VenueConnectorOptions`.
- `isExpectedCcxtTakerPpm` returns true when `ignoreCcxtTakerPpm` is set.
- `toMarket` uses the pinned `contractSize` when it is set.
- `connector.spec.ts`: a MEXC style catalog with mixed CCXT fees logs no fee warning, and a pinned size wins over CCXT's.

`server/src/shared/errors.ts`, `server/src/feeds/anchor/types.ts` and `server/src/feeds/anchor/AnchorPoller.ts`, decisions 5 and 6:

- Add `RateLimitReplyError` with `url`, `code`, `rateLimited` true and `retryAfterMs` null.
- `AnchorRow` accepts an optional `ts`, and `apply` writes `row.ts ?? ts`.
- `failed` pauses on `RateLimitReplyError` as it does on a rate limited `HttpStatusError`.
- `AnchorPoller.spec.ts`: a row carrying `ts` keeps it while its neighbour gets the arrival time, and a `RateLimitReplyError` pauses for `rateLimitPauseMs`.

`server/src/feeds/book/VenueFeed.ts`, decisions 7 and 8:

- Add `subscribeGapMs` of 0 and `firstBookWaitMs` of 10,000 as protected fields.
- `onOpen` sends the first frame at once and the rest from one interval timer pushed onto `c.timers`, which checks the socket is open before each send.
- After the last frame plus `firstBookWaitMs`, one timer logs `book_unserved` with `connection`, `missing`, `markets` and a sample of three ids, when any market of the plan holds no book.
- New `VenueFeed.spec.ts`: frames without a gap all go out on open, frames with a gap go out one per gap, a closed socket stops the rest, and `book_unserved` names only the markets with no book.

### 2. Gate, decisions 10 to 12

Files: `server/src/venues/gate/gate.ts`, `anchor.ts`, `types.ts`, `gate.spec.ts`, `anchor.spec.ts`.
Sources: [`gate/websocket.md`](../profiles/gate/websocket.md) sections 4, 6 and 8, and [`gate/rest.md`](../profiles/gate/rest.md) sections 2, 3, 6 and 8.

- `GateFeed`: plans of 150, stream `ob.<rawMarketId>.50` routed back through `result.s`, `full` resets, the `U` chain, id only deltas still advance `u`, `futures.ping` every 15 s with the `time` field in seconds, `maxSilenceMs` 45,000, error frames logged.
- `GateAnchorPoller`: the contracts call, the pre market and status skips, seconds to hours and seconds to ms, `rateLimitPauseMs` 10,000.
- Specs: snapshot then chained delta, a gap resyncs, a delta before a snapshot resyncs, an unsubscribed stream is dropped, subscribe frame shape and slice size, ping frame, and a poller round mapping a live row, a pre market row and a non trading row.

### 3. Bitget, decisions 13 to 15

Files: `server/src/venues/bitget/bitget.ts`, `anchor.ts`, `types.ts`, `bitget.spec.ts`, `anchor.spec.ts`.
Sources: [`bitget/websocket.md`](../profiles/bitget/websocket.md) sections 4, 5, 6 and 8, and [`bitget/rest.md`](../profiles/bitget/rest.md) sections 2, 3, 6 and 8.

- `BitgetFeed`: plans of 50 per `instType`, frames of 10, `subscribeGapMs` 1,000, `connectStaggerMs` 1,000, text `ping` every 25 s, bare `pong` ignored before parsing, `maxSilenceMs` 60,000, snapshot resets, `pseq` chain on parsed numbers, error events logged.
  The first build read `seq` and `pseq` from the raw text as digit strings, and the main session's review replaced that with the parsed numbers, see the design's rejected alternatives.
- `BitgetAnchorPoller`: tickers and funding joined on `symbol`, USDC calls only while a USDC market is tracked, `code` check.
- Specs: frame sizes and `instType` per quote, snapshot then chained update, `pseq` gap and `pseq` 0 resync, `pong` text, and a poller round joining the two replies with a symbol missing from one of them.

### 4. MEXC, decisions 16 to 18

Files: `server/src/venues/mexc/mexc.ts`, `anchor.ts`, `types.ts`, `mexc.spec.ts`, `anchor.spec.ts`.
Sources: [`mexc/websocket.md`](../profiles/mexc/websocket.md) sections 4, 5, 6 and 8, and [`mexc/rest.md`](../profiles/mexc/rest.md) sections 2, 3, 6 and 8.

- `MexcFeed`: plans of 150, one `sub.depth.full` frame per contract with `limit` 20, `subscribeGapMs` 50, `{"method":"ping"}` every 15 s, `maxSilenceMs` 45,000, whole book resets, lower `version` dropped, `rs.error` logged, binary frames logged once and dropped.
- `MexcAnchorPoller`: the funding rate call, the `success` and `code` check, code 510 as `RateLimitReplyError`.
- Specs: one frame per contract, a whole book frame, an older version dropped, a poller round, a `success` false round, and code 510 raising `RateLimitReplyError`.

### 5. Bitstamp, decisions 19 to 21

Files: `server/src/venues/bitstamp/bitstamp.ts`, `anchor.ts`, `types.ts`, `bitstamp.spec.ts`, `anchor.spec.ts`.
Sources: [`bitstamp/websocket.md`](../profiles/bitstamp/websocket.md) sections 3, 4, 5, 6 and 8, and [`bitstamp/rest.md`](../profiles/bitstamp/rest.md) sections 2, 3, 4, 6 and 8.

- `BitstampFeed`: one plan, one `bts:subscribe` frame per market, whole book resets, `microtimestamp` guard, `bts:heartbeat` every 20 s, `maxSilenceMs` 60,000, `firstBookWaitMs` 60,000, `bts:request_reconnect` closes with reopen, `bts:error` logged.
- `BitstampAnchorPoller`: ticker plus one funding market per round, the ticker `timestamp` as `ts` capped at arrival, interval 8, `next_funding_time` in ms, markets without a funding reading left out, a failed funding request logged once per market and not failing the round.
- Specs: a whole book frame, an older `microtimestamp` dropped, the reconnect request, spot ticker rows ignored, the rotation over three rounds, the `ts` cap, and a 404 on one funding market.

### 6. Gemini, decisions 22 to 24

Files: `server/src/venues/gemini/gemini.ts`, `anchor.ts`, `types.ts`, `gemini.spec.ts`, `anchor.spec.ts`.
Sources: [`gemini/websocket.md`](../profiles/gemini/websocket.md) sections 4, 5, 6 and 8, and [`gemini/rest.md`](../profiles/gemini/rest.md) sections 2, 3, 4 and 6.

- `GeminiFeed`: one plan, one subscribe frame, first `depthUpdate` per symbol resets, then the `U` and `u` rule, application ping every 20 s, `maxSilenceMs` 60,000, non 200 replies logged.
- `GeminiAnchorPoller`: parallel `riskstats` with per row arrival stamps, `intervalMs` from the tracked market count, background funding refresh of at most one market per round, usable funding rule, rows left out without usable funding, round fails only when every `riskstats` failed.
- Specs: first frame resets, a straddling frame applies, an old frame is dropped, a gap resyncs, interval for 6 and for 2 markets, a round with one failed `riskstats`, a round where every request failed rethrowing a 429, and the funding refresh choosing the oldest or past dated reading.

### 7. Registry entries

`server/src/venues/registry.ts`: one entry per venue with the values of decisions 10, 13, 16, 19 and 22, and a comment per non-obvious value in the style of the existing entries.

### 8. Verification

- `npx tsgo -p tsconfig.json --noEmit` from `server/`, which covers the specs as well, was clean.
- `npx eslint` and `npx prettier --check` on `src/venues`, `src/feeds`, `src/ccxt` and `src/shared/errors.ts` were clean.
- Jest on explicit paths, one group at a time, with `--runInBand --forceExit`: `src/ccxt src/feeds` 37 tests, `src/venues` 193 tests, `src/engine` 157 tests, all passing.
- Each venue's live smoke result is recorded in the design's verification section.
  The smoke scripts lived outside the repository and are not kept.

### 9. Reconcile

- Re-read both docs against the code, fix every decision that shipped differently, and re-resolve every `file:line` citation.
- Move both docs to [`implemented/`](../implemented/) and update [`README.md`](../README.md).

## Before a venue is activated

These checks come from the research and belong to the activation of each venue, not to this work.

- Every venue: a ticker collision survey against the running five, and a first run audited for one sided, empty and delisted book frames, which no probe observed.
- Gate: decide on the baskets that are mostly Gate or a third or more its own perpetual, `NES_USDT`, `EDGE_USDT`, `SCRT_USDT`, `SPACEHOOD_USDT`, `TAIKO_USDT`, `GT_USDT` and `FONE_USDT`, see [`gate/rest.md`](../profiles/gate/rest.md) section 4, and the 3 % mark cap on TradFi contracts.
- Bitget: decide on legs whose basket holds `BITGET_FUTURE` at a weight of 0.3 or more, such as `UBUSDT` at 0.87, see [`bitget/rest.md`](../profiles/bitget/rest.md) section 4.
- MEXC: re-read the API fee announcement, decide on `YMTCSTOCK_USDT` and `KIMISTOCK_USDT`, whose only index source is `MEXC_FUTURE`, and settle whether `priceCoefficientVariation` caps the mark, see [`mexc/rest.md`](../profiles/mexc/rest.md) section 4.
- Bitstamp: refuse legs of the seven market hours contracts while their index is the venue's own oracle, and check whether `GOLD` and `SILVER` price the same quantity as Coinbase's, see [`bitstamp/rest.md`](../profiles/bitstamp/rest.md) section 4.
- Gemini: settle whether the mark is clamped at about 0.05 %, and read `failed` in `anchor_poll_summary` to see whether a burst of 6 parallel `riskstats` stays inside the public limit, see [`gemini/rest.md`](../profiles/gemini/rest.md) sections 4 and 6.
- Bitstamp and Gemini: run across an hour and a settlement, since the funding refresh after each settlement and the known limits in the design's last section were exercised only by specs.
