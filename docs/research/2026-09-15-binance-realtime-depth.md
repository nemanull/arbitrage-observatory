# Binance real time depth, measured 2026-09-15

Probes run from the development machine on 2026-09-15 between 00:20 and 01:10 UTC.
They answer one question: can the observatory see Binance earlier than the `@depth20@100ms` channel it uses today, and at what cost.

The question comes from row 2714 of the seventh run, a BAN|USDT bybit-binance row of 29,429 ppm that lived 96 ms.
Binance was dumped at 00:12:38.146 and Bybit followed within 34 ms, while our view of both venues arrived about 108 ms after each venue moved.
Our Binance snapshot channel held about 39 ms of that delay.

## 1. What the delay is made of

Measured against each venue's own timestamp, with the clock check below.

| Measurement | Binance | Bybit | OKX | Coinbase |
| --- | --- | --- | --- | --- |
| Request round trip, minimum of 12 | 98 ms | 172 ms | 112 ms | 92 ms |
| Venue clock minus our clock | -1.8 ms | +3.7 ms | -0.7 ms | +4.1 ms |
| Book frame arrival minus its exchange timestamp | 53 to 69 ms | 89 to 91 ms | 53 ms | not measured |

The clock line matters because every other number here is a difference between two clocks.
All four venues agree with this machine inside 5 ms, so arrival minus exchange timestamp is real delay.

`fstream.binance.com` resolved to 43.206.59.110, which the published AWS ranges place in ap-northeast-1, Tokyo.
Bybit and OKX answer from CloudFront and Cloudflare, so their origin is an inference from the round trip.
A TCP connect completes in about 5.5 ms for every venue because a nearby edge answers it, so connect time measures nothing about the venue.

## 2. How much earlier the faster channels see a new best bid

Forty seconds, six markets per venue, counting the first arrival of each new best bid value on both channels.

| Comparison | Median | p10 | p90 |
| --- | --- | --- | --- |
| Binance `@bookTicker` over `@depth20@100ms` | 42 ms | -2 ms | 101 ms |
| Binance `@depth@0ms` over `@depth20@100ms`, 571 markets | 29 ms | -25 ms | 82 ms |
| OKX `bbo-tbt` over `books` | 31 ms | 0 ms | 81 ms |
| Bybit `orderbook.1` over `orderbook.50` | 1 ms | -2 ms | 10 ms |

Bybit and the venues behind it have nothing to gain.
`bookTicker` is the fastest view of the touch, but it carries no depth, and a second writer of the top of book was ruled out on 2026-09-07.
Its arrival was also the least even of the three, with a p90 of 186 ms against a p50 of 55 ms.

The negative p10 on `@depth@0ms` is the important detail.
Neither Binance channel is uniformly ahead of the other, so the earliest view is the merge of both.

## 3. The whole Binance universe on both channels

One 60 second run, 571 perpetual symbols in TRADING status, each subscribed to `@depth@0ms` and `@depth20@100ms`, three connections of 200 markets.

| Measurement | Value |
| --- | --- |
| Diff frames | 268,223, which is 4,470 per second and 1,484 KB per second |
| Snapshot frames | 96,363, which is 1,606 per second and 1,663 KB per second |
| Diff frames with both sides empty | 0 |
| Sequence breaks, `pu` not equal to the previous `u` | 0 in 268,223 frames |
| Gap between consecutive diff events for one symbol | p10 26 ms, p50 30 ms, p90 256 ms |
| Process CPU, including the probe's own bookkeeping | 37% of one core |

The 30 ms median gap says `@depth@0ms` is not one frame per book change.
It is the fastest published cadence, and it is about three times the cadence we use today.

## 4. The two channels share one update id space

This is what makes a merge possible, and it was the main thing to verify.

- Both channels carry the same fields: `e,E,T,s,ps,U,u,pu,b,a,st`.
- 40,396 of 96,363 snapshots carried a `u` equal to a diff frame already received, and those snapshots arrived a median of 48 ms after that diff.
- 55,836 snapshots were ahead of every diff received so far, which is the case the merge exists for.
- 131 snapshots matched neither, which is a snapshot that landed between two diffs in the same millisecond window.
- The first diff after a snapshot chained onto it in every case: 67,987 had `pu` equal to the snapshot's `u`, and 27,805 straddled it with `U` at or below `u + 1`.

Replay check, which is the design in miniature.
Take one snapshot, apply every diff whose `u` lands after it, then compare the result against the next snapshot inside the price window both snapshots cover.

| Replays compared | Mismatched levels |
| --- | --- |
| 40,200 | 0 |

The other 55,592 replays were skipped because the next snapshot arrived ahead of the diffs that would have bridged it, which is the same 55,836 count as above.
Those are not failures.
They are the case where the snapshot is the newer of the two and the book should be reseeded from it.

## 5. COIN-M

`wss://dstream.binance.com` accepts `@depth@0ms` on `btcusd_perp` and `ethusd_perp`, with the same fields and the same 30 ms median gap.
The inverse family in [`binance.ts`](../../server/src/venues/binance/binance.ts) can use one code path with USD-M.
No inverse market was in a cluster during the seventh run, so this is untested against a real cluster.

## 6. What this supports

A Binance book built from `@depth@0ms` diffs and reseeded from `@depth20@100ms` snapshots.

- It sees a new best bid a median of 29 ms earlier than today, and up to 82 ms earlier.
- It also sees the prices that live for less than one snapshot interval, which the current channel skips entirely.
- A sequence break no longer has to terminate a connection of 200 markets, because the next snapshot is at most about 100 ms away.
  Today a break calls `resync` at [`VenueFeed.ts:225`](../../server/src/feeds/book/VenueFeed.ts), which terminates the socket.
- It needs no REST snapshot, so it adds no weight to an IP budget the anchor poller already spends.

Costs and open items.

- Binance publishes into the engine about three times as often.
  The engine drops a repeat of the same top prices before discovery at [`Engine.ts:187`](../../server/src/engine/Engine.ts), so the added cost is one depth write and one comparison per frame.
  The event loop is the known structural blocker, so the publish rate has to be measured after the change.
- Between two snapshots the book knows only the levels at or better than the last snapshot's twentieth level.
  A diff level beyond that window has to be ignored, otherwise a level of rank 21 or worse can appear inside a top 20 reading.
- Streams per market double, so a 200 market connection carries 400 streams against a documented cap of 1,024.
- The `/ws` endpoint gives frames without a stream name, and a snapshot frame and a diff frame are indistinguishable by content.
  The combined `/stream` endpoint names each frame, and it accepted `SUBSCRIBE` for 100 streams at a time in the probe.

## 7. Verification

Scripts are throwaway probes under the session scratchpad, not committed.
The numbers above come from three runs.

- A 15 second two channel lag probe per venue, reporting arrival minus exchange timestamp.
- A 40 second six market comparison per venue, reporting the lead of the faster channel.
- A 60 second 571 market Binance probe, reporting rates, sequence breaks, alignment and the replay check.

Rerun the third one before implementing if more than a few days pass, because it is the one that decides the design.
