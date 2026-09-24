# Independent Reserve WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22 local time, 2026-09-23 03:18 to 03:54 UTC, first pass and second pass, from the development host near Seattle.

This profile covers the public WebSocket of Independent Reserve (CCXT id `independentreserve`) for its spot market, because the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
Every protocol claim below was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/independentreserve/ws-probe.mjs), whose runs are the P rows of section 9, and the capture is quoted beside the documented value.
The venue documents one protocol, and that protocol closed every socket this host opened.
The aggregated book that works is a second protocol the venue does not document, and CCXT Pro is its only written description.

## 1. Endpoints

| protocol | URL | documented in | probed |
|---|---|---|---|
| aggregated book | `wss://websockets.independentreserve.com/orderbook/<depth>?subscribe=<base>-<quote>,…` | not by the venue, only by CCXT Pro at `server/node_modules/ccxt/js/src/pro/independentreserve.js` lines 29 and 146 | open in 610 to 696 ms, delivers, recommended |
| order-level events and trades | `wss://websockets.independentreserve.com/?subscribe=orderbook-xbt,ticker-xbt` | S1, S2 | upgrade 101, then the server closed the TCP connection 0 to 4 ms after open with code 1006 and no frame, on every variant in P1, P5 and the exploratory sockets |

The root path failed with the documented query, with a `Subscribe` message and no query, with the CCXT Pro trade channel `ticker-BTC-AUD`, with a pair qualified channel `orderbook-xbt-aud`, with a `User-Agent` header, and with an `Origin` of the venue's GitHub sample page.
A plain HTTPS GET of the root answered 500 with an empty body, and `/nope` answered 404, P1 and P5.
The documentation's troubleshooting section describes a 404 with the status "WebSockets disabled" when the server is down, S1, and neither was seen.
So the order-level protocol is Not verified to work anywhere, and this host could only use the aggregated book.

One aggregated book socket carries any base currency in any fiat currency.
168 pairs in one query string, 1,510 characters of URL, were all acknowledged and all delivered a snapshot, P3 and P5.

## 2. Channel matrix for public market data

| channel | subscribe as | content | probed |
|---|---|---|---|
| `orderbook/<depth>/<base>/<quote>` | path `/orderbook/<depth>`, query `subscribe=xbt-aud`, or a `Subscribe` message | aggregated price levels: one snapshot, then changes with a CRC32 of the top ten levels per side | depths 7, 10, 20, 50, 100, 1000 and 5000 all served, P1 and exploratory sockets |
| `orderbook-<crypto>` | root path, S1 | order-level `NewOrder`, `OrderChanged`, `OrderCanceled` with a per channel `Nonce`, prices in all four fiat currencies in one event | closed at once, section 1 |
| `ticker-<crypto>` | root path, S1 | `Trade` events | closed at once, section 1 |
| best bid and ask, ticker, mark, index, funding | none | none | none exists |
| `Heartbeat` | automatic | `{"Time": …, "Event": "Heartbeat"}` | every 1 s on an idle socket, section 5 |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).
The documented column is the order-level protocol of S1, since the aggregated book has no venue documentation.

| axis | documented | probed on the aggregated book |
|---|---|---|
| endpoint split axis | one URL, channels per crypto, S1 | one host, depth in the path, pairs in the query, and one socket carries every base and every fiat |
| subscribe frame shape | `?subscribe=orderbook-xbt,ticker-xbt` on the URL, or `{"Event":"Subscribe","Data":["orderbook-xbt","ticker-xbt"]}`, S1 | both forms work with pair names: `?subscribe=xbt-aud,eth-aud`, or `{"Event":"Subscribe","Data":["eth-aud","xbt-usd"]}` on `/orderbook/10`. `{"Event":"Unsubscribe","Data":["eth-aud"]}` removes one |
| unknown symbol expectation | an `Error` event, and a 400 for a bad query string, S1 | an unknown code in the query gets an `Error` event and then a close with 1006 within 4 ms. An unknown code in a `Subscribe` message gets an `Error` event and the socket stays open. Two valid codes that make no market, `sol-usdt`, are acknowledged and stay silent |
| chunk unit and budget | Not publicly specified | 168 pairs in one query were acknowledged in one frame and all snapshots arrived within 1,350 to 1,357 ms, P3 and P5 |
| keepalive mechanism | "A heartbeat event is published every 60 seconds. This interval may change in the future.", S1 | a `Heartbeat` event after about one second without other traffic, no server protocol ping, and an unsolicited protocol pong at about 120.6 s, section 5 |
| connection lifetime and maintenance notice | 404 with "WebSockets disabled" when the server is unavailable, S1 | no close in 126 s on any socket that subscribed correctly, and no notice seen |
| handshake and operation rate limits | Not publicly specified | none reached, about 40 sockets opened over the probe runs |
| public market data authentication | none | none |
| message parse and routing | `{Channel, Nonce, Data, Time, Event}`, S1 | `{Channel, Data, Time, Event}`, route on `Channel`, spelled `orderbook/50/btc/aud` |
| subscribe acknowledgement shape | `{"Event":"Subscriptions","Data":[…],"Time":…}` listing the current subscriptions, S1 | the same. It lists every subscription on the socket after each change, and `"Data":[]` on a socket with none |
| symbol identifier format | primary currency code, `xbt`, S1 | the query takes `xbt-aud`, `btc-aud`, `BTC-AUD` or `Xbt-Aud`, and two spellings of one pair collapse into one channel. The channel is always lower case with `btc`. CCXT `market.id` is `Xbt/Aud`, see [`rest.md`](./rest.md) section 2 |
| number representation | JSON numbers, S1 | JSON numbers for `Price` and `Volume`, sometimes with trailing zeros kept in the text, `121962.0` and `0.33945700`. `Crc32` is an unsigned 32 bit integer |
| timestamp representation | `Time` in Unix ms, S1 | `Time` in Unix ms, 74 to 330 ms before arrival, median 77 to 84 ms, P2 and P5 |
| size unit | "Order volume in primary currency", S3 | base currency, which CCXT's missing `contractSize` of 1 matches, section 4 |
| sequence semantics | `Nonce` per channel, "A nonce will increase by exactly 1 with every published event on the channel", S1 | no `Nonce` and no update id on any frame. The only integrity check is `Crc32`, section 4 |
| idle repeat behaviour | not documented | no repeated frame. An idle socket gets a `Heartbeat` each second instead |

## 4. The book channel in detail

`orderbook/50` is the channel this profile measured, and every row below is about it unless it says otherwise.
Four pairs, `xbt-aud`, `eth-aud`, `xbt-usd` and `zrx-nzd`, ran on one socket for 60 s in two runs, P2, and for 45 s in the second pass, P5.

### Snapshot on subscribe

The `Subscriptions` acknowledgement and an `OrderBookSnapshot` per pair arrive together, 638 to 817 ms after the socket was created in P2 and P5.
Each snapshot held 50 bids and 50 asks on the four pairs, and each channel got exactly one snapshot in each run.
In P5 two `eth/aud` deltas arrived before its snapshot, and every checksum after the snapshot matched with those two skipped, so a feed drops deltas until the snapshot arrives.
A thin pair gets fewer: 100 of the 168 channels had a snapshot with fewer than 50 levels on at least one side, P3.

### Delta semantics

An `OrderBookChange` carries `Bids` and `Offers` arrays of `{"Price", "Volume"}`, and `Crc32`.
`Volume` is the new total at that price, and `0` deletes the level.
The deltas averaged 1.5 entries and held at most 3, with no empty delta, P2 and P5.
About half the entries were deletes: 830 zero-volume entries in 1,648 `btc/aud` deltas in the second run.
The common shape is one level deleted inside the window and the next level beyond the window added in the same frame, as in the first delta of section 6.
A delta can delete and re-add one price in the same frame, `[{"Price":121856.01,"Volume":0},{"Price":121856.01,"Volume":0.345489}]`, so entries must be applied in array order.

### Sequence and gap rule

There is none on this channel.
No frame carries `Nonce` or an update id, and `Time` never went backwards on any channel over about 238,000 batch frames, P3 and P5.
The documented `Nonce` rule belongs to the root protocol, which closed every socket.
The `Crc32` of each frame is the only way to notice a lost or merged update, and on a mismatch the book has to be taken again by resubscribing.

### Checksum

`Crc32` is the CRC-32 of the top ten bids, best first, followed by the top ten asks, each price and then its volume written with eight decimals, the point removed and leading zeros dropped, as CCXT Pro builds it at `pro/independentreserve.js` lines 209 to 235 and 240 to 247.
It covers the book after the frame is applied, and a snapshot carries one too.

| run | channel | frames checked | matched |
|---|---|---:|---:|
| P2 second run, 4 pairs | `btc/aud`, `eth/aud`, `btc/usd`, `zrx/nzd` | 1,649, 2,059, 1,651 and 1,118 | all |
| P3, the 42 AUD pairs on one socket, 537 frames/s | all 42 | 16,105 | 16,104, the one miss being the snapshot of `ausd/aud`, 10 bids and 7 asks |
| P3, all 168 pairs on one socket, 2,403 frames/s | 168 | 72,061 | 33,202, with 110 channels diverged, the first miss anywhere from 1 s to 30 s after open |
| P5, 4 pairs for 45 s | `btc/aud`, `eth/aud`, `btc/usd`, `zrx/nzd` | 1,034, 704, 1,034 and 1,233 | all |
| P5, the 42 AUD pairs, 442 frames/s | all 42 | 11,047 | 11,046, the one miss again the `ausd/aud` snapshot |
| P5, all 168 pairs, 1,982 frames/s | 168 | 49,525 | 43,915, with 67 channels diverged, the first miss from 1 s to 25 s after open |

The server sends `Crc32` unsigned.
CCXT Pro computes it signed, `this.crc32(payload, true)` at line 226, and compares it with `safeInteger` of the unsigned value at line 227, so CCXT fails every frame whose CRC is at or above 2^31.
That was 828 of 1,649 `btc/aud` frames in P2, and CCXT's option at line 34 carries the comment "TODO: currently only working for snapshot".

The 168 pair socket lost integrity while the 42 pair socket kept it, and `Time` stayed in order on both, so the loss is on the server side above about 2,000 frames a second on one socket.
That reading is an inference from four runs of 168 pairs, 25 to 45 s each, which all diverged, and two runs of 42 pairs, which did not.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| snapshot | best first, descending, on 4 of 4 pairs | best first, ascending, on 4 of 4 |
| delta | usually a delete and then a level further out, and 2 to 110 multi-entry arrays per pair and run were not strictly ordered, including same-price delete and re-add, P2 and P5 | same |
| REST `GetOrderBook` | descending | ascending |

### Level window

The server keeps each channel at its depth, and a level that leaves the window because a level is deleted above it is replaced by a refill at the edge.
A level pushed out by a new better level is not deleted on the wire.
A book kept from the snapshot and every delta, without trimming, grew to 52 to 66 levels per side on depth 50, P2 and P5, so a feed trims to the depth after each frame.
The checksum covers only the top ten, so trimming never affects it.

### Size unit against CCXT `contractSize`

`Volume` is in the base currency, "Order volume in primary currency", S3, and CCXT leaves `contractSize` undefined, which the connector reads as 1, see [`rest.md`](./rest.md) section 2.
After 60 s, 18 of the socket's top 20 `btc/aud` bids were in the REST book at the same price and volume, and 19 of the REST book's top 20 bids were on the socket, P2, and 18 and 18 in P5.
So the engine's `sizeMul` of 1 is right for this venue.

### Crossed books and levels the REST book does not have

The `btc/aud` and `eth/aud` socket books were crossed at the snapshot and after every frame in both runs of P2 and in P5, while the REST books of the same pairs were not.

| reading | socket | REST, read at the end |
|---|---|---|
| `btc/aud` best bid and best ask, second run of P2 | 121,992.07 and 121,721.98 | 121,992.06 and 122,106.9 |
| socket asks at or below the socket best bid | 5 | none |
| socket bids at or above the socket best ask | 8 | none |
| socket top 20 asks absent from the REST book by volume | `121721.98` for 0.01105704, `121731.99` for 0.01105704, `121732` for 0.2488, `121843.99` for 0.299052, all present since the snapshot | |

The same asks were in the `btc/aud` snapshots of 03:28, 03:29, 03:32 and 03:49 UTC, P1, P2 and P5, and of an exploratory socket at about 03:23 UTC, at the same AUD prices.
The same volumes sat in the `btc/usd` socket book at the converted price, `86919.44` USD for 0.01105704, above the best ask there, so that book was not crossed, P2 and P5.
None of these levels was in the AUD or the USD REST book in P2 and P5, and an exploratory socket at about 03:23 UTC found none of them in the REST books of all four fiat currencies, with the NZD socket book holding them at the converted NZD price.
None traded against the bids above it for at least 26 minutes.
Every frame's `Crc32` matched a book that contained them, so they are part of the server's socket book, not a client error.
Why the socket keeps them is Not publicly specified.

On the 42 AUD pairs, 8 channels were crossed at the end of 30 s, and 4,801 of 16,105 frames left a crossed book, P3, and 8 channels and 3,253 of 11,047 frames in P5.
So a feed of this channel would hand the engine crossed books whose crossing never trades, and it needs a guard that refuses a crossed book rather than a checksum.

### One book per base currency

Every order event arrives on the four fiat channels of its base currency.
On the 168 pair socket the four quotes got 17,974, 17,977, 17,974 and 17,968 deltas in 30 s, P3, and 12,339, 12,340, 12,341 and 12,337 in 25 s, P5, and paired `btc/aud` and `btc/usd` deltas carry the same `Time` and the same volume, section 6.
A socket that carries all four fiat currencies therefore carries four copies of every event, see [`rest.md`](./rest.md) section 2.

### One-sided and empty books

No one-sided or empty book was seen: every one of the 168 channels delivered a snapshot with both sides, P3 and P5.
`audm` and `audx` in every fiat and `ausd` and `dai` in AUD sent no delta in 30 s, P3, and `xaut/aud` joined them in P5.

### Idle repeats

No frame repeats.
A quiet channel sends nothing, and the socket gets a `Heartbeat` for each idle second.

### Unknown, closed and malformed requests

| request | reply | then |
|---|---|---|
| `/orderbook/10?subscribe=nope-aud` | `Error`, `"Invalid 'subscribe' parameter value: 'nope-aud'. Invalid currency code: 'nope'."` | close 1006 within 4 ms |
| `/orderbook/10?subscribe=xbtaud` | `Error`, `"… Invalid currency code: 'xbtaud'."` | close 1006 |
| `/orderbook/0?subscribe=xbt-aud` | `Error`, `"Invalid 'depth' parameter value: '0'. Marked depth must be a positive number."` | close 1006 |
| `/orderbook/abc?subscribe=xbt-aud` | HTTP 400 on the upgrade, a JSON problem body titled `"One or more validation errors occurred."` with `"The value 'abc' is not valid for Depth."` | no socket |
| `/orderbook/10?subscribe=sol-usdt` | acknowledged as `orderbook/10/sol/usdt` | heartbeats only for 6 s |
| `/orderbook/10?subscribe=xbt-eur` | acknowledged | a EUR snapshot and 32 and 40 deltas in 4 s, P1 and P5, although EUR is not a listed quote |
| `/orderbook/10?subscribe=xbt-aud,xbt-aud` | one channel acknowledged | normal |
| `{"Event":"Subscribe","Data":["orderbook/10/xbt/usd"]}` | `Error`, `"Invalid currency code: 'orderbook/10/xbt/usd'"` | the socket stays open |
| text that is not JSON, `hello` | nothing | close 1006 about 170 to 200 ms after it was sent |
| HTTPS GET of `/orderbook/10?subscribe=xbt-aud` | 400, `Only WebSocket connection is supported` | |

No closed or delisted market was available to probe, because the catalog has no status.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | a heartbeat every 60 s, S1 | a socket with no subscription got 120 `Heartbeat` events in 121 s, 947 to 1,061 ms apart, P4, and 125 in 126 s, 946 to 1,050 ms apart, P5. A socket on a quiet pair got the same in P5, and its longest gap between any two frames was 1,050 ms. Busy sockets got none, so the event fills idle seconds. No server protocol ping on any socket |
| unsolicited pong | not documented | a protocol pong arrived 120.61 to 120.65 s after open on all three sockets in P4 and in P5, two of which had never sent a ping |
| client ping | not documented | protocol pings every 20 s were answered with a pong each time, P4 and P5 |
| silence the server tolerates | Not publicly specified | sockets that never sent a frame stayed open for the whole 121 s and 126 s, with or without a subscription, P4 and P5 |
| forced disconnect | Not publicly specified | none in 126 s |
| maintenance notice | 404 "WebSockets disabled", S1 | not observed |
| compression | Not publicly specified | text JSON frames only. A client that offered permessage-deflate got no `sec-websocket-extensions` header back, P1 and P5 |
| handshake | | 610 to 696 ms to open from this host |
| subscription limits | Not publicly specified | 168 pairs on one socket accepted, and the checksum broke at that load, section 4 |
| throughput | | 4 pairs at depth 50: 89 to 107 frames/s, 16 to 19 KB/s, 184 to 186 bytes per frame, 1 to 1.5 µs `JSON.parse` per frame, P2 and P5. 42 AUD pairs: 537 and 442 frames/s. 168 pairs: 2,403 and 1,982 frames/s, 446 and 373 KB/s, P3 and P5 |

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Arrays marked `…` are cut.

Subscribe by URL, four pairs on one socket.

```text
wss://websockets.independentreserve.com/orderbook/50?subscribe=xbt-aud,eth-aud,xbt-usd,zrx-nzd
```

Acknowledgement.

```json
{"Data":["orderbook/50/btc/aud","orderbook/50/eth/aud","orderbook/50/btc/usd","orderbook/50/zrx/nzd"],"Time":1790134365199,"Event":"Subscriptions"}
```

Snapshot at depth 10, first three levels per side kept, crossed: the best ask sits under the best bid.

```json
{"Channel":"orderbook/10/btc/aud","Data":{"Bids":[{"Price":121940.01,"Volume":1.01760323},{"Price":121925.0,"Volume":0.05},{"Price":121911.25,"Volume":0.1834}],"Offers":[{"Price":121721.98,"Volume":0.01105704},{"Price":121731.99,"Volume":0.01105704},{"Price":121732.0,"Volume":0.24880000}],"Crc32":372447908},"Time":1790134138743,"Event":"OrderBookSnapshot"}
```

Deltas: a delete with a refill at the window edge, and a delete and re-add of one price.

```json
{"Channel":"orderbook/50/btc/aud","Data":{"Bids":[],"Offers":[{"Price":122319.99,"Volume":0},{"Price":124717.24,"Volume":0.00460100}],"Crc32":3428837379},"Time":1790134365245,"Event":"OrderBookChange"}
```

```json
{"Channel":"orderbook/50/btc/aud","Data":{"Bids":[{"Price":121856.01,"Volume":0},{"Price":121856.01,"Volume":0.345489}],"Offers":[],"Crc32":2545385048},"Time":1790134365254,"Event":"OrderBookChange"}
```

One order event on two fiat channels, with the same `Time`, from the first run of P2.

```json
{"Channel":"orderbook/50/btc/aud","Data":{"Bids":[],"Offers":[{"Price":122201.98,"Volume":0.0535}],"Crc32":2131632749},"Time":1790134185273,"Event":"OrderBookChange"}
```

```json
{"Channel":"orderbook/50/btc/usd","Data":{"Bids":[],"Offers":[{"Price":87262.2,"Volume":0.0535}],"Crc32":3010711087},"Time":1790134185273,"Event":"OrderBookChange"}
```

Heartbeat, and the acknowledgement on a socket with no subscription.

```json
{"Data":[],"Time":1790134602343,"Event":"Subscriptions"}
```

```json
{"Time":1790134603341,"Event":"Heartbeat"}
```

Errors.

```json
{"Data":"Invalid 'subscribe' parameter value: 'nope-aud'. Invalid currency code: 'nope'.","Time":1790134126027,"Event":"Error"}
```

```json
{"Data":"Invalid 'depth' parameter value: '0'. Marked depth must be a positive number.","Time":1790134145977,"Event":"Error"}
```

## 7. Private channels

None is documented on the socket.
The documented order-level stream carries each order's `ClientId`, "to react in an event driven way to events related to their orders", S1, and it is public.
Order entry and account data are private REST calls, `PlaceLimitOrder`, `PlaceMarketOrder`, `CancelOrder` and others, on `https://api.independentreserve.com/Private`, S3.

## 8. Recommended feed shape

A recommendation for a later design, not a decision, and only if spot legs are ever admitted, since the connector drops every spot market today, see [`fees.md`](./fees.md) section 9.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://websockets.independentreserve.com/orderbook/50?subscribe=<pairs>`, one socket per fiat currency | the only path that serves a book, and one fiat's 42 pairs ran at 442 to 537 frames/s with clean checksums |
| markets per connection | 42 at most, one fiat, and in practice only the 42 `-usd` pairs | 168 pairs on one socket broke the checksum on 67 and 110 channels |
| subscription | in the query string, `xbt-usd,eth-usd,…` | one acknowledgement lists them all |
| keepalive | none needed, a protocol ping every 20 s is harmless | the server sends a `Heartbeat` each idle second and never closed a silent socket |
| `maxSilenceMs` | 10,000 | a `Heartbeat` fills every idle second, so ten silent seconds is a dead socket |
| routing | `Channel` split on `/`: depth, base, quote, then `btc` back to `Xbt` for `market.id` | the channel never spells the CCXT id |
| snapshot | `OrderBookSnapshot`: `resetBook` | one per subscription |
| delta | drop deltas that come before the snapshot, apply entries in array order, `Volume` 0 deletes, then trim each side to the depth | early deltas, same-price delete and re-add, and silent push-outs |
| integrity | compute the unsigned CRC-32 of the top ten levels per side after each frame and `resync` on a mismatch | no sequence exists, and the server loses updates under load |
| crossed book | refuse a crossed book for the engine, without resyncing | the crossed levels are in the server's own book and survive a resubscribe |
| receive time | stamp on arrival, never from `Time` | `Time` is the server's stamp, 74 ms or more before arrival here |
| deflate | keep `perMessageDeflate: false` | the server does not negotiate it anyway |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | Order Book Ticker, `orderbook-ticker.md` | https://github.com/independentreserve/websockets/blob/master/orderbook-ticker.md, last commit 2024-01-08 | 2026-09-22 | Independent Reserve, all regions | documented URL, channels, subscribe and unsubscribe, `Subscriptions`, `Nonce`, heartbeat, troubleshooting, `ClientId`, sections 1 to 5 and 7 |
| S2 | JavaScript sample `orderbook.html` | https://github.com/independentreserve/websockets/blob/master/samples/JavaScript/orderbook-ticker/orderbook.html | 2026-09-22 | Independent Reserve | the root URL `wss://websockets.independentreserve.com/?subscribe=orderbook-xbt,orderbook-eth`, section 1 |
| S3 | API | https://www.independentreserve.com/features/api | 2026-09-22 | Independent Reserve, all regions | volume in primary currency, private method names, sections 3, 4 and 7 |
| S4 | CCXT Pro 4.5.68 `independentreserve.js` | `server/node_modules/ccxt/js/src/pro/independentreserve.js` | 2026-09-22 | CCXT | the aggregated book URL, event names, checksum recipe and its signed compare, sections 1, 2 and 4 |
| P1 | `ws-probe.mjs errors` at 03:28 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/independentreserve/ws-probe.mjs) | 2026-09-22 | this host | root path, errors, spellings, depths, messages, deflate, sections 1 to 5 |
| P2 | `ws-probe.mjs book`, two runs at 03:29 and 03:32 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/independentreserve/ws-probe.mjs) | 2026-09-22 | this host | snapshot, deltas, checksum, order, window, crossed levels, REST compare, sections 3 to 6 |
| P3 | `ws-probe.mjs batch`, runs at 03:34, 03:35 and 03:39 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/independentreserve/ws-probe.mjs) | 2026-09-22 | this host | 42 and 168 pairs on one socket, checksum under load, fan-out, sections 3 to 5 |
| P4 | `ws-probe.mjs silence` at 03:36 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/independentreserve/ws-probe.mjs) | 2026-09-22 | this host | heartbeat cadence, pong, silence, section 5 |
| P5 | second pass: `errors` at 03:48, `book` at 03:49, `batch` at 03:50 and `silence` at 03:51 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/independentreserve/ws-probe.mjs) | 2026-09-22 | this host | the second readings, deltas before a snapshot, sections 1 to 5 |
