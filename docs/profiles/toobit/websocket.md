# Toobit WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle.

This profile covers the public market WebSocket of Toobit (CCXT id `toobit`) for both perpetual families, USDT-M and USDC-M, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/toobit/ws-probe.mjs), run twice, at 21:38 and 21:44 UTC, and the two runs are quoted side by side where they differ.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Sockets were held for about 9 minutes in total, including a 20 s exploration, an 8 s check of the `limit` parameter and two 6 s frame captures.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals | base `wss://stream.toobit.com`, path `/quote/ws/v1`, S1 | open in 334 to 407 ms over the five sockets whose open time was logged, and every probed contract delivered |
| USDC-M perpetuals | no separate URL documented, S1 | `BTC-SWAP-USDC` delivered on the same socket |
| spot | the same URL, S2 | `BTCUSDT` delivered on the same socket |
| user data | `wss://stream.toobit.com/api/v1/ws/<listenKey>`, S3 | not probed |

One socket carries every product, keyed by the symbol alone.
CCXT Pro uses the same URL for every public topic, at `server/node_modules/ccxt/js/src/pro/toobit.js` lines 33 and 548.
`stream.toobit.com` is a Cloudflare name, resolving to `104.18.18.168` and `104.18.19.168`, and the upgrade reply carried `server: cloudflare` with a `cf-ray` ending in `YVR`, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| topic | payload | depth and speed | probed on 2026-09-22 |
|---|---|---|---|
| `diffDepth` | `{"symbol": "BTC-SWAP-USDT,ETH-SWAP-USDT", "topic": "diffDepth", "event": "sub", "params": {"binary": false}}` | the whole book as a snapshot, then deltas. S1: "Push the changing part of the order book (if any) every second" | snapshot then deltas, 3.31 and 3.36 frames per second on BTC, a per symbol delta counter `o`, recommended |
| `depth` | same shape, topic `depth` | S1 shows 10 levels per side in its example and a `limit` parameter | the whole book on every push, 238 to 244 levels per side in BTC's most frequent counts, 2.99 and 3.13 frames per second, and `limit` 5, 20 and 100 were ignored |
| `bookTicker` | `{"symbol": "BTC-SWAP-USDT", "topic": "bookTicker", "event": "sub"}` | best bid and ask on change | 367 and 371 frames in 75 s on BTC, and a first frame with `"data": []` |
| `markPrice` | same shape, topic `markPrice` | contract mark price | one frame a second, `time` on the whole second, and a first frame with `"data": []` |
| `index` | `{"symbol": "BTCUSDT", "topic": "index", "event": "sub"}`, keyed by the index token | index, 10 minute average `edp`, and the basket as `formula` | one frame a second, `time` on the whole second |
| `realtimes`, `trade`, `kline_$interval`, `wholeRealTime`, `wholeBookTicker` | S1 | ticker, trades, candles, all tickers, all best prices | not probed |

No funding topic is documented, so the funding rate comes only from REST, see [`rest.md`](./rest.md) section 3.
The `index` topic takes the index token, `BTCUSDT`, and not the contract id.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one base URL, S1 | one URL carries USDT-M, USDC-M, `TBV_` contracts and spot |
| subscribe frame shape | `{"symbol": "$symbol0, $symbol1", "topic": "$topic", "event": "sub", "params": {"limit": "$limit", "binary": "false"}}`, S1 | comma joined ids without spaces. A space after the comma, as in the documented example, answered `{"code":"-100010","desc":"Invalid Symbols!"}` for the second id while the first delivered |
| unknown symbol expectation | not documented | `{"code":"-100010","desc":"Invalid Symbols!"}`, which names neither the symbol nor the topic. The delisted `REN-SWAP-USDT` answered a snapshot with empty `b` and `a` and no error |
| chunk unit and budget | Not publicly specified | 300 `diffDepth` symbols in one frame of 4,549 and 4,539 characters, all 300 delivered. 150 `depth` symbols in one frame, all delivered |
| keepalive mechanism | "Every once in a while, the client needs to send a ping frame, and the server will reply with a pong frame, otherwise the server will actively disconnect within 5 minutes", `{"ping": 1535975085052}` answered by `{"pong": 1535975085052}`, S1 | the pong carries the server's own clock, not the client's number: a ping of `1790113477350` came back as `{"pong":1790113477397}` 106 ms later. No server protocol ping on any socket. A socket with no traffic in either direction closed at 60.3 s |
| connection lifetime and maintenance notice | Not publicly specified | no forced disconnect on a socket kept alive for 250 s, and no notice frame seen |
| handshake and operation rate limits | Not publicly specified | no refusal with up to five sockets open at once and 12 subscribe frames in 5 s on one socket |
| public market data authentication | none | none |
| message parse and routing | `{symbol, symbolName, topic, params, data, f, sendTime}`, S1 | book topics route on `topic` and the top level `symbol`. `bookTicker` and `markPrice` updates carry no top level `symbol` and route on `data.s` and `data.symbolId` |
| subscribe acknowledgement shape | not documented | none. The first data frame, with `"f": true`, is the only sign a subscription took. An error is `{"code": "...", "desc": "..."}` |
| symbol identifier format | `BTC-SWAP-USDT` | identical to CCXT `market.id` and to the REST `symbol` on 767 of 767 contracts, see [`rest.md`](./rest.md) section 2 |
| number representation | strings, S1 | prices and sizes are strings on every book frame |
| timestamp representation | `t` "Matching time" in ms, `sendTime` in ms | as documented, plus `v`, a version string such as `"1790113457252_0.000000000000000001"` whose first part is a millisecond time |
| size unit | "quantity", S1 | contracts of `contractMultiplier` coins, which is CCXT `contractSize`, section 4 |
| sequence semantics | "Version numbers are not guaranteed to be unique, but data from close dates will definitely be different.", S1 | `diffDepth` deltas carry an undocumented `o` that counts deltas per symbol: 0 gaps in 19,627 deltas over 300 contracts in 60 s, and 0 in the four contract runs |
| idle repeat behaviour | not documented | `depth` sent the same book twice right after subscribing, and nothing else was repeated. A quiet book went 41 s and 60 s without a frame |

## 4. The book channel in detail

`diffDepth` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame for each symbol is `"f": true` and carries the whole book, 239 to 242 levels per side on `BTC-SWAP-USDT` over four snapshots, 208 to 214 on `ETH-SWAP-USDT` and `XPD-SWAP-USDT`, and 112 bids and 96 asks on `XPB2-SWAP-USDT`.
It arrived 198 to 289 ms after the subscribe frame was sent.
A snapshot carries `"e": 301`, which is the exchange id, `s`, and `"o": 0`.
A second subscribe for a symbol already subscribed answered no error and sent a fresh snapshot 103 ms later, in the rerun at 9,536 ms.
So a resubscribe is a way to reseed one book without closing the socket.

### Delta semantics

A delta carries `"e": 0`, `t`, `v`, `o`, and `b` and `a` arrays of `[price, size]` string pairs.
The size is the new absolute size at that price, and `"0"` deletes the level, S1.
In the rerun the first delta after the snapshot carried the snapshot's own `v` on `BTC-SWAP-USDT` and `ETH-SWAP-USDT` and restated levels the snapshot already held.
In the `frames` capture it carried a new `v` and changed sizes, section 6, so the first delta is applied like any other.
One first delta in the first run had empty `b` and `a`, and the rerun counted no empty delta on any of its four contracts.

### Sequence and gap rule

S1 documents only `v` and says it is not unique.
The wire carries `o` on every delta, and it rose by exactly one per delta for each symbol: `BTC-SWAP-USDT` ran from 1,322,642 upward in the rerun, and `ETH-SWAP-USDT` from 1,025,576.

```text
f = true                    replace the book, forget the last o
f absent, no last o yet     apply, last = o
f absent, o = last + 1      apply, last = o
f absent, o ≠ last + 1      gap: resync
```

The rule held on every delta of both runs: 0 gaps on four contracts over 75 s twice, and 0 gaps in 19,627 deltas across 300 contracts over 60 s.
After the second snapshot of a resubscribe, `o` continued from the old counter, 1,322,673, rather than restarting, so the snapshot's `"o": 0` is a marker and not a base.
`o` is undocumented, which makes the rule a wire observation that a later release could change.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `diffDepth` snapshot | descending on every frame | ascending on every frame |
| `diffDepth` delta | descending on every frame | ascending on every frame |
| `depth` | descending | ascending |
| REST `/quote/v1/depth` | descending at every limit | ascending |

A feed still applies deltas by price and not by position.

### Level window

No fixed window exists: the snapshot is the whole book, and the book kept from the snapshot and every delta reached 244 and 245 levels on `BTC-SWAP-USDT`.
The REST book with `limit=500` or `limit=1000` returned 240 to 243 levels per side, which is the same whole book, see [`rest.md`](./rest.md) section 5.
The engine keeps 20 levels, so a feed takes the top 20 of that book.

### Agreement between the two book topics

Each `depth` frame was compared with the book kept from `diffDepth` at that moment.
Whenever both carried the same `v`, the top 20 levels were identical on every pair: 105 of 105 on BTC and 102 of 102 on ETH in the first run, and 83 of 83, 94 of 94 and 4 of 4 on BTC, ETH and XPD in the rerun.
Pairs with different `v` described two different moments, so they are not a disagreement.
The REST book read at the same `t` as a `depth` frame matched it on 20 of 20 bid levels for BTC and for ETH in the rerun.

### Size unit against CCXT `contractSize`

| contract | CCXT `contractSize` | evidence that sizes are contracts |
|---|---:|---|
| `BTC-SWAP-USDT` | 0.001 | the touch read `"57867.8"`, which is 57.9 BTC as contracts and 57,868 BTC as coins. The 24 h ticker read `v` `"57317905.8"` and `qv` `"4926908936.88931"`, 85.96 USDT per unit at a price near 86,000, so one unit is 0.001 BTC. Open interest `size` `"2194.326998"` BTC against the ticker's `op` `"2194326.998"` gives the same 0.001 |
| `ETH-SWAP-USDT` | 0.01 | a touch size of `"14701.2"` is 147 ETH as contracts and 14,701 ETH as coins, against Binance's `"28.978"` ETH at the same price and moment, [`rest.md`](./rest.md) section 5 |

So sizes are contracts of `contractMultiplier` coins, CCXT's `contractSize` equals `contractMultiplier` on 767 of 767 contracts, and the engine's size multiplier converts Toobit sizes correctly, see [`rest.md`](./rest.md) section 2.
Sizes are fractional on some contracts: BTC to one decimal of a contract, which is the catalog's `stepSize` of 0.0001 BTC.

### How the ladder moves

Consecutive frames rescale most levels of a side by one common factor.
Between two BTC `depth` frames in the rerun, `22479.8` became `22688.4`, `5707.1` became `5760`, `8132.6` became `8208` and `2782.2` became `2808`, each a factor of about 1.0093.
The quiet `XPD-SWAP-USDT` moved its asks as a ladder, deleting `1312.86`, `1314.17` and `1315.48` and adding `1312.98`, `1314.29` and `1315.6` in one delta.
That is the shape of one automated quoting process, and it bears on how much of the displayed depth a taker can reach, see [`rest.md`](./rest.md) section 5.

### One-sided and empty books

The delisted `REN-SWAP-USDT` answered a snapshot with `"b": []` and `"a": []`.
No trading contract was seen one-sided.
The engine's `resetBook` accepts an empty side.

### Idle repeats

`diffDepth` repeats nothing, and a quiet book sends no frame until it changes.
`XPD-SWAP-USDT` went 60 s and 41 s without a frame in the two runs, and `XPB2-SWAP-USDT` sent only its snapshot in 75 s.
`depth` sent the whole book a second time right after the subscribe, with the same `v`, and then only on change.

### Unknown, closed and wrong symbols

| request | reply |
|---|---|
| `diffDepth` `NOPE-SWAP-USDT` | `{"code":"-100010","desc":"Invalid Symbols!"}` |
| `depth` `"LINK-SWAP-USDT, DOT-SWAP-USDT"`, with a space | `LINK-SWAP-USDT` delivers, and `{"code":"-100010","desc":"Invalid Symbols!"}` for the other |
| topic `nope` | `{"code":"-10004","desc":"Invalid topic!"}` |
| no `event` | `{"code":"-10002","desc":"Invalid event!"}` |
| text that is not JSON | `{"code":"-10001","desc":"Invalid JSON!"}`, and the socket stays open |
| `diffDepth` `REN-SWAP-USDT`, delisted | a snapshot with empty sides, no error |
| `depth` `TBV_BTC-SWAP-TBV_USDT` | delivers, 200 levels per side |
| `diffDepth` with `"binary": true` | gzip frames, binary, starting `1f8b0800` |

An error names neither the symbol nor the topic, so a feed that sends a batch cannot tell which id failed and has to notice a symbol with no snapshot on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client `{"ping": <ms>}`, server `{"pong": <ms>}`, S1 | pong round trip 102 to 106 ms. The pong's number is the server clock, 46 to 48 ms after the client's number |
| silence the server tolerates | "within 5 minutes", S1 | a socket with no subscription and no ping closed with 1006 and no close frame at 60.3 s in both runs. A subscribed quiet socket with no ping closed at 213.8 s in the first run, 60 s after its last frame at 153.8 s, and at 60.3 s in the rerun after only its snapshot. A socket that pinged every 30 s stayed open for 250 s in both runs |
| forced disconnect | Not publicly specified | none in 250 s |
| maintenance notice | Not publicly specified | none seen |
| compression | `"binary"` in `params`, "compression or not", S1 | `"binary": false` gives text JSON frames. `"binary": true` gives gzip binary frames. A client offering permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | | 334 to 407 ms to open from this host |
| CCXT Pro keepalive | `'keepAlive': (60 - 1) * 5 * 1000`, 295 s, "every 5 minutes", at `server/node_modules/ccxt/js/src/pro/toobit.js` line 62 | longer than the 60 s idle close, so a CCXT Pro socket on quiet books would be dropped |
| throughput, `diffDepth` | | the 300 busiest perpetuals by 24 h volume once every fifth was set aside for the `depth` socket: median 330 and 334 frames per second, peak 416 and 533, 332 and 347 KB per second, about 1 KB per frame, 47.9 and 51.5 µs of `JSON.parse` per frame |
| throughput, `depth` | | 150 perpetuals, every fifth by 24 h volume: median 126 and 133 frames per second, 840 and 895 KB per second, 6.5 KB per frame, 258 and 267 µs of `JSON.parse` per frame |

`depth` costs about five times the parse time per frame of `diffDepth`, because every push is the whole book.

## 6. Captured frames

Trimmed, from the rerun and from `ws-probe.mjs frames` at 21:58 UTC.
Level arrays are cut to their first three entries, nothing else is changed, and each block parses as JSON.

Subscribe, four ids in one frame.

```json
{"symbol":"BTC-SWAP-USDT,ETH-SWAP-USDT,XPD-SWAP-USDT,XPB2-SWAP-USDT","topic":"diffDepth","event":"sub","params":{"binary":false}}
```

Snapshot, which held 241 bids and 242 asks.

```json
{"symbol":"BTC-SWAP-USDT","symbolName":"BTC-SWAP-USDT","topic":"diffDepth","params":{"realtimeInterval":"24h","binary":"false"},"data":[{"e":301,"s":"BTC-SWAP-USDT","t":1790114301675,"v":"1790114301264_0.000000000000000001_208542","b":[["86194","12379.9"],["86193.9","37.5"],["86193.8","5"]],"a":[["86194.1","22436.2"],["86194.2","126.5"],["86194.3","330.3"]],"o":0}],"f":true,"sendTime":1790114301879}
```

The first two deltas after it, 25 levels per side each.
Every size shown except the 5 contracts at `86193.8` moved by about the same factor, 0.980 and then 1.051.

```json
{"symbol":"BTC-SWAP-USDT","symbolName":"BTC-SWAP-USDT","topic":"diffDepth","params":{"realtimeInterval":"24h","binary":"false"},"data":[{"e":0,"t":1790114301975,"v":"1790114301264_0.000000000000000001_208543","b":[["86194","12130.2"],["86193.9","36.7"],["86193.8","4"]],"a":[["86194.1","21983.9"],["86194.2","124"],["86194.3","323.6"]],"o":1325415}],"f":false,"sendTime":1790114302060}
```

```json
{"symbol":"BTC-SWAP-USDT","symbolName":"BTC-SWAP-USDT","topic":"diffDepth","params":{"realtimeInterval":"24h","binary":"false"},"data":[{"e":0,"t":1790114302276,"v":"1790114301264_0.000000000000000001_208544","b":[["86194","12752.6"],["86193.9","38.6"],["86193.8","6"]],"a":[["86194.1","23111.8"],["86194.2","130.3"],["86194.3","340.2"]],"o":1325416}],"f":false,"sendTime":1790114302375}
```

Best bid and ask, and mark, with no top level `symbol`.

```json
{"topic":"bookTicker","params":{"realtimeInterval":"24h"},"data":{"e":"bookTicker","E":1790113457479,"s":"BTC-SWAP-USDT","b":"86158.3","bq":"22688.4","a":"86158.4","aq":"1518.8","t":1790113457475},"f":false,"sendTime":1790113457479}
```

```json
{"topic":"markPrice","params":{"realtimeInterval":"24h"},"data":{"exchangeId":301,"symbolId":"BTC-SWAP-USDT","price":"86158.3","time":1790113458000},"f":false,"sendTime":1790113458015}
```

Index, with its basket.

```json
{"symbol":"BTCUSDT","symbolName":"BTCUSDT","topic":"index","params":{"realtimeInterval":"24h","binary":"false"},"data":[{"symbol":"BTCUSDT","index":"86201.70021739","edp":"86246.979316","formula":"COINBASE.BTCUSDT*1.0,KUCOIN.BTCUSDT*1.0,BITGET.BTCUSDT*1.0,OKEX.BTCUSDT*1.0,BINANCE.BTCUSDT*1.0,BYBIT.BTCUSDT*1.0","time":1790113458000}],"f":false,"sendTime":1790113458391}
```

Keepalive.

```json
{"ping": 1790113477350}
```

```json
{"pong":1790113477397}
```

Errors.

```json
{"code":"-100010","desc":"Invalid Symbols!"}
```

```json
{"code":"-10001","desc":"Invalid JSON!"}
```

## 7. Private channels

Named for a future execution stage, from S3 and CCXT Pro, not probed.

- A listen key from `POST /api/v1/listenKey`, with `category` `USDC` for USDC-M, valid for 60 minutes and extended by `PUT`, opens `wss://stream.toobit.com/api/v1/ws/<listenKey>`.
- Events `outboundContractAccountInfo`, `outboundContractPositionInfo`, `contractExecutionReport` and `ticketInfo`, as CCXT Pro routes them at `server/node_modules/ccxt/js/src/pro/toobit.js` lines 134 to 139.
- A `listenKeyWillExpire` event is pushed every minute from 5 minutes before expiry, S3.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://stream.toobit.com/quote/ws/v1`, for USDT-M and USDC-M alike | one socket carries every product |
| channel | `diffDepth` with `"params": {"binary": false}` | a snapshot on subscribe, a strict undocumented `o` counter, 1 KB frames. `depth` has no counter to miss but costs five times the parse time |
| markets per connection | 300, so three sockets for 767 contracts | 300 ran with 0 gaps at about 330 frames per second, and no cap is published, so a larger slice is untested |
| subscribe frames | one frame per slice, `{"symbol": "<id>,<id>,…", "topic": "diffDepth", "event": "sub", "params": {"binary": false}}`, with no spaces | a space after a comma invalidates the next id |
| keepalive | `{"ping": <Date.now()>}` every 20 s | the server sends no ping and closes a socket 60 s after its last frame, and quiet books go longer than that |
| `maxSilenceMs` | 45,000 | two missed pongs, and a quiet book went 60 s without a book frame, so the pong has to count as traffic |
| routing | `frame.topic === 'diffDepth'`, key `frame.symbol`, which is the `rawMarketId` | book frames carry the id at the top level |
| snapshot | `f === true`: `resetBook` from `data[0].b` and `data[0].a`, forget the last `o` | documented replace semantics, and the snapshot's `o` was 0 on every snapshot seen |
| delta | take the first `o` after a snapshot as the base, then apply only when `o === last + 1` | 0 gaps in 19,627 deltas |
| resync | a gap, or a delta before any snapshot: `resync`, which terminates the socket and resubscribes | the engine's existing path. A resubscribe of the one symbol also sends a fresh snapshot, if a later design wants a lighter repair |
| unserved stream | log a symbol with no snapshot 10 s after the subscribe | an error does not name the symbol |
| receive time | stamp on arrival, never from `t` or `sendTime` | a quiet book's snapshot carries the time of its last change |
| sizes | `Number()` of the string, which may be fractional | BTC sizes carry one decimal of a contract |
| deflate | keep `perMessageDeflate: false` and `"binary": false` | the server does not negotiate deflate, and `binary` true switches to gzip frames |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Toobit API, USDT-M WebSocket Market Data | https://api-docs.toobit.com/api/usdt-m-websocket-market-data.html | 2026-09-22, read here with `curl` | Toobit, global | URL, subscribe shape, topics, ping and pong, `v`, delta semantics, sections 1 to 5 |
| S2 | Toobit API, Spot WebSocket Market Data | https://api-docs.toobit.com/api/spot-websocket-market-data.html | 2026-09-22, read here with `curl` | Toobit, global | spot on the same URL, section 1 |
| S3 | Toobit API, USDT-M WebSocket Account | https://api-docs.toobit.com/api/usdt-m-websocket-account.html | 2026-09-22, read here with `curl` | Toobit, global | user data stream, listen key, events, sections 1 and 7 |
| S4 | CCXT Pro 4.5.68 `toobit.js` | `server/node_modules/ccxt/js/src/pro/toobit.js` | 2026-09-22 | CCXT | URL, keepalive interval, event routing, sections 1, 5 and 7 |
| P1 | `ws-probe.mjs all`, first run at 21:38 to 21:42 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/toobit/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs all`, rerun at 21:44 to 21:48 UTC, with the `o` counter tracked | [`ws-probe.mjs`](../../../scripts/probes/venues/toobit/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6, the second readings and the gap counts |
| P3 | a 20 s exploration socket at 21:31 UTC and an 8 s `limit` check at 21:43 UTC, both from the scratchpad and not kept | none | 2026-09-22 | this host | the first frame shapes, the ignored `limit`, sections 2 and 3 |
| P4 | `ws-probe.mjs frames` at 21:58 UTC and again at 22:06 UTC, 6 s each | [`ws-probe.mjs`](../../../scripts/probes/venues/toobit/ws-probe.mjs) | 2026-09-22 | this host | the whole snapshot and delta frames, section 6 |
