# Deepcoin WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 between 03:16 and 03:48 UTC, from the development host near Seattle.

This profile covers the public WebSocket of Deepcoin (CCXT id `deepcoin`) for the perpetual families, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/deepcoin/ws-probe.mjs), run from `server/`, and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation site refuses this host with HTTP 403, so it was read through a fetch that does not originate here, see [`fees.md`](./fees.md) section 1.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-margined and inverse perpetuals | `wss://stream.deepcoin.com/streamlet/trade/public/swap?platform=api`, S1 | open in 551 to 660 ms over eleven sockets that logged it, CloudFront POP `SEA73-P3` |
| spot | `wss://stream.deepcoin.com/streamlet/trade/public/spot?platform=api`, S1 | not probed |
| "version 2" | `?platform=api&version=v2`, S1, with no description of what changes | opens in 520 and 573 ms and answers `ping` with `pong`, but a v1 subscribe frame got no acknowledgement and no data in 12 s, in both runs |
| private | `wss://stream.deepcoin.com/v1/private?listenKey=…`, from CCXT Pro | not probed |

One socket carries both perpetual families.
`LTCUSD` and `ETHUSD` inverse books and the `ETHUSD` ticker delivered on the swap URL beside USDT contracts, in both `errors` runs.
`stream.deepcoin.com` is a CNAME of `d345r20ajgsvyg.cloudfront.net` and resolved to four addresses in `18.172.170.0/24`.

## 2. Channel matrix for public market data

Channels are numbered by `TopicID`, and the stream is named by `FilterValue`.

| TopicID | name in the docs | FilterValue | depth and speed | probed on 2026-09-22 |
|---|---|---|---|---|
| `25` | Level Incremental Market Data | `DeepCoin_<wire id>_<tick size>`, for example `DeepCoin_BTCUSDT_0.1` | "Notification push frequency: 200 ms/time. Supports up to 60 levels.", S2 | snapshot then deltas, recommended, section 4 |
| `7` | The Latest Market Data | `DeepCoin_<wire id>` | on change | 168 to 278 frames in 60 s on BTC and ETH, 34 to 82 on quieter contracts, carries mark `M`, index `D`, funding rate `E`, next settlement `PF` |
| `2` | Last Transactions | `DeepCoin_<wire id>` | on trade | not probed |
| K-lines | K-Lines | `DeepCoin_<wire id>_<period>` | periods `1m` to `1y` | not probed |
| liquidations | Liquidation Order | | | not probed |

No best bid and ask channel is documented beyond `BP1` and `AP1` inside the TopicID 7 ticker.
No dedicated mark, index or funding channel exists, and TopicID 7 carries all of them, see section 3 of [`rest.md`](./rest.md) for why it matters.
The wire id is the CCXT `market.id` with the `-SWAP` suffix and the first dash removed, so `BTC-USDT-SWAP` is `BTCUSDT` and `ETH-USD-SWAP` is `ETHUSD`.
The rule gave 353 distinct wire ids for 353 swaps.

### TopicID 7 against REST

At three instants in each `book` run the last TopicID 7 frame was read against the bulk REST calls.

| ticker field | documented meaning, S3 | REST field it equalled | matches |
|---|---|---|---|
| `M` | "Marked price" | `markPx` of `/deepcoin/market/mark-price` | 12 of 12 in the first run, 11 of 12 in the second, the miss was `ETHUSDT` 2778.37 against 2778.3 |
| `D` | "Underlying price" | no live REST field exists, see [`rest.md`](./rest.md) section 3 | |
| `E` | "Previous position fee rate" | `fundingRate` of `/deepcoin/trade/fund-rate/current-funding-rate` | 12 of 12 in the second run, so it is the upcoming rate and not the previous one |
| `PF` | "Position fee time" | `nextSettleTime` of `/deepcoin/trade/funding-rate` | 12 of 12 in the second run |
| `U` | "The latest update time(ms)" | | arrival minus `U` had a median of 131 to 146 ms per contract, and a maximum of 438 ms on BTC and 3,600 ms on `TMFUSDT` |

A quiet contract sent a ticker frame at least every 5.0 s: the longest silence was 5,001 to 5,004 ms on `SUSDT` and `TMFUSDT`, and 1,121 to 1,287 ms on BTC and ETH.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for contracts, one for spot, S1 | USDT and inverse contracts share the swap URL, section 1 |
| subscribe frame shape | `{"SendTopicAction": {"Action": "1", "FilterValue": "DeepCoin_BTCUSDT_0.1", "LocalNo": 6, "ResumeNo": -1, "TopicID": "25"}}`, one stream per frame, S2 | as documented. The key is also accepted as `sendTopicAction`, which is how CCXT Pro spells it |
| unknown symbol expectation | Not publicly specified | `RecvTopicAction` with `m` `orderbook does not exist: NOPEUSDT_0.1, no available orderbook data` |
| chunk unit and budget | "Same IP limited to 10 concurrent connections. Connection count is limited but no rate limit applies.", S1 | 348 subscribe frames in one 5 ms burst: 324 then 30 acknowledged, and the second socket fell silent after 0.5 s. The same 348 paced at 20 frames per 100 ms: 348 of 348 acknowledged and snapshotted, four times |
| keepalive mechanism | "The connection automatically disconnects after 20 seconds. A Ping message needs to be sent to maintain the heartbeat connection." Request text `ping`, answer `pong`, S1 | as documented. `pong` in 168 to 178 ms. No server protocol ping on any socket |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 60 s, no notice seen |
| handshake and operation rate limits | 10 connections per IP, S1 | at most three sockets were open at once, so the cap was not reached |
| public market data authentication | none | none |
| message parse and routing | fields `a` (`PMO`), `t`, `r[].d` holding `I`, `D`, `P` and `V`, then `tt`, `mt` and `pt`, S2 | routes on `r[0].d.I`, the wire id, and every level of a frame repeats it |
| subscribe acknowledgement shape | Not publicly specified | `{"a":"RecvTopicAction","m":"Success","r":[{"d":{"A":"1","L":1,"T":"25","F":"DeepCoin_BTCUSDT_0.1","R":-1}}]}`, a failure carries the reason in `m` |
| symbol identifier format | `BTCUSDT` for contracts, `BTC/USDT` for spot, S1 | the wire id of section 2, which is not the CCXT `market.id` |
| number representation | `P` and `V` typed "int" in S2, with the example `"P": 115970.7, "V": 13285.0` | JSON numbers, sizes written with a trailing `.0` such as `"V":444.0` |
| timestamp representation | `tt`, `mt`, `pt` in ms, S2 | integer ms on every book frame, `mt` advancing by 200 ms |
| size unit | Not publicly specified | contracts of CCXT `contractSize` coins, section 4 |
| sequence semantics | none documented | no sequence number exists. Frames carry only `tt`, `mt` and `pt` |
| idle repeat behaviour | not documented | a quiet book sends frames that repeat unchanged levels: 269 and 277 of about 292 deltas on `TMFUSDT` changed nothing |

## 4. The book channel in detail

TopicID 25 is the channel this profile recommends, and every row below is about it.

### The tick size suffix

The FilterValue must end with the contract's `tickSz` from the instruments call, spelled as that call spells it.

| FilterValue | reply |
|---|---|
| `DeepCoin_BTCUSDT_0.1`, the tick size | `Success` and data |
| `DeepCoin_BTCUSDT_1` or `DeepCoin_BTCUSDT_0.5` | `orderbook does not exist: BTCUSDT_1, no available orderbook data`, and the same for 0.5 |
| `DeepCoin_BTCUSDT` | `invalid FilterValue format: DeepCoin_BTCUSDT` |
| `DeepCoin_TMFUSDT_0.0001` for a 0.01 tick | `orderbook does not exist` |
| `DeepCoin_ETHUSD_0.01` for a 0.05 tick | `orderbook does not exist`, while `DeepCoin_ETHUSD_0.05` delivers |

The documentation calls the suffix "the number of decimal places", S2, and only the tick size itself was served.
CCXT Pro hardcodes `_0.1` for every market at `server/node_modules/ccxt/js/src/pro/deepcoin.js` line 627, so its order book watch fails on every contract whose tick is not 0.1, which is 350 of 353, all but `BTC-USDT-SWAP`, `DIS-USDT-SWAP` and `V-USDT-SWAP`.
A feed must take the string `market.info.tickSz`, because CCXT's numeric `precision.price` prints as `1e-7` or `1e-8` on 10 contracts.
All 348 USDT tick sizes, including `0.0000001` and `0.00000001`, were acknowledged in the batch runs.

### Snapshot on subscribe

The first frame for each stream is `"t":"f"` with up to 60 levels per side, and the first snapshot of a batch arrived 169 to 202 ms after the first subscribe frame.
A second `f` frame also arrives mid-stream without being asked for: 22 to 155 of 348 streams got one within 45 s in the paced batch runs, and BTC got one 25 s in during the first `book` run.
A repeated subscribe on the same socket forces one: `XRPUSDT` resubscribed at 7,506 ms was acknowledged at 7,678 ms and sent a new snapshot at 7,679 ms, and the delta rate did not double.
So a feed resets on every `f`, not only the first.
A thin book's snapshot holds fewer levels: the median snapshot over 348 contracts held 29 or 30 bids, and 0 to 3 contracts per batch run held fewer than 20 on a side.

### Delta semantics

A delta is `"t":"i"` with one `r` entry per level, each a `d` object holding `I`, `D`, `P` and `V`, where `D` is `"0"` for a bid and `"1"` for an ask.
A `V` of 0 deletes the level: 3,575 and 4,377 zero-size levels arrived on BTC in 60 s in the two runs.
A delta covers what changed during one 200 ms push, and it repeats levels that changed and changed back: BTC deltas carried a median of 38 levels, and up to 252.

### Sequence and gap rule

No sequence number exists, so a lost delta cannot be detected from the frame alone.
`mt` advances by 200 ms per push, with a median gap of 200 ms on every stream.

| probe | streams | pushes skipped, a gap over 300 ms | crossed local books |
|---|---|---|---|
| `book`, four contracts, 60 s, two runs | 4 | 0 on BTC and ETH, 8 to 9 on the two quiet contracts in the second run | 0 in both runs |
| `batch 35 35`, the 35 busiest contracts, 45 s | 35 | 345 in 21 streams | 0 |
| `batch 348 20`, every USDT contract, 45 s, four runs | 348 | 2,318 in 313 streams, and 2,467 in 332 streams, in the two runs that counted them | 8, 11, 11 and 26 streams, 8 to 37 episodes per run, 5 to 8 still crossed at the end |

In the runs that counted them, 10 of 13 and 24 of 37 crossing episodes began on the first frame after a skipped push.
The stale levels were read against REST at the end of each run, and they were real levels the socket never removed: on `ETH-USDT-SWAP` five asks from 2,766.42 to 2,766.58 stayed after the bid moved to 2,766.81, and REST held none of them.
In the captured `ETHUSDT` stream the frame after a 398 ms gap carried 74 levels with 36 deletions, and the deletion of the 2,766.42 ask was not among them.
No crossed stream was repaired by a later mid-stream snapshot in any run.
`mt` went backwards 0 to 18 times per paced full batch run, and never in the four-contract runs.
So a push is sometimes dropped, and on a socket carrying all 348 contracts at about 1,570 frames per second it corrupted 8 to 26 books per 45 s, while 35 contracts on one socket stayed clean.
A quiet contract also leaves gaps longer than 300 ms without losing anything, so a gap rule would resync healthy books.

```text
t = "f"                        replace the book
t = "i"                        apply each level by price, V = 0 deletes
after any delta, best bid >= best ask     crossed: resubscribe the stream on the same socket, which returns a fresh "f"
```

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on every snapshot of both runs | best first, ascending |
| delta | unordered in 71 to 142 of 299 BTC and ETH deltas per run | unordered in 82 to 139 of 299 |
| REST `books` | descending | ascending |

A feed applies deltas by price and never by position.

### Level window

Documented as "up to 60 levels".
A book maintained from the snapshot and every delta held at most 61 to 63 levels on BTC and 63 to 72 on ETH, so a level leaving the window is not always deleted.
Thin books stayed at or under 30 levels per side.
The top 20 is what the engine holds, and it matched REST on every compare, see below.

### Size unit against CCXT `contractSize`

At 20, 40 and 58 s in each `book` run the local top 20 was read against `GET /deepcoin/market/books?sz=20`.

| contract | CCXT `contractSize` | socket size at the touch | REST size at the same price | prices equal in the top 20, both sides, all six reads |
|---|---:|---|---|---|
| `BTC-USDT-SWAP` | 0.001 | `10006` | `10.006` | 20 of 20 |
| `ETH-USDT-SWAP` | 0.1 | `1686.2` | `168.62` | 20 of 20 |
| `AXTI-USDT-SWAP` | 0.1 | `1676` | `167.6` | 20 of 20, first run |
| `S-USDT-SWAP` | 1 | same | same | 20 of 20, second run |
| `TMF-USDT-SWAP` | 0.1 | `206` | `20.6` | 20 of 20 |

The socket reports contracts and the REST book reports coins.
Every socket size times `contractSize` equalled the REST size on 20 of 20 levels per side in all 24 reads.
One contract is `ctVal` coins, which is exactly what CCXT reports as `contractSize` at `server/node_modules/ccxt/js/src/deepcoin.js` line 538, so the engine's `sizeMul` converts socket sizes correctly.
Sizes are fractional on contracts whose `lotSz` is 0.1, such as `ETH-USDT-SWAP`.

### One-sided and empty books

No one-sided or empty book was seen, so what TopicID 25 sends for a side with no orders is Not verified.
One to three contracts in each paced batch run sent a snapshot and then no delta in 45 s.

### Idle repeats

A quiet book repeats unchanged levels rather than falling silent: `TMFUSDT` sent 291 to 293 deltas in 60 s, of which 269 to 277 changed nothing, and `AXTIUSDT` 205 of 292.
On a full batch run 28 to 30 contracts sent fewer than 100 deltas in 45 s, and the longest silence on one stream was 18.6 to 39.0 s.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `DeepCoin_NOPEUSDT_0.1` | `orderbook does not exist: NOPEUSDT_0.1, no available orderbook data` | nothing |
| `DeepCoin_BTC-USDT-SWAP_0.1`, the CCXT id | `orderbook does not exist: BTC-USDT-SWAP_0.1, …` | nothing |
| `DeepCoin_ETHUSDT_0.01,DeepCoin_SOLUSDT_0.01` | `Success` | `ETHUSDT` delivered and `SOLUSDT` never did |
| `DeepCoin_BTCUSDT_0.1` twice | `Success` twice | a second snapshot, one stream |
| the same `LocalNo` reused | `Success` | the stream delivers |
| `TopicID` `99` | no reply at all | |
| text `hello` | `{"a":"","m":"readObjectStart: expect { or n, but found h, error found in #1 byte of ...\|hello\|..., bigger context ...\|hello\|...","r":null}` | the socket stays open |
| `Action` `"2"`, unsubscribe, with a new or with the original `LocalNo` | `unsupportedAction` | the stream keeps delivering |
| `Action` `"0"`, unsubscribe all | `localIDNotExist` | the stream keeps delivering |

A closed or delisted contract was not available to probe, since all 353 swaps were `live`.
No form of unsubscribe worked, so dropping a stream means closing its socket.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | text `ping`, answer `pong`, S1 | `pong` in 168 to 178 ms on ten pings. No server protocol ping |
| silence the server tolerates | 20 s without a ping, S1 | a socket that sent no `ping` closed at 19,998 to 20,176 ms with code 1000 and reason `heartbeat timeout`, whether or not it was subscribed and receiving data, four sockets over two runs. A `ping` every 10 s kept a socket open for the full 45 s |
| forced disconnect | Not publicly specified | none in 60 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames. A client that offers permessage-deflate gets `permessage-deflate; server_no_context_takeover; client_no_context_takeover` back, so the server negotiates it when asked. The engine does not ask, and got no extension header |
| handshake | | 551 to 660 ms to open the swap URL from this host |
| subscription limits | 10 connections per IP, S1 | 348 streams on one socket were served when the subscribes were paced, a 5 ms burst of 348 was not |
| throughput | | all 348 USDT contracts on one socket: median 1,563 to 1,581 frames per second, 1.10 to 1.17 MB per second, 685 to 707 bytes per frame, 8.4 to 10.2 µs `JSON.parse` per frame. The 35 busiest: 152 frames per second, 158 KB per second |

## 6. Captured frames

Trimmed, from the second pass on 2026-09-22.
Arrays marked `…` are cut.

Subscribe.

```json
{"SendTopicAction": {"Action": "1", "FilterValue": "DeepCoin_BTCUSDT_0.1", "LocalNo": 1, "ResumeNo": -1, "TopicID": "25"}}
```

Acknowledgement.

```json
{"a":"RecvTopicAction","m":"Success","r":[{"d":{"A":"1","L":1,"T":"25","F":"DeepCoin_BTCUSDT_0.1","R":-1}}]}
```

Snapshot of `TMFUSDT`, three levels per side kept of 59.

```json
{"a":"PMO","t":"f","r":[{"d":{"I":"TMFUSDT","D":"0","P":29.99,"V":444.0}},{"d":{"I":"TMFUSDT","D":"0","P":29.98,"V":5984.0}},{"d":{"I":"TMFUSDT","D":"0","P":29.97,"V":4590.0}},{"d":{"I":"TMFUSDT","D":"1","P":30.02,"V":396.0}},{"d":{"I":"TMFUSDT","D":"1","P":30.03,"V":36.0}},{"d":{"I":"TMFUSDT","D":"1","P":30.04,"V":3108.0}}],"tt":1790135043396,"mt":1790135043396,"pt":1790135043396}
```

Delta on `BTCUSDT`, first three levels per side kept of 40, and two of its deletions.

```json
{"a":"PMO","t":"i","r":[{"d":{"I":"BTCUSDT","D":"0","P":86788.9,"V":566.0}},{"d":{"I":"BTCUSDT","D":"0","P":86788.8,"V":2.0}},{"d":{"I":"BTCUSDT","D":"0","P":86788.3,"V":2.0}},{"d":{"I":"BTCUSDT","D":"1","P":86789,"V":7357.0}},{"d":{"I":"BTCUSDT","D":"1","P":86789.1,"V":2.0}},{"d":{"I":"BTCUSDT","D":"1","P":86789.6,"V":1.0}}],"tt":1790135044344,"mt":1790135044348,"pt":1790135044355}
```

```json
[{"d":{"I":"BTCUSDT","D":"0","P":86732,"V":0}},{"d":{"I":"BTCUSDT","D":"1","P":86846.7,"V":0}}]
```

An idle delta on `TMFUSDT` that repeats the touch unchanged.

```json
{"a":"PMO","t":"i","r":[{"d":{"I":"TMFUSDT","D":"0","P":29.99,"V":444.0}},{"d":{"I":"TMFUSDT","D":"1","P":30.02,"V":396.0}}],"tt":1790135043744,"mt":1790135043745,"pt":1790135043752}
```

Keepalive: the client sends the text `ping` and the server answers the text `pong`, neither of which is JSON.

Errors.

```json
{"a":"RecvTopicAction","m":"orderbook does not exist: NOPEUSDT_0.1, no available orderbook data","r":[{"d":{"A":"1","L":3,"T":"25","F":"DeepCoin_NOPEUSDT_0.1","R":-1}}]}
```

```json
{"a":"RecvTopicAction","m":"unsupportedAction","r":[{"d":{"A":"2","L":14,"T":"25","F":"DeepCoin_BTCUSDT_0.1","R":-1}}]}
```

Ticker, TopicID 7, which carries the anchor fields.

```json
{"a":"PO","m":"Success","tt":1790135043072,"mt":1790135043072,"r":[{"d":{"I":"BTCUSDT","U":1790135043044,"PF":1790150400,"E":-0.00015214,"O":86367.4,"H":86928.5,"L":85954.5,"V":11464821.0,"T":990546657.261387,"N":86799.5,"M":86803.1,"D":86844.91,"V2":28852037.0,"T2":2482617871.606899,"F":43422.5,"C":130267.3,"BP1":86799.5,"AP1":86799.6}}]}
```

## 7. Private channels

Named for a future execution stage, not probed.
The private socket is `wss://stream.deepcoin.com/v1/private?listenKey=<key>`, with the key from `GET /deepcoin/listenkey/acquire` and kept alive by `GET /deepcoin/listenkey/extend`, as CCXT Pro builds it at `server/node_modules/ccxt/js/src/pro/deepcoin.js` line 156 and `server/node_modules/ccxt/js/src/deepcoin.js` lines 196 and 197.
Since 2026-06-11 a `tables` parameter selects channels, since 2026-06-19 the socket takes `batch-orders` of up to 5 orders, and since 2026-06-29 `batch-cancel-order`, S5.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, the swap URL, for the 348 USDT contracts | both families share it, and the 5 inverse contracts duplicate USDT pairs, see [`rest.md`](./rest.md) section 2 |
| channel | TopicID 25, FilterValue `DeepCoin_<wire id>_<market.info.tickSz>` | the only book channel, snapshot on subscribe, 60 levels |
| markets per connection | 35, which is 10 sockets for 348 contracts | 35 contracts on one socket ran clean and 348 corrupted 8 to 26 books per 45 s. Ten sockets is the whole allowance of 10 connections per IP, so a reconnect must close before it opens, and a slice larger than 35 was not tested for loss |
| subscribe frames | one frame per stream, paced at no more than 20 per 100 ms | a burst of 348 in 5 ms lost acknowledgements and then the whole socket |
| keepalive | text `ping` every 10 s | the server closes a socket 20 s after the last ping, whatever data flows |
| `maxSilenceMs` | 25,000 | every `pong` counts as traffic, and a quiet book went up to 39.0 s without a book frame |
| routing | `r[0].d.I` to `rawMarketId` through a map built from the catalog | the wire id is the CCXT id without `-SWAP` and the first dash |
| snapshot | `t === "f"`: `resetBook` | a mid-stream `f` also arrives |
| delta | apply by price, `V === 0` deletes, then `publish` | no sequence to check |
| resync | after a delta leaves best bid at or above best ask, resend that stream's subscribe frame on the same socket and discard deltas until its `f` arrives | a repeat subscribe returns a fresh snapshot in about 170 ms. The engine's `resync` terminates the socket, which also works and costs 35 books |
| unserved stream | log a stream whose acknowledgement is not `Success`, or that has no `f` 10 s after it | a wrong suffix or id is refused in the acknowledgement |
| receive time | stamp on arrival | `mt` is server time and advanced normally, but the engine stamps arrival everywhere |
| deflate | keep `perMessageDeflate: false` | the server compresses only when asked |

A crossed-book check cannot see a stale level that does not cross, so this rule narrows the loss without removing it.
A periodic resubscribe of each stream, for example every 60 s, would bound how long any stale level survives.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Deepcoin API, Public WebSocket | https://www.deepcoin.com/docs/publicWS/public | 2026-09-22, through the fetch | Deepcoin, global | URLs, version 2, heartbeat, connection limit, subscribe fields, sections 1, 3 and 5 |
| S2 | Deepcoin API, Level Incremental Market Data | https://www.deepcoin.com/docs/publicWS/LevelIncrementalMarketData | 2026-09-22, through the fetch | Deepcoin, global | TopicID 25 frames, 200 ms, 60 levels, sections 2 to 4 |
| S3 | Deepcoin API, The Latest Market Data | https://www.deepcoin.com/docs/publicWS/latestMarketData | 2026-09-22, through the fetch | Deepcoin, global | TopicID 7 fields, section 2 |
| S5 | Deepcoin API changelog | https://www.deepcoin.com/docs/changelog | 2026-09-22, through the fetch | Deepcoin, global | private socket changes, section 7 |
| X1 | CCXT Pro 4.5.68 `deepcoin.js` | `server/node_modules/ccxt/js/src/pro/deepcoin.js` | 2026-09-22 | CCXT | URLs at lines 52 to 55, `_0.1` suffix at line 627, private URL at line 156, sections 1, 4 and 7 |
| X2 | CCXT 4.5.68 `deepcoin.js` | `server/node_modules/ccxt/js/src/deepcoin.js` | 2026-09-22 | CCXT | `contractSize` from `ctVal` at line 538, listen key calls, sections 4 and 7 |
| P1 | `ws-probe.mjs book`, at 03:22 and 03:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/deepcoin/ws-probe.mjs) | 2026-09-22 | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs errors`, at 03:24, 03:45 and 03:48 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/deepcoin/ws-probe.mjs) | 2026-09-22 | this host | sections 1, 3 and 4 |
| P3 | `ws-probe.mjs batch`, one burst at 03:24, one at 03:26, paced at 03:27, 03:28, 03:30 and 03:45, and `batch 35 35` at 03:31 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/deepcoin/ws-probe.mjs) | 2026-09-22 | this host | sections 3 to 5 |
| P4 | `ws-probe.mjs silence` and `deflate`, at 03:32 and 03:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/deepcoin/ws-probe.mjs) | 2026-09-22 | this host | sections 1 and 5 |
| P5 | exploratory sockets at 03:16 to 03:18 UTC before the probe was written | | 2026-09-22 | this host | the v2 URL and the suffix rule, sections 1 and 4 |
