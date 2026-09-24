# Webot WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:06 to 03:30 UTC, from the development host near Seattle.

This profile covers the public spot market data socket that serves Webot, formerly Pionex.US, because Webot lists no perpetual, see [`fees.md`](./fees.md) section 3.
It follows change 1 of the survey plan, [`2026-09-22-venue-survey-plan.md`](../../plans/2026-09-22-venue-survey-plan.md).
Webot publishes no API documentation.
The frames below are those of the Pionex international open API docs, S1, sent to the Pionex.US host `ws.pionex.us`, which answered them.
So every "documented" value below is Pionex's, for a different venue, and the probed value is what Webot's books actually do.
Every protocol claim was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/webot/ws-probe.mjs), in two passes whose runs are listed in section 9.

## 1. Endpoints

| URL | documented | probed |
|---|---|---|
| `wss://ws.pionex.us/wsPub` | not documented by Webot. The Pionex docs give `wss://ws.pionex.com/wsPub` for the international venue, S1 | open in 80 to 137 ms, and a DEPTH subscribe on `BTC_USDT` delivers the same book as `https://api.webot.com`, section 4. Served by CloudFront POP `SEA900-P10` in front of `APISIX/3.13.0` |
| `wss://ws.pionex.us/ws` | private stream, "requires authentication", S1 | HTTP 200 with `{"result":false,"code":"INVALID_APIKEY","message":"no key in uri args"}` and no upgrade |
| `wss://ws.webot.com/wsPub` | none | the name does not resolve, `ENOTFOUND` |
| `wss://stream.webot.com/wsPub` | none | HTTP 404 |
| `wss://api.webot.com/wsPub` | none | HTTP 404 `{"error_msg":"404 Route Not Found"}` |
| `wss://stream.pionex.us`, `wss://stream-v1.pionex.us` | the hosts the Webot web app uses, from `webSocketHost` in `https://www.webot.com/static/js3/main.20260922.601.3d96177.js` | not probed, since they carry the app's own protocol |

Only one family exists, spot, and one socket carries every spot symbol, up to the topic cap of section 5.
The Webot web app itself does not use `ws.pionex.us`, S2.
The reading that this host is the Pionex.US open API socket, still running after the rebrand, is an inference, and nothing published promises it will stay.

## 2. Channel matrix for public market data

| topic | subscribe frame | depth and speed | probed on 2026-09-22 |
|---|---|---|---|
| `DEPTH` | `{"op": "SUBSCRIBE", "topic": "DEPTH", "symbol": "BTC_USDT", "limit": 20}` | `limit` 1 to 100, S1. Speed not documented | a whole top-`limit` book about once a second, section 4. Limits 5, 20, 50 and 100 accepted, 0, 101 and 1000 refused |
| `TRADE` | `{"op": "SUBSCRIBE", "topic": "TRADE", "symbol": "BTC_USDT"}` | "Up to 100 trade records per message, sorted by timestamp descending", S1 | 25 and 30 frames with 30 and 39 trades on `BTC_USDT` in 45 s |
| best bid and ask | none | | no such topic in S1 |
| ticker, mark, index, funding | none | | no such topic in S1, and Webot has no mark, index or funding, see [`rest.md`](./rest.md) section 3 |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented, Pionex international, S1 | probed on Webot's host |
|---|---|---|
| endpoint split axis | one public URL and one private URL | one public URL carries every spot symbol, and there is no other family |
| subscribe frame shape | `{"op": "SUBSCRIBE", "topic": "<TOPIC>", "symbol": "<SYMBOL>"}`, one symbol per frame, with `limit` for DEPTH | one symbol per frame. `limit` must be a JSON number, since `"20"` answers `bad json payload` |
| unknown symbol expectation | Not publicly specified | `{"type":"ERROR","code":"INVALID_SYMBOL","message":"invalid \`symbol\`",…}` in 20 to 24 ms, and the socket stays open |
| chunk unit and budget | "Maximum 10 concurrent connections per IP" | 100 topics per connection, the 101st answers `SUBSCRIBED_TOPICS_EXCEED_LIMIT`. Ten subscribe frames sent in one burst are acknowledged and the next ones close the socket for "rate limit", section 5. The per IP connection cap was not probed |
| keepalive mechanism | "Server sends `{"op": "PING", "timestamp": <ms>}` every 15 seconds", "Client must reply `{"op": "PONG", "timestamp": <ms>}`", "Missing 3 consecutive PONGs triggers disconnection" | PING at 15.08 to 15.14 s after open and every 15.0 s after. A socket that never answers is closed at 60.09 to 60.13 s, subscribed or not. A client `PING` gets no reply |
| connection lifetime and maintenance notice | Not publicly specified | no lifetime cap reached in 110 s and 75 s, and no maintenance frame seen |
| handshake and operation rate limits | Not publicly specified for the socket | open in 80 to 137 ms. One subscribe per 120 ms was accepted for 384 frames, and a burst of 384 was cut at 145 and 170 ms |
| public market data authentication | none | none |
| message parse and routing | `topic`, `symbol`, `data`, `timestamp` | route on `topic` and `symbol`. Control frames carry `type` or `op` instead of `data`, and their key order varies |
| subscribe acknowledgement shape | Not publicly specified | `{"type":"SUBSCRIBED","topic":"DEPTH","symbol":"BTC_USDT"}`, the same keys in any order, no timestamp, and no ack for an error, which carries no symbol |
| symbol identifier format | `BTC_USDT` | `BASE_QUOTE` in upper case, identical to the REST catalog `symbol`. `btc_usdt` and `BTC_USDT_PERP` answer `INVALID_SYMBOL` |
| number representation | `[[price, size], …]` as strings | strings. The same price read `"86647.1"` in the REST book at limit 5 and `"86647.10"` at limit 1000, so compare prices as numbers |
| timestamp representation | `timestamp` in ms | `timestamp` integer ms on DEPTH and TRADE frames, 40 to 718 ms older than arrival over both passes, median 242 to 314 ms per symbol. Error frames carry ms too |
| size unit | Not publicly specified | base currency, section 4 |
| sequence semantics | Not publicly specified | none. No DEPTH frame carries an id, and every frame is a whole book |
| idle repeat behaviour | Not publicly specified | the same top 20 is sent again: 1 to 12 identical repeats per symbol in 45 s. A quiet book went up to 5.2 s without a frame |

## 4. The book channel in detail

`DEPTH` with `limit` 20 is the only book channel, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

There is no immediate snapshot and there are no deltas.
Every DEPTH frame is a whole book of the top `limit` levels, and the first frame is simply the next scheduled push.
The first frame came 48 to 890 ms after the subscribe on four busy books over two passes, 374 ms and 4.8 s on the quiet `COOKIE_USDT`, and 2.6 s and 9.5 s on the empty `ACX_USDT`, by the frame timestamps.
A feed resets its book on every frame.

### Delta semantics

None.
A frame with `limit` 20 always held exactly 20 bids and 20 asks on every book that had them, over 18 to 57 frames per watched symbol per pass.
The engine's `resetBook` followed by `setBid`, `setAsk` and `publish` fits this, with no update id to keep.

### Sequence and gap rule

```text
every DEPTH frame   replace the book with data.bids and data.asks, then publish
no frame for N s     the socket is stale, since nothing else can reveal a lost frame
```

With no id there is no gap to detect, and a lost frame costs at most one push interval, because the next frame is whole again.

### Checksum

None is documented and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| DEPTH, every frame of both passes | best first, descending, 0 misordered frames | best first, ascending, 0 misordered frames |
| REST `depth` at limits 5, 20, 100 and 1000 | descending | ascending |

No frame was crossed.

### Level window

The server sends exactly `limit` levels per side, and a thinner book sends what it has.
`USDC_USD` held 56 to 58 bids and 32 to 40 asks in the REST book at limit 100 in three runs, so a DEPTH 100 subscribe would carry fewer than 100 there.
`BTC_USD` at limit 50 and `BTC_USDC` at limit 100 delivered 50 and 100 levels per side in the errors run.
A second DEPTH subscribe on a symbol already subscribed replaced its `limit`: `BTC_USDT` went from 20 levels to 5, and the duplicate at 20 was acknowledged and did not double the frames.

### Push cadence

| symbol, 45 s per pass | frames | median gap | max gap | identical repeats |
|---|---|---|---|---|
| `BTC_USDT` | 50 and 50 | 877 and 906 ms | 1,814 and 1,773 ms | 7 and 9 |
| `ETH_USDT` | 46 and 47 | 956 and 931 ms | 1,885 and 1,817 ms | 11 and 8 |
| `ZEC_USD` | 53 and 57 | 892 and 664 ms | 1,551 and 1,573 ms | 1 and 8 |
| `USDC_USD` | 32 and 38 | 1,205 and 883 ms | 3,598 and 4,509 ms | 5 and 3 |
| `COOKIE_USDT` | 18 and 32 | 2,034 and 1,210 ms | 5,195 and 3,045 ms | 7 and 12 |

So the busiest books refresh about once a second and never faster, which is a slow feed next to the engine's other venues.
A repeat of an identical top 20 fits a change below the window, which is an inference.

### Size unit against CCXT `contractSize`

Sizes are in the base currency, for example `["86486.48","0.000008"]` on `BTC_USDT`, whose catalog `minTradeSize` is `"0.000001"` BTC, [`rest.md`](./rest.md) section 2.
There is no CCXT class, so no `contractSize` exists to compare, and the engine's default of 1 would be right for spot.
The last DEPTH 20 book of `BTC_USDT` equalled the REST book of the same moment on all 20 bids and all 20 asks in both passes, read 388 and 142 ms after the frame.

### One-sided and empty books

`ACX_USDT`, which had no trade in 24 h, delivered `{"bids":[],"asks":[]}`, 2 and 3 frames in about 23 s.
In the batch, 72 of the 384 symbols sent no frame in 30, 20 and 15 s of listening, and in the second pass every one of them had no trade in 24 h.
No one-sided book was captured, and the frame shape allows one.

### Unknown, closed and wrong symbols

| request | reply | then |
|---|---|---|
| `NOPE_USDT` | `INVALID_SYMBOL` | the socket stays open |
| `btc_usdt` | `INVALID_SYMBOL` | |
| `BTC_USDT_PERP` | `INVALID_SYMBOL` | |
| a catalog symbol with no trade in 24 h, `ACX_USDT` | `SUBSCRIBED` | empty books |
| unknown topic `NOPE` | `INVALID_TOPIC` | |
| unknown op `NOPE` | `INVALID_OP` | |
| DEPTH without `limit` | `PARAMETER_ERROR` `invalid \`limit\`` | S1 gives a default of 5, and the wire refuses the omission |
| `limit` 0, 101 or 1000 | `PARAMETER_ERROR` `invalid \`limit\`` | |
| `limit` `"20"` as a string | `PARAMETER_ERROR` `bad json payload` | |
| text that is not JSON | `PARAMETER_ERROR` `bad json payload` | the socket stays open |
| `UNSUBSCRIBE` of a subscribed symbol | `{"type":"UNSUBSCRIBED","topic":"DEPTH","symbol":"BTC_USDT"}` | frames stop |
| `UNSUBSCRIBE` of a symbol never subscribed | `UNSUBSCRIBED` all the same | |

The error frame never names the symbol it refuses, so a feed that sends several subscribes at once cannot tell which one failed.

## 5. Session

| item | documented, Pionex international, S1 | probed |
|---|---|---|
| keepalive | server PING every 15 s, client PONG, three missed PONGs disconnect | `{"op": "PING", "timestamp": 1790134001027}` at 15.1 s and every 15.0 s. Answering with `{"op":"PONG","timestamp":<ms>}` kept a socket with no subscription open for 110 s and 75 s |
| silence the server tolerates | three missed PONGs | a socket that never answers PING is closed at 60.09 to 60.13 s, three sockets over two passes, subscribed or not, with `{"op": "CLOSE", "timestamp": 1790134207135, "note": "missed pong exceed max limit"}` and close code 1000, reason `missed pong exceed max limit` |
| forced disconnect | Not publicly specified | none in 110 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames when deflate is not offered. When offered, the server negotiates `permessage-deflate; server_no_context_takeover; client_no_context_takeover`, twice |
| handshake | | 80 to 137 ms to open from this host over all runs |
| topics per connection | Not publicly specified | 100. Subscribes 101 to 384, one per 120 ms, each answered `{"type":"ERROR","code":"SUBSCRIBED_TOPICS_EXCEED_LIMIT","message":"subscribed topic exceed limit",…}` in both passes |
| refused topics | | 220 of the 284 refused symbols delivered DEPTH frames anyway, in the runs at 03:19 and 03:28 UTC, and the other 64 had no trade in 24 h. So a refusal does not reliably mean no stream, and a feed should stay at 100 |
| subscribe rate | Not publicly specified | 384 subscribe frames sent in 2 and 8 ms: 10 were acknowledged, then `{"op":"CLOSE",…,"note":"rate limit"}` and close code 1000 reason `rate limit` at 145 and 170 ms. One subscribe per 120 ms never tripped it |
| connections per IP | "Maximum 10 concurrent connections per IP" | not probed. The probe held at most three at once |
| throughput | | 100 subscribed plus 220 leaked streams on one socket: 225 to 235 frames per second at the median over three runs, peak 316, 207 to 217 KB per second, 914 and 915 bytes per frame, 30 to 35 µs `JSON.parse` per frame |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.

Subscribe and acknowledgement.

```json
{"op": "SUBSCRIBE", "topic": "DEPTH", "symbol": "ZEC_USD", "limit": 20}
```

```json
{"topic":"DEPTH","symbol":"ZEC_USD","type":"SUBSCRIBED"}
```

A whole book, the first three levels per side kept of 20.

```json
{"topic":"DEPTH","symbol":"ZEC_USD","data":{"bids":[["1615.61","1.004"],["1615.6","0.017"],["1615.57","0.005"]],"asks":[["1618.86","0.531"],["1618.97","0.516"],["1618.98","6.866"]]},"timestamp":1790133986551}
```

An empty book.

```json
{"topic":"DEPTH","symbol":"ACX_USDT","data":{"bids":[],"asks":[]},"timestamp":1790134046365}
```

Trade.

```json
{"topic":"TRADE","symbol":"BTC_USDT","data":[{"symbol":"BTC_USDT","tradeId":"200000000107868897","price":"86697.95","size":"0.000008","side":"BUY","timestamp":1790133987528}],"timestamp":1790133987586}
```

Keepalive, and the close that follows three unanswered pings.

```json
{"op": "PING", "timestamp": 1790134001027}
```

```json
{"op": "CLOSE", "timestamp": 1790134207135, "note": "missed pong exceed max limit"}
```

Errors.

```json
{"type":"ERROR","code":"INVALID_SYMBOL","message":"invalid `symbol`","timestamp":1790134040199}
```

```json
{"type":"ERROR","code":"PARAMETER_ERROR","message":"invalid `limit`","timestamp":1790134047407}
```

The cap and the rate limit, as the probe records them with the timestamp elided.

```text
{"type":"ERROR","code":"SUBSCRIBED_TOPICS_EXCEED_LIMIT","message":"subscribed topic exceed limit","timestamp":…}
{"op":"CLOSE","timestamp":…,"note":"rate limit"}
```

Unsubscribe acknowledgement.

```json
{"type":"UNSUBSCRIBED","topic":"DEPTH","symbol":"BTC_USDT"}
```

## 7. Private channels

The Pionex docs name a private stream at `wss://ws.pionex.com/ws` with an authenticated handshake, S1.
The Pionex.US counterpart `wss://ws.pionex.us/ws` answered `INVALID_APIKEY` `no key in uri args`, section 1.
Whether a Webot account can obtain a key at all is open, see [`fees.md`](./fees.md) section 1.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
The engine consumes perpetuals only, and Webot has none, so no feed is recommended today.
If a later design admits spot legs, the shape would be the following.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://ws.pionex.us/wsPub`, one connection per 100 symbols, at most 10 connections | 100 topics per connection, and the documented 10 connections per IP |
| markets per connection | 100, or fewer | the cap, and a refused subscribe cannot be attributed |
| subscribe frames | one `{"op":"SUBSCRIBE","topic":"DEPTH","symbol":<rawMarketId>,"limit":20}` per symbol, at most one per 120 ms | a burst of more than 10 closes the socket for "rate limit" |
| keepalive | answer each server `{"op":"PING"}` with `{"op":"PONG","timestamp":<ms>}` at once, and send nothing else | the server pings every 15 s and closes at 60 s without a PONG. A client PING gets no reply |
| `maxSilenceMs` | 20,000 | the server's PING arrives every 15 s whatever the books do, so 20 s without any frame is a dead socket |
| routing | `topic` and `symbol`, with `symbol` equal to the catalog `symbol` | |
| snapshot | every DEPTH frame: `resetBook`, then each level, then `publish` | whole books, no ids |
| resync | none on content. Only the silence watch reconnects | nothing can reveal a lost frame, and the next frame repairs it |
| receive time | stamp on arrival | the frame `timestamp` ran 40 to 718 ms behind arrival |
| deflate | keep `perMessageDeflate: false` | the server sends plain frames when it is not offered |
| slow books | treat a book as about one second old at best | pushes come about once a second, and the frame is already 242 to 314 ms old at the median |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Pionex open API docs, Trade WebSocket: Connection Endpoints, Subscribe / Unsubscribe, Heartbeat, Limits, Public Stream | https://www.pionex.com/docs/api-docs/trade-websocket/general-info.md and the pages it links, read through `https://www.pionex.com/docs/llms.txt` | 2026-09-22 | Pionex, international, not Webot | frame shapes, PING and PONG, 10 connections per IP, DEPTH `limit` 1 to 100 and default 5, level order, sections 1 to 5 |
| S2 | Webot web app bundle | `https://www.webot.com/static/js3/main.20260922.601.3d96177.js` | 2026-09-22 | Webot | the app's own socket hosts, section 1 |
| P1 | `ws-probe.mjs book`, `errors` and `batch` at 03:14 to 03:20 UTC, first pass | [`ws-probe.mjs`](../../../scripts/probes/venues/webot/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6 |
| P2 | `ws-probe.mjs silence` with a 110 s cap and `deflate`, at 03:20 to 03:22 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/webot/ws-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P3 | `ws-probe.mjs endpoints`, `book`, `errors`, `batch` in a burst and paced, `silence` with a 75 s cap and `deflate`, at 03:26 to 03:30 UTC, second pass | [`ws-probe.mjs`](../../../scripts/probes/venues/webot/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 1 to 6, the second readings |
