# OKJ WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:18 to 03:35 UTC), from the development host near Seattle.

OKJ lists no perpetual, so this profile covers the public spot WebSocket, as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks, see [`fees.md`](./fees.md) section 3.
OKJ runs two public APIs side by side.
V5, released on 2026-09-16 per S3, is a copy of the OKX V5 protocol on OKJ hosts, and every row below is about it unless it says V3.
The legacy V3 socket is still live and is covered in section 1 only, because it deflates every message inside the frame.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/okj/ws-probe.mjs), and the capture is quoted beside the documented value.

## 1. Endpoints

| API | documented URL | probed |
|---|---|---|
| V5 public | `wss://ws.okj.com:443/ws/v5/public`, S1 | open in 470 to 623 ms over 18 sockets, recommended |
| V5 private | `wss://ws.okj.com:443/ws/v5/private`, S1 | not probed |
| V5 business | `wss://ws.okj.com:443/ws/v5/business`, S1 | not probed |
| V3 | `wss://connect.okj.com:443/ws/v3`, S2 | open in 588 ms. Every frame was binary, and each one decoded with raw inflate: the ack, a `spot/depth` `partial` and its `update` frames |

The "AWS URL" of S1 is the same host.
`ws.okj.com` resolved to three addresses in AWS `ap-northeast-1` (Tokyo) on 2026-09-23, see [`rest.md`](./rest.md) section 1.
All 47 spot pairs are served on the one public URL, and there is no other family to split on.

V3 documents that "All the messages returning from WebSocket API are optimized by Deflate compression", S2, and the wire agreed.
Its depth channel carries a checksum and no sequence id, and its pushes stamp an ISO time string.
The engine refuses permessage-deflate and does not inflate inside the frame, so V3 would need a decoder, and V5 does not.

## 2. Channel matrix for public market data

| channel | payload | depth and speed, from S1 | probed on 2026-09-23 |
|---|---|---|---|
| `books` | `{"channel": "books", "instId": "BTC-JPY"}` | 400-level snapshot, then deltas every 100 ms | snapshot then deltas on every pair, recommended |
| `books5` | same | 5-level snapshot every 100 ms on change | 375 frames in 60 s, and 90 in 30 s in the rerun, on `BTC-JPY` |
| `bbo-tbt` | same | 1 level every 10 ms on change | 400 frames in 60 s, and 53 in 30 s, on `BTC-JPY` |
| `books50-l2-tbt` | same | 50 levels tick by tick, "only available to VIP clients" | code `60011` "Please log in" |
| `books-l2-tbt` | same | 400 levels tick by tick, VIP only | code `60011` "Please log in" |
| `tickers` | same | fastest 1 update per 100 ms, on a trade or a best bid or ask change | 258 frames in 60 s, and 34 in 30 s, on `BTC-JPY` |
| `trades`, `trades-all`, `candle*`, call auction details | | | not probed |
| `instruments`, price limit | | pushed on a state change, and on a limit change at most once a second | not probed |
| `mark-price`, `index-tickers`, `funding-rate` | | not documented | code `60018` "Wrong URL or channel:… doesn't exist" |

The overview of S1 still names a "mark price channel" among public channels, a sentence carried over from OKX, and the wire refuses it.
No channel carries an index, a mark or a funding rate.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL, separate private and business URLs, S1 | 47 pairs on one socket, section 5 |
| subscribe frame shape | `{"op": "subscribe", "args": [{"channel": "books", "instId": "BTC-JPY"}]}`, several args per frame, total length at most 64 KB, S1 | one frame of 1,876 bytes with 47 args got 47 acks, one per arg |
| unknown symbol expectation | error event, code `60018`, S1 | `{"event":"error","msg":"Wrong URL or channel:books,instId:NOPE-JPY doesn't exist. …","code":"60018","connId":"78d58071"}`, and the socket stays open |
| chunk unit and budget | "each of less than 30 channels" per connection for 50 or 400 depth channels, recommended, S1 | 47 `books` streams on one socket delivered with 0 gaps in three runs of 45, 45 and 30 s |
| keepalive mechanism | send the text `ping` when nothing arrived for N < 30 s, expect `pong`, S1 | `pong` came back 117 and 116 ms after `ping`. No protocol ping from the server on the 7 silence sockets, the longest open 75 s |
| connection lifetime and maintenance notice | a sequence reset "due to maintenance", S1. Maintenance is announced on the help center, S5 | no forced close in 75 s, and no notice frame seen |
| handshake and operation rate limits | 3 connection requests per second per IP, and 480 subscribe, unsubscribe or login requests per connection per hour, S1 | no refusal in 18 opens over 17 minutes |
| public market data authentication | none, except the two VIP channels, S1 | none. The VIP channels answer `60011` |
| message parse and routing | `{arg: {channel, instId}, action, data: [ … ]}`, S1 | route on `arg.channel` and `arg.instId` |
| subscribe acknowledgement shape | `{"event": "subscribe", "arg": {…}, "connId": "…"}`, S1 | as documented, one ack per arg. Each ack arrived before the first data frame of its arg, 47 of 47 in the third batch run and 7 of 7 in the second book run |
| symbol identifier format | `BTC-JPY`, S1 | identical to REST `instId` on 47 of 47 pairs, and to `market.id` of the `okx` class under a hostname swap, see [`rest.md`](./rest.md) section 2 |
| number representation | levels `[price, size, "0", orders]` as strings, S1 | as documented. `checksum`, `seqId` and `prevSeqId` are JSON integers |
| timestamp representation | `ts` in ms as a string, S1 | as documented |
| size unit | "quantity in base currency for Spot", S1 | base currency. Socket and REST sizes at the same price were equal on 40 of 40 top levels for `BTC-JPY` and `XRP-JPY` |
| sequence semantics | `prevSeqId` equals the previous `seqId`, snapshot `prevSeqId` is -1, a reset can make `seqId` smaller, S1 | 0 gaps and 0 resets in 849 and 283 deltas on four pairs over 60 and 30 s, and in 2,656, 2,211 and 1,493 deltas on 47 pairs over 45, 45 and 30 s |
| idle repeat behaviour | an empty `asks` and `bids` update with `seqId` equal to `prevSeqId` when a book is idle "for an extended period", S1 | never seen. `ENJ-JPY` went 32.7 s without a frame and `BERA-JPY` sent nothing after its snapshot for 45 s |

## 4. The book channel in detail

`books` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame per pair is `"action": "snapshot"` with the whole book up to 400 levels and `prevSeqId` -1.
On 2026-09-23 every one of 47 pairs got its snapshot, the last 629, 583 and 637 ms after the subscribe frame in the three batch runs.
In the two book runs the four snapshots arrived 261 to 263 ms and 284 to 285 ms after the subscribe frame.
No second snapshot came in 60 s, and a duplicate subscribe to the same pair was acknowledged again without a new snapshot in the 1.8 s before the probe closed the socket.

### Delta semantics

An `update` carries `asks` and `bids` arrays of `[price, size, "0", orders]`.
A size of `"0"` deletes the level, and a new price is inserted, S1.
Deltas came at most every 100 ms per pair, and a pair with no change sent nothing.

### Sequence and gap rule

```text
action = snapshot                 replace the book, last = seqId
action = update, prevSeqId = last apply, last = seqId
action = update, seqId < prevSeqId  documented reset after maintenance: prevSeqId still equals last, so it applies as above
action = update, prevSeqId ≠ last   gap: resubscribe or terminate the socket (the engine's resync)
```

The `seqId` space is per pair and is the same on every connection, S1.
One update can advance the id by more than one, as the `LTC-JPY` update with `prevSeqId` 1385894 and `seqId` 1385896 did, so a feed chains on `prevSeqId` and never on `seqId + 1`.
The rule held on every delta of every run, with 0 gaps and 0 resets.

### Checksum

Every snapshot and update carries `checksum`, a signed CRC32 of the first 25 bids and asks interleaved as `bid price:bid size:ask price:ask size:…`, using the price and size strings as sent, S1.
The probe computed it over its local book after each frame and matched every frame: 853 and 287 on four pairs, and 2,703, 2,258 and 1,540 on 47 pairs, 7,641 in all, with 0 mismatches.
OKX itself retired this checksum on 2026-06-23 and sends 0, per `server/src/venues/okx/types.ts` line 13, while OKJ still sends a live one.
The OKX feed of this repository ignores the field, so an OKJ feed built from it may skip the checksum too, and the sequence rule alone found no fault.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on 55 of 55 snapshots checked in the two book runs and the third batch run | best first, ascending |
| update | descending on every update with more than one bid, 0 exceptions in about 7,500 updates | ascending, 0 exceptions |
| REST `market/books` | descending | ascending |

A feed still applies updates by price, because S1 promises only the merge rule.

### Level window

The whole book fits inside 400 levels on every pair today.
`BTC-JPY` held 148 or 149 bids and 66 to 70 asks, the deepest of all 47, and the REST `books-full` call with `sz=5000` returned the same 148 bids and 68 asks, see [`rest.md`](./rest.md) section 5.
So a feed that keeps the top 20 levels per side sees the true top 20, and no level leaves the window.

### Size unit against CCXT `contractSize`

There is no contract, so there is no `contractSize` to match.
Sizes are base-currency amounts, as S1 says for spot.

| pair | socket size at the touch | REST size at the same price | equal sizes, top 20 levels per side |
|---|---|---|---|
| `BTC-JPY` | `["13618276", "0.02180494"]` bid | `["13618276", "0.02180494"]` | 40 of 40 |
| `XRP-JPY` | `["251.58", "785.388"]` bid | `["251.58", "785.388"]` | 40 of 40 |

### One-sided and empty books

Every pair had both sides on 2026-09-23.
No snapshot in the third batch run held fewer than 7 bids or 10 asks, and the REST tickers had a bid and an ask on 47 of 47 pairs.
What `books` sends for a side with no orders is Not verified.

### Idle repeats

The documented idle keepalive, an empty update with `seqId` equal to `prevSeqId`, was never seen in any run.
Quiet pairs simply sent nothing: `LSK-JPY` went 25.5 s without a frame, `ENJ-JPY` 32.7 s, `BERA-JPY` sent no update in the 45 s after its snapshot, and `NEO-JPY` none in 30 s.
So the silence watch cannot rely on a quiet pair and needs the `pong`, section 5.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `books` `NOPE-JPY` | `60018` "Wrong URL or channel:books,instId:NOPE-JPY doesn't exist. …" | the socket stays open |
| `books` `BTC-USDT` | `60018`, same text | |
| `books50-l2-tbt` or `books-l2-tbt` `BTC-JPY` | `60011` "Please log in" | |
| channel `nope`, `mark-price`, `index-tickers` or `funding-rate` | `60018` | |
| `books` `LTC-JPY` twice | a second `subscribe` ack | no second snapshot, deltas continue |
| text that is not JSON | `60012` "Illegal request: {\"op\":\"subscribe\"," | the next subscribe on the same socket succeeded |

A suspended pair was not available to probe, since all 47 were `live`.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | text `ping`, answer `pong`, S1 | `pong` in 116 to 117 ms. No protocol ping from the server |
| silence the server tolerates | "The connection will break automatically if the subscription is not established or data has not been pushed for more than 30 seconds", S1. Close code 4004 "No data received in 30s", S1 | a socket with no subscription and no client frame closed at exactly 30,000 ms with code 4004 and reason "No data received in 30s." in two runs. A socket with no subscription and a `ping` every 20 s stayed open for 50 s. A socket on a quiet book with no client frame stayed open for 75 s in two runs, its longest gap 15.1 s and 13.6 s |
| forced disconnect | close codes 4005 "Buffer is full, cannot write data" and 4006 "Abnormal disconnection", S1 | none in 75 s |
| maintenance notice | help center announcements, S5 | not observed |
| compression | not documented for V5 | text JSON frames. The server negotiates `permessage-deflate` when a client offers it, and sends plain frames when the client does not, as the engine does |
| handshake | 3 connection requests per second per IP, S1 | 470 to 623 ms to open |
| subscription limits | 480 subscribe, unsubscribe and login operations per connection per hour. Args at most 64 KB per frame. Fewer than 30 depth channels per connection recommended, S1 | 47 args in one frame were accepted |
| throughput | | 47 pairs on one socket: median 60, 47 and 48 frames per second, peak 128, 118 and 152, 16.6, 14.1 and 14.9 KB per second, 271 to 281 bytes per frame, 8.6 to 9.9 µs `JSON.parse` per frame, in the three batch runs |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Level arrays are cut to three levels.

Subscribe, several args in one frame.

```json
{"op": "subscribe", "args": [{"channel": "books", "instId": "BTC-JPY"}, {"channel": "books", "instId": "ETH-JPY"}]}
```

Acknowledgement, one per arg.

```json
{"event":"subscribe","arg":{"channel":"books","instId":"BTC-JPY"},"connId":"431d41f8"}
```

Snapshot.

```json
{"arg":{"channel":"books","instId":"XRP-JPY"},"action":"snapshot","data":[{"asks":[["252.52","1909.156","0","2"],["252.57","247.76","0","1"],["252.77","856.465","0","2"]],"bids":[["251.87","601.749","0","1"],["251.86","32.4","0","1"],["251.75","149.802","0","1"]],"ts":"1790133750004","checksum":2077395788,"seqId":4588907,"prevSeqId":-1}]}
```

The first delta after it, whose `prevSeqId` is the snapshot's `seqId`.

```json
{"arg":{"channel":"books","instId":"XRP-JPY"},"action":"update","data":[{"asks":[["252.54","32.4","0","1"],["252.57","0","0","0"],["267.62","0","0","0"]],"bids":[],"ts":"1790133750704","checksum":-1242588839,"seqId":4588911,"prevSeqId":4588907}]}
```

A delta that advanced the id by two.

```json
{"arg":{"channel":"books","instId":"LTC-JPY"},"action":"update","data":[{"asks":[["9991","0","0","0"],["9994","0.94154599","0","1"]],"bids":[],"ts":"1790133516104","checksum":-1624804252,"seqId":1385896,"prevSeqId":1385894}]}
```

Best bid and ask.

```json
{"arg":{"channel":"bbo-tbt","instId":"BTC-JPY"},"data":[{"asks":[["13643522","0.03682508","0","2"]],"bids":[["13615496","0.03452263","0","2"]],"ts":"1790133525304","seqId":27270896}]}
```

Keepalive: the client sends the four characters `ping` and the server answers the four characters `pong`, both as text frames, not JSON.

Errors.

```json
{"event":"error","msg":"Please log in","code":"60011","connId":"78d58071"}
```

```json
{"event":"error","msg":"Illegal request: {\"op\":\"subscribe\",","code":"60012","connId":"78d58071"}
```

Ticker, which carries no anchor field.

```json
{"arg":{"channel":"tickers","instId":"BTC-JPY"},"data":[{"instType":"SPOT","instId":"BTC-JPY","last":"13615162","lastSz":"0.00372484","askPx":"13643522","askSz":"0.03682508","bidPx":"13615496","bidSz":"0.03452263","open24h":"13438187","high24h":"13658217","low24h":"13387950","sodUtc0":"13613684","sodUtc8":"13566076","volCcy24h":"26728364.99010502","vol24h":"1.97197787","ts":"1790133523810"}]}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They need a login on the private URL.

- `account`, `balance_and_position`, `orders`, and `orders-algo` on the business URL.
- Order entry over the socket: `order`, `batch-orders`, `cancel-order`, `batch-cancel-orders`, `amend-order`, `batch-amend-orders`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision, and only relevant if the engine ever takes a spot or JPY leg.

| item | recommendation | reason |
|---|---|---|
| starting point | the OKX feed at `server/src/venues/okx/okx.ts`, which already subscribes `books` with a text `ping` every 20 s | OKJ V5 is the same protocol on another host |
| URL plan | `wss://ws.okj.com:443/ws/v5/public` only | one URL serves every pair, and V3 deflates inside the frame |
| channel | `books` | snapshot on subscribe, a `prevSeqId` chain, the whole book inside 400 levels, and no login |
| markets per connection | 24, so two connections for 47 pairs | S1 recommends fewer than 30 depth channels per connection, although 47 ran cleanly on one |
| subscribe frames | one frame per slice, `{"op": "subscribe", "args": [{"channel": "books", "instId": "BTC-JPY"}, …]}` | multi-arg frames were acked per arg. Whether the 480 requests per hour cap counts frames or args is Not publicly specified, and one frame per slice is the smaller count either way |
| keepalive | text `ping` every 20 s | S1 asks for a ping before 30 s of quiet, a quiet pair went 32.7 s without a frame, and `pong` counts as traffic |
| `maxSilenceMs` | 45,000 | two missed pongs at a 20 s ping. A quiet pair can go more than 30 s without a book frame, so the pong has to count as traffic |
| routing | `arg.instId` is the `rawMarketId` | the REST `instId` spelling |
| snapshot | `action === "snapshot"`: `resetBook`, store `seqId` | documented replace semantics |
| delta | apply when `prevSeqId === last`, then store `seqId` | documented rule, 0 gaps observed |
| resync | `prevSeqId !== last`, or an update before any snapshot: `resync` | the engine's existing path. A documented reset and the documented idle message both keep `prevSeqId` equal to the last `seqId`, so the chain rule applies them without a special case |
| checksum | optional | 0 mismatches in 7,641 frames, and the sequence rule caught nothing |
| receive time | stamp on arrival | `ts` is the book time on the venue |
| sizes | `Number()` of the base-currency string | spot, no contract |
| deflate | keep `perMessageDeflate: false` | the server would negotiate it if offered |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | OKJ API guide, V5 | https://dev.okj.com/apidoc/v5/en/ | 2026-09-22 | OKJ | URLs, channels, limits, sequence and checksum rules, error and close codes, sections 1 to 8 |
| S2 | OKJ API guide, V3 | https://dev.okj.com/apidoc/v3/en/, the target of the old `https://dev.okcoin.jp/en/` | 2026-09-22 | OKJ | V3 URL and its deflate rule, section 1 |
| S3 | OKJ API V5 change log | https://dev.okj.com/apidoc/v5/log_en/ | 2026-09-22 | OKJ | V5 release date |
| S4 | CCXT 4.5.68 `okx.js` | `server/node_modules/ccxt/js/src/okx.js` | 2026-09-22 | CCXT | the `okx` class under a hostname swap, section 3 |
| S5 | OKJ help center, メンテナンスのお知らせ articles | https://support.okcoin.jp/hc/ja | 2026-09-22, via the help center search API | Japan | maintenance notices, section 5 |
| P1 | `ws-probe.mjs errors` and `deflate` at 03:18 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/okj/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3, 4 and 5 |
| P2 | `ws-probe.mjs book 60` at 03:18 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/okj/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 2 to 6 |
| P3 | `ws-probe.mjs batch 45`, two runs at 03:20 and 03:22 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/okj/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 to 5 |
| P4 | `ws-probe.mjs silence`, three runs at 03:21, 03:23 and 03:24 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/okj/ws-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P5 | `ws-probe.mjs v3` at 03:26 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/okj/ws-probe.mjs) | 2026-09-23 UTC | this host | section 1 |
| P6 | second pass: `batch 30`, `book 30`, `deflate` and `errors` at 03:33 to 03:35 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/okj/ws-probe.mjs) | 2026-09-23 UTC | this host | the second readings in sections 3 to 5 |
