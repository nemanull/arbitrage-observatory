# Vindax WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:47 to 05:24 UTC), from the development host near Seattle, in two passes, through the laptop's Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public spot stream of VinDAX (no CCXT class), because Vindax lists no perpetual, see [`fees.md`](./fees.md) section 3.
Vindax publishes no WebSocket documentation.
The 2019 API document lists REST calls only, S1, and the live documentation page answers this host with a Cloudflare challenge, see [`fees.md`](./fees.md) section 1.
The stream was found in the live web app bundle, S2, and its protocol in the 2021 web client code the Internet Archive kept, S3 to S5.
So the "documented" column below means that web client code, and every protocol claim was then captured by [`ws-probe.mjs`](../../../scripts/probes/venues/vindax/ws-probe.mjs).

## 1. Endpoints

| family | URL | probed |
|---|---|---|
| spot, every quote asset | `wss://socket.vindax.com/socket.io/?EIO=3&transport=websocket`, a Socket.IO 2 server over Engine.IO 3 | open in 723 to 1,125 ms over both passes, P1 to P5 |
| perpetuals, futures, options | none | no such product, see [`fees.md`](./fees.md) section 3 |

The live app sets `socket:"wss://socket.vindax.com"`, S2.
The 2021 client opened one Socket.IO namespace per symbol with `io.connect(stream.url + "/" + stream.lowerCaseSymbol, { transports: ['websocket'], upgrade: false })`, S3.
The polling transport is refused: `https://socket.vindax.com/socket.io/?EIO=3&transport=polling` answers HTTP 400 `{"code":0,"message":"Transport unknown"}`, and the bare host answers the Cloudflare challenge, P6.
A URL with `EIO=4` gets the same Engine.IO 3 handshake and the same namespace replies, P4.
One socket carries every symbol, because Socket.IO multiplexes namespaces: 627 namespaces were acknowledged on one socket, P5.
`socket.vindax.com` resolved to the same three Cloudflare addresses as `api.vindax.com`, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| namespace | payload | cadence | probed |
|---|---|---|---|
| `/<symbol in lower case>`, as `/btcusdt` | `depthUpdate` diff with `E`, `e`, `s`, `z`, `U`, `u`, `b`, `a` | at most one frame per symbol, `E` steps of at least 1,144 ms and a median of 1,338 to 1,379 ms on BTCUSDT and ETHUSDT | recommended, section 4 |
| `/<symbol>_aggTrade`, as `/btcusdt_aggTrade` | one trade per frame, `eventTime`, `aggTradeId`, `price`, `qty`, `symbol`, `time`, `isBuyerMaker`, `event` | on trade | 9 and 8 frames in 70 s on BTC, P1 |
| `/<symbol>_kline_<interval>`, as `/btcusdt_kline_1m` | `eventType` `kline` with an OHLCV object | on trade | 9 and 8 frames in 70 s on BTC, and `_kline_1h` is acknowledged too, P1 and P4 |
| best bid and ask, 24 h ticker, partial depth, raw trades | none found | | 15 guessed namespaces all answered `Invalid namespace`, section 4 |
| mark, index, funding | none | | spot only |

The trade and kline namespace spellings come from the 2021 client, S4 and S5, and the case matters: `/btcusdt_aggtrade` is refused while `/btcusdt_aggTrade` is served, P4.
The REST calls `ticker/bookTicker`, `ticker/24hr` and `returnTicker` stand in for the missing ticker streams, see [`rest.md`](./rest.md) section 2.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
"Web client" means the archived 2021 client code, S3 to S5, since no documentation exists.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | web client: one namespace per symbol on one host | one host for every quote asset, one namespace per symbol, all multiplexed on one socket, section 1 |
| subscribe frame shape | web client: Socket.IO `io.connect(url + "/" + symbol)` | the text frame `40/btcusdt` per symbol, one namespace per frame. No subscribe event exists: `42/btcusdt,["subscribe",{"symbol":"ETHUSDT"}]` and `42["subscribe","btcusdt"]` got no reply and changed nothing, P4 |
| unknown symbol expectation | Not publicly specified | `44/nopeusdt,"Invalid namespace"`, and the same for upper case `/BTCUSDT`, `/btc_usdt` and the listed but bookless `/dogecubeusdt`, P4 |
| chunk unit and budget | Not publicly specified | 628 namespace frames sent in one burst got 627 acknowledgements and 1 refusal in each of three runs, all answered within 358 and 378 ms in the two runs that timed it, P5 |
| keepalive mechanism | Engine.IO 3: the handshake announces `pingInterval` 25000 and `pingTimeout` 20000, and the client pings | the server sent no ping in 100 s. A client `2` got `3` back in 171 to 200 ms, P1 and P3 |
| connection lifetime and maintenance notice | Not publicly specified | a socket that did not ping closed at 45.9 to 46.1 s with code 1005, subscribed or not, and a pinging socket stayed open for the full 100 s and 55 s runs, P3. No maintenance notice seen |
| handshake and operation rate limits | Not publicly specified | none met with 628 namespaces on one socket, P5 |
| public market data authentication | none | none |
| message parse and routing | web client: Socket.IO `message` event, fields `e`, `E`, `s`, `U`, `u`, `b`, `a`, `z` | Engine.IO type `4`, Socket.IO type `2`, then the namespace, a comma and a JSON array `["message", {...}]`. Route on the namespace or on `s` |
| subscribe acknowledgement shape | Socket.IO connect packet | `40/btcusdt,` with no body. The root namespace answers `40` on open |
| symbol identifier format | web client: the symbol in lower case | namespace `/btcusdt`, frame field `s` `BTCUSDT`, which is the REST `exchangeInfo` spelling. `returnTicker` spells it `BTC_USDT` |
| number representation | Not publicly specified | price as a JSON number, size as a decimal string, and a deleted level's size as the JSON number `0`. Every level carries a third element, an empty array `[]`, P1 |
| timestamp representation | Not publicly specified | `E` in integer Unix ms. The trade and kline frames use `eventTime` and `time` in ms |
| size unit | Not publicly specified | base asset, as `0.00013` BTC, the same unit as the REST book, section 4 |
| sequence semantics | web client: applies a frame when `u` is above the last applied id, and its gap check is commented out, S3 | `U` equals the previous `u` plus 1 on every frame of both book runs, P1, and on 3,724 of 3,727 frames across three batch runs, P5 |
| idle repeat behaviour | Not publicly specified | a quiet book sends nothing, and a thin book repeats the same delete with a new id, section 4 |

## 4. The book channel in detail

The per symbol namespace, as `/btcusdt`, is the only book channel, and every row below is about it.

### Snapshot on subscribe

None.
After `40/btcusdt,` the first frame is a delta, about one frame interval later.
The 2021 client builds the book the way Binance documents it: it buffers the deltas, reads `GET /exchange/depth`, applies the snapshot, then replays the buffered deltas whose id is newer, S3.
The public equivalent is `GET https://api.vindax.com/api/v1/depth?symbol=BTCUSDT&limit=100`, see [`rest.md`](./rest.md) section 5.

That recipe was replayed in P2 on BTCUSDT and ETHUSDT against seven REST snapshots each, taken 2.2 s apart while the socket ran, in two runs.

| check | BTCUSDT | ETHUSDT |
|---|---|---|
| snapshot ids that fall on a frame's `u` or inside its `U` to `u` range, so that a frame straddles `lastUpdateId + 1` | 7 of 7 in each run | 7 of 7 in each run |
| snapshot ids equal to the `u` of some socket frame | 1 of 7, then 1 of 7 | 4 of 7, then 2 of 7 |
| snapshot ids inside a frame's `U` to `u` range | 6 of 7, then 6 of 7 | 3 of 7, then 5 of 7 |
| replay from the first snapshot to a later snapshot whose id is a frame's `u`, levels equal | 78 of 78 bids and 46 of 46 asks, then 64 of 64 and 52 of 52 | 35 of 35 and 35 of 35, 40 of 40 and 45 of 45, 36 of 36 and 54 of 54, then 39 of 39 and 40 of 40, 43 of 43 and 46 of 46 |
| time from the REST reply to the arrival of the first frame covering its id | -1,040 to 1,437 ms, medians 639 and 523 ms | -529 to 1,409 ms, medians 264 and 892 ms |

So the deltas carry absolute sizes, the chain is exact, and a book replayed from REST equals the venue's book at every frame boundary tested.
The REST book advances live while the socket bundles about 1.4 s of ids into one frame, so a snapshot usually lands inside a frame, and the straddling frame has to be applied whole.
In both book runs, P1, the REST snapshot taken 4 s after subscribing was already newer than every buffered frame, on 4 of 4 symbols.
At the end of the second book run, RSRUSDT's REST id equalled the last applied `u`, and all 20 bids and 20 asks matched.

### Delta semantics

A frame carries `U`, the first id, `u`, the last id, and `b` and `a` arrays of `[price, size, []]`.
A size of `0` deletes the level, and any other size replaces it.
The flag `z` was `false` on every frame seen, and the 2021 client treats `z` true as "canceled", applying it without advancing the id, S3.
No frame had both arrays empty in either book run, P1.
Frames that only delete exist: every one of the 19 and 24 SCUSDT frames in the two book runs held only `0` sizes, P1.

### Sequence and gap rule

```text
before the snapshot            buffer the frame
first frame after snapshot L   require U <= L + 1 <= u, apply, last = u
later frame, U = last + 1      apply, last = u
later frame, U != last + 1     gap: resync (terminate, resubscribe, reread REST)
frame with u <= last           stale: drop
```

The first book run chained 52, 52, 41, 18, 25 and 18 frames on BTCUSDT, ETHUSDT, SUIUSDT, RSRUSDT, BIOUSDT and SCUSDT, and the second 52, 53, 34, 18, 9 and 23, with 0 gaps in either, P1.
The batch runs with every symbol on one socket did see gaps, P5.
The first chained 1,199 frames across 88 symbols with 1 gap, which that version of the probe did not detail, the second 1,228 across 95 symbols with 0 gaps, and the third 1,297 across 99 symbols with 2 gaps.
In the third, TRXBTC skipped 2 ids and ASTERUSDT skipped 9, each once.
Whether the server drops frames on a crowded socket or leaves ids unpublished is Not verified, so a feed has to treat every gap as a resync.

### Checksum

None in any frame, and the 2021 client computes none, S3.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| delta | unordered: 39 of 53 BTC frames and 40 of 53 ETH frames had bids out of descending order in the first book run, and 36 of 53 and 36 of 54 in the second, P1 | unordered: 40 of 53 and 41 of 53 had asks out of ascending order, then 34 of 53 and 39 of 54 |
| REST `depth` | descending at every limit, P6 | ascending |

A feed applies deltas by price and never by position.

### Level window

The deltas cover the whole book, not a window.
The BTCUSDT book kept from a 100 level snapshot and the deltas held up to 101 and 106 levels on one side in the two book runs, P1, while the REST call caps at 100 levels, see [`rest.md`](./rest.md) section 5.
Levels beyond the first REST snapshot's 100 appear only once they change, which does not matter for the engine's 20 levels at [`Engine.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/Engine.ts) line 61.

### Size unit

The size is in the base asset.
`BTCUSDT` levels read like `"0.00013"` and `"0.49995"` BTC on both the socket and the REST book, and the replays above matched REST sizes exactly, P1, P2 and P6.
CCXT has no Vindax class, so there is no `contractSize` to compare, and a spot market would need a size multiplier of 1.

### One-sided and empty books

| symbol | REST book | stream in 70 s |
|---|---|---|
| `BFCV2USDT` | 0 bids, 13 asks | acknowledged, 0 frames in both runs, P1 |
| `CZWUSDT` | 0 bids, 0 asks | acknowledged, 0 frames in both runs, P1 |
| `DOGECUBEUSDT` | 0 bids, 0 asks, and `TRADING` in `exchangeInfo` | refused, `Invalid namespace`, P4 and P5 |

Neither the one-sided nor the empty book sent a frame, so what the stream sends when such a book changes is Not verified.
The engine's `resetBook` accepts an empty side.
The REST ticker shows how common thin books are: 363 of 628 symbols had no bid, 48 had no ask, and 25 had neither, see [`rest.md`](./rest.md) section 2.

### Idle repeats

No heartbeat frame exists per namespace, so a quiet book is silent.
The longest gaps in the first 70 s book run were 14.8 s on RSRUSDT, 14.5 s on BIOUSDT and 11.6 s on SCUSDT, and in the second 27.6 s on BIOUSDT and 15.8 s on RSRUSDT, P1.
A thin book can repeat the same content with a new id: RSRUSDT sent 3 and then 1, and SCUSDT 6 in each run, frames identical to the frame before, each deleting the same price again, P1.

### Unknown, closed and malformed requests

| request | reply | then |
|---|---|---|
| `40/nopeusdt` | `44/nopeusdt,"Invalid namespace"` | the socket stays open |
| `40/BTCUSDT`, `40/btc_usdt` | `Invalid namespace` | |
| `40/dogecubeusdt`, a listed symbol with an empty book | `Invalid namespace` | |
| 15 guessed ticker, trade and depth namespaces, listed in the probe | `Invalid namespace` on each | |
| `42/btcusdt,["subscribe",{"symbol":"ETHUSDT"}]` | nothing | the `/btcusdt` deltas continue |
| text that is not a protocol packet, `hello` | none | the server closes the socket at once with code 1005, in both runs |

A closed or delisted symbol with a namespace was not found, since all 628 catalog rows read `TRADING`.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Engine.IO 3, `pingInterval` 25000 and `pingTimeout` 20000 in the handshake | the client sends `2` and the server answers `3` in 171 to 200 ms. The server never pinged, P1 and P3 |
| silence the server tolerates | 45 s without a client ping, from the handshake numbers | two sockets that never pinged, one of them subscribed to a quiet book, closed at 45.9 to 46.1 s with code 1005 and no close frame, in both runs. A socket that pinged every 25 s was open at 100 s and at 55 s, P3 |
| forced disconnect | Not publicly specified | none in 100 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, P4 |
| handshake | | 723 to 1,125 ms to open over both passes. The upgrade answers 101 with `server: cloudflare` |
| subscription limits | Not publicly specified | 628 namespaces on one socket, all answered within 358 and 378 ms, P5 |
| throughput | | every catalog symbol on one socket, three runs: median 36 to 39 frames per second, peak 63, 203 to 215 bytes per frame, 6.2 to 6.9 KB per second, 10 to 17 µs to parse a frame, P5 |

The subscribed socket closed like the idle one, but its quiet book sent no frame, so whether server data alone keeps a socket open is Not verified, and a feed should ping regardless.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays cut to three levels per side.

Engine.IO handshake, then the root namespace connect.

```text
0{"sid":"-0hBfVtCbmuT5xrNAAg4","upgrades":[],"pingInterval":25000,"pingTimeout":20000}
40
```

Subscribe, sent as a Socket.IO connect packet, and its acknowledgement.

```text
40/btcusdt
40/btcusdt,
```

Delta, the first frame after the acknowledgement, three levels per side kept.

```text
42/btcusdt,["message",{"E":1790139787091,"e":"depthUpdate","s":"BTCUSDT","z":false,"U":1133730921,"u":1133730937,"b":[[86969.23,0,[]],[86968.94,0,[]],[86969.33,0,[]]],"a":[[86977.99,0,[]],[86978.11,"0.0002",[]],[86980.72,"0.00056",[]]]}]
```

Delete-only delta of a thin book, repeated with the next id.

```text
42/scusdt,["message",{"E":1790139798045,"e":"depthUpdate","s":"SCUSDT","z":false,"U":10861998,"u":10861998,"b":[[1.0900583,0,[]]],"a":[]}]
42/scusdt,["message",{"E":1790139799428,"e":"depthUpdate","s":"SCUSDT","z":false,"U":10861999,"u":10861999,"b":[[1.0900583,0,[]]],"a":[]}]
```

Trade and kline.

```text
42/btcusdt_aggTrade,["message",{"eventTime":1790139790004,"aggTradeId":"6ab35d8d63c6d61c8441bf06","firstTradeId":"6ab35d8d63c6d61c8441bf06","lastTradeId":"6ab35d8d63c6d61c8441bf06","price":86977.93,"qty":"0.00793","symbol":"BTCUSDT","time":1790139789838,"isBuyerMaker":false,"event":"aggTrade"}]
42/btcusdt_kline_1m,["message",{"eventType":"kline","eventTime":1790139789955,"symbol":"BTCUSDT","kline":{"time":1790139780000,"closeTime":1790139839999,"interval":"1m","open":87001.16,"close":86977.93,"high":87001.16,"low":86977.93,"volume":"0.01413","quoteVolume":"1229.1421769","count":2}}]
```

Keepalive, client ping and server pong.

```text
2
3
```

Error.

```text
44/nopeusdt,"Invalid namespace"
```

## 7. Private channels

Named for a future execution stage, not probed.
The 2020 web client page loaded a `userstream.factory.js` next to the public stream factories, S6.
The live app calls `/bapi/private/exchange/private/startStreamV2`, S2, and the 2019 API document names a `USER_STREAM` security type that needs an API key, S1.
No private namespace name could be read.

## 8. Recommended feed shape

A recommendation for a later spot design, not a decision.
The engine takes perpetuals only, so nothing here is needed today.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://socket.vindax.com/socket.io/?EIO=3&transport=websocket` | one host for every symbol |
| markets per connection | slices of about 100, a guess | 627 namespaces ran on one socket at 36 to 39 frames per second, but those runs saw 3 gaps in 3,727 frames while two 8 namespace runs saw none, so smaller slices limit what one resync costs |
| subscribe frames | one text frame `40/<symbol in lower case>` per market, sent after the `0{...}` handshake | Socket.IO 2 has no batch connect |
| keepalive | send `2` every 20 s | the server closed sockets at about 46 s without a client ping, and a ping every 25 s kept one open |
| `maxSilenceMs` | 30,000 | the pong answers every ping, so a missing pong within one and a half intervals means a dead socket, and a quiet book alone sat silent for up to 27.6 s |
| routing | the namespace between `42/` and the first comma, or `s` in the payload | `s` is the `exchangeInfo` symbol |
| snapshot | none on the socket: buffer frames, read `GET /api/v1/depth?symbol=<SYMBOL>&limit=100`, drop frames with `u <= lastUpdateId`, require the first kept frame to have `U <= lastUpdateId + 1` | the replay matched the REST book on every level at every frame boundary tested |
| delta | apply only when `U === last + 1`, set each level to its size, delete on `0` | the chain held except for 3 gaps in the batch runs |
| resync | on a gap, a first frame with `U > lastUpdateId + 1`, or an `Invalid namespace` reply: `resync`, which terminates the socket and resubscribes, then reread REST | the engine's existing path, and the REST read costs 1 of the 50 counted requests per minute |
| receive time | stamp on arrival | `E` is the server's batch time, and a frame covers about 1.1 to 1.6 s of changes |
| sizes | `Number()` of the string, and `0` is a JSON number | mixed representation |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway, see [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 81 |

The 1.1 to 1.6 s bundling means a change can wait that long before it reaches a Vindax feed, which is slow next to the venues the engine reads today.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | VinDAX API Document, "Last updated: March 1, 2019", Internet Archive capture of 2019-06-07 | https://web.archive.org/web/20190607002214/https://vindax.com/public/common/views/api.html | 2026-09-23 | VinDAX | REST only, `USER_STREAM` type, sections 1 and 7 |
| S2 | Live VinDAX web app bundle chunk | https://vindax.com/_next/static/chunks/1394-d288b9c137b10db7.js | 2026-09-23 | VinDAX | `socket:"wss://socket.vindax.com"`, `startStreamV2`, sections 1 and 7 |
| S3 | VinDAX web client `stream.factory.js`, Internet Archive capture of 2021-09-17 | https://web.archive.org/web/20210917163008/https://www.vindax.com/public/exchange/factory/stream.factory.js | 2026-09-23 | VinDAX | namespace per symbol, websocket only transport, `depthUpdate` fields, REST snapshot and replay, the commented out gap check, `z` as canceled, sections 1 to 4 |
| S4 | VinDAX web client `tradestream.factory.js`, capture of 2021-09-17 | https://web.archive.org/web/20210917170550/https://www.vindax.com/public/exchange/factory/tradestream.factory.js | 2026-09-23 | VinDAX | `/<symbol>_aggTrade`, section 2 |
| S5 | VinDAX web client `klinestream.factory.js`, capture of 2021-09-17 | https://web.archive.org/web/20210917163109/https://www.vindax.com/public/exchange/factory/klinestream.factory.js | 2026-09-23 | VinDAX | `/<symbol>_kline_<interval>`, section 2 |
| S6 | VinDAX `api.html` page shell, Internet Archive capture of 2020-08-12 | https://web.archive.org/web/20200812174128/https://vindax.com/api.html | 2026-09-23 | VinDAX | the script list, with `stream.factory.js`, `tradestream.factory.js`, `klinestream.factory.js`, `mktdatastream.factory.js` and `userstream.factory.js`, section 7 |
| P1 | [`ws-probe.mjs`](../../../scripts/probes/venues/vindax/ws-probe.mjs) `book`, at 05:03 and 05:19 UTC | this host | 2026-09-23 UTC | this host, Canadian exit | sections 2 to 6 |
| P2 | [`ws-probe.mjs`](../../../scripts/probes/venues/vindax/ws-probe.mjs) `align`, at 05:06 and 05:20 UTC | this host | 2026-09-23 UTC | this host, Canadian exit | snapshot recipe, section 4 |
| P3 | [`ws-probe.mjs`](../../../scripts/probes/venues/vindax/ws-probe.mjs) `silence`, 100 s at 05:07 UTC and 55 s at 05:21 UTC | this host | 2026-09-23 UTC | this host, Canadian exit | sections 3 and 5 |
| P4 | [`ws-probe.mjs`](../../../scripts/probes/venues/vindax/ws-probe.mjs) `errors` and `deflate`, at 05:07, 05:12 and 05:21 UTC | this host | 2026-09-23 UTC | this host, Canadian exit | sections 1 to 5 |
| P5 | [`ws-probe.mjs`](../../../scripts/probes/venues/vindax/ws-probe.mjs) `batch`, at 05:09, 05:10 and 05:22 UTC | this host | 2026-09-23 UTC | this host, Canadian exit | sections 3 to 5 |
| P6 | [`rest-probe.mjs`](../../../scripts/probes/venues/vindax/rest-probe.mjs) `book`, and curl of the socket host | this host | 2026-09-23 UTC | this host, Canadian exit | REST level order and sizes, the polling refusal, sections 1 and 4 |
