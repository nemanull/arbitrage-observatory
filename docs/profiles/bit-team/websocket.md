# BIT.TEAM WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 US Pacific time, which is 04:00 to 04:25 UTC on 2026-10-10, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocated to Vancouver, Canada.

BIT.TEAM lists no perpetuals, see [`fees.md`](./fees.md) section 3, so this profile covers the spot book channel.
Every probed claim was captured by [`ws-probe.py`](../../../scripts/probes/venues/bit-team/ws-probe.py) unless a source id says otherwise.
The first run held its windows at full length, and the second pass reran every mode with `--short`, which halves the book and idle windows.
Source ids S1 to S5 are those of [`fees.md`](./fees.md) section 10.
The socket is not documented anywhere, since the API document S1 has no socket section and CCXT has no socket class.
Everything below comes from the web app's bundle S2 and the wire.
The short answer is that `/orderbooks/<pairId>` on `wss://bit.team/trade/ws/` pushes a whole book of 50 levels a side on each change of that pair, and nothing on subscribe.
It carries no sequence, no checksum and no timestamp, so a feed has to seed each book from REST and may wait minutes for the first push on a quiet pair.

## 1. Endpoints

| endpoint | role, from the bundle S2 | probed |
|---|---|---|
| `wss://bit.team/trade/ws/` | `notificationsWs`, the connection the app names `ss`, which carries books, trades, prices and private channels | HTTP 101 through DDoS-Guard, no `Sec-WebSocket-Extensions` in the reply |
| `wss://bit.team/trade/api/` | `baseWs` in the app's environment, not used by any connection in the bundle | HTTP 404 on upgrade |
| `wss://history.bit.team/api/` | `historyWs`, the connection named `tw`, which serves chart candles on `/klines/<pair>/<resolution>` | HTTP 101, and the hello was answered by host `th-ws-02.bit.team` in the first run and `th-ws-01.bit.team` in the second |

The protocol is hapi `nes` version 2.
The bundle carries the `nes` browser client, recognisable by its `isNes` error flag and its `hello`, `sub`, `unsub`, `pub`, `revoke`, `reauth` and `ping` frame types, S2.
One socket carried four book subscriptions and three other channels at once.

## 2. Channel matrix for public market data

| data | path | probed |
|---|---|---|
| book | `/orderbooks/<pairId>`, numeric `id` from the catalog | whole book pushes of type `orderbooks.upgrade`, see section 4 |
| trades | `/trades/<pairId>` | `trade.new` on `usdt_rub` 44.4 s after subscribing in the first run and none in the second, with prices and sizes as scaled integers and `baseDecimals` and `quoteDecimals` |
| last price | `/prices`, all pairs | `price.new` with `pairId`, `price` and `change`, first at 9.4 s and 5.2 s in the two runs |
| 24 hour volume | `/pairs`, all pairs | `volume.change` with `pairId`, `volume24` and `volume24USD`, first at 6.7 s and 7.2 s |
| best bid and ask | none on a socket | the REST book's first level, see [`rest.md`](./rest.md) section 5 |
| mark, index, funding | Not offered | no perpetuals, see [`fees.md`](./fees.md) section 3 |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Nothing is documented, so the middle column holds what the bundle shows.

| axis | from the bundle S2 | probed |
|---|---|---|
| endpoint split axis | one URL for all market data | one socket served every public path |
| subscribe frame shape | `{"type":"sub","path":"/orderbooks/51"}`, after a `hello` | as in the bundle, with an `id` the client increments |
| unknown symbol expectation | Not specified | silent: an unknown id, a pair name and a non-trading id were each acknowledged like a valid pair, see section 4 |
| chunk unit and budget | one path per `sub` frame | seven subscriptions on one socket were all acknowledged |
| keepalive mechanism | the client answers each server `{"type":"ping"}` with `{"type":"ping"}`, and drops the socket after `interval` plus `timeout` without a message | server pings every 15.0 s once settled, and the server closed a socket that never answered about 5.2 s after an unanswered ping |
| connection lifetime and maintenance notice | Not specified | no close and no notice within 120 s on an answering socket |
| handshake and operation rate limits | Not specified | every open and every subscribe was accepted |
| public market data authentication | the app sends `auth` `{"headers":{"Authorization":"jwt"}}` without a login | that `hello` was accepted and public paths served |
| message parse and routing | `pub` frames carry `path` and `message` | route by `path`, then by `message.type` |
| subscribe acknowledgement shape | the `sub` reply resolves the promise | `{"type":"sub","id":2,"path":"/orderbooks/51"}`, one per `sub`, a repeat included |
| symbol identifier format | the catalog's numeric `id`, since the app subscribes `"/orderbooks/".concat(s)` with `s` set to `selectedPair.id` | `51` for `del_rub`, `24` for `del_usdt`, `53` for `usdt_rub`, `22` for `btc_usdt` |
| number representation | Not specified | decimal strings in books, scaled integer strings in trades |
| timestamp representation | Not specified | no timestamp in a book frame, and Unix seconds as a string in a trade |
| size unit | Not specified | units of the base asset, the same as the REST book |
| sequence semantics | the app's `handleUpdate` reads `firstUpdateId` and `lastUpdateId` and ignores them | no sequence field on the wire, every push is a whole book |
| idle repeat behaviour | Not specified | pushes come only when the pair's book changes, with no exact repeat seen |

## 4. The book channel in detail

### Snapshot on subscribe

No.
The `sub` ack comes alone, and the first book arrives with the venue's next change on that pair.
In the first run the first book came 5.65 s after the `sub` on `del_rub`, 6.37 s on `del_usdt`, 39.93 s on `usdt_rub`, and never within 120 s on `btc_usdt`.
In the second run it came 1.09 s after on `del_rub` and 2.08 s on `del_usdt`, and never within 60 s on `usdt_rub` or `btc_usdt`.
`btc_usdt` traded about 261 USD in the prior 24 hours, see [`rest.md`](./rest.md) section 2, so a quiet pair can stay empty on the socket for minutes.

### Delta semantics

None.
Every push is a whole book: `message` is `{"type":"orderbooks.upgrade","data":{"pairId":51,"orderbooks":{"asks":[...],"bids":[...]},"quantities":{"asks":"...","bids":"..."}},"userId":null}`.
In 120 s the first run carried 35 pushes on `del_rub`, 17 on `del_usdt` and 4 on `usdt_rub`, and in 60 s the second run carried 18 and 13 and none.
Every push in both runs held exactly 50 bids and 50 asks.
`quantities` holds one total per side, and it is not a sum of the 50 levels pushed.
In the second run the `del_usdt` bid total, 96825.77269, matched the sum of price times size over the 100 bids of the REST book to within 0.0001.
The other three totals matched neither the base nor the quote sum of the REST book, for example 2500360.601385 for `del_rub` bids against 1391716.20 RUB and 184683.19 DEL, so the field's meaning was not established and a feed should ignore it.

### Sequence and gap rule

There is no sequence, update id or timestamp on the wire.
The bundle's `handleUpdate` reads `firstUpdateId` and `lastUpdateId` without using them and returns the frame unchanged, S2, so the app does not check order either.
Because every push is complete, there is no gap to detect.
A feed takes the newest push, but it cannot age it by a venue timestamp.

### Checksum

None in the bundle and none on the wire.

### Level order on the wire

Bids are sorted best first, descending by price, and asks best first, ascending.
No push in any run was crossed, held a duplicate price or held a size of zero.
Each level is an object of three decimal strings: `price`, `quantity` in the base asset, and `amount`, which is price times quantity in the quote asset.

### Level window

50 levels a side, fixed.
The REST book of the same pair returned up to 155 bids and 138 asks, see [`rest.md`](./rest.md) section 5, so the socket truncates.
There is no depth parameter on the `sub` frame.

### Size unit

Sizes are in the base asset.
The `del_rub` book showed `quantity` 67.12012153 at `price` 33.75 with `amount` 2265.3041016375, which is DEL and RUB.
BIT.TEAM has no contracts, so there is no `contractSize` to reconcile.

### One-sided and empty books

None was seen on the socket.
A pair whose REST book is thinner than 50 levels a side, such as `btt_usdt` with 10 bids and 15 asks, was not subscribed, so whether the socket then pushes fewer than 50 levels was not observed.

### Idle repeats

In the first run pushes on `del_rub` came at intervals of 0.11 to 21.07 s with a median of 0.23 s, on `del_usdt` 0.06 to 47.17 s with a median of 0.32 s, and on `usdt_rub` 3.94 to 36.92 s.
In the second run they came at 0.08 to 18.31 s on `del_rub` and 0.18 to 32.10 s on `del_usdt`.
No push matched the previous push of the same pair exactly.
So silence on a book channel is normal and is not a sign of a dead socket.
The last pushed top of book matched the REST top on every pair that pushed, 1.0 to 35.9 s after the push in the first run and 3.3 to 3.4 s in the second.

### Unknown, closed and wrong-level symbols

| sent | reply |
|---|---|
| `sub` before `hello` | `{"statusCode":400,"payload":{"error":"Bad Request","message":"Connection is not initialized"},"type":"sub","id":1}` |
| `/orderbooks/99999` | `{"type":"sub","id":2,"path":"/orderbooks/99999"}`, a plain ack |
| `/orderbooks/btc_usdt` | a plain ack |
| `/orderbooks/13`, `eth_btc` with `status` 0 | a plain ack |
| `/depth/51` | `{"statusCode":404,"payload":{"error":"Not Found","message":"Subscription not found"},"type":"sub","id":5}` |
| `orderbooks/51`, no leading slash | the same 404 |
| `/balances`, a private path, with no login | a plain ack |
| a repeat `sub` to `/orderbooks/51`, twice | a plain ack each time |
| `unsub` | `{"type":"unsub","id":10}` |
| type `hello2` | `{"statusCode":400,"payload":{"error":"Bad Request","message":"Unknown message type"},"type":"hello2","id":11}` |
| `request` for `/trade/api/pair/btc_usdt` | `statusCode` 404 `Not Found` |
| a frame with no `type` | `{"statusCode":400,"payload":{"error":"Bad Request","message":"Cannot parse message"},"id":13}` |
| text that is not JSON | `{"statusCode":400,"payload":{"error":"Bad Request","message":"Cannot parse message"}}` |

No error closed the socket.
The server accepts any path of a known shape and validates neither the pair id nor the login, so an ack proves nothing about the pair.
A feed has to check pair ids against the catalog itself and treat a missing first push as normal.

## 5. Session

| item | value |
|---|---|
| hello reply | `{"type":"hello","id":1,"heartbeat":{"interval":15000,"timeout":5000},"socket":"...:backend-exchange.bit.team:..."}`, and in the first run a server ping arrived before it |
| keepalive | the server sends `{"type":"ping"}` every 15.0 s, and the client must answer `{"type":"ping","id":n}` |
| silence the server tolerates | a socket that never answered was closed with code 1005 and no reason at 25.79 s in the first run and 17.15 s in the second, each time about 5.2 s after a server ping, close to the 5,000 ms `timeout` |
| client pings | not needed beyond the answers, since the server drives the heartbeat |
| forced disconnects | none within 120 s on an answering socket |
| maintenance notices | none in the bundle, none seen |
| compression | the probe's `permessage-deflate` offer was not accepted, the reply carried no extension |
| handshake and subscription limits | Not specified anywhere |

## 6. Captured frames

The first `del_rub` push of the second run, cut to two levels a side by the probe:

```json
{"type":"pub","path":"/orderbooks/51","message":{"type":"orderbooks.upgrade","data":{"pairId":51,"orderbooks":{"asks":[{"price":"33.864669","quantity":"120.43789134","amount":"4078.58932528706646"},{"price":"33.889903","quantity":"6.79653986","amount":"230.33407659103358"}],"bids":[{"price":"33.75","quantity":"67.12012153","amount":"2265.3041016375"},{"price":"33.559807","quantity":"7.98156155","amount":"267.85966517662085"}]},"quantities":{"asks":"12594.59335317","bids":"2500360.601385"}},"userId":null}}
```

A trade on `usdt_rub` from the first run, where `price` 93917214 with `quoteDecimals` 6 is 93.917214 RUB:

```json
{"type":"pub","path":"/trades/53","message":{"type":"trade.new","data":{"pairId":53,"trades":[{"quantity":"81382264","price":"93917214","baseDecimals":6,"quoteDecimals":6,"side":"buy","timestamp":"1791605387"}]},"userId":null}}
```

## 7. Private channels

The bundle subscribes `/balances`, `/orders`, `/userTrades/<pairId>`, `/notifications/messages/<userID>`, `/user/chat/<chatID>` and `/p2ptoken` on the same socket, S2.
They need a `hello` whose `auth` header is `Bearer <access token>` from the web login, S2.
The REST API's own private calls use Basic authentication with an API key pair instead, S1, so an API key holder has no documented socket login.

## 8. Recommended feed shape

None for the engine as it stands.
BIT.TEAM has no perpetual, so it has no place in the perpetual engine.

If a later design adds RUB or USDT spot legs, the shape would be:

- one socket to `wss://bit.team/trade/ws/`, a `hello` with `auth` `{"headers":{"Authorization":"jwt"}}`, then one `sub` to `/orderbooks/<id>` per pair with `status` 1.
- seed each book from `GET /trade/api/orderbooks/<name>` after the ack, because the socket sends no snapshot, see [`rest.md`](./rest.md) section 5.
- replace the book on every push and keep the top 20 levels a side, well inside the 50 pushed.
- answer every server ping at once, since the server drops a socket about 5 s after an unanswered ping, and set `maxSilenceMs` to about 20,000 on the server's pings, not on book traffic, because a book can be silent for minutes.
- check every pair id against the catalog, since the server acknowledges any id.
- resubscribe and reseed after any reconnect.

## 9. Source ledger

The sources are S1 to S5 of [`fees.md`](./fees.md) section 10.
S2, the Nuxt bundle `https://bit.team/_nuxt/9126db0.js` read on 2026-10-09, holds the socket URLs, the connection list `[{name:"tw",url:"wss://history.bit.team/api/"},{name:"ss",url:"wss://bit.team/trade/ws/",isPrivate:!0}]`, the `nes` client, the subscribe paths and `handleUpdate`.
S1 has no socket section, and CCXT 4.5.68 sets `has.ws` false, S3 line 155.
