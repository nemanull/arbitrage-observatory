# OneEx WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 local time (2026-10-10 02:21 to 02:45 UTC), from the development host near Seattle, through the user's Surfshark WireGuard tunnel whose exit geolocated to Vancouver, Canada.

This profile covers the public market data socket of OneEx for its one live perpetual family, USDT-margined.
OneEx publishes no socket documentation, so every "documented" cell below reads Not publicly specified, and the protocol comes from the website's bundle and the wire.
Every probed number comes from [`ws-probe.py`](../../../scripts/probes/venues/oneex/ws-probe.py), run from the repository root with `uv run`.
Total socket time across all runs stayed near ten minutes.

## 1. Endpoints

| socket | URL | evidence |
|---|---|---|
| public market data, spot and perpetuals | `wss://ws.oneex.vip/ws/quote/v1`, which the site opens with `?lang=<language>` | the bundle builds it from the page host with `www` replaced by `ws`, path `/ws/quote/v1`, R1 |
| private | `wss://ws.oneex.vip/api/ws/user` | same bundle line, R1 |

One socket carries every perpetual and every spot pair, told apart by symbol.
The handshake needs no key, no cookie and no token.

## 2. Channel matrix for public market data

| topic | symbol form | content | probed push rate |
|---|---|---|---|
| `depth` | `301.BTC-SWAP-USDT`, comma lists allowed | the whole published book, about 40 levels a side, on every push | BTC median gap 2.1 to 2.4 s, max 4.5 to 11.7 s, on the `depth` id in two runs |
| `diffDepth` | same | a whole book first, then changed levels only | the same pushes as `depth`, with the same `v` |
| `mergedDepth` | same, with `params.dumpScale` | the book grouped by a price step, `v` suffix `_1` for scale 1 | same cadence as `depth` |
| `trade` | same | trades | not probed |
| `kline_<interval>` | same | candles of the contract | not probed |
| `markKline_<interval>` | `BTCUSDT`, the catalog's `indexToken`, one per frame | mark candles, close `c` is the mark | BTC median gap 1.2 to 2.1 s, max 6.0 to 10.8 s over three runs |
| `indexKline_<interval>` | same | index candles | BTC median gap 0.9 s, max 1.5 to 1.8 s over three runs |
| `broker`, `slowBroker` | `params.org` | the site's ticker lists | not probed |

No best bid and offer topic, no ticker topic per contract and no funding topic appear in the bundle.
The topic names come from the subscribe builders in R1.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified | one market socket for spot and perpetuals, one private socket, section 1 |
| subscribe frame shape | Not publicly specified, the site sends `{"id":"depth301.BTC-SWAP-USDT","topic":"depth","event":"sub","limit":<n>,"symbol":"301.BTC-SWAP-USDT","params":{"binary":<bool>}}` | as the site sends it. A comma list of 30 contracts in one `depth` frame delivered all 30. A comma list on `markKline_1m` answered `-100010` twice and sent no candle |
| unknown symbol expectation | Not publicly specified | `{"code":"-100010","desc":"Invalid Symbols!"}` with no `id`, for an unknown contract, a closed USDH contract and a frame with no `symbol`, and the socket stays open |
| chunk unit and budget | Not publicly specified | 30 contracts in one frame on one socket, every one delivered |
| keepalive mechanism | Not publicly specified, the site's message handler answers a server `ping` with `pong` | `{"ping":<ms>}` is answered with `{"pong":<ms>}` carrying the server's time, not an echo. The server sent no ping on any socket |
| connection lifetime and maintenance notice | Not publicly specified | a socket with no client frame after its subscribe stayed open for its whole window, 130 s in one run and 70 s in two, with no notice frame |
| handshake and operation rate limits | Not publicly specified | three upgrade requests sent at the same instant drew `HTTP/1.1 929` with `Content-Length: 0` for one of the three in 2 of 5 bursts across three runs, and 101 for all three in the other 3. The probe's first version, which opened three sockets at once, failed on a 929 too. Upgrades staggered 1.5 s apart were never refused |
| public market data authentication | Not publicly specified | none needed |
| message parse and routing | Not publicly specified | `{symbol, symbolName, topic, params, data, sendTime, id}` on book and kline frames. Error frames carry `code` and `desc` only |
| subscribe acknowledgement shape | Not publicly specified | no acknowledgement, the first data frame arrives in about 200 to 300 ms |
| symbol identifier format | Not publicly specified | `301.` + `symbolId` to subscribe, and frames return the bare `symbolId` in `symbol` and `data[].s`. The kline topics take the `indexToken`, `BTCUSDT` |
| number representation | Not publicly specified | prices and sizes as strings, `e`, `t` and `o` as numbers |
| timestamp representation | Not publicly specified | `t` and `sendTime` in Unix ms |
| size unit | Not publicly specified | contracts of the catalog's `contractMultiplier`, section 4 |
| sequence semantics | Not publicly specified | `v` is `"<n>_18"` with `n` rising by 1 to 60 between pushes, or by 0 on a repeated `depth` push. `diffDepth` deltas carry `o`, which rises by exactly 1 per delta on one socket |
| idle repeat behaviour | Not publicly specified | a `depth` push repeated the previous `v` once in 30 BTC frames and once in 26 |

## 4. The book channel in detail

### Snapshot on subscribe

Yes.
The first `depth` frame after a subscribe is the whole book, 40 to 43 levels a side on BTC, ETH and SOL, and arrives in about 0.2 s.
The first `diffDepth` frame is the same whole book with the same `v`, marked `e` 301 and `o` 0, and `depth` frames carry `o` 0 as well.

### Delta semantics

`depth` and `mergedDepth` send the whole book on every push, so each push replaces the book.
`diffDepth` deltas carry `e` 0, no `s`, a list of changed levels per side, and a size of `"0"` for a removed level.
A book rebuilt from `diffDepth` matched the `depth` frame of the same `v` on the top 20 levels in every shared version: 23 of 23 BTC and 16 of 16 ETH in one run, 10 of 10 ETH in another, and 24 of 24 BTC and 2 of 2 ETH in the last.

### Sequence and gap rule

`v` is `"<n>_18"`, with `n` per contract, and `_18` the depth scale, `_1` on `mergedDepth` with `dumpScale` 1.
`n` rose by 1 to 60 between pushes, so pushes are conflated and `v` cannot detect a lost frame.
`diffDepth` deltas carry `o`, which rose by exactly 1 between consecutive deltas on each contract, in 11 of 11 BTC steps and 8 of 8 ETH steps in one run and 23 of 23 BTC steps in another.
Different sockets started BTC from different values, 11,787,399 in one run and 11,784,219 in the next, so `o` is not one venue wide sequence and is compared only within a socket.
So `diffDepth` has a usable gap rule: a delta whose `o` is not the previous `o` plus 1 means a lost frame.
`depth` needs no gap rule, because each push is whole.

### Checksum

None on any topic.

### Level order on the wire

Bids descending and asks ascending on all 87 BTC and ETH `depth` frames checked across three runs, with no crossed book.

### Level window

About 40 levels a side, 32 to 43 on BTC and mostly 40 to 42, the same as the REST book's maximum, see [`rest.md`](./rest.md) section 5.
The `limit` field is ignored: a `depth` subscription with `limit` 5 on SOL delivered 39 to 41 levels a side.
On the 30 contract socket, the first frame of the same 15 contracts held fewer than 20 levels on a side in three runs, and 2 held none on either side.
So the engine's 20 level window is filled only on the busier books.

### Size unit against the catalog's `contractMultiplier`

Sizes are contracts.
BTC levels such as 65,897 contracts at a multiplier of 0.0001 are 6.59 BTC, and the size unit matches the ticker's contract volume in [`rest.md`](./rest.md) section 2.

### One-sided and empty books

The two hidden tradable contracts, `BANANA-SWAP-USDT` and `G-SWAP-USDT`, sent a first `depth` frame with no bids and no asks.
No one-sided book was seen on BTC, ETH or SOL.

### Idle repeats and push rate

Pushes follow book changes and are paced by the server.
BTC pushed every 1.65 to 2.7 s at the median on `depth` and `diffDepth` and went up to 12.9 s without a push, while `n` moved by a median of 5 to 10 per push.
SOL went up to 22.2 s and ETH up to 12.6 s without a push.
The 30 contract socket received 2.9 to 3.4 book frames a second in all, 3.7 to 4.3 KB/s, and every contract pushed at least once in each 35 to 50 s window.
That cadence is slower than most venues the engine runs.
Because `n` moves several times between pushes, the book a feed holds can trail the venue's own changes by seconds.

### Unknown, closed and duplicate subscriptions

An unknown contract, the closed `301.BTC-SWAP-USDH` and a frame with no `symbol` each answer `{"code":"-100010","desc":"Invalid Symbols!"}`.
A frame that is not JSON answers `{"code":"-10001","desc":"Invalid JSON!"}`.
A subscription is keyed by topic and symbol, not by `id`: a binary `depth` subscription to BTC replaced the text one, which then stopped after 2 frames, and in another run a binary XRP subscription left 0 text XRP frames after it.
`{"id":..,"topic":"depth","event":"cancel","symbol":..}` stops the stream, and no LTC frame arrived in the 4 s after a cancel.
A `depth` subscription without the `301.` prefix delivered one frame and is not what the site sends.

## 5. Session

| item | value |
|---|---|
| keepalive | send `{"ping":<ms>}`, expect `{"pong":<ms>}`. The server sent no ping. |
| silence tolerated | a socket with no client frame stayed open for 130 s in one run and 70 s in two, the whole window of each run |
| forced disconnects | none seen |
| maintenance notices | none seen |
| compression | an upgrade offering `permessage-deflate` got no `Sec-WebSocket-Extensions` header back, so frames are plain. `params.binary` true makes the server send each frame as a gzip binary message, which the site inflates, and false sends plain JSON text |
| handshake | 101 in 600 to 750 ms, `Server: CDN`. A burst of simultaneous upgrades can draw status 929 with an empty body, see section 3 |
| subscription limits | none published, 30 contracts on one socket worked |

## 6. Captured frames

Each frame is copied from the probe output, with books cut to two levels a side by the probe.

Book push on `depth`, the first after subscribe:

```json
{"symbol":"BTC-SWAP-USDT","symbolName":"BTC-SWAP-USDT","topic":"depth","params":{"realtimeInterval":"24h","binary":"false"},"data":[{"e":301,"s":"BTC-SWAP-USDT","t":1791600159569,"v":"183249876_18","b":[["82585.9","65897"],["82585.8","64564"]],"a":[["82586.7","54706"],["82586.8","53145"]],"o":0}],"sendTime":1791600160316,"id":"depth-btc"}
```

`diffDepth` delta, the first after that book, `o` then rose by 1 per delta:

```json
{"symbol":"BTC-SWAP-USDT","symbolName":"BTC-SWAP-USDT","topic":"diffDepth","params":{"realtimeInterval":"24h","binary":"false"},"data":[{"e":0,"t":1791600161723,"v":"183249880_18","b":[["82566.3","181311"]],"a":[],"o":11784349}],"sendTime":1791600161993,"id":"diff"}
```

Mark candle:

```json
{"symbol":"BTCUSDT","symbolName":"BTCUSDT","topic":"markKline","params":{"realtimeInterval":"24h","klineType":"1m","binary":"false"},"data":[{"t":1791600120000,"s":"BTCUSDT","sn":"BTCUSDT","c":"82587.5","h":"82594.1","l":"82584.9","o":"82596.3","v":"0"}],"sendTime":1791600160317,"id":"mark-btc"}
```

Keepalive answer to a ping built at 1791600149178 and sent about 4 s later, then the errors:

```json
{"pong":1791600153501}
{"code":"-100010","desc":"Invalid Symbols!"}
{"code":"-10001","desc":"Invalid JSON!"}
```

## 7. Private channels

The bundle names the private socket `wss://ws.oneex.vip/api/ws/user` and the topics `balance`, `order`, `match`, `futures_order`, `futures_position`, `futures_balance`, `futures_tradeable`, `futures_leverage` and `plan_order`, R1.
They were not opened.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

- URL `wss://ws.oneex.vip/ws/quote/v1?lang=en-us`, one socket for all 30 contracts, connects at least 1 s apart.
- Subscribe `{"id":"depth","topic":"depth","event":"sub","symbol":"301.<id>,301.<id>,...","params":{"binary":false}}`, and treat each push as the whole book.
- Subscribe `markKline_1m` and `indexKline_1m` per `indexToken`, one frame each, for the mark and index, as the Echobit adapter at [`../../../server/src/venues/echobit.rs`](../../../server/src/venues/echobit.rs) does on a protocol of the same shape.
- Send `{"ping":<ms>}` every 20 s.
- Set `maxSilenceMs` to about 30 s, because a quiet SOL book went 22.2 s without a push, while the index candle of each subscribed token pushes about once a second.
- Resync only on close, since `depth` pushes are whole and need no gap rule.
  A feed that prefers `diffDepth` resyncs when `o` skips.
- Refuse `binary` true, which sends gzip frames.

## 9. Source ledger

| id | title | URL | retrieved | supports |
|---|---|---|---|---|
| R1 | OneEx web bundle, the socket URL builder, the subscribe builders and the message handler | https://www.oneex.vip/static/index-Dnukw9wy.js | 2026-10-09 | sections 1 to 3 and 7 |
| R2 | OneEx site configuration, the `futuresSymbol` catalog | https://www.oneex.vip/s_api/basic/config_v2?tab=exchange&type=all | 2026-10-09 | sections 3 and 4 |
