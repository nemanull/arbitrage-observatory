# NonKYC WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, from the development host near Seattle, between 04:53 and 04:59 UTC on 2026-09-23, and again in the second pass between 05:09 and 05:14 UTC, through the Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public market data socket behind NonKYC's perpetuals.
`perp.nonkyc.io` is the Orderly Network builder `nonkyc`, see [`fees.md`](./fees.md) section 1, so its book is Orderly's public stream, the same stream profiled for Niza.fun in [`../niza/websocket.md`](../niza/websocket.md).
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/nonkyc/ws-probe.mjs) unless it cites a source, and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Access results are from the Canadian VPN exit of this host.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDC perpetuals, all 80 shared markets and the 59 builder-listed ones | `wss://ws-evm.orderly.org/ws/stream/{account_id}`, S1 | `wss://ws-evm.orderly.org/ws/stream/OqdphuyCtYWxwzhxyLLjOWNdFP7sQt8RPWzmb5xY` opened in 155 to 255 ms on every socket, P1 to P4 |
| private | `wss://ws-private-evm.orderly.org/v2/ws/private/stream/{account_id}`, S1 | not probed |
| NonKYC spot | `wss://ws.nonkyc.io`, documented at `https://nonkyc.io/wsapi` | opened in 699 and 700 ms and was closed at once, to record access only, P5 |

The public path segment is a constant, not an account.
`OqdphuyCtYWxwzhxyLLjOWNdFP7sQt8RPWzmb5xY` is hardcoded in CCXT Pro at `server/node_modules/ccxt/js/src/pro/woofipro.js` line 82, S6, and the same string appears in the perp.nonkyc.io bundle, S5.
The Niza profile found that other path segments are closed within milliseconds and that a missing segment gets HTTP 404, see [`../niza/websocket.md`](../niza/websocket.md) section 1, which this profile did not retest.
One socket carries every Orderly perpetual, since Orderly has one settlement family, USDC.
`ws-evm.orderly.org` resolved to `34.111.60.95`, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| topic | documented | probed on 2026-09-23 UTC |
|---|---|---|
| `{symbol}@orderbookupdate` | "updated orderbook push every 200ms", S2 | full-depth deltas on a 200 ms grid, sent only when the book changed. 88 to 203 frames in 60 s on BTC and ETH, 4 to 11 on WOO, over three runs. No snapshot. Recommended |
| `{symbol}@orderbook` | "depth 100 push every 1s", S2 | the whole book, up to 428 levels per side, first frame 112 to 168 ms after subscribe, then a new frame only when the book changed, usually a second or more apart: 33 to 51 frames in 60 s on BTC and ETH, 3 to 7 on WOO. Recommended as the snapshot |
| `request` with `params.type` `orderbook` | one-time snapshot, S2 | answered in 149 and 156 ms with `"event":"request"`, the request `id`, and a `data` book of 411 bids and 247 asks on ETH |
| `{symbol}@bbo` | best bid and offer, S2 | 77 to 206 frames in 60 s on BTC, `{"ask", "askSize", "bid", "bidSize"}` |
| `bbos` | all symbols, every second, S2 | not probed |
| `{symbol}@markprice`, `markprices` | every second, S2 | 58 frames in 60 s each, `ts` on whole seconds. `markprices` lists every market, builder-listed ones included |
| `indexprices` | every second, S2 | 58 frames in 60 s, rows keyed `SPOT_<BASE>_USDC`, not by the perpetual's symbol |
| `{symbol}@estfundingrate` | every 15 seconds, S2 | 4 frames in 60 s on BTC, `{"fundingRate", "fundingTs"}`, `ts` on 15 s marks |
| `{symbol}@trade`, `{symbol}@ticker`, `{symbol}@kline_1m` | named in S1 | not probed |

The anchor topics push once a second, which could replace the REST anchor poll, but the funding interval is not on the socket, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL, S1 | one URL for every perpetual, the only family is USDC |
| subscribe frame shape | `{"id": "clientID2", "topic": "PERP_NEAR_USDC@orderbookupdate", "event": "subscribe"}`, one topic per frame, S2 | as documented. A frame with no `topic` gets `invalid message` |
| unknown symbol expectation | `{"id", "event": "subscribe", "success": false, "ts", "errorMsg": "invalid symbol PERP_BTC_USDC"}`, S3 | `{"id":"err-unknown-symbol","success":false,"ts":…,"errorMsg":"invalid symbol PERP_NOPE_USDC"}`, with no `event` field. The same for `PERP_BTC_USDC_mythos`, a builder-suffixed name that does not exist |
| chunk unit and budget | Not publicly specified | 100 topics per connection. The 101st and later subscribe frames were refused with `"errorMsg":"your subscribed topics have reached limit "`, in a burst and paced at 25 ms alike |
| keepalive mechanism | "The server will send a ping command to the client every 10 seconds. If the pong from client is not received within 10 seconds for 10 consecutive times, it will actively disconnect the client.", S4 | server `{"event":"ping","ts":…}` every 10 s with `ts` on a whole 10 s mark, the first 1.5 to 8.3 s after open. A client `{"event":"ping"}` got `{"event":"pong","ts":…}` in 110 to 128 ms |
| connection lifetime and maintenance notice | not documented on the socket. REST `GET /v1/public/system_info` carries `scheduled_maintenance` | no lifetime cap in 120 s. `system_info` answered `"status":0` and `"scheduled_maintenance":null`, see [`rest.md`](./rest.md) section 6 |
| handshake and operation rate limits | Not publicly specified | no refusal on 160 subscribe frames in a burst, other than the topic cap. Opens took 155 to 255 ms |
| public market data authentication | none for public topics, S1 | none |
| message parse and routing | `{topic, ts, data}` for pushes, S2 | route on `topic`, `<symbol>@<kind>`. Control frames carry `id` and `success` and no `topic` |
| subscribe acknowledgement shape | `{"id", "event": "subscribe", "success": true, "ts"}`, S2 | as documented, 127 to 168 ms after the frame. An unknown topic `PERP_BTC_USDC@nope` and a duplicate subscribe were both acknowledged with `"success":true` |
| symbol identifier format | `PERP_<BASE>_USDC` | identical to CCXT `market.id` from `woofipro` and to the REST `symbol` on 139 of 139 markets, see [`rest.md`](./rest.md) section 2 |
| number representation | JSON numbers, S2 | prices and sizes are JSON numbers whose text keeps trailing zeros, such as `2785.70` and `0.0000` |
| timestamp representation | `ts` in ms | frame `ts` in Unix ms. Delta frames arrived a median 55 to 75 ms after their `ts` by this host's clock, with the Orderly clock 1 to 9 ms ahead |
| size unit | base asset | base asset, which is CCXT `contractSize` 1, section 4 |
| sequence semantics | `data.prevTs` on `@orderbookupdate`, S2, with no stated gap rule | `prevTs` equals the `ts` of the previous delta for that symbol, with 0 gaps in 4 to 203 deltas per market over three book runs and in 3,435 and 3,504 deltas over two batch runs |
| idle repeat behaviour | not documented | nothing is repeated. A quiet market sends no delta and no snapshot until its book changes. WOO's first delta came 6.3 to 26.1 s after subscribe, and its snapshots were up to 58.2 s apart |

## 4. The book channel in detail

`@orderbookupdate` for deltas and `@orderbook` for the snapshot are the pair this profile recommends, and every row below is about them unless it says otherwise.

### Snapshot on subscribe

`@orderbookupdate` never sends a snapshot.
`@orderbook` sends the whole book 112 to 168 ms after its subscribe frame, and again when the book has changed.
On BTC and ETH the gap between snapshots was 201 to 5,600 ms with medians of 1,000 to 1,600 ms, and on WOO it was 999 to 58,199 ms.
The documentation says depth 100, and the wire sent up to 428 levels per side, for example 420 bids and 274 asks on BTC, and 333 bids and 369 asks in the rerun.
A quiet book's first snapshot carries an old `ts`: the WOO snapshot at subscribe carried a `ts` about 9 s older than its arrival, and the next delta chained from that `ts`.

### Delta semantics

A delta carries `symbol`, `prevTs`, `asks` and `bids`, each an array of `[price, size]`.
A size of 0 deletes the level.
Deltas cover the whole book, not a window: a BTC delta deleted a bid at 63,069.2 while the touch was near 87,110.
No delta with both arrays empty arrived in 237, 233 and 387 deltas over the three book runs.
Deltas sit on a 200 ms grid with a fixed phase per market: every BTC `ts` modulo 200 was 38 or 39, and every ETH `ts` was 186 or 187.

### Sequence and gap rule

```text
snapshot at ts T         resetBook, last = T
delta with prevTs = last   apply, last = ts
delta with prevTs < last   already in the snapshot, drop it
delta with prevTs > last   gap: resync
```

The chain held on every delta of every run, with 0 gaps.
Every later snapshot's `ts` equalled the `ts` of a delta on the chain, 33 of 33 on BTC and 43 of 43 on ETH in the second book run, and 46 of 46 and 51 of 51 in the rerun.
A book rebuilt from the first snapshot and the delta chain matched every later snapshot at the same `ts` on the top 20 levels per side: 32 of 32 on BTC, 42 of 42 on ETH and 6 of 6 on WOO, with 0 mismatches, and 34, 38 and 3 in the first run, and 45, 50 and 2 in the rerun.
The documentation states no gap rule, so the rule above is the probe's reading of `prevTs`.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `@orderbook` snapshot | best first, descending, in 83 of 83 frames of the second run and 100 of 100 in the rerun | best first, ascending, in the same 83 and 100 |
| `@orderbookupdate` delta | descending in 233 of 233 and 387 of 387 | ascending in the same |
| REST `/v1/public/query` orderbook | best first, descending | best first, ascending |

A feed should still apply deltas by price, since the order of a delta is not documented.

### Level window

The snapshot is the whole book, 21 bids and 17 asks on WOO and more than 400 bids on BTC, and the deltas cover every level, so a feed that keeps the top 20 simply cuts its own copy.
The engine's 20 levels per side fit inside every probed book except a thin market that holds fewer.

### Size unit against CCXT `contractSize`

Sizes are in the base asset.
The BTC snapshot showed asks of `0.00369` and `1.00621` at about 87,112, which are plausible as bitcoin and not as contracts or dollars.
The REST book read the same `0.00369` at the best ask a few minutes earlier, and CCXT `woofipro` reports `contractSize` 1 and an amount precision of 0.00001, equal to Orderly's `base_tick`, see [`rest.md`](./rest.md) section 2.
So the engine's `sizeMul` of 1 converts Orderly sizes correctly.

### One-sided and empty books

No one-sided or empty book was seen on the three markets.
The REST query documentation says "An empty book returns empty `asks` / `bids` arrays (not an error)", S7, and what the socket sends for an empty side is Not verified.

### Idle repeats

Nothing is repeated.
WOO sent 4, 11 and 5 deltas and 4, 7 and 3 snapshots in the three 60 s runs, and each carried a change.
`@bbo` and the anchor topics are timed pushes and do repeat unchanged values.

### Unknown, closed and wrong-form destinations

| request | reply |
|---|---|
| `PERP_NOPE_USDC@orderbookupdate` | `{"id":"err-unknown-symbol","success":false,"ts":…,"errorMsg":"invalid symbol PERP_NOPE_USDC"}` |
| `PERP_BTC_USDC_mythos@orderbookupdate`, a name no builder lists | `"errorMsg":"invalid symbol PERP_BTC_USDC_mythos"` |
| `PERP_BTC_USDC@nope`, an unknown topic | `"success":true`, then nothing. The documentation lists `invalid topic <topic>`, S3 |
| `PERP_BTC_USDC@orderbookupdate` a second time | `"success":true`, and the stream kept a single copy of each delta |
| subscribe frame with no `topic` | `{"id":"err-no-id","success":false,"ts":…,"errorMsg":"invalid message"}` |
| text that is not JSON | `{"success":false,"ts":…,"errorMsg":"invalid message"}`, and the socket stays open |
| topic 101 on one socket | `"errorMsg":"your subscribed topics have reached limit "` |

All 80 shared markets were `ACTIVE`, so a closed or delisted market was not available to probe.
Because an unknown topic is acknowledged, a feed should log a stream with no frame long after its ack, although a quiet market can also stay silent for tens of seconds.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server ping every 10 s, answer `{"event":"pong"}`. A client may ping every 10 s, S4 | server pings arrived 9,976 to 10,027 ms apart. A client ping got a pong in 110 to 128 ms |
| silence the server tolerates | "10 consecutive times" without a pong, S4 | an unsubscribed socket that never answered was closed with 1006 and no close frame 116.7 s and 116.1 s after open in two runs, each time 110.0 s after the first ping, after 11 pings. An unsubscribed socket that answered every ping stayed open until the probe closed it at 120 s, in both runs |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | REST `system_info` | not observed |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got HTTP 101 and no `sec-websocket-extensions` header, so the server does not negotiate it |
| handshake | | 155 to 255 ms to open from this host |
| subscription limits | Not publicly specified | 100 topics per connection, section 3 |
| throughput | | one socket with 80 delta topics and 20 snapshot topics for 45 s, two runs: 89 frames per second on average both times, median 78 and 80, peak 182 and 150, 35 and 36 KB per second, 398 and 402 bytes per frame, 21 µs `JSON.parse` per frame, 3,435 and 3,504 deltas, 0 gaps |

## 6. Captured frames

Trimmed, from the probe runs at 04:53 and 04:54 UTC on 2026-09-23.
Arrays marked `…` are cut, and `…` inside a text block stands for a value left out.

Subscribe.

```json
{"id": "u-PERP_BTC_USDC", "event": "subscribe", "topic": "PERP_BTC_USDC@orderbookupdate"}
```

Acknowledgement.

```json
{"id":"u-PERP_BTC_USDC","event":"subscribe","success":true,"ts":1790139271848}
```

Snapshot of a quiet book, three levels per side kept, whose `ts` is older than the subscribe frame.

```json
{"topic":"PERP_WOO_USDC@orderbook","ts":1790139264199,"data":{"symbol":"PERP_WOO_USDC","asks":[[0.01314,310757],[0.01315,161100],[0.01316,114929]],"bids":[[0.0131,631272],[0.01309,537296],[0.01308,45872]]}}
```

The next WOO delta, 33.6 s later, chaining from that `ts`.

```json
{"topic":"PERP_WOO_USDC@orderbookupdate","ts":1790139297799,"data":{"symbol":"PERP_WOO_USDC","prevTs":1790139264199,"asks":[],"bids":[[0.01276,784]]}}
```

Delta with a deletion, kept as the wire spelled its numbers.

```json
{"topic":"PERP_ETH_USDC@orderbookupdate","ts":1790139273186,"data":{"symbol":"PERP_ETH_USDC","prevTs":1790139272386,"asks":[[2784.62,1.2811],[2785.70,0.0000],[2788.23,0.0000]],"bids":[[2777.34,0.0000]]}}
```

Keepalive, a server ping and the answer to a client ping.

```json
{"event":"ping","ts":1790139190000}
```

```json
{"event":"pong","ts":1790139211084}
```

Errors.

```json
{"id":"err-unknown-symbol","success":false,"ts":1790139274355,"errorMsg":"invalid symbol PERP_NOPE_USDC"}
```

```json
{"success":false,"ts":1790139274356,"errorMsg":"invalid message"}
```

Anchor topics.

```json
{"topic":"PERP_BTC_USDC@markprice","ts":1790139274000,"data":{"symbol":"PERP_BTC_USDC","price":87109.2}}
```

```json
{"topic":"PERP_BTC_USDC@estfundingrate","ts":1790139285000,"data":{"symbol":"PERP_BTC_USDC","fundingRate":0.0001,"fundingTs":1790150400000}}
```

Best bid and offer.

```json
{"topic":"PERP_BTC_USDC@bbo","ts":1790139273948,"data":{"symbol":"PERP_BTC_USDC","ask":87111.7,"askSize":0.00369,"bid":87109.2,"bidSize":0.92514}}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use `wss://ws-private-evm.orderly.org/v2/ws/private/stream/{account_id}` and need authentication before any subscribe.

- `account`, `balance`, `position`, `executionreport`.
- An order placed through perp.nonkyc.io is booked under the builder `nonkyc`, so an execution stage would need an Orderly account registered with that builder to pay NonKYC's rate.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
It is the same shape the Niza profile recommends, and at most one Orderly feed should exist in the engine, see [`fees.md`](./fees.md) section 9.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://ws-evm.orderly.org/ws/stream/OqdphuyCtYWxwzhxyLLjOWNdFP7sQt8RPWzmb5xY` for every slice | one URL serves every perpetual |
| channels | `<rawMarketId>@orderbookupdate` and `<rawMarketId>@orderbook` | deltas with a `prevTs` chain, and a snapshot whose `ts` sits on that chain |
| markets per connection | 50, so 100 topics, and two connections for the 80 shared markets | the server refuses the 101st topic |
| subscribe frames | one frame per topic, `{"id": "<topic>", "event": "subscribe", "topic": "PERP_BTC_USDC@orderbookupdate"}`, deltas before snapshots | a frame takes one topic, and subscribing deltas first leaves no hole before the snapshot |
| keepalive | answer every `{"event":"ping"}` with `{"event":"pong","ts":<ms>}` inside `handleMessage`, and send no client ping | the server pings every 10 s and closes a silent socket 110 s after its first unanswered ping |
| `maxSilenceMs` | 30,000 | three missed server pings, and a quiet market can send no book frame for a minute, so the ping has to count as traffic |
| routing | `topic.split('@')`, the first part is the `rawMarketId` | the topic wraps the market id |
| snapshot | `resetBook` and store `last = ts` on the first snapshot, and again on any later snapshot whose `ts` equals `last` | later snapshots matched the rebuilt book in every run, so a reset at the same `ts` is harmless and self-heals |
| delta | apply only when `prevTs === last`, then store `last = ts`. Drop a delta with `prevTs < last` before the first snapshot has been applied | the chain rule, 0 gaps observed |
| resync | a delta with `prevTs > last` after the snapshot, or no snapshot 10 s after its ack: `resync`, which terminates the socket and resubscribes | the engine's existing path |
| receive time | stamp on arrival, never from `ts` | a quiet book's snapshot carries a `ts` seconds old |
| sizes | take the number as is, in base units | `contractSize` 1 |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

The one-time `request` orderbook event could replace the `@orderbook` subscription and fit 100 markets per connection, but whether its `ts` sits on the delta chain was not tested.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Orderly, Websocket API introduction | https://orderly.network/docs/build-on-omnichain/websocket-api/introduction | 2026-09-22 | Orderly Network | public and private URLs, topic names, private authentication, sections 1, 2, 3 and 7 |
| S2 | Orderly, public topic pages: Orderbook, Order book update, Request orderbook, Mark prices, Index prices, Estimated funding rate, bbos | https://orderly.network/docs/build-on-omnichain/websocket-api/public/orderbook | 2026-09-22 | Orderly Network | frame shapes, documented depth and cadence, sections 2 and 3 |
| S3 | Orderly, Error Response | https://orderly.network/docs/build-on-omnichain/websocket-api/error-response | 2026-09-22 | Orderly Network | error shape and messages, sections 3 and 4 |
| S4 | Orderly, PING/PONG | https://orderly.network/docs/build-on-omnichain/websocket-api/ping-pong | 2026-09-22 | Orderly Network | server ping every 10 s, disconnect rule, sections 3 and 5 |
| S5 | perp.nonkyc.io bundle `assets/index-BepQawLP.js` and `config.js` | https://perp.nonkyc.io/config.js | 2026-09-22 | NonKYC perp | the constant path segment, the builder id, section 1 |
| S6 | CCXT Pro 4.5.68 `woofipro.js` | `server/node_modules/ccxt/js/src/pro/woofipro.js` | 2026-09-22 | CCXT | public URL line 35, path constant line 82, section 1 |
| S7 | Orderly Public Info API, Orderbook | https://orderly.network/docs/build-on-omnichain/public-info-api/market/orderbook | 2026-09-22 | Orderly Network | empty book shape, section 4 |
| P1 | `ws-probe.mjs book`, runs at 04:53, 04:54 and 05:09 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/nonkyc/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 2 to 6 |
| P2 | `ws-probe.mjs batch` and `cap` at 04:55 and 04:56 UTC, rerun at 05:10 and 05:11 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/nonkyc/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | topic cap and throughput, sections 3 and 5 |
| P3 | `ws-probe.mjs silence` at 04:57 to 04:59 UTC, rerun at 05:11 to 05:13 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/nonkyc/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 5 |
| P4 | `ws-probe.mjs deflate` at 04:56 UTC, rerun at 05:11 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/nonkyc/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | section 5 |
| P5 | `ws-probe.mjs spot` at 04:56 UTC, rerun at 05:11 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/nonkyc/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | NonKYC spot socket access, section 1 |
