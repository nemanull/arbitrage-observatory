# Websea WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 20:12 and 20:52 local time, which is 2026-09-23 03:12 to 03:52 UTC.

This profile covers the public WebSocket market data of the Websea USDT-margined perpetuals, the only perpetual family the venue lists.
The documented OpenAPI socket has no order book channel.
The book below comes from an undocumented socket that the Websea futures web app uses, found in its JavaScript bundle and then probed.
Every protocol claim was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/websea/ws-probe.mjs), and the capture is quoted beside the documented value where one exists.
Two runs are quoted, the first at 03:31 to 03:41 UTC and the rerun at 03:46 to 03:52 UTC, written as first run and rerun.

## 1. Endpoints

| socket | URL | documented | probed |
|---|---|---|---|
| OpenAPI futures market | `wss://oapi.websea.com/ws/v1/futures/market` | yes, S1 and S2 | open in 763 and 873 ms, `tickers` and `trade` deliver, no book channel |
| OpenAPI futures orders, private | `wss://oapi.websea.com/ws/v1/futures/order` | yes, S3 | not probed |
| web app futures depth | `wss://cws.websea.com/ws/realTime_depth?compress=0` | no, from the web bundle, S4 | open in 735 to 1,205 ms in the book and batch runs, one depth subscription per socket |
| web app futures market | `wss://cws.websea.com/ws/realTime?compress=0` | no, from the web bundle, S4 | open in 752 and 872 ms, symbol detail (type 8) with mark, index and funding for all 246 perps on one socket |

The web app opens both `cws` paths with `compress=1`, which wraps each frame in gzip inside a text frame, section 5.
With `compress=0` the same frames arrive as plain JSON text.
All three hosts resolve to the same two Cloudflare addresses, `172.66.160.234` and `104.20.41.173`, and answer through the Vancouver point of presence, see [`rest.md`](./rest.md) section 1.
One family exists, so there is no family split.

## 2. Channel matrix for public market data

| socket | channel | payload | depth and speed | probed |
|---|---|---|---|---|
| `cws` depth | type 1, depth | `{"symbol", "depth", "level", "type": 1, "version": 1}` | up to 50 gears per side at one merge step. Frames about every 200 ms | the only book source, section 4 |
| `cws` market | type 8, symbol detail | `{"symbol", "type": 8}` | on change, a median of 40 and 41 frames per perp in 40 s | carries `markerPrice`, `indexPrice`, `capitalRate`, `newPrice`, section 4 of [`rest.md`](./rest.md) |
| `cws` market | type 3, trades, and 5, 13, 14, klines | `{"symbol", "type": 3}` | | named in the bundle, not probed |
| `cws` market | types 2, 11, 16, private | `{"token": "…_pc", "type": n}` | | named in the bundle, need a login token, not probed |
| `oapi` | `tickers` | `{"op": "sub", "channel": "tickers", "symbol": "BTC-USDT"}` | "Push interval: up to 500ms", on trades, S1 | 24 frames on BTC in 30 s in both runs, carries `bid` and `ask` |
| `oapi` | `trade` | `{"op": "sub", "channel": "trade", "symbol": "BTC-USDT"}` | one trade per push, S2 | 30 and 32 frames on BTC in 30 s |
| `oapi` | `kline1min` and other periods | | "The fastest push interval is 1 second" | not probed |
| `oapi` | `depth`, `orderbook`, `books`, `depth20`, `mark_price` | | not documented | `depth` answers errno `50009` "WS channel unavailable." in both runs of `errors`, and the other four answered the same in a hand run before the probe was written |

No mark, index or funding channel exists on the documented socket.
The web market socket's type 8 carries all three, see [`rest.md`](./rest.md) section 4.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is the OpenAPI socket, and the book rows are about the undocumented `cws` depth socket.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one market socket and one order socket for futures, S1 and S3 | no book on the documented socket. On `cws` the depth path carries one depth subscription per socket |
| subscribe frame shape | `{"op": "sub", "channel": "tickers", "symbol": "BTC-USDT"}`, one symbol per frame, S1 | `cws` depth takes `{"subs": [{…}], "unSubs": []}`. A frame with four depth subscriptions got four acks and delivered only the last one. A frame with BTC, ETH and SOL delivered only SOL, and a later frame with PLTR replaced SOL, in both runs |
| unknown symbol expectation | Not publicly specified | `oapi` `tickers` on `NOPE-USDT` answers errno 0 success. `cws` depth on `NOPE-USDT` answers `"msg":"Subscription failed","code":"2"` and sends nothing |
| chunk unit and budget | "10 requests / 10s" per WebSocket subscription call, S5 | 20 `cws` depth sockets opened two a second from this host were all accepted, and no cap was reached |
| keepalive mechanism | Not publicly specified | no server ping on any socket. The web app sends the Unix time in seconds as a bare text frame every 5 s, and `cws` echoes the same number back. `oapi` answers `{"op": "ping"}` with errno `51000` |
| connection lifetime and maintenance notice | Not publicly specified | a socket that neither subscribes nor sends closes at 30.7 to 30.9 s with 1006. A subscribed socket, the echo every 5 s, or a protocol ping every 10 s kept a socket open for 110 s in the first run and 40 s in the rerun. No lifetime cap and no maintenance frame was seen |
| handshake and operation rate limits | "10 requests / 10s" for each WebSocket subscription, and a global 100 requests per 10 s per API key, S5 | no refusal. The probe stayed under the published rate |
| public market data authentication | none | none on either host |
| message parse and routing | `{"channel", "symbol", …}` pushes, S1 | `cws` routes on `type` and `data.symbol`. `oapi` routes on `channel` and `symbol` |
| subscribe acknowledgement shape | `{"errno": 0, "errmsg": "success", "op": "sub", "channel", "symbol"}`, S1 | `oapi` acks without `symbol`: `{"op":"sub","errno":0,"channel":"tickers","errmsg":"success"}`. `cws` acks with the request echoed as a JSON string in `data`, `"msg":"Subscription succeeded","code":"1"` |
| symbol identifier format | `BTC-USDT` | the same string on both sockets and in every REST call, including three symbols in Chinese characters, `币安人生-USDT`, `哈基米-USDT` and `牛来-USDT` |
| number representation | strings, `price` of `trade` a number in the example, S2 | `cws` depth sends every number as a string. `oapi` `trade` sends `price` as a string, unlike the example |
| timestamp representation | `ts` in ms, S1 | `oapi` `tickers` sends `ts` in seconds, so its age reads 166 to 1,272 ms. `trade` and `cws` depth send ms |
| size unit | contracts, S1 | `number` is contracts, and `numberConvert` equals `number` times `contract_size` on every entry checked, section 4 |
| sequence semantics | Not publicly specified | none. A depth frame carries `asks`, `bids`, `symbol` and `ts` only, with no update id and no checksum |
| idle repeat behaviour | Not publicly specified | 2 of 142 ETH frames in the first run changed nothing, and 0 frames in the rerun. A quiet book still sent a frame about every 200 to 290 ms |

## 4. The book channel in detail

Everything in this section is about type 1 on `wss://cws.websea.com/ws/realTime_depth?compress=0`, at `level` 50 and at the merge step the web app marks as default.
The default step comes from `https://capi.websea.com/webApi/market/getSymbolDepth?symbol=…`, and it was `0.1` for BTC, `0.01` for ETH and PLTR, and `0.001` for LAPTOP, the finest step listed and equal to the price tick.

### Gears

A level is keyed by `gear`, its position on its side counted from the touch, and not by price.
Gear 1 is the best bid or the best ask, gear 2 the next price that has size, and so on to gear 50.
Empty prices get no gear: on LAPTOP gear 10 was `0.082` and gear 11 was `0.084`, and bid gear 42 sat at `0.001`.
When a level leaves or enters near the touch, every gear behind it changes, so the server resends the shifted gears.
A median of 48 and 52 entries per BTC frame, and 52 and 97 per ETH frame, is the result.
An entry whose `number` is `"0"` deletes its gear, which happens when a side shrinks, as in the capture in section 6.
The web app applies a frame the same way: a map keyed by gear, set or delete, then sort by gear, S4.

### Snapshot on subscribe

None is guaranteed.
The first frame after the acknowledgement is whatever the server pushes next, and it can hold a full side, part of a side, or one entry.

| run | contract | first frames after subscribe | both sides complete after |
|---|---|---|---|
| first | BTC | asks 2 gears 9 to 11, bids 48 gears 1 to 50 | 1,056 ms, frame 3 |
| first | ETH | asks none, bids 1 gear, twice | 1,491 ms, frame 5 |
| first | PLTR | 50 and 50, gears 1 to 50 | 201 ms, frame 1 |
| first | LAPTOP | bids 1 gear, then 50 asks and 42 bids | 217 ms, frame 2 |
| rerun | BTC | asks 4 gears 2 to 9, bids 50 | 2,992 ms, frame 11 |
| rerun | ETH | asks 48 entries over gears 1 to 50, bids 50 | 1,329 ms, frame 4 |
| rerun | PLTR | 50 and 50 | 199 ms, frame 1 |
| rerun | LAPTOP | 50 asks and 42 bids | 220 ms, frame 1 |

A side counts as complete when one frame carries every gear from 1 to its last.
Such full sides recur because every shift resends the tail: 34 full ask sides and 28 full bid sides in 148 BTC frames in the first run, and 5 and 10 in 184 LAPTOP frames in the rerun.
In the batch of 20 contracts, the first frame carried at least one full side on 18 and on 19 of them.
The web app seeds the book from a REST call before it subscribes, S4, and `/v1/futures/depth_merged` returns the same gear keyed levels, see [`rest.md`](./rest.md) section 5.
There is no id to align that REST reply with the stream.

### Delta semantics and sequence

| check, over 45 s on four contracts | first run | rerun |
|---|---|---|
| frames with a gear hole after both sides were complete | BTC 2, ETH 1, others 0 | 0 |
| frames whose entries were out of gear order | not measured | 0 |
| frames leaving a side out of price order | 0 | 0 |
| frames leaving the book crossed or locked | 0 | 0 |
| gears held at the end, asks and bids | 50 and 50, and LAPTOP 50 and 42 | the same, contiguous |
| top 10 gears per side equal to `depth_merged` read right after | 20 of 20 on all four | 20 of 20 on all four |

There is no update id, no previous id and no checksum, so a lost or reordered frame cannot be detected.
The only checks a feed has are a hole in the gears, a side out of order, a crossed book, and a periodic compare with `depth_merged`.

### Cadence and timestamps

| contract | frames in 45 s | inter-arrival median | p90 | max | `ts` age at arrival, min to max |
|---|---|---|---|---|---|
| BTC | 148 and 161 | 201 and 201 ms | 601 and 603 ms | 959 and 800 ms | 89 to 341 ms |
| ETH | 142 and 152 | 201 and 202 ms | 666 and 621 ms | 901 and 968 ms | 90 to 837 ms |
| PLTR | 75 and 94 | 285 and 288 ms | 1,812 and 1,305 ms | 2,006 and 2,005 ms | 89 to 272 ms |
| LAPTOP | 180 and 184 | 215 and 211 ms | 362 and 370 ms | 557 and 627 ms | 89 to 415 ms |

Frames come on a grid of about 200 ms.
`ts` is Unix ms and never went backwards.
Its age never fell below 89 ms, which is the one-way delay plus any clock offset, see [`rest.md`](./rest.md) section 7.

### Level order and window

Within a frame, entries were in ascending gear order on both sides on every frame of the rerun.
After applying, asks ascend and bids descend by price with no repeated price, on every frame of both runs.
`level` 20 delivered 20 gears a side, and `level` 100 and 200 were acked and delivered at most gear 50, in both runs of `errors`.

### Size unit against the contract size

| contract | `contract_size` | touch in the rerun | coins |
|---|---:|---|---|
| BTC-USDT | 0.001 | bid `86750.6`, `number` `"506"`, `numberConvert` `"0.506"` | 0.506 BTC |
| ETH-USDT | 0.01 | bid `2776.89`, `number` `"1750"`, `numberConvert` `"17.50"` | 17.5 ETH |
| LAPTOP-USDT | 1 | bid `0.071`, `number` `"219"`, `numberConvert` `"219"` | 219 LAPTOP |

`number` is contracts, `numberConvert` is coins, and `numberConvertU` is USDT.
`numberConvert` equalled `number` times `contract_size` on all 18,537 entries of the first run and all 26,292 of the rerun.
With no CCXT class, a Websea catalog has to set the contract size from `contract_size` of `/v1/futures/symbols`, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

LAPTOP held 50 asks and 42 bids, with the last bid at `0.001`, so a side shorter than 50 is normal on thin contracts.
No empty side was seen, so what the socket sends for one is Not verified.

### Unknown, closed and wrong symbols

| request on the depth socket | reply | then |
|---|---|---|
| `NOPE-USDT` | `"msg":"Subscription failed","code":"2"` | nothing |
| ETH at depth `0.0001`, not a listed step | success | 50 and 50 gears, and 47 and 45 in the rerun |
| PLTR with no `depth` field | `Subscription failed`, code 2 | nothing |
| `type` 99 | no reply | nothing |
| the same LAPTOP subscription twice | success twice | one stream |
| text `not json` | `{"data":"not json","msg":"Subscription failed","code":"2"}` | the socket stays open |

On the documented socket, `tickers` on `NOPE-USDT` is acknowledged as success, an unknown `op` answers errno `51000`, and a non-JSON text frame closes the socket with 1006.
A closed or delisted contract was not available to probe.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | the web app sends `Math.round(Date.now() / 1000)` as text every 5 s on each `cws` socket, S4, and the server echoes it, for example `1790135421`. A protocol ping is answered with a pong |
| silence the server tolerates | Not publicly specified | 30.7 to 30.9 s for a socket that neither subscribes nor sends, on `cws` and `oapi`, four sockets over two runs, close code 1006 with no close frame |
| forced disconnect | Not publicly specified | none in 110 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | the server never negotiated permessage-deflate on either host. With `compress=1` every frame is a text frame whose characters are the bytes of a gzip stream, starting `1f 8b 08` and carried as UTF-8 code points, 27 frames of 49,590 bytes on the wire that decode to 166,068 bytes of JSON in 8 s |
| handshake | | 735 to 1,205 ms to open from this host |
| subscription limits | "10 requests / 10s" per subscription call, S5 | one depth subscription per `cws` depth socket, since a later one replaces it. Type 8 accepted 246 subscriptions in one frame on one socket |
| throughput | | 20 depth sockets, one perpetual each, every twelfth by 24 h volume: 40.9 and 40.4 frames a second, 193 and 179 KB a second, 4.8 and 4.5 KB a frame, 98 and 100 µs `JSON.parse` a frame. Type 8 on all 246: 240 frames and 194 KB a second |

The gzip inside a text frame is the web app's choice and can be avoided with `compress=0`, which is what this profile recommends.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays cut to two entries are marked in the text.

Depth subscribe and acknowledgement.

```json
{"subs": [{"symbol": "BTC-USDT", "depth": "0.1", "level": 50, "type": 1, "version": 1}], "unSubs": []}
```

```json
{"data":"{\"depth\":\"0.1\",\"level\":50,\"symbol\":\"BTC-USDT\",\"type\":\"1\",\"version\":1}","msg":"Subscription succeeded","code":"1"}
```

A depth frame, two entries kept per side.
There is no snapshot flag and no id.

```json
{"type":1,"data":{"asks":[{"gear":"2","number":"1390","numberConvert":"1390","numberConvertU":"102.8600","price":"0.074"},{"gear":"3","number":"1206","numberConvert":"1206","numberConvertU":"90.4500","price":"0.075"}],"bids":[{"gear":"2","number":"1229","numberConvert":"1229","numberConvertU":"86.0300","price":"0.070"},{"gear":"4","number":"777","numberConvert":"777","numberConvertU":"52.8360","price":"0.068"}],"symbol":"LAPTOP-USDT","ts":1790135230261}}
```

A one-sided frame on BTC.

```json
{"type":1,"data":{"asks":[{"gear":"8","number":"1438","numberConvert":"1.438","numberConvertU":"124689.9866","price":"86710.7"},{"gear":"9","number":"2754","numberConvert":"2.754","numberConvertU":"238801.5432","price":"86710.8"}],"bids":[],"symbol":"BTC-USDT","ts":1790135216009}}
```

The entry that deleted bid gear 42 of LAPTOP, from a frame with 3 asks and 36 bids.

```json
{"gear":"42","number":"0","numberConvert":"0","numberConvertU":"0.0000","price":"0.001"}
```

Keepalive: the client sends a bare number and gets the same number back.

```text
1790135421
```

Errors.

```json
{"data":"{\"depth\":\"0.1\",\"level\":50,\"symbol\":\"NOPE-USDT\",\"type\":\"1\",\"version\":1}","msg":"Subscription failed","code":"2"}
```

```json
{"channel":"depth","errmsg":"WS channel unavailable.","errno":50009,"op":"sub"}
```

Symbol detail, type 8, most fields kept.

```json
{"type":8,"data":{"capitalRate":"0.0043","faceValue":"0.01","indexPrice":"1657.14","indexSource":"Binance、HUOBI、OKEX、Bitfinex、Coinbase、Bitstamp","markerPrice":"1657.06","newPrice":"1656.99","pricePrecision":2,"serviceRate":"Maker:100%/Taker:100%","settlementTime":"00:00/08:00/16:00","symbol":"OPENAI-USDT","warningRiskRate":"90"}}
```

Documented socket, ticker and trade.

```json
{"symbol":"BTC-USDT","high":"86916.1","vol":"2452036696.2795","low":"85082","channel":"tickers","ask":"86748.7","vol_ccy":"28506.214","bid":"86748.6","close":"86748.6","open":"85449","ts":1790135317}
```

```json
{"symbol":"LAPTOP-USDT","amount":"20","price":"0.073","channel":"trade","id":1790135317068307,"deal_amount":"20","direction":"sell","ts":1790135317068}
```

## 7. Private channels

Named for a future execution stage, not probed.

- `wss://oapi.websea.com/ws/v1/futures/order`, channel `order`, subscribed with `token`, `Nonce` and `Signature` fields, S3.
- The web app's `cws` market socket subscribes types 2, 11 and 16 with a session token, S4.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
It depends on an undocumented socket, which Websea can change without notice.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://cws.websea.com/ws/realTime_depth?compress=0`, one socket per market, 246 sockets for the whole catalog | a later depth subscription on a socket replaces the earlier one |
| subscribe frame | `{"subs": [{"symbol": <rawMarketId>, "depth": <finest step>, "level": 50, "type": 1, "version": 1}], "unSubs": []}` | the finest step is the price tick, so gears are plain price levels |
| finest step | the last row of `getSymbolDepth`, or `10^-price` from `/v1/futures/symbol_precision` | the web app default equalled the price precision on the four contracts read |
| keepalive | the Unix time in seconds as text every 5 s | what the web app does, the echo counts as traffic |
| `maxSilenceMs` | 10,000 | frames come every 200 ms even on a quiet book, the longest gap seen was 2,006 ms, and the echo arrives every 5 s |
| book model | keep a gear map per side, set or delete per entry, then publish the side in gear order with `resetBook` | positional deltas cannot go through `setBid` and `setAsk` by price |
| seed | read `/v1/futures/depth_merged` at the same step before trusting the stream, or wait for a frame that completes both sides | no snapshot is guaranteed on subscribe |
| resync | a gear hole, a side out of order or a crossed book: `resync` | there is no sequence rule to check |
| audit | compare the top gears with `depth_merged` now and then | the only integrity check available |
| receive time | stamp on arrival | `ts` ages 89 to 837 ms at arrival |
| sizes | `Number(number)` times `contract_size` | `number` is contracts |
| compression | keep `compress=0` and `perMessageDeflate: false` | `compress=1` hides gzip inside text frames |

At the batch rate, 246 sockets would carry about 500 frames and about 2.3 MB a second, and cost about 50 ms of `JSON.parse` a second on the event loop.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Websea Open Interface, WebSocket 24-Hour Ticker Channel, futures | https://webseaex.github.io/en/futures-market/ws-24hr/ | 2026-09-22 | Websea, global | sections 1 to 3 |
| S2 | Websea Open Interface, WebSocket Trade Channel and Kline Channel, futures | https://webseaex.github.io/en/futures-market/ws-trade/ | 2026-09-22 | Websea, global | sections 2, 3 |
| S3 | Websea Open Interface, WebSocket Order and Trade Updates, futures | https://webseaex.github.io/en/futures-trade/ws-order/ | 2026-09-22 | Websea, global | sections 1, 7 |
| S4 | Websea web app bundles, `/assets/static/js/44.cf742c67a98b95ac49d2.js` and the futures chunks 36 and 51 | https://www.websea.com/assets/static/js/44.cf742c67a98b95ac49d2.js | 2026-09-22 | Websea, global | the `cws` URLs, subscribe shape, type codes, keepalive, gzip decoding, gear map, REST seed, sections 1 to 8 |
| S5 | Websea Open Interface, Rate Limiting Rules | https://webseaex.github.io/en/about/limit/ | 2026-09-22 | Websea, global | sections 3, 5 |
| P1 | `ws-probe.mjs book`, runs at 03:34 and 03:46 UTC, plus an earlier book run at 03:33 UTC with four subscriptions on one socket | [`ws-probe.mjs`](../../../scripts/probes/venues/websea/ws-probe.mjs) | 2026-09-22 | this host | sections 3, 4, 6 |
| P2 | `ws-probe.mjs mark`, `oapi`, `errors`, `compress` and `deflate`, runs at 03:35 to 03:37 and 03:47 to 03:49 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/websea/ws-probe.mjs) | 2026-09-22 | this host | sections 2 to 6 |
| P3 | `ws-probe.mjs silence` at 03:38 UTC for 110 s, and rerun at 03:50 UTC for 40 s | [`ws-probe.mjs`](../../../scripts/probes/venues/websea/ws-probe.mjs) | 2026-09-22 | this host | sections 3, 5 |
| P4 | `ws-probe.mjs batch` at 03:40 and 03:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/websea/ws-probe.mjs) | 2026-09-22 | this host | sections 3, 4, 5 |
