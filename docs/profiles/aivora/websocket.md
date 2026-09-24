# Aivora WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 in Pacific time, which is 2026-09-23 04:17 to 04:43 UTC, from the development host near Seattle.
All traffic left through the laptop's Surfshark WireGuard tunnel, whose exit geolocates to Canada (Cloudflare trace `loc=CA`, `colo=YVR`), so every access result below is what a Canadian address saw.

This profile covers the public futures socket of Aivora Exchange, which has no CCXT class, for its USDT-M and USDC-M perpetuals, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/aivora/ws-probe.mjs), and the capture is quoted beside the documented value.
The documentation, S1, is a short Chinese page for a white-label open API, and where it and the wire disagree, both are written.
The two runs of each mode are P1 at 04:27 to 04:33 UTC and P2 at 04:38 to 04:43 UTC.

## 1. Endpoints

| family | URL | source | probed |
|---|---|---|---|
| USDT-M and USDC-M perpetuals | `wss://openapi.aivora.com/futures/ws` | S1 "合约行情基础站点" (futures market data base URL) | 101 in 518 to 1,454 ms over the four timed opens, and no refusal on any of the 15 opens in the two runs |
| futures, web app | `wss://futuresws.aivora.com/kline-api/ws` | `wsUrl` in the web futures list S3, and in the home page config | NXDOMAIN on 2026-09-23 UTC, P1 and P2 `deflate` |
| spot, open API | `wss://openapi.aivora.com/spot/ws` | S1 | 101 in 497 and 1,495 ms, not probed further |
| spot, web app | `wss://ws.aivora.com/spot` | home page config | 101 in 527 and 536 ms, not probed further |
| guess | `wss://ws.aivora.com/kline-api/ws` | the web path on the spot host | HTTP 404 from nginx |

One socket carries both perpetual families.
`market_e_btcusdc_depth_0.1` delivered 17 frames on the same socket that served the USDT-M streams, in both runs.
The hosts sit behind Huawei Cloud CDN, and `openapi.aivora.com` resolved to `98.98.253.34`, `98.98.253.82`, `128.14.165.168` and `128.14.165.172`, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | subscribe `params.channel` | depth and speed | probed |
|---|---|---|---|
| depth | `market_<sub>_depth_<step>`, where `<sub>` is `e_btcusdt` and `<step>` is a price step from the contract's `depthList` | 30 levels per side, whole window each push, about 2.2 to 2.5 pushes a second on BTC | recommended, section 4 |
| aggregated depth | the same with a coarser step, `market_e_btcusdt_depth_1` | 30 aggregated levels | 21 and 20 frames in about 9 s |
| ticker | `market_<sub>` | about once a second on BTC, every 0.9 to 12 s on FARTCOIN | carries `sign_price` (mark), `index_price`, `funding_rate_last`, `funding_rate_next`, `last_fund_rate_third` and `admin_fund_rate_source` |
| trades | `market_<sub>_deals` | on trade, the first frame is a batch of recent trades | 14 frames in about 9 s. The documentation's table spells it `market_$symbol_symbol_deals`, and its example spells it `market_$symbol_deals` |
| candles | `market_<sub>_kline_<period>`, periods `1min` to `1month` | on change | 11 frames in about 9 s |
| `market_e_btcusdt_trade_ticker` | | | silent |

The channel names and the `sub` and `unsub` events are from S1.
No best bid and ask channel, no dedicated mark, index or funding channel, and no all-market channel exists.
The ticker is the only socket source of mark, index and funding, one contract per subscription.

The `<step>` values come from `coinResultVo.depthList` in the web futures list S3, and the first value equals the contract's price tick, `10^-symbolPricePrecision`, on 77 of 77 contracts, P1 and P2 `catalog` in [`rest.md`](./rest.md).
So `market_e_btcusdt_depth_0.1`, `market_e_ethusdt_depth_0.01` and `market_e_fartcoinusdt_depth_0.0001` are the unaggregated books.
The step is written as the web list spells it, and a step the contract does not offer, such as `market_e_btcusdt_depth_0.01`, is silent.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one futures URL and one spot URL, S1 | one socket served USDT-M and USDC-M |
| subscribe frame shape | `{"event":"sub","params":{"channel":"market_$symbol_depth_0.1"}}`, S1 | the same with `"cb_id":"1"` added worked, one channel per frame, 77 frames sent in one burst were all served |
| unknown symbol expectation | Not publicly specified | silence: `market_e_nopeusdt_depth_0.1` got no frame and no error in about 9 s, in both runs |
| chunk unit and budget | Not publicly specified | 77 streams on one socket, every one delivered, no refusal |
| keepalive mechanism | "30s内发送心跳包" (send a heartbeat within 30 s) above `{"ping": "ping"}`, S1 | the server sends a text `{"ts":"2026-09-23T04:38:11Z","ping":1790138291}` every 10 s, and a socket that never answers `{"pong": <ping>}` is closed. The documented `{"ping":"ping"}` got no reply and did not keep a socket open, section 5 |
| connection lifetime and maintenance notice | Not publicly specified | no lifetime cap reached in 120 s, no notice seen |
| handshake and operation rate limits | Not publicly specified | none hit |
| public market data authentication | none, S1 | none |
| message parse and routing | `{channel, ts, tick}`, S1 | `{"eventResp":"sub", "channel", "tick", "ts"}` on the first frame of a stream, `{channel, tick, ts}` after it. Route on `channel` |
| subscribe acknowledgement shape | not documented | no separate acknowledgement. The first data frame carries `"eventResp":"sub"` |
| symbol identifier format | `btcusdt` for spot, `e_btcusdt` for futures, S1 | `e_` plus the lower case base and quote, which is the web list's `subSymbol` on 77 of 77 contracts. The open API spells the same contract `E-BTC-USDT`, and the ticker frame's `tick.symbol` spells it `E_BTCUSDT` |
| number representation | numbers in the S1 examples | strings for every price and size in depth and ticker frames |
| timestamp representation | `ts` in ms in the S1 examples | envelope `ts` and `tick.ts` are ISO 8601 strings with whole seconds, `"2026-09-23T04:38:04Z"`. The ticker adds `tick.ts` in ms and `tick.timestamp` in seconds |
| size unit | Not publicly specified | contracts of `multiplier` coins, section 4 |
| sequence semantics | none documented | none: no update id, no sequence, no checksum. Every frame is a whole 30 level window |
| idle repeat behaviour | not documented | no frame repeated the previous one, 0 of 460 and 0 of 433 frames over four streams. A quiet book went up to 6.6 s without a frame |

## 4. The book channel in detail

`market_<sub>_depth_<tick>` is the channel this profile recommends, and every row below is about it.

### Snapshot on subscribe

The first frame of each stream is a whole book, marked `"eventResp":"sub"`, 362 to 388 ms after the subscribe frame on BTC, ETH and FARTCOIN and 603 and 667 ms on XAU, in the two runs.
On 77 streams at once the first frame came 317 to 1,204 ms after the subscribe, median 973 and 983 ms.

### Delta semantics

There are no deltas.
Every later frame is also a whole window of 30 bids and 30 asks, on 460 of 460 frames in P1 and 433 of 433 in P2 across BTC, ETH, FARTCOIN and XAU.
A feed replaces the book on every frame.

### Sequence and gap rule

None exists and none is needed.
Frames carry no id, so a lost frame is invisible, and the next frame repairs the book.
The only failure a feed can detect is a stream that stops, which the silence watch covers.

### Checksum

None is documented and no frame carries one.

### Level order and columns

Bids arrive best first, descending, and asks best first, ascending, on every frame, with 0 frames out of order in both runs.
Each level is four strings: price, size, cumulative size, and cumulative `price * size`.
The third column equalled the running sum of sizes on every level, and the fourth equalled the running sum of `price * size` on 27,780 of 27,780 levels in P1.
The fourth column is not multiplied by the contract size, so it is not a quote amount.

### Level window

30 levels per side on every frame of four streams in both runs.
The documentation says "返回买卖盘最多30条数据" (at most 30 levels per side), S1.
The REST book also stops at 30 levels whatever `limit` asks for, see [`rest.md`](./rest.md) section 5.

### Size unit

| contract | `multiplier` | socket size at the touch | REST size at the same price | coins |
|---|---:|---|---|---|
| `E-BTC-USDT` | 0.0001 | bid `"57231"` at 87091.6 | `"57231"` | 5.7231 BTC |
| `E-ETH-USDT` | 0.01 | bid `"7756"` at 2780.53 | not compared | 77.56 ETH |
| `E-FARTCOIN-USDT` | 1 | bid `"35336"` at 0.2134 | not compared | 35,336 FARTCOIN |
| `E-XAU-USDT` | 0.001 | bid `"61203"` at 4348.84 | not compared | 61.203 XAU |

The unit is contracts, and one contract is `multiplier` of `multiplierCoin`, S1 "合约面值" (contract face value).
The socket book of `E-BTC-USDT` matched the REST book at 30 of 30 bid prices and 30 of 30 sizes, read 290 ms and 476 ms after the frame in the two runs.
With no CCXT class, a catalog loader must set `contractSize` from `multiplier` itself, see [`rest.md`](./rest.md) section 2.

Every BTC level in these captures and in [`rest.md`](./rest.md) held 46,000 to 69,000 contracts, about 5 to 7 BTC, one tick apart.
A book that deep at every tick on a venue of this size may be a quoting program that mirrors another venue, and this probe cannot tell mirrored liquidity from resting orders.

### One-sided and empty books

No tradable contract showed a one-sided or empty book.
The REST book of `E-AR-USDT`, one of the 164 contracts with `status` 0, returned empty `bids` and `asks`, and its socket stream was silent, see [`rest.md`](./rest.md) section 5.
So a delisted contract sends nothing rather than an empty frame.

### Idle repeats and cadence

No frame repeated the previous frame's levels.
On BTC the gap between frames had a median of 400 to 416 ms and a maximum of 800 to 1,027 ms.
On FARTCOIN the median gap was 1,399 and 1,456 ms, with a maximum of 5.4 and 6.1 s.
Across all 77 streams each stream sent 25 to 281 frames a minute, median 34 and 35, and the longest silence on any stream was 6.0 s in P1 and 6.6 s in P2.
In P2, 310 of the 433 gaps on the four streams fell within 30 ms of a multiple of 200 ms, against about 130 if arrivals were random, which suggests a publisher timer of 200 ms.
That reading is an inference.

### Unknown, closed and wrong symbols

| request | reply | runs |
|---|---|---|
| `market_e_nopeusdt_depth_0.1` | nothing | P1, P2 |
| `market_e_btcusdt_depth_0.01`, a step finer than the tick | nothing | P1, P2 |
| `market_e_btcusdt_depth_step0` | nothing | P1, P2 |
| `market_e_btcusdt_nope` | nothing | P1, P2 |
| `market_btcusdt_depth_0.1`, the spot spelling on the futures socket | nothing | P1, P2 |
| `market_e_arusdt_depth_0.001`, a delisted contract | nothing | P1, P2 |
| text that is not JSON | nothing, and the socket stays open | P1, P2 |
| the same subscription twice | one stream of frames, not two, and no error | P1, P2 |
| `{"event":"unsub","params":{"channel":…}}` | the stream stops | P1, P2 |

Every failure is silent, so a feed must notice a stream with no first frame on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | "30s内发送心跳包" above `{"ping": "ping"}`, S1 | the server sends `{"ts":…,"ping":<unix s>}` as text every 10 s, at 9,954 to 10,059 ms intervals, on a clock shared by every socket, since the first ping came 2.9 to 9.6 s after open and the sockets of one run got their pings within 0.5 s of each other. The client answers `{"pong":<same number>}` |
| silence the server tolerates, subscribed | Not publicly specified | a subscribed socket that never answered a ping closed with 1006 at 62.9 s in P1 and 69.1 s in P2, 10 s after its sixth unanswered ping. A socket that answered every ping stayed open for the full 120 s in both runs |
| client ping | `{"ping":"ping"}`, S1 | sent every 10 s on a subscribed socket in P2, it got no reply, and the socket closed at 69.1 s exactly like the one that sent nothing |
| silence the server tolerates, unsubscribed | Not publicly specified | a socket with no subscription closed with 1006 at 23.4 s in P1 and 29.2 and 29.6 s in P2, 10 s after its second ping, whether or not it answered the pings |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | Not publicly specified | none seen |
| compression | "返回数据除了心跳数据都会二进制压缩(用户需要通过Gzip算法进行解压)" (all data except heartbeats is binary compressed, decompress with gzip), S1 | every frame was a text JSON frame, 516 and 551 frames with 0 binary in the two book runs. A client that offered permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | | 518 to 1,454 ms to open over the four timed opens |
| subscription limits | Not publicly specified | 77 streams on one socket, no cap reached |
| throughput | | 77 streams: 4,590 and 4,251 frames in 60 s, a median of 74 and 67 frames a second, a peak of 123 and 110, 2,720 and 2,721 bytes per frame, 203 and 188 KB a second, and 92 and 84 µs of `JSON.parse` per frame |

## 6. Captured frames

Trimmed, from P2 at 04:38 UTC.
Arrays keep the first three levels per side.

Subscribe.

```json
{"event": "sub", "params": {"channel": "market_e_btcusdt_depth_0.1", "cb_id": "1"}}
```

First frame of a stream, which is the only acknowledgement.

```json
{"eventResp":"sub","channel":"market_e_btcusdt_depth_0.1","tick":{"asks":[["87148.0","50608","50608","4410385984.0"],["87148.1","61383","111991","9759797806.3"],["87148.2","58324","170315","14842629423.1"]],"bids":[["87147.9","62079","62079","5410054484.1"],["87147.8","49735","111814","9744350317.1"],["87147.7","58552","170366","14847022447.5"]],"ts":"2026-09-23T04:38:03Z"},"ts":"2026-09-23T04:38:04Z"}
```

The next frame, 244 ms later, again a whole window.

```json
{"channel":"market_e_btcusdt_depth_0.1","tick":{"asks":[["87148.0","64292","64292","5602919216.0"],["87148.1","61383","125675","10952331038.3"],["87148.2","58324","183999","16035162655.1"]],"bids":[["87147.9","65619","65619","5718558050.1"],["87147.8","49735","115354","10052853883.1"],["87147.7","58552","173906","15155526013.5"]],"ts":"2026-09-23T04:38:04Z"},"ts":"2026-09-23T04:38:04Z"}
```

First frame of a quiet book, whose `tick.ts` is 2 s older than the envelope and arrived at 04:38:04.382 UTC.

```json
{"eventResp":"sub","channel":"market_e_fartcoinusdt_depth_0.0001","tick":{"asks":[["0.2132","29234","29234","6232.6888"],["0.2133","40641","69875","14901.4141"],["0.2134","28387","98262","20959.1999"]],"bids":[["0.2130","29908","29908","6370.4040"],["0.2129","24682","54590","11625.2018"],["0.2128","45160","99750","21235.2498"]],"ts":"2026-09-23T04:38:02Z"},"ts":"2026-09-23T04:38:04Z"}
```

Ticker, which carries the anchor fields.

```json
{"eventResp":"sub","channel":"market_e_btcusdt","tick":{"symbol":"E_BTCUSDT","open":"85530","close":"87147.9","amount":"11675813609495.4","vol":"135644191","piece":"0","high":"87247.3","low":"85080","rose":"1.8866137755","rose7d":"14.8193675889","rose1h":"0.4689818321","rose4h":"0.7943456653","rose24h":"1.8866137755","timestamp":1790138283,"utime":"2026-09-23T04:38:03Z","base":"BTC","quote":"USDT","sign_price":"87147.9","index_price":"87184.55","funding_rate_last":"-0.0000525627429384","funding_rate_next":"0.0000800000000000","ts":1790138283000,"admin_fund_rate_source":"\"third\"","last_fund_rate_third":"-0.00001"},"ts":"2026-09-23T04:38:04Z"}
```

Server ping and the answer that keeps the socket open.

```json
{"ts":"2026-09-23T04:38:11Z","ping":1790138291}
```

```json
{"pong": 1790138291}
```

No error frame exists to quote, since every failure in section 4 was silent.

## 7. Private channels

S1 documents no private socket channel.
Orders, fills and balances are REST calls signed with `X-CH-APIKEY`, `X-CH-SIGN` and `X-CH-TS`, under `https://openapi.aivora.com/futures/open/fapi/v1`, such as `POST /order`, `POST /cancel`, `GET /openOrders`, `GET /myTrades` and `GET /account`, S1.
None was called.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://openapi.aivora.com/futures/ws`, for USDT-M and USDC-M | one socket served both families |
| channel | `market_<sub>_depth_<depthList[0]>`, from the web futures list | the finest step equals the tick on every contract, and a wrong step is silent |
| markets per connection | 77, every tradable contract on one socket | 77 streams ran with every stream delivering at 67 to 74 frames a second, and no cap is published, so a larger slice is untested |
| subscribe frames | one `{"event":"sub","params":{"channel":…,"cb_id":"1"}}` per market, sent in one burst | the protocol takes one channel per frame |
| keepalive | answer each server `{"ping":n}` with `{"pong":n}`, and send nothing else | the server closes a subscribed socket after six unanswered pings, and the documented client ping does not count |
| `maxSilenceMs` | 25,000 | the 10 s server ping is traffic, so 25 s is two missed pings. A book frame alone would not do, since a quiet stream went 6.6 s without one and a single-market slice could go longer |
| routing | `channel` between `market_` and `_depth_` gives `<sub>`, and a map from `subSymbol` to `contractName` gives the `rawMarketId` | the socket and the open API spell the contract differently |
| snapshot | every depth frame: `resetBook` with all 30 levels per side, then `publish` | whole windows, no deltas |
| delta | none | |
| resync | none on sequence. Log a stream with no first frame 10 s after its subscribe | unknown, delisted and wrong-step streams are silent |
| receive time | stamp on arrival, never from `ts` or `tick.ts` | both are whole seconds, and a quiet book's `tick.ts` was 2 s old on arrival |
| sizes | `Number()` of the string, multiplied by `multiplier` through `contractSize` | contracts, not coins |
| decode | read text frames as JSON, and gunzip a binary frame if one ever arrives | the documentation promises gzip binary, and the wire sent text |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |
| depth | 30 levels per side covers the engine's 20 | |

The cadence is the weak point: a book pushed every 400 ms on BTC and every 1.4 s or more on a quiet contract is older than the engine's 100 ms cross age on most reads.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Aivora API documentation, page "Websocket推送", and page "合约交易" for the private REST calls | https://kaisensei34.gitbook.io/aivora-docs/websocket-tui-song | 2026-09-22 | Aivora, global | URLs, channel names, sub and unsub, heartbeat line, gzip line, 30 level limit, sections 1 to 7 |
| S2 | Aivora API doc pointer page, which links S1 | https://www.aivora.com/en-us/cms/apidoc | 2026-09-22 | Aivora, global | that S1 is the official documentation |
| S3 | Aivora web futures list, called with `POST` and body `{}` | https://api.aivora.com/futures/api/common/public_info_v2 | 2026-09-23 UTC | Aivora, global | `wsUrl`, `subSymbol`, `depthList`, sections 1 and 2 |
| P1 | [`ws-probe.mjs`](../../../scripts/probes/venues/aivora/ws-probe.mjs) `book`, `batch`, `silence`, `deflate`, first runs at 04:27 to 04:33 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/aivora/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | sections 1 to 6 |
| P2 | [`ws-probe.mjs`](../../../scripts/probes/venues/aivora/ws-probe.mjs) `book`, `batch`, `silence` with the client ping variant, `deflate`, second runs at 04:38 to 04:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/aivora/ws-probe.mjs) | 2026-09-23 UTC | this host, Canadian exit | sections 1 to 6, the second readings and the frames quoted |
