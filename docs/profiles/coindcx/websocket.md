# CoinDCX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 from 20:25 PDT, which is 03:25 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the public futures WebSocket of CoinDCX, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/coindcx/ws-probe.mjs), and the documentation is S1 in section 9.
CoinDCX speaks Socket.IO, and its FAQ says "CoinDCX Websockets are currently implemented via Socket.io. This is the only officially supported library for our websockets.", S1.
The probe frames Engine.IO 4 and Socket.IO packets by hand on a plain `ws` socket, which is what a `VenueFeed` subclass would have to do.
Where the documentation and the wire disagree, both are written.
All probe times are UTC on 2026-09-23.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals, USDT and INR margin | `wss://stream.coindcx.com`, S1 | `wss://stream.coindcx.com/socket.io/?EIO=4&transport=websocket` opened in 1,068 to 1,152 ms, and once in 2,094 ms, with `server: istio-envoy` |
| spot | `wss://stream-spot.coindcx.com`, S1 | handshake only, `pingInterval` 45,000 and `pingTimeout` 60,000 |

There is one perpetual family, so one socket carries all of it.
The futures host also serves the spot book: joining `B-BTC_USDT@orderbook@20` on it delivered spot BTC frames tagged `"pr":"spot"`, `errors` P3.
`stream.coindcx.com` is an AWS load balancer in `ap-south-1`, Mumbai, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

A client joins with the Socket.IO event `join` and the payload `{"channelName": <name>}`, S1.

| channel name | Socket.IO events | depth and speed | probed |
|---|---|---|---|
| `<id>@orderbook@50-futures`, also `@20` and `@10` | `depth-snapshot`, `depth-update` | 50, 20 or 10 levels, one frame per 500 ms tick | recommended if any, section 4 |
| `currentPrices@futures@rt` | `currentPrices@futures#update`, `currentPrices@futures#snapshot` | changed fields of all pairs, and every pair every 15 s | 2.4 to 2.9 updates per second, every active pair seen in 75 s. A snapshot of all 541 keys, each with `mp` and `efr`, came 3.0, 18.2, 33.0, 47.2 and 63.1 s after the join |
| `<id>@trades-futures` | `new-trade` | on trade | 1,141, 1,415 and 460 BTC trades in three 75 s runs |
| `<id>@prices-futures` | `price-change` | last price on trade | 352, 453 and 157 BTC frames in the same runs |
| `<id>_<resolution>-futures`, for example `B-BTC_USDT_1m-futures` | `candlestick` | 1m to 1M | not probed |

The documentation lists only `depth-snapshot` for the futures book channel, and the wire sends both events, S1 "Get Orderbook".
There is no mark, index or funding channel.
`currentPrices@futures@rt` carries `mp` and `efr` among its fields, the same fields as the REST reply of [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one host for futures, one for spot, S1 | one futures host. It also answers spot channel names |
| subscribe frame shape | Socket.IO `emit('join', {channelName})`, one channel per emit, S1 | `42["join",{"channelName":"B-BTC_USDT@orderbook@50-futures"}]`, one packet per channel |
| unknown symbol expectation | Not publicly specified | silence. `B-NOPE_USDT@orderbook@50-futures`, `BTCUSDT@orderbook@50-futures`, `@orderbook@30-futures` and `@orderbook-futures` sent nothing in about 19 s and did not close the socket, in two runs |
| chunk unit and budget | Not publicly specified | 504 joins sent in one burst on one socket were all served |
| keepalive mechanism | the sample code emits a Socket.IO `ping` event every 25 s, S1 | the server sends Engine.IO ping `2` every 25 s and expects `3` within 20 s, from the handshake and the silence test. The documented `ping` event got no reply |
| connection lifetime and maintenance notice | "For scheduled downtimes, you would receive prior notification over e-mail", S1 FAQ | no notice frame seen, and no lifetime cap reached in 75 s |
| handshake and operation rate limits | Not publicly specified | no refusal at 504 joins in one burst |
| public market data authentication | none, "In Websockets, the order book and market data is available without authentication", S1 | none |
| message parse and routing | `socket.on(<event>)`, S1 | a Socket.IO event packet `42[<event>, {"event", "data"}]` whose `data` is a JSON string that must be parsed a second time. Book frames route on `s` and `pr` inside that string |
| subscribe acknowledgement shape | none documented | no acknowledgement. The first data frame is the only sign that a join worked |
| symbol identifier format | `B-ID_USDT` in channel names, S1 | the channel takes `B-BTC_USDT`, and the book frame's `s` is `BTCUSDT`, the Binance spelling. Trade frames carry `s` as `B-BTC_USDT` |
| number representation | strings in the examples, S1 | book prices and sizes are strings in objects keyed by price. Current prices fields are JSON numbers |
| timestamp representation | `ts` and `E` in ms, S1 glossary | `ts` and `pts` in ms, stamped by CoinDCX, and `E` in ms on updates, which is Binance's event time |
| size unit | Not publicly specified | base coins, matching Binance's size at the same price, section 4 |
| sequence semantics | none documented | `vs` rises by exactly one per frame per stream across both events, with 0 gaps, 0 repeats and 0 reversals on every stream probed |
| idle repeat behaviour | not documented | nothing repeated. A quiet stream skips ticks, and the quietest stream's median gap between frames was 4.6 s and 6.3 s in two runs |

## 4. The book channel in detail

`<id>@orderbook@50-futures` is the channel this profile would use, and every row below is about it unless it says otherwise.

### What a frame is

Each stream sends one frame per 500 ms tick when its book changed, and the frame is either a `depth-snapshot` or a `depth-update`.
The `ts` step between frames was 502 to 505 ms at the median on every busy stream in `book` P1, and a quiet stream skips ticks.
The first three snapshots of every stream in `book` P1 held exactly 50, 20 or 10 levels per side, matching the channel.
How often a stream sends a snapshot instead of an update varies with the book and the minute.
The median snapshot interval in three 75 s runs was 2,008, 505 and 4,017 ms on ETH at 50 levels, 1,506, 1,004 and 5,524 ms on BTC, 7,997, 1,508 and 30,551 ms on DOGE, and 34,422, 33,194 and 37,184 ms on CHR.
XRP at 10 levels sent 99, 111 and 46 snapshots against 46, 34 and 97 updates.
Across all 504 pairs in 62 s, the median stream sent 1 snapshot, and 63 and 85 streams sent none in two runs, `batch` P4.

### The update is Binance's diff

Every `depth-update` carries `E`, and `relay` P2 found that `E` among the Binance USD-M `@depth@500ms` events of the same symbol on every update in three runs: 13, 7 and 18 for XRP at 10 levels, 35, 15 and 41 for ETH at 20, and 42, 41 and 37 for CHR at 50.
Its levels equalled the Binance diff at the same price on 125 of 125 and 264 of 264 XRP levels, 325 of 346 and 501 of 508 ETH levels, and 604 of 619 and 417 of 427 CHR levels, in the last two runs.
The remainder are CoinDCX's own entries: a size `"0"` for a price Binance did not send, or `"0"` for a price Binance still quoted, which reads as a level leaving CoinDCX's window.
`E` was 1 to 3 ms after Binance's transaction time `T` at the median on XRP and ETH, 20 to 36 ms on quiet CHR, and at most 299 ms.
The snapshot carries no `E`, and the probe did not match it to a Binance partial depth event.

### Delta semantics

A `depth-update` sets each listed price to its size, and `"0"` removes the price.
Updates carry prices outside the current window: 582 and 375 of the BTC update levels in two 75 s runs lay beyond the 50th level, so a feed trims each side to the window after applying.
Applying updates this way never crossed a book: 0 crossed books after 21,727 and 19,754 updates on 504 streams, `batch` P4.
On the quiet `B-CHR_USDT`, the book built from updates held 98 % and 95 % of the next snapshot's levels at the same size, more than 30 s after the previous snapshot, against 12 % and 0 % for that previous snapshot alone, `book` P1.
On `B-DOGE_USDT` in the second run the built book held 86 % against 0 %.
On busy books the measure is low for both, because sizes change inside the one tick between the last update and the snapshot.

### Sequence and gap rule

```text
depth-snapshot                    replace the book, last = vs
depth-update, vs = last + 1       apply, trim to the window, last = vs
depth-update, vs != last + 1      gap: resync
depth-update before any snapshot  hold, or seed from the REST book of the same depth
```

`vs` counts per pair and depth, since ETH at 10, 20 and 50 levels carried three unrelated values, see [`rest.md`](./rest.md) section 5.
0 gaps, 0 repeats and 0 reversals in 35,873 and 33,227 frames on 504 streams over 62 s, `batch` P4, and on the six streams of each `book` P1 run.

The first frame after a join was an update on 3, 4 and 5 of 6 streams in three runs, 275 to 1,048 ms after the join, and a stream may go a minute without a snapshot.
The REST book of the same pair and depth, read when the first frame arrived, carried that frame's `vs` on 6 of 6 streams, `book` P1 at 03:56 UTC.
So a REST book with `vs` V is the stream's book after frame V, and a feed can seed from it and apply updates from V + 1.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

Each side is a JSON object from price string to size string, so the order is the object's key order.
Prices without a decimal part come first in ascending order, then the rest in book order, bids descending and asks ascending.
A BTC snapshot's asks began `86853`, `86855`, `86857`, `86858`, `86850.1`, and its bids began `86844`, `86845`, …, `86850`, `86849.8`.
That is the key order of a JavaScript object, and V8's `JSON.parse` reproduces it, so a feed applies levels by price and never by position.

### Size unit

Sizes are base coins, and CoinDCX's `unit_contract_value` is 1 on every pair.
The top 20 bid prices of an ETH snapshot were all on Binance's REST book in three runs, read 247, 296 and 211 ms later, and 1, 11 and 9 of 20 sizes were equal, `book` P1.
The CoinDCX REST book gave 17, 17, 5 and 17 of 20, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

None was seen on any of 504 streams.

### Idle repeats

Nothing is repeated, and a stream with no change sends nothing for that tick.
The median frame step per stream ranged from 502 to 4,572 ms and 502 to 6,305 ms across the 504 streams in two runs, `batch` P4.

### Unknown, closed and wrong-form channels

| join | result, `errors` P3 |
|---|---|
| `B-NOPE_USDT@orderbook@50-futures` | nothing in about 19 s, socket stays open |
| `B-BTC_USDT@orderbook@30-futures` | nothing |
| `BTCUSDT@orderbook@50-futures` | nothing |
| `B-BTC_USDT@orderbook-futures` | nothing |
| `B-BTC_USDT@orderbook@20`, the spot name | the spot book, `"pr":"spot"`, `"s":"BTCUSDT"` |
| the same channel joined twice | one stream, no duplicated `vs` in 65 frames |
| `@50` and `@20` of one pair on one socket | two streams with the same `s`, told apart only by level count and `vs` |
| `leave` of the doubled `@50` | in the next 6 s, 12 frames of at most 20 levels arrived, the `@20` rate alone, and 1 larger frame, which reads as one leave ending both joins |

A closed pair was not available to probe.
Because every failure is silent, a feed has to notice a stream with no frame on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| handshake | Socket.IO client, S1 | Engine.IO open `0{"sid", "upgrades":[], "pingInterval":25000, "pingTimeout":20000, "maxPayload":1000000}`, then the client sends `40` and gets `40{"sid"}` 265 to 281 ms later |
| Engine.IO 3 | not documented | `EIO=3` got the same open packet and a bare `40`, and closed with 1005 529 and 552 ms after the client's `40` |
| keepalive | the sample emits `ping` every 25 s, S1 | server ping `2` first at 26.1 s after the socket was created, in both runs. A client that answers `3` stays open. The `ping` event of the sample got no reply |
| silence the server tolerates | Not publicly specified | a socket that does not answer the ping closed with 1005 at 46.34 to 46.39 s, joined or not, in two runs, which is the 25 s interval plus the 20 s timeout |
| forced disconnect | Not publicly specified | none in 75 s |
| maintenance notice | e-mail, S1 FAQ | none |
| compression | Not publicly specified | text frames only. An offer of permessage-deflate got no `sec-websocket-extensions` header back |
| malformed packet | Not publicly specified | the socket that received `42nope` closed with 1005 about 0.5 s later. An unknown event name, a `join` with the key `channel` and a `ping` event before it got no reply and no close |
| subscription limits | Not publicly specified | 504 book streams at 50 levels on one socket |
| throughput | | all 504 pairs at 50 levels, two runs: median 569 and 521 frames per second, peak 1,093 and 845, 352 and 296 KB per second, 609 and 553 bytes per frame, 8.7 and 7.3 µs for the two `JSON.parse` calls per frame, `batch` P4 |
| age on arrival | | book frames arrived 131 to 135 ms after `ts` at the median on every stream in the last two runs, and at most 496 ms |

## 6. Captured frames

Trimmed, from `book` P1 at 03:41 UTC, except the open packets, which are from `handshake` P6 at 03:36 UTC.
Book sides are cut to three levels.

Engine.IO open, and the Socket.IO connect answer.

```text
0{"sid":"cJ0PfU62v2igyWOtAbjK","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
40{"sid":"twueJep_OFwxn2X7AbjP"}
```

Join, as the client sends it.

```text
42["join",{"channelName":"B-ETH_USDT@orderbook@50-futures"}]
```

A book frame as it arrives, cut after the first price.

```text
42["depth-snapshot",{"event":"depth-snapshot","data":"{\"ts\":1790134884511,\"vs\":220547642,\"asks\":{\"2777\":\"0.548\", …
```

The `data` string of that snapshot, parsed.
The ask `2777` comes before `2776.91`, as section 4 describes.

```json
{"ts":1790134884511,"vs":220547642,"asks":{"2777":"0.548","2776.91":"12.065","2776.92":"0.016"},"bids":{"2776.9":"89.848","2776.89":"0.76","2776.88":"0.991"},"type":"depth-snapshot","pts":1790134884511,"pr":"futures","s":"ETHUSDT"}
```

The `data` string of an update, with Binance's `E`.

```json
{"ts":1790134884516,"vs":106543328,"asks":{},"bids":{"0.02108":"90053","0.02107":"261735","0.02106":"12751"},"type":"depth-update","pts":1790134884516,"E":1790134884448,"pr":"futures","s":"CHRUSDT"}
```

A current prices update, two of its pairs kept.

```json
{"vs":361105655,"ts":1790134884754,"pr":"futures","pST":1790134884737,"prices":{"B-NATGAS_USDT":{"mp":3.16367199,"bmST":1790134884264,"cmRT":1790134884727},"B-CL_USDT":{"mp":89.27,"bmST":1790134884264,"cmRT":1790134884727}}}
```

A trade and a last price.

```json
{"T":1790134884126,"RT":1790134885474.8435,"p":"86857.7","q":"0.245","m":1,"s":"B-BTC_USDT","pr":"f"}
```

```json
{"T":1790134884126,"p":"86857.7","pr":"f"}
```

Keepalive: the server sends `2` and the client answers `3`.
No error frame exists to capture, because every failed join was silent.

## 7. Private channels

Named for a future execution stage, from S1, not probed.
A client joins the channel `coindcx` with `authSignature`, an HMAC-SHA256 of `{"channel":"coindcx"}`, and `apiKey`.
The futures events are `df-position-update`, `df-order-update` and `balance-update`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
No feed is recommended, because the book is Binance USD-M's, relayed and arriving about 130 ms after CoinDCX stamps it, which is itself after Binance's event time `E`, and the engine already reads Binance directly, see [`rest.md`](./rest.md) section 8.
If one were ever built, this is the shape the probes support.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket, `wss://stream.coindcx.com/socket.io/?EIO=4&transport=websocket` | 504 streams ran on one socket with 0 gaps |
| framing | answer `0` with `40`, send joins after `40{`, strip `42`, parse the array, then parse `data` again | Socket.IO v4 over a plain socket |
| channel | `<rawMarketId>@orderbook@50-futures` | 50 levels covers the engine's 20 |
| subscribe frames | one `42["join",{"channelName":…}]` per market | no batch form is documented |
| keepalive | answer every `2` with `3` | the server closes a socket that misses one pong |
| `maxSilenceMs` | 60,000 | the server ping arrives every 25 s and counts as traffic, and a quiet stream can sleep for seconds |
| routing | `pr === "futures"` and `s`, mapped from `BTCUSDT` to `B-BTC_USDT` | `s` is the Binance spelling, and spot frames reuse it |
| snapshot | `resetBook` and store `vs` | |
| update | apply when `vs === last + 1`, trim to 50, store `vs` | section 4 |
| first frames | seed from `public.coindcx.com/market_data/v3/orderbook/<id>-futures/50` and apply updates from its `vs` + 1 | an update often comes first, and the REST `vs` matched the stream on 6 of 6 |
| resync | a gap in `vs` | never observed |
| unserved stream | log a stream with no frame 10 s after its join | failures are silent |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | CoinDCX API documentation, "Futures Sockets", "Spot Sockets" and FAQ | https://docs.coindcx.com/ | 2026-09-22 | CoinDCX, India | hosts, channel names, events, private channels, FAQ, sections 1 to 7 |
| S2 | Binance USD-M WebSocket streams `@depth@500ms`, `@depth10@500ms`, `@depth20@500ms` | `wss://fstream.binance.com/stream` | 2026-09-23 UTC | Binance | the relay comparison, section 4 |
| P1 | `ws-probe.mjs book` at 03:37, 03:41 and 03:56 UTC, the last with the REST seed and price overlap checks | [`ws-probe.mjs`](../../../scripts/probes/venues/coindcx/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs relay` at 03:39, 03:40 and 03:58 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coindcx/ws-probe.mjs) | 2026-09-23 UTC | this host | section 4 |
| P3 | `ws-probe.mjs errors` at 03:43 and 03:58 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coindcx/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1, 3, 4 and 5 |
| P4 | `ws-probe.mjs batch` at 03:43 and 03:59 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coindcx/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 to 5 |
| P6 | `ws-probe.mjs handshake` at 03:36 and 03:56 UTC, and `silence` at 03:45 and 04:00 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coindcx/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 5 and 6 |
