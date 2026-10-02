# Echobit WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 06:29 to 07:09 UTC), from the development host near Seattle, through a pre-existing Surfshark WireGuard tunnel whose exit geolocates to Canada.

This profile covers the public WebSocket API of Echobit for its one perpetual family, USDT-M, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/echobit/ws-probe.mjs), run from `server/`, and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The sockets were held about twelve minutes in total over both passes.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| market data, spot and USDT-M perpetuals | `wss://uapi.echobit.com/uapi/exchange/ws`, S1 | opened in 499 to 558 ms with no key and no query string, on the 12 sockets that logged it |
| funding rates | `wss://uapi.echobit.com/uapi/ws/inform`, S3 | opened in 839 and 862 ms with no key |
| private, "Business" | `wss://uapi.echobit.com/uapi/ws/information`, signed, S2 | not probed |
| the website's own socket | `wss://ws.echobit.com/ws/echobit`, from `proxyWsCommon` in the website's config, S5 | not probed |

The documentation disagrees with itself on keys.
The overview table marks the market and funding sockets "Signature: No", S2.
The parameter tables of both sockets list `timestamp` and `X-EC-APIKEY` as required, "Apikey, contact support to obtain", S1 and S3.
On the wire, both sockets served every public topic with no key, no timestamp and no cookie.

One socket carries spot and perpetuals.
A depth subscription for the spot `BTCUSDT` and one for `BTC-SWAP-USDT` delivered side by side on the same market socket.

## 2. Channel matrix for public market data

Every subscription is `{"id": <string>, "topic": <topic>, "event": "sub", "symbol": <symbolId>, "params": {}}` on the market socket, S1.

| topic | payload and depth | probed on 2026-09-23 UTC |
|---|---|---|
| `depth` | the whole book in every push, up to 200 levels per side | recommended, section 4. A top level `limit` of 5 or 200 and a `params.limit` of 5 were ignored: after its first frame ETH still sent 90 to 96 bids, XRP 39 to 43 and ZEC 39 to 44 in the level counts sampled |
| `diffDepth` | a whole book first, then only the changed levels with `"0"` for a removed one | a book rebuilt from it matched the `depth` push of the same version on BTC 45 of 45 and 24 of 24 times, on ENA 16 of 17 and 26 of 26, and on ETH 0 of 13 and 0 of 27, where the first mismatch of each run showed the same touch but 4 more bids in the rebuilt book than in `depth` |
| `mergedDepth` | levels merged by `params.dumpScale` | 20 or 21 levels per side on `UNI-SWAP-USDT` with `dumpScale` 1, and a version suffix `_1` |
| `depth` with `params.binary: true` | the same book | binary frames that `gunzip` opens, on `SNDK-SWAP-USDT` |
| `depth` with `symbol` `"DOGE-SWAP-USDT,XAU-SWAP-USDT"` | two books | both delivered under the one `id`, each frame naming its `symbol` |
| `trade` | recent trades | 100 and 101 frames in 30 s on BTC, the first holding 60 trades |
| `markKline_1m` keyed by `indexId`, `limit: 1` | the current 1 m candle of the mark | 14 and 18 frames in 30 s on `BTCUSDT`, and the first frame's `data` was empty |
| `indexKline_1m` keyed by `indexId` | the current 1 m candle of the index | 31 frames in 30 s in both runs, one a second |
| `markKline_1m` keyed by `BTC-SWAP-USDT` | | no frame |
| `bookTicker` on `BTC-SWAP-USDT` | not documented | no frame |
| `quotesData` | 24 h tickers of every spot and perpetual market | a first frame of 261 rows, then frames of 71 to 130 changed rows in the sample printed, 31 and 33 frames and 449 and 459 KB in 30 s. No mark, index or funding field |
| `kline_<period>` | documented, S1 | not probed |
| `fund_rates` on the funding socket | all funding rows, S3 | a `subbed` acknowledgement, then all 200 rows every 1,997 to 1,999 ms median, 2,505 and 2,741 ms at most, 15 pushes in 30 s in both runs |

The two subscriptions that delivered nothing, `markKline_1m` on the contract id and `bookTicker`, drew two `{"code":"-100010","desc":"Invalid Symbols!"}` frames without an `id`, so which frame answered which is an inference.
No channel carries mark, index and funding together.
Mark and index come only as kline candles keyed by `indexId`, and funding only from the funding socket, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one market socket for spot and perpetuals, one funding socket, one private socket, S2 | as documented, section 1 |
| subscribe frame shape | `{"id": "depth.BTCUSDT", "topic": "depth", "event": "sub", "symbol": "BTCUSDT", "params": {}}`, one symbol per frame in every example, S1 | one frame per symbol, 124 frames in 2 ms, all delivered. A comma separated `symbol` also works |
| unknown symbol expectation | Not publicly specified | `{"code":"-100010","desc":"Invalid Symbols!"}`, no `id`, and the socket stays open. A delisted symbol and a missing symbol answer the same |
| chunk unit and budget | Not publicly specified | 124 subscriptions on one socket, every one delivered |
| keepalive mechanism | the client sends `{"ping": <ms>}`, the server answers `{"pong": <ms>}`, "If no heartbeat message is received within 60 seconds, the server will close the connection.", S2. The documentation's demo page instead answers server pings, S4 | the client ping is answered with the server's own time, not an echo. No server ping of either kind arrived on any socket in 100 s |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 100 s, and no notice frame |
| handshake and operation rate limits | "Connection rate limit: 60/minute (per API key)" and "Max connections: 5", S2 | not tested, at most three sockets were open at once |
| public market data authentication | contradictory, section 1 | none needed |
| message parse and routing | `{symbol, symbolName, topic, params, data, f, sendTime, id}`, S1 | route on `topic` and `symbol`. The `id` of the latest subscription for a topic and symbol is echoed. The documented `f` flag was absent on every `depth` frame. Error frames carry `code` and `desc` only |
| subscribe acknowledgement shape | none on the market socket, `{"code":"200","topic":…,"event":"subbed"}` on the funding socket, S2 | as documented |
| symbol identifier format | `BTCUSDT` in every example, S1 | perpetuals use `symbolId`, `BTC-SWAP-USDT`, identical to the REST catalog. `BTCUSDT` is the spot book, and the kline topics take `indexId`, which is also spelled `BTCUSDT` |
| number representation | prices and sizes as strings, S1 | as documented |
| timestamp representation | `t` and `sendTime` in ms, S1 | as documented. `sendTime` minus `t` was 99 to 146 ms median on active books, and the one frame of a quiet book carried a `t` 35 to 144 s old |
| size unit | Not publicly specified | contracts of the catalog's `multiplier`, section 4 |
| sequence semantics | `v` "version", S1 | `v` is `"<n>_18"` with `n` strictly rising, 0 backward steps in any run, and steps of up to 58 between pushes |
| idle repeat behaviour | Not publicly specified | pushes follow book changes, and 0, 1 or 5 pushes per minute repeated the book of the push before |

## 4. The book channel in detail

`depth` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame after a subscribe is a whole book, and it came 130 to 140 ms after the subscribe frame, and once 246 ms on the quietest contract.
It is not always the full book.
In one of three `book` runs, `BTC-SWAP-USDT`'s first frame held 5 bids and 5 asks, and later frames up to 200.
In the second `batch` run, 20 of 124 first frames held exactly 1 or exactly 20 levels on both sides, which looks cut, among them `ETH-SWAP-USDT` at `20/20` against its usual 90 to 96 bids and 45 to 49 asks.
In a `variants` run, ETH's first frame was `20/20` and its second `95/48`.
The REST depth call shows the same cut replies, see [`rest.md`](./rest.md) section 5, so a first frame can be a cut book until the next change.

### Delta semantics

There are none on `depth`.
Every frame is the whole book as the server holds it, and it replaces the previous one.
`diffDepth` does send deltas, but it carries only the new `v` and no previous version, so a missed delta cannot be detected, and on ETH its rebuilt book kept levels that `depth` had dropped.

### Sequence and gap rule

```text
depth frame          replace the book, store n from v = "<n>_<suffix>"
n > stored n         normal, steps of up to 58 were seen because pushes are conflated
n <= stored n        never seen, drop the frame
```

No gap rule is needed, because no frame depends on the one before.
A resync on `depth` is only needed when the socket drops.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

Bids descending and asks ascending on every `depth` frame of every run, 0 frames out of order, and the same on the REST book.
The engine holds `depthLevels` per side, set at [`Engine.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/Engine.ts) lines 72 and 73 and 20 by default from `DEPTH_LEVELS` at [`ClusterIndexBuilder.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/ClusterIndexBuilder.ts) line 17.

### Level window

`BTC-SWAP-USDT` frames held 176 to 200 bids and 199 or 200 asks, apart from the cut first frame, and the REST book caps at 200.
Thinner books send what they hold: ETH 90 to 96 bids and 45 to 49 asks, ENA 37 to 40 per side, IRYS 13 and 14.

### Size unit against the catalog's `multiplier`

| contract | `multiplier` | socket size at the touch | REST size at the same price | coins |
|---|---|---|---|---|
| `BTC-SWAP-USDT` | 0.0001 | `"129032"` bid | `"129032"` bid | 12.9 BTC |
| `ETH-SWAP-USDT` | 0.01 | `"17731"` bid | | 177.3 ETH |

In the first and third `book` runs, 36 and 38 of the top 40 socket sizes on BTC equalled the REST book read just before the subscribe, a few versions earlier.
In the second run the compare fell on the cut `5/5` first frame and matched 8 of 40, so the probe now skips frames under 20 levels.
The unit is contracts of `multiplier` coins, see [`rest.md`](./rest.md) section 2.
Without a CCXT class, a catalog that sets `contractSize` to `multiplier` makes the engine's size multiplication correct.

### One-sided and empty books

No empty side was seen on a visible contract.
`IRYS-SWAP-USDT` sent a `1/1` book as its only frame in one run.
In the next run the socket sent `13/14` for version `955782_18`, while REST served that same version as `1/1`, `5/5` or `13/14` depending on the `limit`, so a `1/1` IRYS book is most likely cut and not thin.

### Idle repeats and push rate

| contract | frames in 60 s, three runs | median gap | longest gap |
|---|---|---|---|
| `BTC-SWAP-USDT` | 159, 154, 156 | 303 ms | 957, 606 and 623 ms |
| `ETH-SWAP-USDT` | 25, 45, 48 | 528 to 604 ms | 23.7, 15.9 and 14.7 s |
| `ENA-SWAP-USDT` | 49, 35, 55 | 601 to 903 ms | 5.4, 9.0 and 7.2 s |
| `IRYS-SWAP-USDT` | 2, 1, 1 | | 15.5 s in the run with two |

Pushes come at most about every 300 ms and only when the book changed.
To tell a silent stream from a quiet book, the second and third `book` runs read the ETH REST book once a second beside the socket.
REST was ahead of the socket on 1 and 3 of 60 reads, and the socket's last frame was at most 586 ms old at those reads, so the long ETH gaps were a book that did not change and not a stalled stream.
`ETH-SWAP-USDT` reported 3.5 billion USDT of 24 h volume in the same hour, which is a lot of volume for a book that went 15 to 24 s without a change.

### Unknown, closed and duplicate subscriptions

| request | reply | then |
|---|---|---|
| `depth` `NOPE-SWAP-USDT` | `{"code":"-100010","desc":"Invalid Symbols!"}` | socket stays open |
| `depth` with no `symbol` | the same `-100010` frame | |
| `depth` `CATI-SWAP-USDT`, delisted on 2026-03-19 | the same `-100010` frame | |
| topic `nope` | `{"code":"-10004","desc":"Invalid topic!"}` | |
| event `nope` | `{"code":"-10002","desc":"Invalid event!"}` | |
| text that is not JSON | `{"code":"-10001","desc":"Invalid JSON!"}` | socket stays open |
| the same `depth` subscription twice with one `id` | the snapshot twice, same `v` | one stream |
| the same topic and symbol under a second `id` | the stream continues under the second `id` only | one stream |
| `{"topic":"depth","event":"cancel","symbol":…}` | no acknowledgement, as documented | the stream stopped, with at most one frame already in flight |

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client `{"ping": 1764579210000}`, server `{"pong": 1764579210000}`, S2 | sent `{"ping":1790146584133}`, got `{"pong":1790146584193}` about 124 to 132 ms later, so the pong carries the server's clock |
| silence the server tolerates | "If no heartbeat message is received within 60 seconds, the server will close the connection.", S2 | a socket with no subscription and no client frame closed 60.52 and 60.55 s after it was created, about 60 s after it opened, with 1006 and no close frame. A socket subscribed to BTC that never sent another frame stayed open for the full 100 s, and so did an unsubscribed socket that pinged every 20 s, in both runs |
| server ping | the demo page answers server pings, S4 | none, neither JSON nor protocol ping, on any socket in 100 s |
| forced disconnect | Not publicly specified | none in 100 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON by default. `params.binary: true` switches a stream to gzip binary frames. A client that offered permessage-deflate got no extension back, so the server does not negotiate it |
| handshake | | 499 to 558 ms on the market socket, 839 and 862 ms on the funding socket |
| subscription limits | "Max connections: 5", and 60 connections a minute per API key, S2 | not tested. 124 subscriptions on one socket all delivered |
| throughput | | every visible perpetual, 124 streams on one socket: 33 and 26 frames per second median, 168 and 158 at peak, 69 and 58 KB per second, 1,931 and 1,988 bytes per frame, 107 and 130 µs of `JSON.parse` per frame, over 45 s and 30 s |

A subscribed busy socket survived without pings, but a subscription on a quiet book was not tested for silence, so the feed should ping.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Book arrays keep three levels per side.

Subscribe, one symbol per frame.

```json
{"id": "depth.ETH-SWAP-USDT", "topic": "depth", "event": "sub", "symbol": "ETH-SWAP-USDT", "params": {}}
```

`depth`, the whole book in every frame.

```json
{"symbol":"ETH-SWAP-USDT","symbolName":"ETH-SWAP-USDT","topic":"depth","params":{"realtimeInterval":"24h"},"data":[{"s":"ETH-SWAP-USDT","t":1790145472808,"v":"21364400_18","b":[["2756.9","17731"],["2756.8","18793"],["2756.7","19975"]],"a":[["2757.1","18104"],["2757.2","23210"],["2757.3","21002"]],"o":0}],"sendTime":1790145473181,"id":"depth.ETH-SWAP-USDT"}
```

`diffDepth`, the first frame, which is a whole book with `s`, and a delta without `s`, whose `o` is not 0 and is Not publicly specified.

```json
{"symbol":"ENA-SWAP-USDT","symbolName":"ENA-SWAP-USDT","topic":"diffDepth","params":{"realtimeInterval":"24h"},"data":[{"s":"ENA-SWAP-USDT","t":1790145639143,"v":"16508187_18","b":[["0.21832","11378"],["0.21831","11516"],["0.21797","45282"]],"a":[["0.21846","12962"],["0.21847","13348"],["0.21869","37092"]],"o":0}],"sendTime":1790145641705,"id":"diff.ENA-SWAP-USDT"}
```

```json
{"symbol":"ENA-SWAP-USDT","symbolName":"ENA-SWAP-USDT","topic":"diffDepth","params":{"realtimeInterval":"24h"},"data":[{"t":1790145641916,"v":"16508195_18","b":[["0.21834","12732"],["0.21833","12550"],["0.21832","0"],["0.21831","0"]],"a":[["0.21846","0"],["0.21848","13336"]],"o":205315}],"sendTime":1790145641954,"id":"diff.ENA-SWAP-USDT"}
```

`markKline_1m` and `indexKline_1m` on `BTCUSDT`.

```json
{"symbol":"BTCUSDT","topic":"markKline","params":{"realtimeInterval":"24h","klineType":"1m"},"data":[{"t":1790145540000,"s":"BTCUSDT","sn":"BTCUSDT","c":"86492","h":"86492","l":"86491.6","o":"86489.7","v":"0"}],"sendTime":1790145545916,"id":"v_markIndexId"}
```

```json
{"symbol":"BTCUSDT","symbolName":"BTCUSDT","topic":"indexKline","params":{"realtimeInterval":"24h","klineType":"1m"},"data":[{"t":1790145540000,"s":"BTCUSDT","sn":"BTCUSDT","c":"86541.4","h":"86541.4","l":"86539.6","o":"86539.3","v":"0"}],"sendTime":1790145545917,"id":"v_indexIndexId"}
```

Keepalive.

```json
{"ping": 1790146584133}
```

```json
{"pong":1790146584193}
```

Errors.

```json
{"code":"-100010","desc":"Invalid Symbols!"}
```

```json
{"code":"-10004","desc":"Invalid topic!"}
```

Funding socket, the acknowledgement and one row of a push of 200.

```json
{"code":"200","topic":"fund_rates","event":"subbed"}
```

```json
{"code":"200","topic":"fund_rates","event":"sub","data":[{"symbolId":"BTC-SWAP-USDT","currentTime":"1790145888006","settleTime":"1790136000000","settleRate":"0.000000673918148608","nextSettleTime":"1790164800000","fundRate":"0.000002247919017887"}]}
```

## 7. Private channels

Named for a future execution stage, from S2 and S6, not probed.
They use `wss://uapi.echobit.com/uapi/ws/information` with an API key, a timestamp and a signature.

- Spot: `coin_history_trade`, `coin_current_order`, `coin_order_finish`, `coin_property`, `coin_plan_order`.
- Futures: `contract_property`, `contract_can_trade`, `contract_position`, `contract_current_order`, `contract_order_finish`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://uapi.echobit.com/uapi/exchange/ws` | one socket carries every perpetual |
| channel | `depth`, `symbol` = `rawMarketId` | a whole book in every frame, so no sequence to keep and nothing to lose |
| markets per connection | all 124 on one socket, or two sockets of 62 to stay far from the documented five | 124 ran with every stream delivered at 26 to 33 frames per second |
| subscribe frames | one frame per market, `{"id": "depth.<rawMarketId>", "topic": "depth", "event": "sub", "symbol": "<rawMarketId>", "params": {}}` | the documented shape, 124 frames sent in 2 ms without a refusal |
| keepalive | `{"ping": <Date.now()>}` every 20 s | the documented heartbeat, and a silent unsubscribed socket dies at 60 s |
| `maxSilenceMs` | 45,000 | two missed pongs. `IRYS-SWAP-USDT` sent one frame in a whole minute, so the pong must count as traffic |
| routing | `topic === "depth"`, then `symbol` | frames carry the contract id as sent |
| book | on every frame, `resetBook` with all of `b` and `a`, then `publish` | each frame is the whole book |
| version | keep `n` of `v` and drop a frame whose `n` is not above it | never seen, but cheap |
| cut first frame | treat a first frame of exactly 1, 5 or 20 levels per side as provisional, or read the REST book once and keep the deeper of the two until the next push | first frames looked cut on 20 of 124 streams in one batch run |
| resync | on close only, by reconnecting and resubscribing | there is no gap to detect |
| errors | log `code` and `desc`, and match `-100010` to the subscription that produced it by order | error frames carry no `id` |
| receive time | stamp on arrival, never from `t` | a quiet book's `t` was 35 to 144 s old |
| deflate | keep `perMessageDeflate: false`, and never send `binary: true` | the server does not negotiate deflate, and `binary` switches to gzip |
| anchor | `markKline_1m` and `indexKline_1m` per `indexId` on the same socket, and `fund_rates` on the funding socket | the only bulk source of mark and index, see [`rest.md`](./rest.md) section 8 |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Echobit API docs, Websocket, Quote: endpoint, parameters, `quotesData`, `depth`, `kline`, `markKline`, `indexKline`, `trade` | https://echobit.gitbook.io/echobit-user-docs/en/websocket/quote.md | 2026-09-22 | Echobit | sections 1 to 4 |
| S2 | Echobit API docs, Websocket, Authentication and Rate Limits: the three endpoints, connection limits, heartbeat, sub and unsub | https://echobit.gitbook.io/echobit-user-docs/en/websocket/authentication-and-rate-limits.md | 2026-09-22 | Echobit | sections 1, 3, 5 and 7 |
| S3 | Echobit API docs, Websocket, FundRate | https://echobit.gitbook.io/echobit-user-docs/en/websocket/fundrate.md | 2026-09-22 | Echobit | sections 1, 2 and 6 |
| S4 | Echobit API docs, FAQ, Websocket Page Demo: templates and a handler that answers server pings | https://echobit.gitbook.io/echobit-user-docs/en/faq/websocket-page-demo.md | 2026-09-22 | Echobit | sections 3 and 5 |
| S5 | Echobit homepage, `window.__NUXT__.config` with `proxyWsCommon` and `proxyWsUser` | https://www.echobit.com/en-us | 2026-09-22 | Echobit | section 1 |
| S6 | Echobit API docs, Websocket, Exchange: private topics | https://echobit.gitbook.io/echobit-user-docs/en/websocket/exchange.md | 2026-09-22 | Echobit | section 7 |
| P1 | `ws-probe.mjs book`, three runs at 06:37, 06:47 and 06:49 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/echobit/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 3 and 4 |
| P2 | `ws-probe.mjs diff` at 06:40 and 06:53 UTC, and `variants` at 06:39 and 06:54 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/echobit/ws-probe.mjs) | 2026-09-22 | this host | sections 2 and 4 |
| P3 | `ws-probe.mjs errors` at 06:39 and 06:55 UTC, and `batch` at 06:41 and 06:55 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/echobit/ws-probe.mjs) | 2026-09-22 | this host | sections 3 to 5 |
| P4 | `ws-probe.mjs silence` at 06:42 and 06:56 UTC, `fund` at 06:44 and 06:57 UTC, `deflate` at 06:45 and 06:58 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/echobit/ws-probe.mjs) | 2026-09-22 | this host | sections 2, 5 and 6 |
| P5 | a first exploratory socket at 06:29 UTC, from a scratch script not kept in the repository | | 2026-09-22 | this host | section 1 |
