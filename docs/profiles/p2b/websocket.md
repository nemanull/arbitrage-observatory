# P2B WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:10 to 03:34 UTC), from the development host near Seattle, in two passes.

This profile covers the public spot WebSocket of P2B (CCXT id `p2b`), because P2B lists no perpetual, see [`fees.md`](./fees.md) section 3.
It follows template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md), with the depth channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/p2b/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, every market | `wss://apiws.p2pb2b.com/`, S1, and CCXT Pro at `server/node_modules/ccxt/js/src/pro/p2b.js` line 39 | open in 352 to 495 ms over 58 sockets in two passes |
| perpetuals, futures, options | none | none exist |

One URL serves every spot market.
It resolves to the same two Cloudflare addresses as the REST host, see [`rest.md`](./rest.md) section 1.
A socket carries one depth market at a time, section 5.

## 2. Channel matrix for public market data

| channel | params | documented | probed on 2026-09-22 |
|---|---|---|---|
| `depth.subscribe` | `[market, limit, interval]`, limit 1 to 100 | a full book "each 60 seconds" and new records "each 1 second", S1 | full book on subscribe, then partial frames on a one second tick, recommended |
| `price.subscribe` | `[market1, market2, …]` | last price per market | acked, then no frame in 20 s on `BTC_USDT` and `ETH_USDT`, in three runs |
| `state.subscribe` | `[market1, market2, …]` | 24 h statistics | acked, then no frame in 20 s, in three runs |
| `deals.subscribe` | `[market1, market2, …]` | trades | acked, then no frame in 20 s, in three runs, while REST `history` showed 100 `BTC_USDT` trades inside 3 s |
| `kline.subscribe` | `[market, period]`, period 900, 1800, 3600 or 86400 | candles | acked, then no frame in 20 s, in two runs |
| `server.ping` | `[]` | answers `"pong"` | answered in 163 and 168 ms |
| `server.time` | `[]` | Unix seconds | answered, see [`rest.md`](./rest.md) section 7 |

In the last two runs of `ws-probe.mjs multi`, price, state, deals and kline each ran on a socket of their own, so the silence is not the depth replacement rule of section 5.
There is no best bid and ask, mark, index or funding channel.
Only `depth.update` delivered data to this host.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | one URL, but one depth market per socket: a second `depth.subscribe` on the same socket replaces the first, in four runs |
| subscribe frame shape | `{"method":"depth.subscribe","params":["BTC_USDT", 10, "0"],"id":1}`, S1 | the same. A frame naming two markets, `["BTC_USDT", 20, "0", "XRP_USDT", 20, "0"]`, answered code 1 `invalid argument` and left the earlier subscription running |
| unknown symbol expectation | Not publicly specified | `NOPE_USDT` and lowercase `btc_usdt` are acked `{"status": "success"}` and never deliver |
| chunk unit and budget | depth takes one market, the other channels a list, S1 | one depth market per socket. Twelve sockets opened at once in 461 to 503 ms of wall time, all acked, none refused |
| keepalive mechanism | `{"method":"server.ping","params":[],"id":1}` answered `{"error":null,"result":"pong","id":1}`, S1 | as documented, in 163 and 168 ms. No server ping on any socket. A client protocol ping is answered with a pong |
| connection lifetime and maintenance notice | "Connection will be closed by server in cause of inactivity after 100 seconds.", S1 | a socket closes with 1006 about 60 s after the server last sent it a frame, section 5. No notice and no lifetime cap in 120 s |
| handshake and operation rate limits | Not publicly specified | none met at 12 simultaneous handshakes or 11 frames in 4 s |
| public market data authentication | none | none |
| message parse and routing | `{"method":"depth.update","params":[flag, {"asks": […], "bids": […]}, market],"id":null}`, S1 | as documented. Route on `params[2]`, which is the market id |
| subscribe acknowledgement shape | not documented | `{"error": null, "result": {"status": "success"}, "id": 3}`, echoing the request id |
| symbol identifier format | `BTC_USDT` | identical to CCXT `market.id` and the REST `name` on 173 of 173 markets, see [`rest.md`](./rest.md) section 2. Case sensitive |
| number representation | prices and amounts as strings, S1 | strings. The server writes JSON with a space after every `:` and `,` |
| timestamp representation | none in `depth.update` | none. No frame of the depth channel carries a time or an id, and `server.time` is whole seconds |
| size unit | amount in the base currency, S1 | base currency. The 20 best levels per side of a book kept from the socket equalled the REST book, 20 of 20 on both sides in both passes, see section 4 |
| sequence semantics | none | none. A gap cannot be detected, only repaired by the next full book |
| idle repeat behaviour | full every 60 s, partial every 1 s, S1 | no repeats. A partial frame is sent only when a level changed, a quiet book went 69 s with no frame after its first, and no empty partial was seen |

## 4. The book channel in detail

`depth.subscribe` with limit 100 and interval `"0"` is the channel this profile describes, unless a row says otherwise.

### Snapshot on subscribe

The first frame after the acknowledgement is a full book, `params[0]` equal to `true`, on every subscription of every run.
It arrived 201 to 954 ms after the subscribe frame was sent over twelve subscriptions, and the acknowledgement 167 and 168 ms after it.
On `BTC_USDT` the second full book came 59,985 and 60,006 ms after the first, which matches the documented 60 s.
On the quiet `CPC_USDT` no second full book came in either 69 s book run, or before the silence runs closed the socket at 60 s, so the 60 s refresh is not a fixed timer for a book that does not change.

### Delta semantics

A partial frame, `params[0]` equal to `false`, carries only the levels that changed, as `[price, amount]` string pairs under `asks`, `bids` or both.
An amount of `"0"` deletes the level, and 257 and 683 deletions came in 39 and 38 partial `BTC_USDT` frames over the two 70 s runs.
A side with no change is absent from the object.

The partial frames arrive on a fixed one second tick.
All 81 `BTC_USDT` frames of the two book runs arrived between 305 and 397 ms past a wall clock second.
The gaps between partial frames were 952 and 970 ms at least, 1,041 and 1,941 ms at the median, and 4,016 and 4,019 ms at most.
So the channel batches a second of changes into one frame, and a book kept from it is up to one second old plus the path, before any engine processing.

### Sequence and gap rule

```text
params[0] = true    replace the book
params[0] = false   apply each level, amount "0" deletes
```

There is no sequence number, update id or checksum, so a lost frame is invisible.
The only repair is the next full book, which a busy market sends every 60 s.
At the second full book of `BTC_USDT`, the book kept from the first full book and the partial frames matched 99 of 100 bids and 100 of 100 asks in the first pass.
In the second pass it matched 98 of 100 bids and 95 of 100 asks, and held 2 bids and 3 asks inside the window that the full book did not.
That drift is either a partial frame that missed a change or a full book cut at a different instant from the partial tick, and the wire does not say which.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| full | best first, descending, 4 of 4 on `BTC_USDT` over two passes and 4 of 4 on the variant sockets of the second | best first, ascending |
| partial | best first on all 47 partial frames with two or more bids | best first on all 63 partial frames with two or more asks |
| REST `depth/result` | best first | best first |

A feed still applies partial levels by price and never by position.

### Level window and the limit and interval arguments

| subscription | full book levels | largest partial frame | note |
|---|---|---|---|
| `BTC_USDT`, 100, `"0"` | 100 and 100 | 153 and 210 levels over both sides | a book kept from it never held more than 100 levels per side in either 70 s run, so a level leaving the window arrives as a deletion |
| `ETH_USDT`, 20, `"0"` | 20 and 20 | 30 and 4 levels | |
| `ETH_USDT`, 5, `"0"` | 5 and 5 | 8 and 4 levels | levels leaving the window are sent as `"0"`, section 6 |
| `BTC_USDT`, 20, `"0.1"` | 20 and 20 | 80 levels in both passes | prices merged to 0.1 steps, `86490.8` |
| `BTC_USDT`, 20, `"1"` | 20 and 20 | 49 and 47 levels | accepted although the socket documentation stops at `0.1`, prices merged to whole dollars, `86490` |
| limit 0, 101 or 1000, interval `"0.5"`, a numeric interval, or no interval | refused | | code 1 `invalid argument` |

Interval `"0"` is the unmerged book.
CCXT Pro defaults the interval to `"0.001"`, at `server/node_modules/ccxt/js/src/pro/p2b.js` line 248, which merges levels on any market whose tick is finer than 0.001, and many P2B markets trade below 0.001.
CCXT Pro's `handleOrderBook` also ignores the full flag and never clears the book, at lines 402 to 455 of the same file.

### Size unit

The amount is in the base currency, which is what CCXT's spot `amount` means, and CCXT sets no `contractSize` for P2B, at `server/node_modules/ccxt/js/src/p2b.js` line 402, so the engine's default of 1 would be right.
At 70 s the 20 best levels per side of the book kept from the socket equalled the REST `depth/result` levels exactly, 20 of 20 bids and 20 of 20 asks, 687 and 1,072 ms after the last socket frame in the two passes.
`BTC_USDT` levels hold about 1.5 to 2.9 BTC each, for example `["86482", "2.48494"]`.

### One-sided and empty books

The quiet `CPC_USDT` full book held 19 bids and 100 asks in both passes.
No one-sided or empty book was seen, and the REST `tickers` reply showed a bid and an ask on all 173 markets.
What the channel sends for an empty side is Not verified.

### Idle repeats

Nothing is repeated.
No partial frame was empty, and `CPC_USDT` sent nothing at all between its first full book and the end of either 69 s run.

### Unknown, closed and malformed requests

| request | reply | then |
|---|---|---|
| `depth.subscribe` `["NOPE_USDT", 20, "0"]` | `{"error": null, "result": {"status": "success"}, "id": 9}` | nothing |
| `depth.subscribe` `["btc_usdt", 20, "0"]` | success | nothing |
| `depth.subscribe` with limit 0, 101 or 1000 | `{"error": {"code": 1, "message": "invalid argument"}, "result": null, "id": 11}` | the earlier subscription keeps running |
| `depth.subscribe` with interval `"0.5"`, `0` as a number, or no interval | code 1 `invalid argument` | |
| `price.subscribe` `["NOPE_USDT"]` | success | nothing |
| unknown method `depth.nope` | no reply at all | the socket stays open |
| text that is not JSON | `{"error": {"code": 7, "message": "invalid format"}, "result": null}`, with no `id` | the socket stays open |

A closed or suspended market was not available to probe.
Because an unknown market is acknowledged as success, a feed has to notice a subscription with no full book on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | `server.ping`, S1 | answered `"pong"` in 163 and 168 ms. A client protocol ping every 30 s was answered with 3 and 4 pongs in 120 s. The server never pinged |
| silence the server tolerates | 100 s of "inactivity", S1 | 60 s without a server frame. A socket that subscribed nothing closed at 59.997 and 60.001 s. Sockets subscribed to the quiet `CPC_USDT` closed at 60.259, 60.427 and 60.748 s, about 60 s after its full book. All closed with 1006 and no close frame. Sockets subscribed to the busy `BTC_USDT`, whose client sent nothing after its first second, stayed open for 70 s twice and for 120 s with 72 frames. An application ping or a protocol ping every 30 s kept a socket open for 120 s, twice each |
| one depth market per socket | not documented | subscribing `ETH_USDT` after `BTC_USDT` on one socket stopped `BTC_USDT` frames, in four runs. `depth.unsubscribe` takes no market and stopped everything |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | | 352 to 495 ms to open, over 58 sockets |
| throughput | | `BTC_USDT` at 100 levels sent 41 and 40 frames in 70 s, 609 and 1,087 bytes each on average. At 20 levels, twelve busy markets quoted in USD, USDT or USDC sent 3 to 14 frames each in 20 s, over three runs |

The silence rule looks like a proxy's 60 s idle read timeout rather than the documented 100 s, since a socket the server kept writing to never closed, whatever the client sent.
Either way, a quiet market can be silent for longer than 60 s, so the client ping is what keeps a socket alive.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays marked `…` are cut.

Subscribe, and its acknowledgement.

```json
{"method": "depth.subscribe", "params": ["ETH_USDT", 5, "0"], "id": 6}
```

```json
{"error": null, "result": {"status": "success"}, "id": 6}
```

Full book at limit 5, in the same millisecond as the acknowledgement.

```json
{"method": "depth.update", "params": [true, {"asks": [["2762", "13.1811"], ["2762.13", "18.4894"], ["2762.27", "22.3238"], ["2762.39", "18.8223"], ["2762.54", "40.6802"]], "bids": [["2761.99", "23.7617"], ["2761.89", "22.0711"], ["2761.78", "18.4998"], ["2761.64", "18.3119"], ["2761.5", "16.4226"]]}, "ETH_USDT"], "id": null}
```

Partial frame on the same socket five seconds later, where three asks leave the five level window as deletions and three enter.

```json
{"method": "depth.update", "params": [false, {"asks": [["2762", "0"], ["2762.13", "0"], ["2762.27", "0"], ["2762.68", "58.4211"], ["2762.82", "20.4084"], ["2762.96", "47.8491"]]}, "ETH_USDT"], "id": null}
```

Partial frame on `BTC_USDT` at 100 levels, with both sides.

```json
{"method": "depth.update", "params": [false, {"asks": [["86506.28", "0"], ["86506.43", "1.32787"]], "bids": [["86469.99", "1.59392"], ["86460.89", "1.9693"], ["86460.74", "0"]]}, "BTC_USDT"], "id": null}
```

Keepalive and server time.

```json
{"method": "server.ping", "params": [], "id": 1}
```

```json
{"error": null, "result": "pong", "id": 1}
```

```json
{"error": null, "result": 1790133064, "id": 2}
```

Errors.

```json
{"error": {"code": 1, "message": "invalid argument"}, "result": null, "id": 11}
```

```json
{"error": {"code": 7, "message": "invalid format"}, "result": null}
```

## 7. Private channels

The socket documentation lists no private channel and no login method, S1.
CCXT Pro sets `watchBalance`, `watchMyTrades` and `watchOrders` to false, at `server/node_modules/ccxt/js/src/pro/p2b.js` lines 26, 27 and 30.
An execution stage would use the REST private API, see [`rest.md`](./rest.md) section 6.

## 8. Recommended feed shape

A recommendation for a spot feed in a later design, not a decision.
The perpetual engine cannot use it, because P2B has no perpetual.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://apiws.p2pb2b.com/`, one socket per market | a second depth subscription replaces the first, so 173 markets need 173 sockets, or 155 for the USD, USDT and USDC quoted ones |
| channel | `depth.subscribe`, params `[rawMarketId, 100, "0"]` | full book on subscribe, 100 levels covers the engine's 20, interval `"0"` is unmerged |
| markets per connection | 1 | the replacement rule |
| subscribe frames | one frame per socket, `{"method": "depth.subscribe", "params": ["BTC_USDT", 100, "0"], "id": <n>}` | |
| keepalive | `{"method": "server.ping", "params": [], "id": <n>}` every 20 s | the server sends no ping and drops a socket after 60 s without server traffic, and a quiet book can be silent longer |
| `maxSilenceMs` | 45,000 | two missed pongs, and the pong has to count as traffic because a quiet book sends nothing |
| routing | `params[2]` is the `rawMarketId`, and `params[0]` is the full flag | |
| full book | `resetBook`, then set every level, on every `true` frame and not only the first | the documented 60 s refresh is the only repair for a lost frame |
| partial | apply each level by price, `"0"` deletes | no ordering or sequence to check |
| resync | no gap can be detected. Resync on a partial before any full book, and log a market with no full book 10 s after its acknowledgement | unknown markets are acknowledged as success |
| receive time | stamp on arrival | frames carry no time |
| sizes | `Number()` of the base currency amount, `contractSize` 1 | section 4 |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |
| freshness | treat the book as up to one second old | partial frames come on a one second tick |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | P2B WSS documentation | https://github.com/P2B-team/P2B-WSS-Public/blob/main/wss_documentation.md | 2026-09-22 | P2B, global | URL, methods, params, 100 s inactivity, 60 s and 1 s cadence, ping, sections 1 to 5 |
| S2 | CCXT Pro 4.5.68 `p2b.js` | `server/node_modules/ccxt/js/src/pro/p2b.js` | 2026-09-22 | CCXT | URL, default interval, order book handler, watch flags, sections 1, 4 and 7 |
| S3 | CCXT 4.5.68 `p2b.js` | `server/node_modules/ccxt/js/src/p2b.js` | 2026-09-22 | CCXT | no `contractSize`, section 4 |
| P1 | `ws-probe.mjs book` at 03:11 and 03:29 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/p2b/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs multi`, three runs from 03:13 to 03:18 UTC and one at 03:31 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/p2b/ws-probe.mjs) | 2026-09-23 UTC | this host | replacement rule, burst, silent channels, sections 2, 3 and 5 |
| P3 | `ws-probe.mjs silence` at 03:19 and 03:32 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/p2b/ws-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P4 | `ws-probe.mjs deflate` at 03:10 and 03:29 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/p2b/ws-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P5 | `curl` of REST `history` for `BTC_USDT` at 03:14 UTC | https://api.p2pb2b.com/api/v2/public/history?market=BTC_USDT&lastId=1&limit=100 | 2026-09-23 UTC | this host | trades during the silent `deals` channel, section 2 |
