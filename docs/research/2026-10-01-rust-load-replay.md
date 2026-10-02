# Rust server load replay

Measured on 2026-10-02 between 06:02 and 06:59 UTC, which was the evening of 2026-10-01 in local time, on the development laptop.
The user asked for the README to say that the server handles up to 300,000 messages a second with 60 venues, and no document measured Rust throughput.
This doc measures it with a saturation replay through the production code, rebuilds the 60 venue load projection that the figure came from, and compares the two.
The design of record is [`2026-10-01-rust-docs-and-load-replay-design.md`](../implemented/2026-10-01-rust-docs-and-load-replay-design.md).

## Answer

- On this laptop the server kept up with 300,542 messages a second from 63 venues, 30,891 markets and 287 sockets, by every criterion fixed before the runs: every frame handled, no full engine queue, nothing coalesced, and a worst lag of 5 ms from a frame's arrival to the engine applying its book.
- Every stage from 132,435 to 300,542 frames a second kept up, twelve stages over five recordings.
- The 60 venues that fit the engine are projected to send 64,328 frames a second at the hours they were probed, and 193,000 to 302,000 in a market wide crash, so the measured capacity reaches the top of the projected crash range.
- The single engine thread is the first limit.
  Its queue first filled at 385,225 frames a second, in 2 of 6,000 samples with nothing measurably coalesced, and past about 570,000 the feeds coalesce each market to its newest book as designed, with the worst lag bounded at 141 to 240 ms.
- The socket side read every frame up to 1,104,860 a second, 370 MB a second, on about 12 cores.
- All of it is one shared laptop, without TLS, the network, the anchor polls or the database writer.

## 1. Host

- An Intel Core i7-12700H with 6 performance cores of two threads each and 8 efficiency cores, 20 logical CPUs in all, 32 GB of memory, Debian with Linux 6.12, and rustc 1.98.0.
  CPUs 0 to 11 are the performance threads and CPUs 12 to 19 the efficiency cores.
- The laptop was not idle.
  A browser, Docker Desktop's VM and an editor used about one core between them.
  The first Rust test run, process 3606931, streamed the five live venues at nice 5 the whole time.
- Run 1 ran at nice 19, so every other process won any contention, and its saturated stages are lower bounds.
  Runs 2 and 3 ran at nice 0.
- The recordings came through the Surfshark WireGuard exit in Canada that carries all of this laptop's traffic, as the table section of [`2026-09-22-venue-survey.md`](./2026-09-22-venue-survey.md) describes.

## 2. The live run

The first Rust test run started at 19:57:57 UTC on 2026-10-01 as process 3606931.
It streams 2,094 markets: 667 on binance, 674 on bybit, 451 on okx, 178 on krakenfutures and 124 on coinbase.
Coinbase contributes no book, because Coinbase International has shown every perpetual as paused since 09:00:29 UTC that day.

Its 608 `engine_summary` lines up to 06:08:55 UTC on 2026-10-02 give these one minute figures.

| Measure | Value |
|---|---:|
| Books applied by the engine | 533,585,735 |
| Books a second, mean of the minutes | 14,557 |
| Median and 99th percentile minute | 14,196 and 23,665 |
| Quietest and busiest minute | 5,821 and 36,710 |
| `max_queue_lag_ms`, median and 99th percentile minute | 5 and 45 |
| `max_queue_lag_ms`, worst minute | 363 |
| Minutes with a lag over 100 ms | 2 |
| Most books waiting in the engine queue at a summary | 5 |

`/proc/3606931` at 06:09:51 UTC gave 17,431.8 s of process CPU over 36,714 s, which is 0.475 of a core.
The engine thread used 1,899.1 s of it, 5.2 percent of one core, and 24.7 percent of all the CPU was spent in the kernel.
Resident memory was 62 MB.

That is 32.6 µs of process CPU and 3.55 µs of engine CPU per book.
Those figures include the anchor pollers, the TLS sessions and the log output, and at 14,000 books a second nearly every frame pays for its own wakeups.
They are the cost of the current load, not a ceiling, which is why the replay below exists.

The two worst minutes, 363 ms at 02:33:58 UTC and 116 ms at 01:56:49 UTC, came hours before this work started, and their cause is not known.

## 3. Method

The harness is [`load_tests.rs`](../../server/src/venues/load_tests.rs), an ignored test that runs the production feed and engine code and changes none of it.

1. It loads the catalogs of nine venues with each adapter's own loader, and keeps the markets a run would stream, which are those the nine venue cluster index puts in a cluster.
   Coinbase is left out, because its books are empty.
2. It records 60 s of every socket through `spawn_feed`.
   Each adapter is wrapped so that every frame of a connection's first session is kept with its offset from that session's first frame.
3. It builds 63 venues as seven copies of the nine, each copy with its own venue id, and builds the cluster index over all 63, so a cluster holds up to 63 columns.
4. Each stage starts one local WebSocket server per copy and recorded connection, 287 in all, on a runtime of eight threads named `replay`.
   A server sends its recording at the stage's speed against the recorded offsets and discards what the client sends.
   At the end of the recording it closes, and the client reconnects as it does after any venue close, so every loop starts with the snapshots of a fresh connection.
5. The copies connect through `spawn_feed` with the real adapters, on a runtime with tokio's default worker count, which is 20 on this host, as in `main`.
   Copy r starts r seconds after copy 0, so bursts stay correlated across venues as they are in a crash.
6. A fresh engine runs on a thread named `engine` with the real `OpportunityManager`.
   A sweeper sends `Sweep` every second as the orchestrator's does, and closed rows go to a counting channel.
7. The engine logs a summary every 60 s.
   The first window holds the connects and the copy stagger, so the second window is reported, and every counter and CPU reading is taken at those two summaries.

Each stage reports:

- the frames a second the servers sent,
- the frames and megabytes a second the adapters handled,
- the books a second the engine applied, from its summary, and books per frame,
- the CPU of each thread group from `/proc/self/task`: the socket side `feed`, the `engine` thread and the `replay` servers,
- the engine queue depth sampled every 10 ms, its deepest value, and the samples that found it full,
- the engine's `max_queue_lag_ms`, the oldest book it applied, measured from the arrival of that book's newest frame,
- how far the furthest behind server fell behind its schedule, which grows when the socket side stops reading.

A stage kept up when all of these hold.
The adapters handled at least 99 percent of the frames the servers sent.
No server fell more than 100 ms behind its schedule.
No sample found the engine queue full, and books per frame stayed within 2 percent of the slowest stage's, so nothing coalesced.
`max_queue_lag_ms` stayed under 100 ms, the lag threshold of item 4 of [`2026-09-17-rust-rewrite-requirements.md`](../backlog/2026-09-17-rust-rewrite-requirements.md).
These criteria were fixed in decision 10 of the design before the first stage ran.

### What the replay leaves out

- TLS.
  The local servers speak plain `ws://`.
  AES-GCM decryption on this CPU is estimated at a few percent of one core at 130 MB a second, and it was not measured.
- The network.
  Loopback delivers in microseconds, so the replay says nothing about view age, which the README's measurement environment section covers.
- The anchor polls.
  No poller runs, so a cross wide enough to need anchors is refused as `anchor_missing`, and no row opens, which is why every stage stored zero rows.
- The database writer.
- The shape of real load.
  The 63 venues are copies of nine replaying one minute, so their bursts are more correlated than 63 independent venues would be, and every loop restarts with the snapshot burst of a fresh connection.

## 4. The recordings

Run 1 recorded for 60 s from about 06:02:26 UTC.

| Venue | Streamed markets | Connections | Frames | MB | Frames a second | Reopened |
|---|---:|---:|---:|---:|---:|---:|
| binance | 729 | 4 | 309,280 | 167.6 | 5,264 | 2 |
| bybit | 753 | 4 | 291,912 | 73.5 | 4,927 | 0 |
| okx | 473 | 2 | 97,550 | 52.8 | 1,642 | 0 |
| krakenfutures | 181 | 2 | 297,464 | 37.1 | 4,997 | 0 |
| gate | 845 | 6 | 192,685 | 43.4 | 3,281 | 0 |
| bitget | 759 | 16 | 325,350 | 97.6 | 5,469 | 0 |
| mexc | 650 | 5 | 34,072 | 28.1 | 571 | 0 |
| bitstamp | 17 | 1 | 3,214 | 5.2 | 54 | 0 |
| gemini | 6 | 1 | 710 | 0.2 | 12 | 0 |
| total | 4,413 | 41 | 1,552,237 | 505.5 | 26,217 | 2 |

A reopened connection closed during the recording, binance's by a venue reset, so its recording is its first session only and its loop is shorter.
Seven copies make 63 venues, 30,891 markets and 287 connections.

## 5. Results

The runs, in order:

- Run 1 at 06:02 UTC, at nice 19, speeds 1 to 8, on the recording of section 4.
- Run 2 at 06:16, at nice 5, because zsh lowers the priority of a job started in the background, speeds 1, 1.55 and 1.55.
- Run 3 at 06:25, at nice 0, speeds 1, 1.8 and 1.8.
  A first start of it at 06:23 was stopped after 45 s, because two copies of the test were running.
- Run 4 at 06:32 was stopped after its recording.
- Run 5 at 06:37, at nice 0, speeds 1, 1.8 and 1.8.
- Run 6 at 06:53, at nice 0, after 15 minutes without a new binance socket, with `REPLAY_RATES` of 150,000 and 310,000 frames a second, which became speeds 0.95 and 1.97.
  It was stopped after those two stages, because its third repeated the second.

In runs 3 and 5 binance reset its recording sockets, so those recordings carry less binance than the market sent, as the table below shows.

| Venue, frames a second | Run 1 | Run 2 | Run 3 | Run 5 | Run 6 |
|---|---:|---:|---:|---:|---:|
| binance | 5,264 | 4,348 | 651 | 1,474 | 3,704 |
| bybit | 4,927 | 4,784 | 4,121 | 4,445 | 4,064 |
| okx | 1,642 | 1,578 | 1,391 | 1,448 | 1,329 |
| krakenfutures | 4,997 | 4,924 | 3,251 | 3,841 | 3,406 |
| gate | 3,281 | 3,156 | 2,609 | 2,883 | 2,466 |
| bitget | 5,469 | 5,370 | 5,089 | 5,239 | 5,221 |
| mexc | 571 | 561 | 524 | 545 | 525 |
| bitstamp | 54 | 54 | 43 | 47 | 40 |
| gemini | 12 | 12 | 6 | 8 | 7 |
| one copy | 26,217 | 24,787 | 17,685 | 19,930 | 20,762 |
| binance sockets reopened | 2 | 2 | 3 | 3 | 2 |

Every stage, in run order.
The servers sent within 60 frames a second of what the adapters handled in every stage but run 1's speed 8, where they sent 1,176,169 and fell behind.

| Run | Nice | Speed | Frames handled a second | MB a second | Books a second | Books per frame | Socket side, cores | µs per frame | Engine, share of a core | µs per book | Deepest queue | Queue full | Worst lag | Server behind | Kept up |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---|
| 1 | 19 | 1 | 194,010 | 65.7 | 177,753 | 0.916 | 2.90 | 15.0 | 31% | 1.73 | 1,054 | 0 of 6,099 | 10 ms | 12 ms | yes |
| 1 | 19 | 2 | 385,225 | 129.9 | 352,949 | 0.916 | 4.62 | 12.0 | 50% | 1.41 | 4,096 | 2 of 6,000 | 25 ms | 23 ms | no, the queue filled |
| 1 | 19 | 3 | 570,586 | 191.9 | 506,157 | 0.887 | 6.19 | 10.9 | 70% | 1.37 | 4,096 | 416 of 6,000 | 141 ms | 24 ms | no |
| 1 | 19 | 4 | 752,169 | 252.6 | 337,577 | 0.449 | 10.69 | 14.2 | 86% | 2.55 | 4,096 | 5,222 of 5,999 | 240 ms | 30 ms | no |
| 1 | 19 | 6 | 1,104,860 | 370.2 | 504,470 | 0.457 | 11.84 | 10.7 | 91% | 1.80 | 4,096 | 4,935 of 6,098 | 220 ms | 33 ms | no |
| 1 | 19 | 8 | 1,170,276 | 378.9 | 874,440 | 0.747 | 10.50 | 9.0 | 89% | 1.02 | 4,096 | 1,774 of 6,002 | 2,503 ms | 54,805 ms | no, the sockets fell behind |
| 2 | 5 | 1 | 180,054 | 58.5 | 165,678 | 0.920 | 2.02 | 11.2 | 22% | 1.30 | 299 | 0 of 5,999 | 5 ms | 5 ms | yes |
| 2 | 5 | 1.55 | 280,300 | 90.2 | 258,155 | 0.921 | 3.16 | 11.3 | 32% | 1.25 | 3,406 | 0 of 6,000 | 14 ms | 5 ms | yes |
| 2 | 5 | 1.55 | 280,342 | 90.2 | 258,184 | 0.921 | 3.16 | 11.3 | 32% | 1.25 | 1,045 | 0 of 6,002 | 6 ms | 4 ms | yes |
| 3 | 0 | 1 | 132,435 | 40.1 | 122,564 | 0.925 | 1.72 | 13.0 | 17% | 1.40 | 400 | 0 of 6,001 | 4 ms | 5 ms | yes |
| 3 | 0 | 1.8 | 234,739 | 69.8 | 218,164 | 0.929 | 3.04 | 13.0 | 30% | 1.35 | 426 | 0 of 6,000 | 7 ms | 4 ms | yes |
| 3 | 0 | 1.8 | 234,734 | 69.8 | 218,167 | 0.929 | 2.94 | 12.5 | 29% | 1.35 | 2,386 | 0 of 6,000 | 10 ms | 5 ms | yes |
| 5 | 0 | 1 | 154,858 | 49.8 | 143,198 | 0.925 | 1.83 | 11.9 | 20% | 1.38 | 593 | 0 of 6,001 | 4 ms | 6 ms | yes |
| 5 | 0 | 1.8 | 275,467 | 87.8 | 254,964 | 0.926 | 3.36 | 12.2 | 34% | 1.35 | 617 | 0 of 6,000 | 6 ms | 8 ms | yes |
| 5 | 0 | 1.8 | 275,333 | 87.7 | 254,860 | 0.926 | 3.26 | 11.8 | 34% | 1.32 | 1,552 | 0 of 6,000 | 12 ms | 7 ms | yes |
| 6 | 0 | 0.95 | 147,952 | 48.9 | 135,837 | 0.918 | 1.83 | 12.4 | 19% | 1.39 | 287 | 0 of 5,999 | 7 ms | 6 ms | yes |
| 6 | 0 | 1.97 | 300,542 | 98.8 | 276,236 | 0.919 | 3.71 | 12.4 | 36% | 1.31 | 845 | 0 of 6,001 | 5 ms | 5 ms | yes |

The replay servers used 0.56 to 1.74 cores, and the process held 0.8 to 1.3 GB, of which the recording is 0.30 to 0.51 GB.

## 6. Reading the results

1. Every stage from 132,435 to 300,542 frames a second kept up by all the criteria of section 3: twelve stages over five recordings and three priorities.
   Their worst lag was 4 to 14 ms, the engine used a sixth to just over a third of its core, and the deepest the engine queue got was 287 to 3,406 of its 4,096.
   The highest, run 6 at 300,542 frames a second and 98.8 MB a second, applied 276,236 books a second on 36 percent of the engine's core with a worst lag of 5 ms, from a recording that carried binance at 3,704 frames a second.
2. The engine thread is the first limit.
   Its queue first filled in run 1 at 385,225 frames a second, in 2 of 6,000 samples, with books per frame unchanged from real speed and a worst lag of 25 ms.
   At 570,586 frames a second it was full in 7 percent of the samples, coalescing removed 3 percent of the books, and the worst lag was 141 ms.
   A queue of 4,096 holds about 5 ms of the engine's work, so a burst that lands faster than that fills it even when the engine averages half a core.
   The deepest queue varied between repeats of one speed, 3,406 against 1,045 in run 2, so the bursts and not the average decide when it fills.
3. Past that point the coalescing in `flush_changed` behaves as designed.
   The socket side keeps reading, each waiting market reaches the engine once at its newest state, and the worst lag stayed at 220 to 240 ms at 752,169 and 1,104,860 frames a second while the engine applied 337,577 and 504,470 books a second.
   The 2,503 ms lag of run 1's speed 8 is the tail of that rule, a market waiting its turn in a connection's pending list while the channel stays full, in a stage where the sockets themselves had fallen behind.
4. The socket side has the most headroom.
   It handled every frame up to 1,104,860 a second, 370 MB a second, on about 12 cores, with the servers within 33 ms of their schedule.
   It first fell behind in run 1's speed 8, where the servers ended 55 s behind while 10.5 cores of socket work ran at nice 19 beside the rest of the laptop, so its ceiling on this host is about 1.1 million frames a second.
5. The engine's cost per book ranged from 1.0 to 2.55 µs.
   It falls as the queue holds more work, because one wakeup then serves up to 256 books, and it rises when the thread runs on an efficiency core or shares a core with a busy thread.
   A sampler that read the engine thread's processor every 0.5 s found it on an efficiency core in 118 of 477 samples in run 2 and 109 of 475 in run 3.
   Pinning the engine thread to a performance core was not tried.
6. The socket side costs 11 to 15 µs a frame below saturation, against the 2 to 5 µs that item 6 of the requirements entry expected.
   Where those microseconds go, between the kernel, tungstenite, parsing and the books, was not measured.
   The live run's 32.6 µs a book holds the same work plus TLS, the pollers and a wakeup for nearly every frame.
7. Priority matters on a shared laptop.
   At real speed run 1 at nice 19 cost 15.0 µs a frame and 1.73 µs a book with a deepest queue of 1,054, where run 2 at nice 5 cost 11.2 µs, 1.30 µs and 299.
8. In runs 3 to 5, binance reset three of the four new recording sockets 6 to 20 s after each open, while the live run's established binance sockets were not reset.
   Each reset socket reopened after 0.5 to 0.75 s, because a data frame resets the feed's backoff, so a venue that resets a socket after sending data is redialled about once a second.
   Whether that redialling is what binance limited was not established, and the same rule runs in production.
9. The live run's worst lag in a minute rose from 3 to 9 ms to 10 to 18 ms during run 1's saturated stages and was back at 3 ms a minute later, so the replays did not disturb it in any way its gates could see.

## 7. The sixty venue projection

The 60 venues are the ten with adapters and the 50 survey rows whose verdict is fits as is or fits with a named change, as listed in the answer section of [`2026-09-22-venue-survey.md`](./2026-09-22-venue-survey.md).
The projection is the method of 2026-09-29, rebuilt because its script was not kept.
A venue's per market frame rate, from the load probe in the throughput row of its `docs/profiles/<venue>/websocket.md`, is multiplied by the perpetuals the engine would stream there.
The ten adapters use the per market rates of run 1's recording, multiplied by their whole catalog.

| Venue | Perpetuals | Frames a second per market | Projected frames a second | Projected MB a second | Source of the rate |
|---|---:|---:|---:|---:|---|
| bitget | 862 | 7.20 | 6,210 | 1.86 | run 1 recording of 759 markets |
| binance | 802 | 7.22 | 5,787 | 3.14 | run 1 recording of 729 markets |
| bybit | 873 | 6.54 | 5,707 | 1.44 | run 1 recording of 753 markets |
| krakenfutures | 204 | 27.62 | 5,635 | 0.70 | run 1 recording of 181 markets |
| gate | 1,024 | 3.88 | 3,978 | 0.90 | run 1 recording of 845 markets |
| zoomex | 697 | 5.39 | 3,755 | 0.99 | probe of 697 markets, median, relays bybit |
| backpack | 91 | 32.82 | 2,986 | 0.53 | probe of 91 markets, mean |
| kucoin | 673 | 3.82 | 2,571 | 0.62 | probe of 100 markets, mean, every sixth by turnover |
| bitunix | 685 | 3.24 | 2,217 | 1.50 | probe of 300 markets, mean |
| bitfinex | 75 | 28.44 | 2,133 | 0.06 | probe of 36 markets, mean, raw book channels |
| weex | 995 | 1.91 | 1,900 | 0.52 | probe of 100 markets, median, every tenth by volume |
| okx | 493 | 3.47 | 1,712 | 0.93 | run 1 recording of 473 markets |
| deepcoin | 348 | 4.52 | 1,572 | 1.09 | probe of 348 markets, median |
| bingx | 909 | 1.72 | 1,560 | 0.76 | probe of 199 markets, median, every third by volume, gunzipped bytes |
| pionex | 561 | 2.29 | 1,285 | 1.33 | probe of 100 markets, median, every fifth by quote volume |
| htx | 353 | 3.31 | 1,167 | 0.39 | probe of 150 markets, median, every other by turnover, inflated bytes |
| hotcoin | 567 | 1.86 | 1,055 | 2.86 | probe of 300 markets, mean, every other by turnover |
| coinw | 385 | 2.67 | 1,028 | 9.56 | probe of 100 markets, mean, whole 200 level book per frame |
| mexc | 1,167 | 0.88 | 1,025 | 0.85 | run 1 recording of 650 markets |
| poloniex | 18 | 51.28 | 923 | 0.18 | probe of 18 markets, mean |
| cryptocom | 396 | 2.32 | 920 | 0.33 | probe of 396 markets, mean |
| btse | 211 | 4.15 | 876 | 0.70 | probe of 211 markets, mean, two sockets summed |
| toobit | 757 | 1.11 | 838 | 0.84 | probe of 300 markets, median, 300 busiest, diffDepth |
| ourbit | 735 | 1.04 | 764 | 0.39 | probe of 150 markets, median, merged deltas, the full depth channel was tested on 2 or 3 symbols |
| xt | 691 | 1.09 | 751 | 0.26 | probe of 400 markets, median, 400 by turnover |
| x-me | 266 | 2.00 | 532 | 0.24 | probe of 266 markets, mean |
| whitebit | 397 | 1.21 | 480 | 0.20 | probe of 397 markets, mean |
| orangex | 578 | 0.82 | 472 | 0.38 | probe of 578 markets, median |
| fameex | 213 | 2.00 | 426 | 1.23 | probe of 213 markets, median, gunzipped bytes |
| uzx | 60 | 6.92 | 415 | 1.98 | probe of 60 markets, median |
| koinbay | 127 | 3.20 | 406 | 0.61 | probe of 127 markets, guess, 93 live books at 3 a second plus marks pushed unasked |
| biconomy | 295 | 1.28 | 376 | 0.27 | probe of 295 markets, mean |
| phemex | 116 | 2.42 | 280 | 0.08 | probe of 101 markets, median |
| globe | 28 | 10.00 | 280 | 0.80 | probe of 28 markets, mean |
| bydfi | 255 | 1.07 | 272 | 0.15 | probe of 150 markets, mean, 150 busiest |
| digifinex | 103 | 2.50 | 258 | 0.05 | probe of 30 markets, median, 30 busiest, inflated bytes |
| hibt | 82 | 2.49 | 204 | 0.17 | probe of 82 markets, median |
| hitbtc | 50 | 3.91 | 195 | 0.04 | probe of 50 markets, mean |
| deribit | 131 | 1.30 | 170 | 0.08 | probe of 131 markets, median |
| bigone | 97 | 1.55 | 150 | 0.03 | probe of 1 market, guess, BTCUSDT only, one market per socket |
| trubit-pro | 40 | 2.50 | 100 | 0.04 | probe of 40 markets, guess, frames every 200 to 800 ms |
| bitradex | 56 | 1.68 | 94 | 0.06 | probe of 56 markets, mean |
| tothemoon | 13 | 6.99 | 91 | 0.07 | probe of 13 markets, mean, with twin books and tickers |
| nonkyc | 80 | 1.11 | 89 | 0.04 | probe of 80 markets, mean, Orderly shared book |
| bitmart | 100 | 0.86 | 86 | 0.05 | probe of 100 markets, median, the 100 that trade, 259 more are dead |
| gleec-btc | 30 | 2.77 | 83 | 0.02 | probe of 30 markets, mean |
| niza | 80 | 0.96 | 76 | 0.01 | probe of 80 markets, mean, Orderly shared book |
| aivora | 72 | 0.96 | 69 | 0.19 | probe of 77 markets, mean |
| bitstamp | 20 | 3.20 | 64 | 0.10 | run 1 recording of 17 markets |
| fmfwio | 23 | 2.65 | 61 | 0.02 | probe of 23 markets, mean |
| changelly-pro | 18 | 3.17 | 57 | 0.02 | probe of 18 markets, median |
| mandala | 24 | 1.68 | 40 | 0.06 | probe of 1 market, guess, D20 on BTC only |
| hyperliquid | 178 | 0.18 | 33 | 0.05 | probe of 178 markets, mean, default l2Book, fast plus bbo was 672 |
| echobit | 124 | 0.24 | 30 | 0.06 | probe of 124 markets, median |
| gemini | 13 | 1.99 | 26 | 0.01 | run 1 recording of 6 markets |
| delta | 6 | 4.27 | 26 | 0.01 | probe of 6 markets, mean, with mark, index and funding |
| hashkey | 2 | 10.00 | 20 | 0.06 | probe of 2 markets, guess, frames about every 100 ms on an active book |
| valr | 4 | 1.89 | 8 | 0.01 | probe of 4 markets, mean, the four OB_L1_DIFF books |
| woo | 223 | 0.01 | 3 | 0.00 | probe of 100 markets, mean, 100 busiest |
| coinbase | 131 | 0.00 | 0 | 0.00 | paused, no book |
| total | 18,607 | | 64,328 | 39.9 | |

That is 5.56 billion frames and 3.45 TB a day at the probed hours.

- Each probe ran at its own hour, from 2026-09-22 to 2026-09-24 for the survey venues and at 06:02 UTC on 2026-10-02 for the adapters.
  Rates swing about two times by hour, as section 5.5 of [`2026-09-17-node-event-loop-ceiling.md`](./2026-09-17-node-event-loop-ceiling.md) measured on the same channels at 23:40 and 02:00.
- Five rates are guesses from partial probes: hashkey, koinbay, trubit-pro, mandala and bigone, 717 frames a second together, 1.1 percent of the total.
- Five rates come from each venue's busiest markets: toobit, bydfi, digifinex, xt and woo.
  Halving those five gives 63,267.
- Coinbase counts zero, since its perpetuals are paused.
- Zoomex relays bybit's book, and Niza and Nonkyc share Orderly's, so their frames are load for the engine but not independent markets.

Section 5.6 of [`2026-09-17-node-event-loop-ceiling.md`](./2026-09-17-node-event-loop-ceiling.md) bounded the fifth run's five venues at 65,543 frames a second if every market moved at its channel's cadence, which is 4.7 times the 14,000 baseline, and it read a market wide flash crash as three to five times the baseline.
Applied to the projection, a crash at 60 venues is 193,000 to 302,000 frames a second.
No crash has been measured at 60 venues, and this range is inferred.

## 8. Against the projection

The projection's average, 64,328 frames a second, is a third of the 194,010 the server handled at real speed in run 1, and the crash range of 193,000 to 302,000 ends where run 6's 300,542 kept up.
The replay is harder than the projection in three ways: 63 venues against 60, 30,891 markets against 18,607 perpetuals, and copies whose bursts coincide.
It is easier in four: no TLS, no network, no anchor polls and no database writes.
So the measured statement is this: on one laptop, the Rust server keeps up with 300,000 frames a second from 63 venues, with every frame handled, nothing coalesced and every book in the engine within 5 ms of its arrival, which reaches the top of the projected crash range of the 60 venues that fit.
The headroom above that is smaller than the socket side suggests, because the engine queue first filled at 385,225 frames a second, 28 percent higher.

## 9. Reproducing

From `server/`:

```bash
cargo test --release load_replay -- --ignored --nocapture
REPLAY_RECORD_SECONDS=60 REPLAY_COPIES=7 REPLAY_SPEEDS=1,2,3,4,6,8 nice -n 19 cargo test --release load_replay -- --ignored --nocapture
```

`LIVE_VENUES` picks the venues, and `REPLAY_THREADS` the replay servers' runtime size.
Each stage prints one `REPLAY stage` line with every figure above and its verdict.
