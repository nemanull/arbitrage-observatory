# ZebPay WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 04:12 to 04:45 UTC, from the development host near Seattle, whose traffic leaves through a Surfshark WireGuard exit that geolocates to Canada (Cloudflare `loc=CA`, SEA edge).

This profile covers the public market data socket of ZebPay perpetual futures, with the book channel in detail.
ZebPay documents only a private futures socket, S1.
The public socket below is the one the zebpay.com futures web app opens, found in its script bundle, S2, and every claim about it comes from [`ws-probe.mjs`](../../../scripts/probes/venues/zebpay/ws-probe.mjs).
Its book frames are Binance USD-M `depth20@100ms` frames with each side moved away from the touch, section 4.
Where the documentation and the wire disagree, both are written.

## 1. Endpoints

| family | URL | documented | probed |
|---|---|---|---|
| all perpetuals, USDT and INR, public | `wss://futuresws.zebpay.com/socket.io/?EIO=4&transport=websocket` | no, named `wss://futuresws.zebpay.com` in the web app bundle, S2 | Socket.IO 4 over Engine.IO 4, open in 715 to 1,150 ms, P1 and P5 |
| private account events | `https://sp-futuresws.zebpay.com/auth-stream`, Socket.IO namespace `/auth-stream` | yes, S1 | not probed |
| spot | none | no spot socket is documented or named in the bundle | not probed |

One socket carries both quote families: `btcusdt@depth_0.1` and `btcinr@depth_0.1` delivered on the same socket, P1.
The host resolved to four IPv4 addresses in CloudFront ranges, see [`rest.md`](./rest.md) section 1, and the upgrade reply set AWS load balancer cookies, P5.
The bare host `wss://futuresws.zebpay.com` answered the upgrade with HTTP 502, P3.
`EIO=3` opened a socket that sent no frame in 4 s, P3.

## 2. Channel matrix for public market data

| stream or event | how | payload | probed |
|---|---|---|---|
| `<pair>@depth_<grouping>` | `42["subscribe",{"params":[...]}]` | event `depthUpdate`, 20 bids and 20 asks, Binance fields `E`, `T`, `U`, `u`, `pu` | every frame a full 20 level window, one every 500 ms on a busy pair, P1 |
| `<pair>@markPrice` | same | event `markPriceUpdate`: mark `p`, index `i`, estimated settle `P`, funding `r`, next funding `T`, last rate `lr`, `ap`, `st` | one frame per second on the Binance 1 s grid, P1 |
| `<pair>@ticker` | same | event `24hrTicker`, Binance fields | 29 to 31 frames in about 60 s on BTC, P1 |
| `<pair>@aggTrade` | same | event `aggTrade`, Binance fields plus `nq` and `st` | seen in the first exploratory connect, P5 |
| `allContractDetails` | pushed to every socket that joined `/`, with no subscription | map of 592 pairs to `lastPrice`, `marketPrice`, `upcomingFundingRate`, `priceChangePercent`, `baseAssetVolume`, `quoteAssetVolume` | 57 to 60 frames a minute, 109 KB each, P1 |
| kline streams for last and mark price | in the chart code, S2 | not extracted | not probed |

The web app subscribes `<pair>@ticker`, `<pair>@markPrice`, `<pair>@aggTrade` and `<pair>@depth_<grouping>` for the open pair, where the pair is lower case and the grouping is the pair's first `depthGrouping` value from `GET /api/v1/exchange/exchangeInfo`, S2.
The grouping does not change the frame: `btcusdt@depth_1` and `btcusdt@depth_10` delivered 20 levels with 504 of 560 prices off the 1 grid and 557 to 560 of 560 off the 10 grid, and `ethusdt@depth20` and `ethusdt@depth` delivered too, P1.
There is no bulk book stream.
The mark stream carries an index and a next funding time, which the REST bulk call lacks, see [`rest.md`](./rest.md) section 3.
Its `p`, `i` and `P` equalled Binance's mark, index and estimated settle price rounded up to the tick at the same `E` on 5 of 5 reads, and `ap` carries Binance's unrounded mark, see [`rest.md`](./rest.md) section 4.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | Not publicly specified, the public socket is undocumented | one URL for USDT and INR pairs, section 1 |
| subscribe frame shape | Not publicly specified. The bundle emits `subscribe` with `{params: [stream, …]}`, S2 | Engine.IO open `0{…}`, then the client sends `40`, then `42["subscribe",{"params":["btcusdt@depth_0.1", …]}]`. 425 streams in one frame all delivered, P2 |
| unknown symbol expectation | Not publicly specified | `nopeusdt@depth_0.1` and the inactive `aiainr@depth_1` got no reply and no frame in 8 s. An unknown event name got nothing either, P1 |
| chunk unit and budget | Engine.IO `maxPayload` 1,000,000 bytes, from the handshake | 425 streams in one 42 frame on one socket, P2 |
| keepalive mechanism | Engine.IO 4: the server sends `2` every `pingInterval` 25,000 ms and expects `3` within `pingTimeout` 20,000 ms, from the handshake | pings at 25.6 to 25.8 s, 50.9 to 51.0 s and 76.1 s. A socket that did not answer closed at 45.7 s, P1 and P3 |
| connection lifetime and maintenance notice | Not publicly specified | no forced close in 90 s, no notice event seen |
| handshake and operation rate limits | Not publicly specified | eight variant sockets opened in parallel beside the main socket, all served, P1 and P4 |
| public market data authentication | none | none |
| message parse and routing | Not publicly specified | text frame `42` followed by a JSON array `[event, payload]`, routed on `payload.s` |
| subscribe acknowledgement shape | Not publicly specified | none: a subscribe carrying an ack id got no `43` reply, and the first `depthUpdate` is the only sign of success, P1 |
| symbol identifier format | lower case pair in the stream name, S2 | `s` is upper case, `BTCUSDT` and `BTCINR`, equal to CCXT `market.id`. An upper case stream name `SOLUSDT@depth_0.01` was served too, P1 |
| number representation | Not publicly specified | prices and sizes as strings in `depthUpdate`, P1 |
| timestamp representation | Not publicly specified | `E` and `T` in integer ms, equal to Binance's own `E` and `T` for the same frame, section 4 |
| size unit | Not publicly specified | base coin, identical to Binance's size at the same level, section 4 |
| sequence semantics | Not publicly specified | `U`, `u` and `pu` are Binance's ids. `pu` equals the previous frame's `u` on 0 of 112 BTC frames, so no gap rule exists, section 4 |
| idle repeat behaviour | Not publicly specified | no frame repeated a `u`. A quiet pair sends nothing, and `ENJUSDT` and `MMTUSDT` went up to about 5 s without a frame, P1 and P4 |

## 4. The book channel in detail

`<pair>@depth_<grouping>` is the only book stream, and every row below is about it.

### What a frame is

Every `depthUpdate` held exactly 20 bids and 20 asks, on all 1,682 frames of three book runs over six pairs, P1 and P4.
So each frame is a whole window, and a feed replaces the book on every frame.
The first frame arrives with no subscribe reply, and there is no separate snapshot event.

### The frames are Binance's

Binance's own `btcusdt@depth20@100ms` and `ethusdt@depth20@100ms` ran beside the ZebPay socket, and every ZebPay frame was matched to a Binance frame by `u` or by `E`, P1 and P4.
The two readings of each cell are the run at 04:27 and the rerun at 04:40.

| pair | ZebPay frames | matched to Binance `@100ms` | same `E` | same bid size set | ZebPay arrival minus Binance arrival |
|---|---:|---:|---:|---:|---|
| `BTCUSDT` | 113 and 114 | 112 and 113, the other to `@500ms` | all | 108 and 105 | min 125 and 147, median 227 and 209, p90 305 and 246, max 329 and 581 ms |
| `ETHUSDT` | 114 and 114 | all | all | 100 and 82 | min 148 and 144, median 266 and 209, p90 313 and 247, max 597 and 526 ms |
| `BTCINR`, against Binance `BTCUSDT`, rerun only | 113 | 112, the other to `@500ms` | all | 113 | min 152, median 208, p90 256, max 480 ms |

Binance's own frames reached this host a median 49 to 69 ms after their `E`, and ZebPay's `BTCUSDT` frames a median 248 to 298 ms after the same `E`, over three runs, P1 and P4.
Every `BTCINR` frame was a Binance `BTCUSDT` frame with each price times 95.55 and the sizes unchanged, P4.
ZebPay forwards about one Binance 100 ms frame in five, a median 494 to 501 ms apart on busy pairs, P1 and P4.

### The markup

The bids are Binance's bids moved down and the asks Binance's asks moved up, with the sizes unchanged, P1, P4 and [`rest.md`](./rest.md) section 5.

| pair | best bid, Binance minus ZebPay | best ask, ZebPay minus Binance |
|---|---|---|
| `BTCUSDT`, tick 0.1 | 0.2 on 113 of 113 and 114 of 114 frames | 0.2 on 108 of 113 and 108 of 114, below Binance's ask on 1 of each |
| `ETHUSDT`, tick 0.01 | 0.1 on 110 and 112 of 114 frames | 0.1 on 92 and 77 of 114, below Binance's ask on 12 and 16 |

The offset is a fixed number of ticks per pair, 2 on `BTCUSDT` and 10 on `ETHUSDT`, and the REST book shows 0 to 20 ticks on other pairs, see [`rest.md`](./rest.md) section 5.
A ZebPay best bid was never above Binance's best bid at the same `E`.
A ZebPay best ask sat below Binance's on a few frames, which these probes do not explain.

### Delta semantics and sequence

There are no deltas.
The `U`, `u` and `pu` fields are Binance's diff ids of the forwarded frame, so `pu` does not equal the previous ZebPay frame's `u`: 0 of 112 on `BTCUSDT`, 0 of 113 on `ETHUSDT`, and 14 to 22 on quiet pairs where consecutive Binance frames happened to be forwarded, P1.
The only order check a feed can make is that `u` increases.

### Checksum

None, no frame carries one.

### Level order on the wire

| source | bids | asks |
|---|---|---|
| socket `depthUpdate` | ascending, worst first and best last, on 544 of 544 frames | ascending, best first, on 544 of 544 |
| REST `market/orderBook` | descending, best first | ascending |

The best bid is the last element of `b` on the socket.

### Size unit against CCXT `contractSize`

Sizes are in the base coin: `BTCUSDT` levels read `0.001` to `16.795` BTC, identical to Binance's size at the same level, P1 and [`rest.md`](./rest.md) section 5.
CCXT leaves `contractSize` undefined, and the engine turns that into 1, at [`../../../server/src/ccxt/connector.ts`](../../../server/src/ccxt/connector.ts) lines 175 and 188 to 194, which is the right unit.
`BTCINR` frames carry the same base-coin sizes at INR prices near 95.5 times the USDT price.

### One-sided and empty books

None seen: 0 frames with an empty side across three runs, P1 and P4.

### Idle repeats

None: no frame repeated a `u`.
Quiet pairs stay silent: `ENJUSDT` went up to 2.1, 3.0 and 5.0 s and `MMTUSDT` up to 5.0, 5.0 and 4.0 s without a frame in three runs, P1 and P4.

### Unknown, closed and malformed

| request | reply | then |
|---|---|---|
| `nopeusdt@depth_0.1` | nothing | no frame in 8 s |
| `aiainr@depth_1`, a pair listed with `isActive` false | nothing | no frame in 8 s |
| event `nope` instead of `subscribe` | nothing | no frame in 8 s |
| `42["subscribe"`, a truncated packet | the server closes the socket | 174 and 177 ms after the send, close code 1005, no close frame |
| a JSON array sent without the `42` prefix, which is what VenueFeed's subscribe path sends | the server closes the socket | at 1.07 and 1.12 s, code 1005, no `depthUpdate` |
| `unsubscribe` with the same params | honoured | `ENJUSDT` sent 1 frame after the unsubscribe and then nothing for 24 s |

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Engine.IO 4 ping and pong, `pingInterval` 25,000 and `pingTimeout` 20,000 in the handshake | server `2` at 25.6 to 25.8 s, client `3` keeps the socket, P1 and P3 |
| silence the server tolerates | missed pong closes after `pingTimeout` | a joined socket that did not answer closed at 45.7 s with code 1005, in two runs. A socket that answered pings but never sent `40` also closed at 45.7 s, which matches Socket.IO's default connect timeout of 45 s. A joined socket that answered pings and subscribed nothing stayed open 90 s, P3 and P4 |
| traffic on an idle socket | Not publicly specified | `allContractDetails` about once a second, 88 and 89 events in 90 s with no subscription, P3 and P4 |
| forced disconnect | Not publicly specified | none in 90 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | a client that offered permessage-deflate got no `sec-websocket-extensions` header back, P3 |
| handshake | Engine.IO open packet `0{"sid",…,"upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}` | open in 715 to 1,150 ms, namespace ack `40{"sid":…}` 160 ms later |
| subscription limits | Not publicly specified | 425 streams on one socket, all delivering, P2 |
| throughput | | 425 streams over two 40 s runs: 578 and 638 frames per second, median 580 and 647, peak 679 and 756, 521 and 575 KB per second of book frames, 923 bytes per frame, 26.6 and 31.7 µs `JSON.parse` per frame, plus 109 KB per second of `allContractDetails`, P2 and P4 |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23.
Arrays marked `…` are cut.

Engine.IO open and the namespace join, which the client sends as `40`.

```text
0{"sid":"xZtOR_V78mauwd6FBjal","upgrades":[],"pingInterval":25000,"pingTimeout":20000,"maxPayload":1000000}
40{"sid":"L3IWvPejNXMC6ubIBjam"}
```

Subscribe, as the web app sends it.

```text
42["subscribe",{"params":["btcusdt@ticker","btcusdt@markPrice","btcusdt@aggTrade","btcusdt@depth_0.1"]}]
```

Book frame, first and last two levels per side kept, with the best bid last.

```json
["depthUpdate",{"e":"depthUpdate","E":1790137623802,"T":1790137623801,"s":"ETHUSDT","ps":"ETHUSDT","U":11632890100810,"u":11632890107337,"pu":11632890100695,"b":[["2783.59","6.473"],["2783.6","0.055"],"…",["2783.77","0.076"],["2783.78","145.726"]],"a":[["2783.99","86.560"],["2784","0.958"],"…",["2784.17","0.024"],["2784.18","1.725"]],"st":1}]
```

Mark frames for the USDT pair and its INR twin in the same second.
The INR frame carries the USDT mark in `ap`.

```json
["markPriceUpdate",{"e":"markPriceUpdate","E":1790137623003,"s":"BTCUSDT","p":"87091.3","ap":"87091.27697826","P":"86828.4","i":"87128.2","r":"0.000037215","T":1790150400000,"st":1,"lr":"0.000009189"}]
```

```json
["markPriceUpdate",{"e":"markPriceUpdate","E":1790137623003,"s":"BTCINR","p":"8321572","ap":"87091.27697826","P":"8296453","i":"8325091","r":"0.000045485","T":1790150400000,"st":1,"lr":"0.000011231"}]
```

Ticker.

```json
["24hrTicker",{"e":"24hrTicker","E":1790137623507,"s":"BTCUSDT","ps":"BTCUSDT","p":"1527.7","P":"1.786","w":"86062.6","c":"87079","Q":"0.003","o":"85551.3","h":"87175.8","l":"85080","v":"158719.429","q":"13659800174.5","O":1790051220000,"C":1790137623507,"F":8105937290,"L":8109974659,"n":4021353,"st":1}]
```

Trade, from the exploratory connect.

```json
["aggTrade",{"e":"aggTrade","E":1790137062250,"a":3461873950,"s":"BTCUSDT","p":"86778.7","q":"0.001","nq":"0.001","f":8109912696,"l":8109912696,"T":1790137062147,"m":true,"st":1}]
```

The pushed contract map, two of 592 rows kept.

```json
["allContractDetails",{"METUSDT":{"priceChangePercent":"28.935","baseAssetVolume":"79063498","quoteAssetVolume":"24746358.851","marketPrice":"0.3598","upcomingFundingRate":"0.00005","lastPrice":"0.3594"},"MMTUSDT":{"priceChangePercent":"4.374","baseAssetVolume":"16491290","quoteAssetVolume":"2786418.6451","marketPrice":"0.1742","upcomingFundingRate":"0.00005","lastPrice":"0.174"}}]
```

Keepalive: the server sends `2` and the client answers `3`.
Errors: none is ever sent, section 4.

## 7. Private channels

Named for a future execution stage, from S1, not probed.
The private stream is Socket.IO on `https://sp-futuresws.zebpay.com/auth-stream`, authenticated by API key and HMAC in the Socket.IO `auth` object, confirmed by an `auth.ok` event.
Events: `newOrder`, `orderFilled`, `orderPartiallyFilled`, `orderCancelled`, `orderFailed`, `newPosition`, `updatePosition`, `closePosition`, `autoTopupSuccess`, `autoTopupFailed`, `balanceUpdate`, `newTrade`, `marginCallAlert`, `liquidationAlert`.
Order entry is REST only, and the documentation offers webhooks for new, cancel and close.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
The venue is not recommended for the engine, because this book is Binance's book about 230 ms late with a markup, see [`rest.md`](./rest.md) section 8.
If it were ever added, the feed would look like this.

| item | recommendation | reason |
|---|---|---|
| URL plan | one socket, `wss://futuresws.zebpay.com/socket.io/?EIO=4&transport=websocket` | USDT and INR pairs share it, and 425 streams ran on one socket |
| framing | the subclass sends raw text: `40` after the `0{…}` open packet, then `42["subscribe",{"params":[…]}]` after `40{…}` | VenueFeed sends `JSON.stringify(frame)` at [`../../../server/src/feeds/book/VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) lines 143, 152 and 161, and a JSON frame without the `42` prefix closes the socket. So `getSubscribeFrames` returns an empty list and `handleMessage` drives the join, which is a named change |
| markets per connection | all tracked USDT pairs | 425 streams delivered at 578 to 638 frames per second |
| stream | `<rawMarketId lower case>@depth_<depthGrouping[0]>` | what the web app sends, and the grouping has no effect |
| keepalive | answer every `2` with `3` in `handleMessage`, and `startKeepalive` sends nothing | Engine.IO 4 is server pinged |
| `maxSilenceMs` | 10,000 | `allContractDetails` arrives about once a second on every joined socket, so ten silent seconds is a dead socket |
| routing | `payload.s`, which equals CCXT `market.id` | |
| book | `resetBook` on every `depthUpdate`, with bids reversed to best first | every frame is a full 20 level window, bids ascending |
| sequence | drop a frame whose `u` is not above the last `u`, never `resync` on `pu` | `pu` is Binance's id and does not chain across forwarded frames |
| unserved stream | log a stream with no frame 10 s after the subscribe | unknown and inactive pairs get no reply |
| receive time | stamp on arrival, never from `E` | `E` is Binance's event time, 200 to 700 ms before arrival |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it |
| filter | `market.quote === 'USDT'` | INR pairs are the same Binance book in INR and cluster with no other venue |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | ZebPay API references, futures private WebSocket, commit `1be7da7` of 2026-09-19 | https://github.com/zebpay/zebpay-api-references/tree/main/futures/api-reference/websocket | 2026-09-22 | ZebPay | private URL, auth, event names, sections 1 and 7 |
| S2 | zebpay.com futures web app bundle, build `0Kc68usOOBbT9wHTy5daF`, chunks `_app-38cb1f676d304068.js` and `713-6b36bf27dd6b1c2f.js` | https://zebpay.com/futures/_next/static/chunks/pages/_app-38cb1f676d304068.js | 2026-09-22 | ZebPay | public socket host, subscribe payload, stream names, event names, sections 1 and 2 |
| P1 | `ws-probe.mjs book`, runs at 04:24 and 04:27 UTC, rerun in the second pass | [`ws-probe.mjs`](../../../scripts/probes/venues/zebpay/ws-probe.mjs) | 2026-09-23 | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs batch` at 04:28 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/zebpay/ws-probe.mjs) | 2026-09-23 | this host | 425 streams on one socket, sections 3 and 5 |
| P3 | `ws-probe.mjs silence`, `deflate` and `engineway` at 04:29 to 04:31 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/zebpay/ws-probe.mjs) | 2026-09-23 | this host | keepalive, silence, compression, the engine's framing, sections 1, 4 and 5 |
| P4 | second pass: `ws-probe.mjs book` at 04:40 UTC, then `batch`, `silence`, `deflate` and `engineway` at 04:41 to 04:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/zebpay/ws-probe.mjs) | 2026-09-23 | this host | the second readings, and the `BTCINR` relay row |
| P5 | a 20 s exploratory Socket.IO connect at 04:17 UTC, scratch script not kept | | 2026-09-23 | this host | the first frames, `aggTrade`, the upgrade headers |
