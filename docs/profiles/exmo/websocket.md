# EXMO WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 04:49 to 04:56 UTC, and the second pass from 05:01 to 05:04 UTC, from the development host near Seattle, through the laptop's Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public spot WebSocket of EXMO (CCXT id `exmo`), because EXMO lists no perpetual, see [`fees.md`](./fees.md) section 3.
The platform is winding down, and its 24 remaining books each hold one quote about 10 % either side of a reference price that did not move during the probes, see [`rest.md`](./rest.md) section 5.
So the snapshot, acknowledgement, keepalive and error paths were captured, and no book delta was.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/exmo/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written.

## 1. Endpoints

| use | URL | probed |
|---|---|---|
| public market data, all spot pairs | `wss://ws-api.exmo.com:443/v1/public`, S1, and CCXT Pro at `server/node_modules/ccxt/js/src/pro/exmo.js` line 30 | open in 1,005 to 1,085 ms over nine sockets in both passes, answered by a server that names itself `ddos-guard` |
| spot private | `wss://ws-api.exmo.com:443/v1/private`, CCXT Pro line 31 | not probed |
| margin private | `wss://ws-api.exmo.com:443/v1/margin/private`, CCXT Pro line 32 | not probed |
| exmo.me public, the sister platform | `wss://ws-api.exmo.me:443/v1/public` | open in 1,123 and 1,045 ms, served a `BTC_USDT` snapshot, W4 |

One socket carries every spot pair, and there is no settlement family to split on.
`ws-api.exmo.com` resolved to 190.115.31.221, the same address as `exmo.com`, see [`rest.md`](./rest.md) section 1.
No socket refused this host, whose traffic leaves through a Canadian VPN exit.

## 2. Channel matrix for public market data

| topic | documented depth and speed, S2 | probed |
|---|---|---|
| `spot/order_book_updates:<pair>` | top 400, 100 ms, snapshot of the top 400 on subscribe, then updates | a `snapshot` on 24 of 24 pairs 217 to 222 ms after the subscribe frame, then no `update` in 100 s, in both runs, W1 |
| `spot/order_book_snapshots:<pair>` | top 25, 100 ms, no snapshot | one `update` frame holding the whole book on subscribe, on `BTC_USDC` and `ETH_USDC`, and no repeat in 100 s, W1 |
| `spot/ticker:<pair>` | "approximately 10s", no snapshot | a `snapshot` frame on subscribe, which the documentation does not mention, then no `update` in 100 s on `BTC_USDC` or in 190 s on `XTZ_USDC`, W1 and W3 |
| `spot/trades:<pair>` | real time, no snapshot | acknowledged, then no frame in 100 s on `BTC_USDC`, whose last trade before the run was at 03:53 UTC, W1 |

No mark, index or funding channel exists, because EXMO has no derivative.
Margin topics exist only on the private URLs, section 7.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL, and private and margin private on their own paths, S1 | 24 pairs on one socket, W1 |
| subscribe frame shape | `{"id": 1, "method": "subscribe", "topics": ["spot/ticker:BTC_USD", "spot/trades:EXM_BTC"]}`, and `id` is optional, S1 | 28 topics in one 1,005 byte frame got 28 acknowledgements, one per topic, W1 |
| unknown symbol expectation | `{"event": "error", "code": 201030, "error": "HPY_BTC pair does not exists"}`, S1 | `{"event":"error","id":11,"code":201030,"message":"pair is not exists, pair: \"NOPE_USDC\""}`. The text sits in `message`, not in `error`, W2 |
| chunk unit and budget | Not publicly specified | 28 topics in one frame, all acknowledged, W1. Every listed pair fits one frame |
| keepalive mechanism | "WS API server sends a ping frame every 3 minutes. If server does not receive a pong frame back within a 10-minute period, the connection will be terminated", S1 | the server sent a protocol ping every 30 s, at 31.0, 61.0, 91.0, 121.0, 151.0 and 181.0 s after open, W1 and W3. A client protocol ping was answered in 212 to 248 ms. No application ping exists |
| connection lifetime and maintenance notice | "A single connection to a WS API server is valid for 24 hours". Maintenance closes the socket with `{"event": "info", "code": 2, "message": "maintenance in progress"}` in the close frame, S1 | no lifetime cap reached in 190 s, and no maintenance seen |
| handshake and operation rate limits | Not publicly specified | no refusal at 28 topics in one frame, and opens took 1,005 to 1,123 ms |
| public market data authentication | none | none |
| message parse and routing | `{ts, event, topic, data}`, S2 | route on `topic`, spelled `<channel>:<pair>`, split at the colon |
| subscribe acknowledgement shape | `{"ts", "id", "event": "subscribed", "topic"}`, S1 | identical. `id` is echoed, and absent when the request carried none. The acknowledgement and the snapshot carry the same `ts`, and the acknowledgement arrived first for every topic, W1 and W2 |
| symbol identifier format | `BTC_USD` | identical to CCXT `market.id` and to the REST pair keys on 24 of 24 pairs, and case sensitive: `btc_usdc` answered 201030, W2 |
| number representation | levels are `["price","quantity","amount"]`, S2 | three strings per level, and `amount` equals price times quantity on every REST bid level checked, see [`rest.md`](./rest.md) section 5 |
| timestamp representation | `ts` in UTC milliseconds, S1 | integer milliseconds. The ticker's `updated` is in seconds |
| size unit | base currency quantity | base currency quantity, and CCXT's `contractSize` is `undefined` for these spot markets, section 4 |
| sequence semantics | none documented | no sequence, update id or checksum on any frame |
| idle repeat behaviour | not documented | nothing repeated: no book, book snapshot or ticker frame arrived again in 100 to 190 s while nothing changed |

## 4. The book channel in detail

`spot/order_book_updates` is the only channel with a snapshot and deltas, so every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame for each topic is `"event": "snapshot"`, documented as the top 400 levels.
All 24 pairs got exactly one snapshot, 217 to 222 ms after the subscribe frame was sent, which is one round trip from this host.
Each snapshot equalled the REST `order_book` read at limit 1,000 within the same two seconds, on both sides, on 24 of 24 pairs in each run of W1.

### Delta semantics

The documented update carries only the changed levels, and a quantity of `"0"` deletes a level, S2.
No update arrived in 100 s on any of the 24 pairs, because no quote changed, so the delta shape is Not verified on the wire.
CCXT Pro resets the book on `snapshot` and applies any other event as deltas by price, at `server/node_modules/ccxt/js/src/pro/exmo.js` lines 564 to 575.

### Sequence and gap rule

None exists.
No frame carries a sequence number, an update id or a checksum, S2 and W1.
A feed therefore cannot detect a lost update, and its only recovery is a new socket, whose subscribe brings a fresh snapshot.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on 24 of 24 pairs | best first, ascending, on 24 of 24 |
| update | not observed | not observed |
| REST `order_book` | descending on 24 of 24 | ascending on 24 of 24 |

### Level window

The documented window is 400 levels, S2.
Every live book held one bid and one ask, and `BTC_USDC` held a second bid of 0.00006 BTC at 0.01 USDC, so the window was never reached.

### Size unit

The second field of a level is the base currency quantity and the third is the quote amount.
The `BTC_USDC` bid `["77310","1","77310"]` is 1 BTC for 77,310 USDC.
CCXT sets `contractSize` to `undefined` for every EXMO market, at `server/node_modules/ccxt/js/src/exmo.js` line 926, and the engine would turn that into 1, which is correct for base units.

### One-sided and empty books

No one-sided or empty book was seen.
What the channel sends for an empty side is Not verified.

### Idle repeats

Nothing is repeated.
`spot/order_book_snapshots`, documented at 100 ms, sent one frame per pair on subscribe and nothing more in 100 s.

### Unknown, closed and malformed requests

| request | reply, W2 |
|---|---|
| `spot/order_book_updates:NOPE_USDC` | code 201030 `pair is not exists, pair: "NOPE_USDC"` |
| `spot/order_book_updates:BTC_USDT`, the one exmo.me pair | code 201030 `pair is not exists, pair: "BTC_USDT"` |
| `spot/order_book_updates:btc_usdc` | code 201030 `pair is not exists, pair: "btc_usdc"` |
| `spot/nope:BTC_USDC` | code 201012 `"spot/nope" is not an api supported topic name` |
| the same book topic twice | the second answers code 201016 `subscription to spot/order_book_updates:BTC_USDC topic already exists`, and the first keeps its subscription |
| unsubscribe of a topic never subscribed | no reply, as documented, S1 |
| method `nope` | code 201008 `"nope" is not allowed api method` |
| text that is not JSON | code 201006 `invalid command format. should be JSON`, and the socket stays open |

A delisted pair answers like an unknown pair, since `BTC_USDT`, listed on exmo.com until the wind-down, now answers 201030.

## 5. Session

| item | documented | probed |
|---|---|---|
| greeting | `{"event": "info", "code": 1, "message": "connection established", "session_id": …}` on connect, S1 | the first frame on every socket |
| keepalive | server ping every 3 minutes, pong within 10 minutes, S1 | server protocol ping every 30 s on every subscribed socket, answered by the `ws` library's automatic pong. Client protocol ping answered in 212 to 248 ms |
| silence the server tolerates | Not publicly specified | a socket with no subscription and no client frame closed at 30.69 s with code 1006 and no close frame, and it got no ping before that, in both runs, W3. A socket subscribed to one quiet ticker stayed open 190 s on the server pings alone |
| forced disconnect | a connection is valid for 24 hours | none in 190 s |
| maintenance notice | close frame with code 2 `maintenance in progress`, reconnect with exponential backoff | not observed |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, so the server does not negotiate it, W4 |
| handshake | | 1,005 to 1,123 ms to open from this host |
| subscription limits | Not publicly specified | one subscription per topic per socket, enforced by code 201016. No cap reached at 28 topics |
| throughput | | 56 frames in 100 s on 28 topics in each run, every one of them a greeting, acknowledgement or first frame |

The clock of this host and the frame `ts` agree: arrival minus `ts` was 107 to 114 ms on 55 frames in each run, against a one way trip of about 107 ms, half the usual 212 to 217 ms ping round trip.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.

Greeting, with the session id cut.

```json
{"ts":1790139015922,"event":"info","code":1,"message":"connection established","session_id":"…"}
```

Subscribe, 28 topics in one frame, shortened here to three.

```json
{"id":1,"method":"subscribe","topics":["spot/order_book_updates:BTC_USDC","spot/order_book_updates:WIF_USDC","spot/ticker:BTC_USDC"]}
```

Acknowledgement, one per topic.

```json
{"ts":1790139016639,"event":"subscribed","id":1,"topic":"spot/order_book_updates:BTC_USDC"}
```

Book snapshots, whole, with the same `ts` as the acknowledgement.

```json
{"ts":1790139016639,"event":"snapshot","topic":"spot/order_book_updates:BTC_USDC","data":{"ask":[["94490","0.98659564","93223.4220236"]],"bid":[["77310","1","77310"],["0.01","0.00006","0.0000006"]]}}
```

```json
{"ts":1790139016639,"event":"snapshot","topic":"spot/order_book_updates:XRP_USDC","data":{"ask":[["1.71","20000","34200"]],"bid":[["1.39","14949.12","20779.2768"]]}}
```

The top 25 channel, which says `update` for its first and only frame.

```json
{"ts":1790139016639,"event":"update","topic":"spot/order_book_snapshots:ETH_USDC","data":{"ask":[["3022.8","10","30228"]],"bid":[["2473.2","10","24732"]]}}
```

Ticker, which sends an undocumented `snapshot` on subscribe.

```json
{"ts":1790139016639,"event":"snapshot","topic":"spot/ticker:BTC_USDC","data":{"buy_price":"77310","sell_price":"94490","last_trade":"94490","high":"94490","low":"75420","avg":"88133.33333333","vol":"0.03093257","vol_curr":"2922.8190513","updated":1790135617}}
```

Delta, from the documentation, S2, since none arrived on the wire.

```json
{"ts":1574427585174,"event":"update","topic":"spot/order_book_updates:BTC_USD","data":{"ask":[["100","1","100"],["200","2","400"]],"bid":[["99","1","99"],["98","0","0"]]}}
```

Errors.

```json
{"ts":1790138996058,"event":"error","id":11,"code":201030,"message":"pair is not exists, pair: \"NOPE_USDC\""}
```

```json
{"ts":1790139000064,"event":"error","id":15,"code":201016,"message":"subscription to spot/order_book_updates:BTC_USDC topic already exists"}
```

```json
{"ts":1790139005074,"event":"error","code":201006,"message":"invalid command format. should be JSON"}
```

Keepalive is a protocol ping and pong, with no JSON payload.

## 7. Private channels

Named for completeness from S1 and CCXT Pro, not probed.

- Login over the socket, built by CCXT Pro at `server/node_modules/ccxt/js/src/pro/exmo.js` line 905.
- Spot: `spot/wallet`, `spot/orders`, `spot/user_trades`, on `/v1/private`.
- Margin: `margin/wallet`, whose frames say `margin/wallets`, then `margin/orders`, `margin/user_trades` and `margin/positions`, on `/v1/margin/private`.
- CCXT Pro routes these at lines 836 to 846.

## 8. Recommended feed shape

None.
EXMO has no perpetual, is winding down, and its books hold one quote about 10 % off a reference that did not move in the probes, see [`fees.md`](./fees.md) section 1.
Were a spot feed ever wanted for research, the wire would support this shape.

| item | value | reason |
|---|---|---|
| URL plan | one socket, `wss://ws-api.exmo.com:443/v1/public` | 24 pairs fit one subscribe frame |
| channel | `spot/order_book_updates:<rawMarketId>` | the only channel with a snapshot and deltas |
| subscribe frame | `{"id": 1, "method": "subscribe", "topics": ["spot/order_book_updates:BTC_USDC", …]}` | one acknowledgement per topic |
| keepalive | none needed beyond the automatic pong, and a client protocol ping every 20 s as a liveness probe | the server pings every 30 s, and `VenueFeed` counts pings and pongs as traffic at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) lines 97 and 98 |
| `maxSilenceMs` | 75,000 | two missed server pings, since a quiet book sends nothing for minutes |
| snapshot | `event === "snapshot"`: `resetBook` | documented replace semantics |
| delta | `event === "update"`: set each level by price, delete on `"0"` | documented, not seen on the wire |
| resync | only on reconnect | there is no sequence to detect a gap |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

The missing sequence is the main protocol weakness: a dropped update would leave the book wrong until the next reconnect.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Exmo API, Websocket v1, General | https://documenter.getpostman.com/view/10287440/SzYXWKPi | 2026-09-23 | EXMO.com | endpoint, greeting, subscribe, acknowledgement, error, unsubscribe, maintenance, 24 hour lifetime, 3 minute ping, sections 1 to 5 |
| S2 | Exmo API, Websocket v1, Public API | https://documenter.getpostman.com/view/10287440/SzYXWKPi | 2026-09-23 | EXMO.com | topic names, depth, speed, snapshot rules, level format, local book recipe, sections 2 to 4 |
| S3 | CCXT Pro 4.5.68 `exmo.js` | `server/node_modules/ccxt/js/src/pro/exmo.js` | 2026-09-23 | CCXT | URLs, book handler, private topics, login, sections 1, 4, 7 |
| S4 | CCXT 4.5.68 `exmo.js` | `server/node_modules/ccxt/js/src/exmo.js` | 2026-09-23 | CCXT | `contractSize` `undefined`, section 4 |
| W1 | `ws-probe.mjs book` at 04:50 UTC, and the second pass at 05:01 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/exmo/ws-probe.mjs) | 2026-09-23 | this host | sections 2 to 6 |
| W2 | `ws-probe.mjs errors` at 04:49 UTC, and the second pass at 05:01 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/exmo/ws-probe.mjs) | 2026-09-23 | this host | sections 3, 4, 6 |
| W3 | `ws-probe.mjs idle` at 04:52 UTC, and `bare` in the second pass at 05:03 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/exmo/ws-probe.mjs) | 2026-09-23 | this host | server ping cadence, silence, section 5 |
| W4 | `ws-probe.mjs deflate` at 04:49 UTC, and the second pass at 05:01 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/exmo/ws-probe.mjs) | 2026-09-23 | this host | compression, the exmo.me socket, sections 1 and 5 |
