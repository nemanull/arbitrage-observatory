# UZX WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time (2026-09-23 06:44 to 07:01 UTC over two passes), from the development host near Seattle, through its Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public market WebSocket of UZX, which has no CCXT id, for its USDT-M (`SWAP`) and coin-M (`BASE`) perpetuals, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/uzx/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Every socket opened from the Canadian VPN exit, and none was refused apart from the bare host URL, which answers HTTP 404.

## 1. Endpoints

| URL | named by | probed |
|---|---|---|
| `wss://stream.uzx.com/notification/ws` | every code example in S1 | HTTP 101 through Cloudflare SEA or YVR, open in 117 to 158 ms over all runs, serves both perpetual families |
| `wss://api.uzx.com/notification/ws` | the web client, S4 | HTTP 101 in 158 and 127 ms, `ETHUSDT` delivered 39 and 35 frames in 5 s |
| `wss://stream.uzx.com` | the overview section of S1, for public and private channels alike | HTTP 404 in 111 and 128 ms |
| `wss://stream.uzx.com/notification/pri/ws` and `wss://stream.uzx.com/pri/notification/ws` | the private channel section of S1, which spells it both ways | not probed, private |

One socket carries every public channel of both families and of spot.
`BTCUSD` (coin-M) and six USDT-M contracts delivered side by side on one socket, P1.
`stream.uzx.com` resolves to the same two Cloudflare addresses as the REST hosts, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

The `type` values are from S1 "Channel Names", and every frame sets `biz` to `market`.

| `type` | extra params | what it pushes | probed on 2026-09-23 |
|---|---|---|---|
| `swap.orderbook` | `symbol`, `interval` `"0"` to `"3"` | the whole book, every push | recommended with `interval` `"0"`, section 4 |
| `swap.orderbook` with `interval` `"1"` | | the whole book in price buckets of 10 ticks | 310 to 412 bid levels on `BTCUSDT`, same cadence as `"0"` |
| `swap.percent10` | `symbol` | 500 bids and 500 asks on a fixed price grid, most of them size `"0"` | one frame every 1,000 ms, 49,872 and 49,508 zero sizes over 60 frames, so about 830 of 1,000 grid points empty |
| `swap.ticker` | `symbol` | best bid and ask with sizes, last price, 24 h stats | 180 frames in 60 s, median gap 499 ms, 80 of 180 carried the same `seq_id` as the previous frame |
| `swap.overview` | none | every live perpetual's ticker row with `index`, `tag` (mark), `funding_rate`, `funding_next_time`, `pre_funding_rate` | one frame every 1,000 ms, 66 rows, about 31.7 KB |
| `swap.fills`, `swap.candles`, `swap.index` (index candles), `swap.tag` (mark candles) | | | not probed |

`swap.overview` is the socket twin of the REST bulk ticker, with the same row fields, see [`rest.md`](./rest.md) section 3.
No channel carries a funding interval.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one public URL, S1 | one URL for both perpetual families, section 1 |
| subscribe frame shape | `{"event":"sub","params":{"biz":"market","type":"swap.orderbook","symbol":"BTCUSDT","interval":"0"},"zip":false}`, one symbol per frame, S1 | as documented. `ADAUSDT,DOGEUSDT` in one `symbol` is refused with `status` `error`. `biz` `swap` is accepted like `market` |
| unknown symbol expectation | the WebSocket error code table in S1 is empty | `{"id":"","event":"subscribe","topic":"swap.NOPEUSDT.depth.step0","status":"error"}`, with no code and no message. A delisted contract, `LISTAUSDT`, is acknowledged `ok` and never delivers |
| chunk unit and budget | "Connection Limit: 1 time/second" and "Subscription Limit: 240 times/hour", S1 | 60 subscribe frames in one burst on one socket, 60 acks, 60 streams delivering, twice. The hourly budget was never reached, so its penalty is Not verified |
| keepalive mechanism | the server sends `{"ping": 1751273700330}` every 5 s, the client answers `{"pong": 1751273700330}` within 5 s, and four unanswered pings end the connection, S1 | pings every 4,984 to 5,017 ms. A socket that never answered closed at 20,000 and 20,001 ms with code 1006 in two runs. No protocol level ping frame arrived |
| connection lifetime and maintenance notice | none documented | no forced close in 104 s. Every new socket first receives `{"pong":"<ms>"}` and a `change.swap.config` notice, section 6 |
| handshake and operation rate limits | 1 connection per second, 240 subscriptions per hour, S1 | opens took 117 to 158 ms and were spaced 1.2 s apart. No refusal |
| public market data authentication | none | none |
| message parse and routing | FEED frames carry `type` `swap.BTCUSDT.orderBook` and `product_name` | book frames have no `event` key, so a book is any frame with `bids` and `asks`, routed on `product_name`. Acks carry `event`, pings carry `ping` |
| subscribe acknowledgement shape | `{"id": "", "event": "subscribe", "topic": "swap.BTCUSDT.depth.step0", "status": "ok"}`, S1 | as documented. Unsubscribe answers `"event":"unsubbed"`. Acks came 37 to 59 ms after the frame was sent |
| symbol identifier format | `BTCUSDT` | identical to `product_name` in `/v2/products` and to `symbol` in the bulk ticker, on all 60 USDT-M contracts |
| number representation | the FEED example shows JSON numbers, `[19631.36, 0.2041]`, S1 | every price and size is a string, `["86503.7","2777"]`, on every stream |
| timestamp representation | `ts` in ms | `ts` integer ms, 21 to 26 ms old on arrival at the median, and the server clock was within 6 ms of this host, see [`rest.md`](./rest.md) section 7 |
| size unit | "best ask volume", with a fractional example | integer contract counts, one contract being `swap_value` coins, section 4 |
| sequence semantics | none documented | every frame is a whole book, so no gap rule is needed. `seqId` never decreased on any stream, section 4 |
| idle repeat behaviour | not documented | a quiet book is re-sent unchanged: `XAUUSDT` sent 102 and 108 identical frames of 195 and 177 in 60 s |

## 4. The book channel in detail

`swap.orderbook` with `interval` `"0"` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe, and on every push

There are no deltas.
Every frame is the whole book for the contract, and the first frame arrived 50 to 393 ms after the subscribe was sent, P1.

| contract, pass 1 and pass 2 | frames in 60 s | median gap | max gap | bid levels, min to max | ask levels | bytes per frame |
|---|---|---|---|---|---|---|
| `BTCUSDT` | 565, 512 | 100, 101 ms | 248, 626 ms | 347 to 500, 355 to 500 | 355 to 483, 372 to 483 | 14,823, 15,317 |
| `ETHUSDT` | 489, 405 | 102, 104 ms | 367, 739 ms | 500 | 500 | 18,733, 18,714 |
| `1000SATSUSDT` | 483, 465 | 100, 101 ms | 305, 414 ms | 83 to 88, 78 to 83 | 68 to 78, 72 to 77 | 4,392, 4,349 |
| `BTCUSD` (coin-M) | 397, 421 | 103, 103 ms | 436, 755 ms | 275 to 390, 279 to 392 | 299 to 387, 290 to 413 | 11,721, 11,933 |
| `UZXUSDT` | 309, 310 | 102, 102 ms | 421, 761 ms | 13 to 24, 11 to 25 | 12 to 26, 10 to 25 | 894, 911 |
| `ACEUSDT` | 278, 340 | 199, 102 ms | 471, 730 ms | 81 to 85, 79 to 86 | 55 to 59, 52 to 58 | 2,995, 2,977 |
| `XAUUSDT` | 195, 177 | 304, 398 ms | 479, 918 ms | 16 to 39, 18 to 32 | 16 to 40, 24 to 38 | 1,161, 1,167 |

A feed replaces the book on every frame.
The engine's `resetBook` does exactly that, so no sequence rule and no REST seed are needed.

### Frame header fields

Each frame carries `seqId`, `id`, `ts`, `version`, `type`, `product_name` and `interval` beside `bids` and `asks`, none of them documented.

| field | behaviour on the wire |
|---|---|
| `seqId` | per contract, never decreased on any of the 9 book streams in either pass. It repeated only on a frame identical to the previous one: 85 of 85 repeats on `XAUUSDT`, 50 of 50 on `UZXUSDT` in pass 2 |
| `id` and `version` | always equal to each other. They are shared across contracts: the first frames of six different contracts in pass 1 all carried `id` 5967152911. On `BTCUSDT` `id` stayed the same on 364 of 564 and 311 of 511 consecutive frames while the book changed on every one, so it is not a book version |
| `ts` | ms, 21 to 26 ms before arrival at the median, 562 ms at worst |

A feed can skip a frame whose `seqId` equals the last applied one, since that frame repeats the book.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

Bids are strictly descending and asks strictly ascending on every frame of every stream, 0 unsorted frames in both passes, and 0 frames had the best bid at or above the best ask.
The REST book has the same order, see [`rest.md`](./rest.md) section 5.

### Level window

The server caps a side at 500 levels.
`ETHUSDT` held exactly 500 per side on every frame, and `BTCUSDT` reached 500 bids.
The deepest `BTCUSDT` levels were near 68,300 and 104,600 against a price near 86,500, so the window is about 20 % either side of the touch on the busiest book.
A frame therefore carries 25 times the 20 levels the engine keeps.

### Size unit against `swap_value`

Sizes are strings, every size in the last `BTCUSDT` frame of each pass was an integer, and so was every size in the REST books of five contracts, P1 and [`rest.md`](./rest.md) section 5.
Orders are placed in whole contracts, S1 `number` "Contract quantity".

| contract | `swap_value` | size at the touch | as coins | notional |
|---|---:|---|---|---|
| `BTCUSDT` | 0.001 BTC | `"2777"` | 2.777 BTC | about 240,000 USDT |
| `ETHUSDT` | 0.001 ETH | `"11873"` in the REST book | 11.873 ETH | about 32,700 USDT |
| `XAUUSDT` | 0.001 XAU | `"2537"` | 2.537 oz | about 11,000 USDT |
| `1000SATSUSDT` | 1 | `"3290423861"` | 3.29 billion 1000SATS | about 41,900 USDT |

Read as coins, the `BTCUSDT` touch would be 2,777 BTC, about 240 million USDT at one price level, which no book of this size carries.
So the unit is contracts, and the engine's `sizeMul` from `contractSize` equal to `swap_value` converts them.
This is an inference from magnitudes and the order unit, not a documented statement.
The ticker's `vol` is in coins, see [`rest.md`](./rest.md) section 2.

### Against the REST book

At 30 s into each pass, the REST book for `BTCUSDT` carried the same `seqId` and `id` as one socket frame, and that frame was identical level for level: 465 and 463 levels in pass 1, 450 and 423 in pass 2, P1.
So the socket and the REST book are the same publication.

### One-sided and empty books

No one-sided or empty book was seen.
`XAUUSDT` held the fewest levels, 16 per side.
What a side with no orders looks like is Not verified.

### Idle repeats

A quiet book is re-sent on a timer of roughly 100, 200 or 400 ms.
Identical frames were 102 and 108 of `XAUUSDT`'s, 62 and 58 of `UZXUSDT`'s, 25 and 6 of `ACEUSDT`'s, and 0 to 2 on the busy books.
So a stream is never silent for long: the longest gap on any book stream was 918 ms.

### Unknown, closed and wrong-level symbols

| request | reply | then |
|---|---|---|
| `symbol` `NOPEUSDT` | `"status":"error"` | nothing |
| `symbol` `BTC-USDT` (spot style) | `"status":"error"` | nothing |
| `symbol` `ADAUSDT,DOGEUSDT` | `"status":"error"` | nothing |
| `type` `swap.nope` | `{"id":"","event":"subscribe","topic":"","status":"error"}` | nothing |
| no `interval` | `"topic":"swap.ETHUSDT.depth.step","status":"error"` | nothing |
| `interval` `"4"` | `"topic":"swap.SOLUSDT.depth.step4","status":"error"` | nothing |
| `symbol` `LISTAUSDT` (delisted, still in the bulk ticker) | `"status":"ok"` | nothing |
| `BTCUSDT` twice | `"status":"ok"` both times | one stream, not two |
| `unsub` of `BTCUSDT` | `"event":"unsubbed","status":"ok"` | 0 frames in the next 12 s |
| the text `hello` | no reply | the socket stays open |

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server `{"ping": <ms>}` every 5 s, client `{"pong": <same>}` within 5 s, S1 | as documented, the pong echoes the number |
| silence the server tolerates | "If no subscription is made within 30 seconds after a successful connection, or if the server does not push data to the user within 30 seconds after subscription, the system will automatically disconnect the connection.", S1 | not reproduced. A socket with no subscription that answered pings stayed open 103.7 s, and one whose only subscription was refused stayed open 101.3 s, in both passes. Only unanswered pings closed a socket: at 20.0 s, code 1006, no close frame |
| forced disconnect | "If a network issue occurs, the system will automatically disconnect the connection.", S1 | none in 104 s |
| maintenance notice | none documented | none seen. `change.swap.config` names a contract, by its name one whose configuration changed, and every new socket received the same `ICPUSDT` notice stamped 2026-09-23 06:31:25 UTC |
| compression | `"zip"`, "Whether to enable gzip", S1 | `zip: true` sends binary frames that start with `28b52ffd`, the Zstandard magic number, and do not gunzip. The ack was 91 bytes on the wire for 78 decoded. The flag is per socket, not per subscription: after one `zip: true` subscribe, `BTCUSDT` and `XRPUSDT` also turned binary until the next `zip: false` subscribe 3 s later. Pings stay text. Permessage-deflate was offered twice and never negotiated |
| handshake | | 117 to 158 ms to open |
| subscription limits | 240 per hour, 1 connection per second | 60 on one socket, all served |
| throughput | | all 60 USDT-M contracts on one socket: 414 and 416 frames per second at the median, peak 478 and 468, 1,935 KB per second, 4,783 and 4,740 bytes per frame, `JSON.parse` 142 and 170 µs per frame at the median and 335 and 390 µs at p90 |

At 416 frames per second and 170 µs each, parsing alone takes about 70 ms of every second on this laptop, before `resetBook` walks up to 1,000 levels per frame.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Book arrays keep their first three levels.

Sent on open, before any subscription.

```json
{"pong":"1790145873318"}
```

```json
{"data":null,"id":"change","interval":"","status":"ok","symbol":"ICPUSDT","ts":1790145085846,"type":"change.swap.config"}
```

Subscribe and acknowledgement.

```json
{"event":"sub","params":{"biz":"market","type":"swap.orderbook","symbol":"BTCUSDT","interval":"0"},"zip":false}
```

```json
{"id":"","event":"subscribe","topic":"swap.BTCUSDT.depth.step0","status":"ok"}
```

A book frame, first three levels per side kept, 25 bids and 28 asks in full.

```json
{"seqId":121317722,"id":5967152911,"bids":[["4337.51","2537"],["4337.49","620"],["4337.48","1528"]],"asks":[["4337.59","6728"],["4337.6","1721"],["4337.61","1698"]],"ts":1790145873556,"version":5967152911,"type":"swap.XAUUSDT.orderBook","product_name":"XAUUSDT","interval":"0"}
```

Keepalive, the server's ping and the client's answer.

```json
{"ping":1790145878309}
```

```json
{"pong":1790145878309}
```

Errors and unsubscribe.

```json
{"id":"","event":"subscribe","topic":"swap.NOPEUSDT.depth.step0","status":"error"}
```

```json
{"id":"","event":"subscribe","topic":"","status":"error"}
```

```json
{"id":"","event":"unsubbed","topic":"swap.BTCUSDT.depth.step0","status":"ok"}
```

Ticker, with `change_percent` cut.

```json
{"type":"swap.BTCUSDT.ticker","product_name":"BTCUSDT","interval":"","data":{"id":1790146560,"seq_id":2042176874,"open":"85348","close":"86428.4","high":"87245.1","low":"85142.5","vol":"30552.484","turn_over":"2634253348.7024","ask_price":"86428.5","ask_vol":"1290","bid_price":"86428.2","bid_vol":"1634","change":"1080.4"},"id":1790146560,"seqId":2042176874}
```

Overview, the first of its 66 rows kept.

```json
{"type":"swap.overview","code":200,"ts":1790146666774,"msg":"success","data":[{"market":{"open":"1.5209","close":"1.6261","low":"1.5102","high":"1.6573","turn_over":"253889837.10977","count":0,"vol":"161374736.1","change":"0.1052","change_percent":"0.0691695706489578539022946939312249326"},"index":{"open":"1.5723","close":"1.627","low":"1.5696","high":"1.657"},"tag":{"open":"1.572","close":"1.6262","low":"1.5692","high":"1.6568"},"funding_rate":"0.0001","funding_next_time":1790150400,"pre_funding_rate":"0.0001","symbol":"XRPUSDT","risk_fund":"0"}]}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.

- Login: `{"event":"login", ...}` with `"type":"api"`, signed like the REST calls with an API key, secret and passphrase.
- Channels: `order.spot`, `algo.spot`, `order.swap` and `margin.ration` (the swap maintenance margin ratio).
- URLs: S1 writes both `wss://stream.uzx.com/notification/pri/ws` and `wss://stream.uzx.com/pri/notification/ws`, and the web client uses `wss://api.uzx.com/notification/pri/ws`, S4.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://stream.uzx.com/notification/ws`, for the 60 USDT-M contracts | the coin-M rows are ranked out by the quote family, see [`rest.md`](./rest.md) section 2 |
| channel | `swap.orderbook` with `interval` `"0"` | the only exact book, since steps 1 to 3 aggregate and `swap.percent10` is a 1 s grid |
| markets per connection | 60, all on one socket | 60 ran with every stream served at 416 frames per second, and each reconnect costs subscriptions from the hourly budget |
| subscribe frames | one frame per contract, all sent at once, `zip` false | one symbol per frame is the only accepted form, and 60 in a burst were all acknowledged |
| subscription budget | back off at least 15 minutes after the fourth full resubscribe in an hour | 240 per hour is documented and 60 per reconnect allows four, and the penalty for exceeding it is Not verified |
| keepalive | answer each `{"ping": n}` with `{"pong": n}` in `handleMessage`, and no client timer in `startKeepalive` | the server drives the ping, and four missed pongs close the socket at 20 s |
| `maxSilenceMs` | 10,000 | pings arrive every 5 s and every book stream pushed at least once per 918 ms |
| routing | `product_name` is the `rawMarketId` | identical to the catalog id |
| book | on every frame, `resetBook` with the first `depthLevels` entries of `bids` and `asks`, which also publishes | every frame is the whole sorted book, up to 500 levels a side, and no delta ever needs a level below the kept ones |
| repeats | skip a frame whose `seqId` equals the last applied `seqId` of that contract | a repeated `seqId` always carried an identical book |
| resync | not needed for gaps. Log and drop a frame whose `seqId` is lower than the last applied one | never observed, and the next frame replaces the book anyway |
| unserved stream | log an ack with `status` `error`, and log a stream with no frame 10 s after an `ok` ack | unknown symbols are refused, and delisted ones are acknowledged and stay silent |
| sizes | `Number()` of the integer string, times `contractSize` from `swap_value` | contracts on the wire |
| receive time | stamp on arrival, never from `ts` | the engine's rule, and `ts` was up to 562 ms old |
| compression | keep `perMessageDeflate: false` and `zip: false` | zip is Zstandard and applies to the whole socket |
| `change.swap.config` | log it and ignore it | its meaning is Not publicly specified |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | UZX API documentation, English, `last-modified` 2026-06-15, sections "WebSocket API", "Swap Public Subscription", "Private Subscriptions" | https://www.uzx.com/v2/api/docs/en/index.html | 2026-09-23 | UZX, global | URLs, frames, limits, keepalive, zip, channel names, sections 1 to 7 |
| S4 | UZX web client bundle | https://www.uzx.com/assets/js/index-Fr-xn0lT.js | 2026-09-23 | UZX, global | the web client's socket URLs, sections 1 and 7 |
| P1 | `ws-probe.mjs book`, pass 1 at 06:44 UTC and pass 2 at 06:56 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/uzx/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 2 to 4 and 6 |
| P2 | `ws-probe.mjs errors`, at 06:45, 06:47 and 06:57 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/uzx/ws-probe.mjs) | 2026-09-23 | this host | error replies, zip, overview, unsubscribe, sections 2 to 6 |
| P3 | `ws-probe.mjs batch`, at 06:48 and 06:58 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/uzx/ws-probe.mjs) | 2026-09-23 | this host | 60 contracts on one socket, section 5 |
| P4 | `ws-probe.mjs silence`, at 06:49 and 06:59 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/uzx/ws-probe.mjs) | 2026-09-23 | this host | keepalive and silence, sections 3 and 5 |
| P5 | `ws-probe.mjs deflate`, at 06:50 and 07:00 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/uzx/ws-probe.mjs) | 2026-09-23 | this host | deflate, alternate URLs, sections 1 and 5 |
