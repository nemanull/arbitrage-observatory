# Bitunix WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Seattle time, which was 2026-09-23 01:14 to 01:43 UTC, from the development host near Seattle.

This profile covers the public futures WebSocket of Bitunix for every perpetual family, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitunix/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Bitunix has no CCXT class, so no CCXT Pro file describes this socket, see [`fees.md`](./fees.md) section 8.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals | `wss://fapi.bitunix.com/public/`, S1 | open in 436 to 458 ms on the four sockets that logged it, first frame `{"op":"connect","data":{"result":true}}` |
| USDC-M perpetuals | the same URL | `BTCUSDC` delivered on the same socket as `BTCUSDT` |
| coin-M perpetuals | the same URL | `BTCUSD` and `ETHUSD` delivered on the same socket |
| private channels | `wss://fapi.bitunix.com/private/`, S1 | not probed |

One socket carries every family, since the symbol names the contract and the families do not share symbols.
`fapi.bitunix.com` is a Cloudflare name, see [`rest.md`](./rest.md) section 1, and the upgrade reply came from a Cloudflare edge with `server: cloudflare`.

## 2. Channel matrix for public market data

| channel `ch` | payload | depth and speed | probed on 2026-09-23 UTC |
|---|---|---|---|
| `depth_book15` | 15 bids and 15 asks | a whole 15-level window on every push | 3.05 to 3.28 pushes a second, recommended, section 4 |
| `depth_book5` | 5 levels | a whole window on every push | 3.23 pushes a second on `ETHUSDT` in both runs |
| `depth_book1` | best bid and best ask | a whole window on every push | 3.23 pushes a second on `ETHUSDT` in both runs |
| `depth_books` | documented as a snapshot then changes, S2 | the whole book on every push | 17,180 to 17,335 bids and 6,287 to 6,378 asks over two runs, 462 to 463 KB a frame and 8.4 to 9.1 ms to parse on `BTCUSDT`, never a partial frame in 186 and 187 |
| `price` | `ip` index, `mp` mark, `fr` funding rate, `ft` last settlement, `nft` next settlement | | 1.97 to 1.99 pushes a second, and 79 to 115 of 120 or 121 pushes identical to the one before |
| `ticker` | 24 h statistics and last price | | 0.69 pushes a second on `BTCUSDT` in both runs, no best bid or ask |
| `tickers` | 24 h mini ticker with `bd`, `ak`, `bv`, `av` best bid and ask, S3 | | not probed |
| `trade` | trades | on trade | not probed |
| `market_kline_<interval>`, `mark_kline_<interval>` | candles of last and mark price, 1 min to 1 month | | not probed |

The channel names and fields are from S1 to S3.
The `price` channel is the only one that carries index, mark and funding, and its `fr` is the last settled rate, not the upcoming one, see section 4 and [`rest.md`](./rest.md) section 4.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL, S1 | every family on one socket, section 1 |
| subscribe frame shape | `{"op":"subscribe","args":[{"symbol":"BTCUSDT","ch":"depth_books"}]}`, a list of streams, S1 | 16 streams in one frame and 300 streams in one frame were both served |
| unknown symbol expectation | not documented | no error. One `depth_book15` frame of 15 empty `["",""]` levels per side, then nothing. The same for a delisted symbol, the `PREVIEW` symbol and a subscribe without a symbol |
| chunk unit and budget | "Max 300 channel subscription/connection", S1 | 300 streams in one frame all delivered. Ten more on the same socket were refused with `"subscribe channel > 300"` |
| keepalive mechanism | client sends `{"op":"ping","ping":<unix s>}`, S1 | answered in 100 ms with `{"op":"ping","pong":<the client's value>,"ping":<the second the socket opened>}`. A protocol ping after a JSON frame got a protocol pong in 101 and 102 ms. A protocol ping as the first client frame got no pong, and the socket closed with 1006 about 1.5 s later on three sockets. The server never sent a ping |
| connection lifetime and maintenance notice | not documented | a socket that sent nothing closed at 60.5 s in both runs, and a subscribed socket that sent no ping closed at 81.3 s and 65.8 s, all with 1006 and no close frame. An application ping every 20 s kept a socket for the full 120 s in both runs. No maintenance frame seen |
| handshake and operation rate limits | "a maximum of 5 messages per second", counting ping, pong and JSON frames, exceeding it disconnects, and "IPs that are repeatedly disconnected may be blocked", S1 and S4 | not tested, since a breach risks an IP block. The probe sent at most about 2 frames a second |
| public market data authentication | none | none |
| message parse and routing | `{ch, symbol, ts, data}`, S2 | route on `ch` and `symbol`. Control frames carry `op` and no `ch` |
| subscribe acknowledgement shape | not documented | none. A valid subscribe gets no reply, and the first data frame follows in 103 to 598 ms. `unsubscribe` answers `{"op":"unsubscribe","ts":…,"data":"success"}` |
| symbol identifier format | `BTCUSDT`, S2 | identical to the REST `symbol` on every stream subscribed. A lowercase `btcusdt` is accepted and its frames say `BTCUSDT` |
| number representation | prices and sizes as strings, S2 | strings on every depth, price and ticker frame |
| timestamp representation | `ts`, Int64, S2 | integer ms. `ft` and `nft` on `price` are ISO 8601 strings such as `"2026-09-23T08:00:00Z"` |
| size unit | not documented | base coin on USDT-M and USDC-M, equal to the REST book. On coin-M the size looks like US dollars, section 4 |
| sequence semantics | none documented | no sequence or update id on any frame. Every depth frame is a whole window, so there is nothing to chain |
| idle repeat behaviour | not documented | pushes arrive on a timer of about 310 ms for every stream, quiet or busy. `depth_book15` repeated its previous frame at most 3 times in about 197 pushes per stream. `price` repeated itself on most pushes |

## 4. The book channel in detail

`depth_book15` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame for each stream is a whole 15-level window, 103 to 598 ms after the subscribe frame, P1 and P5.
Every later frame is also a whole window, so there is no separate snapshot.
A feed resets the book on every frame.

### Delta semantics

None.
On all six `depth_book15` streams of P1 and P5 every frame had exactly 15 bids and 15 asks, 186 to 200 frames per stream in 61 s.
`depth_book5` always had 5 and `depth_book1` always had 1.

`depth_books` is documented as "Push the full snapshot data for the first time, push all afterwards, that is, if there is a change in depth, the depth data that has changed will be pushed", S2.
On the wire it pushed the whole book every time.
`BTCUSDT` frames held 17,324 to 17,335 bids and 6,287 to 6,303 asks, 463 KB each, at 3.05 frames a second, and the REST book at `limit=max` held 17,328 bids and 6,310 asks a few minutes later, P1 and [`rest.md`](./rest.md) section 5.
The rerun saw 17,180 to 17,226 bids and 6,352 to 6,378 asks, 462 KB each, at 3.07 frames a second, P5.
That is about 1.4 MB a second for one contract, so `depth_books` is not usable at scale.

### Sequence and gap rule

No frame carries a sequence number, an update id or a checksum, P1.
Since each frame replaces the window, a lost frame costs one push of staleness and nothing else.

```text
any depth_book15 frame   replace both sides of the book with the 15 levels, then publish
```

The feed's `resync` path is then needed only for a socket that stops delivering.

### Checksum

None documented, and none on the wire.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `depth_book15`, `depth_book5`, `depth_book1` | best first, descending, on every frame of P1 and P5 | best first, ascending, on every frame |
| `depth_books` | descending on every frame | ascending on every frame |
| REST `depth` | descending at limits 1, 5, 15, 50 and `max` | ascending |

### Level window

The window is fixed at 15 per side.
The engine holds 20 levels per side by default, at [`Engine.ts`](../../../server/src/engine/Engine.ts) line 61, so a Bitunix book would carry 15.
No 20 or 50 level channel exists on the socket, S2.

### Size unit

| contract | family | socket size at the touch, P1 | REST size at the same price, P1 | levels equal in P1 and P5 | reading |
|---|---|---|---|---|---|
| `BTCUSDC` | USDC-M | `"0.522"` bid, `"0.641"` ask | the same | 15 of 15 and 13 of 15 per side | BTC |
| `BTCUSDT` | USDT-M | `"2.932"` bid | `"2.7267"`, the REST call took 492 ms | 0 to 1, and 6 to 8 | BTC |
| `ARIAUSDT`, then `YBUSDT` | USDT-M | `"10084"` bid | `"10171"` | 13 of 15, and 14 of 15 on `YBUSDT` | the coin |
| `BTCUSD` | coin-M | `"217283.9"` bid | `"204346.9"` | 7 of 15, and 3 of 15 | US dollars, inferred |

The prices matched the REST book on all 15 levels of every contract compared in both runs, and the sizes matched wherever the book had not moved between the two reads, P1 and P5.
The linear families report the size in the base coin, which is the unit of `minTradeVolume` in the catalog, S5.
A coin-M size of 217,283.9 at a price near 86,690 fits US dollars, about 2.5 BTC, and does not fit bitcoin or whole contracts.
The catalog says `minTradeVolume` is `"100"` for `BTCUSD`, which also fits dollars.
That reading is an inference, and no document states the coin-M unit.

On the 13 contracts whose symbol carries a multiplier, such as `1000PEPEUSDT`, the catalog's `base` names the unscaled token.
`1000PEPEUSDT`, the one compared, reports its REST size in units of 1,000 PEPE, see [`rest.md`](./rest.md) section 2, and the other 12 were not compared.

### One-sided and empty books

An unknown, delisted or `PREVIEW` symbol gets one frame of 15 `["", ""]` levels per side and nothing after it, P2.
No listed contract showed an empty or one-sided book in the 300 contracts of the P3 rerun, which checked every frame for an empty side.
A feed must treat an empty string price as no level.

### Idle repeats

Pushes are timer driven.
Every stream on a socket pushed at the same instant, with `ts` values within a few milliseconds of each other across channels and symbols.
The median gap between pushes was 305 to 327 ms on every depth stream in P1 and P5, and the longest gap was 416 to 591 ms.
The shortest gap was 45 to 107 ms, apart from one 1 ms gap on `ETHUSDT` in P1.
In P3 the least active of 300 contracts still got 184 and 185 frames in 60 s, and the busiest got 199.
A `depth_book15` frame equal to the one before came 0 to 2 times per stream in P1 and P5.
In the P3 rerun 55 of 300 streams repeated a frame, 67 times in all and at most 3 times in 197 frames on one stream.
The `price` channel repeated the previous frame on 79 to 115 of 120 or 121 pushes.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `depth_book15` `NOPEUSDT` | no reply | one frame of empty levels |
| `depth_book15` `MILKUSDT`, delisted | no reply | one frame of empty levels |
| `depth_book15` `FDUSDUSDT`, `PREVIEW` | no reply | one frame of empty levels |
| `depth_book15` `QQQUSDT`, `isApiSupported` false | no reply | a normal book, 9 and 10 frames in 3 s |
| `depth_book15` `btcusdt` | no reply | frames for `BTCUSDT` |
| `depth_book15` with no symbol | no reply | one frame of empty levels with no `symbol` key |
| the same stream twice | no reply | one stream, not two |
| unknown channel `nope_channel` | no reply | nothing |
| unknown op `nope` | no reply | nothing |
| text that is not JSON | no reply | the socket stays open |
| more than 300 streams | `{"op":"subscribe","data":{"msg":"subscribe channel > 300","nonce":"","result":false}}` | the first 300 keep delivering |

Because a bad symbol produces neither an error nor an ongoing stream, the feed has to notice a stream whose only frame had empty levels.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | `{"op":"ping","ping":<unix s>}`, S1 | reply `{"op":"ping","pong":1790126498,"ping":1790126491}` in 100 ms, where `pong` echoed the client's value and `ping` was the second the socket opened, in every run. A protocol ping sent after a JSON frame got a protocol pong in 101 and 102 ms, P2 and P6 |
| protocol ping first | not documented | a socket whose first client frame was a protocol ping got no pong and closed with 1006 at 6.5 s, 21.5 s and 21.6 s, about 1.5 s after a ping sent at 5 s or 20 s, P4 and P6. So the keepalive must be the JSON ping |
| silence the server tolerates | Not publicly specified | nothing sent: closed at 60.5 s in both runs. Subscribed to a book and receiving about 3 frames a second, no ping: closed at 81.3 s and 65.8 s. All with 1006 and no close frame. An application ping every 20 s held a socket for 120 s in both runs, P4 |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | a client that offered permessage-deflate got no `sec-websocket-extensions` header back, twice. Every frame was text JSON |
| handshake | | 436 to 458 ms to open |
| message rate | 5 client messages a second, pings and pongs included, S4 | not tested |
| subscription limit | 300 per connection, S1 | confirmed twice by the refusal of streams 301 to 310 |
| throughput | | 300 USDT contracts on one socket at `depth_book15`: 971 frames a second on average in both runs, median 968 and 969, peak 1,020 and 1,025, 642 KB a second, 677 bytes a frame, 39.4 to 40.2 µs `JSON.parse` a frame, P3 |
| arrival lag | | `ts` was 48 to 50 ms before arrival at the minimum and 49 to 54 ms at the median on the 15-level streams. `BTCUSDT` at 15 levels had a median of 92 and 94 ms on the socket that also carried its 462 KB `depth_books` frames, whose own median was 79 and 81 ms |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Level arrays are cut to three.

Connect, sent by the server on open.

```json
{"op":"connect","data":{"result":true}}
```

Subscribe, in the shape the probe sent, cut to three streams, which gets no reply.

```json
{"op":"subscribe","args":[{"symbol":"BTCUSDT","ch":"depth_book15"},{"symbol":"BTCUSD","ch":"depth_book15"},{"symbol":"BTCUSDT","ch":"price"}]}
```

`depth_book15` on USDT-M, USDC-M and coin-M.

```json
{"ch":"depth_book15","symbol":"BTCUSDT","ts":1790126515693,"data":{"b":[["86699.6","2.274"],["86699.5","2.7407"],["86699.4","3.093"]],"a":[["86699.7","0.7095"],["86699.8","2.1992"],["86699.9","1.457"]]}}
```

```json
{"ch":"depth_book15","symbol":"BTCUSDC","ts":1790126515690,"data":{"b":[["86687.9","0.806"],["86687.4","0.315"],["86686.9","0.745"]],"a":[["86688","0.59"],["86688.5","0.543"],["86689","0.421"]]}}
```

```json
{"ch":"depth_book15","symbol":"BTCUSD","ts":1790126515690,"data":{"b":[["86683.3","206002.1"],["86683.1","196893.4"],["86682.9","99446.7"]],"a":[["86683.4","96555.8"],["86683.6","194077.6"],["86683.8","111066"]]}}
```

An unknown symbol, cut to three of the fifteen empty levels.

```json
{"ch":"depth_book15","symbol":"NOPEUSDT","ts":1790126491101,"data":{"b":[["",""],["",""],["",""]],"a":[["",""],["",""],["",""]]}}
```

`price`, whose `fr` is the rate settled at `ft`, in percent.

```json
{"ch":"price","symbol":"BTCUSDT","ts":1790126515695,"data":{"ip":"86720.6","mp":"86688.3","fr":"-0.00077","ft":"2026-09-23T00:00:00Z","nft":"2026-09-23T08:00:00Z"}}
```

`ticker`.

```json
{"ch":"ticker","symbol":"BTCUSDT","ts":1790126515684,"data":{"s":"BTCUSDT","o":"85567","la":"86688.2","h":"86815.6","l":"85080","b":"27478.1701","q":"2362759522.50052","r":"1.3103182302"}}
```

Keepalive.

```json
{"op":"ping","ping":1790126498}
```

```json
{"op":"ping","pong":1790126498,"ping":1790126491}
```

Unsubscribe.

```json
{"op":"unsubscribe","ts":1790126500916,"data":"success"}
```

Refusal past 300 streams.

```json
{"op":"subscribe","data":{"msg":"subscribe channel > 300","nonce":"","result":false}}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use `wss://fapi.bitunix.com/private/` and an `op` `login` frame with `apiKey`, `timestamp`, `nonce` and `sign`.

- Balance Channel, Order Channel, Position Channel and Tp Sl Channel, as the documentation's sidebar names them.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://fapi.bitunix.com/public/`, for every family | a socket serves all three |
| channel | `depth_book15`, `{"symbol": <rawMarketId>, "ch": "depth_book15"}` | the deepest channel that is not the whole book |
| markets per connection | 300, or 250 to leave room | the documented cap, and 300 delivered at 971 frames a second |
| subscribe frames | one frame per slice with every stream in `args` | the venue allows 5 client messages a second, so a slice must never be split into many frames |
| keepalive | `{"op":"ping","ping":<unix s>}` every 20 s, never a protocol ping before the first JSON frame | the server sends no ping and drops a socket that has sent nothing for about 60 to 80 s, even while it streams, and a protocol ping as the first frame kills the socket |
| `maxSilenceMs` | 5,000 | every stream pushes about every 310 ms and the longest gap seen was 591 ms, so five seconds of silence is a dead socket |
| routing | `frame.ch === 'depth_book15'`, key `frame.symbol` | control frames carry `op` instead |
| book | `resetBook` with the 15 bids and 15 asks of every frame, then `publish` | each frame is a whole window |
| sequence | none | there is no id to chain |
| resync | only on socket loss or silence | a lost frame is healed by the next one |
| unserved stream | log a stream whose first frame has empty string prices, and drop it | the venue does not reject unknown symbols |
| receive time | stamp on arrival | `ts` runs about 50 ms before arrival |
| sizes | `Number()` of the string on USDT-M and USDC-M, and do not track coin-M until its unit is settled | coin-M sizes look like dollars |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |

A Bitunix book refreshes on a timer of about 310 ms and carries 15 levels.
With the longest gap of 591 ms and about 50 ms of transit, the book can be about 0.65 s old when a cross is read, which a later design has to weigh against the engine's other feeds.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitunix futures OpenAPI, WebSocket preparing for access | https://www.bitunix.com/api-docs/futures/websocket/prepare/WebSocket.html | 2026-09-22 | Bitunix, global | URLs, ping, subscribe and login frames, the 300 cap, the 5 message rate, sections 1, 3, 5, 7 |
| S2 | Bitunix futures OpenAPI, depth channel and MarketPrice channel | https://www.bitunix.com/api-docs/futures/websocket/public/depth%20channel.html and https://www.bitunix.com/api-docs/futures/websocket/public/MarketPrice%20Channel.html | 2026-09-22 | Bitunix, global | channel names and fields, sections 2 to 4 |
| S3 | Bitunix futures OpenAPI, Tickers, Ticker, Trade and kline channels | https://www.bitunix.com/api-docs/futures/websocket/public/Tickers%20Channel.html | 2026-09-22 | Bitunix, global | section 2 |
| S4 | Bitunix futures OpenAPI change log, 2026-06-15 | https://www.bitunix.com/api-docs/futures/log/change_log.html | 2026-09-22 | Bitunix, global | the 5 message rate and the IP block warning |
| S5 | Bitunix futures OpenAPI, Get Trading Pairs | https://www.bitunix.com/api-docs/futures/market/get_trading_pairs.html | 2026-09-22 | Bitunix, global | `minTradeVolume` in base currency, section 4 |
| P1 | `ws-probe.mjs book`, 61 s | [`ws-probe.mjs`](../../../scripts/probes/venues/bitunix/ws-probe.mjs) | 2026-09-23 01:21 UTC | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs errors` at 01:20, 01:21 and 01:36 UTC, and `deflate` at 01:21 and 01:37 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitunix/ws-probe.mjs) | 2026-09-23 | this host | sections 3 to 6 |
| P3 | `ws-probe.mjs batch`, 60 s, at 01:24 and 01:35 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitunix/ws-probe.mjs) | 2026-09-23 | this host | sections 3 to 5 |
| P4 | `ws-probe.mjs silence`, 120 s, at 01:27 and 01:35 UTC, the second with a fourth socket that sends protocol pings | [`ws-probe.mjs`](../../../scripts/probes/venues/bitunix/ws-probe.mjs) | 2026-09-23 | this host | sections 3 and 5 |
| P5 | `ws-probe.mjs book`, rerun, 61 s | [`ws-probe.mjs`](../../../scripts/probes/venues/bitunix/ws-probe.mjs) | 2026-09-23 01:35 UTC | this host | sections 2 to 5 |
| P6 | `ws-probe.mjs pping`, 25 s | [`ws-probe.mjs`](../../../scripts/probes/venues/bitunix/ws-probe.mjs) | 2026-09-23 01:37 UTC | this host | section 5 |
