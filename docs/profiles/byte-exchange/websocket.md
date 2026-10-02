# Byte Exchange WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:13 to 03:50 UTC, from the development host near Seattle.

This profile covers the public spot WebSocket of Byte Exchange (bexc.io), which lists no real-money perpetual and has no CCXT class, see [`fees.md`](./fees.md) section 3.
The only documentation is one line on the API page, which names `wss://engine-v3.bexc.io/ws` and adds that "authenticated channels use a session token" and that "an API key cannot authenticate a WebSocket connection", S1.
Everything else below was read from the web app's socket client, S2, and captured by [`ws-probe.mjs`](../../../scripts/probes/venues/byte-exchange/ws-probe.mjs).
Where the client and the wire disagree, both are written, and the wire is what a feed must handle.

## 1. Endpoints

| product | URL | probed |
|---|---|---|
| spot, documented | `wss://engine-v3.bexc.io/ws` | 101 in 513 to 580 ms with `Origin: https://bexc.io`, the first frame within 2 ms of the open |
| spot, same server | `wss://api.bexc.io/ws` | 101 in 541 and 614 ms with the same origin, the same frames |
| perpetuals | none public | the demo perpetuals are served over REST, and the socket's `perp_position_update` is a private message, S2 |

The server refuses a handshake that carries no `Origin` header, and one whose origin is not the web app.

| `Origin` sent | status | body |
|---|---|---|
| none | 403 | `Origin header required` |
| `https://example.com` | 403 | `Origin not allowed` |
| `https://v3.bexc.io`, `null` | 403 | `Origin not allowed`, by curl |
| `https://bexc.io` | 101 | |

The 403 comes from the origin server behind Cloudflare, with CORS headers naming `https://v3.bexc.io`, in `ws-probe.mjs origin` at 03:22 and 03:45 UTC and by curl at 03:13 UTC.
The engine opens sockets with `new WebSocket(plan.url, { perMessageDeflate: false })` at [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 81, with no headers, so a Byte feed needs that call to accept an `Origin` per endpoint plan.
`engine-v3.bexc.io`, `api.bexc.io` and `bexc.io` all resolved to the same two Cloudflare addresses, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

There are no named channels.
A client subscribes one market at a time, and the market's book, trades and one minute candles follow.

| message `type` | how it starts | depth and speed | probed on 2026-09-23 |
|---|---|---|---|
| `book_update` | `{"action":"subscribe","symbol":"BTC_USDT"}`, or pushed unasked for ten default markets | the whole book up to 100 levels a side, in bursts about once a second | 3 to 5 frames a second per market, recommended and the only book source |
| `trade_update` | the same subscription | one frame per trade | 307, 297 and 385 frames in 64 to 66 s over 14 markets |
| `candle_update` | the same subscription | `interval` `1m` only | 379, 382 and 470 frames in 64 to 66 s |
| `ticker_update` | every socket, unasked | all 851 markets every 3.0 s, no bid or ask | median 2,999 to 3,000 ms apart, 2,861 to 3,023 ms over three runs |
| best bid and ask | none | | |
| depth or speed choice | none | | |
| mark, index, funding | none | | |
| `system_message`, `frontend_deploy_updated` | server push | | not observed |

The ten default markets are `BTC_USDT`, `ETH_USDT`, `SOL_USDT`, `XRP_USDT`, `BNB_USDT`, `DOGE_USDT`, `ADA_USDT`, `DOT_USDT`, `AVAX_USDT` and `LINK_USDT`.
Their books, trades and candles arrive on every new socket before it sends anything, on every run.
They count against the cap of 30 subscriptions per connection, and unsubscribing them stops them and frees the slots, see section 5.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
"Client" means the bexc.io web app's socket class, S2, which is the only description of the protocol.

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S1 | one URL serves every spot market, and `api.bexc.io/ws` is the same server |
| subscribe frame shape | client: `{"action":"subscribe","symbol":<id>}` and `{"action":"unsubscribe","symbol":<id>}`, one market per frame | as the client, a frame with a `symbols` array or a missing `symbol` gets no reply and no book |
| unknown symbol expectation | Not publicly specified | `NOPE_USDT` and `btc_usdt` each get one empty `book_update` with `"snapshot":true` and `update_id` 0 and no error. `BTC-USDT` gets `{"message":"Invalid symbol format","type":"error"}` |
| chunk unit and budget | Not publicly specified | 30 subscriptions per connection, the ten defaults included. About 10 subscribe frames per second: the 11th and later of a burst get `Rate limit exceeded` |
| keepalive mechanism | Not publicly specified. The client sends no ping | the server sends a protocol ping every 30 s from the open. A client protocol ping gets a pong in 160 to 171 ms. `{"action":"ping"}`, `{"type":"ping"}` and `{"op":"ping"}` get no reply |
| connection lifetime and maintenance notice | client handles `system_message` and `frontend_deploy_updated` | none seen, and no socket closed in 120 s, including one that left three server pings unanswered |
| handshake and operation rate limits | Not publicly specified | the Origin gate of section 1. Four sockets opened at once without refusal. The subscribe limits above |
| public market data authentication | none, S1 | none, beyond the `Origin` header |
| message parse and routing | client: `JSON.parse` of text, `DecompressionStream("deflate-raw")` of binary, then a switch on `type` | route on `type`, then `symbol`. Book and ticker frames are binary raw deflate, trades, candles, errors and empty books are text |
| subscribe acknowledgement shape | none in the client | none. The first `book_update`, flagged `"snapshot":true`, is the only sign a subscribe took |
| symbol identifier format | `BASE_QUOTE` in capitals, the REST `symbol` | identical to the REST `symbol` on every market probed. The web app's URLs use `BTC-USDT`, which the socket refuses |
| number representation | client: `parseFloat` of every price and size | prices and sizes are decimal strings, `order_count` and `update_id` are JSON integers |
| timestamp representation | client: `new Date(t.timestamp)` for trades | `trade_update.timestamp` is ISO 8601 with nanoseconds, `candle_update.open_time` is Unix ms, `book_update` and `ticker_update` carry no time |
| size unit | base currency | base currency, `"quantity":"1.037435"` BTC, and the REST book at the same `update_id` agrees |
| sequence semantics | client stores `update_id` and treats every frame as a snapshot | `update_id` rose by exactly 1 on every consecutive frame of every market, over 2,990, 2,927 and 3,126 book frames in the three book runs and 7,705 and 7,621 in the two batch runs |
| idle repeat behaviour | not documented | a frame identical to the one before, with a new `update_id`, is common: 39 of 136, 90 of 137 and 90 of 179 `BTC_USDT` frames, and 46 of 148, 126 of 245 and 154 of 229 `TRX_USDT` frames, in the three runs |

## 4. The book channel in detail

### Snapshot on subscribe

The first `book_update` of each market carries `"snapshot":true`, and later frames carry no `snapshot` key, on all 14 markets of the second and third book runs.
A subscribed market's first frame came 164 to 309 ms after the subscribe frame was sent, over three runs.
A default market's first frame came with the socket's open.
The first frame is serialized with its keys in alphabetical order, and later frames lead with `type` and `symbol` and order each level `price`, `quantity`, `order_count`, see section 6, so a parser must read keys by name.

### Every frame is the whole book

There are no deltas.
Every frame lists the book from the touch outward, up to 100 levels a side, and a feed replaces its book on every frame.
No level carried a zero size in the 3,128 frames of the third run.
The evidence is the REST book read at the same `update_id` 30 s into each run.

| market | run | REST levels | WebSocket frame levels | equal level by level |
|---|---|---|---|---|
| `BTC_USDT` | 03:22, 03:32 and 03:45 UTC | 100 a side | 100 a side | 100 of 100 per side, all three runs |
| `TRX_USDT` | 03:22, 03:32 and 03:45 UTC | 100 a side | 100 a side | 100 of 100 per side, all three runs |
| `ALLO_USDT` | 03:22 UTC | 45 bids, 46 asks | 45 and 46 | all |
| `ALLO_USDT` | 03:32 UTC | 36 bids, 35 asks | 41 and 40 | all 36 and 35 REST levels matched the frame's first levels |
| `ALLO_USDT` | 03:45 UTC | 29 bids, 28 asks | 29 and 28 | all |

So the REST book can be shorter than the frame with the same id, and it never disagreed where both had a level.
The id is not a perfect label, though.
`ALLO_USDT` answered REST at 03:42 UTC with `last_update_id` 1712 and a best bid of 0.3064, and its WebSocket snapshot at 03:45:31 UTC carried the same id 1712 with a different book, whose repeated bid level sat at 0.3067.

### Sequence and gap rule

```text
book_update   replace the whole book, last = update_id
update_id = last + 1   the normal case, 0 exceptions observed
update_id ≠ last + 1   frames were missed, but nothing is lost because the frame is whole, so replace and log
```

`update_id` is per market and matches the REST `last_update_id`.
`SUI_ETH` read `last_update_id` 0 on REST in every run while its book held 28 levels a side, so an id of 0 does not always mean an empty book.

### Checksum

None in the client, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `book_update` | best first, descending | best first, ascending |
| REST `orderbook` | descending | ascending |

No frame put a price out of order in the 2,927 and 3,126 binary frames of the second and third runs.
The first run's check counted one `ALLO_USDT` frame of 382 as out of order, and it could not tell an inversion from a repeated price.

A price can appear twice on one side.
The `ALLO_USDT` snapshot of the third run listed two bid levels at 0.3067, sizes 253.93 and 170.60, and the REST book of 03:42 UTC listed two bid levels at 0.3063 and two ask levels at 0.3070.
The API page calls the REST book an "L2 aggregated order book", S3, so this is a departure from the documented shape.
A feed must sum the sizes at a repeated price before it sets the level.

### Level window

A liquid book holds exactly 100 levels a side, as `BTC_USDT` and `TRX_USDT` did in every frame of three runs.
A thinner book holds what it has: `XRP_USDT` 47 to 85 bids, `ALLO_USDT` 26 to 50, `EUL_USDC` 27 to 32, and `ETH_USDT` dropped to 48 in the third run.
100 levels covers the engine's 20.

### Size unit

Sizes are base currency on a spot book, and there is no contract size.
`BTC_USDT` levels read `"quantity":"1.037435"` at a price near 86,705, which is plausible as bitcoin.

### Cadence

Frames come in bursts.
Within a burst the frames are milliseconds apart, and bursts are about a second apart: the gaps over 300 ms had a median of 897 to 934 ms on the twelve busy markets of the second and third runs.
A busy market got 2.2 to 7.1 frames a second, median 4.12 and 4.15, in the two batch runs.
The quiet `EUL_USDC` went 14,949, 14,998 and 14,960 ms without a frame in the three runs.

### What the book is made of

Almost every level holds one order.
`order_count` was 1 on all 27,400 `BTC_USDT` levels seen in the second run, and 2 on at most 1.53 % of the levels of any market in any run, `EUL_USDC` in the first.
The busiest books sat near Bybit spot but not on it: the `BTC_USDT` mid was within 47 ppm of Bybit's at 03:19 UTC and 48 to 222 ppm above it at 03:43 UTC, see [`rest.md`](./rest.md) section 2.
The public web bundle ships admin pages for an in-house market making engine, whose Turkish summary reads "Genel piyasa yapıcı motor", general market maker engine, and for a "Chaos Engine" whose text reads "The 5-layer plan is not influencing live market making" and offers to "Inject manual milestones (days offset + target price) into the plan", S2.
Which markets that engine quotes is Not publicly specified.

### One-sided and empty books

No one-sided, crossed or empty frame was seen on any listed market in the three runs.
An unknown or wrongly cased symbol gets one empty frame, sent as text, then nothing.

```json
{"asks":[],"bids":[],"snapshot":true,"symbol":"btc_usdt","type":"book_update","update_id":0}
```

### Idle repeats

A frame identical to the previous one, with a new `update_id`, made up 29 %, 66 % and 50 % of `BTC_USDT` frames in the three runs, and none on `XRP_USDT`, `ALLO_USDT` and `EUL_USDC`.
A feed that republishes on every frame will republish an unchanged book several times a second.

### Unknown, closed and wrong-form requests

| request | reply | then |
|---|---|---|
| `{"action":"subscribe","symbol":"NOPE_USDT"}` | one empty text `book_update`, `update_id` 0 | nothing |
| `{"action":"subscribe","symbol":"btc_usdt"}` | one empty text `book_update` under `btc_usdt` | nothing |
| `{"action":"subscribe","symbol":"BTC-USDT"}` | `{"message":"Invalid symbol format","type":"error"}` | the socket stays open |
| `{"action":"subscribe"}` | nothing | |
| `{"action":"subscribe","symbols":["SUI_USDT"]}` | nothing | no `SUI_USDT` frame |
| `{"action":"nope"}` | nothing | |
| text that is not JSON | nothing | the socket stays open |
| an 11th subscribe inside about a second | `{"message":"Rate limit exceeded","type":"error"}` | that market is not subscribed |
| a 31st subscription | `{"message":"Maximum subscription limit (30) reached","type":"error"}` | that market is not subscribed |
| `{"action":"unsubscribe","symbol":"BTC_USDT"}` | nothing | `BTC_USDT` sent 2 to 4 more frames within 2 s and then nothing in the next 8 s, in all three runs |

No error names the market it refers to, so a feed pacing its subscribes has to count them.
A delisted market was not available to probe, since all 851 were active.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | Not publicly specified | the server sends a protocol ping at 30.5, 60.5 and 90.5 s after the open, on all four sockets. `ws` answers it by default |
| silence the server tolerates | Not publicly specified | no socket closed in 120 s, whether it subscribed or not, pinged or not, or left three server pings unanswered. The default books and the 3 s ticker keep every socket busy, with no gap over 785 ms |
| forced disconnect | Not publicly specified | none in 120 s |
| maintenance notice | client handles `system_message` | not observed |
| compression | Not publicly specified | the server compresses inside the frame: book and ticker frames are binary raw deflate. A `BTC_USDT` book is 2,127 to 2,326 bytes on the wire and 11,879 to 11,895 inflated, a ticker 38,206 to 38,233 and 85,476 to 85,494. Offering permessage-deflate got no `sec-websocket-extensions` header back |
| handshake | Origin gate, section 1 | 513 to 614 ms to open |
| subscription limits | Not publicly specified | 30 per connection including the ten defaults. 10 subscribes accepted from a burst of 12, and from 20 sent 50 ms apart. 31 sent 150 ms apart after dropping the defaults: 30 accepted, the 31st refused for the cap |
| throughput, 30 markets | | the top 30 by 24 h quote volume, two runs: 156 and 159 frames a second, 128 and 127 of them books, 221 and 226 KB a second on the wire, 1,068 and 1,098 KB a second inflated |
| decode cost | | raw inflate plus `JSON.parse` of a binary frame: median 143 to 172 µs, p90 261 to 438 µs, in five runs of 2,949 to 7,705 frames |

The decode cost is the axis that matters for the engine's single event loop.
It is twelve to fourteen times Gate's 12 µs per frame, and a full connection of 30 markets costs about 18 to 21 ms of loop time a second.
The whole catalog of 851 markets would take 29 connections, and at the busiest markets' rate that is about half a core, an upper bound since most markets are quieter.

## 6. Captured frames

Trimmed, from the third book run at 03:45 UTC.
Book frames are cut to three levels a side, and the ticker frame to three rows.

Subscribe, one market per frame.

```json
{"action":"subscribe","symbol":"BTC_USDT"}
```

First frame of a market, binary raw deflate, 2,168 bytes on the wire and 11,895 inflated, 100 levels a side, keys in alphabetical order.

```json
{"asks":[{"order_count":1,"price":"86880.89","quantity":"0.545372"},{"order_count":1,"price":"86881.83","quantity":"2.015351"},{"order_count":1,"price":"86882.30","quantity":"1.324740"}],"bids":[{"order_count":1,"price":"86859.02","quantity":"0.649305"},{"order_count":1,"price":"86856.12","quantity":"1.281082"},{"order_count":1,"price":"86854.62","quantity":"0.678166"}],"snapshot":true,"symbol":"BTC_USDT","type":"book_update","update_id":375995}
```

The next frame of the same market 156 ms later, 2,326 bytes on the wire and 11,879 inflated, with no `snapshot` key, another key order, and the same top three levels under the next `update_id`.

```json
{"type":"book_update","symbol":"BTC_USDT","bids":[{"price":"86859.02","quantity":"0.649305","order_count":1},{"price":"86856.12","quantity":"1.281082","order_count":1},{"price":"86854.62","quantity":"0.678166","order_count":1}],"asks":[{"price":"86880.89","quantity":"0.545372","order_count":1},{"price":"86881.83","quantity":"2.015351","order_count":1},{"price":"86882.30","quantity":"1.324740","order_count":1}],"update_id":375996}
```

Trade and candle, text.

```json
{"type":"trade_update","symbol":"BNB_USDT","trade_id":"f2978647-436f-4cd1-8de2-b06b2b844b56","price":"796.9","quantity":"0.01","taker_side":"sell","timestamp":"2026-09-23T03:45:31.157072112Z"}
```

```json
{"type":"candle_update","symbol":"BNB_USDT","interval":"1m","open_time":1790135100000,"open":"797.07500000","high":"797.07500000","low":"796.9","close":"796.9","volume":"0.29","trade_count":23}
```

Ticker, binary raw deflate, 38,233 bytes on the wire and 85,483 inflated.
Each row is symbol, last, 24 h change percent, base volume, quote volume, high, low, and a flag whose meaning is Not publicly specified.

```json
{"type":"ticker_update","tickers":[["EUL_USDC","1.44500000","-0.13","2456.40","3446.4971500000","1.44500000","1.37700000",false],["ALLO_USDT","0.30715000","18.27","9380.0","2862.759112500","0.3110","0.2658850",false],["H_USDT","0.0624950","-6.25","55659.4","3530.6006665100","0.068050","0.06223",false]]}
```

Empty snapshot for an unknown or wrongly cased market, text.

```json
{"asks":[],"bids":[],"snapshot":true,"symbol":"btc_usdt","type":"book_update","update_id":0}
```

Errors, text.

```json
{"message":"Invalid symbol format","type":"error"}
```

```json
{"message":"Rate limit exceeded","type":"error"}
```

```json
{"message":"Maximum subscription limit (30) reached","type":"error"}
```

## 7. Private channels

Named for a future execution stage, from the client, S2, not probed.

- Login is `{"action":"auth","token":<session token>}` on the same socket, and "an API key cannot authenticate a WebSocket connection", S1.
- Private message types include `order_update`, `order_visibility_changed`, `balance_updated` and `perp_position_update`, plus reward, quest and prediction game messages.

## 8. Recommended feed shape

The venue lists no perpetual the engine could trade, so no feed is recommended.
If a spot leg were ever wanted, this is the shape the probes support.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://engine-v3.bexc.io/ws`, with header `Origin: https://bexc.io` | the documented host, and the handshake is refused without the header, which needs a change to [`VenueFeed.ts`](https://github.com/nemanull/arbitrage-observatory/blob/2cbe70629c3c429da9b231ab71a7b861b3fc8096/server/src/feeds/book/VenueFeed.ts) line 81 |
| markets per connection | 30, after unsubscribing the ten defaults | the cap counts the defaults |
| subscribe frames | one `{"action":"subscribe","symbol":<rawMarketId>}` per market, 200 ms apart | about 10 a second are accepted and nothing acknowledges a subscribe |
| decode | `zlib.inflateRawSync` for a binary frame, UTF-8 for a text frame, then `JSON.parse`, reading keys by name | books arrive both ways and in two key orders, and inflate plus parse costs about 150 µs a frame |
| routing | `type === "book_update"`, then `symbol` is the `rawMarketId` | the socket and REST spell markets identically |
| book | `resetBook` from every frame, summing the sizes of a repeated price, then `publish` | every frame is the whole book, and a price can appear twice on one side |
| sequence | store `update_id`, log a step other than 1, never `resync` for it | the frame is whole, so a missed frame loses nothing |
| unserved market | log a subscribed market whose first frame is empty with `update_id` 0 | an unknown symbol is answered that way, not with an error |
| keepalive | none sent, answer protocol pings, which `ws` does by default | the server pings every 30 s |
| `maxSilenceMs` | 10,000 | the ticker arrives every 3 s on every socket, so three missed tickers is a dead socket, while a quiet book can go 15 s without a frame |
| receive time | stamp on arrival | book frames carry no time |
| idle repeats | skip `publish` when the frame equals the last one | up to two thirds of frames repeat the previous book |
| deflate | keep `perMessageDeflate: false` | the server compresses inside the frame regardless |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | API documentation page bundle | https://bexc.io/assets/ApiDocsPage-BbAofZMN.js, rendered at https://bexc.io/api-docs | 2026-09-22 | Byte Exchange, global | the WebSocket URL, API keys cannot authenticate a socket, sections 1, 2, 7 |
| S2 | Web app bundle, socket client class and admin route table | https://bexc.io/assets/index-B0y2Yr87.js, with https://bexc.io/assets/ChaosEnginePage-FKiT0y3a.js and https://bexc.io/assets/MmEnginePage-DCjnnHyw.js | 2026-09-22 | Byte Exchange, global | subscribe frames, message types, raw deflate decoding, auth frame, admin engine pages, sections 2 to 4 and 7 |
| S3 | Byte Exchange API (V3) Postman collection | https://bexc.io/data/spot.json?v=v3 | 2026-09-22 | Byte Exchange, global | "L2 aggregated order book", section 4 |
| P1 | `ws-probe.mjs origin` at 03:22 and 03:45 UTC, and curl handshakes at 03:13 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/byte-exchange/ws-probe.mjs) | 2026-09-23 UTC | this host | section 1 |
| P2 | `ws-probe.mjs book`, runs at 03:22, 03:32 and 03:45 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/byte-exchange/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 2 to 6 |
| P3 | `ws-probe.mjs silence`, runs at 03:23 and 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/byte-exchange/ws-probe.mjs) | 2026-09-23 UTC | this host | section 5 |
| P4 | `ws-probe.mjs ratelimit` at 03:27, 03:28 and 03:47 UTC, `batch` at 03:26, 03:29 and 03:48 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/byte-exchange/ws-probe.mjs) | 2026-09-23 UTC | this host | sections 3 and 5 |
