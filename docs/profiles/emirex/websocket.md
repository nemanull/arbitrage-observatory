# Emirex WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 04:30 and 04:46 UTC on 2026-09-23, through the laptop's Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public socket of Emirex (no CCXT class) on its spot market, since Emirex lists no perpetual, see [`fees.md`](./fees.md) section 3.
The socket is a socket.io server, Engine.IO protocol 4, and the documentation tells clients to use the socket.io library, S1.
[`ws-probe.mjs`](../../../scripts/probes/venues/emirex/ws-probe.mjs) speaks that protocol with raw `ws` text frames and `perMessageDeflate: false`, and every probed value below comes from it.

## 1. Endpoints

| product | documented URL | probed |
|---|---|---|
| spot, public market data | `https://socket.emirex.com`, "Use socket.io library to connect", S1 | `wss://socket.emirex.com/socket.io/?EIO=4&transport=websocket` answered 101 through Cloudflare, open in 677 ms, and 715 ms in the rerun |
| same, Engine.IO 3 | not documented | the polling handshake `GET /socket.io/?EIO=3&transport=polling` answered 200 with a length prefixed open packet, so the server also accepts version 3 clients. Not probed over a socket |

One socket carries every pair.
No perpetual endpoint exists.
The web app opens three socket.io clients to the same URL, named `chart`, `trade` and `user`, in its bundle `app/9dd9fd6c.cb1cb22.js`, S2.

## 2. Channel matrix for public market data

A subscription is a socket.io event `subscribe` with `{type, event}`, where `event` is the room name, S1.

| room | payload | depth and speed | probed on 2026-09-23 |
|---|---|---|---|
| `book_<id>` | `{"type":"book","event":"book_261"}` | every level change, whole book, one level per message | deltas only, no snapshot, recommended with a REST seed |
| `hist_<id>` | `{"type":"hist","event":"hist_261"}` | every trade | 6 trades on `BTCUSDC` in 60 s, and 5 in the rerun |
| `<PAIR>:<period>:<id>` | `{"type":"graph","event":"BTCUSDC:60:1"}` | candles, 256 on subscribe, S1 | not probed |

No best bid and ask, ticker, mark, index or funding channel exists.
The REST candle call `https://socket.emirex.com/graph/hist` and the trade list `https://socket.emirex.com/book/hist/?pair_id=261` also answer on the socket host, with 1e-8 integers like the socket, P7.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one socket.io host, S1 | one socket served all 12 pairs and a trade room |
| subscribe frame shape | `socket.emit('subscribe', {type: 'book', event: 'book_1'})`, S1 | on the wire `42["subscribe",{"type":"book","event":"book_261"}]`, one room per frame, after the namespace `40` |
| unknown symbol expectation | Not publicly specified | `book_999999`, `book_BTCUSDC` and `nope_1` are each acknowledged like a real room and then send nothing |
| chunk unit and budget | Not publicly specified | 13 subscribe frames sent in one burst, 13 acknowledgements 187 to 191 ms later, and 170 ms in the rerun |
| keepalive mechanism | Engine.IO: the server sends ping `2` every `pingInterval`, the client answers `3` within `pingTimeout`, S3 | handshake `pingInterval` 25000 and `pingTimeout` 20000. Pings arrived at 25.7 s and 50.8 s, and at 25.8 s and 51.0 s in the rerun |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 60 s, no notice seen |
| handshake and operation rate limits | Not publicly specified | none met |
| public market data authentication | none, S1 | none |
| message parse and routing | `{type, data, room}` inside a `message` event, S1 | `42["message",[{"type":"book","data":{…},"room":"book_261"}]]`, route on `room`. The array held one message in every one of the 475 book frames, and of the 464 in the rerun |
| subscribe acknowledgement shape | `subscribe` event with `{room: 'book_X'}`, S1 | `42["subscribe",{"room":"book_261","type":"book"}]` |
| symbol identifier format | numeric pair id in the room name, S1 | `book_261` for `BTCUSDC`. The id comes from `GET /v1/public/symbols`, see [`rest.md`](./rest.md) section 2 |
| number representation | rate, volume and price as integers to divide by 10 to the 8th, S1 | integers of 1e-8, `"rate":8723380000000` is 87,233.80. The REST book sends plain decimals |
| timestamp representation | not documented for the book | `time` in Unix ms on each level, 97 to 172 ms before arrival here, and 96 to 175 ms in the rerun |
| size unit | "total volume at a given price", S1 | base currency in 1e-8, the absolute level size, section 4 |
| sequence semantics | not documented | `sequenceId` per room, exactly one more than the previous message, 0 gaps in 475 book messages over 60 s, and in 464 in the rerun |
| idle repeat behaviour | not documented | none. `USDCUSDT` sent nothing in 60 s |

## 4. The book channel in detail

### Snapshot on subscribe

None.
After the acknowledgement a room sends only level changes, the first after 237 ms to 5.2 s depending on the pair, and after 1.3 to 9.0 s in the rerun, P3.
The web app's order book store has a `fetchOrdersBook` action that fills its bid and ask lists, and a socket action that merges each message into those lists, S2.
The REST book carries the same `sequenceId` counter as the room, see [`rest.md`](./rest.md) section 5, so a REST read seeds the book exactly.

In the probe, the REST base for `BTCUSDC` had `sequenceId` 5,718,153 while the first buffered socket message had 5,718,149, so the first 5 buffered messages were already in the REST book and were dropped, P3.
The rerun dropped 5 on `BTCUSDC` and 1 on `ALGOUSDC` the same way.
After 55 s of applying every later message, the local book of `BTCUSDC`, `ETHUSDC` and `ALGOUSDC` equalled a fresh REST read at the same `sequenceId` in both runs, P3.
The first run compared every price of all 119 and 76, 112 and 65, and 54 and 59 bid and ask levels, and the sizes of the top 20 per side.
The rerun compared every price and every size of all 77 and 85, 93 and 72, and 50 and 58 levels, with 0 mismatches.

### Delta semantics

Each message carries one side, `buy` or `sell`, holding one object keyed by the integer rate.
A level with fields `{volume, count, rate, time, price}` replaces that level, where `volume` is the absolute size in base currency and `price` is `rate` times `volume`, both in 1e-8.
An empty object `{}` deletes the level.
The REST comparison above holds only if `volume` is the absolute size, which it did on every level.

### Sequence and gap rule

```text
seed          REST /v1/public/book, last = data.sequenceId
message       sequenceId <= last: already in the book, drop
message       sequenceId = last + 1: apply, last = sequenceId
message       sequenceId > last + 1: gap, reseed from REST
```

The rule held on every message: across 475 book messages in 11 active rooms, all 464 steps between consecutive messages of a room were exactly one, and all 453 steps among 464 messages in the rerun, P3.
The counter is per pair: `BTCUSDC` was near 5.72 million and `USDCUSDT` near 0.34 million at the same time.

### Checksum

None documented, and no message carries one.

### Level order on the wire

Not applicable to deltas, since a message holds one level.
The REST seed sends bids descending and asks ascending, see [`rest.md`](./rest.md) section 5.

### Level window

None.
The room reports changes anywhere in the book, and the REST book holds the whole book, 119 bids on `BTCUSDC` down to 0.29 times the price.
A feed keeps every level and cuts the top 20 per side when it publishes.

### Size unit against CCXT `contractSize`

CCXT has no Emirex class, so there is no `contractSize`.
The unit is base currency in 1e-8 on the socket and plain base currency on REST, and the two matched on every compared level after dividing by 1e8.

### One-sided and empty books

`USDCUSDT` sent no book message in 60 s, so its book stays whatever the REST seed held, 15 bids and 20 asks in [`rest.md`](./rest.md) section 5.
No one-sided book was seen.

### Idle repeats

None.
Rooms change in bursts: the longest silence per room over 60 s was 2.2 s on `BTCUSDC`, 5.0 to 5.2 s on the other ten active pairs, and the whole run on `USDCUSDT`, in both runs, P3.

### Unknown, closed and wrong requests

| request | reply | then |
|---|---|---|
| `{"type":"book","event":"book_999999"}` | `42["subscribe",{"room":"book_999999","type":"book"}]` | nothing |
| `{"type":"book","event":"book_BTCUSDC"}` | acknowledged the same way | nothing |
| `{"type":"nope","event":"nope_1"}` | acknowledged the same way | nothing |
| `{"type":"book"}` without `event` | no reply | nothing |
| the string `"book_261"` as the payload | `42["subscribe",{"room":"book_261"}]`, no `type` | the room delivers |
| `book_261` subscribed twice more | acknowledged each time | no message delivered twice, 18 and 19 messages with distinct `sequenceId` in the two runs |
| `42["unsubscribe","book_261"]` | `42["message",{"type":"unsubscribe","room":"book_261"}]`, a `message` event whose payload is an object, not an array | 0 messages afterwards |
| an unknown event `42["nope",{"a":1}]` | no reply | the socket stays open |
| text `hello`, not a socket.io packet | the server closed the socket 177 and 178 ms later, code 1005 | |

A closed or delisted pair was not available to probe.
Because every room name is acknowledged, a feed has to notice a room that never delivers on its own, and a room as quiet as `USDCUSDT` makes that check slow.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Engine.IO ping from the server, S3 | `2` every 25 s, answered with `3` |
| silence the server tolerates | `pingInterval` 25000 plus `pingTimeout` 20000 in the handshake | a subscribed socket that never answered the ping closed at 45.7 s, 20 s after the first ping, code 1005. A socket that answered pings but never sent the namespace `40` closed at 45.8 s, code 1005. The rerun closed both at 45.7 s |
| forced disconnect | Not publicly specified | none in 60 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | Engine.IO open packet carrying `sid`, `upgrades`, `pingInterval`, `pingTimeout` and `maxPayload`, S3 | socket open in 677 and 715 ms, namespace `40{"sid":…}` 184 and 168 ms after the open packet |
| subscription limits | Not publicly specified | none met at 13 rooms |
| throughput | | all 12 book rooms and one trade room: 495 frames in 59 s, 8.4 frames per second, 1,257 bytes per second, 150 bytes per frame, 4.6 µs `JSON.parse` per frame. The rerun: 483 frames, 8.2 per second, 1,189 bytes per second, 144 bytes per frame, 3.0 µs |

## 6. Captured frames

Whole frames, from the probe runs of 2026-09-23.

Open packet from the server, the namespace connect `40` from the client, and the server's answer.

```text
0{"sid":"gV6xF2gCu8lGQ06IAEOT","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
40
40{"sid":"Oeuu7woDiNAtK7XNAEOU"}
```

Subscribe and acknowledgement.

```text
42["subscribe",{"type":"book","event":"book_261"}]
42["subscribe",{"room":"book_261","type":"book"}]
```

A level change, 0.03009 BTC at 87,233.80 USDC, and a delete on `LTCUSDC`.

```text
42["message",[{"type":"book","data":{"buy":{"8723380000000":{"volume":3009000,"count":1,"rate":8723380000000,"time":1790138083616,"price":262486504200}},"sequenceId":5718149},"room":"book_261"}]]
42["message",[{"type":"book","data":{"buy":{"6315810000":{}},"sequenceId":2790930},"room":"book_841"}]]
```

A trade, 0.0001 BTC.

```text
42["message",[{"type":"hist","data":{"rate":8725599000000,"volume":10000,"type":1,"price":872559900,"time_create":1790138095,"pair_id":261},"room":"hist_261"}]]
```

Keepalive, server then client.

```text
2
3
```

Unsubscribe reply.

```text
42["message",{"type":"unsubscribe","room":"book_261"}]
```

## 7. Private channels

Named for a future execution stage, not probed.
The documentation lists no private socket room, S1.
The web app's `user` socket feeds the store action `order/addSocketData`, S2, and the private REST calls are `/v1/private/create-order`, `/v1/private/delete-order`, `/v1/private/orders`, `/v1/private/get-order`, `/v1/private/history` and `/v1/private/balances`, all POST, S1.

## 8. Recommended feed shape

A recommendation for a later design, not a decision, and only if a spot stage is ever built, since Emirex has no perpetual.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket, `wss://socket.emirex.com/socket.io/?EIO=4&transport=websocket` | 12 pairs at 8.4 frames per second |
| handshake | send the text `40` after the open packet, then the subscribes | socket.io needs the namespace joined, and a socket that never joins is closed at 45 s |
| subscribe frames | one text frame per pair, `42["subscribe",{"type":"book","event":"book_<id>"}]` | the documented shape |
| seed | after the acknowledgement, `GET /v1/public/book?pair=<pair>` and drop buffered messages whose `sequenceId` is at or below the seed's | no snapshot on subscribe, and the counters are shared |
| keepalive | answer every `2` with `3` | the server closes a socket 20 s after an unanswered ping |
| `maxSilenceMs` | 60,000 | a quiet pair sends nothing for a minute, and the server ping every 25 s is the traffic that proves the socket alive |
| routing | `room`, with the pair id mapped back to the pair name | the room carries only the numeric id |
| sizes and prices | divide `rate` and `volume` by 1e8 | integers of 1e-8 |
| resync | a `sequenceId` above last plus one: reseed from REST, or terminate and resubscribe | per room counter, 0 gaps seen |
| unserved room | log a room with no message and no REST seed | unknown rooms are acknowledged |
| receive time | stamp on arrival | `time` is set per level by the server |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |

The engine's `VenueFeed` sends every subscribe frame through `JSON.stringify`, at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) lines 143, 152 and 161, so it cannot send the text packets `40`, `42[…]` and `3` as they are.
Its `resync` terminates and resubscribes without a REST read, so a seed step would also be new.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Emirex Exchange API, apidoc 0.22.0, generated 2022-04-14, sections Socket_API and Private_API | https://docs.emirex.com/ (data in `api_project.js` and `api_data.js`) | 2026-09-22 | Emirex | socket host, room names, payloads, integer scale, unsubscribe, private calls, sections 1 to 7 |
| S2 | Emirex web app bundles | https://emirex.com/trading/BTCUSDC and its `/_nuxt/` scripts, `app/9dd9fd6c.cb1cb22.js` and `app/42dbef79.60b94eb.js` | 2026-09-22 | Emirex | three socket.io clients, REST book then socket updates, sections 1, 4 and 7 |
| S3 | Engine.IO protocol, version 4, README | https://github.com/socketio/engine.io-protocol | 2026-09-22 | socket.io project | packet types 0 open, 2 ping, 3 pong, 4 message, and the heartbeat rule that the client answers within `pingTimeout`, sections 3 and 5 |
| P3 | `ws-probe.mjs book` at 04:34 UTC, rerun at 04:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/emirex/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 6 |
| P4 | `ws-probe.mjs errors` at 04:36 UTC, rerun at 04:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/emirex/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 4, unknown and wrong requests |
| P5 | `ws-probe.mjs silence` at 04:37 UTC, rerun at 04:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/emirex/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 5 |
| P6 | `ws-probe.mjs deflate` at 04:34 UTC, rerun at 04:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/emirex/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 5 |
| P7 | curl of the socket host's REST calls and of the Engine.IO 3 polling handshake at 04:30 and 04:39 UTC | `https://socket.emirex.com/graph/hist` and `https://socket.emirex.com/book/hist/` | 2026-09-22 | this host, Canadian VPN exit | sections 1 and 2 |
