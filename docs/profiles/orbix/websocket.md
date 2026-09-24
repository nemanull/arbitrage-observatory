# Orbix WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:32 to 05:01 UTC), from the development host near Seattle, through the Surfshark WireGuard tunnel whose exit geolocated to Canada (Cloudflare trace `loc=CA`, `colo=YVR`).

This profile covers the public spot WebSocket of Orbix, which has no CCXT class and no perpetuals, see [`fees.md`](./fees.md) sections 3 and 8.
The protocol is a Binance style clone: stream names like `btc_thb@depth20@100ms`, `depthUpdate` events with `U` and `u`, and a `SUBSCRIBE` method.
It departs from Binance in ways a feed has to handle, and each is captured by [`ws-probe.mjs`](../../../scripts/probes/venues/orbix/ws-probe.mjs) and quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Access results are as seen from the Canadian VPN exit, and nothing was refused.

## 1. Endpoints

| path | documented | probed |
|---|---|---|
| `wss://www.orbixtrade.com/ws/<stream>` | raw stream, "Raw streams can be accessed at /ws/", S1 | open in 260 to 990 ms over all runs, delivers the one stream the path names |
| `wss://www.orbixtrade.com/stream?streams=<a>/<b>` | combined stream, "Combined streams can be accessed at /stream?streams=/", S1 | HTTP 307 to `/en/stream?streams=…`, the marketing site, so the documented combined path does not exist, P6 |
| `wss://www.orbixtrade.com/ws/stream?streams=<a>/<b>` | the path the web app opens for `!miniTicker@arr@3000ms`, S4 | opens, but the `streams` query is ignored: four `@depth@100ms` streams sent 0 frames in 60 s, P5 first attempt at 04:34 UTC |
| `wss://www.orbixtrade.com/ws/stream` plus `SUBSCRIBE` | the web app subscribes `aggTrade` this way, S4 | works, and it is the only way found to carry several pairs on one socket, P5, P6 |
| `wss://www.orbixtrade.com/ws/` | | HTTP 404, P6 |
| `wss://www.orbixtrade.com/ws/broker/<stream>` | the web app's brokerage socket, S4 | HTTP 404, P6 |

The segment after `/ws/` is read as a stream name.
On `/ws/stream`, `LIST_SUBSCRIPTIONS` answered `["btc_thb@depth20@100ms","eth_thb@depth@100ms","stream"]`, so the path itself was subscribed as a stream called `stream`, P6.
There is one product family, THB spot, so there is no family split.
`www.orbixtrade.com` resolves to Akamai edge addresses, and every reply carries `x-amz-cf-pop: KUL62-P1`, a CloudFront point of presence in Kuala Lumpur, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| stream | documented | probed on 2026-09-23 UTC, 12 s per stream in P6 |
|---|---|---|
| `<pair>@depth5@100ms`, `@depth10@100ms`, `@depth20@100ms` | partial book, "Update Speed: 100m, 1000ms", levels not listed, S1 | 112 to 117 frames per stream over three runs, 5, 10 and 20 levels per side |
| `<pair>@depth50@100ms`, `@depth100@100ms` | not listed | open, 0 frames |
| `<pair>@depth20@1000ms` | documented speed | open, 0 frames in 12 s, and 0 frames in 60 s in P7 silence |
| `<pair>@depth20` | documented form without speed | 12 frames, one a second |
| `<pair>@depth@100ms` | diff depth, S1 | on change only, the multiplexed alternative of section 8 |
| `<pair>@depth` | documented form without speed | 0, 3 and 6 frames in three runs |
| `<pair>@depth@1000ms`, `<pair>@depth@0ms` | the first is documented | open, 0 frames |
| `<pair>@bookTicker` | not documented | 0 to 2 frames in three runs, `{"u":0,"s":"btc_thb","b":…,"B":…,"a":…,"A":…}` |
| `<pair>@aggTrade`, `<pair>@kline_<interval>`, `!miniTicker@arr` | documented, S1 | not probed |
| `!ticker@arr`, `!tradingSign` | used by the web app, S4 | not probed |

No mark, index or funding channel exists, since Orbix lists no derivative.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one base URL, raw and combined paths, S1 | one base URL. The combined path is `/ws/stream` with `SUBSCRIBE`, and the documented `/stream?streams=` redirects to the website, section 1 |
| subscribe frame shape | the stream is in the URL, S1. No method frame is documented | URL for a single stream. On `/ws/stream`, `{"method":"SUBSCRIBE","params":["btc_thb@depth20@100ms","eth_thb@depth@100ms"],"id":1}` works, as the web app sends it |
| unknown symbol expectation | Not publicly specified | `nope_thb@depth20@100ms`, `BTC_THB@depth20@100ms` and the halted `ltc_thb@depth20@100ms` all open and send nothing. `SUBSCRIBE` of `nope_thb@depth20@100ms` is acked `{"id":3,"result":null,"method":"SUBSCRIBE"}` |
| chunk unit and budget | Not publicly specified | the server reads at most about 2 KB per client frame: a `SUBSCRIBE` of 88 streams, 2,030 bytes, was acked, and one of 96 streams, 2,211 bytes, closed the socket with code 1009. 104 streams on one socket in two frames all acked, P7 |
| keepalive mechanism | Not publicly specified | the server sends a protocol ping about 60 s after the open, at 60,269 to 60,773 ms over all sockets, and again at 120,335 and 120,780 ms. A client protocol ping gets a pong |
| connection lifetime and maintenance notice | Not publicly specified | a socket that received nothing and never wrote was closed with 1006 and no close frame at 60,345 to 60,789 ms, five sockets. A client ping every 20 s kept a socket open for the full 120 s, P5 first attempt and P7 |
| handshake and operation rate limits | REST only: 160 GET, 10 POST and 5 other requests per second "for Market Maker customers", S1 | no refusal with 18 sockets opened at once in P6 |
| public market data authentication | none | none |
| message parse and routing | diff events carry `s`, S1. Combined events are documented as wrapped in `{"stream","data"}` | frames are never wrapped, even on `/ws/stream`. Diff frames route on `s`. Partial depth frames carry only `lastUpdateId`, `bids` and `asks`, so on a socket with two pairs they cannot be told apart |
| subscribe acknowledgement shape | not documented | `{"id":1,"result":null,"method":"SUBSCRIBE"}` with a trailing newline, and the same shape for `UNSUBSCRIBE` and a duplicate `SUBSCRIBE` |
| symbol identifier format | `btc_thb`, lower case, S1 | lower case with underscore, identical to the REST `exchangeInfo` `symbol`. The upper case stream name is silent, while REST depth accepts `BTC_THB` |
| number representation | strings, S1 | price and size are decimal strings in diff, partial and bookTicker frames. Ids and `E` are JSON integers |
| timestamp representation | `E` event time in ms, S1 | `E` in ms on diff frames, and arrival minus `E` was 99 to 156 ms, median 105 to 115 ms, with the host clock within 53 ms of `/api/v3/time`, P5. Partial frames carry no time |
| size unit | `Quantity`, unit not stated, S1 | base asset quantity, for example `"0.00011"` BTC, so a multiplier of 1 |
| sequence semantics | `U` first and `u` final update id, S1. No gap rule is written | `U` equals the previous frame's `u` for the same pair, on 1,380 of 1,380 chained diff frames over two book runs and two batch runs, never `u + 1`. The ids come from one counter shared by every pair, section 4 |
| idle repeat behaviour | not documented | the partial stream resends the full book about ten times a second whether or not it changed: 528 to 614 of 618 to 623 frames per socket repeated the previous `lastUpdateId`. The diff stream sends nothing on a quiet pair, 0 frames on `algo_thb` in 120 s |

## 4. The book channel in detail

Two channels can keep a book, and the choice between them is section 8.
`<pair>@depth20@100ms` sends a whole 20 level book on every frame.
`<pair>@depth@100ms` sends changes, and a book built from it needs a REST snapshot first.

### Snapshot on subscribe

The diff stream sends no snapshot.
Its first frame is an ordinary delta, so a feed takes a snapshot from `GET /api/v3/depth?symbol=<pair>&limit=1000`, see [`rest.md`](./rest.md) section 5.
The partial stream needs no snapshot, since every frame is one.

### Delta semantics

A diff frame is `{"e":"depthUpdate","E":…,"s":…,"U":…,"u":…,"b":[[price,size]…],"a":[[price,size]…]}`.
A size of `"0"` deletes the level.
Frames were small: no frame changed more than 3 levels across the four pairs of either book run, and no frame was empty, P5.

### Sequence and gap rule

```text
snapshot                  book = REST depth, last = lastUpdateId
first frame after it      U = lastUpdateId was seen on 4 of 4 pairs in the second run, apply, last = u
next frame, U = last      apply, last = u
next frame, U ≠ last      gap: refetch the snapshot and start again
```

`U` equalled the previous `u` on every chained frame: 76, 19, 88 and 5 frames on `btc_thb`, `usdt_thb`, `eth_thb` and `xlm_thb` in the first run, 60, 22, 58 and 8 in the second, and 605 and 439 in the two batch runs over all pairs, P5 and P7.
No frame had `U` equal to the previous `u + 1`, so the Binance spot rule would declare a gap on every frame.
The ids are not per pair.
`btc_thb` covered ids 1338471325 to 1338471889 while `usdt_thb`, `eth_thb` and `xlm_thb` covered overlapping ranges in the same minute, with 96 and 72 overlaps between pairs in the two runs, and `u - U` in one frame reached 819 on the quiet `xlm_thb`.
Each pair's chain is still contiguous by the rule above, because each frame starts where that pair's last frame ended.

The rule was tested end to end.
A book built from the REST snapshot and every diff frame was compared with the partial stream whenever the partial frame's `lastUpdateId` equalled the last applied `u`.
The top 20 bids and asks matched on 2,250 of 2,250 such comparisons in the first run and 2,271 of 2,271 in the second, P5.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| partial depth | descending on every frame of both runs | ascending on every frame |
| diff | descending on every frame that carried more than one level | ascending |
| REST depth | descending | ascending |

A feed applies diff levels by price anyway, since a frame changes at most three.

### Level window

The partial stream holds 5, 10 or 20 levels per side, and 50 and 100 are not served.
The engine keeps 20 levels, at [`Engine.ts`](../../../server/src/engine/Engine.ts) line 61, so `depth20` covers it exactly.
The diff stream is not windowed, so a book built from it holds every level of the REST snapshot, 525 bids on `btc_thb`.

### Size unit

Sizes are base asset quantities.
The `btc_thb` touch read `"0.00344"` and `"0.00011"` BTC, and the `usdt_thb` bid read `"11432.96"` USDT, in the REST book at 04:29 UTC, P2, and the socket frames carry sizes of the same form, as the `bookTicker` frame's `"B":"0.00011"` in section 6.
They only make sense as coins at prices near 2,890,000 and 33.17 THB.
There is no contract and no CCXT `contractSize`, so the engine's multiplier would be 1.

### One-sided and empty books

Most books are one sided or empty: of 104 trading pairs, 36 had both sides, 11 bids only, 12 asks only and 45 neither, in both REST runs, see [`rest.md`](./rest.md) section 2.
The partial stream keeps sending them.
In 12 s, `pyth_thb@depth20@100ms` sent 112 and 113 frames of `{"bids":[],"asks":[["1.36","45.1409"]]}`, `rsr_thb` 113 frames with an empty ask side in both runs, and `yfi_thb` 117 and 111 frames of two empty arrays, P6.
The engine's `resetBook` accepts an empty side.

### Idle repeats

The partial stream repeats.
Over one minute, 559 of 619 `btc_thb` frames, 598 of 623 `usdt_thb`, 559 of 623 `eth_thb` and 608 of 619 `xlm_thb` carried the same `lastUpdateId` as the frame before, second run of P5.
The diff stream never repeats.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `/ws/nope_thb@depth20@100ms` | opens | nothing in 12 s |
| `/ws/BTC_THB@depth20@100ms` | opens | nothing in 12 s |
| `/ws/ltc_thb@depth20@100ms`, a `BREAK` pair | opens | nothing in 12 s |
| `SUBSCRIBE` `nope_thb@depth20@100ms` | `{"id":3,"result":null,"method":"SUBSCRIBE"}` | nothing |
| `{"method":"NOPE","id":6}` | `{"id":6,"error":{"code":"invalid_parameters","message":"Invalid parameters","fields":{"method":{"code":"invalid","message":"must be a valid value"}}}}` | the socket closes with 1006 within 2 ms |
| the text `not json` | `{"id":0,"error":{"Offset":2}}` | the socket closes with 1006, 275 and 223 ms later in two runs |

A feed therefore has to notice a stream that never sends, and it must never send a frame the server rejects, since the server drops the whole socket.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | the server pings about 60 s after the open. A client that pings every 20 s gets a pong each time and stays open, P7 |
| silence the server tolerates | Not publicly specified | a socket that received no book frame and never wrote closed at 60.35 to 60.79 s with 1006, five sockets over three runs. A socket that pinged every 20 s stayed open 120 s. Whether a socket carrying a busy stream survives past 60 s with no client frame was not tested, since every such socket was closed by the probe at about 61 s |
| forced disconnect | Not publicly specified | none in 120 s on a socket that pinged |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got no `sec-websocket-extensions` header back in two runs, P6 |
| handshake | | 260 to 990 ms to open over all runs |
| subscription limits | Not publicly specified | about 2 KB per client frame, section 3. 104 streams on one socket worked |
| throughput | | every trading pair's diff stream on one socket: 621 and 453 frames in 60 s, median 10 and 7 per second, peak 25 and 15, 113 bytes per frame, 17 and 25 µs `JSON.parse` per frame, and only 14 and 12 of 104 pairs sent anything, P7. One `depth20@100ms` socket carried 662 to 965 bytes per frame at about 10 frames a second, P5 |

## 6. Captured frames

Trimmed, from the second run of P5 and P6 at 04:50 to 04:52 UTC.
Arrays marked `…` are cut.

Subscribe on `/ws/stream`, and its acknowledgement.

```json
{"method": "SUBSCRIBE", "params": ["btc_thb@depth@100ms", "usdt_thb@depth@100ms", "eth_thb@depth@100ms", "xlm_thb@depth@100ms"], "id": 1}
```

```json
{"id":1,"result":null,"method":"SUBSCRIBE"}
```

The first diff after a snapshot whose `lastUpdateId` was 1338471325, and the next one, whose `U` is the previous `u`.

```json
{"e":"depthUpdate","E":1790139017559,"s":"btc_thb","U":1338471325,"u":1338471370,"b":[["2889506.34","0"]],"a":[]}
```

```json
{"e":"depthUpdate","E":1790139017759,"s":"btc_thb","U":1338471370,"u":1338471372,"b":[["2889506.71","0.061"]],"a":[]}
```

Partial depth, first three levels per side kept, with no symbol and no time.

```json
{"lastUpdateId":1338471341,"bids":[["92391.23","0.0359"],["92341.4","1.7955"],["92326.55","9"]],"asks":[["92428.2","0.7803"],["92436.92","0.0359"],["92492.9","9"]]}
```

An empty book, which keeps arriving about ten times a second.

```json
{"lastUpdateId":1310098023,"bids":[],"asks":[]}
```

List of subscriptions, showing the path segment taken as a stream.

```json
{"id":2,"result":["btc_thb@depth20@100ms","eth_thb@depth@100ms","stream"],"method":"LIST_SUBSCRIPTIONS"}
```

Errors, each followed by the server closing the socket.

```json
{"id":6,"error":{"code":"invalid_parameters","message":"Invalid parameters","fields":{"method":{"code":"invalid","message":"must be a valid value"}}}}
```

```json
{"id":0,"error":{"Offset":2}}
```

Best bid and ask, undocumented.

```json
{"u":0,"s":"btc_thb","b":"2891410.01","B":"0.00011","a":"2898819.34","A":"0.032"}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
A listen key from `POST /api/v3/userDataStream` "will be expired after 60 minutes", and a keep-alive call on the same path extends it "for 30 minutes", S1.
The user data stream opens at `wss://www.orbixtrade.com/ws/<listenKey>`, S4.

## 8. Recommended feed shape

A recommendation for a later design, not a decision, since Orbix cannot join the engine as a perpetual leg and its THB pairs do not cluster with the USDT family, see [`fees.md`](./fees.md) section 9.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket per pair, `wss://www.orbixtrade.com/ws/<rawMarketId>@depth20@100ms` | a partial frame names no pair, so only a one pair socket can route it |
| channel | `@depth20@100ms` | every frame is a whole 20 level book, which is the engine's depth, so no snapshot call and no sequence are needed |
| markets per connection | 1 | as above, so 104 sockets for every trading pair, or 36 for the two sided books of section 4 |
| subscribe frames | none, the stream is in the URL | the URL form needs no client frame at all |
| keepalive | a protocol ping, `socket.ping()`, every 20 s | a silent socket that never wrote was closed at about 60 s, and pings every 20 s held one for 120 s |
| `maxSilenceMs` | 10,000 | frames arrive about ten times a second even on an empty book, and [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) lines 97 and 98 count pings and pongs as traffic too |
| snapshot | `resetBook` on every frame whose `lastUpdateId` differs from the last one kept, then `publish` | repeats are the norm, 528 to 614 of about 620 frames a minute |
| resync | none needed for this channel | there is no chain to break |
| unserved stream | log a socket with no frame 5 s after the open | unknown, upper case and halted pairs open and stay silent |
| never send | any frame other than a valid `SUBSCRIBE`, `UNSUBSCRIBE` or `LIST_SUBSCRIPTIONS` | an unknown method or non JSON text closes the socket |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

The multiplexed alternative is one `/ws/stream` socket with `SUBSCRIBE` frames of at most 80 `@depth@100ms` streams each, which stays under the roughly 2 KB frame limit.
It needs a REST snapshot per pair, the rule `U === last`, and a resync that refetches the snapshot.
The engine's [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) has no REST snapshot step today, and its `resync` at line 296 only terminates the socket, at line 314, for a reconnect.
It saves sockets, since only 12 to 14 of 104 pairs sent a diff in a minute.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | orbix Trade API, Postman collection, Websocket folder | https://docs.orbixtrade.com/ | 2026-09-22 | Orbix Trade, Thailand | base URL, raw and combined paths, stream names and speeds, diff and partial payloads, user data stream, sections 1 to 3 and 7 |
| S4 | Orbix web app bundle | https://www.orbixtrade.com/exchange/assets/index-DGMi0for.js | 2026-09-22 | Orbix | `/ws/stream?streams=` with `SUBSCRIBE`, `!ticker@arr`, `!tradingSign`, broker socket, user data URL, sections 1, 2 and 7 |
| P5 | `ws-probe.mjs book`, first attempt at 04:34 UTC with the `streams` query, then 04:37 and 04:50 UTC with `SUBSCRIBE` | [`ws-probe.mjs`](../../../scripts/probes/venues/orbix/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 and 3 to 6 |
| P6 | `ws-probe.mjs variants` at 04:35, 04:38, 04:51 and 05:00 UTC, and `deflate` at 04:44 and 04:55 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/orbix/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6 |
| P7 | `ws-probe.mjs batch` at 04:39, 04:40 and 04:52 UTC, and `silence` at 04:42 and 04:53 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/orbix/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 5 |
