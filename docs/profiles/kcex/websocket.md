# KCEX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 US Pacific time, which is 03:32 to 03:57 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the futures WebSocket of KCEX, which has no CCXT class, for both perpetual families, with the book channel in detail.
KCEX publishes no API documentation, so no value in this file is documented by the venue.
The URL and the method names come from the futures web app's JavaScript bundle, S1, and every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/kcex/ws-probe.mjs).
The protocol has the same method names, frame shapes and `version` rule as the MEXC contract socket in [`../mexc/websocket.md`](../mexc/websocket.md), with the differences named in sections 4 and 5.
The User Agreement forbids automated access without KCEX's consent, see [`fees.md`](./fees.md) section 1.

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| USDT-M perpetuals | `wss://www.kcex.com/fapi/edge` | open in 240 to 274 ms over six logged opens through CloudFront `SEA900-P5`, with a User-Agent header |
| USDC-M perpetuals | the same URL | `BTC_USDC` delivered 2,616 `push.depth` frames in about 8 s on the socket that also carried `ETH_USDT` and `SOL_USDT` |
| spot | `wss://wbs.kcex.com`, the web app's `mainSocketUrl` | not probed beyond one curl handshake to `wss://wbs.kcex.com/ws` without a User-Agent, which answered 403 |

The web app builds the futures URL as `"wss://" + document.location.hostname + "/fapi/edge"`, S1.
One socket carries both settlement families.
A handshake without a `User-Agent` header is refused with HTTP 403 by an S3 origin behind CloudFront, whose body is a maintenance page reading "The system is temporarily unavailable for maintenance", in three of three runs of P7.
The same request with any User-Agent upgrades with 101.
The engine opens sockets with no headers at `server/src/feeds/book/VenueFeed.ts` line 81, so it would be refused as it stands.

## 2. Channel matrix for public market data

| method | param | push channel | probed on 2026-09-23 |
|---|---|---|---|
| `sub.depth` | `{"symbol": "BTC_USDT"}`, optional `compress` | `push.depth` | deltas only, no snapshot. One `version` per frame, recommended with `compress` false or absent |
| `sub.depth` with `compress: true` | | | acknowledged as success, then no frame in 5 s on `BTC_USDT` in three of three runs |
| `sub.depth.full` | `{"symbol", "limit"}` | `push.depth.full` | limits 10, 50 and 100 deliver whole books. Limits 5 and 20 answer `rs.error` "Not support limit" |
| `sub.depth.step` | `{"symbol", "step"}` | `push.depth.step` | used by the web app for price-grouped books, S1, not probed |
| `sub.deal` | `{"symbol"}` | `push.deal` | 11 to 15 trade frames in 5 to 8 s on `DOGE_USDT` |
| `sub.ticker` | `{"symbol"}` | `push.ticker` | 36 frames in 79 s on `BTC_USDT`, median gap 2,161 and 2,178 ms, carries `indexPrice`, `fairPrice` and `fundingRate` |
| `sub.tickers` | `{}` | `push.tickers` | 37 frames in 79 s, median gap 2,156 to 2,181 ms, 262 to 847 rows per frame, 847 distinct symbols. Rows carry `indexPrice` and `fairPrice` but no funding rate |
| `sub.index.price` | `{"symbol"}` | `push.index.price` | 46, 80 and 32 frames in 79 s on `BTC_USDT`, median gap 852, 713 and 1,397 ms, longest 9,932, 5,641 and 8,269 ms |
| `sub.fair.price` | `{"symbol"}` | `push.fair.price` | 42, 64 and 31 frames in 79 s, median gap 1,550, 803 and 2,692 ms, longest 5,468, 8,268 and 8,273 ms |
| `sub.funding.rate` | `{"symbol"}` | `push.funding.rate` | 1 frame in 79 s in each run, `{"rate", "nextSettleTime"}` |
| `sub.kline`, `sub.kline.index.price`, `sub.kline.fair.price`, `sub.tick.list`, `sub.tick.batch` | | | used by the web app, S1, not probed |

`push.tickers` carried one symbol that the catalog call does not list, `BUN_USDT`, in the second and third runs.
The anchor channels are one stream per contract, except `push.tickers`, which covers every contract about every 2.2 s without the funding rate, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
KCEX documents none of them, so the documented column says so once per row.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | none published | one URL for USDT-M and USDC-M, section 1 |
| subscribe frame shape | none published. The web app sends `{"method": "sub.depth.full", "param": {"symbol": t, "limit": 100}}`, S1 | one method and one symbol per frame. Of seventeen frames sent in one burst, all fifteen well-formed ones were answered |
| unknown symbol expectation | none published | `{"channel":"rs.error","data":"Contract [NOPE_USDT] not exists","ts":…}`. An unknown method `sub.nope` and a text that is not JSON got no reply, and the socket stayed open |
| chunk unit and budget | none published | 100 `sub.depth` frames sent in one burst, 100 acknowledgements, no refusal |
| keepalive mechanism | none published. The web app sends `{"method":"ping"}` on a timer, S1 | `{"channel":"pong","data":<ms>,"ts":<ms>}` in 96 to 115 ms. No server protocol ping on any socket |
| connection lifetime and maintenance notice | none published | no forced disconnect in 120 s on a socket that pinged. No maintenance notice seen |
| handshake and operation rate limits | none published | no refusal at four opens at once in P6, or at 100 subscribes in one burst |
| public market data authentication | none published | none, but a User-Agent header is required, section 1 |
| message parse and routing | none published | every push has top-level `symbol`, `data`, `channel` and `ts`. Route on `channel`, then `symbol` |
| subscribe acknowledgement shape | none published | `{"channel":"rs.sub.depth","data":"success","ts":…}`, with no symbol in it. A repeated subscribe is acknowledged again. `unsub.depth` got no acknowledgement within 1 s or 3 s |
| symbol identifier format | none published | `BTC_USDT`, identical to the catalog `symbol` and to the anchor calls, see [`rest.md`](./rest.md) section 2 |
| number representation | none published | JSON numbers for price, size, order count and `version` |
| timestamp representation | none published | `ts` in Unix ms on every frame. The first `push.index.price` and `push.fair.price` after a subscribe carry the last value with its old `ts`, 4.8 s and 1.2 s old in the second run, 8.6 s old for the fair price in the first |
| size unit | none published | contracts, and one contract is the catalog's `contractSize` coins, section 4 |
| sequence semantics | none published | `version` of each delta equals the previous `version` plus 1, section 4 |
| idle repeat behaviour | none published | no repeated `version` on any stream. A quiet book sends nothing between changes |

## 4. The book channel in detail

`sub.depth` without `compress`, or with `compress: false`, is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

None.
The first frame after the acknowledgement is a delta, as on MEXC.
A book is seeded from `GET https://www.kcex.com/fapi/v1/contract/depth/{symbol}?limit=100`, whose reply carries the book's `version`.
In P4 the probe buffered the deltas for 1.5 s, read that call, dropped every buffered delta at or below its `version`, and applied the rest.

| run | contract | buffered | dropped | first applied `version` |
|---|---|---:|---:|---|
| 03:32 UTC | `BTC_USDT` | 264 | 259 | seed plus 1 |
| 03:32 UTC | `ETH_USDT`, `US100_USDT` | 92, 60 | all | the next live delta, with no gap |
| 03:41 UTC | `BTC_USDT` | 194 | 189 | seed plus 1 |
| 03:41 UTC | `ETH_USDT` | 213 | 206 | seed plus 1 |
| 03:41 UTC | `COOL_USDT` | 144 | 144 | the next live delta, with no gap |
| 03:55 UTC | `BTC_USDT`, `SOCK_USDT` | 76, 144 | 72, 142 | seed plus 1 |
| 03:55 UTC | `ETH_USDT` | 188 | 188 | the next live delta, with no gap |

`sub.depth.full` pushes a whole book of 10, 50 or 100 levels per side with its `version`, and could seed a book instead of the REST call.
Its frames arrived 76 to 182 times in 79 s per contract, with the `version` advancing by 1 to 120 between frames, so it is a conflated snapshot stream.
Whether its `version` aligns with `push.depth` on the same contract was not tested.

### Delta semantics

A delta carries `bids` and `asks` arrays of `[price, size, orderCount]` and one `version`.
Almost every frame changes one level on one side, and the other array is empty.
The largest delta seen, in P7, held 7 levels.
A size of 0 deletes the level.
The deltas cover the whole book, not a window: a `BTC_USDT` book seeded with 100 levels per side grew to 263, 203 and 168 levels as deltas arrived in the three runs.

### Sequence and gap rule

```text
version = last + 1      apply, last = version
version <= last         already applied, drop (seen only while seeding)
version > last + 1      gap: re-seed
```

| run | stream | deltas applied | gaps |
|---|---|---:|---:|
| P4, 03:32 UTC | `BTC_USDT`, `ETH_USDT`, `US100_USDT` | 7,609, 7,328, 2,572 | 0 |
| P4, 03:41 UTC | `BTC_USDT`, `ETH_USDT`, `COOL_USDT` | 18,956, 27,827, 2,228 | 1 on `BTC_USDT`, 0 on the others |
| P4, 03:55 UTC | `BTC_USDT`, `ETH_USDT`, `SOCK_USDT` | 5,012, 8,892, 2,916 | 0 |
| P5, 03:34 UTC | 100 USDT contracts | 207,376 frames | 0 |
| P5, 03:43 UTC | 100 USDT contracts | 201,929 frames | 0 |

The one gap was a `version` more than 1 above the last, on the `compress: false` stream.
Its position was not logged, and the probe logs gap details since that run.
The rebuilt `BTC_USDT` book still matched the REST book at an exact `version` on all three later reads of that run.
No frame of any run had `begin` and `end` fields, the merged form MEXC sends by default.
`compress: true`, which on MEXC selects the merged form, is acknowledged and then silent on KCEX, section 2.

### Checksum

None.
No frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| delta | descending on every delta with more than one bid, 0 unordered in about 83,000 applied deltas | ascending, 0 unordered |
| `push.depth.full` | best first, descending | best first, ascending |
| REST `depth` | descending, at every limit | ascending |

### Size unit against the catalog `contractSize`

CCXT has no KCEX class, so the catalog's `contractSize` from `GET /fapi/v1/contract/detail` stands in for CCXT's.
The probe kept the top 20 levels of each rebuilt book at every `version`, then read the REST book with `limit=20` and compared at the `version` REST reported.

| run | reads | at an exact `version` | levels equal in price and size |
|---|---:|---:|---|
| 03:32 UTC | 9, on `BTC_USDT`, `ETH_USDT`, `US100_USDT` | 9 | 40 of 40 on every read |
| 03:41 UTC | 9, on `BTC_USDT`, `ETH_USDT`, `COOL_USDT` | 9 | 40 of 40 on every read |
| 03:55 UTC | 9, on `BTC_USDT`, `ETH_USDT`, `SOCK_USDT` | 9 | 40 of 40 on every read |

The socket and REST therefore use one unit, the contract.
`BTC_USDT` has `contractSize` 0.0001, so an ask level of `1096599` contracts is about 109.7 BTC, `ETH_USDT` has 0.001, `COOL_USDT` has 100, see [`rest.md`](./rest.md) section 2.
A feed multiplies sizes by the catalog `contractSize`, which is what the engine's `sizeMul` does with CCXT's value.

### One-sided and empty books

A delta with one side empty is the normal frame.
No book was seen with a side empty, so what the channel sends for an empty side is Not verified.

### Idle repeats

Nothing is repeated.
The quiet contracts went up to 4,231 ms (`US100_USDT`), 3,943 ms (`COOL_USDT`) and 3,880 ms (`SOCK_USDT`) without a frame, and `BTC_USDT` up to 1,192 ms.
No `version` repeated on any stream, and a second subscribe to `ETH_USDT` on the same socket did not duplicate its frames in the 03:41 run.

### Unknown, closed and wrong-parameter symbols

| request | reply | then |
|---|---|---|
| `sub.depth` `NOPE_USDT` | `rs.error` "Contract [NOPE_USDT] not exists" | nothing |
| `sub.depth.full` limit 5 or 20 | `rs.error` "Not support limit", naming no symbol | nothing |
| `sub.depth` with `compress: true` | `rs.sub.depth` success | nothing in 5 s |
| `sub.depth` `ETH_USDT` twice | a second success | frames continue, not duplicated |
| `sub.nope` | no reply | the socket stays open |
| text that is not JSON | no reply | the socket stays open |

A closed or delisted contract was not available to probe, since all 846 catalog rows had `state` 0.
The four hidden contracts, `NET_USDT`, `DN_USDT`, `DMC_USDT` and `ASTEROID_USDT`, were not subscribed.

## 5. Session

| item | probed |
|---|---|
| keepalive | the client sends `{"method":"ping"}`, the server answers `{"channel":"pong","data":<ms>,"ts":<ms>}` in 96 to 115 ms. The server sent no protocol ping on any socket |
| silence the server tolerates | a socket that sends nothing is closed whatever it receives. In P6 at 03:36 UTC three such sockets closed at 24.73 to 24.93 s, one with no subscription, one on a quiet book and one on `BTC_USDT` receiving 3,529 frames. At 03:44 UTC all four sockets closed at 19.00 to 19.62 s, including the one due to ping at 20 s. The last frame before each close was `{"channel":"rs.error","data":"more than 15 seconds no response, close the channel"}`, followed by close code 1005 |
| ping interval that survives | a ping every 20 s kept a socket for the full 120 s at 03:36 and lost it at 19 s at 03:44, so the rule is 15 s since the last client message, checked every few seconds |
| forced disconnect | none in 120 s on a pinging socket, and none in 80 s on the book sockets, which pinged every 10 s |
| maintenance notice | none seen. The refusal page for a handshake without a User-Agent is a maintenance page, section 1 |
| compression | text JSON frames only, 0 binary frames. A client that offered permessage-deflate got no `sec-websocket-extensions` header back in three runs, so the server does not negotiate it. `gzip: true` in `sub.depth` changed nothing |
| handshake | 240 to 274 ms to open, and 403 without a User-Agent |
| subscription limits | none reached at 100 contracts on one socket |
| throughput | 100 USDT contracts, every eighth by 24 h volume: 3,456 and 3,365 frames per second, median 3,404 and 3,439, peak 4,938 and 4,822, 437.5 and 426.2 KB per second, 130 bytes per frame, 1.6 µs `JSON.parse` per frame |

The sample of 100 spans the whole volume ranking, so the full catalog of 846 contracts is roughly eight times that load, near 28,000 frames per second.
That figure is an extrapolation, not a measurement.

## 6. Captured frames

Trimmed, from P4 at 03:41 UTC and P6 at 03:44 UTC.
Arrays marked `…` are cut.

Subscribe, and its acknowledgement.

```json
{"method": "sub.depth", "param": {"symbol": "BTC_USDT", "compress": false}}
```

```json
{"channel":"rs.sub.depth","data":"success","ts":1790134886366}
```

Deltas, one level each, with consecutive versions.

```json
{"symbol":"BTC_USDT","data":{"asks":[[86857.8,812698,4]],"bids":[],"version":14522504125},"channel":"push.depth","ts":1790134886748}
```

```json
{"symbol":"BTC_USDT","data":{"asks":[[86857.9,32499,2]],"bids":[],"version":14522504126},"channel":"push.depth","ts":1790134886748}
```

A whole book from `sub.depth.full` at limit 10, first three levels per side kept.

```json
{"symbol":"XRP_USDT","data":{"asks":[[1.6214,11128,1],[1.6215,11343,1],[1.6216,35427,2]],"bids":[[1.6212,3794,1],[1.6211,5312,1],[1.6209,6422,1]],"version":3883459536},"channel":"push.depth.full","ts":1790134886587}
```

Keepalive.

```json
{"method": "ping"}
```

```json
{"channel":"pong","data":1790134357454,"ts":1790134357454}
```

Errors.

```json
{"channel":"rs.error","data":"Contract [NOPE_USDT] not exists","ts":1790134206692}
```

```json
{"channel":"rs.error","data":"Not support limit","ts":1790134886369}
```

```json
{"channel":"rs.error","data":"more than 15 seconds no response, close the channel","ts":1790135080175}
```

Anchor channels, where the index frame arrived 4.8 s after its `ts`.

```json
{"symbol":"BTC_USDT","data":{"symbol":"BTC_USDT","price":86900.5},"channel":"push.index.price","ts":1790134881587}
```

```json
{"symbol":"BTC_USDT","data":{"symbol":"BTC_USDT","price":86863.6},"channel":"push.fair.price","ts":1790134885147}
```

```json
{"symbol":"BTC_USDT","data":{"symbol":"BTC_USDT","rate":0.000041,"nextSettleTime":1790150400000},"channel":"push.funding.rate","ts":1790134920974}
```

One row of `push.tickers`.

```json
{"channel":"push.tickers","data":[{"amount24":47486.8857,"fairPrice":0.02,"high24Price":0.02007,"indexPrice":0.01998,"lastPrice":0.02002,"lower24Price":0.01925,"maxBidPrice":0.02397,"minAskPrice":0.01598,"riseFallRate":0.0229,"symbol":"OGN_USDT","timestamp":1790134884691,"volume24":241444}]}
```

## 7. Private channels

Named for a future execution stage, from the web app bundle, S1, not probed.

- Pushes named in the bundle: `push.personal.order`, `push.personal.position`, `push.personal.asset`, `push.personal.plan.order`, `push.personal.stop.order`, `push.personal.stop.planorder`, `push.personal.track.order`, `push.personal.adl.level`, `push.personal.risk.limit`, `push.personal.liquidate.risk`, `push.personal.leverage.mode`, `push.personal.position.mode`.
- The web app fetches a socket token from `https://www.kcex.com/uc/user_api/ws_token`, which needs a login.
- No public documentation of order entry or of API keys exists, although the web bundle has "API Management" strings and error texts such as "Create up to {max} APIKey".

## 8. Recommended feed shape

A recommendation for a later design, not a decision, and it depends on KCEX's consent to automated access, see [`fees.md`](./fees.md) section 1.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://www.kcex.com/fapi/edge`, for USDT-M and USDC-M | one socket served both families |
| handshake | send a `User-Agent` header | without it the handshake is refused with 403. This is a change to `VenueFeed.openConnection`, which passes no headers at `server/src/feeds/book/VenueFeed.ts` line 81 |
| channel | `sub.depth` with no `compress` field, one frame per contract | unmerged deltas with a strict `version` chain. `compress: true` is silent |
| seed | after subscribing, read `GET /fapi/v1/contract/depth/{symbol}?limit=100`, drop buffered deltas at or below its `version`, and apply the rest | there is no snapshot on subscribe. This REST seed is a change to the feed base, which today relies on a snapshot on the socket |
| markets per connection | 100 | 100 ran with 0 gaps at about 3,400 frames per second, and no cap is published |
| keepalive | `{"method":"ping"}` every 5 s | the server closes a socket whose client has been silent 15 s, checked at 19 to 25 s. The web app creates its socket with a heart check interval of 5,000 ms, S1 |
| `maxSilenceMs` | 20,000 | four missed pongs. The pong counts as traffic, and the quietest book went 4.2 s without a frame |
| routing | `frame.symbol` is the `rawMarketId` | the catalog `symbol` is spelled the same |
| delta | apply only when `version === last + 1`, then store `version` | observed rule, 1 gap in about 493,000 deltas over all runs |
| resync | a gap, or a delta before the seed: `resync`, which terminates the socket at `server/src/feeds/book/VenueFeed.ts` line 314, then re-seed every contract of the slice from REST | a new socket has no snapshot either |
| sizes | multiply by the catalog `contractSize` | contracts on the wire, section 4 |
| receive time | stamp on arrival, never from `ts` | the first index and fair frames after a subscribe carry an old `ts` |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

The re-seed cost is the weak point.
A gap on one contract terminates a socket of 100, and 100 REST depth reads follow at a rate limit KCEX does not publish, see [`rest.md`](./rest.md) section 6.
`sub.depth.full` at limit 50 would avoid the REST calls if its `version` aligns with the deltas, which is the first thing a later probe should test.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | KCEX futures web app, version 3.8.19, page chunk for `/futures/exchange/[symbol]` | https://www.kcex.com/main-static/web-futures/v3.8.19/_next/static/chunks/app/[locale]/futures/exchange/[symbol]/page-74b670118466f89c.js | 2026-09-22 | KCEX, global | socket URL, method and channel names, ping, heart check interval, private channel names, sections 1 to 8 |
| S2 | MEXC WebSocket profile | [`../mexc/websocket.md`](../mexc/websocket.md) | 2026-09-15 | MEXC | the same protocol family, merged frames, sections 4 and 8 |
| S3 | `VenueFeed.ts` | [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) | 2026-09-22 | this repository | no headers on open at line 81, `resync` terminates at line 314, section 8 |
| P4 | `ws-probe.mjs book`, three runs at 03:32, 03:41 and 03:55 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/kcex/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 |
| P5 | `ws-probe.mjs batch`, two runs at 03:34 and 03:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/kcex/ws-probe.mjs) | 2026-09-22 | this host | gaps and throughput on 100 contracts, sections 3 to 5 |
| P6 | `ws-probe.mjs silence`, two runs at 03:36 and 03:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/kcex/ws-probe.mjs) | 2026-09-22 | this host | silence rule, section 5 |
| P7 | `ws-probe.mjs deflate`, three runs at 03:35, 03:44 and 03:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/kcex/ws-probe.mjs) | 2026-09-22 | this host | deflate, User-Agent refusal, `compress` and `gzip`, USDC on the same socket, unsubscribe, sections 1, 2 and 5 |

The REST seed and compare calls in P4 are the same `depth` call that [`rest-probe.mjs`](../../../scripts/probes/venues/kcex/rest-probe.mjs) measures in its `book` mode.
