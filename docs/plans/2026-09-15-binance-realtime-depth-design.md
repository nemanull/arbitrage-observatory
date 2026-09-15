# Binance real time depth, design

Design of record for moving the Binance book feed off the 100 ms snapshot channel.
Research: [`research/2026-09-15-binance-realtime-depth.md`](../research/2026-09-15-binance-realtime-depth.md).

## Problem

The Binance book feed subscribes `@depth20@100ms` and treats every frame as a whole book, at [`binance.ts:15`](../../server/src/venues/binance/binance.ts) and [`binance.ts:110`](../../server/src/venues/binance/binance.ts).
That channel publishes a snapshot every 100 ms, so our view of Binance carries up to 100 ms of the venue's own batching before the network delay starts.
A price that lives for less than one interval never reaches the engine at all.

Row 2714 of the seventh run is the case that raised it.
Binance was dumped at 00:12:38.146 and our view of the crash arrived 108 ms later, of which about 39 ms was this channel waiting for its next snapshot.

## Decisions

1. Binance subscribes two channels per market, `@depth@0ms` for changes and `@depth20@100ms` for periodic truth.
   The measured gain is a median of 29 ms and a p90 of 82 ms on the first sight of a new best bid, across all 571 perpetuals.
2. Both channels are carried on the combined `/stream` endpoint, so every frame names the channel it came from.
   The raw `/ws` endpoint sends both as `depthUpdate` with identical fields, and nothing in the payload separates a snapshot from a diff.
3. The book is built from diffs, chained on `pu`.
   A diff applies when `u` is greater than the last applied id and either `pu` equals it or `U` is at most one past it.
   The probe saw 67,987 frames chain on `pu` and 27,805 straddle, and none outside those two shapes.
4. A snapshot whose `u` is ahead of the last applied id reseeds the book.
   A snapshot at or behind it is dropped, because the diffs already carry that state.
   58% of snapshots were ahead of every diff received so far, so this is the common path, not a repair path.
5. A diff level outside the window the last snapshot covered is ignored.
   The window is the snapshot's deepest bid price and deepest ask price.
   Without this a level of rank 21 or worse can appear inside a top 20 reading whenever the levels above it are consumed.
6. A sequence break marks the symbol unsynced and waits for the next snapshot, which is at most about 100 ms away.
   It no longer terminates the connection, which today costs 200 markets their books through [`VenueFeed.ts:225`](../../server/src/feeds/book/VenueFeed.ts).
7. Every applied frame publishes, as on the other delta venues.
   The engine already drops a repeat of the same top prices before discovery at [`Engine.ts:187`](../../server/src/engine/Engine.ts).
8. USD-M and COIN-M use one code path.
   `dstream` answers `@depth@0ms` with the same fields and the same cadence.
9. A diff that empties a side of the window marks the symbol unsynced and publishes nothing.
   An empty side inside the window means the window ran out, not that the venue withdrew the side, and the next snapshot is at most about 100 ms away.
   A real one sided book still reaches the engine, because the snapshot path publishes whatever the venue sent.
   This was added during implementation: the first live smoke run produced 244 one sided books in 62 seconds on binance and none on any other venue, and the fix took that to 0.

## What it costs

Binance delivers 4,470 diff frames per second across 571 markets, against 1,606 snapshot frames per second today.
Bandwidth goes from about 1.7 MB/s to about 3.1 MB/s, which the 2026-09-07 scaling research already treats as unconstrained.
Publishes into the engine rise by roughly the same factor as the frame count.
The single event loop is the known structural blocker, so the publish rate and the loop lag are measured on the first run after this ships.

A market whose book is thinner than 20 levels has its window end at its deepest level.
A new level below that window waits for the next snapshot, so depth can read one level short for up to 100 ms.
Prices are never wrong in that window, only possibly fewer.

## Rejected alternatives

- **`@bookTicker` for the touch.**
  It is about 13 ms faster than the diff stream on the touch, but it carries no depth, and a second writer of the top of book was ruled out on 2026-09-07.
  Its arrival was also the least even of the channels measured, with a p90 of 186 ms against a p50 of 55 ms.
- **REST snapshot plus diffs, the method Binance documents.**
  It spends IP weight the anchor poller already needs, it makes boot wait on 571 REST calls, and a sequence break then costs another call.
  The snapshot channel gives the same seed for free every 100 ms.
- **Diffs only, seeded once.**
  Nothing repairs a break, and the book drifts wherever a level beyond the seed was never touched.
- **Keeping the 100 ms channel and accepting the delay.**
  This is the 2026-09-07 decision that a 100 ms cadence sits below the reaction threshold.
  Row 2714 is the counter example, and the cost of the change is one code path on one venue.

## Verification

- Replay check over 40,200 snapshot boundaries: 0 mismatched levels.
- Sequence breaks over 268,223 diff frames: 0.
- Both channels expose `e,E,T,s,ps,U,u,pu,b,a,st`, which is the shape the existing spec fixture already uses.
- Live smoke of the shipped class through `scripts/probes/book-feed-smoke.mjs` on 2026-09-15 at 01:31 UTC, 62 seconds:
  571 markets subscribed, 571 with a book, 5,208 books per second against about 1,600 before, 0 one sided books, 0 resyncs, 20 levels held on BTC.
