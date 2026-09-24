# Coins.ph WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, from the development host near Seattle, between 03:17 and 03:40 UTC on 2026-09-23.

This profile covers the public market data WebSocket of Coins.ph (CCXT id `coinsph`, no CCXT Pro class).
Coins.ph lists no perpetual, so the book channel below is the spot book, as change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) asks, see [`fees.md`](./fees.md) section 3.
Every protocol claim was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/coinsph/ws-probe.mjs), run from `server/`, and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| stream shape | documented URL | probed |
|---|---|---|
| live subscribe | `wss://wsapi.pro.coins.ph/openapi/quote/stream`, then `SUBSCRIBE` frames | open in 418 to 602 ms over all runs, every stream used in this profile |
| combined in the URL | `wss://wsapi.pro.coins.ph/openapi/quote/stream?streams=<a>/<b>` | open in 450, 480 and 501 ms, delivers, but frames are not wrapped, see section 3 |
| raw single stream | `wss://wsapi.pro.coins.ph/openapi/quote/ws/v3/<streamName>` | open in 418, 428 and 471 ms, `btcphp@depth20@100ms` delivers |
| private user data | `wss://wsapi.pro.coins.ph/openapi/ws/<listenKey>` | not probed, section 7 |

The URLs are from S1.
There is one spot market and one socket family, and a socket carries any mix of symbols and channels.
`wsapi.pro.coins.ph` resolved to the Cloudflare addresses 104.18.22.77 and 104.18.23.77, see [`rest.md`](./rest.md) section 1.
Every upgrade returned 101 to this host, with no refusal.

## 2. Channel matrix for public market data

| stream | payload | documented speed | probed |
|---|---|---|---|
| `<symbol>@depth<levels>`, levels 5, 10, 20 or 200 | top N bids and asks with `lastUpdateId` | 100 ms for 5, 10 and 20 levels, 1,000 ms for 200, "when there's update" | `depth20@100ms` recommended, section 4. `depth200` sent 200 levels a side at a median of 536 to 648 ms |
| `<symbol>@depth<levels>@100ms` | same | 100 ms | only `depth20@100ms` was measured. `btcphp@depth5` without the suffix also delivered, and the two paces were not compared |
| `<symbol>@depth` and `<symbol>@depth@100ms` | diff with `U` and `u` | 1,000 ms or 100 ms "when there's update" | `@100ms` probed: 0 gaps, minimum interval 139 to 198 ms, and a tenth percentile of 197 to 202 ms |
| `<symbol>@bookTicker`, `!bookTicker` | best bid and ask with `u` | real time | 10 to 33 frames per symbol in 60 s |
| `<symbol>@trade`, `<symbol>@aggTrade` | trades | real time | not probed |
| `<symbol>@kline_<interval>` | candles | 2,000 ms | not probed |
| `<symbol>@miniTicker`, `!miniTicker@arr`, `<symbol>@ticker`, `!ticker@arr` | 24 h rolling statistics | | not probed |

The stream names and speeds are from S1.
No mark, index or funding stream exists, and the documentation says "indexPrice websocket pushing will be available in the future", S2.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one base URL, S1 | one URL carries every symbol and channel |
| subscribe frame shape | `{"method": "SUBSCRIBE", "params": ["btcusdt@aggTrade", "btcusdt@depth"], "id": 1}`, S1 | as documented. 71 streams in one frame were acknowledged once, and all 71 partial depth streams delivered |
| unknown symbol expectation | `{"code": 2, "msg": "Invalid request: STREAM [%s] was invalid."}` or `{"code":"-100010","desc":"Invalid Symbols!"}`, S1 | no error. `nopephp@depth20@100ms`, the `break` symbol `ethfiphp@depth20@100ms`, `ETHPHP@depth20@100ms`, `btcphp@depth30` and `btcphp@nope` were each acknowledged with `"result":null`, listed by `LIST_SUBSCRIPTIONS`, and sent nothing |
| chunk unit and budget | "A single connection can listen to a maximum of 1024 streams." Error text "params must less than or equals 1024", S1 | 71 streams per socket, on two sockets at once, with no refusal. 1,024 was not tried |
| keepalive mechanism | "The websocket client will send a ping frame every 5 minutes. If the websocket server does not receive a ping frame order write message from the connection within a 5 minute period, the connection will be disconnected." Application ping `{"ping": <ms>}`, answer `{"pong": <ms>}`, S1 | the server sends a protocol ping every 30 s with a millisecond timestamp as payload. `{"ping": <ms>}` came back as `{"pong": <same ms>}` in 103 to 179 ms over all runs |
| connection lifetime and maintenance notice | Not publicly specified for public streams. A user data connection "is only valid for 24 hours", S3 | no disconnect in 100 s, no notice frame seen |
| handshake and operation rate limits | a connection beyond the limit is disconnected, and an IP that is disconnected repeatedly may be banned, with no number given, S1 | 14 control frames sent 1.2 s apart, and six sockets opened within about ten seconds, drew no refusal |
| public market data authentication | none | none |
| message parse and routing | combined stream events are wrapped as `{"stream": "<streamName>", "data": <rawPayload>}`, S1 | no wrapping on either the live subscribe or the `?streams=` URL. Frames route on `s`, the upper case symbol, and on `e`: `depthUpdate` for the diff, `depth` for partial depth, and no `e` for `bookTicker` |
| subscribe acknowledgement shape | `{"result": null, "id": 1}`, S1 | `{"id":"1","result":null}`, with the id echoed as a string. A frame with no `id` was acknowledged as `"id":"1"` |
| symbol identifier format | "All symbols for streams are lowercase", S1 | the stream name must be lower case, and the frame spells the symbol in upper case, `"s":"BTCPHP"`, which is CCXT's `market.id` |
| number representation | strings | prices and sizes are strings, trimmed to the symbol's precision on the socket (`"5419095.8"`, `"0.3336678"`) and padded to 18 decimals on REST |
| timestamp representation | `E`, event time in ms | `E` integer ms. The first partial depth frame after a subscribe carried an `E` 0.1 to 5.6 s old |
| size unit | base asset quantity | base asset quantity, equal to the REST book at the same update id, section 4 |
| sequence semantics | diff: "each new event's U should be equal to the previous event's u+1", S1 | 0 gaps on five symbols over 60 s in each of three runs, and on 69 symbols over 45 s in each of two runs |
| idle repeat behaviour | not documented | no stream repeats an unchanged book. `bookTicker` repeated the same prices and sizes with a new `u` on 2 to 8 of 10 to 33 frames per busy symbol |

Two streams of one kind on one symbol cannot be told apart on one socket.
`btcphp@depth20@100ms` and `btcphp@depth5` both arrive as `"e":"depth","s":"BTCPHP"`, and `btcphp@depth` and `btcphp@depth@100ms` both arrive as `"e":"depthUpdate","s":"BTCPHP"`, in the first exploration run at 03:17 UTC.
A feed therefore subscribes one depth stream per symbol per socket.

## 4. The book channel in detail

`<symbol>@depth20@100ms` is the channel this profile recommends, and the diff stream `<symbol>@depth@100ms` is described beside it because it proves what the partial stream holds.

### Snapshot on subscribe

Yes, for the partial depth stream.
Every symbol's first `depth20@100ms` frame arrived 108 to 117 ms after the subscribe frame was sent, quiet symbols included, in all three book runs.
That frame is the last push the server already held, since its `E` was 126 ms to 5.6 s older than its arrival.
In both batch runs all 71 `trading` symbols delivered a partial depth frame within 45 s, while 2 of 71 sent no diff frame at all.
The diff stream sends no snapshot, and its documented recipe fetches one over REST, S2.

### Delta semantics

The partial depth stream has no deltas.
Each frame is the whole top 20 of each side, and it replaces the book.
The diff stream carries `U`, `u`, and `b` and `a` arrays of `[price, qty]` string pairs, where qty is the new absolute size and `"0.0000000"` deletes the level, S2.
In each 60 s run the diff frames carried 4 to 43 levels on average and up to 116 levels, with 23 to 553 deletions per symbol, and never an empty frame.

### Sequence and gap rule

```text
partial depth: every frame replaces the book. lastUpdateId only grows, so a frame at or below the last one is stale
diff, documented: drop u <= snapshot.lastUpdateId, the first applied event has U <= lastUpdateId + 1 <= u, then U = previous u + 1
```

The ids are one exchange wide sequence shared by every symbol, the diff `u`, the partial depth `lastUpdateId`, the `bookTicker` `u` and the REST `lastUpdateId`.
Per symbol, each diff frame's `U` equalled the previous frame's `u` plus one on every frame of every run, 0 gaps.
`lastUpdateId` on the partial depth stream never went backwards, and no two consecutive frames repeated it.

The documented recipe was run for five symbols against a REST snapshot of 200 levels.

| symbol | first applied diff straddled `lastUpdateId + 1` | diffs applied | `depth20` frames at an id the rebuilt book also reached | of those, identical over 20 levels a side |
|---|---|---:|---:|---:|
| `BTCPHP` | yes | 128 | 24 | 24 |
| `USDTPHP` | no, the first `U` was 867 past it, and 38 past it in the first book run at 03:19 UTC | 29 | 12 | 12 |
| `ETHPHP` | yes | 131 | 30 | 30 |
| `BTCUSDT` | yes | 54 | 26 | 26 |
| `LATUSDT` | yes | 56 | 30 | 30 |

The data is from the book run at 03:22 UTC.
The second pass at 03:35 UTC repeated it with every first diff straddling, `USDTPHP` included, and with 22, 18, 20, 29 and 25 matching `depth20` frames, all identical.
The REST book read at the end equalled the rebuilt book at the same id for `BTCPHP`, `ETHPHP` and `BTCUSDT` in the first run and for `BTCPHP`, `BTCUSDT` and `LATUSDT` in the second, and for the other symbols no rebuilt state existed at the REST id.
So the partial depth stream is exactly the top 20 of the diff stream's book, and it can stand alone.
The `USDTPHP` straddle check failed in 2 of 3 runs on a book that was then rebuilt correctly, so a strict diff feed would resync a healthy symbol.

### Checksum

None documented and none on the wire.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| partial depth | best first, descending, on every frame of every run | best first, ascending, on every frame |
| diff | descending on every frame | ascending on every frame |
| REST `depth` | descending at every limit | ascending |

### Level window

`depth20` frames held 20 levels a side on the busy symbols.
`LATUSDT` frames held 17 to 20 bids and 20 asks, which is the whole book when it is that thin.
`depth200` held 200 a side on `BTCPHP`.

### Size unit

Base asset quantity, for example `"0.3336678"` BTC at `5419095.8` PHP.
CCXT reports no `contractSize` for spot, and the connector's fallback of 1 is correct, see [`rest.md`](./rest.md) section 2.

### Push cadence

| stream, run at 03:22 UTC | minimum interval | median interval | longest silence | median lag of arrival after `E` |
|---|---:|---:|---:|---:|
| diff `@100ms`, `BTCPHP` | 198 ms | 411 ms | 830 ms | 66 ms |
| diff `@100ms`, `USDTPHP` | 190 ms | 210 ms | 8.2 s | 68 ms |
| diff `@100ms`, `LATUSDT` | 186 ms | 209 ms | 12.9 s | 66 ms |
| `depth20@100ms`, `BTCPHP` | 198 ms | 930 ms | 7.1 s | 66 ms |
| `depth20@100ms`, `USDTPHP` | 198 ms | 3.0 s | 8.3 s | 63 ms |
| `depth20@100ms`, `LATUSDT` | 0 ms | 10 ms | 12.9 s | 65 ms |
| `depth200`, `BTCPHP` | 1 ms | 536 ms | | |

The second pass at 03:35 UTC gave the same shape: diff minimum intervals of 139 to 195 ms with a tenth percentile of 199 to 202 ms, `depth20` medians of 1.2 to 1.4 s on the four busy symbols, and `LATUSDT` at a median of 218 ms without bursts.
The diff stream is paced at about 200 ms, not the 100 ms its name gives.
The partial depth stream pushes only when the top 20 changes, and on `LATUSDT` it pushed bursts of frames 0 to 10 ms apart, 133 frames against 63 diff frames in 60 s.
The lag includes this host's distance from the server, and the server clock ran about 5 ms ahead, see [`rest.md`](./rest.md) section 7.

### One-sided and empty books

No `trading` symbol had a one-sided or empty book in the `bookTicker` reply, see [`rest.md`](./rest.md) section 2, and none was seen on the socket.
What a partial depth frame sends for an empty side is Not verified.

### Idle repeats

None on the depth streams.
A quiet book sends nothing, and `LATUSDT` went 12.9 s without a frame.
`bookTicker` repeated its last prices and sizes with a new `u` on 2 to 8 of 10 to 33 frames per busy symbol.

### Unknown, closed and malformed requests

| request | reply | then |
|---|---|---|
| `SUBSCRIBE` `nopephp@depth20@100ms` | `{"id":"11","result":null}` | nothing, and it stays in `LIST_SUBSCRIPTIONS` |
| `SUBSCRIBE` `ethfiphp@depth20@100ms`, a `break` symbol | `{"id":"12","result":null}` | nothing |
| `SUBSCRIBE` `ETHPHP@depth20@100ms`, upper case | `{"id":"13","result":null}` | nothing |
| `SUBSCRIBE` `btcphp@depth30` | `{"id":"14","result":null}` | nothing |
| `SUBSCRIBE` `btcphp@nope` | `{"id":"15","result":null}` | nothing |
| `SUBSCRIBE` `btcphp@depth20@100ms` twice | `{"id":"17","result":null}` | listed once |
| method `FOO` | `{"id": 18, "error": {"code": 4, "msg": "incorrect request: unknown method"}}` | socket stays open |
| text `hello` | `{"id": null, "error": {"code": 7, "msg": "JSON incorrect"}}`, where S1 documents code 3 "Invalid JSON" | socket stays open |
| `LIST_SUBSCRIPTIONS` | `{"id":"19","result":[{"first":"nopephp@depth20@100ms","second":false}, …]}` | |

The data is from the errors run at 03:24 UTC.
Because a stream that will never deliver is acknowledged as a success, the feed has to notice a symbol with no first frame on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server ping every 5 minutes, and the client must send within 5 minutes. `{"ping": <ms>}` answers `{"pong": <ms>}`, S1 | a protocol ping every 30 s on every socket, payload the server time in ms. `{"pong": …}` in 103 to 179 ms |
| silence the server tolerates | 5 minutes, S1 | in each of two runs four sockets held 100 s: one with no subscription and no client frame, one subscribed to a quiet symbol that sent nothing, one pinging every 30 s, and one that also left the protocol pings unanswered. None closed |
| forced disconnect | Not publicly specified | none in 100 s |
| maintenance notice | Not publicly specified | none |
| compression | Not publicly specified | text JSON frames. The server negotiates permessage-deflate when offered, and answers without it when the client does not offer it |
| handshake | | 418 to 602 ms to open over all runs |
| subscription limits | 1,024 streams per connection | 71 per connection used, no refusal |
| throughput | | all 71 `trading` symbols on one socket each, in two runs: diff 70 and 80 frames per second, 32 and 38 KB per second, peaks of 139 and 156 per second, and `depth20` 135 and 83 frames per second, 109 and 75 KB per second, with `JSON.parse` at 17 and 21 µs per frame |

A socket was held 100 s at most, below the 120 s cap of this survey, so the documented 5 minute limit was not tested.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Level arrays are cut to three entries.

Subscribe, and its acknowledgement.

```json
{"method": "SUBSCRIBE", "params": ["btcphp@depth20@100ms", "usdtphp@depth20@100ms", "ethphp@depth20@100ms", "btcusdt@depth20@100ms", "latusdt@depth20@100ms"], "id": 2}
```

```json
{"id":"2","result":null}
```

Partial depth, the first frame after the subscribe.

```json
{"s":"BTCPHP","e":"depth","E":1790133744828,"lastUpdateId":208878232814,"bids":[["5419095.8","0.3336678"],["5419095.7","0.0056265"],["5418777.3","0.0060253"]],"asks":[["5420000.0","0.0015491"],["5422149.2","0.0043474"],["5425000.0","0.0015491"]]}
```

Diff, with a deletion on each side.

```json
{"e":"depthUpdate","E":1790133747294,"s":"BTCUSDT","U":208878241819,"u":208878242929,"b":[["86587.79","0.2881642"],["86069.50","0.0000000"]],"a":[["86761.10","0.2876418"],["86774.88","0.0000000"]]}
```

Best bid and ask.

```json
{"u":208878222833,"s":"BTCPHP","b":"5419095.8","B":"0.3336678","a":"5420000","A":"0.0015491"}
```

Keepalive, the application ping and its answer.

```json
{"ping":1790133477572}
```

```json
{"pong":1790133477572}
```

Errors.

```json
{"id": 18, "error": {"code": 4, "msg": "incorrect request: unknown method"}}
```

```json
{"id": null, "error": {"code": 7, "msg": "JSON incorrect"}}
```

## 7. Private channels

Named for a future execution stage, from S3, not probed.
A `listenKey` comes from `POST /openapi/v1/userDataStream`, lasts 60 minutes unless renewed with `PUT`, and opens `wss://wsapi.pro.coins.ph/openapi/ws/<listenKey>`.
The events are `outboundAccountPosition`, `balanceUpdate` and `executionReport`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
The engine takes perpetuals only today, so this shape matters only if a spot leg is ever added.

| item | recommendation | reason |
|---|---|---|
| URL plan | one URL, `wss://wsapi.pro.coins.ph/openapi/quote/stream` | one socket family |
| channel | `<lower case rawMarketId>@depth20@100ms` | a snapshot on subscribe, a whole top 20 in every frame, and it equalled the diff book at every matching id |
| markets per connection | all 71 `trading` symbols on one socket | up to 135 frames per second held with no refusal, and the cap is 1,024 streams |
| subscribe frames | one frame per socket, `{"method": "SUBSCRIBE", "params": ["btcphp@depth20@100ms", …], "id": 1}` | 71 streams were acknowledged by one frame |
| keepalive | `{"ping": <ms>}` every 20 s | the server's protocol ping comes only every 30 s, and a quiet symbol went 12.9 s without a frame |
| `maxSilenceMs` | 45,000 | two missed pongs, and `VenueFeed` counts server pings as traffic at `server/src/feeds/book/VenueFeed.ts` line 97 |
| routing | `frame.s`, which equals `rawMarketId`, and `frame.e === 'depth'` | frames are not wrapped |
| book | `resetBook` on every frame | each frame is the whole top 20 |
| stale frame | drop a frame whose `lastUpdateId` is not above the last one kept | never seen, but cheap |
| resync | only on socket loss | no sequence to break |
| unserved stream | log a symbol with no frame 5 s after the acknowledgement | unknown, closed and upper case streams are acknowledged and silent |
| receive time | stamp on arrival, never from `E` | the first frame's `E` was up to 5.6 s old |
| deflate | keep `perMessageDeflate: false` | text frames arrive uncompressed when it is not offered |
| catalog filter | `status === 'trading'` from `exchangeInfo` | `break` symbols never deliver |

The diff stream with the REST recipe is not recommended.
A resync costs one REST call per symbol against a budget of 120 per minute, and the straddle check failed on `USDTPHP` in both attempts.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Coins.ph API documentation, Web-Socket-Streams, change log to 2023-07-15 | https://docs.coins.ph/web-socket-streams/ | 2026-09-22 | Coins.ph | URLs, stream names and speeds, subscribe and error frames, ping, limits, sections 1 to 5 |
| S2 | Coins.ph API documentation, Rest-Api, filter `PERCENT_PRICE_INDEX`, and Web-Socket-Streams, "How to manage a local order book correctly" | https://docs.coins.ph/rest-api/ and https://docs.coins.ph/web-socket-streams/ | 2026-09-22 | Coins.ph | index push not yet available, the diff recipe, sections 2 and 4 |
| S3 | Coins.ph API documentation, User-Data-Stream | https://docs.coins.ph/user-data-stream/ | 2026-09-22 | Coins.ph | private endpoint, `listenKey`, event names, 24 hour connections, sections 3 and 7 |
| P1 | `ws-probe.mjs book`, 03:22 UTC on 2026-09-23, an earlier run at 03:19 UTC whose book comparison had a key bug but whose other readings stand, and the second pass at 03:35 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinsph/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs errors`, 03:24 UTC, and the second pass at 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinsph/ws-probe.mjs) | 2026-09-22 | this host | sections 3 and 4 |
| P3 | `ws-probe.mjs batch`, 03:24 UTC, and the second pass at 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinsph/ws-probe.mjs) | 2026-09-22 | this host | sections 3 to 5 |
| P4 | `ws-probe.mjs silence`, 03:25 UTC, and `deflate`, 03:19 UTC, and the second pass at 03:37 and 03:34 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinsph/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
| P5 | an exploration socket at 03:17 UTC that subscribed five `btcphp` depth and ticker streams on one socket for 12 s, not kept as a script | | 2026-09-22 | this host | ambiguous routing of two depth streams, section 3 |
