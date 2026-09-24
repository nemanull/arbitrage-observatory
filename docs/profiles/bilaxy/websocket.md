# Bilaxy WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:43 to 05:10 UTC, from the development host near Seattle, through a Surfshark WireGuard tunnel whose exit geolocates to Canada (Cloudflare loc=CA, SEA edge).

This profile covers the one public WebSocket of Bilaxy, which has no CCXT class, on its spot market, because Bilaxy lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bilaxy/ws-probe.mjs), run from `server/`, and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation is `websocket.md` in the official repository `bilaxy-exchange/bilaxy-api-docs`, S1, which the site links as "API Documentation".
Every access result comes from the Canadian VPN exit.

## 1. Endpoints

| product | documented URL | probed |
|---|---|---|
| spot, one pair per socket | `wss://bilaxy.com/stream`, parameter `symbol`, "Specify trade pair ID.", S1 | `wss://bilaxy.com/stream?symbol=113` opens in 231 to 502 ms over all runs and pushes a depth frame each second, with a `User-Agent` header |
| the same URL without a `User-Agent` header | not documented | HTTP 403 from CloudFront, `x-cache: Error from cloudfront`, POP `SEA73-P3`, title "403 ERROR". The `ws` package sends no `User-Agent` unless told to |
| socket.io path the site opens for order updates | not documented, from the site bundle: `/socket.io/?symbol=<fid>&deep=4&token=dev&transport=websocket`, then `40/trade` and an `entrust-update` event | HTTP 502 from nginx behind CloudFront, with and without `EIO=4` |
| perpetuals, futures, options | none | none exist, see [`fees.md`](./fees.md) section 3 |

The `symbol` is the numeric `pair_id` of `GET /v1/pairs`, not the pair name: `BTC_USDT` is 113 and `ETH_USDT` is 79, see [`rest.md`](./rest.md) section 2.
One socket carries one pair and there is no subscribe message, so a feed opens one socket per market.
`bilaxy.com` resolved to four CloudFront addresses, 18.172.170.50, .52, .89 and .109, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed on 2026-09-23 |
|---|---|---|---|
| `depth` | `result.b` and `result.a`, `[price, amount, total]` | the whole book, pushed once a second | 60 frames in 60 s on every pair in all three book runs, gap p50 1,000 or 1,001 ms, min 925 ms, max 1,076 ms |
| `trade` | `result`, a list of recent trades `{ts, p, q, buy}` | on trade | 0 to 6 frames per 60 s on `BTC_USDT`, `ETH_USDT` and `CRV_ETH` over three runs, none on `DOT_USDT` and `XYO_ETH` |
| `ticker` | `result` `{ts, c, h, l, v, rf}` | with most trades | 0 to 6 frames per 60 s, equal to the `trade` count or one apart |
| best bid and ask, mark, index, funding | none | | |

All three methods arrive on the same socket without being asked for, S1.
There is no way to choose a depth, a speed or a subset of methods.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, `symbol` in the query string, S1 | one pair per socket. `symbol=113&symbol=79` served 113 only, and `symbol=113,79` was refused with HTTP 400 |
| subscribe frame shape | none, the query string selects the pair | any client frame closes the socket, section 5 |
| unknown symbol expectation | Not publicly specified | the upgrade is refused with HTTP 400 and the body `Incorrect parameters` for `symbol=999999`, `symbol=BTC_USDT`, `symbol=113,79` and no `symbol` |
| chunk unit and budget | Not publicly specified | one pair per socket. 96 sockets from this host, one per trade-enabled pair, opened at four a second and all upgraded |
| keepalive mechanism | Not publicly specified | the server sends no protocol ping. A client text frame or a client protocol ping closes the socket with 1006 about 73 to 93 ms later, section 5 |
| connection lifetime and maintenance notice | Not publicly specified | two sockets with no client frame stayed open for the full 120 s. No notice seen |
| handshake and operation rate limits | Not publicly specified | no refusal at 96 opens in 24.1 s, in two runs, and opens took 231 to 502 ms |
| public market data authentication | none | none, but a `User-Agent` header is required by CloudFront |
| message parse and routing | `{symbol, method, result}`, S1 | route on `method` and on `symbol`, which is the pair id |
| subscribe acknowledgement shape | none | none. The first depth frame arrived 272 to 1,298 ms after the socket was created in the two 96-socket runs |
| symbol identifier format | `symbol` "integer", "Specify trade pair ID.", S1 | a string, `"symbol":"113"`, equal to the `pair_id` of `GET /v1/pairs`. The document example also shows a string |
| number representation | `decimal` for price, amount, total and ticker fields, S1 | depth and trade levels are JSON numbers. The ticker sent `c` as a string, `"2783.400000"`, and `h`, `l`, `v`, `rf` as numbers. REST sends strings, see [`rest.md`](./rest.md) section 5 |
| timestamp representation | `ts`, "timestamp.", S1 | integer ms. It is the push time and not the book's last change: arrival minus `ts` was 37 to 113 ms on every frame, including frames whose content had not changed |
| size unit | `amount` | base currency units, and `total` equals price times amount on every level of every frame, section 4 |
| sequence semantics | none | no sequence or update id exists, and none is needed because every depth frame is the whole book |
| idle repeat behaviour | Not publicly specified | the whole book is pushed every second whether or not it changed. A quiet pair repeated the identical book in 59 of 59 consecutive frames |

## 4. The book channel in detail

### Snapshot on subscribe

There is no subscription and no separate snapshot.
Every `depth` frame is the whole book, so the first frame is a snapshot and so is every later frame.
The first depth frame arrived 627 to 1,224 ms after the socket was created in the three book runs.

### Delta semantics

None.
A frame replaces the book.
On `BTC_USDT` and `ETH_USDT` 28 to 32 of 59 consecutive frames repeated the previous book exactly, and the content changed at intervals of p50 2,000 or 2,001 ms, min 987 ms and max 6,002 ms in book runs 2 and 3.
So the market maker on the two busy pairs requotes about every two seconds, and the server pushes the same book in between.
When the book changes, up to all 40 of the top 20 bids and 20 asks change at once.

### Sequence and gap rule

```text
depth frame        resetBook(bids, asks), then publish
no depth for 5 s   the socket is stale, terminate and reopen
```

There is no id to chain, so a missed frame is invisible and harmless, because the next frame is a whole book one second later.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| WebSocket depth | descending on every frame of every pair in all three book runs, as S1 says | ascending on every frame |
| REST `orderbook` | descending | ascending |

### Level window

The frame carries the whole book, as many levels as the REST book at `limit=200`.
In book run 1 `BTC_USDT` held 3 to 23 bids and 10 to 20 asks, and `ETH_USDT` 5 to 21 bids and 9 to 24 asks.
In book run 3 `BTC_USDT` held 7 to 23 bids and 2 to 20 asks, and `ETH_USDT` 9 to 21 bids and 13 to 24 asks.
REST at 30 and 200 levels on `BTC_USDT` returned 23 bids and 20 asks at 04:56 UTC, see [`rest.md`](./rest.md) section 5, and REST at 200 levels matched the WebSocket level count on `CRV_ETH`, 18 and 20, in book run 3.
The books are thin and have stale far orders.
`BTC_USDT` always carried three bids more than 5 % under the mid, at 51,000, 45,000 and 9,192.11, and `ETH_USDT` one bid at 2,423.35 and four asks from 5,000 up.
`CRV_ETH` carried 17 of its 18 bids and 19 of its 20 asks more than 5 % from the mid.

### Size unit against the catalog

The amount is in base currency.
Most `BTC_USDT` levels near the touch read 0.00085 to 0.00093 BTC at about 87,000 USDT, a `total` of about 74 to 81 USDT, with a few larger levels such as 0.33748 BTC.
On every level of every frame of all three book runs `total` equalled `price * amount` within one part per million.
A spot catalog would use a contract size of 1.

The top 20 levels of the WebSocket book and the REST book at the same moment matched on 18 of 18 `BTC_USDT` bids and 18 of 18 asks in book run 1, and 18 of 18 and 13 of 13 in book run 2, and on every `CRV_ETH` level in all three runs.
In book run 3 the WebSocket frame caught the `BTC_USDT` maker mid-requote with 12 bids and 2 asks, the REST book 366 ms later held 23 and 20 at a new touch, and 5 of 12 bids and 0 of 2 asks matched.

### The busy books follow Binance

`BTC_USDT` and `ETH_USDT` carry about 88 % of the venue's 24 h quote volume, see [`rest.md`](./rest.md) section 2, and their books track Binance spot.
Book mode listens to Binance `btcusdt@bookTicker` and `ethusdt@bookTicker` beside the Bilaxy sockets, and finds the delay at which the Bilaxy mid best matches the Binance mid.

| pair, run | Bilaxy mid against Binance at the same instant | best delay | median gap at the best delay |
|---|---|---|---|
| `ETH_USDT`, run 2 | median 18 ppm, p90 90 ppm | 3,100 ms | 1.8 ppm |
| `BTC_USDT`, run 2 | median 3.7 ppm | not identifiable, Binance barely moved | 3.7 ppm at every delay from 0 to 10 s |
| `ETH_USDT`, run 3 | median 90.2 ppm, p90 285 ppm | 2,500 ms | 21.7 ppm, and 23.5 ppm at 3 s and 4 s |
| `BTC_USDT`, run 3 | median 58.4 ppm, p90 253 ppm | 4,500 ms | 4.8 ppm, and 5.2 to 5.3 ppm from 3 s to 5 s |

So both books read like Binance about 2.5 to 5 seconds late.
In run 2 the `ETH_USDT` median gap was 1.8 ppm at both 4 s and 5 s, and in run 3 the gap at a zero delay was about twelve times the gap at the best delay on `BTC_USDT`.
A route between Bilaxy and Binance would see that lag as edge that is not there.

### One-sided and empty books

`DOT_USDT` had no bids and two asks, at 9.999 and 10, for the whole of both book runs, while Binance traded DOT near 1.198.
`XYO_ETH` had no bids and three asks.
A frame sends `"b":[]` for an empty side, so a feed must accept an empty side.
In book run 1 one or more `BTC_USDT` frames carried only the three far bids, so the near bids vanished for about a second while the maker requoted, and in book run 3 one or more frames carried only 2 asks.
The engine's `resetBook` accepts an empty side, and a book whose best bid sits at 51,000 against an ask near 87,000 has to be treated as one-sided rather than as a price.

### Idle repeats

A quiet pair repeats its whole book every second with a fresh `ts`.
`CRV_ETH`, `DOT_USDT` and `XYO_ETH` sent 59 identical repeats in 59 consecutive frames in all three runs.
A feed that stamps receive time must not treat such a frame as a new price, because nothing changed.

### Unknown, closed and wrong-spelling symbols

| request | reply |
|---|---|
| `symbol=999999` | upgrade refused, HTTP 400, `Incorrect parameters` |
| `symbol=BTC_USDT` | the same 400 |
| no `symbol` | the same 400 |
| `symbol=113,79` | the same 400 |
| `symbol=113&symbol=79` | 101, serves 113 only |
| `symbol=5029`, `ACH_ETH`, `trade_enabled` false | 101, depth frames with a book whose best bid is 117,412 at 0.000002039 |
| no `User-Agent` | HTTP 403 from CloudFront |

A disabled pair keeps streaming, so the catalog's `trade_enabled` is the only way to know a pair cannot be traded.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | the server sent no protocol ping on any socket. The client must send nothing: `ping`, `{"method":"ping"}`, `2`, `{"method":"subscribe","symbol":79}` and a protocol ping each closed the socket with 1006 and no close frame 73 to 93 ms after they were sent, in two runs. The site's own code sends nothing on this socket |
| silence the server tolerates | Not publicly specified | the server never goes silent, it pushes the book every second. Two sockets with no client frame, one on `XYO_ETH` and one on `BTC_USDT`, stayed open for the full 120 s in two runs with a longest gap of 1,009 to 1,110 ms. A third socket that sent a protocol ping every 10 s closed at 10,083 and 10,092 ms, at its first ping |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | Not publicly specified | not observed |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | | 231 to 502 ms to open from this host over all runs |
| subscription limits | one pair per socket | 96 sockets from one host, all delivering, 76 frames per second and 51 KB per second in total, 670 bytes per frame, the same in two runs |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Level arrays are cut to the levels named above each frame.

Depth on `ETH_USDT`, the first three levels per side and the far levels kept, from a frame of 21 bids and 19 asks.
The last bid and the last two asks are far from the touch.

```json
{"symbol":"79","method":"depth","result":{"ts":1790138891032,"b":[[2783.25,0.0891,247.987575],[2783.23,0.0895,249.099085],[2783.22,0.1072,298.361184],[2423.35,0.0068,16.47878]],"a":[[2783.4,10.6758,29715.02172],[2783.43,0.2968,826.122024],[2783.44,0.0867,241.324248],[5000,0.2104,1052],[5003,0.002,10.006]]}}
```

Depth with no bids, whole frame.

```json
{"symbol":"887","method":"depth","result":{"ts":1790138890670,"b":[],"a":[[9.999,4.4,43.9956],[10,9.53,95.3]]}}
```

Ticker, whose close price is a string.

```json
{"symbol":"79","method":"ticker","result":{"ts":1790138892883,"c":"2783.400000","h":2787.87,"l":2717.22,"v":5469193.800358,"rf":0.02036}}
```

Trade, the first two of a longer list, with no `id` field although S1 documents one.

```json
{"symbol":"79","method":"trade","result":[{"ts":1790138892226,"p":2783.4,"q":0.0886,"buy":true},{"ts":1790138891267,"p":2783.4,"q":0.0861,"buy":true}]}
```

Refusal of an unknown pair, the whole HTTP reply to the upgrade less the date and request id headers.

```text
HTTP/1.1 400 Bad Request
Content-Type: text/plain; charset=utf-8
Content-Length: 20
Server: nginx
X-Cache: Error from cloudfront
X-Amz-Cf-Pop: SEA73-P3

Incorrect parameters
```

There is no subscribe acknowledgement and no keepalive answer to capture.

## 7. Private channels

None is documented, S1.
The site bundle opens `wss://bilaxy.com/socket.io/?symbol=<fid>&deep=4&token=dev&transport=websocket`, sends `40/trade` and reads an `entrust-update` event that carries user information, and this host got HTTP 502 on that path.
Order entry is REST only, `/v1/accounts/order`, S2.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
Bilaxy lists no perpetual, so no feed is recommended for the engine.
If a spot leg were ever wanted, this is the shape the wire allows.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan per market, `wss://bilaxy.com/stream?symbol=<pair_id>` | the query string selects one pair and there is no subscribe message |
| `User-Agent` | a header on the upgrade | CloudFront refuses an upgrade without one, and [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81 opens sockets with `{ perMessageDeflate: false }` and no headers, so this is a change to shared code |
| markets per connection | 1 | the protocol has no way to carry more |
| subscribe frames | none, `getSubscribeFrames` returns an empty list | any client frame closes the socket |
| keepalive | none, `startKeepalive` does nothing | a protocol ping closes the socket, and the server pushes every second |
| `maxSilenceMs` | 5,000 | the longest gap seen was 1,110 ms, on a quiet pair |
| routing | the plan's single market, or `symbol` mapped back to the pair name | `symbol` is the numeric pair id |
| snapshot | every `depth` frame: `resetBook` and publish | each frame is the whole book |
| repeats | skip a frame whose book equals the previous one | 59 of 59 frames on a quiet pair are repeats with a fresh `ts` |
| resync | none needed | no sequence exists, and the next whole book is one second away |
| receive time | stamp on arrival | `ts` is the push time, not the book time |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Websocket Stream for Bilaxy, `websocket.md` | https://github.com/bilaxy-exchange/bilaxy-api-docs/blob/master/websocket.md | 2026-09-22 | Bilaxy | URL, parameter, methods, fields, level order, sections 1 to 4 |
| S2 | Bilaxy REST API, `restapi.md` | https://github.com/bilaxy-exchange/bilaxy-api-docs/blob/master/restapi.md | 2026-09-22 | Bilaxy | private order endpoints, section 7 |
| S3 | Bilaxy site bundle `assets/index-DW28pl_G.js`, 2,985,540 bytes | https://bilaxy.com/assets/index-DW28pl_G.js | 2026-09-23 04:45 UTC | Bilaxy | the site's stream and socket.io URLs, `40/trade`, no client frame on the stream, sections 1, 5 and 7 |
| P1 | `ws-probe.mjs book`, runs at 04:46, 04:48 and 05:03 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bilaxy/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 1 to 4 and 6 |
| P2 | `ws-probe.mjs errors`, runs at 04:49, 04:53 and 05:04 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bilaxy/ws-probe.mjs) | 2026-09-23 | this host | sections 1, 3, 4 and 5 |
| P3 | `ws-probe.mjs silence`, runs at 04:51 and 05:05 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bilaxy/ws-probe.mjs) | 2026-09-23 | this host | section 5 |
| P4 | `ws-probe.mjs batch`, runs at 04:54 and 05:07 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bilaxy/ws-probe.mjs) | 2026-09-23 | this host | sections 3 and 5 |
| P5 | curl upgrade with and without a `User-Agent`, and on `symbol=999999` | `curl --http1.1 -H 'Upgrade: websocket' ...` | 2026-09-23 04:44 UTC | this host | sections 1, 4 and 6 |
