# CoinW WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 02:40 to 03:10 UTC, from the development host near Seattle.

This profile covers the public futures WebSocket of CoinW, which has no CCXT class, for both perpetual families, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/coinw/ws-probe.mjs), in two runs about ten minutes apart, and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The API reference at `https://www.coinw.com/api-doc/en/` answered this host with HTTP 200, while the rest of `www.coinw.com` returned 403, see [`fees.md`](./fees.md).

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals | `wss://ws.futurescw.com/perpum`, S1 | open in 291 to 756 ms over the eight opens the probe timed, 385 contracts served |
| USDC-M perpetuals | the same URL, contract spelled `BTC_USDC`, S2 | `BTC_USDC` delivers on the same socket as `BTC` |
| token URL | `wss://ws.futurescw.info?token={your_token}`, "Method 1", with a public token obtained elsewhere, per the search snippet of S1 | not probed, the public URL needs no token |
| private data | the same URL after a `login` event, S3 | not probed |

One socket carries both families and the public and private channels, S1.
`ws.futurescw.com` is a CNAME to `ws.futurescw.com.whecloud.com`, which resolved to `138.113.19.117` and `157.185.156.248`.
The upgrade reply carried `server: wswaf` and an `x-via` chain of "Cdn Cache Server V2.0" hops, named for San Jose, Denver and Hong Kong edges.

## 2. Channel matrix for public market data

| `type` | payload | depth and speed | probed |
|---|---|---|---|
| `depth` | `{"event":"sub","params":{"biz":"futures","type":"depth","pairCode":"BTC"}}` | documented as 100 levels, S2 | a whole book of up to 200 levels per side in every frame, about 4.6 frames a second on a busy contract, recommended |
| `index_price` | same shape | "real-time", S4 | one frame per contract every 245 to 320 ms median over six contracts in two runs |
| `mark_price` | same shape | "real-time", S4 | one frame every 238 to 306 ms median, and the last frame shared its `t` with the index frame on 11 of the 12 readings |
| `funding_rate` | same shape | "real-time", S4 | one frame every 5 s, carrying the rate, the interval and the next settlement |
| `ticker_swap` | same shape | 24 h summary | not probed |
| `fills` | same shape | trades | not probed |
| `candles_swap`, `candles_swap_utc` | adds `"interval"` | K lines | not probed |
| `deep` | as spelled in the Java sample of S3 | | refused with `errorCode` 1007 `Invalid parameter` |

No best bid and ask channel is documented.
The type names for the ticker, trades and candles come from the Java sample of S3, and they were not probed.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for everything, S1 | USDT-M and USDC-M contracts share a socket |
| subscribe frame shape | `{"event": "sub", "params": {"biz": "futures", "type": "depth", "pairCode": "BTC"}}`, one contract per frame, S2 | one contract per frame. `"XRP,ADA"` and `["LTC","BCH"]` were acknowledged and delivered nothing |
| unknown symbol expectation | Not publicly specified | `NOPE`, `SOLUSDT` and `BTCUSDC` were acknowledged with `"result":true` and delivered nothing |
| chunk unit and budget | depth: "10 requests/2s per IP", S2. Index, mark and funding: "None", S4 | a burst of 12 depth subscriptions was acknowledged and all 12 delivered. On one socket the first 513 subscriptions delivered and every later one was acknowledged and silent, section 5 |
| keepalive mechanism | client sends `{"event": "ping"}`, the Java sample every 10 s, S3 | `{"event":"pong"}` comes back. The text `ping` gets `errorCode` 1001 `Rate Limit`. No server protocol ping on any socket |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 120 s, and no notice seen |
| handshake and operation rate limits | depth subscriptions 10 per 2 s per IP, S2 | not reached, section 5 |
| public market data authentication | none, S1 | none |
| message parse and routing | `{biz, pairCode, data, type}`, S2 | depth frames echo `pairCode` in upper case even when subscribed in lower case. Index, mark and funding frames send `pairCode` and `data.n` in lower case, `btc` and `btc_usdc` |
| subscribe acknowledgement shape | `{"biz", "pairCode", "data": {"result": true}, "channel": "subscribe", "type"}`, S2 | as documented. A refusal is `"data": {"result": false, "errorCode": 1007, "errorMsg": "Invalid parameter"}` |
| symbol identifier format | `BTC` for USDT-M, `BTC_USDC` for USDC-M, case-insensitive, S2 | the instruments `name`, see [`rest.md`](./rest.md) section 2. The REST tickers spell `BTCUSDT` and `BTCUSDC`, which the socket accepts and never serves |
| number representation | `BigDecimal` | depth price and size are JSON strings. Index, mark and funding values are JSON numbers |
| timestamp representation | `ts` in ms, S2 | `data.t` in ms on every channel. Some frames add a top-level `time`. Between the index frame and the depth frame of section 6, captured 1,315.19 s apart by `data.t` on two connections, `time` advanced by 1,315.32 × 10^9, so it counts nanoseconds from an epoch about 77 days back, not Unix time. `nt` is ms |
| size unit | "Quantity", and "Quantity of the base currency" on the REST book, S2 and S5 | base currency, section 4 |
| sequence semantics | none | no sequence, update id or checksum in any frame |
| idle repeat behaviour | not documented | 0 or 1 identical consecutive frames per contract in about 205 per run. A quiet book goes up to 4.5 and 6.0 s without a frame |

## 4. The book channel in detail

### Snapshot on subscribe

Every `depth` frame is a whole book.
The first came 238 to 267 ms after the subscribe frame on every contract of both runs, and each later frame replaced it.
There is no delta, so a feed calls `resetBook` on every frame.

### Level count

The documentation says 100 levels, S2.
On the wire `BTC`, `ETH` and `DOGE` sent exactly 200 bids and 200 asks in every frame of both runs.
`BTC_USDC` sent 170 to 190 per side and `AINVDA` 123 to 137 in the level counts the probe logged over three runs, so a thin book sends what it has.
On `ETH` the 200 bids spanned 1,138 ppm below the best bid in one frame.
The REST book is fixed at 20 levels, see [`rest.md`](./rest.md) section 5.

### Cadence

| contract | frames in 45 s | median interval | p90 | max |
|---|---:|---:|---:|---:|
| `BTC` | 209 and 208 | 218 and 220 ms | 256 and 265 ms | 412 and 477 ms |
| `ETH` | 208 and 206 | 219 ms | 257 and 262 ms | 416 and 466 ms |
| `BTC_USDC` | 207 and 205 | 219 ms | 259 and 261 ms | 421 and 472 ms |
| `DOGE` | 206 and 204 | 218 and 220 ms | 249 and 265 ms | 385 and 469 ms |
| `AINVDA`, the newest listing | 39 and 32 | 1,030 and 684 ms | 1,788 and 4,022 ms | 4,475 and 5,998 ms |

The pushes are timed at about 220 ms on a busy book and sent only on change on a quiet one.
The frame's `data.t` was 136 to 440 ms older than its arrival on the four busy contracts, median 188 to 204 ms, and up to 1,834 ms on the quiet `AINVDA`, on a host whose clock is NTP synchronised.
The third run read medians of 165 to 180 ms.

### Sequence and gap rule

None.
No frame carries a sequence, an update id or a checksum, and each frame is complete, so there is no gap to detect.
The Precautions page warns that "WebSocket subscription data does not guarantee the order of timestamps", S6.
`data.t` never went backwards on any contract in either run.

### Checksum

None documented, and none on the wire.

### Level order on the wire

Bids best first and descending, asks best first and ascending, in every frame of both runs on all five contracts.
No frame was crossed.

### Size unit against the catalog

The size `m` is in base currency, not in contracts.
The REST book documents `m` as "Quantity of the base currency", S5, and the socket and REST book agreed at the same price on 29 of 40 `BTC` levels and 9 of 40 `ETH` levels in the first run, 0 and 27 in the second, and 10 and 16 in the third.
The unit is also visible in the numbers.
`BTC` sizes such as `"1.303"` and `"0.985"` are multiples of the 0.001 BTC `oneLotSize`, and the documented `minSize` is 1 contract, so a size in contracts could not be fractional.
A third run at 03:02 UTC checked every size against the contract's `oneLotSize`, and all 413,013 sizes over six contracts were whole numbers of lots.
That includes 81,600 sizes on `1000PEPE`, whose lot is 1000 and whose sizes read like `"501000"`, and 82,000 on `DOGE`, whose lot is 30.
The misses are levels that changed between the two reads, since the REST book lags, and in the second run its `BTC` touch sat 5.4 below the socket's.
There is no CCXT `contractSize` to compare, so a catalog loader must give the engine a `contractSize` of 1 for these sizes, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

None seen.
The thinnest book probed, `AINVDA`, held 123 to 137 levels per side.

### Idle repeats

`BTC` repeated an identical book once in 208 frames in the second run, and no other contract repeated one.
A quiet book simply stops sending, for up to 6 s in these runs.

### Unknown, closed and wrong-family symbols

| request | reply | then |
|---|---|---|
| `depth` `NOPE` | `"result": true` | nothing |
| `depth` `SOLUSDT`, the tickers spelling | `"result": true` | nothing |
| `depth` `BTCUSDC`, the tickers spelling | `"result": true` | nothing |
| `depth` `"XRP,ADA"` and `["LTC","BCH"]` | `"result": true` | nothing |
| `depth` `eth` | `"result": true`, `pairCode` `eth` | 72 and 73 frames with `pairCode` `ETH` |
| `depth` `AVGO`, an equity contract missing from the instruments reply | `"result": true` | 1 frame in about 15 s, in both runs |
| `depth` `BTCPROPW`, a contract only in the tickers reply | `"result": true` | 65 frames |
| `depth` `BNB` twice | two acknowledgements | about 5 frames a second, not doubled |
| `unsub` `BNB` | no acknowledgement recorded | 3 and 2 frames arrived in the next 4 s, then none |
| `type` `deep` or `nope` | `errorCode` 1007 `Invalid parameter` | |
| `biz` `FUTURES` with `LINK` | `errorCode` 1007 `Invalid parameter` | 58 `LINK` frames anyway, in both runs |
| `biz` `spot` | `errorCode` 1007 | |
| `event` `SUB`, or `sub` with no `params` | `{"result":false,"errorCode":500,"errorMsg":"exception"}` | |
| text `hello` or `ping` | `{"result":false,"errorCode":1001,"errorMsg":"Rate Limit"}` | the socket stays open |

A closed contract was not available, since all 387 instruments were `online`.
Because the socket acknowledges symbols it will never serve, a feed has to notice a contract with no frame on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | `{"event": "ping"}`, every 10 s in the Java sample, S3 | `{"event":"pong"}` in 267 and 242 ms. No server ping on any socket |
| silence the server tolerates | Not publicly specified | a socket that subscribes nothing and sends nothing closed at 60.0 s with 1006 and no close frame, in both runs. A ping every 10 s, a `funding_rate` subscription with no ping, or a `depth` subscription with no ping each kept a socket open for the whole 120 s and 70 s runs |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames. A client that offers permessage-deflate gets `sec-websocket-extensions: permessage-deflate` back, and a client that does not, like the engine, gets plain frames |
| handshake and round trip | | 291 to 756 ms to open. Every acknowledgement and pong but one came 237 to 276 ms after its request, and the other 366 ms, so the socket's round trip from this host is about 240 ms |
| subscriptions per connection | Not publicly specified | `index_price` on all 387 contracts delivered on all 387. The three anchor channels on all 387 contracts, 1,161 subscriptions sent in pair order, delivered for the first 171 contracts and for none after, in both runs. So the first 513 subscriptions delivered, and every later one was acknowledged with `"result": true` and stayed silent |
| subscription rate | depth 10 per 2 s per IP, anchor channels "None" | depth at 4 a second and a burst of 12 drew no refusal. The anchor channels at 25 a second drew none |
| throughput | | `depth` on 100 USDT contracts on one socket: 260 and 274 frames a second, 2,374 and 2,505 KB a second, 9.3 KB a frame, and 281 to 310 µs per `toString` and `JSON.parse` of a frame on this laptop. The anchor channels on 171 contracts: 1,143 and 1,156 frames a second, 145 and 148 KB a second |

At that weight the whole catalog is heavy.
387 contracts at the measured 2.6 to 2.7 frames a second each is about 1,000 to 1,060 frames and 9.4 to 9.9 MB a second, and about 0.3 s of parse time per second of the event loop at the measured cost.
That is an extrapolation from the 100 contract batch, not a measurement.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays marked `…` are cut.

Subscribe and its acknowledgement.

```json
{"event": "sub", "params": {"biz": "futures", "type": "depth", "pairCode": "BTC"}}
```

```json
{"biz":"futures","pairCode":"BTC","data":{"result":true},"channel":"subscribe","type":"depth"}
```

A `depth` frame, first three of 200 levels per side kept, 11,281 bytes before trimming, from a 5 s `book` capture at 03:08 UTC.

```json
{"biz":"futures","pairCode":"BTC","data":{"t":1790132903770,"asks":[{"p":"86389","m":"0.466"},{"p":"86389.1","m":"0.165"},{"p":"86389.3","m":"1.021"}],"bids":[{"p":"86388.8","m":"1.039"},{"p":"86388.7","m":"2.771"},{"p":"86388.5","m":"1.357"}],"n":"btc"},"time":6698073045942438,"type":"depth"}
```

Index, mark and funding.

```json
{"biz":"futures","pairCode":"btc","data":{"p":86510.4,"t":1790131588578,"n":"btc"},"time":6696757721235563,"type":"index_price"}
```

```json
{"biz":"futures","pairCode":"btc","data":{"p":86470.0,"t":1790131588720,"n":"btc"},"time":6696757869125065,"type":"mark_price"}
```

```json
{"biz":"futures","pairCode":"g","data":{"r":-0.000379,"t":1790131590000,"nt":1790132400000,"h":1,"n":"g"},"time":6696759224740146,"type":"funding_rate"}
```

Keepalive.

```json
{"event": "ping"}
```

```json
{"event":"pong"}
```

Errors.

```json
{"biz":"futures","pairCode":"BTC","data":{"result":false,"errorCode":1007,"errorMsg":"Invalid parameter"},"channel":"subscribe","type":"deep"}
```

```json
{"result":false,"errorCode":500,"errorMsg":"exception"}
```

```json
{"result":false,"errorCode":1001,"errorMsg":"Rate Limit"}
```

An unknown contract is acknowledged like a real one.

```json
{"biz":"futures","pairCode":"NOPE","data":{"result":true},"channel":"subscribe","type":"depth"}
```

## 7. Private channels

Named for a future execution stage, from the Java sample of S3, not probed.
They use the same URL after `{"event": "login", …}` with an API key and secret.

- `order`, `position`, `position_change`, `assets`, `assets_ag`, `user_setting`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://ws.futurescw.com/perpum`, for both families | one URL serves both |
| channel | `depth`, `pairCode` equal to the `rawMarketId` from the instruments `name` | the only book channel, and it needs no sequence handling |
| markets per connection | 100 | 100 ran at 260 to 274 frames a second with no refusal and no close, the per connection cap sits near 513 subscriptions, and a larger slice concentrates about 2.5 MB a second on one socket |
| subscribe frames | one frame per contract, `{"event": "sub", "params": {"biz": "futures", "type": "depth", "pairCode": "<rawMarketId>"}}`, with `subscribeGapMs` 250 and `connectStaggerMs` long enough that all connections together stay under 5 a second | the documented limit is per IP, not per connection, and a joined `pairCode` is silently ignored |
| keepalive | `{"event": "ping"}` every 20 s | the server sends no ping, and an idle socket dies at 60 s |
| `maxSilenceMs` | 30,000 | a quiet book went 6 s without a frame, and the pong every 20 s counts as traffic |
| routing | upper case `pairCode` of a `depth` frame gives the `rawMarketId` | depth frames echo upper case |
| snapshot | every `depth` frame: `resetBook` with the first 20 levels per side, sizes as they come | each frame is the whole book in base currency |
| resync | none on sequence. Terminate and resubscribe on the silence watch only | there is no sequence to check |
| unserved stream | log a contract with no frame 10 s after its acknowledgement | unknown and misspelled contracts are acknowledged and silent |
| receive time | stamp on arrival, never from `data.t` | `data.t` is about 190 ms old on arrival |
| numbers | `Number()` of the price and size strings | |
| deflate | keep `perMessageDeflate: false` | the server would negotiate it if offered |

The frame weight is the open cost.
Each push resends up to 200 levels per side to deliver the top 20, so parsing, not bandwidth, is what the event loop pays, see section 5.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinW API, Futures Trading base URL | https://www.coinw.com/api-doc/en/common/futures-trade-information | 2026-09-22 | CoinW, global | URL, one socket for public and private, section 1 |
| S2 | CoinW API, Subscribe Order Book | https://www.coinw.com/api-doc/en/futures-trading/market/subscribe-order-book | 2026-09-22 | CoinW, global | depth frame, 100 levels, 10 per 2 s, `pairCode` rules, sections 2 to 4 |
| S3 | CoinW API, Authentication and Code Snippet, Futures | https://www.coinw.com/api-doc/en/common/certify-code-futures | 2026-09-22 | CoinW, global | ping, 10 s heartbeat, type names, private channels, sections 2, 3, 5 and 7 |
| S4 | CoinW API, Subscribe Index Price, Mark Price and Funding Fee Rate | https://www.coinw.com/api-doc/en/futures-trading/market/subscribe-mark-price | 2026-09-22 | CoinW, global | anchor channel shapes, no frequency limit, section 2 |
| S5 | CoinW API, Get Order Book | https://www.coinw.com/api-doc/en/futures-trading/market/get-order-book-of-an-instrument | 2026-09-22 | CoinW, global | size in base currency, section 4 |
| S6 | CoinW API, Precautions | https://www.coinw.com/api-doc/en/common/precautions | 2026-09-22 | CoinW, global | timestamp order warning, section 4 |
| P1 | `ws-probe.mjs book`, `errors`, `anchor`, `anchorbatch`, `cap`, `deflate`, `batch` at 02:45 to 02:52 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinw/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6, first readings |
| P2 | `ws-probe.mjs silence` for 120 s at 02:52 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinw/ws-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P3 | second pass: every mode again at 02:55 to 03:01 UTC, `silence` for 70 s, `book` a third time at 03:02 UTC with the lot check, and a 5 s `book` capture at 03:08 UTC for section 6 | [`ws-probe.mjs`](../../../scripts/probes/venues/coinw/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6, second readings |
