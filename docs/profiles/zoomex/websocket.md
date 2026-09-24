# Zoomex WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:18 to 03:51 UTC, from the development host near Seattle.

This profile covers the public WebSocket of Zoomex for its two perpetual families, USDT-M and inverse, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/zoomex/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The API documentation at `zoomexglobal.github.io/docs/` is a copy of Bybit's v5 documentation under Zoomex names, and the socket speaks Bybit's v5 public protocol.

Section 4 opens with the finding that matters most.
On 693 of the 697 USDT perpetuals the Zoomex stream is Bybit's own book stream, relayed, and only four perpetuals carry a book of Zoomex's own.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals | `wss://stream.zoomex.com/v5/public/linear` | open in 696 to 836 ms, all 697 perpetuals deliver |
| inverse perpetuals | `wss://stream.zoomex.com/v5/public/inverse` | open in 682 to 761 ms, `BTCUSD` and `ETHUSD` deliver |
| spot | `wss://stream.zoomex.com/v5/public/spot` | not probed |
| retired v3 public | `wss://stream.zoomex.com/v3/public`, "expected to go offline on September 23, 2025" | handshake answered HTTP 404 |
| private | `wss://stream.zoomex.com/v3/private` | not probed |

The URLs are from S1.
One socket carries one family.
On the inverse URL `orderbook.50.BTCUSDT` was refused with `error:handler not found,topic:orderbook.50.BTCUSDT`, and on the linear URL `orderbook.50.BTCUSD` was refused the same way.
`stream.zoomex.com` resolved to the CloudFront name `d1yq1nuwbz5sl7.cloudfront.net` and four addresses on 2026-09-23, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | topic | documented depth and speed | probed on 2026-09-23 |
|---|---|---|---|
| book, level 1 | `orderbook.1.<symbol>` | 10 ms, a snapshot again after 3 s without change | every frame is a `snapshot`: 138 and 187 on `BTCUSDT`, 65 and 101 on `CHRUSDT`, in about 51 s in each of two runs |
| book, 50 levels | `orderbook.50.<symbol>` | 20 ms | snapshot then deltas, recommended |
| book, 200 levels | `orderbook.200.<symbol>` | 100 ms | accepted, snapshot of 200 bids and 149 asks on `ETHUSDT`, then deltas |
| book, 500 levels | `orderbook.500.<symbol>` | not documented | refused, `error:handler not found,topic:orderbook.500.BTCUSDT` |
| book, 1000 levels | `orderbook.1000.<symbol>` | 300 ms | accepted, snapshots of 417 bids and 240 asks, then 408 and 246, on `BTCUSDT`, and its `u` is the REST book's `u` |
| ticker | `tickers.<symbol>` | 100 ms, snapshot then partial deltas | 208 and 290 frames in about 51 s on two symbols, carries `markPrice`, `indexPrice`, `fundingRate`, `nextFundingTime`, `fundingIntervalHour`, `fundingCap` |
| trades | `publicTrade.<symbol>` | real time | accepted, frames carry Bybit's fields including `RPI` |
| kline, liquidation, all liquidation | `kline.*`, `liquidation.*`, `allLiquidation.*` | | not probed |

The depths, speeds and topic names are from S2 and S3.
No dedicated mark, index or funding channel exists, and the ticker carries all three.
For the four perpetuals Zoomex books itself, the ticker topic reports Zoomex's own mark, funding rate and cap, while the bulk REST ticker reports Bybit's, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL per category, spot, linear, inverse, S1 | a symbol of another family is refused with `handler not found`, section 1 |
| subscribe frame shape | `{"req_id": "test", "op": "subscribe", "args": ["orderbook.1.BTCUSDT", "publicTrade.BTCUSDT"]}`, S1 | 200 topics in one frame got one ack and all delivered, in both runs of P3 |
| unknown symbol expectation | Not publicly specified | `{"success": false, "ret_msg": "error:handler not found,topic:orderbook.50.NOPEUSDT", …}`, and one refused topic fails the whole request, so the other topics in that frame never deliver |
| chunk unit and budget | "For one public connection, you cannot have length of "args" array over 21,000 characters.", S1 | 1,394 topics of 28,028 characters in one frame were acked as success and delivered |
| keepalive mechanism | client sends `{"req_id": "100001", "op": "ping"}` every 20 s, S1 | no server protocol ping in any run. The pong came back in 171 to 183 ms. A socket on which the server has sent nothing for about 10 s is closed, so 20 s is too slow for a quiet socket, section 5 |
| connection lifetime and maintenance notice | "your may get disconnected at any time", S1 | no forced close of a busy socket in 110 s. No maintenance notice channel exists |
| handshake and operation rate limits | 500 connections per 5 minutes per IP per endpoint, 1,000 market data connections per IP per category, S1 and S4 | no refusal. Opens took 682 to 836 ms |
| public market data authentication | none, S1 | none |
| message parse and routing | `{topic, type, ts, data, cts}`, S2 | route on `topic`, spelled `orderbook.<depth>.<symbol>`, or on `data.s` |
| subscribe acknowledgement shape | `{"success": true, "ret_msg": "", "conn_id": …, "req_id": "", "op": "subscribe"}`, S1 | as documented, one ack per request frame, 177 to 196 ms after the frame, and the first snapshots arrived 1 to 5 ms before their ack |
| symbol identifier format | `BTCUSDT`, S2 | identical to the REST `symbol` and to CCXT `market.id` through the `bybit` class, on 697 of 697. The `orderbook.1` frame of `BTCUSDT` carried `data.s` `BTC2USDT`, section 4 |
| number representation | prices and sizes as strings, S2 | strings on every book and ticker frame |
| timestamp representation | `ts` and `cts` in ms, S2 | integer ms. On the own `BTCUSDT` and `ETHUSDT` snapshots `cts` trailed arrival by 737 and 986 ms |
| size unit | Not publicly specified | base coin on USDT-M, USD contracts on inverse, section 4 |
| sequence semantics | `u` is a sequence, and `u` equal to 1 is a snapshot after a service restart, S2 | `u` rose by exactly 1 on every delta: 0 gaps in 144,461 and 165,011 deltas on 697 perpetuals over 40 s in two runs, and no `u` of 1 |
| idle repeat behaviour | level 1 repeats its snapshot after 3 s without change, S2 | `orderbook.50` repeated nothing, and 146 and 138 of 697 topics went more than 10 s without a frame, the longest 36.3 and 34.9 s. `orderbook.1` repeated at about 3 s, with gaps up to 5.8 s |

## 4. The book channel in detail

`orderbook.50` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Whose book this is

The wire shows two kinds of perpetual on the linear URL.
P3 subscribed all 697 on one Zoomex socket and one Bybit socket for 40 s, twice.

| kind | perpetuals, run 1 and run 2 | what the stream carries | evidence |
|---|---|---|---|
| Bybit's book, relayed | 688 and 687 | every Zoomex frame has a Bybit frame with the same `u` and `seq` | P3 |
| mostly relayed | 5 and 6, a different set each run | all but 1 to 7 Zoomex frames have a Bybit twin | P3 |
| Zoomex's own book | 4 in both runs: `BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `GMTUSDT` | its own `u` and `seq`, no frame in common with Bybit, a median of 2.2 and 3.9 frames a second against Bybit's 33.6 and 36.9 | P3, P2 |

On the relayed `CHRUSDT` and `ZILUSDT` every matched frame also had the same `ts`, `cts` and levels, 392 and 457 frames in two runs of P2.
The REST side agrees.
Recent trades on `XRPUSDT` and `CHRUSDT` carried Bybit's execution ids, 60 of 60 on each, and `ETHUSDT` carried none, see [`rest.md`](./rest.md) section 2.
The single symbol REST ticker differs from the bulk row, which is Bybit's, on exactly the same four perpetuals, see [`rest.md`](./rest.md) section 3.
The Help Center returned 0 articles for the word "bybit" on 2026-09-23, S6, so the relationship is read from the wire, not from any Zoomex statement.

The relay adds almost no delay from this host.

| run | frames seen on both sockets | Zoomex arrival minus Bybit arrival |
|---|---:|---|
| P3 run 1 | 144,770 | median 10 ms, p10 9, p90 12, p99 58, max 341 |
| P3 run 2 | 165,173 | median 5 ms, p10 3, p90 7, p99 108, max 118 |
| P2 run 1, six symbols | 392 | median −5 ms |
| P2 run 2, six symbols | 457 | median −2 ms |

The four own books are a separate market that trades near Bybit's price.
P2 sampled both touches every 100 ms for 37 s, 369 samples per symbol, in two runs:

| perpetual | Zoomex frame gap, median | Bybit frame gap, median | same touch as Bybit | Zoomex touch crossed Bybit's | largest cross | mid difference, median |
|---|---|---|---|---|---|---|
| `BTCUSDT` | 1,000 and 22 ms | 21 and 20 ms | 0 and 0 | 368 and 366 | 66 and 131 ppm | 28.9 and 42.6 ppm |
| `ETHUSDT` | 760 and 80 ms | 21 and 20 ms | 0 and 0 | 107 and 369 | 101 and 176 ppm | 45.2 and 111.5 ppm |
| `SOLUSDT` | 120 and 100 ms | 21 and 20 ms | 1 and 0 | 20 and 14 | 168 and 167 ppm | 126.1 and 83.7 ppm |
| `GMTUSDT` | 262 and 100 ms | 41 and 80 ms | 0 and 0 | 1 and 0 | 457 and 0 ppm | 228.8 and 0 ppm |
| `CHRUSDT`, relayed | 21 and 20 ms | 21 and 20 ms | 369 and 369 | 0 and 0 | 0 | 0 |

The p90 frame gap of the own `BTCUSDT` book was 1,040 and 977 ms, and of `ETHUSDT` 1,022 and 758 ms, so these books move in bursts with pauses of up to about a second.
The standing difference from Bybit is tens to a few hundred ppm, below the 1,150 ppm that a Zoomex taker and a Bybit taker cost together, see [`fees.md`](./fees.md) section 9.

The `orderbook.1` frame for `BTCUSDT` named its symbol `BTC2USDT` in `data.s`, which suggests the own books are separate instruments on the same engine under an internal name.
That is an inference.
The `seq` of Zoomex's `ETHUSDT` sat within a few thousand of the `seq` of the relayed `CHRUSDT`, and `BTCUSDT`, `SOLUSDT` and `GMTUSDT` shared one `seq` range, so the own books run on Bybit's sequence ranges as well.

### Snapshot on subscribe

The first frame for each topic is `"type": "snapshot"` with 50 bids and 50 asks.
On 2026-09-23 it arrived 175 to 191 ms after the subscribe frame on the four book topics in the P1 runs, and all 697 snapshots arrived within 1,247 and 1,372 ms in the two P3 runs.
No second snapshot came on any `orderbook.50` topic in P1 or P3.
The documentation says a later snapshot replaces the book, "If you receive a new snapshot message, you will have to reset your local orderbook", S2.

### Delta semantics

A delta carries `b` and `a` arrays of `[price, size]` strings, `u` and `seq`.
A size of `"0"` deletes the level, S2.
No delta with both arrays empty was seen, in P1 or in the 165,011 deltas of the second P3 run.

### Sequence and gap rule

```text
type = snapshot                 replace the book, last = u
type = delta, u = last + 1      apply, last = u
type = delta, u ≠ last + 1      gap: resync
u = 1                           the service restarted and this is a snapshot, S2
```

The rule held on every delta, with 0 gaps in 144,461 and 165,011 deltas on 697 perpetuals in the two P3 runs and 0 on every topic of P1.
`seq` is a cross sequence shared by several symbols and never went backwards.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | descending on every topic, 697 of 697 in P3 | ascending on every topic |
| delta | descending on every delta of P1 and of the second P3 run | ascending on every delta of P1 and of the second P3 run |
| REST `orderbook` | descending, "Sort by price desc" | ascending |

A feed still applies deltas by price and never by position.

### Level window

A book kept from the snapshot and every delta never held more than 50 levels per side, in P1 and P3.
So a level leaving the window arrives as a `"0"` size.

### Size unit against CCXT `contractSize`

| perpetual | CCXT `contractSize` through the `bybit` class | socket size at the touch | REST size at the same price | unit |
|---|---:|---|---|---|
| `BTCUSDT` | 1 | `"33.169"` bid | equal, 40 of the top 40 levels matched the REST book in each P1 run | BTC |
| `BTCUSD`, inverse | 1 | `"5790"` bid | not compared | USD contracts |

On USDT-M the size is base coin and CCXT's `contractSize` of 1 is right, so the engine's `sizeMul` converts correctly.
On inverse the size is a count of 1 USD contracts, while CCXT sets `contractSize` from `minOrderQty`, at `server/node_modules/ccxt/js/src/bybit.js` line 2199, which is 1 here.
The engine would read 5,790 contracts as 5,790 BTC.
The quote family ranks an inverse contract after the USDT one, so it is not traded today.

### One-sided and empty books

None was seen.
The engine's `resetBook` accepts an empty side.

### Idle repeats

`orderbook.50` repeats nothing.
A quiet perpetual sends no frame while nothing in its 50 levels changes, and 146 and 138 of 697 went more than 10 s without a frame in 40 s, the longest 36.3 and 34.9 s, in the two P3 runs.
`orderbook.1` re-sends a snapshot after about 3 s without change, as documented, and its longest gaps on `CHRUSDT` were 5.8 and 4.9 s.

### Unknown, closed and wrong-level symbols

| request | reply |
|---|---|
| `orderbook.50.NOPEUSDT` | `"success": false, "ret_msg": "error:handler not found,topic:orderbook.50.NOPEUSDT"` |
| `orderbook.30.BTCUSDT` | `error:handler not found,topic:orderbook.30.BTCUSDT` |
| `orderbook.500.BTCUSDT` | `error:handler not found,topic:orderbook.500.BTCUSDT` |
| `nope.BTCUSDT` | `error:handler not found,topic:nope.BTCUSDT` |
| `orderbook.50.btcusdt`, lower case | `error:handler not found,topic:orderbook.50.btcusdt` |
| `orderbook.50.BTCUSD` on the linear URL | `error:handler not found,topic:orderbook.50.BTCUSD` |
| `orderbook.50.ETHUSDT` and `orderbook.50.NOPE2USDT` in one frame | one failure naming `NOPE2USDT`, and `ETHUSDT` never delivered |
| the same topic twice | `error:already subscribed,topic:orderbook.50.CHRUSDT`, and the first keeps delivering |
| `{"op": "nope"}` | `error:invalid op` |
| text that is not JSON | `Failed to decode incoming data:…`, and the socket stays open |

A delisted contract was not available to probe, since all 697 were `Trading`.
Because one refused topic fails its whole frame, a feed that subscribes a stale symbol loses every other topic in that frame.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client `{"op": "ping"}` every 20 s, S1 | `{"success":true,"ret_msg":"pong","conn_id":…,"req_id":…,"op":"ping"}` in 171 to 183 ms. No server protocol ping. A protocol ping from the client is answered with a protocol pong, 8 in 40 s |
| silence the server tolerates | Not publicly specified | about 10 s without a frame from the server. Closed with 1006: no subscription at 9,993 to 9,997 ms, and a subscription to the quiet `POPMARTUSDT` book, which sent 5 frames and then nothing, at 10,849 and 11,564 ms, even with a 20 s ping. Kept open for the whole test, 40 to 110 s: an application ping every 5 s with or without a subscription, a protocol ping every 5 s, and a client that sent nothing after subscribing to `orderbook.1`, which repeats every 3 s. So what counts is traffic from the server, and a pong is enough |
| forced disconnect | "your may get disconnected at any time", S1 | none on a busy socket in 110 s |
| maintenance notice | none documented | none seen |
| compression | Not publicly specified | text JSON frames. A client that offers permessage-deflate gets `permessage-deflate; server_no_context_takeover; client_no_context_takeover`, and a client that does not offer it gets none |
| handshake | | 682 to 836 ms from this host |
| subscription limits | 21,000 characters of args per connection, S1 | 28,028 characters were accepted |
| throughput | | 697 perpetuals on one socket, two runs: median 3,512 and 3,998 frames a second, peak 7,423 and 8,754, 949 and 1,097 KB a second, 262 and 265 bytes a frame, 7 and 7.3 µs `JSON.parse` a frame |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Level arrays are cut to three per side.

Subscribe, and its acknowledgement.

```json
{"req_id": "book50", "op": "subscribe", "args": ["orderbook.50.BTCUSDT", "orderbook.50.ETHUSDT", "orderbook.50.CHRUSDT", "orderbook.50.AAPLUSDT"]}
```

```json
{"success":true,"ret_msg":"","conn_id":"da7tmrdms2cltqn1afv0-8d6qq","req_id":"book50","op":"subscribe"}
```

Snapshot of an own book.

```json
{"topic":"orderbook.50.BTCUSDT","type":"snapshot","ts":1790133764137,"data":{"s":"BTCUSDT","b":[["86635.40","33.169"],["86632.40","28.051"],["86630.60","20.432"]],"a":[["86635.50","6.989"],["86636.90","16.700"],["86638.60","21.918"]],"u":13714346,"seq":264183962424},"cts":1790133763508}
```

Deltas of a relayed book.

```json
{"topic":"orderbook.50.CHRUSDT","type":"delta","ts":1790133764097,"data":{"s":"CHRUSDT","b":[],"a":[["0.021294","784.0"],["0.021312","469.6"],["0.021351","0"]],"u":27351942,"seq":350390591116},"cts":1790133764087}
```

```json
{"topic":"orderbook.50.CHRUSDT","type":"delta","ts":1790133764117,"data":{"s":"CHRUSDT","b":[["0.021197","6558.5"],["0.021177","0"],["0.021142","260.2"]],"a":[["0.021294","1253.6"],["0.021312","0"],["0.021351","257.6"]],"u":27351943,"seq":350390591136},"cts":1790133764099}
```

Level 1 snapshot of the own `BTCUSDT` book, whose `data.s` is `BTC2USDT`.

```json
{"topic":"orderbook.1.BTCUSDT","ts":1790133763511,"type":"snapshot","data":{"s":"BTC2USDT","b":[["86635.4","33.169"]],"a":[["86635.5","6.989"]],"u":14766676,"seq":264183962424},"cts":1790133763508}
```

Inverse snapshot, with sizes in USD contracts.

```json
{"topic":"orderbook.50.BTCUSD","type":"snapshot","ts":1790133764463,"data":{"s":"BTCUSD","b":[["86617.90","5790"],["86614.70","63142"],["86614.60","211521"]],"a":[["86618.00","30"],["86621.50","5"],["86624.30","10"]],"u":171692818,"seq":118127548607},"cts":1790133764460}
```

Keepalive.

```json
{"req_id": "ping", "op": "ping"}
```

```json
{"success":true,"ret_msg":"pong","conn_id":"da7tpq4ai1koo26je09g-8fjpv","req_id":"ping","op":"ping"}
```

Errors.

```json
{"success":false,"ret_msg":"error:handler not found,topic:orderbook.50.NOPEUSDT","conn_id":"da7tpq4ai1koo26je09g-8fjpv","req_id":"unknown_symbol","op":"subscribe"}
```

```json
{"success":false,"ret_msg":"error:already subscribed,topic:orderbook.50.CHRUSDT","conn_id":"da7tpq4ai1koo26je09g-8fjpv","req_id":"duplicate","op":"subscribe"}
```

Ticker delta, which carries only the fields that changed.

```json
{"topic":"tickers.CHRUSDT","type":"delta","data":{"symbol":"CHRUSDT","ask1Price":"0.021256","ask1Size":"787.2"},"cs":350390589868,"ts":1790133763121}
```

## 7. Private channels

Named for a future execution stage, from S5, not probed.
They use `wss://stream.zoomex.com/v3/private` and an `auth` operation.

- `execution`, `order`, `position`, `wallet`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
It assumes the venue is kept at all, which [`rest.md`](./rest.md) section 8 questions.

| item | recommendation | reason |
|---|---|---|
| code | reuse [`bybit.ts`](../../../server/src/venues/bybit/bybit.ts) with the two URLs and the ping interval made parameters | same topics, frames, acks, ping and `u` rule |
| URL plan | `wss://stream.zoomex.com/v5/public/linear` for USDT-M, and the inverse URL only if an inverse market is ever kept | a socket serves one family |
| markets | the four own books, `BTCUSDT`, `ETHUSDT`, `SOLUSDT`, `GMTUSDT`, if Bybit stays a venue | the other 693 are Bybit's book, section 4 |
| channel | `orderbook.50.<rawMarketId>` | snapshot on subscribe, strict `u` chain, 50 levels covers the engine's 20 |
| markets per connection | 200, as for Bybit | 697 topics ran on one socket with 0 gaps twice, and 28,028 characters of args were accepted |
| subscribe frames | 200 topics per frame, and never a symbol that is not in the current catalog | one refused topic drops its whole frame |
| keepalive | `{"op": "ping"}` every 5 s, not Bybit's 20 s | the server closes a socket that it has sent nothing on for about 10 s, and a socket of four markets or of quiet markets can go that long without a book frame |
| `maxSilenceMs` | 15,000 | three missed pongs, and the pong is the traffic that keeps both ends alive |
| snapshot | `type === 'snapshot'`: `resetBook` and store `u` | documented replace semantics |
| delta | apply only when `u === last + 1`, then store `u` | 0 gaps observed |
| resync | `u !== last + 1`, or a delta before any snapshot: `resync` | the engine's existing path |
| receive time | stamp on arrival, never from `ts` or `cts` | an own book's `cts` trailed arrival by up to 986 ms |
| deflate | keep `perMessageDeflate: false` | the server negotiates it only when offered |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Zoomex API documentation, WebSocket Connect | https://zoomexglobal.github.io/docs/v3/ws/connect | 2026-09-23 | Zoomex | URLs, ping, subscribe and ack shapes, args cap, connection limits, sections 1 to 5 |
| S2 | Zoomex API documentation, WebSocket Orderbook | https://zoomexglobal.github.io/docs/v3/websocket/public/orderbook | 2026-09-23 | Zoomex | depths and speeds, snapshot and delta rules, `u` and `seq`, section 4 |
| S3 | Zoomex API documentation, WebSocket Ticker and Trade | https://zoomexglobal.github.io/docs/v3/websocket/public/ticker and https://zoomexglobal.github.io/docs/v3/websocket/public/trade | 2026-09-23 | Zoomex | ticker fields and speed, section 2 |
| S4 | Zoomex API documentation, Rate Limit | https://zoomexglobal.github.io/docs/v3/rate-limit | 2026-09-23 | Zoomex | 500 connections per 5 minutes, 1,000 market data connections per IP, section 3 |
| S5 | Zoomex API documentation, private WebSocket pages | https://zoomexglobal.github.io/docs/v3/websocket/private/order | 2026-09-23 | Zoomex | private topic names, section 7 |
| S6 | Zoomex Help Center search API, query `bybit` | https://zoomex.zendesk.com/api/v2/help_center/articles/search.json?query=bybit | 2026-09-23 | Zoomex | 0 articles, section 4 |
| P1 | `ws-probe.mjs book` at 03:18, 03:22 and 03:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/zoomex/ws-probe.mjs) | 2026-09-23 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs mirror` at 03:28 and 03:45 UTC, and `tickers` at 03:27 and 03:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/zoomex/ws-probe.mjs) | 2026-09-23 | this host | section 4, whose book, touch compare |
| P3 | `ws-probe.mjs batch` at 03:21 and 03:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/zoomex/ws-probe.mjs) | 2026-09-23 | this host | sections 3 to 5, relay classes, throughput |
| P4 | `ws-probe.mjs errors` at 03:23 and 03:46 UTC, `deflate` at 03:24 and 03:47 UTC, `silence` at 03:48 UTC, `idle` at 03:50 UTC. The first `silence` run, at 03:24 UTC, used an earlier variant set that subscribed `orderbook.1.CHRUSDT` with no client frame, held 110 s, and sent a protocol ping every 10 s with no subscription, closed at 9,997 ms before its first ping | [`ws-probe.mjs`](../../../scripts/probes/venues/zoomex/ws-probe.mjs) | 2026-09-23 | this host | sections 3 to 6 |
