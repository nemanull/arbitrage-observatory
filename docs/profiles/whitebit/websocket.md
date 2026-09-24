# WhiteBIT WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle.

This profile covers the public WebSocket API of WhiteBIT (CCXT id `whitebit`) for every perpetual family, with the `depth` book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/whitebit/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Every probe mode ran twice, and the book mode three times, at 21:38 to 21:59 UTC, with sockets open about nine and a half minutes in total.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| every market: spot, margin, crypto perpetuals and TradFi perpetuals | `wss://wss.whitebit.com/ws`, "Current. Use for all connections.", S1 | opened in 519 to 577 ms, and one socket carried four perpetuals and `BTC_USDT` spot together, and in another run all 397 perpetuals |
| the same, legacy host | `wss://api.whitebit.com/ws`, "Deprecated September 1, 2026. Rejects connections from March 1, 2027.", S1 | opened in 487 and 473 ms, answered a ping and served a `BTC_PERP` snapshot on 2026-09-22 |
| EU platform | `wss://api.whitebit.eu/ws`, in the docs' region switch, which the docs ship turned off | not probed |

One socket carries every product, so there is no family split.
CCXT Pro 4.5.68 still points at the deprecated host, `'ws': 'wss://api.whitebit.com/ws'` at `server/node_modules/ccxt/js/src/pro/whitebit.js` line 30, which stops working on 2027-03-01.
Both hostnames resolved to the same two Cloudflare addresses, and the upgrade replies carried `server: cloudflare` with a `cf-ray` ending in `YVR` or `SEA`, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | subscribe params | depth and speed | probed on 2026-09-22 |
|---|---|---|---|
| `depth` | `[market, limit, price_interval, multi_depth]`, one market per request, S2 | `limit` one of 1, 5, 10, 20, 30, 50, 100. "The server pushes incremental deltas every 100ms", and a full snapshot after 10 s without an update | snapshot then deltas at 20, 50 and 100 levels, recommended |
| `bookTicker` | `[market]`, or `[]` for every market, S3 | "pushed instantly on every best bid or ask change" | 20, 32 and 48 frames in 70 s on `BTC_PERP` in three runs |
| `premiumIndex` | `[]` for every perpetual in one message, or named markets for one message each, S4 | "pushes a fresh snapshot every 0.5 seconds, regardless of whether any value changed" | 140 or 141 messages in 70 s, 404 records each, about 33 KB a message |
| `market`, `market_today`, `lastprice`, `trades`, `candles` | market lists | `market` pushes 24 h statistics every second and `lastprice` pushes every second, S1 and S10 | not probed |
| `depth_request`, `market_request` and other `_request` methods | one-time queries | | not probed |

The channel names, parameters and cadences are from S1 to S5.
The `premiumIndex` channel carries mark, index, funding rate and next settlement for every perpetual, and it is the socket twin of the REST anchor call, see [`rest.md`](./rest.md) section 3.
Its values change on a 5 s grid although it pushes every 0.5 s: the count of perpetuals whose index changed between two pushes had a median of 0, and a maximum of 105 and 132 in two runs.
It pushed 404 records where REST lists 397, the extra seven being `HOOK_PERP`, `MKR_PERP`, `OMNI_PERP`, `RDNT_PERP`, `IP_PERP`, `ICX_PERP` and `PI_PERP`, which no REST catalog lists.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one host for every channel, S1 | spot and perpetuals shared one socket, section 1 |
| subscribe frame shape | JSON-RPC `{"id": 12, "method": "depth_subscribe", "params": ["ETH_BTC", 100, "0", true]}`, one market per `depth` request, S2 | one acknowledgement per request, and 397 requests sent in 6 ms were all acknowledged |
| unknown symbol expectation | "standard" error codes, where code 1 is `invalid argument`, S5 | `depth_subscribe` on `NOPE_PERP` answered code 9 `market NOPE_PERP does not exist`, a code the docs do not list |
| chunk unit and budget | "Active subscriptions per connection: None", "Markets per subscription request: None", 12,000 requests per 10 s per connection, S5 | 397 `depth` subscriptions on one socket, all acknowledged, every snapshot within 1,625 and 1,576 ms of the socket opening |
| keepalive mechanism | client JSON-RPC `ping` every 50 s, answered `{"id": 0, "result": "pong", "error": null}`. "The server closes the WebSocket connection after 60 seconds of inactivity. Inactivity means no messages sent by the client.", S5 | the server sent no protocol ping on any socket. `pong` came back in 156 to 176 ms. A socket that never sent anything closed at 60.57 and 60.51 s with 1006 and no close frame |
| connection lifetime and maintenance notice | none in-band. The host migration was announced in the changelog, S6 | no forced disconnect on sockets held up to 76 s |
| handshake and operation rate limits | "New connections 1,000 per minute", "All other requests per connection 12,000 per 10 seconds", code 7 `too many requests`, S5 | no refusal at 397 requests in one burst |
| public market data authentication | "No API key is required for public channels", S1 | none. A private subscribe without `authorize` answered code 6 `require authentication` |
| message parse and routing | `{"id": null, "method": "depth_update", "params": [true, {…}, "ETH_BTC"]}`, S2. The same page's code sample reads `params[0]` as the book object | `params` was `[boolean, object, string]` on every frame, so route on `method`, then `params[2]` |
| subscribe acknowledgement shape | `{"id": 12, "result": {"status": "success"}, "error": null}`, S2 | `{"error": null, "result": {"status": "success"}, "id": 2}`, one per request, and the frames are printed with a space after every colon and comma |
| symbol identifier format | `BTC_PERP` for perpetuals, S7 | `params[2]` equal to REST `ticker_id` for all 397 perpetuals in the batch, and so to CCXT `market.id` for the 304 that CCXT loads as swaps |
| number representation | `[price, amount]` strings, S2 | strings on every price and size in `depth` and `bookTicker`. `premiumIndex` sends prices and the rate as strings and the settlement time as a JSON number |
| timestamp representation | `timestamp` "from matchengine" and `event_time`, both numbers, S2 | Unix seconds as floats with microseconds. `event_time` minus `timestamp` had a median of 36 to 49 ms per market and a maximum of 5,575 ms. Arrival minus `event_time` had a median of 79 to 80 ms in the first run, 82 ms in the second and 102 ms in the third |
| size unit | the REST book documents "quantity in base currency", see [`rest.md`](./rest.md) section 2 | base coins, and 40, 40 and 27 of the top 40 socket sizes equalled the REST book at the same prices, and the misses fit levels that moved between the two reads |
| sequence semantics | "Each incremental message's `past_update_id` matches the previous message's `update_id`", and a gap means "re-subscribe to resync", S2 | 0 gaps in 583 to 594 deltas on five markets over 70 s in each of three runs, and 0 in 25,862 and 28,309 deltas on 397 perpetuals over 60 s |
| idle repeat behaviour | "If 10 seconds pass without an emitted `depth_update` on this subscription, the server pushes a full snapshot as a keepalive", S2 | 955 and 877 keepalive snapshots on 291 and 283 of 397 perpetuals in 60 s, a median of 10,058 ms after the market's previous frame in the second run, and never more than 10,309 ms of silence on one market |

The arrival lag of 79 to 102 ms and the pong round trip of 156 to 176 ms were read with this host's clock under NTP, see [`rest.md`](./rest.md) section 1.

## 4. The book channel in detail

`depth` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame for each market has `params[0]` true, no `past_update_id`, and exactly `limit` levels per side on every market probed: 100 and 100 on `BTC_PERP` and `M_PERP`, 50 and 50 on `SOL_PERP`, 20 and 20 on `ETH_PERP` and `BTC_USDT`.
It arrived 309 to 339 ms after the socket opened, which is when the subscribe frames were sent, and 828 to 918 ms after the socket was created.
The docs say every later frame with `params[0]` true and no `past_update_id` is a full reset, S2, and the feed resets on each one.

### Delta semantics

A delta has `params[0]` false and carries `update_id`, `past_update_id`, `timestamp`, `event_time`, and `bids` or `asks` or both.
A side that did not change is left out of the object, although the docs mark both arrays as required: the first delta of every market in two runs carried only `asks` or only `bids`.
Each level is `[price, amount]` as strings, and an amount of `"0"` removes the level.
No delta arrived with both sides empty.
A delta can list more levels than the subscription holds, 106, 121 and 150 entries on a 100 level `BTC_PERP` book, because removals travel in the same array.

### Sequence and gap rule

```text
params[0] true                       replace the book, last = update_id   (subscribe, and every keepalive)
params[0] false, past = last         apply, last = update_id
params[0] false, past ≠ last         gap: resubscribe (documented), or terminate the socket (the engine's resync)
```

`update_id` counts every change to the market's full book, including changes outside the subscribed window, so consecutive deltas jump by more than one and only `past_update_id` chains them.
In the second batch a keepalive snapshot's `update_id` was equal to the last one stored on 523 of 877 and larger on 354, and never smaller, and the next delta chained from the snapshot's `update_id` every time.
The rule held on every delta of every run, with 0 gaps.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on every market of every run | best first, ascending |
| delta | descending, with 0 unordered arrays in three runs | ascending, with 0 unordered arrays |
| REST `orderbook` | descending | ascending |

The docs' recipe inserts each level by price, S2, and a feed applies deltas by price and never by position.

### Level window

A book kept from the snapshot and every delta, with no local truncation, never held more than `limit` levels per side: 100, 50 and 20 on the markets probed, and 50 on all 397 in the batch.
So the server sends a `"0"` for a level leaving the window, and the docs' advice to "Truncate to the configured limit after each update" is a safeguard rather than a need.

### Size unit against CCXT `contractSize`

| market | CCXT `contractSize` | socket or REST size at the touch | what it means |
|---|---:|---|---|
| `BTC_PERP` | 0.001 | `"0.013"` | 0.013 BTC, about 1,120 USDT |
| `PEPE_PERP` | 1000000 | `"306000000"`, `"305000000"` on REST | 306 million PEPE, about 1,500 USDT |

The unit is base coins, and CCXT's `contractSize` is the order step, so the engine needs `contractSize: 1` in the registry, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

At the end of both batch runs no book among the 397 had an empty side.
What `depth` sends for a side with no orders is Not verified.
The engine's `resetBook` accepts an empty side.

### Idle repeats

Nothing is repeated between changes except the keepalive snapshot, which comes about 10 s after the market's last frame and carries the whole window.
A quiet book therefore costs a full snapshot every 10 s, and in the batch 283 and 291 of 397 perpetuals went quiet long enough to get one within a minute.
`bookTicker` sent no repeated top in 20, 32 or 48 frames, and its first frame repeats the standing top with the old transaction time, 31 s and 95 s before its message time in the two runs that measured it.

### Unknown, wrong and repeated subscriptions

| request | reply | then |
|---|---|---|
| `depth_subscribe` `["NOPE_PERP", 20, "0", true]` | `{"error":{"code":9,"message":"market NOPE_PERP does not exist"},"result":null,"id":12}` | nothing |
| `depth_subscribe` with `limit` 25 or 200 | code 1 `invalid argument` | nothing |
| `depth_subscribe` without the fourth parameter | `{"status":"success"}` | its effect on other markets was not measured |
| `depth_nope` | code 4 `method not found` | |
| `premiumIndex_subscribe` `["BTC_USDT"]` | code 1 `invalid argument`, as documented for a market without the `_PERP` suffix | |
| `balanceSpot_subscribe` without `authorize` | code 6 `require authentication` | |
| two `depth_subscribe` with `true`, then a third market with `false` | success each | the first two markets stopped, 0 frames in 4 s, and only the third delivered |
| the same market again with `true` | success | one new snapshot whose `update_id` repeated the previous frame's, in both runs, and no doubling of the frame rate |
| text that is not JSON | no reply | the socket closed 166 and 181 ms later with 1006, as documented |

A `multi_depth` of `false` drops every other `depth` subscription on the socket, so a feed must send `true` on every request.
A closed or delisted perpetual was not available to probe, and `STG_PERP`, announced for delisting on 2026-09-23, still delivered.
Public `depth` "excludes Retail Price Improvement (RPI) orders", which only retail-flagged takers can hit, so the book shown is the book an API taker can trade against, S2.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client `{"id": 0, "method": "ping", "params": []}` every 50 s, and "Reconnect if the server does not return pong within 10 seconds after a ping", S5 | `{"error": null, "result": "pong", "id": 1}` in 156 to 176 ms. No server protocol ping on any socket |
| silence the server tolerates | 60 s without a client message, S5 | a socket that sent nothing closed at 60.51 and 60.57 s with 1006. A socket that subscribed one quiet market and then sent nothing was still open at 75 s in both runs, which the documented rule does not predict, and suggests the subscription or the server's own keepalive snapshots count as activity. A socket that sent a protocol ping every 20 s and nothing else was open at 75 s, with 3 protocol pongs |
| forced disconnect | none documented | none in up to 76 s |
| maintenance notice | none in-band | not observed |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back in two runs, so the server does not negotiate it |
| handshake | | 473 to 577 ms from this host, over both hosts and every run that logged it |
| subscription limits | none per connection, 12,000 requests per 10 s | 397 requests in one burst, all acknowledged |
| throughput | "A single connection comfortably maintains subscriptions across `200` or more markets", S5 | 397 perpetuals at 50 levels on one socket: 460 and 500 frames per second on average, medians 419 and 445, peaks 913 and 1,604, 189 and 205 KB per second, 410 and 411 bytes per frame, 22.1 and 19.5 µs of `JSON.parse` per frame |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-22, with the server's spacing removed.
Arrays are cut to their first levels.

Subscribe.

```json
{"id": 3, "method": "depth_subscribe", "params": ["ETH_PERP", 20, "0", true]}
```

Acknowledgement.

```json
{"error": null, "result": {"status": "success"}, "id": 2}
```

Snapshot, three levels per side kept.

```json
{"method":"depth_update","params":[true,{"timestamp":1790113267.845638,"update_id":21244231142,"asks":[["2747.93","0.2"],["2748.56","0.71"],["2748.65","1.32"]],"bids":[["2747.92","9.31"],["2747.78","4.32"],["2747.71","0.04"]],"event_time":1790113268.221152},"ETH_PERP"],"id":null}
```

Delta that changes only the bids, chained to the snapshot above.

```json
{"method":"depth_update","params":[false,{"timestamp":1790113269.4255619,"update_id":21244231356,"past_update_id":21244231142,"bids":[["2747.18","0.36"],["2747.16","0"],["2746.57","0.36"],["2746.54","0"]],"event_time":1790113269.4838519},"ETH_PERP"],"id":null}
```

Delta with removals on both sides, three bids kept.

```json
{"method":"depth_update","params":[false,{"timestamp":1790113280.441349,"update_id":24268455520,"past_update_id":24268455456,"asks":[["86248.9","0.011"],["86249","0"]],"bids":[["86162.8","0"],["86159.9","0"],["86157.1","0"]],"event_time":1790113280.467543},"BTC_PERP"],"id":null}
```

Keepalive snapshot on a quiet book, two levels per side kept.

```json
{"method":"depth_update","params":[true,{"timestamp":1790113273.734566,"update_id":15312663414,"asks":[["86225.51","0.01218"],["86231.53","0.024613"]],"bids":[["86225.5","0.01218"],["86211.39","0.020803"]],"event_time":1790113273.785864},"BTC_USDT"],"id":null}
```

Keepalive.

```json
{"id": 1, "method": "ping", "params": []}
```

```json
{"error": null, "result": "pong", "id": 1}
```

Error.

```json
{"error":{"code":9,"message":"market NOPE_PERP does not exist"},"result":null,"id":12}
```

Premium index, all perpetuals in one push, two of 404 records kept.
The fifth field is the next settlement in Unix milliseconds, where the docs say seconds, and the sixth is the server's send time, which the docs show only for named-market subscriptions, S4.

```json
{"method":"premiumIndex_update","params":[["1INCH_PERP","0.10316","0.10307","0.0001",1790121600000,1790113268.565173],["BTC_PERP","86167.8","86224.5","0.00006382",1790121600000,1790113268.565173]],"id":null}
```

Best bid and ask, a positional array of transaction time, message time, market, update id, bid, bid amount, ask and ask amount.

```json
{"method":"bookTicker_update","params":[[1790113236.8762889,1790113268.220633,"BTC_PERP",24268451852,"86168.3","0.013","86168.4","0.013"]],"id":null}
```

## 7. Private channels

Named for a future execution stage, from S1 and S8, not probed.
They use the same socket after `authorize` with a token from `POST /api/v4/profile/websocket_token`.

- Account streams: `balanceSpot`, `balanceMargin`, `ordersPending`, `ordersExecuted`, `deals`, `positions`, `marginPositionsEvents`, `borrows`, `borrowsEvents` and `ADLQuantile`.
- Order management, live since 2026-09-02 on the global platform: 21 methods that place, modify and cancel spot, margin and futures orders, among them `collateral_order_limit_place`, `collateral_order_market_place`, `order_modify`, `order_cancel` and `order_cancel_all`, S6.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://wss.whitebit.com/ws`, never the `api.whitebit.com` host that CCXT Pro uses | the legacy host rejects connections from 2027-03-01 |
| channel | `depth` at `limit` 50 | snapshot on subscribe, a strict `past_update_id` chain, the window kept exact by the server, 50 levels covers the engine's 20, and the batch ran at 50 |
| markets per connection | 200, so two sockets for the 304 crypto perpetuals | 397 ran on one socket with 0 gaps at 500 frames per second, and the docs call 200 comfortable |
| subscribe frames | one `{"id": <n>, "method": "depth_subscribe", "params": [<rawMarketId>, 50, "0", true]}` per market | `depth` takes one market per request, and `true` keeps the others |
| keepalive | `{"id": 0, "method": "ping", "params": []}` every 20 s | the server never pings, a client-silent socket dies at 60 s, and the pong is traffic for the silence watch |
| `maxSilenceMs` | 30,000 | every subscribed market sends at least a keepalive snapshot every 10.3 s, and a pong arrives every 20 s |
| routing | `method === 'depth_update'`, then `params[2]` is the `rawMarketId` | `params` is `[isSnapshot, book, market]` on the wire |
| snapshot | `params[0] === true`: `resetBook` and store `update_id` | documented reset, and it covers the keepalive |
| delta | apply only when `past_update_id === last`, then store `update_id`, reading a missing `bids` or `asks` as empty | documented chain, 0 gaps observed, and one side is often absent |
| resync | `past_update_id !== last`, or a delta before any snapshot: `resync`, which terminates the socket and resubscribes | the engine's existing path, and resubscribing is what the docs ask for |
| unknown market | log the code 9 error with its request id | an unknown market is refused, not silently acknowledged |
| receive time | stamp on arrival, never from `timestamp` or `event_time` | `event_time` trailed `timestamp` by up to 5.6 s |
| sizes | `Number()` of the string, base coins | section 4 |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | WebSocket API overview, with the host migration | https://docs.whitebit.com/websocket/overview.md | 2026-09-22 | WhiteBIT, global | hosts, JSON-RPC format, public access, private channel names, sections 1, 3 and 7 |
| S2 | Order Book Depth channel | https://docs.whitebit.com/websocket/market-streams/depth.md | 2026-09-22 | WhiteBIT, global | parameters, limits, snapshot, `past_update_id` chain, keepalive snapshot, RPI, sections 2 to 4 |
| S3 | Book Ticker channel | https://docs.whitebit.com/websocket/market-streams/book-ticker.md | 2026-09-22 | WhiteBIT, global | best bid and ask fields, section 2 |
| S4 | Premium index channel | https://docs.whitebit.com/websocket/market-streams/premium-index.md | 2026-09-22 | WhiteBIT, global | mark, index and rate push every 0.5 s, record fields, sections 2 and 6 |
| S5 | WebSocket Rate Limits and Error Codes | https://docs.whitebit.com/websocket/rate-limits.md | 2026-09-22 | WhiteBIT, global | connection and request limits, 60 s timeout, ping, error codes 1 to 7, sections 3 and 5 |
| S6 | Changelog and documentation index | https://docs.whitebit.com/changelog.md | 2026-09-22 | WhiteBIT, global | host migration on 2026-09-01, order management on 2026-09-02, premium index documented on 2026-09-18, sections 3 and 7 |
| S7 | Markets and Trading Pairs concept | https://docs.whitebit.com/concepts/markets.md | 2026-09-22 | WhiteBIT, global | `_PERP` naming, section 3 |
| S8 | WebSocket Authentication | https://docs.whitebit.com/websocket/authentication.md | 2026-09-22 | WhiteBIT, global | `authorize` and the token call, section 7 |
| S9 | CCXT Pro 4.5.68 `whitebit.js` | `server/node_modules/ccxt/js/src/pro/whitebit.js` | 2026-09-22 | CCXT | the deprecated host at line 30, section 1 |
| S10 | Market Statistics channel | https://docs.whitebit.com/websocket/market-streams/market.md | 2026-09-22 | WhiteBIT, global | `market` cadence, section 2 |
| P1 | `ws-probe.mjs book`, three runs at 21:38, 21:41 and 21:55 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/whitebit/ws-probe.mjs) | 2026-09-22 | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs batch`, 21:42 and 21:56 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/whitebit/ws-probe.mjs) | 2026-09-22 | this host | sections 3 to 5 |
| P3 | `ws-probe.mjs silence`, 21:44 and 21:58 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/whitebit/ws-probe.mjs) | 2026-09-22 | this host | sections 3 and 5 |
| P4 | `ws-probe.mjs deflate` and `legacy`, 21:38 and 21:59 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/whitebit/ws-probe.mjs) | 2026-09-22 | this host | sections 1 and 5 |
