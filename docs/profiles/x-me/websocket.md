# x.me WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-23 06:39 to 07:05 UTC, which is the evening of 2026-09-22 in Seattle, from the development host near Seattle through its Surfshark WireGuard tunnel, whose exit geolocates to Canada.

This profile covers the public futures WebSocket of x.me for its one perpetual family, USDT-M, with the book channel in detail.
x.me publishes no WebSocket documentation that this research could find, see [`fees.md`](./fees.md) section 1, so the "documented" column below names what the website's own code and configuration say, and every other claim was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/x-me/ws-probe.mjs).
The socket has the ChainUp shape that the FameEX and Bittime profiles found, see [`../fameex/websocket.md`](../fameex/websocket.md) and [`../bittime/websocket.md`](../bittime/websocket.md), and nothing below is taken from those venues without a probe here.

## 1. Endpoints

| family | URL | where the URL comes from | probed |
|---|---|---|---|
| USDT-M perpetuals | `wss://futuresws.x.me/kline-api/ws` | `"wsUrl": "wss://futuresws.x.me/kline-api/ws"` in the website's `POST https://www.x.me/fe-co-api/common/public_info`, W2. The home page bundle builds the same name by swapping `www.` for `futuresws.` in the page's host and appending `/kline-api/ws`, W1 | 101 in 745 to 1,068 ms over four opens, server `TencentEdgeOne`, all 266 active contracts deliver |
| spot | `wss://ws.x.me/kline-api/ws` | the same bundle rule with `ws.`, W1. The website's `public_info_v4` names a mirror, `wss://ws.xme.news/kline-api/ws`, W3 | 101 in 780 and 1,028 ms, `market_btcusdt_depth_step0` delivered 9 and 12 frames in 8 s |

There is one perpetual family, so one URL serves every perpetual.
Every access result here is what the Canadian VPN exit received, and no upgrade was refused.
`futuresws.x.me` resolved to `43.169.25.48` through the CNAME `futuresws.x.me.eo.dnse5.com`, a Tencent Cloud EdgeOne name, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | payload | probed on 2026-09-23 |
|---|---|---|
| `market_<sym>_depth_step0` | `{"event": "sub", "params": {"channel": "market_e_btcusdt_depth_step0", "cb_id": "1"}}` | a whole 30 level book per side every 500 ms, recommended |
| `market_<sym>_depth_step1` | same shape | a book aggregated to whole USDT on BTC, 6 frames in 2.5 s |
| `market_<sym>_depth_step5` | same shape | one frame with empty `asks` and `buys`, then nothing |
| `market_<sym>_ticker` | same shape | about one frame a second on BTC, 46 and 44 in 45 s. Carries `mark`, `index` and `funds_rate` as strings, with `amount`, `vol`, `high`, `low`, `open`, `close` and `rose` |
| `market_<sym>_trade_ticker` | same shape | 45 and 43 frames in 45 s on BTC, each a list of trades with `price`, `vol`, `side`, `ts` and `ds` |
| `review` | same shape | nothing in 45 s |
| best bid and ask, mark, index or funding alone | | no such channel was found |

`<sym>` is the website's `subSymbol`, `e_` plus the lower case base plus `usdt`, as in `e_btcusdt`.
It equalled that rule on 266 of 266 active contracts, including `e_1000satsusdt` and `e_1mbabydogeusdt`, see [`rest.md`](./rest.md) section 2.
The ticker channel is the only socket source of mark, index and funding rate, and its use as an anchor is measured in section 5 and weighed in [`rest.md`](./rest.md) section 8.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
"Not documented" means x.me publishes nothing on the point.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one futures URL and one spot URL, W1 and W2 | one futures family, so no split beyond futures and spot |
| subscribe frame shape | not documented | `{"event":"sub","params":{"channel":…,"cb_id":…}}`, one channel per frame, 266 frames sent in 2 to 3 ms on one socket were all served |
| unknown symbol expectation | not documented | one frame with `"tick":{"asks":[],"buys":[]}` and `"status":"ok"`, then silence. An unknown channel suffix gets no frame at all |
| chunk unit and budget | not documented | 266 channels on one socket, every one delivering 79 to 81 frames in 40 s |
| keepalive mechanism | not documented | the server sends `{"ping":<Unix seconds>}` every 10 s, gzip in a binary frame, on a subscribed socket only. A socket that never answered stayed open for 100 s |
| connection lifetime and maintenance notice | not documented | no forced close in 100 s. The help centre posts maintenance as articles, such as "x.me Platform-Wide Server Upgrade and Maintenance Notice" |
| handshake and operation rate limits | not documented | no refusal. Opens took 745 to 1,068 ms |
| public market data authentication | none | none |
| message parse and routing | not documented | every frame is gzip inside a binary WebSocket frame. Route on `channel`, then read `tick` |
| subscribe acknowledgement shape | not documented | none. The first book arrives 283 to 294 ms after the subscribe frame with no ack before it |
| symbol identifier format | not documented | `e_btcusdt` in the channel against `E-BTC-USDT` in the REST catalog, so the feed maps one to the other |
| number representation | not documented | book prices and sizes are JSON numbers. Ticker fields are strings |
| timestamp representation | not documented | envelope `ts` in Unix ms, no time inside `tick`. The first frame after a subscribe carried a `ts` on a whole second, such as `1790145740000` |
| size unit | not documented | contracts of `multiplier` coins, integers on the wire, section 4 |
| sequence semantics | none | no sequence, no update id, no checksum. Every frame is a whole book |
| idle repeat behaviour | not documented | a quiet book is resent unchanged every 500 ms: 42 of 91 TRX frames and 61 of 91 DOS frames equalled the frame before, and 33 of 92 and 58 of 91 in the rerun |

## 4. The book channel in detail

`market_<sym>_depth_step0` is the channel this profile recommends, and every row below is about it unless it says otherwise.

### Snapshot on subscribe, and every frame after it

Every frame is a whole book.
There is no delta, so a feed replaces its book on every frame.
In two `book` runs of 45 s, BTC, ETH, TRX and DOS each got 91 or 92 frames, with the first 283 to 294 ms after the subscribe frame and a median gap of 500 ms, p90 502 to 506 ms and max 518 to 562 ms.
In two `batch` runs, all 266 active contracts got 79 to 81 frames in 40 s, so the 500 ms push holds for quiet and busy contracts alike.

### Sequence and gap rule

None exists, so no gap can be detected and none needs repair.
The feed's only failure signal is silence.

### Checksum

None.

### Level order on the wire

| frame | bids, key `buys` | asks, key `asks` |
|---|---|---|
| socket book | best first, descending, on every frame of four contracts | best first, ascending, on every frame of four contracts |
| REST `GET /fapi/v1/depth` | descending at every limit tried | ascending |

### Level window

Every frame of the four contracts held exactly 30 bids and 30 asks.
The REST book also stops at 30 per side whatever `limit` asks for, see [`rest.md`](./rest.md) section 5.
On BTC the 30 levels are not contiguous.
In the first captured BTC frame the 20 asks nearest the touch sat 0.1 or 0.2 USDT apart with sizes of 28 to 2,725 contracts, and the other 10 formed a ladder 0.6 to 5 USDT apart with sizes of 50,431 to 126,951, such as `[86529.7,67653]` and `[86532,60648]`.

### Size unit

Sizes are integer contracts, and one contract is `multiplier` coins of the base, from `GET /fapi/v1/contracts`.

| contract | `multiplier` | touch on the socket | in coins |
|---|---:|---|---|
| `E-BTC-USDT` | 0.001 | bid `[86521.9,21476]` | 21.476 BTC |
| `E-ETH-USDT` | 0.01 | bid `[2758.39,12983]` | 129.83 ETH |
| `E-TRX-USDT` | 100 | bid `[0.34395,254]` | 25,400 TRX |
| `E-DOS-USDT` | 1 | bid `[0.225,11787]` | 11,787 DOS |

The unit is an inference, and it is a firm one: read as coins, the BTC touch would be 21,476 BTC, about 1.86 billion USD, and `minOrderVolume` is 1 on BTC, which only makes sense as one contract of 0.001 BTC.
The socket and the REST book agree: a REST read of BTC 163 ms after the last socket frame shared 57 prices with it, and 54 of those had the same size, and in the rerun a read 14 ms after the frame shared 59 prices, 57 with the same size.
No CCXT class exists, so a catalog written for x.me would set `contractSize` from `multiplier`, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

No active contract showed a one-sided or crossed book in any frame.
An unknown symbol and `depth_step5` each answered with one frame whose `asks` and `buys` were both empty, then nothing.
A closed contract, `E-XTZ-USDT` with `status` 0, answered with one full book and then nothing in 4 s, so a closed contract is served once and never refreshed.

### Unknown, closed and malformed requests

| request | reply | then |
|---|---|---|
| `market_e_nopeusdt_depth_step0` | one frame with an empty book and `"status":"ok"` | nothing in 4 s |
| `market_e_xtzusdt_depth_step0`, a closed contract | one full book | nothing in 4 s |
| `market_E_BTCUSDT_depth_step0`, upper case | one frame with an empty book | nothing in 3 s |
| `market_e_btcusdt_nope` | nothing | |
| text that is not JSON | nothing | the socket stays open |
| `{"event":"nope",…}` | the frame echoed back verbatim | |
| `{"event":"req",…}` for the book | nothing in 3 s | |
| the same book twice with two `cb_id` values | 10 book frames in 4 s, not the 16 a doubled stream would send | |
| `unsub` of the first `cb_id` | 0 frames in the next 3 s, so one `unsub` ends the channel for both | |

## 5. Session

| item | probed |
|---|---|
| keepalive | the server sends `{"ping":1790145749}`, Unix seconds, every 10 s on a subscribed socket, with the first 3.4 to 9.9 s after the open: at 8.8, 18.8, … 98.8 s on one socket and 9.9, 19.9, … 99.9 s on another. The client answer is `{"pong":<same number>}`, which the FameEX profile found to be the working keepalive on the same platform, see [`../fameex/websocket.md`](../fameex/websocket.md) |
| silence the server tolerates | a subscribed socket that never answered a ping stayed open for the full 100 s. An unsubscribed socket that sent nothing received no ping and closed at 60.9 s, and at 60.8 s in the rerun, with code 1006 and no close frame |
| forced disconnect | none in 100 s |
| maintenance notice | none on the socket |
| compression | every server frame is gzip inside a binary frame, 0 text frames. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, so the server does not negotiate it |
| handshake | 745 to 1,068 ms to open, through Tencent EdgeOne |
| subscription limits | none reached at 266 channels on one socket |
| throughput, book | 266 channels: 532.3 and 532.7 frames per second on average in two runs, median 532 and peak 908 and 685 in a second, 241,928 and 242,163 bytes per second, 455 bytes per frame, gunzip plus `JSON.parse` 26.8 and 45 µs median and 60.1 and 88.6 µs p90 |
| throughput, ticker | 266 ticker channels: 167.7 and 184.3 frames per second, 215 bytes per frame |
| ticker cadence | every one of 266 ticker channels sent 20 to 41 frames in 40 s in both runs. The gap between frames of one channel had a median of 1,801 and 1,199 ms, p90 2,998 and 2,447 ms and p99 4,002 and 4,000 ms, and the longest gap of any channel was 4,178 and 4,545 ms. Mark changed a median 3 and 4 times per channel in 40 s, index 2 and 5 times and `funds_rate` 0 times, and no mark was 0 |
| book age | the envelope `ts` sat 155 to 205 ms before local arrival on steady frames over two runs, and up to 638 and 989 ms on the first frame, whose `ts` falls on a whole second. The venue's clock read a median 4 ms from this host's in the rerun, see [`rest.md`](./rest.md) section 7, so about 0.16 to 0.2 s is transit and stamping |

## 6. Captured frames

Trimmed from the `book` and `errors` runs of 06:42 and 06:43 UTC on 2026-09-23, after gunzip.
Each book keeps its first three levels per side.

Subscribe.

```json
{"event": "sub", "params": {"channel": "market_e_btcusdt_depth_step0", "cb_id": "E-BTC-USDT"}}
```

First book, which arrived 289 ms after the subscribe with no ack before it.

```json
{"event_rep":"","channel":"market_e_btcusdt_depth_step0","data":null,"tick":{"asks":[[86522,2725],[86522.1,205],[86522.3,28]],"buys":[[86521.9,21476],[86521.8,1417],[86521.7,75]]},"ts":1790145740000,"status":"ok"}
```

A thin contract's book.

```json
{"event_rep":"","channel":"market_e_dosusdt_depth_step0","data":null,"tick":{"asks":[[0.2254,11364],[0.2255,5414],[0.2256,7688]],"buys":[[0.225,11787],[0.2249,8591],[0.2248,10431]]},"ts":1790145740000,"status":"ok"}
```

Ticker, which carries mark, index and funding rate.

```json
{"event_rep":"","channel":"market_e_btcusdt_ticker","data":null,"tick":{"mark":"86534.8","index":"86536.4","amount":"6947460831122","vol":"80596849","high":"87247.3","low":"85141.7","open":"85520.1","close":"86522","rose":"0.0117","funds_rate":"-0.00011225"},"ts":1790145740217,"status":"ok"}
```

Server ping, and the answer the probe sent.

```json
{"ping":1790145749}
```

```json
{"pong":1790145749}
```

Unknown symbol.

```json
{"event_rep":"","channel":"market_e_nopeusdt_depth_step0","data":null,"tick":{"asks":[],"buys":[]},"ts":1790145799000,"status":"ok"}
```

Unknown event, echoed back.

```json
{"event":"nope","params":{"channel":"market_e_btcusdt_depth_step0","cb_id":"1"}}
```

## 7. Private channels

Not publicly specified.
The website's futures bundle names private REST calls under `https://www.x.me/fe-co-api/` and `/egw/private/`, such as `private/futures/order/batch/market_close`, W4, and users can create API keys on a `/my/apiManagement` page, but no private socket channel name was found in the bundles read.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://futuresws.x.me/kline-api/ws` | one perpetual family |
| channel | `market_<subSymbol>_depth_step0`, with `subSymbol` = `e_` + lower case base + `usdt` from `rawMarketId` `E-<BASE>-USDT` | the rule held on 266 of 266 |
| markets per connection | 133, two connections for the 266 active contracts | 266 on one socket ran at 532 frames per second with every channel served, and halving it leaves headroom that no published limit settles |
| subscribe frames | one `{"event":"sub","params":{"channel":…,"cb_id":…}}` per market | one channel per frame is the only shape probed |
| decode | gunzip every binary frame before `JSON.parse` | every frame is gzip, and permessage-deflate stays refused as the engine does at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81 |
| keepalive | answer each `{"ping":<n>}` with `{"pong":<n>}`, and send nothing else | the server drives the ping, and an unanswered socket survived 100 s, so answering is insurance rather than a proven need |
| `maxSilenceMs` | 5,000 | every active contract pushes every 500 ms, so ten missed pushes is a dead socket |
| routing | `channel.slice(7, channel.lastIndexOf('_depth_step0'))` gives `subSymbol`, mapped back to `rawMarketId` | the channel wraps the socket symbol |
| every frame | `resetBook` with the 30 levels, then `publish` | each frame is a whole book, and the engine holds 20 levels |
| resync | on silence only | there is no sequence to break |
| idle repeats | skip `publish` when a frame's text equals the last one for that channel | 33 to 61 of about 91 frames on the quiet TRX and DOS books repeated the one before |
| empty frame | treat a first frame with both sides empty as an unserved stream and log it | an unknown or malformed channel answers that way and then stays silent |
| closed contract | drop contracts with `status` 0 before subscribing | a closed contract is served once and never refreshed |
| receive time | stamp on arrival, never from `ts` | the first frame carries a `ts` rounded to the second |
| staleness | note that the view is up to 500 ms plus transit behind the venue's book | the push is a timer, not a change stream |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| W1 | x.me home page bundle `main.bf0b327d.js`, module 4709 | https://static.xmestatic.com/newweb/static/js/main.bf0b327d.js | 2026-09-23 06:40 UTC | x.me | the `ws.` and `futuresws.` host rule and the `/kline-api/ws` path, section 1 |
| W2 | `POST https://www.x.me/fe-co-api/common/public_info` | https://www.x.me/fe-co-api/common/public_info | 2026-09-23 06:47 UTC | x.me | `wsUrl`, `subSymbol`, section 1 and 2 |
| W3 | `POST https://www.x.me/fe-ex-api/common/public_info_v4` | https://www.x.me/fe-ex-api/common/public_info_v4 | 2026-09-23 06:45 UTC | x.me | the spot mirror `ws.xme.news`, section 1 |
| W4 | x.me futures page bundles, `chunk-common~4eda4e2e.9c0f8842.js` and the other `chunk-common` files listed by `https://www.x.me/en_US/futures/E-BTC-USDT` | https://static.xmestatic.com/exchange-web/js/chunk-common~4eda4e2e.9c0f8842.js | 2026-09-23 06:47 UTC | x.me | the website's API map, section 7 |
| P1 | `ws-probe.mjs book` at 06:42 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/x-me/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 2 to 6 |
| P2 | `ws-probe.mjs errors` at 06:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/x-me/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | sections 2 to 4 and 6 |
| P3 | `ws-probe.mjs batch` at 06:44 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/x-me/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | 266 channels on one socket, section 5 |
| P4 | `ws-probe.mjs tickers` at 06:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/x-me/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | ticker cadence on 266 channels, section 5 |
| P5 | `ws-probe.mjs silence` at 06:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/x-me/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | pings and silence, section 5 |
| P6 | `ws-probe.mjs deflate` and `spot` at 06:47 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/x-me/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | compression and the spot socket, sections 1 and 5 |
| P7 | second pass, every mode rerun once from 07:00 to 07:05 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/x-me/ws-probe.mjs) | 2026-09-23 | this host, Canadian VPN exit | the second reading of every number in sections 1 to 5 |
