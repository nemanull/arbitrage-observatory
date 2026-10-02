# Upbit Indonesia WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:51 to 05:13 UTC), from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public quotation WebSocket of Upbit Indonesia, reached in CCXT as `upbit` with `hostname: 'id-api.upbit.com'`, with the `orderbook` stream in detail.
Upbit Indonesia lists no perpetual, so this is its spot book channel, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The protocol is the one of Upbit Korea in [`../upbit/websocket.md`](../upbit/websocket.md), and this profile records where the Indonesian host differs.
All results are from the Canadian VPN exit, and no request was refused.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot quotation, all quotes | `wss://id-api.upbit.com/websocket/v1`, S1 and S2 | open in 887 to 1,195 ms, W1, W3, W6, W8 and W12. One socket served all 444 pairs of the IDR, BTC and USDT quotes, W4 and W10 |
| private | `wss://id-api.upbit.com/websocket/v1/private`, S1 | not probed |
| web site feed | `wss://crix-websocket-id.upbit.com/websocket`, named in the web app's host table, S7 | undocumented, not probed |

The host resolves to the same three AWS Jakarta addresses as the REST API, see [`rest.md`](./rest.md) section 1.
The Korean pair `KRW-BTC` gets nothing on this host, section 4, so the Korean and Indonesian books are separate.

## 2. Channel matrix for public market data

| type | payload | depth and speed | probed |
|---|---|---|---|
| `orderbook` | `{"type": "orderbook", "codes": ["USDT-BTC"]}` | 30 levels by default. The suffixes `.1`, `.5`, `.15` and `.30` pick the count, S3 | snapshot then whole book frames, recommended. Busy pairs pushed a frame every 100 to 200 ms at the median, section 4 |
| `ticker` | `{"type": "ticker", "codes": [...]}` | on trade | 1 frame, the snapshot, for `USDT-BTC` in 30 s, W1, W3 and W8 |
| `trade` | `{"type": "trade", "codes": [...]}` | on trade | 1 frame, the snapshot, for `USDT-BTC` in 30 s, W1, W3 and W8 |
| `candle`, `announcement` | | | documented, S2, not probed |
| mark, index, funding | none | | Upbit Indonesia publishes none |

The ticker frame carries `market_state`, `is_trading_suspended`, `delisting_date` and `market_warning`, which a feed could use to skip a pair, W1.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public quotation URL per region, one private URL, S1 | one URL served 444 pairs of three quote currencies, W4 and W10 |
| subscribe frame shape | a JSON array: a ticket object, one or more type objects, then a format object that is marked required, S2 | as documented. A frame with no format object was served in `DEFAULT`. Two `orderbook` objects in one frame were both served, W2 and W9 |
| unknown symbol expectation | not documented | `IDR-NOPE`, `KRW-BTC` and lower case `usdt-btc` each got no frame and no error in 2 s, and the socket stayed open. Mixed with `USDT-BTC`, only `USDT-BTC` delivered, W2 and W9 |
| chunk unit and budget | `websocket-message` 5 a second and 100 a minute per connection, `websocket-connect` 5 a second per IP, S4 | 444 codes in one 5,000 byte frame were all served with a snapshot, W4 and W10 |
| keepalive mechanism | RFC 6455 ping and pong, or a text `PING`, after which the server sends `{"status":"UP"}` every 10 s, S2 | no server ping on any socket. A protocol ping got its pong in 349 and 361 ms, W2 and W9. One text `PING` started `UP` every 10.0 s on an unsubscribed and on a subscribed socket, the first 0.6 to 8.9 s after the `PING`, W5, W7, W9 and W11 |
| connection lifetime and maintenance notice | idle timeout after 120 s with no data sent or received, S2 and S5 | an idle socket closed at 60.9 s in three runs, and a socket whose only traffic was one snapshot closed at 61.2 to 61.3 s, each with 1006 and no close frame. Sockets on the `UP` cycle or on a protocol ping every 20 s were still open at 76 to 81 s. No maintenance message type exists, W5, W7 and W11 |
| handshake and operation rate limits | as in the chunk row. A request with an `Origin` header is held to one per 10 s, S4 | the upgrade reply carries `remaining-req: group=websocket; min=300; sec=4` and `limit-by-ip: Yes`, W6 and W12. No refusal was provoked |
| public market data authentication | none | none |
| message parse and routing | every frame is a JSON object with `type` and `code`, or `ty` and `cd` in `SIMPLE`, S3 | route on `code`, which is the pair id without the count suffix |
| subscribe acknowledgement shape | none documented | none. The first frame is the snapshot itself, 353 to 633 ms after the subscribe frame was sent, W1, W3 and W8 |
| symbol identifier format | `SGD-BTC` in the examples, quote first, upper case, S3 | `USDT-BTC`, identical to CCXT `market.id` and to the REST `market` on 444 of 444 pairs, see [`rest.md`](./rest.md) section 2 |
| number representation | Double, S3 | JSON numbers. `DEFAULT` frames wrote USDT prices plain, as in `87000.02`, IDR prices in exponent form, as in `1.55141E9`, and zero slots as `0.0` price and `0` size, W8. `SIMPLE` frames wrote small sizes in exponent form, as in `1.67E-4`, W3. The REST book writes IDR prices plain, as in `1519320000`, see [`rest.md`](./rest.md) section 5 |
| timestamp representation | `timestamp` in ms, S3 | integer ms, the time of the book's last change, so a quiet book's snapshot is old, section 4 |
| size unit | base currency, S3 | base currency, which matches CCXT's undefined `contractSize` read as 1, section 4 |
| sequence semantics | none | no sequence or update id in the frame. Timestamps never went backwards on any pair in W1, W3 or W8 |
| idle repeat behaviour | not documented | a quiet book sends nothing. 128 and 122 of 444 pairs sent only their snapshot in 30 s, W4 and W10. Up to 2 frames per pair per 30 s repeated the previous levels exactly, W3 and W8 |

## 4. The book channel in detail

### Snapshot on subscribe

The first frame for each code is `"stream_type": "SNAPSHOT"` with the whole book.
In W1 four USDT and BTC pairs got theirs 353 ms after the subscribe frame and the four others 612 ms after it, in W3 all eight came at 633 ms, and in W8 two came at 367 ms and six at 633 ms.
Every one of the 444 pairs got a snapshot in both batch runs, W4 and W10.
`is_only_snapshot: true` sent that one frame and nothing more, and `is_only_realtime: true` sent 15 and 8 `REALTIME` frames for `USDT-XRP` in 2 s with no snapshot, W2 and W9.

### Delta semantics

There are no deltas.
Every `REALTIME` frame is the whole book again, 30 units by default, so a feed replaces the book on every frame.

### Sequence and gap rule

There is no sequence.
A lost frame is healed by the next one, and the only gap a feed can see is a closed socket.
Timestamps never went backwards on any of the eight pairs in W1, W3 and W8.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

A unit holds one ask and one bid of the same rank: `{"ask_price", "bid_price", "ask_size", "bid_size"}`.
Asks ascended and bids descended in every frame of W1, W3 and W8, with 0 order breaks once the zero slots below are left out.

### Level window and count

| request | units per frame, W3 and W8 in `SIMPLE` |
|---|---|
| `USDT-BTC.15` | 15 |
| `USDT-ETH.5` | 5 |
| `BTC-XRP.1` | 1 |
| `IDR-USDT.30` | 30 |
| `USDT-XRP.20`, not a supported count | 30, as documented |
| no suffix | 30 on every frame of W1, W3 and W8 |

A `level` field, which Upbit Korea accepts for KRW pairs, is refused here with `WRONG_FORMAT`, and the socket is closed, W2 and W9.
The frames carry no `level` key at all.

### Size unit against CCXT `contractSize`

Sizes are base currency, as documented, and CCXT leaves `contractSize` undefined, which the connector reads as 1, see [`rest.md`](./rest.md) section 2.
The REST book read at 10 s and 20 s into W1, W3 and W8 carried a `timestamp` that matched a socket frame for all four pairs compared, and the 30 units at that timestamp were identical on every one, 8 of 8 comparisons per run.

### One-sided and empty books

A side with fewer than 30 orders is padded with units whose price and size are both 0.
`IDR-BTC` had fewer than 30 bids, and every one of its 28 and 25 frames in W3 and W8 carried zero slots, as did all 50 `BTC-BERA` frames in W8.
In the REST scans of all 444 pairs, 220 and 219 had at least one zero slot and 2 had a whole side empty, see [`rest.md`](./rest.md) section 5.
A feed drops units whose price or size is 0 before it builds a side.

### Frame cadence and quiet pairs

| pair | frames in 30 s, W1, W3 and W8 | median gap between frames | longest gap |
|---|---|---|---|
| `USDT-XRP` | 284, 251 and 202 | 100 to 101 ms | 320 to 420 ms |
| `BTC-XRP` | 236, 165 and 222 | 100 to 103 ms | 404 to 2,230 ms |
| `USDT-BTC` | 153, 184 and 147 | 107 to 199 ms | 411 to 621 ms |
| `USDT-ETH` | 89, 101 and 118 | 200 to 290 ms | 1,310 to 1,798 ms |
| `IDR-USDT` | 64, 46 and 52 | 105 to 200 ms | 4,300 to 9,098 ms |
| `IDR-BTC` | 10, 28 and 25 | 1,000 to 1,009 ms | 1,015 to 19,390 ms |
| `IDR-ONT` | 13, 1 and 31 | 1,000 ms in W1 and W8 | 1,013 and 1,110 ms in W1 and W8 |
| `BTC-BERA` | 5, 3 and 50 | 322 to 3,350 ms | 2,100 to 24,020 ms |

Across all 444 pairs, the longest gap per pair was 4.3 and 4.6 s at the median, 15.1 and 15.3 s at p90 and 27.7 and 27.4 s at most, and 128 and 122 pairs sent only their snapshot, W4 and W10.
A frame arrived 208 to 263 ms after its own `timestamp` at the minimum, and a quiet book's snapshot carried a `timestamp` 9.5 s old on `IDR-ONT` in W3.
The REST reads confirmed the same thing: the `IDR-BTC` book was 77 s old in W1 and `IDR-ONT` 29.7 s old in W3.

### Idle repeats

Nothing is sent for a book that does not change.
A frame that repeats the previous 30 units exactly was seen once on `USDT-XRP` and twice on `BTC-XRP` in W3, once on `USDT-ETH` in W8, and never in W1.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `IDR-NOPE` | nothing in 2 s | socket stays open |
| `IDR-NOPE` with `USDT-BTC` | only `USDT-BTC` frames | socket stays open |
| `KRW-BTC`, a Korean pair | nothing in 2 s | socket stays open |
| `usdt-btc`, lower case | nothing in 2 s. The REST call accepts lower case, see [`rest.md`](./rest.md) section 6 | socket stays open |
| `USDT-ETH.20` | a 30 unit snapshot | as documented |
| a `level` field | `WRONG_FORMAT` | closed with 1000 about 616 and 620 ms after the send |

A delisted pair was not available to probe.
Because an unknown code is accepted in silence, a feed has to notice a code with no snapshot on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | protocol ping, or a text `PING` that starts `{"status":"UP"}` every 10 s, S2 | no server ping. Protocol pong in 349 and 361 ms, W2 and W9. After one text `PING` the `UP` frames came every 10.0 s. The first came 0.6 s after the `PING` in W9, 2.5 s after it on an unsubscribed socket and 8.9 s after it on a subscribed socket in W11, which fits a server clock that ticks every 10 s, W5, W7, W9 and W11 |
| silence the server tolerates | 120 s, S2 and S5 | about 61 s. An idle socket closed at 60.9 s three times, and a socket that received one snapshot closed at 61.24 to 61.26 s three times, with 1006 and no close frame, W5, W7 and W11 |
| what resets the idle timer | "no data is sent or received", S2 | a protocol ping every 20 s kept a quiet subscribed socket open for the 76 s the test lasted, with 3 pongs, twice. A text `PING` kept sockets open to 77 to 81 s, W5, W7 and W11 |
| forced disconnect | not documented | none in 81 s |
| maintenance notice | none on the socket. Scheduled maintenance is announced in advance, as for about 5 hours from 00:00 Jakarta time on 6 July 2026, S6 | none observed |
| compression | permessage-deflate is supported, S2 | offered, it was negotiated. Not offered, no extension came back, so it is never forced, W6 and W12 |
| frame opcode | not documented | every data, error and `UP` frame was a binary frame holding UTF-8 JSON: 856 of 856 in W1, 781 of 781 in W3 and 849 of 849 in W8 |
| handshake | 5 connections a second per IP, S4 | opens took 887 to 1,195 ms from this host |
| subscription limits | 5 messages a second and 100 a minute per connection, S4 | a second subscribe frame replaced the first: `USDT-BTC` sent 2 and 1 frames in flight and then stopped, while `USDT-ETH` began, W2 and W9 |
| errors | `{"error": {"name", "message"}}`, S2 | the socket is closed with 1000 about 603 to 810 ms after the offending frame, W2 and W9 |
| throughput | | all 444 pairs on one socket: median 444 and 436 frames a second, 336 to 930, 1.20 to 1.22 MB a second, 2,709 bytes a frame, 24.5 and 25.9 µs `JSON.parse` a frame, W4 and W10 |

## 6. Captured frames

Trimmed, from the probe runs.
Arrays marked `…` are cut.

Subscribe, W1.

```json
[{"ticket":"5eab3a86-b3a3-4fec-9dca-633ae124ffe7"},{"type":"orderbook","codes":["USDT-BTC","USDT-ETH","USDT-XRP","BTC-XRP","IDR-BTC","IDR-USDT","IDR-ONT","BTC-BERA"]},{"type":"ticker","codes":["USDT-BTC"]},{"type":"trade","codes":["USDT-BTC"]},{"format":"DEFAULT"}]
```

Snapshot, first two units kept, W3.

```json
{"type":"orderbook","code":"USDT-BTC","timestamp":1790139266388,"total_ask_size":1.80783766,"total_bid_size":1.32289913,"orderbook_units":[{"ask_price":87173.34,"bid_price":87161.13,"ask_size":0.00344142,"bid_size":0.00172075},{"ask_price":87180.91,"bid_price":87154.06,"ask_size":0.00172075,"bid_size":0.00137687}],"stream_type":"SNAPSHOT"}
```

Real-time frame, the whole book again, first two units kept, W3.

```json
{"type":"orderbook","code":"USDT-BTC","timestamp":1790139266689,"total_ask_size":1.79426705,"total_bid_size":1.47973649,"orderbook_units":[{"ask_price":87173.34,"bid_price":87161.13,"ask_size":0.00344142,"bid_size":0.00172075},{"ask_price":87180.91,"bid_price":87154.06,"ask_size":0.00172075,"bid_size":0.00137687}],"stream_type":"REALTIME"}
```

`SIMPLE` frame, first two units kept, W3.

```json
{"ty":"orderbook","cd":"USDT-BTC","tms":1790139297439,"tas":1.79426566,"tbs":0.99397409,"obu":[{"ap":87173.34,"bp":87170.3,"as":0.00344142,"bs":0.00172057},{"ap":87190.05,"bp":87163.31,"as":0.00172057,"bs":0.01147049}],"st":"REALTIME"}
```

Keepalive answer after a text `PING`, W5.

```json
{"status":"UP"}
```

Errors, W2.

```json
{"error":{"message":"Requested using wrong format.","name":"WRONG_FORMAT"}}
```

```json
{"error":{"message":"Ticket field must be contained.","name":"NO_TICKET"}}
```

```json
{"error":{"message":"type nope is not supported.","name":"INVALID_PARAM"}}
```

```json
{"error":{"name":"NO_CODES","message":"codes field not exists."}}
```

## 7. Private channels

Named for a future execution stage, from S2, not probed.
`myOrder` and `myAsset` run on `wss://id-api.upbit.com/websocket/v1/private` with a Bearer JWT in the upgrade request.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
Upbit Indonesia cannot join today, because the connector keeps only swap markets, see [`fees.md`](./fees.md) section 9, so this is the shape a spot leg would take.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://id-api.upbit.com/websocket/v1` | one URL serves every pair |
| channel | `orderbook`, codes with no suffix, no `level` field | 30 levels covers the engine's 20 at [`../../../server/src/engine/Engine.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/Engine.ts) line 61, and `level` closes the socket |
| markets per connection | all tracked pairs | 444 pairs ran on one socket at a median 436 to 444 frames a second with every snapshot served, twice, and nothing larger exists |
| subscribe frames | exactly one per connection: `[{"ticket": "<uuid>"}, {"type": "orderbook", "codes": [...]}, {"format": "DEFAULT"}]` | a second frame replaces the first subscription |
| keepalive | a protocol ping every 10 s | a socket with no traffic dies at about 61 s, a protocol ping every 20 s kept one open, and the pong is traffic for the silence watch at [`../../../server/src/feeds/book/VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) lines 97 and 98 |
| `maxSilenceMs` | 25,000 | two missed pongs, and a quiet pair can go the whole 30 s run without a book frame, so the book stream cannot be the heartbeat |
| routing | `frame.code` is the `rawMarketId` | the stream is keyed by the pair id |
| every frame | decode the binary frame as UTF-8, drop units whose price or size is 0, then `resetBook` with the rest | whole book frames, zero padded sides, binary opcode |
| resync | none per pair, since there is no sequence. Reconnect on close or silence and resubscribe the whole list | a lost frame is healed by the next one |
| unserved code | log a code with no snapshot 10 s after the subscribe | unknown, Korean and lower case codes are accepted in silence |
| receive time | stamp on arrival, never from `timestamp` | a quiet book's `timestamp` is the time of its last change |
| deflate | keep `perMessageDeflate: false` | the server negotiates it only when asked |
| headers | send no `Origin` header | an `Origin` request is limited to one per 10 s, S4 |

The engine's socket open at [`../../../server/src/feeds/book/VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 81 already refuses deflate, and `raw.toString('utf8')` reads a binary frame the same way as a text frame.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Upbit Global API overview, regional endpoints | https://global-docs.upbit.com/reference/api-overview | 2026-09-23 UTC | Upbit Singapore, Indonesia and Thailand | URLs, section 1 |
| S2 | WebSocket Usage and Error Guide, updated 2025-09-29 | https://global-docs.upbit.com/reference/websocket-guide.md | 2026-09-23 UTC | same | request shape, format object, keepalive, 120 s idle timeout, compression, error names, sections 1 to 7 |
| S3 | Orderbook, WebSocket, updated 2026-08-31 | https://global-docs.upbit.com/reference/websocket-orderbook.md | 2026-09-23 UTC | same | fields, count suffixes 1, 5, 15 and 30, default 30, sections 2 to 4 |
| S4 | Rate Limits | https://global-docs.upbit.com/reference/rate-limits.md | 2026-09-23 UTC | same | `websocket-connect`, `websocket-message`, `Origin` rule, sections 3 and 5 |
| S5 | WebSocket Integration Best Practices | https://global-docs.upbit.com/docs/websocket-best-practice.md | 2026-09-23 UTC | same | 120 s idle timeout, a new subscription replaces the previous one, sections 3 and 5 |
| S6 | [Important] Scheduled Server Maintenance (Completed) | https://global-docs.upbit.com/changelog/server_maintenance_0706.md | 2026-09-23 UTC | Upbit Singapore, Indonesia and Thailand | maintenance is announced ahead, section 5 |
| S7 | Upbit web app bundle for the Indonesian site | https://upbit-web-dist.upbit.com/upbit-web/sri-v2-chunk-B4qFS5x4.js, loaded by https://id.upbit.com/ | 2026-09-23 UTC | Upbit Indonesia web | the web site's own socket host, section 1 |
| W1 | `ws-probe.mjs book`, first run at 04:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 to 4 and 6 |
| W2 | `ws-probe.mjs errors` at 04:53 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 to 6 |
| W3 | `ws-probe.mjs book`, second run at 04:54 UTC, with the `SIMPLE` count variants | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3, 4 and 6 |
| W4 | `ws-probe.mjs batch` at 04:55 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1, 3, 4 and 5 |
| W5 | `ws-probe.mjs silence`, three sockets, at 04:56 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 5 |
| W6 | `ws-probe.mjs deflate` at 04:57 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 5 |
| W7 | `ws-probe.mjs silence`, five sockets with the ping variants, at 04:58 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 5 |
| W8 | `ws-probe.mjs book`, second pass at 05:08 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 5 |
| W9 | `ws-probe.mjs errors`, second pass at 05:09 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 to 5 |
| W10 | `ws-probe.mjs batch`, second pass at 05:11 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 to 5 |
| W11 | `ws-probe.mjs silence`, second pass at 05:11 UTC, with the time of each text `PING` | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 5 |
| W12 | `ws-probe.mjs deflate`, second pass at 05:13 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit-indonesia/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1, 3 and 5 |
