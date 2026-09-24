# Bit2Me WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, between 02:38 and 02:59 UTC on 2026-09-23.

This profile covers the public Pro spot WebSocket of Bit2Me, which has no CCXT id, with the book channel in detail.
Bit2Me lists no live perpetual, see [`fees.md`](./fees.md) section 3, so the spot socket is the one profiled, as template change 1 of the venue survey plan says.
The documented futures socket is covered in section 1, because it is the only sign of a perpetual product.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/bit2me/ws-probe.mjs), and the capture is quoted beside the documented value.
Run 1 is the first run of each mode at 02:48 to 02:52 UTC, and run 2 is the second pass at 02:55 to 02:59 UTC.

## 1. Endpoints

| product | documented URL | probed |
|---|---|---|
| Pro spot | `wss://ws.bit2me.com/v1/trading`, S1 | open in 259 to 336 ms over every run, all quote currencies on one socket |
| USDC perpetuals | `wss://ws.bit2me.com/v1/futures/connection/websocket`, S2 | upgrades with 101 and opens in 254 to 330 ms, then sends nothing |
| a path that does not exist | `wss://ws.bit2me.com/v1/nope` | upgrades with 101 and opens in 256 to 757 ms, then sends nothing |

`ws.bit2me.com` resolved to `104.20.34.144` and `172.66.150.115`, the same Cloudflare addresses as the REST host, see [`rest.md`](./rest.md) section 1.

### The documented futures socket

S2 is titled "Futures WebSockets API" and says "Public channels are available without authentication".
It documents `{"channel": "ticker:BTCUSDC_PERP"}`, `{"channel": "orderbook:BTCUSDC_PERP"}` and `{"channel": "market-trades:BTCUSDC_PERP"}`, with example publications dated 2026-06-19.
It documents no REST call, no instrument list, no fee and no funding rule.

On this host the futures URL behaved exactly like a path that does not exist.

| frames sent | socket | frames back |
|---|---|---|
| the three documented subscribe frames | futures URL | 0 in 12 s, in both runs of `futures` |
| Centrifugo `connect` then `subscribe` for `orderbook:BTCUSDC_PERP` | futures URL | 0 in 12 s, in both runs |
| `{"token": ""}`, protocol v1 `method` frames, `BTCUSDT_PERP`, `BTCEUR_PERP`, a spot subscribe | futures URL | 0 in 5 to 10 s, in the reconnaissance before the probe was written |
| a spot `order-book` subscribe for `BTC/EUR` | `/v1/nope` | 0 in 12 s, in both runs |
| the documented futures frame and a spot subscribe for `BTCUSDC_PERP` | spot URL | the spot subscribe answered `"error":"symbol is not supported"`, and the futures frame got no reply |

An HTTP `GET` of any path on `ws.bit2me.com`, the futures path or `/v1/nope`, returned 200 with the body `OK`, see [`rest.md`](./rest.md) section 3.
So the upgrade proves nothing about a futures service behind the path.
The futures product is documented and not live to a public client on 2026-09-22.

## 2. Channel matrix for public market data

| channel | subscribe frame | depth and speed | probed |
|---|---|---|---|
| `order-book` | `{"event":"subscribe","symbol":"BTC/EUR","subscription":{"name":"order-book"}}` | a whole book per frame, up to 100 levels per side on most markets, at most about one frame a second on most markets | section 4 |
| `public-trades` | `{"event":"subscribe","symbol":"BTC/EUR","subscription":{"name":"public-trades"}}` | one trade per frame | 1 and 3 BTC/EUR trades in 40 s in the two runs |
| best bid and ask, ticker, index, mark, funding | none on the spot socket | | a subscribe with name `nope` got no reply |

The channel names and frames are from S1.
The REST call `GET /v2/trading/tickers` carries a best bid and ask, and it updates only on a trade, see [`rest.md`](./rest.md) section 3.

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one spot URL, and a separate futures URL, S1 and S2 | 281 markets of every quote, EUR, USDC, USD and the other stablecoins, delivered on one socket |
| subscribe frame shape | `{"event":"subscribe","symbol":"B2M/EUR","subscription":{"name":"order-book"}}`, one symbol per frame, S1 | as documented, and a frame without `symbol` answered `"error":"symbol is not supported"` |
| unknown symbol expectation | not documented | `{"event":"subscribe","symbol":"NOPE/EUR","subscription":{"name":"order-book"},"error":"symbol is not supported"}`. An unknown channel name or an unknown `event` got no reply within 0.9 s |
| chunk unit and budget | "Subscribe" 50 messages per second per connection, and a connection "will be aborted if the request limit has been reached", S3. More than 50 messages a second from one connection closes it with code `4001`, S4 | 281 subscribe frames at 25 a second, 11.35 s in all, 281 acknowledged in both runs, no close |
| keepalive mechanism | not documented for public channels | a protocol ping from the server every 20 s, first at 20.30 to 20.34 s, on every socket of both runs. `{"event":"ping"}` answered `{"event":"pong"}` |
| connection lifetime and maintenance notice | Not publicly specified. S4 recommends "on disconnect: reconnect" and points at `https://status.bit2me.com/` | no close and no notice in 100 s |
| handshake and operation rate limits | 50 concurrent connections per IP, beyond which the handshake answers 429, and 50 messages a second per connection, S4 | not approached: at most four sockets at once, at most 25 frames a second |
| public market data authentication | none for public channels, S1 | none. A private channel without a login answered `{"error":"Forbidden"}` and the socket stayed open |
| message parse and routing | `{"event": "order-book", "symbol", "data"}`, S1 | route on `event`, then `symbol`. The same symbol is repeated in `data.symbol` |
| subscribe acknowledgement shape | not documented | the request echoed with `"result":"subscribed"`. An unsubscribe is answered by a bare `{"event":"unsubscribe"}` |
| symbol identifier format | `B2M/EUR`, S1 | identical to `symbol` in `GET /v1/trading/market-config` on 287 of 287 markets, and to the `id` the unmerged CCXT class would give, see [`rest.md`](./rest.md) section 2. `BTC-EUR` is refused |
| number representation | JSON numbers, `[0.012, 4800]`, S1 | price and size are JSON numbers in every frame. `XAUT/USD` levels carry a third number, see section 4 |
| timestamp representation | only `nonce` in the example, S1 | 241 and 243 markets send `timestamp` in integer ms and `datetime` as ISO text with microseconds. The other markets send no time at all |
| size unit | Not publicly specified | base currency: BTC/EUR sizes equal the REST book in BTC on the top 20 levels of both sides in both runs |
| sequence semantics | a `nonce` field with no rule, S1 | no sequence. On most markets `nonce` never changes, on the rest it changes on every frame like a clock, section 4 |
| idle repeat behaviour | not documented | no identical frame on BTC/EUR or ETH/EUR in either run, 1 in 83 and 0 in 82 BTC/USDC frames. A quiet book sends nothing at all |

## 4. The book channel in detail

### Snapshot on subscribe

There is none.
The acknowledgement comes within about 200 ms, and the first book frame comes only when the book next changes.

| market | first frame after its subscribe, run 2 | frames in 40 s, run 1 and run 2 |
|---|---|---|
| BTC/EUR | 558 ms | 37 and 37 |
| ETH/EUR | 354 ms | 37 and 38 |
| BTC/USDC | 465 ms | 83 and 82 |
| PERP/EUR | 1,149 ms, and about 9.7 s in run 1 | 1 and 5 |
| B2M/EUR | none | 0 and 0 |

`GET /v2/trading/order-book?symbol=B2M/EUR` returned 50 bids and 76 asks in both runs while the socket sent nothing, see [`rest.md`](./rest.md) section 5.
In `batch`, 29 of 281 enabled markets in run 1 and 22 in run 2 sent no frame in the 40 s after the last subscribe.
So a feed has to seed every market from the REST book, or it holds no book for a quiet market.

### Delta semantics

There are no deltas.
Every frame is the whole book the server holds for that market, and it replaces the previous one.
BTC/EUR and ETH/EUR frames carried 100 bids and 100 asks on every frame of both runs, and BTC/USDC carried 138 bids and 35 asks on every frame.
The first 20 levels of a BTC/EUR frame equalled the REST book level for level on both sides in both runs, with the frame 701 ms and 168 ms old at the REST read.

### Cadence

| market | interval between frames, run 1 | run 2 |
|---|---|---|
| BTC/EUR | min 1,002, median 1,063, max 2,015 ms | min 993, median 1,059, max 1,338 ms |
| ETH/EUR | min 1,003, median 1,054, max 1,381 ms | min 967, median 1,030, max 1,268 ms |
| BTC/USDC | min 246, median 507, max 798 ms | min 292, median 500, max 707 ms |

Most books are conflated to about one frame a second, so a price can be up to a second old when it arrives.
The cadence is Not publicly specified.

### Two book sources

The frames fall into shapes that differ by market, counted by the last frame of each market in `batch`.

| shape of `data` | `nonce` | markets, run 1 and run 2 | examples |
|---|---|---|---|
| `bids`, `asks`, `timestamp`, `datetime`, `nonce`, `symbol` | fixed for the life of the book | 241 and 243 | BTC/EUR, ETH/EUR, ADA/USDC, ALGO/USDC |
| `symbol`, `bids`, `asks`, `nonce` | a new value on every frame, close to the send time in ms | 9 and 13 | BTC/USDC, ETH/USDC, BTT/USDC, FLOCK/USDC, FLOCK/EUR, EURC/EUR, BTC/EURCV, SOL/EURCV |
| `symbol`, `bids`, `asks`, `nonce` | fixed | 1 and 2 | ETH/USDCV in run 1, B2M/EUR and EUROD/USDC in run 2 |
| as above, with three numbers per level | fixed | 1 and 1 | XAUT/USD |

The fixed `nonce` of BTC/EUR was `1790117175928` in both runs and in the REST book, a time about four hours before the probe, so it marks a book instance and not an update.
A changing `nonce` also counts nothing: BTC/USDC went from `1790132153273` to `1790132153851` between two frames.
The BTC/USDC book looked unlike the EUR book: 138 bids and 35 asks on every frame, 0.5 to 2.9 BTC at the touch, and a spread of 39 to 45 USDC in the frames and REST reads captured, against 0.1 to 1.1 EUR on BTC/EUR.
Why some markets use the second source is Not publicly specified.
On REST, the third number of a B2M/EUR level is price times size, for example `[0.005228, 1256.48318776, 6.56889410560928]`.

### Sequence and gap rule

```text
order-book frame   replace the whole book for data.symbol (resetBook), nothing to chain
no frame           the book has not changed, or the market is quiet, or the stream is dead
```

No gap can be detected, since nothing is sequenced.
A missed frame is healed by the next frame of the same market.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| source | bids | asks |
|---|---|---|
| socket, every frame of both runs on five markets | best first, descending | best first, ascending |
| REST order book, five markets in both runs | descending | ascending |

`framesOutOfOrder` was 0 on every market of the `book` runs.

### Level window

The server sent at most 100 levels per side on the fixed nonce markets, in frames and in the REST book.
Across `batch`, the deepest bid side a market sent had a median of 45 levels in run 1 and 44 in run 2, a minimum of 3 and 2, and a maximum of 138.
The engine keeps 20 levels per side, at `server/src/engine/Engine.ts` line 61, so a liquid market fills it and many do not.

### Size unit

Sizes are base currency amounts, for example `0.17346753` BTC at the BTC/EUR touch in the REST compare.
Bit2Me Pro has only spot markets, so no contract size applies, and the unmerged CCXT class sets `contractSize` to `undefined`, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

No frame of 6,161 in run 1 and 6,598 in run 2 had an empty side.
The frozen market `B2M/USDR` was acknowledged as `subscribed`, and its REST book was empty on both sides.
The tickers call showed no ask on `WIN/USDC`, `BTC/EURR` and `SOL/EURCV` in run 2, and on three markets in run 1.
What the socket sends for a side that empties is Not verified, and the engine's `resetBook` accepts an empty side.

### Idle repeats

Nothing is repeated for a quiet book.
B2M/EUR sent 0 frames in 40 s in both `book` runs, and BTC/EUR sent no identical frame.

### Unknown, closed and repeated subscriptions

| request | reply | then |
|---|---|---|
| `order-book` `NOPE/EUR` | `"error":"symbol is not supported"` | |
| `order-book` `BTC-EUR` | `"error":"symbol is not supported"` | |
| `order-book` with no `symbol` | `"error":"symbol is not supported"` | |
| `order-book` `B2M/USDR`, a frozen market | `"result":"subscribed"` | no frame |
| `subscription.name` `nope` | none within 0.9 s | |
| `event` `nope` | none within 0.9 s | |
| `ETH/EUR` subscribed twice | `"result":"subscribed"` again | 7 frames in the 8 s before the repeat and 8 in the 8 s after it, so no duplicate stream |
| unsubscribe `ETH/EUR` | `{"event":"unsubscribe"}` | no ETH/EUR frame in the 11 s that followed |
| private channel `my-trades` without a login | `{"error":"Forbidden"}` | the socket stays open |
| text that is not JSON | none within 7.5 s | the socket stays open |

The feed has to notice a market that never sends a frame on its own, because an acknowledgement promises nothing.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | not documented for public channels | the server sent a protocol ping every 20 s on every socket, at 20.3, 40.3, 60.3, 80.3 and 100.3 s. `ws` answers these with a pong on its own. `{"event":"ping"}` is answered with `{"event":"pong"}` |
| silence the server tolerates | Not publicly specified | a socket that never subscribed and sent no frame of its own, only the automatic pongs, stayed open for 100 s in both runs |
| forced disconnect | Not publicly specified | none in 100 s |
| maintenance notice | none on the socket, S4 names the status page | not observed |
| compression | Not publicly specified | offered `permessage-deflate`, the server negotiated it with `server_no_context_takeover; client_no_context_takeover`. With `perMessageDeflate: false`, as the engine opens sockets at `server/src/feeds/book/VenueFeed.ts` line 81, frames arrive as plain JSON text |
| handshake | | 259 to 336 ms to open over the probe runs |
| subscription limits | 50 subscribe messages a second per connection, 50 concurrent connections per IP, S3 and S4 | 281 markets on one socket |
| throughput | | every enabled market on one socket: median 137 and 145 frames a second, peaks 160 and 200, 333 and 356 KB a second, 2,858 and 2,857 bytes a frame, 66 and 53 µs of `JSON.parse` a frame |

The frames are large because every one is a whole book.
Averaged over the socket's life, including the 11 s of subscribing, one socket carried 333 and 356 KB a second for the whole venue.

## 6. Captured frames

Trimmed, from run 2 of `book`.
Level arrays are cut to three per side.

Subscribe and acknowledgement.

```json
{"event":"subscribe","symbol":"BTC/EUR","subscription":{"name":"order-book"}}
```

```json
{"event":"subscribe","symbol":"BTC/EUR","subscription":{"name":"order-book"},"result":"subscribed"}
```

A book from the fixed nonce source, whose frames carry a time.

```json
{"event":"order-book","symbol":"BTC/EUR","data":{"bids":[[75597.8,0.04338462],[75597.7,0.1735385],[75590,0.00264585]],"asks":[[75597.9,0.00016686],[75598.3,0.04338424],[75598.4,0.17353699]],"timestamp":1790132153252,"datetime":"2026-09-23T02:55:53.252036Z","nonce":1790117175928,"symbol":"BTC/EUR"}}
```

A book from the changing nonce source, with no time field.

```json
{"event":"order-book","symbol":"BTC/USDC","data":{"symbol":"BTC/USDC","bids":[[86433.35,2.53630889],[86432.7,1.35619923],[86429,0.39476723]],"asks":[[86472.73,1.44209902],[86472.8,0.002013],[86472.9,0.002013]],"nonce":1790132153273}}
```

A trade.

```json
{"event":"public-trades","symbol":"BTC/EUR","data":{"side":"buy","price":75626.4,"amount":0.00316965,"timestamp":1790132165678}}
```

Keepalive.

```json
{"event":"ping"}
```

```json
{"event":"pong"}
```

Errors and the unsubscribe answer.

```json
{"event":"subscribe","symbol":"NOPE/EUR","subscription":{"name":"order-book"},"error":"symbol is not supported"}
```

```json
{"error":"Forbidden"}
```

```json
{"event":"unsubscribe"}
```

## 7. Private channels

Named for a future execution stage, from S1, not probed.
They use the spot URL after `{"event":"authenticate","token":"…"}`, where the token comes from `POST https://gateway.bit2me.com/v1/signin/apikey` and is valid for one minute.

- Channels: `my-trades`, `my-orders`, `executions`, `my-balance`, `my-working-capital`.
- Commands: add order, add orders in a batch, cancel order, cancel orders in a batch, cancel all orders, and `auto-cancel-orders-on-disconnection` as a kill switch.
- S2 says the futures socket takes `{"token": "the-token"}` for its private channels, which it does not name.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
Bit2Me cannot be a perpetual leg, so this shape applies only if a spot leg is ever modelled, and CCXT 4.5.68 has no class to give it a catalog.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan, `wss://ws.bit2me.com/v1/trading` | every quote currency on one socket |
| channel | `order-book`, one subscribe frame per market | the only book channel |
| markets per connection | all enabled markets, 281 on 2026-09-22 | 281 ran on one socket at a median 145 frames a second |
| subscribe frames | `{"event":"subscribe","symbol":<rawMarketId>,"subscription":{"name":"order-book"}}`, paced at no more than 40 a second | the connection closes with `4001` above 50 messages a second |
| seeding | `GET /v2/trading/order-book?symbol=<rawMarketId>` for each market after its acknowledgement, paced inside 600 requests a minute | no snapshot on subscribe, and a quiet book never sends one |
| snapshot | every frame: `resetBook` with the frame's bids and asks, then `publish` | each frame is the whole book |
| resync | none by sequence. On reconnect, resubscribe and reseed | nothing is sequenced, so there is no gap to catch |
| keepalive | none needed. Optionally `{"event":"ping"}` every 15 s | the server pings every 20 s, and `VenueFeed` counts a protocol ping as traffic at `server/src/feeds/book/VenueFeed.ts` line 97 |
| `maxSilenceMs` | 45,000 | two missed server pings. Book frames cannot be the signal, because a quiet market sends none |
| unserved stream | log a market with neither a frame nor a REST seed | the socket acknowledges a frozen market and then sends nothing |
| receive time | stamp on arrival, and treat the book as up to a second old | about one frame a second on most markets, and half the markets carry no time field |
| deflate | keep `perMessageDeflate: false` | the server compresses only when asked |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Pro (Trading Spot) WebSockets API, OpenAPI file `trading-spot-websockets.json` | https://api.bit2me.com/openapi/trading-spot-websockets.json | 2026-09-22 | Bit2Me | URL, channels, frames, authentication, private channels, sections 1 to 7 |
| S2 | Futures WebSockets API, OpenAPI file `futures-websockets.json` | https://api.bit2me.com/openapi/futures-websockets.json | 2026-09-22 | Bit2Me | the futures URL, channels and example publications, section 1 |
| S3 | Bit2Me API Gateway, tag "Pro (Trading Spot)", section "WebSockets Rate Limits", in `crypto.json` | https://api.bit2me.com/openapi/crypto.json | 2026-09-22 | Bit2Me | messages per second per command, section 3 |
| S4 | Bit2Me API Gateway, sections "WebSockets", "Reconnect policy" and "Status", in `crypto.json` | https://api.bit2me.com/openapi/crypto.json | 2026-09-22 | Bit2Me | 50 connections per IP, 50 messages a second, close codes `4000` and `4001`, sections 3 and 5 |
| P1 | `ws-probe.mjs book`, run 1 at 02:48 UTC and run 2 at 02:55 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/bit2me/ws-probe.mjs) | 2026-09-22 | this host | sections 2 to 4 and 6 |
| P2 | `ws-probe.mjs batch`, run 1 at 02:50 UTC and run 2 at 02:57 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bit2me/ws-probe.mjs) | 2026-09-22 | this host | shapes, window, throughput, sections 3 to 5 |
| P3 | `ws-probe.mjs session`, run 1 at 02:50 UTC and run 2 at 02:57 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bit2me/ws-probe.mjs) | 2026-09-22 | this host | pings and silence, section 5 |
| P4 | `ws-probe.mjs deflate` and `futures`, run 1 at 02:52 UTC and run 2 at 02:58 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/bit2me/ws-probe.mjs) | 2026-09-22 | this host | compression and the futures socket, sections 1 and 5 |
| P5 | reconnaissance sockets before the probe was written, 02:38 to 02:42 UTC | not kept | 2026-09-22 | this host | the extra futures frame shapes in section 1 |
