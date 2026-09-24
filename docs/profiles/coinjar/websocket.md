# CoinJar WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:26 to 03:34 UTC and again 03:45 to 03:49 UTC, from the development host near Seattle.

This profile covers the public market data feed of CoinJar Exchange, which has no CCXT class, on its spot book, because CoinJar lists no perpetual, see [`fees.md`](./fees.md) section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md).
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/coinjar/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The feed speaks the Phoenix channel protocol of the Elixir web framework, S1.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, every product | `wss://feed.exchange.coinjar.com/socket/websocket`, S1 | HTTP 101 on every open. 72 to 139 ms on twelve opens, 1,094 to 1,118 ms on three, and 15,348 ms once, over P1 to P4 |
| sandbox | `wss://feed.exchange.coinjar-sandbox.com/socket/websocket`, S1 | not probed |

One socket carries every product.
All 302 products joined on one socket in P2.
The host resolved to the Cloudflare addresses `104.20.27.93` and `172.66.174.241`, the same as the REST hosts, and the upgrade reply named edges `SEA` and `YVR` in `cf-ray`, see [`rest.md`](./rest.md) section 1.
No refusal or geoblock was met from this host.

## 2. Channel matrix for public market data

| channel | payload | depth and speed, documented | probed on 2026-09-23 |
|---|---|---|---|
| `book:{pair}` | `{}` | "Level 2 aggregated order book (Recommended)", top 40 levels, coalesced every 100 ms, implied levels in the top 40, S2 and S3 | `init` with 40 levels per side, then deltas, 145 to 238 per busy book in about 65 s |
| `native_book:{pair}` | `{}` | "Full native order book", all levels, not coalesced, no implied levels, WebSocket only, S3 | `init` with every native level, then deltas. `BTC-USDT` held 11 bids and 2 asks |
| `ticker:{pair}` | `{}` | best bid and ask, last, session state, "every update to the ticker", best bid and ask refreshed every 100 ms, S2 and S3 | `init`, then 0 to 48 updates per product in about 65 s |
| `trades:{pair}` | `{}` | every new trade, `init` with the last 50, S2 | `init` only, no `new` event on `BTC-USDT` in any of three runs |
| `auction:{pair}` | `{}` | indicative price, volume and imbalance during auctions, S2 | `init` with empty strings and `status` `continuous`, and at most 1 update per run |
| `private` | `{"token": …}` | orders, fills and balances, S1 | not probed, section 7 |

The channel names, payloads and examples are from S1 and S2, and the table of book types is S3.
No mark, index or funding channel exists.
The ticker carries a `mark_price` field that S2 does not document, see [`rest.md`](./rest.md) section 4.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | one URL for every product, 302 topics on one socket |
| subscribe frame shape | `{"topic": "CHANNEL_NAME", "event": "phx_join", "payload": {}, "ref": 0}`, one topic per frame, S1 | one topic per frame. 302 join frames sent in 2 and 4 ms were all acknowledged |
| unknown symbol expectation | Not publicly specified | `phx_reply` with `status` `error` and `reason` `invalid product` for `book:NOPE`, `native_book:NOPE`, the lower case `book:btc-usdt` and the inactive `book:BTCEUR`. An unknown channel prefix answers `unmatched topic` |
| chunk unit and budget | Not publicly specified | 302 topics on one socket, all 302 `init` frames within 207 and 358 ms of the first join in two runs |
| keepalive mechanism | "you must send a heartbeat message every 45 seconds, otherwise the connection will be dropped by the server", frame `{"topic": "phoenix", "event": "heartbeat", "payload": {}, "ref": 0}`, S1 | the reply `phx_reply` `ok` came in 13 to 34 ms. The server sent no protocol ping on any socket. A socket with no client frame closed after 60.0 to 66.0 s |
| connection lifetime and maintenance notice | status page `status.coinjar.com`, S4. The terms aim "to announce any scheduled maintenance with at least 24-hours notice", S5 | no in-band notice channel. No forced disconnect on a socket that sent heartbeats, the longest held 100 s |
| handshake and operation rate limits | "API calls for order placements, order cancellation and market data are not rate limited", S6 | no refusal at 302 joins in one burst |
| public market data authentication | none, S1 | none |
| message parse and routing | Phoenix envelope `topic`, `event`, `payload`, `ref`, S1 | the same four keys. Route on `topic`, spelled `<channel>:<product id>`, and on `event` |
| subscribe acknowledgement shape | `{"topic":"ticker:BTCAUD","ref":0,"payload":{"status":"ok","response":{}},"join_ref":null,"event":"phx_reply"}`, S2 | the same without `join_ref`, 14 to 34 ms after the join, and before the `init` |
| symbol identifier format | `BTCAUD` in every example, S2 | the catalog `id` exactly, which is `BTCUSD` for 143 older products and `BTC-USDT` for 159 newer ones. Matching is case sensitive |
| number representation | strings in the examples, S2 | book price and size are decimal strings with 8 or 9 decimals. The ticker's `change_24h` is a JSON number, and `prev_close` and `last` can be `false` |
| timestamp representation | ISO 8601 with microseconds, `current_time` and trade `timestamp`, S2 | the same. Book frames carry no time at all |
| size unit | base currency in every example, S2 | base currency. The maintained `BTC-USDT` book equalled the REST level 2 book at the end of all three runs, 0 of 80 levels different |
| sequence semantics | none. A `request_snapshot` event returns a `snapshot` "emitted in between two `update` events", S2 | no sequence field. A book payload has only `bids` and `asks` |
| idle repeat behaviour | not documented | no update repeated the previous one on any book in any run. A book with no native order change still moves as its implied levels move |

## 4. The book channel in detail

`book:{pair}` is the channel a spot feed would use, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame after the acknowledgement is `event` `init` with the whole level 2 book, S2.
It carried 37 to 40 bids and 40 asks on `BTC-USDT`, `ETH-USDC` and `BTCUSD`, 18 to 20 bids and 4 asks on `POL-USDT`, and two empty arrays on `BNB-USDT`, in P1.
It came within 10 ms of the acknowledgement.
Joining a topic that is already joined answers `ok`, closes the first subscription with a `phx_close` frame, and sends a fresh `init`, in all three runs of P1.

### Delta semantics

An `update` carries `bids` and `asks` arrays of `[price, size]` string pairs.
The size replaces the level, and a size of zero removes it, S2.
"Multiple updates may be aggregated into a single message", S2.
In P1, 308, 467 and 441 of the levels in `BTC-USDT` updates were zero sizes, in 178, 205 and 163 updates.
No update arrived with both arrays empty.

### Sequence and gap rule

No frame carries a sequence number, an update id or a timestamp.
A missed or reordered frame cannot be detected from the stream.
The documented repair is `{"topic": "book:<id>", "event": "request_snapshot", "payload": {}, "ref": <n>}`, which returns one `snapshot` frame with the full level 2 book and no `phx_reply`, S2.

```text
init       replace the book
update     apply each level by price, size "0…0" removes it
snapshot   replace the book, the answer to request_snapshot
gap        not detectable, so compare with a snapshot or rejoin on a timer
```

The maintained book was compared with each `snapshot` before it replaced the book.
Four snapshots on each of `BTC-USDT`, `BTCUSD` and `POL-USDT` in all three runs, and on `ETH-USDC` in the second and third, differed in 0 of the top 40 levels per side, in P1.
A `request_snapshot` on a topic that is not joined answers `phx_reply` `error` `unmatched topic`.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `init` and `snapshot` | best first, descending, on every book in P1 | best first, ascending, on every book in P1 |
| `update` | no order: of 434 and 411 bid arrays with two or more levels in the second and third runs' captures, 321 and 267 were ascending, 23 and 17 descending, and 90 and 127 neither | no order: of 368 and 391 ask arrays, 237 and 251 ascending, 2 and 5 descending, and 129 and 135 neither |
| REST `book` | descending | ascending |

A feed applies deltas by price and never by position.

### Level window

The server keeps the channel at 40 levels per side, S3.
A book maintained from `init` and every update never held more than 40 levels on either side in P1, so a level leaving the window arrives as a zero size.

### Implied levels

The level 2 book includes implied orders, which CoreMatch builds from two other books, as in the documented example of a BTC/AUD bid and ask implied from the BTC/USDC and USDC/AUD books, S7.
An implied level is tradable: an incoming order that matches it fills against the two resting legs, and "The two legs associated with the implied order are considered maker trades and the incoming order is considered a taker", S7.
"When the price is equal, native orders have priority over implied orders", S7.
S7 also says that "it is possible for the order book to remain in a crossed state with two implied orders at the top of the order book".

On the wire the two kinds of level are indistinguishable.
Comparing with `native_book` at the end of each run, only 8, 5 and 6 of the 80 `BTC-USDT` levels, 9 and 9 of the 80 `ETH-USDC` levels in the second and third runs, and 5, 5 and 5 of the 80 `BTCUSD` levels sat at a native price, in P1.
So about nine in ten displayed levels were implied only.
Implied sizes carry more decimals than the lot size, such as `72650.824176667` POL on `POL-USDT`.
No book was crossed after any update in any run.

### Size unit

The size is in the base currency and the price in the counter currency, S2 and S8.
No contract multiplier exists, and CCXT has no class to report one, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

`BNB-USDT` answered `init` with `{"bids":[],"asks":[]}` and sent no update in any of three runs, and all six BNB products have no order on either side, see [`rest.md`](./rest.md) section 2.
`POL-USDT` held 18 to 21 bids and 4 or 5 asks, with a spread of 30,192 to 31,164 ppm at its `init` and `snapshot` frames in the second run.

### Idle repeats

Nothing is repeated.
The four two-sided books updated every 259 to 361 ms at the median over three runs.
The shortest gap between two updates of one topic was 19 to 159 ms, so the documented 100 ms coalescing is not a strict floor.
The longest gap was 6,803 ms on `POL-USDT`.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `phx_join` `book:NOPE` | `{"status":"error","response":{"reason":"invalid product"}}` | nothing |
| `phx_join` `book:btc-usdt` | `invalid product` | nothing |
| `phx_join` `native_book:NOPE` | `invalid product` | nothing |
| `phx_join` `book:BTCEUR`, a product that `GET /products?all=true` lists as inactive | `invalid product` | nothing |
| `phx_join` `foo:BTC-USDT` | `unmatched topic` | nothing |
| `phx_join` `book:BNB-USDT`, a listed product with an empty book | `ok` | an `init` with two empty arrays, then nothing |
| `phx_join` twice on `book:BTC-USDT` | `ok` | `phx_close` for the first join, then a new `init` |
| unknown event `nope_event` on a joined `book:` topic | no reply | `phx_error` on that topic. Afterwards the topic is not joined, and its `request_snapshot` answers `unmatched topic` |
| `request_snapshot` on a topic not joined | `unmatched topic` | nothing |
| `phx_leave` on a joined topic | `ok` | `phx_close` |
| text that is not JSON | none | the server closes the socket with code 1011 after 18, 27 and 18 ms |

An inactive product is refused like an unknown one.
An unknown event on a joined topic kills that one subscription silently, so a feed must treat `phx_error` and `phx_close` as a lost topic.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | heartbeat every 45 s, S1 | `phx_reply` `ok` on topic `phoenix` in 13 to 34 ms. No protocol ping from the server on the eleven sockets that listened for one |
| silence the server tolerates | 45 s, S1 | a socket that joined nothing and sent nothing closed at 59,987 and 59,998 ms with 1006 and no close frame. Sockets that joined a busy or a quiet book and then sent nothing closed at 66,006 to 66,016 ms with 1000, after 114 to 170 frames. A socket that sent a heartbeat every 30 s was open at 100 s, in both runs |
| forced disconnect | Not publicly specified | none in 100 s |
| maintenance notice | status page, S4 | not observed, and the status page read "All Systems Operational" with the component "CoinJar Exchange" operational |
| compression | Not publicly specified | text JSON frames. With `perMessageDeflate: false` the upgrade carried no `sec-websocket-extensions`. A client that offered it got `permessage-deflate; client_max_window_bits=15`, so the server negotiates it on request |
| handshake | | 72 to 139 ms on twelve of sixteen opens, 1,094 to 1,118 ms on three, 15,348 ms once |
| subscription limits | Not publicly specified | 302 topics on one socket, no cap reached |
| throughput | | every product's `book:` on one socket, two runs: median 255 and 266 frames per second, min 176 and 204, p90 321 and 359, max 474 and 482, 70 and 83 KB per second, 260 and 293 bytes per frame, 9.2 and 10.1 µs `JSON.parse` per frame, 9 and 8 of 302 topics silent for 60 s |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Level arrays keep at most three levels per side.

Join and acknowledgement.

```json
{"topic": "book:BTC-USDT", "event": "phx_join", "payload": {}, "ref": 1}
```

```json
{"ref":1,"payload":{"status":"ok","response":{}},"event":"phx_reply","topic":"book:BTC-USDT"}
```

Snapshot on join, where the first two bid sizes are native and the rest are implied.

```json
{"ref":null,"payload":{"bids":[["0.10910000","2900.000000000"],["0.10900000","72650.824176667"],["0.10870000","297349.175823333"]],"asks":[["0.11250000","134421.549421193"],["0.11270000","2000.000000000"],["0.16730000","597.965290245"]]},"event":"init","topic":"book:POL-USDT"}
```

Delta, and a delta with unordered bids and zero sizes.

```json
{"ref":null,"payload":{"bids":[["0.10920000","18000.000000000"],["0.10900000","54650.824176667"]],"asks":[]},"event":"update","topic":"book:POL-USDT"}
```

```json
{"ref":null,"payload":{"bids":[["85620.00000000","0.00000000"],["85660.00000000","0.11692800"],["86140.00000000","0.12527640"],["86300.00000000","0.00639600"]],"asks":[["87310.00000000","0.00368600"],["87360.00000000","0.00000000"],["87640.00000000","0.06407640"],["87740.00000000","0.00000000"]]},"event":"update","topic":"book:BTC-USDT"}
```

The answer to `request_snapshot`, 18 s into the second run.

```json
{"ref":null,"payload":{"bids":[["0.10930000","2900.000000000"],["0.10920000","18000.000000000"],["0.10890000","54700.916591127"]],"asks":[["0.11260000","134423.131672598"],["0.11270000","2000.000000000"],["0.16730000","597.965290245"]]},"event":"snapshot","topic":"book:POL-USDT"}
```

Native book, for comparison with the level 2 book.

```json
{"ref":null,"payload":{"bids":[["86510.00000000","0.42300000"],["86390.00000000","2.89300000"],["61000.00000000","0.01600000"]],"asks":[["87000.00000000","2.87300000"],["87140.00000000","2.86800000"]]},"event":"init","topic":"native_book:BTCUSD"}
```

```json
{"ref":null,"payload":{"bids":[],"asks":[["86770.00000000","0.00000000"]]},"event":"update","topic":"native_book:BTC-USDT"}
```

Keepalive.

```json
{"topic": "phoenix", "event": "heartbeat", "payload": {}, "ref": 20}
```

```json
{"ref":20,"payload":{"status":"ok","response":{}},"event":"phx_reply","topic":"phoenix"}
```

Errors and closes.

```json
{"ref":15,"payload":{"status":"error","response":{"reason":"invalid product"}},"event":"phx_reply","topic":"book:NOPE"}
```

```json
{"ref":17,"payload":{"status":"error","response":{"reason":"unmatched topic"}},"event":"phx_reply","topic":"foo:BTC-USDT"}
```

```json
{"ref":null,"payload":{},"event":"phx_close","topic":"book:BTC-USDT"}
```

```json
{"ref":null,"payload":{},"event":"phx_error","topic":"book:XRPBTC"}
```

Ticker, with the undocumented `mark_price`, and `prev_close` sent as `false`.

```json
{"ref":null,"payload":{"session":72420,"status":"continuous","last":"0.17420000","volume":"43100.000000000","transition_time":null,"current_time":"2026-09-23T03:30:19.361209Z","prev_close":false,"volume_24h":"0.000000000","bid":"0.10930000","ask":"0.11260000","mark_price":"0.11260000","change_24h":0.0},"event":"update","topic":"ticker:POL-USDT"}
```

## 7. Private channels

Named for a future execution stage, from S2, not probed.
The same URL carries one `private` topic, joined with `{"token": "<api token>"}` in the payload, S1.
Its events are `private:order`, `private:fill` and `private:account`, S2.

## 8. Recommended feed shape

A recommendation for a later design that admits spot legs, not a decision.
Today the engine cannot load CoinJar at all, see [`fees.md`](./fees.md) section 9.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://feed.exchange.coinjar.com/socket/websocket` | every product on one URL |
| channel | `book:<rawMarketId>` | an `init` on join, 40 levels covers the engine's 20, and the levels are what a taker can hit, implied ones included |
| markets per connection | all tracked markets, 70 at most for the USD family | 302 topics ran on one socket at a median of 255 and 266 frames per second |
| subscribe frames | one `phx_join` per topic, with a unique `ref` | the protocol has no multi topic join |
| keepalive | `{"topic": "phoenix", "event": "heartbeat", "payload": {}, "ref": <n>}` every 20 s | the documented limit is 45 s, and a socket without client frames died at 60 to 66 s |
| `maxSilenceMs` | 60,000 | three missed heartbeat replies. `BNB-USDT` sends nothing after its `init`, so the heartbeat reply has to count as traffic |
| routing | `topic.slice(5)` for `book:` gives the `rawMarketId` | the topic wraps the product id |
| snapshot | `init` or `snapshot`: `resetBook` | documented replace semantics |
| delta | apply each level by price, zero size removes | no sequence to check |
| resync | on `phx_error` or `phx_close` for a topic, rejoin it. On a timer, send `request_snapshot` and replace the book | no gap is detectable. The engine's `resync` terminates the socket, which here drops every product at once |
| receive time | stamp on arrival | book frames carry no time |
| sizes | `Number()` of the string | base currency, fractional implied sizes |
| deflate | keep `perMessageDeflate: false` | the server negotiates deflate only when asked |
| never send | text that is not JSON, or an event other than `phx_join`, `phx_leave`, `request_snapshot` and `heartbeat` | the first closes the socket with 1011, and an unknown event kills its topic |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Market Data WebSocket API, Getting Started | https://docs.exchange.coinjar.com/reference/getting-started-data-feed | 2026-09-22 | CoinJar Exchange | URL, Phoenix protocol, heartbeat, join frame, private join, sections 1 to 3, 5 and 7 |
| S2 | Market Data WebSocket API, Channels | https://docs.exchange.coinjar.com/reference/channels | 2026-09-22 | CoinJar Exchange | channel names, examples, local book recipe, `request_snapshot`, private events, sections 2 to 4 and 7 |
| S3 | Matching Engine, Order Book | https://docs.exchange.coinjar.com/docs/order-book-1 | 2026-09-22 | CoinJar Exchange | book types, 40 levels, 100 ms coalescing, implied levels, sections 2 and 4 |
| S4 | Market Status and `status.coinjar.com/api/v2/summary.json` | https://docs.exchange.coinjar.com/page/market-status | 2026-09-22 | CoinJar | status page, section 5 |
| S5 | CoinJar Terms of Service, global, 7.1.6 | https://www.coinjar.com/global/legal | 2026-09-22 | CoinJar Australia Pty Ltd | maintenance notice, section 3 |
| S6 | Rate Limits | https://docs.exchange.coinjar.com/docs/rate-limits | 2026-09-22 | CoinJar Exchange | market data not rate limited, section 3 |
| S7 | Matching Engine, Implied Matching | https://docs.exchange.coinjar.com/docs/implied-matching | 2026-09-22 | CoinJar Exchange | implied orders, priority, crossed implied books, section 4 |
| S8 | Prices and Sizes | https://docs.exchange.coinjar.com/docs/prices-and-sizes | 2026-09-22 | CoinJar Exchange | tick and trade size, section 4 |
| P1 | `ws-probe.mjs book`, three runs at 03:28, 03:30 and 03:45 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/coinjar/ws-probe.mjs) | 2026-09-22 | this host | sections 2 to 6. `ETH-USDC` counts come from the second and third runs only, because the first run's error test killed that topic at 3 s |
| P2 | `ws-probe.mjs batch` at 03:31 and 03:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinjar/ws-probe.mjs) | 2026-09-22 | this host | sections 3 and 5 |
| P3 | `ws-probe.mjs silence` at 03:32 and 03:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinjar/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
| P4 | `ws-probe.mjs deflate` at 03:34 and 03:49 UTC, and one 8 s exploratory socket at 03:26 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/coinjar/ws-probe.mjs) | 2026-09-22 | this host | sections 1 and 5 |
