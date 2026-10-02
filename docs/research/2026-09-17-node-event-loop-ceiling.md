# The Node event loop ceiling, and the fifth run crash that reached it

Date: 2026-09-17.
Every timestamp in this document is UTC.

This is the complete record of one fact: the observatory server runs on one thread, that thread has a measured ceiling, and on 2026-09-15 a market wide flash crash pushed the venues' message rate past it.
It gathers every measurement of the ceiling and every measurement of the crash into one place, with the date, the host, the method and the number of each, so that the limits of a single Node process can be shown from evidence rather than asserted.
It answers one question: what does a saturated Node event loop look like from inside a market data pipeline, and how was that state reached and proven.

It draws on these documents, which hold the primary tables:

- [`./2026-09-17-fifth-run-loop-saturation.md`](./2026-09-17-fifth-run-loop-saturation.md), the reading of the fifth run's sample clocks and logs that placed the cause inside the process.
- [`../audits/2026-09-15-fifth-run-data-audit.md`](../audits/2026-09-15-fifth-run-data-audit.md), the row audit of the fifth run, which fitted the lag against the venues' trade tapes.
- [`./2026-09-07-depth-stream-scaling.md`](./2026-09-07-depth-stream-scaling.md), the pipeline probe that measured the per message cost and the ceiling.
- [`./2026-09-06-venue-depth-endpoints-probe.md`](./2026-09-06-venue-depth-endpoints-probe.md), the earlier load probe with `JSON.parse` alone.
- [`./2026-09-15-binance-realtime-depth.md`](./2026-09-15-binance-realtime-depth.md), the measurement of the binance diff channel that raised the baseline.

Two things remain unmeasured and are listed in section 14: the home server's own event loop metrics for the crash minutes, which were exported to SigNoz and never read, and the WebSocket close codes of the binance sockets, which the feed drops.

## 1. The answer

Between 18:37:01 and 18:37:54, and again between 18:45:42 and 18:49:26, the server's single event loop was busy without pause.
Frames arrived faster than the thread could decrypt, frame, parse and apply them, so the excess waited in the kernel's receive buffer of each socket and, once that buffer was full, in the venue's own send queue.
On every turn of the loop the thread took the sockets that had data in a fixed order and worked through up to two mebibytes of each one's backlog before it touched the next, because nothing in the read path yields once a chunk has been handed to JavaScript.
One round over the sockets took 380 to 640 ms, every book advanced in bundles and stood still between rounds, and the slow channels fell one to almost four seconds behind the venues while the two busiest binance sockets were closed by the far side and came back with fresh snapshots.
Every book was stamped with the time the thread processed the frame rather than the time the venue sent it, so a leg that was three seconds stale looked as fresh as a leg that was current.
Thirty four of the run's 66 rows opened inside those two windows, and each of them is a stale leg on one venue held against a current leg on another.
The ceiling that was reached had been measured ten days earlier at 34,000 to 38,000 messages a second on the laptop's core, the quiet hour baseline sits at about 14,000, and a market wide crash multiplies the rate three to five times.

## 2. What runs on the one thread

Node executes JavaScript on one thread and drives its I/O from the same thread through libuv.
In this server the following work all runs there, in the order a frame meets it.

- Socket reads and TLS decryption, inside libuv's read callback and Node's `TLSWrap`, described in section 3.
- WebSocket framing and unmasking in the `ws` package, which the feed opens at [`VenueFeed.ts:81`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts) with `perMessageDeflate: false`.
- The feed's message entry at [`VenueFeed.ts:200`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts), which stamps `lastMessageAt`, resets the reconnect attempt at [`VenueFeed.ts:206`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts) and calls the venue's `handleMessage`.
- `JSON.parse` on the frame text, at [`binance.ts:110`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/venues/binance/binance.ts), [`bybit.ts:82`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/venues/bybit/bybit.ts) and [`okx.ts:71`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/venues/okx/okx.ts) for the three busiest venues.
- The book apply, a snapshot reset or a delta merge into the feed's sorted book, then `publish` at [`VenueFeed.ts:283`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts), whose `now` parameter defaults to `Date.now()` at that moment.
- `Engine.updateBook` at [`Engine.ts:115`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/engine/Engine.ts), which writes the top of book and `recvTs` into the cluster arrays and calls `validate` at [`Engine.ts:202`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/engine/Engine.ts).
- The open gates, the discovery scan and the sample write in `recordSample` at [`OpportunityLifecycle.ts:226`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/engine/opportunity/OpportunityLifecycle.ts), which runs on every book update that changes a top price in the pair's cluster.
- The queue write of a closed row at [`OpportunityLifecycle.ts:476`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/engine/opportunity/OpportunityLifecycle.ts), which serialises the row and hands it to the Redis client on this thread.
- The anchor pollers' rounds, started by `setInterval` at [`AnchorPoller.ts:56`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/anchor/AnchorPoller.ts), whose HTTP responses are read, decrypted and parsed on this thread as well.
- The one second sweep at [`orchestrator.ts:22`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/orchestrator.ts).
- The OpenTelemetry exporters, which serialise logs, traces and metrics every 30 s per [`otel.ts:20`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/observability/otel.ts).
- The `OpportunityWorker` that drains the queue, which is a provider of the same Nest application, so its job handling and its database writes also run here, although it never touches a cluster.
- Garbage collection of everything the above allocates, whose pauses land on this thread.

What does not run on it is short.
The libuv threadpool carries DNS lookups and file system calls, and it would carry zlib inflation if permessage-deflate were negotiated, but deflate is refused at [`VenueFeed.ts:81`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts).
TLS is not on the threadpool in Node, the record layer runs inside the event loop thread.

## 3. How a frame becomes a book

The chain below is the verified read path of Node v24.18.0 with `ws` 8.21.1, which is what the fifth run ran.
Each step names the function and where it was read.

1. The loop blocks in `epoll_pwait` inside `uv__io_poll` in [deps/uv/src/unix/linux.c](https://github.com/nodejs/node/blob/v24.x/deps/uv/src/unix/linux.c), with an array of 1,024 event slots.
   When it returns, the function walks the ready descriptors in array order and calls each watcher's callback before it re-polls, and it re-polls without blocking only when the array came back full.
2. For a TCP socket the callback is `uv__stream_io`, which calls `uv__read` in [deps/uv/src/unix/stream.c](https://github.com/nodejs/node/blob/v24.x/deps/uv/src/unix/stream.c) when the descriptor is readable.
3. `uv__read` loops up to `count = 32` times, under the comment "Prevent loop starvation when the data comes in as fast as (or faster than) we can read it".
   Each iteration asks the alloc callback for `64 * 1024` bytes, calls `read()`, and hands the bytes to the read callback synchronously.
   It returns early after a short read, under the comment "Save a system call and return if we didn't fill the buffer completely".
   So one readable event on one socket delivers up to 32 reads of 64 KiB, which is 2 MiB, before the loop moves to the next ready descriptor.
4. Node's `LibuvStreamWrap::OnUvAlloc` in [src/stream_wrap.cc](https://github.com/nodejs/node/blob/v24.x/src/stream_wrap.cc) allocates the buffer through `EmitAlloc`, and `OnUvRead` ends with `EmitRead`, synchronously into the next layer.
5. For a TLS socket the next layer is `TLSWrap::OnStreamRead` in [src/crypto/crypto_tls.cc](https://github.com/nodejs/node/blob/v24.x/src/crypto/crypto_tls.cc), which commits the ciphertext and calls `Cycle`, which calls `ClearOut`.
   `ClearOut` loops `SSL_read` into a buffer of `kClearOutChunkSize`, which is 16,384 bytes in [src/crypto/crypto_tls.h](https://github.com/nodejs/node/blob/v24.x/src/crypto/crypto_tls.h), and calls `EmitRead` for every cleartext chunk until `SSL_read` returns nothing.
   There is no read state check inside that loop in v24, so every record that the ciphertext can complete is delivered before `ClearOut` returns, and a JavaScript `pause()` only prevents the next libuv read.
6. `EmitRead` reaches `onStreamRead` in [lib/internal/stream_base_commons.js](https://github.com/nodejs/node/blob/v24.x/lib/internal/stream_base_commons.js), which calls `push` on the `TLSSocket`.
   In flowing mode with a `'data'` listener and an empty internal buffer, `addChunk` in [lib/internal/streams/readable.js](https://github.com/nodejs/node/blob/v24.x/lib/internal/streams/readable.js) emits `'data'` synchronously.
7. The `'data'` listener is `socketOnData` in `ws`'s [lib/websocket.js](https://github.com/websockets/ws/blob/8.21.1/lib/websocket.js), which calls `receiver.write(chunk)` and would call `socket.pause()` if that write returned false.
8. The `Receiver` in [lib/receiver.js](https://github.com/websockets/ws/blob/8.21.1/lib/receiver.js) is a `Writable` whose `_write` pushes the chunk and runs `startLoop`.
   `startLoop` parses every complete frame in the buffered bytes and, with `allowSynchronousEvents` at its client default of true, emits `'message'` for each one synchronously, then calls the write callback.
9. The `'message'` listener is the feed's `onMessage` at [`VenueFeed.ts:200`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts), then the venue's `handleMessage`, `JSON.parse`, the book apply, `publish`, `Engine.updateBook`, `validate`, and `recordSample` when a top price changed.

Two consequences follow from the chain, and both were confirmed in the sources rather than assumed.

First, there is no backpressure.
`Writable.write` in [lib/internal/streams/writable.js](https://github.com/nodejs/node/blob/v24.x/lib/internal/streams/writable.js) computes its return value after `_write` has run, and because `startLoop` calls the write callback synchronously, `state.length` is already back to zero when the comparison against the high water mark happens.
The write returns true for a chunk of any size, `socket.pause()` never runs, and the default high water mark of 65,536 bytes on Linux since Node 22, from [lib/internal/streams/state.js](https://github.com/nodejs/node/blob/v24.x/lib/internal/streams/state.js), never enters the picture.
The only per socket cap per loop turn is libuv's 32 reads, and every chunk that arrives is parsed to its last complete frame, with every handler and every `JSON.parse`, before the next ready socket's callback runs.
The kernel absorbs everything the thread cannot take, silently, in the socket's receive buffer.

Second, there is no arrival timestamp.
Node's `net` module and libuv's TCP handle expose no `SO_TIMESTAMP` or `SO_TIMESTAMPING` option, and the TCP wrap in [src/tcp_wrap.cc](https://github.com/nodejs/node/blob/v24.x/src/tcp_wrap.cc) offers only `setNoDelay`, `setKeepAlive`, `setTypeOfService` and their reads.
A `Date.now()` taken anywhere in the chain is the time the thread got to the frame, not the time the frame reached the machine.

## 4. What saturated means, precisely

Node defines event loop utilization in [perf_hooks](https://nodejs.org/docs/latest-v24.x/api/perf_hooks.html) as the share of time the loop spends outside its event provider, which on Linux is `epoll_wait`.
A utilization of 1.0 means the loop never blocked waiting for events, because there was always work ready.

The queueing statement is simple.
Let the arrival rate be the frames per second the venues send, and let the service cost be the loop time one frame takes from `read()` to the end of its handlers.
While arrival rate times service cost stays under one second per second, the loop finishes each frame before the next arrives, sits in `epoll_wait` between frames, and the processing stamp equals the arrival time to within a millisecond.
Once arrival rate times service cost exceeds one second per second, the loop never returns to `epoll_wait` with nothing ready, the excess accumulates in the kernel buffers, and the queueing delay of each frame grows until something upstream gives way.
A kernel receive buffer is bounded by the socket's window, so once it is full the receiver advertises zero and the rest of the backlog waits in the venue's send queue, where the venue decides whether to hold it or to drop the client.

Under that condition the shape of the processing is fixed by section 3.
Every turn of the loop finds every socket readable, walks them in the order the ready array holds them, and takes up to 2 MiB from each before moving on.
The frames of one venue therefore arrive at the engine in one contiguous bundle, then the next venue's, then the next, and the venues never interleave inside a turn.
The order repeats on every turn because the ready set is the same and the array order is stable while every socket stays readable.
The period of one pass equals the service time of one round over all the backlogs, plus whatever timers and callbacks were queued behind them.
Every book stamp is late by the time its frame waited in the kernel buffer plus the time it waited inside the turn behind the sockets served before it.

Saturated is not stalled.
A stalled loop is blocked on one long synchronous task and emits nothing for its duration.
A saturated loop is never blocked and never idle.
It emits continuously, at the ceiling rate, and the audit at [`../audits/2026-09-15-fifth-run-data-audit.md`](../audits/2026-09-15-fifth-run-data-audit.md) section 2a correctly found "the process was not stalled" because no gap of 150 ms passed without a sample from some row, and it correctly called the pattern "a per socket backlog and not a blocked loop".
The research at [`./2026-09-17-fifth-run-loop-saturation.md`](./2026-09-17-fifth-run-loop-saturation.md) then placed the cause of the per socket backlog inside the process.
Both statements are true at once, and the point a reader most easily gets wrong is that a loop can be at 100 percent and still produce a sample every few milliseconds.

## 5. The ceiling measurements, in order

### 5.1 The engine hot path, 2026-08-01

This benchmark is recorded in a working note and is not written up anywhere under [`docs/`](../).
It ran on Node 24 with 400 assets across 5 venues, one million pregenerated layer 1 messages, and five rounds.
The quote write and evaluate path, which is `onQuote` and the discovery evaluation, measured about 60 ns per message, which is 0.3 percent of one core at 50,000 messages a second.
Call shape was measurement noise at 57 to 85 ns across free functions, class methods, deep property chains, getters and private fields.
Allocation was what cost: a composite string map key per message was 6.5 times the baseline, an `await` in the write path 2.4 times, and nested `Map` objects instead of typed arrays 1.6 to 2.3 times.
`JSON.parse` of one layer 1 tick measured about 200 ns and dominated the engine's own path.
What it settled is that the engine's arithmetic is not where the loop's time goes, and section 5.3 shows the byte path costs about 400 times more per message.

### 5.2 The universe load probe with `JSON.parse` alone, 2026-09-07 about 02:00

Script: [`../../scripts/probes/ws-depth-load-probe.mjs`](../../scripts/probes/ws-depth-load-probe.mjs), recorded in [`./2026-09-06-venue-depth-endpoints-probe.md`](./2026-09-06-venue-depth-endpoints-probe.md) section 2b.
It subscribed every live perpetual on the five venues to their depth channels with Node's built in `WebSocket`, parsed every message, and kept no books.
Across the universe it saw 16,230 messages a second and 97.5 ms of `JSON.parse` per second, which the doc summarises as "`JSON.parse` alone is about a tenth of one core".
The event loop delay did not move.
It settled that parsing the whole universe fits one core with room to spare at that hour's rate, and it gave the higher of the two rate figures every later extrapolation uses.

### 5.3 The pipeline probe, 2026-09-07 23:35 to 23:55

Script: [`../../scripts/probes/ws-depth-pipeline-probe.mjs`](../../scripts/probes/ws-depth-pipeline-probe.mjs), recorded in [`./2026-09-07-depth-stream-scaling.md`](./2026-09-07-depth-stream-scaling.md).
Host: the development laptop, a 12th generation i7 with 20 hardware threads and 31 GB of RAM, with about 24 GB of swap in use, which affects wall clock figures and not process CPU.
Method: every live perpetual on the five venues, 2,269 markets on 18 connections, through the `ws` package the feeds use, once with permessage-deflate negotiated and once with it refused.
Every message was decoded, parsed, applied to a maintained sorted book where the venue sends deltas, and its top twenty levels copied into a flat block laid out like the engine's depth arrays.
The probe measured the handler time split into parse, apply and copy, process CPU, event loop delay, and RSS over a twenty second window after a five second settle.

| venue and channel | messages per second, deflate on | µs per message in the handler, deflate on | messages per second, deflate off | µs per message in the handler, deflate off |
|---|---:|---:|---:|---:|
| binance `depth20@100ms` | 1,347 | 35.1 | 1,559 | 36.3 |
| bybit `orderbook.50` | 3,270 | 9.0 | 3,633 | 9.2 |
| okx `books` | 1,108 | 11.9 | 1,229 | 11.4 |
| krakenfutures `book` | 2,391 | 4.6 | 2,735 | 3.7 |
| coinbase `level2` | 213 | 14.8 | 237 | 15.3 |
| total | 8,328 | 12.5 | 9,393 | 12.5 |

Process CPU was 43.8 percent of one core with deflate and 24.6 percent without.
Event loop delay sat at its 5 ms sampling floor in both runs, p50 5.0 to 5.1 ms, p99 5.9 to 6.0 ms, max 6.9 to 10 ms, so the loop never queued.
RSS was 173 to 185 MB with a 33 to 42 MB heap in the first run, and 252 MB with a 52 to 66 MB heap in the second with the first run's books still resident.
A second pair of runs ten minutes later split the process time by thread with `process.threadCpuUsage`: with deflate the loop thread took 32.7 percent of a core over 8,252 messages a second, and without it 22.3 percent over 7,621.

| quantity | value |
|---|---:|
| handler time per message, parse plus apply plus copy | 12.5 to 13.5 µs, parsing 73 percent of it |
| event loop time per message, deflate refused | 26 to 29 µs |
| event loop time per message, deflate negotiated | about 40 µs |
| process time per message, deflate negotiated | 53 to 54 µs |
| one event loop at 100 percent, deflate refused | 34,000 to 38,000 messages a second |
| one event loop at 100 percent, deflate negotiated | about 25,000 messages a second |
| one event loop at a 60 percent budget, deflate refused | 20,000 to 23,000 messages a second |

The gap between the handler's 12.5 µs and the loop's 26 to 29 µs is TLS decryption, WebSocket framing, the buffer to string decode, garbage collection and timers.
The 60 percent budget was a choice, not a measurement, and the doc gave its reason in section 5.3 of that file: queueing on the loop silently moves the engine's clock.
Only 8 percent of depth messages moved a best bid or ask, so the engine's discovery ran on 700 to 850 ticks a second while the byte path carried the whole 9,393.
What it settled is the per message cost of the byte path and the ceiling of one loop, and it named the clock as the reason to stay well under it.

### 5.4 The binance diff channel, 2026-09-15 00:20 to 01:10

Recorded in [`./2026-09-15-binance-realtime-depth.md`](./2026-09-15-binance-realtime-depth.md), run from the development laptop.
One sixty second run subscribed 571 binance USD-M perpetuals to both `@depth@0ms` and `@depth20@100ms` on three connections of 200 markets.
It received 268,223 diff frames, which is 4,470 a second and 1,484 KB a second, and 96,363 snapshot frames, which is 1,606 a second and 1,663 KB a second, with zero sequence breaks.
The gap between consecutive diff events on one symbol was 26 ms at p10, 30 ms at p50 and 256 ms at p90, so the diff channel is a 30 ms cadence and not one frame per book change.
Process CPU, including the probe's own bookkeeping, was 37 percent of one core for binance alone.
What it settled is that the merge of the two channels is sound and that binance's frame rate would rise about fourfold when it shipped, from about 1,600 to about 6,100 a second at 571 markets.

### 5.5 The baseline after the diff channel shipped, derived

This is arithmetic on 5.3 and 5.4, not a measurement.
Take the deflate refused run of 5.3 at 23:40, replace its binance `depth20` figure of 1,559 with the 6,076 frames a second of 5.4, and keep the other venues.

| venue | frames per second |
|---|---:|
| binance, diff plus snapshot | 6,076 |
| bybit | 3,633 |
| krakenfutures | 2,735 |
| okx | 1,229 |
| coinbase | 237 |
| total | 13,910 |

At 26 to 29 µs per message that is 36 to 40 percent of the laptop's core at a quiet hour.
At the 02:00 rates of 5.2, which were 1.95 times the 23:40 rates on the same channels, the four non binance venues scale to about 15,300, and with binance's 6,076, which was itself measured near 01:00, the total is about 21,000 frames a second, or 55 to 62 percent of that core.
The margin between a quiet hour and the ceiling is therefore about 2.5 times, and between a busy hour and the ceiling about 1.7 times.

### 5.6 The crash bound

The message rate is not a constant of the subscription.
Each venue's channel has a cadence per market that only fires when the market changes, and in a market wide crash every market changes on every tick.
The bound below multiplies each cadence by the markets the fifth run streamed.

| stream | markets streamed | cadence | frames per second if every market moves | source of the cadence |
|---|---:|---|---:|---|
| bybit `orderbook.50` | 659 | one frame per 20 ms per changed market | 32,950 | [`bybit.ts:18`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/venues/bybit/bybit.ts) |
| binance `@depth@0ms` | 652 | about one frame per 30 ms per active market | 21,733 | section 5.4 |
| binance `@depth20@100ms` | 652 | ten frames a second per market | 6,520 | [`binance.ts:25`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/venues/binance/binance.ts) |
| okx `books` | 434 | one 400 level frame per 100 ms per changed market | 4,340 | [`okx.ts:12`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/venues/okx/okx.ts) |
| krakenfutures `book` | 247 | one delta per level change, unbounded | 2,700 at the quiet baseline | section 5.3 |
| coinbase `level2` | 124 | per change | 237 at the quiet baseline | section 5.3 |

The bounded streams alone sum to 65,543 frames a second against a ceiling of 34,000 to 38,000.
Bybit's bound on its own is close to the ceiling.
Half of the bound is past it.
A crash does not need to reach the bound, it needs to multiply the 14,000 baseline by three to five, and that is what a market wide flash crash is.
The home server's core is not the laptop's, so its ceiling is lower or higher by a factor nobody has measured, and section 14 says how to measure it.

## 6. The fifth run: process, host and instrumentation

- One process on the home server, pid 31488, `orchestrator_started` at 06:56:37.901 and `orchestrator_stopped` at 23:43:09.113 on 2026-09-15, 16 hours and 46 minutes.
- Boot built 694 clusters across 5 venues and denied four pairs as non comparable.
- Markets streamed: bybit 659 of 852, binance 652 of 782, okx 434 of 479, krakenfutures 247 of 275, coinbase 124 of 131, which is 2,116 markets.
- Gates in force: `MIN_NET_PPM` 5,000 on the raw cross and the fresh edge, `MAX_ANCHOR_MOVE_PPM` 1,000 per poll, `MIN_EDGE_NOTIONAL` 1,000 quote units, `MIN_CROSS_AGE_MS` 100, and `CLOSURE_NET_PPM` 1,000.
- It was the first run on the home server, the first with the minimum cross age of [`../plans/2026-09-15-minimum-cross-age-design.md`](../plans/2026-09-15-minimum-cross-age-design.md), and the first with the binance diff channel of [`../plans/2026-09-15-binance-realtime-depth-design.md`](../plans/2026-09-15-binance-realtime-depth-design.md).
- The home server runs SigNoz and its ClickHouse on the same box as the process, so the telemetry stack competes for the same cores.
- Its CPU model, core count and `tcp_rmem` are unknown, because the box did not answer on 2026-09-17.
- The OpenTelemetry runtime instrumentation at [`otel.ts:60`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/observability/otel.ts) exports `nodejs.eventloop.delay.min`, `.max`, `.mean`, `.stddev`, `.p50`, `.p90`, `.p99` and `nodejs.eventloop.utilization` every 30 s per [`otel.ts:20`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/observability/otel.ts), per the [instrumentation-runtime-node README](https://github.com/open-telemetry/opentelemetry-js-contrib/blob/main/packages/instrumentation-runtime-node/README.md).
  Those series exist for the whole run and nobody has read them.
- The log export read for the research is 60,437 lines from the audited process, carries `attributes_string` only, and so holds no numeric attribute, which is why the poll durations and refusal numbers come from a second export of `attributes_number` read over ssh for the audit.
- The rows were imported into the laptop table with an id offset of 2,754 and are ids 2755 to 2820, 66 rows, each matching an `opportunity_closed` line within 2 ms.

## 7. The crash timeline

All on 2026-09-15.

| time | event | source |
|---|---|---|
| 17:36:02 | okx anchor summary 77.7 s after the previous one, 17.7 s beyond nominal, with no crash and no row | loop saturation research, section 3 |
| 17:36:30 | bybit anchor summary 140.0 s after the previous one, 20.0 s beyond nominal | same |
| 18:37 minute | market wide flash drop with recovery inside the minute: binance ETHUSDT open 2419.41, low 2371.50, close 2410.01 on 186,731 ETH against 5,452 to 16,743 ETH in each of the four minutes before, BTCUSDT 76,468.6 to 75,813.1, kraken PF_ETHUSD low 2360.5 | audit, section 2a |
| 18:37 minute | one minute ETH lows under the open: 1.98 percent binance, 2.25 okx, 2.02 bybit, 2.43 kraken, and RAVE 5.7 percent, STX 4.3 to 5.2, OP 2.8 to 3.1, KAITO 2.0 to 2.2, AERO 1.6 to 2.0, every venue printing each drop in the same second | audit, section 2a |
| 18:37:00.528 | last okx RAVE print at or above 0.1797 | audit, section 2a |
| 18:37:01 | saturation window 1 opens | loop saturation research, section 1 |
| 18:37:01.649 | RAVE 2779 and 2780 open on an okx bid of 0.1797 that holds to 18:37:02.257, while okx printed 1,874 trades of 0.1743 to 0.1793 during 18:37:01 | audit, section 2a |
| 18:37:05 | SPX 2781 opens, bundles still at most six changes with 80 to 100 ms between binance and bybit | loop saturation research, section 2 |
| 18:37:09.428 to 09.450 | fourteen taker sells consume a 20,180 STX kraken bid placed at 14:35:30, the one cross that existed on the venues' clocks, lasting about 25 ms | audit, section 2a |
| 18:37:09.863 | STX 2788 opens, 413 ms after that bid was gone | audit, section 2a |
| 18:37:10.144 to 10.659 | KAITO 2784, OP 2782, AERO 2795 and OP 2785 open on okx and kraken bids that their tapes had left one to three seconds earlier | audit, section 2a |
| 18:37:10 to 18:37:16 | eight to twelve rows open, no gap over 157 ms without a sample, the longest silence at 18:37:16.410 | audit, section 2a |
| 18:37:11.669 | ETH 2787 opens on a kraken bid of 2406.6 while kraken had printed 2367.8 at 18:37:12.000 | audit, section 2a |
| 18:37:11.5 to 18:37:16.5 | the pass measurement window, passes starting 839, 1,384, 2,020, 2,433, 2,829, 3,212 and 3,592 ms after 18:37:11.5 | loop saturation research, section 2 |
| 18:37:15.302 | far side closes `binance#linear#0` for the first time, 13.7 s after the first burst row and 5.2 s after the 18:37:10 cluster, one row closes as `feed_down` | loop saturation research, section 3, and audit, section 2a |
| 18:37:16.649 | second `feed_down` close | loop saturation research, section 3 |
| 18:37 to 18:38 | first wave of binance reconnect cycles | same |
| 18:37:40.737 | third `feed_down` close | same |
| 18:37:54 | saturation window 1 ends | loop saturation research, section 1 |
| 18:40 to 18:41 | second wave of reconnect cycles | loop saturation research, section 3 |
| 18:41:25.439 | fourth `feed_down` close | same |
| 18:42:58 | okx summary 75.5 s apart, 15.5 s beyond nominal | same |
| 18:43:16 | bybit summary 136.6 s apart, 16.6 s beyond nominal | same |
| 18:43:24 | kraken summary 75.7 s apart, 15.7 s beyond nominal | same |
| 18:45 | second leg of the crash: BTC 75,745 to 75,312, MARSCOIN 3.7 percent, C 3.4 percent | audit, section 2a |
| 18:45:42 | saturation window 2 opens | loop saturation research, section 1 |
| 18:45:42.8 to 18:45:47 | second leg bundle measurement, kraken 3 bundles a median 324 ms apart, binance 14 bundles 133 ms apart | loop saturation research, section 2 |
| 18:46 to 18:47 | third wave of reconnect cycles | loop saturation research, section 3 |
| 18:46:20 | okx summary 77.7 s apart, 17.7 s beyond nominal | same |
| 18:47:30 | bybit summary 134.4 s apart, 14.4 s beyond nominal | same |
| 18:49:04.9 to 18:49:08 | third leg bundle measurement, bybit 7 bundles a median 302 ms apart | loop saturation research, section 2 |
| 18:49:05.09 | bybit and okx bottom IOST, binance's deeper wick arrives 1.7 s later, IOST 2811, 2812 and 2813 are that one wick | audit, section 2a |
| 18:49:08.010 | far side closes `binance#linear#0` again | audit, section 2a |
| 18:49 to 18:51 | fourth wave of reconnect cycles | loop saturation research, section 3 |
| 18:49:26 | saturation window 2 ends | loop saturation research, section 1 |
| 18:50:53 | coinbase summary 135.1 s apart, 15.1 s beyond nominal | loop saturation research, section 3 |
| 18:52:25 | last reconnect of `binance#linear#1`, its 47th | same |
| 18:53 and 18:56 | fifth and sixth waves | same |
| 18:56:46.739 | last reconnect of `binance#linear#0`, its 146th | same |

Pauses between the waves ran 79 to 272 s.

## 8. Measurement A: the pass structure from the sample clocks

Method, from [`./2026-09-17-fifth-run-loop-saturation.md`](./2026-09-17-fifth-run-loop-saturation.md) sections 2 and 8.
A sample is written on every book update that changes a top price in the pair's cluster, at [`OpportunityLifecycle.ts:226`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/engine/opportunity/OpportunityLifecycle.ts), with `now` taken from `publish` at [`VenueFeed.ts:283`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts), which is `Date.now()` when the frame was processed.
The sample clock of an open row is therefore a trace of when the thread handled each venue's frames.
A leg change is a sample where that leg's price differs from the previous sample, attributed to the leg's venue.
A bundle is a run of changes with no gap over 30 ms.
A pass is a run of bundles with no gap over 120 ms.
The rows were read from the laptop table with `sampleTsMs`, `highestBidSeries`, `lowestAskSeries` and `openedAt`.

Row 2787, ETH krakenfutures-binance, holds 120 samples over 2,307 ms.
82 percent of them share a millisecond with another sample, and the largest same millisecond group is 18.
Its kraken bid changed in six bundles of a median 18 changes each, 410 ms apart, with no change between bundles.

Taking each row's leg changes between 18:37:11.5 and 18:37:16.5 and attributing each change to its venue gives 46 adjacent bundles of different venues, and none of them overlap in time.
They come in a fixed cycle: okx, then kraken, then binance, then bybit.
The okx bundle that opens each cycle starts 839, 1,384, 2,020, 2,433, 2,829, 3,212 and 3,592 ms after 18:37:11.5, which is a pass period of 545, 636, 413, 396, 383 and 380 ms.

| pass, ms after 18:37:11.5 | okx bundle | kraken bundle | binance bundle | bybit bundle |
|---|---|---|---|---|
| 839 | 839 to 867, 10 changes on 6 pairs | 870 to 882, 26 changes on ETH, OP, STX | 932 to 1,056, 16 changes | 1,060 to 1,292, 19 changes |
| 1,384 | 1,384 to 1,419, 14 changes | 1,431 to 1,449, 26 changes on ETH, OP, STX | 1,553 to 1,706, 15 changes | 1,759 to 2,011, 29 changes |
| 2,020 | 2,020 to 2,025, 4 changes | 2,035 to 2,051, 40 changes on ETH | 2,116 to 2,239, 18 changes | 2,268 to 2,425, 24 changes |
| 2,433 | 2,433 to 2,439, 5 changes | 2,445 to 2,448, 13 changes on ETH | 2,491 to 2,605, 10 changes | 2,669 to 2,803, 16 changes |

Kraken's ETH, OP and STX changes come from three different rows and land inside one 12 to 18 ms bundle whenever they change on the same pass.
Across 18:37:09.5 to 18:37:17 the nearest bundle of another venue starts a median 18 ms from each kraken bundle and a median 30 ms from each okx bundle.
The bundles fill most of each pass: 453 of the 545 ms of the first pass, 627 of 636 of the second, 405 of 413 of the third.
The remainder is frames that changed no open row's leg, the anchor pollers' responses, the sweep and the queue writes, none of which the sample clock can see.

The quiet hours show what normal looks like.

| window | venue | bundles | median gap between bundles | largest bundle |
|---|---|---:|---:|---:|
| ACE 2761, 08:49:29 to 08:49:57 | binance | 160 | 117 ms | 8 |
| ACE 2761 | bybit | 145 | 120 ms | 9 |
| LSK 2770, 13:15:19 to 13:15:31 | binance | 101 | 102 ms | 9 |
| LSK 2770 | bybit | 103 | 82 ms | 4 |
| AXL 2759, 08:33:59 to 08:34:15 | binance | 101 | 106 ms | 6 |
| burst, 18:37:09.5 to 18:37:17 | kraken | 8 | 561 ms | 40 |
| burst | okx | 24 | 227 ms | 14 |
| burst | bybit | 31 | 176 ms | 35 |
| burst | binance | 31 | 137 ms | 18 |
| second leg, 18:45:42.8 to 18:45:47 | kraken | 3 | 324 ms | 14 |
| second leg | binance | 14 | 133 ms | 29 |
| third leg, 18:49:04.9 to 18:49:08 | bybit | 7 | 302 ms | 19 |

In a quiet hour the bundles are the venues' own cadence, about 100 ms apart and never above nine changes.
In the burst the same venues bundle four times larger and three to five times further apart.

The first rows of the crash show a milder shape.
RAVE 2779 and 2780 at 18:37:01.6 and SPX 2781 at 18:37:05 have bundles of at most six and 80 to 100 ms between binance and bybit bundles, so at that moment the loop was loaded but not yet at half second passes, and the 1.7 s okx lag the audit fitted on RAVE may be partly okx's own batching under load.
From 18:37:10 the shape is unambiguous.

Two other explanations were considered and do not fit.
A network link that stalls and resumes delivers every flow interleaved after the stall, in arrival order, not one venue after another in the same order on every pass.
A venue's own batching under load can delay its own frames, but frames from two venues that share nothing but our process cannot line up in lockstep 12 to 30 ms apart on every pass.
Ordered, non overlapping bundles in a fixed cycle are the event loop of section 3 reading one socket's slice to the end before it takes the next.

## 9. Measurement B: the timers

The anchor pollers are the process's only periodic clock that the log export preserves.
Each poller starts a `setInterval` at its venue's interval at [`AnchorPoller.ts:56`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/anchor/AnchorPoller.ts), one second by default and two seconds on bybit and coinbase.
A tick that finds the previous round still in flight increments `skipped` at [`AnchorPoller.ts:90`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/anchor/AnchorPoller.ts) and returns without starting a round.
A round is one HTTP request for the venue's whole ticker set, with a 10 s timeout at [`AnchorPoller.ts:8`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/anchor/AnchorPoller.ts), and its duration is measured from the tick's `Date.now()` to the reply's arrival.
A summary line is written every 60 completed rounds per [`AnchorPoller.ts:11`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/anchor/AnchorPoller.ts).

So the spacing between two summaries is 60 intervals plus one interval for every tick that found a round in flight, plus the lateness of the timer itself.
Over the run the spacing sits at a median of 60.0 s with a p90 of 60.3 to 61.1 s on the one second pollers, and at 120.0 s with a p90 of 120.2 to 121.9 s on the two second pollers.
In the loaded minutes it did this.

| summary at | poller | spacing | seconds beyond nominal |
|---|---|---:|---:|
| 17:36:02 | okx | 77.7 s | 17.7 |
| 17:36:30 | bybit | 140.0 s | 20.0 |
| 18:42:58 | okx | 75.5 s | 15.5 |
| 18:43:16 | bybit | 136.6 s | 16.6 |
| 18:43:24 | kraken | 75.7 s | 15.7 |
| 18:46:20 | okx | 77.7 s | 17.7 |
| 18:47:30 | bybit | 134.4 s | 14.4 |
| 18:50:53 | coinbase | 135.1 s | 15.1 |

The audit's numeric export adds the durations: in hour 18 every venue's `maxMs` reached 6,600 to 8,100 ms with 314 skipped rounds, against 63 of 1,007 minutes across the run with any venue over 3,000 ms.

Why one HTTP round takes seven seconds on a saturated loop follows from section 3.
The reply arrives as bytes on one more socket in the ready set, and its `'data'` and `'end'` callbacks run in array order behind the venue sockets' slices, so a reply that spans several passes waits several passes.
Its body is the venue's whole ticker set, hundreds of markets of JSON, and the parse runs on the same thread behind the same queue.
The timer that starts the next round is also late by the same queueing, because timers fire only when the loop returns to its timer phase.
A round that outlives its tick is skipped, and the skipped ticks are what stretched the summaries by 15 to 20 s.

Every poller slowed in the same minutes.
The pollers talk to five different venues over five different HTTP connections, so a slowdown on all of them at once has a local cause, and the only thing they share is the thread.
The 17:36 entries show the same lateness with no crash and no row, so the loop was loaded outside the crash as well.

## 10. Measurement C: the binance sockets

The counts.
`binance#linear#0` reconnected 146 times between 18:37:15.302 and 18:56:46.739.
`binance#linear#1` reconnected 47 times until 18:52:25.
`binance#linear#2` and `#3` never reconnected.
The client's own idle kill fired once all day, on bybit at 11:15:38, and never on binance.

The cycle anatomy.
The reconnect delay is `RECONNECT_BASE_MS * 2 ** (attempt - 1)` capped at the maximum, plus a random jitter of up to 250 ms, at [`VenueFeed.ts:357`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts), which at attempt 1 is 500 to 750 ms and matches the observed 640 ms.
The attempt resets to 0 on any received message at [`VenueFeed.ts:206`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts), and the connection URL already carries the first market's two streams, so data arrives before the subscribe acknowledgements and every reconnect line at [`VenueFeed.ts:372`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts) says attempt 1.
The backoff never grew, and each closed socket had been served before it died.
All four subscribe acknowledgements arrived within 20 ms of each other about 1.2 s after the socket opened.
The next close came a median 0.92 s later, p10 0.46 s, p90 2.10 s.
The socket open to the first acknowledgement took 1.17 s in the storm and 0.94 to 1.54 s on the 33 reconnects of the quiet hours, so the handshake itself was not slowed.
A full cycle is 2.81 s, and the cycles came in waves at 18:37 to 18:38, 18:40 to 18:41, 18:46 to 18:47, 18:49 to 18:51, 18:53 and 18:56, with pauses of 79 to 272 s between them, following the market's activity.
The same shape ran for 8 to 11 cycles at 13:34, 13:39 and 14:35 with no crash and no row, so the far side closes a fresh socket of this size on its own now and then, and hour 18 is that shape sustained for nineteen minutes.

The local causes, excluded one by one from the feed code.

- The silence watch terminates a socket after 240 s without a message per [`binance.ts:30`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/venues/binance/binance.ts), logs `no traffic`, and cannot fire within a second of a socket that just received data.
- The 23 hour refresh retires a socket before binance's 24 hour cap, logs `retiring the socket`, and cannot fire on a socket a second old.
- `stop()` logs `stopping` and sets `running` false, so no reconnect line could follow it.
- The resync path that terminates a socket on a sequence gap is not used by the binance feed, which logs `book_desync` and drops the symbol's state instead.
- An open failure logs `open failed` and terminates before any subscribe.
- A `ws` protocol error would log through the error handler, and no error line sits in the window.

Nothing local fits a silent close about a second after the acknowledgements.
The far side closed the socket.

What the logs cannot say is how.
The close handler at [`VenueFeed.ts:95`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts) is `socket.on('close', () => this.onClose(c))`, which drops the close code and reason that `ws` passes.
A TCP reset after the upgrade is swallowed by `ws`, which destroys the socket and emits a plain close with the default code 1006.
So a clean close frame from binance and a reset from anywhere on the path look identical in our logs, and "clean close" is not provable from this export.
The absent close code is the gap, and it is one line to fill.

The TCP mechanics that make a fresh socket die first.
The kernel doc [ip-sysctl](https://docs.kernel.org/networking/ip-sysctl.html) gives `tcp_rmem` a default of 131,072 bytes and says "This value results in initial window of 65535", and the laptop reads `4096 131072 6291456` with `tcp_moderate_rcvbuf` at 1.
With autotuning on, "TCP performs receive buffer auto-tuning, attempting to automatically size the buffer (no greater than tcp_rmem[2]) to match the size required by the path for full throughput", and the tuning runs from the read path, with the kernel's own comment in [net/ipv4/tcp_input.c](https://github.com/torvalds/linux/blob/master/net/ipv4/tcp_input.c) that "DRS is always one RTT late".
A socket the application does not drain keeps its 128 KB.
When the buffer is full the receiver advertises a zero window, and [RFC 9293 section 3.8.6.1](https://www.rfc-editor.org/rfc/rfc9293.html#section-3.8.6.1) says the sender "MUST allow the connection to stay open" while the receiver keeps acknowledging its probes, so TCP itself never gives up.
The sender's own send buffer then fills, and per [send(2)](https://man7.org/linux/man-pages/man2/send.2.html) "send() normally blocks, unless the socket has been placed in nonblocking I/O mode" and otherwise fails with `EAGAIN`.
What happens next is the sending application's policy, a write deadline or an outbound queue cap followed by a close, and binance's stack and its limits are not published.

Binance's documented limits, from the [USD-M Connect page](https://developers.binance.com/docs/derivatives/usds-margined-futures/websocket-market-streams/Connect), verbatim:

- "A single connection is only valid for 24 hours; expect to be disconnected at the 24 hour mark".
- "The websocket server will send a `ping frame` every 3 minutes. If the websocket server does not receive a `pong frame` back from the connection within a 10 minute period, the connection will be disconnected."
- "WebSocket connections have a limit of 10 incoming messages per second."
- "A connection that goes beyond the limit will be disconnected; IPs that are repeatedly disconnected may be banned."
- "A single connection can listen to a maximum of **1024** streams."

The page says nothing about slow consumers, backpressure or close codes.
Our client sends four subscribe frames at open and one ping every 30 s, under the 10 a second limit, and `ws` answers binance's pings automatically.
The one statement from binance on the subject is from a staff member on 2020-09-24 at [dev.binance.vision](https://dev.binance.vision/t/one-potential-reason-for-websocket-abnormal-disconnection/667): "if server is trying push too many data and client is reading not fast enough, it will lead to an unstable connection."
Community reports of the same shape, depth streams on many symbols dropping under load, all show code 1006 with no close reason, at [dev.binance.vision 2428](https://dev.binance.vision/t/depth-websockets-keep-closing-1006-but-not-clientside/2428), [unicorn-binance-websocket-api issue 113](https://github.com/LUCIT-Systems-and-Development/unicorn-binance-websocket-api/issues/113), [dev.binance.vision 11781](https://dev.binance.vision/t/socket-connections-dropped/11781) and [ccxt issue 7858](https://github.com/ccxt/ccxt/issues/7858).
By contrast a subscribe burst over the rate limit gets an explicit 1008 "Too many requests", per [nautilus_trader issue 5012](https://github.com/nautechsystems/nautilus_trader/issues/5012), so binance does send a code when a documented limit is hit.

Why `#0` and `#1` died within a second while `#2` and `#3` lived.
A reconnected socket came up with a 128 KB receive buffer and a 64 KB window, and within about 1.2 s it was subscribed to 400 streams on 200 markets that included BTC and ETH, at crash rates.
The snapshot channel alone is about ten frames a second per market, so that socket's share of the stream filled the window in tens of milliseconds, while the loop's pass over all sockets took 380 to 640 ms.
The socket sat at zero window for most of each pass, the autotuning saw little data copied to user space, the buffer never grew, and binance's outbound queue for that connection hit its limit within about a second.
`#2` and `#3` had been read continuously for hours, so their buffers had autotuned toward the maximum, which is 6 MB on the laptop, and could absorb a whole pass even at crash rates.
Every reconnect restarted at 128 KB and immediately received 200 fresh snapshots, which is why the cycle repeated 146 times until the market calmed.
That the two dying sockets also carried the heaviest markets is plausible and not verified.
One more consequence for the logs: if binance sent a close frame, it could not be delivered until we read the socket, so our close timestamp is when the thread drained the socket, not when binance decided.

What each cycle cost the engine.
The close handler at [`VenueFeed.ts:217`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts) clears the timers, deletes 200 books and calls `markStale` at [`Engine.ts:245`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/engine/Engine.ts) on the plan's 200 markets, which zeroes their `recvTs` and closes every route on them.
The reopen costs a TLS handshake, four subscribe frames, and a burst of 200 fresh snapshots applied and published onto the already saturated loop.
Each cycle leaves 200 markets with `recvTs` 0 for at least the 640 ms delay plus the 1.2 s to the acknowledgements, about 1.8 s.
Four rows closed as `feed_down` at 18:37:15.302, 18:37:16.649, 18:37:40.737 and 18:41:25.439.
Five rows are the binance socket itself: 1000LUNC 2792 opened 84 ms before `#0` closed and has one sample, ESPORTS 2798 opened 802 ms after `#1` was reseeded and died when that socket closed 206 ms later, and IOST 2811, 2812 and 2813 are the one wick of 18:49:05.

## 11. Measurement D: the lag against the venues' tapes

The audit fitted each lagging leg's sample series to the venue's own trade tape with a time shift, from live probes of binance aggTrades, okx history trades and 1 s candles, kraken executions and OHLC, and bybit 1 m klines on 2026-09-16 between 00:55 and 01:20.

| row | leg | the row showed | the venue's tape said |
|---|---|---|---|
| 2787 ETH krakenfutures-binance | kraken bid | 2406.6 at 18:37:11.669, walking down to 2386.0 by 18:37:13.976 | last print at or above 2405 at 18:37:09.458, prints of 2376.0 to 2383.4 during 18:37:11, 2367.8 at 18:37:12.000 |
| 2787 ETH krakenfutures-binance | binance ask | 2378.49 from 18:37:11.669 to 12.545 | 826 taker buys down to 2374.91 in that window, then 657 down to 2371.51 while the row held 2378.37 |
| 2784 KAITO okx-binance | okx bid | 0.2912 from 18:37:10.144 to 12.370 | last print at or above 0.2912 at 18:37:09.182, 655 prints of 0.2858 to 0.2880 during 18:37:10 |
| 2782 OP okx-binance | okx bid | 0.09778 at 18:37:10.502 | prints at or above 0.09778 only from 18:37:08.070 to 09.432, 0.09628 to 0.097 during 18:37:10 |
| 2785 OP krakenfutures-binance | kraken bid | 0.09757 from 18:37:10.659, 0.09747 from 12.973 | six kraken prints in 35 s, a sell at 0.0976 at 18:37:04.000, then taker sells at 0.09586 and 0.09662 at 18:37:13.000 |
| 2779 and 2780 RAVE okx | okx bid | 0.1797 from 18:37:01.649 to 02.257 | last print at or above 0.1797 at 18:37:00.528, 1,874 prints of 0.1743 to 0.1793 during 18:37:01 |
| 2795 AERO okx-bybit | okx bid | 0.535 to 0.5351 from 18:37:10.608 to 12.367 | last taker sell at or above 0.5349 at 18:37:09.357, 0.5286 to 0.5325 during 18:37:10 |
| 2788 STX krakenfutures-binance | kraken bid | 0.25237 from 18:37:09.863 to 12.398 | a 20,180 STX bid placed at 14:35:30, consumed by 14 taker sells between 18:37:09.428 and 09.450 |

The fits: the okx legs sit 1.1 to 3.7 s behind their tape, KAITO 3.1 s, AERO 3.7 s, RAVE 1.7 to 1.8 s and OP 1.2 s.
The kraken legs sit 2.2 to 2.9 s behind.
The binance legs of ETH, OP and STX sit about 1 s behind, and the binance legs of KAITO, RAVE, MARSCOIN and C track their tape within 0.1 to 0.7 s.
Why the lag differed by venue is not settled by this data, and one reading fits every number above, so it is recorded here as a reading and not a finding.
Each socket's receive buffer is bounded by its window, which autotuning had sized to that socket's quiet hour rate: close to a megabyte a second on each binance socket, and a tenth to a quarter of that on each kraken and okx socket, per the rates in section 5.3.
Between two passes a venue can deliver at most one window of bytes, and everything past that waits in the venue's own send queue.
A crash multiplies every venue's rate, so the kraken and okx sockets, with small windows and frames of 122 to 384 bytes, could queue seconds of frames at the venue, while a binance socket, with a large window and kilobyte frames, held under a second of its stream before the far side's queue limit closed it and a fresh snapshot reset its lag to zero.
The reading predicts that the lag orders by window size against crash byte rate, and it is checked by reading each socket's `rcv_space` with `ss -tmi` on the home server during a busy hour, or directly by the exchange timestamps once repair 1 of section 15 carries them onto the book.

The classes of the 66 rows, after the loop saturation research folded the four kraken rows of the first window into the lag class.

| class | rows |
|---|---:|
| opened inside a saturation window | 34 |
| standing basis, the gate margin class | 22 |
| kraken far side rows outside the windows | 2 |
| sub second flashes | 7 |
| one nine second convergence | 1 |

Each of the 34 is the lagging leg's pre crash price against the current leg's post crash price.
In a minute where ETH fell two percent and RAVE almost six, a leg two seconds stale is a spread of thousands of parts per million that never existed at any single instant.

## 12. Why no gate could see it

- The book clock is ours.
  [`VenueFeed.ts:283`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts) stamps the book with `Date.now()` at processing, [`Engine.ts:202`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/engine/Engine.ts) hands that stamp to validation as `recvTs`, and the only checks on it are `recvTs <= 0` at [`OpportunityManager.ts:322`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/engine/opportunity/OpportunityManager.ts) and [`OpportunityManager.ts:346`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/engine/opportunity/OpportunityManager.ts), which skip a slot that has never been written or was marked stale.
  A backlog shifts every book's clock by the backlog, and nothing compares one leg's clock to the other's or to the venue's.
- The sample clock is the same clock.
  Every `sampleTsMs`, every duration and the minimum cross age of [`../plans/2026-09-15-minimum-cross-age-design.md`](../plans/2026-09-15-minimum-cross-age-design.md) were measured in half second steps during the windows.
  A cross first seen on one pass was 380 to 640 ms old on the next pass, so the 100 ms age gate confirmed every cross that survived one pass, and the audit counted 394 crosses it refused over the whole run at a median age of 33 ms.
- The anchor gate went blind.
  `anchor_moving` wrote 232 refusal lines in the 18:37 minute, 2,799 of the 5,032 samples on the 66 rows, 55.6 percent, were blind because a poll inside the row moved more than 1,000 ppm, and a blind sample closes nothing, which is how AERO 2795 ran 5 s at 4,000 to 5,000 ppm raw.
- The venues' own clocks were available and unused.
  Every frame from every venue carries an exchange timestamp, and the one cross the venues' clocks did show, the STX bid at 18:37:09.43, lasted about 25 ms and was gone 413 ms before the row opened.
- The direct instrument existed and was never read.
  The runtime metrics of section 6 would have shown utilization near 1 and delay in the hundreds of milliseconds in the crash minutes.

This is the class of [`../bestiary/lagging-view.md`](../bestiary/lagging-view.md), and the safeguard it needs is the first one of [`../backlog/2026-09-15-open-gate-safeguards.md`](../backlog/2026-09-15-open-gate-safeguards.md).

## 13. What this says about Node

Each limit below is tied to the measurement that showed it.

1. One thread parses.
   Parsing is 73 percent of the handler's 12.5 µs in section 5.3, V8 runs `JSON.parse` synchronously on the calling thread, and Node ships no off thread JSON parser.
   No arrangement of the code inside one process changes where that time is spent.
2. The byte path costs 400 times the engine.
   The engine's write and evaluate path is about 60 ns per message in section 5.1, and the loop's byte path is 26 to 29 µs per message in section 5.3.
   Engine optimisation is irrelevant to the ceiling, and the ceiling is a property of TLS, framing and parsing on one thread.
3. No backpressure reaches the application.
   Section 3 shows that `ws` never pauses the socket because the receiver acknowledges every chunk synchronously, and section 10 shows the kernel absorbing the excess until the far side closed the socket.
   The process had no signal that it was behind, and its first symptom was a venue dropping it.
4. No arrival timestamp exists.
   Section 3 shows that `net` exposes none, so every clock in the engine, `recvTs`, `sampleTsMs`, `openedAt`, `durationMs` and the cross age, is the processing clock, and section 12 shows what that cost.
5. Timers are late by the same queueing delay.
   Section 9 shows the anchor pollers' one second timer stretching to seven second rounds and 314 skipped ticks, and the sweep at [`orchestrator.ts:22`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/orchestrator.ts) runs on the same timer phase, so the engine's clocks, its polls and its sweeps all degrade together and in proportion.
6. The only honest instrument is event loop utilization.
   Section 6 shows it was exported every 30 s for the whole run and never read, and section 8 shows what it takes to reconstruct the same fact from sample clocks after the event.
7. The margin is thin.
   Section 5.5 puts the quiet hour baseline at about 2.5 times under the ceiling and the busy hour at 1.7 times, and section 5.6 shows a crash is a three to five times multiplier with a bound near twice the ceiling.
   The binance diff channel of section 5.4 spent part of that margin eight days before the run.
8. Fifty venues do not fit one loop.
   Section 3a of [`./2026-09-07-depth-stream-scaling.md`](./2026-09-07-depth-stream-scaling.md) puts the fifty venue universe at 55,000 to 107,000 messages a second and 1.4 to 3.1 loop cores without compression, which is three to six pair shards.

Three remedies exist in principle, and every concrete fix in section 15 is one of them.
Fewer frames, by subscribing to a slower snapshot channel or dropping a redundant one.
Cheaper frames, by refusing compression, which is done, or by parsing less of each frame, which V8 does not offer.
More threads, by sharding the pairs across worker threads or processes, each with its own loop, its own feeds and its own engine.
Sharding is out of scope for now by the decision recorded in [`./2026-09-17-fifth-run-loop-saturation.md`](./2026-09-17-fifth-run-loop-saturation.md) section 6, that fifty venues is a rewrite and the Node server stays at five.

## 14. What was not measured, and how to close each gap

1. The home server's event loop metrics.
   Query `signoz_metrics` for `nodejs.eventloop.utilization`, `nodejs.eventloop.delay.p99`, `nodejs.eventloop.delay.max` and `v8js.gc.duration` from 18:30 to 19:00 on 2026-09-15, against 08:00 to 09:00 the same day as a baseline, and 17:30 to 17:40 for the pre crash load.
   Utilization near 1 and a delay in the hundreds of milliseconds in the crash minutes is the direct measurement of sections 4 and 8.
2. The close codes.
   Repair 4 of the audit: log the code and reason on the close handler at [`VenueFeed.ts:95`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts), one line, so a close frame and a reset stop looking the same.
3. The log export.
   The file the loop saturation research read is not on the laptop on 2026-09-17, so every per line figure in sections 7, 9 and 10 is carried from that document and was not re-derived here.
4. The home server's hardware and kernel.
   `nproc`, the CPU model, and `/proc/sys/net/ipv4/tcp_rmem`, to place the ceiling of section 5.3 on that core and to size the initial window of section 10.
5. The anchor rounds' durations.
   `signoz_traces` holds the HTTP client spans of the anchor polls in hour 18, which carry the round durations the string export lost.
6. The box's own load.
   ClickHouse's `system.asynchronous_metric_log`, if enabled, for `LoadAverage1` and `OSIdleTime` in the crash minutes, which separates a saturated core from a process starved by the telemetry stack that shares it.

## 15. Remedies, ranked

1. An exchange timestamp on every book and a per leg age guard.
   Every venue frame carries one.
   Refuse a route whose legs' exchange times differ by more than about 250 ms or trail `now` by more than that.
   It refuses the symptom whatever the cause, ours or the venue's.
   Size S.
   Measure it by counting rows whose legs' exchange times differ by more than the guard on the next crash, which must be zero.
2. A loop lateness guard.
   A 100 ms timer records how late it fires, above about 100 ms the manager refuses opens with a new reason and marks samples blind, and the value is logged.
   About ten lines.
   It names the cause in the log, which the timestamp guard cannot, since a late loop and a late venue look the same to it.
   Measure it by the count of refusals with the new reason against the utilization series of item 3.
3. Read the runtime metrics after every run.
   `nodejs.eventloop.utilization` and `nodejs.eventloop.delay.max` over the run, with the crash minutes against the baseline, belong in the audit checklist.
   No code.
4. Cut the largest stream.
   The binance snapshot channel at [`binance.ts:25`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/venues/binance/binance.ts) is about ten frames a second per market and exists to reseed the diffs.
   `@depth20@500ms` drops about four fifths of it for a reseed that lands half a second later after a desync, of which the run had seven.
   One line.
   Measure it with the pipeline probe of section 5.3 before and after, and by the binance reconnect count on the next busy hour.
5. The close code and the young socket rule.
   Log the code and reason at [`VenueFeed.ts:95`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts), and hold a socket that closed inside the last few seconds as unhealthy until its second snapshot.
   Size S.
   Measure it by the close codes on the next wave and by the count of rows that open within a second of a reseed.
6. Pair shards.
   The structural answer, designed in section 5.2 of [`./2026-09-07-depth-stream-scaling.md`](./2026-09-07-depth-stream-scaling.md): a pair predicate in the cluster builder, N runs in the orchestrator, each with its own loop, feeds, engine and queue.
   Out of scope by the standing decision, and the only remedy that raises the ceiling rather than staying under it.

## 16. Method and provenance

| measurement | source | script | host | re-derived on 2026-09-17 |
|---|---|---|---|---|
| 5.1 engine hot path, 2026-08-01 | working note, not in the tree | none recorded | development laptop, Node 24 | no |
| 5.2 universe load, 2026-09-07 02:00 | [`./2026-09-06-venue-depth-endpoints-probe.md`](./2026-09-06-venue-depth-endpoints-probe.md) section 2b | [`../../scripts/probes/ws-depth-load-probe.mjs`](../../scripts/probes/ws-depth-load-probe.mjs) | development laptop | no |
| 5.3 pipeline cost and ceiling, 2026-09-07 23:35 to 23:55 | [`./2026-09-07-depth-stream-scaling.md`](./2026-09-07-depth-stream-scaling.md) sections 1 and 2 | [`../../scripts/probes/ws-depth-pipeline-probe.mjs`](../../scripts/probes/ws-depth-pipeline-probe.mjs) | development laptop | no |
| 5.4 binance diff channel, 2026-09-15 00:20 to 01:10 | [`./2026-09-15-binance-realtime-depth.md`](./2026-09-15-binance-realtime-depth.md) sections 2 and 3 | probe named in that doc | development laptop | no |
| 5.5 baseline after the diff channel | arithmetic in this document | none | none | yes, it is arithmetic |
| 5.6 crash bound | arithmetic on the venue files and section 5.4 | none | none | yes, it is arithmetic |
| 6 run facts | [`../audits/2026-09-15-fifth-run-data-audit.md`](../audits/2026-09-15-fifth-run-data-audit.md) section 0 | none | home server, pid 31488 | no |
| 7 timeline | audit section 2a and the loop saturation research sections 1 to 3 | none | home server logs and venue tapes | no |
| 8 pass structure | [`./2026-09-17-fifth-run-loop-saturation.md`](./2026-09-17-fifth-run-loop-saturation.md) sections 2 and 8 | none, read from the laptop table | laptop copy of the rows | no |
| 9 timers | loop saturation research section 3, audit section 2a | none | home server log export | no, export absent |
| 10 binance sockets | loop saturation research section 3, audit section 2a, the feed code, binance docs | none | home server log export | code re-read yes, log lines no |
| 11 tape fits | audit sections 2a and 8 | none | public REST probes on 2026-09-16 | no |
| 3 and 10 runtime internals | Node v24.x and libuv 1.52.1 sources, kernel docs, RFC 9293, `ws` 8.21.1 | none | read from the sources on 2026-09-17 | yes |

The run's log export was read line by line for the loop saturation research with `process.pid` 31488 selecting the audited process.
Its per line numbers are reproduced here from that document because the export is not on this laptop today.
The two code facts that this document adds to the older ones, that `ws` never pauses the socket and that `ClearOut` delivers every record before it returns, were read from the Node v24.x and `ws` 8.21.1 sources on 2026-09-17 and are the reason section 3 speaks of slices of up to 2 MiB per socket rather than an unspecified backlog.
