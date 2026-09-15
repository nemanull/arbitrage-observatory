# MEXC WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-15.

**Probed:** 2026-09-15, from the development host near Seattle.

This profile covers the public futures WebSocket of MEXC, the CCXT id `mexc`, for every perpetual family, with the book channels in detail.
Every protocol claim below was captured by [`../../../scripts/probes/mexc-ws-probe.mjs`](../../../scripts/probes/mexc-ws-probe.mjs), run from `server/`, and the capture is quoted beside the documented value.
The runs of record are P1 to P3 at 18:52 to 18:57 UTC, and P4 names the morning runs of 07:15 to 07:29 UTC where a number comes from them.
Every number is one host on one date, and rates and cadences moved between the two sets of runs as the market did.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT margined perpetuals | `wss://contract.mexc.com/edge`, S1 | open in 133 to 489 ms, a slice of 150 contracts led by `BTC_USDT` delivers |
| USDC margined perpetuals | the same URL | `BTC_USDC` delivers on the socket that carries `BTC_USDT` |
| coin margined perpetuals | the same URL | `BTC_USD` delivers on the same socket |
| USD1 margined perpetuals | the same URL | not probed |
| `wss://api.mexc.com/edge` | not documented | HTTP 404 on the upgrade |

One socket carries every family.
The REST host moved to `api.mexc.com` on 2026-01-19, see [`./rest.md`](./rest.md) section 1, and the socket did not move with it.
CCXT Pro 4.5.68 uses the same URL for swaps, at `server/node_modules/ccxt/js/src/pro/mexc.js` line 50.

## 2. Channel matrix for public market data

| channel | subscribe frame | documented cadence | probed |
|---|---|---|---|
| incremental depth, merged | `{"method":"sub.depth","param":{"symbol":"BTC_USDT"}}` | "pushed every 200 ms", S3, merged by default since 2025-04-09, S8 | deltas only, no snapshot, 392 frames in 80 s on `BTC_USDT`, recommended only with a REST seed, section 8 |
| incremental depth, unmerged | `{"method":"sub.depth","param":{"symbol":"ETH_USDT","compress":false}}` | merging off, S9 | 175,766 frames in 80 s on `ETH_USDT`, 327 KB per second for one contract |
| full depth | `{"method":"sub.depth.full","param":{"symbol":"BTC_USDT","limit":20}}` | `limit` 5, 10 or 20, default 20, S9 | a whole top of book on every push, about every 300 ms, recommended, section 8. `limit` 50 was accepted and sent 50 levels per side |
| all tickers | `{"method":"sub.tickers","param":{}}` | "Pushes every 2s", S5 | 11 frames in 25 s, the first with 1,269 rows and 351 KB, later ones 300 to 923 rows. No `fundingRate` field |
| one ticker | `{"method":"sub.ticker","param":{"symbol":"BTC_USDT"}}` | | 9 frames in 25 s, carries `fairPrice`, `indexPrice`, `fundingRate`, `bid1` and `ask1` |
| trades | `{"method":"sub.deal","param":{"symbol":"BTC_USDT"}}` | | 118 frames in 25 s |
| index price | `{"method":"sub.index.price","param":{"symbol":"BTC_USDT"}}` | | 46 frames in 25 s on `BTC_USDT`, 45 on `BTC_USD` |
| fair price, the mark | `{"method":"sub.fair.price","param":{"symbol":"BTC_USDT"}}` | | 29 frames in 25 s |
| funding rate | `{"method":"sub.funding.rate","param":{"symbol":"BTC_USDT"}}` | | 1 frame in 25 s, `rate` and `nextSettleTime` only |
| klines, contract data | `sub.kline`, `sub.contract` | | not probed |

The method names are from S3, S5 and S9.
S9 lists no best bid and ask channel, and `push.ticker` carries `bid1` and `ask1`.
Index, mark and funding each need one subscription per contract, and the funding channel carries neither the interval nor the cap, so the REST bulk funding call stays the anchor source, see [`./rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`../../research/2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | one URL for USDT, USDC and coin margined contracts, section 1 |
| subscribe frame shape | `{"method": "sub.depth", "param": {"symbol": "BTC_USDT"}}`, one contract per frame, S3 | one contract per frame. 150 frames sent at 20 per second were all acknowledged |
| unknown symbol expectation | `rs.error` is documented for a failed login, S6, and not for a failed subscribe | `{"channel":"rs.error","data":"Contract [NOPE_USDT] not exists",…}`. An unknown method `sub.nope` got no reply in 12 s |
| chunk unit and budget | Not publicly specified in S1, S2 or S9 | 150 contracts on one socket, 0 gaps on the incremental channel, section 5 |
| keepalive mechanism | client sends `{"method": "ping"}`, "If no ping is received from the client within 1 minute, the connection will be closed. Send a ping every 10–20 seconds.", S2 | `{"channel":"pong","data":<ms>,"ts":<ms>}` in 99 to 111 ms. Without a client ping a socket closed at 60.5 s idle and at 68.3 s while receiving depth |
| connection lifetime and maintenance notice | Not publicly specified | none reached in 80 s, no notice frame seen |
| handshake and operation rate limits | Not publicly specified | no refusal at 150 subscribe frames in 7 s |
| public market data authentication | "except personal/private commands, all others do not require WS auth", S2 | none |
| message parse and routing | `channel`, `symbol`, `data`, `ts`, S3 | route on `channel`, then on the top level `symbol` |
| subscribe acknowledgement shape | not documented for public channels | `{"channel":"rs.sub.depth","data":"success","ts":…}`, which names no symbol. A repeated subscribe is acknowledged again and does not double the stream |
| symbol identifier format | `BTC_USDT` | identical to CCXT `market.id` and the REST `symbol`, see [`./rest.md`](./rest.md) section 2 |
| number representation | levels are numbers, S3 | JSON numbers, with trailing zeros that vary (`0.080100` beside `0.08009`) and prices sometimes in exponent form, `[7.548E+4,0,0]` |
| timestamp representation | `ts` push time and `cts` matching engine time in ms, S3, `cts` added 2026-06-18, S8 | both integer ms on every depth frame |
| size unit | the current REST page says "the order numbers of the contract", S10, and the older page "the volume of contracts", S9 | contracts, and one contract is CCXT `contractSize` coins, section 4 |
| sequence semantics | "if `version` == `localLastVersion + 1`, apply the update directly", S4 | unmerged: `version` is the previous `version` plus 1. Merged: `begin` is the previous `end` plus 1 and `version` equals `end`. 0 gaps, section 4 |
| idle repeat behaviour | not documented | the incremental channel repeats nothing. The full channel resends an unchanged top 20 when a deeper level moves, 33 of 127 `RIF_USDT` frames |

## 4. The book channels in detail

### Snapshot on subscribe

`sub.depth` sends no snapshot, merged or not.
The first frame for each contract is a delta: 44 bids and 7 asks spanning 62 versions on `BTC_USDT`, and one ask on `CSPR_USDT`.
The documented recipe seeds the book from `GET https://api.mexc.com/api/v1/contract/depth/{symbol}?limit=1000` and then applies the deltas, S4.

`sub.depth.full` sends a whole book on every push, 20 bids and 20 asks at `limit` 20.
The first frame arrived 216 ms after the acknowledgement on `BTC_USDT`.
Its frames carry `version` and `cts` and no `begin` or `end`.

### Delta semantics

Each level is `[price, size, order count]`.
A size of 0 deletes the level, S4, and on the wire a deleted level arrives as `[price, 0, 0]`.
A merged frame covers every version from `begin` to `end`, and none of the 39 whole merged frames in the captures repeated a price on one side.
A merged frame is not limited to the top of book: one `BTC_USDT` frame carried 640 levels, and `BTC_USDC` 544.
So the merged stream maintains the whole book, and a book seeded with 1,000 levels per side keeps receiving changes further out.

### Sequence and gap rule

```text
unmerged, compress false:  version = last + 1           apply, last = version
merged, the default:       begin = last + 1             apply, last = end (= version)
either:                    first value above last + 1   gap: resync
```

| run | stream | contracts | window | deltas | gaps | overlaps |
|---|---|---|---:|---:|---:|---:|
| P1 | merged | `BTC_USDT`, `BTC_USDC`, `BTC_USD`, `RIF_USDT`, `CSPR_USDT` | 80 s | 1,438 | 0 | 0 |
| P1 | unmerged | `ETH_USDT` | 80 s | 175,766 | 0 | 0 |
| P2 | merged | 150 USDT contracts by 24 h volume | 60 s | 28,841 | 0 | 0 |
| P4 | merged | the same 150 at 07:19 UTC | 60 s | 20,040 | 0 | 0 |

`version` equalled `end` on every merged frame, and `begin` never exceeded `end`.

The book rebuilt the documented way matched the REST book.
Each rebuilt book held its deltas two seconds before applying them, so a REST read taken later could be compared at the same version.
On unmerged `ETH_USDT`, 8 of 8 REST reads during the 80 s run landed on a version the book reached exactly, and all 20 bids and 20 asks matched on every read.
On merged `BTC_USDT` a read rarely lands on a frame's `end`, and the rebuilt book was compared after 35 to 816 further versions, so its 1 to 20 differing levels per side are market movement, not a unit or rule failure.
One morning read did land on a merged `end`, at version 41770922520 in P4, and all 40 levels matched.
Neither book ever crossed after a delta.

The REST seed lags the socket.
When the `ETH_USDT` seed arrived, 15,507 deltas were buffered and 15,116 of them were at or below the seed version, so the seed was 391 versions behind the newest delta.
On merged `BTC_USDT`, 24 of 27 buffered frames ended at or below the seed version and 1 frame straddled it.
A straddling frame is safe to apply whole, because every size in it is absolute.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| merged delta | unordered: 392 of 392 multi level bid arrays on `BTC_USDT`, 361 of 363 on `BTC_USDC` | unordered |
| unmerged delta | descending on 45 of 45 multi level bid arrays | not counted |
| full depth | descending on 19,529 of 19,529 frames in P2 | ascending on all of them |
| REST depth | descending | ascending, see [`./rest.md`](./rest.md) section 5 |

A feed applies deltas by price and never by position.

### Size unit against CCXT `contractSize`

Sizes are contracts.

| evidence | reading |
|---|---|
| `BTC_USDT` CCXT `contractSize` and catalog `contractSize` | 0.0001 for both, see [`./rest.md`](./rest.md) section 2 |
| REST best bid right after P1 | 4,959, which is 0.4959 BTC as contracts and would be 4,959 BTC as coins |
| socket against REST | the rebuilt `ETH_USDT` book matched REST level for level, so both carry one unit |
| `push.ticker` on `BTC_USDT` | `amount24` 4,752,077,754 USDT over `volume24` 616,139,789 is 7.71 USDT per unit, which is a price inside the day's 74,914 to 79,569 range times 0.0001 |
| every size on `BTC_USDT` | an integer, matching `volUnit` 1 |

The engine's `sizeMul` therefore converts MEXC sizes correctly for linear contracts.
For the 10 coin margined contracts `contractSize` is US dollars per contract, 100 on `BTC_USD`, and CCXT marks them `linear: false`, see [`./rest.md`](./rest.md) section 2.

### One-sided and empty books

No one-sided or empty book was seen on the socket, so what `sub.depth.full` sends for an empty side is Not verified.
A REST read of a delisted contract returned an empty book with a frozen timestamp, see [`./rest.md`](./rest.md) section 2, and the socket was not probed on one.

### Idle repeats

The incremental channel sends nothing when nothing changes, with 0 repeated frames on every contract.
`CSPR_USDT` went 5.7 s and `RIF_USDT` 4.4 s without a frame.
Over the 150 contract slice, the median of each contract's longest silence was 2,311 ms on the merged channel and 2,375 ms on the full channel, and the longest on the full channel was 6,361 ms.
The full channel resent an identical top 20 in 33 of 127 `RIF_USDT` frames, each time with a higher `version`, and 0 of 261 on `BTC_USDT`.
Its `version` never went backwards over 19,529 frames.

### Full depth cadence

| run | contracts | frames per second | bytes per second | median gap per contract, min / med / max | `BTC_USDT` |
|---|---|---:|---:|---|---|
| P2 | 150 | 305.7 | 253,390 | 290 / 326 / 895 ms | 225 frames in 60 s, median 291 ms |
| P4 | 150 | 197.8 | 163,314 | 268 / 576 / 895 ms | 203 frames in 60 s, median 276 ms |

The documentation gives no cadence for the full channel.
The merged incremental channel arrives every 200 ms on a busy contract, 392 frames in 80 s on `BTC_USDT`, so the full channel adds about 100 ms of delay to a busy book.

### Unknown and repeated subscriptions

| request | reply | then |
|---|---|---|
| `sub.depth` `NOPE_USDT` | `{"channel":"rs.error","data":"Contract [NOPE_USDT] not exists",…}` | nothing |
| `sub.depth` `BTC_USDT` a second time on the same socket | a second `rs.sub.depth` success | one stream, 59 frames in the 12 s run, the 200 ms cadence of a single subscription |
| `sub.depth.full` `ETH_USDT` `limit` 50 | `rs.sub.depth.full` success | 50 bids and 50 asks per frame |
| `sub.nope` | nothing in 12 s | |

The error names the contract in its text, while the success acknowledgement names nothing.
A feed that subscribes many contracts on one socket can therefore only parse the contract out of the error text, or watch for a contract that never sends a frame.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | `{"method": "ping"}` every 10 to 20 s, S2 | pong in 99 to 111 ms, five pongs over 80 s at a 15 s ping. CCXT Pro pings every 8 s, at `server/node_modules/ccxt/js/src/pro/mexc.js` lines 78 and 2139 |
| silence the server tolerates | "within 1 minute", S2 | no subscription and no ping: closed at 60.46 s with 1006 and no close frame, 60.1 s in P4. Depth traffic and no ping: closed at 68.26 s with 1005, 65.5 s in P4. So traffic does not replace the ping |
| forced disconnect | Not publicly specified | none in 80 s with a ping every 15 s |
| maintenance notice | Not publicly specified | not observed |
| compression in the frame | `gzip` in the request, with `"gzip": false` given "for uncompressed responses", S5, S9 | every frame was a text frame in every run: 0 binary frames with `gzip` absent, `false` or `true`, on depth, tickers and deals |
| permessage deflate | Not publicly specified | not offered by the probe, like the engine, and no extension came back |
| merging, which the docs also call compress | `compress` true by default on incremental depth since 2025-04-09 and on deals since 2025-08-21, S8 | `compress: false` turns merging off, section 4 |
| handshake | | 133 to 489 ms to open |
| subscription limits | Not publicly specified | 150 contracts per socket on each channel, and 7 subscriptions of several channels on another |
| throughput, merged | | 150 contracts: 450.6 frames and 235 KB per second, about 520 bytes per frame |
| throughput, full at 20 levels | | 150 contracts: 305.7 frames and 253 KB per second, about 830 bytes per frame |
| throughput, unmerged | | `ETH_USDT` alone: 2,194 frames and 327 KB per second |

The `gzip` knob did nothing observable from this host, so the question of how to turn compression off has no practical answer today.
A feed should still send no `gzip` key and should log and drop a binary frame, since the documentation implies the server can send one.

## 6. Captured frames

From P1 to P3 at 18:52 to 18:57 UTC on 2026-09-15.
Level arrays marked trimmed keep their first levels only, and each frame is otherwise as received.

Subscribe, merged and unmerged.

```json
{"method": "sub.depth", "param": {"symbol": "BTC_USDT"}}
```

```json
{"method": "sub.depth", "param": {"symbol": "ETH_USDT", "compress": false}}
```

Acknowledgement.

```json
{"channel":"rs.sub.depth","data":"success","ts":1789498321789}
```

Error for an unknown contract.

```json
{"channel":"rs.error","data":"Contract [NOPE_USDT] not exists","ts":1789498321790}
```

Merged delta, with unordered levels and deletions as `[price, 0, 0]`.

```json
{"symbol":"DOGE_USDT","data":{"cts":1789498405531,"asks":[[0.080100,2868,1],[0.080140,7405,4],[0.080150,7000,4],[0.080110,26243,2],[0.080120,5313,3],[0.08039,64,1],[0.080500,84,4],[0.08009,2700,1]],"bids":[[0.08003,8905,4],[0.08004,8819,4],[0.07969,0,0],[0.07979,6750,3],[0.08006,5200,3],[0.080070,3878,3],[0.080080,3453,2],[0.080090,0,0]],"end":8752808003,"begin":8752807948,"version":8752808003},"channel":"push.depth","ts":1789498405534}
```

Merged delta of a quiet book.

```json
{"symbol":"SKHYNIXSTOCK_USDT","data":{"cts":1789498405579,"asks":[[1235.06,606,1]],"bids":[[1233.04,0,0]],"end":1111084807,"begin":1111084806,"version":1111084807},"channel":"push.depth","ts":1789498405588}
```

Two consecutive unmerged deltas.

```json
{"symbol":"ETH_USDT","data":{"cts":1789498321765,"asks":[[2384.59,42,1]],"bids":[],"version":37723308980},"channel":"push.depth","ts":1789498321801}
```

```json
{"symbol":"ETH_USDT","data":{"cts":1789498321765,"asks":[[2384.60,2666,2]],"bids":[],"version":37723308981},"channel":"push.depth","ts":1789498321801}
```

Full depth at `limit` 20, trimmed to three levels per side.

```json
{"symbol":"RIF_USDT","data":{"cts":1789498322165,"asks":[[0.080550,48,1],[0.080560,347,1],[0.080570,149,1]],"bids":[[0.080490,46,1],[0.080480,489,1],[0.080470,420,1]],"version":5220571685},"channel":"push.depth.full","ts":1789498322169}
```

Keepalive.

```json
{"method": "ping"}
```

```json
{"channel":"pong","data":1789498336785,"ts":1789498336785}
```

Anchor channels.

```json
{"symbol":"BTC_USDT","data":{"symbol":"BTC_USDT","price":76027.1},"channel":"push.index.price","ts":1789498540911}
```

```json
{"symbol":"BTC_USDT","data":{"symbol":"BTC_USDT","price":75986},"channel":"push.fair.price","ts":1789498540821}
```

```json
{"symbol":"BTC_USDT","data":{"symbol":"BTC_USDT","rate":0.000081,"nextSettleTime":1789516800000},"channel":"push.funding.rate","ts":1789498561049}
```

## 7. Private channels

Named for a future execution stage, from S6 and S7, not probed.

- Login is `{"method": "login", "param": {"apiKey", "reqTime", "signature"}}` on the same URL, answered on `rs.login`, S6.
- After login every personal stream pushes by default, and `"subscribe": false` in the login param turns that off, S7.
- `personal.filter` selects streams by the names `order`, `order.deal`, `position`, `plan.order`, `stop.order`, `stop.planorder`, `risk.limit`, `adl.level` and `asset`, S7.
- CCXT Pro handles three of them as `push.personal.order`, `push.personal.asset` and `push.personal.order.deal`, at `server/node_modules/ccxt/js/src/pro/mexc.js` lines 2125, 2127 and 2129.

Whether an account may place futures orders at all is in [`./fees.md`](./fees.md) section 1.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://contract.mexc.com/edge`, for every family | one socket carries all families |
| channel | `sub.depth.full` with `limit` 20 | a whole book on every push fits `resetBook` with no seed and no gap rule, and 20 levels is the engine's depth |
| markets per connection | 150 | 150 ran on both depth channels with no refusal, and no cap is published |
| subscribe frames | one frame per contract, `{"method":"sub.depth.full","param":{"symbol":"<rawMarketId>","limit":20}}`, paced at 20 per second | the protocol takes one contract per frame, and no message rate is published |
| keepalive | `{"method":"ping"}` every 15 s | the server closes a socket without a client ping after about 60 s, even with traffic |
| `maxSilenceMs` | 45,000 | three missed pongs, and a quiet slice can go 6.4 s without a book frame |
| routing | `channel === "push.depth.full"`, then the top level `symbol` is the `rawMarketId` | |
| frame | `resetBook(symbol, bids, asks)` with sizes as given, and skip a frame whose `version` is below the last one | `version` never went backwards, and a skip costs one 300 ms frame |
| resync | none for gaps, because every frame is whole. Terminate on silence as today | |
| unknown contract | log `rs.error` frames and any contract with no frame 10 s after subscribe | the acknowledgement names no contract |
| receive time | stamp on arrival, never from `ts` or `cts` | |
| binary frame | log and drop | none seen, and the docs imply one is possible |
| deflate | keep `perMessageDeflate: false` | |

The lower latency alternative is merged `sub.depth`, which arrives about 100 ms sooner.
It needs a change the current feed does not have: buffer deltas, fetch `GET https://api.mexc.com/api/v1/contract/depth/{symbol}?limit=1000`, drop buffered frames whose `end` is at or below the seed `version`, apply the rest, and resync when `begin` is not the last `end` plus 1.
The REST depth limit is 10 calls per 2 seconds in the current docs, see [`./rest.md`](./rest.md) section 6, so seeding a 150 contract slice takes about 30 s.
`resync` in [`../../../server/src/feeds/book/VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) lines 225 to 244 terminates the whole socket, so one gap would re-seed the slice.
The unmerged stream is not worth its bandwidth: `ETH_USDT` alone sent 327 KB per second.

## 9. Source ledger

Retrieved 2026-09-15.
Pages on `www.mexc.com` were read with WebFetch, because that host answered `curl` from this machine with HTTP 403, see [`./rest.md`](./rest.md) section 1.

| id | title | URL | entity or region | sections supported |
|---|---|---|---|---|
| S1 | Native ws endpoint, MEXC Futures WebSocket API | https://www.mexc.com/api-docs/futures/websocket-api/native-ws-endpoint | MEXC, global | 1, 3 |
| S2 | Command details for data exchange | https://www.mexc.com/api-docs/futures/websocket-api/command-details-for-data-exchange | MEXC, global | 3, 5 |
| S3 | Order book depth | https://www.mexc.com/api-docs/futures/websocket-api/order-book-depth | MEXC, global | 2, 3 |
| S4 | Incremental Order Book Maintenance Mechanism | https://www.mexc.com/api-docs/futures/websocket-api/incremental-order-book-maintenance-mechanism | MEXC, global | 3, 4 |
| S5 | Tickers | https://www.mexc.com/api-docs/futures/websocket-api/tickers | MEXC, global | 2, 5 |
| S6 | Login authentication | https://www.mexc.com/api-docs/futures/websocket-api/login-authentication | MEXC, global | 3, 7 |
| S7 | Subscription filtering | https://www.mexc.com/api-docs/futures/websocket-api/subscription-filtering | MEXC, global | 7 |
| S8 | Futures API change log | https://www.mexc.com/api-docs/futures/update-log | MEXC, global | 2, 3, 5 |
| S9 | MXC Contract API, older docs | https://mexcdevelop.github.io/apidocs/contract_v1_en/ | MEXC, global | 2, 3, 5 |
| S10 | Get Contract Order Book Depth | https://www.mexc.com/api-docs/futures/market-endpoints/get-contract-order-book-depth | MEXC, global | 3 |
| S11 | CCXT Pro 4.5.68 `mexc.js` | `server/node_modules/ccxt/js/src/pro/mexc.js` | CCXT | 1, 5, 7 |

| id | probe | observation |
|---|---|---|
| P1 | `mexc-ws-probe.mjs small silence` at 18:52 UTC | chains, rebuilt books, level order, size unit, full depth on two contracts, keepalive, silence, errors |
| P2 | `mexc-ws-probe.mjs batch batchfull channels` at 18:53 to 18:56 UTC | 150 contract slices on both depth channels, anchor channels, `gzip` false, `api.mexc.com/edge` |
| P3 | `mexc-ws-probe.mjs gzip` at 18:57 UTC | `gzip` true, `limit` 50, unknown method, repeated subscribe |
| P4 | the same script, runs at 07:15 to 07:29 UTC | silence, the merged slice and the full depth slice of the morning, and the exact merged match |
