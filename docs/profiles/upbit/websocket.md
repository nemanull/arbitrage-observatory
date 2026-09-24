# Upbit WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:17 to 03:40 UTC), from the development host near Seattle.

This profile covers the public quotation WebSocket of Upbit Korea (CCXT id `upbit`), with the `orderbook` stream in detail.
Upbit lists no perpetual, so this is its spot book channel, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/upbit/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The probe runs are named in section 9: W1 to W3 and W12 are the four `book` runs, W4 and W5 the two `batch` runs, W6 and W7 the `errors` runs, W8 and W9 the `silence` runs, and W10 and W11 the `deflate` runs.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| public quotation, every KRW, BTC and USDT pair | `wss://api.upbit.com/websocket/v1`, S2 | opened in 490 to 566 ms over ten opens, W1 to W3 and W10 to W12 |
| private: `myOrder`, `myAsset`, and `announcement` | `wss://api.upbit.com/websocket/v1/private` with a JWT in `Authorization`, S2 | not probed |
| Upbit Singapore, Indonesia, Thailand | `wss://sg-api.upbit.com/websocket/v1`, `wss://id-api.upbit.com/websocket/v1`, `wss://th-api.upbit.com/websocket/v1`, S8 | not probed, separate venues |

One socket carries every market of Upbit Korea.
A single subscribe frame mixing KRW, BTC and USDT pairs delivered all three, W1 to W5.

## 2. Channel matrix for public market data

| type | payload | depth and speed | probed |
|---|---|---|---|
| `orderbook` | `{"type": "orderbook", "codes": ["KRW-BTC"]}` | 30 pairs of levels by default, or 1, 5, 15 or 30 with a `.{n}` suffix on the code, S1. `level` groups prices on KRW pairs only, S1 | a whole book in every frame, on a 100 ms grid for the busy KRW pairs measured, recommended, section 4 |
| `ticker` | `{"type": "ticker", "codes": [...]}` | on change, S13 | 39 to 93 frames in 30 to 40 s on KRW-BTC, carries `market_state` and `delisting_date` |
| `trade` | `{"type": "trade", "codes": [...]}` | on trade | 20 to 93 frames in 30 to 40 s on KRW-BTC, carries `sequential_id` and the best bid and ask |
| `candle.{unit}` | `{"type": "candle.1s", "codes": [...]}` | second and minute candles, S2 | not probed |
| `myOrder`, `myAsset`, `announcement` | private endpoint only | | not probed |

Options on every public type are `is_only_snapshot` and `is_only_realtime`, and the format object picks `DEFAULT`, `SIMPLE`, `JSON_LIST` or `SIMPLE_LIST`, S1 and S2.
No best bid and ask, mark, index or funding channel exists.
The trade frame's `best_ask_price` and `best_bid_price` are the nearest thing to a top of book stream.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL for quotation, one private URL, S2 | one URL served 855 pairs of three quote currencies, W4 and W5 |
| subscribe frame shape | a JSON array: a ticket object, one or more type objects, then a format object, S2 | as documented. The format object is marked required, S2, and a frame without it was served in `DEFAULT`, W6 and W7 |
| unknown symbol expectation | not documented | `KRW-NOPE` got no frame and no error in 2 to 3 s. Mixed with `KRW-BTC`, only `KRW-BTC` delivered. A lower case `krw-btc` also got nothing, W6 and W7 |
| chunk unit and budget | `websocket-message` 5 a second and 100 a minute per connection, `websocket-connect` 5 a second per IP, S3 | 855 codes in one 9,468 byte frame were all served with a snapshot, W4 and W5 |
| keepalive mechanism | RFC 6455 ping and pong, or a text `PING`, after which the server sends an `UP` status message every 10 s, S2 | no server ping on any socket. A protocol ping got its pong in 163 and 168 ms. One text `PING` started `{"status":"UP"}` every 10.0 s, the first 5.8 and 7.5 s after the socket was created, for as long as the socket stayed open, W8 and W9 |
| connection lifetime and maintenance notice | idle timeout 120 s with no data sent or received, S2 and S4 | an idle socket closed at 60.5 s in both runs with 1006 and no close frame. A socket whose only traffic was one snapshot closed at 60.7 s the same way. A socket on the `UP` heartbeat was still open at 115.6 s and 71.6 s. No maintenance message type exists, W8 and W9 |
| handshake and operation rate limits | as in the chunk row, S3. A request carrying an `Origin` header is held to one per 10 s, S5 | the upgrade reply carries `remaining-req: group=websocket; min=300; sec=3` and `limit-by-ip: Yes`, W10 and W11. No refusal was provoked |
| public market data authentication | none | none |
| message parse and routing | every frame is a JSON object with `type` and `code`, or `ty` and `cd` in `SIMPLE`, S1 | route on `code`, which is the pair id without the `.{n}` suffix |
| subscribe acknowledgement shape | none documented | none. The first frame is the data itself. Snapshots came in two bursts: the first 172 to 188 ms after the subscribe frame and the rest 328 to 354 ms after it, W1 to W3 |
| symbol identifier format | `KRW-BTC`, quote first, upper case, S1 | identical to CCXT `market.id` and to the REST `market` on 855 of 855 pairs, see [`rest.md`](./rest.md) section 2 |
| number representation | Double, S1 | JSON numbers. Large prices come in exponent form, as in `1.16539E8`, and sizes keep trailing zeros, as in `0.00077720`, W12. In `SIMPLE` prices are plain and small sizes are in exponent form, as in `7.9276E-4`. The REST book writes prices in plain form, as in `116233000`, see [`rest.md`](./rest.md) section 5 |
| timestamp representation | `timestamp` in ms, S1 | integer ms. The timestamps of each busy KRW pair measured sit on a fixed 100 ms grid with a per pair phase, section 4 |
| size unit | base currency, S1 | base currency, which matches CCXT's undefined `contractSize` read as 1, section 4 |
| sequence semantics | none | no sequence or update id in the frame. Timestamps never went backwards in 2,452 book frames over three runs |
| idle repeat behaviour | not documented | a quiet book sends nothing. One identical consecutive book was seen, on `USDT-BTC` in W1, and none in W2 or W3 |

## 4. The book channel in detail

`orderbook` at the default 30 levels is the only book channel, and every row below is about it.

### Snapshot on subscribe

The first frame for each code carries `"stream_type": "SNAPSHOT"`, and every later frame carries `"REALTIME"`, W1 to W3.
Every code of the seven in each `book` run, and all 855 codes in each `batch` run, got exactly one snapshot, W1 to W5.
A snapshot of a quiet book carries the time of the book's last change, not the send time: `KRW-USDS` arrived with a `timestamp` 6.8 s, 33 s and 143 s old, and `BTC-BERA` with one 98 s old, W1 to W3.
`is_only_snapshot: true` sends one snapshot and nothing more, W1 to W3 and W9.

### Delta semantics

There are no deltas.
A `REALTIME` frame is a whole book of 30 levels in the same shape as the snapshot, W1 to W3.
CCXT Pro says the same: its comment calls the `REALTIME` frames "not incremental" and adds "therefore we reset the orderbook on each update", at `server/node_modules/ccxt/js/src/pro/upbit.js` lines 257 to 261.
The comment there says 15 levels, and the wire sent 30 in every one of 2,452 book frames over three runs.

### Sequence and gap rule

```text
every frame   replace the whole book with the 30 levels in the frame
```

There is no id to chain, so a lost frame cannot be detected and is repaired by the next frame.
Each of the three busy KRW pairs published on a fixed 100 ms grid: all 171 `KRW-BTC` timestamps in W3 ended in 06 ms modulo 100, all 144 `KRW-ETH` in 64, and 275 of 276 `KRW-XRP` in 79.
The median gap between frames was 100 to 107 ms on the three busy KRW pairs in every run.
`BTC-ETH` sat near a 100 ms grid too, with 8 of 9 timestamps ending in 13 ms and one in 14 ms.
`USDT-BTC` did not: its timestamps spread over every tens digit, ending in 8 or 9 ms, and its median gap was 190 to 299 ms.
The USDT and BTC markets are shared with Upbit Indonesia and Thailand, see [`fees.md`](./fees.md) section 1, which may be why their cadence differs.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

Each element of `orderbook_units` is one bid and one ask at the same depth, `{"ask_price", "bid_price", "ask_size", "bid_size"}`.

| frame | bids | asks |
|---|---|---|
| snapshot and realtime | best first, strictly descending, in every frame of W1 to W3, zero slots aside | best first, strictly ascending, in every frame, zero slots aside |
| REST `/v1/orderbook` | descending | ascending, see [`rest.md`](./rest.md) section 5 |

A feed walks the array once and emits `bid_price, bid_size` into the bid side and `ask_price, ask_size` into the ask side.

### Level window

The server always sends 30 elements, and the book is exactly that window.
The `.{n}` suffix narrows it: `KRW-BTC.15` sent 15 and `KRW-ETH.5` sent 5, W1 to W3.
An unsupported count widens it back to 30: `KRW-ETH.20` sent 30 in W6 and W7, and `USDT-ETH.2` sent 30 in W12.
`level` groups prices: `KRW-XRP` with `level: 10` sent `lv` 10.
`level` on a BTC market pair sent nothing at all, W6 and W7, and the REST book answers the same request with `[]`.

### Size unit against CCXT `contractSize`

Sizes are in the base currency: `KRW-BTC` `ask_size` `0.00077720` at `1.16542E8` is 0.0007772 BTC offered at 116,542,000 KRW, W12.
CCXT leaves `contractSize` undefined on every Upbit market, at `server/node_modules/ccxt/js/src/upbit.js` line 548, and the connector reads a missing contract size as 1, at [`connector.ts`](../../../server/src/ccxt/connector.ts) lines 175 and 188 to 194.
In W2 and W3 every REST book read of `KRW-BTC`, `KRW-XRP` and `KRW-USDS` matched the socket frame with the same `timestamp` level for level, 12 of 12.
The REST book was 0 to 200 ms behind the newest socket frame at the moment of the read.
W1 compared keys in order and so reported a mismatch, because REST writes `bid_price` first, and it is not counted.

### One-sided and empty books

A side with fewer than 30 orders is padded with zero slots.
Every `BTC-BERA` frame of W1 to W3 had bid slots of `bid_price` 0 and `bid_size` 0, and the REST book showed 6 or 7 of them, `{"bid_price":0,"bid_size":0,"ask_price":0.00000689,"ask_size":8.70827286}`.
42 of 60 BTC market books read over REST carried at least one zero slot, see [`rest.md`](./rest.md) section 5.
A feed must drop any level whose price or size is 0 before it calls `resetBook`.
A book with no orders at all on one side was not found.

### Idle repeats

A quiet book sends nothing.
`KRW-USDS` sent 1, 3 and 1 frames in the three runs, and in `batch` 181 and 191 of 855 codes sent only their snapshot in 40 and 30 s, W4 and W5.
Only one identical consecutive book was seen in 2,452 frames, on `USDT-BTC` in W1.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `KRW-NOPE` | nothing | the socket stays open |
| `KRW-NOPE` with `KRW-BTC` | nothing for `KRW-NOPE` | `KRW-BTC` delivers |
| `krw-btc` | nothing | the socket stays open. The REST book accepts lower case |
| `BTC-ETH` with `level: 100` | nothing | |
| `KRW-ETH.20` | a 30 level snapshot | |
| a ticket object missing | `{"error":{"name":"NO_TICKET",...}}` | the server closes with 1000 about 150 to 180 ms after the error |
| a `type` missing | `NO_TYPE` | closed with 1000 |
| `codes` missing | `NO_CODES` | closed with 1000 |
| type `nope` | `INVALID_PARAM`, "nope 은 지원하지 않는 타입입니다." | closed with 1000 |
| text `hello`, or a JSON object instead of an array | `WRONG_FORMAT` | closed with 1000 |

A delisted pair was not available to probe.
Because an unknown code is accepted silently, a feed has to notice a code with no snapshot on its own.

### A second subscribe replaces the first

Sending a second subscribe frame on an open socket ends the first subscription, as S4 says.
After `KRW-BTC` then `KRW-ETH`, the socket sent 0 and 2 more `KRW-BTC` frames, then only `KRW-ETH`, W6 and W7.
So a connection's whole code list goes in one frame, and changing it means resending the whole list.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | protocol ping, or text `PING` for `{"status":"UP"}` every 10 s, S2 | no server ping in any run. Protocol pong in 163 and 168 ms. A text `PING` got no immediate answer on a subscribed socket in 2.5 s, and started the 10 s `UP` cycle on an unsubscribed one, W7 to W9 |
| silence the server tolerates | 120 s, S2 and S4 | 60.5 s on an unsubscribed idle socket in two runs, and 60.7 s on a socket whose only frame was a snapshot at 0.7 s. The close is 1006 with no close frame |
| forced disconnect | not documented | none in 115 s |
| maintenance notice | not documented | none, and no system message type exists |
| compression | permessage-deflate is supported, and the client library decompresses, so no compression code is needed, S2 | the server accepts `permessage-deflate` when the client offers it, and sends no extension header when it does not, W10 and W11. Frames are WebSocket binary frames, opcode 2, holding UTF-8 JSON: every one of 2,807 frames in W1 to W3 was binary |
| handshake | TLS 1.2 or later, S2 | 490 to 566 ms to open |
| subscription limits | 5 messages a second and 100 a minute per connection, 5 connections a second per IP, S3 | not approached. The probe sent at most 3 messages on one socket and opened at most 3 sockets in one second |
| throughput | | all 855 pairs on one socket: 785 and 795 frames a second median, peak 923 and 995, 2.17 and 2.23 MB a second, 2,736 and 2,737 bytes a frame, 18.9 and 21.3 µs of `JSON.parse` per frame, W4 and W5 |

`ws` hands a binary frame to the `message` handler as a `Buffer` exactly as it does a text frame, so the engine's `handleMessage(raw: Buffer)` needs no change for it.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Each `orderbook_units` array below keeps its first two elements.
The two `orderbook` frames are from W12, whose raw heads show the wire spelling of the numbers, and their last two keys are restored from the parsed frames.

Subscribe, one ticket, three types, and the format.

```json
[{"ticket":"79dd616e-ec66-44f4-8c6a-e9a3ada12235"},{"type":"orderbook","codes":["KRW-BTC","KRW-ETH","KRW-XRP","KRW-USDS","BTC-ETH","USDT-BTC","BTC-BERA"]},{"type":"ticker","codes":["KRW-BTC"]},{"type":"trade","codes":["KRW-BTC"]},{"format":"DEFAULT"}]
```

There is no acknowledgement.
The snapshot, as the wire spells its numbers.

```json
{"type":"orderbook","code":"KRW-BTC","timestamp":1790134742106,"total_ask_size":2.51469375,"total_bid_size":1.63815297,"orderbook_units":[{"ask_price":1.16539E8,"bid_price":1.16538E8,"ask_size":0.02054761,"bid_size":0.08120946},{"ask_price":1.16542E8,"bid_price":1.16537E8,"ask_size":0.00077720,"bid_size":0.01129382}],"stream_type":"SNAPSHOT","level":0}
```

The first `REALTIME` frame, 0.9 s later on the grid, is another whole book.
In it the best bid size changed from `0.08120946` to `0.06612366`.

```json
{"type":"orderbook","code":"KRW-BTC","timestamp":1790134743006,"total_ask_size":1.83604250,"total_bid_size":1.62306717,"orderbook_units":[{"ask_price":1.16539E8,"bid_price":1.16538E8,"ask_size":0.02054761,"bid_size":0.06612366},{"ask_price":1.16542E8,"bid_price":1.16537E8,"ask_size":0.00077720,"bid_size":0.01129382}],"stream_type":"REALTIME","level":0}
```

The same stream in `SIMPLE` format, from the second socket of W12.

```json
{"ty":"orderbook","cd":"KRW-BTC","tms":1790134773006,"tas":0.48514983,"tbs":2.2403413,"obu":[{"ap":116606000,"bp":116534000,"as":0.06288509,"bs":7.9276E-4},{"ap":116609000,"bp":116521000,"as":5.0E-4,"bs":0.01624318}],"st":"SNAPSHOT","lv":0}
```

`SIMPLE` spells numbers differently from `DEFAULT`: prices come plain and small sizes in exponent form, as in `7.9276E-4`, W12.

Keepalive, sent every 10 s after one text `PING`.

```json
{"status":"UP"}
```

Errors, each followed by a close with code 1000.

```json
{"error":{"name":"NO_TICKET","message":"티켓이 존재하지 않거나, 유효하지 않습니다."}}
```

```json
{"error":{"message":"nope 은 지원하지 않는 타입입니다.","name":"INVALID_PARAM"}}
```

```json
{"error":{"message":"Format 이 맞지 않습니다.","name":"WRONG_FORMAT"}}
```

## 7. Private channels

Named for a future execution stage, from S2, not probed.
`myOrder` and `myAsset` stream on `wss://api.upbit.com/websocket/v1/private` with a JWT bearer token in the `Authorization` header.
Order entry is REST only, and CCXT Pro subscribes the private types with the same ticket array at `server/node_modules/ccxt/js/src/pro/upbit.js` line 397.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
Upbit cannot join today, because the connector keeps only swap markets, see [`fees.md`](./fees.md) section 9, so this is the shape a spot leg would take.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://api.upbit.com/websocket/v1` | one URL serves every pair |
| channel | `orderbook`, codes with no suffix, no `level` | 30 raw levels covers the engine's 20 |
| markets per connection | all tracked pairs, or slices of a few hundred | 855 pairs ran on one socket at 795 frames a second with every snapshot served, and nothing larger exists |
| subscribe frames | exactly one per connection: `[{"ticket": "<uuid>"}, {"type": "orderbook", "codes": [...]}, {"format": "DEFAULT"}]` | a second frame replaces the first subscription |
| keepalive | send the text `PING` once after the subscribe, and a protocol ping every 10 s | a socket with no traffic dies at about 60 s. The `UP` cycle was only seen on an unsubscribed socket, and whether a client ping resets the server's idle timer is Not verified, so the pong, which the silence watch counts at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) lines 97 and 98, is the heartbeat that is certain |
| `maxSilenceMs` | 25,000 | two missed pongs, and a quiet pair can go the whole 40 s run without a book frame, so the book stream cannot be the heartbeat |
| routing | `frame.code` is the `rawMarketId` | the stream is keyed by the pair id |
| every frame | drop elements whose price or size is 0, then `resetBook` with the 30 levels | whole book frames, zero padded sides |
| resync | none per pair, since there is no sequence. Reconnect on close or silence and resubscribe the whole list | a lost frame is healed by the next one |
| unserved code | log a code with no snapshot 10 s after the subscribe | unknown and lower case codes are accepted silently |
| receive time | stamp on arrival, never from `timestamp` | a quiet book's snapshot carries a timestamp up to 143 s old |
| numbers | `Number()` on JSON numbers, which parses `1.16539E8` | exponent form on the wire |
| deflate | keep `perMessageDeflate: false` | the server negotiates it only when asked |
| headers | send no `Origin` header | an `Origin` request is limited to one per 10 s, S5 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | 호가 (Orderbook) WebSocket, page updated 2026-09-09 | https://docs.upbit.com/kr/reference/websocket-orderbook | 2026-09-23 | Dunamu, Korea | fields, `.{n}` suffix, `level`, error names, limits, sections 2 to 4 |
| S2 | WebSocket 사용 및 에러 안내, page updated 2026-09-16 | https://docs.upbit.com/kr/reference/websocket-guide | 2026-09-23 | Dunamu, Korea | endpoints, request structure, idle timeout, PING and UP, compression, sections 1 to 5 and 7 |
| S3 | 요청 수 제한 (Rate Limits), page updated 2026-09-08 | https://docs.upbit.com/kr/reference/rate-limits | 2026-09-23 | Dunamu, Korea | `websocket-connect` and `websocket-message`, sections 3 and 5 |
| S4 | WebSocket 연동 Best Practice, page updated 2026-08-26 | https://docs.upbit.com/kr/docs/websocket-best-practice | 2026-09-23 | Dunamu, Korea | a new subscribe replaces the old, 120 s idle, sections 3 to 5 |
| S5 | API 공통 문의, Origin header limit | https://docs.upbit.com/kr/docs/faq-api | 2026-09-23 | Dunamu, Korea | one request per 10 s with `Origin`, sections 3 and 8 |
| S8 | Orderbook WebSocket, regional sites, page updated 2026-08-31 | https://global-docs.upbit.com/reference/websocket-orderbook | 2026-09-23 | Upbit Singapore, Indonesia, Thailand | regional URLs, section 1 |
| S13 | 현재가 (Ticker) WebSocket, page updated 2026-09-09 | https://docs.upbit.com/kr/reference/websocket-ticker | 2026-09-23 | Dunamu, Korea | ticker fields, section 2 |
| C2 | CCXT Pro 4.5.68 `upbit.js` | `server/node_modules/ccxt/js/src/pro/upbit.js` | 2026-09-22 | CCXT | whole book reset, the 15 level comment, private ticket, sections 4 and 7 |
| C1 | CCXT 4.5.68 `upbit.js` | `server/node_modules/ccxt/js/src/upbit.js` | 2026-09-22 | CCXT | `contractSize` undefined, section 4 |
| W1 | `ws-probe.mjs book`, 40 s, at 03:17 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 to 5 |
| W2 | `ws-probe.mjs book`, 30 s, second pass at 03:27 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 to 6, REST agreement |
| W3 | `ws-probe.mjs book`, 30 s, with the timestamp grid tally, at 03:32 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit/ws-probe.mjs) | 2026-09-23 UTC | this host | the 100 ms grid, sections 3 and 4 |
| W4 | `ws-probe.mjs batch`, 855 pairs for 40 s, at 03:18 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit/ws-probe.mjs) | 2026-09-23 UTC | this host | throughput, snapshot coverage, section 5 |
| W5 | `ws-probe.mjs batch`, 855 pairs for 30 s, second pass at 03:27 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit/ws-probe.mjs) | 2026-09-23 UTC | this host | the same, second reading |
| W6 | `ws-probe.mjs errors`, one socket per case, at 03:20 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit/ws-probe.mjs) | 2026-09-23 UTC | this host | errors, replacement, protocol pong, section 4 |
| W7 | `ws-probe.mjs errors`, second pass at 03:28 UTC, with a text `PING` on a subscribed socket | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit/ws-probe.mjs) | 2026-09-23 UTC | this host | the same, second reading |
| W8 | `ws-probe.mjs silence`, an earlier two socket version held 115 s, at 03:21 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit/ws-probe.mjs) | 2026-09-23 UTC | this host | 60.5 s idle close, `UP` every 10 s for 115 s |
| W9 | `ws-probe.mjs silence`, three sockets up to 70 s, second pass at 03:29 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit/ws-probe.mjs) | 2026-09-23 UTC | this host | 60.5 s and 60.7 s closes, `UP` cycle |
| W10 | `ws-probe.mjs deflate` at 03:17 and 03:25 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit/ws-probe.mjs) | 2026-09-23 UTC | this host | compression, upgrade headers |
| W11 | `ws-probe.mjs deflate`, second pass at 03:26 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit/ws-probe.mjs) | 2026-09-23 UTC | this host | the same, second reading |
| W12 | `ws-probe.mjs book`, 30 s, with raw frame heads and the `.2` suffix, at 03:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/upbit/ws-probe.mjs) | 2026-09-23 UTC | this host | the wire number form, the unsupported suffix, sections 3, 4 and 6 |
