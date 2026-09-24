# Gate US WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 2026-09-23 03:17 to 03:28 UTC, and the second pass 03:33 to 03:37 UTC, from the development host near Seattle.

This profile covers the public spot WebSocket v4 of Gate US, which has no CCXT class, as the survey plan's template change 1 asks.
Gate US lists no perpetual, so there is no futures socket, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/gate-us/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation pages refuse this host with HTTP 403, so they were read through a fetch that does not originate here, see [`fees.md`](./fees.md) section 1.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, USD and USDT pairs | `wss://ws.gate.us/v4/`, S5 | open in 208 to 322 ms on the 15 sockets whose open time was logged, all 385 pairs served on one socket |
| futures | none documented, S5 | none, the REST futures paths answer 404, see [`rest.md`](./rest.md) section 3 |
| `wss://api.gate.us/ws/v4/` | not documented | HTTP 404 on the upgrade, one try at 03:17 UTC |

One socket carries every spot pair, USD and USDT quoted alike.
`ws.gate.us` resolved to 34.225.80.29 and 32.195.162.248 on both passes, P1 of [`rest.md`](./rest.md).
The documentation's last changelog entry is 2024-11-28, S5.

## 2. Channel matrix for public market data

| channel | payload | depth and speed, S5 | probed |
|---|---|---|---|
| `spot.order_book` | `["BTC_USD", "20", "100ms"]` | level 5, 10, 20, 50 or 100, interval `100ms` or `1000ms` | a whole top-of-book snapshot on subscribe and on every change, recommended |
| `spot.order_book_update` | `["BTC_USD", "100ms"]` | `100ms` only, and `1000ms` "removed" on 2024-11-28 | diffs only, no snapshot. `1000ms` is still accepted and `20ms` is refused |
| `spot.obu` | `["ob.BTC_USD.50"]` | not documented | code 2 `Unknown channel spot.obu` |
| `spot.book_ticker` | `["BTC_USD", "SOL_USD"]`, several pairs in one frame | best bid and ask, 10 ms | 66 to 173 `BTC_USD` frames per run of about 61 s, 3 to 7 on `SAND_USD` |
| `spot.tickers` | pair list | 1000 ms | 21 and 42 `BTC_USD` frames per run of about 61 s, 5 and 8 on `SAND_USD` |
| `spot.trades`, `spot.trades_v2`, `spot.candlesticks` | | realtime and 2000 ms | not probed |

No mark, index or funding channel exists, since the venue lists no perpetual.
The `spot.tickers` `last` is not the venue's own last trade, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for all spot, S5 | 385 pairs of both quotes on one socket, P6 |
| subscribe frame shape | `{"time": <s>, "channel": "spot.order_book", "event": "subscribe", "payload": ["BTC_USD", "20", "100ms"]}`, one pair per frame on the book channels | one frame per pair, 385 frames in one burst all acked |
| unknown symbol expectation | code 2 "Invalid argument provided", S5 | code 2 `unknown currency pair: NOPE_USD` on `spot.order_book_update`, `spot.order_book` and `spot.book_ticker`, `result.status` `fail` |
| chunk unit and budget | Not publicly specified | 385 subscribe frames on one socket, the last ack 298 to 382 ms after the burst was sent, P6 |
| keepalive mechanism | "The server uses the protocol layer ping/pong message to check if client is still connected", and `spot.ping` is an "additional connection reachability check", S5 | no server protocol ping on the 9 sockets that logged pings. `spot.pong` came back in 65 to 68 ms |
| connection lifetime and maintenance notice | Not publicly specified | no forced close on a busy socket in 110 s |
| handshake and operation rate limits | Not publicly specified | no refusal at 385 subscribe frames in one burst on each of two sockets at once |
| public market data authentication | none | none |
| message parse and routing | `{time, time_ms, channel, event, result}` | `spot.order_book` and `spot.order_book_update` route on `result.s`, the pair id |
| subscribe acknowledgement shape | `{time, channel, event, error, result}` | `{"time", "time_ms", "conn_id", "trace_id", "channel", "event": "subscribe", "payload", "result": {"status": "success"}, "requestId"}`, and a failure adds `error: {code, message}` with `status` `fail` |
| symbol identifier format | `BTC_USDT` | identical to the REST `id` on every pair subscribed, and `btc_usd` is refused as unknown |
| number representation | price and amount strings | strings for prices and sizes on every book channel and on `spot.book_ticker` |
| timestamp representation | `t` in ms | `result.t` integer ms, envelope `time` in s and `time_ms` in ms, and the diff's `E` in s |
| size unit | base currency amount | base currency, `"13.548"` SOL on `SOL_USD`, which fits CCXT's spot `contractSize` of `undefined` |
| sequence semantics | diffs carry `U` and `u`, and a gap means "updates were lost", S5 | 0 gaps in 767 and 293 diffs on five pairs over about 61 s, and in 10,097 and 8,821 diffs on 385 pairs over 45 s |
| idle repeat behaviour | not documented | no repeated `lastUpdateId` and no repeated best bid and ask. A quiet book went 23.3 s without a push |

## 4. The book channels in detail

### `spot.order_book`, the recommended channel

Each push is the whole top of the book at the requested level, `bids` "sorted by price high to low" and `asks` "sorted by price low to high", with `lastUpdateId`, S5.

| item | first pass | second pass |
|---|---|---|
| snapshot on subscribe | not timed on the five pairs | yes, 129 to 130 ms after the subscribe on 5 of 5 |
| on 385 pairs, first frame after the burst | 384 of 385 within 260 to 435 ms | 384 of 385 within 78 to 434 ms |
| pushes per pair in about 61 s | 12 to 263 | 6 to 93 |
| gap between pushes | not timed | min 86 ms, median 299 to 500 ms on the four active pairs, max 23.3 s on `SAND_USD` |
| repeated `lastUpdateId` | 0 | 0 |
| unordered snapshot | 0 of 770 | 0 of 296 |
| levels per side | 20 when the book is deeper, fewer when not, as `20/17` or `18/17` | same |

P5 and P6.
A push comes only when the book changed, so the channel is a stream of whole replacements with no sequence to keep.
The batch did not log which pair sent nothing, and the count fits `CP_USDT`, an empty book that sent nothing in P8, see "One-sided and empty books" below.

### `spot.order_book_update`, the documented diff channel

A diff carries `U`, `u`, `b` and `a`, and the documented recipe caches diffs, reads a REST book with `with_id=true`, drops diffs with `u` below the REST `id` plus one, and applies the rest, S5.
Sizes are absolute, and a size of `"0"` deletes the level.
No diff frame carried a `full` key, and the first diff after the subscribe is an ordinary diff, P5.

| item | first pass | second pass |
|---|---|---|
| diffs on five pairs in about 61 s | 767, 0 gaps | 293, 0 gaps |
| diffs on 385 pairs in 45 s | 10,097 on 371 pairs, 0 gaps | 8,821 on 336 pairs, 0 gaps |
| empty diffs | 0 | 0 |
| book kept from REST plus diffs against the 20 level snapshot at the same id | 137 of 137, 45 of 45, 67 of 67 and 1 of 1 equal on four pairs | 62 of 62, 13 of 13 and 25 of 25 equal on three, `SAND_USD` had no comparable push |
| `BTC_USD` | REST 22,540 ms old and older than the first cached diff, 0 of 116 equal | REST 10,070 ms old, older than the first cached diff, 0 of 48 equal |

P5 and P6.
The diff chain itself never broke.
The recipe broke on `BTC_USD` both times because the REST book is a cached copy, see [`rest.md`](./rest.md) section 5, so a diff feed would loop on refetches until a fresh enough REST read arrives.

### Sequence and gap rule

```text
spot.order_book         every push replaces the top of the book, lastUpdateId only grows
spot.order_book_update  U = previous u + 1, else updates were lost: refetch the REST book (documented)
```

The REST `id`, the diff `U` and `u`, the snapshot `lastUpdateId` and the `spot.book_ticker` `u` are one counter per pair, P5.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `spot.order_book` | descending on every push | ascending on every push |
| `spot.order_book_update` | unordered: 223 and 105 multi-level bid arrays per run were not descending | unordered: 141 and 58 ask arrays were not ascending |
| REST `order_book` | descending | ascending |

A diff feed applies levels by price and never by position.

### Size unit

Sizes are base currency amounts as decimal strings: `BTC_USD` `"0.14178"` BTC, `SOL_USD` `"13.548"` SOL, `SAND_USD` `"22478"` SAND, P5.
CCXT spot markets carry `contractSize` `undefined`, and the connector turns a missing contract size into 1 at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 175 and 188 to 191, so the unit would be read correctly.

### One-sided and empty books

`ZEN_USDT`, `PVP_USDT`, `CP_USDT`, `RAVE_USDT` and `AEON_USDT` had no bid and no ask on both passes, P8.
`spot.order_book` sent one snapshot with empty `bids` and `asks` on four of them within 8 s, and nothing on `CP_USDT`.
`spot.order_book_update` on `ZEN_USDT` sent only the acknowledgement in 60 s, P7.
A one-sided book was not seen, so what a push holds for one empty side is Not verified.
The engine's `resetBook` accepts an empty side.

### Idle repeats

Nothing is repeated.
`spot.order_book` sent no push with an unchanged `lastUpdateId`, and `spot.book_ticker` sent no repeated best bid and ask, over both passes, P5.
`SAND_USD` went 23.3 s and `SOL_USD` 14.0 s without a book push in the second pass.

### Unknown, closed and malformed requests

| request | reply |
|---|---|
| `spot.order_book_update` `["NOPE_USD", "100ms"]` | code 2 `unknown currency pair: NOPE_USD` |
| `spot.order_book_update` `["btc_usd", "100ms"]` | code 2 `unknown currency pair: btc_usd` |
| `spot.order_book_update` `["BTC_USD", "20ms"]` | code 2 `incorrect update interval specified: 20ms` |
| `spot.order_book_update` `["BTC_USD", "1000ms"]` | success, although the changelog removed it |
| `spot.order_book` `["BTC_USD", "30", "100ms"]` | code 2 `provided level not supported: 30` |
| `spot.order_book` `["BTC_USD", "100", "1000ms"]` | success |
| `spot.book_ticker` `["NOPE_USD"]` | code 2 `unknown currency pair: NOPE_USD` |
| `spot.obu`, `spot.nope` | code 2 `Unknown channel spot.obu`, `Unknown channel spot.nope` |
| the same `spot.order_book_update` subscribe twice | success both times |
| unsubscribe | success |
| text that is not JSON | no reply, and the socket stays open |

P8, on both passes.
A closed or delisted pair was not available to probe, since all 385 pairs were `tradable`.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | the server pings at the protocol layer, and `spot.ping` answers `spot.pong`, S5 | 0 server protocol pings on the 9 sockets that logged them, the longest open 110 s. `spot.pong` in 65 to 68 ms |
| silence the server tolerates | Not publicly specified | a socket with no subscription and no client frame closed at 29,997 and 30,001 ms with 1006 and no close frame. A socket subscribed to the empty `ZEN_USDT` book, which received only the ack, closed at 59,998 ms with 1006. A socket with no subscription and a `spot.ping` every 25 s, and one on the busy `ALGO_USD` diff stream, stayed open for the full 110 s |
| forced disconnect | Not publicly specified | none in 110 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no extension back, twice, P9 |
| handshake | | 208 to 322 ms to open from this host |
| subscription limits | Not publicly specified | 385 streams on one socket with no refusal |

P7 and P9.
Throughput with every pair on one socket, from P6:

| channel | frames per second, median and peak | bytes per second | bytes per frame | `JSON.parse` per frame |
|---|---|---|---|---|
| `spot.order_book_update` | 208 and 524, then 187 and 303 | 64.7 KB, then 54.3 KB | 288, then 277 | 7.2 µs, then 7.5 µs |
| `spot.order_book` at 20 levels | 208 and 521, then 188 and 303 | 211 KB, then 185 KB | 938, then 928 | 23.9 µs, then 25.2 µs |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.

Subscribe and acknowledgement.

```json
{"time": 1790134390, "channel": "spot.order_book", "event": "subscribe", "payload": ["BTC_USD", "20", "100ms"]}
```

```json
{"time":1790134390,"time_ms":1790134390715,"conn_id":"3e2ed73842f9228b","trace_id":"591b14399528dc8711dbe13910a3ceb4","channel":"spot.order_book","event":"subscribe","payload":["BTC_USD","20","100ms"],"result":{"status":"success"},"requestId":"591b14399528dc8711dbe13910a3ceb4"}
```

Snapshot on `spot.order_book`, first three levels per side kept.

```json
{"time":1790134390,"time_ms":1790134390759,"channel":"spot.order_book","event":"update","result":{"t":1790134390437,"lastUpdateId":48123154,"s":"SOL_USD","bids":[["118.91","13.548"],["118.89","13.134"],["118.87","11.925"]],"asks":[["118.99","43.704"],["119.05","13.633"],["119.07","13.303"]]}}
```

Diff on `spot.order_book_update`, first three bid levels kept, and a delete.
The bids are not in price order.

```json
{"time":1790134390,"time_ms":1790134390859,"channel":"spot.order_book_update","event":"update","result":{"t":1790134390805,"e":"depthUpdate","E":1790134390,"s":"ETH_USDT","U":474334686,"u":474334687,"b":[["2765.2","1.4816"],["2766.31","1.4816"],["2761.72","0.6967"]],"a":[]}}
```

```json
{"time":1790133869,"time_ms":1790133869859,"channel":"spot.order_book_update","event":"update","result":{"t":1790133869806,"e":"depthUpdate","E":1790133869,"s":"SAND_USD","U":2448207,"u":2448207,"b":[],"a":[["0.04446","0"]]}}
```

Keepalive.

```json
{"time": 1790134410, "channel": "spot.ping"}
```

```json
{"time":1790134410,"time_ms":1790134410515,"conn_id":"3e2ed73842f9228b","channel":"spot.pong","event":"","result":null,"requestId":"591b14399528dc8711dbe13910a3ceb4"}
```

Errors.

```json
{"time":1790134507,"time_ms":1790134507715,"conn_id":"8b9b24f2d19b4d6b","trace_id":"6e4f232b79391323e3a8a26fdd9b2d9e","channel":"spot.order_book_update","event":"subscribe","payload":["NOPE_USD","100ms"],"error":{"code":2,"message":"unknown currency pair: NOPE_USD"},"result":{"status":"fail"},"requestId":"6e4f232b79391323e3a8a26fdd9b2d9e"}
```

```json
{"time":1790134510,"time_ms":1790134510123,"conn_id":"8b9b24f2d19b4d6b","trace_id":"6e4f232b79391323e3a8a26fdd9b2d9e","channel":"spot.obu","event":"subscribe","payload":["ob.BTC_USD.50"],"error":{"code":2,"message":"Unknown channel spot.obu"},"result":{"status":"fail"},"requestId":"6e4f232b79391323e3a8a26fdd9b2d9e"}
```

Best bid and ask.

```json
{"time":1790134391,"time_ms":1790134391757,"channel":"spot.book_ticker","event":"update","result":{"t":1790134391753,"u":48123156,"s":"SOL_USD","b":"118.91","B":"13.548","a":"118.99","A":"65.556"}}
```

Ticker, whose `last` of 86695.3 sits above its own `lowest_ask`.

```json
{"time":1790134390,"time_ms":1790134390863,"channel":"spot.tickers","event":"update","result":{"currency_pair":"BTC_USDT","last":"86695.3","lowest_ask":"86691.6","highest_bid":"86690","change_percentage":"1.3401","base_volume":"0.211442","quote_volume":"18239.3197469","high_24h":"86835.7","low_24h":"85121.6"}}
```

## 7. Private channels

Named for a future execution stage, from S5, not probed.
They use the same URL and a login.

- `spot.orders`, `spot.orders_v2`, `spot.usertrades`, `spot.usertrades_v2`, `spot.balances`, `spot.margin_balances`, `spot.funding_balances`, `spot.cross_balances`, `spot.cross_loan`, `spot.priceorders`.
- Order entry over the socket uses `spot.login`, `spot.order_place`, `spot.order_cancel`, `spot.order_cancel_all_with_id_list`, `spot.order_cancel_all_with_specified_currency_pair`, `spot.order_amend` and `spot.order_status`.
- No `futures.*` channel appears in the documentation.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
The engine consumes perpetuals only, so no Gate US feed is recommended today, and the shape below applies only if a spot leg is ever added.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://ws.gate.us/v4/` | one URL serves every pair |
| channel | `spot.order_book`, payload `[rawMarketId, "20", "100ms"]` | a whole top 20 on subscribe and on every change, ordered, no sequence to keep, and 20 levels is the engine's `depthLevels` |
| markets per connection | all 385 | 385 ran on one socket at a median 208 and 188 frames per second |
| subscribe frames | one frame per pair | the book channels take one pair per payload |
| keepalive | `{"time": <s>, "channel": "spot.ping"}` every 15 s | the server sent no ping, an idle socket dies at 30 s, and a socket whose only stream is quiet died at 60 s |
| `maxSilenceMs` | 45,000 | three missed pongs, and a quiet pair went 23.3 s without a push, so the pong has to count as traffic |
| routing | `result.s` is the `rawMarketId` | the pair id is sent as is |
| snapshot | every push: `resetBook` from `bids` and `asks` | each push is a replacement |
| stale push | ignore a push whose `lastUpdateId` is not above the last one seen | the counter only grew in both passes |
| resync | none needed on the snapshot channel, and a close or silence goes through the existing reconnect | there is no gap to detect |
| unserved stream | log a pair with no push 10 s after its ack | `CP_USDT`, an empty book, sent nothing |
| receive time | stamp on arrival, never from `t` | the venue's `t` is the book time, not the send time |
| sizes | `Number()` of the string | base currency amounts |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

`spot.order_book_update` with the REST recipe is the alternative, and it is worse here because the REST book is cached for seconds, section 4.

## 9. Source ledger

Ledger ids are shared by the three Gate US files, so an id missing here is used in another file.

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S5 | Gate US Spot WebSocket v4 documentation, changelog to 2024-11-28 | https://us.gate.com/docs/developers/apiv4/ws/en/ | 2026-09-22 | Gate US, Inc., US | URL, channels, payload enums, recipe, ping text, error codes, private channel names, sections 1 to 5 and 7 |
| P1 | `rest-probe.mjs catalog`, at 03:20 and 03:31 UTC on 2026-09-23 | [`rest-probe.mjs`](../../../scripts/probes/venues/gate-us/rest-probe.mjs) | 2026-09-22 | this host | DNS of `ws.gate.us`, section 1 |
| P5 | `ws-probe.mjs book`, at 03:23 and 03:33 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/gate-us/ws-probe.mjs) | 2026-09-22 | this host | channels, snapshot, recipe, level order, pongs, sections 2 to 6 |
| P6 | `ws-probe.mjs batch`, at 03:25 and 03:34 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/gate-us/ws-probe.mjs) | 2026-09-22 | this host | 385 pairs on one socket, throughput, gaps, sections 3 to 5 |
| P7 | `ws-probe.mjs silence`, at 03:26 with three sockets and 03:35 with four | [`ws-probe.mjs`](../../../scripts/probes/venues/gate-us/ws-probe.mjs) | 2026-09-22 | this host | silence tolerance, protocol pings, sections 4 and 5 |
| P8 | `ws-probe.mjs errors`, at 03:23, 03:28 and 03:35 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/gate-us/ws-probe.mjs) | 2026-09-22 | this host | error replies, empty books, sections 3, 4 and 6 |
| P9 | `ws-probe.mjs deflate`, at 03:23 and 03:35 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/gate-us/ws-probe.mjs) | 2026-09-22 | this host | compression, section 5 |
