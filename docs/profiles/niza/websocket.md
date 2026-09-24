# Niza WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, in the local evening, which is 02:36 to 03:05 UTC on 2026-09-23.

This profile covers the public market data socket behind the Niza.fun perpetuals.
Niza.fun is the Orderly Network builder `niza`, and its front end reads Orderly's public socket, so this is Orderly's socket, see [`fees.md`](./fees.md) section 1.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/niza/ws-probe.mjs), in two runs from 02:48 and from 02:55 UTC, and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDC-settled perpetuals, all 139 Orderly markets | `wss://ws-evm.orderly.org/ws/stream/{account_id}`, where "`{account_id}` is your account id", S1 | open in 153 to 211 ms over both runs, and only one path segment is served, see below |
| private streams | `wss://ws-private-evm.orderly.org/v2/ws/private/stream/{account_id}`, S1 | not probed |

Orderly has one settlement family, so one URL carries every market, including the builder-listed ones.
The path segment decides whether the socket is served.

| path segment | result, both runs |
|---|---|
| `OqdphuyCtYWxwzhxyLLjOWNdFP7sQt8RPWzmb5xY` | served, subscriptions acked and delivered |
| none, `/ws/stream` | HTTP 404 on the upgrade |
| empty, `/ws/stream/` | opened, then closed by the server 2 to 3 ms later with 1000 |
| the served id with its last character changed | closed after 4 to 5 ms with 1000 |
| 40 random alphanumerics | closed after 2 to 4 ms with 1000 or 1006 |
| a short word | closed after 4 to 9 ms with 1006 or 1000 |
| `0x` and 64 zeros | closed after 4 to 7 ms with 1000 |
| `0x` and 64 random hex digits | closed after 3 to 5 ms with 1006 |

The served segment is not an account.
It is a constant the Orderly SDK in the niza.fun bundle hardcodes for its public socket, `` new WebSocket(`${e.publicUrl}/ws/stream/OqdphuyCtYWxwzhxyLLjOWNdFP7sQt8RPWzmb5xY`) `` in chunk `45a72f26cbe134ce.js`, S6.
CCXT Pro uses the same constant as its default, `server/node_modules/ccxt/js/src/pro/woofipro.js` line 82.
`ws-evm.orderly.org` resolved to `34.111.60.95`.

## 2. Channel matrix for public market data

| topic | documented | probed on 2026-09-23 |
|---|---|---|
| `{symbol}@orderbookupdate` | incremental updates every 200 ms, S2 | deltas only, no snapshot, chained by `prevTs`, pushed on a 200 ms grid only when the book changed, recommended |
| `{symbol}@orderbook` | "depth 100 push every 1s", S2 | the whole book, up to 501 levels per side, pushed 124 to 174 ms after the subscribe and then at most once a second when the book changed |
| `request` with `params.type` `orderbook` | one-off snapshot, S2 | the whole book, stamped with the time of its last change |
| `{symbol}@bbo` | every 10 ms, S2 | 134 and 123 frames on `BTC` and 77 and 84 on `MERL` in about 60 s, 99 and 136 on `ETH` in about 54 s |
| `bbos` | all symbols every 1 s | not probed |
| `{symbol}@markprice`, `markprices` | every 1 s, S2 | 60 frames in 60 s each, `markprices` about 6.5 KB, builder markets included |
| `SPOT_{base}_USDC@indexprice`, `indexprices` | every 1 s, S2 | 60 frames in 60 s each, `indexprices` about 7.1 KB. `PERP_BTC_USDC@indexprice` answers `invalid index symbol` |
| `{symbol}@estfundingrate` | every 15 s, S2 | 4 frames in about 58 s, stamped on 15 s marks |
| `{symbol}@ticker`, `tickers` | 24 h ticker, S2 | 2 and 6 frames on `BTC` in about 58 s |
| `maintenance_status` | maintenance notices, S2 | acked, nothing pushed |
| `{symbol}@trade`, `{symbol}@kline_1m`, `{symbol}@openinterest` and others | S2 | not probed |

The mark, index and predicted funding each have a topic, but no topic carries the funding interval, so the REST anchor poll stays, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, keyed by an account id in the path, S1 | one URL for all 139 markets, and only the SDK's constant path segment is served, section 1 |
| subscribe frame shape | `{"id": "clientID2", "topic": "PERP_WOO_USDC@orderbook", "event": "subscribe"}`, one topic per frame, S2 | as documented, and a frame without `id` is also acked, without an `id` in the ack |
| unknown symbol expectation | `{"id", "event": "subscribe", "success": false, "errorMsg": "invalid symbol <symbol>"}`, S3 | `{"id":"p23","success":false,"ts":…,"errorMsg":"invalid symbol PERP_NOPE_USDC"}`, with no `event` key. An unknown topic suffix such as `PERP_BTC_USDC@nope` is acked as success and stays silent |
| chunk unit and budget | Not publicly specified | 80 subscribe frames in one burst on one socket, all 80 acked, no refusal |
| keepalive mechanism | "The server will send a ping command to the client every 10 seconds." The client may also send `{"event":"ping"}`, S4 | server `{"event":"ping","ts":…}` every 10 s, the first 2.7 to 7.5 s after the open. A client ping gets `{"event":"pong","ts":…}` |
| connection lifetime and maintenance notice | `maintenance_status` topic, S2 | no forced close in 120 s on a socket that answers pings, and no notice pushed |
| handshake and operation rate limits | Not publicly specified | no refusal at 80 subscribes in a burst, and opens took 153 to 211 ms |
| public market data authentication | none for public topics, S1 | none, but the path segment must be the SDK constant |
| message parse and routing | `{topic, ts, data}` for pushes, `{id, event, success, ts}` for replies, S2 | route on `topic`, spelled `<symbol>@<kind>`. Pings, pongs and acks carry `event` and no `topic`. Error replies carry neither |
| subscribe acknowledgement shape | `{"id", "event": "subscribe", "success": true, "ts"}`, S2 | as documented, about 120 and 135 ms after the first subscribe frame in the two book runs |
| symbol identifier format | `PERP_<BASE>_USDC`, index topics `SPOT_<BASE>_USDC` | the socket accepted all 80 shared ids exactly as CCXT `woofipro` spells `market.id` and as REST spells `symbol`, and a builder id as well |
| number representation | JSON numbers in the examples, S2 | prices and sizes are JSON numbers in every book, bbo, mark and index frame. The REST Public Info book sends strings |
| timestamp representation | `ts` in ms | frame `ts` in Unix ms. On book frames `ts` is the time of the book change, not of the push, so a quiet book's snapshot carries an old `ts` |
| size unit | base asset | base asset, 20 of 20 top level sizes on `ETH` equal to the REST book in the first run, section 4 |
| sequence semantics | `prevTs` in `@orderbookupdate`, S2, with no stated rule | `data.prevTs` equals the previous frame's `ts`, 0 gaps in 671 chained deltas over four books in two runs and in 9,145 deltas over 80 books in two runs |
| idle repeat behaviour | not documented | no repeats. A quiet book sends nothing, `CL` went 31.8 s and 14.2 s without a delta |

## 4. The book channel in detail

`{symbol}@orderbookupdate` seeded by the first `{symbol}@orderbook` push is the pair this profile recommends, and every row below is about them unless it says otherwise.

### Snapshot on subscribe

`@orderbookupdate` sends no snapshot, and its first frame is an ordinary delta, for example 1 bid and 0 asks on `BTC`.
`@orderbook` sends the whole book right after the subscribe, 124 to 155 ms later in the first run and 140 to 174 ms in the second, on four symbols each.
After that it pushes at most once a second, and only when the book changed: `BTC` 44 frames, `ETH` 44 and 47, `CL` 7 and 11, `MERL` 15 and 19, in about 60 s.
The documented depth is 100, and the wire carried 392 to 427 levels per side on `BTC`, 453 to 501 on `ETH`, 32 to 35 on `CL` and 22 to 30 on `MERL`.
The `request` event returns the same whole book once.

### Delta semantics

A delta carries `data.symbol`, `data.prevTs`, `data.bids` and `data.asks`, and the frame `ts`.
Each level is `[price, size]` as JSON numbers, and a size of `0` deletes the level.
No delta with both arrays empty was seen in either run, and a single delta held up to 52 levels on one side.

### Sequence and gap rule

```text
@orderbook push           resetBook, last = ts
delta, prevTs = last      apply, last = ts
delta, ts <= last         already in the book, skip
delta, prevTs != last     gap: resync
```

`data.prevTs` equalled the previous delta's `ts` on every delta: 155, 133, 12 and 25 chained deltas on `BTC`, `ETH`, `CL` and `MERL` in the first run, 135, 158, 20 and 33 in the second, and 0 gaps.
The `batch` mode saw 0 gaps in 4,315 and 4,830 deltas on the 80 shared markets.

The snapshot and the chain line up.
In the sample capture the `@orderbook` push had `ts` 1790132428187 and the next delta had `prevTs` 1790132428187.
The `request` reply's `data.ts` equalled the `ts` of the last delta received on 12 of 12 requests made after a delta had arrived, and on 8 of 8 symbols the first delta after a `request` reply had `prevTs` equal to the reply's `data.ts`.
A book rebuilt from the `request` reply and every later delta equalled the top 20 levels of each `@orderbook` push with the same `ts`: 102 of 102 comparisons in the first run and 117 of 117 in the second.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `@orderbook` push | best first, descending, on every push of both runs | best first, ascending, on every push |
| `request` reply | descending, on 16 of 16 | ascending, on 16 of 16 |
| delta | descending on every delta of both runs | ascending on every delta |
| REST Public Info book | descending | ascending |

A feed still applies deltas by price, which costs nothing when they are sorted.

### Level window

There is no window.
`@orderbook` and the `request` reply carry every level, and deltas cover changes at any depth.
So the engine's 20 levels are always inside what the feed holds.

### Size unit against CCXT `contractSize`

| run | socket top 10 per side | REST book read after it | prices in both | sizes equal |
|---|---|---|---|---|
| first | `@orderbook` `ETH` at `ts` 1790131835186, bid `[2760.71, 0.9423]`, ask `[2760.72, 1.8693]` | 600 ms later, bid `{"price":"2760.71","quantity":"0.9423"}` | 20 | 20 |
| second | `ts` 1790132157586 | 400 ms later | 6 | 4 |

The book moved between the two reads of the second run.
Sizes are base units, 0.9423 ETH, and CCXT `woofipro` reports `contractSize` 1, so the engine's size multiplier is correct.

### One-sided and empty books

No one-sided or empty book was seen.
`PERP_EURUSD_USDC` sent 0 and 1 deltas in the two 60 s batch runs.
The Public Info API documents that an empty book returns empty arrays, S5, and the engine's `resetBook` accepts an empty side.

### Idle repeats

Nothing is repeated.
A book that does not change sends no delta and no `@orderbook` push.
The longest wait between deltas was 4.4 s and 3.0 s on `BTC`, 3.8 s and 3.2 s on `ETH`, 9.2 s and 11.2 s on `MERL`, and 31.8 s and 14.2 s on `CL`.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| subscribe `PERP_NOPE_USDC@orderbookupdate` | `{"id":"p23","success":false,"ts":…,"errorMsg":"invalid symbol PERP_NOPE_USDC"}` | the socket stays open |
| subscribe `PERP_BTC_USDC@nope` | `{"id":"p24","event":"subscribe","success":true,"ts":…}` | nothing |
| subscribe `PERP_BTC_USDC@orderbookupdate` a second time | success | the first keeps delivering |
| subscribe `PERP_AAPL_USDC_mythos@orderbookupdate` | success | a builder market is served like any other |
| subscribe `PERP_ALPIX_USDC_alpix@orderbookupdate`, the `REDUCE_ONLY` market | success | |
| subscribe `PERP_BTC_USDC@indexprice` | `{"id":"p17","success":false,…,"errorMsg":"invalid index symbol"}` | |
| subscribe without `id` | `{"event":"subscribe","success":true,"ts":…}` | |
| `request` orderbook for `PERP_NOPE_USDC` | `{"id":"rX","success":false,…,"errorMsg":"invalid symbol PERP_NOPE_USDC"}` | |
| the text `hello` | `{"success":false,"ts":…,"errorMsg":"invalid message"}` | the socket stays open |

A delisted market was not available to probe.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server ping every 10 s, and "If the pong from client is not received within 10 seconds for 10 consecutive times, it will actively disconnect the client.", S4 | server pings every 10 s, first at 2.65 to 7.48 s after the open |
| silence the server tolerates | as above | a socket that never answered the server's ping closed 110 s after the first ping: at 112.65 and 112.67 s in the first run and 117.40 and 117.49 s in the second, with 1000 or 1006, whether or not it had a subscription delivering frames |
| what keeps a socket open | answer each ping with `{"event":"pong"}`, or send `{"event":"ping"}` every 10 s, S4 | either one kept a socket open for the full 120 s in both runs, and the client ping alone was enough without answering the server |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | `maintenance_status` topic, and `GET /v1/public/system_info` | not observed, and `system_info` answered status 0 |
| compression | Not publicly specified | text JSON only. A client offering permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | | 153 to 211 ms to open |
| subscription limits | Not publicly specified | 80 book topics on one socket, and 22 mixed topics on another, with no refusal |
| throughput | | 80 shared markets on `@orderbookupdate`: 72 and 81 frames per second on average, median 69 and 76, peak 170 and 189, 13.7 and 15.8 KB per second, 190 and 196 bytes per frame, 25 to 28 µs per frame for `toString` and `JSON.parse` |
| quietest markets | | `PERP_EURUSD_USDC` 0 and 1 frames in 60 s, `PERP_M_USDC` 2 and 4 |

## 6. Captured frames

Trimmed, from a capture at 03:00 UTC with the same URL and frames as the probe.
Book arrays are cut to three levels.

Subscribe and acknowledgement.

```json
{"id": "c1", "event": "subscribe", "topic": "PERP_ETH_USDC@orderbookupdate"}
```

```json
{"id":"c1","event":"subscribe","success":true,"ts":1790132429892}
```

Snapshot from `@orderbook`, whose `ts` is older than its arrival because it is the time of the last book change.

```json
{"topic":"PERP_ETH_USDC@orderbook","ts":1790132428187,"data":{"symbol":"PERP_ETH_USDC","asks":[[2763.61,0.721],[2763.84,1.3008],[2763.92,2.9126]],"bids":[[2763.6,0.4935],[2763.37,6.4877],[2763.22,6.4902]]}}
```

The next delta, chained on the snapshot's `ts`.

```json
{"topic":"PERP_ETH_USDC@orderbookupdate","ts":1790132430586,"data":{"symbol":"PERP_ETH_USDC","prevTs":1790132428187,"asks":[[2766.01,6.4934],[2766.2,26.1946],[2768.8,0]],"bids":[[2762.93,0],[2760.06,0],[2757.91,0]]}}
```

Snapshot from a `request`, whose `data.ts` is the last delta's `ts`.

```json
{"id":"c3","event":"request","success":true,"ts":1790132430694,"data":{"symbol":"PERP_ETH_USDC","ts":1790132430586,"asks":[[2763.61,0.721],[2763.84,1.3008],[2763.92,2.9126]],"bids":[[2763.6,0.4935],[2763.37,6.4877],[2763.22,6.4902]]}}
```

Keepalive, a server ping and the answer to a client ping.

```json
{"event":"ping","ts":1790132430000}
```

```json
{"event":"pong","ts":1790132431392}
```

Error.

```json
{"id":"c4","success":false,"ts":1790132431093,"errorMsg":"invalid symbol PERP_NOPE_USDC"}
```

Anchor topics, the first two rows of `markprices` and one predicted rate.

```json
{"topic":"markprices","ts":1790132432000,"data":[{"symbol":"PERP_WOO_USDC","price":0.01292},{"symbol":"PERP_SEI_USDC","price":0.06171}]}
```

```json
{"topic":"PERP_ETH_USDC@estfundingrate","ts":1790132445000,"data":{"symbol":"PERP_ETH_USDC","fundingRate":0.00018583,"fundingTs":1790150400000}}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use `wss://ws-private-evm.orderly.org/v2/ws/private/stream/{account_id}` and an Orderly key signature.

- `account`, `balance`, `position` and `executionreport`, as S1 names them.
- The private topic pages also cover algo execution reports, PnL settlement, wallet transactions, asset conversion and liquidation pushes.
- CCXT Pro `woofipro` connects to the same private URL, `server/node_modules/ccxt/js/src/pro/woofipro.js` line 36.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://ws-evm.orderly.org/ws/stream/OqdphuyCtYWxwzhxyLLjOWNdFP7sQt8RPWzmb5xY` | one family, and only this path segment is served |
| channels | `<rawMarketId>@orderbookupdate` and `<rawMarketId>@orderbook` | the deltas carry the chain, and the first `@orderbook` push is the snapshot the chain starts from |
| markets per connection | 80, the whole shared list | 80 books ran with 0 gaps at 72 and 81 frames per second, and no cap is published, so a larger slice is untested |
| subscribe frames | one frame per topic, `{"id": "<n>", "event": "subscribe", "topic": "PERP_BTC_USDC@orderbookupdate"}` | the documented shape takes one topic |
| keepalive | send `{"event":"ping"}` every 10 s, and answer any `{"event":"ping"}` with `{"event":"pong"}` in `handleMessage` | either alone kept a socket open, and doing both leaves no gap |
| `maxSilenceMs` | 30,000 | the server pings every 10 s and every frame counts as traffic in [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 205, while a quiet book went 31.8 s without a delta |
| routing | `topic.slice(0, topic.indexOf('@'))` gives the `rawMarketId` | the topic wraps the symbol |
| snapshot | on an `@orderbook` push: `resetBook` and store `ts`, or skip it when its `ts` equals the stored one | the push is the whole book stamped with the change it reflects |
| delta | apply only when `data.prevTs === last`, then store `ts` | 0 gaps observed |
| resync | `data.prevTs !== last` with `ts > last`, or a delta before any snapshot: `resync` | the engine's existing path, and a new subscribe brings a fresh `@orderbook` push |
| unserved topic | log a market with no `@orderbook` push 10 s after its ack | a wrong topic suffix is acked as success and stays silent |
| receive time | stamp on arrival, never from `ts` | a quiet book's frames carry the time of its last change |
| numbers | JSON numbers as sent | no string parsing needed |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |

Keeping `@orderbook` subscribed costs a whole book per changed market per second, up to about 500 levels per side on `ETH`.
A leaner variant sends one `request` per market after the subscribes and seeds from its reply, which lined up with the chain on 8 of 8 symbols.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Orderly, Websocket API | https://orderly.network/docs/build-on-omnichain/websocket-api/introduction | 2026-09-22 | Orderly Network | URLs, account id path, private topics, sections 1, 3 and 7 |
| S2 | Orderly, public topic pages: Orderbook, Order book update, Request orderbook, bbo, bbos, Mark price, Mark prices, Index price, Index prices, Estimated funding rate, 24-hour ticker, System maintenance status | https://orderly.network/docs/build-on-omnichain/websocket-api/public/orderbook | 2026-09-22 | Orderly Network | topic names, cadences, frame shapes, sections 2 to 4 |
| S3 | Orderly, Error Response | https://orderly.network/docs/build-on-omnichain/websocket-api/error-response | 2026-09-22 | Orderly Network | error shape, section 3 |
| S4 | Orderly, PING/PONG | https://orderly.network/docs/build-on-omnichain/websocket-api/ping-pong | 2026-09-22 | Orderly Network | keepalive rule, sections 3 and 5 |
| S5 | Orderly Public Info API, Orderbook | https://orderly.network/docs/build-on-omnichain/public-info-api/market/orderbook | 2026-09-22 | Orderly Network | empty book shape, section 4 |
| S6 | niza.fun Next.js bundle, chunk `45a72f26cbe134ce.js` | https://niza.fun/_next/static/chunks/45a72f26cbe134ce.js | 2026-09-22 | Niza.fun | the public socket path the front end uses, section 1 |
| S7 | CCXT Pro 4.5.68 `woofipro.js` | `server/node_modules/ccxt/js/src/pro/woofipro.js` | 2026-09-22 | CCXT | public and private URLs, default id, sections 1 and 7 |
| P1 | `ws-probe.mjs book`, `batch`, `silence` and `deflate`, first run from 02:48 to 02:55 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/niza/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 5, first readings |
| P2 | the same four modes rerun from 02:55 to 03:00 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/niza/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 5, second readings |
| P3 | a 20 s capture of sample frames at 03:00 UTC, a scratch script outside the repo that sends the probe's frames | not kept | 2026-09-22 | this host | section 6 |
