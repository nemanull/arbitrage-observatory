# XT.COM WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:25 to 03:55 UTC, from the development host near Seattle.

This profile covers the public futures WebSocket of XT.COM (CCXT id `xt`) for both perpetual families, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/xt/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Sockets were held for about twelve and a half minutes in total over both passes, runs W1 to W7 of section 9.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals | `wss://fstream.xt.com/ws/market`, S20 | open in 365 to 444 ms over twenty logged opens, delivers |
| coin-M perpetuals | no separate URL is documented | `btc_usd` delivers on the same `wss://fstream.xt.com/ws/market` socket as `btc_usdt`: 14 deltas and 2 depth frames in 3 s, and 14 and 3 in the rerun, W2 |
| CCXT Pro | `'contract': 'wss://fstream.xt.com/ws'` at `server/node_modules/ccxt/js/src/pro/xt.js` line 37, with `/market` appended for public streams at lines 197 to 203 | the bare `wss://fstream.xt.com/ws` answers the upgrade with HTTP 404 in both runs, W2 |
| `dstream.xt.com` | not documented | the name does not resolve, `ENOTFOUND`, P1 and W2 |
| private | `wss://fstream.xt.com/ws/user`, S21 | accepts a public depth subscribe with `code` 0 and delivered nothing in 3 s, W2 |
| spot | `wss://stream.xt.com`, CCXT Pro line 36 | not probed |

One socket carries both perpetual families, because the symbols differ, `btc_usdt` against `btc_usd`.
`fstream.xt.com` is a CloudFront name that resolved to four IPv4 and eight IPv6 addresses on 2026-09-23, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | subscribe string | documented rate | probed on 2026-09-23 |
|---|---|---|---|
| incremental depth | `depth_update@btc_usdt,100ms` | 100, 250, 500 or 1000 ms, default 100 ms, S22 | deltas only, no snapshot, 7.8 to 8.6 frames a second on BTC and ETH, recommended |
| limited depth | `depth@btc_usdt,50,100ms` | 5, 10, 20 or 50 levels, 100 to 1000 ms, default 1000 ms, S23 | a whole 50 level book about once a second even when `100ms` is asked, and the event echoes `depth@btc_usdt,50` without the interval. BTC sent 65, 64 and 64 frames in about 62 s over three runs. The frame carries `s`, `id`, `a`, `b` and `t` |
| mark price | `mark_price@btc_usdt` | 1000 ms, S24 | 30 frames in 30 s in both runs, `{s, p, t}` |
| index price | `index_price@btc_usdt` | 1000 ms, S25 | 30 frames in 30 s in both runs, `{s, p, t}` |
| funding rate | `fund_rate@btc_usdt` | 60 s, S26 | 3 frames in 30 s in both runs, `{s, r, t}` |
| aggregate ticker | `agg_ticker@btc_usdt` | 1000 ms, S27 | 31 frames in 30 s in both runs, carries `i` index, `m` mark, `bp` and `ap` |
| ticker | `ticker@btc_usdt` | not documented on the V2 pages | 23 and 24 frames in 30 s, no mark or index |
| trades, klines | `trade@btc_usdt`, `kline@btc_usdt,1m` | S20 | not probed |

The mark and index channels stamp `t` about 0.9 s before the frame arrives.
Arrival minus `t` had a median of 911 and 919 ms for `mark_price` and 916 and 926 ms for `index_price` in the two 30 s runs, W2.
`agg_ticker` arrived 86 to 128 ms after its `t`.
No channel carries the funding interval or the next settlement time, so the REST poll stays the anchor, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL, S20 | USDT-M and coin-M on one socket, section 1 |
| subscribe frame shape | `{"method": "SUBSCRIBE", "params": ["{topic}@{symbol}"], "id": "..."}`, several params allowed, S20 | 200 params in one frame got one ack and all 200 delivered, W3 |
| unknown symbol expectation | error code 400 "Bad request payload", S20 | `{"code":1,"msg":"checkSymbol error, symbol:nope_usdt","id":"nope_sym",...}`. Upper case `BTC_USDT` fails the same way |
| chunk unit and budget | Not publicly specified | 200 streams per frame, 400 streams on one socket, all acked, W3 |
| keepalive mechanism | "Each client connection must periodically send a text ping message. The server will reply with a text pong.", S20 | text `ping` answered by text `pong`, 4 of 4 in each book run. No protocol ping from the server on any socket |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 70 s with pings, no notice frame seen |
| handshake and operation rate limits | Not publicly specified | no refusal at 400 streams in two frames. Opens took 365 to 444 ms |
| public market data authentication | none | none |
| message parse and routing | `{"topic", "event": "{topic}@{symbol}", "data"}`, S20 | route on `topic`, then `data.s`, which is the CCXT `market.id`. `event` keeps the `,100ms` suffix on `depth_update` and drops the interval on `depth` |
| subscribe acknowledgement shape | `{"id", "code": 0/1/2, "msg"}`, S20 | `{"code":0,"msg":"success","id":"inc","sessionId":"rs-40179"}`, 170 to 205 ms after the frame was sent |
| symbol identifier format | lower case `btc_usdt` | identical to CCXT `market.id`, to REST `symbol` and `s`, including the six CJK contracts such as `龙虾_usdt`, which delivered 44 deltas in 30 s in both runs |
| number representation | strings in the examples | prices and sizes are strings, update ids `pu`, `fu`, `u` and `id` are strings, `t` is a JSON number |
| timestamp representation | `t` in ms | `t` integer ms |
| size unit | Not publicly specified | contracts of CCXT `contractSize` coins, section 4 |
| sequence semantics | `fu` equals the previous event's `u` plus one, S28 | held on every delta of three 60 s runs, and `pu` equalled the previous `u` on every delta, section 4 |
| idle repeat behaviour | not documented | nothing is repeated, a quiet book sends a delta only when it changes, section 4 |

## 4. The book channel in detail

`depth_update@<symbol>,100ms` is the channel this profile recommends, seeded by a `depth@<symbol>,50` frame, and every row below is about it unless it says otherwise.
The book runs of W1 used `btc_usdt`, `eth_usdt` and two quieter contracts, `giggle_usdt` and `tradoor_usdt` in the first two runs and `iren_usdt` and `tradoor_usdt` in the third.

### No snapshot on subscribe

The first `depth_update` frame is a delta, 276 to 482 ms after the subscribe on BTC and ETH and 377 to 2,175 ms on the quieter contracts, W1.
The documented recipe buffers the stream, fetches `GET /future/market/v1/public/depth?symbol=btc_usdt&level=500`, drops every event with `u` at or below the snapshot's `lastUpdateId`, and starts at the event with `fu <= lastUpdateId + 1` and `u >= lastUpdateId + 1`, S28.
That path is `/future/market/v1/public/q/depth` on the live host, see [`rest.md`](./rest.md) section 5.
Seeding from a REST read at 50 levels, the first applied event met that rule on 12 of 12 contract runs, W1.

The limited depth frame carries `id`, which is the same update sequence as the deltas, so it can seed the book in place of the REST read.
It can also be older than the start of the delta stream on a fresh socket.
In the first run the first BTC `depth` frame had `id` 1603468953633 and the first BTC delta had `pu` 1603468953717, so the 84 update ids between them never reach that socket.
A seed therefore has to be bridgeable: the first delta applied after it must satisfy `fu <= id + 1 <= u`.
In the third run, with that check, one BTC `depth` frame was skipped as older than the buffered stream, and one seed on ETH and one on IREN were rejected by their first delta and replaced by the next `depth` frame.
Each contract was seeded 699 to 2,597 ms after the subscribe, and at the end of 60 s all four books equalled the REST seeded books on 20 of 20 levels per side, and both equalled a REST read at the same update id, W1.

The limited depth frame is not in step with the deltas, and it is not always an exact image of the book at its `id`.
When a `depth` frame arrived while the last delta id equalled its `id`, its top 20 levels equalled the kept book on 19 of 38 BTC frames, 12 of 16 ETH frames, 47 of 47 IREN frames and 27 of 27 TRADOOR frames in the third run, and on 1 of 5 BTC, 5 of 6 ETH, 30 of 30 GIGGLE and 23 of 23 TRADOOR frames in the second.
The same kept books equalled REST reads at the same id far more often, see below.
So a socket seed on a busy book can carry a few wrong sizes until those levels next change, and a quiet book's seed matched exactly in every case seen.

### Delta semantics

Each delta carries `pu`, `fu`, `u`, `a`, `b` and `t`, and each level is `[price, size]` with the absolute size.
A size of `"0"` deletes the level, and "Receiving deletion of a price level that does not exist locally may happen and is normal", S28.
No delta with both arrays empty was seen in 3,371 deltas on the book runs.
A delta can carry levels far from the touch: the first BTC delta of W1 held asks at 86,753.8 and 87,533.8 against a touch at 86,667.1.

### Sequence and gap rule

```text
first event after the seed   fu <= id + 1 <= u, apply, last = u
next event, fu = last + 1    apply, last = u
next event, fu ≠ last + 1    gap: resync
```

`pu` equalled the previous `u` on every delta, so `pu === last` is the same test.
The rule held with 0 gaps on 3,371 deltas in the three 60 s book runs, W1.
On 400 streams on one socket the first batch run saw 574 events whose `fu` was not the previous `u` plus one in 33,109 frames, and the next two saw 0 in 34,132 and 0 in 28,294, W3.
The first run did not classify its breaks, so whether they were skips or repeats is Not verified.
A feed must treat a break as a resync either way.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `depth_update` delta | descending in every delta with more than one bid, 0 exceptions in 3,371 | ascending in every delta, 0 exceptions |
| `depth` snapshot | descending on all 597 frames of three runs | ascending on all 597 |
| REST `q/depth` | descending at 5, 20, 50, 100, 500 and 1,000 levels in both runs | ascending |

A feed still applies deltas by price, since the order is not documented.

### Level window

The deltas are not limited to 50 levels.
A BTC book seeded from 50 REST levels held 254 bids and 284 asks after 60 s in the first run, 708 and 687 in the second and 183 and 187 in the third, W1.
A level that sat below the seed and never changed is missing from such a book, which the documentation names as a known limit, S28.
That matters only when the price moves further than the seed's depth, and a 50 level seed covers the engine's 20.

### Agreement with the REST book

A book kept from the deltas was compared with REST reads of 50 levels at the same update id.
All 40 top levels matched on 13 of 21 BTC reads and 14 of 18 ETH reads over three align runs, W7.
No kept book was ever crossed, and the misses were single levels whose size or presence differed.
At the end of the three book runs the kept book and a REST read carried the same id in 9 of 12 comparisons, and all 9 matched on 20 of 20 levels per side, W1.
Whether a miss is the REST reply being stitched from two instants or the stream skipping a level change is Not verified.

### Size unit against CCXT `contractSize`

| contract | CCXT `contractSize` | socket size at the touch | coins |
|---|---:|---|---|
| `btc_usdt` | 0.0001 | `"122275"` | 12.2275 BTC |
| `eth_usdt` | 0.01 | `"43307"` | 433.07 ETH |
| `tradoor_usdt` | 1 | `"119"` | 119 TRADOOR |

The unit is contracts, and the socket size equalled the REST size at the same price and id, W1.
One contract is `contractSize` coins: on 683 of 691 tradable USDT-M perpetuals the 24 h volume `a` times `contractSize` times the last price came within 10 % of the 24 h turnover `v`, and all 691 within 30 %, in both catalog runs, P2.
So the engine's `sizeMul` converts XT sizes correctly for the linear family.
Coin-M contracts are 10 or 100 USD each, `contractSize` 100 on `btc_usd`, so a coin-M size is US dollars and not coins, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

None of the 691 tradable USDT-M perpetuals had a missing best bid or ask in `agg-tickers` on 2026-09-23, P3.
What the stream sends for an empty side is Not verified.

### Idle repeats

Nothing is repeated.
`tradoor_usdt` sent 26 to 29 deltas in 60 s, and no limited depth frame equalled the one before it, 0 of 597 over three runs, W1.

### Unknown, closed and wrong requests

From W2, each on its own id, and identical in both runs.

| request | reply | then |
|---|---|---|
| `depth_update@nope_usdt,100ms` | `{"code":1,"msg":"checkSymbol error, symbol:nope_usdt"}` | |
| `depth_update@BTC_USDT,100ms` | `{"code":1,"msg":"checkSymbol error, symbol:BTC_USDT"}` | |
| `nope@btc_usdt` | `{"code":1,"msg":"args error: nope@btc_usdt"}` | |
| `depth_update@btc_usdt,70ms` | `{"code":1,"msg":"interval error"}` | |
| `depth@btc_usdt,30,100ms` | `{"code":1,"msg":"levels error"}` | |
| `depth_update@ftt_usdt,100ms`, delisted | `{"code":0,"msg":"success"}` | nothing in 28 s |
| `depth_update@dia_usdt,100ms`, trading but `isOpenApi` false | success | 23 deltas in 28 s |
| `depth_update@eth_usdt` again, no interval | success | the stream keeps delivering, no duplicate error |
| method `NOPE` | `{"code":1,"msg":"Invalid method"}` | |
| text `hello` | `{"code":1,"msg":"Invalid parameter"}` with no `id` | the socket stays open |
| JSON `{"method":"ping"}` | `{"code":1,"msg":"Invalid parameter"}` | |

A delisted contract is acknowledged and stays silent, so the feed has to notice a stream that never sends a delta, or the catalog has to drop it first.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | text `ping`, text `pong`, S20 | 4 pongs for 4 pings in each book run. CCXT Pro sends `'ping'` every 20 s, `pro/xt.js` lines 58 and 1438 to 1440 |
| silence the server tolerates | "If the server does not receive a ping within 30 seconds, it will proactively close the connection.", S20 | a socket that sends no ping closed at 30,002, 30,003 and 30,010 ms with code 1006 and no close frame, whether it had no subscription or a subscription that was delivering frames. A socket pinging every 20 s was open at 70 s and at 45 s in the two runs, W4 |
| forced disconnect | Not publicly specified | none |
| maintenance notice | Not publicly specified | none seen |
| compression | "it is recommended to enable the per-message compression extension", S20 | offered permessage-deflate, the server negotiated none and sent 27 and 24 text frames in 3 s, W5. Without the offer it sent 23 and 24. Every frame is plain JSON text |
| handshake | | 365 to 444 ms over twenty logged opens |
| subscription limits | Not publicly specified | 400 streams on one socket, no cap reached |
| throughput | | 400 USDT-M perpetuals by 24 h turnover on one socket: median 443, 429 and 432 frames a second in three runs, peak 827, 853 and 781, 189 to 199 KB a second, 344 to 352 bytes a frame, 8.7 to 11.1 µs of `JSON.parse` a frame, W3 |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.

Subscribe, four streams in one frame.

```json
{"method": "SUBSCRIBE", "params": ["depth_update@btc_usdt,100ms", "depth_update@eth_usdt,100ms", "depth_update@giggle_usdt,100ms", "depth_update@tradoor_usdt,100ms"], "id": "inc"}
```

Acknowledgement.

```json
{"code":0,"msg":"success","id":"inc","sessionId":"rs-40179"}
```

First delta on BTC in the first run, which is not a snapshot.

```json
{"topic":"depth_update","event":"depth_update@btc_usdt,100ms","data":{"s":"btc_usdt","pu":"1603468953717","fu":"1603468953718","u":"1603468953729","a":[["86667.1","116900"],["86667.3","0"],["86667.4","3483"],["86753.8","211133"],["87533.8","293313"]],"b":[["86666.8","144313"],["86666.5","2969"],["86665.5","2983"],["86580.1","150651"],["85800.1","325898"]],"t":1790133966501}}
```

The limited depth frame that arrived before it, first three levels per side kept, and its `t` cut by the capture.
Its `id` is 84 below that delta's `pu`, which is the unbridgeable case of section 4.

```json
{"topic":"depth","event":"depth@btc_usdt,50","data":{"s":"btc_usdt","id":"1603468953633","a":[["86667.1","146040"],["86667.3","2557"],["86667.5","1003"]],"b":[["86666.8","69458"],["86666.5","988"],["86666.4","50"]]}}
```

Mark, index and funding.

```json
{"topic":"mark_price","event":"mark_price@btc_usdt","data":{"s":"btc_usdt","p":"86648.8","t":1790134049859}}
```

```json
{"topic":"index_price","event":"index_price@btc_usdt","data":{"s":"btc_usdt","p":"86684.408126100000","t":1790134049859}}
```

```json
{"topic":"fund_rate","event":"fund_rate@btc_usdt","data":{"s":"btc_usdt","r":"0.00004035","t":1790134055629}}
```

Aggregate ticker.

```json
{"topic":"agg_ticker","event":"agg_ticker@btc_usdt","data":{"s":"btc_usdt","o":"85587.7","c":"86648.8","h":"86814.0","l":"85080.1","a":"186725236","v":"186725236","r":"0.0123","i":"86684.408126100000","m":"86648.8","bp":"86648.7","ap":"86649.0","t":1790134050689}}
```

Its `v` equalled `a` here, while the REST `tickers` reply gives `v` as the quote turnover, so the socket's `v` is not the turnover.

Errors.

```json
{"code":1,"msg":"checkSymbol error, symbol:nope_usdt","id":"nope_sym","sessionId":"rs-42904"}
```

```json
{"code":1,"msg":"Invalid parameter","sessionId":"rs-42904"}
```

Keepalive: the client sends the four characters `ping` and receives the four characters `pong`, neither of them JSON.

## 7. Private channels

Named for a future execution stage, from S21, not probed.
The URL is `wss://fstream.xt.com/ws/user`, and a subscription names `{topic}@{listenKey}`, where the key comes from `GET https://fapi.xt.com/future/user/v1/user/listen-key`.
The topics are `order`, `trade`, `balance`, `position` and `notify`, and a failed key answers `code` 2.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://fstream.xt.com/ws/market`, for the USDT-M contracts the market filter keeps | one socket serves both families, and the filter in [`rest.md`](./rest.md) section 8 drops coin-M |
| channels | `depth_update@<rawMarketId>,100ms` for the book, and `depth@<rawMarketId>,50` for the seed | the delta stream has no snapshot, and the limited depth frame carries an id of the same sequence |
| markets per connection | 200 | 400 streams on one socket ran with 0 breaks in two of three batch runs, and the first run's 574 breaks argue for staying at half that |
| subscribe frames | one frame per slice with both channels for every market, `{"method": "SUBSCRIBE", "params": ["depth_update@btc_usdt,100ms", "depth@btc_usdt,50", …], "id": "<slice>"}` | a 200 param frame was acked once |
| seed | buffer deltas per contract. On a `depth` frame, skip it if `id + 1` is below the first buffered `fu`, otherwise `resetBook` from it, drop buffered deltas with `u <= id` and apply the rest. If the first delta after the seed has `fu > id + 1`, drop the seed and wait for the next `depth` frame | the documented recipe with the socket frame in place of the REST read, and the skip and reject steps each fired in the third run |
| after the seed | send `UNSUBSCRIBE` for that contract's `depth` stream, or ignore its frames | a 50 level frame a second per contract doubles the parse work, and the frame is not an exact image on busy books |
| alternative seed | `GET /future/market/v1/public/q/depth?symbol=<id>&level=50`, the documented path | exact at its id more often, but 691 contracts at the 10 per second depth limit take over a minute, and every resync costs a call |
| delta | apply only when `fu === last + 1`, then store `u` | documented rule, 0 breaks in 3,371 deltas on the book runs |
| resync | `fu !== last + 1`: `resync`, which terminates the socket and resubscribes both channels | the engine's existing path reseeds from the next `depth` frame |
| keepalive | text `ping` every 15 s | the server closes a socket at 30 s without a ping, even one that is receiving data |
| `maxSilenceMs` | 45,000 | three missed pongs, since a quiet contract can go seconds without a delta and the pong is the traffic the watch relies on |
| routing | `data.s` is the `rawMarketId` | identical spelling, lower case, CJK included |
| sizes | `Number()` of the string, in contracts | `contractSize` converts to coins |
| silent streams | log a contract with no seed 10 s after its ack | a delisted contract is acked and never sends |
| receive time | stamp on arrival, never from `t` | the mark and index `t` run about 0.9 s behind arrival |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it, despite the documentation's advice |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S13 | CCXT 4.5.68 `pro/xt.js` | `server/node_modules/ccxt/js/src/pro/xt.js` | 2026-09-22 | CCXT | Pro URLs, ping, sections 1 and 5 |
| S20 | XT Futures WebsocKetV2, General WSS information | https://doc.xt.com/docs/futures/WebsocKetV2/General_WSS_information | 2026-09-22 | XT.COM, global | URL, frame shapes, ping and pong, the 30 s rule, compression advice, sections 1 to 5 |
| S21 | XT Futures UserWebsocket, General WSS information | https://doc.xt.com/docs/futures/UserWebsocket/General_WSS_information | 2026-09-22 | XT.COM, global | private URL and topics, section 7 |
| S22 | XT Futures WebsocKetV2, Incremental depth | https://doc.xt.com/docs/futures/WebsocKetV2/IncrementalDepth | 2026-09-22 | XT.COM, global | `depth_update` format and intervals, section 2 |
| S23 | XT Futures WebsocKetV2, Limited depth | https://doc.xt.com/docs/futures/WebsocKetV2/LimitedDepth | 2026-09-22 | XT.COM, global | `depth` levels and intervals, section 2 |
| S24 | XT Futures WebsocKetV2, Mark price | https://doc.xt.com/docs/futures/WebsocKetV2/MarkPrice | 2026-09-22 | XT.COM, global | section 2 |
| S25 | XT Futures WebsocKetV2, Index price | https://doc.xt.com/docs/futures/WebsocKetV2/IndexPrice | 2026-09-22 | XT.COM, global | section 2 |
| S26 | XT Futures WebsocKetV2, Fund rate | https://doc.xt.com/docs/futures/WebsocKetV2/FundRate | 2026-09-22 | XT.COM, global | section 2 |
| S27 | XT Futures WebsocKetV2, Agg ticker | https://doc.xt.com/docs/futures/WebsocKetV2/AggTicker | 2026-09-22 | XT.COM, global | section 2 |
| S28 | XT Futures WebsocKetV2, Orderbook manage | https://doc.xt.com/docs/futures/WebsocKetV2/OrderbookManage | 2026-09-22 | XT.COM, global | local book recipe and gap rule, section 4 |
| P1 | `rest-probe.mjs host` at 03:17 and 03:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xt/rest-probe.mjs) | 2026-09-23 UTC | this host | DNS, section 1 |
| P2 | `rest-probe.mjs catalog` at 03:34, 03:47 and 04:00 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xt/rest-probe.mjs) | 2026-09-23 UTC | this host | the volume unit check, section 4 |
| P3 | an `agg-tickers` read at 03:36 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/xt/rest-probe.mjs) | 2026-09-23 UTC | this host | one-sided books, section 4 |
| W1 | `ws-probe.mjs book` at 03:26, 03:38 and 03:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/xt/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 2 to 6 |
| W2 | `ws-probe.mjs misc` at 03:27 and 03:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/xt/ws-probe.mjs) | 2026-09-23 UTC | this host | URLs, anchor channels, errors, sections 1 to 4 and 6 |
| W3 | `ws-probe.mjs batch` at 03:30, 03:31 and 03:52 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/xt/ws-probe.mjs) | 2026-09-23 UTC | this host | 400 streams on one socket, sections 3 to 5 |
| W4 | `ws-probe.mjs silence` at 03:32 and 03:53 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/xt/ws-probe.mjs) | 2026-09-23 UTC | this host | the 30 s close, section 5 |
| W5 | `ws-probe.mjs deflate` at 03:25 and 03:53 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/xt/ws-probe.mjs) | 2026-09-23 UTC | this host | compression, section 5 |
| W7 | `ws-probe.mjs align` at 03:40, 03:41 and 03:54 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/xt/ws-probe.mjs) | 2026-09-23 UTC | this host | kept book against REST and `depth` frames, section 4 |
