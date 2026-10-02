# Fifth run: the event loop fell behind inside the flash crash

Date: 2026-09-17, read from the laptop copy of the run.
This follows [`../audits/2026-09-15-fifth-run-data-audit.md`](../audits/2026-09-15-fifth-run-data-audit.md), which classed 30 of the 66 rows as "view lagged in a crash" and left the cause of the lag unread.
It answers one question: what was the biggest reason for the false positives of the fifth run, and what produced it.
The rows are ids 2755 to 2820 in the laptop table.
The logs are the home server export at `logs/2026-09-15-homeserver/signoz-logs.jsonl.gz`, which is gitignored, holds 60,437 lines from the audited process and carries no numeric attributes.
The home server did not answer on 2026-09-17, so its metrics store was not read, and section 7 lists what it can still settle.
Every timestamp is UTC.

## 1. The answer

The biggest reason is that the process fell behind the venues.
34 of the 66 rows, 52 percent, opened inside two windows in which the single event loop was saturated, 18:37:01 to 18:37:54 and 18:45:42 to 18:49:26.
In those windows the loop completed one pass over every socket every 350 to 640 ms.
Each pass drained one socket's whole backlog before it took the next, in a fixed order, so every book advanced in bundles and stood still between passes.
The slow channels fell furthest behind, 1 to 3.7 s on okx and kraken by the audit's tape fits, while the two binance sockets that carried the most traffic were closed by the venue and came back with a fresh snapshot.
A row is the stale leg of one venue against the current leg of another.
Nothing on the open path or the close path can see this, because every book and every sample is stamped with our own clock at the moment we processed the frame, and that clock ran in half second steps.

The 34 rows are the 30 lag rows of the audit plus the four kraken rows that opened inside the first window, SSV 2793, CVX 2794, VELO 2796 and CRO 2797.
The other 32 rows opened outside the windows and belong to the audit's other classes: 22 standing basis rows, two kraken rows, seven flashes and one convergence.

## 2. How the rows show it

A sample is written on every book update that changes a top price in the pair's cluster, at [`OpportunityLifecycle.ts:226`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/engine/opportunity/OpportunityLifecycle.ts), with `now` taken from the feed at [`VenueFeed.ts:283`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts), which is `Date.now()` when the frame was processed.
So the sample clock of an open row is a trace of when the process handled each venue's frames.
Row 2787, ETH krakenfutures-binance, holds 120 samples over 2,307 ms.
82 percent of them share a millisecond with another sample, and the largest same millisecond group is 18.
Its kraken bid changed in six bundles of a median 18 changes each, 410 ms apart, with no change between bundles.

The same clock across every row open at the same instant shows the loop's rotation.
Taking each row's leg changes between 18:37:11.5 and 18:37:16.5 and attributing each change to its venue gives 46 adjacent bundles of different venues, and none of them overlap in time.
They come in a fixed cycle, okx, then kraken, then binance, then bybit.
The okx bundle that opens each cycle starts 839, 1,384, 2,020, 2,433, 2,829, 3,212 and 3,592 ms after 18:37:11.5, which is a pass period of 545, 636, 413, 396, 383 and 380 ms.

| pass, ms after 18:37:11.5 | okx bundle | kraken bundle | binance bundle | bybit bundle |
|---|---|---|---|---|
| 839 | 839 to 867, 10 changes on 6 pairs | 870 to 882, 26 changes on ETH, OP, STX | 932 to 1,056, 16 changes | 1,060 to 1,292, 19 changes |
| 1,384 | 1,384 to 1,419, 14 changes | 1,431 to 1,449, 26 changes on ETH, OP, STX | 1,553 to 1,706, 15 changes | 1,759 to 2,011, 29 changes |
| 2,020 | 2,020 to 2,025, 4 changes | 2,035 to 2,051, 40 changes on ETH | 2,116 to 2,239, 18 changes | 2,268 to 2,425, 24 changes |
| 2,433 | 2,433 to 2,439, 5 changes | 2,445 to 2,448, 13 changes on ETH | 2,491 to 2,605, 10 changes | 2,669 to 2,803, 16 changes |

Kraken's ETH, OP and STX changes come from three different rows and land inside one 12 to 18 ms bundle whenever they change on the same pass.
Across the window from 18:37:09.5 to 18:37:17 the nearest bundle of another venue starts a median 18 ms from each kraken bundle and a median 30 ms from each okx bundle.
Frames from two venues that share nothing but our process cannot arrive in lockstep on their own.
A network link that stalls and resumes would deliver every flow interleaved after the stall, not one venue after another in the same order every time.
Ordered, non overlapping bundles are the event loop reading one socket's backlog to the end before it takes the next, which is what libuv does when every socket is readable at once.

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

The first rows of the crash, RAVE 2779 and 2780 at 18:37:01.6 and SPX 2781 at 18:37:05, show a milder shape, bundles of at most six and 80 to 100 ms between binance and bybit bundles.
At that moment the loop was loaded but not yet at half second passes, so the 1.7 s okx lag the audit fitted on RAVE may be partly okx's own batching under load.
From 18:37:10 the shape is unambiguous.

## 3. What the logs add

The export has no numbers, but it has timestamps, and two periodic things in the process are clocks.

The anchor pollers tick on a one second `setInterval` at [`AnchorPoller.ts:56`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/anchor/AnchorPoller.ts), two seconds on bybit and coinbase, and write a summary every 60 completed rounds per [`AnchorPoller.ts:11`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/anchor/AnchorPoller.ts).
A tick that finds the previous round still in flight is counted as skipped at [`AnchorPoller.ts:90`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/anchor/AnchorPoller.ts) and does not advance the summary.
So the spacing between two summaries grows by one tick for every round that outlived its tick, and by the lateness of the timer itself.
Over the run the spacing sits at a median of 60.0 s with a p90 of 60.3 to 61.1 s on the one second pollers, and at 120.0 s with a p90 of 120.2 to 121.9 s on the two second pollers.

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

Every poller slowed in the same minutes, which is a local cause, and the audit read the same thing in the numbers on the home server, a `maxMs` of 6,600 to 8,100 ms on every venue in hour 18 with 314 skipped rounds.
The 17:36 entry is a loaded loop with no crash and no row, so the load is not only a crash story.

The binance sockets show the same load from the venue's side.
`binance#linear#0` reconnected 146 times between 18:37:15.302 and 18:56:46.739, `binance#linear#1` 47 times until 18:52:25, and `#2` and `#3` never.
Every reconnect line says attempt 1, because [`VenueFeed.ts:206`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts) resets the attempt on any received message, so each closed socket had been served before it died.
No error line and no `no traffic` line sits in the window, so the closes were clean closes from the far side.
A cycle is 2.81 s: a reconnect delay of 640 ms, all four subscribe acknowledgements within 20 ms of each other about 1.2 s after the socket opened, and the next close a median 0.92 s later, p10 0.46 s, p90 2.10 s.
The socket open to the first acknowledgement took 1.17 s in the storm and 0.94 to 1.54 s on the 33 reconnects of the quiet hours, so the handshake itself was not slowed.
The cycles come in waves, 18:37 to 18:38, 18:40 to 18:41, 18:46 to 18:47, 18:49 to 18:51, 18:53 and 18:56, with pauses of 79 to 272 s between them.
The same shape ran for 8 to 11 cycles at 13:34, 13:39 and 14:35 with no crash and no row, so binance closes a fresh socket of this size on its own now and then, and hour 18 is that shape sustained for nineteen minutes in waves that follow the market's activity.
A socket that dies within a second of subscribing is a young socket whose receive window is still small, and the two that died first carried BTC and ETH.
That reads as the venue closing a consumer that does not drain, but it cannot be proven from this export, because the close code is not logged, which the audit lists as repair 4.

Each cycle also costs the engine: `markStale` on 200 markets at the close, 200 snapshots on the reopen, and four `feed_down` closes on rows, at 18:37:15.302, 18:37:16.649, 18:37:40.737 and 18:41:25.439.

## 4. Why no gate could see it

- The book clock is ours.
  [`VenueFeed.ts:283`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/feeds/book/VenueFeed.ts) stamps the book with `Date.now()` at processing, [`Engine.ts:202`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/engine/Engine.ts) hands that stamp to validation as `recvTs`, and the only check on it is `recvTs > 0` at [`OpportunityManager.ts:322`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/engine/opportunity/OpportunityManager.ts) and [`OpportunityManager.ts:346`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/engine/opportunity/OpportunityManager.ts).
  A backlog shifts every book's clock by the backlog, and the row cannot tell a stale leg from a current one.
- The sample clock is the same clock.
  Every duration, every `sampleTsMs` and the minimum cross age of [`../plans/2026-09-15-minimum-cross-age-design.md`](../plans/2026-09-15-minimum-cross-age-design.md) were measured in half second steps.
  A cross first seen on one pass was 380 to 640 ms old on the next pass, so under saturation the 100 ms age gate confirmed every cross that survived one pass.
- The anchor gate went blind.
  The audit counts 55.6 percent of the samples on the 66 rows as refused for a moving anchor, and a blind sample closes nothing.
- The measurement that shows it directly exists and was never read.
  [`otel.ts:60`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/observability/otel.ts) enables the Node runtime instrumentation, which exports event loop delay and utilization every 30 s per [`otel.ts:20`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/observability/otel.ts) to the SigNoz metrics store on the host that runs the process.
  It is not in the log export, and the audit's checklist does not name it.

This is the class of [`../bestiary/lagging-view.md`](../bestiary/lagging-view.md), with the cause now placed inside the process.
The safeguard it needs is the first one of [`../backlog/2026-09-15-open-gate-safeguards.md`](../backlog/2026-09-15-open-gate-safeguards.md).

## 5. Capacity

[`./2026-09-07-depth-stream-scaling.md`](./2026-09-07-depth-stream-scaling.md) measured 26 to 29 µs of loop time per message and 22 to 25 percent of a core at 7,600 to 9,400 messages a second, on the laptop, with deflate refused.
That puts the loop's ceiling near 35,000 to 40,000 messages a second on that core.
The baseline has risen since: [`./2026-09-15-binance-realtime-depth.md`](./2026-09-15-binance-realtime-depth.md) measured 5,208 binance books a second on 571 markets, against about 1,600 before the diff channel, and the run streamed 2,116 markets on five venues.
A market wide crash multiplies the rate on every venue at once.
Bybit pushes `orderbook.50` every 20 ms per changed market on 659 markets per [`bybit.ts:23`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/venues/bybit/bybit.ts), binance sends a diff on every change on 652 markets per [`binance.ts:21`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/venues/binance/binance.ts), and okx pushes its 400 level book every 100 ms on 434 markets per [`okx.ts:13`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/venues/okx/okx.ts).
Three to five times the baseline reaches the ceiling, and that is what a flash crash is.
The home server's core is not the laptop's, and its speed is not known until it answers.

## 6. What would have caught it

1. An exchange timestamp on every book and a per leg age guard, the audit's repair 1.
   It refuses the symptom whatever the cause, ours or the venue's, and the audit states that every venue frame carries one.
2. A loop lateness guard.
   A 100 ms timer records how late it fires, above about 100 ms the manager refuses opens with a new reason and marks samples blind, and the value is logged.
   Ten lines, and it names the cause in the log, which the timestamp guard cannot, since a late loop and a late venue look the same to it.
3. Read the runtime metrics after every run.
   `nodejs.eventloop.delay.max` and `nodejs.eventloop.utilization` over the run, with the crash minutes against the baseline, belong in the audit checklist.
4. Cut the largest stream.
   The binance snapshot channel at [`binance.ts:25`](https://github.com/nemanull/arbitrage-observatory/blob/627272be8be356aa40ee6194d0f709c3f00f8df9/server/src/venues/binance/binance.ts) is about ten frames per market per second and exists to reseed the diffs.
   `@depth20@500ms` drops about four fifths of it for a reseed that lands half a second later after a desync, of which the run had seven.
   One line, to be measured before it is trusted.
5. The audit's repair 4, the close code on the reconnect line and a young socket held as unhealthy until its second snapshot.

Sharding or a second process is out of scope here, per the decision that fifty venues is a rewrite and the Node server stays at five.

## 7. What the home server can still settle

The metrics store on the home server was not reachable on 2026-09-17.
When it answers, three reads close the remaining gaps.

1. `signoz_metrics` for the run: `nodejs.eventloop.delay.p99`, `nodejs.eventloop.delay.max`, `nodejs.eventloop.utilization` and `v8js.gc.duration` from 18:30 to 19:00 against 08:00 to 09:00.
   A utilization near 1 and a delay in the hundreds of milliseconds in the crash minutes is the direct measurement of section 2.
2. `signoz_traces` for the HTTP client spans of the anchor polls in hour 18, which carry the round durations the export lost.
3. ClickHouse's own `system.asynchronous_metric_log`, if it is enabled, for `LoadAverage1` and `OSIdleTime` in the crash minutes, together with `nproc` and the CPU model.
   SigNoz shares the box, so this separates a saturated core from a process starved by the telemetry stack.

## 8. Method

The rows were read from the laptop table with `sampleTsMs`, `highestBidSeries`, `lowestAskSeries` and `openedAt`.
A leg change is a sample where that leg's price differs from the previous sample, attributed to the leg's venue.
A bundle is a run of changes with no gap over 30 ms, and a pass is a run of bundles with no gap over 120 ms.
The export was read line by line, with `process.pid` 31488 selecting the audited process.
