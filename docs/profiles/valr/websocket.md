# VALR WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 in Seattle time, which was 03:14 to 03:19 UTC and again 03:29 to 03:33 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the public trade WebSocket of VALR for its four USDT-margined perpetuals, with the book channel in detail.
VALR has no CCXT class, see [`fees.md`](./fees.md) section 8, so no CCXT Pro file describes this socket either.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/valr/ws-probe.mjs) and is quoted beside the documented value from S1.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| VALR Futures, USDT perpetuals, and every spot pair | `wss://api.valr.com/ws/trade`, S1 | open in 209 to 240 ms with no API key over 12 opens, no refusal |
| account events, private | `wss://api.valr.com/ws/account`, S1 | not probed |
| VALR Perps, routed to Hyperliquid | none documented, the Perps v1 API is REST only and needs a key, S2 | not probed |

One socket carries every pair of the exchange.
On one socket `OB_L1_DIFF` for the spot pair `BTCUSDT` and for the perpetual `ETHUSDTPERP` both delivered, P2.
The documentation says the WebSocket API "requires authentication" with three `X-VALR-*` headers, S1 "Authentication".
The same page says "all unauthenticated WebSocket connections are automatically closed after 15 minutes regardless of activity", S1 "Overview".
The wire agrees with the second sentence: a socket with no headers opened, subscribed and received every public event in section 2.
`api.valr.com` resolved to the single address 34.120.100.150 and the handshake reply carried `via: 1.1 google`, P1 and [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

Every event is subscribed with `{"type": "SUBSCRIBE", "subscriptions": [{"event": <event>, "pairs": [...]}]}`, S1.

| event | payload | depth and speed | probed on 2026-09-23 UTC |
|---|---|---|---|
| `OB_L1_DIFF` (alpha) | `OB_L1_SNAPSHOT` then `OB_L1_DIFF`, levels `[price, quantity]` | whole aggregated book, pushed on change | snapshot then deltas on 4 of 4 perps in both runs, `sq` step 1 on every delta, CRC32 matched on every frame, recommended |
| `OB_L1_D1_SNAPSHOT` to `OB_L1_D80_SNAPSHOT` (alpha) | a whole snapshot of 1, 5, 10, 20, 40 or 80 levels | "new snapshots will only be sent when there are updates" | `OB_L1_D20_SNAPSHOT` on `ETHUSDTPERP`: 103 and 135 frames in 75 s, 19 or 20 bids and 16 to 18 asks, no `sq` and no `cs` |
| `AGGREGATED_ORDERBOOK_UPDATE` | whole book as objects with `side`, `quantity`, `price`, `currencyPair`, `orderCount` | "top 40 bids and asks" | 67 and 120 frames in 75 s on `BTCUSDTPERP`, 25 to 27 bids and 15 to 17 asks, `SequenceNumber` rising |
| `FULL_ORDERBOOK_UPDATE` | order by order book, snapshot then updates, CRC32 over 25 orders a side | on change | not probed |
| `MARK_PRICE_UPDATE` | `{"price": "86476"}` | "updated every 5 seconds" | median 3,000 ms and at most 3,021 ms apart, on all 4 perps at once, and the first frame right after the subscribe |
| `MARKET_SUMMARY_UPDATE` | bid, ask, last, volume, `created`, `markPrice` | on change | 18 to 108 frames per perp in 75 s, gaps from 76 ms to 20.3 s |
| `NEW_TRADE`, `NEW_TRADE_BUCKET` | trades and 60 s candles | on trade | not probed |
| `PNL_RUN_COMPLETED`, `FUNDING_RUN_COMPLETED` | the PnL price, or only the pair | at each run | not probed, since no run fell inside a socket |
| `ALLOWED_ORDER_TYPES_UPDATED` | order types | on change | not probed |

No index channel exists, and no event carries a funding rate.
The mark on the socket moved every 3 s, which is faster than the REST market summary and its 5 s cache, see [`rest.md`](./rest.md) section 4.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one trade URL for all pairs, one account URL, S1 | one socket served spot and perpetuals together |
| subscribe frame shape | `{"type": "SUBSCRIBE", "subscriptions": [{"event": "OB_L1_DIFF", "pairs": ["SOLZAR", "BTCUSDC"]}]}`, S1 | five events with 14 event and pair combinations in one frame were all acknowledged. A second `SUBSCRIBE` for an event replaces its pair list: subscribing `OB_L1_DIFF` for `ETHUSDTPERP` answered `UNSUBSCRIBED` `OB_L1_DIFF:BTCUSDTPERP` first |
| unknown symbol expectation | Not publicly specified | `{"type":"ERROR","message":"Channel OB_L1_DIFF, pair NOPEUSDTPERP combination invalid"}`, and the valid pairs of the same frame still subscribe |
| chunk unit and budget | Not publicly specified | one frame per event list, 14 combinations in one frame with no error. With 4 perpetuals no budget was approached |
| keepalive mechanism | client sends `{"type": "PING"}` every 30 s, server answers `PONG`, and `"NO_SUBSCRIPTIONS"` when nothing is subscribed, S1 | `{"type":"PONG"}` in 158 to 180 ms, and `{"type":"PONG","message":"NO_SUBSCRIPTIONS"}` before any subscribe. No server protocol ping on any socket |
| connection lifetime and maintenance notice | unauthenticated sockets close after 15 minutes regardless of activity, S1. No maintenance event is documented | a socket with no client frame and no subscription closed at 59,999 and 59,991 ms in two runs, with 1006 and no close frame. The 15 minute close was not reached, since sockets were held at most 110 s |
| handshake and operation rate limits | `/ws` new clients 60 a minute per IP, all WebSocket limits per IP, excess answered with `{"type": "RATE_LIMIT_EXCEEDED"}`, S1 "Rate limiting" | no refusal at 12 opens over the two runs |
| public market data authentication | documented as required, S1 "Authentication", and contradicted by the 15 minute note | none needed |
| message parse and routing | `type`, then `ps` on the `OB_L1_*` events and `currencyPairSymbol` on the others | as documented |
| subscribe acknowledgement shape | Not publicly specified | one `{"type":"SUBSCRIBED","message":"OB_L1_DIFF:BTCUSDTPERP"}` per event and pair, and `UNSUBSCRIBED` in the same shape |
| symbol identifier format | `BTCUSDTPERP` | identical to the REST `symbol` and to the `currencyPair` of the REST anchor calls. A lowercase `ethusdtperp` was accepted and acknowledged as `OB_L1_DIFF:ETHUSDTPERP` |
| number representation | prices and quantities as strings | strings for price and quantity, JSON numbers for `lc`, `sq` and `cs` |
| timestamp representation | `lc`, "Last Change", in ms | `lc` integer ms. A book `lc` can be seconds old: up to 9,643 ms behind arrival on `SOLUSDTPERP` in the first run and 2,541 ms in the second. `MARKET_SUMMARY_UPDATE` carries `created` as an ISO string |
| size unit | base currency, S3 "Closing positions" | base coins: `BTCUSDTPERP` quantities such as `"0.0115"` BTC equal the REST book at the same price |
| sequence semantics | "the sequence number is expected to be exactly 1 higher than the previous message. If messages are received out of order then please resubscribe.", S1 | the first delta had `sq` equal to the snapshot's plus one on 4 of 4 perps, and 0 gaps in 436 and 684 deltas over two runs of 75 s |
| idle repeat behaviour | not documented | no book frame repeats. A quiet perpetual went up to 20.5 s with no book frame. `MARK_PRICE_UPDATE` repeats the same price every 3 s: 18 and 10 of the 25 `BTCUSDTPERP` frames after the first repeated the previous price in the two runs |

## 4. The book channel in detail

`OB_L1_DIFF` is the channel this profile recommends, and every row below is about it unless it says otherwise.
VALR itself names it the fastest book feed, S1 "Optimal Order Book Updates".

### Snapshot on subscribe

The first frame for each pair is `OB_L1_SNAPSHOT` with the whole aggregated book, the pair's `sq` and a `cs`.
It arrived 158 to 182 ms after the subscribe frame on 4 of 4 perpetuals in both runs, and no second snapshot came in 75 s.
The snapshot is not cut to 40 or 41 levels: `XRPUSDTPERP` opened with 51 and then 49 bids, while the REST book stops at 41 a side, see [`rest.md`](./rest.md) section 5.

| pair | snapshot bids and asks, first run | snapshot bids and asks, second run | most levels held in 75 s, both runs |
|---|---|---|---|
| `BTCUSDTPERP` | 27 and 17 | 27 and 17 | 27 and 17 |
| `ETHUSDTPERP` | 21 and 17 | 21 and 17 | 21 and 18 |
| `XRPUSDTPERP` | 51 and 20 | 49 and 22 | 52 and 22 |
| `SOLUSDTPERP` | 34 and 20 | 34 and 19 | 37 and 21 |

The books are thin.
The whole `BTCUSDTPERP` book held 27 bid levels, and the best ask carried 0.0598 BTC, about 5,200 USDT.

### Delta semantics

A delta carries `a` and `b` arrays of `[price, quantity]` strings, where the quantity is the new total at that price.
A quantity of `"0"` removes the level, S1 "Rules for updating the order book".
No delta in the runs had both arrays empty, and a delta may carry an empty `b` or `a`.

### Sequence and gap rule

```text
OB_L1_SNAPSHOT            replace the book, last = sq
OB_L1_DIFF, sq = last + 1   apply, last = sq
OB_L1_DIFF, sq ≠ last + 1   gap: resubscribe (documented), or terminate the socket (the engine's resync)
```

The `sq` counts per pair: `BTCUSDTPERP` stood near 907,000 and `XRPUSDTPERP` near 1,680,000 at the same moment.
It is not the `SequenceNumber` of the REST book, which read 7,111,111,356 while the socket read 907,198 for the same book, P1.
So a REST book cannot seed the socket's chain, and the snapshot on subscribe is the only seed.

### Checksum

Every snapshot and every delta carries `cs`, an unsigned CRC32 of the best 25 bids and 25 asks, written best bid, best ask, next bid, next ask, each as `price:quantity`, joined with `:`, S1.
A book rebuilt from the wire strings and hashed with `zlib.crc32` matched `cs` on 440 of 440 frames in the first run and 688 of 688 in the second, every snapshot and every delta, P1.
The checksum is taken over the strings as the wire spells them, so a feed that keeps only numbers cannot rebuild it.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on 4 of 4 | best first, ascending, on 4 of 4 |
| delta | descending on every delta that had two or more bids | ascending on every such delta |
| REST `orderbook` | descending, S1 and [`rest.md`](./rest.md) section 5 | ascending |

A feed still applies deltas by price and never by position.

### Level window

No window was seen.
The book grew past its snapshot on three pairs, to 52 bids on `XRPUSDTPERP`, and the checksum stayed right, so the stream covers the whole aggregated book.
The engine's 20 levels a side are covered on the bid side of every perpetual, while `BTCUSDTPERP` and `ETHUSDTPERP` had fewer than 20 ask levels in the whole book.

### Size unit against CCXT `contractSize`

VALR has no CCXT class, so there is no `contractSize` to compare.
Positions are "measured based on their base currency quantity", S3, and the socket's quantities are base coins.
At 60 s into the first run, the top 10 bids and top 10 asks of `BTCUSDTPERP` on the socket equalled the REST book price for price and size for size, 10 of 10 on each side, P1.
In the second run 8 of 10 bids and 10 of 10 asks matched, with the socket's best bid at 86,623 and the REST best bid at 86,629, and the REST book is cached for 30 s, so the two reads need not describe the same moment.
A hand-written catalog would set `contractSize` 1.

### One-sided and empty books

No one-sided book was seen on the four active perpetuals.
The inactive `DOGEUSDTPERP` answers REST with `{"Asks":[],"Bids":[], ...}` and the socket refuses its book subscription, section "Unknown, closed and inactive symbols" below.

### Idle repeats

No book frame repeats.
A quiet book sends nothing: the longest silence per pair was 20.5 and 9.0 s on `BTCUSDTPERP`, 15.8 and 10.2 s on `ETHUSDTPERP`, 16.7 and 8.4 s on `SOLUSDTPERP`, and 5.5 and 3.7 s on `XRPUSDTPERP`, in the two runs.

### Unknown, closed and inactive symbols

| request | reply | then |
|---|---|---|
| `OB_L1_DIFF` with `BTCUSDTPERP` and `NOPEUSDTPERP` | `SUBSCRIBED` for `BTCUSDTPERP`, then `{"type":"ERROR","message":"Channel OB_L1_DIFF, pair NOPEUSDTPERP combination invalid"}` | `BTCUSDTPERP` delivers |
| `OB_L1_DIFF` with inactive `DOGEUSDTPERP` | `ERROR` "Channel OB_L1_DIFF, pair DOGEUSDTPERP combination invalid" | the pair list is replaced anyway: the earlier `BTCUSDTPERP` was `UNSUBSCRIBED` |
| `MARK_PRICE_UPDATE` with inactive `DOGEUSDTPERP` | `SUBSCRIBED` `MARK_PRICE_UPDATE:DOGEUSDTPERP` | one mark frame, `"0.08618"`, right after the acknowledgement, and none in the next 24 s, so a delisted pair's mark arrives once and does not repeat |
| `OB_L1_DIFF` with lowercase `ethusdtperp` | `SUBSCRIBED` `OB_L1_DIFF:ETHUSDTPERP` | delivers |
| unknown event `NOPE_EVENT` | `ERROR` "Channel NOPE_EVENT, pair BTCUSDTPERP combination invalid" | other subscriptions keep delivering |
| text that is not JSON | `{"type":"ERROR","message":"Invalid message - Invalid JSON"}` | the socket stays open |
| `OB_L1_DIFF` with `"pairs": []` | one `UNSUBSCRIBED` per pair | book frames stop |

Because a second subscribe replaces the pair list of its event, a feed must send every pair of an event in one frame, and a resubscribe of one pair must list all of them again.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | send `{"type": "PING"}` every 30 s, S1 | `PONG` in 158 to 180 ms over both runs, no server protocol ping on any socket |
| silence the server tolerates | Not publicly specified | a socket that sent nothing and subscribed nothing closed at 59,999 and 59,991 ms with 1006, no close frame. A socket that only subscribed `MARK_PRICE_UPDATE` and never pinged stayed open 110 s. A socket that only pinged every 25 s stayed open 110 s. Both runs agree |
| forced disconnect | unauthenticated sockets close after 15 minutes regardless of activity, S1 | not reached, the longest socket lived 110 s within the socket budget |
| maintenance notice | none documented | none seen |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got `sec-websocket-extensions: permessage-deflate` back, so the server compresses when asked. A client that does not offer it, as the engine does, gets plain frames |
| handshake | headers optional for public events | 209 to 240 ms to open |
| subscription limits | Not publicly specified | none reached |
| throughput | | four perps with marks, summaries and two extra book views: 11.7 and 16.8 frames per second, 7.4 and 11.8 KB per second, 631 and 705 bytes per frame, 15.9 and 19.3 µs `JSON.parse` per frame. The four `OB_L1_DIFF` books alone were 5.9 and 9.2 frames per second |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays marked `…` are cut.

Subscribe, three of the five events of the probe's frame kept.

```json
{"type": "SUBSCRIBE", "subscriptions": [{"event": "OB_L1_DIFF", "pairs": ["BTCUSDTPERP", "ETHUSDTPERP", "XRPUSDTPERP", "SOLUSDTPERP"]}, {"event": "MARK_PRICE_UPDATE", "pairs": ["BTCUSDTPERP", "ETHUSDTPERP", "XRPUSDTPERP", "SOLUSDTPERP"]}, {"event": "AGGREGATED_ORDERBOOK_UPDATE", "pairs": ["BTCUSDTPERP"]}]}
```

Acknowledgement, one per event and pair.

```json
{"type":"SUBSCRIBED","message":"OB_L1_DIFF:BTCUSDTPERP"}
```

Snapshot, first three levels per side kept.

```json
{"type":"OB_L1_SNAPSHOT","ps":"BTCUSDTPERP","d":{"lc":1790133277857,"a":[["86491","0.0598"],["86503","0.04"],["86504","0.0995"]],"b":[["86476","0.0115"],["86453","0.04"],["86452","0.0682"]],"sq":907135,"cs":915468303}}
```

The first delta after it, with `sq` one higher.

```json
{"type":"OB_L1_DIFF","ps":"BTCUSDTPERP","d":{"lc":1790133283064,"a":[["86503","0"],["86516","0.04"]],"b":[],"sq":907136,"cs":4082567684}}
```

Mark and market summary.

```json
{"type":"MARK_PRICE_UPDATE","currencyPairSymbol":"BTCUSDTPERP","data":{"price":"86476"}}
```

```json
{"type":"MARKET_SUMMARY_UPDATE","currencyPairSymbol":"BTCUSDTPERP","data":{"currencyPairSymbol":"BTCUSDTPERP","askPrice":"86491","bidPrice":"86476","lastTradedPrice":"86355","previousClosePrice":"85518","baseVolume":"10.0569","quoteVolume":"865059.997","highPrice":"86706","lowPrice":"85117","created":"2026-09-23T03:14:35.175Z","changeFromPrevious":"0.97","markPrice":"86476"}}
```

Keepalive, before and after a subscription.

```json
{"type": "PING"}
```

```json
{"type":"PONG","message":"NO_SUBSCRIPTIONS"}
```

```json
{"type":"PONG"}
```

Replace on resubscribe, and errors.

```json
{"type":"UNSUBSCRIBED","message":"OB_L1_DIFF:BTCUSDTPERP"}
```

```json
{"type":"ERROR","message":"Channel OB_L1_DIFF, pair NOPEUSDTPERP combination invalid"}
```

```json
{"type":"ERROR","message":"Invalid message - Invalid JSON"}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
The account socket `wss://api.valr.com/ws/account` needs the `X-VALR-API-KEY`, `X-VALR-SIGNATURE` and `X-VALR-TIMESTAMP` headers on the handshake and subscribes every account event on open.
The trade socket also carries order entry for an authenticated client, with a documented round trip of about 8 ms inside VALR, S1 "Estimated Latency".
The account events include `OPEN_POSITION_UPDATE` and `LEVERAGE_UPDATED`, S1 changelog.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket, `wss://api.valr.com/ws/trade`, for all 4 perpetuals, no auth headers | one socket carries every pair, and 4 books were 6 to 9 frames a second |
| channel | `OB_L1_DIFF` | snapshot on subscribe, a strict `sq` chain, a checksum on every frame, and the whole book |
| subscribe frame | one frame per socket, `{"type": "SUBSCRIBE", "subscriptions": [{"event": "OB_L1_DIFF", "pairs": [<every rawMarketId>]}]}` | a second subscribe of the same event replaces the pair list |
| keepalive | `{"type": "PING"}` every 20 s | documented at 30 s, a silent socket closed at 60 s, and a quiet book went 20.5 s without a frame, so the `PONG` has to count as traffic |
| `maxSilenceMs` | 45,000 | two missed pongs plus margin, well under the 60 s idle close |
| routing | `ps` is the `rawMarketId` | identical spelling to the REST catalog |
| snapshot | `OB_L1_SNAPSHOT`: `resetBook` from `b` and `a`, store `sq` | documented replace semantics |
| delta | apply only when `sq === last + 1`, then store `sq` | 0 gaps observed |
| resync | `sq !== last + 1`, a delta before any snapshot, or a `cs` mismatch: `resync` | documented as "resubscribe", and a resubscribe of one pair must name all of them |
| checksum | optional, keep the wire strings if it is checked | CRC32 over the top 25 needs the exact strings |
| forced close | expect a close at 15 minutes and let the close path reconnect | documented for unauthenticated sockets, not observed within 110 s |
| receive time | stamp on arrival, never from `lc` | a snapshot's `lc` was up to 9.6 s old |
| sizes | `Number()` of the string, base coins, `contractSize` 1 | section 4 |
| deflate | keep `perMessageDeflate: false` | the server would compress if asked |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | VALR API documentation, sections "WebSocket API", "WebSocket API / Trade", "Rate limiting", "Performance considerations" and "Changelog" | https://docs.valr.com/ and its collection JSON at https://docs.valr.com/api/collections/7185612/S1Lr5XDq | 2026-09-22 | VALR | URLs, events, payloads, update rules, checksum, sequence rule, ping, rate limits, 15 minute close, sections 1 to 8 |
| S2 | VALR API documentation, section "Perps" | https://docs.valr.com/ | 2026-09-22 | VALR, Hyperliquid | Perps v1 is REST only and signed, section 1 |
| S3 | Perpetual Futures Trading Guide | https://support.valr.com/hc/en-us/articles/11078306427420 | 2026-09-22, updated 2026-09-14 | VALR DAM | positions in base currency, section 4 |
| P1 | `ws-probe.mjs book` at 03:14 and 03:29 UTC, and `deflate` at 03:14 and 03:33 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/valr/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs subs` at 03:16 and 03:30 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/valr/ws-probe.mjs) | 2026-09-23 UTC | this host | subscribe semantics, errors, sections 3, 4 and 6 |
| P3 | `ws-probe.mjs silence` at 03:17 and 03:31 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/valr/ws-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
