# Requirements the Rust rewrite inherits from the saturated loop

Status: Not started.
Recorded: 2026-09-17.
Indexed in [BACKLOG.md](../BACKLOG.md).

## Finding

On 2026-09-15 a market wide flash crash pushed the venues' frame rate past what the Node server's one thread could process, and 34 of the run's 66 rows were a leg stamped fresh by our clock while it was one to almost four seconds behind its venue.
The case is [`../bestiary/saturated-loop.md`](../bestiary/saturated-loop.md) and the full record is [`../research/2026-09-17-node-event-loop-ceiling.md`](../research/2026-09-17-node-event-loop-ceiling.md).

A Rust rewrite is expected to change two numbers.
The cost per frame on one thread, which is 26 to 29 µs in Node, should fall to a few microseconds, and every socket can be read on its own task across all cores instead of in one fixed rotation.
Neither number changes the fact underneath the crash.
When arrivals exceed capacity, frames queue somewhere, and a book stamped at the time it was processed is wrong by exactly its queue.
Node had no way to see that state, because `ws` never pushes back, the kernel absorbs the excess silently, and `net` exposes no arrival time.
Rust can see it, and this entry is the instruction that the rewrite must.

Everything below is a requirement of the rewrite, not an option to weigh during it.
The Node server gets the same guards now, through items 1 and 4 of [`./2026-09-15-open-gate-safeguards.md`](./2026-09-15-open-gate-safeguards.md) and the loop lateness guard of the bestiary entry, and the rewrite does not replace that work.

## 1. Every book carries the venue's own time

Every venue frame carries an exchange timestamp, and today every adapter parses it and drops it.
The fields are listed per venue in [`../bestiary/lagging-view.md`](../bestiary/lagging-view.md).

- Parse the exchange time on every snapshot and every delta and carry it onto the book as `exchange_ts`.
- Keep a clock offset per venue, measured on the host that runs the engine, since [`../research/2026-09-15-binance-realtime-depth.md`](../research/2026-09-15-binance-realtime-depth.md) measured all four venues inside 5 ms of the laptop and that number belongs to the laptop.
- The engine compares legs on `exchange_ts` and on nothing else.
  Refuse a route whose legs' exchange times differ by more than about 250 ms, and refuse a leg whose exchange time trails now by more than that.
  The threshold is the audit's repair 1 and it leaves a band, since 240 ms of a flash crash is thousands of ppm, so the number is set by measurement and revisited by the next audit.
- The row records both legs' exchange times at open, at peak and at close, so an audit never has to fit a tape again to know how old a leg was.

## 2. Every frame carries the arrival time

- Stamp every frame with the time it left the kernel, as `arrival_ts`, separate from the time it was applied, `applied_ts`.
- The kernel's own stamp is the honest one and costs nothing: enable `SO_TIMESTAMPING` on each socket through `setsockopt`, from the `libc` crate if `socket2` does not expose it, and read the stamp from the ancillary data of `recvmsg`, per the kernel's [timestamping document](https://docs.kernel.org/networking/timestamping.html).
  The stamp of the segment that completed a frame is that frame's arrival time.
- If the transport makes that awkward under TLS, the fallback is a stamp taken in the reader task the instant `recv` returns, and it is honest only while the reader task's own queue depth is exported and small, which item 3 requires.
- Three stamps per book give three measurements that were all invisible on 2026-09-15.
  `arrival_ts` minus `exchange_ts` is the venue's and the network's delay.
  `applied_ts` minus `arrival_ts` is our queue.
  Now minus `exchange_ts` is the age the gate judges.

## 3. Every queue is bounded and its depth is exported

- One reader task per socket owns that socket's TLS session, framing, parsing and the venue book for its markets.
  It waits on nothing but the socket.
  A reader that waits on the engine stops reading, the receive window closes, and the venue drops the connection, which is what binance did 193 times in hour 18.
- Updates from a reader to the engine go over a bounded channel sized to a time budget, on the order of 100 ms of that socket's peak rate, never to "large".
- When the channel is full the reader neither blocks nor drops a delta.
  It keeps applying to the book it owns and coalesces the notification per market, latest state wins, so the engine reads the current top of a market once instead of every intermediate frame.
  The exact mechanism, a shared per market snapshot with a change flag or a channel of market ids with de-duplication, is the design doc's decision.
- Every queue exports its depth and its age as metrics on the same cadence as the runtime metrics today: the channel length, the pending markets per reader, and per socket the newest `applied_ts` minus `arrival_ts`.

## 4. Falling behind is a state the engine can see and refuse

- A venue whose `applied_ts` minus `arrival_ts` exceeds a threshold, about 100 ms, is lagging.
  The engine refuses opens on any route with a lagging leg with its own refusal reason, marks samples on open rows blind for that leg, logs the lag in milliseconds, and clears the state when the lag falls back under the threshold.
- The engine thread exports its own utilization, busy time over wall time, and its inbound depth.
  A reader task exports the same for itself.
- Nothing in the process stamps a book with the time it got around to it and calls that fresh.
  `applied_ts` exists for monitoring and never enters a gate.

## 5. The engine stays on one thread and the byte path never touches it

- Decrypting, framing, parsing and book maintenance run on the reader tasks.
  The engine thread receives compact top of book and depth updates and runs the gates, the discovery and the samples.
- The engine's cost today is about 60 ns per message and the rewrite keeps it in that range: no allocation per message, flat numeric arrays per cluster, no string keys on the hot path.
- Thread count is the core count and the split of work is per socket.
  More threads than cores add nothing to a CPU bound byte path.
  The budget of the process is cores times one second over the cost per frame, and the design doc states that number for the host it targets.
- Pair shards, as designed in section 5.2 of [`../research/2026-09-07-depth-stream-scaling.md`](../research/2026-09-07-depth-stream-scaling.md), remain the way to grow past one engine thread and are not required for five venues.

## 6. Measure before building

- A Rust probe of the byte path, the twin of [`../../scripts/probes/ws-depth-pipeline-probe.mjs`](../../scripts/probes/ws-depth-pipeline-probe.mjs): the same five venues, every market, deflate refused, a five second settle and a twenty second window, per venue frames a second, µs per frame per thread split into decrypt, parse and apply, process CPU, RSS.
  The expected cost is 2 to 5 µs per frame, and that is an estimate until the probe replaces it.
  The result lands under [`../research/`](../research/) as a dated doc.
- A saturation replay.
  Feed recorded frames through the pipeline at three, five and ten times real time and assert that the lag metric of item 3 rises, that the lagging state of item 4 triggers and clears, that no book corrupts, and that no reader task ever awaited the engine.
- The acceptance test of the rewrite is the fifth run's crash minutes replayed with their exchange timestamps: zero rows may open inside 18:37:01 to 18:37:54 and 18:45:42 to 18:49:26 on 2026-09-15.

## What finishing means

1. A design doc under [`../plans/`](../plans/) that fixes the thread layout, the reader's ownership of the venue book, the channel and its coalescing rule, the three stamps and their thresholds, the lagging state, and the metric names.
   Size M.
2. The Rust probe of item 6 with its measured cost per frame, recorded as research.
   Size S to M.
3. The rewrite itself, with the saturation replay and the crash replay as its tests.
   Size L, and it is the rewrite already judged necessary for fifty venues.

The order is probe, design, rewrite, and the probe can run before anything else is decided.
