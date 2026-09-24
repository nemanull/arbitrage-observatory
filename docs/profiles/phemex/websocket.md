# Phemex WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 (2026-09-23 UTC), from the development host near Seattle.

This profile covers the public WebSocket of Phemex (CCXT id `phemex`) for every perpetual family, with the USDⓈ-M book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/phemex/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M and USDC-M perpetuals | `wss://ws.phemex.com`, "further URI or querystring not allowed", S1 | open in 356 to 417 ms over every socket of every run, `BTCUSDT` and `BTCUSDC` deliver |
| COIN-M perpetuals | the same URL, channel `orderbook` instead of `orderbook_p`, S1 | `BTCUSD` delivers on the same socket as the USDT-M books |
| VIP endpoint | `wss://vapi.phemex.com/ws`, "for whitelisted client IPs only", S1 | not probed, `vapi.phemex.com` resolves to CloudFront addresses in `18.238.238.0/24` |
| testnet | `wss://testnet-api.phemex.com/ws`, S1 and CCXT Pro at `server/node_modules/ccxt/js/src/pro/phemex.js` line 35 | not probed |

One socket carries every family, and the channel name selects the family.
The upgrade answered HTTP 101 with `server: Boost.Beast/322` through CloudFront POP `SEA73-P3` on every socket.
`ws.phemex.com` resolved to four addresses in `18.172.170.0/24`, the same CloudFront range as the REST host, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | params | depth and speed | probed on 2026-09-23 UTC |
|---|---|---|---|
| `orderbook_p.subscribe` | `["BTCUSDT"]` | 30 levels at about 20 ms, S1 | snapshot then incremental, `depth` 30, recommended |
| `orderbook_p.subscribe` | `["DOGEUSDT", false, 10]`, depth one of 0, 1, 5, 10 or 30, S1 | `false` is "about 20ms", S1 | depth 10 and 1 give `depth` 10 and 1, `DOGEUSDT` frames 41 ms apart at the median in both runs, `ADAUSDT` at depth 1 83 and 109 ms |
| `orderbook_p.subscribe` | `["SOLUSDT", false, 0]` | "When depth=0, full orderbook will be published", S1 | `depth` 30 and at most 30 levels, not the full book, frames 30 and 43 ms apart at the median |
| `orderbook_p.subscribe` | `["ETHUSDT", true]` | S1 says `true` is "about 120ms interval", and the COIN-M section says `[symbol, true]` is the full book at 100 ms | the full book: `depth` 0, up to 2,252 levels a side, frames 106 ms apart at the median |
| `orderbook_p.subscribe` | `["XRPUSDT", true, 30]` | 30 levels at about 120 ms | `depth` 30, frames 117 and 214 ms apart at the median in two runs |
| `orderbook.subscribe` | `["BTCUSD"]` | COIN-M, 30 levels, prices as scaled integers | snapshot with `book.bids` `[866077000, 94638]`, price times 10^4, size in contracts of 1 USD |
| `trade_p.subscribe` | `["BTCUSDT"]` | "the 200 history trades immediately", S1 | a first `snapshot` of 1,000 trades, then trades |
| `perp_market24h_pack_p.subscribe` | `[]` | all symbols "every 1 second", S1 | a 320 symbol snapshot, then incremental frames 3.0 s apart at the median, carrying `indexRp`, `markRp`, `fundingRateRr` |
| `tick_p.subscribe` | `[".MBTCUSDT"]`, any index, mark or funding symbol | on change, S1 | about one push a second on marks and indices, `.BTCUSDTFR` about once a minute |
| `kline_p.subscribe`, `market24h_p.subscribe` | | S1 | not probed |

The index symbol is `.<BASE><QUOTE>`, the mark `.M<BASE><QUOTE>`, the predicted funding rate `.<BASE><QUOTE>FR` and the funding rate `.<BASE><QUOTE>FR8H`, S1.
The product catalog spells these per contract in `indexSymbol`, `markSymbol`, `fundingRateSymbol` and `fundingRate8hSymbol`, for example `.u1000SHIBUSDT`, see [`rest.md`](./rest.md) section 2.
The all-symbol ticker pushes every 3 s, so it cannot replace the one second REST anchor poll, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for every family, S1 | USDT-M, USDC-M and COIN-M books arrived on one socket, split by channel name |
| subscribe frame shape | `{"id": 1234, "method": "orderbook_p.subscribe", "params": ["BTCUSDT"]}`, one symbol per frame, S1 | a second symbol in `params` is not a symbol: `["BNBUSDT", "ETHUSDC"]` was acknowledged and delivered `BNBUSDT` only |
| unknown symbol expectation | Not publicly specified | `{"error":{"code":6001,"message":"invalid argument"},"id":106,"result":null}` for `NOPEUSDT` |
| chunk unit and budget | "Each connection has subscription limit to 20 in maximum.", "Each Client has concurrent connection limit to 5 in maximum.", "Each connection has throttle limit to 20 request/s.", S1 | in two runs 101 subscribes on one socket were acknowledged and delivered, and the 102nd answered `6015 subscription limit exceeded`. Six sockets were open at once from this host with no refusal |
| keepalive mechanism | client sends `server.ping` or a protocol ping "with interval less than 30 seconds", recommended every 5 s, S1 | `{"error":null,"id":0,"result":"pong"}` in 167 and 179 ms. The server sent no ping on any socket |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 126 s, and no notice frame seen |
| handshake and operation rate limits | "wss://ws.phemex.com 200/5m per IP address", S2 | 34 sockets opened by the probe across all runs, none refused, and subscribes paced at 10 per second were never throttled |
| public market data authentication | none, "Market trade/orderbook are published publicly without user authentication.", S1 | none |
| message parse and routing | `{"book"/"orderbook_p", "depth", "sequence", "timestamp", "symbol", "type"}`, S1 | top-level `orderbook_p` object with `symbol`, `type` `snapshot` or `incremental`, `sequence`, `timestamp`, `dts` and `mts` |
| subscribe acknowledgement shape | `{"error": null, "id": 1234, "result": {"status": "success"}}`, S1 | as documented, and the snapshot came in the same millisecond as the ack or a few ms after |
| symbol identifier format | `BTCUSDT` | identical to CCXT `market.id` and to the REST ticker `symbol` on 126 of 126 active linear contracts, including the `u` prefix of `u1000PEPEUSDT` and `u1000SHIBUSDT` |
| number representation | `["<priceEp>", "<qty>"]` strings, S1 | USDⓈ-M prices and sizes are decimal strings. COIN-M prices and sizes are JSON integers, price scaled by 10^4 |
| timestamp representation | nanoseconds | `timestamp`, `dts` and `mts` are integer nanoseconds as JSON numbers above 2^53, so `JSON.parse` rounds them, harmless at millisecond precision |
| size unit | Not publicly specified | base coin on USDT-M and USDC-M, which is CCXT `contractSize` 1 on USDT-M, and 1 USD contracts on COIN-M, section 4 |
| sequence semantics | "Latest message sequence", S1 | a counter shared by groups of symbols: per symbol it only increases, by 1 on 13 of 1,887 `BTCUSDT` deltas and by more than 5 on 1,787. No gap can be detected from it |
| idle repeat behaviour | "if the price is within depth and the size is unchagned, the level will NOT published", S1 | a quiet book sends nothing but the periodic snapshot every 60 s, and 0 to 7 consecutive identical deltas per stream per run |

## 4. The book channel in detail

`orderbook_p` at the default 30 levels and about 20 ms is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

"On each successful subscription, DataGW will immediately send the current Order Book snapshot to client and all later order book updates will be published.", S1.
Every subscribed stream got a `type` `snapshot` of 30 bids and 30 asks within 548 to 608 ms of the socket being created, in both runs.
"snapshot messages are published with 60-second interval for client self-verification", S1.
The wire agrees: each stream got a further snapshot every 60.0 s, at a phase of its own, for example 37.456 s and 97.464 s on `BTCUSDT` and 26.039 s and 86.075 s on `PATHUSDT` in the 125 s run.

### Delta semantics

A delta is `type` `incremental` with `orderbook_p.bids` and `orderbook_p.asks` arrays of `[price, size]` strings.
A size of `"0"` deletes the level.
No delta was empty in either run.
A delta can carry more entries than the depth: one `LSKUSDT` delta carried 212 ask entries, many of them deletions, on a contract the catalog marks `Delisted`.

### Sequence and gap rule

The `sequence` is a counter shared by groups of symbols: `BTCUSDT` and `ETHUSDT` snapshots on one socket read 68605392423 and 68605392443, while `u1000PEPEUSDT`, `BTCUSDC`, `SYNUSDT` and `PATHUSDT` read 61110114007, 13171366508, 29729425835 and 902412653.
On every stream most deltas advanced it by more than 1: by exactly 1 on 13 of 1,887 `BTCUSDT` deltas, 8 of 396 `u1000PEPEUSDT` deltas and 15 of 138 `SYNUSDT` deltas.
Per symbol it strictly increases on every delta, and a periodic snapshot repeats the sequence of the last delta when nothing changed in between, 7 times in the 125 s run.
So a missed delta cannot be detected from the sequence.

```text
type = snapshot       replace the book (on subscribe and every 60 s)
type = incremental    apply by price, then keep the best 30 per side
sequence              only a monotonic check: a lower sequence than the last applied is out of order
```

The periodic snapshot is the only resynchronisation the server offers.
Over both runs a book kept from the previous snapshot and every delta since equalled the next periodic snapshot on 18 of 18 comparisons, with no size mismatch and no extra level, on six contracts.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on every snapshot of both runs | best first, ascending |
| delta | mostly descending, but 8 of 1,887 `BTCUSDT` deltas and 9 of 1,390 `ETHUSDT` deltas were not | mostly ascending, 3 and 11 were not |
| REST `/md/v2/orderbook` | descending | ascending |

A feed applies deltas by price and never by position.

### Level window

The documentation says old levels that fall below the window "will not update anymore untill it comes back", and tells the client to keep the top levels, S1.
On the wire the server deleted the level leaving the window: a book kept without trimming never held more than 30 levels a side on any contract over 80 s and 125 s runs, and matched every periodic snapshot.
Trimming to 30 after each delta is still cheap insurance against the documented behaviour.

### Size unit against CCXT `contractSize`

| contract | CCXT `contractSize` | socket size at the touch | REST size at the same price | unit |
|---|---:|---|---|---|
| `BTCUSDT` | 1 | `"0.576"` | `"0.576"` | BTC, `qtyStepSize` 0.001 |
| `u1000PEPEUSDT` | 1 | `"38744"` | `"38744"` | 1000 PEPE, CCXT base `1000PEPE` |
| `BTCUSDC` | 0 | `"0.085"` at 86614.7 | | BTC |
| `BTCUSD`, COIN-M | 1 | `94638` | | contracts of 1 USD |

On the 20 best levels of `BTCUSDT` and `u1000PEPEUSDT`, 39 and 40 of 40 shared prices had the same size on the socket and in the REST book in the first run, and 40 and 40 in the second.
USDT-M sizes are base coin, which is what CCXT's `contractSize` 1 describes, see [`rest.md`](./rest.md) section 2.
USDC-M sizes are also base coin, and CCXT's `contractSize` of 0 becomes 1 in the engine's connector, so they would convert correctly by accident.
COIN-M sizes are US dollars, which the engine would read as coins, so the inverse contracts must be filtered out.

### One-sided and empty books

No one-sided or empty book was seen on the six contracts in either run.
What `orderbook_p` sends for a side with no orders is Not verified.

### Idle repeats

A quiet book sends nothing between periodic snapshots: `PATHUSDT`, a TradFi contract, sent 0 deltas in 80 s and 125 s, and its three snapshots carried the same sequence 902412653.
Its snapshot `timestamp` was 68 to 154 s older than the arrival, so the timestamp is the last book change and not the send time.
Consecutive deltas with an identical body occurred 2 and 7 times on `BTCUSDT` in the two runs.

### Unknown, closed and wrong-family symbols

| request | reply | then |
|---|---|---|
| `orderbook_p` `["NOPEUSDT"]` | `6001 invalid argument` | |
| `orderbook_p` `["BTCUSD"]`, a COIN-M symbol | `6001 invalid argument` | |
| `orderbook.subscribe` `["BTCUSDT"]`, the COIN-M channel | `6001 invalid argument` | |
| `orderbook_p` `["BTCUSDT", false, 20]` | `6001 invalid argument` | |
| `orderbook_p` `["LSKUSDT"]`, `Delisted` in the catalog | success | snapshot and deltas |
| `orderbook_p` `["ETHUSDT", true]` twice | success both times | one stream |
| `nope.subscribe` | `6001 invalid argument` | |
| text that is not JSON | `{"error":{"code":6001,"message":"invalid argument"},"id":null,"result":null}` | the socket stays open |
| `orderbook_p.unsubscribe` `[]` | success | every book on that socket stops, 0 frames after 1 s |
| 102nd subscribe on one socket | `6015 subscription limit exceeded` | the first 101 keep delivering |

Every refusal is explicit, so a feed can log the error and needs no silent stream watch.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client ping at most every 30 s, 5 s recommended, "actively reconnect to DataGW if don't receive messages in 3 heartbeat intervals", S1 | `server.ping` answered in 167 and 179 ms. A protocol ping every 10 s got a protocol pong every time |
| silence the server tolerates | 30 s without a client ping | in both runs every socket without a client ping closed at 31.4 to 32.4 s with 1006 and no close frame, whether it was unsubscribed, subscribed to a quiet book, or subscribed to `BTCUSDT` and receiving 660 and 680 frames. An application or a protocol ping every 10 s kept a socket open for the full 75 s |
| forced disconnect | Not publicly specified | none in 126 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | 200 per 5 min per IP, S2 | 356 to 417 ms to open |
| subscription limits | 20 per connection and 5 connections, S1 | 101 per connection, and 6 connections at once, both allowed in two runs |
| throughput | | 101 USDⓈ-M books on one socket, two runs: 235 and 253 frames per second at the median, 377 and 593 at peak, 61 and 68 KB per second, 273 and 281 bytes per frame, 3.7 and 4.4 µs `JSON.parse` per frame |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays marked `…` in the prose are cut to three levels.

Subscribe and acknowledgement.

```json
{"id": 1, "method": "orderbook_p.subscribe", "params": ["BTCUSDT"]}
```

```json
{"error":null,"id":1,"result":{"status":"success"}}
```

Snapshot, first three levels per side kept.

```json
{"depth":30,"dts":1790133513685489850,"mts":1790133513662974773,"orderbook_p":{"asks":[["2763.87","0.06"],["2764.45","0.04"],["2764.57","28.03"]],"bids":[["2763.86","32.22"],["2763.83","0.04"],["2763.81","3.36"]]},"sequence":68604886383,"symbol":"ETHUSDT","timestamp":1790133513660305085,"type":"snapshot"}
```

Delta, with a deletion at `86581.8` near the window edge, and that level back in a later delta.

```json
{"depth":30,"dts":1790133513685595340,"mts":1790133513683881504,"orderbook_p":{"asks":[["86540.3","2.316"],["86541.4","2.316"],["86542.3","0"],["86581.8","0"]],"bids":[["86510.7","2.36"],["86504.9","0"],["86455.1","0.001"],["86426.7","0"]]},"sequence":68604886406,"symbol":"BTCUSDT","timestamp":1790133513674330491,"type":"incremental"}
```

```json
{"depth":30,"dts":1790133513727823132,"mts":1790133513725815968,"orderbook_p":{"asks":[["86519.7","0"],["86522.4","0"],["86535.4","0"],["86536.3","0"],["86538.1","0"],["86540.3","0"],["86541.4","0"],["86550","2.316"],["86552.7","2.69"],["86581.8","0.785"],["86582.2","0.346"],["86583.6","1.657"],["86584.9","1.904"],["86588.2","0.001"],["86589.4","2.117"]],"bids":[["86512.1","2.36"],["86506.7","0"]]},"sequence":68604886692,"symbol":"BTCUSDT","timestamp":1790133513723626693,"type":"incremental"}
```

Keepalive.

```json
{"id": 0, "method": "server.ping", "params": []}
```

```json
{"error":null,"id":0,"result":"pong"}
```

Errors.

```json
{"error":{"code":6001,"message":"invalid argument"},"id":106,"result":null}
```

```json
{"error":{"code":6001,"message":"invalid argument"},"id":null,"result":null}
```

Mark and index ticks, the mark equal to the last trade and 482 ppm under the index.

```json
{"tick_p":{"last":"86513.6","symbol":".MBTCUSDT","timestamp":1790133513663487967}}
```

```json
{"tick_p":{"last":"86555.32311612","symbol":".BTCUSDT","timestamp":1790133513626186153}}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same URL after `user.auth` with an API key, a signature and an expiry.

- `aop_p.subscribe` for account, orders and positions on USDⓈ-M, as CCXT Pro builds it at `server/node_modules/ccxt/js/src/pro/phemex.js` line 1553.
- `ras_p.subscribe` for the account margin of a risk unit.
- `aop.subscribe` and `wo.subscribe` serve COIN-M and spot, S1.

CCXT Pro picks `orderbook_p` only for USDT settled swaps, at `server/node_modules/ccxt/js/src/pro/phemex.js` line 644, so it would send `orderbook.subscribe` for a USDC-M contract, which the channel matrix shows is refused for a linear symbol.
Its order book handler applies deltas without any sequence check, at lines 709 to 785.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://ws.phemex.com`, for the 116 USDT-M contracts | every family shares the URL, and the registry filter keeps USDT-M only, see [`fees.md`](./fees.md) section 9 |
| channel | `orderbook_p`, params `[rawMarketId]` | snapshot on subscribe, a 60 s snapshot, about 20 ms, 30 levels covers the engine's 20 |
| markets per connection | 50, so three sockets | 101 streams per socket ran and the 102nd was refused, the documented caps are 20 per socket and 5 sockets, and three sockets stay under the documented socket cap |
| subscribe frames | one frame per market, `{"id": <n>, "method": "orderbook_p.subscribe", "params": [<rawMarketId>]}`, paced under 20 per second | a frame takes one symbol, and the throttle is 20 requests per second per connection |
| keepalive | `{"id": 0, "method": "server.ping", "params": []}` every 5 s | a socket without a client ping dies at about 31 s even while data flows, and the pong counts as traffic |
| `maxSilenceMs` | 15,000 | three missed pongs at 5 s, the documented reconnect rule. A quiet book sends nothing for 60 s, so only the pong keeps a quiet socket's watch alive |
| routing | `frame.symbol` is the `rawMarketId` | identical spelling |
| snapshot | `type === "snapshot"`: `resetBook`, on subscribe and on every periodic snapshot | the only resynchronisation the server offers |
| delta | apply by price, `"0"` deletes, then trim each side to 30 | deltas are not always sorted, and the documentation warns levels leaving the window are not deleted |
| resync | a delta before any snapshot, or a `sequence` lower than the last applied: `resync`. Otherwise rely on the 60 s snapshot | the sequence is shared by groups of symbols, so no gap rule exists |
| errors | log `6001` and `6015` replies with their `id` | refusals are explicit |
| receive time | stamp on arrival, never from `timestamp`, `dts` or `mts` | a quiet book's snapshot carried a timestamp 154 s old |
| sizes | `Number()` of the string, base coin | section 4 |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

The one weakness is a lost delta, which stays wrong for up to 60 s until the next snapshot, since nothing on the wire reveals it.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Phemex API documentation, USDⓈ-M Perpetual Websocket API and COIN-M Perpetual Websocket API | https://phemex-docs.github.io/ | 2026-09-22 | Phemex, global | URLs, channels, params, heartbeat, per connection limits, snapshot interval, local book recipe, private channel names, sections 1 to 7 |
| S2 | Phemex API documentation, Rate limits, IP ratelimits | https://phemex-docs.github.io/#rate-limits | 2026-09-22 | Phemex, global | "wss://ws.phemex.com 200/5m per IP address", sections 3 and 5 |
| S3 | CCXT Pro 4.5.68 `phemex.js` | `server/node_modules/ccxt/js/src/pro/phemex.js` | 2026-09-22 | CCXT | URLs, channel choice by settle currency, handler without sequence check, private channel, sections 1 and 7 |
| P1 | `ws-probe.mjs book`, 80 s at 03:18 UTC and 125 s at 03:28 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/phemex/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs batch` at 03:22 and 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/phemex/ws-probe.mjs) | 2026-09-23 UTC | this host | subscription and socket caps, two symbols in one frame, throughput, sections 3 and 5 |
| P3 | `ws-probe.mjs silence` and `deflate` at 03:23 and 03:37 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/phemex/ws-probe.mjs) | 2026-09-23 UTC | this host | keepalive, silence, compression, section 5 |
