# KuCoin WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle.

This profile covers the public futures WebSockets of KuCoin (CCXT ids `kucoinfutures` and `kucoin`) for every perpetual family, with the book channel in detail.
KuCoin runs two public futures sockets: the tokenless UTA socket, which the documentation also calls Pro, and the classic socket, which needs a public token from a REST call.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/kucoin/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| socket | documented URL | how to connect | probed |
|---|---|---|---|
| UTA public futures | `wss://x-push-futures.kucoin.com`, S1 | connect, wait for the welcome, subscribe. "if you subscribe to public data, you don't need to obtain tokens", S2 | open in 303 to 345 ms, CloudFront edge `SEA900` |
| UTA public spot | `wss://x-push-spot.kucoin.com`, S1 | same | not probed |
| classic public futures | the `endpoint` returned by `POST https://api-futures.kucoin.com/api/v1/bullet-public`, S3 | `{endpoint}?token={token}&connectId={id}`, and the token "is valid for only 24 hours", S4 | the call returned `wss://ws-api-futures.kucoin.com/` with `pingInterval` 18000 and `pingTimeout` 10000 in 383 and 180 ms, and the socket opened in 309 to 447 ms, CloudFront edge `SEA900` |

One socket of either kind carries every futures family.
On one UTA socket `XBTUSDTM`, `XBTUSDCM` and the inverse `XBTUSDM` all delivered, and a spot subscription on the futures socket was refused, see section 4.
CCXT Pro 4.5.68 holds both URLs: the UTA ones at `server/node_modules/ccxt/js/src/pro/kucoin.js` lines 51 to 53, and the classic token call at line 145.

## 2. Channel matrix for public market data

| socket | channel | depth and speed, documented | probed on 2026-09-22 |
|---|---|---|---|
| UTA | `obu`, depth `increment@10ms` ("Increment Best 500") | a snapshot, then deltas aggregated per 10 ms over the top 500 levels, S1 | snapshot then deltas on every contract tried, recommended |
| UTA | `obu`, depth `increment` | real time, no snapshot, "will be deprecated on 15th July 2026 (UTC)", S1 | still served on 2026-09-22: 1,511 deltas on `XBTUSDTM` in 12 s and no snapshot |
| UTA | `obu`, depth `50` and `5` | a whole book every 100 ms, S1 | depth 50 sent 300 frames in 30 s on `ETHUSDTM` and on the quiet `INITUSDTM`, one every 100 ms, and 620 in 62 s in the rerun |
| UTA | `obu`, depth `1` | best bid and ask, real time, S1 | 216 frames in 30 s on `XBTUSDTM`, and 2,068 in 62 s in the rerun, each a one-level snapshot |
| UTA | `mark-price` | mark, index and open interest every second, S5 | 30 frames in 30 s, and 62 in 62 s |
| UTA | `funding-fee`, `funding-fee-all-symbols` | rate, last rate, next time, interval, cap and floor, every minute, S6, S7 | one frame a minute each, about 1 s after the minute, and the all symbols frame carried 682 rows in 86 KB |
| classic | `/contractMarket/level2:{symbols}` | every change, real time, no snapshot, S8 | one price level per frame, 3,367 frames in 30 s on `XBTUSDTM`, and 9,006 in the rerun |
| classic | `/contractMarket/level2Depth50:{symbols}` and `level2Depth5` | 50 or 5 levels every 100 ms, S9 | 300 frames in 30 s per contract, on a 100 ms grid |
| classic | `/contract/instrument:{symbol}` | `mark.index.price` every second, `funding.rate` every minute, S10 | 26 and 22 `mark.index.price` frames in 30 s, and one `funding.rate` frame on the minute |
| classic | `/contract/announcement` | `funding.begin` and `funding.end` at each settlement, S11 | not probed across a settlement |
| classic | `/contractMarket/tickerV2`, `/contractMarket/execution`, `/contractMarket/limitCandle`, `/contractMarket/snapshot` | best bid and ask in real time, trades, candles, 24 h statistics every 5 s, S17, S18 | not probed |

The channel names are from S1, S5 to S11, S17 and S18.
The UTA `obu` topic takes one `symbol` per subscribe frame, and the classic topics take a comma separated list.
The classic `level2Depth20` topic that CCXT Pro names in a comment at `server/node_modules/ccxt/js/src/pro/kucoin.js` line 71 does not exist, and the socket answered `404 topic does not exist`.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The probed column describes the UTA socket and `obu` `increment@10ms`, with the classic socket noted where it differs.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one UTA URL for futures and one for spot, S1. The classic futures socket comes from its own token call, which "cannot be mixed" with spot, S4 | every futures family on one socket, section 1 |
| subscribe frame shape | `{"id", "action": "SUBSCRIBE", "channel": "obu", "tradeType": "FUTURES", "symbol", "depth"}`, S1. Classic: `{"id", "type": "subscribe", "topic", "response": true}`, S4 | as documented. A `symbols` array on `obu` answered `"symbols are not supported for topic obu"` |
| unknown symbol expectation | Not publicly specified | UTA acks `NOPEUSDTM` and `XBT-USDT` with `"result": true` and sends nothing. Classic acks `/contractMarket/level2:NOPEUSDTM` with `ack` and sends nothing |
| chunk unit and budget | UTA: 300 client messages per 10 s per connection and at most 600 topics per connection, S12. Classic: 100 messages per 10 s, 100 topics per subscribe, futures topics per connection "Unlimited", S13. The error code page lists "300 per session" and "100 per time", S14 | 100 `obu` subscribe frames, ten a second, all acked on one UTA socket |
| keepalive mechanism | client sends `{"id", "type": "ping"}` every `pingInterval`, S2 and S4 | the UTA welcome carried `pingInterval` 18000, while the S2 example shows 30000. The pong came back in about 100 ms. No server protocol ping on any socket |
| connection lifetime and maintenance notice | token valid 24 hours, S4. During load balancing some sockets "may be temporarily disconnected by the server", "at most once or twice per week", S12, S13 | no forced close in 90 s |
| handshake and operation rate limits | UTA public futures: at most 800 connections and 250 new connections per 5 minutes per IP, while the same page's additional notes give 300 per 5 minutes, S12. Classic: at most 800 concurrent connections, S13. The error page says "exceed max session count limitation of 50", S14 | no refusal at five concurrent sockets |
| public market data authentication | UTA none. Classic needs the public token, which needs no credentials | as documented |
| message parse and routing | `{T, dp, t, P, d: {s, O, C, M, a, b}}`, S1 | route on `d.s`, which is the contract id. Every UTA frame, the welcome and acks included, arrives as a binary WebSocket frame whose payload is plain UTF-8 JSON. Classic frames are text |
| subscribe acknowledgement shape | `{"id", "result": "true"}`, S2 | `{"id":"p1","result":true}` with a boolean, and a refusal adds `"message"` or `"reason"` with `"result":false`. Classic `{"id","type":"ack"}` or `{"id","type":"error","code":404,"data":"topic does not exist"}` |
| symbol identifier format | `XBTUSDTM` | CCXT `market.id` equals the REST `symbol` on 682 of 682 perpetuals, and the socket's `d.s` spelled that id on all 106 streams tried |
| number representation | prices and sizes as strings, S1 | strings on the UTA socket. The classic depth channels send prices as strings and sizes as JSON numbers |
| timestamp representation | `P` and `M` in nanoseconds, S1 | `P` minus `M` was 0 to 25 ms with a median of 3 to 7 ms per contract over two runs. `P` is sent as a JSON number past 2^53, so it loses its last digits in `JSON.parse` |
| size unit | lots, with `multiplier` coins per lot, S15 | lots of CCXT `contractSize` coins, section 4 |
| sequence semantics | apply a delta when `O ≤ last + 1` and `C > last`, S1 | `O` equalled `last + 1` on every delta: 0 gaps in 3,206 and 5,444 deltas on six contracts over two 60 s runs, and 0 on 100 contracts in the batch runs |
| idle repeat behaviour | "If there is no change in the market, data will not be pushed", S1 | true for `increment@10ms`, which sent nothing for 10.1 s and 8.8 s on `INITUSDTM`. Depth 50 resent the same book every 100 ms, 283 of 300 and 560 of 620 `INITUSDTM` frames with an unchanged `C` |

## 4. The book channel in detail

`obu` at depth `increment@10ms` on the UTA socket is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame for each stream is `"t": "snapshot"` with `O` equal to `C`, and up to 500 levels per side.
`XBTUSDTM` and `ETHUSDTM` snapshots held 500 bids and 500 asks, and thinner books held all they had, 33 and 19 on `INITUSDTM` and 100 and 62 on `AAPLUSDTM` in the first run.
The snapshot came 0.5 to 6.2 s after the subscribe frame over two runs, with `INITUSDTM` slowest at 6.2 s and `XBTUSDTM` at 3.8 s and then 0.5 s.
The deprecated `increment` depth started delivering within about 30 ms of its ack.
No second snapshot came in 60 s.
All 100 streams of the batch run got their snapshot.

### Delta semantics

A delta carries `O`, `C`, `M`, `s` and `b` and `a` arrays of `[price, size]` string pairs.
A size of `"0"` deletes the level, and S1 says a level pushed as 0 may also be one that left the top 500.
One delta covered 1 to 222 sequence numbers, so a frame aggregates many book events.
No empty delta was seen.

### Sequence and gap rule

```text
t = snapshot                   replace the book, last = C
t = delta, O = last + 1        apply, last = C
t = delta, O ≤ last, C > last  documented as valid, never seen
otherwise                      gap: resubscribe the stream, or terminate the socket (the engine's resync)
```

The strict rule held on every delta of every run, with 0 gaps, and `O` never overlapped the previous `C`.
The sequence is per contract and is the REST book's `sequence`, see section 4 "Size unit against CCXT `contractSize`".
The classic `level2` channel chains the same sequence by exactly one per frame, 0 gaps in 3,367 and 9,006 frames, and its `sn` equals `data.sequence`.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| UTA snapshot | descending on 6 of 6 contracts | ascending on 6 of 6 |
| UTA delta | descending in every delta seen | ascending in every delta seen |
| UTA and classic depth 50 | descending on every frame | ascending on every frame |
| REST `level2/depth20`, `depth100`, `snapshot` | descending | ascending |

S1 does not promise the delta order, so a feed applies deltas by price.

### Level window

The server keeps the stream at the top 500 levels per side.
A book kept from the snapshot and every delta held at most 502 levels on `XBTUSDTM` and `ETHUSDTM` over 60 s, and at most 500 in the rerun, so a level leaving the window arrives as a `"0"` size, with a brief overshoot of two.

### Size unit against CCXT `contractSize`

| contract | CCXT `contractSize` | socket touch, bid | REST touch at the same `sequence` | coins |
|---|---:|---|---|---|
| `XBTUSDTM` | 0.001 | `["86198","166"]` | `[86198,166]` | 0.166 BTC |
| `ETHUSDTM` | 0.01 | `["2748.45","534"]` | `[2748.45,534]` | 5.34 ETH |

The REST `level2/depth20` reply was read during the run, and the socket book kept up to the same `sequence` matched it on 40 of 40 prices and 40 of 40 sizes on both contracts, in both runs.
The unit is lots, and one lot is `multiplier` coins, which is exactly CCXT's `contractSize` on 682 of 682 perpetuals, see [`rest.md`](./rest.md) section 2.
The engine's `sizeMul` therefore converts KuCoin sizes correctly for linear contracts.
The four inverse perpetuals carry `multiplier` -1, which S15 defines as one US dollar per contract, and CCXT turns it into `contractSize` 1 at `server/node_modules/ccxt/js/src/kucoin.js` line 1971.
The engine would read those sizes as coins, so the inverse contracts must stay out, see [`fees.md`](./fees.md) section 9.

### One-sided and empty books

No one-sided or empty book was seen, so what a side with no orders looks like is Not verified.
The thinnest snapshot, `ESIMUSDTM`, held 181 bids and 200 asks.

### Idle repeats

`increment@10ms` repeats nothing.
A quiet contract went up to 10.1 s (`INITUSDTM`) and 8.9 s (`AAPLUSDTM`) without a frame, and a busy one at most 0.5 s.
The depth 50 channels of both sockets resend the full book every 100 ms whether or not it changed.

### Unknown, closed and wrong requests

| request on the UTA socket | reply | then |
|---|---|---|
| `obu` `NOPEUSDTM` | `{"id":"p17","result":true}` | nothing |
| `obu` `XBT-USDT`, a spot id | `"result":true` | nothing |
| `obu` depth `20` | `{"id":"p18","result":false,"message":"invalid request data"}` | |
| `obu` `tradeType` `SPOT` | `{"id":"p20","result":false,"reason":"topic Obu type = \"public_spot\" not allowed in current environment"}` | |
| channel `nope` | `"result":false,"message":"invalid request data"` | |
| `obu` with a `symbols` array | `{"id":"p22","result":false,"reason":"symbols are not supported for topic obu"}` | |
| `obu` `ESIMUSDTM` twice | two `"result":true` | one snapshot, and in the rerun no frame within 12 s |
| `obu` depth `1` on the dated future `XBTMZ26` | `"result":true` | nothing in 12 s, and one snapshot in the rerun |
| text that is not JSON | no reply | the socket stays open |

| request on the classic socket | reply |
|---|---|
| `/contractMarket/level2:NOPEUSDTM` | `{"id":"p27","type":"ack"}`, then nothing |
| `/contractMarket/level2Depth20:XBTUSDTM` | `{"id":"p28","type":"error","code":404,"data":"topic does not exist"}` |
| `/contractMarket/nope:XBTUSDTM` | same 404 |
| `level2Depth50:XBTUSDTM` twice | two acks, one stream |
| text that is not JSON | `{"id":"…","type":"error","code":400,"data":"Unrecognized token 'not': …"}` with a random id |

A closed or delisted perpetual was not available, since all 682 read `Open`.
Because both sockets acknowledge a symbol they will never serve, the feed has to notice a stream with no snapshot on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client ping `{"id", "type": "ping"}` at least every `pingInterval`, and a missing pong within `pingTimeout` means the socket is dead, S4. On the UTA socket "The connection will be dropped if the ping frequency is exceeded once per second", S2 | the UTA pong is `{"type":"pong","id":"p32","ts":1790113111261396000}` with `ts` in nanoseconds, and the classic pong is `{"id":"p16","type":"pong","timestamp":1790113097236506}` in microseconds |
| silence the server tolerates | the classic timeout counts from the client's last outgoing message, S4 | UTA with a subscription and no client frame: still open at 90 s in both runs. UTA with no subscription and no client frame: closed at 60.3 s, code 1006, in both runs. Classic with a streaming subscription and no client frame: closed at 60.5 s, code 1000 `Bye`, in both runs. Classic with no subscription: closed at 60.4 s, once with code 1006, and once with code 1000 `Bye` after `{"type":"error","code":400,"data":"ping timeout"}` at 60.0 s |
| forced disconnect | load balancing, once or twice a week, S12 | none in 90 s |
| maintenance notice | none documented for public sockets. `/contract/announcement` covers funding only | none seen |
| compression | Not publicly specified | the UTA socket did not negotiate permessage-deflate when offered. The classic socket answered `sec-websocket-extensions: permessage-deflate` when offered, and sends text JSON when not |
| handshake | | UTA open 303 to 345 ms. Classic open 309 to 447 ms after a token call of 180 to 383 ms |
| funding pushes | `funding-fee` and `funding-fee-all-symbols` every minute, S6, S7 | `funding-fee` at 22:01:00.97 and 22:02:00.58 UTC, `funding-fee-all-symbols` at 22:01:01.29 and 22:02:01.24 with 682 rows. `ft` is the start of the current interval, `nt` the next settlement, `lfr` the last settled rate |
| throughput | | 100 USDT perpetuals, every sixth by 24 h turnover, on one UTA socket over 55 s from open: 318 frames per second on average, median 330, peak 649, 76 KB per second, 239 bytes per frame and 20.9 µs `JSON.parse` per frame. The rerun gave 446, 451, 685, 107 KB, 241 bytes and 17.1 µs |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-22.
Book arrays are cut to their first levels, as each caption says.

UTA welcome, sent as a binary frame.

```json
{"sessionId":"e8e46556-ae1d-4871-be0b-4efeaa5f2f6a","message":"welcome","pingInterval":18000}
```

UTA subscribe and acknowledgement.

```json
{"id": "p1", "action": "SUBSCRIBE", "channel": "obu", "tradeType": "FUTURES", "symbol": "XBTUSDTM", "depth": "increment@10ms"}
```

```json
{"id":"p1","result":true}
```

UTA delta on the deprecated `increment` depth, which carries the same fields as `increment@10ms`.

```json
{"T":"obu.FUTURES", "dp":"increment", "t":"delta", "P":1790113097769363986, "d":{"a":[],"b":[["83614","11"]],"C":1747821025294,"s":"XBTUSDTM","M":1790113097768000000,"O":1747821025294}}
```

UTA snapshot on `increment@10ms`, the first two levels per side of 500 kept.

```json
{"T":"obu.FUTURES", "dp":"increment@10ms", "t":"snapshot", "P":1790114460671676191, "d":{"a":[["2749.69","96"],["2749.7","102"]],"b":[["2749.68","277"],["2749.61","45"]],"s":"ETHUSDTM","C":1736604716203,"M":1790114460661000000,"O":1736604716203}}
```

UTA delta on `increment@10ms`, two events in one frame.

```json
{"T":"obu.FUTURES", "dp":"increment@10ms", "t":"delta", "P":1790114459840641662, "d":{"a":[],"b":[["85973.3","16236"],["85887.1","98"]],"C":1747821262585,"s":"XBTUSDTM","M":1790114459839000000,"O":1747821262584}}
```

UTA mark price and funding.

```json
{"T":"mark-price", "P":1790113097443102278, "d":{"s":"XBTUSDTM","mp":"86201.79","ip":"86248.81","oi":"11481754","ts":1790113097000}}
```

```json
{"T":"funding-fee", "P":1790114460967760880, "d":{"s":"XBTUSDTM","fr":"-0.000076","ft":1790092800000,"lfr":"-0.000019","nt":1790121600000,"gl":28800000,"fc":"0.003","ff":"-0.003"}}
```

UTA keepalive.

```json
{"id": "p32", "type": "ping"}
```

```json
{"type":"pong","id":"p32","ts":1790113111261396000}
```

Classic welcome, level2 delta, depth 50 frame and instrument frame.

```json
{"id":"probebook","type":"welcome"}
```

```json
{"topic":"/contractMarket/level2:XBTUSDTM","type":"message","subject":"level2","sn":1747821025244,"data":{"sequence":1747821025244,"change":"83614,buy,12","timestamp":1790113097240}}
```

```json
{"topic":"/contractMarket/level2Depth50:ETHUSDTM","type":"message","subject":"level2","sn":1790114460610,"data":{"sequence":1736604716188,"asks":[["2749.69",44],["2749.7",102]],"bids":[["2749.68",241],["2749.61",45]],"timestamp":1790114460610,"ts":1790114460610}}
```

```json
{"topic":"/contract/instrument:XBTUSDTM","type":"message","subject":"mark.index.price","data":{"markPrice":86201.79,"indexPrice":86248.81,"granularity":1000,"timestamp":1790113097000}}
```

```json
{"topic":"/contract/instrument:XBTUSDTM","type":"message","subject":"funding.rate","data":{"period":1,"granularity":60000,"fundingRate":-0.000076,"timestamp":1790114460000}}
```

The depth 50 frame keeps the first two of 50 levels per side.

## 7. Private channels

Named for a future execution stage, from the documentation, not probed.

- UTA: `wss://wsapi-push.kucoin.com` with a private token, per CCXT Pro at `server/node_modules/ccxt/js/src/pro/kucoin.js` line 54, carrying the Order, Execution, Balance, Position, LiquidationWarning and Leverage channels that the documentation lists under UTA WebSocket V2, S2.
- Classic: a private token from `POST /api/v1/bullet-private`, as CCXT Pro calls it at line 142, then the Orders, Balance, Positions, Margin Mode, Cross Margin Leverage and Stop Orders channels, S4. CCXT Pro subscribes `/contractMarket/tradeOrders` at line 2339 and `/contractAccount/wallet` at line 2549.
- Order entry over the socket exists on both, and shares the REST order rate limit, S12.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://x-push-futures.kucoin.com` for every perpetual kept | no token call, every family on one URL, snapshot then deltas |
| channel | `obu`, `tradeType` `FUTURES`, depth `increment@10ms` | snapshot on subscribe, a strict `O` chain, 500 levels covers the engine's 20, and the plain `increment` depth is past its announced deprecation |
| markets per connection | 100 | 100 streams ran with 0 gaps at 318 and 446 frames per second, and 600 topics is the documented cap |
| subscribe frames | one frame per market, `{"id": "<n>", "action": "SUBSCRIBE", "channel": "obu", "tradeType": "FUTURES", "symbol": "<rawMarketId>", "depth": "increment@10ms"}`, at most 20 per second | the topic takes no list, and a connection may send 300 messages per 10 s, pings included |
| connection stagger | 1,000 ms | 250 new connections per 5 minutes per IP |
| keepalive | `{"id": "<n>", "type": "ping"}` every 15 s | the welcome says 18,000 ms, and more than one ping a second drops the socket |
| `maxSilenceMs` | 45,000 | three missed pongs, and a quiet contract went 10 s without a book frame, so the pong has to count as traffic |
| parsing | decode every frame as UTF-8 text whether the opcode is binary or text | the UTA socket sends JSON in binary frames |
| routing | `d.s` is the `rawMarketId` | |
| snapshot | `t === "snapshot"`: `resetBook` and store `C` | documented replace semantics |
| delta | apply only when `O === last + 1`, then store `C` | the strict rule held on every delta, and the looser documented rule was never needed |
| resync | a gap, or a delta before any snapshot: `resync`, which terminates the socket and resubscribes | the engine's existing path |
| unserved stream | log a stream with no snapshot 15 s after its ack | unknown and spot ids are acked as success and stay silent, and a real snapshot took up to 6.2 s |
| receive time | stamp on arrival, never from `P` or `M` | `P` does not survive `JSON.parse` exactly |
| sizes | `Number()` of the string, in lots | lots of `contractSize` coins |
| deflate | keep `perMessageDeflate: false` | the UTA socket does not negotiate it |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | UTA WebSocket, Public Channels, Orderbook, modified 2026-07-20 | https://www.kucoin.com/docs-new/3470221w0 | 2026-09-22 | KuCoin, global | URLs, `obu` subscribe frame, depths, speeds, deprecation, fields, calibration rule, sections 1 to 4 |
| S2 | UTA WebSocket, Introduction, modified 2026-08-17 | https://www.kucoin.com/docs-new/websocket-api/base-info/introduction-uta | 2026-09-22 | KuCoin, global | no token for public data, welcome, ping, ack shape, section 3 and 5 |
| S3 | Get Public Token - Classic Futures, modified 2026-01-28 | https://www.kucoin.com/docs-new/websocket-api/base-info/get-public-token-futures | 2026-09-22 | KuCoin, global | token call, weight 10, section 1 |
| S4 | Classic WebSocket, Introduction, modified 2026-01-28 | https://www.kucoin.com/docs-new/websocket-api/base-info/introduction | 2026-09-22 | KuCoin, global | token validity, heartbeat rules, subscribe frame, sections 1, 3 and 5 |
| S5 | UTA WebSocket, Mark Price, modified 2026-08-27 | https://www.kucoin.com/docs-new/3470358w0 | 2026-09-22 | KuCoin, global | `mark-price` channel, section 2 |
| S6 | UTA WebSocket, Funding Fee Rate, modified 2026-08-27 | https://www.kucoin.com/docs-new/3470357w0 | 2026-09-22 | KuCoin, global | `funding-fee` channel, sections 2 and 5 |
| S7 | UTA WebSocket V2, All Funding Fee Rates, modified 2026-09-11 | https://www.kucoin.com/docs-new/3470412w0 | 2026-09-22 | KuCoin, global | `funding-fee-all-symbols` channel, sections 2 and 5 |
| S8 | Classic Futures, Orderbook - Increment, modified 2026-01-15 | https://www.kucoin.com/docs-new/3470082w0 | 2026-09-22 | KuCoin, global | `level2` channel and its REST recipe, section 2 |
| S9 | Classic Futures, Orderbook - Level 50, modified 2026-01-15 | https://www.kucoin.com/docs-new/3470097w0 | 2026-09-22 | KuCoin, global | `level2Depth50`, section 2 |
| S10 | Classic Futures, Instrument, modified 2026-01-15 | https://www.kucoin.com/docs-new/3470087w0 | 2026-09-22 | KuCoin, global | `/contract/instrument`, section 2 |
| S11 | Classic Futures, Funding Fee Settlement, modified 2026-01-21 | https://www.kucoin.com/docs-new/3470088w0 | 2026-09-22 | KuCoin, global | `/contract/announcement`, section 2 |
| S12 | Rate Limit Rule (UTA), modified 2026-09-20 | https://www.kucoin.com/docs-new/rate-limit-rule-uta | 2026-09-22 | KuCoin, global | UTA connection, message and topic limits, load balancing, sections 3, 5 and 8 |
| S13 | Rate Limit Rule (Classic), modified 2026-08-27 | https://www.kucoin.com/docs-new/rate-limit-rule-classic | 2026-09-22 | KuCoin, global | classic connection, message and topic limits, section 3 |
| S14 | Error Code, Websocket, modified 2026-08-27 | https://www.kucoin.com/docs-new/error-code/websocket | 2026-09-22 | KuCoin, global | subscription and session error codes, section 3 |
| S15 | Get All Symbols, OpenAPI export | https://www.kucoin.com/docs-new/rest/futures-trading/market-data/get-all-symbols.md | 2026-09-22 | KuCoin, global | `multiplier` meaning, section 4 |
| S16 | CCXT Pro 4.5.68 `kucoin.js` | `server/node_modules/ccxt/js/src/pro/kucoin.js` | 2026-09-22 | CCXT | URLs, token call, the `level2Depth20` comment, sections 1, 2 and 7 |
| S17 | Classic Futures, Symbol Snapshot | https://www.kucoin.com/docs-new/3470089w0 | 2026-09-22 | KuCoin, global | `/contractMarket/snapshot` every 5 s, section 2 |
| S18 | Classic Futures, Ticker V2 | https://www.kucoin.com/docs-new/3470080w0 | 2026-09-22 | KuCoin, global | `/contractMarket/tickerV2` in real time, section 2 |
| P1 | `ws-probe.mjs book`, 21:38 UTC, and the rerun with frame capture at 22:01 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/kucoin/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs batch`, `silence` and `deflate`, 21:40 to 21:43 UTC, and the rerun at 22:04 to 22:06 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/kucoin/ws-probe.mjs) | 2026-09-22 | this host | sections 3 and 5 |
