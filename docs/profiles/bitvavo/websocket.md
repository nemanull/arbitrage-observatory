# Bitvavo WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 01:23 and 01:40 UTC on 2026-09-23.

This profile covers the public WebSocket API v2 of Bitvavo (CCXT id `bitvavo`) for its spot market, since Bitvavo lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitvavo/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The `book` mode ran three times, at 01:23, 01:24 and 01:29 UTC, the one-call `snapshot` mode at 01:38 and 01:40, and every other mode twice.
The first `book` run keyed its local book by the price string, which section 4 shows to be wrong, so its level compare is quoted only as the failure it shows, and its counts are quoted as usual.
Sockets were open about 8.5 minutes in total.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, every EUR and USDC market | `wss://ws.bitvavo.com/v2/`, S1, and CCXT Pro at `server/node_modules/ccxt/js/src/pro/bitvavo.js` line 55 | open in 634 to 800 ms over 17 sockets, Cloudflare addresses `104.18.39.7` and `172.64.148.249`, see [`rest.md`](./rest.md) section 1 |
| Market Data Pro, spot | `wss://ws-mdpro.bitvavo.com/v2/`, "requires authentication for all actions and subscription channels", S2 | open in 675 and 762 ms. `subscribe` and `getBook` both answer error 300 `Authentication is required for this endpoint.` |
| perpetuals, futures, options | none | none exist |

One socket carries every market of both quotes.
437 trading markets, 426 EUR and 11 USDC, were subscribed in one frame on one socket, see section 5.
Market Data Pro streams "non-conflated" updates about 47.5 ms sooner than the standard socket and numbers them with `startMdSeqNo` and `endMdSeqNo`, S3.
It needs an API key, and so an account, which this survey does not open, so it was not probed beyond its refusal.

## 2. Channel matrix for public market data

| channel or action | payload | depth and speed | probed on 2026-09-22 |
|---|---|---|---|
| `book` subscription | `{"action": "subscribe", "channels": [{"name": "book", "markets": ["BTC-EUR"]}]}` | the full book, deltas only, batched about every 100 ms per market | no snapshot on subscribe, 413 to 609 events in about 62 s on `BTC-EUR`, `ETH-EUR` and `XRP-EUR`, recommended |
| `getBook` action | `{"action": "getBook", "requestId": 1, "market": "BTC-EUR", "depth": 1000}` | 1 to 1,000 levels per side, default 1,000 on REST, S4 | the snapshot a `book` feed needs, 1,000 levels per side without `depth` |
| `ticker` subscription | `markets` list | best bid, best ask, their sizes, last price, only the fields that changed | 674, 488 and 483 frames in about 62 s on `BTC-EUR` |
| `ticker24h` subscription | `markets` list | "Every second", S9 | not probed |
| `trades`, `candles` subscriptions | `markets` list, and `interval` for candles | on trade | not probed |
| `getTickerBook`, `getTickerPrice`, `getTrades`, `getCandles`, `getMarkets`, `getAssets`, `getTime` actions | | one reply each | `getTime` answered 3 of 3, see section 5 |

The channel and action names are from S1.
No mark, index or funding channel exists, because Bitvavo publishes none, see [`rest.md`](./rest.md) section 3.
In the 01:24 and 01:29 runs the `ticker` channel sent `bestBid` with `bestBidSize` alone, `bestAsk` with `bestAskSize` alone, or `lastPrice` alone on all but 4 and 8 of its frames.
In the 01:24 run the split was 222 bid frames, 256 ask frames, 6 `lastPrice` frames and 4 with both sides, and at 01:29 it was 232, 239, 4 and 8.
So a best bid and ask feed built on `ticker` has to merge partial frames, and it has no sequence number.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for all public market data and trading, S1 | EUR and USDC markets delivered on one socket |
| subscribe frame shape | `{"action": "subscribe", "channels": [{"name": "book", "markets": ["BTC-EUR"]}]}`, S1 | 437 markets in one `markets` array got one acknowledgement listing all 437, in 168 and 159 ms |
| unknown symbol expectation | error 205 "You provided an invalid parameter value.", S5 | `NOPE-EUR` answers `{"action":"subscribe","errorCode":205,"error":"market parameter NOPE-EUR is invalid."}`. The halted `WMTX-EUR` is accepted, listed in the acknowledgement, and silent |
| chunk unit and budget | "Each WebSocket session has a limit of 5000 messages per one second", error 112, S6. A subscription costs one weight point whatever the number of markets, S7 | 437 markets in one frame, no refusal |
| keepalive mechanism | Not publicly specified | the server sends a protocol ping with payload `ping` every 50 s, at 49,992 to 50,003 ms and 99,991 to 100,008 ms after the open on all four session sockets of the second run. The first run counted 2 pings on three sockets and 1 on the fourth in 100 s. A client protocol ping is answered with a pong |
| connection lifetime and maintenance notice | "WS will stay connected" when the matching engine restarts, and the nonce then resets, S7 and S8 | no socket closed in 100 s, including one that never subscribed or sent anything. No notice seen |
| handshake and operation rate limits | 1,000 weight points a minute per IP without a key, 15 minute block and HTTP 429 with error 105 on excess, S6. A handshake answered "429 Too Many Requests" when reconnects come too fast, S7 | no refusal. Opens took 634 to 800 ms |
| public market data authentication | none on `ws.bitvavo.com`, every action on `ws-mdpro.bitvavo.com`, S1 and S2 | as documented, error 300 on Market Data Pro |
| message parse and routing | events carry `event` and `market`. Action replies carry `action`, `requestId` and `response`, S1 and S7 | as documented. A `getBook` reply echoes `requestId`, and an error reply echoes `action`, `requestId` and `market` |
| subscribe acknowledgement shape | the book page example shows `"event": "book"` with `subscriptions`, S1. The AsyncAPI spec example shows `subscribed`, S9 | `{"event":"subscribed","subscriptions":{"book":[…],"ticker":[…]}}`, listing every subscription on the socket, not only the new one |
| symbol identifier format | `BTC-EUR` | identical to CCXT `market.id` on 438 of 438 markets and to the REST `market`. `btc-eur` answers error 205 |
| number representation | prices and sizes as strings, S1 | strings. Every delta price carries trailing zeros to a fixed width, as `"75516.00"` on a 1 EUR tick or `"1.395930"`, on every one of the 3,916, 3,347, 8,721 and 162 delta levels of the four markets in the 01:29 run. The `getBook` snapshot never pads, as `"75743"` and `"1.39643"` |
| timestamp representation | `timestamp` in ns, "of the last transaction event", S1 | integer ns on every `book` event and on the `getBook` and REST snapshots |
| size unit | base currency, S4 | base currency. CCXT sets no `contractSize` for a spot market, and the engine's connector reads a missing one as 1, section 4 |
| sequence semantics | `nonce` per market, "incremented by 1 every time the order book changes". An event whose nonce is not exactly one above the local book's means the book "is out of sync", S4 and S10 | 0 gaps in 1,592, 1,659 and 1,628 events on four markets in the three `book` runs, and 0 in 46,472 and 42,557 events on 437 markets in the two `batch` runs |
| idle repeat behaviour | Not publicly specified | a quiet market sends nothing: `FUN-EUR` went 51.2 s, 44.2 s and 6.5 s without an event in the three runs. `BTC-EUR` sent an event whose level arrays equalled the previous event's 6, 30 and 6 times in about 62 s, each with a new nonce |

## 4. The book channel in detail

### Snapshot on subscribe

There is none.
The first `book` event is a delta of a few levels, 173 to 484 ms after the subscribe on `BTC-EUR` over three runs, and up to 9.1 s later on the quiet `FUN-EUR`.
The documented recipe buffers events, fetches a snapshot with the REST book or the WebSocket `getBook` action, and aligns the nonces, S10.
CCXT Pro does the same with `getBook` on the same socket after a delay of its `rateLimit`, at `server/node_modules/ccxt/js/src/pro/bitvavo.js` lines 465 to 498.

`getBook` sent right after the subscribe answered 187 to 686 ms after it, with 1,000 bids and 1,000 asks on the three busy markets and 25 or 26 bids and 78 to 81 asks on `FUN-EUR`.
By then 0 to 3 events had been buffered per market.

### Aligning the snapshot

| run | market | buffered nonces | snapshot nonce |
|---|---|---|---|
| 01:24 | `BTC-EUR` | 413289768 | 413289768 |
| 01:24 | `XRP-EUR` | 333271094, 333271095, 333271096 | 333271096 |
| 01:29 | `ETH-EUR` | 388084756, 388084757, 388084758 | 388084758 |
| 01:29 | `FUN-EUR` | none, the first event was 48191916 | 48191915 |

The snapshot always carried the nonce of the newest event already sent, so its nonce names the state after that event.
Applying only the events whose nonce is above the snapshot's gave a book that equalled a REST read at the same nonce on 25 of 25 bid levels and 25 of 25 ask levels, on `BTC-EUR`, `ETH-EUR` and `XRP-EUR`, compared as numbers, in the 01:29 run.
S10 words the check the other way round: when the snapshot's nonce is "smaller than or equal to the nonce from the first update, get a new snapshot and try again".
That rule would have refetched the `BTC-EUR` snapshot above, whose nonce equals the first buffered event's, although nothing was missing.
The rule that held on the wire is that the first event applied after the snapshot has nonce equal to the snapshot's plus one.

### Delta semantics

An event carries `bids` and `asks` arrays of `[price, size]` string pairs, where the size is the new total at that price and `"0"` deletes it, S1.
No event with both arrays empty was seen in any run.
In the 01:24 and 01:29 runs, which checked it, no event listed one price twice on one side.
The busy markets sent up to 71 to 118 levels in one event, so a 100 ms batch can move many levels at once.

### Sequence and gap rule

```text
no snapshot yet            buffer the event
snapshot nonce S arrives   drop buffered events with nonce <= S, apply the rest, last = newest applied or S
nonce = last + 1           apply, last = nonce
nonce ≠ last + 1           gap: rebuild the book from a new getBook, or terminate the socket (the engine's resync)
```

The rule held on every event of every run, with 0 gaps.
The nonce also falls back when the matching engine restarts, while the socket stays open, S7 and S8.
CCXT Pro applies an event only when its nonce is above the book's, at `server/node_modules/ccxt/js/src/pro/bitvavo.js` lines 438 to 443, with no gap check.
After a restart it would therefore ignore every event and freeze the book, which the `≠` rule above catches.

### Checksum

None is documented, and no event carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `getBook` snapshot | best first, descending, on 4 of 4 markets in every run | best first, ascending, on 4 of 4 |
| `book` delta | unordered: 238, 220 and 206 of about 600 `BTC-EUR` bid arrays per run were not descending | unordered: 161, 128 and 177 were not ascending |
| REST book | descending, 25 and 1,000 levels | ascending |

A feed applies deltas by price and never by position.

### Price keys

Delta prices are padded and snapshot prices are not, as the number representation axis shows.
A book keyed by the raw price string therefore never deletes a level that came from the snapshot.
The first `book` run did exactly that, and after 60 s its `BTC-EUR` book held a bid at 75,774 above the true best ask of 75,730.
Keyed by `Number(price)`, the two later runs held no crossed level, and the 01:29 run matched REST exactly.
The engine's `setBid` and `setAsk` take numbers, so a feed that converts with `Number()` before the call is safe.

### Level window

The stream is the full book: "We don't limit the depth for the order book event", S7.
A book built from a 1,000 level snapshot held 991 to 1,008 levels per side after 60 s.
A snapshot with fewer levels than the book leaves the feed blind to deeper levels that never change, so the snapshot should be the default 1,000.

### Size unit against CCXT `contractSize`

| market | CCXT `contractSize` | socket size at the touch, 01:29 run | REST size at the same price and nonce | unit |
|---|---|---|---|---|
| `BTC-EUR` | not set | `"0.31421135"` | `"0.31421135"` | BTC |
| `ETH-EUR` | not set | `"0.75571113"` | `"0.75571113"` | ETH |
| `XRP-EUR` | not set | `"248.125696"` | `"248.125696"` | XRP |

The unit is the base currency, and CCXT leaves `contractSize` undefined on a spot market, at `server/node_modules/ccxt/js/src/bitvavo.js` line 503.
The engine's connector reads a missing contract size as 1, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) line 175 and lines 188 to 194, which is the right multiplier here.

### One-sided and empty books

All 438 rows of `GET /v2/ticker/book` had both a bid and an ask in both runs, so no one-sided book was available to observe.
What `book` or `getBook` sends for an empty side is Not verified.

### Idle repeats

Nothing is sent on a quiet book, as the idle repeat axis shows.
On `BTC-EUR` an event could repeat the previous event's arrays with a new nonce, 6, 30 and 6 times in about 62 s.

### Unknown, closed and wrong symbols

| request | reply |
|---|---|
| `subscribe` `book` `NOPE-EUR` | `{"action":"subscribe","errorCode":205,"error":"market parameter NOPE-EUR is invalid."}` |
| `subscribe` `book` `btc-eur` | `{"action":"subscribe","errorCode":205,"error":"market parameter is invalid."}` |
| `subscribe` `book` `WMTX-EUR`, halted | accepted, listed in the `subscribed` acknowledgement, then silent |
| `subscribe` `book` `BTC-EUR` a second time | the `subscribed` acknowledgement again, and no duplicate events: every nonce step stayed 1 |
| `subscribe` channel `nope` | `{"action":"subscribe","errorCode":205,"error":"channel.name parameter is invalid."}` |
| `getBook` `NOPE-EUR` | `{"action":"getBook","requestId":90,"market":"NOPE-EUR","errorCode":205,"error":"market parameter NOPE-EUR is invalid."}` |
| `getBook` `WMTX-EUR`, halted | `{"action":"getBook","requestId":91,"market":"WMTX-EUR","errorCode":431,"error":"getBook is not available for WMTX-EUR in state HALTED"}`, a code the errors page S5 does not list |
| `getBook` `BTC-EUR` with `depth` 5000 | `{"action":"getBook","requestId":92,"market":"BTC-EUR","errorCode":205,"error":"depth parameter 5000 is invalid."}` |
| action `nope` | `{"action":"unknown","errorCode":415,"error":"Invalid action. Please check the request."}` |
| text that is not JSON | `{"errorCode":102,"error":"Invalid JSON."}`, and the socket stays open |

The same replies came in all three runs.
A halted market is acknowledged and never delivers, so the catalog has to drop markets whose `status` is not `trading`.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | server protocol ping every 50 s with payload `ping`, which the `ws` library answers. A client protocol ping every 20 s got 4 pongs in 100 s. `{"action": "getTime"}` every 30 s got 3 replies, and it costs one weight point each, S6 |
| silence the server tolerates | Not publicly specified | none reached: an idle socket that neither subscribed nor sent anything stayed open for the full 100 s in both runs, as did the other three |
| forced disconnect | the server "might slow down the message rate or as a last resort disconnect" a client that cannot keep up, S7 | none in 100 s |
| maintenance notice | releases are announced in the changelog two to four weeks ahead, S11. No socket notice is documented | none seen |
| compression | Not publicly specified | text JSON frames. A client that offers permessage-deflate gets it, as `permessage-deflate` in both runs, and a client that does not offer it, like the engine, gets plain frames |
| handshake | a handshake can answer 429 when reconnects come too fast, S7 | 634 to 800 ms to open, no refusal |
| subscription limits | 5,000 messages a second per session, error 112. No cap on sockets per account, "but the rate limit is shared between all open connections", S6 and S7 | no cap reached at 437 markets on one socket |
| throughput | about one event per market per 100 ms, S3 | 437 markets on one socket: 1,033 and 946 events a second on average, median 989 and 922, peak 1,691 and 1,499, 211 and 194 KB a second, 210 bytes per event, 13.8 and 15.8 µs of `JSON.parse` per event. 431 and 426 markets sent at least one event in 45 s. The per market gap between events had a median of 5.0 and 5.6 s and a maximum of 30.7 and 27.6 s |
| batching | "1 message / 100 ms" on the standard socket, S3 | inter-arrival per busy market: 10th percentile 97 to 99 ms, median 100 to 101 ms |
| delay | "~100 ms (batched updates)", S3 | arrival minus the event's `timestamp` was at least 74.8 to 82.6 ms and had a median of 76 to 84 ms over the three runs, with this host's clock 3 ms behind the server's, see [`rest.md`](./rest.md) section 7 |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-22.
Arrays marked `…` are cut.

Subscribe, and its acknowledgement after a second subscribe for `ticker`.

```json
{"action": "subscribe", "channels": [{"name": "book", "markets": ["BTC-EUR", "ETH-EUR", "XRP-EUR", "FUN-EUR"]}]}
```

```json
{"event":"subscribed","subscriptions":{"book":["BTC-EUR","ETH-EUR","XRP-EUR","FUN-EUR"],"ticker":["BTC-EUR"]}}
```

Snapshot request and its whole reply, from the `snapshot` mode at 01:38 UTC.

```json
{"action": "getBook", "requestId": 1, "market": "BTC-EUR", "depth": 3}
```

```json
{"action":"getBook","requestId":1,"response":{"market":"BTC-EUR","nonce":413297445,"bids":[["75521","0.05641959"],["75518","0.09937661"],["75517","0.40867668"]],"asks":[["75522","0.0235618"],["75523","0.05786289"],["75526","0.28930592"]],"timestamp":1790127496313579360}}
```

Deltas, with padded prices, a delete, and bids out of order, from the 01:24 run.

```json
{"event":"book","market":"BTC-EUR","nonce":413289768,"bids":[["74968.00","0"],["75516.00","0.00058294"],["74966.00","0.00100000"]],"asks":[],"timestamp":1790126693594483831}
```

```json
{"event":"book","market":"XRP-EUR","nonce":333271094,"bids":[["1.395930","0"],["1.395650","0"],["1.395180","0"],["1.396070","5011.229271"],["1.396060","18371.821034"],["1.395710","5011.229271"]],"asks":[["1.398990","10223.000000"]],"timestamp":1790126693585816821}
```

Partial ticker frames.

```json
{"event":"ticker","market":"BTC-EUR","bestAsk":"75744","bestAskSize":"0.09383265"}
```

```json
{"event":"ticker","market":"BTC-EUR","bestBid":"75743","bestBidSize":"0.14051168"}
```

Application time call.

```json
{"action":"getTime","response":{"time":1790127027148,"timeNs":1790127027148875310}}
```

Errors, and the Market Data Pro refusal.

```json
{"action":"getBook","requestId":91,"market":"WMTX-EUR","errorCode":431,"error":"getBook is not available for WMTX-EUR in state HALTED"}
```

```json
{"action":"subscribe","errorCode":300,"error":"Authentication is required for this endpoint."}
```

## 7. Private channels

Named for a future execution stage, from S1 and S9, not probed.
They use the same URL after an `authenticate` action signed with HMAC-SHA256.

- The `account` subscription pushes order and fill events for the markets named.
- Order entry over the socket uses `privateCreateOrder`, `privateUpdateOrder`, `privateCancelOrder`, `privateCancelOrders`, `privateAtomicCancelOrders` and `privateCancelOrdersAfter`, and account reads use `privateGetBalance`, `privateGetFees` and others.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
Bitvavo has no perpetual, so the engine would not load it today, and this shape only applies if a spot leg is ever wanted.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://ws.bitvavo.com/v2/`, for every `trading` market | one socket carries both quotes |
| channel | `book`, plus one `getBook` per market on the same socket | the channel sends no snapshot, and `getBook` avoids a second transport |
| markets per connection | 50 | 437 markets ran on one socket with 0 gaps, but the engine's `resync` terminates the socket and every market on it then needs a new `getBook`, at one weight point each. 50 bounds one resync to 50 of the 1,000 points a minute |
| subscribe frames | `{"action": "subscribe", "channels": [{"name": "book", "markets": [ … ]}]}` per slice, then `{"action": "getBook", "requestId": <n>, "market": <id>}` per market | a whole slice costs one point, S7 |
| snapshot pacing | at most 5 `getBook` a second across all sockets, so a cold start of 437 markets takes about 90 s and 437 points | an unauthenticated IP over 1,000 points a minute is blocked for 15 minutes, S6 |
| keepalive | a protocol ping every 15 s | the server's own ping comes only every 50 s, and pings and pongs count as traffic at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) lines 97 and 98. `getTime` works too and costs a point |
| `maxSilenceMs` | 45,000 | three missed pongs. A quiet market went 51 s without an event, so book events alone cannot feed the silence watch |
| routing | `event === 'book'` by `market`, `action === 'getBook'` by `response.market` | the market id is CCXT's `market.id` |
| snapshot | `resetBook` from the `getBook` reply, drop buffered events with nonce at or below its nonce, apply the rest | section 4 |
| delta | apply only when `nonce === last + 1` | documented rule, 0 gaps observed |
| resync | `nonce !== last + 1`, including a fall after a matching engine restart: `resync` | the engine's existing path |
| prices and sizes | `Number()` before `setBid` and `setAsk`, never a string key | delta prices are padded and snapshot prices are not |
| unserved market | drop markets whose `status` is not `trading` before subscribing | a halted market is acknowledged and silent, and its `getBook` fails with 431 |
| receive time | stamp on arrival | `timestamp` is the last transaction, not the publish time |
| deflate | keep `perMessageDeflate: false` | the server compresses only when asked |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitvavo WebSocket API, introduction and market data channels | https://docs.bitvavo.com/docs/websocket-api/introduction/ and https://docs.bitvavo.com/docs/websocket-api/book-subscription/ | 2026-09-22 | Bitvavo B.V. | URL, channel and action names, frame shapes, book event fields, private names |
| S2 | WS Market Data Pro API, introduction and book subscription | https://docs.bitvavo.com/docs/ws-market-data-pro-api/introduction/ | 2026-09-22 | Bitvavo B.V. | Market Data Pro URL, authentication for every action, `startMdSeqNo` |
| S3 | Stream data with WS Market Data Pro | https://docs.bitvavo.com/docs/ws-market-data-pro-sync/ | 2026-09-22 | Bitvavo B.V. | 100 ms batching of the standard socket, 47.5 ms advantage of Market Data Pro |
| S4 | Get order book, REST and WebSocket | https://docs.bitvavo.com/docs/websocket-api/get-order-book/ | 2026-09-22 | Bitvavo B.V. | `getBook` depth 1 to 1,000, nonce increments by 1, base currency sizes |
| S5 | Handle errors | https://docs.bitvavo.com/docs/errors/ | 2026-09-22 | Bitvavo B.V. | error codes 102, 105, 112, 205, 300, 415 |
| S6 | Rate limits | https://docs.bitvavo.com/docs/rate-limits/ | 2026-09-22 | Bitvavo B.V. | 1,000 points a minute, 15 minute block, 5,000 and 50 messages a second |
| S7 | Bitvavo API FAQs | https://docs.bitvavo.com/docs/faqs/ | 2026-09-22 | Bitvavo B.V. | full depth, stays connected on engine restart, subscription weight, handshake 429, no socket cap |
| S8 | Frequently asked questions about API, help center | https://support.bitvavo.com/hc/en-us/articles/39972791184401 | 2026-09-22, through the Zendesk JSON API | Bitvavo B.V. | "The nonce resets if the matching engine (ME) restarts." |
| S9 | Exchange WebSocket API AsyncAPI spec, version 2.10.0 | https://docs.bitvavo.com/api-specs/exchange-websocket-api.yaml | 2026-09-22 | Bitvavo B.V. | `subscribed` acknowledgement, `ticker24h` every second, `account` channel |
| S10 | Manage local order book | https://docs.bitvavo.com/docs/manage-order-book/ | 2026-09-22 | Bitvavo B.V. | snapshot recipe, the exactly one gap rule |
| S11 | Release management | https://docs.bitvavo.com/docs/release-management/ | 2026-09-22 | Bitvavo B.V. | changes announced two to four weeks ahead |
| S12 | CCXT Pro 4.5.68 `bitvavo.js` and CCXT 4.5.68 `bitvavo.js` | `server/node_modules/ccxt/js/src/pro/bitvavo.js`, `server/node_modules/ccxt/js/src/bitvavo.js` | 2026-09-22 | CCXT | URL, snapshot by `getBook`, the nonce check without a gap test, no `contractSize` |
| P1 | `ws-probe.mjs book`, three runs at 01:23, 01:24 and 01:29 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/bitvavo/ws-probe.mjs) | 2026-09-22 | this host | sections 2 to 4 and 6 |
| P2 | `ws-probe.mjs batch`, runs at 01:26 and 01:31 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitvavo/ws-probe.mjs) | 2026-09-22 | this host | sections 1, 3 and 5 |
| P3 | `ws-probe.mjs session`, runs at 01:26 and 01:29 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitvavo/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
| P4 | `ws-probe.mjs deflate` and `mdpro`, runs at 01:27 and 01:31 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitvavo/ws-probe.mjs) | 2026-09-22 | this host | sections 1 and 5 |
