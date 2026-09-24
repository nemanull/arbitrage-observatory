# WOO X WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 04:19 to 04:33 UTC on 2026-09-23, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public WebSocket v3 of WOO X (CCXT id `woo`) for its one perpetual family, the USDT-margined linear perpetuals, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/woo/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Canada is on WOO X's unsupported list, see [`fees.md`](./fees.md) section 1, yet the public socket served this host normally.

The finding that shapes everything below is Retail Price Improvement (RPI).
The default book channel, `orderbookupdate`, carries only non-RPI orders, which are the only orders an API taker can fill against, see [`fees.md`](./fees.md) section 5.
That book was 3,652 to 22,267 ppm wide on BTC, ETH and SOL and changed every few seconds at most, while the book with RPI orders was 11 to 84 ppm wide, see [`rest.md`](./rest.md) section 5.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals and spot, v3 | `wss://wss.woox.io/v3/public`, S1 | open in 153 to 260 ms over five sockets, 223 perpetuals served |
| legacy v1, the URL CCXT Pro 4.5.68 uses | `wss://wss.woox.io/ws/stream`, at `server/node_modules/ccxt/js/src/pro/woo.js` line 41 | still open and serving `PERP_BTC_USDT@bbo` and `@orderbookupdate`, 77 and 82 frames in 10 s, although S2 schedules its deprecation for 2025-12-31 |
| private, v3 | `wss://wss.woox.io/v3/private?key=<listenKey>`, S1 | not probed |

One socket carries spot and perpetuals, since `orderbookupdate@SPOT_BTC_USDT@50` was accepted on the same socket as the perpetual books.
`wss.woox.io` resolved to 34.49.135.176 on 2026-09-23, a Google Cloud address, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| topic | documented push | probed on 2026-09-23 | RPI orders |
|---|---|---|---|
| `orderbookupdate@<symbol>@50` | deltas every 50 ms, S3 | deltas only, 19 and 35 BTC frames in about 75 s, recommended | excluded, S3 |
| `orderbookupdate@<symbol>@200` and `@500` | every 100 ms and 200 ms, S3 | not probed | excluded |
| `orderbookupdaterpi@<symbol>@50`, `@200`, `@500` | same speeds, S4 | 334 and 385 BTC frames in about 75 s at 50 levels | included |
| `orderbook10@<symbol>` | a 10 level snapshot every 200 ms, S5 | 113 and 123 BTC frames in about 75 s, and 101 of 121 frames in the rerun were tighter than the non-RPI best bid and ask | mostly included, see section 4 |
| `bbo@<symbol>` | every 10 ms, S6 | 472 and 517 BTC frames, and its last value equalled the non-RPI REST touch in both runs | excluded |
| `bborpi@<symbol>` | every 10 ms, S14 | not probed | included |
| `markprice@<symbol>` | every 1 s, S7 | 74 and 75 frames in about 75 s | |
| `indexprice@<spot symbol>` | every 1 s, S8, keyed by the spot symbol | 74 and 75 frames on `indexprice@SPOT_BTC_USDT`, while `indexprice@PERP_BTC_USDT` was silently dropped from the ack | |
| `estfundingrate@<symbol>` | every 1 min, S9 | 2 frames and 1 frame in about 75 s, 60.0 s apart | |
| `ticker@<symbol>` | every 1 s, S10 | 52 and 55 frames in about 75 s | |
| `trade@<symbol>`, `kline@<symbol>@<time>`, `openinterest@<symbol>` | on trade, on trade or candle close, every 1 s on change and every 10 s regardless, S14 | not probed | |

No channel publishes a non-RPI depth snapshot, and `bbo` is non-RPI but only one level.
The ticker, mark, index and funding topics are one topic per symbol, so a bulk REST call is the cheaper anchor source, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL, S1 | spot and perpetual topics on one socket, section 1 |
| subscribe frame shape | `{"id": ..., "cmd": "SUBSCRIBE", "params": ["topic1", "topic2"]}`, S11 | as documented, and a lowercase `"cmd": "subscribe"` was also accepted |
| unknown symbol expectation | Not publicly specified | an unknown symbol, an unsupported depth `@20`, an unknown topic and a duplicate each answered `"success":true` with `"data":[]` and sent nothing |
| chunk unit and budget | "The maximum number of topics to subscribe per request is 20", "maximum of 100 live topics" per connection, S1 | 10 topics per request is the real cap: 11, 16, 19, 20 and 21 topics each answered `"success":false` with `"data":"Command type invalid!"` in both runs. 100 topics per connection held, and the 101st answered success with `"data":[]` |
| keepalive mechanism | client `{"cmd": "PING", "ts": ...}`, server `{"cmd": "PONG", ...}`, "This is not required for keep-alive purposes", S1 | the server sent no protocol ping on any socket. A socket with no client frame closed at 60.16 to 60.31 s with 1006, four sockets over two runs, so a client frame is required |
| connection lifetime and maintenance notice | "Each WebSocket connection is valid for a maximum of 24 hours", S1. No socket maintenance notice is documented, and REST `systemInfo` reports maintenance | no lifetime cap reached in 120 s, and no notice seen |
| handshake and operation rate limits | 100 connections per 5 minutes per IP, 100 open connections per IP, subscriptions "not recommended to exceed 200 TPS", S1 | no refusal at 10 subscribe frames 250 ms apart, opens took 153 to 260 ms |
| public market data authentication | "Public market data topics do not require authentication.", S1 | none |
| message parse and routing | `{topic, ts, data}` with `data.s` the symbol | route on `topic`, spelled `orderbookupdate@PERP_BTC_USDT@50`, or on `data.s`. Control replies carry `cmd` and no `topic` |
| subscribe acknowledgement shape | `{"id": "{req_id}", "cmd": "SUBSCRIBE", "success": true, "time": ..., "data": ["topic1", "topic2"]}`, S11 | as documented, and `data` lists only the topics the server accepted. A refused request answers `"cmd": "SUBSCRIBE"` or `"cmd": "ERROR"` with `"success": false` and a string `data` |
| symbol identifier format | `PERP_BTC_USDT`, `<TYPE>_<BASE>_<QUOTE>` | identical to CCXT `market.id` and to the REST `symbol` on 223 of 223 perpetuals, see [`rest.md`](./rest.md) section 2 |
| number representation | levels as `["price", "size"]` strings, S3 | strings in book, `bbo`, `markprice`, `indexprice` and `estfundingrate`. The legacy v1 `bbo` sends JSON numbers, `"ask":87194,"askSize":0.00020` |
| timestamp representation | envelope `ts` "when ws sends the data", `data.ts` "orderbook generation time", both ms, S3 | both integer ms. `data.ts` was 0 or 1 ms before the envelope on book deltas, RPI deltas and `bbo`, 3 to 13 ms on mark, index, ticker and funding, and 5 ms and 870 ms on the two first `orderbook10` frames |
| size unit | Not publicly specified | base coin: the BTC ask of `0.0002` on the socket equalled `"quantity":"0.0002"` on REST, and CCXT reports `contractSize` 1, section 4 |
| sequence semantics | "Check prevTs of each newly processed update is the same as the ts of the previous update", S3 | 0 gaps in 108 book frames on three symbols in the two book runs, and 0 in 95 and 78 frames on 100 symbols in the batch runs |
| idle repeat behaviour | not documented | nothing is repeated. `PERP_0G_USDT` sent no frame in either run, and its REST book was last changed on 2026-08-29. In each batch run 94 of the 100 busiest perpetuals sent no frame in 60 s |

## 4. The book channel in detail

`orderbookupdate@<symbol>@50` is the channel this profile describes, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

There is none.
The first frame for each symbol was a delta of 1 to 22 levels, and its `prevTs` named an update from before the subscribe.
In the first run BTC's first frame came 15.8 s after the socket opened, ETH's after 5.6 s and SOL's after 27.8 s.
In the rerun they came after 0.9 s, 14.1 s and 46.2 s.

The documented recipe buffers deltas, reads `GET /v3/public/orderbook?symbol=<symbol>&maxLevel=<depth>`, and starts at the delta whose `prevTs` equals the snapshot's `timestamp`, S3.

| symbol | run | REST snapshot `timestamp` equals a later `prevTs` | book from REST plus deltas against a fresh REST book at the end |
|---|---|---|---|
| `PERP_ETH_USDT` | 1 and 2 | yes, on the first delta | 20 of 20 bids, 12 of 12 and 13 of 13 asks equal |
| `PERP_SOL_USDT` | 1 and 2 | yes, on the first delta | 20 of 20 bids, 9 of 9 and 10 of 10 asks equal |
| `PERP_BTC_USDT` | 1 and 2 | no, the first delta's `prevTs` was newer than the snapshot in both runs | not aligned |

The BTC REST book lags the BTC socket.
In the rerun the REST reply was read every 5 s for 60 s, and on 12 of 12 reads its `timestamp` was older than the newest `ts` the socket had already delivered, by up to 46.6 s.
ETH's REST reply was older on 2 of 12 reads, by up to 4.15 s.
So the documented recipe can wait indefinitely on a busy symbol, and a feed needs a rule for a REST reply that is behind the chain, which the documentation does not give.

### Delta semantics

A delta carries `ts`, `prevTs`, `s`, and `bids` and `asks` arrays of `[price, size]` strings.
A size is the new absolute size at that price, and `"0"` deletes the level, S3.
No delta with both arrays empty was seen in 108 frames.

### Sequence and gap rule

```text
first delta after the REST seed: prevTs = snapshot timestamp   apply, last = ts
later delta: prevTs = last                                     apply, last = ts
later delta: prevTs ≠ last                                     gap: resync
```

The chain held on every frame of both runs, with 0 gaps.
`ts` is a millisecond clock, not a counter, and two updates in the same millisecond were not seen.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| delta | descending in every frame of both runs, 0 of 108 out of order | ascending in every frame |
| `orderbook10` | descending | ascending |
| REST `orderbook` | descending on every read | ascending on every read, while S12 says "Price of asks/bids are in descending order" |

A feed still applies deltas by price and never by position.

### Level window

A book kept from the REST seed and the deltas never held more than 50 levels per side.
Thin books held far fewer: ETH 38 to 39 bids and 12 to 13 asks, SOL 37 to 38 bids and 9 to 10 asks, which is also all the REST book returns at any `maxLevel`, see [`rest.md`](./rest.md) section 5.

### Size unit against CCXT `contractSize`

| symbol | CCXT `contractSize` | socket size | REST size at the same price | meaning |
|---|---:|---|---|---|
| `PERP_BTC_USDT` | 1 | `"0.00020"` at 87244 on `bbo` | `"0.0002"` at 87244 | 0.0002 BTC |
| `PERP_ETH_USDT` | 1 | `["2766.6", "0.9290"]` in a delta | the book kept from deltas matched the REST sizes on 20 of 20 bids at the end of both runs | 0.929 ETH |

The unit is the base coin, `baseAssetMultiplier` is 1 on all 223 perpetuals, and CCXT sets `contractSize` 1 on every swap, at `server/node_modules/ccxt/js/src/woo.js` line 791.
So the engine's size multiplier of 1 is right.

### RPI and the non-RPI book

| source | what it carries | evidence |
|---|---|---|
| `orderbookupdate` | non-RPI only | S3, and the book kept from it matched the non-RPI REST book on ETH and SOL |
| `bbo` | non-RPI only | its last value equalled the non-RPI REST touch in both runs, for example `86821` and `87244` in the rerun |
| `orderbookupdaterpi` | RPI and non-RPI | S4 |
| `orderbook10` | the merged book while RPI orders sit at the touch | in the rerun 101 of 121 frames had a tighter spread than the latest `bbo` and 20 equalled it, and the last frame, `87005` and `87006`, equalled the RPI REST touch |

RPI orders match only GUI-initiated and copy-trading orders, see [`fees.md`](./fees.md) section 5.
So an API taker sees the `orderbookupdate` book, and `orderbook10` is not a substitute for it.

### One-sided and empty books

`PERP_0G_USDT` had 0 bids and 1 ask, `[0.3906, 192]`, on REST in both runs, and its socket sent nothing.
The engine's `resetBook` accepts an empty side.
What the socket sends when a side empties was not observed.

### Idle repeats

Nothing is repeated.
The longest silence per busy symbol was 15.7 s and 24.1 s on BTC, 17.2 s and 21.8 s on ETH, and 13.2 s and 14.4 s on SOL.
The non-RPI book of most perpetuals changes far less often than that, see section 3.

### Unknown, closed and refused topics

| request | reply | then |
|---|---|---|
| `orderbookupdate@PERP_NOPE_USDT@50` | `{"id":"3","cmd":"SUBSCRIBE","success":true,"time":…,"data":[]}` | nothing |
| `orderbookupdate@PERP_BTC_USDT@20` | success with `"data":[]` | nothing |
| `nope@PERP_BTC_USDT` | success with `"data":[]` | nothing |
| the same BTC book topic twice | the second answers success with `"data":[]` | the first keeps delivering |
| `indexprice@PERP_BTC_USDT` | left out of the ack's `data` | nothing |
| a request with 11 to 21 topics | `{"id":"8","cmd":"SUBSCRIBE","success":false,"time":…,"data":"Command type invalid!"}` | none of the topics is subscribed |
| the 101st topic on one socket | success with `"data":[]` | nothing |
| a v1 shaped frame, `{"event":"subscribe","topic":…}` | `{"id":"v1","cmd":"ERROR","success":false,"time":…,"data":"Command type invalid!"}` | the socket stays open |
| text that is not JSON | `{"id":"","cmd":"ERROR","success":false,"time":…,"data":"Invalid request."}` | the socket stays open |

A closed or delisted perpetual was not available to probe, since all 223 were `TRADING`.
Because a refused topic still gets `"success":true`, a feed has to compare the ack's `data` with the topics it asked for.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client `PING`, "not required for keep-alive purposes", S1 | required. The server sent no protocol ping. `{"cmd":"PONG","success":true,"time":…}` came back to all 7 application pings in each book run, and a protocol ping got its pong in 109 and 110 ms |
| silence the server tolerates | Not publicly specified | a socket with no client frame closed at 60.16 to 60.31 s with 1006 and no close frame, four sockets over two runs, whether or not it had subscribed. A protocol ping every 10 s or an application `PING` every 25 s kept a socket open for the full 120 s in the first run and 90 s in the rerun, and the 1006 the rerun logged at 90.16 s on the application ping socket was the probe's own terminate at its deadline |
| forced disconnect | after 24 h, S1 | none in 120 s |
| maintenance notice | none on the socket | none seen |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got no `sec-websocket-extensions` header back in either run |
| handshake | | 153 to 260 ms to open, and 301 and 331 ms when deflate was offered |
| subscription limits | 20 topics per request, 100 per connection, S1 | 10 per request, 100 per connection, section 3 |
| throughput | | the 100 busiest perpetuals by 24 h turnover on one socket: 95 and 78 frames in 60 s, a peak of 7 per second, 184 and 181 bytes per frame, 21 and 23 µs `JSON.parse` per frame |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Arrays marked `…` are cut.

Subscribe, four book topics in one frame.

```json
{"id": "1", "cmd": "SUBSCRIBE", "params": ["orderbookupdate@PERP_BTC_USDT@50", "orderbookupdate@PERP_ETH_USDT@50", "orderbookupdate@PERP_SOL_USDT@50", "orderbookupdate@PERP_0G_USDT@50"]}
```

Acknowledgement.

```json
{"id":"1","cmd":"SUBSCRIBE","success":true,"time":1790137718411,"data":["orderbookupdate@PERP_BTC_USDT@50","orderbookupdate@PERP_ETH_USDT@50","orderbookupdate@PERP_SOL_USDT@50","orderbookupdate@PERP_0G_USDT@50"]}
```

The first BTC frame after the subscribe, a delta whose `prevTs` is older than the subscribe, and the next one.

```json
{"topic":"orderbookupdate@PERP_BTC_USDT@50","ts":1790137719188,"data":{"ts":1790137719188,"bids":[],"asks":[["87243","0"],["95000","0.00526"]],"prevTs":1790137716988,"s":"PERP_BTC_USDT"}}
```

```json
{"topic":"orderbookupdate@PERP_BTC_USDT@50","ts":1790137719288,"data":{"ts":1790137719288,"bids":[],"asks":[["87243","0.33231"],["95000","0"]],"prevTs":1790137719188,"s":"PERP_BTC_USDT"}}
```

An RPI delta, whose levels sit where the non-RPI book has none.

```json
{"topic":"orderbookupdaterpi@PERP_BTC_USDT@50","ts":1790137719138,"data":{"ts":1790137719138,"bids":[],"asks":[["87063","4.32651"]],"prevTs":1790137718338,"s":"PERP_BTC_USDT"}}
```

Best bid and ask, non-RPI.

```json
{"topic":"bbo@PERP_BTC_USDT","ts":1790137719048,"data":{"ts":1790137719048,"bp":"86821","bq":"0.35032","ap":"87243","aq":"0.32790","s":"PERP_BTC_USDT"}}
```

`orderbook10`, first three levels per side kept, with the RPI levels on top.

```json
{"topic":"orderbook10@PERP_BTC_USDT","ts":1790137719008,"data":{"ts":1790137718138,"bids":[["87062","13.89220"],["87061","2.81143"],["87059","2.99505"]],"asks":[["87063","4.53491"],["87064","6.71940"],["87065","0.21559"]],"s":"PERP_BTC_USDT"}}
```

Mark, index and estimated funding.

```json
{"topic":"markprice@PERP_BTC_USDT","ts":1790137719016,"data":{"ts":1790137719004,"px":"87081","s":"PERP_BTC_USDT"}}
```

```json
{"topic":"indexprice@SPOT_BTC_USDT","ts":1790137719018,"data":{"ts":1790137719008,"px":"87127","s":"SPOT_BTC_USDT"}}
```

```json
{"topic":"estfundingrate@PERP_BTC_USDT","ts":1790137739007,"data":{"ts":1790137739001,"ft":1790150400000,"s":"PERP_BTC_USDT","r":"0.00004326"}}
```

Keepalive.

```text
{"cmd": "PING", "ts": <Unix ms>}
```

```json
{"cmd":"PONG","success":true,"time":1790137731901}
```

Errors.

```json
{"id":"8","cmd":"SUBSCRIBE","success":false,"time":1790137799704,"data":"Command type invalid!"}
```

```json
{"id":"3","cmd":"SUBSCRIBE","success":true,"time":1790137794100,"data":[]}
```

The `PING` frame is shown as the probe builds it, since the probe logs the pong and not the ping it answered.

## 7. Private channels

Named for a future execution stage, from S0 and S15, not probed.
They use `wss://wss.woox.io/v3/private?key=<listenKey>`, where the listen key comes from an authenticated REST call, S1.

- `account`, `balance`, `position`, `executionreport` and `algoexecutionreport`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
The engine's feeds today take their first book from the socket, and this venue sends none, so the feed needs a REST seed, which no feed under `server/src/venues/` does yet.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://wss.woox.io/v3/public`, perpetuals only | one family, section 1 |
| channel | `orderbookupdate@<rawMarketId>@50` | the only non-RPI depth channel, and RPI orders cannot be hit by an API taker |
| markets per connection | 100 | the per connection cap, confirmed at 100 and refused at 101 |
| subscribe frames | frames of 10 topics, `{"id": "<n>", "cmd": "SUBSCRIBE", "params": [...]}` | 11 or more are refused whole |
| ack check | log every requested topic missing from the ack's `data` | refused topics still answer `"success":true` |
| seed | after the ack, read `GET /v3/public/orderbook?symbol=<id>&maxLevel=50` per symbol, at most 10 a second | no snapshot on subscribe, and 10 per second per IP is the REST limit, see [`rest.md`](./rest.md) section 6 |
| alignment | start at the delta whose `prevTs` equals the snapshot `timestamp`, and drop buffered deltas with `ts` at or before it | the documented recipe |
| REST behind the chain | if the first delta after the seed has a newer `prevTs` than the snapshot, reseed after a pause, and after a few misses mark the symbol stale rather than looping | BTC never aligned in two runs, section 4 |
| delta | apply only when `prevTs === last`, then store `ts` | 0 gaps observed |
| resync | a `prevTs` gap: `resync`, which terminates the socket, resubscribes and so reseeds every symbol on it | the engine's existing path |
| keepalive | `{"cmd": "PING", "ts": <ms>}` every 15 s | the server closes a socket that has sent nothing for 60 s |
| `maxSilenceMs` | 45,000 | three missed pongs, since a busy book went 24 s without a frame and most books send nothing for minutes, so the pong has to count as traffic |
| receive time | stamp on arrival | `data.ts` is the book's own clock |
| sizes | `Number()` of the string, base coin | `contractSize` 1 |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

A resync on one symbol reseeds up to 100 symbols at 10 REST reads a second, so one gap costs about 10 s of stale books on that socket.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S0 | WOO developer documentation index | https://developer.woox.io/llms.txt | 2026-09-22 | WOO X, global | topic and private channel names, sections 2 and 7 |
| S1 | WebSocket Introduction | https://developer.woox.io/api-reference/websocket_introduction | 2026-09-22 | WOO X, global | URLs, 24 h lifetime, connection and subscription limits, ping and pong, sections 1, 3, 5 |
| S2 | Legacy API | https://developer.woox.io/legacy-api-reference/introduction | 2026-09-22 | WOO X, global | v1 deprecation on 2025-12-31, section 1 |
| S3 | Orderbook update | https://developer.woox.io/api-reference/endpoint/websocket/Orderbook_update | 2026-09-22 | WOO X, global | depths and speeds, local book recipe, field meanings, sections 2 to 4 |
| S4 | Orderbook update (RPI) | https://developer.woox.io/api-reference/endpoint/websocket/Orderbook_update_rpi | 2026-09-22 | WOO X, global | RPI book topic, section 2 and 4 |
| S5 | Orderbook | https://developer.woox.io/api-reference/endpoint/websocket/ORDERBOOK10 | 2026-09-22 | WOO X, global | `orderbook10` at 200 ms, section 2 |
| S6 | BBO | https://developer.woox.io/api-reference/endpoint/websocket/BBO | 2026-09-22 | WOO X, global | `bbo` at 10 ms, section 2 |
| S7 | Mark price | https://developer.woox.io/api-reference/endpoint/websocket/MARKET_PRICE | 2026-09-22 | WOO X, global | `markprice` at 1 s, section 2 |
| S8 | Index price | https://developer.woox.io/api-reference/endpoint/websocket/INDEX_PRICE | 2026-09-22 | WOO X, global | `indexprice` at 1 s on a spot symbol, section 2 |
| S9 | Estimated funding rate | https://developer.woox.io/api-reference/endpoint/websocket/FUNDING_RATE | 2026-09-22 | WOO X, global | `estfundingrate` every minute, section 2 |
| S10 | Ticker | https://developer.woox.io/api-reference/endpoint/websocket/TICKER | 2026-09-22 | WOO X, global | `ticker` at 1 s, section 2 |
| S11 | Subscribe | https://developer.woox.io/api-reference/endpoint/websocket/subscribe | 2026-09-22 | WOO X, global | frame and ack shape, 20 topics per request, section 3 |
| S12 | Orderbook snapshot | https://developer.woox.io/api-reference/endpoint/public_data/orderbook | 2026-09-22 | WOO X, global | REST level order as documented, section 4 |
| S14 | BBO (RPI), Trade, Kline and Open interest | https://developer.woox.io/api-reference/endpoint/websocket/BBO_rpi and the `TRADE`, `KLINE` and `OPEN_INTEREST` pages beside it | 2026-09-22 | WOO X, global | topic names and push rules, section 2 |
| S15 | private topic pages | https://developer.woox.io/api-reference/endpoint/websocket/private/Account and the `Balance`, `Position`, `Execution_report` and `Algo_execution_report` pages beside it | 2026-09-22 | WOO X, global | private topic names, section 7 |
| S13 | CCXT Pro 4.5.68 `woo.js` and CCXT 4.5.68 `woo.js` | `server/node_modules/ccxt/js/src/pro/woo.js` and `server/node_modules/ccxt/js/src/woo.js` | 2026-09-22 | CCXT | legacy URL, `contractSize` 1, sections 1 and 4 |
| P1 | `ws-probe.mjs book`, runs at 04:19 and 04:28 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/woo/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 6 |
| P2 | `ws-probe.mjs batch`, runs at 04:23 and 04:30 UTC, after a first attempt at 04:22 whose 20 topic frames were all refused | [`ws-probe.mjs`](../../../scripts/probes/venues/woo/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | request and connection caps, throughput, sections 3 and 5 |
| P3 | `ws-probe.mjs silence`, runs at 04:24 for 120 s and 04:31 for 90 s | [`ws-probe.mjs`](../../../scripts/probes/venues/woo/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 5 |
| P4 | `ws-probe.mjs deflate`, runs at 04:27 and 04:33 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/woo/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | deflate, legacy URL, sections 1 and 5 |
