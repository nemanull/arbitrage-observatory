# IndoEx WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 03:13 to 03:30 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada (Cloudflare trace `loc=CA`, `colo=YVR`).

This profile covers the public sockets of IndoEx spot, since the venue lists no perpetuals, see [`fees.md`](./fees.md) section 3.
IndoEx documents one Socket.IO server for market data, S3, and its website connects to two others that its bundle names, P1.
No socket sent a single book, trade or ticker frame to this host.
Every probed value comes from [`ws-probe.py`](../../../scripts/probes/venues/indoex/ws-probe.py), run three times with windows of 90, 60 and 45 seconds per host and once more with 20 seconds in the second pass, P8.
Source ids are shared with [`fees.md`](./fees.md) and [`rest.md`](./rest.md).

## 1. Endpoints

| host | role | documented | probed |
|---|---|---|---|
| `https://websocket.indoex.io/` | the public market data socket of the documentation | S3, with a Socket.IO client: `io.connect('https://websocket.indoex.io/')`, then `socket.emit('join', { pair: 'BTC_USDT' })`, and handlers for the events `message`, `orders` and `trades` | Cloudflare answered 502 with body `error code: 502` to the Engine.IO polling handshake and to the WebSocket upgrade, `cfOrigin` 9 to 10 ms, in every run, so the origin behind it is down |
| `https://socket.indoex.io/` | the website's trade socket, `TRADESOCKET_URL` in the bundle | P1 | Engine.IO 3 open with `pingInterval` 25000 and `pingTimeout` 5000, then Socket.IO connect, then two greeting events and nothing more |
| `https://proxysocket.indoex.io/` | the website's second socket, `TRADESOCKETPROXY_URL` in the bundle | P1 | Engine.IO 3 open with `pingInterval` 25000 and `pingTimeout` 60000, then Socket.IO connect, then one `welcome` event and nothing more |

All three names resolve to the same two Cloudflare addresses, P2.
The servers answered an `EIO=4` handshake in the Engine.IO 3 framing too, `96:0{...}2:40`, so they run Socket.IO 2, and the site bundle's own client speaks Socket.IO parser protocol 4, which is Socket.IO 2, P1.
One socket would carry every pair, since `join` takes a pair name, but nothing was carried.

## 2. Channel matrix for public market data

| channel | documented | probed |
|---|---|---|
| book | event `orders` with `status`, `message`, `asks` and `bids`, first a full book then increments, S3 | never sent on any host |
| trades | event `trades` with `orderbook`, S3 | never sent |
| ticker or best bid and ask | none documented | none seen |
| site events | the bundle listens for `refreshorders`, `refreshpair`, `pricerefresh`, `socketrefresh`, `analyticsrefresh` and `changetrade`, P1 | none seen in at least 195 s on each live host across all runs |
| mark, index, funding | Not offered, spot only | |

The bundle reacts to `analyticsrefresh` by calling the REST call `getcombinationinfo`, so the site's own sockets look like refresh signals rather than book carriers, which is an inference from the bundle, P1.
The REST info call itself reports `"tradesSocket":false` and `"ordersSocket":false`, see [`rest.md`](./rest.md) section 2.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
"Documented" is the WebSocket page, S3, and "bundle" is the site's script, P1.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, `websocket.indoex.io`, for every pair | that URL answers 502, and the two bundle URLs carry no market data |
| subscribe frame shape | Socket.IO `emit('join', {pair: 'BTC_USDT'})`, sent on the wire as `42["join",{"pair":"BTC_USDT"}]`. The page's prose also names `op`, `args`, `subscribe` and `unsubscribe`, which its own example does not use. | sent on both live hosts with no reply, and the bundle's `42["setmycombinations",{"myordercombination":[...]}]` got no reply either |
| unknown symbol expectation | failure shape `{"status":"0","message":"","asks":[],"bids":[]}` | `join` for `NOPE_USDT` got no reply, the same silence as a listed pair |
| chunk unit and budget | Not publicly specified | not measurable |
| keepalive mechanism | Engine.IO ping, client `2` and server `3` | answered on both hosts, one to three pongs in each run longer than 25 s |
| connection lifetime and maintenance notice | Not publicly specified | none seen in up to 91 s |
| handshake and operation rate limits | Not publicly specified | opens took 220 to 460 ms, one socket at a time |
| public market data authentication | none in the example | none asked |
| message parse and routing | Socket.IO event name, then a JSON object | only greetings arrived |
| subscribe acknowledgement shape | `{"status":"1","message":"Subscribed to BTC_USDT"}` | never sent |
| symbol identifier format | `BTC_USDT`, the REST pair id | not echoed |
| number representation | Not publicly specified | not observed |
| timestamp representation | Not publicly specified | not observed |
| size unit | Not publicly specified | not observed |
| sequence semantics | first full book, then increments, with no sequence field named | not observed |
| idle repeat behaviour | Not publicly specified | not observed |

## 4. The book channel in detail

No book frame arrived, so every item below is the documentation or a gap.

| item | value |
|---|---|
| snapshot on subscribe | documented, "the first full amount and the subsequent incremental", S3, and not observed |
| delta semantics | Not publicly specified beyond that sentence |
| per symbol sequence and gap rule | none documented, so a feed could not detect a lost increment |
| checksum | none documented |
| level order on the wire | not observed. The REST books list asks ascending and bids descending, see [`rest.md`](./rest.md) section 5. |
| size unit | not observed. REST sizes are in the base asset. |
| one-sided and empty books | not observed |
| idle repeats | not observed |
| unknown or closed symbol | no reply on the live hosts, and the documented failure shape was never seen |

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Engine.IO 3 ping every `pingInterval` | `2` answered with `3` on both live hosts |
| silence the server tolerates | `pingInterval` plus `pingTimeout`, 30 s on `socket.indoex.io` and 85 s on `proxysocket.indoex.io` | a socket on `socket.indoex.io` that never pinged was closed by the server at 30.58 and 30.59 s in two runs, with close code 1005 and no reason |
| forced disconnect | Not publicly specified | none in 91 s with pings |
| maintenance notice | Not publicly specified | none |
| compression | Not publicly specified | a client that offered permessage-deflate got no `Sec-WebSocket-Extensions` header back |
| handshake | | WebSocket open in 220 to 460 ms through Cloudflare's Vancouver edge |
| subscription limits | Not publicly specified | not measurable |
| throughput | | zero market data frames |

## 6. Captured frames

From the probe runs of 2026-10-10 UTC.

The documented host, to both the polling handshake and the upgrade.

```text
HTTP 502, Server: cloudflare, Server-Timing: cfEdge;dur=389,cfOrigin;dur=10
error code: 502
```

`socket.indoex.io`, the Engine.IO open and Socket.IO connect.

```text
0{"sid":"zapL5vMuE4lO2DlODhj1","upgrades":[],"pingInterval":25000,"pingTimeout":5000}
40
```

The two greetings that followed in the same millisecond, and the only events this host ever sent.

```json
["event2", {"msg": "Server to client, do you read me? Over."}]
```

```json
["event2mobile", {"msg": "Server to client, do you read me? Over."}]
```

`proxysocket.indoex.io`, its only event.

```json
["welcome", {"message": "Connected successfully!", "id": "Gcd4QJgFu0eXLyxfBiyp"}]
```

Subscribe frames as sent, none of which got any reply.

```text
42["join", {"pair": "BTC_USDT"}]
42["join", {"pair": "NOPE_USDT"}]
42["setmycombinations", {"myordercombination": ["BTC-USDT", "ETH-USDT", "NOPE-USDT"]}]
```

Keepalive, client then server.

```text
2
3
```

## 7. Private channels

Named from the bundle for a future execution stage, not probed.

- `socket.indoex.io` takes client events `addorder`, `addmarketorder`, `addstoplossorder`, `deleteorder`, `sendmyprofile` and `triggerchange`.
- It sends `myprofile` and `errormessage` back, and the bundle filters `refreshorders` against the user's own pairs.
- The order events ride the same unauthenticated socket, and the bundle passes a session hash beside them, which is an inference from the bundle.

## 8. Recommended feed shape

None.
The documented market data socket answers 502, and the two sockets the website uses send no book, trade or ticker to an unauthenticated client.
A feed for IndoEx would have to poll the REST book instead, see [`rest.md`](./rest.md) sections 5 and 8.
If `websocket.indoex.io` came back, the documented shape would be one Socket.IO 2 connection, `42["join",{"pair":"<BASE>_<QUOTE>"}]` per pair, an Engine.IO `2` every 25 s, and the `orders` event as snapshot then increments.
That shape has no sequence number, so it would need a periodic REST resync, and the engine's feed would also need a Socket.IO framing layer, since [`venue_feed.rs`](../../../server/src/feeds/venue_feed.rs) line 78 defines a plain WebSocket `BookVenue`.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S3 | IndoEx WebSocket API documentation | https://api.indoex.io/websocket.html | 2026-10-09 | IndoEx | host, `join` frame, `orders` and `trades` events, response shapes |
| P1 | [`fees-probe.py`](../../../scripts/probes/venues/indoex/fees-probe.py) | `uv run scripts/probes/venues/indoex/fees-probe.py` | 2026-10-09 | this host, Canadian exit | the socket hosts and client events in the site bundle |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/indoex/rest-probe.py) mode `host` | | 2026-10-09 | this host | name resolution |
| P8 | [`ws-probe.py`](../../../scripts/probes/venues/indoex/ws-probe.py) | `uv run scripts/probes/venues/indoex/ws-probe.py 45` | 2026-10-09 | this host | every probed value above |
