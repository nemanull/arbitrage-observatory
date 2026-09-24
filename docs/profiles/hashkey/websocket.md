# HashKey Global WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 03:06 to 03:43 UTC on 2026-09-23, the last run of each mode a second pass after the profiles were written, from the development host near Seattle.

This profile covers the public market data sockets of HashKey Global (CCXT id `hashkey`) for its two USDT-M perpetuals, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey/ws-probe.mjs), run from `server/`, and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The venue has two public socket versions, v1 and v2, on the same host, and both were probed.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| public v1, spot and perpetuals | `wss://stream-glb.hashkey.com/quote/ws/v1`, S1, and CCXT Pro at `server/node_modules/ccxt/js/src/pro/hashkey.js` line 29 | opened in 314 to 427 ms over 13 sockets |
| public v2, spot and perpetuals | `wss://stream-glb.hashkey.com/quote/ws/v2`, S2 | opened in 315 to 529 ms over 10 sockets |
| private | `wss://stream-glb.hashkey.com/api/v1/ws/{listenKey}`, S1 | not probed |
| sandbox | `wss://stream-glb.sim.hashkeydev.com/quote/ws/v1` and `/quote/ws/v2`, S1, S2 | not probed |

"Spot and Futures uses the same Websocket subscription", S1.
One socket of either version carried `BTCUSDT-PERPETUAL`, `ETHUSDT-PERPETUAL` and spot `BTCUSDT` together, P1.
`stream-glb.hashkey.com` is a CNAME to `stream-glb.hashkey.com.cdn.cloudflare.net` and then to `d2vp4npicopi76.cloudfront.net`, four addresses in `18.238.238.0/24`, by `dig` at 03:06 UTC.

## 2. Channel matrix for public market data

| topic | v1 | v2 | documented speed | probed on 2026-09-23 |
|---|---|---|---|---|
| `depth` | yes, S1 | yes, S2 | v1 300 ms, "up to limit of 200". v2 100 ms | the whole book in every frame on both, section 4 |
| `bbo` | `Invalid topic!` | yes, S2 | "Real-time push" | 22, 105 and 65 frames in three 65 s runs on `BTCUSDT-PERPETUAL`, carries `v` |
| `trade` | yes, S1 | acked `Success` | v1 300 ms | v1 sent the recent trades on subscribe, then each trade |
| `realtimes` | yes, S1 | yes, S2 | v1 500 ms | 24 h ticker, 4 to 10 frames per 65 s on `BTCUSDT-PERPETUAL`, no mark, index or funding field |
| `kline_$interval`, `kline` | yes, S1 | yes, S2 | v1 300 ms | not probed |
| `markPrice` | yes, not documented | yes, not documented | | one frame a second per perpetual, stamped on the whole second, see section 4 of [`rest.md`](./rest.md) |
| `index` | yes on the index name, `BTCUSDT` or `ETHUSDT`, not documented | `Invalid topic!` | | one frame about every 900 ms with the index, its 10 minute average `edp` and the basket `formula`, P5 |
| funding | `fundingRate` answers `Invalid topic!` | same | | no funding topic found |

`index` with the perpetual's own symbol answers `Invalid Symbols!` on v1, and the index names come from the REST index call, see [`rest.md`](./rest.md) section 3.
The undocumented `markPrice` and `index` topics were found by trying names from the REST paths, and they are not a contract the venue has published.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column quotes S1 for v1 and S2 for v2.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL per version, spot and perpetuals together | confirmed, section 1 |
| subscribe frame shape | v1 `{"symbol": "BTCUSDT", "topic": "depth", "event": "sub", "params": {"binary": false}, "id": 1}`. v2 `{"topic": "depth", "event": "sub", "params": {"symbol": "USDTUSDC"}}` | v1 took `"symbol": "BTCUSDT-PERPETUAL,ETHUSDT-PERPETUAL"` and delivered both books. v2 refused a comma list with `Parameter error!`, so v2 takes one symbol per frame |
| unknown symbol expectation | v2 example: `"code": "-100011", "msg": "Parameter error!"` | v1 `{"code":"-100010","desc":"Invalid Symbols!"}`. v2 `{"topic":"depth","event":"sub","params":{"symbol":"NOPEUSDT-PERPETUAL"},"code":"-100011","msg":"Parameter error!"}` |
| chunk unit and budget | Not publicly specified | not reached. Three books and four other subscriptions ran on one socket of each version |
| keepalive mechanism | client sends `{"ping": <ms>}` "every 10 seconds", the server answers `{"pong": <ms>}` with its own clock, S1, S2 | confirmed: `{"ping": 12345}` and `{"ping": "abc"}` were both answered with the server's current time. No server protocol ping on any public socket. Round trip 98 to 114 ms |
| connection lifetime and maintenance notice | Not publicly specified for the public stream. The private stream closes after 60 minutes without heartbeat, S1 | no forced close in 110 s. No maintenance frame seen |
| handshake and operation rate limits | Not publicly specified | no refusal for 7 subscribe frames sent at once on each socket, nor for about 25 requests at 900 ms spacing |
| public market data authentication | none | none |
| message parse and routing | v1 `{symbol, symbolName, topic, params, data: [...], f, sendTime, id}`. v2 `{topic, params: {symbol}, data: {...}}` | as documented. v1 echoes the subscribe `id` in every depth frame. v1 `markPrice` puts `data` in an array with `symbol` only in the first frame, then an object with `symbolId` and no `symbol` |
| subscribe acknowledgement shape | v2 `{..., "code": "0", "msg": "Success"}` | v2 as documented, also for a duplicate subscription and for the delisted `BTCUSD-PERPETUAL`. v1 sends no acknowledgement, the first data frame is the answer |
| symbol identifier format | the `exchangeInfo` symbol, `ETHUSDT-PERPETUAL` | `BTCUSDT-PERPETUAL`, identical to CCXT `market.id` and to the REST mark and funding `symbol`, see [`rest.md`](./rest.md) section 2 |
| number representation | price and quantity strings | strings on both versions, sizes are integer strings such as `"12"` |
| timestamp representation | `t` in ms | `t` in ms on the book. v1 adds `sendTime` in ms. `markPrice` and `index` carry a whole second |
| size unit | Not publicly specified | contracts of `contractMultiplier` 0.001 base, which is CCXT `contractSize`, section 4 |
| sequence semantics | `v`, "Message Version", as in `"55834575325_3"` | the part before `_` rose on every frame, with jumps, and never repeated. The part after `_` was `18` on every v1 frame and `1` or `2` on v2 perpetual frames. Every frame is a whole book, so no gap rule is needed |
| idle repeat behaviour | not documented | on the perpetuals 0 or 1 identical consecutive frames per run, and a quiet book sent nothing for up to 5.6 s. Spot `BTCUSDT` on v1 repeated an identical book in 90, 81 and 124 of about 216 frames |

## 4. The book channel in detail

v2 `depth` is the channel this profile recommends, and every row below covers both versions unless it says otherwise.

### Snapshot on subscribe

v1 sends a frame with `"f": true` about 100 to 105 ms after the subscribe, then every later frame has `"f": false`, in every run on every stream.
The `f: true` frame carries the book's last `t`, which was 281 ms before its `sendTime` on `BTCUSDT-PERPETUAL` and 2,537 ms on `ETHUSDT-PERPETUAL` in the 03:36 UTC capture, P6.
v2 sends no snapshot on subscribe.
Its first `depth` frame came 203 to 3,016 ms after the subscribe frame, which is the next change of the book.

### Every frame is the whole book

Every `depth` frame on both versions carries every level of the book, not a change.
At the 30 s mark of each book run the probe read the REST book and compared the socket's latest frame level by level.

| run | stream | socket levels bid and ask | REST levels | same price and same size |
|---|---|---|---|---|
| 03:16 UTC | v1 and v2 `BTCUSDT-PERPETUAL` | 49 and 41 | 49 and 41 | 49 and 41 on both versions |
| 03:16 UTC | v1 and v2 `ETHUSDT-PERPETUAL` | 80 and 83 | 80 and 83 | 80 and 83 on both versions, and the v1 frame had the REST reply's `t` |
| 03:23 UTC | v1 and v2 `BTCUSDT-PERPETUAL` | 52 and 35 | 52 and 35 | 52 and 35 on both versions |
| 03:23 UTC | v1 and v2 `ETHUSDT-PERPETUAL` | 72 and 75, 62 and 61 | 77 and 81 | 66 of 72 and 66 of 75 on v1, where the REST reply was 1.75 s older than the socket frame |
| 03:36 UTC | v1 and v2 `BTCUSDT-PERPETUAL` | 52 and 42 | 52 and 42 | 52 and 42 on both versions |
| 03:36 UTC | v1 and v2 `ETHUSDT-PERPETUAL` | 81 and 81 | 81 and 81 | 81 and 81 on both versions |

Levels per frame ranged from 25 to 55 bids and 12 to 45 asks on `BTCUSDT-PERPETUAL`, and 55 to 87 bids and 39 to 91 asks on `ETHUSDT-PERPETUAL`, P1.
The documented cap of 200 levels was never reached, because the books are that shallow, so whether a deeper book is truncated at 200 is Not verified.
A `limit` of 5 in `params` changed nothing on either version, 76 to 85 levels arrived, P2.

### Cadence and delay

| stream | frames in 65 s | shortest gap | median gap | p90 gap | longest gap | arrival minus `t`, median |
|---|---|---|---|---|---|---|
| v1 `BTCUSDT-PERPETUAL` | 45, 92, 70 | 85 to 298 ms | 301 to 600 ms | 1,501 to 4,533 ms | 4,801 to 5,583 ms | 192 to 199 ms |
| v1 `ETHUSDT-PERPETUAL` | 45, 98, 90 | 84 to 292 ms | 300 to 301 ms | 1,800 to 5,100 ms | 5,083 to 5,403 ms | 189 to 212 ms |
| v2 `BTCUSDT-PERPETUAL` | 82, 188, 123 | 54 to 92 ms | 101 ms | 1,200 to 2,904 ms | 5,107 to 5,480 ms | 54 to 58 ms |
| v2 `ETHUSDT-PERPETUAL` | 84, 208, 183 | 53 to 91 ms | 101 ms | 802 to 3,202 ms | 5,007 to 5,108 ms | 53 to 57 ms |

Ranges span the three book runs at 03:16, 03:23 and 03:36 UTC, P1.
v1 conflates to about 300 ms, although single gaps as short as 84 ms occurred.
Its `sendTime` trailed `t` by a median of 133 to 159 ms, so a v1 book reaches this host about 130 to 160 ms later than the same book on v2.
The pong round trip was 98 to 114 ms and the server clock sat within 5 ms of this host, so the arrival delay is mostly network.

### Sequence and gap rule

```text
every frame           resetBook(bids, asks)
v not newer than last  drop the frame (never observed)
```

The part of `v` before `_` increased on every frame of every stream, with 0 frames out of order in all three runs, P1.
It skips values, because a frame is a sample of the book and not a change.
No checksum is documented or sent.

### Level order on the wire

Bids best first, descending, and asks best first, ascending, in every frame of every run, with 0 misordered frames and 0 crossed frames, P1.
The REST book has the same order, see [`rest.md`](./rest.md) section 5.

### Size unit against CCXT `contractSize`

| contract | CCXT `contractSize` | socket size at the touch | REST size at the same price | what one unit is |
|---|---:|---|---|---|
| `BTCUSDT-PERPETUAL` | 0.001 | `"12"` at 86,454.6 | `"12"` | 0.001 BTC, so 0.012 BTC |
| `ETHUSDT-PERPETUAL` | 0.001 | `"362"` at 2,770.63 | `"362"` | 0.001 ETH, so 0.362 ETH |

Socket sizes equal REST sizes level for level, section 4 above, and REST sizes are contracts.
The 24 h ticker shows the unit: `BTCUSDT-PERPETUAL` reported `v` 16,266 and `qv` 1,399,213.18 USDT, which is 86.02 USDT a unit at a price near 86,400, so a unit is 0.001 BTC, see [`rest.md`](./rest.md) section 2.
`contractMultiplier` is 0.001 on both contracts and CCXT copies it into `contractSize`, so the engine's `sizeMul` converts HashKey sizes correctly.

### One-sided and empty books

The delisted `BTCUSD-PERPETUAL` on v1 sent one `f: true` frame with `"b": []` and `"a": []` and a current `t`, and nothing after it, P2.
v2 acknowledged the same symbol with `Success` and sent nothing.
No one-sided book was seen on the two live perpetuals.

### Unknown, closed and wrong requests

| request | v1 reply | v2 reply |
|---|---|---|
| `depth` on `NOPEUSDT-PERPETUAL` | `{"code":"-100010","desc":"Invalid Symbols!"}` | `{"topic":"depth","event":"sub","params":{"symbol":"NOPEUSDT-PERPETUAL"},"code":"-100011","msg":"Parameter error!"}` |
| `depth` with no symbol | `Invalid Symbols!` | `Parameter error!` |
| two symbols in one frame | both books delivered | `Parameter error!` |
| unknown topic `nope` | `{"code":"-10004","desc":"Invalid topic!"}` | same |
| text that is not JSON | `{"code":"-10001","desc":"Invalid JSON!"}` | same |
| `depth` subscribed twice | no reply, one stream | `Success` twice, one stream |
| `depth` on delisted `BTCUSD-PERPETUAL` | one empty snapshot | `Success`, then nothing |
| `cancel` of `depth` | no reply, and 0 frames in the next 4 s | `{"topic":"depth","event":"cancel",...,"code":"0","msg":"Success"}`, and 0 frames in the next 4 s |

Every error left the socket open.
A v1 error frame carries no topic or symbol, so a v1 feed cannot tell which request failed except by order.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | `{"ping": <ms>}` every 10 s, answered by `{"pong": <server ms>}` | pong round trip median 99 to 100 ms on v1 and 103 to 108 ms on v2, pong minus the local midpoint 0 to 5 ms, P1 |
| silence the server tolerates | Not publicly specified | v2 closed a subscribed socket that never pinged after 31.2 s and 30.9 s in two runs, with 1006, while it was still delivering `depth` frames. v1 closed an unsubscribed socket that never pinged after 60.3 s in both runs, with 1006. A subscribed v1 socket that never pinged stayed open for the full 110 s in both runs, P3 |
| server pings | none on the public stream. The private stream pings every 30 s | 0 protocol pings and 0 application pings on the 20 public sockets that logged them |
| forced disconnect | Not publicly specified | none apart from the silence closes |
| maintenance notice | Not publicly specified | none |
| compression | "Currently only support JSON format", v1 offers `"binary": true` for a zipped frame | a client that offered permessage-deflate got no `sec-websocket-extensions` header on v1 or v2, and text frames, P4 |
| handshake | | 314 to 529 ms to open from this host |
| subscription limits | Not publicly specified | none reached |

## 6. Captured frames

Trimmed to three levels per side, from the probe runs of 2026-09-23.
The book frames are from the 03:36 UTC capture, P6.

v1 subscribe, and the snapshot that answers it.

```json
{"symbol": "BTCUSDT-PERPETUAL", "topic": "depth", "event": "sub", "params": {"binary": false}, "id": "BTCUSDT-PERPETUAL"}
```

```json
{"symbol":"BTCUSDT-PERPETUAL","symbolName":"BTCUSDT-PERPETUAL","topic":"depth","params":{"realtimeInterval":"24h","binary":"false"},"data":[{"e":301,"s":"BTCUSDT-PERPETUAL","t":1790134581222,"v":"14088479_18","b":[["86637.3","6"],["86636.6","12"],["86635.4","14"]],"a":[["86640.4","12"],["86645.8","12"],["86659.3","4"]],"o":0}],"f":true,"sendTime":1790134581503,"channelId":"da7ff7fffe24d0ba-00000001-000f4f5d-096cd67e4ec9fe34-45de5ba7","shared":false,"id":"BTCUSDT-PERPETUAL"}
```

The next v1 frame, again the whole book.

```json
{"symbol":"BTCUSDT-PERPETUAL","symbolName":"BTCUSDT-PERPETUAL","topic":"depth","params":{"realtimeInterval":"24h","binary":"false"},"data":[{"e":301,"s":"BTCUSDT-PERPETUAL","t":1790134581473,"v":"14088507_18","b":[["86645.7","155"],["86637.3","6"],["86635.4","14"]],"a":[["86645.8","12"],["86659.3","4"],["86678.6","142"]],"o":0}],"f":false,"sendTime":1790134581572,"channelId":"da7ff7fffe24d0ba-00000001-000f4f5d-096cd67e4ec9fe34-45de5ba7","shared":false,"id":"BTCUSDT-PERPETUAL"}
```

v2 subscribe, acknowledgement and a book frame.

```json
{"topic": "depth", "event": "sub", "params": {"symbol": "BTCUSDT-PERPETUAL"}}
```

```json
{"topic":"depth","event":"sub","params":{"symbol":"BTCUSDT-PERPETUAL"},"code":"0","msg":"Success"}
```

```json
{"topic":"depth","params":{"symbol":"BTCUSDT-PERPETUAL"},"data":{"s":"BTCUSDT-PERPETUAL","t":1790134581603,"v":"14088520_1","b":[["86645.7","155"],["86637.3","6"],["86635.4","14"]],"a":[["86645.8","12"],["86659.3","4"],["86678.6","142"]]}}
```

v2 best bid and ask.

```json
{"topic":"bbo","params":{"symbol":"BTCUSDT-PERPETUAL"},"data":{"s":"BTCUSDT-PERPETUAL","b":"86645.7","bz":"310","a":"86645.8","az":"11","t":1790133813033,"v":"14081098_18"}}
```

Keepalive, whose answer is the server's clock whatever the ping carries.

```text
{"ping": <any number or string>}
```

```json
{"pong":1790134591507}
```

Errors.

```json
{"code":"-100010","desc":"Invalid Symbols!"}
```

```json
{"topic":"depth","event":"sub","params":{"symbol":"BTCUSDT-PERPETUAL,ETHUSDT-PERPETUAL"},"code":"-100011","msg":"Parameter error!"}
```

```json
{"code":"-10004","desc":"Invalid topic!"}
```

Mark price on v2, and on v1 after its first frame.

```json
{"topic":"markPrice","params":{"symbol":"BTCUSDT-PERPETUAL"},"data":{"s":"BTCUSDT-PERPETUAL","p":"86651.838","t":1790133812000}}
```

```json
{"topic":"markPrice","params":{"realtimeInterval":"24h","binary":"false"},"data":{"exchangeId":301,"symbolId":"BTCUSDT-PERPETUAL","price":"86651.838","time":1790133812000},"f":false,"sendTime":1790133812009,"shared":false}
```

Index on v1, with its basket.

```json
{"symbol":"BTCUSDT","symbolName":"BTCUSDT","topic":"index","params":{"realtimeInterval":"24h","binary":"false"},"data":[{"symbol":"BTCUSDT","index":"86665.21","edp":"86557.817066","formula":"(86672.9[KRAKEN]*0.2+86669.24[BINANCE]*0.2+86671.2[BYBIT]*0.2+86638.31[COINBASE]*0.2+86674.4[OKEX]*0.2)","time":1790133770000}],"f":true,"sendTime":1790133771110,"channelId":"9a5a98fffebeca64-00000001-000f3b97-ec6709a7ed5593fd-cce46745","shared":false,"id":"index-BTCUSDT"}
```

## 7. Private channels

Named for a future execution stage, from S1 and CCXT Pro, not probed.

- The private stream is `wss://stream-glb.hashkey.com/api/v1/ws/{listenKey}`, with a listen key from `POST /api/v1/userDataStream` that lives 60 minutes and is extended by a `PUT`, S1.
- Its events are `outboundAccountInfo`, `outboundContractAccountInfo`, `executionReport`, `contractExecutionReport`, `ticketInfo` and `outboundContractPositionInfo`, as CCXT Pro routes them at `server/node_modules/ccxt/js/src/pro/hashkey.js` lines 852 to 861.
- The server pings a private socket every 30 s and closes it after 60 minutes without heartbeat, S1.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://stream-glb.hashkey.com/quote/ws/v2` | both perpetuals fit one socket, and v2 delivers about 130 to 160 ms sooner than v1 at a third of the conflation |
| markets per connection | all, which is 2 today | no cap is published, and nine topics ran on one socket without a refusal |
| subscribe frames | one frame per market, `{"topic": "depth", "event": "sub", "params": {"symbol": "<rawMarketId>"}}` | v2 refuses a comma list |
| keepalive | `{"ping": Date.now()}` every 10 s | v2 closes a socket after about 31 s without a client frame, even while it streams, and the documentation asks for 10 s |
| `maxSilenceMs` | 25,000 | a quiet book sent nothing for up to 5.6 s, and the pong every 10 s counts as traffic, so 25 s is two missed pongs |
| routing | `data.s` is the `rawMarketId`, and `params.symbol` carries the same | the socket spells the id exactly as CCXT does |
| every `depth` frame | `resetBook(contract, bids, asks)` | every frame is the whole book |
| version check | keep the part of `v` before `_` per contract and drop a frame that is not newer | cheap, and never triggered in the probes |
| resync | not needed for gaps. Terminate and resubscribe only on a close or a silence timeout | there are no deltas to lose |
| first frame | log a stream with no frame 10 s after its `Success` | v2 sends the first book on the next change, up to about 3 s later on these books, and an acknowledged delisted symbol never sends |
| control frames | log any frame with `code` other than `"0"`, and v2 `Success` acknowledgements at debug level | v1 errors carry no symbol |
| receive time | stamp on arrival | the v1 snapshot on subscribe carries the book's older `t` |
| sizes | `Number()` of the string, in contracts of 0.001 base | matches CCXT `contractSize` |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |

v1 is the fallback.
It sends a snapshot within about 100 ms of the subscribe, takes a comma list of symbols and kept a subscribed socket without pings open for 110 s, at a 300 ms cadence and about 130 to 160 ms more delay.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | HashKey Global API, Websocket API (v1 public and private streams) | https://hashkeyglobal-apidoc.readme.io/reference/websocket-api | 2026-09-23 | HashKey Global | v1 URL, subscribe shape, 300 ms depth, heartbeat, private stream, sections 1 to 7 |
| S2 | HashKey Global API, Public Stream (WS v2), WS v2 Depth and WS v2 BBO | https://hashkeyglobal-apidoc.readme.io/reference/public-stream, https://hashkeyglobal-apidoc.readme.io/reference/ws-v2-depth and https://hashkeyglobal-apidoc.readme.io/reference/ws-v2-bbo | 2026-09-23 | HashKey Global | v2 URL, subscribe and acknowledgement shape, 100 ms depth, bbo, sections 1 to 3 |
| S3 | CCXT Pro 4.5.68 `hashkey.js` | `server/node_modules/ccxt/js/src/pro/hashkey.js` | 2026-09-23 | CCXT | v1 URL at line 29, keepAlive 10,000 at line 49, every depth frame reset as a snapshot at line 359, private events at lines 852 to 861 |
| P1 | `ws-probe.mjs book`, runs at 03:16 and 03:23 UTC, and the second pass at 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey/ws-probe.mjs) | 2026-09-23 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs errors`, runs at 03:15 and 03:21 UTC, and the second pass at 03:37 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey/ws-probe.mjs) | 2026-09-23 | this host | sections 2 to 4 |
| P3 | `ws-probe.mjs silence` at 03:19 UTC, and the second pass at 03:38 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey/ws-probe.mjs) | 2026-09-23 | this host | section 5 |
| P4 | `ws-probe.mjs deflate` at 03:19 UTC, and the second pass at 03:40 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey/ws-probe.mjs) | 2026-09-23 | this host | section 5 |
| P5 | `ws-probe.mjs anchor` at 03:22 UTC, and the second pass at 03:40 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey/ws-probe.mjs) | 2026-09-23 | this host | `index` and `markPrice` topics, sections 2 and 6 |
| P6 | the capture of the 03:36 UTC `ws-probe.mjs book` run, kept outside the repository | [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey/ws-probe.mjs) | 2026-09-23 | this host | the v1 snapshot frame, sections 4 and 6 |
