# TokoCrypto WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 03:26 to 03:39 UTC on 2026-09-23, from the development host near Seattle.

This profile covers the public spot market data sockets of TokoCrypto (CCXT id `tokocrypto`), because the venue lists no perpetuals, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/tokocrypto/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

The central finding is that TokoCrypto's main socket is Binance's spot stream.
The catalog's 833 "type 1" symbols are hosted on Binance's matching engine, and their diff frames carry the same update ids as `wss://stream.binance.com:9443`, see section 4.
The other 17 symbols, "type 3", run on a separate engine with its own socket.

## 1. Endpoints

| symbol type | documented URL | probed |
|---|---|---|
| type 1, 833 symbols | `wss://stream-cloud.tokocrypto.site/stream`, S1 | open in 350 to 450 ms over all runs, delivers |
| type 1, raw streams | `/ws/<streamName>` and `/stream?streams=<a>/<b>`, S1 | `wss://stream-cloud.tokocrypto.site/ws` and `/stream?streams=btcusdt@depth20@100ms` deliver |
| type 1, the documentation's own example | `wss://stream-cloud.tokocrypto.site/stream/ws/bnbbtc@depth`, S1 | refused with HTTP 404 and body `Invalid request path` in both runs. The working form is `/ws/btcusdt@depth` |
| type 1, the web app's host | `wss://stream-cloud.binanceru.net`, the `binanceWssBaseUrl` of the system config, S2 | open in 357 and 428 ms, delivers the same frames |
| type 2 | `wss://www.tokocrypto.com`, S1 | the bare host answered HTTP 200 with the web page, so no socket. `wss://www.tokocrypto.com/stream` opened in 730 and 803 ms and answered a subscribe with `{"id":1}` and no data. The catalog has no type 2 symbol |
| type 3, 17 symbols | `wss://stream-toko.2meta.app`, S1, and `wss://stream-toko.2meta.app/stream` in the system config, S2 | open in 474 to 627 ms, acknowledged, and 8 and 10 of 34 streams delivered in about 50 s |
| user data | `wss://ws-api.tokocrypto.site:443/ws-api/v3`, S1 | not probed, private |

`stream-cloud.tokocrypto.site` and `stream-cloud.binanceru.net` resolved to the same eight AWS Tokyo addresses (18.182.154.57, 54.249.184.175, 57.181.217.81, 54.64.185.210, 54.178.159.27, 54.199.162.171, 54.64.139.38, 57.182.234.117) on 2026-09-23, see [`rest.md`](./rest.md) section 1.
A socket carries one engine: `btcusdt@depth@100ms` on the type 3 socket was acknowledged and sent nothing in 4 s in both runs, and `alchidr@depth@100ms`, a type 3 symbol, on the type 1 socket was acknowledged and sent nothing.

## 2. Channel matrix for public market data

| channel | stream name | speed | probed |
|---|---|---|---|
| diff depth | `<symbol>@depth@100ms` or `<symbol>@depth` | 100 ms or 1,000 ms, S1 | 490 and 491 frames in about 50 s on BTCUSDT at 100 ms. `/ws/btcusdt@depth` pushed once a second |
| partial depth | `<symbol>@depth<5, 10 or 20>` or with `@100ms` | 1,000 ms or 100 ms, S1 | `btcusdt@depth20@100ms` sent 491 and 490 frames of 20 by 20 levels in about 50 s |
| best bid and ask | `<symbol>@bookTicker` | not in the TokoCrypto documentation, real time in Binance's, S3 | 3,357 and 4,602 frames in about 50 s on BTCUSDT |
| reference price | `<symbol>@referencePrice` | named in the TokoCrypto FAQ, S1 | 49 frames in about 49 s on BTCUSDT, one a second |
| trades | `<symbol>@aggTrade`, `<symbol>@trade` | S1 | not probed |
| candles | `<symbol>@kline_<interval>` | S1 | not probed |
| mini tickers | `<symbol>@miniTicker`, `!miniTicker@arr` | 1,000 ms, S1 | not probed |
| mark, index, funding | none | | `btcusdt@markPrice` was acknowledged and sent nothing |

No mark, index or funding channel exists, because the venue has no derivatives.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The type 1 socket is described unless a row says otherwise.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL per symbol type, S1 | type 1 and type 3 each serve only their own symbols, section 1 |
| subscribe frame shape | `{"method": "SUBSCRIBE", "params": ["btcusdt@aggTrade", "btcusdt@depth"], "id": 1}`, S1 | one frame of 100 params was acknowledged once and delivered |
| unknown symbol expectation | Not publicly specified | acknowledged with `{"result":null,"id":11}` and silent. `LIST_SUBSCRIPTIONS` then lists the unknown stream |
| chunk unit and budget | Not publicly specified by TokoCrypto. Binance documents 1,024 streams per connection, 5 incoming messages a second and 300 connections per 5 minutes per IP, S3 | 200 streams in frames of 100, 50 and 50 sent 300 ms apart, all acknowledged |
| keepalive mechanism | "The websocket server will send a ping frame every 3 minutes. If the websocket server does not receive a pong frame back from the connection within a 10 minute period, the connection will be disconnected.", S1 | a protocol ping every 20 s, whose payload is a millisecond timestamp such as `1790134675605`. A socket that did not answer closed with 1008 `Pong timeout` at 76.3 s and 85.7 s |
| connection lifetime and maintenance notice | "A single connection to stream-cloud.tokocrypto.site/stream is only valid for 24 hours", S1 | not reached in 100 s. No maintenance message exists in the protocol |
| handshake and operation rate limits | Not publicly specified | no refusal at three type 1 sockets opened at once, or at 12 control frames 300 ms apart |
| public market data authentication | none | none |
| message parse and routing | combined streams wrap as `{"stream": "<streamName>", "data": <rawPayload>}`, S1 | route on `stream`. The diff also carries `data.s` as `BTCUSDT`, and the partial depth frame carries no symbol at all |
| subscribe acknowledgement shape | `{"result": null, "id": 1}`, S1 | `{"result":null,"id":1}` in 130 to 194 ms. The type 3 socket answers `{"id":1,"result":null}` |
| symbol identifier format | lowercase with no separator in stream names, S1 | `btcusdt` in the stream name, `BTCUSDT` in `data.s`, against CCXT `market.id` `BTC_USDT`. `BTCUSDT@depth@100ms` and `BTC_USDT@depth@100ms` were acknowledged and silent |
| number representation | strings, S1 | prices and sizes are decimal strings with eight decimals on crypto pairs, such as `"86620.48000000"` |
| timestamp representation | `E` event time in ms, S1 | `E` integer ms on the diff, `t` on `referencePrice`, none on the partial depth frame |
| size unit | base asset | base asset. CCXT reports no `contractSize`, and the engine turns that into 1, section 4 |
| sequence semantics | "each new event's U should be equal to the previous event's u+1", S1 | 0 breaks over 1,051 and 1,057 diff frames on four symbols, and 0 over 11,885 and 16,282 frames on 200 symbols |
| idle repeat behaviour | not documented | no empty diff. A quiet book sends nothing: ADAUSD1 went 9.8 s and 5.7 s without a frame, BTCIDR 8.3 s and 9.9 s |

## 4. The book channel in detail

### One book with Binance

The same `btcusdt@depth@100ms` stream was read from `stream-cloud.tokocrypto.site` and from `wss://stream.binance.com:9443/stream` at once.

| run | TokoCrypto frames | Binance frames | same final id `u` | TokoCrypto arrival minus Binance arrival |
|---|---:|---:|---:|---|
| 03:27 UTC | 491 | 490 | 490 | min -3, median 2, max 57 ms |
| 03:35 UTC | 490 | 489 | 489 | min -1, median 0, max 7 ms |

The REST books agree, see [`rest.md`](./rest.md) section 2.
So a TokoCrypto crypto quoted book is Binance's global spot book.
The IDR books live on the same engine and read the same at `api.binance.com`, where `BTCIDR` is `TRADING` with a permission set of six entries (`SPOT`, `TRD_GRP_234`, `TRD_GRP_235`, `TRD_GRP_245`, `TRD_GRP_253`, `MARGIN_001`) against 223 on `BTCUSDT`, see [`rest.md`](./rest.md) section 2.

### Snapshot on subscribe

The diff stream sends no snapshot.
The documented recipe buffers the diffs, reads `GET https://www.tokocrypto.site/api/v3/depth?symbol=BNBBTC&limit=1000`, drops every event with `u` at or below the snapshot's `lastUpdateId`, and starts on the event that straddles `lastUpdateId + 1`, S1.
That recipe held on all four symbols in both runs.
On BTCUSDT, 61 buffered diffs were dropped as old and the next one straddled the snapshot id.

The partial depth stream is a snapshot every 100 ms.
Its `lastUpdateId` equalled the final id `u` of a diff frame on 490 of 490 BTCUSDT frames in the second run.
A book seeded from the first `depth20@100ms` frame, then chained with diffs on `U = last + 1`, took 489 diffs with 0 gaps and never needed a second seed, because each later partial frame arrived after the diff with the same id.
This is the shape the engine's Binance futures feed already uses, a diff stream reseeded from `@depth20@100ms` at [`../../../server/src/venues/binance/binance.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/venues/binance/binance.ts) lines 21 to 25, except that the spot frames carry no `pu` and the partial frame carries no symbol.

### Delta semantics

A diff carries `e` `"depthUpdate"`, `E`, `s`, `U`, `u`, `b` and `a`.
Each level is `[price, size]`, and the size is the absolute quantity at that price, so `"0.00000000"` deletes the level, S1.
The diff covers the whole book and not a window: BTCUSDT diffs touched bids near 69,364 with the touch at 86,700, and a book grown from a 1,000 level snapshot held 1,053 to 1,073 levels per side after 40 s.

### Sequence and gap rule

```text
first event after the snapshot   U <= lastUpdateId + 1 <= u, apply, last = u
every later event                U = last + 1, apply, last = u
U > last + 1                     gap: drop the book and reseed
u <= last                        old: drop the event
```

The rule held on every diff of both runs, with 0 gaps on BTCUSDT, ETHUSDT, ADAUSD1 and BTCIDR, and 0 on 200 symbols over 45 s twice.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| diff | descending in every one of 1,057 and 1,051 frames | ascending in every one of them |
| partial depth | best first, descending | best first, ascending |
| REST depth | descending at every limit from 5 to 5,000 | ascending |

The order is not documented for the diff, so a feed applies by price.

### Level window

`depth20@100ms` holds exactly 20 levels per side on BTCUSDT, 490 and 491 frames all `20/20`.
The diff stream has no window, section "Delta semantics".

### Size unit against CCXT `contractSize`

The size is in base asset units.
CCXT sets `contractSize: undefined` on every market at `server/node_modules/ccxt/js/src/tokocrypto.js` line 823, and the engine turns a missing size into 1 at [`../../../server/src/ccxt/connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 188 to 190, which is correct for spot.

| symbol | local book id | REST id | top 20 bids equal | top 20 asks equal | run |
|---|---:|---:|---:|---:|---|
| BTCUSDT | 100530235310 | 100530235389 | 16 | 20 | 03:28 UTC |
| BTCUSDT | 100530436993 | 100530437222 | 20 | 9 | 03:36 UTC |
| ADAUSD1 | 78291753 | 78291753 | 20 | 14 of 14 | 03:28 UTC |
| ADAUSD1 | 78293019 | 78293024 | 20 | 15 of 15 | 03:36 UTC |
| BTCIDR | 282945312 | 282945312 | 20 | 20 | 03:28 UTC |
| BTCIDR | 282946829 | 282946829 | 20 | 20 | 03:36 UTC |

At the same id the maintained book equals the REST book level for level, and the BTCUSDT misses are the 79 and 229 updates that landed between the two reads.

### One-sided and empty books

ADAUSD1 held 38 to 42 bids and 14 or 15 asks, and no one-sided or empty book was seen.
What the partial depth stream sends for an empty side is Not verified.

### Idle repeats

Nothing is repeated.
A quiet book sends no diff until a level changes, section 3.
`btcusdt@bookTicker` sent 0 frames identical to the one before in 3,357 and 4,602 frames.
`depth20@100ms` never repeated a `lastUpdateId` on BTCUSDT.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `nopeusdt@depth@100ms` | `{"result":null,"id":11}` | nothing |
| `BTC_USDT@depth@100ms`, the CCXT id | `{"result":null,"id":12}` | nothing |
| `BTCUSDT@depth@100ms`, uppercase | `{"result":null,"id":13}` | nothing |
| `btcusdt@depth@50ms`, `btcusdt@depth30`, `btcusdt@depth@0ms`, `btcusdt@markPrice` | `{"result":null,"id":…}` each | nothing |
| `alchidr@depth@100ms`, a type 3 symbol | `{"result":null,"id":16}` | nothing |
| `LIST_SUBSCRIPTIONS` | the list of all eight silent streams | |
| method `FOO` | `{"error":{"code":2,"msg":"Invalid request: unknown variant \`FOO\`, expected one of …"},"id":20}` | the socket stays open |
| `SUBSCRIBE` with the string id `"abc"`, then the text `hello` 300 ms later | no reply to either | the socket closed with 1008 `Invalid request` |

Every catalog symbol had `spotTradingEnable` 1, so a closed symbol was not available to probe.
Because every subscribe is acknowledged, a feed has to notice a stream with no data on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server ping every 3 minutes, pong within 10 minutes, S1. Binance documents a ping every 20 s and a pong within a minute, S3 | pings at 7.4, 27.3, 47.3, 67.3 and 87.3 s on an idle socket, and every 20 s on every other type 1 socket. `ws` answers them by default |
| missed pongs | disconnect, S1 | a socket opened with `autoPong: false` closed with 1008 `Pong timeout` at 76.3 s and 85.7 s after open |
| silence the server tolerates | Not publicly specified | a socket that never subscribed and never sent a frame stayed open for the full 100 s in both runs while it answered pings |
| forced disconnect | 24 hours, S1 | not reached |
| maintenance notice | none | none |
| compression | Not publicly specified | text JSON frames when the client refuses deflate. When offered, the type 1 server negotiates `permessage-deflate; server_no_context_takeover; client_max_window_bits=15`, and the type 3 server `permessage-deflate;client_max_window_bits=15;server_max_window_bits=15`. Neither forces it |
| handshake | | 350 to 450 ms to open a type 1 socket, 474 to 627 ms for type 3 |
| subscription limits | Not publicly specified | 200 streams on one socket without refusal |
| throughput | | 200 USDT and USDC books at 100 ms: median 250 and 332 frames a second, peak 447 and 913, 74 and 102 KB a second, 280 and 281 bytes a frame, 12.6 and 11.5 µs `JSON.parse` a frame, 195 and 197 of 200 streams delivered in 45 s, 0 gaps |

The type 3 socket sent one ping in about 50 s in the first run and none in the second, so its cadence is Not verified.
Its diff frames add `T` and a `pu` field, the previous event's final id, as in `{"e":"depthUpdate","E":1790134514778,"T":1790134514761,"s":"VELOIDR","U":3389192213,"u":3389192222,"pu":3389192175,…}`.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays marked `…` are cut.

Subscribe and acknowledgement.

```json
{"method": "SUBSCRIBE", "params": ["btcusdt@depth@100ms", "ethusdt@depth@100ms", "adausd1@depth@100ms", "btcidr@depth@100ms", "btcusdt@depth20@100ms", "btcusdt@bookTicker", "btcusdt@referencePrice"], "id": 1}
```

```json
{"result":null,"id":1}
```

Diff, and the next diff chaining on `U = u + 1`.

```json
{"stream":"btcusdt@depth@100ms","data":{"e":"depthUpdate","E":1790134512214,"s":"BTCUSDT","U":100530416194,"u":100530416202,"b":[["86620.48000000","0.42061000"],["86620.06000000","0.00000000"],["86617.21000000","2.87186000"]],"a":[["86796.74000000","0.00000000"]]}}
```

```json
{"stream":"btcusdt@depth@100ms","data":{"e":"depthUpdate","E":1790134512314,"s":"BTCUSDT","U":100530416203,"u":100530416223,"b":[["86704.77000000","4.67823000"],["86704.76000000","0.00236000"]],"a":[["86704.78000000","0.73471000"],["86721.33000000","0.21750000"]]}}
```

Partial depth, whose `lastUpdateId` is the first diff's `u`, first two levels per side kept.

```json
{"stream":"btcusdt@depth20@100ms","data":{"lastUpdateId":100530416202,"bids":[["86704.77000000","4.67805000"],["86704.76000000","0.00224000"]],"asks":[["86704.78000000","0.73337000"],["86704.79000000","0.00384000"]]}}
```

Best bid and ask, and reference price.

```json
{"stream":"btcusdt@bookTicker","data":{"u":100530416204,"s":"BTCUSDT","b":"86704.77000000","B":"4.67811000","a":"86704.78000000","A":"0.73337000"}}
```

```json
{"stream":"btcusdt@referencePrice","data":{"e":"referencePrice","s":"BTCUSDT","r":"86699.09224517","t":1790134513012}}
```

Errors.

```json
{"result":["nopeusdt@depth@100ms","BTC_USDT@depth@100ms","BTCUSDT@depth@100ms","btcusdt@depth@50ms","btcusdt@depth30","alchidr@depth@100ms","btcusdt@markPrice","btcusdt@depth@0ms"],"id":19}
```

```json
{"error":{"code":2,"msg":"Invalid request: unknown variant `FOO`, expected one of `SUBSCRIBE`, `UNSUBSCRIBE`, `LIST_SUBSCRIPTIONS`, `SET_PROPERTY`, `GET_PROPERTY`"},"id":20}
```

The keepalive is a protocol ping frame with a millisecond timestamp payload, `1790134675605`, and the close after unanswered pings carried code 1008 and reason `Pong timeout`.

## 7. Private channels

Named from S1 for a future execution stage, not probed.

- The WebSocket API at `wss://ws-api.tokocrypto.site:443/ws-api/v3`, subscribed with a listen token from `POST /open/v1/user-listen-token`, with the events Account Update, Order Update and Stream Terminated.
- The older listen key flow, `POST`, `PUT` and `DELETE /open/v1/user-data-stream`, which the changelog of 2026-03-30 scheduled for decommissioning on 2026-04-30, and its type 3 twin under `/open/v1/private-n/user-data-stream`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
It applies only to a spot leg, since the connector finds no swap market on this venue, see [`fees.md`](./fees.md) section 9.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://stream-cloud.tokocrypto.site/stream` for type 1 symbols only | 833 of 850 symbols, and the type 3 books are thin and quiet |
| channels | `<id>@depth@100ms` plus `<id>@depth20@100ms`, where `<id>` is the CCXT `market.id` with `_` removed and lowercased | the partial frame seeds and reseeds, the diff chains on its id, 0 gaps observed |
| markets per connection | 200, which is 400 streams | 200 diff streams ran with 0 gaps, and Binance documents 1,024 streams per connection, S3 |
| subscribe frames | frames of 100 params, sent at least 200 ms apart | Binance documents 5 incoming messages a second, S3 |
| keepalive | answer the server's pings, which `ws` does by default | an unanswered socket closes at about 80 s |
| `maxSilenceMs` | 60,000 | a quiet book went 9.9 s without a frame in a 50 s run, and longer gaps on quieter pairs are likely |
| routing | the `stream` field, because the partial frame has no symbol | section 3 |
| snapshot | `depth20@100ms`: reset the book when `lastUpdateId` is above the last applied id | section 4 |
| delta | apply when `U = last + 1`, or when `U <= last + 1 <= u` right after a seed, and only inside the seeded window | the diff covers the whole book, and the Binance futures feed keeps the same window rule |
| resync | on `U > last + 1`, drop the book and wait for the next partial frame | the reseed is at most 100 ms away |
| receive time | stamp on arrival | the partial frame carries no time |
| connection refresh | reconnect before 24 hours | documented lifetime, S1 |
| deflate | keep `perMessageDeflate: false` | the server does not force it |

Such a leg would add Binance's own spot book under a second name, so its value to the engine is the IDR books and TokoCrypto's fee, not a new price.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Tokocrypto API documentation, sections General WSS information, Detailed Stream information, WebSocket API and the Price Range FAQ | https://www.tokocrypto.com/apidocs/ | 2026-09-22 | PT Aset Digital Berkat, Indonesia | URLs, stream names, ping rule, lifetime, local book recipe, error table, private channels, sections 1 to 7 |
| S2 | Tokocrypto system config | https://www.tokocrypto.com/v1/common/system-config | 2026-09-22 | Indonesia | `binanceWssBaseUrl`, `nextMeWssBaseUrl`, `binanceWssApiBaseUrl`, section 1 |
| S3 | Binance spot WebSocket streams | https://github.com/binance/binance-spot-api-docs/blob/master/web-socket-streams.md | 2026-09-22 | Binance | 20 s ping, 1,024 streams, 5 messages a second, 300 connections per 5 minutes, bookTicker, sections 2, 3, 5 and 8 |
| S4 | CCXT 4.5.68 `tokocrypto.js` | `server/node_modules/ccxt/js/src/tokocrypto.js` | 2026-09-22 | CCXT | `contractSize` undefined, no Pro class, section 4 |
| P1 | `ws-probe.mjs deflate` and `endpoints` at 03:26 UTC, `book` at 03:27 UTC, `batch` at 03:28 UTC and `silence` at 03:29 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/tokocrypto/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6, the first readings |
| P2 | `ws-probe.mjs book` at 03:35 UTC, `endpoints`, `batch`, `silence` and `deflate` from 03:36 to 03:39 UTC on 2026-09-23, the second pass | [`ws-probe.mjs`](../../../scripts/probes/venues/tokocrypto/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6, the second readings, and the partial depth seeding check |
