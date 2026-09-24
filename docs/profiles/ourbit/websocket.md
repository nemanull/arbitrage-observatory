# Ourbit WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 01:33 to 01:53 UTC), from the development host near Seattle.

This profile covers the public futures WebSocket of Ourbit, which has one perpetual family, USDT-M, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/ourbit/ws-probe.mjs), and the capture is quoted beside the documented value.
The only document that describes the socket is the old contract API v1 doc, which Ourbit no longer serves, see [`fees.md`](./fees.md) source S11.
The protocol is the MEXC contract WebSocket, with the same methods, channels and frame shapes.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Sockets were held about 11 minutes in total over all runs.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals | `wss://contract.ourbit.com/edge`, "ws base url update" of 2024-01-31, S1 | the host is NXDOMAIN from this machine. `wss://futures.ourbit.com/edge` opened in 328 to 419 ms over 24 opens and serves every channel below |
| same, second path | Not publicly specified | `wss://futures.ourbit.com/ws` opened in 377 ms and answered `ping` and `sub.ticker` the same way |
| spot | Not documented in the contract doc | `wss://wbs.ourbit.com/ws` answered `{"id":0,"code":0,"msg":"PONG"}` and `{"id":0,"code":0,"msg":"sub.ticker is not supported."}`, so it is the spot socket with another protocol |

One socket carries the whole USDT-M family, which is the only perpetual family, see [`rest.md`](./rest.md) section 2.
`futures.ourbit.com` sits behind Cloudflare, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | subscribe | depth and speed | probed on 2026-09-23 UTC |
|---|---|---|---|
| `sub.depth` | `{"method":"sub.depth","param":{"symbol":"BTC_USDT"}}` | every change, one level per frame | no snapshot. 132 frames per second on `BTC_USDT` over 75 s, and a whole book of 340 bids and 235 to 238 asks kept from a REST seed |
| `sub.depth` merged | the same with `"compress":true` in `param` | changes merged into one frame per window | no snapshot. Frames carry `begin` and `end` in place of `version`. Median 207 to 213 ms between frames on busy books, 262 to 291 ms on quiet ones |
| `sub.depth.full` | `{"method":"sub.depth.full","param":{"symbol":"BTC_USDT","limit":20}}` | "Limit could be 5, 10 or 20, default 20", S1. 50 is also accepted | a whole top 20 book every push. Median 171 ms between pushes on `BTC_USDT` in both runs, 810 and 1,462 ms on `HEI_USDT` |
| `sub.ticker` | `{"method":"sub.ticker","param":{"symbol":"BTC_USDT"}}` | "send once a second", S1 | 12 frames in 25 s in both runs, with `fairPrice`, `indexPrice` and `fundingRate` |
| `sub.tickers` | `{"method":"sub.tickers","param":{}}` | "Send once a second", S1 | 13 frames in 25 s in both runs. The first carried 808 rows in run 1 and 735 in run 2, and later ones only the rows that changed (138 to 420). No `fundingRate` field |
| `sub.fair.price` | per symbol | on change | run 2: `BTC_USDT` 59 frames in 25 s, `HEI_USDT` 2. Run 1 counted 51 for both together |
| `sub.index.price` | per symbol | on change | run 2: `BTC_USDT` 18 frames in 25 s, `HEI_USDT` 1. Run 1 counted 39 for both together |
| `sub.funding.rate` | per symbol | on change | `BTC_USDT` 0 frames in 25 s in run 1 and 1 in run 2, carrying `rate` and `nextSettleTime` |
| `sub.deal` | per symbol | every trade | 198 and 188 frames in 25 s on `BTC_USDT` |
| `sub.kline` | per symbol and interval | | not probed |

The channel names and payloads are from S1.
Index, fair price and funding each have a channel per symbol, so covering 735 contracts takes 2,205 subscriptions, and quiet contracts push rarely.
The REST bulk ticker carries all three for every contract in one call, see [`rest.md`](./rest.md) section 3.
The 808 rows of one `push.tickers` frame against 735 catalog contracts were not identified, because that run did not keep the symbol list.
In run 2, every symbol of the last `push.tickers` frame was in the catalog.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for all contracts, S1 | one URL, one family, section 1 |
| subscribe frame shape | `{"method":"sub.depth","param":{"symbol":"BTC_USDT"}}`, one symbol per frame, S1 | one symbol per frame. 150 frames sent in one burst were all acknowledged |
| unknown symbol expectation | `{"channel":"rs.error","data":"Contract doesn't exist!","ts":"1587442022003"}`, S1 | `{"channel":"rs.error","data":"Contract [NOPE_USDT] not exists","ts":1790127492718}`. A lowercase `btc_usdt` is acknowledged as success and then sends nothing |
| chunk unit and budget | Not publicly specified | 150 `sub.depth` frames in one burst, 150 acknowledgements, every symbol delivering within 5.1 to 5.7 s |
| keepalive mechanism | client sends `{"method": "ping"}`, server answers `{"channel": "pong", "data": 1587453241453}`. "If no ping is received within 1 minute, the connection will be disconnected. It is recommended to send a ping for 10-20 seconds", S1 | pong round trip 102 to 113 ms. No server protocol ping on any socket |
| connection lifetime and maintenance notice | Not publicly specified | no lifetime cap reached in 100 s. One 150 symbol socket closed with 1006 after 14.6 s, and the rerun held 60 s |
| handshake and operation rate limits | Not publicly specified | opens took 328 to 419 ms. No refusal at 150 subscribe frames in one burst |
| public market data authentication | none, S1 | none |
| message parse and routing | top level fields `channel`, `data`, `symbol` and `ts`, S1 | the same. Route on `channel` and the top level `symbol` |
| subscribe acknowledgement shape | `channel` is `rs.` plus the method, `data` is `"success"`, S1 | `{"channel":"rs.sub.depth","data":"success","ts":1790127526068}`. `unsub.depth` stopped the stream and sent no acknowledgement. `sub.nope` got no reply at all |
| symbol identifier format | `BTC_USDT` | identical to the REST `symbol` and to CCXT `market.id` through the mexc class on 735 of 735 contracts |
| number representation | JSON numbers, `[411.8, 10, 1]` is price, contracts and order count, S1 | JSON numbers for price, size and order count on every book channel |
| timestamp representation | `ts` in ms | integer ms at the top level. Plain deltas arrived a median 61 to 67 ms after `ts`, merged ones 94 to 201 ms |
| size unit | "the volume of contracts for this price", S1 | contracts of `contractSize` coins, which is CCXT `contractSize`, section 4 |
| sequence semantics | "The version of each new event should be exactly equal to version+1 of the previous event, otherwise packet loss may occur", S1 | 0 gaps over every run: 24,339 and 21,745 plain deltas on four books, 671 merged frames on four books, and 47,594, 117,144, 240,417, 365,156 and 6,422 frames in the batch runs |
| idle repeat behaviour | not documented | plain and merged deltas never repeated a version. `sub.depth.full` resent an identical book 5 to 19 times per run on the two contracts |

## 4. The book channel in detail

Three book streams exist, and the recommendation in section 8 depends on their differences.

| stream | snapshot | frame | cadence on `BTC_USDT` | frames for 150 contracts |
|---|---|---|---|---|
| `sub.depth` | none | one changed level on one side, `version` | 8,953 to 9,896 frames per run, every change | median 6,073 per second, peak 9,813, 766 KB per second |
| `sub.depth` with `compress` | none | every level changed in the window, `begin` and `end` | median 207 ms, p90 296 ms | median 156 per second, peak 234, 79 KB per second |
| `sub.depth.full` 20 | every frame | the whole top 20, `version` | median 171 ms, min 17 to 128 ms, max 528 to 827 ms | not measured |

### Snapshot on subscribe

Neither `sub.depth` stream sends a snapshot.
The first plain frame carried one level, 135 to 2,079 ms after the subscribe frame was sent, over both runs.
The first merged frame came 145 to 2,077 ms after it, with 1 to 8 levels.
The documented recipe fetches `GET /api/v1/contract/depth/{symbol}`, keeps its `version`, and applies only events with a higher version, S1, see [`rest.md`](./rest.md) section 5.
In run 1 the first live delta after the REST book had `version` equal to the REST version plus one on 4 of 4 books.
In run 2 the REST book was already at or past every buffered delta, and the next delta chained on with 0 gaps on the plain stream.
A merged frame can straddle the REST version, as one `BTC_USDT` frame did in run 2, and applying it whole is correct because sizes are absolute.

`sub.depth.full` sends a whole top 20 book as its first push, 292 ms after the subscribe on `BTC_USDT` and 1,154 ms on `HEI_USDT` in run 1, and every push after that is again a whole top 20.

### Delta semantics

A level is `[price, contracts, orderCount]`, and the size is the absolute resting size, S1.
A removed level arrives as `[price, 0, 0]`, as in `{"asks":[],"bids":[[2747.19,0,0]],"version":11275554848}`.
Plain deltas carried at most one level per side, and removals were 6,320 of the 21,745 plain deltas of run 2.
No delta was empty on either stream.

### Sequence and gap rule

```text
plain    version = last + 1            apply, last = version
plain    version != last + 1           gap: reseed from REST (documented), or terminate the socket (the engine's resync)
merged   begin = last + 1              apply, last = end
merged   begin != last + 1             gap, the same
full     any version                   replace the book
```

The plain and merged rules held on every frame of every run, with 0 gaps.
`sub.depth.full` versions only grew, by 1 to 368 between pushes, because a push is sampled from the same counter.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| plain delta | one level, so no order | one level |
| merged delta | unordered: 163 to 178 of 276 to 278 bid arrays on `BTC_USDT` and `ETH_USDT` were not descending | unordered: 173 to 189 ask arrays were not ascending |
| `sub.depth.full` | best first, descending | best first, ascending |
| REST depth | descending on every call | ascending |

A feed applies deltas by price and never by position.

### Level window

The delta streams cover the whole book, not a window.
A book kept from the REST seed and every plain delta held 340 bids and 238 asks on `BTC_USDT`, and the REST book returned 342 to 344 bids and 239 asks.
`sub.depth.full` holds exactly the requested depth, `20/20` on every push of both contracts in both runs, and `limit` 50 returned 50 levels on `SOL_USDT`.

### Book against REST

| run | stream | `BTC_USDT` | `ETH_USDT` | `HEI_USDT` | `AMD_USDT` |
|---|---|---:|---:|---:|---:|
| 1 | plain, top 40 equal to REST | 30 of 40, REST 10 versions behind | 32 of 40, REST 15 behind | 40 of 40 | 40 of 40 |
| 2 | plain | 20 of 40, REST 62 behind | 37 of 40, REST 28 behind | 40 of 40 | 40 of 40 |
| 2 | merged | 40 of 40, REST 1 behind | 40 of 40, same version | 40 of 40 | 40 of 40 |

Every miss sits on a book that moved between the last applied delta and the REST read.
The touch matched REST on every book except run 2's plain `BTC_USDT` ask, where the local book was 62 versions ahead of the REST read.
No local book was crossed.

### Size unit against CCXT `contractSize`

| contract | CCXT `contractSize` | socket size at the touch | coins |
|---|---:|---|---|
| `BTC_USDT` | 0.0001 | 92,181 bid | 9.2181 BTC |
| `ETH_USDT` | 0.01 | 10,471 bid | 104.71 ETH |
| `HEI_USDT` | 1 | 2,000 bid | 2,000 HEI |
| `AMD_USDT` | 0.01 | 82 bid | 0.82 AMD shares |

The socket and REST report the same contract counts at the same price, and one contract is `contractSize` coins.
Over all 735 contracts, 24 h turnover divided by 24 h contracts times `contractSize` times last price fell between 0.80 and 1.21, median 0.99, see [`rest.md`](./rest.md) section 2.
So the engine's `sizeMul` converts Ourbit sizes correctly.

### One-sided and empty books

No one-sided or empty book was seen on the four contracts.
What `sub.depth.full` sends for an empty side is Not verified.

### Idle repeats

Plain and merged deltas never repeated a version.
A quiet contract went up to 5.9 s without a delta: `HEI_USDT` 5.5 and 5.7 s, `AMD_USDT` 4.1 and 5.9 s.
`sub.depth.full` pushed an identical book 12 of 328 and 5 of 273 times on `BTC_USDT`, and 19 of 40 and 14 of 40 times on `HEI_USDT`, with a new `version` each time.
The `AMD_USDT` stock perpetual kept updating at about 40 frames per second in both book runs, at 01:38 and 01:49 UTC, outside NYSE hours.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `sub.depth` `NOPE_USDT` | `{"channel":"rs.error","data":"Contract [NOPE_USDT] not exists"}` | |
| `sub.depth.full` `NOPE_USDT` | the same | |
| `sub.depth.full` limit 30 | `{"channel":"rs.error","data":"Not support limit"}` | |
| `sub.depth.full` limit 50 | `rs.sub.depth.full` success | 50 levels per side, 61 and 55 pushes in about 14 s |
| `sub.depth` with no `param` | `{"channel":"rs.error","data":"Contract [null] not exists"}` | |
| `sub.depth` `btc_usdt` | `rs.sub.depth` success | nothing |
| `sub.depth` `BTC_USDT` twice | success twice | one stream, 60 frames per 1.5 s before and after |
| `unsub.depth` | no reply | the stream stops |
| `sub.nope` | no reply | |
| text that is not JSON | `{"channel":"rs.error","data":"invalid message"}` | the socket stays open |

A delisted contract was not available to probe, because all 735 contracts were in state 0.
Because a lowercase symbol is acknowledged and never served, a feed has to notice a stream with no frame on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client `{"method":"ping"}` every 10 to 20 s, S1 | `{"channel":"pong","data":1790128291361,"ts":1790128291361}` in 102 to 113 ms. No server protocol ping |
| silence the server tolerates | disconnect "If no ping is received within 1 minute", S1 | a socket with no subscription and no client frame closed at 45.3 and 45.4 s with 1006 and no close frame. A socket subscribed to a quiet book with no ping closed at 66.9 and 69.8 s with 1005. A ping every 20 s kept a subscribed and an unsubscribed socket open for the full 100 s |
| forced disconnect | Not publicly specified | one 150 symbol plain delta socket closed with 1006 after 14.6 s at a peak of 7,565 frames per second, and the rerun with the same 150 symbols held 60 s at a peak of 9,813 |
| maintenance notice | Not publicly specified, no system channel | none seen |
| compression | `"compress":true` is listed as "Subscription increments (zipped push)", and `"gzip": false` appears on `sub.tickers`, S1 | the server does not negotiate permessage-deflate. `compress` true does not compress, it merges deltas into text frames with `begin` and `end`. `gzip` true on `sub.tickers` produced 0 binary frames in 6 s |
| handshake | | 328 to 419 ms to open |
| subscription limits | "only subscribe to the full amount of one gear" per symbol on `sub.depth.full`, S1 | no cap reached at 150 `sub.depth` subscriptions per socket |
| throughput, plain deltas | | 50 contracts: median 2,120, peak 3,368 frames per second. 100: median 4,042, peak 5,818. 150: median 6,073, peak 9,813, 129 bytes per frame, 3.6 to 3.9 µs `JSON.parse` per frame |
| throughput, merged deltas | | 150 contracts: median 156, peak 234 frames per second, 507 bytes per frame, 29 µs `JSON.parse` per frame |

The batch runs took contracts evenly spaced by 24 h turnover, so the 150 contract numbers are a fair sample of the 735.
Plain deltas averaged about 40 frames per second per contract on that sample.
Scaled to 735 contracts that is of the order of 30,000 frames per second on one venue, an extrapolation that was not measured.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.

Subscribe and acknowledgement.

```json
{"method": "sub.depth", "param": {"symbol": "BTC_USDT"}}
```

```json
{"channel":"rs.sub.depth","data":"success","ts":1790127526068}
```

Plain delta, and a removal.

```json
{"symbol":"ETH_USDT","data":{"asks":[[2748.93,5493,1]],"bids":[],"version":11275554737},"channel":"push.depth","ts":1790128156888}
```

```json
{"symbol":"ETH_USDT","data":{"asks":[],"bids":[[2747.19,0,0]],"version":11275554848},"channel":"push.depth","ts":1790128159183}
```

Merged delta with `compress` true, covering versions 11275554742 to 11275554746, with asks out of order.

```json
{"symbol":"ETH_USDT","data":{"asks":[[2748.95,9052,2],[2749.14,13814,2],[2748.92,5154,2],[2748.93,5797,2],[2749.03,3795,2]],"bids":[],"end":11275554746,"begin":11275554742},"channel":"push.depth","ts":1790128156983}
```

`sub.depth.full` at limit 20, first three levels per side kept.

```json
{"symbol":"HEI_USDT","data":{"asks":[[0.15386,602,1],[0.15387,3640,1],[0.15388,204,1]],"bids":[[0.1538,1885,1],[0.15379,78,1],[0.15378,68,1]],"version":2353063176},"channel":"push.depth.full","ts":1790128158822}
```

Keepalive.

```json
{"method": "ping"}
```

```json
{"channel":"pong","data":1790128291361,"ts":1790128291361}
```

Errors.

```json
{"channel":"rs.error","data":"Contract [NOPE_USDT] not exists","ts":1790128274855}
```

```json
{"channel":"rs.error","data":"Not support limit","ts":1790128277853}
```

Fair price, index price and funding rate.

```json
{"symbol":"BTC_USDT","data":{"symbol":"BTC_USDT","price":86218.8},"channel":"push.fair.price","ts":1790128241577}
```

```json
{"symbol":"BTC_USDT","data":{"symbol":"BTC_USDT","price":86255},"channel":"push.index.price","ts":1790128239681}
```

```json
{"symbol":"BTC_USDT","data":{"symbol":"BTC_USDT","rate":0.000034,"nextSettleTime":1790150400000},"channel":"push.funding.rate","ts":1790128260596}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same URL after a `login` method whose `param` carries `apiKey`, `signature` and `reqTime`, answered on `rs.login`.

- `push.personal.order`, `push.personal.asset`, `push.personal.position`, `push.personal.adl.level`, `push.personal.position.mode`.
- `personal.filter` narrows the default private push, S1.
- The REST order endpoints have been "(Under maintenance)" since 2022-07-25, S1, so the socket carries account data but no order entry.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://futures.ourbit.com/edge`, sliced into connections | one family on one URL. The documented host does not resolve |
| channel | `sub.depth.full` with `limit` 20 | every push is a whole top 20 book, so there is no REST seed, no gap rule and no resync path, and 20 levels is the engine's `depthLevels` |
| markets per connection | 150, and confirm it with a `sub.depth.full` batch run before activation | 150 was tested on `sub.depth` only, twice plain and once merged |
| subscribe frames | one frame per market, `{"method":"sub.depth.full","param":{"symbol":"<rawMarketId>","limit":20}}` | the protocol takes one symbol per frame, and 150 in one burst were acknowledged |
| keepalive | `{"method":"ping"}` every 15 s | the documented 10 to 20 s, and a socket without pings closes at 45 s unsubscribed or about 67 to 70 s subscribed |
| `maxSilenceMs` | 45,000 | three missed pongs. A quiet top 20 book went 5.6 s without a push, so the pong has to count as traffic |
| routing | `channel === 'push.depth.full'`, key `symbol` | the top level `symbol` is the `rawMarketId` |
| snapshot | every push: `resetBook` with bids and asks as sent | each push replaces the book, and both sides arrive sorted best first |
| sequence | log a `version` lower than the last one, and otherwise ignore it | versions only grew in both runs, and a missed push heals on the next one |
| unserved stream | log a subscription with no push 10 s after its acknowledgement | a lowercase or otherwise wrong symbol is acknowledged and never served |
| receive time | stamp on arrival, never from `ts` | the engine's rule, and `ts` is the server's send time |
| sizes | contracts as sent, and the engine multiplies by `contractSize` | section 4 |
| deflate | keep `perMessageDeflate: false`, and never set `compress` or `gzip` | the server negotiates no deflate, and `compress` changes the stream shape |

`sub.depth.full` pushes at most about every 170 ms on a busy book, so it lags the plain delta stream by up to that much.
The plain stream is the low latency option, and it needs a REST seed per contract, the version rule and a REST reseed on every gap.
It would also bring about 30,000 frames per second for the whole catalog, which the Node engine's loop cannot absorb at 26 to 29 µs per message, see [`2026-09-07-depth-stream-scaling.md`](../../research/2026-09-07-depth-stream-scaling.md).
The merged stream keeps the REST seed and the gap rule and cuts the frame count 39 times, at a latency close to `sub.depth.full`.
Seeding 735 contracts from REST at the documented 20 requests per 2 s takes about 74 s, see [`rest.md`](./rest.md) section 6.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Ourbit contract API v1 documentation, English, WebSocket API section, kept in the `gh-pages` branch but no longer served at `https://ourbitdevelop.github.io/apidocs/contract_v1_en/` (HTTP 404) | https://raw.githubusercontent.com/ourbitdevelop/apidocs/gh-pages/contract_v1_en/index.html | 2026-09-22 | Ourbit, global | URL, methods, channels, ping, depth recipe, error shape, private channels, sections 1 to 7 |
| S2 | Ourbit contract API documentation, 2026-07-08, which documents no public market data and no WebSocket | https://ourbitdevelop.github.io/apishortdocs/contract_en/ | 2026-09-22 | Ourbit, global | the current doc's scope, section 1 |
| P1 | `ws-probe.mjs book`, run 1 at 01:38 UTC (plain and full) and run 2 at 01:49 UTC (plain, merged and full) | [`ws-probe.mjs`](../../../scripts/probes/venues/ourbit/ws-probe.mjs) | 2026-09-22 | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs channels` at 01:39 and 01:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/ourbit/ws-probe.mjs) | 2026-09-22 | this host | section 2 |
| P3 | `ws-probe.mjs errors` at 01:37, 01:38 and 01:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/ourbit/ws-probe.mjs) | 2026-09-22 | this host | sections 3 and 4 |
| P4 | `ws-probe.mjs batch`: 150 plain at 01:40 and 01:45 UTC, 50 plain at 01:43, 100 plain at 01:44, 150 merged at 01:48 | [`ws-probe.mjs`](../../../scripts/probes/venues/ourbit/ws-probe.mjs) | 2026-09-22 | this host | sections 3 and 5 |
| P5 | `ws-probe.mjs silence`, four sockets at 01:41 UTC and two at 01:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/ourbit/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
| P6 | `ws-probe.mjs deflate` at 01:46 and 01:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/ourbit/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
