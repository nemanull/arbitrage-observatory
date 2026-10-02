# Backpack WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 in the local evening, which is 2026-09-23 from 03:20 UTC, from the development host near Seattle.

This profile covers the public WebSocket API of Backpack Exchange (CCXT id `backpack`) for its one perpetual family, USDC-settled linear perpetuals, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/backpack/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
All times are UTC.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| every market, spot, perpetual and prediction | `wss://ws.backpack.exchange`, S1 | open in 471 to 639 ms over every socket of both passes, 91 perpetuals delivered on one socket |

One URL carries every market, so there is no split by family.
`ws.backpack.exchange` resolved to six AWS addresses in `ap-northeast-1`, which is Tokyo, see [`rest.md`](./rest.md) section 1.
The engine timestamp `T` of a depth frame was a median 65, 49 and 66 ms before its arrival here in the three book runs, with a p90 of 53 to 76 ms per market, against a clock within 3 ms of the server's, tag `depth_stream`.
CCXT Pro uses the same URL for public and private streams, at `server/node_modules/ccxt/js/src/pro/backpack.js` lines 46 to 49.

## 2. Channel matrix for public market data

| stream | payload | depth and speed | probed |
|---|---|---|---|
| `depth.<symbol>` | deltas, S1 | every book change, "under load it may aggregate more than one update into a single event" | deltas only, no snapshot. 12,628, 12,501 and 13,105 BTC frames in 70 s, every one with `U` equal to `u` and one to three levels. Recommended, section 8 |
| `depth.200ms.<symbol>`, `depth.600ms.<symbol>`, `depth.1000ms.<symbol>` | aggregated deltas, S1 | one frame per window | `200ms`: 349, 334 and 328 ETH frames in 70 s, 200 ms apart, `U` below `u` on 329 of 349 in the first run. `1000ms` delivered on BTC. `600ms` not probed. `depth.100ms.` answers error 4008 |
| `bookTicker.<symbol>` | best bid and ask, S1 | on change | 720, 899 and 706 BTC frames in 70 s, and 266, 400 and 504 on `kSHIB`. Its `u` is the depth update id, 6730019258 in both streams at the same instant |
| `markPrice.<symbol>` | mark `p`, estimated funding rate `f`, index `i`, next funding `n` in ms, S1 | once a second | 72 frames in 70 s on each of three markets in each of three runs, all stamped on the same millisecond of each second, and sent even when nothing changed |
| `ticker.<symbol>` | 24 h statistics, S1 | "every second" | 72 or 73 frames in 70 s |
| `trade.<symbol>`, `kline.<interval>.<symbol>`, `liquidation.<symbol>`, `openInterest.<symbol>` (every 60 s), `externalTicker.<symbol>`, `stockPrice.<ticker>` | S1 | | not probed |

No channel sends a book snapshot.
The `markPrice` stream carries every anchor field except the funding interval, and it could stand in for the REST poll, see [`rest.md`](./rest.md) section 8.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | crypto and equity perpetuals on one socket |
| subscribe frame shape | `{"method": "SUBSCRIBE", "params": ["stream"]}`, "more than one in the `params` field" allowed, S1 | 91 `depth` streams in one frame all delivered, and a second frame of 7 streams on the same socket too |
| unknown symbol expectation | Not publicly specified | `depth.NOPE_USDC_PERP`, the closed `depth.TON_USDC_PERP` and `depth.5.BTC_USDC_PERP` get no reply and no frames. An unknown stream type, `nope.BTC_USDC_PERP`, answers error 4006 |
| chunk unit and budget | Not publicly specified | 91 streams in one frame, no refusal |
| keepalive mechanism | "a `Ping` frame will be sent from the server every 60s, and a `Pong` is expected to be received from the client. If a `Pong` is not received within 120s, a `Close` frame will be sent", S1 | protocol pings 60 s apart on every socket, the first 5 to 38 s after the open. No application ping exists. A client protocol ping is answered, section 5 |
| connection lifetime and maintenance notice | on shutdown the server "sends a `Close` frame to each client before closing the connection. The client should reconnect", S1 | no lifetime cap or notice seen in 120 s |
| handshake and operation rate limits | Not publicly specified | no refusal, opens of 471 to 639 ms |
| public market data authentication | none | none |
| message parse and routing | `{"stream": "<stream>", "data": <payload>}`, S1 | as documented. `data.s` is the market id, and `stream` is `depth.<id>` |
| subscribe acknowledgement shape | Not publicly specified | none. A valid `SUBSCRIBE` or `UNSUBSCRIBE` gets no reply, and data simply starts or stops. Errors are `{"id":null,"error":{"code":…,"message":…}}`, and an `id` sent in the request is not echoed |
| symbol identifier format | `SOL_USDC` in the examples | `BTC_USDC_PERP`, identical to CCXT `market.id` and the REST `symbol` |
| number representation | prices and sizes as strings, `U` and `u` as numbers, and `u` of `bookTicker` as a string, S1 | prices and sizes are strings padded to the tick and step, `"86648.0"` and `"0.00000"`. `U` and `u` are JSON numbers in both streams, so the `bookTicker` example is wrong about `u` |
| timestamp representation | `E` and `T` in microseconds, `n` of `markPrice` in ms, S1 | as documented, `"E":1790134357267289` |
| size unit | base asset quantity | base asset, `contractSize` 1 in CCXT, section 4 |
| sequence semantics | "`U` will always be `u + 1` from the previous message. If this is not the case, the client should assume that the depth has been invalidated and requery the REST API.", S1 | 0 gaps in 28,953, 28,889 and 29,747 realtime deltas on six markets over 70 s, 0 in 126,558 and 142,229 deltas on 91 markets over 45 s, and 0 in the `200ms` stream. The id is per market |
| idle repeat behaviour | depth "only changes when the depth has changed", S1 | no repeated depth frame. A quiet book sent nothing for up to 30 s. `markPrice` repeats every second whether or not a value changed |

## 4. The book channel in detail

`depth.<symbol>`, the realtime stream, is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

There is none.
The documentation says "To obtain an initial snapshot of the depth, the client should query the REST API", S1.
The first frame of every stream in all three runs was an ordinary one-level delta, 120 to 457 ms after the subscribe for the five crypto markets and 8.2 s, 13.7 s and 10.1 s after it for `AAPL.US_USDC_PERP` in the overnight session.
CCXT Pro buffers deltas and fetches the REST book after the tenth, with the comment "the rest API is very delayed", at `server/node_modules/ccxt/js/src/pro/backpack.js` lines 862 to 900.
The probe did not see that delay, since the REST book was never ahead of the buffered deltas at the first snapshot, see the table below.

### Aligning the REST snapshot

```text
L = lastUpdateId of GET /api/v1/depth?symbol=<id>&limit=1000, a string
drop every buffered delta with u <= L
the first kept delta must satisfy U <= L + 1 <= u, else fetch again
after that, apply a delta only when U = last u + 1
```

| market | REST `lastUpdateId` | buffered deltas at the reply | first delta after `L` | evidence |
|---|---|---|---|---|
| `BTC_USDC_PERP`, first run | 6729962806 | 3,035, the newest `u` 6729962840 | `U` = `u` = 6729962807 | tag `snapshot_align` |
| `BTC_USDC_PERP`, second run | 6730022585 | 3,329, the newest `u` 6730022586 | `U` = `u` = 6730022586 | same |
| `BTC_USDC_PERP`, third run | 6730297792 | 3,673, the newest `u` 6730297806 | `U` = `u` = 6730297793 | same |
| `kSHIB_USDC_PERP`, all runs | equal to the newest buffered `u` | 351, 768 and 583 | the next delta | same |

At the first snapshot the REST book was never ahead of the buffered deltas, so no delta had to be waited for.
It trailed the newest buffered BTC delta by 34, 1 and 14 updates in the three runs, and a feed simply drops the older deltas.
About 65 s later a second REST book was fetched, and the first one plus every delta up to its `lastUpdateId` was rebuilt, landing exactly on that id in five of six cases and one update short in the sixth, tag `final_compare`.
In that sixth case, the third run's BTC compare, the REST book was one update ahead: its id was 6730306716 and the newest BTC delta received was 6730306715.
So a REST book can run ahead of the socket, and a feed keeps buffering until the delta that carries `L + 1` arrives.
With levels keyed by number, in the second and third runs the rebuilt top 20 equalled the REST top 20 on 20 of 20 BTC bids and asks both times, and on 19 and 18 `kSHIB` bids and 20 of 20 asks.
The `kSHIB` book held 15 bids in both REST seeds, and the compare counted matches out of 20 positions without recording how many levels each side held, so whether the shortfall is a mismatch or a short book is Not verified.
With levels keyed by the price string, the first run rebuilt a crossed BTC book with 0 of 20 bids equal, because REST writes `"86700"` where the socket writes `"86700.0"`, so a deletion never matched its level.

### Delta semantics

"Each depth update has the absolute value of the depths at the given levels", S1.
A level is `[price, size]` as strings, and a size of zero, written `"0.00000"` at the step size, deletes it.
No delta without levels was seen in any run.

### Sequence and gap rule

```text
U = last u + 1   apply, last = u
U ≠ last u + 1   gap: the documentation says requery the REST book, the engine's resync terminates the socket
```

In the realtime stream `U` equalled `u` on every frame of all three runs, so under this load each frame was one engine event.
The id belongs to one market, since `BTC_USDC_PERP` ran near 6.73 × 10⁹ and `kSHIB_USDC_PERP` near 2.16 × 10⁸.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| realtime delta | one level on nearly every frame, and one BTC frame in each of the first and third runs carried up to three levels with bids out of descending order | one level on nearly every frame, never out of ascending order |
| `depth.200ms` delta | ascending on 308 of 308 frames with two or more bids | ascending on 218 of 218 |
| REST `depth` | ascending, best bid last, at every limit | ascending, best ask first |

A feed applies deltas by price and never by position, and it reads the REST best bid from the end of the array.

### Level window

There is none.
The stream carries changes anywhere in the book: a `depth.1000ms` frame in the first run set a BTC bid at 84,043.9 while the touch was near 86,640, about 3 % away.
So the local book grows to the whole book, and the seed should be deep, since a level the seed missed stays unknown until it changes.
The REST book at `limit=1000` reached 1,000 levels on a side for only 2 of 91 perpetuals, see [`rest.md`](./rest.md) section 5.

### Size unit against CCXT `contractSize`

| market | CCXT `contractSize` | socket and REST size at the best bid, second run | meaning |
|---|---:|---|---|
| `BTC_USDC_PERP` | 1 | `1.84699` at 86,642 | 1.84699 BTC |
| `kSHIB_USDC_PERP` | 1 | `101000` at 0.006178 | 101,000 units of 1,000 SHIB, about 624 USDC |

Sizes are base units of the market's own base, and `contractSize` 1 converts them correctly.

### One-sided and empty books

None of the 91 open perpetuals was one-sided in the REST seed, see [`rest.md`](./rest.md) section 5.
The documentation says `bookTicker` fields are "`null` when the corresponding side of the book is empty", S1.
What `depth` sends when a side empties was Not verified on the wire, and by the delta rule it would be the deletions.

### Idle repeats

Nothing is repeated on `depth`.
The longest gaps between two depth frames were 30 s on `GOOGL.US_USDC_PERP`, 28 s on `TSLA.US_USDC_PERP` and 24 s on `S_USDC_PERP` in the first 45 s batch, 19 s on `MNT_USDC_PERP` in the second, and 14.1 s, 14.5 s and 29.9 s on `AAPL.US_USDC_PERP` in the three book runs.

### Unknown, closed and wrong-level symbols

| request | reply | then |
|---|---|---|
| `depth.NOPE_USDC_PERP` | nothing | nothing in 1.5 s |
| `depth.TON_USDC_PERP`, a `Closed` market | nothing | nothing in 1.5 s |
| `depth.5.BTC_USDC_PERP` | nothing | nothing in 1.5 s |
| `depth.100ms.BTC_USDC_PERP` | `{"id":null,"error":{"code":4008,"message":"Invalid depth window"}}` | |
| `nope.BTC_USDC_PERP`, also with `"id": 9` | `{"id":null,"error":{"code":4006,"message":"Invalid stream"}}` | |
| `{"method": "FOO", …}` | `{"id":null,"error":{"code":4002,"message":"Parse error"}}` | |
| text that is not JSON | the same 4002 | the socket stays open |
| `bookTicker.BTC_USDC_PERP` twice | nothing | frames continue with no repeated `u`, so no duplicate delivery |
| `UNSUBSCRIBE` of that stream | nothing | its frames stop |

Because an unknown or closed market is silent, the feed has to notice a stream that never delivers on its own, and the REST seed is where that shows.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server `Ping` every 60 s, client `Pong` within 120 s, S1 | pings 60 s apart on every socket, the first 5 to 38 s after the open. The `ws` client answers them by default. A client protocol ping every 15 s was answered with a protocol pong 7 times out of 7, in 118 to 134 ms |
| silence the server tolerates | Not publicly specified | a socket with no subscription that did not answer its first ping closed with 1006 and no close frame when the next ping was due: ping at 16 s and close at 76.1 s, then ping at 10 s and close at 69.5 s. A subscribed socket that did not answer pings at 25 and 85 s, then at 15 and 75 s, stayed open to 120 s. Sockets that answered stayed open to 120 s with or without a subscription |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | a `Close` frame before a server shuts down, S1 | not observed |
| compression | "now supports `permessage-deflate` compression (RFC 7692). Clients that offer the extension during the handshake receive compressed frames", changelog of 2026-08-03, S1 | a client that offered it got `sec-websocket-extensions: permessage-deflate`. With `perMessageDeflate: false` the header is absent and every frame is plain JSON text |
| handshake | | 471 to 639 ms to open from this host |
| subscription limits | Not publicly specified | 91 streams on one socket, no refusal |
| CCXT keepalive | `'keepAlive': 119000` | `server/node_modules/ccxt/js/src/pro/backpack.js` line 57 |
| throughput | | 91 perpetuals on one socket for 45 s, run twice: 2,812 and 3,161 frames per second on average, median 2,265 and 2,759, peak 10,359 and 7,142, 499 and 561 KB per second, 177 bytes per frame, 4.7 and 6.3 µs `JSON.parse` per frame, 0 gaps, every stream delivered, tag `batch` |

The realtime stream sends one frame per book event, so its rate follows the market.
The `depth.200ms` stream caps each market at five frames per second, which would hold 91 markets under about 455 frames per second, at the cost of up to 200 ms of added age.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Arrays marked `…` are cut.

Subscribe, the book socket, which got no acknowledgement.

```json
{"method": "SUBSCRIBE", "params": ["depth.BTC_USDC_PERP", "depth.ETH_USDC_PERP", "depth.SOL_USDC_PERP", "depth.LINK_USDC_PERP", "depth.kSHIB_USDC_PERP", "depth.AAPL.US_USDC_PERP"]}
```

First frame of the BTC stream, an ordinary delta.

```json
{"data":{"E":1790134357267289,"T":1790134357267074,"U":6730019258,"a":[],"b":[["86655.9","1.94230"]],"e":"depth","s":"BTC_USDC_PERP","u":6730019258},"stream":"depth.BTC_USDC_PERP"}
```

A deletion on an equity perpetual.

```json
{"data":{"E":1790134370874574,"T":1790134370874401,"U":6789929,"a":[],"b":[["340.32","0.00"]],"e":"depth","s":"AAPL.US_USDC_PERP","u":6789929},"stream":"depth.AAPL.US_USDC_PERP"}
```

Aggregated delta, three levels per side kept, bids ascending.

```json
{"data":{"E":1790134357903774,"T":1790134357900446,"U":7501116422,"a":[["2766.95","6.9498"],["2766.98","22.8939"],["2766.99","0.2710"]],"b":[["2754.43","45.0537"],["2755.33","0.0000"],["2763.10","0.1579"]],"e":"depth","s":"ETH_USDC_PERP","u":7501116464},"stream":"depth.200ms.ETH_USDC_PERP"}
```

Best bid and ask, whose `u` equals the depth `u` above.

```json
{"data":{"A":"2.01178","B":"1.94230","E":1790134357267285,"T":1790134357267074,"a":"86656.0","b":"86655.9","e":"bookTicker","s":"BTC_USDC_PERP","u":6730019258},"stream":"bookTicker.BTC_USDC_PERP"}
```

Mark price, which carries the anchor fields.

```json
{"data":{"E":1790134357847601,"T":1790134357846930,"e":"markPrice","f":"0.00000625","i":"340.52","n":1790136000000,"p":"340.43","s":"AAPL.US_USDC_PERP"},"stream":"markPrice.AAPL.US_USDC_PERP"}
```

Ticker.

```json
{"data":{"E":1790134358087727,"V":"154927125.41812","c":"86625","e":"ticker","h":"86812.4","l":"85075.4","n":32259,"o":"85486.3","s":"BTC_USDC_PERP","v":"1801.83549"},"stream":"ticker.BTC_USDC_PERP"}
```

Errors.

```json
{"id":null,"error":{"code":4006,"message":"Invalid stream"}}
```

```json
{"id":null,"error":{"code":4002,"message":"Parse error"}}
```

```json
{"id":null,"error":{"code":4008,"message":"Invalid depth window"}}
```

Keepalive is a WebSocket protocol ping from the server and the client's protocol pong, with no JSON frame.

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the same URL and a `signature` array of verifying key, ED25519 signature, timestamp and window, over `instruction=subscribe&timestamp=…&window=…`.

- `account.orderUpdate` and `account.orderUpdate.<symbol>`, `account.positionUpdate` and `account.positionUpdate.<symbol>`, `account.balanceUpdate`, `account.rfqUpdate` and `account.rfqUpdate.<symbol>`.
- CCXT Pro signs the subscription at `server/node_modules/ccxt/js/src/pro/backpack.js` lines 78 to 99.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://ws.backpack.exchange`, slices of 30 markets per connection | one URL serves all. The engine's resync terminates the whole socket, and each market on it then needs a REST seed, which at 5 per second takes 6 s for 30 |
| channel | `depth.<rawMarketId>` | every book event with a strict per-market chain. `depth.200ms.<rawMarketId>` is the fallback if the realtime rate is too much for the event loop |
| subscribe frames | one frame per slice, `{"method":"SUBSCRIBE","params":["depth.BTC_USDC_PERP", …]}` | a multi-stream frame was served in full |
| seed | after subscribing, `GET /api/v1/depth?symbol=<id>&limit=1000` for each market at 5 per second, deltas buffered until the reply, then the alignment of section 4 | the stream sends no snapshot. The engine has no REST seeding path in any feed today, so this is new code in `VenueFeed` or in the Backpack subclass |
| REST level order | read bids from the end of the array | REST bids are ascending |
| price keys | `Number()` of the price, never the string | REST and socket format the same price differently |
| keepalive | leave `ws` answering server pings, and send a protocol ping every 15 s | `VenueFeed` counts ping and pong as traffic, at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) lines 97 and 98, and a quiet book went 30 s without a frame |
| `maxSilenceMs` | 45,000 | three missed client pongs |
| delta | apply only when `U === last + 1`, then store `u`. A size of zero deletes | documented rule, 0 gaps observed |
| resync | a gap, or a delta before the seed lands: reseed that one market from REST while buffering. With today's `resync`, terminate and reseed the slice | the documentation asks for a REST requery, and one market's gap need not cost the slice |
| unserved stream | a market whose REST seed fails or whose stream stays silent is logged | unknown and closed markets are acknowledged by silence |
| receive time | stamp on arrival | the engine timestamp is a median 49 to 66 ms old on arrival |
| deflate | keep `perMessageDeflate: false` | the server compresses only when asked |
| markets | skip the 17 equity perpetuals | their index can be their own book, see [`rest.md`](./rest.md) section 2 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Backpack Exchange API, Streams section and changelog, in the OpenAPI specification embedded in the page | https://docs.backpack.exchange/ | 2026-09-22 | Backpack, global | URL, subscribe shape, stream names and payloads, depth rules, keepalive, shutdown, compression, private streams, sections 1 to 7 |
| S2 | CCXT Pro 4.5.68 `backpack.js` | `server/node_modules/ccxt/js/src/pro/backpack.js` | 2026-09-22 | CCXT | URL, keepalive, snapshot delay, private signing, sections 1, 4, 5 and 7 |
| P1 | `ws-probe.mjs book`, runs at 03:27 and 03:32 UTC and in the second pass at 03:48 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/backpack/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs batch` at 03:29 and 03:49 UTC, and `deflate` at 03:27 and 03:48 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/backpack/ws-probe.mjs) | 2026-09-22 | this host | sections 3 and 5 |
| P3 | `ws-probe.mjs silence` at 03:30 UTC, and at 03:50 UTC with the added client ping socket | [`ws-probe.mjs`](../../../scripts/probes/venues/backpack/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
