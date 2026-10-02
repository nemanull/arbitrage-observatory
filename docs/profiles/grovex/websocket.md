# GroveX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:17 to 03:34 UTC, from the development host near Seattle.

This profile covers the public spot WebSocket of GroveX, which has no perpetual and no CCXT class, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/grovex/ws-probe.mjs), and each mode ran twice.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation is one Markdown file on GitHub, S1, and the Developers page of the web site restates it, S2.

## 1. Endpoints

| market | documented URL | probed |
|---|---|---|
| spot, every market | `wss://ws.grovex.io/kline-api/ws`, S1 and S2 | open in 663 to 742 ms over the 12 sockets that logged it, behind Cloudflare |

One URL carries every spot market.
The web app's own configuration at `https://webapi.grovex.io/common/market` names the same `wsUrl`, S3.
No futures socket exists, see [`fees.md`](./fees.md) section 3.

## 2. Channel matrix for public market data

| channel | frame | depth and speed | probed on 2026-09-23 UTC |
|---|---|---|---|
| `market_<symbol>_depth_step0` | `{"event":"sub","params":{"channel":"market_btcusdt_depth_step0","cb_id":"btcusdt","asks":150,"bids":150}}` | full book, `step1` and `step2` merge prices to fewer decimals, S1 | a whole snapshot on subscribe, then a whole snapshot on change and about every 11 s, never a delta |
| `market_<symbol>_depth_step1`, `_step2` | same | same | same cadence as `step0`, prices rounded to 0.1 and 1 on `btcusdt` |
| `market_<symbol>_ticker` | `sub` | 24 h statistics, S1 | 5 frames in 75 s on `btcusdt` in each run, no bid or ask field |
| `market_<symbol>_trade_ticker` | `sub`, or `req` with `top` for history | on trade, S1 | 4 and 7 frames in 75 s on `btcusdt` |
| `market_<symbol>_kline_<period>` | `sub`, or `req` for history | periods `1min` to `1month`, S1 | `req` returned one-minute candles |
| `review` | `req` | 24 h statistics of every market in one reply, S1 | one gzip reply keyed by symbol |

There is no best bid and ask channel, and no index, mark or funding channel.
The ticker carries `amount`, `close`, `high`, `low`, `open`, `rose` and `vol`, and no bid or ask.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | one URL served all 100 USDT markets of the batch run, section 5 |
| subscribe frame shape | `{"event":"sub","params":{"channel":"market_$base$quote_depth_step[0-2]","cb_id":"custom","asks":150,"bids":150}}`, one channel per frame, S1 | as documented, one channel per frame, 100 frames in one burst all served |
| unknown symbol expectation | Not publicly specified | silence: `market_nopeusdt_depth_step0`, `market_BTCUSDT_depth_step0` and `market_btcusdt_depth_step7` got no frame of any kind in 75 s |
| chunk unit and budget | Not publicly specified | 100 channels on one socket in both batch runs, all delivering, no refusal |
| keepalive mechanism | the Java demo gunzips each frame, and when the text contains `ping` it sends the text back with `ping` replaced by `pong`, S1 | no application ping and no protocol ping from the server on any socket in either run. A protocol ping from the client got a pong, 4 of 4 |
| connection lifetime and maintenance notice | Not publicly specified | a socket with no subscription closed at 60.7 s with 1006, twice. No lifetime cap reached in 100 s with a subscription |
| handshake and operation rate limits | Not publicly specified | none met at 100 subscribe frames in one burst |
| public market data authentication | none, S1 | none |
| message parse and routing | `{"channel", "ts", "tick"}`, S1 | `{"event_rep":"","channel":…,"data":null,"tick":{…},"ts":…,"status":"ok"}`, routed on `channel` |
| subscribe acknowledgement shape | `{"event_rep":"subed","channel":…,"cb_id":…,"ts":…,"status":"ok"}`, S1 | no acknowledgement arrives. The first frame is the snapshot, 169 and 171 ms after the subscribe burst |
| symbol identifier format | `market_$base$quote_…`, lowercase in the examples, S1 | lowercase base and quote with no separator, `btcusdt`, the same as the REST `symbol`, and uppercase is silently ignored |
| number representation | numbers in the examples, S1 | depth prices and sizes are JSON numbers. Ticker fields and trade `price`, `vol` and `amount` are strings |
| timestamp representation | `ts` in ms, S1 | `ts` in ms, always a whole second such as `1790134142000`. Trade `ds` is a local time string eight hours ahead of UTC |
| size unit | Not publicly specified | base coin: `btcusdt` sizes such as `0.05117` are BTC |
| sequence semantics | "The first successful subscription will immediately return a full amount of data, and the server will regularly push a full amount of data", then incremental `{"side", "price", "volume"}` frames, S1 | no sequence number exists. 0 incremental frames in either book run, and 1,091 of 1,091 frames in the second batch run were whole snapshots |
| idle repeat behaviour | "the server will regularly push a full amount of data", S1 | an unchanged book is sent again about every 11 s. The empty `tigrinousdt` book sent 9 and 8 frames in 75 s, all identical after the first |

## 4. The book channel in detail

`market_<symbol>_depth_step0` is the only book channel, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame for a channel is a whole book, with `tick.asks` and `tick.buys`.
The documented high frequency variant promises incremental frames after it, S1.
None came: 0 frames with `tick.side` or `tick.price` on six depth channels over 75 s in each of two runs, P1 and P2.
Every later frame is another whole book.

### Delta semantics

There are no deltas on the wire.
Each frame replaces the book.
The server pushed a new frame when the book changed and republished an unchanged book about every 11 s.
On `btcusdt`, the gaps between frames were 10,117 to 11,217 ms with 7 of 8 frames identical in the first run, and 1,081 to 11,229 ms with a median of 2,106 ms and 3 of 23 identical in the second.
No two frames of one `btcusdt` channel arrived less than 1,081 ms apart.

### Sequence and gap rule

```text
every frame   replace both sides of the book
```

No frame carries a sequence number, an update id or a checksum, so a gap cannot be detected, and none needs to be, because each frame is whole.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| WebSocket snapshot | `buys`, best first, descending, on every channel of both runs | best first, ascending |
| REST `market_dept` | `bids`, descending | ascending |

### Level window

The `asks` and `bids` numbers in the subscribe frame do not limit the book.
A subscription asking for 5, 20 and 150 levels got 47 bids and 48 to 49 asks, 47 bids and 50 to 53 asks, and 47 to 51 bids and 53 to 56 asks, in the two `req` runs, P3 and P4.
The `btcusdt` book held 46 to 61 bids and 46 asks in the book runs, `ethusdt` 26 to 33 bids and 24 to 37 asks, and `grxusdt` 20 of each.
The engine holds 20 levels per side, so the `btcusdt` book is deep enough in count.
It is not deep in size: its best bid in the second run was `[86621.91, 0.05117]` and the next bid was 40.70 USDT lower.

### Size unit

Sizes are base coin on the wire.
GroveX has no contract, and CCXT has no class to report a `contractSize`, so the engine's size multiplier would be 1.

### The touch against the ticker and against Binance

The WebSocket book is the book that the REST ticker's `buy` and `sell` describe.
Its best bid and ask equalled `buy` and `sell` of the REST `get_ticker` reply on 8 of 8 comparisons in the first run and 7 of 7 in the second, P1 and P2.
The REST `market_dept` book did not match either on any comparison, because for pairs Binance also lists it is a copy of Binance's book refreshed every 420 s, see [`rest.md`](./rest.md) section 5.

The `btcusdt` WebSocket spread was 855 ppm in the first run and 1,649 to 1,759 ppm in the second.
Against Binance spot's mid at the same instant, its bid sat 388 to 808 ppm below and its ask 91 to 1,160 ppm above, P1 and P2.
So the GroveX book brackets Binance's price with a spread wider than the engine's usual crosses.

### Trades inside the spread

All 7 `btcusdt` trades of the second book run printed strictly inside GroveX's own best bid and ask, P2.
Each was 0.2554 to 0.26903 BTC, and 6 of the 7 prices equalled Binance's best bid or best ask read a moment after the trade arrived.
The first run's single captured trade, 86527.55, also sat inside the GroveX spread of 86493.94 to 86567.85, P1.
A trade inside the spread took no displayed level, so these prints do not come from the displayed book.
That reading is an inference from 8 trades, and it matters for any study that uses GroveX trades or volume.

### One-sided and empty books

`tigrinousdt` sent `{"asks":[],"buys":[]}` on subscribe and on every republish, in both runs.
An empty side arrives as an empty array, which `resetBook` accepts.
A one-sided book was not seen.

### Idle repeats

An unchanged book is republished about every 11 s, with a new `ts`.
The empty `tigrinousdt` book repeated 8 of 9 and 7 of 8 frames in the two runs.

### Unknown, closed and wrong-form streams

| request | reply | then |
|---|---|---|
| `sub` `market_nopeusdt_depth_step0` | nothing | nothing in 75 s, socket open |
| `sub` `market_BTCUSDT_depth_step0` | nothing | nothing in 75 s |
| `sub` `market_btcusdt_depth_step7` | nothing | nothing in 75 s |
| `sub` `market_ethusdt_depth_step0` twice on one socket | a second snapshot 2 to 3 ms after the first | not checked further |
| `req` `market_btcusdt_depth_step0` | nothing | |
| `{"event":"nope",…}` | the same frame echoed back, binary and not gzip | socket open |
| text that is not JSON | nothing | socket open |
| `{"ping": <ms>}` | nothing | socket closed with 1006 about 0.2 s later, in the one run that sent it |
| `req` kline with `"endIdx":""` and `"pageSize":3` | nothing | socket closed with 1006 within 1 s, in both runs |
| `unsub` with the channel and `cb_id` | nothing | 0 frames in the next 14 s, in both runs |

A closed or delisted market was not available to probe.
Because a bad symbol is silent, a feed has to notice a channel with no snapshot on its own.
Because some malformed JSON objects close the socket, a feed must send only the documented shapes.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | the demo answers a gzip frame containing `ping` with the same text and `pong`, S1 | no server ping of either kind in any run. The client protocol ping got 4 pongs of 4 and kept an unsubscribed socket open for 75 s |
| silence the server tolerates | Not publicly specified | a socket with no subscription and no client frame closed at 60,688 and 60,670 ms with 1006 and no close frame. A subscribed socket that sent nothing more stayed open for 100 s and 75 s, because the server republishes every 11 s |
| forced disconnect | Not publicly specified | none in 100 s |
| maintenance notice | Not publicly specified | none seen |
| compression | the demo gunzips every frame, S1 | every data frame is a binary WebSocket frame holding a gzip stream, `1f 8b`. Permessage-deflate offered by the client was not negotiated, with no `sec-websocket-extensions` header in either run |
| handshake | | 663 to 742 ms to open, over 12 sockets |
| subscription limits | Not publicly specified | 100 channels on one socket in both runs, all delivering |
| throughput | | 100 USDT markets on one socket for 60 s: 1,125 and 1,091 frames, 6 to 22 per market, median 17 frames a second, peak 65 and 56, 10.5 and 10.1 KB a second on the wire, `gunzipSync` plus `JSON.parse` median 86 and 97 µs a frame, p90 149 and 178 µs |

The engine refuses permessage-deflate at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 81, and that does not matter here, since the server compresses inside the frame and never negotiates the extension.
The engine hands a subclass the raw frame as a `Buffer` at line 209 of the same file, so a GroveX subclass would gunzip it in `handleMessage`.
At the batch run's rate, gunzip and parse cost about 1.7 ms a second of the event loop for 100 markets.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Level arrays are cut to three levels per side.

Subscribe.

```json
{"event":"sub","params":{"channel":"market_btcusdt_depth_step0","cb_id":"btcusdt","asks":150,"bids":150}}
```

No acknowledgement arrives.
The first frame, gunzipped, is the snapshot.

```json
{"event_rep":"","channel":"market_btcusdt_depth_step0","data":null,"tick":{"asks":[[86764.73,0.18459],[86771.79,0.08257],[86800.78,0.06277]],"buys":[[86621.91,0.05117],[86581.21,0.0934],[86514.69,0.10081]]},"ts":1790134142000,"status":"ok"}
```

The same book on `step2`, prices merged to whole dollars.

```json
{"event_rep":"","channel":"market_btcusdt_depth_step2","data":null,"tick":{"asks":[[86765,0.18459],[86772,0.08257],[86801,0.06277]],"buys":[[86621,0.05117],[86581,0.0934],[86514,0.10081]]},"ts":1790134142000,"status":"ok"}
```

An empty book.

```json
{"event_rep":"","channel":"market_tigrinousdt_depth_step0","data":null,"tick":{"asks":[],"buys":[]},"ts":1790134143000,"status":"ok"}
```

Ticker.

```json
{"event_rep":"","channel":"market_btcusdt_ticker","data":null,"tick":{"amount":"307349564.1645482","close":"86650.67","high":"86822.69","low":"85114","open":"85616.23","rose":"0.0120822886","vol":"3570.32722"},"ts":1790134139000,"status":"ok"}
```

Trade, printed at 86650.65 while the book above showed 86621.91 to 86764.73, and `ds` is 03:29:10 UTC written as 11:29:10.

```json
{"event_rep":"","channel":"market_btcusdt_trade_ticker","data":null,"tick":{"data":[{"amount":"23311.6243695","ds":"2026-09-23 11:29:10","id":13652120,"price":"86650.65","side":"BUY","ts":1790134150000,"vol":"0.26903"}],"ts":1790134150000},"ts":1790134150000,"status":"ok"}
```

An unknown event, echoed back uncompressed.

```json
{"event":"nope","params":{"channel":"market_btcusdt_ticker"}}
```

A history reply to `req`, cut to its first trade.

```json
{"event_rep":"rep","channel":"market_btcusdt_trade_ticker","data":[{"amount":"21340.0879504","ds":"2026-09-23 11:30:30","id":13652127,"price":"86691.94","side":"SELL","ts":1790134230000,"vol":"0.24616"}],"tick":null,"ts":1790134231000,"status":"ok"}
```

## 7. Private channels

None are documented.
The document's WebSocket section covers market data only, and orders, balances and fills are signed REST calls, S1.

## 8. Recommended feed shape

GroveX has no perpetual, so no feed is recommended for the engine.
If a spot study ever needs one, this is the shape the wire supports.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://ws.grovex.io/kline-api/ws` for every market | one URL |
| channel | `market_<symbol>_depth_step0`, one `sub` frame per market | the only full precision book |
| markets per connection | 100 | 100 ran in both batch runs, and no cap is published, so a larger slice is untested |
| decode | `gunzipSync(raw)` before `JSON.parse` in `handleMessage` | every data frame is gzip, and the one uncompressed frame is an echo of a bad event |
| keepalive | none needed while subscribed, or a protocol ping every 20 s | the server never pings, republishes every 11 s, and answers protocol pings. Never send `{"ping":…}`, which closes the socket |
| `maxSilenceMs` | 30,000 | about 11 s between republishes on every channel seen, so 30 s is nearly three missed republishes |
| routing | `channel.split('_')[1]` gives the symbol | the channel wraps the lowercase symbol |
| snapshot | every frame: `resetBook(symbol, buys, asks)` | there are no deltas |
| sequence and resync | none | no sequence exists, each frame is whole |
| unserved channel | log a channel with no frame 15 s after its `sub` | bad symbols are silent |
| receive time | stamp on arrival, never from `ts` | `ts` is truncated to the second |
| deflate | keep `perMessageDeflate: false` | the server compresses inside the frame and does not negotiate the extension |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | GroveX official API document, sections "Subscription - Deep Port (High Frequency)", "Subscription - Deep Port", the other subscription and request sections, and the Java demo | https://github.com/GroveXchange/grovexfile/blob/main/api_doc_en.md | 2026-09-23 UTC | GroveX, global | URL, channel names, frame shapes, the documented ack, full push and incremental rules, gzip and ping in the demo, sections 1 to 7 |
| S2 | GroveX Developers page | https://www.grovex.io/api | 2026-09-23 UTC | GroveX, global | URL and channel list restated, section 1 |
| S3 | GroveX web app market configuration | https://webapi.grovex.io/common/market | 2026-09-23 UTC | GroveX, global | `wsUrl`, section 1 |
| P1 | `ws-probe.mjs book` and `deflate` at 03:17 UTC, `batch` at 03:20 UTC, `silence` at 03:21 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/grovex/ws-probe.mjs) | 2026-09-23 | this host | sections 1 to 6, the first readings |
| P2 | `ws-probe.mjs book` at 03:29 UTC, `batch` at 03:31 UTC, `silence` and `deflate` at 03:32 to 03:34 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/grovex/ws-probe.mjs) | 2026-09-23 | this host | sections 1 to 6, the second readings, the trade check, client pings |
| P3 | `ws-probe.mjs req` at 03:25 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/grovex/ws-probe.mjs) | 2026-09-23 | this host | history replies, level window, bad frames, unsub, section 4 |
| P4 | `ws-probe.mjs req` at 03:30 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/grovex/ws-probe.mjs) | 2026-09-23 | this host | the same, second readings |
