# Bitbaby WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:16 to 04:43 UTC, from the development host near Seattle through its Canadian VPN exit.

This profile covers the futures market socket of Bitbaby, which has no CCXT class, for both perpetual families, with the book channel in detail.
Bitbaby publishes no working API documentation, so there is no documented value for any axis.
The socket URL, the `compress` query, the frame format and the channel names were read from the website's own JavaScript bundle and then confirmed on the wire by [`ws-probe.mjs`](../../../scripts/probes/venues/bitbaby/ws-probe.mjs).
The protocol is the ChainUp market socket, so a ChainUp white label that documents it would be the closest reference, and none was read for this profile.
Access results are from a Canadian VPN exit, see [`fees.md`](./fees.md) section 1.

## 1. Endpoints

| family | URL | source | probed |
|---|---|---|---|
| USDT-M and USDC-M perpetuals | `wss://web-api.bitbaby.com/futures/ws` | the web bundle's socket table, `futures:"wss://web-api.bitbaby.com/futures/ws"`, S1 | upgrade 101 through Cloudflare, open in 436 to 801 ms over all runs |
| same, compressed | `wss://web-api.bitbaby.com/futures/ws?compress=1` | the bundle appends `compress=1` and inflates every frame with pako, S1 | every frame binary zlib, section 5 |
| spot | `wss://web-api.bitbaby.com/spot/ws` in the bundle, `wss://api.bitbaby.com/spot/ws` in the page configuration | S1 | not probed |
| futures, as configured | `wss://api.influencelab.xyz/futures/ws`, the `wsUrl` of `public_info_v2` | P4 | TLS refused: the certificate names only `symini.com` and `www.symini.com`, `ERR_TLS_CERT_ALTNAME_INVALID` |

One socket carries both families.
`market_e_btcusdt_depth_0.1` and `market_e_btcusdc_depth_0.1` delivered on the same connection in both book runs, P1.
The bundle's socket hook builds its URL from a hard-coded table on `web-api.bitbaby.com`, not from the configured `wsUrl`, S1.

## 2. Channel matrix for public market data

The contract part of every channel name is the catalog's `subSymbol`, such as `e_btcusdt`, see [`rest.md`](./rest.md) section 2.

| channel | payload | depth and speed | probed on 2026-09-23 |
|---|---|---|---|
| `market_<subSymbol>_depth_<step>` | `{"event":"sub","params":{"channel":"market_e_btcusdt_depth_0.1","cb_id":"1"}}` | 40 levels per side, a whole book per frame, pushed on change at about 200 ms on busy contracts | recommended, section 4 |
| `market_<subSymbol>` | same frame shape | ticker pushed on change, about every 500 ms on BTC and up to 53 s apart on quiet contracts | carries `sign_price` (the mark), `index_price`, `funding_rate_last`, `funding_rate_next`, `last_fund_rate_third`, `admin_fund_rate_source` |
| `market_<subSymbol>_deals` | same | trades | answered with trade frames in exploration, not probed further |
| `market_<subSymbol>_kline_<period>`, `market_<subSymbol>_mark_kline_<period>` | same | candles of last and of mark | names from S1, not probed |
| `market_<subSymbol>_roses` | same | one `E_BTCUSDT` entry of comma separated 24 h change, prices and volumes | answered once on subscribe in exploration, no further frame in 5 s |

`<step>` is one of the contract's `coinResultVo.depthList` strings, and the first is always the price tick, on 358 of 358 contracts, P4.
A step outside the list, or the ChainUp `step0` form, is silently ignored, section 4.
No dedicated index, mark or funding channel was found, and the ticker is the only socket source of all three.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is empty for every row, because the documentation link, `https://docs.bitbaby.com/en/`, returned 404 on every path tried, see [`rest.md`](./rest.md) section 1.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified | one URL for USDT-M and USDC-M, section 1 |
| subscribe frame shape | Not publicly specified | `{"event":"sub","params":{"channel":"<name>","cb_id":"<id>"}}`, one channel per frame, as the bundle builds it |
| unknown symbol expectation | Not publicly specified | no reply at all: 0 frames in 2 s for `market_e_nopeusdt_depth_0.1`, for a step not in `depthList` and for `depth_step0`, in both runs |
| chunk unit and budget | Not publicly specified | 358 subscribe frames sent in one burst on one socket, all 358 streams delivered, first frames a median 510 and 516 ms and at most 612 and 806 ms after the burst began |
| keepalive mechanism | Not publicly specified | the server sends `{"ts":"<ISO second>","ping":<Unix s>}` every 10 s, no protocol ping. The client answers `{"pong":<same number>}` |
| connection lifetime and maintenance notice | Not publicly specified | no lifetime cap reached in 120 s, no notice frame seen |
| handshake and operation rate limits | Not publicly specified | no refusal at 358 subscriptions in one burst, or at any of 24 socket opens over the session |
| public market data authentication | Not publicly specified | none |
| message parse and routing | Not publicly specified | `{"channel","tick","ts"}` for data, with `"eventResp":"sub"` added to the first frame after a subscribe. Route on `channel` |
| subscribe acknowledgement shape | Not publicly specified | no separate ack. The first data frame carries `"eventResp":"sub"` and a full book, 105 to 149 ms after the subscribe |
| symbol identifier format | Not publicly specified | `market_e_btcusdt_depth_0.1` on the channel, `E_BTCUSDT` inside the ticker, `E-BTC-USDT` as the catalog `contractName`, `BTC-USDT` as its `symbol` |
| number representation | Not publicly specified | every price and size is a decimal string |
| timestamp representation | Not publicly specified | ISO 8601 strings at whole seconds, `"2026-09-23T04:39:42Z"`, in the envelope and in the book tick. The ticker adds `timestamp` in Unix seconds and `ts` in Unix ms rounded to the second |
| size unit | Not publicly specified | contracts of the catalog's `multiplier`, section 4 |
| sequence semantics | Not publicly specified | none. No update id, no checksum, every frame is a whole 40 level book |
| idle repeat behaviour | Not publicly specified | none. 0 frames equal to the previous frame on 7 streams in either run, and a quiet book sends nothing |

## 4. The book channel in detail

`market_<subSymbol>_depth_<tick>` is the channel this profile recommends, and every row below is about it.

### Snapshot on subscribe

The first frame after a subscribe carries `"eventResp":"sub"` and a whole book of 40 bids and 40 asks, P1.
It arrived 105 to 121 ms after the subscribe frame on the compressed socket and 121 to 149 ms on the text socket, over two runs.
A second subscribe to the same channel on the same socket returns another `eventResp` frame with a whole book, and the stream does not double: 14 frames in the 3 s before and 15 in the 3 s after, P1.

### Every frame is a snapshot

Every later frame has the same shape as the first, without `eventResp`.
Over two 60 s runs on seven streams, every frame held exactly 40 bids and 40 asks, no level had a size of zero, no book was crossed, and no frame equalled the frame before it, P1.

| stream | frames in 60 s, two runs | gap between frames, ms, run 1 | gap, run 2 |
|---|---|---|---|
| `e_btcusdt` at 0.1, compressed | 252 and 239 | min 149, median 201, p90 400, max 599 | 189, 201, 400, 601 |
| `e_btcusdt` at 0.1, text | 252 and 239 | 108, 200, 400, 599 | 190, 201, 400, 600 |
| `e_ethusdt` at 0.01 | 228 and 237 | 84, 201, 401, 577 | 136, 201, 401, 599 |
| `e_btcusdc` at 0.1 | 213 and 149 | 146, 201, 404, 801 | 193, 400, 601, 609 |
| `e_xauusdt` at 0.01 | 99 and 87 | 174, 600, 1,003, 1,203 | 196, 800, 1,001, 1,199 |
| `e_iotxusdt` at 0.000001 | 48 and 39 | 199, 1,201, 2,200, 2,600 | 186, 1,814, 3,001, 3,600 |

The gap quantiles sit near multiples of 200 ms, so the server appears to publish on a 200 ms timer and to skip a tick when the book has not changed.
That reading is an inference from the gap distribution.
In the batch of 358 streams, each stream sent 14 to 247 frames in 60 s, P2.

### Sequence and gap rule

```text
frame with bids and asks   replace the whole book
```

No frame carries an update id, a version or a checksum, and the tick has only `asks`, `bids` and `ts`.
There is no delta to lose, so a feed needs no gap rule.
It also cannot detect a lost frame, and a stream that falls silent looks the same as a quiet book.

### Level format and order on the wire

Each level is `[price, size, cumulative size, cumulative size times price]`, all strings.
The third element was the running sum of sizes from the touch on every ask side of every frame, P1.
In the captured IOTX frame the bid `["0.003888","3743","3743","14.552784"]` has 3,743 times 0.003888 equal to 14.552784, so the fourth element is contracts times price and ignores the multiplier.

| side | order |
|---|---|
| bids | best first, descending, on every frame of every stream |
| asks | best first, ascending, on every frame of every stream |

### Level window

The server always sends 40 levels per side at the finest step, which covers the engine's 20 at [`ClusterIndexBuilder.ts`](../../../server/src/engine/cluster/ClusterIndexBuilder.ts) line 17.
IOTX, the quietest stream probed, also held 40 on both sides of every frame.
Coarser steps aggregate the book, for example `market_e_btcusdt_depth_1` sent levels at whole dollars in exploration.

### Size unit against the catalog multiplier

| contract | `multiplier` | socket size at the touch | coins | Binance USD-M touch read beside it |
|---|---:|---|---|---|
| `E-BTC-USDT` run 1 | 0.0001 BTC | bid `"120400"` at 87110.0, ask `"104573"` at 87110.1 | 12.04 and 10.46 BTC | bid 8.536 at 87110.00, ask 0.633 at 87110.10 |
| `E-BTC-USDT` run 2 | 0.0001 BTC | bid `"46386"` at 87091.1, ask `"74556"` at 87091.3 | 4.64 and 7.46 BTC | bid 5.021 at 87078.40, ask 26.003 at 87078.50 |
| `E-IOTX-USDT` run 1 | 10 IOTX | bid `"6213"` at 0.003869, ask `"2436"` at 0.003874 | 62,130 and 24,360 IOTX | bid 7,988 at 0.0038720, ask 13,179 at 0.0038730 |
| `E-IOTX-USDT` run 2 | 10 IOTX | bid `"1258"` at 0.003886, ask `"852"` at 0.003892 | 12,580 and 8,520 IOTX | bid 53,456 at 0.0038850, ask 13,179 at 0.0038890 |

The size is a count of contracts, and one contract is `multiplier` units of `multiplierCoin`, see [`rest.md`](./rest.md) section 2.
That is the inference the coin column makes, and it gives touch depth of the same order as Binance's.
The Bitbaby book is its last frame, up to 600 ms old, and the Binance read took 107 to 188 ms, so the two columns are not simultaneous.
In run 1 the BTC touch prices matched Binance to the cent, and in run 2 Bitbaby sat 12.7 dollars higher, so the book is not a plain copy of Binance.

### One-sided and empty books

None was seen.
The seven streams of the book runs always held 40 by 40, and all 358 contracts delivered frames in the batch runs, which did not count levels.
What the channel sends for an empty side is Not verified.

### Idle repeats

None.
A quiet book sends no frame, and IOTX went up to 3.6 s without one.

### Unknown, wrong step and closed symbols

| request | reply | then |
|---|---|---|
| `market_e_nopeusdt_depth_0.1` | nothing | 0 frames in 2 s, socket stays open |
| `market_e_btcusdt_depth_0.01`, a step not in `depthList` | nothing | 0 frames in 2 s |
| `market_e_btcusdt_depth_step0` | nothing | 0 frames in 2 s |
| the same valid channel twice | a second `eventResp` frame with a whole book | one stream, not two |
| text that is not JSON, `hello` | nothing | the stream keeps delivering |
| unknown event, `{"event":"nope",…}` | nothing | the stream keeps delivering |
| `{"event":"unsub",…}` | nothing | 0 frames in the next 4 s |

No closed or delisted contract was available, since the catalog lists only live contracts.
Because an unserved channel gets no reply at all, the feed has to notice a stream with no first frame on its own.

## 5. Session

| item | probed |
|---|---|
| keepalive | the server sends `{"ts":"2026-09-23T04:39:44Z","ping":1790138384}` every 10.0 s on every socket, the first 1.4 to 7.5 s after open. No protocol ping in any run. The client answers `{"pong":1790138384}`. The web app also sends its own `{"ping":<Date.now()>}` every 5 s, S1, and whether the server answers that was not probed |
| silence the server tolerates | a socket with no subscription closed 20.0 s after its first server ping whether or not it answered, at 21.4 to 27.5 s after open, four sockets over two runs, code 1006 and no close frame. A subscribed socket that never answered closed at 65.7 and 66.1 s, 10 s after its sixth unanswered ping, code 1006. A subscribed socket that answered every ping stayed open for the full 120 s, P3 |
| forced disconnect | none in 120 s |
| maintenance notice | none seen, and the bundle handles none |
| compression | without a query every frame is text JSON. With `compress=1` every frame is binary: a zlib stream, header `78 9c`, flushed without its trailer, which `zlib.inflateSync` rejects unless `finishFlush` is `Z_SYNC_FLUSH`. A client that offered permessage-deflate got no `sec-websocket-extensions` header back in two runs, P5 |
| handshake | 436 to 801 ms to open over all runs |
| client close | a client close frame got a 1005 close in run 1 and a dropped connection, 1006, in run 2 |
| subscription limits | none published, and 358 streams on one socket were accepted |
| throughput, 358 depth streams on one socket | 447 and 472 frames per second on average, p50 441 and 461, peak 642 and 744. 574 and 604 KB per second on the wire compressed, 1,470 and 1,550 KB per second inflated. 1,312 to 1,314 bytes per frame compressed, 3,364 to 3,368 inflated. 50 and 61 µs per frame to inflate and `JSON.parse`, P2 |
| throughput, 358 ticker streams on one socket | 215 and 237 frames per second, 74 and 81 KB per second compressed, P6 |

In the batch, compression cut the wire from 1,550 to 604 KB per second and from 1,470 to 574 KB in the rerun, about 2.6 times, at the cost of an inflate per frame.
The engine refuses permessage-deflate at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81, and that does not matter here, because the uncompressed mode is plain text.

## 6. Captured frames

Trimmed, from the second book run at 04:39 UTC.
Arrays marked `…` are cut.

Subscribe.

```json
{"event": "sub", "params": {"channel": "market_e_iotxusdt_depth_0.000001", "cb_id": "3"}}
```

First frame after the subscribe, three of 40 levels per side kept.

```json
{"eventResp":"sub","channel":"market_e_iotxusdt_depth_0.000001","tick":{"asks":[["0.003894","2117","2117","8.243598"],["0.003895","1416","3533","13.758918"],["0.003896","1620","5153","20.070438"]],"bids":[["0.003888","3743","3743","14.552784"],["0.003886","7760","11503","44.708144"],["0.003884","9607","21110","82.021732"]],"ts":"2026-09-23T04:39:42Z"},"ts":"2026-09-23T04:39:42Z"}
```

A later frame is the same without `eventResp`, from the first exploration at 04:18 UTC, cut to two asks.
The exploration printed only the first 400 characters, so the bids and the times are not quoted.

```text
{"channel":"market_e_btcusdt_depth_0.1","tick":{"asks":[["86776.4","110775","110775","9612655710.0"],["86776.6","25141","135916","11794306210.6"],…
```

Keepalive.

```json
{"ts":"2026-09-23T04:39:44Z","ping":1790138384}
```

```json
{"pong": 1790138384}
```

Ticker, which carries the anchor fields.

```json
{"eventResp":"sub","channel":"market_e_btcusdt","tick":{"symbol":"E_BTCUSDT","open":"85530.6","close":"87088.3","amount":"5882448057779.3","vol":"68332673","piece":"0","high":"87257.7","low":"85075","rose":"1.8234814746","rose7d":"14.7431108652","rose1h":"0.4432321462","rose4h":"0.7420748946","rose24h":"1.8234814746","timestamp":1790138382,"utime":"2026-09-23T04:39:42Z","base":"BTC","quote":"USDT","sign_price":"87077.9571428571428571","index_price":"87088.6714285714285714","funding_rate_last":"0.0000800000000000","funding_rate_next":"0.0000800000000000","ts":1790138382000,"admin_fund_rate_source":"\"third\"","last_fund_rate_third":"0.00004307"},"ts":"2026-09-23T04:39:42Z"}
```

Errors produce no frame, so there is nothing to quote.

## 7. Private channels

The bundle's socket event enum is `sub`, `unsub`, `unsub_market`, `login`, `logout` and `ping`, S1.
Private channels sit behind `login` on the same URLs, and their names were not read.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
It rests on an undocumented web socket, so it can change without notice, see [`rest.md`](./rest.md) section 8.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://web-api.bitbaby.com/futures/ws` without a query | one URL serves both families, and without `compress` the frames are text |
| channel | `market_<subSymbol>_depth_<depthList[0]>` | 40 levels at the price tick, a whole book per frame |
| markets per connection | 358, all on one socket, or two sockets of 179 for isolation | 358 streams ran at 447 to 472 frames per second with every stream delivering, and no cap is published |
| subscribe frames | one frame per market, `{"event":"sub","params":{"channel":"…","cb_id":"<n>"}}` | the bundle sends one channel per frame, and multi channel frames were not tried |
| keepalive | answer every `{"ping":n}` with `{"pong":n}` | a subscribed socket that never answers is closed at 66 s |
| `maxSilenceMs` | 30,000 | the server pings every 10 s, so the ping is the traffic the watch relies on, and three missed pings is a dead socket |
| routing | `channel.slice(7, channel.indexOf('_depth_'))` gives the `subSymbol`, then a map to `rawMarketId` | the channel wraps the lowercase `subSymbol` |
| snapshot | every frame: `resetBook` with the 40 bids and 40 asks, then `publish` | no deltas exist |
| resync | none on the wire. Log a stream with no first frame 5 s after its subscribe | unknown and wrong step channels get no reply |
| receive time | stamp on arrival, never from `ts` | `ts` has whole second resolution |
| sizes | `Number()` of the string, times `multiplier` through `contractSize` | contracts of `multiplier` coins |
| deflate | keep `perMessageDeflate: false` and do not send `compress=1` | text mode avoids an inflate per frame |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bitbaby web app JavaScript bundle, chunks from the home, futures and VIP pages | https://static.bitbaby.com/_next/static/chunks/ | 2026-09-22 | Bitbaby | socket URLs, `compress=1` with pako inflate, `{ping: Date.now()}` heartbeat every 5 s from the client, channel name builders, event enum, sections 1, 2, 3 and 7 |
| P1 | `ws-probe.mjs book`, runs at 04:25 and 04:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbaby/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 6 |
| P2 | `ws-probe.mjs batch`, runs at 04:30 and 04:41 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbaby/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | 358 streams on one socket, sections 3 to 5 |
| P3 | `ws-probe.mjs silence`, runs at 04:27 and 04:28 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbaby/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | keepalive and silence, section 5 |
| P4 | `rest-probe.mjs catalog`, runs at 04:32, 04:38, 04:44 and 04:49 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bitbaby/rest-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | configured `wsUrl` certificate, `depthList` against the tick, sections 1 and 2 |
| P5 | `ws-probe.mjs deflate`, runs at 04:32 and 04:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbaby/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | no permessage-deflate, section 5 |
| P6 | `ws-probe.mjs tickers`, runs at 04:34 and 04:42 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bitbaby/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | ticker cadence and throughput, sections 2 and 5 |
