# Dex-Trade WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:32 to 03:46 UTC in two runs, from the development host near Seattle.

This profile covers the public socket of Dex-Trade for its spot market, because Dex-Trade lists no perpetual, see [`fees.md`](./fees.md) section 3.
The documented client is `socket.io-client`, S1, so the socket speaks Socket.IO over Engine.IO, not plain JSON frames.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/dex-trade/ws-probe.mjs), which speaks the Engine.IO v4 framing by hand over the `ws` package the engine uses.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| product | documented URL | probed |
|---|---|---|
| spot, every pair | `https://socket.dex-trade.com`, "Use socket.io library to connect", S1 | `wss://socket.dex-trade.com/socket.io/?EIO=4&transport=websocket` upgraded with 101 in 507 to 559 ms through Cloudflare on every socket of both runs |
| same, Engine.IO v3 | not documented | `EIO=3` also upgrades, and the server joins the default namespace by itself and sends `40`. A v3 client that also sent `40` was closed at 732 ms, P3, and one that did not stayed open 110 s with 180 book frames, P8 |
| polling transport | the Socket.IO default | the v4 polling handshake answers 200 with `"upgrades":["websocket"]`, and the v3 one prefixes the packet with its length, `118:0{…}`, P9 |

One socket carries every pair, since 46 book rooms and one trade room were all acknowledged on one socket, P2 and P7.
The Engine.IO open packet fixes the session: `"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000`, P2.
`socket.dex-trade.com` resolved to the same three Cloudflare addresses as the REST host, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| room | subscribe event | content | probed on 2026-09-23 UTC |
|---|---|---|---|
| `book_<id>` | `["subscribe", {"type": "book", "event": "book_<id>"}]`, where `<id>` is the pair's `id` in `GET /v1/public/symbols`, S1 | one changed price level per frame, over the whole book | 18 of 46 rooms sent 761 frames in 78 s in P2 and 681 in 76 s in P7, no snapshot on any room |
| `hist_<id>` | `["subscribe", {"type": "hist", "event": "hist_<id>"}]`, S1 | one trade per frame | one trade on `AVDOUSDT` in each run |
| candlestick | `["subscribe", {"type": "graph", "event": "BTCUSD:60:1"}]`, pair name, period and pair id, "On subscription first message you get array of candlesticks ( count 256)", S1 | candles | not probed |
| best bid and ask, ticker, mark, index, funding | none documented | | |

All market data arrives as the Socket.IO event `message`, whatever the room.
No channel carries a best bid and ask, a mark, an index or a funding rate.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one host for everything, S1 | one socket served all 46 pairs and the trade room, section 1 |
| subscribe frame shape | `socket.emit('subscribe', {type: 'book', event: 'book_1'})`, S1 | on the wire `42["subscribe",{"type":"book","event":"book_21811"}]`, one room per frame, sent only after the namespace answer `40{"sid":…}` |
| unknown symbol expectation | Not publicly specified | `book_999999999`, `book_ELGUSDT` and `nope_7951` are each acknowledged as if valid and then send nothing |
| chunk unit and budget | Not publicly specified | 47 subscribe frames in one burst, all acknowledged 165 to 330 ms after the burst in both runs |
| keepalive mechanism | Socket.IO heartbeat, not described, S1 | Engine.IO v4: the server sends `2` every 25 s, at 25.5, 50.7, 75.9 and 101.0 s, and a client that does not answer `3` is closed at 45.5 s, in both runs. Engine.IO v3: the client sends `2` and the server answers `3`, 4 times in 110 s, P8 |
| connection lifetime and maintenance notice | Not publicly specified | no forced close and no notice in 110 s |
| handshake and operation rate limits | Not publicly specified | no refusal at four parallel handshakes or 47 subscribes in one burst |
| public market data authentication | none | none |
| message parse and routing | `{"type": "book", "data": {…}, "room": "book_1"}` inside an array, S1 | strip the `42` prefix, parse `["message", [ {type, data, room} ]]`, route on `room`. Every frame of 761 and of 681 held exactly one element |
| subscribe acknowledgement shape | "you will receive the event subscribe, {room: 'book_X'}", S1 | `42["subscribe",{"room":"book_5531","type":"book"}]`, one per room, echoing the request |
| symbol identifier format | numeric pair id in the room name | `book_<id>`: the room names the `id`, not the pair, so a feed maps `id` to `pair` from `GET /v1/public/symbols` |
| number representation | integers scaled by `10^rate_decimal`, `10^base_decimal` and `10^quote_decimal`, S1 | JSON integers, and the level key is the scaled rate as a string: `"163997000000"` is 1,639.97 USDT at `rate_decimal` 8 |
| timestamp representation | not documented on the book | each set level carries `time` in Unix ms. The unsubscribe reply and the trade frame carry none, or `time_create` in seconds |
| size unit | base currency, scaled by `10^base_decimal`, S1 | base currency: the local book built from the REST book and these deltas equalled the REST book on every level of 5 pairs in each of two runs, section 4 |
| sequence semantics | "If sequenceId(New)<>sequenceId(Old)+1 then need reload order book", S1 | per room `sequenceId` rises by exactly 1 per frame, with 0 gaps, 0 repeats and 0 reversals in 761 and 681 frames over 18 rooms per run |
| idle repeat behaviour | not documented | nothing is repeated. A quiet room sends nothing at all, and 28 of 46 rooms sent no frame in either run of 76 to 78 s |

## 4. The book channel in detail

### Snapshot on subscribe

There is none.
The acknowledgement comes 165 to 330 ms after the subscribe, and the first book frame for a room is simply the next change on that pair.
The documentation says the subscription "only gives a change in the book", S1.
The snapshot is the REST book `GET /v1/public/book?pair=<pair>`, which returns every level and a `sequenceId` on the same counter as the socket, see [`rest.md`](./rest.md) section 5.

### Delta semantics

A frame carries one side, `buy` or `sell`, holding one level keyed by its scaled rate.
A level with fields is the new total at that price: `{"volume", "count", "rate", "time", "price"}`, where `volume` is the base size, `count` the number of orders, and `price` the quote value `volume × rate`.
A level with no fields, `{}`, deletes that price.
The probe saw 385 set levels and 322 deletions in 78 s in P2, and 370 and 257 in 76 s in P7.
It saw no frame with two levels, no frame with both sides, and no set level whose `price` differed from `volume × rate` after scaling.

### Sequence and gap rule

```text
before the REST snapshot   buffer the room's frames
REST snapshot arrives      book = snapshot, last = snapshot.sequenceId
frame, sequenceId <= last  drop it, the snapshot already holds it
frame, sequenceId = last + 1   apply, last = sequenceId
frame, sequenceId > last + 1   gap: reload the REST book, as the documentation says
```

On 5 busy pairs the probe took the REST snapshot after the subscribe, applied the buffered and later frames by this rule, and read the REST book again at the end.
On a gap it counted the gap and applied the frame anyway, instead of reloading, so that the end comparison would show any damage.
All 10 local books over two runs equalled the final REST book on every level at the same `sequenceId`.
In P2 that was 161 levels on `AVDOUSDT`, 69 on `BIMUSDT`, 57 on `DRCUSDT`, 42 on `USDiUSDT` and 103 on `VRTUSDC`, and in P7 157, 115, 58, 42 and 103.
One buffered frame on `USDiUSDT` in P2 carried a `sequenceId` the snapshot already held and was dropped.

In each run one of the five snapshots came back with a `sequenceId` behind frames the socket had already delivered.
On `BIMUSDT` in P2 the first frame after the snapshot was the snapshot's `sequenceId` plus 3, and no frame had been buffered during the REST call, so the two between them had arrived before the call left.
On `DRCUSDT` in P7 the socket's last `sequenceId` was the snapshot's plus 1 when the REST call left, and the first frame after the snapshot was its plus 2.
The probe never applied those earlier frames, and both rebuilt books still equalled the final REST book.
So the REST reply most likely already held those changes under an older `sequenceId`, which is an inference, since a later frame may also have overwritten the skipped levels.
A feed should answer a first frame beyond the snapshot's `sequenceId` plus 1 by reading the REST book again, as it would for any gap, rather than by dropping the socket.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

A socket frame holds one level, so it has no order.
The REST book lists `buy` best first, descending, and `sell` best first, ascending, on 46 of 46 pairs, see [`rest.md`](./rest.md) section 5.

### Level window

There is no window.
The socket reports changes anywhere in the book, and the local books above held 106 to 109 bids on `AVDOUSDT` and up to 70 asks on `BIMUSDT`, matching the full REST book level for level.
The engine keeps 20 levels per side, at [`Engine.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/Engine.ts) line 61, so a feed trims the full book it maintains.

### Size unit against CCXT `contractSize`

CCXT has no Dex-Trade class, see [`fees.md`](./fees.md) section 8, so there is no `contractSize` to compare.
The socket size is base currency times `10^base_decimal`.
On `AVDOUSDT`, with `base_decimal` 8, the level `"volume":8500000` is 0.085 AVDO.
`base_decimal` varies by pair, from 0 on `FRTCUSDT` and `RtimeUSDT` to 8 on 38 pairs, see [`rest.md`](./rest.md) section 2, so the divisor has to come from the catalog per pair.

### One-sided and empty books

The socket sends nothing for a side with no orders, so a one-sided or empty book is seen only in the REST snapshot.
`ETNUSDT` had 43 or 42 bids and 0 asks, `AXYCSOL` and `AXYCBNB` 1 bid and 0 asks, and `GGLDUSDT` and `HTNUSDT` were empty, in the REST sweeps of P1, P5 and P6.

### Idle repeats

Nothing is repeated.
The busiest room, `BIMUSDT`, sent 152 and 150 frames in the two runs, and its longest silence was 15 and 13 s.
Counting from the subscribe, `PUPIUSDT` and `VEUSDT` went 70 and 67 s without a frame in P2, and `SUSDTUSDT` and `DMDETH` 74 s in P7.
28 rooms sent nothing in either run, so silence on a room says nothing about the socket.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `{"type":"book","event":"book_999999999"}` | `42["subscribe",{"room":"book_999999999","type":"book"}]` | nothing |
| `{"type":"book","event":"book_ELGUSDT"}` | `42["subscribe",{"room":"book_ELGUSDT","type":"book"}]` | nothing |
| `{"type":"nope","event":"nope_7951"}` | `42["subscribe",{"room":"nope_7951","type":"nope"}]` | nothing |
| the string `"book_7951"` as payload | `42["subscribe",{"room":"book_7951"}]` | not checked |
| the same room twice | two acknowledgements | not checked for doubled frames |
| `["unsubscribe", "book_7951"]` | `42["message",{"type":"unsubscribe","room":"book_7951"}]` | |
| an unknown event `["nope", {"a":1}]` | nothing | the socket stays open |
| the text `hello`, which is not an Engine.IO packet | the server closes the socket, code 1005, 175 ms later in P2 and 174 ms in P7 | |

Because every room is acknowledged, a feed has to notice a room that never delivers on its own, and a quiet pair looks the same as an unknown one.
The documentation says the unsubscribe answer is an `unsubscribe` event, S1, and the wire sends it as a `message` event with `"type":"unsubscribe"`.
A closed pair was not available to probe on the socket, since the two status 3 pairs of the site ticker have no id in `GET /v1/public/symbols`.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Socket.IO heartbeat, S1 | Engine.IO v4 server ping `2` every 25 s, answered with `3` |
| silence the server tolerates | `pingInterval` 25,000 and `pingTimeout` 20,000 in the open packet | a joined, subscribed socket that did not answer the ping was closed at 45.5 s. A socket that answered pings but never sent `40` was closed at 45.5 s too, so the namespace join has its own timeout of about 45 s. A socket that answered and was subscribed stayed open for the full 110 s. All three held in both runs, P3 and P8 |
| forced disconnect | Not publicly specified | none in 110 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, P4 and P9 |
| handshake | | 507 to 559 ms to open from this host |
| subscription limits | Not publicly specified | 46 book rooms and 1 trade room on one socket, the whole catalog |
| throughput | | all 46 pairs: 9.73 frames per second, 1,410 bytes per second, 145 bytes per frame and 17.2 µs of `JSON.parse` per frame in P2, and 8.93, 1,316, 147 and 21.5 µs in P7 |
| update age | | arrival minus the level's `time`: min 83, median 85, p90 95, max 146 ms over 385 set levels in P2, and min 79, median 81, p90 88, max 127 ms over 370 in P7, with the clock offset 0 to 5 ms, see [`rest.md`](./rest.md) section 7 |

The engine answers nothing by itself, so a feed must reply `3` to every `2` inside 20 s or lose the socket at 45 s.

## 6. Captured frames

From the probe runs of 2026-09-23 UTC.

Engine.IO open packet, then the namespace answer to the client's `40`.

```text
0{"sid":"0GF2gwfz52DHXf_sHkW5","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
40{"sid":"ohrJpnVvWGFrce3VHkW6"}
```

Subscribe and its acknowledgement.

```text
42["subscribe",{"type":"book","event":"book_5531"}]
42["subscribe",{"room":"book_5531","type":"book"}]
```

A set level on `USDiUSDT`, `rate_decimal` 8 and `base_decimal` 8: 88.06 USDi at 1.0187 USDT, worth 89.70672 USDT.

```json
["message",[{"type":"book","data":{"sell":{"101870000":{"volume":8806000000,"count":1,"rate":101870000,"time":1790134350836,"price":8970672200}},"sequenceId":7552309},"room":"book_23243"}]]
```

A set level on `AVDOUSDT`, the bid side.

```json
["message",[{"type":"book","data":{"buy":{"163997000000":{"volume":8500000,"count":1,"rate":163997000000,"time":1790134350924,"price":13939745000}},"sequenceId":7534569},"room":"book_21811"}]]
```

A deletion on `VRTUSDC`.

```json
["message",[{"type":"book","data":{"sell":{"1080270000":{}},"sequenceId":7718190},"room":"book_23083"}]]
```

A trade on the `hist` room.

```json
["message",[{"type":"hist","data":{"rate":163977000000,"volume":24720000,"type":0,"price":40535114400,"time_create":1790134384,"pair_id":21811},"room":"hist_21811"}]]
```

Keepalive, server first.

```text
2
3
```

The unsubscribe answer.

```json
["message",{"type":"unsubscribe","room":"book_7951"}]
```

The JSON blocks above drop the `42` packet prefix, which precedes each of them on the wire.
No error frame exists: a bad request is acknowledged, ignored, or answered by closing the socket, section 4.

## 7. Private channels

The documentation lists no private socket channel, S1.
Orders, balances and history are REST calls under `/v1/private/`, signed with a token, S1, and were not called.

## 8. Recommended feed shape

A recommendation for a later spot design, not a decision.
The engine's feed base class does not fit this socket without a change, because it sends each subscribe frame as `JSON.stringify(frame)` on open, at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) lines 117 to 165, while Socket.IO needs the text `40` first and then `42`-prefixed events after the namespace answers.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket, `wss://socket.dex-trade.com/socket.io/?EIO=4&transport=websocket` | one socket served the whole catalog |
| markets per connection | all 46 | 47 rooms on one socket, 8.93 to 9.73 frames per second in total |
| handshake | on `0…`, send `40`. On `40{…}`, send one `42["subscribe",{"type":"book","event":"book_<id>"}]` per pair | the namespace must be joined first, and a socket that does not join is closed at 45 s |
| subscribe frames | raw text, so `getSubscribeFrames` returns nothing and `handleMessage` sends the frames itself, or the base class gains a raw text path | `JSON.stringify` of an object cannot produce `42[…]` |
| keepalive | answer every `2` with `3` from `handleMessage`, and `startKeepalive` does nothing | the server pings and closes a silent client at 45 s |
| `maxSilenceMs` | 60,000 | the server ping every 25 s is traffic on even the quietest socket, so 60 s is two missed pings |
| routing | `room` to `id` to `pair` from `GET /v1/public/symbols`, with `pair` as `rawMarketId` | the room names the numeric id |
| snapshot | after the acknowledgement, `GET /v1/public/book?pair=<pair>` per pair, buffering frames until it lands, and read again when the first buffered frame is beyond its `sequenceId` plus 1 | the socket sends no snapshot, and the REST reply trailed the socket once per run |
| delta | drop `sequenceId <= last`, apply `last + 1`, set on fields and delete on `{}` | 10 of 10 rebuilt books equalled REST |
| resync | on `sequenceId > last + 1`, reload that pair's REST book. The engine's `resync` terminates the socket, at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) lines 296 to 315, which would also need a new REST snapshot for every pair | the documented rule is a reload, and a reconnect alone restores nothing |
| unserved room | log a pair with no REST book or an empty one | every room is acknowledged, and 28 quiet pairs sent nothing for more than a minute |
| sizes and prices | `rate / 10^rate_decimal`, `volume / 10^base_decimal`, per pair | integers scaled per pair |
| receive time | stamp on arrival | the level `time` ran 79 to 146 ms before arrival |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Dex-Trade API, apidoc 1.1.7, Socket API group: Socket Order Book, Socket Trade History, Socket updates candlestick, Unsubscribe | https://docs.dex-trade.com/ | 2026-09-22 | Dex-Trade, global | host, subscribe events, scaled integers, sequence rule, sections 1 to 7 |
| P1 | `rest-probe.mjs all`, 03:29 to 03:31 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/dex-trade/rest-probe.mjs) | 2026-09-23 UTC | this host | one-sided and empty books, section 4 |
| P2 | `ws-probe.mjs book`, 03:32 to 03:33 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/dex-trade/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6 |
| P3 | `ws-probe.mjs silence`, 03:34 to 03:35 UTC, whose v3 socket also sent `40` | [`ws-probe.mjs`](../../../scripts/probes/venues/dex-trade/ws-probe.mjs) | 2026-09-23 UTC | this host | keepalive and silence, sections 1, 3 and 5 |
| P4 | `ws-probe.mjs deflate`, 03:35 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/dex-trade/ws-probe.mjs) | 2026-09-23 UTC | this host | compression, section 5 |
| P5 | `rest-probe.mjs all`, second pass, 03:41 to 03:42 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/dex-trade/rest-probe.mjs) | 2026-09-23 UTC | this host | one-sided and empty books, section 4 |
| P6 | `rest-probe.mjs main`, 03:46 to 03:47 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/dex-trade/rest-probe.mjs) | 2026-09-23 UTC | this host | one-sided and empty books, section 4 |
| P7 | `ws-probe.mjs book`, second pass, 03:42 to 03:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/dex-trade/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 5, the second readings and the REST lag on `DRCUSDT` |
| P8 | `ws-probe.mjs silence`, second pass, 03:44 to 03:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/dex-trade/ws-probe.mjs) | 2026-09-23 UTC | this host | keepalive, silence and the v3 client, sections 1, 3 and 5 |
| P9 | `ws-probe.mjs deflate`, second pass, 03:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/dex-trade/ws-probe.mjs) | 2026-09-23 UTC | this host | compression and the polling handshake, sections 1 and 5 |
