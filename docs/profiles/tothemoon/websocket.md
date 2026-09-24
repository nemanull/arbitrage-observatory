# Tothemoon WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 03:20 to 03:56 UTC), from the development host near Seattle.

This profile covers the public market data socket of Tothemoon, formerly Cryptology, called Octopus, for its one perpetual family, USDT-margined linear perpetuals, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/tothemoon/ws-probe.mjs), and the capture is quoted beside the documented value.
The documented host does not resolve, and the socket that works is the one the tothemoon.com web app uses, see section 1.
Several channels used below are not in the documentation and were read from the web app's code, S3.
Sources (S) and probe runs (P) are in section 9.

## 1. Endpoints

| URL | documented | probed on 2026-09-23 UTC |
|---|---|---|
| `wss://octopus.tothemoon.com/v1/connect` | production Octopus, S1 | `getaddrinfo ENOTFOUND` in both runs, P1, and `dig` reports NXDOMAIN |
| `wss://octopus-sandbox.tothemoon.com/v1/connect` | sandbox Octopus, S1 | ENOTFOUND, P1 |
| `wss://octopus-prod-ws.cryptology.com/v1/connect` | not documented, the `octopusUrl` of the web app's production config, S3 | HTTP 101 through Cloudflare, open in 812 and 731 ms, welcome `[prod] Welcome to Cryptology!`, P1 |
| `wss://octopus.cryptology.com/v1/connect` | not documented, the pre-rebrand host | HTTP 101, open in 734 and 660 ms, the same welcome, P1 |
| `wss://contracts-api.tothemoon.com/v1/trading` | the private Contracts trading API, S1 | ENOTFOUND. `contracts-api.cryptology.com` resolves to the same Cloudflare addresses as Octopus and was not connected, since it takes API keys, P1 |

One socket carries every channel, spot and perpetual, and every perpetual is in one family, USDT-margined, see [`rest.md`](./rest.md) section 2.
A plain HTTPS GET of `https://octopus-prod-ws.cryptology.com/` answered 404 `404 page not found`, and of `/v1/connect` answered 400 `Bad Request`, P1.

## 2. Channel matrix for public market data

A channel is `<type>.<instrument>`, and `*` asks for every instrument where the web app uses it, S1 and S3.

| channel | documented | payload | probed |
|---|---|---|---|
| `contractsOrderbookVolumes.<instrument_id>` | yes | snapshot then price map deltas | 4.34 to 6.07 frames a second per contract over three runs, recommended, P2 |
| `turboOrderbookVolumes.<instrument_id>` | no, the web app's book channel | the same stream | on BTC it matched `contractsOrderbookVolumes` with 265 against 266 frames and 479 zero sizes each at 03:27, and 250 frames and 431 zero sizes each at 03:34, P2 |
| either book channel with `"params": {"rate_limit": 1}` | `rate_limit` is documented only for the two ticker channels | conflated deltas | 0.91, 0.93 and 0.94 frames a second on ETH, 19.9 to 51.9 entries a frame on average, P2 |
| `contractsTickers.<instrument_id>` | yes | mark, fair, index, funding, best bid and ask, 24 h stats | about one frame a second per contract, P2 |
| `turboTickers.*` | no | the same ticker for all 13 contracts on one subscription | 0.84 to 0.91 frames a second per contract, P3 |
| `turboFutureInstruments.*` | no | the perpetual catalog in one frame | one frame on subscribe, P4 |
| `turboEmergencyMode.*` | no | emergency flags per instrument and for the system | one frame on subscribe, every flag false, P4 |
| `contractsTrades.<instrument_id>`, `turboTrades.<instrument_id>` | the first | trades | not probed |
| `spotTickers.<pair>`, `spotTrades.<pair>` | yes | spot ticker and trades | spot, not detailed |
| `photonInstruments.*`, `photonTickers.*`, `photonOrderbookVolumes.<pair>`, `photonTrades.<pair>` | no | spot catalog, tickers, book and trades | spot, not detailed |

No dedicated mark, index or funding channel exists.
The ticker carries all three, so the anchor has to come from it, see [`rest.md`](./rest.md) section 3.
Besides `subscribe`, the web app sends a `retrieve` message, and `retrieve` of `turboFutureInstruments.*` answered only `{"type":"endRetrieve", …, "payload":{}}`, P4.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one Octopus URL for spot and contracts, S1 | one URL for every channel, and the documented URL is dead, section 1 |
| subscribe frame shape | `{"type": "subscribe", "channel": "contractsTrades.BTC_PERPETUAL", "request_id": "…"}`, one channel per frame, S1 | the same, one channel per frame. The web app passes a `rateLimit` of 1 in `params` on books and trades, S3, and `"params": {"rate_limit": 1}` conflated a book to about one frame a second, P2 |
| unknown symbol expectation | Not publicly specified | acked with `subscribedSuccessful`, then one `subscriptionData` with `"data": null`, then silence, and the subscription is gone from `getSubscriptions`, section 4 |
| chunk unit and budget | one channel per `subscribe`, 10 requests a second, S1 | 29 subscribe frames in one burst in the first runs were all acked with no `THROTTLING`, and later runs paced them at four a second |
| keepalive mechanism | Not publicly specified | the server sends a protocol ping about every 15 s, and the client library's automatic pong is enough, section 5 |
| connection lifetime and maintenance notice | `MaintenanceModeChanged` on the private Contracts API, S1 | no close in 121 s on any socket. `turboEmergencyMode.*` carries per instrument and system flags, all false |
| handshake and operation rate limits | "10 requests per second for WebSocket API", with a `THROTTLING` reply and `overflow_level` in ms, S1 | opens took 660 to 812 ms, no `THROTTLING` seen |
| public market data authentication | "Access to APIs requires authentication", S1 | none needed for any channel in this profile |
| message parse and routing | `{"type", "server_timestamp", "request_id", "payload": {"channel", "data"}}`, S1 | route on `request_id`, or on `payload.channel`, or on `payload.data.instrument_id`. Every frame ends with a newline character |
| subscribe acknowledgement shape | `{"server_timestamp", "type": "subscribedSuccessful", "request_id", "payload": {"channel"}}`, S1 | identical |
| symbol identifier format | `BTC_PERPETUAL` in the examples, S1 | `BTC_USDT_PERPETUAL`, equal to the catalog's `instrument_id`, the book's `instrument_id` and the ticker's `instrument_id` on 13 of 13 |
| number representation | `decimal` | every price and size is a JSON string. Book levels are object keys, so the price is the key string and the size its value |
| timestamp representation | `timestamp` "Unix timestamp of change", int, S1 | ms. The envelope's `server_timestamp` is also ms |
| size unit | Not publicly specified | contracts of `contract_size` base coins, and nearly every book frame also carries the base-coin and quote sizes, section 4 |
| sequence semantics | `offset` "Unique update identifier", S1 | `offset` is a counter shared by every channel, not a per-contract sequence, and it went backwards once in most subscriptions. `payload.nonce` counts frames per subscription from 1 with no gap, section 4 |
| idle repeat behaviour | not documented | every book sent 4 to 6 frames a second, and tickers repeat about once a second whether or not a number changed |

## 4. The book channel in detail

`contractsOrderbookVolumes.<instrument_id>` is the channel this profile recommends, and every row below is about it unless it says otherwise.
The numbers come from three `book` runs at 03:27, 03:34 and 03:40 UTC over all 13 contracts, two `record` runs at 03:41 and 03:55 UTC over BTC and ETH, and the offline `replay` of those captures and of the 03:40 `book` capture, P2 and P5.

### Snapshot on subscribe

The first frame of a subscription, `nonce` 1, is the whole book window: 13 to 16 bids and 11 to 16 asks, with no zero size.
In the paced run it arrived 162 to 182 ms after the subscribe frame was sent.
Its `timestamp` was 541 to 1,217 ms older than its own `server_timestamp` in the frames inspected, so the snapshot is up to 1.2 s stale when it is sent.

In 17 of 19 subscriptions inspected, the second frame was another whole window with no zero size and a fresher `timestamp`, 240 to 329 ms behind `server_timestamp` in the two `record` runs, and in most of them the third frame was an older delta.
In the other two, DOT and SOL in the 03:40 run, the snapshot was the fresher frame and `nonce` 2 was an older delta.
The documentation does not describe a snapshot at all.

### Delta semantics

After the first frames, each frame is a partial price map for both sides.
A size of `"0"` deletes the level.
A frame carried 5.8 to 13.2 entries on average, and a side may be absent from a frame's changes by being an empty object.
Deltas arrive in two kinds: frames with 10 or more entries reach the server 363 to 576 ms after their `timestamp` (median per contract), and smaller ones 176 to 206 ms after.
The web app's merge function applies each frame's `volumes` to the book it holds, with no check of `offset` or `nonce`, S3.

### Sequence and gap rule

There is no documented sequence.

| field | behaviour |
|---|---|
| `offset` | a counter shared across all channels and contracts. In 10 and 12 of 13 subscriptions in the two later runs, exactly one frame at `nonce` 2 or 3 carried an `offset` and a `timestamp` below the frame before it, and no subscription had a second such frame |
| `provider_offset` | a second shared counter, also not monotonic within 11 of 13 subscriptions of the 03:27 run |
| `payload.nonce` | 1, 2, 3 and so on per subscription. 0 gaps on 15 subscriptions of 38 to 230 frames each in the 03:40 run |

So `nonce` is the only gap signal, and it counts frames the server sent on this subscription rather than book events.
The out-of-order frame must still be applied: dropping it left BTC, ETH, BCH and DOGE crossed in the replay, see "Crossed books" below.

### Crossed books

Applying every frame as a merge, as the web app does, left stale levels from the snapshot in the book whenever the second whole window moved past them.

| run | crossed frames under merge |
|---|---|
| 03:27 and 03:34, 13 contracts | 0 on every contract |
| 03:40, 13 contracts | BTC 192 of 227, ETH 209 of 230, BCH 40 of 227, DOGE 25 of 224, 0 on the other nine |
| 03:41 `record`, BTC and ETH | BTC 0 of 255, ETH 7 of 272 |
| 03:55 `record`, BTC and ETH | BTC 0 of 245, ETH 0 of 242 |

The replay tried three rules on the first 38 or 39 frames of each of the 15 subscriptions of the 03:40 run and on the two subscriptions of each full 45 s `record` capture, P5.

| rule | crossed subscriptions |
|---|---|
| merge every frame in arrival order | 7 of 19 |
| also clear the book on a whole window among `nonce` 1 to 3, meaning no zero size and at least 10 levels a side | 0 of 19 |
| as above, and also drop a frame whose `offset` is not above the highest applied | 5 of 19 |

With the reset rule, the book's best bid equalled the ticker's `best_bid` on 37 of 40 BTC ticks and 36 of 38 ETH ticks in the first `record` run, and on 37 of 38 and 38 of 40 in the second.
The best ask matched on 38 of 40 and 34 of 38, then on 38 of 38 and 38 of 40.
The misses are most likely ticks that arrived between two book frames, an inference not tested.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

Levels are object keys, and the key order is neither sorted nor stable.
The ETH snapshot of the 03:40 run began its bids with `2773.78`, `2773.95`, `2774.00`, `2772.39` and its asks with `2774.25`, `2775.96`, `2774.09`, P2.
A feed applies levels by price and sorts for itself.

### Level window

The server keeps about 15 levels a side.
Without stale levels, the merged book held at most 15 to 18 levels on a side on every contract in the first two runs.
This is below the engine's 20 levels a side, `DEPTH_LEVELS = 20` at [`ClusterIndexBuilder.ts`](../../../server/src/engine/cluster/ClusterIndexBuilder.ts) line 17.

The BTC book held two levels more than 5 % from the mid in every run, one of them a bid at `0.3` in the first frame of the 03:27 run, P2.
AVAX held a bid at `5.000` in the same run, P2.
They are resting orders at the edge of the window, and a depth walk stops before them.

### Size unit against the catalog's `contract_size`

| contract | `contract_size` | `volumes` at the touch | `extended_volumes.base` at the same price |
|---|---:|---|---|
| `ETH_USDT_PERPETUAL` | 0.00001 | `"167662"` | `"1.67662000"` ETH |

`volumes` sizes are contracts.
All but at most one frame per contract in the 03:27 run also carried `extended_volumes.base` and `extended_volumes.quote` for the same prices.
On 400 levels checked per contract in each run, base equalled contracts times `contract_size`, and quote equalled base times price, to within 2 parts in 10^16, P2.
So a feed can read `extended_volumes.base` directly in coins, or multiply `volumes` by `contractSize` as the engine does.

### One-sided and empty books

No live contract showed an empty side.
The retired `BTC_PERPETUAL` answers with `bids` and `asks` both empty and a `timestamp` of 2023-12-15 13:59:51 UTC, P4.

### Idle repeats

Every contract sent 4 to 6 book frames a second, including XAU, and the longest gap between two book frames was 547 to 874 ms.
A subscription to the XAU book received 654 and 619 frames in the two 121 s silence runs, P6.
The ticker repeats about once a second with unchanged numbers.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `contractsOrderbookVolumes.NOPE_USDT_PERPETUAL` | `subscribedSuccessful`, then `subscriptionData` with `"data": null` | nothing, and it is absent from `getSubscriptions` |
| `contractsTickers.NOPE_USDT_PERPETUAL` | the same | the same |
| `contractsOrderbookVolumes.BTC_USDT`, a spot pair | the same | the same |
| `contractsOrderbookVolumes.BTC_PERPETUAL`, retired | `subscribedSuccessful`, then an empty book stamped 2023-12-15 | stays in `getSubscriptions` |
| `contractsOrderbookVolumes` with no instrument | `errorMessage`, `COMMON_ERROR`, `invalid request params: invalid channel contractsOrderbookVolumes` | |
| `fooBar.BTC_USDT_PERPETUAL` | `COMMON_ERROR`, `invalid channel type fooBar` | |
| subscribe with no `request_id` | `COMMON_ERROR`, `request_id is required field` | |
| `{"type": "hello"}` | `UNKNOWN_MESSAGE_TYPE` | |
| the text `hello` | `INVALID_MESSAGE_FORMAT` | the socket stays open |
| the same `request_id` twice | `COMMON_ERROR`, `can't subscribe: connection … is already subscribed … with id dup` | the first keeps delivering |
| the same channel with a new `request_id` | `subscribedSuccessful` and a second copy of the stream | both deliver |
| `unsubscribe` of an unknown id | `COMMON_ERROR`, `can't unsubscribe: connection … is not subscribed with id never` | |

Every reply came 155 to 199 ms after the request, P4.
A feed has to notice a `"data": null` reply on its own, since the ack says success.

## 5. Session

| item | documented | probed |
|---|---|---|
| welcome | `welcomeMessage` with `connection_id` on connect, S1 | `{"type":"welcomeMessage","server_timestamp":…,"payload":{"message":"[prod] Welcome to Cryptology!","connection_id":…}}` on every socket |
| keepalive | Not publicly specified | a server protocol ping every 15 s or so: 3 in each 45 s run and 8 in each 121 s run. The `ws` library answers each with a pong on its own. A client protocol ping came back in 157 to 188 ms. No application ping exists in the docs or the web app, S3 |
| silence the server tolerates | Not publicly specified | a socket with no subscription and no application frame stayed open for the full 121 s in both runs, 03:30 and 03:44 UTC, with only the automatic pongs going out |
| forced disconnect | Not publicly specified | none in 121 s |
| maintenance notice | `MaintenanceModeChanged` on the private Contracts API, S1 | `turboEmergencyMode.*` flags, all false |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | | 660 to 812 ms to open from this host |
| subscription limits | 10 requests a second | 29 subscriptions on one socket, and a duplicate `request_id` is refused |
| throughput | | 13 books, two twin books and 13 tickers on one socket: 90.2 and 91.6 frames a second, 71.9 and 72.4 KB a second, 809 and 817 bytes a frame, 5.7 and 7.0 µs of `JSON.parse` a frame, in the runs at 03:34 and 03:27 UTC |
| client address | | an error message echoes the client's public IP address and an empty user agent |

## 6. Captured frames

From the probe runs of 2026-09-23 UTC, P2 and P5.
Book frames are trimmed to three levels a side and stay valid JSON.

Subscribe.

```json
{"type": "subscribe", "channel": "contractsOrderbookVolumes.BTC_USDT_PERPETUAL", "request_id": "b:BTC"}
```

Acknowledgement.

```json
{"type":"subscribedSuccessful","server_timestamp":1790134900045,"request_id":"b:BTC","payload":{"channel":"contractsOrderbookVolumes.BTC_USDT_PERPETUAL"}}
```

Snapshot, `nonce` 1, whose `timestamp` is 1,214 ms older than `server_timestamp`.
Sizes are contracts of 0.00001 ETH.

```json
{"type":"subscriptionData","server_timestamp":1790134829300,"request_id":"b:ETH_USDT_PERPETUAL","payload":{"channel":"contractsOrderbookVolumes.ETH_USDT_PERPETUAL","data":{"volumes":{"bids":{"2774.01":"167662","2774.00":"163893","2773.98":"119018"},"asks":{"2774.06":"167499","2774.07":"105998","2774.08":"178276"}},"instrument_id":"ETH_USDT_PERPETUAL","timestamp":1790134828086,"offset":624009155547,"provider_offset":126618754881,"extended_volumes":{"base":{"bids":{"2774.01":"1.67662000","2774.00":"1.63893000","2773.98":"1.19018000"},"asks":{"2774.06":"1.67499000","2774.07":"1.05998000","2774.08":"1.78276000"}},"quote":{"bids":{"2774.01":"4650.96064620","2774.00":"4546.39182000","2773.98":"3301.53551640"},"asks":{"2774.06":"4646.52275940","2774.07":"2940.45871860","2774.08":"4945.51886080"}}}},"nonce":1}}
```

Delta, `nonce` 5, with deletions.

```json
{"type":"subscriptionData","server_timestamp":1790134830118,"request_id":"b:ETH_USDT_PERPETUAL","payload":{"channel":"contractsOrderbookVolumes.ETH_USDT_PERPETUAL","data":{"volumes":{"bids":{"2772.87":"129242","2772.88":"105046","2772.89":"0"},"asks":{"2775.94":"0","2775.95":"0","2775.96":"0"}},"instrument_id":"ETH_USDT_PERPETUAL","timestamp":1790134829534,"offset":624009168064,"provider_offset":126618755995,"extended_volumes":{"base":{"bids":{"2772.87":"1.29242000","2772.88":"1.05046000","2772.89":"0"},"asks":{"2775.94":"0","2775.95":"0","2775.96":"0"}},"quote":{"bids":{"2772.87":"3583.71264540","2772.88":"2912.79952480","2772.89":"0"},"asks":{"2775.94":"0","2775.95":"0","2775.96":"0"}}}},"nonce":5}}
```

Ticker, which carries the anchor fields.
The mark equals the index, and both sit above the day's high trade.

```json
{"type":"subscriptionData","server_timestamp":1790134900792,"request_id":"k:ETH","payload":{"channel":"contractsTickers.ETH_USDT_PERPETUAL","data":{"instrument_id":"ETH_USDT_PERPETUAL","mark_price":"2777.99","fair_price":"2777.99","last_trade_price":"2777.12","last_trade_type":"BUY","index_price":"2777.99","last_funding_time":1788854400000,"funding_rate":"0.000000000000000000","funding_interval":28800000,"premium_index":"0.000000000000000000","interest_rate":"0.000000000000000000","1d_high":"2777.12","1d_low":"2715.84","1d_volume":"33983866","best_bid":"2775.66","best_ask":"2775.72","mid_price":"2775.69","price_change":"34.58","price_change_percent":"1.27","contract_size":"0.00001","offset":624009533296,"provider_offset":126618805663},"nonce":1}}
```

Unknown instrument.

```json
{"type":"subscriptionData","server_timestamp":1790134201403,"request_id":"e2","payload":{"channel":"contractsTickers.NOPE_USDT_PERPETUAL","data":null,"nonce":1}}
```

Errors.

```json
{"type":"errorMessage","server_timestamp":1790134203505,"request_id":"e5","payload":{"code":"COMMON_ERROR","message":"invalid request params: invalid channel contractsOrderbookVolumes"}}
```

```json
{"type":"errorMessage","server_timestamp":1790134206311,"payload":{"code":"INVALID_MESSAGE_FORMAT","message":"invalid message format: hello"}}
```

Subscription list.

```json
{"type":"subscriptionList","server_timestamp":1790134209113,"payload":{"subscriptions":{"dup":"contractsOrderbookVolumes.SOL_USDT_PERPETUAL","dup2":"contractsOrderbookVolumes.SOL_USDT_PERPETUAL","e3":"contractsOrderbookVolumes.BTC_PERPETUAL"}}}
```

## 7. Private channels

Named for a future execution stage, not probed.

- The documented Contracts Trading protocol is a separate socket, `wss://contracts-api.tothemoon.com/v1/trading`, which does not resolve, with `Access-Key` and `Secret-Key` headers, S1.
  Its requests are `PlaceOrder`, `CancelOrder`, `CancelAllOrders`, `GetPosition` and `GetAllOrders`.
  Its server messages are `OrderPlaced`, `OrderCancelled`, `OrderClosed`, `OrderRejected`, `AllOrdersCancelled`, `Position`, `Trade`, `SystemInfo`, `Balance`, `MaintenanceModeChanged`, and the errors `OrderPlacingError`, `OrderCancellingError`, `AllOrdersCancellingError` and `CommonError`.
- The web app authenticates on Octopus itself with an `authenticate` message that carries the login JWT, S3.
  Its account channels include `turboBalances`, `turboPosition`, `turboOrders`, `turboStopOrders`, `turboLiquidations`, `personalTurboTrades`, `turboPnl`, `turboRobots` and `turboTradedVolume`, S3.
  It places orders over REST at `https://api.prod.cryptology.com/turbo-trading/v1/futures/place-order` and its siblings, S3.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one URL, `wss://octopus-prod-ws.cryptology.com/v1/connect` | the documented host does not resolve, and this is the host the web app uses |
| channel | `contractsOrderbookVolumes.<rawMarketId>` | documented, and identical to the web app's `turboOrderbookVolumes` |
| markets per connection | all 13 on one socket | 13 books and 13 tickers ran at about 90 frames a second on one socket |
| subscribe frames | one frame per contract, `{"type": "subscribe", "channel": "contractsOrderbookVolumes.BTC_USDT_PERPETUAL", "request_id": "BTC_USDT_PERPETUAL"}`, at most four a second | one channel per frame, and 10 requests a second is the documented cap |
| keepalive | none beyond answering the server's protocol pings, which `ws` does | a bare socket lived 121 s |
| `maxSilenceMs` | 5,000 | every contract sent a book frame at least every 874 ms |
| routing | `request_id`, or `payload.data.instrument_id` | both carry the id |
| snapshot | `nonce` 1: `resetBook` | whole window, up to 1.2 s stale |
| second window | a frame among `nonce` 2 and 3 with no zero size and at least 10 levels a side: `resetBook` again | removes every cross seen in replay |
| delta | apply every other frame by price in arrival order, `"0"` deletes, and do not order by `offset` | dropping the out-of-order frame left books crossed |
| resync | `nonce !== last + 1`, a `"data": null` reply, or a crossed book after the second window: `resync` | `nonce` is the only gap signal, and no checksum exists |
| receive time | stamp on arrival | the snapshot's `timestamp` can be 1.2 s old |
| sizes | `Number(volumes[price])` times `contractSize`, or `Number(extended_volumes.base[price])` | both agree exactly |
| depth | expect about 15 levels a side, below the engine's 20 | the server's window |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |
| gate at open | none from this feed, but see [`rest.md`](./rest.md) section 8 for the ATOM and ETC anchors | |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Tothemoon API Documentation, "Octopus market data protocol" and "Contracts Trading protocol" | https://docs.tothemoon.com/ | 2026-09-22 | Tothemoon, global | URLs, channel names, message and error shapes, rate limit, private protocol, sections 1 to 7 |
| S3 | tothemoon.com web app, `_app` chunk | https://tothemoon.com/_next/static/chunks/pages/_app-179ed8454e51944c.js | 2026-09-22 | Tothemoon, global | `octopusUrl`, the `turbo*` and `photon*` channel names, public against authenticated subscriptions, the merge of book frames, `rate_limit` params, order entry paths, sections 1 to 8 |
| P1 | `ws-probe.mjs hosts`, at 03:26 and 03:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tothemoon/ws-probe.mjs) | 2026-09-23 UTC | this host | DNS, handshakes, deflate, sections 1 and 5 |
| P2 | `ws-probe.mjs book`, at 03:27, 03:34 and 03:40 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tothemoon/ws-probe.mjs) | 2026-09-23 UTC | this host | book behaviour, sizes, throughput, frames, sections 2 to 6 |
| P3 | `ws-probe.mjs anchor`, at 03:28 and 03:33 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tothemoon/ws-probe.mjs) | 2026-09-23 UTC | this host | `turboTickers.*` cadence, section 2 |
| P4 | `ws-probe.mjs catalog` and `errors`, at 03:27, 03:30 and 03:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tothemoon/ws-probe.mjs) | 2026-09-23 UTC | this host | catalog, `retrieve`, unknown symbols, errors, sections 2 to 6 |
| P5 | `ws-probe.mjs record` at 03:41 and 03:55 UTC, and `ws-probe.mjs replay` of those captures and of the 03:40 `book` capture | [`ws-probe.mjs`](../../../scripts/probes/venues/tothemoon/ws-probe.mjs) | 2026-09-23 UTC | this host | snapshot ages, crossed books under three apply rules, ticker agreement, sections 4 and 6 |
| P6 | `ws-probe.mjs silence`, at 03:30 and 03:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/tothemoon/ws-probe.mjs) | 2026-09-23 UTC | this host | keepalive, silence, quiet book frame count, sections 4 and 5 |
