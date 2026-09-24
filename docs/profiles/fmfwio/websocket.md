# FMFW.io WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:35 to 04:43 UTC and a second pass at 04:50 to 04:54 UTC, from the development host near Seattle through the user's Surfshark WireGuard tunnel, whose exit geolocates to Canada.

This profile covers the public market data socket of FMFW.io API v3 (CCXT id `fmfwio`) for its one perpetual family, USDT-margined linear contracts, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/fmfwio/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
CCXT 4.5.68 ships no Pro class for `fmfwio`, only `server/node_modules/ccxt/js/src/pro/hitbtc.js`, whose public URL is `wss://api.hitbtc.com/api/3/ws/public` at line 39.
All access results are from the Canadian VPN exit, and Canada is a derivatives-restricted region, see [`fees.md`](./fees.md) section 1.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| all public market data, spot and perpetuals | `wss://api.fmfw.io/api/3/ws/public`, S1 | opened in 545 to 1,243 ms on every timed open, no refusal |
| trading, including futures orders | `wss://api.fmfw.io/api/3/ws/trading`, S1 | not probed, private |
| wallet | `wss://api.fmfw.io/api/3/ws/wallet`, S1 | not probed, private |

One socket carries every public symbol.
On one socket, `BTCUSDT` spot and `BTCUSDT_PERP` both delivered `orderbook/full` snapshots and updates, P3.
The host sits behind Cloudflare, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | depth and speed, S1 | probed |
|---|---|---|
| `orderbook/full` | every level, snapshot then updates | snapshot on subscribe then updates chained by `s`, recommended |
| `orderbook/{depth}/{speed}` | `D5`, `D10`, `D20` at `100ms`, `500ms`, `1000ms` | `D20/100ms`: a whole 20 level book per frame, only when it changed, sharing the `s` of `orderbook/full` |
| `orderbook/{depth}/{speed}/batch` | same, several symbols per frame | not probed |
| `orderbook/top/{speed}` and `/batch` | best bid and ask at `100ms`, `500ms`, `1000ms` | `top/100ms` on BTC: 69, 35 and 31 frames in 62 to 65 s |
| `ticker/{speed}`, `ticker/price/{speed}`, `price/rate/{speed}`, each with `/batch` | `1s`, `3s` | not probed |
| `trades`, `candles/{period}`, `converted/candles/{period}` | snapshot then updates | not probed |
| `futures/info` | mark, index, premium, open interest, rate, indicative rate, interest, next funding, `["*"]` allowed | one contract per frame, each contract every 3,000 ms median, frames arrive a median of 66 to 74 ms after their `t` |

No separate mark, index or funding channel exists, since `futures/info` carries all of them.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL for all market data, S1 | spot and perpetual symbols on one socket, section 1 |
| subscribe frame shape | `{"method": "subscribe", "ch": "orderbook/full", "params": {"symbols": ["ETHBTC"]}, "id": 123}`, S1 | as documented, several symbols per frame |
| unknown symbol expectation | error `{"code": 2001, "message": "Symbol not found"}` in the generic example, S1 | `orderbook/full` answers `{"result":{"ch":"orderbook/full","subscriptions":[]},"id":1}` and no error. A mixed list is acked with the valid symbols only |
| chunk unit and budget | symbols per request not specified. 10 requests per second plus a burst of 10 on `/ws/public`, 100 connections per IP, S1 | 23 perpetuals in one frame were acked as 23 subscriptions, and each sent a snapshot |
| keepalive mechanism | "the system sends ping messages to the client each 30 seconds", S1 | protocol pings at 30.0, 60.1 and 90.3 s, and at 31.7 and 61.9 s. No application ping is documented |
| connection lifetime and maintenance notice | Not publicly specified | no lifetime cap in 120 s, no notice seen |
| handshake and operation rate limits | 100 connections per IP, 10 requests per second plus 10 burst, S1 | no refusal at 5 requests per second |
| public market data authentication | "Session authentication is not needed.", S1 | none |
| message parse and routing | `{"ch", "snapshot" or "update" or "data": {<symbol>: {...}}}`, S1 | as documented. Every `orderbook/full` frame carried exactly one symbol, 794 of 794 captured updates, and `futures/info` one contract per frame |
| subscribe acknowledgement shape | `{"result": {"ch", "subscriptions": [...]}, "id"}`, S1 | as documented. `subscriptions` lists every active symbol on the channel, not only the new ones |
| symbol identifier format | `BTCUSDT_PERP` in the `futures/info` example, S1 | identical to CCXT `market.id` and to the keys of REST `/public/futures/info` on 24 of 24 contracts |
| number representation | prices and sizes as strings, S1 | strings, for example `["87191.34","0"]` |
| timestamp representation | `t` in ms, S1 | integer ms. `futures/info` also sends `T`, the next funding, in ms |
| size unit | Not publicly specified | base currency, which is CCXT `contractSize` 1, section 4 |
| sequence semantics | `s` "Sequence number", no gap rule written, S1 | `s` rose by exactly 1 per frame per symbol, 0 gaps in 977, 794 and 681 updates in three book runs and in 3,657 and 3,622 updates in two batch runs, and the first update followed the snapshot's `s` by 1 |
| idle repeat behaviour | not documented | no repeated `s` on `orderbook/full`. One `D20` frame of 981 repeated the previous `s` and content. Four updates over three runs carried empty `a` and `b` with a new `s` |

## 4. The book channel in detail

`orderbook/full` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame for each symbol is a `snapshot` with every level of both sides and the symbol's `s`, 135 to 158 ms after the subscribe frame was sent, P1.
`BTCUSDT_PERP` snapshots held 294 to 300 bids and 183 to 187 asks, `ETHUSDT_PERP` 161 to 169 bids, and thin contracts such as `ATOMUSDT_PERP` 15 to 18 per side, P1 and P2.
A second subscribe to the same symbol was acked and sent no new snapshot, while the first stream kept delivering, P3.
The documentation says "the first snapshot comes right after the response if the limit parameter is greater than 0", S1, and `orderbook/full` takes no `limit` and still sent one every time.

### Delta semantics

An `update` carries `t`, `s`, `a` and `b`, where each level is `[price, size]` and a size of `"0"` deletes the level.
Updates are absolute sizes at a price, not increments.
The documentation's snapshot example contains `"0"` sizes, S1, and 0 zero sizes appeared in any probed snapshot, P1.
A book kept from the snapshot and every update was never crossed and never one-sided on the five probed contracts, P1.

### Sequence and gap rule

```text
snapshot                      replace the book, last = s
update, s = last + 1          apply, last = s
update, s ≠ last + 1          gap: resync (not documented, inferred from the observed +1 chain)
```

`s` is per symbol, for example `1334525` on BTC and `878837` on ATOM, and it is `1` on the expired `LUNAUSDT_PERP` and the empty `CELUSDT_PERP`.
The rule held on every update of every run with 0 gaps.
`orderbook/D20/100ms` numbers its frames with the same `s`.
At an equal `s` its 20 levels per side were identical to the top 20 of the book kept from `orderbook/full` on 155 of 155 BTC frames and 189 of 189 ATOM frames in the second run, and on 102 of 102 and 92 of 92 in the third, P1.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `orderbook/full` snapshot | descending on 5 of 5 contracts in three runs | ascending on 5 of 5 |
| `orderbook/full` update | descending in every update, 0 out of order in 2,452 updates over three runs | ascending, 0 out of order |
| `orderbook/D20/100ms` | descending | ascending |
| REST `/public/orderbook` | descending at depth 0, 5, 20 and 100 | ascending |

A feed still applies updates by price, since the order within an update is not documented.

### Level window

`orderbook/full` has no window.
The kept BTC book reached 301 bids and 190 asks, and the REST full book at `depth=0` held 292 bids and 188 asks, P1 and [`rest.md`](./rest.md) section 5.
The engine keeps 20 levels per side, so a feed hands the top 20 of the kept book to `updateBook`.

### Size unit against CCXT `contractSize`

| contract | CCXT `contractSize` | socket size at the touch | REST size at the same price | meaning |
|---|---:|---|---|---|
| `BTCUSDT_PERP` | 1 | `"0.0111"` at `87149.88` | `"0.0111"` | 0.0111 BTC, about 967 USDT |
| `ATOMUSDT_PERP` | 1 | `"448.467"` at `1.739` | `"448.467"` | 448.467 ATOM |

The unit is the base currency, which CCXT's `contractSize` of 1 describes, set for every contract at `server/node_modules/ccxt/js/src/hitbtc.js` line 840.
`quantity_increment` is `0.0001` on BTC and `1000` on SHIB, which only makes sense in coins, see [`rest.md`](./rest.md) section 2.
In the second and third runs the kept book equalled the REST book level for level at three reads per contract: BTC 40 of 40, 39 of 40, 40 of 40, 40 of 40, 40 of 40 and 40 of 40 sizes, and ATOM 28 of 28, 31 of 31, 30 of 30, 29 of 29, 29 of 29 and 31 of 31, P1.
In the first run the single compare at the end found 22 of 40 BTC sizes equal and the best bid 87,204.86 on the socket against 87,190.56 in REST with the same size, and the REST call carries no sequence, so that read is not aligned.

### One-sided and empty books

`LUNAUSDT_PERP`, status `expired`, and `CELUSDT_PERP`, status `working`, each answered with a snapshot of 0 bids and 0 asks and `s` 1, and then sent nothing, P3 and P2.
No live contract went one-sided.
The engine's `resetBook` accepts an empty side.

### Idle repeats

Nothing is repeated.
The longest silence on `orderbook/full` was 1.5 to 3.0 s per contract in the book runs and 3.0 s in both batch runs, on `BNBUSDT_PERP` and `ZECUSDT_PERP`, so every live contract updated at least every 3 s, P1 and P2.
`orderbook/D20/100ms` sends only when the 20 levels changed, and BTC went 5.3, 3.7 and 10.5 s without a `D20` frame while `orderbook/full` kept updating deeper levels.
One `D20` frame of 981 over three runs repeated the previous frame's `s` and content, on ATOM.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `orderbook/full` `NOPEUSDT_PERP` | `{"result":{"ch":"orderbook/full","subscriptions":[]},"id":1}` | nothing |
| `orderbook/full` `BTCUSDT_PERP` and `NOPEUSDT_PERP` | result listing `BTCUSDT_PERP` only | BTC snapshot |
| `orderbook/full` `BTCUSDT_PERP` a second time | result listing the active symbols | no new snapshot |
| `orderbook/full` `LUNAUSDT_PERP`, expired | result | empty snapshot, `s` 1 |
| `orderbook/full` `CELUSDT_PERP`, no book | result | empty snapshot, `s` 1 |
| `orderbook/full` `["*"]` | result with the list unchanged | nothing added |
| `orderbook/nope`, `orderbook/D30/100ms`, `orderbook/D20/50ms` | `{"error":{"code":2003,"message":"Unknown channel","description":"Channel is not supported: orderbook/D30/100ms"},"id":5}` | |
| text that is not JSON | `{"error":{"code":1,"message":"Invalid json","description":"JSON request is corrupted."}}` | the socket stays open |

A feed checks the ack's `subscriptions` list, because an unknown symbol is dropped silently from it.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server protocol ping every 30 s, S1 | pings at 30.0, 60.1 and 90.3 s on an idle socket, and at 30.0 and 60.1 s in the rerun. The `ws` library answers them by default, and `VenueFeed` counts a ping as traffic at `server/src/feeds/book/VenueFeed.ts` line 97 |
| missed pong | Not publicly specified | a socket that did not answer the first ping closed at 60.0 s idle and 60.1 s subscribed, with code 4002 and reason `Ping pong timeout.`, the same in the rerun |
| silence the server tolerates | Not publicly specified | an unsubscribed socket that answered pings stayed open for the full 120 s, and 70 s in the rerun, with 0 data frames |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | none documented on the socket. REST documents 503 for maintenance | not observed |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, so the server does not negotiate it |
| handshake | | 545 to 1,243 ms to open from this host |
| subscription limits | 10 requests per second plus 10 burst, 100 connections per IP, S1 | no cap reached with 23 symbols in one frame |
| throughput | | 23 perpetuals on one socket for 60 s: 61 frames per second in both runs, median 63 and 59, peak 109 and 96, 15.7 and 15.4 KB per second, 257 and 253 bytes per frame, 12.8 and 14.4 µs `JSON.parse` per frame, 0 gaps in 3,657 and 3,622 updates |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Each frame says where its level arrays were cut.

Subscribe and acknowledgement.

```json
{"method": "subscribe", "ch": "orderbook/full", "params": {"symbols": ["BTCUSDT_PERP"]}, "id": 1}
```

```json
{"result":{"ch":"orderbook/full","subscriptions":["ETHUSDT_PERP","BTCUSDT_PERP"]},"id":2}
```

Snapshot, first three levels per side kept.

```json
{"ch":"orderbook/full","snapshot":{"BTCUSDT_PERP":{"t":1790138281890,"s":1334525,"a":[["87227.15","0.0119"],["87230.95","0.0208"],["87231.51","0.0600"]],"b":[["87195.11","0.0579"],["87191.90","0.0111"],["87191.34","0.4436"]]}}}
```

The first update after it, cut to the first four of its 32 bid levels, and an update with no levels.

```json
{"ch":"orderbook/full","update":{"BTCUSDT_PERP":{"t":1790138282090,"s":1334526,"a":[],"b":[["87191.34","0"],["87190.61","0"],["87189.97","0"],["87179.51","0"]]}}}
```

```json
{"ch":"orderbook/full","update":{"BTCUSDT_PERP":{"t":1790138331428,"s":1334691,"a":[],"b":[]}}}
```

Partial book and top of book, cut to two levels.

```json
{"ch":"orderbook/D20/100ms","data":{"ATOMUSDT_PERP":{"t":1790138282791,"s":878837,"a":[["1.929","1235.893"],["1.931","963.006"]],"b":[["1.740","935.913"],["1.739","816.289"]]}}}
```

```json
{"ch":"orderbook/top/100ms","data":{"BTCUSDT_PERP":{"t":1790138283122,"a":"87222.95","A":"0.0119","b":"87195.11","B":"0.0579"}}}
```

Futures information, which carries the anchor fields.

```json
{"ch":"futures/info","data":{"BTCUSDT_PERP":{"c":"perpetual","t":1790138282100,"m":"87201.65","i":"87197.98","p":"0","P":"0.000037481692872402","o":"12.3564","r":"0.0001","R":"0.0001","T":1790150400000,"I":"0.0001"}}}
```

Errors.

```json
{"error":{"code":2003,"message":"Unknown channel","description":"Channel is not supported: orderbook/D30/100ms"},"id":5}
```

```json
{"error":{"code":1,"message":"Invalid json","description":"JSON request is corrupted."}}
```

Keepalive is a protocol ping frame with no payload, so there is no JSON to quote.

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use `wss://api.fmfw.io/api/3/ws/trading` after a `login` with Basic or HS256 credentials.

- Futures methods: `futures_subscribe`, `futures_new_order`, `futures_new_order_list`, `futures_cancel_order`, `futures_replace_order`, `futures_orders`, `futures_order`, `futures_close_position`, `futures_set_leverage`, `futures_balance_subscribe`, `futures_balances`, `futures_balance`, `futures_get_accounts`, `futures_account`, `futures_accounts`, `futures_account_cross`, `futures_position_cross`, `futures_set_account`, `futures_fees`, `futures_fee`.
- Wallet notifications use `wss://api.fmfw.io/api/3/ws/wallet`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan on `wss://api.fmfw.io/api/3/ws/public` | one URL serves every symbol |
| channel | `orderbook/full` | snapshot on subscribe, a strict `s + 1` chain, every level, so the top 20 is always exact |
| markets per connection | all 22 live perpetuals on one socket | 23 ran at 61 frames per second with 0 gaps, and 100 connections per IP is far away |
| subscribe frames | one frame, `{"method":"subscribe","ch":"orderbook/full","params":{"symbols":["BTCUSDT_PERP", …]},"id":1}` | acked as one, and the request budget is 10 per second |
| keepalive | none sent. Keep the `ws` default that answers protocol pings | the server pings every 30 s and drops a socket that misses one pong at the next ping |
| `maxSilenceMs` | 45,000 | the 30 s server ping counts as traffic, and the longest data silence on a live contract was 3.0 s, so 45 s means a missed ping plus margin |
| routing | the single key of `snapshot` or `update` is the `rawMarketId` | one symbol per frame on the wire |
| snapshot | `snapshot`: `resetBook` and store `s` | it replaces the book |
| update | apply only when `s === last + 1`, then store `s`, including for an update with empty `a` and `b` | 0 gaps observed, and the empty update still moves `s` |
| resync | `s !== last + 1`, or an update before any snapshot: `resync`, which terminates the socket and resubscribes | no in-band resnapshot exists, since a second subscribe sends no snapshot |
| unserved symbol | compare the ack's `subscriptions` with the slice and log what is missing | an unknown symbol is dropped from the ack without an error |
| skip | `LUNAUSDT_PERP` and `CELUSDT_PERP` | both send one empty snapshot and nothing else |
| receive time | stamp on arrival, never from `t` | the engine's rule, and `t` is the matching engine's time |
| sizes | `Number()` of the string, in base currency | `contractSize` 1 |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | FMFW.io API Documentation v3, sections "API URLs", "Rate Limits", "Socket API Reference" and "Socket Market Data" | https://api.fmfw.io/ | 2026-09-22 | FMFW.io | URLs, limits, ping, request and response shapes, channel names and speeds, private method names, sections 1 to 7 |
| S2 | CCXT Pro 4.5.68 `hitbtc.js` | `server/node_modules/ccxt/js/src/pro/hitbtc.js` | 2026-09-22 | CCXT | no `fmfwio` Pro class, HitBTC URL |
| S3 | CCXT 4.5.68 `hitbtc.js` | `server/node_modules/ccxt/js/src/hitbtc.js` | 2026-09-22 | CCXT | `contractSize` 1, section 4 |
| P1 | `ws-probe.mjs book`, runs at 04:36, 04:38 and 04:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/fmfwio/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 2 to 6 |
| P2 | `ws-probe.mjs batch` at 04:39 and 04:52 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/fmfwio/ws-probe.mjs) | 2026-09-23 UTC | this host | throughput, idle, empty CEL book |
| P3 | `ws-probe.mjs errors` and `deflate` at 04:35 and 04:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/fmfwio/ws-probe.mjs) | 2026-09-23 UTC | this host | errors, duplicate, spot on the same socket, compression |
| P4 | `ws-probe.mjs silence` at 04:40 to 04:42 UTC, and with `DURATION_S=70` at 04:53 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/fmfwio/ws-probe.mjs) | 2026-09-23 UTC | this host | pings, missed pong close, idle tolerance |
