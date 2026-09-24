# BitMart WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 03:31 and 03:41 UTC on 2026-09-23, and again between 03:50 and 03:56 UTC in the second pass.

This profile covers the public futures WebSocket of BitMart (CCXT id `bitmart`) for every perpetual family, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitmart/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.

The finding that shapes everything else is the cadence.
Every public book channel, at every documented depth and speed, pushed once a second from this host, see section 4.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| all futures, public | `wss://openapi-ws-v2.bitmart.com/api?protocol=1.1`, S1, and CCXT Pro at `server/node_modules/ccxt/js/src/pro/bitmart.js` line 59 | open in 454 to 513 ms. USDT-M, USDC-M and coin-M contracts all delivered on one socket |
| all futures, private | `wss://openapi-ws-v2.bitmart.com/user?protocol=1.1`, S1 | not probed |
| simulated trading, public | `wss://openapi-wsdemo-v2.bitmart.com/api?protocol=1.1`, S1 change log 2025-11-18 | not probed |
| spot | `wss://ws-manager-compress.bitmart.com/api?protocol=1.1`, CCXT Pro line 55 | not probed, spot is out of scope |

One socket carries every perpetual family.
`BTCUSDT`, `BTCUSDC` and the coin-M `BTCUSD` streamed side by side on one connection with 0 gaps, in `ws-probe.mjs book`.
`openapi-ws-v2.bitmart.com` resolved to the Cloudflare addresses `104.18.16.176` and `104.18.17.176`, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | topic | depth and speed | probed on 2026-09-23 |
|---|---|---|---|
| `futures/depthIncrease{5,20,50}` | `futures/depthIncrease50:BTCUSDT@100ms` | 5, 20 or 50 levels, `@100ms` or `@200ms`, S1 | snapshot then updates chained by `version`, one frame a second at every depth and speed, recommended |
| `futures/depthAll{5,20,50}` | `futures/depthAll20:BTCUSDT@100ms` | whole book each push, S1 | one frame a second: 29 data frames in 30 s on `depthAll20`, and gaps of p50 1,000 to 1,001 ms on `depthAll5` and `depthAll50` |
| `futures/depth{5,20,50}` | `futures/depth50:BTCUSDT@100ms` | one side per frame, `way` 1 bids and 2 asks, S1 | a bid frame and an ask frame together once a second, 50 frames in 25 s |
| `futures/v2/depthAll*`, `futures/v2/depthIncrease*` | `futures/v2/depthIncrease50:BTCUSDT@100ms` | levels as `[price, vol]` arrays, S1 | acknowledged on `BTCUSDT` and `ETHUSDT`. `v2/depthIncrease` then sent one empty snapshot with `version` 0 and nothing more, and `v2/depthAll` sent nothing, in two runs |
| `futures/bookticker` | `futures/bookticker:BTCUSDT` | "Real-time push", S1 | one frame a second, `ms_t` 1,000 ms apart |
| `futures/ticker` with a symbol | `futures/ticker:BTCUSDT` | "Sent once in 1 second", S1 | a frame every 2 to 3 s, carries `mark_price` and `index_price` |
| `futures/ticker` without a symbol | `futures/ticker` | every contract | 321 to 327 contracts, about 107 frames a second, each live contract every 1.9 to 6.0 s, see section 5 |
| `futures/fundingRate` | `futures/fundingRate:BTCUSDT` | on subscribe, then "every minute", S1 | one frame on subscribe, and the `request` action returns one at once |
| `futures/trade` | `futures/trade:BTCUSDT` | on trade | 24 and 25 frames in 25 s, gaps of 366 to 1,679 ms |
| `futures/klineBin1m`, `futures/markPriceKlineBin1m` | | | not probed |

Channel names, topics and speeds are from S1.
No mark or index channel exists apart from the ticker, and the ticker without a symbol is the only bulk source of the mark, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL for all futures, S1 | USDT-M, USDC-M and coin-M on one socket, section 1 |
| subscribe frame shape | `{"action":"subscribe","args":["<channel>:<symbol>@<speed>"]}`, several topics in `args`, S1 | six topics in one frame each got their own acknowledgement and each delivered |
| unknown symbol expectation | `success` false with `group [...] not exist`, S1 | `{"action":"subscribe","group":"futures/depthIncrease50:NOPEUSDT@100ms","success":false,"error":"Invalid channel: not found futures/depthIncrease50:NOPEUSDT@100ms",...}`. A delisted symbol answers the same. A `Trading` symbol with an empty book is acknowledged and sends one empty snapshot |
| chunk unit and budget | "the total length of multiple channels cannot exceed 4096 bytes", S1 | a 2,020 byte frame of 49 topics was accepted, and a 2,186 byte frame of 53 topics closed the socket with code 1009, 568 to 797 ms after the socket was created, in both runs of `ws-probe.mjs framecap` |
| keepalive mechanism | send a ping frame or the text `ping` after N < 20 s of quiet, expect text `pong`, S1 | the text `ping` is refused with `Invalid message: message must be JSON: ping`. `{"action":"ping"}` answers `{"group":"System","data":"pong+<uuid>"}`, and a protocol ping gets a protocol pong in 104 to 110 ms |
| connection lifetime and maintenance notice | "If no data is returned after connecting to WebSocket, the link will be automatically disconnected after 20s", and a socket that sends no subscription "within 5 seconds" is closed, S1 | no socket closed in 75 s in two runs, not even one that never subscribed and never sent a frame, section 5 |
| handshake and operation rate limits | "A maximum of 500 connections can be maintained between each IP and BitMart server", S1 | not approached. Opens took 454 to 513 ms |
| public market data authentication | none | none |
| message parse and routing | `{"group": "<topic>", "data": {...}}` | route on `group`, which repeats the topic including `@100ms`, or on `data.symbol` |
| subscribe acknowledgement shape | `{"action":"subscribe","group":"<topic>","success":true,"request":{...}}`, S1 | as documented, one acknowledgement per topic, each echoing the whole `request` |
| symbol identifier format | `BTCUSDT` | identical to CCXT `market.id` and to the REST `symbol` on 1,215 of 1,215 contracts |
| number representation | prices and volumes as strings | `{"price":"86659","vol":"18074"}` objects in v1 channels, `["70294.4","455"]` arrays documented for v2. `version` and `ms_t` are JSON integers |
| timestamp representation | `ms_t` in ms, S1 | `ms_t` in ms on a one second grid, for example `1790134356628`, `1790134357628`, `1790134358629` |
| size unit | "volume" | contracts, the same unit as the REST book and CCXT `contractSize`, section 4 |
| sequence semantics | `version` must be local plus one, else request a new snapshot, S1 | 0 gaps in 5,237 and 5,225 updates on 100 contracts over 60 s, and `version` rises by one per push, not per book event |
| idle repeat behaviour | not documented | a quiet book sends updates with empty `bids` and `asks` that still advance `version`, 7 of 31 and 2 of 44 on `ASTEROIDETHUSDT` |

## 4. The book channel in detail

`futures/depthIncrease50:<symbol>@100ms` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Cadence

The wire pushes once a second whatever the topic asks for.
Over 60 s in `ws-probe.mjs book`, `BTCUSDT` and `ETHUSDT` each sent 62 updates with arrival gaps of p50 1,000 to 1,001 ms, p90 1,005 ms and max 1,041 to 1,043 ms, in both runs.
In `ws-probe.mjs cadence`, `depthIncrease5@100ms`, `depthIncrease20@100ms`, `depthIncrease50@200ms` and `depthIncrease50` with no speed all sent 26 frames in 25 s, with `ms_t` gaps of p50 1,000 ms, in both runs.
`depthAll5`, `depthAll50`, `depth5`, `depth20` and `bookticker` kept the same one second grid.
The documentation promises 100 ms or 200 ms, S1, and CCXT Pro's comment says the full depth channels "emit full Orderbooks once in every 500ms", `pro/bitmart.js` line 73.
Neither matched the wire.

The `version` counter rises by one per push.
`BTCUSDT` read `version` 5,158,588 at 03:32:36 UTC and 5,159,667 at about 03:50:35 UTC, 1,079 versions in about 1,078 s.
At one push a second, 5,158,588 is about 60 days of pushes, which suggests the one second cadence has held for weeks, and that part is an inference.

A feed built on this channel sees each BitMart book at most once a second, and a cross against it can be up to about one second old when it opens.

### Snapshot on subscribe

The first frame for every stream is `"type":"snapshot"` with up to 50 bids and 50 asks and the stream's `version`.
Six streams each got exactly one snapshot and no further snapshot in 60 s, in both runs.
The `request` action, `{"action":"request","args":["futures/depthIncrease50:ETHUSDT@100ms"]}`, answered at once with a snapshot on the same `group`, which is the documented recovery path, S1.

### Delta semantics

An update carries `bids` and `asks` arrays of `{"price","vol"}` objects and the new `version`.
`vol` is the absolute size at that price, and `"0"` deletes the level, S1.
An update with both arrays empty is legal and only advances `version`.
The documented recipe discards an update whose `version` is not above the local one, S1.

### Sequence and gap rule

```text
type = snapshot                 replace the book, last = version
type = update, version <= last  discard (documented)
type = update, version = last + 1   apply, last = version
type = update, version > last + 1   gap: request a snapshot (documented), or terminate the socket (the engine's resync)
```

The rule held on every update of every run.
The first update after each snapshot had `version` equal to the snapshot's plus one on 6 of 6 streams in both `book` runs and on 100 of 100 in the second `batch` run.
`batch` saw 0 gaps and 0 stale updates in 5,237 and 5,225 updates.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on 6 of 6 streams | best first, ascending, on 6 of 6 |
| update | descending on every multi level array in 60 s, 0 exceptions on 6 streams in two runs | ascending, 0 exceptions |
| REST `/contract/public/depth` | descending, 50 levels | ascending |

The order was never violated, but a feed applies updates by price and not by position.

### Level window

The server keeps the stream at 50 levels per side.
A book maintained from the snapshot and every update held at most 50 levels per side on every stream, in `book` and in `batch`.
`FOLKSUSDT` opened with 37 bids and 39 asks and reached 50 on each side, and in the second run opened with 39 and 32 and reached 50 and 48, so levels entering the window arrive as updates.

### Size unit against CCXT `contractSize`

| contract | CCXT `contractSize` | CCXT `linear` | socket and REST unit | meaning |
|---|---:|---|---|---|
| `BTCUSDT` | 0.001 | true | contracts | 0.001 BTC each |
| `ETHUSDT` | 0.001 | true | contracts | 0.001 ETH each |
| `ASTEROIDETHUSDT` | 10000 | true | contracts | 10,000 tokens each |
| `BTCUSDC` | 0.001 | true | contracts | 0.001 BTC each |
| `BTCUSD` | 100 | true | contracts | 100 USD each, not 100 BTC |

The socket reports sizes in contracts, the same unit as the REST book.
At one instant in `book`, 19 of the top 20 `BTCUSDT` bid sizes, 20 of 20 on `ETHUSDT`, 11 of 11 on `ASTEROIDETHUSDT` and 19 of 20 on `BTCUSD` equalled the REST size at the same price, and the rest moved between the two reads.
In the second run `ETHUSDT` and `BTCUSD` matched 19 of 20 and `ASTEROIDETHUSDT` 11 of 11, while `BTCUSDT` matched 8 of 20, its local best bid at 86,709.9 against 86,701.8 on REST, which is what a book up to a second old looks like while the price moves.
For the linear contracts, one contract is `contract_size` coins, which is what CCXT reports, so the engine's `sizeMul` converts them correctly.

The coin-M contracts break that rule.
BitMart's coin-M contract is 100 USD for `BTCUSD` and 10 USD for `ETHUSD`, `XRPUSD` and `SOLUSD`, while CCXT marks all four `linear` with `settle` USDT, because `fetchContractMarkets` hardcodes `settleId = 'USDT'` and `'linear': true` at `server/node_modules/ccxt/js/src/bitmart.js` lines 1117 and 1145.
`BTCUSD` reported 1,448,214 contracts and a turnover of 1,684.08 on 2026-09-23, and 1,448,214 times 100 USD at 86,500 USD per BTC is about 1,674 BTC, so turnover is in BTC and a contract is 100 USD.
That reading is an inference from the catalog and the help center's "COIN-M Futures is denominated in USD", see [`fees.md`](./fees.md) section 3.
The engine would read one `BTCUSD` contract as 100 BTC, so the four coin-M contracts must be filtered out, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

A `Trading` contract with no orders is served.
`THETAUSDT` answered the subscribe with success and a snapshot of `"asks":[],"bids":[]` at `version` 3, and then sent nothing in 75 s.
The REST book showed 259 of 359 `Trading` contracts with zero 24 h volume, and sampled ones had `null` sides or a single side, see [`rest.md`](./rest.md) section 2.
A one-sided update was seen on `ASTEROIDETHUSDT`, `{"asks":[{"price":"0.0000377","vol":"14639"}],"bids":[]}`.
The engine's `resetBook` accepts an empty side.

### Idle repeats

A quiet book repeats nothing but its clock.
`ASTEROIDETHUSDT` sent 31 updates in 60 s, 7 of them with no levels and 3 identical to the previous update, with gaps up to 10,004 ms.
In the second run it sent 44 updates, 2 with no levels and none repeated, with gaps up to 5,012 ms.
In `batch`, the longest gap on any of 100 streams was 7,004 and 7,006 ms.

### Unknown, closed and wrong-level symbols

| request | reply |
|---|---|
| `futures/depthIncrease50:NOPEUSDT@100ms` | `success` false, `Invalid channel: not found futures/depthIncrease50:NOPEUSDT@100ms` |
| `futures/depthIncrease50:LUNAUSDT@100ms`, a `Delisted` contract | `success` false, the same error |
| `futures/depthIncrease50:THETAUSDT@100ms`, `Trading` with an empty book | `success` true, one empty snapshot, then silence |
| `futures/depthIncrease30:BTCUSDT@100ms` | `success` false, `Invalid channel: not found ...` |
| `futures/depthIncrease50:BTCUSDT@50ms` | `success` false, `Invalid channel: not found ...` |
| `futures/depthIncrease50:BTCUSDT` without a speed | `success` true, delivers at one frame a second |
| `futures/nope:BTCUSDT` | `success` false, `Invalid channel: not found futures/nope:BTCUSDT` |
| a second subscribe to a topic already held | `success` true, a second acknowledgement and no error |
| text that is not JSON | `{"success":false,"error":"Invalid message: message must be JSON: not json"}`, and the socket stays open |

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | ping frame or text `ping` after N < 20 s of quiet, expect text `pong`, S1 | `{"action":"ping"}` answered `{"group":"System","data":"pong+<uuid>"}` every time. The text `ping` is refused as not JSON. A protocol ping got a protocol pong |
| silence the server tolerates | 20 s without data, and 5 s without a subscription, S1 | five sockets ran 75 s. One never subscribed and never sent, one held a quiet book, one an empty book and sent nothing, one an empty book with `{"action":"ping"}` every 15 s, one an empty book with a protocol ping every 15 s. None was closed in either run of `ws-probe.mjs silence`. In the second run each socket received one server protocol ping, 54.4 to 54.5 s after it was created, which the `ws` library answers on its own |
| forced disconnect | "We do not actively disconnect when there is a continuous message interaction between the two parties." | none in 75 s |
| maintenance notice | not documented for the socket. REST `GET https://api-cloud.bitmart.com/system/service` lists maintenance windows with status 0 waiting, 1 working, 2 completed, S2 | not observed |
| compression | not documented for futures | text JSON frames, 0 binary frames. Offered permessage-deflate, the server negotiated `permessage-deflate; server_no_context_takeover; client_no_context_takeover`, so it accepts compression but does not force it. The engine refuses deflate and got plain text |
| handshake | | 454 to 513 ms from this host |
| subscription limits | 500 connections per IP, topics in one frame at most 4,096 bytes, S1 | a subscribe frame of 2,186 bytes or more closes the socket with 1009. 100 topics on one socket in three frames ran without refusal |
| throughput | | 100 contracts, every one that traded in 24 h: 86 to 87 frames a second median, 188 to 189 peak, 47 to 50 KB a second, 537 to 579 bytes a frame, 13.5 to 18.7 µs `JSON.parse` a frame, over two runs |
| ticker without a symbol | | 106 to 107 frames a second, 26 KB a second, 324 and 327 distinct contracts in 40 s. Each of the 100 live contracts arrived every 1,887 to 6,020 ms, p50 2,126 and 2,866 ms, and 35 and 32 `Trading` contracts never arrived |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.

Subscribe, six topics in one frame.

```json
{"action":"subscribe","args":["futures/depthIncrease50:BTCUSDT@100ms","futures/depthIncrease50:ETHUSDT@100ms","futures/depthIncrease50:FOLKSUSDT@100ms","futures/depthIncrease50:ASTEROIDETHUSDT@100ms","futures/depthIncrease50:BTCUSD@100ms","futures/depthIncrease50:BTCUSDC@100ms"]}
```

Acknowledgement, one per topic, shown for a single topic subscribe.

```json
{"action":"subscribe","group":"futures/depth50:BTCUSDT@100ms","success":true,"request":{"action":"subscribe","args":["futures/depth50:BTCUSDT@100ms"]}}
```

Snapshot of a thin book, two levels per side kept.

```json
{"data":{"symbol":"ASTEROIDETHUSDT","asks":[{"price":"0.0000232","vol":"7054"},{"price":"0.0000239","vol":"10336"}],"bids":[{"price":"0.0000198","vol":"6733"},{"price":"0.0000195","vol":"12100"}],"ms_t":1790134356109,"version":2754385,"type":"snapshot"},"group":"futures/depthIncrease50:ASTEROIDETHUSDT@100ms"}
```

Update, and an update with no levels.

```json
{"data":{"symbol":"BTCUSDT","asks":[{"price":"86659.1","vol":"7043"}],"bids":[{"price":"86659","vol":"18074"}],"ms_t":1790134356628,"version":5158588,"type":"update"},"group":"futures/depthIncrease50:BTCUSDT@100ms"}
```

```json
{"data":{"symbol":"ASTEROIDETHUSDT","asks":[],"bids":[],"ms_t":1790134356625,"version":2754386,"type":"update"},"group":"futures/depthIncrease50:ASTEROIDETHUSDT@100ms"}
```

Snapshot of a `Trading` contract with no orders.

```json
{"data":{"symbol":"THETAUSDT","asks":[],"bids":[],"ms_t":1790134745321,"version":3,"type":"snapshot"},"group":"futures/depthIncrease50:THETAUSDT@100ms"}
```

Keepalive, sent and answered.

```json
{"action":"ping"}
```

```json
{"group":"System","data":"pong+e0d8adb4-bf87-440b-b7e1-6cf4e88ecd4f"}
```

Errors.

```json
{"action":"subscribe","group":"futures/depthIncrease50:NOPEUSDT@100ms","success":false,"error":"Invalid channel: not found futures/depthIncrease50:NOPEUSDT@100ms","request":{"action":"subscribe","args":["futures/depthIncrease50:NOPEUSDT@100ms"]}}
```

```json
{"success":false,"error":"Invalid message: message must be JSON: ping"}
```

Ticker without a symbol, which carries the mark and the index.

```json
{"data":{"symbol":"XAUTUSDT","last_price":"4338.94","volume_24":"1852728","range":"-0.0013970048400349","mark_price":"4338.94","index_price":"4340.10731595","ask_price":"4339.23","ask_vol":"137","bid_price":"4338.93","bid_vol":"2294"},"group":"futures/ticker"}
```

Funding rate on subscribe.
`fundingRate` is the rate settled at 00:00 UTC, and `fundingTime` is a whole second at or just before the reply, not the upcoming settlement the documentation names.

```json
{"data":{"symbol":"BTCUSDT","fundingRate":"0.000011900082","fundingTime":1790134290000,"nextFundingRate":"0.0000386","nextFundingTime":1790150400000,"funding_upper_limit":"0.0375","funding_lower_limit":"-0.0375","ts":1790134290542},"group":"futures/fundingRate:BTCUSDT"}
```

Best bid and ask, one second apart.

```json
{"data":{"symbol":"BTCUSDT","best_bid_price":"86657.9","best_bid_vol":"17485","best_ask_price":"86658","best_ask_vol":"10847","ms_t":1790134291018},"group":"futures/bookticker:BTCUSDT"}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use `wss://openapi-ws-v2.bitmart.com/user?protocol=1.1` and a login frame `{"action":"access","args":["<API_KEY>","<timestamp>","<sign>","<dev>"]}`.

- `futures/asset`, `futures/position`, `futures/order`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://openapi-ws-v2.bitmart.com/api?protocol=1.1`, for the USDT-M contracts kept by the market filter | one socket serves every family, and the coin-M and USDC contracts are filtered out, see [`rest.md`](./rest.md) section 2 |
| channel | `futures/depthIncrease50:<rawMarketId>@100ms` | snapshot on subscribe, a strict `version` chain, 50 levels covers the engine's 20 |
| cadence | treat the book as one second granular | every book channel pushed once a second, section 4 |
| markets per connection | 100, the whole live set | 100 streams ran with 0 gaps at 86 to 87 frames a second in two runs, and no per connection topic cap was reached |
| subscribe frames | slices of at most 45 topics, so each frame stays under 2,000 bytes | a 2,186 byte frame closed the socket with 1009, although the documentation says 4,096 |
| keepalive | `{"action":"ping"}` every 15 s | the documented text `ping` is refused, and the `System` pong counts as traffic for the silence watch |
| `maxSilenceMs` | 45,000 | three missed pongs. A quiet book went 10 s without a frame, and an empty book never sends after its snapshot |
| routing | `data.symbol` is the `rawMarketId` | the `group` repeats the topic with its speed suffix |
| snapshot | `type === 'snapshot'`: `resetBook` and store `version` | documented replace semantics |
| update | apply only when `version === last + 1`, then store `version`, including for updates with no levels | documented rule, 0 gaps observed |
| stale | drop `version <= last` | documented |
| resync | `version > last + 1`, or an update before any snapshot: `resync`, which terminates the socket and resubscribes | the engine's path. The documented alternative is the `request` action on the same topic |
| empty contract | a `Trading` contract whose snapshot has two empty sides stays silent, so do not treat its silence as a dead socket | 259 of 359 `Trading` contracts had no 24 h volume |
| receive time | stamp on arrival, never from `ms_t` | `ms_t` sits on the server's one second grid |
| sizes | `Number()` of the `vol` string, in contracts | section 4 |
| deflate | keep `perMessageDeflate: false` | the server negotiates it when asked but sends plain text without it |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | BitMart Futures API v2, WebSocket Subscription and change log | https://developer-pro.bitmart.com/en/futuresv2/ | 2026-09-22 | BitMart, global | URLs, frame shapes, channels, speeds, keepalive, limits, local book recipe, private channel names, sections 1 to 7 |
| S2 | BitMart Spot API, Get System Service Status | https://developer-pro.bitmart.com/en/spot/ | 2026-09-22 | BitMart, global | maintenance status values, section 5 |
| S3 | CCXT Pro 4.5.68 `bitmart.js` | `server/node_modules/ccxt/js/src/pro/bitmart.js` | 2026-09-22 | CCXT | URLs at lines 55 and 59, depth comment at line 73, sections 1 and 4 |
| S4 | CCXT 4.5.68 `bitmart.js` | `server/node_modules/ccxt/js/src/bitmart.js` | 2026-09-22 | CCXT | `settleId` and `linear` at lines 1117 and 1145, section 4 |
| P1 | `ws-probe.mjs book`, 60 s at 03:32 and 03:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitmart/ws-probe.mjs) | 2026-09-22 | this host | cadence, snapshot, chain, order, window, size unit, sections 3, 4 and 6 |
| P2 | `ws-probe.mjs channels` at 03:31 and 03:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitmart/ws-probe.mjs) | 2026-09-22 | this host | other channels, errors, pings, sections 2 to 6 |
| P3 | `ws-probe.mjs cadence` at 03:34 and 03:52 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitmart/ws-probe.mjs) | 2026-09-22 | this host | one second cadence on twelve channels, sections 2 and 4 |
| P4 | `ws-probe.mjs ticker` at 03:35 and 03:52 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitmart/ws-probe.mjs) | 2026-09-22 | this host | the ticker without a symbol, sections 2 and 5 |
| P5 | `ws-probe.mjs framecap` at 03:37 and 03:53 UTC, and `batch` at 03:38 and 03:53 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitmart/ws-probe.mjs) | 2026-09-22 | this host | frame size cap, 100 streams on one socket, sections 3 to 5 |
| P6 | `ws-probe.mjs silence` at 03:39 and 03:55 UTC, and `deflate` at 03:31 and 03:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitmart/ws-probe.mjs) | 2026-09-22 | this host | silence, keepalive, compression, section 5 |
