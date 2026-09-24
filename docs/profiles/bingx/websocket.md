# BingX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, in the local evening, which is 01:22 to 01:47 UTC on 2026-09-23.

This profile covers the public perpetual swap WebSocket of BingX (CCXT id `bingx`) for every perpetual family, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bingx/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation site is client rendered, so its text was read from the site's bundle, see [`fees.md`](./fees.md) section 10.
Every server frame is a gzip member in a binary WebSocket frame, and that is the first thing a feed has to handle.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals | `wss://open-api-swap.bingx.com/swap-market`, S1 | open in 505 to 669 ms over all runs, and 199 USDT contracts delivered on one socket |
| USDC-M perpetuals | the same URL, S1 | `BTC-USDC@incrDepth` delivers on the swap URL |
| Coin-M perpetuals | `wss://open-api-cswap-ws.bingx.com/market`, S1, and CCXT Pro at `server/node_modules/ccxt/js/src/pro/bingx.js` line 45 | open in 596 to 658 ms, `BTC-USD@depth20` delivers |
| spot | `wss://open-api-ws.bingx.com/market`, CCXT Pro line 43 | not probed |
| demo trading | `wss://vst-open-api-ws.bingx.com/swap-market`, S1 | not probed |

One socket carries USDT-M and USDC-M together.
The coin-M socket is separate and refuses `incrDepth`, see section 4.
A coin-M symbol on the swap URL is refused: `BTC-USD@incrDepth` answered code 80015 `dataType not support`.
The documented connection limits are 200 topics per socket and 60 sockets per IP, S1, while the API FAQ says "Currently, there is no limit" on channels per IP and asks for subscriptions under 10 per second, S2.

## 2. Channel matrix for public market data

All on the swap URL unless the row says otherwise.
Frame counts are per run of about 27 s on socket B and 60 s on socket A of `ws-probe.mjs book`.

| channel | `dataType` | depth and speed, documented | probed on 2026-09-23 UTC |
|---|---|---|---|
| incremental depth | `BTC-USDT@incrDepth` | "BTC-USDT and ETH-USDT push frequency is 200ms, while other pairs are 800ms", S3 | a snapshot of up to 1,024 levels per side, then updates. Median update interval 203 to 207 ms on BTC and ETH, 400 to 440 ms on AIINU, BTC-USDC and NCCOGOLD2USD, 729 to 778 ms on TURBO. Recommended |
| partial depth | `<symbol>@depth<level>@<interval>`, level 5, 10, 20, 50 or 100, interval `200ms` or `500ms` | "The push interval for BTC-USDT and ETH-USDT is 200ms, and for other contracts it is 500ms.", S4 | a whole snapshot per frame with no update id. `ETH-USDT@depth100@500ms` came every 200 ms, so the interval in the name does not override the per symbol rate. `AIINU-USDT@depth20@500ms` every 500 ms |
| partial depth without interval | `BTC-USDT@depth50` | as CCXT Pro subscribes it, `pro/bingx.js` line 570 | a 50 level snapshot every 501 ms |
| best bid and ask | `BTC-USDT@bookTicker` | "Push every 200 ms.", S5 | 11, 54 and 24 frames in three runs of about 27 s, median gap 552 to 2,678 ms. The first frame of the third run carried a trade time `T` 1,344,963 ms before its event time `E` and a bid 212.7 USDT above the live book, section 6 |
| mark price | `BTC-USDT@markPrice` | "Push latest mark price changes.", S6 | one frame a second, fields `e`, `E`, `s`, `p`, the mark only |
| 24 h ticker | `BTC-USDT@ticker` | "Push every 1 second.", S7 | one frame a second, 24 h statistics and the touch |
| trades, klines, last price | `@trade`, `@kline_1m`, `@lastPrice` | S1 | not probed |
| coin-M limited depth | `BTC-USD@depth20` on the coin-M URL | S8 | levels as objects `{p, a, v}`, one frame every 502 ms |

No index or funding channel exists on the swap socket.
The mark channel carries the mark alone, so the REST anchor poll stays, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for USDT-M and USDC-M, another for coin-M, another for spot, S1 | USDC and USDT contracts share the swap socket. Coin-M symbols are refused there with 80015 |
| subscribe frame shape | `{"id": "id1", "reqType": "sub", "dataType": "data to sub"}`, one topic per frame, S1 | as documented. A frame whose `dataType` is an array got no reply and delivered nothing |
| unknown symbol expectation | not documented | `NOPE-USDT@incrDepth`, `btc-usdt@incrDepth` and `BTC-USDT@nope` answer code 80015 `dataType not support` |
| chunk unit and budget | 200 topics per socket, error 80403, S1 | 199 topics subscribed at 9 per second in 22.2 s, all acked with code 0. The 200th was acked with code 0 and the 201st answered 80403 `your topic num over max 200` in three runs |
| keepalive mechanism | "the server will send a heartbeat-Ping message every 5 seconds", the client returns a Pong, S1 | a gzip binary frame whose text is `Ping` every 4,857 to 5,136 ms, and the text frame `Pong` keeps the socket. No WebSocket protocol ping on any socket |
| connection lifetime and maintenance notice | not documented | no forced close in 90 s. No maintenance frame seen |
| handshake and operation rate limits | 60 sockets per IP, S1. Subscriptions under 10 per second, S2 | no refusal at 9 subscriptions a second. Opens took 505 to 669 ms |
| public market data authentication | none | none |
| message parse and routing | `{"code", "dataType", "data"}`, S3 | routes on `dataType`, spelled `<symbol>@<channel>`. Every frame must be gunzipped first |
| subscribe acknowledgement shape | `{"id": "id1", "code": 0, "msg": ""}`, S1 | swap: `{"id", "code": 0, "msg": "", "dataType": "", "data": null}`. Coin-M: `{"code": 0, "id", "msg": "SUCCESS", "timestamp"}`. The snapshot follows the ack within 0 to 48 ms |
| symbol identifier format | `BTC-USDT` | identical to CCXT `market.id` on 1,119 of 1,119 active swaps, to the contracts `symbol` and to the premium index `symbol`, see [`rest.md`](./rest.md) section 2 |
| number representation | strings, "decimal numbers are returned as strings", S9 | prices and sizes are strings. `lastUpdateId` and `time` are JSON integers |
| timestamp representation | ms | `data.time` on book frames, `E` and `T` on event frames, `ts` on partial depth, all integer ms |
| size unit | "quantity" | base coins, which is CCXT's `contractSize` of 1, section 4 |
| sequence semantics | "The lastUpdateId for the Nth incremental depth will be N-1 lastUpdateId + 1", and "In rare cases, if the lastUpdateId is not continuous, you can reconnect", S3 | the first update was the snapshot id plus one on all six book streams of three runs. Later updates skip ids on most streams: 257, 490 and 475 skips on 102, 132 and 168 of 199 streams in three one minute batch runs, and no skipped id ever arrived later, section 4 |
| idle repeat behaviour | not documented | `incrDepth` never repeats an id. The partial depth channel resends an identical book: 29 to 57 of 135 to 147 frames on BTC and ETH, 8 to 14 of 54 to 58 on AIINU |

## 4. The book channel in detail

`<symbol>@incrDepth` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first data frame for each stream has `"action": "all"`, the full book the server keeps, and a `lastUpdateId`.
It arrived 169 to 280 ms after the subscribe frame was sent on the six book streams of three runs, and at a median of 176 to 182 ms, at most 430 to 532 ms, across 199 streams in the batch runs.
Each stream got exactly one snapshot and no further one in 60 s.

| contract | snapshot levels, bids and asks |
|---|---|
| `BTC-USDT` | 1,023 to 1,024 and 1,022 to 1,024 |
| `ETH-USDT` | 1,024 and 1,024 |
| `NCCOGOLD2USD-USDT` | 1,024 and 1,021 to 1,022 |
| `BTC-USDC` | 262 to 265 and 142 to 146 |
| `TURBO-USDT` | 173 to 174 and 264 |
| `AIINU-USDT` | 103 and 102 |

The median snapshot across the 199 batch streams held 237 to 239 levels on both sides together.
The documentation pages give 1,000 levels for one incremental depth page and name no depth for the other, S3, and the wire caps at 1,024 per side.

### Delta semantics

An update carries `"action": "update"`, a `lastUpdateId`, `time`, and `bids` and `asks` arrays of `[price, size]` string pairs.
A size of `"0.0000"` deletes the level, and the probe never saw a delete for a level it did not hold.
No update arrived with both arrays empty on the six book streams of the three book runs.
Applying every update never crossed a book on any stream of any run, 6 streams in the book runs and 199 in the batch runs.

### Sequence and gap rule

```text
action = all                          replace the book, last = lastUpdateId
action = update, id = last + 1        apply, last = id   (documented)
action = update, id > last + 1        observed often, no update was lost: apply, last = id
action = update, id <= last           never observed: drop, or resync
```

The first update after every snapshot carried the snapshot id plus one, on the six streams of every book run.
After that, ids skip forward by 2 to 9 without any frame for the missing ids.

| run | streams | skips | streams with a skip | skipped ids | skipped ids that arrived later | largest step |
|---|---:|---:|---:|---:|---:|---:|
| book, 01:22 UTC | 6 | 16 | 3 | not counted | not counted | not counted |
| book, 01:24 UTC | 6 | 9 | 6 | 11 | 0 | 3 |
| book, 01:39 UTC | 6 | 23 | 4 | 40 | 0 | 3 |
| batch, 01:26 UTC | 199 | 257 | 102 | 427 | 0 | 5 |
| batch, 01:35 UTC | 199 | 490 | 132 | 881 | 0 | 9 |
| batch, 01:44 UTC | 199 | 475 | 168 | 726 | 0 | 5 |

The books kept through those skips matched the REST book.
In the third book run, 60 s after subscribing, BTC-USDT, TURBO-USDT after 15 skips, AIINU-USDT and NCCOGOLD2USD-USDT matched the REST book at all 100 levels on both sides.
In the second book run BTC-USDT, ETH-USDT and TURBO-USDT matched at all 100 levels, and AIINU-USDT, BTC-USDC and NCCOGOLD2USD-USDT differed on 1 or 2 of 100 levels on a side.
ETH-USDT in the third run matched 88 bid and 83 ask levels of 100 after 4 skips, and a single read cannot tell motion during the request from a lost update.
In the second and third batch runs the six streams with the most skips, 6 to 49 each, were read against the REST book at 20 levels twice, 5 s apart.
No level disagreed on both reads with the socket's size unchanged, and 11 of the 12 streams disagreed on no level at all on the first read.
So the skipped ids carry no visible change, and a feed that resyncs on every skip would resync most streams about once a minute.
A strict `id === last + 1` rule is therefore wrong for this venue, and section 8 gives the rule to use.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on every stream of every run | best first, ascending, on every stream |
| update | descending, 0 unordered arrays in 960 to 1,017 updates per run | descending, worst first: every ask array of two or more levels that was not ascending was descending, 225 to 247 of about 250 per run on BTC and ETH |
| REST `depth` | descending | ascending, see [`rest.md`](./rest.md) section 5 |
| coin-M `depth20` | descending | descending, worst first, in the CCXT Pro sample at `pro/bingx.js` lines 688 to 690 |

A feed applies updates by price and never by position.

### Level window

The book the probe kept never held more than 1,024 levels per side.
A thin contract simply holds what exists: `AIINU-USDT` held 103 bids and 102 asks, with 1 coin at each of the touches.

### Size unit against CCXT `contractSize`

| contract | CCXT `contractSize` | socket size at a level | REST `bids` at the same price | REST `bidsCoin` |
|---|---:|---|---|---|
| `BTC-USDT` | 1 | `"2.5365"` | `"2.5365"` | `"2.5365"` |
| `ETH-USDT` | 1 | `"564.06"` | `"564.06"` | `"564.06"` |
| `TURBO-USDT` | 1 | `"5197"` | `"5197"` | `"5197"` |

The REST `bids` and `bidsCoin` arrays were identical on every read, and the documentation calls `bidsCoin` "quantity(coin)", S10.
So socket sizes are base coins, which matches CCXT's `contractSize` of 1 set for every swap at `server/node_modules/ccxt/js/src/bingx.js` line 1049.
The engine's `sizeMul` of 1 therefore converts BingX sizes correctly.
On the four compared contracts 20 of 20 top bids equalled both REST arrays in the first book run, see the ledger.

The coin-M `depth20` levels are objects with `p` the price, `a` a coin amount and `v` an integer, for example `{"p":"86669.3","a":"0.093459","v":"81.0"}`.
Since 81 times 100 USD divided by 86,669.3 is 0.093459, `v` counts 100 USD contracts, which is the coin-M `minTickSize` of `"100"` for BTC-USD in the contracts reply.
That reading is an inference, and CCXT reads `a`, the coin amount, at `pro/bingx.js` line 722.

### One-sided and empty books

No one-sided or empty book was seen, so what `incrDepth` sends for an empty side is Not verified.
The engine's `resetBook` accepts an empty side.

### Idle repeats

`incrDepth` never repeated an id and never sent an update with both arrays empty.
A quiet book simply goes silent: the longest silence on a stream was 1.4 to 1.6 s on AIINU, 3.2 to 4.0 s on TURBO, and 19.2 to 21.6 s on the quietest of the 199 batch streams.
The server `Ping` every 5 s is the traffic that proves the socket alive.

### Unknown, closed and wrong-family symbols

| request | reply | then |
|---|---|---|
| `NOPE-USDT@incrDepth` | code 80015 `dataType not support` | nothing |
| `btc-usdt@incrDepth` | code 80015 | nothing |
| `BTC-USDT@nope` | code 80015 | nothing |
| `BTC-USDT@depth30@200ms` | code 80015 | nothing |
| `BTC-USD@incrDepth` on the swap URL | code 80015 | nothing |
| `BTC-USDT@incrDepth` twice on one socket | code 0 both times | one stream, 61 frames in 12 s |
| `NCCOCOFFEE2USD-USDT@incrDepth`, `status` 25 | code 80015 | one data frame anyway |
| `POWER-USDT@incrDepth`, `status` 1 with the API closed | code 0 | 24 to 26 frames in 12 s |
| a 201st topic on one socket | code 80403 `your topic num over max 200` | one data frame anyway |
| `BTC-USD@incrDepth` on the coin-M URL | code 100400 `incrDepth dataType is not supported` | nothing |
| the text `hello` | no reply | the socket stays open |
| `dataType` as an array | no reply | nothing |

A refused subscription can still leak one data frame, so a feed must accept book frames only for topics it was acked on.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server `Ping` every 5 s, client answers `Pong`, S1 | the `Ping` is gzip binary like every other frame. Gaps of 4,857 to 5,136 ms on every socket. CCXT Pro answers `Pong` at `pro/bingx.js` line 1465 |
| silence the server tolerates | not documented, the FAQ blames drops on a missing Pong, S2 | a socket that did not answer `Ping` closed at 30.52 to 30.63 s with code 1006 and no close frame, after 6 pings, in two runs, with and without a subscription. A socket with no subscription that answered every `Ping` stayed open the full 90 s in both runs |
| forced disconnect | not documented | none in 90 s |
| maintenance notice | not documented | none seen |
| compression | "All response data from the Websocket server is compressed into GZIP format. Clients have to decompress them for further use.", S1 | every frame is binary gzip, 0 text frames in all runs. A client offering permessage-deflate got no `sec-websocket-extensions` back in two runs, so the server does not negotiate it |
| gunzip cost | not documented | 34 to 36 µs median and 168 to 190 µs p99 per frame across 199 streams, where `JSON.parse` took 14 µs median. On the book probe's sockets, which carried 1,024 level snapshots, the median gunzip was 85 to 149 µs |
| handshake | | 505 to 669 ms to open from this host over all runs |
| subscription limits | 200 topics per socket, 60 sockets per IP, S1 | 200 topics confirmed. The IP limit was not tested |
| throughput | | 199 USDT perpetuals, every third by 24 h volume: 334 to 349 frames per second median, peak 416 to 450, 98 to 123 KB per second on the wire and 145 to 187 KB per second after gunzip |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC, decompressed.
Arrays are cut to three levels.

Subscribe.

```json
{"id": "667a6664-6db3-4d09-89f2-66554e29b723", "reqType": "sub", "dataType": "BTC-USDT@incrDepth"}
```

Acknowledgement.

```json
{"id":"667a6664-6db3-4d09-89f2-66554e29b723","code":0,"msg":"","dataType":"","data":null}
```

Snapshot.

```json
{"code":0,"dataType":"BTC-USDT@incrDepth","data":{"action":"all","lastUpdateId":857550007,"time":1790127586998,"bids":[["86378.9","0.0001"],["86377.5","0.0003"],["86377.2","13.9985"]],"asks":[["86379.1","87.1230"],["86379.3","9.6687"],["86379.4","17.5938"]]}}
```

The first update, whose ask array runs worst first.

```json
{"code":0,"dataType":"BTC-USDT@incrDepth","data":{"action":"update","lastUpdateId":857550008,"time":1790127587285,"bids":[["86377.2","18.0499"],["86377.0","0.0191"],["86376.9","0.0061"]],"asks":[["87169.5","0.0000"],["87169.0","0.0000"],["87168.9","0.0000"]]}}
```

Keepalive, both as text after decompression.

```text
server: Ping
client: Pong
```

Errors.

```json
{"id":"0fffced2-fc90-486b-8dd2-addf04efae0d","code":80015,"msg":"dataType not support","dataType":"","data":null}
```

```json
{"code":100400,"msg":"code:100400:incrDepth dataType is not supported","timestamp":1790126693749}
```

The topic cap, from the batch probe's log, where the frame carried the id of the 201st subscribe.

```text
ZEC-USDT: 80403 your topic num over max 200
```

Mark price.

```json
{"code":0,"dataType":"BTC-USDT@markPrice","data":{"e":"markPriceUpdate","E":1790127588636,"s":"BTC-USDT","p":"86379.1"}}
```

A stale best bid and ask: `T` is 22 minutes before `E`, and the bid is 212.7 above the incrDepth snapshot's best bid of 86,378.9 taken 1.9 s earlier.

```json
{"code":0,"dataType":"BTC-USDT@bookTicker","data":{"e":"bookTicker","u":183036649,"E":1790127588860,"T":1790126243897,"s":"BTC-USDT","b":"86591.6","B":"55.2156","a":"86591.7","A":"16.6842"}}
```

Coin-M limited depth, two bids kept.
The probe logged only the first 260 characters of each coin-M frame, so the asks are not shown.

```json
{"code":0,"dataType":"BTC-USD@depth20","data":{"symbol":"BTC-USD","bids":[{"p":"86669.3","a":"0.093459","v":"81.0"},{"p":"86669.2","a":"0.003461","v":"3.0"}]}}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They need a `listenKey` from `POST /openApi/user/auth/userDataStream`, appended to the same URL as `?listenKey=`.

- Swap account data: order updates, account balance and position updates, and configuration updates such as leverage and margin mode, pushed without a subscription once the `listenKey` is on the URL.
- CCXT Pro refreshes the key every 3,540,000 ms, `pro/bingx.js` line 50.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan on `wss://open-api-swap.bingx.com/swap-market` for USDT-M and USDC-M | one socket carries both, and coin-M is filtered out of the catalog, see [`rest.md`](./rest.md) section 8 |
| channel | `<rawMarketId>@incrDepth` | snapshot on subscribe, then updates, and sizes in coins |
| markets per connection | 180 | the cap is 200 topics, 199 ran at 334 to 349 frames a second, and 20 topics of headroom cost nothing |
| subscribe frames | one frame per market, `{"id": <uuid>, "reqType": "sub", "dataType": "BTC-USDT@incrDepth"}`, with `subscribeGapMs` 111 at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 27 | one topic per frame, and the FAQ asks for under 10 a second, so a 180 market socket takes 20 s to subscribe |
| decode | `gunzipSync(raw).toString('utf8')` in `handleMessage` before any parse | every frame, the `Ping` included, is binary gzip, and `VenueFeed` hands `handleMessage` the raw buffer at line 209 |
| keepalive | answer the text `Ping` with the text `Pong` inside `handleMessage`, and start no timer in `startKeepalive` | the server pings every 5 s and closes a silent client at 30.5 s |
| `maxSilenceMs` | 15,000 | three missed pings, since each `Ping` counts as traffic and a quiet book went 21.6 s without a book frame |
| routing | `dataType.slice(0, dataType.indexOf('@'))` gives the `rawMarketId` | the stream name is `<symbol>@incrDepth` |
| acks | keep a map from subscribe `id` to market, log any non-zero `code` by market, and ignore data for a market whose subscribe was refused | refused topics can still leak one frame |
| snapshot | `action === 'all'`: `resetBook` and store `lastUpdateId` | documented replace semantics |
| update | apply when `lastUpdateId > last`, then store it | ids skip forward with no loss, section 4 |
| resync | an update before any snapshot, or `lastUpdateId <= last`: `resync` | neither was observed, and both mean the stream is out of step |
| loss detection | a crossed book after an update: `resync` | the id cannot reveal a lost update, since skips are normal, and 0 crossed books were seen in normal running |
| receive time | stamp on arrival | the `bookTicker` sample shows the venue's own times can be minutes old |
| sizes | `Number()` of the string, in coins | `contractSize` 1 |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it, and the payload is gzip inside the frame anyway |

The book cadence limits what the engine sees.
Every symbol except BTC-USDT and ETH-USDT pushes at most every 400 to 800 ms, so a BingX leg is up to 0.8 s old by construction before any network delay.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BingX API docs v3, Swap, "WebSocket Rules" and the Websocket Account Data pages | https://bingx-api.github.io/docs-v3/ | 2026-09-22 | BingX, global | URLs, 200 topics, 60 sockets per IP, gzip, Ping and Pong, subscribe and ack shapes, private channels, sections 1, 3, 5, 7 |
| S2 | BingX API docs v3, Quick Start, "FAQ" | https://bingx-api.github.io/docs-v3/ | 2026-09-22 | BingX, global | subscription rate under 10 per second, no channel limit per IP, disconnects blamed on a missing Pong, sections 1, 3, 5 |
| S3 | BingX API docs v3, Swap, Websocket Market Data, "Incremental Depth Information" | https://bingx-api.github.io/docs-v3/#/en/Swap/Websocket%20Market%20Data/Incremental%20Depth%20Information | 2026-09-22 | BingX, global | `incrDepth` rules, push rates, the id rule and its caveat, sections 2 to 4 |
| S4 | BingX API docs v3, Swap, Websocket Market Data, "Partial Order Book Depth" | https://bingx-api.github.io/docs-v3/#/en/Swap/Websocket%20Market%20Data/Partial%20Order%20Book%20Depth | 2026-09-22 | BingX, global | partial depth levels and push rates, section 2 |
| S5 | BingX API docs v3, "Subscribe to the Book Ticker Streams" | https://bingx-api.github.io/docs-v3/ | 2026-09-22 | BingX, global | the 200 ms book ticker, section 2 |
| S6 | BingX API docs v3, Swap, "Subscribe to latest mark price changes" | https://bingx-api.github.io/docs-v3/ | 2026-09-22 | BingX, global | the mark channel, section 2 |
| S7 | BingX API docs v3, Swap, Websocket Market Data, "Subscribe to 24-hour price changes" | https://bingx-api.github.io/docs-v3/#/en/Swap/Websocket%20Market%20Data/Subscribe%20to%2024-hour%20price%20changes | 2026-09-22 | BingX, global | the ticker channel, section 2 |
| S8 | BingX API docs v3, Coin-M Futures, Websocket Market Data, "Subscribe to Limited Depth" | https://bingx-api.github.io/docs-v3/#/en/Coin-M%20Futures/Websocket%20Market%20Data/Subscribe%20to%20Limited%20Depth | 2026-09-22 | BingX, global | coin-M depth, section 2 |
| S9 | BingX API docs v3, Quick Start, "Basic Information" | https://bingx-api.github.io/docs-v3/ | 2026-09-22 | BingX, global | numbers as strings, ms timestamps, section 3 |
| S10 | BingX API docs v3, Swap, Market Data, "Order Book" | https://bingx-api.github.io/docs-v3/#/en/Swap/Market%20Data/Order%20Book | 2026-09-22 | BingX, global | `bidsCoin` is quantity in coin, section 4 |
| S11 | CCXT Pro 4.5.68 `bingx.js` | `server/node_modules/ccxt/js/src/pro/bingx.js` | 2026-09-22 | CCXT | URLs at lines 43 to 45, `gunzip` at line 52, depth 100 at line 91, coin-M levels at lines 688 to 690 and 722, every depth frame a reset at line 729, `Pong` at line 1465, sections 1, 2, 4, 5 |
| S12 | CCXT 4.5.68 `bingx.js` | `server/node_modules/ccxt/js/src/bingx.js` | 2026-09-22 | CCXT | `contractSize` 1 at line 1049, section 4 |
| P1 | `ws-probe.mjs book`, three runs at 01:22, 01:24 and 01:39 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/bingx/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6. The first run's reply mapping was wrong and only its frame counts are used |
| P2 | `ws-probe.mjs batch`, three runs at 01:26, 01:35 and 01:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bingx/ws-probe.mjs) | 2026-09-22 | this host | the 200 topic cap, id skips, stale level checks, throughput, sections 3 to 5 |
| P3 | `ws-probe.mjs silence`, two runs at 01:31 and 01:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bingx/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
| P4 | `ws-probe.mjs deflate`, two runs at 01:22 and 01:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bingx/ws-probe.mjs) | 2026-09-22 | this host | section 5 |

The documentation pages without a deep link name their page title, because the site's routes for them could not be confirmed from the bundle.
