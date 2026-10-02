# Coinone WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:23 to 03:34 UTC), from the development host near Seattle.

This profile covers the public WebSocket of Coinone (CCXT id `coinone`), whose only market is KRW spot, with the `ORDERBOOK` channel in detail.
Coinone lists no perpetual, so the spot book is profiled as template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/coinone/ws-probe.mjs) in two runs, and the capture is quoted beside the documented value.
The first run started at 03:23 UTC and the second at 03:29 UTC.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| KRW spot, public | `wss://stream.coinone.co.kr`, S1, and CCXT Pro at `server/node_modules/ccxt/js/src/pro/coinone.js` line 27 | open in 669 to 718 ms on the 14 sockets that logged it, all 363 KRW pairs delivered on one socket |
| private | `wss://stream.coinone.co.kr/v1/private`, S6 | not probed |

One URL serves every pair, and there is no family split.
`stream.coinone.co.kr` is a CNAME for an AWS load balancer in `ap-northeast-2` (Seoul), `k8s-interfac-openwebs-28e8807527-515518576.ap-northeast-2.elb.amazonaws.com`, which resolved to `13.209.171.175` and `54.180.225.242`, see [`rest.md`](./rest.md) section 1.
The socket is not behind Cloudflare, unlike the REST host.
On open the server sends one frame before any request: `{"response_type":"CONNECTED","data":{"session_id":"…"}}`.

## 2. Channel matrix for public market data

| channel | topic | depth and speed | probed on 2026-09-23 UTC |
|---|---|---|---|
| `ORDERBOOK` | `quote_currency`, `target_currency` | the whole book of 16 levels per side, pushed on every change, S2 | 16 bids and 16 asks in every frame, recommended |
| `TICKER` | `quote_currency`, `target_currency` | on change, S3 | 68 and 58 frames on BTC in about 69 s, carries `ask_best_price`, `ask_best_qty`, `bid_best_price`, `bid_best_qty` and 24 h statistics |
| `TRADE` | `quote_currency`, `target_currency` | on trade, S4 | 103 and 55 frames on BTC in about 69 s |
| `CHART` | `quote_currency`, `target_currency`, `interval` from `1m` to `1w` | on change, S5 | 67 and 57 frames on BTC at `1m` in about 69 s |
| any channel with `"format":"SHORT"` | | same content with one to three letter keys, S1 | a BTC book frame shrank from about 1,466 to a median of 1,204 bytes |

The public WebSocket page lists `ORDERBOOK`, `TICKER` and `TRADE`, S1, and `CHART` has its own reference page and changelog entry, S5.
No mark, index or funding channel exists, because Coinone has no derivative.
No dedicated best bid and offer channel exists, and the `TICKER` frame carries the touch.
The one `TICKER` frame captured after a trade carried that trade's `timestamp` and `id`, so the channel appears to be trade-driven, and the book channel is the source for the touch.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URI for all pairs, S1 | one socket carried all 363 KRW pairs |
| subscribe frame shape | `{"request_type":"SUBSCRIBE","channel":"ORDERBOOK","topic":{"quote_currency":"KRW","target_currency":"XRP"}}`, one topic per frame, S2 | as documented. 363 frames sent in 2 to 4 ms were each acknowledged |
| unknown symbol expectation | error `160012` `Invalid Topic`, S1 | `NOPE` is first acknowledged with `SUBSCRIBED`, and 0 to 3 ms later an `ERROR` `160012` arrives that names no topic. A `USDT` quote does the same |
| chunk unit and budget | one topic per frame, and no per connection topic cap is published | 363 topics on one socket, all acknowledged, first book frames within 1,027 ms and 1,150 ms in the two runs, no error |
| keepalive mechanism | client sends `{"request_type":"PING"}`, server answers `{"response_type":"PONG"}`. The server closes a connection 30 minutes after the last `PING`, S1 and S7 | `PONG` in 167 to 214 ms. No server protocol ping on any socket. A socket that never subscribed and never sent closed at 60.7 s in both runs |
| connection lifetime and maintenance notice | "existing connections may be closed when the WebSocket is updated", with no notice message, S1 | no close and no notice in 120 s |
| handshake and operation rate limits | at most 20 connections per IP, and the 21st is closed with code `4290`, S1 | not tested, since the probe held three sockets at most. 363 subscribe frames in one burst were not refused |
| public market data authentication | none, S1 | none |
| message parse and routing | `{response_type, channel, data}`, S2 | route on `channel` and `data.target_currency`. `quote_currency` is always `KRW` |
| subscribe acknowledgement shape | `{"response_type":"SUBSCRIBED","channel":"ORDERBOOK","data":{"quote_currency":"KRW","target_currency":"XRP"}}`, S2 | identical, 168 to 171 ms after the subscribe, and before the pair's first book frame on every pair in both runs. The ack echoes the topic as sent, lower case included |
| symbol identifier format | two fields, `quote_currency` `KRW` and `target_currency` `BTC` | the socket spells the base in upper case even when it was subscribed in lower case. CCXT `market.id` is a numeric ticker id, not this, and CCXT `baseId` matches `target_currency` on 363 of 363 pairs, see [`rest.md`](./rest.md) section 2 |
| number representation | `price` and `qty` strings, S2 | strings in every frame. `id` is a string of digits, `timestamp` a JSON number |
| timestamp representation | `timestamp` in ms, S2 | arrival minus `timestamp` had a median of 87 to 91 ms. The frame sent on subscribe carried a `timestamp` 10.1 to 10.2 s old, section 4 |
| size unit | base currency quantity, "매도 수량", S2 | base coins, and the socket book equalled the REST book level for level at the same `id`, section 4 |
| sequence semantics | "a larger id is a newer order book", S2 | `id` rose strictly on every pair except once, when a second subscribe to BTC repeated the current book with the same `id`. The ids are not consecutive, so no gap can be detected, and none needs to be, section 4 |
| idle repeat behaviour | not documented | frames with 16 identical levels and a new `id`: 58 of 285 BTC frames in the second run. A quiet pair went 32.3 s and 17.7 s without a frame |

## 4. The book channel in detail

`ORDERBOOK` in the default format is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The documentation says the server sends the latest order book once on subscribe and then a frame on every change, S2.
The wire agrees.
The acknowledgement came 168 to 171 ms after the subscribe frame, and the first book frame 170 to 330 ms after it, on BTC, XRP, DOGE and TNSR in both runs.
In the 363 pair batch every pair received a book frame, the last one 1,027 ms and 1,150 ms after the burst of subscribes.

The `timestamp` of that first frame is not the book's time.
It read 10.1 to 10.2 s before arrival on every one of the four pairs in both runs, and the four pairs subscribed together carried the same `timestamp` to within 3 ms.
Its `id` was newer than that `timestamp` for BTC, XRP and DOGE, and for TNSR it was newer in one run and 7.7 s older in the other.
Every later frame captured, three per pair and run, had `timestamp` equal to the time part of its `id`, and the frames arrived 87 to 91 ms after `timestamp` at the median.
A feed stamps each frame on arrival and never reads `timestamp`.

### Delta semantics

There are none.
Every frame carries the whole top of book, 16 bids and 16 asks, and replaces the previous frame.
16 levels per side appeared in every frame on the four pairs over both runs: 298 and 285 BTC frames, 238 and 108 XRP, 178 and 145 DOGE, 5 and 5 TNSR.
CCXT Pro handles the channel the same way, and calls `orderbook.reset()` on every frame at `server/node_modules/ccxt/js/src/pro/coinone.js` line 118.

### Sequence and gap rule

```text
id > last        replace the book with the frame, last = id
id = last        a repeat of the current book after a second subscribe: drop it
id < last        not observed: drop it
```

The `id` is the frame's millisecond time followed by a three digit counter, as in `1790134177753001`.
It is not consecutive, so a lost frame cannot be seen, and it does not need to be, because the next frame carries the whole book.
The one repeated `id` in each run came with the duplicate BTC subscribe the probe sends on purpose.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| socket, every frame | best first, descending, on every frame of both runs | worst first, descending, so the best ask is the last element, on every frame of both runs |
| REST `orderbook` | best first, descending | best first, ascending |

The documentation's own example shows the socket asks descending, S2.
The engine's `OrderBook.reset` inserts each level through `setLevel`, which keeps its own order, at [`OrderBook.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/OrderBook.ts) line 17, so a feed passes the arrays as they come.

### Level window

The window is 16 levels per side, fixed, with no deeper option on the socket.
The REST book also stops at 16, with `size` limited to 5, 10, 15 or 16, see [`rest.md`](./rest.md) section 5.
The engine holds 20 levels per side by default, `DEPTH_LEVELS` at [`ClusterIndexBuilder.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/ClusterIndexBuilder.ts) line 17, so a Coinone book would fill 16 of them.

### Size unit against CCXT `contractSize`

| pair | CCXT `contractSize` | socket size at the touch | REST size at the same `id` | unit |
|---|---:|---|---|---|
| `BTC`, first run | undefined | bid `"0.00006868"` at 116,470,000 | `"0.00006868"` | BTC |
| `BTC`, second run | undefined | bid `"0.0159"` at 116,460,000 | `"0.0159"` | BTC |

Sizes are base coins, since this is spot.
CCXT sets `contractSize` to undefined for every market at `server/node_modules/ccxt/js/src/coinone.js` line 438, and the connector turns that into 1, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 175.
In both runs the last socket frame and a REST read carried the same `id`, `1790133830889001` and `1790134217263001`, and all 16 bid and 16 ask levels were equal in price and size.

### One-sided and empty books

None was seen.
The quietest pair probed, `TNSR`, still carried 16 levels a side, with a best bid of 49.6 and a best ask of 65.2 KRW, a spread of about 27 % of the mid, and bids reaching down to 0.2404 KRW.
The REST ticker reply showed a best bid and a best ask on all 363 pairs, see [`rest.md`](./rest.md) section 4.
What the socket sends for a side with no orders is Not verified.
The engine's `resetBook` accepts an empty side.

### Idle repeats

A frame can repeat the previous 16 levels exactly with a new `id`.
That happened on 58 of 285 BTC frames, 7 of 108 XRP and 8 of 145 DOGE in the second run, presumably when a level beyond the 16 changed.
The first run counted 48, 5 and 5 such repeats, BTC's count including its one same-`id` repeat.
Nothing is resent on a timer: TNSR went 32.3 s and 17.7 s between frames in the two book runs, and sent 17 and 16 frames in the 120 s silence runs.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `ORDERBOOK` `KRW`/`NOPE` | `SUBSCRIBED` echoing `NOPE`, then `{"response_type":"ERROR","error_code":160012,"message":"Invalid Topic"}` 0 to 3 ms later | nothing |
| `ORDERBOOK` `USDT`/`BTC` | `SUBSCRIBED`, then `160012` `Invalid Topic` 1 to 10 ms later | nothing |
| `ORDERBOOK` `krw`/`eth` in lower case | `SUBSCRIBED` echoing `krw` and `eth` | 161 book frames in the second run, spelled `KRW` and `ETH` |
| `request_type` `subscribe` in lower case | `160011` `Invalid Type`, `"field":"request_type"` | |
| channel `NOPE` | `160011` `Invalid Type`, `"field":"channel"` | |
| `format` `short` in lower case | `160011` `Invalid Type`, `"field":"format"` | |
| text that is not JSON | `160010` `Invalid Request` | the socket stays open |
| `ORDERBOOK` `BTC` a second time | `SUBSCRIBED` again | one repeat of the current book with the same `id`, and no doubled stream afterwards |
| `UNSUBSCRIBE` `XRP` | `{"response_type":"UNSUBSCRIBED","channel":"ORDERBOOK","data":{"quote_currency":"KRW","target_currency":"XRP"}}` | no XRP frame afterwards |

The error frame names neither the channel nor the topic, so a feed that subscribes many pairs cannot tell which one failed from the error alone.
A closed or suspended pair was not available to probe, since all 363 pairs had `trade_status` 1 and `maintenance_status` 0.
The socket stayed open after every error.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | `{"request_type":"PING"}`, answered by `{"response_type":"PONG"}`. CCXT Pro pings every 20,000 ms, at `pro/coinone.js` line 48 | `PONG` in 168, 167 and 168 ms, then 167, 214 and 169 ms |
| silence the server tolerates | 30 minutes after the last `PING`, or after connecting when no request follows, S1 and S7 | a socket that neither subscribed nor sent anything closed at 60,710 and 60,716 ms with code 1006 and no close frame. A socket subscribed to BTC or to TNSR that never sent `PING` was still open at 120 s in both runs. The 30 minute rule itself was not tested |
| forced disconnect | possible on a WebSocket update, S1 | none in the sockets held, the longest 120.8 s |
| maintenance notice | none documented | none observed |
| compression | not documented | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back in two runs, so the server does not negotiate it |
| handshake | | 669 to 718 ms to open from this host |
| subscription limits | 20 connections per IP, close code `4290`, S1 | not tested. 363 topics on one socket were accepted |
| throughput | | 363 KRW pairs on one socket for 60 s: 189 and 234 frames per second, median 183 and 228 per second after the first 10 s, peak 268 and 269, 246 and 304 KB per second, 1,336 and 1,331 bytes per frame, largest frame 1,546 bytes, 31.1 and 28.7 µs `JSON.parse` per frame. 106 and 92 pairs sent only their first frame in 60 s |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays marked `"…"` are cut, which leaves the frames valid JSON.

Connected, sent by the server on open.

```json
{"response_type":"CONNECTED","data":{"session_id":"6f3e1d0f-f9ab-f300-1567-0eb31af6d6ef"}}
```

Subscribe and acknowledgement.

```json
{"request_type":"SUBSCRIBE","channel":"ORDERBOOK","topic":{"quote_currency":"KRW","target_currency":"BTC"}}
```

```json
{"response_type":"SUBSCRIBED","channel":"ORDERBOOK","data":{"quote_currency":"KRW","target_currency":"BTC"}}
```

First book frame after the subscribe, whose `timestamp` is 10 s older than its `id`.
The asks run from worst to best, and the bids from best to worst.

```json
{"response_type":"DATA","channel":"ORDERBOOK","data":{"quote_currency":"KRW","target_currency":"BTC","timestamp":1790134167554,"id":"1790134177435001","asks":[{"price":"116650000","qty":"0.01198956"},{"price":"116640000","qty":"0.000657"},"…",{"price":"116470000","qty":"0.00171821"},{"price":"116460000","qty":"0.0232"}],"bids":[{"price":"116450000","qty":"0.0118"},{"price":"116440000","qty":"0.04695328"},"…",{"price":"116250000","qty":"0.01325806"}]}}
```

The next frame, a whole book again, with `timestamp` equal to the time part of `id`.

```json
{"response_type":"DATA","channel":"ORDERBOOK","data":{"quote_currency":"KRW","target_currency":"BTC","timestamp":1790134177753,"id":"1790134177753001","asks":[{"price":"116650000","qty":"0.01198956"},{"price":"116640000","qty":"0.000657"},"…",{"price":"116470000","qty":"0.00171821"},{"price":"116460000","qty":"0.0232"}],"bids":[{"price":"116450000","qty":"0.0118"},{"price":"116440000","qty":"0.04695328"},"…",{"price":"116250000","qty":"0.01325806"}]}}
```

The same frame in the `SHORT` format.

```json
{"r":"DATA","c":"ORDERBOOK","d":{"qc":"KRW","tc":"BTC","t":1790134177753,"i":"1790134177753001","a":[{"p":"116650000","q":"0.01198956"},"…",{"p":"116460000","q":"0.0232"}],"b":[{"p":"116450000","q":"0.0118"},"…"]}}
```

A quiet book on subscribe, with a spread of 27 % of the mid.

```json
{"response_type":"DATA","channel":"ORDERBOOK","data":{"quote_currency":"KRW","target_currency":"TNSR","timestamp":1790134167557,"id":"1790134159857001","asks":[{"price":"145","qty":"302.41330495"},{"price":"125.6","qty":"2266.48031691"},"…",{"price":"65.25","qty":"11000"},{"price":"65.2","qty":"107.20953328"}],"bids":[{"price":"49.6","qty":"8000"},{"price":"49.59","qty":"665.4567453"},"…",{"price":"0.2404","qty":"74624.25644758"}]}}
```

Keepalive.

```json
{"request_type":"PING"}
```

```json
{"response_type":"PONG"}
```

Errors.

```json
{"response_type":"ERROR","error_code":160012,"message":"Invalid Topic"}
```

```json
{"response_type":"ERROR","error_code":160011,"message":"Invalid Type","field":"request_type"}
```

```json
{"response_type":"ERROR","error_code":160010,"message":"Invalid Request"}
```

Ticker and trade.

```json
{"response_type":"DATA","channel":"TICKER","data":{"quote_currency":"KRW","target_currency":"BTC","timestamp":1790133796484,"quote_volume":"30947007404.5912","target_volume":"267.27610034","high":"116470000","low":"115570000","first":"115650000","last":"116380000","volume_power":"0","ask_best_price":"116400000","ask_best_qty":"0.00562817","bid_best_price":"116370000","bid_best_qty":"8.60554308","id":"1790133796484001","yesterday_high":"117140000","yesterday_low":"114430000","yesterday_first":"117130000","yesterday_last":"115640000","yesterday_quote_volume":"57912858642.8004","yesterday_target_volume":"504.17975762"}}
```

```json
{"response_type":"DATA","channel":"TRADE","data":{"quote_currency":"KRW","target_currency":"BTC","id":"1790134177835001","timestamp":1790134177835,"price":"116460000","qty":"0.00483595","is_seller_maker":true}}
```

## 7. Private channels

Named for a future execution stage, from S6, not probed.

- The private socket is `wss://stream.coinone.co.kr/v1/private`, and it needs an authenticated session.
- Its channels are `MYORDER` and `MYASSET`, with their own `PING` page, S6.

## 8. Recommended feed shape

A recommendation for a later spot design, not a decision, since Coinone cannot join the engine as a perpetual leg.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://stream.coinone.co.kr` | one socket serves every pair |
| markets per connection | all 363 KRW pairs on one socket, or two slices of about 180 for headroom | 363 pairs ran at up to 269 frames per second with no error, and the cap is 20 connections per IP |
| subscribe frames | one object per market, `{"request_type":"SUBSCRIBE","channel":"ORDERBOOK","topic":{"quote_currency":"KRW","target_currency":"<base>"}}` | one topic per frame, and the base class sends each object as JSON |
| keepalive | `{"request_type":"PING"}` every 20 s | the server sends no ping, the documented idle rule counts from the last `PING`, and the `PONG` is traffic for the silence watch |
| `maxSilenceMs` | 60,000 | three missed `PONG`s, and a quiet pair went 32.3 s without a book frame |
| routing | `data.target_currency` is the key | the socket spells the base in upper case |
| `rawMarketId` | the CCXT `baseId`, not `market.id` | CCXT `market.id` is a numeric ticker id that changes between loads and collides across pairs, see [`rest.md`](./rest.md) section 2. This is the one named change for a spot design |
| snapshot | every frame: `resetBook` with the 16 bids and 16 asks as they arrive | each frame is the whole book |
| order | pass the arrays as they come | the asks arrive worst first, and `OrderBook` orders levels itself |
| resync | none on sequence. Drop a frame whose `id` is not above the last one | the ids are not consecutive, and the next frame repairs any loss |
| unserved pair | log a pair with no frame 5 s after its `SUBSCRIBED`, and log every `ERROR` frame | an unknown pair is acknowledged before the error, and the error names no topic |
| receive time | stamp on arrival, never from `timestamp` | the first frame's `timestamp` is about 10 s old |
| depth | accept 16 levels | the socket offers no deeper book |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

The weak point for arbitrage is not the protocol but the market: KRW is outside the engine's USD, USDC and USDT quote family, and about 29 % of the pairs had no trade in 24 h, see [`rest.md`](./rest.md) section 4.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Public 웹소켓 (public WebSocket), page updated 2026-09-08 | https://docs.coinone.co.kr/reference/public-websocket-1 | 2026-09-22 | Coinone | URI, request fields, `SHORT` format, 20 connections per IP and close code `4290`, 30 minute idle rule, update disconnects, error codes, sections 1 to 5 |
| S2 | 오더북 응답 (ORDERBOOK) | https://docs.coinone.co.kr/reference/public-websocket-orderbook | 2026-09-22 | Coinone | snapshot on subscribe then on change, fields and short keys, `id` rule, example frames, sections 2 to 4 |
| S3 | 티커 응답 (TICKER) | https://docs.coinone.co.kr/reference/public-websocket-ticker | 2026-09-22 | Coinone | ticker fields, section 2 |
| S4 | 체결정보 응답 (TRADE) | https://docs.coinone.co.kr/reference/public-websocket-trade | 2026-09-22 | Coinone | trade fields, section 2 |
| S5 | 차트 응답 (CHART) and the changelog on chart support | https://docs.coinone.co.kr/reference/public-websocket-chart | 2026-09-22 | Coinone | chart channel and intervals, section 2 |
| S6 | Private 웹소켓 | https://docs.coinone.co.kr/reference/private-websocket-1 | 2026-09-22 | Coinone | private URL and channel names, section 7 |
| S7 | 커넥션 관리 (PING) | https://docs.coinone.co.kr/reference/public-websocket-ping | 2026-09-22 | Coinone | `PING` and `PONG`, session closes 30 minutes after connecting without a request, section 5 |
| S8 | CCXT Pro 4.5.68 `coinone.js` | `server/node_modules/ccxt/js/src/pro/coinone.js` | 2026-09-22 | CCXT | URL at line 27, keepalive 20,000 ms at line 48, `orderbook.reset()` at line 118, sections 1, 4 and 5 |
| S9 | Coinone developer documentation index | https://docs.coinone.co.kr/llms.txt | 2026-09-22 | Coinone | page list, every page read as Markdown by appending `.md` |
| P1 | `ws-probe.mjs book`, at 03:23 and 03:29 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinone/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs batch`, at 03:24 and 03:30 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinone/ws-probe.mjs) | 2026-09-22 | this host | 363 pairs on one socket, sections 3 to 5 |
| P3 | `ws-probe.mjs silence`, at 03:25 and 03:32 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinone/ws-probe.mjs) | 2026-09-22 | this host | silence tolerated, section 5 |
| P4 | `ws-probe.mjs deflate`, at 03:23 and 03:32 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinone/ws-probe.mjs) | 2026-09-22 | this host | compression, `CONNECTED` frame, section 5 |
| P5 | `rest-probe.mjs`, the REST compare and catalog | [`rest-probe.mjs`](../../../scripts/probes/venues/coinone/rest-probe.mjs) | 2026-09-22 | this host | `baseId` and `market.id`, section 3 |
