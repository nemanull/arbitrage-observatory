# Digital X WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:20 to 03:35 UTC, from the development host near Seattle.

This profile covers the public WebSocket of Digital X, formerly Korbit, which serves spot markets only, with the `orderbook` channel in detail.
Digital X lists no perpetual, see [`fees.md`](./fees.md) section 3, so this is the spot profile of template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md).
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/digital-x/ws-probe.mjs) in two runs, and the capture is quoted beside the documented value.
The documentation is the Open API v2 reference, whose agent bundle at `https://docs.digitalx.miraeasset.com/llms.txt` was read as text, S1.

## 1. Endpoints

| use | documented URL | probed |
|---|---|---|
| public market data | `wss://ws-api.digitalx.miraeasset.com/v2/public`, S1 | opened with 101 in 548 to 737 ms over twelve sockets, every pair delivers |
| public, former host | `wss://ws-api.korbit.co.kr/v2/public`, which "still accepts connections on the same paths", S2 | opened in 568 and 618 ms, and `btc_krw` sent a 30 by 30 snapshot and 7 and 13 frames in 3 s |
| private account data | `wss://ws-api.digitalx.miraeasset.com/v2/private`, S1 | not probed |

One public socket carries every pair, since the venue has one product family, KRW spot.
`ws-api.digitalx.miraeasset.com` resolved to the same two Cloudflare addresses as the REST host, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | request | depth and speed | probed on 2026-09-23 UTC |
|---|---|---|---|
| `orderbook` | `{"method":"subscribe","type":"orderbook","symbols":["btc_krw"]}` | "Up to 30 prices are available for each side", optional `level` for price grouping, speed Not publicly specified | 30 bids and 30 asks in every frame of every live book, recommended |
| `ticker` | `type` `ticker` | last, 24 h figures, best bid and best ask price, no sizes | 11 and 14 frames in about 25 s on `btc_krw` |
| `trade` | `type` `trade` | snapshot of the latest trade, then trades | 1 and 5 frames in about 10 s on `btc_krw` |

Channel names and schemas are from S1 and S3.
No mark, index or funding channel exists, since the venue has no derivative.
The grouping levels a pair accepts are listed in `orderbookLevels` of `GET /v2/tickSizePolicy`, see [`rest.md`](./rest.md) section 5.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL and one private URL, S1 | all 193 launched pairs on one public socket |
| subscribe frame shape | a JSON array of request objects, `[{"requestId": 1, "method": "subscribe", "type": "ticker", "symbols": ["btc_krw"]}]`, several objects allowed, "it must be enclosed in square brackets", S2 | one object with 193 symbols was acked once, and all 193 snapshots arrived in 634 and 745 ms. A bare object without the array answered `{"status":"fail","message":"invalid_format"}` |
| unknown symbol expectation | `{"requestId": 1, "status": "fail", "code": "INVALID_SYMBOL"}`, S2 | `{"status":"fail","code":"INVALID_SYMBOL","message":"The symbol does not exist (nope_krw)","requestId":2}`, also sent for a request without `requestId`, and for `BTC_KRW` in upper case |
| chunk unit and budget | Not publicly specified | 193 symbols in one request object, with no refusal |
| keepalive mechanism | Not publicly specified | the server sent a WebSocket protocol ping with payload `ping` every 30.0 s, 4 in 120 s on each of six sockets. In the second run the first came 29,997 to 30,000 ms after the open and the next ones 29,999 to 30,002 ms apart. The `ws` library answers it with a pong. A client protocol ping got its pong in 128 to 130 ms |
| connection lifetime and maintenance notice | public messages "can be dropped under load", S1. For private data "the WebSocket connection might be forcibly closed", S2 | no socket closed during 120 s, including two that never subscribed. No maintenance frame seen |
| handshake and operation rate limits | Not publicly specified | no refusal over fourteen opens, and fourteen requests sent 1.5 s apart on one socket |
| public market data authentication | none, S2 | none |
| message parse and routing | data messages carry `type` and `symbol` and no `status`. Control messages carry `status`, S2 | same. Route on `type` and `symbol` |
| subscribe acknowledgement shape | "By default, no responses will be sent when subscribe / unsubscribe requests succeed", and a request with `requestId` always gets `{"requestId": 1, "status": "success"}`, S2 | `{"status":"success","requestId":1}` in 130 to 138 ms, in the same millisecond as the first snapshot or one before it |
| symbol identifier format | lower case `btc_krw`, S1 | identical to the REST `symbol` on the 193 launched pairs served in one batch and on the stopped `klay_krw`. There is no CCXT class to compare with |
| number representation | `price` and `qty` strings, and `amt` string only on grouped books, S3 | strings as documented. A grouped book on the socket names the quote amount `quoteVolume`, not `amt`, while the grouped REST book names it `amt` |
| timestamp representation | envelope `timestamp` is "Server time", `data.timestamp` is the book's time, both Unix ms, S3 | envelope minus `data.timestamp` was 13 to 294 ms on `btc_krw` with median 30 ms in P2, up to 35.9 s on a quiet book, and 7.8 days on a stopped book |
| size unit | `qty` is a quantity, S3 | base coins, `"0.00499"` BTC at 116,455,000 KRW, and the REST book agrees level for level, section 4 |
| sequence semantics | none documented | no sequence or update id on any frame. Every frame carries the whole top 30 of each side |
| idle repeat behaviour | not documented | 1 frame identical to the previous one on `btc_krw` and 1 on `usdt_krw` in the first 60 s run, 0 in the second. A quiet book stays silent, 40.1 s and 33.3 s on `bat_krw` in the two runs |

## 4. The book channel in detail

### Snapshot on subscribe

The first frame for each symbol has `"snapshot": true` and the whole top 30 of each side.
It arrived 130 to 139 ms after the subscribe frame was sent, in both runs, for all five symbols of the book mode.
Later frames omit the `snapshot` key entirely, while the schema describes it as `false` or `null`, S3.

### Delta semantics

There are no deltas.
Every frame of the four live books in both runs carried exactly 30 bids and 30 asks, and no level ever had a zero `qty`.
Between two consecutive `btc_krw` frames a median of 2 and 3 levels changed, and at most 9.
So each frame is a full replacement of the top 30, and a feed resets the book on every frame, snapshot or not.

At 20 s and 40 s into each run the REST book for `btc_krw` was read beside the socket.
All four times, the REST book equalled the last socket frame on 60 of 60 levels and had the same `data.timestamp`, in P1 and P2.

### Frame cadence

| symbol | frames in 60 s, P1 and P2 | gap between frames |
|---|---|---|
| `btc_krw` | 181 and 144 | median 314 and 410 ms, p90 557 and 677 ms, max 768 and 1,467 ms, min 91 ms and p10 107 ms in P2 |
| `usdt_krw` | 105 and 66 | median 425 and 586 ms, max 4,675 and 5,747 ms |
| median launched pair by 24 h volume, `bat_krw` in both runs | 4 and 13 | max 40.1 s and 33.3 s |
| lowest 24 h volume launched pair, `usds_krw` then `comp_krw` | 9 and 66 | max 52.4 s and 5.7 s |

The shortest gap of 91 ms and a 10th percentile of 107 ms suggest the server sends a book at most about every 100 ms, which is an inference from P2, not a documented rate.
The envelope `timestamp` reached this host 65 to 66 ms after it was stamped at best, median 66 to 67 ms, with a clock offset of 3 to 5 ms, see [`rest.md`](./rest.md) section 7.

### Sequence and gap rule

```text
any orderbook frame    replace both sides with the frame's levels, publish
no sequence field      no gap can be detected, and none needs to be
```

The documentation warns that public messages "can be dropped under load" and asks clients to refetch a REST snapshot on reconnect, S1.
Because every frame is the whole top 30, a dropped frame is repaired by the next one, and the snapshot sent on every subscribe repairs a reconnect without a REST call.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| source | bids | asks |
|---|---|---|
| socket, every frame | best first, descending, 0 exceptions in both runs | best first, ascending, 0 exceptions |
| REST `GET /v2/orderbook` | descending, 30 levels | ascending, 30 levels |

### Size unit

`qty` is in base coins and `price` in KRW per coin.
The snapshot's best `btc_krw` bid was `{"price":"116455000","qty":"0.00499"}`, which is 0.00499 BTC.
There is no CCXT market and so no `contractSize`, and a contract size of 1 is the value that would describe these sizes.

### One-sided and empty books

A `stopped` pair, `klay_krw`, answered the subscribe with success and one snapshot with empty `bids` and `asks`, whose `data.timestamp` `1789456789897` is 2026-09-15 07:19:49 UTC, 7.8 days old.
Nothing followed it in 60 s.
No one-sided book was seen, so what a book with one empty side sends is Not verified.
The engine's `resetBook` at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 263 accepts an empty side.

### Idle repeats

A quiet book sends nothing until its top 30 changes.
In the first silence run, `tdrop_krw`, then the launched pair with the lowest volume, sent its snapshot and nothing else for 120 s.
The first run saw one frame on `btc_krw` and one on `usdt_krw` identical to the frame before, and the second run saw none.

### Unknown, closed and malformed requests

| request | reply, P1 and P2 |
|---|---|
| `orderbook` `nope_krw` with `requestId` 2 | `{"status":"fail","code":"INVALID_SYMBOL","message":"The symbol does not exist (nope_krw)","requestId":2}` |
| `orderbook` `nope2_krw` without `requestId` | `{"status":"fail","code":"INVALID_SYMBOL","message":"The symbol does not exist (nope2_krw)"}` |
| `orderbook` `BTC_KRW` | `INVALID_SYMBOL`, symbols are case sensitive |
| `type` `nope` | `{"status":"fail","code":"INVALID_REQUEST","message":"unknown_type","requestId":4}` |
| a bare object, not an array | `{"status":"fail","message":"invalid_format"}` |
| text that is not JSON | `{"status":"fail","message":"invalid_format"}`, and the socket stays open |
| `orderbook` on the stopped `klay_krw` | success, then one empty snapshot |
| `orderbook` `btc_krw` a second time on the same socket | success, whether frames then double was not measured |
| `orderbook` `eth_krw` with `level` `100000` | success, a grouped book of 30 levels per side at 100,000 KRW steps |
| `orderbook` `xrp_krw` with `level` `7` | `{"status":"fail","code":"INVALID_REQUEST","message":"invalid_level","requestId":11}` |
| `unsubscribe` `orderbook` `btc_krw` | success, and 0 `btc_krw` book frames in the next 4 s |

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | a server protocol ping every 30.0 s with payload `ping`, answered by the client library's automatic pong |
| silence the server tolerates | Not publicly specified | a socket that never subscribed and never sent a frame stayed open for the full 120 s in both runs, answering pings. A client that does not answer pings was not tested, because the `ws` library always answers them |
| forced disconnect | possible for private sockets under load, S2 | none in 120 s |
| maintenance notice | none on the socket | none. Announcements come from `GET /v2/notices`, see [`rest.md`](./rest.md) section 6 |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got 101 with no `sec-websocket-extensions` header, from `server: cloudflare`, in both runs |
| handshake | | 548 to 737 ms to open from this host |
| subscription limits | Not publicly specified | 193 symbols in one request, no cap reached |
| throughput | | all 193 launched pairs for 45 s: 158.5 and 141 frames per second, median 158 and 137, peak 339 and 326, 343.4 and 306.2 KB per second, 2,218 and 2,223 bytes per frame, 48.4 and 47 µs `JSON.parse` per frame. 50 and 44 pairs sent only their snapshot |

A frame is large because it is always the whole top 30 of both sides.
About 150 frames per second at 47 to 48 µs each cost about 7 ms of `JSON.parse` per second for the whole venue.

## 6. Captured frames

Trimmed, from the second run at 03:30 to 03:32 UTC.
Level arrays keep their first three or two entries.

Subscribe, with an acknowledgement requested.

```json
[{"requestId": 1, "method": "subscribe", "type": "orderbook", "symbols": ["btc_krw", "usdt_krw", "bat_krw", "comp_krw", "klay_krw"]}]
```

Acknowledgement.

```json
{"status":"success","requestId":1}
```

Snapshot.

```json
{"symbol":"btc_krw","timestamp":1790134242857,"type":"orderbook","snapshot":true,"data":{"timestamp":1790134242563,"asks":[{"price":"116506000","qty":"0.27522"},{"price":"116538000","qty":"0.00665633"},{"price":"116542000","qty":"0.03897506"}],"bids":[{"price":"116455000","qty":"0.00499"},{"price":"116453000","qty":"0.01919775"},{"price":"116451000","qty":"0.00059"}]}}
```

The next frame, a full top 30 with no `snapshot` key, in which one new ask level at 116,507,000 appeared.

```json
{"symbol":"btc_krw","timestamp":1790134243081,"type":"orderbook","data":{"timestamp":1790134243067,"asks":[{"price":"116506000","qty":"0.27522"},{"price":"116507000","qty":"0.0321"},{"price":"116538000","qty":"0.00665633"}],"bids":[{"price":"116455000","qty":"0.00499"},{"price":"116453000","qty":"0.01919775"},{"price":"116451000","qty":"0.00059"}]}}
```

A stopped pair.

```json
{"symbol":"klay_krw","timestamp":1790134242857,"type":"orderbook","snapshot":true,"data":{"timestamp":1789456789897,"asks":[],"bids":[]}}
```

A grouped book at `level` `100000`, whose quote amount is named `quoteVolume`.

```json
{"symbol":"eth_krw","timestamp":1790134329586,"type":"orderbook","snapshot":true,"data":{"timestamp":1790134328498,"asks":[{"price":"3800000","qty":"179.83267892","quoteVolume":"677361520.39233"},{"price":"3900000","qty":"33.36541913","quoteVolume":"128678722.40307"}],"bids":[{"price":"3700000","qty":"43.33530415","quoteVolume":"160935508.86839"},{"price":"3600000","qty":"17.76253887","quoteVolume":"64928877.53068"}]}}
```

Ticker snapshot.

```json
{"symbol":"btc_krw","timestamp":1790134313071,"type":"ticker","snapshot":true,"data":{"open":"115370000","high":"116765000","low":"114412000","close":"116463000","prevClose":"115304000","priceChange":"1159000","priceChangePercent":"1.01","volume":"39.25266763","quoteVolume":"4549864965.49708","bestAskPrice":"116477000","bestBidPrice":"116426000","lastTradedAt":1790134282264}}
```

Trade snapshot.

```json
{"symbol":"btc_krw","timestamp":1790134328085,"type":"trade","snapshot":true,"data":[{"timestamp":1790134317520,"price":"116439000","qty":"0.0067","isBuyerTaker":false,"tradeId":25441720}]}
```

Errors.

```json
{"status":"fail","code":"INVALID_SYMBOL","message":"The symbol does not exist (nope_krw)","requestId":2}
```

```json
{"status":"fail","code":"INVALID_REQUEST","message":"invalid_level","requestId":11}
```

```json
{"status":"fail","message":"invalid_format"}
```

The keepalive is a WebSocket protocol ping frame with the payload `ping`, not a JSON message, so there is no text frame to quote.

## 7. Private channels

Named for a future execution stage, from S1 and S2, not probed.
They use `wss://ws-api.digitalx.miraeasset.com/v2/private`, with the `X-KAPI-KEY` header and `timestamp` and `signature` in the query string, signed like REST.

- `myOrder` and `myTrade`, which need the `readOrders` permission.
- `myAsset`, which needs `readBalances`.
- Private messages use `channelType` instead of `type` as the top level field, S2.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
Digital X cannot join as a perpetual leg, since it has none.
The shape below is what a KRW spot feed would look like if a later design ever adds spot legs, and that design would also need a catalog without CCXT and a KRW quote outside the USD, USDC and USDT family of [`quoteFamily.ts`](../../../server/src/engine/cluster/quoteFamily.ts) lines 3 to 6.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://ws-api.digitalx.miraeasset.com/v2/public` | one product family |
| channel | `orderbook` with no `level` | 30 levels per side covers the engine's 20 of `DEPTH_LEVELS` at [`ClusterIndexBuilder.ts`](../../../server/src/engine/cluster/ClusterIndexBuilder.ts) line 17 |
| markets per connection | all launched pairs, 193 on 2026-09-23 | 193 ran on one socket at about 150 frames per second, and no cap is published |
| subscribe frame | `[{"method":"subscribe","type":"orderbook","symbols":["btc_krw", …]}]`, with a `requestId` so success is acknowledged | a failure is reported even without `requestId`, but a success is not |
| keepalive | none from the client | the server pings every 30 s, and `VenueFeed` counts a ping as traffic at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) lines 97 and 98 |
| `maxSilenceMs` | 90,000 | three missed server pings, and `tdrop_krw` sent nothing after its snapshot for 120 s, so the pings must count as traffic |
| routing | `type === 'orderbook'`, key `symbol` | control messages have `status` and no `type` |
| every frame | `resetBook` with the frame's levels, then `publish` | every frame is the whole top 30 |
| resync | none on data, and a reconnect is repaired by the snapshot sent on subscribe | there is no sequence to check |
| unknown or stopped pair | subscribe only `launched` pairs from `GET /v2/currencyPairs` | unknown symbols fail with `INVALID_SYMBOL`, and a stopped pair sends one empty snapshot |
| receive time | stamp on arrival, never from `timestamp` or `data.timestamp` | `data.timestamp` is the last book change and was 7.8 days old on a stopped pair |
| sizes | `Number(qty)`, base coins, contract size 1 | section 4 |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Digital X Open API LLM guide, `introduction.md` and `websocket_api.md` | https://docs.digitalx.miraeasset.com/llms/en/websocket_api.md | 2026-09-22 | Digital X | URLs, message forms, channel list, the dropped message warning, private channel permissions, sections 1 to 3 and 7 |
| S2 | Digital X Open API v2 reference, WebSocket sections "Open a Connection", "Send Requests", "Response Messages" | https://docs.digitalx.miraeasset.com/index_en.html | 2026-09-22 | Digital X | former host, square brackets, acknowledgement rule, control message forms, forced close of private sockets, `channelType`, sections 1, 3, 5 and 7 |
| S3 | Digital X Open API LLM guide, public channels | https://docs.digitalx.miraeasset.com/llms/en/websocket_api/public.md | 2026-09-22 | Digital X | `ticker`, `orderbook` and `trade` schemas, `level`, `amt`, `snapshot`, timestamps, sections 2 to 4 |
| P1 | `ws-probe.mjs book`, `errors`, `batch`, `silence` and `deflate`, first run at 03:20 to 03:24 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/digital-x/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6 |
| P2 | the same five modes, second run at 03:30 to 03:35 UTC, with ping times and trimmed captures | [`ws-probe.mjs`](../../../scripts/probes/venues/digital-x/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6, the ping interval, the frames of section 6 |
