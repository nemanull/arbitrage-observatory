# Gate WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-15.

**Probed:** 2026-09-15, from the development host near Seattle.

This profile covers the public futures WebSocket v4 of Gate (CCXT id `gate`) for every perpetual family, with the book channel in detail.
Every protocol claim below was captured by [`gate-ws-probe.mjs`](../../../scripts/probes/gate-ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation pages refuse this host with HTTP 403, so they were read through a fetch that does not originate here, see [`fees.md`](./fees.md) section 1.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals | `wss://fx-ws.gateio.ws/v4/ws/usdt` | open in 463 to 601 ms, and 502 to 670 ms in the rerun, 983 contracts listed |
| BTC-margined perpetual | `wss://fx-ws.gateio.ws/v4/ws/btc` | open in 541 to 559 ms, `BTC_USD` delivers |
| USD1-margined perpetuals | `wss://fx-ws.gateio.ws/v4/ws/usd1` | open in 463, 464 and 525 ms, `BTC_USD1` delivers |
| USDT-M, binary SBE | `wss://fx-ws.gateio.ws/v4/ws/usdt/sbe` | not probed |
| dated futures | `wss://fx-ws.gateio.ws/v4/ws/delivery/usdt` and `/delivery/btc`, from CCXT Pro at `server/node_modules/ccxt/js/src/pro/gate.js` lines 82 and 83 | not probed |

One socket carries one settlement family.
A contract of another family is acknowledged and then never delivers.
On the `btc` URL, `ob.BTC_USDT.50` answered `{"status":"success"}` and sent no frame in 5 s, while `ob.BTC_USD.50` on the same socket delivered 66 to 107 frames.
On the `usdt` URL, `ob.BTC_USD.50` answered success and sent nothing in 12 s.
`fx-ws.gateio.ws` resolved to eight addresses on 2026-09-15, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed on 2026-09-15 |
|---|---|---|---|
| `futures.obu` | `["ob.BTC_USDT.50"]` | 50 levels every 20 ms, or 400 levels every 100 ms | snapshot then deltas at both depths, recommended |
| `futures.order_book_update` | `["BTC_USDT", "100ms", "100"]` | `20ms` with level `20`, or `100ms` with level `20`, `50` or `100` | deltas only, no snapshot in 30 s |
| `futures.order_book` | `["ETH_USDT", "20", "0"]` | limit 1, 5, 10, 20, 50 or 100, interval `"0"` | a whole `all` snapshot about every 100 ms, no `update` event in 30 s |
| `futures.book_ticker` | `["BTC_USDT"]` | best bid and ask on change | 496 to 1,226 frames in 30 s on BTC, 2 to 7 on CHR |
| `futures.tickers` | `["BTC_USDT"]` | on new data | 22 to 30 frames in 30 s on BTC, 0 or 1 on CHR, carries `mark_price`, `index_price`, `funding_rate`, `funding_interval`, `funding_next_apply` |
| `futures.trades` | contract list | on trade | not probed |
| `futures.candlesticks`, `futures.public_liquidates`, `futures.contract_stats`, `futures.contract_info`, `futures.adl_warning` | | | not probed |
| `futures.system` | | pushes `result.type` `upgrade` before a shutdown | not observed |

The channel names, payloads and enums are from S1.
No dedicated mark, index or funding channel exists.
The ticker channel carries all three, and it pushed at most one frame for a quiet contract in 30 s, so it cannot replace the REST anchor poll, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL per settlement currency, S1 | a contract of another family is acked and silent, section 1 |
| subscribe frame shape | `{"time": 123456, "channel": "futures.obu", "event": "subscribe", "payload": ["ob.BTC_USDT.400"]}`, one stream in the example, S1 | four streams in one `payload` array got one ack covering all four, and each delivered |
| unknown symbol expectation | error object with code 2 `invalid argument`, S1 | `futures.obu` acks `ob.NOPE_USDT.50` and `ob.BTC_USDT.20` as success and sends nothing. `futures.order_book_update` and `futures.tickers` answer code 2 `unknown currency pair` |
| chunk unit and budget | Not publicly specified | 150 streams in 150 frames on one socket, all acked, all snapshots in 705 ms |
| keepalive mechanism | "The server will initiate a ping message actively. If the client does not reply, the client will be disconnected." Application ping `futures.ping`, answer `futures.pong`, S1 | no server protocol ping on the ten sockets that logged pings, the longest open 150 s. `futures.pong` came back in 129 to 141 ms. A socket that neither subscribes nor sends closed after about 30.5 s with 1006 |
| connection lifetime and maintenance notice | `futures.system` update with `result.type` `upgrade`, "Clients should reconnect as soon as possible after receiving it.", S1 | no notice seen, and no lifetime cap reached in 150 s |
| handshake and operation rate limits | Not publicly specified | no refusal at 150 subscribe frames sent in one burst, and opens took 463 to 601 ms |
| public market data authentication | none | none |
| message parse and routing | `{time, time_ms, channel, event, result}` | `futures.obu` routes on `result.s`, spelled `ob.<contract>.<level>`. `futures.order_book_update` routes on `result.s`, spelled `<contract>` |
| subscribe acknowledgement shape | `{time, channel, event, error, result}`, S1 | `{"time", "time_ms", "conn_id", "trace_id", "channel", "event": "subscribe", "payload", "result": {"status": "success"}}`, and a failure adds `error: {code, message}` with `status` `fail`. On `futures.obu` the snapshot can arrive before the ack in the same millisecond |
| symbol identifier format | `BTC_USDT` | identical to CCXT `market.id`, to the REST `contracts` `name` and to the REST `tickers` `contract` on 983 of 983 contracts |
| number representation | `futures.obu` levels `[Price, Amount]`. The `futures.order_book_update` example shows `"s": "0"`, S1 | `futures.obu` sends price and size as strings. `futures.order_book_update` and `futures.book_ticker` send prices as strings and sizes as JSON numbers |
| timestamp representation | `t` in ms | `result.t` integer ms, envelope `time` in s and `time_ms` in ms. The snapshot of a quiet book carried `t` and `time_ms` up to 40 s old |
| size unit | contracts | contracts of `quanto_multiplier` coins, which is CCXT `contractSize`, section 4 |
| sequence semantics | on `futures.obu`, `U` must equal the local id plus one, else unsubscribe and resubscribe, S1 | 0 gaps in 6,570 and 6,603 deltas on four contracts over 75 s, and 0 in 26,292 deltas on 150 contracts over 60 s |
| idle repeat behaviour | not documented | no repeated `U` on any contract. A quiet book sends id-only deltas, and CHR went up to 36 s with no frame |

## 4. The book channel in detail

`futures.obu` at 50 levels is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame for each stream is `"full": true` with up to 50 bids and 50 asks and the stream's `u`.
Four contracts on 2026-09-15 each got exactly one snapshot, 133 to 142 ms after the subscribe frame was sent and 664 to 805 ms after the socket was created, and no further snapshot in 75 s.
The documentation says a full push replaces the local book whenever it comes, so a feed resets on every `full`, not only the first.

`futures.order_book_update` sent no `full` frame in 30 s on `BTC_USDT` at 20 ms and 20 levels, on `ETH_USDT` at 100 ms and 100 levels, or on `CHR_USDT` at 100 ms and 20 levels.
Its documented recipe caches deltas, fetches a REST book with `with_id=true`, and aligns the ids, S2.
That is the extra REST call a feed avoids by using `futures.obu`.

### Delta semantics

A delta carries `U` and `u` and, when a level changed, `b` and `a` arrays of `[price, size]` string pairs.
A size of `"0"` deletes the level.
A delta with no `b` and no `a` key is legal and only advances the id: 1,689 to 1,751 of about 3,700 BTC deltas in 75 s were empty, and 993 of 3,801 in the rerun.
The documentation for `futures.order_book_update` says "Even if the `a`, `b`, or `asks`, `bids` fields in the WebSocket push message are empty, users must still update the local order book's `id` and `timestamp`.", S2.

### Sequence and gap rule

```text
full = true           replace the book, last = u
full absent, U = last + 1   apply, last = u
full absent, U ≠ last + 1   gap: unsubscribe and resubscribe the stream (documented), or terminate the socket (the engine's resync)
```

The rule held on every delta of both runs, with 0 gaps.
The first delta after a snapshot had `U` equal to the snapshot's `u` plus one on every stream.
`futures.order_book_update` chains the same way, `U` equal to the previous `u` plus one, with 0 gaps over about 1,800 frames in each of two 30 s runs.

### Checksum

None is documented for `futures.obu` or `futures.order_book_update`, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on 4 of 4 contracts in both runs | best first, ascending, on 4 of 4 |
| delta | unordered: 440 to 1,206 BTC or ETH bid arrays per 75 s run were not descending | unordered: 591 to 1,162 ask arrays per run were not ascending |
| REST `order_book` | descending, 20, 100 and 300 levels | ascending |

A feed applies deltas by price and never by position.

### Level window

The server keeps the stream at 50 levels per side.
A book maintained from the snapshot and every delta never held more than 50 levels on any contract over 75 s, so a level leaving the window arrives as a `"0"` size.
A thin contract simply holds fewer: `CHR_USDT` held 23 bids and 45 asks.

### Size unit against CCXT `contractSize`

| contract | CCXT `contractSize` | socket size at the touch | REST size at the same price | coins |
|---|---:|---|---|---|
| `BTC_USDT` | 0.0001 | `"49965"` | `49965` | 4.9965 BTC |
| `ETH_USDT` | 0.01 | `"5923.3"` | `5923` | 59.233 ETH |
| `CHR_USDT` | 10 | `"777"` | `777` | 7,770 CHR |

The unit is contracts, and one contract is `quanto_multiplier` coins, which is exactly what CCXT reports as `contractSize`, see [`rest.md`](./rest.md) section 2.
The engine's `sizeMul` therefore converts Gate sizes correctly.
On `BTC_USDT` 38 to 40 of the top 40 socket sizes equalled the REST book at the nearest update id over four runs, and the remainder moved between the two reads.

Contracts with `enable_decimal` true trade fractional contracts, and 14 did on 2026-09-15, including `ETH_USDT`, `SOL_USDT`, `XRP_USDT` and `PEPE_USDT`.
For those, `futures.obu` sends the fractional size and the REST book sends the size rounded down.
On `ETH_USDT` 28 and 32 of the top 40 socket sizes were fractional in two runs, and all 40 REST sizes equalled the floor of the socket size at the same price.
The `X-Gate-Size-Decimal: 1` header, which the API changelog names for decimal sizes, does change the REST book.
On `ETH_USDT` at 100 levels, 0 of 200 sizes were fractional without it, and with it the sizes arrived as strings and 149 of 200 were fractional, in `gate-venue-probe.mjs decimal` at 19:16 UTC.
`futures.order_book_update` also sent integers for `ETH_USDT`.
So `futures.obu` and the REST book read with that header carry the exact size of a decimal contract, and the other book sources probed do not.

`BTC_USD` on the `btc` URL has `quanto_multiplier` `"0"`, and CCXT turns that into `contractSize` 1 with the comment "1 USD in WEB", at `server/node_modules/ccxt/js/src/gate.js` lines 1629 to 1632.
Its touch read `"500"` and `"6613"` against a price near 77,250, which is plausible as US dollars and not as bitcoin.
That reading is an inference, and it means the engine would take 500 contracts as 500 BTC.
The quote family ranks this inverse contract after `BTC_USDT`, so it is not traded today, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

`BTC_USD1` snapshots held 15 to 17 bids and 11 or 12 asks with a spread of 7.9 and 21.8 USD1 in the morning runs, and the stream sent 12 frames and then 1 frame in 5 s.
No one-sided or empty book was seen, so what `futures.obu` sends for a side with no orders is Not verified.
The engine's `resetBook` accepts an empty side.

### Idle repeats

Nothing is repeated.
A quiet contract sends id-only deltas when its hidden levels change and nothing otherwise, and `CHR_USDT` went 20 s and 24 s without a frame in the two morning runs and 36 s in the rerun.
`futures.book_ticker` did send the same best bid, best ask and sizes again 14 and 15 times in 506 and 496 BTC frames, each repeat with a new `u`.

### Unknown, closed and wrong-level symbols

| request | reply | then |
|---|---|---|
| `futures.obu` `ob.NOPE_USDT.50` | `"result": {"status": "success"}` | nothing in 12 s |
| `futures.obu` `ob.BTC_USDT.20` | success | nothing in 12 s |
| `futures.obu` `ob.BTC_USD.50` on the `usdt` URL | success | nothing in 12 s |
| `futures.obu` `ob.BTC_USDT.50` twice | the second answers `"error": {"code": 2, "message": "Alert sub ob.BTC_USDT.50"}` | the first keeps delivering |
| `futures.order_book_update` `NOPE_USDT` | code 2 `unknown currency pair NOPE_USDT` | |
| `futures.order_book_update` level `30` | code 2 `provided level not supported: 30` | |
| `futures.tickers` `NOPE_USDT` | code 2 `unknown currency pair: NOPE_USDT` | |
| unknown channel `futures.nope` | code 2 `Unknown channel futures.nope` | |
| text that is not JSON | code 1 `request message need json scheme` | the socket stays open |

A closed or delisted contract was not available to probe, since all 983 USDT contracts were `trading`.
Because `futures.obu` acknowledges a symbol it will never serve, the feed has to notice a stream with no snapshot on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server protocol ping, client must answer. Client may send `{"time": 123456, "channel": "futures.ping"}` | no server ping on the ten sockets that logged pings, the longest open 150 s. `futures.pong` in 129 to 141 ms, `{"time":…,"time_ms":…,"conn_id":…,"channel":"futures.pong","event":"","result":null}` |
| silence the server tolerates | Not publicly specified | a socket with no subscription and no client frame closed at 30.47 to 30.54 s, four sockets over two runs, with code 1006 and no close frame, whether or not it answered pings. A subscription on a busy or a quiet book, an application ping every 25 s, or a protocol ping every 10 s each kept a socket open for the full 150 s |
| forced disconnect | Not publicly specified | none in 150 s |
| maintenance notice | `futures.system`, `result.type` `upgrade` | not observed |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, so the server does not negotiate it |
| handshake | | 463 to 670 ms to open from this host over all runs |
| subscription limits | "For the same contract's depth stream, a single connection is allowed to subscribe only once." | confirmed by the `Alert sub` error. No per connection cap reached at 150 streams |
| throughput | | 150 USDT perpetuals, every sixth by 24 h volume: 443 frames per second, median 432, peak 710, 103 KB per second, 233 bytes per frame, 12 µs `JSON.parse` per frame |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-15.
Arrays marked `…` are cut.

Subscribe, four streams in one frame.

```json
{"time": 1789456334, "channel": "futures.obu", "event": "subscribe", "payload": ["ob.BTC_USDT.50", "ob.ETH_USDT.50", "ob.CHR_USDT.50", "ob.INIT_USDT.50"]}
```

Acknowledgement.

```json
{"time":1789456334,"time_ms":1789456334999,"conn_id":"c59a69fd3702aa1d","trace_id":"5597c780565cf57ad16784743225b18b","channel":"futures.obu","event":"subscribe","payload":["ob.BTC_USDT.50","ob.ETH_USDT.50","ob.CHR_USDT.50","ob.INIT_USDT.50"],"result":{"status":"success"}}
```

Snapshot, first three levels per side kept.
The sizes are fractional contracts of 0.01 ETH.

```json
{"time":1789456334,"time_ms":1789456334999,"channel":"futures.obu","event":"update","result":{"t":1789456334981,"full":true,"s":"ob.ETH_USDT.50","u":108552472643,"b":[["2480.27","2781.6"],["2480.25","1"],["2480.21","201.2"]],"a":[["2480.28","8292"],["2480.29","4"],["2480.33","100"]]}}
```

Snapshot of a quiet book, whose `time_ms` is 40 s older than the frame's arrival at 1789456334999 ms.

```json
{"time":1789456294,"time_ms":1789456294679,"channel":"futures.obu","event":"update","result":{"t":1789456261122,"full":true,"s":"ob.CHR_USDT.50","u":3258990980,"b":[["0.01603","777"],["0.01601","777"],["0.01599","3396"]],"a":[["0.01609","115"]]}}
```

Delta, and an id-only delta.

```json
{"time":1789455580,"time_ms":1789455580280,"channel":"futures.obu","event":"update","result":{"t":1789455580280,"s":"ob.BTC_USDT.50","U":125033675975,"u":125033676003,"b":[["77222.9","648"]],"a":[["77235","50"],["77235.2","0"]]}}
```

```json
{"time":1789455580,"time_ms":1789455580301,"channel":"futures.obu","event":"update","result":{"t":1789455580300,"s":"ob.BTC_USDT.50","U":125033676004,"u":125033676011}}
```

`futures.order_book_update` delta, with sizes as JSON numbers.

```json
{"time":1789455569,"time_ms":1789455569067,"channel":"futures.order_book_update","event":"update","result":{"t":1789455569062,"U":125033668137,"u":125033668232,"s":"BTC_USDT","a":[{"p":"77232.2","s":2100},{"p":"77233.3","s":0}],"b":[{"p":"77230","s":11364}],"l":"20"}}
```

Keepalive.

```json
{"time": 1789456354, "channel": "futures.ping"}
```

```json
{"time":1789456354,"time_ms":1789456354999,"conn_id":"c59a69fd3702aa1d","channel":"futures.pong","event":"","result":null}
```

Errors.

```json
{"time":1789456896,"time_ms":1789456896882,"conn_id":"bf37dda1698c8b1e","trace_id":"8d22020b2227c599fc38c061b09df478","channel":"futures.obu","event":"subscribe","payload":["ob.BTC_USDT.50"],"error":{"code":2,"message":"Alert sub ob.BTC_USDT.50"},"result":{"status":"fail"}}
```

```json
{"time":1789456896,"time_ms":1789456896882,"conn_id":"bf37dda1698c8b1e","trace_id":"8d22020b2227c599fc38c061b09df478","channel":"futures.obu","event":"subscribe","payload":["ob.NOPE_USDT.50"],"result":{"status":"success"}}
```

Ticker, which carries the anchor fields.

```json
{"time":1789456337,"time_ms":1789456337808,"channel":"futures.tickers","event":"update","result":[{"contract":"BTC_USDT","last":"77175.1","mark_price":"77183.5","funding_rate":"0.000072","funding_rate_indicative":"0.000072","funding_interval":28800,"funding_offset":0,"funding_next_apply":1789459200,"index_price":"77221.8","price_type":"last","t":1789456337802}]}
```

Best bid and ask.

```json
{"time":1789456337,"time_ms":1789456337019,"channel":"futures.book_ticker","event":"update","result":{"t":1789456337013,"u":125034507671,"s":"BTC_USDT","b":"77179","B":107847,"a":"77179.1","A":5808}}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same family URLs and a login.

- `futures.orders`, `futures.usertrades`, `futures.liquidates`, `futures.auto_deleverages`, `futures.position_closes`, `futures.balances`, `futures.reducerisklimits`, `futures.positions`, `futures.positions_adl`, `futures.autoorders`.
- Order entry over the socket uses `futures.login`, `futures.order_place`, `futures.order_cancel` and `futures.order_cancel_cp`, as CCXT Pro builds them at `server/node_modules/ccxt/js/src/pro/gate.js` lines 178, 235, 267 and 2196.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan per settlement family: `usdt` for the 983 USDT-M contracts, and `btc` only if the inverse contract is ever kept | a socket serves one family |
| channel | `futures.obu`, stream `ob.<rawMarketId>.50` | snapshot on subscribe, a strict `U` chain, exact decimal sizes, 50 levels covers the engine's 20 |
| markets per connection | 150 | 150 streams ran with 0 gaps at 443 frames per second, and no cap is published, so a larger slice is untested |
| subscribe frames | one frame per slice, `{"time": <s>, "channel": "futures.obu", "event": "subscribe", "payload": ["ob.BTC_USDT.50", …]}` | a multi-stream payload was acked as one |
| keepalive | `{"time": <s>, "channel": "futures.ping"}` every 15 s | the server sent no ping, a silent unsubscribed socket dies at 30 s, and the pong counts as traffic for the silence watch |
| `maxSilenceMs` | 45,000 | three missed pongs, and a quiet contract went 36 s without a book frame, so the pong has to count as traffic |
| routing | `result.s.slice(3, result.s.lastIndexOf('.'))` gives the `rawMarketId` | the stream name wraps the contract id |
| snapshot | `full === true`: `resetBook` and store `u` | documented replace semantics |
| delta | apply only when `U === last + 1`, then store `u`, including for id-only deltas | documented rule, 0 gaps observed |
| resync | `U !== last + 1`, or a delta before any snapshot: `resync`, which terminates the socket and resubscribes | the engine's existing path, and resubscribing is what the documentation asks for |
| unserved stream | log a stream with no snapshot 10 s after its ack | `futures.obu` acks unknown and wrong-family streams as success and stays silent |
| receive time | stamp on arrival, never from `t` or `time_ms` | a quiet book's snapshot carries a 40 s old time |
| sizes | `Number()` of the string, which may be fractional | decimal contracts |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Gate Futures WebSocket v4.0.0 | https://www.gate.com/docs/developers/futures/ws/en/ | 2026-09-15 | Gate, global | URLs, channel names and payloads, `futures.obu` rules, ping and pong, error codes, `futures.system`, private channel names, sections 1 to 7 |
| S2 | Gate Futures WebSocket v4.0.0, section on `futures.order_book_update` | https://www.gate.com/docs/developers/futures/ws/en/ | 2026-09-15 | Gate, global | local book recipe with `with_id` and `baseID`, update on empty arrays, section 4 |
| S3 | Gate API v4 changelog, v4.106.0 and v4.106.19 | https://www.gate.com/docs/developers/apiv4/en/ | 2026-09-15 | Gate, global | `X-Gate-Size-Decimal: 1`, `enable_decimal`, section 4 |
| S4 | CCXT Pro 4.5.68 `gate.js` | `server/node_modules/ccxt/js/src/pro/gate.js` | 2026-09-15 | CCXT | delivery URLs, order entry channel names, sections 1 and 7 |
| S5 | CCXT 4.5.68 `gate.js` | `server/node_modules/ccxt/js/src/gate.js` | 2026-09-15 | CCXT | `quanto_multiplier` of 0 becomes 1, section 4 |
| P1 | `gate-ws-probe.mjs book`, two runs at 07:12 and 07:21 UTC | [`gate-ws-probe.mjs`](../../../scripts/probes/gate-ws-probe.mjs) | 2026-09-15 | this host | sections 1 to 6 |
| P2 | `gate-ws-probe.mjs batch` and `deflate` at 07:18 UTC | [`gate-ws-probe.mjs`](../../../scripts/probes/gate-ws-probe.mjs) | 2026-09-15 | this host | sections 3 and 5 |
| P3 | `gate-ws-probe.mjs silence`, two runs at 07:12 and 07:15 UTC | [`gate-ws-probe.mjs`](../../../scripts/probes/gate-ws-probe.mjs) | 2026-09-15 | this host | section 5 |
| P4 | `gate-ws-probe.mjs book`, `silence` and `deflate`, rerun at 19:12 to 19:15 UTC | [`gate-ws-probe.mjs`](../../../scripts/probes/gate-ws-probe.mjs) | 2026-09-15 | this host | sections 1 to 5, the second readings |
| P5 | `gate-venue-probe.mjs decimal` at 19:16 UTC | [`gate-venue-probe.mjs`](../../../scripts/probes/gate-venue-probe.mjs) | 2026-09-15 | this host | the `X-Gate-Size-Decimal` header, section 4 |
