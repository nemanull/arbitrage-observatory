# Bithumb WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:18 to 03:26 UTC for run 1 and 03:38 to 03:44 UTC for run 2, from the development host near Seattle.

This profile covers the public WebSocket of Bithumb, which carries spot markets only, because Bithumb lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bithumb/ws-probe.mjs), and the capture is quoted beside the documented value.
Run 1 is the set of modes run from 03:18 to 03:26 UTC, and run 2 is the rerun from 03:38 to 03:44 UTC.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The documentation is the Korean API reference at `apidocs.bithumb.com`, read as Markdown by appending `.md` to each page URL, S1 to S7.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, public, KRW and BTC markets | `wss://ws-api.bithumb.com/websocket/v1`, S1 | opens in 312 to 848 ms over both runs, and all 493 markets delivered on one socket |
| spot, private v2 | `wss://ws-api.bithumb.com/websocket/v2/private`, S1 | not probed |
| spot, legacy public | `wss://pubwss.bithumb.com/pub/ws`, absent from the current documentation index, used by CCXT Pro `watchOrderBook` at `server/node_modules/ccxt/js/src/pro/bithumb.js` lines 30 and 199 | opens in 519 and 487 ms and still delivers `orderbookdepth` and `orderbooksnapshot` |
| perpetuals, futures, options | none | none exist, see [`fees.md`](./fees.md) section 3 |

One socket carries every KRW and BTC market, and the market is chosen by the `codes` list of the request.
`ws-api.bithumb.com` is a CNAME to `ws-api.bithumb.com.edgesuite.net` and `a1941.b.akamai.net`, and resolved to `184.30.150.36` and `184.30.150.39` on 2026-09-23, an Akamai edge.
`pubwss.bithumb.com` is a CNAME to `a1706.b.akamai.net` on the same edge.

## 2. Channel matrix for public market data

| type | request | depth and speed | probed |
|---|---|---|---|
| `orderbook` | `{"type": "orderbook", "codes": ["KRW-BTC"]}` with optional `level`, `isOnlySnapshot`, `isOnlyRealtime` | full book of at most 15 levels per push, S3, no speed documented | a whole 15 level book on every frame. Over 45 s in runs 1 and 2: 8.84 and 11.31 frames a second on `KRW-BTC`, 11.53 and 12.49 on `BTC-ETH`, 1.47 and 1.89 on `KRW-EGG`. Recommended |
| `orderbook` with a `.N` code suffix | `"codes": ["KRW-ETH.3"]`, S3 | N levels | `KRW-BTC.5` gave 5 levels, `KRW-BTC.30` gave 15 |
| `orderbook` with `level` | `"level": 1000`, a price grouping unit, S3 | grouped levels | `level` 1000 on `KRW-BTC` gave 12 grouped units in 1,000,000 KRW steps, `level` 7 answered `WRONG_FORMAT` |
| `ticker` | `{"type": "ticker", "codes": [...]}` | on trade | 1 snapshot and then 18 and 11 realtime frames in 45 s on `KRW-BTC`, carries `market_state`, `is_trading_suspended`, `delisting_date` and `market_warning` |
| `trade` | `{"type": "trade", "codes": [...]}` | on trade | 1 snapshot and then 32 and 38 realtime frames in 45 s on `KRW-BTC`, carries `sequential_id` |
| mark, index, funding | none | none | none exist |
| legacy `orderbookdepth` | `{"type": "orderbookdepth", "symbols": ["BTC_KRW"]}` on the legacy URL | changed levels only, no sequence | 62 and 64 frames in 15 s |
| legacy `orderbooksnapshot` | `{"type": "orderbooksnapshot", "symbols": ["BTC_KRW"]}` on the legacy URL | 30 levels per side as `[price, size]` strings | 61 and 63 frames in 15 s |

The type names and fields are from S3, S4 and S5.
The legacy types are not in the current documentation and are recorded as the wire showed them.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL for every market, S1 | 493 KRW and BTC markets on one socket, section 5 |
| subscribe frame shape | a JSON array of a ticket object, one or more type objects and an optional format object, S2 | `[{"ticket": "…"}, {"type": "orderbook", "codes": [...]}, {"format": "DEFAULT"}]` delivered, and a bare object answered `WRONG_FORMAT` and closed the socket |
| unknown symbol expectation | Not publicly specified | `KRW-NOPE`, lowercase `krw-btc`, `BTC-KRW` and `BTC_KRW` got no frame and no error in 2.5 s, and a list mixing `KRW-BTC` with `KRW-NOPE` delivered `KRW-BTC` only |
| chunk unit and budget | Not publicly specified | 493 codes in one type object were all served, the last first frame 726 and 809 ms after the request |
| keepalive mechanism | client WebSocket ping, or the text `PING`, answered by `{"status":"UP"}` every 10 s, S4 | protocol pong in 146 and 134 ms, text `PING` gave `{"status":"UP"}` every 9,967 to 10,048 ms, and the server sent no ping of its own |
| connection lifetime and maintenance notice | idle timeout of about 120 s, S4, and maintenance announced in the changelog, S6 | an idle socket closed at 60.00 and 60.00 s and a socket on a quiet market at 60.16 and 60.14 s, all 1006, and no lifetime cap was reached in 120 s with a keepalive |
| handshake and operation rate limits | 10 connection requests a second per IP, `429 Too Many Requests` beyond, and a 10 minute IP block if it persists, S1 | not tested, opens took 312 to 848 ms |
| public market data authentication | none, S1 | none |
| message parse and routing | a JSON object with `type` and `code`, S3 | route on `type` and `code`, or `ty` and `cd` in `SIMPLE` format. Every frame arrives as a binary WebSocket frame holding UTF-8 JSON |
| subscribe acknowledgement shape | none documented | none is sent, and the first data frame is the only confirmation |
| symbol identifier format | `KRW-BTC`, upper case, S3 | identical to `/v1/market/all` `market`, and different from CCXT `market.id`, which is `BTC`, see [`rest.md`](./rest.md) section 2 |
| number representation | `Double`, S3 | JSON numbers, sizes printed with four decimals, so `0.0000` appears on the wire |
| timestamp representation | `timestamp` in microseconds on `orderbook`, S3 | 16 digit microseconds, non-decreasing per market. A frame arrived a median 96 to 146 ms after its own `timestamp` on the five markets over both runs, and up to 4.6 s on the quiet `KRW-EGG` |
| size unit | "잔량", remaining quantity, S3 | base coin, equal to the REST book at the same price, section 4 |
| sequence semantics | none on `orderbook` | none. `trade` alone carries `sequential_id` |
| idle repeat behaviour | not documented | a frame identical to the one before it, levels and totals, 216 of 398 and 200 of 509 times on `KRW-BTC`, and a quiet market sends nothing after its snapshot |

## 4. The book channel in detail

`orderbook` on the public URL with the default 15 levels is the channel this profile describes, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

The first frame for each code is `"stream_type": "SNAPSHOT"` and every later frame is `"REALTIME"`.
The five book markets each got exactly one `SNAPSHOT`, 157 to 185 ms after the request was sent in run 1 and 146 to 164 ms in run 2.
In the `SIMPLE` format variant of run 2 a `REALTIME` frame arrived before the `SNAPSHOT`, so the order is not guaranteed, and it does not matter because every frame is a whole book.
`isOnlySnapshot: true` sent one frame and nothing more, and `isOnlyRealtime: true` skipped the `SNAPSHOT` frame.
The snake case `is_only_snapshot` that S2 writes was ignored and the stream ran as usual.

### Delta semantics

There are no deltas.
Every `REALTIME` frame carries the whole top of book, 15 units, exactly like the `SNAPSHOT`.
A feed replaces the book on every frame, which the engine does with `resetBook`.

### Sequence and gap rule

None.
The `orderbook` frame has no update id, so a lost frame cannot be detected and does not need to be, because the next frame replaces the book.
`timestamp` never decreased on any of the five markets in either run.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

A unit pairs the i-th best ask with the i-th best bid, `{ask_price, bid_price, ask_size, bid_size}`.
Bids descend and asks ascend through the units, with 0 order violations on 1,505 frames of five markets in run 1 and 1,678 in run 2.
The REST book `GET /v1/orderbook` uses the same unit shape, see [`rest.md`](./rest.md) section 5.

### Level window

At most 15 levels per side, S3, and every one of the 493 first frames carried 15 units in both batch runs.
A `.30` suffix still gave 15, so the socket cannot reach the engine's 20 levels, see [`Engine.ts`](../../../server/src/engine/Engine.ts) line 61.
The REST book returns 30 levels for a single market, and the legacy `orderbooksnapshot` sent 30.

### Size unit against CCXT `contractSize`

The unit is the base coin.
CCXT leaves `contractSize` undefined on these spot markets, at `server/node_modules/ccxt/js/src/bithumb.js` line 385, which the engine would read as 1.
In three REST compares on `KRW-BTC` per run, the socket levels whose price was also in the REST book had the same size 30 of 30, 30 of 30 and 29 of 29 times in run 1, and 28 of 29, 27 of 28 and 29 of 29 times in run 2.
The two reads were 1 to 169 ms apart by their own timestamps, so a miss is a level that changed between them.

Sizes are printed with four decimals.
A level whose size rounds below `0.0001` of the base appears with its price and a size of `0`.
On `KRW-BTC`, 403 units of 398 frames had such a side in run 1, and 1,457 sides of 509 frames were such in run 2, including at the best ask and the best bid, while `KRW-ETH`, `KRW-USDT`, `KRW-EGG` and `BTC-ETH` carried none.
In the run 2 batch, 54 of 493 markets carried at least one, 4,760 unit sides in 45 s.
The REST book shows the same thing, see [`rest.md`](./rest.md) section 5.
That these are dust orders under `0.00005` BTC is an inference from the rounding, since only the printed size is visible.
A feed must drop a level with a size of 0, or the engine would hold a price with no quantity.

### One-sided and empty books

A side with fewer than 15 levels is padded with units whose price and size are both 0.
On the socket, `level` 1000 on `KRW-BTC` returned 12 units holding 12 grouped bids and 4 grouped asks, and the other 8 ask slots read `"ask_price": 0, "ask_size": 0`.
In the run 2 batch, 5 of 493 markets padded their bids and none padded its asks, the same count the REST scan found, see [`rest.md`](./rest.md) section 5.
No empty side was seen.
A feed must drop a unit side whose price is 0.

### Idle repeats

| market | run 1 frames in 45 s | run 1 identical to the previous | run 1 median gap | run 2 frames in 45 s | run 2 identical to the previous | run 2 median gap |
|---|---:|---:|---:|---:|---:|---:|
| `KRW-BTC` | 398 | 216 | 97 ms | 509 | 200 | 81 ms |
| `KRW-ETH` | 425 | 55 | 96 ms | 402 | 79 | 88 ms |
| `BTC-ETH` | 519 | 8 | 78 ms | 562 | 8 | 72 ms |
| `KRW-USDT` | 97 | 18 | 237 ms | 120 | 17 | 100 ms |
| `KRW-EGG` | 66 | 0 | 160 ms | 85 | 0 | 248 ms |

The probe compares units, and in the run 1 capture every repeat also matched both totals, so whatever changed was outside the 15 levels or below the printed precision.
In the batch runs, 37 and 31 of 493 markets sent nothing for more than 30 s, and the quietest sent nothing after its snapshot for the whole 45 s.
There is no per market heartbeat, so a feed cannot tell a quiet book from a dead stream by the book frames alone.

### Unknown, closed and wrong form codes

| request | reply | then |
|---|---|---|
| `KRW-NOPE` | nothing | the socket stays open |
| `krw-btc` | nothing | the socket stays open |
| `BTC-KRW`, `BTC_KRW` | nothing | the socket stays open |
| `KRW-BTC` and `KRW-NOPE` in one list | `KRW-BTC` frames only | |
| no ticket object | `{"error":{"name":"NO_TICKET","message":"티켓이 존재하지 않거나, 유효하지 않습니다."}}` | the server closes the socket with 1000 |
| no `type` field | `WRONG_FORMAT` | closed with 1000 |
| `type` `nope` | `{"error":{"name":"INVALID_PARAM","message":"nope 은 지원하지 않는 타입입니다."}}` | closed with 1000 |
| empty `codes` | `INVALID_PARAM` "codes 필드가 비어 있습니다." | closed with 1000 |
| text `hello`, or a bare object | `WRONG_FORMAT` "Format 이 맞지 않습니다." | closed with 1000 |
| `format` `NOPE` | ignored | the `DEFAULT` format is sent |
| a second request on the same socket, `KRW-ETH` after `KRW-BTC` | `KRW-ETH` frames | `KRW-BTC` stopped after one more frame in run 1 and two in run 2, so a new request replaces the old one |

S5 documents the error names and does not say that an error closes the socket.
Because every later request replaces the earlier one, a feed must send the full code list of the socket in every request.
A closed market was not available to probe, since all 493 markets were listed and trading, see [`rest.md`](./rest.md) section 2.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client ping frame, or the text `PING`, after which `{"status":"UP"}` arrives every 10 s, S4 | protocol ping every 30 s answered with a pong, the first in 146 and 134 ms. One text `PING` gave 12 `{"status":"UP"}` frames in 120 s in each run, the first 3.18 and 2.82 s after it and then every 9,967 to 10,048 ms. No server ping |
| silence the server tolerates | "약 120초가 경과하면 Idle Timeout", about 120 s with nothing sent or received, S4 | 60 s. A socket that sent nothing closed at 60.00 s in both runs, and a socket subscribed to a quiet market closed at 60.16 and 60.14 s after its one trade snapshot, all with 1006 and no close frame. The two sockets that pinged stayed open for the full 120 s |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | changelog notices only, such as the public WebSocket work of 2026-08-20 that "기존 연결된 퍼블릭 웹소켓 세션이 종료될 수 있습니다", existing sessions may be closed, S6 | no in-band notice exists |
| compression | `permessage-deflate` is accepted when the client asks, since 2026-08-12, and is optional, S1, S7 | offered: `sec-websocket-extensions: permessage-deflate` came back in both runs. Not offered: no extension, and all 38 and 36 frames were uncompressed binary frames holding JSON |
| handshake | 10 connection requests a second per IP, S1 | 312 to 848 ms to open from this host |
| subscription limits | Not publicly specified | 493 codes in one request, all served |
| throughput | | 493 markets on one socket, runs 1 and 2: median 936 and 968 frames a second, p90 1,128 and 1,177, peak 1,483 and 1,675, 1,297 and 1,370 KB a second, 1,380 and 1,377 bytes a frame, 13.4 and 12.9 µs `JSON.parse` a frame |

The documented 120 s idle timeout did not hold on the wire, which closed idle sockets at 60 s.
A feed has to send its own keepalive well inside 60 s.

## 6. Captured frames

Trimmed, from run 1.
Arrays marked with a comment are cut to three units.

Request, five markets in one type object, plus ticker and trade.

```json
[{"ticket": "probe-x1"}, {"type": "orderbook", "codes": ["KRW-BTC", "KRW-ETH", "KRW-USDT", "BTC-ETH", "KRW-EGG"]}, {"type": "ticker", "codes": ["KRW-BTC", "KRW-EGG"]}, {"type": "trade", "codes": ["KRW-BTC", "KRW-EGG"]}, {"format": "DEFAULT"}]
```

Snapshot, three of 15 units kept.

```json
{"type":"orderbook","code":"KRW-ETH","total_ask_size":369.9832,"total_bid_size":287.0216,"orderbook_units":[{"ask_price":3715000,"bid_price":3714000,"ask_size":8.4592,"bid_size":3.012},{"ask_price":3716000,"bid_price":3713000,"ask_size":3.3766,"bid_size":15.399},{"ask_price":3717000,"bid_price":3712000,"ask_size":4.1755,"bid_size":135.5129}],"level":1,"timestamp":1790133505546514,"stream_type":"SNAPSHOT"}
```

The next frame for the same market, again a whole book, 80.5 ms later by `timestamp`.

```json
{"type":"orderbook","code":"KRW-ETH","total_ask_size":370.1063,"total_bid_size":288.3156,"orderbook_units":[{"ask_price":3715000,"bid_price":3714000,"ask_size":8.4592,"bid_size":4.106},{"ask_price":3716000,"bid_price":3713000,"ask_size":3.3766,"bid_size":15.599},{"ask_price":3717000,"bid_price":3712000,"ask_size":4.1755,"bid_size":135.5129}],"level":1,"timestamp":1790133505627050,"stream_type":"REALTIME"}
```

A `KRW-BTC` snapshot with a zero size at a live price, the third ask.

```json
{"type":"orderbook","code":"KRW-BTC","total_ask_size":0.7111,"total_bid_size":7.1052,"orderbook_units":[{"ask_price":116208000,"bid_price":116204000,"ask_size":0.3313,"bid_size":0.0037},{"ask_price":116209000,"bid_price":116203000,"ask_size":0.0001,"bid_size":0.0025},{"ask_price":116215000,"bid_price":116201000,"ask_size":0,"bid_size":0.0004}],"level":1,"timestamp":1790133505564033,"stream_type":"SNAPSHOT"}
```

Padding, from `level` 1000 on `KRW-BTC`, units four to six.

```json
{"orderbook_units":[{"ask_price":120000000,"bid_price":113000000,"ask_size":15.721,"bid_size":5.5544},{"ask_price":0,"bid_price":112000000,"ask_size":0,"bid_size":6.1459},{"ask_price":0,"bid_price":111000000,"ask_size":0,"bid_size":2.9321}]}
```

The same book in `SIMPLE` format.

```json
{"ty":"orderbook","cd":"KRW-BTC","tas":0.1823,"tbs":6.9593,"obu":[{"ap":116279000,"bp":116267000,"as":0.0892,"bs":0.0084},{"ap":116280000,"bp":116248000,"as":0.0087,"bs":0.0213},{"ap":116290000,"bp":116239000,"as":0.0025,"bs":0.0024}]}
```

Ticker, which carries market state and alert fields, and whose `trade_date` and `trade_time` are Korean time while `trade_timestamp` is Unix ms.

```json
{"type":"ticker","code":"KRW-BTC","trade_price":116208000,"trade_date":"20260923","trade_time":"121833","trade_timestamp":1790133513858,"market_state":"ACTIVE","is_trading_suspended":false,"delisting_date":"","market_warning":"NONE","timestamp":1790133514044,"stream_type":"REALTIME"}
```

Trade, the only public type with a sequence field.

```json
{"type":"trade","code":"KRW-BTC","trade_price":116208000,"trade_volume":0.0009,"ask_bid":"BID","trade_date":"2026-09-23","trade_time":"12:18:33","trade_timestamp":1790133513739,"sequential_id":1079953210371761700,"timestamp":1790133514039,"stream_type":"REALTIME"}
```

Keepalive answer to the text `PING`.

```json
{"status":"UP"}
```

Errors, each followed by a server close with 1000.

```json
{"error":{"name":"NO_TICKET","message":"티켓이 존재하지 않거나, 유효하지 않습니다."}}
```

```json
{"error":{"name":"INVALID_PARAM","message":"nope 은 지원하지 않는 타입입니다."}}
```

```json
{"error":{"name":"WRONG_FORMAT","message":"Format 이 맞지 않습니다."}}
```

Legacy socket, the first frames after connecting and subscribing.

```json
{"status":"0000","resmsg":"Connected Successfully"}
```

```json
{"status":"0000","resmsg":"Filter Registered Successfully"}
```

```json
{"type":"orderbooksnapshot","content":{"symbol":"BTC_KRW","datetime":"1790133914965948","asks":[["116501000","0.0163"],["116510000","0.0051"],["116511000","0.0004"]],"bids":[["116500000","0.7074"],["116475000","0.0258"]]}}
```

## 7. Private channels

Named for a future execution stage, from S1 and S2, not probed.

- `myOrder` and `myAsset` on `wss://ws-api.bithumb.com/websocket/v2/private`, authenticated by a JWT in the `authorization` header of the upgrade request, S2.
- The v1 private streams end on 2026-10-30, S1.
- CCXT Pro still points `privateV2` at `wss://ws-api.bithumb.com/websocket/v1/private`, at `server/node_modules/ccxt/js/src/pro/bithumb.js` line 32.

## 8. Recommended feed shape

No feed is recommended, because Bithumb lists no perpetual and its markets quote in KRW, outside the engine's settlement family, see [`rest.md`](./rest.md) section 2.
If a KRW spot leg were ever modelled, the shape below follows from the probes.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket on `wss://ws-api.bithumb.com/websocket/v1` for every market | one URL serves all 493 markets |
| channel | `orderbook` with plain codes, 15 levels | the only public book on the documented socket |
| markets per connection | all, or slices of 250 if a smaller blast radius is wanted | 493 ran on one socket at a median 936 and 968 frames a second, and no cap is published |
| subscribe frames | one request per socket, `[{"ticket": "<uuid>"}, {"type": "orderbook", "codes": [...]}]`, and the whole list again whenever it changes | a new request replaces the old one |
| keepalive | a WebSocket ping every 20 s, or one text `PING` on open | idle sockets closed at 60 s, and `{"status":"UP"}` arrives every 10 s after one `PING` |
| `maxSilenceMs` | 30,000 with the text `PING`, since the status frame counts as traffic | three missed status frames, and a quiet market can send nothing for the whole session |
| routing | `code` is the socket symbol, which is `quote-base`, while CCXT's `market.id` is the base alone | the feed must map `${quote}-${id}` to the market, see [`rest.md`](./rest.md) section 2 |
| every frame | `resetBook` from the units, dropping any side whose price or size is 0 | full books, zero padding and zero printed sizes |
| resync | none needed for gaps, since there is no sequence | every frame replaces the book |
| unserved code | log a code with no frame 10 s after the request | unknown codes are silent, while every listed code sent a first frame within 809 ms |
| errors | log and reconnect | an error frame is followed by a server close |
| receive time | stamp on arrival | the frame `timestamp` was a median 96 to 146 ms old on arrival at this host, and up to 4.6 s on a quiet market |
| depth | 15 levels, short of the engine's 20 | the socket caps at 15 |
| deflate | keep `perMessageDeflate: false` | the server compresses only when asked |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | 기본 정보 (WebSocket basics), updated 2026-09-07 | https://apidocs.bithumb.com/reference/기본-정보 | 2026-09-22 | Bithumb, Korea | URLs, types, deflate, connection rate limit, v1 private end date, sections 1, 3, 5 and 7 |
| S2 | 요청 방법 및 포맷 (request format), updated 2026-09-07 | https://apidocs.bithumb.com/reference/요청-포맷 | 2026-09-22 | Bithumb, Korea | ticket, type and format fields, private JWT header, sections 3 and 7 |
| S3 | 호가 (Orderbook), updated 2026-08-13 | https://apidocs.bithumb.com/reference/호가-orderbook | 2026-09-22 | Bithumb, Korea | fields, 15 levels, `level`, `.N` suffix, microsecond timestamp, sections 2 to 4 |
| S4 | 연결 관리 (connection management), updated 2026-06-30 | https://apidocs.bithumb.com/reference/연결-관리 | 2026-09-22 | Bithumb, Korea | ping, `PING` and `{"status":"UP"}`, the 120 s idle timeout, sections 3 and 5 |
| S5 | 웹소켓 에러 (WebSocket errors), updated 2026-06-30 | https://apidocs.bithumb.com/reference/웹소켓-에러 | 2026-09-22 | Bithumb, Korea | error names, section 4 |
| S6 | [공지] Public WebSocket 연결 일시 중단 안내 (public WebSocket suspension) | https://apidocs.bithumb.com/changelog/공지-public-websocket-연결-일시-중단-안내-1 | 2026-09-22 | Bithumb, Korea | maintenance of 2026-08-20, section 5 |
| S7 | WebSocket 메시지 경량화(압축) 기능 적용 안내 (compression) | https://apidocs.bithumb.com/changelog/websocket-메시지-경량화압축-기능-적용-안내 | 2026-09-22 | Bithumb, Korea | deflate from 2026-08-12, section 5 |
| S8 | CCXT Pro 4.5.68 `bithumb.js` | `server/node_modules/ccxt/js/src/pro/bithumb.js` | 2026-09-22 | CCXT | legacy URL, `orderbookdepth`, private URL, sections 1 and 7 |
| S9 | CCXT 4.5.68 `bithumb.js` | `server/node_modules/ccxt/js/src/bithumb.js` | 2026-09-22 | CCXT | `contractSize` undefined, section 4 |
| P1 | [`ws-probe.mjs`](../../../scripts/probes/venues/bithumb/ws-probe.mjs) `book`, run 1 at 03:18 UTC | local | 2026-09-23 UTC | this host | sections 2 to 4 and 6 |
| P2 | [`ws-probe.mjs`](../../../scripts/probes/venues/bithumb/ws-probe.mjs) `batch` and `errors`, run 1 at 03:20 and 03:21 UTC | local | 2026-09-23 UTC | this host | sections 3 to 5 |
| P3 | [`ws-probe.mjs`](../../../scripts/probes/venues/bithumb/ws-probe.mjs) `silence`, `deflate` and `legacy`, run 1 at 03:22 to 03:26 UTC | local | 2026-09-23 UTC | this host | sections 1, 2 and 5 |
| P4 | [`ws-probe.mjs`](../../../scripts/probes/venues/bithumb/ws-probe.mjs), every mode, run 2 at 03:38 to 03:44 UTC | local | 2026-09-23 UTC | this host | the second readings |
