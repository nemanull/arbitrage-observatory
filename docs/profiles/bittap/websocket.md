# BitTap WebSocket Profile

**Status:** Done.

**Retrieved:** 2026-10-09.

**Probed:** 2026-10-09 in Seattle time, which was 02:22 to 02:44 UTC on 2026-10-10, from the development host near Seattle through the Surfshark WireGuard exit in Canada.

This profile covers the public futures WebSocket of BitTap, which has one perpetual family, USDT-M linear perpetuals, with the book channel in detail.
Every protocol claim below was captured by [`ws-probe.py`](../../../scripts/probes/venues/bittap/ws-probe.py), [`anchor-probe.py`](../../../scripts/probes/venues/bittap/anchor-probe.py) or [`mark-all-probe.py`](../../../scripts/probes/venues/bittap/mark-all-probe.py), and the capture is quoted beside the documented value.
Where the documentation and the wire disagree, both are written, and the wire is what a feed must handle.
Sockets were held just under ten minutes of wall time over all runs, including the second pass.

## 1. Endpoints

| family | documented URL | probed |
|---|---|---|
| USDT-M perpetuals | `wss://stream.bittap.com/endpoint?format=JSON`, S4, S5 | opened in 249 and 335 ms on the two timed opens, through Cloudflare, and the first frame is `{"id":"<uuid>","type":"WELCOME"}` |
| private | the same URL, with a `LOGIN` method frame before `f_private`, S19. The website builds `?token=<token>` instead of `?format=JSON` for its private socket, S16. | not probed |

One socket carries every contract and every public channel.
The spot socket was not probed, since spot is not the researched product.

## 2. Channel matrix for public market data

| data | stream name | documented | probed |
|---|---|---|---|
| book, limited depth | `f_depth<level>@<symbol>_<scale>` | "The default value for level is 30", and `scale` is one of the contract's `depths`, S5 | only `f_depth30` exists. `f_depth1`, `f_depth5`, `f_depth10`, `f_depth20`, `f_depth50` and `f_depth100` each answered `{"code":"400006","msg":"Unknown topic f_depth5"}` and the like |
| best bid and ask | `f_bookTicker@<symbol>` | fields `b`, `B`, `a`, `A`, `u`, `E`, S20 | not probed |
| trades | `f_trade@<symbol>` | S4 example | not probed |
| ticker | `f_ticker@<symbol>` | 24 hour ticker | not probed |
| klines | listed in the docs navigation as "Kline (UTC+0 Timezone)" | page not read | not probed |
| mark, index and funding | `f_markPrice@<symbol>` | `p` mark, `I` "spot index price", `r` funding rate, `T` next funding time, `E` event time, S6 | one frame per contract per second, carrying all five fields, see [`rest.md`](./rest.md) sections 3 and 4 |
| all-market mark and ticker | not documented. The website's bundle names `f_markPrice_all` and `f_ticker_all`, S16 | `f_markPrice_all` sends one frame a second, `{"E":…,"data":[<f_markPrice row>, …],"e":"f_markPrice_all"}`, with a row for all 282 OPEN and 32 SETTLED contracts, about 40 KB per frame. `f_ticker_all` does the same for tickers, about 68 KB per frame. The guesses `f_markPrice@all` and a bare `f_markPrice` were acknowledged and delivered nothing, and `!markPrice@arr` answered `{"code":"400006","msg":"Unknown topic !markPrice"}` |

## 3. The sixteen axes

The axes are those of [`2026-07-30-venue-ws-protocol-differences.md`](../../research/2026-07-30-venue-ws-protocol-differences.md).

| axis | documented | probed |
|---|---|---|
| endpoint split axis | one URL, S4 | one URL for every contract and channel, section 1 |
| subscribe frame shape | `{"method":"SUBSCRIBE","params":["f_trade@BTC-USDT-M","f_depth30@BTC-USDT-M_0.1"],"id":1}`, S4 | as documented. 282 streams in one frame got one acknowledgement, and all 282 delivered |
| unknown symbol expectation | "Error Codes: No information available", S5 | `f_depth30@NOPE-USDT-M_0.1`, a lower-case `btc-usdt-m` and a stream with no scale are each acknowledged and then send nothing. An unknown channel answers `{"code":"400006","msg":"Unknown topic f_nope"}` |
| chunk unit and budget | Not publicly specified | 282 `f_depth30` streams on one socket delivered 1,117 and 1,119 frames per second, about 1.4 MB per second, for 15 s in each of two runs with no close |
| keepalive mechanism | `{"id":"…","method":"PING"}` answered with `{"id":"…","type":"ACK"}`, or a protocol ping answered with a pong, S4 | the `PING` method is answered `{"id":"922bcc6e","type":"PONG"}`, not `ACK`. A protocol ping got a pong in 102 to 103 ms. The server sends no ping of its own |
| connection lifetime and maintenance notice | Not publicly specified | a socket that never pings is closed at 60.1 s with close code 1000 and reason `Bye`, even while it receives a frame every second. A `PING` method or a protocol ping every 25 s kept a socket open past 75 s. No maintenance notice seen |
| handshake and operation rate limits | Not publicly specified | opens took 249 and 335 ms, and up to three sockets were open at once without a refusal |
| public market data authentication | none, S4 | none |
| message parse and routing | data frames carry `e` topic and `s` symbol, S5, S6 | the same. Route on `e`, then `s`, and for the book also `i`, the scale |
| subscribe acknowledgement shape | `{"code":0,"msg":"","topic":["",""],"id":1}`, S4, S5 | `{"id":"7","type":"ACK"}`, with the id echoed as a string. A frame whose topics are all unknown gets one error per topic and no `ACK`. One frame with `f_markPrice_all` and `f_ticker_all` got two `ACK`s with the same id |
| symbol identifier format | `BTC-USDT-M` | identical to the catalog's `symbolId` and the REST `symbolId` on 282 of 282 OPEN contracts. Two contracts have Chinese-character ids, `币安人生-USDT-M` and `牛来-USDT-M`, and both stream |
| number representation | strings for price and size, S5 | strings for price and size, `lastUpdateId` a JSON integer |
| timestamp representation | `E` in ms on `f_markPrice`, none on the book, S5, S6 | the book frame has no timestamp. `f_markPrice` frames arrived a median 165 to 171 ms after `E` by the local clock, which runs about 245 ms ahead of the server, see [`rest.md`](./rest.md) section 7 |
| size unit | "quantity", S5 | base coin units, with `multiplier` 1 on every contract, section 4 |
| sequence semantics | `lastUpdateId` "last update id", S5 | every frame is a whole 30 level book, so no chain is needed. `lastUpdateId` never went down, and repeated on a quiet book |
| idle repeat behaviour | not documented | a quiet book is resent every 250 ms. TAO resent an identical book on 43 of 78 and 43 of 79 steps over 20 s, and its `lastUpdateId` stood still on 41 of them |

## 4. The book channel in detail

### Snapshot on subscribe

Every `f_depth30` frame is a full snapshot of the top 30 levels per side at the requested scale.
The first frame arrived 231 to 284 ms after the subscribe frame on BTC, ETH and TAO, and the acknowledgement 101 to 105 ms after it.

### Delta semantics

There are no deltas.
Each frame replaces the book, so a feed calls `resetBook`, sets every level and publishes.
No level outside the 30 shown can be inferred.

### Sequence and gap rule

`lastUpdateId` is a per contract counter, and over all runs it never decreased.
On BTC it advanced by 285 to 740 per frame, so it counts engine updates, not frames.
On TAO and once on ETH it repeated, together with an identical book, when nothing changed.
Because each frame is a whole book, a missed frame loses nothing, and no gap rule is needed.
A feed may drop a frame whose `lastUpdateId` is lower than the last applied one, which never happened in the probes.

### Checksum

None documented and none on the wire.

### Level order on the wire

Bids descend and asks ascend, best first, on every frame of BTC, ETH and TAO, and no frame was crossed.
The REST book has the same order, see [`rest.md`](./rest.md) section 5.

### Level window

Thirty levels per side at the contract's finest scale, which is `depths[0]` and equals `priceStep` on 282 of 282 contracts.
A coarser scale from `depths` aggregates the same 30 levels over a wider range.
A scale outside `depths`, such as `0.5` on BTC, was acknowledged on the socket and delivered nothing.
The engine holds 20 levels per side, so 30 covers it.

### Size unit against `multiplier`

BitTap has no CCXT class, so there is no CCXT `contractSize`.
The website catalog states `multiplier` `"1"` on every contract, and the BTC book shows sizes such as `0.632` with a `minOrderQuantity` of `0.0001`.
The REST 24 hour ticker's `amount` divided by `volume` fell inside the day's low and high on BTC, DOGE and PEPE, see [`rest.md`](./rest.md) section 2.
So sizes are base coin units, and a contract size of 1 is right.

### One-sided and empty books

No one-sided book was seen on an OPEN contract.
A SETTLED contract, LAUNCHCOIN, still streams a full 30 level book, so the catalog filter must drop SETTLED contracts, see [`rest.md`](./rest.md) section 2.

### Idle repeats

A quiet book is resent unchanged every 250 ms with the same `lastUpdateId`.
A feed can skip a frame whose id equals the last one, or publish it, since the content is identical.

### Unknown, closed and wrong-level symbols

| stream | reply |
|---|---|
| `f_depth30@NOPE-USDT-M_0.1` | `ACK`, then nothing |
| `f_depth30@btc-usdt-m_0.1` | `ACK`, then nothing |
| `f_depth30@BTC-USDT-M` with no scale | `ACK`, then nothing |
| `f_depth30@BTC-USDT-M_0.5`, a scale outside `depths` | `ACK`, then nothing |
| `f_depth30@LAUNCHCOIN-USDT-M_0.00001`, a SETTLED contract | `ACK`, then a book every 250 ms |
| `f_depth5@BTC-USDT-M_0.1` and the other unsupported levels | `{"code":"400006","msg":"Unknown topic f_depth5"}` and no `ACK` |
| `f_nope@BTC-USDT-M` | `{"code":"400006","msg":"Unknown topic f_nope"}` and no `ACK` |

So a typo in a symbol is silent, and a feed must log any stream with no book 10 s after its acknowledgement.

## 5. Session

| item | probed |
|---|---|
| keepalive | send `{"id":"<id>","method":"PING"}`, answered `{"id":"<id>","type":"PONG"}`, or a protocol ping, answered with a pong in 102 to 103 ms |
| silence the server tolerates | 60 s without a client ping, then close 1000 `Bye`, even while a frame arrives every second |
| forced disconnects | none seen in 75 s on the pinged sockets, and none on the 282 stream socket |
| maintenance notices | none seen |
| compression | the probe offered no `permessage-deflate`, the server returned no `Sec-WebSocket-Extensions`, and every frame was plain JSON text |
| other methods | `{"method":"time"}`, which the docs show answering the server time, got `{"code":"400001","msg":"Content that cannot be resolved"}`. A frame that is not JSON and an unknown method got the same reply |
| handshake and subscription limits | Not publicly specified. 282 streams in one frame were accepted |

## 6. Captured frames

From `ws-probe.py` on 2026-10-10 UTC, trimmed where marked.

Welcome on open:

```json
{"id":"00ecddce-3122-4252-a0a0-efbb7783c780","type":"WELCOME"}
```

Subscribe acknowledgement, for `"id": 7`:

```json
{"id":"7","type":"ACK"}
```

A book frame, trimmed to three levels per side of 30:

```json
{"e":"f_depth30","s":"BTC-USDT-M","i":"0.1","lastUpdateId":45271513257,"bids":[["82602.2","1.011"],["82602.1","1.255"],["82602","1.115"]],"asks":[["82602.3","0.819"],["82602.4","0.816"],["82602.5","1.239"]]}
```

A mark frame, from `anchor-probe.py`:

```json
{"E":1791599413016,"I":"745.2","T":1791619200000,"e":"f_markPrice","p":"745.28","r":"0","s":"BNB-USDT-M"}
```

Keepalive answer:

```json
{"id":"922bcc6e","type":"PONG"}
```

Errors, for an unsupported depth and for a frame the server cannot parse:

```json
{"code":"400006","msg":"Unknown topic f_depth5"}
```

```json
{"code":"400001","msg":"Content that cannot be resolved"}
```

The close of an unpinged socket after 60.1 s was code 1000 with reason `Bye`.

## 7. Private channels

One stream, `f_private`, after a `LOGIN` frame carrying the API key, a timestamp and an HMAC signature, S19.
Its event types are `ACCOUNT_UPDATE`, `ORDER_UPDATE`, `STOP_ORDER`, `POSTION_UPDATE` (spelled so) and `SETTING_UPDATE`.
Not probed.

## 8. Recommended feed shape

A recommendation for a later design, not a decision.

| item | recommendation | reason |
|---|---|---|
| URL plan | one plan for every contract at `wss://stream.bittap.com/endpoint?format=JSON` | one URL carries all contracts and channels |
| channel | `f_depth30@<symbolId>_<depths[0]>` | the only depth the socket serves, 30 levels at the finest scale |
| anchor | `f_markPrice_all` once, on the first book socket, feeding `SocketAnchors` | one frame a second carries every contract's index, mark, funding and next settlement, and no REST call does, see [`rest.md`](./rest.md) section 3 |
| markets per connection | 150 | 282 book streams ran on one socket at about 1,118 frames per second with no close, so 150 at about 600 frames per second plus the one mark frame a second stay below that |
| subscribe frames | one frame per slice, `{"method":"SUBSCRIBE","params":["f_depth30@BTC-USDT-M_0.1", …],"id":1}`, plus `"f_markPrice_all"` in the first slice's frame | one acknowledgement covered 282 streams |
| keepalive | `{"id":"<n>","method":"PING"}` every 20 s | the server drops any socket after 60 s without a client ping, even with data flowing |
| `maxSilenceMs` | 10,000 | every OPEN contract's book frame arrives every 250 ms even when unchanged, and every mark frame every second |
| routing | `s` is the `rawMarketId`, `e` picks book or mark | the topic and symbol are top level fields |
| snapshot | every frame: `resetBook`, set 30 levels per side, `publish` | each frame is a whole book |
| sequence | skip a frame whose `lastUpdateId` is below the last applied one, and never `resync` on the id | a missed frame loses nothing |
| unserved stream | log a stream with no book 10 s after its `ACK` | unknown symbols, wrong scales and lower case are acknowledged and silent |
| receive time | stamp on arrival | the book frame has no timestamp |
| sizes | parse the string as base coin units, contract size 1 | `multiplier` is 1 on every contract |
| deflate | keep it refused | the server does not force it |

## 9. Source ledger

| id | source | retrieved | used for |
|---|---|---|---|
| S4 | `https://developers.bittap.com/en/futures/base-websocket`, last updated January 26, 2026 | 2026-10-09 | URL, frame shapes, PING, acknowledgement |
| S5 | `https://developers.bittap.com/en/futures/futures-websocket/depth`, last updated January 26, 2026 | 2026-10-09 | book stream |
| S6 | `https://developers.bittap.com/en/futures/futures-websocket/mark-price`, last updated January 26, 2026 | 2026-10-09 | mark stream |
| S16 | `https://www.bittap.com/assets/261009-164923376-2g/index.c47c34d0.js`, the website bundle | 2026-10-09 | private socket URL builder, and the stream topic table that names `f_markPrice_all` and `f_ticker_all` |
| S19 | `https://developers.bittap.com/en/futures/futures-websocket/private` | 2026-10-09 | private stream |
| S20 | `https://developers.bittap.com/en/futures/futures-websocket/book-ticker` | 2026-10-09 | best bid and ask stream |

The other source rows are in [`fees.md`](./fees.md) and [`rest.md`](./rest.md).
