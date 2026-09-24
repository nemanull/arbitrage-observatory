# BYDFi WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 from 20:25 to 20:51 Pacific time (2026-09-23 03:25 to 03:51 UTC), from the development host near Seattle.

This profile covers the public futures WebSocket of BYDFi (CCXT id `bydfi`) for every perpetual family, with the book channel in detail.
BYDFi replaced its trading system on 2026-09-22, see [`fees.md`](./fees.md).
The documented socket host no longer resolves, and the socket the new web app uses speaks MEXC's contract protocol, see [`../mexc/websocket.md`](../mexc/websocket.md).
The documented column below is the retired API's documentation, S1, because BYDFi publishes nothing for the live socket.
Every probed value comes from [`ws-probe.mjs`](../../../scripts/probes/venues/bydfi/ws-probe.mjs), P1, and sockets were opened with `perMessageDeflate: false`.

## 1. Endpoints

| family | URL | probed on 2026-09-22 |
|---|---|---|
| all futures, retired | `wss://stream.bydfi.com/v1/public/fapi`, from the documentation's API Domain page, S1, and CCXT Pro at `server/node_modules/ccxt/js/src/pro/bydfi.js` line 48 | `ENOTFOUND`, the host has no A record |
| all futures, retired | `wss://stream.bydfi.com/ws/<streamName>` and `/ws/stream?streams=…`, from the documentation's market data page, S1 | `ENOTFOUND` |
| USDT-M, USDC-M and coin-M | `wss://futures.bydfi.com/edge`, from the web app's bundle, S2 | open in 347 to 393 ms over three runs |

One socket carries every family.
`BTC_USDT`, `BTC_USDC` and `BTC_USD` were subscribed on one socket and each delivered.
`futures.bydfi.com` resolves to Cloudflare, 104.18.12.14 and 104.18.13.14, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

Live socket, probed with MEXC's method names.

| subscribe frame | push channel | depth and speed | probed |
|---|---|---|---|
| `{"method":"sub.depth.full","param":{"symbol":"BTC_USDT","limit":20}}` | `push.depth.full` | the whole top 5 or 20 levels per side on each push, a limit of 30 is refused | recommended, section 4 |
| `{"method":"sub.depth","param":{"symbol":"BTC_USDT"}}` | `push.depth` | merged deltas, the same as `"compress":true` | deltas only, no snapshot, 0 gaps |
| `{"method":"sub.depth","param":{"symbol":"BTC_USDT","compress":false}}` | `push.depth` | one version per frame, one level per frame | 3,717 to 6,898 frames in 30 s on `BTC_USDT` |
| `{"method":"sub.ticker","param":{"symbol":"BTC_USDT"}}` | `push.ticker` | about every 2 s | 10 frames in 20 s in both runs, carries `fairPrice`, `indexPrice`, `fundingRate`, `bid1`, `ask1` |
| `{"method":"sub.tickers","param":{}}` | `push.tickers` | an array of contracts per frame | 11 frames in 20 s in both runs, carries `fairPrice` and `indexPrice` |
| `{"method":"sub.index.price","param":{"symbol":"BTC_USDT"}}` | `push.index.price` | | 10 and 13 frames in 20 s |
| `{"method":"sub.fair.price","param":{"symbol":"BTC_USDT"}}` | `push.fair.price` | | 14 and 19 frames in 20 s |
| `{"method":"sub.funding.rate","param":{"symbol":"BTC_USDT"}}` | `push.funding.rate` | | 0 and 1 frames in 20 s, carries `rate` and `nextSettleTime` |
| `{"method":"sub.deal","param":{"symbol":"BTC_USDT"}}` | `push.deal` | per trade | 30 and 37 frames in 20 s |

Retired stream API, S1, not reachable.

| stream | payload | speed |
|---|---|---|
| `<symbol>@depth`, `<symbol>@depth@100ms` | incremental `depthUpdate` with `E`, `s`, `b`, `a` and no sequence field | 1,000 or 100 ms |
| `<symbol>@depth<levels>`, `<symbol>@depth<levels>@100ms` | limited depth of 10, 50 or 100 levels, same payload | 1,000 or 100 ms |
| `<symbol>@realTicker`, `@realTicker@1000ms` | last price, mark `m` and index `i` | 3,000 or 1,000 ms |
| `<symbol>@ticker`, `!ticker@arr`, `<symbol>@kline_<interval>` | 24 h ticker and candles | 2,000 and 1,000 ms |

CCXT Pro subscribes `<id>@depth100`, adding `@100ms` only when asked, at `pro/bydfi.js` lines 466 to 479, and treats every depth frame as a whole book at line 541.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented, retired API, S1 | probed, live socket |
|---|---|---|
| endpoint split axis | one URL | one URL for USDT, USDC and coin-M, section 1 |
| subscribe frame shape | `{"id": 1, "method": "SUBSCRIBE", "params": ["BTC-USDT@ticker"]}`, several streams per frame | `{"method":"sub.depth.full","param":{"symbol":"BTC_USDT","limit":20}}`, one contract per frame, 150 frames at 20 a second all acknowledged |
| unknown symbol expectation | Not publicly specified | `{"channel":"rs.error","data":"Contract [NOPE_USDT] not exists","ts":…}`, and the socket stays open |
| chunk unit and budget | 1,024 streams per connection | 150 contracts on one socket, 0 gaps, section 5 |
| keepalive mechanism | client `{"id": 1, "method": "ping"}`, answer `{"id": 1, "result": "pong"}` | client `{"method":"ping"}`, answer `{"channel":"pong","data":<ms>,"ts":<ms>}` in 101 to 114 ms |
| connection lifetime and maintenance notice | "Maximum heartbeat retention time: 1200s" | a socket with no client ping closed at 60.3 s idle and at 64.4 to 69.9 s while receiving depth, section 5. No notice frame seen |
| handshake and operation rate limits | 5 subscription messages per second and 300 per five minutes per IP | no refusal at 20 subscribe frames a second for 7.5 s |
| public market data authentication | none | none |
| message parse and routing | `e`, `s` | route on `channel`, then on the top level `symbol` |
| subscribe acknowledgement shape | `{"id": 312, "result": …}` | `{"channel":"rs.sub.depth.full","data":"success","ts":…}`, which names no contract. A repeated subscribe is acknowledged again |
| symbol identifier format | `BTC-USDT` | `BTC_USDT`, identical to the catalog `symbol` and to CCXT `mexc` `market.id`, see [`rest.md`](./rest.md) section 2. `BTC-USDT` gets `Contract [BTC-USDT] not exists` |
| number representation | strings | JSON numbers, levels `[price, size, orderCount]` |
| timestamp representation | `E` in ms | top level `ts` in ms on every push |
| size unit | Not publicly specified | contracts of CCXT `contractSize` base coins, section 4 |
| sequence semantics | none documented | `version` on every book frame, and on `push.depth` a `begin` and `end`, with `begin` equal to the previous `end` plus one, section 4 |
| idle repeat behaviour | Not publicly specified | `push.depth.full` resent an unchanged top 20 on 51 to 79 of 81 to 158 frames per contract. `push.depth` repeats nothing |

## 4. The book channel in detail

`push.depth.full` at 20 levels is the channel this profile recommends, the same choice as the MEXC feed at [`../../../server/src/venues/mexc/mexc.ts`](../../../server/src/venues/mexc/mexc.ts) line 15.

### Snapshot on subscribe

`push.depth.full` needs no snapshot, because every frame is the whole top of book: 20 bids and 20 asks on every frame of `BTC_USDT`, `ETH_USDT`, `BTC_USDC` and `BTC_USD` in all three 75 s runs.
`push.depth` sends no snapshot.
Its first frame held one ask and no bids for `ETH_USDT` in one run, and one bid at 86,586.2, far under a touch near 86,749, for `BTC_USDT` in another, so a feed on that channel must seed each contract from the REST book, see [`rest.md`](./rest.md) section 5.
The REST book carries the same `version` counter: in the last run the REST read at version 1283318717 matched the `end` of a `push.depth` frame exactly.

### Delta semantics on `push.depth`

A frame carries `bids` and `asks` of `[price, size, orderCount]`, and a size of 0 deletes the level.
The merged form, the default, packed several versions into 45 to 84 of 68 to 129 frames per contract in 72 s, with `version` equal to `end` on every frame.
The unmerged form, `"compress":false`, sent one level per frame with `begin`, `end` and `version` equal.

### Sequence and gap rule

```text
push.depth.full    any frame   replace the book, and drop a frame whose version is below the last applied
push.depth         begin = lastEnd + 1    apply, lastEnd = end
push.depth         begin ≠ lastEnd + 1    gap: resync
```

`push.depth.full` versions only rose, by 1 to 740 between frames, with 0 backward steps.
On `push.depth` the begin rule held on every frame, 0 gaps on five contracts over 72 s in two runs and 0 gaps across 150 contracts over 60 s.

### Checksum

None documented and none on the wire.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `push.depth.full` | descending on every frame | ascending on every frame |
| `push.depth` | unordered in 42 to 74 of 68 to 129 frames per contract | unordered in 41 to 76 frames |
| REST `depth` | descending | ascending |

A feed on `push.depth` applies levels by price, never by position.

### Size unit against CCXT `contractSize`

The unit is contracts.
On `BTC_USDT` the socket's full book and the REST book agreed on 10 of 10 of the top 5 levels per side in all three runs, twice at the same version and once one version apart, for example `[86748.9, 70165, 1]` on both.
One contract of `BTC_USDT` is 0.0001 BTC, CCXT `contractSize`, so 70,165 contracts is 7.0 BTC.
The engine's `sizeMul` would convert these sizes correctly for linear contracts.
For coin-M contracts see [`rest.md`](./rest.md) section 2.

### Push cadence and pauses

Four sockets each held one form of the `BTC_USDT` book for 30 s, in three runs.

| form | frames in 30 s | median interval | longest pause |
|---|---:|---:|---:|
| `sub.depth` default | 31, 41 and 24 | 194 to 199, and 148 ms | 4,002, 7,045 and 6,634 ms |
| `sub.depth` `"compress":true` | 31, 41 and 24 | 194 to 199, and 148 ms | 4,002, 7,045 and 6,634 ms |
| `sub.depth` `"compress":false` | 6,195, 6,898 and 3,717 | 0 ms | 4,002, 7,045 and 6,634 ms |
| `sub.depth.full` limit 20 | 42, 47 and 34 | 93, 179 and 89 ms | 3,954, 6,827 and 6,404 ms |

The pauses began at the same instant on all four sockets, so they are pauses of the book itself and not of the feed.
In the second run the book did not change for 3.4 s, 2.6 s, 7.0 s, 2.3 s and 3.6 s, and in the third for 6.6 s twice within 15 s.
Between pauses the unmerged form carried up to 1,204 level changes in one second.
A live `BTC_USDT` book on the most liquid contract that stands still for seconds and then rewrites hundreds of levels looks like a quoting program rather than a crowd.
The `BTC_USD` REST book mirrored its sizes in the first read, 16,253, 19,959, 19,031, 19,402 and 17,825 at the same distance on both sides, and only the touch, 15,754, in the second, see [`rest.md`](./rest.md) section 5.
Both are observations of one evening, not a verdict on the liquidity.

### One-sided and empty books

No ticker row had a zero `bid1` or `ask1` on 2026-09-22, see [`rest.md`](./rest.md) section 3, so what the socket sends for an empty side is Not verified.

### Idle repeats

`push.depth.full` resends the unchanged top 20 when a deeper level moves: 58 of 89 `BTC_USDT` frames, 51 of 100 `ETH_USDT`, 67 of 107 `BTC_USDC` and 71 of 93 `BTC_USD` in the second 75 s run, and 79 of 128, 51 of 158, 64 of 120 and 56 of 99 in the third.

### Unknown, closed and wrong-level symbols

| request | reply | then |
|---|---|---|
| `sub.depth` `NOPE_USDT` | `rs.error` `Contract [NOPE_USDT] not exists` | socket stays open |
| `sub.depth` `BTC-USDT`, the retired spelling | `rs.error` `Contract [BTC-USDT] not exists` | socket stays open |
| `sub.depth.full` limit 30 | `rs.error` `Not support limit` | |
| `sub.nope` | no reply in 2 s | |
| `sub.depth` `BTC_USDT` a second time | `rs.sub.depth` `success` again | |
| text that is not JSON | `rs.error` `invalid message` | socket stays open |

All 266 contracts were in state 0, so a closed contract was not available to probe.

## 5. Session

| item | documented, retired API, S1 | probed, live socket |
|---|---|---|
| keepalive | client ping, `result` `pong` | client `{"method":"ping"}` every 15 s, pong in 101 to 114 ms, no server ping seen |
| silence the server tolerates | 1,200 s heartbeat retention | no subscription and no ping: closed at 60.3 s with 1006 in both runs. A depth subscription and no ping: closed at 64.4 and 69.9 s with 1005, after 78 frames each time. A ping every 20 s and no subscription: still open at 75.5 s in both runs, when the probe closed it |
| forced disconnect | Not publicly specified | none in 75 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames only, 0 binary frames. A client that offered permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | | 347 to 393 ms to open |
| subscription limits | 5 per second, 300 per five minutes, 1,024 streams per connection | 150 subscribe frames at 20 a second on one socket, all acknowledged |
| throughput | | 150 USDT contracts with the largest 24 h turnover on `sub.depth`, two runs: 9,530 and 9,651 frames in 60 s, median 146 and 142 and peak 233 and 336 frames per second, 570 and 557 bytes per frame, 17.8 and 18.8 µs `JSON.parse` per frame |

The book's own pauses mean traffic cannot stand in for the keepalive, and the server closes a socket without pings at about 60 s even while depth flows.

## 6. Captured frames

Trimmed, from the third probe run at 03:47 to 03:49 UTC on 2026-09-23.
Level arrays are cut to three levels per side.

Subscribe and acknowledgement.

```json
{"method": "sub.depth.full", "param": {"symbol": "ETH_USDT", "limit": 20}}
```

```json
{"channel":"rs.sub.depth.full","data":"success","ts":1790135223545}
```

Full book.

```json
{"symbol":"ETH_USDT","data":{"asks":[[2776.61,36016,1],[2776.62,1698,1],[2776.63,2371,1]],"bids":[[2776.6,5750,1],[2776.59,39,1],[2776.58,38,1]],"version":1206941898},"channel":"push.depth.full","ts":1790135223632}
```

First `push.depth` frame after subscribing, a delta far from the touch.

```json
{"symbol":"BTC_USDT","data":{"asks":[],"bids":[[86586.2,567414,1]],"end":1283314797,"begin":1283314797,"version":1283314797},"channel":"push.depth","ts":1790135223554}
```

Keepalive.

```json
{"method": "ping"}
```

```json
{"channel":"pong","data":1790135238548,"ts":1790135238548}
```

Errors.

```json
{"channel":"rs.error","data":"Contract [NOPE_USDT] not exists","ts":1790135226799}
```

```json
{"channel":"rs.error","data":"Not support limit","ts":1790135230789}
```

Index, mark, funding and ticker.

```json
{"symbol":"BTC_USDT","data":{"symbol":"BTC_USDT","price":86782.7},"channel":"push.index.price","ts":1790135331029}
```

```json
{"symbol":"BTC_USDT","data":{"symbol":"BTC_USDT","price":86748.6},"channel":"push.fair.price","ts":1790135333736}
```

```json
{"symbol":"BTC_USDT","data":{"symbol":"BTC_USDT","rate":0.00004,"nextSettleTime":1790150400000},"channel":"push.funding.rate","ts":1790135340794}
```

```json
{"symbol":"BTC_USDT","data":{"symbol":"BTC_USDT","lastPrice":86748.6,"fairPrice":86748.6,"indexPrice":86782.7,"timestamp":1790135334004,"bid1":86748.6,"ask1":86748.7,"fundingRate":0.000041},"channel":"push.ticker","ts":1790135334004}
```

The ticker frame is cut to the fields shown, and the funding frame's `rate` of 0.00004 arrived 7 s after the ticker's `fundingRate` of 0.000041.

## 7. Private channels

Named for a future execution stage, not probed.

- Retired API: a `LOGIN` method on the same socket and the events `ORDER_TRADE_UPDATE` and `ACCOUNT_UPDATE`, as CCXT Pro builds them at `pro/bydfi.js` lines 131 and 1049 to 1052.
- Live socket: Not publicly specified.
  The MEXC protocol it follows has a `login` method and personal channels, see [`../mexc/websocket.md`](../mexc/websocket.md) section 7, and whether BYDFi issues API keys that work on it is Not verified.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://futures.bydfi.com/edge` | one socket carries every family |
| channel | `sub.depth.full` with `limit` 20 | a whole top of book per frame, no seed and no gap rule, and 20 levels matches the engine's `depthLevels` |
| markets per connection | 150 | 150 contracts ran on one socket with 0 gaps, and no cap is published for this socket |
| subscribe frames | one frame per contract, 50 ms apart | one contract per frame, and 20 a second was never refused |
| keepalive | `{"method":"ping"}` every 15 s | the server closes a socket without pings at about 60 s |
| `maxSilenceMs` | 45,000 | the pong is the traffic the watch relies on, since the book pauses for seconds |
| routing | top level `symbol` is the `rawMarketId` | identical to the catalog id |
| snapshot | every `push.depth.full` frame: `resetBook` | whole top of book |
| stale frame | drop a frame whose `version` is below the last applied | versions only rose in the probe |
| resync | none needed on the full channel, and on `push.depth` a `begin` that is not the previous `end` plus one | section 4 |
| receive time | stamp on arrival | |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |
| reuse | the MEXC feed with its URL constant changed | the protocol, channel, frame shapes, keepalive and silence behaviour matched MEXC's on every item probed |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BYDFi API documentation, archived: "WebSocket Market Data Push", captured 2026-04-22, and "API Domain" | https://web.archive.org/web/20260422075301/https://developers.bydfi.com/en/futures/websocket-market | 2026-09-22 | BYDFi, global | the retired stream API, sections 1 to 3 and 5 |
| S2 | BYDFi futures web app page, JavaScript bundle | https://www.bydfi.com/futures/BTC_USDT | 2026-09-22 | BYDFi, global | the `wss://futures.bydfi.com/edge` URL, section 1 |
| S3 | CCXT Pro 4.5.68 `bydfi.js` | `server/node_modules/ccxt/js/src/pro/bydfi.js` | 2026-09-22 | CCXT | retired URL, depth handling, private events, sections 1, 2 and 7 |
| P1 | `ws-probe.mjs` modes `legacy`, `book`, `cadence`, `batch`, `silence`, `deflate` and `channels`, two to three runs each between 03:25 and 03:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bydfi/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 |
