# Depth sequence gaps and channel cadence

Date: 2026-09-08 00:58 to 01:20 UTC, which is the evening of 2026-09-07 local.
Question: how often do the four delta depth streams lose a message, does a book maintained from them stay correct, and how far behind that book are the venues' own top of book channels.
The user raised the question on 2026-09-07 while deciding to make the maintained book the only source of both layer 1 and depth, and doubted that venue drops are real in practice.
Two passes answered it: a live probe of the whole universe on five venues, and a documentation pass over the venue pages, the repo profiles, ccxt.pro and public issue trackers.
It follows [`2026-09-07-depth-stream-scaling.md`](./2026-09-07-depth-stream-scaling.md), which measured the cost of the same streams.

## 0. Method

- [`ws-depth-gap-probe.mjs`](../../scripts/probes/ws-depth-gap-probe.mjs) subscribes every live perpetual on bybit `orderbook.50`, okx `books`, kraken `book` and coinbase `level2`, maintains a book per market, and checks each venue's sequence field on every frame.
  It also subscribes bybit `orderbook.1`, the kraken and coinbase `ticker` channels and binance `depth20@100ms` with `bookTicker`, and compares each venue's top of book channel against the maintained book.
  Every thirty seconds it picks up to three markets per venue that received no delta in the last three seconds, fetches the venue's REST book, and compares the top ten levels of each side exactly.
  On a gap it would resubscribe the market and time the fresh snapshot, and that path never ran.
  It prints one JSON summary line per minute, so a killed run still has data.
- The run used 26 connections from one IP with permessage-deflate refused, on the development host, and was stopped after 1,263 seconds of a planned 1,500.
- The documentation pass fetched the official pages on 2026-09-07, read `docs/profiles/*/websocket.md`, read the ccxt.pro 4.5.68 order book handlers under `server/node_modules/ccxt/js/src/pro/`, and searched the ccxt, cryptofeed, tardis, hummingbot and nautilus trackers.

One window, one host, a quiet Monday night hour UTC.
No venue incident, restart or volatility spike happened during it, so the gap rate under stress is not measured here.

## 1. Gaps

| venue and channel | markets | msgs per s | deltas in the window | gaps | out of order | venue re-snapshots | socket closes |
|---|---:|---:|---:|---:|---:|---:|---:|
| bybit `orderbook.50` | 819 | 5,957 | 5,763,983 | 0 | 0 | 0 | 0 |
| okx `books` | 473 | 1,513 | 1,909,072 | 0 | 0 | 0 | 0 |
| krakenfutures `book` | 275 | 3,667 | 4,378,015 | 0 | 0 | 0 | 0 |
| coinbase `level2` | 131 | 406 | 430,804 | 0 | 0 | 0 | 0 |
| binance `depth20@100ms` | 571 | 6,345 | 2,011,078 snapshots | none to detect | | every message | 6 |

12.48 million deltas across 596 market-hours, zero gaps, zero out of order counters, zero venue initiated re-snapshots.
The upper bound this supports is roughly one gap per 600 market-hours at this hour of day.
Bybit sent no `u` equal to 1, okx sent 12 empty liveness updates and no reset, and every book on every venue was held at the end.
Binance closed three of its connections six times in 21 minutes, the close codes were not captured because the sample buffer was full of subscribe acknowledgements, and each reconnect re-snapshotted every symbol on the connection.

The probe settled the sequence semantics that the documentation leaves open:

- Kraken's `seq` is per product.
  Read that way it was consecutive on all 4,378,015 deltas, and read per connection it showed 2,548,740 violations.
- Coinbase's `sequence_num` is one counter per connection across every channel, and it was consecutive on every message including `heartbeats` and `subscriptions` acknowledgements.
  No frame lacked it, so the profile's line that subscription confirmations carry no sequence number is wrong for this feed.
- Okx's `prevSeqId` equalled the last `seqId` on every update.
- Bybit's `u` advanced by exactly one on every delta.

Recovery after a gap, the resubscribe latency and whether a gapped book had actually diverged, has no data, because no gap occurred.

## 2. Correctness of the maintained book

| check | result |
|---|---|
| bybit `orderbook.1` level against the maintained `orderbook.50` top at equal `seq` | 253,673 comparisons, 0 mismatches |
| okx `checksum` | present on all 1,909,072 updates and always 0, deprecated on 2026-06-23, not verifiable |
| REST top ten of both sides on quiet markets, all four venues | 422 checks, 418 exact matches, 4 mismatches, 75 voided by a delta arriving during the fetch |

| venue | REST checks | exact | mismatches | voided |
|---|---:|---:|---:|---:|
| bybit | 103 | 103 | 0 | 23 |
| okx | 103 | 103 | 0 | 22 |
| krakenfutures | 112 | 112 | 0 | 11 |
| coinbase | 104 | 100 | 4 | 19 |

The four mismatches are all coinbase, and all four markets had received a delta 65 to 320 ms before the fetch started, so they were no longer quiet.
The probe checked quietness when it picked the candidates and not again at fetch time, which is a flaw in the probe.
COMP-PERP-INTX showed REST with an extra best bid and a moved level, consistent with REST being newer by a fill and a new order, INX-PERP-INTX matched on the top three of both sides and differed in ask count deeper down, and STRK-PERP-INTX showed REST with an extra bid and a best ask one tick tighter.
No sequence gap accompanied any of them and the same markets matched on other checks.
They are timing ambiguous, not evidence of a book error, and not cleared either.

## 3. Cadence of the top of book channels against the book

"Ticker behind book" is the time from a change of the maintained book's top until the venue's top of book channel shows the same top.
"Book behind ticker" is the reverse.

| venue | top of book channel | ticker messages | disagrees with the book on arrival | episodes over 2 s | ticker behind book ms p50, p90, p99 | book behind ticker ms p50, p90 |
|---|---|---:|---:|---:|---|---|
| krakenfutures | `ticker` | 250,485 | 4.0 % | 2,245 | 994, 1,930, 3,793 over 63,467 cases | 288, 1,063 over 315 cases |
| coinbase | `ticker` | 75,921 | 11.3 % | 6 | 288, 471, 927 over 44,730 cases | 26, 160 over 2,466 cases |
| binance | `bookTicker` against `depth20@100ms` | 5,999,382 | 52.9 % | 171 | 24, 2,200 over 846 cases | 70, 105, 253 over 260,732 cases |
| bybit | `orderbook.1` against `orderbook.50` | 1,755,851 | 36.5 % | 21 | 4, 12, 37 over 102,879 cases | 10, 23, 60 over 386,044 cases |

Kraken, ten most active markets: the book top changed 4.7 to 10.6 times a second, the ticker sent 0.7 to 0.9 messages a second, and the ticker reported a top change 0.84 to 1.64 s after the book at p50 and 1.9 to 4.1 s at p90.
PF_ZECUSD had 10.6 top changes a second against 0.9 ticker messages, PF_HYPEUSD 10.1 against 0.88, PF_ORCAUSD 9.5 against 0.7 with the ticker 1,644 ms behind at p50, PF_TAOUSD 7.9 against 0.84, PF_RAYUSD 7.2 against 0.72.
The book moved last in 315 of 63,782 resolutions, 0.5 percent, with a 288 ms median, which is unexplained, and REST matched the kraken book on 112 of 112 checks.

Coinbase, ten most active markets: the book top changed 1.3 to 2.8 times a second, the trade driven ticker sent 0.7 to 1.5 messages a second and ran 280 to 400 ms behind at p50.
The book moved last in 5 percent of resolutions, 26 ms at p50.

Binance: `depth20` lagged `bookTicker` by 70 ms at p50 and 105 ms at p90 on every active market, which is the 100 ms throttle.
`bookTicker` fired 30 to 100 times a second on the top markets while the `depth20` top changed 2.5 to 5 times a second, so the states in between are never sent.

Bybit: the two depth channels agreed within 4 to 10 ms at p50 in either direction, consistent with their 10 and 20 ms push cadences.

## 4. What the venues document

| venue and channel | sequence field | documented promise | documented action on a gap | venue resends a snapshot | source |
|---|---|---|---|---|---|
| binance `depth20@100ms` | none needed | every message is the complete top twenty | nothing to detect | every message | `docs/profiles/binance/websocket.md` |
| bybit `orderbook.50` | `u`, `seq` | snapshot then delta, "If there is a problem on Bybit's end, a snapshot will be re-sent", `u` = 1 "is a snapshot data due to the restart of the service" | none for the client, consecutive `u` is not promised | yes | https://bybit-exchange.github.io/docs/v5/websocket/public/orderbook |
| okx `books` | `seqId`, `prevSeqId` | snapshot has `prevSeqId` -1, each update's `prevSeqId` must equal the last `seqId`, empty arrays with equal ids are a liveness event, `seqId` below `prevSeqId` during maintenance is a reset | discard the book and resubscribe | idle liveness message only | https://www.okx.com/docs-v5/trick_en/ |
| okx `checksum` | | deprecated 2026-06-23 in production, always 0, "Please migrate from checksum to seqId/prevSeqId" | | | https://www.okx.com/en-sg/help/okx-order-book-channels-checksum-field-deprecation |
| krakenfutures `book` | `seq` | "The subscription message sequence number", nothing about consecutiveness, resets or replay | not documented | not documented | https://docs.kraken.com/api/docs/futures-api/websocket/book |
| coinbase `level2` | `sequence_num` | exactly one greater per message, a jump "indicate[s] that a message has been dropped", lower values are out of order | resubscribe and rebuild from the next snapshot | first event only | https://docs.cdp.coinbase.com/coinbase-app/advanced-trade-apis/websocket/websocket-overview |

Coinbase is the one venue that writes the reason down: "Even though a WebSocket connection is over TCP, the WebSocket servers receive market data in a manner that can result in dropped messages."
Bybit says the same from the other side by promising to re-send a snapshot when the problem is on its end.
Okx retired its checksum in favour of what it calls rigorous `seqId` and `prevSeqId` validation.
Kraken futures publishes nothing either way.

Cadence as documented: binance `bookTicker` is real time and partial depth is 100, 250 or 500 ms, bybit `orderbook.1` is 10 ms and `orderbook.50` is 20 ms, okx `bbo-tbt` is 10 ms and `books` "every 100ms" with the tick by tick book channels behind VIP4 and VIP5 logins, kraken's ticker deltas "are throttled such that they are published every 1s" and its book has no stated cadence, coinbase's ticker publishes "on every match" and `level2` has no stated cadence.

## 5. Field evidence

No source publishes a gap rate per hour or per connection for any of the five venues.
The one quantitative statement is from ccxt issues 6658 and 6779 in March and April 2020: out of order nonces "frequently" on binance's 0 ms diff depth stream and "rarely" at 100 ms, a stream this repo does not use.
A binance developer community thread of 2022-12-19 established that on futures only `pu` chains and `U` to `u` ranges are not contiguous between events, which is why a spot style check sees gaps that are not gaps.
Of four "order book out of sync" reports found, two were client bugs: ccxt 21254 in 2024 where identical frames produced different books in two containers, and ExchangeSharp 713 where zero quantity deletes were skipped.
Tardis, which records all five venues commercially, tracks sequence numbers and restarts the connection on any gap as routine practice, and notes that crossed books occur even when sequences check out.

## 6. How ccxt.pro 4.5.68 handles it

Paths are under `server/node_modules/ccxt/js/src/`.

| venue | handler | continuity check | on failure |
|---|---|---|---|
| binance | `pro/binance.js:976-1078` | futures accept an event when `U <= nonce` or `pu === nonce`, else `ChecksumError` | deletes the book and the subscription and rejects, the caller must watch again |
| bybit | `pro/bybit.js:981-1052` | none, `u` and `seq` are never read | relies on the venue re-sending a snapshot |
| okx | `pro/okx.js:1330-1377` | applies the deltas first, then `prevSeqId !== -1 && nonce !== prevSeqId` raises `InvalidNonce` | deletes and rejects |
| krakenfutures | `pro/krakenfutures.js:1107-1160` | none, `seq` is never read | none |
| coinbase | `pro/coinbase.js:844-885` | none, `sequence_num` is never read | none |

The okx `'checksum': true` option at `pro/okx.js:55` is dead code, and no okx checksum string builder exists.
Cryptofeed does check kraken futures with `seq_no + 1 != seq` per pair and okx with the `prevSeqId` rule, both without a checksum.

## 7. Corrections owed to the profiles

- [`../profiles/coinbase/websocket.md`](../profiles/coinbase/websocket.md) says the sequence rule is scoped by product and that subscription confirmations carry no sequence number.
  The wire has one counter per connection across `l2_data`, `heartbeats` and `subscriptions`, and every frame carried it.
  A per product check would misfire.
- [`../profiles/okx/websocket.md`](../profiles/okx/websocket.md) gives VIP4 for both tick by tick book channels, and the current requirement is VIP4 for `books50-l2-tbt` and VIP5 for `books-l2-tbt`.
  It also still describes the `checksum` field, which is retired.
- [`../profiles/binance/websocket.md`](../profiles/binance/websocket.md) is silent that futures `U` and `u` ranges are not contiguous between events, so only `pu` may be chained.
- The kraken and bybit profiles are correct that no consecutive promise exists, and silent on what production clients assume, which is consecutive `seq` per product on kraken and venue snapshots on bybit.

## 8. What this settles

- Venue drops are rare.
  Zero gaps in 12.48 million deltas over 21 minutes, and the maintained books matched the venues' own top of book channel on 253,673 same sequence comparisons and REST on 418 of 418 conclusive checks.
  The check stays, because it costs one integer comparison per message and the failure it catches is silent, and the recovery path has to be proven by fault injection in specs, since live gaps did not occur.
- The sequence rules the book feed classes carry: bybit `u` advances by one and `u` = 1 announces a venue snapshot, okx `prevSeqId` must equal the last `seqId` with empty updates as liveness and a lower `seqId` as a reset, kraken `seq` is consecutive per product, coinbase `sequence_num` is consecutive per connection counting every channel, binance has nothing to check.
- The book is a better layer 1 than the ticker on kraken, where the ticker is 1 to 4 seconds behind and never carries about 90 percent of top changes, and on coinbase, where it is 0.3 seconds behind.
  On binance and okx the book channels are 70 to 105 ms behind the tickers, and the user accepted that on 2026-09-07 as below the threshold where an opportunity is worth reacting to.
- Decisions the user took in conversation on 2026-09-07, recorded here until the book feed design is written: one book feed per venue writes both layer 1 and depth through a single engine entry point, the ticker channels may run as a canary that never writes a cluster field and only logs and triggers a rebuild on a persistent disagreement, the REST comparison on quiet markets is the canary for the deeper levels, and the okx checksum is not implemented.
