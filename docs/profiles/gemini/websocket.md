# Gemini WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-15.

**Probed:** 2026-09-15, from the development host near Seattle.

Every probed number comes from [`gemini-ws-probe.mjs`](../../../scripts/probes/gemini-ws-probe.mjs), run from `server/` with `ws` and `perMessageDeflate: false`, between 07:19 and 07:21 UTC with a 75 s window.
The second pass reran every default section and `anchorcheck` from 19:09 to 19:12 UTC with the same window, and the hourly settlement watch across 19:00 UTC, see [`rest.md`](./rest.md) section 4.4.
Rates and cadences are one host on one date, and where the second pass differs from the morning both are given.
The fee side is in [`fees.md`](./fees.md), and the catalog and the anchor calls are in [`rest.md`](./rest.md).

## 1. Endpoints

| Socket | URL | Status in the docs | Perpetuals on the wire |
| --- | --- | --- | --- |
| Current WebSocket API | `wss://ws.gemini.com` | Production, version 0.10.7 [W1] | Yes, all 13 perpetuals on one socket (Probed), and the docs use the same URL for spot and prediction markets [W2] [W12] |
| Market Data v2 | `wss://api.gemini.com/v2/marketdata` | Archived, replaced by the new API [W7] | Yes, `l2`, `mark_price` and `funding_amount` delivered (Probed) |
| Market Data v1 | `wss://api.gemini.com/v1/marketdata/{symbol}` | Archived [W8] | Yes, one symbol per socket (Probed) |
| Multi Market Data | `wss://api.gemini.com/v1/multimarketdata?symbols=...` | Archived [W9] | Not probed |

The public URL moved from `wss://wsapi.fast.gemini.com` to `wss://ws.gemini.com` on 2026-02-24 [W11].
The GUSD and the USDC perpetuals are not split across hosts or paths, and one connection carried all 13 contracts (Probed).
CCXT Pro 4.5.68 still streams books from the archived v2 socket, `server/node_modules/ccxt/js/src/pro/gemini.js:33` and `:386`.

## 2. Channel matrix

Current socket, public streams.

| Stream | Documented | Probed on a perpetual |
| --- | --- | --- |
| `{symbol}@depth@100ms` | Differential depth, changed levels every 100 ms, optional snapshot [W2] | Delivers, recommended book channel |
| `{symbol}@depth` | Differential depth, changed levels every 1 s [W2] | Accepted, and its frames cannot be told apart from the 100 ms stream on one connection |
| `{symbol}@depth5`, `@depth10`, `@depth20` | Top N levels every 1 s [W2] | `@depth20` delivers |
| `{symbol}@depth5@100ms`, `@depth10@100ms`, `@depth20@100ms` | Top N levels every 100 ms [W2] | `@depth20@100ms` delivers |
| `{symbol}@bookTicker` | Real-time best bid and ask [W2] | Delivers, BTC median 15 ms between frames |
| `{symbol}@trade` | Real-time trades [W2] | Accepted, no trade in the window |
| `{symbol}@markPrice` | Not documented on this socket, the changelog names a "Mark Price WebSocket API" [W11] | Delivers `e: markPrice` with `p` and `i`, see section 4.8 |
| `{symbol}@fundingAmount` | Not documented on this socket | Delivers `e: fundingAmount` once a minute, see section 4.8 |
| `{symbol}@fundingRate`, `@indexPrice`, `@funding`, `@markPrice@1s` | Not documented | Rejected with `-1013 Invalid stream name` |
| `{agency}:{index}@indexPrice` | Prediction market reference prices only [W12] | Not probed |

Current socket, request methods: `ping`, `time`, `conninfo`, `list_subscriptions`, `subscribe`, `unsubscribe` and `depth` [W4].
Six of them were sent and answered from this host, `unsubscribe` was not probed, and `depth` returned a one-shot book with `lastUpdateId` (Probed).

Archived v2 socket.

| Subscription | Documented fields [W7] | Probed |
| --- | --- | --- |
| `l2` | `l2_updates` with `changes` of `[side, price, quantity]`, initial state and last 50 trades | Initial full book with 68 trades and an `auction_events` key, then updates |
| `mark_price` | `mark_price_updates` with `timestamp` in ns, `mark_price`, `spot_index` | Every 5 s on BTC, 1 s on ETH, 2 s on HYPE. Second pass medians: 5 s on BTC, 1 s on ETH, 4.9 s on HYPE, 3.5 s on AVAX |
| `funding_amount` | `funding_amount_updates` with `funding_amount`, `funding_date_time`, `funding_interval_in_minutes`, `is_realized` | On subscribe and on each minute, with two extra fields `funding_rate` and `mark_price` |
| `candles_*` | Candles | Not probed |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
Rows describe `wss://ws.gemini.com` unless they name another socket.

| Axis | Documented | Probed |
| --- | --- | --- |
| Endpoint split axis | One public URL for every product [W1] [W4] | 13 perpetuals on one connection |
| Subscribe frame shape | `{"id":"1","method":"SUBSCRIBE","params":[...]}`, lowercase `subscribe` also accepted [W3] [W4] | `{"id":1,"method":"subscribe","params":["btcgusdperp@depth@100ms"]}` accepted |
| Unknown symbol expectation | Error response with `status` and `error.code`, `-1013` is invalid parameters [W3] | `{"id":4,"status":400,"error":{"code":-1013,"msg":"Invalid stream name: nosuchperp@depth@100ms"}}`, and a frame with one bad stream rejects the whole frame |
| Chunk unit and budget | Not publicly specified | `conninfo` reports `REQUEST_WEIGHT` 7,000 per 10 s, 13 streams in one frame accepted |
| Keepalive mechanism | A `ping` method exists [W4], the SDK pings every 30 s with a 10 s timeout by default [W6] | The server sends a protocol ping every 20 s, and `{"id":100,"method":"ping"}` is answered with `{"id":100,"status":200}` in 64 to 65 ms, and 75 to 78 ms in the second pass |
| Connection lifetime and maintenance notice | Not publicly specified | A connection with no subscription and no client traffic stayed open for 130 s, and no notice frame was seen |
| Handshake and operation rate limits | `-1003` rate limit exceeded maps to HTTP 429 [W3], no number published | `conninfo`: `CONNECTION_ATTEMPTS` 300 per 5 minutes, `REQUEST_WEIGHT` 7,000 per 10 s |
| Public market data authentication | None [W1] [W10] | None needed |
| Message parse and routing | `e` names the event, and partial depth, book ticker and trade frames carry no `e` and must be identified by subscription [W3] | `depthUpdate` routes on `s`, and partial depth frames do carry a `symbol` key, see section 4.9 |
| Subscribe acknowledgement shape | `{"id":"1","status":200}` [W3] | `{"id":1,"status":200}`, and with `snapshot` set the snapshots arrive before it |
| Symbol identifier format | Examples use lowercase `btcusd` [W2] | `s` is lowercase `btcgusdperp`, equal to CCXT `market.id`, and an uppercase subscribe is routed with lowercase `s`, while v2 accepts uppercase only |
| Number representation | Decimal strings [W4] | Strings padded with trailing zeros, `"77401.500"` and `"0.0000"`, where REST sends `"77395.0"` |
| Timestamp representation | `E` in nanoseconds [W2] | `E` is a JSON integer in ns such as `1789456740173524809`, above 2^53, so `JSON.parse` keeps it only to about the millisecond |
| Size unit | `quantity` [W2] | Base units, equal to the REST book on 33 of 33 BTC levels and 20 of 20 TRUMP levels, one contract is one base unit |
| Sequence semantics | `U` first and `u` last update id [W2], gap when `U` skips ahead of the last applied `u` [W4] [W12], overlap at `U == lastUpdateId` [W5] | `U` equalled the previous `u` on all 1,161 deltas over 13 symbols, 0 gaps. Second pass: all 4,328 deltas, 0 gaps |
| Idle repeat behaviour | Partial depth is periodic [W2] | The differential stream sends nothing while a book is idle, up to 28.4 s on AVAX in the morning and 3.5 s at most in the busier second pass, while `@depth20@100ms` repeated TRUMP byte for byte 735 times in 756 frames, and 617 in 767 |

## 4. The book channel in detail

### 4.1 Snapshot on subscribe

The `snapshot` connection parameter controls it [W1].
`snapshot=-1` sends the full book, a positive N sends the top N levels, and `0` or no parameter sends no snapshot [W1].
There is no separate snapshot message, and the first `depthUpdate` after subscribing carries absolute levels [W4] [W12].

Probed:

- With `snapshot=-1` all 13 symbols received a first frame with absolute levels, `U == u`, 66 to 68 ms after the subscribe frame, and 78 to 79 ms in the second pass.
- The acknowledgement arrived at 67 ms, after the snapshots, and at 79 ms after them in the second pass, so a feed cannot wait for the ack before expecting the snapshot.
- With `snapshot=20` the BTC and ETH first frames were the same full books, because neither book held 20 levels.
- With `snapshot=0` the acknowledgement came first and the first depth frame was a delta with `U < u`.
- The snapshot carries no marker, so the feed must treat the first frame per symbol after each subscribe as the snapshot.

### 4.2 The whole book is shallower than 20 levels

At subscribe with `snapshot=-1` every perpetual book held fewer than 20 levels per side (Probed).

| Symbol | Bids | Asks | Worst bid | Worst ask |
| --- | ---: | ---: | --- | --- |
| btcgusdperp | 17 | 16 | 1.000 for 1.0000 BTC | 140000.000 for 0.0100 BTC |
| ethgusdperp | 17 | 13 | 2.2500 | 5000.0000 |
| solgusdperp | 11 | 9 | 1.970 | 500.000 |
| xrpgusdperp | 10 | 7 | 0.0120 | 3.5000 |
| hypegusdperp | 8 | 6 | 1.0000000 | 800.0000000 |
| avaxgusdperp | 7 | 5 | 0.160000 | 7.566000 |
| trumpgusdperp | 6 | 12 | 0.100000 | 50.000000 |

Each USDC twin showed the same counts.
The second pass read BTC 17 and 17, ETH 14 and 13, SOL 11 and 9, XRP 8 and 8, HYPE 8 and 5, AVAX 7 and 5, and TRUMP 5 and 11, again under 20 on every side, with the same far levels.
The far levels are resting orders a long way from the touch, and they are part of the book the engine would hold.

### 4.3 Delta semantics

Each level is `[price, quantity]`, and quantity zero removes the level [W2].
The quantity is the new absolute size at that price (Probed, the maintained books matched the REST book level for level).

### 4.4 Sequence and gap rule

Documented rule: apply frames in order, `u` is the last applied id, and a frame whose `U` is above the last applied `u` is a gap that needs a resubscribe [W4].
The SDK spells it out: `u <= last` is stale, `U <= last < u` is contiguous, `U > last` is a gap, and the stream overlaps at `U == last` [W5].

Probed over 75 s on all 13 perpetuals:

| Check | Result |
| --- | --- |
| Deltas with `U` equal to the previous `u` | 1,161 of 1,161 |
| Gaps, `U` above the previous `u` | 0 |
| Stale frames, `u` at or below the previous `u` | 0 |
| Frames with `u < U` | 0 |
| Book crossed after applying a delta | 0 |

The second pass over 75 s gave 4,328 of 4,328, and 0 on every other row.

The ids of different symbols come from one increasing range.
The TRUMP book ticker carried `u` 1764527605192164 while the BTC snapshot carried 1764527605192163, so a symbol's `u` jumps by many between its own frames.
Only `U` against that symbol's last `u` is a continuity check.
The ids are below 2^53, so they parse exactly as JSON numbers.

### 4.5 Level order on the wire

- Snapshot: bids strictly descending and asks strictly ascending on 13 of 13 symbols (Probed).
- Deltas: levels are not sorted inside a frame, BTC had 49 unsorted bid frames and 53 unsorted ask frames out of 120, and 311 and 308 out of 422 in the second pass (Probed).
- The REST book is strictly descending bids and strictly ascending asks, see [`rest.md`](./rest.md) section 5.

### 4.6 Size unit against CCXT

CCXT reports no `contractSize` for these markets, so the connector uses 1, see [`rest.md`](./rest.md) section 2.
The socket size is in base units.
Midway through the window the maintained BTC book equalled `/v1/book/btcgusdperp` on 33 of 33 levels, TRUMP on 20 of 20, and ETH on 28 of 30, where ETH moved between the two reads (Probed).
The second pass matched BTC on 22 of 24 REST levels, every matched level with an equal size, TRUMP on 18 of 18 and ETH on 27 of 27 (Probed).
One contract is one base unit, since `open_interest` of 18.2696 times the mark of 77,244.69 gives the reported `open_interest_notional` of 1,411,229.5883 (Probed).
So a contract size of 1 is correct.

### 4.7 One-sided and empty books, idle repeats, unknown and closed symbols

- No perpetual book was one-sided or empty during the probe, so the wire shape of an empty side is Not verified.
- The differential stream sent no frame and no empty frame while a book was idle, with a longest silence of 28.4 s on AVAX, 17.9 s on TRUMP and 5.8 s on BTC in the morning, and 2.7 s, 3.5 s and 1.8 s in the second pass (Probed).
- An unknown symbol is refused at subscribe with `-1013`, as quoted in section 6.
- No perpetual was closed, so a closed symbol's behaviour is Not verified.
- Two differential streams for one symbol on one connection, `@depth` and `@depth@100ms`, send frames with the same `e` and `s`, and 14 of the 160 BTC frames repeated the previous frame byte for byte, and 2 of 502 in the second pass, so a feed must subscribe only one of them (Probed).

### 4.8 Mark and funding streams

These are not book channels, and the recommended anchor source is discussed in [`rest.md`](./rest.md) section 3.

`@markPrice` on the current socket is undocumented.
Its `p` matched the REST mark within 0.12 %, taken seconds apart.
Its `i` is not the index at the index's scale.

| Symbol | `i` over the REST `index_price` |
| --- | --- |
| btcgusdperp | 100.03 |
| ethgusdperp | 10.003 |
| xrpgusdperp | 1000.5 |
| trumpgusdperp | 0.0100 |

HYPE and SOL `i` values were also off by a power of ten against their prices (Probed).
The second pass gave the same ratios on BTC, ETH and TRUMP, 1,006 on XRP read seconds apart, and `i` of 0.7342 against a 7.34 AVAX price, 7.711 against 77.08 on HYPE and 9,822 against 98.18 on SOL.
AVAX sent no `@markPrice` frame in 75 s and one `mark_price_updates` frame on v2 in the morning, and 21 and 22 frames in the second pass, so a quiet symbol can go a minute without a mark frame.
So `i` is unusable without a per-symbol scale Gemini does not publish.

`@fundingAmount` on the current socket is undocumented.
It sent one frame per symbol at the minute, with `T` the next settlement in ns, `i` 60, `f` the amount, `r` a rate, `p` the mark and `R` false (Probed).

### 4.9 Partial depth frames

Documented: partial depth payloads carry no `e`, and the consumer identifies them by the stream it subscribed to [W3].
On the wire they carry a `symbol` key, as in `{"lastUpdateId":1764527605192164,"symbol":"trumpgusdperp","bids":[...],"asks":[...]}` (Probed).
The wire is what a feed must handle.
They are not recommended, because they repeat unchanged books and have no delta chain.

## 5. Session

| Item | Value | Evidence |
| --- | --- | --- |
| Keepalive from the server | Protocol ping every 20 s, answered by `ws` automatically | Probed on every connection, for example at 20,208, 40,208 and 60,208 ms after open |
| Application ping | `{"id":n,"method":"ping"}` answered `{"id":n,"status":200}` | [W4], Probed, 64 to 65 ms |
| Silence the server tolerates | A connection with no subscription and no client message stayed open 130 s, in both runs | Probed, the limit is Not publicly specified |
| Forced disconnects | None seen in 130 s, no published lifetime | Probed, Not publicly specified |
| Maintenance notice | None documented, none seen | Not publicly specified |
| Compression | None, `permessage-deflate` not negotiated even when offered, all frames text | Probed on both hosts |
| Connection attempts | 300 per 5 minutes | Probed `conninfo` |
| Request weight | 7,000 per 10 s | Probed `conninfo` |
| Streams per connection | Not publicly specified | 20 streams listed on one connection in the probe |
| Close code on client close | 1005 on the current socket, 1000 on v2 | Probed |
| Archived v2 keepalive | `{"type":"heartbeat","timestamp":...}` every 5 s, no protocol ping | Probed |
| Archived v1 sequence | `socket_sequence` from 0, +1 per message, reset on reconnect [W8] | Probed, 0 to 119 without a gap in 12 s, and 0 to 885 in the second pass |

Traffic for the recommended subscription, all 13 perpetuals on `@depth@100ms`, was 15.7 frames per second and 3,965 bytes per second in the morning, and 58 frames and 18,566 bytes per second in the second pass (Probed).
ETH was the busiest at 3.79 frames per second, and TRUMP the quietest at 0.27, and 8.15 and 1.91 in the second pass.
The shortest interval between two frames of one symbol was 80 to 100 ms in the morning, but 6 to 78 ms in the second pass, with AVAX at 6 ms and BTC at 35 ms, so the 100 ms batching is not a floor between frames.
Receipt time minus `E` on the first deltas was 43 to 159 ms, and 53 to 151 ms in the second pass.
The server `time` reply was 0.5 ms from the local midpoint of its 67 ms round trip, so the local clock was close to the server's.

## 6. Captured frames

Subscribe on `wss://ws.gemini.com?snapshot=-1`, trimmed to two of the 13 streams, and its acknowledgement, which arrived after the snapshots.

```json
{"id":1,"method":"subscribe","params":["avaxgusdperp@depth@100ms","btcgusdperp@depth@100ms"]}
```

```json
{"id":1,"status":200}
```

The AVAX snapshot, complete, 418 bytes.

```json
{"e":"depthUpdate","E":1789456740173524809,"s":"avaxgusdperp","U":1764527605191349,"u":1764527605191349,"b":[["7.487000","140.40000"],["7.479000","570.50000"],["7.457000","680.90000"],["7.415000","2161.00000"],["7.407000","56.10000"],["0.350000","300.00000"],["0.160000","10000.00000"]],"a":[["7.503000","142.60000"],["7.510000","547.50000"],["7.533000","681.50000"],["7.559000","56.20000"],["7.566000","2110.70000"]]}
```

Two consecutive ETH deltas, where the second `U` equals the first `u`.

```json
{"e":"depthUpdate","E":1789456742337187316,"s":"ethgusdperp","U":1764527605192323,"u":1764527605192686,"b":[["2482.5500","0.000"]],"a":[["2483.5000","0.000"],["2483.4500","1.047"]]}
```

```json
{"e":"depthUpdate","E":1789456742362015387,"s":"ethgusdperp","U":1764527605192686,"u":1764527605192712,"b":[["2482.5500","1.047"]],"a":[]}
```

The same two ETH frames arrived under `ethusdcperp` with identical `E`, `U`, `u` and levels.

Application keepalive and its answer.

```json
{"id":100,"method":"ping"}
```

```json
{"id":100,"status":200}
```

Errors: an unknown symbol, an unknown method, and an undocumented stream name.

```json
{"id":4,"status":400,"error":{"code":-1013,"msg":"Invalid stream name: nosuchperp@depth@100ms"}}
```

```json
{"id":11,"status":400,"error":{"code":-1020,"msg":"Unsupported operation"}}
```

```json
{"id":10,"status":400,"error":{"code":-1013,"msg":"Invalid stream name: btcgusdperp@markPrice@1s"}}
```

Rate limit report from `conninfo`.

```json
{"id":7,"status":200,"rateLimits":[{"rateLimitType":"REQUEST_WEIGHT","interval":"SECOND","intervalNum":10,"limit":7000,"count":33},{"rateLimitType":"ORDERS","interval":"SECOND","intervalNum":10,"limit":3500,"count":0},{"rateLimitType":"ORDERS","interval":"DAY","intervalNum":1,"limit":10000000,"count":0},{"rateLimitType":"CONNECTION_ATTEMPTS","interval":"MINUTE","intervalNum":5,"limit":300,"count":2}]}
```

Undocumented mark and funding frames on the current socket, where BTC `i` is 100 times the REST index.

```json
{"e":"markPrice","E":1789456746446652397,"s":"btcgusdperp","p":"77303.727","i":"7725880.833"}
```

```json
{"e":"fundingAmount","E":1789459200000000000,"s":"btcgusdperp","T":1789459200000000000,"i":60,"f":"7.90688","r":"0.01000","p":"77302.223","R":false}
```

Archived v2 mark, funding and heartbeat frames.

```json
{"changes":[{"mark_price":"77233.302","spot_index":"77188.41867","timestamp":1789456071687541147}],"symbol":"BTCGUSDPERP","type":"mark_price_updates"}
```

```json
{"changes":[{"funding_amount":"9.25568","funding_date_time":1789459200000000000,"funding_interval_in_minutes":60,"funding_rate":"0.011","is_realized":false,"mark_price":"77260.531","timestamp":1789456071687573598}],"symbol":"BTCGUSDPERP","type":"funding_amount_updates"}
```

```json
{"timestamp":1789456747150,"type":"heartbeat"}
```

An archived v2 subscribe with an unknown or lowercase symbol.

```json
{"reason":"NoValidTradingPairs","result":"error"}
```

## 7. Private channels

For a future execution stage only.
All of them need HMAC headers or an OAuth bearer token on the upgrade to `wss://ws.gemini.com`, from an account-scoped key with a time-based nonce [W10].

- `orders@account` and `orders@session` for order events [W2].
- `balances@account` and `balances@account@1s` for balances [W2].
- `positions@account` and `positions@account@1s`, documented for event contract positions [W12], and whether they carry perpetual positions is Not verified.
- Methods `order.place`, `order.cancel`, `order.cancel_all` and `order.cancel_session` [W4].
- The archived private socket was `wss://api.gemini.com/v1/order/events` [W8].

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

- URL plan: one URL, `wss://ws.gemini.com?snapshot=-1`, for every family.
- Markets per connection: all tracked perpetuals on one connection, since the venue lists 13 and no stream cap is published.
- Twins: keep one of each GUSD and USDC pair, because the two symbols publish the same book, see [`rest.md`](./rest.md) section 2.
- Subscribe frame: `{"id":1,"method":"subscribe","params":["btcgusdperp@depth@100ms", ...]}`, every name lowercase from `market.id`, and never a name the catalog did not return, because one bad name rejects the whole frame.
- `handleMessage`: frames with `id` are control replies, and a `status` other than 200 is logged, while `e === "depthUpdate"` routes on `s`.
- Snapshot: mark every subscribed symbol as awaiting a snapshot on open, and treat its first `depthUpdate` as absolute levels through `resetBook`, whether or not the ack has arrived.
- Deltas: apply when `U <= lastU < u`, drop when `u <= lastU`, and call `resync` when `U > lastU`, then set `lastU = u`.
- Levels: sort nothing on apply, since `setBid` and `setAsk` key by price, and parse prices with `Number` because of the zero padding.
- Keepalive: the server's 20 s protocol ping already refreshes `lastMessageAt` in [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 93, and an application `{"id":n,"method":"ping"}` every 20 s adds a reply the feed can see.
- `maxSilenceMs`: 60,000, three missed server pings, because a quiet book stayed silent 28.4 s.
- Resync: terminate and resubscribe as `VenueFeed.resync` does, or send the `depth` request method for one symbol, which the probe showed answers with a `lastUpdateId` book.

## 9. Source ledger

| Id | Title | URL | Retrieved | Entity or region | Sections supported |
| --- | --- | --- | --- | --- | --- |
| W1 | WebSocket API Introduction, version 0.10.7 | https://developer.gemini.com/websocket/introduction.md | 2026-09-15 | Gemini API | 1, 3, 4.1 |
| W2 | Stream Reference | https://developer.gemini.com/websocket/streams.md | 2026-09-15 | Gemini API | 2, 3, 4, 7 |
| W3 | Message Format | https://developer.gemini.com/websocket/message-format.md | 2026-09-15 | Gemini API | 3, 4.9 |
| W4 | WebSocket AsyncAPI specification 0.10.7 | https://developer.gemini.com/specs/asyncapi/websocket.yaml | 2026-09-15 | Gemini API | 2, 3, 4.1, 4.4, 5, 7 |
| W5 | TypeScript SDK, Deep Dive, Order Book Reconstruction | https://developer.gemini.com/tools/typescript-sdk/deep-dives/order-book.md | 2026-09-15 | Gemini API | 3, 4.4 |
| W6 | TypeScript SDK, Deep Dive, WebSocket Sessions | https://developer.gemini.com/tools/typescript-sdk/deep-dives/websocket-sessions.md | 2026-09-15 | Gemini API | 3 |
| W7 | Market Data v2 (Archived) | https://developer.gemini.com/websocket/archived/v2.md | 2026-09-15 | Gemini API | 1, 2 |
| W8 | Market Data v1 (Archived) | https://developer.gemini.com/websocket/archived/v1.md | 2026-09-15 | Gemini API | 1, 5, 7 |
| W9 | Multi Market Data (Archived) | https://developer.gemini.com/websocket/archived/multi-market-data.md | 2026-09-15 | Gemini API | 1 |
| W10 | WebSocket Authentication | https://developer.gemini.com/websocket/authentication.md | 2026-09-15 | Gemini API | 3, 7 |
| W11 | Revision History | https://developer.gemini.com/changelog/revision-history.md | 2026-09-15 | Gemini API | 1, 2 |
| W12 | Prediction Markets Stream Reference, which states the shared depth snapshot and gap rule | https://developer.gemini.com/trading/websocket/streams.md | 2026-09-15 | Gemini API, prediction markets | 2, 3, 4.1, 7 |
| C1 | CCXT Pro gemini class 4.5.68 | `server/node_modules/ccxt/js/src/pro/gemini.js` lines 33 and 386 | 2026-09-15 | CCXT | 1 |
