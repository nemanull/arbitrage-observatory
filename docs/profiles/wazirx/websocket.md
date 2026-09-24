# WazirX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:39 to 04:55 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public futures WebSocket of WazirX, which has no CCXT class, for both perpetual families on it.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/wazirx/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation is the futures part of `https://docs.wazirx.com/`, S1, which this host read directly.
Sockets were held about eleven minutes in total over the two passes.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| INR-quoted and USDT-quoted perpetuals | `wss://fstreamx.wazirx.com/stream`, S1 | open in 1,062 to 1,230 ms over six timed opens, and both families deliver on one socket |
| spot, named only | `wss://stream.wazirx.com/stream`, S1 | not probed |

One socket carries both families.
`btcusdt@depth` and `btcinr@depth` delivered side by side on the same connection in both book runs.
`fstreamx.wazirx.com` and `stream.wazirx.com` resolved to the same two addresses, `15.207.6.206` and `15.207.62.127`, and `stream.wazirx.com` is a CNAME of an AWS load balancer in `ap-south-1`, Mumbai, see [`rest.md`](./rest.md) section 1.
Every result here is from the Canadian VPN exit, and no socket was refused.

## 2. Channel matrix for public market data

| stream | documented | probed on 2026-09-23 |
|---|---|---|
| `<symbol>@depth` | deltas, "update speed ~1000ms", S1 | a full 20 level book in every frame, about every 510 ms, served for 185 of 450 contracts |
| `<symbol>@depth<5,10,20>@100ms` | spot docs only | `btcusdt@depth20@100ms`, `@depth10@100ms` and `@depth5@100ms` acknowledged with `"streams": null` and silent |
| `<symbol>@depth20`, `@depth@100ms`, `@depth@500ms` | not documented | acknowledged with `"streams": null` and silent |
| `<symbol>@aggTrade` | trade stream, S1 | 22 and 23 frames in about 22 s on BTC, median gap 899 and 981 ms |
| `<symbol>@kline_1m` | "Only the 1m interval is ingested today", S1 | median gap 497 and 508 ms |
| `!markPrice@arr` | mark, index, funding rate and next funding time for all symbols, S1 | 450 rows in every frame, median gap 1,015 and 1,017 ms |
| `!ticker@arr` | 24 h ticker for all symbols, S1 | 450 rows in every frame, median gap 1,015 and 1,018 ms |
| `<symbol>@bookTicker`, `<symbol>@trades`, `<symbol>@markPrice` | not documented for futures | left out of the acknowledgement and silent |

The stream names come from S1, and the undocumented spellings are those of Binance USD-M and of the WazirX spot socket.
No best bid and ask stream exists.
The mark stream carries every `AnchorRow` field except the funding interval, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for all futures streams, S1 | INR and USDT contracts on one socket, section 1 |
| subscribe frame shape | `{ "event": "subscribe", "streams": ["btcinr@aggTrade", "!ticker@arr"] }`, S1 | 450 streams in one frame got one acknowledgement listing the 185 it serves |
| unknown symbol expectation | an error table with codes 400, 401, 429 and 500, S1 | `nopeusdt@depth`, `BTCUSDT@depth` and `btcusdt@nope` are acknowledged as `{"data":{"streams":null},"event":"subscribed","id":0}` with no error and no frame |
| chunk unit and budget | "A single connection can listen to a maximum of 1024 streams." and 5 incoming messages per second, S1 | 450 streams in one frame, and nine frames of 50 streams 1.5 s apart, both accepted |
| keepalive mechanism | `{ "event": "ping" }` answered by `{ "data": { "timeout_duration": 1800 }, "event": "pong", "id": 0 }`, S1 | the server sends a protocol ping about 54 s after the open, and a client that does not answer it is closed 6 s later with 1006. The application pong matches the documentation |
| connection lifetime and maintenance notice | "A single connection is valid for 30 minutes.", S1 | a `connected` frame with `timeout_duration` 1800 opens every socket. The 30 minute cut was not reached, since no socket was held past 123 s |
| handshake and operation rate limits | 5 incoming messages per second, "A connection that goes beyond the limit will be disconnected", S1 | no refusal at one control frame every 1.1 to 1.5 s. Opens took 1,062 to 1,230 ms |
| public market data authentication | none, S1 | none |
| message parse and routing | market data wrapped as `{"data": …, "stream": …}`, S1 | control frames carry `event`, market frames carry `stream`, and `data.s` is the lowercase symbol |
| subscribe acknowledgement shape | `{ "data": { "streams": [...] }, "event": "subscribed", "id": 0 }`, S1 | the list holds only the streams the server will serve, `null` when none. A client `id` is echoed, and `-1` came back as `18446744073709551615` |
| symbol identifier format | "WebSocket stream names use lowercase symbols", S1 | `btcusdt`, the lowercase REST `symbol`. The uppercase spelling is not served |
| number representation | prices and sizes as strings, S1 | strings, with trailing zeros cut on prices, `"87111.2"`, `"8328196"` |
| timestamp representation | `E` event time and `T` transaction time in ms, S1 | `E` is 1 to 5 ms after `T` on busy books, median 82 ms on a quiet one. Frames arrive a median 395 to 457 ms after `E`, with the clock 3.5 ms off |
| size unit | not stated | base coins: BTC for `btcusdt` and `btcinr`, the same numbers Binance shows for BTCUSDT, section 4 |
| sequence semantics | none documented | no update id in any frame. `E` rose on every frame except one `btcinr` frame in the first run |
| idle repeat behaviour | depth "~1000ms" | a quiet contract went up to 8.4 s between frames, and no stream ever sent the same 40 levels twice in a row |

## 4. The book channel in detail

`<symbol>@depth` is the only book stream the futures socket serves, and every row below is about it.

### Snapshot on subscribe

There is no separate snapshot, because every frame is a snapshot.
Every frame of every stream carried exactly 20 bids and 20 asks, 146 or 147 frames per stream in each run of about 72 s on BTCUSDT, ETHUSDT and BTCINR, and 34 frames on the quiet ZRXUSDT.
No level ever had a size of `"0"`.
The first frame came 287 to 625 ms after the subscribe frame in the first run, 489 to 494 ms in the second, and 1,199 ms on ZRXUSDT.

### Delta semantics

The documentation calls the frame "Bids to be updated" and says `qty "0"` removes the level, S1.
The wire contradicts it.
A book built by applying each frame as a delta grew to 80 to 212 levels per side, all but 20 of them stale, and matched 0 of the top 20 REST bids.
The last frame alone matched the REST book taken 214 to 696 ms later on all 20 bids and all 20 asks in three of four compares, and on 18 bids and 16 asks in the fourth, `ws-probe.mjs book` second run.
So a feed replaces the whole book on every frame.

### Sequence and gap rule

```text
every frame   resetBook with its 20 bids and 20 asks
no id         nothing to chain, so there is no gap to detect
```

`E` and `T` are the only stamps.
A lost frame cannot be seen, and it costs nothing, since the next frame replaces the book.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `@depth` | best first, descending, on every frame of both runs | best first, ascending, on every frame |
| REST `/fapi/v1/depth` | descending on 16 of 16 reads over two runs | ascending on 16 of 16 |

### The book is Binance's book, re-gridded and widened

| check | result | run |
|---|---|---|
| prices | one tick apart all the way down, 9 or 10 INR on BTCINR, which is one USDT tick times the multiplier, while Binance's book at the same instant skips ticks | REST `book` P3, WS frames |
| touch against Binance | the bid sits a fixed number of ticks below Binance's bid and the ask the same number above Binance's ask: 2 ticks or 2.3 ppm per side on BTCUSDT in 5 of 5 reads, 10 ticks or 36 ppm on ETHUSDT in 4 of 5, 1 tick or 538 ppm on HMSTRUSDT, and 5.7 ppm on BTCINR | REST `book` P3 second run |
| sizes | Binance's sizes by rank, not by price: 13 to 19 of the 20 bid sizes equal Binance's size at the same rank on BTCUSDT, and 0 to 3 at the same price | REST `book` P3 |
| event time | `E` never equalled the `E` of a Binance `@depth`, `@depth@500ms` or `@depth@100ms` event, 0 of 146 | `ws-probe.mjs book` second run |
| INR twin | `btcinr@depth` carries the `btcusdt@depth` sizes with prices times about 95.55, rounded to 1 INR, and 111 of 146 `btcinr` frames had the `E` of a `btcusdt` frame | `ws-probe.mjs book` second run |

So the WazirX book is Binance's top 20 by rank, laid on consecutive ticks from a touch pushed outward, and refreshed about twice a second.
Whether an order that takes this book fills at these prices is not observable without trading.
A cross between WazirX and a third venue is a Binance cross less the widening, and it can never be wider than Binance's own cross with that venue while WazirX is fresh.

### Size unit against CCXT `contractSize`

There is no CCXT market.
Sizes are base coins: the BTCUSDT and BTCINR frames of one instant carry the same sizes, `"13.367"` BTC at the bid and `"4.071"` BTC at the ask, and ETHUSDT's `"158.886"` is ETH, the numbers Binance shows at the same rank.
A hand built catalog therefore sets `contractSize` 1.
Fourteen contracts, eight INR and six USDT such as `1000PEPEUSDT`, carry a multiplier in the base name, as on Binance, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

None was seen, and every frame had 20 levels a side.
What the stream sends for an empty side is Not verified.

### Idle repeats

The quiet ZRXUSDT stream sent 34 frames in about 72 s with a median gap of 1,041 ms and a longest gap of 8,387 ms.
No stream sent the same 40 levels in two consecutive frames, so a frame means something changed.
BTCUSDT and ETHUSDT never went more than 1,040 ms without a frame.

### Unknown, closed and unserved symbols

| request | reply | then |
|---|---|---|
| `nopeusdt@depth` | `{"data":{"streams":null},"event":"subscribed","id":0}` | nothing |
| `BTCUSDT@depth` | same | nothing |
| `btcusdt@nope` | same | nothing |
| `ethusdt@depth` twice | acknowledged twice | one frame per push, 20 and 21 distinct `E` in 20 and 21 frames |
| `{"event":"nope"}` | ``{"data":{"code":400,"message":"Invalid request: unknown variant nope, expected one of `subscribe`, `unsubscribe`, `ping`, `list_subscriptions`"},"event":"error","id":0}`` | socket stays open |
| `streams` as a string | `{"data":{"code":400,"message":"Invalid request: streams must be an array"},"event":"error","id":0}` | socket stays open |
| text that is not JSON | `{"data":{"code":400,"message":"Invalid request: could not parse message"},"event":"error"}` | socket stays open |
| `{"event":"list_subscriptions"}` | `{"data":{"streams":["ethusdt@depth"]},"event":"list_subscriptions","id":0}` | |
| the 265 contracts outside the served set | left out of the acknowledgement | nothing |

The socket serves 185 of the 450 contracts in the catalog, the same 185 in both `coverage` runs: 91 of 229 INR contracts and 94 of 221 USDT contracts.
It leaves out 59 of the 61 tokenized stock, metal and energy contracts, and crypto contracts such as `APTUSDT`, `TAOUSDT`, `1000PEPEUSDT` and `1000PEPEINR`.
The REST depth call serves the left out contracts, `HMSTRUSDT` among them, see [`rest.md`](./rest.md) section 5.
The subscription itself says which contracts are served, so a feed can read the acknowledgement.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | `{"event":"ping"}`, pong with `timeout_duration` 1800 | a server protocol ping with an empty payload at 55.1 s after the start of the open on all four sockets of the second run, and two pings in 120 s on each socket of the first run. The application pong came back as documented |
| silence the server tolerates | Not publicly specified | a socket that sends nothing and subscribes nothing stayed open 120 s and 100 s while the `ws` library answered the protocol pings. A socket with `autoPong` off was closed at 61.1 s with 1006 and no reason, 6 s after the unanswered ping |
| forced disconnect | "A single connection is valid for 30 minutes." | not reached |
| maintenance notice | none documented | none seen |
| compression | Not publicly specified | a client that offered permessage-deflate got no `sec-websocket-extensions` header back, twice. Frames are plain JSON text |
| handshake | | 1,062 to 1,230 ms to open from this host, over six timed opens |
| subscription limits | 1,024 streams per connection, 5 incoming messages per second | 450 streams in one frame accepted, 185 served |
| throughput | | every served depth stream on one socket: median 321 frames per second over 60 s and 306 over 30 s, peaks 495 and 473, about 857 bytes per frame, 272 and 256 KB per second, 29.7 and 30.8 µs `JSON.parse` per frame |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Level arrays are cut to three levels.

On open, before any subscribe.

```json
{"data":{"timeout_duration":1800},"event":"connected"}
```

Subscribe and acknowledgement, which lists what the server will serve.

```json
{"event": "subscribe", "streams": ["btcusdt@depth", "ethusdt@depth", "btcinr@depth", "zrxusdt@depth"]}
```

```json
{"data":{"streams":["btcusdt@depth","ethusdt@depth","btcinr@depth","zrxusdt@depth"]},"event":"subscribed","id":0}
```

An unserved or unknown stream.

```json
{"data":{"streams":null},"event":"subscribed","id":0}
```

A depth frame, which is a whole 20 level book, and its INR twin from the same instant.

```json
{"data":{"E":1790138977734,"T":1790138977733,"a":[["87160.3","4.071"],["87160.4","0.013"],["87160.5","0.008"]],"b":[["87159.8","13.367"],["87159.7","0.007"],["87159.6","0.495"]],"e":"depthUpdate","s":"btcusdt"},"stream":"btcusdt@depth"}
```

```json
{"data":{"E":1790138977734,"T":1790138977733,"a":[["8328196","4.071"],["8328205","0.013"],["8328215","0.008"]],"b":[["8328091","13.367"],["8328081","0.007"],["8328072","0.495"]],"e":"depthUpdate","s":"btcinr"},"stream":"btcinr@depth"}
```

Keepalive.

```json
{"event": "ping"}
```

```json
{"data":{"timeout_duration":1800},"event":"pong","id":0}
```

Error.

```json
{"data":{"code":400,"message":"Invalid request: streams must be an array"},"event":"error","id":0}
```

One row of `!markPrice@arr`, where `T` is the next funding time.

```json
{"E":1790139066000,"T":1790150400000,"e":"markPriceUpdate","i":"0.7115","p":"0.7109","r":"0.000045","s":"ethfiusdt"}
```

One row of `!ticker@arr`, whose `F`, `L` and `n` are trade ids and a trade count at Binance's scale.

```json
{"C":1790139065565,"E":1790139065565,"F":484747198,"L":485286243,"O":1790052660000,"P":"1.528","Q":"33.1","c":"0.7109","e":"24hrTicker","h":"0.7287","l":"0.6755","n":539009,"o":"0.7002","p":"0.0107","q":"38169376.4661","s":"ethfiusdt","v":"54485537.3","w":"0.7006"}
```

Trade.

```json
{"data":{"E":1790139065691,"T":1790139065641,"e":"aggTrade","m":false,"p":"87120.3","q":"0.040","s":"btcusdt"},"stream":"btcusdt@aggTrade"}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same URL and an `auth_key` from the signed `POST /sapi/v1/create_auth_token`, valid 30 minutes.

- `orderUpdate`, `outboundAccountPosition`, `positionUpdate`, `marginCall`, `liquidationAlert` and `ownTrade`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
The recommendation is not to build a WazirX feed.

| item | finding | consequence |
|---|---|---|
| price source | the book is Binance's book widened by a fixed number of ticks, section 4 | WazirX adds no price the engine does not already read from Binance, and its quote is always outside Binance's |
| freshness | frames arrive a median 395 to 457 ms after their own `E`, against 131 to 142 ms for the REST book, and every book is about 510 ms apart | any cross WazirX shows against a third venue is a Binance quote about 400 ms old, which the engine already reads fresher from Binance itself |
| coverage | 185 of 450 contracts on the socket | the other 265 need one REST call each, and REST allows 60 calls per minute per endpoint on paper and refused this host sooner, see [`rest.md`](./rest.md) section 6 |
| quote | 229 contracts are quoted in INR, outside every quote family in `server/src/engine/cluster/quoteFamily.ts` lines 4 and 5 | the INR books would never cluster, and they are the USDT books times a rate anyway |

If a feed is built anyway, this is its shape.

| item | value | reason |
|---|---|---|
| URL plan | one plan, `wss://fstreamx.wazirx.com/stream`, for both families | one socket serves both |
| markets per connection | every served contract, 185 on 2026-09-23 | 1,024 streams allowed, and 185 streams ran at 321 frames per second |
| subscribe frames | one frame, `{"event": "subscribe", "streams": ["btcusdt@depth", …]}` | a 450 stream frame was accepted as one |
| unserved markets | read the acknowledgement and log each requested stream it leaves out | the server acknowledges without the stream and never errors |
| keepalive | none needed beyond answering protocol pings, which `ws` does. An application ping every 30 s is harmless | the server pings about once a minute and closes a client that does not pong |
| `maxSilenceMs` | 20,000 | a quiet contract went 8.4 s without a frame, and the engine counts a server ping as traffic at `server/src/feeds/book/VenueFeed.ts` line 97 |
| routing | `stream.slice(0, -'@depth'.length).toUpperCase()` gives the REST symbol | stream names are the lowercase symbol |
| book | `resetBook` on every frame with its 20 bids and 20 asks, then `publish` | every frame is a whole book, the documentation notwithstanding |
| resync | none on data, since there is no sequence | a lost frame is replaced by the next |
| receive time | stamp on arrival | arrival trails `E` by about 400 ms |
| deflate | keep `perMessageDeflate: false`, `server/src/feeds/book/VenueFeed.ts` line 81 | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | WazirX API documentation, sections "Futures Streams" and "Websocket Market Streams" | https://docs.wazirx.com/ | 2026-09-23 | Zanmai Labs Private Limited, India | URLs, stream names, limits, ping and pong, error table, private streams, sections 1 to 7 |
| P1 | `ws-probe.mjs book`, runs at 04:39 and 04:49 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/wazirx/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 1 to 4, 6 |
| P2 | `ws-probe.mjs forms`, `errors` and `coverage`, runs at 04:41 to 04:44 UTC and 04:51 to 04:52 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/wazirx/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 2 to 4 |
| P3 | `rest-probe.mjs book`, runs at 04:37 and 04:55 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/wazirx/rest-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | the book against Binance, section 4 |
| P4 | `ws-probe.mjs silence`, runs at 04:45 and 04:52 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/wazirx/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | section 5 |
| P5 | `ws-probe.mjs batch` and `deflate`, runs at 04:39 to 04:43 UTC and 04:54 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/wazirx/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 3 and 5 |
