# Bitspay WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:19 to 03:37 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

This profile covers the public socket of Bitspay (no CCXT id), on its spot market, since Bitspay lists no perpetuals, see [`fees.md`](./fees.md) section 3.
Bitspay documents no socket, and its own `info` call says `"tradesSocket":false` and `"ordersSocket":false`, P1.
The only socket is the one the web app uses, `socket.bitspay.io`, found in the web bundle S2 and read by [`ws-probe.py`](../../../scripts/probes/venues/bitspay/ws-probe.py), P2.
It carries no book data.
It pushes a 44 byte notice that a pair's orders changed, and the web app then refetches the book over REST.
Sockets were held for about ten minutes in total over three runs of P2, two exploratory runs and the second pass.
Source ids are shared with [`fees.md`](./fees.md) and [`rest.md`](./rest.md).

## 1. Endpoints

| item | value | source |
|---|---|---|
| URL | `wss://socket.bitspay.io/socket.io/?EIO=3&transport=websocket` | S2, P2 |
| protocol | socket.io 2, the bundle ships `socket.io-client` version 2.1.2 | S2 |
| families | one socket for every spot pair, joined by room | P2 |
| bare `wss://socket.bitspay.io/` | no upgrade, the opening handshake timed out in all three runs | P2 |
| `GET https://socket.bitspay.io/` | 200 `{"status":1,"message":"success"}` | P2 |
| polling handshake | `GET /socket.io/?EIO=3&transport=polling` answers 200 `97:0{"sid":"…","upgrades":["websocket"],"pingInterval":25000,"pingTimeout":20000}2:40` | P2 |
| `EIO=4` | the polling reply still uses the version 3 length prefix framing, and the socket answers a `40` connect with `40` | P2 |

## 2. Channel matrix for public market data

| channel | present | how it was established |
|---|---|---|
| order book, any depth | no | the only server event seen is `refreshorders`, which carries two numeric ids and no levels, P2 |
| best bid and ask | no | no such event in the bundle or on the wire, S2, P2 |
| trades | no for an anonymous client | `tradedata` exists in the bundle, and an anonymous `sendTradedata` drew no reply in all three runs, P2 |
| ticker | no | no such event, S2 |
| mark, index, funding | no | no perpetuals, see [`fees.md`](./fees.md) section 3 |

The server events the bundle listens for are `refreshorders`, `tradedata`, `orderdata`, `changetrade`, `socketrefresh`, `analyticsrefresh`, `myprofile`, `errormessage` and `heartbeat`, S2.
The client events it emits are `setmycombinations`, `sendTradedata`, `senddata`, `sendmyprofile`, `addorder`, `deleteorder` and `triggerchange`, S2.
`sendTradedata`, `senddata`, `addorder` and `deleteorder` attach `authid` and `accesstoken` from local storage, and so does one of the two `setmycombinations` callers, S2.
P2 sent only `setmycombinations`, `sendTradedata` and `senddata`, with null credentials, and never an order event.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is empty in substance, because no socket is documented.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | none documented | one socket for all pairs, a room per pair |
| subscribe frame shape | none documented | `42["setmycombinations",{"myordercombination":"BTC_USDT"}]` joins the pair's room, as the web app does |
| unknown symbol expectation | none documented | not probed, since a known pair already yields no book |
| chunk unit and budget | none documented | not reached, one room per run |
| keepalive mechanism | Engine.IO 3, `pingInterval` 25,000 ms and `pingTimeout` 20,000 ms from the open packet | client `2`, server `3` in 144 to 171 ms across all three runs, and the server never pinged |
| connection lifetime and maintenance notice | none documented | no forced close in sessions of up to 151 s, no notice seen |
| handshake and operation rate limits | Not publicly specified | not reached, three sockets per run in sequence |
| public market data authentication | none documented | none needed to join a room, and the anonymous trade requests got no reply |
| message parse and routing | socket.io event frames `42[event, payload]` | routes on the event name, and `refreshorders` carries `{"market":10,"vendor":2}` for `BTC_USDT` |
| subscribe acknowledgement shape | none documented | none, the join is silent |
| symbol identifier format | `BTC_USDT` in the join | the notice uses internal numeric ids, `vendor` 2 for BTC and `market` 10 for USDT, not the REST symbol |
| number representation | none documented | integers in the notice only |
| timestamp representation | none documented | no timestamp in any frame |
| size unit | none documented | not applicable, no sizes |
| sequence semantics | none documented | none |
| idle repeat behaviour | none documented | every notice for a pair is byte identical, `42["refreshorders",{"market":10,"vendor":2}]` |

## 4. The book channel in detail

There is no book channel.
The rest of this section records what the notice does, since a poller could use it as a trigger.

### Snapshot on subscribe

None.
Joining the room sends nothing back, P2.

### Delta semantics

None.
In the web app, a `refreshorders` whose ids match the open pair calls `getinitailinformation`, which refetches the pair's pending orders and trades over REST, among them `GET https://api.bitspay.io/tradeswebsite/{pair}`, S2.

### Sequence and gap rule

None.
A missed notice cannot be detected.

### Checksum

None.

### Level order on the wire

Not applicable.
The REST book is in [`rest.md`](./rest.md) section 5.

### Cadence

In the second run, joined to `BTC_USDT`, 11 notices arrived in 120 s, gaps 5.77 to 20.38 s with a median of 10.25 s, P2.
In the same run a socket joined to no room received nothing in 60 s, so the notice follows the room and is not a broadcast, P2.
In the second pass, 03:33 to 03:37 UTC, no notice arrived in 75 s joined, 30 s with the trade requests, or 45 s unjoined, P2.
The REST trade list shows the last `BTC_USDT` trade at 03:24:54 UTC and the REST book did not change from 03:27 to 03:33 UTC, see [`rest.md`](./rest.md) section 4, so the notice stops when the pair is idle.

### Size unit against `contractSize`

Not applicable, no sizes and no CCXT class.

### One-sided and empty books

Not observable on this socket.

### Idle repeats

Every notice for a pair is the same 44 bytes, so the notice says only that something changed.

### Unknown, closed and wrong-level symbols

Not probed.
A join is silent even for a known pair, so an unknown one cannot be told apart on the wire.

## 5. Session

| item | value | source |
|---|---|---|
| keepalive | Engine.IO 3, the client sends `2` every `pingInterval`, 25 s, and the server answers `3` | P2 |
| pong time | 144 to 171 ms over all three runs | P2 |
| silence tolerated | `pingTimeout` 20,000 ms after a missed ping, per the open packet | P2 |
| forced disconnects | none seen in sessions of 30 to 151 s | P2 |
| maintenance notices | none seen | P2 |
| compression | none seen, frames arrived as plain text | P2 |
| connect time | 464 to 539 ms for the WebSocket handshake | P2 |
| front | Cloudflare, same addresses as every Bitspay host, see [`rest.md`](./rest.md) section 1 | P1 |

## 6. Captured frames

Open packet, second run, EIO 3:

```text
0{"sid":"hKXY7CepAXIa1wVOAFyF","upgrades":[],"pingInterval":25000,"pingTimeout":20000}
```

socket.io connect from the server, then the client's join:

```text
40
42["setmycombinations",{"myordercombination":"BTC_USDT"}]
```

Notice, second run, 7.5 s after the socket opened:

```text
42["refreshorders",{"market":10,"vendor":2}]
```

Anonymous trade request, sent in all three runs, which drew no reply in 45, 45 and 30 s:

```text
42["sendTradedata",{"market":"USDT","vendor":"BTC","combination":"BTC_USDT","sessionid":null,"authid":null,"accesstoken":null,"msg":"Client to server, can you hear me server?"}]
```

Keepalive, client then server:

```text
2
3
```

No error frame was captured.

## 7. Private channels

The same socket carries the private flow, S2.
`setmycombinations` with `authid` and `accesstoken`, `sendmyprofile`, `myprofile`, `orderdata`, `addorder` and `deleteorder` are named in the bundle and were not probed.

## 8. Recommended feed shape

No WebSocket book feed is possible.
A spot stage would poll `GET https://apiv2.bitspay.io/orderbook/{pair}?depth=40`, see [`rest.md`](./rest.md) section 8.
The `refreshorders` notice could trigger that poll per pair, with a timed poll as the fallback, since a missed notice cannot be detected.

## 9. Source ledger

| id | source | retrieved |
|---|---|---|
| S2 | `https://www.bitspay.io/main.698422cc28dafc1d65ac.js`, the Angular web bundle, searched for `TRADESOCKET_URL`, socket event names and the `socket.io-client` version | 2026-10-10 03:16 UTC |
| P1 | [`rest-probe.py`](../../../scripts/probes/venues/bitspay/rest-probe.py), `info` capability flags and edge headers | 2026-10-10 |
| P2 | [`ws-probe.py`](../../../scripts/probes/venues/bitspay/ws-probe.py), first run 03:19 UTC for 151 s and 45 s, second run 03:22 UTC for 120 s, 45 s and 60 s, second pass 03:33 UTC for 75 s, 30 s and 45 s | 2026-10-10 |
