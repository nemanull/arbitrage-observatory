# HashKey Exchange WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 01:36 to 01:53 UTC on 2026-09-23, from the development host near Seattle, about nine minutes of sockets in all.

This profile covers the public market data sockets of HashKey Exchange, site HK, for its spot market, with the book channels in detail.
HashKey Exchange lists no live perpetual, see [`fees.md`](./fees.md) section 3, so the spot book is the researched product, as the survey plan's template change 1 asks.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey-exchange/ws-probe.mjs), run from `server/`, and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| stream | documented URL | probed |
|---|---|---|
| public V1 | `wss://stream-pro.hashkey.com/quote/ws/v1`, S1 | open in 317 to 364 ms over every probe run |
| public V2 | `wss://stream-pro.hashkey.com/quote/ws/v2`, S1 | open in 340 and 351 ms |
| private | `wss://stream-pro.hashkey.com/api/v1/ws/{listenKey}`, S1 | not probed |
| sandbox | `wss://stream-pro.sim.hashkeydev.com/quote/ws/v1` and `/v2`, S1 | not probed |
| HashKey Global, for the record | `wss://stream-glb.hashkey.com/quote/ws/v1` in CCXT Pro, `server/node_modules/ccxt/js/src/pro/hashkey.js` line 29 | not probed, a separate venue |

One socket serves both sites of the shared platform.
Each subscription takes an optional `site`, `HK` by default or `MENA`, S1.
On one V2 socket, HK subscriptions and a `site: "MENA"` subscription to `BTCUSDT-PERPETUAL` were acknowledged together, and both delivered, P1 and P2.
On the default HK site, V1 answers `BTCUSDT-PERPETUAL` with `-100010 Invalid Symbols!`, P1.
`stream-pro.hashkey.com` resolved through a Cloudflare name to a CloudFront distribution with four addresses, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| stream | topic | payload | documented cadence | probed on 2026-09-23 UTC |
|---|---|---|---|---|
| V1 | `depth` | `{"symbol": "BTCUSD", "topic": "depth", "event": "sub", "params": {"binary": false}}` | "Update frequency: 300ms", stated once for the depth section | a full 100 level book on subscribe and then about every 300 ms while the book changes |
| V1 | `mergedDepth` | adds `params.dumpScale` | 300 ms, a full aggregated book each push | not probed by the script |
| V1 | `diffMergedDepth` | needs `params.dumpScale` | 300 ms, "first push is a full snapshot" | a snapshot on subscribe, then deltas chained by `o`, recommended as the alternative |
| V1 | `realtimes`, `trade`, `kline` | same shape | | not probed |
| V2 | `depth` | `{"topic": "depth", "event": "sub", "params": {"symbol": "BTCUSD"}}` | 100 ms | a full 100 level book about every 100 ms, only when it changes, no book on subscribe, recommended with a REST seed |
| V2 | `bbo` | same shape | "Real-time push" | best bid and ask on change, 186 and 191 frames in 70 s on `BTCUSD` |
| V2 | `trade`, `realtimes`, `kline` | same shape | | not probed |

The topic names and payloads are from S1.
No mark, index or funding topic exists on either stream, S1.
`params.binary: true` makes V1 send gzip compressed binary frames, whose first bytes were `1f8b0800` in both deflate runs, P4.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one host, V1 and V2 paths, a `site` field per subscription, S1 | HK and MENA subscriptions share a socket, section 1 |
| subscribe frame shape | V1: `{"symbol", "topic", "event": "sub", "params": {...}}`. V2: `{"topic", "event": "sub", "params": {"symbol"}}`, S1 | V1 takes a comma separated `symbol` list: 38 pairs in one frame all delivered. V2 answers `"ETHUSD,SOLUSD"` with `-100011 Parameter error!`, so one frame per pair |
| unknown symbol expectation | Not publicly specified, the error code table in S1 lists none of the socket codes seen | V1: `{"code":"-100010","desc":"Invalid Symbols!","topic":"depth"}`. V2: `-100011 Parameter error!` |
| chunk unit and budget | Not publicly specified | 38 pairs on one V1 socket in one frame, and 38 V2 frames on one socket, all acknowledged and delivering |
| keepalive mechanism | client sends `{"ping": <ms>}` "every 10 seconds", server answers `{"pong": <ms>}`, S1 | pong in 77 to 79 ms. No server protocol ping and no server JSON ping on any socket |
| connection lifetime and maintenance notice | private stream: closed after 60 minutes without heartbeat, S1. Public: Not publicly specified | a socket with no traffic for 60 s is closed with 1006, section 5. No lifetime cap in 120 s, no maintenance message seen |
| handshake and operation rate limits | Not publicly specified | twelve V1 sockets opened one after another all stayed open, P6. No refusal was returned |
| public market data authentication | none | none |
| message parse and routing | V1 `{symbol, topic, params, data: [...], f, sendTime, channelId, site}`. V2 `{topic, params, data: {...}, site}`, S1 | V1 routes on `symbol`, V2 on `data.s` or `params.symbol` |
| subscribe acknowledgement shape | V2 `{"topic", "event": "sub", "params", "code": "0", "msg": "Success", "site"}`, S1 | as documented on V2. V1 sends no acknowledgement, the first frame is the snapshot, 150 and 157 ms after the subscribe |
| symbol identifier format | `BTCUSD`, `ETHUSDT`, `BTCUSD-PERPETUAL` | identical to the REST `symbol` on 38 of 38 pairs, and to CCXT `hashkey` `market.id` when pointed at the HK host |
| number representation | strings | prices and sizes are strings on every topic |
| timestamp representation | `t` in ms, `sendTime` in ms | `t` is the book's last change: a quiet book's V1 snapshot carried a `t` up to 226 s old |
| size unit | base currency | base currency, section 4 |
| sequence semantics | `diffMergedDepth`: "Subsequent diffMergedDepth pushes use an increasing sequence number" in `o`, S1 | `o` is per pair and steps by exactly 1: 0 gaps in 318 and 302 deltas on three pairs, and in 1,809 and 1,880 deltas on 38 pairs |
| idle repeat behaviour | not documented | V1 `depth` resent an identical book 6 and 2 times in 1,818 and 1,909 frames over 38 pairs. V2 `depth` and `bbo` never repeated. A quiet book sends nothing |

## 4. The book channels in detail

Three channels carry a book: V1 `depth`, V1 `diffMergedDepth` and V2 `depth`.
V1 `depth` and V2 `depth` send the whole top 100 on every push, and `diffMergedDepth` sends a snapshot then deltas.

### Snapshot on subscribe

| channel | first frame | probed |
|---|---|---|
| V1 `depth` | a full book with `"f": true` | 38 of 38 pairs in both batch runs, and quiet `SPICEUSDC` got its one snapshot and nothing else in 60 s |
| V1 `diffMergedDepth` | a full book with `"f": true` and `"o": 0` | 38 of 38 pairs |
| V2 `depth` | nothing until the book changes | 28 of 38 pairs sent a book within 1 s of the acknowledgement, 33 within 15 s, and `GRAMUSD`, `KAIAUSD`, `RLUSDUSD`, `SPICEUSDC` and `USDTHKD` sent none in 15 s, P7 |

Subscribing V1 `depth` to a pair a second time on the same socket returned a second `f: true` snapshot at the same version and no error, P1 and P2.

### Delta semantics

On `diffMergedDepth`, a delta carries only the changed levels as `[price, size]` string pairs, and a size of `"0"` removes the level, S1.
The server keeps the stream at 100 levels per side.
A book kept from the snapshot and every delta never held more than 100 levels on any pair, so a level leaving the window arrives as a `"0"` size, 723 and 682 of them on `BTCUSD` in about 70 s.
A delta mixes levels near the touch with deletions far from it: the delta quoted in section 6 deletes bid `82428.56` and ask `89282.97`, 4.7 % and 3.2 % from the touch.
A delta omits `data.s`, so it routes on the envelope `symbol`.
No empty delta was seen.

### Sequence and gap rule

```text
f = true, o = 0          replace the book
first delta after that    accept, last = o
next delta, o = last + 1  apply, last = o
next delta, o ≠ last + 1  gap: resubscribe the pair or terminate the socket
```

The counter is per pair, not per socket: on one socket `BTCUSD` ran from 387704 to 387830 while `ETHUSD` ran from 500390 to 500561, P1.
The first delta's `o` cannot be checked against the snapshot, whose `o` is 0.
The version `v`, as `"<id>_<scale>"`, rises on every frame, and it links the two streams instead.
The top 20 of the book kept from `diffMergedDepth` equalled the top 20 of the V1 `depth` frame carrying the same version number in 144 of 144 versions found in both, and in 162 of 162 in the rerun, on `BTCUSD`, `ETHUSD` and `XDCUSD`.
V1 and V2 `depth` never delivered a version lower than the previous one.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| V1 and V2 `depth`, every frame | best first, descending, in every frame of both runs | best first, ascending |
| `diffMergedDepth` snapshot | descending | ascending |
| `diffMergedDepth` delta | descending in every delta of both runs | ascending in every delta of both runs |
| REST `/quote/v1/depth` | descending | ascending, see [`rest.md`](./rest.md) section 5 |

The order of levels inside a delta is not documented, so a feed applies deltas by price and never by position.

### Level window

Every V1 and V2 `depth` frame for `BTCUSD`, `ETHUSD` and `SOLUSD` held exactly 100 bids and 100 asks.
`params.limit: 200` on V1 still returned 100, although S1 says the depth "can request up to limit of 200".
Thin pairs hold what they have: `XDCUSD` up to 18 per side and `CCUSD` up to 20.

### Size unit

Spot sizes are in the base currency, so the contract size is 1.
The top 20 bids and asks of the latest V1 `depth` frame for `BTCUSD` matched the REST book in price and size on 40 of 40 levels in all three reads of run one, and on 40, 36 and 40 of 40 in the rerun, P1 and P2.
The misses moved between the two reads, since the socket frame was 233 to 433 ms old when the REST reply arrived.

### One-sided and empty books

`XDCUSD` frames on both streams carried as few as 0 bids and 0 asks in the rerun, so a side with no orders arrives as an empty array, P2.
`BBTCUSD-PERPETUAL` answered with one snapshot of two empty arrays and nothing else, P1 and P2.
The engine's `resetBook` accepts an empty side.

### Freshness

| channel | inter-frame on `BTCUSD`, median | data age at arrival, median | over 38 pairs, median and p90 age, second batch run, P5 |
|---|---|---|---|
| V1 `depth` | 301 ms in both runs | 211 and 215 ms | 215 and 319 ms |
| V2 `depth` | 105 and 109 ms | 96 and 105 ms | 92 and 112 ms |
| V2 `bbo` | 26 and 17 ms | | |

Age is arrival time minus `t`, on a host clock within a few ms of the server's, see [`rest.md`](./rest.md) section 7.
V2 `depth` is about 120 ms fresher than V1.

### Unknown, closed and wrong-site symbols

| request | reply | then |
|---|---|---|
| V1 `depth` `NOPEUSD` | `{"code":"-100010","desc":"Invalid Symbols!","topic":"depth"}` | nothing |
| V1 `depth` `BTCUSDT-PERPETUAL` on the HK site | `-100010 Invalid Symbols!` | nothing |
| V1 topic `nope` | `{"code":"-10004","desc":"Invalid topic!","topic":"nope"}` | |
| V1 `diffMergedDepth` without `dumpScale` | `{"code":"-100013","desc":"DumpScale required!","topic":"diffMergedDepth"}` | |
| V1 text that is not JSON | `{"code":"-10001","desc":"Invalid JSON!"}` | the socket stays open |
| V1 `event: "cancel"` on `SOLUSD` | no acknowledgement | the last `SOLUSD` frame arrived 162 ms before the cancel was sent, and none after |
| V2 `depth` `NOPE` | `{"topic":"depth","event":"sub","params":{"symbol":"NOPE"},"code":"-100011","msg":"Parameter error!","site":"hk"}` | nothing |
| V2 `depth` `"ETHUSD,SOLUSD"` | `-100011 Parameter error!` | nothing |

No delisted pair was probed on the socket.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client `{"ping": <ms>}` every 10 s, server `{"pong": <server ms>}`, S1 | pong in 77 to 79 ms over two runs |
| silence the server tolerates | Not publicly specified for public streams | a socket with no subscription and no client frame closed at 60.36 s in both runs, and one subscribed to quiet `SPICEUSDC`, whose only frame was its snapshot at 0.5 s, closed at 60.33 and 60.34 s, all with 1006 and no close frame. A socket subscribed to busy `BTCUSD` that never sent a ping stayed open 120 s on server traffic alone, and a socket that only pinged every 10 s stayed open 120 s, P3 |
| server ping | none for public streams. The private stream gets a server ping every 30 s, S1 | 0 protocol pings and 0 JSON pings on every socket |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | Not publicly specified | none seen |
| compression | `params.binary: true` gives zip binary, S1 | text JSON frames by default. A client that offered permessage-deflate got no `sec-websocket-extensions` header back in two runs, so the server does not negotiate it, P4 |
| handshake | | 317 to 364 ms to open |
| subscription limits | Not publicly specified | 38 pairs per socket on each stream, no refusal |
| throughput, 38 HK pairs on one socket | | V1 `depth`: 41 and 42 frames a second median, 81 and 79 peak, 93 and 99 KB a second, 2.3 KB and 126 to 132 µs of `JSON.parse` per frame. `diffMergedDepth`: 24 and 25 KB a second. V2 `depth`: 3,769 frames in 45 s, 178 KB a second, 123 µs per frame, P5 |

One `silence` run started alongside a book run ended before any of its sockets reported open, close or an HTTP refusal, and it was not reproduced.
The rerun alone and the twelve socket run opened every socket.

## 6. Captured frames

Trimmed from the probe runs, with book arrays cut to three levels per side.

V1 `diffMergedDepth` subscribe and its snapshot.

```json
{"symbol": "ETHUSD", "topic": "diffMergedDepth", "event": "sub", "params": {"binary": false, "dumpScale": 2}}
```

```json
{"symbol":"ETHUSD","symbolName":"ETHUSD","topic":"diffMergedDepth","params":{"realtimeInterval":"24h","dumpScale":"2","binary":"false"},"data":[{"e":301,"s":"ETHUSD","t":1790128268090,"v":"2546770852_2","b":[["2750.82","14.5411"],["2750.75","0.0073"],["2750.74","23.63"]],"a":[["2750.85","34.535"],["2750.86","21.8114"],["2750.88","18.176"]],"o":0}],"f":true,"sendTime":1790128268344,"channelId":"92e9fefffe175075-00000001-00041081-26cd5ee464861299-452b8b0e","site":"hk","shared":false}
```

A delta, whole, with two deletions far from the touch.

```json
{"symbol":"BTCUSD","symbolName":"BTCUSD","topic":"diffMergedDepth","params":{"realtimeInterval":"24h","dumpScale":"2","binary":"false"},"data":[{"e":301,"t":1790127380923,"v":"1865138364_2","b":[["86505.1","0.00024"],["86499.91","0.00034"],["86413.04","0"],["82428.56","0"]],"a":[["86512.01","0.00024"],["86517.2","0.00034"],["86542.29","0"],["89282.97","0"]],"o":387704}],"f":false,"sendTime":1790127380943,"channelId":"b28ff7fffe7c30b0-00000001-00040da3-e897ea1b705ba9f9-ae261e07","site":"hk","shared":false}
```

V1 `depth` snapshot, whose `t` is 3.2 s older than its `sendTime`, and the next frame at the version the snapshot above carried.

```json
{"symbol":"ETHUSD","symbolName":"ETHUSD","topic":"depth","params":{"realtimeInterval":"24h","binary":"false"},"data":[{"e":301,"s":"ETHUSD","t":1790128265172,"v":"2546770814_18","b":[["2750.84","14.541"],["2750.82","0.0073"],["2750.76","23.6298"]],"a":[["2750.85","34.535"],["2750.86","21.8114"],["2750.88","18.176"]],"o":0}],"f":true,"sendTime":1790128268345,"channelId":"92e9fefffe175075-00000001-00041081-26cd5ee464861299-452b8b0e","site":"hk","shared":false}
```

```json
{"symbol":"ETHUSD","symbolName":"ETHUSD","topic":"depth","params":{"realtimeInterval":"24h","binary":"false"},"data":[{"e":301,"s":"ETHUSD","t":1790128268176,"v":"2546770852_18","b":[["2750.82","14.5411"],["2750.75","0.0073"],["2750.74","23.63"]],"a":[["2750.85","34.535"],["2750.86","21.8114"],["2750.88","18.176"]],"o":0}],"f":false,"sendTime":1790128268418,"channelId":"92e9fefffe175075-00000001-00041081-26cd5ee464861299-452b8b0e","site":"hk","shared":false}
```

The one HK contract, empty.

```json
{"symbol":"BBTCUSD-PERPETUAL","symbolName":"BBTCUSD-PERPETUAL","topic":"depth","params":{"realtimeInterval":"24h","binary":"false"},"data":[{"e":301,"s":"BBTCUSD-PERPETUAL","t":1790127246212,"v":"34719093_18","b":[],"a":[],"o":0}],"f":true,"sendTime":1790127380886,"channelId":"b28ff7fffe7c30b0-00000001-00040da3-e897ea1b705ba9f9-ae261e07","site":"hk","shared":false}
```

V2 acknowledgement for a MENA pair, and a V2 best bid and ask, which carries a `v` the documentation does not list.

```json
{"topic":"depth","event":"sub","params":{"symbol":"BTCUSDT-PERPETUAL"},"code":"0","msg":"Success","site":"mena"}
```

```json
{"topic":"bbo","params":{"symbol":"BTCUSD"},"data":{"s":"BTCUSD","b":"86506.21","bz":"0.63578","a":"86529.32","az":"0.64938","t":1790127381573,"v":"1865138374"},"site":"hk"}
```

Keepalive.

```json
{"ping": 1790128268000}
```

```json
{"pong":1790128268345}
```

Errors.

```json
{"code":"-100010","desc":"Invalid Symbols!","topic":"depth"}
```

```json
{"code":"-100013","desc":"DumpScale required!","topic":"diffMergedDepth"}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
A `listenKey` from `POST /api/v1/userDataStream` opens `wss://stream-pro.hashkey.com/api/v1/ws/{listenKey}`.
It pushes Account Update, Order Update and Ticket Push, and the Market Place stream has a public `rfqs` channel and a private quote channel.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
The engine consumes perpetuals only, so this shape applies only if a spot leg is ever added.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket on `wss://stream-pro.hashkey.com/quote/ws/v2` for the 38 HK pairs | 38 pairs ran on one socket, and no cap is published |
| channel | V2 `depth`, one subscribe frame per pair, `{"topic": "depth", "event": "sub", "params": {"symbol": "<rawMarketId>"}}` | every frame is the whole top 100, about every 100 ms, about 120 ms fresher than V1 |
| seed | one REST `GET /quote/v1/depth?symbol=<id>&limit=100` per pair after its acknowledgement, applied only if no socket frame has arrived for that pair yet | V2 sends no book on subscribe, and 5 of 38 pairs sent none in 15 s |
| apply | `resetBook` on every frame, and drop a frame whose version is below the last applied | full replacement needs no gap rule. The version never went backwards in the probe |
| keepalive | `{"ping": <ms>}` every 10 s | the documented interval, and a quiet socket is closed at 60 s |
| `maxSilenceMs` | 30,000 | the pong is the only traffic a quiet socket gets, three missed pongs is a dead socket |
| resync | on close or silence, reconnect and resubscribe, which reseeds | there is no sequence to lose |
| alternative | V1 `diffMergedDepth` with `dumpScale` set to each pair's tick decimals, with the `o` rule of section 4 | a snapshot on subscribe and a strict per pair chain, at a quarter of the bandwidth, but at the 300 ms cadence |
| receive time | stamp on arrival, never from `t` | a quiet book's `t` can be minutes old |
| deflate | keep `perMessageDeflate: false` and `binary: false` | the server does not negotiate deflate, and the binary option is gzip |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | HashKey Exchange API reference, WebSocket API | https://docs.hashkey.com/hk/en/ | 2026-09-22 | HashKey Exchange | URLs, topics, payloads, cadences, heartbeat, private stream, sections 1 to 7 |
| S2 | HashKey Exchange API documentation on ReadMe, V2 depth and bbo pages | https://hashkeypro-apidoc.readme.io/reference/ws-v2-depth | 2026-09-22 | HashKey Exchange | the older copy, which points to S1 as the new site |
| S3 | CCXT Pro 4.5.68 `hashkey.js` | `server/node_modules/ccxt/js/src/pro/hashkey.js` | 2026-09-22 | CCXT | HashKey Global socket URL, section 1 |
| P1 | `ws-probe.mjs book` at 01:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey-exchange/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs book` rerun at 01:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey-exchange/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6, the second readings, limit and cancel |
| P3 | `ws-probe.mjs silence` at 01:38 and 01:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey-exchange/ws-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P4 | `ws-probe.mjs deflate` at 01:38 and 01:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey-exchange/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 2 and 5 |
| P5 | `ws-probe.mjs batch` at 01:37 and 01:49 UTC, the V2 socket in the second run only | [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey-exchange/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 to 5 |
| P6 | `ws-probe.mjs conns` at 01:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey-exchange/ws-probe.mjs) | 2026-09-23 UTC | this host | section 3 |
| P7 | `ws-probe.mjs v2snap` at 01:53 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hashkey-exchange/ws-probe.mjs) | 2026-09-23 UTC | this host | section 4 |
