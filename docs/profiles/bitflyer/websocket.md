# bitFlyer WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time (2026-09-23 03:27 to 03:45 UTC), from the development host near Seattle.

This profile covers the bitFlyer Lightning Realtime API (CCXT id `bitflyer`) for its one perpetual, the Crypto CFD `FX_BTC_JPY`, with the book channels in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitflyer/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The Realtime API documentation is in Japanese, S1 to S7, and quotes below are translated.

## 1. Endpoints

| transport | documented URL | probed |
|---|---|---|
| JSON-RPC 2.0 over WebSocket | `wss://ws.lightstream.bitflyer.com/json-rpc`, S2 | open in 336 to 392 ms over all runs, recommended |
| Socket.IO 2.0, `websocket` transport only | `https://io.lightstream.bitflyer.com`, S3 | `wss://io.lightstream.bitflyer.com/socket.io/?EIO=3&transport=websocket` opened in 352 and 365 ms and answered the Engine.IO handshake, section 5 |

Both host names resolved through Azure Traffic Manager to `horizon-f5-lspejpv4.japaneast.cloudapp.azure.com`, 135.149.75.36, an Azure Japan East address, on 2026-09-23 UTC.
There is no per family URL.
One socket carries every product of every region: the probe subscribed the CFD `FX_BTC_JPY` and spot `BTC_JPY` on one socket and both delivered, and S4 says "one TCP connection can subscribe to several channels".
CCXT 4.5.68 has no Pro class for bitFlyer, so there is no CCXT WebSocket reference.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed |
|---|---|---|---|
| `lightning_board_snapshot_{product_code}` | `{mid_price, bids, asks}` | "delivery frequency is limited for reasons such as delivery efficiency", S5 | 300 bids and 300 asks every 4,898 to 5,111 ms, 20.6 to 20.7 KB per frame. At least one frame of the second pass held 590 levels |
| `lightning_board_{product_code}` | `{mid_price, bids, asks}` of changed levels | "delivers the difference when the book is updated", S6 | 7.1 to 7.7 frames per second on `FX_BTC_JPY`, median 3 to 5 levels per frame, 272 to 384 bytes per frame |
| `lightning_ticker_{product_code}` | best bid and ask with sizes, `ltp`, depth totals, `tick_id`, `timestamp` | "delivery frequency is limited", S7 | 1.7 frames per second, never closer than 500 ms apart |
| `lightning_executions_{product_code}` | array of trades | on trade, S1 | 0.3 to 0.6 frames per second on `FX_BTC_JPY`, gaps up to 17 s |

The product code is the one from the market list, and "alias cannot be used", S5 and S6.
No mark, index or funding channel exists.
The ticker's `ltp` is the CFD's own last trade, which is also what the venue values a position at, see [`rest.md`](./rest.md) section 4.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for everything, S2 | CFD and spot delivered on one socket, section 1 |
| subscribe frame shape | JSON-RPC `subscribe` with `params: { channel: "(Channel Name)" }`, one channel per call, and JSON-RPC batch requests are supported, S2 | `{"jsonrpc":"2.0","method":"subscribe","params":{"channel":"lightning_board_FX_BTC_JPY"},"id":2}`. A batch of two got an array of two results |
| unknown symbol expectation | Not publicly specified | `lightning_board_NOPE_JPY` and the alias `lightning_board_BTCJPY_MAT1WK` answered `"result": true` and then sent nothing. A channel name without a known prefix answered `-32602 invalid channel` |
| chunk unit and budget | "no uniform limit", S4 | 6 channels in 6 frames on one socket, all acknowledged in 104 to 105 ms |
| keepalive mechanism | the connection is cut when "the ping response finally times out", S1 | the server sends a WebSocket protocol ping every 15 s on every socket of every run, for example at 4, 19, 34, 49 and 64 s after the open. The `ws` client answers with a pong on its own |
| connection lifetime and maintenance notice | disconnects happen for "system maintenance or system failure", and missed data "cannot be received retroactively", S1 | no disconnect and no notice in any run, the longest 90 s |
| handshake and operation rate limits | connections may be restricted per IP or account for "API errors repeated in large numbers for a long time", or "connecting and disconnecting at high frequency", S4 | no refusal. Opens took 336 to 392 ms |
| public market data authentication | none for public channels, S1 | none. `child_order_events` without `auth` answered `-32007 authentication required` |
| message parse and routing | client method `channelMessage` with `params.channel` and `params.message`, S2 | `{"jsonrpc":"2.0","method":"channelMessage","params":{"channel":…,"message":…}}`, routed on `params.channel` |
| subscribe acknowledgement shape | `true` on success, S2 | `{"jsonrpc":"2.0","id":1,"result":true}`, and errors as `{"jsonrpc":"2.0","id":…,"error":{"code":…,"message":…}}` |
| symbol identifier format | product code, `FX_BTC_JPY`, S5 | identical to CCXT `market.id` and to the REST `product_code`. The channel name is the prefix plus the product code |
| number representation | JSON numbers in the examples, S5 | JSON numbers. Prices are whole yen written with a `.0`, as in `13633748.0`, and sizes are BTC decimals such as `0.0160328` |
| timestamp representation | ISO strings, S7 | the ticker `timestamp` and trade `exec_date` are UTC ISO strings with seven fractional digits and a `Z`, as in `2026-09-23T03:31:25.6491037Z`, and the ticker arrived 93 to 359 ms after its own `timestamp` over four runs. Board frames carry no time at all |
| size unit | "`size` is the total order quantity at the price", S6 | BTC, and CCXT reports no `contractSize`, so the engine's multiplier of 1 is right, section 4 |
| sequence semantics | none documented | none on the wire. Board frames have no id, no timestamp and no checksum |
| idle repeat behaviour | Not publicly specified | none seen. A quiet executions channel on `BCH_BTC` sent nothing in 90 s |

## 4. The book channels in detail

A book needs both channels: `lightning_board_snapshot_FX_BTC_JPY` for the resets and `lightning_board_FX_BTC_JPY` for the changes between them.

### Snapshot on subscribe

No snapshot is sent on subscribe.
The first snapshot came 2,747, 3,730, 2,023 and 607 ms after the subscribe frame in four runs, and every later one about 5 s after the previous, 4,898 to 5,111 ms apart.
Deltas start first, 109 to 216 ms after the subscribe, and 4 to 29 deltas arrived before the first snapshot.
Those deltas cannot be placed against the snapshot, because neither channel carries an id.

### Delta semantics

A delta lists only the changed levels as `{price, size}` objects plus the new `mid_price`.
A `size` of 0 deletes the level, S6, and the second pass counted 1,527 levels of size 0 in 460 CFD deltas.
S6 also says a market order executed during Itayose arrives as a level with `price: 0`, and none arrived in any run.

### Sequence and gap rule

There is none.
No field on either channel orders a frame against another, so a lost or reordered delta cannot be detected from the frame.

Four checks measured how whole the delta stream is.

| check | CFD run 1 | CFD run 2 | CFD run 3 | CFD second pass | spot run 3 | spot second pass |
|---|---|---|---|---|---|---|
| `mid_price` of each delta equals the mid of a book reset on every snapshot and fed every delta | not run | 409 of 409 | 423 of 423 | 456 of 456 | 256 of 256 | 378 of 378 |
| book reset on a snapshot and fed 5 s of deltas: best bid and ask equal the next snapshot | 12 of 14 | 8 of 11 | 11 of 11 | 9 of 11 | 11 of 11 | 8 of 11 |
| the same book: top 20 per side equal the next snapshot | 8 of 14 | 3 of 11 | 6 of 11 | 4 of 11 | 7 of 11 | 2 of 11 |
| book seeded by the first snapshot and then fed only deltas: a state within 3 s equals a later snapshot's top 20 | not run | 7 of 11 | 9 of 11 | 9 of 11 | 6 of 11 | 4 of 11 |

In the CFD's delta-only book the matching state sat up to 224 ms before or 94 ms after the snapshot's arrival, so a snapshot is not aligned with the delta stream but describes the same book.
The snapshots it did not match show levels the deltas never removed.
On spot `BTC_JPY` the bids at 13,633,930 and 13,633,931 JPY stayed in the delta-only book through three snapshots that no longer held them, and in the second pass the bids at 13,665,631 and 13,665,640 JPY did the same.
The CFD's unmatched snapshots showed the same pattern, 11 to 21 stale levels against 13 to 31 missing ones inside the top 20 price range.
So the delta stream can miss a deletion, and only the next snapshot heals it.
The `mid_price` check never failed, so it catches a wrong touch but not a stale level behind it.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | descending on every frame of every run | ascending on every frame |
| delta | 167 of 438 frames not descending in run 2, and 254 of 460 in the second pass | 164 of 438 and 229 of 460 not ascending |
| REST `getboard` | descending | ascending |

S5 says of the snapshot that "the order of the asks and bids arrays is not guaranteed, so sort them as needed", so a feed sorts or applies by price.

### Level window

The snapshot holds 300 bids and 300 asks, 600 levels on every frame except at least one of 590 in the second pass.
The REST board held 1,088 to 1,117 levels over the same runs, see [`rest.md`](./rest.md) section 5.
A book reset on a snapshot and fed deltas reached 628 levels, so deltas also touch levels outside the snapshot's 300.
The engine's 20 levels per side sit well inside the window.

### Size unit against CCXT `contractSize`

CCXT sets `contractSize` to undefined for every market, at `server/node_modules/ccxt/js/src/bitflyer.js` line 379, and the engine turns that into 1.
The socket sizes are BTC: the minimum order is 0.001 BTC, S8, and levels of 0.001 are common on the wire.
Among the REST board's top 10 levels per side, 17, 19, 17 and 17 of 20 prices were in the socket book in four runs, and all of those but one had the same size.
The rest had most likely moved between the two reads, and the REST board is cached for up to about 1 s at the edge, see [`rest.md`](./rest.md) section 5.

### One-sided and empty books

Not seen.
No empty delta and no empty snapshot arrived.

### Idle repeats

No idle repeat was seen, because the CFD book was never idle, and its longest gap between deltas was 541 ms over four runs.
Whether a delta ever repeats an unchanged level was not measured.

### Unknown, closed and wrong channels

| request | reply | then |
|---|---|---|
| `lightning_board_NOPE_JPY` | `"result": true` | nothing |
| `lightning_board_BTCJPY_MAT1WK`, an alias | `"result": true` | nothing |
| `nope_channel` | `-32602 invalid channel` | |
| `subscribe` with no `params` | `-32602 Invalid params` | |
| method `nope` | `-32601 Method not found` | |
| the same channel twice | `-32009 already subscribed` | the first keeps delivering |
| `child_order_events` without `auth` | `-32007 authentication required` | |
| a subscribe with no `id` | no reply | the channel delivers |
| a subscribe with no `jsonrpc` field | `"result": true` | the channel delivers |
| text that is not JSON | `-32700 Parse error`, `"data": "Invalid JSON"`, `"id": null` | the socket stays open |

Because an unknown product is acknowledged as success, a feed has to notice a channel that never delivers on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | the server pings, and a late pong ends the connection, S1 | protocol ping every 15 s, answered by the `ws` library. Socket.IO announced `"pingInterval":15000,"pingTimeout":3000` |
| silence the server tolerates | Not publicly specified | a socket with no subscription and no client frame stayed open for the full 90 s while it answered the pings, and so did one subscribed to a channel that sent nothing |
| forced disconnect | maintenance or failure, S1 | none in any run |
| maintenance notice | none in the protocol | not observed |
| compression | Not publicly specified | a client that offered permessage-deflate got no `sec-websocket-extensions` header back, so the server does not negotiate it. Frames are text JSON |
| handshake | TLS 1.2 or newer, S2 | 336 to 392 ms to open |
| subscription limits | none published, S4 | 6 channels on one socket without refusal |
| throughput | | the CFD book costs 7.1 to 7.7 delta frames and 0.2 snapshots per second, about 6 to 7 KB per second |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays marked `…` are cut.

Subscribe and acknowledgement.

```json
{"jsonrpc":"2.0","method":"subscribe","params":{"channel":"lightning_board_snapshot_FX_BTC_JPY"},"id":1}
```

```json
{"jsonrpc":"2.0","id":1,"result":true}
```

Snapshot, first three levels per side kept, from 300.
The probe trimmed and re-serialized this frame, which dropped the `.0` that the wire writes after each whole number.

```json
{"jsonrpc":"2.0","method":"channelMessage","params":{"channel":"lightning_board_snapshot_FX_BTC_JPY","message":{"mid_price":13668525,"bids":[{"price":13667260,"size":0.1081},{"price":13667085,"size":0.0304},{"price":13667084,"size":0.0541107}],"asks":[{"price":13669790,"size":0.01074025},{"price":13669795,"size":0.06},{"price":13670937,"size":0.001}]}}}
```

Delta, and a delta that deletes four ask levels, both as they came off the wire.

```json
{"jsonrpc":"2.0","method":"channelMessage","params":{"channel":"lightning_board_FX_BTC_JPY","message":{"mid_price":13634496.0,"bids":[{"price":13632097.0,"size":0.0160328}],"asks":[{"price":13637308.0,"size":0.07629387}]}}}
```

```json
{"jsonrpc":"2.0","method":"channelMessage","params":{"channel":"lightning_board_FX_BTC_JPY","message":{"mid_price":13668525.0,"bids":[{"price":13667085.0,"size":0.0304}],"asks":[{"price":13668861.0,"size":0.0},{"price":13668917.0,"size":0.0},{"price":13675036.0,"size":0.03709615},{"price":13677715.0,"size":0.0},{"price":13678731.0,"size":0.0}]}}}
```

Ticker, with the two fields the REST ticker lacks.

```json
{"jsonrpc":"2.0","method":"channelMessage","params":{"channel":"lightning_ticker_FX_BTC_JPY","message":{"product_code":"FX_BTC_JPY","state":"RUNNING","timestamp":"2026-09-23T03:31:25.6491037Z","tick_id":17524168,"best_bid":13633748.0,"best_ask":13635244.0,"best_bid_size":0.03013129,"best_ask_size":0.005,"total_bid_depth":57.71920633,"total_ask_depth":41.53653104,"market_bid_size":0.0,"market_ask_size":0.0,"ltp":13632921.0,"volume":1104.266230520000,"volume_by_product":1104.266230520000,"preopen_end":null,"circuit_break_end":null}}}
```

Trades.

```json
{"jsonrpc":"2.0","method":"channelMessage","params":{"channel":"lightning_executions_FX_BTC_JPY","message":[{"id":2652079303,"side":"SELL","price":13633748.0,"size":0.03,"exec_date":"2026-09-23T03:31:27.0873222Z","buy_child_order_acceptance_id":"JRF20260923-033125-086253","sell_child_order_acceptance_id":"JRF20260923-033126-086262"}]}}
```

Errors.

```json
{"jsonrpc":"2.0","id":102,"error":{"code":-32602,"message":"invalid channel"}}
```

```json
{"jsonrpc":"2.0","id":107,"error":{"code":-32009,"message":"already subscribed"}}
```

```json
{"jsonrpc":"2.0","error":{"code":-32700,"message":"Parse error","data":"Invalid JSON"},"id":null}
```

Batch reply.

```json
[{"jsonrpc":"2.0","id":108,"result":true},{"jsonrpc":"2.0","id":109,"result":true}]
```

Socket.IO handshake, the Engine.IO open packet, with the session id cut.

```text
0{"sid":"…","upgrades":[],"pingInterval":15000,"pingTimeout":3000,"maxPayload":1000000}
```

The keepalive is a WebSocket protocol ping frame and has no JSON body.

## 7. Private channels

Named for a future execution stage, from S1 and S2, not probed.
They use the same URL after the `auth` method, whose params are `api_key`, `timestamp`, `nonce` and `signature`, an HMAC-SHA256 of the timestamp and nonce.

- `child_order_events` and `parent_order_events`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
[`rest.md`](./rest.md) section 8 explains why the venue does not fit the engine today, so this is the shape a feed would take if that changes.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket, `wss://ws.lightstream.bitflyer.com/json-rpc` | one product, and one socket carries every channel |
| channels | `lightning_board_snapshot_FX_BTC_JPY` and `lightning_board_FX_BTC_JPY` | the only way to a whole book |
| subscribe frames | one JSON-RPC batch of the two subscribes, or two frames | a batch was answered as an array |
| keepalive | none sent by the client | the server pings every 15 s, and `VenueFeed` already counts a ping as traffic at `server/src/feeds/book/VenueFeed.ts` line 97 |
| `maxSilenceMs` | 45,000 | three missed pings |
| snapshot | on every snapshot frame, sort both sides and `resetBook` | the snapshot is the only thing that removes a level the deltas missed |
| delta | drop until the first snapshot, then apply by price and `publish` | there is no id to line a buffered delta up with the snapshot |
| consistency | after each delta, compare the local mid with `mid_price`, and on a mismatch stop publishing until the next snapshot | the `mid_price` check held on every delta, and a reconnect does not bring a snapshot sooner: the first one took 0.6 to 3.7 s after the subscribe |
| resync | do not terminate the socket on a mismatch | the next snapshot comes within 5 s, and frequent reconnects can get the IP restricted, S4 |
| unserved channel | log a channel with no snapshot 10 s after its acknowledgement | an unknown product is acknowledged as success |
| receive time | stamp on arrival | board frames carry no time |
| staleness | treat any level not refreshed by a snapshot as up to 5 s old | a missed deletion lives until the next snapshot |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Realtime API overview (概要) | https://bf-lightning-api.readme.io/docs/realtime-api | 2026-09-22 | bitFlyer, Inc. | public and private split, delivery order, disconnect causes, ping timeout, sections 3 and 5 |
| S2 | JSON-RPC 2.0 over WebSocket | https://bf-lightning-api.readme.io/docs/endpoint-json-rpc | 2026-09-22 | bitFlyer, Inc. | URL, methods, batch support, TLS 1.2, `auth` params, sections 1, 3 and 7 |
| S3 | Socket.IO 2.0 (WebSocket) | https://bf-lightning-api.readme.io/docs/endpoint-socket-io | 2026-09-22 | bitFlyer, Inc. | Socket.IO URL and websocket transport only, section 1 |
| S4 | API limits (API 制限) | https://bf-lightning-api.readme.io/docs/realtime-api-limit | 2026-09-22 | bitFlyer, Inc. | no uniform limit, restriction triggers, several channels per connection, sections 1, 3 and 8 |
| S5 | Board snapshot (板情報のスナップショット) | https://bf-lightning-api.readme.io/docs/realtime-board-snapshot | 2026-09-22 | bitFlyer, Inc. | channel name, limited frequency, unordered arrays, no alias, sections 2 and 4 |
| S6 | Board difference (板情報の差分) | https://bf-lightning-api.readme.io/docs/realtime-board | 2026-09-22 | bitFlyer, Inc. | delta semantics, size 0 and price 0, sections 2 and 4 |
| S7 | Ticker | https://bf-lightning-api.readme.io/docs/realtime-ticker | 2026-09-22 | bitFlyer, Inc. | limited frequency, fields, section 2 |
| S8 | What is bitFlyer Crypto CFD? | https://lightning.bitflyer.com/about-crypto-cfd?region=JP&lang=en | 2026-09-22 | bitFlyer, Inc., JP | minimum order 0.001 BTC, section 4 |
| P1 | `ws-probe.mjs book`, three runs at 03:27, 03:30 and 03:31 UTC, and the second pass at 03:42 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitflyer/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs errors`, `silence`, `deflate` and `socketio` at 03:27 to 03:34 UTC, and the second pass at 03:43 to 03:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitflyer/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 to 6 |
