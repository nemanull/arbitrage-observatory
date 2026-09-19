# Saturated loop

The process's one thread has more frames to handle than it can finish, so every book on every venue is stamped with the moment the thread got to its frame, not the moment the venue sent it.
Nothing is blocked and nothing is silent.
Samples keep flowing, every price on the row is real, and every price is old by an amount that differs per socket, so the cross is measured between two instants of our own making.
[`lagging-view.md`](./lagging-view.md) is what this looks like on the row against the venues' tapes.
This entry is the cause inside the process, and the signature that shows it with no venue data at all.

## The row

Row 2787 of the fifth run, ETH krakenfutures-binance, opened at 18:37:11.669 UTC, lived 2,307 ms, claimed 10,807 net ppm at open on a region of 134,355 quote units, the largest of the run.
[`lagging-view.md`](./lagging-view.md) holds the row against both tapes: the kraken bid was about 2.2 s behind and the binance ask about 1 s behind.
Here is what the row's own sample clock shows, which needs no tape.

| what | value |
|---|---|
| samples | 120 in 2,307 ms |
| samples that share a millisecond with another sample | 82 percent, largest same millisecond group 18 |
| kraken bid changes | six bundles of a median 18 changes each, 410 ms apart, nothing between |

A venue does not send 18 book changes in one millisecond and then nothing for 400.
A thread that reads a socket's whole backlog in one go and comes back 400 ms later does exactly that.

## The book behind the row

Sample stamps come from `publish` at [`../../server/src/feeds/book/VenueFeed.ts`](../../server/src/feeds/book/VenueFeed.ts) line 283, which is `Date.now()` when the frame was processed, so the samples of every row open at the same time are one trace of the thread's work.
Taking each open row's leg changes between 18:37:11.5 and 18:37:16.5 and attributing each change to its venue gives 46 bundles of different venues, none overlapping, in a fixed cycle: okx, then kraken, then binance, then bybit.

| pass, ms after 18:37:11.5 | okx bundle | kraken bundle | binance bundle | bybit bundle |
|---|---|---|---|---|
| 839 | 839 to 867, 10 changes on 6 pairs | 870 to 882, 26 changes on ETH, OP, STX | 932 to 1,056, 16 changes | 1,060 to 1,292, 19 changes |
| 1,384 | 1,384 to 1,419, 14 changes | 1,431 to 1,449, 26 changes on ETH, OP, STX | 1,553 to 1,706, 15 changes | 1,759 to 2,011, 29 changes |
| 2,020 | 2,020 to 2,025, 4 changes | 2,035 to 2,051, 40 changes on ETH | 2,116 to 2,239, 18 changes | 2,268 to 2,425, 24 changes |
| 2,433 | 2,433 to 2,439, 5 changes | 2,445 to 2,448, 13 changes on ETH | 2,491 to 2,605, 10 changes | 2,669 to 2,803, 16 changes |

The passes repeat every 545, 636, 413, 396, 383 and 380 ms, and the bundles fill almost all of each pass.
Kraken's ETH, OP and STX changes come from three different rows and land inside one 12 to 18 ms bundle whenever they change on the same pass.
Frames from two venues that share nothing but our process cannot line up in lockstep on their own.

The quiet hours look nothing like it.

| window | venue | bundles | median gap | largest bundle |
|---|---|---:|---:|---:|
| ACE 2761, 08:49:29 to 08:49:57 | binance | 160 | 117 ms | 8 |
| ACE 2761 | bybit | 145 | 120 ms | 9 |
| LSK 2770, 13:15:19 to 13:15:31 | binance | 101 | 102 ms | 9 |
| burst, 18:37:09.5 to 18:37:17 | kraken | 8 | 561 ms | 40 |
| burst | okx | 24 | 227 ms | 14 |
| burst | bybit | 31 | 176 ms | 35 |
| burst | binance | 31 | 137 ms | 18 |

In a quiet hour a bundle is the venue's own cadence, about 100 ms apart and never above nine changes.
In the burst the same venues bundle four times larger and three to five times further apart.

## The mechanism

Node runs the sockets, TLS, WebSocket framing, `JSON.parse`, the book, the engine, the samples, the anchor pollers and the sweep on one thread.
The read path, verified in the Node v24 and `ws` 8.21.1 sources, has two properties that shape the failure.

- One readable socket is served to the end of its slice before the next one is touched.
  libuv reads up to 32 times 64 KiB from one socket per loop turn, TLS delivers every record it can decrypt at once, and `ws` emits every frame in a chunk synchronously.
  So each turn walks the sockets in a fixed order and hands the engine one venue's backlog, then the next venue's, which is the table above.
- Nothing pushes back.
  `ws` never pauses the socket, because it acknowledges each chunk before the write's return value is computed.
  The kernel absorbs what the thread cannot take, up to the socket's receive window, and past that the venue's own send queue holds the rest or the venue drops the client.
  Binance dropped its two busiest sockets 146 and 47 times in hour 18, each within about a second of subscribing.
  The reading that fits is that a fresh socket's window is 64 KB and never grows while the thread is not reading, and it is a reading, because the close code is not logged.

The costs were measured ten days before the run on the laptop, with deflate refused.

| quantity | value |
|---|---:|
| loop time per frame, TLS to book | 26 to 29 µs |
| of which the handler, parse plus apply plus copy | 12.5 µs, parsing 73 percent |
| one loop at 100 percent | 34,000 to 38,000 frames a second |
| quiet hour baseline after the binance diff channel, derived | about 14,000 frames a second |
| bound if every streamed market moves on every tick | about 65,000 frames a second |

A market wide crash multiplies the baseline three to five times, and that is past the ceiling.
The engine's own arithmetic is about 60 ns per message and is irrelevant to it.

## Saturated is not stalled

The first suspicion was a blocked loop, and the audit ruled it out correctly: between 18:37:10 and 18:37:16 no gap of 150 ms passed without a sample.
A blocked loop emits nothing for its duration.
A saturated loop is never blocked and never idle, it emits continuously at the ceiling rate, and each socket lags by its own queue.
Both facts are true of this run, and the second is the one that hides the first.

## The signature without any venue data

1. Venue bundles in a fixed order that never overlap, at a period several times the venues' cadence.
2. Samples that share a millisecond in groups of ten or more, then silence for hundreds of milliseconds.
3. Every periodic thing in the process late by the same amount at the same time.
   The anchor pollers' 60 round summaries came 15 to 20 s late on every venue in the same minutes, with 314 skipped ticks and rounds of 6.6 to 8.1 s in hour 18, and the pollers share nothing but the thread.
4. Reconnect storms on the busiest sockets, every line at attempt 1, no error line, no `no traffic` line.
5. The lag differs per venue, so it is a per socket queue and not a venue or a link, and it hits every venue at once, so it is local.

Item 3 was in the logs of this run at 17:36, an hour before the crash, with no row to draw attention to it.

## Why the engine cannot see it

The only clock a book gets is `Date.now()` at processing, and the only test on it is whether it is zero.
Under saturation every book's clock is late by that book's queue, and a cross is the difference between two queues.
The minimum cross age of 100 ms is measured on the same clock in 400 to 600 ms steps, so every cross that survived one pass was confirmed.
The anchor gate refused 232 opens in the 18:37 minute and went blind on the rows already open.
The direct instrument, `nodejs.eventloop.utilization`, was exported to SigNoz every 30 s for the whole run by [`../../server/src/observability/otel.ts`](../../server/src/observability/otel.ts) and nobody read it.

## How to detect it

1. A loop lateness guard.
   A 100 ms timer records how late it fires, above about 100 ms the manager refuses opens with a new reason and marks samples blind, and the value is logged.
   About ten lines, and the only guard that names the cause.
2. Event loop utilization and delay in the audit checklist, with the busy minutes against the quiet ones.
   Utilization near 1 with delay in the hundreds of milliseconds is this entry.
3. An exchange timestamp on every book and a per leg age guard, which refuses the symptom whatever the cause.
   Every venue frame carries one, per the table in [`lagging-view.md`](./lagging-view.md).
4. Skipped anchor rounds and reconnects per socket per hour, which the logs already hold, as the cheap proxy for the first two.
5. The close code on the reconnect line and a quarantine for a socket younger than its second snapshot.

## How common it was

34 of the 66 rows of the fifth run opened inside the two windows in which the loop was saturated.

| window | rows |
|---|---:|
| 18:37:01 to 18:37:54 | 21 |
| 18:45:42 to 18:49:26 | 13 |

Those are the 30 rows of [`lagging-view.md`](./lagging-view.md) and the four kraken rows of the first window, SSV 2793, CVX 2794, VELO 2796 and CRO 2797.
The same loop lateness showed at 17:36 with no crash and no row, and binance closed young sockets in the same 3 s rhythm at 13:34, 13:39 and 14:35, so the load was not only a crash story.

## Related

- [`lagging-view.md`](./lagging-view.md) is the same rows read against the venues' tapes, the symptom this entry causes.
- [`stale-quote.md`](./stale-quote.md) is a quiet socket, where this one is loud.
- [`flicker.md`](./flicker.md) is a real cross that dies in a millisecond, which the minimum cross age removed and this entry survives.
- [`blind-guard.md`](./blind-guard.md) is the refusal that goes blind on an open row, which is why the anchor gate closed nothing here.

## Evidence

- The full record of the ceiling and the crash, every measurement with its date, host and method: [`../research/2026-09-17-node-event-loop-ceiling.md`](../research/2026-09-17-node-event-loop-ceiling.md).
- The reading of the sample clocks and the logs that placed the cause inside the process: [`../research/2026-09-17-fifth-run-loop-saturation.md`](../research/2026-09-17-fifth-run-loop-saturation.md).
- The per message cost and the ceiling: [`../research/2026-09-07-depth-stream-scaling.md`](../research/2026-09-07-depth-stream-scaling.md) sections 1 and 2.
- The rows, the tape fits and the reconnect counts: section 2a of [`../audits/2026-09-15-fifth-run-data-audit.md`](../audits/2026-09-15-fifth-run-data-audit.md).
- The stamp: [`../../server/src/feeds/book/VenueFeed.ts`](../../server/src/feeds/book/VenueFeed.ts) line 283, and the read path in section 3 of the ceiling research.
