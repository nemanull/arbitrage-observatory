# HitBTC WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:14 to 04:20 UTC and again 04:27 to 04:31 UTC, from the development host near Seattle through the user's Surfshark WireGuard tunnel, whose exit geolocates to Canada.

This profile covers the public market data socket of HitBTC API v3 (CCXT id `hitbtc`) for its one perpetual family, the USDT-margined `*USDT_PERP` contracts, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/hitbtc/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Two numbers separated by "and" are the first run and the second run.
The access results are from the Canadian VPN exit, which the website refuses and the API serves, see [`fees.md`](./fees.md) section 1.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals, and spot | `wss://api.hitbtc.com/api/3/ws/public`, S1 "API URLs" | opened in 604 to 1,202 ms on the first connect of each process, served every channel below |
| private trading | `wss://api.hitbtc.com/api/3/ws/trading`, S1 | not probed |
| private wallet | `wss://api.hitbtc.com/api/3/ws/wallet`, S1 | not probed |
| demo | `wss://api.demo.hitbtc.com/api/3/ws/public`, S1 | not probed |

One socket carries spot and perpetuals, since the market is chosen only by the symbol.
The spot `BTCUSDT` and the perpetual `BTCUSDT_PERP` both delivered on one `orderbook/full` subscription on one socket in `ws-probe.mjs errors`.
`api.hitbtc.com` resolved to three Cloudflare addresses, see [`rest.md`](./rest.md) section 1, and the upgrade reply named edge SEA.
CCXT Pro 4.5.68 uses the same public URL, at `server/node_modules/ccxt/js/src/pro/hitbtc.js` line 39.

## 2. Channel matrix for public market data

| channel | documented depth and speed | probed on 2026-09-23 UTC |
|---|---|---|
| `orderbook/full` | snapshot then updates, sent "immediately", S1 | one snapshot of the whole book per symbol, then updates chained by `s`, recommended |
| `orderbook/{depth}/{speed}` | `D5`, `D10`, `D20` at `100ms`, `500ms`, `1000ms`, a whole top-N per push, S1 | `D20/100ms` sent 20 levels per side per frame, almost only when the book changed, median 200 and 101 ms apart on `BTCUSDT_PERP`, up to 13.6 and 19.1 s apart on the two contracts |
| `orderbook/{depth}/{speed}/batch` | the same, several symbols per frame, S1 | `D20/100ms/batch` on 50 perps sent exactly 10 frames a second, 9.3 KB each |
| `orderbook/top/{speed}` and `/batch` | best bid and ask at `100ms`, `500ms`, `1000ms`, S1 | 32 frames in about 58 s and 64 in about 28 s on `BTCUSDT_PERP` |
| `futures/info` | mark, index, premium, funding, next funding, per contract, S1 | one contract per frame, each contract refreshed every 3 s, see section 4 of [`rest.md`](./rest.md) |
| `trades` | snapshot of up to 1,000 then updates, S1 | not probed |
| `ticker/{speed}`, `ticker/price/{speed}` and their `/batch` | `1s`, `3s`, S1 | not probed |
| `candles/{period}`, `converted/candles/{period}`, `price/rate/{speed}` | S1 | not probed |

The mark, index and funding fields ride only on `futures/info`, which refreshes each contract every 3 s, the same cadence as the REST call in [`rest.md`](./rest.md) section 3.
`orderbook/D30/100ms` and `orderbook/D20/200ms` answer error 2003 "Unknown channel", so the depth and speed enums are closed.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL for every market, S1 | spot and perpetual symbols deliver on one socket |
| subscribe frame shape | `{"method": "subscribe", "ch": "orderbook/full", "params": {"symbols": ["ETHBTC"]}, "id": 123}`, S1 | a list of 50 symbols in one frame was acknowledged in one reply and every symbol delivered |
| unknown symbol expectation | error `{"code": 2001, "message": "Symbol not found"}`, S1 "Response Object" | no error. `NOPEUSDT_PERP` alone was acknowledged with `"subscriptions": []`, and next to `BTCUSDT_PERP` it was silently dropped from the list |
| chunk unit and budget | symbols per request not specified, "cannot exceed 100" connections per IP, S1 | 50 symbols in one request, acknowledged in 138 to 149 ms |
| keepalive mechanism | "the system sends ping messages to the client each 30 seconds", S1 "Ping" | protocol pings at 30.0 and 60.1 s in both runs. A client that does not answer is closed at 60.0 to 60.1 s with code 4002 `Ping pong timeout.` |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 75 s, no notice frame seen |
| handshake and operation rate limits | 10 requests a second plus a burst of 10 on `/ws/public`, and at most 100 connections per IP, S1 "Rate Limits" | not tested beyond 14 requests at 2.5 a second |
| public market data authentication | "Session authentication is not needed", S1 | none |
| message parse and routing | `ch` names the channel, and `snapshot`, `update` or `data` holds an object keyed by symbol, S1 | as documented, and every `orderbook/full` frame carried exactly one symbol, 17,829 frames over both runs |
| subscribe acknowledgement shape | `{"result": {"ch": …, "subscriptions": […]}, "id": 123}`, S1 | as documented, and `subscriptions` lists every symbol active on that channel on the socket, not only the request's |
| symbol identifier format | `BTCUSDT_PERP` | identical to CCXT `market.id` and to the key of the REST `futures/info` reply on 55 of 55 contracts, see [`rest.md`](./rest.md) section 2 |
| number representation | prices and sizes as strings, S1 "Number Format" | strings on every book, top of book and `futures/info` level. `t`, `s` and `T` are JSON numbers |
| timestamp representation | `t` in ms, S1 | `t` in Unix ms. `t` minus local arrival on `orderbook/full` was 74 and 73 ms at the minimum and 112 and 137 ms at the median |
| size unit | quantity of the underlying, S1 | base coin, CCXT `contractSize` 1, and the socket book equalled the REST book on 20 of 20 levels per side, section 4 |
| sequence semantics | `s` "Sequence number", no rule published, S1 | on `orderbook/full` each update's `s` is the previous `s` plus 1 per symbol. 0 gaps in 632 and 545 updates on five perps, and 0 in 11,671 and 4,871 on 50 perps |
| idle repeat behaviour | not documented | no repeats on `orderbook/full`. `D20` repeated one frame unchanged, with the same `s`, in 187 frames of the second run. A quiet book sends nothing, `ZRXUSDT_PERP` went 11.4 and 6.7 s without a frame, and an empty book sent nothing after its snapshot for 60 s |

## 4. The book channel in detail

`orderbook/full` is the channel this profile recommends, and every row is about it unless it says otherwise.

### Snapshot on subscribe

The first frame per symbol is `{"ch": "orderbook/full", "snapshot": {"<symbol>": {"t", "s", "a", "b"}}}` holding the whole book.
On 2026-09-23 the snapshots held 297 bids and 181 asks on `BTCUSDT_PERP`, 169 and 185 on `ETHUSDT_PERP`, 155 and 156 on `SOLUSDT_PERP`, 126 and 120 on `HITUSDT_PERP`, and 20 and 19 on `ZRXUSDT_PERP`.
In the second run `BTCUSDT_PERP` held 291 bids and 185 asks.
Over 50 perpetuals the larger side of the snapshot held 0 to 293 levels, median 27, and 0 to 296, median 25.
Each symbol got exactly one snapshot in each run, and the snapshot carried no zero size, although the documentation's example shows `"0"` sizes in a snapshot, S1.

### Delta semantics

An update is `{"ch": "orderbook/full", "update": {"<symbol>": {"t", "s", "a", "b"}}}` with the changed levels as `[price, size]` string pairs.
A size of `"0"` deletes the level, and a side with no change arrives as an empty array `[]`, not as a missing key.
An update with both sides empty is legal and only advances `s`: 2 of 632 and 1 of 545 in the five perp runs, and 7 of 11,671 and 2 of 4,871 in the 50 perp runs.

### Sequence and gap rule

```text
snapshot            replace the book, last = s
update, s = last + 1    apply, last = s
update, s ≠ last + 1    gap: resubscribe the symbol, or terminate the socket (the engine's resync)
```

The first update after each snapshot had `s` equal to the snapshot's `s` plus 1 on 5 of 5 perps in both runs.
The rule held on every update of both runs, with 0 gaps and 0 repeated or backward `s`.
The documentation gives no gap rule, so the rule is taken from the wire, and CCXT Pro stores `s` as the book nonce without checking it, at `server/node_modules/ccxt/js/src/pro/hitbtc.js` lines 287 and 300.
The `D20` and `top` channels carry the same book sequence: `D20` frames on `BTCUSDT_PERP` stepped `s` by 1 to 14 between pushes, because a push folds every update since the last one.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `orderbook/full` snapshot | descending, 5 of 5 perps in both runs | ascending, 5 of 5 |
| `orderbook/full` update | descending, 0 violations in 632 and 545 updates | ascending, 0 violations |
| `orderbook/D20/100ms` | descending, 129 of 129 and 187 of 187 frames | ascending, all frames |
| REST `orderbook` | descending at depth 0, 20 and 100 | ascending |

The update arrays arrived sorted, but a feed applies them by price, which does not rely on the order.

### Level window

`orderbook/full` has no window: the snapshot is the whole book, and a feed that applies every update holds it all.
The maintained `BTCUSDT_PERP` book reached 298 and 301 levels on one side, against 294 bids and 182 asks, and 298 and 186, from the REST book at depth 0.
The engine's `OrderBook` keeps every level it is given, in `server/src/feeds/book/OrderBook.ts`, so the whole book is held and the top 20 are published.
`orderbook/D20/100ms` is the bounded alternative: each push is exactly 20 bids and 20 asks, so a feed resets the book on every frame and needs no sequence rule.

### Size unit against CCXT `contractSize`

| contract | CCXT `contractSize` | socket size at the touch | REST size at the same price | unit |
|---|---:|---|---|---|
| `BTCUSDT_PERP` | 1 | `"0.0111"` at bid 86,916.93 | `"0.0111"` | BTC |
| `HITUSDT_PERP` | 1 | `"17391"` at bid 0.2578 | `"17391"` | HIT |

At the end of each run the socket book equalled a REST book at depth 20 on 20 of 20 bids and 20 of 20 asks on both contracts.
CCXT sets `contractSize` to 1 on every HitBTC contract, at `server/node_modules/ccxt/js/src/hitbtc.js` line 840, and the `quantity_increment` of `0.0001` BTC on `BTCUSDT_PERP` confirms that sizes are in the base coin.
The engine's `sizeMul` of 1 therefore reads HitBTC sizes correctly.

### One-sided and empty books

`CELUSDT_PERP` is `working` in the catalog and has an empty book.
Its snapshot is `{"t": …, "s": 1, "a": [], "b": []}`, and nothing followed in 60 s.
The suspended `PEPEUSDT_PERP` and the expired `TONUSDT_PERP` answer the same empty snapshot with `s` 1, and so does `D20/100ms` for `CELUSDT_PERP` and `PEPEUSDT_PERP`.
No one-sided book was seen, and the engine's `resetBook` accepts an empty side.

### Idle repeats

Nothing is repeated on `orderbook/full` or `D20`.
Over 50 perpetuals the longest silence per symbol ran from 0.7 to 8.1 s, median 1.5 s, in the 60 s batch run, and from 1.0 to 12.4 s, median 1.6 s, in the 30 s rerun.
`orderbook/top/100ms` sent 5 frames in 32, and 3 in 64, whose prices and sizes equalled the previous frame's.
`D20` sent one such frame in 187, with the same `s`, in the second run.

### Unknown, closed and wrong-level symbols

| request | reply | then |
|---|---|---|
| `orderbook/full` `NOPEUSDT_PERP` | `{"result": {"ch": "orderbook/full", "subscriptions": []}, "id": 11}` | nothing |
| `orderbook/full` `BTCUSDT_PERP` and `NOPEUSDT_PERP` | `subscriptions` `["BTCUSDT_PERP"]` | the valid symbol delivers |
| `orderbook/full` `BTCUSDT_PERP` twice | the second is acknowledged like the first, no error | no second snapshot, 1 snapshot in 21 frames |
| `orderbook/full` `PEPEUSDT_PERP`, `TONUSDT_PERP`, `CELUSDT_PERP` | acknowledged | one empty snapshot each, `s` 1 |
| `orderbook/full` `["*"]` | acknowledged with the list unchanged | nothing new, the wildcard works only on the partial and top channels, S1 |
| `orderbook/D30/100ms` | `{"error": {"code": 2003, "message": "Unknown channel", "description": "Channel is not supported: orderbook/D30/100ms"}, "id": 16}` | |
| method `nope` | `{"error": {"code": 404, "message": "Unsupported API method", "description": "Method is not supported: nope"}, "id": 20}` | |
| text that is not JSON | `{"error": {"code": 1, "message": "Invalid json", "description": "JSON request is corrupted."}}`, with no `id` | the socket stays open |

Because an unknown symbol is acknowledged without an error, the feed has to notice a symbol with no snapshot on its own, or compare the acknowledged list with the request.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server protocol ping every 30 s, S1 | pings at 30.0 and 60.1 s on an idle socket, and at 32.4 s after the subscribe on the book socket. `ws` answers them automatically |
| silence the server tolerates | Not publicly specified | an idle socket that answered pings, with no subscription and no client frame, stayed open for the full 75 s. A socket that did not answer the 30 s ping was closed at 60.0 and 60.1 s with code 4002 and reason `Ping pong timeout.`, subscribed or not |
| forced disconnect | Not publicly specified | none in 75 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no extension back |
| handshake | | 604 to 1,202 ms to open, the first socket of each process |
| subscription limits | 10 requests a second and a burst of 10 on `/ws/public`, 100 connections per IP | no cap reached at 50 symbols on one socket |
| throughput | | `orderbook/full` on the 50 working perpetuals: 11,721 frames in 60 s, median 194 a second, peak 307, 44 KB a second, 228 bytes a frame, 12.2 µs `JSON.parse` a frame. The 30 s rerun: 4,921 frames, median 170 a second, peak 251, 38 KB a second, 231 bytes a frame, 8.6 µs. `D20/100ms/batch` on the same 50 in the first run: 10 frames a second, 93 KB a second, 445 µs `JSON.parse` a frame |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Level arrays are cut to the first few levels.

Subscribe and acknowledgement.

```json
{"method": "subscribe", "ch": "orderbook/full", "params": {"symbols": ["BTCUSDT_PERP", "ETHUSDT_PERP", "SOLUSDT_PERP", "HITUSDT_PERP", "ZRXUSDT_PERP"]}, "id": 1}
```

```json
{"result": {"ch": "orderbook/full", "subscriptions": ["ETHUSDT_PERP", "SOLUSDT_PERP", "ZRXUSDT_PERP", "BTCUSDT_PERP", "HITUSDT_PERP"]}, "id": 1}
```

Snapshot, first three levels per side kept of 19 asks and 20 bids.

```json
{"ch": "orderbook/full", "snapshot": {"ZRXUSDT_PERP": {"t": 1790136886715, "s": 559390, "a": [["0.12484", "2327.2"], ["0.12485", "5275.6"], ["0.12486", "2662.5"]], "b": [["0.12453", "2228.7"], ["0.12449", "11476.9"], ["0.12440", "4602.3"]]}}}
```

Two consecutive updates, one with an empty ask side.

```json
{"ch": "orderbook/full", "update": {"BTCUSDT_PERP": {"t": 1790136889618, "s": 1328122, "a": [], "b": [["86837.60", "0.0009"], ["86836.26", "0"]]}}}
```

```json
{"ch": "orderbook/full", "update": {"BTCUSDT_PERP": {"t": 1790136889822, "s": 1328123, "a": [], "b": [["86846.97", "0.0111"], ["86836.89", "0"], ["86822.42", "0.0676"], ["86820.20", "0"]]}}}
```

Empty book of a `working` contract.

```json
{"ch": "orderbook/full", "snapshot": {"CELUSDT_PERP": {"t": 1790137077996, "s": 1, "a": [], "b": []}}}
```

Partial book, first two levels per side kept of 20, with the same `s` as the full channel.

```json
{"ch": "orderbook/D20/100ms", "data": {"BTCUSDT_PERP": {"t": 1790136890208, "s": 1328126, "a": [["86870.57", "0.0119"], ["86874.34", "0.0208"]], "b": [["86846.97", "0.0111"], ["86842.87", "0.0202"]]}}}
```

Top of book.

```json
{"ch": "orderbook/top/100ms", "data": {"BTCUSDT_PERP": {"t": 1790136890208, "a": "86870.57", "A": "0.0119", "b": "86846.97", "B": "0.0111"}}}
```

Futures information, which carries the anchor fields.

```json
{"ch": "futures/info", "data": {"AAVEUSDT_PERP": {"c": "perpetual", "t": 1790136889631, "m": "150.893", "i": "150.886", "p": "0", "P": "0", "o": "6.00", "r": "0.0001", "R": "0.0001", "T": 1790150400000, "I": "0.0001"}}}
```

Errors.

```json
{"error": {"code": 2003, "message": "Unknown channel", "description": "Channel is not supported: orderbook/D20/200ms"}, "id": 17}
```

```json
{"error": {"code": 1, "message": "Invalid json", "description": "JSON request is corrupted."}}
```

The close of a socket that did not answer a ping was code `4002` with reason `Ping pong timeout.`, and it carried no JSON frame.

## 7. Private channels

Named for a future execution stage, from S1, not probed.

- `wss://api.hitbtc.com/api/3/ws/trading` takes `login`, then `spot_subscribe`, `margin_subscribe` and `futures_subscribe` for order reports, `futures_balance_subscribe` for balances, `futures_new_order`, `futures_new_order_list`, `futures_replace_order`, `futures_cancel_order` and `futures_close_position` for order entry, and `futures_get_accounts`, `futures_get_orders`, `futures_balances` and `futures_fees` for reads.
- `wss://api.hitbtc.com/api/3/ws/wallet` takes `login`, `subscribe_transactions` and `subscribe_wallet_balances`.
- Login uses Basic or HS256 authentication, S1 "Socket Authentication", and CCXT Pro builds the HS256 `login` request in `authenticate` at `server/node_modules/ccxt/js/src/pro/hitbtc.js` lines 89 to 104.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://api.hitbtc.com/api/3/ws/public` | one URL carries every market |
| channel | `orderbook/full` | snapshot on subscribe, a strict `s + 1` chain per symbol, sizes in the base coin |
| alternative channel | `orderbook/D20/100ms`, with `resetBook` on every frame | exactly 20 levels and no gap rule, at the cost of up to 100 ms of batching and about twice the parse time per second on 50 perps in the first run, 4.5 ms against 2.4 ms |
| markets per connection | 50, all working perpetuals on one socket | 50 symbols ran with 0 gaps at a median 194 and 170 frames a second, and the venue lists only 50 |
| subscribe frames | one frame, `{"method": "subscribe", "ch": "orderbook/full", "params": {"symbols": [<rawMarketId>, …]}, "id": 1}` | a 50 symbol request was acknowledged as one |
| acknowledgement check | compare `result.subscriptions` with the requested ids and log the missing ones | an unknown symbol is acknowledged without an error |
| keepalive | none from the client, the `ws` library answers the server ping | the server pings every 30 s and closes at 60 s only when the pong is missing |
| `maxSilenceMs` | 75,000 | the server ping every 30 s counts as traffic in `VenueFeed`, a quiet book went 12.4 s without a frame, and 75 s is two missed pings plus margin |
| routing | the single key of `snapshot` or `update` is the `rawMarketId` | one symbol per frame on every frame seen |
| snapshot | `resetBook` and store `s` | the whole book comes in one frame |
| delta | apply only when `s === last + 1`, then store `s`, including for an update with both sides empty | 0 gaps observed |
| resync | `s !== last + 1`, or an update before any snapshot: `resync` | the engine's existing path |
| empty book | accept a snapshot with `s` 1 and two empty sides, and publish nothing | `CELUSDT_PERP` is working and empty |
| receive time | stamp on arrival, never from `t` | `t` is the venue's clock |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | HitBTC API v3 reference, Socket API sections and "Rate Limits" | https://api.hitbtc.com/ | 2026-09-22 | HitBTC, global | URLs, channel names, depth and speed enums, request and response shapes, ping, connection and request limits, private methods, sections 1 to 7 |
| S2 | CCXT Pro 4.5.68 `hitbtc.js` | `server/node_modules/ccxt/js/src/pro/hitbtc.js` | 2026-09-22 | CCXT | public URL, default book channel at line 62, unchecked sequence at lines 287 and 300, sections 1, 4 and 7 |
| S3 | CCXT 4.5.68 `hitbtc.js` | `server/node_modules/ccxt/js/src/hitbtc.js` | 2026-09-22 | CCXT | `contractSize` 1 at line 840, section 4 |
| P1 | `ws-probe.mjs book`, 60 s at 04:14:48 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hitbtc/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 2 to 6 |
| P2 | `ws-probe.mjs batch`, 60 s at 04:16:30 UTC, and `BATCH_CH=d20`, 20 s at 04:17:32 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hitbtc/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 3 to 5 |
| P3 | `ws-probe.mjs silence`, 75 s at 04:18:06 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hitbtc/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | section 5 |
| P4 | `ws-probe.mjs errors` and `deflate` at 04:14:15 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hitbtc/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 3 to 6 |
| P5 | second pass: `book` for 30 s at 04:27:44, `errors`, `deflate`, `batch` for 30 s at 04:28:49 and `silence` for 75 s at 04:29:20 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/hitbtc/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian VPN exit | sections 1 to 5, the second numbers |
