# OSL WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, two runs of every mode at 21:45 to 21:51 UTC and 21:58 to 22:02 UTC.

This profile covers the public market data sockets of OSL HK spot, which is the researched product, see [`fees.md`](./fees.md) section 3.
OSL HK has two public book streams: the v5 `books15` channel and the legacy v4 `orderBook` stream, and both are recorded on the sixteen axes.
The OSL Global spot socket and the socket of its delisted perpetuals are recorded in shorter sections.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/osl/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| stream | documented URL | probed |
|---|---|---|
| OSL HK v5 public | `wss://stream-hk.osl.com/ws/v5/public`, S1 | open in 752 to 874 ms over 15 sockets |
| OSL HK v4 public order book | `wss://<root>/ws/v4?subscribe=orderBook:BTCUSD,orderBook:LTCUSD` with root `trade-hk.osl.com`, S2 and S3 | open in 771 to 882 ms on the ten sockets whose open time was logged. One more, in the second session run, never completed its handshake and closed with 1006 after 75.9 s |
| OSL HK v5 private | `wss://stream-hk.osl.com/ws/v5/private`, S1 | not probed |
| OSL Global spot public | `wss://stream-api.osl.com/v2/ws/public`, S7 | open in 442 to 544 ms |
| OSL Global perpetual public | `wss://stream-api.osl.com/openapi/v1/ws`, S8 | open in 458 to 496 ms, and every perpetual is delisted, see section 9 |

Every host resolves to the same two Cloudflare addresses, see [`rest.md`](./rest.md) section 1.
The HK upgrade replies set `AWSALB` cookies, so an AWS load balancer sits behind Cloudflare.
One socket carries every HK spot pair, and there is no second family to split on.
The v4 stream takes its whole subscription in the URL and has no subscribe frame.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed on 2026-09-22 |
|---|---|---|---|
| v5 `books15` | `{"instType": "SPOT", "channel": "books15", "instId": "BTCUSD"}` | "Push 15 snapshot data", S4 | a whole 15-level snapshot per push. Median gap between pushes 257 to 1,010 ms across six pairs and two runs, minimum 27 ms, maximum 2,033 ms |
| v5 `books5` | same, `books5` | 5 levels, S4 | same cadence as `books15` on the same pair |
| v5 `ticker` | same, `ticker` | "push frequency 500ms~ 1s", S5 | 59 to 62 gaps per minute, median 1,001 and 1,002 ms, minimum 596 ms |
| v5 `trade` | same, `trade` | "up to 100 of the most recent trade executions", S6 | not probed |
| v4 `orderBook` | `orderBook:<symbol>` in the URL, acknowledged as channel `depthDiff` | "2 updates per second at a maximum depth of 50 levels per side", S2. The rate limit page says "1 updates per second at a maximum depth of 25 levels per side", S12 | a partial of up to 100 levels per side, then `insert`, `update` and `delete` messages. One or two distinct `sendTime` values per second on busy pairs |
| index, mark, funding | none | spot | none |

The v5 channels are the Bitget-style `op` and `args` protocol, the same shape OSL Global spot uses in section 9.
No v5 or v4 channel carries a sequence number.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | v4 `orderBook`, documented and probed | v5 `books15`, documented and probed |
|---|---|---|
| endpoint split axis | one URL for every spot pair, S2. Probed: 22 pairs on one URL of 431 characters | one public URL, S1. Probed: 22 pairs on one socket |
| subscribe frame shape | none, the pairs are the `subscribe` query parameter, S2 | `{"op": "subscribe", "args": [{"instType": "SPOT", "channel": "books15", "instId": "BTCUSD"}]}`, S4. Probed: one frame with six `args` got six acknowledgements, and one frame with 22 `args` delivered all 22 streams |
| unknown symbol expectation | "the subscription will be rejected with HTTP code 404, if multiple instruments are subscribed to all subscriptions are rejected if one of the instrument does not exist", S2. Probed: `NOPEUSD` and the unpublished `XRPUSD` upgraded with 101, were acknowledged, and stayed silent, and `BTCUSD,NOPEUSD` delivered `BTCUSD` | Not publicly specified. Probed: `NOPEUSD` and the unpublished `XRPUSD` were acknowledged as `subscribe` and stayed silent |
| chunk unit and budget | Not publicly specified. Probed: 22 pairs on one URL | "Connection restrictions: 100/IP, current active sessions", "Message size: Up to 64KB", S1. Probed: 22 streams in one frame |
| keepalive mechanism | "The Websockes server periodically sends a `ping` message", `{"action": "ping"}`, and the client replies `{"action": "pong"}`, S3. Probed: `{"action": "ping"}` every 5.0 s from the first seconds, 15 in 75 s. A socket that never answered stayed open 76 s in both runs | "Client needs to send a heartbeat every 30 seconds", text `ping` answered by `pong`, S1. Probed: text `ping` got text `pong` in about 180 ms. `{"op": "ping"}` and `{"id": "1", "op": "ping"}`, the shape S9 documents, got error 30002 |
| connection lifetime and maintenance notice | Not publicly specified. Probed: none in 76 s | "If there is no subscription or server does not push data within 60 seconds after connection, the system will automatically disconnect", S1. Probed: section 5 |
| handshake and operation rate limits | Not publicly specified | 100 sessions per IP, S1. Not reached |
| public market data authentication | none | none |
| message parse and routing | `table` `orderBookL2`, `action`, `symbol` | `arg.channel` and `arg.instId`, data in `data[0]` |
| subscribe acknowledgement shape | not documented. Probed: `{"event": "subscribe", "arg": {"channel": "depthDiff", "instId": "BTCUSD"}, "sessionId": "…"}`, one per pair | not documented. Probed: `{"event": "subscribe", "arg": {…}, "sessionId": "…"}`, one per arg, 180 to 190 ms after the frame |
| symbol identifier format | `BTCUSD` | `BTCUSD` |
| number representation | strings, S3. Probed: prices and sizes as strings, sizes padded to 8 or 9 decimals | strings, S4. Probed: the same padding, 9 decimals on BTC pairs and 8 on the others |
| timestamp representation | `sendTime` and `publishTime` in ms, S3. Probed: `sendTime` only, and no `publishTime` on any of the 1,214 messages of the two book runs | `ts` in ms inside `data[0]` and on the envelope, S4. Probed: both present on every frame |
| size unit | base currency | base currency |
| sequence semantics | `bookVersionId`, whose semantics are not documented, S3. Probed: see section 4 | none |
| idle repeat behaviour | `heartbeat` "every 30 seconds for each instrument if there are no updates", S3. Probed: no `heartbeat` action in the book and session runs, and a quiet pair sends nothing but the 5 s pings | not documented. Probed: an unchanged book is pushed again about once a second |

## 4. The book channels in detail

### v4 `orderBook`, the recommended stream

#### Snapshot on subscribe

The first message per pair is `"action": "partial"`, which S3 says replaces the local book.
It carried the top 100 bids and the top 100 asks at most: `BTCUSD` 100 bids and 60 or 61 asks, `ETHUSD` 100 bids and 96 or 100 asks, and `SEIUSD` 41 to 43 bids and 37 to 40 asks.
The REST full book for `BTCUSD` held 116 to 119 bids at the same hour, so the stream is a 100-level window, see [`rest.md`](./rest.md) section 5.
Every pair got exactly one partial per connection in both runs.
The partial's `sendTime` is the book's last change, not the send time: a `SOLUSD` partial was 7.8 s old on arrival and a `BTCHKD` partial 35.5 s old.

#### Delta semantics

| action | documented, S3 | probed |
|---|---|---|
| `insert` | "insert or replace the current value of that price level" | never for a level already held, over both runs |
| `update` | "insert or replace the current value of that price level" | never for a level not held |
| `delete` | "remove the price level", and "if the price level does not exist the message should be ignored" | never for a level not held. The row still carries the old `size` |

Rows are keyed by price and side, which S2 says is "guaranteed unique".
One change arrives as several messages that share a `bookVersionId`, in the order `insert`, `update`, `delete`.
In the first run's capture, 208 of 382 change groups were `insert` then `delete`, and 67 were `insert`, `update`, `delete`.
Between the messages of one group the local book holds extra levels: `BTCUSD` reached 119 bids before the group's `delete` brought it back to 100.
A feed therefore publishes only when the next `bookVersionId` arrives or the socket goes quiet, never after each message.

#### Sequence and gap rule

`bookVersionId` is a negative integer near −2,122,400,000, which reads as one engine-wide counter wrapped into a signed 32-bit number.
Within one pair it never decreased in either run, and 0 of 383 values were shared by two pairs.
Across pairs merged in arrival order it decreased 63 to 381 times, and no two consecutive messages differed by exactly 1.
Within one pair the step from one group to the next reached 6,466.
So the id orders one pair's changes but cannot reveal a missed message, and the stream has no gap rule a feed can apply.
The engine's `resync` is then only a reconnect path, for a closed or silent socket.

#### Checksum

None is documented, and no message carries one.

#### Level order on the wire

The partial lists bids best first and asks best first, as `SEIUSD` shows in section 6.
Deltas are applied by price and side, so order inside a delta does not matter.

#### Size unit

Sizes are base currency, as the REST book and the v5 channel report them.
At the end of each book run the v4 book maintained from the partial and every delta was compared with a REST read of the top 15 levels.
All 15 bids and 15 asks matched in both runs, and v5 `books15` matched on 15 and on 14 bids, where one size moved between the reads.

#### One-sided and empty books

No pair had an empty side.
Five stablecoin pairs sent their partial and nothing else for 30 s in each batch run, among them `USDTHKD`, `USDGOUSDC`, `USDGOUSD` and `USDGOHKD`.
What an empty side looks like on the wire is Not verified.

#### Unknown and closed symbols

| URL | reply |
|---|---|
| `?subscribe=orderBook:NOPEUSD` | 101, `{"event":"subscribe","arg":{"channel":"depthDiff","instId":"NOPEUSD"}}`, then nothing |
| `?subscribe=orderBook:BTCUSD,orderBook:NOPEUSD` | 101, both acknowledged, `BTCUSD` delivers |
| `?subscribe=orderBook:XRPUSD`, a catalog row with `status` `"0"` | 101, acknowledged, then only pings |
| `?subscribe=orderBook:btcusd` | 101, acknowledged as `BTCUSD`, and delivers |
| no query | 101, then only pings |
| a text frame `hello` on an open socket | no reply |

S2 promises a 404 for an unknown instrument, and the wire never sent one.

### v5 `books15`

Each push is `"action": "snapshot"` with exactly 15 bids and 15 asks on every pair probed, bids descending and asks ascending, 0 order violations.
There is no delta, no id and no checksum, so a feed replaces the whole book on every frame and has no gap to detect.
The first snapshot of a busy pair came 185 to 190 ms after the subscribe frame, and a quiet pair's first snapshot came 404 to 994 ms after it, on the next push.
An unchanged book is pushed again: 17 to 56 of 61 to 136 frames per stream repeated the previous book exactly, and every stream in the 22-pair batch pushed at least 29 times in 30 s.
The envelope `ts` minus `data[0].ts` had a median of 5 to 8 ms per stream in the second book run, and repeated books carry a new `data[0].ts`, so it is close to the push time and is not the time of the last change.
The local clock minus `data[0].ts` had a median of 101 to 105 ms, while the clock offset bound from `GET /api/v5/time` spans −106 to +96 ms, so most of that is the one-way delay.
Fifteen levels is five fewer than the engine's 20, at [`ClusterIndexBuilder.ts`](../../../server/src/engine/cluster/ClusterIndexBuilder.ts) line 17.

| request | reply |
|---|---|
| `books15` `NOPEUSD` | `{"event":"subscribe",…}`, then nothing |
| `books15` `XRPUSD`, unpublished | acknowledged, then nothing |
| `books50` `BTCUSD` | `{"event":"error","code":30001,"msg":"{\"channel\":\"books50\",\"instType\":\"SPOT\",\"instId\":\"BTCUSD\"} doesn't exist"}` |
| `instType` `MARGIN` | acknowledged, and `BTCUSD` book frames followed, so `instType` is not checked |
| `books15` `btcusd` | acknowledged with `btcusd`, and no frame arrived under that name |
| the same subscription twice | acknowledged twice, no error |
| `{"op":"foo"}` or text `hello` | error 30002 `Unrecognized request` |

## 5. Session

| item | documented | probed |
|---|---|---|
| v5 keepalive | text `ping` every 30 s, answer `pong`, S1 | `pong` in about 180 ms, as text, not JSON |
| v5 silence | disconnect after 60 s with no subscription or no data, S1 | a socket with no subscription closed at 60.8 s with 1006 and no close frame in both runs. A socket with no subscription that sent `ping` every 20 s got three `pong` replies and still closed at 65.4 and 66.1 s with 1006. A subscribed socket that never pinged stayed open the full 76 s |
| v4 keepalive | server `ping`, client `pong`, S3 | `{"action": "ping"}` every 5.0 s. No protocol-level ping on any HK socket |
| v4 silence | Not publicly specified | a socket that ignored every ping stayed open 76 s in both runs. Whether answering changes anything was not observed, because the answering socket's handshake failed in the second run and its handler missed the spaced ping text in the first |
| forced disconnect | Not publicly specified | none in 76 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames only. A client offering permessage-deflate got no `sec-websocket-extensions` back from v5, v4 or the Global spot socket |
| throughput, 22 pairs | | v5: 30 to 62 frames per second, 34 and 40 KB per second, 22 to 23 µs median `JSON.parse`. v4: 16 to 79 frames per second, 12 and 17 KB per second, 7 µs median `JSON.parse` |

## 6. Captured frames

Trimmed from the probe runs of 2026-09-22, keeping the first levels of each side.

v5 subscribe and acknowledgement.

```json
{"op": "subscribe", "args": [{"instType": "SPOT", "channel": "books15", "instId": "BTCUSD"}]}
```

```json
{"event":"subscribe","arg":{"channel":"books15","instType":"SPOT","instId":"BTCUSD"},"sessionId":"c20369fffec34ccb-00000001-00028927-1b7914eed93e3ebf-a188ce06"}
```

v5 `books15` snapshot, three of fifteen levels per side.
This first snapshot's `data[0].ts` is 743 ms before its envelope `ts`.

```json
{"action":"snapshot","arg":{"channel":"books15","instType":"SPOT","instId":"BTCUSD"},"data":[{"ts":1790113529008,"bids":[["86196.1","0.630205600"],["86189.2","2.900595400"],["86187.2","2.320530100"]],"asks":[["86197.0","1.109451600"],["86205.1","2.900060400"],["86210.4","2.319905700"]]}],"ts":1790113529751}
```

v5 ticker.

```json
{"action":"snapshot","arg":{"channel":"ticker","instType":"SPOT","instId":"BTCUSD"},"data":[{"instId":"BTCUSD","lastPr":"86202.1","open24h":"86746.7","high24h":"86746.7","low24h":"85086.9","change24h":"-0.0063","bidPr":"86196.3","askPr":"86197.1","bidSz":"0.547681200","askSz":"1.192521500","baseVolume":"177.4216441","quoteVolume":"15251502.88","openUtc":"76147.3","changeUtc24h":"0.132","ts":"1790113529967"}],"ts":1790113529970}
```

v5 errors.

```json
{"event":"error","code":30001,"msg":"{\"channel\":\"books50\",\"instType\":\"SPOT\",\"instId\":\"BTCUSD\"} doesn't exist"}
```

```json
{"event":"error","code":30002,"msg":"Unrecognized request: {\"op\":\"ping\"}"}
```

v5 keepalive, sent and received as plain text.

```text
ping
pong
```

v4 acknowledgement, keepalive and partial, the partial cut to two levels per side.

```json
{"event":"subscribe","arg":{"channel":"depthDiff","instId":"BTCUSD"},"sessionId":"a63a94fffeae1da6-00000001-0007d927-04be64d19e8676dc-beef546c"}
```

```json
{"action": "ping"}
```

```json
{"table":"orderBookL2","action":"partial","symbol":"SEIUSD","bookVersionId":-2122398906,"sendTime":1790113529966,"data":[{"symbol":"SEIUSD","side":"Buy","size":"1286.88000000","price":"0.05994"},{"symbol":"SEIUSD","side":"Buy","size":"9809.80000000","price":"0.05992"},{"symbol":"SEIUSD","side":"Sell","size":"400.00000000","price":"0.05997"},{"symbol":"SEIUSD","side":"Sell","size":"8996.22000000","price":"0.05998"}]}
```

v4 change group, an `insert` and a `delete` sharing one `bookVersionId`.

```json
{"table":"orderBookL2","action":"insert","symbol":"SEIUSD","bookVersionId":-2122396955,"sendTime":1790113539345,"data":[{"symbol":"SEIUSD","side":"Buy","size":"9480.00000000","price":"0.05993"}]}
```

```json
{"table":"orderBookL2","action":"delete","symbol":"SEIUSD","bookVersionId":-2122396955,"sendTime":1790113539345,"data":[{"symbol":"SEIUSD","side":"Buy","size":"9000.00000000","price":"0.05990"}]}
```

v4 update.

```json
{"table":"orderBookL2","action":"update","symbol":"SEIUSD","bookVersionId":-2122397205,"sendTime":1790113535963,"data":[{"symbol":"SEIUSD","side":"Sell","size":"216.49000000","price":"0.05997"}]}
```

## 7. Private channels

Named for a future execution stage, from S1, S6 and S10, not probed.
They use `wss://stream-hk.osl.com/ws/v5/private` after an `op` `login` with `apiKey`, `timestamp` and an HMAC SHA256 `sign`.

- `orders`, `fill` and `spotAssets`.
- The FIX 4.4 gateway carries order entry, drop copy and market data sessions over an `stunnel` TLS tunnel, S11.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
OSL has no perpetual, so this is the shape a future spot leg would take.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket, `wss://trade-hk.osl.com/ws/v4?subscribe=orderBook:<id>,…` with every tracked pair | 22 pairs fit one URL of 431 characters, and the stream has no subscribe frame |
| channel | v4 `orderBook` | a partial on connect, deltas keyed by price and side, and 100 levels per side against the engine's 20 |
| alternative | v5 `books15` on `wss://stream-hk.osl.com/ws/v5/public` | whole snapshots, so no book state and no gap risk, at 15 levels |
| markets per connection | all 22 | 16 to 79 frames per second observed with every pair on one socket |
| subscribe frames | none for v4. For v5, one frame with every pair in `args` | |
| keepalive | answer every `{"action": "ping"}` with `{"action": "pong"}`. For v5, send text `ping` every 20 s | S3 asks for the pong, and a v5 socket needs a live subscription as well as pings to stay open |
| `maxSilenceMs` | 15,000 for v4 | the server pings every 5 s, and a quiet pair sends nothing else |
| routing | `symbol` is the `rawMarketId` | the stream spells it as the catalog does |
| snapshot | `action` `partial`: `resetBook` | S3 |
| delta | apply `insert`, `update` and `delete` by price and side, and publish when a new `bookVersionId` arrives or no message follows within a tick | one change spans several messages |
| resync | reconnect on close or silence only | `bookVersionId` jumps within a pair, so no gap can be detected |
| receive time | stamp on arrival, never from `sendTime` | a partial carries the book's last change time, up to 35 s old |
| deflate | keep `perMessageDeflate: false` | none of the HK sockets negotiates it |

## 9. OSL Global sockets

### Spot, `wss://stream-api.osl.com/v2/ws/public`

The protocol is the same as HK v5: `books5`, `books15`, `ticker` and `trade`, `op` `subscribe`, text `ping` and `pong`, S7.
S7 says `books15` "pushes an initial 15-level snapshot, then pushes incremental 15-level data whenever depth changes", and the wire sent `"action": "snapshot"` with 15 levels on every frame, about once a second, with 12 to 14 of 14 to 17 frames per stream repeating the previous book.
In the first run, two subscribe frames sent back to back closed the socket at once.

```json
{"event":"error","code":30007,"msg":"request over limit,connection close"}
```

The same two frames on a fresh socket in both later runs were accepted, so the limit behind 30007 is Not verified.
S8 publishes "Single connection request frequency limit: 25 times/second" for the perpetual socket.
Ten of the thirteen Global pairs with a ticker stop trading on 2026-09-29, see [`fees.md`](./fees.md) section 3.

### Perpetuals, `wss://stream-api.osl.com/openapi/v1/ws`

The protocol is `{"method": "SUBSCRIBE", "params": ["btcusdc@depth50"], "id": "1"}` answered by `{"id":"1","result":null}`, S8.
It sent protocol-level pings 10 s apart, its text `ping` got `{"pong":1790113873262}`, and it negotiated permessage-deflate when offered.
Every perpetual is delisted, and the socket shows it.

```json
{"eventType":"depth50","param":"btcusdc@depth50","action":"snapshot","eventTime":1789550397163,"data":[{"symbol":"BTCUSDC","eventType":"depth50","eventTime":1789550397163,"lastUpdateId":9326165428,"bids":[],"asks":[]}]}
```

That empty book is stamped 2026-09-16 09:19:57 UTC, the day `BTC-PERP` was delisted.
`shibusdc@depth50`, `ethusdc@depth50` and the unknown `nopeusdc@depth50` were accepted with `result` `null` and never sent a frame.
`!markPrice@arr` still pushes once a second, for `BTCUSDC` and `SHIBUSDC` only, with `fundingRate` `"0.0001"` and mark equal to index on `BTCUSDC`.

```json
{"eventType":"markPrice","param":"!markPrice@arr","action":"update","eventTime":1790113868060,"data":[{"symbol":"BTCUSDC","markPrice":"86309.3","indexPrice":"86309.3","fundingRate":"0.0001","remainSec":"7732","nextFundingTime":"1790121600000","toMarkPriceUsdt":"86309.3","toIndexPriceUsdt":"86309.3"}]}
```

The `btcusdc@24hrTicker` frame reads `lastPrice` `"75518.4"`, `bidPrice` `"0"`, `askPrice` `"0"` and `count` 0.

## 10. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Stream Subscription API | https://osl.com/reference/stream-subscrition-api.md | 2026-09-22 | OSL HK | v5 URLs, heartbeat, 60 s timeout, 100 sessions per IP, 64 KB, error codes, sections 1, 3 and 5 |
| S2 | Establish Connection, v4 | https://osl.com/reference/establish-connection.md | 2026-09-22 | OSL HK | v4 URL, 2 updates per second, 50 levels, 404 on unknown instrument, price and side key, sections 1 to 4 |
| S3 | Subscribe to Market Data, v4 | https://osl.com/reference/subscribe-to-market-data.md | 2026-09-22 | OSL HK | `partial`, `insert`, `update`, `delete`, `heartbeat`, `ping` and `pong`, sections 3 and 4 |
| S4 | Orderbook Depth Channel, v5 | https://osl.com/reference/orderbook-depth-channel.md | 2026-09-22 | OSL HK | `books5` and `books15`, section 2 |
| S5 | Ticker Channel, v5 | https://osl.com/reference/market-data.md | 2026-09-22 | OSL HK | ticker cadence, section 2 |
| S6 | Transaction Channel, v5 `trade` and `fill` | https://osl.com/reference/transaction-channel.md and https://osl.com/reference/transaction-channel-1.md | 2026-09-22 | OSL HK | trade channel, private fill channel, sections 2 and 7 |
| S7 | OSL Global Websocket Overview and Order Book Depth Channel | https://docs.glb.osl.com/reference/spot-websocket-overview.md and https://docs.glb.osl.com/reference/spot-order-book-depth-channel.md | 2026-09-22 | OSL Global | Global spot URL and books, section 9 |
| S8 | OSL Global Websockets Overview, Channel Subscription, Full Depth Information, Mark Price for All Trading Pairs | https://docs.glb.osl.com/reference/websockets-overview.md | 2026-09-22 | OSL Global | perpetual socket, 25 requests per second, section 9 |
| S9 | ping, Operation List | https://osl.com/reference/operation-list.md | 2026-09-22 | OSL HK | the `{"id", "op": "ping"}` shape, section 3 |
| S10 | Private Channel, Order Channel, Spot Account Channel | https://osl.com/reference/private-channel.md | 2026-09-22 | OSL HK | login and private channel names, section 7 |
| S11 | Connectivity Details, FIX | https://osl.com/reference/connectivity-details.md | 2026-09-22 | OSL HK | FIX sessions, section 7 |
| S12 | Rate Limits | https://osl.com/reference/rate-limits.md | 2026-09-22 | OSL HK | "1 updates per second at a maximum depth of 25 levels per side", section 2 |
| P1 | `ws-probe.mjs book`, `session`, `errors`, `batch`, `global`, `deflate`, first run 21:45 to 21:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/osl/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 and 9 |
| P2 | the same six modes, second run 21:58 to 22:02 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/osl/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 and 9, the second readings |
