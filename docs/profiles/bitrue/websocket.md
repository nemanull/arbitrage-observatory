# Bitrue WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-23 03:18 to 03:52 UTC, which is the evening of 2026-09-22 on the development host near Seattle.

This profile covers the public futures market WebSocket of Bitrue (CCXT id `bitrue`) for every perpetual family, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bitrue/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
The headline is section 4, "Book delay": the documented book socket delivered BTC books about 7 s after the REST book showed them, in every probe run.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M, USDC-M and COIN-M perpetuals | `wss://fmarket-ws.bitrue.com/kline-api/ws`, S1. CCXT Pro calls it `futurePublic` at `server/node_modules/ccxt/js/src/pro/bitrue.js` line 31 | open in 656 to 984 ms over the 15 sockets whose open was timed, `e_btcusdt`, `e_btcusdc` and the COIN-M `e_btcusd` all delivered on one socket |
| the same, as the futures web page uses it | `wss://futuresws.bitrue.com/kline-api/ws`, the `wsUrl` of the web contract list and the web bundle | open in 883 and 928 ms, same protocol, books about 12 s late, section 4 |
| spot | `wss://ws.bitrue.com/market/ws`, CCXT Pro line 30 | not probed |

One socket carries every perpetual family, because the stream name spells the base and the quote.
`fmarket-ws.bitrue.com` is a CNAME of `futures-ws-alb-601002812.ap-southeast-1.elb.amazonaws.com`, an AWS load balancer in Singapore, and `futuresws.bitrue.com` of `finance-futures-ngx-alb-out-1821070362.ap-southeast-1.elb.amazonaws.com`, see [`rest.md`](./rest.md) section 1.
Neither host refused this host.

## 2. Channel matrix for public market data

| channel | payload | depth and speed | probed on 2026-09-23 |
|---|---|---|---|
| `market_<id>_depth_step0` | `{"event":"sub","params":{"channel":"market_e_btcusdt_depth_step0","cb_id":"e_btcusdt"}}` | "Up to 30 data entries for bid and ask orders", no speed stated, S1 | a full 30 by 30 book in every frame, 1.78 to 2.23 frames per second on BTC, ETH and BTC-USDC, 0.15 to 0.2 on LSK |
| `market_<id>_depth_step1` | same | not documented, a price aggregation | 30 levels rounded to whole dollars on `e_btcusdt`, 123 to 131 frames in 60 s |
| `market_<id>_depth_step9` | same | not documented | one frame with empty `asks` and `buys` and `ts` 0, then nothing |
| `market_<id>_trade_ticker` | same | on trade, S1 | 45 to 51 frames in 60 s on BTC, each trade about 7 s old on arrival, section 4 |
| `market_<id>_ticker` | same | 24 h statistics, S1 | 44 to 51 frames in 60 s on BTC, fields `amount`, `close`, `high`, `low`, `open`, `rose`, `vol` only |
| `market_<id>_kline_<interval>` | same | S1 | not probed |
| `review`, by `{"event":"req","params":{"channel":"review"}}` | request, not subscription | what the web page sends | one frame of 115,188 and 115,253 bytes in two runs, with 792 rows of 24 h statistics keyed by stream id, and no mark, index or funding |

The channel names, payloads and fields are from S1.
No mark, index or funding channel exists, and the ticker and the `review` reply carry none of the three.
So the anchor cannot come from the socket, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one base URL for futures, S1 | USDT-M, USDC-M and COIN-M streams all delivered on one socket |
| subscribe frame shape | `{"event": "sub", "params": {"channel": "market_$symbol_depth_step0", "cb_id": ""}}`, one channel per frame, S1 | one channel per frame, 100 frames sent back to back were all served |
| unknown symbol expectation | Not publicly specified | `market_e_nopeusdt_depth_step0`, an upper case id, an unknown channel suffix, an unknown `event` and text that is not JSON all got no reply at all. `depth_step9` got one empty book with `ts` 0 |
| chunk unit and budget | "It is not recommended to subscribe to more than 100 streams per single connection.", "It is advised not to establish more than 100 connections per IP at the same time.", S1 | 100 streams on one socket, all delivering within 678 and 700 ms in two runs, for 60 s with no close. More than 100 was not tried |
| keepalive mechanism | "The WebSocket server sends a Ping message every second. If the WebSocket server does not receive a Pong message response within N seconds, the connection will be terminated (N=1).", recommended pong `{"pong":1721131206}`, S1 | the server sends `{"ping":1790133532}`, a Unix time in seconds, gzip inside a binary frame, every 10.0 s, the first 5.3 to 8.9 s after open. No protocol ping arrived |
| connection lifetime and maintenance notice | "Each connection has a validity period of no more than 24 hours", S1 | no close within 120 s, and no notice frame is documented or seen |
| handshake and operation rate limits | "If the user's messages exceed the limit, the connection will be terminated. Repeated disconnections from the same IP may result in server blocking.", no number, S1 | no refusal at 100 subscribe frames in one burst, and opens took 656 to 984 ms |
| public market data authentication | none | none |
| message parse and routing | `{channel, ts, tick}`, S1 | route on `channel`, spelled `market_<id>_depth_step0`. The frame also carries `event_rep` `""`, `data` `null` and `status` `"ok"` |
| subscribe acknowledgement shape | Not publicly specified | none, the first frame after a subscribe is the book itself, 215 to 242 ms after the subscribe on the six book streams |
| symbol identifier format | lower case `e_btcusdt`, S1 | `e_` plus the lower case base and quote, which is `market.id` `E-BTC-USDT` lower cased without dashes. 785 swaps map to 785 distinct ids, see [`rest.md`](./rest.md) section 2 |
| number representation | `[price, amount]` as numbers, S1 | depth prices and sizes are JSON numbers. Ticker and trade fields are strings |
| timestamp representation | `ts` "System response timestamp" in ms, S1 | `ts` integer ms, a median 7.4 to 7.9 s older than the arrival, and it steps back by up to 7.6 s between frames of one stream, section 4 |
| size unit | "The amount part needs to be multiplied by the Contract Size", S1 | contracts, the same unit as the REST book, section 4 |
| sequence semantics | none documented | none on the wire. Each frame replaces the whole 30 level book |
| idle repeat behaviour | not documented | 0 to 5 frames per 60 s repeated the previous book exactly. A quiet book sent 9 to 12 frames per 60 s |

## 4. The book channel in detail

`market_<id>_depth_step0` on `wss://fmarket-ws.bitrue.com/kline-api/ws` is the only full-resolution book channel, and every row below is about it unless it says otherwise.

### Book delay

The probe's `lag` mode subscribed `e_btcusdt` on both URLs while it polled `GET /fapi/v1/depth?contractName=E-BTC-USDT&limit=5` once a second for 40 s.
A socket book is dated by the REST reply whose top five levels per side are identical to it.

| URL | socket frames | matched to a REST book | socket arrival minus the REST `time` of that book | socket arrival minus the REST arrival | arrival minus frame `ts` | arrival minus trade `ts` |
|---|---:|---:|---|---|---|---|
| `fmarket-ws`, 03:21 UTC | 90 | 21 | median 7,409 ms, 6,876 to 7,772 | median 6,816 ms, 6,395 to 7,525 | median 7,554 ms | median 7,384 ms over 30 trades |
| `fmarket-ws`, 03:48 UTC | 89 | 23 | median 7,486 ms, 6,879 to 8,218 | median 6,921 ms, 6,594 to 7,883 | median 7,434 ms | median 7,322 ms over 21 trades |
| `futuresws`, 03:21 UTC | 86 | 15 | median 11,985 ms, 11,139 to 12,894 | median 11,566 ms, 10,400 to 12,394 | median 12,224 ms | median 11,850 ms over 32 trades |
| `futuresws`, 03:48 UTC | 93 | 24 | median 12,097 ms, 11,394 to 13,183 | median 11,689 ms, 11,025 to 12,738 | median 12,339 ms | median 12,246 ms over 25 trades |

The REST reply itself arrived a median 500 and 458 ms after its own `time`, with median round trips of 497 and 507 ms, and the server clock agreed with this host to about 7 ms, see [`rest.md`](./rest.md) section 7.
So the documented socket shows a book about 6.9 s after REST shows it, and the web page's socket about 11.6 s after.
The trades on the same socket are as late as the books, so the delay is in the server's push path, not in the depth channel alone.
The first frame after a subscribe is fresh and every later one is late.
In the second `lag` run the first twelve BTC frames on `fmarket-ws` were 318, 7,324, 7,434, 7,616, 7,225, 7,225, 7,481, 7,373, 7,234, 7,392, 7,280 and 7,257 ms old by `ts`, and on `futuresws` the first was 566 ms old and the next eleven 12,365 to 13,590 ms.
In the two `book` runs that measured it, the streams showed the same shape: median frame age 7,459 to 7,857 ms, and 1 to 39 frames per stream whose `ts` stepped back by about 7 s from the newest `ts` already seen.
One of those backward frames repeated the exact book first sent with its `ts`, and the rest carried books not seen before.
A feed stamps receive time on arrival, so every Bitrue book would enter the engine about 7 s stale while looking fresh.

### Snapshot on subscribe

Every frame is a snapshot of up to 30 levels per side, in `tick.buys` and `tick.asks`.
The first frame arrived 215 to 242 ms after the subscribe on every book stream, with no acknowledgement before it.
BTC, ETH, LSK and BTC-USDC held 30 bids and 30 asks in every one of 9 to 134 frames per stream in each of three runs.

### Delta semantics

There are no deltas.
A feed calls `resetBook` on every frame.

### Sequence and gap rule

No sequence number exists, and `ts` is not monotonic, so no gap can be detected.
A lost frame is simply replaced by the next snapshot.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| socket snapshot | best first, descending, on every frame of four streams, S1 says "sorted in descending order" | best first, ascending, on every frame |
| REST `depth` | descending at 5, 30 and 100 levels | ascending |

No socket frame had a crossed top of book.

### Level window

The 30 levels are not the 30 best prices.
The first BTC frame had 15 asks one tick apart from 86,526.0 to 86,527.4, then 15 more spread from 86,543.3 to 86,817.2.
The engine holds 20 levels per side, at `server/src/engine/cluster/ClusterIndexBuilder.ts` line 17, so the window covers it.

### Size unit against CCXT `contractSize`

| contract | CCXT `contractSize` | socket size at the touch | REST size at the same price | coins |
|---|---:|---|---|---|
| `E-BTC-USDT` | 0.0001 | `98128` at 86,525.9 | `94155` at 86,525.9, in a REST book whose `time` is 7.2 s after the socket frame's `ts` | 9.8 BTC on the socket, 9.4 BTC on REST |
| `E-ETH-USDT` | 0.001 | `215321` at 2,764.33 | `325637` at 2,764.33 | 215 ETH on the socket, 326 ETH on REST |

Both rows are from the first `book` run at 03:19 UTC.

The unit is contracts, which is what S1 says and what CCXT Pro assumes, since it multiplies each socket amount by `contractSize` at `server/node_modules/ccxt/js/src/pro/bitrue.js` lines 427 to 448.
The engine's `sizeMul` would therefore convert Bitrue sizes correctly.
The socket and REST sizes rarely match at the same price, 1 or 2 of the 2 to 17 prices both books shared in three runs, because the socket book is 7 s behind, and in the later runs even the best prices of the two books differed.

### One-sided and empty books

No one-sided book was seen on the four streams.
`depth_step9`, which is not a real step, returned `{"tick":{"asks":[],"buys":[]},"ts":0}` once, so an empty book is two empty arrays.

### Idle repeats

`e_btcusdt` repeated the previous book exactly 4, 1 and 3 times in three 60 s runs, `e_ethusdt` 0, 2 and 1 times, and `e_btcusdc` 2, 2 and 5 times.
`e_lskusdt` sent 10, 9 and 12 frames in 60 s, with `ts` gaps up to 17.3 s, and 39 frames in 120 s and 15 in 60 s in the silence runs.

### Unknown, closed and wrong symbols

| request | reply |
|---|---|
| `market_e_nopeusdt_depth_step0` | nothing in 40 s |
| `market_E_BTCUSDT_depth_step0` | nothing |
| `market_e_btcusdt_nope` | nothing |
| `{"event":"nope","params":{}}` | nothing |
| `not json` | nothing, and the socket stayed open |
| `market_e_btcusdt_depth_step0` a second time | no reply, and the stream kept one flow |
| `market_e_btcusdt_depth_step9` | one empty book with `ts` 0 |

A closed or delisted contract was not available, since all 764 linear contracts had `status` 1.
Because nothing acknowledges or refuses a subscribe, the feed has to notice a stream with no frame on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server ping every second, pong within 1 s, S1 | server `{"ping":<seconds>}` every 10.0 s, gzip in a binary frame. Sockets that never answered a ping stayed open for the full 120 s, and 60 s in the rerun, subscribed or not |
| silence the server tolerates | Not publicly specified | a socket that neither subscribed nor answered pings stayed open 120 s, and 60 s in the rerun |
| forced disconnect | 24 h at most, S1 | none in 120 s |
| maintenance notice | none documented | none seen |
| compression | "Data is compressed in binary format except for heartbeat data (users need to decompress using the Gzip algorithm).", S1 | every frame, the ping too, is a binary frame holding a gzip stream that starts `1f 8b`. A client that offered permessage-deflate got no extension back. CCXT Pro sets `'gunzip': true` at `server/node_modules/ccxt/js/src/pro/bitrue.js` line 56 |
| handshake | | 656 to 984 ms to open `fmarket-ws` and 883 and 928 ms to open `futuresws` from this host |
| subscription limits | 100 streams per connection recommended, 100 connections per IP, S1 | 100 streams ran 60 s with no close |
| throughput | | 100 USDT perpetuals, every seventh in catalog order, two runs: 83 and 87 frames per second median, peaks 152 and 136, 37.2 and 38.0 KB per second on the wire and 83.1 and 85.2 KB after gunzip, 447 bytes per frame on the wire and 1,000 and 1,002 after, 27 and 44 µs of gunzip plus `JSON.parse` per frame |

In the three `book` runs the gunzip of one frame took a median 23 to 29 µs and `JSON.parse` a median 7 to 9 µs, over 687 to 695 frames per run.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Arrays marked `…` are cut, and every frame below arrived gzip-compressed and is shown after gunzip.

Subscribe.

```json
{"event": "sub", "params": {"channel": "market_e_btcusdt_depth_step0", "cb_id": "e_btcusdt"}}
```

No acknowledgement arrives.
The first book, three levels per side kept.

```json
{"event_rep":"","channel":"market_e_btcusdt_depth_step0","data":null,"tick":{"asks":[[86526,61555],[86526.1,64099],[86526.2,18142]],"buys":[[86525.9,51720],[86525.8,12111],[86525.7,15344]]},"ts":1790133525574,"status":"ok"}
```

Keepalive, from the server, and the answer CCXT Pro sends.

```json
{"ping":1790133532}
```

```json
{"pong":1790133532}
```

The empty book of a step that does not exist.

```json
{"event_rep":"","channel":"market_e_btcusdt_depth_step9","data":null,"tick":{"asks":[],"buys":[]},"ts":0,"status":"ok"}
```

Ticker, which carries no anchor field.

```json
{"event_rep":"","channel":"market_e_btcusdt_ticker","data":[],"tick":{"amount":"16171002079553.2236455549","close":"86526","high":"86814.16754926597","low":"85090.9","open":"85501.5","rose":"0.01198225","vol":"188038684"},"ts":1790133526176,"status":"ok"}
```

Trade, whose trade `ts` is older than the frame `ts`.

```json
{"event_rep":"","channel":"market_e_btcusdt_trade_ticker","data":[],"tick":{"data":[{"price":"86525.9","vol":"15","side":"BUY","amount":"1297888.5","ds":"2026-09-23 11:18:39","ts":1790133519078}],"ts":1790133519078},"ts":1790133519416,"status":"ok"}
```

No error frame exists to quote, since every bad request in section 4 went unanswered.

## 7. Private channels

Named for a future execution stage, from S1, not probed.

- A listen key comes from `POST /user_stream/api/v1/listenKey` on `https://fapiws-auth.bitrue.com`, lives 60 minutes and is extended by `PUT`.
- The stream is `wss://fapiws.bitrue.com/stream?listenKey=<listenKey>`, subscribed with `{"event":"sub","params":{"channel":"user_account_update"}}`, and it carries `ORDER_TRADE_UPDATE` and account events.
- Its keepalive is `{"event":"ping","ts":"…"}` answered by `{"event":"pong","ts":"…"}`.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
The book delay of section 4 blocks this feed, so the shape below is what a feed would look like if Bitrue removed the delay, and it should not be built before a probe shows that.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://fmarket-ws.bitrue.com/kline-api/ws`, for every family | one socket carries USDT-M, USDC-M and COIN-M, and this URL was 4 to 5 s less late than the web page's URL |
| channel | `market_<id>_depth_step0`, where `<id>` is `'e_' + baseId + quoteId` lower cased, from `market.id` `E-BASE-QUOTE` | full-resolution 30 level snapshots |
| markets per connection | 100 | the documented recommendation, and 100 streams ran with no close |
| subscribe frames | one frame per market, `{"event":"sub","params":{"channel":"market_<id>_depth_step0","cb_id":"<id>"}}` | the documented shape takes one channel |
| decode | `zlib.gunzipSync(raw)` in `handleMessage` before `JSON.parse` | every frame is gzip, a median 23 to 29 µs per frame, and `VenueFeed` hands the subclass the raw buffer at `server/src/feeds/book/VenueFeed.ts` line 209 |
| keepalive | answer each `{"ping":n}` with `{"pong":n}`, and send nothing else | the server pings every 10 s, and no socket was closed for missing pongs, but the documentation says it may be |
| `maxSilenceMs` | 30,000 | three missed server pings, and a quiet book went 17.3 s without a frame |
| routing | `channel.slice(7, channel.lastIndexOf('_depth_step0'))` gives the stream id, mapped back to `rawMarketId` by a table built at plan time | the channel spells a lower case id without dashes |
| book | `resetBook` on every frame | every frame is a whole book |
| resync | none needed for gaps. Reconnect before 24 h | no sequence exists, and the documented lifetime is 24 h |
| unserved stream | log a stream with no frame 10 s after its subscribe | unknown streams get no reply |
| receive time | stamp on arrival, never from `ts` | `ts` steps back by up to 7.6 s and trails arrival by about 7.5 s |
| deflate | keep `perMessageDeflate: false` | the server compresses inside the frame and does not negotiate the extension |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitrue Futures API documentation, sections "Websocket Market Data" to "User stream" | https://www.bitrue.com/api_docs_includes_file/futures/index.html | 2026-09-22 | Bitrue, global | URL, channels, compression, ping rule, limits, lifetime, size unit, private stream, sections 1 to 7 |
| S2 | CCXT Pro 4.5.68 `bitrue.js` | `server/node_modules/ccxt/js/src/pro/bitrue.js` | 2026-09-22 | CCXT | `futurePublic` URL, `gunzip`, stream id rule, contract size conversion, pong shape, sections 1, 4, 5, 6 |
| S3 | Bitrue futures web bundle and contract list | https://www.bitrue.com/futures, its scripts under `/futures/includes/`, and `POST https://futures.bitrue.com/fe-co-api/common/public_info` | 2026-09-22 | Bitrue, global | the web page's socket URL and its `review` request, section 1 and 2 |
| P1 | `ws-probe.mjs book`, three runs at 03:18, 03:20 and 03:48 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitrue/ws-probe.mjs) | 2026-09-23 | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs lag`, two runs at 03:21 and 03:48 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitrue/ws-probe.mjs) | 2026-09-23 | this host | book delay, section 4 |
| P3 | `ws-probe.mjs batch 100`, two runs at 03:23 and 03:50 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitrue/ws-probe.mjs) | 2026-09-23 | this host | throughput and limits, sections 3 and 5 |
| P4 | `ws-probe.mjs silence`, 120 s at 03:24 UTC and `silence 60` at 03:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitrue/ws-probe.mjs) | 2026-09-23 | this host | keepalive and silence, sections 3 and 5 |
| P5 | `ws-probe.mjs deflate` and `web`, two runs each | [`ws-probe.mjs`](../../../scripts/probes/venues/bitrue/ws-probe.mjs) | 2026-09-23 | this host | compression, the web URL and `review`, sections 1, 2 and 5 |
