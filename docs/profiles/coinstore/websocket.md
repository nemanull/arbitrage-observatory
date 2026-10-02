# Coinstore WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, evening in Seattle (2026-09-23 02:42 to 03:13 UTC), from the development host near Seattle.

This profile covers the public market socket of the Coinstore USDT-margined perpetuals, the only perpetual family, with the book stream in detail.
Coinstore deleted its perpetual API documentation on 2026-06-12, S1, so no documented perpetual socket exists.
The socket below is the one the futures web app at `futures.coinstore.com` opens, found in its bundle, S2, and every claim about it was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/coinstore/ws-probe.mjs).
The "documented" column therefore quotes the deleted documentation where it applies, labelled S3, and otherwise reads Not publicly specified.
The spot socket `wss://ws.coinstore.com/s/ws` is documented, S4, and is named here only.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| USDT-M perpetuals, market data | `wss://ws-futures.coinstore.com/v1/market`, from the web app bundle, S2 | open in 229 to 362 ms over 18 sockets in two runs, and all 58 perpetuals delivered in the first batch run |
| USDT-M perpetuals, private | `wss://ws-futures.coinstore.com/notification/v3`, S2 | not probed |
| legacy perpetuals, deleted documentation | `wss://ws-futures.coinstore.com/socket.io/?EIO=3&transport=websocket`, S3 | HTTP 404 from nginx in both runs, the socket is gone |
| spot | `wss://ws.coinstore.com/s/ws`, S4 | not probed |

One market socket carries every perpetual and every stream, because there is one family.
`ws-futures.coinstore.com` resolves to the Cloudflare addresses 104.18.18.83 and 104.18.19.83, and the upgrade reply came through the `SEA` edge, see [`rest.md`](./rest.md) section 1.
The upgrade sets an HttpOnly cookie `sid` on the path `/v1/market`, and the probe never sent it back, with no effect on delivery.

## 2. Channel matrix for public market data

| stream | subscribe entry | payload type | cadence probed |
|---|---|---|---|
| `depth` | `{"tradeType": "linearPerpetual", "symbol": "BTCUSDT", "stream": "depth"}` | `WsDepthDTO`, every price aggregation (`gear`) of the symbol in separate frames | one push per symbol, a median of about 1 s on `BTCUSDT` and `ETHUSDT` and 3 to 6 s on 32 of 58 symbols, section 4 |
| `index` | same shape, `"stream": "index"` | `WsIndexPriceDTO`: `indexPrice`, `markPrice`, `tradePrice`, `scale`, `fundingRate`, `lastFundingRate`, `nextFundRateTime` | 60 frames per symbol in 60 s on every one of the 58 perpetuals, in three runs |
| `trade` | same shape, `"stream": "trade"` | `WsTradeDTO`: `id`, `side`, `price`, `qty`, `time` | on trade, 8 and 13 frames on `BTCUSDT` in the two errors runs |
| `ticker24hr` | same shape, `"stream": "ticker24hr"` | `WsTicker24hrDTO` | about one frame per second, 8 and 10 frames on `BTCUSDT` in the two errors runs |
| `miniTicker` | `{"tradeType": "linearPerpetual", "stream": "miniTicker"}`, no symbol | `WsMiniTickerDTO` for the whole market, symbol inside | 6 and 8 frames in the two errors runs |
| `kline<interval>` | built as `` `kline${interval}` `` in the web app, S2 | `WsKlineDTO` | not probed |

No best bid and ask stream exists.
The `index` stream is the only source of the index, the mark and the upcoming funding rate, and no REST call returns them, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified | one market URL for all 58 perpetuals and all streams, one private URL, S2 |
| subscribe frame shape | Not publicly specified. The web app sends `{"event": "subscribe", "data": [{tradeType, symbol, stream}]}`, S2 | one frame with 4 entries, and one with 58, each got one ack listing every entry |
| unknown symbol expectation | Not publicly specified | the ack marks the entry `"message":"fail"`, and so does `MATICUSDT`, a legacy contract only. An unknown `tradeType`, an unknown `event` or text that is not JSON answers `{"event":"","code":"1000012","message":"Invalid request"}`, and the socket stays open |
| chunk unit and budget | Not publicly specified | 58 perpetuals in one frame, 157 and 154 gear streams in two runs, 0 gaps over 45 s each. In the rerun one of the 58 sent nothing in 45 s |
| keepalive mechanism | Not publicly specified. The web app sends the text `PING` every 10 s, S2 | `PING` is answered `PONG` as a text frame. In each of two runs the server sent 1 protocol ping in 110 s to the subscribed socket and none to the other two |
| connection lifetime and maintenance notice | Not publicly specified | a socket with no subscription and no client frame closed at 30.3 and 30.26 s with code 1000. No lifetime cap reached in 110 s, and no notice seen |
| handshake and operation rate limits | Not publicly specified | no refusal at four sockets open at once and 58 entries in one subscribe |
| public market data authentication | none | none, the private socket takes `{"event": "authorization"}`, S2 |
| message parse and routing | Not publicly specified | text frames are JSON acks and `PONG`. Data frames are binary protobuf `BaseWsDTO` `{tradeType, symbol, stream, data: [google.protobuf.Any], ts}`, routed on `symbol` and `stream`, and a depth item on its `gear` |
| subscribe acknowledgement shape | Not publicly specified | `{"event":"subscribe","data":[{"tradeType":…,"symbol":…,"stream":…,"message":"success"}],"ts":<ms>}`, one entry per requested stream |
| symbol identifier format | `BTCUSDT` in the web app, S2 | identical to the instrument `symbol` and the funding history on 58 of 58, and to the REST depth on the 4 probed. A lowercase `btcusdt` was acked and delivered as `BTCUSDT` |
| number representation | protobuf schema: prices and sizes `string`, ids and times `uint64`, S2 | as the schema says. REST ids are JSON numbers and trade ids exceed 2^53 |
| timestamp representation | `BaseWsDTO.ts` `uint64`, S2 | `ts` in ms. Index frames carry `ts` on whole seconds and an undeclared field 4 holding the computation time in ms, such as `1790132394031` |
| size unit | Not publicly specified | base coin, not contracts: 17,728 of 17,728 and 17,241 of 17,241 sizes in two runs were whole multiples of `ctVal`, and 16,503 and 15,951 were fractional, section 4 |
| sequence semantics | Not publicly specified. The web app compares each frame's `previousDepthId` with the last `lastDepthId`, S2 | `previousDepthId` equals the last `lastDepthId` plus one, per symbol and shared by every gear, with 0 gaps. A REST book read before the subscription chained onto the first frame on 17 of 17 streams in one run and 4 of 17 in the other, and a REST book read after the first frame bridged on 4 of 4 symbols, section 4 |
| idle repeat behaviour | Not publicly specified | no empty or repeated frame. A quieter symbol simply pushes less often, most of them every 3 to 6 s |

## 4. The book stream in detail

### Snapshot on subscribe

There is none.
In the first run the first `BNBUSDT` frame at gear `0.01` held 72 bids and 67 asks with 36 zero sizes, and the first `BTCUSDT` frame at gear `0.01` held 99 and 99 with 78 zero sizes, which is a delta.
The web app reads `GET /api/v1/market/depthAll` first, subscribes, and reads REST again whenever the first frame does not chain onto it, S2.

The probe's `book` mode copied that order, and the outcome depended on timing.
In the first run the first frame's `previousDepthId` was the REST `lastDepthId` plus one on all 17 streams of four symbols, for example REST `5666666023` and first `previousDepthId` `5666666024` on `BTCUSDT`.
In the second run it chained only on `BNBUSDT`, and the first frames of `BTCUSDT`, `ETHUSDT` and `XRPUSDT` began 200, 228 and 13 ids after the REST book, because a push landed between the REST read and the subscription.
Deltas applied across that hole left `ETHUSDT` crossed after 60 s, best ask 2,757.91 under best bid 2,758.19, and left `BTCUSDT` with 346 bids where REST held 308.

The `recipe` mode subscribes first, reads REST after the first frame arrives, drops frames whose `lastDepthId` is not above the REST id, and requires the next frame to start at the REST id plus one.
On 4 of 4 symbols the REST read already contained the first frame, the second frame started at exactly the REST id plus one, and after 30 s every kept book equalled REST in level count and in its top 20 levels on both sides.
So a feed needs one REST book per symbol after every subscribe, read after the first frame.

### Delta semantics

A frame carries `gear`, `bids` and `asks` as arrays of `[price, size]` string pairs, `previousDepthId` and `lastDepthId`.
A size of `"0"` deletes the level, and 6,118 and 5,382 deletes arrived on `BTCUSDT` gear `0.01` in the two 60 s runs.
One push is a batch that nets many book events: `BTCUSDT` ids advanced by 200 per push in the first run and 732 in the second, see [`rest.md`](./rest.md) section 5.
Every gear of one symbol arrives in its own frame with the same two ids.
A feed that keeps only the finest gear, which equals the instrument `tickSize`, drops the other frames.

### Sequence and gap rule

```text
subscribe, wait for the first frame, read the REST book at the finest gear, restId = its lastDepthId
frame with lastDepthId <= restId:          drop
first frame applied:                       previousDepthId = restId + 1, apply, last = lastDepthId
next frame of the same gear:               previousDepthId = last + 1, apply, last = lastDepthId
otherwise:                                 gap, read the REST book again
```

Between frames the rule held on every frame, 0 gaps on 17 streams in each 60 s run, and 0 gaps on 157 and 154 streams in the two 45 s batch runs.

### Checksum

None exists in the schema, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| socket delta | descending on every frame of 17 streams, in both runs | ascending on every frame, in both runs |
| REST `depthAll` and `depth` | descending, every gear of four symbols | ascending |

### Level window

The stream keeps the whole book, not a fixed window.
A `BTCUSDT` book kept at gear `0.01` held 308 bids and 174 asks after 60 s in the first run, and 310 and 153 after 30 s in the `recipe` run, each exactly the level count of a fresh REST read at the same `lastDepthId`.
Its top 20 levels matched REST on price and size on both sides, and so did `ETHUSDT`, `XRPUSDT` and `BNBUSDT`, in both of those runs.
The engine's 20 levels per side are therefore always available.

### Size unit against CCXT `contractSize`

CCXT has no Coinstore class, so there is no `contractSize` to compare.
The instrument list gives `ctVal`, the coin amount of one contract, and the book sizes are coin amounts, not contracts.

| symbol | `ctVal` | socket size at the touch | coins |
|---|---:|---|---|
| `BTCUSDT` | 0.001 | `"3.811"` | 3.811 BTC, 3,811 contracts |
| `ETHUSDT` | 0.01 | `"50.14"` | 50.14 ETH, 5,014 contracts |
| `XRPUSDT` | 10 | `"3320"` | 3,320 XRP, 332 contracts |
| `BNBUSDT` | 0.1 | `"9.8"` | 9.8 BNB, 98 contracts |

Every nonzero size on the four books was a whole multiple of `ctVal`, 17,728 of 17,728 and 17,241 of 17,241 in two runs, and REST trades showed the same unit, for example `"qty":"0.012"` on `BTCUSDT`.
A catalog that set the engine's `contractSize` to `ctVal` would scale Coinstore books down by up to a thousand, so the right `contractSize` is 1.

### One-sided and empty books

None was seen.
What the stream sends for a side with no orders is Not verified.

### Idle repeats

Nothing repeats.
`BTCUSDT` and `ETHUSDT` pushed at a median of 1,018 to 1,021 ms in both runs.
`BNBUSDT` pushed at a median of 5,091 and 4,075 ms although its id advanced by about 270 between pushes, so the cadence is set by the venue, not by activity alone.
`XRPUSDT` alternated, a median of 1,035 and 1,024 ms and a 90th percentile of 5,086 and 3,055 ms.
Across all 58 symbols in the batch rerun, 11 pushed at a median of about 1 s, 14 at 1.5 to 3 s and 32 at 3 to 6 s, and one sent nothing in 45 s.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `depth` on `NOPEUSDT` | ack with `"message":"fail"` | nothing |
| `nope` stream on `BTCUSDT` | ack with `"message":"fail"` | nothing |
| `tradeType` `nope` | `{"event":"","code":"1000012","message":"Invalid request"}` | socket stays open |
| `ticker24hr` on `BTCUSDT` twice | both acked `success` | one stream |
| `miniTicker` with no symbol | acked `success` | whole-market frames |
| text `hello{` | `code` `1000012` `Invalid request` | socket stays open |
| `depth` on `QNTXUSDT`, which has a book and a fee row but no instrument row | acked `success` | 3 frames in about 6 s |
| `depth` on `MATICUSDT`, a legacy contract only | ack with `"message":"fail"` | nothing |

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified. The web app sends `PING` every 10 s, S2 | `PONG` came back to every `PING`, at 10.5, 20.5 and 30.5 s in one run and 10.4, 20.4 and 30.4 s in the other. One protocol ping from the server in 110 s on a subscribed socket, in each run |
| silence the server tolerates | Not publicly specified | no subscription and no client frame: closed at 30.3 and 30.26 s with code 1000. `PING` every 10 s and no subscription: open at 110 s. A subscription on `BNBUSDT` and no client frame: open at 110 s. Same outcome in both runs |
| forced disconnect | Not publicly specified | none in 110 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | a client offering permessage-deflate got no `sec-websocket-extensions` header back. Data frames are binary protobuf, which is not compression but needs a decoder |
| handshake | | 229 to 362 ms to open |
| subscription limits | Not publicly specified | 58 perpetuals in one frame on one socket, no cap reached |
| throughput | | all 58 perpetuals on one socket: 62.6 and 59.6 frames per second, peak 92 and 81, 44 and 43 KB per second, 705 and 725 bytes per frame, and 79.6 and 44.4 µs per frame for the probe's plain JavaScript protobuf decoder |
| delivery lag | | `ts` to arrival: median 74 and 57 ms, minimum 56 and 53 ms, maximum 231 and 168 ms, with the server clock measured 2 to 5 ms ahead, see [`rest.md`](./rest.md) section 7 |

## 6. Captured frames

Trimmed, from the probe runs.
Binary frames are shown decoded by the probe, with ids as strings, and arrays marked `…` are cut.

Subscribe, two of the four entries of one frame kept.

```json
{"event": "subscribe", "data": [{"tradeType": "linearPerpetual", "symbol": "BTCUSDT", "stream": "depth"}, {"tradeType": "linearPerpetual", "symbol": "ETHUSDT", "stream": "depth"}]}
```

Acknowledgement.

```json
{"event":"subscribe","data":[{"tradeType":"linearPerpetual","symbol":"BTCUSDT","stream":"ticker24hr","message":"success"}],"ts":1790131827255}
```

Depth delta at the finest gear, decoded, first four levels per side kept.
The bids are deletes and the asks moved down, so this push is a price move.

```json
{"tradeType":"linearPerpetual","symbol":"ETHUSDT","stream":"depth","ts":"1790132923145","items":[{"type":"WsDepthDTO","gear":"0.01","bids":[["2758.52","0"],["2757.74","0"],["2757.72","0"],["2757.71","0"]],"asks":[["2757.41","3.62"],["2757.44","3.62"],["2757.48","3.62"],["2757.49","3.62"]],"previousDepthId":"5993539729","lastDepthId":"5993540039"}]}
```

A `BTCUSDT` frame at gear `10`, one of five gears that each arrive in their own frame carrying the same two ids.

```json
{"tradeType":"linearPerpetual","symbol":"BTCUSDT","stream":"depth","ts":"1790131844896","items":[{"type":"WsDepthDTO","gear":"10","bids":[["86410","129.743"],["86400","4.576"],["86380","3.019"],["86360","4.24"]],"asks":[["86420","125.476"],["86430","8.137"],["86450","1.476"],["86470","1.34"]],"previousDepthId":"5666666024","lastDepthId":"5666666223"}]}
```

Index frame, decoded, with the undeclared field 4 under `_unknown`, 968 ms before `ts`.

```json
{"tradeType":"linearPerpetual","symbol":"AAVEUSDT","stream":"index","ts":"1790132840000","items":[{"type":"WsIndexPriceDTO","indexPrice":"148.3995","markPrice":"148.39","tradePrice":"148.4","_unknown":{"4":"1790132839032"},"scale":"2","fundingRate":"-0.00005","lastFundingRate":"-0.00005","nextFundRateTime":"1790150400000"}]}
```

Keepalive, both text frames.

```text
PING
PONG
```

Errors.

```json
{"event":"subscribe","data":[{"tradeType":"linearPerpetual","symbol":"NOPEUSDT","stream":"depth","message":"fail"}],"ts":1790131822448}
```

```json
{"event":"","code":"1000012","message":"Invalid request"}
```

## 7. Private channels

Named for a future execution stage from the web app bundle, S2, not probed.
They use `wss://ws-futures.coinstore.com/notification/v3`, an `{"event": "authorization"}` frame, and protobuf payloads `WsWebAccountRespProto`, `WsWebPositionRespProto`, `WsWebOrderRespProto`, `WsWebTriggerOrderRespProto`, `WsWebLeverageRespProto` and `WsWebIndexAccountDTORespProto`.
Order entry in the web app goes over REST under `/api/v1/trade/web/`, not over the socket.

## 8. Recommended feed shape

A recommendation for a later design, not a decision, and only if the venue is ever wired despite the verdict in [`rest.md`](./rest.md) section 8.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://ws-futures.coinstore.com/v1/market` | one family |
| markets per connection | 58, all of them | 58 ran on one socket with 0 gaps at 62.6 and 59.6 frames per second in two runs |
| subscribe frames | one frame, `{"event": "subscribe", "data": [{"tradeType": "linearPerpetual", "symbol": "<rawMarketId>", "stream": "depth"}, …]}` | acked as one |
| snapshot | after the first frame of a symbol, `GET https://futures.coinstore.com/api/v1/market/depth?tradeType=linearPerpetual&symbol=<id>&gear=<tickSize>`, `resetBook`, store `lastDepthId`, buffering frames meanwhile | no snapshot on the socket, and a REST read before the subscription missed a push on 3 of 4 symbols in one run |
| delta | keep only `gear` equal to `tickSize`. Drop a frame whose `lastDepthId` is not above the REST id, then apply when `previousDepthId === last + 1` and store `lastDepthId` | the `recipe` run bridged exactly on 4 of 4 symbols |
| resync | on a gap, `resync` and fetch the REST book again after the resubscribe | the engine's path, plus the REST read the socket cannot replace |
| decoding | tell text from binary by the first byte, `{` or `P` for text and `0x0a` for a `BaseWsDTO`, since `VenueFeed` hands `handleMessage` a `Buffer` without the binary flag, see [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) lines 200 to 209. Decode protobuf with the schema of S2 | protobufjs is not a server dependency |
| keepalive | text `PING` every 10 s | what the web app does, and a socket silent for 30 s is closed |
| `maxSilenceMs` | 30,000 | most books push every 3 to 6 s, one pushed nothing in 45 s, and `PONG` counts as traffic |
| sizes | `Number()` of the string, in coins, with a `contractSize` of 1 | section 4 |
| deflate | keep `perMessageDeflate: false`, at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 81 | the server does not negotiate it |

The push cadence of about 1 s on the busiest books, and 3 to 6 s on most, is the limit no feed shape removes.
A book the venue batches for one to six seconds can be that stale on arrival, while the engine waits only `MIN_CROSS_AGE_MS`, 100 ms, before it opens a cross, see [`OpportunityManager.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/opportunity/OpportunityManager.ts) line 15.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Coinstore commit b7bcf588, "删除永续合约部分的api文档" (deleted the perpetual contract API documentation), 2026-06-12 | https://github.com/coinstore-openapi/coinstore-openapi.github.io/commit/b7bcf588e19d60bc2690294ce2da092e67f5287f | 2026-09-22 | Coinstore, global | no documented perpetual socket, preamble |
| S2 | Coinstore futures web app bundle: app, futures page and shared chunk | https://futures.coinstore.com/app-c5871e5f35262e33814e.js, https://futures.coinstore.com/component---src-pages-futures-index-tsx-7d70f014e07bb95e7e2c.js, https://futures.coinstore.com/e1f029943c7d1a815ad465f7db95f48f55716709-2b2e9f5fb9f4890146e6.js | 2026-09-22 | Coinstore, global | URLs, stream names, subscribe shape, protobuf schema, `PING` every 10 s, depth recipe, private names, sections 1 to 8 |
| S3 | Coinstore Perpetual Swap API documentation before its deletion, `source/en/futures.html.md` at commit decd7e7e | https://github.com/coinstore-openapi/coinstore-openapi.github.io/blob/decd7e7efaa2b9e548c0fa9a7bc2e74fc4414201/source/en/futures.html.md | 2026-09-22 | Coinstore, legacy futures | the socket.io URL, section 1 |
| S4 | Coinstore spot API documentation, section Websocket Ticker Data | https://coinstore-openapi.github.io/en/ | 2026-09-22 | Coinstore, global | the spot socket URL, section 1 |
| P1 | `ws-probe.mjs book` at 02:50 and 03:08 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinstore/ws-probe.mjs) | 2026-09-22 | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs recipe` at 03:10 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinstore/ws-probe.mjs) | 2026-09-22 | this host | sections 3, 4 and 8 |
| P3 | `ws-probe.mjs index` at 02:55, 02:58 and 03:07 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinstore/ws-probe.mjs) | 2026-09-22 | this host | sections 2, 3 and 6 |
| P4 | `ws-probe.mjs batch` and `silence` at 02:56 and 03:11 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinstore/ws-probe.mjs) | 2026-09-22 | this host | sections 3, 4 and 5 |
| P5 | `ws-probe.mjs errors`, `deflate` and `legacy` at 02:50 and 03:12 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinstore/ws-probe.mjs) | 2026-09-22 | this host | sections 1, 3, 4 and 6 |
