# Depth stream scaling

Date: 2026-09-07, 23:35 to 23:55 UTC, from the development host.
Question: if depth comes from WebSocket streams for every market, what does one Node process pay today at five venues, what would fifty venues cost, and where does the current core architecture stop scaling.
This is the research behind the direction the user stated on 2026-09-07: depth must come from the venue's WebSocket, inbound bandwidth on the VMs is not a constraint, and the venue count will grow from five to more than fifty.
It extends section 2b of [`2026-09-06-venue-depth-endpoints-probe.md`](./2026-09-06-venue-depth-endpoints-probe.md), which measured `JSON.parse` alone with Node's built in `WebSocket` and no books maintained.
Every number here was measured with the scripts under [`../../scripts/probes/`](../../scripts/probes/) on Node 24 with the `ws` package the feeds use.

## 0. Method

- [`ws-depth-pipeline-probe.mjs`](../../scripts/probes/ws-depth-pipeline-probe.mjs) subscribes every live perpetual on the five venues to their depth channels through `ws`, once with permessage-deflate negotiated and once with it refused.
  Every message is decoded, parsed, applied to a maintained sorted book where the venue sends deltas, and its top twenty levels are copied into a flat `Float64Array` block laid out like `ClusterDepth`.
  It measures message rate, decoded and wire bytes, the handler time split into parse, apply and copy, how often the top of the book changed, process CPU, event loop delay and RSS over a twenty second window after a five second settle.
- [`perp-universe-survey.mjs`](../../scripts/probes/perp-universe-survey.mjs) loads the market list of every exchange ccxt 4.5.68 marks as supporting swaps or futures and counts the active perpetual swaps, to size the universe fifty venues would stream.

The development host is a 12th generation i7 with 20 hardware threads, 31 GB of RAM, and about 24 GB of swap in use during the runs.
CPU figures are process CPU time and are not affected by that pressure.
Wall clock figures such as first snapshot latency may be.
Message rates depend on the hour.
The same channels ran at 16,230 messages a second on 2026-09-07 at 02:00 UTC in the earlier probe and at 8,300 to 9,400 here at 23:40 UTC, so every extrapolation below is a range between the two.

## 1. The pipeline at five venues, whole universe

2,269 markets: 571 binance USD-M, 819 bybit linear, 473 okx, 275 kraken, 131 coinbase, on 18 connections.
Coinbase `level2` takes about 30 products per connection, which is why it has five.

### 1a. Per venue, permessage-deflate negotiated

| venue and channel | connections | msgs per s | decoded KB per s | wire KB per s | wire over decoded | avg bytes | parse ms per s | apply ms per s | copy ms per s | µs per message | top changes per s | share of messages | levels held |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| binance `depth20@100ms` | 3 | 1,347 | 1,339 | 477 | 0.36 | 1,018 | 36.4 | 9.9 | 1.0 | 35.1 | 131 | 0.10 | 22,720 |
| bybit `orderbook.50` | 5 | 3,270 | 710 | 503 | 0.71 | 222 | 20.3 | 6.9 | 2.3 | 9.0 | 254 | 0.08 | 79,841 |
| okx `books` | 2 | 1,108 | 415 | 274 | 0.66 | 384 | 9.5 | 3.1 | 0.6 | 11.9 | 69 | 0.06 | 343,165 |
| krakenfutures `book` | 3 | 2,391 | 285 | 290 | 1.02 | 122 | 7.6 | 2.2 | 1.2 | 4.6 | 203 | 0.08 | 26,945 |
| coinbase `level2` | 5 | 213 | 130 | 50 | 0.39 | 624 | 2.1 | 0.8 | 0.2 | 14.8 | 35 | 0.17 | 9,840 |
| total | 18 | 8,328 | 2,879 | 1,595 | 0.55 | | 75.9 | 22.8 | 5.3 | 12.5 | 692 | 0.08 | 482,511 |

Process CPU 43.8 percent of one core, 33.8 user and 10.0 system.
Event loop delay p50 5.0 ms, p99 5.9 ms, max 6.9 ms, against a 5 ms sampling floor, so the loop never queued.
RSS 173 to 185 MB, heap 33 to 42 MB.
Coverage was complete on four venues and 568 of 571 on binance, whose `depth20` pushes only on change, so an illiquid symbol shows nothing for seconds.
First snapshot p50 and p90 in milliseconds: binance 582 and 4,971 with a maximum of 24,363, bybit 531 and 700, okx 578 and 685, kraken 514 and 656, coinbase 165 and 168.

### 1b. Per venue, permessage-deflate refused

The same universe thirty seconds later.

| venue and channel | msgs per s | decoded KB per s | wire KB per s | parse ms per s | apply ms per s | copy ms per s | µs per message | top changes per s |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| binance `depth20@100ms` | 1,559 | 1,555 | 1,561 | 43.7 | 11.7 | 1.1 | 36.3 | 156 |
| bybit `orderbook.50` | 3,633 | 799 | 813 | 23.2 | 7.5 | 2.6 | 9.2 | 329 |
| okx `books` | 1,229 | 475 | 480 | 10.1 | 3.3 | 0.6 | 11.4 | 91 |
| krakenfutures `book` | 2,735 | 327 | 333 | 6.9 | 2.1 | 1.2 | 3.7 | 227 |
| coinbase `level2` | 237 | 152 | 153 | 2.5 | 0.8 | 0.2 | 15.3 | 38 |
| total | 9,393 | 3,308 | 3,340 | 86.5 | 25.4 | 5.7 | 12.5 | 842 |

Process CPU 24.6 percent of one core, 20.8 user and 3.7 system.
Event loop delay p50 5.1 ms, p99 6.0 ms, max 10 ms.
RSS 252 MB, heap 52 to 66 MB, with the first run's books still resident.

### 1c. What the two runs say

- The handler costs 12.5 µs per message either way, and parsing is 73 percent of it.
  Applying deltas to a sorted book is 2.7 µs per message and copying twenty levels into the block is 0.6 µs, so the maintained book is not where the time goes.
- Binance is the expensive venue per message at 35 µs, because every message is a complete forty level snapshot of about a kilobyte of decimal strings.
  Kraken is the cheapest at 4 µs, because every delta is one level.
- Process CPU per message is 52.6 µs with deflate and 26.2 µs without.
  The difference is inflation, which `ws` runs through a `zlib.InflateRaw` stream on the libuv threadpool with a write and a flush per message, at `server/node_modules/ws/lib/permessage-deflate.js:362-365`.
  System time rose from 3.7 to 10.0 percent with deflate, which is the threadpool handoff.
- Between the handler's 12.5 µs and the plain run's 26.2 µs sit TLS decryption, WebSocket framing, the `Buffer` to string decode, garbage collection and timers.
- A second pair of runs ten minutes later split the process time by thread with `process.threadCpuUsage`.
  With deflate the process spent 44.9 percent of a core and the event loop thread 32.7 percent, over 8,252 messages a second, which is 54 µs per message in the process and 40 µs on the loop.
  Without deflate the process spent 22.4 percent and the loop 22.3 percent, over 7,621 messages a second, which is 29 µs per message, all of it on the loop.
  So inflation costs the event loop itself about 10 µs per message in stream bookkeeping and callbacks, and another 15 µs on the threadpool.
  The handler read 13.1 and 13.5 µs per message in these two runs.
- Only 8 percent of depth messages move the best bid or the best ask.
  If layer 1 were read from the top of the maintained book, the whole universe would produce 700 to 850 ticks a second for discovery, and the repeat check at [`Engine.ts:116`](../../server/src/engine/Engine.ts) already drops the other 92 percent before any scan.
- The books hold 482,511 levels for 2,269 markets, 343,165 of them on okx, whose `books` channel is 400 levels a side.

## 2. The cost model

| quantity | value | source |
|---|---:|---|
| handler time per message | 12.5 to 13.5 µs | 1a, 1b and the second pair of runs |
| event loop time per message, deflate refused | 26 to 29 µs | 24.6 percent of a core over 9,393 messages a second, then 22.3 percent over 7,621 |
| event loop time per message, deflate negotiated | 40 µs | 32.7 percent of the loop thread over 8,252 messages a second |
| process time per message, deflate negotiated | 53 to 54 µs | 43.8 percent of a core over 8,328 messages a second, then 44.9 over 8,252 |
| one event loop at 100 percent, deflate refused | 34,000 to 38,000 messages a second | one second over 26 to 29 µs |
| one event loop at 100 percent, deflate negotiated | about 25,000 messages a second | one second over 40 µs |
| one event loop at a 60 percent budget, deflate refused | 20,000 to 23,000 messages a second | the budget leaves room for the layer 1 channels, discovery, the sweep and reconnect bursts |

The 60 percent budget is a choice and not a measurement.
The loop delay stayed at the sampling floor at 25 and at 44 percent, and the earlier probe saw the same at 56 percent, so the loop tolerates more.
The reason to stop well short of 100 percent is section 5.3, where queueing on the loop silently moves the engine's clock.

## 3. The fifty venue universe

The survey reached 54 of 58 ccxt exchanges with derivatives support on 2026-09-07 at about 23:45 UTC.
Blofin, bullish and extended answered 403 from this host and mudrex needs credentials.
ccxt lists binance, kucoin and okx under two or three ids each, and those duplicates are folded below.

| rank | ccxt id | active swaps | linear | inverse | ccxt.pro `watchOrderBook` | cumulative |
|---:|---|---:|---:|---:|---|---:|
| 1 | `mexc` | 1,186 | 1,176 | 10 | yes | 1,186 |
| 2 | `weex` | 1,022 | 1,022 | 0 | no | 2,208 |
| 3 | `gate` | 988 | 987 | 1 | yes | 3,196 |
| 4 | `bingx` | 912 | 912 | 0 | yes | 4,108 |
| 5 | `bitget` | 845 | 834 | 11 | yes | 4,953 |
| 6 | `bybit` | 841 | 819 | 22 | yes | 5,794 |
| 7 | `binance` | 782 | 762 | 20 | yes | 6,576 |
| 8 | `toobit` | 758 | 758 | 0 | yes | 7,334 |
| 9 | `xt` | 755 | 722 | 33 | yes | 8,089 |
| 10 | `kucoin` | 683 | 679 | 4 | yes | 8,772 |
| 11 | `aster` | 566 | 566 | 0 | yes | 9,338 |
| 12 | `okx` | 473 | 458 | 15 | yes | 9,811 |
| 13 | `zebpay` | 421 | 0 | 421 | no | 10,232 |
| 14 | `cryptocom` | 375 | 375 | 0 | yes | 10,607 |
| 15 | `bitmart` | 359 | 359 | 0 | yes | 10,966 |
| 16 | `htx` | 335 | 330 | 5 | yes | 11,301 |
| 17 | `hyperliquid` | 310 | 310 | 0 | yes | 11,611 |
| 18 | `whitebit` | 305 | 305 | 0 | yes | 11,916 |
| 19 | `krakenfutures` | 279 | 275 | 4 | yes | 12,195 |
| 20 | `bydfi` | 270 | 260 | 10 | yes | 12,465 |
| 21 | `deepcoin` | 266 | 261 | 5 | yes | 12,731 |
| 22 | `coinex` | 223 | 221 | 2 | yes | 12,954 |
| 23 | `woo` | 223 | 223 | 0 | yes | 13,177 |
| 24 | `lighter` | 216 | 216 | 0 | yes | 13,393 |
| 25 | `grvt` | 194 | 194 | 0 | yes | 13,587 |
| 26 | `modetrade` | 138 | 138 | 0 | yes | 13,725 |
| 27 | `woofipro` | 138 | 138 | 0 | yes | 13,863 |
| 28 | `coinbaseinternational` | 131 | 131 | 0 | yes | 13,994 |
| 29 | `phemex` | 119 | 111 | 8 | yes | 14,113 |
| 30 | `digifinex` | 109 | 101 | 8 | no | 14,222 |
| 31 | `bitfinex` | 93 | 93 | 0 | yes | 14,315 |
| 32 | `bigone` | 91 | 89 | 2 | no | 14,406 |
| 33 | `apex` | 88 | 88 | 0 | yes | 14,494 |
| 34 | `backpack` | 83 | 83 | 0 | yes | 14,577 |
| 35 | `dydx` | 78 | 78 | 0 | yes | 14,655 |
| 36 | `pacifica` | 75 | 75 | 0 | yes | 14,730 |
| 37 | `paradex` | 64 | 64 | 0 | yes | 14,794 |
| 38 | `hitbtc` | 55 | 55 | 0 | yes | 14,849 |
| 39 | `deribit` | 34 | 32 | 2 | yes | 14,883 |
| 40 | `fmfwio` | 24 | 24 | 0 | no | 14,907 |
| 41 | `bitstamp` | 20 | 20 | 0 | yes | 14,927 |
| 42 | `poloniex` | 18 | 18 | 0 | yes | 14,945 |
| 43 | `hibachi` | 15 | 15 | 0 | no | 14,960 |
| 44 | `gemini` | 13 | 13 | 0 | yes | 14,973 |
| 45 | `delta` | 6 | 6 | 0 | no | 14,979 |
| 46 | `bitmex` | 4 | 2 | 2 | yes | 14,983 |
| 47 | `hashkey` | 2 | 2 | 0 | yes | 14,985 |

47 platforms list 14,985 active perpetual swaps.
The five venues streamed today are 2,506 of them in ccxt's count and 2,269 in the venues' own catalogs, so the whole universe is about six times today's.
Seven platforms have no `watchOrderBook` in ccxt.pro and would need their protocol read from their own documentation.
[`2026-07-30-ccxt-ws-ingest-feasibility.md`](./2026-07-30-ccxt-ws-ingest-feasibility.md) already rejected ccxt.pro as the message path for per message cost, so every venue is a feed class either way.

### 3a. Extrapolated load

Per market rates from the two probes: 3.7 messages and 1.27 KB a second per market at 23:40 UTC, 7.2 messages and 2.08 KB a second per market at 02:00 UTC.
The five venues measured are among the most active, so per market rates on the long tail are as likely to be lower as higher, and no measurement here covers them.

| quantity | at the 23:40 UTC rates | at the 02:00 UTC rates |
|---|---:|---:|
| messages a second | 55,000 | 107,000 |
| decoded MB a second | 19 | 31 |
| decoded TB a day, which is also the wire figure with deflate refused | 1.6 | 2.7 |
| event loop cores, deflate refused, at 26 to 29 µs | 1.4 to 1.6 | 2.8 to 3.1 |
| event loop cores, deflate negotiated, at 40 µs | 2.2 | 4.3 |
| process cores, deflate negotiated, at 53 to 54 µs | 2.9 to 3.0 | 5.7 to 5.8 |
| handler cores alone, at 12.5 to 13.5 µs | 0.7 | 1.3 to 1.4 |
| shards at the 60 percent budget, deflate refused | 3 | 5 to 6 |
| book levels held, at 213 per market | about 3,200,000 | |
| cluster index at width 47 | 100 to 170 MB for 3,000 to 5,000 clusters | |

Per cluster memory at width 47 is about 34 KB: four depth arrays of `47 × 20` doubles from [`ClusterIndexBuilder.ts:34-37`](../../server/src/engine/ClusterIndexBuilder.ts), and eight layer 1 arrays of 47 doubles from `Cluster` in [`types.ts`](../../server/src/engine/types.ts).
Most slots are empty on a 47 venue cluster.
That waste is a hundred megabytes and not a constraint.

## 4. What the core architecture already gets right

- A pair is a closed unit.
  `validate` at [`OpportunityManager.ts:44`](../../server/src/engine/OpportunityManager.ts) reads one cluster's arrays and that pair's routes map and nothing else, and the scan at [`OpportunityManager.ts:548`](../../server/src/engine/OpportunityManager.ts) is a loop over that cluster's venue slots.
  Nothing in the engine reads across pairs, so the engine shards by pair with no synchronization.
- Feeds already subscribe only what the engine tracks, at [`orchestrator.ts:214`](../../server/src/orchestrator.ts), so a shard that builds fewer clusters subscribes fewer markets without a feed change.
- The depth block was laid out for a writer that streams.
  `updateDepth` at [`Engine.ts:199`](../../server/src/engine/Engine.ts) takes a complete top twenty per call, validates order in twenty comparisons, and runs no discovery, and the block is one flat array per side that a shard owns outright.
- The repeat check at [`Engine.ts:116`](../../server/src/engine/Engine.ts) makes a depth derived layer 1 cheap, because 92 percent of depth messages leave the top unchanged and never reach the scan.
- Discovery is O(width) per tick and width is the venue count, at [`OpportunityManager.ts:542-585`](../../server/src/engine/OpportunityManager.ts).
  At 47 venues and 850 ticks a second across the universe that is under a millisecond a second.

## 5. Where it stops

### 5.1 One event loop is the blocker

Everything runs on one thread: the sockets, parsing, books, the engine, the sweep timer and the queue writes.
At five venues that thread is at 22 to 33 percent of a core, and at fifty venues section 3a puts the same work at 1.4 to 3.1 cores without compression and 2.2 to 4.3 with it.
No arrangement of the code inside one process changes that, because parsing is 73 percent of the handler and V8 parses JSON on the calling thread.
This is the one finding that blocks the fifty venue target on the current architecture.

### 5.2 The shard the architecture allows

Shard by pair, shared nothing.
Each shard builds its own `ClusterIndexBuilder` over its share of pairs, its own `Engine`, its own feeds for the markets it tracks, and its own BullMQ `Queue`.
The `OpportunityWorker` stays single, because it reads the queue and never touches a cluster.
What changes:

- `ClusterIndexBuilder` gains a pair predicate next to the `DENIED_PAIRS` check at [`ClusterIndexBuilder.ts:158`](../../server/src/engine/ClusterIndexBuilder.ts), a hash of the pair key modulo the shard count.
- `Orchestrator` builds one `Run` at [`orchestrator.ts:95`](../../server/src/orchestrator.ts), and would spawn N of them as `worker_threads` or processes, each with its shard index.
- Every shard opens at least one connection per venue and channel, so connections grow with N.
  At five venues and N of 8 that is about 80 connections from one IP, against binance's 300 attempts per five minutes, bybit's 500 per five minutes and 1,000 concurrent, okx's three handshakes a second and kraken's 150 reconnects per ten minutes, all from the profiles.
  At fifty venues it is about 2N connections per venue.
  A reconnect storm after a network blip is the case to watch, and separate VMs give separate IPs.

Sharding by venue instead would put the two legs of one pair in different threads and force every discovery through shared memory with a consistency protocol for the bid and ask pair.
The pair shard is the boring solution.

### 5.3 The clock has no arrival stamp

`recvTs` is `Date.now()` taken inside the handler, at [`binance.ts:111`](../../server/src/venues/binance/binance.ts) and [`bybit.ts:103`](../../server/src/venues/bybit/bybit.ts), after the frame has waited in the socket buffer and the event loop queue.
`openedAt`, `sampleTs`, `durationMs`, the minimum episode age and the one second sweep at [`orchestrator.ts:21`](../../server/src/orchestrator.ts) all read that clock.
There is no backpressure and no signal in the engine when the loop falls behind.
An overloaded shard does not fail, it stamps every quote late and every episode's timing shifts.
The runtime instrumentation at [`otel.ts:60`](../../server/src/observability/otel.ts) exports event loop delay, which is the one place this would show, and the budget in section 2 is what keeps it from happening.

### 5.4 Depth is never invalidated

`markStale` at [`Engine.ts:141`](../../server/src/engine/Engine.ts) zeroes `recvTs` and closes routes, and does not touch `depth.writtenAt` or the level counts.
Nothing clears a slot, by decision 6 of [`2026-09-06-depth-block-design.md`](../implemented/2026-09-06-depth-block-design.md).
A streamed book that loses sequence, or a socket that reconnects, leaves its last twenty levels in the block with a `writtenAt` that looks fresh until it ages past whatever gate the reader applies.
A stream writer needs one small addition: a clear on `markStale` and on a resync, so a reader sees zero levels rather than a book that stopped.

### 5.5 Four books to maintain, outside the engine

Only binance sends a complete top twenty per message.
Bybit, okx, kraken and coinbase send a snapshot and then deltas, so a feed has to keep the whole book per market, up to 50, 400, about 2,700 and about 800 levels, and hand the engine the top twenty on each change.
Each has its own resync rule: bybit's `u` and `seq` with `u` equal to 1 as the restart signal, okx's `seqId` and `prevSeqId` with a checksum, kraken's `seq`, and coinbase's per connection `sequence_num`.
That book is the second representation the block design rejected, and the stream direction makes it unavoidable on four of five venues.
It lives in the feed layer, costs 2.7 µs a message and about half a million levels of memory at five venues, and the engine does not see it.
Every new venue adds a feed class and a book rule, which is linear work.
The base class and three venues landed on 2026-08-31 and two more on 2026-09-05.

### 5.6 Compression costs a core it does not need to

`VenueFeed` opens every socket with `new WebSocket(plan.url)` and no options at [`VenueFeed.ts:76`](../../server/src/ws/VenueFeed.ts), so `ws` offers permessage-deflate and four venues accept it.
Refusing it halves process CPU per message, 53 to 26 µs, takes about 10 µs per message off the event loop thread itself, and doubles wire bytes, 1.6 to 3.3 MB a second at five venues and 20 to 30 MB a second at fifty.
With no inbound limit on the VMs this is the one free win, and it is `{ perMessageDeflate: false }` on one line.

### 5.7 Two facts about the streams themselves

- Binance `depth20@100ms` and okx `books` are throttled to 100 ms, where `bookTicker` and `bbo-tbt` are per change and 10 ms.
  A layer 1 read from the book top is therefore 100 ms coarser on those two venues, and the flicker class in [`../bestiary/flicker.md`](../bestiary/flicker.md) is what that coarseness hides.
  Keeping both channels costs the layer 1 subscriptions again and nothing structural.
- Binance pushes `depth20` only on change, so an illiquid market has an empty block for seconds after connect and reconnect, p90 5 seconds and up to 24 in both runs.
  A REST snapshot at subscribe time, from the endpoints in section 1 of [`2026-09-06-venue-depth-endpoints-probe.md`](./2026-09-06-venue-depth-endpoints-probe.md), is the way to fill that gap.

## 6. What this settles

- One Node process carries whole universe depth for five venues at 22 to 25 percent of a core without compression and 44 to 45 with it, with the event loop flat and books maintained.
- The per message cost is 12.5 to 13.5 µs in the handler and 26 to 29 µs on the event loop without compression, so one loop tops out near 34,000 to 38,000 messages a second and a 60 percent budget gives 20,000 to 23,000.
- Fifty venues is about 15,000 markets and 55,000 to 107,000 messages a second, which is 1.4 to 3.1 event loop cores.
  That does not fit one process.
  It fits three to six pair shards, which the engine's pair independence allows without a change to the engine itself.
- The changes the stream direction needs are all outside the engine: a pair predicate in the builder, N runs in the orchestrator, a depth clear on `markStale` and on resync, four maintained books with their resync rules in the feeds, and `perMessageDeflate: false`.
- The drafted REST design's first decision and the Phase 6 premise in [`../ROADMAP.md`](../ROADMAP.md), that depth follows attention and never the universe, both rest on a bandwidth constraint the user has now lifted, and both docs still say so.
