# Indodax WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 Pacific time, 04:32 to 04:50 UTC on 2026-09-23, from the development host near Seattle, through a Surfshark WireGuard exit that Cloudflare places in Canada.

This profile covers the public market data WebSocket of Indodax (CCXT id `indodax`), a spot only venue, see [`fees.md`](./fees.md) section 3.
It follows template change 1 of [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md) and records the spot book channel.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/indodax/ws-probe.mjs), and the capture is quoted beside the documented value.
The server is Centrifugo, which names itself `"version":"2.8.7"` in the connect reply, so the frames follow the Centrifugo v2 JSON protocol.
CCXT 4.5.68 has no `pro/indodax.js`, so there is no CCXT Pro reference for this socket.

## 1. Endpoints

| use | documented URL | probed |
|---|---|---|
| market data, production | `wss://ws3.indodax.com/ws/`, S1 | open in 249 and 246 ms in the two book runs, `101` with `server: nginx/1.25.0` and `via: 1.1 google`, resolved to 34.107.188.9 |
| market data, demo | `wss://ws.demo-indodax.com/ws/`, S1 | not probed |
| URL in the docs' reconnect examples | `wss://indodax.com/ws/`, S1 section "Troubleshooting" | refused with HTTP 404 in both runs |
| private | `wss://pws.indodax.com/ws/?cf_ws_frame_ping_pong=true`, S2 | not probed |

One socket carries every pair.
IDR pairs and USDT pairs delivered on the same socket in every run, so there is no split by quote.
The market data host is not behind Cloudflare like the REST host: it resolves to a Google Cloud address and the upgrade reply names a Google front end.

## 2. Channel matrix for public market data

Counts are publications received in 45 s in run 1 at 04:32 UTC and run 2 at 04:41 UTC.

| channel | payload | probed |
|---|---|---|
| `market:order-book-<pair>` | the whole book, up to 50 levels a side, on every push | `usdtidr` 41 and 49, `btcidr` 82 and 48, `btcusdt` 17 and 15, `ethusdt` 10 and 15, `vcgusdt` 9 and 9, `xecusdt` 0 |
| `market:trade-activity-<pair>` | trades, `[pair, ts s, seq, side, price, quote volume, base volume]` | `btcidr` 22 and 5, `btcusdt` 0 and 0 |
| `chart:tick-<pair>` | ticks, `[ts s, seq, price, volume]` | `btcidr` 21 and 5, `btcusdt` 0 and 0 |
| `market:summary-24h` | one row per pair that changed, `[pair, ts s, last, low, high, price 24 h ago, quote volume, base volume]` | 80 and 75 |

The channel names and row layouts are from S1.
No best bid and ask channel, no incremental book channel, and no mark, index or funding channel exists, since the venue has no derivative.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one market data URL, S1 | IDR and USDT pairs share one socket, section 1 |
| subscribe frame shape | `{"method": 1, "params": {"channel": "market:order-book-btcidr"}, "id": 4}`, one channel per command, S1 | one command per frame, 150 frames in one burst, each answered. Two commands joined by a newline in one frame were both acknowledged |
| unknown symbol expectation | Not publicly specified | `market:order-book-nopeidr` and `market:nope-btcidr` are acknowledged as success with no `offset` and deliver nothing. An unknown namespace, `nope:foo`, answers error 102 `unknown channel` |
| chunk unit and budget | Not publicly specified | 128 channels per connection: the 129th to 150th subscribe answered error 106 `limit exceeded` in both runs |
| keepalive mechanism | client command `{"method": 7, "id": 3}` answered by `{"id": 3}`, S1 | the reply came in 188 ms in both runs. The server also sends a protocol ping every 25 s, and a socket that left it unanswered was closed with 1006 at 28.0 s |
| connection lifetime and maintenance notice | "WebSocket clients may get disconnected from the server due to internal rebalancing", and the close reason is JSON with a `reconnect` flag, S1 | no forced disconnect in 110 s. Every server close seen carried a JSON reason, such as `{"reason":"stale","reconnect":false}` |
| handshake and operation rate limits | Not publicly specified | 150 subscribe frames sent in one burst were all answered within 627 and 755 ms, and nothing was refused except by the channel cap |
| public market data authentication | a connect command with a static token printed in the docs, before anything else, S1 | required: a subscribe before the connect, a connect with no token, and non-JSON text each closed the socket with 3003 `bad request`, and a wrong token with 3002 `invalid token`. The token is the same for everyone, and its `exp` is 1946618415, 2031-09-08 |
| message parse and routing | `result.channel`, with the book at `result.data.data` and the offset at `result.data.offset`, S1 | as documented. Replies route by `id`. Every text frame of the book and error runs ended in a newline, 238 of 238 and 32 of 32 in run 2, and 231 and 216 frames in the two batch runs carried two or more messages separated by newlines |
| subscribe acknowledgement shape | `{"id": 2, "result": {"recoverable": true, "epoch": "1630401092", "offset": 814137}}`, S1 | as documented for a channel with history. A channel with no history, such as `market:order-book-xecusdt` or an unknown pair, answers with no `offset`. Errors are `{"id": 8, "error": {"code": 102, "message": "unknown channel"}}` |
| symbol identifier format | lower case pair id, `btcidr`, S1 | identical to CCXT `market.id` and to the `/api/pairs` `id` on all 484 pairs, and the channel suffix delivered for 123 of the 128 ids subscribed in each batch run. The book repeats it in `pair`. `market:order-book-BTCIDR` and `market:order-book-btc_idr` are acknowledged as other channels and stay silent |
| number representation | strings in the example, S1 | every price and volume on every book level was a string |
| timestamp representation | seconds in the trade, tick and summary rows, S1 | as documented. A book push carries no timestamp at all |
| size unit | `btc_volume` and `idr_volume` per level, S1 | `<base>_volume` in base coins and `<quote>_volume` in quote currency on every pair, and price times base volume equals the quote volume, section 4 |
| sequence semantics | a per channel `offset`, and a `recover` subscribe that replays from an offset, S1 | the offset rose by exactly 1 on every push of every channel in both runs, and the first push was the acknowledged offset plus 1 |
| idle repeat behaviour | Not publicly specified | whole books identical to the previous push are common: `btcidr` 41 of 81 and 22 of 47, `vcgusdt` 8 of 8 in both runs. `xecusdt` sent nothing in 45 s in the run 2 book run and in both batch runs |

## 4. The book channel in detail

`market:order-book-<pair>` is the only book channel, and every row below is about it.

### Snapshot on subscribe

There is no snapshot on subscribe.
The first push is simply the next publication, and it arrived this long after the acknowledgement:

| pair | run 1 | run 2 |
|---|---:|---:|
| `usdtidr` | 2,560 ms | 1,467 ms |
| `btcidr` | 980 ms | 356 ms |
| `btcusdt` | 3,117 ms | 2,009 ms |
| `ethusdt` | 3,033 ms | 1,901 ms |
| `vcgusdt` | 2,665 ms | 1,428 ms |
| `xecusdt` | not subscribed | none in 45 s |

Every push is a whole book, so the first push is a snapshot.
A book can still stay unknown for as long as nothing changes it, which on `xecusdt` was more than 45 s in the book run and in both batch runs.

Two ways fill the gap.
The channel history returns the last push on demand: subscribe to learn the `offset` and `epoch`, unsubscribe, and subscribe again with `"recover": true`, `"offset": <offset - 1>` and the same `epoch`.
In the `seed` mode this returned exactly one publication, the book at the acknowledged offset, for `vcgusdt`, `pundixusdt` and `btcusdt`, and one or two for `idxusdt`, and its best bid and ask equalled the REST depth read next on all four pairs in both runs.
On `xecusdt` the acknowledgement had no offset, and the recovery returned `"recovered": true` with no publication.
The other way is the REST depth call, which serves 150 levels a side, see [`rest.md`](./rest.md) section 5.

### Delta semantics

There are no deltas.
Each push replaces the whole book with up to 50 bids and 50 asks, each level an object `{"price", "<base>_volume", "<quote>_volume"}` with string values.
A size of zero never appears, since a level that leaves is simply absent from the next push.
The key order inside a level object changes from push to push, so a parser reads the keys by name.

### Sequence and gap rule

```text
first push after the ack      offset = ack offset + 1
next push                     offset = last + 1, replace the book
offset > last + 1             pushes were lost, and the new push is still a whole book
```

The rule held on every push of every channel in both book runs and in the recovery test, with 0 gaps.
Because every push is a whole book, a gap loses no state once the next push arrives.
Centrifugo can also replay the missed publications with `recover`: after 6 s unsubscribed from `market:order-book-usdtidr`, a recover subscribe returned 13 and 7 publications, offsets contiguous from the last one seen, with `"recovered": true`.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| socket push | best first, descending, on 159 of 159 pushes in run 1 and 136 of 136 in run 2 | best first, ascending, on the same pushes |
| REST `/api/depth` | descending on 3 of 3 pairs in both runs | ascending |

### Level window

The socket holds 50 levels a side on every busy pair, and fewer when the book is thinner: `vcgusdt` held 12 bids and 50 asks.
REST `/api/depth` serves 150 a side on the same pairs.
On `btcusdt` the top 20 socket levels equalled the top 20 REST levels in price and in size on both sides in both runs, read 1,791 and 3,018 ms after the last push.
The engine holds 20 levels a side by default, `DEPTH_LEVELS` at [`ClusterIndexBuilder.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/engine/cluster/ClusterIndexBuilder.ts) line 17, so 50 is enough.

### Size unit against CCXT `contractSize`

| pair | price | base volume | quote volume | price times base |
|---|---|---|---|---|
| `btcidr` | `"1549999000"` | `"1.00400780"` BTC | `"1556211086"` IDR | 1,556,211,085.99 |
| `btcusdt` | `"86850.000011"` | `"0.28233891"` BTC | `"24521.13433661"` USDT | 24,521.13 |
| `vcgusdt` | `"0.004433"` | `"7850.75186100"` VCG | `"34.80238300"` USDT | 34.80 |

The size is base coins, read from the field named `<base>_volume`, where the base is the pair id without its quote suffix.
CCXT reports `contractSize` undefined on these spot markets, which the connector turns into 1, at [`connector.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/ccxt/connector.ts) lines 188 to 194, and 1 is right for base coins.

### One-sided and empty books

`vcgusdt` was the thinnest book seen, 12 bids and 50 asks, with the best ask 78 % above the best bid.
No empty side was seen, so what a push carries for a side with no orders is Not verified.

### Idle repeats

A push identical to the previous one is common and carries a new offset.
`vcgusdt` pushed every 4,884 to 5,108 ms in both runs, and every push repeated the previous book.
`xecusdt` pushed nothing, and its channel had no history offset at all.
So the roughly 5 s repeat is not a server heartbeat, and a quiet book can be silent indefinitely.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `market:order-book-nopeidr` | `{"result":{"recoverable":true,"epoch":"1790138009"}}`, no offset | nothing |
| `market:order-book-BTCIDR` | success, epoch `"1670909690"`, no offset | nothing |
| `market:order-book-btc_idr` | success, epoch `"1662972066"`, no offset | nothing |
| `market:nope-btcidr` | success, no offset | nothing |
| `nope:foo` | `{"error":{"code":102,"message":"unknown channel"}}` | the socket stays open |
| `market:order-book-btcidr` twice | the second answers `{"error":{"code":105,"message":"already subscribed"}}` | the first keeps delivering |
| the 129th channel on one socket | `{"error":{"code":106,"message":"limit exceeded"}}` | the first 128 keep delivering |
| text that is not JSON | close 3003 `{"reason":"bad request","reconnect":false}` 201 and 204 ms later | the socket is gone |

The 19 IDR pairs with `is_maintenance` 1 were not subscribed.
An acknowledgement without an `offset` cannot tell an unknown pair from a listed pair whose channel has never published, since `xecusdt` answered the same way.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | client `{"method": 7, "id": N}`, answered `{"id": N}`, S1 | 188 ms round trip in both runs. The server sent a protocol ping at 25.2, 50.2, 75.2 and 100.2 s on every connected socket |
| silence the server tolerates | Not publicly specified | a socket that sends nothing was closed at 25.26 s with 3007 `{"reason":"stale","reconnect":false}` in both runs. After the connect command, a socket that only answers protocol pings stayed open the full 110 s with no application traffic. A socket that left the protocol ping unanswered was closed with 1006 at 28.0 s |
| forced disconnect | "internal rebalancing", S1 | none in 110 s |
| maintenance notice | none documented beyond the close reason's `reconnect` flag | not observed |
| compression | Not publicly specified | a client that offered permessage-deflate got no `sec-websocket-extensions` header back in both runs, so the server does not negotiate it. Frames are text JSON |
| handshake | | 246 and 249 ms to open from this host |
| subscription limits | Not publicly specified | 128 channels per connection, error 106 beyond it |
| throughput | | 128 order book channels, the 12 USDT pairs and the busiest IDR pairs: 4,178 and 3,702 pushes in 45 s, a median of 76 and 65 a second and a peak of 170 and 162, 647 and 573 KB a second, 6,967 and 6,959 bytes a push, 45 and 53 µs of `JSON.parse` a frame. 123 of the 128 channels delivered, and `xecusdt` was among the 5 silent ones |

A client built on `ws` answers protocol pings by default, which is what kept the connected sockets alive.
The engine's silence watch counts only messages, at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 205, so protocol pings do not reset it and the method 7 reply has to.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Book arrays are cut to two levels a side.

Connect, sent first, with the token from S1.

```json
{"params": {"token": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJleHAiOjE5NDY2MTg0MTV9.UR1lBM6Eqh0yWz-PVirw1uPCxe60FdchR8eNVdsskeo"}, "id": 1}
```

```json
{"id":1,"result":{"client":"2622fcd6-43f3-4381-817c-fb8081e2be08","version":"2.8.7","expires":true,"ttl":156479899}}
```

Subscribe and acknowledgement.

```json
{"method": 1, "params": {"channel": "market:order-book-btcusdt"}, "id": 4}
```

```json
{"id":4,"result":{"recoverable":true,"epoch":"1653886930","offset":60536841}}
```

A book push.

```json
{"result":{"channel":"market:order-book-btcidr","data":{"data":{"pair":"btcidr","ask":[{"price":"1550000000","btc_volume":"0.87192550","idr_volume":"1351484525"},{"price":"1550001000","btc_volume":"0.00216454","idr_volume":"3355039"}],"bid":[{"price":"1549999000","btc_volume":"1.08567915","idr_volume":"1682801597"},{"price":"1549998000","btc_volume":"0.06440003","idr_volume":"99819918"}]},"offset":70136038}}}
```

The last book from the channel history, answered to `{"method": 1, "params": {"channel": "market:order-book-btcusdt", "recover": true, "offset": 60536988, "epoch": "1653886930"}, "id": 20}`.

```json
{"id":20,"result":{"recoverable":true,"epoch":"1653886930","publications":[{"data":{"pair":"btcusdt","ask":[{"price":"86930.688837","btc_volume":"0.19694800","usdt_volume":"17120.82530507"},{"btc_volume":"0.00000400","usdt_volume":"0.34772276","price":"86930.688841"}],"bid":[{"price":"86900.000002","btc_volume":"0.32560000","usdt_volume":"28294.64000065"},{"btc_volume":"0.27224763","usdt_volume":"23658.31904727","price":"86900.000001"}]},"offset":60536989}],"recovered":true,"offset":60536989}}
```

Keepalive.

```json
{"method": 7, "id": 13}
```

```json
{"id":13}
```

Other channels.

```json
{"result":{"channel":"market:trade-activity-btcidr","data":{"data":[["btcidr",1790138528,44768500,"buy",1550000000,"149373.00000000","0.00009637"]],"offset":14413172}}}
```

```json
{"result":{"channel":"chart:tick-btcidr","data":{"data":[[1790138528,44768500,1550000000,"0.00009637"]],"offset":14792811}}}
```

```json
{"result":{"channel":"market:summary-24h","data":{"data":[["chzidr",1790138515,306,274,309,282,"49078650","170924.74857770"]],"offset":145381836}}}
```

Errors, and the close reasons, which arrive in the close frame rather than as messages.

```json
{"id":8,"error":{"code":102,"message":"unknown channel"}}
```

```json
{"id":11,"error":{"code":105,"message":"already subscribed"}}
```

```json
{"reason":"bad request","reconnect":false}
```

```json
{"reason":"invalid token","reconnect":false}
```

```json
{"reason":"stale","reconnect":false}
```

## 7. Private channels

Named for a future execution stage, from S2, not probed.

- A private token and channel come from `POST https://indodax.com/api/private_ws/v1/generate_token`, signed with a Trade API key.
- The socket is `wss://pws.indodax.com/ws/?cf_ws_frame_ping_pong=true`, and it subscribes with `{"subscribe":{"channel":"pws:#<hash>"},"id":2}`, a newer Centrifugo frame shape than the market data socket uses.
- The one documented private event is an order update with fill information.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
The engine takes perpetuals only today, so this applies only if a spot leg on the USDT pairs is ever modelled.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://ws3.indodax.com/ws/`, for every pair | one socket carries IDR and USDT pairs |
| connect | `{"params": {"token": <static token>}, "id": 1}` as the first frame | anything else first closes the socket with 3003 |
| channel | `market:order-book-<rawMarketId>` | the channel suffix is CCXT's `market.id` |
| markets per connection | 100 | the cap is 128 channels, error 106 beyond it |
| subscribe frames | one command per market, which may be newline joined into one frame | both forms were acknowledged |
| seed | after each acknowledgement with an `offset`, unsubscribe and resubscribe with `recover` from `offset - 1`, or read REST `/api/depth/<id>` | no snapshot on subscribe, and a quiet book can stay silent past 45 s |
| keepalive | `{"method": 7, "id": N}` every 15 s, and leave `ws` answering protocol pings | the server closes a socket that ignores its pings, and the method 7 reply is the message the silence watch sees |
| `maxSilenceMs` | 45,000 | three missed method 7 replies |
| routing | split each frame on `\n`, parse each non-empty line, and route on `result.channel` | frames can carry several messages |
| book | every push: `resetBook` with all levels, then `publish` | each push is a whole book |
| gap | `offset !== last + 1`: log it and apply the push anyway | a whole book push loses no state, so a resync buys nothing |
| unserved stream | log an acknowledgement without an `offset`, and a stream with no push 10 s after its seed | unknown pairs and never published pairs look the same |
| receive time | stamp on arrival | a push carries no timestamp |
| sizes | `Number()` of `<base>_volume` | base coins, `contractSize` 1 |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Indodax official API docs, Market Data WebSocket | https://github.com/btcid/indodax-official-api-docs/blob/master/Marketdata-websocket.md | 2026-09-22, repo last changed 2026-09-10 | Indodax | URLs, static token, connect, ping, subscribe, unsubscribe, recover, channel layouts, reconnect advice |
| S2 | Indodax official API docs, Private WebSocket | https://github.com/btcid/indodax-official-api-docs/blob/master/Private-websocket.md | 2026-09-22 | Indodax | private URL, token call, private subscribe frame, section 7 |
| S3 | CCXT 4.5.68 | `server/node_modules/ccxt/js/src/indodax.js`, and no `pro/indodax.js` | 2026-09-22 | CCXT | no CCXT Pro class |
| P1 | `ws-probe.mjs book`, `errors`, `batch`, `silence` and `deflate`, run 1 at 04:32 to 04:39 UTC 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/indodax/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 6 |
| P2 | `ws-probe.mjs book`, `seed`, `errors`, `deflate`, `batch` and `silence`, run 2 at 04:41 to 04:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/indodax/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | the second readings, the unanswered ping socket |
| P3 | `ws-probe.mjs seed` rerun at 04:49 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/indodax/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | the history seed and the trimmed frames of section 6 |
