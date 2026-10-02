# Pionex WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:21 to 03:45 UTC), from the development host near Seattle.

This profile covers the public WebSocket of Pionex for every perpetual family, with the `ORDERBOOK` channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/pionex/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation is the Futures WebSocket section of the Pionex docs site, which answered this host with 200, see [`fees.md`](./fees.md) section 1.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| every perpetual family, public | `wss://ws.pionex.com/wsPub`, S1 | open in 100 to 201 ms over all runs, and USDT-M, coin-quoted and `USDT_<coin>` books all delivered on one socket |
| spot, public | the same URL, S8 | `ORDERBOOK` on the spot symbol `BTC_USDT` was acknowledged and delivered a snapshot and updates, although S2 says the channel serves "only futures symbols" |
| private, futures | `wss://ws.pionex.com/wsUA`, S1 | not probed |

One socket carries every family and spot, so the URL plan has no family axis.
`ws.pionex.com` resolved through `cf-cdn.pionex.com` to the Cloudflare addresses `104.18.2.190` and `104.18.3.190`, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| topic | subscribe frame | depth and speed, documented | probed on 2026-09-23 |
|---|---|---|---|
| `ORDERBOOK` | `{"op": "SUBSCRIBE", "topic": "ORDERBOOK", "symbol": "BTC_USDT_PERP"}` | snapshot of 100 levels, then "Incremental changes only (50ms aggregation)", S2 | snapshot then deltas, one frame per 204 to 211 ms median on `BTC_USDT_PERP` and `ETH_USDT_PERP` over five runs, recommended |
| `DEPTH` | `{"op": "SUBSCRIBE", "topic": "DEPTH", "symbol": "BTC_USDT_PERP", "limit": 20}` | a whole top `limit` book, 1 to 100 levels, "Updates every 250ms (if changes) to 5s (if no changes)", S2 | a whole 20 level book every 610 to 618 ms median on BTC, and every 10 s on a quiet book |
| `INDEX` | `{"op": "SUBSCRIBE", "topic": "INDEX", "symbol": "BTC_USDT_PERP"}` | "Real-time index price, mark price, and funding rate information", S2 | one frame per 339 to 352 ms median, with `indexPrice`, `markPrice`, `nextFundingRate`, `nextFundingTime`, `updateTime` |
| `TRADE` | `{"op": "SUBSCRIBE", "topic": "TRADE", "symbol": "BTC_USDT_PERP"}` | "Only TAKER side trades are pushed.", S2 | 66 to 112 frames in 60 s on BTC |
| best bid and ask, ticker | none documented | none | the REST `bookTickers` call is the only best bid and ask source, see [`rest.md`](./rest.md) section 5 |

The `INDEX` topic carries every `AnchorRow` field except the funding interval, one symbol per subscription.
It is a candidate anchor source, but the bulk REST call already returns all 605 rows in one reply, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL, S1 | one URL for every perpetual family and for spot, section 1 |
| subscribe frame shape | `{"op": "SUBSCRIBE", "topic": "<TOPIC>", "symbol": "<SYMBOL>"}`, one symbol per frame, S3 | a comma list in `symbol` answered `INVALID_SYMBOL`, and an array answered `PARAMETER_ERROR` `bad json payload`, so one frame carries one stream |
| unknown symbol expectation | Not publicly specified | `{"type":"ERROR","code":"INVALID_SYMBOL","message":"invalid \`symbol\`","timestamp":…}` within 21 to 24 ms |
| chunk unit and budget | "Maximum 5 messages per second per connection", "Maximum 10 concurrent connections per IP", "Single connection can subscribe to multiple data streams", S4 | 100 `ORDERBOOK` streams on one socket at 4 frames a second, all acknowledged and all snapshotted, in two runs. The per connection stream cap is Not publicly specified and was not reached |
| keepalive mechanism | "Server sends `{"op": "PING", "timestamp": <ms>}` every 15 seconds", "Client must reply `{"op": "PONG", "timestamp": <ms>}`", S5 | a server `PING` every 14,995 to 15,004 ms on every socket. A client `PING` got no answer |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 75 s, and no maintenance frame seen |
| handshake and operation rate limits | 5 client messages per second per connection and 10 connections per IP, S4 | the probe kept to 4 frames per second and at most 3 concurrent sockets, so neither limit was tested |
| public market data authentication | none, S1 | none |
| message parse and routing | `{topic, symbol, timestamp, data}`, S2 | route on `topic` and `symbol`. Control frames carry `type` (`SUBSCRIBED`, `UNSUBSCRIBED`, `ERROR`) or `op` (`PING`) and no `data` |
| subscribe acknowledgement shape | `{"type": "SUBSCRIBED", "topic": "<TOPIC>", "symbol": "<SYMBOL>"}`, S3 | as documented, with the key order varying between frames. The snapshot arrives 20 to 29 ms after the subscribe frame leaves, right behind the ack |
| symbol identifier format | `BTC_USDT_PERP` | identical to the REST catalog `symbol`, the `indexes` `symbol` and the `depth` parameter. Five symbols are not ASCII, such as `币安人生_USDT_PERP`, see [`rest.md`](./rest.md) section 2 |
| number representation | levels `[price, size]` as strings, S2 | strings, with trailing zeros kept on the socket (`"5.0050"`) and trimmed in REST depth (`"5.005"`) |
| timestamp representation | `timestamp` in ms, and `timeStamp` inside `ORDERBOOK` `data`, S2 | `ORDERBOOK` sends `data.timestamp` in ms, not `timeStamp`, 9 to 11 ms before arrival at the median on the local clock. `INDEX` frames carry a top level `timestamp` such as `178995573831`, which is not Unix milliseconds |
| size unit | Not publicly specified | base currency, section 4 |
| sequence semantics | "`number` and `prevNumber` provide sequence tracking for consistency", S2 | every `UPDATE` carried `prevNumber` equal to the `number` of the frame before it on that symbol, with 0 gaps over 11,179 and 11,316 updates on 100 streams and over every book run |
| idle repeat behaviour | `DEPTH` "5s (if no changes)", S2 | a quiet `ORDERBOOK` sends an empty `UPDATE` about every 10 s with a new `number`. A quiet `DEPTH` resends the same book about every 10 s |

## 4. The book channel in detail

`ORDERBOOK` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first data frame of each stream is `"action": "SNAPSHOT"` with up to 100 bids and 100 asks, a `number`, and `prevNumber` 0.
It arrived 20 to 29 ms after the subscribe frame left on every stream of five book runs, and 20 to 46 ms on the two 100 stream batches.
No stream got a second snapshot unasked, and a duplicate subscribe was acknowledged again without one.

### Delta semantics

An `UPDATE` carries the levels that changed as `[price, size]` string pairs, and a size of `"0"` deletes the level, S2.
The first `BTC_USDT_PERP` update of the first run carried more than 25 bid levels, since the top of the book is requoted every frame.
A quiet book sends an `UPDATE` with empty `bids` and `asks` about every 10 s, which only advances the number: `AAX_USDT_PERP` sent 6 such frames per 60 s in every run and nothing else.
The frame also carries a top level `n`, empty on a snapshot and a numeric string such as `"100077977807526"` on an update, which is undocumented.

### Sequence and gap rule

```text
SNAPSHOT                          replace the book, last = number
UPDATE, prevNumber = last         apply, last = number
UPDATE, prevNumber ≠ last         gap: resubscribe the symbol, or terminate the socket (the engine's resync)
```

The rule held on every update of every run, with 0 gaps.
`number` is not a per symbol counter.
It rose by 13 to 58 per BTC frame, and the snapshots of `BTC_USDT_PERP` and `USDT_BTC_PERP` carried numbers 93 to 107 apart, so a counter shared across symbols is the likely reading, and only `prevNumber` chains one symbol.

### Stalls on busy books

A busy book can stop for about 10 s and then resume with one large update, with the `prevNumber` chain intact.

| run | stream | silence | the frame that ended it |
|---|---|---|---|
| book, 03:21 UTC | `ETH_USDT_PERP` | 10,039 ms | an update whose `number` rose by 1,431 |
| book, 03:38 UTC | `BTC_USDT_PERP` | 10,038 ms | an update whose `number` rose by 1,506, while `DEPTH` on BTC was silent for 10,046 ms |
| book, 03:41 UTC | `ETH_USDT_PERP` | 10,077 ms from 03:42:01.422 UTC | a non-empty update whose `number` rose by 1,478 |
| batch, 03:40 UTC | 16 of the 95 streams whose median frame gap was under 1 s | 5,665 to 10,085 ms, 14 of them between 9,951 and 10,085 ms | not recorded |

The other book runs had no silence over 350 ms on BTC or ETH.
Since the chain holds, the sequence check cannot see a stall, and the feed shows a book up to 10 s old as current.
Whether a resubscribe during a stall returns a fresher snapshot was not tested.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `ORDERBOOK` snapshot | best first, descending, on every stream | best first, ascending |
| `ORDERBOOK` update | descending on every update seen | ascending on every update seen |
| `DEPTH` | descending | ascending |
| REST `depth` | descending, 20, 100 and 1,000 levels | ascending |

The updates arrived sorted, but a feed still applies them by price.

### Level window

The documentation says "Order book always maintains 100 levels: when a level is consumed, the 101st level becomes the new 100th", S2.
The wire does not do that.
A `BTC_USDT_PERP` book built from the snapshot and every update fell to between 80 and 91 bids and between 82 and 93 asks within 60 s, over five runs.
In three runs a second socket subscribed at 40 s and received a snapshot at a `number` the first socket had reached by updates.
Every level of the built book was in that snapshot with the same size.
The snapshot also held 0 to 11 levels per side that the built book never received, and in the two runs that recorded their ranks they sat at ranks 74 to 100.
The ETH book stayed at 100 levels, and its built book equalled the second snapshot on all 100 levels per side in all three runs.
So the top of a built book is exact, and levels that slide into the window from beyond level 100 are not sent.
The engine holds 20 levels, so a built book of 80 levels still covers it, but a long trend can thin the far side of the window.

### Size unit against CCXT `contractSize`

The unit is the base currency, the same unit as the catalog `baseStep` and `minSizeLimit`, see [`rest.md`](./rest.md) section 2.

| contract | socket size | REST depth at the same price | unit |
|---|---|---|---|
| `BTC_USDT_PERP` | `"5.0050"` at 86,644.4 | `"5.005"` | BTC |
| `BTC_USDT_PERP` | `"14.5754"` at 86,697.1 | `"14.5754"` | BTC |
| `USDT_BTC_PERP`, REST only | | `"83970"` and `"85379"` at the best bid near 0.0000115 | USDT |

Among the top 20 socket bids of `BTC_USDT_PERP`, 18 prices were in the REST book read at the end of each run, and 0, 15, 16, 0 and 9 of those 18 had the same size in five runs.
Both books change every 200 ms, so a mismatch is a size that moved between the two reads.
The `DEPTH` 20 book and the `ORDERBOOK` book disagree in the same way: 888 to 1,152 of 1,620 to 1,940 `DEPTH` bid levels equalled the built book on arrival, 54 to 59 %, and matching by server timestamp did not raise it.
The second socket snapshot in the level window test is the exact check, and it matched on every shared level.
CCXT has no Pionex class, so there is no `contractSize` to compare against, and a stand-in catalog sets `contractSize` 1, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

`AAX_USDT_PERP` sent a snapshot with 0 bids and 50 asks in every run, and its `DEPTH` 20 frames carried `"bids": []` with 20 asks.
So a side with no orders arrives as an empty array.
The engine's `resetBook` accepts an empty side.

### Idle repeats

`ORDERBOOK` repeats no level.
A quiet book sends an empty `UPDATE` about every 10 s, 9,988 to 10,070 ms apart after the first one.
Over 100 streams the longest silence of a stream was 10,085 and 10,100 ms in the two batches.
`DEPTH` resends the whole top of book about every 10 s when nothing changes, and every 497 to 757 ms on BTC outside the stall above.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `ORDERBOOK` `NOPE_USDT_PERP` | `{"type":"ERROR","code":"INVALID_SYMBOL","message":"invalid \`symbol\`","timestamp":…}` | nothing |
| `ORDERBOOK` spot `BTC_USDT` | `SUBSCRIBED` | a snapshot and 72 updates in about 15 s, in both runs |
| `ORDERBOOK` with no `symbol` | `INVALID_SYMBOL` | |
| `ORDERBOOK` `"ETH_USDT_PERP,SOL_USDT_PERP"` | `INVALID_SYMBOL` | |
| `ORDERBOOK` with `symbol` as an array | `PARAMETER_ERROR` `bad json payload` | |
| `ORDERBOOK` `DOGE_USDT_PERP` twice | `SUBSCRIBED` twice | one snapshot, one stream |
| `DEPTH` `limit` 200 | `PARAMETER_ERROR` `invalid \`limit\`` | |
| `DEPTH` on `BTC_USDT` with no `limit` | `PARAMETER_ERROR` `invalid \`limit\``, although S2 documents a default of 5 | |
| topic `NOPE` | `INVALID_TOPIC` `invalid \`topic\`` | |
| `op` `subscribe` in lower case | `INVALID_OP` `invalid \`op\`` | |
| text that is not JSON | `PARAMETER_ERROR` `bad json payload` | the socket stays open |
| `UNSUBSCRIBE` `DOGE_USDT_PERP` | `UNSUBSCRIBED` | no further frame |
| `UNSUBSCRIBE` `NOPE_USDT_PERP` | `INVALID_SYMBOL` | |

A delisted contract was not available to probe, since all 606 perpetuals were `TRADING`.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server `PING` every 15 s, client `PONG`, "Missing 3 consecutive PONGs triggers disconnection", S5 | `{"op": "PING", "timestamp": 1790134746875}` every 15 s. Answering `{"op":"PONG","timestamp":<ms>}` kept a socket open for the full 75 s without a subscription, and for 60 s with one |
| silence the server tolerates | three missed `PONG`s, S5 | a socket that never answered closed at 60.095 to 60.101 s with code 1000 and reason `missed pong exceed max limit`, after `PING`s at about 15, 30 and 45 s, with and without a quiet subscription, in both runs |
| forced disconnect | Not publicly specified | none in 75 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | offered permessage-deflate, the server negotiated `permessage-deflate; server_no_context_takeover; client_no_context_takeover`. Not offered, the socket opened without it and every frame was uncompressed |
| frame type | Not publicly specified | every server frame is a binary WebSocket frame whose payload is UTF-8 JSON: 1,266 to 1,377 binary and 0 text frames per book run. The engine passes each payload through `toBuffer` to `handleMessage` either way, at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) lines 94 and 209 |
| handshake | | 100 to 201 ms to open from this host |
| subscription limits | 5 messages per second per connection, 10 connections per IP, S4 | 100 streams on one socket at 4 frames a second, 26 s to subscribe |
| throughput | | 100 USDT-M perpetuals, every fifth by 24 h quote volume, in two runs: 228 and 230 frames per second median, 200 to 248, 236 and 237 KB per second, 1,031 to 1,041 bytes per frame, 51 to 52 µs `JSON.parse` per frame |

## 6. Captured frames

Trimmed to three levels per side, from the second pass at 03:38 UTC, in the key order the server sent.

Subscribe and acknowledgement.

```json
{"op": "SUBSCRIBE", "topic": "ORDERBOOK", "symbol": "BTC_USDT_PERP"}
```

```json
{"type":"SUBSCRIBED","topic":"ORDERBOOK","symbol":"BTC_USDT_PERP"}
```

Snapshot.

```json
{"topic":"ORDERBOOK","symbol":"BTC_USDT_PERP","n":"","timestamp":1790134731904,"data":{"action":"SNAPSHOT","bids":[["86705.1","3.0114"],["86705.0","6.2106"],["86704.9","5.7264"]],"asks":[["86705.3","16.8476"],["86705.4","6.7147"],["86705.5","6.8440"]],"number":14426480863,"prevNumber":0,"timestamp":1790134731904}}
```

The update that followed it, whose `prevNumber` is the snapshot's `number`.

```json
{"topic":"ORDERBOOK","symbol":"BTC_USDT_PERP","n":"100077977807526","timestamp":1790134732069,"data":{"action":"UPDATE","bids":[["86705.1","2.9372"],["86705.0","5.7946"],["86704.9","3.3551"]],"asks":[["86705.2","16.8406"],["86705.3","5.1356"],["86705.4","6.0413"]],"number":14426480898,"prevNumber":14426480863,"timestamp":1790134732069}}
```

Depth.

```json
{"topic":"DEPTH","symbol":"BTC_USDT_PERP","data":{"bids":[["86705.1","4.2028"],["86705.0","6.4870"],["86704.9","6.1843"]],"asks":[["86705.2","9.2806"],["86705.3","5.7704"],["86705.4","4.0228"]]},"timestamp":1790134733438}
```

Index, with the top level timestamp that is not Unix milliseconds.

```json
{"topic":"INDEX","symbol":"BTC_USDT_PERP","data":[{"symbol":"BTC_USDT_PERP","indexPrice":"86755.22144","markPrice":"86713.51475","nextFundingRate":"0.0000394094","nextFundingTime":1790150400000,"updateTime":1790134733200}],"timestamp":178995573831}
```

Trade.

```json
{"topic":"TRADE","symbol":"BTC_USDT_PERP","data":[{"symbol":"BTC_USDT_PERP","tradeId":"200000001381311095","price":"86705.2","size":"0.0594","side":"BUY","timestamp":1790134734740}],"timestamp":1790134734821}
```

Keepalive, with the spaces the server sends.

```json
{"op": "PING", "timestamp": 1790134746875}
```

Errors, from the first errors run at 03:24 UTC.

```json
{"type":"ERROR","code":"INVALID_SYMBOL","message":"invalid `symbol`","timestamp":1790133870342}
```

```json
{"type":"ERROR","code":"PARAMETER_ERROR","message":"invalid `limit`","timestamp":1790133872145}
```

```json
{"type":"ERROR","code":"PARAMETER_ERROR","message":"bad json payload","timestamp":1790133880248}
```

## 7. Private channels

Named for a future execution stage, from S6, not probed.
They use `wss://ws.pionex.com/wsUA` and a signed login, S1.

- `ORDER`, `FILL`, `BALANCE`, `RISK` and `POSITION`.
- Futures account and trade calls are REST under `/uapi/v1/`, for example `GET /uapi/v1/trade/fundingFee` for funding records, S7.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://ws.pionex.com/wsPub`, for the USDT-M markets | one socket serves every family |
| channel | `ORDERBOOK` | snapshot on subscribe, a strict `prevNumber` chain, 100 levels covers the engine's 20, and a frame every 200 ms on busy books against 610 ms for `DEPTH` |
| markets per connection | 100, so the 560 USDT-M contracts other than `USD_USDT_PERP` need 6 sockets | 100 streams ran with 0 gaps at about 230 frames per second, the cap is 10 sockets per IP, and a larger slice is untested |
| subscribe frames | one frame per market, `{"op": "SUBSCRIBE", "topic": "ORDERBOOK", "symbol": "<rawMarketId>"}`, with `subscribeGapMs` 250 | one symbol per frame and 5 client frames per second per connection, S4. The engine's `subscribeGapMs` at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 27 paces them, and 100 markets take 25 s |
| keepalive | answer each server `PING` with `{"op": "PONG", "timestamp": <ms>}` from `handleMessage`, and send no client ping | the server closes after three missed pongs and ignores a client `PING`, so `startKeepalive` has nothing to do |
| `maxSilenceMs` | 35,000 | the server `PING` arrives every 15 s on every socket, so two missed pings is a dead socket, and a quiet book sends a frame every 10 s |
| routing | `msg.topic === 'ORDERBOOK'`, key `msg.symbol` as the `rawMarketId` | the symbol is the catalog id verbatim |
| snapshot | `data.action === 'SNAPSHOT'`: `resetBook` and store `data.number` | |
| delta | apply only when `data.prevNumber === last`, then store `data.number`, including for empty updates | 0 gaps observed |
| resync | `prevNumber !== last`, or an update before any snapshot: `resync` | the engine's existing path, and a new subscribe returns a fresh snapshot |
| stall | a design question: a book that ticks every 200 ms can go 10 s silent with the chain intact, section 4 | the socket silence watch cannot see it, since other streams keep the socket busy |
| window refresh | resubscribe a symbol whose built book falls below 20 levels on a side while its last snapshot showed more | the server does not refill levels beyond 100, section 4 |
| receive time | stamp on arrival, never from `timestamp` or `data.timestamp` | the `INDEX` top level timestamp is not Unix milliseconds, and receive time is the engine's rule anyway |
| sizes | `Number()` of the string, in base currency, `contractSize` 1 | section 4 |
| deflate | keep `perMessageDeflate: false` | the server negotiates it only when offered |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Futures WebSocket, Connection Endpoints | https://www.pionex.com/docs/api-docs/futures-websocket/general-info/connection-endpoints.md | 2026-09-22 | Pionex, global | URLs, sections 1 and 7 |
| S2 | Futures WebSocket, Public Stream | https://www.pionex.com/docs/api-docs/futures-websocket/public-stream.md | 2026-09-22 | Pionex, global | topics, schemas, update logic and the 100 level claim, sections 2 to 4 |
| S3 | Futures WebSocket, Subscribe / Unsubscribe | https://www.pionex.com/docs/api-docs/futures-websocket/general-info/subscribe-unsubscribe.md | 2026-09-22 | Pionex, global | frame and ack shapes, section 3 |
| S4 | Futures WebSocket, Limits | https://www.pionex.com/docs/api-docs/futures-websocket/general-info/limits.md | 2026-09-22 | Pionex, global | 5 messages per second and 10 connections, sections 3, 5 and 8 |
| S5 | Futures WebSocket, Heartbeat | https://www.pionex.com/docs/api-docs/futures-websocket/general-info/heartbeat.md | 2026-09-22 | Pionex, global | PING and PONG, sections 3 and 5 |
| S6 | Futures WebSocket, Private Stream | https://www.pionex.com/docs/api-docs/futures-websocket/private-stream.md | 2026-09-22 | Pionex, global | private topic names, section 7 |
| S7 | Futures API, Trade | https://www.pionex.com/docs/api-docs/futures-api/trade.md | 2026-09-22 | Pionex, global | `/uapi/v1/trade/` paths, section 7 |
| S8 | Trade WebSocket, Connection Endpoints | https://www.pionex.com/docs/api-docs/trade-websocket/general-info/connection-endpoints.md | 2026-09-22 | Pionex, global | the spot public URL, section 1 |
| P1 | `ws-probe.mjs book`, runs at 03:21, 03:22 and 03:25 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/pionex/ws-probe.mjs) | 2026-09-23 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs errors`, runs at 03:24 and 03:25 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/pionex/ws-probe.mjs) | 2026-09-23 | this host | sections 3, 4 and 6 |
| P3 | `ws-probe.mjs batch` at 03:26 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/pionex/ws-probe.mjs) | 2026-09-23 | this host | sections 3 to 5 |
| P4 | `ws-probe.mjs silence` at 03:27 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/pionex/ws-probe.mjs) | 2026-09-23 | this host | section 5 |
| P5 | `ws-probe.mjs deflate` at 03:29 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/pionex/ws-probe.mjs) | 2026-09-23 | this host | section 5 |
| P6 | second pass: `book` at 03:38 and 03:41, `batch` at 03:40, `errors` and `deflate` at 03:43, `silence` at 03:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/pionex/ws-probe.mjs) | 2026-09-23 | this host | every section, the second readings, the stall table and the captured frames |
