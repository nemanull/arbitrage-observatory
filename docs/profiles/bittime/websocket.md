# Bittime WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 03:15 and 03:44 UTC on 2026-09-23.

This profile covers the public futures WebSocket of Bittime for its one perpetual family, USDT-margined, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bittime/ws-probe.mjs), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Two findings shape everything below.
Every frame is gzip compressed inside a binary WebSocket frame.
The documented socket host and the host the futures web page uses serve two different order books, see section 1.

## 1. Endpoints

| family | URL | source | probed |
|---|---|---|---|
| USDT-M perpetuals, documented | `wss://fmarket-ws.bittime.com/kline-api/ws` | S1 | open in 803 to 882 ms, 49 of 49 contracts deliver |
| USDT-M perpetuals, web page | `wss://futuresws-cfx.bittime.com/kline-api/ws` | the `wsUrl` the web page's `common/public_info` call returns, see [`rest.md`](./rest.md) section 2 | open in 817 to 853 ms, a different book, see below |
| private | `wss://fapiws.bittime.com` | S1 | not probed |
| coin-margined, dated futures | none listed | [`fees.md`](./fees.md) section 3 | |

Both public host names, and `futuresws.bittime.com`, are CNAMEs of one AWS load balancer in `ap-southeast-3`, Jakarta, with three addresses, P6.
One socket carries every USDT-M contract.

The two hosts answer the same subscribe frame with different books.

| stream, three runs on 2026-09-23 | documented host | web page host |
|---|---|---|
| `market_e_btcusdt_depth_step0` levels | 30 bids and 30 asks on every frame | 298 to 301 bids and 92 to 102 asks |
| `market_e_zrxusdt_depth_step0` levels | 30 and 30 | 11 to 12 bids and 6 to 11 asks |
| BTC push interval | median 161 to 205 ms | median 2,996 to 3,002 ms |
| BTC best bid and ask at 03:31:11 UTC | 86,668.9 and 86,669.0 | 86,626.5 and 86,711.5 |
| BTC best bid and ask at 03:42:53 UTC | 86,866.1 and 86,866.2 | 86,826.3 and 86,893.2 |
| BTC ticker `vol` | 562,949,825 and 566,069,747 contracts of 0.00001 BTC, about 5,630 BTC | `1648940.0000` and `1655100.0000`, about 16.5 BTC if the unit is the same contract |
| BTC trades in 20 s | 21 and 23 | 2 and 2 |
| matches the REST book at `fapi.bittime.com` | yes, same touch prices, and 25 to 30 of 30 sizes per side, section 4 | no |

The documented host and the REST API describe a deep book one tick wide, while the web page shows a thin book 67 to 85 USDT wide on BTC.
CoinGecko reports 206.65 BTC of daily volume for all of Bittime's spot pairs, which fits the web page's book far better than the documented one, see [`fees.md`](./fees.md) section 1.
Which of the two books a Bittime order fills against cannot be answered without an account, and it is the first open question for this venue.

## 2. Channel matrix for public market data

| channel | frame | depth and speed | probed |
|---|---|---|---|
| `market_<symbol>_depth_step0` | `{"event": "sub", "params": {"channel": "market_e_btcusdt_depth_step0", "cb_id": ""}}` | "Up to 30 data entries for bid and ask orders", S1 | a full 30-level book on each push, irregular, recommended |
| `market_<symbol>_depth_step<n>` | same | price aggregation steps, the web page reads the allowed steps from `coinResultVo.depth`, such as `["3","2","1"]` | not probed beyond step 9 |
| `market_<symbol>_ticker` | same | 24 h statistics | 66 frames in 55 s and 51 in 40 s on BTC, median gap 854 and 933 ms |
| `market_<symbol>_trade_ticker` | same, and `"event": "req"` for history | trades | 65 frames in 55 s and 50 in 40 s on BTC, one trade each |
| `market_<symbol>_kline_<interval>` | same, and `"event": "req"` for history | `1min` to `1week` | not probed |
| best bid and ask, mark, index, funding | none | | no such channel is documented or used by the web page's bundle |

Symbols are lower case with the settlement joined, `e_btcusdt`, S1.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL for USDT-M, S1 | one URL carries all 49 contracts, and a second host name serves a different book, section 1 |
| subscribe frame shape | `{"event": "sub", "params": {"channel": "market_$symbol_depth_step0", "cb_id": ""}}`, one channel per frame, S1 | 49 frames sent in one burst were all served |
| unknown symbol expectation | Not publicly specified | `market_e_nopeusdt_depth_step0` and `market_E_BTCUSDT_depth_step0` got no reply at all. `market_e_btcusdt_depth_step9` got one frame with empty `asks` and `buys`, `ts` 0 and `status` `ok` |
| chunk unit and budget | "It is not recommended to subscribe to more than 100 streams per single connection", and at most 100 connections per IP, S1 | 49 streams on one socket, no refusal |
| keepalive mechanism | "The WebSocket server sends a Ping message every second. If the WebSocket server does not receive a Pong message response within N seconds, the connection will be terminated (N=1)", pong `{"pong":1721131206}`, S1 | the server sent `{"ping": <Unix s>}` gzip compressed every 9,902 to 10,103 ms. Sockets that never answered stayed open for the full 40 s |
| connection lifetime and maintenance notice | "Each connection has a validity period of no more than 24 hours", S1 | no forced close in any socket, the longest open 56 s |
| handshake and operation rate limits | "If the user's messages exceed the limit, the connection will be terminated. Repeated disconnections from the same IP may result in server blocking.", no number, S1 | no refusal |
| public market data authentication | none | none |
| message parse and routing | gzip, then JSON with `channel`, S1 | `{"event_rep", "channel", "data", "tick", "ts", "status"}`, route on `channel` |
| subscribe acknowledgement shape | Not publicly specified | none. The first data frame is the only sign a subscription took, 269 to 277 ms after the frame was sent. The `cb_id` is never echoed |
| symbol identifier format | `e_btcusdt` | lower case, `E-BTC-USDT` in REST becomes `e_btcusdt`, so not CCXT's `market.id` of a repointed `bitrue` class |
| number representation | numbers in the book example, S1 | book prices and sizes are JSON numbers. Ticker and trade fields are strings |
| timestamp representation | `ts` in ms, "System response timestamp", S1 | integer ms. Book frames arrive a median 534 to 749 ms after their `ts`, ticker and trade frames 151 to 180 ms after theirs |
| size unit | "The amount part needs to be multiplied by the Contract Size", S1 | contracts, equal to the REST book, section 4 |
| sequence semantics | none | none: no update id, no checksum, every push is a whole book |
| idle repeat behaviour | not documented | 1 to 12 byte-identical book repeats per stream per run, and `e_xautusdt` went up to 30 s without a frame |

## 4. The book channel in detail

`market_<symbol>_depth_step0` on the documented host is the channel this section describes.

### Snapshot on subscribe

Every frame is a snapshot.
The first frame arrived 269 to 277 ms after the subscribe frame on every stream of the three book runs, with 30 levels per side.
No frame is a delta, so there is nothing to chain and nothing to miss.

### Delta semantics, sequence and gap rule

None exist.
A frame replaces the book.
A lost frame costs only freshness, since the next one is whole.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids, key `buys` | asks, key `asks` |
|---|---|---|
| every book frame, 1,492 frames over three runs on four contracts | best first, descending, on every frame | best first, ascending, on every frame |
| REST `/fapi/v1/depth` | descending | ascending |

No crossed book was seen.

### Level window

Every frame over both runs and the batch held exactly 30 bids and 30 asks, on contracts from BTC to `E-XAUT-USDT`.
The REST book of BTC held 62 to 82 levels per side, so the socket shows the top 30 of a deeper book.
The engine's 20 levels fit inside it.

### Size unit against CCXT `contractSize`

Sizes are contracts, as the documentation says.
The last socket book of BTC matched the REST book on the same touch prices in three runs, P1.
At identical prices 29, 30 and 26 of 30 bid sizes and 30, 30 and 25 of 30 ask sizes agreed, and the misses come from the book moving between the two reads, since the socket book was 19 to 423 ms old when the REST reply arrived.
One contract of `E-BTC-USDT` is `multiplier` 0.00001 BTC, so the touch of 253,041 contracts in a capture is 2.53 BTC.
A `bitrue` class pointed at Bittime reads `contractSize` equal to `multiplier` on 49 of 49 contracts, see [`rest.md`](./rest.md) section 2.
So the engine's `sizeMul` would convert Bittime sizes correctly.

The web page host's book is in some other unit: `E-ZRX-USDT` sizes there were fractional, such as `17656.8`, on a contract whose `minOrderVolume` is 1.

### One-sided and empty books

No one-sided book was seen on the 49 contracts.
A channel the server does not serve, such as step 9, returns a book with both sides empty and `ts` 0.
A feed that trusted it would reset the book to empty, so a frame with `ts` 0 has to be dropped.

### Idle repeats and push cadence

Three book runs of 55, 55 and 40 s, P1.

| stream | frames | push gap median | push gap max | identical repeats |
|---|---|---|---|---|
| `e_btcusdt` | 263, 186 and 169 | 145, 174 and 168 ms | 1,401, 1,846 and 1,290 ms | 6, 3 and 6 |
| `e_ethusdt` | 257, 213 and 181 | 156, 176 and 158 ms | 1,000, 1,818 and 989 ms | 6, 12 and 3 |
| `e_zrxusdt` | 75, 71 and 61 | 533, 518 and 359 ms | 2,188, 2,188 and 2,151 ms | 1, 2 and 1 |
| `e_xautusdt` | 7, 5 and 4 | 10,850, 12,679 and 5,646 ms | 19,033, 29,986 and 6,137 ms | 2, 2 and 1 |

The server pushes when the book changes, but not only then, since whole books repeat byte for byte.

### Book age at arrival

The `ts` of a book frame was a median 534 to 749 ms before its arrival on this host, with a p90 between about 1,020 and 1,150 ms, on every stream of more than 20 frames in every run.
Ticker and trade frames on the same socket arrived a median 151 to 154 ms and 177 to 180 ms after their own `ts`, and this host's clock agreed with `fapi.bittime.com` within 7 ms, see [`rest.md`](./rest.md) section 7.
So the book frames are stamped about half a second before the ticker frames would be for the same transit, which means the book view is roughly 0.4 to 0.5 s old on arrival.
Whether `ts` marks when the book was cut or when a batch was scheduled is Not publicly specified.

### Unknown, closed and wrong channels

| request | reply |
|---|---|
| `market_e_nopeusdt_depth_step0` | nothing in 35 s |
| `market_E_BTCUSDT_depth_step0` | nothing in 35 s |
| `market_e_btcusdt_depth_step9` | one frame, both sides empty, `ts` 0, `status` `ok` |
| `market_e_btcusdt_depth_step0` twice on one socket | no second stream, the frame count did not double |
| `{"event": "nope", …}` | the same text sent back in a binary frame that is not gzip compressed |
| `not json` | nothing |

All 49 contracts were `status` 1, so a closed contract could not be probed.
Since the server acknowledges nothing, a feed has to notice a stream with no first frame on its own.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | server ping every second, answer with `{"pong": <ts>}` within 1 s, S1 | server ping every 10 s, 9,902 to 10,103 ms apart, first at 3.6 to 6.3 s after open, gzip compressed like data |
| silence the server tolerates | 1 s without a pong, S1 | three sockets, subscribed without pongs, unsubscribed with pongs, unsubscribed without pongs, all still open at 40 s with 4 pings each, in two runs, P2 |
| forced disconnect | after 24 h, S1 | none within 56 s |
| maintenance notice | Not publicly specified | none seen |
| compression | "Data is compressed in binary format except for heartbeat data (users need to decompress using the Gzip algorithm)", S1 | every data frame and every ping is gzip inside a binary frame. A client offering permessage-deflate got no `sec-websocket-extensions` header on either host, P4 |
| handshake | | 803 to 882 ms to open on either host |
| subscription limits | 100 streams per connection advised, 100 connections per IP, S1 | 49 streams on one socket without refusal |
| throughput | | all 49 perpetuals on one socket for 45 s, two runs: 4,879 and 5,861 book frames, median 107 and 125 per second, p90 131 and 162, peak 168 and 252, 436 and 435 bytes per gzip frame against 975 and 981 bytes of JSON, 46 and 55 KB per second on the wire, P3 |
| decode cost | | gunzip and `JSON.parse` together took a median 51 and 52 µs per frame, p90 101 and 116 µs, in the two batch runs, P3 |

The heartbeat is compressed too, despite the documentation's "except for heartbeat data".

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC, each shown after gunzip.
Arrays marked `…` are cut.

Subscribe, as sent.

```json
{"event": "sub", "params": {"channel": "market_e_btcusdt_depth_step0", "cb_id": "cb_market_e_btcusdt_depth_step0"}}
```

There is no acknowledgement.
The first book frame of BTC and of ZRX on one socket at 03:25:42 UTC, three of 30 levels per side kept.

```json
{"event_rep": "", "channel": "market_e_btcusdt_depth_step0", "data": null, "tick": {"asks": [[86669.8, 515110], [86669.9, 297574], [86670, 258642]], "buys": [[86669.7, 187431], [86669.6, 111181], [86669.5, 90557]]}, "ts": 1790133942308, "status": "ok"}
```

```json
{"event_rep": "", "channel": "market_e_zrxusdt_depth_step0", "data": null, "tick": {"asks": [[0.1243, 26152], [0.1244, 29110], [0.1245, 31920]], "buys": [[0.124, 25174], [0.1239, 30392], [0.1238, 26347]]}, "ts": 1790133942123, "status": "ok"}
```

Ping, and the pong a client sends.

```json
{"ping": 1790133947}
```

```json
{"pong": 1790133947}
```

The reply to a step the server does not serve.

```json
{"event_rep": "", "channel": "market_e_btcusdt_depth_step9", "data": null, "tick": {"asks": [], "buys": []}, "ts": 0, "status": "ok"}
```

The echo of an unknown event, which arrived in a binary frame without gzip.

```json
{"event": "nope", "params": {"channel": "market_e_btcusdt_ticker"}}
```

Ticker and trade.

```json
{"event_rep": "", "channel": "market_e_btcusdt_ticker", "data": [], "tick": {"amount": "48471672801524.7828684158", "vol": "563604303", "close": "86735.2", "open": "85373.17897030916", "high": "86814", "low": "85080.2", "rose": "0.01595373", "count": 98735, "idx": 1790047500}, "ts": 1790133854548, "status": "ok"}
```

```json
{"event_rep": "", "channel": "market_e_btcusdt_trade_ticker", "data": [], "tick": {"data": [{"price": "86735.2", "vol": "20", "side": "BUY", "amount": "1734704", "ds": "2026-09-23 10:24:14", "ts": 1790133854505}], "ts": 1790133854505}, "ts": 1790133854548, "status": "ok"}
```

The trade's `ds` is Jakarta time, UTC+7, and its `amount` is `vol` times price, not times the contract size.

## 7. Private channels

Named for a future execution stage, from S1, not probed.
The private socket is `wss://fapiws.bittime.com`, opened with a `listenKey` from `POST /user_stream/api/v1/listenKey`, which lives 60 minutes and is extended by `PUT /user_stream/api/v1/listenKey/{listenKey}`.
The streams carry order and account updates, S1.

## 8. Recommended feed shape

A recommendation for a later design, not a decision, and conditional on the open question of section 1.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://fmarket-ws.bittime.com/kline-api/ws`, if the documented book is the tradable one | the documented host matches the REST API, the web page host does not |
| channel | `market_<socket id>_depth_step0` | 30 levels covers the engine's 20 |
| symbol map | `rawMarketId` `E-BTC-USDT` to socket id `e_btcusdt`: lower case, first `-` to `_`, drop the second `-` | the socket spells contracts differently from REST |
| markets per connection | 49, all on one socket | 49 ran without refusal, and the advice is at most 100 |
| subscribe frames | one frame per stream | the documented shape carries one channel |
| decode | `gunzipSync` on every binary frame before `JSON.parse`, and fall back to plain text when gunzip fails | every frame is gzip, the echo of a bad event is not |
| keepalive | answer every `{"ping": n}` with `{"pong": n}` at once, and send nothing on a timer | the server pings every 10 s and the documentation asks for a pong within 1 s, even though no socket was closed without one |
| `maxSilenceMs` | 30,000 | three missed server pings, and the ping counts as traffic while a quiet book sends nothing for 30 s |
| snapshot | every frame: `resetBook`, then `setBid` and `setAsk` for 30 levels, then `publish` | each frame is a whole book |
| delta and resync | none on sequence, and `resync` only on silence | there is no sequence to break |
| drop | a frame whose `ts` is 0 or whose sides are both empty | the server sends an empty book for a channel it does not serve |
| unserved stream | log a stream with no first frame 10 s after it was sent | no acknowledgement and no error for an unknown symbol |
| receive time | stamp on arrival | `ts` sits about 0.6 s before arrival on book frames |
| deflate | keep `perMessageDeflate: false` | the server compresses inside the frame and never negotiates deflate |

`VenueFeed` hands `handleMessage` the raw buffer, so a Bittime subclass can gunzip there without a change to the base class.
At a median of 51 to 52 µs for gunzip and parse together, and 107 to 125 frames a second for the whole venue, decoding costs under 1 % of one core.

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Bittime USDⓈ-M Futures API docs, section Websocket Market Data | https://www.bittime.com/api_docs_includes_file/futures/index.html | 2026-09-22 | Bittime | URLs, channels, frames, ping rule, limits, gzip, private socket, sections 1 to 7 |
| S2 | Bittime futures web page bundle, `entry.1ffd44c4129c1e01b163.js` | https://www.bittime.com/futures/includes/entry.1ffd44c4129c1e01b163.js | 2026-09-22 | Bittime | `apiBase` `https://futures.bittime.com`, the `fe-co-api` prefix, the channel templates the page uses, section 2 |
| P1 | `ws-probe.mjs book`, runs at 03:24, 03:25 and 03:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bittime/ws-probe.mjs) | 2026-09-22 | this host | sections 2 to 6 |
| P2 | `ws-probe.mjs silence` at 03:26 and 03:40 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bittime/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
| P3 | `ws-probe.mjs batch` at 03:27 and 03:41 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bittime/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
| P4 | `ws-probe.mjs deflate` at 03:28 and 03:42 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bittime/ws-probe.mjs) | 2026-09-22 | this host | section 5 |
| P5 | `ws-probe.mjs hosts` at 03:29, 03:31 and 03:42 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bittime/ws-probe.mjs) | 2026-09-22 | this host | section 1 |
| P6 | `dig` at 03:16 UTC and the DNS lookups of `rest-probe.mjs latency` at 03:21 and 03:37 UTC | [`rest-probe.mjs`](../../../scripts/probes/venues/bittime/rest-probe.mjs) | 2026-09-22 | this host | section 1 |
