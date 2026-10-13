# ApeX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-12.

**Probed:** 2026-10-12 from 22:19 to 22:37 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public WebSocket API of ApeX Omni (CCXT id `apex`), with the book channel in detail.
The researched family is the USDT-settled linear perpetuals of `perpetualContract`, and one socket also serves the TradFi perpetuals.
Every protocol claim below was captured by [`ws-probe.py`](../../../scripts/probes/venues/apex/ws-probe.py), run with `uv run` from the repository root, and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
All times are UTC.
P1 is the first run of each mode, from 22:19 to 22:26, and P2 is the rerun in the second pass, from 22:31 to 22:37.
The catalog, the anchor and the decentralised layer are in [`rest.md`](./rest.md), and fees and access in [`fees.md`](./fees.md).

## 1. Endpoints

| family | documented URL, S1 | probed |
|---|---|---|
| every public family, mainnet | `wss://quote.omni.apex.exchange/realtime_public?v=2&timestamp=<ms>` | opened in 299 to 490 ms, P1 and P2 |
| the same URL without `timestamp` | not documented | opened and served a snapshot, P1 and P2 `control` |
| testnet | `wss://qa-quote.omni.apex.exchange/realtime_public?v=2&timestamp=<ms>` | not probed |
| private | `wss://quote.omni.apex.exchange/realtime_private?v=2&timestamp=<ms>` | not probed, see section 7 |

One socket carried the crypto perpetuals and the TradFi perpetual `AAPLUSDT`, whose snapshot arrived on the same socket as `BTCUSDT`, P1 and P2 `control`.
`quote.omni.apex.exchange` is a CNAME to `quote.omni.apex.exchange.cdn20.com` at `140.150.36.123`, the same address as the REST host, P1 and P2 `rest-probe.py host`.
The upgrade reply carried `x-via: 1.1 VM-SIN-…, 1.1 PSmglsjLAX2dv159…` with each hop named "Cdn Cache Server V2.0", so the socket passes a Los Angeles edge and a Singapore node of a CDN, P1.
CCXT Pro opens the same URL and appends `&timestamp=` once per exchange instance, `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/apex.js` lines 35 and 265 to 276.

## 2. Channel matrix for public market data

| channel | topic | payload | documented, S1 | probed |
|---|---|---|---|---|
| book, 25 levels | `orderBook25.H.<crossSymbolName>` | snapshot, then deltas | "depth of 25 or 200 orders per side", `H` "High frequency", `M` "middle frequency" | deltas p50 51 ms apart on `BTCUSDT`, max 399 and 606 ms, P1 and P2 `book` |
| book, 200 levels | `orderBook200.H.<crossSymbolName>` | snapshot, then deltas | as above | deltas p50 100 ms apart on `BTCUSDT` and `ETHUSDT`, 299 and 290 ms on `DOGEUSDT`, P1 and P2 |
| book, middle frequency | `orderBook25.M.BTCUSDT` | | documented | refused with `error:handler not found` in both runs |
| other depths | `orderBook50.H.ETHUSDT` | | not documented | `error:handler not found`, P1 and P2 |
| trades | `recentlyTrade.H.<crossSymbolName>` | trade list | documented | not probed |
| ticker per market | `instrumentInfo.H.<crossSymbolName>` | snapshot, then deltas with the changed keys only | documented with `oraclePrice` and `indexPrice` | frames p50 198 ms apart on `BTCUSDT`, with `markPrice` and `indexPrice` but no `oraclePrice`, P1 |
| ticker for all symbols | `instrumentInfo.all` | a whole snapshot of every symbol each push | documented with `mp` mark and `xp` index | a whole snapshot every 2.0 s, p50 1,999 and 2,000 ms, 369 rows and 68.9 KB a frame, P1 and P2 `anchor` |
| candles | `candle.<interval>.<crossSymbolName>` | open candle | documented | not probed |

No channel carries the mark, the index or the funding alone.
They ride the two `instrumentInfo` channels, and [`rest.md`](./rest.md) section 3 explains why `instrumentInfo.all` is the anchor source.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL, S1 | one socket carried crypto and TradFi perpetuals, section 1 |
| subscribe frame shape | `{"op":"subscribe","args":["topic.filter", …]}`, S1 | as documented, and 88 topics in 9 frames of at most 10 were all acknowledged, P1 and P2 `batch` |
| unknown symbol expectation | Not publicly specified | `{"success":false,"ret_msg":"error:handler not found",…}` in about 210 ms, and the socket stays open. A frame that mixes one unknown topic with a valid one fails whole, and the valid topic is not subscribed, P1 and P2 `control` |
| chunk unit and budget | Not publicly specified | 88 book topics on one socket, sent 10 per frame, no refusal, P1 and P2 |
| keepalive mechanism | client sends `{"op":"ping","args":["<ms>"]}` every 15 s, and the client answers a server ping with `{"op":"pong","args":["<ms>"]}`, S1 | the server sent `{"op":"ping","args":["<ms>"]}` every 15.0 s, and a client ping was answered in 213 and 224 ms by `{"success":true,"ret_msg":"pong",…}`, P1 and P2 |
| connection lifetime and maintenance notice | "your may get disconnected at any time", S1. No notice channel | no forced close within 60 s of pinging, and no notice seen |
| handshake and operation rate limits | Not publicly specified for sockets. REST is 600 requests a minute per IP, see [`rest.md`](./rest.md) section 6 | 15 sockets opened between 22:19 and 22:37 with no refusal |
| public market data authentication | none | none |
| message parse and routing | `topic`, `type`, `data`, `ts`, S1 | route on `topic`, whose last dot-separated part is the symbol. Acknowledgements and errors carry `success` and `request` instead, and the server ping carries `op` |
| subscribe acknowledgement shape | `{"success":true,"ret_msg":"","conn_id":"…","request":{"op":"subscribe","args":[…]}}`, S1 | as documented, but the book snapshot arrived before its acknowledgement, 0.2 ms earlier on `BTCUSDT`, P1 and P2 `control` |
| symbol identifier format | `BTCUSDT`, the `crossSymbolName` of `/v3/symbols`, S1 and S2 | `BTCUSDT` works. `ETH-USDT`, which is CCXT's `market.id`, and `ethusdt` both answer `error:handler not found`, P1 and P2 |
| number representation | strings for prices and sizes, S1 | strings, such as `["82480.0","0.013"]` |
| timestamp representation | `ts` in microseconds in the examples, S1 | `ts` in Unix microseconds, such as `1791843545377395`, on every book and ticker frame |
| size unit | Not publicly specified | base coins, the unit of `/v3/depth` and of the ticker's `volume24h`, see [`rest.md`](./rest.md) section 2. CCXT's `contractSize` is `minOrderSize` instead |
| sequence semantics | "According to whether the Update ID is continuous, the client will need to determine if there is a packet loss", and "Snapshot resets the Update ID and it will start counting again from 1", S1 | `u` rose by exactly 1 per delta, with 0 gaps in 6,358 deltas on 86 books in P1 `batch` and 7,411 in P2. A snapshot's `u` is the stream's running value, such as 13,862,735, not 1 |
| idle repeat behaviour | not documented | none. A quiet book sends nothing: `TRXUSDT` sent 0.05 frames a second, and no delta was empty, P1 and P2 `batch` |

## 4. The book channel in detail

### Snapshot and deltas

| item | probed |
|---|---|
| snapshot on subscribe | yes, the first frame of each live topic, 208 to 271 ms after the subscribe frames, P1 `batch`, and 211 to 223 ms in P1 and P2 `book` |
| levels in the snapshot | 25 and 25 on `orderBook25.H`, 200 and 200 on `orderBook200.H` |
| delta semantics | absolute sizes per price, and size `"0"` deletes the level, as S1 says |
| window | the server keeps the window full. After 111 to 563 deltas each book still held exactly 25 or 200 levels per side, and every `"0"` named a level the local book held, P1 and P2 `book` |
| sequence rule | each delta's `u` equals the previous frame's `u` plus 1, and a snapshot sets the base. P1 `book` saw 343, 351, 111 and 563 deltas, and P2 306, 353, 125 and 469, with 0 gaps |
| the two depths | `orderBook200` and `orderBook25` count `u` separately. On `BTCUSDT` the 200 stream read 10,361,422 while the 25 stream read 13,864,050 |
| REST and socket | `/v3/depth` returns the 200 stream's `u`: 10,361,771 against a socket `u` of 10,361,765 a moment earlier in P1, and 10,367,308 against 10,367,301 in P2 |
| checksum | none documented. Each frame carries a top-level `cs` that rose on each topic in steps of 2 to 1,367, so it is not a per-topic counter and is not used |
| crossed books | 0 after applying every delta, P1 and P2 |
| one-sided books | none in P1. In P2 `batch`, 6 of 86 books, `ENSUSDT`, `WIFUSDT`, `POPCATUSDT`, `LAYERUSDT`, `PROVEUSDT` and `SOMIUSDT`, had one empty side after at least one frame. Their frames were not kept, so whether the side was empty on the venue was not checked |

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| socket snapshot | ascending, worst first, best last, on every snapshot in P1 and P2 | ascending, best first |
| socket delta | in no fixed order: deletes and inserts are mixed, as `[["82572.5","0"],["82529.9","0"],["82573.4","0.181"],["82531.3","0.119"]]` | in no fixed order |
| REST `/v3/depth` | descending, best first | ascending, best first |

S1 says the snapshot is "sorted by price, starting with the lowest buys and ending with the highest sells", which matches the wire.
So a feed that takes the first bid of a socket snapshot as the best bid takes the worst one, and a feed must apply every level by price.

### Age at arrival

`ts` is the server's instant in microseconds, and arrival minus `ts` is the age a feed receives.

| run | book frames | age p10 | age p50 | age p90 | max |
|---|---:|---:|---:|---:|---:|
| P1 `book`, 4 books | 1,372 | 110 ms | 112 ms | 117 ms | 850 ms |
| P2 `book`, 4 books | 1,257 | 114 ms | 115 ms | 127 ms | 1,462 ms |
| P1 `batch`, 86 books | 6,444 | 109 ms | 110 ms | 115 ms | 1,310 ms |
| P2 `batch`, 86 books | 7,497 | 109 ms | 111 ms | 116 ms | 1,469 ms |

The floor of about 108 ms is the path from the venue's clock to this host, plus any clock offset, which [`rest.md`](./rest.md) section 7 bounds within about 140 ms.

### Dead, inactive and unknown symbols

| symbol | catalog | probed |
|---|---|---|
| `IOUSDT` | `enableTrade` true, `enableDisplay` false, `enableOpenPosition` false, `pullOffTime` 2025-12-12 | acknowledged, and no frame in 60 s, P1 and P2 `batch` |
| `STBLUSDT` | `enableTrade` true, `enableDisplay` false, `pullOffTime` 2026-05-19 | acknowledged, and no frame in 40 or 60 s, P1 and P2 `book` and `batch` |
| `MATICUSDT` | `enableTrade` false | acknowledged with `success` true, and no frame |
| `NOPEUSDT` | absent | `error:handler not found` |

So two of CCXT's 88 active markets never receive a book.
The REST book of both is empty too, see [`rest.md`](./rest.md) section 5.

## 5. Session

| item | documented, S1 | probed |
|---|---|---|
| client keepalive | send `{"op":"ping","args":["<ms>"]}` every 15 s | answered by `{"success":true,"ret_msg":"pong",…}` in 211 to 224 ms, also without `args` |
| server keepalive | "When receiving a ping message from the server, a pong message needs to be returned to the server" | the server sent `{"op":"ping","args":["<ms>"]}` every 15.0 s on every socket, and CCXT Pro answers with `{"op":"pong","args":["<ms>"]}`, `pro/apex.js` lines 1035 to 1047 |
| silence the server tolerates | "If the difference between the client timestamp and the current timestamp exceeds 150s, the connection will be closed" | a socket that subscribed one book and then sent nothing, not even a pong, was closed with no close frame at 151.6 s in P1 and 161.8 s in P2 `silence`, while book deltas were still arriving. That fits a check every 15 s that fires once 150 s have passed |
| forced disconnect | possible at any time | none seen |
| compression | Not publicly specified | text JSON frames. `permessage-deflate` was negotiated only when the client offered it, as `permessage-deflate; server_no_context_takeover; client_no_context_takeover`, P1 and P2 `control` |
| handshake | | 299 to 490 ms to open |
| subscription limits | Not publicly specified | 88 book topics on one socket, or `instrumentInfo.all` with three `instrumentInfo.H` topics, without refusal |
| duplicate subscribe | | `error:topic:already subscribed orderBook25.H.BTCUSDT`, and the first subscription keeps flowing |
| unsubscribe | `{"op":"unsubscribe","args":[…]}` | acknowledged with `success` true |
| non-JSON frame | | `Failed to decode incoming data:readObjectStart: …`, and the socket stays open |
| throughput, 88 books at 25 levels | | 106.5 and 123.5 frames a second, 24.7 and 30.7 KiB a second, and 238 and 254 bytes a frame, in P1 and P2 `batch`. `BTCUSDT` alone was 13.8 and 14.3 frames a second |
| throughput, anchor | | `instrumentInfo.all` adds one 68.9 KB frame every 2 s, about 34 KB a second |

## 6. Captured frames

Trimmed from the P1 and P2 captures, with the values as received.
Book level arrays are cut to two per side, and each block is valid JSON.

Subscribe, and its acknowledgement, P1 `book`.

```json
{"op":"subscribe","args":["orderBook200.H.BTCUSDT"]}
```

```json
{"success":true,"ret_msg":"","conn_id":"88acfa4e-d562-49e7-a8f3-d70b7900119c","request":{"op":"subscribe","args":["orderBook200.H.BTCUSDT"]}}
```

Snapshot, P1 `control`, with the two worst bids and the two best asks kept, which is the wire order.

```json
{"topic":"orderBook25.H.BTCUSDT","type":"snapshot","data":{"s":"BTCUSDT","b":[["82480.0","0.013"],["82495.7","0.706"]],"a":[["82579.0","4.069"],["82586.0","0.466"]],"u":13862735},"cs":66883406455,"ts":1791843545377395}
```

Delta, P1 `book`, whole.

```json
{"topic":"orderBook200.H.BTCUSDT","type":"delta","data":{"s":"BTCUSDT","b":[["82572.5","0"],["82529.9","0"],["82573.4","0.181"],["82531.3","0.119"]],"a":[["82661.5","0"],["82703.5","0"],["82705.0","0.053"],["82662.3","0.050"]],"u":10361424},"cs":66883492058,"ts":1791843647971507}
```

Server ping, and the client ping with its answer, P1.

```json
{"op":"ping","args":["1791843653937"]}
```

```json
{"op":"ping","args":["1791843546130"]}
```

```json
{"success":true,"ret_msg":"pong","conn_id":"f53ced3a-4c5c-4bb8-b18d-29bb04188e91","request":{"op":"ping","args":["1791843546130"]}}
```

Errors, P1 `control`.

```json
{"success":false,"ret_msg":"error:handler not found","conn_id":"f53ced3a-4c5c-4bb8-b18d-29bb04188e91","request":{"op":"subscribe","args":["orderBook25.H.NOPEUSDT"]}}
```

```json
{"success":false,"ret_msg":"error:topic:already subscribed orderBook25.H.BTCUSDT","conn_id":"f53ced3a-4c5c-4bb8-b18d-29bb04188e91","request":{"op":"subscribe","args":["orderBook25.H.BTCUSDT"]}}
```

```json
{"success":false,"ret_msg":"error:invalid op","conn_id":"f53ced3a-4c5c-4bb8-b18d-29bb04188e91","request":{"op":"nope","args":[]}}
```

`instrumentInfo.all`, P2 `anchor`, with the 369 rows cut to `BTCUSDT`.
`xp` is the index, `mp` the mark and `fr` the funding rate.

```json
{"topic":"instrumentInfo.all","type":"snapshot","ts":1791844337893771,"data":[{"s":"BTCUSDT","p":"82610.5","pr":"-0.0115440806075479","h":"84303.9","l":"82266.6","xp":"82650.16","to":"278292165.2159","v":"3342.116","fr":"0.0000125","o":"1640.9339999999998","tc":"22647","ss":"0","mp":"82619.71"}]}
```

`instrumentInfo.H.BTCUSDT`, P1 `anchor`, a snapshot and then two deltas.
A delta names only the keys that changed, and `symbolStatus` is repeated on every frame.

```json
{"topic":"instrumentInfo.H.BTCUSDT","type":"snapshot","data":{"symbol":"BTCUSDT","lastPrice":"82553.3","price24hPcnt":"-0.0122556761620338","highPrice24h":"84303.9","lowPrice24h":"82266.6","turnover24h":"278818665.7621","volume24h":"3348.38","nextFundingTime":"2026-10-12T23:00:00Z","indexPrice":"82599.29","openInterest":"1640.9339999999998","tradeCount":"22611","symbolStatus":"0","markPrice":"82561.83","fundingRate":"0.0000125","predictedFundingRate":"0.0000125"},"cs":66883620984,"ts":1791843777373270}
```

```json
{"topic":"instrumentInfo.H.BTCUSDT","type":"delta","data":{"symbol":"BTCUSDT","indexPrice":"82599.07","symbolStatus":"0","markPrice":"82563.06"},"cs":66883621378,"ts":1791843777971570}
```

```json
{"topic":"instrumentInfo.H.BTCUSDT","type":"delta","data":{"symbol":"BTCUSDT","symbolStatus":"0"},"cs":66883621263,"ts":1791843777771524}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.

- The private URL is `wss://quote.omni.apex.exchange/realtime_private?v=2&timestamp=<ms>`.
- A client sends `{"op":"login","args":["<json>"]}`, whose JSON holds the API key, the passphrase, a timestamp and an HMAC-SHA256 signature of `timestamp + "GET" + "/ws/accounts"`.
- The topics are `ws_zk_accounts_v3` and `ws_notify_v1`, and order entry is REST with a zkLink signature, see [`rest.md`](./rest.md) section 9.
- The observatory never sends any of these.

## 8. Recommended feed shape

A recommendation for the builder, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://quote.omni.apex.exchange/realtime_public?v=2&timestamp=<ms at connect>` | one socket carried all 88 books and the anchor channel, sections 1 and 5 |
| book channel | `orderBook25.H.<crossSymbolName>`, the smallest depth of at least 20, as decision 22 of [`2026-10-08-venue-adapter-waves-design.md`](../../plans/2026-10-08-venue-adapter-waves-design.md) asks | 25 levels at a p50 of 51 ms between deltas |
| symbol | `crossSymbolName`, which is CCXT's `id2`, never CCXT's `market.id` | a dashed id such as `ETH-USDT` answers `error:handler not found` |
| markets per connection | all of them on one socket | 106.5 frames and 24.7 KiB a second for 88 books, P1 `batch` |
| subscribe frames | `{"op":"subscribe","args":[…]}` with at most 10 topics a frame, every topic taken from the live catalog | one unknown topic fails its whole frame without closing the socket |
| anchor on the same socket | one more frame, `{"op":"subscribe","args":["instrumentInfo.all"]}`, read into `SocketAnchors` | see [`rest.md`](./rest.md) section 8 |
| snapshot | `reset_book` on `type` `snapshot`, after sorting the bids descending | snapshot bids arrive worst first |
| delta | apply each `[price, size]` by price, size `"0"` deletes, then `publish` | delta levels are unordered |
| sequence and resync | keep `u` per topic. A delta whose `u` is not the last `u` plus 1, or a delta before any snapshot, calls `resync` | 0 gaps in 6,358 and 7,411 deltas, P1 and P2 `batch`, so a gap is rare and a whole-socket reconnect is cheap |
| keepalive | `ping_every` 15 s with `{"op":"ping","args":["<ms>"]}`, and answer each server `{"op":"ping",…}` with `{"op":"pong","args":[<its args>]}` through `Connection::send` at [`venue_feed.rs`](../../../server/src/feeds/venue_feed.rs) line 228 | the server closes a socket whose client is silent for 150 s, whatever data it is sending |
| `max_silence` | 40 s | the server pings every 15 s, so 40 s is two missed pings, and a quiet book alone can be silent for minutes |
| `first_book_wait` | keep the 10 s default, and expect `IOUSDT` and `STBLUSDT` to be logged | neither has ever sent a book |
| deflate | keep it off | the server only negotiates it when the client offers it |
| routing | `topic` prefix `orderBook25.H.` for books and `instrumentInfo.all` for the anchor, and frames with `success` or `op` for control | section 3 |
| receive time | stamp on arrival, and keep `ts` in microseconds to judge age | p50 age about 110 ms, section 4 |

The feed fits `BookVenue` at [`venue_feed.rs`](../../../server/src/feeds/venue_feed.rs) line 78 without a new runtime piece.
YUBIT's web socket speaks the same protocol, with the `realtime_public?v=2` path, `op` frames, a server ping every 15 s and snapshot bids worst first, see [`../yubit/websocket.md`](../yubit/websocket.md).
YUBIT's `cs` skips and it sends no contiguous `u`, so the two share a frame shape and not a sequence rule.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ApeX Omni API v3 docs, sections "Websocket Endpoint" and "Public Websocket" | https://api-docs.omni.apex.exchange/ | 2026-10-12 | ApeX API docs | URLs, topics, keepalive, the 150 s rule, the `u` rule, private login, sections 1 to 7 |
| S2 | ApeX Omni API v3 docs, "GET All Config Data" | https://api-docs.omni.apex.exchange/#publicapi-v3-for-omni-get-all-config-data-v3 | 2026-10-12 | ApeX API docs | `crossSymbolName` as the socket symbol, section 3 |
| S3 | CCXT Pro 4.5.68 `apex.js` | `node_modules/.pnpm/ccxt@4.5.68/node_modules/ccxt/js/src/pro/apex.js` | 2026-10-12 | CCXT | URL and timestamp at lines 35 and 265 to 276, book topic at line 232, snapshot and delta handling at lines 287 to 347 with no `u` check, ping and pong at lines 1027 to 1061 |
| P1 | `ws-probe.py` modes `control` 22:19, `book` 22:20, `batch` 22:21, `anchor` 22:22 and `silence` 22:23 to 22:26 UTC | [`ws-probe.py`](../../../scripts/probes/venues/apex/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 6 |
| P2 | the same five modes rerun in the second pass, 22:31 to 22:37 UTC | [`ws-probe.py`](../../../scripts/probes/venues/apex/ws-probe.py) | 2026-10-12 | this host, Canadian exit | sections 1 to 6 |
