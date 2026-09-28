# Batonex WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-24 06:42 to 06:55 UTC (2026-09-23 evening Pacific), from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public quote WebSocket of Batonex for its one perpetual family, USDT-margined, with the book channel in detail.
Batonex runs on the BHEX broker platform, and its API documentation is the GitHub repository `github.com/batonex/openapi`, last pushed 2024-08-20.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/batonex/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written.
The probe loads `ws` from `server/node_modules`, which the server's Rust rewrite removed at about 06:56 UTC, after these runs.
Access results are from that Canadian VPN exit, and nothing refused this host.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-margined perpetuals, v1 | `wss://wsapi.batonex.com/openapi/quote/ws/v1`, S2 and S3 | open in 986 to 1,570 ms, 119 of 119 perpetuals deliver |
| USDT-margined perpetuals, v2 | `wss://wsapi.batonex.com/openapi/quote/ws/v2`, S4 | open in about 1,003 ms, `BTC-SWAP-USDT` delivers |
| web app quote socket | `wss://ws.batonex.com/ws/quote/v1`, built by the site bundle | not probed |

The v1 socket carries spot and perpetuals on the same URL: the spot symbol `BTCUSDT` and the perpetual `ETH-SWAP-USDT` both delivered `depth` on one socket in the `errors` mode.
`wsapi.batonex.com` resolved to `35.75.253.166` and `13.196.130.177`, which are AWS Tokyo addresses, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| topic | subscribe | depth and speed | probed |
|---|---|---|---|
| `depth` (v1) | `{"symbol": "A,B", "topic": "depth", "event": "sub", "params": {"binary": false}}` | documented 300 levels every 300 ms when the book changed, S3 | a full book of up to 200 levels per side on every frame, 2.5 frames per second on `BTC-SWAP-USDT`, recommended |
| `diffDepth` (v1) | same shape | documented pushed every second, S3 | a 200 level first frame with `f: true`, then change sets, about 2.5 frames per second |
| `mergedDepth` (v1) | adds `"dumpScale": 1` | documented, S3 | 40 levels per side, full each frame, 88 frames in 39 s |
| `depth` (v2) | `{"topic": "depth", "event": "sub", "params": {"binary": false, "symbol": "BTC-SWAP-USDT"}}`, one symbol per frame | documented, S4 | 40 levels per side, full each frame, 84 frames in 39 s, acknowledged with `"code": "0"` |
| `realtimes` | contract list | 24 h ticker, S3 | `c`, `h`, `l`, `o`, `v`, `qv`, `m`, `e`, no mark, index or funding field |
| `trade`, `kline_<interval>` | contract list | S3 | not probed |
| `index` | index symbol list such as `BTCUSDT` | not documented | one frame per index per second, carries `index`, `edp` and `formula`, see section 4 |
| `markPrice`, `indexPrice`, `fundingRate` | | not documented | refused: `markPrice` answers `Invalid Symbols!`, the other two answer `Invalid topic!` |

No mark price channel exists, and no funding channel exists.
The `index` topic is the only anchor number on the socket.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one v1 URL and one v2 URL, S2 | one v1 socket carried a spot and a perpetual book together |
| subscribe frame shape | v1 takes a comma separated `symbol` list, v2 takes one `params.symbol`, S3 and S4 | 119 perpetuals in one v1 frame, all delivered |
| unknown symbol expectation | not documented | `{"code":"-100010","desc":"Invalid Symbols!"}` for `NOPE-SWAP-USDT`, and the socket stays open |
| chunk unit and budget | Not publicly specified | 119 symbols in one frame on one socket, every one delivered, the last first frame 3.5 s after the subscribe |
| keepalive mechanism | client sends `{"ping": <ms>}`, server answers `{"pong": <ms>}`, and the server closes a client that sends none for 5 minutes, S3 | the pong carries the server time, not the echoed value: `{"ping":1790000000000}` got `{"pong":1790232432170}`. No server protocol ping in 70 s |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 73 s |
| handshake and operation rate limits | Not publicly specified | no refusal at the subscribe rates used here |
| public market data authentication | none | none |
| message parse and routing | `{symbol, topic, data: [...], f}`, S3 | route on `symbol` and `topic`. Frames add `symbolName`, `params.realtimeInterval`, `sendTime` and `shared` beside the documented keys |
| subscribe acknowledgement shape | not documented | v1 sends no acknowledgement, the first data frame is the only sign. v2 answers `{"topic":"depth","event":"sub","params":{...},"code":"0","msg":"Success"}` |
| symbol identifier format | `BTC-PERP-USDT` in the examples, S5 | `BTC-SWAP-USDT` for 22 contracts and `<BASE>-USDT-PERP` for 97, identical to the REST `symbol` |
| number representation | strings | price and size as strings, `e` as a JSON number |
| timestamp representation | `t` in ms | `t` integer ms, `sendTime` integer ms |
| size unit | contracts | contracts of `contractMultiplier` coins, section 4 |
| sequence semantics | `v` is a version, S3 | `v` is `<number>_<scale>`, the number rose on every frame and never repeated, and consecutive frames skip numbers |
| idle repeat behaviour | dumps only when the version changed, S3 | no repeated version. 6 of 99 `BTC-SWAP-USDT` frames had the same top 20 levels as the frame before, and the quiet `EDGE-USDT-PERP` went at most 2.3 s without a frame |

## 4. The book channel in detail

v1 `depth` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

Every frame is a full book, not only the first.
The first frame carries `"f": true` and later frames `"f": false`, yet `BTC-SWAP-USDT` carried 200 bids on all 99 frames in 39 s, and `AAPL-USDT-PERP` carried 128 or 129 bids on all 70 frames.
So a feed resets the book on every frame.

### Delta semantics

There are no deltas on `depth`.
`diffDepth` does send change sets after its first frame, and its frames held 0 to 293 bids, with `e` either `301` or `0`.
Its documented rule says a size of `"0"` deletes the level, S3.
Its versions skip numbers the same way as `depth`, so no chain rule can detect a lost change set, which is why this profile does not recommend it.

### Sequence and gap rule

```text
every depth frame     replace the book with b and a, keep v
v number not greater  drop the frame (never seen: 0 decreases on 4 contracts over 39 s)
```

No gap rule is needed or possible, since each frame stands alone.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| v1 `depth` | best first, descending, on every frame of 4 contracts | best first, ascending, on every frame |
| v2 `depth`, `mergedDepth` | descending | ascending |
| REST depth | descending | ascending |

### Level window

v1 `depth` sent at most 200 levels per side, against the documented 300.
v2 `depth` and `mergedDepth` sent 40 per side.
A thin contract holds fewer: `EDGE-USDT-PERP` held 115 or 116 per side.

### Size unit against CCXT `contractSize`

No CCXT class exists, see [`fees.md`](./fees.md) section 8, so the unit was checked against the venue's own `contractMultiplier`.

| contract | `contractMultiplier` | socket size at the touch | REST size at the same `t` | coins |
|---|---:|---|---|---|
| `BTC-SWAP-USDT` | 0.0001 | bid `"28165"` | `"28165"` | 2.8165 BTC |
| `ETH-SWAP-USDT` | 0.01 | bid `"7780"` | not compared | 77.8 ETH |

The socket book and the REST depth were identical in the top five bids and top three asks, with the same `t` of `1790232406612`.
The unit is contracts: the 24 h ticker's `quoteVolume` over `volume` times `lastPrice` gives 0.0001007 for BTC, 0.01001 for ETH and 0.1006 for SOL, matching each `contractMultiplier`, see [`rest.md`](./rest.md) section 2.
A loader that takes `contractSize` from `contractMultiplier` would convert Batonex sizes correctly.

### One-sided and empty books

No one-sided or empty book was seen on the four probed contracts, so what `depth` sends for an empty side is Not verified.
One `BTC-SWAP-USDT` frame carried 75 asks against 200 bids.

### Idle repeats

Nothing is repeated with the same version.
The server dumps only when the version changed, S3, and 6 of 99 BTC frames repeated the previous top 20 levels under a new version.

### Unknown, closed and wrong symbols

| request | reply |
|---|---|
| `depth` on `NOPE-SWAP-USDT` | `{"code":"-100010","desc":"Invalid Symbols!"}` |
| `depth` on the spot symbol `BTCUSDT` | delivers the spot book on the same socket |
| topic `nope` | `{"code":"-10004","desc":"Invalid topic!"}` |
| topic `markPrice` | `{"code":"-100010","desc":"Invalid Symbols!"}` |
| topics `indexPrice` and `fundingRate` | `{"code":"-10004","desc":"Invalid topic!"}` |
| text that is not JSON | `{"code":"-10001","desc":"Invalid JSON!"}`, the socket stays open |
| `depth` on `ETH-SWAP-USDT` twice | no error, 15 frames with 14 distinct versions over the remaining 5 s or so |

A closed or delisted contract was not available to probe, since all 119 were `TRADING`.

### The index topic

The `index` topic delivered one frame per index per second, 27 or 28 frames per index in 30 s on all 119, with `time` on a whole second.
Each frame names its source in `formula`.
107 of 119 read `MARK_PRICE_BINANCE`, 3 read `MARK_PRICE_BITGET`, 5 average two venues such as `(x[BYBIT]+x[BINANCE])/2`, 1 is `(x[BINANCE])/1` and 3 are `(x[CUSTOM_EX2])/1` for the `INDEX*` contracts, in the `anchor` mode.
The REST comparison in [`rest.md`](./rest.md) section 4 shows the `MARK_PRICE_BINANCE` value is the Binance USDT-M mark price to the last digit.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client `{"ping": <ms>}` at least every 5 minutes, S3 | pong in the same second, carrying server time. No server protocol ping in 70 s on three sockets |
| silence the server tolerates | 5 minutes without a client ping, S3 | a socket with no subscription and no client frame closed at 61.0 s with 1006. Two sockets subscribed to the quiet `EDGE-USDT-PERP`, one pinging every 20 s and one never sending, both stayed open for the 70 s test with a longest gap of 2.5 s |
| forced disconnect | Not publicly specified | none seen |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON. A client that offered permessage-deflate got no `sec-websocket-extensions` header back. `binary` is a documented option that was left false |
| handshake | | 986 to 1,570 ms to open from this host |
| subscription limits | Not publicly specified | none reached at 119 symbols on one socket |
| throughput | | 119 perpetuals on one socket for 30 s: 151.3 frames per second, 723 KB per second, 4,893 bytes per frame, 47.5 µs `JSON.parse` per frame. Frames per symbol ranged 9 to 77, median 30 |

The whole-book frames are 20 times the size of a Gate delta, so the parse cost per second is high for a small catalog.
The silence test stopped at 70 s, so whether a subscribed socket that never pings survives 5 minutes is Not verified.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-24 UTC.
Arrays marked `…` are cut.

Subscribe, four contracts in one frame.

```json
{"symbol": "BTC-SWAP-USDT,ETH-SWAP-USDT,AAPL-USDT-PERP,EDGE-USDT-PERP", "topic": "depth", "event": "sub", "params": {"binary": false}}
```

The first `depth` frame, a full book.

```json
{"symbol": "BTC-SWAP-USDT", "symbolName": "BTC-SWAP-USDT", "topic": "depth", "params": {"realtimeInterval": "24h", "binary": "false"}, "data": [{"e": 301, "s": "BTC-SWAP-USDT", "t": 1790232364756, "v": "2599136838_18", "b": [["84095.5", "18592"], ["84095.4", "24"], ["84095.3", "25"]], "a": []}], "f": true}
```

The `a` array is cut to empty here, and the real frame held 200 asks.

v2 acknowledgement.

```json
{"topic": "depth", "event": "sub", "params": {"symbol": "BTC-SWAP-USDT", "binary": "false", "symbolName": "BTC-SWAP-USDT"}, "code": "0", "msg": "Success"}
```

Index frame.

```json
{"symbol": "BTCUSDT", "symbolName": "BTCUSDT", "topic": "index", "params": {"realtimeInterval": "24h", "binary": "false"}, "data": [{"symbol": "BTCUSDT", "index": "84049.7", "edp": "84140.47289794", "formula": "MARK_PRICE_BINANCE", "time": 1790232423000}], "f": true}
```

Keepalive answer, and an error.

```json
{"pong": 1790232432170}
```

```json
{"code": "-100010", "desc": "Invalid Symbols!"}
```

## 7. Private channels

The user data stream is documented on the host `wss://wsapi.batonex.com`, S2, with its own page `apidocs/07-user-data-stream.md`, S6.
It was not opened and the page was not read beyond its name.

## 8. Recommended feed shape

If Batonex were ever added, the feed would be small.

- URL plan: one socket at `wss://wsapi.batonex.com/openapi/quote/ws/v1` for all 119 perpetuals, since one socket carried all of them.
- Subscribe frame: one v1 `depth` frame with a comma separated symbol list.
- Book handling: `resetBook` and `publish` on every frame, drop a frame whose `v` number is not above the last one, no `resync` path is needed for gaps.
- Keepalive: `{"ping": <ms>}` every 20 s, well inside the documented 5 minutes.
- `maxSilenceMs`: 10 s, since the quietest probed contract went 2.3 s without a frame and the pong answers within a second.
- Level window: the engine's 20 levels come from the first 20 of each 200 level frame.

The blocker is not the feed but the catalog and the anchor, see [`rest.md`](./rest.md) sections 2 and 3.

## 9. Source ledger

| id | source | used for |
|---|---|---|
| S1 | `https://github.com/batonex/openapi`, repository, last pushed 2024-08-20 | the documentation set |
| S2 | `https://raw.githubusercontent.com/batonex/openapi/master/apidocs/01-endpoint.md` | endpoint hosts |
| S3 | `https://raw.githubusercontent.com/batonex/openapi/master/apidocs/05-websocket.md` | v1 topics, heartbeat, depth, diffDepth, mergedDepth |
| S4 | `https://raw.githubusercontent.com/batonex/openapi/master/apidocs/06-websocket-v2.md` | v2 depth |
| S5 | `https://raw.githubusercontent.com/batonex/openapi/master/apidocs/04-contract.md` | symbol examples, depth |
| S6 | `https://raw.githubusercontent.com/batonex/openapi/master/apidocs/07-user-data-stream.md` | private stream, listed only |
| P1 | [`ws-probe.mjs`](../../../scripts/probes/venues/batonex/ws-probe.mjs) modes `book`, `errors`, `anchor`, `batch`, `silence`, `deflate` | every probed value |
