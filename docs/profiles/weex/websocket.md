# WEEX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 03:20 to 03:41 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the public futures WebSocket v3 of WEEX (CCXT id `weex`), whose one perpetual family is USDT-margined, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/weex/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation was read from the static pages under `https://www.weex.com/api-doc/contract/` and from the single file `https://www.weex.com/api-doc/llms-full.txt`, both of which answered this host with HTTP 200.
Times below are UTC on 2026-09-23 unless a line says otherwise.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals, crypto and TradFi, public | `wss://ws-contract.weex.com/v3/ws/public`, S1 | open in 321 to 471 ms over 28 opens, 995 contracts served |
| USDT-M perpetuals, private | `wss://ws-contract.weex.com/v3/ws/private`, with header authentication, S1 | not probed |
| spot, public | `wss://ws-spot.weex.com/v3/ws/public`, built from `server/node_modules/ccxt/js/src/pro/weex.js` lines 46 and 104 | not probed |
| V2 contract socket | a V2 depth channel page still exists, and the documentation menu reads "V2 (Sunsets Sep 30)" | not probed |

WEEX lists no coin-margined, USDC-margined or dated contract, so one URL carries every perpetual, crypto (`PERPETUAL`, 577) and TradFi (`TRADIFI_PERPETUAL`, 418) alike, see [`rest.md`](./rest.md) section 2.
`ws-contract.weex.com` is a CloudFront name, and it resolved to four addresses in `143.204.160.0/24` on 2026-09-23.
Every socket, subscribed or not, first receives a greeting `{"cid": …, "event": "connected", "time": …}`.

## 2. Channel matrix for public market data

| channel | stream name | depth and speed | probed on 2026-09-23 |
|---|---|---|---|
| depth | `<SYMBOL>@depth200` | 200 levels, S2 | snapshot then deltas, pushed every 500 ms, recommended |
| depth | `<SYMBOL>@depth15` | 15 levels, S2 | snapshot then deltas every 500 ms, fewer levels than the engine's 20 |
| ticker (the "Market Channel") | `<SYMBOL>@ticker` | "pushed whenever upstream metrics change (typically within 100-300 ms)", S3 | 125 BTC frames and 75 AAPL frames in 75 s, carries mark `m` and index `i` |
| trade | `<SYMBOL>@trade` | on trade, S1 | not probed |
| kline | `<SYMBOL>@kline_<interval>_<priceType>`, with `LAST_PRICE` or `MARK_PRICE`, S1 | per interval | not probed |
| best bid and ask | none for contracts | | CCXT refuses it for contracts, "watchBidsAsks is supported for spot markets only", `server/node_modules/ccxt/js/src/pro/weex.js` line 922 |
| mark, index, funding | no dedicated channel | | the ticker carries `m` and `i`, and no stream carries a funding rate |

The only two depth levels are 15 and 200.
`BTCUSDT@depth50` is refused, section 4.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL for all contracts, S1 | crypto and TradFi perpetuals share the socket, 100 of a mixed slice delivered on one connection |
| subscribe frame shape | `{"method": "SUBSCRIBE", "params": ["BTCUSDT@ticker", "BTCUSDT@depth15"], "id": 1}`, S1 | one frame with 100 stream names got one ack `{"result":true,"id":1}` and every stream delivered |
| unknown symbol expectation | ack with `result` false and `msg`, S2 | `NOPEUSDT@depth200` answers `INVALID_ARGUMENT: invalid symbol : cmt_nopeusdt`. The delisted `IKAUSDT@depth200` is acked true and sends one empty snapshot with `U` and `u` 0 |
| chunk unit and budget | "maximum 100 channels per connection" and "240 operations/hour/connection", S1 | a 101st stream, sent after 100, was acked true and delivered in all three batch runs, so the cap was not enforced at 101 |
| keepalive mechanism | the server sends `{"event":"ping","time":"…"}` and the client answers `{"method":"PONG","id":1}`. "The server will actively terminate connections that fail to respond more than 10 times.", S1 | one ping a minute on a subscribed socket, the three captured `time` fields each on the half minute, 03:21:30, 03:36:30 and 03:40:30. No protocol ping. No ping at all on an unsubscribed socket |
| connection lifetime and maintenance notice | Not publicly specified | no lifetime cap reached in 110 s, no notice frame seen |
| handshake and operation rate limits | "300 connection requests/IP/5 minutes, maximum 20 concurrent connections per IP", S1 | no refusal over 28 opens between 03:18 and 03:41, at most three at once |
| public market data authentication | none, but a `User-Agent` header is required: "If this field is missing, the request will be blocked by the firewall", S4 | a handshake with no `User-Agent` header, and one with an empty value, opened and delivered 9 or 10 frames in 3 s, twice each, section 5 |
| message parse and routing | depth frames carry `e`, `E`, `s`, `U`, `u`, `l`, `d`, `b`, `a`, S2 | route on `e` (`depthSnapshot` or `depth`), then `s` and `l`. `s` is CCXT's `market.id` |
| subscribe acknowledgement shape | `{"result": true, "id": 2}`, and `msg` when false, S2 | as documented. The snapshot can arrive before the ack |
| symbol identifier format | `BTCUSDT`, upper case, S1 | CCXT `market.id` equals the REST `symbol` on 995 of 995, and 100 of 100 ids subscribed as REST spells them delivered frames whose `s` matched, in each batch run. A lower case `btcusdt@depth15` was also accepted and delivered as `BTCUSDT` |
| number representation | levels `[price, size]` as strings, S2 | strings on both sides, sizes fractional where the contract unit is below one coin |
| timestamp representation | `E` event time in ms, S2 | integer ms. Arrival minus `E` had a median of 51 to 60 ms per stream, with the clock within 6 ms of the server, see [`rest.md`](./rest.md) section 7 |
| size unit | Not publicly specified on the channel | base coins, not contracts, section 4 |
| sequence semantics | "Consume update IDs sequentially (`U` through `u`). If any update is missed, resubscribe", S2 | each delta's `U` equals the previous frame's `u`, not `u` plus one, on all 748 and 745 deltas of the two book runs and all 8,850, 8,457 and 8,346 of the three batch runs |
| idle repeat behaviour | not documented | nothing is repeated. A book that does not change sends nothing, and `JPMUSDT` sent its snapshot and then 0 deltas in 45 s |

## 4. The book channel in detail

`<SYMBOL>@depth200` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame of each stream is `"e": "depthSnapshot"` with `"d": "SNAPSHOT"`, up to 200 bids and 200 asks, and a `U` and `u` pair.
In both book runs each stream got exactly one snapshot, 101 to 202 ms after the subscribe frame was sent, and no further snapshot in 75 s.
In the batch runs all 100 streams had their snapshot 438 to 474 ms after the subscribe.
The documentation page for the depth channel does not describe the snapshot, S2.
CCXT resets its book on `depthSnapshot` and applies every other frame as a delta without checking ids, at `server/node_modules/ccxt/js/src/pro/weex.js` lines 886 to 894.

### Delta semantics

A delta is `"e": "depth"` with `"d": "CHANGED"` and `b` and `a` arrays of `[price, size]` string pairs.
A size of `"0"` deletes the level.
No delta in either book run was empty, since the server sends a frame only when a level changed.
One delta can delete a bid and add an ask at the same price, as the BTC capture in section 6 shows, so a feed applies the whole frame before it reads the touch.
The maintained book was crossed after 0 of the 745 deltas of the second book run.

### Push interval

Every stream is conflated to one frame per 500 ms.
The gap between consecutive `E` stamps had a median of 500 ms on every stream, from 396 to 512 ms, in the second book run.
A busy book therefore sends 149 or 150 deltas in 75 s, and the batch median was 90 deltas per stream in 45 s.
`depth15` runs on the same 500 ms grid.
This is the coarsest book cadence among the venues profiled so far, and a cross on WEEX is seen at most twice a second.

### Sequence and gap rule

```text
e = depthSnapshot            replace the book, last = u
e = depth, U = last          apply, last = u
e = depth, U ≠ last          gap: resubscribe (documented), or terminate the socket (the engine's resync)
```

The first delta after a snapshot had `U` equal to the snapshot's `u` on every stream, for example snapshot `u` 16938207498 and then delta `U` 16938207498 on `BTCUSDT`.
0 deltas in any run had `U` equal to the previous `u` plus one, and 0 had any other value.
A feed written for the Gate or Binance rule of `U = last + 1` would resync on every frame.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | descending, on 5 of 5 streams in both runs | ascending, on 5 of 5 |
| delta | descending, 0 unordered bid arrays on 745 deltas | ascending, 0 unordered ask arrays |
| REST `depth` | descending, 200 levels | ascending |

The order is kept, but the feed still applies levels by price.

### Level window

The server keeps the stream at 200 levels per side.
A book maintained from the snapshot and every delta held at most 200 bids and 200 asks on `BTCUSDT` and `ETHUSDT` over 75 s, so a level leaving the window arrives as a `"0"` size.
A thin contract holds fewer: the socket book of `DOODUSDT` held at most 76 bids and 75 asks, and the REST book at `limit=200` returned 75 bids and 73 asks in both compares.

### Size unit against CCXT `contractSize`

| contract | CCXT `contractSize` | socket size at the touch | REST size at the same price | reading as coins |
|---|---:|---|---|---|
| `BTCUSDT` | 0.0001 | `"2.8717"` | `"2.8717"` | 2.8717 BTC, about 249,000 USDT |
| `ETHUSDT` | 0.001 | `"45.170"` | `"45.170"` | 45.17 ETH |
| `DOODUSDT` | 10 | `"737340"` | `"737340"` | 737,340 DOOD |

The socket and the REST book agreed on 40 of 40 touch levels on every compare, at the same update id, in both runs.
The REST sizes are coin amounts that are whole multiples of `contractVal` on every level of three runs, for example 400 of 400 on `BTCUSDT`, see [`rest.md`](./rest.md) section 5.
CCXT's own order path agrees, since it sends `amount` straight into `quantity` at `server/node_modules/ccxt/js/src/weex.js` line 2012, with an amount step equal to `contractVal` on 995 of 995 contracts.
CCXT nevertheless sets `contractSize` to `contractVal` at line 1060.
So the unit on the wire is the base coin, and the engine's `sizeMul` would shrink a BTC size by 10,000 and inflate a DOOD size by 10.
The registry's existing `contractSize: 1` pin, at [`../../../server/src/ccxt/types.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/types.ts) line 22, corrects it for every WEEX market, as it does for Gemini.

### One-sided and empty books

The delisted `IKAUSDT` answered with a snapshot whose `b` and `a` were both empty and whose `U` and `u` were 0, and then nothing.
No live one-sided book was seen.
The engine's `resetBook` accepts an empty side.

### Idle repeats

Nothing is repeated.
In the third batch run, 8 of 100 streams sent fewer than 45 deltas in 45 s: `JPMUSDT` 0, `MDBUSDT` 9, `BRKBUSDT` 11, `DISUSDT` 15, `AMCUSDT` 17, `FUTUUSDT` 21, `UVXYUSDT` 27 and `EVAAUSDT` 34.
Seven of the eight are perpetuals on US listed stocks or funds, probed while the US market was closed.

### Unknown, closed and wrong-level symbols

| request | reply | then |
|---|---|---|
| `NOPEUSDT@depth200` | `{"result":false,"id":101,"msg":"INVALID_ARGUMENT: invalid symbol : cmt_nopeusdt"}` | |
| `BTCUSDT@depth50` | `{"result":false,"id":102,"msg":"INVALID_ARGUMENT: invalid depth level : 50"}` | |
| `BTCUSDT@nope` | `{"result":false,"id":103,"msg":"INVALID_ARGUMENT: invalid event : nope"}` | |
| `btcusdt@depth15` | `{"result":true,"id":104}` | delivers as `BTCUSDT` |
| `IKAUSDT@depth200`, delisted in June 2026 | `{"result":true,"id":105}` | one empty snapshot with `U` 0 |
| `ETHUSDT@depth15` twice | both `{"result":true}` | one stream, no error |
| method `FOO` | `{"result":false,"id":108,"msg":"INVALID_ARGUMENT: invalid event : FOO"}` | |
| method `PING` from the client | `{"result":true,"id":109}` | |
| text that is not JSON | `{"result":false,"msg":"INVALID_ARGUMENT: unrecognized message : hello"}` | the socket stays open |

Because a delisted symbol is acked and served an empty book, the feed has to treat a snapshot with `u` 0 as a dead stream.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server `{"event":"ping","time":"…"}`, client `{"method":"PONG","id":1}`, S1 | one server ping per minute on a subscribed socket, stamped on the half minute. A `PONG` gets no reply. A client `{"method":"PING","id":n}` gets `{"result":true,"id":n}` |
| silence the server tolerates | ends a connection that fails to answer "more than 10 times", S1 | a socket with no subscription closed at 60.38 to 60.42 s with code 1006 and no close frame, in two runs, whether or not it would have answered pings, and it received no ping. A socket subscribed to a quiet book that never answered the one ping it got stayed open for the full 110 s, twice. The ten missed pings were not reached |
| forced disconnect | Not publicly specified | none in any run |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | a client that offered permessage-deflate got `permessage-deflate;client_max_window_bits=15` back, twice. With deflate refused, as the engine does, every frame was plain text JSON |
| handshake | a `User-Agent` header is required, S1 and S4 | opens in 321 to 471 ms. Without the header the handshake still opened and delivered on 2026-09-23, section 3 |
| subscription limits | 100 channels and 240 operations per hour per connection, 20 connections per IP, S1 | 101 streams on one connection delivered. The other limits were not approached |
| throughput | | 100 perpetuals, every tenth by 24 h volume, three runs: median 185 to 197 frames per second, peak 203, 51 to 55 KB per second, 273 to 278 bytes per frame, 15 to 18 µs `JSON.parse` per frame |

The engine opens its sockets with no headers at all, at [`../../../server/src/feeds/book/VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 81, and the `ws` library adds no `User-Agent` of its own.
That worked on 2026-09-23, but it contradicts the documentation, and CCXT Pro sends `User-Agent: ccxt` with the comment "the exchange requires headers", at `server/node_modules/ccxt/js/src/pro/weex.js` line 55.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Arrays are cut to their first levels.

Greeting on open.

```json
{"cid":"a0180647-e051-760c-35ca-e4d7d3522440","event":"connected","time":"1790134567942"}
```

Subscribe, and its acknowledgement.

```json
{"method": "SUBSCRIBE", "params": ["BTCUSDT@depth200", "ETHUSDT@depth200", "DOODUSDT@depth200", "SNDKUSDT@depth200", "BTCUSDT@depth15", "BTCUSDT@ticker", "DOODUSDT@ticker", "SNDKUSDT@ticker", "AAPLUSDT@ticker"], "id": 1}
```

```json
{"result":true,"id":1}
```

Snapshot, three of its 200 bids kept, then the two deltas that followed it.
The capture file cut the snapshot line before its asks, so the `a` key is left out here rather than invented.
Each delta's `U` equals the previous frame's `u`.

```json
{"e":"depthSnapshot","E":1790134568048,"s":"BTCUSDT","U":16938207383,"u":16938207498,"l":200,"d":"SNAPSHOT","b":[["86646.0","2.5598"],["86645.7","0.6722"],["86645.4","0.5006"]]}
```

```json
{"e":"depth","E":1790134568445,"s":"BTCUSDT","U":16938207498,"u":16938207546,"l":200,"d":"CHANGED","b":[["86646.0","0"],["86645.7","0"],["86645.4","0"]],"a":[["86645.2","2.4668"],["86645.3","2.6866"],["86645.4","2.8482"]]}
```

```json
{"e":"depth","E":1790134568944,"s":"BTCUSDT","U":16938207546,"u":16938207584,"l":200,"d":"CHANGED","b":[["86645.1","0"],["86645.0","2.8238"],["86643.7","0.6982"]],"a":[["86645.1","2.7548"],["86645.5","0"]]}
```

Server ping, and the answer the probe sent.

```json
{"event":"ping","time":"1790134590000"}
```

```json
{"method":"PONG","id":2}
```

Errors.

```json
{"result":false,"id":101,"msg":"INVALID_ARGUMENT: invalid symbol : cmt_nopeusdt"}
```

```json
{"result":false,"id":102,"msg":"INVALID_ARGUMENT: invalid depth level : 50"}
```

Ticker, which carries the mark `m` and the index `i`.

```json
{"e":"ticker","E":1790134568308,"s":"BTCUSDT","d":[{"p":"1067.6","P":"0.012475","w":"86029.22669334","c":"86645.2","o":"85577.6","h":"86814.0","l":"85079.9","v":"27024.8956","q":"2324930869.93625","O":1790047800000,"C":1790134200000,"n":465441,"m":"86660.8","i":"86690.49875"}]}
```

In the 75 s of the second book run, the BTC ticker's `m` equalled its last trade `c` on 42 of 125 frames and never equalled `i`.
The AAPL ticker's `m` equalled `c` on 75 of 75 frames and took one value throughout, which is the mark and index trap described in [`rest.md`](./rest.md) section 4.

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use `wss://ws-contract.weex.com/v3/ws/private` with the headers `ACCESS-KEY`, `ACCESS-PASSPHRASE`, `ACCESS-TIMESTAMP` and `ACCESS-SIGN`, where the signature is a base64 HMAC SHA256 of the timestamp and `/v3/ws/private`.
The channels are `account`, `fill`, `orders` and `positions`, and a private socket's ping is `{"type":"ping","time":"…"}`.
CCXT Pro builds the same headers at `server/node_modules/ccxt/js/src/pro/weex.js` lines 125 to 160.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://ws-contract.weex.com/v3/ws/public`, sliced | one URL serves every perpetual |
| headers | send a `User-Agent`, which needs `VenueFeed.openConnection` to accept per venue headers | documented as required, and CCXT Pro sends one, although the wire accepted its absence on 2026-09-23 |
| channel | `<rawMarketId>@depth200` | snapshot on subscribe, a strict id chain, 200 levels covers the engine's 20, while `depth15` does not |
| markets per connection | 100 | the documented cap, 0 gaps at about 190 frames per second, and 577 crypto perpetuals then need 6 of the 20 connections an IP may hold |
| subscribe frames | one frame per slice, `{"method": "SUBSCRIBE", "params": ["BTCUSDT@depth200", …], "id": n}` | a 100 stream frame was acked as one, and it spends 1 of the 240 operations an hour a connection may use |
| keepalive | answer every `{"event":"ping"}` with `{"method":"PONG","id":n}`, and send `{"method":"PING","id":n}` every 15 s | the server ping comes once a minute, and the client ping's ack is traffic the silence watch can count |
| `maxSilenceMs` | 30,000 | every slice holds busy books pushing twice a second, a quiet stock book can go 45 s silent on its own, and two missed client pings is a dead socket |
| routing | `frame.s` is the `rawMarketId`, and `frame.l` must be 200 | the snapshot and the deltas name the contract plainly |
| snapshot | `e === 'depthSnapshot'`: `resetBook` and store `u` | replace semantics, one per subscribe |
| delta | apply only when `U === last`, then store `u` | 0 exceptions in 27,146 deltas over two book runs and three batch runs |
| resync | `U !== last`, or a delta before any snapshot: `resync`, which terminates the socket and resubscribes | the documented remedy is to resubscribe |
| dead stream | log a snapshot with `u === 0` and empty sides | a delisted symbol is acked and served that |
| receive time | stamp on arrival, never from `E` | the engine's rule, and `E` sits on a 500 ms grid |
| sizes | `Number()` of the string, in coins, with the registry's `contractSize: 1` | the unit is the base coin, section 4 |
| deflate | keep `perMessageDeflate: false` | the server negotiates it only when asked |

The 500 ms conflation is a property of the venue, not of this shape, and no public channel was found that is faster.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | WEEX Futures API, Websocket Overview | https://www.weex.com/api-doc/contract/Websocket/websocket-intro | 2026-09-22 | WEEX, global | URLs, subscribe shape, connection and subscription limits, ping and pong, User-Agent, private headers and channel names, sections 1 to 3, 5 and 7 |
| S2 | WEEX Futures API, Depth Channel | https://www.weex.com/api-doc/contract/Websocket/public/Depth-Channel | 2026-09-22 | WEEX, global | depth levels 15 and 200, payload fields, the processing tip on update ids, sections 2 to 4 |
| S3 | WEEX Futures API, Market Channel | https://www.weex.com/api-doc/contract/Websocket/public/Tickers-Channel | 2026-09-22 | WEEX, global | ticker fields `m` and `i` and its push rate, section 2 |
| S4 | WEEX Futures API, FAQs, Q2 on WebSocket 403 | https://www.weex.com/api-doc/contract/apifaq | 2026-09-22 | WEEX, global | the User-Agent requirement, sections 3 and 5 |
| S5 | WEEX API documentation as one file | https://www.weex.com/api-doc/llms-full.txt | 2026-09-22 | WEEX, global | the same pages as S1 to S4, read in one download |
| S6 | CCXT Pro 4.5.68 `weex.js` | `server/node_modules/ccxt/js/src/pro/weex.js` | 2026-09-22 | CCXT | URLs, the User-Agent header, the depth default, snapshot handling, pong, sections 1, 2, 4, 5 and 7 |
| S7 | CCXT 4.5.68 `weex.js` | `server/node_modules/ccxt/js/src/weex.js` | 2026-09-22 | CCXT | `contractSize` from `contractVal`, `amount` sent as `quantity`, section 4 |
| P1 | `ws-probe.mjs book`, runs at 03:20 and 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/weex/ws-probe.mjs) | 2026-09-23 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs batch`, runs at 03:22, 03:37 and 03:38 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/weex/ws-probe.mjs) | 2026-09-23 | this host | sequence counts, throughput, the 101st stream, quiet books, sections 3 to 5 |
| P3 | `ws-probe.mjs silence`, runs at 03:23 and 03:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/weex/ws-probe.mjs) | 2026-09-23 | this host | section 5 |
| P4 | `ws-probe.mjs noua` and `deflate`, runs at 03:20 and 03:35 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/weex/ws-probe.mjs) | 2026-09-23 | this host | the User-Agent test and compression, sections 3 and 5 |
