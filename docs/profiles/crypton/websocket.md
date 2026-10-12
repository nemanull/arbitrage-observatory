# Crypton Exchange WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09, for the venue survey of 2026-09-22, CoinMarketCap addition at rank 151, wave 45.

**Probed:** 2026-10-10 between 03:27 and 03:46 UTC, the evening of 2026-10-09 in local time, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Vancouver, Canada.

This profile covers the public socket of Crypton Exchange's spot market.
The venue lists no perpetuals, see [`fees.md`](./fees.md) section 3, so change 1 of the survey plan's template applies.
The socket is not documented at all, since the API reference S1 covers only REST.
Everything below comes from the venue's web bundle S2 and from [`ws-probe.py`](../../../scripts/probes/venues/crypton/ws-probe.py).

## 1. Endpoints

| URL | protocol | carries |
|---|---|---|
| `wss://crp.is:8181/socket.io/?EIO=3&transport=websocket` | Socket.IO 1 or 2 over Engine.IO 3, websocket transport only | every public event for every pair |

The web client builds the URL as `window.location.protocol+"//"+window.location.hostname+":8181"` and opens it with `transports:["websocket"]`, S2.
The polling transport also answers, and its handshake lists `"upgrades":["websocket"]`.
`EIO=4` gets the same Engine.IO 3 open packet, so the server does not speak Engine.IO 4.
A plain WebSocket upgrade on the REST port, `wss://crp.is:8182/`, is refused with HTTP 400.
There is one product, spot, so the question of several families on one socket does not arise.

## 2. Channel matrix for public market data

Socket.IO has no channels in the usual sense.
The client emits a room join, and the server emits named events.

| event from server | scope | payload | source |
|---|---|---|---|
| `book` | the joined pair's room | one changed price level, section 4 | S2, probed |
| `volume` | the joined pair's room | the total of one side, `{"buy":2551.3194078}` or `{"sell":137055.359}`, in the units of the REST `volumes` field, see [`rest.md`](./rest.md) section 5 | S2, probed |
| `trade_history` | the joined pair's room | `{"items":[trade],"pair":"crp_usdt"}`, the new trade only | S2, probed |
| `pairs` | every connection, joined or not | one pair's `data_market` row after a trade, `{"data":{"pair":{...},"data_market":{...}},"pair":"crp_usdt"}` | S2, probed |
| `rooms` | every connection | `["main","ru"]` | probed |
| `graph` | after `graph:join:<period>` | candles | S2, not probed |
| `orders`, `balance`, `session` | the signed-in user | private, section 7 | S2 |

There is no best bid and ask event, no ticker event, and no mark, index or funding event.
Joins the client can emit are `trade-join`, `chat-join`, `user-join` and `graph:join:h`, `graph:join:d`, `graph:join:m`, `graph:join:all`, each with a matching `-leave`, S2.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Nothing is documented, so the documented column records what the web bundle S2 does.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S2 | one URL, section 1 |
| subscribe frame shape | `socket.emit("trade-join","crp_usdt")`, S2 | `42["trade-join","crp_usdt"]` |
| unknown symbol expectation | none | `42["trade-join","nope_usdt"]` gets no reply and no error, and the socket stays open |
| chunk unit and budget | the web client leaves one pair's room before it joins the next, S2 | a second `trade-join` on the same socket was accepted with no reply. The second pair, `uusd_usdt`, sent no book frame in 100 s, so whether one socket can hold two rooms is not settled |
| keepalive mechanism | Engine.IO client ping `2` and server pong `3`, `pingInterval` 25000 ms, `pingTimeout` 60000 ms in the open packet | as stated. Pong round trips of 170 to 190 ms |
| connection lifetime and maintenance notice | none | no close in sessions of 180 s and 150 s, and a session that sent no ping for 45 s stayed open |
| handshake and operation rate limits | none | about a dozen opens and fifteen emits over three probe runs, none refused apart from the plain upgrade on the REST port in section 1 |
| public market data authentication | none | none |
| message parse and routing | Engine.IO type digit, then Socket.IO type digit, then a JSON array of event name and payload | as stated. A `book` payload names its pair only by `cur` and `ecur` |
| subscribe acknowledgement shape | none, S2 emits without an acknowledgement callback | none. `42["rooms",["main","ru"]]` arrived once or twice on every connection, whether it joined a pair or not, so it is not an acknowledgement |
| symbol identifier format | lower case `base_quote`, as in REST | `crp_usdt` for the join, and `"cur":"crp","ecur":"usdt"` in each `book` frame |
| number representation | numbers | JSON numbers for price, amount, value and time |
| timestamp representation | milliseconds | `time` in milliseconds on every `book` frame |
| size unit | base asset | base asset, `value` is `price` times `amount` |
| sequence semantics | none | no sequence, no update id and no checksum. `time` never decreased across 54 and 60 frames in two runs, with gaps down to 4 ms |
| idle repeat behaviour | none | no repeats. `uusd_usdt` sent no book frame in 100 s, and `crp_usdt` arrived in bursts |

## 4. The book channel in detail

### Snapshot on subscribe

There is none.
After `trade-join` the first `book` frame came 5 to 40 s later over three runs, and it carried a single level.
The web client loads the snapshot from REST, `GET /market/panel?c=<pair>`, just before it emits `trade-join`, S2, see [`rest.md`](./rest.md) section 5.

### Delta semantics

Each `book` frame carries one price level of one side.

| field | meaning |
|---|---|
| `type` | `buy` for a bid, `sell` for an ask |
| `price` | the level that changed |
| `book` | `[]` when the level is gone, otherwise one element `{"price","amount","value"}` holding the new absolute amount |
| `cur`, `ecur` | base and quote, the only pair identifier in the frame |
| `time` | server time in milliseconds |

The web client's reducer, S2, replaces the level at `price` with `book[0]`, inserts it in price order when absent, and removes it when `book` is empty.
It keeps at most 30 levels per side when it inserts below the window, and it reloads the REST snapshot whenever a side falls to 13 levels or fewer.
In the second pass run, 60 frames split into 15 bid updates, 15 bid removals, 16 ask updates and 14 ask removals.
A trade showed as a removal on both sides at the trade price within 5 ms.

### Sequence and gap rule

There is no sequence and no checksum, so a gap cannot be detected.
The only resync is a fresh REST snapshot, which the web client takes on every pair switch and when a side runs short.

### Checksum

None.

### Level order on the wire

One level per frame, so there is no order to speak of.

### Size unit against CCXT `contractSize`

The amount is in the base asset, as in REST.
There is no CCXT class to compare against, see [`fees.md`](./fees.md) section 8.

### One-sided and empty books

Not seen.
All three pairs had both sides in the REST snapshot.

### Idle repeats

None.
The `crp_usdt` book frames came in bursts, a removal and a new level about every 1.2 s, with quiet stretches between bursts.
In the second pass run the gap between frames had a median of 0.4 s and a maximum of 24.8 s.
In the burst printed by the second run, each bid removal was followed 336 to 341 ms later by a new bid at the same price with a larger amount, and the next removal came about 1.18 s after that.
The first run printed the same burst shape, with the new bid sometimes 0.0001 lower.
Each such pair sat 0.0003 or 0.0004 below the one before near the top of the book and further apart deeper down, which looks like a single market making bot walking its ladder.
After `trade-leave` the probe got no more `book` or `trade_history` frames for 50 s in two runs, while the broadcast `pairs` frames kept coming, so the leave works.

### Unknown, closed and wrong-level symbols

`trade-join` with `nope_usdt` gets no answer and no error.
A feed cannot tell an unknown pair from a quiet one, so it must check pairs against `GET /market/pairs` before it joins.

## 5. Session

| item | value |
|---|---|
| open packet | `0{"sid":"...","upgrades":[],"pingInterval":25000,"pingTimeout":60000}` then `40` |
| keepalive | the client sends `2` every 25 s and the server answers `3` |
| silence tolerated | at least 45 s with no client ping, and Engine.IO 3 allows `pingInterval` plus `pingTimeout`, 85 s |
| forced disconnects | none in 180 s and 150 s sessions |
| maintenance notices | none seen |
| compression | not offered in the handshake |
| handshake time | 697 to 768 ms for the TLS and WebSocket handshake |
| limits | none published, none hit |

## 6. Captured frames

From the probe run of 2026-10-10 at 03:34 UTC, trimmed.
The JSON blocks drop the Engine.IO and Socket.IO prefix `42`, and the `pairs` frame keeps only two fields of `pair`.

Open and connect:

```text
0{"sid":"V1lNWVluE4h5gPhuAKHE","upgrades":[],"pingInterval":25000,"pingTimeout":60000}
40
42["rooms",["main","ru"]]
```

Subscribe, which gets no acknowledgement:

```text
42["trade-join","crp_usdt"]
```

A level update and a level removal:

```json
["book",{"time":1791603306861,"book":[{"price":0.1366,"amount":77.284,"value":10.5569944}],"price":0.1366,"type":"buy","cur":"crp","ecur":"usdt"}]
```

```json
["book",{"time":1791603307221,"book":[],"price":0.1366,"type":"buy","cur":"crp","ecur":"usdt"}]
```

The trade that followed, and the broadcast pair row:

```json
["trade_history",{"items":[{"record_id":"53603e9a-a216-4a9b-b0a8-8cfe7736d477","record_type":"sell","price":0.1366,"amount":77.284,"value":10.5569944,"created_at":1791603307201}],"pair":"crp_usdt"}]
```

```json
["pairs",{"data":{"pair":{"pair_id":25,"pair":"crp_usdt"},"data_market":{"open":0.1369,"close":0.1366,"high":0.1384,"low":0.1366,"volume":238449.341,"value":32719.8356663,"volume_usd":0,"rate":-0.22,"date_now":1791603307225}},"pair":"crp_usdt"}]
```

Keepalive, client then server:

```text
2
3
```

There is no error frame, since an unknown pair is silently ignored.

## 7. Private channels

The same socket carries `orders`, `balance` and `session` events for a signed-in user, S2.
The web client sends its `auth_token` to `GET https://crp.is:8182/user/session/check` when the socket connects.
How the socket itself learns the user was not traced.

## 8. Recommended feed shape

The engine has no spot leg, so this is for a future one.

| item | value |
|---|---|
| URL | `wss://crp.is:8181/socket.io/?EIO=3&transport=websocket` |
| markets per connection | one, matching the web client, until a second room is shown to deliver |
| subscribe | `42["trade-join","<pair>"]` after the `40` connect packet |
| snapshot | `GET https://crp.is:8182/market/panel?c=<pair>` right after the join |
| apply | replace or remove one level per `book` frame, keyed by `type` and `price` |
| keepalive | send `2` every 25 s and expect `3` |
| `maxSilenceMs` | 60000 on the pong, not on book frames, because a quiet pair sends no book frame for minutes |
| resync | a fresh REST snapshot after every reconnect, and on a timer, since no gap can be detected |

## 9. Source ledger

| id | source | used for |
|---|---|---|
| S1 | API reference, `https://crp.is/api-doc/`, read 2026-10-09 | no socket documentation |
| S2 | web bundle `https://crp.is/static/js/main.98f09429.chunk.js`, read 2026-10-09 | socket URL, room joins, event names, the book reducer and its 13 and 30 level rules |
| P1 | [`ws-probe.py`](../../../scripts/probes/venues/crypton/ws-probe.py) | every probed value |
| P2 | [`rest-probe.py`](../../../scripts/probes/venues/crypton/rest-probe.py) | the REST snapshot |
