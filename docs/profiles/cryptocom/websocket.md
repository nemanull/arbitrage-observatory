# Crypto.com Exchange WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, which the venue's own geolocation placed in Canada.

This profile covers the public market data WebSocket of the Crypto.com Exchange API v1 (CCXT id `cryptocom`) for its one perpetual family, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/cryptocom/ws-probe.mjs), run twice, and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The socket served this host in full, although the venue does not offer its derivatives to a Canadian or US account, see [`fees.md`](./fees.md) section 1.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| all public market data: spot, perpetuals, dated futures | `wss://stream.crypto.com/exchange/v1/market`, S1 | open in 620 to 1,019 ms on the fourteen sockets that logged it, every perpetual delivers |
| user API, private | `wss://stream.crypto.com/exchange/v1/user`, S1 | not probed |
| sandbox | `wss://uat-stream.3ona.co/exchange/v1/market`, S1 | not probed |

One socket carries every product.
In both `book` runs one socket delivered `BTCUSD-PERP`, the spot pair `BTC_USD` and the dated future `BTCUSD-261225` side by side.
`stream.crypto.com` resolves to two Cloudflare addresses, and the upgrade reply's `cf-ray` ended in `SEA` on three of the sockets that logged it and in `YVR` on one, see [`rest.md`](./rest.md) section 1.
CCXT Pro uses the same URL, at `server/node_modules/ccxt/js/src/pro/cryptocom.js` line 38.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed on 2026-09-22 |
|---|---|---|---|
| `book.{instrument_name}.{depth}`, `SNAPSHOT_AND_UPDATE`, `book_update_frequency` 10 | depth 10 or 50 | a snapshot, then deltas at 10 ms | snapshot then deltas, recommended |
| same, `book_update_frequency` 100 | depth 50 | deltas at 100 ms | one snapshot, then deltas a median 102 ms apart in both runs |
| same, `SNAPSHOT`, or no parameters | depth 50 | "Full snapshot subscription (book_subscription_type=SNAPSHOT) 500ms", S6 | a full 50 level book every 507 to 509 ms, whatever frequency was asked, 10, 100 or 500 |
| `ticker.{instrument_name}` | best bid and ask with sizes `bs` and `ks`, last, 24 h, open interest | on change | 26 and 25 frames in 15 s on BTC |
| `trade.{instrument_name}`, `candlestick.{time_frame}.{instrument_name}`, `settlement.{instrument_name}` | | | not probed |
| `mark.{instrument_name}` | `{v, t}` | "Mark price (updates ~50ms)", S5 | one frame a second, `t` on the whole second, 16 frames in 15 s on BTC, and 48 or 49 frames in the batch window on each of 134 perpetuals |
| `index.{underlying_symbol}` | `{v, t}`, symbol `BTCUSD-INDEX` | S5 | one frame a second, like the mark |
| `funding.{instrument_name}` | `{v, t}` | "Hourly funding rate that will settle at end of current hour.", S5 | once on subscribe, then once a minute, `t` at second 5 |
| `estimatedfunding.{instrument_name}` | `{v, t}` | "Estimated funding rate for the next interval.", S5 | once on subscribe, then once a minute, `t` at second 59 |

The mark, index and funding channels carry every anchor field the engine reads, see section 8.
The documented mark cadence of about 50 ms did not show on the wire, which pushed one mark a second.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one market data URL and one user URL, S1 | one socket served perpetuals, spot and a dated future |
| subscribe frame shape | `{"id", "method": "subscribe", "params": {"channels": [...], "book_subscription_type", "book_update_frequency"}, "nonce"}`, S2, S4 | a frame of 100 channels was accepted, and a frame without `nonce` was accepted |
| unknown symbol expectation | code 40003 is not documented for this case | `{"code":40003,"message":"Unknown symbol"}` for a book, `"Unsupported instrument"` for `index.BTCUSD-PERP` and `mark.BTCUSD-INDEX` |
| chunk unit and budget | channels. "Introduced Market Data subscription limiting" on 2023-12-11, S6, and the limits section it names is not on the current pages | 400 channels per connection. The 401st and later answered 40107 `"Maximum subscriptions exceeded"`, and 396 book channels on one socket ran clean |
| keepalive mechanism | "Heartbeat sent by server every 30s", and the client "must respond with public/respond-heartbeat within 5 seconds", S3 | `public/heartbeat` every 30.0 s, and a protocol ping every 5.0 to 5.2 s. A socket that ignores the heartbeat is closed at the third one, not after 5 s, see section 5 |
| connection lifetime and maintenance notice | termination code 1013 "Server restarting -- try again later", S1 | no forced close in 100 s |
| handshake and operation rate limits | "Market Data 100 requests per second", pro-rated to the calendar second of the connect, so "adding a 1-second sleep after establishing the websocket connection" is advised, S1 | no refusal at 4 frames per second after a 1 s wait |
| public market data authentication | none | none |
| message parse and routing | `{id, method, code, result: {instrument_name, subscription, channel, depth, data}}`, field order fixed since 2024-01-04, S6 | data frames carry `"method":"subscribe"` and `"id":-1`, except the first frame of a `mark`, `index`, `funding` or `ticker` subscription, and route on `result.instrument_name` and `result.channel` |
| subscribe acknowledgement shape | `{id, method, code, result, message}`, S4 | a book gets one `{"id":1,"method":"subscribe","code":0,"channel":"book.BTCUSD-PERP.50"}` per channel. `mark`, `index`, `funding` and `ticker` get no bare ack, their first data frame carries the request id |
| symbol identifier format | `BTCUSD-PERP` | identical to CCXT `market.id` and the REST `symbol` on 396 of 396 perpetuals. The index channel takes `underlying_symbol`, `BTCUSD-INDEX` |
| number representation | "All numbers must be strings", S1 | price, size and order count are strings. `u`, `pu`, `cs` and `t` are JSON numbers |
| timestamp representation | `t` and `tt` in ms, S2 | integer ms. `t` is the publish time and `tt` the last book change: `t - tt` was 5 to 9 ms at the median on every stream, and about 5 s on an idle delta |
| size unit | not stated | base currency units, equal to the REST book, and CCXT `contractSize` is 1 on every perpetual, section 4 |
| sequence semantics | `u` "Sequence (snapshot)" and `pu` "Previous sequence (delta)", S2 | each delta's `pu` equals the previous frame's `u`. 0 breaks in 4,006 and 5,816 deltas on seven streams and in 38,288 and 42,948 deltas on 396 perpetuals |
| idle repeat behaviour | "the fixed 500ms delta full book snapshot heartbeat is replaced with empty delta in the case of no book changes", S6 | a quiet book sends an empty delta about every 5 s, with `u` equal to `pu` |

## 4. The book channel in detail

`book.{instrument_name}.50` with `SNAPSHOT_AND_UPDATE` at 10 ms is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first data frame for each stream has `"channel":"book"` and holds up to 50 bids and 50 asks with `t`, `tt`, `u` and `cs`.
It arrived 998 to 1,141 ms after the acknowledgement on every stream: acks at 1,817 and 1,930 ms after the socket was created, snapshots at 2,815 to 2,948 and 2,931 to 3,071 ms.
No second snapshot came in 60 s on any stream.
All 396 perpetuals had their snapshot within 15 s of the four subscribe frames, in both batch runs.

### Delta semantics

A delta has `"channel":"book.update"` and carries `data[0].update.bids` and `data[0].update.asks`, arrays of `[price, size, count]` strings.
A size of `"0"`, sent with a count of `"0"`, deletes the level.
A delta with both arrays empty is legal.
It is the idle frame of section 3, and it was 0 to 9 of the deltas per stream per minute.

### Sequence and gap rule

```text
channel "book"          replace the book, last = u
channel "book.update"   pu = last: apply, last = u
channel "book.update"   pu ≠ last: gap, resubscribe the stream or terminate the socket (the engine's resync)
```

The first delta's `pu` equalled the snapshot's `u` on 7 of 7 streams in both runs.
The rule held on every delta of both runs, with 0 gaps.
`u` is not a counter that steps by one.
Consecutive values in the capture differ by about 10^4 to 10^6, so only `pu` links frames.
CCXT Pro applies the same rule, compares `pu` with its stored nonce, and raises a checksum error on a mismatch, at `server/node_modules/ccxt/js/src/pro/cryptocom.js` lines 289 to 295.
The change log names "clarifications for book delta sequence number handling and re-subscription" on 2024-02-12, S6, and the current book page carries no such text.

### Checksum

Every snapshot and delta carries `cs`, a signed 32-bit integer.
The current pages do not describe it, S2.
576 CRC32 layouts of price and size strings, over 1 to 50 levels in four orders, four separators and three number formats, with and without the order count, matched none of 300 BTC deltas in either run.
CCXT ignores the field.
A feed relies on the `pu` chain and leaves `cs` unread.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on 7 of 7 streams in both runs | best first, ascending, on 7 of 7 |
| delta | descending in every delta seen, 0 exceptions | ascending in every delta seen, 0 exceptions |
| REST `get-book` | descending at depth 10, 50, 100 and 150 | ascending |

The order held, but a feed still applies deltas by price and never by position.

### Level window

The server keeps a depth 50 stream at 50 levels a side.
A book kept from the snapshot and every delta never held more than 50 levels on any stream, so a level that leaves the window arrives as a `"0"` delete.
Thin books simply hold fewer: `NVDAUSD-PERP` never held more than 34 levels a side, `WALUSD-PERP` 31, `LYTEUSD-PERP` 16 and the dated future 23.

### Size unit against CCXT `contractSize`

| book | CCXT `contractSize` | socket at the touch | REST at the nearest `t` | top 40 levels equal |
|---|---:|---|---|---|
| `BTCUSD-PERP` | 1 | bid `["86235.5","0.0301","2"]` | bid `["86235.5","0.0301","2"]` | 38 of 40 and 40 of 40 |
| `ETHUSD-PERP` | 1 | ask `["2749.10","0.0786","2"]` | ask `["2749.10","0.0786","2"]` | 40 of 40 and 40 of 40 |

Sizes are in base currency, and every perpetual lists `contract_size` `"1"`, which CCXT copies into `contractSize`, see [`rest.md`](./rest.md) section 2.
The engine's `sizeMul` is therefore 1 and correct.

### One-sided and empty books

The REST ticker showed a null `b` or `k` on 5 TradFi perpetuals at 21:43 UTC and on 2 at 21:49 UTC, after the US stock market close.
The probe picked `TENCENTUSD-PERP` at 21:48 and `LYTEUSD-PERP` at 21:57 because the ticker showed a null side, and their socket snapshots held 15 and 16 levels on both sides, so the ticker's null did not mean an empty book.
No one-sided book was seen on the socket, so what the channel sends for an empty side is Not verified.
The engine's `resetBook` accepts an empty side.

### Idle repeats

A quiet book repeats nothing but its idle delta, an empty update with `u` equal to `pu`, about every 5 s: the longest silence on `NVDAUSD-PERP`, `WALUSD-PERP`, `TENCENTUSD-PERP` and `LYTEUSD-PERP` was 4,995 to 5,033 ms.
The longest gap on a busy book was 1,603 ms.

### Unknown, wrong-depth and other requests

| request | reply |
|---|---|
| `book.NOPEUSD-PERP.50` | `{"code":40003,"message":"Unknown symbol"}` |
| `book.BTCUSD-PERP.20` | `{"code":40003,"message":"Invalid depth"}` |
| `book.BTCUSD-PERP.150`, no parameters | `{"code":0}`, acknowledged |
| `book.ETHUSD-PERP.150`, `SNAPSHOT_AND_UPDATE` at 10 ms | `{"code":40003,"message":"Unsupported depth/interval combination"}` |
| `book_update_frequency` 50 | `{"code":40003,"message":"Unsupported depth/interval combination"}` |
| `book_subscription_type` `NOPE` | `{"code":40003,"message":"Invalid book_subscription_type"}` |
| channel `nope.BTCUSD-PERP` | `{"code":40003,"message":"Unrecognized channel"}` |
| `index.BTCUSD-PERP` or `mark.BTCUSD-INDEX` | `{"code":40003,"message":"Unsupported instrument"}` |
| the same book channel twice | two `code` 0 acks, one stream, and no frame delivered twice |
| unsubscribe from a channel never subscribed | `{"id":22,"method":"unsubscribe","code":0}` |
| `book.BTCUSD-260925.50`, the future dated 2026-09-25 | `code` 0 |
| method `public/nope` | `{"code":40003,"message":"No such method"}`, the same frame 8 times in one millisecond, in both runs |
| text that is not JSON | no reply, and the socket stays open |
| channels past the 400th | `{"code":40107,"message":"Maximum subscriptions exceeded"}`, 64 replies for the 8 refused frames in both runs, and the first five logged all carried the fifth frame's `id` |

A closed or delisted perpetual was not available to probe, since all 396 were `tradable`.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server `public/heartbeat` every 30 s, the client answers `public/respond-heartbeat` with the same `id` within 5 s, S3 | heartbeats every 30.0 s, the first 5.1 to 27.3 s after the socket was created. The `id` is the server clock in ms. The answer gets no reply |
| protocol pings | not documented | a ping every 5.0 to 5.2 s on every socket. On sockets that answered the heartbeat, one interval in each 30 s stretched to 9.2 to 9.9 s. `ws` answers pings by itself |
| silence the server tolerates | 1000 is "Normal disconnection by server, usually when the heartbeat isn't handled properly", S1 | a socket that never answered the heartbeat was closed with code 1000 at the third heartbeat, 60 s after the first unanswered one, at 70.8 to 79.6 s on four sockets, subscribed or idle, whether or not they answered protocol pings. Sockets that answered stayed open for the full 100 s, subscribed or not |
| forced disconnect | not documented | none in 100 s |
| maintenance notice | code 1013, S1 | not observed |
| compression | not documented | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, twice |
| handshake | | 620 to 1,019 ms to open from this host |
| subscription limits | "Session subscription limit has been exceeded" is code 40107, S1 | 400 channels per connection, section 3 |
| throughput | | 396 perpetuals, `book.X.50` at 10 ms on one socket for 45 s: 868 and 972 frames per second on average, a median second of 832 and 831, a peak second of 1,805 and 1,028, 315 and 354 KB per second, 363 and 365 bytes per frame, and 14.6 and 11.7 µs of `JSON.parse` per frame |

## 6. Captured frames

Trimmed, from the second `book` run and the `anchor` run of 2026-09-22.
Snapshot arrays are cut to three levels a side.

Subscribe, seven channels in one frame.

```json
{"id": 1, "method": "subscribe", "params": {"channels": ["book.BTCUSD-PERP.50", "book.ETHUSD-PERP.50", "book.NVDAUSD-PERP.50", "book.WALUSD-PERP.50", "book.LYTEUSD-PERP.50", "book.BTC_USD.50", "book.BTCUSD-261225.50"], "book_subscription_type": "SNAPSHOT_AND_UPDATE", "book_update_frequency": 10}, "nonce": 1790114272304}
```

Acknowledgement, one per channel.

```json
{"id":1,"method":"subscribe","code":0,"channel":"book.WALUSD-PERP.50"}
```

Snapshot.

```json
{"id":-1,"method":"subscribe","code":0,"result":{"instrument_name":"ETHUSD-PERP","subscription":"book.ETHUSD-PERP.50","channel":"book","depth":50,"data":[{"asks":[["2749.62","0.2008","2"],["2749.79","0.0001","1"],["2749.90","0.0008","1"]],"bids":[["2749.61","0.0786","2"],["2749.59","0.0001","1"],["2749.44","0.2000","1"]],"t":1790114273395,"tt":1790114273346,"u":375554806244928,"cs":-1183713967}]}}
```

Delta, with a delete on each side.

```json
{"id":-1,"method":"subscribe","code":0,"result":{"instrument_name":"ETHUSD-PERP","subscription":"book.ETHUSD-PERP.50","channel":"book.update","depth":50,"data":[{"update":{"asks":[["2750.20","0","0"],["2753.11","0.2616","1"]],"bids":[["2748.12","0","0"],["2748.10","5.4582","1"]]},"t":1790114273659,"tt":1790114273655,"u":375554807336512,"pu":375554807297984,"cs":1522984915}]}}
```

Idle delta, with `u` equal to `pu` and `tt` 5 s older than `t`.

```json
{"id":-1,"method":"subscribe","code":0,"result":{"instrument_name":"NVDAUSD-PERP","subscription":"book.NVDAUSD-PERP.50","channel":"book.update","depth":50,"data":[{"update":{"asks":[],"bids":[]},"t":1790114280991,"tt":1790114275977,"u":369501268112000,"pu":369501268112000,"cs":1172986441}]}}
```

Heartbeat, and the answer the probe sent.

```json
{"id":1790114291578,"method":"public/heartbeat","code":0}
```

```json
{"id": 1790114291578, "method": "public/respond-heartbeat"}
```

Errors.

```json
{"id":11,"method":"subscribe","code":40003,"channel":"book.NOPEUSD-PERP.50","message":"Unknown symbol"}
```

```json
{"id":9,"method":"subscribe","code":40107,"message":"Maximum subscriptions exceeded"}
```

Mark and index pushes, which carry the anchor.

```json
{"id":-1,"method":"subscribe","code":0,"result":{"instrument_name":"BTCUSD-PERP","subscription":"mark.BTCUSD-PERP","channel":"mark","data":[{"v":"86176.3","t":1790114562000}]}}
```

```json
{"id":-1,"method":"subscribe","code":0,"result":{"instrument_name":"BTCUSD-INDEX","subscription":"index.BTCUSD-INDEX","channel":"index","data":[{"v":"86178.17","t":1790114562000}]}}
```

Funding, as the reply to its subscribe.

```json
{"id":1,"method":"subscribe","code":0,"result":{"instrument_name":"BTCUSD-PERP","subscription":"funding.BTCUSD-PERP","channel":"funding","data":[{"v":"-0.000004992","t":1790114525000}]}}
```

## 7. Private channels

Named for a future execution stage, from the page list of S7, not probed.
They use `wss://stream.crypto.com/exchange/v1/user` after `public/auth`, S1.

- `user.order.{instrument_name}`, `user.trade.{instrument_name}` and `user.advance_order.{instrument_name}`, each also without an instrument, `user.balance`, `user.positions`, `user.position_balance`, `user.account_risk`, `user.transactions`, and three OTC channels.
- Order entry over the socket goes through the same user socket, and CCXT Pro implements `createOrderWs`, `cancelOrderWs` and `editOrderWs`, at `server/node_modules/ccxt/js/src/pro/cryptocom.js` lines 30 to 33.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://stream.crypto.com/exchange/v1/market` for every perpetual | one socket serves every product |
| channel | `book.<rawMarketId>.50`, `book_subscription_type` `SNAPSHOT_AND_UPDATE`, `book_update_frequency` 10 | snapshot on subscribe, a strict `pu` chain, 50 levels covers the engine's 20 |
| markets per connection | 200, two connections for 396 perpetuals | the cap is 400 channels, 396 ran clean on one socket, and CoinGecko already lists 401 |
| subscribe frames | wait 1 s after the open, then one frame of up to 100 channels every 250 ms | the documented pro-rated rate limit, and a 100 channel frame was accepted |
| keepalive | answer every `public/heartbeat` with `{"id": <same id>, "method": "public/respond-heartbeat"}` | an unanswered heartbeat closes the socket at the third one |
| `maxSilenceMs` | 15,000 | protocol pings every 5 s and idle deltas every 5 s per quiet book, and `VenueFeed` counts a ping as traffic at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 97 |
| routing | `result.instrument_name` is the `rawMarketId`, `result.channel` is `book` or `book.update` | the stream name wraps the same id |
| snapshot | `channel` `book`: `resetBook` and store `u` | replace semantics |
| delta | apply only when `pu === last`, then store `u`, including for the idle delta | 0 gaps observed |
| resync | `pu !== last`, or a delta before any snapshot: `resync`, which terminates the socket and resubscribes | the engine's existing path |
| unserved stream | keep the default `firstBookWaitMs` of 10 s | the snapshot came within 1,141 ms of the ack, and an unknown symbol is refused with 40003 rather than acknowledged |
| receive time | stamp on arrival, never from `t` or `tt` | `tt` on an idle delta is 5 s old |
| checksum | leave `cs` unread | the algorithm is unpublished and no layout tried matched it |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |
| anchor | mark, index and funding from `mark.<rawMarketId>`, `index.<underlying_symbol>` and `funding.<rawMarketId>`, 1,188 channels on three connections of 396 | no REST call returns them in bulk, see [`rest.md`](./rest.md) section 8 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Common API Reference, WebSocket and REST | https://exchange-developer.crypto.com/exchange/v1/docs/api/websocket-common-api-reference | 2026-09-22 | Crypto.com Exchange API v1 | root endpoints, rate limits, number format, reason codes 40003 and 40107, termination codes, 1 s sleep, sections 1, 3, 5 |
| S2 | `book.{instrument_name}.{depth}` | https://exchange-developer.crypto.com/exchange/v1/docs/api/websocket/ws-channel-book-instrument-name-depth | 2026-09-22 | Crypto.com Exchange API v1 | channel, parameters, fields `t`, `tt`, `u`, `pu`, sections 2 to 4 |
| S3 | `public/heartbeat` and `public/respond-heartbeat` | https://exchange-developer.crypto.com/exchange/v1/docs/api/websocket/ws-market-data-client-commands-heartbeat-request | 2026-09-22 | Crypto.com Exchange API v1 | 30 s heartbeat, 5 s answer, sections 3 and 5 |
| S4 | `subscribe` | https://exchange-developer.crypto.com/exchange/v1/docs/api/websocket/ws-market-data-client-commands-market-data-subscribe-request | 2026-09-22 | Crypto.com Exchange API v1 | subscribe frame and reply, section 3 |
| S5 | `mark`, `index`, `funding`, `estimatedfunding` and `ticker` channel pages | https://exchange-developer.crypto.com/exchange/v1/docs/api/websocket/ws-channel-mark-instrument-name | 2026-09-22 | Crypto.com Exchange API v1 | channel payloads and cadence, section 2 |
| S6 | WebSocket change log and breaking change schedule | https://exchange-developer.crypto.com/exchange/v1/docs/api/websocket-change-log | 2026-09-22 | Crypto.com Exchange API v1 | 500 ms snapshot, 100 ms delta, idle empty delta, subscription limiting, sequence clarification, sections 2 to 4 |
| S7 | Documentation sitemap, private channel pages | https://exchange-developer.crypto.com/exchange/v1/sitemap.xml | 2026-09-22 | Crypto.com Exchange API v1 | private channel names, section 7 |
| S8 | CCXT Pro 4.5.68 `cryptocom.js` | `server/node_modules/ccxt/js/src/pro/cryptocom.js` | 2026-09-22 | CCXT | URL, `pu` check, order entry methods, sections 1, 4, 7 |
| P1 | `ws-probe.mjs book`, two runs at 21:48 and 21:57 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/cryptocom/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs batch`, two runs at 21:49 and 21:59 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/cryptocom/ws-probe.mjs) | 2026-09-22 | this host | subscription cap, throughput, anchor channel cadence, sections 2, 3, 5 |
| P3 | `ws-probe.mjs silence`, runs at 21:50 (70 s, no closes in that window) and 22:00 UTC (100 s) | [`ws-probe.mjs`](../../../scripts/probes/venues/cryptocom/ws-probe.mjs) | 2026-09-22 | this host | heartbeat, protocol pings, closes, section 5 |
| P4 | `ws-probe.mjs deflate`, twice, and `ws-probe.mjs anchor` at 22:02 and 22:10 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/cryptocom/ws-probe.mjs) | 2026-09-22 | this host | compression, anchor frames, sections 2, 5, 6 |
