# Ndax WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:29 to 04:44 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

Ndax lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot book channel.
Every probed claim was captured by [`ws-probe.py`](../../../scripts/probes/venues/ndax/ws-probe.py) unless a source id says otherwise.
The first run held its windows at full length, and the second pass reran every mode with `--short`, which halves each window.
Source ids S1 to S5 are those of [`fees.md`](./fees.md) section 10, and S6 is the CCXT Pro class named in section 9.
The short answer is that `SubscribeLevel2` answers with a snapshot of the requested depth and then streams level deltas, each row carrying a per instrument `MDUpdateId` that rose by exactly 1 with no gap in either run.
That is the shape the engine's feeds expect, on a venue that has nothing but CAD spot.

## 1. Endpoints

| endpoint | public market data | probed |
|---|---|---|
| `wss://api.ndax.io/WSGateway` | the AlphaPoint gateway, S2 and S6 line 27 | HTTP 101 through Cloudflare's `YVR` edge, no `Sec-WebSocket-Extensions` in the reply |
| `wss://ndaxmarginstaging.cdnhop.net:10456/WSAdminGatewa/` | CCXT's test URL, S6 line 24 | not opened, a staging host |

One socket carries every instrument and every public function.
The probe held five book subscriptions on one socket in the book mode.
The same socket also takes request and reply calls such as `Ping`, `GetInstruments` and `GetL2Snapshot`, S2.

## 2. Channel matrix for public market data

| data | subscribe call | event name | probed |
|---|---|---|---|
| book | `SubscribeLevel2` with `Depth` | `Level2UpdateEvent` | snapshot then deltas, see section 4 |
| best bid and ask, last trade | `SubscribeLevel1` | `Level1UpdateEvent` | not probed, named in S2 and S6 |
| trades | `SubscribeTrades` with `IncludeLastCount` | `TradeDataUpdateEvent` | not probed, named in S2 and S6 |
| candles | `SubscribeTicker` with `Interval` | `TickerDataUpdateEvent` | not probed, named in S2 and S6 |
| mark, index, funding | Not offered | | no perpetuals, see [`fees.md`](./fees.md) section 3 |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one gateway URL, S2 | one URL for every instrument |
| subscribe frame shape | `{"m":0,"i":<even>,"n":"SubscribeLevel2","o":"<JSON string>"}`, where `o` is a JSON document inside a string, S2 | as documented, and an `o` sent as an object got no reply at all |
| unknown symbol expectation | Not publicly specified | a reply with `m` 1 and `{"result":false,"errormsg":"Resource Not Found","errorcode":104,"detail":"Instrument not Found"}` inside `o` |
| chunk unit and budget | one instrument per call, S2 | five subscriptions on one socket were all served, and no cap is documented |
| keepalive mechanism | a `Ping` call that answers `PONG`, S2 | the server sent an unsolicited WebSocket pong frame every 30 s on an idle socket, and the `Ping` call answered `{"msg":"PONG"}` |
| connection lifetime and maintenance notice | Not publicly specified | no close and no notice within 150 s of total silence from the client |
| handshake and operation rate limits | Not publicly specified | every open and every call was accepted |
| public market data authentication | none, the Level 2 call has "Permissions: Public", S2 | none needed |
| message parse and routing | `m` is 0 request, 1 reply, 2 subscribe, 3 event, 4 unsubscribe, 5 error, and `n` names the function, S2 | snapshots are `m` 1 with `n` `SubscribeLevel2`, deltas are `m` 3 with `n` `Level2UpdateEvent`, and the instrument is field 7 of each row |
| subscribe acknowledgement shape | the reply carries the Level 2 snapshot, S2 | the snapshot is the acknowledgement, with `i` echoing the request |
| symbol identifier format | `InstrumentId`, or `Symbol` as an alternative, S2 | `InstrumentId` 1 for `BTCCAD`, and `Symbol` `ETHCAD` was also accepted |
| number representation | numbers in a comma delimited array, S2 | JSON numbers inside the `o` string, with trailing zeros kept, such as `2.0000000000000000000000000000` |
| timestamp representation | `ActionDateTime` in ms, S2 | ms on every row, see section 4 for what it means on a delete |
| size unit | Not publicly specified | base asset units, the same as the REST book |
| sequence semantics | `MDUpdateId`, "This sequential ID identifies the order in which the update was created", S2 | starts at 1 on the snapshot of each subscription and rises by 1 per row per instrument, see section 4 |
| idle repeat behaviour | Not publicly specified | not measured row by row, and the empty `BTCUSD` book sent nothing in 120 s |

## 4. The book channel in detail

### Snapshot on subscribe

Yes.
The reply to `SubscribeLevel2` is the snapshot, `{"m":1,"i":<request i>,"n":"SubscribeLevel2","o":"[[...],...]"}`.
It came 0.072 to 0.077 s after the five subscribe frames were sent in the first run, and 0.068 to 0.072 s in the second.
At `Depth` 20 it held 40 rows, 20 bids and 20 asks, on `BTCCAD`, `ETHCAD`, `XRPCAD` and the thin `CCCAD`.
`Depth` 1, 100 and 500 on `BTCCAD` gave 2, 200 and 921 rows, the last being 500 bids and the whole ask side of 421, `ws-probe.py depth`.
`BTCUSD`, instrument 74, answered `"o":"[]"`, an empty book, and sent no event in 120 s.
The snapshot rows have the ten fields of the REST book, see [`rest.md`](./rest.md) section 5, with `ActionType` 0 on every row.

### Delta semantics

Each `Level2UpdateEvent` carries one or more rows for one instrument, and no frame in either run mixed instruments.
A row replaces one price level:

| `ActionType` | meaning | what a book does |
|---|---|---|
| 0 new | a level appears, or comes back with a new size | set the level to field 8 |
| 1 update | the level's size changes in place | set the level to field 8 |
| 2 delete | the level is gone, with size 0 and order count 0 | remove the level |

A size change often comes as a delete followed by a new row at the same price inside one frame, for example `[43,0,...,2,...,117440.01,1,0,0],[44,1,...,0,...,117440.01,1,0.40905619,0]`.
In the first run's 120 s, `BTCCAD` carried 366 new, 80 update and 366 delete rows, `ETHCAD` 561, 47 and 561, `XRPCAD` 831, 377 and 831, and `CCCAD` 378, 22 and 378.
The second pass's 60 s carried 207, 52 and 207 on `BTCCAD`, 306, 10 and 306 on `ETHCAD`, 464, 196 and 464 on `XRPCAD`, and 198, 30 and 198 on `CCCAD`.
CCXT Pro applies rows the same way, storing the size for 0 and 1 and a size of 0 for 2, S6 lines 377 to 449.

### Sequence and gap rule

`MDUpdateId`, field 0, numbers the snapshot rows 1 to 40 and then continues at 41 on the first delta.
It rises by exactly 1 per row for each instrument, across frame boundaries.
Over the first run's 120 s, 812, 1,169, 2,039 and 778 delta rows on the four live instruments showed no gap and no repeat.
The second pass's 466, 622, 1,124 and 426 rows showed none either.
Across the whole socket, rows of different instruments interleave, so the id is per instrument and per subscription, not per socket.
The gap rule is therefore that each row's `MDUpdateId` must equal the previous row's for the same instrument plus 1, and anything else calls for a resubscribe.
The REST `MDUpdateId` is a different counter and cannot be joined with this one, see [`rest.md`](./rest.md) section 5.

The frame field `i` on events is a separate counter of event frames on the socket.
It started at 2 and rose by 2 on all 454 steps of the second pass, but the first run also saw steps of 4 and of -2, so frames are not always delivered in `i` order, and `i` is no gap check.
The API document warns that event `i` values are unrelated to the request that subscribed, and that a client must route events by `n`, S2.

### Checksum

None documented and none on the wire.

### Level order on the wire

Snapshot rows come bids first, best first, descending, then asks, best first, ascending.
Delta rows come in `MDUpdateId` order and not in price order.
No kept book was crossed after any event in either run.

### Rows are price levels

Each row is a price level with an order count in field 5, which reached 11 at `Depth` 100 and 55 at `Depth` 500 on `BTCCAD` in REST, and no snapshot repeated a price within a side.
The API document calls field 5 `OrderId` and field 1 `AccountId`, and the wire carries counts in both, as CCXT's comments say, S3 lines 746 to 755.

### Level window

The server keeps the subscriber inside roughly the requested depth but does not trim exactly.
A book kept from a `Depth` 20 snapshot plus every delta held between 20 and 28 bids and 20 and 24 asks on `BTCCAD` in the first run, and between 19 and 22 a side on `XRPCAD`.
In the second pass the `BTCCAD` asks fell as low as 15 for a moment.
So a level that leaves the window is not always deleted, and a level inside it can be briefly absent.
At the end of the first run the kept top 20 matched a fresh REST `Depth` 20 snapshot on every level of `BTCCAD` and `ETHCAD`, and on 39 of 40 on `XRPCAD` and 37 of 40 on `CCCAD`.
In the second pass it matched on 40, 34, 36 and 39 of 40, with the same best bid and ask on all four.
The REST calls came one after another once the socket had closed, so a few levels had moved in between.
A feed should publish the top 20 of the kept book and ignore the tail.

### Size unit

Sizes are in the base asset, the same as the REST book, so `0.40905619` on `BTCCAD` is BTC.
Ndax has no contracts, so there is no `contractSize` to reconcile.

### Timestamps

Field 2 on a new or update row is the time of that change.
On a delete row it is the time of the row being deleted, so it can be seconds or minutes old.
In the second pass, 136 of 1,175 delete rows were more than 10 s old on arrival, the median was 1,184 ms, and the oldest was 363,457 ms, about six minutes.
On new and update rows, arrival on this host minus field 2 was a median of 114 ms, a 10th percentile of 34 ms and a 90th percentile of 896 ms in the first run, and 130, 42 and 267 ms in the second.

### One-sided and empty books

`BTCUSD` was empty, an `o` of `[]`, and stayed silent.
No one-sided book was seen on the probed instruments.

### Event cadence

Median intervals between frames were 0.30 s on `BTCCAD`, 0.53 s on `ETHCAD`, 0.23 s on `XRPCAD` and 0.40 s on `CCCAD` in the first run.
The second pass gave 0.40, 0.72, 0.22 and 0.40 s.
The longest silence on a live instrument was 5.3 s on `BTCCAD` in the first run and 3.4 s in the second.
Event frames had a median of 161 bytes and a largest of 4,569 bytes in the first run, and 220 and 2,596 bytes in the second, against about 2,390 bytes for the `BTCCAD` snapshot at `Depth` 20.

### Unknown, repeated and malformed calls

| sent | reply |
|---|---|
| `SubscribeLevel2` with `InstrumentId` 999999 | `{"m":1,"i":2,"n":"SubscribeLevel2","o":"{\"result\":false,\"errormsg\":\"Resource Not Found\",\"errorcode\":104,\"detail\":\"Instrument not Found\"}"}` |
| `SubscribeLevel2` with `Symbol` `ETHCAD` | a normal snapshot for instrument 3 |
| a second `SubscribeLevel2` on the same instrument | `m` 1 with `"errormsg":"Already Subscribed.","errorcode":909`, and the first subscription kept streaming |
| an unknown function `SubscribeLevel3` | `{"m":5,"i":10,"n":"SubscribeLevel3","o":"Endpoint Not Found"}` |
| a private function `GetOpenOrders` without a session | `{"m":5,"i":18,"n":"GetOpenOrders","o":"Endpoint Not Found"}` |
| a frame whose `o` is an object, not a string | no reply |
| text that is not JSON | no reply |
| `Ping` | `{"m":1,"i":14,"n":"Ping","o":"{\"msg\":\"PONG\"}"}` |
| `UnsubscribeLevel2` | `m` 1 with `{"result":true,"errormsg":null,"errorcode":0,"detail":null}`, and no further events for that instrument |

No error closed the socket.
A failed subscribe is a reply with `m` 1 whose `o` is an object with `result` false instead of an array, so a feed has to test the shape of `o`.

## 5. Session

| item | value |
|---|---|
| keepalive | the server sent an unsolicited WebSocket pong control frame at 30.0, 60.4, 90.0, 120.0 and 150.0 s on an idle socket in the first run, and at 30.0 and 60.0 s in the second, and never a ping |
| silence the server tolerates | a socket with no subscription and no client traffic, not even protocol pings, stayed open for 150 s in the first run and 75 s in the second, and a `Ping` call then answered |
| client pings | optional, the `Ping` function answers `PONG` |
| forced disconnects | none within 150 s |
| maintenance notices | none documented, none seen |
| compression | an offer of `permessage-deflate` was not accepted, the reply carried no extension |
| handshake and subscription limits | Not publicly specified |

## 6. Captured frames

A subscribe request at `Depth` 20:

```json
{"m": 0, "i": 2, "n": "SubscribeLevel2", "o": "{\"OMSId\": 1, \"InstrumentId\": 1, \"Depth\": 20}"}
```

The snapshot reply, trimmed to three of 40 rows:

```json
{"m":1,"i":2,"n":"SubscribeLevel2","o":"[[1,1,1791606904836,0,117563.65,1,117565.2,1,0.03292929,0],[2,1,1791606904836,0,117563.65,1,117565.02,1,0.0748,0],[3,1,1791606904836,0,117563.65,9,117565.0,1,0.2151,0]]"}
```

A delta on `ETHCAD`, a new level, an update and a delete:

```json
{"m":3,"i":2,"n":"Level2UpdateEvent","o":"[[41,1,1791606905055,0,3545.96,1,3544.11,3,7.869903,0],[42,1,1791606905055,1,3545.96,2,3544.11,3,16.680546,0],[43,1,1791606905089,2,3545.96,0,3539.86,3,0,0]]"}
```

The answer to a `Ping` call:

```json
{"m":1,"i":14,"n":"Ping","o":"{\"msg\":\"PONG\"}"}
```

An error for an unknown function:

```json
{"m":5,"i":10,"n":"SubscribeLevel3","o":"Endpoint Not Found"}
```

## 7. Private channels

`AuthenticateUser` opens a session on this same socket with an API key, signature, user id and nonce, S2.
`SubscribeAccountEvents` then streams orders, trades, positions, deposits and withdrawals for one account, with "Permissions: Operator, Trading, AccountReadOnly", S2.
Order calls such as `SendOrder` and `CancelOrder` go over the same socket, S2.

## 8. Recommended feed shape

None for the engine as it stands.
Ndax has no perpetual, so it has no place in the perpetual engine.

If a later design adds CAD spot legs, the shape would be:

- one socket to `wss://api.ndax.io/WSGateway` for the CAD instruments, one `SubscribeLevel2` per instrument with `OMSId` 1, the numeric `InstrumentId` and `Depth` 20, using even `i` values.
- route by `n`, take the `m` 1 reply as the snapshot when `o` parses to an array, and treat an object with `result` false as a failed subscribe.
- keep the book by price, set the size on `ActionType` 0 and 1, remove the level on 2, and publish the top 20 levels a side.
- check that each row's `MDUpdateId` is the previous one for that instrument plus 1, and resubscribe that instrument on any gap.
- send the `Ping` call every 15 s and set `maxSilenceMs` to about 20,000 on its reply, since an instrument can be quiet for several seconds and an empty one is silent for good.
- leave compression off, which the server does not offer anyway.

CCXT Pro's `watchOrderBook` subscribes with `Depth` 100 by default, S6 lines 339 to 355, and keeps the highest `MDUpdateId` as the book nonce without checking for a gap, S6 lines 412 to 449.

## 9. Source ledger

The sources are S1 to S5 of [`fees.md`](./fees.md) section 10, plus S6.

| id | source | what it gave |
|---|---|---|
| S6 | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/ndax.js` | the socket URL, the `SubscribeLevel2` frame, the delta handling and the event routing, lines cited above |

S2, the API document, holds the message frame, the `m` values, the advice on even request ids and routing by `n`, and the `SubscribeLevel2` and `Ping` calls this profile compares with the wire.
