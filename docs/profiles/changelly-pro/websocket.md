# Changelly PRO WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 04:40 to 05:01 UTC), from the development host near Seattle, through its Surfshark WireGuard exit in Canada.

This profile covers the public market data socket of Changelly PRO's API v3 for its one perpetual family, USDT-M, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/changelly-pro/ws-probe.mjs), and the capture is quoted beside the documented value.
The API is HitBTC's API v3 served on Changelly PRO's host, and the books behind it are HitBTC's, see [`rest.md`](./rest.md) section 2.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals, and spot | `wss://api.pro.changelly.com/api/3/ws/public`, S1 | open in 467 to 1,194 ms over fourteen sockets, no refusal |
| trading, private | `wss://api.pro.changelly.com/api/3/ws/trading`, S1 | not probed |
| wallet, private | `wss://api.pro.changelly.com/api/3/ws/wallet`, S1 | not probed |

One public socket carries every symbol, spot and perpetual, and a symbol is named by its catalog id, so `BTCUSDT_PERP` is the perpetual and `BTCUSDT` the spot pair.
The host resolved to three Cloudflare addresses, and Cloudflare served it from `colo=YVR` with `loc=CA`, see [`rest.md`](./rest.md) section 1.
CCXT Pro's `hitbtc` points at `wss://api.hitbtc.com/api/3/ws/public` at `server/node_modules/ccxt/js/src/pro/hitbtc.js` line 39, so it needs the same URL override as the REST class.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed on 2026-09-22 |
|---|---|---|---|
| `orderbook/full` | `{"symbols": [...]}` | every level, snapshot then updates sent "immediately" | snapshot of 133 to 300 levels per side, then updates chained by `s`, recommended |
| `orderbook/{depth}/{speed}` | same | `D5`, `D10`, `D20` at `100ms`, `500ms`, `1000ms` | `D20/100ms` sends 20 levels per side as a whole snapshot, only when the top 20 changed, up to 7.5 and 13.9 s apart per symbol in two runs |
| `orderbook/{depth}/{speed}/batch` | same | same | one frame can carry several symbols, same content |
| `orderbook/top/{speed}` and `/batch` | same | `100ms`, `500ms`, `1000ms` | best bid and ask with sizes, per symbol gap median 1,000 and 1,401 ms, max 15.2 and 24.7 s |
| `ticker/{speed}` and `/batch` | same | `1s`, `3s` | per symbol gap median about 2,000 ms, max 9.2 and 20.0 s |
| `ticker/price/{speed}`, `price/rate/{speed}`, their `/batch` | | `1s`, `3s` | not probed |
| `trades`, `candles/{period}`, `converted/candles/{period}` | | snapshot then updates | not probed |
| `futures/info` | same, `["*"]` for all | "data notifications with a specified rate" | mark, index, premium, rates and next funding per contract every 3 s, median gap 2,999 to 3,000 ms, arriving 66 to 72 ms after `t` at the median, section 6 |

Channel names, speeds and depths are from S1.
There is no separate mark, index or funding channel, and `futures/info` carries all of them.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL for every market, S1 | 18 perpetuals and the spot pairs share the socket, section 1 |
| subscribe frame shape | `{"method": "subscribe", "ch": "orderbook/full", "params": {"symbols": ["ETHBTC"]}, "id": 123}`, S1 | 18 symbols in one `symbols` array got one ack listing all 18, and each delivered a snapshot |
| unknown symbol expectation | error `2001` "Symbol not found" in the response example, S1 | `NOPE_PERP` is acknowledged as a success with `"subscriptions":[]`, and no error comes |
| chunk unit and budget | 10 messages a second per IP, burst 10, and 100 connections per IP, S1 | 18 symbols on one socket, the whole perpetual list, and no refusal |
| keepalive mechanism | "the system sends ping messages to the client each 30 seconds", S1 | protocol pings at 30.8, 60.9 and 91.1 s after open, and at 31.2, 61.3 and 91.5 s in the rerun. A socket that did not answer was closed at 60.5 and 60.6 s with code 4002 "Ping pong timeout." |
| connection lifetime and maintenance notice | Not publicly specified | no lifetime cap in 95.8 and 96.2 s, and no notice frame seen |
| handshake and operation rate limits | 10 messages a second, 100 connections per IP, S1 | 6 frames in the first second across two sockets and 4 a second after it, all answered |
| public market data authentication | none | none |
| message parse and routing | notification `{"ch", "snapshot" or "update" or "data"}` keyed by symbol, S1 | same, and one frame of `orderbook/full` carried one symbol in every frame seen |
| subscribe acknowledgement shape | `{"result": {"ch", "subscriptions": [...]}, "id"}`, S1 | same. The list is every symbol now subscribed on the channel, not only the new ones |
| symbol identifier format | catalog id, `ETHBTC` | `BTCUSDT_PERP`, identical to the REST id and to CCXT `market.id` under `hitbtc`, see [`rest.md`](./rest.md) section 2 |
| number representation | prices and sizes as strings | strings on every book level. `futures/info` `T` and every `t` are JSON numbers |
| timestamp representation | `t` in ms, S1 | `t` in Unix ms. `orderbook/full` frames arrived 65 to 72 ms after it at best and 103 to 132 ms at the median over three runs |
| size unit | Not publicly specified for futures | underlying coins, CCXT `contractSize` 1, section 4 |
| sequence semantics | `s` "Sequence number", with no gap rule, S1 | each update's `s` was the previous plus one on every perpetual, 0 gaps in 716, 699 and 795 updates on four and 2,181 and 2,695 on 18 |
| idle repeat behaviour | not documented | `orderbook/full` never repeated an `s`. `orderbook/top/100ms` resent an identical body 6, 2 and 2 times a minute |

## 4. The book channel in detail

`orderbook/full` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame per symbol is `snapshot` with every level of the book and the symbol's current `s`.
The first snapshot arrived with the ack, 136 to 145 ms after the subscribe frame was sent, and the others 264 to 278 ms after it.
Snapshots held 294 to 300 bids with 183 to 188 asks on `BTCUSDT_PERP`, and 133 to 184 levels per side on `ETHUSDT_PERP`, `BCHUSDT_PERP` and `MANAUSDT_PERP`.
The first update after a snapshot carried the snapshot's `s` plus one.
No second snapshot came in 60 s, including after the same symbol was subscribed again on the same socket, whose ack listed the four symbols and sent nothing else.

`orderbook/D20/100ms` has no snapshot and delta split.
Every frame is the whole top 20 per side with the `s` of the full book at that moment, so a feed on it resets the book on each frame.
Its `s` advanced 203 over 136 frames on `BTCUSDT_PERP` while `orderbook/full` sent 203 updates, and 156 over 101 frames against 157 in the rerun, so it skips the updates that fall inside one 100 ms window.

### Delta semantics

An update carries `t`, `s` and the changed levels in `a` and `b` as `[price, size]` string pairs, and a side with no change is an empty array.
A size of `"0"` deletes the level, 39 to 1,566 such levels per perpetual in 60 s.
Zero to three updates per perpetual per minute carried no level on either side and still advanced `s` by one.

### Sequence and gap rule

```text
snapshot            replace the book, last = s
update, s = last + 1    apply, last = s
update, s ≠ last + 1    gap: terminate and resubscribe (the engine's resync)
```

The rule held on every update of every run, 0 gaps in 716, 699 and 795 updates on four perpetuals over 60 s and in 2,181 and 2,695 updates on 18 perpetuals over 45 s.
The documentation shows one snapshot then one update with `s` plus one, and it states no gap rule, S1.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on 4 of 4 | best first, ascending, on 4 of 4 |
| update | descending in every one of 2,210 updates over three runs | ascending in every one |
| `D20/100ms` | descending | ascending |
| REST `orderbook` | descending at depth 0, 5, 20 and the default 100 | ascending |

### Level window

`orderbook/full` has no window, and the maintained book reached 301 bids and 188 asks on `BTCUSDT_PERP`.
The engine keeps 20 levels per side at [`Engine.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/Engine.ts) line 61, so a feed keeps the whole book and publishes the top.
A book maintained from the snapshot and every update never crossed, 0 crossed states over all updates.

### Size unit against CCXT `contractSize`

The documentation does not name the unit of a futures size.
Sizes read as underlying coins: `BTCUSDT_PERP` has a `quantity_increment` of 0.0001 and a touch of `"0.0111"`, and `MANAUSDT_PERP` shows `"22494"` at 0.0883 USDT, about 1,986 USDT.
CCXT's `hitbtc` sets `contractSize` 1 for every contract at `server/node_modules/ccxt/js/src/hitbtc.js` line 840, so the engine's `sizeMul` is 1, which matches.
That the unit is coins is an inference from those magnitudes.

### Agreement with the REST book

With the sockets open, the REST book at 20 levels equalled the `orderbook/full` book on 40 of 40 levels for all four perpetuals, in the two book runs that compared before closing.
In `ws-probe.mjs compare`, REST equalled `orderbook/full` on 40 of 40 levels in 15 of 15 reads, and in 14 of 15 in the rerun with one read at 39.
The `D20/100ms` frame held at the same moment was once 2 and once 6 levels behind.

### One-sided and empty books

No live perpetual was one-sided.
The expired `LUNAUSDT_PERP` is accepted, and its snapshot is `"s":1` with `"a":[]` and `"b":[]`, section 6.

### Idle repeats

`orderbook/full` repeated no `s` and sent no empty keepalive frame.
Its longest pause between frames for one symbol was 3,302 ms, on `BTCUSDT_PERP` in the second 18 symbol batch, and no pause in any run reached 3.4 s.
The p90 gap was 301 to 1,500 ms, so these books rarely rest for long.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `orderbook/full` `NOPE_PERP` | `{"result":{"ch":"orderbook/full","subscriptions":[]},"id":21}` | nothing |
| `orderbook/full` `LUNAUSDT_PERP`, expired | success listing it | one empty snapshot |
| `orderbook/D30/100ms` | error `2003` "Unknown channel", "Channel is not supported: orderbook/D30/100ms" | the socket stays open |
| `orderbook/nope` | error `2003` "Unknown channel" | |
| method `nope` | error `404` "Unsupported API method" | |
| the same `D20/100ms` subscription again | success listing the four symbols | no error |
| method `subscriptions` | the four symbols of the channel | |
| text that is not JSON | error `1` "Invalid json", "JSON request is corrupted.", with no `id` | the socket stays open |

Because an unknown symbol is acknowledged as a success with an empty list, the feed compares the ack's list with what it asked for.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server protocol ping every 30 s, S1 | pings about every 30 s, at 30.8 to 31.2 s, 60.9 to 61.3 s and 91.1 to 91.5 s. `ws` answers them by default, and [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) lines 97 and 98 count a ping as traffic |
| silence the server tolerates | Not publicly specified | a socket with no subscription that answered pings stayed open for the full 95.8 and 96.2 s with 0 frames. One that did not answer was closed at 60.5 and 60.6 s with code 4002 "Ping pong timeout." |
| forced disconnect | Not publicly specified | none in any run |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames, and a client offering permessage-deflate got no extension back |
| handshake | 100 connections per IP, S1 | 467 to 1,194 ms to open |
| subscription limits | 10 messages a second per IP, S1 | no per socket cap reached at 18 symbols |
| throughput | | 18 perpetuals on `orderbook/full` in two runs: median 51 and 63 frames a second, peak 67 and 106, 12.9 and 16.4 KB a second, 271 and 279 bytes a frame, 12 and 15.4 µs `JSON.parse` a frame |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC, each frame a real capture cut to three levels per side.

Subscribe and acknowledgement.

```json
{"method": "subscribe", "ch": "orderbook/full", "params": {"symbols": ["BTCUSDT_PERP", "ETHUSDT_PERP", "BCHUSDT_PERP", "MANAUSDT_PERP"]}, "id": 1}
```

```json
{"result":{"ch":"orderbook/full","subscriptions":["BCHUSDT_PERP","ETHUSDT_PERP","BTCUSDT_PERP","MANAUSDT_PERP"]},"id":1}
```

Snapshot, first three levels per side kept of 294 bids and 186 asks, then the first update, whose `s` is one more.
That update touched levels far from the touch, since the channel covers the whole book.

```json
{"ch":"orderbook/full","snapshot":{"BTCUSDT_PERP":{"t":1790139423535,"s":1337441,"a":[["87244.37","0.0119"],["87248.18","0.0208"],["87252.98","0.0600"]],"b":[["87223.06","0.0111"],["87216.54","0.0781"],["87213.67","0.0333"]]}}}
```

```json
{"ch":"orderbook/full","update":{"BTCUSDT_PERP":{"t":1790139424408,"s":1337442,"a":[["148259.84","0.0011"]],"b":[["26163.50","0.0011"]]}}}
```

Update, with a deleted level and an empty side.

```json
{"ch":"orderbook/full","update":{"BTCUSDT_PERP":{"t":1790138850092,"s":1336237,"a":[["87235.40","0"],["87236.03","0"],["87237.38","0.0813"],["87240.18","0.2596"]],"b":[]}}}
```

Snapshot of the expired contract.

```json
{"ch":"orderbook/full","snapshot":{"LUNAUSDT_PERP":{"t":1790138429997,"s":1,"a":[],"b":[]}}}
```

`D20/100ms/batch`, two symbols in one frame, three levels per side kept of 20.

```json
{"ch":"orderbook/D20/100ms/batch","data":{"MANAUSDT_PERP":{"t":1790139423415,"s":865280,"a":[["0.0892","19178"],["0.0893","33016"],["0.0894","55916"]],"b":[["0.0886","9158"],["0.0885","18153"],["0.0884","52627"]]},"ETHUSDT_PERP":{"t":1790139423359,"s":1250456,"a":[["2786.900","0.266"],["2786.949","0.862"],["2786.985","5.663"]],"b":[["2778.852","15.475"],["2778.776","19.757"],["2778.620","52.174"]]}}}
```

Top of book.

```json
{"ch":"orderbook/top/100ms","data":{"MANAUSDT_PERP":{"t":1790138848862,"a":"0.0890","A":"9937","b":"0.0884","B":"16584"}}}
```

Futures info, which carries the anchor fields: `m` mark, `i` index, `p` premium index, `P` average premium index, `r` last settled rate, `R` indicative rate, `I` interest rate, `T` next funding in ms.

```json
{"ch":"futures/info","data":{"BCHUSDT_PERP":{"c":"perpetual","t":1790138434633,"m":"340.28","i":"340.41","p":"-0.001499779444199382","P":"-0.001441823352507007","o":"1164.156","r":"-0.000941823352507007","R":"-0.001085569577149469","T":1790150400000,"I":"0.0001"}}}
```

Errors.

```json
{"error":{"code":2003,"message":"Unknown channel","description":"Channel is not supported: orderbook/D30/100ms"},"id":23}
```

```json
{"error":{"code":404,"message":"Unsupported API method","description":"Method is not supported: nope"},"id":25}
```

```json
{"error":{"code":1,"message":"Invalid json","description":"JSON request is corrupted."}}
```

The keepalive is a WebSocket protocol ping frame with no JSON body, so there is nothing to quote.

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use `wss://api.pro.changelly.com/api/3/ws/trading` after the `login` method, with Basic or HS256 authentication.

- Futures: `futures_subscribe`, `futures_orders`, `futures_order`, `futures_new_order`, `futures_new_order_list`, `futures_cancel_order`, `futures_replace_order`, `futures_get_orders`, `futures_get_accounts`, `futures_set_account`, `futures_set_leverage`, `futures_close_position`, `futures_balance_subscribe`, `futures_balances`, `futures_fees`, `futures_fee`.
- Spot and margin have the matching `spot_` and `margin_` methods.
- The wallet socket has `subscribe_transactions` and `subscribe_wallet_balances`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://api.pro.changelly.com/api/3/ws/public` | one socket serves every perpetual |
| channel | `orderbook/full` | snapshot on subscribe, a strict `s` chain, and 103 to 132 ms median arrival after `t`, against 170 to 194 ms on `D20/100ms` |
| markets per connection | all 18 in one slice | 18 ran with 0 gaps at a median 51 and 63 frames a second |
| subscribe frames | one frame per slice, `{"method": "subscribe", "ch": "orderbook/full", "params": {"symbols": [...]}, "id": 1}` | a multi symbol list is acknowledged as one |
| keepalive | none from the client, `startKeepalive` can be empty | the server pings every 30 s, `ws` answers, and the feed counts the ping as traffic |
| `maxSilenceMs` | 45,000 | one and a half ping periods, under the server's own 60 s cut, and the longest book pause was 3.3 s |
| routing | `ch === 'orderbook/full'`, then the one key of `snapshot` or `update` is the `rawMarketId` | the payload is keyed by catalog id |
| snapshot | `resetBook` and store `s` | every level comes in it |
| update | apply only when `s === last + 1`, then store `s`, including for an update with two empty sides | 0 gaps observed |
| resync | `s !== last + 1`, or an update before any snapshot: `resync`, which terminates the socket and resubscribes | a second subscribe on the same socket sent no new snapshot |
| unserved symbol | log each requested symbol missing from the ack's `subscriptions` | an unknown symbol is acknowledged as a success with an empty list |
| expired contract | skip catalog rows whose `status` is not `working` | `LUNAUSDT_PERP` subscribes and serves an empty book |
| receive time | stamp on arrival, never from `t` | the engine's rule |
| sizes | `Number()` of the string | coins, `contractSize` 1 |
| deflate | keep `perMessageDeflate: false`, as [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 81 does | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ChangellyPRO API Documentation, Socket API Reference, Socket Market Data, Socket Futures Trading, Errors | https://api.pro.changelly.com/ | 2026-09-22 | Changelly PRO, global | URLs, channels, speeds, frame shapes, ping, limits, error codes, private methods, sections 1 to 7 |
| S2 | CCXT Pro 4.5.68 `hitbtc.js` | `server/node_modules/ccxt/js/src/pro/hitbtc.js` | 2026-09-22 | CCXT | default socket URL, section 1 |
| S3 | CCXT 4.5.68 `hitbtc.js` | `server/node_modules/ccxt/js/src/hitbtc.js` | 2026-09-22 | CCXT | `contractSize` 1, section 4 |
| P1 | `ws-probe.mjs book`, runs at 04:40, 04:47 and 04:57 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/changelly-pro/ws-probe.mjs) | 2026-09-22 | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs compare` at 04:42 and 04:58 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/changelly-pro/ws-probe.mjs) | 2026-09-22 | this host | REST agreement, section 4 |
| P3 | `ws-probe.mjs batch` at 04:43 and 04:59 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/changelly-pro/ws-probe.mjs) | 2026-09-22 | this host | 18 symbols on one socket, sections 3 to 5 |
| P4 | `ws-probe.mjs silence` at 04:44 and 05:00 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/changelly-pro/ws-probe.mjs) | 2026-09-22 | this host | pings and the 4002 close, sections 3 and 5 |
| P5 | `ws-probe.mjs deflate` at 04:40 and 05:01 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/changelly-pro/ws-probe.mjs) | 2026-09-22 | this host | compression, section 5 |
