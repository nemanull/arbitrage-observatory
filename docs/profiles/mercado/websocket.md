# Mercado Bitcoin WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-09-22.

**Probed:** 2026-09-22, from the development host near Seattle, at 04:33 to 04:40 UTC and again at 04:42 to 04:46 UTC on 2026-09-23 by the UTC clock, through the laptop's Surfshark WireGuard exit that geolocates to Canada.

This profile covers the public WebSocket of Mercado Bitcoin (CCXT id `mercado`) for its spot market, because the venue lists no perpetual, see [`fees.md`](./fees.md) section 3.
CCXT 4.5.68 has no Pro class for this venue, so nothing below comes from CCXT.
Every protocol claim was captured by [`ws-probe.mjs`](../../../scripts/probes/venues/mercado/ws-probe.mjs), cited as P1 to P6, and is set beside the documented value from the ledger in section 9.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
All access results are from a Canadian VPN exit, and the sockets were held for about 14 minutes in total over both passes, most of it in the silence tests.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| spot, every quote | `wss://ws.mercadobitcoin.net/ws` (S1) | open in 203 to 295 ms over every socket of both passes, `cf-ray` ending `-SEA` |
| perpetuals, futures, options | none | none exist |

One socket carries every market and every quote.
`USDTBTC`, the `BTC-USDT` book, delivered on the same socket as the BRL books (P1).
`ws.mercadobitcoin.net` resolved to 104.18.80.40 and 104.18.81.40, see [`rest.md`](./rest.md) section 1.

## 2. Channel matrix for public market data

| channel | subscription | depth and speed | probed |
|---|---|---|---|
| `orderbook` | `{"type":"subscribe","subscription":{"name":"orderbook","id":"BRLBTC","limit":20}}` | `limit` 10, 20, 50, 100 or 200, pushed when the book changes | a whole top-N book in every frame, no snapshot on subscribe, section 4 |
| `ticker` | `{"type":"subscribe","subscription":{"name":"ticker","id":"BRLBTC"}}` | on change | `BRLBTC` sent 17, 12 and 2 frames in windows of 45, 45 and 30 s, the first at 0.5, 8.4 and 25.7 s, so no snapshot either |
| `trade` | `{"type":"subscribe","subscription":{"name":"trade","id":"BRLBTC"}}` | on trade | acknowledged, and 0 frames on `BRLBTC` in all three windows |
| best bid and ask | none | | the ticker's `buy` and `sell` |
| mark, index, funding | none | | none exist |

The channel names and payloads are from S2 and S3.
S2's field table lists the names as `ticker`, `orderbook` and `trades`, while its examples use `trade`.
The wire takes `trade` and answers `trades` with `{"type":"error","message":"unknown subscription name"}` (P1).

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one production URL (S1) | one socket served BRL and USDT quoted books, section 1 |
| subscribe frame shape | one stream per frame, `type` `subscribe` and a `subscription` object of `name`, `id` and `limit` (S2) | 401 frames sent in 2 to 5 ms were all acknowledged, one ack each |
| unknown symbol expectation | not in the error list of S4 | `{"type":"error","message":"invalid pair to subscribe"}`, which names no symbol. A tokenised asset, `BRLRFDCS21`, was acknowledged and sent nothing |
| chunk unit and budget | Not publicly specified | 401 subscriptions on one socket, no error, no close |
| keepalive mechanism | client `{"type":"ping"}`, server `{"type":"pong"}` (S2) | pong in 85 to 105 ms, no server protocol ping on any socket |
| connection lifetime and maintenance notice | "Do a reconnection if a connection is closed." (S1) | no notice and no forced close on a socket that kept receiving, the longest held 65 s |
| handshake and operation rate limits | Not publicly specified | no refusal at 401 subscribe frames in one burst |
| public market data authentication | none. "A `User-Agent` header **SHOULD** be sent to pass security restrictions" (S1) | none, and a socket with no `User-Agent` header received 491 and 502 book frames |
| message parse and routing | fields `type`, `ts`, `id`, `limit` and `data` (S3) | book, ticker and trade frames route on `type` then `id`. Acks carry no `type` |
| subscribe acknowledgement shape | `{"id": "BRLBTC", "name": "orderbook", "limit": 10}` (S2) | identical, 88 to 116 ms after the subscribe |
| symbol identifier format | `BRLBTC`, quote then base (S2) | identical to CCXT `market.id` on 1,451 of 1,451 markets. The v4 REST spelling `BTC-BRL` is refused with `invalid pair to subscribe` |
| number representation | orderbook `price` and `volume` float, ticker fields string (S3) | orderbook levels `[446327,0.00674804]` as JSON numbers, ticker fields strings |
| timestamp representation | `ts` and `data.timestamp` in nanoseconds (S3) | 19 digit JSON integers, which a double rounds to about 256 ns. Ticker `data.date` in seconds |
| size unit | "Volume" (S3) | base currency, the same numbers as the REST book, section 4 |
| sequence semantics | none documented | none on the wire. Every frame is a whole book |
| idle repeat behaviour | not documented | a frame identical to the previous one is common: 263 of 574 and 31 of 174 `BRLBTC` frames at limit 20 |

## 4. The book channel in detail

`orderbook` at `limit` 20 is the channel this profile describes, and every row below is about it unless it says otherwise.

### Snapshot on subscribe

There is none.
Each frame holds the whole top-N book, but the server pushes a market only when its book changes, so a quiet market sends nothing after the acknowledgement.

| test | result |
|---|---|
| 401 BRL `CRYPTO` books on one socket, 40 s and then 30 s (P3) | 239 and 235 sent a first frame, 162 and 166 sent nothing. First frames at a median of 3,665 and 2,483 ms and at most 37,795 and 29,162 ms after the subscribe |
| `BRLWCT`, `BRLRLC` and `BRLBADGER` alone, 30 s and then 20 s (P4) | 0 frames, while the REST book held 12 bids and 20 asks, 20 and 20, and 11 and 19 levels |
| `BRLRON` and `BRLBERA` alone (P4) | `BRLRON` first frame at 29.1 s and then 13.6 s, `BRLBERA` at 1.2 s and then 16.8 s |
| `BRLCOMP` in the book run (P1) | first frame at 1.6 s, 0.15 s and 10.6 s in three runs |

So a feed has to seed each book from the REST call of [`rest.md`](./rest.md) section 5, which is limited to one request per second, or leave a market without a book until it changes.

### Delta semantics

There are no deltas.
Each frame's `data.bids` and `data.asks` are the complete top-N sides, and a feed replaces its book with them.
At the same instant the 20 socket bids equalled the 20 REST bids price for price and size for size, in both passes (P1).

### Sequence and gap rule

No frame carries a sequence number or a checksum, and none is documented.
`ts` is the time the server sent the frame, and `data.timestamp` the time the book was built, 3 to 6 ms earlier on a median frame (S3, P1).
Because every frame replaces the whole book, a gap rule is not needed, and a frame lost with a dropped socket is repaired by the next frame for that market.

### Checksum

None is documented, and no frame carries one.

### Level order on the wire

| frame | bids | asks |
|---|---|---|
| `orderbook` at every limit tried | descending on every frame of every stream in both passes | ascending on every frame |
| REST v4 book | descending, although the REST reference documents both sides ascending, see [`rest.md`](./rest.md) section 5 | ascending |

### Level window

The `limit` belongs to the socket, not to the stream.
The most recent subscribe sets the depth of every `orderbook` stream on that socket, in both `limits` runs (P2):

```text
0 s  subscribe BRLBTC limit 50    BRLBTC frames: 50 levels
4 s  subscribe BRLETH limit 20    BRLETH and BRLBTC frames: 20 levels
8 s  subscribe BRLUSDT limit 200  BRLUSDT, BRLETH and BRLBTC frames: limit 200
```

The first book run of the first pass subscribed limits 20, 200, 50 and then 10, and every stream on it delivered `limit: 10` frames of 10 levels, although each acknowledgement echoed the limit asked for (P1).
A stream alone on a socket delivered 200 levels at `limit` 200 and 100 at `limit` 100 (P2).
A book with fewer levels sends what it has: `BRLUSDT` at 200 sent 98 to 100 bids and 116 to 119 asks.
Any other `limit`, or none, is refused with `{"type":"error","message":"for orderbook, {limit} must be 10, 20, 50, 100, 200"}`.

### Size unit against CCXT `contractSize`

| market | CCXT `contractSize` | socket size at the touch | REST size at the same instant |
|---|---|---|---|
| `BRLBTC` | undefined | `0.00674804` | `"0.00674804"` |
| `BRLUSDT` | undefined | `5844.7905` | not compared |
| `BRLETH` | undefined | `0.027091` | not compared |

Sizes are base currency units, and CCXT leaves `contractSize` undefined, which the connector reads as 1, so no conversion is needed.

### One-sided and empty books

No one-sided or empty frame was seen.
`USDTBTC` delivered 14 and 15 bids against 20 asks, and `CLV-BRL` has an empty REST book, see [`rest.md`](./rest.md) section 5.
An empty book never changes, so it presumably never sends a frame, which is an inference.

### Idle repeats and cadence

| stream at limit 20 | frames | identical to the previous frame | gap median | gap max |
|---|---|---|---|---|
| `BRLBTC` | 574 in 45 s, 174 in 30 s | 263, 31 | 16 and 55 ms | 1,777 and 2,784 ms |
| `BRLETH` | 284, 220 | 120, 54 | 60 and 46 ms | 1,630 and 2,223 ms |
| `BRLUSDT` | 273, 191 | 48, 17 | 73 and 88 ms | 2,023 and 2,116 ms |
| `BRLCOMP` | 15, 20 | 0, 0 | 226 and 765 ms | 22,418 and 3,194 ms |

At limit 10 in the first run, 430 of 764 `BRLBTC` frames repeated the previous one.
A repeat is most likely a change below the window, which is an inference, and it is harmless to a feed that replaces the book.

### Unknown, closed and wrong-spelling symbols

| request | reply, in both passes |
|---|---|
| `orderbook` `BRLSOL` 20, a second time | `{"type":"error","message":"already subscribed"}`, the first keeps delivering |
| `orderbook` `BRLSOL` 50 after `BRLSOL` 20 | `already subscribed` |
| `orderbook` `BRLNOPE` | `{"type":"error","message":"invalid pair to subscribe"}` |
| `orderbook` `SOL-BRL` | `invalid pair to subscribe` |
| `orderbook` `BRLXRP` 30, or no `limit` | `{"type":"error","message":"for orderbook, {limit} must be 10, 20, 50, 100, 200"}` |
| name `trades` or `nope` | `{"type":"error","message":"unknown subscription name"}` |
| `orderbook` `USDTBTC` | acknowledged, 20 asks and 14 or 15 bids |
| `orderbook` `BRLRFDCS21`, a tokenised asset | acknowledged, no frame in the 9 s the socket stayed open |
| `{"type":"nope"}` | `{"type":"error","message":"unknown message type"}` |
| `hello`, not JSON | `{"type":"error","message":"invalid character 'h' looking for beginning of value"}`, the socket stays open |
| `unsubscribe` of a stream never subscribed | no reply in the 5 s the socket stayed open, although S4 lists `not subscribed` |
| `unsubscribe` `BRLSOL` 20 | no reply, and 0 `BRLSOL` frames in the 3.5 s after it |

No error names the stream it refers to, so a feed that must know which subscribe failed has to send them one at a time or count replies in order.

## 5. Session

| item | documented | probed |
|---|---|---|
| keepalive | `{"type":"ping"}` answered by `{"type":"pong"}` (S2) | pong in 100 to 105, 89 to 91 and 85 to 89 ms in three book runs, and no server protocol ping on any socket |
| silence the server tolerates | "If a connection is made and no message is sent in `5 seconds`, the current connection is closed." (S1) | not 5 s. A socket that sent nothing closed 60.0 s after opening, in both passes, with code 1006 and no close frame. In the second pass a socket that sent one ping at 1 s closed 60.0 s after its pong. A socket that subscribed a busy book and then sent nothing stayed open for the whole hold, 60 s with 491 frames and then 65 s with 502 |
| forced disconnect | Not publicly specified | none on any socket, the longest 65 s |
| maintenance notice | Not publicly specified | none seen |
| compression | Not publicly specified | text JSON frames. A client that offered permessage-deflate got `sec-websocket-extensions: permessage-deflate` back in both passes, and a client that did not offer it got none |
| handshake | `User-Agent` "SHOULD" be sent, `Origin` may be (S1) | 203 to 295 ms to open, with or without a `User-Agent` header |
| subscription limits | Not publicly specified | 401 on one socket without error |
| throughput | | 401 BRL books at limit 20: 508 and 540 frames per second, a median second of 484 and 526, a peak second of 601 and 836, 362 and 383 KB per second, 712 and 708 bytes per frame, 19 and 16 µs of `JSON.parse` per frame |
| lag | `ts` is send time (S3) | a median frame arrived 41 to 57 ms after its `ts`, about half the pong round trip, see [`rest.md`](./rest.md) section 7 |

What resets the 60 s timer was not isolated.
The two closes fit a rule of 60 s without a frame in either direction, and a socket that only receives stayed open, so a ping every 15 s keeps a socket alive under either reading.
No socket with pings was held past 60 s, so that last point is an inference.
The engine opens sockets without a `User-Agent` header and without deflate, at [`VenueFeed.ts`](../../../server/src/feeds/book/VenueFeed.ts) line 81, and both work here.

## 6. Captured frames

Trimmed, from the probe runs of 2026-09-23 UTC.
Book frames keep three levels per side.

Subscribe, one stream per frame.

```json
{"type": "subscribe", "subscription": {"name": "orderbook", "id": "BRLBTC", "limit": 20}}
```

Acknowledgement.

```json
{"id":"BRLBTC","name":"orderbook","limit":20}
```

Book frame, bids descending and asks ascending.

```json
{"type":"orderbook","id":"BRLBTC","ts":1790138577211526746,"limit":20,"data":{"asks":[[446328,0.00674804],[446379,0.0517],[446382,0.0677054]],"bids":[[446327,0.00674804],[446167,0.00106674],[446105,0.00109286]],"timestamp":1790138577203546414}}
```

Book frame of a quiet market, its first frame 10.6 s after the subscribe.

```json
{"type":"orderbook","id":"BRLCOMP","ts":1790138587693050637,"limit":20,"data":{"asks":[[114.5,0.453776],[115,0.712903],[118.93,0.629675]],"bids":[[112.29,8.014961],[95.01,5.94801],[95,2]],"timestamp":1790138587689954330}}
```

Ticker.

```json
{"type":"ticker","id":"BRLBTC","ts":1790138602790869784,"data":{"high":"446821.00000000","low":"436167.00000000","vol":"22.41274093","last":"446341.00000000","buy":"446292.00000000","sell":"446293.00000000","open":"438113.00000000","date":1790138602}}
```

Keepalive.

```json
{"type": "ping"}
```

```json
{"type":"pong"}
```

Errors.

```json
{"type":"error","message":"already subscribed"}
```

```json
{"type":"error","message":"invalid pair to subscribe"}
```

```json
{"type":"error","message":"for orderbook, {limit} must be 10, 20, 50, 100, 200"}
```

## 7. Private channels

None are published.
The documentation's "Private Messages" page reads "Under construction" (S5), and trading is on the authenticated REST API only.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.
It describes a spot feed, which the engine cannot use today, because the connector keeps only swap markets and the quote family does not join BRL to USDT, see [`fees.md`](./fees.md) section 9.

| item | recommendation | reason |
|---|---|---|
| URL plan | `wss://ws.mercadobitcoin.net/ws` for every market | one URL serves all quotes |
| markets per connection | 200 | one socket carried 401 without error at up to 836 frames per second, and two halves keep one reconnect from blanking every book |
| subscribe frames | one per market, `{"type":"subscribe","subscription":{"name":"orderbook","id":"<rawMarketId>","limit":20}}`, the same `limit` on every frame | the last `limit` sent sets the depth of every stream on the socket |
| keepalive | `{"type":"ping"}` every 15 s | a socket without traffic closes at 60 s, and the pong counts as traffic for the silence watch |
| `maxSilenceMs` | 45,000 | three missed pongs, since a quiet market can send no book frame for minutes |
| routing | `type === 'orderbook'`, then `id` is the `rawMarketId` | acks have no `type`, errors have `type` `error` |
| book | every frame: `resetBook(id, bids, asks)`, then `publish` | each frame is the whole top 20 |
| seed | after each subscribe, one REST book per market at no more than one call per second, dropped once the first socket frame arrives | no snapshot on subscribe, and 162 to 166 of 401 books were silent for 30 to 40 s |
| resync | none on a sequence, since there is none. On a reconnect, subscribe and seed again | frames are self-contained |
| errors | log `type === 'error'` with the last subscribe sent | an error names no stream |
| receive time | stamp on arrival, and use `ts` only to measure lag | `ts` is a 19 digit integer beyond double precision |
| deflate | keep `perMessageDeflate: false` | the server negotiates it when offered, and the engine refuses it |

## 9. Source ledger

| id | title | URL | retrieved | entity or region | supports |
|---|---|---|---|---|---|
| S1 | MercadoBitcoin Websockets API v0.0.4, overview and connection details | https://ws.mercadobitcoin.net/docs/v0/README.md | 2026-09-22 | Mercado Bitcoin, Brazil | URL, `User-Agent`, 5 s rule, reconnect advice, sections 1, 3 and 5 |
| S2 | General Messages | https://ws.mercadobitcoin.net/docs/v0/api/GeneralMessages.md | 2026-09-22 | Mercado Bitcoin | ping, subscribe, unsubscribe, limits, sections 2, 3 and 5 |
| S3 | Public Messages | https://ws.mercadobitcoin.net/docs/v0/api/PublicMessages.md | 2026-09-22 | Mercado Bitcoin | frame fields, nanosecond timestamps, sections 2 to 4 |
| S4 | Errors | https://ws.mercadobitcoin.net/docs/v0/api/Errors.md | 2026-09-22 | Mercado Bitcoin | error shape and list, sections 3 and 4 |
| S5 | Private Messages, "Under construction", and the changelog, v0.0.4 of 2021-05-31 | https://ws.mercadobitcoin.net/docs/v0/_underconstruction.md and https://ws.mercadobitcoin.net/docs/v0/CHANGELOG.md | 2026-09-22 | Mercado Bitcoin | section 7 |
| P1 | `ws-probe.mjs book`, at 04:33 (limits 20, 200, 50 and 10 in that order), 04:35 and 04:42 UTC on 2026-09-23 | [`ws-probe.mjs`](../../../scripts/probes/venues/mercado/ws-probe.mjs) | 2026-09-22 | this host, Canadian VPN exit | sections 1 to 6 |
| P2 | `ws-probe.mjs limits`, at 04:35 and 04:43 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/mercado/ws-probe.mjs) | 2026-09-22 | this host | the socket-wide limit, section 4 |
| P3 | `ws-probe.mjs batch`, at 04:36 (40 s) and 04:44 UTC (30 s) | [`ws-probe.mjs`](../../../scripts/probes/venues/mercado/ws-probe.mjs) | 2026-09-22 | this host | no snapshot, throughput, sections 4 and 5 |
| P4 | `ws-probe.mjs quiet`, at 04:37 (30 s) and 04:44 UTC (20 s) | [`ws-probe.mjs`](../../../scripts/probes/venues/mercado/ws-probe.mjs) | 2026-09-22 | this host | quiet books against REST, section 4 |
| P5 | `ws-probe.mjs silence`, at 04:38 (four sockets, 60 s) and 04:45 UTC (three sockets, 65 s) | [`ws-probe.mjs`](../../../scripts/probes/venues/mercado/ws-probe.mjs) | 2026-09-22 | this host | silence, `User-Agent`, section 5 |
| P6 | `ws-probe.mjs deflate`, at 04:40 and 04:46 UTC | [`ws-probe.mjs`](../../../scripts/probes/venues/mercado/ws-probe.mjs) | 2026-09-22 | this host | compression, section 5 |
